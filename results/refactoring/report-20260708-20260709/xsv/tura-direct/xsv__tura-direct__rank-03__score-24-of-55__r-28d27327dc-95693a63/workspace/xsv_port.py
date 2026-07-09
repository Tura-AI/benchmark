#!/usr/bin/env python3
import csv
import math
import os
import re
import statistics
import sys
from collections import Counter
from functools import cmp_to_key

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(newline='')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(newline='')


class XsvError(Exception):
    pass


def die(msg):
    sys.stderr.write("{}\n".format(msg))
    return 1


def parse_delim(s):
    if s is None:
        return ','
    if s == r'\t' or s == '\\t':
        return '\t'
    if len(s) != 1:
        raise XsvError("Could not convert '{}' to a single ASCII character.".format(s))
    return s


def open_text(path, mode):
    if path is None or path == '-':
        return sys.stdin if 'r' in mode else sys.stdout
    return open(path, mode, newline='', encoding='utf-8')


def read_csv(path=None, delimiter=',', no_headers=False):
    fh = open_text(path, 'r')
    try:
        rows = list(csv.reader(fh, delimiter=delimiter))
    finally:
        if fh not in (sys.stdin, sys.stdout):
            fh.close()
    if no_headers:
        return [], rows
    if rows:
        return rows[0], rows[1:]
    return [], []


def writer_for(path=None, delimiter=',', lineterminator='\n'):
    fh = open_text(path, 'w')
    return fh, csv.writer(fh, delimiter=delimiter, lineterminator=lineterminator)


def write_rows(rows, path=None, delimiter=',', lineterminator='\n'):
    fh, w = writer_for(path, delimiter, lineterminator)
    try:
        for row in rows:
            w.writerow(row)
    finally:
        if fh not in (sys.stdin, sys.stdout):
            fh.close()


def split_selection(s):
    parts, cur, quote = [], [], False
    i = 0
    while i < len(s):
        c = s[i]
        if c == '"':
            quote = not quote
            cur.append(c)
        elif c == ',' and not quote:
            parts.append(''.join(cur)); cur = []
        else:
            cur.append(c)
        i += 1
    parts.append(''.join(cur))
    return [p for p in parts if p != '']


def unquote_name(s):
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return s[1:-1]
    return s


def one_index(tok, headers, use_names):
    tok = unquote_name(tok)
    m = re.match(r'^(.*)\[(\d+)\]$', tok)
    nth = 0
    if m:
        tok, nth = m.group(1), int(m.group(2)) - 1
    if tok.isdigit():
        n = int(tok)
        if n < 1:
            raise XsvError("Selector index must be >= 1.")
        if n > len(headers):
            raise XsvError("Selector index {} is out of bounds. Index must be <= {}.".format(n, len(headers)))
        return n - 1
    if not use_names:
        raise XsvError("Cannot select field '{}' because there are no headers.".format(tok))
    seen = -1
    for i, h in enumerate(headers):
        if h == tok:
            seen += 1
            if seen == nth:
                return i
    raise XsvError("Selector '{}' did not match any field.".format(tok))


def find_range_dash(part):
    quote = False
    for i, c in enumerate(part):
        if c == '"':
            quote = not quote
        elif c == '-' and not quote:
            return i
    return -1


def select_indices(selection, headers, use_names=True):
    if selection is None or selection == '':
        return list(range(len(headers)))
    inv = selection.startswith('!')
    if inv:
        selection = selection[1:]
    out = []
    for part in split_selection(selection):
        dash = find_range_dash(part)
        if dash >= 0:
            a, b = part[:dash], part[dash+1:]
            start = 0 if a == '' else one_index(a, headers, use_names)
            end = len(headers) - 1 if b == '' else one_index(b, headers, use_names)
            step = 1 if start <= end else -1
            out.extend(range(start, end + step, step))
        else:
            out.append(one_index(part, headers, use_names))
    if inv:
        blocked = set(out)
        return [i for i in range(len(headers)) if i not in blocked]
    return out


