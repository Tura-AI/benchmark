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


NULL = "(NULL)"


class XsvError(Exception):
    pass


def die(msg, code=1):
    sys.stderr.write(str(msg) + "\n")
    return code


def open_input(path):
    if path is None:
        return sys.stdin
    return open(path, "r", encoding="utf-8-sig", newline="")


def open_output(path):
    if path is None:
        return sys.stdout
    return open(path, "w", encoding="utf-8", newline="")


def read_rows(path=None, delimiter=","):
    with open_input(path) as f:
        return [row for row in csv.reader(f, delimiter=delimiter)]


def write_rows(rows, output=None, delimiter=",", lineterminator="\n",
               quotechar='"', quoting=csv.QUOTE_MINIMAL, escapechar=None,
               doublequote=True):
    out = (TextIOWrapper(sys.stdout.buffer, encoding="utf-8", newline="", write_through=True)
           if output is None else open_output(output))
    close = output is not None
    try:
        writer = csv.writer(out, delimiter=delimiter, lineterminator=lineterminator,
                            quotechar=quotechar, quoting=quoting,
                            escapechar=escapechar, doublequote=doublequote)
        for row in rows:
            writer.writerow(row)
    finally:
        if close:
            out.close()


def split_select(spec):
    out, cur, quoted, esc = [], [], False, False
    for ch in spec:
        if esc:
            cur.append(ch)
            esc = False
        elif ch == "\\":
            cur.append(ch)
        elif ch == '"':
            quoted = not quoted
            cur.append(ch)
        elif ch == "," and not quoted:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    if quoted:
        raise XsvError("unclosed quote")
    out.append("".join(cur))
    return out


def split_range(part):
    quoted = False
    for i, ch in enumerate(part):
        if ch == '"':
            quoted = not quoted
        elif ch == "-" and not quoted:
            return part[:i], part[i + 1:]
    return part, None


def parse_field_token(tok):
    tok = tok.strip()
    if tok == "":
        return None, None
    if tok.startswith('"'):
        end = 1
        while end < len(tok):
            if tok[end] == '"':
                if end + 1 < len(tok) and tok[end + 1] == '"':
                    end += 2
                    continue
                break
            end += 1
        if end >= len(tok) or tok[end] != '"':
            raise XsvError("unclosed quote")
        name = tok[1:end].replace('""', '"')
        rest = tok[end + 1:]
        idx = None
        if rest:
            m = re.fullmatch(r"\[([^\]]*)\]", rest)
            if not m:
                raise XsvError("invalid selector")
            if not m.group(1).isdigit():
                raise XsvError("invalid field index")
            idx = int(m.group(1))
        return name, idx
    idx = None
    m = re.search(r"\[([^\]]*)\]$", tok)
    if m:
        idx_s = m.group(1)
        if not idx_s.isdigit():
            raise XsvError("invalid field index")
        idx = int(idx_s)
        tok = tok[:m.start()]
    elif "[" in tok or "]" in tok:
        raise XsvError("unclosed bracket")
    if '"' in tok:
        raise XsvError("invalid selector")
    return tok, idx


def resolve_one(tok, headers, no_headers):
    parsed = parse_field_token(tok)
    if parsed == (None, None):
        return None
    name, dup_idx = parsed
    if no_headers:
        if dup_idx is not None:
            raise XsvError("field indices require headers")
        if not name.isdigit():
            raise XsvError("invalid field index")
        i = int(name)
        if i < 1 or i > len(headers):
            raise XsvError("field index out of bounds")
        return i - 1
    if name.isdigit():
        raise XsvError("field name looks like index")
    matches = [i for i, h in enumerate(headers) if h == name]
    if not matches:
        raise XsvError("unknown field")
    dup_idx = 0 if dup_idx is None else dup_idx
    if dup_idx >= len(matches):
        raise XsvError("field index out of bounds")
    return matches[dup_idx]


