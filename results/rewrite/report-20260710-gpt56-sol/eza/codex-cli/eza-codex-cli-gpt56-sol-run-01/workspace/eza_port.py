from __future__ import annotations

import ctypes
import datetime as dt
import fnmatch
import os
import re
import sys
from dataclasses import dataclass, field
from functools import cmp_to_key
from pathlib import Path


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


class OptionError(Exception):
    pass


@dataclass
class Options:
    paths: list[str] = field(default_factory=list)
    long: bool = False
    tree: bool = False
    recurse: bool = False
    grid: bool = False
    oneline: bool = False
    across: bool = False
    all_count: int = 0
    almost_all: bool = False
    treat_dirs_as_files: bool = False
    only_dirs: bool = False
    only_files: bool = False
    no_symlinks: bool = False
    show_symlinks: bool = False
    follow_symlinks: bool = False
    dereference: bool = False
    level: int | None = None
    reverse: bool = False
    sort: str = "name"
    dirs_first: bool = False
    dirs_last: bool = False
    ignore_globs: list[str] = field(default_factory=list)
    no_quotes: bool = False
    classify: str = "never"
    width: int | None = None
    header: bool = False
    bytes: bool = False
    binary: bool = False
    no_permissions: bool = False
    no_filesize: bool = False
    no_time: bool = False
    file_flags: bool = False
    time_fields: list[str] = field(default_factory=list)
    time_style: str = "default"
    stdin: bool = False
    view_events: list[str] = field(default_factory=list)

    @property
    def show_dotfiles(self) -> bool:
        return self.almost_all or self.all_count > 0

    @property
    def show_dots(self) -> bool:
        return self.all_count > 1


@dataclass
class Entry:
    path: str
    name: str
    stat: os.stat_result
    is_dot_entry: bool = False

    @property
    def is_symlink(self) -> bool:
        return bool(getattr(self.stat, "st_file_attributes", 0) & 0x400) or os.path.islink(self.path)

    @property
    def is_dir(self) -> bool:
        if self.is_symlink:
            return False
        return bool(getattr(self.stat, "st_file_attributes", 0) & 0x10) or os.path.isdir(self.path)

    @property
    def points_to_dir(self) -> bool:
        return self.is_dir or (self.is_symlink and os.path.isdir(self.path))

    @property
    def is_file(self) -> bool:
        return not self.is_dir and not self.is_symlink

    @property
    def extension(self) -> str | None:
        pos = self.name.rfind(".")
        return self.name[pos + 1 :].lower() if pos >= 0 else None

    @property
    def attributes(self) -> int:
        return int(getattr(self.stat, "st_file_attributes", 0))


def write_stdout(text: str) -> None:
    sys.stdout.buffer.write(text.encode("utf-8", "surrogatepass"))


def write_stderr(text: str) -> None:
    sys.stderr.buffer.write(text.encode("utf-8", "surrogatepass"))


def parse_optional_long(argv: list[str], index: int, default: str) -> tuple[str, int]:
    arg = argv[index]
    if "=" in arg:
        return arg.split("=", 1)[1], index
    if index + 1 < len(argv) and not argv[index + 1].startswith("-"):
        return argv[index + 1], index + 1
    return default, index


def required_value(argv: list[str], index: int, name: str) -> tuple[str, int]:
    arg = argv[index]
    if "=" in arg:
        return arg.split("=", 1)[1], index
    if index + 1 >= len(argv):
        raise OptionError(f"Option --{name} needs a value")
    return argv[index + 1], index + 1


