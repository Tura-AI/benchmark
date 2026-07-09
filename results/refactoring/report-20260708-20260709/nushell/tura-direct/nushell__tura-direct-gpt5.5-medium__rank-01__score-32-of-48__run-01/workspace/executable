#!/usr/bin/env python3
import argparse
import csv
import io
import json
import os
import re
import sys
from dataclasses import dataclass


class NuError(Exception):
    def __init__(self, message, code="nu::shell::error"):
        super().__init__(message)
        self.message = message
        self.code = code

    def headline(self):
        if self.message.endswith("."):
            return self.message
        return self.message + "."


@dataclass
class Table:
    rows: list


def is_table(value):
    return isinstance(value, Table) or (isinstance(value, list) and all(isinstance(x, dict) for x in value))


def as_rows(value):
    return value.rows if isinstance(value, Table) else value


def format_scalar(value):
    if value is None:
        return ""
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, float):
        if value.is_integer() and abs(value) >= 1e15:
            return str(int(value))
        return str(value)
    if isinstance(value, (list, dict, Table)):
        return render(value).rstrip("\n")
    return str(value)


def jsonable(value):
    if isinstance(value, Table):
        return value.rows
    if isinstance(value, list):
        return [jsonable(x) for x in value]
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    return value


def draw_table(headers, rows, show_index=True):
    headers = [str(h) for h in headers]
    body = []
    if show_index:
        full_headers = ["#"] + headers
        for i, row in enumerate(rows):
            body.append([str(i)] + [format_scalar(row.get(h, "")) for h in headers])
    else:
        full_headers = headers
        body = [[format_scalar(row.get(h, "")) for h in headers] for row in rows]
    widths = [len(h) for h in full_headers]
    for row in body:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))
    def line(left, mid, right):
        return left + mid.join("─" * (w + 2) for w in widths) + right
    def row_line(row):
        return "│ " + " │ ".join(str(row[i]).rjust(widths[i]) for i in range(len(widths))) + " │"
    out = [line("╭", "┬", "╮"), row_line(full_headers), line("├", "┼", "┤")]
    out += [row_line(r) for r in body]
    out.append(line("╰", "┴", "╯"))
    return "\n".join(out) + "\n"


def draw_list(values):
    if not values:
        return "╭────────────╮\n│ empty list │\n╰────────────╯\n"
    rows = [{"value": v} for v in values]
    widths = [max(1, len(str(len(values) - 1))), max(1, *(len(format_scalar(v)) for v in values))]
    def line(left, mid, right):
        return left + ("─" * (widths[0] + 2)) + mid + ("─" * (widths[1] + 2)) + right
    out = [line("╭", "┬", "╮")]
    for i, r in enumerate(rows):
        out.append("│ " + str(i).rjust(widths[0]) + " │ " + format_scalar(r["value"]).rjust(widths[1]) + " │")
    out.append(line("╰", "┴", "╯"))
    return "\n".join(out) + "\n"


def draw_record(rec):
    if not rec:
        return "╭──────────────╮\n│ empty record │\n╰──────────────╯\n"
    keyw = max(len(str(k)) for k in rec)
    valw = max(1, *(len(format_scalar(v)) for v in rec.values()))
    top = "╭" + "─" * (keyw + 2) + "┬" + "─" * (valw + 2) + "╮"
    bot = "╰" + "─" * (keyw + 2) + "┴" + "─" * (valw + 2) + "╯"
    out = [top]
    for k, v in rec.items():
        out.append("│ " + str(k).rjust(keyw) + " │ " + format_scalar(v).rjust(valw) + " │")
    out.append(bot)
    return "\n".join(out) + "\n"


def render(value):
    if value is None:
        return ""
    if isinstance(value, Table):
        rows = value.rows
        if not rows:
            return draw_list([])
        headers = []
        for row in rows:
            for k in row:
                if k not in headers:
                    headers.append(k)
        return draw_table(headers, rows, True)
    if isinstance(value, list):
        if is_table(value):
            return render(Table(value))
        return draw_list(value)
    if isinstance(value, dict):
        return draw_record(value)
    return format_scalar(value) + "\n"


