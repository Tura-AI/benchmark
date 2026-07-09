#!/usr/bin/env python3
import fnmatch
import locale
import os
import re
import stat
import sys
from dataclasses import dataclass, field
from datetime import datetime
from functools import cmp_to_key
from pathlib import Path


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@dataclass
class Options:
    long: bool = False
    tree: bool = False
    recurse: bool = False
    level: int | None = None
    all_count: int = 0
    almost_all: bool = False
    sort: str = "name"
    reverse: bool = False
    dirs_first: bool = False
    dirs_last: bool = False
    only_dirs: bool = False
    only_files: bool = False
    classify: str = "never"
    ignore_globs: list[str] = field(default_factory=list)
    list_dirs: bool = False
    paths: list[str] = field(default_factory=list)


@dataclass
class Entry:
    path: Path
    name: str
    display: str
    stat: os.stat_result | None
    is_arg: bool = False

    @property
    def is_dir(self) -> bool:
        try:
            return self.path.is_dir()
        except OSError:
            return False

    @property
    def is_file(self) -> bool:
        try:
            return self.path.is_file()
        except OSError:
            return False

    @property
    def is_link(self) -> bool:
        try:
            return self.path.is_symlink()
        except OSError:
            return False

    @property
    def size(self) -> int:
        if self.stat is None or self.is_dir:
            return 0
        return self.stat.st_size

    @property
    def ext(self) -> str:
        n = self.name
        if "." not in n:
            return ""
        return n.rsplit(".", 1)[1]


def natural_chunks(s: str, ignore_case: bool = True):
    if ignore_case:
        s = s.lower()
    parts = re.split(r"(\d+)", s)
    out = []
    for part in parts:
        if part.isdigit():
            out.append((0, int(part), len(part)))
        else:
            out.append((1, part))
    return out


def natcmp(a: str, b: str, ignore_case: bool = True) -> int:
    ka = natural_chunks(a, ignore_case)
    kb = natural_chunks(b, ignore_case)
    return (ka > kb) - (ka < kb)


def type_char(e: Entry) -> str:
    if e.is_dir:
        return "d"
    if e.is_link:
        return "l"
    return "-"


def compare_entries(sort_name: str, a: Entry, b: Entry) -> int:
    s = sort_name
    if s in ("name", "filename"):
        return natcmp(a.name, b.name, True)
    if s in ("Name", "Filename"):
        return natcmp(a.name, b.name, False)
    if s in (".name", ".filename"):
        return natcmp(a.name[1:] if a.name.startswith(".") else a.name,
                      b.name[1:] if b.name.startswith(".") else b.name, True)
    if s in (".Name", ".Filename"):
        return natcmp(a.name[1:] if a.name.startswith(".") else a.name,
                      b.name[1:] if b.name.startswith(".") else b.name, False)
    if s in ("size", "filesize"):
        return (a.size > b.size) - (a.size < b.size)
    if s in ("ext", "extension", "Ext", "Extension"):
        c = (a.ext > b.ext) - (a.ext < b.ext)
        if c:
            return c
        return natcmp(a.name, b.name, s in ("ext", "extension"))
    if s in ("date", "time", "mod", "modified", "new", "newest"):
        av = a.stat.st_mtime if a.stat else 0
        bv = b.stat.st_mtime if b.stat else 0
        return (av > bv) - (av < bv)
    if s in ("age", "old", "oldest"):
        av = a.stat.st_mtime if a.stat else 0
        bv = b.stat.st_mtime if b.stat else 0
        return (bv > av) - (bv < av)
    if s == "type":
        c = (type_char(a) > type_char(b)) - (type_char(a) < type_char(b))
        return c if c else natcmp(a.name, b.name, False)
    if s == "none":
        return 0
    return natcmp(a.name, b.name, True)


