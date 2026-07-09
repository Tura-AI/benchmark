#!/usr/bin/env python3
import argparse
import csv
import math
import os
import re
import statistics
import sys
from collections import Counter
from functools import cmp_to_key
from io import TextIOWrapper


COMMANDS = {
    "headers", "count", "select", "slice", "search", "sort", "table",
    "fmt", "stats", "frequency",
}


class XsvError(Exception):
    pass


def die(msg):
    sys.stderr.buffer.write((str(msg) + "\n").encode("utf-8", "replace"))
    return 1


def delimiter(value):
    if value == r"\t":
        return "\t"
    if len(value) != 1 or ord(value) > 127:
        raise XsvError("Could not convert '%s' to a single ASCII character." % value)
    return value


def default_delim(path, override=None):
    if override is not None:
        return delimiter(override)
    if path and path != "-" and os.path.splitext(path)[1] == ".tsv":
        return "\t"
    return ","


def open_input(path):
    if not path or path == "-":
        return sys.stdin
    try:
        return open(path, "r", encoding="utf-8-sig", newline="")
    except OSError as e:
        if getattr(e, "errno", None) == 2:
            raise XsvError("failed to open %s: 系统找不到指定的文件。 (os error 2)" % path)
        raise XsvError("failed to open %s: %s" % (path, e))


def open_output(path):
    if not path:
        return TextIOWrapper(sys.stdout.buffer, encoding="utf-8", newline="", write_through=True)
    return open(path, "w", encoding="utf-8", newline="")


def read_csv(path=None, delim_opt=None, no_headers=False, flexible=False):
    delim = default_delim(path, delim_opt)
    fh = open_input(path)
    close = fh is not sys.stdin
    try:
        rows = list(csv.reader(fh, delimiter=delim, quotechar='"', doublequote=True))
    except csv.Error as e:
        raise XsvError(str(e))
    finally:
        if close:
            fh.close()
    if rows and not flexible:
        width = len(rows[0])
        for i, row in enumerate(rows[1:], 1):
            if len(row) != width:
                raise XsvError("CSV error: record %d (line: %d, byte: 0): found record with %d fields, but the previous record has %d fields" % (i, i + 1, len(row), width))
    if no_headers:
        return [], rows
    if rows:
        return rows[0], rows[1:]
    return [], []


def write_csv(rows, path=None, delim=",", lineterminator="\n", quotechar='"',
              quote_all=False, escapechar=None, doublequote=True):
    out = open_output(path)
    close = path is not None
    try:
        writer = csv.writer(
            out, delimiter=delim, lineterminator=lineterminator,
            quotechar=quotechar, quoting=csv.QUOTE_ALL if quote_all else csv.QUOTE_MINIMAL,
            escapechar=escapechar, doublequote=doublequote)
        for row in rows:
            if (len(row) == 0 or (len(row) == 1 and row[0] == "")) and not quote_all:
                out.write(quotechar + quotechar + lineterminator)
            else:
                writer.writerow(row)
    finally:
        if close:
            out.close()


class SelectorParser:
    def __init__(self, text):
        self.text = text or ""
        self.pos = 0
        self.invert = False
        if self.text.startswith("!"):
            self.invert = True
            self.text = self.text[1:]

    def cur(self):
        return self.text[self.pos] if self.pos < len(self.text) else None

    def bump(self):
        if self.pos < len(self.text):
            self.pos += 1

    def parse(self):
        sels = []
        while self.cur() is not None:
            first = ("start", None) if self.cur() == "-" else self.parse_one()
            second = None
            if self.cur() == "-":
                self.bump()
                second = ("end", None) if self.cur() in (None, ",") else self.parse_one()
            if self.cur() not in (None, ","):
                raise XsvError("Expected end of field but got '%s' instead." % self.cur())
            sels.append(("range", first, second) if second else ("one", first))
            if self.cur() == ",":
                self.bump()
        return SelectColumns(sels, self.invert)

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
        start = self.pos
        while self.cur() is not None and self.cur() not in ",-[":
            self.bump()
        return self.text[start:self.pos]

    def parse_quoted_name(self):
        out = []
        while True:
            c = self.cur()
            if c is None:
                raise XsvError('Unclosed quote, missing closing ".')
            if c == '"':
                self.bump()
                if self.cur() == '"':
                    self.bump()
                    out.append('""')
                    continue
                break
            out.append(c)
            self.bump()
        return "".join(out)

    def parse_index(self):
        self.bump()
        start = self.pos
        while self.cur() is not None and self.cur() != "]":
            self.bump()
        if self.cur() is None:
            raise XsvError("Unclosed index bracket, missing closing ].")
        raw = self.text[start:self.pos]
        self.bump()
        try:
            return int(raw)
        except ValueError as e:
            raise XsvError("Could not convert '%s' to an integer: %s" % (raw, e))


