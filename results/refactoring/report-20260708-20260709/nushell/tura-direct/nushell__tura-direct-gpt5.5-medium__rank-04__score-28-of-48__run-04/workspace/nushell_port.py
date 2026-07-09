#!/usr/bin/env python3
import csv
import glob as globlib
import io
import json
import math
import os
import re
import sys
from dataclasses import dataclass


VERSION = "0.106.1"


class NuError(Exception):
    pass


@dataclass
class Result:
    value: object
    raw: bool = False


@dataclass
class Token:
    kind: str
    text: str


def tokenize(src):
    out = []
    i = 0
    two = {"==", "!=", "<=", ">=", "=~", "!~", "**", "//", "++", ".."}
    one = set("[]{}();,:|+-*/<>")
    while i < len(src):
        c = src[i]
        if c.isspace():
            i += 1
            continue
        if c == '#':
            while i < len(src) and src[i] != '\n':
                i += 1
            continue
        if c == '-' and i + 1 < len(src) and (src[i + 1].isalpha() or src[i + 1] == '-'):
            j = i + 1
            while j < len(src) and not src[j].isspace() and src[j] not in '[]{}();,:|+*/<>"\'':
                j += 1
            out.append(Token("word", src[i:j]))
            i = j
            continue
        if c == '-' and i + 1 < len(src) and src[i + 1].isdigit():
            prev = out[-1].text if out else None
            if prev in (None, "[", "(", "{", ";", ",", "|"):
                j = i + 1
                while j < len(src) and (src[j].isdigit() or src[j] == '.'):
                    j += 1
                out.append(Token("word", src[i:j]))
                i = j
                continue
        if i + 1 < len(src) and src[i:i + 2] in two:
            out.append(Token("op", src[i:i + 2]))
            i += 2
            continue
        if c in ('"', "'"):
            quote = c
            i += 1
            buf = []
            while i < len(src):
                c = src[i]
                if c == quote:
                    i += 1
                    break
                if quote == '"' and c == '\\' and i + 1 < len(src):
                    n = src[i + 1]
                    maps = {'n': '\n', 'r': '\r', 't': '\t', '"': '"', "'": "'", '\\': '\\'}
                    buf.append(maps.get(n, n))
                    i += 2
                elif quote == '"' and c == '`' and i + 1 < len(src):
                    n = src[i + 1]
                    maps = {'n': '\n', 'r': '\r', 't': '\t'}
                    buf.append(maps.get(n, n))
                    i += 2
                else:
                    buf.append(c)
                    i += 1
            else:
                raise NuError("unexpected eof")
            out.append(Token("string", "".join(buf)))
            continue
        if c == '-' and i + 1 < len(src) and (i == 0 or src[i - 1].isspace()) and (i + 1 == len(src) or src[i + 1].isspace()):
            out.append(Token("string", "-"))
            i += 1
            continue
        if c in one:
            out.append(Token("op", c))
            i += 1
            continue
        j = i
        while j < len(src) and not src[j].isspace() and src[j] not in '[]{}();,:|+-*/<>"\'':
            if j + 1 < len(src) and src[j:j + 2] in two:
                break
            j += 1
        out.append(Token("word", src[i:j]))
        i = j
    return out


