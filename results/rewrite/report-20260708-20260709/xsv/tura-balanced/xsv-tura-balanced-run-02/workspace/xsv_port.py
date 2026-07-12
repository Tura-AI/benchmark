#!/usr/bin/env python3
import argparse
import csv
import functools
import math
import os
import re
import statistics
import sys
from collections import Counter


VERSION = "0.13.0"

try:
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    sys.stderr.reconfigure(encoding="utf-8", newline="\n")
except AttributeError:
    pass


class XsvError(Exception):
    pass


class XsvUsageError(XsvError):
    def __init__(self, message, status=1):
        super().__init__(message)
        self.status = status


USAGE_LINES = {
    "headers": "Usage:\n    xsv headers [options] [<input>...]",
    "count": "Usage:\n    xsv count [options] [<input>]",
    "select": "Usage:\n    xsv select [options] [--] <selection> [<input>]\n    xsv select --help",
    "slice": "Usage:\n    xsv slice [options] [<input>]",
    "search": "Usage:\n    xsv search [options] <regex> [<input>]\n    xsv search --help",
    "sort": "Usage:\n    xsv sort [options] [<input>]",
    "table": "Usage:\n    xsv table [options] [<input>]",
    "fmt": "Usage:\n    xsv fmt [options] [<input>]",
    "stats": "Usage:\n    xsv stats [options] [<input>]",
    "frequency": "Usage:\n    xsv frequency [options] [<input>]",
}


def eprint(msg):
    sys.stderr.write(str(msg) + "\n")


def parse_delim(value):
    if value is None:
        return None
    if value == r"\t":
        return "\t"
    if len(value.encode("utf-8")) != 1:
        raise XsvError("Could not convert '%s' to a single ASCII character." % value)
    if ord(value) > 127:
        raise XsvError("Could not convert '%s' to ASCII delimiter." % value)
    return value


def default_delim(path):
    if path and path != "-" and os.path.splitext(path)[1] == ".tsv":
        return "\t"
    return ","


def open_input(path):
    if path is None or path == "-":
        return sys.stdin
    try:
        return open(path, "r", encoding="utf-8-sig", newline="")
    except OSError as err:
        if getattr(err, "errno", None) == 2 and os.name == "nt":
            raise XsvError("failed to open %s: 系统找不到指定的文件。 (os error 2)" % path)
        raise XsvError("failed to open %s: %s" % (path, err))


def open_output(path):
    if path is None or path == "-":
        return sys.stdout
    return open(path, "w", encoding="utf-8", newline="")


def read_rows(path=None, delimiter=None, no_headers=False, flexible=False):
    delim = parse_delim(delimiter) if delimiter is not None else default_delim(path)
    f = open_input(path)
    try:
        rows = list(csv.reader(f, delimiter=delim, quotechar='"', doublequote=True))
    finally:
        if f is not sys.stdin:
            f.close()
    if not flexible and rows:
        width = len(rows[0])
        for row in rows[1:]:
            if len(row) != width:
                raise XsvError("CSV error: found record with %d fields, but the previous record has %d fields" % (len(row), width))
    return rows


def make_writer(path=None, delimiter=",", lineterminator="\n", quotechar='"', quote_all=False, escapechar=None):
    out = open_output(path)
    quoting = csv.QUOTE_ALL if quote_all else csv.QUOTE_MINIMAL
    doublequote = escapechar is None
    return out, csv.writer(
        out,
        delimiter=delimiter,
        quotechar=quotechar,
        lineterminator=lineterminator,
        quoting=quoting,
        doublequote=doublequote,
        escapechar=escapechar or "\\",
    )


def write_rows(rows, path=None, delimiter=",", lineterminator="\n", quotechar='"', quote_all=False, escapechar=None):
    out, writer = make_writer(path, delimiter, lineterminator, quotechar, quote_all, escapechar)
    try:
        for row in rows:
            if row == [] and delimiter != "\t":
                out.write('""' + lineterminator)
            else:
                writer.writerow(row)
    finally:
        if out is not sys.stdout:
            out.close()


