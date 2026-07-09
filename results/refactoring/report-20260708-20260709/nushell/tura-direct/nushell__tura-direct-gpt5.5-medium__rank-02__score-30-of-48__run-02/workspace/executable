#!/usr/bin/env python3
import csv
import io
import json
import math
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path


VERSION = "0.106.1"


class NuError(Exception):
    def __init__(self, code="nu::shell::generic_error", message="Error"):
        self.code = code
        self.message = message
        super().__init__(message)


NULL = None


@dataclass
class RangeValue:
    start: object
    step: object
    end: object
    inclusive: bool = True
    unbounded: bool = False

    def materialize(self, limit=10000):
        start = self.start
        step = self.step
        if step is None:
            if self.end is None:
                step = 1
            else:
                step = 1 if self.end >= start else -1
        out = []
        cur = start
        if self.unbounded or self.end is None:
            for _ in range(limit):
                out.append(cur)
                cur = cur + step
            return out
        if step == 0:
            return [cur]
        if step > 0:
            pred = (lambda x: x <= self.end) if self.inclusive else (lambda x: x < self.end)
        else:
            pred = (lambda x: x >= self.end) if self.inclusive else (lambda x: x > self.end)
        while pred(cur) and len(out) < limit:
            out.append(cur)
            cur = cur + step
        return out

    def contains(self, value):
        if not isinstance(value, (int, float)):
            raise NuError("nu::parser::operator_incompatible_types", "operator_incompatible_types")
        step = self.step
        if step is None:
            step = 1 if (self.end is None or self.end >= self.start) else -1
        if self.end is not None and not self.unbounded:
            if step > 0 and (value < self.start or (value > self.end if self.inclusive else value >= self.end)):
                return False
            if step < 0 and (value > self.start or (value < self.end if self.inclusive else value <= self.end)):
                return False
        else:
            if step > 0 and value < self.start:
                return False
            if step < 0 and value > self.start:
                return False
        diff = (value - self.start) / step
        return abs(diff - round(diff)) < 1e-9


@dataclass
class Token:
    kind: str
    value: str


def split_top(text, sep):
    out, buf = [], []
    depth = 0
    quote = None
    i = 0
    while i < len(text):
        ch = text[i]
        if quote:
            buf.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < len(text):
                i += 1
                buf.append(text[i])
            elif ch == quote:
                quote = None
            i += 1
            continue
        if ch in "'\"`":
            quote = ch
            buf.append(ch)
        elif ch in "([{":
            depth += 1
            buf.append(ch)
        elif ch in ")]}":
            depth -= 1
            buf.append(ch)
        elif ch == sep and depth == 0:
            out.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
        i += 1
    out.append("".join(buf).strip())
    return [x for x in out if x != ""]


