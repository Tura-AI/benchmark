#!/usr/bin/env python3
import csv
import io
import json
import math
import os
import re
import sys
from collections import OrderedDict


class NuError(Exception):
    pass


class Lexer:
    def __init__(self, text):
        self.text = text
        self.i = 0
        self.tokens = []

    def lex(self):
        while self.i < len(self.text):
            c = self.text[self.i]
            if c.isspace():
                self.i += 1
                continue
            if c == '#':
                break
            if c in '[]{}();,:|':
                if c == '|' and self._peek(1) == '|':
                    self.tokens.append(('op', '||'))
                    self.i += 2
                else:
                    self.tokens.append((c, c))
                    self.i += 1
                continue
            if c in '+-*/<>=!':
                two = self.text[self.i:self.i + 2]
                if two in ('==', '!=', '<=', '>=', '//', '**'):
                    self.tokens.append(('op', two))
                    self.i += 2
                else:
                    self.tokens.append(('op', c))
                    self.i += 1
                continue
            if c in ('"', "'"):
                self.tokens.append(('str', self._string(c)))
                continue
            start = self.i
            while self.i < len(self.text):
                ch = self.text[self.i]
                if ch.isspace() or ch in '[]{}();,:|+-*/<>=!':
                    break
                self.i += 1
            self.tokens.append(('word', self.text[start:self.i]))
        self.tokens.append(('eof', ''))
        return self.tokens

    def _peek(self, n):
        j = self.i + n
        return self.text[j] if j < len(self.text) else ''

    def _string(self, quote):
        self.i += 1
        out = []
        while self.i < len(self.text):
            c = self.text[self.i]
            self.i += 1
            if c == quote:
                return ''.join(out)
            if c == '\\' and quote == '"':
                if self.i >= len(self.text):
                    out.append('\\')
                    break
                esc = self.text[self.i]
                self.i += 1
                out.append({'n': '\n', 'r': '\r', 't': '\t', '"': '"', '\\': '\\'}.get(esc, esc))
            else:
                out.append(c)
        raise NuError('unclosed string')


class Parser:
    def __init__(self, text):
        self.tokens = Lexer(text).lex()
        self.i = 0

    def peek(self):
        return self.tokens[self.i]

    def pop(self):
        t = self.tokens[self.i]
        self.i += 1
        return t

    def accept(self, typ, val=None):
        if self.peek()[0] == typ and (val is None or self.peek()[1] == val):
            return self.pop()
        return None

    def expect(self, typ, val=None):
        t = self.pop()
        if t[0] != typ or (val is not None and t[1] != val):
            raise NuError('parse error')
        return t

    def parse_pipeline(self):
        parts = []
        current = []
        depth = 0
        start = 0
        # Split by top-level pipeline bars in the original token stream.
        for idx, tok in enumerate(self.tokens[:-1]):
            if tok[0] in ('[', '{', '('):
                depth += 1
            elif tok[0] in (']', '}', ')'):
                depth -= 1
            elif tok[0] == '|' and depth == 0:
                parts.append(self.tokens[start:idx])
                start = idx + 1
        parts.append(self.tokens[start:-1])
        return [p for p in parts if p]

    def parse_expr(self):
        return self.parse_or()

    def parse_or(self):
        v = self.parse_and()
        while self._word('or') or self.accept('op', '||'):
            v = bool(v) or bool(self.parse_and())
        return v

    def parse_and(self):
        v = self.parse_cmp()
        while self._word('and'):
            v = bool(v) and bool(self.parse_cmp())
        return v

    def parse_cmp(self):
        v = self.parse_add()
        while self.peek()[1] in ('==', '!=', '<', '<=', '>', '>='):
            op = self.pop()[1]
            r = self.parse_add()
            if op == '==':
                v = v == r
            elif op == '!=':
                v = v != r
            elif op == '<':
                v = v < r
            elif op == '<=':
                v = v <= r
            elif op == '>':
                v = v > r
            elif op == '>=':
                v = v >= r
        return v

    def parse_add(self):
        v = self.parse_mul()
        while self.peek()[1] in ('+', '-'):
            op = self.pop()[1]
            r = self.parse_mul()
            v = v + r if op == '+' else v - r
        return v

    def parse_mul(self):
        v = self.parse_pow()
        while self.peek()[1] in ('*', '/', '//') or self._word('mod', consume=False):
            op = self.pop()[1]
            r = self.parse_pow()
            if op == '*':
                v = v * r
            elif op == '/':
                v = v / r
            elif op == '//':
                v = v // r
            else:
                v = v % r
        return v

    def parse_pow(self):
        v = self.parse_unary()
        if self.accept('op', '**'):
            v = v ** self.parse_pow()
        return v

    def parse_unary(self):
        if self.accept('op', '-'):
            return -self.parse_unary()
        if self._word('not'):
            return not bool(self.parse_unary())
        return self.parse_primary()

    def parse_primary(self):
        typ, val = self.peek()
        if typ == 'str':
            self.pop()
            return val
        if typ == 'word':
            self.pop()
            if val == 'true':
                return True
            if val == 'false':
                return False
            if val == 'null':
                return None
            if re.fullmatch(r'\d+', val):
                return int(val)
            if re.fullmatch(r'\d+\.\d+', val):
                return float(val)
            if val.startswith('$'):
                return Var(val[1:])
            return val
        if self.accept('('):
            v = self.parse_expr()
            self.expect(')')
            return v
        if self.accept('['):
            return self.parse_list()
        if self.accept('{'):
            return self.parse_record()
        raise NuError('parse error')

    def parse_list(self):
        if self.accept(']'):
            return []
        if self.accept('['):
            headers = []
            while not self.accept(']'):
                headers.append(str(self.parse_expr()))
                self.accept(',')
            self.expect(';')
            rows = []
            while not self.accept(']'):
                self.expect('[')
                vals = []
                while not self.accept(']'):
                    vals.append(self.parse_expr())
                    self.accept(',')
                rows.append(OrderedDict((h, vals[i] if i < len(vals) else None) for i, h in enumerate(headers)))
            return rows
        vals = []
        while not self.accept(']'):
            vals.append(self.parse_expr())
            self.accept(',')
        return vals

    def parse_record(self):
        rec = OrderedDict()
        while not self.accept('}'):
            key = self.pop()[1]
            self.expect(':')
            rec[str(key)] = self.parse_expr()
            self.accept(',')
        return rec

    def _word(self, word, consume=True):
        if self.peek()[0] == 'word' and self.peek()[1] == word:
            if consume:
                self.pop()
            return True
        return False