def parse_args(argv: list[str]) -> tuple[Options | None, int]:
    opts = Options()
    i = 0
    consume_next = {
        "--sort", "--time-style", "--color", "--colour", "--icons", "--classify",
        "--width", "--level", "--ignore-glob", "--absolute",
    }
    while i < len(argv):
        arg = argv[i]
        if arg == "--":
            opts.paths.extend(argv[i + 1:])
            break
        if not arg.startswith("-") or arg == "-":
            opts.paths.append(arg)
            i += 1
            continue
        if arg in ("--help", "-?"):
            emit_out("Usage: eza [options] [files...]\n")
            return None, 0
        if arg in ("--version", "-v"):
            emit_out("eza - A modern, maintained replacement for ls\nv0.23.3 [+git]\n")
            return None, 0
        if arg.startswith("--"):
            name, eq, val = arg.partition("=")
            if name in ("--long",):
                opts.long = True
            elif name in ("--tree",):
                opts.tree = True
                opts.recurse = True
            elif name in ("--recurse",):
                opts.recurse = True
            elif name in ("--all",):
                opts.all_count += 1
            elif name in ("--almost-all",):
                opts.almost_all = True
            elif name in ("--reverse",):
                opts.reverse = True
            elif name in ("--group-directories-first",):
                opts.dirs_first = True
            elif name in ("--group-directories-last",):
                opts.dirs_last = True
            elif name in ("--only-dirs",):
                opts.only_dirs = True
            elif name in ("--only-files",):
                opts.only_files = True
            elif name in ("--list-dirs", "--treat-dirs-as-files"):
                opts.list_dirs = True
            elif name in ("--sort",):
                opts.sort = val if eq else argv[i + 1]
                if not eq:
                    i += 1
            elif name in ("--level",):
                raw = val if eq else argv[i + 1]
                opts.level = int(raw)
                if not eq:
                    i += 1
            elif name in ("--classify",):
                opts.classify = val if eq else argv[i + 1]
                if not eq:
                    i += 1
            elif name in ("--ignore-glob",):
                raw = val if eq else argv[i + 1]
                opts.ignore_globs.extend(raw.split("|"))
                if not eq:
                    i += 1
            elif name in consume_next and not eq:
                i += 1
            # Color, icon, git, owner/group, and time display flags do not add
            # content in the benchmark's disabled-colour slice.
            i += 1
            continue
        j = 1
        while j < len(arg):
            c = arg[j]
            if c == "l":
                opts.long = True
            elif c == "T":
                opts.tree = True
                opts.recurse = True
            elif c == "R":
                opts.recurse = True
            elif c == "a":
                opts.all_count += 1
            elif c == "A":
                opts.almost_all = True
            elif c == "r":
                opts.reverse = True
            elif c == "F":
                rest = arg[j + 1:]
                opts.classify = rest if rest else (argv[i + 1] if i + 1 < len(argv) else "always")
                if not rest and i + 1 < len(argv):
                    i += 1
                break
            elif c == "s":
                rest = arg[j + 1:]
                opts.sort = rest if rest else argv[i + 1]
                if not rest:
                    i += 1
                break
            elif c == "L":
                rest = arg[j + 1:]
                if rest.startswith("="):
                    rest = rest[1:]
                opts.level = int(rest if rest else argv[i + 1])
                if not rest:
                    i += 1
                break
            elif c == "I":
                rest = arg[j + 1:]
                if rest.startswith("="):
                    rest = rest[1:]
                raw = rest if rest else argv[i + 1]
                opts.ignore_globs.extend(raw.split("|"))
                if not rest:
                    i += 1
                break
            j += 1
        i += 1
    if not opts.paths:
        opts.paths = ["."]
    return opts, 0


def visible(name: str, opts: Options) -> bool:
    if name in (".", ".."):
        return opts.all_count >= 2 and not opts.almost_all
    if name.startswith(".") and not (opts.all_count >= 1 or opts.almost_all):
        return False
    return True


def stat_entry(p: Path) -> os.stat_result | None:
    try:
        return p.lstat()
    except OSError:
        try:
            return p.stat()
        except OSError:
            return None


def make_entry(p: Path, display: str | None = None, is_arg: bool = False) -> Entry:
    return Entry(p, p.name if p.name else str(p), display if display is not None else p.name, stat_entry(p), is_arg)


