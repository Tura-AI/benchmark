#!/usr/bin/env python3
import csv
import io
import json
import math
import os
import re
import sys
from dataclasses import dataclass


class NuError(Exception):
    pass


class NoNewlineStr(str):
    pass


@dataclass
class Env:
    no_newline: bool = False
    table_mode: str = "rounded"
    stdin: str = ""


def split_top(s, sep):
    out, cur, depth, quote = [], [], 0, None
    i = 0
    while i < len(s):
        c = s[i]
        if quote:
            cur.append(c)
            if c == "\\" and quote == '"' and i + 1 < len(s):
                i += 1
                cur.append(s[i])
            elif c == quote:
                quote = None
        else:
            if c in "'\"":
                quote = c
                cur.append(c)
            elif c in "([{":
                depth += 1
                cur.append(c)
            elif c in ")]}":
                depth -= 1
                cur.append(c)
            elif c == sep and depth == 0:
                out.append("".join(cur).strip())
                cur = []
            else:
                cur.append(c)
        i += 1
    out.append("".join(cur).strip())
    return [x for x in out if x != ""]


def tokens(s):
    toks, cur, quote = [], [], None
    pairs = {"[": "]", "{": "}", "(": ")"}
    stack = []
    i = 0
    while i < len(s):
        c = s[i]
        if quote:
            cur.append(c)
            if c == "\\" and quote == '"' and i + 1 < len(s):
                i += 1
                cur.append(s[i])
            elif c == quote:
                quote = None
        else:
            if c in "'\"":
                quote = c
                cur.append(c)
            elif c in pairs:
                stack.append(pairs[c])
                cur.append(c)
            elif stack and c == stack[-1]:
                stack.pop()
                cur.append(c)
            elif c.isspace() and not stack:
                if cur:
                    toks.append("".join(cur))
                    cur = []
            else:
                cur.append(c)
        i += 1
    if cur:
        toks.append("".join(cur))
    return toks


def strip_outer(s, a, b):
    s = s.strip()
    if s.startswith(a) and s.endswith(b):
        return s[1:-1].strip()
    return None


def unquote(s):
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "'\"":
        if s[0] == '"':
            return bytes(s[1:-1], "utf-8").decode("unicode_escape")
        return s[1:-1]
    return s


def quote_json_value(v):
    return json.dumps(to_jsonable(v), indent=2, ensure_ascii=False)


def to_jsonable(v):
    if isinstance(v, list):
        return [to_jsonable(x) for x in v]
    if isinstance(v, dict):
        return {k: to_jsonable(val) for k, val in v.items()}
    return v


def parse_list(inner):
    inner = inner.strip()
    if not inner:
        return []
    if inner.startswith("[") and "];" in inner:
        header_part, row_part = inner.split("];", 1)
        headers = [unquote(x) for x in tokens(header_part[1:].strip())]
        rows = []
        for part in re.finditer(r"\[([^\[\]]*)\]", row_part):
            vals = tokens(part.group(1))
            rows.append({h: eval_expr(vals[i]) if i < len(vals) else None for i, h in enumerate(headers)})
        return rows
    parts = split_top(inner.replace(",", " "), " ")
    if len(parts) <= 1:
        parts = tokens(inner.replace(",", " "))
    return [eval_expr(p) for p in parts]


def parse_record(inner):
    out = {}
    for part in split_top(inner, ","):
        if not part:
            continue
        if ":" not in part:
            continue
        k, v = part.split(":", 1)
        out[unquote(k.strip())] = eval_expr(v.strip())
    return out


def range_value(s):
    m = re.fullmatch(r"(-?\d+(?:\.\d+)?)\.\.(<?)(-?\d+(?:\.\d+)?)?", s.strip())
    if not m:
        return None
    start = float(m.group(1))
    exclusive = bool(m.group(2))
    end = float(m.group(3)) if m.group(3) is not None else start + 99
    vals = []
    cur = int(start) if start.is_integer() else start
    limit = int(end) if end.is_integer() else end
    while cur < limit if exclusive else cur <= limit:
        vals.append(cur)
        cur += 1
    return vals


def translate_math(s):
    s = re.sub(r"\btrue\b", "True", s)
    s = re.sub(r"\bfalse\b", "False", s)
    s = re.sub(r"\bnull\b", "None", s)
    s = re.sub(r"\bmod\b", "%", s)
    return s