class Parser:
    def __init__(self, tokens, env=None):
        self.t = tokens
        self.i = 0
        self.env = env or {}

    def peek(self, text=None):
        if self.i >= len(self.t):
            return None
        tok = self.t[self.i]
        return tok if text is None or tok.text == text else None

    def pop(self, text=None):
        tok = self.peek(text)
        if not tok:
            raise NuError("parse error")
        self.i += 1
        return tok

    def at_end(self):
        return self.i >= len(self.t)

    def parse(self):
        v = self.expr()
        return v

    def expr(self, minp=0):
        left = self.unary()
        while not self.at_end():
            op = self.peek().text
            if op in {']', '}', ')', ';', ',', '|'}:
                break
            prec = self.prec(op)
            if prec < minp:
                break
            self.pop()
            right = self.expr(prec + (0 if op == "**" else 1))
            left = apply_op(op, left, right)
        return left

    def prec(self, op):
        return {
            "or": 1, "xor": 1, "and": 2,
            "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, "=~": 3, "!~": 3,
            "++": 4, "+": 4, "-": 4,
            "*": 5, "/": 5, "//": 5, "mod": 5, "bit-and": 5, "bit-or": 5, "bit-xor": 5,
            "**": 6, "..": 7,
        }.get(op, -1)

    def unary(self):
        if self.peek("not"):
            self.pop()
            return not truthy(self.unary())
        if self.peek("-"):
            self.pop()
            v = self.unary()
            return -v if isinstance(v, (int, float)) else 0
        return self.primary()

    def primary(self):
        tok = self.pop()
        if tok.text == "(":
            v = self.expr()
            self.pop(")")
            return v
        if tok.text == "[":
            if self.peek("["):
                return self.table_body()
            vals = []
            while not self.peek("]"):
                if self.peek(","):
                    self.pop()
                    continue
                vals.append(self.expr(8))
            self.pop("]")
            return vals
        if tok.text == "{":
            return self.record_body()
        if tok.text == "if":
            cond = self.expr()
            then_v = self.block_value()
            else_v = None
            if self.peek("else"):
                self.pop()
                else_v = self.block_value()
            return then_v if truthy(cond) else else_v
        if tok.kind == "string":
            return tok.text
        text = tok.text
        if text.startswith("$"):
            return self.env.get(text[1:], None)
        if text in self.env:
            return self.env[text]
        if text == "true":
            return True
        if text == "false":
            return False
        if text == "null":
            return None
        if re.fullmatch(r"[-+]?\d+", text):
            return int(text)
        if re.fullmatch(r"[-+]?\d+\.\d+", text):
            return float(text)
        if re.fullmatch(r"\d+(kb|mb|gb|b|KB|MB|GB|B)", text):
            n = float(re.findall(r"\d+", text)[0])
            unit = re.findall(r"[A-Za-z]+", text)[0].lower()
            mul = {"b": 1, "kb": 1000, "mb": 1000 ** 2, "gb": 1000 ** 3}[unit]
            return int(n * mul)
        return text

    def block_value(self):
        self.pop("{")
        depth = 1
        start = self.i
        while self.i < len(self.t) and depth:
            if self.t[self.i].text == "{":
                depth += 1
            elif self.t[self.i].text == "}":
                depth -= 1
            self.i += 1
        inner = self.t[start:self.i - 1]
        return eval_pipeline(inner, None, dict(self.env)).value

    def record_body(self):
        rec = {}
        while not self.peek("}"):
            if self.peek(","):
                self.pop()
                continue
            if self.peek("..."):
                self.pop()
                extra = self.expr()
                if isinstance(extra, dict):
                    rec.update(extra)
                continue
            key_tok = self.pop()
            key = key_tok.text
            if key_tok.kind == "string":
                key = key_tok.text
            if self.peek(":"):
                self.pop()
            val = self.expr()
            rec[str(key)] = val
        self.pop("}")
        return rec

    def table_body(self):
        headers = self.primary()
        headers = [str(x) for x in headers]
        self.pop(";")
        rows = []
        while not self.peek("]"):
            if self.peek(","):
                self.pop()
                continue
            row = self.primary()
            if isinstance(row, list):
                rows.append({headers[i]: (row[i] if i < len(row) else None) for i in range(len(headers))})
            else:
                rows.append(row)
        self.pop("]")
        return rows


def truthy(v):
    return bool(v)


