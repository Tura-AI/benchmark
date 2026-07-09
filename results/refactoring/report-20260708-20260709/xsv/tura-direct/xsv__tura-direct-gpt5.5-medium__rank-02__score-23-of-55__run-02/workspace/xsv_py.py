#!/usr/bin/env python3
import argparse
import csv
import math
import os
import re
import statistics
import sys
from collections import Counter, defaultdict
from functools import cmp_to_key

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(newline="\n")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(newline="\n")


VERSION = "0.13.0"


COMMANDS = [
    ("cat", "Concatenate by row or column"),
    ("count", "Count records"),
    ("fixlengths", "Makes all records have same length"),
    ("flatten", "Show one field per line"),
    ("fmt", "Format CSV output (change field delimiter)"),
    ("frequency", "Show frequency tables"),
    ("headers", "Show header names"),
    ("help", "Show this usage message."),
    ("index", "Create CSV index for faster access"),
    ("input", "Read CSV data with special quoting rules"),
    ("join", "Join CSV files"),
    ("sample", "Randomly sample CSV data"),
    ("search", "Search CSV data with regexes"),
    ("select", "Select columns from CSV"),
    ("slice", "Slice records from CSV"),
    ("sort", "Sort CSV data"),
    ("split", "Split CSV data into many files"),
    ("stats", "Compute basic statistics"),
    ("table", "Align CSV data into columns"),
]


def command_list():
    return "\n" + "\n".join("    %-11s %s" % x for x in COMMANDS) + "\n"


def die(msg, code=1):
    sys.stderr.write(str(msg) + "\n")
    raise SystemExit(code)


def one_char(value):
    if len(value) != 1:
        die("Could not convert '%s' to a single ASCII character." % value)
    return value


def open_input(path):
    if path is None or path == "-":
        return sys.stdin
    return open(path, "r", encoding="utf-8-sig", newline="")


def open_output(path):
    if path is None or path == "-":
        return sys.stdout
    return open(path, "w", encoding="utf-8", newline="")


def make_reader(path=None, delimiter=",", no_headers=False):
    f = open_input(path)
    return f, csv.reader(f, delimiter=delimiter)


def make_writer(path=None, delimiter=","):
    f = open_output(path)
    return f, csv.writer(f, delimiter=delimiter, lineterminator="\n")


def read_rows(path=None, delimiter=","):
    f, rdr = make_reader(path, delimiter)
    try:
        return [row for row in rdr]
    finally:
        if f is not sys.stdin:
            f.close()


def write_rows(rows, path=None, delimiter=","):
    f, w = make_writer(path, delimiter)
    try:
        for row in rows:
            w.writerow(row)
    finally:
        if f is not sys.stdout:
            f.close()


def parse_common(p, output=False, no_headers=False, select=False):
    p.add_argument("-d", "--delimiter", default=",", type=one_char)
    if output:
        p.add_argument("-o", "--output")
    if no_headers:
        p.add_argument("-n", "--no-headers", action="store_true")
    if select:
        p.add_argument("-s", "--select", default=None)


def split_selection(s):
    out, cur, quote = [], [], False
    i = 0
    while i < len(s):
        c = s[i]
        if c == '"':
            quote = not quote
            i += 1
            continue
        if c == "," and not quote:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(c)
        i += 1
    out.append("".join(cur).strip())
    return out


def header_indices(headers, name):
    m = re.match(r"^(.*)\[(\d+)\]$", name)
    nth = 1
    if m:
        name, nth = m.group(1), int(m.group(2))
    found = [i for i, h in enumerate(headers) if h == name]
    if nth <= 0 or nth > len(found):
        die("Selector '%s' did not match any columns." % name)
    return found[nth - 1]


def parse_col(tok, headers, ncols, has_headers):
    tok = tok.strip()
    if tok == "":
        die("Selector cannot be empty.")
    if tok.isdigit():
        i = int(tok)
        if i < 1 or i > ncols:
            die("Selector index %s is out of bounds. Index must be >= 1 and <= %s." % (i, ncols))
        return i - 1
    if has_headers:
        return header_indices(headers, tok)
    die("Selector '%s' is not a valid index." % tok)