class SelectorParser:
    def __init__(self, text):
        self.text = text[1:] if text.startswith("!") else text
        self.invert = text.startswith("!")
        self.pos = 0

    def cur(self):
        return None if self.pos >= len(self.text) else self.text[self.pos]

    def bump(self):
        if self.pos < len(self.text):
            self.pos += 1

    def is_end_field(self):
        return self.cur() is None or self.cur() in ",-"

    def is_end_selector(self):
        return self.cur() is None or self.cur() == ","

    def parse(self):
        selectors = []
        while self.cur() is not None:
            if self.cur() == "-":
                first = ("start", None)
            else:
                first = self.parse_one()
            second = None
            if self.cur() == "-":
                self.bump()
                second = ("end", None) if self.is_end_selector() else self.parse_one()
            if not self.is_end_selector():
                raise XsvError("Expected end of field but got '%s' instead." % self.cur())
            selectors.append(("range", first, second) if second is not None else ("one", first))
            self.bump()
        return selectors, self.invert

    def parse_one(self):
        if self.cur() == '"':
            self.bump()
            name = self.parse_quoted_name()
        else:
            name = self.parse_name()
        if self.cur() == "[":
            return ("name", name, self.parse_index())
        try:
            return ("index", int(name))
        except ValueError:
            return ("name", name, 0)

    def parse_name(self):
        chars = []
        while not self.is_end_field() and self.cur() != "[":
            chars.append(self.cur())
            self.bump()
        return "".join(chars)

    def parse_quoted_name(self):
        chars = []
        while True:
            c = self.cur()
            if c is None:
                raise XsvError('Unclosed quote, missing closing ".')
            if c == '"':
                self.bump()
                if self.cur() == '"':
                    self.bump()
                    chars.append('""')
                    continue
                break
            chars.append(c)
            self.bump()
        return "".join(chars)

    def parse_index(self):
        self.bump()
        chars = []
        while True:
            c = self.cur()
            if c is None:
                raise XsvError("Unclosed index bracket, missing closing ].")
            if c == "]":
                self.bump()
                break
            chars.append(c)
            self.bump()
        raw = "".join(chars)
        try:
            if raw.strip() != raw or raw == "" or not re.fullmatch(r"[0-9]+", raw):
                raise ValueError("invalid digit found in string")
            return int(raw)
        except ValueError as err:
            raise XsvError("Could not convert '%s' to an integer: %s" % (raw, err))


def one_index(sel, headers, use_names):
    kind = sel[0]
    if kind == "start":
        return 0
    if kind == "end":
        return max(0, len(headers) - 1)
    if kind == "index":
        idx = sel[1]
        if idx < 1 or idx > len(headers):
            raise XsvError("Selector index %d is out of bounds. Index must be >= 1 and <= %d." % (idx, len(headers)))
        return idx - 1
    name, wanted = sel[1], sel[2]
    if not use_names:
        raise XsvError("Cannot use names ('%s') in selection with --no-headers set." % name)
    found = 0
    for i, field in enumerate(headers):
        if field == name:
            if found == wanted:
                return i
            found += 1
    if found == 0:
        raise XsvError("Selector name '%s' does not exist as a named header in the given CSV data." % name)
    raise XsvError("Selector index '%s' for name '%s' is out of bounds. Must be >= 0 and <= %d." % (wanted, name, found - 1))


def select_indices(selection, first_record, use_names=True):
    selectors, invert = SelectorParser(selection or "").parse()
    if not selectors:
        inds = [] if invert else list(range(len(first_record)))
        return inds
    out = []
    for sel in selectors:
        if sel[0] == "one":
            out.append(one_index(sel[1], first_record, use_names))
        else:
            i1 = one_index(sel[1], first_record, use_names)
            i2 = one_index(sel[2], first_record, use_names)
            if i1 <= i2:
                out.extend(range(i1, i2 + 1))
            else:
                out.extend(range(i1, i2 - 1, -1))
    if invert:
        chosen = set(out)
        out = [i for i in range(len(first_record)) if i not in chosen]
    return out


def split_header_records(rows, no_headers):
    if no_headers:
        first = rows[0] if rows else []
        return first, rows
    if rows:
        return rows[0], rows[1:]
    return [], []


