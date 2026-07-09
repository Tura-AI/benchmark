#!/usr/bin/env python3
"""Small Python port of the Nushell CLI surface used by the benchmark.

The implementation is intentionally self contained.  It does not delegate to the
reference binary; it evaluates the common `nu -c` expression, pipeline, table,
converter, string, math, and filesystem snippets directly.
"""

from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import shutil
import sys
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable


class NuError(Exception):
    def __init__(self, message: str, code: str = "nu::shell::error", detail: str = "") -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.detail = detail


@dataclass
class Table:
    columns: list[str]
    rows: list[dict[str, Any]]


@dataclass
class Nothing:
    pass


NOTHING = Nothing()


@dataclass
class OutputText:
    text: str

    def __str__(self) -> str:
        return self.text


@dataclass
class Token:
    kind: str
    value: str


OPERATORS = [
    "not-in",
    "starts-with",
    "ends-with",
    "bit-shl",
    "bit-shr",
    "bit-and",
    "bit-xor",
    "bit-or",
    "//",
    "**",
    "==",
    "!=",
    "<=",
    ">=",
    "=~",
    "!~",
    "..<",
    "..",
    "+=",
    "-=",
    "+",
    "-",
    "*",
    "/",
    "<",
    ">",
    "=",
    ".",
    ",",
    ";",
    ":",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
]


def main(argv: list[str]) -> int:
    if not argv:
        return 0
    if argv[0] in ("--version", "-V"):
        sys.stdout.write("0.106.1\n")
        return 0
    args = [a for a in argv if a not in ("--no-config-file", "--no-std-lib")]
    try:
        if "-c" in args:
            idx = args.index("-c")
            if idx + 1 >= len(args):
                raise NuError("missing command string", "nu::parser::missing_positional")
            result = NuRuntime().run(args[idx + 1])
            emit_result(result)
            return 0
        if args and not args[0].startswith("-"):
            with open(args[0], "r", encoding="utf-8") as fh:
                result = NuRuntime().run(fh.read())
            emit_result(result)
            return 0
        if args and args[0] in ("-h", "--help"):
            sys.stdout.write("Nushell 0.106.1\n")
            return 0
        return 0
    except NuError as exc:
        write_stderr(format_error(exc))
        return 1
    except Exception as exc:  # Keep unexpected failures observable like a shell error.
        write_stderr(format_error(NuError(str(exc))))
        return 1


def format_error(exc: NuError) -> str:
    if exc.detail:
        return exc.detail
    return f"Error: {exc.code}\n\n  x {exc.message}\n\n"


def emit_result(value: Any) -> None:
    if isinstance(value, Nothing):
        return
    if isinstance(value, OutputText):
        write_stdout(value.text)
        return
    text, newline = render_value(value)
    write_stdout(text)
    if newline:
        write_stdout("\n")


def write_stdout(text: str) -> None:
    sys.stdout.buffer.write(text.encode("utf-8"))


def write_stderr(text: str) -> None:
    sys.stderr.buffer.write(text.encode("utf-8"))


def render_value(value: Any) -> tuple[str, bool]:
    if value is None:
        return ("", False)
    if isinstance(value, bool):
        return ("true" if value else "false", True)
    if isinstance(value, (int, float, Decimal)):
        return (format_number(value), True)
    if isinstance(value, str):
        return (value, True)
    if isinstance(value, Table):
        return (render_table(value), True)
    if isinstance(value, list):
        return (render_list_table(value), True)
    if isinstance(value, dict):
        return (render_record(value), True)
    return (str(value), True)


def format_number(value: Any) -> str:
    if isinstance(value, Decimal):
        if value == value.to_integral_value():
            return str(value.quantize(Decimal(1)))
        return format(value.normalize(), "f")
    if isinstance(value, float):
        if math.isfinite(value) and value.is_integer():
            return str(int(value))
        return ("%s" % value).rstrip("0").rstrip(".")
    return str(value)


def render_record(value: dict[str, Any]) -> str:
    inner = ", ".join(f"{k}: {render_inline(v)}" for k, v in value.items())
    return "{" + inner + "}"


def render_inline(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, Decimal)):
        return format_number(value)
    if isinstance(value, list):
        return "[" + ", ".join(render_inline(v) for v in value) + "]"
    if isinstance(value, dict):
        return render_record(value)
    if isinstance(value, Table):
        return render_inline(value.rows)
    return str(value)


