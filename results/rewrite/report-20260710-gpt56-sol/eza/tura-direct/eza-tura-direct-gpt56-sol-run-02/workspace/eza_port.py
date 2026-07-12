#!/usr/bin/env python3
"""A focused Python port of eza 0.23.3's non-interactive listing modes."""

from __future__ import annotations

import datetime as dt
import fnmatch
import json
import math
import ntpath
import os
import re
import stat
import sys
import unicodedata
from dataclasses import dataclass, field
from functools import cmp_to_key
from typing import Iterable, Optional


VERSION = """eza - A modern, maintained replacement for ls
v0.23.3 [+git]
https://github.com/eza-community/eza
"""

HELP = """Usage:
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
  -X, --dereference          dereference symbolic links when displaying information
  -F, --classify=WHEN        display type indicator by file names (always, auto, never)
  --colo[u]r=WHEN            when to use terminal colours (always, auto, never)
  --colo[u]r-scale           highlight levels of 'field' distinctly(all, age, size)
  --colo[u]r-scale-mode      use gradient or fixed colors in --color-scale (fixed, gradient)
  --icons=WHEN               when to display icons (always, auto, never)
  --no-quotes                don't quote file names with spaces
  --hyperlink                display entries as hyperlinks
  --absolute                 display entries with their absolute path (on, follow, off)
  --follow-symlinks          drill down into symbolic links that point to directories
  -w, --width COLS           set screen width in columns


FILTERING AND SORTING OPTIONS
  -a, --all                  show hidden and 'dot' files. Use this twice to also
                             show the '.' and '..' directories
  -A, --almost-all           equivalent to --all; included for compatibility with `ls -A`
  -d, --treat-dirs-as-files  list directories as files; don't list their contents
  -D, --only-dirs            list only directories
  -f, --only-files           list only files
  --show-symlinks            explicitly show symbolic links (for use with --only-dirs | --only-files)
  --no-symlinks              do not show symbolic links
  -L, --level DEPTH          limit the depth of recursion
  -r, --reverse              reverse the sort order
  -s, --sort SORT_FIELD      which field to sort by
  --group-directories-first  list directories before other files
  --group-directories-last   list directories after other files
  -I, --ignore-glob GLOBS    glob patterns (pipe-separated) of files to ignore
  --git-ignore               ignore files mentioned in '.gitignore'
  Valid sort fields:         name, Name, extension, Extension, size, type,
                             created, modified, accessed, changed, inode, and none.
                             date, time, old, and new all refer to modified.

LONG VIEW OPTIONS
  -b, --binary               list file sizes with binary prefixes
  -B, --bytes                list file sizes in bytes, without any prefixes
  -g, --group                list each file's group
  --smart-group              only show group if it has a different name from owner
  -h, --header               add a header row to each column
  -H, --links                list each file's number of hard links
  -i, --inode                list each file's inode number
  -M, --mounts               show mount details (Linux and Mac only)
  -n, --numeric              list numeric user and group IDs
  -O, --flags                list file flags (Mac, BSD, and Windows only)
  -S, --blocksize            show size of allocated file system blocks
  -t, --time FIELD           which timestamp field to list (modified, accessed, created)
  -m, --modified             use the modified timestamp field
  -u, --accessed             use the accessed timestamp field
  -U, --created              use the created timestamp field
  --changed                  use the changed timestamp field
  --time-style               how to format timestamps (default, iso, long-iso,
                             full-iso, relative, or a custom style '+<FORMAT>'
                             like '+%Y-%m-%d %H:%M')
  --total-size               show the size of a directory as the size of all
                             files and directories inside (unix only)
  -o, --octal-permissions    list each file's permission in octal format
  --no-permissions           suppress the permissions field
  --no-filesize              suppress the filesize field
  --no-user                  suppress the user field
  --no-time                  suppress the time field
  --stdin                    read file names from stdin, one per line or other separator 
                             specified in environment
  --git                      list each file's Git status, if tracked or ignored
  --no-git                   suppress Git status (always overrides --git,
                             --git-repos, --git-repos-no-status)
  --git-repos                list root of git-tree status
  --git-repos-no-status      list each git-repos branch name (much faster)
    
"""


class OptionFailure(Exception):
    pass


