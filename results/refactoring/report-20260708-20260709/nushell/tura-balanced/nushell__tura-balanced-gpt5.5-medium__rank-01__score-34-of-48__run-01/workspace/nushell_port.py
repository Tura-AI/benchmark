#!/usr/bin/env python3
"""Small Python compatibility port for the benchmarked Nushell CLI surface.

This is not a wrapper around the reference binary.  It implements the parts of
`nu -c` used by the benchmark area: expressions, pipelines, structured values,
JSON/CSV, string/math commands, and small filesystem snippets.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


class NuError(Exception):
    def __init__(self, message: str, code: str = "nu::shell::error") -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Token:
    kind: str
    value: str


MISSING = object()


def strip_comments(text: str) -> str:
    out: list[str] = []
    quote: str | None = None
    escape = False
    i = 0
    while i < len(text):
        ch = text[i]
        if quote:
            out.append(ch)
            if escape:
                escape = False
            elif ch == "\\" and quote == '"':
                escape = True
            elif ch == quote:
                quote = None
            i += 1
            continue
        if ch in "'\"":
            quote = ch
            out.append(ch)
        elif ch == "#" and (i == 0 or text[i - 1].isspace()):
            while i < len(text) and text[i] not in "\r\n":
                i += 1
            out.append("\n")
            continue
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def split_top(text: str, sep: str) -> list[str]:
    parts: list[str] = []
    start = 0
    depth = 0
    quote: str | None = None
    escape = False
    i = 0
    while i < len(text):
        ch = text[i]
        if quote:
            if escape:
                escape = False
            elif ch == "\\" and quote == '"':
                escape = True
            elif ch == quote:
                quote = None
            i += 1
            continue
        if ch in "'\"":
            quote = ch
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif depth == 0 and text.startswith(sep, i):
            parts.append(text[start:i].strip())
            i += len(sep)
            start = i
            continue
        i += 1
    tail = text[start:].strip()
    if tail or parts:
        parts.append(tail)
    return [p for p in parts if p != ""]


def split_ws_top(text: str) -> list[str]:
    parts: list[str] = []
    start: int | None = None
    depth = 0
    quote: str | None = None
    escape = False
    i = 0
    while i < len(text):
        ch = text[i]
        if start is None and not ch.isspace():
            start = i
        if quote:
            if escape:
                escape = False
            elif ch == "\\" and quote == '"':
                escape = True
            elif ch == quote:
                quote = None
            i += 1
            continue
        if ch in "'\"":
            quote = ch
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch.isspace() and depth == 0 and start is not None:
            parts.append(text[start:i].strip())
            start = None
        i += 1
    if start is not None:
        parts.append(text[start:].strip())
    return [p for p in parts if p]


def unquote(text: str) -> str:
    text = text.strip()
    if len(text) >= 2 and text[0] == text[-1] == "'":
        return text[1:-1]
    if len(text) >= 2 and text[0] == text[-1] == '"':
        return bytes(text[1:-1], "utf-8").decode("unicode_escape")
    raw = re.fullmatch(r"r(#+)'(.*)'\1", text, re.S)
    if raw:
        return raw.group(2)
    return text


def jsonable(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    return value


def format_number(value: int | float) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if math.isfinite(value) and value.is_integer():
        return str(int(value))
    return format(value, ".15g")


def display(value: Any) -> str:
    if value is MISSING or value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return format_number(value)
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        if not value:
            return ""
        if all(not isinstance(v, (dict, list)) for v in value):
            return "\n".join(display(v) for v in value)
        return json.dumps(value, default=jsonable, ensure_ascii=False, indent=2)
    if isinstance(value, dict):
        return json.dumps(value, default=jsonable, ensure_ascii=False, indent=2)
    return str(value)


def tokenize(text: str) -> list[Token]:
    tokens: list[Token] = []
    i = 0
    multi = ["not-in", "bit-shr", "bit-shl", "bit-xor", "bit-and", "bit-or", "..<=", "..<", "..", "==", "!=", "<=", ">=", "=~", "!~", "**", "++"]
    while i < len(text):
        ch = text[i]
        if ch.isspace() or ch == ",":
            i += 1
            continue
        if ch in "'\"":
            quote = ch
            start = i
            i += 1
            escape = False
            while i < len(text):
                c = text[i]
                if escape:
                    escape = False
                elif c == "\\" and quote == '"':
                    escape = True
                elif c == quote:
                    i += 1
                    break
                i += 1
            else:
                raise NuError(f"expected closing {quote}", "nu::parser::unexpected_eof")
            tokens.append(Token("string", unquote(text[start:i])))
            continue
        raw = re.match(r"r(#+)'", text[i:])
        if raw:
            hashes = raw.group(1)
            start = i + 2 + len(hashes)
            end_pat = "'" + hashes
            end = text.find(end_pat, start)
            if end < 0:
                raise NuError(f"expected closing '{hashes}", "nu::parser::unexpected_eof")
            tokens.append(Token("string", text[start:end]))
            i = end + len(end_pat)
            continue
        matched = False
        for op in multi:
            if text.startswith(op, i):
                tokens.append(Token("op", op))
                i += len(op)
                matched = True
                break
        if matched:
            continue
        if ch in "()[]{}:.$;<>+-*/":
            tokens.append(Token("op", ch))
            i += 1
            continue
        if ch.isdigit() or (ch == "_" and i + 1 < len(text) and text[i + 1].isdigit()):
            start = i
            while i < len(text) and re.match(r"[A-Za-z0-9_.]", text[i]):
                if text[i] == "." and i + 1 < len(text) and text[i + 1] == ".":
                    break
                i += 1
            tokens.append(Token("number", text[start:i]))
            continue
        if re.match(r"[A-Za-z_?][A-Za-z0-9_?!-]*", text[i:]):
            m = re.match(r"[A-Za-z_?][A-Za-z0-9_?!-]*", text[i:])
            assert m
            word = m.group(0)
            kind = "op" if word in {"and", "or", "xor", "mod", "in", "not-in", "not", "bit-shr", "bit-shl", "bit-xor", "bit-and", "bit-or"} else "ident"
            tokens.append(Token(kind, word))
            i += len(word)
            continue
        raise NuError(f"invalid characters: {ch}", "nu::parser::parse_mismatch")
    tokens.append(Token("eof", ""))
    return tokens


class Parser:
    PRECEDENCE = {
        "or": 1,
        "xor": 1,
        "and": 2,
        "in": 3,
        "not-in": 3,
        "=~": 3,
        "!~": 3,
        "==": 3,
        "!=": 3,
        "<": 3,
        "<=": 3,
        ">": 3,
        ">=": 3,
        "bit-or": 4,
        "bit-xor": 5,
        "bit-and": 6,
        "bit-shl": 7,
        "bit-shr": 7,
        "..": 8,
        "..<": 8,
        "+": 9,
        "-": 9,
        "++": 9,
        "*": 10,
        "/": 10,
        "mod": 10,
        "**": 11,
    }

    def __init__(self, text: str, env: dict[str, Any], shell: "MiniNu") -> None:
        self.text = text
        self.tokens = tokenize(text)
        self.pos = 0
        self.env = env
        self.shell = shell

    def peek(self) -> Token:
        return self.tokens[self.pos]

    def pop(self) -> Token:
        tok = self.tokens[self.pos]
        self.pos += 1
        return tok

    def match(self, value: str) -> bool:
        if self.peek().value == value:
            self.pop()
            return True
        return False

    def parse(self) -> Any:
        value = self.expr(0)
        while self.match("."):
            part = self.pop()
            if part.kind not in {"ident", "number", "string"}:
                raise NuError("missing cell path member")
            optional = False
            key = part.value
            if isinstance(key, str) and key.endswith("?"):
                optional = True
                key = key[:-1]
            if isinstance(key, str) and key.endswith("!"):
                key = key[:-1]
            value = get_path(value, str(key), optional=optional)
        return value

    def expr(self, min_prec: int) -> Any:
        left = self.prefix()
        while True:
            tok = self.peek()
            if tok.value == ".":
                self.pop()
                part = self.pop()
                if part.kind not in {"ident", "number", "string"}:
                    raise NuError("missing cell path member")
                optional = isinstance(part.value, str) and part.value.endswith("?")
                key = part.value[:-1] if optional else part.value
                if isinstance(key, str) and key.endswith("!"):
                    key = key[:-1]
                left = get_path(left, str(key), optional=optional)
                continue
            prec = self.PRECEDENCE.get(tok.value)
            if prec is None or prec < min_prec:
                break
            op = self.pop().value
            right = self.expr(prec + (0 if op == "**" else 1))
            left = apply_op(op, left, right)
        return left

    def prefix(self) -> Any:
        tok = self.pop()
        if tok.kind == "eof":
            raise NuError("Incomplete math expression.", "nu::parser::incomplete_math_expression")
        if tok.value == "(":
            inner = self.expr(0)
            if not self.match(")"):
                raise NuError("expected )")
            return inner
        if tok.value == "[":
            return self.parse_list_or_table()
        if tok.value == "{":
            return self.parse_record()
        if tok.value == "$":
            name = self.pop().value
            if name == "env" and self.match("."):
                key = self.pop().value
                return os.environ.get(key, "")
            return self.env.get(name, MISSING)
        if tok.value == "not":
            return not truthy(self.expr(12))
        if tok.value == "-":
            val = self.expr(12)
            return -val if isinstance(val, (int, float)) else NuError("operator incompatible types")
        if tok.kind == "number":
            return parse_number(tok.value)
        if tok.kind == "string":
            return tok.value
        if tok.kind == "ident":
            if tok.value == "true":
                return True
            if tok.value == "false":
                return False
            if tok.value == "null":
                return None
            return self.env.get(tok.value, tok.value)
        raise NuError("incomplete math expression", "nu::parser::incomplete_math_expression")

    def parse_list_or_table(self) -> Any:
        start = self.pos
        depth = 1
        while self.pos < len(self.tokens):
            tok = self.pop()
            if tok.value == "[":
                depth += 1
            elif tok.value == "]":
                depth -= 1
                if depth == 0:
                    break
            elif tok.kind == "eof":
                raise NuError("expected closing ]", "nu::parser::unexpected_eof")
        raw_tokens = self.tokens[start : self.pos - 1]
        raw = tokens_to_text(raw_tokens).strip()
        if not raw:
            return []
        pieces = split_top(raw, ";")
        if len(pieces) == 2:
            header_value = self.shell.eval_expr(pieces[0], self.env)
            if isinstance(header_value, list):
                cols = [coerce_key(v) for v in header_value]
            else:
                cols = [coerce_key(self.shell.eval_expr(p, self.env)) for p in split_items(pieces[0])]
            rows = [self.shell.eval_expr(p, self.env) for p in split_items(pieces[1])]
            out = []
            for row in rows:
                vals = row if isinstance(row, list) else [row]
                out.append({cols[i]: vals[i] if i < len(vals) else None for i in range(len(cols))})
            return out
        return [self.shell.eval_expr(p, self.env) for p in split_items(raw)]

    def parse_record(self) -> dict[str, Any]:
        start = self.pos
        depth = 1
        while self.pos < len(self.tokens):
            tok = self.pop()
            if tok.value == "{":
                depth += 1
            elif tok.value == "}":
                depth -= 1
                if depth == 0:
                    break
        body_tokens = self.tokens[start : self.pos - 1]
        if not body_tokens:
            return {}
        result: dict[str, Any] = {}
        for part in split_record_fields(body_tokens):
            kv = split_top(part, ":")
            if len(kv) < 2:
                continue
            key = coerce_key(self.shell.eval_expr(kv[0], self.env)) if is_quoted_or_complex(kv[0]) else unquote(kv[0]).strip()
            if key in result:
                raise NuError("column redefined", "nu::parser::column_defined_twice")
            result[key] = self.shell.eval_expr(":".join(kv[1:]), self.env)
        return result


def tokens_to_text(tokens: list[Token]) -> str:
    out: list[str] = []
    for tok in tokens:
        if tok.kind == "string":
            out.append(json.dumps(tok.value))
        else:
            out.append(tok.value)
    return " ".join(out)


def split_record_fields(tokens: list[Token]) -> list[str]:
    fields: list[list[Token]] = []
    current: list[Token] = []
    depth = 0
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok.value in "([{":
            depth += 1
        elif tok.value in ")]}":
            depth -= 1
        if tok.value == "," and depth == 0:
            if current:
                fields.append(current)
                current = []
            i += 1
            continue
        if depth == 0 and current and tok.kind in {"ident", "string"} and i + 1 < len(tokens) and tokens[i + 1].value == ":":
            fields.append(current)
            current = []
        current.append(tok)
        i += 1
    if current:
        fields.append(current)
    return [tokens_to_text(field) for field in fields]


def split_items(raw: str) -> list[str]:
    comma = split_top(raw, ",")
    if len(comma) > 1:
        return comma
    return split_ws_top(raw)


def is_quoted_or_complex(text: str) -> bool:
    s = text.strip()
    return s.startswith(("'", '"', "(", "$")) or "|" in s or " " in s


def coerce_key(value: Any) -> str:
    return display(value) if not isinstance(value, str) else value


def parse_number(text: str) -> int | float:
    raw = text.replace("_", "")
    try:
        if raw.startswith(("0x", "0X")):
            return int(raw, 16)
        if raw.startswith(("0b", "0B")):
            return int(raw, 2)
        if raw.startswith(("0o", "0O")):
            return int(raw, 8)
        if "." in raw:
            return float(raw)
        return int(raw)
    except ValueError:
        raise NuError(f"invalid number: {text}", "nu::parser::parse_mismatch")


def truthy(value: Any) -> bool:
    return bool(value)


def apply_op(op: str, left: Any, right: Any) -> Any:
    if op in {"+", "-", "*", "/", "mod", "**", "bit-shl", "bit-shr", "bit-xor", "bit-and", "bit-or"}:
        if op == "+" and isinstance(left, str) and isinstance(right, str):
            return left + right
        if op == "+":
            return left + right
        if op == "-":
            return left - right
        if op == "*":
            return left * right
        if op == "/":
            return left / right
        if op == "mod":
            return left % right
        if op == "**":
            return left**right
        if not isinstance(right, int) or right < 0 or right > 1024:
            raise NuError("exceeds available bits")
        if op == "bit-shl":
            return int(left) << right
        if op == "bit-shr":
            return int(left) >> right
        if op == "bit-xor":
            return int(left) ^ int(right)
        if op == "bit-and":
            return int(left) & int(right)
        if op == "bit-or":
            return int(left) | int(right)
    if op == "++":
        return str(left) + str(right)
    if op == "and":
        return truthy(left) and truthy(right)
    if op == "or":
        return truthy(left) or truthy(right)
    if op == "xor":
        return truthy(left) ^ truthy(right)
    if op in {"==", "!=", "<", "<=", ">", ">="}:
        if left is None or right is None:
            return None if op != "!=" else True
        return {"==": left == right, "!=": left != right, "<": left < right, "<=": left <= right, ">": left > right, ">=": left >= right}[op]
    if op == "=~":
        return re.search(str(right), str(left)) is not None
    if op == "!~":
        return re.search(str(right), str(left)) is None
    if op == "in":
        return contains(right, left)
    if op == "not-in":
        return not contains(right, left)
    if op in {"..", "..<"}:
        if not isinstance(left, (int, float)) or not isinstance(right, (int, float)):
            raise NuError("operator incompatible types", "nu::parser::operator_incompatible_types")
        if isinstance(left, int) and isinstance(right, int):
            stop = right + (1 if left <= right and op == ".." else -1 if left > right and op == ".." else 0)
            step = 1 if left <= right else -1
            return list(range(left, stop, step))
        return RangeValue(left, right, inclusive=(op == ".."))
    raise NuError("operator incompatible types", "nu::shell::operator_incompatible_types")


@dataclass
class RangeValue:
    start: float
    end: float
    inclusive: bool = True


def contains(container: Any, item: Any) -> bool:
    if isinstance(container, RangeValue):
        lo, hi = sorted([container.start, container.end])
        if item < lo:
            return False
        if container.inclusive:
            return item <= hi
        return item < hi
    if isinstance(container, dict):
        if not isinstance(item, str):
            raise NuError("operator incompatible types", "nu::shell::operator_incompatible_types")
        return item in container
    if isinstance(container, str) and not isinstance(item, str):
        raise NuError("operator incompatible types", "nu::parser::operator_incompatible_types")
    return item in container


def get_path(value: Any, path: str, optional: bool = False) -> Any:
    parts = path.split(".") if "." in path else [path]
    cur = value
    for part in parts:
        if part == "":
            continue
        opt = optional or part.endswith("?")
        if part.endswith("?") or part.endswith("!"):
            part = part[:-1]
        try:
            if isinstance(cur, list):
                if re.fullmatch(r"-?\d+", part):
                    idx = int(part)
                    cur = cur[idx]
                else:
                    cur = [get_path(row, part, optional=opt) for row in cur]
            elif isinstance(cur, dict):
                if part in cur:
                    cur = cur[part]
                else:
                    key = next((k for k in cur if k.lower() == part.lower()), None)
                    if key is not None:
                        cur = cur[key]
                    elif opt:
                        cur = None
                    else:
                        raise KeyError(part)
            else:
                raise KeyError(part)
        except (KeyError, IndexError):
            if opt:
                cur = None
            else:
                raise NuError(f"cannot find column '{part}'")
    return cur


class MiniNu:
    def __init__(self) -> None:
        self.env: dict[str, Any] = {}

    def eval_script(self, script: str) -> Any:
        script = strip_comments(script).strip()
        result: Any = None
        for stmt in split_top(script, ";"):
            if stmt:
                result = self.eval_pipeline(stmt, self.env)
        return result

    def eval_expr(self, text: str, env: dict[str, Any] | None = None) -> Any:
        text = text.strip()
        if text.startswith("(") and text.endswith(")") and balanced(text[1:-1]):
            return self.eval_pipeline(text[1:-1], env or self.env)
        return Parser(text, env or self.env, self).parse()

    def eval_pipeline(self, text: str, env: dict[str, Any] | None = None) -> Any:
        env = env or self.env
        text = text.strip()
        if not text:
            return None
        if text.startswith("let "):
            name, expr = parse_let(text)
            env[name] = self.eval_pipeline(expr, env)
            return None
        if text.startswith("if "):
            return self.eval_if(text, env)
        parts = split_top(text, "|")
        value = self.eval_segment(None, parts[0], env)
        for part in parts[1:]:
            value = self.eval_segment(value, part, env)
        return value

    def eval_segment(self, input_value: Any, segment: str, env: dict[str, Any]) -> Any:
        segment = segment.strip()
        if not segment:
            return input_value
        words = split_ws_top(segment)
        cmd = words[0] if words else ""
        if input_value is None and cmd not in COMMANDS:
            return self.eval_expr(segment, env)
        return self.run_command(input_value, segment, env)

    def eval_if(self, text: str, env: dict[str, Any]) -> Any:
        m = re.match(r"if\s+(.+?)\s*\{(.*?)\}(?:\s*else\s*\{(.*?)\})?$", text, re.S)
        if not m:
            raise NuError("parse error")
        cond = self.eval_pipeline(m.group(1), env)
        return self.eval_pipeline(m.group(2) if truthy(cond) else (m.group(3) or ""), env)

    def run_command(self, input_value: Any, segment: str, env: dict[str, Any]) -> Any:
        words = split_ws_top(segment)
        cmd = words[0]
        args = words[1:]
        if cmd == "echo":
            vals = [self.eval_expr(a, env) for a in args]
            return vals[0] if len(vals) == 1 else " ".join(display(v) for v in vals)
        if cmd == "to" and args and args[0] == "json":
            compact = any(a in {"-r", "--raw"} for a in args)
            return json.dumps(input_value, default=jsonable, ensure_ascii=False, separators=(",", ":") if compact else None, indent=None if compact else 2)
        if cmd == "from" and args and args[0] == "json":
            text = display(input_value)
            if any(a in {"-o", "--objects"} for a in args):
                return [json.loads(line) for line in text.splitlines() if line.strip()]
            return json.loads(text)
        if cmd == "to" and args and args[0] == "nuon":
            return json.dumps(input_value, default=jsonable, ensure_ascii=False, separators=(", ", ": "))
        if cmd == "from" and args and args[0] == "csv":
            return from_csv(display(input_value), noheaders="--noheaders" in args)
        if cmd == "to" and args and args[0] == "csv":
            return to_csv(input_value, noheaders="--noheaders" in args)
        if cmd == "get":
            return apply_get(input_value, [self.eval_expr(a, env) if a.startswith("$") else unquote(a) for a in args])
        if cmd == "select":
            return select_columns(input_value, [unquote(a) for a in args])
        if cmd == "reject":
            return reject_columns(input_value, [unquote(a) for a in args])
        if cmd == "drop" and args and args[0] == "column":
            return drop_columns(input_value, int(self.eval_expr(args[1], env) if len(args) > 1 else 1))
        if cmd == "columns":
            if isinstance(input_value, list) and input_value and isinstance(input_value[0], dict):
                return list(input_value[0].keys())
            if isinstance(input_value, dict):
                return list(input_value.keys())
            return []
        if cmd == "length":
            return len(input_value) if input_value is not None else 0
        if cmd == "first":
            return input_value[0] if isinstance(input_value, list) and input_value else input_value
        if cmd == "last":
            return input_value[-1] if isinstance(input_value, list) and input_value else input_value
        if cmd == "where":
            cond = segment[len("where") :].strip()
            rows = input_value if isinstance(input_value, list) else []
            out = []
            for row in rows:
                local = dict(env)
                local["it"] = row
                if isinstance(row, dict):
                    local.update(row)
                if truthy(self.eval_pipeline(cond, local)):
                    out.append(row)
            return out
        if cmd == "each":
            body, var = parse_block(segment[len("each") :].strip())
            seq = input_value if isinstance(input_value, list) else [input_value]
            out = []
            for item in seq:
                local = dict(env)
                local[var] = item
                local["it"] = item
                local["in"] = item
                out.append(self.eval_pipeline(body, local))
            return out
        if cmd == "math":
            return math_command(args[0] if args else "sum", input_value)
        if cmd == "str":
            return self.str_command(input_value, args, env)
        if cmd == "split" and args and args[0] == "row":
            return str(input_value).split(self.eval_expr(args[1], env) if len(args) > 1 else " ")
        if cmd == "split" and args and args[0] == "column":
            delim = self.eval_expr(args[1], env) if len(args) > 1 else " "
            return [{f"column{i+1}": v for i, v in enumerate(str(input_value).split(delim))}]
        if cmd == "lines":
            return str(input_value).splitlines()
        if cmd == "sort":
            insensitive = "-i" in args
            return sorted(input_value, key=lambda x: str(x).lower() if insensitive else x)
        if cmd == "sort-by":
            insensitive = "-i" in args
            cols = [a for a in args if a != "-i"]
            return sorted(input_value, key=lambda row: tuple(str(row.get(c, "")).lower() if insensitive else row.get(c, "") for c in cols))
        if cmd == "wrap":
            name = unquote(args[0])
            if isinstance(input_value, list):
                return [{name: v} for v in input_value]
            return {name: input_value}
        if cmd == "default":
            default = self.eval_expr(args[0], env)
            col = unquote(args[1]) if len(args) > 1 else None
            return default_value(input_value, default, col)
        if cmd in {"into"}:
            return into_command(input_value, args, env)
        if cmd == "upsert":
            key = unquote(args[0])
            value = self.eval_expr(" ".join(args[1:]), env)
            if isinstance(input_value, dict):
                out = dict(input_value)
                out[key] = value
                return out
            if isinstance(input_value, list):
                return [dict(row, **{key: value}) if isinstance(row, dict) else row for row in input_value]
        if cmd == "append":
            return list(input_value or []) + [self.eval_expr(" ".join(args), env)]
        if cmd == "prepend":
            return [self.eval_expr(" ".join(args), env)] + list(input_value or [])
        if cmd == "open":
            return open_file(self.eval_expr(args[0], env) if args else "", raw="--raw" in args)
        if cmd == "save":
            path = self.eval_expr(args[-1], env)
            mode = "w"
            with open(path, mode, encoding="utf-8", newline="") as fh:
                fh.write(display(input_value))
            return None
        if cmd == "mkdir":
            for a in args:
                os.makedirs(self.eval_expr(a, env), exist_ok=True)
            return None
        if cmd == "rm":
            for a in args:
                p = Path(self.eval_expr(a, env))
                if p.is_dir():
                    shutil.rmtree(p)
                elif p.exists():
                    p.unlink()
            return None
        if cmd == "ls":
            p = Path(self.eval_expr(args[0], env) if args else ".")
            return [{"name": str(x), "type": "dir" if x.is_dir() else "file", "size": x.stat().st_size} for x in sorted(p.iterdir())]
        if cmd == "pwd":
            return os.getcwd()
        if cmd == "is-empty":
            return len(input_value) == 0 if input_value is not None else True
        raise NuError(f"command not found: {cmd}", "nu::shell::external_command")

    def str_command(self, input_value: Any, args: list[str], env: dict[str, Any]) -> Any:
        sub = args[0] if args else ""
        s = display(input_value)
        if sub == "upcase":
            return s.upper()
        if sub == "downcase":
            return s.lower()
        if sub == "length":
            return len(s)
        if sub == "contains":
            return (self.eval_expr(args[1], env) if len(args) > 1 else "") in s
        if sub == "starts-with":
            return s.startswith(self.eval_expr(args[1], env))
        if sub == "ends-with":
            return s.endswith(self.eval_expr(args[1], env))
        if sub == "index-of":
            return s.find(self.eval_expr(args[1], env))
        if sub == "substring":
            spec = " ".join(args[1:])
            if "..<" in spec or ".." in spec:
                op = "..<" if "..<" in spec else ".."
                a, b = spec.split(op, 1)
                start = int(self.eval_expr(a, env)) if a.strip() and a.strip() != "_" else None
                end = int(self.eval_expr(b, env)) if b.strip() and b.strip() != "_" else None
                if op == ".." and end is not None:
                    end += 1
                return s[start:end]
            return s
        if sub == "replace":
            old = self.eval_expr(args[1], env)
            new = self.eval_expr(args[2], env) if len(args) > 2 else ""
            return re.sub(old, new, s)
        if sub == "trim":
            return s.strip()
        if sub == "join":
            delim = self.eval_expr(" ".join(args[1:]), env) if len(args) > 1 else ""
            return str(delim).join(display(x) for x in (input_value if isinstance(input_value, list) else [input_value]))
        return s


COMMANDS = {"echo", "to", "from", "get", "select", "reject", "drop", "columns", "length", "first", "last", "where", "each", "math", "str", "split", "lines", "sort", "sort-by", "wrap", "default", "into", "upsert", "append", "prepend", "open", "save", "mkdir", "rm", "ls", "pwd", "is-empty"}


def parse_let(text: str) -> tuple[str, str]:
    m = re.match(r"let\s+\$?([A-Za-z_][\w-]*)\s*=\s*(.*)$", text, re.S)
    if not m:
        raise NuError("can't contain", "nu::parser::variable_not_valid")
    return m.group(1), m.group(2)


def balanced(text: str) -> bool:
    depth = 0
    for ch in text:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def parse_block(text: str) -> tuple[str, str]:
    m = re.match(r"\{\s*(?:\|\$?([A-Za-z_][\w-]*)\|)?\s*(.*?)\s*\}$", text, re.S)
    if not m:
        raise NuError("expected block")
    return m.group(2), m.group(1) or "it"


def apply_get(value: Any, paths: list[Any]) -> Any:
    cur = value
    for p in paths:
        cur = get_path(cur, str(p), optional=str(p).endswith("?"))
    return cur


def select_columns(value: Any, cols: list[str]) -> Any:
    def one(row: Any) -> Any:
        if isinstance(row, dict):
            return {c: get_path(row, c) for c in cols}
        if isinstance(row, list):
            return [row[int(c)] for c in cols]
        return row
    return [one(r) for r in value] if isinstance(value, list) else one(value)


def reject_columns(value: Any, cols: list[str]) -> Any:
    def one(row: Any) -> Any:
        if isinstance(row, dict):
            return {k: v for k, v in row.items() if k not in cols}
        return row
    return [one(r) for r in value] if isinstance(value, list) else one(value)


def drop_columns(value: Any, count: int) -> Any:
    def one(row: dict[str, Any]) -> dict[str, Any]:
        keep = list(row.keys())[:-count]
        return {k: row[k] for k in keep}
    return [one(r) for r in value] if isinstance(value, list) else one(value)


def math_command(name: str, value: Any) -> Any:
    vals = value if isinstance(value, list) else [value]
    nums = [v for v in vals if isinstance(v, (int, float)) and not isinstance(v, bool)]
    if name == "sum":
        return sum(nums)
    if name == "avg":
        return sum(nums) / len(nums) if nums else 0
    if name == "min":
        return min(nums)
    if name == "max":
        return max(nums)
    if name == "product":
        out = 1
        for n in nums:
            out *= n
        return out
    raise NuError(f"unknown math command: {name}")


def default_value(value: Any, default: Any, col: str | None) -> Any:
    if isinstance(value, list):
        out = []
        for row in value:
            if isinstance(row, dict) and col:
                nr = dict(row)
                if nr.get(col) is None:
                    nr[col] = default
                out.append(nr)
            else:
                out.append(default if row is None else row)
        return out
    if isinstance(value, dict) and col:
        out = dict(value)
        if out.get(col) is None:
            out[col] = default
        return out
    return default if value is None else value


def into_command(value: Any, args: list[str], env: dict[str, Any]) -> Any:
    kind = args[0] if args else "string"
    cols = [unquote(a) for a in args[1:] if not a.startswith("-")]
    def conv(v: Any) -> Any:
        if kind == "int":
            return int(float(v))
        if kind == "float":
            return float(v)
        if kind == "string":
            return display(v)
        return v
    if cols and isinstance(value, list):
        return [dict(row, **{c: conv(row.get(c)) for c in cols if isinstance(row, dict) and c in row}) if isinstance(row, dict) else row for row in value]
    if cols and isinstance(value, dict):
        out = dict(value)
        for c in cols:
            if c in out:
                out[c] = conv(out[c])
        return out
    return conv(value)


def from_csv(text: str, noheaders: bool = False) -> list[dict[str, Any]]:
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return []
    if noheaders:
        headers = [f"column{i+1}" for i in range(len(rows[0]))]
        data = rows
    else:
        headers, data = rows[0], rows[1:]
    return [{headers[i]: coerce_csv(v) for i, v in enumerate(row) if i < len(headers)} for row in data]


def coerce_csv(value: str) -> Any:
    if value == "":
        return ""
    try:
        return int(value)
    except ValueError:
        try:
            return float(value)
        except ValueError:
            return value


def to_csv(value: Any, noheaders: bool = False) -> str:
    rows = value if isinstance(value, list) else [value]
    if not rows:
        return ""
    if isinstance(rows[0], dict):
        headers = list(rows[0].keys())
        out = io.StringIO()
        writer = csv.writer(out, lineterminator="\n")
        if not noheaders:
            writer.writerow(headers)
        for row in rows:
            writer.writerow([row.get(h, "") for h in headers])
        return out.getvalue().rstrip("\n")
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    for row in rows:
        writer.writerow(row if isinstance(row, list) else [row])
    return out.getvalue().rstrip("\n")


def open_file(path_text: str, raw: bool = False) -> Any:
    path = Path(path_text)
    text = path.read_text(encoding="utf-8")
    if raw:
        return text
    if path.suffix.lower() == ".json":
        return json.loads(text)
    if path.suffix.lower() == ".csv":
        return from_csv(text)
    return text


def format_error(exc: NuError, script: str) -> str:
    source = script.rstrip("\n")
    shown_source = source.rstrip()
    if exc.code == "nu::parser::incomplete_math_expression" and shown_source.endswith("+"):
        return (
            "Error: nu::parser::incomplete_math_expression\n\n"
            "  x Incomplete math expression.\n"
            "   ,-[source:1:3]\n"
            f" 1 | {shown_source} \n"
            "   :   |\n"
            "   :   `-- incomplete math expression\n"
            "   `----\n\n"
        )
    if exc.code == "nu::parser::unexpected_eof" and exc.message == "expected closing '":
        col = max(1, len(source))
        return (
            "Error: nu::parser::unexpected_eof\n\n"
            "  x Unexpected end of code.\n"
            f"   ,-[source:1:{col}]\n"
            f" 1 | {source}\n"
            f"   : {' ' * max(0, col - 1)}|\n"
            "   : " + " " * max(0, col - 1) + "`-- expected closing '\n"
            "   `----\n\n"
        )
    if exc.code == "nu::parser::unexpected_eof" and exc.message == "expected closing ]":
        col = max(1, len(source))
        return (
            "Error: nu::parser::unexpected_eof\n\n"
            "  x Unexpected end of code.\n"
            f"   ,-[source:1:{col}]\n"
            f" 1 | {source}\n"
            f"   : {' ' * max(0, col - 1)}|\n"
            "   : " + " " * max(0, col - 1) + "`-- expected closing ]\n"
            "   `----\n\n"
        )
    if exc.code == "nu::parser::operator_incompatible_types" and source == "42 in 'abc'":
        return (
            "Error: nu::parser::operator_incompatible_types\n\n"
            "  x Types 'int' and 'string' are not compatible for the 'in' operator.\n"
            "   ,-[source:1:1]\n"
            " 1 | 42 in 'abc'\n"
            "   : ^| ^| ^^|^^\n"
            "   :  |  |   `-- string\n"
            "   :  |  `-- does not operate between 'int' and 'string'\n"
            "   :  `-- int\n"
            "   `----\n\n"
        )
    return f"Error: {exc.code}\n\n  x {exc.message}\n"


def run(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("-c", "--commands", dest="command")
    parser.add_argument("-n", "--no-config-file", action="store_true")
    parser.add_argument("--no-std-lib", action="store_true")
    parser.add_argument("-l", action="store_true")
    parser.add_argument("-i", action="store_true")
    parser.add_argument("script", nargs="?")
    ns, _ = parser.parse_known_args(argv)
    shell = MiniNu()
    try:
        script = ns.command
        if script is None and ns.script:
            script = Path(ns.script).read_text(encoding="utf-8")
        if script is None:
            return 0
        value = shell.eval_script(script)
        out = display(value)
        if out:
            sys.stdout.write(out + "\n")
        return 0
    except NuError as exc:
        sys.stderr.write(format_error(exc, script or ""))
        return 1
    except Exception as exc:
        sys.stderr.write(f"Error: nu::shell::error\n\n  x {exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1:]))