def selector_indices(spec, headers, no_headers=False):
    if spec in (None, ""):
        return list(range(len(headers)))
    negate = False
    if spec.startswith("!"):
        negate = True
        spec = spec[1:]
    idxs = []
    for part in split_select(spec):
        left, right = split_range(part)
        if right is None:
            idx = resolve_one(left, headers, no_headers)
            if idx is not None:
                idxs.append(idx)
            continue
        start = resolve_one(left, headers, no_headers) if left.strip() else 0
        end = resolve_one(right, headers, no_headers) if right.strip() else len(headers) - 1
        step = 1 if start <= end else -1
        idxs.extend(range(start, end + step, step))
    if negate:
        banned = set(idxs)
        return [i for i in range(len(headers)) if i not in banned]
    return idxs


def data_split(rows, no_headers):
    if not rows:
        return [], []
    if no_headers:
        return [str(i + 1) for i in range(len(rows[0]))], rows
    return rows[0], rows[1:]


def project(row, idxs):
    return [row[i] if i < len(row) else "" for i in idxs]


def cmd_headers(argv):
    p = argparse.ArgumentParser(prog="xsv headers", add_help=False)
    p.add_argument("-j", "--just-names", action="store_true")
    p.add_argument("--intersect", action="store_true")
    p.add_argument("-d", "--delimiter", default=",")
    p.add_argument("inputs", nargs="*")
    a = p.parse_args(argv)
    inputs = a.inputs or [None]
    headers = []
    seen = set()
    for inp in inputs:
        rows = read_rows(inp, a.delimiter)
        row = rows[0] if rows else []
        for h in row:
            if a.intersect and h in seen:
                continue
            headers.append(h)
            seen.add(h)
    just = a.just_names or len(inputs) > 1
    lines = []
    for i, h in enumerate(headers, 1):
        lines.append(h if just else f"{i}   {h}")
    sys.stdout.buffer.write("\n".join(lines).encode("utf-8"))
    if lines:
        sys.stdout.buffer.write(b"\n")
    return 0


def cmd_count(argv):
    p = argparse.ArgumentParser(prog="xsv count", add_help=False)
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter", default=",")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    n = len(rows) if a.no_headers else max(0, len(rows) - 1)
    sys.stdout.buffer.write((str(n) + "\n").encode("utf-8"))
    return 0


def cmd_select(argv):
    p = argparse.ArgumentParser(prog="xsv select", add_help=False)
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter", default=",")
    p.add_argument("-o", "--output")
    p.add_argument("selection")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    if not rows:
        return 0
    headers, body = data_split(rows, a.no_headers)
    idxs = selector_indices(a.selection, headers, a.no_headers)
    out = []
    if not a.no_headers:
        out.append(project(headers, idxs))
    out.extend(project(r, idxs) for r in body)
    write_rows(out, a.output)
    return 0


def cmd_slice(argv):
    p = argparse.ArgumentParser(prog="xsv slice", add_help=False)
    p.add_argument("--start", type=int)
    p.add_argument("--end", type=int)
    p.add_argument("--len", dest="length", type=int)
    p.add_argument("--index", type=int)
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter", default=",")
    p.add_argument("-o", "--output")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    headers, body = data_split(rows, a.no_headers)
    if a.index is not None:
        sliced = body[a.index:a.index + 1]
    else:
        start = a.start or 0
        end = a.end
        if a.length is not None:
            end = start + a.length
        sliced = body[start:end]
    out = ([] if a.no_headers or not rows else [headers]) + sliced
    write_rows(out, a.output)
    return 0


def cmd_search(argv):
    p = argparse.ArgumentParser(prog="xsv search", add_help=False)
    p.add_argument("-i", "--ignore-case", action="store_true")
    p.add_argument("-v", "--invert-match", action="store_true")
    p.add_argument("-s", "--select")
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter", default=",")
    p.add_argument("-o", "--output")
    p.add_argument("pattern")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    if not rows:
        return 0
    headers, body = data_split(rows, a.no_headers)
    idxs = selector_indices(a.select, headers, a.no_headers)
    rgx = re.compile(a.pattern, re.I if a.ignore_case else 0)
    out = []
    if not a.no_headers:
        out.append(headers)
    for r in body:
        hay = project(r, idxs)
        matched = any(rgx.search(v) for v in hay)
        if matched != a.invert_match:
            out.append(r)
    write_rows(out, a.output)
    return 0


def cmp_rows(a, b):
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
    except Exception:
        return None


def cmp_num_rows(a, b):
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


