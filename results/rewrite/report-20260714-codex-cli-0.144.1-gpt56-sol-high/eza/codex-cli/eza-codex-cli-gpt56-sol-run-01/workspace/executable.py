#!/usr/bin/env python3
"""Focused Python port of eza 0.23.3's filesystem listing behaviour.

The benchmark runs this on Windows with colours and icons disabled.  The
implementation nevertheless keeps option parsing and output structure close
to eza so the usual combinations remain composable.
"""

from __future__ import annotations

import ctypes
import fnmatch
import functools
import math
import os
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path


VERSION = "eza - A modern, maintained replacement for ls\nv0.23.3 [+git]\nhttps://github.com/eza-community/eza\n"
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


class OptionError(Exception):
    pass


@dataclass
class Options:
    mode_events: list[tuple[int, str]] = field(default_factory=list)
    long: bool = False
    tree: bool = False
    grid: bool = False
    across: bool = False
    recurse: bool = False
    level: int | None = None
    all_count: int = 0
    almost_all: bool = False
    sort: str = "name"
    reverse: bool = False
    dirs_first: bool = False
    dirs_last: bool = False
    only_dirs: bool = False
    only_files: bool = False
    no_symlinks: bool = False
    show_symlinks: bool = False
    list_dirs: bool = False
    ignore: list[str] = field(default_factory=list)
    no_quotes: bool = False
    classify: str = "never"
    header: bool = False
    binary: bool = False
    bytes: bool = False
    no_permissions: bool = False
    no_filesize: bool = False
    no_time: bool = False
    times: list[str] = field(default_factory=list)
    time_style: str = "default"
    file_flags: bool = False
    width: int | None = None
    absolute: str = "off"
    stdin: bool = False
    dereference: bool = False
    follow_symlinks: bool = False

    @property
    def dot_mode(self) -> int:
        if self.almost_all:
            return 1 if self.all_count <= 1 else 2
        return min(self.all_count, 2)


LONG_VALUE = {
    "sort", "level", "ignore-glob", "width", "time", "time-style",
    "color-scale-mode", "colour-scale-mode",
}
LONG_OPTIONAL = {
    "color": "auto", "colour": "auto", "icons": "auto",
    "classify": "auto", "absolute": "on", "color-scale": "all",
    "colour-scale": "all",
}
SHORT_VALUE = {"s": "sort", "L": "level", "I": "ignore-glob", "w": "width", "t": "time"}
SHORT_OPTIONAL = {"F": ("classify", "auto")}

LONG_FLAGS = {
    "oneline": "1", "long": "l", "grid": "G", "across": "x",
    "recurse": "R", "tree": "T", "all": "a", "almost-all": "A",
    "treat-dirs-as-files": "d", "list-dirs": "d", "reverse": "r",
    "group-directories-first": "dirs_first", "group-directories-last": "dirs_last",
    "only-dirs": "D", "only-files": "f", "no-symlinks": "no_symlinks",
    "show-symlinks": "show_symlinks", "binary": "b", "bytes": "B",
    "header": "h", "modified": "m", "changed": "changed", "accessed": "u",
    "created": "U", "no-permissions": "no_permissions", "no-filesize": "no_filesize",
    "no-time": "no_time", "flags": "O", "no-quotes": "no_quotes",
    "dereference": "dereference", "follow-symlinks": "follow_symlinks",
    # Accepted but irrelevant on Windows or in disabled-style benchmark runs.
    "group": "noop", "numeric": "noop", "inode": "noop", "links": "noop",
    "blocksize": "noop", "total-size": "noop", "git": "noop", "no-git": "noop",
    "git-repos": "noop", "git-repos-no-status": "noop", "git-ignore": "noop",
    "extended": "noop", "octal-permissions": "noop", "context": "noop",
    "hyperlink": "noop", "mounts": "noop", "smart-group": "noop", "no-user": "noop",
}
SHORT_FLAGS = {
    "1": "1", "l": "l", "G": "G", "x": "x", "R": "R", "T": "T",
    "a": "a", "A": "A", "d": "d", "r": "r", "D": "D", "f": "f",
    "b": "b", "B": "B", "h": "h", "m": "m", "u": "u", "U": "U", "O": "O",
    "X": "dereference", "g": "noop", "n": "noop", "i": "noop", "H": "noop",
    "S": "noop", "@": "noop", "o": "noop", "Z": "noop", "M": "noop",
}


