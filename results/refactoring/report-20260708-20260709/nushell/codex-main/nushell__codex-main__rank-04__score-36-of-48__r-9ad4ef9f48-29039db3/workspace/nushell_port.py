#!/usr/bin/env python3
import csv
import datetime as _dt
import glob
import json
import math
import os
import re
import shutil
import sys
from io import StringIO


class NuError(Exception):
    pass


class RawText(str):
    pass


MISSING = object()


def split_top(s, sep):
    out, buf, depth, quote, esc = [], [], 0, None, False
    for ch in s:
        if quote:
            buf.append(ch)
            if esc:
                esc = False
            elif ch == "\\" and quote == '"':
                esc = True
            elif ch == quote:
                quote = None
            continue
        if ch in "'\"":
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
    out.append("".join(buf).strip())
    return out


def tokenize(s):
    tokens, i = [], 0
    two = {"==", "!=", "<=", ">=", "//", ".."}
    one = set("()[]{};,:|+-*/<>.$=")
    while i < len(s):
        c = s[i]
        if c.isspace():
            i += 1
            continue
        if c == "#":
            break
        if c in "'\"":
            q, i, buf = c, i + 1, []
            while i < len(s):
                ch = s[i]
                if q == '"' and ch == "\\" and i + 1 < len(s):
                    nxt = s[i + 1]
                    escapes = {"n": "\n", "r": "\r", "t": "\t", '"': '"', "\\": "\\"}
                    buf.append(escapes.get(nxt, nxt))
                    i += 2
                    continue
                if ch == q:
                    i += 1
                    break
                buf.append(ch)
                i += 1
            tokens.append(("str", "".join(buf)))
            continue
        if c.isdigit() or (c == "-" and i + 1 < len(s) and s[i + 1].isdigit()):
            j = i + 1
            while j < len(s) and s[j].isdigit():
                j += 1
            if j < len(s) and s[j] == "." and j + 1 < len(s) and s[j + 1].isdigit():
                j += 1
                while j < len(s) and s[j].isdigit():
                    j += 1
                tokens.append(("num", float(s[i:j])))
            else:
                tokens.append(("num", int(s[i:j])))
            i = j
            continue
        if i + 1 < len(s) and s[i:i + 2] in two:
            tokens.append(("op", s[i:i + 2]))
            i += 2
            continue
        if c in one:
            tokens.append(("op", c))
            i += 1
            continue
        j = i
        while j < len(s) and (not s[j].isspace()) and s[j] not in one and s[j] not in "'\"":
            j += 1
        word = s[i:j]
        tokens.append(("word", word))
        i = j
    return tokens


