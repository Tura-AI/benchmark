#!/usr/bin/env python3
import csv
import io
import json
import math
import os
import re
import shutil
import sys
from collections import OrderedDict

try:
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    sys.stderr.reconfigure(encoding="utf-8", newline="\n")
except Exception:
    pass


class NuError(Exception):
    def __init__(self, msg="nu::shell::error"):
        self.msg = msg
        super().__init__(msg)


NULL = None


def split_top(s, sep):
    out, cur, stack, quote, raw_end, esc = [], [], [], None, None, False
    i = 0
    while i < len(s):
        c = s[i]
        if raw_end:
            cur.append(c)
            if s.startswith(raw_end, i):
                cur.extend(raw_end[1:])
                i += len(raw_end)
                raw_end = None
                continue
            i += 1
            continue
        if quote:
            cur.append(c)
            if quote == '"' and c == "\\" and not esc:
                esc = True
            elif c == quote and not esc:
                quote = None
            else:
                esc = False
            i += 1
            continue
        if c == "r" and i + 1 < len(s) and s[i + 1] == "#":
            j = i + 1
            while j < len(s) and s[j] == "#":
                j += 1
            if j < len(s) and s[j] == "'":
                raw_end = "'" + ("#" * (j - i - 1))
        if c in "'\"":
            quote = c
            cur.append(c)
        elif c in "([{":
            stack.append(c)
            cur.append(c)
        elif c in ")]}":
            if stack:
                stack.pop()
            cur.append(c)
        elif c == sep and not stack:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(c)
        i += 1
    out.append("".join(cur).strip())
    return [x for x in out if x != ""]


def split_ws(s):
    parts, cur, stack, quote, raw_end, esc = [], [], [], None, None, False
    i = 0
    while i < len(s):
        c = s[i]
        if raw_end:
            cur.append(c)
            if s.startswith(raw_end, i):
                cur.extend(raw_end[1:])
                i += len(raw_end)
                raw_end = None
                continue
            i += 1
            continue
        if quote:
            cur.append(c)
            if quote == '"' and c == "\\" and not esc:
                esc = True
            elif c == quote and not esc:
                quote = None
            else:
                esc = False
            i += 1
            continue
        if c == "r" and i + 1 < len(s) and s[i + 1] == "#":
            j = i + 1
            while j < len(s) and s[j] == "#":
                j += 1
            if j < len(s) and s[j] == "'":
                raw_end = "'" + ("#" * (j - i - 1))
        if c in "'\"":
            quote = c
            cur.append(c)
        elif c in "([{":
            stack.append(c)
            cur.append(c)
        elif c in ")]}":
            if stack:
                stack.pop()
            cur.append(c)
        elif c.isspace() and not stack:
            if cur:
                parts.append("".join(cur))
                cur = []
        else:
            cur.append(c)
        i += 1
    if cur:
        parts.append("".join(cur))
    return parts


TOKEN_RE = re.compile(
    r"""\s*(?:
    (?P<num>-?\d[\d_]*(?:\.(?!\.)\d+)?(?:kb|mb|gb|b|min|sec|ms)?)
   |(?P<dq>"(?:\\.|[^"\\])*")
   |(?P<sq>'[^']*')
   |(?P<op>\.\.<|\.\.|\*\*|==|!=|<=|>=|=~|!~|\+\+|[+\-*/%<>()\[\]{},;:.|])
   |(?P<word>[^\s\[\]\{\}\(\),;:.|+*/<>=!]+)
    )""",
    re.X | re.S,
)


def toks(s):
    res, i = [], 0
    while i < len(s):
        if s[i:].lstrip() == "":
            break
        m = TOKEN_RE.match(s, i)
        if not m:
            raise NuError("nu::parser::parse_error")
        i = m.end()
        val = m.group(m.lastgroup)
        if m.lastgroup == "word" and val in ("mod", "and", "or", "xor", "not", "in", "not-in", "bit-shl", "bit-shr", "bit-and", "bit-or", "bit-xor"):
            res.append(("op", val))
        else:
            res.append((m.lastgroup, val))
    return res