def parse_common(args):
    opts = {'no_headers': False, 'delimiter': ',', 'output': None, 'select': None}
    rest = []
    i = 0
    while i < len(args):
        a = args[i]
        if a in ('-n', '--no-headers'):
            opts['no_headers'] = True
        elif a in ('-d', '--delimiter'):
            i += 1; opts['delimiter'] = parse_delim(args[i])
        elif a in ('-o', '--output'):
            i += 1; opts['output'] = args[i]
        elif a in ('-s', '--select', '--sel'):
            i += 1; opts['select'] = args[i]
        elif a == '--':
            rest.extend(args[i+1:]); break
        else:
            rest.append(a)
        i += 1
    return opts, rest


def cmd_headers(argv):
    just = False; intersect = False; delim = ','; paths = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ('-j', '--just-names'):
            just = True
        elif a == '--intersect':
            intersect = True
        elif a in ('-d', '--delimiter'):
            i += 1; delim = parse_delim(argv[i])
        elif a in ('-h', '--help'):
            sys.stdout.write('Prints the fields of the first row in the CSV data.\n') ; return 0
        else:
            paths.append(a)
        i += 1
    if not paths:
        paths = [None]
    names = []
    for p in paths:
        h, _ = read_csv(p, delim, False)
        for x in h:
            if not intersect or x not in names:
                names.append(x)
    if intersect and len(paths) > 1:
        sets = []
        for p in paths:
            h, _ = read_csv(p, delim, False); sets.append(set(h))
        names = [x for x in names if all(x in s for s in sets)]
    if len(paths) > 1:
        just = True
    for i, h in enumerate(names, 1):
        sys.stdout.write((h if just else '{}   {}'.format(i, h)) + '\n')
    return 0


def cmd_count(argv):
    opts, rest = parse_common(argv)
    _, rows = read_csv(rest[0] if rest else None, opts['delimiter'], opts['no_headers'])
    sys.stdout.write(str(len(rows)) + '\n')
    return 0


def cmd_select(argv):
    opts, rest = parse_common(argv)
    if not rest:
        raise XsvError('The following required arguments were not provided: <selection>')
    selstr = rest[0]; path = rest[1] if len(rest) > 1 else None
    headers, rows = read_csv(path, opts['delimiter'], opts['no_headers'])
    basis = headers if headers else (rows[0] if rows else [])
    idxs = select_indices(selstr, basis, not opts['no_headers'])
    out = []
    if not opts['no_headers'] and headers:
        out.append([headers[i] for i in idxs])
    out.extend([[r[i] if i < len(r) else '' for i in idxs] for r in rows])
    write_rows(out, opts['output'], opts['delimiter'])
    return 0


def cmd_slice(argv):
    opts, rest = parse_common(argv)
    start = 0; end = None; length = None; index = None
    i = 0; paths = []
    while i < len(rest):
        a = rest[i]
        if a in ('-s', '--start'):
            i += 1; start = int(rest[i])
        elif a in ('-e', '--end'):
            i += 1; end = int(rest[i])
        elif a in ('-l', '--len'):
            i += 1; length = int(rest[i])
        elif a in ('-i', '--index'):
            i += 1; index = int(rest[i])
        else:
            paths.append(a)
        i += 1
    headers, rows = read_csv(paths[0] if paths else None, opts['delimiter'], opts['no_headers'])
    if index is not None:
        start, end = index, index + 1
    elif length is not None:
        end = start + length
    sliced = rows[start:end]
    out = ([] if opts['no_headers'] or not headers else [headers]) + sliced
    write_rows(out, opts['output'], opts['delimiter'])
    return 0


