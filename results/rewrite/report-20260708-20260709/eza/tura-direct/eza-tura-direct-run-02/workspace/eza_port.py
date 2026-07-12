#!/usr/bin/env python3
import fnmatch
import os
import re
import stat
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path


VERSION_TEXT = """eza - A modern, maintained replacement for ls
v0.23.3 [+git]
https://github.com/eza-community/eza
"""

HELP_TEXT = """Usage:
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


TAKES_VALUE = {
    "sort": "required", "level": "required", "ignore-glob": "required", "width": "required",
    "time": "required", "time-style": "required", "color-scale-mode": "required",
    "colour-scale-mode": "required",
    "classify": "optional", "color": "optional", "colour": "optional", "icons": "optional",
    "color-scale": "optional", "colour-scale": "optional", "absolute": "optional",
}

LONG_TO_SHORT = {
    "help": "?", "version": "v", "oneline": "1", "long": "l", "grid": "G", "across": "x",
    "recurse": "R", "tree": "T", "classify": "F", "dereference": "X", "width": "w",
    "all": "a", "almost-all": "A", "treat-dirs-as-files": "d", "level": "L", "reverse": "r",
    "sort": "s", "ignore-glob": "I", "only-dirs": "D", "only-files": "f", "binary": "b",
    "bytes": "B", "group": "g", "numeric": "n", "header": "h", "inode": "i", "links": "H",
    "modified": "m", "blocksize": "S", "time": "t", "accessed": "u", "created": "U",
    "mounts": "M", "extended": "@", "octal-permissions": "o", "context": "Z", "flags": "O",
}
SHORT_TO_LONG = {v: k for k, v in LONG_TO_SHORT.items()}
for _name in [
    "no-quotes", "absolute", "follow-symlinks", "color", "colour", "color-scale", "colour-scale",
    "color-scale-mode", "colour-scale-mode", "list-dirs", "git-ignore", "group-directories-first",
    "group-directories-last", "no-symlinks", "show-symlinks", "icons", "changed", "time-style",
    "hyperlink", "smart-group", "no-permissions", "no-filesize", "no-user", "no-time", "git",
    "no-git", "git-repos", "git-repos-no-status", "stdin",
]:
    LONG_TO_SHORT.setdefault(_name, None)

SORT_CHOICES = ["name", "Name", "size", "extension", "Extension", "modified", "changed", "accessed", "created", "inode", "type", "none"]
SORT_ALIASES = {
    "name": "name", "filename": "name", "Name": "Name", "Filename": "Name",
    ".name": ".name", ".filename": ".name", ".Name": ".Name", ".Filename": ".Name",
    "size": "size", "filesize": "size", "ext": "extension", "extension": "extension",
    "Ext": "Extension", "Extension": "Extension", "date": "modified", "time": "modified",
    "mod": "modified", "modified": "modified", "new": "modified", "newest": "modified",
    "age": "age", "old": "age", "oldest": "age", "ch": "changed", "changed": "changed",
    "acc": "accessed", "accessed": "accessed", "cr": "created", "created": "created",
    "inode": "inode", "type": "type", "none": "none",
}


@dataclass
class Opts:
    flags: list = field(default_factory=list)
    values: dict = field(default_factory=dict)
    paths: list = field(default_factory=list)
    all_count: int = 0
    almost_all: bool = False
    long_view: bool = False
    tree: bool = False
    recurse: bool = False
    as_file: bool = False
    reverse: bool = False
    sort: str = "name"
    ignore_globs: list = field(default_factory=list)
    only_dirs: bool = False
    only_files: bool = False
    no_symlinks: bool = False
    show_symlinks: bool = False
    dirs_first: bool = False
    dirs_last: bool = False
    no_permissions: bool = False
    no_filesize: bool = False
    no_user: bool = False
    no_time: bool = False
    classify: str = "never"
    absolute: str = "off"
    level: int | None = None


class EzaError(Exception):
    def __init__(self, msg, code=3):
        super().__init__(msg)
        self.code = code


def flag_name(name):
    short = LONG_TO_SHORT.get(name)
    if short:
        return f"--{name} (-{short})"
    return f"--{name}"


def parse_args(argv):
    opts = Opts()
    i = 0
    parsing_flags = True
    while i < len(argv):
        arg = argv[i]
        if parsing_flags and arg == "--":
            parsing_flags = False
            i += 1
            continue
        if parsing_flags and arg.startswith("--") and len(arg) > 2:
            raw = arg[2:]
            name, eq, val = raw.partition("=")
            if name not in LONG_TO_SHORT:
                raise EzaError(f"Unknown argument --{name}")
            mode = TAKES_VALUE.get(name, "forbidden")
            if mode == "required":
                if eq:
                    value = val
                else:
                    i += 1
                    if i >= len(argv):
                        raise EzaError(f"Flag --{name} needs a value")
                    value = argv[i]
                add_flag(opts, name, value)
            elif mode == "optional":
                if eq:
                    value = val
                elif i + 1 < len(argv) and not argv[i + 1].startswith("-") and optional_accepts(name, argv[i + 1]):
                    i += 1
                    value = argv[i]
                else:
                    value = optional_default(name)
                add_flag(opts, name, value)
            else:
                if eq:
                    raise EzaError(f"Option --{name} doesn't allow a value")
                add_flag(opts, name, None)
            i += 1
            continue
        if parsing_flags and arg.startswith("-") and arg != "-":
            cluster = arg[1:]
            j = 0
            while j < len(cluster):
                ch = cluster[j]
                if ch not in SHORT_TO_LONG:
                    raise EzaError(f"Unknown argument -{ch}")
                name = SHORT_TO_LONG[ch]
                mode = TAKES_VALUE.get(name, "forbidden")
                if mode == "required":
                    rest = cluster[j + 1:]
                    if rest.startswith("="):
                        rest = rest[1:]
                    if rest:
                        value = rest
                    else:
                        i += 1
                        if i >= len(argv):
                            raise EzaError(f"Flag -{ch} needs a value")
                        value = argv[i]
                    add_flag(opts, name, value)
                    break
                if mode == "optional":
                    rest = cluster[j + 1:]
                    if rest.startswith("="):
                        rest = rest[1:]
                    if rest:
                        value = rest
                        add_flag(opts, name, value)
                        break
                    add_flag(opts, name, optional_default(name))
                else:
                    add_flag(opts, name, None)
                j += 1
            i += 1
            continue
        opts.paths.append(arg)
        i += 1
    finalize(opts)
    return opts


def optional_default(name):
    if name in ("classify", "color", "colour", "icons"):
        return "auto"
    if name in ("absolute",):
        return "on"
    return "all"


def optional_accepts(name, value):
    choices = {
        "classify": {"always", "auto", "never"},
        "color": {"always", "auto", "never"},
        "colour": {"always", "auto", "never"},
        "icons": {"always", "auto", "never"},
        "absolute": {"on", "follow", "off"},
        "color-scale": {"all", "size", "age"},
        "colour-scale": {"all", "size", "age"},
    }
    return value in choices.get(name, set())


def add_flag(opts, name, value):
    opts.flags.append((name, value))
    opts.values[name] = value
    if name == "all":
        opts.all_count += 1
    elif name == "almost-all":
        opts.almost_all = True
    elif name == "long":
        opts.long_view = True
    elif name == "tree":
        opts.tree = True
    elif name == "recurse":
        opts.recurse = True
    elif name in ("treat-dirs-as-files", "list-dirs"):
        opts.as_file = True
    elif name == "reverse":
        opts.reverse = True
    elif name == "ignore-glob":
        opts.ignore_globs = value.split("|") if value is not None else []
    elif name == "only-dirs":
        opts.only_dirs = True
    elif name == "only-files":
        opts.only_files = True
    elif name == "no-symlinks":
        opts.no_symlinks = True
    elif name == "show-symlinks":
        opts.show_symlinks = True
    elif name == "group-directories-first":
        opts.dirs_first = True
    elif name == "group-directories-last":
        opts.dirs_last = True
    elif name == "no-permissions":
        opts.no_permissions = True
    elif name == "no-filesize":
        opts.no_filesize = True
    elif name == "no-user":
        opts.no_user = True
    elif name == "no-time":
        opts.no_time = True
    elif name == "classify":
        opts.classify = value
    elif name == "absolute":
        opts.absolute = value


def finalize(opts):
    if "help" in opts.values:
        return
    if "version" in opts.values:
        return
    if "sort" in opts.values:
        word = opts.values["sort"]
        if word not in SORT_ALIASES:
            raise EzaError(f"Option --sort (-s) has no \"{word}\" setting (choices: {', '.join(SORT_CHOICES)})")
        opts.sort = SORT_ALIASES[word]
    if "level" in opts.values:
        s = opts.values["level"]
        try:
            opts.level = int(s, 10)
        except ValueError:
            raise EzaError(f"Value \"{s}\" not valid for option --level (-L): invalid digit found in string")
    if opts.tree and opts.all_count >= 2:
        raise EzaError("Option --tree is useless given --all --all")
    if not opts.paths:
        opts.paths = ["."]


@dataclass
class Entry:
    path: Path
    name: str
    display: str | None = None
    is_dotdot: bool = False

    def exists(self):
        return self.path.exists() or self.path.is_symlink()

    def is_dir(self):
        return self.path.is_dir()

    def is_file(self):
        return self.path.is_file() and not self.path.is_dir()

    def is_link(self):
        return self.path.is_symlink()

    def stat(self):
        try:
            return self.path.lstat()
        except OSError:
            return None

    def size(self):
        st = self.stat()
        if st is None:
            return 0
        if self.is_dir() and not self.is_link():
            return None
        return st.st_size

    def mtime(self):
        st = self.stat()
        return st.st_mtime if st else 0

    def ctime(self):
        st = self.stat()
        return st.st_ctime if st else 0

    def atime(self):
        st = self.stat()
        return st.st_atime if st else 0

    def ext(self):
        if self.name.startswith(".") and self.name.count(".") == 1:
            return self.name[1:]
        suffix = Path(self.name).suffix
        return suffix[1:] if suffix.startswith(".") else suffix


def natural_key(s, ignore_case=True):
    if ignore_case:
        s = s.lower()
    out = []
    for part in re.split(r"(\d+)", s):
        out.append((0, int(part)) if part.isdigit() else (1, part))
    return out


def visible_entries(path, opts):
    entries = []
    if opts.all_count >= 2:
        entries.append(Entry(path / ".", ".", is_dotdot=True))
        entries.append(Entry(path / "..", "..", is_dotdot=True))
    try:
        names = os.listdir(path)
    except OSError as e:
        raise EzaError(str(e), 1)
    show_hidden = opts.all_count >= 1 or opts.almost_all
    for name in names:
        if not show_hidden and (name.startswith(".") or name.startswith("_")):
            continue
        if any(fnmatch.fnmatchcase(name, pat) for pat in opts.ignore_globs):
            continue
        ent = Entry(Path(path) / name, name)
        if opts.no_symlinks and ent.is_link():
            continue
        if opts.only_dirs and not (ent.is_dir() or (opts.show_symlinks and ent.is_link())):
            continue
        if opts.only_files and not ent.is_file() and not (opts.show_symlinks and ent.is_link() and not ent.is_dir()):
            continue
        entries.append(ent)
    return sort_entries(entries, opts)


def sort_entries(entries, opts):
    if opts.sort == "none":
        result = list(entries)
    else:
        def key(e):
            if opts.sort == "name":
                k = natural_key(e.name, True)
            elif opts.sort == "Name":
                k = natural_key(e.name, False)
            elif opts.sort == ".name":
                k = natural_key(e.name[1:] if e.name.startswith(".") else e.name, True)
            elif opts.sort == ".Name":
                k = natural_key(e.name[1:] if e.name.startswith(".") else e.name, False)
            elif opts.sort == "size":
                k = (e.size() if e.size() is not None else 0, natural_key(e.name, True))
            elif opts.sort == "extension":
                k = (e.ext(), natural_key(e.name, True))
            elif opts.sort == "Extension":
                k = (e.ext(), natural_key(e.name, False))
            elif opts.sort == "modified":
                k = (e.mtime(), natural_key(e.name, True))
            elif opts.sort == "age":
                k = (-e.mtime(), natural_key(e.name, True))
            elif opts.sort == "changed" or opts.sort == "created":
                k = (e.ctime(), natural_key(e.name, True))
            elif opts.sort == "accessed":
                k = (e.atime(), natural_key(e.name, True))
            elif opts.sort == "type":
                k = (type_char(e), natural_key(e.name, True))
            else:
                k = natural_key(e.name, True)
            group = 0
            if opts.dirs_first:
                group = 0 if e.is_dir() else 1
            elif opts.dirs_last:
                group = 1 if e.is_dir() else 0
            return (group, k)
        result = sorted(entries, key=key)
    if opts.reverse:
        result.reverse()
    return result


def type_char(e):
    if e.is_dir():
        return "d"
    if e.is_link():
        return "l"
    return "-"


def display_name(e, opts, show_link=True):
    if opts.absolute == "on":
        base = str((Path.cwd() / e.path).resolve(strict=False))
    elif opts.absolute == "follow":
        base = str(e.path.resolve(strict=False))
    else:
        base = e.display if e.display is not None else e.name
    if show_link and e.is_link() and opts.long_view:
        try:
            base += " -> " + os.readlink(e.path)
        except OSError:
            pass
    if opts.classify == "always":
        if e.is_dir():
            base += "/"
        elif e.is_link():
            base += "@"
        elif is_executable(e):
            base += "*"
    return quote_name(base)


def quote_name(name):
    if any(ch.isspace() for ch in name):
        if "'" not in name:
            return "'" + name + "'"
        return '"' + name.replace('"', '\\"') + '"'
    return name


def is_executable(e):
    st = e.stat()
    return bool(st and (st.st_mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)))


def perms_windows(e):
    if e.is_link():
        first = "l"
    elif e.is_dir():
        first = "d"
    else:
        first = "-"
    return first + ("a" if first == "-" else "-") + "---"


def write_stdout(text):
    sys.stdout.buffer.write(text.encode("utf-8"))


def write_stderr(text):
    sys.stderr.buffer.write(text.encode("utf-8"))


def format_size(e):
    s = e.size()
    return "-" if s is None else str(s)


def format_time(e):
    st = e.stat()
    if not st:
        return "-"
    dt = datetime.fromtimestamp(st.st_mtime)
    return f"{dt.day:2d} {dt.strftime('%b')} {dt.strftime('%H:%M')}"


def render_lines(entries, opts):
    return "".join(display_name(e, opts) + "\n" for e in entries)


def render_long(entries, opts):
    rows = []
    cols = []
    for e in entries:
        cells = []
        if not opts.no_permissions:
            cells.append(perms_windows(e))
        if not opts.no_filesize:
            cells.append(format_size(e))
        if not opts.no_time:
            cells.append(format_time(e))
        cols.append(cells)
    widths = [0] * (max((len(c) for c in cols), default=0))
    for c in cols:
        for i, v in enumerate(c):
            widths[i] = max(widths[i], len(v))
    for e, cells in zip(entries, cols):
        rendered = []
        for i, v in enumerate(cells):
            if i == 0:
                rendered.append(v.ljust(widths[i]))
            else:
                rendered.append(v.rjust(widths[i]))
        prefix = " ".join(rendered)
        rows.append((prefix + " " if prefix else "") + display_name(e, opts))
    return "\n".join(rows) + ("\n" if rows else "")


def tree_prefix(parts):
    return "".join("└── " if p == "corner" else "├── " if p == "edge" else "│   " if p == "line" else "    " for p in parts)


def render_tree_root(path, opts):
    root = str(path)
    if os.sep == "\\":
        root = root.replace("/", "\\", root.count("/") - 1) if "/" in root else root
    lines = [root]
    entries = visible_entries(path, opts)
    add_tree(lines, entries, opts, [], 1)
    return "\n".join(lines) + "\n"


def add_tree(lines, entries, opts, parts, depth):
    for idx, e in enumerate(entries):
        last = idx == len(entries) - 1
        cur_parts = parts + (["corner"] if last else ["edge"])
        lines.append(tree_prefix(cur_parts) + display_name(e, opts, show_link=False))
        if e.is_dir() and not e.is_dotdot and (opts.level is None or depth < opts.level):
            try:
                kids = visible_entries(e.path, opts)
            except EzaError:
                kids = []
            add_tree(lines, kids, opts, parts + (["blank"] if last else ["line"]), depth + 1)


def entries_for_paths(opts):
    paths = [Path(p) for p in opts.paths]
    if len(paths) == 1 and paths[0].is_dir() and not opts.as_file:
        return visible_entries(paths[0], opts), paths[0]
    entries = []
    for p in paths:
        if not (p.exists() or p.is_symlink()):
            write_stderr(f"eza: {p}: No such file or directory\n")
            continue
        entries.append(Entry(p, p.name if p.name else str(p), str(p)))
    return sort_entries(entries, opts), None


def run(argv):
    opts = parse_args(argv)
    if "help" in opts.values:
        write_stdout(HELP_TEXT)
        return 0
    if "version" in opts.values:
        write_stdout(VERSION_TEXT)
        return 0
    if opts.tree:
        outputs = []
        for p in opts.paths:
            path = Path(p)
            if not path.exists() and not path.is_symlink():
                write_stderr(f"eza: {p}: No such file or directory\n")
                continue
            if path.is_dir() and not opts.as_file:
                outputs.append(render_tree_root(path, opts))
            else:
                outputs.append(display_name(Entry(path, path.name if path.name else str(path), str(path)), opts) + "\n")
        write_stdout("\n".join(outputs))
        return 0
    entries, _ = entries_for_paths(opts)
    if opts.long_view:
        write_stdout(render_long(entries, opts))
    else:
        write_stdout(render_lines(entries, opts))
    return 0


def main():
    try:
        raise SystemExit(run(sys.argv[1:]))
    except EzaError as e:
        write_stderr(f"eza: {e}\n")
        raise SystemExit(e.code)


if __name__ == "__main__":
    main()