def apply_op(op, a, b):
    if op == "and":
        return truthy(a) and truthy(b)
    if op == "or":
        return truthy(a) or truthy(b)
    if op == "xor":
        return truthy(a) ^ truthy(b)
    if op == "++":
        return (a if isinstance(a, list) else [a]) + (b if isinstance(b, list) else [b])
    if op == "..":
        if not isinstance(a, int) or not isinstance(b, int):
            return []
        step = 1 if b >= a else -1
        return list(range(a, b + step, step))
    if op == "+":
        return a + b
    if op == "-":
        return a - b
    if op == "*":
        return a * b
    if op == "/":
        if b == 0:
            raise NuError("division by zero")
        return a / b
    if op == "//":
        if b == 0:
            raise NuError("division by zero")
        return a // b
    if op == "mod":
        if b == 0:
            raise NuError("division by zero")
        return a % b
    if op == "**":
        return a ** b
    if op == "bit-and":
        return int(a) & int(b)
    if op == "bit-or":
        return int(a) | int(b)
    if op == "bit-xor":
        return int(a) ^ int(b)
    if op == "==":
        return a == b
    if op == "!=":
        return a != b
    if op == "<":
        return None if a is None or b is None else a < b
    if op == "<=":
        return None if a is None or b is None else a <= b
    if op == ">":
        return None if a is None or b is None else a > b
    if op == ">=":
        return None if a is None or b is None else a >= b
    if op == "=~":
        return re.search(str(b), str(a)) is not None
    if op == "!~":
        return re.search(str(b), str(a)) is None
    raise NuError("unsupported operator")


def split_top(tokens, sep):
    parts = []
    start = 0
    depth = 0
    for i, tok in enumerate(tokens):
        if tok.text in ("(", "[", "{"):
            depth += 1
        elif tok.text in (")", "]", "}") and depth:
            depth -= 1
        elif tok.text == sep and depth == 0:
            parts.append(tokens[start:i])
            start = i + 1
    parts.append(tokens[start:])
    return parts


def eval_source(src, stdin_text=""):
    last = Result(None)
    for stmt in split_top(tokenize(src), ";"):
        if not stmt:
            continue
        last = eval_pipeline(stmt, None, {"in": stdin_text})
    return last


def eval_pipeline(tokens, input_value=None, env=None):
    stages = split_top(tokens, "|")
    cur = input_value
    raw = False
    for idx, stage in enumerate(stages):
        if not stage:
            continue
        if cur is None and idx > 0 and not is_command_stage(stage):
            cur = Parser(stage, env).parse()
            raw = False
        elif idx == 0 and not is_command_stage(stage):
            cur = Parser(stage, env).parse()
            raw = False
        else:
            res = run_command(stage, cur, env or {})
            cur, raw = res.value, res.raw
    return Result(cur, raw)


def is_command_stage(stage):
    if not stage:
        return False
    name = stage[0].text
    return name in COMMANDS or name in {"str", "math", "split", "to", "from", "into"}


def words(tokens):
    return [t.text for t in tokens]


def parse_args(tokens, env=None):
    vals = []
    for part in split_args(tokens):
        if part:
            vals.append(Parser(part, env).parse())
    return vals


def split_args(tokens):
    args = []
    start = 0
    depth = 0
    for i, tok in enumerate(tokens):
        if tok.text in ("(", "[", "{"):
            depth += 1
        elif tok.text in (")", "]", "}") and depth:
            depth -= 1
        elif tok.text == "," and depth == 0:
            if start < i:
                args.append(tokens[start:i])
            start = i + 1
    if start < len(tokens):
        args.append(tokens[start:])
    return args


