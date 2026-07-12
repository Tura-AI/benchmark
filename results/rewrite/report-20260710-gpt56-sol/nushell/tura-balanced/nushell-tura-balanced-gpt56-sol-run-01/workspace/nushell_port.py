#!/usr/bin/env python3
"""A clean-room Python implementation of the benchmarked Nushell CLI surface."""

from __future__ import annotations

import csv
import fnmatch
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
from typing import Any, Callable, Iterable


@dataclass
class Raw:
    data: str
    preserve_newline: bool = False


@dataclass
class RangeValue:
    start: int
    end: int
    inclusive: bool = True

    def values(self) -> list[int]:
        stop = self.end + (1 if self.end >= self.start else -1) if self.inclusive else self.end
        return list(range(self.start, stop, 1 if self.end >= self.start else -1))


@dataclass
class Block:
    params: list[str]
    body: str


@dataclass
class Token:
    kind: str
    text: str
    pos: int


class NuError(Exception):
    def __init__(self, message: str, code: str = "nu::shell::error", pos: int = 0):
        super().__init__(message)
        self.message = message
        self.code = code
        self.pos = pos


MULTI = ("not-in", "++=", "==", "!=", "<=", ">=", "//", "**", "++", "=~", "!~", "..=", "..<", "..")


def lex(source: str) -> list[Token]:
    out: list[Token] = []
    i = 0
    n = len(source)
    while i < n:
        c = source[i]
        if c in " \t\r":
            i += 1
            continue
        if c == "#":
            while i < n and source[i] != "\n":
                i += 1
            continue
        if c == "\n" or c == ";":
            out.append(Token("sep", c, i)); i += 1; continue
        if c == "-" and i + 1 < n and (source[i + 1] == "-" or source[i + 1].isalpha()):
            start = i
            i += 1
            while i < n and (source[i].isalnum() or source[i] in "-_"):
                i += 1
            out.append(Token("word", source[start:i], start)); continue
        if c in "'\"`":
            quote, start = c, i
            i += 1
            buf = []
            while i < n and source[i] != quote:
                if quote == '"' and source[i] == "\\" and i + 1 < n:
                    esc = source[i + 1]
                    maps = {"n": "\n", "r": "\r", "t": "\t", '"': '"', "\\": "\\"}
                    if esc == "u" and i + 2 < n and source[i + 2] == "{":
                        end = source.find("}", i + 3)
                        if end >= 0:
                            buf.append(chr(int(source[i + 3:end], 16))); i = end + 1; continue
                    buf.append(maps.get(esc, esc)); i += 2; continue
                buf.append(source[i]); i += 1
            if i >= n:
                raise NuError("Unexpected end of code.", "nu::parser::unexpected_eof", start)
            i += 1
            out.append(Token("string", "".join(buf), start)); continue
        number = re.match(r"(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]+)(?:[eE][+-]?\d+)?", source[i:])
        if number:
            text = number.group(0)
            # A range starts with an integer followed by two dots, not a float.
            if text.endswith(".") and source.startswith(".", i + len(text)):
                text = text[:-1]
            out.append(Token("float" if "." in text or "e" in text.lower() else "int", text, i))
            i += len(text)
            continue
        matched = next((op for op in MULTI if source.startswith(op, i)), None)
        if matched:
            out.append(Token("op", matched, i)); i += len(matched); continue
        if c in "[]{}():,|+-*/%^<>=!":
            out.append(Token("op", c, i)); i += 1; continue
        if c == "$":
            start = i; i += 1
            while i < n and (source[i].isalnum() or source[i] in "_-?"):
                i += 1
            out.append(Token("var", source[start + 1:i], start)); continue
        start = i
        while i < n and source[i] not in " \t\r\n;[]{}():,|+*/%^<>=!\"'`":
            if source[i] == "-" and i > start:
                # Hyphens are part of command names and bare words.
                i += 1; continue
            i += 1
        text = source[start:i]
        if not text:
            out.append(Token("op", c, i)); i += 1
        elif re.fullmatch(r"-?\d[\d_]*", text):
            out.append(Token("int", text, start))
        elif re.fullmatch(r"-?(?:\d[\d_]*)?\.\d[\d_]*(?:[eE][+-]?\d+)?", text):
            out.append(Token("float", text, start))
        else:
            out.append(Token("word", text, start))
    out.append(Token("eof", "", n))
    return out