@dataclass
class Options:
    long: bool = False
    oneline: bool = False
    explicit_grid: bool = False
    across: bool = False
    recurse: bool = False
    tree: bool = False
    dereference: bool = False
    follow_symlinks: bool = False
    all_count: int = 0
    list_dirs: bool = False
    only_dirs: bool = False
    only_files: bool = False
    show_symlinks: bool = False
    no_symlinks: bool = False
    reverse: bool = False
    sort: str = "name"
    dirs_first: bool = False
    dirs_last: bool = False
    ignores: list[str] = field(default_factory=list)
    level_raw: Optional[str] = None
    level: Optional[int] = None
    width_raw: Optional[str] = None
    width: Optional[int] = None
    classify: str = "never"
    no_quotes: bool = False
    absolute: str = "off"
    header: bool = False
    size_format: str = "decimal"
    no_permissions: bool = False
    no_filesize: bool = False
    no_time: bool = False
    flags: bool = False
    time_style: str = "default"
    time_types: list[str] = field(default_factory=list)
    stdin: bool = False
    help: bool = False
    version: bool = False


SORT_ALIASES = {
    "name": "name", "filename": "name", "Name": "Name", "Filename": "Name",
    ".name": ".name", ".filename": ".name", ".Name": ".Name", ".Filename": ".Name",
    "ext": "extension", "extension": "extension", "Ext": "Extension", "Extension": "Extension",
    "size": "size", "type": "type", "none": "none", "inode": "inode",
    "date": "modified", "time": "modified", "mod": "modified", "modified": "modified",
    "new": "modified", "newest": "modified", "age": "oldest", "old": "oldest",
    "oldest": "oldest", "ch": "changed", "changed": "changed", "acc": "accessed",
    "accessed": "accessed", "cr": "created", "created": "created",
}
SORT_CHOICES = "name, Name, size, extension, Extension, modified, changed, accessed, created, inode, type, none"
WHEN = {"always", "auto", "automatic", "never"}


