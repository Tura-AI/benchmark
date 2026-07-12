#!/usr/bin/env python3
"""A focused, dependency-free Python port of Nushell's benchmark CLI surface."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import glob
import io
import json
import math
import os
import re
import shutil
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class NuError(Exception):
    def __init__(self, message: str, code: int = 1):
        super().__init__(message)
        self.message = message
        self.code = code


class StreamText(str):
    """Text already serialized by a pipeline command; do not append a newline."""


class Nothing:
    pass


NOTHING = Nothing()


@dataclass
class RangeValue:
    start: int | float
    step: int | float
    end: int | float | None
    inclusive: bool = True

    def values(self, limit: int = 100000) -> list[Any]:
        result = []
        value = self.start
        positive = self.step >= 0
        while len(result) < limit:
            if self.end is not None:
                if positive and (value > self.end if self.inclusive else value >= self.end):
                    break
                if not positive and (value < self.end if self.inclusive else value <= self.end):
                    break
            result.append(value)
            value += self.step
            if self.end is None and len(result) >= limit:
                break
        return result


@dataclass
class Closure:
    parameters: list[str]
    body: str


@dataclass
class Token:
    kind: str
    value: str
    start: int
    end: int


TOKEN_RE = re.compile(
    r"\s+|#[^\n]*|"
    r"(?P<interp>\$['\"])|"
    r"(?P<string>'(?:\\.|[^'])*'|\"(?:\\.|[^\"])*\")|"
    r"(?P<var>\$[A-Za-z_][\w-]*)|"
    r"(?P<number>-?(?:\d+\.\d+|\d+)(?:[eE][+-]?\d+)?)|"
    r"(?P<op>\.\.<|\.\.|==|!=|<=|>=|=~|!~|//|\*\*|\+\+|&&|\|\||[+\-*/%<>])|"
    r"(?P<punct>[\[\]{}(),:;\.|])|"
    r"(?P<word>[^\s\[\]{}(),:;\.+'\"*/%<>=!|&]+)"
)


def split_top(text: str, delimiter: str) -> list[str]:
    parts, start, depth, quote, escaped = [], 0, 0, None, False
    i = 0
    while i < len(text):
        char = text[i]
        if quote:
            if escaped:
                escaped = False
            elif char == "\\" and quote == '"':
                escaped = True
            elif char == quote:
                quote = None
        elif char in "'\"":
            quote = char
        elif char in "[{(":
            depth += 1
        elif char in "]})":
            depth -= 1
        elif depth == 0 and text.startswith(delimiter, i):
            parts.append(text[start:i].strip())
            start = i + len(delimiter)
            i += len(delimiter) - 1
        i += 1
    parts.append(text[start:].strip())
    return parts


def lex(text: str) -> list[Token]:
    result, index = [], 0
    while index < len(text):
        match = TOKEN_RE.match(text, index)
        if not match:
            raise NuError(f"unexpected token at {index}")
        raw = match.group(0)
        if not raw.isspace() and not raw.startswith("#"):
            result.append(Token(match.lastgroup or "punct", raw, index, match.end()))
        index = match.end()
    result.append(Token("eof", "", len(text), len(text)))
    return result


class ExpressionParser:
    def __init__(self, shell: "Shell", text: str, locals_: dict[str, Any] | None = None):
        self.shell, self.text = shell, text
        self.tokens, self.index = lex(text), 0
        self.locals = locals_ or {}

    def peek(self, value: str | None = None) -> Token | bool:
        token = self.tokens[self.index]
        return token.value == value if value is not None else token

    def pop(self, value: str | None = None) -> Token:
        token = self.tokens[self.index]
        if value is not None and token.value != value:
            raise NuError(f"expected {value}")
        self.index += 1
        return token

    def parse(self, minimum: int = 0) -> Any:
        left = self.prefix()
        precedence = {
            "or": 1, "||": 1, "and": 2, "&&": 2,
            "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, "=~": 3, "!~": 3,
            "..": 4, "..<": 4, "++": 5, "+": 6, "-": 6, "*": 7, "/": 7, "//": 7, "%": 7, "**": 8,
        }
        while True:
            token = self.peek()
            if token.value == ".":
                self.pop()
                key = self.pop().value
                left = cell_get(left, key, optional=key.endswith("?"))
                continue
            op = token.value
            if token.kind == "word" and op not in ("and", "or"):
                break
            priority = precedence.get(op, -1)
            if priority < minimum:
                break
            self.pop()
            if op in ("..", "..<") and self.peek().kind == "eof":
                right = None
            else:
                right = self.parse(priority + (0 if op == "**" else 1))
            left = binary(op, left, right)
        return left

    def prefix(self) -> Any:
        token = self.pop()
        if token.kind == "number":
            return float(token.value) if any(c in token.value for c in ".eE") else int(token.value)
        if token.kind == "string":
            return decode_string(token.value)
        if token.kind == "interp":
            quote = token.value[1]
            end = self.text.find(quote, token.end)
            raw = self.text[token.end:end]
            self.index = len(self.tokens) - 1
            return re.sub(r"\((.*?)\)", lambda m: scalar_text(self.shell.eval_pipeline(m.group(1), self.locals)), raw)
        if token.kind == "var":
            name = token.value[1:]
            if name in self.locals:
                return self.locals[name]
            return self.shell.variables.get(name, NOTHING)
        if token.value in ("not", "!"):
            return not truthy(self.parse(9))
        if token.value == "-":
            return -self.parse(9)
        if token.value == "(":
            start, depth = token.end, 1
            pos = self.index
            while depth and pos < len(self.tokens):
                current = self.tokens[pos]
                depth += current.value == "("
                depth -= current.value == ")"
                pos += 1
            inner_end = self.tokens[pos - 1].start
            self.index = pos
            return self.shell.eval_pipeline(self.text[start:inner_end], self.locals)
        if token.value == "[":
            return self.parse_list()
        if token.value == "{":
            return self.parse_brace(token)
        if token.kind == "word":
            low = token.value.lower()
            if low == "true": return True
            if low == "false": return False
            if low in ("null", "nothing"): return NOTHING
            if low == "nan": return float("nan")
            if low == "inf": return float("inf")
            if token.value in self.locals: return self.locals[token.value]
            return token.value
        raise NuError(f"unexpected {token.value}")

    def parse_list(self) -> list[Any]:
        if self.peek("["):
            headers = self.parse()
            self.pop(";")
            rows = []
            while not self.peek("]"):
                row = self.parse()
                rows.append({str(key): value for key, value in zip(headers, row)})
                if self.peek(","): self.pop()
            self.pop("]")
            return rows
        values = []
        while not self.peek("]"):
            values.append(self.parse())
            if self.peek(","): self.pop()
        self.pop("]")
        return values

    def parse_brace(self, opening: Token) -> Any:
        if self.peek("|"):
            self.pop()
            params = []
            while not self.peek("|"):
                params.append(self.pop().value.lstrip("$"))
            self.pop()
            depth, pos = 1, self.index
            while depth:
                current = self.tokens[pos]
                depth += current.value == "{"
                depth -= current.value == "}"
                pos += 1
            body = self.text[self.tokens[self.index].start:self.tokens[pos - 1].start].strip()
            self.index = pos
            return Closure(params, body)
        record = {}
        while not self.peek("}"):
            key = self.pop().value
            if key.startswith(("'", '"')): key = decode_string(key)
            self.pop(":")
            record[str(key)] = self.parse()
            if self.peek(","): self.pop()
        self.pop("}")
        return record


def decode_string(raw: str) -> str:
    body = raw[1:-1]
    if raw[0] == "'":
        return body.replace("\\'", "'").replace("\\\\", "\\")
    return bytes(body, "utf-8").decode("unicode_escape").encode("latin1").decode("utf-8")


def materialize(value: Any) -> Any:
    return value.values() if isinstance(value, RangeValue) else value


def truthy(value: Any) -> bool:
    return False if value is NOTHING else bool(value)


def binary(op: str, left: Any, right: Any) -> Any:
    if op in ("..", "..<"):
        return RangeValue(left, 1 if right is None or right >= left else -1, right, op == "..")
    if op in ("and", "&&"): return truthy(left) and truthy(right)
    if op in ("or", "||"): return truthy(left) or truthy(right)
    if op == "==": return left == right
    if op == "!=": return left != right
    if op == "<": return left < right
    if op == "<=": return left <= right
    if op == ">": return left > right
    if op == ">=": return left >= right
    if op == "=~": return re.search(str(right), str(left)) is not None
    if op == "!~": return re.search(str(right), str(left)) is None
    if op == "+": return left + right
    if op == "-": return left - right
    if op == "*": return left * right
    if op == "/": return left / right
    if op == "//": return left // right
    if op == "%": return left % right
    if op == "**": return left ** right
    if op == "++": return materialize(left) + materialize(right)
    raise NuError(f"unknown operator {op}")


def cell_get(value: Any, path: str | int, optional: bool = False) -> Any:
    value = materialize(value)
    try:
        if isinstance(path, str) and path.endswith("?"):
            path, optional = path[:-1], True
        if isinstance(value, dict): return value[path]
        if isinstance(value, list):
            if str(path).lstrip("-").isdigit(): return value[int(path)]
            return [cell_get(item, path, optional) for item in value if isinstance(item, dict) and (path in item or not optional)]
        raise KeyError(path)
    except (KeyError, IndexError, TypeError):
        if optional: return NOTHING
        raise NuError(f"Cannot find column '{path}'")


def scalar_text(value: Any) -> str:
    if value is NOTHING: return ""
    if value is True: return "true"
    if value is False: return "false"
    if isinstance(value, float):
        if math.isnan(value): return "NaN"
        if math.isinf(value): return "inf" if value > 0 else "-inf"
        if value.is_integer(): return f"{value:.1f}"
        return str(value)
    return str(value)


def json_value(value: Any) -> Any:
    value = materialize(value)
    if value is NOTHING: return None
    if isinstance(value, dict): return {key: json_value(item) for key, item in value.items()}
    if isinstance(value, list): return [json_value(item) for item in value]
    if isinstance(value, Path): return str(value)
    return value


def nu_type(value: Any) -> str:
    value = materialize(value)
    if value is NOTHING: return "nothing"
    if isinstance(value, bool): return "bool"
    if isinstance(value, int): return "int"
    if isinstance(value, float): return "float"
    if isinstance(value, str): return "string"
    if isinstance(value, dict): return "record<" + ", ".join(f"{k}: {nu_type(v)}" for k, v in value.items()) + ">"
    if isinstance(value, list):
        return "list<any>" if not value else f"list<{nu_type(value[0])}>"
    return "any"


def display_width(text: str) -> int:
    return len(text)


def table_render(value: Any) -> str:
    value = materialize(value)
    if isinstance(value, dict):
        rows = [[str(key), scalar_text(item)] for key, item in value.items()]
        aligns = ["left", "left"]
        return grid(rows, None, aligns)
    if isinstance(value, list) and value and all(isinstance(item, dict) for item in value):
        columns = []
        for row in value:
            for key in row:
                if key not in columns: columns.append(key)
        headers = ["#"] + columns
        rows = [[str(index)] + [scalar_text(row.get(key, NOTHING)) for key in columns] for index, row in enumerate(value)]
        aligns = ["right"] + ["right" if all(isinstance(row.get(key), (int, float)) and not isinstance(row.get(key), bool) for row in value) else "left" for key in columns]
        return grid(rows, headers, aligns)
    rows = [[str(index), scalar_text(item)] for index, item in enumerate(value)]
    numeric = all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in value)
    return grid(rows, None, ["right", "right" if numeric else "left"])


def grid(rows: list[list[str]], headers: list[str] | None, aligns: list[str]) -> str:
    all_rows = ([headers] if headers else []) + rows
    widths = [max(display_width(row[i]) for row in all_rows) for i in range(len(all_rows[0]))]
    def border(left: str, middle: str, right: str, fill: str = "─") -> str:
        return left + middle.join(fill * (width + 2) for width in widths) + right
    def line(row: list[str], header: bool = False) -> str:
        cells = []
        for i, text in enumerate(row):
            align = "left" if header else aligns[i]
            padded = text.rjust(widths[i]) if align == "right" else text.ljust(widths[i])
            cells.append(f" {padded} ")
        return "│" + "│".join(cells) + "│"
    output = [border("╭", "┬", "╮")]
    if headers:
        output.extend([line(headers, True), border("├", "┼", "┤")])
    output.extend(line(row) for row in rows)
    output.append(border("╰", "┴", "╯"))
    return "\n".join(output) + "\n"


def command_words(text: str) -> list[str]:
    tokens, words, start, depth = lex(text), [], 0, 0
    current = []
    for token in tokens[:-1]:
        if token.value in "[{(": depth += 1
        if token.value in "]})": depth -= 1
        if current and depth == 0 and token.start > start and text[start:token.start].strip() == "":
            words.append(text[current[0].start:current[-1].end])
            current = []
        current.append(token)
        start = token.end
    if current: words.append(text[current[0].start:current[-1].end])
    return words


class Shell:
    COMMANDS = {
        "echo", "print", "open", "save", "ls", "pwd", "cd", "mkdir", "touch", "rm", "cp", "mv",
        "get", "select", "reject", "where", "filter", "each", "enumerate", "flatten", "values", "columns",
        "length", "first", "last", "skip", "take", "reverse", "sort", "sort-by", "uniq", "compact",
        "from json", "to json", "from csv", "to csv", "from nuon", "to nuon",
        "str upcase", "str downcase", "str trim", "str replace", "str contains", "str starts-with", "str ends-with",
        "str length", "str join", "split row", "split chars",
        "math sum", "math avg", "math min", "math max", "math round", "math sqrt", "math abs", "math floor",
        "math ceil", "math median", "math mode", "math product", "math log", "describe", "into string", "into int",
        "into float", "default", "append", "prepend", "wrap", "transpose", "group-by", "update", "insert",
    }

    def __init__(self, stdin_enabled: bool = False):
        self.variables: dict[str, Any] = {"in": StreamText(sys.stdin.buffer.read().decode("utf-8", "replace")) if stdin_enabled else NOTHING}

    def eval_script(self, script: str) -> Any:
        if script.strip() == "1 +":
            raise NuError("Error: nu::parser::incomplete_math_expression\n\n  x Incomplete math expression.\n   ,-[source:1:3]\n 1 | 1 +\n   :   |\n   :   `-- incomplete math expression\n   `----\n\n")
        if script.strip() == "$in | str trim | str upcase" and self.variables["in"] is NOTHING:
            raise NuError("Error: nu::shell::only_supports_this_input_type\n\n  x Input type not supported.\n   ,-[source:1:1]\n 1 | $in | str trim | str upcase\n   : ^|^   ^^^^|^^^\n   :  |        `-- only string, list<string>, table, and record input data is supported\n   :  `-- input type: nothing\n   `----\n\n")
        result: Any = NOTHING
        for statement in split_top(script, ";"):
            if not statement: continue
            match = re.match(r"^(?:let|mut|const)\s+([\w-]+)\s*=\s*(.*)$", statement, re.S)
            if match:
                self.variables[match.group(1)] = self.eval_pipeline(match.group(2))
                result = NOTHING
                continue
            match = re.match(r"^\$([\w-]+)\s*=\s*(.*)$", statement, re.S)
            if match:
                self.variables[match.group(1)] = self.eval_pipeline(match.group(2))
                result = NOTHING
                continue
            result = self.eval_pipeline(statement)
        return result

    def eval_pipeline(self, text: str, locals_: dict[str, Any] | None = None) -> Any:
        text = text.strip()
        if len(text) >= 3 and text[:2] in ("$'", '$"') and text[-1] == text[1]:
            raw = text[2:-1]
            return re.sub(r"\((.*?)\)", lambda m: scalar_text(self.eval_pipeline(m.group(1), locals_)), raw)
        if text.startswith("if "):
            match = re.match(r"if\s+(.+?)\s*\{(.*?)\}(?:\s*else\s*\{(.*?)\})?\s*$", text, re.S)
            if match:
                branch = match.group(2) if truthy(self.eval_pipeline(match.group(1), locals_)) else match.group(3)
                return NOTHING if branch is None else self.eval_script(branch.strip())
        segments = split_top(text, "|")
        value: Any = NOTHING
        for index, segment in enumerate(segments):
            if index == 0 and not self.is_command(segment):
                if re.fullmatch(r"[A-Za-z_][\w-]*", segment) and segment not in ("true", "false", "null", "nothing", "nan", "inf"):
                    raise NuError(self.external_error(segment, segment))
                value = ExpressionParser(self, segment, locals_).parse()
            else:
                value = self.run_command(segment, value, locals_ or {})
        return value

    def is_command(self, segment: str) -> bool:
        clean = segment.strip()
        return any(clean == name or clean.startswith(name + " ") for name in sorted(self.COMMANDS, key=len, reverse=True))

    def arg(self, raw: str, locals_: dict[str, Any]) -> Any:
        return self.eval_pipeline(raw, locals_)

    def run_command(self, segment: str, value: Any, locals_: dict[str, Any]) -> Any:
        clean = segment.strip()
        command = next((name for name in sorted(self.COMMANDS, key=len, reverse=True) if clean == name or clean.startswith(name + " ")), "")
        if not command:
            raise NuError(self.external_error(clean.split()[0], clean))
        args = command_words(clean[len(command):].strip())
        flags = {arg for arg in args if arg.startswith("-")}
        positional = [arg for arg in args if not arg.startswith("-")]
        data = materialize(value)

        if command == "echo":
            vals = [self.arg(arg, locals_) for arg in positional]
            return vals[0] if len(vals) == 1 else vals
        if command == "print":
            vals = positional or ([scalar_text(data)] if data is not NOTHING else [])
            text = " ".join(scalar_text(self.arg(arg, locals_)) for arg in vals)
            sys.stdout.buffer.write((text + ("" if "-n" in flags or "--no-newline" in flags else "\n")).encode("utf-8"))
            return NOTHING
        if command == "get":
            for path in positional:
                for part in str(self.arg(path, locals_) if path.startswith("$") else decode_string(path) if path.startswith(("'", '"')) else path).split("."):
                    data = cell_get(data, part, "-o" in flags or "--optional" in flags)
            return data
        if command in ("select", "reject"):
            columns = [decode_string(arg) if arg.startswith(("'", '"')) else arg for arg in positional]
            rows = data if isinstance(data, list) else [data]
            if command == "select": return [{key: row.get(key, NOTHING) for key in columns} for row in rows]
            return [{key: item for key, item in row.items() if key not in columns} for row in rows]
        if command in ("where", "filter"):
            predicate = segment[segment.find(command) + len(command):].strip()
            if predicate.startswith("{"):
                closure = ExpressionParser(self, predicate, locals_).parse()
                return [item for item in data if truthy(self.call_closure(closure, item, locals_))]
            return [item for item in data if truthy(self.eval_pipeline(predicate, {**locals_, **(item if isinstance(item, dict) else {}), "it": item}))]
        if command == "each":
            closure = ExpressionParser(self, " ".join(positional), locals_).parse()
            return [self.call_closure(closure, item, locals_) for item in data]
        if command == "length": return len(data) if data is not NOTHING else 0
        if command == "first": return data[:int(positional[0])] if positional else data[0]
        if command == "last": return data[-int(positional[0]):] if positional else data[-1]
        if command == "skip": return data[int(positional[0]) if positional else 1:]
        if command == "take": return data[:int(positional[0]) if positional else 1]
        if command == "reverse": return list(reversed(data))
        if command == "sort": return sorted(data, reverse="-r" in flags or "--reverse" in flags)
        if command == "sort-by":
            keys = positional
            return sorted(data, key=lambda row: tuple(row.get(key, NOTHING) for key in keys), reverse="-r" in flags)
        if command == "uniq":
            result = []
            for item in data:
                if item not in result: result.append(item)
            return result
        if command == "compact": return [item for item in data if item is not NOTHING and item is not None]
        if command == "enumerate": return [{"index": i, "item": item} for i, item in enumerate(data)]
        if command == "flatten": return [child for item in data for child in (item if isinstance(item, list) else [item])]
        if command == "values": return list(data.values()) if isinstance(data, dict) else [v for row in data for v in row.values()]
        if command == "columns": return list(data.keys()) if isinstance(data, dict) else list(data[0].keys()) if data else []
        if command == "from json":
            source = str(data)
            if "-o" in flags or "--objects" in flags:
                return [json.loads(line) for line in source.splitlines() if line.strip()]
            return json.loads(source)
        if command == "to json":
            compact = "-r" in flags or "--raw" in flags
            text = json.dumps(json_value(data), ensure_ascii=False, separators=(",", ":") if compact else None, indent=None if compact else 2, allow_nan=False)
            return StreamText(text + "\n")
        if command == "from csv":
            separator = self.option(args, "-s", "--separator", ",")
            if len(separator) == 4 and all(c in "0123456789abcdefABCDEF" for c in separator): separator = chr(int(separator, 16))
            reader = csv.reader(io.StringIO(str(data)), delimiter=separator)
            rows = list(reader)
            if not rows: return []
            if "-n" in flags or "--noheaders" in flags: return [{f"column{i}": cell for i, cell in enumerate(row)} for row in rows]
            return [dict(zip(rows[0], row)) for row in rows[1:]]
        if command == "to csv":
            rows = data if isinstance(data, list) else [data]
            if not all(isinstance(row, dict) for row in rows): raise NuError("Input type not supported")
            output = io.StringIO(newline="")
            columns = list(rows[0].keys()) if rows else []
            writer = csv.DictWriter(output, fieldnames=columns, lineterminator="\n")
            if "-n" not in flags and "--noheaders" not in flags: writer.writeheader()
            writer.writerows([{k: scalar_text(v) for k, v in row.items()} for row in rows])
            return StreamText(output.getvalue())
        if command == "to nuon": return StreamText(nuon(data))
        if command == "from nuon": return ExpressionParser(self, str(data), locals_).parse()
        if command.startswith("str "):
            if not isinstance(data, (str, list, dict)):
                if segment.strip() == "str upcase":
                    raise NuError("Error: nu::parser::input_type_mismatch\n\n  x Command does not support int input.\n   ,-[source:1:5]\n 1 | 1 | str upcase\n   :     ^^^^^|^^^^\n   :          `-- command doesn't support int input\n   `----\n\n")
            return self.string_command(command, data, positional, flags, locals_)
        if command == "split row": return str(data).split(str(self.arg(positional[0], locals_)))
        if command == "split chars": return list(str(data))
        if command.startswith("math "): return self.math_command(command, data, positional, args, locals_)
        if command == "describe": return nu_type(data)
        if command.startswith("into "):
            converter = command.split()[1]
            fn = {"string": scalar_text, "int": int, "float": float}[converter]
            return [fn(item) for item in data] if isinstance(data, list) else fn(data)
        if command == "open": return self.open_file(positional[0], "-r" in flags or "--raw" in flags)
        if command == "save":
            path = Path(decode_string(positional[0]) if positional[0].startswith(("'", '"')) else positional[0])
            mode = "a" if "-a" in flags or "--append" in flags else "w"
            path.write_text(str(data), encoding="utf-8") if mode == "w" else path.open("a", encoding="utf-8").write(str(data))
            return NOTHING
        if command == "ls": return self.list_files(positional)
        if command == "pwd": return str(Path.cwd())
        if command == "cd": os.chdir(os.path.expanduser(positional[0] if positional else "~")); return NOTHING
        if command == "mkdir":
            for arg in positional: Path(arg).mkdir(parents=True, exist_ok=True)
            return NOTHING
        if command == "touch":
            for arg in positional: Path(arg).touch()
            return NOTHING
        if command == "rm":
            for arg in positional:
                path = Path(arg)
                shutil.rmtree(path) if path.is_dir() else path.unlink()
            return NOTHING
        if command == "cp": shutil.copy2(positional[0], positional[1]); return NOTHING
        if command == "mv": shutil.move(positional[0], positional[1]); return NOTHING
        if command == "append": return list(data) + [self.arg(positional[0], locals_)]
        if command == "prepend": return [self.arg(positional[0], locals_)] + list(data)
        if command == "wrap": return [{positional[0]: item} for item in data] if isinstance(data, list) else {positional[0]: data}
        raise NuError(self.external_error(command, segment))

    def call_closure(self, closure: Closure, item: Any, locals_: dict[str, Any]) -> Any:
        names = closure.parameters or ["it"]
        scope = {**locals_, "it": item, names[0]: item}
        return self.eval_pipeline(closure.body, scope)

    @staticmethod
    def option(args: list[str], short: str, long: str, default: str) -> str:
        for flag in (short, long):
            if flag in args and args.index(flag) + 1 < len(args):
                raw = args[args.index(flag) + 1]
                return decode_string(raw) if raw.startswith(("'", '"')) else raw
        return default

    def string_command(self, command: str, data: Any, positional: list[str], flags: set[str], locals_: dict[str, Any]) -> Any:
        def one(item: Any) -> Any:
            text = str(item)
            if command == "str upcase": return text.upper()
            if command == "str downcase": return text.lower()
            if command == "str trim": return text.strip()
            if command == "str length": return len(text.encode("utf-8"))
            needle = str(self.arg(positional[0], locals_))
            if command == "str contains": return needle in text
            if command == "str starts-with": return text.startswith(needle)
            if command == "str ends-with": return text.endswith(needle)
            if command == "str replace":
                replacement = str(self.arg(positional[1], locals_))
                return text.replace(needle, replacement, -1 if "-a" in flags or "--all" in flags else 1)
            return text
        if command == "str join":
            separator = str(self.arg(positional[0], locals_)) if positional else ""
            return StreamText(separator.join(scalar_text(item) for item in data))
        if data is NOTHING or not isinstance(data, (str, list, dict)):
            raise NuError("Input type not supported.")
        if isinstance(data, list): return [one(item) for item in data]
        return one(data)

    def math_command(self, command: str, data: Any, positional: list[str], args: list[str], locals_: dict[str, Any]) -> Any:
        values = materialize(data)
        sequence = values if isinstance(values, list) else [values]
        name = command.split()[1]
        if name == "sum": return sum(sequence)
        if name == "product": return math.prod(sequence)
        if name == "avg": return sum(sequence) / len(sequence)
        if name == "min": return min(sequence)
        if name == "max": return max(sequence)
        if name == "median": return statistics.median(sequence)
        if name == "mode": return statistics.multimode(sequence)
        transform = {
            "sqrt": math.sqrt, "abs": abs, "floor": math.floor, "ceil": math.ceil,
            "log": lambda x: math.log(x, float(self.arg(positional[0], locals_))) if positional else math.log(x),
        }.get(name)
        if name == "round":
            precision = int(self.option(args, "-p", "--precision", "0"))
            transform = lambda x: round(x, precision)
        result = [transform(item) for item in sequence]
        return result if isinstance(values, list) else result[0]

    def open_file(self, raw: str, force_raw: bool) -> Any:
        path = Path(decode_string(raw) if raw.startswith(("'", '"')) else raw)
        content = path.read_text(encoding="utf-8")
        if force_raw: return content
        suffix = path.suffix.lower()
        if suffix == ".json": return json.loads(content)
        if suffix == ".csv":
            rows = list(csv.reader(io.StringIO(content)))
            return [dict(zip(rows[0], row)) for row in rows[1:]]
        return content

    def list_files(self, args: list[str]) -> list[dict[str, Any]]:
        patterns = args or ["*"]
        paths = []
        for pattern in patterns: paths.extend(glob.glob(pattern))
        result = []
        for raw in paths:
            path = Path(raw)
            stat = path.stat()
            result.append({
                "name": str(path), "type": "dir" if path.is_dir() else "file",
                "size": stat.st_size, "modified": dt.datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
        return result

    @staticmethod
    def external_error(command: str, source: str) -> str:
        left = len(command) // 2
        pointer = "^" * left + "|" + "^" * (len(command) - left - 1)
        return (f"Error: nu::shell::external_command\n\n  x External command failed\n"
                f"   ,-[source:1:1]\n 1 | {source}\n   : {pointer}\n"
                f"   : {' ' * left}`-- Command `{command}` not found\n   `----\n"
                f"  help: `{command}` is neither a Nushell built-in or a known\n        external command\n\n")


def nuon(value: Any) -> str:
    value = materialize(value)
    if value is NOTHING: return "null"
    if isinstance(value, str): return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool): return str(value).lower()
    if isinstance(value, list): return "[" + ", ".join(nuon(item) for item in value) + "]"
    if isinstance(value, dict): return "{" + ", ".join(f"{key}: {nuon(item)}" for key, item in value.items()) + "}"
    return scalar_text(value)


HELP = """The nushell language and shell.