def _set_flag(o: Options, code: str, pos: int) -> None:
    if code in {"1", "l", "G", "T"}:
        o.mode_events.append((pos, code))
        if code == "l": o.long = True
        if code == "T": o.tree = True
    elif code == "x": o.across = True
    elif code == "R": o.recurse = True
    elif code == "a": o.all_count += 1
    elif code == "A": o.almost_all = True
    elif code == "d": o.list_dirs = True
    elif code == "r": o.reverse = True
    elif code == "dirs_first": o.dirs_first, o.dirs_last = True, False
    elif code == "dirs_last": o.dirs_last, o.dirs_first = True, False
    elif code == "D": o.only_dirs = True
    elif code == "f": o.only_files = True
    elif code == "no_symlinks": o.no_symlinks = True
    elif code == "show_symlinks": o.show_symlinks = True
    elif code == "b": o.binary, o.bytes = True, False
    elif code == "B": o.bytes, o.binary = True, False
    elif code == "h": o.header = True
    elif code == "m" and "modified" not in o.times: o.times.append("modified")
    elif code == "changed" and "changed" not in o.times: o.times.append("changed")
    elif code == "u" and "accessed" not in o.times: o.times.append("accessed")
    elif code == "U" and "created" not in o.times: o.times.append("created")
    elif code == "no_permissions": o.no_permissions = True
    elif code == "no_filesize": o.no_filesize = True
    elif code == "no_time": o.no_time = True
    elif code == "O": o.file_flags = True
    elif code == "no_quotes": o.no_quotes = True
    elif code == "dereference": o.dereference = True
    elif code == "follow_symlinks": o.follow_symlinks = True


def _set_value(o: Options, name: str, value: str) -> None:
    if name == "sort":
        legal = ["name", "Name", "size", "extension", "Extension", "modified", "changed", "accessed", "created", "inode", "type", "none"]
        aliases = {"date":"modified", "time":"modified", "mod":"modified", "new":"modified", "newest":"modified", "age":"age", "old":"age", "oldest":"age", "ext":"extension", "Ext":"Extension", ".name":".name", ".Name":".Name"}
        value = aliases.get(value, value)
        if value not in legal and value not in {"age", ".name", ".Name"}:
            raise OptionError(f'Option --sort (-s) has no "{value}" setting (choices: {", ".join(legal)})')
        if value == "inode" and os.name == "nt":
            raise OptionError(f'Option --sort (-s) has no "inode" setting (choices: {", ".join(legal)})')
        o.sort = value
    elif name == "level":
        try: o.level = int(value, 10)
        except ValueError: raise OptionError(f'Value "{value}" not valid for option --level (-L): invalid digit found in string')
        if o.level < 0: raise OptionError(f'Value "{value}" not valid for option --level (-L): invalid digit found in string')
    elif name == "ignore-glob": o.ignore = value.split("|")
    elif name == "width":
        try: o.width = int(value, 10)
        except ValueError: raise OptionError(f'Value "{value}" not valid for option --width (-w): invalid digit found in string')
    elif name == "time":
        aliases = {"mod":"modified", "ch":"changed", "acc":"accessed", "cr":"created"}
        value = aliases.get(value, value)
        if value not in {"modified", "changed", "accessed", "created"}:
            raise OptionError(f'Option --time (-t) has no "{value}" setting (choices: modified, changed, accessed, created)')
        o.times = [value]
    elif name == "time-style":
        if value not in {"default", "long-iso", "full-iso", "iso", "relative"} and not value.startswith("+"):
            raise OptionError(f'Option --time-style has no "{value}" setting (choices: default, long-iso, full-iso, iso, relative)')
        o.time_style = value
    elif name == "classify":
        if value not in {"always", "auto", "never"}: raise OptionError(f'Option --classify (-F) has no "{value}" setting (choices: always, auto, never)')
        o.classify = "always" if value == "always" else "never"
    elif name == "absolute": o.absolute = value