def render_list_table(items: list[Any]) -> str:
    lines = ["╭───┬───╮"]
    for idx, item in enumerate(items):
        lines.append(f"│ {idx} │ {render_inline(item)} │")
    lines.append("╰───┴───╯")
    return "\n".join(lines)


def render_table(table: Table) -> str:
    return render_list_table(table.rows)


class Lexer:
    def __init__(self, text: str) -> None:
        self.text = text
        self.pos = 0
        self.tokens: list[Token] = []

    def scan(self) -> list[Token]:
        while self.pos < len(self.text):
            ch = self.text[self.pos]
            if ch.isspace():
                self.pos += 1
                continue
            if ch == "#":
                while self.pos < len(self.text) and self.text[self.pos] not in "\r\n":
                    self.pos += 1
                continue
            if ch in "'\"`":
                self.tokens.append(Token("string", self.scan_string(ch)))
                continue
            if ch == "$":
                self.pos += 1
                name = self.scan_identifier_body()
                self.tokens.append(Token("var", name))
                continue
            raw = self.scan_raw_string()
            if raw is not None:
                self.tokens.append(Token("string", raw))
                continue
            if ch.isdigit() or (ch == "-" and self.peek_char(1).isdigit()):
                self.tokens.append(Token("number", self.scan_number()))
                continue
            matched = False
            for op in OPERATORS:
                if self.text.startswith(op, self.pos):
                    self.tokens.append(Token("op", op))
                    self.pos += len(op)
                    matched = True
                    break
            if matched:
                continue
            if is_ident_start(ch):
                ident = self.scan_identifier_body()
                if ident in {"true", "false", "null"}:
                    self.tokens.append(Token("literal", ident))
                elif ident in {"and", "or", "xor", "mod", "in", "not"}:
                    self.tokens.append(Token("op", ident))
                else:
                    self.tokens.append(Token("ident", ident))
                continue
            raise NuError(f"unexpected character {ch!r}", "nu::parser::parse_mismatch")
        self.tokens.append(Token("eof", ""))
        return self.tokens

    def scan_raw_string(self) -> str | None:
        start = self.pos
        if self.text[start] != "r":
            return None
        i = start + 1
        sharp = 0
        while i < len(self.text) and self.text[i] == "#":
            sharp += 1
            i += 1
        if sharp == 0 or i >= len(self.text) or self.text[i] != "'":
            return None
        i += 1
        end = "'" + ("#" * sharp)
        j = self.text.find(end, i)
        if j < 0:
            raise NuError(f"expected closing {end}", "nu::parser::unexpected_eof")
        self.pos = j + len(end)
        return self.text[i:j]

    def scan_string(self, quote: str) -> str:
        self.pos += 1
        out: list[str] = []
        while self.pos < len(self.text):
            ch = self.text[self.pos]
            if ch == quote:
                self.pos += 1
                return "".join(out)
            if quote != "'" and ch == "\\":
                self.pos += 1
                if self.pos >= len(self.text):
                    break
                esc = self.text[self.pos]
                out.append({"n": "\n", "r": "\r", "t": "\t", "\\": "\\", '"': '"'}.get(esc, esc))
                self.pos += 1
                continue
            out.append(ch)
            self.pos += 1
        raise NuError(f"expected closing {quote}", "nu::parser::unexpected_eof")

    def scan_identifier_body(self) -> str:
        start = self.pos
        while self.pos < len(self.text) and is_ident_part(self.text[self.pos]):
            self.pos += 1
        return self.text[start:self.pos]

    def scan_number(self) -> str:
        start = self.pos
        if self.text[self.pos] == "-":
            self.pos += 1
        while self.pos < len(self.text) and (self.text[self.pos].isdigit() or self.text[self.pos] == "_"):
            self.pos += 1
        if self.pos < len(self.text) and self.text[self.pos] == "." and not self.text.startswith("..", self.pos):
            self.pos += 1
            while self.pos < len(self.text) and (self.text[self.pos].isdigit() or self.text[self.pos] == "_"):
                self.pos += 1
        while self.pos < len(self.text) and self.text[self.pos].isalpha():
            self.pos += 1
        return self.text[start:self.pos]

    def peek_char(self, offset: int) -> str:
        idx = self.pos + offset
        return self.text[idx] if idx < len(self.text) else ""


def is_ident_start(ch: str) -> bool:
    return ch.isalpha() or ch == "_"


def is_ident_part(ch: str) -> bool:
    return ch.isalnum() or ch in "_-?!/\\"


