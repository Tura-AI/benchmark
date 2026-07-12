#!/usr/bin/env python3
import argparse
import csv
import io
import math
import os
import re
import statistics
import sys
from collections import Counter
from functools import cmp_to_key


COMMAND_LIST = """
    cat         Concatenate by row or column
    count       Count records
    fixlengths  Makes all records have same length
    flatten     Show one field per line
    fmt         Format CSV output (change field delimiter)
    frequency   Show frequency tables
    headers     Show header names
    help        Show this usage message.
    index       Create CSV index for faster access
    input       Read CSV data with special quoting rules
    join        Join CSV files
    sample      Randomly sample CSV data
    search      Search CSV data with regexes
    select      Select columns from CSV
    slice       Slice records from CSV
    sort        Sort CSV data
    split       Split CSV data into many files
    stats       Compute basic statistics
    table       Align CSV data into columns
"""


class XsvError(Exception):
    pass


def die(msg, code=1):
    sys.stderr.buffer.write(encoded(str(msg) + "\n"))
    raise SystemExit(code)


def rust_float(value):
    if value is None:
        return ""
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "inf" if value > 0 else "-inf"
        if value == 0:
            return "0"
        if value.is_integer():
            return str(int(value))
        return repr(value)
    return str(value)


def parse_delim(value):
    if value is None:
        return None
    if value == r"\t":
        return "\t"
    if len(value) != 1:
        raise XsvError("Could not convert '{}' to a single ASCII character.".format(value))
    if ord(value) > 127:
        raise XsvError("Could not convert '{}' to ASCII delimiter.".format(value))
    return value


def default_delim(path):
    if path and path != "-" and os.path.splitext(path)[1] == ".tsv":
        return "\t"
    return ","


def read_text(path):
    if path is None or path == "-":
        data = sys.stdin.buffer.read()
    else:
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError as e:
            raise XsvError("failed to open {}: {}".format(path, e))
    text = data.decode("utf-8", "surrogateescape")
    if text.startswith("\ufeff"):
        text = text[1:]
    return text


def read_csv(path=None, delimiter=None, no_headers=False, quote='"', escape=None, enforce=True):
    delim = delimiter if delimiter is not None else default_delim(path)
    text = read_text(path)
    rdr = csv.reader(io.StringIO(text, newline=""), delimiter=delim, quotechar=quote,
                     doublequote=(escape is None), escapechar=escape)
    rows = []
    try:
        for row in rdr:
            rows.append(row)
    except csv.Error as e:
        raise XsvError("CSV error: {}".format(e))
    if enforce and rows:
        expected = len(rows[0])
        for i, row in enumerate(rows[1:], 2):
            if len(row) != expected:
                raise XsvError("CSV error: record {} (line: {}) has different length than previous records".format(i, i))
    if no_headers:
        first = rows[0] if rows else []
        records = rows
    else:
        first = rows[0] if rows else []
        records = rows[1:] if rows else []
    return first, records, rows


def encoded(s):
    return s.encode("utf-8", "surrogateescape")


def write_bytes(data, output=None):
    if output:
        with open(output, "wb") as f:
            f.write(data)
    else:
        sys.stdout.buffer.write(data)


def csv_bytes(rows, delimiter=",", lineterminator="\n", quote='"', quote_always=False,
              escape=None):
    buf = io.StringIO(newline="")
    writer = csv.writer(buf, delimiter=delimiter, quotechar=quote,
                        quoting=csv.QUOTE_ALL if quote_always else csv.QUOTE_MINIMAL,
                        lineterminator=lineterminator,
                        doublequote=(escape is None), escapechar=escape or "\\")
    for row in rows:
        writer.writerow([str(x) for x in row])
    return encoded(buf.getvalue())


def write_csv(rows, output=None, delimiter=",", lineterminator="\n", quote='"',
              quote_always=False, escape=None):
    write_bytes(csv_bytes(rows, delimiter, lineterminator, quote, quote_always, escape), output)


