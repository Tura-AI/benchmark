#!/usr/bin/env python3
import fnmatch
import os
import re
import stat
import sys
from datetime import datetime
from functools import cmp_to_key


VERSION = """eza - A modern, maintained replacement for ls
v0.23.3 [+git]
https://github.com/eza-community/eza
"""

try:
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    sys.stderr.reconfigure(encoding="utf-8", newline="\n")
except AttributeError:
    pass

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

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


class Options:
    def __init__(self):
        self.paths = []
        self.long = False
        self.tree = False
        self.recurse = False
        self.oneline = False
        self.all_count = 0
        self.treat_dirs = False
        self.reverse = False
        self.sort = "name"
        self.dirs_first = False
        self.dirs_last = False
        self.only_dirs = False
        self.only_files = False
        self.no_symlinks = False
        self.show_symlinks = False
        self.level = None
        self.bytes = False
        self.binary = False
        self.header = False
        self.no_permissions = False
        self.no_filesize = False
        self.no_time = False
        self.no_user = True
        self.time_style = "default"
        self.time_field = "modified"
        self.ignore = []


def parse_args(argv):
    opts = Options()
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--":
            opts.paths.extend(argv[i + 1 :])
            break
        if arg in ("-?", "--help"):
            sys.stdout.write(HELP)
            raise SystemExit(0)
        if arg in ("-v", "--version"):
            sys.stdout.write(VERSION)
            raise SystemExit(0)
        if arg.startswith("--"):
            name, val = split_long(arg)
            if name in ("--color", "--colour", "--icons", "--classify", "--absolute", "--hyperlink", "--color-scale", "--colour-scale", "--color-scale-mode", "--colour-scale-mode"):
                if val is None and name in ("--color", "--colour", "--icons", "--classify", "--absolute"):
                    consume_optional(argv, i)
                    if i + 1 < len(argv) and not argv[i + 1].startswith("-"):
                        i += 1
                i += 1
                continue
            if name in ("--long",):
                opts.long = True
            elif name in ("--oneline",):
                opts.oneline = True
            elif name in ("--grid", "--across", "--no-quotes", "--no-user", "--numeric", "--no-git", "--git", "--git-repos", "--git-repos-no-status"):
                pass
            elif name == "--tree":
                opts.tree = True
            elif name == "--recurse":
                opts.recurse = True
            elif name in ("--all", "--almost-all"):
                opts.all_count += 1
            elif name == "--treat-dirs-as-files":
                opts.treat_dirs = True
            elif name == "--reverse":
                opts.reverse = True
            elif name == "--sort":
                opts.sort = need_value(argv, i, val, name)
                if val is None:
                    i += 1
            elif name == "--group-directories-first":
                opts.dirs_first = True
                opts.dirs_last = False
            elif name == "--group-directories-last":
                opts.dirs_last = True
                opts.dirs_first = False
            elif name == "--only-dirs":
                opts.only_dirs = True
            elif name == "--only-files":
                opts.only_files = True
            elif name == "--no-symlinks":
                opts.no_symlinks = True
            elif name == "--show-symlinks":
                opts.show_symlinks = True
            elif name == "--level":
                opts.level = int(need_value(argv, i, val, name))
                if val is None:
                    i += 1
            elif name == "--bytes":
                opts.bytes = True
            elif name == "--binary":
                opts.binary = True
            elif name in ("--group", "--links", "--inode", "--mounts", "--flags", "--blocksize", "--extended", "--octal-permissions", "--total-size", "--smart-group", "--git-ignore", "--dereference", "--follow-symlinks", "--stdin", "--list-dirs", "--context"):
                pass
            elif name == "--width":
                if val is None:
                    i += 1
            elif name == "--header":
                opts.header = True
            elif name == "--no-permissions":
                opts.no_permissions = True
            elif name == "--no-filesize":
                opts.no_filesize = True
            elif name == "--no-time":
                opts.no_time = True
            elif name in ("--modified", "--changed", "--accessed", "--created"):
                opts.time_field = name[2:]
            elif name == "--time":
                opts.time_field = need_value(argv, i, val, name)
                if val is None:
                    i += 1
            elif name == "--time-style":
                opts.time_style = need_value(argv, i, val, name)
                if val is None:
                    i += 1
            elif name == "--ignore-glob":
                opts.ignore.extend(need_value(argv, i, val, name).split("|"))
                if val is None:
                    i += 1
            else:
                sys.stderr.write(f"Option {name} doesn't exist!\n")
                raise SystemExit(3)
            i += 1
            continue
        if arg.startswith("-") and arg != "-":
            chars = arg[1:]
            j = 0
            while j < len(chars):
                c = chars[j]
                if c == "1":
                    opts.oneline = True
                elif c == "l":
                    opts.long = True
                elif c == "G" or c == "x" or c == "n" or c == "g" or c == "H" or c == "i" or c == "S" or c == "O" or c == "@" or c == "Z" or c == "X" or c == "M" or c == "o":
                    pass
                elif c == "T":
                    opts.tree = True
                elif c == "R":
                    opts.recurse = True
                elif c == "a":
                    opts.all_count += 1
                elif c == "A":
                    opts.all_count = max(opts.all_count, 1)
                elif c == "d":
                    opts.treat_dirs = True
                elif c == "r":
                    opts.reverse = True
                elif c == "D":
                    opts.only_dirs = True
                elif c == "f":
                    opts.only_files = True
                elif c == "B":
                    opts.bytes = True
                elif c == "b":
                    opts.binary = True
                elif c == "h":
                    opts.header = True
                elif c == "m":
                    opts.time_field = "modified"
                elif c == "u":
                    opts.time_field = "accessed"
                elif c == "U":
                    opts.time_field = "created"
                elif c in ("s", "L", "I", "t", "F", "w"):
                    rest = chars[j + 1 :]
                    if rest:
                        value = rest
                        j = len(chars)
                    else:
                        i += 1
                        if i >= len(argv):
                            sys.stderr.write(f"Flag -{c} needs a value\n")
                            raise SystemExit(3)
                        value = argv[i]
                    if c == "s":
                        opts.sort = value
                    elif c == "L":
                        opts.level = int(value)
                    elif c == "I":
                        opts.ignore.extend(value.split("|"))
                    elif c == "t":
                        opts.time_field = value
                else:
                    sys.stderr.write(f"Option -{c} doesn't exist!\n")
                    raise SystemExit(3)
                j += 1
            i += 1
            continue
        opts.paths.append(arg)
        i += 1
    if not opts.paths:
        opts.paths = ["."]
    normalize_sort(opts)
    return opts


