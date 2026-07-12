#!/usr/bin/env python3
"""A dependency-free Python implementation of the benchmark Nushell surface."""

from __future__ import annotations

from dataclasses import dataclass
import csv
import glob as globlib
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import sys
from typing import Any, Callable, Iterable


class Nothing:
    pass


NOTHING = Nothing()


@dataclass
class RangeValue:
    start: int
    end: int | None
    inclusive: bool = True
    step: int | None = None

    def values(self, limit: int | None = None) -> list[int]:
        step = self.step or (1 if self.end is None or self.end >= self.start else -1)
        if self.end is None:
            count = limit or 100000
            return [self.start + step * i for i in range(count)]
        stop = self.end + (step if self.inclusive else 0)
        return list(range(self.start, stop, step))


@dataclass
class RawText:
    value: str


@dataclass
class Closure:
    params: list[str]
    body: list["Token"]
    env: "Env"


@dataclass
class Token:
    kind: str
    text: str
    start: int
    end: int


class NuError(Exception):
    def __init__(self, kind: str, message: str, span: tuple[int, int] = (0, 1), help_text: str = "", status: int = 1):
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.span = span
        self.help_text = help_text
        self.status = status


class ExitShell(Exception):
    def __init__(self, status: int):
        self.status = status


class Env:
    def __init__(self, parent: "Env | None" = None):
        self.parent = parent
        self.values: dict[str, Any] = {}

    def get(self, name: str) -> Any:
        if name in self.values:
            return self.values[name]
        if self.parent:
            return self.parent.get(name)
        if name == "env":
            return dict(os.environ)
        raise NuError("nu::shell::variable_not_found", f"Variable ${name} not found.")

    def set(self, name: str, value: Any, update: bool = False) -> None:
        if update and name not in self.values and self.parent:
            self.parent.set(name, value, True)
        else:
            self.values[name] = value


OPERATORS = ["..<", "...", "**", "//", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "++", "=~", "!~", ".."]
PUNCT = set("[]{}();,:|.+-*/%<>=")


def lex(source: str) -> list[Token]:
    out: list[Token] = []
    i = 0
    while i < len(source):
        c = source[i]
        if c.isspace():
            if c == "\n":
                out.append(Token(";", ";", i, i + 1))
            i += 1
            continue
        if c == "#":
            while i < len(source) and source[i] != "\n":
                i += 1
            continue
        if c in "'\"`":
            quote, start = c, i
            i += 1
            chars: list[str] = []
            while i < len(source) and source[i] != quote:
                if quote == '"' and source[i] == "\\" and i + 1 < len(source):
                    escapes = {"n": "\n", "r": "\r", "t": "\t", "\\": "\\", '"': '"'}
                    chars.append(escapes.get(source[i + 1], source[i + 1]))
                    i += 2
                else:
                    chars.append(source[i])
                    i += 1
            if i >= len(source):
                raise NuError("nu::parser::unclosed_delimiter", "Unclosed delimiter.", (start, len(source)))
            i += 1
            out.append(Token("string", "".join(chars), start, i))
            continue
        if c == "$":
            start = i
            i += 1
            while i < len(source) and (source[i].isalnum() or source[i] in "_-?"):
                i += 1
            out.append(Token("var", source[start + 1 : i], start, i))
            continue
        if c.isdigit():
            start = i
            while i < len(source) and (source[i].isdigit() or source[i] == "_"):
                i += 1
            if i < len(source) and source[i] == "." and i + 1 < len(source) and source[i + 1].isdigit():
                i += 1
                while i < len(source) and (source[i].isdigit() or source[i] == "_"):
                    i += 1
            out.append(Token("number", source[start:i], start, i))
            continue
        if c == "-" and i + 1 < len(source) and (source[i + 1].isalpha() or source[i + 1] == "-") and (
            i == 0 or source[i - 1].isspace() or source[i - 1] in "[{(|;,"
        ):
            start = i
            i += 1
            while i < len(source) and (source[i].isalnum() or source[i] in "_-"):
                i += 1
            out.append(Token("word", source[start:i], start, i))
            continue
        matched = next((op for op in OPERATORS if source.startswith(op, i)), None)
        if matched:
            out.append(Token("op", matched, i, i + len(matched)))
            i += len(matched)
            continue
        if c in PUNCT:
            out.append(Token(c, c, i, i + 1))
            i += 1
            continue
        start = i
        while i < len(source) and not source[i].isspace() and (source[i] not in PUNCT or source[i] == "-") and source[i] not in "'\"`#$":
            i += 1
        text = source[start:i]
        kind = "number" if re.fullmatch(r"(?:\d+(?:_\d+)*)(?:\.\d+)?", text) else "word"
        out.append(Token(kind, text, start, i))
    out.append(Token("eof", "", len(source), len(source)))
    return out


def split_top(tokens: list[Token], separator: str) -> list[list[Token]]:
    parts: list[list[Token]] = [[]]
    depth = 0
    for tok in tokens:
        if tok.kind == "eof":
            continue
        if tok.kind in ("[", "{", "("):
            depth += 1
        elif tok.kind in ("]", "}", ")"):
            depth -= 1
        if tok.kind == separator and depth == 0:
            parts.append([])
        else:
            parts[-1].append(tok)
    return [part for part in parts if part]


