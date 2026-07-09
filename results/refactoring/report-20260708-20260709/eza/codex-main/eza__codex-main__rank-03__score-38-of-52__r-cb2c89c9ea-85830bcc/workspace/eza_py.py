#!/usr/bin/env python3
import fnmatch
import math
import os
import re
import stat
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


VERSION = """eza - A modern, maintained replacement for ls
v0.23.3 [+git]
https://github.com/eza-community/eza
"""

HELP_PREFIX = """Usage:
  eza [options] [files...]

META OPTIONS
  -?, --help                 show list of command-line options
  -v, --version              show version of eza

DISPLAY OPTIONS
  -1, --oneline              display one entry per line
  -l, --long                 display extended file metadata as a table
  -G, --grid                 display entries as a grid (default)
  -x, --across               sort the grid across, rather than downwards
  -R, --recurse              recurse into directories
  -T, --tree                 recurse into directories as a tree
"""


SORT_CHOICES = "name, Name, size, extension, Extension, modified, changed, accessed, created, inode, type, none"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@dataclass
class Options:
    long: bool = False
    tree: bool = False
    all_count: int = 0
    almost_all: bool = False
    reverse: bool = False
    sort: str = "name"
    level: int | None = None
    treat_dirs_as_files: bool = False
    only_dirs: bool = False
    only_files: bool = False
    dirs_first: bool = False
    dirs_last: bool = False
    header: bool = False
    no_permissions: bool = False
    no_filesize: bool = False
    no_time: bool = False
    ignore_globs: list[str] = None
    paths: list[str] = None

    def __post_init__(self):
        self.ignore_globs = [] if self.ignore_globs is None else self.ignore_globs
        self.paths = [] if self.paths is None else self.paths


@dataclass
class Entry:
    name: str
    path: Path
    display_name: str | None = None
    raw_arg: str | None = None
    fake_dot: bool = False

    def shown_name(self) -> str:
        return self.display_name if self.display_name is not None else self.name

    def lstat(self):
        if self.fake_dot:
            return self.path.stat()
        return self.path.lstat()

    def is_dir(self) -> bool:
        try:
            return self.path.is_dir()
        except OSError:
            return False

    def is_file(self) -> bool:
        try:
            return self.path.is_file()
        except OSError:
            return False

    def is_symlink(self) -> bool:
        return self.path.is_symlink()

    def size_value(self):
        if self.is_dir() and not self.is_symlink():
            return None
        try:
            return self.lstat().st_size
        except OSError:
            return 0

    def time_value(self, kind: str) -> float:
        try:
            st = self.lstat()
        except OSError:
            return 0.0
        if kind == "created":
            return getattr(st, "st_birthtime", st.st_ctime)
        if kind == "accessed":
            return st.st_atime
        if kind == "changed":
            return st.st_ctime
        return st.st_mtime


class UsageError(Exception):
    def __init__(self, message: str, code: int = 3):
        super().__init__(message)
        self.code = code


def write_out(text: str):
    sys.stdout.buffer.write(text.encode("utf-8"))


def write_err(text: str):
    sys.stderr.buffer.write(text.encode("utf-8", "replace"))


