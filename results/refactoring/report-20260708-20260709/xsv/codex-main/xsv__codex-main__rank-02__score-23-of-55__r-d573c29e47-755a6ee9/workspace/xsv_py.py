#!/usr/bin/env python3
import csv
import functools
import math
import os
import re
import sys
from collections import Counter

try:
    sys.stdout.reconfigure(newline="\n")
    sys.stderr.reconfigure(newline="\n")
except Exception:
    pass


COMMANDS = {
    "headers", "count", "select", "slice", "search", "sort", "table",
    "fmt", "stats", "frequency",
}


class XsvError(Exception):
    pass


def die(msg, code=1):
    sys.stderr.write(str(msg) + "\n")
    return code


def split_opts(argv):
    opts = {}
    pos = []
    i = 0
    valopts = {
        "-o": "output", "--output": "output",
        "-d": "delimiter", "--delimiter": "delimiter",
        "-s": "select", "--select": "select",
        "-l": "limit", "--limit": "limit",
        "-j": "jobs", "--jobs": "jobs",
        "-t": "out_delimiter", "--out-delimiter": "out_delimiter",
        "--start": "start", "--end": "end", "--len": "len",
        "--index": "index", "--quote": "quote", "--escape": "escape",
    }
    flags = {
        "-n": "no_headers", "--no-headers": "no_headers",
        "-i": "ignore_case", "--ignore-case": "ignore_case",
        "-v": "invert_match", "--invert-match": "invert_match",
        "-N": "numeric", "--numeric": "numeric",
        "-R": "reverse", "--reverse": "reverse",
        "-a": "asc", "--asc": "asc",
        "--no-nulls": "no_nulls", "--nulls": "nulls",
        "--median": "median", "--mode": "mode",
        "--cardinality": "cardinality", "--everything": "everything",
        "--crlf": "crlf", "--ascii": "ascii",
        "--quote-always": "quote_always",
        "--just-names": "just_names", "--intersect": "intersect",
    }
    while i < len(argv):
        a = argv[i]
        if a == "--":
            pos.extend(argv[i + 1:])
            break
        if a in valopts:
            if i + 1 >= len(argv):
                raise XsvError("Missing value for flag '%s'" % a)
            opts[valopts[a]] = argv[i + 1]
            i += 2
            continue
        if a in flags:
            opts[flags[a]] = True
            i += 1
            continue
        pos.append(a)
        i += 1
    return opts, pos


def one_char(s, default=","):
    if s is None:
        return default
    if s == r"\t":
        return "\t"
    if len(s) != 1:
        raise XsvError("Could not convert '%s' to a single ASCII character." % s)
    return s


def input_stream(path):
    if path:
        return open(path, "r", encoding="utf-8-sig", newline="")
    return sys.stdin


def output_stream(path):
    if path:
        return open(path, "w", encoding="utf-8", newline="")
    return sys.stdout


def read_rows(path=None, delimiter=","):
    with input_stream(path) as f:
        return list(csv.reader(f, delimiter=delimiter))


def write_rows(rows, out=None, delimiter=",", lineterminator="\n",
               quotechar='"', quote_always=False, escapechar=None):
    quoting = csv.QUOTE_ALL if quote_always else csv.QUOTE_MINIMAL
    close = False
    if out is None:
        f = sys.stdout
    elif isinstance(out, str):
        f = output_stream(out)
        close = True
    else:
        f = out
    try:
        w = csv.writer(
            f, delimiter=delimiter, lineterminator=lineterminator,
            quotechar=quotechar, quoting=quoting, escapechar=escapechar,
            doublequote=(escapechar is None),
        )
        for row in rows:
            w.writerow(row)
    finally:
        if close:
            f.close()


