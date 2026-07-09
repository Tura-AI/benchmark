import csv
import io
import math
import os
import re
import sys
from collections import Counter
from functools import cmp_to_key


VERSION = "0.13.0"


COMMANDS = """\
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


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        if not argv:
            ewrite("xsv is a suite of CSV command line utilities.\n\n")
            ewrite("Please choose one of the following commands:\n")
            ewrite(COMMANDS)
            return 0
        if argv[0] == "--version":
            write(VERSION + "\n")
            return 0
        if argv[0] == "--list":
            write("Installed commands:\n" + COMMANDS)
            return 0
        if argv[0] in ("-h", "--help", "help"):
            write(top_usage())
            return 0
        cmd, rest = argv[0], argv[1:]
        dispatch = {
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
        if cmd not in dispatch:
            ewrite("Invalid command '{}'.\n".format(cmd))
            return 1
        dispatch[cmd](rest)
        return 0
    except XsvError as e:
        ewrite(str(e) + "\n")
        return 1
    except BrokenPipeError:
        return 0


class XsvError(Exception):
    pass


def write(s):
    sys.stdout.buffer.write(s.encode("utf-8"))


def ewrite(s):
    sys.stderr.buffer.write(s.encode("utf-8"))


def top_usage():
    return """\
Usage:
    xsv <command> [<args>...]
    xsv [options]

Options:
    --list        List all commands available.
    -h, --help    Display this message
    <command> -h  Display the command help message
    --version     Print version info and exit