def parse_args(argv: list[str]) -> Options:
    opts = Options()
    i = 0
    parsing = True
    while i < len(argv):
        arg = argv[i]
        if parsing and arg == "--":
            parsing = False
            i += 1
            continue
        if not parsing or not arg.startswith("-") or arg == "-":
            opts.paths.append(arg)
            i += 1
            continue

        def need_value(flag: str) -> str:
            nonlocal i
            if i + 1 >= len(argv):
                raise UsageError(f"eza: Missing argument to option {flag}\n")
            i += 1
            return argv[i]

        if arg.startswith("--"):
            name, eq, val = arg.partition("=")
            long = name[2:]
            if long in ("help",):
                write_out(HELP_PREFIX)
                raise SystemExit(0)
            if long in ("version",):
                write_out(VERSION)
                raise SystemExit(0)
            if long in ("long",):
                if eq:
                    raise UsageError("eza: Option --long does not take arguments\n")
                opts.long = True
            elif long in ("tree",):
                opts.tree = True
            elif long in ("all",):
                opts.all_count += 1
            elif long in ("almost-all",):
                opts.almost_all = True
            elif long in ("reverse",):
                opts.reverse = True
            elif long in ("sort",):
                opts.sort = val if eq else need_value("--sort")
            elif long in ("level",):
                raw = val if eq else need_value("--level")
                try:
                    opts.level = int(raw)
                except ValueError:
                    raise UsageError(f"eza: Couldn't parse '{raw}' as a number\n")
            elif long in ("treat-dirs-as-files", "list-dirs"):
                opts.treat_dirs_as_files = True
            elif long == "only-dirs":
                opts.only_dirs = True
            elif long == "only-files":
                opts.only_files = True
            elif long == "group-directories-first":
                opts.dirs_first = True
            elif long == "group-directories-last":
                opts.dirs_last = True
            elif long == "header":
                opts.header = True
            elif long in ("no-user", "no-group"):
                pass
            elif long == "no-permissions":
                opts.no_permissions = True
            elif long == "no-filesize":
                opts.no_filesize = True
            elif long == "no-time":
                opts.no_time = True
            elif long == "ignore-glob":
                opts.ignore_globs.extend((val if eq else need_value("--ignore-glob")).split("|"))
            elif long in ("color", "colour", "icons", "classify", "absolute", "time-style", "time"):
                if not eq and long in ("time-style", "time"):
                    need_value("--" + long)
                elif eq:
                    pass
                elif long in ("color", "colour", "icons", "classify", "absolute"):
                    if i + 1 < len(argv) and argv[i + 1] in ("always", "auto", "automatic", "never", "on", "off", "follow"):
                        i += 1
            elif long in ("grid", "across", "recurse", "dereference", "no-quotes", "git-ignore", "no-symlinks",
                          "show-symlinks", "binary", "bytes", "group", "numeric", "inode", "links",
                          "modified", "changed", "blocksize", "total-size", "accessed", "created",
                          "hyperlink", "mounts", "smart-group"):
                pass
            else:
                raise UsageError(f"eza: Unknown argument --{long}\n")
        else:
            cluster = arg[1:]
            j = 0
            while j < len(cluster):
                ch = cluster[j]
                rest = cluster[j + 1:]
                if ch == "?":
                    write_out(HELP_PREFIX)
                    raise SystemExit(0)
                if ch == "v":
                    write_out(VERSION)
                    raise SystemExit(0)
                if ch == "l":
                    opts.long = True
                elif ch == "T":
                    opts.tree = True
                elif ch == "a":
                    opts.all_count += 1
                elif ch == "A":
                    opts.almost_all = True
                elif ch == "r":
                    opts.reverse = True
                elif ch == "s":
                    opts.sort = rest if rest else need_value("-s")
                    break
                elif ch == "L":
                    raw = rest if rest else need_value("-L")
                    try:
                        opts.level = int(raw)
                    except ValueError:
                        raise UsageError(f"eza: Couldn't parse '{raw}' as a number\n")
                    break
                elif ch == "I":
                    opts.ignore_globs.extend((rest if rest else need_value("-I")).split("|"))
                    break
                elif ch == "d":
                    opts.treat_dirs_as_files = True
                elif ch == "D":
                    opts.only_dirs = True
                elif ch == "f":
                    opts.only_files = True
                elif ch == "h":
                    opts.header = True
                elif ch in "1GxRXFbgniHmSutUM":
                    pass
                else:
                    raise UsageError(f"eza: Unknown argument -{ch}\n")
                j += 1
        i += 1

    if opts.sort not in {"name", "filename", "Name", "Filename", ".name", ".filename", ".Name", ".Filename",
                         "size", "filesize", "ext", "extension", "Ext", "Extension", "date", "time", "mod",
                         "modified", "new", "newest", "age", "old", "oldest", "ch", "changed", "acc",
                         "accessed", "cr", "created", "type", "none", "inode"}:
        raise UsageError(f'eza: Option --sort (-s) has no "{opts.sort}" setting (choices: {SORT_CHOICES})\n')
    if opts.tree and opts.all_count > 1 and not opts.almost_all:
        raise UsageError("eza: Options --tree and --all --all conflict with each other\n")
    if not opts.paths:
        opts.paths = ["."]
    return opts


def natural_parts(s: str, ignore_case: bool):
    if ignore_case:
        s = s.lower()
    parts = re.split(r"([0-9]+)", s)
    return [int(p) if p.isdigit() else p for p in parts]


def ext_of(name: str):
    base = name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    if "." not in base or base.endswith("."):
        return ""
    return base.rsplit(".", 1)[1]


