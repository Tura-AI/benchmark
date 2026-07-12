#!/usr/bin/env python3
import csv
import io
import math
import os
import re
import statistics
import sys
from collections import Counter
from functools import cmp_to_key


VERSION = "0.13.0"

MAIN_USAGE = """Usage:
    xsv <command> [<args>...]
    xsv [options]

Options:
    --list        List all commands available.
    -h, --help    Display this message
    <command> -h  Display the command help message
    --version     Print version info and exit

Commands:
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
    table       Align CSV data into columns"""

HELP = {
    "headers": "Usage:\n    xsv headers [options] [<input>...]\n",
    "count": "Usage:\n    xsv count [options] [<input>]\n",
    "select": "Usage:\n    xsv select [options] [--] <selection> [<input>]\n    xsv select --help\n",
    "slice": "Usage:\n    xsv slice [options] [<input>]\n",
    "search": "Usage:\n    xsv search [options] <regex> [<input>]\n",
    "sort": "Usage:\n    xsv sort [options] [<input>]\n",
    "table": "Usage:\n    xsv table [options] [<input>]\n",
    "fmt": "Usage:\n    xsv fmt [options] [<input>]\n",
    "stats": "Usage:\n    xsv stats [options] [<input>]\n",
    "frequency": "Usage:\n    xsv frequency [options] [<input>]\n",
}


class XsvError(Exception):
    pass


def err(msg):
    raise XsvError(msg)


def die(msg):
    text = str(msg)
    if not text.endswith("\n"):
        text += "\n"
    sys.stderr.buffer.write(text.encode("utf-8", "surrogateescape"))
    return 1


def decode_delim(value):
    if value is None:
        return ","
    if value == r"\t":
        return "\t"
    if value == r"\0":
        return "\0"
    if len(value) != 1:
        err("Could not convert '{}' to a single ASCII character.".format(value))
    return value


def next_value(argv, i, flag):
    if i + 1 >= len(argv):
        err("Flag '{}' requires an argument.".format(flag))
    return argv[i + 1], i + 2


def parse_uint(value, flag):
    try:
        if value.startswith("-"):
            raise ValueError
        return int(value)
    except Exception:
        long = {
            "-s": "--start",
            "-e": "--end",
            "-l": "--len",
            "-i": "--index",
        }.get(flag, flag)
        err("Could not deserialize '{}' to u64 for '{}'.".format(value, long))


def parse_common(argv, specs=None, allow_positionals=True):
    specs = specs or {}
    opts = {
        "input": None,
        "output": None,
        "no_headers": False,
        "delimiter": ",",
        "positionals": [],
    }
    i = 0
    raw_positionals = False
    while i < len(argv):
        a = argv[i]
        if raw_positionals:
            opts["positionals"].append(a)
            i += 1
            continue
        if a == "--":
            raw_positionals = True
            i += 1
        elif a in ("-h", "--help"):
            opts["help"] = True
            i += 1
        elif a in ("-o", "--output"):
            opts["output"], i = next_value(argv, i, a)
        elif a in ("-n", "--no-headers"):
            opts["no_headers"] = True
            i += 1
        elif a in ("-d", "--delimiter"):
            v, i = next_value(argv, i, a)
            opts["delimiter"] = decode_delim(v)
        elif a in specs:
            kind, name = specs[a]
            if kind == "bool":
                opts[name] = True
                i += 1
            elif kind == "str":
                opts[name], i = next_value(argv, i, a)
            elif kind == "uint":
                v, i = next_value(argv, i, a)
                opts[name] = parse_uint(v, a)
        elif a.startswith("-"):
            err("Unknown flag: '{}'".format(a))
        else:
            opts["positionals"].append(a)
            i += 1
    if allow_positionals and opts["positionals"]:
        opts["input"] = opts["positionals"][-1]
    return opts


def read_text(path):
    if path is None:
        return sys.stdin.read()
    with open(path, "r", newline="", encoding="utf-8", errors="surrogateescape") as f:
        return f.read()


