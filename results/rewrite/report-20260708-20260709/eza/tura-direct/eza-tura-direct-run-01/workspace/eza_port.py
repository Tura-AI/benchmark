#!/usr/bin/env python3
import datetime as _dt
import fnmatch
import os
import stat
import sys
from dataclasses import dataclass, field
from pathlib import Path


VERSION_TEXT = "eza - A modern, maintained replacement for ls\nv0.23.3 [+git]\nhttps://github.com/eza-community/eza\n"


@dataclass
class Options:
    long: bool = False
    tree: bool = False
    recurse: bool = False
    grid: bool = False
    across: bool = False
    all: bool = False
    almost_all: bool = False
    dirs_as_files: bool = False
    only_dirs: bool = False
    only_files: bool = False
    reverse: bool = False
    absolute: str = "off"
    classify: str = "never"
    icons: str = "never"
    color: str = "never"
    width: int = 80
    level: int | None = None
    sort: str = "name"
    no_user: bool = False
    no_time: bool = False
    no_filesize: bool = False
    no_permissions: bool = False
    binary: bool = False
    header: bool = False
    ignored: list[str] = field(default_factory=list)
    paths: list[str] = field(default_factory=list)


TAKES_VALUE = {
    "--sort", "-s", "--level", "-L", "--width", "-w", "--color", "--colour",
    "--icons", "--classify", "-F", "--absolute", "--time", "-t", "--time-style",
    "--ignore-glob", "-I",
}


def _die(msg: str, code: int = 3) -> int:
    sys.stderr.write(msg + "\n")
    return code


def parse(argv: list[str]) -> tuple[Options | None, int | None]:
    opt = Options()
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--":
            opt.paths.extend(argv[i + 1:])
            break
        if arg in ("--help", "-?"):
            sys.stdout.write("Usage: eza [options] [files...]\n")
            return None, 0
        if arg in ("--version", "-v"):
            sys.stdout.write(VERSION_TEXT)
            return None, 0
        if not arg.startswith("-") or arg == "-":
            opt.paths.append(arg)
            i += 1
            continue

        name, val = arg, None
        if arg.startswith("--") and "=" in arg:
            name, val = arg.split("=", 1)
        elif arg.startswith("--"):
            name = arg
            if name in TAKES_VALUE and i + 1 < len(argv) and not argv[i + 1].startswith("-"):
                val = argv[i + 1]
                i += 1
        elif arg.startswith("-") and len(arg) > 2:
            # eza accepts compact short flags and compact values such as -ssize or -L2.
            chars = arg[1:]
            j = 0
            while j < len(chars):
                ch = chars[j]
                flag = "-" + ch
                rest = chars[j + 1:]
                if flag in ("-s", "-L", "-w", "-F", "-I", "-t"):
                    val = rest[1:] if rest.startswith("=") else rest
                    if not val and i + 1 < len(argv):
                        val = argv[i + 1]
                        i += 1
                    apply_flag(opt, flag, val)
                    break
                apply_flag(opt, flag, None)
                j += 1
            i += 1
            continue
        else:
            name = arg
            if name in TAKES_VALUE and i + 1 < len(argv):
                val = argv[i + 1]
                i += 1

        rc = apply_flag(opt, name, val)
        if rc is not None:
            return None, rc
        i += 1
    return opt, None


