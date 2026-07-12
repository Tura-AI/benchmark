#!/usr/bin/env python3
import csv
import ctypes
import functools
import math
import os
import random
import re
import statistics
import sys
from collections import Counter

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="surrogateescape", newline="\n")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="surrogateescape", newline="\n")


COMMANDS = {
    "headers", "count", "select", "slice", "search", "sort", "table",
    "fmt", "stats", "frequency",
}

USAGE_LINES = {
    "headers": "    xsv headers [options] [<input>...]",
    "count": "    xsv count [options] [<input>]",
    "select": "    xsv select [options] [--] <selection> [<input>]",
    "slice": "    xsv slice [options] [<input>]",
    "search": "    xsv search [options] <regex> [<input>]",
    "sort": "    xsv sort [options] [<input>]",
    "table": "    xsv table [options] [<input>]",
    "fmt": "    xsv fmt [options] [<input>]",
    "stats": "    xsv stats [options] [<input>]",
    "frequency": "    xsv frequency [options] [<input>]",
}


class XsvError(Exception):
    pass


class UsageError(Exception):
    pass


class FlagError(Exception):
    def __init__(self, command, msg, show_usage=True):
        super().__init__(msg)
        self.command = command
        self.msg = msg
        self.show_usage = show_usage


def flag_error(command, msg):
    raise FlagError(command, msg)


def value_error(command, msg):
    raise FlagError(command, msg, False)


def unknown_flag(command, arg):
    flag_error(command, "Unknown flag: '%s'" % arg)


def parse_usize(command, flag, value):
    try:
        if value.startswith("-"):
            raise ValueError()
        return int(value)
    except Exception:
        value_error(command, "Could not deserialize '%s' to u64 for '%s'." % (value, flag))


def die(msg, code=1):
    if msg:
        sys.stderr.write(str(msg) + "\n")
    return code


def parse_delim(value):
    if value == r"\t":
        return "\t"
    if len(value) != 1 or ord(value) > 127:
        raise XsvError("Could not convert '%s' to a single ASCII character." % value)
    return value


def default_delim(path):
    if path and path != "-" and os.path.splitext(path)[1] == ".tsv":
        return "\t"
    return ","


def open_input(path):
    if path is None or path == "-":
        return sys.stdin
    try:
        return open(path, "r", encoding="utf-8-sig", errors="surrogateescape", newline="")
    except OSError as err:
        raise XsvError("failed to open %s: %s" % (path, os_error_text(err)))


def os_error_text(err):
    winerror = getattr(err, "winerror", None)
    if winerror is None and os.name == "nt" and getattr(err, "errno", None) == 2:
        winerror = 2
    if os.name == "nt" and winerror is not None:
        buf = ctypes.create_unicode_buffer(512)
        flags = 0x00001000 | 0x00000200
        n = ctypes.windll.kernel32.FormatMessageW(flags, None, winerror, 0, buf, len(buf), None)
        if n:
            return "%s (os error %d)" % (buf.value.strip(), winerror)
    return str(err)


def open_output(path):
    if path is None or path == "-":
        return sys.stdout
    return open(path, "w", encoding="utf-8", errors="surrogateescape", newline="")


def read_csv(path=None, delimiter=None, no_headers=False, flexible=False):
    delim = delimiter if delimiter is not None else default_delim(path)
    fh = open_input(path)
    close = fh is not sys.stdin
    try:
        reader = csv.reader(fh, delimiter=delim, quotechar='"', doublequote=True)
        rows = []
        expected = None
        for row in reader:
            if row and row[0].startswith("\ufeff"):
                row[0] = row[0].lstrip("\ufeff")
            if not flexible:
                if expected is None:
                    expected = len(row)
                elif len(row) != expected:
                    raise XsvError("CSV error: found record with %d fields, but the previous record has %d fields" % (len(row), expected))
            rows.append(row)
        if no_headers:
            headers = rows[0][:] if rows else []
            data = rows
        else:
            headers = rows[0][:] if rows else []
            data = rows[1:] if rows else []
        return headers, data
    finally:
        if close:
            fh.close()


