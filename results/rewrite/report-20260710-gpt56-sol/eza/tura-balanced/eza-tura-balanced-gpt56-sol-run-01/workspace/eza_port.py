#!/usr/bin/env python3
"""A standard-library Python port of the benchmark-visible eza behavior."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from functools import cmp_to_key
import ctypes
import fnmatch
import json
import math
import os
from pathlib import Path
import re
import stat as stat_module
import sys
from typing import Iterable, Sequence


VERSION = """eza - A modern, maintained replacement for ls
v0.23.3 [+git]
https://github.com/eza-community/eza
"""


def configure_standard_streams() -> None:
    """Match Rust's UTF-8, LF-only redirected stream behavior on Windows."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace", newline="\n")

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


FORBIDDEN = "forbidden"
NECESSARY = "necessary"
OPTIONAL = "optional"
WHEN = ("always", "auto", "never")


@dataclass(frozen=True)
class Spec:
    long: str
    short: str | None = None
    takes: str = FORBIDDEN
    choices: tuple[str, ...] | None = None
    default: str | None = None


SPECS = [
    Spec("version", "v"), Spec("help", "?"),
    Spec("oneline", "1"), Spec("long", "l"), Spec("grid", "G"),
    Spec("across", "x"), Spec("recurse", "R"), Spec("tree", "T"),
    Spec("classify", "F", OPTIONAL, WHEN, "auto"), Spec("dereference", "X"),
    Spec("width", "w", NECESSARY), Spec("no-quotes"),
    Spec("absolute", None, OPTIONAL, ("on", "follow", "off"), "on"),
    Spec("follow-symlinks"), Spec("color", None, OPTIONAL, WHEN, "auto"),
    Spec("colour", None, OPTIONAL, WHEN, "auto"),
    Spec("color-scale", None, OPTIONAL, ("all", "size", "age"), "all"),
    Spec("colour-scale", None, OPTIONAL, ("all", "size", "age"), "all"),
    Spec("color-scale-mode", None, NECESSARY, ("fixed", "gradient")),
    Spec("colour-scale-mode", None, NECESSARY, ("fixed", "gradient")),
    Spec("all", "a"), Spec("almost-all", "A"),
    Spec("treat-dirs-as-files", "d"), Spec("list-dirs"),
    Spec("level", "L", NECESSARY), Spec("reverse", "r"),
    Spec("sort", "s", NECESSARY, (
        "name", "Name", "size", "extension", "Extension", "modified",
        "changed", "accessed", "created", "inode", "type", "none",
    )),
    Spec("ignore-glob", "I", NECESSARY), Spec("git-ignore"),
    Spec("group-directories-first"), Spec("group-directories-last"),
    Spec("only-dirs", "D"), Spec("only-files", "f"), Spec("no-symlinks"),
    Spec("show-symlinks"), Spec("binary", "b"), Spec("bytes", "B"),
    Spec("group", "g"), Spec("numeric", "n"), Spec("header", "h"),
    Spec("icons", None, OPTIONAL, WHEN, "auto"), Spec("inode", "i"),
    Spec("links", "H"), Spec("modified", "m"), Spec("changed"),
    Spec("blocksize", "S"), Spec("total-size"),
    Spec("time", "t", NECESSARY, ("modified", "changed", "accessed", "created")),
    Spec("accessed", "u"), Spec("created", "U"),
    Spec("time-style", None, NECESSARY, ("default", "long-iso", "full-iso", "iso", "relative")),
    Spec("hyperlink"), Spec("mounts", "M"), Spec("smart-group"),
    Spec("no-permissions"), Spec("no-filesize"), Spec("no-user"), Spec("no-time"),
    Spec("git"), Spec("no-git"), Spec("git-repos"), Spec("git-repos-no-status"),
    Spec("extended", "@"), Spec("octal-permissions", "o"), Spec("context", "Z"),
    Spec("stdin"), Spec("flags", "O"),
]
BY_LONG = {spec.long: spec for spec in SPECS}
BY_SHORT = {spec.short: spec for spec in SPECS if spec.short is not None}


class OptionError(Exception):
    pass