def select_indices(selection, headers, ncols, has_headers=True):
    invert = selection.startswith("!")
    if invert:
        selection = selection[1:]
    idxs = []
    for part in split_selection(selection):
        if "-" in part and not (part.startswith('"') and part.endswith('"')):
            a, b = part.split("-", 1)
            start = 0 if a == "" else parse_col(a, headers, ncols, has_headers)
            end = ncols - 1 if b == "" else parse_col(b, headers, ncols, has_headers)
            step = 1 if start <= end else -1
            idxs.extend(range(start, end + step, step))
        else:
            idxs.append(parse_col(part, headers, ncols, has_headers))
    if invert:
        s = set(idxs)
        idxs = [i for i in range(ncols) if i not in s]
    return idxs


def project(row, idxs):
    return [row[i] if i < len(row) else "" for i in idxs]


def cmd_headers(argv):
    p = argparse.ArgumentParser(prog="xsv headers", add_help=True)
    p.add_argument("-j", "--just-names", action="store_true")
    p.add_argument("--intersect", action="store_true")
    parse_common(p)
    p.add_argument("input", nargs="*")
    a = p.parse_args(argv)
    paths = a.input or [None]
    seen = []
    if a.intersect and len(paths) > 1:
        sets = []
        ordered = []
        for path in paths:
            rows = read_rows(path, a.delimiter)
            hs = rows[0] if rows else []
            sets.append(set(hs))
            if not ordered:
                ordered = hs
        common = set.intersection(*sets) if sets else set()
        seen = [h for h in ordered if h in common]
    else:
        for path in paths:
            rows = read_rows(path, a.delimiter)
            for h in (rows[0] if rows else []):
                if not a.intersect or h not in seen:
                    seen.append(h)
    just = a.just_names or len(paths) > 1
    for i, h in enumerate(seen, 1):
        if just:
            sys.stdout.write(h + "\n")
        else:
            sys.stdout.write("%d   %s\n" % (i, h))


def cmd_count(argv):
    p = argparse.ArgumentParser(prog="xsv count", add_help=True)
    parse_common(p, no_headers=True)
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    n = len(rows) if a.no_headers else max(0, len(rows) - 1)
    print(n)


def cmd_select(argv):
    p = argparse.ArgumentParser(prog="xsv select", add_help=True)
    parse_common(p, output=True, no_headers=True)
    p.add_argument("selection")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    if not rows:
        return
    headers = [str(i + 1) for i in range(len(rows[0]))] if a.no_headers else rows[0]
    ncols = len(headers)
    idxs = select_indices(a.selection, headers, ncols, not a.no_headers)
    body = rows if a.no_headers else rows[1:]
    out = ([] if a.no_headers else [project(headers, idxs)]) + [project(r, idxs) for r in body]
    write_rows(out, a.output)


def cmd_slice(argv):
    p = argparse.ArgumentParser(prog="xsv slice", add_help=True)
    p.add_argument("-s", "--start", type=int)
    p.add_argument("-e", "--end", type=int)
    p.add_argument("-l", "--len", type=int)
    p.add_argument("-i", "--index", type=int)
    parse_common(p, output=True, no_headers=True)
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    header = [] if a.no_headers or not rows else [rows[0]]
    body = rows if a.no_headers else rows[1:]
    if a.index is not None:
        part = body[a.index:a.index + 1] if 0 <= a.index < len(body) else []
    else:
        start = a.start or 0
        end = a.end if a.end is not None else None
        if a.len is not None:
            end = start + a.len
        part = body[start:end]
    write_rows(header + part, a.output)