def make_writer(path=None, delimiter=",", lineterminator="\n", quotechar='"',
                quote_all=False, escapechar=None, doublequote=True):
    fh = open_output(path)
    writer = csv.writer(
        fh,
        delimiter=delimiter,
        quotechar=quotechar,
        lineterminator=lineterminator,
        quoting=csv.QUOTE_ALL if quote_all else csv.QUOTE_MINIMAL,
        escapechar=escapechar,
        doublequote=doublequote,
    )
    return fh, writer


def write_rows(rows, path=None, delimiter=",", **kwargs):
    fh, writer = make_writer(path, delimiter, **kwargs)
    for row in rows:
        writer.writerow(row if row else [""])
    if fh is not sys.stdout:
        fh.close()


class SelectorParser:
    def __init__(self, text):
        self.text = text[1:] if text.startswith("!") else text
        self.invert = text.startswith("!")
        self.pos = 0

    def cur(self):
        return self.text[self.pos] if self.pos < len(self.text) else None

    def bump(self):
        self.pos += 1

    def is_end_field(self):
        return self.cur() is None or self.cur() in ",-"

    def is_end_selector(self):
        return self.cur() is None or self.cur() == ","

    def parse(self):
        selectors = []
        while self.cur() is not None:
            first = "start" if self.cur() == "-" else self.parse_one()
            second = None
            if self.cur() == "-":
                self.bump()
                second = "end" if self.is_end_selector() else self.parse_one()
            if not self.is_end_selector():
                raise XsvError("Expected end of field but got '%s' instead." % self.cur())
            selectors.append((first, second))
            if self.cur() == ",":
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
            return ("index", int(name))
        except ValueError:
            return ("name", name, 0)

    def parse_name(self):
        out = []
        while self.cur() is not None and not self.is_end_field() and self.cur() != "[":
            out.append(self.cur())
            self.bump()
        return "".join(out)

    def parse_quoted_name(self):
        out = []
        while True:
            c = self.cur()
            if c is None:
                raise XsvError("Unclosed quote, missing closing '" + '"' + "'.")
            if c == '"':
                self.bump()
                return "".join(out)
            out.append(c)
            self.bump()

    def parse_index(self):
        self.bump()
        digits = []
        while self.cur() is not None and self.cur() != "]":
            digits.append(self.cur())
            self.bump()
        if self.cur() != "]":
            raise XsvError("Unclosed '['.")
        self.bump()
        raw = "".join(digits)
        try:
            return int(raw)
        except ValueError:
            raise XsvError("Could not parse '%s' as a valid index." % raw)


class SelectColumns:
    def __init__(self, selectors, invert=False):
        self.selectors = selectors
        self.invert = invert

    def selection(self, headers, use_names=True):
        if not self.selectors:
            base = [] if self.invert else list(range(len(headers)))
            return base
        out = []
        for first, second in self.selectors:
            if second is None:
                out.append(self.one_index(first, headers, use_names))
            else:
                s = 0 if first == "start" else self.one_index(first, headers, use_names)
                e = len(headers) - 1 if second == "end" else self.one_index(second, headers, use_names)
                step = 1 if s <= e else -1
                out.extend(range(s, e + step, step))
        if self.invert:
            excluded = set(out)
            return [i for i in range(len(headers)) if i not in excluded]
        return out

    def one_index(self, sel, headers, use_names):
        if sel == "start":
            return 0
        if sel == "end":
            return len(headers) - 1
        kind = sel[0]
        if kind == "index":
            i = sel[1]
            if i < 1 or i > len(headers):
                raise XsvError("Selector index %s is out of bounds. Index must be >= 1 and <= %d." % (i, len(headers)))
            return i - 1
        name, want = sel[1], sel[2]
        if not use_names:
            raise XsvError("Cannot use names ('%s') in selection with --no-headers set." % name)
        found = [i for i, h in enumerate(headers) if h == name]
        if not found:
            raise XsvError("Selector name '%s' does not exist as a named header in the given CSV data." % name)
        if want < 0 or want >= len(found):
            raise XsvError("Selector index '%s' for name '%s' is out of bounds. Must be >= 0 and <= %d." % (want, name, len(found) - 1))
        return found[want]


