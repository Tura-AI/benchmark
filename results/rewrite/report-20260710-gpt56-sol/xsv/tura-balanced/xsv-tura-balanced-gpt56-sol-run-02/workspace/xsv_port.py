#!/usr/bin/env python3
"""A dependency-free Python port of the evaluated xsv 0.13.0 commands."""

from __future__ import annotations

from collections import Counter
from functools import cmp_to_key
import math
import os
from pathlib import Path
import re
import sys


VERSION = "0.13.0"
COMMANDS = (
    "cat         Concatenate by row or column\n"
    "    count       Count records\n"
    "    fixlengths  Makes all records have same length\n"
    "    flatten     Show one field per line\n"
    "    fmt         Format CSV output (change field delimiter)\n"
    "    frequency   Show frequency tables\n"
    "    headers     Show header names\n"
    "    help        Show this usage message.\n"
    "    index       Create CSV index for faster access\n"
    "    input       Read CSV data with special quoting rules\n"
    "    join        Join CSV files\n"
    "    sample      Randomly sample CSV data\n"
    "    search      Search CSV data with regexes\n"
    "    select      Select columns from CSV\n"
    "    slice       Slice records from CSV\n"
    "    sort        Sort CSV data\n"
    "    split       Split CSV data into many files\n"
    "    stats       Compute basic statistics\n"
    "    table       Align CSV data into columns\n"
)
MAIN_USAGE = (
    "Usage:\n"
    "    xsv <command> [<args>...]\n"
    "    xsv [options]\n\n"
    "Options:\n"
    "    --list        List all commands available.\n"
    "    -h, --help    Display this message\n"
    "    <command> -h  Display the command help message\n"
    "    --version     Print version info and exit\n\n"
    "Commands:\n    " + COMMANDS
)