class Var:
    def __init__(self, name):
        self.name = name


def parse_value(text):
    p = Parser(text)
    v = p.parse_expr()
    return v


def token_text(tokens):
    vals = []
    for typ, val in tokens:
        if typ == 'str':
            vals.append(json.dumps(val))
        else:
            vals.append(val)
    return ' '.join(vals)


def split_words(command):
    return [v for _, v in command if _ not in ('eof',)]


def eval_condition(tokens, row):
    expr = token_text(tokens)
    expr = re.sub(r'\$it\b', 'it', expr)
    env = {'it': row}
    if isinstance(row, dict):
        env.update(row)
    expr = re.sub(r'\bmod\b', '%', expr)
    expr = expr.replace(' and ', ' and ').replace(' or ', ' or ')
    expr = re.sub(r'\btrue\b', 'True', expr)
    expr = re.sub(r'\bfalse\b', 'False', expr)
    expr = re.sub(r'\bnull\b', 'None', expr)
    try:
        return bool(eval(expr, {'__builtins__': {}}, env))
    except Exception:
        return False


def convert_atom(s):
    if s == '':
        return ''
    if re.fullmatch(r'-?\d+', s):
        return int(s)
    if re.fullmatch(r'-?\d+\.\d+', s):
        return float(s)
    if s.lower() == 'true':
        return True
    if s.lower() == 'false':
        return False
    return s


def to_json(v, raw=False):
    if raw:
        return json.dumps(v, ensure_ascii=False, separators=(',', ':')) + '\n'
    return json.dumps(v, ensure_ascii=False, indent=2) + '\n'


def to_csv(v):
    if isinstance(v, dict):
        rows = [v]
    elif isinstance(v, list):
        rows = v
    else:
        rows = [{'': v}]
    headers = []
    for row in rows:
        if isinstance(row, dict):
            for k in row.keys():
                if k not in headers:
                    headers.append(k)
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, fieldnames=headers, lineterminator='\n')
    writer.writeheader()
    for row in rows:
        writer.writerow({k: stringify(row.get(k, '')) if isinstance(row, dict) else stringify(row) for k in headers})
    return out.getvalue()