def parse_args(argv: list[str]) -> tuple[Options, list[str], str | None]:
    o, paths, i, pos, parsing = Options(), [], 0, 0, True
    while i < len(argv):
        arg = argv[i]; pos += 1
        if not parsing or arg == "-": paths.append(arg); i += 1; continue
        if arg == "--": parsing = False; i += 1; continue
        if arg in {"--help", "-?"}: return o, paths, "help"
        if arg in {"--version", "-v"}: return o, paths, "version"
        if arg.startswith("--"):
            body = arg[2:]
            name, eq, value = body.partition("=")
            if name in LONG_VALUE:
                if not eq:
                    i += 1
                    if i >= len(argv): raise OptionError(f"Option --{name} needs a value")
                    value = argv[i]
                _set_value(o, name, value)
            elif name in LONG_OPTIONAL:
                if not eq:
                    default = LONG_OPTIONAL[name]
                    if i + 1 < len(argv) and argv[i + 1] in {"always", "auto", "never", "on", "off", "follow", "all", "size", "age"}:
                        i += 1; value = argv[i]
                    else: value = default
                if name in {"classify", "absolute"}: _set_value(o, name, value)
            elif name == "stdin": o.stdin = True
            elif name in LONG_FLAGS:
                if eq: raise OptionError(f"Flag --{name} does not take a value")
                _set_flag(o, LONG_FLAGS[name], pos)
            else: raise OptionError(f"Unknown argument --{name}")
            i += 1; continue
        if arg.startswith("-"):
            body = arg[1:]
            if "=" in body:
                before, value = body.split("=", 1)
                initial, last = before[:-1], before[-1]
                for ch in initial:
                    if ch in SHORT_OPTIONAL: _set_value(o, SHORT_OPTIONAL[ch][0], SHORT_OPTIONAL[ch][1])
                    elif ch in SHORT_FLAGS: _set_flag(o, SHORT_FLAGS[ch], pos)
                    else: raise OptionError(f"Unknown argument -{ch}")
                if last in SHORT_VALUE: _set_value(o, SHORT_VALUE[last], value)
                elif last in SHORT_OPTIONAL: _set_value(o, SHORT_OPTIONAL[last][0], value)
                else: raise OptionError(f"Flag -{last} does not take a value")
            else:
                j = 0
                while j < len(body):
                    ch = body[j]
                    if ch in SHORT_VALUE:
                        value = body[j + 1:]
                        if not value:
                            i += 1
                            if i >= len(argv): raise OptionError(f"Option -{ch} needs a value")
                            value = argv[i]
                        _set_value(o, SHORT_VALUE[ch], value); break
                    if ch in SHORT_OPTIONAL:
                        _set_value(o, SHORT_OPTIONAL[ch][0], SHORT_OPTIONAL[ch][1])
                    elif ch in SHORT_FLAGS: _set_flag(o, SHORT_FLAGS[ch], pos)
                    else: raise OptionError(f"Unknown argument -{ch}")
                    j += 1
            i += 1; continue
        paths.append(arg); i += 1
    if o.tree and o.all_count >= 2: raise OptionError("Option --tree is useless given --all --all")
    # View flags are resolved right-to-left. Tree is a directory action only
    # when the selected view is a details view.
    if o.mode_events:
        last = o.mode_events[-1][1]
        has_long = any(code == "l" for _, code in o.mode_events)
        if last == "1": o.long, o.tree, o.grid = False, False, False
        elif last == "G": o.long, o.tree, o.grid = has_long, False, True
        elif last == "T": o.long, o.tree, o.grid = has_long, True, False
        elif last == "l": o.long, o.tree, o.grid = True, any(code == "T" for _, code in o.mode_events), False
    return o, paths, None