class SelectorParser:
    def __init__(self, raw):
        self.raw = raw or ""
        self.invert = self.raw.startswith("!")
        self.s = self.raw[1:] if self.invert else self.raw
        self.pos = 0

    def cur(self):
        return self.s[self.pos] if self.pos < len(self.s) else None

    def bump(self):
        if self.pos < len(self.s):
            self.pos += 1

    def is_end_field(self):
        c = self.cur()
        return c is None or c == "," or c == "-"

    def is_end_selector(self):
        c = self.cur()
        return c is None or c == ","

    def parse(self):
        selectors = []
        while self.cur() is not None:
            if self.cur() == "-":
                f1 = ("start",)
            else:
                f1 = self.parse_one()
            if self.cur() == "-":
                self.bump()
                if self.is_end_selector():
                    f2 = ("end",)
                else:
                    f2 = self.parse_one()
                sel = ("range", f1, f2)
            else:
                sel = ("one", f1)
            if not self.is_end_selector():
                raise XsvError("Expected end of field but got '{}' instead.".format(self.cur()))
            selectors.append(sel)
            self.bump()
        return SelectColumns(selectors, self.invert)

    def parse_one(self):
        if self.cur() == '"':
            self.bump()
            name = self.parse_quoted_name()
        else:
            name = self.parse_name()
        if self.cur() == "[":
            idx = self.parse_index()
            return ("name", name, idx)
        try:
            idx = int(name)
            return ("index", idx)
        except ValueError:
            return ("name", name, 0)

    def parse_name(self):
        out = []
        while not self.is_end_field() and self.cur() != "[":
            out.append(self.cur())
            self.bump()
        return "".join(out)

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
                return "".join(out)
            out.append(c)
            self.bump()

    def parse_index(self):
        self.bump()
        out = []
        while True:
            c = self.cur()
            if c is None:
                raise XsvError("Unclosed index bracket, missing closing ].")
            if c == "]":
                self.bump()
                break
            out.append(c)
            self.bump()
        raw = "".join(out)
        try:
            if raw.strip() != raw or not re.fullmatch(r"[0-9]+", raw):
                raise ValueError("invalid digit found in string")
            return int(raw)
        except ValueError as e:
            raise XsvError("Could not convert '{}' to an integer: {}".format(raw, e))


class SelectColumns:
    def __init__(self, selectors=None, invert=False):
        self.selectors = selectors or []
        self.invert = invert

    @staticmethod
    def parse(raw):
        if raw is None:
            return SelectColumns()
        return SelectorParser(raw).parse()

    def selection(self, first_record, use_names=True):
        if not self.selectors:
            return [] if self.invert else list(range(len(first_record)))
        out = []
        for sel in self.selectors:
            if sel[0] == "one":
                out.append(self.one_index(sel[1], first_record, use_names))
            else:
                i1 = self.one_index(sel[1], first_record, use_names)
                i2 = self.one_index(sel[2], first_record, use_names)
                if i1 <= i2:
                    out.extend(range(i1, i2 + 1))
                else:
                    out.extend(range(i1, i2 - 1, -1))
        if self.invert:
            blocked = set(out)
            return [i for i in range(len(first_record)) if i not in blocked]
        return out

    def one_index(self, one, first, use_names):
        kind = one[0]
        if kind == "start":
            return 0
        if kind == "end":
            return max(0, len(first) - 1)
        if kind == "index":
            i = one[1]
            if i < 1 or i > len(first):
                raise XsvError("Selector index {} is out of bounds. Index must be >= 1 and <= {}.".format(i, len(first)))
            return i - 1
        name, wanted = one[1], one[2]
        if not use_names:
            raise XsvError("Cannot use names ('{}') in selection with --no-headers set.".format(name))
        found = 0
        for i, value in enumerate(first):
            if value == name:
                if found == wanted:
                    return i
                found += 1
        if found == 0:
            raise XsvError("Selector name '{}' does not exist as a named header in the given CSV data.".format(name))
        raise XsvError("Selector index '{}' for name '{}' is out of bounds. Must be >= 0 and <= {}.".format(wanted, name, found - 1))


def normal_selection(sel):
    return sorted(set(sel))


def selected(row, sel):
    return [row[i] for i in sel]


def build_parser(prog, add_help=False):
    return argparse.ArgumentParser(prog=prog, add_help=add_help)


def add_common(p, output=False, no_headers=False):
    if output:
        p.add_argument("-o", "--output")
    if no_headers:
        p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter")