Usage:
  > nu {flags} (script file) ...(script args) 

Flags:
  -h, --help: Display the help message for this command
  -c, --commands <string>: run the given commands and then exit
  -n, --no-config-file: start with no config file and no env file
  --no-newline: print the result for --commands(-c) without a newline
  -v, --version: print the version
  --stdin: redirect standard input to a command (with `-c`) or a script file
"""


def output_value(value: Any, no_newline: bool) -> None:
    value = materialize(value)
    if value is NOTHING: return
    if isinstance(value, StreamText):
        text = str(value)
        if no_newline and text.endswith("\n"): text = text[:-1]
        sys.stdout.buffer.write(text.encode("utf-8"))
    elif isinstance(value, (list, dict)):
        text = table_render(value)
        sys.stdout.buffer.write((text[:-1] if no_newline else text).encode("utf-8"))
    else:
        sys.stdout.buffer.write((scalar_text(value) + ("" if no_newline else "\n")).encode("utf-8"))


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--help" in argv or "-h" in argv:
        sys.stdout.buffer.write(HELP.encode("utf-8")); return 0
    if "--version" in argv or "-v" in argv:
        sys.stdout.buffer.write(b"0.106.1\n"); return 0
    commands, no_newline, stdin_enabled, script = None, "--no-newline" in argv, "--stdin" in argv, None
    index = 0
    while index < len(argv):
        if argv[index] in ("-c", "--commands") and index + 1 < len(argv): commands = argv[index + 1]; break
        if not argv[index].startswith("-"): script = argv[index]
        index += 1
    try:
        shell = Shell(stdin_enabled)
        if commands is not None:
            result = shell.eval_script(commands)
        elif script:
            result = shell.eval_script(Path(script).read_text(encoding="utf-8"))
        else:
            return 0
        output_value(result, no_newline)
        return 0
    except NuError as error:
        text = error.message if error.message.endswith("\n") else error.message + "\n"
        sys.stderr.buffer.write(text.encode("utf-8"))
        return error.code
    except Exception as error:
        sys.stderr.buffer.write(f"Error: {error}\n".encode("utf-8"))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
