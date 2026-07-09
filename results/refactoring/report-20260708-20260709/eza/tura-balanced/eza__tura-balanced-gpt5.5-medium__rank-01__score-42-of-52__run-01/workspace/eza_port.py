#!/usr/bin/env python3
import ctypes
import fnmatch
import math
import os
import re
import stat
import sys
from dataclasses import dataclass, field
from datetime import datetime
from functools import cmp_to_key
from pathlib import Path


VERSION_TEXT = "eza - A modern, maintained replacement for ls\nv0.23.3 [+git]\nhttps://github.com/eza-community/eza\n"

HELP_TEXT = """Usage:\n  eza [options] [files...]\n\nMETA OPTIONS\n  -?, --help                 show list of command-line options\n  -v, --version              show version of eza\n\nDISPLAY OPTIONS\n  -1, --oneline              display one entry per line\n  -l, --long                 display extended file metadata as a table\n  -G, --grid                 display entries as a grid (default)\n  -x, --across               sort the grid across, rather than downwards\n  -R, --recurse              recurse into directories\n  -T, --tree                 recurse into directories as a tree\n  -F, --classify=WHEN        display type indicator by file names (always, auto, never)\n  --colo[u]r=WHEN            when to use terminal colours (always, auto, never)\n  --icons=WHEN               when to display icons (always, auto, never)\n"""

SORT_CHOICES = ["name", "Name", "size", "extension", "Extension", "modified", "changed", "accessed", "created", "inode", "type", "none"]
WHEN = {"always", "auto", "never"}
TIME_STYLES = {"default", "long-iso", "full-iso", "iso", "relative"}


def write_stdout(text: str) -> None:
    sys.stdout.buffer.write(text.encode("utf-8", "replace"))


def write_stderr(text: str) -> None:
    sys.stderr.buffer.write(text.encode("utf-8", "replace"))


def win_error_message(code: int) -> str:
    if os.name == "nt":
        try:
            buf = ctypes.create_unicode_buffer(512)
            ctypes.windll.kernel32.FormatMessageW(0x00001000, None, code, 0, buf, len(buf), None)
            msg = buf.value.strip().rstrip(".")
            return msg or os.strerror(code)
        except Exception:
            pass
    return os.strerror(code)


def natural_chunks(s: str, ignore_case: bool) -> list:
    if ignore_case:
        s = s.lower()
    chunks = []
    for part in re.split(r"(\d+)", s):
        if part.isdigit():
            chunks.append((0, int(part), len(part)))
        else:
            chunks.append((1, part))
    return chunks


def natural_compare(a: str, b: str, ignore_case: bool = False) -> int:
    ca = natural_chunks(a, ignore_case)
    cb = natural_chunks(b, ignore_case)
    return (ca > cb) - (ca < cb)


def file_ext(name: str) -> str | None:
    idx = name.rfind(".")
    if idx == -1:
        return None
    return name[idx + 1 :].lower()


@dataclass
class Options:
    mode: str = "grid"
    long: bool = False
    grid: bool = False
    across: bool = False
    tree: bool = False
    recurse: bool = False
    level: int | None = None
    all_count: int = 0
    almost_all: bool = False
    reverse: bool = False
    sort: str = "name_ci"
    dirs_first: bool = False
    dirs_last: bool = False
    only_dirs: bool = False
    only_files: bool = False
    no_symlinks: bool = False
    show_symlinks: bool = False
    treat_dirs_as_files: bool = False
    ignore_globs: list[str] = field(default_factory=list)
    width: int = 80
    classify: str = "never"
    color: str = "never"
    icons: str = "never"
    bytes: bool = False
    binary: bool = False
    header: bool = False
    no_permissions: bool = False
    no_filesize: bool = False
    no_user: bool = False
    no_time: bool = False
    numeric: bool = False
    group: bool = False
    links: bool = False
    inode: bool = False
    blocksize: bool = False
    modified_col: bool = False
    changed_col: bool = False
    accessed_col: bool = False
    created_col: bool = False
    time_style: str = "default"
    follow_links: bool = False
    dereference: bool = False
    stdin: bool = False