def cmd_search(argv):
    opts, rest = parse_common(argv)
    icase = False; invert = False; pattern = None; paths = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ('-i', '--ignore-case'):
            icase = True
        elif a in ('-v', '--invert-match'):
            invert = True
        elif pattern is None:
            pattern = a
        else:
            paths.append(a)
        i += 1
    if pattern is None:
        raise XsvError('The following required arguments were not provided: <regex>')
    flags = re.I if icase else 0
    rx = re.compile(pattern, flags)
    headers, rows = read_csv(paths[0] if paths else None, opts['delimiter'], opts['no_headers'])
    basis = headers if headers else (rows[0] if rows else [])
    idxs = select_indices(opts['select'], basis, not opts['no_headers']) if opts['select'] else list(range(len(basis)))
    out = [] if opts['no_headers'] or not headers else [headers]
    for r in rows:
        m = any(rx.search(r[i] if i < len(r) else '') for i in idxs)
        if m != invert:
            out.append(r)
    write_rows(out, opts['output'], opts['delimiter'])
    return 0


def row_cmp(a, b, idxs, numeric):
    vals_a = [a[i] if i < len(a) else '' for i in idxs]
    vals_b = [b[i] if i < len(b) else '' for i in idxs]
    if numeric:
        for x, y in zip(vals_a, vals_b):
            try: fx = float(x)
            except ValueError: fx = None
            try: fy = float(y)
            except ValueError: fy = None
            if fx is None and fy is None:
                c = (x > y) - (x < y)
            elif fx is None:
                c = -1
            elif fy is None:
                c = 1
            else:
                c = (fx > fy) - (fx < fy)
            if c: return c
        return (len(vals_a) > len(vals_b)) - (len(vals_a) < len(vals_b))
    return (vals_a > vals_b) - (vals_a < vals_b)


def cmd_sort(argv):
    opts, rest = parse_common(argv)
    numeric = False; reverse = False; paths = []
    for a in rest:
        if a in ('-N', '--numeric'):
            numeric = True
        elif a in ('-R', '--reverse'):
            reverse = True
        else:
            paths.append(a)
    headers, rows = read_csv(paths[0] if paths else None, opts['delimiter'], opts['no_headers'])
    basis = headers if headers else (rows[0] if rows else [])
    idxs = select_indices(opts['select'], basis, not opts['no_headers']) if opts['select'] else list(range(len(basis)))
    rows.sort(key=cmp_to_key(lambda a, b: row_cmp(a, b, idxs, numeric)), reverse=reverse)
    out = ([] if opts['no_headers'] or not headers else [headers]) + rows
    write_rows(out, opts['output'], opts['delimiter'])
    return 0


def cmd_fmt(argv):
    opts, rest = parse_common(argv)
    out_delim = opts['delimiter']; crlf = False; paths = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ('-t', '--out-delimiter'):
            i += 1; out_delim = parse_delim(rest[i])
        elif a == '--crlf':
            crlf = True
        else:
            paths.append(a)
        i += 1
    h, rows = read_csv(paths[0] if paths else None, opts['delimiter'], opts['no_headers'])
    out = ([] if opts['no_headers'] or not h else [h]) + rows
    write_rows(out, opts['output'], out_delim, '\r\n' if crlf else '\n')
    return 0


def cmd_table(argv):
    opts, rest = parse_common(argv)
    h, rows = read_csv(rest[0] if rest else None, opts['delimiter'], opts['no_headers'])
    data = ([] if opts['no_headers'] or not h else [h]) + rows
    if not data:
        return 0
    width = [0] * max(len(r) for r in data)
    for r in data:
        for i, v in enumerate(r):
            width[i] = max(width[i], len(v))
    for r in data:
        parts = []
        for i, v in enumerate(r):
            if i + 1 == len(r):
                parts.append(v)
            else:
                parts.append(v + (' ' * (width[i] - len(v))) + '  ')
        sys.stdout.write(''.join(parts) + '\n')
    return 0


