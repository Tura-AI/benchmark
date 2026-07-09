import argparse
import csv
import functools
import math
import os
import re
import statistics
import sys
from collections import Counter


def die(msg):
    sys.stderr.buffer.write((str(msg) + "\n").encode("utf-8", "replace"))
    return 1


def delim(s):
    if s == r"\t":
        return "\t"
    if len(s) != 1 or ord(s) > 127:
        raise argparse.ArgumentTypeError("Could not convert '%s' to a single ASCII character." % s)
    return s


def default_delimiter(path, explicit=None):
    if explicit is not None:
        return explicit
    if path and path != "-" and os.path.splitext(path)[1] == ".tsv":
        return "\t"
    return ","


def open_in(path):
    if path in (None, "-"):
        return sys.stdin
    return open(path, newline="", encoding="utf-8-sig")


def open_out(path):
    if path in (None, "-"):
        return sys.stdout
    return open(path, "w", newline="", encoding="utf-8")


def read_rows(path=None, delimiter=None, no_headers=False):
    d = default_delimiter(path, delimiter)
    with open_in(path) as f:
        return [r for r in csv.reader(f, delimiter=d, quotechar='"', doublequote=True) if r != []]


def write_rows(rows, path=None, delimiter=",", lineterminator="\n",
               quotechar='"', quoting=csv.QUOTE_MINIMAL, escapechar=None,
               doublequote=True):
    import io
    buf = io.StringIO(newline="")
    w = csv.writer(buf, delimiter=delimiter, quotechar=quotechar,
                   lineterminator=lineterminator, quoting=quoting,
                   escapechar=escapechar, doublequote=doublequote)
    w.writerows(rows)
    data = buf.getvalue()
    if path in (None, "-"):
        sys.stdout.buffer.write(data.encode("utf-8"))
    else:
        with open(path, "w", newline="", encoding="utf-8") as f:
            f.write(data)


def write_text(data, path=None):
    if path in (None, "-"):
        sys.stdout.buffer.write(data.encode("utf-8"))
    else:
        with open(path, "w", newline="", encoding="utf-8") as f:
            f.write(data)


def old_write_rows_unused(rows, path=None, delimiter=",", lineterminator="\n",
               quotechar='"', quoting=csv.QUOTE_MINIMAL, escapechar=None,
               doublequote=True):
    with open_out(path) as f:
        w = csv.writer(f, delimiter=delimiter, quotechar=quotechar,
                       lineterminator=lineterminator, quoting=quoting,
                       escapechar=escapechar, doublequote=doublequote)
        w.writerows(rows)


class SelectError(Exception):
    pass


def parse_select(s):
    inv = s.startswith("!")
    if inv:
        s = s[1:]
    if s == "":
        return inv, []
    p, out = 0, []

    def cur():
        return s[p] if p < len(s) else None

    def end_field():
        return cur() is None or cur() in ",-"

    def parse_name():
        nonlocal p
        name = ""
        if cur() == '"':
            p += 1
            while True:
                if cur() is None:
                    raise SelectError('Unclosed quote, missing closing ".')
                if cur() == '"':
                    p += 1
                    if cur() == '"':
                        p += 1
                        name += '""'
                        continue
                    break
                name += cur()
                p += 1
        else:
            while cur() is not None and cur() not in ",-[":
                name += cur()
                p += 1
        return name

    def parse_one():
        nonlocal p
        if cur() == "-":
            return ("start", None, None)
        name = parse_name()
        idx = None
        if cur() == "[":
            p += 1
            raw = ""
            while True:
                if cur() is None:
                    raise SelectError("Unclosed index bracket, missing closing ].")
                if cur() == "]":
                    p += 1
                    break
                raw += cur()
                p += 1
            try:
                idx = int(raw)
            except ValueError as e:
                raise SelectError("Could not convert '%s' to an integer: %s" % (raw, e))
        if idx is None:
            try:
                return ("index", int(name), None)
            except ValueError:
                return ("name", name, 0)
        return ("name", name, idx)

    while p < len(s):
        a = ("start", None, None) if cur() == "-" else parse_one()
        b = None
        if cur() == "-":
            p += 1
            b = ("end", None, None) if cur() is None or cur() == "," else parse_one()
        if cur() is not None and cur() != ",":
            raise SelectError("Expected end of field but got '%s' instead." % cur())
        out.append((a, b))
        if cur() == ",":
            p += 1
    return inv, out