class Parser:
    prec = {
        "or": 1, "xor": 1, "and": 2,
        "==": 3, "!=": 3, "<": 3, ">": 3, "<=": 3, ">=": 3, "=~": 3, "!~": 3, "in": 3, "not-in": 3,
        "bit-or": 4, "bit-xor": 4, "bit-and": 5, "bit-shl": 6, "bit-shr": 6,
        "+": 7, "-": 7, "mod": 8, "*": 8, "/": 8, "**": 9,
    }

    def __init__(self, s, env=None, pipe=None):
        self.t = toks(s)
        self.i = 0
        self.env = env if env is not None else {}
        self.pipe = pipe

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else (None, None)

    def pop(self, val=None):
        tok = self.peek()
        if val is not None and tok[1] != val:
            raise NuError("incomplete")
        self.i += 1
        return tok

    def parse(self):
        v = self.expr(0)
        return self.cell_path(v)

    def expr(self, minp=0):
        typ, val = self.peek()
        if val == "not":
            self.pop()
            left = not truthy(self.expr(10))
        elif val == "-":
            self.pop()
            left = -self.expr(10)
        else:
            left = self.primary()
        left = self.cell_path(left)
        while True:
            typ, op = self.peek()
            if typ != "op" or op in (")", "]", "}", ",", ";", ".", "..", "..<", "|"):
                break
            p = self.prec.get(op)
            if p is None or p < minp:
                break
            self.pop()
            right = self.expr(p + (0 if op == "**" else 1))
            left = apply_op(op, left, right)
        if self.peek()[1] in ("..", "..<"):
            incl = self.pop()[1] == ".."
            right = self.expr(0)
            left = list(range(int(left), int(right) + (1 if incl else 0)))
        return left

    def primary(self):
        typ, val = self.pop()
        if val == "(":
            inner = self.collect_until(")")
            return eval_script(inner, self.env, self.pipe)
        if val == "[":
            return self.parse_list()
        if val == "{":
            inner = self.collect_until("}")
            return parse_record(inner, self.env, self.pipe)
        if typ == "num":
            return parse_number(val)
        if typ in ("dq", "sq"):
            return parse_string(val)
        if typ == "word":
            if val == "true":
                return True
            if val == "false":
                return False
            if val == "null":
                return None
            if val == "$in":
                return self.pipe
            if val == "$it":
                return self.env.get("$it")
            if val.startswith("$env."):
                return os.environ.get(val[5:], "")
            if val.startswith("$"):
                return self.env.get(val[1:], None)
            return val
        raise NuError("nu::parser::parse_error")

    def collect_until(self, close):
        depth, start = 1, self.i
        pairs = {"(": ")", "[": "]", "{": "}"}
        while self.i < len(self.t):
            typ, val = self.pop()
            if typ in ("dq", "sq"):
                continue
            if val in "([{":
                depth += 1
            elif val in ")]}":
                depth -= 1
                if depth == 0 and val == close:
                    end = self.i - 1
                    return untoken(self.t[start:end])
        raise NuError("incomplete")

    def parse_list(self):
        depth, start = 1, self.i
        while self.i < len(self.t):
            typ, val = self.pop()
            if typ in ("dq", "sq"):
                continue
            if val in "([{":
                depth += 1
            elif val in ")]}":
                depth -= 1
                if depth == 0 and val == "]":
                    inner = untoken(self.t[start:self.i - 1]).strip()
                    return parse_bracket(inner, self.env, self.pipe)
        raise NuError("incomplete")

    def cell_path(self, v):
        while self.peek()[1] == ".":
            self.pop(".")
            typ, key = self.pop()
            optional = False
            if key.endswith("?"):
                key, optional = key[:-1], True
            if key == "":
                continue
            v = get_path(v, key, optional)
        return v


def untoken(ts):
    return " ".join(v for _, v in ts)


def parse_number(s):
    sl = s.lower().replace("_", "")
    mult = None
    for unit, m in (("kb", 1000), ("mb", 1000_000), ("gb", 1000_000_000), ("b", 1), ("min", 60_000_000_000), ("sec", 1_000_000_000), ("ms", 1_000_000)):
        if sl.endswith(unit):
            mult = m
            sl = sl[:-len(unit)]
            break
    n = float(sl) if "." in sl else int(sl)
    if mult is not None:
        return int(n * mult)
    return n


def parse_string(s):
    if s.startswith('"'):
        return bytes(s[1:-1], "utf-8").decode("unicode_escape")
    return s[1:-1]