LONG_SPECS = {
    "help": ("?", "none"), "version": ("v", "none"), "oneline": ("1", "none"),
    "long": ("l", "none"), "grid": ("G", "none"), "across": ("x", "none"),
    "recurse": ("R", "none"), "tree": ("T", "none"), "classify": ("F", "optional"),
    "dereference": ("X", "none"), "follow-symlinks": (None, "none"), "width": ("w", "value"),
    "color": (None, "optional"), "colour": (None, "optional"), "icons": (None, "optional"),
    "all": ("a", "none"), "almost-all": ("A", "none"), "treat-dirs-as-files": ("d", "none"),
    "list-dirs": (None, "none"), "level": ("L", "value"), "reverse": ("r", "none"),
    "sort": ("s", "value"), "ignore-glob": ("I", "value"), "group-directories-first": (None, "none"),
    "group-directories-last": (None, "none"), "only-dirs": ("D", "none"), "only-files": ("f", "none"),
    "no-symlinks": (None, "none"), "show-symlinks": (None, "none"), "binary": ("b", "none"),
    "bytes": ("B", "none"), "group": ("g", "none"), "numeric": ("n", "none"), "header": ("h", "none"),
    "inode": ("i", "none"), "links": ("H", "none"), "modified": ("m", "none"), "changed": (None, "none"),
    "blocksize": ("S", "none"), "time": ("t", "value"), "accessed": ("u", "none"), "created": ("U", "none"),
    "time-style": (None, "value"), "no-permissions": (None, "none"), "no-filesize": (None, "none"),
    "no-user": (None, "none"), "no-time": (None, "none"), "git": (None, "none"), "no-git": (None, "none"),
    "git-repos": (None, "none"), "git-repos-no-status": (None, "none"), "extended": ("@", "none"),
    "octal-permissions": ("o", "none"), "context": ("Z", "none"), "stdin": (None, "none"), "flags": ("O", "none"),
    "absolute": (None, "optional"), "hyperlink": (None, "none"), "mounts": ("M", "none"), "smart-group": (None, "none"),
    "color-scale": (None, "optional"), "colour-scale": (None, "optional"), "color-scale-mode": (None, "value"), "colour-scale-mode": (None, "value"),
}

SHORT_TO_LONG = {v[0]: k for k, v in LONG_SPECS.items() if v[0]}


class OptionError(Exception):
    pass


def parse_args(argv: list[str]) -> tuple[Options, list[str], str | None]:
    opts = Options()
    paths: list[str] = []
    events: list[tuple[str, str | None]] = []
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--":
            paths.extend(argv[i + 1 :])
            break
        if arg.startswith("--") and len(arg) > 2:
            raw = arg[2:]
            name, eq, val = raw.partition("=")
            if name not in LONG_SPECS:
                raise OptionError(f"Unknown argument --{name}")
            takes = LONG_SPECS[name][1]
            if takes == "none":
                if eq:
                    raise OptionError(f"Option --{name} doesn't allow an argument")
                events.append((name, None))
            elif takes == "value":
                if not eq:
                    i += 1
                    if i >= len(argv):
                        raise OptionError(f"Option --{name} needs a value")
                    val = argv[i]
                events.append((name, val))
            else:
                if not eq:
                    default = "auto" if name in {"color", "colour", "icons", "classify"} else "on"
                    if i + 1 < len(argv) and not argv[i + 1].startswith("-"):
                        nxt = argv[i + 1]
                        allowed = WHEN if name in {"color", "colour", "icons", "classify"} else {"on", "follow", "off"}
                        if nxt in allowed:
                            i += 1
                            val = nxt
                        else:
                            val = default
                    else:
                        val = default
                events.append((name, val))
        elif arg.startswith("-") and arg != "-":
            chars = arg[1:]
            j = 0
            while j < len(chars):
                ch = chars[j]
                if ch not in SHORT_TO_LONG:
                    raise OptionError(f"Unknown argument -{ch}")
                name = SHORT_TO_LONG[ch]
                takes = LONG_SPECS[name][1]
                if takes == "none":
                    events.append((name, None))
                    j += 1
                elif takes == "value":
                    rem = chars[j + 1 :]
                    if rem.startswith("="):
                        rem = rem[1:]
                    if rem:
                        events.append((name, rem))
                        break
                    i += 1
                    if i >= len(argv):
                        raise OptionError(f"Option -{ch} needs a value")
                    events.append((name, argv[i]))
                    break
                else:
                    rem = chars[j + 1 :]
                    if rem:
                        raise OptionError(f"Option -{ch} doesn't allow an argument")
                    default = "auto" if name in {"classify"} else "on"
                    events.append((name, default))
                    j += 1
        else:
            paths.append(arg)
        i += 1

    if any(n == "help" for n, _ in events):
        return opts, paths, "help"
    if any(n == "version" for n, _ in events):
        return opts, paths, "version"

    for name, val in events:
        apply_event(opts, name, val)

    if opts.long:
        opts.mode = "details"
    elif opts.tree:
        opts.mode = "details"
    elif any(n == "oneline" for n, _ in events):
        opts.mode = "lines"
    elif opts.grid or opts.across:
        opts.mode = "grid"
    else:
        opts.mode = "grid" if sys.stdout.isatty() else "lines"

    return opts, paths or ["."], None


