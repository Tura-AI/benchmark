#!/usr/bin/env python3
"""A focused, dependency-free Python port of Nushell's non-interactive core.

This implements the expression and command surface exercised by this benchmark:
values, records/tables, pipelines, JSON/CSV, strings, math and small filesystem
operations.  It intentionally does not invoke or depend on Nushell.
"""

from __future__ import annotations

import csv
import glob
import json
import math
import ntpath
import os
import re
import shutil
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class NuError(Exception):
    pass


@dataclass
class RawOutput:
    data: bytes


class EnumeratedList(list):
    """Marks `enumerate` output so the table renderer uses its index column."""


@dataclass
class RangeValue:
    start: int | float | None
    end: int | float | None
    exclusive: bool = False

    def values(self, limit: int = 100000) -> list[Any]:
        start = 0 if self.start is None else self.start
        if self.end is None:
            end = start + limit - 1
        else:
            end = self.end
        step = 1 if end >= start else -1
        if isinstance(start, int) and isinstance(end, int):
            stop = end if self.exclusive else end + step
            return list(range(start, stop, step))[:limit]
        out = []
        cur = float(start)
        compare = (lambda x: x < end) if step > 0 and self.exclusive else \
                  (lambda x: x <= end) if step > 0 else \
                  (lambda x: x > end) if self.exclusive else (lambda x: x >= end)
        while compare(cur) and len(out) < limit:
            out.append(cur)
            cur += step
        return out


@dataclass
class Token:
    kind: str
    value: Any
    start: int
    end: int


_MULTI_OPS = ["not-in", "bit-shr", "bit-shl", "bit-xor", "bit-and", "bit-or",
              "..<", "...", "..", "==", "!=", "<=", ">=", "=~", "!~", "++", "**", "//"]


def decode_double(s: str) -> str:
    out, i = [], 0
    escapes = {"n": "\n", "r": "\r", "t": "\t", "0": "\0", '"': '"', "'": "'", "\\": "\\"}
    while i < len(s):
        if s[i] != "\\" or i + 1 >= len(s):
            out.append(s[i]); i += 1; continue
        c = s[i + 1]
        if c == "u" and i + 2 < len(s) and s[i + 2] == "{":
            j = s.find("}", i + 3)
            if j >= 0:
                try: out.append(chr(int(s[i + 3:j], 16)))
                except ValueError: out.append(s[i:j + 1])
                i = j + 1; continue
        out.append(escapes.get(c, c)); i += 2
    return "".join(out)


def lex(text: str) -> list[Token]:
    tokens: list[Token] = []
    i, n = 0, len(text)
    punct = "[]{}(),;:.|"
    while i < n:
        c = text[i]
        if c.isspace(): i += 1; continue
        if c == "#":
            while i < n and text[i] not in "\r\n": i += 1
            continue
        if c in "'\"":
            quote, st = c, i
            i += 1; buf = []
            while i < n:
                if text[i] == quote:
                    i += 1; break
                if quote == '"' and text[i] == "\\" and i + 1 < n:
                    buf.append(text[i]); buf.append(text[i + 1]); i += 2
                else: buf.append(text[i]); i += 1
            val = "".join(buf) if quote == "'" else decode_double("".join(buf))
            tokens.append(Token("STR", val, st, i)); continue
        if c == "$":
            st = i; i += 1
            if i < n and text[i] == '"':
                i += 1; buf = []
                while i < n and text[i] != '"':
                    buf.append(text[i]); i += 1
                if i < n: i += 1
                tokens.append(Token("INTERP", decode_double("".join(buf)), st, i)); continue
            j = i
            while i < n and (text[i].isalnum() or text[i] in "_-?"): i += 1
            tokens.append(Token("VAR", text[j:i], st, i)); continue
        matched = False
        for op in _MULTI_OPS:
            if text.startswith(op, i) and (not op[0].isalpha() or
                (i == 0 or not (text[i-1].isalnum() or text[i-1] in "_-"))):
                tokens.append(Token("OP", op, i, i + len(op))); i += len(op); matched = True; break
        if matched: continue
        if c in "+-*/%<>=":
            tokens.append(Token("OP", c, i, i + 1)); i += 1; continue
        if c in punct:
            tokens.append(Token(c, c, i, i + 1)); i += 1; continue
        if c.isdigit() or (c == "." and i + 1 < n and text[i + 1].isdigit()):
            st = i
            if text.startswith(("0x", "0X"), i):
                i += 2
                while i < n and (text[i].isdigit() or text[i].lower() in "abcdef_"): i += 1
                tokens.append(Token("NUM", int(text[st:i].replace("_", ""), 16), st, i)); continue
            while i < n and (text[i].isdigit() or text[i] == "_"): i += 1
            is_float = False
            if i < n and text[i] == "." and not text.startswith("..", i):
                is_float = True; i += 1
                while i < n and (text[i].isdigit() or text[i] == "_"): i += 1
            if i < n and text[i] in "eE":
                is_float = True; i += 1
                if i < n and text[i] in "+-": i += 1
                while i < n and text[i].isdigit(): i += 1
            raw = text[st:i].replace("_", "")
            tokens.append(Token("NUM", float(raw) if is_float else int(raw), st, i)); continue
        st = i
        while i < n and not text[i].isspace() and text[i] not in punct + "+*/%<>=":
            if text.startswith("..", i) or text.startswith("++", i) or text.startswith("**", i): break
            i += 1
        if i == st: i += 1
        raw = text[st:i]
        kind = "OP" if raw in {"and", "or", "xor", "not", "in", "not-in", "mod",
                                   "bit-shr", "bit-shl", "bit-xor", "bit-and", "bit-or"} else "ID"
        tokens.append(Token(kind, raw, st, i))
    tokens.append(Token("EOF", None, n, n))
    return tokens