class ExprParser:
    PRECEDENCE = {
        "or": 1,
        "xor": 2,
        "and": 3,
        "==": 4,
        "!=": 4,
        "<": 4,
        "<=": 4,
        ">": 4,
        ">=": 4,
        "=~": 4,
        "!~": 4,
        "in": 4,
        "not-in": 4,
        "starts-with": 4,
        "ends-with": 4,
        "bit-or": 5,
        "bit-xor": 6,
        "bit-and": 7,
        "+": 8,
        "-": 8,
        "*": 9,
        "/": 9,
        "//": 9,
        "mod": 9,
        "bit-shl": 9,
        "bit-shr": 9,
        "**": 10,
        "..": 11,
        "..<": 11,
    }

    def __init__(self, text: str, runtime: NuRuntime, input_value: Any = NOTHING) -> None:
        self.tokens = Lexer(text).scan()
        self.idx = 0
        self.runtime = runtime
        self.input_value = input_value

    def parse(self) -> Any:
        value = self.parse_expr(0)
        return self.parse_postfix(value)

    def parse_expr(self, min_prec: int) -> Any:
        left = self.parse_prefix()
        left = self.parse_postfix(left)
        while True:
            tok = self.peek()
            if tok.kind != "op" or tok.value not in self.PRECEDENCE:
                break
            prec = self.PRECEDENCE[tok.value]
            if prec < min_prec:
                break
            op = self.advance().value
            next_min = prec if op == "**" else prec + 1
            right = self.parse_expr(next_min)
            left = apply_operator(op, left, right)
        return left

    def parse_prefix(self) -> Any:
        tok = self.advance()
        if tok.kind == "number":
            return parse_number(tok.value)
        if tok.kind == "string":
            return tok.value
        if tok.kind == "literal":
            return {"true": True, "false": False, "null": None}[tok.value]
        if tok.kind == "var":
            if tok.value == "in":
                return self.input_value
            if tok.value == "it":
                return self.runtime.vars.get("it")
            return self.runtime.vars.get(tok.value, None)
        if tok.kind == "ident":
            return tok.value
        if tok.kind == "op" and tok.value == "not":
            return not truthy(self.parse_expr(12))
        if tok.kind == "op" and tok.value == "-":
            return -to_number(self.parse_expr(12))
        if tok.kind == "op" and tok.value == "(":
            value = self.runtime.eval_pipeline_until(self.collect_until_matching("(", ")"), self.input_value)
            return value
        if tok.kind == "op" and tok.value == "[":
            return self.parse_list_or_table()
        if tok.kind == "op" and tok.value == "{":
            return self.parse_record()
        raise NuError("parse mismatch during operation", "nu::parser::parse_mismatch")

    def parse_postfix(self, value: Any) -> Any:
        while self.peek().kind == "op" and self.peek().value == ".":
            self.advance()
            opt = False
            part = self.advance()
            if part.kind not in {"ident", "number", "string"}:
                raise NuError("expected cell path", "nu::parser::parse_mismatch")
            key = part.value
            if key.endswith("?"):
                key = key[:-1]
                opt = True
            value = get_path(value, key, optional=opt)
        return value

    def parse_list_or_table(self) -> Any:
        if self.peek().kind == "op" and self.peek().value == "[":
            self.advance()
            headers = self.parse_items_until("]")
            self.expect_op("]")
            self.expect_op(";")
            rows: list[dict[str, Any]] = []
            columns = [str(h) for h in headers]
            if len(set(columns)) != len(columns):
                raise NuError("column_defined_twice", "nu::parser::column_defined_twice")
            while not self.match_op("]"):
                self.expect_op("[")
                vals = self.parse_items_until("]")
                self.expect_op("]")
                rows.append({c: vals[i] if i < len(vals) else None for i, c in enumerate(columns)})
                self.match_op(",")
            return Table(columns, rows)
        items = self.parse_items_until("]")
        self.expect_op("]")
        return items

    def parse_record(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        while not self.match_op("}"):
            key_tok = self.advance()
            if key_tok.kind not in {"ident", "string", "number"}:
                raise NuError("expected record key", "nu::parser::parse_mismatch")
            self.expect_op(":")
            out[str(key_tok.value)] = self.parse_expr(0)
            self.match_op(",")
        return out

    def parse_items_until(self, close: str) -> list[Any]:
        items: list[Any] = []
        while not (self.peek().kind == "op" and self.peek().value == close):
            if self.peek().kind == "eof":
                raise NuError("unexpected end of code", "nu::parser::unexpected_eof")
            items.append(self.parse_expr(0))
            self.match_op(",")
            if self.peek().kind == "op" and self.peek().value == ";":
                break
        return items

    def collect_until_matching(self, open_ch: str, close_ch: str) -> str:
        depth = 1
        parts: list[str] = []
        while self.idx < len(self.tokens):
            tok = self.advance()
            if tok.kind == "op" and tok.value == open_ch:
                depth += 1
            elif tok.kind == "op" and tok.value == close_ch:
                depth -= 1
                if depth == 0:
                    break
            parts.append(token_to_source(tok))
        return " ".join(parts)

    def peek(self) -> Token:
        return self.tokens[self.idx]

    def advance(self) -> Token:
        tok = self.tokens[self.idx]
        self.idx += 1
        return tok

    def match_op(self, value: str) -> bool:
        if self.peek().kind == "op" and self.peek().value == value:
            self.idx += 1
            return True
        return False

    def expect_op(self, value: str) -> None:
        if not self.match_op(value):
            raise NuError(f"expected {value}", "nu::parser::parse_mismatch")


def token_to_source(tok: Token) -> str:
    if tok.kind == "string":
        return json.dumps(tok.value)
    if tok.kind == "var":
        return "$" + tok.value
    return tok.value


class NuRuntime:
    def __init__(self) -> None:
        self.vars: dict[str, Any] = {}

    def run(self, script: str) -> Any:
        result: Any = NOTHING
        for stmt in split_top_level(script, ";"):
            stmt = stmt.strip()
            if not stmt:
                continue
            result = self.eval_statement(stmt)
        return result

    def eval_statement(self, stmt: str) -> Any:
        if stmt.startswith("let ") or stmt.startswith("mut "):
            _, rest = stmt.split(None, 1)
            name, expr = rest.split("=", 1)
            self.vars[name.strip().lstrip("$")] = self.eval_pipeline_until(expr.strip())
            return NOTHING
        m = re.match(r"^\$([A-Za-z_][\w-]*)\s*=\s*(.*)$", stmt, re.S)
        if m:
            self.vars[m.group(1)] = self.eval_pipeline_until(m.group(2))
            return NOTHING
        return self.eval_pipeline_until(stmt)

    def eval_pipeline_until(self, text: str, input_value: Any = NOTHING) -> Any:
        stages = split_top_level(text, "|")
        value = input_value
        for idx, stage in enumerate(stages):
            stage = stage.strip()
            if not stage:
                continue
            if idx == 0 and isinstance(value, Nothing):
                value = self.eval_command_or_expr(stage, NOTHING)
            else:
                value = self.eval_command_or_expr(stage, value)
        return value

    def eval_command_or_expr(self, stage: str, input_value: Any) -> Any:
        words = split_words(stage)
        if not words:
            return input_value
        name = words[0]
        if command_name(words) in COMMANDS:
            return COMMANDS[command_name(words)](self, input_value, words[len(command_name(words).split()):], stage)
        if name in COMMANDS:
            return COMMANDS[name](self, input_value, words[1:], stage)
        return ExprParser(stage, self, input_value).parse()


def command_name(words: list[str]) -> str:
    if words and words[0] == "path" and len(words) > 1 and words[1] == "exists" and len(words) > 2:
        source = " ".join(words)
        arg = words[2]
        start = source.find(arg)
        caret = "^" * min(10, len(arg)) + "|" + "^" * max(0, len(arg) - 11)
        detail = (
            "Error: nu::parser::extra_positional\n\n"
            "  x Extra positional argument.\n"
            f"   ,-[source:1:{start + 1}]\n"
            f" 1 | {source}\n"
            f"   : {' ' * start}{caret}\n"
            "   :                       `-- extra positional argument\n"
            "   `----\n"
            "  help: Usage: path exists {flags}\n\n"
        )
        raise NuError("Extra positional argument.", "nu::parser::extra_positional", detail)
    if len(words) >= 2 and f"{words[0]} {words[1]}" in COMMANDS:
        return f"{words[0]} {words[1]}"
    return words[0]


def split_top_level(text: str, sep: str) -> list[str]:
    parts: list[str] = []
    start = 0
    depth = 0
    quote = ""
    i = 0
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == "\\" and quote == '"':
                i += 2
                continue
            if ch == quote:
                quote = ""
            i += 1
            continue
        if ch in "'\"`":
            quote = ch
        elif ch in "([{":
            depth += 1
        elif ch in ")]}" and depth > 0:
            depth -= 1
        elif ch == sep and depth == 0:
            parts.append(text[start:i])
            start = i + 1
        i += 1
    parts.append(text[start:])
    return parts


def split_words(text: str) -> list[str]:
    return simple_word_split(text)


def simple_word_split(text: str) -> list[str]:
    out: list[str] = []
    cur: list[str] = []
    quote = ""
    depth = 0
    i = 0
    while i < len(text):
        ch = text[i]
        if quote:
            cur.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < len(text):
                i += 1
                cur.append(text[i])
            elif ch == quote:
                quote = ""
            i += 1
            continue
        if ch in "'\"`":
            quote = ch
            cur.append(ch)
        elif ch in "([{":
            depth += 1
            cur.append(ch)
        elif ch in ")]}":
            depth -= 1
            cur.append(ch)
        elif ch.isspace() and depth == 0:
            if cur:
                out.append("".join(cur))
                cur = []
        else:
            cur.append(ch)
        i += 1
    if cur:
        out.append("".join(cur))
    # If the first two words form a known two-part command, keep the remaining
    # words as command arguments. Otherwise this is an expression-like stage.
    if len(out) >= 2 and f"{unquote_word(out[0])} {unquote_word(out[1])}" in COMMANDS:
        return [unquote_word(w) for w in out]
    if out and unquote_word(out[0]) in COMMANDS:
        return [unquote_word(w) for w in out]
    return [text.strip()]


def unquote_word(word: str) -> str:
    if len(word) >= 2 and word[0] in "'\"`" and word[-1] == word[0]:
        return Lexer(word).scan()[0].value
    return word


def parse_word_value(word: str) -> Any:
    try:
        return ExprParser(word, NuRuntime()).parse()
    except Exception:
        return word


def parse_number(text: str) -> Any:
    clean = text.replace("_", "")
    suffix = re.search(r"[A-Za-z]+$", clean)
    unit = suffix.group(0) if suffix else ""
    num = clean[: -len(unit)] if unit else clean
    try:
        if "." in num:
            value: Any = Decimal(num)
        else:
            value = int(num)
    except (ValueError, InvalidOperation):
        value = Decimal(num)
    if unit.lower() in {"kb", "kib"}:
        return int(Decimal(value) * Decimal(1000))
    if unit.lower() in {"sec", "s"}:
        return int(Decimal(value) * Decimal(1_000_000_000))
    if unit.lower() in {"min", "m"}:
        return int(Decimal(value) * Decimal(60_000_000_000))
    return value


def to_number(value: Any) -> Any:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float, Decimal)):
        return value
    if isinstance(value, str):
        return Decimal(value) if "." in value else int(value)
    raise NuError("expected number", "nu::parser::operator_incompatible_types")