def set_short_flag(opts: Options, char: str) -> None:
    if char == "1":
        opts.oneline = True
        opts.view_events.append("lines")
    elif char == "l":
        opts.long = True
        opts.view_events.append("long")
    elif char == "G":
        opts.grid = True
        opts.view_events.append("grid")
    elif char == "x":
        opts.across = True
    elif char == "R":
        opts.recurse = True
    elif char == "T":
        opts.tree = True
        opts.view_events.append("tree")
    elif char == "X":
        opts.dereference = True
    elif char == "a":
        opts.all_count += 1
    elif char == "A":
        opts.almost_all = True
    elif char == "d":
        opts.treat_dirs_as_files = True
    elif char == "D":
        opts.only_dirs = True
    elif char == "f":
        opts.only_files = True
    elif char == "r":
        opts.reverse = True
    elif char == "b":
        opts.binary = True
        opts.bytes = False
    elif char == "B":
        opts.bytes = True
        opts.binary = False
    elif char == "h":
        opts.header = True
    elif char == "O":
        opts.file_flags = True
    elif char == "m":
        opts.time_fields.append("modified")
    elif char == "u":
        opts.time_fields.append("accessed")
    elif char == "U":
        opts.time_fields.append("created")
    elif char in {"g", "H", "i", "M", "n", "S", "o", "@", "Z"}:
        return
    elif char == "?":
        raise SystemExit("help")
    elif char == "v":
        raise SystemExit("version")
    else:
        raise OptionError(f"Unknown argument -{char}")


def parse_args(argv: list[str]) -> Options:
    opts = Options()
    index = 0
    positional = False
    while index < len(argv):
        arg = argv[index]
        if positional or arg == "-" or not arg.startswith("-"):
            opts.paths.append(arg)
            index += 1
            continue
        if arg == "--":
            positional = True
            index += 1
            continue
        if arg.startswith("--"):
            name = arg[2:].split("=", 1)[0]
            if name == "help":
                raise SystemExit("help")
            if name == "version":
                raise SystemExit("version")
            if name in {"color", "colour", "icons", "classify", "absolute"}:
                value, index = parse_optional_long(argv, index, "auto" if name != "absolute" else "on")
                if name == "classify":
                    opts.classify = value
            elif name in {"color-scale", "colour-scale"}:
                _, index = parse_optional_long(argv, index, "all")
            elif name in {
                "sort",
                "level",
                "ignore-glob",
                "width",
                "time",
                "time-style",
                "color-scale-mode",
                "colour-scale-mode",
            }:
                value, index = required_value(argv, index, name)
                if name == "sort":
                    opts.sort = value
                elif name == "level":
                    try:
                        opts.level = int(value)
                    except ValueError as error:
                        raise OptionError(
                            f'Value "{value}" not valid for option --level (-L): invalid digit found in string'
                        ) from error
                elif name == "ignore-glob":
                    opts.ignore_globs = value.split("|")
                elif name == "width":
                    try:
                        opts.width = int(value)
                    except ValueError as error:
                        raise OptionError(
                            f'Value "{value}" not valid for option --width (-w): invalid digit found in string'
                        ) from error
                elif name == "time":
                    opts.time_fields.append(normalize_time_field(value))
                elif name == "time-style":
                    opts.time_style = value
            elif name in {"oneline"}:
                opts.oneline = True
                opts.view_events.append("lines")
            elif name == "long":
                opts.long = True
                opts.view_events.append("long")
            elif name == "grid":
                opts.grid = True
                opts.view_events.append("grid")
            elif name == "tree":
                opts.tree = True
                opts.view_events.append("tree")
            elif name == "recurse":
                opts.recurse = True
            elif name == "across":
                opts.across = True
            elif name in {"all"}:
                opts.all_count += 1
            elif name == "almost-all":
                opts.almost_all = True
            elif name in {"treat-dirs-as-files", "list-dirs"}:
                opts.treat_dirs_as_files = True
            elif name == "only-dirs":
                opts.only_dirs = True
            elif name == "only-files":
                opts.only_files = True
            elif name == "show-symlinks":
                opts.show_symlinks = True
            elif name == "no-symlinks":
                opts.no_symlinks = True
            elif name == "follow-symlinks":
                opts.follow_symlinks = True
            elif name == "dereference":
                opts.dereference = True
            elif name == "reverse":
                opts.reverse = True
            elif name == "group-directories-first":
                opts.dirs_first = True
            elif name == "group-directories-last":
                opts.dirs_last = True
            elif name == "no-quotes":
                opts.no_quotes = True
            elif name == "header":
                opts.header = True
            elif name == "binary":
                opts.binary = True
                opts.bytes = False
            elif name == "bytes":
                opts.bytes = True
                opts.binary = False
            elif name == "no-permissions":
                opts.no_permissions = True
            elif name == "no-filesize":
                opts.no_filesize = True
            elif name == "no-time":
                opts.no_time = True
            elif name == "flags":
                opts.file_flags = True
            elif name == "modified":
                opts.time_fields.append("modified")
            elif name == "accessed":
                opts.time_fields.append("accessed")
            elif name == "created":
                opts.time_fields.append("created")
            elif name == "changed":
                opts.time_fields.append("changed")
            elif name == "stdin":
                opts.stdin = True
            elif name in {
                "no-user",
                "group",
                "smart-group",
                "links",
                "inode",
                "mounts",
                "numeric",
                "blocksize",
                "octal-permissions",
                "git",
                "no-git",
                "git-repos",
                "git-repos-no-status",
                "git-ignore",
                "extended",
                "context",
                "hyperlink",
                "total-size",
            }:
                pass
            else:
                raise OptionError(f"Unknown argument --{name}")
            index += 1
            continue

        cluster = arg[1:]
        position = 0
        while position < len(cluster):
            char = cluster[position]
            if char in {"L", "s", "I", "w", "t"}:
                value = cluster[position + 1 :]
                if value.startswith("="):
                    value = value[1:]
                if not value:
                    if index + 1 >= len(argv):
                        raise OptionError(f"Option -{char} needs a value")
                    index += 1
                    value = argv[index]
                if char == "L":
                    try:
                        opts.level = int(value)
                    except ValueError as error:
                        raise OptionError(
                            f'Value "{value}" not valid for option --level (-L): invalid digit found in string'
                        ) from error
                elif char == "s":
                    opts.sort = value
                elif char == "I":
                    opts.ignore_globs = value.split("|")
                elif char == "w":
                    opts.width = int(value)
                elif char == "t":
                    opts.time_fields.append(normalize_time_field(value))
                position = len(cluster)
                continue
            if char == "F":
                value = cluster[position + 1 :]
                if value.startswith("="):
                    value = value[1:]
                opts.classify = value or "auto"
                position = len(cluster)
                continue
            set_short_flag(opts, char)
            position += 1
        index += 1
    return opts