def selector_index(sel, header, use_names):
    kind, val, nth = sel
    n = len(header)
    if kind == "start":
        return 0
    if kind == "end":
        return max(0, n - 1)
    if kind == "index":
        if val < 1 or val > n:
            raise SelectError("Selector index %d is out of bounds. Index must be >= 1 and <= %d." % (val, n))
        return val - 1
    if not use_names:
        raise SelectError("Cannot use names ('%s') in selection with --no-headers set." % val)
    found = [i for i, h in enumerate(header) if h == val]
    if not found:
        raise SelectError("Selector name '%s' does not exist as a named header in the given CSV data." % val)
    if nth < 0 or nth >= len(found):
        raise SelectError("Selector index '%s' for name '%s' is out of bounds. Must be >= 0 and <= %d." % (nth, val, len(found)-1))
    return found[nth]


def selection(spec, first, use_names=True):
    inv, sels = parse_select(spec or "")
    if not sels:
        inds = list(range(len(first)))
    else:
        inds = []
        for a, b in sels:
            ia = selector_index(a, first, use_names)
            if b is None:
                inds.append(ia)
            else:
                ib = selector_index(b, first, use_names)
                step = 1 if ia <= ib else -1
                inds.extend(range(ia, ib + step, step))
    if inv:
        bad = set(inds)
        inds = [i for i in range(len(first)) if i not in bad]
    return inds


def split_header(rows, no_headers):
    if not rows:
        return [], []
    if no_headers:
        return rows[0], rows
    return rows[0], rows[1:]


def cmd_count(args):
    rows = read_rows(args.input, args.delimiter)
    sys.stdout.buffer.write(("%d\n" % (len(rows) if args.no_headers else max(0, len(rows)-1))).encode("ascii"))


def cmd_headers(args):
    inputs = args.input or ["-"]
    headers = []
    for inp in inputs:
        rows = read_rows(inp, args.delimiter)
        if rows:
            for h in rows[0]:
                if (not args.intersect) or h not in headers:
                    headers.append(h)
    just = args.just_names or len(inputs) > 1
    lines = []
    for i, h in enumerate(headers, 1):
        lines.append(h if just else (str(i) + "   " + h))
    write_text("\n".join(lines) + ("\n" if lines else ""))


def cmd_select(args):
    rows = read_rows(args.input, args.delimiter)
    if not rows:
        return
    first = rows[0]
    inds = selection(args.selection, first, not args.no_headers)
    out = []
    if not args.no_headers:
        out.append([first[i] for i in inds])
        data = rows[1:]
    else:
        data = rows
    out.extend([[r[i] if i < len(r) else "" for i in inds] for r in data])
    write_rows(out, args.output)


def cmd_slice(args):
    if args.index is not None and (args.start is not None or args.end is not None or args.len is not None):
        raise SelectError("--index cannot be used with --start, --end or --len")
    if args.end is not None and args.len is not None:
        raise SelectError("--end and --len cannot be used at the same time.")
    rows = read_rows(args.input, args.delimiter)
    header, data = split_header(rows, args.no_headers)
    start = args.index if args.index is not None else (args.start or 0)
    end = start + 1 if args.index is not None else (args.end if args.end is not None else (start + args.len if args.len is not None else len(data)))
    if end < start:
        raise SelectError("The end of the range (%d) must be greater than or\nequal to the start of the range (%d)." % (end, start))
    out = ([] if args.no_headers or not rows else [header]) + data[start:end]
    write_rows(out, args.output)