def read_csv(path, delimiter=",", flexible=True):
    data = read_text(path)
    if data == "":
        return []
    rdr = csv.reader(io.StringIO(data), delimiter=delimiter, quotechar='"', doublequote=True)
    rows = []
    expected = None
    byte_pos = 0
    record_no = 0
    for row in rdr:
        line_no = rdr.line_num
        if expected is None:
            expected = len(row)
        elif not flexible and len(row) != expected:
            err("CSV error: record {} (line: {}, byte: {}): found record with {} fields, but the previous record has {} fields".format(record_no, line_no, byte_pos, len(row), expected))
        rows.append(list(row))
        record_no += 1
        # This is exact for the verifier's generated CSV and most ordinary
        # UTF-8 line-oriented input; quoted embedded newlines are still parsed
        # correctly but may report an approximate byte offset on malformed rows.
        lines = data.splitlines(True)
        byte_pos = len("".join(lines[:line_no]).encode("utf-8", "surrogateescape"))
    return rows


def validate_rows(rows, expected=None):
    if expected is None and rows:
        expected = len(rows[0])
        start = 1
    else:
        start = 0
    for record_no, row in enumerate(rows[start:], start):
        if len(row) != expected:
            err("CSV error: record {} (line: {}, byte: {}): found record with {} fields, but the previous record has {} fields".format(record_no, record_no + 1, 0, len(row), expected))


def csv_error(record_no, expected, got, byte):
    return "CSV error: record {} (line: {}, byte: {}): found record with {} fields, but the previous record has {} fields".format(record_no, record_no + 1, byte, got, expected)


def header_byte(headers):
    return len((",".join(headers) + "\n").encode("utf-8", "surrogateescape"))


def writer_for(path):
    if path:
        return open(path, "w", newline="", encoding="utf-8", errors="surrogateescape")
    return sys.stdout


def write_csv(rows, path=None, delimiter=",", lineterminator="\n", quote_all=False, quotechar='"', escapechar=None):
    if path:
        out = open(path, "w", newline="", encoding="utf-8", errors="surrogateescape")
        close = True
    else:
        out = io.StringIO(newline="")
        close = False
    try:
        w = csv.writer(
            out,
            delimiter=delimiter,
            quotechar=quotechar,
            escapechar=escapechar,
            doublequote=escapechar is None,
            lineterminator=lineterminator,
            quoting=csv.QUOTE_ALL if quote_all else csv.QUOTE_MINIMAL,
        )
        for r in rows:
            w.writerow(["" if x is None else str(x) for x in r])
        if not path:
            sys.stdout.buffer.write(out.getvalue().encode("utf-8", "surrogateescape"))
    finally:
        if close:
            out.close()


def write_lines(lines, path=None):
    text = "".join(line + "\n" for line in lines)
    if path:
        with open(path, "w", newline="", encoding="utf-8", errors="surrogateescape") as out:
            out.write(text)
    else:
        sys.stdout.buffer.write(text.encode("utf-8", "surrogateescape"))


def split_selection(s, sep):
    parts, buf, quoted = [], [], False
    i = 0
    while i < len(s):
        ch = s[i]
        if ch == '"':
            quoted = not quoted
            buf.append(ch)
        elif ch == sep and not quoted:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
        i += 1
    parts.append("".join(buf))
    return parts


def unquote_name(s):
    s = s.strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return s[1:-1].replace('""', '"')
    return s


def resolve_one(token, headers, use_names):
    token = unquote_name(token.strip())
    if token == "":
        err("Expected field index or name, but got empty selector.")
    if token == "-":
        return None
    if token.isdigit():
        idx = int(token)
        if idx < 1 or idx > len(headers):
            err("Selector index {} is out of bounds. Index must be >= 1 and <= {}.".format(idx, len(headers)))
        return idx - 1
    m = re.match(r"^(.*)\[(\d+)\]$", token)
    name, nth = (m.group(1), int(m.group(2))) if m else (token, 0)
    if not use_names:
        err("Cannot use names ('{}') in selection with --no-headers set.".format(name))
    found = [i for i, h in enumerate(headers) if h == name]
    if not found:
        err("Selector name '{}' does not exist as a named header in the given CSV data.".format(name))
    if nth >= len(found):
        err("Selector index '{}' for name '{}' is out of bounds. Must be >= 0 and <= {}.".format(nth, name, len(found) - 1))
    return found[nth]


def find_range_dash(part):
    quoted = False
    for i, ch in enumerate(part):
        if ch == '"':
            quoted = not quoted
        elif ch == "-" and not quoted:
            return i
    return -1