@dataclass
class Flag:
    name: str
    value: str | None
    spelling: str
    order: int


@dataclass
class Options:
    flags: list[Flag] = field(default_factory=list)
    paths: list[str] = field(default_factory=list)

    def has(self, name: str) -> bool:
        return any(flag.name == name for flag in self.flags)

    def count(self, name: str) -> int:
        return sum(flag.name == name for flag in self.flags)

    def get(self, name: str) -> str | None:
        for flag in reversed(self.flags):
            if flag.name == name:
                return flag.value
        return None

    def last_of(self, names: set[str]) -> Flag | None:
        return next((f for f in reversed(self.flags) if f.name in names), None)


def choices_text(values: Sequence[str]) -> str:
    return "choices: " + ", ".join(values)


def needs_value(flag: str, spec: Spec) -> OptionError:
    suffix = f" ({choices_text(spec.choices)})" if spec.choices else ""
    return OptionError(f"Flag {flag} needs a value{suffix}")


def parse_args(argv: Sequence[str]) -> Options:
    result = Options()
    parsing = True
    index = 0
    order = 0
    while index < len(argv):
        token = argv[index]
        index += 1
        if not parsing:
            result.paths.append(token)
            continue
        if token == "--":
            parsing = False
            continue
        if token.startswith("--"):
            raw = token[2:]
            name, equal, attached = raw.partition("=")
            spec = BY_LONG.get(name)
            if spec is None:
                raise OptionError(f"Unknown argument --{name}")
            spelling = f"--{name}"
            value: str | None = None
            if equal:
                if spec.takes == FORBIDDEN:
                    raise OptionError(f"Flag {spelling} cannot take a value")
                value = attached
            elif spec.takes == NECESSARY:
                if index >= len(argv):
                    raise needs_value(spelling, spec)
                value = argv[index]
                index += 1
            elif spec.takes == OPTIONAL:
                if index < len(argv) and spec.choices and argv[index] in spec.choices:
                    value = argv[index]
                    index += 1
                else:
                    value = spec.default
            result.flags.append(Flag(name, value, spelling, order))
            order += 1
            continue
        if token.startswith("-") and token != "-":
            cluster = token[1:]
            before_equal, equal, attached = cluster.partition("=")
            pos = 0
            while pos < len(before_equal):
                short = before_equal[pos]
                spec = BY_SHORT.get(short)
                if spec is None:
                    raise OptionError(f"Unknown argument -{short}")
                spelling = f"-{short}"
                value = None
                remainder = before_equal[pos + 1:]
                is_value_flag = pos == len(before_equal) - 1 and bool(equal)
                if is_value_flag:
                    if spec.takes == FORBIDDEN:
                        raise OptionError(f"Flag {spelling} cannot take a value")
                    value = attached
                    pos = len(before_equal)
                elif spec.takes == NECESSARY:
                    if remainder:
                        value = remainder
                    elif index < len(argv):
                        value = argv[index]
                        index += 1
                    else:
                        raise needs_value(spelling, spec)
                    pos = len(before_equal)
                elif spec.takes == OPTIONAL:
                    if remainder:
                        if spec.choices and remainder not in spec.choices:
                            raise OptionError(f"Flag {spelling} cannot take a value")
                        value = remainder
                        pos = len(before_equal)
                    elif index < len(argv) and spec.choices and argv[index] in spec.choices:
                        value = argv[index]
                        index += 1
                        pos += 1
                    else:
                        value = spec.default
                        pos += 1
                else:
                    pos += 1
                result.flags.append(Flag(spec.long, value, spelling, order))
                order += 1
            continue
        result.paths.append(token)
    return result