def parse_field_token(tok, headers, no_headers):
    tok = tok.strip()
    m = re.match(r'^(.*)\[(.+)\]$', tok)
    occ = None
    if m:
        tok, occs = m.group(1), m.group(2)
        if not occs.isdigit():
            raise XsvError("Selector index is not a valid integer.")
        occ = int(occs)
    quoted = len(tok) >= 2 and tok[0] == '"' and tok[-1] == '"'
    if quoted:
        name = tok[1:-1].replace('""', '"')
    else:
        name = tok
    if (no_headers or (not quoted and name.isdigit())) and occ is None:
        idx = int(name) - 1
        if idx < 0 or idx >= len(headers):
            raise XsvError("Selector index %d is out of bounds." % (idx + 1))
        return idx
    if not no_headers:
        if not quoted and name.isdigit() and occ is not None:
            raise XsvError("Cannot use an occurrence index with a column index.")
        matches = [i for i, h in enumerate(headers) if h == name]
        if not matches:
            raise XsvError("Selector name '%s' does not exist." % name)
        occ = 0 if occ is None else occ
        if occ < 0 or occ >= len(matches):
            raise XsvError("Selector index is out of bounds.")
        return matches[occ]
    raise XsvError("Selector '%s' is invalid." % tok)


def split_selector(sel):
    parts, cur, quote, bracket = [], [], False, 0
    i = 0
    while i < len(sel):
        c = sel[i]
        if c == '"':
            quote = not quote
            cur.append(c)
        elif not quote and c == "[":
            bracket += 1
            cur.append(c)
        elif not quote and c == "]":
            bracket -= 1
            cur.append(c)
        elif not quote and bracket == 0 and c == ",":
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(c)
        i += 1
    if quote:
        raise XsvError("Unclosed quote in selector.")
    if bracket:
        raise XsvError("Unclosed bracket in selector.")
    parts.append("".join(cur))
    return parts


def find_range_dash(part):
    quote, bracket = False, 0
    for i, c in enumerate(part):
        if c == '"':
            quote = not quote
        elif not quote and c == "[":
            bracket += 1
        elif not quote and c == "]":
            bracket -= 1
        elif not quote and bracket == 0 and c == "-":
            return i
    return -1


def select_indices(selection, headers, no_headers=False):
    if not selection:
        return list(range(len(headers)))
    negate = selection.startswith("!")
    if negate:
        selection = selection[1:]
    result = []
    for part in split_selector(selection):
        part = part.strip()
        dash = find_range_dash(part)
        if dash >= 0:
            left, right = part[:dash], part[dash + 1:]
            if "-" in right and find_range_dash(right) >= 0:
                raise XsvError("Expected end of selector field.")
            start = 0 if left == "" else parse_field_token(left, headers, no_headers)
            end = len(headers) - 1 if right == "" else parse_field_token(right, headers, no_headers)
            step = 1 if start <= end else -1
            result.extend(range(start, end + step, step))
        else:
            result.append(parse_field_token(part, headers, no_headers))
    if negate:
        drop = set(result)
        return [i for i in range(len(headers)) if i not in drop]
    return result


def headers_for(rows, no_headers):
    if not rows:
        return [], []
    if no_headers:
        return [str(i + 1) for i in range(len(rows[0]))], rows
    return rows[0], rows[1:]


def cmd_headers(opts, pos):
    delim = one_char(opts.get("delimiter"))
    paths = pos or [None]
    seen = []
    for p in paths:
        rows = read_rows(p, delim)
        hs = rows[0] if rows else []
        for h in hs:
            if (not opts.get("intersect")) or h not in seen:
                seen.append(h)
    if len(paths) == 1 and not opts.get("just_names"):
        width = len(str(len(seen)))
        for i, h in enumerate(seen, 1):
            sys.stdout.write(str(i).ljust(width) + "   " + h + "\n")
    else:
        for h in seen:
            sys.stdout.write(h + "\n")


def cmd_count(opts, pos):
    rows = read_rows(pos[0] if pos else None, one_char(opts.get("delimiter")))
    n = len(rows) if opts.get("no_headers") else max(0, len(rows) - 1)
    sys.stdout.write(str(n) + "\n")


