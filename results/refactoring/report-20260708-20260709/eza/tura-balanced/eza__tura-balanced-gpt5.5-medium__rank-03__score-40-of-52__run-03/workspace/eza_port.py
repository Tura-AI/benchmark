#!/usr/bin/env python3
import argparse
import ctypes
import fnmatch
import os
import re
import stat
import sys
from dataclasses import dataclass, field
from datetime import datetime
from functools import cmp_to_key
from pathlib import Path
from typing import Iterable, Optional


VERSION_TEXT = "eza - A modern, maintained replacement for ls\n"
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", newline="\n")
SORT_ALIASES = {
    "name": ("name", False),
    "filename": ("name", False),
    "Name": ("name", True),
    "Filename": ("name", True),
    ".name": ("mix-hidden", False),
    ".filename": ("mix-hidden", False),
    ".Name": ("mix-hidden", True),
    ".Filename": ("mix-hidden", True),
    "size": ("size", False),
    "filesize": ("size", False),
    "ext": ("extension", False),
    "extension": ("extension", False),
    "Ext": ("extension", True),
    "Extension": ("extension", True),
    "date": ("modified", False),
    "time": ("modified", False),
    "mod": ("modified", False),
    "modified": ("modified", False),
    "new": ("modified", False),
    "newest": ("modified", False),
    "age": ("age", False),
    "old": ("age", False),
    "oldest": ("age", False),
    "ch": ("changed", False),
    "changed": ("changed", False),
    "acc": ("accessed", False),
    "accessed": ("accessed", False),
    "cr": ("created", False),
    "created": ("created", False),
    "type": ("type", False),
    "none": ("none", False),
}


@dataclass
class Options:
    long: bool = False
    tree: bool = False
    recurse: bool = False
    oneline: bool = False
    all_count: int = 0
    almost_all: bool = False
    treat_dirs_as_files: bool = False
    level: Optional[int] = None
    reverse: bool = False
    sort: str = "name"
    sort_case_sensitive: bool = False
    ignore_globs: list[str] = field(default_factory=list)
    dirs_first: bool = False
    dirs_last: bool = False
    only_dirs: bool = False
    only_files: bool = False
    no_symlinks: bool = False
    show_symlinks: bool = False
    classify: str = "never"
    absolute: str = "off"
    color: str = "auto"
    icons: str = "never"
    header: bool = False
    no_permissions: bool = False
    no_filesize: bool = False
    no_time: bool = False
    binary: bool = False
    bytes: bool = False
    time_style: str = "default"
    time_type: str = "modified"
    follow_symlinks: bool = False
    stdin: bool = False
    paths: list[str] = field(default_factory=list)

    @property
    def dot_mode(self) -> str:
        if self.all_count >= 2:
            return "dots"
        if self.all_count == 1 or self.almost_all:
            return "dotfiles"
        return "normal"


@dataclass
class Entry:
    path: Path
    name: str
    parent_listing: bool = False
    is_dot_entry: bool = False

    def stat(self):
        return os.stat(self.path, follow_symlinks=False)

    def exists(self) -> bool:
        return self.path.exists() or self.path.is_symlink()

    def is_dir(self) -> bool:
        return self.path.is_dir() and not self.path.is_symlink()

    def points_to_dir(self) -> bool:
        return self.path.is_dir()

    def is_file(self) -> bool:
        return self.path.is_file() and not self.path.is_symlink()

    def is_symlink(self) -> bool:
        return self.path.is_symlink()

    def size_value(self) -> int:
        try:
            return self.stat().st_size
        except OSError:
            return 0

    def mtime(self) -> float:
        try:
            return self.stat().st_mtime
        except OSError:
            return 0.0

    def ctime(self) -> float:
        try:
            return self.stat().st_ctime
        except OSError:
            return 0.0

    def atime(self) -> float:
        try:
            return self.stat().st_atime
        except OSError:
            return 0.0


def is_windows() -> bool:
    return os.name == "nt"


def ansi_stderr(text: str) -> str:
    if is_windows() and sys.stderr.isatty():
        return f"\x1b[31;1m{text}\x1b[0m"
    return text


