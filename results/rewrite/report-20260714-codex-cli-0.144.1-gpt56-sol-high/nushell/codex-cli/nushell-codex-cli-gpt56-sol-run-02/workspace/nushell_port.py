#!/usr/bin/env python3
"""A focused, clean-room Python port of the Nushell command-language surface.

The benchmark exercises `nu -c` as a data-oriented expression evaluator.  This
module implements that surface directly: Nu literals, pipelines, closures,
common table transforms, format conversion, strings, math, and small filesystem
operations.  It deliberately has no dependency on, or runtime access to, the
reference executable.
"""

from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import shutil
import statistics
import sys
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


class NuError(Exception):
    pass


@dataclass
class RangeValue:
    start: Any
    end: Any
    exclusive: bool = False

    def values(self, limit: int = 100000) -> list:
        start = 0 if self.start is None else self.start
        if self.end is None:
            end = start + limit - 1
        else:
            end = self.end
        step = 1 if end >= start else -1
        if isinstance(start, int) and isinstance(end, int):
            stop = end if self.exclusive else end + step
            return list(range(start, stop, step))
        out, cur = [], float(start)
        pred = (lambda x: x < end) if self.exclusive and step > 0 else \
               (lambda x: x > end) if self.exclusive else \
               (lambda x: x <= end) if step > 0 else (lambda x: x >= end)
        while pred(cur) and len(out) < limit:
            out.append(cur)
            cur += step
        return out


@dataclass
class FileSize:
    bytes: int


@dataclass
class Duration:
    nanos: int
    source: str


@dataclass
class Closure:
    params: list[str]
    body: str


@dataclass
class RawOutput:
    text: str

    def __str__(self):
        return self.text


@dataclass
class Token:
    kind: str
    value: Any
    raw: str = ""


def split_top(text: str, separator: str) -> list[str]:
    """Split on a separator only at the language's top level."""
    out, start, stack = [], 0, []
    quote = None
    esc = False
    i = 0
    pairs = {'(': ')', '[': ']', '{': '}'}
    while i < len(text):
        c = text[i]
        if quote:
            if esc:
                esc = False
            elif c == '\\' and quote == '"':
                esc = True
            elif c == quote:
                quote = None
            i += 1
            continue
        if c in "'\"`":
            quote = c
        elif c in pairs:
            stack.append(pairs[c])
        elif stack and c == stack[-1]:
            stack.pop()
        elif not stack and text.startswith(separator, i):
            out.append(text[start:i].strip())
            i += len(separator)
            start = i
            continue
        i += 1
    out.append(text[start:].strip())
    return out


def split_words(text: str) -> list[str]:
    out, start, stack, quote, esc = [], None, [], None, False
    pairs = {'(': ')', '[': ']', '{': '}'}
    for i, c in enumerate(text + ' '):
        if quote:
            if esc:
                esc = False
            elif c == '\\' and quote == '"':
                esc = True
            elif c == quote:
                quote = None
            continue
        if c in "'\"`":
            quote = c
            if start is None:
                start = i
        elif c in pairs:
            stack.append(pairs[c])
            if start is None:
                start = i
        elif stack and c == stack[-1]:
            stack.pop()
        elif c.isspace() and not stack:
            if start is not None:
                out.append(text[start:i])
                start = None
        elif start is None:
            start = i
    return out


def unescape_double(s: str) -> str:
    def uni(m):
        try:
            return chr(int(m.group(1), 16))
        except ValueError:
            return m.group(0)
    s = re.sub(r"\\u\{([0-9a-fA-F]+)\}", uni, s)
    return re.sub(r'\\([nrt"\\])', lambda m: {'n':'\n','r':'\r','t':'\t','"':'"','\\':'\\'}[m.group(1)], s)