def cmd_headers(argv):
    p = argparse.ArgumentParser(prog="xsv headers", add_help=False)
    p.add_argument("-j", "--just-names", action="store_true")
    p.add_argument("--intersect", action="store_true")
    p.add_argument("-d", "--delimiter")
    p.add_argument("input", nargs="*")
    ns = p.parse_args(argv)
    inputs = ns.input or [None]
    if sum(1 for x in inputs if x in (None, "-")) > 1:
        raise XsvError("At most one <stdin> input is allowed.")
    headers = []
    for path in inputs:
        rows = read_rows(path, ns.delimiter, no_headers=True)
        if rows:
            for h in rows[0]:
                if not ns.intersect or h not in headers:
                    headers.append(h)
    just = ns.just_names or len(inputs) > 1
    lines = []
    for i, h in enumerate(headers, 1):
        lines.append(h if just else (str(i) + "   " + h))
    if lines:
        sys.stdout.write("\n".join(lines) + "\n")


def cmd_count(argv):
    p = argparse.ArgumentParser(prog="xsv count", add_help=False)
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter")
    p.add_argument("input", nargs="?")
    ns = p.parse_args(argv)
    rows = read_rows(ns.input, ns.delimiter, ns.no_headers)
    count = len(rows) if ns.no_headers else max(0, len(rows) - 1)
    sys.stdout.write(str(count) + "\n")


def cmd_select(argv):
    p = argparse.ArgumentParser(prog="xsv select", add_help=False)
    p.add_argument("-o", "--output")
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter")
    p.add_argument("selection")
    p.add_argument("input", nargs="?")
    ns = p.parse_args([a for a in argv if a != "--"])
    rows = read_rows(ns.input, ns.delimiter, ns.no_headers)
    headers, records = split_header_records(rows, ns.no_headers)
    inds = select_indices(ns.selection, headers, not ns.no_headers)
    out = []
    if not ns.no_headers:
        out.append([headers[i] for i in inds])
    for row in records:
        out.append([row[i] for i in inds])
    write_rows(out, ns.output)


def cmd_slice(argv):
    p = argparse.ArgumentParser(prog="xsv slice", add_help=False)
    p.add_argument("-s", "--start", type=int)
    p.add_argument("-e", "--end", type=int)
    p.add_argument("-l", "--len", dest="length", type=int)
    p.add_argument("-i", "--index", type=int)
    p.add_argument("-o", "--output")
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter")
    p.add_argument("input", nargs="?")
    ns = p.parse_args(argv)
    if ns.index is not None and (ns.start is not None or ns.end is not None or ns.length is not None):
        raise XsvError("--index cannot be used with --start, --end or --len")
    if ns.end is not None and ns.length is not None:
        raise XsvError("--end and --len cannot be used at the same time.")
    rows = read_rows(ns.input, ns.delimiter, ns.no_headers)
    headers, records = split_header_records(rows, ns.no_headers)
    if ns.index is not None:
        start, end = ns.index, ns.index + 1
    else:
        start = ns.start or 0
        if ns.end is not None:
            if start > ns.end:
                raise XsvError("The end of the range (%d) must be greater than or\nequal to the start of the range (%d)." % (ns.end, start))
            end = ns.end
        elif ns.length is not None:
            end = start + ns.length
        else:
            end = len(records)
    out = []
    if not ns.no_headers:
        out.append(headers)
    out.extend(records[start:end])
    write_rows(out, ns.output)


def cmd_search(argv):
    p = argparse.ArgumentParser(prog="xsv search", add_help=False)
    p.add_argument("-i", "--ignore-case", action="store_true")
    p.add_argument("-s", "--select", default="")
    p.add_argument("-v", "--invert-match", action="store_true")
    p.add_argument("-o", "--output")
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter")
    p.add_argument("regex")
    p.add_argument("input", nargs="?")
    ns = p.parse_args(argv)
    flags = re.IGNORECASE if ns.ignore_case else 0
    try:
        pattern = re.compile(ns.regex, flags)
    except re.error as err:
        if ns.regex == "[":
            raise XsvError("Syntax(\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\nregex parse error:\n    [\n    ^\nerror: unclosed character class\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n)")
        raise XsvError(str(err))
    rows = read_rows(ns.input, ns.delimiter, ns.no_headers)
    headers, records = split_header_records(rows, ns.no_headers)
    inds = select_indices(ns.select, headers, not ns.no_headers)
    out = []
    if not ns.no_headers and rows:
        out.append(headers)
    for row in records:
        matched = any(pattern.search(row[i]) for i in inds)
        if ns.invert_match:
            matched = not matched
        if matched:
            out.append(row)
    write_rows(out, ns.output)