def emit_error(message: str, code: int = 3) -> int:
    print(ansi_stderr(f"eza: {message}"), file=sys.stderr)
    return code


def parse_int(value: str, option: str) -> int:
    try:
        return int(value, 10)
    except ValueError:
        short = " (-L)" if option == "level" else ""
        raise ValueError(f'Value "{value}" not valid for option --{option}{short}: invalid digit found in string')


def parse_args(argv: list[str]) -> tuple[Optional[Options], Optional[int]]:
    opts = Options()
    i = 0
    end_options = False
    while i < len(argv):
        arg = argv[i]
        if end_options or not arg.startswith("-") or arg == "-":
            opts.paths.append(arg)
            i += 1
            continue
        if arg == "--":
            end_options = True
            i += 1
            continue
        if arg.startswith("--"):
            name_value = arg[2:]
            name, eq, value = name_value.partition("=")
            try:
                consumed = apply_long(opts, name, value if eq else None, argv, i)
            except ValueError as exc:
                return None, emit_error(str(exc))
            if consumed < 0:
                return None, -consumed
            i += consumed
            continue
        try:
            consumed = apply_short_cluster(opts, arg[1:], argv, i)
        except ValueError as exc:
            return None, emit_error(str(exc))
        if consumed < 0:
            return None, -consumed
        i += consumed
    if opts.tree and opts.all_count >= 2:
        return None, emit_error("Option --tree is useless given --all --all")
    if not opts.paths:
        if opts.stdin:
            opts.paths = [p for p in sys.stdin.read().splitlines() if p]
        else:
            opts.paths = ["."]
    return opts, None


def next_value(argv: list[str], i: int, flag: str) -> tuple[str, int]:
    if i + 1 >= len(argv):
        raise ValueError(f"Missing value for {flag}")
    return argv[i + 1], 2


def apply_long(opts: Options, name: str, value: Optional[str], argv: list[str], i: int) -> int:
    if name in ("help",):
        print_help()
        return -1
    if name in ("version",):
        sys.stdout.write(VERSION_TEXT)
        return -1
    no_value_flags = {
        "long", "tree", "recurse", "all", "almost-all", "treat-dirs-as-files", "list-dirs",
        "reverse", "group-directories-first", "group-directories-last", "only-dirs", "only-files",
        "no-symlinks", "show-symlinks", "oneline", "grid", "across", "header", "binary", "bytes",
        "follow-symlinks", "stdin", "no-quotes", "dereference", "git-ignore", "no-git", "git",
        "total-size", "modified", "changed", "accessed", "created", "no-permissions", "no-filesize",
        "no-user", "no-time", "smart-group", "icons", "color", "colour",
    }
    optional_value = {"classify", "absolute", "icons", "color", "colour", "color-scale", "colour-scale"}
    needs_value = {"sort", "level", "ignore-glob", "width", "time", "time-style", "color-scale-mode", "colour-scale-mode"}
    if name in needs_value:
        if value is None:
            value, consumed = next_value(argv, i, f"--{name}")
        else:
            consumed = 1
        apply_option_value(opts, name, value)
        return consumed
    if name in optional_value:
        consumed = 1
        if value is None:
            if name in ("classify", "icons", "color", "colour", "color-scale", "colour-scale"):
                value = "auto" if name in ("classify", "icons", "color", "colour") else "all"
            elif name == "absolute":
                value = "on"
        apply_option_value(opts, name, value or "")
        return consumed
    if name in no_value_flags:
        if value is not None:
            raise ValueError(f"Flag --{name} cannot be given a value")
        apply_flag(opts, name)
        return 1
    raise ValueError(f"Unknown argument --{name}")


def apply_short_cluster(opts: Options, cluster: str, argv: list[str], i: int) -> int:
    idx = 0
    while idx < len(cluster):
        ch = cluster[idx]
        if ch in "sLIwt":
            val = cluster[idx + 1:]
            if val.startswith("="):
                val = val[1:]
            if not val:
                val, consumed = next_value(argv, i, f"-{ch}")
            else:
                consumed = 1
            apply_option_value(opts, short_to_long(ch), val)
            return consumed
        if ch == "F":
            val = cluster[idx + 1:]
            if val:
                apply_option_value(opts, "classify", val)
                return 1
            opts.classify = "auto"
        else:
            apply_short_flag(opts, ch)
        idx += 1
    return 1