def tokenize(text: str) -> list[Token]:
    tokens: list[Token] = []
    i, n, bracket_depth = 0, len(text), 0
    punctuation = set('()[]{}:;,.|')
    operators = ['..<', '++', '==', '!=', '<=', '>=', '//', '**', '=~', '!~', '..']
    while i < n:
        c = text[i]
        if c.isspace():
            i += 1; continue
        if c == '#':
            break
        if c in "'\"`" or (c == '$' and i + 1 < n and text[i+1] == '"'):
            interp = c == '$'
            if interp:
                i += 1; c = '"'
            q, start = c, i
            i += 1; buf = []
            while i < n:
                if text[i] == q:
                    break
                if q == '"' and text[i] == '\\' and i + 1 < n:
                    if text.startswith('\\u{', i):
                        j = text.find('}', i + 3)
                        if j >= 0:
                            buf.append(text[i:j+1]); i = j + 1; continue
                    buf.append(text[i:i+2]); i += 2; continue
                buf.append(text[i]); i += 1
            i += 1
            val = ''.join(buf)
            if q == '"': val = unescape_double(val)
            tokens.append(Token('ISTR' if interp else 'STR', val, text[start:i]))
            continue
        # Within a Nu list, a whitespace-separated negative literal starts a
        # new element (`[1 -2]`) rather than subtracting from the prior one.
        if c == '-' and bracket_depth and i + 1 < n and text[i+1].isdigit() and (i == 0 or text[i-1].isspace() or text[i-1] == '['):
            m = re.match(r'-?(?:\d[\d_]*\.\d[\d_]*|\d[\d_]*)(?:[eE][+-]?\d+)?', text[i:])
            raw=m.group(0); val=float(raw.replace('_','')) if any(x in raw.lower() for x in ('.','e')) else int(raw.replace('_',''))
            tokens.append(Token('NUM',val,raw)); i+=len(raw); continue
        matched = next((op for op in operators if text.startswith(op, i)), None)
        if matched:
            tokens.append(Token('OP', matched, matched)); i += len(matched); continue
        if c in '+-*/%<>=!':
            tokens.append(Token('OP', c, c)); i += 1; continue
        if c in punctuation:
            tokens.append(Token(c, c, c))
            if c == '[': bracket_depth += 1
            elif c == ']': bracket_depth = max(0, bracket_depth-1)
            i += 1; continue
        if c == '$':
            j = i + 1
            while j < n and (text[j].isalnum() or text[j] in '_-.'):
                j += 1
            tokens.append(Token('VAR', text[i+1:j], text[i:j])); i = j; continue
        # Numbers, including bases and exponent notation.
        m = re.match(r'(?:0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|(?:\d[\d_]*\.\d[\d_]*|\d[\d_]*)(?:[eE][+-]?\d+)?)', text[i:])
        if m:
            raw = m.group(0); j = i + len(raw)
            # Unit-bearing values are a single token.
            um = re.match(r'[A-Za-z]+', text[j:])
            if um:
                raw += um.group(0); j += len(um.group(0))
                tokens.append(Token('UNIT', raw, raw)); i = j; continue
            if raw.lower().startswith(('0x','0b','0o')):
                val = int(raw.replace('_',''), 0)
            elif any(x in raw.lower() for x in ('.','e')):
                val = float(raw.replace('_',''))
            else:
                val = int(raw.replace('_',''))
            tokens.append(Token('NUM', val, raw)); i = j; continue
        j = i
        while j < n and not text[j].isspace() and text[j] not in "()[]{}:;,.|'\"`$+*/%<>=!":
            if text[j] == '-' and (j == i or j + 1 == n or text[j-1].isspace() or text[j+1].isspace()):
                break
            j += 1
        if j == i:  # permissive fallback for a path/symbol
            j += 1
        raw = text[i:j]
        tokens.append(Token('ID', raw, raw)); i = j
    tokens.append(Token('EOF', None, ''))
    return tokens


class ExprParser:
    def __init__(self, shell: 'NuShell', text: str, env: dict[str, Any] | None = None):
        self.shell, self.text = shell, text
        self.env = shell.env if env is None else env
        self.toks, self.i = tokenize(text), 0

    def peek(self, kind=None, value=None):
        t = self.toks[self.i]
        return (kind is None or t.kind == kind) and (value is None or t.value == value)

    def pop(self):
        t = self.toks[self.i]; self.i += 1; return t

    def accept(self, kind, value=None):
        if self.peek(kind, value): return self.pop()
        return None

    def expect(self, kind, value=None):
        if not self.peek(kind, value):
            raise NuError(f"expected {value or kind}")
        return self.pop()

    def parse(self):
        return self.expr(0)

    def expr(self, min_bp=0):
        t = self.pop()
        if t.kind == 'NUM': left = t.value
        elif t.kind == 'UNIT': left = parse_unit(t.value)
        elif t.kind == 'STR': left = t.value
        elif t.kind == 'ISTR': left = self.interpolate(t.value)
        elif t.kind == 'VAR': left = self.variable(t.value)
        elif t.kind == 'ID':
            low = t.value.lower()
            if low == 'true': left = True
            elif low == 'false': left = False
            elif low in ('null', 'nothing'): left = None
            elif low == 'inf': left = float('inf')
            elif low == 'nan': left = float('nan')
            elif low == 'not': left = not truthy(self.expr(80))
            elif t.value in self.env: left = self.env[t.value]
            else: left = t.value
        elif t.kind == 'OP' and t.value in ('-', '+', '!'):
            v = self.expr(80)
            left = -v if t.value == '-' else (+v if t.value == '+' else not truthy(v))
        elif t.kind == '(':
            # Parenthesized content can itself contain a pipeline.
            start, depth = self.i, 1
            j = start
            has_pipe = False
            while j < len(self.toks):
                if self.toks[j].kind == '(': depth += 1
                elif self.toks[j].kind == ')':
                    depth -= 1
                    if depth == 0: break
                elif self.toks[j].kind == '|' and depth == 1: has_pipe = True
                j += 1
            if has_pipe:
                raw = tokens_text(self.toks[start:j])
                left = self.shell.eval_pipeline(raw, self.env)
                self.i = j + 1
            else:
                left = self.expr(0); self.expect(')')
        elif t.kind == '[':
            left = self.parse_list()
        elif t.kind == '{':
            left = self.parse_brace()
        elif t.kind == 'OP' and t.value in ('..','..<'):
            right = None if self.peek('EOF') else self.expr(9)
            left = RangeValue(None, right, t.value == '..<')
        else:
            raise NuError(f"unexpected token {t.raw or t.kind}")

        while True:
            # Cell paths.
            if self.accept('.'):
                key = self.pop()
                kval = key.value
                left = get_path(left, [kval])
                continue
            op = self.toks[self.i]
            opname = op.value.lower() if op.kind == 'ID' else op.value
            bp = {'or':10, 'xor':11, 'and':12, 'in':20, 'not-in':20,
                  '==':30,'!=':30,'=~':30,'!~':30,'<':30,'<=':30,'>':30,'>=':30,
                  '..':35,'..<':35,'++':40,'+':40,'-':40,'*':50,'/':50,'//':50,'%':50,'mod':50,'**':60}.get(opname)
            if bp is None or bp < min_bp: break
            self.pop()
            right = self.expr(bp if opname == '**' else bp + 1)
            left = apply_op(opname, left, right)
        return left

    def parse_list(self):
        is_table = False
        if self.peek('['):
            depth, j = 0, self.i
            while j < len(self.toks):
                if self.toks[j].kind == '[': depth += 1
                elif self.toks[j].kind == ']':
                    depth -= 1
                    if depth == 0:
                        is_table = j + 1 < len(self.toks) and self.toks[j+1].kind == ';'
                        break
                j += 1
        if is_table:
            headers = self.parse_bracket_items()
            self.expect(';')
            rows = []
            while not self.peek(']') and not self.peek('EOF'):
                if self.accept(','): continue
                self.expect('[')
                vals = self.parse_items_until(']')
                self.expect(']')
                if len(vals) != len(headers): raise NuError(f"expected {len(headers)} columns")
                rows.append(OrderedDict(zip((str(x) for x in headers), vals)))
            self.expect(']')
            return rows
        vals = self.parse_items_until(']')
        self.expect(']')
        return vals

    def parse_bracket_items(self):
        self.expect('['); vals = self.parse_items_until(']'); self.expect(']'); return vals

    def parse_items_until(self, end):
        vals = []
        while not self.peek(end) and not self.peek('EOF'):
            if self.accept(','): continue
            vals.append(self.expr(0))
            self.accept(',')
        return vals

    def parse_brace(self):
        # A record is identified by a key followed by a colon.
        if (self.peek('ID') or self.peek('STR') or self.peek('NUM')) and self.toks[self.i+1].kind == ':':
            rec = OrderedDict()
            while not self.peek('}') and not self.peek('EOF'):
                if self.accept(','): continue
                key = self.pop().value; self.expect(':')
                rec[str(key)] = self.expr(0); self.accept(',')
            self.expect('}'); return rec
        if self.peek('}'):
            self.pop(); return OrderedDict()
        val = None
        while not self.peek('}') and not self.peek('EOF'):
            val = self.expr(0)
            if not self.accept(';'): break
        self.expect('}'); return val

    def variable(self, name):
        parts = name.split('.')
        if parts[0] == 'env':
            val: Any = dict(os.environ)
        else:
            val = self.env.get(parts[0])
        return get_path(val, parts[1:]) if len(parts) > 1 else val

    def interpolate(self, value):
        def expr_sub(m):
            try:
                return scalar_text(self.shell.eval_pipeline(m.group(1), self.env))
            except Exception:
                return m.group(0)
        value = re.sub(r'\(([^()]*)\)', expr_sub, value)
        def sub(m):
            return scalar_text(self.variable(m.group(1)))
        return re.sub(r'\$([A-Za-z_][\w.-]*)', sub, value)


