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


def eprintln(msg):
    sys.stderr.write(str(msg) + "\n")


def fail(msg, code=1):
    eprintln(msg)
    raise SystemExit(code)


def one_char(s, opt="--delimiter"):
    if s == r"\t":
        return "\t"
    if len(s) != 1 or ord(s) > 127:
        fail("Could not convert '{}' to a single ASCII character.".format(s))
    return s


def open_input(path):
    if path is None:
        return sys.stdin
    try:
        return open(path, "r", newline="", encoding="utf-8", errors="surrogateescape")
    except OSError as ex:
        fail("failed to open {}: {}".format(path, ex))


def open_output(path):
    if path is None:
        return sys.stdout
    try:
        return open(path, "w", newline="", encoding="utf-8", errors="surrogateescape")
    except OSError as ex:
        fail("failed to open {}: {}".format(path, ex))


def csv_reader(path=None, delimiter=",", no_headers=False):
    f = open_input(path)
    return csv.reader(f, delimiter=delimiter), f


def csv_writer(path=None, delimiter=",", lineterminator="\n", quotechar='"', quote_all=False, escapechar=None):
    f = open_output(path)
    quoting = csv.QUOTE_ALL if quote_all else csv.QUOTE_MINIMAL
    return csv.writer(f, delimiter=delimiter, lineterminator=lineterminator,
                      quotechar=quotechar, quoting=quoting, escapechar=escapechar,
                      doublequote=(escapechar is None)), f


def read_rows(path=None, delimiter=","):
    rdr, f = csv_reader(path, delimiter)
    try:
        return [row for row in rdr]
    except csv.Error as ex:
        fail("CSV error: {}".format(ex))
    finally:
        if f is not sys.stdin:
            f.close()


def write_rows(rows, path=None, delimiter=",", lineterminator="\n", **kw):
    wtr, f = csv_writer(path, delimiter, lineterminator, **kw)
    try:
        for row in rows:
            wtr.writerow(row)
    finally:
        if f is not sys.stdout:
            f.close()


def parse_common(args, allow_output=True, allow_no_headers=True):
    out = {"delimiter": ",", "output": None, "no_headers": False}
    rest = []
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("-h", "--help"):
            out["help"] = True
            i += 1
        elif allow_output and a in ("-o", "--output"):
            i += 1
            if i >= len(args): fail("Flag '{}' requires an argument.".format(a))
            out["output"] = args[i]
            i += 1
        elif allow_no_headers and a in ("-n", "--no-headers"):
            out["no_headers"] = True
            i += 1
        elif a in ("-d", "--delimiter"):
            i += 1
            if i >= len(args): fail("Flag '{}' requires an argument.".format(a))
            out["delimiter"] = one_char(args[i])
            i += 1
        elif a == "--":
            rest.extend(args[i + 1:])
            break
        else:
            rest.append(a)
            i += 1
    out["rest"] = rest
    return out


def split_selection(s):
    parts, buf, quote = [], [], False
    i = 0
    while i < len(s):
        c = s[i]
        if c == '"':
            quote = not quote
            i += 1
            continue
        if c == "," and not quote:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(c)
        i += 1
    parts.append("".join(buf).strip())
    return [p for p in parts if p != ""]


def header_index(headers, name):
    m = re.match(r"^(.*)\[(\d+)\]$", name)
    nth = 1
    if m:
        name, nth = m.group(1), int(m.group(2))
    seen = 0
    for i, h in enumerate(headers):
        if h == name:
            seen += 1
            if seen == nth:
                return i
    fail("Selector '{}' did not match any columns.".format(name))


def atom_index(atom, headers, no_headers, ncols, allow_end=False):
    atom = atom.strip()
    if atom == "" and allow_end:
        return ncols - 1
    if atom.isdigit():
        idx = int(atom) - 1
        if idx < 0 or idx >= ncols:
            fail("Selector index {} is out of bounds. Index must be >= 1 and <= {}.".format(int(atom), ncols))
        return idx
    if no_headers:
        fail("Cannot use names in selection when --no-headers is set.")
    return header_index(headers, atom)