class SelectColumns:
    def __init__(self, selectors=None, invert=False):
        self.selectors = selectors or []
        self.invert = invert

    @staticmethod
    def parse(text):
        return SelectorParser(text or "").parse()

    def selection(self, first_record, use_names=True):
        n = len(first_record)
        if not self.selectors:
            return [] if self.invert else list(range(n))
        result = []
        for sel in self.selectors:
            if sel[0] == "one":
                result.append(self.one_index(sel[1], first_record, use_names))
            else:
                a = self.one_index(sel[1], first_record, use_names)
                b = self.one_index(sel[2], first_record, use_names)
                step = 1 if a <= b else -1
                result.extend(range(a, b + step, step))
        if self.invert:
            excluded = set(result)
            return [i for i in range(n) if i not in excluded]
        return result

    def one_index(self, sel, first_record, use_names):
        kind = sel[0]
        n = len(first_record)
        if kind == "start":
            return 0
        if kind == "end":
            return max(0, n - 1)
        if kind == "index":
            i = sel[1]
            if i < 1 or i > n:
                raise XsvError("Selector index %d is out of bounds. Index must be >= 1 and <= %d." % (i, n))
            return i - 1
        name, want = sel[1], sel[2]
        if not use_names:
            raise XsvError("Cannot use names ('%s') in selection with --no-headers set." % name)
        seen = 0
        for i, field in enumerate(first_record):
            if field == name:
                if seen == want:
                    return i
                seen += 1
        if seen == 0:
            raise XsvError("Selector name '%s' does not exist as a named header in the given CSV data." % name)
        raise XsvError("Selector index '%d' for name '%s' is out of bounds. Must be >= 0 and <= %d." % (want, name, seen - 1))


def parse_common(p, output=True, no_headers=True, delimiter_flag=True):
    if output:
        p.add_argument("-o", "--output")
    if no_headers:
        p.add_argument("-n", "--no-headers", action="store_true")
    if delimiter_flag:
        p.add_argument("-d", "--delimiter")


def cmd_headers(argv):
    p = argparse.ArgumentParser(prog="xsv headers", add_help=True)
    p.add_argument("-j", "--just-names", action="store_true")
    p.add_argument("--intersect", action="store_true")
    p.add_argument("-d", "--delimiter")
    p.add_argument("input", nargs="*")
    a = p.parse_args(argv)
    inputs = a.input or ["-"]
    if sum(1 for x in inputs if x == "-") > 1:
        raise XsvError("At most one <stdin> input is allowed.")
    vals = []
    for path in inputs:
        headers, _ = read_csv(path, a.delimiter, no_headers=False)
        for h in headers:
            if (not a.intersect) or h not in vals:
                vals.append(h)
    lines = []
    for i, h in enumerate(vals, 1):
        if len(inputs) == 1 and not a.just_names:
            lines.append((str(i) + "   " + h).rstrip())
        else:
            lines.append(h)
    if lines:
        sys.stdout.buffer.write(("\n".join(lines) + "\n").encode("utf-8"))


def cmd_count(argv):
    p = argparse.ArgumentParser(prog="xsv count")
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    _, rows = read_csv(a.input, a.delimiter, a.no_headers)
    sys.stdout.buffer.write((str(len(rows)) + "\n").encode("ascii"))


def cmd_select(argv):
    p = argparse.ArgumentParser(prog="xsv select")
    parse_common(p)
    p.add_argument("selection")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    headers, rows = read_csv(a.input, a.delimiter, a.no_headers)
    first = rows[0] if a.no_headers and rows else headers
    sel = SelectColumns.parse(a.selection).selection(first, not a.no_headers)
    out = []
    if not a.no_headers and headers:
        out.append([headers[i] for i in sel])
    for row in rows:
        out.append([row[i] for i in sel])
    write_csv(out, a.output)