def normalize_time_field(value: str) -> str:
    aliases = {
        "mod": "modified",
        "modified": "modified",
        "ch": "changed",
        "changed": "changed",
        "acc": "accessed",
        "accessed": "accessed",
        "cr": "created",
        "created": "created",
    }
    if value not in aliases:
        raise OptionError(f"Invalid value for --time: {value}")
    return aliases[value]


def rust_debug_path(path: str) -> str:
    escaped = path.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def windows_error_message(code: int) -> str:
    if os.name != "nt":
        return os.strerror(code)
    buffer = ctypes.create_unicode_buffer(2048)
    length = ctypes.windll.kernel32.FormatMessageW(
        0x00001000 | 0x00000200,
        None,
        code,
        0,
        buffer,
        len(buffer),
        None,
    )
    if length:
        return buffer.value.rstrip("\r\n ")
    return os.strerror(code)


def stat_entry(path: str, name: str | None = None, is_dot_entry: bool = False) -> Entry:
    stat = os.stat(path, follow_symlinks=False)
    if name is None:
        stripped = path.rstrip("\\/")
        name = os.path.basename(stripped) or path
    return Entry(path=path, name=name, stat=stat, is_dot_entry=is_dot_entry)


def read_directory(path: str, opts: Options) -> list[Entry]:
    entries: list[Entry] = []
    if opts.show_dots:
        entries.append(stat_entry(path, ".", True))
        parent = os.path.abspath(os.path.join(path, os.pardir))
        entries.append(stat_entry(parent, "..", True))
    with os.scandir(path) as iterator:
        for item in iterator:
            name = item.name
            if not opts.show_dotfiles and (name.startswith(".") or name.startswith("_")):
                continue
            if any(fnmatch.fnmatchcase(name, pattern) for pattern in opts.ignore_globs):
                continue
            try:
                entry = stat_entry(item.path, name)
            except OSError:
                continue
            if not opts.show_dotfiles and entry.attributes & 0x2:
                continue
            if not child_filter(entry, opts):
                continue
            entries.append(entry)
    return sort_entries(entries, opts)