def parse_selection(text):
    return SelectorParser(text or "").parse()


def regex_error(pattern):
    if pattern == "[":
        raise XsvError("Syntax(\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\nregex parse error:\n    [\n    ^\nerror: unclosed character class\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n)")
    raise XsvError("Syntax(\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\nregex parse error:\n    %s\nerror: invalid regex\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n)" % pattern)


def split_common(argv, need_selection=False):
    opts = {
        "input": None, "output": None, "no_headers": False, "delimiter": None,
        "select": "",
    }
    rest = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--":
            rest.extend(argv[i + 1:])
            break
        if a in ("-n", "--no-headers"):
            opts["no_headers"] = True
        elif a in ("-o", "--output"):
            i += 1; opts["output"] = argv[i]
        elif a in ("-d", "--delimiter"):
            i += 1; opts["delimiter"] = parse_delim(argv[i])
        elif a in ("-s", "--select"):
            i += 1; opts["select"] = argv[i]
        elif a in ("-h", "--help"):
            raise UsageError()
        elif a.startswith("-") and a != "-":
            unknown_flag(CURRENT_COMMAND, a)
        else:
            rest.append(a)
        i += 1
    if rest:
        opts["input"] = rest[-1]
        if need_selection:
            opts["selection_arg"] = rest[0]
    return opts, rest


def cmd_headers(argv):
    just = False; intersect = False; delim = None; inputs = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-j", "--just-names"):
            just = True
        elif a == "--intersect":
            intersect = True
        elif a in ("-d", "--delimiter"):
            i += 1; delim = parse_delim(argv[i])
        elif a in ("-h", "--help"):
            return 0
        elif a.startswith("-") and a != "-":
            unknown_flag("headers", a)
        else:
            inputs.append(a)
        i += 1
    if not inputs:
        inputs = [None]
    if sum(1 for p in inputs if p in (None, "-")) > 1:
        raise XsvError("At most one <stdin> input is allowed.")
    vals = []
    for path in inputs:
        headers, _ = read_csv(path, delim, no_headers=False)
        for h in headers:
            if not intersect or h not in vals:
                vals.append(h)
    if len(inputs) > 1:
        just = True
    for i, h in enumerate(vals, 1):
        if just:
            sys.stdout.write(h + "\n")
        else:
            sys.stdout.write("%d   %s\n" % (i, h))
    return 0


def cmd_count(argv):
    opts, _ = split_common(argv)
    _, data = read_csv(opts["input"], opts["delimiter"], opts["no_headers"])
    sys.stdout.write(str(len(data)) + "\n")
    return 0


def cmd_select(argv):
    opts, rest = split_common(argv, need_selection=True)
    if not rest:
        raise XsvError("Invalid arguments.")
    selection_text = rest[0]
    input_path = rest[1] if len(rest) > 1 else None
    headers, data = read_csv(input_path, opts["delimiter"], opts["no_headers"])
    sel = parse_selection(selection_text).selection(headers, not opts["no_headers"])
    rows = []
    if not opts["no_headers"] and headers:
        rows.append([headers[i] for i in sel])
    rows.extend([[row[i] for i in sel] for row in data])
    write_rows(rows, opts["output"])
    return 0


def calc_range(start, end, length, index):
    if index is not None:
        if start is not None or end is not None or length is not None:
            raise XsvError("--index cannot be used with --start, --end or --len")
        return index, index + 1
    if end is not None and length is not None:
        raise XsvError("--end and --len cannot be used at the same time.")
    s = start or 0
    if end is not None:
        if s > end:
            raise XsvError("The end of the range (%d) must be greater than or\nequal to the start of the range (%d)." % (end, s))
        return s, end
    if length is not None:
        return s, s + length
    return s, None