def split_long(arg):
    if "=" in arg:
        n, v = arg.split("=", 1)
        return n, v
    return arg, None


def need_value(argv, i, val, name):
    if val is not None:
        return val
    if i + 1 >= len(argv):
        sys.stderr.write(f"Flag {name} needs a value\n")
        raise SystemExit(3)
    return argv[i + 1]


def consume_optional(argv, i):
    return None


def normalize_sort(opts):
    aliases = {"date": "modified", "time": "modified", "newest": "modified", "age": "age", "oldest": "age", "none": "none", "ext": "extension"}
    opts.sort = aliases.get(opts.sort, opts.sort)
    if opts.sort == "inode" and os.name == "nt":
        sys.stderr.write('eza: Option --sort (-s) has no "inode" setting (choices: name, Name, size, extension, Extension, modified, changed, accessed, created, inode, type, none)\n')
        raise SystemExit(3)


class Entry:
    def __init__(self, path, display=None, virtual=None):
        self.path = path
        self.display = display if display is not None else os.path.basename(path.rstrip("\\/")) or path
        self.virtual = virtual
        try:
            self.st = os.lstat(path) if virtual is None else os.stat(path)
            self.error = None
        except OSError as e:
            self.st = None
            self.error = e

    @property
    def name(self):
        return self.display

    @property
    def is_dir(self):
        if self.virtual in (".", ".."):
            return True
        return self.st is not None and stat.S_ISDIR(self.st.st_mode)

    @property
    def is_link(self):
        return self.st is not None and stat.S_ISLNK(self.st.st_mode)

    @property
    def is_file(self):
        return self.st is not None and stat.S_ISREG(self.st.st_mode)

    @property
    def size(self):
        return 0 if self.is_dir else (self.st.st_size if self.st else 0)

    @property
    def ext(self):
        base = self.name
        if "." not in base or base.startswith(".") and base.count(".") == 1:
            return ""
        return base.rsplit(".", 1)[1]

    def time_value(self, field):
        if not self.st:
            return 0
        if field == "accessed":
            return self.st.st_atime
        if field == "created":
            return self.st.st_ctime
        if field == "changed":
            return self.st.st_ctime
        return self.st.st_mtime


def natural_key(s, case_insensitive=True):
    if case_insensitive:
        s = s.lower()
    out = []
    for part in re.split(r"(\d+)", s):
        out.append((0, int(part)) if part.isdigit() else (1, part))
    return out