def rust_debug(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def option_arg_name(name: str) -> str:
    spec = BY_LONG[name]
    return f"--{name}" + (f" (-{spec.short})" if spec.short else "")


def validate_options(options: Options) -> None:
    validators = {
        "color": WHEN, "colour": WHEN, "icons": (*WHEN, "automatic"),
        "classify": ("always", "auto", "automatic", "never"),
        "absolute": ("on", "yes", "follow", "off", "no"),
        "color-scale-mode": ("fixed", "gradient"),
        "colour-scale-mode": ("fixed", "gradient"),
    }
    for name, values in validators.items():
        value = options.get(name)
        if value is not None and value not in values:
            raise OptionError(f"Option {option_arg_name(name)} has no {rust_debug(value)} setting")

    sort_value = options.get("sort")
    sort_aliases = {
        "name", "filename", "Name", "Filename", ".name", ".filename", ".Name",
        ".Filename", "size", "filesize", "ext", "extension", "Ext", "Extension",
        "date", "time", "mod", "modified", "new", "newest", "age", "old", "oldest",
        "ch", "changed", "acc", "accessed", "cr", "created", "inode", "type", "none",
    }
    if sort_value is not None and sort_value not in sort_aliases:
        values = BY_LONG["sort"].choices or ()
        raise OptionError(
            f"Option {option_arg_name('sort')} has no {rust_debug(sort_value)} setting "
            f"({choices_text(values)})"
        )
    if os.name == "nt" and sort_value == "inode":
        values = BY_LONG["sort"].choices or ()
        raise OptionError(
            f"Option {option_arg_name('sort')} has no {rust_debug(sort_value)} setting "
            f"({choices_text(values)})"
        )

    for numeric in ("level", "width"):
        value = options.get(numeric)
        if value is not None:
            try:
                parsed = int(value)
                if parsed < 0:
                    raise ValueError
            except ValueError as error:
                message = "invalid digit found in string" if value else "cannot parse integer from empty string"
                raise OptionError(
                    f"Value {rust_debug(value)} not valid for option {option_arg_name(numeric)}: {message}"
                ) from error
    if options.has("tree") and options.count("all") >= 2:
        raise OptionError("Option --tree is useless given --all --all")


@dataclass
class View:
    mode: str
    tree: bool
    long: bool
    recurse: bool
    as_file: bool
    max_depth: int | None


def deduce_view(options: Options) -> View:
    selector = options.last_of({"long", "oneline", "grid", "tree"})
    has_long = options.has("long")
    mode = "lines"
    if selector is None:
        has_width = options.get("width") is not None or "COLUMNS" in os.environ
        mode = "grid" if sys.stdout.isatty() or has_width else "lines"
    elif selector.name == "long" or (
        selector.name in {"tree", "grid"} and has_long
    ):
        later = options.last_of({"grid", "tree"})
        mode = "grid-long" if later and later.name == "grid" else "details"
    elif selector.name == "tree":
        mode = "details"
    elif selector.name == "grid":
        mode = "grid"
    else:
        mode = "lines"

    can_tree = mode == "details"
    tree = options.has("tree") and can_tree
    recurse = tree or options.has("recurse")
    as_file = options.has("treat-dirs-as-files") or options.has("list-dirs") or tree
    max_depth = int(options.get("level")) if options.get("level") is not None else None
    return View(mode, tree, has_long and mode in {"details", "grid-long"}, recurse, as_file, max_depth)


@dataclass
class Entry:
    path: Path
    name: str
    display_path: str | None = None
    explicit: bool = False
    synthetic: bool = False
    dereference: bool = False
    _stat: os.stat_result | None = field(default=None, repr=False)

    def stat(self) -> os.stat_result:
        if self._stat is None:
            self._stat = self.path.stat(follow_symlinks=self.dereference)
        return self._stat

    def is_link(self) -> bool:
        return not self.dereference and self.path.is_symlink()

    def is_dir(self) -> bool:
        if self.is_link():
            return False
        try:
            return stat_module.S_ISDIR(self.stat().st_mode)
        except OSError:
            return False

    def points_to_dir(self) -> bool:
        try:
            return self.path.is_dir()
        except OSError:
            return False

    def is_file(self) -> bool:
        try:
            return stat_module.S_ISREG(self.stat().st_mode)
        except OSError:
            return False

    def extension(self) -> str | None:
        pos = self.name.rfind(".")
        return self.name[pos + 1:].lower() if pos >= 0 else None

    def length(self) -> int:
        try:
            return int(self.stat().st_size)
        except OSError:
            return 0

    def type_char(self) -> str:
        if self.is_link():
            return "l"
        if self.is_dir():
            return "d"
        return "-"


def windows_attributes(entry: Entry) -> int:
    try:
        attrs = getattr(entry.stat(), "st_file_attributes", 0)
    except OSError:
        attrs = 0
    if attrs:
        return int(attrs)
    if entry.is_dir():
        return 0x10
    return 0x20


def is_hidden(entry: Entry) -> bool:
    if entry.name.startswith("."):
        return True
    return os.name == "nt" and bool(windows_attributes(entry) & 0x2)


def scan_directory(
    path: Path,
    options: Options,
    recurse: bool,
    display_base: str | None = None,
) -> list[Entry]:
    entries: list[Entry] = []
    all_count = options.count("all")
    show_hidden = all_count > 0 or options.has("almost-all")
    if all_count >= 2:
        entries.extend([
            Entry(path, ".", synthetic=True, _stat=path.stat()),
            Entry(path.parent, "..", synthetic=True, _stat=path.parent.stat()),
        ])
    with os.scandir(path) as iterator:
        for item in iterator:
            display_path = None
            if display_base is not None:
                display_path = display_base + os.sep + item.name
            entry = Entry(
                Path(item.path),
                item.name,
                display_path=display_path,
                dereference=options.has("dereference"),
            )
            if not show_hidden and is_hidden(entry):
                continue
            entries.append(entry)
    return filter_entries(entries, options, recurse)


def filter_entries(entries: Iterable[Entry], options: Options, recurse: bool) -> list[Entry]:
    patterns: list[str] = []
    for flag in options.flags:
        if flag.name == "ignore-glob" and flag.value is not None:
            patterns.extend(flag.value.split("|"))
    result = [
        entry for entry in entries
        if not any(fnmatch.fnmatchcase(entry.name, pattern) for pattern in patterns)
    ]
    only_dirs = options.has("only-dirs")
    only_files = options.has("only-files")
    no_links = options.has("no-symlinks")
    show_links = options.has("show-symlinks")
    filtered: list[Entry] = []
    for entry in result:
        keep = True
        if only_dirs and not only_files:
            keep = entry.is_dir() or (show_links and entry.points_to_dir())
        elif only_files and not only_dirs and not recurse:
            keep = entry.is_file() or (show_links and entry.is_link() and not entry.points_to_dir())
        elif no_links:
            keep = not entry.is_link()
        if keep:
            filtered.append(entry)
    return filtered


NATURAL_PART = re.compile(r"(\d+)")


def natural_key(value: str, insensitive: bool) -> list[tuple[int, object]]:
    if insensitive:
        value = value.lower()
    result: list[tuple[int, object]] = []
    for piece in NATURAL_PART.split(value):
        if piece.isdigit():
            result.append((0, (int(piece), len(piece))))
        else:
            result.append((1, piece))
    return result


def compare_entries(left: Entry, right: Entry, field_name: str) -> int:
    insensitive = field_name not in {"Name", "Filename", ".Name", ".Filename", "Ext", "Extension"}
    def compare_values(a: object, b: object) -> int:
        return (a > b) - (a < b)

    if field_name == "none":
        return 0
    if field_name in {"size", "filesize"}:
        return compare_values(left.length(), right.length())
    if field_name in {"date", "time", "mod", "modified", "new", "newest", "age", "old", "oldest"}:
        a = getattr(left.stat(), "st_mtime", 0)
        b = getattr(right.stat(), "st_mtime", 0)
        result = compare_values(a, b)
        return -result if field_name in {"age", "old", "oldest"} else result
    if field_name in {"acc", "accessed"}:
        return compare_values(left.stat().st_atime, right.stat().st_atime)
    if field_name in {"ch", "changed"}:
        if os.name == "nt":
            return compare_values(left.stat().st_mtime, right.stat().st_mtime)
        return compare_values(left.stat().st_ctime, right.stat().st_ctime)
    if field_name in {"cr", "created"}:
        return compare_values(left.stat().st_ctime, right.stat().st_ctime)
    if field_name == "inode":
        return compare_values(left.stat().st_ino, right.stat().st_ino)
    if field_name == "type":
        rank = {"d": 0, "l": 1, "p": 2, "s": 3, "b": 4, "c": 5, "-": 6, "?": 7}
        result = compare_values(rank.get(left.type_char(), 7), rank.get(right.type_char(), 7))
        if result:
            return result
        return compare_values(natural_key(left.name, False), natural_key(right.name, False))
    if field_name in {"ext", "extension", "Ext", "Extension"}:
        a_ext, b_ext = left.extension(), right.extension()
        a_key = (a_ext is not None, a_ext or "")
        b_key = (b_ext is not None, b_ext or "")
        result = compare_values(a_key, b_key)
        if result:
            return result
    a_name = left.name[1:] if field_name.startswith(".") and left.name.startswith(".") else left.name
    b_name = right.name[1:] if field_name.startswith(".") and right.name.startswith(".") else right.name
    return compare_values(natural_key(a_name, insensitive), natural_key(b_name, insensitive))


def sort_entries(entries: list[Entry], options: Options) -> list[Entry]:
    field_name = options.get("sort") or "name"
    ordered = sorted(entries, key=cmp_to_key(lambda a, b: compare_entries(a, b, field_name)))
    if options.has("reverse"):
        ordered.reverse()
    if options.has("group-directories-first"):
        ordered.sort(key=lambda entry: not entry.points_to_dir())
    elif options.has("group-directories-last"):
        ordered.sort(key=lambda entry: entry.points_to_dir())
    return ordered


def quote_name(name: str, no_quotes: bool) -> str:
    escaped = "".join(
        char if char >= " " and char not in "\x7f\n\r\t" else repr(char)[1:-1]
        for char in name
    )
    if no_quotes:
        return escaped
    if "'" in escaped:
        return f'"{escaped}"'
    if " " in escaped:
        return f"'{escaped}'"
    return escaped


def display_name(entry: Entry, options: Options) -> str:
    absolute = options.get("absolute")
    if absolute in {"on", "yes"}:
        raw = str(entry.path.absolute())
    elif absolute == "follow":
        raw = str(entry.path.resolve())
        if os.name == "nt" and not raw.startswith("\\\\?\\"):
            raw = "\\\\?\\" + raw
    elif entry.explicit:
        raw = str(entry.path)
    else:
        raw = entry.name
    rendered = quote_name(raw, options.has("no-quotes"))
    classify = options.get("classify")
    auto_active = sys.stdout.isatty() or options.get("width") is not None or "COLUMNS" in os.environ
    if classify == "always" or (classify in {"auto", "automatic"} and auto_active):
        if entry.is_dir():
            rendered += "/"
        elif entry.is_link():
            rendered += "@"
    if entry.is_link() and not options.has("dereference"):
        try:
            target = os.readlink(entry.path)
            rendered += " -> " + quote_name(str(target), options.has("no-quotes"))
        except OSError:
            pass
    return rendered


def permission_cell(entry: Entry) -> str:
    if os.name == "nt":
        attrs = windows_attributes(entry)
        kind = "l" if entry.is_link() else "d" if entry.is_dir() else "-"
        return kind + ("a" if attrs & 0x20 else "-") + ("r" if attrs & 0x1 else "-") + ("h" if attrs & 0x2 else "-") + ("s" if attrs & 0x4 else "-")
    try:
        return stat_module.filemode(entry.stat().st_mode)
    except OSError:
        return "----------"


def round_away(value: float) -> int:
    return math.floor(value + 0.5)


def size_cell(entry: Entry, options: Options) -> str:
    if entry.is_dir():
        return "-"
    size = entry.length()
    if options.has("bytes"):
        return f"{size:,}"
    binary = options.has("binary")
    base = 1024 if binary else 1000
    symbols = ("", "Ki", "Mi", "Gi", "Ti", "Pi", "Ei") if binary else ("", "k", "M", "G", "T", "P", "E")
    if size < base:
        return str(size)
    exponent = min(int(math.log(size, base)), len(symbols) - 1)
    number = size / (base ** exponent)
    shown = f"{number:.1f}" if number < 10 else str(round_away(number))
    return shown + symbols[exponent]


def timestamp_for(entry: Entry, kind: str) -> float:
    info = entry.stat()
    if kind == "accessed":
        return info.st_atime
    if kind == "changed":
        return info.st_mtime if os.name == "nt" else info.st_ctime
    if kind == "created":
        return info.st_ctime
    return info.st_mtime


def time_cell(entry: Entry, options: Options, kind: str) -> str:
    timestamp = timestamp_for(entry, kind)
    current_offset = datetime.now().astimezone().utcoffset() or timedelta(0)
    fixed_zone = timezone(current_offset)
    moment = datetime.fromtimestamp(timestamp, timezone.utc).astimezone(fixed_zone)
    style = options.get("time-style") or os.environ.get("TIME_STYLE") or "default"
    if style.startswith("+"):
        return moment.strftime(style[1:])
    if style == "long-iso":
        return moment.strftime("%Y-%m-%d %H:%M")
    if style == "full-iso":
        nanos = int(timestamp * 1_000_000_000) % 1_000_000_000
        return moment.strftime("%Y-%m-%d %H:%M:%S") + f".{nanos:09d} " + moment.strftime("%z")
    if style == "iso":
        return moment.strftime("%m-%d %H:%M" if moment.year == datetime.now().year else "%Y-%m-%d")
    if style == "relative":
        seconds = max(0, int(datetime.now().timestamp() - timestamp))
        if seconds < 60:
            return "now"
        if seconds < 3600:
            return f"{seconds // 60}m"
        if seconds < 86400:
            return f"{seconds // 3600}h"
        if seconds < 31_536_000:
            return f"{seconds // 86400}d"
        return f"{seconds // 31_536_000}y"
    if moment.year == datetime.now().year:
        return f"{moment.day:2d} {moment.strftime('%b')} {moment.strftime('%H:%M')}"
    return f"{moment.day:2d} {moment.strftime('%b')}  {moment.year:04d}"


def selected_times(options: Options) -> list[str]:
    if options.has("no-time"):
        return []
    selected: list[str] = []
    if options.get("time"):
        value = options.get("time") or "modified"
        aliases = {"mod": "modified", "ch": "changed", "acc": "accessed", "cr": "created"}
        return [aliases.get(value, value)]
    for name in ("modified", "changed", "created", "accessed"):
        if options.has(name):
            selected.append(name)
    return selected or ["modified"]


@dataclass(frozen=True)
class Column:
    name: str
    header: str
    right: bool = False


def columns_for(options: Options) -> list[Column]:
    columns: list[Column] = []
    if not options.has("no-permissions"):
        columns.append(Column("permissions", "Mode" if os.name == "nt" else "Permissions"))
    if not options.has("no-filesize"):
        columns.append(Column("size", "Size", True))
    if os.name != "nt" and not options.has("no-user"):
        columns.append(Column("user", "User"))
    labels = {
        "modified": "Date Modified", "changed": "Date Changed",
        "created": "Date Created", "accessed": "Date Accessed",
    }
    columns.extend(Column(kind, labels[kind]) for kind in selected_times(options))
    return columns


def cells_for(entry: Entry, options: Options, columns: Sequence[Column]) -> list[str]:
    result: list[str] = []
    for column in columns:
        if column.name == "permissions":
            result.append(permission_cell(entry))
        elif column.name == "size":
            result.append(size_cell(entry, options))
        elif column.name == "user":
            try:
                import pwd
                result.append(pwd.getpwuid(entry.stat().st_uid).pw_name)
            except (ImportError, KeyError, OSError):
                result.append(str(getattr(entry.stat(), "st_uid", 0)))
        else:
            result.append(time_cell(entry, options, column.name))
    return result


def format_table_rows(rows: Sequence[tuple[Entry | None, str, str]], options: Options) -> list[str]:
    columns = columns_for(options)
    all_cells: list[list[str]] = []
    if options.has("header"):
        all_cells.append([column.header for column in columns])
    all_cells.extend(cells_for(entry, options, columns) for entry, _, _ in rows if entry is not None)
    widths = [0] * len(columns)
    for cells in all_cells:
        for index, cell in enumerate(cells):
            widths[index] = max(widths[index], len(cell))

    output: list[str] = []
    if options.has("header"):
        header = "".join(
            (cell.rjust(widths[i]) if columns[i].right else cell.ljust(widths[i])) + " "
            for i, cell in enumerate(all_cells[0])
        ) + "Name"
        output.append(header)
    for entry, prefix, name in rows:
        if entry is None:
            output.append(prefix + name)
            continue
        cells = cells_for(entry, options, columns)
        metadata = "".join(
            (cell.rjust(widths[i]) if columns[i].right else cell.ljust(widths[i])) + " "
            for i, cell in enumerate(cells)
        )
        output.append(metadata + prefix + name)
    return output


def render_grid(entries: Sequence[Entry], options: Options) -> list[str]:
    names = [display_name(entry, options) for entry in entries]
    if not names:
        return []
    width = int(options.get("width") or os.environ.get("COLUMNS") or 80)
    count = len(names)
    cell_widths = [len(name) for name in names]
    widest = max(cell_widths)

    def dimensions(rows: int, columns: int) -> list[int]:
        result = [0] * columns
        for index, cell_width in enumerate(cell_widths):
            column = index % columns if options.has("across") else index // rows
            result[column] = max(result[column], cell_width)
        return result

    widest_column = widest + 2
    if widest_column > width:
        rows, widths = count, [widest]
    else:
        min_columns = min(count, (width + 2) // widest_column)
        rows = math.ceil(count / min_columns)
        widths = dimensions(rows, min_columns)
        if rows > 1:
            for columns in range(min_columns + 1, count):
                separators = (columns - 1) * 2
                if separators > width:
                    break
                candidate_rows = math.ceil(count / columns)
                candidate = dimensions(candidate_rows, columns)
                if sum(candidate) <= width - separators:
                    rows, widths = candidate_rows, candidate

    chosen = len(widths)
    output: list[str] = []
    for row in range(rows):
        cells: list[str] = []
        for column in range(chosen):
            index = row * chosen + column if options.has("across") else column * rows + row
            if index >= count:
                continue
            value = names[index]
            offset = 1 if options.has("across") else rows
            last = column == chosen - 1 or index + offset >= count
            cells.append(value if last else value.ljust(widths[column] + 2))
        output.append("".join(cells))
    return output


def render_plain(entries: Sequence[Entry], options: Options, view: View) -> list[str]:
    if view.mode in {"grid", "grid-long"}:
        return render_grid(entries, options)
    return [display_name(entry, options) for entry in entries]


def tree_rows(roots: Sequence[Entry], options: Options, view: View) -> list[tuple[Entry, str, str]]:
    rows: list[tuple[Entry, str, str]] = []

    def visit(entry: Entry, depth: int, ancestors_last: list[bool], last: bool) -> None:
        if depth == 0:
            prefix = ""
        else:
            prefix = "".join("    " if done else "│   " for done in ancestors_last)
            prefix += "└── " if last else "├── "
        rows.append((entry, prefix, display_name(entry, options)))
        if not entry.points_to_dir() or entry.synthetic:
            return
        if entry.is_link() and not options.has("follow-symlinks"):
            return
        if view.max_depth is not None and view.max_depth <= depth:
            return
        try:
            children = sort_entries(scan_directory(entry.path, options, True), options)
        except OSError as error:
            rows.append((entry, prefix + "└── ", f"<{format_os_error(error)}>"))
            return
        if options.has("only-files"):
            visible = [child for child in children if not child.is_dir()]
        else:
            visible = children
        next_ancestors = ancestors_last if depth == 0 else [*ancestors_last, last]
        for index, child in enumerate(visible):
            visit(child, depth + 1, next_ancestors, index == len(visible) - 1)

    for index, root in enumerate(roots):
        visit(root, 0, [], index == len(roots) - 1)
    return rows


def render_entries(entries: Sequence[Entry], options: Options, view: View) -> list[str]:
    ordered = sort_entries(list(entries), options)
    if view.tree:
        rows = tree_rows(ordered, options, view)
        if view.long:
            return format_table_rows(rows, options)
        return [prefix + name for _, prefix, name in rows]
    if view.long:
        rows = [(entry, "", display_name(entry, options)) for entry in ordered]
        return format_table_rows(rows, options)
    return render_plain(ordered, options, view)


def format_os_error(error: OSError) -> str:
    code = getattr(error, "winerror", None) or error.errno or 1
    if os.name == "nt":
        text = ctypes.FormatError(code).strip()
    else:
        text = os.strerror(code)
    return f"{text} (os error {code})"


def make_explicit(path_text: str, options: Options) -> Entry:
    path = Path(path_text)
    entry = Entry(
        path,
        path.name or str(path),
        display_path=path_text,
        explicit=True,
        dereference=options.has("dereference"),
    )
    entry.stat()
    return entry


def recursive_blocks(directory: Entry, options: Options, view: View, top: bool) -> list[str]:
    output: list[str] = []
    try:
        children = sort_entries(
            scan_directory(directory.path, options, True, directory.display_path),
            options,
        )
    except OSError as error:
        sys.stderr.write(f"{directory.path}: {format_os_error(error)}\n")
        return output
    if not top:
        output.append(f"{directory.display_path or directory.path}:")
    visible = [entry for entry in children if not (options.has("only-files") and entry.is_dir())]
    output.extend(render_entries(visible, options, View(view.mode, False, view.long, False, False, None)))
    depth = len(directory.path.parts) + 1
    if view.max_depth is not None and view.max_depth <= depth:
        return output
    child_dirs = [
        entry for entry in children
        if entry.is_dir() or (options.has("follow-symlinks") and entry.points_to_dir())
    ]
    for child in child_dirs:
        nested = recursive_blocks(child, options, view, False)
        if nested:
            if output:
                output.append("")
            output.extend(nested)
    return output


def run(options: Options) -> int:
    validate_options(options)
    if options.has("help"):
        sys.stdout.write(HELP)
        return 0
    if options.has("version"):
        sys.stdout.write(VERSION)
        return 0

    view = deduce_view(options)
    paths = list(options.paths)
    if not paths:
        if options.has("stdin") or not sys.stdin.isatty():
            separator = os.environ.get("EZA_STDIN_SEPARATOR", "\n")
            paths = [part for part in sys.stdin.read().split(separator) if part]
        else:
            paths = ["."]

    files: list[Entry] = []
    directories: list[Entry] = []
    status = 0
    for path_text in paths:
        try:
            entry = make_explicit(path_text, options)
        except OSError as error:
            sys.stderr.write(f"{rust_debug(path_text)}: {format_os_error(error)}\n")
            status = 2
            continue
        if entry.points_to_dir() and not view.as_file:
            directories.append(entry)
        else:
            files.append(entry)

    output: list[str] = []
    files = filter_entries(files, options, view.recurse)
    if files:
        output.extend(render_entries(files, options, view))

    if view.recurse and not view.tree:
        for index, directory in enumerate(directories):
            block = recursive_blocks(directory, options, view, index == 0 and len(directories) == 1 and not files)
            if block:
                if output:
                    output.append("")
                output.extend(block)
    else:
        only_dir = len(directories) == 1 and not files
        for directory in directories:
            try:
                children = sort_entries(scan_directory(directory.path, options, False), options)
            except OSError as error:
                sys.stderr.write(f"{directory.path}: {format_os_error(error)}\n")
                continue
            if output:
                output.append("")
            if not only_dir:
                output.append(f"{directory.path}:")
            output.extend(render_entries(children, options, view))

    if output:
        sys.stdout.write("\n".join(output) + "\n")
    return status


def main(argv: Sequence[str] | None = None) -> int:
    configure_standard_streams()
    try:
        return run(parse_args(sys.argv[1:] if argv is None else argv))
    except OptionError as error:
        sys.stderr.write(f"eza: {error}\n")
        return 3
    except BrokenPipeError:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