class Parser:
    PRECEDENCE = {
        "or": 1,
        "xor": 1,
        "and": 2,
        "==": 3,
        "!=": 3,
        "<": 3,
        "<=": 3,
        ">": 3,
        ">=": 3,
        "in": 3,
        "not-in": 3,
        "=~": 3,
        "!~": 3,
        "..": 4,
        "..<": 4,
        "++": 5,
        "+": 6,
        "-": 6,
        "*": 7,
        "/": 7,
        "//": 7,
        "mod": 7,
        "%": 7,
        "**": 8,
    }

    def __init__(self, tokens: list[Token], env: Env):
        self.tokens = tokens + ([Token("eof", "", 0, 0)] if not tokens or tokens[-1].kind != "eof" else [])
        self.pos = 0
        self.env = env

    def peek(self, text: str | None = None) -> Token | bool:
        token = self.tokens[min(self.pos, len(self.tokens) - 1)]
        return token.text == text or token.kind == text if text is not None else token

    def take(self, text: str | None = None) -> Token:
        token = self.tokens[min(self.pos, len(self.tokens) - 1)]
        if text is not None and token.text != text and token.kind != text:
            raise NuError("nu::parser::parse_mismatch", f"Expected {text}.", (token.start, token.end))
        self.pos += 1
        return token

    def done(self) -> bool:
        return self.peek("eof") or self.pos >= len(self.tokens)

    def expression(self, minimum: int = 0) -> Any:
        left = self.prefix()
        while not self.done():
            tok = self.peek()
            assert isinstance(tok, Token)
            op = tok.text
            if op == ".":
                self.take()
                member = self.take()
                left = access(left, int(member.text) if member.text.isdigit() else member.text, (member.start, member.end))
                continue
            precedence = self.PRECEDENCE.get(op)
            if precedence is None or precedence < minimum:
                break
            self.take()
            if self.done():
                raise NuError("nu::parser::incomplete_math_expression", "Incomplete math expression.", (tok.start, tok.end))
            right = self.expression(precedence + (0 if op == "**" else 1))
            left = binary(op, left, right, (tok.start, tok.end))
        return left

    def prefix(self) -> Any:
        tok = self.take()
        if tok.kind == "number":
            text = tok.text.replace("_", "")
            return float(text) if "." in text else int(text)
        if tok.kind == "string":
            return tok.text
        if tok.kind == "var":
            value = self.env.get(tok.text)
            return value
        if tok.text in ("true", "false"):
            return tok.text == "true"
        if tok.text in ("null", "nothing"):
            return NOTHING
        if tok.text in ("not", "!"):
            return not truthy(self.expression(9))
        if tok.text == "-":
            return -self.expression(9)
        if tok.text == "+":
            return +self.expression(9)
        if tok.text == "(":
            value = self.expression()
            self.take(")")
            return value
        if tok.text == "[":
            return self.list_or_table()
        if tok.text == "{":
            return self.record_or_closure(tok)
        if tok.text == "if":
            condition = self.expression()
            yes = self.take_block()
            no: list[Token] = []
            if self.peek("else"):
                self.take()
                no = self.take_block()
            return Evaluator(self.env).eval_tokens(yes if truthy(condition) else no)
        if tok.kind == "word":
            return tok.text
        if tok.text in (",", ";"):
            return tok.text
        raise NuError("nu::parser::unexpected_keyword", f"Unexpected token {tok.text}.", (tok.start, tok.end))

    def list_or_table(self) -> Any:
        rows: list[Any] = []
        while not self.peek("]"):
            if self.done():
                raise NuError("nu::parser::unclosed_delimiter", "Unclosed delimiter.")
            if self.peek(",") or self.peek(";"):
                self.take()
                continue
            rows.append(self.expression())
        self.take("]")
        if rows and isinstance(rows[0], list) and all(isinstance(row, list) for row in rows):
            headers = [plain_string(x) for x in rows[0]]
            return [{key: row[i] if i < len(row) else NOTHING for i, key in enumerate(headers)} for row in rows[1:]]
        return rows

    def record_or_closure(self, opening: Token) -> Any:
        if self.peek("|"):
            self.take()
            params = []
            while not self.peek("|"):
                param = self.take()
                params.append(param.text.lstrip("$"))
            self.take("|")
            body = self.collect_until_close("}")
            return Closure(params, body, self.env)
        start_pos = self.pos
        depth = 0
        has_colon = False
        for item in self.tokens[self.pos :]:
            if item.text in ("[", "{", "("):
                depth += 1
            elif item.text in ("]", "}", ")"):
                if item.text == "}" and depth == 0:
                    break
                depth -= 1
            elif item.text == ":" and depth == 0:
                has_colon = True
                break
        if not has_colon:
            self.pos = start_pos
            return Closure([], self.collect_until_close("}"), self.env)
        record: dict[str, Any] = {}
        while not self.peek("}"):
            if self.peek(","):
                self.take()
                continue
            key = self.take()
            self.take(":")
            record[key.text] = self.expression()
        self.take("}")
        return record

    def collect_until_close(self, close: str) -> list[Token]:
        body: list[Token] = []
        depth = 0
        while not self.done():
            token = self.take()
            if token.text == close and depth == 0:
                return body
            if token.text in ("[", "{", "("):
                depth += 1
            elif token.text in ("]", "}", ")"):
                depth -= 1
            body.append(token)
        raise NuError("nu::parser::unclosed_delimiter", "Unclosed delimiter.")

    def take_block(self) -> list[Token]:
        self.take("{")
        return self.collect_until_close("}")


def truthy(value: Any) -> bool:
    return False if value is NOTHING else bool(value)


def plain_string(value: Any) -> str:
    if value is NOTHING:
        return ""
    if isinstance(value, RawText):
        return value.value
    if value is True:
        return "true"
    if value is False:
        return "false"
    return str(value)


def expand(value: Any, limit: int | None = None) -> Any:
    return value.values(limit) if isinstance(value, RangeValue) else value


