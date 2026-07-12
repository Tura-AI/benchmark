#!/usr/bin/env python3
"""A focused, dependency-free Python port of Nushell's benchmark CLI surface."""

from __future__ import annotations

import csv
import fnmatch
import io
import json
import math
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class NuError(Exception):
    pass


@dataclass
class Token:
    kind: str
    value: str
    pos: int


@dataclass
class RangeValue:
    start: int | None
    end: int | None
    inclusive: bool = True

    def values(self) -> list[int]:
        if self.start is None or self.end is None:
            raise NuError("infinite ranges are not supported here")
        step = 1 if self.end >= self.start else -1
        stop = self.end + step if self.inclusive else self.end
        return list(range(self.start, stop, step))


@dataclass
class Table:
    columns: list[str]
    rows: list[dict[str, Any]]


def lex(text: str) -> list[Token]:
    out: list[Token] = []
    i = 0
    symbols = "[]{}(),;|:+*/%<>=!."
    while i < len(text):
        c = text[i]
        if c.isspace():
            i += 1
            continue
        if c == "#":
            while i < len(text) and text[i] not in "\r\n":
                i += 1
            continue
        if c in "'\"":
            quote, start = c, i
            i += 1
            buf: list[str] = []
            while i < len(text) and text[i] != quote:
                if quote == '"' and text[i] == "\\" and i + 1 < len(text):
                    i += 1
                    escapes = {"n": "\n", "r": "\r", "t": "\t", "0": "\0", '"': '"', "\\": "\\"}
                    buf.append(escapes.get(text[i], text[i]))
                else:
                    buf.append(text[i])
                i += 1
            if i >= len(text):
                raise NuError(f"expected closing {quote}")
            i += 1
            out.append(Token("string", "".join(buf), start))
            continue
        if text.startswith("..<", i):
            out.append(Token("symbol", "..<", i)); i += 3; continue
        matched = False
        for op in ("not-in", "//", "**", "==", "!=", ">=", "<=", "=~", "!~", "++", ".."):
            if text.startswith(op, i):
                out.append(Token("symbol", op, i)); i += len(op); matched = True; break
        if matched:
            continue
        if c == "-" and i + 1 < len(text) and text[i + 1].isdigit():
            m = re.match(r"-\d+(?:\.\d+)?", text[i:])
            assert m
            out.append(Token("word", m.group(0), i)); i += len(m.group(0)); continue
        if c.isdigit():
            m = re.match(r"\d+(?:\.\d+)?", text[i:])
            assert m
            out.append(Token("word", m.group(0), i)); i += len(m.group(0)); continue
        if c in symbols:
            out.append(Token("symbol", c, i)); i += 1; continue
        start = i
        while i < len(text) and not text[i].isspace() and text[i] not in symbols + "'\"#":
            if any(text.startswith(op, i) for op in ("..<", "..", "==", "!=", ">=", "<=", "++")):
                break
            i += 1
        out.append(Token("word", text[start:i], start))
    return out


def split_top(tokens: list[Token], delimiter: str) -> list[list[Token]]:
    parts: list[list[Token]] = [[]]
    depth = 0
    pairs = {"[": 1, "{": 1, "(": 1, "]": -1, "}": -1, ")": -1}
    for token in tokens:
        if token.value == delimiter and depth == 0:
            parts.append([])
        else:
            parts[-1].append(token)
            depth += pairs.get(token.value, 0)
    return parts


def materialize(value: Any) -> Any:
    if isinstance(value, RangeValue):
        return value.values()
    return value


def rows_of(value: Any) -> list[Any]:
    value = materialize(value)
    if isinstance(value, Table):
        return value.rows
    if isinstance(value, list):
        return value
    return [value]


def plain(value: Any) -> Any:
    value = materialize(value)
    if isinstance(value, Table):
        return [{key: plain(row.get(key)) for key in value.columns} for row in value.rows]
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [plain(v) for v in value]
    return value