def apply_event(opts: Options, name: str, val: str | None) -> None:
    if name == "oneline": opts.mode = "lines"
    elif name == "long": opts.long = True
    elif name == "grid": opts.grid = True
    elif name == "across": opts.across = True
    elif name == "recurse": opts.recurse = True
    elif name == "tree": opts.tree = True; opts.recurse = True
    elif name in {"dereference"}: opts.dereference = True
    elif name == "follow-symlinks": opts.follow_links = True
    elif name == "width": opts.width = parse_int(val or "", "--width (-w)")
    elif name in {"color", "colour"}:
        if val not in WHEN: raise OptionError(f'Option --{name} has no "{val}" setting')
        opts.color = val or "auto"
    elif name == "icons":
        if val not in WHEN: raise OptionError(f'Option --icons has no "{val}" setting')
        opts.icons = val or "auto"
    elif name == "classify":
        if val not in WHEN: raise OptionError(f'Option --classify (-F) has no "{val}" setting')
        opts.classify = val or "auto"
    elif name == "all": opts.all_count += 1
    elif name == "almost-all": opts.almost_all = True
    elif name in {"treat-dirs-as-files", "list-dirs"}: opts.treat_dirs_as_files = True
    elif name == "level": opts.level = parse_int(val or "", "--level (-L)")
    elif name == "reverse": opts.reverse = True
    elif name == "sort": opts.sort = parse_sort(val or "")
    elif name == "ignore-glob": opts.ignore_globs = (val or "").split("|")
    elif name == "group-directories-first": opts.dirs_first = True
    elif name == "group-directories-last": opts.dirs_last = True
    elif name == "only-dirs": opts.only_dirs = True
    elif name == "only-files": opts.only_files = True
    elif name == "no-symlinks": opts.no_symlinks = True
    elif name == "show-symlinks": opts.show_symlinks = True
    elif name == "binary": opts.binary = True; opts.bytes = False
    elif name == "bytes": opts.bytes = True; opts.binary = False
    elif name == "group": opts.group = True
    elif name == "numeric": opts.numeric = True
    elif name == "header": opts.header = True
    elif name == "inode": opts.inode = True
    elif name == "links": opts.links = True
    elif name == "modified": opts.modified_col = True
    elif name == "changed": opts.changed_col = True
    elif name == "blocksize": opts.blocksize = True
    elif name == "accessed": opts.accessed_col = True
    elif name == "created": opts.created_col = True
    elif name == "time-style":
        if val not in TIME_STYLES and not (val or "").startswith("+"):
            raise OptionError(f'Option --time-style has no "{val}" setting (choices: default, long-iso, full-iso, iso, relative)')
        opts.time_style = val or "default"
    elif name == "time":
        if val in {"mod", "modified"}: opts.modified_col = True
        elif val in {"ch", "changed"}: opts.changed_col = True
        elif val in {"acc", "accessed"}: opts.accessed_col = True
        elif val in {"cr", "created"}: opts.created_col = True
        else: raise OptionError(f'Option --time (-t) has no "{val}" setting (choices: modified, changed, accessed, created)')
    elif name == "no-permissions": opts.no_permissions = True
    elif name == "no-filesize": opts.no_filesize = True
    elif name == "no-user": opts.no_user = True
    elif name == "no-time": opts.no_time = True
    elif name == "stdin": opts.stdin = True


def parse_int(value: str, flag: str) -> int:
    try:
        return int(value, 10)
    except ValueError:
        raise OptionError(f'Value "{value}" not valid for option {flag}: invalid digit found in string')