def cmd_slice(argv):
    start = end = length = index = None
    opts, rest = split_common([])
    inputs = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-s", "--start"):
            i += 1; start = parse_usize("slice", "--start", argv[i])
        elif a in ("-e", "--end"):
            i += 1; end = parse_usize("slice", "--end", argv[i])
        elif a in ("-l", "--len"):
            i += 1; length = parse_usize("slice", "--len", argv[i])
        elif a in ("-i", "--index"):
            i += 1; index = parse_usize("slice", "--index", argv[i])
        elif a in ("-o", "--output"):
            i += 1; opts["output"] = argv[i]
        elif a in ("-n", "--no-headers"):
            opts["no_headers"] = True
        elif a in ("-d", "--delimiter"):
            i += 1; opts["delimiter"] = parse_delim(argv[i])
        elif a.startswith("-") and a != "-":
            unknown_flag("slice", a)
        else:
            inputs.append(a)
        i += 1
    path = inputs[-1] if inputs else None
    headers, data = read_csv(path, opts["delimiter"], opts["no_headers"])
    rows = []
    if not opts["no_headers"] and headers:
        rows.append(headers)
    try:
        s, e = calc_range(start, end, length, index)
    except XsvError:
        if rows:
            write_rows(rows, opts["output"])
        raise
    rows.extend(data[s:e])
    write_rows(rows, opts["output"])
    return 0


def cmd_search(argv):
    ignore = False; invert = False
    extra = []
    opts = {"input": None, "output": None, "no_headers": False, "delimiter": None, "select": ""}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-i", "--ignore-case"):
            ignore = True
        elif a in ("-v", "--invert-match"):
            invert = True
        elif a in ("-s", "--select"):
            i += 1; opts["select"] = argv[i]
        elif a in ("-o", "--output"):
            i += 1; opts["output"] = argv[i]
        elif a in ("-n", "--no-headers"):
            opts["no_headers"] = True
        elif a in ("-d", "--delimiter"):
            i += 1; opts["delimiter"] = parse_delim(argv[i])
        elif a.startswith("-") and a != "-":
            unknown_flag("search", a)
        else:
            extra.append(a)
        i += 1
    if not extra:
        raise XsvError("Invalid arguments.")
    try:
        pattern = re.compile(extra[0], re.I if ignore else 0)
    except re.error:
        regex_error(extra[0])
    path = extra[1] if len(extra) > 1 else None
    headers, data = read_csv(path, opts["delimiter"], opts["no_headers"])
    sel = parse_selection(opts["select"]).selection(headers, not opts["no_headers"])
    rows = []
    if not opts["no_headers"] and headers:
        rows.append(headers)
    for row in data:
        m = any(pattern.search(row[i]) is not None for i in sel)
        if invert:
            m = not m
        if m:
            rows.append(row)
    write_rows(rows, opts["output"])
    return 0


def cmp_rows(a, b, sel, numeric=False):
    if numeric:
        for i in sel:
            av = parse_number(a[i])
            bv = parse_number(b[i])
            if av is None and bv is None:
                return 0
            if av is None:
                return -1
            if bv is None:
                return 1
            if av < bv:
                return -1
            if av > bv:
                return 1
        return 0
    for i in sel:
        av = a[i]; bv = b[i]
        if av < bv:
            return -1
        if av > bv:
            return 1
    return 0


def parse_number(s):
    try:
        if re.fullmatch(r"[+-]?\d+", s):
            return int(s)
        return float(s)
    except ValueError:
        return None


def cmd_sort(argv):
    numeric = False; reverse = False
    opts, rest = split_common([])
    inputs = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-N", "--numeric"):
            numeric = True
        elif a in ("-R", "--reverse"):
            reverse = True
        elif a in ("-s", "--select"):
            i += 1; opts["select"] = argv[i]
        elif a in ("-o", "--output"):
            i += 1; opts["output"] = argv[i]
        elif a in ("-n", "--no-headers"):
            opts["no_headers"] = True
        elif a in ("-d", "--delimiter"):
            i += 1; opts["delimiter"] = parse_delim(argv[i])
        elif a.startswith("-") and a != "-":
            unknown_flag("sort", a)
        else:
            inputs.append(a)
        i += 1
    path = inputs[-1] if inputs else None
    headers, data = read_csv(path, opts["delimiter"], opts["no_headers"])
    sel = parse_selection(opts["select"]).selection(headers, not opts["no_headers"])
    data.sort(key=functools.cmp_to_key(lambda a, b: cmp_rows(a, b, sel, numeric)))
    if reverse:
        data.reverse()
    rows = []
    if not opts["no_headers"] and headers:
        rows.append(headers)
    rows.extend(data)
    write_rows(rows, opts["output"])
    return 0


