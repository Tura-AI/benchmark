#!/usr/bin/env python3
"""Python port of the eza CLI behavior used by this benchmark."""

from __future__ import annotations

import ctypes
import datetime as dt
import fnmatch
import math
import ntpath
import os
import re
import shlex
import stat
import sys
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable, Sequence


VERSION = "eza - A modern, maintained replacement for ls\nv0.23.3 [+git]\nhttps://github.com/eza-community/eza\n"
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
  -w, --width COLS           set screen width in columns

FILTERING AND SORTING OPTIONS
  -a, --all                  show hidden and 'dot' files
  -A, --almost-all           show hidden files
  -d, --treat-dirs-as-files  list directories as files
  -D, --only-dirs            list only directories
  -f, --only-files           list only files
  -L, --level DEPTH          limit the depth of recursion
  -r, --reverse              reverse the sort order
  -s, --sort SORT_FIELD      which field to sort by
"""

SORT_CHOICES = (
    "name",
    "Name",
    "size",
    "extension",
    "Extension",
    "modified",
    "changed",
    "accessed",
    "created",
    "inode",
    "type",
    "none",
)

SORT_ALIASES = {
    "date": "modified",
    "time": "modified",
    "old": "modified",
    "oldest": "modified",
    "new": "modified",
    "newest": "modified",
}

SHORT_VALUES = {"w": "width", "L": "level", "s": "sort", "I": "ignore", "t": "time"}
SHORT_OPTIONAL = {"F": "classify"}
SHORT_FLAGS = {
    "1": "oneline",
    "l": "long",
    "G": "grid",
    "x": "across",
    "R": "recurse",
    "T": "tree",
    "X": "dereference",
    "a": "all",
    "A": "almost_all",
    "d": "dirs_as_files",
    "r": "reverse",
    "D": "only_dirs",
    "f": "only_files",
    "b": "binary",
    "B": "bytes",
    "g": "group",
    "h": "header",
    "H": "links",
    "i": "inode",
    "M": "mounts",
    "n": "numeric",
    "O": "flags",
    "S": "blocksize",
    "m": "modified",
    "u": "accessed",
    "U": "created",
    "o": "octal",
    "v": "version",
    "?": "help",
}

LONG_VALUES = {
    "width": "width",
    "level": "level",
    "sort": "sort",
    "ignore-glob": "ignore",
    "time": "time",
    "time-style": "time_style",
    "color-scale-mode": "ignored_value",
    "colour-scale-mode": "ignored_value",
}

LONG_OPTIONAL = {
    "color": "color",
    "colour": "color",
    "icons": "icons",
    "classify": "classify",
    "absolute": "absolute",
    "color-scale": "ignored_optional",
    "colour-scale": "ignored_optional",
}

LONG_FLAGS = {
    "oneline": "oneline",
    "long": "long",
    "grid": "grid",
    "across": "across",
    "recurse": "recurse",
    "tree": "tree",
    "dereference": "dereference",
    "follow-symlinks": "follow",
    "no-quotes": "no_quotes",
    "hyperlink": "hyperlink",
    "all": "all",
    "almost-all": "almost_all",
    "treat-dirs-as-files": "dirs_as_files",
    "list-dirs": "dirs_as_files",
    "reverse": "reverse",
    "git-ignore": "git_ignore",
    "group-directories-first": "dirs_first",
    "group-directories-last": "dirs_last",
    "only-dirs": "only_dirs",
    "only-files": "only_files",
    "no-symlinks": "no_symlinks",
    "show-symlinks": "show_symlinks",
    "binary": "binary",
    "bytes": "bytes",
    "group": "group",
    "smart-group": "smart_group",
    "header": "header",
    "links": "links",
    "inode": "inode",
    "mounts": "mounts",
    "numeric": "numeric",
    "flags": "flags",
    "blocksize": "blocksize",
    "modified": "modified",
    "accessed": "accessed",
    "created": "created",
    "changed": "changed",
    "total-size": "total_size",
    "octal-permissions": "octal",
    "no-permissions": "no_permissions",
    "no-filesize": "no_filesize",
    "no-user": "no_user",
    "no-time": "no_time",
    "git": "git",
    "git-repos": "git_repos",
    "git-repos-no-status": "git_repos_no_status",
    "extended": "extended",
    "stdin": "stdin",
    "version": "version",
    "help": "help",
}


class OptionError(Exception):
    pass


@dataclass
class Options:
    long: bool = False
    force_lines: bool = False
    grid: bool = True
    across: bool = False
    recurse: bool = False
    tree: bool = False
    dirs_as_files: bool = False
    max_depth: int | None = None
    width: int | None = None
    all_count: int = 0
    reverse: bool = False
    sort: str = "name"
    sort_reverse_alias: bool = False
    dirs_first: bool = False
    dirs_last: bool = False
    only_dirs: bool = False
    only_files: bool = False
    no_symlinks: bool = False
    show_symlinks: bool = False
    follow: bool = False
    dereference: bool = False
    ignore_patterns: list[str] = field(default_factory=list)
    no_quotes: bool = False
    absolute: str = "off"
    classify: str = "auto"
    size_format: str = "decimal"
    header: bool = False
    no_permissions: bool = False
    no_filesize: bool = False
    no_time: bool = False
    flags: bool = False
    time_fields: list[str] = field(default_factory=lambda: ["modified"])
    time_style: str = "default"
    explicit_time: bool = False
    stdin: bool = False


@dataclass
class Entry:
    path: str
    name: str
    display: str
    info: os.stat_result
    is_link: bool
    is_dir: bool
    synthetic: bool = False

    @property
    def size(self) -> int | None:
        return None if self.is_dir else int(self.info.st_size)

    @property
    def extension(self) -> str:
        if self.name.startswith(".") and self.name.count(".") == 1:
            return ""
        dot = self.name.rfind(".")
        return "" if dot <= 0 else self.name[dot + 1 :]


def write_stdout(text: str) -> None:
    sys.stdout.buffer.write(text.encode("utf-8", errors="surrogateescape"))


def write_stderr(text: str) -> None:
    sys.stderr.buffer.write(text.encode("utf-8", errors="surrogateescape"))


def parse_number(value: str, option: str) -> int:
    if not value or not value.isascii() or not value.isdigit():
        raise OptionError(
            f'eza: Value "{value}" not valid for option --{option}: invalid digit found in string\n'
        )
    return int(value, 10)


def bad_choice(option: str, short: str | None, value: str, choices: Sequence[str]) -> OptionError:
    label = f"--{option}" + (f" (-{short})" if short else "")
    return OptionError(
        f'eza: Option {label} has no "{value}" setting (choices: {", ".join(choices)})\n'
    )


def set_time_field(options: Options, value: str) -> None:
    aliases = {"date": "modified", "time": "modified", "mod": "modified", "access": "accessed", "birth": "created"}
    value = aliases.get(value, value)
    if value not in {"modified", "changed", "accessed", "created"}:
        raise bad_choice("time", "t", value, ("modified", "changed", "accessed", "created"))
    options.time_fields = [value]
    options.explicit_time = True


def set_flag(options: Options, name: str) -> str | None:
    if name == "oneline":
        options.force_lines = True
        options.grid = False
    elif name == "grid":
        options.grid = True
        options.force_lines = False
    elif name == "long":
        options.long = True
    elif name == "all":
        options.all_count += 1
    elif name == "almost_all":
        options.all_count = max(options.all_count, 1)
    elif name in {"modified", "accessed", "created", "changed"}:
        if not options.explicit_time:
            options.time_fields = []
            options.explicit_time = True
        if name not in options.time_fields:
            options.time_fields.append(name)
    elif name == "binary":
        options.size_format = "binary"
    elif name == "bytes":
        options.size_format = "bytes"
    elif name == "no_time":
        options.no_time = True
        options.time_fields = []
    elif name == "help":
        return "help"
    elif name == "version":
        return "version"
    elif hasattr(options, name):
        setattr(options, name, True)
    return None


def apply_value(options: Options, name: str, value: str) -> None:
    if name == "width":
        options.width = parse_number(value, "width (-w)")
    elif name == "level":
        options.max_depth = parse_number(value, "level (-L)")
    elif name == "sort":
        raw = value
        canonical = SORT_ALIASES.get(raw, raw)
        if canonical not in SORT_CHOICES:
            raise bad_choice("sort", "s", raw, SORT_CHOICES)
        options.sort = canonical
        options.sort_reverse_alias = raw in {"new", "newest"}
    elif name == "ignore":
        options.ignore_patterns.extend(part for part in value.split("|") if part)
    elif name == "time":
        set_time_field(options, value)
    elif name == "time_style":
        allowed = {"default", "iso", "long-iso", "full-iso", "relative"}
        if value not in allowed and not value.startswith("+"):
            raise bad_choice("time-style", None, value, tuple(allowed))
        options.time_style = value


def apply_optional(options: Options, name: str, value: str | None) -> None:
    if name == "absolute":
        actual = value or "on"
        if actual not in {"on", "follow", "off"}:
            raise bad_choice("absolute", None, actual, ("on", "follow", "off"))
        options.absolute = actual
    elif name == "classify":
        actual = value or "auto"
        if actual not in {"always", "auto", "never"}:
            raise bad_choice("classify", "F", actual, ("always", "auto", "never"))
        options.classify = actual
    elif name in {"color", "icons"}:
        actual = value or "auto"
        if actual not in {"always", "auto", "never"}:
            raise bad_choice(name, None, actual, ("always", "auto", "never"))


def parse_args(argv: Sequence[str]) -> tuple[Options, list[str], str | None]:
    options = Options()
    paths: list[str] = []
    args = list(argv)
    inherited = os.environ.get("EZA_OPTIONS") or os.environ.get("EXA_OPTIONS")
    if inherited:
        try:
            args = shlex.split(inherited, posix=False) + args
        except ValueError:
            pass
    i = 0
    literal = False
    result: str | None = None
    while i < len(args):
        token = args[i]
        if literal or token == "-" or not token.startswith("-"):
            paths.append(token)
            i += 1
            continue
        if token == "--":
            literal = True
            i += 1
            continue
        if token.startswith("--"):
            raw = token[2:]
            key, equal, attached = raw.partition("=")
            if key in LONG_FLAGS:
                if equal:
                    raise OptionError(f"eza: Flag --{key} does not take a value\n")
                special = set_flag(options, LONG_FLAGS[key])
                result = special or result
            elif key in LONG_VALUES:
                if equal:
                    value = attached
                else:
                    i += 1
                    if i >= len(args):
                        raise OptionError(f"eza: Flag --{key} needs a value\n")
                    value = args[i]
                apply_value(options, LONG_VALUES[key], value)
            elif key in LONG_OPTIONAL:
                value = attached if equal else None
                if not equal and i + 1 < len(args) and not args[i + 1].startswith("-"):
                    i += 1
                    value = args[i]
                apply_optional(options, LONG_OPTIONAL[key], value)
            else:
                raise OptionError(f"eza: Unknown argument --{key}\n")
            i += 1
            continue

        cluster = token[1:]
        position = 0
        while position < len(cluster):
            short = cluster[position]
            if short in SHORT_FLAGS:
                special = set_flag(options, SHORT_FLAGS[short])
                result = special or result
                position += 1
            elif short in SHORT_VALUES:
                rest = cluster[position + 1 :]
                if rest.startswith("="):
                    rest = rest[1:]
                if rest:
                    value = rest
                else:
                    i += 1
                    if i >= len(args):
                        raise OptionError(f"eza: Flag -{short} needs a value\n")
                    value = args[i]
                apply_value(options, SHORT_VALUES[short], value)
                position = len(cluster)
            elif short in SHORT_OPTIONAL:
                rest = cluster[position + 1 :]
                if rest.startswith("="):
                    rest = rest[1:]
                value = rest or None
                if value is None and i + 1 < len(args) and not args[i + 1].startswith("-"):
                    i += 1
                    value = args[i]
                apply_optional(options, SHORT_OPTIONAL[short], value)
                position = len(cluster)
            else:
                raise OptionError(f"eza: Unknown argument -{short}\n")
        i += 1

    if options.only_dirs and options.only_files:
        raise OptionError("eza: Option --only-files (-f) conflicts with option --only-dirs (-D)\n")
    if options.tree and options.all_count >= 2:
        raise OptionError("eza: Option --tree is useless given --all --all\n")
    if options.tree:
        options.recurse = True
    return options, paths, result


def display_width(text: str) -> int:
    width = 0
    for char in text:
        if unicodedata.combining(char):
            continue
        width += 2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1
    return width


def escape_name(value: str, no_quotes: bool) -> str:
    escaped: list[str] = []
    for char in value:
        code = ord(char)
        if code >= 0x20 and code != 0x7F:
            escaped.append(char)
        elif char == "\n":
            escaped.append("\\n")
        elif char == "\r":
            escaped.append("\\r")
        elif char == "\t":
            escaped.append("\\t")
        elif char == "\0":
            escaped.append("\\0")
        else:
            escaped.append(f"\\u{{{code:x}}}")
    result = "".join(escaped)
    if not no_quotes and (" " in value or "'" in value):
        quote = '"' if "'" in value else "'"
        return quote + result + quote
    return result


def normalized_root(path: str) -> str:
    return ntpath.normpath(path) if os.name == "nt" else os.path.normpath(path)


def direct_file_display(path: str) -> str:
    if os.name != "nt":
        return path
    index = max(path.rfind("/"), path.rfind("\\"))
    if index < 0:
        return path
    parent = path[:index]
    base = path[index + 1 :]
    return parent + "\\" + base


def joined_display(parent: str, child: str) -> str:
    return parent.rstrip("/\\") + ("\\" if os.name == "nt" else "/") + child


def make_entry(path: str, name: str, display: str, options: Options, synthetic: bool = False) -> Entry:
    info = os.stat(path, follow_symlinks=options.dereference)
    link = os.path.islink(path) and not options.dereference
    is_dir = stat.S_ISDIR(info.st_mode)
    return Entry(path, name, display, info, link, is_dir, synthetic)


def windows_message(code: int) -> str:
    if os.name == "nt":
        message = ctypes.FormatError(code).strip()
        if message:
            return message
    return os.strerror(code)


def error_for(path: str, error: OSError) -> tuple[str, int]:
    code = int(getattr(error, "winerror", None) or error.errno or 1)
    status = 13 if code in {5, 13} else 2 if code in {2, 3} else 1
    return f'"{path}": {windows_message(code)} (os error {code})\n', status


def is_hidden(entry: os.DirEntry[str]) -> bool:
    if entry.name.startswith("."):
        return True
    try:
        attributes = getattr(entry.stat(follow_symlinks=False), "st_file_attributes", 0)
        return bool(attributes & 0x2)
    except OSError:
        return False


def ignored(name: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch.fnmatchcase(name, pattern) for pattern in patterns)


def natural_parts(value: str, fold: bool) -> tuple[tuple[int, object, int], ...]:
    parts: list[tuple[int, object, int]] = []
    for part in re.split(r"(\d+)", value):
        if part.isdigit():
            parts.append((0, int(part), len(part)))
        else:
            parts.append((1, part.casefold() if fold else part, 0))
    return tuple(parts)


def time_value(entry: Entry, kind: str) -> float:
    if kind == "modified":
        return entry.info.st_mtime
    if kind == "accessed":
        return entry.info.st_atime
    if kind == "created":
        return float(getattr(entry.info, "st_birthtime", entry.info.st_ctime))
    return entry.info.st_ctime


def entry_key(entry: Entry, sort_field: str) -> object:
    if sort_field == "name":
        return natural_parts(entry.name, True)
    if sort_field == "Name":
        return natural_parts(entry.name, False)
    if sort_field in {"extension", "Extension"}:
        fold = sort_field == "extension"
        extension = entry.extension.casefold() if fold else entry.extension
        return (extension, natural_parts(entry.name, fold))
    if sort_field == "size":
        return (-1 if entry.size is None else entry.size, natural_parts(entry.name, True))
    if sort_field in {"modified", "changed", "accessed", "created"}:
        return (time_value(entry, sort_field), natural_parts(entry.name, True))
    if sort_field == "inode":
        return (getattr(entry.info, "st_ino", 0), natural_parts(entry.name, True))
    if sort_field == "type":
        kind = 0 if entry.is_dir else 1 if entry.is_link else 2
        return (kind, entry.extension.casefold(), natural_parts(entry.name, True))
    return 0


def sorted_entries(entries: list[Entry], options: Options) -> list[Entry]:
    result = list(entries)
    if options.sort != "none":
        reverse = options.reverse ^ options.sort_reverse_alias
        result.sort(key=lambda item: entry_key(item, options.sort), reverse=reverse)
    elif options.reverse:
        result.reverse()
    if options.dirs_first:
        result = [item for item in result if item.is_dir] + [item for item in result if not item.is_dir]
    elif options.dirs_last:
        result = [item for item in result if not item.is_dir] + [item for item in result if item.is_dir]
    return result


def list_children(path: str, options: Options) -> tuple[list[Entry], list[str], int]:
    entries: list[Entry] = []
    errors: list[str] = []
    status = 0
    try:
        with os.scandir(path) as iterator:
            dir_entries = list(iterator)
    except OSError as error:
        message, status = error_for(path, error)
        return [], [message], status

    for child in dir_entries:
        if options.all_count == 0 and is_hidden(child):
            continue
        if ignored(child.name, options.ignore_patterns):
            continue
        try:
            entry = make_entry(child.path, child.name, child.name, options)
        except OSError as error:
            message, code = error_for(child.path, error)
            errors.append(message)
            status = max(status, code)
            continue
        if options.no_symlinks and entry.is_link:
            continue
        if options.only_dirs and not entry.is_dir and not (options.show_symlinks and entry.is_link):
            continue
        if options.only_files and entry.is_dir and not (options.show_symlinks and entry.is_link):
            continue
        entries.append(entry)

    if options.all_count >= 2:
        for name in (".", ".."):
            target = os.path.join(path, name)
            try:
                entries.append(make_entry(target, name, name, options, synthetic=True))
            except OSError:
                pass
    return sorted_entries(entries, options), errors, status


def link_suffix(entry: Entry, options: Options) -> str:
    if not entry.is_link:
        return ""
    try:
        target = os.readlink(entry.path)
    except OSError:
        return ""
    return " -> " + escape_name(target, options.no_quotes)


def indicator(entry: Entry, options: Options) -> str:
    if options.classify != "always":
        return ""
    if entry.is_link:
        return "@"
    if entry.is_dir:
        return "/"
    return ""


def displayed_name(entry: Entry, options: Options, override: str | None = None) -> str:
    raw = override if override is not None else entry.display
    if options.absolute != "off":
        actual = os.path.realpath(entry.path) if options.absolute == "follow" else os.path.abspath(entry.path)
        raw = normalized_root(actual)
    return escape_name(raw, options.no_quotes) + indicator(entry, options) + link_suffix(entry, options)


def format_size(entry: Entry, options: Options) -> str:
    size = entry.size
    if size is None:
        return "-"
    if options.size_format == "bytes":
        return f"{size:,}"
    base = 1024 if options.size_format == "binary" else 1000
    symbols = ("", "Ki", "Mi", "Gi", "Ti", "Pi", "Ei") if base == 1024 else ("", "k", "M", "G", "T", "P", "E")
    if size < base:
        return str(size)
    power = min(int(math.log(size, base)), len(symbols) - 1)
    number = size / (base**power)
    shown = f"{number:.1f}" if number < 10 else str(int(math.floor(number + 0.5)))
    return shown + symbols[power]


def permission_text(entry: Entry) -> str:
    if entry.is_link:
        kind = "l"
    elif entry.is_dir:
        kind = "d"
    else:
        kind = "-"
    attributes = int(getattr(entry.info, "st_file_attributes", 0))
    archive = bool(attributes & 0x20) or (os.name == "nt" and not entry.is_dir and not entry.is_link)
    readonly = bool(attributes & 0x1)
    hidden = bool(attributes & 0x2)
    system = bool(attributes & 0x4)
    return kind + ("a" if archive else "-") + ("r" if readonly else "-") + ("h" if hidden else "-") + ("s" if system else "-")


MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def timestamp(entry: Entry, kind: str, style: str) -> str:
    value = time_value(entry, kind)
    date = dt.datetime.fromtimestamp(value).astimezone()
    if style == "default":
        if date.year == dt.datetime.now().astimezone().year:
            return f"{date.day:2d} {MONTHS[date.month - 1]} {date:%H:%M}"
        return f"{date.day:2d} {MONTHS[date.month - 1]} {date.year:5d}"
    if style == "iso":
        return date.strftime("%m-%d %H:%M")
    if style == "long-iso":
        return date.strftime("%Y-%m-%d %H:%M")
    if style == "full-iso":
        return date.strftime("%Y-%m-%d %H:%M:%S.%f %z")
    if style == "relative":
        seconds = int((dt.datetime.now().astimezone() - date).total_seconds())
        future = seconds < 0
        seconds = abs(seconds)
        units = ((31536000, "year"), (2592000, "month"), (86400, "day"), (3600, "hour"), (60, "minute"), (1, "second"))
        amount, unit = next((seconds // span, label) for span, label in units if seconds >= span)
        plural = "" if amount == 1 else "s"
        return f"in {amount} {unit}{plural}" if future else f"{amount} {unit}{plural} ago"
    custom = style[1:] if style.startswith("+") else style
    return date.strftime(custom)


def flag_text(entry: Entry) -> str:
    attributes = int(getattr(entry.info, "st_file_attributes", 0))
    flags = ((0x1, "R"), (0x2, "H"), (0x4, "S"), (0x20, "A"), (0x100, "T"), (0x800, "C"), (0x1000, "O"), (0x2000, "I"), (0x4000, "E"))
    result = "".join(letter for bit, letter in flags if attributes & bit)
    return result or "-"


@dataclass
class Column:
    title: str
    align_right: bool
    value: object


def columns_for(options: Options) -> list[Column]:
    columns: list[Column] = []
    if not options.no_permissions:
        columns.append(Column("Permissions", False, permission_text))
    if not options.no_filesize:
        columns.append(Column("Size", True, lambda entry: format_size(entry, options)))
    if not options.no_time:
        titles = {"modified": "Date Modified", "changed": "Date Changed", "accessed": "Date Accessed", "created": "Date Created"}
        for kind in options.time_fields:
            columns.append(Column(titles[kind], False, lambda entry, current=kind: timestamp(entry, current, options.time_style)))
    if options.flags:
        columns.append(Column("Flags", False, flag_text))
    return columns


def render_long(rows: list[tuple[Entry, str]], options: Options) -> str:
    columns = columns_for(options)
    values: list[list[str]] = []
    widths = [display_width(column.title) if options.header else 0 for column in columns]
    for entry, _ in rows:
        current = [column.value(entry) for column in columns]  # type: ignore[operator]
        values.append(current)
        widths = [max(width, display_width(value)) for width, value in zip(widths, current)]
    lines: list[str] = []
    if options.header:
        header = []
        for column, width in zip(columns, widths):
            header.append(column.title.rjust(width) if column.align_right else column.title.ljust(width))
        header.append("Name")
        lines.append(" ".join(header))
    for (entry, name), current in zip(rows, values):
        cells = []
        for column, width, value in zip(columns, widths, current):
            padding = width - display_width(value)
            cells.append((" " * padding + value) if column.align_right else (value + " " * padding))
        cells.append(name)
        lines.append(" ".join(cells) if columns else name)
    return "".join(line + "\n" for line in lines)


def render_grid(entries: list[Entry], options: Options) -> str:
    names = [displayed_name(entry, options) for entry in entries]
    if not names:
        return ""
    if options.force_lines or options.width is None:
        return "".join(name + "\n" for name in names)
    width = options.width
    count = len(names)
    chosen_columns = 1
    chosen_rows = count
    chosen_widths = [max(display_width(name) for name in names)]
    for columns in range(2, count + 1):
        rows = math.ceil(count / columns)
        col_widths: list[int] = []
        for column in range(columns):
            if options.across:
                values = [names[row * columns + column] for row in range(rows) if row * columns + column < count]
            else:
                values = names[column * rows : min((column + 1) * rows, count)]
            col_widths.append(max((display_width(value) for value in values), default=0))
        if sum(col_widths) + 2 * (columns - 1) <= width:
            chosen_columns, chosen_rows, chosen_widths = columns, rows, col_widths
        else:
            break
    lines: list[str] = []
    for row in range(chosen_rows):
        cells: list[str] = []
        for column in range(chosen_columns):
            index = row * chosen_columns + column if options.across else column * chosen_rows + row
            if index >= count:
                continue
            value = names[index]
            has_later = any(
                (row * chosen_columns + later if options.across else later * chosen_rows + row) < count
                for later in range(column + 1, chosen_columns)
            )
            if has_later:
                value += " " * (chosen_widths[column] - display_width(value) + 2)
            cells.append(value)
        lines.append("".join(cells))
    return "".join(line + "\n" for line in lines)


def render_entries(entries: list[Entry], options: Options) -> str:
    if options.long:
        rows = [(entry, displayed_name(entry, options)) for entry in entries]
        return render_long(rows, options)
    return render_grid(entries, options)


def walk_tree(root: Entry, options: Options) -> tuple[list[tuple[Entry, str]], list[str], int]:
    rows: list[tuple[Entry, str]] = [(root, displayed_name(root, options, normalized_root(root.display)))]
    errors: list[str] = []
    status = 0

    def descend(directory: Entry, ancestors_last: list[bool], depth: int) -> None:
        nonlocal status
        if options.max_depth is not None and depth >= options.max_depth:
            return
        children, child_errors, child_status = list_children(directory.path, options)
        errors.extend(child_errors)
        status = max(status, child_status)
        for index, child in enumerate(children):
            last = index == len(children) - 1
            prefix = "".join("    " if was_last else "│   " for was_last in ancestors_last)
            branch = "└── " if last else "├── "
            rows.append((child, prefix + branch + displayed_name(child, options)))
            if child.is_dir and not child.synthetic and (not child.is_link or options.follow):
                descend(child, ancestors_last + [last], depth + 1)

    if root.is_dir:
        descend(root, [], 0)
    return rows, errors, status


def recurse_blocks(root: Entry, root_display: str, options: Options) -> tuple[list[tuple[str, list[Entry]]], list[str], int]:
    blocks: list[tuple[str, list[Entry]]] = []
    errors: list[str] = []
    status = 0

    def descend(directory: Entry, display: str, depth: int) -> None:
        nonlocal status
        if options.max_depth is not None and depth >= options.max_depth:
            return
        children, child_errors, child_status = list_children(directory.path, options)
        errors.extend(child_errors)
        status = max(status, child_status)
        blocks.append((display, children))
        for child in children:
            if child.is_dir and not child.synthetic and (not child.is_link or options.follow):
                descend(child, joined_display(display, child.name), depth + 1)

    descend(root, root_display, 0)
    return blocks, errors, status


def run(options: Options, path_args: list[str]) -> tuple[str, str, int]:
    if not path_args:
        if options.stdin:
            separator = os.environ.get("EZA_STDIN_SEPARATOR", "\n")
            path_args = [part for part in sys.stdin.read().split(separator) if part]
        else:
            path_args = ["."]

    direct: list[Entry] = []
    directories: list[tuple[Entry, str]] = []
    errors: list[str] = []
    status = 0
    for raw in path_args:
        actual = os.path.normpath(raw)
        try:
            display = normalized_root(raw) if options.dirs_as_files else direct_file_display(raw)
            entry = make_entry(actual, ntpath.basename(normalized_root(raw)) or raw, display, options)
        except OSError as error:
            message, code = error_for(raw, error)
            errors.append(message)
            status = max(status, code)
            continue
        if entry.is_dir and not options.dirs_as_files:
            directories.append((entry, raw))
        else:
            if options.only_dirs and not entry.is_dir and not (options.show_symlinks and entry.is_link):
                continue
            if options.only_files and entry.is_dir and not (options.show_symlinks and entry.is_link):
                continue
            direct.append(entry)

    output_parts: list[str] = []
    direct = sorted_entries(direct, options)
    if direct:
        output_parts.append(render_entries(direct, options).rstrip("\n"))

    if options.tree:
        for root, raw in directories:
            rows, tree_errors, tree_status = walk_tree(root, options)
            errors.extend(tree_errors)
            status = max(status, tree_status)
            rendered = render_long(rows, options) if options.long else "".join(name + "\n" for _, name in rows)
            output_parts.append(rendered.rstrip("\n"))
    elif options.recurse:
        for root, raw in directories:
            blocks, block_errors, block_status = recurse_blocks(root, raw, options)
            errors.extend(block_errors)
            status = max(status, block_status)
            for index, (heading, entries) in enumerate(blocks):
                body = render_entries(entries, options).rstrip("\n")
                if index == 0 and len(path_args) == 1 and not direct:
                    output_parts.append(body)
                else:
                    output_parts.append(heading + ":" + (("\n" + body) if body else ""))
    else:
        show_headings = len(directories) > 1 or bool(direct)
        for root, raw in directories:
            children, child_errors, child_status = list_children(root.path, options)
            errors.extend(child_errors)
            status = max(status, child_status)
            body = render_entries(children, options).rstrip("\n")
            if show_headings:
                output_parts.append(raw + ":" + (("\n" + body) if body else ""))
            else:
                output_parts.append(body)

    output = "\n\n".join(part for part in output_parts if part != "")
    if output:
        output += "\n"
    return output, "".join(errors), status


def main(argv: Sequence[str] | None = None) -> int:
    try:
        options, paths, immediate = parse_args(sys.argv[1:] if argv is None else argv)
    except OptionError as error:
        write_stderr(str(error))
        return 3
    if immediate == "help":
        write_stdout(HELP)
        return 0
    if immediate == "version":
        write_stdout(VERSION)
        return 0
    stdout, stderr, status = run(options, paths)
    if stdout:
        write_stdout(stdout)
    if stderr:
        write_stderr(stderr)
    return status


if __name__ == "__main__":
    raise SystemExit(main())