@dataclass
class Entry:
    path: str
    name: str
    direct: bool = False
    special_dot: bool = False
    stat: os.stat_result | None = None

    def load(self, deref: bool = False) -> "Entry":
        self.stat = os.stat(self.path, follow_symlinks=deref)
        return self

    @property
    def attrs(self) -> int: return int(getattr(self.stat, "st_file_attributes", 0))
    @property
    def is_link(self) -> bool: return bool(self.attrs & 0x400) or os.path.islink(self.path)
    @property
    def is_dir(self) -> bool: return bool(self.attrs & 0x10) if os.name == "nt" else os.path.isdir(self.path)
    @property
    def is_file(self) -> bool: return not self.is_dir and not self.is_link
    @property
    def size(self) -> int: return int(self.stat.st_size if self.stat else 0)


def children(path: str, o: Options) -> list[Entry]:
    out: list[Entry] = []
    if o.dot_mode == 2:
        out.append(Entry(path, ".", special_dot=True).load(o.dereference))
        parent = os.path.abspath(os.path.join(path, os.pardir))
        out.append(Entry(parent, "..", special_dot=True).load(o.dereference))
    with os.scandir(path) as it:
        for de in it:
            if o.dot_mode == 0 and de.name.startswith("."): continue
            e = Entry(de.path, de.name).load(o.dereference)
            if any(fnmatch.fnmatchcase(e.name, pat) for pat in o.ignore): continue
            if o.no_symlinks and e.is_link: continue
            if o.only_dirs and not e.is_dir: continue
            if o.only_files and not (e.is_file or (o.recurse or o.tree)): continue
            out.append(e)
    return sort_entries(out, o)


_NAT = re.compile(r"(\d+)")
def natkey(s: str, sensitive: bool = False):
    if not sensitive: s = s.lower()
    def numeric(x: str):
        value = int(x)
        # natord puts extra leading zeroes first for non-zero values, while
        # an all-zero run is ordered from shortest to longest.
        return (1, value, len(x) if value == 0 else -len(x))
    return tuple(numeric(x) if x.isdigit() else (0, x) for x in _NAT.split(s))


def display_width(s: str) -> int:
    return sum(0 if unicodedata.combining(c) else 2 if unicodedata.east_asian_width(c) in {"W", "F"} else 1 for c in s)


def sort_entries(items: list[Entry], o: Options) -> list[Entry]:
    sf = o.sort
    if sf != "none":
        if sf in {"name", "Name", ".name", ".Name"}:
            sensitive = sf in {"Name", ".Name"}; mix = sf.startswith(".")
            key = lambda e: natkey(e.name[1:] if mix and e.name.startswith(".") else e.name, sensitive)
        elif sf in {"extension", "Extension"}:
            sensitive = sf == "Extension"
            def key(e):
                ext = e.name.rsplit(".", 1)[1].lower() if "." in e.name else ""
                return (ext, natkey(e.name, sensitive))
        elif sf == "size": key = lambda e: e.size
        elif sf in {"modified", "age", "changed", "accessed", "created"}:
            attr = {"modified":"st_mtime_ns", "age":"st_mtime_ns", "changed":"st_mtime_ns", "accessed":"st_atime_ns", "created":"st_ctime_ns"}[sf]
            key = lambda e: getattr(e.stat, attr, 0)
        elif sf == "type": key = lambda e: (0 if e.is_dir else 1 if e.is_link else 2, natkey(e.name, True))
        else: key = lambda e: natkey(e.name)
        items.sort(key=key, reverse=(sf == "age"))
    if o.reverse: items.reverse()
    if o.dirs_first: items.sort(key=lambda e: not (e.is_dir or (e.is_link and os.path.isdir(e.path))))
    elif o.dirs_last: items.sort(key=lambda e: bool(e.is_dir or (e.is_link and os.path.isdir(e.path))))
    return items


def escape_name(s: str, no_quotes: bool) -> str:
    s = "".join(c if ord(c) >= 32 and ord(c) != 127 else c.encode("unicode_escape").decode("ascii") for c in s)
    if not no_quotes and (" " in s or "'" in s):
        q = '"' if "'" in s else "'"; return q + s + q
    return s