def parse_sort(value: str) -> str:
    mapping = {
        "name": "name_ci", "filename": "name_ci", "Name": "name", "Filename": "name",
        ".name": "name_hidden_ci", ".filename": "name_hidden_ci", ".Name": "name_hidden", ".Filename": "name_hidden",
        "size": "size", "filesize": "size", "ext": "ext_ci", "extension": "ext_ci", "Ext": "ext", "Extension": "ext",
        "date": "modified", "time": "modified", "mod": "modified", "modified": "modified", "new": "modified", "newest": "modified",
        "age": "age", "old": "age", "oldest": "age", "ch": "changed", "changed": "changed", "acc": "accessed", "accessed": "accessed",
        "cr": "created", "created": "created", "inode": "inode", "type": "type", "none": "none",
    }
    if value not in mapping:
        raise OptionError(f'Option --sort (-s) has no "{value}" setting (choices: {', '.join(SORT_CHOICES)})')
    if value == "inode" and os.name == "nt":
        raise OptionError(f'Option --sort (-s) has no "{value}" setting (choices: {', '.join(SORT_CHOICES)})')
    return mapping[value]


@dataclass
class Entry:
    path: Path
    name: str
    is_dot_entry: bool = False
    _stat: os.stat_result | None = None
    _lstat: os.stat_result | None = None

    def lstat(self) -> os.stat_result:
        if self._lstat is None:
            self._lstat = os.lstat(self.path)
        return self._lstat

    def stat(self) -> os.stat_result:
        if self._stat is None:
            self._stat = os.stat(self.path)
        return self._stat

    def mode(self) -> int:
        return self.lstat().st_mode

    def is_dir(self) -> bool:
        return stat.S_ISDIR(self.mode())

    def is_link(self) -> bool:
        return stat.S_ISLNK(self.mode())

    def points_to_dir(self) -> bool:
        if self.is_dir():
            return True
        if self.is_link():
            try:
                return stat.S_ISDIR(self.stat().st_mode)
            except OSError:
                return False
        return False

    def is_file(self) -> bool:
        return stat.S_ISREG(self.mode())

    def size_value(self) -> int:
        try:
            return self.lstat().st_size
        except OSError:
            return 0

    def time_value(self, kind: str) -> float:
        st = self.lstat()
        if kind == "accessed": return st.st_atime
        if kind == "created": return getattr(st, "st_birthtime", st.st_ctime)
        if kind == "changed": return st.st_ctime
        return st.st_mtime

    def type_rank(self) -> int:
        if self.is_dir(): return 0
        if self.is_file(): return 1
        if self.is_link(): return 2
        return 7


def visible_entries(dir_path: Path, opts: Options) -> list[Entry]:
    entries: list[Entry] = []
    if opts.all_count >= 2 and not opts.tree:
        entries.append(Entry(dir_path, ".", True))
        entries.append(Entry(dir_path / "..", "..", True))
    for child in dir_path.iterdir():
        name = child.name
        if opts.all_count == 0 and not opts.almost_all:
            if name.startswith(".") or (os.name == "nt" and name.startswith("_")):
                continue
        entries.append(Entry(child, name))
    return filter_entries(entries, opts, child=True)


def filter_entries(entries: list[Entry], opts: Options, child: bool) -> list[Entry]:
    out = []
    for e in entries:
        if any(fnmatch.fnmatchcase(e.name, pat) for pat in opts.ignore_globs):
            continue
        if opts.no_symlinks and e.is_link():
            continue
        if opts.only_dirs and not e.is_dir() and not (opts.show_symlinks and e.points_to_dir()):
            continue
        if opts.only_files and not opts.recurse:
            if not e.is_file() and not (opts.show_symlinks and e.is_link() and not e.points_to_dir()):
                continue
        out.append(e)
    return out