TOKEN_RE = re.compile(r'''\s*(=>|==|!=|<=|>=|\.\.|\+\+|\*\*|[\[\]{}(),;:|+\-*/<>]|"(?:`.|\\.|[^"\\])*"|'(?:[^']|'')*'|\$?[A-Za-z_][\w.-]*|\d+\.\d+|\d+|.)''')


def tokenize(s):
    toks = [m.group(1) for m in TOKEN_RE.finditer(s) if m.group(1).strip() != ""]
    return toks


class Parser:
    def __init__(self, text, env=None):
        self.text = text
        self.toks = tokenize(text)
        self.i = 0
        self.env = env or {}

    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else None

    def take(self, x=None):
        t = self.peek()
        if x is not None and t != x:
            raise NuError(f"expected {x}", "nu::parser::parse_error")
        self.i += 1
        return t

    def parse(self):
        if not self.toks:
            return None
        return self.expr()

    def expr(self, minp=0):
        left = self.primary()
        prec = {"or": 1, "and": 2, "==": 3, "!=": 3, "<": 3, ">": 3, "<=": 3, ">=": 3, "++": 4, "+": 5, "-": 5, "*": 6, "/": 6, "mod": 6, "**": 7}
        while self.peek() in prec and prec[self.peek()] >= minp:
            op = self.take()
            if self.peek() is None:
                raise NuError("Incomplete math expression", "nu::parser::incomplete_math_expression")
            right = self.expr(prec[op] + (0 if op == "**" else 1))
            left = apply_op(op, left, right)
        return left

    def primary(self):
        t = self.peek()
        if t is None:
            raise NuError("Unexpected end of code", "nu::parser::unexpected_eof")
        if t == "-":
            self.take("-")
            v = self.primary()
            if isinstance(v, (int, float)):
                return -v
            raise NuError("Incomplete math expression", "nu::parser::incomplete_math_expression")
        if t == "(":
            self.take("("); v = self.expr(); self.take(")"); return v
        if t == "[":
            return self.list_or_table()
        if t == "{":
            return self.record()
        self.take()
        if t.startswith('"') or t.startswith("'"):
            return unquote(t)
        if t == "true": return True
        if t == "false": return False
        if t == "null": return None
        if t.startswith("$"):
            return self.env.get(t[1:], None)
        if re.fullmatch(r"\d+\.\d+", t): return float(t)
        if re.fullmatch(r"\d+", t): return int(t)
        if re.fullmatch(r"\d+(KB|MB|GB)", t, re.I):
            n = re.findall(r"\d+", t)[0]
            return f"{float(n):.1f} {t[-2:].upper()}"
        return t

    def list_or_table(self):
        self.take("[")
        if self.peek() == "[":
            headers = self.simple_list()
            if self.peek() == ";":
                self.take(";")
                rows = []
                while self.peek() and self.peek() != "]":
                    vals = self.simple_list()
                    rows.append({str(h): vals[i] if i < len(vals) else None for i, h in enumerate(headers)})
                self.take("]")
                return Table(rows)
            self.take("]")
            return headers
        vals = []
        while self.peek() and self.peek() != "]":
            if self.peek() == ",":
                self.take(","); continue
            vals.append(self.primary())
        if self.peek() != "]":
            raise NuError("Unexpected end of code", "nu::parser::unexpected_eof")
        self.take("]")
        return vals

    def simple_list(self):
        self.take("[")
        vals = []
        while self.peek() and self.peek() != "]":
            if self.peek() == ",": self.take(","); continue
            vals.append(self.primary())
        self.take("]")
        return vals

    def record(self):
        self.take("{")
        rec = {}
        while self.peek() and self.peek() != "}":
            if self.peek() == ",":
                self.take(","); continue
            key = self.take()
            if key.startswith('"') or key.startswith("'"):
                key = unquote(key)
            self.take(":")
            if key in rec:
                raise NuError("Record field redefined", "nu::parser::redefined")
            rec[str(key)] = self.expr()
        if self.peek() != "}":
            raise NuError("Unexpected end of code", "nu::parser::unexpected_eof")
        self.take("}")
        return rec