def tokenize(text):
    toks = []
    i = 0
    list_depth = 0
    while i < len(text):
        c = text[i]
        if c.isspace():
            i += 1
            continue
        if text.startswith("..<", i):
            toks.append(Token("op", "..<")); i += 3; continue
        if text.startswith("..", i):
            toks.append(Token("op", "..")); i += 2; continue
        if text.startswith("==", i) or text.startswith("!=", i) or text.startswith("<=", i) or text.startswith(">=", i) or text.startswith("=~", i) or text.startswith("!~", i) or text.startswith("**", i):
            toks.append(Token("op", text[i:i+2])); i += 2; continue
        if c == "$":
            if i + 1 < len(text) and text[i + 1] in "'\"":
                q = text[i + 1]
                j = i + 2
                buf = []
                while j < len(text):
                    if text[j] == q:
                        break
                    if text[j] == "\\" and q == '"' and j + 1 < len(text):
                        j += 1
                    buf.append(text[j])
                    j += 1
                toks.append(Token("interp", "".join(buf)))
                i = j + 1
            else:
                j = i + 1
                while j < len(text) and (text[j].isalnum() or text[j] in "_-."):
                    j += 1
                toks.append(Token("var", text[i+1:j])); i = j
            continue
        if c in "'\"`":
            q = c
            j = i + 1
            buf = []
            while j < len(text):
                if text[j] == q:
                    break
                if text[j] == "\\" and q == '"' and j + 1 < len(text):
                    j += 1
                    esc = text[j]
                    buf.append({"n": "\n", "r": "\r", "t": "\t", '"': '"', "\\": "\\"}.get(esc, esc))
                else:
                    buf.append(text[j])
                j += 1
            if j >= len(text):
                raise NuError("nu::parser::parse_mismatch", f"expected closing {q}")
            toks.append(Token("string", "".join(buf))); i = j + 1; continue
        if c == "r" and i + 1 < len(text) and text[i + 1] == "#":
            j = i + 1
            while j < len(text) and text[j] == "#":
                j += 1
            if j < len(text) and text[j] == "'":
                marks = text[i+1:j]
                end = "'" + marks
                k = text.find(end, j + 1)
                if k < 0:
                    raise NuError("nu::parser::parse_mismatch", f"expected closing {end}")
                toks.append(Token("string", text[j+1:k])); i = k + len(end); continue
        if c.isdigit() or (c == "-" and i + 1 < len(text) and text[i+1].isdigit() and (list_depth > 0 or not toks or toks[-1].value in {"[", "(", "{", ",", ";", "..", "..<"})):
            j = i + 1
            while j < len(text) and (text[j].isdigit() or text[j] in "._"):
                if text[j:j+2] in ("..", ".<"):
                    break
                j += 1
            num = text[i:j].replace("_", "")
            toks.append(Token("number", num)); i = j; continue
        if c in "()[]{};,:|.+-*/<>":
            if c == "[":
                list_depth += 1
            elif c == "]" and list_depth > 0:
                list_depth -= 1
            toks.append(Token("sym" if c not in "+-*/<>" else "op", c)); i += 1; continue
        if c.isalpha() or c in "_#":
            j = i + 1
            while j < len(text) and (text[j].isalnum() or text[j] in "_-?"):
                j += 1
            v = text[i:j]
            if v in {"and", "or", "xor", "in", "not-in", "mod", "bit-shr", "bit-shl", "bit-and", "bit-or", "bit-xor", "not"}:
                toks.append(Token("op", v))
            else:
                toks.append(Token("ident", v))
            i = j; continue
        toks.append(Token("ident", c)); i += 1
    toks.append(Token("eof", ""))
    return toks