USAGES = {
    "headers": """Prints the fields of the first row in the CSV data.

These names can be used in commands like 'select' to refer to columns in the
CSV data.

Note that multiple CSV files may be given to this command. This is useful with
the --intersect flag.

Usage:
    xsv headers [options] [<input>...]

headers options:
    -j, --just-names       Only show the header names (hide column index).
                           This is automatically enabled if more than one
                           input is given.
    --intersect            Shows the intersection of all headers in all of
                           the inputs given.

Common options:
    -h, --help             Display this message
    -d, --delimiter <arg>  The field delimiter for reading CSV data.
                           Must be a single character. (default: ,)
""",
    "count": """Prints a count of the number of records in the CSV data.

Note that the count will not include the header row (unless --no-headers is
given).

Usage:
    xsv count [options] [<input>]

Common options:
    -h, --help             Display this message
    -n, --no-headers       When set, the first row will not be included in
                           the count.
    -d, --delimiter <arg>  The field delimiter for reading CSV data.
                           Must be a single character. (default: ,)
""",
    "select": """Select columns from CSV data efficiently.

Usage:
    xsv select [options] [--] <selection> [<input>]
    xsv select --help

Common options:
    -h, --help             Display this message
    -o, --output <file>    Write output to <file> instead of stdout.
    -n, --no-headers       When set, the first row will not be interpreted
                           as headers. (i.e., They are not searched, analyzed,
                           sliced, etc.)
    -d, --delimiter <arg>  The field delimiter for reading CSV data.
                           Must be a single character. (default: ,)
""",
    "slice": """Returns the rows in the range specified (starting at 0, half-open interval).
The range does not include headers.

Usage:
    xsv slice [options] [<input>]

slice options:
    -s, --start <arg>      The index of the record to slice from.
    -e, --end <arg>        The index of the record to slice to.
    -l, --len <arg>        The length of the slice (can be used instead
                           of --end).
    -i, --index <arg>      Slice a single record (shortcut for -s N -l 1).

Common options:
    -h, --help             Display this message
    -o, --output <file>    Write output to <file> instead of stdout.
    -n, --no-headers       When set, the first row will not be interpreted
                           as headers. Otherwise, the first row will always
                           appear in the output as the header row.
    -d, --delimiter <arg>  The field delimiter for reading CSV data.
                           Must be a single character. (default: ,)
""",
    "search": """Filters CSV data by whether the given regex matches a row.

Usage:
    xsv search [options] <regex> [<input>]
    xsv search --help

search options:
    -i, --ignore-case      Case insensitive search.
    -s, --select <arg>     Select the columns to search.
    -v, --invert-match     Select only rows that did not match

Common options:
    -h, --help             Display this message
    -o, --output <file>    Write output to <file> instead of stdout.
    -n, --no-headers       When set, the first row will not be interpreted
                           as headers.
    -d, --delimiter <arg>  The field delimiter for reading CSV data.
                           Must be a single character. (default: ,)
""",
    "sort": """Sorts CSV data lexicographically.

Usage:
    xsv sort [options] [<input>]

sort options:
    -s, --select <arg>     Select a subset of columns to sort.
    -N, --numeric          Compare according to string numerical value
    -R, --reverse          Reverse order

Common options:
    -h, --help             Display this message
    -o, --output <file>    Write output to <file> instead of stdout.
    -n, --no-headers       When set, the first row will not be interpreted
                           as headers.
    -d, --delimiter <arg>  The field delimiter for reading CSV data.
                           Must be a single character. (default: ,)
""",
    "table": """Outputs CSV data as a table with columns in alignment.

Usage:
    xsv table [options] [<input>]

table options:
    -w, --width <arg>      The minimum width of each column.
                           [default: 2]
    -p, --pad <arg>        The minimum number of spaces between each column.
                           [default: 2]
    -c, --condense <arg>   Limits the length of each field to the value
                           specified.

Common options:
    -h, --help             Display this message
    -o, --output <file>    Write output to <file> instead of stdout.
    -d, --delimiter <arg>  The field delimiter for reading CSV data.
                           Must be a single character. (default: ,)
""",
    "fmt": """Formats CSV data with a custom delimiter or CRLF line endings.

Usage:
    xsv fmt [options] [<input>]

fmt options:
    -t, --out-delimiter <arg>  The field delimiter for writing CSV data.
                               [default: ,]
    --crlf                     Use '\\r\\n' line endings in the output.
    --ascii                    Use ASCII field and record separators.
    --quote <arg>              The quote character to use. [default: \"]
    --quote-always             Put quotes around every value.
    --escape <arg>             The escape character to use.

Common options:
    -h, --help             Display this message
    -o, --output <file>    Write output to <file> instead of stdout.
    -d, --delimiter <arg>  The field delimiter for reading CSV data.
                           Must be a single character. (default: ,)
""",
    "stats": """Computes basic statistics on CSV data.

Usage:
    xsv stats [options] [<input>]

stats options:
    -s, --select <arg>     Select a subset of columns to compute stats for.
    --everything           Show all statistics available.
    --mode                 Show the mode.
    --cardinality          Show the cardinality.
    --median               Show the median.
    --nulls                Include NULLs in the population size.
    -j, --jobs <arg>       The number of jobs to run in parallel. [default: 0]

Common options:
    -h, --help             Display this message
    -o, --output <file>    Write output to <file> instead of stdout.
    -n, --no-headers       When set, the first row will NOT be interpreted
                           as column names.
    -d, --delimiter <arg>  The field delimiter for reading CSV data.
                           Must be a single character. (default: ,)
""",
    "frequency": """Compute a frequency table on CSV data.

Usage:
    xsv frequency [options] [<input>]

frequency options:
    -s, --select <arg>     Select a subset of columns.
    -l, --limit <arg>      Limit the table. [default: 10]
    -a, --asc              Sort in ascending order by count.
    --no-nulls             Don't include NULLs in the frequency table.
    -j, --jobs <arg>       The number of jobs to run. [default: 0]

Common options:
    -h, --help             Display this message
    -o, --output <file>    Write output to <file> instead of stdout.
    -n, --no-headers       Treat the first row as data.
    -d, --delimiter <arg>  The field delimiter for reading CSV data.
                           Must be a single character. (default: ,)
""",
}
for _shorts in COMMAND_SHORT.values():
    _shorts["h"] = ("help", False)


class CliError(Exception):
    pass


class UsageError(CliError):
    pass


class CsvError(CliError):
    def __init__(self, message: str, rows: list[list[bytes]]):
        super().__init__(message)
        self.rows = rows


def delimiter(value: str) -> int:
    if value == r"\t":
        return 9
    raw = value.encode("utf-8")
    if len(raw) != 1:
        if len(value) == 1:
            raise CliError(f"Could not convert '{value}' to ASCII delimiter.")
        raise CliError(f"Could not convert '{value}' to a single ASCII character.")
    return raw[0]


def infer_delimiter(path: str | None) -> int:
    return 9 if path and path != "-" and Path(path).suffix == ".tsv" else 44