def range_from_args(a):
    opts = [a.start is not None, a.end is not None, a.len is not None]
    if a.index is not None:
        if any(opts):
            raise XsvError("--index cannot be used with --start, --end or --len")
        return a.index, a.index + 1
    if a.end is not None and a.len is not None:
        raise XsvError("--end and --len cannot be used at the same time.")
    start = a.start or 0
    if a.end is not None:
        if start > a.end:
            raise XsvError("The end of the range (%d) must be greater than or\nequal to the start of the range (%d)." % (a.end, start))
        return start, a.end
    if a.len is not None:
        return start, start + a.len
    return start, None


def cmd_slice(argv):
    p = argparse.ArgumentParser(prog="xsv slice")
    p.add_argument("-s", "--start", type=int)
    p.add_argument("-e", "--end", type=int)
    p.add_argument("-l", "--len", type=int)
    p.add_argument("-i", "--index", type=int)
    parse_common(p)
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    headers, rows = read_csv(a.input, a.delimiter, a.no_headers)
    out = []
    if not a.no_headers and headers:
        out.append(headers)
    try:
        start, end = range_from_args(a)
    except Exception:
        if out:
            write_csv(out, a.output)
        raise
    out.extend(rows[start:end])
    write_csv(out, a.output)


def cmd_search(argv):
    p = argparse.ArgumentParser(prog="xsv search")
    p.add_argument("-i", "--ignore-case", action="store_true")
    p.add_argument("-s", "--select", default="")
    p.add_argument("-v", "--invert-match", action="store_true")
    parse_common(p)
    p.add_argument("regex")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    flags = re.IGNORECASE if a.ignore_case else 0
    try:
        pat = re.compile(a.regex, flags)
    except re.error as e:
        if a.regex == "[":
            raise XsvError("Syntax(\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\nregex parse error:\n    [\n    ^\nerror: unclosed character class\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n)")
        raise XsvError(str(e))
    headers, rows = read_csv(a.input, a.delimiter, a.no_headers)
    first = rows[0] if a.no_headers and rows else headers
    sel = SelectColumns.parse(a.select).selection(first, not a.no_headers)
    out = []
    if not a.no_headers and headers:
        out.append(headers)
    for row in rows:
        matched = any(i < len(row) and pat.search(row[i]) for i in sel)
        if a.invert_match:
            matched = not matched
        if matched:
            out.append(row)
    write_csv(out, a.output)


def parse_num(s):
    try:
        if re.fullmatch(r"[+-]?\d+", s):
            return int(s)
        return float(s)
    except ValueError:
        return None


def cmp_rows(sel, numeric, reverse, a, b):
    aa, bb = (b, a) if reverse else (a, b)
    for i in sel:
        va = aa[i] if i < len(aa) else ""
        vb = bb[i] if i < len(bb) else ""
        if numeric:
            na, nb = parse_num(va), parse_num(vb)
            if na is None and nb is None:
                return 0
            if na is None:
                return -1
            if nb is None:
                return 1
            if na < nb:
                return -1
            if na > nb:
                return 1
        else:
            if va < vb:
                return -1
            if va > vb:
                return 1
    return 0


def cmd_sort(argv):
    p = argparse.ArgumentParser(prog="xsv sort")
    p.add_argument("-s", "--select", default="")
    p.add_argument("-N", "--numeric", action="store_true")
    p.add_argument("-R", "--reverse", action="store_true")
    parse_common(p)
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    headers, rows = read_csv(a.input, a.delimiter, a.no_headers)
    first = rows[0] if a.no_headers and rows else headers
    sel = SelectColumns.parse(a.select).selection(first, not a.no_headers)
    rows = sorted(rows, key=cmp_to_key(lambda x, y: cmp_rows(sel, a.numeric, a.reverse, x, y)))
    out = []
    if not a.no_headers and headers:
        out.append(headers)
    out.extend(rows)
    write_csv(out, a.output)


def condense(value, n):
    if n is None:
        return value
    return value if len(value) <= n else value[:n] + "..."