def child_filter(entry: Entry, opts: Options) -> bool:
    if opts.no_symlinks and entry.is_symlink:
        return False
    if opts.only_dirs and not opts.only_files:
        return entry.is_dir or (opts.show_symlinks and entry.points_to_dir)
    if opts.only_files and not opts.only_dirs and not opts.recurse and not opts.tree:
        return entry.is_file or (opts.show_symlinks and entry.is_symlink and not entry.points_to_dir)
    return True


def natural_parts(value: str, ignore_case: bool) -> list[tuple[int, object]]:
    if ignore_case:
        value = value.lower()
    value = "".join(char for char in value if not char.isspace())
    parts: list[tuple[int, object]] = []
    for part in re.split(r"(\d+)", value):
        if not part:
            continue
        if part.isdigit():
            parts.append((1, int(part)))
        else:
            parts.append((0, part))
    return parts


def natural_compare(left: str, right: str, ignore_case: bool) -> int:
    a = natural_parts(left, ignore_case)
    b = natural_parts(right, ignore_case)
    for first, second in zip(a, b):
        if first == second:
            continue
        return -1 if first < second else 1
    if len(a) == len(b):
        return 0
    return -1 if len(a) < len(b) else 1


def compare_entries(left: Entry, right: Entry, opts: Options) -> int:
    sort = opts.sort
    if sort in {"none"}:
        return 0
    if sort in {"name", "filename"}:
        return natural_compare(left.name, right.name, True)
    if sort in {"Name", "Filename"}:
        return natural_compare(left.name, right.name, False)
    if sort in {".name", ".filename"}:
        return natural_compare(left.name.removeprefix("."), right.name.removeprefix("."), True)
    if sort in {".Name", ".Filename"}:
        return natural_compare(left.name.removeprefix("."), right.name.removeprefix("."), False)
    if sort in {"ext", "extension", "Ext", "Extension"}:
        first = left.extension
        second = right.extension
        if first != second:
            if first is None:
                return -1
            if second is None:
                return 1
            return -1 if first < second else 1
        return natural_compare(left.name, right.name, sort in {"ext", "extension"})
    if sort in {"size", "filesize"}:
        return (left.stat.st_size > right.stat.st_size) - (left.stat.st_size < right.stat.st_size)
    if sort in {"date", "time", "mod", "modified", "new", "newest", "ch", "changed"}:
        return (left.stat.st_mtime > right.stat.st_mtime) - (left.stat.st_mtime < right.stat.st_mtime)
    if sort in {"age", "old", "oldest"}:
        return (right.stat.st_mtime > left.stat.st_mtime) - (right.stat.st_mtime < left.stat.st_mtime)
    if sort in {"acc", "accessed"}:
        return (left.stat.st_atime > right.stat.st_atime) - (left.stat.st_atime < right.stat.st_atime)
    if sort in {"cr", "created"}:
        return (left.stat.st_ctime > right.stat.st_ctime) - (left.stat.st_ctime < right.stat.st_ctime)
    if sort == "type":
        type_left = 0 if left.is_dir else 1 if left.is_file else 7
        type_right = 0 if right.is_dir else 1 if right.is_file else 7
        if type_left != type_right:
            return -1 if type_left < type_right else 1
        return natural_compare(left.name, right.name, False)
    raise OptionError(
        f'Option --sort (-s) has no "{sort}" setting '
        "(choices: name, Name, size, extension, Extension, modified, changed, "
        "accessed, created, inode, type, none)"
    )


def sort_entries(entries: list[Entry], opts: Options) -> list[Entry]:
    entries.sort(key=cmp_to_key(lambda left, right: compare_entries(left, right, opts)))
    if opts.reverse:
        entries.reverse()
    if opts.dirs_first:
        entries.sort(key=lambda entry: not entry.points_to_dir)
    elif opts.dirs_last:
        entries.sort(key=lambda entry: entry.points_to_dir)
    return entries