class Parser:
    def __init__(self, text, env=None):
        self.toks = tokenize(text)
        self.i = 0
        self.env = env or {}

    def peek(self, val=None):
        if self.i >= len(self.toks):
            return None
        tok = self.toks[self.i]
        return tok if val is None or tok[1] == val else None

    def pop(self, val=None):
        tok = self.peek(val)
        if tok is None:
            raise NuError("parse error")
        self.i += 1
        return tok

    def parse(self):
        if not self.toks:
            return None
        return self.expr(0)

    def expr(self, min_bp):
        tok = self.pop()
        if tok[0] == "num" or tok[0] == "str":
            lhs = tok[1]
        elif tok == ("word", "true"):
            lhs = True
        elif tok == ("word", "false"):
            lhs = False
        elif tok == ("word", "null"):
            lhs = None
        elif tok == ("word", "not"):
            lhs = not truthy(self.expr(9))
        elif tok == ("op", "-"):
            lhs = -self.expr(9)
        elif tok == ("op", "("):
            lhs = self.expr(0)
            self.pop(")")
        elif tok == ("op", "$"):
            name = self.pop()[1]
            lhs = self.env.get(name)
        elif tok == ("op", "["):
            lhs = self.parse_list_or_table()
        elif tok == ("op", "{"):
            lhs = self.parse_record()
        elif tok[0] == "word":
            lhs = self.env[tok[1]] if tok[1] in self.env else tok[1]
        else:
            raise NuError("parse error")

        while True:
            tok = self.peek()
            if tok is None:
                break
            if tok == ("op", "."):
                self.pop(".")
                key = self.pop()[1]
                lhs = get_col(lhs, key)
                continue
            op = tok[1]
            bp = {
                "or": (1, 2), "and": (3, 4),
                "==": (5, 6), "!=": (5, 6), "<": (5, 6), ">": (5, 6), "<=": (5, 6), ">=": (5, 6),
                "+": (7, 8), "-": (7, 8),
                "*": (9, 10), "/": (9, 10), "//": (9, 10), "mod": (9, 10),
                "..": (11, 12),
            }.get(op)
            if bp is None or bp[0] < min_bp:
                break
            self.pop()
            rhs = self.expr(bp[1])
            lhs = apply_op(op, lhs, rhs)
        return lhs

    def parse_list_or_table(self):
        if self.peek("["):
            self.pop("[")
            headers = []
            while not self.peek("]"):
                tok = self.pop()
                if tok[1] not in {",", ";"}:
                    headers.append(str(tok[1]))
            self.pop("]")
            if self.peek(";"):
                self.pop(";")
            rows = []
            while not self.peek("]"):
                self.pop("[")
                vals = []
                while not self.peek("]"):
                    if self.peek(","):
                        self.pop(",")
                    else:
                        vals.append(self.expr(0))
                self.pop("]")
                rows.append({h: vals[n] if n < len(vals) else None for n, h in enumerate(headers)})
            self.pop("]")
            return rows
        vals = []
        while not self.peek("]"):
            if self.peek(","):
                self.pop(",")
            else:
                vals.append(self.expr(0))
        self.pop("]")
        return vals

    def parse_record(self):
        rec = {}
        while not self.peek("}"):
            if self.peek(","):
                self.pop(",")
                continue
            key = self.pop()[1]
            self.pop(":")
            rec[str(key)] = self.expr(0)
        self.pop("}")
        return rec


def truthy(v):
    return bool(v)


def apply_op(op, a, b):
    if op == "+": return a + b
    if op == "-": return a - b
    if op == "*": return a * b
    if op == "/": return a / b
    if op == "//": return a // b
    if op == "mod": return a % b
    if op == "and": return truthy(a) and truthy(b)
    if op == "or": return truthy(a) or truthy(b)
    if op == "==": return a == b
    if op == "!=": return a != b
    if op == "<": return a < b
    if op == ">": return a > b
    if op == "<=": return a <= b
    if op == ">=": return a >= b
    if op == "..": return ("range", a, b)
    raise NuError("unknown operator")


def parse_expr(text, env=None):
    return Parser(text, env).parse()


def as_jsonable(v):
    if isinstance(v, _dt.datetime):
        return v.isoformat()
    return v


def value_to_string(v):
    if v is True: return "true"
    if v is False: return "false"
    if v is None: return ""
    return str(v)


def get_col(v, key):
    if isinstance(v, list):
        if re.fullmatch(r"\d+", str(key)):
            return v[int(key)]
        return [get_col(x, key) for x in v]
    if isinstance(v, dict):
        return v.get(str(key))
    return getattr(v, str(key), None)


def parse_words(s):
    return [t[1] for t in tokenize(s)]


def simple_args(s):
    vals = []
    for m in re.finditer(r"""'([^']*)'|"([^"]*)"|(\S+)""", s):
        vals.append(next(g for g in m.groups() if g is not None))
    return vals


def path_arg(s, env=None):
    s = s.strip()
    if not s:
        return ""
    if s[0] in "'\"":
        return value_to_string(parse_expr(s, env or {}))
    return s


def run_pipeline(command, env=None):
    parts = split_top(command, "|")
    val = MISSING
    env = env if env is not None else {}
    for part in parts:
        val = run_part(part, val, env)
    return val


def run_part(part, inp=MISSING, env=None):
    env = {} if env is None else env
    part = part.strip()
    if not part:
        return inp if inp is not MISSING else None
    if part.startswith("let "):
        m = re.match(r"let\s+(\w+)\s*=\s*(.*)", part, re.S)
        env[m.group(1)] = run_pipeline(m.group(2), env)
        return None
    rawbits = part.split(None, 1)
    cmd = rawbits[0] if rawbits else ""
    argtext = part[len(cmd):].strip()
    if inp is MISSING and cmd in COMMANDS:
        return COMMANDS[cmd](MISSING, argtext, env)
    if inp is not MISSING:
        if cmd == "str": return cmd_str(inp, argtext, env)
        if cmd == "math": return cmd_math(inp, argtext, env)
        if cmd == "split": return cmd_split(inp, argtext, env)
        if cmd == "to": return cmd_to(inp, argtext, env)
        if cmd == "from": return cmd_from(inp, argtext, env)
        if cmd == "into": return cmd_into(inp, argtext, env)
        if cmd in COMMANDS:
            return COMMANDS[cmd](inp, argtext, env)
    return parse_expr(part, env)