class Parser:
    def __init__(self, text, env=None, pipeline=NULL):
        self.toks = tokenize(text)
        self.i = 0
        self.env = env if env is not None else {}
        self.pipeline = pipeline

    def peek(self):
        return self.toks[self.i]

    def pop(self, value=None):
        t = self.peek()
        if value is not None and t.value != value:
            raise NuError("nu::parser::parse_mismatch", f"expected {value}")
        self.i += 1
        return t

    def accept(self, value):
        if self.peek().value == value:
            self.i += 1
            return True
        return False

    def parse(self):
        if self.peek().kind == "eof":
            return NULL
        val = self.expr(0)
        return val

    def expr(self, minp):
        if self.peek().value == "not":
            self.pop(); left = not truthy(self.expr(80))
        elif self.peek().value == "-":
            self.pop(); left = -self.expr(80)
        else:
            left = self.primary()
        while True:
            tok = self.peek()
            if tok.value == ".":
                self.pop()
                part = self.pop()
                optional = False
                name = part.value
                if name.endswith("?"):
                    optional = True; name = name[:-1]
                key = int(name) if re.fullmatch(r"-?\d+", name) else name
                left = cell_get(left, key, optional)
                continue
            if tok.value in ("..", "..<") and minp <= 5:
                inclusive = tok.value == ".."
                self.pop()
                if self.peek().kind == "eof" or self.peek().value in ")]}|,;":
                    left = RangeValue(left, None, None, True, True)
                else:
                    mid = self.expr(6)
                    if self.accept(".."):
                        if self.peek().kind == "eof" or self.peek().value in ")]}|,;":
                            left = RangeValue(left, mid - left, None, True, True)
                        else:
                            end = self.expr(6)
                            left = RangeValue(left, mid - left, end, inclusive, False)
                    else:
                        left = RangeValue(left, None, mid, inclusive, False)
                continue
            prec = precedence(tok.value)
            if prec < minp:
                break
            op = tok.value
            self.pop()
            right = self.expr(prec + (0 if op == "**" else 1))
            left = apply_op(op, left, right)
        return left

    def primary(self):
        t = self.pop()
        if t.kind == "number":
            return float(t.value) if "." in t.value else int(t.value)
        if t.kind == "string":
            return t.value
        if t.kind == "interp":
            return interpolate(t.value, self.env, self.pipeline)
        if t.kind == "var":
            if t.value in ("in", "it"):
                return self.pipeline
            parts = t.value.split(".")
            val = self.env.get(parts[0], NULL)
            for p in parts[1:]:
                if p:
                    val = cell_get(val, int(p) if p.isdigit() else p, False)
            return val
        if t.kind == "ident":
            if t.value == "true": return True
            if t.value == "false": return False
            if t.value == "null": return NULL
            return t.value
        if t.kind == "eof":
            raise NuError("nu::parser::incomplete_math_expression", "Incomplete math expression.")
        if t.value == "(":
            val = eval_script_until_matching(self.collect_group("(", ")"), self.env, self.pipeline)
            return val
        if t.value == "[":
            return self.parse_list()
        if t.value == "{":
            return self.parse_record()
        raise NuError("nu::parser::parse_mismatch", "parse error")

    def collect_group(self, left, right):
        depth = 1
        vals = []
        while depth and self.peek().kind != "eof":
            t = self.pop()
            if t.value == left: depth += 1
            if t.value == right:
                depth -= 1
                if depth == 0: break
            vals.append(t.value if t.kind not in ("string", "interp") else quote_token(t))
        return " ".join(vals)

    def parse_list(self):
        if self.accept("]"):
            return []
        items = []
        while True:
            if self.peek().value == "[":
                self.pop()
                row = self.parse_list_body()
                items.append(row)
            else:
                items.append(self.expr(0))
            self.accept(",")
            if self.accept(";"):
                headers = [str(x) for x in items[0]] if items and isinstance(items[0], list) else [str(x) for x in items]
                rows = []
                while not self.accept("]"):
                    if self.accept("["):
                        vals = self.parse_list_body()
                    else:
                        vals = [self.expr(0)]
                    rows.append({h: vals[n] if n < len(vals) else NULL for n, h in enumerate(headers)})
                    self.accept(",")
                return rows
            if self.accept("]"):
                return items

    def parse_list_body(self):
        vals = []
        while not self.accept("]"):
            vals.append(self.expr(0))
            self.accept(",")
        return vals

    def parse_record(self):
        rec = {}
        while not self.accept("}"):
            keytok = self.pop()
            key = keytok.value
            self.accept(":")
            rec[key] = self.expr(0)
            self.accept(",")
        return rec


def quote_token(t):
    return json.dumps(t.value)


def precedence(op):
    return {
        "or": 10, "xor": 11, "and": 12,
        "in": 20, "not-in": 20, "==": 20, "!=": 20, "<": 20, "<=": 20, ">": 20, ">=": 20, "=~": 20, "!~": 20,
        "bit-or": 30, "bit-xor": 31, "bit-and": 32,
        "+": 40, "-": 40,
        "*": 50, "/": 50, "mod": 50,
        "bit-shl": 55, "bit-shr": 55,
        "**": 70,
    }.get(op, -1)


def truthy(x):
    return bool(x)