def compare_entries(opts, a, b):
    sf = opts.sort
    if sf == "none":
        return 0
    if sf == "size":
        ka, kb = a.size, b.size
    elif sf in ("modified", "accessed", "changed", "created"):
        ka, kb = a.time_value(sf), b.time_value(sf)
    elif sf == "age":
        ka, kb = -a.time_value("modified"), -b.time_value("modified")
    elif sf == "extension":
        ka, kb = (a.ext, natural_key(a.name)), (b.ext, natural_key(b.name))
    elif sf == "Extension":
        ka, kb = (a.ext, natural_key(a.name, False)), (b.ext, natural_key(b.name, False))
    elif sf == "type":
        ka, kb = (type_char(a), natural_key(a.name, False)), (type_char(b), natural_key(b.name, False))
    elif sf == "Name":
        ka, kb = natural_key(a.name, False), natural_key(b.name, False)
    else:
        ka, kb = natural_key(a.name), natural_key(b.name)
    return (ka > kb) - (ka < kb)


def sort_entries(opts, entries):
    entries = sorted(entries, key=cmp_to_key(lambda a, b: compare_entries(opts, a, b)))
    if opts.reverse:
        entries.reverse()
    if opts.dirs_first:
        entries = sorted(entries, key=lambda e: not e.is_dir)
    if opts.dirs_last:
        entries = sorted(entries, key=lambda e: e.is_dir)
    return entries


def child_entries(path, opts):
    out = []
    if opts.all_count >= 2:
        out.append(Entry(os.path.join(path, "."), "."))
        out.append(Entry(os.path.join(path, ".."), ".."))
    try:
        with os.scandir(path) as it:
            for de in it:
                name = de.name
                if opts.all_count == 0 and name.startswith("."):
                    continue
                if any(fnmatch.fnmatchcase(name, pat) for pat in opts.ignore):
                    continue
                e = Entry(de.path, name)
                if filter_out(opts, e, is_recurse=False):
                    continue
                out.append(e)
    except OSError as e:
        raise e
    return sort_entries(opts, out)


def filter_out(opts, e, is_recurse):
    if opts.no_symlinks and e.is_link:
        return True
    if opts.only_dirs and not e.is_dir:
        return True
    if opts.only_files and not is_recurse and not e.is_file:
        return True
    return False


def type_char(e):
    if e.is_link:
        return "l"
    if e.is_dir:
        return "d"
    return "-"


def perm_string(e):
    if os.name == "nt":
        attrs = getattr(e.st, "st_file_attributes", 0) if e.st else 0
        archive = bool(attrs & 0x20) or (e.is_file and attrs == 0)
        readonly = bool(attrs & 0x1)
        hidden = bool(attrs & 0x2) or e.name.startswith(".")
        system = bool(attrs & 0x4)
        return type_char(e) + ("a" if archive and not e.is_dir else "-") + ("r" if readonly else "-") + ("h" if hidden else "-") + ("s" if system else "-")
    if not e.st:
        return "---------"
    mode = e.st.st_mode
    chars = [type_char(e)]
    for who in ((stat.S_IRUSR, stat.S_IWUSR, stat.S_IXUSR), (stat.S_IRGRP, stat.S_IWGRP, stat.S_IXGRP), (stat.S_IROTH, stat.S_IWOTH, stat.S_IXOTH)):
        chars.extend(["r" if mode & who[0] else "-", "w" if mode & who[1] else "-", "x" if mode & who[2] else "-"])
    return "".join(chars)


def fmt_size(e, opts):
    if e.is_dir:
        return "-"
    n = e.size
    if opts.bytes:
        return f"{n:,}"
    base = 1024 if opts.binary else 1000
    units = ["", "k", "M", "G", "T"]
    value = float(n)
    idx = 0
    while abs(value) >= base and idx < len(units) - 1:
        value /= base
        idx += 1
    if idx == 0:
        return str(n)
    if value >= 10 and abs(value - round(value)) < 0.05:
        return f"{int(round(value)):,}{units[idx]}"
    return f"{value:,.1f}{units[idx]}"


def fmt_time(e, opts):
    dt = datetime.fromtimestamp(e.time_value(opts.time_field))
    style = opts.time_style
    if style == "long-iso":
        return dt.strftime("%Y-%m-%d %H:%M")
    if style == "full-iso":
        return dt.strftime("%Y-%m-%d %H:%M:%S.%f %z")
    if style == "iso":
        return dt.strftime("%m-%d %H:%M") if dt.year == datetime.now().year else dt.strftime("%Y-%m-%d")
    if style.startswith("+"):
        return dt.strftime(style[1:].split("\n")[-1 if dt.year == datetime.now().year and "\n" in style else 0])
    month = MONTHS[dt.month - 1]
    if dt.year == datetime.now().year:
        return f"{dt.day:2d} {month:<3} {dt:%H:%M}"
    return f"{dt.day:2d} {month:<3}  {dt.year}"