class Parser:
    PRECEDENCE = {
        "or": 1, "and": 2, "in": 3, "not-in": 3, "=~": 3, "!~": 3,
        "==": 4, "!=": 4, ">": 4, "<": 4, ">=": 4, "<=": 4,
        "..": 5, "..<": 5, "++": 6, "+": 7, "-": 7,
        "*": 8, "/": 8, "//": 8, "%": 8, "mod": 8, "**": 9,
    }

    def __init__(self, engine: "Engine", tokens: list[Token], env: dict[str, Any] | None = None):
        self.engine = engine
        self.tokens = tokens
        self.i = 0
        self.env = env if env is not None else engine.vars

    def peek(self, value: str | None = None) -> Token | None:
        token = self.tokens[self.i] if self.i < len(self.tokens) else None
        return token if value is None or (token and token.value == value) else None

    def take(self, value: str | None = None) -> Token:
        token = self.peek(value)
        if token is None:
            raise NuError(f"expected {value or 'value'}")
        self.i += 1
        return token

    def expression(self, minimum: int = 0) -> Any:
        value = self.primary()
        while self.peek() is not None:
            op = self.peek().value
            precedence = self.PRECEDENCE.get(op, -1)
            if precedence < minimum:
                break
            self.i += 1
            right = self.expression(precedence + (0 if op == "**" else 1))
            value = self.binary(op, value, right)
        return value

    def primary(self) -> Any:
        token = self.take()
        if token.value in ("-", "not"):
            value = self.primary()
            return -value if token.value == "-" else not bool(value)
        if token.value == "(":
            inner = self.collect_balanced("(", ")")
            value = self.engine.eval_tokens(inner, self.env)
        elif token.value == "[":
            value = self.parse_list()
        elif token.value == "{":
            value = self.parse_record()
        elif token.kind == "string":
            value = token.value
        else:
            word = token.value
            if word == "true": value = True
            elif word == "false": value = False
            elif word in ("null", "nothing"): value = None
            elif re.fullmatch(r"-?\d+", word): value = int(word)
            elif re.fullmatch(r"-?\d+\.\d+", word): value = float(word)
            elif word.startswith("$"):
                name = word[1:]
                if name not in self.env:
                    raise NuError(f"variable not found: ${name}")
                value = self.env[name]
            else:
                value = word
        while self.peek("."):
            self.i += 1
            key = self.take().value
            optional = bool(self.peek("?"))
            if optional: self.i += 1
            value = get_path(value, [key], optional)
        return value

    def collect_balanced(self, opening: str, closing: str) -> list[Token]:
        start = self.i
        depth = 1
        while self.i < len(self.tokens):
            value = self.tokens[self.i].value
            if value == opening: depth += 1
            elif value == closing:
                depth -= 1
                if depth == 0:
                    result = self.tokens[start:self.i]
                    self.i += 1
                    return result
            self.i += 1
        raise NuError(f"expected closing {closing}")

    def parse_list(self) -> Any:
        values: list[Any] = []
        table_mode = False
        while not self.peek("]"):
            if self.peek() is None:
                raise NuError("expected closing ]")
            if self.peek(","):
                self.i += 1; continue
            if self.peek(";"):
                table_mode = True; self.i += 1; continue
            values.append(self.expression())
        self.i += 1
        if table_mode:
            if not values or not isinstance(values[0], list):
                raise NuError("table headers must be a list")
            columns = [display_scalar(v) for v in values[0]]
            if len(columns) != len(set(columns)):
                raise NuError("column_defined_twice")
            rows = []
            for row in values[1:]:
                row = row if isinstance(row, list) else [row]
                rows.append({column: row[n] if n < len(row) else None for n, column in enumerate(columns)})
            return Table(columns, rows)
        return values

    def parse_record(self) -> dict[str, Any]:
        record: dict[str, Any] = {}
        while not self.peek("}"):
            if self.peek() is None:
                raise NuError("expected closing }")
            if self.peek(","):
                self.i += 1; continue
            key = self.take().value
            self.take(":")
            record[key] = self.expression()
        self.i += 1
        return record

    @staticmethod
    def binary(op: str, left: Any, right: Any) -> Any:
        left, right = materialize(left), materialize(right)
        if op == "+": return left + right
        if op == "++": return left + right
        if op == "-": return left - right
        if op == "*": return left * right
        if op == "/": return left / right
        if op == "//": return left // right
        if op in ("%", "mod"): return left % right
        if op == "**": return left ** right
        if op in ("..", "..<"):
            return RangeValue(left, right, op == "..")
        if op == "==": return left == right
        if op == "!=": return left != right
        if op == ">": return left > right
        if op == "<": return left < right
        if op == ">=": return left >= right
        if op == "<=": return left <= right
        if op == "and": return bool(left) and bool(right)
        if op == "or": return bool(left) or bool(right)
        if op == "in": return left in right
        if op == "not-in": return left not in right
        if op == "=~": return re.search(str(right), str(left)) is not None
        if op == "!~": return re.search(str(right), str(left)) is None
        raise NuError(f"unknown operator: {op}")