def short_to_long(ch: str) -> str:
    return {"s": "sort", "L": "level", "I": "ignore-glob", "w": "width", "t": "time"}[ch]


def apply_short_flag(opts: Options, ch: str) -> None:
    mapping = {
        "1": "oneline", "l": "long", "G": "grid", "x": "across", "R": "recurse", "T": "tree",
        "a": "all", "A": "almost-all", "d": "treat-dirs-as-files", "r": "reverse", "D": "only-dirs",
        "f": "only-files", "h": "header", "b": "binary", "B": "bytes", "u": "accessed", "U": "created",
        "m": "modified", "X": "dereference",
    }
    if ch == "?":
        print_help()
        raise SystemExit(0)
    if ch == "v":
        sys.stdout.write(VERSION_TEXT)
        raise SystemExit(0)
    if ch not in mapping:
        raise ValueError(f"Unknown argument -{ch}")
    apply_flag(opts, mapping[ch])


def apply_flag(opts: Options, name: str) -> None:
    if name == "long":
        opts.long = True
    elif name == "tree":
        opts.tree = True
    elif name == "recurse":
        opts.recurse = True
    elif name == "oneline":
        opts.oneline = True
    elif name == "all":
        opts.all_count += 1
    elif name == "almost-all":
        opts.almost_all = True
    elif name in ("treat-dirs-as-files", "list-dirs"):
        opts.treat_dirs_as_files = True
    elif name == "reverse":
        opts.reverse = True
    elif name == "group-directories-first":
        opts.dirs_first = True
        opts.dirs_last = False
    elif name == "group-directories-last":
        opts.dirs_last = True
        opts.dirs_first = False
    elif name == "only-dirs":
        opts.only_dirs = True
    elif name == "only-files":
        opts.only_files = True
    elif name == "no-symlinks":
        opts.no_symlinks = True
    elif name == "show-symlinks":
        opts.show_symlinks = True
    elif name == "header":
        opts.header = True
    elif name == "no-permissions":
        opts.no_permissions = True
    elif name == "no-filesize":
        opts.no_filesize = True
    elif name == "no-time":
        opts.no_time = True
    elif name == "binary":
        opts.binary = True
    elif name == "bytes":
        opts.bytes = True
    elif name == "follow-symlinks":
        opts.follow_symlinks = True
    elif name == "stdin":
        opts.stdin = True
    elif name == "modified":
        opts.time_type = "modified"
    elif name == "changed":
        opts.time_type = "changed"
    elif name == "accessed":
        opts.time_type = "accessed"
    elif name == "created":
        opts.time_type = "created"


def apply_option_value(opts: Options, name: str, value: str) -> None:
    if name == "sort":
        if value not in SORT_ALIASES:
            raise ValueError(f'Option --sort (-s) has no "{value}" setting (choices: name, Name, size, extension, Extension, modified, changed, accessed, created, inode, type, none)')
        opts.sort, opts.sort_case_sensitive = SORT_ALIASES[value]
    elif name == "level":
        opts.level = parse_int(value, "level")
    elif name == "ignore-glob":
        opts.ignore_globs = value.split("|")
    elif name == "classify":
        if value not in ("always", "auto", "automatic", "never"):
            raise ValueError(f"Option --classify (-F) has no {value!r} setting")
        opts.classify = "auto" if value == "automatic" else value
    elif name == "absolute":
        if value in ("on", "yes"):
            opts.absolute = "on"
        elif value == "follow":
            opts.absolute = "follow"
        elif value in ("off", "no"):
            opts.absolute = "off"
        else:
            raise ValueError(f"Option --absolute has no {value!r} setting")
    elif name in ("icons", "color", "colour"):
        if value not in ("always", "auto", "automatic", "never"):
            raise ValueError(f"Option --{name} has no {value!r} setting")
        if name == "icons":
            opts.icons = value
        else:
            opts.color = value
    elif name == "time":
        if value not in ("modified", "changed", "accessed", "created"):
            raise ValueError(f"Option --time (-t) has no {value!r} setting (choices: modified, changed, accessed, created)")
        opts.time_type = value
    elif name == "time-style":
        if value not in ("default", "long-iso", "full-iso", "iso", "relative"):
            raise ValueError(f"Option --time-style has no {value!r} setting")
        opts.time_style = value
    elif name in ("width", "color-scale", "colour-scale", "color-scale-mode", "colour-scale-mode"):
        pass