class Parser:
    def __init__(self, source: str, env: dict[str, Any] | None = None, pipeline: Any = None):
        self.source = source
        self.tokens = lex(source)
        self.i = 0
        self.env = env if env is not None else {}
        self.pipeline = pipeline

    def peek(self, text: str | None = None) -> Token | bool:
        token = self.tokens[self.i]
        return token.text == text if text is not None else token

    def take(self, text: str | None = None) -> Token:
        token = self.tokens[self.i]
        if text is not None and token.text != text:
            raise NuError(f"expected {text}", "nu::parser::parse_mismatch", token.pos)
        self.i += 1
        return token

    def parse(self) -> Any:
        result = None
        while self.peek().kind != "eof":
            while self.peek().kind == "sep": self.take()
            if self.peek().kind == "eof": break
            result = self.statement()
            while self.peek().kind == "sep": self.take()
        return result

    def statement(self) -> Any:
        if self.peek().kind == "word" and self.peek().text in ("let", "mut"):
            self.take(); name = self.take()
            if name.kind not in ("word", "var"): raise NuError("expected variable name", pos=name.pos)
            self.take("=")
            value = self.pipeline_expr()
            self.env[name.text] = value
            return None
        return self.pipeline_expr()

    def pipeline_expr(self) -> Any:
        token = self.peek()
        if token.kind == "word" and token.text not in ("true", "false", "null", "nothing"):
            value = self.command(None)
        else:
            value = self.expression()
        while self.peek("|"):
            self.take()
            value = self.command(value)
        return value

    def expression(self, min_prec: int = 0) -> Any:
        left = self.prefix()
        precedence = {"or": 1, "xor": 1, "and": 2, "in": 3, "not-in": 3, "==": 3, "!=": 3,
                      "<": 3, "<=": 3, ">": 3, ">=": 3, "=~": 3, "!~": 3,
                      "..": 4, "..=": 4, "..<": 4, "+": 5, "-": 5, "++": 5,
                      "*": 6, "/": 6, "//": 6, "%": 6, "mod": 6, "**": 7}
        while True:
            token = self.peek()
            op = token.text
            if token.kind == "word" and op == "not" and self.tokens[self.i + 1].text == "in":
                op = "not-in"
            prec = precedence.get(op, -1)
            if prec < min_prec: break
            self.take()
            if token.text == "not": self.take("in")
            right = self.expression(prec + (0 if op == "**" else 1))
            left = apply_operator(op, left, right, token.pos)
        return left

    def prefix(self) -> Any:
        token = self.peek()
        if token.text in ("-", "+", "not"):
            self.take(); val = self.expression(8)
            return -val if token.text == "-" else (+val if token.text == "+" else not truthy(val))
        if token.text == "(":
            self.take(); val = self.pipeline_expr(); self.take(")"); return self.postfix(val)
        if token.text == "[": return self.postfix(self.list_or_table())
        if token.text == "{": return self.postfix(self.record_or_block())
        if token.kind == "int": self.take(); return self.postfix(int(token.text.replace("_", "")))
        if token.kind == "float": self.take(); return self.postfix(float(token.text.replace("_", "")))
        if token.kind == "string": self.take(); return self.postfix(interpolate(token.text, self.env))
        if token.kind == "var":
            self.take()
            if token.text in ("in",): val = self.pipeline
            elif token.text in ("env",): val = OrderedDict(os.environ)
            elif token.text in self.env: val = self.env[token.text]
            else: raise NuError(f"Variable not found: ${token.text}", "nu::parser::variable_not_found", token.pos)
            return self.postfix(val)
        if token.kind == "word":
            if token.text == "true": self.take(); return True
            if token.text == "false": self.take(); return False
            if token.text in ("null", "nothing"): self.take(); return None
            # At an expression boundary, known source commands consume the rest of the segment.
            if token.text in SOURCE_COMMANDS or (self.tokens[self.i + 1].kind == "word" and f"{token.text} {self.tokens[self.i+1].text}" in COMMANDS):
                return self.command(None)
            self.take(); return self.postfix(token.text)
        raise NuError("Parse error", "nu::parser::unexpected_keyword", token.pos)

    def postfix(self, value: Any) -> Any:
        while self.peek().kind == "word" and self.peek().text.startswith("."):
            part = self.take().text[1:]
            value = get_path(value, [part])
        return value

    def list_or_table(self) -> Any:
        self.take("[")
        if self.peek("["):
            first = self.list_or_table()
            if self.peek(";"):
                self.take()
                rows = []
                while not self.peek("]"):
                    row = self.list_or_table()
                    rows.append(OrderedDict(zip((str(x) for x in first), row)))
                    if self.peek(","): self.take()
                self.take("]")
                return rows
            values = [first]
            while not self.peek("]"):
                values.append(self.expression())
                if self.peek(","): self.take()
            self.take("]")
            return values
        values = []
        while not self.peek("]"):
            if self.peek().kind == "eof": raise NuError("Unexpected end of code.", "nu::parser::unexpected_eof", self.peek().pos)
            values.append(self.expression())
            if self.peek(","): self.take()
        self.take("]")
        return values

    def record_or_block(self) -> Any:
        start = self.take("{")
        # A leading | or variable declaration identifies a closure.
        if self.peek("|"):
            self.take(); params = []
            while not self.peek("|"):
                tok = self.take(); params.append(tok.text)
            self.take("|")
            body_start = self.peek().pos
            depth = 1; j = self.i
            while j < len(self.tokens):
                if self.tokens[j].text == "{": depth += 1
                elif self.tokens[j].text == "}":
                    depth -= 1
                    if depth == 0: break
                j += 1
            body_end = self.tokens[j].pos
            self.i = j + 1
            return Block(params, self.source[body_start:body_end])
        rec: OrderedDict[str, Any] = OrderedDict()
        while not self.peek("}"):
            key = self.take()
            if key.kind not in ("word", "string", "int"): raise NuError("expected record key", pos=key.pos)
            self.take(":")
            rec[key.text] = self.expression()
            if self.peek(","): self.take()
        self.take("}")
        return rec

    def command(self, value: Any) -> Any:
        first = self.take()
        if first.kind != "word": raise NuError("expected command", pos=first.pos)
        name = first.text
        if self.peek().kind == "word" and f"{name} {self.peek().text}" in COMMANDS:
            name += " " + self.take().text
        args: list[Any] = []
        flags: dict[str, Any] = {}
        while self.peek().kind not in ("eof", "sep") and not self.peek("|") and not self.peek(")") and not self.peek("}"):
            tok = self.peek()
            if tok.kind == "word" and tok.text.startswith("--"):
                flag = self.take().text[2:]
                if flag in BOOLEAN_FLAGS:
                    flags[flag] = True
                elif self.peek().kind not in ("eof", "sep") and not self.peek("|") and not (self.peek().kind == "word" and self.peek().text.startswith("-")):
                    flags[flag] = self.expression()
                else: flags[flag] = True
            elif tok.kind == "word" and tok.text.startswith("-") and not re.match(r"-\d", tok.text):
                flags[self.take().text[1:]] = True
            elif name in PATH_ARG_COMMANDS and tok.kind == "word":
                path = self.take().text
                while self.peek("/") and self.tokens[self.i + 1].kind in ("word", "int"):
                    self.take()
                    path += "/" + self.take().text
                args.append(path)
            elif name == "where" and tok.text != "{":
                # Preserve the predicate tokens as a closure over each row.
                start = tok.pos; j = self.i; depth = 0
                while j < len(self.tokens):
                    t = self.tokens[j]
                    if t.text in "[({": depth += 1
                    elif t.text in "]) }": depth -= 1
                    if depth <= 0 and (t.text == "|" or t.kind in ("sep", "eof")): break
                    j += 1
                end = self.tokens[j].pos
                args.append(self.source[start:end].strip()); self.i = j
            else:
                args.append(self.expression())
        func = COMMANDS.get(name)
        if func is None: raise NuError(f"Command `{name}` not found", "nu::shell::external_command", first.pos)
        return func(value, args, flags, self)


