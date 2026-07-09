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


VERSION = "0.106.1"


class NuError(Exception):
    pass


class Parser:
    def __init__(self, text, env=None, input_value=None):
        self.text = text
        self.i = 0
        self.env = env if env is not None else {}
        self.input_value = input_value

    def eof(self):
        self.ws()
        return self.i >= len(self.text)

    def ws(self):
        while self.i < len(self.text) and self.text[self.i].isspace():
            self.i += 1

    def peek(self, s):
        self.ws()
        return self.text.startswith(s, self.i)

    def take(self, s):
        self.ws()
        if self.text.startswith(s, self.i):
            self.i += len(s)
            return True
        return False

    def parse(self):
        val = self.parse_or()
        self.ws()
        val = self.parse_postfix(val)
        return val

    def parse_or(self):
        val = self.parse_and()
        while True:
            if self.take_word("or"):
                val = booly(val) or booly(self.parse_and())
            elif self.take_word("xor"):
                val = booly(val) ^ booly(self.parse_and())
            else:
                return val

    def parse_and(self):
        val = self.parse_compare()
        while self.take_word("and"):
            val = booly(val) and booly(self.parse_compare())
        return val

    def parse_compare(self):
        val = self.parse_range()
        while True:
            op = None
            for cand in ["==", "!=", "<=", ">=", "=~", "!~", "<", ">", "in"]:
                if cand == "in":
                    if self.take_word("in"):
                        op = cand
                        break
                elif self.take(cand):
                    op = cand
                    break
            if not op:
                return val
            rhs = self.parse_range()
            val = compare_values(val, op, rhs)

    def parse_range(self):
        val = self.parse_add()
        if self.take(".."):
            end = self.parse_add()
            if not isinstance(val, int) or not isinstance(end, int):
                raise NuError("range requires integers")
            step = 1 if end >= val else -1
            return list(range(val, end + step, step))
        return val

    def parse_add(self):
        val = self.parse_mul()
        while True:
            if self.take("+"):
                val = add_values(val, self.parse_mul())
            elif self.take("-"):
                val = num(val) - num(self.parse_mul())
            else:
                return val

    def parse_mul(self):
        val = self.parse_unary()
        while True:
            if self.take("*"):
                val = num(val) * num(self.parse_unary())
            elif self.take("/"):
                val = num(val) / num(self.parse_unary())
            elif self.take_word("mod"):
                val = num(val) % num(self.parse_unary())
            else:
                return normalize_number(val)

    def parse_unary(self):
        if self.take("-"):
            return -num(self.parse_unary())
        if self.take_word("not"):
            return not booly(self.parse_unary())
        return self.parse_primary()

    def parse_primary(self):
        self.ws()
        if self.i >= len(self.text):
            return None
        if self.take("("):
            inner = self.read_balanced_content("(", ")")
            return eval_pipeline(inner, self.env, self.input_value)
        if self.peek("[["):
            return self.parse_table()
        c = self.text[self.i]
        if c == "[":
            return self.parse_list()
        if c == "{":
            return self.parse_record()
        if c in "'\"" or self.text.startswith("r#'", self.i):
            return self.parse_string()
        if c == "$":
            self.i += 1
            name = self.parse_ident(allow_q=True)
            if name == "in":
                return self.input_value
            if name == "it":
                return self.env.get("it")
            return self.env.get(name)
        if c.isdigit():
            return self.parse_number()
        ident = self.parse_ident(allow_q=True)
        if ident == "true":
            return True
        if ident == "false":
            return False
        if ident == "null":
            return None
        if ident in self.env:
            return self.env[ident]
        return ident

    def parse_postfix(self, val):
        while self.take("."):
            key = self.parse_ident(allow_q=True)
            optional = key.endswith("?")
            if optional:
                key = key[:-1]
            val = get_path(val, key, optional)
        return val

    def parse_list(self):
        self.take("[")
        out = []
        while True:
            self.ws()
            if self.i >= len(self.text):
                raise NuError("expected closing ]")
            if self.take("]"):
                return out
            item = self.parse_or()
            item = self.parse_postfix(item)
            out.append(item)
            self.ws()
            self.take(",")

    def parse_table(self):
        self.take("[")
        cols = self.parse_list()
        if len(cols) != len(set(map(str, cols))):
            raise NuError("column_defined_twice")
        self.take(";")
        rows = []
        while True:
            self.ws()
            if self.i >= len(self.text):
                raise NuError("expected closing ]")
            if self.take("]"):
                return rows
            row = self.parse_list()
            rec = OrderedDict()
            for idx, col in enumerate(cols):
                rec[str(col)] = row[idx] if idx < len(row) else None
            rows.append(rec)
            self.ws()
            self.take(",")

    def parse_record(self):
        self.take("{")
        rec = OrderedDict()
        while True:
            self.ws()
            if self.i >= len(self.text):
                raise NuError("expected closing }")
            if self.take("}"):
                return rec
            key = self.parse_string() if self.text[self.i] in "'\"" else self.parse_ident(allow_q=False)
            if self.take(":"):
                rec[str(key)] = self.parse_or()
                rec[str(key)] = self.parse_postfix(rec[str(key)])
            else:
                rec[str(key)] = None
            self.ws()
            self.take(",")

    def parse_string(self):
        if self.text.startswith("r#'", self.i):
            end = self.text.find("'#", self.i + 3)
            if end < 0:
                raise NuError("expected closing '#")
            s = self.text[self.i + 3:end]
            self.i = end + 2
            return s
        quote = self.text[self.i]
        self.i += 1
        out = []
        while self.i < len(self.text):
            c = self.text[self.i]
            self.i += 1
            if c == quote:
                return "".join(out)
            if c == "\\" and self.i < len(self.text):
                n = self.text[self.i]
                self.i += 1
                out.append({"n": "\n", "r": "\r", "t": "\t", "\\": "\\", '"': '"', "'": "'"}.get(n, n))
            elif c == "`" and self.i < len(self.text):
                n = self.text[self.i]
                self.i += 1
                out.append({"n": "\n", "r": "\r", "t": "\t"}.get(n, n))
            else:
                out.append(c)
        raise NuError("expected closing quote")

    def parse_number(self):
        self.ws()
        m = re.match(r"\d+(?:\.\d+)?", self.text[self.i:])
        if not m:
            raise NuError("expected number")
        self.i += len(m.group(0))
        return float(m.group(0)) if "." in m.group(0) else int(m.group(0))

    def parse_ident(self, allow_q=False):
        self.ws()
        if self.i < len(self.text) and self.text[self.i] in "'\"":
            return self.parse_string()
        m = re.match(r"[^\s\[\]\{\}\(\),;:\|]+", self.text[self.i:])
        if not m:
            return ""
        self.i += len(m.group(0))
        return m.group(0)

    def take_word(self, word):
        self.ws()
        end = self.i + len(word)
        if self.text[self.i:end] == word and (end == len(self.text) or not (self.text[end].isalnum() or self.text[end] in "_-")):
            self.i = end
            return True
        return False

    def read_balanced_content(self, open_ch, close_ch):
        start = self.i
        depth = 1
        quote = None
        while self.i < len(self.text):
            c = self.text[self.i]
            if quote:
                if c == "\\":
                    self.i += 2
                    continue
                if c == quote:
                    quote = None
            else:
                if c in "'\"":
                    quote = c
                elif c == open_ch:
                    depth += 1
                elif c == close_ch:
                    depth -= 1
                    if depth == 0:
                        s = self.text[start:self.i]
                        self.i += 1
                        return s
            self.i += 1
        raise NuError("unclosed group")