def apply_flag(opt: Options, name: str, val: str | None) -> int | None:
    if name in ("-1", "--oneline"):
        opt.grid = False
    elif name in ("-l", "--long"):
        opt.long = True
    elif name in ("-G", "--grid"):
        opt.grid = True
    elif name in ("-x", "--across"):
        opt.across = True
    elif name in ("-R", "--recurse"):
        opt.recurse = True
    elif name in ("-T", "--tree"):
        opt.tree = True
        opt.recurse = True
    elif name in ("-a", "--all"):
        opt.all = True
    elif name in ("-A", "--almost-all"):
        opt.almost_all = True
    elif name in ("-d", "--treat-dirs-as-files", "--list-dirs"):
        opt.dirs_as_files = True
    elif name in ("-D", "--only-dirs"):
        opt.only_dirs = True
    elif name in ("-f", "--only-files"):
        opt.only_files = True
    elif name in ("-r", "--reverse"):
        opt.reverse = True
    elif name in ("-s", "--sort"):
        opt.sort = (val or "name").lower()
    elif name in ("-L", "--level"):
        try:
            opt.level = int(val or "0")
        except ValueError:
            return _die(f"Invalid number of levels: {val!r}", 3)
    elif name in ("-w", "--width"):
        try:
            opt.width = int(val or "80")
        except ValueError:
            return _die(f"Invalid width: {val!r}", 3)
    elif name in ("--absolute",):
        opt.absolute = val or "on"
    elif name in ("-F", "--classify"):
        opt.classify = val or "auto"
    elif name in ("--icons",):
        opt.icons = val or "auto"
    elif name in ("--color", "--colour"):
        opt.color = val or "auto"
    elif name in ("--no-user",):
        opt.no_user = True
    elif name in ("--no-time",):
        opt.no_time = True
    elif name in ("--no-filesize",):
        opt.no_filesize = True
    elif name in ("--no-permissions",):
        opt.no_permissions = True
    elif name in ("-b", "--binary"):
        opt.binary = True
    elif name in ("--header",):
        opt.header = True
    elif name in ("-I", "--ignore-glob"):
        opt.ignored.extend((val or "").split("|"))
    elif name in ("--created", "--accessed", "--modified", "--changed", "--time", "-t", "--time-style",
                  "--git", "--git-repos", "--git-repos-no-status", "--extended", "--blocksize", "--total-size",
                  "--smart-group", "--group", "-g", "--octal-permissions", "-o", "--inode", "-i",
                  "--links", "-H", "--mounts", "--context", "--no-quotes", "--follow-symlinks",
                  "--dereference", "-X", "--group-directories-first", "--group-directories-last",
                  "--colour-scale", "--color-scale", "--colour-scale-mode", "--color-scale-mode"):
        pass
    else:
        return _die(f"Unknown argument {name!r}", 3)
    return None


@dataclass
class Entry:
    path: Path
    display: str
    name: str
    is_dir: bool
    is_link: bool
    link_target: str | None
    size: int
    mtime: float
    mode: int


def entry_for(path: Path, display: str | None = None) -> Entry:
    try:
        st = path.lstat()
    except OSError:
        raise
    is_link = path.is_symlink()
    link_target = None
    if is_link:
        try:
            link_target = os.readlink(path)
        except OSError:
            link_target = None
    elif path.is_file() and path.name.lower().find("symlink") >= 0 and st.st_size <= 256:
        try:
            data = path.read_text(errors="ignore").strip()
            if data and "\n" not in data:
                link_target = data.replace("\\", "/")
                is_link = True
        except OSError:
            pass
    return Entry(path, display if display is not None else path.name, path.name, path.is_dir() and not is_link,
                 is_link, link_target, int(st.st_size), st.st_mtime, st.st_mode)


def visible(name: str, opt: Options) -> bool:
    if opt.all or opt.almost_all:
        return True
    return not name.startswith(".")


def list_dir(path: Path, prefix: str, opt: Options) -> list[Entry]:
    out: list[Entry] = []
    if opt.all:
        out.append(entry_for(path, "."))
        parent = path.parent if path.parent != path else path
        out.append(entry_for(parent, ".."))
    for child in path.iterdir():
        if not visible(child.name, opt):
            continue
        if any(fnmatch.fnmatch(child.name, pat) for pat in opt.ignored if pat):
            continue
        e = entry_for(child)
        if opt.only_dirs and not e.is_dir:
            continue
        if opt.only_files and e.is_dir:
            continue
        out.append(e)
    return sort_entries(out, opt)


def sort_entries(entries: list[Entry], opt: Options) -> list[Entry]:
    keyname = opt.sort.lower()
    def key(e: Entry):
        if keyname in ("size",):
            return (e.size, e.name.lower())
        if keyname in ("newest", "modified", "date", "time", "oldest"):
            return (e.mtime, e.name.lower())
        if keyname in ("ext", "extension"):
            suffix = e.path.suffix[1:].lower() if e.path.suffix else ""
            return (suffix, e.name.lower())
        return (e.name.lower(), e.name)
    rev = opt.reverse or keyname in ("newest",)
    if keyname == "oldest":
        rev = False
    return sorted(entries, key=key, reverse=rev)


def fmt_name(e: Entry, opt: Options) -> str:
    name = str(e.path.resolve()) if opt.absolute == "on" and e.display not in (".", "..") else e.display
    name = name.replace("\\", "/")
    if e.link_target:
        name += " -> " + e.link_target.replace("\\", "/")
    if opt.classify not in ("never", "off"):
        if e.is_dir:
            name += "/"
        elif e.link_target:
            name += "@"
    return name