def interpolate(text: str, env: dict[str, Any]) -> str:
    return re.sub(r"\$([A-Za-z_][\w-]*)", lambda m: scalar(env.get(m.group(1), "")), text)


def truthy(value: Any) -> bool:
    return bool(value)


def materialize(value: Any) -> Any:
    return value.values() if isinstance(value, RangeValue) else value


def apply_operator(op: str, left: Any, right: Any, pos: int) -> Any:
    left, right = materialize(left), materialize(right)
    try:
        if op == "+": return left + right
        if op == "-": return left - right
        if op == "*": return left * right
        if op == "/":
            if right == 0: raise NuError("Division by zero.", "nu::shell::division_by_zero", pos)
            result = left / right
            return int(result) if isinstance(left, int) and isinstance(right, int) and result.is_integer() else result
        if op == "//":
            if right == 0: raise NuError("Division by zero.", "nu::shell::division_by_zero", pos)
            return left // right
        if op in ("%", "mod"): return left % right
        if op == "**": return left ** right
        if op == "++": return left + right
        if op == "==": return left == right
        if op == "!=": return left != right
        if op == "<": return left < right
        if op == "<=": return left <= right
        if op == ">": return left > right
        if op == ">=": return left >= right
        if op == "and": return truthy(left) and truthy(right)
        if op == "or": return truthy(left) or truthy(right)
        if op == "xor": return bool(left) != bool(right)
        if op == "in": return left in right
        if op == "not-in": return left not in right
        if op == "=~": return re.search(str(right), str(left)) is not None
        if op == "!~": return re.search(str(right), str(left)) is None
        if op in ("..", "..="): return RangeValue(int(left), int(right), True)
        if op == "..<": return RangeValue(int(left), int(right), False)
    except NuError: raise
    except Exception as exc: raise NuError(str(exc), "nu::shell::type_mismatch", pos) from exc
    raise NuError(f"unsupported operator {op}", pos=pos)