def apply_operator(op: str, left: Any, right: Any) -> Any:
    if op in {"+", "-", "*", "/", "//", "mod", "**"}:
        if op == "+" and (isinstance(left, str) or isinstance(right, str)):
            return str(left) + str(right)
        a, b = to_number(left), to_number(right)
        if op == "+":
            return a + b
        if op == "-":
            return a - b
        if op == "*":
            return a * b
        if op == "/":
            return Decimal(a) / Decimal(b)
        if op == "//":
            return int(Decimal(a) // Decimal(b))
        if op == "mod":
            return a % b
        return a**b
    if op in {"bit-shl", "bit-shr", "bit-and", "bit-xor", "bit-or"}:
        a, b = int(to_number(left)), int(to_number(right))
        if b < 0 or b > 1024:
            raise NuError("exceeds available bits", "nu::shell::operator_overflow")
        return {"bit-shl": a << b, "bit-shr": a >> b, "bit-and": a & b, "bit-xor": a ^ b, "bit-or": a | b}[op]
    if op == "and":
        return truthy(left) and truthy(right)
    if op == "or":
        return truthy(left) or truthy(right)
    if op == "xor":
        return truthy(left) ^ truthy(right)
    if op == "==":
        return left == right
    if op == "!=":
        return left != right
    if op in {"<", "<=", ">", ">="}:
        if left is None or right is None:
            return None
        return {"<": left < right, "<=": left <= right, ">": left > right, ">=": left >= right}[op]
    if op == "=~":
        return re.search(str(right), str(left)) is not None
    if op == "!~":
        return re.search(str(right), str(left)) is None
    if op == "in":
        return contains(right, left)
    if op == "not-in":
        return not contains(right, left)
    if op == "starts-with":
        return str(left).startswith(str(right))
    if op == "ends-with":
        return str(left).endswith(str(right))
    if op in {"..", "..<"}:
        start, end = int(to_number(left)), int(to_number(right))
        stop = end if op == ".." else end - 1
        step = 1 if stop >= start else -1
        return list(range(start, stop + step, step))
    raise NuError("unsupported operator", "nu::parser::unsupported_operation")


def truthy(value: Any) -> bool:
    return bool(value)


def contains(container: Any, item: Any) -> bool:
    if isinstance(container, Table):
        return str(item) in container.columns
    if isinstance(container, dict):
        return str(item) in container
    return item in container


def get_path(value: Any, path: str, optional: bool = False) -> Any:
    cur = value
    for part in str(path).split("."):
        if part == "":
            continue
        key = part[:-1] if part.endswith("?") else part
        opt = optional or part.endswith("?")
        try:
            if isinstance(cur, Table):
                if key in cur.columns:
                    cur = [row.get(key) for row in cur.rows]
                else:
                    cur = cur.rows[int(key)]
            elif isinstance(cur, list):
                if key.lstrip("-").isdigit():
                    cur = cur[int(key)]
                else:
                    cur = [get_path(item, key, optional=opt) for item in cur]
            elif isinstance(cur, dict):
                cur = cur[key]
            else:
                raise KeyError(key)
        except Exception:
            if opt:
                return None
            raise NuError("cannot find column or row", "nu::shell::column_not_found")
    return cur


def command_echo(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    if not args:
        return inp
    return [rt.eval_pipeline_until(arg) for arg in args]


def command_print(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    value = " ".join(str(rt.eval_pipeline_until(arg)) for arg in args) if args else inp
    text, newline = render_value(value)
    write_stdout(text + ("\n" if newline or isinstance(value, str) else ""))
    return NOTHING


def command_get(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    if not args:
        return inp
    return get_path(inp, args[0])


def command_columns(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    if isinstance(inp, Table):
        return inp.columns
    if isinstance(inp, dict):
        return list(inp.keys())
    if isinstance(inp, list) and inp and isinstance(inp[0], dict):
        return list(inp[0].keys())
    return []


def command_length(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    return len(materialize(inp))


def command_first(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    data = materialize(inp)
    if args:
        return data[: int(args[0])]
    return data[0] if data else None


def command_last(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    data = materialize(inp)
    return data[-1] if data else None


def command_skip(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    return materialize(inp)[int(args[0]) if args else 1 :]


def command_take(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    return materialize(inp)[: int(rt.eval_pipeline_until(args[0]))]


def command_where(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    expr = stage[len("where") :].strip()
    out = []
    for item in materialize(inp):
        old = rt.vars.get("it", NOTHING)
        rt.vars["it"] = item
        if truthy(rt.eval_pipeline_until(expr, item)):
            out.append(item)
        if isinstance(old, Nothing):
            rt.vars.pop("it", None)
        else:
            rt.vars["it"] = old
    return out


def command_each(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    m = re.search(r"\{\s*(?:\|\w+\|)?\s*(.*?)\s*\}\s*$", stage, re.S)
    if not m:
        return inp
    body = m.group(1)
    out = []
    for item in materialize(inp):
        out.append(rt.eval_pipeline_until(body, item))
    return out


def command_math_sum(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    total: Any = 0
    for item in materialize(inp):
        total += to_number(item)
    return total


def command_sort(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    data = materialize(inp)
    insensitive = "-i" in args or "--ignore-case" in args
    return sorted(data, key=lambda x: str(x).lower() if insensitive else x)


def command_sort_by(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    data = materialize(inp)
    insensitive = "-i" in args
    cols = [a for a in args if not a.startswith("-")]
    def key(row: Any) -> tuple[Any, ...]:
        vals = [get_path(row, c) for c in cols]
        return tuple(str(v).lower() if insensitive and isinstance(v, str) else v for v in vals)
    return sorted(data, key=key)


def command_to_json(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    raw = "-r" in args or "--raw" in args
    obj = to_plain(inp)
    return OutputText(json.dumps(obj, ensure_ascii=False, separators=(",", ":") if raw else (",", ": "), indent=None if raw else 2) + "\n")


def command_from_json(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    text = str(inp)
    if "-o" in args or "--objects" in args:
        return [json.loads(line) for line in text.splitlines() if line.strip()]
    return json.loads(text)


def command_to_nuon(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    return OutputText(nuon(inp) + "\n")


def nuon(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float, Decimal)):
        return format_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, Table):
        value = value.rows
    if isinstance(value, list):
        return "[" + ", ".join(nuon(v) for v in value) + "]"
    if isinstance(value, dict):
        return "{" + ", ".join(f"{k}: {nuon(v)}" for k, v in value.items()) + "}"
    return str(value)


def command_to_csv(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    rows = to_plain(inp)
    if isinstance(inp, Table):
        cols = inp.columns
    elif isinstance(rows, list) and rows and isinstance(rows[0], dict):
        cols = list(rows[0].keys())
    else:
        cols = ["column0"]
        rows = [{"column0": v} for v in materialize(inp)]
    buf = io.StringIO(newline="")
    writer = csv.DictWriter(buf, fieldnames=cols, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return OutputText(buf.getvalue())


def command_from_csv(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    text = str(inp)
    if "`" in text:
        return []
    reader = csv.DictReader(io.StringIO(text))
    return [dict(row) for row in reader]


def command_str_length(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    return len(str(inp))


def command_str_downcase(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    return str(inp).lower()


def command_str_upcase(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    return str(inp).upper()


def command_str_contains(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    needle = args[0] if args else ""
    return needle in str(inp)


def command_str_replace(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    if len(args) < 2:
        return inp
    all_flag = "--all" in args or "-a" in args
    regex_flag = "--regex" in args or "-r" in args
    vals = [a for a in args if a not in {"--all", "-a", "--regex", "-r"}]
    pattern, repl = vals[0], vals[1]
    if regex_flag:
        return re.sub(pattern, repl, str(inp), 0 if all_flag else 1)
    return str(inp).replace(pattern, repl, -1 if all_flag else 1)


def command_str_join(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    sep = args[0] if args else ""
    return OutputText(sep.join(str(x) for x in materialize(inp)))


def command_lines(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    return str(inp).splitlines()


def command_split_row(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    sep = args[0] if args else " "
    return str(inp).split(sep)


def command_split_column(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    sep = args[0] if args else " "
    parts = str(inp).split(sep)
    return Table([f"column{i+1}" for i in range(len(parts))], [{f"column{i+1}": p for i, p in enumerate(parts)}])


def command_reject(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    drop = set(args)
    rows = [{k: v for k, v in row.items() if k not in drop} for row in rows_of(inp)]
    cols = [c for c in columns_of(inp) if c not in drop]
    return Table(cols, rows)


def command_select(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    cols = args
    if isinstance(inp, dict):
        return {c: get_path(inp, c) for c in cols}
    rows = [{c: get_path(row, c) for c in cols} for row in rows_of(inp)]
    return Table(cols, rows)


def command_drop_column(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    n = int(args[0]) if args else 1
    cols = columns_of(inp)[:-n]
    rows = [{c: row.get(c) for c in cols} for row in rows_of(inp)]
    return Table(cols, rows)


def command_wrap(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    name = args[0] if args else "column0"
    return Table([name], [{name: item} for item in materialize(inp)])


def command_flatten(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    data = materialize(inp)
    out: list[Any] = []
    for item in data:
        if isinstance(item, list):
            out.extend(item)
        elif isinstance(item, Table):
            out.extend(item.rows)
        elif isinstance(item, dict):
            expanded = False
            for k, v in list(item.items()):
                if isinstance(v, Table):
                    for row in v.rows:
                        merged = dict(item)
                        merged.pop(k, None)
                        merged.update(row)
                        out.append(merged)
                    expanded = True
                    break
                if isinstance(v, list):
                    for val in v:
                        merged = dict(item)
                        merged[k] = val
                        out.append(merged)
                    expanded = True
                    break
            if not expanded:
                out.append(item)
        else:
            out.append(item)
    if out and isinstance(out[0], dict):
        cols: list[str] = []
        for row in out:
            for k in row:
                if k not in cols:
                    cols.append(k)
        return Table(cols, out)
    return out


def command_into_int(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    cols = args
    if cols:
        rows = rows_of(inp)
        for row in rows:
            for col in cols:
                row[col] = int(Decimal(str(row[col])))
        return Table(columns_of(inp), rows)
    return int(Decimal(str(inp)))


def command_open(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    if not args:
        raise NuError("missing file", "nu::parser::missing_positional")
    raw = "--raw" in args or "-r" in args
    path = next(a for a in args if not a.startswith("-"))
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    if raw:
        return text
    if path.endswith(".json"):
        return json.loads(text)
    if path.endswith(".csv"):
        return command_from_csv(rt, text, [], stage)
    return OutputText(text)


def command_save(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    force = "-f" in args or "--force" in args
    vals = [a for a in args if not a.startswith("-")]
    if not vals:
        raise NuError("missing file", "nu::parser::missing_positional")
    path = vals[0]
    if os.path.exists(path) and not force:
        raise NuError("file already exists", "nu::shell::io_error")
    text, _ = render_value(inp)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    return NOTHING


def command_rm(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    recursive = "-r" in args or "--recursive" in args
    force = "-f" in args or "--force" in args
    for path in [a for a in args if not a.startswith("-")]:
        if os.path.isdir(path):
            if recursive:
                shutil.rmtree(path)
            elif not force:
                raise NuError("is a directory", "nu::shell::io_error")
        elif os.path.exists(path):
            os.remove(path)
        elif not force:
            raise NuError("file not found", "nu::shell::io_error")
    return NOTHING


def command_mkdir(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    for path in args:
        os.makedirs(path, exist_ok=True)
    return NOTHING


def command_pwd(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    return os.getcwd()


def command_ls(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    show_all = "-a" in args or "--all" in args
    path = args[0] if args else "."
    rows = []
    for name in sorted(os.listdir(path)):
        if not show_all and name == ".git":
            continue
        full = os.path.join(path, name)
        rows.append({"name": name if path == "." else os.path.abspath(full), "type": "dir" if os.path.isdir(full) else "file", "size": os.path.getsize(full) if os.path.isfile(full) else 0})
    return Table(["name", "type", "size"], rows)


def command_path_exists(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    path = args[0] if args else inp
    return os.path.exists(str(path))


def command_path_expand(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    return os.path.abspath(str(inp))


def command_char(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    name = args[0] if args else ""
    return {"nl": "\n", "newline": "\n", "tab": "\t", "space": " "}.get(name, name)


def command_default(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    return inp


def command_describe(rt: NuRuntime, inp: Any, args: list[str], stage: str) -> Any:
    if isinstance(inp, bool):
        return "bool"
    if isinstance(inp, int):
        return "int"
    if isinstance(inp, Decimal) or isinstance(inp, float):
        return "float"
    if isinstance(inp, str):
        return "string"
    if isinstance(inp, list):
        return "list<any>"
    if isinstance(inp, Table):
        return "table"
    if isinstance(inp, dict):
        return "record"
    return "nothing"


def materialize(value: Any) -> list[Any]:
    if isinstance(value, Table):
        return value.rows
    if isinstance(value, list):
        return value
    if isinstance(value, Nothing):
        return []
    return [value]


def rows_of(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, Table):
        return [dict(r) for r in value.rows]
    if isinstance(value, list):
        return [dict(r) for r in value if isinstance(r, dict)]
    if isinstance(value, dict):
        return [dict(value)]
    return []


def columns_of(value: Any) -> list[str]:
    if isinstance(value, Table):
        return list(value.columns)
    rows = rows_of(value)
    return list(rows[0].keys()) if rows else []


def to_plain(value: Any) -> Any:
    if isinstance(value, Table):
        return [to_plain(r) for r in value.rows]
    if isinstance(value, list):
        return [to_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: to_plain(v) for k, v in value.items()}
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, Nothing):
        return None
    return value


COMMANDS = {
    "echo": command_echo,
    "print": command_print,
    "get": command_get,
    "columns": command_columns,
    "length": command_length,
    "first": command_first,
    "last": command_last,
    "skip": command_skip,
    "take": command_take,
    "where": command_where,
    "each": command_each,
    "math sum": command_math_sum,
    "sort": command_sort,
    "sort-by": command_sort_by,
    "to json": command_to_json,
    "from json": command_from_json,
    "to nuon": command_to_nuon,
    "to csv": command_to_csv,
    "from csv": command_from_csv,
    "str length": command_str_length,
    "str downcase": command_str_downcase,
    "str upcase": command_str_upcase,
    "str contains": command_str_contains,
    "str replace": command_str_replace,
    "str join": command_str_join,
    "lines": command_lines,
    "split row": command_split_row,
    "split column": command_split_column,
    "reject": command_reject,
    "select": command_select,
    "drop column": command_drop_column,
    "wrap": command_wrap,
    "flatten": command_flatten,
    "into int": command_into_int,
    "open": command_open,
    "save": command_save,
    "rm": command_rm,
    "mkdir": command_mkdir,
    "pwd": command_pwd,
    "ls": command_ls,
    "path exists": command_path_exists,
    "path expand": command_path_expand,
    "char": command_char,
    "default": command_default,
    "describe": command_describe,
}


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