def quote_name(name: str, opts: Options) -> str:
    if opts.no_quotes:
        return name
    if not any(char.isspace() for char in name) and "'" not in name and '"' not in name:
        return name
    if "'" not in name:
        return f"'{name}'"
    escaped = name.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def display_name(entry: Entry, opts: Options, argument: bool = False) -> str:
    name = entry.path if argument else entry.name
    rendered = quote_name(name, opts)
    if entry.is_symlink:
        try:
            target = os.readlink(entry.path)
            rendered += f" -> {quote_name(target, opts)}"
        except OSError:
            pass
    if opts.classify == "always":
        if entry.points_to_dir:
            rendered += "/"
        elif entry.is_symlink:
            rendered += "@"
    return rendered


def permission_string(entry: Entry) -> str:
    attrs = entry.attributes
    type_char = "l" if attrs & 0x400 or entry.is_symlink else "d" if attrs & 0x10 or entry.is_dir else "-"
    return "".join(
        [
            type_char,
            "a" if attrs & 0x20 else "-",
            "r" if attrs & 0x1 else "-",
            "h" if attrs & 0x2 else "-",
            "s" if attrs & 0x4 else "-",
        ]
    )


def decimal_size(size: int) -> str:
    if size < 1000:
        return f"{size:,}"
    prefixes = ["k", "M", "G", "T", "P", "E"]
    value = float(size)
    prefix = prefixes[0]
    for prefix in prefixes:
        value /= 1000.0
        if value < 1000.0:
            break
    if value < 10:
        return f"{value:.1f}{prefix}"
    if value < 100:
        rounded = round(value, 1)
        if rounded.is_integer():
            return f"{int(rounded):,}{prefix}"
        return f"{rounded:.1f}{prefix}"
    return f"{round(value):,}{prefix}"


def binary_size(size: int) -> str:
    if size < 1024:
        return f"{size:,}"
    prefixes = ["Ki", "Mi", "Gi", "Ti", "Pi", "Ei"]
    value = float(size)
    prefix = prefixes[0]
    for prefix in prefixes:
        value /= 1024.0
        if value < 1024.0:
            break
    if value < 10:
        return f"{value:.1f}{prefix}"
    return f"{round(value):,}{prefix}"


def size_string(entry: Entry, opts: Options) -> str:
    if entry.is_dir:
        return "-"
    size = entry.stat.st_size
    if opts.bytes:
        return f"{size:,}"
    if opts.binary:
        return binary_size(size)
    return decimal_size(size)


def entry_timestamp(entry: Entry, field: str) -> int:
    if field in {"modified", "changed"}:
        return entry.stat.st_mtime_ns
    if field == "accessed":
        return entry.stat.st_atime_ns
    return entry.stat.st_ctime_ns


def time_string(timestamp_ns: int, style: str) -> str:
    timestamp = timestamp_ns / 1_000_000_000
    current_offset = dt.datetime.now().astimezone().utcoffset() or dt.timedelta()
    moment = dt.datetime.fromtimestamp(timestamp, dt.UTC).replace(tzinfo=None) + current_offset
    if style == "long-iso":
        return moment.strftime("%Y-%m-%d %H:%M")
    if style == "full-iso":
        offset = dt.datetime.now().astimezone().strftime("%z")
        nanos = timestamp_ns % 1_000_000_000
        return f"{moment:%Y-%m-%d %H:%M:%S}.{nanos:09d} {offset}"
    if style == "iso":
        if moment.year == dt.datetime.now().year:
            return moment.strftime("%m-%d %H:%M")
        return moment.strftime("%Y-%m-%d")
    if style.startswith("+"):
        formats = style[1:].splitlines()
        selected = formats[1] if len(formats) > 1 and moment.year == dt.datetime.now().year else formats[0]
        return moment.strftime(selected)
    if style == "relative":
        return relative_time(timestamp)
    if moment.year == dt.datetime.now().year:
        return f"{moment.day:2d} {moment:%b %H:%M}"
    return f"{moment.day:2d} {moment:%b}  {moment.year:04d}"


def relative_time(timestamp: float) -> str:
    seconds = max(0, int(dt.datetime.now().timestamp() - timestamp))
    if seconds < 60:
        return "now"
    if seconds < 3600:
        return f"{seconds // 60}m"
    if seconds < 86400:
        return f"{seconds // 3600}h"
    if seconds < 31_536_000:
        return f"{seconds // 86400}d"
    return f"{seconds // 31_536_000}y"