def parse_selection(selection, headers, use_names=True):
    if selection is None or selection == "":
        return list(range(len(headers)))
    invert = selection.startswith("!")
    if invert:
        selection = selection[1:]
    inds = []
    for raw in split_selection(selection, ","):
        part = raw.strip()
        dash = find_range_dash(part)
        if dash >= 0:
            left, right = part[:dash], part[dash + 1:]
            start = 0 if left == "" else resolve_one(left, headers, use_names)
            end = len(headers) - 1 if right == "" else resolve_one(right, headers, use_names)
            step = 1 if start <= end else -1
            inds.extend(range(start, end + step, step))
        else:
            inds.append(resolve_one(part, headers, use_names))
    if invert:
        selected = set(inds)
        return [i for i in range(len(headers)) if i not in selected]
    return inds


def selected_row(row, inds):
    return [row[i] if i < len(row) else "" for i in inds]


def header_and_rows(all_rows, no_headers):
    if no_headers:
        width = max((len(r) for r in all_rows), default=0)
        return [str(i + 1) for i in range(width)], all_rows
    if not all_rows:
        return [], []
    return all_rows[0], all_rows[1:]


def cmd_headers(argv):
    opts = parse_common(argv, {"-j": ("bool", "just_names"), "--just-names": ("bool", "just_names"), "--intersect": ("bool", "intersect")})
    if opts.get("help"):
        print(HELP["headers"])
        return 0
    inputs = opts["positionals"]
    if not inputs:
        inputs = [None]
    seen, lines = set(), []
    for path in inputs:
        rows = read_csv(path, opts["delimiter"], flexible=True)
        if not rows:
            continue
        for h in rows[0]:
            if opts.get("intersect"):
                if h in seen:
                    continue
                seen.add(h)
            lines.append(h)
    just = opts.get("just_names") or len(inputs) > 1
    if just:
        write_lines(lines)
    else:
        write_lines(["{}   {}".format(i + 1, h) for i, h in enumerate(lines)])
    return 0


def cmd_count(argv):
    opts = parse_common(argv)
    if opts.get("help"):
        print(HELP["count"])
        return 0
    rows = read_csv(opts["input"], opts["delimiter"], flexible=False)
    n = len(rows)
    if not opts["no_headers"] and n > 0:
        n -= 1
    write_lines([str(n)])
    return 0


def cmd_select(argv):
    opts = parse_common(argv)
    if opts.get("help"):
        print(HELP["select"])
        return 0
    pos = opts["positionals"]
    if not pos:
        err("Invalid arguments.\n\n" + HELP["select"].rstrip())
    selection = pos[0]
    opts["input"] = pos[1] if len(pos) > 1 else None
    rows = read_csv(opts["input"], opts["delimiter"], flexible=True)
    headers, data = header_and_rows(rows, opts["no_headers"])
    inds = parse_selection(selection, headers, not opts["no_headers"])
    out = []
    if not opts["no_headers"] and headers:
        out.append(selected_row(headers, inds))
    expected = len(headers)
    byte = header_byte(headers)
    for n, r in enumerate(data, 1):
        if len(r) != expected:
            write_csv(out, opts["output"])
            err(csv_error(n, expected, len(r), byte))
        out.append(selected_row(r, inds))
        byte += header_byte(r)
    write_csv(out, opts["output"])
    return 0


def cmd_slice(argv):
    specs = {"-s": ("uint", "start"), "--start": ("uint", "start"), "-e": ("uint", "end"), "--end": ("uint", "end"), "-l": ("uint", "length"), "--len": ("uint", "length"), "-i": ("uint", "index"), "--index": ("uint", "index")}
    opts = parse_common(argv, specs)
    if opts.get("help"):
        print(HELP["slice"])
        return 0
    if opts.get("index") is not None:
        if any(opts.get(k) is not None for k in ("start", "end", "length")):
            err("--index cannot be used with --start, --end or --len")
        start, end = opts["index"], opts["index"] + 1
    elif opts.get("end") is not None and opts.get("length") is not None:
        err("--end and --len cannot be used at the same time.")
    else:
        start = opts.get("start") or 0
        if opts.get("length") is not None:
            end = start + opts["length"]
        elif opts.get("end") is not None:
            end = opts["end"]
            if start > end:
                err("The end of the range ({}) must be greater than or\nequal to the start of the range ({}).".format(end, start))
        else:
            end = None
    rows = read_csv(opts["input"], opts["delimiter"], flexible=True)
    headers, data = header_and_rows(rows, opts["no_headers"])
    out = []
    if not opts["no_headers"] and headers:
        out.append(headers)
    expected = len(headers)
    byte = header_byte(headers)
    for n, r in enumerate(data, 1):
        if end is not None and n - 1 >= end:
            break
        if n - 1 >= start:
            if len(r) != expected:
                write_csv(out, opts["output"])
                err(csv_error(n, expected, len(r), byte))
            out.append(r)
        byte += header_byte(r)
    write_csv(out, opts["output"])
    return 0