def parse_csv(raw: bytes, delim: int) -> list[list[bytes]]:
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    if not raw:
        return []
    rows: list[list[bytes]] = []
    starts: list[tuple[int, int]] = []
    row: list[bytes] = []
    field = bytearray()
    quoted = False
    at_start = True
    i = 0
    record_start = 0
    record_line = 1
    line = 1
    while i < len(raw):
        c = raw[i]
        if quoted:
            if c == 34:
                if i + 1 < len(raw) and raw[i + 1] == 34:
                    field.append(34)
                    i += 2
                    continue
                quoted = False
            else:
                field.append(c)
            i += 1
            continue
        if at_start and c == 34:
            quoted = True
            at_start = False
            i += 1
        elif c == delim:
            row.append(bytes(field))
            field.clear()
            at_start = True
            i += 1
        elif c in (10, 13):
            row.append(bytes(field))
            field.clear()
            rows.append(row)
            starts.append((record_line, record_start))
            row = []
            at_start = True
            if c == 13 and i + 1 < len(raw) and raw[i + 1] == 10:
                i += 1
            i += 1
            line += 1
            record_line = line
            record_start = i
        else:
            field.append(c)
            at_start = False
            i += 1
    if field or row or not at_start:
        row.append(bytes(field))
        rows.append(row)
        starts.append((record_line, record_start))
    if rows:
        width = len(rows[0])
        for number, record in enumerate(rows[1:], 1):
            if len(record) != width:
                record_line, record_start = starts[number]
                raise CsvError(
                    f"CSV error: record {number} (line: {record_line}, byte: {record_start}): "
                    f"found record with {len(record)} fields, but the previous record has {width} fields",
                    rows[:number],
                )
    return rows


def read_input(path: str | None, delim: int) -> list[list[bytes]]:
    if path is None or path == "-":
        raw = sys.stdin.buffer.read()
    else:
        try:
            raw = Path(path).read_bytes()
        except OSError as err:
            if err.errno == 2:
                detail = "系统找不到指定的文件。 (os error 2)" if os.name == "nt" else "No such file or directory (os error 2)"
                raise CliError(f"failed to open {path}: {detail}") from None
            raise CliError(str(err)) from None
    return parse_csv(raw, delim)


def csv_field(field: bytes, delim: int, quote: int = 34, always: bool = False,
              escape: int | None = None, term: bytes = b"\n") -> bytes:
    specials = {delim, quote, *term}
    must_quote = always or any(c in field for c in specials)
    if not must_quote:
        return field
    if escape is None:
        body = field.replace(bytes([quote]), bytes([quote, quote]))
    else:
        body = field.replace(bytes([quote]), bytes([escape, quote]))
    return bytes([quote]) + body + bytes([quote])


def encode_csv(rows: list[list[bytes]], delim: int = 44, term: bytes = b"\n",
               quote: int = 34, always: bool = False,
               escape: int | None = None) -> bytes:
    return b"".join(
        (bytes([quote, quote]) if not row else bytes([delim]).join(
            csv_field(f, delim, quote, always, escape, term) for f in row
        )) + term
        for row in rows
    )


def write_bytes(raw: bytes, output: str | None) -> None:
    if output is None or output == "-":
        sys.stdout.buffer.write(raw)
    else:
        Path(output).write_bytes(raw)


def split_data(rows: list[list[bytes]], no_headers: bool):
    if not rows:
        return [], []
    return (rows[0], rows if no_headers else rows[1:])


LONG_OPTIONS = {
    "just-names": ("just_names", False), "intersect": ("intersect", False),
    "no-headers": ("no_headers", False), "delimiter": ("delimiter", True),
    "output": ("output", True), "start": ("start", True), "end": ("end", True),
    "len": ("length", True), "index": ("index", True),
    "ignore-case": ("ignore_case", False), "select": ("select", True),
    "invert-match": ("invert_match", False), "numeric": ("numeric", False),
    "reverse": ("reverse", False), "width": ("width", True), "pad": ("pad", True),
    "condense": ("condense", True), "out-delimiter": ("out_delimiter", True),
    "crlf": ("crlf", False), "ascii": ("ascii", False), "quote": ("quote", True),
    "quote-always": ("quote_always", False), "escape": ("escape", True),
    "everything": ("everything", False), "mode": ("mode", False),
    "cardinality": ("cardinality", False), "median": ("median", False),
    "nulls": ("nulls", False), "jobs": ("jobs", True), "limit": ("limit", True),
    "asc": ("asc", False), "no-nulls": ("no_nulls", False),
}
SHORT_OPTIONS = {
    "j": ("just_names", False), "n": ("no_headers", False),
    "d": ("delimiter", True), "o": ("output", True), "s": ("select", True),
    "e": ("end", True), "l": ("length", True), "i": ("ignore_case", False),
    "v": ("invert_match", False), "N": ("numeric", False), "R": ("reverse", False),
    "w": ("width", True), "p": ("pad", True), "c": ("condense", True),
    "t": ("out_delimiter", True), "a": ("asc", False),
}