def condense(value, n):
    if n is None:
        return value
    return value if len(value) <= n else value[:n] + "..."


def quote_field(value, delimiter=","):
    needs = delimiter in value or '"' in value or "\n" in value or "\r" in value
    if needs:
        return '"' + value.replace('"', '""') + '"'
    return value


def cmd_table(argv):
    width = 2; pad = 2; cond = None; opts = {"input": None, "output": None, "delimiter": None}
    inputs = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-w", "--width"):
            i += 1; width = parse_usize("table", "--width", argv[i])
        elif a in ("-p", "--pad"):
            i += 1; pad = parse_usize("table", "--pad", argv[i])
        elif a in ("-c", "--condense"):
            i += 1; cond = parse_usize("table", "--condense", argv[i])
        elif a in ("-o", "--output"):
            i += 1; opts["output"] = argv[i]
        elif a in ("-d", "--delimiter"):
            i += 1; opts["delimiter"] = parse_delim(argv[i])
        elif a.startswith("-") and a != "-":
            unknown_flag("table", a)
        else:
            inputs.append(a)
        i += 1
    path = inputs[-1] if inputs else None
    _, rows = read_csv(path, opts["delimiter"], no_headers=True)
    rows = [[quote_field(condense(f, cond), "\t") for f in row] for row in rows]
    rows = [["\"\""] if len(row) == 1 and row[0] == "" else row for row in rows]
    cols = max((len(r) for r in rows), default=0)
    widths = []
    for c in range(cols):
        widths.append(max([width] + [len(r[c]) for r in rows if c < len(r)]))
    out = open_output(opts["output"])
    for row in rows:
        pieces = []
        for c, f in enumerate(row):
            if c == len(row) - 1:
                pieces.append(f)
            else:
                pieces.append(f + " " * (widths[c] - len(f) + pad))
        out.write("".join(pieces) + "\n")
    if out is not sys.stdout:
        out.close()
    return 0


def cmd_fmt(argv):
    out_delim = None; crlf = False; ascii_mode = False; quote = '"'; quote_all = False; escape = None
    opts = {"input": None, "output": None, "delimiter": None}
    inputs = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-t", "--out-delimiter"):
            i += 1; out_delim = parse_delim(argv[i])
        elif a == "--crlf":
            crlf = True
        elif a == "--ascii":
            ascii_mode = True
        elif a == "--quote":
            i += 1; quote = parse_delim(argv[i])
        elif a == "--quote-always":
            quote_all = True
        elif a == "--escape":
            i += 1; escape = parse_delim(argv[i])
        elif a in ("-o", "--output"):
            i += 1; opts["output"] = argv[i]
        elif a in ("-d", "--delimiter"):
            i += 1; opts["delimiter"] = parse_delim(argv[i])
        elif a.startswith("-") and a != "-":
            unknown_flag("fmt", a)
        else:
            inputs.append(a)
        i += 1
    path = inputs[-1] if inputs else None
    _, rows = read_csv(path, opts["delimiter"], no_headers=True)
    delim = "\x1f" if ascii_mode else (out_delim or ",")
    term = "\x1e" if ascii_mode else ("\r\n" if crlf else "\n")
    write_rows(rows, opts["output"], delimiter=delim, lineterminator=term,
               quotechar=quote, quote_all=quote_all, escapechar=escape,
               doublequote=(escape is None))
    return 0


def type_of(s):
    if s == "":
        return "NULL"
    try:
        int(s)
        if re.fullmatch(r"[+-]?\d+", s):
            return "Integer"
    except ValueError:
        pass
    try:
        float(s)
        return "Float"
    except ValueError:
        return "Unicode"