def parse_args(p, argv):
    try:
        ns = p.parse_args(argv)
        if hasattr(ns, "delimiter"):
            ns.delimiter = parse_delim(ns.delimiter)
        return ns
    except SystemExit as e:
        raise
    except Exception as e:
        raise XsvError(e)


def cmd_headers(argv):
    p = build_parser("xsv headers")
    p.add_argument("-j", "--just-names", action="store_true")
    p.add_argument("--intersect", action="store_true")
    p.add_argument("-d", "--delimiter")
    p.add_argument("inputs", nargs="*")
    ns = parse_args(p, argv)
    inputs = ns.inputs or ["-"]
    if sum(1 for x in inputs if x == "-") > 1:
        raise XsvError("At most one <stdin> input is allowed.")
    headers = []
    for inp in inputs:
        first, _, _ = read_csv(inp, ns.delimiter, no_headers=True, enforce=False)
        for h in first:
            if (not ns.intersect) or all(x != h for x in headers):
                headers.append(h)
    lines = []
    if len(inputs) == 1 and not ns.just_names:
        width = len(str(len(headers))) if headers else 1
        for i, h in enumerate(headers, 1):
            lines.append(str(i).ljust(width + 3) + h)
    else:
        lines = headers
    write_bytes(encoded("\n".join(lines) + ("\n" if lines else "")))


def cmd_count(argv):
    p = build_parser("xsv count")
    add_common(p, no_headers=True)
    p.add_argument("input", nargs="?")
    ns = parse_args(p, argv)
    _, records, rows = read_csv(ns.input, ns.delimiter, ns.no_headers)
    count = len(rows) if ns.no_headers else len(records)
    write_bytes(encoded(str(count) + "\n"))


def cmd_select(argv):
    p = build_parser("xsv select")
    add_common(p, output=True, no_headers=True)
    p.add_argument("selection")
    p.add_argument("input", nargs="?")
    ns = parse_args(p, argv)
    selcols = SelectColumns.parse(ns.selection)
    headers, records, _ = read_csv(ns.input, ns.delimiter, ns.no_headers)
    sel = selcols.selection(headers, not ns.no_headers)
    out = []
    if not ns.no_headers and headers:
        out.append(selected(headers, sel))
    for row in records:
        out.append(selected(row, sel))
    write_csv(out, ns.output)


def parse_range(ns):
    start = ns.start
    end = ns.end
    length = ns.len
    index = ns.index
    if index is not None:
        if start is not None or end is not None or length is not None:
            raise XsvError("--index cannot be used with --start, --end or --len")
        return index, index + 1
    if end is not None and length is not None:
        raise XsvError("--end and --len cannot be used at the same time.")
    s = start or 0
    if end is not None:
        if s > end:
            raise XsvError("The end of the range ({}) must be greater than or\nequal to the start of the range ({}).".format(end, s))
        return s, end
    if length is not None:
        return s, s + length
    return s, sys.maxsize


def cmd_slice(argv):
    p = build_parser("xsv slice")
    p.add_argument("-s", "--start", type=int)
    p.add_argument("-e", "--end", type=int)
    p.add_argument("-l", "--len", type=int)
    p.add_argument("-i", "--index", type=int)
    add_common(p, output=True, no_headers=True)
    p.add_argument("input", nargs="?")
    ns = parse_args(p, argv)
    headers, records, _ = read_csv(ns.input, ns.delimiter, ns.no_headers)
    out = []
    if not ns.no_headers and headers:
        out.append(headers)
    try:
        s, e = parse_range(ns)
    except XsvError:
        if out and not ns.output:
            write_bytes(csv_bytes(out))
        raise
    out.extend(records[s:e])
    write_csv(out, ns.output)


def cmd_search(argv):
    p = build_parser("xsv search")
    p.add_argument("-i", "--ignore-case", action="store_true")
    p.add_argument("-s", "--select")
    p.add_argument("-v", "--invert-match", action="store_true")
    add_common(p, output=True, no_headers=True)
    p.add_argument("regex")
    p.add_argument("input", nargs="?")
    ns = parse_args(p, argv)
    try:
        pat = re.compile(ns.regex, re.I if ns.ignore_case else 0)
    except re.error as e:
        raise XsvError(str(e))
    headers, records, _ = read_csv(ns.input, ns.delimiter, ns.no_headers)
    sel = SelectColumns.parse(ns.select).selection(headers, not ns.no_headers)
    out = []
    if not ns.no_headers and headers:
        out.append(headers)
    for row in records:
        ok = any(pat.search(row[i]) for i in sel)
        if ns.invert_match:
            ok = not ok
        if ok:
            out.append(row)
    write_csv(out, ns.output)