def print_help() -> None:
    sys.stdout.write("Usage: eza [options] [files...]\n")


def natural_chunks(s: str, case_sensitive: bool) -> list[object]:
    if not case_sensitive:
        s = s.lower()
    parts = re.split(r"(\d+)", s)
    out: list[object] = []
    for part in parts:
        if part.isdigit():
            out.append((0, int(part), len(part)))
        else:
            out.append((1, part))
    return out


def cmp_entries(opts: Options, a: Entry, b: Entry) -> int:
    field = opts.sort
    if field == "none":
        return 0
    if field == "size":
        av, bv = a.size_value(), b.size_value()
        return (av > bv) - (av < bv)
    if field in ("modified", "changed", "accessed", "created", "age"):
        getter = {"modified": Entry.mtime, "changed": Entry.ctime, "created": Entry.ctime, "accessed": Entry.atime, "age": Entry.mtime}[field]
        av, bv = getter(a), getter(b)
        if field == "age":
            av, bv = bv, av
        return (av > bv) - (av < bv)
    if field == "extension":
        ae = extension(a.name)
        be = extension(b.name)
        if ae != be:
            ak = (0, "") if ae is None else (1, ae)
            bk = (0, "") if be is None else (1, be)
            return (ak > bk) - (ak < bk)
    if field == "type":
        at, bt = type_rank(a), type_rank(b)
        if at != bt:
            return (at > bt) - (at < bt)
        ak = natural_chunks(a.name, True)
        bk = natural_chunks(b.name, True)
        return (ak > bk) - (ak < bk)
    an = a.name[1:] if field == "mix-hidden" and a.name.startswith(".") else a.name
    bn = b.name[1:] if field == "mix-hidden" and b.name.startswith(".") else b.name
    ak = natural_chunks(an, opts.sort_case_sensitive)
    bk = natural_chunks(bn, opts.sort_case_sensitive)
    return (ak > bk) - (ak < bk)


def extension(name: str) -> Optional[str]:
    if name in (".", ".."):
        return None
    pos = name.rfind(".")
    return None if pos < 0 else name[pos + 1:].lower()


def type_rank(e: Entry) -> int:
    if e.is_dir():
        return 0
    if e.is_file():
        return 1
    if e.is_symlink():
        return 2
    return 7


def windows_attrs(path: Path) -> int:
    if not is_windows():
        return 0
    try:
        return ctypes.windll.kernel32.GetFileAttributesW(str(path))
    except Exception:
        return 0


def is_hidden(e: Entry) -> bool:
    if e.name.startswith("."):
        return True
    if is_windows() and e.name.startswith("_"):
        return True
    if is_windows():
        return bool(windows_attrs(e.path) & 0x2)
    return False


def read_dir_entries(path: Path, opts: Options) -> list[Entry]:
    entries: list[Entry] = []
    if opts.dot_mode == "dots":
        entries.append(Entry(path, ".", parent_listing=True, is_dot_entry=True))
        entries.append(Entry(path / "..", "..", parent_listing=True, is_dot_entry=True))
    try:
        with os.scandir(path) as it:
            for de in it:
                e = Entry(Path(de.path), de.name, parent_listing=True)
                if opts.dot_mode == "normal" and is_hidden(e):
                    continue
                if any(fnmatch.fnmatchcase(e.name, pat) for pat in opts.ignore_globs):
                    continue
                entries.append(e)
    except OSError:
        raise
    filter_entries(entries, opts, is_recurse=False)
    sort_entries(entries, opts)
    return entries


