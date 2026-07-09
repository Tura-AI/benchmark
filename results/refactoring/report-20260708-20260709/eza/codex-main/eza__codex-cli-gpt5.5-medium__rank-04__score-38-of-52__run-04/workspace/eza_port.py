#!/usr/bin/env python3
import fnmatch
import ctypes
import os
import shutil
import stat
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


VERSION = "eza - A modern, maintained replacement for ls\nv0.23.3 [+git]\nhttps://github.com/eza-community/eza\n"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@dataclass
class Options:
    long: bool = False
    tree: bool = False
    recurse: bool = False
    grid: bool = False
    across: bool = False
    all: int = 0
    only_dirs: bool = False
    only_files: bool = False
    dirs_as_files: bool = False
    classify: str = "never"
    reverse: bool = False
    sort: str = "name"
    level: int | None = None
    width: int | None = None
    header: bool = False
    no_user: bool = False
    no_size: bool = False
    no_perms: bool = False
    no_time: bool = False
    bytes: bool = False
    binary: bool = False
    group_dirs: str = ""
    ignore: list[str] = None
    absolute: str = "off"
    no_quotes: bool = False

    def __post_init__(self):
        if self.ignore is None:
            self.ignore = []


@dataclass
class Entry:
    path: Path
    name: str
    stat: os.stat_result | None
    is_dir: bool
    is_file: bool
    is_link: bool
    target: str | None = None


def help_text() -> str:
    return """Usage:
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
  --colo[u]r=WHEN            when to use terminal colours (always, auto, never)
  --icons=WHEN               when to display icons (always, auto, never)
  -w, --width COLS           set screen width in columns

FILTERING AND SORTING OPTIONS
  -a, --all                  show hidden and 'dot' files
  -A, --almost-all           equivalent to --all
  -d, --treat-dirs-as-files  list directories as files
  -D, --only-dirs            list only directories
  -f, --only-files           list only files
  -L, --level DEPTH          limit the depth of recursion
  -r, --reverse              reverse the sort order
  -s, --sort SORT_FIELD      which field to sort by
  --group-directories-first  list directories before other files
  --group-directories-last   list directories after other files
  -I, --ignore-glob GLOBS    glob patterns of files to ignore

LONG VIEW OPTIONS
  -b, --binary               list file sizes with binary prefixes
  -B, --bytes                list file sizes in bytes
  -h, --header               add a header row to each column
  --no-permissions           suppress the permissions field
  --no-filesize              suppress the filesize field
  --no-user                  suppress the user field
  --no-time                  suppress the time field
"""


def parse(argv: list[str]) -> tuple[Options, list[str], int | None]:
    opt = Options()
    paths: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--":
            paths.extend(argv[i + 1 :])
            break
        if not a.startswith("-") or a == "-":
            paths.append(a)
            i += 1
            continue
        if a in ("-?", "--help"):
            write_out(help_text())
            return opt, [], 0
        if a in ("-v", "--version"):
            write_out(VERSION)
            return opt, [], 0
        if a.startswith("--color") or a.startswith("--colour") or a.startswith("--icons"):
            if "=" not in a and i + 1 < len(argv) and not argv[i + 1].startswith("-"):
                i += 1
        elif a in ("--long",):
            opt.long = True
        elif a in ("--tree",):
            opt.tree = True
        elif a in ("--recurse",):
            opt.recurse = True
        elif a in ("--grid",):
            opt.grid = True
        elif a in ("--across",):
            opt.across = True
            opt.grid = False
        elif a in ("--all",):
            opt.all += 1
        elif a in ("--almost-all",):
            opt.all = max(opt.all, 1)
        elif a in ("--only-dirs",):
            opt.only_dirs = True
        elif a in ("--only-files",):
            opt.only_files = True
        elif a in ("--list-dirs", "--treat-dirs-as-files"):
            opt.dirs_as_files = True
        elif a in ("--reverse",):
            opt.reverse = True
        elif a in ("--group-directories-first",):
            opt.group_dirs = "first"
        elif a in ("--group-directories-last",):
            opt.group_dirs = "last"
        elif a in ("--header",):
            opt.header = True
            opt.long = True
        elif a in ("--no-user",):
            opt.no_user = True
            opt.long = True
        elif a in ("--no-filesize",):
            opt.no_size = True
            opt.long = True
        elif a in ("--no-permissions",):
            opt.no_perms = True
            opt.long = True
        elif a in ("--no-time",):
            opt.no_time = True
            opt.long = True
        elif a in ("--bytes",):
            opt.bytes = True
            opt.long = True
        elif a in ("--binary",):
            opt.binary = True
            opt.long = True
        elif a in ("--no-quotes",):
            opt.no_quotes = True
        elif a.startswith("--sort="):
            opt.sort = a.split("=", 1)[1]
        elif a == "--sort" and i + 1 < len(argv):
            i += 1
            opt.sort = argv[i]
        elif a.startswith("--level="):
            opt.level = int_or_none(a.split("=", 1)[1])
        elif a == "--level" and i + 1 < len(argv):
            i += 1
            opt.level = int_or_none(argv[i])
        elif a.startswith("--width="):
            opt.width = int_or_none(a.split("=", 1)[1])
        elif a == "--width" and i + 1 < len(argv):
            i += 1
            opt.width = int_or_none(argv[i])
        elif a.startswith("--classify="):
            opt.classify = a.split("=", 1)[1]
        elif a == "--classify" and i + 1 < len(argv):
            i += 1
            opt.classify = argv[i]
        elif a.startswith("--absolute="):
            opt.absolute = a.split("=", 1)[1]
        elif a == "--absolute" and i + 1 < len(argv):
            i += 1
            opt.absolute = argv[i]
        elif a.startswith("--ignore-glob="):
            opt.ignore.extend(split_globs(a.split("=", 1)[1]))
        elif a == "--ignore-glob" and i + 1 < len(argv):
            i += 1
            opt.ignore.extend(split_globs(argv[i]))
        elif a.startswith("-") and not a.startswith("--"):
            consumed = parse_short(a, argv, i, opt)
            i += consumed
        i += 1
    return opt, paths or ["."], None