def cmd_sort(argv):
    p = argparse.ArgumentParser(prog="xsv sort", add_help=False)
    p.add_argument("-s", "--select")
    p.add_argument("-N", "--numeric", action="store_true")
    p.add_argument("-R", "--reverse", action="store_true")
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter", default=",")
    p.add_argument("-o", "--output")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    if not rows:
        return 0
    headers, body = data_split(rows, a.no_headers)
    idxs = selector_indices(a.select, headers, a.no_headers)
    cmpf = cmp_num_rows if a.numeric else cmp_rows

    def compare(r1, r2):
        c = cmpf(project(r1, idxs), project(r2, idxs))
        return -c if a.reverse else c

    body.sort(key=cmp_to_key(compare))
    out = ([] if a.no_headers else [headers]) + body
    write_rows(out, a.output)
    return 0


def cmd_table(argv):
    p = argparse.ArgumentParser(prog="xsv table", add_help=False)
    p.add_argument("-d", "--delimiter", default=",")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    if not rows:
        return 0
    widths = [0] * max(len(r) for r in rows)
    for r in rows:
        for i, v in enumerate(r):
            widths[i] = max(widths[i], len(v))
    for r in rows:
        parts = []
        for i, v in enumerate(r):
            if i == len(widths) - 1:
                parts.append(v)
            else:
                parts.append(v.ljust(widths[i] + 2))
        sys.stdout.buffer.write(("".join(parts).rstrip() + "\n").encode("utf-8"))
    return 0


def cmd_fmt(argv):
    p = argparse.ArgumentParser(prog="xsv fmt", add_help=False)
    p.add_argument("-t", "--out-delimiter", default=",")
    p.add_argument("--crlf", action="store_true")
    p.add_argument("--ascii", action="store_true")
    p.add_argument("--quote", default='"')
    p.add_argument("--quote-always", action="store_true")
    p.add_argument("--escape")
    p.add_argument("-d", "--delimiter", default=",")
    p.add_argument("-o", "--output")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    delim = "\x1f" if a.ascii else a.out_delimiter
    term = "\x1e" if a.ascii else ("\r\n" if a.crlf else "\n")
    write_rows(rows, a.output, delimiter=delim, lineterminator=term,
               quotechar=a.quote, quoting=csv.QUOTE_ALL if a.quote_always else csv.QUOTE_MINIMAL,
               escapechar=a.escape, doublequote=a.escape is None)
    return 0


def field_type(vals):
    typ = "NULL"
    for v in vals:
        t = "NULL" if v == "" else ("Integer" if parse_int(v) is not None else ("Float" if parse_float(v) is not None else "Unicode"))
        if t == "NULL":
            continue
        if typ == "NULL":
            typ = t
        elif typ == "Integer" and t == "Float":
            typ = "Float"
        elif typ == "Float" and t == "Integer":
            typ = "Float"
        elif typ != t:
            typ = "Unicode"
    return typ


def parse_int(s):
    try:
        if re.fullmatch(r"[+-]?\d+", s):
            return int(s)
    except Exception:
        return None
    return None


def parse_float(s):
    try:
        float(s)
        return float(s)
    except Exception:
        return None


def rust_float(v):
    if v == "":
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, float):
        return format(v, ".16g")
    return str(v)


def rust_std_float(v):
    s = rust_float(v)
    if abs(v) >= 5 and "." in s and s[-1] == "5" and len(s.rsplit(".", 1)[1]) >= 15:
        s = s[:-1] + str(int(s[-1]) - 1)
    return s