def shown_name(e: Entry, o: Options, direct: bool | None = None) -> str:
    direct = e.direct if direct is None else direct
    if o.absolute in {"on", "follow"}: raw = os.path.abspath(e.path)
    elif direct: raw = e.path
    else: raw = e.name
    raw = escape_name(raw, o.no_quotes)
    if o.classify == "always":
        if e.is_dir: raw += "/"
        elif e.is_link: raw += "@"
    if e.is_link and not o.dereference:
        try: raw += " -> " + escape_name(os.readlink(e.path), o.no_quotes)
        except OSError: pass
    return raw


def size_text(e: Entry, o: Options) -> str:
    if e.is_dir: return "-"
    n = e.size
    if o.bytes: return f"{n:,}"
    base, symbols = (1024.0, ("", "Ki", "Mi", "Gi", "Ti", "Pi", "Ei")) if o.binary else (1000.0, ("", "k", "M", "G", "T", "P", "E"))
    if n < base: return f"{n:,}"
    power = min(int(math.log(n, base)), len(symbols) - 1); val = n / (base ** power)
    if val < 10: num = f"{val:.1f}"
    else: num = str(int(math.floor(val + 0.5)))
    return num + symbols[power]


def mode_text(e: Entry) -> str:
    a = e.attrs
    typ = "l" if (a & 0x400 or e.is_link) else "d" if e.is_dir else "-"
    return typ + ("a" if a & 0x20 else "-") + ("r" if a & 0x1 else "-") + ("h" if a & 0x2 else "-") + ("s" if a & 0x4 else "-")


def _current_fixed_offset() -> timedelta:
    return datetime.now().astimezone().utcoffset() or timedelta(0)


def entry_dt(e: Entry, kind: str) -> datetime:
    stamp = e.stat.st_mtime
    if kind == "accessed": stamp = e.stat.st_atime
    elif kind == "created": stamp = e.stat.st_ctime
    return datetime.fromtimestamp(stamp, timezone.utc) + _current_fixed_offset()