def parse_short(arg: str, argv: list[str], index: int, opt: Options) -> int:
    j = 1
    consumed = 0
    while j < len(arg):
        c = arg[j]
        if c == "l":
            opt.long = True
        elif c == "T":
            opt.tree = True
        elif c == "R":
            opt.recurse = True
        elif c == "G":
            opt.grid = True
        elif c == "x":
            opt.across = True
            opt.grid = False
        elif c == "1":
            opt.grid = False
        elif c == "a":
            opt.all += 1
        elif c == "A":
            opt.all = max(opt.all, 1)
        elif c == "d":
            opt.dirs_as_files = True
        elif c == "D":
            opt.only_dirs = True
        elif c == "f":
            opt.only_files = True
        elif c == "r":
            opt.reverse = True
        elif c == "h":
            opt.header = True
            opt.long = True
        elif c in "BbgHinMoS@Z":
            opt.long = True
            if c == "B":
                opt.bytes = True
        elif c in "muU":
            opt.long = True
        elif c in ("s", "L", "w", "F", "I", "t"):
            val = arg[j + 1 :]
            if not val and index + consumed + 1 < len(argv):
                consumed += 1
                val = argv[index + consumed]
            if c == "s":
                opt.sort = val
            elif c == "L":
                opt.level = int_or_none(val)
            elif c == "w":
                opt.width = int_or_none(val)
            elif c == "F":
                opt.classify = val
            elif c == "I":
                opt.ignore.extend(split_globs(val))
            return consumed
        j += 1
    return consumed


def int_or_none(s: str) -> int | None:
    try:
        return int(s)
    except ValueError:
        return None


def split_globs(s: str) -> list[str]:
    return [p for p in s.split("|") if p]


def make_entry(path: Path, display_name: str | None = None) -> Entry:
    try:
        st = path.lstat()
    except OSError:
        st = None
    is_link = path.is_symlink()
    try:
        is_dir = path.is_dir()
        is_file = path.is_file()
    except OSError:
        is_dir = False
        is_file = False
    target = None
    if is_link:
        try:
            target = os.readlink(path)
        except OSError:
            target = None
    return Entry(path, display_name if display_name is not None else path.name, st, is_dir, is_file, is_link, target)


def visible(e: Entry, opt: Options) -> bool:
    if opt.all == 0 and e.name.startswith("."):
        return False
    if opt.only_dirs and not e.is_dir:
        return False
    if opt.only_files and e.is_dir:
        return False
    for pat in opt.ignore:
        if fnmatch.fnmatch(e.name, pat):
            return False
    return True


def list_dir(path: Path, opt: Options) -> list[Entry]:
    out: list[Entry] = []
    try:
        with os.scandir(path) as it:
            for de in it:
                e = make_entry(Path(de.path), de.name)
                if visible(e, opt):
                    out.append(e)
    except OSError as exc:
        raise exc
    return sort_entries(out, opt)