def as_list(value: Any) -> list[Any]:
    value = materialize(value)
    if isinstance(value, list): return value
    if value is None: return []
    return [value]


def scalar(value: Any) -> str:
    if value is None: return ""
    if value is True: return "true"
    if value is False: return "false"
    if isinstance(value, float):
        if math.isnan(value): return "NaN"
        if math.isinf(value): return "inf" if value > 0 else "-inf"
        return str(value)
    if isinstance(value, Raw): return value.data
    return str(value)


def get_path(value: Any, path: list[Any]) -> Any:
    current = materialize(value)
    for part in path:
        if isinstance(current, list):
            if str(part).lstrip("-").isdigit(): current = current[int(part)]
            else: current = [row.get(str(part)) for row in current if isinstance(row, dict) and str(part) in row]
        elif isinstance(current, dict): current = current[str(part)]
        else: raise NuError(f"Cannot find column '{part}'", "nu::shell::column_not_found")
    return current


def closure_eval(block: Block, value: Any, parser: Parser, index: int = 0) -> Any:
    env = dict(parser.env)
    env["in"] = value
    if block.params:
        env[block.params[0]] = value
    if len(block.params) > 1: env[block.params[1]] = index
    return Parser(block.body, env, value).parse()


def cmd_echo(_v, args, _f, _p): return args[0] if len(args) == 1 else args
def cmd_length(v, args, _f, _p):
    v = materialize(v)
    if args and isinstance(v, list): return len([x for x in v if isinstance(x, dict) and args[0] in x])
    return len(v) if v is not None else 0
def cmd_get(v, args, _f, _p): return get_path(v, [str(a) for a in args])
def cmd_columns(v, _a, _f, _p):
    if isinstance(v, dict): return list(v.keys())
    return list(v[0].keys()) if isinstance(v, list) and v and isinstance(v[0], dict) else []
def cmd_values(v, _a, _f, _p):
    if isinstance(v, dict): return list(v.values())
    return [list(x.values()) for x in v] if isinstance(v, list) else []
def cmd_first(v, args, _f, _p):
    vals = as_list(v); return vals[:int(args[0])] if args else (vals[0] if vals else None)
def cmd_last(v, args, _f, _p):
    vals = as_list(v); return vals[-int(args[0]):] if args else (vals[-1] if vals else None)
def cmd_skip(v, args, _f, _p): return as_list(v)[int(args[0]) if args else 1:]
def cmd_take(v, args, _f, _p): return as_list(v)[:int(args[0]) if args else 1]
def cmd_reverse(v, _a, _f, _p): return list(reversed(as_list(v)))
def cmd_sort(v, args, flags, _p):
    vals = as_list(v); reverse = bool(flags.get("reverse") or flags.get("r"))
    if args: return sorted(vals, key=lambda x: tuple(x.get(str(a)) for a in args) if isinstance(x, dict) else x, reverse=reverse)
    return sorted(vals, reverse=reverse)
def cmd_uniq(v, _a, flags, _p):
    out=[]
    for x in as_list(v):
        if x not in out: out.append(x)
    return out
def cmd_where(v, args, _f, p):
    pred = args[0] if args else ""
    if isinstance(pred,Block):
        return [row for i,row in enumerate(as_list(v)) if truthy(closure_eval(pred,row,p,i))]
    out=[]
    for row in as_list(v):
        env=dict(p.env)
        if isinstance(row, dict): env.update(row)
        try:
            if truthy(Parser(pred, env, row).parse()): out.append(row)
        except NuError:
            # Bare column references are variables in row predicates.
            expr=re.sub(r"\b([A-Za-z_][\w-]*)\b", lambda m: "$"+m.group(1) if m.group(1) in env else m.group(0), pred)
            if truthy(Parser(expr, env, row).parse()): out.append(row)
    return out