def filter_entries(entries: list[Entry], opts: Options, is_recurse: bool) -> None:
    def keep(e: Entry) -> bool:
        if opts.no_symlinks and e.is_symlink():
            return False
        if opts.only_dirs:
            return e.is_dir() or (opts.show_symlinks and e.points_to_dir())
        if opts.only_files and not is_recurse:
            return e.is_file() or (opts.show_symlinks and e.is_symlink() and not e.points_to_dir())
        return True
    entries[:] = [e for e in entries if keep(e)]


def sort_entries(entries: list[Entry], opts: Options) -> None:
    entries.sort(key=cmp_to_key(lambda a, b: cmp_entries(opts, a, b)))
    if opts.reverse:
        entries.reverse()
    if opts.dirs_first:
        entries.sort(key=lambda e: 0 if e.points_to_dir() else 1)
    elif opts.dirs_last:
        entries.sort(key=lambda e: 1 if e.points_to_dir() else 0)


def display_name(e: Entry, opts: Options) -> str:
    if opts.absolute == "on":
        text = str(e.path.resolve())
    elif not e.parent_listing and opts.absolute == "off":
        text = str(e.path)
    else:
        text = e.name
    if opts.classify == "always":
        if e.is_dir():
            text += "/"
        elif e.is_symlink():
            text += "@"
    text = quote_name(text)
    return text


def quote_name(text: str) -> str:
    if " " not in text and "\t" not in text and "\n" not in text:
        return text
    if "'" not in text:
        return f"'{text}'"
    escaped = text.replace('"', '\\"')
    return f'"{escaped}"'


def mode_string(e: Entry) -> str:
    if is_windows():
        attrs = windows_attrs(e.path)
        if e.is_symlink() or (attrs & 0x400):
            first = "l"
        elif e.is_dir():
            first = "d"
        else:
            first = "-"
        return first + ("a" if attrs & 0x20 or not e.is_dir() else "-") + ("r" if attrs & 0x1 else "-") + ("h" if attrs & 0x2 else "-") + ("s" if attrs & 0x4 else "-")
    try:
        m = e.stat().st_mode
    except OSError:
        return "??????????"
    first = "d" if stat.S_ISDIR(m) else "l" if stat.S_ISLNK(m) else "-"
    bits = ""
    for r, w, x in ((stat.S_IRUSR, stat.S_IWUSR, stat.S_IXUSR), (stat.S_IRGRP, stat.S_IWGRP, stat.S_IXGRP), (stat.S_IROTH, stat.S_IWOTH, stat.S_IXOTH)):
        bits += "r" if m & r else "-"
        bits += "w" if m & w else "-"
        bits += "x" if m & x else "-"
    return first + bits


def format_size(e: Entry, opts: Options) -> str:
    if e.is_dir():
        return "-"
    size = e.size_value()
    if opts.bytes:
        return f"{size:,}"
    if opts.binary:
        units = ["", "Ki", "Mi", "Gi", "Ti"]
        base = 1024.0
    else:
        units = ["", "k", "M", "G", "T"]
        base = 1000.0
    n = float(size)
    idx = 0
    while idx + 1 < len(units) and n >= base:
        n /= base
        idx += 1
    if idx == 0:
        return str(size)
    num = f"{n:.1f}" if n < 10 else str(int(round(n)))
    return num + units[idx]


def format_time(e: Entry, opts: Options) -> str:
    t = {"modified": e.mtime, "changed": e.ctime, "created": e.ctime, "accessed": e.atime}[opts.time_type]()
    dt = datetime.fromtimestamp(t)
    if opts.time_style == "long-iso":
        return dt.strftime("%Y-%m-%d %H:%M")
    if opts.time_style == "full-iso":
        return dt.strftime("%Y-%m-%d %H:%M:%S.%f %z")
    if opts.time_style == "iso":
        return dt.strftime("%m-%d %H:%M") if dt.year == datetime.now().year else dt.strftime("%Y-%m-%d")
    return f"{dt.day:2d} {dt.strftime('%b')} {dt.strftime('%H:%M') if dt.year == datetime.now().year else ' ' + str(dt.year)}"