def access(value: Any, member: str | int, span: tuple[int, int] = (0, 1)) -> Any:
    value = expand(value)
    if isinstance(member, int):
        if not isinstance(value, (list, str)) or member >= len(value) or member < -len(value):
            maximum = len(value) - 1 if isinstance(value, (list, str)) else 0
            raise NuError("nu::shell::access_beyond_end", f"Row number too large (max: {maximum}).", span)
        return value[member]
    if isinstance(value, dict):
        if member not in value:
            raise NuError("nu::shell::column_not_found", f"Cannot find column '{member}'.", span)
        return value[member]
    if isinstance(value, list):
        return [access(item, member, span) for item in value]
    raise NuError("nu::shell::incompatible_path_access", f"Data cannot be accessed with a cell path.", span)


def binary(op: str, left: Any, right: Any, span: tuple[int, int]) -> Any:
    left, right = expand(left), expand(right)
    try:
        if op == "+": return left + right
        if op == "-": return left - right
        if op == "*": return left * right
        if op == "/":
            if right == 0: raise ZeroDivisionError
            return left / right
        if op == "//":
            if right == 0: raise ZeroDivisionError
            return left // right
        if op in ("mod", "%"):
            if right == 0: raise ZeroDivisionError
            return left % right
        if op == "**": return left ** right
        if op == "==": return left == right
        if op == "!=": return left != right
        if op == "<": return left < right
        if op == "<=": return left <= right
        if op == ">": return left > right
        if op == ">=": return left >= right
        if op == "and": return truthy(left) and truthy(right)
        if op == "or": return truthy(left) or truthy(right)
        if op == "xor": return bool(truthy(left)) ^ bool(truthy(right))
        if op == "in": return left in right
        if op == "not-in": return left not in right
        if op == "=~": return re.search(str(right), str(left)) is not None
        if op == "!~": return re.search(str(right), str(left)) is None
        if op == "++": return left + right
        if op in ("..", "..<"):
            return RangeValue(int(left), int(right), op == "..")
    except ZeroDivisionError:
        raise NuError("nu::shell::division_by_zero", "Division by zero.", span) from None
    except (TypeError, ValueError) as error:
        raise NuError("nu::shell::type_mismatch", str(error), span) from None
    raise NuError("nu::parser::unsupported_operation", f"Unsupported operation {op}.", span)


class Evaluator:
    def __init__(self, env: Env | None = None):
        self.env = env or Env()

    def evaluate(self, source: str) -> Any:
        return self.eval_tokens(lex(source), source)

    def eval_tokens(self, tokens: list[Token], source: str = "") -> Any:
        statements = split_top(tokens, ";")
        result: Any = NOTHING
        for statement in statements:
            result = self.eval_pipeline(statement, source)
        return result

    def eval_pipeline(self, tokens: list[Token], source: str = "") -> Any:
        segments = split_top(tokens, "|")
        if not segments:
            return NOTHING
        value = self.eval_head(segments[0], source)
        for segment in segments[1:]:
            value = self.run_command(segment, value, source)
        return value

    def eval_head(self, tokens: list[Token], source: str) -> Any:
        if not tokens:
            return NOTHING
        first = tokens[0].text
        if first in ("let", "mut", "const"):
            if len(tokens) < 4 or tokens[2].text != "=":
                raise NuError("nu::parser::assignment_requires_variable", "Assignment requires a variable.")
            name = tokens[1].text
            value = self.eval_pipeline(tokens[3:], source)
            self.env.set(name, value)
            return NOTHING
        if len(tokens) >= 3 and tokens[0].kind == "var" and tokens[1].text in ("=", "+=", "-=", "*=", "/="):
            name, op = tokens[0].text, tokens[1].text
            right = self.eval_pipeline(tokens[2:], source)
            value = right if op == "=" else binary(op[0], self.env.get(name), right, (tokens[1].start, tokens[1].end))
            self.env.set(name, value, True)
            return NOTHING
        command = command_name(tokens)
        if command in COMMANDS or first in ("echo", "print", "exit", "error", "open", "ls", "glob", "pwd", "cd", "mkdir", "touch", "rm", "cp", "mv", "save"):
            return self.run_command(tokens, NOTHING, source)
        if tokens[0].kind == "word" and first not in ("true", "false", "null", "nothing", "not", "if"):
            raise NuError(
                "nu::shell::external_command",
                f"External command failed",
                (tokens[0].start, tokens[0].end),
                f"`{first}` is neither a Nushell built-in or a known external command",
            )
        parser = Parser(tokens, self.env)
        value = parser.expression()
        if not parser.done():
            token = parser.peek()
            assert isinstance(token, Token)
            raise NuError("nu::shell::external_command", f"Command `{tokens[0].text}` not found", (tokens[0].start, tokens[0].end))
        return value

    def run_command(self, tokens: list[Token], input_value: Any, source: str) -> Any:
        if not tokens:
            return input_value
        name = command_name(tokens)
        consumed = len(name.split())
        args_tokens = tokens[consumed:]
        if name not in COMMANDS:
            first = tokens[0]
            raise NuError(
                "nu::shell::external_command",
                f"Command `{first.text}` not found",
                (first.start, first.end),
                f"`{first.text}` is neither a Nushell built-in or a known external command",
            )
        return COMMANDS[name](self, input_value, args_tokens, source)

    def args(self, tokens: list[Token]) -> tuple[list[Any], set[str], dict[str, Any]]:
        positional: list[Any] = []
        switches: set[str] = set()
        named: dict[str, Any] = {}
        parser = Parser(tokens, self.env)
        while not parser.done():
            token = parser.peek()
            assert isinstance(token, Token)
            if token.text.startswith("-") and token.kind == "word":
                flag = parser.take().text
                switches.add(flag)
                continue
            positional.append(parser.expression())
        return positional, switches, named

    def call_closure(self, closure: Closure, item: Any, index: int = 0) -> Any:
        local = Env(closure.env)
        local.set("in", item)
        local.set("it", item)
        if closure.params:
            local.set(closure.params[0], item)
        if len(closure.params) > 1:
            local.set(closure.params[1], index)
        return Evaluator(local).eval_tokens(closure.body)