def get_path(value: Any, path: list[Any], optional: bool = False) -> Any:
    current = materialize(value)
    for raw_key in path:
        key = str(raw_key)
        try:
            if isinstance(current, Table):
                if key.isdigit(): current = current.rows[int(key)]
                else: current = [row[key] for row in current.rows]
            elif isinstance(current, list):
                if key.lstrip("-").isdigit(): current = current[int(key)]
                else: current = [item.get(key) if isinstance(item, dict) else None for item in current]
            elif isinstance(current, dict): current = current[key]
            else: raise KeyError(key)
        except (KeyError, IndexError, TypeError):
            if optional: return None
            raise NuError(f"cannot find column or row '{key}'")
    return current


def set_path(value: Any, path: list[str], replacement: Any) -> Any:
    if not path:
        return replacement
    if isinstance(value, Table):
        for row in value.rows:
            set_path(row, path, replacement)
        return value
    if isinstance(value, list):
        for item in value:
            set_path(item, path, replacement)
        return value
    current = value
    for key in path[:-1]:
        current = current.setdefault(key, {})
    current[path[-1]] = replacement
    return value


class Engine:
    COMMANDS = {
        "echo", "print", "length", "get", "first", "last", "skip", "take", "range",
        "columns", "values", "reject", "select", "drop", "sort", "sort-by", "reverse",
        "uniq", "compact", "flatten", "wrap", "enumerate", "append", "prepend",
        "where", "each", "lines", "split", "into", "str", "math", "to", "from",
        "open", "save", "mkdir", "touch", "rm", "cp", "mv", "ls", "glob", "pwd", "cd",
    }

    def __init__(self):
        self.vars: dict[str, Any] = {"env": dict(os.environ)}

    def eval(self, source: str) -> Any:
        return self.eval_tokens(lex(source), self.vars)

    def eval_tokens(self, tokens: list[Token], env: dict[str, Any] | None = None) -> Any:
        env = env if env is not None else self.vars
        result: Any = None
        for statement in split_top(tokens, ";"):
            if not statement: continue
            if statement[0].value in ("let", "mut", "const"):
                if len(statement) < 4 or statement[2].value != "=":
                    raise NuError("invalid variable declaration")
                name = statement[1].value.lstrip("$")
                env[name] = self.eval_pipeline(statement[3:], None, env)
                result = None
            elif statement[0].value == "cd":
                result = self.command(statement, None, env)
            else:
                result = self.eval_pipeline(statement, None, env)
        return result

    def eval_pipeline(self, tokens: list[Token], value: Any, env: dict[str, Any]) -> Any:
        for segment in split_top(tokens, "|"):
            if not segment: continue
            first = segment[0].value
            if first in self.COMMANDS:
                value = self.command(segment, value, env)
            else:
                local = dict(env)
                local["in"] = value
                parser = Parser(self, segment, local)
                value = parser.expression()
                if parser.i != len(segment):
                    raise NuError(f"unexpected argument: {segment[parser.i].value}")
        return value

    def args(self, tokens: list[Token], env: dict[str, Any]) -> list[Any]:
        parser = Parser(self, tokens, env)
        result: list[Any] = []
        while parser.i < len(tokens):
            if parser.peek(","): parser.i += 1; continue
            result.append(parser.expression())
        return result

    def closure(self, tokens: list[Token], item: Any, env: dict[str, Any]) -> Any:
        if tokens and tokens[0].value == "{" and tokens[-1].value == "}":
            tokens = tokens[1:-1]
        local = dict(env)
        local.update({"it": item, "in": item})
        if tokens and tokens[0].value == "|":
            end = next((n for n in range(1, len(tokens)) if tokens[n].value == "|"), None)
            if end is not None:
                names = [t.value.lstrip("$") for t in tokens[1:end] if t.value != ","]
                if names: local[names[0]] = item
                tokens = tokens[end + 1:]
        return self.eval_tokens(tokens, local)

    def command(self, tokens: list[Token], value: Any, env: dict[str, Any]) -> Any:
        words = [t.value for t in tokens]
        name = words[0]
        rest = tokens[1:]
        if name == "echo":
            vals = self.args(rest, env)
            return vals[0] if len(vals) == 1 else vals
        if name == "print":
            vals = self.args(rest, env)
            sys.stdout.write(" ".join(display_scalar(v) for v in vals) + "\n")
            return None
        if name == "length":
            value = materialize(value)
            return len(value.rows if isinstance(value, Table) else value) if value is not None else 0
        if name == "get":
            optional = any(t.value == "-o" for t in rest)
            paths = [v for v in self.args([t for t in rest if t.value != "-o"], env)]
            result = value
            for path in paths:
                result = get_path(result, str(path).split("."), optional)
            return result
        if name in ("first", "last", "skip", "take"):
            sequence = rows_of(value)
            count = int(self.args(rest, env)[0]) if rest else None
            if name == "first": return sequence[0] if count is None else sequence[:count]
            if name == "last": return sequence[-1] if count is None else sequence[-count:]
            if name == "skip": return sequence[(count or 1):]
            return sequence[:(count or 1)]
        if name == "range":
            spec = self.args(rest, env)[0]
            if isinstance(spec, RangeValue): return rows_of(value)[spec.values()[0]:spec.values()[-1] + 1]
        if name == "columns":
            if isinstance(value, Table): return value.columns
            if isinstance(value, dict): return list(value)
            if isinstance(value, list) and value and isinstance(value[0], dict): return list(value[0])
            return []
        if name == "values":
            if isinstance(value, dict): return list(value.values())
            if isinstance(value, Table): return [list(row.values()) for row in value.rows]
        if name in ("reject", "select"):
            fields = [str(x) for x in self.args(rest, env)]
            source = rows_of(value)
            rows = []
            for row in source:
                if not isinstance(row, dict): continue
                if name == "reject": rows.append({k: v for k, v in row.items() if k not in fields})
                else: rows.append({k: row.get(k) for k in fields})
            columns = list(rows[0]) if rows else ([] if name == "reject" else fields)
            return Table(columns, rows) if isinstance(value, Table) else (rows[0] if isinstance(value, dict) else rows)
        if name == "drop":
            if rest and rest[0].value == "column":
                count = int(self.args(rest[1:], env)[0])
                cols = (value.columns if isinstance(value, Table) else list(rows_of(value)[0]))[:-count]
                rows = [{k: row[k] for k in cols} for row in rows_of(value)]
                return Table(cols, rows)
            count = int(self.args(rest, env)[0]) if rest else 1
            return rows_of(value)[:-count]
        if name in ("sort", "sort-by"):
            insensitive = any(t.value in ("-i", "--ignore-case") for t in rest)
            fields = [str(v) for v in self.args([t for t in rest if not t.value.startswith("-")], env)]
            def norm(v: Any) -> Any: return v.casefold() if insensitive and isinstance(v, str) else v
            data = rows_of(value)
            if name == "sort-by" or fields:
                data = sorted(data, key=lambda row: tuple(norm(row.get(f)) for f in fields))
            else: data = sorted(data, key=norm)
            return Table(value.columns, data) if isinstance(value, Table) else data
        if name == "reverse": return list(reversed(rows_of(value))) if not isinstance(value, str) else value[::-1]
        if name == "uniq":
            found = []
            for item in rows_of(value):
                if item not in found: found.append(item)
            return found
        if name == "compact": return [v for v in rows_of(value) if v not in (None, "")]
        if name == "flatten":
            result = []
            for item in rows_of(value):
                if isinstance(item, list): result.extend(item)
                else: result.append(item)
            return result
        if name == "wrap":
            column = str(self.args(rest, env)[0])
            return Table([column], [{column: item} for item in rows_of(value)])
        if name == "enumerate": return Table(["index", "item"], [{"index": i, "item": v} for i, v in enumerate(rows_of(value))])
        if name in ("append", "prepend"):
            addition = self.args(rest, env)
            data = rows_of(value)
            return data + addition if name == "append" else addition + data
        if name in ("where", "each"):
            data = rows_of(value)
            if name == "where":
                return [item for item in data if self.closure(rest, item, env)]
            return [self.closure(rest, item, env) for item in data]
        if name == "lines": return str(value).splitlines()
        if name == "split":
            mode = rest[0].value
            delimiter = str(self.args(rest[1:], env)[0])
            pieces = str(value).split(delimiter)
            if mode == "row": return pieces
            return Table([f"column{i + 1}" for i in range(len(pieces))], [{f"column{i + 1}": p for i, p in enumerate(pieces)}])
        if name == "into":
            mode = rest[0].value
            paths = [str(v) for v in self.args(rest[1:], env)]
            convert = {"int": int, "float": float, "string": display_scalar, "bool": bool}.get(mode)
            if convert is None: raise NuError(f"unsupported conversion: {mode}")
            if paths:
                for path in paths:
                    old = get_path(value, path.split("."))
                    set_path(value, path.split("."), convert(old))
                return value
            if isinstance(value, list): return [convert(v) for v in value]
            return convert(value)
        if name == "str": return self.str_command(rest, value, env)
        if name == "math": return self.math_command(rest, value)
        if name == "to": return self.to_command(rest, value, env)
        if name == "from": return self.from_command(rest, value, env)
        if name in ("open", "save", "mkdir", "touch", "rm", "cp", "mv", "ls", "glob", "pwd", "cd"):
            return self.fs_command(name, rest, value, env)
        raise NuError(f"command not found: {name}")

    def str_command(self, tokens: list[Token], value: Any, env: dict[str, Any]) -> Any:
        action = tokens[0].value
        args = self.args(tokens[1:], env)
        if action == "upcase": return str(value).upper()
        if action == "downcase": return str(value).lower()
        if action == "capitalize": return str(value).capitalize()
        if action == "trim": return str(value).strip()
        if action == "length": return len(str(value).encode("utf-8"))
        if action == "reverse": return str(value)[::-1]
        if action == "contains": return str(args[0]) in str(value)
        if action == "starts-with": return str(value).startswith(str(args[0]))
        if action == "ends-with": return str(value).endswith(str(args[0]))
        if action == "index-of": return str(value).find(str(args[0]))
        if action == "replace":
            return str(value).replace(str(args[0]), str(args[1]), 1)
        if action == "join": return str(args[0] if args else "").join(display_scalar(v) for v in rows_of(value))
        if action == "substring":
            spec = args[0]
            if isinstance(spec, RangeValue):
                start = spec.start or 0
                end = spec.end
                if end is None: return str(value)[start:]
                return str(value)[start:end + (1 if spec.inclusive else 0)] if start <= end else ""
        raise NuError(f"unsupported str command: {action}")

    def math_command(self, tokens: list[Token], value: Any) -> Any:
        action = tokens[0].value
        data = rows_of(value)
        if isinstance(value, Table):
            return {column: self.math_command(tokens, [row[column] for row in value.rows]) for column in value.columns}
        if action == "sum": return sum(data)
        if action in ("avg", "average"): return sum(data) / len(data)
        if action == "min": return min(data)
        if action == "max": return max(data)
        if action == "median": return sorted(data)[len(data) // 2]
        if action == "product": return math.prod(data)
        if action == "round": return round(float(value))
        if action == "abs": return abs(value)
        if action == "sqrt": return math.sqrt(value)
        raise NuError(f"unsupported math command: {action}")

    def to_command(self, tokens: list[Token], value: Any, env: dict[str, Any]) -> str:
        fmt = tokens[0].value
        raw = any(t.value in ("-r", "--raw") for t in tokens[1:])
        data = plain(value)
        if fmt == "json":
            return json.dumps(data, ensure_ascii=False, separators=(",", ":") if raw else None, indent=None if raw else 2)
        if fmt in ("csv", "tsv"):
            delimiter = "\t" if fmt == "tsv" else ","
            output = io.StringIO(newline="")
            rows = data if isinstance(data, list) else [data]
            if rows and isinstance(rows[0], dict):
                writer = csv.DictWriter(output, fieldnames=list(rows[0]), delimiter=delimiter, lineterminator="\n")
                writer.writeheader(); writer.writerows(rows)
            else:
                csv.writer(output, delimiter=delimiter, lineterminator="\n").writerow(rows)
            return output.getvalue()
        if fmt == "nuon": return nuon(value)
        raise NuError(f"unsupported output format: {fmt}")

    def from_command(self, tokens: list[Token], value: Any, env: dict[str, Any]) -> Any:
        fmt = tokens[0].value
        text = str(value)
        if fmt == "json":
            if any(t.value in ("-o", "--objects") for t in tokens[1:]):
                return [json.loads(line) for line in text.splitlines() if line.strip()]
            return json.loads(text)
        if fmt in ("csv", "tsv"):
            delimiter = "\t" if fmt == "tsv" else ","
            rows = list(csv.DictReader(io.StringIO(text), delimiter=delimiter))
            return Table(list(rows[0]) if rows else [], rows)
        raise NuError(f"unsupported input format: {fmt}")

    def fs_command(self, name: str, tokens: list[Token], value: Any, env: dict[str, Any]) -> Any:
        args = [str(v) for v in self.args([t for t in tokens if not t.value.startswith("-")], env)]
        if name == "pwd": return str(Path.cwd())
        if name == "cd": os.chdir(args[0] if args else Path.home()); return None
        if name == "mkdir":
            for arg in args: Path(arg).mkdir(parents=True, exist_ok=True)
            return None
        if name == "touch":
            for arg in args: Path(arg).touch()
            return None
        if name == "rm":
            recursive = any(t.value in ("-r", "--recursive") for t in tokens)
            for arg in args:
                path = Path(arg)
                if path.is_dir():
                    if not recursive: raise NuError("cannot remove directory without --recursive")
                    shutil.rmtree(path)
                elif path.exists(): path.unlink()
            return None
        if name in ("cp", "mv"):
            source, target = args[-2:]
            (shutil.copy2 if name == "cp" else shutil.move)(source, target)
            return None
        if name == "save":
            path = Path(args[-1])
            append = any(t.value in ("-a", "--append") for t in tokens)
            mode = "ab" if append else "wb"
            content = value if isinstance(value, bytes) else display_scalar(value).encode("utf-8")
            with path.open(mode) as handle: handle.write(content)
            return None
        if name == "open":
            raw = any(t.value in ("-r", "--raw") for t in tokens)
            path = Path(args[-1])
            data = path.read_text(encoding="utf-8-sig")
            if raw: return data
            if path.suffix.lower() == ".json": return json.loads(data)
            if path.suffix.lower() in (".csv", ".tsv"):
                fmt = "tsv" if path.suffix.lower() == ".tsv" else "csv"
                return self.from_command([Token("word", fmt, 0)], data, env)
            return data
        if name == "glob":
            import glob as glob_module
            return glob_module.glob(args[0], recursive=True)
        if name == "ls":
            pattern = args[0] if args else "*"
            base = Path(pattern).parent if Path(pattern).parent != Path("") else Path(".")
            mask = Path(pattern).name
            entries = [p for p in base.iterdir() if fnmatch.fnmatch(p.name, mask)]
            rows = []
            for path in sorted(entries, key=lambda p: p.name.casefold()):
                stat = path.stat()
                rows.append({"name": str(path), "type": "dir" if path.is_dir() else "file", "size": stat.st_size, "modified": int(stat.st_mtime)})
            return Table(["name", "type", "size", "modified"], rows)
        raise NuError(f"unsupported filesystem command: {name}")


def display_scalar(value: Any) -> str:
    if value is None: return ""
    if value is True: return "true"
    if value is False: return "false"
    if isinstance(value, float):
        if math.isnan(value): return "NaN"
        if math.isinf(value): return "inf" if value > 0 else "-inf"
        return repr(value)
    if isinstance(value, (dict, list, Table, RangeValue)): return nuon(value)
    return str(value)


def nuon(value: Any) -> str:
    value = materialize(value)
    if isinstance(value, Table): value = value.rows
    if value is None: return "null"
    if isinstance(value, bool): return "true" if value else "false"
    if isinstance(value, str): return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list): return "[" + ", ".join(nuon(v) for v in value) + "]"
    if isinstance(value, dict): return "{" + ", ".join(f"{k}: {nuon(v)}" for k, v in value.items()) + "}"
    return display_scalar(value)