def long_rows(entries: list[Entry], opts: Options) -> list[str]:
    columns: list[str] = []
    if not opts.no_permissions:
        columns.append("mode")
    if not opts.no_filesize:
        columns.append("size")
    if not opts.no_time:
        columns.append("time")
    rows: list[list[str]] = []
    for e in entries:
        row: list[str] = []
        if "mode" in columns:
            row.append(mode_string(e))
        if "size" in columns:
            row.append(format_size(e, opts))
        if "time" in columns:
            row.append(format_time(e, opts))
        row.append(display_name(e, opts))
        rows.append(row)
    if opts.header:
        header = []
        if "mode" in columns:
            header.append("Mode" if is_windows() else "Permissions")
        if "size" in columns:
            header.append("Size")
        if "time" in columns:
            header.append("Date Modified")
        header.append("Name")
        rows.insert(0, header)
    if not rows:
        return []
    widths = [0] * len(columns)
    for r in rows:
        for idx in range(len(columns)):
            widths[idx] = max(widths[idx], len(r[idx]))
    out = []
    for r in rows:
        parts = []
        for idx, col in enumerate(columns):
            if col == "size":
                parts.append(f"{r[idx]:>{widths[idx]}}")
            else:
                parts.append(f"{r[idx]:<{widths[idx]}}")
        parts.append(r[-1])
        out.append(" ".join(parts))
    return out


def list_path(path_text: str, opts: Options, multiple: bool) -> tuple[list[str], list[str], int]:
    p = Path(path_text)
    errors: list[str] = []
    if not (p.exists() or p.is_symlink()):
        errors.append(f"{path_text!r}: {os.strerror(2)}")
        return [], errors, 2
    if p.is_dir() and not opts.treat_dirs_as_files:
        if opts.only_files and opts.tree:
            return [], errors, 0
        try:
            entries = read_dir_entries(p, opts)
        except OSError as exc:
            errors.append(f"{path_text!r}: {exc.strerror}")
            return [], errors, 2
        lines: list[str] = []
        if multiple and not opts.tree:
            lines.append(f"{path_text}:")
        if opts.tree:
            root = Entry(p, str(p), parent_listing=False)
            lines.append(str(p))
            add_tree(lines, entries, opts, depth=1, max_depth=opts.level, prefix_states=[])
        elif opts.long:
            lines.extend(long_rows(entries, opts))
        else:
            lines.extend(display_name(e, opts) for e in entries)
        return lines, errors, 0
    e = Entry(p, p.name, parent_listing=False)
    lines = long_rows([e], opts) if opts.long else [display_name(e, opts)]
    return lines, errors, 0


def add_tree(lines: list[str], entries: list[Entry], opts: Options, depth: int, max_depth: Optional[int], prefix_states: list[bool]) -> None:
    for idx, e in enumerate(entries):
        last = idx == len(entries) - 1
        prefix = "".join("    " if was_last else "│   " for was_last in prefix_states)
        branch = "└── " if last else "├── "
        if opts.long:
            base = long_rows([e], opts)[0]
            lines.append(prefix + branch + base)
        else:
            lines.append(prefix + branch + display_name(e, opts))
        if e.is_dir() and not e.is_dot_entry and (max_depth is None or depth < max_depth):
            try:
                child = read_dir_entries(e.path, opts)
            except OSError as exc:
                print(f"{str(e.path)!r}: {exc.strerror}", file=sys.stderr)
                continue
            add_tree(lines, child, opts, depth + 1, max_depth, prefix_states + [last])


def main(argv: Optional[list[str]] = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    try:
        opts, early = parse_args(argv)
    except SystemExit as exc:
        return int(exc.code or 0)
    if early is not None:
        return early
    assert opts is not None
    all_lines: list[str] = []
    status = 0
    multiple = len(opts.paths) > 1
    for idx, path in enumerate(opts.paths):
        lines, errors, code = list_path(path, opts, multiple)
        if idx and lines and all_lines and not opts.tree:
            all_lines.append("")
        all_lines.extend(lines)
        for err in errors:
            print(err, file=sys.stderr)
        status = max(status, code)
    if all_lines:
        sys.stdout.write("\n".join(all_lines) + "\n")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