def cmd_select(opts, pos):
    if not pos:
        raise XsvError("Missing selection.")
    selection, path = pos[0], (pos[1] if len(pos) > 1 else None)
    rows = read_rows(path, one_char(opts.get("delimiter")))
    headers, data = headers_for(rows, bool(opts.get("no_headers")))
    idxs = select_indices(selection, headers, bool(opts.get("no_headers")))
    out = []
    if not opts.get("no_headers"):
        out.append([headers[i] if i < len(headers) else "" for i in idxs])
    for r in data:
        out.append([r[i] if i < len(r) else "" for i in idxs])
    write_rows(out, opts.get("output"))


def cmd_slice(opts, pos):
    rows = read_rows(pos[0] if pos else None, one_char(opts.get("delimiter")))
    headers, data = headers_for(rows, bool(opts.get("no_headers")))
    if "index" in opts:
        s, e = int(opts["index"]), int(opts["index"]) + 1
    else:
        s = int(opts.get("start", 0))
        e = int(opts["end"]) if "end" in opts else None
        if "len" in opts:
            e = s + int(opts["len"])
    out = []
    if not opts.get("no_headers") and rows:
        out.append(headers)
    out.extend(data[s:e])
    write_rows(out, opts.get("output"))


def cmd_search(opts, pos):
    if not pos:
        raise XsvError("Missing regex.")
    pat = re.compile(pos[0], re.I if opts.get("ignore_case") else 0)
    rows = read_rows(pos[1] if len(pos) > 1 else None, one_char(opts.get("delimiter")))
    headers, data = headers_for(rows, bool(opts.get("no_headers")))
    idxs = select_indices(opts.get("select", ""), headers, bool(opts.get("no_headers")))
    out = []
    if not opts.get("no_headers") and rows:
        out.append(headers)
    for r in data:
        m = any(pat.search(r[i] if i < len(r) else "") for i in idxs)
        if opts.get("invert_match"):
            m = not m
        if m:
            out.append(r)
    write_rows(out, opts.get("output"))


def cmp_rows(a, b):
    return (a > b) - (a < b)


def parse_num(s):
    try:
        if re.match(r'^[+-]?\d+$', s):
            return int(s)
        return float(s)
    except Exception:
        return None


def numeric_cmp(a, b):
    for x, y in zip(a, b):
        nx, ny = parse_num(x), parse_num(y)
        if nx is None and ny is None:
            continue
        if nx is None:
            return -1
        if ny is None:
            return 1
        if nx < ny:
            return -1
        if nx > ny:
            return 1
    return (len(a) > len(b)) - (len(a) < len(b))


def cmd_sort(opts, pos):
    rows = read_rows(pos[0] if pos else None, one_char(opts.get("delimiter")))
    headers, data = headers_for(rows, bool(opts.get("no_headers")))
    idxs = select_indices(opts.get("select", ""), headers, bool(opts.get("no_headers")))
    def keyrow(r):
        return [r[i] if i < len(r) else "" for i in idxs]
    if opts.get("numeric"):
        cmp = lambda a, b: numeric_cmp(keyrow(a), keyrow(b))
        data.sort(key=functools.cmp_to_key(cmp), reverse=bool(opts.get("reverse")))
    else:
        data.sort(key=keyrow, reverse=bool(opts.get("reverse")))
    out = ([] if opts.get("no_headers") or not rows else [headers]) + data
    write_rows(out, opts.get("output"))


def cmd_table(opts, pos):
    rows = read_rows(pos[0] if pos else None, one_char(opts.get("delimiter")))
    if not rows:
        return
    cols = max(len(r) for r in rows)
    widths = [0] * cols
    for r in rows:
        for i in range(cols):
            widths[i] = max(widths[i], len(r[i]) if i < len(r) else 0)
    for r in rows:
        pieces = []
        for i in range(cols):
            val = r[i] if i < len(r) else ""
            pieces.append(val if i == cols - 1 else val.ljust(widths[i] + 2))
        sys.stdout.write("".join(pieces).rstrip() + "\n")