def parse_selection(sel, headers, no_headers=False, ncols=None):
    if ncols is None:
        ncols = len(headers)
    if sel is None or sel == "":
        return list(range(ncols))
    invert = False
    if sel.startswith("!"):
        invert = True
        sel = sel[1:]
    indices = []
    for part in split_selection(sel):
        if "-" in part and not (part.startswith('"') and part.endswith('"')):
            a, b = part.split("-", 1)
            start = atom_index(a, headers, no_headers, ncols) if a else 0
            end = atom_index(b, headers, no_headers, ncols, True) if b else ncols - 1
            step = 1 if start <= end else -1
            indices.extend(range(start, end + step, step))
        else:
            indices.append(atom_index(part, headers, no_headers, ncols))
    if invert:
        chosen = set(indices)
        indices = [i for i in range(ncols) if i not in chosen]
    return indices


def selected(row, idxs):
    return [row[i] if i < len(row) else "" for i in idxs]


def cmd_count(args):
    c = parse_common(args, allow_output=False)
    if c.get("help"):
        sys.stdout.write("Prints a count of the number of records in the CSV data.\n")
        return
    path = c["rest"][0] if c["rest"] else None
    rows = read_rows(path, c["delimiter"])
    n = len(rows)
    if not c["no_headers"] and n > 0:
        n -= 1
    sys.stdout.write(str(n) + "\n")


def cmd_headers(args):
    c = parse_common(args, allow_output=False, allow_no_headers=False)
    rest = c["rest"]
    just = False
    intersect = False
    paths = []
    i = 0
    while i < len(rest):
        if rest[i] in ("-j", "--just-names"):
            just = True
        elif rest[i] == "--intersect":
            intersect = True
        else:
            paths.append(rest[i])
        i += 1
    if len(paths) > 1:
        just = True
    all_headers = []
    if not paths:
        rows = read_rows(None, c["delimiter"])
        all_headers.append(rows[0] if rows else [])
    else:
        for p in paths:
            rows = read_rows(p, c["delimiter"])
            all_headers.append(rows[0] if rows else [])
    if intersect:
        seen = []
        for hs in all_headers:
            for h in hs:
                if h not in seen:
                    seen.append(h)
        names = seen
    else:
        names = [h for hs in all_headers for h in hs]
    if just:
        sys.stdout.write("\n".join(names) + ("\n" if names else ""))
    else:
        width = len(str(len(names)))
        lines = [str(i + 1).rjust(width) + "   " + h for i, h in enumerate(names)]
        sys.stdout.write("\n".join(lines) + ("\n" if lines else ""))


def cmd_select(args):
    c = parse_common(args)
    rest = c["rest"]
    if not rest: fail("Usage: xsv select [options] [--] <selection> [<input>]")
    sel, path = rest[0], (rest[1] if len(rest) > 1 else None)
    rows = read_rows(path, c["delimiter"])
    if not rows: return
    headers = rows[0]
    idxs = parse_selection(sel, headers, c["no_headers"], len(headers))
    out = []
    if c["no_headers"]:
        out = [selected(r, idxs) for r in rows]
    else:
        out.append(selected(headers, idxs))
        out.extend(selected(r, idxs) for r in rows[1:])
    write_rows(out, c["output"])


def cmd_slice(args):
    c = parse_common(args)
    rest = c["rest"]
    path = None; start = None; end = None; length = None; index = None
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-s", "--start"):
            i += 1; start = int(rest[i])
        elif a in ("-e", "--end"):
            i += 1; end = int(rest[i])
        elif a in ("-l", "--len"):
            i += 1; length = int(rest[i])
        elif a in ("-i", "--index"):
            i += 1; index = int(rest[i])
        else:
            path = a
        i += 1
    if index is not None:
        start, length = index, 1
    if start is None: start = 0
    if start < 0 or (end is not None and end < 0) or (length is not None and length < 0):
        fail("invalid digit found in string")
    if length is not None:
        end = start + length
    rows = read_rows(path, c["delimiter"])
    out = []
    data = rows
    if rows and not c["no_headers"]:
        out.append(rows[0]); data = rows[1:]
    out.extend(data[start:end])
    write_rows(out, c["output"])