def cmd_each(v, args, _f, p):
    block = args[0]
    if not isinstance(block, Block): raise NuError("expected closure")
    return [closure_eval(block, x, p, i) for i, x in enumerate(as_list(v))]
def cmd_filter(v, args, _f, p):
    block=args[0]; return [x for i,x in enumerate(as_list(v)) if truthy(closure_eval(block,x,p,i))]
def cmd_reduce(v, args, flags, p):
    vals=as_list(v); block=args[-1]
    if "fold" in flags: acc=flags["fold"]
    elif vals: acc=vals.pop(0)
    else: return None
    for x in vals:
        env=dict(p.env); env["it"]=x; env["acc"]=acc
        if isinstance(block, Block):
            if block.params: env[block.params[0]]=x
            if len(block.params)>1: env[block.params[1]]=acc
            acc=Parser(block.body,env,x).parse()
    return acc
def cmd_enumerate(v, _a, _f, _p): return [OrderedDict(index=i,item=x) for i,x in enumerate(as_list(v))]
def cmd_wrap(v, args, _f, _p): return [OrderedDict([(str(args[0]),x)]) for x in as_list(v)]
def cmd_flatten(v, args, _f, _p):
    out=[]
    for x in as_list(v):
        if isinstance(x,list): out.extend(x)
        elif isinstance(x,dict) and args:
            seq=x.get(str(args[0]),[])
            for y in as_list(seq):
                row=OrderedDict((k,z) for k,z in x.items() if k!=str(args[0]))
                if isinstance(y,dict): row.update(y)
                else: row[str(args[0])]=y
                out.append(row)
        else: out.append(x)
    return out
def cmd_select(v,args,_f,_p): return [OrderedDict((str(k),x.get(str(k))) for k in args) for x in as_list(v)] if isinstance(v,list) else OrderedDict((str(k),v.get(str(k))) for k in args)
def cmd_reject(v,args,_f,_p):
    keys={str(x) for x in args}
    f=lambda x: OrderedDict((k,z) for k,z in x.items() if k not in keys)
    return [f(x) for x in v] if isinstance(v,list) else f(v)


def cmd_str(v,args,flags,p,name):
    s=scalar(v)
    if name=="str upcase": return s.upper()
    if name=="str downcase": return s.lower()
    if name=="str capitalize": return s.capitalize()
    if name=="str length": return len(s)
    if name=="str trim":
        if flags.get("left") or flags.get("l"): return s.lstrip()
        if flags.get("right") or flags.get("r"): return s.rstrip()
        return s.strip()
    if name=="str contains": return (scalar(args[0]).lower() in s.lower()) if flags.get("ignore-case") or flags.get("i") else scalar(args[0]) in s
    if name=="str starts-with": return s.startswith(scalar(args[0]))
    if name=="str ends-with": return s.endswith(scalar(args[0]))
    if name=="str replace":
        old,new=map(scalar,args[:2])
        return s.replace(old,new) if flags.get("all") or flags.get("a") else s.replace(old,new,1)
    if name=="str substring":
        spec=args[0]
        if isinstance(spec,RangeValue): return s[spec.start:spec.end+(1 if spec.inclusive else 0)]
        return s[int(spec):]
    if name=="str index-of": return s.find(scalar(args[0]))
    if name=="str reverse": return s[::-1]
    return s


def cmd_math(v,_a,_f,_p,name):
    vals=[x for x in as_list(v) if isinstance(x,(int,float)) and not isinstance(x,bool)]
    if name=="math sum": return sum(vals)
    if name=="math avg": return sum(vals)/len(vals)
    if name=="math min": return min(vals)
    if name=="math max": return max(vals)
    if name=="math median": return statistics.median(vals)
    if name=="math product": return math.prod(vals)
    if name=="math sqrt": return math.sqrt(v)
    if name=="math abs": return abs(v)
    if name=="math round": return round(v)


def jsonable(v):
    if isinstance(v,RangeValue): return v.values()
    if isinstance(v,Raw): return v.data
    if isinstance(v,list): return [jsonable(x) for x in v]
    if isinstance(v,dict): return OrderedDict((k,jsonable(x)) for k,x in v.items())
    return v
def cmd_to_json(v,_a,flags,_p):
    compact=flags.get("raw") or flags.get("r") or flags.get("compact")
    return Raw(json.dumps(jsonable(v),ensure_ascii=False,separators=(",",":") if compact else None,indent=None if compact else 2)+("" if compact else ""))
def cmd_from_json(v,_a,flags,_p):
    text=scalar(v)
    if flags.get("objects"):
        return [json.loads(line,object_pairs_hook=OrderedDict) for line in text.splitlines() if line.strip()]
    return json.loads(text,object_pairs_hook=OrderedDict)