def render_table(columns: list[str], rows: list[list[Any]], header: bool) -> str:
    string_rows = [[display_scalar(cell) for cell in row] for row in rows]
    all_rows = ([columns] if header else []) + string_rows
    widths = [max(len(row[i]) if i < len(row) else 0 for row in all_rows) for i in range(len(columns))]
    top = "╭" + "┬".join("─" * (w + 2) for w in widths) + "╮"
    bottom = "╰" + "┴".join("─" * (w + 2) for w in widths) + "╯"
    def line(row: list[str]) -> str:
        return "│ " + " │ ".join((row[i] if i < len(row) else "").ljust(widths[i]) for i in range(len(widths))) + " │"
    output = [top]
    if header:
        output.append(line(columns))
        output.append("├" + "┼".join("─" * (w + 2) for w in widths) + "┤")
    output.extend(line(row) for row in string_rows)
    output.append(bottom)
    return "\n".join(output)


def render(value: Any) -> str:
    value = materialize(value)
    if value is None: return ""
    if isinstance(value, Table):
        columns = ["#"] + value.columns
        rows = [[i] + [row.get(c) for c in value.columns] for i, row in enumerate(value.rows)]
        return render_table(columns, rows, True)
    if isinstance(value, dict):
        width_key = max((len(str(k)) for k in value), default=0)
        width_val = max((len(display_scalar(v)) for v in value.values()), default=0)
        return render_table([" " * width_key, " " * width_val], [[k, v] for k, v in value.items()], False)
    if isinstance(value, list):
        if value and all(isinstance(v, dict) for v in value):
            columns = list(value[0])
            return render(Table(columns, value))
        return render_table(["#", "value"], [[i, v] for i, v in enumerate(value)], False)
    return display_scalar(value)


def parse_cli(argv: list[str]) -> str | None:
    command = None
    i = 0
    while i < len(argv):
        if argv[i] in ("-c", "--commands") and i + 1 < len(argv):
            command = argv[i + 1]; i += 2
        elif argv[i] in ("-h", "--help"):
            return None
        elif argv[i] in ("-v", "--version"):
            sys.stdout.buffer.write(b"0.106.1\n")
            raise SystemExit(0)
        else: i += 1
    return command


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    try:
        source = parse_cli(argv)
        if source is None:
            if not argv or any(a in ("-h", "--help") for a in argv):
                sys.stdout.write("Nushell\n\nUsage:\n  nu [options]\n")
                return 0
            source = sys.stdin.read()
        value = Engine().eval(source)
        output = render(value)
        if output:
            encoded = output.encode("utf-8")
            sys.stdout.buffer.write(encoded if encoded.endswith(b"\n") else encoded + b"\n")
        return 0
    except NuError as error:
        sys.stderr.write(f"Error: nu::shell::error\n\n  × {error}\n")
        return 1
    except (ValueError, TypeError, ZeroDivisionError, OSError, json.JSONDecodeError) as error:
        sys.stderr.write(f"Error: nu::shell::error\n\n  × {error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