def compare_entries(opts: Options, a: Entry, b: Entry) -> int:
    s = opts.sort
    if s == "none": cmp = 0
    elif s == "name_ci": cmp = natural_compare(a.name, b.name, True)
    elif s == "name": cmp = natural_compare(a.name, b.name, False)
    elif s == "name_hidden_ci": cmp = natural_compare(a.name.lstrip("."), b.name.lstrip("."), True)
    elif s == "name_hidden": cmp = natural_compare(a.name.lstrip("."), b.name.lstrip("."), False)
    elif s == "size": cmp = (a.size_value() > b.size_value()) - (a.size_value() < b.size_value())
    elif s == "modified": cmp = (a.time_value("modified") > b.time_value("modified")) - (a.time_value("modified") < b.time_value("modified"))
    elif s == "age": cmp = (b.time_value("modified") > a.time_value("modified")) - (b.time_value("modified") < a.time_value("modified"))
    elif s == "changed": cmp = (a.time_value("changed") > b.time_value("changed")) - (a.time_value("changed") < b.time_value("changed"))
    elif s == "accessed": cmp = (a.time_value("accessed") > b.time_value("accessed")) - (a.time_value("accessed") < b.time_value("accessed"))
    elif s == "created": cmp = (a.time_value("created") > b.time_value("created")) - (a.time_value("created") < b.time_value("created"))
    elif s == "inode": cmp = (getattr(a.lstat(), "st_ino", 0) > getattr(b.lstat(), "st_ino", 0)) - (getattr(a.lstat(), "st_ino", 0) < getattr(b.lstat(), "st_ino", 0))
    elif s == "type":
        cmp = (a.type_rank() > b.type_rank()) - (a.type_rank() < b.type_rank())
        if cmp == 0: cmp = natural_compare(a.name, b.name, False)
    elif s in {"ext", "ext_ci"}:
        ea, eb = file_ext(a.name), file_ext(b.name)
        cmp = (ea is not None, ea or "") > (eb is not None, eb or "")
        cmp = int(cmp) - int((ea is not None, ea or "") < (eb is not None, eb or ""))
        if cmp == 0: cmp = natural_compare(a.name, b.name, s == "ext_ci")
    else:
        cmp = natural_compare(a.name, b.name, True)
    return cmp


def sort_entries(entries: list[Entry], opts: Options) -> list[Entry]:
    entries = sorted(entries, key=cmp_to_key(lambda a, b: compare_entries(opts, a, b)))
    if opts.reverse:
        entries.reverse()
    if opts.dirs_first:
        entries = sorted(entries, key=lambda e: not e.points_to_dir())
    elif opts.dirs_last:
        entries = sorted(entries, key=lambda e: e.points_to_dir())
    return entries


def classify(e: Entry, opts: Options) -> str:
    if opts.classify != "always":
        return ""
    if e.points_to_dir(): return "/"
    if e.is_link(): return "@"
    try:
        if e.is_file() and (e.mode() & stat.S_IXUSR): return "*"
    except OSError:
        pass
    return ""


def render_name(e: Entry, opts: Options) -> str:
    return e.name + classify(e, opts)


def render_lines(entries: list[Entry], opts: Options) -> str:
    return "".join(render_name(e, opts) + "\n" for e in sort_entries(entries, opts))