COMMAND_SHORT = {
    "headers": {"j": ("just_names", False), "d": ("delimiter", True)},
    "count": {"n": ("no_headers", False), "d": ("delimiter", True)},
    "select": {"o": ("output", True), "n": ("no_headers", False), "d": ("delimiter", True)},
    "slice": {"s": ("start", True), "e": ("end", True), "l": ("length", True), "i": ("index", True), "o": ("output", True), "n": ("no_headers", False), "d": ("delimiter", True)},
    "search": {"i": ("ignore_case", False), "s": ("select", True), "v": ("invert_match", False), "o": ("output", True), "n": ("no_headers", False), "d": ("delimiter", True)},
    "sort": {"s": ("select", True), "N": ("numeric", False), "R": ("reverse", False), "o": ("output", True), "n": ("no_headers", False), "d": ("delimiter", True)},
    "table": {"w": ("width", True), "p": ("pad", True), "c": ("condense", True), "o": ("output", True), "d": ("delimiter", True)},
    "fmt": {"t": ("out_delimiter", True), "o": ("output", True), "d": ("delimiter", True)},
    "stats": {"s": ("select", True), "j": ("jobs", True), "o": ("output", True), "n": ("no_headers", False), "d": ("delimiter", True)},
    "frequency": {"s": ("select", True), "l": ("limit", True), "a": ("asc", False), "j": ("jobs", True), "o": ("output", True), "n": ("no_headers", False), "d": ("delimiter", True)},
}


COMMAND_LONG = {
    "headers": {"just-names", "intersect", "delimiter"},
    "count": {"no-headers", "delimiter"},
    "select": {"output", "no-headers", "delimiter"},
    "slice": {"start", "end", "len", "index", "output", "no-headers", "delimiter"},
    "search": {"ignore-case", "select", "invert-match", "output", "no-headers", "delimiter"},
    "sort": {"select", "numeric", "reverse", "output", "no-headers", "delimiter"},
    "table": {"width", "pad", "condense", "output", "delimiter"},
    "fmt": {"out-delimiter", "crlf", "ascii", "quote", "quote-always", "escape", "output", "delimiter"},
    "stats": {"select", "everything", "mode", "cardinality", "median", "nulls", "jobs", "output", "no-headers", "delimiter"},
    "frequency": {"select", "limit", "asc", "no-nulls", "jobs", "output", "no-headers", "delimiter"},
}


def parse_options(command: str, argv: list[str]):
    values: dict[str, object] = {}
    positional: list[str] = []
    stop = False
    i = 0
    shorts = COMMAND_SHORT[command]
    while i < len(argv):
        arg = argv[i]
        if not stop and arg == "--":
            stop = True
        elif not stop and arg in ("-h", "--help"):
            values["help"] = True
        elif not stop and arg == "--version":
            values["version"] = True
        elif not stop and arg.startswith("--"):
            name, equal, attached = arg[2:].partition("=")
            if name not in COMMAND_LONG[command]:
                raise UsageError(f"Unknown flag: '--{name}'")
            key, needs = LONG_OPTIONS[name]
            if needs:
                if equal:
                    value = attached
                else:
                    i += 1
                    if i >= len(argv):
                        raise UsageError(f"Missing argument for option '--{name}'.")
                    value = argv[i]
                values[key] = value
            elif equal:
                raise UsageError(f"Invalid value for flag '--{name}'")
            else:
                values[key] = True
        elif not stop and arg.startswith("-") and arg != "-":
            chars = arg[1:]
            j = 0
            while j < len(chars):
                char = chars[j]
                if char not in shorts:
                    raise UsageError(f"Unknown flag: '-{char}'")
                key, needs = shorts[char]
                if needs:
                    if j + 1 < len(chars):
                        values[key] = chars[j + 1:]
                    else:
                        i += 1
                        if i >= len(argv):
                            raise UsageError(f"Missing argument for option '-{char}'.")
                        values[key] = argv[i]
                    break
                values[key] = True
                j += 1
        else:
            positional.append(arg)
        i += 1
    return values, positional


def as_uint(value: object | None, name: str, default: int | None = None) -> int | None:
    if value is None:
        return default
    try:
        number = int(str(value), 10)
        if number < 0:
            raise ValueError
        return number
    except ValueError:
        raise UsageError(f"Could not parse '{value}' as a positive integer.") from None


class SelectorParser:
    def __init__(self, text: str):
        self.invert = text.startswith("!")
        self.text = text[1:] if self.invert else text
        self.pos = 0

    def current(self):
        return self.text[self.pos] if self.pos < len(self.text) else None

    def one(self):
        if self.current() == '"':
            self.pos += 1
            name = ""
            while self.current() not in (None, '"'):
                name += self.current()
                self.pos += 1
            if self.current() is None:
                raise CliError('Unclosed quote, missing closing ".')
            self.pos += 1
        else:
            start = self.pos
            while self.current() is not None and self.current() not in ",-[":
                self.pos += 1
            name = self.text[start:self.pos]
        occurrence = None
        if self.current() == "[":
            self.pos += 1
            start = self.pos
            while self.current() is not None and self.current() != "]":
                self.pos += 1
            if self.current() is None:
                raise CliError("Unclosed index bracket, missing closing ].")
            raw = self.text[start:self.pos]
            self.pos += 1
            try:
                occurrence = int(raw)
                if occurrence < 0:
                    raise ValueError
            except ValueError:
                raise CliError(f"Could not convert '{raw}' to an integer: invalid digit found in string") from None
        if occurrence is None and name.isdigit():
            return ("index", int(name))
        return ("name", name, occurrence or 0)

    def parse(self):
        selectors = []
        while self.current() is not None:
            first = ("start",) if self.current() == "-" else self.one()
            if self.current() == "-":
                self.pos += 1
                second = ("end",) if self.current() in (None, ",") else self.one()
                selectors.append(("range", first, second))
            else:
                selectors.append(("one", first))
            if self.current() not in (None, ","):
                raise CliError(f"Expected end of field but got '{self.current()}' instead.")
            if self.current() == ",":
                self.pos += 1
        return selectors