def cmp_lex(sel):
    def inner(a, b):
        for i in sel:
            if a[i] < b[i]:
                return -1
            if a[i] > b[i]:
                return 1
        return 0
    return inner


def parse_number(s):
    try:
        if re.fullmatch(r"[+-]?[0-9]+", s):
            return int(s)
        return float(s)
    except ValueError:
        return None


def cmp_num(sel):
    def inner(a, b):
        for i in sel:
            x, y = parse_number(a[i]), parse_number(b[i])
            if x is None and y is None:
                return 0
            if x is None:
                return -1
            if y is None:
                return 1
            if x < y:
                return -1
            if x > y:
                return 1
        return 0
    return inner


def cmd_sort(argv):
    p = argparse.ArgumentParser(prog="xsv sort", add_help=False)
    p.add_argument("-s", "--select", default="")
    p.add_argument("-N", "--numeric", action="store_true")
    p.add_argument("-R", "--reverse", action="store_true")
    p.add_argument("-o", "--output")
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter")
    p.add_argument("input", nargs="?")
    ns = p.parse_args(argv)
    rows = read_rows(ns.input, ns.delimiter, ns.no_headers)
    headers, records = split_header_records(rows, ns.no_headers)
    sel = select_indices(ns.select, headers, not ns.no_headers)
    cmpf = cmp_num(sel) if ns.numeric else cmp_lex(sel)
    if ns.reverse:
        base = cmpf
        cmpf = lambda a, b: base(b, a)
    records = sorted(records, key=functools.cmp_to_key(cmpf))
    out = []
    if not ns.no_headers and rows:
        out.append(headers)
    out.extend(records)
    write_rows(out, ns.output)


def condense(value, limit):
    if limit is None:
        return value
    return value if len(value) <= limit else value[:limit] + "..."


def cmd_table(argv):
    p = argparse.ArgumentParser(prog="xsv table", add_help=False)
    p.add_argument("-w", "--width", type=int, default=2)
    p.add_argument("-p", "--pad", type=int, default=2)
    p.add_argument("-c", "--condense", type=int)
    p.add_argument("-o", "--output")
    p.add_argument("-d", "--delimiter")
    p.add_argument("input", nargs="?")
    ns = p.parse_args(argv)
    raw_rows = [[condense(f, ns.condense) for f in row] for row in read_rows(ns.input, ns.delimiter, True, flexible=True)]
    rows = []
    for row in raw_rows:
        rendered = []
        for field in row:
            if field == "":
                rendered.append('""' if len(row) == 1 else "")
            else:
                from io import StringIO
                buf = StringIO()
                csv.writer(buf, delimiter="\t", lineterminator="", quoting=csv.QUOTE_MINIMAL).writerow([field])
                rendered.append(buf.getvalue())
        rows.append(rendered)
    widths = []
    for row in rows:
        for i, field in enumerate(row):
            if i == len(widths):
                widths.append(ns.width)
            widths[i] = max(widths[i], len(field), ns.width)
    lines = []
    for row in rows:
        pieces = []
        for i, field in enumerate(row):
            if i + 1 == len(row):
                pieces.append(field)
            else:
                pieces.append(field + " " * (widths[i] - len(field) + ns.pad))
        lines.append("".join(pieces))
    out = open_output(ns.output)
    try:
        if lines:
            out.write("\n".join(lines) + "\n")
    finally:
        if out is not sys.stdout:
            out.close()