def type_char(e: Entry):
    if e.is_dir():
        return "d"
    if e.is_symlink():
        return "l"
    return "-"


def sort_key(e: Entry, opts: Options):
    s = opts.sort
    n = e.name
    if s in ("Name", "Filename"):
        return natural_parts(n, False)
    if s in ("name", "filename"):
        return natural_parts(n, True)
    if s in (".Name", ".Filename"):
        return natural_parts(n[1:] if n.startswith(".") else n, False)
    if s in (".name", ".filename"):
        return natural_parts(n[1:] if n.startswith(".") else n, True)
    if s in ("size", "filesize"):
        return 0 if e.size_value() is None else e.size_value()
    if s in ("ext", "extension"):
        return (ext_of(n).lower(), natural_parts(n, True))
    if s in ("Ext", "Extension"):
        return (ext_of(n), natural_parts(n, False))
    if s in ("date", "time", "mod", "modified", "new", "newest"):
        return e.time_value("modified")
    if s in ("age", "old", "oldest"):
        return -e.time_value("modified")
    if s in ("changed", "ch"):
        return e.time_value("changed")
    if s in ("accessed", "acc"):
        return e.time_value("accessed")
    if s in ("created", "cr"):
        return e.time_value("created")
    if s == "type":
        return (type_char(e), natural_parts(n, False))
    if s == "none":
        return 0
    return natural_parts(n, True)


def visible(entries: list[Entry], opts: Options, is_recurse=False) -> list[Entry]:
    out = []
    for e in entries:
        if opts.ignore_globs and any(fnmatch.fnmatchcase(e.name, pat) for pat in opts.ignore_globs):
            continue
        if opts.all_count == 0 and not opts.almost_all and e.name.startswith("."):
            continue
        if opts.only_dirs and not e.is_dir():
            continue
        if opts.only_files and not is_recurse and not e.is_file():
            continue
        out.append(e)
    if opts.sort != "none":
        out.sort(key=lambda x: sort_key(x, opts))
    if opts.reverse:
        out.reverse()
    if opts.dirs_first:
        out.sort(key=lambda x: not x.is_dir())
    if opts.dirs_last:
        out.sort(key=lambda x: x.is_dir())
    return out


def list_dir(path: Path, opts: Options) -> list[Entry]:
    entries: list[Entry] = []
    if opts.all_count > 1 and not opts.almost_all:
        entries.append(Entry(".", path / ".", "."))
        entries.append(Entry("..", path / "..", ".."))
    try:
        with os.scandir(path) as it:
            for d in it:
                entries.append(Entry(d.name, Path(d.path)))
    except OSError as e:
        raise e
    return visible(entries, opts)


def mode_string(e: Entry) -> str:
    first = "d" if e.is_dir() and not e.is_symlink() else ("l" if e.is_symlink() else "-")
    archive = "a" if not e.is_dir() else "-"
    hidden = "h" if e.name.startswith(".") else "-"
    return first + archive + hidden + "--"


def size_string(e: Entry) -> str:
    val = e.size_value()
    return "-" if val is None else str(val)


def time_string(e: Entry) -> str:
    try:
        dt = datetime.fromtimestamp(e.time_value("modified"))
    except (OSError, ValueError):
        dt = datetime.fromtimestamp(0)
    return f"{dt.day:2d} {MONTHS[dt.month - 1]} {dt.hour:02d}:{dt.minute:02d}"


def link_suffix(e: Entry) -> str:
    if e.is_symlink():
        try:
            return " -> " + os.readlink(e.path)
        except OSError:
            return ""
    return ""


def render_name(e: Entry) -> str:
    return e.shown_name() + link_suffix(e)


def long_lines(entries: list[Entry], opts: Options) -> list[str]:
    cols = []
    if not opts.no_permissions:
        modes = [mode_string(e) for e in entries]
        width = max([len(x) for x in modes] + ([len("Mode")] if opts.header else []))
        cols.append(("left", "Mode", modes, width))
    if not opts.no_filesize:
        sizes = [size_string(e) for e in entries]
        width = max([len(x) for x in sizes] + ([len("Size")] if opts.header else []))
        cols.append(("right", "Size", sizes, width))
    if not opts.no_time:
        times = [time_string(e) for e in entries]
        width = max([len(x) for x in times] + ([len("Date Modified")] if opts.header else []))
        cols.append(("left", "Date Modified", times, width))

    lines = []
    if opts.header:
        heads = []
        for align, head, _vals, width in cols:
            heads.append(head.rjust(width) if align == "right" else head.ljust(width))
        heads.append("Name")
        lines.append(" ".join(heads))
    for idx, e in enumerate(entries):
        parts = []
        for align, _head, vals, width in cols:
            v = vals[idx]
            parts.append(v.rjust(width) if align == "right" else v.ljust(width))
        if parts:
            lines.append(" ".join(parts) + " " + render_name(e))
        else:
            lines.append(render_name(e))
    return lines