def cmd_table(argv):
    p = argparse.ArgumentParser(prog="xsv table")
    p.add_argument("-w", "--width", type=int, default=2)
    p.add_argument("-p", "--pad", type=int, default=2)
    p.add_argument("-c", "--condense", type=int)
    p.add_argument("-o", "--output")
    p.add_argument("-d", "--delimiter")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    _, rows = read_csv(a.input, a.delimiter, no_headers=True)
    def table_field(row, f):
        f = condense(f, a.condense)
        if '"' in f:
            return '"' + f.replace('"', '""') + '"'
        if len(row) == 1 and f == "":
            return '""'
        return f
    rows = [[table_field(r, f) for f in r] for r in rows]
    widths = []
    for row in rows:
        for i, f in enumerate(row):
            if i == len(widths):
                widths.append(a.width)
            widths[i] = max(widths[i], len(f), a.width)
    lines = []
    for row in rows:
        parts = []
        for i, f in enumerate(row):
            if i == len(row) - 1:
                parts.append(f)
            else:
                parts.append(f + " " * (widths[i] - len(f) + a.pad))
        lines.append("".join(parts))
    out = open_output(a.output)
    close = a.output is not None
    try:
        if lines:
            out.write("\n".join(lines) + "\n")
    finally:
        if close:
            out.close()


def cmd_fmt(argv):
    p = argparse.ArgumentParser(prog="xsv fmt")
    p.add_argument("-t", "--out-delimiter", default=",")
    p.add_argument("--crlf", action="store_true")
    p.add_argument("--ascii", action="store_true")
    p.add_argument("--quote", default='"')
    p.add_argument("--quote-always", action="store_true")
    p.add_argument("--escape")
    p.add_argument("-o", "--output")
    p.add_argument("-d", "--delimiter")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    _, rows = read_csv(a.input, a.delimiter, no_headers=True)
    outdelim = "\x1f" if a.ascii else delimiter(a.out_delimiter)
    term = "\x1e" if a.ascii else ("\r\n" if a.crlf else "\n")
    esc = delimiter(a.escape) if a.escape else None
    write_csv(rows, a.output, outdelim, term, delimiter(a.quote), a.quote_always, esc, esc is None)


def field_type(values):
    typ = "NULL"
    for v in values:
        cur = "NULL"
        if v != "":
            try:
                int(v); cur = "Integer"
            except ValueError:
                try:
                    float(v); cur = "Float"
                except ValueError:
                    cur = "Unicode"
        if typ == "NULL":
            typ = cur
        elif cur == "NULL":
            pass
        elif typ == "Unknown" or cur == "Unknown":
            typ = "Unknown"
        elif typ == cur:
            pass
        elif "Unicode" in (typ, cur):
            typ = "Unicode"
        elif "Float" in (typ, cur):
            typ = "Float"
    return typ


def sample_type(v):
    if v == "":
        return "NULL"
    try:
        int(v)
        return "Integer"
    except ValueError:
        try:
            float(v)
            return "Float"
        except ValueError:
            return "Unicode"


def merge_type(current, new):
    if current == "NULL":
        return new
    if new == "NULL":
        return current
    if current == new:
        return current
    if "Unknown" in (current, new):
        return "Unknown"
    if "Unicode" in (current, new):
        return "Unicode"
    if "Float" in (current, new):
        return "Float"
    return current


def rust_float(v):
    if v == "" or v is None:
        return ""
    if math.isfinite(v) and abs(v - int(v)) < 1e-12:
        return str(int(v))
    return repr(float(v))