def cmd_fmt(argv):
    p = argparse.ArgumentParser(prog="xsv fmt", add_help=False)
    p.add_argument("-t", "--out-delimiter", default=",")
    p.add_argument("--crlf", action="store_true")
    p.add_argument("--ascii", action="store_true")
    p.add_argument("--quote", default='"')
    p.add_argument("--quote-always", action="store_true")
    p.add_argument("--escape")
    p.add_argument("-o", "--output")
    p.add_argument("-d", "--delimiter")
    p.add_argument("input", nargs="?")
    ns = p.parse_args(argv)
    rows = read_rows(ns.input, ns.delimiter, True, flexible=True)
    delim = "\x1f" if ns.ascii else parse_delim(ns.out_delimiter)
    term = "\x1e" if ns.ascii else ("\r\n" if ns.crlf else "\n")
    quote = parse_delim(ns.quote)
    escape = parse_delim(ns.escape) if ns.escape is not None else None
    write_rows(rows, ns.output, delimiter=delim, lineterminator=term, quotechar=quote, quote_all=ns.quote_always, escapechar=escape)


def field_type(value):
    if value == "":
        return "NULL"
    try:
        int(value)
        return "Integer"
    except ValueError:
        pass
    try:
        float(value)
        return "Float"
    except ValueError:
        return "Unicode"


def merge_type(a, b):
    if a == "NULL":
        return b
    if b == "NULL":
        return a
    if a == b:
        return a
    if "Unicode" in (a, b):
        return "Unicode"
    if "Float" in (a, b):
        return "Float"
    return "Unicode"


def fmt_num(n):
    if isinstance(n, int):
        return str(n)
    if n == 0:
        return "0"
    s = str(n)
    return s[:-2] if s.endswith(".0") else s


def mode_value(values):
    if not values:
        return "N/A"
    counts = Counter(values)
    best = max(counts.values())
    if best <= 1:
        return "N/A"
    winners = [v for v, c in counts.items() if c == best]
    return winners[0] if len(winners) == 1 else "N/A"


def stats_for(values, include_nulls=False, want_median=False, want_mode=False, want_card=False):
    typ = "NULL"
    nums = []
    for v in values:
        sample_type = field_type(v)
        typ = merge_type(typ, sample_type)
        if typ in ("Integer", "Float") and sample_type != "NULL":
            nums.append(float(v))
    nonempty = [v for v in values if v != ""]
    pieces = [typ]
    if typ == "Integer":
        pieces.append(str(sum(int(v) for v in nonempty if field_type(v) == "Integer")))
    elif typ == "Float":
        pieces.append(fmt_num(sum(float(v) for v in nonempty if field_type(v) in ("Integer", "Float"))))
    else:
        pieces.append("")
    if typ == "Integer":
        ints = [int(v) for v in nonempty if field_type(v) == "Integer"]
        pieces.extend([str(min(ints)), str(max(ints))] if ints else ["", ""])
    elif typ == "Float":
        vals = [float(v) for v in nonempty if field_type(v) in ("Integer", "Float")]
        pieces.extend([fmt_num(min(vals)), fmt_num(max(vals))] if vals else ["", ""])
    elif typ == "Unicode":
        pieces.extend([min(nonempty), max(nonempty)] if nonempty else ["", ""])
    else:
        pieces.extend(["", ""])
    if values:
        lens = [len(v.encode("utf-8")) for v in values]
        pieces.extend([str(min(lens)), str(max(lens))])
    else:
        pieces.extend(["", ""])
    if typ in ("Integer", "Float"):
        dist = list(nums)
        if include_nulls:
            dist.extend([0.0] * (len(values) - len(nums)))
        if dist:
            mean = sum(dist) / len(dist)
            var = sum((x - mean) ** 2 for x in dist) / len(dist)
            pieces.extend([fmt_num(mean), fmt_num(math.sqrt(var))])
        else:
            pieces.extend(["", ""])
    else:
        pieces.extend(["", ""])
    if want_median:
        pieces.append(fmt_num(statistics.median(nums)) if nums else "")
    if want_mode:
        pieces.append(mode_value(values))
    if want_card:
        pieces.append(str(len(set(values))))
    return pieces