def rust_debug(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def need_value(argv: list[str], index: int, flag: str) -> tuple[str, int]:
    if index + 1 >= len(argv):
        raise OptionFailure(f"Flag {flag} needs a value")
    return argv[index + 1], index + 1


def add_time(opts: Options, value: str) -> None:
    aliases = {"mod": "modified", "modified": "modified", "acc": "accessed",
               "accessed": "accessed", "cr": "created", "created": "created",
               "ch": "changed", "changed": "changed"}
    if value not in aliases:
        raise OptionFailure(
            f"Option --time (-t) has no {rust_debug(value)} setting "
            "(choices: modified, changed, accessed, created)"
        )
    result = aliases[value]
    if result not in opts.time_types:
        opts.time_types.append(result)


def set_long_option(opts: Options, name: str, value: Optional[str]) -> None:
    boolean = {
        "oneline": "oneline", "long": "long", "grid": "explicit_grid", "across": "across",
        "recurse": "recurse", "tree": "tree", "dereference": "dereference",
        "follow-symlinks": "follow_symlinks", "treat-dirs-as-files": "list_dirs",
        "list-dirs": "list_dirs", "only-dirs": "only_dirs", "only-files": "only_files",
        "show-symlinks": "show_symlinks", "no-symlinks": "no_symlinks", "reverse": "reverse",
        "group-directories-first": "dirs_first", "group-directories-last": "dirs_last",
        "no-quotes": "no_quotes", "header": "header", "no-permissions": "no_permissions",
        "no-filesize": "no_filesize", "no-time": "no_time", "flags": "flags",
        "stdin": "stdin", "help": "help", "version": "version",
    }
    ignored_boolean = {
        "hyperlink", "git-ignore", "git", "no-git", "git-repos", "git-repos-no-status",
        "group", "smart-group", "links", "inode", "mounts", "numeric", "blocksize",
        "total-size", "octal-permissions", "context", "extended", "colour-scale",
        "color-scale", "no-user",
    }
    if name in boolean:
        if value is not None:
            raise OptionFailure(f"Flag --{name} cannot be given a value")
        setattr(opts, boolean[name], True)
        return
    if name in ignored_boolean:
        if value is not None:
            raise OptionFailure(f"Flag --{name} cannot be given a value")
        return
    if name == "all":
        opts.all_count += 1
        return
    if name == "almost-all":
        opts.all_count = max(opts.all_count, 1)
        return
    if name == "binary":
        opts.size_format = "binary"
        return
    if name == "bytes":
        opts.size_format = "bytes"
        return
    if name in {"modified", "changed", "accessed", "created"}:
        if name not in opts.time_types:
            opts.time_types.append(name)
        return
    raise OptionFailure(f"Unknown argument --{name}")


def parse_args(argv: list[str]) -> tuple[Options, list[str]]:
    opts = Options()
    paths: list[str] = []
    stop = False
    i = 0
    required = {"sort", "level", "width", "time", "time-style", "ignore-glob",
                "colour-scale-mode", "color-scale-mode"}
    optional = {"color", "colour", "icons", "classify", "absolute"}
    while i < len(argv):
        arg = argv[i]
        if stop or arg == "-" or not arg.startswith("-"):
            paths.append(arg)
            i += 1
            continue
        if arg == "--":
            stop = True
            i += 1
            continue
        if arg.startswith("--"):
            body = arg[2:]
            name, equal, value = body.partition("=")
            val: Optional[str] = value if equal else None
            if name in required:
                if val is None:
                    val, i = need_value(argv, i, f"--{name}")
                if name == "sort":
                    if val not in SORT_ALIASES:
                        raise OptionFailure(
                            f"Option --sort (-s) has no {rust_debug(val)} setting (choices: {SORT_CHOICES})"
                        )
                    opts.sort = SORT_ALIASES[val]
                elif name == "level":
                    opts.level_raw = val
                elif name == "width":
                    opts.width_raw = val
                elif name == "time":
                    add_time(opts, val)
                elif name == "time-style":
                    opts.time_style = val
                elif name == "ignore-glob":
                    opts.ignores.extend(val.split("|"))
                i += 1
                continue
            if name in optional:
                choices = WHEN if name != "absolute" else {"on", "off", "yes", "no", "follow"}
                if val is None and i + 1 < len(argv) and argv[i + 1] in choices:
                    val = argv[i + 1]
                    i += 1
                if name in {"color", "colour", "icons"}:
                    val = val or "auto"
                    if val not in WHEN:
                        raise OptionFailure(f"Option --{name} has no {rust_debug(val)} setting")
                elif name == "classify":
                    val = val or "always"
                    if val not in WHEN:
                        raise OptionFailure(f"Option --classify (-F) has no {rust_debug(val)} setting")
                    opts.classify = "always" if val == "always" else "never"
                else:
                    val = val or "on"
                    if val not in choices:
                        raise OptionFailure(f"Option --absolute has no {rust_debug(val)} setting")
                    opts.absolute = {"yes": "on", "no": "off"}.get(val, val)
                i += 1
                continue
            set_long_option(opts, name, val)
            i += 1
            continue

        chars = arg[1:]
        pos = 0
        while pos < len(chars):
            ch = chars[pos]
            if ch in {"s", "L", "w", "t", "I"}:
                val = chars[pos + 1:]
                if val.startswith("="):
                    val = val[1:]
                if not val:
                    val, i = need_value(argv, i, f"-{ch}")
                if ch == "s":
                    if val not in SORT_ALIASES:
                        raise OptionFailure(
                            f"Option --sort (-s) has no {rust_debug(val)} setting (choices: {SORT_CHOICES})"
                        )
                    opts.sort = SORT_ALIASES[val]
                elif ch == "L":
                    opts.level_raw = val
                elif ch == "w":
                    opts.width_raw = val
                elif ch == "t":
                    add_time(opts, val)
                else:
                    opts.ignores.extend(val.split("|"))
                pos = len(chars)
                continue
            if ch == "F":
                val = chars[pos + 1:]
                if val.startswith("="):
                    val = val[1:]
                if not val and i + 1 < len(argv) and argv[i + 1] in WHEN:
                    val = argv[i + 1]
                    i += 1
                val = val or "always"
                if val not in WHEN:
                    raise OptionFailure(f"Option --classify (-F) has no {rust_debug(val)} setting")
                opts.classify = "always" if val == "always" else "never"
                pos = len(chars)
                continue
            actions = {
                "1": ("oneline", True), "l": ("long", True), "G": ("explicit_grid", True),
                "x": ("across", True), "R": ("recurse", True), "T": ("tree", True),
                "X": ("dereference", True), "a": ("all_count", opts.all_count + 1),
                "A": ("all_count", max(opts.all_count, 1)), "d": ("list_dirs", True),
                "D": ("only_dirs", True), "f": ("only_files", True), "r": ("reverse", True),
                "b": ("size_format", "binary"), "B": ("size_format", "bytes"),
                "h": ("header", True), "O": ("flags", True), "m": ("_time", "modified"),
                "u": ("_time", "accessed"), "U": ("_time", "created"),
                "?": ("help", True), "v": ("version", True),
            }
            ignored = {"g", "H", "i", "M", "n", "S", "o", "Z", "@"}
            if ch in actions:
                field_name, field_value = actions[ch]
                if field_name == "_time":
                    if field_value not in opts.time_types:
                        opts.time_types.append(field_value)
                else:
                    setattr(opts, field_name, field_value)
            elif ch not in ignored:
                raise OptionFailure(f"Unknown argument -{ch}")
            pos += 1
        i += 1

    if opts.tree and opts.all_count >= 2:
        raise OptionFailure("Option --tree is useless given --all --all")
    if opts.level_raw is not None and (opts.tree or opts.recurse):
        try:
            opts.level = int(opts.level_raw)
            if opts.level < 0:
                raise ValueError
        except ValueError as exc:
            raise OptionFailure(
                f"Value {rust_debug(opts.level_raw)} not valid for option --level (-L): invalid digit found in string"
            ) from exc
    if opts.width_raw is not None:
        try:
            opts.width = int(opts.width_raw)
            if opts.width < 1:
                raise ValueError
        except ValueError as exc:
            raise OptionFailure(
                f"Value {rust_debug(opts.width_raw)} not valid for option --width (-w): invalid digit found in string"
            ) from exc
    for pattern_index in range(len(opts.ignores)):
        opts.ignores[pattern_index] = opts.ignores[pattern_index]
    if opts.stdin and not paths:
        separator = os.environ.get("EZA_STDIN_SEPARATOR", "\n")
        paths = [part for part in sys.stdin.read().split(separator) if part]
    if not paths:
        paths = ["."]
    return opts, paths


@dataclass
class Entry:
    path: str
    name: str
    raw: Optional[str] = None
    virtual: bool = False
    _lstat: object = field(default=None, init=False, repr=False)

    def lstat(self):
        if self._lstat is None:
            self._lstat = os.lstat(self.path)
        return self._lstat

    def metadata(self, dereference: bool = False):
        return os.stat(self.path) if dereference else self.lstat()

    def is_link(self) -> bool:
        if self.virtual:
            return False
        try:
            return stat.S_ISLNK(self.lstat().st_mode)
        except OSError:
            return False

    def is_dir(self, follow: bool = False) -> bool:
        if self.virtual:
            return True
        try:
            if self.is_link():
                return follow and os.path.isdir(self.path)
            return stat.S_ISDIR(self.lstat().st_mode)
        except OSError:
            return False


def direct_name(raw: str, is_dir: bool) -> str:
    if is_dir:
        return ntpath.normpath(raw) if os.name == "nt" else os.path.normpath(raw)
    pathmod = ntpath if os.name == "nt" else os.path
    return pathmod.join(pathmod.dirname(raw), pathmod.basename(raw))


def path_parts(path: str) -> int:
    normalized = ntpath.normpath(path) if os.name == "nt" else os.path.normpath(path)
    drive, tail = ntpath.splitdrive(normalized) if os.name == "nt" else os.path.splitdrive(normalized)
    del drive
    return len([part for part in re.split(r"[\\/]", tail) if part and part != "."])


def hidden(entry: Entry) -> bool:
    if entry.name.startswith("."):
        return True
    try:
        return bool(getattr(entry.lstat(), "st_file_attributes", 0) & 0x2)
    except OSError:
        return False


def read_children(directory: Entry, opts: Options) -> list[Entry]:
    children: list[Entry] = []
    with os.scandir(directory.path) as scan:
        for item in scan:
            entry = Entry(item.path, item.name)
            if opts.all_count == 0 and hidden(entry):
                continue
            if any(fnmatch.fnmatchcase(entry.name, pattern) for pattern in opts.ignores):
                continue
            if opts.no_symlinks and entry.is_link():
                continue
            is_dir = entry.is_dir(opts.follow_symlinks)
            if opts.only_dirs and not is_dir and not (opts.show_symlinks and entry.is_link()):
                continue
            if opts.only_files and is_dir and not (opts.show_symlinks and entry.is_link()):
                continue
            if (opts.only_dirs or opts.only_files) and entry.is_link() and not opts.show_symlinks:
                continue
            children.append(entry)
    if opts.all_count >= 2 and not opts.tree:
        children.insert(0, Entry(os.path.join(directory.path, ".."), "..", virtual=True))
        children.insert(0, Entry(directory.path, ".", virtual=True))
    return sort_entries(children, opts)


def natural_parts(value: str, insensitive: bool) -> tuple:
    if insensitive:
        value = value.casefold()
    result = []
    for part in re.split(r"(\d+)", value):
        result.append((1, int(part)) if part.isdigit() else (0, part))
    return tuple(result)


def extension(entry: Entry) -> Optional[str]:
    base = entry.name
    index = base.rfind(".")
    return None if index <= 0 or index == len(base) - 1 else base[index + 1:]


def timestamp(entry: Entry, kind: str) -> int:
    try:
        info = entry.lstat()
        if kind == "modified":
            return info.st_mtime_ns
        if kind == "accessed":
            return info.st_atime_ns
        return info.st_ctime_ns
    except OSError:
        return 0


def size_number(entry: Entry) -> int:
    if entry.is_dir(False):
        return -1
    try:
        return entry.lstat().st_size
    except OSError:
        return -1


def compare_entries(a: Entry, b: Entry, opts: Options) -> int:
    if opts.dirs_first or opts.dirs_last:
        ad = a.is_dir(opts.follow_symlinks)
        bd = b.is_dir(opts.follow_symlinks)
        if ad != bd:
            result = -1 if ad else 1
            if opts.dirs_last:
                result = -result
            return -result if opts.reverse else result
    sort_field = opts.sort
    if sort_field == "none":
        result = 0
    elif sort_field in {"name", "Name", ".name", ".Name"}:
        an = a.name.lstrip(".") if sort_field.startswith(".") else a.name
        bn = b.name.lstrip(".") if sort_field.startswith(".") else b.name
        ak = natural_parts(an, sort_field in {"name", ".name"})
        bk = natural_parts(bn, sort_field in {"name", ".name"})
        result = (ak > bk) - (ak < bk)
    elif sort_field in {"extension", "Extension"}:
        ae, be = extension(a), extension(b)
        if ae is None or be is None:
            result = (ae is not None) - (be is not None)
        else:
            ak = natural_parts(ae, sort_field == "extension")
            bk = natural_parts(be, sort_field == "extension")
            result = (ak > bk) - (ak < bk)
            if result == 0:
                an = natural_parts(a.name, sort_field == "extension")
                bn = natural_parts(b.name, sort_field == "extension")
                result = (an > bn) - (an < bn)
    elif sort_field == "size":
        result = (size_number(a) > size_number(b)) - (size_number(a) < size_number(b))
    elif sort_field in {"modified", "oldest", "accessed", "changed", "created"}:
        kind = "modified" if sort_field == "oldest" else sort_field
        av, bv = timestamp(a, kind), timestamp(b, kind)
        result = (av > bv) - (av < bv)
        if sort_field == "oldest":
            result = -result
    elif sort_field == "type":
        def type_key(item: Entry):
            if item.is_dir(opts.follow_symlinks):
                return (0, "")
            if item.is_link():
                return (1, "")
            return (2, (extension(item) or "").casefold())
        ak, bk = type_key(a), type_key(b)
        result = (ak > bk) - (ak < bk)
    else:
        result = 0
    return -result if opts.reverse else result


def sort_entries(entries: list[Entry], opts: Options) -> list[Entry]:
    return sorted(entries, key=cmp_to_key(lambda a, b: compare_entries(a, b, opts)))


def quote_name(value: str, no_quotes: bool) -> str:
    value = "".join(ch if ord(ch) >= 0x20 and ord(ch) != 0x7F else ascii(ch)[1:-1] for ch in value)
    if no_quotes or (" " not in value and "'" not in value):
        return value
    quote = '"' if "'" in value else "'"
    return quote + value + quote


def display_name(entry: Entry, opts: Options) -> str:
    if opts.absolute == "on":
        value = os.path.abspath(entry.path)
    elif opts.absolute == "follow":
        value = os.path.realpath(entry.path)
    else:
        value = entry.name
    result = quote_name(value, opts.no_quotes)
    if opts.classify == "always":
        if entry.is_dir(opts.follow_symlinks):
            result += "/"
        elif entry.is_link():
            result += "@"
    if entry.is_link():
        try:
            result += " -> " + quote_name(os.readlink(entry.path), opts.no_quotes)
        except OSError:
            pass
    return result


def display_width(value: str) -> int:
    width = 0
    for char in value:
        if unicodedata.combining(char):
            continue
        width += 2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1
    return width


def render_grid(entries: list[Entry], opts: Options) -> list[str]:
    cells = [display_name(entry, opts) for entry in entries]
    if not cells:
        return []
    width = opts.width or int(os.environ.get("COLUMNS", "80") or 80)
    best_rows = len(cells)
    for rows in range(1, len(cells) + 1):
        columns = math.ceil(len(cells) / rows)
        widths = [0] * columns
        for index, cell in enumerate(cells):
            column = index % columns if opts.across else index // rows
            widths[column] = max(widths[column], display_width(cell))
        total = sum(widths) + 2 * (columns - 1)
        if total <= width:
            best_rows = rows
            break
    columns = math.ceil(len(cells) / best_rows)
    widths = [0] * columns
    for index, cell in enumerate(cells):
        column = index % columns if opts.across else index // best_rows
        widths[column] = max(widths[column], display_width(cell))
    lines: list[str] = []
    for row in range(best_rows):
        pieces: list[str] = []
        for column in range(columns):
            index = row * columns + column if opts.across else column * best_rows + row
            if index >= len(cells):
                continue
            cell = cells[index]
            pieces.append(cell)
            if column + 1 < columns and (opts.across or index + best_rows < len(cells)):
                pieces.append(" " * (widths[column] - display_width(cell) + 2))
        lines.append("".join(pieces).rstrip())
    return lines


def permission_text(entry: Entry) -> str:
    if entry.is_link():
        kind = "l"
    elif entry.is_dir(False):
        kind = "d"
    else:
        kind = "-"
    try:
        attrs = getattr(entry.lstat(), "st_file_attributes", 0)
    except OSError:
        attrs = 0
    return kind + ("a" if attrs & 0x20 else "-") + ("r" if attrs & 0x1 else "-") + \
        ("h" if attrs & 0x2 else "-") + ("s" if attrs & 0x4 else "-")


def formatted_size(entry: Entry, style: str) -> str:
    if entry.is_dir(False) or entry.is_link():
        return "-"
    try:
        size = entry.lstat().st_size
    except OSError:
        return "-"
    if style == "bytes":
        return f"{size:,}"
    base = 1024 if style == "binary" else 1000
    suffixes = ["", "Ki", "Mi", "Gi", "Ti", "Pi"] if style == "binary" else ["", "k", "M", "G", "T", "P"]
    if size < base:
        return str(size)
    exponent = min(int(math.log(size, base)), len(suffixes) - 1)
    amount = size / (base ** exponent)
    number = f"{amount:.1f}" if amount < 10 else f"{amount:.0f}"
    return number + suffixes[exponent]


def format_time(entry: Entry, kind: str, style: str) -> str:
    info = entry.metadata(False)
    nanoseconds = {
        "modified": info.st_mtime_ns,
        "accessed": info.st_atime_ns,
        "created": info.st_ctime_ns,
        "changed": info.st_ctime_ns,
    }[kind]
    moment = dt.datetime.fromtimestamp(nanoseconds / 1_000_000_000).astimezone()
    if style == "long-iso":
        return moment.strftime("%Y-%m-%d %H:%M")
    if style == "full-iso":
        fraction = f"{nanoseconds % 1_000_000_000:09d}"
        return moment.strftime("%Y-%m-%d %H:%M:%S.") + fraction + moment.strftime(" %z")
    if style == "iso":
        return moment.strftime("%m-%d %H:%M" if moment.year == dt.datetime.now().year else "%Y-%m-%d")
    if style == "relative":
        seconds = max(0, int((dt.datetime.now().astimezone() - moment).total_seconds()))
        units = [(31_536_000, "year"), (2_592_000, "month"), (86_400, "day"),
                 (3_600, "hour"), (60, "minute"), (1, "second")]
        for scale, label in units:
            if seconds >= scale:
                count = seconds // scale
                return f"{count} {label}{'' if count == 1 else 's'}"
        return "now"
    if style.startswith("+"):
        return moment.strftime(style[1:])
    month = moment.strftime("%b")
    if moment.year == dt.datetime.now().year:
        return f"{moment.day:2d} {month} {moment:%H:%M}"
    return f"{moment.day:2d} {month}  {moment.year:04d}"


def flag_text(entry: Entry) -> str:
    try:
        attrs = getattr(entry.lstat(), "st_file_attributes", 0)
    except OSError:
        attrs = 0
    flags = [(0x1, "readonly"), (0x2, "hidden"), (0x4, "system"), (0x20, "archive"),
             (0x100, "temporary"), (0x800, "compressed"), (0x1000, "offline"),
             (0x2000, "not indexed"), (0x4000, "encrypted"), (0x20000, "no scrub"),
             (0x100000, "unpinned"), (0x80000, "pinned"), (0x400000, "recall on data access")]
    values = [name for mask, name in flags if attrs & mask]
    return "-" if not values else "-".join(values)


def table_columns(opts: Options) -> list[tuple[str, str, str]]:
    columns: list[tuple[str, str, str]] = []
    if not opts.no_permissions:
        columns.append(("permissions", "Mode", "left"))
    if not opts.no_filesize:
        columns.append(("size", "Size", "right"))
    if opts.flags:
        columns.append(("flags", "Flags", "left"))
    if not opts.no_time:
        kinds = opts.time_types or ["modified"]
        for kind in kinds:
            columns.append((kind, "Date " + kind.capitalize(), "left"))
    return columns


def metadata_cell(entry: Entry, kind: str, opts: Options) -> str:
    if kind == "permissions":
        return permission_text(entry)
    if kind == "size":
        return formatted_size(entry, opts.size_format)
    if kind == "flags":
        return flag_text(entry)
    try:
        return format_time(entry, kind, opts.time_style)
    except OSError:
        return "-"


def render_long_rows(rows: list[tuple[Entry, str]], opts: Options) -> list[str]:
    columns = table_columns(opts)
    values = [[metadata_cell(entry, kind, opts) for kind, _, _ in columns] for entry, _ in rows]
    widths = [0] * len(columns)
    for col, (_, header, _) in enumerate(columns):
        if opts.header:
            widths[col] = display_width(header)
        for row in values:
            widths[col] = max(widths[col], display_width(row[col]))

    def render_fields(fields: list[str]) -> str:
        pieces: list[str] = []
        for index, field_value in enumerate(fields):
            padding = widths[index] - display_width(field_value)
            if columns[index][2] == "right":
                pieces.append(" " * padding + field_value + " ")
            else:
                pieces.append(field_value + " " * padding + " ")
        return "".join(pieces)

    output: list[str] = []
    if opts.header:
        output.append(render_fields([header for _, header, _ in columns]) + "Name")
    for (entry, name), fields in zip(rows, values):
        output.append(render_fields(fields) + name)
    return output


def render_entries(entries: list[Entry], opts: Options) -> list[str]:
    if not entries:
        return []
    if opts.long:
        return render_long_rows([(entry, display_name(entry, opts)) for entry in entries], opts)
    use_grid = not opts.oneline and (opts.explicit_grid or opts.across or opts.width is not None)
    if use_grid:
        return render_grid(entries, opts)
    return [display_name(entry, opts) for entry in entries]


def missing_error(raw: str) -> str:
    if os.name == "nt":
        return f"{rust_debug(raw)}: \u7cfb\u7edf\u627e\u4e0d\u5230\u6307\u5b9a\u7684\u6587\u4ef6\u3002 (os error 2)"
    return f"{rust_debug(raw)}: No such file or directory (os error 2)"


def tree_rows(root: Entry, opts: Options) -> list[tuple[Entry, str]]:
    rows: list[tuple[Entry, str]] = [(root, display_name(root, opts))]
    visited: set[str] = set()

    def descend(directory: Entry, depth: int, ancestors_last: list[bool]) -> None:
        real = os.path.realpath(directory.path)
        if real in visited:
            return
        visited.add(real)
        try:
            children = read_children(directory, opts)
        except OSError:
            return
        for index, child in enumerate(children):
            last = index == len(children) - 1
            prefix = "".join("    " if parent_last else "\u2502   " for parent_last in ancestors_last)
            prefix += "\u2514\u2500\u2500 " if last else "\u251c\u2500\u2500 "
            rows.append((child, prefix + display_name(child, opts)))
            if child.is_dir(opts.follow_symlinks) and not child.virtual:
                if opts.level is None or depth < opts.level:
                    descend(child, depth + 1, ancestors_last + [last])

    if root.is_dir(opts.follow_symlinks) and (opts.level is None or opts.level > 0):
        descend(root, 1, [])
    return rows


def render_tree(roots: list[Entry], opts: Options) -> list[str]:
    output: list[str] = []
    for root in roots:
        rows = tree_rows(root, opts)
        if opts.long:
            output.extend(render_long_rows(rows, opts))
        else:
            output.extend(name for _, name in rows)
    return output


def recurse_allowed(directory: Entry, opts: Options) -> bool:
    return opts.level is None or opts.level > path_parts(directory.path)


def append_directory_blocks(output: list[str], directory: Entry, opts: Options, header: bool,
                            recurse_children: bool) -> None:
    try:
        children = read_children(directory, opts)
    except OSError as exc:
        if output:
            output.append("")
        output.append(f"{directory.path}: {exc}")
        return
    if header:
        if output:
            output.append("")
        output.append(directory.path + ":")
    output.extend(render_entries(children, opts))
    if recurse_children and recurse_allowed(directory, opts):
        child_dirs = [child for child in children if child.is_dir(opts.follow_symlinks) and not child.virtual]
        for child in child_dirs:
            append_directory_blocks(output, child, opts, True, True)


def execute(opts: Options, raw_paths: list[str]) -> tuple[int, str, str]:
    roots: list[Entry] = []
    errors: list[str] = []
    status = 0
    for raw in raw_paths:
        try:
            os.lstat(raw)
        except FileNotFoundError:
            errors.append(missing_error(raw))
            status = 2
            continue
        except OSError as exc:
            errors.append(f"{rust_debug(raw)}: {exc}")
            status = 2
            continue
        probe = Entry(raw, raw, raw=raw)
        is_dir = probe.is_dir(opts.follow_symlinks)
        roots.append(Entry(raw, direct_name(raw, is_dir), raw=raw))

    if opts.tree:
        lines = render_tree(roots, opts)
        return status, "\n".join(lines) + ("\n" if lines else ""), "\n".join(errors) + ("\n" if errors else "")

    files: list[Entry] = []
    directories: list[Entry] = []
    for root in roots:
        if root.is_dir(opts.follow_symlinks) and not opts.list_dirs:
            directories.append(root)
        else:
            files.append(root)
    files = sort_entries(files, opts)
    output = render_entries(files, opts)
    multiple_blocks = bool(files) or len(directories) > 1
    for directory in directories:
        append_directory_blocks(output, directory, opts, multiple_blocks, opts.recurse)
        multiple_blocks = True
    stdout = "\n".join(output) + ("\n" if output else "")
    stderr = "\n".join(errors) + ("\n" if errors else "")
    return status, stdout, stderr


def write_stream(stream, text: str) -> None:
    stream.buffer.write(text.encode("utf-8", errors="surrogateescape"))
    stream.buffer.flush()


def main(argv: Optional[list[str]] = None) -> int:
    try:
        opts, paths = parse_args(list(sys.argv[1:] if argv is None else argv))
    except OptionFailure as exc:
        write_stream(sys.stderr, f"eza: {exc}\n")
        return 3
    if opts.help:
        write_stream(sys.stdout, HELP)
        return 0
    if opts.version:
        write_stream(sys.stdout, VERSION)
        return 0
    status, stdout, stderr = execute(opts, paths)
    write_stream(sys.stdout, stdout)
    write_stream(sys.stderr, stderr)
    return status


if __name__ == "__main__":
    raise SystemExit(main())