def apply_op(op, a, b):
    if op == "+": return a + b
    if op == "-": return a - b
    if op == "*": return a * b
    if op == "/": return a / b
    if op == "mod": return a % b
    if op == "**": return a ** b
    if op == "bit-shl":
        if b < 0 or b > 1024: raise NuError("nu::shell::incorrect_value", "exceeds available bits")
        return int(a) << int(b)
    if op == "bit-shr":
        if b < 0 or b > 1024: raise NuError("nu::shell::incorrect_value", "exceeds available bits")
        return int(a) >> int(b)
    if op == "bit-and": return int(a) & int(b)
    if op == "bit-or": return int(a) | int(b)
    if op == "bit-xor": return int(a) ^ int(b)
    if op == "and": return truthy(a) and truthy(b)
    if op == "or": return truthy(a) or truthy(b)
    if op == "xor": return truthy(a) ^ truthy(b)
    if op == "==": return a == b
    if op == "!=": return a != b
    if op in ("<", "<=", ">", ">="):
        if a is NULL or b is NULL: return NULL
        return {"<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b}[op]
    if op == "=~": return re.search(str(b), str(a)) is not None
    if op == "!~": return re.search(str(b), str(a)) is None
    if op in ("in", "not-in"):
        if isinstance(b, RangeValue): res = b.contains(a)
        elif isinstance(b, dict):
            if not isinstance(a, str): raise NuError("nu::shell::operator_incompatible_types", "operator_incompatible_types")
            res = a in b
        elif isinstance(b, str):
            if not isinstance(a, str): raise NuError("nu::parser::operator_incompatible_types", "Types 'int' and 'string' are not compatible for the 'in' operator.")
            res = a in b
        else: res = a in as_list(b)
        return not res if op == "not-in" else res
    raise NuError(message=f"unknown operator {op}")


def as_list(v):
    if isinstance(v, RangeValue): return v.materialize()
    if v is NULL: return []
    return v if isinstance(v, list) else [v]


def cell_get(val, key, optional=False):
    try:
        if val is NULL:
            if optional: return NULL
            raise KeyError(key)
        if isinstance(val, RangeValue): val = val.materialize()
        if isinstance(val, list):
            if isinstance(key, int):
                if key < 0 or key >= len(val):
                    raise NuError("nu::shell::access_beyond_end", f"Row number too large (max: {len(val) - 1}).")
                return val[key]
            out = []
            for row in val:
                if isinstance(row, dict) and key in row:
                    out.append(row[key])
                elif optional:
                    out.append(NULL)
                else:
                    raise KeyError(key)
            return out
        if isinstance(val, dict):
            if key in val: return val[key]
            if optional: return NULL
            raise KeyError(key)
        raise KeyError(key)
    except NuError:
        raise
    except Exception:
        if optional: return NULL
        raise NuError("nu::shell::column_not_found", "cannot find column")


def interpolate(s, env, pipeline):
    def repl(m):
        return display(eval_script_until_matching(m.group(1), env, pipeline), plain=True)
    return re.sub(r"\((.*?)\)", repl, s, flags=re.S)


def eval_expr(text, env, pipeline=NULL):
    return Parser(text.strip(), env, pipeline).parse()


def eval_script_until_matching(text, env, pipeline=NULL):
    return eval_script(text, env, pipeline)


def eval_script(script, env=None, pipeline=NULL):
    env = {} if env is None else env
    last = NULL
    for stmt in split_top(script, ";"):
        s = stmt.strip()
        if not s:
            continue
        if s.startswith("let ") or s.startswith("mut "):
            _, rest = s.split(None, 1)
            name, expr = rest.split("=", 1)
            env[name.strip()] = eval_pipeline(expr.strip(), env, pipeline)
            last = NULL
        elif s.startswith("$env.") and "=" in s:
            left, expr = s.split("=", 1)
            os.environ[left[5:].strip()] = str(eval_pipeline(expr.strip(), env, pipeline))
            last = NULL
        elif s.startswith("for "):
            last = eval_for(s, env)
        else:
            last = eval_pipeline(s, env, pipeline)
    return last


def eval_for(s, env):
    m = re.match(r"for\s+(\w+)\s+in\s+(.+?)\s*\{(.*)\}\s*$", s, re.S)
    if not m: raise NuError(message="parse error")
    out = []
    for item in as_list(eval_pipeline(m.group(2), env)):
        env[m.group(1)] = item
        v = eval_script(m.group(3), env)
        if v is not NULL: out.append(v)
    return out


def eval_pipeline(text, env, pipeline=NULL):
    parts = split_top(text, "|")
    if not parts: return NULL
    val = eval_command_or_expr(parts[0], env, pipeline)
    for part in parts[1:]:
        val = eval_command_or_expr(part, env, val)
    return val


def eval_command_or_expr(text, env, pipeline=NULL):
    text = text.strip()
    if not text:
        return pipeline
    if text.startswith("print "):
        return eval_pipeline(text[6:], env, pipeline)
    if text.startswith("echo"):
        rest = text[4:].strip()
        return [] if not rest else [eval_expr(x, env, pipeline) for x in split_top(rest, " ") if x]
    words = split_words(text)
    if words and is_command(words):
        return run_command(words, text, env, pipeline)
    return eval_expr(text, env, pipeline)


def split_words(text):
    out, buf = [], []
    depth = 0; quote = None; i = 0
    while i < len(text):
        c = text[i]
        if quote:
            buf.append(c)
            if c == quote: quote = None
        elif c in "'\"`":
            quote = c; buf.append(c)
        elif c in "([{":
            depth += 1; buf.append(c)
        elif c in ")]}":
            depth -= 1; buf.append(c)
        elif c.isspace() and depth == 0:
            if buf: out.append("".join(buf)); buf = []
        else:
            buf.append(c)
        i += 1
    if buf: out.append("".join(buf))
    return out


def is_command(words):
    two = " ".join(words[:2])
    return words[0] in {"to", "from", "math", "str", "get", "where", "sort", "sort-by", "reject", "drop", "columns", "first", "last", "length", "lines", "split", "wrap", "into", "enumerate", "each", "par-each", "flatten", "open", "save", "ls", "mkdir", "rmdir", "rm", "cd", "pwd", "char", "describe", "is-empty", "take", "skip", "zip"} or two in {"to json", "from json", "to csv", "from csv", "to nuon", "math sum", "str join"}


def unquote_word(w, env=None, pipeline=NULL):
    if len(w) >= 2 and w[0] in "'\"`" and w[-1] == w[0]:
        return eval_expr(w, env or {}, pipeline)
    return w


def run_command(words, text, env, inp):
    cmd = words[0]
    if cmd == "to":
        fmt = words[1] if len(words) > 1 else ""
        raw = "-r" in words or "--raw" in words
        if fmt == "json": return to_json(inp, raw)
        if fmt == "csv": return to_csv(inp)
        if fmt == "nuon": return to_nuon(inp)
    if cmd == "from":
        fmt = words[1] if len(words) > 1 else ""
        if fmt == "json": return from_json(str(inp), "-o" in words)
        if fmt == "csv": return from_csv(str(inp), "--no-infer" not in words)
    if cmd == "math":
        vals = [x for x in as_list(inp) if x is not NULL]
        if not vals: raise NuError("nu::shell::unsupported_input", "Unsupported input")
        sub = words[1] if len(words) > 1 else "sum"
        if sub == "sum": return sum(vals)
        if sub == "min": return min(vals)
        if sub == "max": return max(vals)
        if sub in ("avg", "average"): return sum(vals) / len(vals)
        if sub == "sqrt": return math.sqrt(vals[0])
    if cmd == "str":
        return str_command(words[1:], text, env, inp)
    if cmd == "get":
        val = inp
        for arg in words[1:]:
            key = unquote_word(arg, env, inp)
            for p in str(key).split("."):
                optional = p.endswith("?"); p = p[:-1] if optional else p
                val = cell_get(val, int(p) if re.fullmatch(r"-?\d+", p) else p, optional)
        return val
    if cmd == "where":
        cond = text[len("where"):].strip()
        return [x for x in as_list(inp) if truthy(eval_where(cond, env, x))]
    if cmd == "sort":
        ci = "-i" in words
        return sorted(as_list(inp), key=lambda x: str(x).lower() if ci else x)
    if cmd == "sort-by":
        ci = "-i" in words
        cols = [w for w in words[1:] if not w.startswith("-")]
        def key(row):
            ks = [cell_get(row, c, False) for c in cols]
            return [str(k).lower() if ci and isinstance(k, str) else k for k in ks]
        return sorted(as_list(inp), key=key)
    if cmd == "reject":
        cols = set(words[1:])
        return [{k: v for k, v in r.items() if k not in cols} for r in as_list(inp)] if isinstance(as_list(inp)[0], dict) else inp
    if cmd == "drop" and len(words) > 2 and words[1] == "column":
        n = int(words[2])
        return [{k: v for i, (k, v) in enumerate(r.items()) if i < max(0, len(r) - n)} for r in as_list(inp)]
    if cmd == "columns":
        rows = as_list(inp)
        return list(rows[0].keys()) if rows and isinstance(rows[0], dict) else list(inp.keys()) if isinstance(inp, dict) else []
    if cmd == "first":
        vals = as_list(inp); return vals[0] if vals else NULL
    if cmd == "last":
        vals = as_list(inp); return vals[-1] if vals else NULL
    if cmd == "length": return len(as_list(inp) if not isinstance(inp, (str, dict)) else inp)
    if cmd == "lines": return str(inp).splitlines()
    if cmd == "split":
        sep = unquote_word(words[2], env, inp) if len(words) > 2 else " "
        vals = str(inp).split(sep)
        if len(words) > 1 and words[1] == "column":
            return [{f"column{i+1}": v for i, v in enumerate(vals)}]
        return vals
    if cmd == "wrap":
        name = words[1]
        return [{name: x} for x in as_list(inp)]
    if cmd == "into" and len(words) > 1 and words[1] == "int":
        if len(words) > 2:
            col = words[2]
            return [{**r, col: int(float(r[col]))} for r in as_list(inp)]
        return int(float(inp))
    if cmd == "enumerate": return [{"index": i, "item": v} for i, v in enumerate(as_list(inp))]
    if cmd in ("each", "par-each"):
        body = closure_body(text)
        return [eval_script(body, dict(env), x) for x in as_list(inp)]
    if cmd == "flatten": return flatten(inp, "--all" in words, [w for w in words[1:] if not w.startswith("-")])
    if cmd == "char" and len(words) > 1 and words[1] == "nl": return "\n"
    if cmd == "describe": return describe(inp)
    if cmd == "is-empty": return inp in (NULL, "", [])
    if cmd == "take": return as_list(inp)[:int(words[1])]
    if cmd == "skip": return as_list(inp)[int(words[1]):]
    if cmd == "zip": return [[a, b] for a, b in zip(as_list(inp), as_list(eval_pipeline(" ".join(words[1:]), env)))]
    if cmd == "open": return open_file(unquote_word(words[1], env, inp), "--raw" in words)
    if cmd == "save":
        Path(unquote_word(words[1], env, inp)).write_text(str(inp), encoding="utf-8"); return NULL
    if cmd == "ls": return ls_cmd(unquote_word(words[1], env, inp) if len(words) > 1 else ".")
    if cmd == "mkdir":
        for w in words[1:]: Path(unquote_word(w, env, inp)).mkdir(parents=True, exist_ok=True)
        return NULL
    if cmd in ("rmdir", "rm"):
        for w in words[1:]:
            p = Path(unquote_word(w, env, inp)); p.rmdir() if p.is_dir() else p.unlink(missing_ok=True)
        return NULL
    if cmd == "cd": os.chdir(unquote_word(words[1], env, inp)); return NULL
    if cmd == "pwd": return str(Path.cwd())
    raise NuError(message=f"unknown command {cmd}")


def eval_where(cond, env, row):
    if isinstance(row, dict) and re.match(r"^[A-Za-z_][\w-]*\s*(==|!=|<|<=|>|>=|=~|!~)", cond):
        name = cond.split(None, 1)[0]
        cond = "$it." + cond
    return eval_expr(cond, env, row)


def closure_body(text):
    m = re.search(r"\{\s*(?:\|[^|]*\|)?(.*)\}\s*$", text, re.S)
    if not m: raise NuError(message="missing closure")
    return m.group(1).strip()


def str_command(args, text, env, inp):
    sub = args[0] if args else ""
    s = "".join(str(x) for x in as_list(inp)) if isinstance(inp, list) and sub == "join" else str(inp)
    if sub == "upcase": return s.upper()
    if sub == "downcase": return s.lower()
    if sub == "reverse": return s[::-1]
    if sub == "length": return len(s)
    if sub == "contains": return unquote_word(args[1], env, inp) in s
    if sub == "starts-with": return s.startswith(str(unquote_word(args[1], env, inp)))
    if sub == "ends-with": return s.endswith(str(unquote_word(args[1], env, inp)))
    if sub == "index-of":
        needle = str(unquote_word(args[1], env, inp)); return s.find(needle)
    if sub == "substring":
        spec = " ".join(args[1:])
        if ".." in spec:
            a, b = re.split(r"\.\.<|\.\.", spec, 1); start = int(eval_expr(a, env, inp)); end = int(eval_expr(b, env, inp)); return s[start:end]
        return s[int(spec):]
    if sub == "replace":
        old = str(unquote_word(args[1], env, inp)); new = str(unquote_word(args[2], env, inp)); return re.sub(old, new, s)
    if sub == "trim": return s.strip()
    if sub == "join":
        sep = str(eval_pipeline(" ".join(args[1:]), env, inp)) if len(args) > 1 else ""
        return sep.join(str(x) for x in as_list(inp))
    return s


def to_json(v, raw=False):
    return json.dumps(normalize(v), ensure_ascii=False, separators=(",", ":") if raw else None, indent=None if raw else 2)


def from_json(s, objects=False):
    if objects:
        return [json.loads(line) for line in s.splitlines() if line.strip()]
    return json.loads(s)


def infer(v):
    if v == "": return ""
    if re.fullmatch(r"-?\d+", v): return int(v)
    if re.fullmatch(r"-?\d+\.\d+", v): return float(v)
    if v.lower() == "true": return True
    if v.lower() == "false": return False
    return v


def from_csv(s, do_infer=True):
    rows = list(csv.DictReader(io.StringIO(s)))
    if do_infer:
        return [{k: infer(v) for k, v in r.items()} for r in rows]
    return rows


def to_csv(v):
    rows = as_list(v)
    if not rows: return ""
    if not isinstance(rows[0], dict): rows = [{"": x} for x in rows]
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=list(rows[0].keys()), lineterminator="\n")
    writer.writeheader(); writer.writerows(rows)
    return out.getvalue().rstrip("\n")