def split_top(text: str, delim: str) -> list[str]:
    out, start, stack, quote, i = [], 0, [], None, 0
    pairs = {")": "(", "]": "[", "}": "{"}
    while i < len(text):
        c = text[i]
        if quote:
            if quote == '"' and c == "\\": i += 2; continue
            if c == quote: quote = None
            i += 1; continue
        if c in "'\"": quote = c; i += 1; continue
        if c in "([{": stack.append(c)
        elif c in ")]}":
            if stack and stack[-1] == pairs[c]: stack.pop()
        elif c == delim and not stack:
            out.append(text[start:i].strip()); start = i + 1
        i += 1
    out.append(text[start:].strip())
    return [x for x in out if x]


def split_args(text: str) -> list[str]:
    out, start, stack, quote, i = [], None, [], None, 0
    pairs = {")": "(", "]": "[", "}": "{"}
    while i < len(text):
        c = text[i]
        if quote:
            if quote == '"' and c == "\\": i += 2; continue
            if c == quote: quote = None
            i += 1; continue
        if c in "'\"":
            if start is None: start = i
            quote = c; i += 1; continue
        if c in "([{":
            if start is None: start = i
            stack.append(c)
        elif c in ")]}":
            if stack and stack[-1] == pairs[c]: stack.pop()
        elif (c.isspace() or c == ",") and not stack:
            if start is not None: out.append(text[start:i]); start = None
            i += 1; continue
        elif start is None: start = i
        i += 1
    if start is not None: out.append(text[start:])
    return out


def materialize(v: Any, limit: int = 100000) -> Any:
    return v.values(limit) if isinstance(v, RangeValue) else v


class ExprParser:
    PRECEDENCE = {
        "or": 1, "xor": 2, "and": 3,
        "==": 4, "!=": 4, "<": 4, "<=": 4, ">": 4, ">=": 4,
        "=~": 4, "!~": 4, "in": 4, "not-in": 4,
        "bit-or": 5, "bit-xor": 5, "bit-and": 6,
        "bit-shl": 7, "bit-shr": 7, "++": 8, "+": 8, "-": 8,
        "*": 9, "/": 9, "//": 9, "%": 9, "mod": 9, "**": 10,
        "..": 0, "..<": 0,
    }

    def __init__(self, engine: "Engine", text: str, env: dict[str, Any]):
        self.engine, self.text, self.env = engine, text, env
        self.tokens, self.i, self.list_depth = lex(text), 0, 0

    def cur(self) -> Token: return self.tokens[self.i]
    def take(self) -> Token:
        t = self.tokens[self.i]; self.i += 1; return t
    def accept(self, value: str) -> bool:
        if self.cur().value == value or self.cur().kind == value:
            self.i += 1; return True
        return False

    def parse(self, min_prec: int = 0) -> Any:
        left = self.unary()
        while True:
            t = self.cur(); op = t.value
            if t.kind != "OP" or op not in self.PRECEDENCE or self.PRECEDENCE[op] < min_prec: break
            if (self.list_depth and op in ("-", "+") and self.i > 0 and self.i + 1 < len(self.tokens)
                    and t.start > self.tokens[self.i - 1].end and self.tokens[self.i + 1].start == t.end):
                break
            prec = self.PRECEDENCE[op]; self.take()
            right = self.parse(prec if op == "**" else prec + 1)
            left = self.binary(op, left, right)
        return left

    def unary(self) -> Any:
        if self.cur().value in ("-", "+", "not"):
            op = self.take().value; v = self.unary()
            return -v if op == "-" else (+v if op == "+" else not bool(v))
        return self.postfix(self.primary())

    def primary(self) -> Any:
        t = self.take()
        if t.kind in ("NUM", "STR"): return t.value
        if t.kind == "INTERP":
            return re.sub(r"\((.*?)\)", lambda m: scalar_text(self.engine.eval_script(m.group(1), dict(self.env))), t.value)
        if t.kind == "VAR": return self.env.get(t.value)
        if t.value == "null": return None
        if t.value == "true": return True
        if t.value == "false": return False
        if t.value in ("inf", "+inf"): return float("inf")
        if t.value == "-inf": return float("-inf")
        if t.kind == "ID":
            row = self.env.get("_row")
            if isinstance(row, dict) and t.value in row: return row[t.value]
            if t.value == "$it": return self.env.get("it")
            return t.value
        if t.value == "(":
            depth, j = 1, self.i
            while j < len(self.tokens):
                if self.tokens[j].value == "(": depth += 1
                elif self.tokens[j].value == ")":
                    depth -= 1
                    if depth == 0: break
                j += 1
            inner_start = t.end; inner_end = self.tokens[j].start
            self.i = j + 1
            return self.engine.eval_script(self.text[inner_start:inner_end], dict(self.env))
        if t.value == "[": return self.parse_list()
        if t.value == "{": return self.parse_record()
        if t.value in ("..", "..<"):
            end = self.parse(1)
            return RangeValue(None, end, t.value == "..<")
        raise NuError(f"unexpected token {t.value!r}")

    def parse_list(self) -> Any:
        vals, table_sep = [], False
        self.list_depth += 1
        try:
            while self.cur().value != "]" and self.cur().kind != "EOF":
                if self.accept(","): continue
                if self.accept(";"): table_sep = True; continue
                vals.append(self.parse(0))
            self.accept("]")
        finally:
            self.list_depth -= 1
        if table_sep and vals and isinstance(vals[0], list):
            headers = [str(x) for x in vals[0]]
            rows = []
            for row in vals[1:]:
                row = row if isinstance(row, list) else [row]
                rows.append({h: row[k] if k < len(row) else None for k, h in enumerate(headers)})
            return rows
        return vals

    def parse_record(self) -> dict[str, Any]:
        d: dict[str, Any] = {}
        while self.cur().value != "}" and self.cur().kind != "EOF":
            if self.accept(","): continue
            key = self.take()
            k = str(key.value)
            if not self.accept(":"): raise NuError("missing colon in record")
            d[k] = self.parse(0)
        self.accept("}")
        return d

    def postfix(self, value: Any) -> Any:
        while self.accept("."):
            t = self.take(); key = t.value
            value = get_path(value, [key], optional=str(key).endswith("?"))
        return value

    @staticmethod
    def binary(op: str, a: Any, b: Any) -> Any:
        if op in ("..", "..<"): return RangeValue(a, b, op == "..<")
        a, b = materialize(a), materialize(b)
        if op == "+": return a + b
        if op == "-": return a - b
        if op == "*": return a * b
        if op == "/":
            if b == 0: raise NuError("Division by zero.")
            return a / b
        if op in ("//",): return a // b
        if op in ("%", "mod"): return a % b
        if op == "**": return a ** b
        if op == "++": return a + b
        if op == "==": return a == b
        if op == "!=": return a != b
        if op in ("<", "<=", ">", ">="):
            if a is None or b is None: return None
            return {"<": lambda: a < b, "<=": lambda: a <= b, ">": lambda: a > b, ">=": lambda: a >= b}[op]()
        if op == "and": return bool(a) and bool(b)
        if op == "or": return bool(a) or bool(b)
        if op == "xor": return bool(a) ^ bool(b)
        if op == "in": return a in b
        if op == "not-in": return a not in b
        if op == "=~": return re.search(str(b), str(a)) is not None
        if op == "!~": return re.search(str(b), str(a)) is None
        if op == "bit-and": return int(a) & int(b)
        if op == "bit-or": return int(a) | int(b)
        if op == "bit-xor": return int(a) ^ int(b)
        if op == "bit-shl": return int(a) << int(b)
        if op == "bit-shr": return int(a) >> int(b)
        raise NuError(f"unsupported operator {op}")