def cmd_search(args):
    c = parse_common(args)
    rest = c["rest"]
    ignore = False; invert = False; sel = None; pos = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-i", "--ignore-case"):
            ignore = True
        elif a in ("-v", "--invert-match"):
            invert = True
        elif a in ("-s", "--select"):
            i += 1; sel = rest[i]
        else:
            pos.append(a)
        i += 1
    if not pos: fail("Usage: xsv search [options] <regex> [<input>]")
    pat, path = pos[0], (pos[1] if len(pos) > 1 else None)
    try:
        rx = re.compile(pat, re.I if ignore else 0)
    except re.error as ex:
        fail(str(ex))
    rows = read_rows(path, c["delimiter"])
    if not rows: return
    out = []
    headers = rows[0]
    data = rows
    if not c["no_headers"]:
        out.append(headers); data = rows[1:]
    idxs = parse_selection(sel, headers, c["no_headers"], len(headers)) if sel else list(range(len(headers)))
    for r in data:
        m = any(rx.search(r[i] if i < len(r) else "") for i in idxs)
        if m ^ invert:
            out.append(r)
    write_rows(out, c["output"])


def numeric_value(s):
    try:
        return float(s)
    except Exception:
        return math.nan


def cmp_rows(a, b, idxs, numeric=False):
    for i in idxs:
        av = a[i] if i < len(a) else ""
        bv = b[i] if i < len(b) else ""
        if numeric:
            af, bf = numeric_value(av), numeric_value(bv)
            if math.isnan(af) and math.isnan(bf): c = 0
            elif math.isnan(af): c = -1
            elif math.isnan(bf): c = 1
            else: c = (af > bf) - (af < bf)
        else:
            c = (av > bv) - (av < bv)
        if c: return c
    return 0


def cmd_sort(args):
    c = parse_common(args)
    rest = c["rest"]
    sel = None; numeric = False; reverse = False; pos = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-s", "--select"):
            i += 1; sel = rest[i]
        elif a in ("-N", "--numeric"):
            numeric = True
        elif a in ("-R", "--reverse"):
            reverse = True
        else:
            pos.append(a)
        i += 1
    path = pos[0] if pos else None
    rows = read_rows(path, c["delimiter"])
    if not rows: return
    out = []
    headers = rows[0]
    data = rows
    if not c["no_headers"]:
        out.append(headers); data = rows[1:]
    idxs = parse_selection(sel, headers, c["no_headers"], len(headers)) if sel else list(range(len(headers)))
    data = sorted(data, key=cmp_to_key(lambda a, b: cmp_rows(a, b, idxs, numeric)), reverse=reverse)
    out.extend(data)
    write_rows(out, c["output"])


def cmd_fmt(args):
    c = parse_common(args, allow_no_headers=False)
    rest = c["rest"]
    out_delim = ","; crlf = False; quote = '"'; quote_all = False; escape = None; ascii_mode = False; pos = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-t", "--out-delimiter"):
            i += 1; out_delim = one_char(rest[i], a)
        elif a == "--crlf": crlf = True
        elif a == "--ascii": ascii_mode = True
        elif a == "--quote": i += 1; quote = one_char(rest[i], a)
        elif a == "--quote-always": quote_all = True
        elif a == "--escape": i += 1; escape = one_char(rest[i], a)
        else: pos.append(a)
        i += 1
    if ascii_mode:
        out_delim = chr(0x1f); lterm = chr(0x1e)
    else:
        lterm = "\r\n" if crlf else "\n"
    path = pos[0] if pos else None
    rows = read_rows(path, c["delimiter"])
    write_rows(rows, c["output"], out_delim, lterm, quotechar=quote, quote_all=quote_all, escapechar=escape)