def run_command(stage, inp, env):
    name = stage[0].text
    rest = stage[1:]
    w = words(rest)
    if name == "echo":
        return Result(parse_args(rest, env))
    if name == "print":
        vals = parse_args([t for t in rest if not t.text.startswith("-")], env)
        print(" ".join(to_plain(v) for v in vals))
        return Result(None)
    if name == "pwd":
        return Result(os.getcwd())
    if name == "open":
        path = str(Parser(rest[:1], env).parse()) if rest else ""
        if not os.path.exists(path):
            raise NuError("file not found")
        with open(path, "r", encoding="utf-8", newline="") as f:
            data = f.read()
        low = path.lower()
        if low.endswith(".json"):
            return Result(json.loads(data))
        if low.endswith(".csv"):
            return Result(csv_to_value(data))
        return Result(data, raw=True)
    if name == "save":
        path = None
        for x in w:
            if not x.startswith("-"):
                path = x
        if path is None:
            raise NuError("missing path")
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(to_plain(inp))
        return Result(None)
    if name == "ls":
        pat = w[0] if w else "*"
        rows = []
        for p in sorted(globlib.glob(pat)):
            try:
                st = os.stat(p)
                rows.append({"name": p, "type": "dir" if os.path.isdir(p) else "file", "size": st.st_size})
            except OSError:
                pass
        return Result(rows)
    if name == "glob":
        pat = w[0] if w else "*"
        return Result(sorted(globlib.glob(pat)))
    if name == "length":
        return Result(len(inp) if inp is not None else 0)
    if name == "first":
        return Result(inp[0] if isinstance(inp, list) and inp else None)
    if name == "last":
        return Result(inp[-1] if isinstance(inp, list) and inp else None)
    if name == "reverse":
        return Result(list(reversed(inp)) if isinstance(inp, list) else inp)
    if name == "sort":
        return Result(sorted(inp) if isinstance(inp, list) else inp)
    if name == "sort-by":
        key = w[0] if w else ""
        return Result(sorted(inp, key=lambda r: r.get(key) if isinstance(r, dict) else r))
    if name == "columns":
        if isinstance(inp, dict):
            return Result(list(inp.keys()))
        if isinstance(inp, list) and inp and isinstance(inp[0], dict):
            return Result(list(inp[0].keys()))
        return Result([])
    if name == "get":
        return Result(get_path(inp, " ".join(w)))
    if name == "select":
        cols = w
        if isinstance(inp, list):
            return Result([{c: r.get(c) for c in cols if isinstance(r, dict) and c in r} for r in inp])
        if isinstance(inp, dict):
            return Result({c: inp.get(c) for c in cols if c in inp})
        return Result(inp)
    if name == "where":
        if not isinstance(inp, list):
            return Result([])
        return Result([r for r in inp if truthy(Parser(rest, dict(env, **(r if isinstance(r, dict) else {}))).parse())])
    if name == "each":
        return Result(each_map(inp, rest, env))
    if name == "default":
        vals = parse_args(rest[:1], env)
        col = w[-1] if w else ""
        val = vals[0] if vals else None
        if isinstance(inp, list):
            return Result([dict(r, **({col: val} if isinstance(r, dict) and r.get(col) is None else {})) for r in inp])
        if isinstance(inp, dict) and inp.get(col) is None:
            d = dict(inp); d[col] = val; return Result(d)
        return Result(inp)
    if name == "upsert":
        col = w[0] if w else ""
        val = Parser(rest[1:], env).parse() if len(rest) > 1 else None
        if isinstance(inp, dict):
            d = dict(inp); d[col] = val; return Result(d)
        return Result(inp)
    if name == "describe":
        return Result(describe(inp))
    if name == "lines":
        return Result(str(inp).splitlines())
    if name == "str":
        return str_command(w, inp, rest, env)
    if name == "split":
        delim = parse_args(rest[1:], env)[0] if len(rest) > 1 else ""
        return Result(str(inp).split(str(delim)))
    if name == "math":
        return math_command(w, inp)
    if name == "to":
        if w and w[0] == "json":
            raw = "-r" in w or "--raw" in w
            return Result(json.dumps(inp, separators=(",", ":") if raw else None, indent=None if raw else 2))
        if w and w[0] == "csv":
            return Result(value_to_csv(inp))
        if w and w[0] == "nuon":
            return Result(to_nuon(inp))
    if name == "from":
        if w and w[0] == "json":
            return Result(json.loads(str(inp)))
        if w and w[0] == "csv":
            return Result(csv_to_value(str(inp)))
    if name == "into":
        if w and w[0] == "string":
            dec = None
            if "--decimals" in w:
                try:
                    dec = int(w[w.index("--decimals") + 1])
                except Exception:
                    dec = None
            if dec is not None and isinstance(inp, (int, float)):
                return Result(f"{inp:.{dec}f}")
            return Result(to_plain(inp))
    raise NuError(f"command not found: {name}")


COMMANDS = {"echo", "print", "pwd", "open", "save", "ls", "glob", "length", "first", "last", "reverse", "sort", "sort-by", "columns", "get", "select", "where", "each", "default", "upsert", "describe", "lines"}