def lex_cmp(a, b):
    for x, y in zip(a, b):
        if x < y:
            return -1
        if x > y:
            return 1
    return (len(a) > len(b)) - (len(a) < len(b))


def parse_number(s):
    if re.fullmatch(r"[+-]?[0-9]+", s or ""):
        try:
            return int(s)
        except ValueError:
            pass
    try:
        if s.strip() != s or s == "":
            return None
        return float(s)
    except ValueError:
        return None


def num_cmp(a, b):
    nums_a = [parse_number(x) for x in a]
    nums_b = [parse_number(x) for x in b]
    ia = ib = 0
    while True:
        na = nums_a[ia] if ia < len(nums_a) and nums_a[ia] is not None else None
        nb = nums_b[ib] if ib < len(nums_b) and nums_b[ib] is not None else None
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
        ia += 1
        ib += 1


def cmd_sort(argv):
    p = build_parser("xsv sort")
    p.add_argument("-s", "--select")
    p.add_argument("-N", "--numeric", action="store_true")
    p.add_argument("-R", "--reverse", action="store_true")
    add_common(p, output=True, no_headers=True)
    p.add_argument("input", nargs="?")
    ns = parse_args(p, argv)
    headers, records, _ = read_csv(ns.input, ns.delimiter, ns.no_headers)
    sel = SelectColumns.parse(ns.select).selection(headers, not ns.no_headers)

    def cmp_rows(r1, r2):
        a, b = selected(r1, sel), selected(r2, sel)
        c = num_cmp(a, b) if ns.numeric else lex_cmp(a, b)
        return -c if ns.reverse else c

    out_records = sorted(records, key=cmp_to_key(cmp_rows))
    out = []
    if not ns.no_headers and headers:
        out.append(headers)
    out.extend(out_records)
    write_csv(out, ns.output)


def condense(value, n):
    if n is None:
        return value
    if len(value) <= n:
        return value
    return value[:n] + "..."


def cmd_table(argv):
    p = build_parser("xsv table")
    p.add_argument("-w", "--width", type=int, default=2)
    p.add_argument("-p", "--pad", type=int, default=2)
    p.add_argument("-c", "--condense", type=int)
    add_common(p, output=True)
    p.add_argument("input", nargs="?")
    ns = parse_args(p, argv)
    _, _, rows = read_csv(ns.input, ns.delimiter, no_headers=True)
    rows = [[condense(f, ns.condense) for f in row] for row in rows]
    widths = []
    for row in rows:
        for i, field in enumerate(row):
            while len(widths) <= i:
                widths.append(ns.width)
            widths[i] = max(widths[i], len(field))
    lines = []
    for row in rows:
        if len(row) == 1 and row[0] == "":
            lines.append('""')
            continue
        pieces = []
        for i, field in enumerate(row):
            if i == len(row) - 1:
                pieces.append(field)
            else:
                pieces.append(field + " " * (widths[i] - len(field) + ns.pad))
        lines.append("".join(pieces))
    data = "\n".join(lines) + ("\n" if lines else "")
    write_bytes(encoded(data), ns.output)


def cmd_fmt(argv):
    p = build_parser("xsv fmt")
    p.add_argument("-t", "--out-delimiter", default=",")
    p.add_argument("--crlf", action="store_true")
    p.add_argument("--ascii", action="store_true")
    p.add_argument("--quote", default='"')
    p.add_argument("--quote-always", action="store_true")
    p.add_argument("--escape")
    add_common(p, output=True)
    p.add_argument("input", nargs="?")
    ns = parse_args(p, argv)
    out_delim = parse_delim(ns.out_delimiter)
    quote = parse_delim(ns.quote)
    escape = parse_delim(ns.escape)
    if ns.ascii:
        out_delim = "\x1f"
        term = "\x1e"
    else:
        term = "\r\n" if ns.crlf else "\n"
    _, _, rows = read_csv(ns.input, ns.delimiter, no_headers=True)
    write_csv(rows, ns.output, out_delim, term, quote, ns.quote_always, escape)