def sort_entries(entries: list[Entry], opt: Options) -> list[Entry]:
    field = opt.sort.lower()

    def ext(name: str) -> str:
        base = name.rsplit(".", 1)
        return base[1].lower() if len(base) == 2 and base[0] else ""

    def key(e: Entry):
        st = e.stat
        size = st.st_size if st else 0
        mtime = st.st_mtime if st else 0
        typ = 0 if e.is_dir else 1 if e.is_file else 2
        if field in ("size",):
            primary = size
        elif field in ("ext", "extension"):
            primary = (ext(e.name), e.name.lower())
        elif field in ("type",):
            primary = (typ, ext(e.name), e.name.lower())
        elif field in ("modified", "time", "date", "newest", "new"):
            primary = -mtime
        elif field in ("oldest", "old", "age"):
            primary = mtime
        elif field == "none":
            primary = 0
        else:
            primary = e.name.lower()
        group = 0
        if opt.group_dirs == "first":
            group = 0 if e.is_dir else 1
        elif opt.group_dirs == "last":
            group = 1 if e.is_dir else 0
        return (group, primary, e.name)

    return sorted(entries, key=key, reverse=opt.reverse)


def display_name(e: Entry, opt: Options, tree: bool = False) -> str:
    if opt.absolute == "on":
        name = str(e.path.resolve())
    else:
        name = e.name
    if not opt.no_quotes and (" " in name or "\t" in name or name.startswith(" ")):
        name = "'" + name.replace("'", "\\'") + "'"
    if e.is_link and e.target:
        name = f"{name} -> {e.target}"
    if opt.classify == "always":
        if e.is_dir:
            name += "/"
        elif is_executable(e):
            name += "*"
    return name


def is_executable(e: Entry) -> bool:
    return bool(e.stat and (e.stat.st_mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)))


def mode_string(e: Entry) -> str:
    if os.name == "nt":
        if e.is_dir:
            return "d----"
        return "-a---"
    if e.stat is None:
        return "----------"
    m = e.stat.st_mode
    lead = "d" if stat.S_ISDIR(m) else "l" if stat.S_ISLNK(m) else "-"
    bits = ""
    for who in ((stat.S_IRUSR, stat.S_IWUSR, stat.S_IXUSR), (stat.S_IRGRP, stat.S_IWGRP, stat.S_IXGRP), (stat.S_IROTH, stat.S_IWOTH, stat.S_IXOTH)):
        bits += "r" if m & who[0] else "-"
        bits += "w" if m & who[1] else "-"
        bits += "x" if m & who[2] else "-"
    return lead + bits


def size_string(e: Entry, opt: Options) -> str:
    if e.is_dir:
        return "-"
    size = e.stat.st_size if e.stat else 0
    if opt.bytes or size < 1000:
        return str(size)
    units = ["K", "M", "G", "T"]
    div = 1024 if opt.binary else 1000
    val = float(size)
    unit = ""
    for unit in units:
        val /= div
        if val < div:
            break
    if val >= 10:
        return f"{val:.0f}{unit}"
    return f"{val:.1f}{unit}"


def date_string(e: Entry) -> str:
    ts = e.stat.st_mtime if e.stat else 0
    dt = datetime.fromtimestamp(ts)
    return f"{dt.day} {MONTHS[dt.month - 1]} {dt.strftime('%H:%M')}"


def long_lines(entries: list[Entry], opt: Options) -> list[str]:
    rows = []
    for e in entries:
        parts = []
        if not opt.no_perms:
            parts.append(mode_string(e))
        if not opt.no_size:
            parts.append(size_string(e, opt))
        if not opt.no_time:
            parts.append(date_string(e))
        parts.append(display_name(e, opt))
        rows.append(parts)
    widths = []
    cols = max((len(r) for r in rows), default=0)
    for col in range(cols):
        widths.append(max((len(r[col]) for r in rows if col < len(r)), default=0))
    if opt.header:
        h = []
        if not opt.no_perms:
            h.append("Mode")
        if not opt.no_size:
            h.append("Size")
        if not opt.no_time:
            h.append("Date Modified")
        h.append("Name")
        for idx, head in enumerate(h):
            if idx < len(widths) and head != "Date Modified" and head != "Name":
                widths[idx] = max(widths[idx], len(head))
    if not opt.no_time and rows:
        date_col = 0
        if not opt.no_perms:
            date_col += 1
        if not opt.no_size:
            date_col += 1
        if 0 <= date_col < len(widths):
            widths[date_col] = max(widths[date_col], 12)
    lines = []
    if opt.header:
        heads = []
        if not opt.no_perms:
            heads.append("Mode")
        if not opt.no_size:
            heads.append("Size")
        if not opt.no_time:
            heads.append("Date Modified")
        heads.append("Name")
        lines.append(" ".join(h.ljust(max(len(h), widths[i] if i < len(widths) else 0)) for i, h in enumerate(heads)).rstrip())
    for r in rows:
        formatted = []
        for i, cell in enumerate(r):
            if i == len(r) - 1:
                formatted.append(cell)
            elif cell == "-" or cell.isdigit() or cell.endswith(("K", "M", "G", "T")) or any(f" {m} " in f" {cell} " for m in MONTHS):
                formatted.append(cell.rjust(widths[i]))
            else:
                formatted.append(cell.ljust(widths[i]))
        if opt.header and len(formatted) >= 2:
            lines.append(" ".join(formatted[:-1]) + "  " + formatted[-1])
        else:
            lines.append(" ".join(formatted))
    return lines