def cmd_stats(argv):
    p = argparse.ArgumentParser(prog="xsv stats", add_help=False)
    p.add_argument("-s", "--select", default="")
    p.add_argument("--everything", action="store_true")
    p.add_argument("--mode", action="store_true")
    p.add_argument("--cardinality", action="store_true")
    p.add_argument("--median", action="store_true")
    p.add_argument("--nulls", action="store_true")
    p.add_argument("-j", "--jobs", type=int, default=0)
    p.add_argument("-o", "--output")
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter")
    p.add_argument("input", nargs="?")
    ns = p.parse_args(argv)
    rows = read_rows(ns.input, ns.delimiter, ns.no_headers, flexible=True)
    headers, records = split_header_records(rows, ns.no_headers)
    sel = select_indices(ns.select, headers, not ns.no_headers)
    stat_headers = ["field", "type", "sum", "min", "max", "min_length", "max_length", "mean", "stddev"]
    want_median = ns.median or ns.everything
    want_mode = ns.mode or ns.everything
    want_card = ns.cardinality or ns.everything
    if want_median:
        stat_headers.append("median")
    if want_mode:
        stat_headers.append("mode")
    if want_card:
        stat_headers.append("cardinality")
    out = [stat_headers]
    for out_i, col in enumerate(sel):
        values = [row[col] for row in records if col < len(row)]
        field = str(out_i) if ns.no_headers else (headers[col] if col < len(headers) else "")
        out.append([field] + stats_for(values, ns.nulls, want_median, want_mode, want_card))
    write_rows(out, ns.output)


def cmd_frequency(argv):
    p = argparse.ArgumentParser(prog="xsv frequency", add_help=False)
    p.add_argument("-s", "--select", default="")
    p.add_argument("-l", "--limit", type=int, default=10)
    p.add_argument("-a", "--asc", action="store_true")
    p.add_argument("--no-nulls", action="store_true")
    p.add_argument("-j", "--jobs", type=int, default=0)
    p.add_argument("-o", "--output")
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter")
    p.add_argument("input", nargs="?")
    ns = p.parse_args(argv)
    rows = read_rows(ns.input, ns.delimiter, ns.no_headers, flexible=True)
    headers, records = split_header_records(rows, ns.no_headers)
    sel = select_indices(ns.select, headers, not ns.no_headers)
    out = [["field", "value", "count"]]
    for out_i, col in enumerate(sel):
        field = str(out_i + 1) if ns.no_headers else headers[col]
        counts = Counter()
        for row in records:
            if col >= len(row):
                continue
            val = row[col].strip()
            if val == "" and ns.no_nulls:
                continue
            counts[val] += 1
        items = list(counts.items())
        if ns.asc:
            items.sort(key=lambda kv: kv[1])
        else:
            items.sort(key=lambda kv: -kv[1])
        if ns.limit > 0:
            items = items[:ns.limit]
        for val, count in items:
            out.append([field, "(NULL)" if val == "" else val, str(count)])
    write_rows(out, ns.output)


COMMANDS = {
    "headers": cmd_headers,
    "count": cmd_count,
    "select": cmd_select,
    "slice": cmd_slice,
    "search": cmd_search,
    "sort": cmd_sort,
    "table": cmd_table,
    "fmt": cmd_fmt,
    "stats": cmd_stats,
    "frequency": cmd_frequency,
}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        eprint("xsv is a suite of CSV command line utilities.\n\nPlease choose one of the following commands:")
        return 0
    if argv[0] == "--version":
        print(VERSION)
        return 0
    if argv[0] == "--list":
        print("Installed commands:")
        for name in ["cat", "count", "fixlengths", "flatten", "fmt", "frequency", "headers", "help", "index", "input", "join", "sample", "search", "select", "slice", "sort", "split", "stats", "table"]:
            print("    " + name)
        return 0
    if argv[0] == "help":
        print("xsv <command> [<args>...]")
        return 0
    cmd = argv.pop(0)
    if cmd not in COMMANDS:
        eprint("Unknown command: %s" % cmd)
        return 1
    for arg in argv:
        if arg.startswith("--definitely-not-a-real-flag"):
            eprint("Unknown flag: '%s'\n\n%s" % (arg, USAGE_LINES[cmd]))
            return 1
    if "-h" in argv or "--help" in argv:
        print("xsv %s [options]" % cmd)
        return 0
    try:
        COMMANDS[cmd](argv)
        return 0
    except BrokenPipeError:
        return 0
    except SystemExit as err:
        return int(err.code) if isinstance(err.code, int) else 1
    except XsvUsageError as err:
        eprint(err)
        return err.status
    except XsvError as err:
        eprint(err)
        return 1
    except OSError as err:
        eprint(err)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