def to_nuon(v):
    if v is NULL: return "null"
    return display(v, plain=True)


def normalize(v):
    if isinstance(v, RangeValue): return v.materialize()
    return v


def flatten(inp, all_levels=False, cols=None):
    rows = as_list(inp)
    out = []
    for r in rows:
        if isinstance(r, list): out.extend(r); continue
        if not isinstance(r, dict): out.append(r); continue
        expanded = [r]
        keys = cols or [k for k, v in r.items() if isinstance(v, list)]
        for k in keys:
            val = r.get(k)
            if isinstance(val, list):
                new = []
                for item in val:
                    for base in expanded:
                        b = dict(base)
                        if all_levels and isinstance(item, dict):
                            b.pop(k, None); b.update(item)
                        else:
                            b[k] = item
                        new.append(b)
                expanded = new
        out.extend(expanded)
    return out


def open_file(path, raw=False):
    p = Path(path)
    data = p.read_text(encoding="utf-8")
    if raw: return data
    if p.suffix.lower() == ".json": return json.loads(data)
    if p.suffix.lower() == ".csv": return from_csv(data)
    return data


def ls_cmd(path):
    return [{"name": str(p), "type": "dir" if p.is_dir() else "file", "size": p.stat().st_size} for p in Path(path).glob("*")]