def cmd_search(args):
    rows = read_rows(args.input, args.delimiter)
    if not rows:
        return
    header, data = split_header(rows, args.no_headers)
    inds = selection(args.select or "", header, not args.no_headers)
    rx = re.compile(args.regex, re.I if args.ignore_case else 0)
    out = [] if args.no_headers else [header]
    for r in data:
        m = any(rx.search(r[i] if i < len(r) else "") for i in inds)
        if args.invert_match:
            m = not m
        if m:
            out.append(r)
    write_rows(out, args.output)


def cmp_rows(a, b, inds, numeric):
    for i in inds:
        av = a[i] if i < len(a) else ""
        bv = b[i] if i < len(b) else ""
        if numeric:
            try:
                ax = int(av)
            except ValueError:
                try: ax = float(av)
                except ValueError: ax = None
            try:
                bx = int(bv)
            except ValueError:
                try: bx = float(bv)
                except ValueError: bx = None
            if ax is None and bx is None:
                continue
            if ax is None:
                return -1
            if bx is None:
                return 1
            if ax < bx: return -1
            if ax > bx: return 1
        else:
            if av < bv: return -1
            if av > bv: return 1
    return 0


def cmd_sort(args):
    rows = read_rows(args.input, args.delimiter)
    if not rows:
        return
    header, data = split_header(rows, args.no_headers)
    inds = selection(args.select or "", header, not args.no_headers)
    key = functools.cmp_to_key(lambda a, b: cmp_rows(a, b, inds, args.numeric))
    data = sorted(data, key=key, reverse=args.reverse)
    write_rows(([] if args.no_headers else [header]) + data, args.output)


def cmd_fmt(args):
    rows = read_rows(args.input, args.delimiter)
    outd = "\x1f" if args.ascii else (args.out_delimiter or ",")
    term = "\x1e" if args.ascii else ("\r\n" if args.crlf else "\n")
    quoting = csv.QUOTE_ALL if args.quote_always else csv.QUOTE_MINIMAL
    esc = args.escape
    write_rows(rows, args.output, outd, term, args.quote, quoting, esc, esc is None)


def condense(s, n):
    if n is None:
        return s
    return s if len(s) <= n else s[:n] + "..."


def cmd_table(args):
    rows = [[condense(c, args.condense) for c in r] for r in read_rows(args.input, args.delimiter)]
    if not rows:
        return
    widths = []
    for r in rows:
        for i, c in enumerate(r):
            if i == len(widths): widths.append(args.width)
            widths[i] = max(widths[i], len(c))
    lines = []
    for r in rows:
        parts = []
        for i, c in enumerate(r):
            if i == len(r) - 1:
                parts.append(c)
            else:
                parts.append(c + " " * (widths[i] - len(c) + args.pad))
        lines.append("".join(parts).rstrip())
    write_text("\n".join(lines) + "\n", args.output)


def field_type(vals):
    typ = "NULL"
    for s in vals:
        t = sample_type(s)
        if typ == "NULL": typ = t
        elif t == "NULL": pass
        elif typ == "Unknown" or t == "Unknown": typ = "Unknown"
        elif typ == t: pass
        elif (typ, t) in (("Integer","Float"),("Float","Integer")): typ = "Float"
        else: typ = "Unicode"
    return typ


def sample_type(s):
    if s == "": return "NULL"
    try:
        int(s); return "Integer"
    except ValueError:
        pass
    try:
        float(s); return "Float"
    except ValueError:
        return "Unicode"


def fmt_num(x):
    if isinstance(x, int) or x.is_integer():
        return str(int(x))
    return repr(float(x))