def selector_index(item, first: list[bytes], use_names: bool) -> int:
    kind = item[0]
    if kind == "start":
        return 0
    if kind == "end":
        return max(0, len(first) - 1)
    if kind == "index":
        number = item[1]
        if number < 1 or number > len(first):
            raise CliError(f"Selector index {number} is out of bounds. Index must be >= 1 and <= {len(first)}.")
        return number - 1
    name, wanted = item[1].encode(), item[2]
    shown = item[1]
    if not use_names:
        raise CliError(f"Cannot use names ('{shown}') in selection with --no-headers set.")
    found = [i for i, field in enumerate(first) if field == name]
    if not found:
        raise CliError(f"Selector name '{shown}' does not exist as a named header in the given CSV data.")
    if wanted >= len(found):
        raise CliError(f"Selector index '{wanted}' for name '{shown}' is out of bounds. Must be >= 0 and <= {len(found) - 1}.")
    return found[wanted]


def select_indices(text: str | None, first: list[bytes], use_names: bool) -> list[int]:
    if text is None or text == "":
        return list(range(len(first)))
    parser = SelectorParser(text)
    parsed = parser.parse()
    if not parsed:
        return [] if parser.invert else list(range(len(first)))
    result = []
    for selector in parsed:
        if selector[0] == "one":
            result.append(selector_index(selector[1], first, use_names))
        else:
            start = selector_index(selector[1], first, use_names)
            end = selector_index(selector[2], first, use_names)
            step = 1 if start <= end else -1
            result.extend(range(start, end + step, step))
    if parser.invert:
        excluded = set(result)
        return [i for i in range(len(first)) if i not in excluded]
    return result


def command_headers(opts, pos):
    paths = pos or ["-"]
    if sum(path == "-" for path in paths) > 1:
        raise CliError("At most one <stdin> input is allowed.")
    delim_arg = opts.get("delimiter")
    headers = []
    for path in paths:
        rows = read_input(path, delimiter(str(delim_arg)) if delim_arg is not None else infer_delimiter(path))
        head = rows[0] if rows else []
        for field in head:
            if not opts.get("intersect") or field not in headers:
                headers.append(field)
    if len(paths) == 1 and not opts.get("just_names"):
        lines = [[str(i + 1).encode(), field] for i, field in enumerate(headers)]
        write_bytes(align_table(lines, 2, 2), None)
    else:
        write_bytes(b"".join(field + b"\n" for field in headers), None)


def get_rows(opts, pos, max_pos=1):
    if len(pos) > max_pos:
        raise UsageError("Invalid arguments.")
    path = pos[0] if pos else None
    delim = delimiter(str(opts["delimiter"])) if "delimiter" in opts else infer_delimiter(path)
    rows = read_input(path, delim)
    no_headers = bool(opts.get("no_headers"))
    if os.environ.get("XSV_TOGGLE_HEADERS", "0") == "1":
        no_headers = not no_headers
    head, data = split_data(rows, no_headers)
    return path, delim, no_headers, head, data


def command_count(opts, pos):
    _, _, _, _, data = get_rows(opts, pos)
    write_bytes(f"{len(data)}\n".encode(), None)


def command_select(opts, pos):
    if not pos:
        raise UsageError("Invalid arguments.")
    selection = pos[0]
    _, _, no_headers, head, data = get_rows(opts, pos[1:])
    indices = select_indices(selection, head, not no_headers)
    output = []
    if not no_headers:
        output.append([head[i] for i in indices])
    output.extend([[row[i] for i in indices] for row in data])
    write_bytes(encode_csv(output), opts.get("output"))


def command_slice(opts, pos):
    _, _, no_headers, head, data = get_rows(opts, pos)
    start = as_uint(opts.get("start"), "start", 0)
    end = as_uint(opts.get("end"), "end")
    length = as_uint(opts.get("length"), "len")
    index = as_uint(opts.get("index"), "index")
    try:
        if index is not None and any(k in opts for k in ("start", "end", "length")):
            raise CliError("--index cannot be used with --start, --end or --len")
        if end is not None and length is not None:
            raise CliError("--end and --len cannot be used at the same time.")
        if index is not None:
            start, end = index, index + 1
        elif length is not None:
            end = start + length
        elif end is None:
            end = sys.maxsize
        if start > end:
            raise CliError(f"The end of the range ({end}) must be greater than or\nequal to the start of the range ({start}).")
    except CliError:
        if not no_headers and head:
            write_bytes(encode_csv([head]), opts.get("output"))
        raise
    output = ([] if no_headers or not head else [head]) + data[start:end]
    write_bytes(encode_csv(output), opts.get("output"))