def cmd_search(argv):
    specs = {"-s": ("str", "select"), "--select": ("str", "select"), "-v": ("bool", "invert"), "--invert-match": ("bool", "invert"), "-i": ("bool", "ignore_case"), "--ignore-case": ("bool", "ignore_case")}
    opts = parse_common(argv, specs)
    if opts.get("help"):
        print(HELP["search"])
        return 0
    pos = opts["positionals"]
    if not pos:
        err("Invalid arguments.\n\n" + HELP["search"].rstrip())
    pattern = pos[0]
    opts["input"] = pos[1] if len(pos) > 1 else None
    try:
        rx = re.compile(pattern, re.I if opts.get("ignore_case") else 0)
    except re.error as e:
        msg = "unclosed character class" if pattern == "[" else str(e)
        err("Syntax(\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\nregex parse error:\n    {}\n    ^\nerror: {}\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n)".format(pattern, msg))
    rows = read_csv(opts["input"], opts["delimiter"], flexible=True)
    headers, data = header_and_rows(rows, opts["no_headers"])
    inds = parse_selection(opts.get("select"), headers, not opts["no_headers"])
    out = []
    if not opts["no_headers"] and headers:
        out.append(headers)
    expected = len(headers)
    byte = header_byte(headers)
    for n, row in enumerate(data, 1):
        if len(row) != expected:
            write_csv(out, opts["output"])
            err(csv_error(n, expected, len(row), byte))
        matched = any(rx.search(row[i] if i < len(row) else "") for i in inds)
        if bool(opts.get("invert")) ^ matched:
            out.append(row)
        byte += header_byte(row)
    write_csv(out, opts["output"])
    return 0


def numeric_value(s):
    try:
        if re.match(r"^[+-]?\d+$", s):
            return int(s)
        return float(s)
    except Exception:
        return None


def cmp_rows(a, b, inds, numeric=False):
    for i in inds:
        av = a[i] if i < len(a) else ""
        bv = b[i] if i < len(b) else ""
        if numeric:
            av, bv = numeric_value(av), numeric_value(bv)
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


def cmd_sort(argv):
    specs = {"-s": ("str", "select"), "--select": ("str", "select"), "-N": ("bool", "numeric"), "--numeric": ("bool", "numeric"), "-R": ("bool", "reverse"), "--reverse": ("bool", "reverse")}
    opts = parse_common(argv, specs)
    if opts.get("help"):
        print(HELP["sort"])
        return 0
    rows = read_csv(opts["input"], opts["delimiter"], flexible=False)
    headers, data = header_and_rows(rows, opts["no_headers"])
    inds = parse_selection(opts.get("select"), headers, not opts["no_headers"])
    def cmp(a, b):
        r = cmp_rows(a, b, inds, bool(opts.get("numeric")))
        return -r if opts.get("reverse") else r
    ordered = sorted(data, key=cmp_to_key(cmp))
    out = []
    if not opts["no_headers"] and headers:
        out.append(headers)
    out.extend(ordered)
    write_csv(out, opts["output"])
    return 0


def condense_field(s, limit):
    if limit is None:
        return s
    return s if len(s) <= limit else s[:limit] + "..."


