#!/usr/bin/env python3
import csv
import glob
import io
import json
import math
import os
import re
import statistics
import sys
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path


class NuError(Exception):
    def __init__(self, message, status=1):
        super().__init__(message)
        self.status = status


class NoNewline(str):
    pass


@dataclass
class RangeVal:
    start: object
    end: object | None
    step: object | None = None
    inclusive: bool = True


@dataclass
class Token:
    kind: str
    text: str


OPS = ["..<=", "..<", "==", "!=", "<=", ">=", "=~", "!~", "**", "++", "..", ";", "|", "(", ")", "[", "]", "{", "}", ",", ":", ".", "+", "-", "*", "/", "<", ">", "="]
OPS.sort(key=len, reverse=True)


def tokenize(src: str) -> list[Token]:
    out: list[Token] = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c.isspace():
            i += 1
            continue
        if c == '#':
            while i < n and src[i] not in "\r\n":
                i += 1
            continue
        if c in "'\"":
            q = c
            i += 1
            buf = []
            while i < n:
                c = src[i]
                if c == q:
                    i += 1
                    break
                if q == '"' and c in ('\\', '`') and i + 1 < n:
                    nxt = src[i + 1]
                    maps = {'n': '\n', 'r': '\r', 't': '\t', '"': '"', '\\': '\\'}
                    buf.append(maps.get(nxt, nxt))
                    i += 2
                else:
                    buf.append(c)
                    i += 1
            else:
                raise NuError(f"expected closing {q}")
            out.append(Token('str', ''.join(buf)))
            continue
        if c == '$' and i + 1 < n and src[i + 1] == "'":
            j = i + 2
            k = src.find("'", j)
            if k < 0:
                raise NuError("expected closing '")
            inner = src[j:k]
            out.append(Token('str', str(eval_script(inner, {}, None))))
            i = k + 1
            continue
        if c == 'r' and i + 1 < n and src[i + 1] == '#':
            j = i + 1
            while j < n and src[j] == '#':
                j += 1
            if j < n and src[j] == "'":
                hashes = src[i + 1:j]
                end = "'" + hashes
                k = src.find(end, j + 1)
                if k < 0:
                    raise NuError(f"expected closing {end}")
                out.append(Token('str', src[j + 1:k]))
                i = k + len(end)
                continue
        matched = False
        for op in OPS:
            if src.startswith(op, i):
                out.append(Token(op, op))
                i += len(op)
                matched = True
                break
        if matched:
            continue
        if c.isdigit() or (c == '-' and i + 1 < n and src[i + 1].isdigit()):
            j = i + 1
            while j < n and (src[j].isalnum() or src[j] in '._'):
                if src.startswith('..', j):
                    break
                j += 1
            out.append(Token('num', src[i:j].replace('_', '')))
            i = j
            continue
        if c.isalpha() or c in '_$':
            j = i + 1
            while j < n and (src[j].isalnum() or src[j] in '_-$?'):
                j += 1
            out.append(Token('word', src[i:j]))
            i = j
            continue
        raise NuError(f"invalid characters: {c}")
    out.append(Token('eof', ''))
    return out