def parse_raw(s):
    if s.startswith("r#"):
        m = re.match(r"r(#+)'(.*)'\1$", s, re.S)
        if m:
            return m.group(2)
    return None


def parse_bracket(inner, env, pipe):
    if inner == "":
        return []
    semi = split_top(inner, ";")
    if len(semi) >= 2:
        headers = parse_list_items(strip_brackets(semi[0]), env, pipe)
        if len(headers) != len(set(map(str, headers))):
            raise NuError("column_defined_twice")
        rows = []
        for part in semi[1:]:
            for rowtxt in split_rows(part):
                vals = parse_list_items(strip_brackets(rowtxt), env, pipe)
                rows.append(OrderedDict((str(h), vals[i] if i < len(vals) else None) for i, h in enumerate(headers)))
        return rows
    return parse_list_items(inner, env, pipe)


def strip_brackets(s):
    s = s.strip()
    return s[1:-1] if s.startswith("[") and s.endswith("]") else s


def split_rows(s):
    rows = []
    for p in split_ws(s.replace(",", " ")):
        if p.startswith("[") and p.endswith("]"):
            rows.append(p)
    return rows


def parse_list_items(s, env, pipe):
    parts = []
    for chunk in split_top(s, ","):
        if " " in chunk.strip():
            parts.extend(split_ws(chunk))
        else:
            parts.append(chunk)
    return [eval_expr(p, env, pipe) for p in parts if p.strip()]


def parse_record(inner, env, pipe):
    rec = OrderedDict()
    i = 0
    while i < len(inner):
        while i < len(inner) and inner[i] in " ,\n\t":
            i += 1
        if i >= len(inner):
            break
        if inner[i] in "'\"":
            q = inner[i]
            j = inner.find(q, i + 1)
            k = inner[i + 1:j]
            i = j + 1
        else:
            j = i
            while j < len(inner) and inner[j] != ":":
                j += 1
            k = inner[i:j].strip()
            i = j
        while i < len(inner) and inner[i] in " \t:":
            i += 1
        start, depth, quote = i, 0, None
        while i < len(inner):
            c = inner[i]
            if quote:
                if c == quote:
                    quote = None
            elif c in "'\"":
                quote = c
            elif c in "[{(":
                depth += 1
            elif c in "]})":
                depth -= 1
            elif depth == 0 and c in ",":
                break
            elif depth == 0 and c.isspace():
                rest = inner[i:].lstrip()
                if re.match(r"(?:'[^']+'|\"[^\"]+\"|[A-Za-z_][\w -]*)\s*:", rest):
                    break
            i += 1
        rec[k.strip().strip("'\"")] = eval_expr(inner[start:i].strip(), env, pipe)
        if i < len(inner) and inner[i] == ",":
            i += 1
    return rec


def eval_expr(s, env=None, pipe=None):
    s = s.strip()
    raw = parse_raw(s)
    if raw is not None:
        return raw
    return Parser(s, env or {}, pipe).parse()


def truthy(v):
    return bool(v)


def apply_op(op, a, b):
    if a is None or b is None:
        if op in ("<", ">", "<=", ">="):
            return None
    if op == "+":
        return a + b
    if op == "-":
        return a - b
    if op == "*":
        return a * b
    if op == "/":
        return a / b
    if op == "mod":
        return a % b
    if op == "**":
        return a ** b
    if op == "bit-shl":
        if b < 0 or b > 63:
            raise NuError("exceeds available bits")
        return int(a) << int(b)
    if op == "bit-shr":
        if b < 0 or b > 63:
            raise NuError("exceeds available bits")
        return int(a) >> int(b)
    if op == "bit-and":
        return int(a) & int(b)
    if op == "bit-or":
        return int(a) | int(b)
    if op == "bit-xor":
        return int(a) ^ int(b)
    if op == "and":
        return truthy(a) and truthy(b)
    if op == "or":
        return truthy(a) or truthy(b)
    if op == "xor":
        return truthy(a) ^ truthy(b)
    if op == "==":
        return a == b
    if op == "!=":
        return a != b
    if op == "<":
        return a < b
    if op == ">":
        return a > b
    if op == "<=":
        return a <= b
    if op == ">=":
        return a >= b
    if op == "=~":
        return re.search(str(b), str(a)) is not None
    if op == "!~":
        return re.search(str(b), str(a)) is None
    if op == "in":
        return contains(b, a)
    if op == "not-in":
        return not contains(b, a)
    raise NuError("nu::parser::operator")