def merge_type(cur, nxt):
    if cur == "NULL":
        return nxt
    if nxt == "NULL":
        return cur
    if cur == nxt:
        return cur
    if cur == "Unknown" or nxt == "Unknown":
        return "Unknown"
    if {cur, nxt} == {"Integer", "Float"}:
        return "Float"
    return "Unicode"


def rust_float(v):
    if v is None:
        return ""
    if isinstance(v, float):
        if math.isnan(v):
            return "NaN"
        if math.isinf(v):
            return "inf" if v > 0 else "-inf"
        if v == 0:
            return "0"
        if v.is_integer():
            return str(int(v))
    return str(v)


def stats_for(values, want_median, want_mode, want_card, include_nulls):
    typ = "NULL"
    int_sum = 0; float_sum = None
    strings = []; lengths = []; nums = []; median_nums = []; modes = []
    for v in values:
        vt = type_of(v)
        typ = merge_type(typ, vt)
        lengths.append(len(v.encode("utf-8", "surrogateescape")))
        if v != "":
            strings.append(v)
        modes.append(v)
        if typ == "Float" and v != "":
            f = float(v)
            float_sum = (float(int_sum) if float_sum is None else float_sum) + f
        elif typ == "Integer" and v != "":
            if float_sum is None:
                int_sum += int(v)
            else:
                float_sum += float(v)
        if typ in ("Integer", "Float"):
            if vt == "NULL":
                if include_nulls:
                    nums.append(0.0)
            elif vt in ("Integer", "Float"):
                f = float(v)
                nums.append(f)
                median_nums.append(f)
    out = [typ]
    if typ == "Integer":
        out.append(str(int_sum))
    elif typ == "Float":
        out.append(rust_float(float_sum if float_sum is not None else 0.0))
    else:
        out.append("")
    if typ in ("Integer", "Float"):
        parsed = [float(x) for x in strings]
        if typ == "Integer":
            out += [str(int(min(parsed))) if parsed else "", str(int(max(parsed))) if parsed else ""]
        else:
            out += [rust_float(min(parsed)) if parsed else "", rust_float(max(parsed)) if parsed else ""]
    elif typ in ("Unicode", "Unknown") and strings:
        out += [min(strings), max(strings)]
    else:
        out += ["", ""]
    out += [str(min(lengths)) if lengths else "", str(max(lengths)) if lengths else ""]
    if typ in ("Integer", "Float") and nums:
        mean = sum(nums) / len(nums)
        var = sum((x - mean) ** 2 for x in nums) / len(nums)
        out += [rust_float(mean), rust_float(math.sqrt(var))]
    else:
        out += ["", ""]
    if want_median:
        out.append(rust_float(statistics.median(median_nums)) if median_nums else "")
    if want_mode:
        c = Counter(modes)
        if c:
            val, n = max(c.items(), key=lambda kv: (kv[1], kv[0]))
            tied = sum(1 for x in c.values() if x == n)
            out.append(val if n > 1 and tied == 1 else "N/A")
        else:
            out.append("N/A")
    if want_card:
        out.append(str(len(set(modes))))
    return out