TYPE_NULL = "NULL"
TYPE_INT = "Integer"
TYPE_FLOAT = "Float"
TYPE_UNICODE = "Unicode"
TYPE_UNKNOWN = "Unknown"


def sample_type(s):
    if s == "":
        return TYPE_NULL
    if re.fullmatch(r"[+-]?[0-9]+", s):
        return TYPE_INT
    try:
        if s.strip() == s:
            float(s)
            return TYPE_FLOAT
    except ValueError:
        pass
    return TYPE_UNICODE


def merge_type(a, b):
    if a == TYPE_NULL:
        return b
    if b == TYPE_NULL:
        return a
    if a == TYPE_UNKNOWN or b == TYPE_UNKNOWN:
        return TYPE_UNKNOWN
    if a == b:
        return a
    if {a, b} == {TYPE_INT, TYPE_FLOAT}:
        return TYPE_FLOAT
    return TYPE_UNICODE


class ColStats:
    def __init__(self, include_nulls=False, median=False, mode=False, cardinality=False):
        self.typ = TYPE_NULL
        self.include_nulls = include_nulls
        self.want_median = median
        self.want_mode = mode
        self.want_cardinality = cardinality
        self.sum_int = 0
        self.sum_float = None
        self.strings = []
        self.lengths = []
        self.ints = []
        self.floats = []
        self.online = []
        self.medians = []
        self.counter = Counter()

    def add(self, sample):
        st = sample_type(sample)
        self.typ = merge_type(self.typ, st)
        self.lengths.append(len(encoded(sample)))
        if sample != "":
            self.strings.append(sample)
        t = self.typ
        if t == TYPE_FLOAT:
            if sample != "":
                v = float(sample)
                self.sum_float = (float(self.sum_int) if self.sum_float is None else self.sum_float) + v
                self.floats.append(v)
                self.ints.append(int(v))
        elif t == TYPE_INT:
            if sample != "":
                v = int(sample)
                if self.sum_float is None:
                    self.sum_int += v
                else:
                    self.sum_float += float(v)
                self.ints.append(v)
                self.floats.append(float(v))
        if self.want_mode or self.want_cardinality:
            self.counter[sample] += 1
        if t in (TYPE_INT, TYPE_FLOAT):
            if st == TYPE_NULL:
                if self.include_nulls:
                    self.online.append(0.0)
            else:
                v = float(sample)
                self.online.append(v)
                if self.want_median:
                    self.medians.append(v)
        elif t == TYPE_NULL and self.include_nulls:
            self.online.append(0.0)

    def minmax(self):
        if self.typ == TYPE_NULL:
            return "", ""
        if self.typ in (TYPE_UNICODE, TYPE_UNKNOWN):
            if not self.strings:
                return "", ""
            return min(self.strings), max(self.strings)
        if self.typ == TYPE_INT:
            if not self.ints:
                return "", ""
            return str(min(self.ints)), str(max(self.ints))
        if not self.floats:
            return "", ""
        return rust_float(min(self.floats)), rust_float(max(self.floats))

    def record(self):
        row = [self.typ]
        if self.typ == TYPE_INT:
            row.append(str(self.sum_int) if self.sum_float is None else rust_float(self.sum_float))
        elif self.typ == TYPE_FLOAT:
            row.append(rust_float(self.sum_float if self.sum_float is not None else 0.0))
        else:
            row.append("")
        mn, mx = self.minmax()
        row.extend([mn, mx])
        if self.lengths:
            row.extend([str(min(self.lengths)), str(max(self.lengths))])
        else:
            row.extend(["", ""])
        if self.typ in (TYPE_INT, TYPE_FLOAT) and self.online:
            mean = sum(self.online) / len(self.online)
            var = sum((x - mean) ** 2 for x in self.online) / len(self.online)
            row.extend([rust_float(mean), rust_float(math.sqrt(var))])
        else:
            row.extend(["", ""])
        if self.want_median:
            row.append(rust_float(statistics.median(self.medians)) if self.medians else "")
        if self.want_mode:
            if not self.counter:
                row.append("N/A")
            else:
                maxc = max(self.counter.values())
                values = [k for k, v in self.counter.items() if v == maxc]
                row.append(min(values) if maxc > 1 else "N/A")
        if self.want_cardinality:
            row.append(str(len(self.counter)))
        return row