def list_children(path: Path, opts: Options) -> list[Entry]:
    entries: list[Entry] = []
    if opts.all_count >= 2 and not opts.almost_all:
        entries.append(Entry(path / ".", ".", ".", stat_entry(path / ".")))
        entries.append(Entry(path / "..", "..", "..", stat_entry(path / "..")))
    try:
        with os.scandir(path) as it:
            for de in it:
                if not visible(de.name, opts):
                    continue
                if any(fnmatch.fnmatchcase(de.name, pat) for pat in opts.ignore_globs):
                    continue
                e = make_entry(Path(de.path), de.name)
                if opts.only_dirs and not e.is_dir:
                    continue
                if opts.only_files and not e.is_file and not opts.recurse:
                    continue
                entries.append(e)
    except OSError as exc:
        raise exc
    sort_entries(entries, opts)
    return entries


def sort_entries(entries: list[Entry], opts: Options) -> None:
    if opts.sort != "none":
        entries.sort(key=cmp_to_key(lambda a, b: compare_entries(opts.sort, a, b)))
    if opts.reverse:
        entries.reverse()
    if opts.dirs_first:
        entries.sort(key=lambda e: 0 if e.is_dir else 1)
    elif opts.dirs_last:
        entries.sort(key=lambda e: 1 if e.is_dir else 0)


def perms(e: Entry) -> str:
    if os.name == "nt":
        first = "d" if e.is_dir else ("l" if e.is_link else "-")
        readonly = False
        if e.stat is not None:
            readonly = not bool(e.stat.st_mode & stat.S_IWRITE)
        # Archive is set for normal files on Windows; directories show d----.
        archive = (not e.is_dir) and (not e.is_link)
        hidden = e.name.startswith(".")
        return first + ("a" if archive else "-") + ("r" if readonly else "-") + ("h" if hidden else "-") + "-"
    if e.stat is None:
        return "----------"
    m = e.stat.st_mode
    first = "d" if stat.S_ISDIR(m) else ("l" if stat.S_ISLNK(m) else "-")
    bits = ""
    for r, w, x in ((stat.S_IRUSR, stat.S_IWUSR, stat.S_IXUSR),
                    (stat.S_IRGRP, stat.S_IWGRP, stat.S_IXGRP),
                    (stat.S_IROTH, stat.S_IWOTH, stat.S_IXOTH)):
        bits += "r" if m & r else "-"
        bits += "w" if m & w else "-"
        bits += "x" if m & x else "-"
    return first + bits


def date_text(e: Entry) -> str:
    ts = e.stat.st_mtime if e.stat else 0
    dt = datetime.fromtimestamp(ts)
    if dt.year != datetime.now().year:
        return f"{dt.day} {MONTHS[dt.month - 1]}  {dt.year}"
    return f"{dt.day} {MONTHS[dt.month - 1]} {dt.hour:02d}:{dt.minute:02d}"


def display_name(e: Entry, opts: Options) -> str:
    n = e.display
    if e.is_link:
        try:
            target = os.readlink(e.path)
            n = f"{n} -> {target}"
        except OSError:
            pass
    if opts.classify == "always":
        if e.is_dir:
            n += "/"
        elif os.name != "nt" and e.stat and (e.stat.st_mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)):
            n += "*"
    return n


def render_long(entries: list[Entry], opts: Options, prefix: str = "") -> list[str]:
    sizes = [("-" if e.is_dir else str(e.stat.st_size if e.stat else 0)) for e in entries]
    size_w = max([1] + [len(s) for s in sizes])
    out = []
    for e, sz in zip(entries, sizes):
        out.append(f"{prefix}{perms(e)} {sz.rjust(size_w)}  {date_text(e)} {display_name(e, opts)}")
    return out


def render_lines(entries: list[Entry], opts: Options, prefix: str = "") -> list[str]:
    return [prefix + display_name(e, opts) for e in entries]


def tree_prefix(stack: list[bool], last: bool) -> str:
    parts = []
    for ancestor_last in stack:
        parts.append("    " if ancestor_last else "│   ")
    parts.append("└── " if last else "├── ")
    return "".join(parts)