def cmd_to_csv(v,_a,flags,_p):
    vals=as_list(v); output=io.StringIO(newline="")
    delim=scalar(flags.get("separator",",")); writer=csv.writer(output,delimiter=delim,lineterminator="\n")
    if vals and isinstance(vals[0],dict):
        keys=list(vals[0].keys())
        if not flags.get("noheaders"): writer.writerow(keys)
        for row in vals: writer.writerow([scalar(row.get(k)) for k in keys])
    else:
        for x in vals: writer.writerow([scalar(x)])
    return Raw(output.getvalue())
def parse_csv_value(x: str, infer: bool) -> Any:
    if not infer: return x
    if re.fullmatch(r"-?\d+",x): return int(x)
    if re.fullmatch(r"-?(?:\d+\.\d*|\.\d+)",x): return float(x)
    if x.lower() in ("true","false"): return x.lower()=="true"
    return x
def cmd_from_csv(v,_a,flags,_p):
    delim=scalar(flags.get("separator",",")); rows=list(csv.reader(io.StringIO(scalar(v)),delimiter=delim))
    if not rows:return []
    noheaders=flags.get("noheaders"); headers=[f"column{i}" for i in range(len(rows[0]))] if noheaders else rows.pop(0)
    return [OrderedDict(zip(headers,[parse_csv_value(x,not flags.get("no-infer")) for x in row])) for row in rows]


def path_arg(x): return Path(os.path.expanduser(scalar(x)))
def cmd_pwd(_v,_a,_f,_p): return str(Path.cwd())
def cmd_open(_v,args,flags,_p):
    path=path_arg(args[0])
    if not path.exists(): raise NuError("File not found","nu::shell::io::file_not_found")
    data=path.read_text(encoding="utf-8-sig")
    if flags.get("raw") or flags.get("r"): return Raw(data,True)
    ext=path.suffix.lower()
    if ext==".json": return json.loads(data,object_pairs_hook=OrderedDict)
    if ext==".csv": return cmd_from_csv(data,[],{},_p)
    return Raw(data,True)
def cmd_save(v,args,flags,_p):
    path=path_arg(args[0]); data=scalar(v) if isinstance(v,(Raw,str)) else render(v)
    mode="a" if flags.get("append") or flags.get("a") else "w"
    if path.exists() and mode=="w" and not (flags.get("force") or flags.get("f")): raise NuError("Destination file already exists","nu::shell::io::file_already_exists")
    with path.open(mode,encoding="utf-8",newline="") as f:f.write(data)
    return None
def cmd_mkdir(_v,args,_f,_p):
    for x in args:path_arg(x).mkdir(parents=True,exist_ok=True)
    return None
def cmd_touch(_v,args,_f,_p):
    for x in args:path_arg(x).touch()
    return None
def cmd_rm(_v,args,flags,_p):
    for x in args:
        p=path_arg(x)
        if p.is_dir(): shutil.rmtree(p) if flags.get("recursive") or flags.get("r") else p.rmdir()
        elif p.exists(): p.unlink()
        elif not flags.get("force") and not flags.get("f"): raise NuError("File not found","nu::shell::io::file_not_found")
    return None
def cmd_cp(_v,args,flags,_p):
    src,dst=map(path_arg,args[:2]); shutil.copytree(src,dst,dirs_exist_ok=True) if src.is_dir() else shutil.copy2(src,dst); return None
def cmd_mv(_v,args,_f,_p): shutil.move(path_arg(args[0]),path_arg(args[1])); return None
def cmd_ls(_v,args,flags,_p):
    pattern=scalar(args[0]) if args else "*"
    target=Path(pattern)
    if target.is_dir(): base=target; pat="*"; prefix=target
    else: base=target.parent; base=base if str(base)!="." else Path.cwd(); pat=target.name; prefix=target.parent if str(target.parent)!="." else None
    paths=sorted((x for x in base.iterdir() if fnmatch.fnmatch(x.name,pat)),key=lambda x:x.name.lower())
    return [OrderedDict(name=str((prefix/x.name) if prefix is not None else x.name),type="dir" if x.is_dir() else "file",size=x.stat().st_size,modified="") for x in paths if flags.get("all") or flags.get("a") or not x.name.startswith(".")]
def cmd_path(v,args,flags,_p,name):
    p=path_arg(v)
    if name=="path exists": return p.exists()
    if name=="path basename": return p.name
    if name=="path dirname": return str(p.parent)
    if name=="path extension": return p.suffix[1:]
    if name=="path expand": return str(p.resolve())
    if name=="path join": return str(p.joinpath(*(scalar(x) for x in args)))