def display_path_arg(raw: str) -> str:
    p = Path(raw)
    parent = str(p.parent)
    if parent in ("", "."):
        return p.name
    if "/" in raw and "\\" not in raw:
        return parent.replace("\\", "/") + "\\" + p.name
    return str(p)


def render_entries(entries: list[Entry], opts: Options) -> list[str]:
    if opts.long:
        return long_lines(entries, opts)
    return [render_name(e) for e in entries]


def tree_walk(root: Entry, opts: Options, depth=0, prefix_parts=None) -> list[str]:
    if prefix_parts is None:
        prefix_parts = []
    lines = []
    if depth == 0:
        lines.append(root.shown_name())
    if opts.level is not None and depth >= opts.level:
        return lines
    if not root.is_dir() or root.is_symlink():
        return lines
    try:
        kids = list_dir(root.path, opts)
    except OSError:
        return lines
    for idx, child in enumerate(kids):
        last = idx == len(kids) - 1
        edge = "└── " if last else "├── "
        prefix = "".join(prefix_parts) + edge
        if opts.long:
            child_lines = long_lines([child], opts)
            lines.append(prefix + child_lines[0])
        else:
            lines.append(prefix + render_name(child))
        if child.is_dir() and not child.is_symlink():
            next_parts = prefix_parts + (["    "] if last else ["│   "])
            lines.extend(tree_walk(child, opts, depth + 1, next_parts))
    return lines


def collect_argument_entries(opts: Options) -> tuple[list[Entry], list[tuple[str, OSError]]]:
    entries, errors = [], []
    for raw in opts.paths:
        p = Path(raw)
        if not p.exists() and not p.is_symlink():
            errors.append((raw, FileNotFoundError(2, os.strerror(2), raw)))
            continue
        entries.append(Entry(p.name if p.name else raw, p, display_path_arg(raw), raw))
    return entries, errors


def run(opts: Options) -> int:
    arg_entries, errors = collect_argument_entries(opts)
    for raw, err in errors:
        message = "系统找不到指定的文件。" if err.errno == 2 else err.strerror
        write_err(f'"{raw}": {message} (os error {err.errno})\n')
    exit_code = 2 if errors else 0

    if opts.tree:
        lines = []
        if opts.sort != "none":
            arg_entries.sort(key=lambda e: sort_key(e, opts))
        if opts.reverse:
            arg_entries.reverse()
        for e in arg_entries:
            if opts.treat_dirs_as_files or not e.is_dir():
                lines.append(render_name(e))
            else:
                lines.extend(tree_walk(e, opts))
        if lines:
            write_out("\n".join(lines) + "\n")
        return exit_code

    files = []
    dirs = []
    for e in arg_entries:
        if opts.treat_dirs_as_files or not e.is_dir():
            files.append(e)
        else:
            dirs.append(e)
    out_lines = []
    if files:
        if opts.sort != "none":
            files.sort(key=lambda e: sort_key(e, opts))
        if opts.reverse:
            files.reverse()
        out_lines.extend(render_entries(visible(files, opts), opts))
    multiple = len(dirs) + (1 if files else 0) > 1
    for di, d in enumerate(dirs):
        if out_lines:
            out_lines.append("")
        if multiple:
            out_lines.append((d.raw_arg or d.shown_name()) + ":")
        try:
            entries = list_dir(d.path, opts)
            out_lines.extend(render_entries(entries, opts))
        except OSError as e:
            write_err(f'"{d.shown_name()}": {e.strerror} (os error {e.errno})\n')
            exit_code = 2
    if out_lines:
        write_out("\n".join(out_lines) + "\n")
    return exit_code


def main(argv: list[str]) -> int:
    try:
        opts = parse_args(argv)
    except SystemExit as e:
        return int(e.code)
    except UsageError as e:
        write_err(str(e))
        return e.code
    return run(opts)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