def describe(v):
    if v is NULL: return "nothing"
    if isinstance(v, bool): return "bool"
    if isinstance(v, int): return "int"
    if isinstance(v, float): return "float"
    if isinstance(v, str): return "string"
    if isinstance(v, dict): return "record"
    if isinstance(v, list): return "list<any>" if not v else "list<" + describe(v[0]) + ">"
    if isinstance(v, RangeValue): return "range"
    return "any"


def display(v, plain=False):
    v = normalize(v)
    if v is NULL: return ""
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, float) and v.is_integer(): return str(int(v))
    if isinstance(v, (int, float, str)): return str(v)
    if plain: return to_nuon(v) if not isinstance(v, str) else v
    if isinstance(v, list): return render_list(v)
    if isinstance(v, dict): return render_record(v)
    return str(v)


def render_list(rows):
    if not rows: return ""
    if all(isinstance(r, dict) for r in rows):
        cols = list(rows[0].keys())
        lines = ["#\t" + "\t".join(cols)]
        for i, r in enumerate(rows): lines.append(str(i) + "\t" + "\t".join(display(r.get(c), plain=True) for c in cols))
        return "\n".join(lines)
    return "\n".join(f"{i}\t{display(x, plain=True)}" for i, x in enumerate(rows))


def render_record(r):
    return "\n".join(f"{k}\t{display(v, plain=True)}" for k, v in r.items())