def numeric_values(rows, idx):
    vals = []
    for r in rows:
        if idx < len(r) and r[idx] != '':
            try: vals.append(float(r[idx]))
            except ValueError: pass
    return vals


def cmd_stats(argv):
    opts, rest = parse_common(argv)
    everything = False; paths = []
    for a in rest:
        if a == '--everything':
            everything = True
        else:
            paths.append(a)
    h, rows = read_csv(paths[0] if paths else None, opts['delimiter'], opts['no_headers'])
    basis = h if h else (rows[0] if rows else [])
    idxs = select_indices(opts['select'], basis, not opts['no_headers']) if opts['select'] else list(range(len(basis)))
    header = ['field', 'type', 'sum', 'min', 'max', 'min_length', 'max_length', 'mean', 'stddev']
    out = [header]
    for pos, idx in enumerate(idxs):
        name = basis[idx] if idx < len(basis) and not opts['no_headers'] else str(pos + 1)
        vals = numeric_values(rows, idx)
        fields = [r[idx] for r in rows if idx < len(r)]
        lens = [len(x) for x in fields]
        typ = 'Integer' if vals and all(float(v).is_integer() for v in vals) else ('Float' if vals else 'Unicode')
        s = sum(vals) if vals else None
        mn = min(vals) if vals else None
        mx = max(vals) if vals else None
        mean = statistics.mean(vals) if vals else None
        std = statistics.pstdev(vals) if len(vals) > 1 else (0.0 if vals else None)
        def f(x):
            if x is None: return ''
            if isinstance(x, float) and x.is_integer(): return str(int(x))
            return str(x)
        out.append([name, typ, f(s), f(mn), f(mx), f(min(lens) if lens else None), f(max(lens) if lens else None), f(mean), f(std)])
    write_rows(out, opts['output'], opts['delimiter'])
    return 0


def cmd_frequency(argv):
    opts, rest = parse_common(argv)
    limit = 10; asc = False; no_nulls = False; paths = []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ('-l', '--limit'):
            i += 1; limit = int(rest[i])
        elif a in ('-a', '--asc'):
            asc = True
        elif a == '--no-nulls':
            no_nulls = True
        elif a in ('-j', '--jobs'):
            i += 1
        else:
            paths.append(a)
        i += 1
    h, rows = read_csv(paths[0] if paths else None, opts['delimiter'], opts['no_headers'])
    basis = h if h else (rows[0] if rows else [])
    idxs = select_indices(opts['select'], basis, not opts['no_headers']) if opts['select'] else list(range(len(basis)))
    out = [['field', 'value', 'count']]
    for pos, idx in enumerate(idxs):
        name = basis[idx] if idx < len(basis) and not opts['no_headers'] else str(pos + 1)
        c = Counter()
        for r in rows:
            v = (r[idx] if idx < len(r) else '').strip()
            if v == '' and no_nulls:
                continue
            c[v if v != '' else '(NULL)'] += 1
        items = sorted(c.items(), key=lambda kv: kv[1] if asc else -kv[1])
        if limit > 0:
            items = items[:limit]
        out.extend([[name, v, str(n)] for v, n in items])
    write_rows(out, opts['output'], opts['delimiter'])
    return 0


COMMANDS = {
    'headers': cmd_headers, 'count': cmd_count, 'select': cmd_select,
    'slice': cmd_slice, 'search': cmd_search, 'sort': cmd_sort,
    'table': cmd_table, 'fmt': cmd_fmt, 'stats': cmd_stats,
    'frequency': cmd_frequency,
}


def main(argv):
    if not argv or argv[0] in ('-h', '--help', 'help'):
        sys.stdout.write('xsv 0.13.0\n')
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd not in COMMANDS:
        return die('Unrecognized command: {}'.format(cmd))
    try:
        return COMMANDS[cmd](rest)
    except BrokenPipeError:
        return 1
    except (XsvError, OSError, csv.Error, re.error, ValueError) as e:
        return die('error: {}'.format(e))


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