def contains(container, item):
    if isinstance(container, dict):
        if not isinstance(item, str):
            raise NuError("nu::shell::operator_incompatible_types")
        return item in container
    return item in container


def get_path(v, key, optional=False):
    try:
        if isinstance(v, list):
            if key.endswith("!") and not key[:-1].isdigit():
                want = key[:-1].lower()
                return [row[next(k for k in row if k.lower() == want)] for row in v]
            if key.isdigit():
                return v[int(key)]
            if key.endswith("?"):
                key, optional = key[:-1], True
            return [row.get(key) if isinstance(row, dict) else None for row in v]
        if isinstance(v, dict):
            if key.isdigit():
                return list(v.values())[int(key)]
            return v[key]
        if isinstance(v, str) and key.isdigit():
            return v[int(key)]
    except Exception:
        if optional:
            return None
        raise NuError("cannot find column")
    if optional:
        return None
    raise NuError("cannot find column")


def eval_script(script, env=None, pipe=None):
    env = env if env is not None else {}
    result = None
    for stmt in split_top(script, ";"):
        if not stmt:
            continue
        m = re.match(r"^(?:let|mut|const)\s+(\w+)(?:\s+\w+)?\s*=\s*(.*)$", stmt, re.S)
        if m:
            env[m.group(1)] = eval_pipeline(m.group(2), env, pipe)
            result = None
            continue
        m = re.match(r"^\$(\w+)\s*(?:=|\+\+=)\s*(.*)$", stmt, re.S)
        if m:
            val = eval_pipeline(m.group(2), env, pipe)
            env[m.group(1)] = (env.get(m.group(1), "") + val) if "++=" in stmt else val
            result = None
            continue
        result = eval_pipeline(stmt, env, pipe)
    return result


def eval_pipeline(s, env, pipe=None):
    val = pipe
    for i, stage in enumerate(split_top(s, "|")):
        if i == 0:
            val = eval_stage(stage, env, val, first=True)
        else:
            val = eval_stage(stage, env, val, first=False)
    return val


def eval_stage(stage, env, val, first=False):
    stage = strip_comments(stage).strip()
    if not stage:
        return val
    parts = split_ws(stage)
    name = parts[0] if parts else ""
    if first and name in COMMANDS:
        return run_command(name, parts[1:], val, env)
    if not first and name in COMMANDS:
        return run_command(name, parts[1:], val, env)
    if not first and stage.startswith("$in"):
        return eval_expr(stage, env, val)
    return eval_expr(stage, env, val)


def strip_comments(s):
    out, quote = [], None
    for c in s:
        if quote:
            out.append(c)
            if c == quote:
                quote = None
        elif c in "'\"":
            quote = c
            out.append(c)
        elif c == "#":
            break
        else:
            out.append(c)
    return "".join(out)


def argval(x, env, pipe=None, bare=False):
    if bare and not is_expr_like(x):
        return x
    return eval_expr(x, env, pipe)


def is_expr_like(x):
    if not x:
        return False
    if x[0] in "'\"[{($" or re.match(r"^-?\d", x) or x in ("true", "false", "null"):
        return True
    if any(op in x for op in (" + ", " - ", " * ", " / ", "==", "!=", "<", ">", "..")):
        return True
    return False


