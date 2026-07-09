#!/usr/bin/env python3
import argparse
import csv
import io
import json
import math
import os
import re
import sys
from collections import OrderedDict
from dataclasses import dataclass


class NuError(Exception):
    pass


@dataclass
class Token:
    kind: str
    text: str
    gap: bool = False


def tokenize(src):
    out = []
    i = 0
    two = {"==", "!=", "<=", ">=", "=~", "!~", "..", "..<", "**"}
    singles = set("()[]{};,.:|+-*/<>=$")
    while i < len(src):
        c = src[i]
        if c.isspace():
            i += 1
            continue
        if src.startswith("#", i):
            j = src.find("\n", i)
            i = len(src) if j < 0 else j + 1
            continue
        if c in "'\"":
            q = c
            j = i + 1
            buf = []
            while j < len(src):
                ch = src[j]
                if ch == "\\" and q == '"' and j + 1 < len(src):
                    esc = src[j + 1]
                    buf.append({"n": "\n", "r": "\r", "t": "\t", '"': '"', "\\": "\\"}.get(esc, esc))
                    j += 2
                    continue
                if ch == q:
                    break
                buf.append(ch)
                j += 1
            if j >= len(src):
                raise NuError(f"expected closing {q}")
            out.append(Token("str", "".join(buf), bool(out) and src[i - 1].isspace()))
            i = j + 1
            continue
        if c.isdigit() or (c in "+-" and i + 1 < len(src) and src[i + 1].isdigit()):
            j = i + 1
            while j < len(src):
                if src[j].isdigit() or src[j] == "_":
                    j += 1
                    continue
                if src[j] == "." and not (j + 1 < len(src) and src[j + 1] == "."):
                    j += 1
                    continue
                break
            out.append(Token("word", src[i:j], bool(out) and src[i - 1].isspace()))
            i = j
            continue
        if src.startswith("r#'", i):
            j = src.find("'#", i + 3)
            if j < 0:
                raise NuError("expected closing '#")
            out.append(Token("str", src[i + 3:j], bool(out) and src[i - 1].isspace()))
            i = j + 2
            continue
        matched = None
        for op in sorted(two, key=len, reverse=True):
            if src.startswith(op, i):
                matched = op
                break
        if matched:
            out.append(Token("op", matched, bool(out) and src[i - 1].isspace()))
            i += len(matched)
            continue
        if c in singles:
            out.append(Token("sym", c, bool(out) and src[i - 1].isspace()))
            i += 1
            continue
        j = i
        while j < len(src) and not src[j].isspace() and (src[j] not in singles or (src[j] == "-" and j > i and j + 1 < len(src) and src[j + 1].isalpha())):
            if any(src.startswith(op, j) for op in two):
                break
            j += 1
        out.append(Token("word", src[i:j], bool(out) and src[i - 1].isspace()))
        i = j
    return out


def split_top(src, sep):
    parts = []
    depth = 0
    q = None
    start = 0
    i = 0
    while i < len(src):
        c = src[i]
        if q:
            if c == "\\" and q == '"':
                i += 2
                continue
            if c == q:
                q = None
            i += 1
            continue
        if c in "'\"":
            q = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == sep and depth == 0:
            parts.append(src[start:i].strip())
            start = i + 1
        i += 1
    parts.append(src[start:].strip())
    return [p for p in parts if p != ""]