class Parser:
    def __init__(self, toks, env=None, inp=None):
        self.toks = toks
        self.i = 0
        self.env = env if env is not None else {}
        self.inp = inp

    def peek(self): return self.toks[self.i]
    def pop(self):
        t = self.toks[self.i]; self.i += 1; return t
    def at(self, *k): return self.peek().kind in k or self.peek().text in k
    def eat(self, k):
        if self.at(k):
            return self.pop()
        return None
    def need(self, k):
        if not self.at(k): raise NuError(f"expected {k}")
        return self.pop()

    def parse(self):
        v = self.expr(0)
        while self.at('.'):
            self.pop(); part = self.pop().text
            v = get_path(v, part.rstrip('?'), optional=part.endswith('?'))
        return v

    def expr(self, minp):
        t = self.pop()
        if t.kind == 'num':
            left = parse_number(t.text)
        elif t.kind == 'str':
            left = t.text
        elif t.kind == 'word':
            w = t.text
            if w == 'true': left = True
            elif w == 'false': left = False
            elif w == 'null': left = None
            elif w == 'not': left = not truthy(self.expr(80))
            elif w.startswith('$'):
                left = self.env.get(w[1:], self.inp if w in ('$in', '$it') else None)
            else:
                left = w
        elif t.kind == '(':
            left = self.expr(0); self.need(')')
        elif t.kind == '[':
            left = self.list_or_table()
        elif t.kind == '{':
            left = self.record()
        elif t.kind == '-':
            left = -to_num(self.expr(80))
        else:
            raise NuError(f"unexpected token {t.text}")
        while True:
            while self.at('.'):
                self.pop(); part = self.pop().text
                left = get_path(left, part.rstrip('?'), optional=part.endswith('?'))
            op = self.peek().text
            p = prec(op)
            if p < minp:
                break
            self.pop()
            if op in ('..', '..<'):
                right = None if self.at('eof', '|', ')', ']', ';', ',') else self.expr(p + 1)
                left = RangeVal(left, right, None, op == '..')
                continue
            right = self.expr(p + (0 if op == '**' else 1))
            left = apply_op(op, left, right)
        return left

    def list_or_table(self):
        if self.at('['):
            self.pop()
            headers = []
            while not self.at(']'):
                if self.at(','): self.pop(); continue
                headers.append(str(self.pop().text))
            self.need(']')
            self.eat(';')
            rows = []
            while not self.at(']'):
                if self.at(','): self.pop(); continue
                self.need('[')
                vals = []
                while not self.at(']'):
                    if self.at(','): self.pop(); continue
                    vals.append(self.expr(0))
                self.need(']')
                rows.append({h: vals[i] if i < len(vals) else None for i, h in enumerate(headers)})
            self.need(']')
            return rows
        vals = []
        while not self.at(']'):
            if self.at(',') or self.at(';'):
                self.pop(); continue
            vals.append(self.expr(0))
        self.need(']')
        return vals

    def record(self):
        rec = {}
        while not self.at('}'):
            if self.at(','):
                self.pop(); continue
            key = self.pop().text
            self.need(':')
            rec[key] = self.expr(0)
        self.need('}')
        return rec


def prec(op):
    return {'or': 10, 'xor': 15, 'and': 20, 'in': 25, 'not-in': 25, '=~': 25, '!~': 25,
            '==': 30, '!=': 30, '<': 35, '>': 35, '<=': 35, '>=': 35,
            '..': 37, '..<': 37, '+': 40, '-': 40, '++': 40, '*': 50, '/': 50, 'mod': 50,
            'bit-and': 45, 'bit-or': 43, 'bit-xor': 44, 'bit-shl': 50, 'bit-shr': 50, '**': 60}.get(op, -1)


def parse_number(s):
    units = {'kb': 1000, 'mb': 1000000, 'gb': 1000000000, 'b': 1}
    m = re.fullmatch(r'(-?\d+(?:\.\d+)?)([a-zA-Z]+)?', s)
    if m and m.group(2):
        unit = m.group(2).lower()
        if unit in units:
            return int(Decimal(m.group(1)) * units[unit])
        if unit in ('sec', 'min', 'hr'):
            mul = {'sec': 1, 'min': 60, 'hr': 3600}[unit]
            return ('duration', int(Decimal(m.group(1)) * mul))
    try:
        return int(s)
    except ValueError:
        try: return float(s)
        except ValueError: return s


def to_num(v):
    if isinstance(v, tuple) and v and v[0] == 'duration': return v[1]
    if isinstance(v, bool): return int(v)
    if isinstance(v, (int, float)): return v
    try: return int(v)
    except Exception:
        try: return float(v)
        except Exception: raise NuError('incompatible types')


def truthy(v):
    return bool(v)