def render_grid(entries: list[Entry], opts: Options) -> str:
    names = [render_name(e, opts) for e in sort_entries(entries, opts)]
    if not names:
        return ""
    maxw = max(len(n) for n in names)
    width = max(1, opts.width)
    cols = max(1, (width + 2) // (maxw + 2))
    rows = math.ceil(len(names) / cols)
    lines = []
    if opts.across:
        seq = [names[i : i + cols] for i in range(0, len(names), cols)]
    else:
        seq = []
        for r in range(rows):
            row = []
            for c in range(cols):
                idx = c * rows + r
                if idx < len(names): row.append(names[idx])
            seq.append(row)
    for row in seq:
        line = ""
        for i, name in enumerate(row):
            if i == len(row) - 1:
                line += name
            else:
                line += name + " " * (maxw - len(name) + 2)
        lines.append(line.rstrip())
    return "\n".join(lines) + "\n"


def permissions_windows(e: Entry) -> str:
    if os.name == "nt":
        try:
            import stat as pystat
            attrs = e.path.stat().st_file_attributes
            typ = "l" if attrs & getattr(pystat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400) else "d" if e.is_dir() else "-"
            return typ + ("a" if attrs & pystat.FILE_ATTRIBUTE_ARCHIVE else "-") + ("r" if attrs & pystat.FILE_ATTRIBUTE_READONLY else "-") + ("h" if attrs & pystat.FILE_ATTRIBUTE_HIDDEN else "-") + ("s" if attrs & pystat.FILE_ATTRIBUTE_SYSTEM else "-")
        except Exception:
            pass
    m = e.mode()
    typ = "d" if stat.S_ISDIR(m) else "l" if stat.S_ISLNK(m) else "."
    bits = ""
    for bit, ch in [(stat.S_IRUSR,"r"),(stat.S_IWUSR,"w"),(stat.S_IXUSR,"x"),(stat.S_IRGRP,"r"),(stat.S_IWGRP,"w"),(stat.S_IXGRP,"x"),(stat.S_IROTH,"r"),(stat.S_IWOTH,"w"),(stat.S_IXOTH,"x")]:
        bits += ch if m & bit else "-"
    return typ + bits


def format_size(e: Entry, opts: Options) -> str:
    if e.points_to_dir() and not e.is_link():
        return "-"
    n = e.size_value()
    if opts.bytes:
        return f"{n:,}"
    base = 1024 if opts.binary else 1000
    units = ["", "K" if not opts.binary else "Ki", "M" if not opts.binary else "Mi", "G" if not opts.binary else "Gi", "T" if not opts.binary else "Ti"]
    val = float(n)
    idx = 0
    while val >= base and idx < len(units) - 1:
        val /= base; idx += 1
    if idx == 0:
        return str(n)
    return (f"{val:.1f}" if val < 10 else str(int(round(val)))) + units[idx]


def format_time(e: Entry, opts: Options, kind: str = "modified") -> str:
    dt = datetime.fromtimestamp(e.time_value(kind))
    if opts.time_style == "long-iso":
        return dt.strftime("%Y-%m-%d %H:%M")
    if opts.time_style == "full-iso":
        return dt.strftime("%Y-%m-%d %H:%M:%S.%f %z")
    if opts.time_style == "iso":
        return dt.strftime("%m-%d %H:%M") if dt.year == datetime.now().year else dt.strftime("%Y-%m-%d")
    if opts.time_style == "relative":
        sec = max(0, int(datetime.now().timestamp() - e.time_value(kind)))
        if sec < 60: return "now"
        if sec < 3600: return f"{sec//60}m"
        if sec < 86400: return f"{sec//3600}h"
        return f"{sec//86400}d"
    return dt.strftime("%d %b %H:%M") if dt.year == datetime.now().year else dt.strftime("%d %b  %Y")


def long_columns(opts: Options) -> list[tuple[str, str]]:
    cols = []
    if not opts.no_permissions: cols.append(("perm", "Permissions"))
    if opts.links: cols.append(("links", "Links"))
    if not opts.no_filesize: cols.append(("size", "Size"))
    if not opts.no_user and os.name != "nt": cols.append(("user", "User"))
    if opts.group and os.name != "nt": cols.append(("group", "Group"))
    if opts.blocksize and os.name != "nt": cols.append(("block", "Blocks"))
    if not opts.no_time:
        kinds = []
        if opts.modified_col or not (opts.changed_col or opts.accessed_col or opts.created_col): kinds.append("modified")
        if opts.changed_col: kinds.append("changed")
        if opts.accessed_col: kinds.append("accessed")
        if opts.created_col: kinds.append("created")
        for k in kinds: cols.append(("time:" + k, "Date " + k.capitalize()))
    return cols


def col_value(e: Entry, opts: Options, col: str) -> str:
    if col == "perm": return permissions_windows(e)
    if col == "links": return str(getattr(e.lstat(), "st_nlink", 1))
    if col == "size": return format_size(e, opts)
    if col == "user": return str(getattr(e.lstat(), "st_uid", 0))
    if col == "group": return str(getattr(e.lstat(), "st_gid", 0))
    if col == "block": return str(getattr(e.lstat(), "st_blocks", 0))
    if col.startswith("time:"): return format_time(e, opts, col.split(":",1)[1])
    return ""


def render_details(entries: list[Entry], opts: Options, depth_info: list[tuple[int, bool]] | None = None) -> str:
    entries = sort_entries(entries, opts) if depth_info is None else entries
    cols = long_columns(opts) if opts.long else []
    rows = []
    if opts.header and cols:
        rows.append(([h for _, h in cols], "Name", 0, False, True))
    for idx, e in enumerate(entries):
        depth, last = depth_info[idx] if depth_info else (0, idx == len(entries) - 1)
        rows.append(([col_value(e, opts, c) for c, _ in cols], render_name(e, opts), depth, last, False))
    widths = [0] * len(cols)
    for vals, _, _, _, _ in rows:
        for i, v in enumerate(vals): widths[i] = max(widths[i], len(v))
    trunk: list[bool] = []
    out = []
    for vals, name, depth, last, _header in rows:
        prefix = ""
        if opts.tree:
            while len(trunk) < depth: trunk.append(False)
            if depth > 0:
                prefix = "".join("    " if trunk[i] else "│   " for i in range(depth - 1)) + ("└── " if last else "├── ")
            if depth > 0:
                trunk[depth - 1] = last
        cells = []
        for i, v in enumerate(vals):
            right = cols[i][0] in {"size", "links", "block"}
            cells.append(v.rjust(widths[i]) if right else v.ljust(widths[i]))
        line = (" ".join(cells) + (" " if cells else "") + prefix + name).rstrip()
        out.append(line)
    return "\n".join(out) + ("\n" if out else "")


def tree_walk(root: Entry, opts: Options) -> tuple[list[Entry], list[tuple[int, bool]]]:
    result: list[Entry] = [root]
    depths: list[tuple[int, bool]] = [(0, True)]

    def rec(entry: Entry, depth: int):
        if opts.level is not None and depth >= opts.level:
            return
        try:
            children = sort_entries(visible_entries(entry.path, opts), opts)
        except OSError:
            return
        if opts.only_files:
            display_children = [c for c in children if not c.is_dir()]
        else:
            display_children = children
        for i, child in enumerate(display_children):
            result.append(child)
            depths.append((depth + 1, i == len(display_children) - 1))
            if child.is_dir() and not child.is_dot_entry:
                rec(child, depth + 1)
    rec(root, 0)
    return result, depths


def render_path_list(paths: list[str], opts: Options) -> tuple[str, int]:
    files: list[Entry] = []
    dirs: list[Entry] = []
    stderr = ""
    status_code = 0
    for p in paths:
        path = Path(p)
        e = Entry(path, path.name if path.name else str(path))
        try:
            e.lstat()
        except OSError as exc:
            status_code = 2
            msg = win_error_message(getattr(exc, "winerror", None) or exc.errno or 2)
            stderr += f"{p!r}: {msg} (os error {getattr(exc, 'winerror', None) or exc.errno or 2})\n".replace("'", '"')
            continue
        if e.points_to_dir() and not opts.treat_dirs_as_files:
            dirs.append(e)
        else:
            files.append(e)
    files = filter_entries(files, opts, child=False)
    out = ""
    if files:
        out += render_entries(files, opts)
    no_files = not files
    only_dir = len(dirs) == 1 and no_files
    first = no_files
    for d in dirs:
        try:
            if opts.tree:
                root = Entry(d.path, str(d.path), d.is_dot_entry, d._stat, d._lstat)
                entries, depths = tree_walk(root, opts)
                if not first: out += "\n"
                first = False
                out += render_details(entries, opts, depths)
            else:
                children = visible_entries(d.path, opts)
                if not first: out += "\n"
                first = False
                if not only_dir:
                    out += f"{d.path}:\n"
                out += render_entries(children, opts)
                if opts.recurse:
                    for child in sort_entries(children, opts):
                        if child.is_dir() and not child.is_dot_entry:
                            sub_opts = opts
                            sub_out, sub_status = render_path_list([str(child.path)], sub_opts)
                            if sub_out:
                                out += "\n" + sub_out
                            status_code = max(status_code, sub_status)
        except OSError as exc:
            status_code = 2
            stderr += f"{d.path}: {exc}\n"
    return out + ("" if not stderr else "\0" + stderr), status_code


def render_entries(entries: list[Entry], opts: Options) -> str:
    if opts.mode == "lines": return render_lines(entries, opts)
    if opts.mode == "details": return render_details(entries, opts)
    return render_grid(entries, opts)


def main(argv: list[str]) -> int:
    try:
        opts, paths, meta = parse_args(argv)
    except OptionError as e:
        write_stderr(f"eza: {e}\n")
        return 3
    if meta == "help":
        write_stdout(HELP_TEXT)
        return 0
    if meta == "version":
        write_stdout(VERSION_TEXT)
        return 0
    if opts.stdin and paths == ["."]:
        data = sys.stdin.read()
        paths = [p for p in data.split("\n") if p]
    combined, code = render_path_list(paths, opts)
    if "\0" in combined:
        out, err = combined.split("\0", 1)
    else:
        out, err = combined, ""
    write_stdout(out)
    write_stderr(err)
    return code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