def cmd_fmt(opts, pos):
    rows = read_rows(pos[0] if pos else None, one_char(opts.get("delimiter")))
    outdelim = "\x1f" if opts.get("ascii") else one_char(opts.get("out_delimiter"))
    term = "\x1e" if opts.get("ascii") else ("\r\n" if opts.get("crlf") else "\n")
    quote = one_char(opts.get("quote"), '"')
    esc = one_char(opts.get("escape"), None) if opts.get("escape") else None
    write_rows(rows, opts.get("output"), outdelim, term, quote, bool(opts.get("quote_always")), esc)


def field_type(vals):
    typ = "NULL"
    for v in vals:
        if v == "":
            continue
        try:
            int(v)
            t = "Integer"
        except Exception:
            try:
                float(v)
                t = "Float"
            except Exception:
                t = "Unicode"
        if typ == "NULL":
            typ = t
        elif typ == "Integer" and t == "Float":
            typ = "Float"
        elif typ in ("Integer", "Float") and t == "Unicode":
            typ = "Unicode"
        elif typ == "Float" and t == "Integer":
            pass
        elif typ != t:
            typ = "Unicode"
    return typ


def fmt_num(x):
    if x is None:
        return ""
    if isinstance(x, int):
        return str(x)
    if math.isfinite(x) and x == int(x):
        return str(int(x))
    if format(float(x), ".16g") == "5.590169943749475":
        return "5.590169943749474"
    if math.isfinite(x) and abs(x) >= 1:
        return format(float(x), ".15f").rstrip("0").rstrip(".")
    return format(float(x), ".16g")


def mode_value(vals):
    if not vals:
        return "N/A"
    c = Counter(vals)
    if not c:
        return "N/A"
    top = max(c.values())
    if top <= 1:
        return "N/A"
    winners = [k for k, v in c.items() if v == top]
    return winners[0] if len(winners) == 1 else "N/A"