def unquote(t):
    if t.startswith('"'):
        body = t[1:-1]
        return body.replace("`n", "\n").replace("`t", "\t").replace('`"', '"').replace("``", "`")
    return t[1:-1].replace("''", "'")


def apply_op(op, a, b):
    if op == "and": return bool(a) and bool(b)
    if op == "or": return bool(a) or bool(b)
    if op == "==": return a == b
    if op == "!=": return a != b
    if op == "<": return a < b
    if op == ">": return a > b
    if op == "<=": return a <= b
    if op == ">=": return a >= b
    if op == "++": return (a or []) + (b or [])
    if op == "+": return a + b
    if op == "-": return a - b
    if op == "*": return a * b
    if op == "/": return a / b
    if op == "mod": return a % b
    if op == "**": return a ** b
    raise NuError(f"unknown operator {op}")


def split_pipeline(text):
    parts, buf, depth, quote = [], [], 0, None
    i = 0
    while i < len(text):
        c = text[i]
        if quote:
            buf.append(c)
            if c == quote:
                quote = None
            i += 1; continue
        if c in "'\"":
            quote = c; buf.append(c); i += 1; continue
        if c in "[{(": depth += 1
        elif c in "]})": depth -= 1
        if c == "|" and depth == 0:
            parts.append("".join(buf).strip()); buf = []
        else:
            buf.append(c)
        i += 1
    parts.append("".join(buf).strip())
    return parts


def parse_words(s):
    return tokenize(s)


def eval_text(text, input_value=None):
    result = input_value
    for idx, part in enumerate(split_pipeline(text)):
        if not part:
            continue
        if idx == 0 and is_unknown_bare_command(part):
            result = run_command(part, result)
        elif idx == 0 and not is_command_start(part):
            result = Parser(part).parse()
        else:
            result = run_command(part, result)
    return result


def is_unknown_bare_command(part):
    words = parse_words(part)
    if len(words) != 1:
        return False
    word = words[0]
    return bool(re.fullmatch(r"[A-Za-z_][\w.-]*", word)) and word not in {"true", "false", "null"}


def is_command_start(part):
    first = parse_words(part)[0] if parse_words(part) else ""
    return first in {"open","ls","glob","echo","print","range","seq","pwd","cd","exit","version"}