def get_path(value: Any, path: list[Any], optional: bool = False) -> Any:
    cur = materialize(value)
    for raw in path:
        key = str(raw)
        opt = key.endswith("?") or optional
        key = key[:-1] if key.endswith("?") else key
        try:
            if isinstance(cur, dict): cur = cur[key]
            elif isinstance(cur, list) and re.fullmatch(r"-?\d+", key): cur = cur[int(key)]
            elif isinstance(cur, list): cur = [x.get(key) if isinstance(x, dict) else None for x in cur]
            else: raise KeyError(key)
        except (KeyError, IndexError, TypeError):
            if opt: return None
            raise NuError(f"cannot find column or path {key!r}")
    return cur


def infer_csv(s: str) -> Any:
    s = s.strip()
    if s == "": return ""
    if re.fullmatch(r"[-+]?\d+", s):
        try: return int(s)
        except ValueError: pass
    if re.fullmatch(r"[-+]?(?:\d+\.\d*|\d*\.\d+)(?:[eE][-+]?\d+)?", s):
        try: return float(s)
        except ValueError: pass
    return s


def jsonable(v: Any) -> Any:
    v = materialize(v)
    if isinstance(v, RawOutput): return v.data.decode("utf-8", "replace")
    if isinstance(v, dict): return {str(k): jsonable(x) for k, x in v.items()}
    if isinstance(v, list): return [jsonable(x) for x in v]
    return v


def scalar_text(v: Any) -> str:
    if v is None: return ""
    if v is True: return "true"
    if v is False: return "false"
    if isinstance(v, float):
        if math.isnan(v): return "NaN"
        if math.isinf(v): return "inf" if v > 0 else "-inf"
        return str(v)
    return str(v)


def nuon(v: Any) -> str:
    v = materialize(v)
    if v is None: return "null"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return scalar_text(v)
    if isinstance(v, str):
        if v == "" or re.search(r"[\s,;:\[\]{}'\"]", v) or v in ("true", "false", "null"):
            return "'" + v.replace("'", "''") + "'"
        return v
    if isinstance(v, list): return "[" + ", ".join(nuon(x) for x in v) + "]"
    if isinstance(v, dict): return "{" + ", ".join(f"{nuon(str(k))}: {nuon(x)}" for k, x in v.items()) + "}"
    return str(v)