def cell_width(s):
    return len(s)


def condense(s, n):
    if n is None or n <= 0 or len(s) <= n:
        return s
    return s[:n]


def cmd_table(args):
    c = parse_common(args, allow_no_headers=False)
    rest = c["rest"]
    width = 2; pad = 2; condens = None; pos = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-w", "--width"):
            i += 1; width = int(rest[i])
        elif a in ("-p", "--pad"):
            i += 1; pad = int(rest[i])
        elif a in ("-c", "--condense"):
            i += 1; condens = int(rest[i])
        else:
            pos.append(a)
        i += 1
    rows = [[condense(f, condens) for f in r] for r in read_rows(pos[0] if pos else None, c["delimiter"])]
    if not rows: return
    ncols = max(len(r) for r in rows)
    widths = [width] * ncols
    for r in rows:
        for i, f in enumerate(r):
            widths[i] = max(widths[i], cell_width(f))
    out_lines = []
    for r in rows:
        parts = []
        for i in range(ncols):
            f = r[i] if i < len(r) else ""
            if i == ncols - 1:
                parts.append(f)
            else:
                parts.append(f + " " * (widths[i] - cell_width(f) + pad))
        out_lines.append("".join(parts).rstrip())
    text = "\n".join(out_lines) + ("\n" if out_lines else "")
    if c["output"]:
        with open_output(c["output"]) as f: f.write(text)
    else:
        sys.stdout.write(text)


def trim(s):
    return s.strip()


def is_number(s):
    try:
        float(s)
        return True
    except Exception:
        return False


def fmt_num(x):
    if x == "": return ""
    if isinstance(x, str): return x
    if math.isnan(x): return "NaN"
    if abs(x - round(x)) < 1e-12:
        return str(int(round(x)))
    return ("{:.15g}".format(x))


def stats_for(values, include_nulls=False, everything=False, mode=False, cardinality=False, median=False):
    vals = [trim(v) for v in values]
    nonnull = [v for v in vals if v != ""]
    nums = [float(v) for v in nonnull if is_number(v)]
    popn = len(vals) if include_nulls else len(nums)
    stype = "NULL"
    if nonnull:
        stype = "Integer" if all(re.match(r"^[+-]?\d+$", v) for v in nonnull) else ("Float" if len(nums) == len(nonnull) else "Unicode")
    row = {"type": stype, "sum": "", "min": "", "max": "", "min_length": "", "max_length": "", "mean": "", "stddev": ""}
    if nonnull:
        lens = [len(v) for v in nonnull]
        row["min_length"] = str(min(lens)); row["max_length"] = str(max(lens))
        row["min"] = min(nonnull); row["max"] = max(nonnull)
    if nums:
        row["sum"] = fmt_num(sum(nums))
        row["min"] = fmt_num(min(nums)); row["max"] = fmt_num(max(nums))
        denom_vals = nums + ([0.0] * (len(vals) - len(nonnull)) if include_nulls else [])
        if denom_vals:
            meanv = sum(denom_vals) / len(denom_vals)
            row["mean"] = fmt_num(meanv)
            row["stddev"] = fmt_num(math.sqrt(sum((x - meanv) ** 2 for x in denom_vals) / len(denom_vals)))
    if cardinality or everything:
        row["cardinality"] = str(len(set(nonnull)))
    if mode or everything:
        if nonnull:
            cnt = Counter(nonnull)
            row["mode"] = cnt.most_common(1)[0][0]
        else:
            row["mode"] = "N/A"
    if median or everything:
        if nums:
            row["median"] = fmt_num(statistics.median(nums))
        else:
            row["median"] = ""
    return row