def cmd_describe(v,_a,_f,_p):
    if v is None:return "nothing"
    if isinstance(v,bool):return "bool"
    if isinstance(v,int):return "int"
    if isinstance(v,float):return "float"
    if isinstance(v,str):return "string"
    if isinstance(v,Raw):return "string"
    if isinstance(v,RangeValue):return "range"
    if isinstance(v,dict):return "record"
    if isinstance(v,list):return "table" if v and isinstance(v[0],dict) else "list<any>"
    return type(v).__name__
def cmd_print(v,args,flags,_p):
    text=" ".join(scalar(x) for x in (args or [v]))+"\n"
    stream=sys.stderr.buffer if flags.get("stderr") or flags.get("e") else sys.stdout.buffer
    stream.write(text.encode("utf-8")); stream.flush(); return None


COMMANDS: dict[str,Callable] = {
    "echo":cmd_echo,"length":cmd_length,"get":cmd_get,"columns":cmd_columns,"values":cmd_values,
    "first":cmd_first,"last":cmd_last,"skip":cmd_skip,"take":cmd_take,"reverse":cmd_reverse,
    "sort":cmd_sort,"sort-by":cmd_sort,"uniq":cmd_uniq,"where":cmd_where,"each":cmd_each,
    "filter":cmd_filter,"reduce":cmd_reduce,"enumerate":cmd_enumerate,"wrap":cmd_wrap,
    "flatten":cmd_flatten,"select":cmd_select,"reject":cmd_reject,
    "to json":cmd_to_json,"from json":cmd_from_json,"to csv":cmd_to_csv,"from csv":cmd_from_csv,
    "pwd":cmd_pwd,"open":cmd_open,"save":cmd_save,"mkdir":cmd_mkdir,"touch":cmd_touch,"rm":cmd_rm,
    "cp":cmd_cp,"mv":cmd_mv,"ls":cmd_ls,"describe":cmd_describe,"print":cmd_print,
}
for _n in ("str upcase","str downcase","str capitalize","str length","str trim","str contains","str starts-with","str ends-with","str replace","str substring","str index-of","str reverse"):
    COMMANDS[_n]=(lambda name: lambda v,a,f,p:cmd_str(v,a,f,p,name))(_n)
for _n in ("math sum","math avg","math min","math max","math median","math product","math sqrt","math abs","math round"):
    COMMANDS[_n]=(lambda name: lambda v,a,f,p:cmd_math(v,a,f,p,name))(_n)
for _n in ("path exists","path basename","path dirname","path extension","path expand","path join"):
    COMMANDS[_n]=(lambda name: lambda v,a,f,p:cmd_path(v,a,f,p,name))(_n)
SOURCE_COMMANDS={"echo","pwd","open","mkdir","touch","rm","cp","mv","ls","print"}
PATH_ARG_COMMANDS={"open","save","mkdir","touch","rm","cp","mv","ls"}
BOOLEAN_FLAGS={"all","reverse","raw","compact","objects","noheaders","no-infer","left","right","ignore-case","append","force","recursive","stderr"}


def display_cell(value: Any) -> list[str]:
    if isinstance(value,(list,dict,RangeValue)):
        return render_table(materialize(value)).rstrip("\n").splitlines()
    return [scalar(value)]