def flag_string(entry: Entry) -> str:
    attrs = entry.attributes
    attributes = [
        (0x1, "readonly"),
        (0x2, "hidden"),
        (0x4, "system"),
        (0x20, "archive"),
        (0x100, "temporary"),
        (0x800, "compressed"),
        (0x1000, "offline"),
        (0x2000, "not indexed"),
        (0x4000, "encrypted"),
        (0x20000, "no scrub"),
        (0x100000, "unpinned"),
        (0x80000, "pinned"),
        (0x400000, "recall on data access"),
    ]
    names = [name for flag, name in attributes if attrs & flag]
    return "-".join(names) if names else "-"


def long_columns(entry: Entry, opts: Options) -> list[str]:
    columns = []
    if not opts.no_permissions:
        columns.append(permission_string(entry))
    if not opts.no_filesize:
        columns.append(size_string(entry, opts))
    if opts.file_flags:
        columns.append(flag_string(entry))
    if not opts.no_time:
        selected = set(opts.time_fields)
        fields = [field for field in ["modified", "changed", "created", "accessed"] if field in selected]
        if not fields:
            fields = ["modified"]
        columns.extend(time_string(entry_timestamp(entry, field), opts.time_style) for field in fields)
    return columns


def long_headers(opts: Options) -> list[str]:
    headers = []
    if not opts.no_permissions:
        headers.append("Mode")
    if not opts.no_filesize:
        headers.append("Size")
    if opts.file_flags:
        headers.append("Flags")
    if not opts.no_time:
        selected = set(opts.time_fields)
        fields = [field for field in ["modified", "changed", "created", "accessed"] if field in selected]
        if not fields:
            fields = ["modified"]
        labels = {
            "modified": "Date Modified",
            "changed": "Date Changed",
            "accessed": "Date Accessed",
            "created": "Date Created",
        }
        headers.extend(labels[field] for field in fields)
    return headers


def render_table(rows: list[tuple[Entry, str]], opts: Options) -> str:
    data = [long_columns(entry, opts) for entry, _ in rows]
    headers = long_headers(opts)
    widths = [0] * len(headers)
    for cells in data:
        for index, cell in enumerate(cells):
            widths[index] = max(widths[index], len(cell))
    if opts.header:
        for index, header in enumerate(headers):
            widths[index] = max(widths[index], len(header))

    def format_cells(cells: list[str], header: bool = False) -> str:
        rendered = []
        for index, cell in enumerate(cells):
            right = not header and index < len(headers) and headers[index] == "Size"
            rendered.append(cell.rjust(widths[index]) if right else cell.ljust(widths[index]))
        return " ".join(rendered)

    output = []
    if opts.header:
        prefix = format_cells(headers, True)
        output.append(f"{prefix} Name" if prefix else "Name")
    for (entry, name), cells in zip(rows, data):
        prefix = format_cells(cells)
        output.append(f"{prefix} {name}" if prefix else name)
    return "".join(line + "\n" for line in output)


def render_grid_details(entries: list[Entry], opts: Options, argument: bool = False) -> str:
    entries = sort_entries(entries, opts)
    data = [long_columns(entry, opts) for entry in entries]
    headers = long_headers(opts)
    widths = [0] * len(headers)
    for cells in data:
        for index, cell in enumerate(cells):
            widths[index] = max(widths[index], len(cell))

    def format_cells(cells: list[str]) -> str:
        rendered = []
        for index, cell in enumerate(cells):
            right = index < len(headers) and headers[index] == "Size"
            rendered.append(cell.rjust(widths[index]) if right else cell.ljust(widths[index]))
        return " ".join(rendered)

    cells = []
    for entry, values in zip(entries, data):
        prefix = format_cells(values)
        name = display_name(entry, opts, argument)
        cells.append(f"{prefix}  {name}" if prefix else name)

    width = opts.width or 80
    chosen_columns = 1
    chosen_rows = len(cells)
    chosen_widths = [max((len(cell) for cell in cells), default=0)]
    for columns in range(2, len(cells) + 1):
        rows = (len(cells) + columns - 1) // columns
        column_widths = []
        for column in range(columns):
            column_cells = [cells[row + column * rows] for row in range(rows) if row + column * rows < len(cells)]
            column_widths.append(max((len(cell) for cell in column_cells), default=0))
        total = sum(column_widths) + 4 * (columns - 1)
        if total <= width:
            chosen_columns = columns
            chosen_rows = rows
            chosen_widths = column_widths
        else:
            break

    output = []
    for row in range(chosen_rows):
        line = []
        for column in range(chosen_columns):
            index = row + column * chosen_rows
            if index >= len(cells):
                continue
            cell = cells[index]
            if column < chosen_columns - 1:
                cell = cell.ljust(chosen_widths[column] + 4)
            line.append(cell)
        output.append("".join(line).rstrip())
    return "".join(line + "\n" for line in output)