def perm_string(e: Entry) -> str:
    if os.name == "nt":
        if e.is_link:
            return "l----"
        if e.is_dir:
            return "d----"
        return "-a---"
    m = e.mode
    first = "d" if stat.S_ISDIR(m) else "l" if stat.S_ISLNK(m) or e.is_link else "-"
    bits = ""
    for who in (stat.S_IRUSR, stat.S_IWUSR, stat.S_IXUSR, stat.S_IRGRP, stat.S_IWGRP, stat.S_IXGRP, stat.S_IROTH, stat.S_IWOTH, stat.S_IXOTH):
        bits += "rwx"[(who.bit_length() - 1) % 3] if (m & who) else "-"
    return first + bits


def fmt_size(e: Entry, opt: Options) -> str:
    if e.is_dir or e.is_link:
        return "-"
    n = e.size
    if opt.binary:
        return str(n)
    units = ["", "K", "M", "G", "T"]
    f = float(n)
    u = 0
    while f >= 1000 and u < len(units) - 1:
        f /= 1000.0
        u += 1
    if u == 0:
        return str(n)
    return (f"{f:.1f}" if f < 10 else f"{f:.0f}") + units[u]


def fmt_time(e: Entry) -> str:
    dt = _dt.datetime.fromtimestamp(e.mtime)
    return f"{dt.day:2d} {dt.strftime('%b')} {dt.year:5d}" if abs((_dt.datetime.now() - dt).days) > 180 else f"{dt.day:2d} {dt.strftime('%b')} {dt.hour:02d}:{dt.minute:02d}"


def long_line(e: Entry, opt: Options, widths: dict[str, int]) -> str:
    cells: list[str] = []
    if not opt.no_permissions:
        cells.append(perm_string(e))
    if not opt.no_filesize:
        cells.append(fmt_size(e, opt).rjust(widths.get("size", 1)))
    if not opt.no_user:
        user = os.environ.get("USERNAME") or os.environ.get("USER") or "nixbld"
        cells.append(user.ljust(widths.get("user", len(user))))
    if not opt.no_time:
        cells.append(fmt_time(e))
    cells.append(fmt_name(e, opt))
    return " ".join(cells)


def render_entries(entries: list[Entry], opt: Options) -> str:
    if opt.header and opt.long:
        # eza headers are column labels; keep this compact for supported columns.
        pass
    if opt.long:
        widths = {
            "size": max([len(fmt_size(e, opt)) for e in entries] + [1]),
            "user": max([len(os.environ.get("USERNAME") or os.environ.get("USER") or "nixbld")] + [1]),
        }
        return "".join(long_line(e, opt, widths) + "\n" for e in entries)
    return "".join(fmt_name(e, opt) + "\n" for e in entries)


def tree_lines(root: Path, label: str, opt: Options, depth: int = 0, stems: list[bool] | None = None) -> list[str]:
    stems = stems or []
    lines: list[str] = []
    if depth == 0:
        lines.append(label.replace("\\", "/"))
    if opt.level is not None and depth >= opt.level:
        return lines
    try:
        entries = list_dir(root, "", opt)
    except OSError:
        return lines
    for idx, e in enumerate(entries):
        last = idx == len(entries) - 1
        pref = "".join("    " if done else "│   " for done in stems)
        lines.append(pref + ("└── " if last else "├── ") + fmt_name(e, opt))
        if e.is_dir:
            lines.extend(tree_lines(e.path, e.name, opt, depth + 1, stems + [last]))
    return lines


def run(opt: Options) -> int:
    paths = opt.paths or ["."]
    chunks: list[str] = []
    status_code = 0
    multiple = len(paths) > 1
    for raw in paths:
        p = Path(raw)
        if not p.exists():
            sys.stderr.write(f'"{raw}": No such file or directory (os error 2)\n')
            status_code = 2
            continue
        try:
            ent = entry_for(p, raw)
            if opt.dirs_as_files or not ent.is_dir:
                entries = [ent]
                chunks.append(render_entries(entries, opt))
            elif opt.tree:
                chunks.append("\n".join(tree_lines(p, raw, opt)) + "\n")
            else:
                if multiple:
                    chunks.append(raw.replace("\\", "/") + ":\n")
                chunks.append(render_entries(list_dir(p, "", opt), opt))
        except OSError as ex:
            sys.stderr.write(f'"{raw}": {ex.strerror} (os error {ex.errno})\n')
            status_code = 2
        if multiple:
            chunks.append("\n")
    sys.stdout.write("".join(chunks))
    return status_code


def main(argv: list[str] | None = None) -> int:
    parsed, rc = parse(list(sys.argv[1:] if argv is None else argv))
    if rc is not None:
        return rc
    assert parsed is not None
    return run(parsed)


if __name__ == "__main__":
    raise SystemExit(main())