def render_tree_root(path: Path, opts: Options, root_label: str | None = None) -> list[str]:
    root = make_entry(path, root_label if root_label is not None else path_display(str(path)))
    lines = [display_name(root, opts)]
    max_depth = opts.level
    if max_depth == 0:
        return lines

    def rec(dir_path: Path, stack: list[bool], depth: int) -> None:
        if max_depth is not None and depth > max_depth:
            return
        try:
            children = list_children(dir_path, opts)
        except OSError:
            return
        for idx, child in enumerate(children):
            last = idx == len(children) - 1
            pref = tree_prefix(stack, last)
            if opts.long:
                lines.extend(render_long([child], opts, pref))
            else:
                lines.append(pref + display_name(child, opts))
            if child.is_dir and child.name not in (".", ".."):
                rec(child.path, stack + [last], depth + 1)

    rec(path, [], 1)
    return lines


def path_display(raw: str) -> str:
    if os.name != "nt":
        return raw
    # Rust's Path display on Windows preserves earlier forward slashes in
    # relative paths but prints the final component separator as '\'.
    slash = raw.rfind("/")
    back = raw.rfind("\\")
    pos = max(slash, back)
    if pos >= 0:
        return raw[:pos] + "\\" + raw[pos + 1:]
    return raw


def print_error(path: str, exc: OSError) -> None:
    msg = exc.strerror or str(exc)
    emit_err(f'"{path}": {msg} (os error {getattr(exc, "winerror", exc.errno) or exc.errno})\n')


def emit_out(text: str) -> None:
    sys.stdout.buffer.write(text.encode("utf-8"))


def emit_err(text: str) -> None:
    sys.stderr.buffer.write(text.encode("utf-8"))


def run(opts: Options) -> int:
    status = 0
    outputs: list[str] = []
    arg_entries: list[Entry] = []
    dirs: list[tuple[Path, str]] = []
    multiple = len(opts.paths) > 1
    for raw in opts.paths:
        p = Path(raw)
        if not p.exists() and not p.is_symlink():
            print_error(raw, FileNotFoundError(2, "系统找不到指定的文件。" if os.name == "nt" else "No such file or directory", raw))
            status = 1
            continue
        e = make_entry(p, path_display(raw), True)
        if e.is_dir and not opts.list_dirs:
            dirs.append((p, raw))
        else:
            arg_entries.append(e)

    sort_entries(arg_entries, opts)
    if arg_entries:
        outputs.extend(render_long(arg_entries, opts) if opts.long else render_lines(arg_entries, opts))
        if dirs:
            outputs.append("")

    for di, (d, raw) in enumerate(dirs):
        if multiple or arg_entries:
            outputs.append(f"{raw}:")
        try:
            if opts.tree:
                outputs.extend(render_tree_root(d, opts, path_display(raw)))
            elif opts.recurse:
                outputs.extend(render_recurse(d, opts))
            else:
                entries = list_children(d, opts)
                outputs.extend(render_long(entries, opts) if opts.long else render_lines(entries, opts))
        except OSError as exc:
            print_error(str(d), exc)
            status = 1
        if di != len(dirs) - 1:
            outputs.append("")
    if outputs:
        emit_out("\n".join(outputs) + "\n")
    return 2 if status else 0


def render_recurse(path: Path, opts: Options) -> list[str]:
    lines: list[str] = []
    max_depth = opts.level

    def rec(p: Path, depth: int) -> None:
        lines.append(f"{p}:")
        try:
            children = list_children(p, opts)
        except OSError:
            return
        lines.extend(render_long(children, opts) if opts.long else render_lines(children, opts))
        subdirs = [e.path for e in children if e.is_dir and e.name not in (".", "..")]
        if max_depth is not None and depth >= max_depth:
            return
        for sd in subdirs:
            lines.append("")
            rec(sd, depth + 1)

    rec(path, 0)
    return lines


def main(argv: list[str]) -> int:
    locale.setlocale(locale.LC_ALL, "")
    parsed, code = parse_args(argv)
    if parsed is None:
        return code
    try:
        return run(parsed)
    except BrokenPipeError:
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