def cmd_str(v, argtext, env):
    words = simple_args(argtext)
    sub = words[0] if words else ""
    s = value_to_string(v)
    if sub in ("upcase", "uppercase"): return s.upper()
    if sub in ("downcase", "lowercase"): return s.lower()
    if sub == "trim": return s.strip()
    if sub == "contains": return value_to_string(words[1]) in s
    if sub == "replace":
        all_flag = "--all" in words
        vals = [w for w in words[1:] if w != "--all"]
        old = value_to_string(vals[0]) if len(vals) > 0 else ""
        new = value_to_string(vals[1]) if len(vals) > 1 else ""
        return s.replace(old, new, -1 if all_flag else 1)
    if sub == "length": return len(s)
    if sub == "capitalize": return s[:1].upper() + s[1:]
    if sub == "substring":
        r = parse_expr(argtext.split(None, 1)[1], env)
        if isinstance(r, tuple) and r[0] == "range":
            start, end = int(r[1]), int(r[2])
            return s[start:end + 1]
    if sub == "starts-with": return s.startswith(value_to_string(words[1]))
    if sub == "ends-with": return s.endswith(value_to_string(words[1]))
    return s


def cmd_math(v, argtext, env):
    vals = v if isinstance(v, list) else [v]
    nums = [x for x in vals if isinstance(x, (int, float))]
    sub = (parse_words(argtext) or [""])[0]
    if sub == "sum": return sum(nums)
    if sub == "product": return math.prod(nums)
    if sub in ("avg", "average"): return sum(nums) / len(nums) if nums else None
    if sub == "min": return min(nums) if nums else None
    if sub == "max": return max(nums) if nums else None
    if sub == "median":
        nums = sorted(nums); n = len(nums)
        return None if n == 0 else (nums[n // 2] if n % 2 else (nums[n // 2 - 1] + nums[n // 2]) / 2)
    return v


def cmd_split(v, argtext, env):
    words = parse_words(argtext)
    s = value_to_string(v)
    if words and words[0] == "chars": return list(s)
    if words and words[0] == "row":
        sep = value_to_string(words[1]) if len(words) > 1 else "\n"
        return s.split(sep)
    if words and words[0] == "column":
        sep = value_to_string(words[1]) if len(words) > 1 else " "
        return [x.split(sep) for x in s.splitlines()]
    return v


def cmd_to(v, argtext, env):
    words = simple_args(argtext)
    sub = words[0] if words else ""
    if sub == "json":
        if "-r" in words or "--raw" in words:
            return json.dumps(v, ensure_ascii=False, separators=(",", ":"), default=as_jsonable)
        return json.dumps(v, ensure_ascii=False, indent=2, default=as_jsonable)
    if sub == "csv":
        rows = v if isinstance(v, list) else [v]
        if not rows: return ""
        if all(isinstance(r, dict) for r in rows):
            fields = list(rows[0].keys())
            out = StringIO()
            w = csv.DictWriter(out, fieldnames=fields, lineterminator="\n")
            w.writeheader()
            for r in rows:
                w.writerow({k: value_to_string(r.get(k)) for k in fields})
            return out.getvalue()
        return "\n".join(value_to_string(x) for x in rows) + "\n"
    if sub == "text":
        return render(v).rstrip("\n")
    return v


def cmd_from(v, argtext, env):
    words = parse_words(argtext)
    sub = words[0] if words else ""
    s = value_to_string(v)
    if sub == "json":
        return json.loads(s)
    if sub == "csv":
        return list(csv.DictReader(StringIO(s)))
    return v


def cmd_into(v, argtext, env):
    sub = (parse_words(argtext) or [""])[0]
    if sub in ("int", "integer"):
        return int(float(value_to_string(v)))
    if sub in ("float", "decimal"):
        return float(value_to_string(v))
    if sub == "string":
        return value_to_string(v)
    if sub == "bool":
        s = value_to_string(v).lower()
        return s not in ("", "0", "false")
    return v


def command_echo(inp, args, env):
    return parse_expr(args, env) if args else None


def command_print(inp, args, env):
    return " ".join(value_to_string(x) for x in parse_words(args))


def command_pwd(inp, args, env):
    return os.getcwd()


def command_ls(inp, args, env):
    pat = args.strip() or "."
    paths = glob.glob(pat)
    if not paths and os.path.exists(pat):
        paths = [pat]
    rows = []
    for p in sorted(paths):
        try:
            st = os.stat(p)
            typ = "dir" if os.path.isdir(p) else "file"
            rows.append({"name": p, "type": typ, "size": st.st_size, "modified": ""})
        except OSError:
            pass
    return rows


def command_open(inp, args, env):
    path = path_arg(args, env) if args else value_to_string(inp)
    with open(path, "r", encoding="utf-8") as f:
        data = f.read()
    low = path.lower()
    if low.endswith(".json"):
        return json.loads(data)
    if low.endswith(".csv"):
        return list(csv.DictReader(StringIO(data)))
    return RawText(data)


def command_save(inp, args, env):
    words = simple_args(args)
    path = value_to_string(words[-1]) if words else ""
    data = inp
    if isinstance(data, (list, dict)):
        data = json.dumps(data, ensure_ascii=False, indent=2)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(value_to_string(data))
    return None


def command_mkdir(inp, args, env):
    for w in simple_args(args):
        os.makedirs(value_to_string(w), exist_ok=True)
    return None


def command_rm(inp, args, env):
    for w in simple_args(args):
        p = value_to_string(w)
        if os.path.isdir(p):
            shutil.rmtree(p)
        elif os.path.exists(p):
            os.remove(p)
    return None


def command_touch(inp, args, env):
    for w in simple_args(args):
        open(value_to_string(w), "a").close()
    return None


def command_cp(inp, args, env):
    ws = [value_to_string(w) for w in simple_args(args)]
    if len(ws) >= 2:
        shutil.copy(ws[0], ws[1])
    return None


def command_mv(inp, args, env):
    ws = [value_to_string(w) for w in simple_args(args)]
    if len(ws) >= 2:
        shutil.move(ws[0], ws[1])
    return None


def command_length(inp, args, env):
    return len(inp) if inp is not MISSING and inp is not None else 0


def command_first(inp, args, env):
    n = parse_words(args)
    if n:
        return inp[:int(n[0])]
    return inp[0] if isinstance(inp, list) and inp else None


def command_last(inp, args, env):
    n = parse_words(args)
    if n:
        return inp[-int(n[0]):]
    return inp[-1] if isinstance(inp, list) and inp else None


def command_reverse(inp, args, env):
    return list(reversed(inp)) if isinstance(inp, list) else inp


def command_sort(inp, args, env):
    return sorted(inp) if isinstance(inp, list) else inp


def command_sort_by(inp, args, env):
    key = parse_words(args)[0]
    return sorted(inp, key=lambda r: r.get(key) if isinstance(r, dict) else r)


def command_take(inp, args, env):
    n = int((parse_words(args) or [1])[0])
    return inp[:n] if isinstance(inp, list) else inp


def command_skip(inp, args, env):
    n = int((parse_words(args) or [1])[0])
    return inp[n:] if isinstance(inp, list) else inp


def command_append(inp, args, env):
    val = parse_expr(args, env)
    return (inp if isinstance(inp, list) else [inp]) + (val if isinstance(val, list) else [val])


def command_prepend(inp, args, env):
    val = parse_expr(args, env)
    return (val if isinstance(val, list) else [val]) + (inp if isinstance(inp, list) else [inp])


def command_get(inp, args, env):
    v = inp
    for key in parse_words(args):
        v = get_col(v, key)
    return v


def command_select(inp, args, env):
    keys = [str(x) for x in parse_words(args)]
    if isinstance(inp, list):
        return [{k: row.get(k) for k in keys} for row in inp if isinstance(row, dict)]
    if isinstance(inp, dict):
        return {k: inp.get(k) for k in keys}
    return inp


def command_columns(inp, args, env):
    if isinstance(inp, dict):
        return list(inp.keys())
    if isinstance(inp, list) and inp and isinstance(inp[0], dict):
        return list(inp[0].keys())
    return []


def command_values(inp, args, env):
    if isinstance(inp, dict):
        return list(inp.values())
    if isinstance(inp, list) and inp and isinstance(inp[0], dict):
        return [list(r.values()) for r in inp]
    return inp


def command_reject(inp, args, env):
    keys = {str(x) for x in parse_words(args)}
    if isinstance(inp, list):
        return [{k: v for k, v in r.items() if k not in keys} if isinstance(r, dict) else r for r in inp]
    if isinstance(inp, dict):
        return {k: v for k, v in inp.items() if k not in keys}
    return inp


def command_flatten(inp, args, env):
    if isinstance(inp, list) and any(isinstance(x, list) for x in inp):
        out = []
        for x in inp:
            out.extend(x if isinstance(x, list) else [x])
        return out
    return inp


def command_is_empty(inp, args, env):
    return len(inp) == 0 if hasattr(inp, "__len__") else inp is None


def command_lines(inp, args, env):
    return value_to_string(inp).splitlines()


def command_rename(inp, args, env):
    new = [str(x) for x in parse_words(args)]
    if isinstance(inp, list) and inp and isinstance(inp[0], dict):
        old = list(inp[0].keys())
        return [{(new[i] if i < len(new) else k): row.get(k) for i, k in enumerate(old)} for row in inp]
    if isinstance(inp, dict):
        old = list(inp.keys())
        return {(new[i] if i < len(new) else k): inp.get(k) for i, k in enumerate(old)}
    return inp


def command_update(inp, args, env):
    ws = parse_words(args)
    if len(ws) < 2:
        return inp
    bits = args.split(None, 1)
    key = str(ws[0])
    val = parse_expr(bits[1], env) if len(bits) > 1 else None
    if isinstance(inp, list):
        return [{**r, key: val} if isinstance(r, dict) else r for r in inp]
    if isinstance(inp, dict):
        out = dict(inp); out[key] = val; return out
    return inp


def command_insert(inp, args, env):
    return command_update(inp, args, env)


def command_reduce(inp, args, env):
    seq = inp if isinstance(inp, list) else [inp]
    if not seq:
        return None
    m = re.search(r"\{\s*(?:\|([^|]+)\|)?\s*(.*?)\s*\}\s*$", args, re.S)
    body = m.group(2) if m else args
    names = [x.strip() for x in (m.group(1) if m and m.group(1) else "it, acc").split(",")]
    acc = seq[0]
    for x in seq[1:]:
        local = {**env, "it": x, "acc": acc}
        if names:
            local[names[0]] = x
        if len(names) > 1:
            local[names[1]] = acc
        acc = parse_expr(body, local)
    return acc


def command_where(inp, args, env):
    def ok(row):
        return truthy(parse_expr(args, {**env, **(row if isinstance(row, dict) else {}), "it": row}))
    return [r for r in inp if ok(r)] if isinstance(inp, list) else inp


def command_each(inp, args, env):
    m = re.search(r"\{\s*(?:\|(\w+)\|)?\s*(.*?)\s*\}\s*$", args, re.S)
    body = m.group(2) if m else args
    var = m.group(1) if m and m.group(1) else "it"
    return [parse_expr(body, {**env, var: x, "it": x}) for x in (inp if isinstance(inp, list) else [inp])]


def command_describe(inp, args, env):
    if isinstance(inp, bool): return "bool"
    if isinstance(inp, int): return "int"
    if isinstance(inp, float): return "float"
    if isinstance(inp, str): return "string"
    if isinstance(inp, list): return "list<any>"
    if isinstance(inp, dict): return "record"
    if isinstance(inp, _dt.datetime): return "datetime"
    if inp is None: return "nothing"
    return type(inp).__name__


def command_date(inp, args, env):
    if parse_words(args)[:1] == ["now"]:
        return _dt.datetime.now().astimezone()
    return None


COMMANDS = {
    "echo": command_echo, "print": command_print,
    "pwd": command_pwd, "ls": command_ls, "open": command_open, "save": command_save,
    "mkdir": command_mkdir, "rm": command_rm, "touch": command_touch, "cp": command_cp, "mv": command_mv,
    "length": command_length, "first": command_first, "last": command_last, "reverse": command_reverse,
    "sort": command_sort, "sort-by": command_sort_by, "get": command_get, "select": command_select,
    "take": command_take, "skip": command_skip, "append": command_append, "prepend": command_prepend,
    "columns": command_columns, "values": command_values, "lines": command_lines,
    "reject": command_reject, "flatten": command_flatten, "is-empty": command_is_empty,
    "rename": command_rename, "update": command_update, "insert": command_insert,
    "where": command_where, "each": command_each, "reduce": command_reduce,
    "describe": command_describe, "date": command_date,
}


def table(rows, headers=None):
    if headers is None:
        headers = []
        for r in rows:
            if isinstance(r, dict):
                for k in r:
                    if k not in headers:
                        headers.append(k)
    matrix = []
    if headers:
        cols = ["#"] + headers
        matrix.append(cols)
        for i, r in enumerate(rows):
            matrix.append([str(i)] + [value_to_string(r.get(h, "")) for h in headers])
    else:
        matrix = [[str(i), value_to_string(v)] for i, v in enumerate(rows)]
    if not matrix:
        return ""
    widths = [max(len(str(row[c])) for row in matrix) for c in range(len(matrix[0]))]
    def border(left, mid, right):
        return left + mid.join("─" * (w + 2) for w in widths) + right
    def row(vals):
        return "│" + "│".join(" " + str(vals[i]).ljust(widths[i]) + " " for i in range(len(widths))) + "│"
    lines = [border("╭", "┬", "╮")]
    lines.append(row(matrix[0]))
    if headers:
        lines.append(border("├", "┼", "┤"))
        for vals in matrix[1:]:
            lines.append(row(vals))
    else:
        for vals in matrix[1:]:
            lines.append(row(vals))
    lines.append(border("╰", "┴", "╯"))
    return "\n".join(lines) + "\n"


def pair_table(items):
    matrix = [[str(k), value_to_string(v)] for k, v in items]
    if not matrix:
        return ""
    widths = [max(len(str(row[c])) for row in matrix) for c in range(2)]
    def border(left, mid, right):
        return left + mid.join("─" * (w + 2) for w in widths) + right
    def row(vals):
        return "│" + "│".join(" " + str(vals[i]).ljust(widths[i]) + " " for i in range(2)) + "│"
    lines = [border("╭", "┬", "╮")]
    lines.extend(row(vals) for vals in matrix)
    lines.append(border("╰", "┴", "╯"))
    return "\n".join(lines) + "\n"


def render(v):
    if v is MISSING or v is None:
        return ""
    if isinstance(v, RawText):
        return str(v)
    if isinstance(v, str):
        return v if v.endswith("\n") else v + "\n"
    if isinstance(v, bool):
        return ("true" if v else "false") + "\n"
    if isinstance(v, (int, float)):
        return value_to_string(v) + "\n"
    if isinstance(v, list):
        if v and all(isinstance(x, dict) for x in v):
            return table(v)
        return table(v, headers=[])
    if isinstance(v, dict):
        return pair_table(v.items())
    if isinstance(v, _dt.datetime):
        return v.isoformat() + "\n"
    return value_to_string(v) + "\n"


def main(argv):
    if "--version" in argv or "-v" in argv:
        sys.stdout.buffer.write(b"0.106.1\n")
        return 0
    if "--help" in argv or "-h" in argv:
        sys.stdout.buffer.write(b"Nushell 0.106.1\n")
        return 0
    cmd = None
    if "-c" in argv:
        i = argv.index("-c")
        if i + 1 < len(argv):
            cmd = argv[i + 1]
    elif "--commands" in argv:
        i = argv.index("--commands")
        if i + 1 < len(argv):
            cmd = argv[i + 1]
    if cmd is None:
        data = sys.stdin.read()
        if not data:
            return 0
        cmd = data
    try:
        result = None
        env = {}
        for stmt in split_top(cmd, ";"):
            if stmt:
                result = run_pipeline(stmt, env)
        sys.stdout.buffer.write(render(result).encode("utf-8"))
        return 0
    except Exception as e:
        sys.stderr.buffer.write(f"Error: {e}\n".encode("utf-8"))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