def eval_expr(expr, env=None, it=None):
    expr = expr.strip()
    if not expr:
        return None
    if expr.startswith("echo "):
        rest = expr[5:].strip()
        vals = [eval_expr(x, env, it) for x in tokens(rest)]
        return vals[0] if len(vals) == 1 else vals
    if expr.startswith("print "):
        return eval_expr(expr[6:].strip(), env, it)
    if expr == "$in":
        return env.stdin if env else sys.stdin.read()
    if expr == "$it":
        return it
    rv = range_value(expr)
    if rv is not None:
        return rv
    # Postfix access: value.path or value.1
    m = re.match(r"^(.+?)(\.[A-Za-z_#][\w#]*|\.\d+)+$", expr)
    if m and not re.search(r"\d+\.\d+", expr):
        base = m.group(1)
        suffix = expr[len(base):]
        if base.startswith("[") or base.startswith("{") or base.startswith("(") or base.startswith("$"):
            return get_path(eval_expr(base, env, it), suffix[1:])
    outer = strip_outer(expr, "(", ")")
    if outer is not None:
        return eval_pipeline(outer, env, it)
    outer = strip_outer(expr, "[", "]")
    if outer is not None:
        return parse_list(outer)
    outer = strip_outer(expr, "{", "}")
    if outer is not None:
        return parse_record(outer)
    if (expr.startswith('"') and expr.endswith('"')) or (expr.startswith("'") and expr.endswith("'")):
        return unquote(expr)
    if expr in ("true", "false"):
        return expr == "true"
    if expr == "null":
        return None
    if re.fullmatch(r"-?\d+", expr):
        return int(expr)
    if re.fullmatch(r"-?\d+\.\d+", expr):
        return float(expr)
    if "$it" in expr and it is not None:
        return eval_expr(expr.replace("$it", repr(it)), env, it)
    if re.search(r"(\+|-|\*|/|//|%|\*\*|==|!=|<=|>=|<|>|\bmod\b|\band\b|\bor\b|\bnot\b)", expr):
        try:
            val = eval(translate_math(expr), {"__builtins__": {}}, {})
            return normalize_number(val)
        except Exception as e:
            raise NuError(str(e))
    return unquote(expr)


def normalize_number(v):
    if isinstance(v, float) and v.is_integer() and not math.isinf(v):
        return int(v)
    return v


def get_path(v, path):
    cur = v
    for p in path.split("."):
        if p == "":
            continue
        if isinstance(cur, list):
            if p.isdigit():
                cur = cur[int(p)]
            else:
                cur = [get_path(x, p) for x in cur]
        elif isinstance(cur, dict):
            cur = cur[p]
        else:
            raise NuError(f"cannot access {p}")
    return cur


def parse_csv_text(text):
    rows = list(csv.DictReader(io.StringIO(text)))
    return [coerce_row(r) for r in rows]


def coerce_row(r):
    return {k: coerce_scalar(v) for k, v in r.items()}


def coerce_scalar(v):
    if v is None:
        return None
    if re.fullmatch(r"-?\d+", str(v)):
        return int(v)
    if re.fullmatch(r"-?\d+\.\d+", str(v)):
        return float(v)
    return v


def cmd_open(args):
    raw = "--raw" in args
    args = [a for a in args if a != "--raw"]
    if not args:
        raise NuError("missing path")
    path = unquote(args[0])
    if not os.path.exists(path):
        raise NuError("File not found")
    with open(path, "r", encoding="utf-8") as f:
        data = f.read()
    if raw:
        return NoNewlineStr(data)
    lower = path.lower()
    if lower.endswith(".json"):
        return json.loads(data)
    if lower.endswith(".csv"):
        return parse_csv_text(data)
    return NoNewlineStr(data)


def file_record(path):
    st = os.stat(path)
    return {
        "name": path,
        "type": "dir" if os.path.isdir(path) else "file",
        "size": st.st_size,
        "modified": "",
    }