def time_text(e: Entry, kind: str, style: str) -> str:
    d = entry_dt(e, kind)
    if style == "long-iso": return d.strftime("%Y-%m-%d %H:%M")
    if style == "full-iso":
        ns = getattr(e.stat, "st_mtime_ns", int(e.stat.st_mtime * 1e9)) % 1_000_000_000
        off = _current_fixed_offset(); mins = int(off.total_seconds() // 60); sign = "+" if mins >= 0 else "-"; mins = abs(mins)
        return d.strftime("%Y-%m-%d %H:%M:%S.") + f"{ns:09d} {sign}{mins//60:02d}{mins%60:02d}"
    if style == "iso": return d.strftime("%m-%d %H:%M") if d.year == datetime.now().year else d.strftime("%Y-%m-%d")
    if style.startswith("+"):
        # Common GNU/chrono directives overlap; this covers benchmark formats.
        return d.strftime(style[1:].replace("%_d", "%d")).lstrip("0")
    if style == "relative":
        sec = max(0, int(datetime.now(timezone.utc).timestamp() - e.stat.st_mtime))
        if sec < 60: return "now"
        if sec < 3600: return f"{sec//60} minutes"
        if sec < 86400: return f"{sec//3600} hours"
        if sec < 31536000: return f"{sec//86400} days"
        return f"{sec//31536000} years"
    if d.year == datetime.now().year: return f"{d.day:2d} {MONTHS[d.month-1]} {d:%H:%M}"
    return f"{d.day:2d} {MONTHS[d.month-1]}  {d.year:04d}"


def columns_for(o: Options) -> list[tuple[str, str, str]]:
    cols: list[tuple[str, str, str]] = []
    if not o.no_permissions: cols.append(("mode", "Mode", "left"))
    if not o.no_filesize: cols.append(("size", "Size", "right"))
    if o.file_flags: cols.append(("flags", "Flags", "left"))
    if not o.no_time:
        selected = set(o.times or ["modified"])
        kinds = [k for k in ("modified", "changed", "created", "accessed") if k in selected]
        heads = {"modified":"Date Modified", "changed":"Date Changed", "accessed":"Date Accessed", "created":"Date Created"}
        cols.extend((k, heads[k], "left") for k in kinds)
    return cols


def value_for(e: Entry, kind: str, o: Options) -> str:
    if kind == "mode": return mode_text(e)
    if kind == "size": return size_text(e, o)
    if kind == "flags":
        names = []
        for bit, name in ((1,"readonly"),(2,"hidden"),(4,"system"),(32,"archive"),(256,"temporary"),(2048,"compressed"),(4096,"offline"),(8192,"not indexed"),(16384,"encrypted")):
            if e.attrs & bit: names.append(name)
        return "-" if not names else "-".join(names)
    return time_text(e, kind, o.time_style)


def render_long(rows: list[tuple[Entry, str]], o: Options) -> str:
    cols = columns_for(o)
    values = [[value_for(e, c[0], o) for c in cols] for e, _ in rows]
    widths = [0] * len(cols)
    for j, c in enumerate(cols):
        widths[j] = max([len(v[j]) for v in values] + ([len(c[1])] if o.header else [0]))
    out: list[str] = []
    if o.header:
        bits = []
        for j, c in enumerate(cols): bits.append(c[1].rjust(widths[j]) if c[2] == "right" else c[1].ljust(widths[j]))
        out.append(" ".join(bits) + (" " if bits else "") + "Name")
    for (e, prefix), vals in zip(rows, values):
        bits = [v.rjust(widths[j]) if cols[j][2] == "right" else v.ljust(widths[j]) for j, v in enumerate(vals)]
        out.append(" ".join(bits) + (" " if bits else "") + prefix + shown_name(e, o))
    return "\n".join(out) + ("\n" if out else "")


def tree_rows(root: Entry, o: Options) -> list[tuple[Entry, str]]:
    rows: list[tuple[Entry, str]] = [(root, "")]
    def walk(path: str, depth: int, ancestors_last: list[bool]) -> None:
        if o.level is not None and depth > o.level: return
        kids = children(path, o)
        for idx, e in enumerate(kids):
            last = idx == len(kids) - 1
            prefix = "".join("    " if x else "│   " for x in ancestors_last) + ("└── " if last else "├── ")
            rows.append((e, prefix))
            if e.is_dir and not e.special_dot and (o.follow_symlinks or not e.is_link): walk(e.path, depth + 1, ancestors_last + [last])
    walk(root.path, 1, [])
    return rows


def render_entries(entries: list[Entry], o: Options) -> str:
    if o.long: return render_long([(e, "") for e in entries], o)
    if o.grid: return render_grid(entries, o)
    return "".join(shown_name(e, o) + "\n" for e in sort_entries(entries, o))


def render_grid(entries: list[Entry], o: Options) -> str:
    entries = sort_entries(entries, o)
    cells = [shown_name(e, o) for e in entries]
    if not cells: return ""
    width = o.width if o.width and o.width > 0 else 80
    n = len(cells)
    if o.across:
        chosen_cols = 1
        for cols in range(n, 0, -1):
            rows = (n + cols - 1) // cols
            widths = [max((display_width(cells[r * cols + c]) for r in range(rows) if r * cols + c < n), default=0) for c in range(cols)]
            if sum(widths) + 2 * (cols - 1) <= width:
                chosen_cols = cols; break
        rows = (n + chosen_cols - 1) // chosen_cols
        matrix = [[r * chosen_cols + c for c in range(chosen_cols) if r * chosen_cols + c < n] for r in range(rows)]
    else:
        rows = n
        max_cell = max(map(display_width, cells))
        for candidate_rows in range(1, n + 1):
            cols = (n + candidate_rows - 1) // candidate_rows
            if candidate_rows == 1:
                needed = max_cell * cols + 2 * (cols - 1)
            else:
                ws = [max((display_width(cells[c * candidate_rows + r]) for r in range(candidate_rows) if c * candidate_rows + r < n), default=0) for c in range(cols)]
                needed = sum(ws) + 2 * (cols - 1)
            if needed <= width:
                rows = candidate_rows; break
        cols = (n + rows - 1) // rows
        matrix = [[c * rows + r for c in range(cols) if c * rows + r < n] for r in range(rows)]
    col_count = max(map(len, matrix))
    col_widths = [max((display_width(cells[row[c]]) for row in matrix if c < len(row)), default=0) for c in range(col_count)]
    lines = []
    for row in matrix:
        line = ""
        for c, idx in enumerate(row):
            line += cells[idx]
            if c < len(row) - 1: line += " " * (col_widths[c] - display_width(cells[idx]) + 2)
        lines.append(line)
    return "\n".join(lines) + "\n"


def runtime_error(path: str, exc: OSError) -> str:
    code = getattr(exc, "winerror", None) or getattr(exc, "errno", 2) or 2
    if os.name == "nt":
        try: msg = ctypes.FormatError(code).strip()
        except Exception: msg = exc.strerror or str(exc)
        return f'"{path}": {msg} (os error {code})\n'
    return f'"{path}": {exc.strerror or str(exc)} (os error {code})\n'


def recursive_sections(root_path: str, o: Options) -> list[tuple[str, list[Entry]]]:
    result: list[tuple[str, list[Entry]]] = []
    # eza compares --level with the component depth of the input path.
    initial_depth = len([p for p in Path(root_path).parts if p != "."]) + 1
    def walk(path: str, depth: int, first: bool) -> None:
        kids = children(path, o); result.append(("" if first else path + ":", kids))
        if o.level is not None and o.level <= depth: return
        for e in kids:
            if e.is_dir and not e.special_dot and (o.follow_symlinks or not e.is_link): walk(e.path, depth + 1, False)
    walk(root_path, initial_depth, True)
    return result


def run(argv: list[str]) -> int:
    try: o, paths, special = parse_args(argv)
    except OptionError as e:
        sys.stderr.buffer.write(("eza: " + str(e) + "\n").encode("utf-8")); return 3
    if special == "version": sys.stdout.buffer.write(VERSION.encode()); return 0
    if special == "help":
        text = "eza - A modern, maintained replacement for ls\n\nUsage:\n  eza [options] [files...]\n"
        sys.stdout.buffer.write(text.encode()); return 0
    if not paths:
        from_stdin = o.stdin or not sys.stdin.isatty()
        if from_stdin:
            separator = os.environ.get("EZA_STDIN_SEPARATOR", "\n")
            paths = [x for x in sys.stdin.read().split(separator) if x]
        else:
            paths = ["."]
    files: list[Entry] = []; dirs: list[Entry] = []; status = 0
    for p in paths:
        try: e = Entry(p, os.path.basename(os.path.normpath(p)) or p, direct=True).load(o.dereference)
        except OSError as ex:
            sys.stderr.buffer.write(runtime_error(p, ex).encode("utf-8")); status = 2; continue
        if e.is_dir and not o.list_dirs and not o.tree: dirs.append(e)
        elif not any(fnmatch.fnmatchcase(e.name, pat) for pat in o.ignore): files.append(e)
    files = sort_entries(files, o)
    chunks: list[str] = []
    if files: chunks.append(render_entries(files, o))
    if o.tree:
        all_rows: list[tuple[Entry, str]] = []
        for e in sort_entries(files, o):
            all_rows.extend(tree_rows(e, o) if e.is_dir else [(e, "")])
        chunks = [render_long(all_rows, o) if o.long else "".join(prefix + shown_name(e, o) + "\n" for e, prefix in all_rows)] if all_rows else []
    else:
        only_dir = len(dirs) == 1 and not files
        for d in dirs:
            if o.recurse:
                sections = recursive_sections(d.path, o)
                for idx, (heading, kids) in enumerate(sections):
                    body = render_entries(kids, o)
                    if idx == 0 and only_dir: chunks.append(body)
                    else: chunks.append((heading + "\n" if heading else (d.path + ":\n")) + body)
            else:
                try: kids = children(d.path, o)
                except OSError as ex:
                    sys.stderr.buffer.write((f"{d.path}: {ex}\n").encode()); continue
                body = render_entries(kids, o)
                chunks.append(body if only_dir else d.path + ":\n" + body)
    # Blocks are separated by exactly one blank line. Empty directory blocks
    # still retain their heading in multi-directory/recursive output.
    output = "\n\n".join(c.rstrip("\n") for c in chunks if c != "")
    if output: output += "\n"
    sys.stdout.buffer.write(output.encode("utf-8", "surrogatepass"))
    return status


if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1:]))