def cmd_search(argv):
    p = argparse.ArgumentParser(prog="xsv search", add_help=True)
    p.add_argument("-i", "--ignore-case", action="store_true")
    p.add_argument("-v", "--invert-match", action="store_true")
    p.add_argument("--flag", dest="flag_name")
    parse_common(p, output=True, no_headers=True, select=True)
    p.add_argument("pattern")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    flags = re.I if a.ignore_case else 0
    rx = re.compile(a.pattern, flags)
    rows = read_rows(a.input, a.delimiter)
    if not rows:
        return
    headers = [str(i + 1) for i in range(len(rows[0]))] if a.no_headers else rows[0]
    idxs = list(range(len(headers))) if not a.select else select_indices(a.select, headers, len(headers), not a.no_headers)
    out = [] if a.no_headers else [headers + ([a.flag_name] if a.flag_name else [])]
    for r in (rows if a.no_headers else rows[1:]):
        ok = any(rx.search(r[i] if i < len(r) else "") for i in idxs)
        if a.invert_match:
            ok = not ok
        if ok or a.flag_name:
            out.append(r + (["1" if ok else "0"] if a.flag_name else []))
    write_rows(out, a.output)


def numeric_key(v):
    try:
        return (0, float(v))
    except Exception:
        return (1, v)


def cmd_sort(argv):
    p = argparse.ArgumentParser(prog="xsv sort", add_help=True)
    p.add_argument("-s", "--select", default=None)
    p.add_argument("-R", "--reverse", action="store_true")
    p.add_argument("-N", "--numeric", action="store_true")
    p.add_argument("-u", "--unique", action="store_true")
    p.add_argument("--no-case", action="store_true")
    parse_common(p, output=True, no_headers=True)
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    if not rows:
        return
    headers = [str(i + 1) for i in range(len(rows[0]))] if a.no_headers else rows[0]
    idxs = list(range(len(headers))) if not a.select else select_indices(a.select, headers, len(headers), not a.no_headers)
    body = rows if a.no_headers else rows[1:]
    def key(r):
        vals = [r[i] if i < len(r) else "" for i in idxs]
        if a.no_case:
            vals = [v.lower() for v in vals]
        return [numeric_key(v) for v in vals] if a.numeric else vals
    body = sorted(body, key=key, reverse=a.reverse)
    if a.unique:
        uniq, seen = [], set()
        for r in body:
            t = tuple(r)
            if t not in seen:
                uniq.append(r); seen.add(t)
        body = uniq
    write_rows(([] if a.no_headers else [headers]) + body, a.output)


def cmd_fmt(argv):
    p = argparse.ArgumentParser(prog="xsv fmt", add_help=True)
    p.add_argument("-t", "--out-delimiter", default=",")
    p.add_argument("--crlf", action="store_true")
    parse_common(p, output=True)
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    f = open_output(a.output)
    w = csv.writer(f, delimiter=one_char(a.out_delimiter), lineterminator="\r\n" if a.crlf else "\n")
    for row in rows:
        w.writerow(row)
    if f is not sys.stdout:
        f.close()


def cmd_table(argv):
    p = argparse.ArgumentParser(prog="xsv table", add_help=True)
    p.add_argument("-w", "--width", type=int, default=80)
    p.add_argument("-p", "--pad", type=int, default=2)
    parse_common(p)
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    if not rows:
        return
    widths = [0] * max(len(r) for r in rows)
    for r in rows:
        for i, v in enumerate(r):
            widths[i] = max(widths[i], len(v))
    sep = " " * a.pad
    for r in rows:
        print(sep.join((r[i] if i < len(r) else "").ljust(widths[i]) for i in range(len(widths))).rstrip())


def infer_num(xs):
    vals = []
    for x in xs:
        if x == "":
            continue
        try:
            vals.append(float(x))
        except Exception:
            return None
    return vals


def fmt_num(x):
    if x == "" or x is None:
        return ""
    if abs(x - int(x)) < 1e-12:
        return str(int(x))
    return ("%.15f" % x).rstrip("0").rstrip(".")