def compile_regex(pattern: str, ignore_case: bool):
    flags = re.IGNORECASE if ignore_case else 0
    try:
        return re.compile(pattern.encode(), flags)
    except re.error as err:
        message = "unclosed character class" if pattern == "[" else err.msg
        body = f"regex parse error:\n    {pattern}\n    {' ' * getattr(err, 'pos', 0)}^\nerror: {message}"
        raise CliError("Syntax(\n" + "~" * 79 + "\n" + body + "\n" + "~" * 79 + "\n)") from None


def command_search(opts, pos):
    if not pos:
        raise UsageError("Invalid arguments.")
    pattern = compile_regex(pos[0], bool(opts.get("ignore_case")))
    _, _, no_headers, head, data = get_rows(opts, pos[1:])
    indices = select_indices(opts.get("select"), head, not no_headers)
    output = [] if no_headers else [head]
    invert = bool(opts.get("invert_match"))
    for row in data:
        matched = any(pattern.search(row[i]) is not None for i in indices)
        if matched != invert:
            output.append(row)
    write_bytes(encode_csv(output), opts.get("output"))


def parse_number(raw: bytes):
    try:
        text = raw.decode("utf-8")
        if re.fullmatch(r"[+-]?\d+", text):
            value = int(text)
            if -(1 << 63) <= value < (1 << 63):
                return value
        return float(text)
    except (UnicodeDecodeError, ValueError, OverflowError):
        return None


def compare_rows(left, right, indices, numeric):
    for index in indices:
        a, b = left[index], right[index]
        if numeric:
            a, b = parse_number(a), parse_number(b)
            if a is None and b is None:
                continue
            if a is None:
                return -1
            if b is None:
                return 1
            if isinstance(a, float) and math.isnan(a) or isinstance(b, float) and math.isnan(b):
                continue
        if a < b:
            return -1
        if a > b:
            return 1
    return 0


def command_sort(opts, pos):
    _, _, no_headers, head, data = get_rows(opts, pos)
    indices = select_indices(opts.get("select"), head, not no_headers)
    cmp = lambda a, b: compare_rows(a, b, indices, bool(opts.get("numeric")))
    data.sort(key=cmp_to_key(cmp), reverse=bool(opts.get("reverse")))
    output = ([] if no_headers or not head else [head]) + data
    write_bytes(encode_csv(output), opts.get("output"))


def condense(field: bytes, limit: int | None) -> bytes:
    if limit is None:
        return field
    try:
        text = field.decode("utf-8")
        return field if len(text) <= limit else (text[:limit] + "...").encode()
    except UnicodeDecodeError:
        return field if len(field) <= limit else field[:limit] + b"..."


def align_table(rows: list[list[bytes]], width: int, padding: int) -> bytes:
    if not rows:
        return b""
    columns = max(len(row) for row in rows)
    def display_width(field: bytes) -> int:
        return sum(1 for char in field if char >= 32 and char != 127)

    widths = [width] * columns
    for row in rows:
        for i, field in enumerate(row[:-1]):
            widths[i] = max(widths[i], display_width(field))
    output = bytearray()
    for row in rows:
        for i, field in enumerate(row):
            if b"\t" in field:
                expanded = bytearray()
                for char in field:
                    if char == 9:
                        expanded.extend(b" " * (width + padding - display_width(expanded) % (width + padding)))
                    else:
                        expanded.append(char)
                field = bytes(expanded)
            output.extend(field)
            if i + 1 < len(row):
                output.extend(b" " * (widths[i] - display_width(field) + padding))
        output.append(10)
    return bytes(output)


def command_table(opts, pos):
    _, _, _, _, rows = get_rows({**opts, "no_headers": True}, pos)
    width = as_uint(opts.get("width"), "width", 2)
    pad = as_uint(opts.get("pad"), "pad", 2)
    limit = as_uint(opts.get("condense"), "condense")
    rendered = [[csv_field(condense(field, limit), 9) for field in row] for row in rows]
    write_bytes(align_table(rendered, width, pad), opts.get("output"))