def from_csv_text(s):
    reader = csv.DictReader(io.StringIO(str(s)))
    rows = []
    for row in reader:
        rows.append(OrderedDict((k, convert_atom(v)) for k, v in row.items()))
    return rows


def from_json_text(s):
    return json.loads(str(s))


def stringify(v):
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def format_table(value):
    if isinstance(value, dict):
        rows = [[str(k), stringify(v)] for k, v in value.items()]
        return boxed(rows)
    if isinstance(value, list):
        if not value:
            return ''
        if all(isinstance(x, dict) for x in value):
            headers = ['#']
            for row in value:
                for k in row:
                    if k not in headers:
                        headers.append(k)
            rows = [headers]
            rows.append('__SEP__')
            for i, row in enumerate(value):
                rows.append([str(i)] + [stringify(row.get(h, '')) for h in headers[1:]])
            return boxed(rows)
        rows = [[str(i), stringify(v)] for i, v in enumerate(value)]
        return boxed(rows)
    return stringify(value) + '\n'


def boxed(rows):
    data_rows = [r for r in rows if r != '__SEP__']
    widths = [0] * max(len(r) for r in data_rows)
    for r in data_rows:
        for i, c in enumerate(r):
            widths[i] = max(widths[i], len(c))
    def line(left, mid, right):
        return left + mid.join('─' * (w + 2) for w in widths) + right
    def row(r):
        cells = []
        for i, w in enumerate(widths):
            c = r[i] if i < len(r) else ''
            if re.fullmatch(r'-?\d+(\.\d+)?', c):
                cells.append(' ' + c.rjust(w) + ' ')
            else:
                cells.append(' ' + c.ljust(w) + ' ')
        return '│' + '│'.join(cells) + '│'
    out = [line('╭', '┬', '╮')]
    for r in rows:
        if r == '__SEP__':
            out.append(line('├', '┼', '┤'))
        else:
            out.append(row(r))
    out.append(line('╰', '┴', '╯'))
    return '\n'.join(out) + '\n'


def run_command(input_value, tokens):
    if not tokens:
        return input_value
    words = split_words(tokens)
    name = words[0]
    rest = words[1:]
    if name in ('to', 'from', 'math', 'str') and rest:
        name = name + ' ' + rest[0]
        rest = rest[1:]

    if name == 'to json':
        cmd_text = token_text(tokens)
        return RawOutput(to_json(input_value, '--raw' in cmd_text or 'raw' in rest or ' -r' in cmd_text))
    if name == 'from json':
        return from_json_text(input_value)
    if name == 'to csv':
        return RawOutput(to_csv(input_value))
    if name == 'from csv':
        return from_csv_text(input_value)
    if name == 'math sum':
        return sum(input_value or [])
    if name == 'math avg':
        vals = list(input_value or [])
        return sum(vals) / len(vals) if vals else math.nan
    if name == 'math min':
        return min(input_value)
    if name == 'math max':
        return max(input_value)
    if name == 'length':
        return len(input_value) if input_value is not None else 0
    if name == 'first':
        n = int(rest[0]) if rest else None
        return input_value[:n] if n is not None and isinstance(input_value, list) else input_value[0]
    if name == 'last':
        n = int(rest[0]) if rest else None
        return input_value[-n:] if n is not None and isinstance(input_value, list) else input_value[-1]
    if name == 'get':
        key = rest[0]
        if isinstance(input_value, list):
            if re.fullmatch(r'\d+', key):
                return input_value[int(key)]
            return [x.get(key) if isinstance(x, dict) else None for x in input_value]
        if isinstance(input_value, dict):
            return input_value.get(key)
        return None
    if name == 'select':
        keys = rest
        if isinstance(input_value, list):
            return [OrderedDict((k, r.get(k)) for k in keys if isinstance(r, dict) and k in r) for r in input_value]
        if isinstance(input_value, dict):
            return OrderedDict((k, input_value.get(k)) for k in keys if k in input_value)
    if name == 'where':
        return [r for r in input_value if eval_condition(tokens[1:], r)]
    if name == 'sort':
        return sorted(input_value)
    if name == 'reverse':
        return list(reversed(input_value))
    if name == 'uniq':
        out = []
        for x in input_value:
            if x not in out:
                out.append(x)
        return out
    if name == 'str upcase':
        return str(input_value).upper()
    if name == 'str downcase':
        return str(input_value).lower()
    if name == 'str trim':
        return str(input_value).strip()
    if name == 'str contains':
        return rest[0] in str(input_value)
    if name == 'str starts-with':
        return str(input_value).startswith(rest[0])
    if name == 'str ends-with':
        return str(input_value).endswith(rest[0])
    if name == 'str replace':
        old = rest[0] if rest else ''
        new = rest[1] if len(rest) > 1 else ''
        return str(input_value).replace(old, new, 1)
    if name == 'lines':
        return str(input_value).splitlines()
    if name == 'split' and rest[:1] == ['row']:
        sep = rest[1] if len(rest) > 1 else '\n'
        return str(input_value).split(sep)
    if name == 'each':
        body = token_text(tokens)
        m = re.search(r'\{\s*\|\s*(\w+)\s*\|\s*(.*?)\s*\}', body)
        if not m:
            return input_value
        var, expr = m.group(1), m.group(2)
        out = []
        for item in input_value:
            out.append(eval_simple_expr(expr.replace('$' + var, literal(item))))
        return out
    raise NuError('unknown command')