def get_path(v, path):
    cur = v
    for part in [p for p in path.split(".") if p != ""]:
        optional = part.endswith("?")
        if optional:
            part = part[:-1]
        if isinstance(cur, list):
            if re.fullmatch(r"\d+", part):
                i = int(part)
                if i >= len(cur):
                    if optional:
                        return None
                    raise NuError("index too large")
                cur = cur[i]
            else:
                vals = []
                for r in cur:
                    if isinstance(r, dict):
                        vals.append(r.get(part, None))
                    else:
                        vals.append(None)
                cur = vals
        elif isinstance(cur, dict):
            if part in cur:
                cur = cur[part]
            elif optional:
                return None
            else:
                raise NuError("column not found")
        else:
            raise NuError("cannot get")
    return cur


def each_map(inp, rest, env):
    if not isinstance(inp, list):
        return []
    texts = words(rest)
    try:
        l = texts.index("{")
        r = len(texts) - 1 - list(reversed(texts)).index("}")
    except ValueError:
        return inp
    inner = rest[l + 1:r]
    var = "it"
    if inner and inner[0].text.startswith("|"):
        pass
    if inner and inner[0].text == "|":
        var = inner[1].text.lstrip("$")
        inner = inner[3:] if len(inner) > 2 and inner[2].text == "|" else inner[2:]
    elif inner and inner[0].text.startswith("|"):
        var = inner[0].text.strip("|$")
        inner = inner[1:]
    return [eval_pipeline(inner, x, dict(env, **{var: x, "it": x})).value for x in inp]


def str_command(w, inp, rest, env):
    sub = w[0] if w else ""
    s = "" if inp is None else str(inp)
    if sub == "length":
        return Result(len(s))
    if sub == "upcase":
        return Result(s.upper())
    if sub == "downcase":
        return Result(s.lower())
    if sub == "contains":
        needle = parse_args(rest[1:], env)[0] if len(rest) > 1 else ""
        return Result(str(needle) in s)
    if sub == "replace":
        vals = parse_args(rest[1:], env)
        old = str(vals[0]) if vals else ""
        new = str(vals[1]) if len(vals) > 1 else ""
        return Result(s.replace(old, new, 1))
    if sub == "trim":
        return Result(s.strip())
    if sub == "join":
        try:
            delim = parse_args(rest[1:], env)[0] if len(rest) > 1 else ""
        except Exception:
            delim = " ".join(t.text for t in rest[1:])
        if isinstance(inp, list):
            return Result(str(delim).join(to_plain(x) for x in inp), raw=True)
        return Result(s, raw=True)
    raise NuError("unknown str command")