def cmd_stats(argv):
    everything = mode = card = median = nulls = False
    opts, rest = split_common([])
    inputs = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--everything": everything = True
        elif a == "--mode": mode = True
        elif a == "--cardinality": card = True
        elif a == "--median": median = True
        elif a == "--nulls": nulls = True
        elif a in ("-j", "--jobs"):
            i += 1; parse_usize("stats", "--jobs", argv[i])
        elif a in ("-s", "--select"):
            i += 1; opts["select"] = argv[i]
        elif a in ("-o", "--output"):
            i += 1; opts["output"] = argv[i]
        elif a in ("-n", "--no-headers"):
            opts["no_headers"] = True
        elif a in ("-d", "--delimiter"):
            i += 1; opts["delimiter"] = parse_delim(argv[i])
        elif a.startswith("-") and a != "-":
            unknown_flag("stats", a)
        else:
            inputs.append(a)
        i += 1
    path = inputs[-1] if inputs else None
    headers, data = read_csv(path, opts["delimiter"], opts["no_headers"])
    sel = parse_selection(opts["select"]).selection(headers, not opts["no_headers"])
    heads = [headers[i] for i in sel]
    cols = [[row[i] for row in data] for i in sel]
    want_median = median or everything; want_mode = mode or everything; want_card = card or everything
    stat_headers = ["field", "type", "sum", "min", "max", "min_length", "max_length", "mean", "stddev"]
    if want_median: stat_headers.append("median")
    if want_mode: stat_headers.append("mode")
    if want_card: stat_headers.append("cardinality")
    rows = [stat_headers]
    for idx, (h, vals) in enumerate(zip(heads, cols)):
        field = str(idx) if opts["no_headers"] else h
        rows.append([field] + stats_for(vals, want_median, want_mode, want_card, nulls))
    write_rows(rows, opts["output"])
    return 0


def cmd_frequency(argv):
    limit = 10; asc = False; no_nulls = False
    opts, rest = split_common([])
    inputs = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-l", "--limit"):
            i += 1; limit = parse_usize("frequency", "--limit", argv[i])
        elif a in ("-a", "--asc"):
            asc = True
        elif a == "--no-nulls":
            no_nulls = True
        elif a in ("-j", "--jobs"):
            i += 1; parse_usize("frequency", "--jobs", argv[i])
        elif a in ("-s", "--select"):
            i += 1; opts["select"] = argv[i]
        elif a in ("-o", "--output"):
            i += 1; opts["output"] = argv[i]
        elif a in ("-n", "--no-headers"):
            opts["no_headers"] = True
        elif a in ("-d", "--delimiter"):
            i += 1; opts["delimiter"] = parse_delim(argv[i])
        elif a.startswith("-") and a != "-":
            unknown_flag("frequency", a)
        else:
            inputs.append(a)
        i += 1
    path = inputs[-1] if inputs else None
    headers, data = read_csv(path, opts["delimiter"], opts["no_headers"])
    sel = parse_selection(opts["select"]).selection(headers, not opts["no_headers"])
    rows = [["field", "value", "count"]]
    for pos, col in enumerate(sel):
        field = str(pos + 1) if opts["no_headers"] else headers[col]
        counts = Counter()
        for row in data:
            val = row[col].strip()
            if val == "" and no_nulls:
                continue
            counts[val] += 1
        items = sorted(counts.items(), key=lambda kv: (kv[1], kv[0]), reverse=not asc)
        if asc:
            items = sorted(counts.items(), key=lambda kv: (kv[1], kv[0]))
        if limit > 0:
            items = items[:limit]
        for val, count in items:
            rows.append([field, "(NULL)" if val == "" else val, str(count)])
    write_rows(rows, opts["output"])
    return 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        sys.stderr.write("xsv is a suite of CSV command line utilities.\n")
        return 0
    if argv[0] in ("--version", "-V"):
        sys.stdout.write("0.13.0\n")
        return 0
    if argv[0] == "--list":
        sys.stdout.write("Installed commands:\n")
        for c in sorted(COMMANDS):
            sys.stdout.write("    %s\n" % c)
        return 0
    cmd = argv[0]
    if cmd == "help":
        sys.stdout.write("Usage:\n    xsv <command> [<args>...]\n")
        return 0
    if cmd not in COMMANDS:
        return die("Unknown command: %s" % cmd, 1)
    global CURRENT_COMMAND
    CURRENT_COMMAND = cmd
    try:
        return globals()["cmd_" + cmd](argv[1:])
    except UsageError:
        return 0
    except FlagError as err:
        if err.show_usage:
            sys.stderr.write(err.msg + "\n\nUsage:\n" + USAGE_LINES.get(err.command, "") + "\n")
        else:
            sys.stderr.write(err.msg + "\n")
        return 1
    except BrokenPipeError:
        return 0
    except (XsvError, OSError, re.error, ValueError, IndexError) as err:
        return die(err, 1)


if __name__ == "__main__":
    raise SystemExit(main())