def quote_name(name):
    if any(ch.isspace() for ch in name):
        return "'" + name.replace("'", "\\'") + "'"
    return name


def display_name(e, long_arg=False):
    name = e.display if long_arg else e.name
    return quote_name(name)


def render_lines(entries, opts, long_arg=False, prefixes=None):
    if not opts.long:
        return [((prefixes[i] if prefixes else "") + display_name(e, long_arg)) for i, e in enumerate(entries)]
    perms = [] if opts.no_permissions else [perm_string(e) for e in entries]
    sizes = [] if opts.no_filesize else [fmt_size(e, opts) for e in entries]
    times = [] if opts.no_time else [fmt_time(e, opts) for e in entries]
    wp = max([len(x) for x in perms] + [0])
    ws = max([len(x) for x in sizes] + [0])
    wt = max([len(x) for x in times] + [0])
    out = []
    for idx, e in enumerate(entries):
        parts = []
        if not opts.no_permissions:
            parts.append(perm_string(e).ljust(wp))
        if not opts.no_filesize:
            parts.append(fmt_size(e, opts).rjust(ws))
        if not opts.no_time:
            parts.append(fmt_time(e, opts).rjust(wt))
        name = (prefixes[idx] if prefixes else "") + display_name(e, long_arg)
        parts.append(name)
        out.append(" ".join(parts))
    return out


def tree_prefix(bits, last):
    prefix = "".join("    " if b else "│   " for b in bits)
    return prefix + ("└── " if last else "├── ")


def render_tree(root, opts):
    lines = [root.display]
    max_level = opts.level

    def rec(path, bits, depth):
        if max_level is not None and depth > max_level:
            return
        try:
            children = child_entries(path, opts)
        except OSError as e:
            sys.stderr.write(f'"{path}": {e.strerror} (os error {getattr(e, "winerror", e.errno)})\n')
            return
        for idx, child in enumerate(children):
            last = idx == len(children) - 1
            pref = tree_prefix(bits, last)
            if opts.long:
                lines.extend(render_lines([child], opts, prefixes=[pref]))
            else:
                lines.append(pref + display_name(child))
            if child.is_dir and child.name not in (".", ".."):
                rec(child.path, bits + [last], depth + 1)

    rec(root.path, [], 1)
    return lines


def render_recurse_dir(root, opts, show_header):
    out = []
    if show_header:
        out.append(f"{root.display}:")
    try:
        children = child_entries(root.path, opts)
    except OSError as e:
        code = getattr(e, "winerror", e.errno)
        sys.stderr.write(f'"{root.path}": {e.strerror} (os error {code})\n')
        return out, 2 if code in (2, 3) else 1
    out.extend(render_lines(children, opts))
    subdirs = [c for c in children if c.is_dir and c.name not in (".", "..")]
    for child in subdirs:
        out.append("")
        child_root = Entry(child.path, os.path.join(root.display, child.name))
        more, st = render_recurse_dir(child_root, opts, True)
        out.extend(more)
        if st:
            return out, st
    return out, 0


def run(opts):
    status = 0
    args = [Entry(p, p) for p in opts.paths]
    missing = [e for e in args if e.error]
    for e in missing:
        code = getattr(e.error, "winerror", e.error.errno)
        sys.stderr.write(f'"{e.path}": {e.error.strerror} (os error {code})\n')
        status = 2 if code in (2, 3) else 1
    args = [e for e in args if not e.error]
    files = [e for e in args if opts.treat_dirs or not e.is_dir]
    dirs = [e for e in args if not opts.treat_dirs and e.is_dir]
    out = []
    if files:
        files = sort_entries(opts, files)
        out.extend(render_lines(files, opts, long_arg=True))
        if dirs:
            out.append("")
    for di, d in enumerate(dirs):
        if opts.tree:
            out.extend(render_tree(d, opts))
        else:
            if len(dirs) > 1 or files:
                out.append(f"{d.display}:")
            if opts.recurse:
                more, st = render_recurse_dir(d, opts, False)
                out.extend(more)
                status = status or st
            else:
                try:
                    children = child_entries(d.path, opts)
                    out.extend(render_lines(children, opts))
                except OSError as e:
                    code = getattr(e, "winerror", e.errno)
                    sys.stderr.write(f'"{d.path}": {e.strerror} (os error {code})\n')
                    status = 2 if code in (2, 3) else 1
        if di != len(dirs) - 1:
            out.append("")
    if out:
        sys.stdout.write("\n".join(out) + "\n")
    return status


def main(argv):
    try:
        opts = parse_args(argv)
        return run(opts)
    except BrokenPipeError:
        return 0
    except SystemExit as e:
        return int(e.code or 0)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