def render_lines(entries: list[Entry], opts: Options, argument: bool = False) -> str:
    return "".join(display_name(entry, opts, argument) + "\n" for entry in entries)


def render_grid(entries: list[Entry], opts: Options, argument: bool = False) -> str:
    names = [display_name(entry, opts, argument) for entry in entries]
    if not names:
        return ""
    width = opts.width or 80
    chosen_columns = 1
    chosen_rows = len(names)
    chosen_widths = [max(len(name) for name in names)]
    for columns in range(2, len(names)):
        rows = (len(names) + columns - 1) // columns
        column_widths = []
        has_empty_column = False
        for column in range(columns):
            column_cells = []
            for row in range(rows):
                index = row * columns + column if opts.across else row + column * rows
                if index < len(names):
                    column_cells.append(names[index])
            if not column_cells:
                has_empty_column = True
                break
            column_widths.append(max((len(cell) for cell in column_cells), default=0))
        if has_empty_column:
            continue
        if sum(column_widths) + 2 * (columns - 1) <= width:
            chosen_columns = columns
            chosen_rows = rows
            chosen_widths = column_widths
        else:
            break
    columns = chosen_columns
    rows = chosen_rows
    column_widths = chosen_widths
    output = []
    for row in range(rows):
        cells = []
        for column in range(columns):
            index = row * columns + column if opts.across else row + column * rows
            if index >= len(names):
                continue
            cell = names[index]
            if column < columns - 1 and any(
                (row * columns + next_column if opts.across else row + next_column * rows) < len(names)
                for next_column in range(column + 1, columns)
            ):
                cell = cell.ljust(column_widths[column] + 2)
            cells.append(cell)
        output.append("".join(cells).rstrip())
    return "".join(line + "\n" for line in output)


def tree_rows(roots: list[Entry], opts: Options) -> list[tuple[Entry, str]]:
    rows: list[tuple[Entry, str]] = []

    def visit(entries: list[Entry], ancestors_last: list[bool], depth: int, roots_level: bool = False) -> None:
        count = len(entries)
        for index, entry in enumerate(entries):
            last = index == count - 1
            if roots_level:
                branch = ""
            else:
                parts = []
                for ancestor_last in ancestors_last:
                    parts.append("    " if ancestor_last else "│   ")
                parts.append("└── " if last else "├── ")
                branch = "".join(parts)
            rows.append((entry, branch + display_name(entry, opts, roots_level)))
            if not entry.points_to_dir or entry.is_dot_entry:
                continue
            if entry.is_symlink and not opts.follow_symlinks:
                continue
            if opts.level is not None and depth >= opts.level:
                continue
            try:
                children = read_directory(entry.path, opts)
            except OSError:
                continue
            if opts.only_files:
                visible = [child for child in children if not child.is_dir]
            else:
                visible = children
            visit(visible, ancestors_last + ([] if roots_level else [last]), depth + 1)

    visit(sort_entries(roots, opts), [], 0, True)
    return rows


def choose_mode(opts: Options) -> str:
    if not opts.view_events:
        return "grid" if sys.stdout.isatty() else "lines"
    last = opts.view_events[-1]
    if last == "lines":
        return "lines"
    if last == "grid":
        return "grid_details" if opts.long else "grid"
    if last == "tree":
        return "long"
    return "long"