def tokens_text(tokens: list[Token]) -> str:
    # Used only for nested parenthesized pipelines; raw tokens remain unambiguous.
    return ' '.join(t.raw or str(t.value) for t in tokens)


def parse_unit(raw: str):
    m = re.match(r'([\d_.eE+-]+)([A-Za-z]+)$', raw)
    if not m: return raw
    num, unit = float(m.group(1).replace('_','')), m.group(2).lower()
    sizes = {'b':1,'kb':1000,'mb':1000**2,'gb':1000**3,'tb':1000**4,
             'kib':1024,'mib':1024**2,'gib':1024**3}
    durations = {'ns':1,'us':1000,'ms':1000000,'sec':1000000000,'min':60*1000000000,
                 'hr':3600*1000000000,'day':86400*1000000000,'wk':604800*1000000000}
    if unit in sizes: return FileSize(int(num * sizes[unit]))
    if unit in durations: return Duration(int(num * durations[unit]), raw)
    return raw


def materialize(v):
    return v.values() if isinstance(v, RangeValue) else v


def truthy(v):
    return bool(v) if v is not None else False


def apply_op(op, a, b):
    a, b = materialize(a), materialize(b)
    if op == '+': return a + b
    if op == '-': return a - b
    if op == '*': return a * b
    if op == '/': return a / b
    if op == '//': return a // b
    if op in ('%', 'mod'): return a % b
    if op == '**': return a ** b
    if op == '++': return a + b
    if op == '==': return a == b
    if op == '!=': return a != b
    if op == '<': return a < b
    if op == '<=': return a <= b
    if op == '>': return a > b
    if op == '>=': return a >= b
    if op == 'and': return truthy(a) and truthy(b)
    if op == 'or': return truthy(a) or truthy(b)
    if op == 'xor': return truthy(a) != truthy(b)
    if op == 'in': return a in b
    if op == 'not-in': return a not in b
    if op == '=~': return re.search(str(b), str(a)) is not None
    if op == '!~': return re.search(str(b), str(a)) is None
    if op in ('..','..<'): return RangeValue(a, b, op == '..<')
    raise NuError(f"unsupported operator {op}")


def get_path(value, parts):
    cur = materialize(value)
    for p in parts:
        if p == '': continue
        if isinstance(cur, list):
            if isinstance(p, int) or str(p).lstrip('-').isdigit():
                cur = cur[int(p)]
            else:
                cur = [x.get(str(p)) if isinstance(x, dict) else None for x in cur]
        elif isinstance(cur, dict): cur = cur.get(str(p))
        else: raise NuError(f"cannot find cell path {p}")
    return cur