def cmd_stats(args):
    rows = read_rows(args.input, args.delimiter)
    if not rows:
        write_rows([stat_headers(args)], args.output); return
    header, data = split_header(rows, args.no_headers)
    inds = selection(args.select or "", header, not args.no_headers)
    out = [stat_headers(args)]
    for pos, i in enumerate(inds):
        vals = [r[i] if i < len(r) else "" for r in data]
        typ = field_type(vals)
        nums = [float(v) for v in vals if v != "" and sample_type(v) in ("Integer","Float")]
        nonnull = [v for v in vals if v != ""]
        lengths = [len(v.encode("utf-8")) for v in vals]
        row = [str(pos) if args.no_headers else header[i], typ]
        row.append("" if typ in ("NULL","Unicode","Unknown") else fmt_num(sum(nums)))
        if typ == "Integer":
            ints = [int(float(v)) for v in vals if v != "" and sample_type(v) in ("Integer","Float")]
            row += [str(min(ints)) if ints else "", str(max(ints)) if ints else ""]
        elif typ == "Float":
            row += [fmt_num(min(nums)) if nums else "", fmt_num(max(nums)) if nums else ""]
        elif typ in ("Unicode","Unknown"):
            row += [min(nonnull) if nonnull else "", max(nonnull) if nonnull else ""]
        else:
            row += ["", ""]
        row += [str(min(lengths)) if lengths else "", str(max(lengths)) if lengths else ""]
        dist_vals = nums[:]
        if args.nulls:
            dist_vals += [0.0] * sum(1 for v in vals if v == "")
        if typ in ("Integer","Float") and dist_vals:
            mean = sum(dist_vals) / len(dist_vals)
            var = sum((x - mean) ** 2 for x in dist_vals) / len(dist_vals)
            row += [fmt_num(mean), repr(math.sqrt(var))]
        else:
            row += ["", ""]
        if args.median or args.everything:
            row.append(fmt_num(statistics.median(nums)) if nums else "")
        c = Counter(vals)
        if args.mode or args.everything:
            if not c: row.append("N/A")
            else:
                mx = max(c.values())
                modes = [k for k, v in c.items() if v == mx]
                row.append(modes[0] if mx > 1 else "N/A")
        if args.cardinality or args.everything:
            row.append(str(len(c)))
        out.append(row)
    write_rows(out, args.output)


def stat_headers(args):
    h = ["field","type","sum","min","max","min_length","max_length","mean","stddev"]
    if args.median or args.everything: h.append("median")
    if args.mode or args.everything: h.append("mode")
    if args.cardinality or args.everything: h.append("cardinality")
    return h


def cmd_frequency(args):
    rows = read_rows(args.input, args.delimiter)
    if not rows:
        write_rows([["field","value","count"]], args.output); return
    header, data = split_header(rows, args.no_headers)
    inds = selection(args.select or "", header, not args.no_headers)
    out = [["field","value","count"]]
    for outpos, i in enumerate(sorted(set(inds))):
        vals = []
        for r in data:
            v = (r[i] if i < len(r) else "").strip()
            if v == "" and args.no_nulls:
                continue
            vals.append(v)
        c = Counter(vals)
        def tie_key(v):
            return (0, "") if v == "" else ((2, v) if v == "(NULL)" else (1, v))
        items = list(c.items())
        items.sort(key=lambda kv: ((kv[1], tie_key(kv[0])) if args.asc else (-kv[1], tie_key(kv[0]))))
        if args.limit > 0:
            items = items[:args.limit]
        fname = str(outpos + 1) if args.no_headers else header[i]
        for v, n in items:
            out.append([fname, "(NULL)" if v == "" else v, str(n)])
    write_rows(out, args.output)


def parser():
    p = argparse.ArgumentParser(prog="xsv", add_help=False)
    p.add_argument("--list", action="store_true")
    p.add_argument("--version", action="store_true")
    p.add_argument("cmd", nargs="?")
    p.add_argument("rest", nargs=argparse.REMAINDER)
    return p


