from __future__ import annotations

import ctypes
import datetime as dt
import fnmatch
import functools
import math
import os
import re
import stat
import sys
from dataclasses import dataclass, field
from pathlib import Path


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
  -F, --classify=WHEN        display type indicator by file names (always, auto, never)
  --color=WHEN               when to use terminal colours (always, auto, never)
  --icons=WHEN               when to display icons (always, auto, never)
  --no-quotes                don't quote file names with spaces
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
  --group-directories-first  list directories before other files
  --group-directories-last   list directories after other files
  -I, --ignore-glob GLOBS    glob patterns (pipe-separated) of files to ignore

LONG VIEW OPTIONS
  -b, --binary               list file sizes with binary prefixes
  -B, --bytes                list file sizes in bytes
  -h, --header               add a header row
  -t, --time FIELD           which timestamp field to list
  -m, --modified             use the modified timestamp field
  -u, --accessed             use the accessed timestamp field
  -U, --created              use the created timestamp field
  --time-style STYLE         timestamp formatting style
  --no-permissions           suppress the permissions field
  --no-filesize              suppress the filesize field
  --no-time                  suppress the time field
"""


class OptionError(Exception):
    pass


@dataclass
class Options:
    mode: str = "auto"
    long: bool = False
    tree: bool = False
    recurse: bool = False
    across: bool = False
    all_count: int = 0
    treat_dirs_as_files: bool = False
    only_dirs: bool = False
    only_files: bool = False
    reverse: bool = False
    sort: str = "name"
    dirs_first: bool = False
    dirs_last: bool = False
    ignore_globs: list[str] = field(default_factory=list)
    level: int | None = None
    width: int | None = None
    no_quotes: bool = False
    classify: str = "never"
    size_format: str = "decimal"
    header: bool = False
    time_field: str = "modified"
    time_style: str = "default"
    permissions: bool = True
    filesize: bool = True
    show_time: bool = True
    stdin: bool = False


@dataclass
class Entry:
    path: Path
    name: str
    st: os.stat_result
    attrs: int
    is_dot_entry: bool = False

    @property
    def is_dir(self) -> bool:
        return stat.S_ISDIR(self.st.st_mode)

    @property
    def is_link(self) -> bool:
        return stat.S_ISLNK(self.st.st_mode) or bool(self.attrs & 0x400)

    @property
    def size(self) -> int:
        return self.st.st_size

    @property
    def extension(self) -> str:
        if self.name in (".", ".."):
            return ""
        return Path(self.name).suffix[1:]


def windows_attributes(path: Path) -> int:
    if os.name != "nt":
        return 0
    result = ctypes.windll.kernel32.GetFileAttributesW(str(path))
    return 0 if result == 0xFFFFFFFF else int(result)


def option_error(message: str) -> None:
    raise OptionError(message)


def parse_value(argv: list[str], index: int, option: str, attached: str | None) -> tuple[str, int]:
    if attached is not None:
        return attached, index
    if index + 1 >= len(argv):
        option_error(f"Option {option} requires an argument")
    return argv[index + 1], index + 1


def parse_args(argv: list[str]) -> tuple[Options, list[str], str | None]:
    options = Options()
    paths: list[str] = []
    action: str | None = None
    index = 0
    stop_options = False
    value_shorts = {"w", "s", "L", "I", "t"}

    while index < len(argv):
        arg = argv[index]
        if stop_options or arg == "-" or not arg.startswith("-"):
            paths.append(arg)
            index += 1
            continue
        if arg == "--":
            stop_options = True
            index += 1
            continue
        if arg.startswith("--"):
            key, equals, attached = arg.partition("=")
            value = attached if equals else None
            aliases = {"--colour": "--color"}
            key = aliases.get(key, key)
            if key == "--help":
                action = "help"
            elif key == "--version":
                action = "version"
            elif key == "--oneline":
                options.mode = "lines"
            elif key == "--long":
                options.long = True
                options.mode = "long"
            elif key == "--grid":
                options.mode = "grid"
            elif key == "--across":
                options.across = True
            elif key == "--recurse":
                options.recurse = True
            elif key == "--tree":
                options.tree = True
                options.recurse = True
                options.mode = "long" if options.long else "tree"
            elif key == "--all":
                options.all_count += 1
            elif key == "--almost-all":
                options.all_count = max(options.all_count, 1)
            elif key == "--treat-dirs-as-files":
                options.treat_dirs_as_files = True
            elif key == "--only-dirs":
                options.only_dirs = True
            elif key == "--only-files":
                options.only_files = True
            elif key == "--reverse":
                options.reverse = True
            elif key == "--group-directories-first":
                options.dirs_first = True
            elif key == "--group-directories-last":
                options.dirs_last = True
            elif key == "--no-quotes":
                options.no_quotes = True
            elif key == "--binary":
                options.size_format = "binary"
            elif key == "--bytes":
                options.size_format = "bytes"
            elif key == "--header":
                options.header = True
            elif key == "--modified":
                options.time_field = "modified"
            elif key == "--accessed":
                options.time_field = "accessed"
            elif key == "--created":
                options.time_field = "created"
            elif key == "--no-permissions":
                options.permissions = False
            elif key == "--no-filesize":
                options.filesize = False
            elif key == "--no-time":
                options.show_time = False
            elif key == "--stdin":
                options.stdin = True
            elif key in ("--color", "--icons"):
                value, index = parse_value(argv, index, key, value)
                if value not in ("always", "auto", "automatic", "never"):
                    option_error(f'Option {key} has no "{value}" setting')
            elif key == "--classify":
                value = value if value is not None else "always"
                if value not in ("always", "auto", "automatic", "never"):
                    option_error(f'Option --classify (-F) has no "{value}" setting')
                options.classify = value
            elif key == "--sort":
                value, index = parse_value(argv, index, "--sort (-s)", value)
                options.sort = validate_sort(value)
            elif key == "--width":
                value, index = parse_value(argv, index, "--width (-w)", value)
                options.width = parse_number(value, "--width (-w)")
            elif key == "--level":
                value, index = parse_value(argv, index, "--level (-L)", value)
                options.level = parse_number(value, "--level (-L)")
            elif key == "--ignore-glob":
                value, index = parse_value(argv, index, "--ignore-glob (-I)", value)
                options.ignore_globs.extend(value.split("|"))
            elif key == "--time":
                value, index = parse_value(argv, index, "--time (-t)", value)
                if value not in ("modified", "accessed", "created", "changed"):
                    option_error(f'Option --time (-t) has no "{value}" setting')
                options.time_field = value
            elif key == "--time-style":
                value, index = parse_value(argv, index, "--time-style", value)
                if value not in ("default", "iso", "long-iso", "full-iso", "relative") and not value.startswith("+"):
                    option_error(f'Option --time-style has no "{value}" setting')
                options.time_style = value
            elif key in ("--absolute", "--hyperlink", "--follow-symlinks", "--dereference"):
                if key == "--absolute" and value is None:
                    value = "on"
            else:
                option_error(f"Unknown argument {arg}")
            index += 1
            continue

        chars = arg[1:]
        position = 0
        while position < len(chars):
            char = chars[position]
            attached = chars[position + 1 :] if char in value_shorts and position + 1 < len(chars) else None
            if char == "?":
                action = "help"
            elif char == "v":
                action = "version"
            elif char == "1":
                options.mode = "lines"
            elif char == "l":
                options.long = True
                options.mode = "long"
            elif char == "G":
                options.mode = "grid"
            elif char == "x":
                options.across = True
            elif char == "R":
                options.recurse = True
            elif char == "T":
                options.tree = True
                options.recurse = True
                options.mode = "long" if options.long else "tree"
            elif char == "a":
                options.all_count += 1
            elif char == "A":
                options.all_count = max(options.all_count, 1)
            elif char == "d":
                options.treat_dirs_as_files = True
            elif char == "D":
                options.only_dirs = True
            elif char == "f":
                options.only_files = True
            elif char == "r":
                options.reverse = True
            elif char == "b":
                options.size_format = "binary"
            elif char == "B":
                options.size_format = "bytes"
            elif char == "h":
                options.header = True
            elif char == "m":
                options.time_field = "modified"
            elif char == "u":
                options.time_field = "accessed"
            elif char == "U":
                options.time_field = "created"
            elif char == "F":
                options.classify = "always"
            elif char in value_shorts:
                value, index = parse_value(argv, index, f"-{char}", attached)
                if char == "w":
                    options.width = parse_number(value, "--width (-w)")
                elif char == "s":
                    options.sort = validate_sort(value)
                elif char == "L":
                    options.level = parse_number(value, "--level (-L)")
                elif char == "I":
                    options.ignore_globs.extend(value.split("|"))
                elif char == "t":
                    if value not in ("modified", "accessed", "created", "changed"):
                        option_error(f'Option --time (-t) has no "{value}" setting')
                    options.time_field = value
                position = len(chars)
                continue
            else:
                option_error(f"Unknown argument -{char}")
            position += 1
        index += 1

    if options.tree:
        options.mode = "long" if options.long else "tree"
    return options, paths, action


def parse_number(value: str, option: str) -> int:
    try:
        return int(value)
    except ValueError:
        option_error(f'Value "{value}" not valid for option {option}: invalid digit found in string')
    raise AssertionError


def validate_sort(value: str) -> str:
    aliases = {
        "date": "modified",
        "time": "modified",
        "new": "modified",
        "newest": "modified",
        "old": "old",
        "oldest": "old",
        "age": "old",
        "mod": "modified",
        "cr": "created",
        "acc": "accessed",
        ".name": ".name",
        ".Name": ".Name",
    }
    value = aliases.get(value, value)
    choices = {
        "name", "Name", ".name", ".Name", "size", "extension", "Extension",
        "modified", "changed", "accessed", "created", "type", "none", "old",
    }
    if value not in choices:
        option_error(
            f'Option --sort (-s) has no "{value}" setting '
            "(choices: name, Name, size, extension, Extension, modified, changed, "
            "accessed, created, inode, type, none)"
        )
    return value


def entry_from_path(path: Path, name: str | None = None, dot: bool = False) -> Entry:
    stat_result = path.lstat()
    return Entry(path, name if name is not None else path.name, stat_result, windows_attributes(path), dot)


def is_hidden(entry: Entry) -> bool:
    return entry.name.startswith(".") or bool(entry.attrs & 0x2)


def directory_entries(path: Path, options: Options) -> list[Entry]:
    entries: list[Entry] = []
    if options.all_count >= 2:
        entries.append(entry_from_path(path, ".", True))
        entries.append(entry_from_path(path.parent, "..", True))
    with os.scandir(path) as iterator:
        for item in iterator:
            entry = entry_from_path(Path(item.path), item.name)
            if options.all_count == 0 and is_hidden(entry):
                continue
            if any(fnmatch.fnmatchcase(entry.name, pattern) for pattern in options.ignore_globs):
                continue
            if options.only_dirs and not entry.is_dir:
                continue
            if options.only_files and entry.is_dir:
                continue
            entries.append(entry)
    return sort_entries(entries, options)


def natural_parts(value: str, ignore_case: bool) -> list[object]:
    if ignore_case:
        value = value.lower()
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", value)]


def compare_entries(a: Entry, b: Entry, options: Options) -> int:
    sort = options.sort
    if sort == "none":
        result = 0
    elif sort in ("name", "Name", ".name", ".Name"):
        left = a.name[1:] if sort.startswith(".") and a.name.startswith(".") else a.name
        right = b.name[1:] if sort.startswith(".") and b.name.startswith(".") else b.name
        result = (natural_parts(left, sort in ("name", ".name")) > natural_parts(right, sort in ("name", ".name"))) - (
            natural_parts(left, sort in ("name", ".name")) < natural_parts(right, sort in ("name", ".name"))
        )
    elif sort in ("extension", "Extension"):
        left = a.extension.lower() if sort == "extension" else a.extension
        right = b.extension.lower() if sort == "extension" else b.extension
        if left != right:
            result = (left > right) - (left < right)
        else:
            result = compare_names(a.name, b.name, sort == "extension")
    elif sort == "size":
        result = (a.size > b.size) - (a.size < b.size)
    elif sort in ("modified", "accessed", "created", "changed", "old"):
        left = timestamp_for(a, sort if sort != "old" else "modified")
        right = timestamp_for(b, sort if sort != "old" else "modified")
        result = (left > right) - (left < right)
        if sort == "old":
            result = -result
    elif sort == "type":
        left = type_char(a)
        right = type_char(b)
        result = (left > right) - (left < right)
        if result == 0:
            result = compare_names(a.name, b.name, False)
    else:
        result = 0
    return -result if options.reverse else result


def compare_names(left: str, right: str, ignore_case: bool) -> int:
    left_parts = natural_parts(left, ignore_case)
    right_parts = natural_parts(right, ignore_case)
    return (left_parts > right_parts) - (left_parts < right_parts)


def sort_entries(entries: list[Entry], options: Options) -> list[Entry]:
    entries.sort(key=functools.cmp_to_key(lambda a, b: compare_entries(a, b, options)))
    if options.dirs_first:
        entries.sort(key=lambda item: not item.is_dir)
    elif options.dirs_last:
        entries.sort(key=lambda item: item.is_dir)
    return entries


def type_char(entry: Entry) -> str:
    if entry.is_link:
        return "l"
    if entry.is_dir:
        return "d"
    return "-"


def quote_name(name: str, options: Options) -> str:
    escaped = "".join(char if ord(char) >= 32 and ord(char) != 127 else char.encode("unicode_escape").decode() for char in name)
    if options.no_quotes or (" " not in escaped and "'" not in escaped):
        return escaped
    quote = '"' if "'" in escaped else "'"
    return f"{quote}{escaped}{quote}"


def display_name(entry: Entry, options: Options) -> str:
    name = quote_name(entry.name, options)
    if options.classify in ("always", "auto", "automatic"):
        if entry.is_dir:
            name += "/"
        elif entry.is_link:
            name += "@"
    return name


def timestamp_for(entry: Entry, field: str) -> float:
    if field == "accessed":
        return entry.st.st_atime
    if field == "created":
        return entry.st.st_ctime if os.name != "nt" else entry.st.st_ctime
    if field == "changed":
        return entry.st.st_ctime
    return entry.st.st_mtime


def current_fixed_offset() -> dt.timezone:
    local = dt.datetime.now().astimezone()
    return dt.timezone(local.utcoffset() or dt.timedelta())


def format_time(entry: Entry, options: Options) -> str:
    timestamp = timestamp_for(entry, options.time_field)
    moment = dt.datetime.fromtimestamp(timestamp, tz=dt.timezone.utc).astimezone(current_fixed_offset())
    now = dt.datetime.now(tz=current_fixed_offset())
    style = options.time_style
    if style == "long-iso":
        return moment.strftime("%Y-%m-%d %H:%M")
    if style == "full-iso":
        nanoseconds = int((timestamp - math.floor(timestamp)) * 1_000_000_000)
        return moment.strftime("%Y-%m-%d %H:%M:%S.") + f"{nanoseconds:09d} " + moment.strftime("%z")
    if style == "iso":
        if abs((now - moment).total_seconds()) < 15_778_476:
            return moment.strftime("%m-%d %H:%M")
        return moment.strftime("%Y-%m-%d") + " "
    if style == "relative":
        delta = now - moment
        seconds = int(abs(delta.total_seconds()))
        suffix = "ago" if delta.total_seconds() >= 0 else "from now"
        if seconds < 60:
            amount, unit = seconds, "second"
        elif seconds < 3600:
            amount, unit = seconds // 60, "minute"
        elif seconds < 86400:
            amount, unit = seconds // 3600, "hour"
        elif seconds < 2_592_000:
            amount, unit = seconds // 86400, "day"
        elif seconds < 31_536_000:
            amount, unit = seconds // 2_592_000, "month"
        else:
            amount, unit = seconds // 31_536_000, "year"
        return f"{amount} {unit}{'' if amount == 1 else 's'} {suffix}"
    if style.startswith("+"):
        return moment.strftime(style[1:])
    if abs((now - moment).total_seconds()) < 15_778_476:
        return f"{moment.day:2d} {moment.strftime('%b')} {moment.strftime('%H:%M')}"
    return f"{moment.day:2d} {moment.strftime('%b')}  {moment.year:04d}"


def grouped(number: int) -> str:
    return f"{number:,}"


def format_decimal_size(size: int) -> str:
    if size < 1000:
        return grouped(size)
    prefixes = ["k", "M", "G", "T", "P", "E"]
    exponent = min(int(math.log(size, 1000)), len(prefixes))
    divisor = 1000 ** exponent
    value = size / divisor
    prefix = prefixes[exponent - 1]
    if value < 10:
        return f"{value:.1f}{prefix}"
    if value < 100:
        return f"{value:.0f}{prefix}" if size % divisor == 0 else f"{value:.1f}{prefix}"
    return f"{grouped(round(value))}{prefix}"


def format_binary_size(size: int) -> str:
    if size < 1024:
        return grouped(size)
    prefixes = ["Ki", "Mi", "Gi", "Ti", "Pi", "Ei"]
    exponent = min(int(math.log(size, 1024)), len(prefixes))
    divisor = 1024 ** exponent
    value = size / divisor
    prefix = prefixes[exponent - 1]
    if value < 10:
        return f"{value:.1f}{prefix}"
    return f"{value:.0f}{prefix}"


def format_size(entry: Entry, options: Options) -> str:
    if entry.is_dir:
        return "-"
    if options.size_format == "bytes":
        return grouped(entry.size)
    if options.size_format == "binary":
        return format_binary_size(entry.size)
    return format_decimal_size(entry.size)


def mode_string(entry: Entry) -> str:
    attrs = entry.attrs
    return (
        type_char(entry)
        + ("a" if attrs & 0x20 else "-")
        + ("r" if attrs & 0x1 else "-")
        + ("h" if attrs & 0x2 else "-")
        + ("s" if attrs & 0x4 else "-")
    )


def render_lines(entries: list[Entry], options: Options) -> str:
    return "".join(display_name(entry, options) + "\n" for entry in entries)


def render_grid(entries: list[Entry], options: Options) -> str:
    names = [display_name(entry, options) for entry in entries]
    if not names:
        return ""
    width = options.width or 80
    for columns in range(len(names), 0, -1):
        rows = math.ceil(len(names) / columns)
        matrix: list[list[str]] = []
        for row in range(rows):
            line = []
            for column in range(columns):
                index = row * columns + column if options.across else column * rows + row
                if index < len(names):
                    line.append(names[index])
            matrix.append(line)
        column_widths = []
        for column in range(columns):
            values = []
            for row in range(rows):
                index = row * columns + column if options.across else column * rows + row
                if index < len(names):
                    values.append(len(names[index]))
            column_widths.append(max(values, default=0))
        required = sum(column_widths) + 2 * (columns - 1)
        if required <= width:
            output = []
            for line in matrix:
                pieces = []
                for column, value in enumerate(line):
                    if column == len(line) - 1:
                        pieces.append(value)
                    else:
                        pieces.append(value.ljust(column_widths[column] + 2))
                output.append("".join(pieces).rstrip())
            return "\n".join(output) + "\n"
    return render_lines(entries, options)


def table_columns(options: Options) -> list[str]:
    columns = []
    if options.permissions:
        columns.append("mode")
    if options.filesize:
        columns.append("size")
    if options.show_time:
        columns.append("time")
    return columns


def render_long(entries: list[Entry], options: Options, prefixes: list[str] | None = None) -> str:
    if not entries:
        return ""
    columns = table_columns(options)
    rows: list[tuple[list[str], str]] = []
    if options.header:
        header_values = {"mode": "Mode", "size": "Size", "time": header_time(options)}
        rows.append(([header_values[column] for column in columns], "Name"))
    for index, entry in enumerate(entries):
        values = {"mode": mode_string(entry), "size": format_size(entry, options), "time": format_time(entry, options)}
        name = display_name(entry, options)
        if prefixes is not None:
            name = prefixes[index] + name
        rows.append(([values[column] for column in columns], name))
    widths = [max(len(row[0][column]) for row in rows) for column in range(len(columns))]
    output = []
    for row_index, (cells, name) in enumerate(rows):
        rendered = []
        for index, (column, cell) in enumerate(zip(columns, cells)):
            if column == "size":
                rendered.append(cell.rjust(widths[index]))
            else:
                rendered.append(cell.ljust(widths[index]))
        output.append(" ".join(rendered) + (" " if rendered else "") + name)
    return "\n".join(output) + "\n"


def header_time(options: Options) -> str:
    return {
        "modified": "Date Modified",
        "accessed": "Date Accessed",
        "created": "Date Created",
        "changed": "Date Changed",
    }.get(options.time_field, "Date Modified")


def tree_walk(root: Entry, options: Options) -> tuple[list[Entry], list[str]]:
    entries = [root]
    prefixes = [""]

    def visit(directory: Entry, depth: int, active_lines: list[bool]) -> None:
        if options.level is not None and depth > options.level:
            return
        children = directory_entries(directory.path, options)
        for index, child in enumerate(children):
            last = index == len(children) - 1
            prefix = "".join("│   " if active else "    " for active in active_lines)
            prefix += "└── " if last else "├── "
            entries.append(child)
            prefixes.append(prefix)
            if child.is_dir and not child.is_dot_entry:
                visit(child, depth + 1, active_lines + [not last])

    visit(root, 1, [])
    return entries, prefixes


def format_os_error(path_text: str, error: OSError) -> str:
    if os.name == "nt":
        code = error.winerror or error.errno or 2
        message = ctypes.FormatError(code).strip()
        return f'"{path_text}": {message} (os error {code})\n'
    return f'"{path_text}": {error.strerror} (os error {error.errno})\n'


def render_directory(path: Path, options: Options) -> str:
    entries = directory_entries(path, options)
    if options.mode == "long":
        return render_long(entries, options)
    if options.mode == "grid":
        return render_grid(entries, options)
    return render_lines(entries, options)


def run(options: Options, path_args: list[str]) -> int:
    if not path_args:
        if options.stdin:
            separator = os.environ.get("EZA_STDIN_SEPARATOR", "\n")
            path_args = [item for item in sys.stdin.read().split(separator) if item]
        else:
            path_args = ["."]

    files: list[Entry] = []
    directories: list[tuple[str, Entry]] = []
    status = 0
    for path_text in path_args:
        path = Path(path_text)
        try:
            entry = entry_from_path(path, path.name or path_text)
        except OSError as error:
            sys.stderr.buffer.write(format_os_error(path_text, error).encode("utf-8"))
            status = 2
            continue
        if entry.is_dir and not options.treat_dirs_as_files:
            directories.append((path_text, entry))
        else:
            if not any(fnmatch.fnmatchcase(entry.name, pattern) for pattern in options.ignore_globs):
                files.append(entry)

    files = sort_entries(files, options)
    output_parts: list[str] = []
    if files:
        if options.mode == "long":
            output_parts.append(render_long(files, options))
        elif options.mode == "grid":
            output_parts.append(render_grid(files, options))
        else:
            output_parts.append(render_lines(files, options))

    no_files = not files
    only_dir = len(directories) == 1 and no_files
    for path_text, directory in directories:
        if output_parts:
            output_parts.append("\n")
        if options.tree:
            tree_entries, prefixes = tree_walk(directory, options)
            if options.long:
                output_parts.append(render_long(tree_entries, options, prefixes))
            else:
                output_parts.append("".join(prefix + display_name(entry, options) + "\n" for entry, prefix in zip(tree_entries, prefixes)))
            continue
        if not only_dir:
            output_parts.append(quote_name(path_text, options) + ":\n")
        output_parts.append(render_directory(directory.path, options))
        if options.recurse:
            output_parts.append(render_recursive(directory.path, options, 1))

    sys.stdout.buffer.write("".join(output_parts).encode("utf-8", "surrogateescape"))
    return status


def render_recursive(path: Path, options: Options, depth: int) -> str:
    if options.level is not None and depth > options.level:
        return ""
    parent_entries = directory_entries(path, options)
    child_dirs = [entry for entry in parent_entries if entry.is_dir and not entry.is_dot_entry]
    output = []
    for child in child_dirs:
        output.append("\n")
        output.append(f"{child.path}:\n")
        output.append(render_directory(child.path, options))
        output.append(render_recursive(child.path, options, depth + 1))
    return "".join(output)


def main() -> int:
    try:
        options, paths, action = parse_args(sys.argv[1:])
    except OptionError as error:
        sys.stderr.buffer.write(f"eza: {error}\n".encode("utf-8"))
        return 3
    if action == "help":
        sys.stdout.buffer.write(HELP.encode("utf-8"))
        return 0
    if action == "version":
        sys.stdout.buffer.write(VERSION.encode("utf-8"))
        return 0
    if options.mode == "auto":
        options.mode = "grid" if sys.stdout.isatty() else "lines"
    try:
        return run(options, paths)
    except BrokenPipeError:
        return 0
    except OSError as error:
        sys.stderr.buffer.write((str(error) + "\n").encode("utf-8", "replace"))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