def stats_for(name, vals):
    nonnull = [v for v in vals if v != ""]
    nums = infer_num(vals)
    numeric = nums is not None
    lens = [len(v) for v in vals]
    counts = Counter(nonnull)
    mode = "N/A"
    if counts:
        mode_item = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0]
        if mode_item[1] > 1:
            mode = mode_item[0]
    if nums:
        s = sorted(nums)
        mean = sum(nums) / len(nums)
        std = math.sqrt(sum((x - mean) ** 2 for x in nums) / len(nums))
        med = statistics.median(s)
    else:
        mean = std = med = ""
    sorted_non = sorted(nonnull)
    return {
        "field": name,
        "type": "Integer" if numeric and all(float(x).is_integer() for x in nums) else ("Float" if numeric else ("Unicode" if nonnull else "NULL")),
        "sum": fmt_num(sum(nums)) if nums else "",
        "min": (fmt_num(min(nums)) if numeric and nums else (sorted_non[0] if sorted_non else "")),
        "max": (fmt_num(max(nums)) if numeric and nums else (sorted_non[-1] if sorted_non else "")),
        "min_length": str(min(lens)) if lens else "0",
        "max_length": str(max(lens)) if lens else "0",
        "mean": fmt_num(mean) if mean != "" else "",
        "stddev": fmt_num(std) if std != "" else "",
        "median": fmt_num(float(med)) if med != "" else "",
        "cardinality": str(len(counts)),
        "mode": mode,
    }


def cmd_stats(argv):
    p = argparse.ArgumentParser(prog="xsv stats", add_help=True)
    p.add_argument("--everything", action="store_true")
    parse_common(p, output=True, no_headers=True, select=True)
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    if not rows:
        return
    headers = [str(i) for i in range(len(rows[0]))] if a.no_headers else rows[0]
    idxs = list(range(len(headers))) if not a.select else select_indices(a.select, headers, len(headers), not a.no_headers)
    body = rows if a.no_headers else rows[1:]
    fields = ["field", "type", "sum", "min", "max", "min_length", "max_length", "mean", "stddev"]
    if a.everything:
        fields += ["median", "mode", "cardinality"]
    out = [fields]
    for i in idxs:
        vals = [(r[i] if i < len(r) else "") for r in body]
        st = stats_for(headers[i], vals)
        out.append([st[k] for k in fields])
    write_rows(out, a.output)


def cmd_frequency(argv):
    p = argparse.ArgumentParser(prog="xsv frequency", add_help=True)
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--asc", action="store_true")
    p.add_argument("--no-nulls", action="store_true")
    p.add_argument("-j", "--jobs", type=int, default=0)
    parse_common(p, output=True, no_headers=True, select=True)
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    if not rows:
        return
    headers = [str(i + 1) for i in range(len(rows[0]))] if a.no_headers else rows[0]
    idxs = list(range(len(headers))) if not a.select else select_indices(a.select, headers, len(headers), not a.no_headers)
    body = rows if a.no_headers else rows[1:]
    out = [["field", "value", "count"]]
    for i in idxs:
        c = Counter()
        for r in body:
            v = (r[i] if i < len(r) else "").strip()
            if not v:
                if a.no_nulls:
                    continue
                v = "(NULL)"
            c[v] += 1
        items = sorted(c.items(), key=lambda kv: (kv[1], kv[0]) if a.asc else (-kv[1], kv[0]))
        if a.limit > 0:
            items = items[:a.limit]
        for v, n in items:
            out.append([headers[i], v, str(n)])
    write_rows(out, a.output)


def dispatch(argv):
    if not argv:
        sys.stderr.write("xsv is a suite of CSV command line utilities.\n\nPlease choose one of the following commands:" + command_list())
        return 0
    if argv[0] in ("-h", "--help", "help"):
        sys.stdout.write("Usage:\n    xsv <command> [<args>...]\n    xsv [options]\n\nCommands:" + command_list())
        return 0
    if argv[0] == "--list":
        sys.stdout.write("Installed commands:" + command_list())
        return 0
    if argv[0] == "--version":
        print("xsv %s" % VERSION)
        return 0
    cmd, rest = argv[0].replace("-", "_"), argv[1:]
    funcs = {
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
    if cmd not in funcs:
        die("Unrecognized command: '%s'." % argv[0])
    funcs[cmd](rest)
    return 0


def main():
    try:
        raise SystemExit(dispatch(sys.argv[1:]))
    except BrokenPipeError:
        raise SystemExit(0)
    except csv.Error as e:
        die(e)


if __name__ == "__main__":
    main()