def cmd_stats(args):
    c = parse_common(args)
    rest = c["rest"]
    sel = None; everything = False; mode = False; card = False; median = False; nulls = False; pos = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-s", "--select"):
            i += 1; sel = rest[i]
        elif a == "--everything": everything = True
        elif a == "--mode": mode = True
        elif a == "--cardinality": card = True
        elif a == "--median": median = True
        elif a == "--nulls": nulls = True
        elif a in ("-j", "--jobs"):
            i += 1
        else: pos.append(a)
        i += 1
    rows = read_rows(pos[0] if pos else None, c["delimiter"])
    if not rows: return
    headers = rows[0]
    data = rows if c["no_headers"] else rows[1:]
    if c["no_headers"]:
        headers = [str(i) for i in range(len(rows[0]))]
    idxs = parse_selection(sel, headers, c["no_headers"], len(headers)) if sel else list(range(len(headers)))
    cols = [[r[i] if i < len(r) else "" for r in data] for i in idxs]
    out_header = ["field", "type", "sum", "min", "max", "min_length", "max_length", "mean", "stddev"]
    if card or everything: out_header.append("cardinality")
    if mode or everything: out_header.append("mode")
    if median or everything: out_header.append("median")
    out = [out_header]
    for i, col in zip(idxs, cols):
        st = stats_for(col, nulls, everything, mode, card, median)
        name = headers[i] if i < len(headers) else str(i)
        out.append([name] + [st.get(h, "") for h in out_header[1:]])
    write_rows(out, c["output"])


def cmd_frequency(args):
    c = parse_common(args)
    rest = c["rest"]
    sel = None; limit = 10; asc = False; no_nulls = False; pos = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-s", "--select"):
            i += 1; sel = rest[i]
        elif a in ("-l", "--limit"):
            i += 1; limit = int(rest[i])
        elif a in ("-a", "--asc"):
            asc = True
        elif a == "--no-nulls":
            no_nulls = True
        elif a in ("-j", "--jobs"):
            i += 1
        else: pos.append(a)
        i += 1
    rows = read_rows(pos[0] if pos else None, c["delimiter"])
    if not rows: return
    headers = rows[0]
    data = rows if c["no_headers"] else rows[1:]
    if c["no_headers"]:
        headers = [str(i + 1) for i in range(len(rows[0]))]
    idxs = parse_selection(sel, headers, c["no_headers"], len(headers)) if sel else list(range(len(headers)))
    out = [["field", "value", "count"]]
    for idx in idxs:
        cnt = Counter()
        for r in data:
            v = trim(r[idx] if idx < len(r) else "")
            if v == "" and no_nulls: continue
            cnt[v] += 1
        items = sorted(cnt.items(), key=lambda kv: (kv[1], kv[0]) if asc else (-kv[1], kv[0]))
        if limit > 0: items = items[:limit]
        field = headers[idx] if idx < len(headers) else str(idx + 1)
        for v, n in items:
            out.append([field, "(NULL)" if v == "" else v, str(n)])
    write_rows(out, c["output"])


COMMANDS = {"count": cmd_count, "headers": cmd_headers, "select": cmd_select, "slice": cmd_slice,
            "search": cmd_search, "sort": cmd_sort, "fmt": cmd_fmt, "table": cmd_table,
            "stats": cmd_stats, "frequency": cmd_frequency}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        eprintln("xsv is a suite of CSV command line utilities.")
        return 0
    if argv[0] == "--version":
        sys.stdout.write(VERSION + "\n"); return 0
    if argv[0] == "--list":
        sys.stdout.write("Installed commands:\n" + "\n".join("    " + k for k in sorted(COMMANDS)) + "\n"); return 0
    if argv[0] in ("help", "-h", "--help"):
        sys.stdout.write("Usage:\n    xsv <command> [<args>...]\n"); return 0
    cmd = argv[0]
    if cmd not in COMMANDS:
        fail("Unrecognized command '{}'.".format(cmd))
    try:
        COMMANDS[cmd](argv[1:])
    except BrokenPipeError:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