def run_command(input_value, cmd, env, it=None):
    parts = tokens(cmd)
    if not parts:
        return input_value
    name = parts[0]
    args = parts[1:]
    if input_value is None and name not in ("open", "ls", "pwd", "seq", "echo", "print"):
        return eval_expr(cmd, env, it)
    if name == "open":
        return cmd_open(args)
    if name == "pwd":
        return os.getcwd()
    if name == "ls":
        pattern = unquote(args[0]) if args else "."
        if os.path.isdir(pattern):
            items = [os.path.join(pattern, x) for x in os.listdir(pattern)]
        else:
            import glob
            items = glob.glob(pattern)
        return [file_record(x) for x in items]
    if name == "save":
        force = "-f" in args or "--force" in args
        paths = [unquote(a) for a in args if a not in ("-f", "--force")]
        if not paths:
            raise NuError("missing path")
        mode = "w" if force else "x"
        with open(paths[0], mode, encoding="utf-8", newline="") as f:
            f.write("" if input_value is None else str(input_value))
        return None
    if name == "seq":
        a, b = int(args[0]), int(args[1])
        return list(range(a, b + 1))
    if name in ("echo", "print"):
        return eval_expr(cmd, env, it)
    if name == "to":
        if args and args[0] == "json":
            raw = "--raw" in args or "-r" in args
            return json.dumps(to_jsonable(input_value), ensure_ascii=False, separators=(",", ":")) if raw else quote_json_value(input_value)
        if args and args[0] == "csv":
            return to_csv(input_value)
    if name == "from":
        if args and args[0] == "json":
            return json.loads(str(input_value))
        if args and args[0] == "csv":
            return parse_csv_text(str(input_value))
    if name == "str":
        return str_cmd(input_value, args)
    if name == "math":
        return math_cmd(input_value, args)
    if name == "split":
        if args and args[0] == "row":
            return str(input_value).split(unquote(args[1]) if len(args) > 1 else "\n")
        if args and args[0] == "words":
            return str(input_value).split()
    if name == "length":
        return len(input_value) if input_value is not None else 0
    if name == "first":
        n = int(args[0]) if args else None
        return input_value[:n] if n is not None and isinstance(input_value, list) else input_value[0]
    if name == "last":
        n = int(args[0]) if args else None
        return input_value[-n:] if n is not None and isinstance(input_value, list) else input_value[-1]
    if name == "take":
        return input_value[: int(args[0])]
    if name == "skip":
        return input_value[int(args[0]):]
    if name == "reverse":
        return list(reversed(input_value))
    if name in ("sort", "sort-by"):
        key = args[0] if args else None
        return sorted(input_value, key=lambda x: x.get(key) if key and isinstance(x, dict) else x)
    if name == "get":
        return get_path(input_value, args[0])
    if name == "select":
        cols = args
        if isinstance(input_value, list):
            return [{c: r.get(c) for c in cols} for r in input_value if isinstance(r, dict)]
        if isinstance(input_value, dict):
            return {c: input_value.get(c) for c in cols}
    if name == "where":
        cond = " ".join(args)
        return [x for x in input_value if truthy(eval_condition(cond, x, env))]
    if name == "each":
        body = cmd[cmd.find("{") + 1: cmd.rfind("}")].strip()
        body = re.sub(r"^\|\w+\|\s*", "", body)
        return [eval_pipeline(body.replace("$it", repr(x)), env, x) for x in input_value]
    if name == "lines":
        return str(input_value).splitlines()
    if name == "is-empty":
        return input_value in (None, "", [], {})
    raise NuError(f"Command `{name}` not found")


def eval_condition(cond, row, env):
    cond = cond.strip()
    if isinstance(row, dict):
        for k, v in sorted(row.items(), key=lambda kv: -len(kv[0])):
            cond = re.sub(rf"\b{re.escape(k)}\b", repr(v), cond)
    return eval_expr(cond, env, row)


def truthy(v):
    return bool(v)


def str_cmd(v, args):
    sub = args[0] if args else ""
    if sub == "length":
        if isinstance(v, list):
            return [len(str(x)) for x in v]
        return len(str(v))
    if sub == "upcase":
        return str(v).upper()
    if sub == "downcase":
        return str(v).lower()
    if sub == "trim":
        return str(v).strip()
    if sub == "contains":
        return unquote(args[1]) in str(v)
    if sub == "substring":
        spec = args[1]
        m = re.match(r"(-?\d+|\_)?\.\.<?(-?\d+)?", spec)
        if m:
            start = 0 if not m.group(1) or m.group(1) == "_" else int(m.group(1))
            end = None if not m.group(2) else int(m.group(2)) + 1
            return str(v)[start:end]
    if sub == "join":
        sep = unquote(args[1]) if len(args) > 1 else ""
        return NoNewlineStr(sep.join(str(x) for x in v))
    if sub == "replace":
        old = unquote(args[1])
        new = unquote(args[2]) if len(args) > 2 else ""
        return re.sub(old, new, str(v))
    return v


def math_cmd(v, args):
    nums = v if isinstance(v, list) else [v]
    nums = [x for x in nums if isinstance(x, (int, float))]
    sub = args[0] if args else "sum"
    if sub == "sum":
        return normalize_number(sum(nums))
    if sub == "avg":
        return sum(nums) / len(nums)
    if sub == "min":
        return min(nums)
    if sub == "max":
        return max(nums)
    if sub == "median":
        s = sorted(nums)
        n = len(s)
        return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
    return v