def subparser(name):
    p = argparse.ArgumentParser(prog="xsv " + name)
    p.add_argument("-d","--delimiter", type=delim)
    return p


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        sys.stderr.write("xsv is a suite of CSV command line utilities.\n")
        return 0
    cmd, rest = argv[0], argv[1:]
    try:
        if cmd == "count":
            p = subparser(cmd); p.add_argument("-n","--no-headers", action="store_true"); p.add_argument("input", nargs="?"); cmd_count(p.parse_args(rest))
        elif cmd == "headers":
            p = subparser(cmd); p.add_argument("-j","--just-names", action="store_true"); p.add_argument("--intersect", action="store_true"); p.add_argument("input", nargs="*"); cmd_headers(p.parse_args(rest))
        elif cmd == "select":
            p = subparser(cmd); p.add_argument("-o","--output"); p.add_argument("-n","--no-headers", action="store_true"); p.add_argument("selection"); p.add_argument("input", nargs="?"); cmd_select(p.parse_args([x for x in rest if x != "--"]))
        elif cmd == "slice":
            p = subparser(cmd); p.add_argument("-o","--output"); p.add_argument("-n","--no-headers", action="store_true"); p.add_argument("-s","--start", type=int); p.add_argument("-e","--end", type=int); p.add_argument("-l","--len", type=int); p.add_argument("-i","--index", type=int); p.add_argument("input", nargs="?"); cmd_slice(p.parse_args(rest))
        elif cmd == "search":
            p = subparser(cmd); p.add_argument("-o","--output"); p.add_argument("-n","--no-headers", action="store_true"); p.add_argument("-s","--select"); p.add_argument("-v","--invert-match", action="store_true"); p.add_argument("-i","--ignore-case", action="store_true"); p.add_argument("regex"); p.add_argument("input", nargs="?"); cmd_search(p.parse_args(rest))
        elif cmd == "sort":
            p = subparser(cmd); p.add_argument("-o","--output"); p.add_argument("-n","--no-headers", action="store_true"); p.add_argument("-s","--select"); p.add_argument("-N","--numeric", action="store_true"); p.add_argument("-R","--reverse", action="store_true"); p.add_argument("input", nargs="?"); cmd_sort(p.parse_args(rest))
        elif cmd == "fmt":
            p = subparser(cmd); p.add_argument("-o","--output"); p.add_argument("-t","--out-delimiter", type=delim); p.add_argument("--crlf", action="store_true"); p.add_argument("--ascii", action="store_true"); p.add_argument("--quote", type=delim, default='"'); p.add_argument("--quote-always", action="store_true"); p.add_argument("--escape", type=delim); p.add_argument("input", nargs="?"); cmd_fmt(p.parse_args(rest))
        elif cmd == "table":
            p = subparser(cmd); p.add_argument("-o","--output"); p.add_argument("-w","--width", type=int, default=2); p.add_argument("-p","--pad", type=int, default=2); p.add_argument("-c","--condense", type=int); p.add_argument("input", nargs="?"); cmd_table(p.parse_args(rest))
        elif cmd == "stats":
            p = subparser(cmd); p.add_argument("-o","--output"); p.add_argument("-n","--no-headers", action="store_true"); p.add_argument("-s","--select"); p.add_argument("--everything", action="store_true"); p.add_argument("--mode", action="store_true"); p.add_argument("--cardinality", action="store_true"); p.add_argument("--median", action="store_true"); p.add_argument("--nulls", action="store_true"); p.add_argument("-j","--jobs", type=int, default=0); p.add_argument("input", nargs="?"); cmd_stats(p.parse_args(rest))
        elif cmd == "frequency":
            p = subparser(cmd); p.add_argument("-o","--output"); p.add_argument("-n","--no-headers", action="store_true"); p.add_argument("-s","--select"); p.add_argument("-l","--limit", type=int, default=10); p.add_argument("-a","--asc", action="store_true"); p.add_argument("--no-nulls", action="store_true"); p.add_argument("-j","--jobs", type=int, default=0); p.add_argument("input", nargs="?"); cmd_frequency(p.parse_args(rest))
        elif cmd in ("--version", "-V"):
            print("0.13.0")
        else:
            return die("Unrecognized command '%s'." % cmd)
        return 0
    except (OSError, csv.Error, SelectError, re.error) as e:
        return die(e)


if __name__ == "__main__":
    sys.exit(main())