def command_name(tokens: list[Token]) -> str:
    if not tokens:
        return ""
    pairs = {"to", "from", "str", "math", "split", "path", "into", "error"}
    if tokens[0].text in pairs and len(tokens) > 1:
        return tokens[0].text + " " + tokens[1].text
    return tokens[0].text


def get_args(ev: Evaluator, tokens: list[Token]) -> tuple[list[Any], set[str]]:
    values: list[Any] = []
    flags: set[str] = set()
    parser = Parser(tokens, ev.env)
    while not parser.done():
        token = parser.peek()
        assert isinstance(token, Token)
        if token.text.startswith("-") and token.kind == "word":
            flags.add(parser.take().text)
        else:
            values.append(parser.expression())
    return values, flags


def cmd_echo(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    if not args:
        return NOTHING
    return args[0] if len(args) == 1 else args


def cmd_print(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, flags = get_args(ev, tokens)
    text = " ".join(plain_string(v) for v in args)
    end = "" if ("-n" in flags or "--no-newline" in flags) else "\n"
    sys.stdout.write(text + end)
    return NOTHING


def sequence(value: Any) -> list[Any]:
    value = expand(value)
    if isinstance(value, list):
        return value
    if value is NOTHING:
        return []
    return [value]


def cmd_each(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    if not args or not isinstance(args[0], Closure):
        raise NuError("nu::shell::missing_parameter", "Missing closure.")
    return [ev.call_closure(args[0], item, i) for i, item in enumerate(sequence(inp))]


def closure_or_predicate(ev: Evaluator, tokens: list[Token], item: Any, index: int) -> bool:
    parser = Parser(tokens, Env(ev.env))
    parser.env.set("it", item)
    parser.env.set("in", item)
    if tokens and tokens[0].kind == "word" and isinstance(item, dict) and tokens[0].text in item:
        parser.env.set(tokens[0].text, item[tokens[0].text])
        tokens = [Token("var", tokens[0].text, tokens[0].start, tokens[0].end)] + tokens[1:]
        parser = Parser(tokens, parser.env)
    value = parser.expression()
    return truthy(ev.call_closure(value, item, index) if isinstance(value, Closure) else value)


def cmd_where(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    return [item for i, item in enumerate(sequence(inp)) if closure_or_predicate(ev, tokens, item, i)]


def cmd_get(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    flags = {token.text for token in tokens if token.text in ("-o", "--optional")}
    value = inp
    path_tokens = [token for token in tokens if token.text not in flags]
    if not path_tokens:
        return value
    path_text = "".join(token.text for token in path_tokens)
    members: list[str | int] = [int(member) if member.lstrip("-").isdigit() else member for member in path_text.split(".")]
    try:
        for member in members:
            value = access(value, member, (path_tokens[0].start, path_tokens[-1].end))
        return value
    except NuError:
        if "-o" in flags or "--optional" in flags:
            return NOTHING
        raise


def cmd_select(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    rows = sequence(inp)
    return [{str(k): access(row, str(k)) for k in args} for row in rows]


def cmd_reject(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    keys = {str(v) for v in args}
    rows = sequence(inp)
    result = [{k: v for k, v in row.items() if k not in keys} for row in rows]
    return result if isinstance(expand(inp), list) else result[0]


def cmd_length(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    value = expand(inp)
    return len(value) if isinstance(value, (list, dict, str, bytes)) else 1


def cmd_first(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    values = sequence(inp)
    count = int(args[0]) if args else None
    return values[:count] if count is not None else (values[0] if values else NOTHING)


def cmd_last(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    values = sequence(inp)
    count = int(args[0]) if args else None
    return values[-count:] if count is not None else (values[-1] if values else NOTHING)


def cmd_sort(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, flags = get_args(ev, tokens)
    return sorted(sequence(inp), reverse="-r" in flags or "--reverse" in flags)


def cmd_sort_by(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, flags = get_args(ev, tokens)
    keys = [str(a) for a in args]
    return sorted(sequence(inp), key=lambda row: tuple(access(row, key) for key in keys), reverse="-r" in flags)


def freeze(value: Any) -> Any:
    if isinstance(value, dict): return tuple((k, freeze(v)) for k, v in value.items())
    if isinstance(value, list): return tuple(freeze(v) for v in value)
    return value


def cmd_uniq(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    result, seen = [], set()
    for value in sequence(inp):
        key = freeze(value)
        if key not in seen:
            seen.add(key)
            result.append(value)
    return result


def cmd_reverse(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    return list(reversed(sequence(inp))) if not isinstance(inp, str) else inp[::-1]


def cmd_append(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    return sequence(inp) + args


def cmd_prepend(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    return args + sequence(inp)


def cmd_flatten(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    out = []
    for item in sequence(inp):
        out.extend(item if isinstance(item, list) else [item])
    return out


def cmd_compact(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    return [v for v in sequence(inp) if v is not NOTHING]


def cmd_enumerate(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    return [{"index": i, "item": v} for i, v in enumerate(sequence(inp))]


def cmd_lines(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    return plain_string(inp).splitlines()


def cmd_columns(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    value = expand(inp)
    record = value[0] if isinstance(value, list) and value else value
    return list(record.keys()) if isinstance(record, dict) else []


def cmd_values(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    value = expand(inp)
    if isinstance(value, dict): return list(value.values())
    if isinstance(value, list) and all(isinstance(row, dict) for row in value):
        return [list(row.values()) for row in value]
    return sequence(value)


def cmd_take(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    return sequence(inp)[: int(args[0]) if args else 1]


def cmd_skip(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    return sequence(inp)[int(args[0]) if args else 1 :]


def cmd_drop(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    count = int(args[0]) if args else 1
    return sequence(inp)[:-count] if count else sequence(inp)


def cmd_default(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    replacement = args[0] if args else NOTHING
    return replacement if inp is NOTHING else inp


def jsonable(value: Any) -> Any:
    if value is NOTHING: return None
    if isinstance(value, RangeValue): return [jsonable(v) for v in value.values()]
    if isinstance(value, RawText): return value.value
    if isinstance(value, list): return [jsonable(v) for v in value]
    if isinstance(value, dict): return {k: jsonable(v) for k, v in value.items()}
    return value


def cmd_to_json(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, flags = get_args(ev, tokens)
    raw = "-r" in flags or "--raw" in flags
    if raw:
        text = json.dumps(jsonable(inp), ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(jsonable(inp), ensure_ascii=False, indent=2)
    return text if raw else RawText(text + "\n")


def cmd_from_json(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    text = inp.value if isinstance(inp, RawText) else plain_string(inp)
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        raise NuError("nu::shell::cant_convert", f"Could not parse as JSON: {error.msg}.") from None


def csv_rows(value: Any) -> tuple[list[str], list[list[Any]]]:
    values = sequence(value)
    if not values:
        return [], []
    if isinstance(values[0], dict):
        headers: list[str] = []
        for row in values:
            for key in row:
                if key not in headers: headers.append(key)
        return headers, [[row.get(key, NOTHING) for key in headers] for row in values]
    return ["value"], [[v] for v in values]


def cmd_to_csv(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, flags = get_args(ev, tokens)
    separator = ","
    for i, token in enumerate(tokens):
        if token.text in ("-s", "--separator") and i + 1 < len(tokens): separator = tokens[i + 1].text
    headers, rows = csv_rows(inp)
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, delimiter=separator, lineterminator="\n")
    if "-n" not in flags and "--noheaders" not in flags: writer.writerow(headers)
    for row in rows: writer.writerow([plain_string(v) for v in row])
    return RawText(stream.getvalue())


def auto_value(text: str) -> Any:
    low = text.lower()
    if low == "true": return True
    if low == "false": return False
    if low == "null": return NOTHING
    if re.fullmatch(r"[-+]?\d+", text): return int(text)
    if re.fullmatch(r"[-+]?(?:\d+\.\d*|\d*\.\d+)", text): return float(text)
    return text


def cmd_from_csv(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    separator = ","
    args, flags = get_args(ev, tokens)
    for i, token in enumerate(tokens):
        if token.text in ("-s", "--separator") and i + 1 < len(tokens): separator = tokens[i + 1].text
    text = inp.value if isinstance(inp, RawText) else plain_string(inp)
    rows = list(csv.reader(io.StringIO(text), delimiter=separator))
    if not rows: return []
    if "-n" in flags or "--noheaders" in flags:
        headers = [f"column{i}" for i in range(1, len(rows[0]) + 1)]
        data = rows
    else:
        headers, data = rows[0], rows[1:]
    return [{key: auto_value(row[i]) if i < len(row) else NOTHING for i, key in enumerate(headers)} for row in data]


def map_strings(value: Any, function: Callable[[str], Any]) -> Any:
    if isinstance(value, list): return [map_strings(v, function) for v in value]
    return function(plain_string(value))


def cmd_str_downcase(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    return map_strings(inp, str.lower)


def cmd_str_upcase(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    return map_strings(inp, str.upper)


def cmd_str_trim(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    return map_strings(inp, str.strip)


def cmd_str_length(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    return map_strings(inp, len)


def cmd_str_replace(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, flags = get_args(ev, tokens)
    old, new = plain_string(args[0]), plain_string(args[1])
    count = -1 if "-a" in flags or "--all" in flags else 1
    return map_strings(inp, lambda value: value.replace(old, new, count))


def cmd_str_contains(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    needle = plain_string(args[0])
    return map_strings(inp, lambda value: needle in value)


def cmd_str_starts_with(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    return map_strings(inp, lambda value: value.startswith(plain_string(args[0])))


def cmd_str_ends_with(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    return map_strings(inp, lambda value: value.endswith(plain_string(args[0])))


def cmd_str_reverse(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    return map_strings(inp, lambda value: value[::-1])


def cmd_str_capitalize(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    return map_strings(inp, str.capitalize)


def cmd_str_index_of(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    return map_strings(inp, lambda value: value.find(plain_string(args[0])))


def cmd_str_join(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    separator = plain_string(args[0]) if args else ""
    return RawText(separator.join(plain_string(v) for v in sequence(inp)))


def cmd_split_row(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    return plain_string(inp).split(plain_string(args[0]))


def cmd_split_column(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    separator = plain_string(args[0])
    names = [plain_string(v) for v in args[1:]]
    pieces = plain_string(inp).split(separator)
    if not names: names = [f"column{i}" for i in range(1, len(pieces) + 1)]
    return {name: pieces[i] if i < len(pieces) else NOTHING for i, name in enumerate(names)}


def cmd_str_substring(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    spec = args[0]
    if isinstance(spec, RangeValue):
        end = spec.end + 1 if spec.end is not None and spec.inclusive else spec.end
        return map_strings(inp, lambda value: value[spec.start:end])
    return map_strings(inp, lambda value: value[int(spec):])


def cmd_into_int(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    try: return int(inp)
    except (TypeError, ValueError): raise NuError("nu::shell::cant_convert", f"Cannot convert {plain_string(inp)} to int.") from None


def cmd_into_float(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    try: return float(inp)
    except (TypeError, ValueError): raise NuError("nu::shell::cant_convert", f"Cannot convert {plain_string(inp)} to float.") from None


def cmd_into_string(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    return plain_string(inp)


def numbers(inp: Any) -> list[float | int]:
    return [v for v in sequence(inp) if isinstance(v, (int, float)) and not isinstance(v, bool)]


def cmd_math_sum(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any: return sum(numbers(inp))
def cmd_math_product(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any: return math.prod(numbers(inp))
def cmd_math_min(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any: return min(numbers(inp))
def cmd_math_max(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any: return max(numbers(inp))
def cmd_math_avg(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    vals = numbers(inp)
    return sum(vals) / len(vals)


def cmd_math_abs(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any: return abs(inp)
def cmd_math_sqrt(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any: return math.sqrt(inp)
def cmd_math_floor(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any: return math.floor(inp)
def cmd_math_ceil(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any: return math.ceil(inp)
def cmd_math_round(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    precision = int(args[0]) if args else 0
    return round(inp, precision)


def cmd_describe(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    if inp is NOTHING: return "nothing"
    if isinstance(inp, bool): return "bool"
    if isinstance(inp, int): return "int"
    if isinstance(inp, float): return "float"
    if isinstance(inp, str): return "string"
    if isinstance(inp, dict): return "record"
    if isinstance(inp, list):
        subtype = cmd_describe(ev, inp[0], [], source) if inp else "nothing"
        return f"list<{subtype}>"
    return type(inp).__name__.lower()


def path_arg(ev: Evaluator, tokens: list[Token], default: str = ".") -> Path:
    path_tokens = [token for token in tokens if not token.text.startswith("-")]
    return Path("".join(token.text for token in path_tokens) if path_tokens else default)


def cmd_pwd(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any: return str(Path.cwd())


def cmd_cd(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    os.chdir(path_arg(ev, tokens, str(Path.home())))
    return NOTHING


def cmd_open(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    path = path_arg(ev, tokens)
    data = path.read_bytes()
    try: text = data.decode("utf-8")
    except UnicodeDecodeError: return data
    suffix = path.suffix.lower()
    if suffix == ".json": return json.loads(text)
    if suffix == ".csv": return cmd_from_csv(ev, text, [], source)
    if suffix == ".tsv": return cmd_from_csv(ev, text, [Token("word", "--separator", 0, 0), Token("string", "\t", 0, 0)], source)
    return RawText(text)


def cmd_save(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    flags = {token.text for token in tokens if token.text.startswith("-")}
    path = path_arg(ev, tokens)
    if path.exists() and "-f" not in flags and "--force" not in flags and "-a" not in flags and "--append" not in flags:
        raise NuError("nu::shell::file_already_exists", f"Destination file already exists: {path}")
    data = inp if isinstance(inp, bytes) else (inp.value if isinstance(inp, RawText) else plain_string(inp)).encode("utf-8")
    mode = "ab" if "-a" in flags or "--append" in flags else "wb"
    with path.open(mode) as handle: handle.write(data)
    return NOTHING


def cmd_ls(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, flags = get_args(ev, tokens)
    pattern = plain_string(args[0]) if args else "."
    paths = [Path(p) for p in globlib.glob(pattern)] if any(c in pattern for c in "*?[") else list(Path(pattern).iterdir()) if Path(pattern).is_dir() else [Path(pattern)]
    rows = []
    for path in sorted(paths, key=lambda p: p.name.lower()):
        stat = path.stat()
        rows.append({"name": str(path), "type": "dir" if path.is_dir() else "file", "size": stat.st_size, "modified": stat.st_mtime})
    return rows


def cmd_glob(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    return globlib.glob(plain_string(args[0]), recursive=True)


def cmd_mkdir(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    path_arg(ev, tokens).mkdir(parents=True, exist_ok=True)
    return NOTHING


def cmd_touch(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    path_arg(ev, tokens).touch()
    return NOTHING


def cmd_rm(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, flags = get_args(ev, tokens)
    for arg in args:
        path = Path(plain_string(arg))
        if path.is_dir(): shutil.rmtree(path) if ("-r" in flags or "--recursive" in flags) else path.rmdir()
        elif path.exists(): path.unlink()
    return NOTHING


def cmd_cp(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    shutil.copy2(plain_string(args[0]), plain_string(args[1])); return NOTHING


def cmd_mv(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    shutil.move(plain_string(args[0]), plain_string(args[1])); return NOTHING


def cmd_path_exists(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any: return Path(plain_string(inp)).exists()
def cmd_path_basename(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any: return Path(plain_string(inp)).name
def cmd_path_dirname(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any: return str(Path(plain_string(inp)).parent)
def cmd_path_extension(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any: return Path(plain_string(inp)).suffix.lstrip(".")
def cmd_path_join(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens); return str(Path(plain_string(inp)).joinpath(*(plain_string(v) for v in args)))


def cmd_exit(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens); raise ExitShell(int(args[0]) if args else 0)


def cmd_error_make(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any:
    args, _ = get_args(ev, tokens)
    record = args[0] if args else {}
    raise NuError("nu::shell::error", plain_string(record.get("msg", "error")) if isinstance(record, dict) else plain_string(record))


def cmd_ignore(ev: Evaluator, inp: Any, tokens: list[Token], source: str) -> Any: return NOTHING


COMMANDS: dict[str, Callable[[Evaluator, Any, list[Token], str], Any]] = {
    "echo": cmd_echo, "print": cmd_print, "each": cmd_each, "where": cmd_where,
    "filter": cmd_where, "get": cmd_get, "select": cmd_select, "reject": cmd_reject,
    "length": cmd_length, "first": cmd_first, "last": cmd_last, "sort": cmd_sort,
    "sort-by": cmd_sort_by, "uniq": cmd_uniq, "reverse": cmd_reverse, "append": cmd_append,
    "prepend": cmd_prepend, "flatten": cmd_flatten, "compact": cmd_compact, "enumerate": cmd_enumerate,
    "lines": cmd_lines, "columns": cmd_columns, "values": cmd_values, "take": cmd_take,
    "skip": cmd_skip, "drop": cmd_drop, "default": cmd_default,
    "to json": cmd_to_json, "from json": cmd_from_json, "to csv": cmd_to_csv, "from csv": cmd_from_csv,
    "str downcase": cmd_str_downcase, "str upcase": cmd_str_upcase, "str trim": cmd_str_trim,
    "str length": cmd_str_length, "str replace": cmd_str_replace, "str contains": cmd_str_contains,
    "str starts-with": cmd_str_starts_with, "str ends-with": cmd_str_ends_with,
    "str reverse": cmd_str_reverse, "str capitalize": cmd_str_capitalize, "str index-of": cmd_str_index_of,
    "str join": cmd_str_join, "str substring": cmd_str_substring,
    "split row": cmd_split_row, "split column": cmd_split_column,
    "into int": cmd_into_int, "into float": cmd_into_float, "into string": cmd_into_string,
    "math sum": cmd_math_sum, "math product": cmd_math_product, "math min": cmd_math_min,
    "math max": cmd_math_max, "math avg": cmd_math_avg, "describe": cmd_describe,
    "math abs": cmd_math_abs, "math sqrt": cmd_math_sqrt, "math floor": cmd_math_floor,
    "math ceil": cmd_math_ceil, "math round": cmd_math_round,
    "pwd": cmd_pwd, "cd": cmd_cd, "open": cmd_open, "save": cmd_save, "ls": cmd_ls,
    "glob": cmd_glob, "mkdir": cmd_mkdir, "touch": cmd_touch, "rm": cmd_rm, "cp": cmd_cp, "mv": cmd_mv,
    "path exists": cmd_path_exists, "path basename": cmd_path_basename, "path dirname": cmd_path_dirname,
    "path extension": cmd_path_extension, "path join": cmd_path_join,
    "exit": cmd_exit, "error make": cmd_error_make, "ignore": cmd_ignore,
}


def cell_text(value: Any) -> str:
    if value is NOTHING: return ""
    if isinstance(value, bool): return str(value).lower()
    if isinstance(value, (list, dict)): return plain_string(value)
    return plain_string(value)


def render_table(value: list[Any], mode: str = "rounded") -> str:
    if not value:
        return "╭──────────────╮\n│ empty list   │\n╰──────────────╯\n"
    records = all(isinstance(row, dict) for row in value)
    if records:
        columns: list[str] = []
        for row in value:
            for key in row:
                if key not in columns: columns.append(key)
        headers = ["#"] + columns
        rows = [[str(i)] + [cell_text(row.get(column, NOTHING)) for column in columns] for i, row in enumerate(value)]
        show_header = True
    else:
        headers = ["#", ""]
        rows = [[str(i), cell_text(row)] for i, row in enumerate(value)]
        show_header = False
    widths = [len(headers[i]) for i in range(len(headers))]
    for row in rows:
        for i, cell in enumerate(row): widths[i] = max(widths[i], max((len(line) for line in cell.splitlines()), default=0))
    top = "╭" + "┬".join("─" * (w + 2) for w in widths) + "╮"
    bottom = "╰" + "┴".join("─" * (w + 2) for w in widths) + "╯"
    def line(row: list[str], raw: list[Any] | None = None) -> str:
        cells = []
        for i, cell in enumerate(row):
            underlying = raw[i] if raw is not None else None
            if raw is None:
                formatted = f"{cell:^{widths[i]}}"
            elif i == 0 or isinstance(underlying, (int, float)) and not isinstance(underlying, bool):
                formatted = f"{cell:>{widths[i]}}"
            else:
                formatted = f"{cell:<{widths[i]}}"
            cells.append(f" {formatted} ")
        return "│" + "│".join(cells) + "│"
    output = [top]
    if show_header:
        output.append(line(headers))
        output.append("├" + "┼".join("─" * (w + 2) for w in widths) + "┤")
    for index, row in enumerate(rows):
        if records:
            raw = [index] + [value[index].get(column, NOTHING) for column in columns]
        else:
            raw = [index, value[index]]
        output.append(line(row, raw))
    output.append(bottom)
    return "\n".join(output) + "\n"


def render(value: Any, no_newline: bool = False, table_mode: str = "rounded") -> bytes:
    if value is NOTHING: return b""
    if isinstance(value, RawText): return value.value.encode("utf-8")
    if isinstance(value, RangeValue): value = value.values()
    if isinstance(value, list):
        text = render_table(value, table_mode)
        return text.encode("utf-8")
    elif isinstance(value, dict):
        text = render_table([value], table_mode)
        return text.encode("utf-8")
    elif isinstance(value, bool): text = str(value).lower()
    elif isinstance(value, float): text = plain_string(value)
    else: text = plain_string(value)
    if not no_newline: text += "\n"
    return text.encode("utf-8")


def diagnostic(error: NuError, source: str, style: str = "fancy") -> str:
    if style == "plain":
        start = max(0, min(error.span[0], len(source)))
        label = error.message.rstrip(".")
        label = label[0].lower() + label[1:] if label else "error"
        return (
            f"Error: {error.message}\n"
            "    Diagnostic severity: error\n"
            "Begin snippet for source starting at line 1, column 1\n\n"
            f"snippet line 1: {source}\n"
            f"    label at line 1, column {start + 1}: {label}\n"
            f"diagnostic code: {error.kind}\n\n"
        )
    if error.kind == "nu::parser::incomplete_math_expression":
        return f"Error: {error.kind}\n\n  x Incomplete math expression.\n   ,-[source:1:3]\n 1 | {source}\n   :   |\n   :   `-- incomplete math expression\n   `----\n\n"
    if error.kind == "nu::shell::division_by_zero":
        return f"Error: {error.kind}\n\n  x Division by zero.\n   ,-[source:1:3]\n 1 | {source}\n   :   |\n   :   `-- division by zero\n   `----\n\n"
    if error.kind == "nu::shell::external_command":
        command = source.split()[0] if source.split() else ""
        left = max(1, len(command) // 2)
        marker = "^" * left + "|" + "^" * max(0, len(command) - left - 1)
        help_text = f"`{command}` is neither a Nushell built-in or a known external\n        command"
        return f"Error: {error.kind}\n\n  x External command failed\n   ,-[source:1:1]\n 1 | {source}\n   : {marker}\n   : {' ' * left}`-- Command `{command}` not found\n   `----\n  help: {help_text}\n\n"
    if error.kind == "nu::shell::access_beyond_end":
        match = re.search(r"get\s+([^\s]+)", source)
        index = match.group(1) if match else ""
        start = match.start(1) if match else 0
        maximum = re.search(r"max: (\d+)", error.message)
        max_text = maximum.group(1) if maximum else "0"
        return f"Error: {error.kind}\n\n  x {error.message}\n   ,-[source:1:{start + 1}]\n 1 | {source}\n   : {' ' * start}|\n   : {' ' * start}`-- index too large (max: {max_text})\n   `----\n\n"
    if error.kind == "nu::shell::error":
        return f"Error: {error.kind}\n\n  x {error.message}\n   ,-[source:1:1]\n 1 | {source}\n   : ^^^^^|^^^^\n   :      `-- originates from here\n   `----\n\n"
    start, end = error.span
    start = max(0, min(start, len(source)))
    end = max(start + 1, min(max(end, start + 1), len(source)))
    column = start + 1
    marker = " " * start + ("|" if end - start <= 1 else "^" * (end - start))
    label = error.message[0].lower() + error.message[1:] if error.message else "error"
    text = f"Error: {error.kind}\n\n  x {error.message}\n   ,-[source:1:{column}]\n 1 | {source}\n   : {marker}\n   : {' ' * start}`-- {label}\n   `----\n"
    if error.help_text:
        text += f"  help: {error.help_text}\n"
    return text + "\n"


HELP = """The nushell language and shell.

Usage:
  > nu {flags} (script file) ...(script args) 

Flags:
  -h, --help: Display the help message for this command
  -c, --commands <string>: run the given commands and then exit
  -m, --table-mode <string>: the table mode to use. rounded is default.
  --error-style <string>: the error style to use (fancy or plain). default: fancy
  --no-newline: print the result for --commands(-c) without a newline
  -n, --no-config-file: start with no config file and no env file
  -v, --version: print the version
"""


def parse_cli(argv: list[str]) -> tuple[str | None, bool, str, str, bool]:
    expression = None
    no_newline = False
    table_mode = "rounded"
    error_style = "fancy"
    stdin_flag = False
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in ("-c", "--commands"):
            i += 1
            if i >= len(argv): raise NuError("nu::parser::missing_positional", "Missing command string.")
            expression = argv[i]
        elif arg in ("-m", "--table-mode"):
            i += 1; table_mode = argv[i]
        elif arg == "--error-style":
            i += 1; error_style = argv[i]
        elif arg == "--no-newline": no_newline = True
        elif arg == "--stdin": stdin_flag = True
        elif arg in ("-n", "--no-config-file", "--no-history", "--no-std-lib"): pass
        elif arg in ("-v", "--version"):
            sys.stdout.buffer.write(b"0.106.1\n"); raise ExitShell(0)
        elif arg in ("-h", "--help"):
            sys.stdout.buffer.write(HELP.encode("utf-8")); raise ExitShell(0)
        elif not arg.startswith("-"):
            expression = Path(arg).read_text(encoding="utf-8")
            break
        i += 1
    return expression, no_newline, table_mode, error_style, stdin_flag


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    source = ""
    error_style = "fancy"
    try:
        source_value, no_newline, table_mode, error_style, stdin_flag = parse_cli(argv)
        if source_value is None:
            return 0
        source = source_value
        env = Env()
        if stdin_flag:
            env.set("in", RawText(sys.stdin.read()))
        value = Evaluator(env).evaluate(source)
        sys.stdout.buffer.write(render(value, no_newline, table_mode))
        return 0
    except ExitShell as exit_shell:
        return exit_shell.status
    except NuError as error:
        sys.stderr.buffer.write(diagnostic(error, source, error_style).encode("utf-8"))
        return error.status
    except (OSError, json.JSONDecodeError) as error:
        shell_error = NuError("nu::shell::io_error", str(error))
        sys.stderr.buffer.write(diagnostic(shell_error, source, error_style).encode("utf-8"))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