Commands:
""" + COMMANDS


def parse_delim(s):
    if s == r"\t":
        return "\t"
    if len(s) != 1 or ord(s) > 127:
        raise XsvError("Could not convert '{}' to a single ASCII character.".format(s))
    return s


def path_delim(path, override):
    if override is not None:
        return override
    if path and path != "-" and os.path.splitext(path)[1] == ".tsv":
        return "\t"
    return ","


def parse_common(args, has_no_headers=False, has_output=False, has_delim=True):
    out = {"no_headers": False, "output": None, "delimiter": None}
    rest = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--":
            rest.extend(args[i + 1:])
            break
        if has_no_headers and a in ("-n", "--no-headers"):
            out["no_headers"] = True
        elif has_output and a in ("-o", "--output"):
            i += 1
            if i >= len(args):
                raise XsvError("Flag {} needs an argument.".format(a))
            out["output"] = args[i]
        elif has_delim and a in ("-d", "--delimiter"):
            i += 1
            if i >= len(args):
                raise XsvError("Flag {} needs an argument.".format(a))
            out["delimiter"] = parse_delim(args[i])
        elif a.startswith("--delimiter=") and has_delim:
            out["delimiter"] = parse_delim(a.split("=", 1)[1])
        elif a in ("-h", "--help"):
            raise SystemExit(0)
        else:
            rest.append(a)
        i += 1
    return out, rest


def open_text_reader(path, delim):
    if path is None or path == "-":
        return sys.stdin, False
    try:
        return open(path, "r", encoding="utf-8-sig", newline=""), True
    except OSError as e:
        raise XsvError("failed to open {}: {}".format(path, e))


def read_rows(path=None, delimiter=None, no_headers=False):
    delim = path_delim(path, delimiter)
    f, close = open_text_reader(path, delim)
    try:
        rdr = csv.reader(f, delimiter=delim, quotechar='"', doublequote=True)
        return [row for row in rdr]
    except csv.Error as e:
        raise XsvError("CSV error: {}".format(e))
    finally:
        if close:
            f.close()


def writer_for(path=None, delimiter=",", lineterminator="\n", quotechar='"',
               quote_all=False, escapechar=None, doublequote=True):
    if path:
        f = open(path, "w", encoding="utf-8", newline="")
        close = True
    else:
        f = sys.stdout
        close = False
    w = csv.writer(
        f,
        delimiter=delimiter,
        quotechar=quotechar,
        lineterminator=lineterminator,
        quoting=csv.QUOTE_ALL if quote_all else csv.QUOTE_MINIMAL,
        escapechar=escapechar,
        doublequote=doublequote,
    )
    return w, f, close


def write_rows(rows, path=None, delimiter=",", lineterminator="\n",
               quotechar='"', quote_all=False, escapechar=None,
               doublequote=True):
    if not path:
        f = io.StringIO(newline="")
        w = csv.writer(
            f,
            delimiter=delimiter,
            quotechar=quotechar,
            lineterminator=lineterminator,
            quoting=csv.QUOTE_ALL if quote_all else csv.QUOTE_MINIMAL,
            escapechar=escapechar,
            doublequote=doublequote,
        )
        for row in rows:
            w.writerow(row)
        write(f.getvalue())
        return
    w, f, close = writer_for(path, delimiter, lineterminator, quotechar,
                             quote_all, escapechar, doublequote)
    try:
        for row in rows:
            w.writerow(row)
    finally:
        if close:
            f.close()


class SelectColumns:
    def __init__(self, raw=""):
        self.raw = "" if raw is None else raw
        self.invert = self.raw.startswith("!")
        self.s = self.raw[1:] if self.invert else self.raw
        self.selectors = self._parse()

    def _parse(self):
        chars = list(self.s)
        pos = 0
        sels = []

        def cur():
            return chars[pos] if pos < len(chars) else None

        def bump():
            nonlocal pos
            if pos < len(chars):
                pos += 1

        def is_end_field():
            c = cur()
            return c is None or c in ",-"

        def is_end_selector():
            c = cur()
            return c is None or c == ","

        def parse_name():
            name = []
            while not is_end_field() and cur() != "[":
                name.append(cur())
                bump()
            return "".join(name)

        def parse_quoted():
            name = []
            while True:
                c = cur()
                if c is None:
                    raise XsvError('Unclosed quote, missing closing ".')
                if c == '"':
                    bump()
                    if cur() == '"':
                        bump()
                        name.append('""')
                        continue
                    break
                name.append(c)
                bump()
            return "".join(name)

        def parse_index():
            bump()
            val = []
            while True:
                c = cur()
                if c is None:
                    raise XsvError("Unclosed index bracket, missing closing ].")
                if c == "]":
                    bump()
                    break
                val.append(c)
                bump()
            txt = "".join(val)
            try:
                return int(txt)
            except ValueError as e:
                detail = "cannot parse integer from empty string" if txt == "" else str(e)
                raise XsvError("Could not convert '{}' to an integer: {}".format(txt, detail))

        def parse_one():
            if cur() == '"':
                bump()
                name = parse_quoted()
            else:
                name = parse_name()
            if cur() == "[":
                return ("name", name, parse_index())
            try:
                return ("idx", int(name))
            except ValueError:
                return ("name", name, 0)

        while pos < len(chars):
            first = ("start",) if cur() == "-" else parse_one()
            second = None
            if cur() == "-":
                bump()
                second = ("end",) if is_end_selector() else parse_one()
            if not is_end_selector():
                raise XsvError("Expected end of field but got '{}' instead.".format(cur()))
            sels.append(("range", first, second) if second else ("one", first))
            bump()
        return sels

    def selection(self, first_record, use_names=True):
        if not self.selectors:
            return [] if self.invert else list(range(len(first_record)))
        out = []
        for sel in self.selectors:
            if sel[0] == "one":
                out.append(self._one_index(sel[1], first_record, use_names))
            else:
                i1 = self._one_index(sel[1], first_record, use_names)
                i2 = self._one_index(sel[2], first_record, use_names)
                step = 1 if i1 <= i2 else -1
                out.extend(range(i1, i2 + step, step))
        if self.invert:
            chosen = set(out)
            return [i for i in range(len(first_record)) if i not in chosen]
        return out

    def _one_index(self, sel, first_record, use_names):
        n = len(first_record)
        if sel[0] == "start":
            return 0
        if sel[0] == "end":
            return 0 if n == 0 else n - 1
        if sel[0] == "idx":
            i = sel[1]
            if i < 1 or i > n:
                raise XsvError("Selector index {} is out of bounds. Index must be >= 1 and <= {}.".format(i, n))
            return i - 1
        name, occurrence = sel[1], sel[2]
        if not use_names:
            raise XsvError("Cannot use names ('{}') in selection with --no-headers set.".format(name))
        found = 0
        for i, f in enumerate(first_record):
            if f == name:
                if found == occurrence:
                    return i
                found += 1
        if found == 0:
            raise XsvError("Selector name '{}' does not exist as a named header in the given CSV data.".format(name))
        raise XsvError("Selector index '{}' for name '{}' is out of bounds. Must be >= 0 and <= {}.".format(occurrence, name, found - 1))


def get_header_and_records(rows, no_headers):
    if not rows:
        return [], []
    if no_headers:
        return rows[0], rows
    return rows[0], rows[1:]


def pick(row, sel):
    return [row[i] if i < len(row) else "" for i in sel]


def cmd_headers(args):
    just = False
    intersect = False
    delim = None
    inputs = []
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("-j", "--just-names"):
            just = True
        elif a == "--intersect":
            intersect = True
        elif a in ("-d", "--delimiter"):
            i += 1; delim = parse_delim(args[i])
        else:
            inputs.append(a)
        i += 1
    if not inputs:
        inputs = [None]
    headers = []
    for inp in inputs:
        rows = read_rows(inp, delim, no_headers=True)
        if rows:
            for h in rows[0]:
                if (not intersect) or h not in headers:
                    headers.append(h)
    auto_just = just or len(inputs) > 1
    if auto_just:
        write("".join(h + "\n" for h in headers))
    else:
        width = len(str(len(headers)))
        lines = ["{}{}{}".format(i + 1, " " * (3 if width == 1 else 2), h)
                 for i, h in enumerate(headers)]
        write("\n".join(lines) + ("\n" if lines else ""))


def cmd_count(args):
    common, rest = parse_common(args, has_no_headers=True)
    path = rest[0] if rest else None
    rows = read_rows(path, common["delimiter"], common["no_headers"])
    n = len(rows) if common["no_headers"] else max(0, len(rows) - 1)
    write(str(n) + "\n")


def cmd_select(args):
    common, rest = parse_common(args, has_no_headers=True, has_output=True)
    if not rest:
        raise XsvError("Missing selection.")
    selection, path = rest[0], (rest[1] if len(rest) > 1 else None)
    rows = read_rows(path, common["delimiter"], common["no_headers"])
    if not rows:
        return
    first, records = get_header_and_records(rows, common["no_headers"])
    sel = SelectColumns(selection).selection(first, not common["no_headers"])
    out = []
    if not common["no_headers"]:
        out.append(pick(first, sel))
    out.extend(pick(r, sel) for r in records)
    write_rows(out, common["output"])


def parse_range_flags(args):
    common, rest = parse_common(args, has_no_headers=True, has_output=True)
    vals = {"start": None, "end": None, "len": None, "index": None}
    more = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-s", "--start", "-e", "--end", "-l", "--len", "-i", "--index"):
            key = {"-s": "start", "--start": "start", "-e": "end", "--end": "end",
                   "-l": "len", "--len": "len", "-i": "index", "--index": "index"}[a]
            i += 1
            vals[key] = int(rest[i])
        else:
            more.append(a)
        i += 1
    return common, vals, more


def util_range(start, end, length, index):
    if index is not None and start is None and end is None and length is None:
        return index, index + 1
    if index is not None:
        raise XsvError("--index cannot be used with --start, --end or --len")
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


def cmd_slice(args):
    common, vals, rest = parse_range_flags(args)
    path = rest[0] if rest else None
    rows = read_rows(path, common["delimiter"], common["no_headers"])
    header, records = get_header_and_records(rows, common["no_headers"])
    out = []
    if rows and not common["no_headers"] and header:
        out.append(header)
    try:
        s, e = util_range(vals["start"], vals["end"], vals["len"], vals["index"])
    except XsvError:
        if out:
            write_rows(out, common["output"])
        raise
    out.extend(records[s:e])
    write_rows(out, common["output"])


def cmd_search(args):
    common, rest = parse_common(args, has_no_headers=True, has_output=True)
    ignore = False
    invert = False
    selection = ""
    more = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-i", "--ignore-case"):
            ignore = True
        elif a in ("-v", "--invert-match"):
            invert = True
        elif a in ("-s", "--select"):
            i += 1; selection = rest[i]
        else:
            more.append(a)
        i += 1
    if not more:
        raise XsvError("Missing regex.")
    regex, path = more[0], (more[1] if len(more) > 1 else None)
    try:
        pat = re.compile(regex, re.I if ignore else 0)
    except re.error as e:
        raise XsvError(str(e))
    rows = read_rows(path, common["delimiter"], common["no_headers"])
    if not rows:
        return
    header, records = get_header_and_records(rows, common["no_headers"])
    sel = SelectColumns(selection).selection(header, not common["no_headers"])
    out = []
    if not common["no_headers"]:
        out.append(header)
    for r in records:
        m = any(pat.search(r[i] if i < len(r) else "") for i in sel)
        if invert:
            m = not m
        if m:
            out.append(r)
    write_rows(out, common["output"])


def cmp_lex(a, b):
    for x, y in zip(a, b):
        if x < y:
            return -1
        if x > y:
            return 1
    return (len(a) > len(b)) - (len(a) < len(b))


def parse_num(s):
    try:
        if re.fullmatch(r"[+-]?\d+", s):
            return int(s)
        return float(s)
    except ValueError:
        return None


def cmp_num(a, b):
    ia = ib = 0
    while True:
        if ia >= len(a) and ib >= len(b):
            return 0
        if ia >= len(a):
            return -1
        if ib >= len(b):
            return 1
        na, nb = parse_num(a[ia]), parse_num(b[ib])
        ia += 1; ib += 1
        if na is None and nb is None:
            continue
        if na is None:
            return -1
        if nb is None:
            return 1
        if na < nb:
            return -1
        if na > nb:
            return 1


def cmd_sort(args):
    common, rest = parse_common(args, has_no_headers=True, has_output=True)
    numeric = False
    reverse = False
    selection = ""
    more = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-N", "--numeric"):
            numeric = True
        elif a in ("-R", "--reverse"):
            reverse = True
        elif a in ("-s", "--select"):
            i += 1; selection = rest[i]
        else:
            more.append(a)
        i += 1
    path = more[0] if more else None
    rows = read_rows(path, common["delimiter"], common["no_headers"])
    if not rows:
        return
    header, records = get_header_and_records(rows, common["no_headers"])
    sel = SelectColumns(selection).selection(header, not common["no_headers"])
    cmpf = cmp_num if numeric else cmp_lex
    def rowcmp(r1, r2):
        c = cmpf(pick(r1, sel), pick(r2, sel))
        return -c if reverse else c
    records = sorted(records, key=cmp_to_key(rowcmp))
    out = ([] if common["no_headers"] else [header]) + records
    write_rows(out, common["output"])


def condense(s, n):
    if n is None:
        return s
    return s if len(s) <= n else s[:n] + "..."


def cmd_table(args):
    common, rest = parse_common(args, has_output=True)
    width, pad, cnd = 2, 2, None
    more = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-w", "--width"):
            i += 1; width = int(rest[i])
        elif a in ("-p", "--pad"):
            i += 1; pad = int(rest[i])
        elif a in ("-c", "--condense"):
            i += 1; cnd = int(rest[i])
        else:
            more.append(a)
        i += 1
    path = more[0] if more else None
    rows = [[condense(f, cnd) for f in r] for r in read_rows(path, common["delimiter"], True)]
    if not rows:
        return
    cols = max(len(r) for r in rows)
    widths = [width] * cols
    for r in rows:
        for i, f in enumerate(r):
            widths[i] = max(widths[i], len(f))
    lines = []
    for r in rows:
        parts = []
        for i in range(cols):
            f = r[i] if i < len(r) else ""
            if i == cols - 1:
                parts.append(f)
            else:
                parts.append(f + " " * (widths[i] - len(f) + pad))
        lines.append("".join(parts).rstrip())
    data = "\n".join(lines) + "\n"
    if common["output"]:
        with open(common["output"], "w", encoding="utf-8", newline="") as f:
            f.write(data)
    else:
        write(data)


def cmd_fmt(args):
    common, rest = parse_common(args, has_output=True)
    outdelim, crlf, ascii_mode = ",", False, False
    quote, quote_all, escape = '"', False, None
    more = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-t", "--out-delimiter"):
            i += 1; outdelim = parse_delim(rest[i])
        elif a == "--crlf":
            crlf = True
        elif a == "--ascii":
            ascii_mode = True
        elif a == "--quote":
            i += 1; quote = parse_delim(rest[i])
        elif a == "--quote-always":
            quote_all = True
        elif a == "--escape":
            i += 1; escape = parse_delim(rest[i])
        else:
            more.append(a)
        i += 1
    if ascii_mode:
        outdelim = "\x1f"
        term = "\x1e"
    else:
        term = "\r\n" if crlf else "\n"
    path = more[0] if more else None
    rows = read_rows(path, common["delimiter"], True)
    write_rows(rows, common["output"], outdelim, term, quote, quote_all, escape, escape is None)


def ftype(s):
    if s == "":
        return "NULL"
    try:
        int(s)
        return "Integer"
    except ValueError:
        pass
    try:
        float(s)
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
    if "Unknown" in (a, b):
        return "Unknown"
    return "Float"


def rust_float(x):
    if x == 0:
        return "0"
    if float(x).is_integer():
        return str(int(x))
    return str(x)


def cmd_stats(args):
    common, rest = parse_common(args, has_no_headers=True, has_output=True)
    mode = cardinality = median = nulls = everything = False
    selection = ""
    more = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-s", "--select"):
            i += 1; selection = rest[i]
        elif a == "--mode":
            mode = True
        elif a == "--cardinality":
            cardinality = True
        elif a == "--median":
            median = True
        elif a == "--nulls":
            nulls = True
        elif a == "--everything":
            everything = mode = cardinality = median = True
        elif a in ("-j", "--jobs"):
            i += 1
        else:
            more.append(a)
        i += 1
    path = more[0] if more else None
    rows = read_rows(path, common["delimiter"], common["no_headers"])
    if not rows:
        return
    header, records = get_header_and_records(rows, common["no_headers"])
    sel = SelectColumns(selection).selection(header, not common["no_headers"])
    heads = pick(header, sel)
    stat_heads = ["field", "type", "sum", "min", "max", "min_length", "max_length", "mean", "stddev"]
    if median: stat_heads.append("median")
    if mode: stat_heads.append("mode")
    if cardinality: stat_heads.append("cardinality")
    out = [stat_heads]
    for pos, col in enumerate(sel):
        vals = [r[col] if col < len(r) else "" for r in records]
        typ = "NULL"
        for v in vals:
            typ = merge_type(typ, ftype(v))
        nonempty = [v for v in vals if v != ""]
        nums = []
        nums_nonnull = []
        for v in vals:
            if v == "":
                if nulls and typ in ("Integer", "Float"):
                    nums.append(0.0)
            elif typ in ("Integer", "Float"):
                try:
                    fv = float(v)
                    nums.append(fv)
                    nums_nonnull.append(fv)
                except ValueError:
                    pass
        row = [str(pos) if common["no_headers"] else heads[pos], typ]
        if typ == "Integer":
            row.append(str(sum(int(v) for v in nonempty if ftype(v) == "Integer")))
        elif typ == "Float":
            row.append(rust_float(sum(float(v) for v in nonempty if ftype(v) in ("Integer", "Float"))))
        else:
            row.append("")
        if typ in ("Integer", "Float") and nums_nonnull:
            if typ == "Integer":
                row.extend([str(int(min(nums_nonnull))), str(int(max(nums_nonnull)))])
            else:
                row.extend([rust_float(min(nums_nonnull)), rust_float(max(nums_nonnull))])
        elif typ in ("Unicode", "Unknown") and nonempty:
            row.extend([min(nonempty), max(nonempty)])
        else:
            row.extend(["", ""])
        if vals:
            lens = [len(v.encode("utf-8")) for v in vals]
            row.extend([str(min(lens)), str(max(lens))])
        else:
            row.extend(["", ""])
        if typ in ("Integer", "Float") and nums:
            n = 0
            mean = 0.0
            m2 = 0.0
            for x in nums:
                n += 1
                delta = x - mean
                mean += delta / n
                m2 += delta * (x - mean)
            row.extend([rust_float(mean), rust_float(math.sqrt(m2 / n))])
        else:
            row.extend(["", ""])
        if median:
            if typ in ("Integer", "Float") and nums:
                sv = sorted(nums)
                m = sv[len(sv)//2] if len(sv) % 2 else (sv[len(sv)//2 - 1] + sv[len(sv)//2]) / 2
                row.append(rust_float(m))
            else:
                row.append("")
        if mode:
            c = Counter(vals)
            if not c:
                row.append("N/A")
            else:
                best = max(c.values())
                row.append("N/A" if best <= 1 else sorted([k for k, v in c.items() if v == best])[0])
        if cardinality:
            row.append(str(len(set(vals))))
        out.append(row)
    write_rows(out, common["output"])


def freq_order(counter, asc):
    items = list(counter.items())
    def tie_value(v):
        if v == "":
            return (0, "")
        if v == "(NULL)":
            return (2, v)
        return (1, v)
    if asc:
        items.sort(key=lambda kv: (kv[1], tie_value(kv[0])))
    else:
        items.sort(key=lambda kv: (-kv[1], tie_value(kv[0])))
    return items


def cmd_frequency(args):
    common, rest = parse_common(args, has_no_headers=True, has_output=True)
    selection = ""
    limit = 10
    asc = False
    no_nulls = False
    more = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-s", "--select"):
            i += 1; selection = rest[i]
        elif a in ("-l", "--limit"):
            i += 1; limit = int(rest[i])
        elif a in ("-a", "--asc"):
            asc = True
        elif a == "--no-nulls":
            no_nulls = True
        elif a in ("-j", "--jobs"):
            i += 1
        else:
            more.append(a)
        i += 1
    path = more[0] if more else None
    rows = read_rows(path, common["delimiter"], common["no_headers"])
    if not rows:
        write_rows([["field", "value", "count"]], common["output"])
        return
    header, records = get_header_and_records(rows, common["no_headers"])
    sel = SelectColumns(selection).selection(header, not common["no_headers"])
    heads = pick(header, sel)
    out = [["field", "value", "count"]]
    for pos, col in enumerate(sel):
        c = Counter()
        for r in records:
            v = (r[col] if col < len(r) else "").strip()
            if v == "" and no_nulls:
                continue
            c[v] += 1
        items = freq_order(c, asc)
        if limit > 0:
            items = items[:limit]
        field = str(pos + 1) if common["no_headers"] else heads[pos]
        for v, cnt in items:
            out.append([field, "(NULL)" if v == "" else v, str(cnt)])
    write_rows(out, common["output"])


if __name__ == "__main__":
    sys.exit(main())