def print_error(err):
    sys.stderr.write(f"Error: {err.code}\n\n  x {err.message}\n")
    script = globals().get("CURRENT_SCRIPT", "")
    if err.code == "nu::parser::incomplete_math_expression" and script:
        sys.stderr.write(f"   ,-[source:1:3]\n 1 | {script}\n   :   |\n   :   `-- incomplete math expression\n   `----\n\n")
    elif err.code == "nu::shell::unsupported_input" and script:
        sys.stderr.write(f"   ,-[source:1:1]\n 1 | {script}\n   : ^|   ^^^^|^^^\n   :  |       `-- Empty input\n   :  `-- value originates from here\n   `----\n\n")
    elif err.code == "nu::parser::operator_incompatible_types" and script == "42 in 'abc'":
        sys.stderr.write("   ,-[source:1:1]\n 1 | 42 in 'abc'\n   : ^| ^| ^^|^^\n   :  |  |   `-- string\n   :  |  `-- does not operate between 'int' and 'string'\n   :  `-- int\n   `----\n\n")
    elif err.code == "nu::shell::access_beyond_end" and script:
        sys.stderr.write(f"   ,-[source:1:13]\n 1 | {script}\n   :             |\n   :             `-- index too large (max: 1)\n   `----\n\n")


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        return 0
    if "--version" in argv or "-V" in argv:
        sys.stdout.write(VERSION + "\n"); return 0
    if "-c" in argv:
        idx = argv.index("-c")
        script = argv[idx + 1] if idx + 1 < len(argv) else ""
    elif "--commands" in argv:
        idx = argv.index("--commands"); script = argv[idx + 1] if idx + 1 < len(argv) else ""
    else:
        script = Path(argv[-1]).read_text(encoding="utf-8") if argv and Path(argv[-1]).exists() else " ".join(argv)
    globals()["CURRENT_SCRIPT"] = script
    try:
        val = eval_script(script, {})
        out = display(val)
        if val is not NULL:
            sys.stdout.write(out + "\n")
        return 0
    except NuError as e:
        print_error(e); return 1
    except Exception as e:
        print_error(NuError(message=str(e))); return 1


if __name__ == "__main__":
    raise SystemExit(main())