def run_command(name, args, inp, env):
    if name in ("echo", "print"):
        return " ".join(str(argval(a, env, inp, True)) for a in args)
    if name == "pwd":
        return os.getcwd()
    if name == "cd":
        os.chdir(str(argval(args[0], env, inp)) if args else os.path.expanduser("~"))
        return None
    if name == "open":
        path = str(argval(args[0], env, inp, True))
        with open(path, "r", encoding="utf-8") as f:
            data = f.read()
        if path.lower().endswith(".json"):
            return json.loads(data, object_pairs_hook=OrderedDict)
        if path.lower().endswith(".csv"):
            return list(csv.DictReader(io.StringIO(data)))
        return data
    if name == "save":
        path = str(argval(args[-1], env, inp, True))
        mode = "a" if "-a" in args or "--append" in args else "w"
        with open(path, mode, encoding="utf-8", newline="") as f:
            f.write(to_plain(inp))
        return None
    if name == "mkdir":
        for a in args:
            os.makedirs(str(argval(a, env, inp, True)), exist_ok=True)
        return None
    if name == "rm":
        for a in args:
            if a.startswith("-"):
                continue
            p = str(argval(a, env, inp, True))
            if os.path.isdir(p):
                shutil.rmtree(p)
            elif os.path.exists(p):
                os.remove(p)
        return None
    if name == "cp":
        shutil.copyfile(str(argval(args[-2], env, inp, True)), str(argval(args[-1], env, inp, True)))
        return None
    if name == "mv":
        shutil.move(str(argval(args[-2], env, inp, True)), str(argval(args[-1], env, inp, True)))
        return None
    if name == "ls":
        path = str(argval(args[0], env, inp, True)) if args and not args[0].startswith("-") else "."
        rows = []
        for fn in os.listdir(path):
            if fn == ".git":
                continue
            p = os.path.join(path, fn)
            rows.append(OrderedDict([("name", p if path != "." else fn), ("type", "dir" if os.path.isdir(p) else "file"), ("size", os.path.getsize(p) if os.path.isfile(p) else 0)]))
        return rows
    if name == "length":
        return len(inp) if inp is not None else 0
    if name == "is-empty":
        return len(inp) == 0 if inp is not None else True
    if name == "columns":
        if isinstance(inp, list) and inp and isinstance(inp[0], dict):
            return list(inp[0].keys())
        if isinstance(inp, dict):
            return list(inp.keys())
        return []
    if name == "get":
        v = inp
        keys = []
        for a in args:
            keys.extend(str(argval(a, env, inp, True)).split("."))
        for k in keys:
            v = get_path(v, k, k.endswith("?"))
        return v
    if name == "select":
        keys = [str(argval(a, env, inp, True)) for a in args]
        if isinstance(inp, list) and all(k.isdigit() for k in keys):
            return [inp[int(k)] for k in keys]
        if isinstance(inp, list):
            return [OrderedDict((k, row.get(k)) for k in keys if isinstance(row, dict) and k in row) for row in inp]
        if isinstance(inp, dict):
            return OrderedDict((k, inp[k]) for k in keys if k in inp)
        return inp
    if name == "reject":
        keys = {str(argval(a, env, inp, True)) for a in args}
        if isinstance(inp, list):
            return [OrderedDict((k, v) for k, v in row.items() if k not in keys) for row in inp]
        if isinstance(inp, dict):
            return OrderedDict((k, v) for k, v in inp.items() if k not in keys)
        return inp
    if name == "drop" and args and args[0] == "column":
        n = int(argval(args[1], env, inp)) if len(args) > 1 else 1
        if isinstance(inp, list):
            return [OrderedDict(list(row.items())[:-n]) for row in inp]
        return inp
    if name == "first":
        n = int(argval(args[0], env, inp)) if args else 1
        return inp[0] if n == 1 and isinstance(inp, list) else inp[:n]
    if name == "last":
        n = int(argval(args[0], env, inp)) if args else 1
        return inp[-1] if n == 1 and isinstance(inp, list) else inp[-n:]
    if name == "take":
        return inp[: int(argval(args[0], env, inp))]
    if name == "skip":
        return inp[int(argval(args[0], env, inp)) :]
    if name == "sort":
        ci = "-i" in args
        return sorted(inp, key=lambda x: str(x).lower() if ci else x)
    if name == "sort-by":
        ci = "-i" in args
        keys = [a for a in args if not a.startswith("-")]
        return sorted(inp, key=lambda r: tuple(str(r.get(k, "")).lower() if ci else r.get(k, "") for k in keys))
    if name == "where":
        expr = " ".join(args)
        return [x for x in inp if truthy(eval_expr(expr, {**env, "$it": x}, x))]
    if name == "wrap":
        col = str(argval(args[0], env, inp, True))
        if isinstance(inp, list):
            return [OrderedDict([(col, x)]) for x in inp]
        return OrderedDict([(col, inp)])
    if name == "upsert":
        k = str(argval(args[0], env, inp, True))
        v = argval(args[1], env, inp, True)
        if isinstance(inp, dict):
            out = OrderedDict(inp)
            out[k] = v
            return out
        if isinstance(inp, list):
            return [OrderedDict(list(r.items()) + [(k, v)]) for r in inp]
    if name == "default":
        val, col = argval(args[0], env, inp, True), str(argval(args[1], env, inp, True))
        if isinstance(inp, list):
            for r in inp:
                if isinstance(r, dict) and (col not in r or r[col] is None):
                    r[col] = val
        return inp
    if name == "into" and args and args[0] == "int":
        cols = [str(argval(a, env, inp, True)) for a in args[1:]]
        if cols and isinstance(inp, list):
            for r in inp:
                for c in cols:
                    r[c] = int(float(r[c]))
            return inp
        return int(float(inp))
    if name == "math":
        vals = list(flat_values(inp))
        sub = args[0] if args else "sum"
        if sub == "sum":
            return sum(vals)
        if sub == "avg":
            return sum(vals) / len(vals)
        if sub == "min":
            return min(vals)
        if sub == "max":
            return max(vals)
    if name == "str":
        return str_command(args, inp, env)
    if name == "split":
        sep = str(argval(args[1], env, inp)) if len(args) > 1 else " "
        if args[0] == "row":
            return str(inp).split(sep)
        if args[0] == "column":
            cells = str(inp).split(sep)
            return [OrderedDict((f"column{i+1}", v) for i, v in enumerate(cells))]
    if name == "lines":
        return str(inp).splitlines()
    if name == "from":
        if args[0] == "json":
            text = str(inp)
            if "-o" in args or "--objects" in args:
                return [json.loads(line, object_pairs_hook=OrderedDict) for line in text.splitlines() if line.strip()]
            return json.loads(text, object_pairs_hook=OrderedDict)
        if args[0] == "csv":
            return list(csv.DictReader(io.StringIO(str(inp))))
    if name == "to":
        raw = "-r" in args or "--raw" in args
        if args[0] == "json":
            return json.dumps(inp, ensure_ascii=False, separators=(",", ":") if raw else None, indent=None if raw else 2)
        if args[0] == "nuon":
            return to_nuon(inp)
        if args[0] == "csv":
            return to_csv(inp)
    if name == "flatten":
        return flatten(inp, args)
    if name == "char":
        if args and args[0] == "nl":
            return "\n"
    if name == "seq":
        a, b = int(argval(args[0], env, inp)), int(argval(args[1], env, inp))
        return list(range(a, b + 1))
    if name == "describe":
        return describe(inp)
    raise NuError(f"unknown command: {name}")