def command_fmt(opts, pos):
    try:
        _, _, _, _, rows = get_rows({**opts, "no_headers": True}, pos)
    except CsvError as err:
        partial_rows = err.rows
        out_delim = delimiter(str(opts.get("out_delimiter", ",")))
        term = b"\r\n" if opts.get("crlf") else b"\n"
        if opts.get("ascii"):
            out_delim, term = 31, b"\x1e"
        quote = delimiter(str(opts.get("quote", '"')))
        escape = delimiter(str(opts["escape"])) if "escape" in opts else None
        write_bytes(encode_csv(partial_rows, out_delim, term, quote, bool(opts.get("quote_always")), escape), opts.get("output"))
        raise
    out_delim = delimiter(str(opts.get("out_delimiter", ",")))
    term = b"\r\n" if opts.get("crlf") else b"\n"
    if opts.get("ascii"):
        out_delim, term = 31, b"\x1e"
    quote = delimiter(str(opts.get("quote", '"')))
    escape = delimiter(str(opts["escape"])) if "escape" in opts else None
    raw = encode_csv(rows, out_delim, term, quote, bool(opts.get("quote_always")), escape)
    write_bytes(raw, opts.get("output"))


def rust_float(value: float) -> str:
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "inf" if value > 0 else "-inf"
    if value == 0:
        return "-0" if math.copysign(1, value) < 0 else "0"
    if value.is_integer() and abs(value) < 1e16:
        return str(int(value))
    text = repr(value)
    text = re.sub(r"e\+?(-?)0*(\d+)$", r"e\1\2", text)
    return text


def infer_type(raw: bytes) -> str:
    if raw == b"":
        return "NULL"
    try:
        text = raw.decode()
    except UnicodeDecodeError:
        return "Unknown"
    if re.fullmatch(r"[+-]?\d+", text):
        try:
            value = int(text)
            if -(1 << 63) <= value < (1 << 63):
                return "Integer"
        except ValueError:
            pass
    try:
        float(text)
        return "Float"
    except ValueError:
        return "Unicode"


TYPE_RANK = {"NULL": 0, "Integer": 1, "Float": 2, "Unicode": 3, "Unknown": 4}


def merge_type(old: str, new: str) -> str:
    if old == "NULL":
        return new
    if new == "NULL":
        return old
    if "Unknown" in (old, new):
        return "Unknown"
    return old if TYPE_RANK[old] >= TYPE_RANK[new] else new