def grid_lines(entries: list[Entry], opt: Options) -> list[str]:
    names = [display_name(e, opt) for e in entries]
    if not names:
        return []
    width = opt.width or shutil.get_terminal_size((80, 24)).columns
    maxlen = max(len(n) for n in names)
    colw = maxlen + 2
    cols = max(1, width // colw)
    if cols <= 1:
        return names
    rows = (len(names) + cols - 1) // cols
    out = []
    for r in range(rows):
        cells = []
        for c in range(cols):
            idx = r * cols + c if opt.across else c * rows + r
            if idx < len(names):
                cells.append(names[idx])
        out.append("  ".join(cells))
    return out


def print_listing(entries: list[Entry], opt: Options):
    if opt.long:
        lines = long_lines(entries, opt)
    elif opt.grid:
        lines = grid_lines(entries, opt)
    else:
        lines = [display_name(e, opt) for e in entries]
    if lines:
        write_out("\n".join(lines) + "\n")


def tree_lines(root: Path, opt: Options) -> list[str]:
    lines = [str(root)]
    max_depth = opt.level
    if max_depth == 0:
        return lines

    def walk(path: Path, prefix: str, depth: int):
        if max_depth is not None and depth > max_depth:
            return
        try:
            children = list_dir(path, opt)
        except OSError:
            return
        for idx, e in enumerate(children):
            last = idx == len(children) - 1
            branch = "└── " if last else "├── "
            lines.append(prefix + branch + display_name(e, opt, tree=True))
            if e.is_dir and not e.is_link and (max_depth is None or depth < max_depth):
                walk(e.path, prefix + ("    " if last else "│   "), depth + 1)

    if root.is_dir():
        walk(root, "", 1)
    return lines


def emit_error(path: str, exc: OSError):
    code = getattr(exc, "winerror", None) or exc.errno
    msg = localized_error(code) or exc.strerror or str(exc)
    write_err(f'"{path}": {msg} (os error {code})\n')


def localized_error(code: int | None) -> str | None:
    if os.name != "nt" or not code:
        return None
    buf = ctypes.create_unicode_buffer(512)
    n = ctypes.windll.kernel32.FormatMessageW(0x00001000, None, code, 0, buf, len(buf), None)
    if not n:
        return None
    return buf.value.strip().rstrip("\r\n")


def write_out(text: str):
    sys.stdout.buffer.write(text.encode("utf-8"))


def write_err(text: str):
    sys.stderr.buffer.write(text.encode("utf-8", "replace"))


def run(argv: list[str]) -> int:
    opt, paths, early = parse(argv)
    if early is not None:
        return early
    exit_code = 0
    groups: list[tuple[str, list[Entry] | list[str], bool]] = []
    for raw in paths:
        p = Path(raw)
        try:
            if not p.exists() and not p.is_symlink():
                raise FileNotFoundError(2, os.strerror(2), raw)
            if opt.tree:
                groups.append((raw, tree_lines(p, opt), True))
            elif p.is_dir() and not opt.dirs_as_files:
                groups.append((raw, list_dir(p, opt), False))
            else:
                e = make_entry(p, raw if len(paths) == 1 else p.name)
                if visible(e, opt):
                    groups.append((raw, [e], False))
        except OSError as exc:
            emit_error(raw, exc)
            exit_code = 2
    printable = [g for g in groups if g[1]]
    for idx, (raw, content, is_tree) in enumerate(printable):
        if len(printable) > 1 and not is_tree:
            if idx:
                write_out("\n")
            write_out(f"{raw}:\n")
        if is_tree:
            lines = content  # type: ignore[assignment]
            write_out("\n".join(lines) + ("\n" if lines else ""))
        else:
            print_listing(content, opt)  # type: ignore[arg-type]
    return exit_code


if __name__ == "__main__":
    sys.exit(run(sys.argv[1:]))