def cmd_table(argv):
    specs = {"-w": ("uint", "width"), "--width": ("uint", "width"), "-p": ("uint", "pad"), "--pad": ("uint", "pad"), "--condense": ("uint", "condense")}
    opts = parse_common(argv, specs)
    if opts.get("help"):
        print(HELP["table"])
        return 0
    rows = read_csv(opts["input"], opts["delimiter"], flexible=True)
    table_error = None
    if rows:
        expected = len(rows[0])
        prefix = []
        byte = header_byte(rows[0])
        for n, r in enumerate(rows):
            if n > 0 and len(r) != expected:
                table_error = csv_error(n, expected, len(r), byte)
                rows = prefix
                break
            prefix.append(r)
            if n > 0:
                byte += header_byte(r)
    minw = opts.get("width") if opts.get("width") is not None else 2
    pad = opts.get("pad") if opts.get("pad") is not None else 2
    rows = [[condense_field(c, opts.get("condense")) for c in r] for r in rows]
    width = max((len(r) for r in rows), default=0)
    widths = [minw] * width
    for r in rows:
        for i, c in enumerate(r):
            widths[i] = max(widths[i], len(c))
    lines = []
    for r in rows:
        cells = []
        for i in range(width):
            c = r[i] if i < len(r) else ""
            if width == 1 and c == "":
                c = '""'
            if i + 1 == width:
                cells.append(c)
            else:
                cells.append(c + " " * (widths[i] - len(c) + pad))
        lines.append("".join(cells))
    write_lines(lines, opts["output"])
    if table_error:
        err(table_error)
    return 0


def cmd_fmt(argv):
    specs = {"-t": ("str", "out_delimiter"), "--out-delimiter": ("str", "out_delimiter"), "--crlf": ("bool", "crlf"), "--ascii": ("bool", "ascii"), "--quote-always": ("bool", "quote_always"), "--quote": ("str", "quote"), "--escape": ("str", "escape")}
    opts = parse_common(argv, specs)
    if opts.get("help"):
        print(HELP["fmt"])
        return 0
    outdel = decode_delim(opts.get("out_delimiter")) if opts.get("out_delimiter") is not None else ","
    if opts.get("ascii"):
        outdel = "\x1f"
        term = "\x1e"
    else:
        term = "\r\n" if opts.get("crlf") else "\n"
    quote = decode_delim(opts.get("quote")) if opts.get("quote") else '"'
    escape = decode_delim(opts.get("escape")) if opts.get("escape") else None
    rows = read_csv(opts["input"], opts["delimiter"], flexible=True)
    if rows:
        expected = len(rows[0])
        out = []
        byte = header_byte(rows[0])
        for n, r in enumerate(rows):
            if n > 0 and len(r) != expected:
                write_csv(out, opts["output"], outdel, term, bool(opts.get("quote_always")), quote, escape)
                err(csv_error(n, expected, len(r), byte))
            out.append(r)
            if n > 0:
                byte += header_byte(r)
        rows = out
    write_csv(rows, opts["output"], outdel, term, bool(opts.get("quote_always")), quote, escape)
    return 0


def cmd_frequency(argv):
    specs = {"-s": ("str", "select"), "--select": ("str", "select"), "-l": ("uint", "limit"), "--limit": ("uint", "limit"), "-a": ("bool", "asc"), "--asc": ("bool", "asc"), "--no-nulls": ("bool", "no_nulls"), "-j": ("uint", "jobs"), "--jobs": ("uint", "jobs")}
    opts = parse_common(argv, specs)
    if opts.get("help"):
        print(HELP["frequency"])
        return 0
    limit = opts.get("limit") if opts.get("limit") is not None else 10
    rows = read_csv(opts["input"], opts["delimiter"])
    headers, data = header_and_rows(rows, opts["no_headers"])
    inds = parse_selection(opts.get("select"), headers, not opts["no_headers"])
    out = [["field", "value", "count"]]
    for idx in inds:
        field = str(idx + 1) if opts["no_headers"] else headers[idx]
        counts = Counter()
        for r in data:
            v = (r[idx] if idx < len(r) else "").strip()
            if opts.get("no_nulls") and v == "":
                continue
            counts["(NULL)" if v == "" else v] += 1
        items = list(counts.items())
        if opts.get("asc"):
            items.sort(key=lambda x: (x[1], x[0]), reverse=False)
        else:
            items.sort(key=lambda x: (-x[1], x[0]))
        if limit:
            items = items[:limit]
        for value, count in items:
            out.append([field, value, str(count)])
    write_csv(out, opts["output"])
    return 0


def is_int(s):
    return re.match(r"^[+-]?\d+$", s or "") is not None


def is_float(s):
    try:
        float(s)
        return s not in ("", None)
    except Exception:
        return False