def to_csv(v):
    out = io.StringIO()
    if isinstance(v, list) and (not v or isinstance(v[0], dict)):
        fields = list(v[0].keys()) if v else []
        w = csv.DictWriter(out, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        for r in v:
            w.writerow(r)
        return out.getvalue().rstrip("\n")
    if isinstance(v, dict):
        w = csv.DictWriter(out, fieldnames=list(v.keys()), lineterminator="\n")
        w.writeheader()
        w.writerow(v)
        return out.getvalue().rstrip("\n")
    w = csv.writer(out, lineterminator="\n")
    for x in (v if isinstance(v, list) else [v]):
        w.writerow([x])
    return out.getvalue().rstrip("\n")


def eval_pipeline(code, env=None, it=None):
    env = env or Env()
    last = None
    for statement in split_top(code, ";"):
        value = None
        for i, part in enumerate(split_top(statement, "|")):
            value = run_command(value, part, env, it) if i or is_command(part) else eval_expr(part, env, it)
        last = value
    return last


def is_command(part):
    first = tokens(part)[0] if tokens(part) else ""
    return first in {
        "open", "ls", "pwd", "seq", "echo", "print", "to", "from", "str", "math", "split",
        "length", "first", "last", "take", "skip", "reverse", "sort", "sort-by", "get",
        "select", "where", "each", "lines", "save", "is-empty",
    }


def cell_text(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return str(v)
    return str(v)


def format_value(v, env):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float, str)):
        return str(v)
    if isinstance(v, dict):
        rows = [[k, cell_text(val)] for k, val in v.items()]
        return box(rows, headers=None)
    if isinstance(v, list):
        if not v:
            return "╭────────────╮\n│ empty list │\n╰────────────╯"
        if all(isinstance(x, dict) for x in v):
            keys = []
            for r in v:
                for k in r.keys():
                    if k not in keys:
                        keys.append(k)
            rows = [[str(i)] + [cell_text(r.get(k)) for k in keys] for i, r in enumerate(v)]
            return box(rows, headers=["#"] + keys)
        return box([[str(i), cell_text(x)] for i, x in enumerate(v)], headers=None)
    return str(v)


def box(rows, headers=None):
    data = []
    if headers:
        data.append(headers)
    data.extend(rows)
    widths = [max(len(str(row[i])) for row in data) for i in range(len(data[0]))]
    def line(left, mid, right, fill):
        return left + mid.join(fill * (w + 2) for w in widths) + right
    def row(vals):
        return "│ " + " │ ".join(str(vals[i]).ljust(widths[i]) for i in range(len(widths))) + " │"
    out = [line("╭", "┬", "╮", "─")]
    if headers:
        out.append(row(headers))
        out.append(line("├", "┼", "┤", "─"))
        for r in rows:
            out.append(row(r))
    else:
        for r in rows:
            out.append(row(r))
    out.append(line("╰", "┴", "╯", "─"))
    return "\n".join(out)


def parse_args(argv):
    env = Env()
    command = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-c", "--commands"):
            i += 1
            command = argv[i] if i < len(argv) else ""
        elif a in ("-v", "--version"):
            print("0.106.1")
            return env, None, 0
        elif a in ("-h", "--help"):
            print("The nushell language and shell.\n\nUsage:\n  > nu {flags} (script file) ...(script args) ")
            return env, None, 0
        elif a == "--no-newline":
            env.no_newline = True
        elif a in ("-m", "--table-mode"):
            i += 1
            env.table_mode = argv[i] if i < len(argv) else "rounded"
        elif a == "--stdin":
            env.stdin = sys.stdin.read()
        elif a in ("-n", "--no-config-file", "--no-std-lib", "--no-history"):
            pass
        else:
            if command is None and os.path.exists(a):
                with open(a, "r", encoding="utf-8") as f:
                    command = f.read()
        i += 1
    return env, command, None


def main(argv):
    try:
        sys.stdout.reconfigure(encoding="utf-8", newline="\n")
        sys.stderr.reconfigure(encoding="utf-8", newline="\n")
    except Exception:
        pass
    env, command, early = parse_args(argv)
    if early is not None:
        return early
    if command is None:
        return 0
    try:
        result = eval_pipeline(command, env)
        text = format_value(result, env)
        if text:
            end = "" if env.no_newline or isinstance(result, NoNewlineStr) else "\n"
            sys.stdout.write(text + end)
        return 0
    except Exception as e:
        sys.stderr.write(f"Error: nu::shell::external_command\n\n  x {e}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