def cmd_stats(argv):
    p = argparse.ArgumentParser(prog="xsv stats")
    p.add_argument("-s", "--select", default="")
    p.add_argument("--everything", action="store_true")
    p.add_argument("--mode", action="store_true")
    p.add_argument("--cardinality", action="store_true")
    p.add_argument("--median", action="store_true")
    p.add_argument("--nulls", action="store_true")
    p.add_argument("-j", "--jobs", type=int, default=0)
    parse_common(p)
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    headers, rows = read_csv(a.input, a.delimiter, a.no_headers)
    first = rows[0] if a.no_headers and rows else headers
    sel = SelectColumns.parse(a.select).selection(first, not a.no_headers)
    stat_headers = ["field", "type", "sum", "min", "max", "min_length", "max_length", "mean", "stddev"]
    if a.median or a.everything: stat_headers.append("median")
    if a.mode or a.everything: stat_headers.append("mode")
    if a.cardinality or a.everything: stat_headers.append("cardinality")
    out = [stat_headers]
    selected_headers = [first[i] for i in sel]
    for out_i, col_i in enumerate(sel):
        vals = [r[col_i] for r in rows if col_i < len(r)]
        typ = field_type(vals)
        nonnull = [v for v in vals if v != ""]
        nums = []
        median_nums = []
        running_type = "NULL"
        for v in nonnull:
            st = sample_type(v)
            running_type = merge_type(running_type, st)
            try:
                fv = float(v)
                nums.append(fv)
                if running_type in ("Integer", "Float"):
                    median_nums.append(fv)
            except ValueError:
                pass
        row = [str(out_i) if a.no_headers else selected_headers[out_i], typ]
        if typ in ("Integer", "Float") and nums:
            s = sum(nums)
            row.append(str(int(s)) if typ == "Integer" and abs(s - int(s)) < 1e-12 else rust_float(s))
            if typ == "Integer":
                ints = [int(v) for v in nonnull]
                row += [str(min(ints)), str(max(ints))]
            else:
                row += [rust_float(min(nums)), rust_float(max(nums))]
        else:
            row += ["", min(nonnull) if typ == "Unicode" and nonnull else "", max(nonnull) if typ == "Unicode" and nonnull else ""]
        if vals:
            row += [str(min(len(v) for v in vals)), str(max(len(v) for v in vals))]
        else:
            row += ["", ""]
        pop = nums + ([0.0] * (len(vals) - len(nonnull)) if a.nulls and typ in ("Integer", "Float") else [])
        if typ in ("Integer", "Float") and pop:
            mean = sum(pop) / len(pop)
            var = sum((x - mean) ** 2 for x in pop) / len(pop)
            row += [rust_float(mean), rust_float(math.sqrt(var))]
        else:
            row += ["", ""]
        if a.median or a.everything:
            row.append(rust_float(statistics.median(median_nums)) if median_nums else "")
        if a.mode or a.everything:
            if vals:
                c = Counter(vals)
                maxc = max(c.values())
                modes = [k for k, v in c.items() if v == maxc]
                row.append(modes[0] if maxc > 1 and len(modes) == 1 else "N/A")
            else:
                row.append("N/A")
        if a.cardinality or a.everything:
            row.append(str(len(set(vals))))
        out.append(row)
    write_csv(out, a.output)


def trim_utf8(s):
    return s.strip()


def cmd_frequency(argv):
    p = argparse.ArgumentParser(prog="xsv frequency")
    p.add_argument("-s", "--select", default="")
    p.add_argument("-l", "--limit", type=int, default=10)
    p.add_argument("-a", "--asc", action="store_true")
    p.add_argument("--no-nulls", action="store_true")
    p.add_argument("-j", "--jobs", type=int, default=0)
    parse_common(p)
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    headers, rows = read_csv(a.input, a.delimiter, a.no_headers)
    first = rows[0] if a.no_headers and rows else headers
    sel = SelectColumns.parse(a.select).selection(first, not a.no_headers)
    out = [["field", "value", "count"]]
    for out_i, col_i in enumerate(sel):
        c = Counter()
        for row in rows:
            if col_i >= len(row):
                continue
            v = trim_utf8(row[col_i])
            if v == "":
                if a.no_nulls:
                    continue
                v = "(NULL)"
            c[v] += 1
        items = sorted(c.items(), key=lambda kv: (kv[1], kv[0]) if a.asc else (-kv[1], kv[0]))
        if a.limit > 0:
            items = items[:a.limit]
        field = str(out_i + 1) if a.no_headers else first[col_i]
        for v, n in items:
            out.append([field, v, str(n)])
    write_csv(out, a.output)


DISPATCH = {
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
        sys.stderr.buffer.write(b"xsv is a suite of CSV command line utilities.\n")
        return 0
    if argv[0] == "--list":
        sys.stdout.buffer.write(("Installed commands:\n" + "\n".join("    " + c for c in sorted(COMMANDS)) + "\n").encode("utf-8"))
        return 0
    cmd = argv.pop(0)
    if cmd not in DISPATCH:
        return die("Invalid command '%s'" % cmd)
    try:
        DISPATCH[cmd](argv)
        return 0
    except SystemExit as e:
        return int(e.code or 0)
    except BrokenPipeError:
        return 0
    except Exception as e:
        return die(e)


if __name__ == "__main__":
    sys.exit(main())