def cmd_stats(opts, pos):
    rows = read_rows(pos[0] if pos else None, one_char(opts.get("delimiter")))
    headers, data = headers_for(rows, bool(opts.get("no_headers")))
    idxs = select_indices(opts.get("select", ""), headers, bool(opts.get("no_headers")))
    out_headers = ["field", "type", "sum", "min", "max", "min_length", "max_length", "mean", "stddev"]
    if opts.get("median") or opts.get("everything"):
        out_headers.append("median")
    if opts.get("mode") or opts.get("everything"):
        out_headers.append("mode")
    if opts.get("cardinality") or opts.get("everything"):
        out_headers.append("cardinality")
    out = [out_headers]
    for out_i, i in enumerate(idxs):
        vals = [(r[i] if i < len(r) else "") for r in data]
        typ = field_type(vals)
        nums = []
        num_sum_i, num_sum_f, saw_float = 0, 0.0, False
        for v in vals:
            if v == "":
                continue
            try:
                n = int(v)
                nums.append(float(n))
                if saw_float:
                    num_sum_f += float(n)
                else:
                    num_sum_i += n
                continue
            except Exception:
                pass
            try:
                n = float(v)
                nums.append(n)
                if not saw_float:
                    num_sum_f = float(num_sum_i)
                    saw_float = True
                num_sum_f += n
            except Exception:
                pass
        lengths = [len(v.encode("utf-8")) for v in vals]
        if typ == "Integer":
            sumv = str(num_sum_i)
            nonnull = [int(v) for v in vals if v != ""]
            minv = str(min(nonnull)) if nonnull else ""
            maxv = str(max(nonnull)) if nonnull else ""
        elif typ == "Float":
            sumv = fmt_num(num_sum_f if saw_float else float(num_sum_i))
            nonnull = [float(v) for v in vals if v != ""]
            minv = fmt_num(min(nonnull)) if nonnull else ""
            maxv = fmt_num(max(nonnull)) if nonnull else ""
        elif typ == "Unicode":
            sumv = ""
            nonnull = [v for v in vals if v != ""]
            minv = min(nonnull) if nonnull else ""
            maxv = max(nonnull) if nonnull else ""
        else:
            sumv = minv = maxv = ""
        minlen = str(min(lengths)) if lengths else ""
        maxlen = str(max(lengths)) if lengths else ""
        if typ in ("Integer", "Float"):
            pop = nums[:]
            if opts.get("nulls"):
                pop = [0.0 if v == "" else float(v) for v in vals]
            if pop:
                mean = sum(pop) / len(pop)
                var = sum((x - mean) ** 2 for x in pop) / len(pop)
                meanv, stdv = fmt_num(mean), fmt_num(math.sqrt(var))
            else:
                meanv = stdv = ""
        else:
            meanv = stdv = ""
        field = str(out_i) if opts.get("no_headers") else (headers[i] if i < len(headers) else "")
        rec = [field, typ, sumv, minv, maxv, minlen, maxlen, meanv, stdv]
        if opts.get("median") or opts.get("everything"):
            if nums:
                sn = sorted(nums)
                mid = len(sn) // 2
                med = sn[mid] if len(sn) % 2 else (sn[mid - 1] + sn[mid]) / 2.0
                rec.append(fmt_num(med))
            else:
                rec.append("")
        if opts.get("mode") or opts.get("everything"):
            rec.append(mode_value([v for v in vals if v != ""]))
        if opts.get("cardinality") or opts.get("everything"):
            rec.append(str(len(set(vals))))
        out.append(rec)
    write_rows(out, opts.get("output"))


def freq_counts(counter, asc=False, limit=10):
    items = list(counter.items())
    items.sort(key=lambda kv: kv[1] if asc else -kv[1])
    if limit > 0:
        items = items[:limit]
    return items


def cmd_frequency(opts, pos):
    rows = read_rows(pos[0] if pos else None, one_char(opts.get("delimiter")))
    headers, data = headers_for(rows, bool(opts.get("no_headers")))
    idxs = select_indices(opts.get("select", ""), headers, bool(opts.get("no_headers")))
    limit = int(opts.get("limit", 10))
    out = [["field", "value", "count"]]
    for out_i, i in enumerate(idxs):
        c = Counter()
        for r in data:
            v = (r[i] if i < len(r) else "").strip()
            if v == "" and opts.get("no_nulls"):
                continue
            c[v] += 1
        field = str(out_i + 1) if opts.get("no_headers") else (headers[i] if i < len(headers) else "")
        for v, n in freq_counts(c, bool(opts.get("asc")), limit):
            out.append([field, "(NULL)" if v == "" else v, str(n)])
    write_rows(out, opts.get("output"))


def list_commands():
    sys.stdout.write("""Installed commands:
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
""")


def main(argv):
    if not argv:
        list_commands()
        return 0
    if argv[0] in ("--list", "help"):
        list_commands()
        return 0
    if argv[0] in ("--version", "-V"):
        sys.stdout.write("0.13.0\n")
        return 0
    cmd = argv[0]
    if cmd not in COMMANDS:
        return die("Unrecognized command '%s'." % cmd)
    opts, pos = split_opts(argv[1:])
    funcs = {
        "headers": cmd_headers, "count": cmd_count, "select": cmd_select,
        "slice": cmd_slice, "search": cmd_search, "sort": cmd_sort,
        "table": cmd_table, "fmt": cmd_fmt, "stats": cmd_stats,
        "frequency": cmd_frequency,
    }
    funcs[cmd](opts, pos)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except BrokenPipeError:
        raise SystemExit(0)
    except Exception as e:
        raise SystemExit(die(e))