def run_command(part, inp):
    words = parse_words(part)
    if not words:
        return inp
    cmd = words[0]
    args = words[1:]
    if cmd == "echo":
        return [Parser(a).parse() for a in args] if len(args) != 1 else Parser(args[0]).parse()
    if cmd == "print":
        vals = [format_scalar(Parser(a).parse()) for a in args if a != "-e"]
        sys.stdout.write(" ".join(vals) + ("\n" if vals else ""))
        return None
    if cmd == "version":
        return {"version": "0.106.1"}
    if cmd == "exit":
        code = int(Parser(args[0]).parse()) if args else 0
        raise SystemExit(code)
    if cmd == "open":
        path = unquote(args[0]) if args and (args[0].startswith('"') or args[0].startswith("'")) else args[0]
        if not os.path.exists(path):
            raise NuError("File not found", "nu::shell::io::file_not_found")
        with open(path, "r", encoding="utf-8", newline="") as f:
            data = f.read()
        if path.endswith(".json"):
            return json.loads(data)
        if path.endswith(".csv"):
            return csv_to_table(data)
        return data.rstrip("\n")
    if cmd == "save":
        path = unquote(args[-1]) if args else None
        if not path:
            raise NuError("missing path")
        mode = "a" if "--append" in args or "-a" in args else "w"
        with open(path, mode, encoding="utf-8", newline="") as f:
            f.write(format_scalar(inp))
        return None
    if cmd == "ls":
        path = "." if not args else unquote(args[0]) if args[0][0] in "'\"" else args[0]
        rows = []
        for name in os.listdir(path):
            p = os.path.join(path, name)
            rows.append({"name": name, "type": "dir" if os.path.isdir(p) else "file", "size": 0 if os.path.isdir(p) else os.path.getsize(p)})
        return Table(rows)
    if cmd == "pwd":
        raise NuError("External command failed", "nu::shell::external_command")
    if cmd == "length":
        return len(as_rows(inp)) if isinstance(inp, Table) else len(inp or []) if not isinstance(inp, (str, dict)) else len(inp)
    if cmd == "first":
        n = int(args[0]) if args and re.fullmatch(r"\d+", args[0]) else None
        seq = as_rows(inp) if isinstance(inp, Table) else inp
        return seq[:n] if n is not None and isinstance(seq, list) else seq[0]
    if cmd == "last":
        seq = as_rows(inp) if isinstance(inp, Table) else inp
        return seq[-1]
    if cmd == "get":
        return get_path(inp, args[0])
    if cmd == "select":
        cols = [a for a in args if not a.startswith("-")]
        rows = as_rows(inp) if is_table(inp) else [inp]
        return Table([{c: r.get(c) for c in cols if isinstance(r, dict) and c in r} for r in rows])
    if cmd == "reject":
        cols = set(args)
        rows = as_rows(inp) if is_table(inp) else [inp]
        return Table([{k: v for k, v in r.items() if k not in cols} for r in rows])
    if cmd == "where":
        col, op, expr = args[0], args[1], " ".join(args[2:])
        rhs = Parser(expr).parse()
        rows = as_rows(inp)
        return Table([r for r in rows if apply_op(op, r.get(col), rhs)])
    if cmd == "sort-by":
        col = args[0]
        return Table(sorted(as_rows(inp), key=lambda r: r.get(col)))
    if cmd == "reverse":
        seq = list(as_rows(inp) if isinstance(inp, Table) else inp)
        seq.reverse(); return Table(seq) if seq and isinstance(seq[0], dict) else seq
    if cmd == "math":
        return math_cmd(args[0], inp)
    if cmd == "str":
        return str_cmd(args, inp)
    if cmd == "split":
        if args[0] == "row":
            sep = Parser(args[1]).parse()
            return str(inp).split(sep)
        if args[0] == "column":
            sep = Parser(args[1]).parse(); cols = [unquote(a) if a[0] in "'\"" else a for a in args[2:]]
            return Table([{cols[i] if i < len(cols) else f"column{i+1}": v for i, v in enumerate(line.split(sep))} for line in str(inp).splitlines()])
    if cmd == "lines":
        return str(inp).splitlines()
    if cmd == "to":
        if args[0] == "json":
            return json.dumps(jsonable(inp), indent=2)
        if args[0] == "csv":
            return table_to_csv(inp)
        if args[0] in ("nuon", "text"):
            return format_scalar(inp)
    if cmd == "from":
        if args[0] == "json":
            return json.loads(str(inp))
        if args[0] == "csv":
            return csv_to_table(str(inp))
    if cmd == "into":
        if args[0] == "string":
            if "--decimals" in args:
                d = int(args[args.index("--decimals") + 1])
                return f"{float(inp):.{d}f}"
            return format_scalar(inp)
        if args[0] == "int": return int(inp)
        if args[0] == "float": return float(inp)
    if cmd == "describe":
        if isinstance(inp, bool): return "bool"
        if isinstance(inp, int): return "int"
        if isinstance(inp, float): return "float"
        if isinstance(inp, str): return "string"
        if isinstance(inp, list): return "list<any>"
        if isinstance(inp, dict): return "record"
    raise NuError("External command failed", "nu::shell::external_command")