def display_width(s: str) -> int:
    # The benchmark's expected examples are predominantly ASCII.  Treat common
    # wide CJK characters as two cells without pulling in a Unicode dependency.
    return sum(2 if ord(c) >= 0x1100 and not (0xE000 <= ord(c) <= 0xF8FF) else 1 for c in s)


def pad(s: str, width: int, right: bool = False) -> str:
    n = max(0, width - display_width(s))
    return (" " * n + s) if right else (s + " " * n)


def cell_text(v: Any) -> str:
    if isinstance(v, list): return "[list " + str(len(v)) + " items]"
    if isinstance(v, dict): return "{record " + str(len(v)) + " fields}"
    if isinstance(v, float) and math.isfinite(v): return f"{v:.2f}"
    return scalar_text(v)


def rounded_grid(rows: list[list[Any]], headers: list[str] | None = None, numeric_right: bool = False) -> str:
    if headers is not None:
        all_rows = [headers] + rows
    else: all_rows = rows
    if not all_rows: return "╭────────────╮\n│ empty list │\n╰────────────╯\n"
    ncols = max(len(r) for r in all_rows)
    texts = [[cell_text(r[i]) if i < len(r) else "" for i in range(ncols)] for r in all_rows]
    widths = [max(display_width(r[i]) for r in texts) + 2 for i in range(ncols)]
    top = "╭" + "┬".join("─" * w for w in widths) + "╮\n"
    bottom = "╰" + "┴".join("─" * w for w in widths) + "╯\n"
    lines = []
    for ri, row in enumerate(texts):
        vals = []
        for ci, s in enumerate(row):
            original = all_rows[ri][ci] if ci < len(all_rows[ri]) else ""
            right = (numeric_right or headers is not None) and (headers is None or ri > 0) \
                    and isinstance(original, (int, float)) and not isinstance(original, bool)
            if headers is not None and ri == 0:
                room = widths[ci] - 2 - display_width(s)
                formatted = " " * (room // 2) + s + " " * (room - room // 2)
            else:
                formatted = pad(s, widths[ci] - 2, right)
            vals.append(" " + formatted + " ")
        lines.append("│" + "│".join(vals) + "│\n")
        if headers is not None and ri == 0:
            lines.append("├" + "┼".join("─" * w for w in widths) + "┤\n")
    return top + "".join(lines) + bottom


def render(v: Any) -> bytes:
    if isinstance(v, RawOutput): return v.data
    v = materialize(v)
    if v is None: return b""
    if isinstance(v, dict):
        if not v: return "╭──────────────╮\n│ empty record │\n╰──────────────╯\n".encode("utf-8")
        return rounded_grid([[k, x] for k, x in v.items()]).encode("utf-8")
    if isinstance(v, list):
        if not v: return rounded_grid([]).encode("utf-8")
        if isinstance(v, EnumeratedList):
            rows = [[row.get("index"), row.get("item")] for row in v]
            return rounded_grid(rows, ["#", "item"]).encode("utf-8")
        if all(isinstance(x, dict) for x in v) and any(bool(x) for x in v):
            headers: list[str] = []
            for row in v:
                for k in row:
                    if k not in headers: headers.append(k)
            rows = [[i] + [row.get(k) for k in headers] for i, row in enumerate(v)]
            return rounded_grid(rows, ["#"] + headers).encode("utf-8")
        return rounded_grid([[i, x] for i, x in enumerate(v)], numeric_right=True).encode("utf-8")
    return (scalar_text(v) + "\n").encode("utf-8")


COMMANDS = sorted([
    "str starts-with", "str ends-with", "str contains", "str substring", "str replace",
    "str downcase", "str upcase", "str capitalize", "str trim", "str length",
    "str reverse", "str index-of", "str join",
    "math product", "math median", "math round", "math floor", "math ceil", "math sqrt",
    "math abs", "math sum", "math avg", "math min", "math max",
    "path starts-with", "path ends-with", "path basename", "path dirname", "path exists",
    "path expand", "path join", "path parse", "path split",
    "from json", "to json", "from csv", "to csv", "to nuon", "from nuon",
    "split row", "split column", "split chars", "sort-by", "group-by",
    "into string", "into int", "into float", "into bool",
    "is-empty", "is-not-empty", "detect columns",
    "echo", "print", "get", "select", "reject", "where", "filter", "each", "par-each",
    "first", "last", "take", "skip", "length", "sort", "reverse", "uniq", "enumerate",
    "flatten", "columns", "values", "wrap", "transpose", "append", "prepend",
    "update", "upsert", "insert", "merge", "default", "compact", "describe",
    "open", "save", "ls", "pwd", "cd", "mkdir", "touch", "rm", "glob", "lines", "table",
], key=len, reverse=True)


class Engine:
    def __init__(self):
        self.env: dict[str, Any] = {"env": dict(os.environ)}
        self.env["env"]["PWD"] = os.getcwd()

    def eval_expression(self, text: str, env: dict[str, Any] | None = None) -> Any:
        text = text.strip()
        if not text: return None
        return ExprParser(self, text, self.env if env is None else env).parse()

    def eval_script(self, text: str, env: dict[str, Any] | None = None) -> Any:
        target = self.env if env is None else env
        result = None
        for stmt in split_top(text, ";"):
            m = re.match(r"^(?:let|mut|const)\s+([\w-]+)\s*=\s*(.*)$", stmt, re.S)
            if m:
                target[m.group(1)] = self.eval_pipeline(m.group(2), target); result = None; continue
            m = re.match(r"^\$([\w-]+)\s*=\s*(.*)$", stmt, re.S)
            if m:
                target[m.group(1)] = self.eval_pipeline(m.group(2), target); result = None; continue
            result = self.eval_pipeline(stmt, target)
        return result

    def eval_pipeline(self, text: str, env: dict[str, Any]) -> Any:
        value: Any = None
        for i, seg in enumerate(split_top(text, "|")):
            value = self.eval_segment(seg, value, env, i == 0)
        return value

    def eval_segment(self, seg: str, inp: Any, env: dict[str, Any], first: bool) -> Any:
        seg = seg.strip()
        for cmd in COMMANDS:
            if seg == cmd or seg.startswith(cmd + " "):
                return self.run_command(cmd, seg[len(cmd):].strip(), inp, env)
        local = dict(env)
        if not first or "in" not in local:
            local["in"] = inp
        return self.eval_expression(seg, local)

    def arg_value(self, s: str, env: dict[str, Any]) -> Any:
        s = s.strip()
        if not s: return None
        if s.startswith("-") and not re.match(r"-\d", s): return s
        # Bare paths and words are Nushell strings.  The expression parser also
        # handles ordinary bare words, while dots in a filesystem path are not
        # cell-path access in command position.
        looks_like_path = (s.startswith(".") or "/" in s or "\\" in s or
                           re.fullmatch(r"[^\s.]+\.[A-Za-z][A-Za-z0-9_-]*", s) is not None)
        if re.fullmatch(r"[^\s\[\]{}()'\"]+", s) and looks_like_path:
            if s.startswith("$"): return self.eval_expression(s, env)
            return s
        return self.eval_expression(s, env)

    def run_command(self, cmd: str, rest: str, inp: Any, env: dict[str, Any]) -> Any:
        args = split_args(rest)
        vals = lambda xs=args: [self.arg_value(x, env) for x in xs if not x.startswith("-")]
        inp = materialize(inp)

        if cmd == "echo":
            vs = vals(); return vs[0] if len(vs) == 1 else vs
        if cmd == "table": return inp
        if cmd == "print":
            vs = vals(); data = " ".join(scalar_text(x) for x in vs) if vs else scalar_text(inp)
            return RawOutput((data + ("" if "-n" in args else "\n")).encode())
        if cmd == "pwd": return os.getcwd()
        if cmd == "cd":
            p = str(vals()[0] if vals() else Path.home()); os.chdir(p); self.env["env"]["PWD"] = os.getcwd(); return None
        if cmd == "length": return len(inp)
        if cmd in ("first", "last", "take", "skip"):
            nvals = vals(); n = int(nvals[0]) if nvals else None
            seq = list(inp)
            if cmd == "first": return seq[0] if n is None else seq[:n]
            if cmd == "last": return seq[-1] if n is None else seq[-n:]
            if cmd == "take": return seq[:(1 if n is None else n)]
            return seq[(1 if n is None else n):]
        if cmd == "reverse": return list(reversed(inp)) if not isinstance(inp, str) else inp[::-1]
        if cmd == "sort": return sorted(inp, reverse=("-r" in args or "--reverse" in args))
        if cmd == "sort-by":
            keys = [str(x) for x in vals()]
            return sorted(inp, key=lambda r: tuple(get_path(r, [k]) for k in keys), reverse=("-r" in args or "--reverse" in args))
        if cmd == "uniq":
            out, seen = [], set()
            for x in inp:
                key = json.dumps(jsonable(x), sort_keys=True, default=str)
                if key not in seen: seen.add(key); out.append(x)
            return out
        if cmd == "enumerate": return EnumeratedList({"index": i, "item": x} for i, x in enumerate(inp))
        if cmd == "columns":
            if isinstance(inp, dict): return list(inp.keys())
            out = []
            for r in inp:
                if isinstance(r, dict):
                    for k in r:
                        if k not in out: out.append(k)
            return out
        if cmd == "values":
            if isinstance(inp, dict): return list(inp.values())
            if inp and all(isinstance(r, dict) for r in inp):
                keys = list(inp[0].keys())
                return [[r.get(k) for r in inp] for k in keys]
            return list(inp)
        if cmd == "flatten":
            out = []
            for x in inp:
                if isinstance(x, list): out.extend(x)
                elif isinstance(x, dict): out.append(x)
                else: out.append(x)
            return out
        if cmd == "compact": return [x for x in inp if x is not None]
        if cmd == "append": return list(inp) + vals()
        if cmd == "prepend": return vals() + list(inp)
        if cmd == "wrap":
            name = str(vals()[0] if vals() else "column0")
            return [{name: x} for x in inp] if isinstance(inp, list) else {name: inp}
        if cmd == "get":
            paths = [str(self.arg_value(x, env)) for x in args if not x.startswith("-")]
            if len(paths) > 1: return [{p: get_path(inp, p.split("."))} for p in paths]
            return get_path(inp, paths[0].split("."), optional="-i" in args or "--ignore-errors" in args)
        if cmd in ("select", "reject"):
            keys = [str(x) for x in vals()]
            def one(r):
                if not isinstance(r, dict): return r
                return ({k: r.get(k) for k in keys} if cmd == "select" else {k: v for k, v in r.items() if k not in keys})
            return [one(r) for r in inp] if isinstance(inp, list) else one(inp)
        if cmd in ("where", "filter"):
            pred = rest
            out = []
            for x in inp:
                local = dict(env); local["it"] = x; local["in"] = x; local["_row"] = x if isinstance(x, dict) else {"it": x}
                if pred.startswith("{") and pred.endswith("}"):
                    pred_names, pred_body = closure_parts(pred)
                    if pred_names: local[pred_names[0]] = x
                else: pred_body = pred
                if self.eval_script(pred_body, local): out.append(x)
            return out
        if cmd in ("each", "par-each"):
            names, body = closure_parts(rest)
            out = []
            for i, x in enumerate(inp if isinstance(inp, list) else [inp]):
                local = dict(env); local["in"] = x; local["it"] = x
                if names: local[names[0]] = x
                if len(names) > 1: local[names[1]] = i
                y = self.eval_script(body, local)
                out.append(y)
            return out
        if cmd in ("update", "upsert", "insert"):
            if len(args) < 2: return inp
            key, value = str(self.arg_value(args[0], env)), self.arg_value(" ".join(args[1:]), env)
            if isinstance(inp, dict): out = dict(inp); out[key] = value; return out
            return inp
        if cmd == "merge":
            other = vals()[0]; out = dict(inp); out.update(other); return out
        if cmd == "default":
            vs = vals(); default = vs[0]
            if len(vs) == 1: return default if inp is None else inp
            col = str(vs[1]); return [{**r, col: r.get(col, default)} for r in inp]

        if cmd.startswith("str "):
            if cmd == "str join":
                av = [self.arg_value(x, env) for x in args if not x.startswith("-")]
                return RawOutput((str(av[0]) if av else "").join(str(x) for x in inp).encode("utf-8"))
            return self.string_command(cmd[4:], args, inp, env)
        if cmd.startswith("math "):
            return self.math_command(cmd[5:], args, inp, env)
        if cmd == "lines": return str(inp).splitlines()
        if cmd == "split chars": return list(str(inp))
        if cmd == "split row":
            sep = str(vals()[0]) if vals() else None; return str(inp).split(sep)
        if cmd == "split column":
            vs = vals(); sep = str(vs[0]); names = [str(x) for x in vs[1:]]
            rows = [str(inp).split(sep)] if isinstance(inp, str) else [str(x).split(sep) for x in inp]
            n = max(len(x) for x in rows); names += [f"column{i+1}" for i in range(len(names), n)]
            return [{names[i]: row[i] if i < len(row) else None for i in range(n)} for row in rows]
        if cmd == "is-empty": return inp is None or len(inp) == 0
        if cmd == "is-not-empty": return not (inp is None or len(inp) == 0)

        if cmd == "from json":
            text = inp.data.decode() if isinstance(inp, RawOutput) else str(inp)
            if "-o" in args or "--objects" in args:
                return [json.loads(line) for line in text.splitlines() if line.strip()]
            if not ("-s" in args or "--strict" in args):
                text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
                text = re.sub(r",\s*([}\]])", r"\1", text)
            return json.loads(text)
        if cmd == "to json":
            raw = "-r" in args or "--raw" in args
            indent = None if raw else 2
            for i, a in enumerate(args):
                if a == "--indent" and i + 1 < len(args): indent = int(self.arg_value(args[i+1], env))
                if a == "--tabs" and i + 1 < len(args): indent = "\t" * int(self.arg_value(args[i+1], env))
            s = json.dumps(jsonable(inp), ensure_ascii=False, allow_nan=False, indent=indent,
                           separators=(",", ":") if raw else None)
            return RawOutput((s + "\n").encode("utf-8"))
        if cmd == "from csv": return self.from_csv(args, inp, env)
        if cmd == "to csv": return self.to_csv(args, inp, env)
        if cmd == "to nuon": return RawOutput((nuon(inp) + "\n").encode())
        if cmd.startswith("into "):
            typ = cmd[5:]
            def cv(x):
                if typ == "string": return scalar_text(x)
                if typ == "int": return int(float(x))
                if typ == "float": return float(x)
                if typ == "bool": return bool(x)
            return [cv(x) for x in inp] if isinstance(inp, list) else cv(inp)
        if cmd == "describe": return describe(inp)

        if cmd.startswith("path "): return self.path_command(cmd[5:], args, inp, env)
        if cmd == "open": return self.open_command(args, env)
        if cmd == "save": return self.save_command(args, inp, env)
        if cmd == "ls": return self.ls_command(args, env)
        if cmd == "glob":
            pattern = str(vals()[0]); return glob.glob(pattern, recursive=True)
        if cmd == "mkdir":
            for p in vals(): os.makedirs(str(p), exist_ok=True)
            return None
        if cmd == "touch":
            for p in vals(): Path(str(p)).touch()
            return None
        if cmd == "rm":
            recursive = "-r" in args or "--recursive" in args
            for p in vals():
                if os.path.isdir(str(p)) and recursive: shutil.rmtree(str(p))
                elif os.path.isdir(str(p)): os.rmdir(str(p))
                elif os.path.exists(str(p)): os.remove(str(p))
            return None
        raise NuError(f"unsupported command {cmd}")

    def string_command(self, sub: str, args: list[str], inp: Any, env: dict[str, Any]) -> Any:
        av = [self.arg_value(x, env) for x in args if not x.startswith("-")]
        def one(x):
            s = x.data.decode("utf-8", "replace") if isinstance(x, RawOutput) else str(x)
            if sub == "upcase": return s.upper()
            if sub == "downcase": return s.lower()
            if sub == "capitalize": return s.capitalize()
            if sub == "reverse": return s[::-1]
            if sub == "trim":
                chars = str(av[0]) if av else None
                if "-l" in args or "--left" in args: return s.lstrip(chars)
                if "-r" in args or "--right" in args: return s.rstrip(chars)
                return s.strip(chars)
            if sub == "length": return len(s.encode("utf-8")) if not ("-g" in args or "--grapheme-clusters" in args or "-c" in args) else len(s)
            if sub == "contains":
                needle = str(av[0])
                return needle.lower() in s.lower() if "-i" in args or "--ignore-case" in args else needle in s
            if sub == "starts-with":
                needle = str(av[0]); return s.lower().startswith(needle.lower()) if "-i" in args else s.startswith(needle)
            if sub == "ends-with":
                needle = str(av[0]); return s.lower().endswith(needle.lower()) if "-i" in args else s.endswith(needle)
            if sub == "index-of": return s.find(str(av[0]))
            if sub == "replace":
                if "-r" in args or "--regex" in args:
                    return re.sub(str(av[0]), str(av[1]), s, count=0 if "-a" in args or "--all" in args else 1)
                return s.replace(str(av[0]), str(av[1]), -1 if "-a" in args or "--all" in args else 1)
            if sub == "substring":
                r = av[0]
                if isinstance(r, RangeValue):
                    a = 0 if r.start is None else int(r.start); b = len(s)-1 if r.end is None else int(r.end)
                    return s[a:b if r.exclusive else b+1]
                return s[int(r):]
            return s
        return [one(x) for x in inp] if isinstance(inp, list) else one(inp)

    def math_command(self, sub: str, args: list[str], inp: Any, env: dict[str, Any]) -> Any:
        seq = materialize(inp)
        xs = seq if isinstance(seq, list) else [seq]
        if sub == "sum": return sum(xs)
        if sub == "avg": return sum(xs) / len(xs)
        if sub == "min": return min(xs)
        if sub == "max": return max(xs)
        if sub == "median": return statistics.median(xs)
        if sub == "product": return math.prod(xs)
        def one(x):
            if sub == "abs": return abs(x)
            if sub == "sqrt": return math.sqrt(x)
            if sub == "floor": return math.floor(x)
            if sub == "ceil": return math.ceil(x)
            if sub == "round":
                prec = None
                if "--precision" in args:
                    prec = int(self.arg_value(args[args.index("--precision") + 1], env))
                if prec is None:
                    return math.floor(x + 0.5) if x >= 0 else math.ceil(x - 0.5)
                factor = 10 ** prec
                return (math.floor(x * factor + 0.5) if x >= 0 else math.ceil(x * factor - 0.5)) / factor
        return [one(x) for x in seq] if isinstance(seq, list) else one(seq)

    def from_csv(self, args: list[str], inp: Any, env: dict[str, Any]) -> Any:
        text = inp.data.decode() if isinstance(inp, RawOutput) else str(inp)
        sep, quote = ",", '"'
        for flag, attr in (("--separator", "sep"), ("--quote", "quote")):
            if flag in args:
                val = str(self.arg_value(args[args.index(flag)+1], env))
                if flag == "--separator": sep = "\t" if val == "\\t" else val
                else: quote = val
        rows = list(csv.reader(text.splitlines(), delimiter=sep, quotechar=quote))
        if not rows: return []
        if "-n" in args or "--noheaders" in args:
            headers, data = [f"column{i}" for i in range(len(rows[0]))], rows
        else: headers, data = rows[0], rows[1:]
        return [{headers[i]: infer_csv(r[i]) if i < len(r) else None for i in range(len(headers))} for r in data]

    def to_csv(self, args: list[str], inp: Any, env: dict[str, Any]) -> RawOutput:
        rows = inp if isinstance(inp, list) else [inp]
        if rows and isinstance(rows[0], dict): headers = list(rows[0].keys()); data = [[r.get(h) for h in headers] for r in rows]
        else: headers, data = ["value"], [[x] for x in rows]
        import io
        f = io.StringIO(newline="")
        sep = ","
        if "--separator" in args:
            sep = str(self.arg_value(args[args.index("--separator") + 1], env))
        w = csv.writer(f, delimiter=sep, lineterminator="\n")
        if not ("-n" in args or "--noheaders" in args): w.writerow(headers)
        for row in data: w.writerow([scalar_text(x) for x in row])
        return RawOutput(f.getvalue().encode())

    def path_command(self, sub: str, args: list[str], inp: Any, env: dict[str, Any]) -> Any:
        av = [self.arg_value(x, env) for x in args if not x.startswith("-")]
        if sub == "join":
            parts = list(inp) if isinstance(inp, list) else ([inp] if inp is not None else [])
            parts += av; return ntpath.join(*(str(x) for x in parts))
        def one(x):
            s = str(x)
            if sub == "exists": return os.path.exists(s)
            if sub == "basename": return ntpath.basename(s.rstrip("/\\"))
            if sub == "dirname": return ntpath.dirname(s)
            if sub == "expand": return os.path.abspath(os.path.expanduser(s))
            if sub == "split": return list(Path(s).parts)
            if sub == "starts-with": return os.path.abspath(s).startswith(os.path.abspath(str(av[0])))
            if sub == "ends-with": return os.path.abspath(s).endswith(str(av[0]))
            if sub == "parse":
                d, b = ntpath.split(s); stem, ext = ntpath.splitext(b)
                return {"parent": d, "stem": stem, "extension": ext[1:]}
            return s
        return [one(x) for x in inp] if isinstance(inp, list) else one(inp)

    def open_command(self, args: list[str], env: dict[str, Any]) -> Any:
        av = [self.arg_value(x, env) for x in args if not x.startswith("-")]
        if not av: raise NuError("missing file name")
        p = str(av[-1]); data = Path(p).read_bytes()
        if "--raw" in args or "-r" in args: return RawOutput(data)
        ext = Path(p).suffix.lower()
        text = data.decode("utf-8-sig")
        if ext == ".json": return json.loads(text)
        if ext == ".csv": return self.from_csv([], text, env)
        return RawOutput(data)

    def save_command(self, args: list[str], inp: Any, env: dict[str, Any]) -> None:
        av = [self.arg_value(x, env) for x in args if not x.startswith("-")]
        if not av: raise NuError("missing file name")
        p = Path(str(av[-1])); append = "-a" in args or "--append" in args
        if p.exists() and not append and not ("-f" in args or "--force" in args): raise NuError("file already exists")
        if isinstance(inp, RawOutput): data = inp.data
        elif p.suffix.lower() == ".json": data = (json.dumps(jsonable(inp), ensure_ascii=False, indent=2) + "\n").encode()
        elif p.suffix.lower() == ".csv": data = self.to_csv([], inp, env).data
        else: data = scalar_text(inp).encode()
        with p.open("ab" if append else "wb") as f: f.write(data)
        return None

    def ls_command(self, args: list[str], env: dict[str, Any]) -> list[dict[str, Any]]:
        av = [self.arg_value(x, env) for x in args if not x.startswith("-")]
        pattern = str(av[0]) if av else "."
        if os.path.isdir(pattern): pattern = os.path.join(pattern, "*")
        paths = glob.glob(pattern)
        out = []
        for p in sorted(paths, key=lambda x: x.lower()):
            st = os.stat(p)
            out.append({"name": os.path.normpath(p), "type": "dir" if os.path.isdir(p) else "file",
                        "size": st.st_size, "modified": st.st_mtime})
        return out


def closure_parts(text: str) -> tuple[list[str], str]:
    s = text.strip()
    if s.startswith("{") and s.endswith("}"): s = s[1:-1].strip()
    names: list[str] = []
    if s.startswith("|"):
        j = s.find("|", 1)
        if j >= 0:
            names = [x.lstrip("$") for x in re.split(r"[\s,]+", s[1:j].strip()) if x]
            s = s[j+1:].strip()
    return names, s


def describe(v: Any) -> str:
    if v is None: return "nothing"
    if isinstance(v, bool): return "bool"
    if isinstance(v, int): return "int"
    if isinstance(v, float): return "float"
    if isinstance(v, str): return "string"
    if isinstance(v, RangeValue): return "range"
    if isinstance(v, dict): return "record<" + ", ".join(f"{k}: {describe(x)}" for k, x in v.items()) + ">"
    if isinstance(v, list):
        if not v: return "list<any>"
        return "table<" + ", ".join(f"{k}: {describe(x)}" for k, x in v[0].items()) + ">" if isinstance(v[0], dict) else f"list<{describe(v[0])}>"
    return type(v).__name__


def main(argv: list[str]) -> int:
    if "--version" in argv or "-v" in argv:
        sys.stdout.buffer.write(b"0.106.1\n"); return 0
    command = None
    for flag in ("-c", "--commands", "-e", "--execute"):
        if flag in argv and argv.index(flag) + 1 < len(argv): command = argv[argv.index(flag)+1]; break
    if command is None:
        # A tiny stdin/script fallback is useful for non-interactive harnesses.
        if argv and not argv[0].startswith("-"):
            try: command = Path(argv[0]).read_text(encoding="utf-8")
            except OSError: command = None
        elif not sys.stdin.isatty(): command = sys.stdin.read()
    if command is None: return 0
    try:
        result = Engine().eval_script(command)
        sys.stdout.buffer.write(render(result)); return 0
    except NuError as e:
        sys.stderr.buffer.write(f"Error: nu::shell::error\n\n  x {e}\n\n".encode()); return 1
    except (OSError, ValueError, TypeError, KeyError, IndexError, json.JSONDecodeError, csv.Error) as e:
        sys.stderr.buffer.write(f"Error: nu::shell::error\n\n  x {e}\n\n".encode()); return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