COMMANDS = {
    "echo", "print", "pwd", "cd", "open", "save", "mkdir", "rm", "cp", "mv", "ls", "length", "is-empty",
    "columns", "get", "select", "reject", "drop", "first", "last", "take", "skip", "sort", "sort-by",
    "where", "wrap", "upsert", "default", "into", "math", "str", "split", "lines", "from", "to",
    "flatten", "char", "seq", "describe",
}


def str_command(args, inp, env):
    sub = args[0]
    s = str(inp)
    if sub == "upcase":
        return s.upper()
    if sub == "downcase":
        return s.lower()
    if sub == "capitalize":
        return s.capitalize()
    if sub == "reverse":
        return s[::-1]
    if sub == "length":
        return len(s)
    if sub == "join":
        sep = str(argval(args[1], env, inp)) if len(args) > 1 else ""
        return sep.join(map(str, inp))
    if sub == "contains":
        return str(argval(args[1], env, inp)) in s
    if sub == "index-of":
        return s.find(str(argval(args[1], env, inp)))
    if sub == "substring":
        rng = args[1] if len(args) > 1 else args[0]
        m = re.match(r"(.+?)\.\.(<?)(.+)", rng)
        if m:
            a = int(eval_expr(m.group(1), env, inp))
            b = int(eval_expr(m.group(3), env, inp))
            return s[a:b if m.group(2) == "<" else b + 1]
    if sub == "replace":
        old = str(argval(args[1], env, inp))
        new = str(argval(args[2], env, inp))
        return s.replace(old, new, 1)
    if sub == "trim":
        return s.strip()
    return s


def flat_values(v):
    if isinstance(v, list):
        for x in v:
            yield from flat_values(x)
    elif isinstance(v, dict):
        for x in v.values():
            yield from flat_values(x)
    elif isinstance(v, (int, float)):
        yield v