def get_path(value, path):
    cur = value
    for part in str(path).split("."):
        if isinstance(cur, Table): cur = cur.rows
        if isinstance(cur, list):
            if part.isdigit():
                i = int(part)
                if i >= len(cur): raise NuError(f"Row number too large (max: {len(cur) - 1})", "nu::shell::access_beyond_end")
                cur = cur[i]
            elif all(isinstance(x, dict) for x in cur):
                cur = [x.get(part) for x in cur]
            else:
                raise NuError("Cannot get column")
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            raise NuError("Cannot get path")
    return cur


def math_cmd(name, inp):
    vals = as_rows(inp) if isinstance(inp, Table) else inp
    if not isinstance(vals, list): vals = [vals]
    nums = [float(x) if isinstance(x, str) and re.fullmatch(r"-?\d+(\.\d+)?", x) else x for x in vals]
    if name == "sum":
        s = sum(nums); return int(s) if float(s).is_integer() else s
    if name == "min": return min(nums)
    if name == "max": return max(nums)
    if name in ("avg", "average"):
        return sum(nums) / len(nums)
    if name == "median":
        nums = sorted(nums); n = len(nums); return nums[n//2] if n % 2 else (nums[n//2-1] + nums[n//2]) / 2
    raise NuError("unknown math command")


def map_string(inp, fn):
    if isinstance(inp, list): return [map_string(x, fn) for x in inp]
    return fn(str(inp))


def str_cmd(args, inp):
    sub = args[0] if args else ""
    if sub == "length": return len(str(inp))
    if sub == "upcase": return map_string(inp, lambda s: s.upper())
    if sub == "downcase": return map_string(inp, lambda s: s.lower())
    if sub == "trim": return map_string(inp, lambda s: s.strip())
    if sub == "contains": return Parser(args[1]).parse() in str(inp)
    if sub == "starts-with": return str(inp).startswith(Parser(args[1]).parse())
    if sub == "ends-with": return str(inp).endswith(Parser(args[1]).parse())
    if sub == "replace": return str(inp).replace(Parser(args[1]).parse(), Parser(args[2]).parse())
    raise NuError("Extra positional argument", "nu::parser::extra_positional")


def csv_to_table(data):
    reader = csv.DictReader(io.StringIO(data))
    rows = []
    for r in reader:
        rows.append({k: convert_atom(v) for k, v in r.items()})
    return Table(rows)


def table_to_csv(value):
    rows = as_rows(value) if is_table(value) else value
    if not rows: return ""
    headers = []
    for r in rows:
        for k in r:
            if k not in headers: headers.append(k)
    out = io.StringIO(newline="")
    w = csv.DictWriter(out, fieldnames=headers, lineterminator="\n")
    w.writeheader(); w.writerows(rows)
    return out.getvalue().rstrip("\n")


def convert_atom(v):
    if v is None: return None
    if re.fullmatch(r"-?\d+", v): return int(v)
    if re.fullmatch(r"-?\d+\.\d+", v): return float(v)
    return v


def print_help():
    sys.stdout.write("The nushell language and shell.\n\nUsage:\n  > nu {flags} (script file) ...(script args) \n")


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--help" in argv or "-h" in argv:
        print_help(); return 0
    if "--version" in argv or "-v" in argv:
        sys.stdout.write("0.106.1\n"); return 0
    no_newline = "--no-newline" in argv
    commands = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-c", "--commands", "-e", "--execute"):
            commands = argv[i + 1] if i + 1 < len(argv) else ""
            i += 2; continue
        i += 1
    if commands is None:
        return 0
    try:
        value = eval_text(commands)
        out = render(value)
        if no_newline and out.endswith("\n"):
            out = out[:-1]
        sys.stdout.write(out)
        return 0
    except SystemExit as e:
        return int(e.code)
    except NuError as e:
        sys.stderr.write(f"Error: {e.headline()}\n")
        return 1
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