def render_entries(entries: list[Entry], opts: Options, argument: bool = False) -> str:
    mode = choose_mode(opts)
    if mode == "grid_details":
        return render_grid_details(entries, opts, argument)
    if mode == "long":
        rows = [(entry, display_name(entry, opts, argument)) for entry in sort_entries(entries, opts)]
        return render_table(rows, opts)
    if mode == "grid":
        return render_grid(sort_entries(entries, opts), opts, argument)
    return render_lines(sort_entries(entries, opts), opts, argument)


def run_tree(entries: list[Entry], opts: Options) -> str:
    rows = tree_rows(entries, opts)
    if opts.long:
        return render_table(rows, opts)
    return "".join(name + "\n" for _, name in rows)


def recurse_directories(directories: list[str], opts: Options, first: bool, only_dir: bool) -> str:
    output = []

    def visit(path: str, is_first: bool, suppress_header: bool, depth: int) -> bool:
        if not is_first:
            output.append("\n")
        if not suppress_header:
            output.append(f"{quote_name(path, opts)}:\n")
        try:
            children = read_directory(path, opts)
        except OSError as error:
            code = getattr(error, "winerror", None) or error.errno or 1
            write_stderr(f"{path}: {windows_error_message(code)} (os error {code})\n")
            return False
        display_children = children
        if opts.only_files:
            display_children = [entry for entry in children if not entry.is_dir]
        output.append(render_entries(display_children, opts))
        path_depth = len([part for part in Path(path).parts if part != "."]) + 1
        if opts.level is not None and opts.level <= path_depth:
            return False
        child_dirs = [
            entry.path
            for entry in children
            if entry.is_dir and not entry.is_dot_entry
        ]
        for child in child_dirs:
            visit(child, False, False, depth + 1)
        return False

    current_first = first
    for path in directories:
        visit(path, current_first, only_dir and len(directories) == 1, 1)
        current_first = False
    return "".join(output)


def execute(opts: Options) -> int:
    if opts.tree and opts.show_dots:
        raise OptionError("Option --tree is useless given --all --all")

    paths = opts.paths
    if not paths:
        if opts.stdin or not sys.stdin.isatty():
            separator = os.environ.get("EZA_STDIN_SEPARATOR", "\n")
            paths = [part for part in sys.stdin.read().split(separator) if part]
        else:
            paths = ["."]

    files: list[Entry] = []
    directories: list[str] = []
    exit_status = 0
    tree_mode = opts.tree and choose_mode(opts) == "long"
    for path in paths:
        try:
            entry = stat_entry(path)
        except OSError as error:
            exit_status = 2
            code = getattr(error, "winerror", None) or error.errno or 1
            write_stderr(
                f"{rust_debug_path(path)}: {windows_error_message(code)} (os error {code})\n"
            )
            continue
        if entry.points_to_dir and not opts.treat_dirs_as_files and not tree_mode:
            directories.append(path)
        else:
            if not any(fnmatch.fnmatchcase(entry.name, pattern) for pattern in opts.ignore_globs):
                files.append(entry)

    if tree_mode:
        write_stdout(run_tree(files, opts))
        return exit_status

    no_files = not files
    only_dir = len(directories) == 1 and no_files
    output = []
    if files:
        output.append(render_entries(files, opts, True))
    if directories:
        if opts.recurse:
            output.append(recurse_directories(directories, opts, no_files, only_dir))
        else:
            first = no_files
            for path in directories:
                if first:
                    first = False
                else:
                    output.append("\n")
                if not only_dir:
                    output.append(f"{quote_name(path, opts)}:\n")
                try:
                    children = read_directory(path, opts)
                except OSError as error:
                    code = getattr(error, "winerror", None) or error.errno or 1
                    write_stderr(f"{path}: {windows_error_message(code)} (os error {code})\n")
                    continue
                output.append(render_entries(children, opts))
    write_stdout("".join(output))
    return exit_status


def main() -> int:
    try:
        opts = parse_args(sys.argv[1:])
        return execute(opts)
    except SystemExit as signal:
        if signal.code == "help":
            write_stdout(HELP)
            return 0
        if signal.code == "version":
            write_stdout(VERSION)
            return 0
        raise
    except OptionError as error:
        write_stderr(f"eza: {error}\n")
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