class RawOutput:
    def __init__(self, text):
        self.text = text


def literal(v):
    if isinstance(v, str):
        return json.dumps(v)
    return stringify(v)


def eval_simple_expr(expr):
    return parse_value(expr)


def eval_source(source):
    p = Parser(source)
    parts = p.parse_pipeline()
    if not parts:
        return None
    first_text = token_text(parts[0])
    words = split_words(parts[0])
    if words and words[0] in BUILTINS:
        value = run_top_command(parts[0])
    else:
        value = parse_value(first_text)
    for part in parts[1:]:
        value = run_command(value, part)
    return value


BUILTINS = {'pwd', 'ls', 'open', 'seq', 'date', 'mkdir', 'rm', 'cp', 'mv', 'print', 'echo'}


def run_top_command(tokens):
    words = split_words(tokens)
    name = words[0]
    args = words[1:]
    if name == 'pwd':
        return os.getcwd()
    if name == 'open':
        path = args[0]
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    if name == 'ls':
        path = args[0] if args else '.'
        rows = []
        for n in sorted(os.listdir(path)):
            if n == '.git':
                continue
            p = os.path.join(path, n)
            rows.append(OrderedDict([('name', n), ('type', 'dir' if os.path.isdir(p) else 'file'), ('size', os.path.getsize(p) if os.path.isfile(p) else 0)]))
        return rows
    if name == 'seq':
        start = int(args[0])
        end = int(args[1])
        return list(range(start, end + 1))
    if name in ('print', 'echo'):
        if len(args) <= 1:
            return parse_value(token_text(tokens[1:]))
        return RawOutput(''.join(stringify(a) + '\n' for a in args))
    if name == 'mkdir':
        for a in args:
            os.makedirs(a, exist_ok=True)
        return None
    raise NuError('unknown command')


def print_value(v):
    if isinstance(v, RawOutput):
        write_out(v.text)
    elif v is None:
        return
    elif isinstance(v, (list, dict)):
        write_out(format_table(v))
    else:
        write_out(stringify(v) + '\n')


def write_out(text):
    sys.stdout.buffer.write(text.encode('utf-8'))


def error_message(source):
    cmd = source.strip().split()[0] if source.strip() else ''
    return (
        "Error: nu::shell::external_command\n\n"
        "  x External command failed\n"
        "   ,-[source:1:1]\n"
        f" 1 | {source}\n"
        f"   : {'^' * max(1, len(cmd))}\n"
        f"  help: `{cmd}` is neither a Nushell built-in or a known external\n"
        "        command\n\n"
    )


def main(argv):
    if not argv or '--help' in argv or '-h' in argv:
        write_out("Nushell 0.106.1\n")
        return 0
    if '--version' in argv or '-V' in argv:
        write_out("0.106.1\n")
        return 0
    command = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ('--no-config-file', '--no-history', '--no-std-lib'):
            i += 1
            continue
        if a == '-c' or a == '--commands':
            if i + 1 >= len(argv):
                sys.stderr.buffer.write(b"Error: missing command\n")
                return 1
            command = argv[i + 1]
            i += 2
            continue
        i += 1
    if command is None:
        data = sys.stdin.read()
        if data:
            command = data
        else:
            return 0
    try:
        print_value(eval_source(command))
        return 0
    except Exception:
        sys.stderr.buffer.write(error_message(command).encode('utf-8'))
        return 1


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