def cmd_stats(argv):
    p = build_parser("xsv stats")
    p.add_argument("-s", "--select")
    p.add_argument("--everything", action="store_true")
    p.add_argument("--mode", action="store_true")
    p.add_argument("--cardinality", action="store_true")
    p.add_argument("--median", action="store_true")
    p.add_argument("--nulls", action="store_true")
    p.add_argument("-j", "--jobs", type=int, default=0)
    add_common(p, output=True, no_headers=True)
    p.add_argument("input", nargs="?")
    ns = parse_args(p, argv)
    headers, records, _ = read_csv(ns.input, ns.delimiter, ns.no_headers)
    sel = SelectColumns.parse(ns.select).selection(headers, not ns.no_headers)
    out_headers = selected(headers, sel)
    want_median = ns.median or ns.everything
    want_mode = ns.mode or ns.everything
    want_card = ns.cardinality or ns.everything
    stats = [ColStats(ns.nulls, want_median, want_mode, want_card) for _ in sel]
    for row in records:
        for j, idx in enumerate(sel):
            stats[j].add(row[idx])
    header = ["field", "type", "sum", "min", "max", "min_length", "max_length", "mean", "stddev"]
    if want_median:
        header.append("median")
    if want_mode:
        header.append("mode")
    if want_card:
        header.append("cardinality")
    out = [header]
    for i, (h, st) in enumerate(zip(out_headers, stats)):
        out.append([str(i) if ns.no_headers else h] + st.record())
    write_csv(out, ns.output)


def trimmed(value):
    return value.strip()


def cmd_frequency(argv):
    p = build_parser("xsv frequency")
    p.add_argument("-s", "--select")
    p.add_argument("-l", "--limit", type=int, default=10)
    p.add_argument("-a", "--asc", action="store_true")
    p.add_argument("--no-nulls", action="store_true")
    p.add_argument("-j", "--jobs", type=int, default=0)
    add_common(p, output=True, no_headers=True)
    p.add_argument("input", nargs="?")
    ns = parse_args(p, argv)
    headers, records, _ = read_csv(ns.input, ns.delimiter, ns.no_headers)
    sel = SelectColumns.parse(ns.select).selection(headers, not ns.no_headers)
    nsel = normal_selection(sel)
    out_headers = selected(headers, sel)
    counters = [Counter() for _ in nsel]
    for row in records:
        for j, idx in enumerate(nsel):
            value = trimmed(row[idx])
            if value == "":
                if not ns.no_nulls:
                    counters[j][""] += 1
            else:
                counters[j][value] += 1
    out = [["field", "value", "count"]]
    for i, counter in enumerate(counters):
        field = str(i + 1) if ns.no_headers else (out_headers[i] if i < len(out_headers) else headers[nsel[i]])
        items = list(counter.items())
        if ns.asc:
            items.sort(key=lambda kv: (kv[1], kv[0]))
        else:
            items.sort(key=lambda kv: (-kv[1], kv[0]))
        if ns.limit > 0:
            items = items[:ns.limit]
        for value, count in items:
            out.append([field, "(NULL)" if value == "" else value, str(count)])
    write_csv(out, ns.output)


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
        sys.stderr.buffer.write(encoded("xsv is a suite of CSV command line utilities.\n\nPlease choose one of the following commands:" + COMMAND_LIST))
        return 0
    if argv[0] == "--version":
        sys.stdout.buffer.write(b"0.13.0\n")
        return 0
    if argv[0] == "--list":
        sys.stdout.buffer.write(encoded("Installed commands:" + COMMAND_LIST))
        return 0
    if argv[0] in ("help", "--help", "-h"):
        sys.stdout.buffer.write(encoded("Usage:\n    xsv <command> [<args>...]\n    xsv [options]\n\nCommands:" + COMMAND_LIST))
        return 0
    cmd = argv.pop(0)
    if cmd not in COMMANDS:
        die("Unknown command: '{}'".format(cmd), 1)
    try:
        COMMANDS[cmd](argv)
        return 0
    except XsvError as e:
        die(e, 1)
    except BrokenPipeError:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