def make_grid(rows: list[list[Any]], header_break: bool = False, numeric_columns: set[int] | None = None) -> str:
    numeric_columns = numeric_columns or set()
    cells=[[display_cell(c) for c in row] for row in rows]
    cols=max((len(r) for r in rows),default=0)
    widths=[0]*cols
    for row in cells:
        for j,cell in enumerate(row): widths[j]=max(widths[j],*(len(line) for line in cell))
    top="╭"+"┬".join("─"*(w+2) for w in widths)+"╮\n"
    bottom="╰"+"┴".join("─"*(w+2) for w in widths)+"╯\n"
    out=top
    for ri,row in enumerate(cells):
        height=max((len(c) for c in row),default=1)
        for k in range(height):
            fields=[]
            for j in range(cols):
                text=row[j][k] if j<len(row) and k<len(row[j]) else ""
                if header_break and ri == 0:
                    padding = widths[j] - len(text)
                    aligned = " " * (padding // 2) + text + " " * (padding - padding // 2)
                elif j in numeric_columns and k == 0:
                    aligned = text.rjust(widths[j])
                else:
                    aligned = text.ljust(widths[j])
                fields.append(" "+aligned+" ")
            out+="│"+"│".join(fields)+"│\n"
        if header_break and ri==0: out+="├"+"┼".join("─"*(w+2) for w in widths)+"┤\n"
    return out+bottom


def render_table(value: Any) -> str:
    value=materialize(value)
    if isinstance(value,dict): return make_grid([[k,v] for k,v in value.items()])
    if isinstance(value,list):
        if value and all(isinstance(x,dict) for x in value):
            keys=[]
            for row in value:
                for k in row:
                    if k != "index" and k not in keys:keys.append(k)
            rows=[["#"]+keys]+[[row.get("index",i)]+[row.get(k) for k in keys] for i,row in enumerate(value)]
            numeric={0}
            for j,key in enumerate(keys,1):
                if all(row.get(key) is None or isinstance(row.get(key),(int,float)) and not isinstance(row.get(key),bool) for row in value): numeric.add(j)
            return make_grid(rows,True,numeric)
        return make_grid([[i,x] for i,x in enumerate(value)])
    return scalar(value)+"\n"


def render(value: Any, no_newline: bool = False) -> str:
    if value is None:return ""
    if isinstance(value,Raw):
        text=value.data
        return text if value.preserve_newline or no_newline or text.endswith("\n") else text+"\n"
    if isinstance(value,(list,dict,RangeValue)):
        text=render_table(value)
        if no_newline and isinstance(value,dict): text=text.rstrip("\n")
        return text
    else:text=scalar(value)+"\n"
    return text.rstrip("\n") if no_newline else text


HELP="""The nushell language and shell.\n\nUsage:\n  > nu {flags} (script file) ...(script args) \n"""


def parse_cli(argv:list[str]):
    command=None; no_newline=False; table_mode="rounded"; error_style="fancy"; stdin_flag=False; script=None; i=0
    while i<len(argv):
        a=argv[i]
        if a in ("-h","--help"): return ("help",None,False,table_mode,error_style,False)
        if a in ("-v","--version"): return ("version",None,False,table_mode,error_style,False)
        if a in ("-c","--commands"):
            i+=1; command=argv[i] if i<len(argv) else ""
        elif a=="--no-newline":no_newline=True
        elif a in ("-m","--table-mode"):
            i+=1; table_mode=argv[i]
        elif a=="--error-style":i+=1;error_style=argv[i]
        elif a=="--stdin":stdin_flag=True
        elif a in ("-n","--no-config-file","--no-std-lib","--no-history"):pass
        elif a.startswith("-"):pass
        else:script=a;break
        i+=1
    if script is not None: command=Path(script).read_text(encoding="utf-8")
    return ("run",command,no_newline,table_mode,error_style,stdin_flag)


def report_error(err:NuError,source:str,style:str):
    if style=="plain":
        sys.stderr.buffer.write(f"Error: {err.code}\n\n  x {err.message}\n\n".encode("utf-8"))
        return
    color=sys.stderr.isatty()
    red="\x1b[31;1m" if color else ""; reset="\x1b[0m" if color else ""
    line=source.splitlines()[0] if source else ""
    col=max(0,min(err.pos,len(line)))
    label="division by zero" if err.code=="nu::shell::division_by_zero" else "originates from here"
    lines=[f"Error: {err.code}","",f"  x {err.message}",f"   ,-[source:1:{col+1}]",f" 1 | {line}","   : "+" "*col+"|","   : "+" "*col+f"`-- {label}","   `----",""]
    sys.stderr.buffer.write(("\n".join(red+x+reset for x in lines)+"\n").encode("utf-8"))


def main(argv:list[str]|None=None)->int:
    argv=sys.argv[1:] if argv is None else argv
    try: mode,source,no_newline,_table,error_style,stdin_flag=parse_cli(argv)
    except (IndexError,OSError) as exc:
        sys.stderr.write(str(exc)+"\n");return 1
    if mode=="help":sys.stdout.buffer.write(HELP.encode("utf-8"));return 0
    if mode=="version":sys.stdout.buffer.write(b"0.106.1\n");return 0
    if source is None:return 0
    try:
        pipeline=Raw(sys.stdin.read()) if stdin_flag else None
        result=Parser(source,pipeline=pipeline).parse()
        sys.stdout.buffer.write(render(result,no_newline).encode("utf-8"));return 0
    except (NuError,json.JSONDecodeError,csv.Error,OSError,KeyError,IndexError,ValueError) as exc:
        err=exc if isinstance(exc,NuError) else NuError(str(exc))
        report_error(err,source,error_style);return 1


if __name__=="__main__":raise SystemExit(main())