def split_pipeline(s):
    parts, start, depth, quote = [], 0, 0, None
    i = 0
    while i < len(s):
        c = s[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        else:
            if c in "'\"":
                quote = c
            elif c in "([{":
                depth += 1
            elif c in ")]}":
                depth -= 1
            elif c == "|" and depth == 0:
                parts.append(s[start:i].strip())
                start = i + 1
        i += 1
    parts.append(s[start:].strip())
    return [p for p in parts if p]


def shell_words(s):
    words, i = [], 0
    while i < len(s):
        while i < len(s) and s[i].isspace():
            i += 1
        if i >= len(s):
            break
        if s[i] in "'\"":
            p = Parser(s[i:])
            words.append(p.parse_string())
            i += p.i
        elif s[i] == "(":
            p = Parser(s[i:])
            p.take("(")
            words.append(eval_pipeline(p.read_balanced_content("(", ")")))
            i += p.i
        else:
            j = i
            while j < len(s) and not s[j].isspace():
                j += 1
            words.append(s[i:j])
            i = j
    return words


def eval_pipeline(code, env=None, input_value=None):
    env = env if env is not None else {}
    result = input_value
    for idx, part in enumerate(split_pipeline(code)):
        if part.startswith("let "):
            name, expr = part[4:].split("=", 1)
            env[name.strip().lstrip("$")] = eval_pipeline(expr.strip(), env, result)
            result = None
            continue
        if is_command(part, idx):
            result = run_command(part, result, env)
        else:
            result = Parser(part, env, result).parse()
    return result


def is_command(part, idx):
    first = shell_words(part[:80])[0] if part.strip() else ""
    return first in {"echo", "print", "to", "from", "get", "select", "reject", "where", "sort-by", "sort", "length", "math", "str", "split", "columns", "first", "last", "lines", "open", "save", "pwd", "ls", "mkdir", "touch", "rm", "into", "default", "drop", "flatten", "table"}


def run_command(part, inp, env):
    w = shell_words(part)
    if not w:
        return inp
    cmd = w[0]
    if cmd in ("echo", "print"):
        return eval_pipeline(part[len(cmd):].strip(), env, inp) if len(part.split(None, 1)) > 1 else inp
    if cmd == "pwd":
        return os.getcwd()
    if cmd == "ls":
        path = w[1] if len(w) > 1 else "."
        rows = []
        for name in os.listdir(path):
            if name == ".git":
                continue
            p = os.path.join(path, name)
            rows.append(OrderedDict([("name", name), ("type", "dir" if os.path.isdir(p) else "file"), ("size", os.path.getsize(p) if os.path.isfile(p) else 0)]))
        return rows
    if cmd == "open":
        raw = "--raw" in w
        path = w[1]
        data = open(path, "r", encoding="utf-8", errors="replace").read()
        if raw:
            return data
        if path.endswith(".json"):
            return json.loads(data, object_pairs_hook=OrderedDict)
        if path.endswith(".csv"):
            return from_csv(data)
        return data
    if cmd == "save":
        path = w[-1]
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(to_text(inp, final=False))
        return None
    if cmd == "mkdir":
        for p in w[1:]: os.makedirs(p, exist_ok=True)
        return None
    if cmd == "touch":
        for p in w[1:]: open(p, "a", encoding="utf-8").close()
        return None
    if cmd == "rm":
        for p in w[1:]:
            if os.path.isdir(p): os.rmdir(p)
            elif os.path.exists(p): os.remove(p)
        return None
    if cmd == "to" and len(w) > 1 and w[1] == "json":
        raw = "-r" in w or "--raw" in w
        return json.dumps(inp, ensure_ascii=False, separators=(",", ":") if raw else (",", ": "), indent=None if raw else 2)
    if cmd == "from" and len(w) > 1:
        if w[1] == "json":
            text = str(inp)
            if "-o" in w:
                return [json.loads(line, object_pairs_hook=OrderedDict) for line in text.splitlines() if line.strip()]
            return json.loads(text, object_pairs_hook=OrderedDict)
        if w[1] == "csv":
            return from_csv(str(inp))
    if cmd == "get":
        val = inp
        for path in w[1:]:
            for seg in str(path).split("."):
                opt = seg.endswith("?")
                if opt: seg = seg[:-1]
                val = get_path(val, seg, opt)
        return val
    if cmd == "select":
        keys = [str(x) for x in w[1:]]
        if isinstance(inp, list):
            return [select_record(x, keys) for x in inp]
        return select_record(inp, keys)
    if cmd == "reject":
        keys = set(str(x) for x in w[1:])
        def rej(x):
            return OrderedDict((k, v) for k, v in x.items() if k not in keys) if isinstance(x, dict) else x
        return [rej(x) for x in inp] if isinstance(inp, list) else rej(inp)
    if cmd == "where":
        expr = part[len("where"):].strip()
        return [row for row in as_list(inp) if booly(Parser(expr, {**env, "it": row, **(row if isinstance(row, dict) else {})}, row).parse())]
    if cmd == "sort-by":
        keys = [x for x in w[1:] if not str(x).startswith("-")]
        return sorted(as_list(inp), key=lambda r: tuple(get_path(r, k, True) for k in keys))
    if cmd == "sort":
        ci = "-i" in w
        return sorted(as_list(inp), key=lambda x: str(x).lower() if ci else x)
    if cmd == "length":
        return 0 if inp is None else len(inp)
    if cmd == "columns":
        if isinstance(inp, list) and inp and isinstance(inp[0], dict): return list(inp[0].keys())
        if isinstance(inp, dict): return list(inp.keys())
        return []
    if cmd == "first":
        return as_list(inp)[0]
    if cmd == "last":
        return as_list(inp)[-1]
    if cmd == "lines":
        return str(inp).splitlines()
    if cmd == "math":
        op = w[1] if len(w) > 1 else ""
        vals = [num(x) for x in as_list(inp)]
        if op == "sum": return normalize_number(sum(vals))
        if op == "avg": return sum(vals) / len(vals)
        if op == "min": return min(vals)
        if op == "max": return max(vals)
    if cmd == "str":
        op = w[1] if len(w) > 1 else ""
        s = str(inp)
        if op == "upcase": return s.upper()
        if op == "downcase": return s.lower()
        if op == "length": return len(s)
        if op == "contains": return str(w[2]) in s
        if op == "replace": return s.replace(str(w[2]), str(w[3]), 1)
        if op == "join": return str(w[2]).join(map(str, as_list(inp))) if len(w) > 2 else "".join(map(str, as_list(inp)))
        if op == "substring":
            a = int(w[2]); b = int(w[3]) if len(w) > 3 else None
            return s[a:b]
    if cmd == "split" and len(w) > 2:
        if w[1] == "row": return str(inp).split(str(w[2]))
        if w[1] == "column":
            parts = str(inp).split(str(w[2]))
            return OrderedDict((f"column{i+1}", v) for i, v in enumerate(parts))
    if cmd == "into" and len(w) > 1 and w[1] == "int":
        cols = w[2:]
        def conv(x):
            if isinstance(x, dict) and cols:
                y = OrderedDict(x)
                for c in cols: y[c] = int(float(y[c]))
                return y
            return int(float(x))
        return [conv(x) for x in inp] if isinstance(inp, list) else conv(inp)
    if cmd == "drop" and len(w) > 2 and w[1] == "column":
        n = int(w[2])
        def dr(x): return OrderedDict(list(x.items())[:-n]) if isinstance(x, dict) else x
        return [dr(x) for x in inp] if isinstance(inp, list) else dr(inp)
    if cmd == "flatten":
        return flatten(inp, "--all" in w)
    if cmd == "table":
        return inp
    raise NuError(f"unknown command: {cmd}")


def as_list(x):
    return x if isinstance(x, list) else ([] if x is None else [x])


def select_record(x, keys):
    if isinstance(x, dict):
        return OrderedDict((k, x.get(k)) for k in keys)
    if isinstance(x, list):
        return [x[int(k)] for k in keys]
    return x


def flatten(inp, all_levels=False):
    out = []
    for item in as_list(inp):
        if isinstance(item, dict):
            expanded = [OrderedDict(item)]
            for k, v in item.items():
                if isinstance(v, list):
                    nxt = []
                    for base in expanded:
                        for elem in v:
                            b = OrderedDict(base)
                            if isinstance(elem, dict) and all_levels:
                                b.pop(k, None); b.update(elem)
                            else:
                                b[k] = elem
                            nxt.append(b)
                    expanded = nxt
            out.extend(expanded)
        elif isinstance(item, list):
            out.extend(item)
        else:
            out.append(item)
    return out


def from_csv(text):
    rdr = csv.DictReader(io.StringIO(text))
    rows = []
    for row in rdr:
        rec = OrderedDict()
        for k, v in row.items():
            rec[k] = parse_scalar(v)
        rows.append(rec)
    return rows


def parse_scalar(s):
    if s is None: return None
    if re.fullmatch(r"-?\d+", s): return int(s)
    if re.fullmatch(r"-?\d+\.\d+", s): return float(s)
    return s


def get_path(val, key, optional=False):
    if isinstance(val, list):
        if re.fullmatch(r"-?\d+", str(key)):
            idx = int(key)
            if -len(val) <= idx < len(val): return val[idx]
            return None if optional else (_raise("index out of range"))
        return [get_path(x, key, optional) for x in val]
    if isinstance(val, dict):
        if key in val: return val[key]
        return None if optional else _raise("cannot find column")
    if isinstance(val, str) and re.fullmatch(r"-?\d+", str(key)):
        return val[int(key)]
    return None if optional else _raise("cannot find column")


def _raise(msg):
    raise NuError(msg)


def num(x):
    if x is None:
        raise NuError("incomplete math expression")
    if isinstance(x, bool): return int(x)
    if isinstance(x, (int, float)): return x
    return float(x)


def booly(x):
    return bool(x)


def normalize_number(x):
    if isinstance(x, float) and x.is_integer():
        return int(x)
    return x


def add_values(a, b):
    if isinstance(a, str) or isinstance(b, str): return str(a) + str(b)
    return num(a) + num(b)


def compare_values(a, op, b):
    if op == "==": return a == b
    if op == "!=": return a != b
    if op == "<": return a < b
    if op == "<=": return a <= b
    if op == ">": return a > b
    if op == ">=": return a >= b
    if op == "=~": return re.search(str(b), str(a)) is not None
    if op == "!~": return re.search(str(b), str(a)) is None
    if op == "in": return a in b
    return False


def to_text(v, final=True):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        if math.isfinite(v) and v.is_integer(): return str(int(v))
        return str(v)
    if isinstance(v, (int, str)):
        return str(v)
    if isinstance(v, (list, dict)):
        return render_table(v)
    return str(v)


def render_table(v):
    if isinstance(v, dict):
        return "\n".join(f"{k}: {to_text(val, False)}" for k, val in v.items())
    if not v:
        return ""
    if all(not isinstance(x, dict) for x in v):
        return "\n".join(to_text(x, False) for x in v)
    cols = []
    for r in v:
        if isinstance(r, dict):
            for k in r.keys():
                if k not in cols: cols.append(k)
    lines = ["\t".join(["#"] + cols)]
    for i, r in enumerate(v):
        lines.append("\t".join([str(i)] + [to_text(r.get(c), False) if isinstance(r, dict) else "" for c in cols]))
    return "\n".join(lines)


def run(argv):
    if "--version" in argv or "-V" in argv:
        print(VERSION)
        return 0
    if "-c" in argv:
        idx = argv.index("-c")
        code = argv[idx + 1] if idx + 1 < len(argv) else ""
        try:
            val = eval_pipeline(code)
            out = to_text(val)
            if out != "":
                sys.stdout.write(out + "\n")
            return 0
        except Exception as e:
            sys.stderr.write(f"Error: {e}\n")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(run(sys.argv[1:]))