def flatten(inp, args):
    allflag = "--all" in args
    cols = [a for a in args if not a.startswith("-")]
    if isinstance(inp, list) and len(inp) == 1 and isinstance(inp[0], list):
        return inp[0]
    if isinstance(inp, list) and inp and isinstance(inp[0], dict):
        out = []
        for row in inp:
            targets = cols or list(row.keys())
            expanded = [OrderedDict(row)]
            for col in targets:
                if col not in row or not isinstance(row[col], list):
                    continue
                vals = row[col]
                new = []
                for base in expanded:
                    for item in vals:
                        b = OrderedDict(base)
                        if isinstance(item, dict) and allflag:
                            b.pop(col, None)
                            b.update(item)
                        else:
                            b[col] = item
                        new.append(b)
                expanded = new
            out.extend(expanded)
        return out
    return inp


def describe(v):
    if isinstance(v, list):
        return "list<any>"
    if isinstance(v, dict):
        return "record"
    if isinstance(v, str):
        return "string"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if v is None:
        return "nothing"
    return "any"


def to_nuon(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return fmt_num(v)
    if isinstance(v, str):
        if re.match(r"^[A-Za-z0-9_./:\\ -]+$", v):
            return json.dumps(v)[1:-1] if any(c.isspace() for c in v) else v
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ", ".join(to_nuon(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(f"{k}: {to_nuon(val)}" for k, val in v.items()) + "}"
    return str(v)


def to_csv(v):
    if not isinstance(v, list):
        return to_plain(v)
    if not v:
        return ""
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=list(v[0].keys()), lineterminator="\n")
    w.writeheader()
    w.writerows(v)
    return out.getvalue().rstrip("\n")


def fmt_num(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def format_duration(ns):
    sec = int(ns // 1_000_000_000)
    mins, secs = divmod(sec, 60)
    parts = []
    if mins:
        parts.append(f"{mins}min")
    if secs or not parts:
        parts.append(f"{secs}sec")
    return " ".join(parts)


def to_plain(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return fmt_num(v)
    if isinstance(v, str):
        return v
    return render_table(v)


def render_value(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        return fmt_num(v)
    if isinstance(v, (list, dict)):
        return to_nuon(v)
    return str(v)


def render_table(v):
    if isinstance(v, dict):
        rows = [[str(k), render_value(val)] for k, val in v.items()]
        return box(rows, header=None)
    if isinstance(v, list):
        if not v:
            return "╭────────────╮\n│ empty list │\n╰────────────╯"
        if all(isinstance(x, dict) for x in v):
            cols = []
            for r in v:
                for k in r:
                    if k not in cols:
                        cols.append(k)
            rows = [[str(i)] + [render_value(r.get(c)) for c in cols] for i, r in enumerate(v)]
            return box(rows, ["#"] + cols)
        rows = [[str(i), render_value(x)] for i, x in enumerate(v)]
        return box(rows, None)
    return render_value(v)


def box(rows, header=None):
    data = ([header] if header else []) + rows
    widths = [max(len(str(row[i])) for row in data) for i in range(len(data[0]))]
    def line(left, mid, right):
        return left + mid.join("─" * (w + 2) for w in widths) + right
    def row(vals):
        return "│" + "│".join(" " + str(vals[i]).ljust(widths[i]) + " " for i in range(len(widths))) + "│"
    out = [line("╭", "┬", "╮")]
    if header:
        out.append(row(header))
        out.append(line("├", "┼", "┤"))
    out.extend(row(r) for r in rows)
    out.append(line("╰", "┴", "╯"))
    return "\n".join(out)


def main(argv):
    if "--version" in argv or "-V" in argv:
        print("0.106.1")
        return 0
    if "-c" in argv:
        idx = argv.index("-c")
        script = argv[idx + 1] if idx + 1 < len(argv) else ""
    elif "--commands" in argv:
        idx = argv.index("--commands")
        script = argv[idx + 1] if idx + 1 < len(argv) else ""
    elif argv and argv[0].endswith(".nu"):
        with open(argv[0], "r", encoding="utf-8") as f:
            script = f.read()
    else:
        script = sys.stdin.read()
    try:
        val = eval_script(script, {})
        if val is not None:
            sys.stdout.write(to_plain(val))
            sys.stdout.write("\n")
        return 0
    except NuError as e:
        sys.stderr.write(f"Error: {e.msg}\n")
        return 1
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