class ColumnStats:
    def __init__(self, include_nulls: bool, distribution: bool):
        self.include_nulls = include_nulls
        self.distribution = distribution
        self.typ = "NULL"
        self.int_sum = 0
        self.float_sum = None
        self.strings = []
        self.lengths = []
        self.ints = []
        self.floats = []
        self.online_n = 0
        self.online_mean = 0.0
        self.online_m2 = 0.0
        self.values = []
        self.median_values = []

    def online_add(self, value: float):
        self.online_n += 1
        delta = value - self.online_mean
        self.online_mean += delta / self.online_n
        self.online_m2 += delta * (value - self.online_mean)

    def add(self, raw: bytes):
        sample_type = infer_type(raw)
        self.typ = merge_type(self.typ, sample_type)
        self.lengths.append(len(raw))
        self.values.append(raw)
        if raw:
            self.strings.append(raw)
        if self.typ == "Integer" and raw:
            value = int(raw.decode())
            self.int_sum = ((self.int_sum + value + (1 << 63)) % (1 << 64)) - (1 << 63)
        elif self.typ == "Float" and raw:
            value = float(raw.decode())
            if self.float_sum is None:
                self.float_sum = float(self.int_sum) + value
            else:
                self.float_sum += value
        if self.typ in ("Integer", "Float") and raw:
            value = float(raw.decode())
            self.floats.append(value)
            self.ints.append(int(value))
        if sample_type == "NULL":
            if self.include_nulls:
                self.online_add(0.0)
        elif self.typ in ("Integer", "Float"):
            value = float(raw.decode())
            self.online_add(value)
            self.median_values.append(value)

    def record(self, median: bool, mode: bool, cardinality: bool):
        numeric = self.typ in ("Integer", "Float")
        if self.typ == "Integer":
            total = str(self.int_sum)
        elif self.typ == "Float":
            total = rust_float(self.float_sum or 0.0)
        else:
            total = ""
        if self.typ == "NULL":
            low = high = ""
        elif numeric and self.floats:
            values = self.ints if self.typ == "Integer" else self.floats
            low, high = str(min(values)), str(max(values))
            if self.typ == "Float":
                low, high = rust_float(min(values)), rust_float(max(values))
        elif self.strings:
            low = min(self.strings).decode("utf-8", "replace")
            high = max(self.strings).decode("utf-8", "replace")
        else:
            low = high = ""
        len_low = str(min(self.lengths)) if self.lengths else ""
        len_high = str(max(self.lengths)) if self.lengths else ""
        if numeric:
            mean = rust_float(self.online_mean)
            variance = self.online_m2 / self.online_n if self.online_n else float("nan")
            stddev = rust_float(math.sqrt(max(0.0, variance)))
        else:
            mean = stddev = ""
        result = [self.typ, total, low, high, len_low, len_high, mean, stddev]
        if median:
            values = sorted(self.median_values)
            if not values:
                result.append("")
            elif len(values) % 2:
                result.append(rust_float(values[len(values) // 2]))
            else:
                mid = len(values) // 2
                result.append(rust_float((values[mid - 1] + values[mid]) / 2))
        counts = Counter(self.values)
        if mode:
            if not counts:
                result.append("N/A")
            else:
                highest = max(counts.values())
                winners = [key for key, count in counts.items() if count == highest]
                result.append(winners[0].decode("utf-8", "replace") if len(winners) == 1 else "N/A")
        if cardinality:
            result.append(str(len(counts)))
        return [piece.encode() for piece in result]


def command_stats(opts, pos):
    _, _, no_headers, head, data = get_rows(opts, pos)
    indices = select_indices(opts.get("select"), head, not no_headers)
    everything = bool(opts.get("everything"))
    want_median = everything or bool(opts.get("median"))
    want_mode = everything or bool(opts.get("mode"))
    want_cardinality = everything or bool(opts.get("cardinality"))
    stats = [ColumnStats(bool(opts.get("nulls")), True) for _ in indices]
    for row in data:
        for stat, index in zip(stats, indices):
            stat.add(row[index])
    headers = [b"field", b"type", b"sum", b"min", b"max", b"min_length", b"max_length", b"mean", b"stddev"]
    if want_median:
        headers.append(b"median")
    if want_mode:
        headers.append(b"mode")
    if want_cardinality:
        headers.append(b"cardinality")
    output = [headers]
    for i, (index, stat) in enumerate(zip(indices, stats)):
        field = str(i).encode() if no_headers else head[index]
        output.append([field] + stat.record(want_median, want_mode, want_cardinality))
    write_bytes(encode_csv(output), opts.get("output"))


def trim_frequency(raw: bytes) -> bytes:
    try:
        return raw.decode().strip().encode()
    except UnicodeDecodeError:
        return raw


def frequency_order(table: Counter, ascending: bool):
    def compare(left, right):
        if left[1] != right[1]:
            if ascending:
                return -1 if left[1] < right[1] else 1
            return -1 if left[1] > right[1] else 1
        return -1 if left[0] > right[0] else (1 if left[0] < right[0] else 0)
    return sorted(table.items(), key=cmp_to_key(compare))


def command_frequency(opts, pos):
    _, _, no_headers, head, data = get_rows(opts, pos)
    indices = select_indices(opts.get("select"), head, not no_headers)
    normal = sorted(set(indices))
    limit = as_uint(opts.get("limit"), "limit", 10)
    output = [[b"field", b"value", b"count"]]
    for ordinal, index in enumerate(normal):
        counts = Counter()
        for row in data:
            value = trim_frequency(row[index])
            if value or not opts.get("no_nulls"):
                counts[value] += 1
        field = str(ordinal + 1).encode() if no_headers else head[index]
        values = frequency_order(counts, bool(opts.get("asc")))
        if limit:
            values = values[:limit]
        for value, count in values:
            output.append([field, b"(NULL)" if value == b"" else value, str(count).encode()])
    write_bytes(encode_csv(output), opts.get("output"))


HANDLERS = {
    "headers": command_headers, "count": command_count, "select": command_select,
    "slice": command_slice, "search": command_search, "sort": command_sort,
    "table": command_table, "fmt": command_fmt, "stats": command_stats,
    "frequency": command_frequency,
}


def run(argv: list[str]) -> int:
    if not argv:
        sys.stderr.write("xsv is a suite of CSV command line utilities.\n\nPlease choose one of the following commands:\n    " + COMMANDS)
        return 0
    if argv == ["--version"]:
        print(VERSION)
        return 0
    if argv == ["--list"]:
        print("Installed commands:\n    " + COMMANDS, end="")
        return 0
    if argv[0] in ("-h", "--help", "help"):
        print(MAIN_USAGE, end="")
        return 0
    command = argv[0]
    if command not in HANDLERS:
        raise UsageError(f"Invalid value for '<command>': '{command}' is not one of the choices.")
    opts, pos = parse_options(command, argv[1:])
    if opts.get("help"):
        print(USAGES[command], end="")
        return 0
    if opts.get("version"):
        print(VERSION)
        return 0
    HANDLERS[command](opts, pos)
    return 0


def main() -> int:
    try:
        return run(sys.argv[1:])
    except UsageError as err:
        command = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in USAGES else None
        usage = MAIN_USAGE
        if command:
            source = USAGES[command]
            start = source.index("Usage:")
            end = source.find("\n\n", start)
            usage = source[start:] if end < 0 else source[start:end + 1]
        sys.stderr.buffer.write((str(err) + "\n\n" + usage).encode())
        return 1
    except CliError as err:
        sys.stderr.buffer.write((str(err) + "\n").encode())
        return 1
    except BrokenPipeError:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