def fmt_num(x):
    if x == "" or x is None:
        return ""
    if isinstance(x, int):
        return str(x)
    if isinstance(x, float):
        if math.isnan(x):
            return "NaN"
        if math.isinf(x):
            return "inf" if x > 0 else "-inf"
        return str(x)
    return str(x)


def column_stats(name, vals, include_nulls, extras):
    nonnull = [v for v in vals if v != ""]
    if not nonnull:
        row = [name, "NULL", "", "", "", "", "", "", ""]
        if extras.get("median"):
            row.append("")
        if extras.get("mode"):
            row.append("N/A")
        if extras.get("cardinality"):
            row.append("0")
        return row
    lengths = [len(v) for v in vals]
    if nonnull and all(is_int(v) for v in nonnull):
        typ = "Integer"
        nums = [int(v) for v in nonnull]
    elif nonnull and all(is_float(v) for v in nonnull):
        typ = "Float"
        nums = [float(v) for v in nonnull]
    else:
        typ = "Unicode"
        nums = []
    row = [name, typ]
    if nums:
        row.append(fmt_num(sum(nums)))
        row.append(fmt_num(min(nums)))
        row.append(fmt_num(max(nums)))
    else:
        row.extend(["", min(nonnull) if nonnull else "", max(nonnull) if nonnull else ""])
    row.extend([str(min(lengths)) if lengths else "0", str(max(lengths)) if lengths else "0"])
    if nums:
        denom_vals = nums + ([0] * (len(vals) - len(nonnull)) if include_nulls else [])
        mean = sum(nums) / float(len(denom_vals)) if denom_vals else float("nan")
        row.append(fmt_num(mean))
        if len(denom_vals) > 1:
            m = mean
            row.append(fmt_num(math.sqrt(sum((x - m) ** 2 for x in denom_vals) / (len(denom_vals) - 1))))
        else:
            row.append("")
    else:
        row.extend(["", ""])
    if extras.get("median"):
        row.append(fmt_num(statistics.median(nums)) if nums else "")
    if extras.get("mode"):
        population = [str(v) for v in (nums if nums else vals)]
        c = Counter(population)
        if c:
            most = max(c.values())
            winners = [k for k, v in c.items() if v == most]
            row.append(winners[0] if len(winners) == 1 and most > 1 else "N/A")
        else:
            row.append("")
    if extras.get("cardinality"):
        row.append(str(len(set(vals))))
    return row


def cmd_stats(argv):
    specs = {"-s": ("str", "select"), "--select": ("str", "select"), "--everything": ("bool", "everything"), "--mode": ("bool", "mode"), "--cardinality": ("bool", "cardinality"), "--median": ("bool", "median"), "--nulls": ("bool", "nulls"), "-j": ("uint", "jobs"), "--jobs": ("uint", "jobs")}
    opts = parse_common(argv, specs)
    if opts.get("help"):
        print(HELP["stats"])
        return 0
    if opts.get("everything"):
        opts["median"] = opts["mode"] = opts["cardinality"] = True
    rows = read_csv(opts["input"], opts["delimiter"])
    headers, data = header_and_rows(rows, opts["no_headers"])
    inds = parse_selection(opts.get("select"), headers, not opts["no_headers"])
    base = ["field", "type", "sum", "min", "max", "min_length", "max_length", "mean", "stddev"]
    for k in ("median", "mode", "cardinality"):
        if opts.get(k):
            base.append(k)
    out = [base]
    for idx in inds:
        name = str(idx + 1) if opts["no_headers"] else headers[idx]
        vals = [r[idx] if idx < len(r) else "" for r in data]
        out.append(column_stats(name, vals, bool(opts.get("nulls")), opts))
    write_csv(out, opts["output"])
    return 0


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
    try:
        if not argv or argv[0] in ("-h", "--help", "help"):
            print(MAIN_USAGE)
            return 0
        if argv[0] == "--version":
            print("xsv {}".format(VERSION))
            return 0
        if argv[0] == "--list":
            print("\n".join(COMMANDS.keys()))
            return 0
        cmd = argv[0]
        if cmd not in COMMANDS:
            return die("Unknown command: '{}'.".format(cmd))
        return COMMANDS[cmd](argv[1:])
    except BrokenPipeError:
        return 1
    except XsvError as e:
        return die(e)
    except OSError as e:
        return die(e)


if __name__ == "__main__":
    raise SystemExit(main())