def scalar_text(v, table=False):
    if v is None: return ''
    if v is True: return 'true'
    if v is False: return 'false'
    if isinstance(v, float):
        if math.isnan(v): return 'NaN'
        if math.isinf(v): return 'inf' if v > 0 else '-inf'
        if table:
            av = abs(v)
            if av != 0 and av < .01: return f"{v:.6f}".rstrip('0')
            return f"{v:.2f}"
        return repr(v)
    if isinstance(v, FileSize):
        units = [(1000**4,'TB'),(1000**3,'GB'),(1000**2,'MB'),(1000,'kB')]
        for div, name in units:
            if abs(v.bytes) >= div: return f"{v.bytes/div:.1f} {name}"
        return f"{v.bytes} B"
    if isinstance(v, Duration): return v.source
    return str(v)


def jsonable(v):
    if isinstance(v, RangeValue): return [jsonable(x) for x in v.values()]
    if isinstance(v, FileSize): return v.bytes
    if isinstance(v, Duration): return v.nanos
    if isinstance(v, dict): return OrderedDict((k, jsonable(x)) for k,x in v.items())
    if isinstance(v, list): return [jsonable(x) for x in v]
    return v


def nu_type(v):
    if v is None: return 'nothing'
    if isinstance(v, bool): return 'bool'
    if isinstance(v, int): return 'int'
    if isinstance(v, float): return 'float'
    if isinstance(v, str): return 'string'
    if isinstance(v, FileSize): return 'filesize'
    if isinstance(v, Duration): return 'duration'
    if isinstance(v, RangeValue): return 'range'
    if isinstance(v, dict): return 'record<' + ', '.join(f'{k}: {nu_type(x)}' for k,x in v.items()) + '>'
    if isinstance(v, list):
        types = []
        for x in v:
            t = nu_type(x)
            if t not in types: types.append(t)
        return 'list<' + ('nothing' if not types else (types[0] if len(types)==1 else 'any')) + '>'
    return 'any'


# The reference build's rounded default table theme.
TL, H, TM, TR = '\u256d', '\u2500', '\u252c', '\u256e'
V, ML, MM, MR = '\u2502', '\u251c', '\u253c', '\u2524'
BL, BM, BR = '\u2570', '\u2534', '\u256f'


def border(left, middle, right, widths):
    return left + middle.join(H * (w + 2) for w in widths) + right + '\n'


def render_list(values: list) -> str:
    if not values:
        return border(TL, TM, TR, [10]) + f'{V} empty list {V}\n' + border(BL, BM, BR, [10])
    if all(isinstance(x, dict) for x in values): return render_table(values)
    shown = [scalar_text(x, table=True) for x in values]
    widths = [max(1, len(str(len(values)-1))), max(1, *(len(x) for x in shown))]
    out = border(TL, TM, TR, widths)
    for i, (val, raw) in enumerate(zip(shown, values)):
        val = val.rjust(widths[1]) if isinstance(raw, (int,float)) and not isinstance(raw,bool) else val.ljust(widths[1])
        out += f'{V} {str(i).rjust(widths[0])} {V} {val} {V}\n'
    return out + border(BL, BM, BR, widths)