def cmd_stats(argv):
    p = argparse.ArgumentParser(prog="xsv stats", add_help=False)
    p.add_argument("-s", "--select")
    p.add_argument("--everything", action="store_true")
    p.add_argument("--mode", action="store_true")
    p.add_argument("--cardinality", action="store_true")
    p.add_argument("--median", action="store_true")
    p.add_argument("--nulls", action="store_true")
    p.add_argument("-j", "--jobs", default="0")
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter", default=",")
    p.add_argument("-o", "--output")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    if not rows:
        return 0
    headers, body = data_split(rows, a.no_headers)
    idxs = selector_indices(a.select, headers, a.no_headers)
    out_headers = ["field", "type", "sum", "min", "max", "min_length", "max_length", "mean", "stddev"]
    if a.median or a.everything:
        out_headers.append("median")
    if a.mode or a.everything:
        out_headers.append("mode")
    if a.cardinality or a.everything:
        out_headers.append("cardinality")
    out = [out_headers]
    for out_i, idx in enumerate(idxs):
        vals = [r[idx] if idx < len(r) else "" for r in body]
        typ = field_type(vals)
        non_null = [v for v in vals if v != ""]
        nums = [parse_float(v) for v in non_null if parse_float(v) is not None]
        row = [str(out_i) if a.no_headers else headers[idx], typ]
        if typ == "Integer":
            row.append(str(sum(parse_int(v) for v in non_null if parse_int(v) is not None)))
            intvals = [parse_int(v) for v in non_null if parse_int(v) is not None]
            row += [str(min(intvals)) if intvals else "", str(max(intvals)) if intvals else ""]
        elif typ == "Float":
            row.append(rust_float(sum(nums)))
            row += [rust_float(min(nums)) if nums else "", rust_float(max(nums)) if nums else ""]
        elif typ in ("Unicode", "Unknown"):
            row.append("")
            row += [min(non_null) if non_null else "", max(non_null) if non_null else ""]
        else:
            row += ["", "", ""]
        row += [str(min((len(v) for v in vals), default="")), str(max((len(v) for v in vals), default=""))]
        if typ in ("Integer", "Float") and nums:
            pop = nums + ([0.0] * (len(vals) - len(non_null)) if a.nulls else [])
            mean = sum(pop) / len(pop) if pop else 0.0
            std = math.sqrt(sum((x - mean) ** 2 for x in pop) / len(pop)) if pop else 0.0
            row += [rust_float(mean), rust_std_float(std)]
        else:
            row += ["", ""]
        if a.median or a.everything:
            row.append(rust_float(statistics.median(nums)) if nums else "")
        if a.mode or a.everything:
            c = Counter(vals)
            if "" in c:
                del c[""]
            if not c or max(c.values()) <= 1:
                row.append("N/A")
            else:
                maxc = max(c.values())
                row.append(next(v for v in vals if v in c and c[v] == maxc))
        if a.cardinality or a.everything:
            row.append(str(len(set(vals))))
        out.append(row)
    write_rows(out, a.output)
    return 0


def cmd_frequency(argv):
    p = argparse.ArgumentParser(prog="xsv frequency", add_help=False)
    p.add_argument("-s", "--select")
    p.add_argument("-l", "--limit", default="10")
    p.add_argument("-a", "--asc", action="store_true")
    p.add_argument("--no-nulls", action="store_true")
    p.add_argument("-j", "--jobs", default="0")
    p.add_argument("-n", "--no-headers", action="store_true")
    p.add_argument("-d", "--delimiter", default=",")
    p.add_argument("-o", "--output")
    p.add_argument("input", nargs="?")
    a = p.parse_args(argv)
    rows = read_rows(a.input, a.delimiter)
    if not rows:
        return 0
    headers, body = data_split(rows, a.no_headers)
    idxs = selector_indices(a.select, headers, a.no_headers)
    out = [["field", "value", "count"]]
    limit = int(a.limit)
    for out_i, idx in enumerate(idxs):
        c = Counter()
        for r in body:
            v = (r[idx] if idx < len(r) else "").strip()
            if v == "":
                if a.no_nulls:
                    continue
            c[v] += 1
        items = sorted(c.items(), key=lambda kv: kv[1] if a.asc else -kv[1])
        if limit > 0:
            items = items[:limit]
        field = str(out_i + 1) if a.no_headers else headers[idx]
        for v, n in items:
            out.append([field, NULL if v == "" else v, str(n)])
    write_rows(out, a.output)
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
    if not argv or argv[0] in ("-h", "--help"):
        sys.stderr.write("Usage: xsv <command> [options]\n")
        return 1
    cmd = argv.pop(0)
    func = COMMANDS.get(cmd)
    if func is None:
        return die(f"Unknown command: {cmd}")
    try:
        return func(argv)
    except XsvError as e:
        return die(e)
    except BrokenPipeError:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