class Parser:
    def __init__(self, tokens, env=None):
        self.toks = tokens
        self.i = 0
        self.env = env if env is not None else {}

    def peek(self, text=None):
        if self.i >= len(self.toks):
            return None
        t = self.toks[self.i]
        if text is not None and t.text != text:
            return None
        return t

    def pop(self, text=None):
        t = self.peek(text)
        if not t:
            raise NuError("parse error")
        self.i += 1
        return t

    def parse(self):
        v = self.expr(0)
        while self.peek("."):
            self.pop(".")
            key = self.pop().text
            opt = key.endswith("?")
            if opt:
                key = key[:-1]
            v = cell_get(v, key, opt)
        return v

    def expr(self, minp=0, stop_on_gap=False):
        left = self.unary()
        prec = {
            "or": 1, "xor": 1, "and": 2, "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3,
            "in": 3, "not-in": 3, "=~": 3, "!~": 3, "..": 4, "..<": 4,
            "bit-or": 5, "bit-xor": 6, "bit-and": 7, "bit-shl": 8, "bit-shr": 8,
            "+": 9, "-": 9, "*": 10, "/": 10, "mod": 10, "**": 11,
        }
        while self.i < len(self.toks):
            if stop_on_gap and self.toks[self.i].gap and self.toks[self.i].text in ("+", "-", "*", "/", "mod", "**", "bit-and", "bit-or", "bit-xor", "bit-shl", "bit-shr"):
                break
            op = self.toks[self.i].text
            if op not in prec or prec[op] < minp:
                break
            self.i += 1
            right = self.expr(prec[op] + (0 if op == "**" else 1), stop_on_gap)
            left = apply_op(op, left, right)
        return left

    def unary(self):
        if self.peek("not"):
            self.pop()
            return not bool(self.unary())
        if self.peek("-"):
            self.pop()
            return -to_num(self.unary())
        return self.primary()

    def primary(self):
        t = self.pop()
        if t.kind == "str":
            v = t.text
        elif t.text == "(":
            inner = []
            depth = 1
            while depth and self.i < len(self.toks):
                tt = self.pop()
                if tt.text == "(":
                    depth += 1
                elif tt.text == ")":
                    depth -= 1
                    if depth == 0:
                        break
                inner.append(tt)
            v = eval_code(tokens_to_src(inner), self.env)
        elif t.text == "[":
            v = self.parse_list_or_table()
        elif t.text == "{":
            v = self.parse_record()
        elif t.text == "$":
            name = self.pop().text
            v = self.env.get(name, None)
        elif t.text in ("true", "false"):
            v = t.text == "true"
        elif t.text == "null":
            v = None
        elif is_number(t.text):
            v = parse_number(t.text)
        else:
            v = t.text
        while self.peek("."):
            self.pop(".")
            key = self.pop().text
            opt = key.endswith("?")
            if opt:
                key = key[:-1]
            v = cell_get(v, key, opt)
        return v

    def parse_record(self):
        rec = OrderedDict()
        while not self.peek("}"):
            key = self.pop().text
            self.pop(":")
            rec[key] = self.expr(0)
            if self.peek(","):
                self.pop(",")
        self.pop("}")
        return rec

    def parse_list_or_table(self):
        if self.peek("["):
            self.pop("[")
            headers = []
            while not self.peek("]"):
                headers.append(str(self.expr(0, True)))
                if self.peek(","):
                    self.pop(",")
            self.pop("]")
            rows = []
            if self.peek(";"):
                self.pop(";")
            while not self.peek("]"):
                self.pop("[")
                vals = []
                while not self.peek("]"):
                    vals.append(self.expr(0, True))
                    if self.peek(","):
                        self.pop(",")
                self.pop("]")
                rows.append(OrderedDict((h, vals[idx] if idx < len(vals) else None) for idx, h in enumerate(headers)))
                if self.peek(","):
                    self.pop(",")
            self.pop("]")
            return rows
        vals = []
        while not self.peek("]"):
            vals.append(self.expr(0, True))
            if self.peek(","):
                self.pop(",")
        self.pop("]")
        return vals


def tokens_to_src(tokens):
    return " ".join(t.text if t.kind != "str" else json.dumps(t.text) for t in tokens)


def is_number(s):
    return re.fullmatch(r"[+-]?(\d[\d_]*)(\.\d[\d_]*)?", s or "") is not None


def parse_number(s):
    s = s.replace("_", "")
    return float(s) if "." in s else int(s)