def apply_op(op, a, b):
    if op == '+': return to_num(a) + to_num(b) if not isinstance(a, str) else a + str(b)
    if op == '++': return str(a) + str(b)
    if op == '-': return to_num(a) - to_num(b)
    if op == '*': return to_num(a) * to_num(b)
    if op == '/': return to_num(a) / to_num(b)
    if op == 'mod': return to_num(a) % to_num(b)
    if op == '**': return to_num(a) ** to_num(b)
    if op == 'bit-and': return int(to_num(a)) & int(to_num(b))
    if op == 'bit-or': return int(to_num(a)) | int(to_num(b))
    if op == 'bit-xor': return int(to_num(a)) ^ int(to_num(b))
    if op == 'bit-shl':
        n = int(to_num(b));
        if n < 0 or n > 1024: raise NuError('exceeds available bits')
        return int(to_num(a)) << n
    if op == 'bit-shr':
        n = int(to_num(b));
        if n < 0 or n > 1024: raise NuError('exceeds available bits')
        return int(to_num(a)) >> n
    if op == 'and': return truthy(a) and truthy(b)
    if op == 'or': return truthy(a) or truthy(b)
    if op == 'xor': return truthy(a) ^ truthy(b)
    if op in ('==', '!=', '<', '>', '<=', '>='):
        if a is None or b is None:
            return None
        return {'==': a == b, '!=': a != b, '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b}[op]
    if op == '=~': return re.search(str(b), str(a)) is not None
    if op == '!~': return re.search(str(b), str(a)) is None
    if op == 'in': return contains(b, a)
    if op == 'not-in': return not contains(b, a)
    raise NuError(f'unknown operator {op}')


def contains(container, item):
    if isinstance(container, RangeVal):
        if not isinstance(item, (int, float)): raise NuError('operator_incompatible_types')
        vals = expand_range(container, limit=100000)
        return item in vals
    if isinstance(container, dict):
        if not isinstance(item, str): raise NuError('operator_incompatible_types')
        return item in container
    return item in container


def expand_range(r: RangeVal, limit=10000):
    start = to_num(r.start); end = r.end
    step = to_num(r.step) if r.step is not None else (1 if end is None or to_num(end) >= start else -1)
    if step == 0: raise NuError('range step cannot be zero')
    if end is None:
        endn = start + step * (limit - 1)
    else:
        endn = to_num(end)
    vals = []
    x = start
    cmp = (lambda y: y <= endn) if step > 0 and r.inclusive else (lambda y: y < endn) if step > 0 else (lambda y: y >= endn) if r.inclusive else (lambda y: y > endn)
    while cmp(x) and len(vals) < limit:
        vals.append(int(x) if float(x).is_integer() else x)
        x += step
    return vals


def get_path(v, part, optional=False):
    try:
        if isinstance(v, RangeVal): v = expand_range(v)
        if isinstance(v, list):
            if re.fullmatch(r'-?\d+', part): return v[int(part)]
            out = [get_path(x, part, optional) for x in v if isinstance(x, dict) and (optional or part in x)]
            if not out and not optional:
                raise NuError(f"cannot find column {part}")
            return out
        if isinstance(v, dict): return v[part]
    except Exception:
        if optional: return None
        raise NuError(f'cannot find column {part}')
    if optional: return None
    raise NuError(f'cannot access {part}')


def split_top(src, sep):
    parts, start, depth, q = [], 0, 0, None
    i = 0
    while i < len(src):
        c = src[i]
        if q:
            if c == q: q = None
        elif c in "'\"": q = c
        elif c in '([{': depth += 1
        elif c in ')]}': depth -= 1
        elif c == sep and depth == 0:
            parts.append(src[start:i].strip()); start = i + 1
        i += 1
    parts.append(src[start:].strip())
    return [p for p in parts if p != '']


def eval_expr(src, env=None, inp=None):
    return Parser(tokenize(src), env, inp).parse()


def eval_script(src, env=None, inp=None):
    env = env if env is not None else {}
    last = None
    for stmt in split_top(src, ';'):
        if stmt.startswith('let ') or stmt.startswith('mut '):
            _, rest = stmt.split(None, 1)
            name, expr = rest.split('=', 1)
            env[name.strip().lstrip('$')] = eval_pipeline(expr.strip(), env, inp)
            last = None
        elif stmt.startswith('$') and '=' in stmt:
            name, expr = stmt.split('=', 1)
            env[name.strip().lstrip('$')] = eval_pipeline(expr.strip(), env, inp)
            last = None
        elif stmt.startswith('if '):
            last = eval_if(stmt, env, inp)
        else:
            last = eval_pipeline(stmt, env, inp)
    return last


def eval_if(stmt, env, inp):
    m = re.match(r'if\s+(.+?)\s*\{(.*?)\}(?:\s*else\s*\{(.*?)\})?\s*$', stmt, re.S)
    if not m: raise NuError('parse error')
    return eval_script(m.group(2), env, inp) if truthy(eval_pipeline(m.group(1), env, inp)) else (eval_script(m.group(3), env, inp) if m.group(3) is not None else None)


def eval_pipeline(src, env=None, inp=None):
    parts = split_top(src, '|')
    val = inp
    first = True
    for p in parts:
        if first:
            if is_command(p): val = run_command(None, p, env or {})
            else: val = eval_expr(p, env or {}, val)
            first = False
        else:
            val = run_command(val, p, env or {})
    return val


def is_command(p):
    w = p.strip().split()
    if not w: return False
    return w[0] in {'echo','print','from','to','get','select','reject','where','math','str','lines','split','open','save','ls','glob','length','first','last','sort','sort-by','each','into','range','seq','pwd','cd','mkdir','rm','exit','columns','flatten','headers','default'}


def words(cmd):
    return [t.text if t.kind in ('word','num','str') else t.text for t in tokenize(cmd) if t.kind != 'eof']


def run_command(inp, cmd, env):
    ws = words(cmd)
    if not ws: return inp
    head = ws[0]
    rest = cmd[len(head):].strip()
    if head in ('echo', 'print'):
        args = split_args(rest)
        vals = [eval_pipeline(a, env, inp) for a in args] if args else [inp]
        return vals[0] if len(vals) == 1 else vals
    if head == 'exit':
        code = int(eval_expr(rest or '0', env, inp)); raise SystemExit(code)
    if head == 'seq':
        a = [int(eval_expr(x, env, inp)) for x in split_args(rest)]
        return list(range(a[0], a[-1] + (1 if a[-1] >= a[0] else -1), 1 if a[-1] >= a[0] else -1))
    if head == 'from':
        fmt = ws[1] if len(ws) > 1 else ''
        if inp is None:
            raise NuError('Pipeline empty')
        text = '' if inp is None else str(inp)
        if fmt == 'json': return json.loads(text)
        if fmt == 'csv': return parse_csv(text)
        if fmt == 'tsv': return parse_csv(text, '\t')
    if head == 'to':
        fmt = ws[1] if len(ws) > 1 else ''
        if fmt == 'json': return json.dumps(to_jsonable(inp), separators=(',', ':'))
        if fmt == 'csv': return to_csv(inp)
        if fmt in ('nuon','text'): return format_value(inp, raw=True)
    if head == 'get':
        v = inp
        for path in split_args(rest):
            cur = v
            for part in path.split('.'):
                cur = get_path(cur, part.rstrip('?'), optional=part.endswith('?'))
            return cur
    if head == 'select':
        cols = [x.strip() for x in split_args(rest)]
        rows = inp if isinstance(inp, list) else [inp]
        return [{c: get_path(r, c, True) for c in cols} for r in rows]
    if head == 'reject':
        cols = set(split_args(rest)); rows = inp if isinstance(inp, list) else [inp]
        return [{k:v for k,v in r.items() if k not in cols} for r in rows]
    if head == 'where':
        rows = inp if isinstance(inp, list) else [inp]
        return [r for r in rows if truthy(eval_expr(rewrite_row_expr(rest, r), env, r))]
    if head == 'math':
        return math_cmd(ws[1] if len(ws) > 1 else '', inp)
    if head == 'str':
        return str_cmd(inp, ws[1] if len(ws) > 1 else '', rest[len(ws[1]):].strip() if len(ws) > 1 else '', env)
    if head == 'lines':
        return str(inp).splitlines()
    if head == 'split' and len(ws) > 1 and ws[1] == 'row':
        sep = eval_expr(rest[3:].strip(), env, inp) if rest.startswith('row') else ws[-1]
        return str(inp).split(str(sep))
    if head == 'length': return len(expand_range(inp) if isinstance(inp, RangeVal) else inp)
    if head == 'first': return (expand_range(inp) if isinstance(inp, RangeVal) else inp)[0]
    if head == 'last': return (expand_range(inp) if isinstance(inp, RangeVal) else inp)[-1]
    if head == 'sort': return sorted(inp, key=lambda x: str(x).lower() if '-i' in ws else x)
    if head == 'sort-by':
        cols = [x for x in ws[1:] if not x.startswith('-')]
        return sorted(inp, key=lambda r: tuple(str(r.get(c,'')).lower() if '-i' in ws else r.get(c) for c in cols))
    if head == 'each':
        body = closure_body(rest)
        params, body = closure_parts(rest)
        out = []
        for x in (expand_range(inp) if isinstance(inp, RangeVal) else inp):
            local = dict(env, it=x, **{'in': x})
            if params:
                local[params[0].lstrip('$')] = x
            out.append(eval_script(body, local, x))
        return out
    if head == 'open':
        path_text = rest.strip()
        if (path_text.startswith("'") and path_text.endswith("'")) or (path_text.startswith('"') and path_text.endswith('"')):
            path = eval_expr(path_text, env, inp)
        else:
            path = path_text
        return open_file(path)
    if head == 'save':
        if not rest.strip():
            raise NuError('Missing required positional argument')
        path = eval_expr(rest.replace('--force','').strip(), env, inp)
        Path(path).write_text(format_value(inp, raw=True), encoding='utf-8')
        return None
    if head == 'ls': return ls_cmd(rest)
    if head == 'glob':
        pat = str(eval_expr(rest, env, inp))
        if pat.count('[') != pat.count(']'):
            raise NuError('error with glob pattern')
        return sorted(glob.glob(pat))
    if head == 'pwd': return os.getcwd()
    if head == 'cd': os.chdir(str(eval_expr(rest, env, inp))); return None
    if head == 'mkdir': Path(str(eval_expr(rest, env, inp))).mkdir(parents=True, exist_ok=True); return None
    if head == 'rm':
        for p in split_args(rest):
            q = Path(str(eval_expr(p, env, inp)))
            if q.is_dir(): q.rmdir()
            elif q.exists(): q.unlink()
        return None
    if head == 'into' and len(ws) > 1:
        if ws[1] == 'string': return map_list(inp, lambda x: format_value(x, raw=True))
        if ws[1] == 'int': return map_list(inp, lambda x: int(float(x)))
    if head == 'columns': return list(inp.keys()) if isinstance(inp, dict) else list(inp[0].keys()) if inp else []
    if head == 'flatten':
        out=[]
        for x in inp: out.extend(x if isinstance(x,list) else [x])
        return out
    raise NuError(f'unknown command: {head}')


def split_args(s):
    parts = []
    cur = []
    depth = 0
    q = None
    for c in s.strip():
        if q:
            cur.append(c)
            if c == q: q = None
        elif c in "'\"": q = c; cur.append(c)
        elif c in '([{': depth += 1; cur.append(c)
        elif c in ')]}': depth -= 1; cur.append(c)
        elif c.isspace() and depth == 0:
            if cur: parts.append(''.join(cur).strip()); cur=[]
        elif c == ',' and depth == 0:
            if cur: parts.append(''.join(cur).strip()); cur=[]
        else: cur.append(c)
    if cur: parts.append(''.join(cur).strip())
    return parts


def rewrite_row_expr(expr, row):
    if isinstance(row, dict):
        for k, v in row.items():
            expr = re.sub(rf'(?<![$\w]){re.escape(k)}(?![\w])', json.dumps(v) if isinstance(v, str) else format_value(v, raw=True), expr)
    return expr


def closure_body(s):
    return closure_parts(s)[1]


def closure_parts(s):
    m = re.search(r'\{\s*(?:\|([^|]*)\|)?\s*(.*?)\s*\}\s*$', s, re.S)
    if not m: raise NuError('expected closure')
    params = [p.strip() for p in (m.group(1) or '').split(',') if p.strip()]
    return params, m.group(2)


def math_cmd(name, inp):
    vals = expand_range(inp) if isinstance(inp, RangeVal) else inp
    if not isinstance(vals, list): vals=[vals]
    nums = [to_num(x) for x in vals]
    if name == 'sum': return sum(nums)
    if name == 'product':
        p=1
        for x in nums: p*=x
        return p
    if name == 'avg': return sum(nums)/len(nums)
    if name == 'min': return min(nums)
    if name == 'max': return max(nums)
    if name == 'median': return statistics.median(nums)
    if name == 'sqrt': return map_list(inp, lambda x: math.sqrt(to_num(x)))
    if name == 'abs': return map_list(inp, lambda x: abs(to_num(x)))
    if name == 'ceil': return map_list(inp, lambda x: math.ceil(to_num(x)))
    if name == 'floor': return map_list(inp, lambda x: math.floor(to_num(x)))
    if name == 'round': return map_list(inp, lambda x: round(to_num(x)))
    raise NuError(f'unknown math {name}')


def str_cmd(inp, name, rest, env):
    def one(x):
        s = str(x)
        args = split_args(rest)
        if name == 'join': return NoNewline(str(eval_expr(args[0], env, inp)).join(map(str, inp)) if args else ''.join(map(str, inp)))
        if name == 'contains': return str(eval_expr(args[0], env, inp)) in s
        if name == 'replace':
            if len(args) < 2:
                raise NuError('Missing required positional argument')
            return s.replace(str(eval_expr(args[0], env, inp)), str(eval_expr(args[1], env, inp)), 1)
        if name == 'trim': return s.strip()
        if name == 'length': return len(s)
        if name == 'upcase': return s.upper()
        if name == 'downcase': return s.lower()
        if name == 'index-of': return s.find(str(eval_expr(args[0], env, inp)))
        if name == 'substring':
            if not args:
                raise NuError('Missing required positional argument')
            r = eval_expr(args[0], env, inp)
            if isinstance(r, RangeVal):
                start = int(r.start); end = None if r.end is None else int(r.end)
                return s[start:end if not r.inclusive and end is not None else (end + 1 if end is not None else None)]
            raise NuError("Can't convert to range")
        return s
    if name == 'join': return one(inp)
    return map_list(inp, one)


def map_list(v, fn):
    if isinstance(v, list): return [fn(x) for x in v]
    return fn(v)


def parse_csv(text, delim=','):
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    if not rows: return []
    headers = rows[0]
    for idx, row in enumerate(rows[1:], start=1):
        if len(row) != len(headers):
            raise NuError(f'CSV error: record {idx} has {len(row)} fields, expected {len(headers)}')
    return [{h: infer_scalar(row[i] if i < len(row) else '') for i, h in enumerate(headers)} for row in rows[1:]]


def infer_scalar(s):
    if s == '':
        return ''
    try:
        if re.fullmatch(r'-?\d+', s):
            return int(s)
        if re.fullmatch(r'-?\d+\.\d+', s):
            return float(s)
    except Exception:
        pass
    return s


def to_csv(v):
    rows = v if isinstance(v, list) else [v]
    if not rows: return ''
    if not isinstance(rows[0], dict): rows = [{'': x} for x in rows]
    headers = list(rows[0].keys())
    out = io.StringIO(); w = csv.DictWriter(out, headers, lineterminator='\n'); w.writeheader(); w.writerows(rows)
    return out.getvalue().rstrip('\n')


def open_file(path):
    p = Path(str(path)); text = p.read_text(encoding='utf-8')
    ext = p.suffix.lower()
    if ext == '.json': return json.loads(text)
    if ext == '.csv': return parse_csv(text)
    if ext == '.tsv': return parse_csv(text, '\t')
    return text


def ls_cmd(rest):
    pat = rest.strip() or '.'
    pat = str(eval_expr(pat)) if pat not in ('.','') else pat
    paths = sorted(glob.glob(pat if any(c in pat for c in '*?[') else os.path.join(pat, '*') if os.path.isdir(pat) else pat))
    rows=[]
    for p in paths:
        st=os.stat(p)
        rows.append({'name': p, 'type': 'dir' if os.path.isdir(p) else 'file', 'size': st.st_size})
    return rows


def to_jsonable(v):
    if isinstance(v, RangeVal): return expand_range(v)
    if isinstance(v, tuple) and v and v[0] == 'duration': return v[1]
    return v


def format_value(v, raw=False):
    if v is None: return 'null' if raw else ''
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, float):
        if v.is_integer(): return str(int(v))
        return format(v, '.15g')
    if isinstance(v, int): return str(v)
    if isinstance(v, str): return str(v)
    if isinstance(v, RangeVal): return format_value(expand_range(v), raw)
    if isinstance(v, list):
        if raw: return json.dumps(to_jsonable(v), separators=(',', ':'))
        return '\n'.join(format_value(x, raw=False) for x in v)
    if isinstance(v, dict):
        if raw: return json.dumps(v, separators=(',', ':'))
        return '\n'.join(format_value(x, raw=False) for x in v.values())
    return str(v)


def main(argv):
    if '--version' in argv or '-v' in argv:
        sys.stdout.write('0.106.1\n'); return 0
    if '--help' in argv or '-h' in argv:
        sys.stdout.write('The nushell language and shell.\n'); return 0
    no_newline = '--no-newline' in argv
    cmd = None; script = None; stdin_mode = '--stdin' in argv
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ('-c','--commands'):
            i += 1; cmd = argv[i] if i < len(argv) else ''
        elif a.startswith('--') or a in ('-n','--no-config-file'):
            pass
        elif a.startswith('-'):
            pass
        else:
            script = a
        i += 1
    try:
        inp = sys.stdin.read() if stdin_mode else None
        if cmd is None:
            if script: cmd = Path(script).read_text(encoding='utf-8')
            else: return 0
        val = eval_script(cmd, {}, inp)
        if val is not None:
            out = format_value(val, raw=False)
            sys.stdout.write(out)
            if not isinstance(val, NoNewline) and not no_newline and not out.endswith('\n'):
                sys.stdout.write('\n')
        return 0
    except SystemExit as e:
        return int(e.code)
    except Exception as e:
        sys.stderr.write(f'Error: {e}\n')
        return 1


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
