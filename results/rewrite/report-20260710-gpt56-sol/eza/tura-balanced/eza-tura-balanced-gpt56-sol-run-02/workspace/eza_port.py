#!/usr/bin/env python
"""Scoped Python port of eza 0.23.3 for the benchmark workspace."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from functools import cmp_to_key
import fnmatch
import os
from pathlib import Path
import re
import stat
import sys
import unicodedata
from typing import Iterable, Sequence


VERSION = (
    "eza - A modern, maintained replacement for ls\n"
    "v0.23.3 [+git]\n"
    "https://github.com/eza-community/eza\n"
)

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

SORT_CHOICES = "name, Name, size, extension, Extension, modified, changed, accessed, created, inode, type, none"
TIME_CHOICES = "modified, changed, accessed, created"
VALUE_CHOICES = {
    "sort": SORT_CHOICES,
    "time": TIME_CHOICES,
    "color": "always, auto, never",
    "colour": "always, auto, never",
    "icons": "always, auto, never",
    "classify": "always, auto, never",
    "absolute": "on, follow, off",
    "color-scale": "all, size, age",
    "colour-scale": "all, size, age",
    "color-scale-mode": "fixed, gradient",
    "colour-scale-mode": "fixed, gradient",
    "time-style": "default, long-iso, full-iso, iso, relative",
}

LONG_FLAGS = {
    "version": "v", "help": "?", "oneline": "1", "long": "l",
    "grid": "G", "across": "x", "recurse": "R", "tree": "T",
    "dereference": "X", "follow-symlinks": None, "no-quotes": None,
    "all": "a", "almost-all": "A", "treat-dirs-as-files": "d",
    "list-dirs": None, "reverse": "r", "git-ignore": None,
    "group-directories-first": None, "group-directories-last": None,
    "only-dirs": "D", "only-files": "f", "no-symlinks": None,
    "show-symlinks": None, "binary": "b", "bytes": "B", "group": "g",
    "numeric": "n", "header": "h", "inode": "i", "links": "H",
    "modified": "m", "changed": None, "blocksize": "S", "total-size": None,
    "accessed": "u", "created": "U", "hyperlink": None, "mounts": "M",
    "smart-group": None, "no-permissions": None, "no-filesize": None,
    "no-user": None, "no-time": None, "git": None, "no-git": None,
    "git-repos": None, "git-repos-no-status": None, "extended": "@",
    "octal-permissions": "o", "context": "Z", "stdin": None,
    "flags": "O",
}

NECESSARY = {
    "width": "w", "level": "L", "sort": "s", "ignore-glob": "I",
    "time": "t", "time-style": None, "color-scale-mode": None,
    "colour-scale-mode": None,
}
OPTIONAL = {
    "classify": "F", "absolute": None, "color": None, "colour": None,
    "color-scale": None, "colour-scale": None, "icons": None,
}

SHORT_TO_LONG = {
    short: long for long, short in {**LONG_FLAGS, **NECESSARY, **OPTIONAL}.items()
    if short is not None
}


class CliError(Exception):
    pass


@dataclass
class Options:
    occurrences: list[tuple[str, str | None]] = field(default_factory=list)
    paths: list[str] = field(default_factory=list)
    mode: str = "lines"
    recurse: bool = False
    tree: bool = False
    level: int | None = None
    dot_mode: str = "none"
    sort: str = "name"
    reverse: bool = False
    dirs_first: bool = False
    dirs_last: bool = False
    only_dirs: bool = False
    only_files: bool = False
    no_symlinks: bool = False
    show_symlinks: bool = False
    ignore: list[str] = field(default_factory=list)
    treat_dirs: bool = False
    classify: str = "never"
    no_quotes: bool = False
    absolute: str = "off"
    dereference: bool = False
    follow_links: bool = False
    header: bool = False
    no_permissions: bool = False
    no_filesize: bool = False
    no_time: bool = False
    binary: bool = False
    bytes_only: bool = False
    time_style: str = "default"
    time_types: list[str] = field(default_factory=lambda: ["modified"])
    stdin: bool = False
    width: int = 80
    across: bool = False
    file_flags: bool = False

    def has(self, name: str) -> bool:
        return any(item == name for item, _ in self.occurrences)

    def last(self, *names: str) -> tuple[str, str | None] | None:
        for item in reversed(self.occurrences):
            if item[0] in names:
                return item
        return None

    def values(self, name: str) -> list[str]:
        return [value for item, value in self.occurrences if item == name and value is not None]


@dataclass
class Entry:
    path: Path
    name: str
    display_path: str | None = None
    is_dot: bool = False
    _stat: os.stat_result | None = None

    @property
    def st(self) -> os.stat_result:
        if self._stat is None:
            self._stat = self.path.lstat()
        return self._stat

    @property
    def is_link(self) -> bool:
        return stat.S_ISLNK(self.st.st_mode)

    @property
    def is_dir(self) -> bool:
        return stat.S_ISDIR(self.st.st_mode)

    @property
    def points_to_dir(self) -> bool:
        try:
            return self.path.is_dir()
        except OSError:
            return False

    @property
    def is_file(self) -> bool:
        return stat.S_ISREG(self.st.st_mode)

    @property
    def size(self) -> int:
        return self.st.st_size

    @property
    def extension(self) -> str | None:
        position = self.name.rfind(".")
        return self.name[position + 1 :].lower() if position >= 0 else None


def rust_debug(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def parse_error(message: str) -> CliError:
    return CliError(message)


def parse_args(argv: Sequence[str]) -> Options:
    options = Options()
    parsing = True
    index = 0
    while index < len(argv):
        token = argv[index]
        index += 1
        if not parsing:
            options.paths.append(token)
            continue
        if token == "--":
            parsing = False
            continue
        if token.startswith("--"):
            raw = token[2:]
            name, equals, attached = raw.partition("=")
            if name in LONG_FLAGS:
                if equals:
                    raise parse_error(f"Flag --{name} cannot take a value")
                options.occurrences.append((name, None))
            elif name in NECESSARY:
                if equals:
                    value = attached
                elif index < len(argv):
                    value = argv[index]
                    index += 1
                else:
                    choices = VALUE_CHOICES.get(name)
                    suffix = f" (choices: {choices})" if choices else ""
                    raise parse_error(f"Flag --{name} needs a value{suffix}")
                options.occurrences.append((name, value))
            elif name in OPTIONAL:
                if equals:
                    value = attached
                elif index < len(argv) and argv[index] in VALUE_CHOICES.get(name, "").split(", "):
                    value = argv[index]
                    index += 1
                else:
                    value = "auto" if name not in {"absolute", "color-scale", "colour-scale"} else {
                        "absolute": "on", "color-scale": "all", "colour-scale": "all"
                    }[name]
                options.occurrences.append((name, value))
            else:
                raise parse_error(f"Unknown argument --{name}")
            continue
        if token.startswith("-") and token != "-":
            chars = token[1:]
            offset = 0
            while offset < len(chars):
                short = chars[offset]
                offset += 1
                name = SHORT_TO_LONG.get(short)
                if name is None:
                    raise parse_error(f"Unknown argument -{short}")
                if name in NECESSARY:
                    if offset < len(chars):
                        value = chars[offset:]
                        if value.startswith("="):
                            value = value[1:]
                        offset = len(chars)
                    elif index < len(argv):
                        value = argv[index]
                        index += 1
                    else:
                        choices = VALUE_CHOICES.get(name)
                        suffix = f" (choices: {choices})" if choices else ""
                        raise parse_error(f"Flag -{short} needs a value{suffix}")
                    options.occurrences.append((name, value))
                elif name in OPTIONAL:
                    if offset < len(chars):
                        value = chars[offset:]
                        if value.startswith("="):
                            value = value[1:]
                        offset = len(chars)
                    elif index < len(argv) and argv[index] in VALUE_CHOICES.get(name, "").split(", "):
                        value = argv[index]
                        index += 1
                    else:
                        value = "auto"
                    options.occurrences.append((name, value))
                else:
                    options.occurrences.append((name, None))
            continue
        options.paths.append(token)

    if not options.has("help") and not options.has("version"):
        deduce(options)
    return options


def validate_choice(options: Options, name: str, accepted: set[str], shown: str | None = None) -> None:
    item = options.last(name)
    if item is not None and item[1] not in accepted:
        choices = f" (choices: {shown})" if shown else ""
        raise CliError(f"Option --{name}" + (f" (-{NECESSARY[name]})" if NECESSARY.get(name) else "")
                       + f" has no {rust_debug(item[1] or '')} setting{choices}")


def parse_nonnegative(options: Options, name: str) -> int | None:
    item = options.last(name)
    if item is None:
        return None
    value = item[1] or ""
    try:
        number = int(value, 10)
        if number < 0:
            raise ValueError
        return number
    except ValueError as error:
        detail = "invalid digit found in string" if not value.isdigit() else "number too large to fit in target type"
        raise CliError(f'Value {rust_debug(value)} not valid for option --{name} (-{NECESSARY[name]}): {detail}') from error


def deduce(options: Options) -> None:
    validate_choice(options, "sort", {
        "name", "filename", "Name", "Filename", ".name", ".filename", ".Name", ".Filename",
        "size", "filesize", "ext", "extension", "Ext", "Extension", "date", "time", "mod",
        "modified", "new", "newest", "age", "old", "oldest", "ch", "changed", "acc",
        "accessed", "cr", "created", *(set() if os.name == "nt" else {"inode"}), "type", "none",
    }, SORT_CHOICES)
    for name in ("color", "colour", "icons", "classify"):
        validate_choice(options, name, {"always", "auto", "automatic", "never"})
    validate_choice(options, "absolute", {"on", "follow", "off"})
    validate_choice(options, "time", {"mod", "modified", "ch", "changed", "acc", "accessed", "cr", "created"}, TIME_CHOICES)

    view = None
    for name, _ in reversed(options.occurrences):
        if name in {"long", "oneline", "grid", "tree"}:
            view = name
            break
    if view == "long" or (view in {"tree", "grid"} and options.has("long")):
        options.mode = "long"
    elif view == "tree":
        options.mode = "tree"
    elif view == "grid":
        options.mode = "grid"
    elif view == "oneline" or not sys.stdout.isatty():
        options.mode = "lines"
    else:
        options.mode = "grid"

    options.tree = options.has("tree") and view != "grid"
    options.recurse = options.tree or options.has("recurse")
    options.level = parse_nonnegative(options, "level")
    options.treat_dirs = options.has("treat-dirs-as-files") or options.has("list-dirs")
    if options.tree:
        options.treat_dirs = True
    all_count = sum(name == "all" for name, _ in options.occurrences)
    if options.has("almost-all"):
        options.dot_mode = "hidden"
    elif all_count >= 2:
        if options.has("tree"):
            raise CliError("Option --tree is useless given --all --all")
        options.dot_mode = "dots"
    elif all_count:
        options.dot_mode = "hidden"
    options.sort = (options.last("sort") or ("sort", "name"))[1] or "name"
    options.reverse = options.has("reverse")
    options.dirs_first = options.has("group-directories-first")
    options.dirs_last = options.has("group-directories-last")
    options.only_dirs = options.has("only-dirs")
    options.only_files = options.has("only-files")
    options.no_symlinks = options.has("no-symlinks")
    options.show_symlinks = options.has("show-symlinks")
    ignore = options.last("ignore-glob")
    options.ignore = ignore[1].split("|") if ignore and ignore[1] is not None else []
    options.classify = (options.last("classify") or ("classify", "never"))[1] or "never"
    options.no_quotes = options.has("no-quotes")
    options.absolute = (options.last("absolute") or ("absolute", "off"))[1] or "off"
    options.dereference = options.has("dereference")
    options.follow_links = options.has("follow-symlinks")
    options.header = options.has("header")
    options.no_permissions = options.has("no-permissions")
    options.no_filesize = options.has("no-filesize")
    options.no_time = options.has("no-time")
    size_option = options.last("binary", "bytes")
    options.binary = size_option is not None and size_option[0] == "binary"
    options.bytes_only = size_option is not None and size_option[0] == "bytes"
    options.time_style = (options.last("time-style") or ("time-style", os.environ.get("TIME_STYLE", "default")))[1] or "default"
    options.stdin = options.has("stdin") or not sys.stdin.isatty()
    options.width = parse_nonnegative(options, "width") or int(os.environ.get("COLUMNS", "80"))
    options.across = options.has("across")
    options.file_flags = options.has("flags")
    selected_times: list[str] = []
    direct = options.last("time")
    if direct:
        selected_times = [{"mod": "modified", "ch": "changed", "acc": "accessed", "cr": "created"}.get(direct[1] or "", direct[1] or "modified")]
    else:
        for flag in ("modified", "changed", "accessed", "created"):
            if options.has(flag):
                selected_times.append(flag)
    options.time_types = [] if options.no_time else (selected_times or ["modified"])


def natural_parts(text: str, ignore_case: bool) -> list[tuple[int, object]]:
    if ignore_case:
        text = text.lower()
    parts: list[tuple[int, object]] = []
    for piece in re.split(r"(\d+)", text):
        if piece.isdigit():
            parts.append((1, (int(piece), len(piece))))
        else:
            parts.append((0, piece))
    return parts


def compare_entries(a: Entry, b: Entry, sort_name: str) -> int:
    def ordering(left: object, right: object) -> int:
        return (left > right) - (left < right)

    insensitive = sort_name not in {"Name", "Filename", "Ext", "Extension", ".Name", ".Filename"}
    if sort_name == "none":
        return 0
    if sort_name in {"size", "filesize"}:
        return ordering(a.size, b.size)
    if sort_name in {"date", "time", "mod", "modified", "new", "newest"}:
        return ordering(a.st.st_mtime_ns, b.st.st_mtime_ns)
    if sort_name in {"age", "old", "oldest"}:
        return ordering(b.st.st_mtime_ns, a.st.st_mtime_ns)
    if sort_name in {"acc", "accessed"}:
        return ordering(a.st.st_atime_ns, b.st.st_atime_ns)
    if sort_name in {"ch", "changed"}:
        left = a.st.st_mtime_ns if os.name == "nt" else a.st.st_ctime_ns
        right = b.st.st_mtime_ns if os.name == "nt" else b.st.st_ctime_ns
        return ordering(left, right)
    if sort_name in {"cr", "created"}:
        return ordering(a.st.st_ctime_ns, b.st.st_ctime_ns)
    if sort_name == "type":
        type_a = 0 if a.is_dir else 1 if a.is_file else 2 if a.is_link else 7
        type_b = 0 if b.is_dir else 1 if b.is_file else 2 if b.is_link else 7
        result = ordering(type_a, type_b)
        if result:
            return result
        insensitive = False
    if sort_name in {"ext", "extension", "Ext", "Extension"}:
        ext_a = a.extension
        ext_b = b.extension
        if ext_a is None and ext_b is not None:
            return -1
        if ext_a is not None and ext_b is None:
            return 1
        result = ordering(ext_a, ext_b) if ext_a is not None and ext_b is not None else 0
        if result:
            return result
    name_a = a.name[1:] if sort_name.startswith(".") and a.name.startswith(".") else a.name
    name_b = b.name[1:] if sort_name.startswith(".") and b.name.startswith(".") else b.name
    return ordering(natural_parts(name_a, insensitive), natural_parts(name_b, insensitive))


def sorted_entries(entries: list[Entry], options: Options) -> list[Entry]:
    result = sorted(entries, key=cmp_to_key(lambda a, b: compare_entries(a, b, options.sort)))
    if options.reverse:
        result.reverse()
    if options.dirs_first:
        result.sort(key=lambda entry: not entry.points_to_dir)
    elif options.dirs_last:
        result.sort(key=lambda entry: entry.points_to_dir)
    return result


def windows_hidden(path: Path) -> bool:
    try:
        attributes = path.stat(follow_symlinks=False).st_file_attributes
    except (AttributeError, OSError):
        return False
    return bool(attributes & stat.FILE_ATTRIBUTE_HIDDEN)


def children(directory: Path, options: Options, recursing: bool) -> list[Entry]:
    found: list[Entry] = []
    if options.dot_mode == "dots":
        found.extend([
            Entry(directory, ".", is_dot=True),
            Entry(directory / "..", "..", is_dot=True),
        ])
    with os.scandir(directory) as scan:
        for item in scan:
            name = item.name
            hidden = name.startswith(".") or (os.name == "nt" and name.startswith("_")) or windows_hidden(Path(item.path))
            if hidden and options.dot_mode == "none":
                continue
            entry = Entry(Path(item.path), name)
            found.append(entry)
    filtered: list[Entry] = []
    for entry in found:
        if any(fnmatch.fnmatchcase(entry.name, pattern) for pattern in options.ignore):
            continue
        if options.no_symlinks and entry.is_link:
            continue
        if options.only_dirs and not (entry.is_dir or (options.show_symlinks and entry.points_to_dir)):
            continue
        if options.only_files and not recursing and not (entry.is_file or (options.show_symlinks and entry.is_link and not entry.points_to_dir)):
            continue
        filtered.append(entry)
    return sorted_entries(filtered, options)


def quote_name(name: str, no_quotes: bool) -> str:
    name = "".join(
        char if ord(char) >= 0x20 and ord(char) != 0x7F else char.encode("unicode_escape").decode("ascii")
        for char in name
    )
    if no_quotes or (" " not in name and "'" not in name):
        return name
    if "'" not in name:
        return f"'{name}'"
    return '"' + name.replace('"', '\\"') + '"'


def classify(entry: Entry, options: Options) -> str:
    if options.classify == "never" or (options.classify in {"auto", "automatic"} and not sys.stdout.isatty()):
        return ""
    if entry.is_dir:
        return "/"
    if entry.is_link:
        return "" if os.name == "nt" else "@"
    return ""


def display_name(entry: Entry, options: Options, links: bool = False) -> str:
    if options.absolute in {"on", "follow"}:
        path = entry.path.absolute() if options.absolute == "on" else entry.path.resolve()
        name = str(path)
    elif entry.display_path is not None:
        name = entry.display_path
        if os.name == "nt" and ("/" in name or "\\" in name):
            parent, separator, leaf = name.rpartition("/")
            if not separator:
                parent, separator, leaf = name.rpartition("\\")
            if separator:
                name = parent + "\\" + leaf
    else:
        name = entry.name
    name = quote_name(name, options.no_quotes)
    name += classify(entry, options)
    if links and entry.is_link and not options.dereference:
        try:
            target = os.readlink(entry.path)
            if os.name == "nt" and target.startswith("\\\\?\\"):
                target = target[4:]
            name += " -> " + target
        except OSError:
            pass
    return name


def display_width(text: str) -> int:
    width = 0
    for char in text:
        if unicodedata.combining(char) or unicodedata.category(char) in {"Cf", "Cc"}:
            continue
        width += 2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1
    return width


def windows_attributes(entry: Entry) -> str:
    try:
        bits = entry.st.st_file_attributes
    except AttributeError:
        bits = 0
    first = "d" if entry.is_dir else "l" if entry.is_link else "-"
    readonly = "r" if bits & getattr(stat, "FILE_ATTRIBUTE_READONLY", 1) else "-"
    archive = "a" if bits & getattr(stat, "FILE_ATTRIBUTE_ARCHIVE", 32) else "-"
    hidden = "h" if bits & getattr(stat, "FILE_ATTRIBUTE_HIDDEN", 2) else "-"
    system = "s" if bits & getattr(stat, "FILE_ATTRIBUTE_SYSTEM", 4) else "-"
    return first + archive + readonly + hidden + system


def permissions(entry: Entry) -> str:
    if os.name == "nt":
        return windows_attributes(entry)
    mode = entry.st.st_mode
    kind = "d" if stat.S_ISDIR(mode) else "l" if stat.S_ISLNK(mode) else "-"
    return kind + "".join(
        char if mode & bit else "-"
        for char, bit in zip("rwxrwxrwx", (
            stat.S_IRUSR, stat.S_IWUSR, stat.S_IXUSR, stat.S_IRGRP, stat.S_IWGRP,
            stat.S_IXGRP, stat.S_IROTH, stat.S_IWOTH, stat.S_IXOTH,
        ))
    )


def format_size(entry: Entry, options: Options) -> str:
    if entry.is_dir:
        return "-"
    size = entry.size
    if options.bytes_only:
        return f"{size:,}"
    base = 1024 if options.binary else 1000
    symbols = ["", "Ki", "Mi", "Gi", "Ti", "Pi", "Ei"] if options.binary else ["", "k", "M", "G", "T", "P", "E"]
    value = float(size)
    unit = 0
    while value >= base and unit < len(symbols) - 1:
        value /= base
        unit += 1
    if unit == 0:
        return str(size)
    number = f"{value:.1f}" if value < 10 else str(round(value))
    return number + symbols[unit]


def format_flags(entry: Entry) -> str:
    try:
        bits = entry.st.st_file_attributes
    except AttributeError:
        return "-"
    names = [
        (0x1, "readonly"), (0x2, "hidden"), (0x4, "system"),
        (0x20, "archive"), (0x100, "temporary"), (0x800, "compressed"),
        (0x1000, "offline"), (0x2000, "not indexed"), (0x4000, "encrypted"),
        (0x20000, "no scrub"), (0x100000, "unpinned"), (0x80000, "pinned"),
        (0x400000, "recall on data access"),
    ]
    selected = [name for flag, name in names if bits & flag]
    return "-" if not selected else "-".join(selected)


def format_time(timestamp: float, style: str, timestamp_ns: int | None = None) -> str:
    value = datetime.fromtimestamp(timestamp).astimezone()
    now = datetime.now().astimezone()
    if style == "long-iso":
        return value.strftime("%Y-%m-%d %H:%M")
    if style == "full-iso":
        fraction = f"{timestamp_ns % 1_000_000_000:09d}" if timestamp_ns is not None else f"{value.microsecond:06d}000"
        return value.strftime("%Y-%m-%d %H:%M:%S.") + fraction + value.strftime(" %z")
    if style == "iso":
        return value.strftime("%m-%d %H:%M" if value.year == now.year else "%Y-%m-%d")
    if style == "relative":
        seconds = max(0, int((now - value).total_seconds()))
        units = ((31_536_000, "year"), (2_592_000, "month"), (604_800, "week"),
                 (86_400, "day"), (3_600, "hour"), (60, "minute"), (1, "second"))
        for span, label in units:
            if seconds >= span:
                count = seconds // span
                return f"{count} {label}" + ("s" if count != 1 else "")
        return "now"
    if style.startswith("+"):
        custom = style[1:].replace("%n", "\n")
        non_recent, separator, recent = custom.partition("\n")
        return value.strftime(recent if separator and value.year == now.year else non_recent)
    if value.year == now.year:
        return f"{value.day:2d} {value.strftime('%b')} {value.strftime('%H:%M')}"
    return f"{value.day:2d} {value.strftime('%b')}  {value.year}"


def table_cells(entry: Entry, options: Options) -> list[str]:
    cells: list[str] = []
    if not options.no_permissions:
        cells.append(permissions(entry))
    if not options.no_filesize:
        cells.append(format_size(entry, options))
    if options.file_flags:
        cells.append(format_flags(entry))
    for time_type in options.time_types:
        timestamp = entry.st.st_mtime
        timestamp_ns = entry.st.st_mtime_ns
        if time_type == "accessed":
            timestamp = entry.st.st_atime
            timestamp_ns = entry.st.st_atime_ns
        elif time_type == "created":
            timestamp = entry.st.st_ctime
            timestamp_ns = entry.st.st_ctime_ns
        elif time_type == "changed":
            timestamp = entry.st.st_mtime if os.name == "nt" else entry.st.st_ctime
            timestamp_ns = entry.st.st_mtime_ns if os.name == "nt" else entry.st.st_ctime_ns
        cells.append(format_time(timestamp, options.time_style, timestamp_ns))
    return cells


def render_long(entries: list[Entry], options: Options, tree_prefixes: list[str] | None = None) -> list[str]:
    rows = [table_cells(entry, options) for entry in entries]
    if options.header:
        headers: list[str] = []
        if not options.no_permissions:
            headers.append("Mode" if os.name == "nt" else "Permissions")
        if not options.no_filesize:
            headers.append("Size")
        if options.file_flags:
            headers.append("Flags")
        headers.extend({
            "modified": "Date Modified", "changed": "Date Changed",
            "accessed": "Date Accessed", "created": "Date Created",
        }[time_type] for time_type in options.time_types)
        rows = [headers, *rows]
    widths = [max((len(row[index]) for row in rows), default=0) for index in range(max((len(row) for row in rows), default=0))]
    lines: list[str] = []
    if options.header:
        header = []
        for index, cell in enumerate(rows[0]):
            left = index != (1 if not options.no_permissions and not options.no_filesize else 0) or options.no_filesize
            header.append(cell.ljust(widths[index]) if left else cell.rjust(widths[index]))
        lines.append(" ".join(header) + (" " if header else "") + "Name")
        rows = rows[1:]
    for row_index, (entry, row) in enumerate(zip(entries, rows)):
        rendered = []
        for index, cell in enumerate(row):
            first_time = len(row) - len(options.time_types)
            flags_index = (0 if options.no_permissions else 1) + (0 if options.no_filesize else 1)
            left = index >= first_time if options.time_types else False
            left = left or (options.file_flags and index == flags_index)
            rendered.append(cell.ljust(widths[index]) if left else cell.rjust(widths[index]))
        prefix = (" ".join(rendered) + " ") if rendered else ""
        tree = tree_prefixes[row_index] if tree_prefixes else ""
        lines.append(prefix + tree + display_name(entry, options, links=True))
    return lines


def render_grid(entries: list[Entry], options: Options) -> list[str]:
    cells = [display_name(entry, options) for entry in entries]
    if not cells:
        return []
    count = len(cells)
    selected: tuple[int, int, list[int]] = (1, count, [max(map(display_width, cells))])
    for columns in range(count, 0, -1):
        rows = (count + columns - 1) // columns
        widths = [0] * columns
        for index, cell in enumerate(cells):
            column = index % columns if options.across else index // rows
            if column < columns:
                widths[column] = max(widths[column], display_width(cell))
        if sum(widths) + 2 * (columns - 1) <= options.width:
            selected = columns, rows, widths
            break
    columns, rows, widths = selected
    output: list[str] = []
    for row in range(rows):
        values: list[tuple[int, str]] = []
        for column in range(columns):
            index = row * columns + column if options.across else column * rows + row
            if index < count:
                values.append((column, cells[index]))
        line = ""
        for position, (column, cell) in enumerate(values):
            line += cell
            if position != len(values) - 1:
                line += " " * (widths[column] - display_width(cell) + 2)
        output.append(line)
    return output


def render_names(entries: list[Entry], options: Options) -> list[str]:
    if options.mode == "long":
        return render_long(entries, options)
    if options.mode == "grid":
        return render_grid(entries, options)
    return [display_name(entry, options, links=options.mode in {"lines", "tree"}) for entry in entries]


def tree_rows(roots: list[Entry], options: Options) -> tuple[list[Entry], list[str]]:
    entries: list[Entry] = []
    prefixes: list[str] = []

    def add(entry: Entry, depth: int, ancestors_last: list[bool], last: bool) -> None:
        entries.append(entry)
        prefix = "".join("    " if was_last else "│   " for was_last in ancestors_last)
        if depth:
            prefix += "└── " if last else "├── "
        prefixes.append(prefix)
        if not entry.is_dir or entry.is_dot or (options.level is not None and options.level <= depth):
            return
        try:
            nested = children(entry.path, options, True)
        except OSError:
            return
        for index, child in enumerate(nested):
            add(child, depth + 1, ancestors_last + ([last] if depth else []), index == len(nested) - 1)

    for root_index, root in enumerate(roots):
        add(root, 0, [], root_index == len(roots) - 1)
    return entries, prefixes


def render_tree(roots: list[Entry], options: Options) -> list[str]:
    entries, prefixes = tree_rows(roots, options)
    if options.mode == "long":
        return render_long(entries, options, prefixes)
    return [prefix + display_name(entry, options, links=True) for entry, prefix in zip(entries, prefixes)]


def path_entry(raw: str, options: Options) -> Entry:
    path = Path(raw)
    st = path.lstat()
    name = path.name or raw
    return Entry(path, name, display_path=raw, _stat=st)


def windows_io_message(error: OSError) -> str:
    winerror = getattr(error, "winerror", None)
    if os.name == "nt" and winerror == 3:
        return "系统找不到指定的路径。 (os error 3)"
    if os.name == "nt" and winerror == 123:
        return "文件名、目录名或卷标语法不正确。 (os error 123)"
    if winerror == 2 or (os.name != "nt" and error.errno == 2):
        return "系统找不到指定的文件。 (os error 2)" if os.name == "nt" else "No such file or directory (os error 2)"
    return str(error)


def write_stdout(text: str) -> None:
    sys.stdout.buffer.write(text.encode("utf-8", "surrogateescape"))


def write_stderr(text: str) -> None:
    sys.stderr.buffer.write(text.encode("utf-8", "surrogateescape"))


def run(options: Options) -> int:
    raw_paths = list(options.paths)
    if not raw_paths and options.stdin:
        separator = os.environ.get("EZA_STDIN_SEPARATOR", "\n")
        input_text = sys.stdin.buffer.read().decode("utf-8")
        raw_paths = [item for item in input_text.split(separator) if item]
    elif not raw_paths:
        raw_paths = ["."]

    files: list[Entry] = []
    directories: list[Entry] = []
    status = 0
    for raw in raw_paths:
        try:
            entry = path_entry(raw, options)
        except OSError as error:
            write_stderr(f"{rust_debug(raw)}: {windows_io_message(error)}\n")
            status = 2
            continue
        if entry.points_to_dir and not options.treat_dirs:
            directories.append(entry)
        else:
            files.append(entry)

    files = sorted_entries([entry for entry in files if not any(fnmatch.fnmatchcase(entry.name, p) for p in options.ignore)], options)
    output: list[str] = []
    if files and not options.tree:
        output.extend(render_names(files, options))

    if options.tree:
        roots = [entry for entry in directories + files if not (options.only_files and entry.is_dir)]
        if options.only_files:
            roots = [entry for entry in roots if not entry.is_dir]
        if roots:
            output.extend(render_tree(roots, options))
    else:
        only_directory = len(directories) == 1 and not files
        queue: list[tuple[Entry, int]] = [(entry, 0) for entry in directories]
        first_block = not files
        position = 0
        while position < len(queue):
            directory, depth = queue[position]
            position += 1
            try:
                listed = children(directory.path, options, options.recurse)
            except OSError as error:
                write_stderr(f"{directory.display_path or directory.path}: {error}\n")
                continue
            if not first_block:
                output.append("")
            first_block = False
            if not only_directory or depth > 0:
                title = directory.display_path or str(directory.path)
                output.append(quote_name(title, options.no_quotes) + ":")
            rendered = [entry for entry in listed if not (options.only_files and options.recurse and entry.is_dir)]
            output.extend(render_names(rendered, options))
            if options.recurse and (options.level is None or options.level > depth + 1):
                nested = []
                parent_display = directory.display_path or str(directory.path)
                for entry in listed:
                    if entry.is_dir and not entry.is_dot:
                        display = parent_display + os.sep + entry.name
                        nested.append((Entry(entry.path, entry.name, display_path=display), depth + 1))
                queue[position:position] = nested

    if output:
        write_stdout("\n".join(output) + "\n")
    return status


def main(argv: Sequence[str] | None = None) -> int:
    try:
        options = parse_args(list(sys.argv[1:] if argv is None else argv))
    except CliError as error:
        write_stderr(f"eza: {error}\n")
        if str(error).startswith("Flag -t needs a value"):
            write_stderr('To sort newest files last, try "--sort newest", or just "-snew"\n')
        return 3
    if options.has("help"):
        write_stdout(HELP)
        return 0
    if options.has("version"):
        write_stdout(VERSION)
        return 0
    try:
        return run(options)
    except BrokenPipeError:
        return 0
    except OSError as error:
        write_stderr(str(error) + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