def math_command(w, inp):
    vals = inp if isinstance(inp, list) else [inp]
    nums = [x for x in vals if isinstance(x, (int, float))]
    sub = w[0] if w else ""
    if sub == "sum":
        return Result(sum(nums))
    if sub == "avg":
        return Result(sum(nums) / len(nums) if nums else math.nan)
    if sub == "min":
        return Result(min(nums) if nums else None)
    if sub == "max":
        return Result(max(nums) if nums else None)
    if sub == "median":
        nums = sorted(nums)
        n = len(nums)
        return Result(nums[n // 2] if n % 2 else (nums[n // 2 - 1] + nums[n // 2]) / 2)
    raise NuError("unknown math command")


def csv_to_value(data):
    rows = list(csv.reader(io.StringIO(data)))
    if not rows:
        return []
    header = rows[0]
    out = []
    for row in rows[1:]:
        if len(row) != len(header):
            continue
        out.append({header[i]: parse_cell(row[i]) for i in range(len(header))})
    return out


def parse_cell(x):
    if re.fullmatch(r"[-+]?\d+", x):
        return int(x)
    if re.fullmatch(r"[-+]?\d+\.\d+", x):
        return float(x)
    return x


def value_to_csv(v):
    out = io.StringIO()
    if isinstance(v, list) and v and isinstance(v[0], dict):
        header = list(v[0].keys())
        writer = csv.DictWriter(out, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        writer.writerows(v)
    elif isinstance(v, list):
        writer = csv.writer(out, lineterminator="\n")
        for x in v:
            writer.writerow([x])
    return out.getvalue().rstrip("\n")


def to_plain(v):
    if v is None:
        return ""
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, float) and v.is_integer():
        return f"{v:.1f}" if "." in str(v) else str(int(v))
    return str(v)


def to_nuon(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return json.dumps(v)
    if isinstance(v, str) and (v.startswith("{") or v.startswith("[") or "," in v or "\n" in v):
        return v + ("" if no_newline else "\n")
    if isinstance(v, list):
        return "[" + ", ".join(to_nuon(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(f"{k}: {to_nuon(val)}" for k, val in v.items()) + "}"
    return to_plain(v)


def describe(v):
    if v is None:
        return "nothing"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if isinstance(v, str):
        return "string"
    if isinstance(v, list):
        return "list<any>"
    if isinstance(v, dict):
        return "record"
    return "any"


def render(v, raw=False, no_newline=False):
    if v is None:
        return ""
    if raw:
        return to_plain(v) + ("" if no_newline or isinstance(v, str) else "\n")
    if isinstance(v, list):
        return render_list(v)
    if isinstance(v, dict):
        return render_record(v)
    return to_plain(v) + ("" if no_newline else "\n")


def render_list(v):
    if not v:
        return "╭────────────╮\n│ empty list │\n╰────────────╯\n"
    if all(isinstance(x, dict) for x in v):
        cols = []
        for r in v:
            for k in r.keys():
                if k not in cols:
                    cols.append(k)
        headers = ["#"] + cols
        rows = [[str(i)] + [to_plain(r.get(c, "")) for c in cols] for i, r in enumerate(v)]
        return box(headers, rows)
    rows = [[str(i), to_plain(x)] for i, x in enumerate(v)]
    return box(["", ""], rows, scalar=True)


def render_record(v):
    rows = [[k, to_plain(val)] for k, val in v.items()]
    return box(["", ""], rows, scalar=True)


def box(headers, rows, scalar=False):
    widths = []
    for c in range(len(headers)):
        vals = [headers[c]] + [r[c] for r in rows]
        widths.append(max(1, max(len(x) for x in vals)))
    def line(left, mid, right, fill):
        return left + mid.join(fill * (w + 2) for w in widths) + right + "\n"
    s = line("╭", "┬", "╮", "─")
    if not scalar:
        s += "│" + "│".join(" " + headers[i].rjust(widths[i]) + " " for i in range(len(headers))) + "│\n"
        s += line("├", "┼", "┤", "─")
    for r in rows:
        cells = []
        for i, cell in enumerate(r):
            align = cell.rjust(widths[i]) if re.fullmatch(r"[-+]?\d+(\.\d+)?", cell) or i == 0 else cell.ljust(widths[i])
            cells.append(" " + align + " ")
        s += "│" + "│".join(cells) + "│\n"
    s += line("╰", "┴", "╯", "─")
    return s


def help_text():
    return """The nushell language and shell.

Usage:
  > nu {flags} (script file) ...(script args) 

Flags:
  -h, --help: Display the help message for this command
  -c, --commands <string>: run the given commands and then exit
  -n, --no-config-file: start with no config file and no env file
  -v, --version: print the version
  --stdin: redirect standard input to a command (with `-c`) or a script file
"""


def main(argv):
    if "--version" in argv or "-v" in argv:
        sys.stdout.write(VERSION + "\n")
        return 0
    if "--help" in argv or "-h" in argv:
        sys.stdout.write(help_text())
        return 0
    no_newline = "--no-newline" in argv
    stdin_text = sys.stdin.read() if "--stdin" in argv else ""
    src = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-c", "--commands") and i + 1 < len(argv):
            src = argv[i + 1]
            i += 2
        elif a.startswith("-"):
            i += 1
        elif src is None and os.path.exists(a):
            with open(a, "r", encoding="utf-8") as f:
                src = f.read()
            i += 1
        else:
            i += 1
    if src is None:
        return 0
    try:
        res = eval_source(src, stdin_text)
        sys.stdout.write(render(res.value, res.raw, no_newline))
        return 0
    except Exception as e:
        sys.stderr.write(f"Error: nu::shell::error\n\n  x {e}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