def to_num(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v
    try:
        return float(v) if "." in str(v) else int(v)
    except Exception as exc:
        raise NuError("operator_incompatible_types") from exc


def apply_op(op, a, b):
    if op == ".." or op == "..<":
        end = int(b) - (1 if op == "..<" else 0)
        return list(range(int(a), end + 1))
    if op in ("+", "-", "*", "/", "mod", "**"):
        if op == "+" and (isinstance(a, str) or isinstance(b, str)):
            return str(a) + str(b)
        aa, bb = to_num(a), to_num(b)
        return {"+": aa + bb, "-": aa - bb, "*": aa * bb, "/": aa / bb, "mod": aa % bb, "**": aa ** bb}[op]
    if op in ("bit-and", "bit-or", "bit-xor", "bit-shl", "bit-shr"):
        aa, bb = int(to_num(a)), int(to_num(b))
        if bb < 0 or bb > 1024:
            raise NuError("exceeds available bits")
        return {"bit-and": aa & bb, "bit-or": aa | bb, "bit-xor": aa ^ bb, "bit-shl": aa << bb, "bit-shr": aa >> bb}[op]
    if op in ("==", "!=", "<", "<=", ">", ">="):
        if op == "==": return a == b
        if op == "!=": return a != b
        if a is None or b is None: return None
        return {"<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b}[op]
    if op == "and": return bool(a) and bool(b)
    if op == "or": return bool(a) or bool(b)
    if op == "xor": return bool(a) ^ bool(b)
    if op in ("in", "not-in"):
        r = a in (b.keys() if isinstance(b, dict) else b)
        return not r if op == "not-in" else r
    if op in ("=~", "!~"):
        r = re.search(str(b), str(a)) is not None
        return not r if op == "!~" else r
    raise NuError("unsupported operator")


def cell_get(v, key, opt=False):
    if (len(key) >= 2 and key[0] == key[-1] and key[0] in "'\""):
        key = key[1:-1]
    try:
        if isinstance(v, list):
            if key.isdigit():
                return v[int(key)]
            return [cell_get(x, key, opt) for x in v]
        if isinstance(v, dict):
            if key in v:
                return v[key]
            low = {str(k).lower(): k for k in v}
            if key.lower().rstrip("!") in low:
                return v[low[key.lower().rstrip("!")]]
        if isinstance(v, str) and key.isdigit():
            return v[int(key)]
    except Exception:
        pass
    if opt:
        return None
    raise NuError("cannot find column")


def split_cell_path(path):
    parts = []
    buf = []
    q = None
    for c in path:
        if q:
            buf.append(c)
            if c == q:
                q = None
            continue
        if c in "'\"":
            q = c
            buf.append(c)
        elif c == ".":
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(c)
    parts.append("".join(buf))
    return parts


def run_command(name, args, inp, env):
    if name == "char":
        return {"nl": "\n", "tab": "\t", "space": " "}.get(args[0], "") if args else ""
    if name in ("echo", "print"):
        return " ".join(nu_to_string(eval_expr(a, env)) for a in args) if args else inp
    if name == "pwd":
        return os.getcwd()
    if name == "ls":
        path = eval_expr(args[0], env) if args else "."
        rows = []
        for n in sorted(os.listdir(path)):
            p = os.path.join(path, n)
            rows.append(OrderedDict([("name", n), ("type", "dir" if os.path.isdir(p) else "file"), ("size", os.path.getsize(p) if os.path.isfile(p) else 0)]))
        return rows
    if name == "open":
        data = open(str(eval_expr(args[0], env)), "r", encoding="utf-8").read()
        if str(args[0]).endswith(".json"):
            return json.loads(data, object_pairs_hook=OrderedDict)
        if str(args[0]).endswith(".csv"):
            return list(csv.DictReader(io.StringIO(data)))
        return data
    if name == "save":
        path = str(eval_expr(args[-1], env))
        mode = "w"
        with open(path, mode, encoding="utf-8", newline="") as f:
            f.write(nu_to_string(inp))
        return None
    if name == "from":
        fmt = args[0]
        text = "" if inp is None else str(inp)
        if fmt == "json":
            if "-o" in args:
                return [json.loads(line, object_pairs_hook=OrderedDict) for line in text.splitlines() if line.strip()]
            return json.loads(text, object_pairs_hook=OrderedDict)
        if fmt == "csv":
            return list(csv.DictReader(io.StringIO(text)))
    if name == "to":
        fmt = args[0]
        raw = "-r" in args or "--raw" in args
        if fmt == "json":
            return json.dumps(inp, ensure_ascii=False, separators=(",", ":") if raw else (",", ": "), indent=None if raw else 2)
        if fmt == "csv":
            return to_csv(inp)
        if fmt == "nuon":
            return to_nuon(inp)
    if name == "get":
        v = inp
        for part in split_cell_path(" ".join(args)):
            if part:
                v = cell_get(v, part, part.endswith("?"))
        return v
    if name == "select":
        cols = [eval_bare(a, env) for a in args]
        if isinstance(inp, list):
            return [OrderedDict((c, cell_get(r, str(c))) for c in cols) for r in inp]
        return OrderedDict((c, cell_get(inp, str(c))) for c in cols)
    if name == "reject":
        cols = set(args)
        return [OrderedDict((k, v) for k, v in r.items() if k not in cols) for r in inp]
    if name == "drop" and args and args[0] == "column":
        n = int(args[1])
        return [OrderedDict(list(r.items())[:-n]) for r in inp]
    if name == "columns":
        return list(inp[0].keys()) if isinstance(inp, list) and inp and isinstance(inp[0], dict) else list(inp.keys())
    if name == "first":
        return inp[0] if isinstance(inp, list) else inp
    if name == "last":
        return inp[-1] if isinstance(inp, list) else inp
    if name == "length":
        return len(inp) if inp is not None else 0
    if name == "math":
        vals = inp if isinstance(inp, list) else [inp]
        nums = [to_num(x) for x in vals if x is not None]
        if not nums:
            raise NuError("Unsupported input")
        sub = args[0] if args else "sum"
        return {"sum": sum(nums), "min": min(nums), "max": max(nums), "avg": sum(nums) / len(nums)}[sub]
    if name == "where":
        expr = " ".join(args)
        return [x for x in inp if eval_expr(expr, dict(env, it=x))]
    if name == "split":
        sep = eval_bare(args[1], env) if len(args) > 1 else " "
        if args[0] == "row":
            return str(inp).split(str(sep))
        if args[0] == "column":
            parts = str(inp).split(str(sep))
            return [OrderedDict((f"column{i+1}", p) for i, p in enumerate(parts))]
    if name == "str":
        sub = args[0] if args else ""
        s = "" if inp is None else str(inp)
        if sub == "length": return len(s)
        if sub == "join": return str(eval_bare(args[1], env)).join(map(str, inp))
        if sub == "upcase": return s.upper()
        if sub == "downcase": return s.lower()
        if sub == "contains": return str(eval_bare(args[1], env)) in s
        if sub == "index-of": return s.find(str(eval_bare(args[1], env)))
        if sub == "trim": return s.strip()
        if sub == "replace": return s.replace(str(eval_bare(args[1], env)), str(eval_bare(args[2], env)))
    if name == "lines":
        return str(inp).splitlines()
    if name == "wrap":
        col = args[0]
        return [OrderedDict([(col, x)]) for x in inp]
    if name == "upsert":
        key, val = args[0], eval_expr(" ".join(args[1:]), env)
        if isinstance(inp, dict):
            out = OrderedDict(inp); out[key] = val; return out
        return inp
    if name == "default":
        val, key = eval_expr(args[0], env), args[1]
        for r in inp:
            if r.get(key) is None:
                r[key] = val
        return inp
    if name == "into" and args[0] == "int":
        if len(args) > 1 and isinstance(inp, list):
            for r in inp:
                r[args[1]] = int(float(r[args[1]]))
            return inp
        return int(float(inp))
    if name == "sort":
        ci = "-i" in args
        return sorted(inp, key=lambda x: str(x).lower() if ci else x)
    if name == "sort-by":
        ci = "-i" in args
        cols = [a for a in args if a != "-i"]
        return sorted(inp, key=lambda r: tuple(str(r.get(c, "")).lower() if ci else r.get(c, "") for c in cols))
    raise NuError(f"Command `{name}` not found")


def eval_bare(s, env):
    return eval_expr(s, env) if s.startswith("$") or s[:1] in "'\"([{" or is_number(s) else s


def eval_expr(src, env):
    return Parser(tokenize(src), env).parse()


def eval_code(src, env=None):
    env = env if env is not None else {}
    result = None
    for stmt in split_top(src, ";"):
        if not stmt:
            continue
        if stmt.startswith("let "):
            m = re.match(r"let\s+(\w+)\s*=\s*(.*)$", stmt, re.S)
            if not m:
                raise NuError("parse error")
            env[m.group(1)] = eval_pipeline(m.group(2), env)
            result = None
        else:
            result = eval_pipeline(stmt, env)
    return result


def split_cmd(s):
    raw = re.findall(r'''"(?:\\.|[^"])*"(?:\.\S*)?|'[^']*'(?:\.\S*)?|\S+''', s)
    return [a[1:-1] if len(a) >= 2 and a[0] == a[-1] and a[0] in "'\"" else a for a in raw]


def eval_pipeline(src, env):
    parts = split_top(src, "|")
    if not parts:
        val = None
    else:
        first = parts[0].strip()
        argv0 = split_cmd(first)
        if first[:1] not in "'\"" and argv0 and re.fullmatch(r"[A-Za-z_][\w-]*", argv0[0]) and len(argv0) > 0 and argv0[0] not in {"true", "false", "null"}:
            val = run_command(argv0[0], [strip_outer(a) for a in argv0[1:]], None, env)
        else:
            val = eval_expr(first, env)
    for cmdsrc in parts[1:]:
        argv = split_cmd(cmdsrc)
        if not argv:
            continue
        name = argv[0]
        args = [strip_outer(a) for a in argv[1:]]
        val = run_command(name, args, val, env)
    return val


def strip_outer(s):
    return s


def to_csv(v):
    rows = v if isinstance(v, list) else [v]
    if not rows:
        return ""
    fields = list(rows[0].keys()) if isinstance(rows[0], dict) else ["value"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields, lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow(r if isinstance(r, dict) else {"value": r})
    return buf.getvalue().rstrip("\n")


def to_nuon(v):
    if v is None: return "null"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return format_num(v)
    if isinstance(v, str): return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list): return "[" + ", ".join(to_nuon(x) for x in v) + "]"
    if isinstance(v, dict): return "{" + ", ".join(f"{k}: {to_nuon(x)}" for k, x in v.items()) + "}"
    return str(v)


def format_num(v):
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).lower()


def nu_to_string(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return format_num(v)
    if isinstance(v, str):
        return v
    if isinstance(v, (list, dict)):
        return to_nuon(v)
    return str(v)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv in (["--version"], ["-V"]):
        print("0.106.1")
        return 0
    if not argv:
        return 0
    if argv[0] == "-c" and len(argv) >= 2:
        try:
            val = eval_code(argv[1], {})
            out = nu_to_string(val)
            if val is not None:
                sys.stdout.write(out + "\n")
            return 0
        except Exception as exc:
            sys.stderr.write(str(exc) + "\n")
            return 1
    sys.stderr.write("unsupported invocation\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