def render_table(rows: list[dict]) -> str:
    if not rows: return render_list([])
    cols = list(rows[0].keys())
    index_col = cols and cols[0] == 'index'
    if index_col: cols = cols[1:]
    shown = [[scalar_text(row.get(c), table=True) for c in cols] for row in rows]
    row_indexes = [row.get('index',i) if index_col else i for i,row in enumerate(rows)]
    widths = [max(1,*(len(str(x)) for x in row_indexes))]
    widths += [max(len(str(c)), *(len(row[j]) for row in shown)) for j,c in enumerate(cols)]
    out = border(TL, TM, TR, widths)
    headers = ['#'] + [str(c) for c in cols]
    cells = []
    for h,w in zip(headers,widths):
        gap=w-len(h); cells.append(' '*(gap//2)+h+' '*(gap-gap//2))
    out += V + ''.join(f' {x} {V}' for x in cells) + '\n'
    out += border(ML, MM, MR, widths)
    for i,row in enumerate(rows):
        cells = [str(row_indexes[i]).rjust(widths[0])]
        for j,c in enumerate(cols):
            raw, val, w = row.get(c), shown[i][j], widths[j+1]
            cells.append(val.rjust(w) if isinstance(raw,(int,float)) and not isinstance(raw,bool) else val.ljust(w))
        out += V + ''.join(f' {x} {V}' for x in cells) + '\n'
    return out + border(BL, BM, BR, widths)


def render_record(rec: dict) -> str:
    if not rec:
        return border(TL, TM, TR, [12]) + f'{V} empty record {V}\n' + border(BL, BM, BR, [12])
    keys = list(rec.keys()); vals = [scalar_text(v, table=True) for v in rec.values()]
    widths = [max(map(len,keys)), max(1,*(len(v) for v in vals))]
    out = border(TL, TM, TR, widths)
    for k,v in zip(keys,vals): out += f'{V} {k.ljust(widths[0])} {V} {v.ljust(widths[1])} {V}\n'
    return out + border(BL, BM, BR, widths)


def format_value(v) -> str:
    if isinstance(v, RawOutput): return v.text
    v = materialize(v)
    if v is None: return ''
    if isinstance(v, list): return render_list(v)
    if isinstance(v, dict): return render_record(v)
    return scalar_text(v) + '\n'


class NuShell:
    def __init__(self):
        self.env: dict[str, Any] = {}
        self.cwd = Path.cwd()
        self.side_output = ''

    def expr(self, text, env=None):
        return ExprParser(self, text.strip(), env).parse()

    def eval_script(self, script: str):
        result = None
        for stmt in split_top(script, ';'):
            if not stmt: continue
            m = re.match(r'^(?:let|mut|const)\s+([\w-]+)(?:\s*:\s*\w+)?\s*=\s*(.*)$', stmt, re.S)
            if m:
                self.env[m.group(1)] = self.eval_pipeline(m.group(2), self.env); result = None; continue
            m = re.match(r'^\$([\w.-]+)\s*=\s*(.*)$', stmt, re.S)
            if m:
                val = self.eval_pipeline(m.group(2), self.env)
                if m.group(1).startswith('env.'):
                    os.environ[m.group(1)[4:]] = scalar_text(val)
                else: self.env[m.group(1)] = val
                result = None; continue
            if stmt.startswith('if '): result = self.eval_if(stmt, self.env)
            else: result = self.eval_pipeline(stmt, self.env)
        return result

    def eval_if(self, text, env):
        m = re.match(r'^if\s+(.*?)\s*\{(.*?)\}(?:\s*else\s*\{(.*?)\})?\s*$', text, re.S)
        if not m: raise NuError('invalid if expression')
        branch = m.group(2) if truthy(self.eval_pipeline(m.group(1),env)) else m.group(3)
        return self.eval_script(branch) if branch is not None else None

    def eval_pipeline(self, text: str, env=None):
        env = self.env if env is None else env
        parts = split_top(text, '|')
        first = parts[0].strip()
        cmd = command_name(first)
        if cmd in BASE_COMMANDS:
            value = self.command(first, None, env)
        else:
            value = self.expr(first, env)
        for part in parts[1:]:
            value = self.command(part.strip(), value, env)
        return value

    def closure(self, raw: str):
        s = raw.strip()
        if not (s.startswith('{') and s.endswith('}')): raise NuError('expected closure')
        inner = s[1:-1].strip(); params=[]
        if inner.startswith('|'):
            j=inner.find('|',1)
            params=[x.strip().lstrip('$') for x in inner[1:j].split(',') if x.strip()]
            if len(params)==1 and ' ' in params[0]: params=params[0].split()
            inner=inner[j+1:].strip()
        return Closure(params, inner)

    def call_closure(self, cl: Closure, args, parent):
        env = dict(parent)
        for n,v in zip(cl.params,args): env[n]=v
        if args: env.setdefault('it',args[0]); env['in']=args[0]
        return self.eval_if(cl.body,env) if cl.body.lstrip().startswith('if ') else self.eval_pipeline(cl.body,env)

    def arg(self, raw, env):
        raw=raw.strip()
        try: return self.expr(raw,env)
        except Exception: return strip_quotes(raw)

    def command(self, segment: str, value, env):
        words=split_words(segment)
        if not words: return value
        name=words[0]; args=words[1:]
        two = f'{name} {args[0]}' if args and name in ('to','from','str','math','into','split','path','bytes') else name
        if two != name: args=args[1:]
        # Core data commands.
        if name in ('echo','print'):
            vals=[self.arg(a,env) for a in args]; out=vals[0] if len(vals)==1 else vals
            if name=='print': self.side_output += format_value(out); return None
            return out
        if name == 'length': return len(materialize(value)) if value is not None else 0
        if name in ('first','last'):
            seq=materialize(value); count=self.arg(args[0],env) if args else None
            if count is None: return seq[0] if name=='first' else seq[-1]
            return seq[:count] if name=='first' else seq[-count:]
        if name in ('take','skip'):
            n=int(self.arg(args[0],env)); seq=materialize(value)
            return seq[:n] if name=='take' else seq[n:]
        if name == 'reverse': return value[::-1]
        if name == 'get':
            path=strip_quotes(args[0]); return get_path(value,path.split('.'))
        if name == 'columns': return list(value[0].keys()) if isinstance(value,list) and value else list(value.keys())
        if name == 'values': return list(value.values())
        if name in ('select','reject'):
            cols=[strip_quotes(a) for a in args if not a.startswith('-')]
            rows=value if isinstance(value,list) else [value]; out=[]
            for row in rows:
                if name=='select': out.append(OrderedDict((c,row.get(c)) for c in cols))
                else: out.append(OrderedDict((k,v) for k,v in row.items() if k not in cols))
            return out if isinstance(value,list) else out[0]
        if name in ('sort','sort-by'):
            seq=list(materialize(value)); reverse='-r' in args or '--reverse' in args
            if name=='sort': return sorted(seq,key=sort_key,reverse=reverse)
            cols=[a for a in args if not a.startswith('-')]
            return sorted(seq,key=lambda r:tuple(sort_key(get_path(r,c.split('.'))) for c in cols),reverse=reverse)
        if name == 'uniq':
            out=[]
            for x in materialize(value):
                if not any(x==y for y in out): out.append(x)
            return out
        if name in ('append','prepend'):
            x=self.arg(' '.join(args),env); seq=list(materialize(value))
            return (seq+[x]) if name=='append' else ([x]+seq)
        if name == 'merge':
            other=self.arg(' '.join(args),env)
            if isinstance(value,dict) and isinstance(other,dict):
                out=OrderedDict(value); out.update(other); return out
            raise NuError('merge expects records')
        if name in ('update','insert'):
            if len(args)<2: raise NuError(f'{name} requires a cell path and value')
            path=strip_quotes(args[0]).split('.'); new=self.arg(' '.join(args[1:]),env)
            out=list(value) if isinstance(value,list) else OrderedDict(value)
            target=out
            for part in path[:-1]:
                key=int(part) if isinstance(target,list) and part.lstrip('-').isdigit() else part
                target=target[key]
            last=int(path[-1]) if isinstance(target,list) and path[-1].lstrip('-').isdigit() else path[-1]
            if name=='insert' and ((isinstance(target,list) and isinstance(last,int) and last < len(target)) or (isinstance(target,dict) and last in target)):
                raise NuError('column already exists')
            if isinstance(target,list) and name=='insert': target.insert(last,new)
            else: target[last]=new
            return out
        if name == 'rename':
            newcols=[strip_quotes(a) for a in args if not a.startswith('-')]
            rows=value if isinstance(value,list) else [value]; out=[]
            for row in rows:
                renamed=OrderedDict()
                for i,(k,v) in enumerate(row.items()): renamed[newcols[i] if i<len(newcols) else k]=v
                out.append(renamed)
            return out if isinstance(value,list) else out[0]
        if name == 'group-by':
            col=strip_quotes(args[0]); out=OrderedDict()
            for row in value: out.setdefault(scalar_text(get_path(row,col.split('.'))),[]).append(row)
            return out
        if name == 'wrap':
            col=strip_quotes(args[0]) if args else 'column0'
            return [OrderedDict([(col,x)]) for x in value] if isinstance(value,list) else OrderedDict([(col,value)])
        if name == 'flatten':
            out=[]
            for x in value: out.extend(x if isinstance(x,list) else [x])
            return out
        if name == 'enumerate': return [OrderedDict([('index',i),('item',x)]) for i,x in enumerate(value)]
        if name == 'compact': return [x for x in value if x not in (None,[],{})]
        if name == 'slice':
            r=self.arg(args[0],env); seq=materialize(value)
            if isinstance(r,RangeValue):
                end=r.end if r.exclusive else (r.end+1 if r.end is not None else None)
                return seq[r.start:end]
        if name in ('each','where','filter','any','all','reduce'):
            raw=' '.join(args); cl=self.closure(raw) if raw.strip().startswith('{') else None
            seq=materialize(value)
            if name=='each': return [self.call_closure(cl,[x],env) for x in seq]
            if name in ('where','filter'):
                if cl: return [x for x in seq if truthy(self.call_closure(cl,[x],env))]
                cond=raw
                out=[]
                for x in seq:
                    local=dict(env); local.update(x if isinstance(x,dict) else {}); local['it']=x
                    if truthy(self.expr(cond,local)): out.append(x)
                return out
            if name=='any': return any(truthy(self.call_closure(cl,[x],env)) for x in seq)
            if name=='all': return all(truthy(self.call_closure(cl,[x],env)) for x in seq)
            acc=seq[0]
            for x in seq[1:]: acc=self.call_closure(cl,[x,acc],env)
            return acc
        if name == 'default': return self.arg(args[0],env) if value is None else value
        if name == 'describe': return nu_type(value)
        if two.startswith('math '): return self.math_cmd(two[5:],value,args,env)
        if two.startswith('str '): return self.str_cmd(two[4:],value,args,env)
        if two.startswith('split '): return self.split_cmd(two[6:],value,args,env)
        if two.startswith('into '): return self.into_cmd(two[5:],value,args,env)
        if two == 'to json':
            raw='-r' in args or '--raw' in args
            indent=None if raw else 2
            if '--indent' in args: indent=int(self.arg(args[args.index('--indent')+1],env))
            if '--tabs' in args: indent='\t'*int(self.arg(args[args.index('--tabs')+1],env))
            text=json.dumps(jsonable(value),ensure_ascii=False,indent=indent,separators=(',',':') if raw else None,allow_nan=False)
            return RawOutput(text+'\n')
        if two == 'from json':
            src=value.text if isinstance(value,RawOutput) else str(value)
            if '-o' in args or '--objects' in args:
                return [json.loads(line,object_pairs_hook=OrderedDict) for line in src.splitlines() if line.strip()]
            if '-s' not in args and '--strict' not in args:
                src=re.sub(r'/\*.*?\*/','',src,flags=re.S)
                src=re.sub(r'(^|\s)//.*',r'\1',src)
                src=re.sub(r',\s*([}\]])',r'\1',src)
            return json.loads(src,object_pairs_hook=OrderedDict)
        if two in ('to csv','to tsv'):
            delim='\t' if two.endswith('tsv') else separator_arg(args,',')
            return RawOutput(to_csv(value,delim,'--noheaders' in args or '-n' in args))
        if two in ('from csv','from tsv'):
            delim='\t' if two.endswith('tsv') else separator_arg(args,',')
            src=value.text if isinstance(value,RawOutput) else str(value)
            return from_csv(src,delim,'--noheaders' in args or '-n' in args)
        if name == 'lines': return str(value).splitlines()
        if name == 'input': return sys.stdin.read()
        # Filesystem surface.
        if name == 'pwd': return self.nu_path(self.cwd)
        if name == 'cd':
            self.cwd=self.resolve(args[0] if args else '~'); return None
        if name == 'open': return self.open_file(args[0],args)
        if name == 'save':
            self.save_file(args[0],value,'--append' in args or '-a' in args); return None
        if name == 'ls': return self.list_files(next((a for a in args if not a.startswith('-')),'.'),'-a' in args or '--all' in args)
        if name == 'mkdir':
            for a in args: self.resolve(a).mkdir(parents=True,exist_ok=True)
            return None
        if name == 'touch':
            for a in args: self.resolve(a).touch()
            return None
        if name == 'rm':
            for a in (x for x in args if not x.startswith('-')):
                p=self.resolve(a)
                if p.is_dir(): shutil.rmtree(p) if ('-r' in args or '--recursive' in args) else p.rmdir()
                elif p.exists(): p.unlink()
            return None
        if two.startswith('path '): return self.path_cmd(two[5:],value,args,env)
        raise NuError(f"command not found: {name}")

    def math_cmd(self,name,value,args,env):
        seq=materialize(value)
        vals=seq if isinstance(seq,list) else [seq]
        if name=='sum': return sum(vals)
        if name=='product': return math.prod(vals)
        if name=='avg': return sum(vals)/len(vals)
        if name=='min': return min(vals)
        if name=='max': return max(vals)
        if name=='median': return statistics.median(vals)
        if name=='variance': return statistics.pvariance(vals)
        if name=='stddev': return statistics.pstdev(vals)
        x=vals[0]
        if name=='sqrt': return math.sqrt(x)
        if name=='abs': return abs(x)
        if name=='floor': return math.floor(x)
        if name=='ceil': return math.ceil(x)
        if name=='round':
            precision=0
            if '--precision' in args: precision=int(self.arg(args[args.index('--precision')+1],env))
            elif '-p' in args: precision=int(self.arg(args[args.index('-p')+1],env))
            return round(x,precision)
        raise NuError(f'unknown math command {name}')

    def map_strings(self,value,fn):
        if isinstance(value,list): return [self.map_strings(x,fn) for x in value]
        if isinstance(value,dict): return OrderedDict((k,self.map_strings(v,fn)) for k,v in value.items())
        return fn(str(value))

    def str_cmd(self,name,value,args,env):
        flags={a for a in args if a.startswith('-')}; pos=[a for a in args if not a.startswith('-')]
        def unary(fn):
            if pos and isinstance(value,(dict,list)):
                rows=value if isinstance(value,list) else [value]; out=[]
                for row in rows:
                    copy=OrderedDict(row)
                    for col in pos:
                        key=strip_quotes(col)
                        if key in copy: copy[key]=fn(str(copy[key]))
                    out.append(copy)
                return out if isinstance(value,list) else out[0]
            return self.map_strings(value,fn)
        if name=='upcase': return unary(str.upper)
        if name=='downcase': return unary(str.lower)
        if name=='capitalize': return unary(str.capitalize)
        if name in ('snake-case','kebab-case','camel-case','pascal-case'):
            def convert(s):
                s=re.sub(r'([a-z0-9])([A-Z])',r'\1 \2',s)
                parts=[x.lower() for x in re.split(r'[^A-Za-z0-9]+',s) if x]
                if name=='snake-case': return '_'.join(parts)
                if name=='kebab-case': return '-'.join(parts)
                joined=''.join(x.capitalize() for x in parts)
                return joined if name=='pascal-case' else (joined[:1].lower()+joined[1:])
            return self.map_strings(value,convert)
        if name=='trim': return unary(str.strip)
        if name=='length': return len(str(value).encode('utf-8'))
        if name=='reverse': return str(value)[::-1]
        if name in ('contains','starts-with','ends-with'):
            needle=str(self.arg(pos[0],env)); hay=str(value)
            if '-i' in flags or '--ignore-case' in flags: needle,hay=needle.lower(),hay.lower()
            return needle in hay if name=='contains' else (hay.startswith(needle) if name=='starts-with' else hay.endswith(needle))
        if name=='index-of': return str(value).find(str(self.arg(pos[0],env)))
        if name=='join': return RawOutput(str(self.arg(pos[0],env)).join(scalar_text(x) for x in value))
        if name=='replace':
            old=str(self.arg(pos[0],env)); new=str(self.arg(pos[1],env)); count=-1 if ('-a' in flags or '--all' in flags) else 1
            return str(value).replace(old,new,count)
        if name=='substring':
            r=self.arg(pos[0],env)
            if isinstance(r,RangeValue): return str(value)[r.start:(r.end if r.exclusive else r.end+1)]
        raise NuError(f'unknown str command {name}')

    def split_cmd(self,name,value,args,env):
        if name=='words': return str(value).split()
        sep=str(self.arg(args[0],env)) if args else None
        if name=='row': return str(value).split(sep)
        if name=='column':
            cols=[strip_quotes(a) for a in args[1:]]
            return OrderedDict(zip(cols,str(value).split(sep)))
        raise NuError(f'unknown split command {name}')

    def into_cmd(self,name,value,args,env):
        if name=='string': return scalar_text(value)
        if name=='int': return int(float(str(value).strip()))
        if name=='float': return float(value)
        if name=='bool': return str(value).lower()=='true' if isinstance(value,str) else bool(value)
        if name=='filesize': return FileSize(int(value))
        raise NuError(f'unknown into command {name}')

    def resolve(self,raw):
        s=strip_quotes(raw); s=os.path.expanduser(s)
        p=Path(s); return (p if p.is_absolute() else self.cwd/p).resolve()

    def nu_path(self,p):
        s=str(p).replace('\\','/')
        if re.match(r'^[A-Za-z]:/',s): s='/'+s[0].lower()+s[2:]
        return s

    def open_file(self,raw,args):
        p=self.resolve(raw); data=p.read_text(encoding='utf-8-sig')
        if '--raw' in args or '-r' in args: return data
        ext=p.suffix.lower()
        if ext=='.json': return json.loads(data,object_pairs_hook=OrderedDict)
        if ext=='.csv': return from_csv(data,',',False)
        if ext=='.tsv': return from_csv(data,'\t',False)
        return data

    def save_file(self,raw,value,append):
        p=self.resolve(raw); p.parent.mkdir(parents=True,exist_ok=True)
        if isinstance(value,RawOutput): data=value.text
        elif isinstance(value,str): data=value
        else: data=json.dumps(jsonable(value),ensure_ascii=False,indent=2)+'\n'
        with p.open('a' if append else 'w',encoding='utf-8',newline='') as f: f.write(data)

    def list_files(self,raw,all_files):
        p=self.resolve(raw); entries=list(p.iterdir()) if p.is_dir() else [p]
        rows=[]
        for x in sorted(entries,key=lambda q:q.name.lower()):
            st=x.stat()
            display_name=x.name if raw in ('.','./') else strip_quotes(raw).rstrip('/\\')+os.sep+x.name
            rows.append(OrderedDict([('name',display_name),
                                     ('type','dir' if x.is_dir() else 'file'),('size',FileSize(st.st_size)),('modified',str(st.st_mtime))]))
        return rows

    def path_cmd(self,name,value,args,env):
        s=str(value)
        p=Path(s)
        if name=='basename': return p.name
        if name=='dirname': return str(p.parent).replace('\\','/')
        if name=='extension': return p.suffix.lstrip('.')
        if name=='stem': return p.stem
        if name=='exists': return self.resolve(s).exists()
        if name=='expand': return self.nu_path(self.resolve(s))
        if name=='join': return str(p.joinpath(*(strip_quotes(a) for a in args))).replace('\\','/')
        raise NuError(f'unknown path command {name}')


def strip_quotes(s):
    s=s.strip()
    if len(s)>=2 and s[0]==s[-1] and s[0] in "'\"`":
        return unescape_double(s[1:-1]) if s[0]=='"' else s[1:-1]
    return s


def command_name(segment):
    w=split_words(segment); return w[0] if w else ''


BASE_COMMANDS={'echo','print','pwd','cd','open','save','ls','mkdir','touch','rm','input'}


def sort_key(x):
    return (x is None, x if isinstance(x,(int,float,str,bool)) else scalar_text(x))


def separator_arg(args,default):
    for flag in ('--separator','-s'):
        if flag in args and args.index(flag)+1<len(args):
            val=strip_quotes(args[args.index(flag)+1]); return '\t' if val=='\\t' else val
    return default


def to_csv(value,delim=',',noheaders=False):
    rows=value if isinstance(value,list) else [value]
    out=io.StringIO(newline=''); w=csv.writer(out,delimiter=delim,lineterminator='\n')
    if rows and isinstance(rows[0],dict):
        cols=list(rows[0].keys())
        if not noheaders: w.writerow(cols)
        for r in rows: w.writerow([scalar_text(r.get(c)) for c in cols])
    else:
        for x in rows: w.writerow([scalar_text(x)])
    return out.getvalue()


def from_csv(text,delim=',',noheaders=False):
    rows=list(csv.reader(io.StringIO(text),delimiter=delim))
    if not rows: return []
    if noheaders: headers=[f'column{i}' for i in range(1,len(rows[0])+1)]; data=rows
    else: headers,data=rows[0],rows[1:]
    return [OrderedDict((h,parse_csv_atom(v)) for h,v in zip(headers,row)) for row in data]


def parse_csv_atom(s):
    # The CSV converter infers primitive types while preserving a decimal as a
    # float (notably, 1.0 must remain distinguishable from 1).
    low=s.lower()
    if low=='true': return True
    if low=='false': return False
    if re.fullmatch(r'[+-]?\d+',s):
        try: return int(s)
        except ValueError: pass
    if re.fullmatch(r'[+-]?(?:\d+\.\d*|\d*\.\d+)(?:[eE][+-]?\d+)?',s):
        try: return float(s)
        except ValueError: pass
    return s


def parse_cli(argv):
    command=None; i=0
    while i<len(argv):
        a=argv[i]
        if a in ('-c','--commands','-e','--execute') and i+1<len(argv): command=argv[i+1]; i+=2; continue
        if a in ('-h','--help'):
            return None,'help'
        if a in ('-v','--version'):
            return None,'version'
        if not a.startswith('-') and command is None:
            command=f'open {json.dumps(a)}'
        i+=1
    return command,None


def main(argv=None):
    # Nushell writes UTF-8 bytes with LF line endings even on Windows pipes.
    # Python otherwise inherits the active ANSI code page and CRLF translation.
    try:
        sys.stdout.reconfigure(encoding='utf-8', newline='')
        sys.stderr.reconfigure(encoding='utf-8', newline='')
    except (AttributeError, ValueError):
        pass
    argv=sys.argv[1:] if argv is None else argv
    command,special=parse_cli(argv)
    if special=='version': sys.stdout.write('0.106.1\n'); return 0
    if special=='help':
        sys.stdout.write('Nushell\n\nUsage:\n  nu [OPTIONS] [FILE] [ARGUMENTS]...\n'); return 0
    if command is None: return 0
    shell=NuShell()
    try:
        result=shell.eval_script(command)
        sys.stdout.write(shell.side_output+format_value(result))
        return 0
    except (NuError,ValueError,TypeError,IndexError,KeyError,ZeroDivisionError,FileNotFoundError,OSError,json.JSONDecodeError,csv.Error) as e:
        sys.stderr.write(f'Error: nu::shell::error\n\n  x {e}\n')
        return 1


if __name__=='__main__':
    raise SystemExit(main())
