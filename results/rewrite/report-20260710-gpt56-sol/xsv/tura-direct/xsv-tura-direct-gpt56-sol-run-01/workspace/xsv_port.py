#!/usr/bin/env python3
"""A standard-library Python port of the xsv 0.13.0 benchmark commands."""

import csv
import functools
import io
import math
import os
import re
import sys
from collections import Counter


VERSION = "0.13.0"
COMMANDS = {
    "headers", "count", "select", "slice", "search", "sort", "table",
    "fmt", "stats", "frequency",
}

MAIN_HELP = """Usage:
    xsv <command> [<args>...]
    xsv [options]

Options:
    --list        List all commands available.
    -h, --help    Display this message
    <command> -h  Display the command help message
    --version     Print version info and exit

Commands:
    cat         Concatenate by row or column
    count       Count records
    fixlengths  Makes all records have same length
    flatten     Show one field per line
    fmt         Format CSV output (change field delimiter)
    frequency   Show frequency tables
    headers     Show header names
    help        Show this usage message.
    index       Create CSV index for faster access
    input       Read CSV data with special quoting rules
    join        Join CSV files
    sample      Randomly sample CSV data
    search      Search CSV data with regexes
    select      Select columns from CSV
    slice       Slice records from CSV
    sort        Sort CSV data
    split       Split CSV data into many files
    stats       Compute basic statistics
    table       Align CSV data into columns
"""

SHORT_HELP = {
    "headers": "Prints the fields of the first row in the CSV data.",
    "count": "Prints a count of the number of records in the CSV data.",
    "select": "Select columns from CSV data efficiently.",
    "slice": "Returns the rows in the range specified (starting at 0, half-open interval).",
    "search": "Filters CSV data by whether the given regex matches a row.",
    "sort": "Sorts CSV data lexicographically.",
    "table": "Formats CSV data into a table by padding columns with spaces.",
    "fmt": "Reformats CSV data with a custom delimiter or record terminator.",
    "stats": "Computes basic statistics on CSV data.",
    "frequency": "Compute a frequency table on CSV data.",
}


class XsvError(Exception):
    pass


def eprint(message):
    sys.stderr.buffer.write((str(message) + "\n").encode("utf-8", "surrogateescape"))


def delimiter(value):
    if value == r"\t":
        return "\t"
    if len(value) != 1 or ord(value) > 127:
        raise XsvError("Could not convert '{}' to a single ASCII character.".format(value))
    return value


OPTION_DEFS = {
    "headers": {"-j": ("just_names", 0), "--just-names": ("just_names", 0),
                "--intersect": ("intersect", 0), "-d": ("delimiter", 1),
                "--delimiter": ("delimiter", 1)},
    "count": {"-n": ("no_headers", 0), "--no-headers": ("no_headers", 0),
              "-d": ("delimiter", 1), "--delimiter": ("delimiter", 1)},
    "select": {"-o": ("output", 1), "--output": ("output", 1),
               "-n": ("no_headers", 0), "--no-headers": ("no_headers", 0),
               "-d": ("delimiter", 1), "--delimiter": ("delimiter", 1)},
    "slice": {"-s": ("start", 1), "--start": ("start", 1),
              "-e": ("end", 1), "--end": ("end", 1),
              "-l": ("len", 1), "--len": ("len", 1),
              "-i": ("index", 1), "--index": ("index", 1),
              "-o": ("output", 1), "--output": ("output", 1),
              "-n": ("no_headers", 0), "--no-headers": ("no_headers", 0),
              "-d": ("delimiter", 1), "--delimiter": ("delimiter", 1)},
    "search": {"-i": ("ignore_case", 0), "--ignore-case": ("ignore_case", 0),
               "-s": ("select", 1), "--select": ("select", 1),
               "-v": ("invert_match", 0), "--invert-match": ("invert_match", 0),
               "-o": ("output", 1), "--output": ("output", 1),
               "-n": ("no_headers", 0), "--no-headers": ("no_headers", 0),
               "-d": ("delimiter", 1), "--delimiter": ("delimiter", 1)},
    "sort": {"-s": ("select", 1), "--select": ("select", 1),
             "-N": ("numeric", 0), "--numeric": ("numeric", 0),
             "-R": ("reverse", 0), "--reverse": ("reverse", 0),
             "-o": ("output", 1), "--output": ("output", 1),
             "-n": ("no_headers", 0), "--no-headers": ("no_headers", 0),
             "-d": ("delimiter", 1), "--delimiter": ("delimiter", 1)},
    "table": {"-w": ("width", 1), "--width": ("width", 1),
              "-p": ("pad", 1), "--pad": ("pad", 1),
              "-c": ("condense", 1), "--condense": ("condense", 1),
              "-o": ("output", 1), "--output": ("output", 1),
              "-d": ("delimiter", 1), "--delimiter": ("delimiter", 1)},
    "fmt": {"-t": ("out_delimiter", 1), "--out-delimiter": ("out_delimiter", 1),
            "--crlf": ("crlf", 0), "--ascii": ("ascii", 0),
            "-o": ("output", 1), "--output": ("output", 1),
            "-d": ("delimiter", 1), "--delimiter": ("delimiter", 1),
            "--quote": ("quote", 1), "--quote-always": ("quote_always", 0),
            "--escape": ("escape", 1)},
    "stats": {"-s": ("select", 1), "--select": ("select", 1),
              "--everything": ("everything", 0), "--mode": ("mode", 0),
              "--cardinality": ("cardinality", 0), "--median": ("median", 0),
              "--nulls": ("nulls", 0), "-j": ("jobs", 1), "--jobs": ("jobs", 1),
              "-o": ("output", 1), "--output": ("output", 1),
              "-n": ("no_headers", 0), "--no-headers": ("no_headers", 0),
              "-d": ("delimiter", 1), "--delimiter": ("delimiter", 1)},
    "frequency": {"-s": ("select", 1), "--select": ("select", 1),
                  "-l": ("limit", 1), "--limit": ("limit", 1),
                  "-a": ("asc", 0), "--asc": ("asc", 0),
                  "--no-nulls": ("no_nulls", 0),
                  "-j": ("jobs", 1), "--jobs": ("jobs", 1),
                  "-o": ("output", 1), "--output": ("output", 1),
                  "-n": ("no_headers", 0), "--no-headers": ("no_headers", 0),
                  "-d": ("delimiter", 1), "--delimiter": ("delimiter", 1)},
}


def parse_options(command, argv):
    defs = OPTION_DEFS[command]
    values = {}
    positional = []
    i = 0
    options = True
    while i < len(argv):
        arg = argv[i]
        if options and arg == "--":
            options = False
            i += 1
            continue
        if options and arg.startswith("--"):
            name, sep, attached = arg.partition("=")
            if name not in defs:
                raise XsvError("Unknown flag: '{}'".format(name))
            dest, takes = defs[name]
            if takes:
                if sep:
                    value = attached
                else:
                    i += 1
                    if i >= len(argv):
                        raise XsvError("Flag '{}' requires an argument.".format(name))
                    value = argv[i]
                values[dest] = value
            elif sep:
                raise XsvError("Flag '{}' does not take an argument.".format(name))
            else:
                values[dest] = True
            i += 1
            continue
        if options and arg.startswith("-") and arg != "-":
            j = 1
            while j < len(arg):
                name = "-" + arg[j]
                if name not in defs:
                    raise XsvError("Unknown flag: '{}'".format(name))
                dest, takes = defs[name]
                if takes:
                    if j + 1 < len(arg):
                        values[dest] = arg[j + 1:]
                    else:
                        i += 1
                        if i >= len(argv):
                            raise XsvError("Flag '{}' requires an argument.".format(name))
                        values[dest] = argv[i]
                    j = len(arg)
                else:
                    values[dest] = True
                    j += 1
            i += 1
            continue
        positional.append(arg)
        i += 1
    return values, positional


def as_nonnegative(value, name):
    try:
        number = int(value)
        if number < 0:
            raise ValueError()
        return number
    except ValueError:
        raise XsvError("Could not convert '{}' to an integer for --{}.".format(value, name))


def no_headers(opts):
    value = bool(opts.get("no_headers"))
    if os.environ.get("XSV_TOGGLE_HEADERS", "0") == "1":
        value = not value
    return value


def read_text(path):
    if path is None or path == "-":
        return sys.stdin.buffer.read().decode("utf-8", "surrogateescape")
    with open(path, "rb") as handle:
        return handle.read().decode("utf-8", "surrogateescape")


def read_rows(path, delim=","):
    text = read_text(path)
    try:
        return [list(row) for row in csv.reader(
            io.StringIO(text, newline=""), delimiter=delim, quotechar='"',
            doublequote=True, strict=True)]
    except csv.Error as err:
        raise XsvError("CSV error: {}".format(err))


def encode_text(text):
    return text.encode("utf-8", "surrogateescape")


def csv_bytes(rows, delim=",", terminator="\n", quote='"', quote_all=False,
              escape=None, double_quote=True):
    stream = io.StringIO(newline="")
    writer = csv.writer(
        stream, delimiter=delim, quotechar=quote, lineterminator=terminator,
        quoting=csv.QUOTE_ALL if quote_all else csv.QUOTE_MINIMAL,
        escapechar=escape, doublequote=double_quote)
    for row in rows:
        writer.writerow(row)
    return encode_text(stream.getvalue())


def write_bytes(data, path=None):
    if path is None or path == "-":
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    else:
        with open(path, "wb") as handle:
            handle.write(data)


def command_input(positional, minimum=0, maximum=1):
    if len(positional) < minimum or len(positional) > maximum:
        raise XsvError("Invalid arguments.")
    return positional[-1] if positional else None


def split_selector(raw):
    pieces = []
    current = []
    quoted = False
    i = 0
    while i < len(raw):
        char = raw[i]
        if char == '"':
            if quoted and i + 1 < len(raw) and raw[i + 1] == '"':
                current.append('"')
                i += 2
                continue
            quoted = not quoted
            current.append(char)
        elif char == "," and not quoted:
            pieces.append("".join(current))
            current = []
        else:
            current.append(char)
        i += 1
    if quoted:
        raise XsvError("Unclosed quote in selector.")
    pieces.append("".join(current))
    return pieces


def selector_hyphen(token):
    quoted = False
    for i, char in enumerate(token):
        if char == '"':
            quoted = not quoted
        elif char == "-" and not quoted:
            return token[:i], token[i + 1:]
    return None


def parse_one_selector(token):
    token = token.strip()
    was_quoted = len(token) >= 2 and token[0] == '"' and token[-1] == '"'
    if was_quoted:
        return ("name", token[1:-1].replace('""', '"'), 0)
    if token.isdigit():
        return ("index", int(token))
    match = re.fullmatch(r"(.*)\[(\d+)\]", token, re.DOTALL)
    if match:
        return ("name", match.group(1), int(match.group(2)))
    return ("name", token, 0)


def one_index(spec, headers, use_names, start_end=None):
    if spec is None:
        return 0 if start_end == "start" else len(headers) - 1
    if spec[0] == "index":
        index = spec[1]
        if index < 1 or index > len(headers):
            raise XsvError(
                "Selector index {} is out of bounds. Index must be >= 1 and <= {}."
                .format(index, len(headers)))
        return index - 1
    name, occurrence = spec[1], spec[2]
    if not use_names:
        raise XsvError(
            "Selector name '{}' is invalid. Names cannot be used with --no-headers."
            .format(name))
    found = [i for i, header in enumerate(headers) if header == name]
    if occurrence >= len(found):
        if occurrence:
            raise XsvError(
                "Selector name '{}[{}]' does not exist as a named header in the given CSV data."
                .format(name, occurrence))
        raise XsvError(
            "Selector name '{}' does not exist as a named header in the given CSV data."
            .format(name))
    return found[occurrence]


def select_indices(raw, headers, use_names):
    invert = raw.startswith("!")
    if invert:
        raw = raw[1:]
    if raw == "":
        indices = list(range(len(headers)))
    else:
        indices = []
        for token in split_selector(raw):
            span = selector_hyphen(token)
            if span is None:
                indices.append(one_index(parse_one_selector(token), headers, use_names))
                continue
            left, right = span
            first = one_index(parse_one_selector(left) if left else None,
                              headers, use_names, "start")
            last = one_index(parse_one_selector(right) if right else None,
                             headers, use_names, "end")
            step = 1 if first <= last else -1
            indices.extend(range(first, last + step, step))
    if invert:
        omitted = set(indices)
        return [i for i in range(len(headers)) if i not in omitted]
    return indices


def selected(row, indices):
    return [row[i] if i < len(row) else "" for i in indices]


def rows_and_header(path, delim, nh):
    rows = read_rows(path, delim)
    if nh:
        return [], rows, rows[0] if rows else []
    return (rows[0] if rows else []), rows[1:], (rows[0] if rows else [])


def run_headers(opts, positional):
    delim = delimiter(opts.get("delimiter", ","))
    paths = positional or [None]
    headers = []
    for path in paths:
        rows = read_rows(path, delim)
        head = rows[0] if rows else []
        for field in head:
            if not opts.get("intersect") or field not in headers:
                headers.append(field)
    just_names = bool(opts.get("just_names")) or len(paths) > 1
    if just_names:
        write_bytes(b"".join(encode_text(field) + b"\n" for field in headers))
    else:
        lines = [[str(i + 1), field] for i, field in enumerate(headers)]
        write_bytes(aligned_bytes(lines, 2, 2))


def run_count(opts, positional):
    path = command_input(positional)
    rows = read_rows(path, delimiter(opts.get("delimiter", ",")))
    count = len(rows) if no_headers(opts) else max(0, len(rows) - 1)
    write_bytes(encode_text(str(count) + "\n"))


def run_select(opts, positional):
    if not positional or len(positional) > 2:
        raise XsvError("Invalid arguments.")
    raw = positional[0]
    path = positional[1] if len(positional) == 2 else None
    nh = no_headers(opts)
    header, records, first = rows_and_header(
        path, delimiter(opts.get("delimiter", ",")), nh)
    indices = select_indices(raw, first, not nh)
    output = []
    if not nh and header:
        output.append(selected(header, indices))
    output.extend(selected(row, indices) for row in records)
    write_bytes(csv_bytes(output), opts.get("output"))


def run_slice(opts, positional):
    path = command_input(positional)
    nh = no_headers(opts)
    header, records, _ = rows_and_header(
        path, delimiter(opts.get("delimiter", ",")), nh)
    out = [] if nh or not header else [header]
    # xsv writes the header before validating the requested range.
    if opts.get("output") is None and out:
        write_bytes(csv_bytes(out))
        out = []
    index = as_nonnegative(opts["index"], "index") if "index" in opts else None
    start = as_nonnegative(opts["start"], "start") if "start" in opts else None
    end = as_nonnegative(opts["end"], "end") if "end" in opts else None
    length = as_nonnegative(opts["len"], "len") if "len" in opts else None
    if index is not None:
        if start is not None or end is not None or length is not None:
            raise XsvError("--index cannot be used with --start, --end or --len")
        start, end = index, index + 1
    elif end is not None and length is not None:
        raise XsvError("--end and --len cannot be used at the same time.")
    else:
        start = start or 0
        if end is not None and start > end:
            raise XsvError(
                "The end of the range ({}) must be greater than or\nequal to the start of the range ({})."
                .format(end, start))
        end = start + length if length is not None else end
    part = records[start:end]
    if opts.get("output") is not None:
        out.extend(part)
        write_bytes(csv_bytes(out), opts.get("output"))
    else:
        write_bytes(csv_bytes(part))


def run_search(opts, positional):
    if not positional or len(positional) > 2:
        raise XsvError("Invalid arguments.")
    pattern_text = positional[0]
    path = positional[1] if len(positional) == 2 else None
    try:
        pattern = re.compile(pattern_text, re.IGNORECASE if opts.get("ignore_case") else 0)
    except re.error as err:
        raise XsvError(str(err))
    nh = no_headers(opts)
    header, records, first = rows_and_header(
        path, delimiter(opts.get("delimiter", ",")), nh)
    indices = select_indices(opts.get("select", ""), first, not nh)
    out = [] if nh or not header else [header]
    for row in records:
        match = any(pattern.search(field) is not None for field in selected(row, indices))
        if bool(opts.get("invert_match")) != match:
            out.append(row)
    write_bytes(csv_bytes(out), opts.get("output"))


def byte_key(value):
    return encode_text(value)


def compare_lex(left, right):
    for a, b in zip(left, right):
        aa, bb = byte_key(a), byte_key(b)
        if aa < bb:
            return -1
        if aa > bb:
            return 1
    return (len(left) > len(right)) - (len(left) < len(right))


def rust_number(value):
    try:
        if re.fullmatch(r"[+-]?\d+", value):
            number = int(value)
            if -(2 ** 63) <= number < 2 ** 63:
                return number
        return float(value)
    except ValueError:
        return None


def compare_numeric(left, right):
    for a, b in zip(left, right):
        aa, bb = rust_number(a), rust_number(b)
        if aa is None and bb is None:
            return 0
        if aa is None:
            return -1
        if bb is None:
            return 1
        if isinstance(aa, float) and math.isnan(aa):
            continue
        if isinstance(bb, float) and math.isnan(bb):
            continue
        if aa < bb:
            return -1
        if aa > bb:
            return 1
    return (len(left) > len(right)) - (len(left) < len(right))


def run_sort(opts, positional):
    path = command_input(positional)
    nh = no_headers(opts)
    header, records, first = rows_and_header(
        path, delimiter(opts.get("delimiter", ",")), nh)
    indices = select_indices(opts.get("select", ""), first, not nh)
    comparator = compare_numeric if opts.get("numeric") else compare_lex
    def cmp_rows(a, b):
        result = comparator(selected(a, indices), selected(b, indices))
        return -result if opts.get("reverse") else result
    records.sort(key=functools.cmp_to_key(cmp_rows))
    out = ([] if nh or not header else [header]) + records
    write_bytes(csv_bytes(out), opts.get("output"))


def condense(value, limit):
    if limit is None or len(value) <= limit:
        return value
    return value[:limit] + "..."


def aligned_bytes(rows, minimum, padding):
    if not rows:
        return b""
    columns = max(len(row) for row in rows)
    widths = []
    for col in range(columns):
        longest = max((len(encode_text(row[col])) if col < len(row) else 0)
                      for row in rows)
        widths.append(max(minimum, longest) + padding)
    output = bytearray()
    for row in rows:
        for col, field in enumerate(row):
            data = encode_text(field)
            output.extend(data)
            if col + 1 < len(row):
                output.extend(b" " * max(0, widths[col] - len(data)))
        output.extend(b"\n")
    return bytes(output)


def run_table(opts, positional):
    path = command_input(positional)
    rows = read_rows(path, delimiter(opts.get("delimiter", ",")))
    limit = as_nonnegative(opts["condense"], "condense") if "condense" in opts else None
    rows = [[condense(field, limit) for field in row] for row in rows]
    width = as_nonnegative(opts.get("width", "2"), "width")
    pad = as_nonnegative(opts.get("pad", "2"), "pad")
    write_bytes(aligned_bytes(rows, width, pad), opts.get("output"))


def run_fmt(opts, positional):
    path = command_input(positional)
    rows = read_rows(path, delimiter(opts.get("delimiter", ",")))
    out_delim = delimiter(opts.get("out_delimiter", ","))
    terminator = "\r\n" if opts.get("crlf") else "\n"
    if opts.get("ascii"):
        out_delim, terminator = "\x1f", "\x1e"
    quote = delimiter(opts.get("quote", '"'))
    escape = delimiter(opts["escape"]) if "escape" in opts else None
    data = csv_bytes(rows, out_delim, terminator, quote,
                     bool(opts.get("quote_always")), escape, escape is None)
    write_bytes(data, opts.get("output"))


def float_text(value):
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "inf" if value > 0 else "-inf"
    if value == 0:
        return "0"
    rendered = repr(float(value))
    return rendered[:-2] if rendered.endswith(".0") else rendered


def field_type(values):
    current = "NULL"
    for value in values:
        if value == "":
            continue
        try:
            encode_text(value).decode("utf-8")
        except UnicodeDecodeError:
            return "Unknown"
        number = rust_number(value)
        sample = "Integer" if number is not None and isinstance(number, int) else (
            "Float" if number is not None else "Unicode")
        if current == "NULL":
            current = sample
        elif current == "Integer" and sample == "Float":
            current = "Float"
        elif current == "Float" and sample == "Integer":
            pass
        elif current != sample:
            current = "Unicode"
    return current


def numeric_values(values, include_nulls):
    result = []
    for value in values:
        if value == "":
            if include_nulls:
                result.append(0.0)
            continue
        number = rust_number(value)
        if number is not None:
            result.append(float(number))
    return result


def minmax_for(values, typ):
    nonnull = [value for value in values if value != ""]
    if not nonnull:
        return "", ""
    if typ in ("Integer", "Float"):
        pairs = [(rust_number(value), value) for value in nonnull]
        pairs = [(number, value) for number, value in pairs
                 if number is not None and not (isinstance(number, float) and math.isnan(number))]
        if not pairs:
            return "NaN", "NaN"
        low = min(number for number, _ in pairs)
        high = max(number for number, _ in pairs)
        if typ == "Integer":
            return str(int(low)), str(int(high))
        return float_text(float(low)), float_text(float(high))
    return min(nonnull, key=byte_key), max(nonnull, key=byte_key)


def median_text(numbers):
    usable = [number for number in numbers if not math.isnan(number)]
    if not usable:
        return "NaN" if numbers else ""
    usable.sort()
    middle = len(usable) // 2
    if len(usable) % 2:
        return float_text(usable[middle])
    return float_text((usable[middle - 1] + usable[middle]) / 2.0)


def stats_row(name, values, opts):
    typ = field_type(values)
    low, high = minmax_for(values, typ)
    lengths = [len(encode_text(value)) for value in values]
    minimum_length = str(min(lengths)) if lengths else ""
    maximum_length = str(max(lengths)) if lengths else ""
    numbers = numeric_values(values, bool(opts.get("nulls")))
    if typ == "Integer":
        total = str(sum(int(rust_number(value)) for value in values if value != ""))
    elif typ == "Float":
        total = float_text(sum(float(rust_number(value)) for value in values if value != ""))
    else:
        total = ""
    if typ in ("Integer", "Float") and numbers:
        mean_value = sum(numbers) / len(numbers)
        variance = sum((number - mean_value) ** 2 for number in numbers) / len(numbers)
        mean = float_text(mean_value)
        stddev = float_text(math.sqrt(variance))
    else:
        mean = stddev = ""
    row = [name, typ, total, low, high, minimum_length, maximum_length, mean, stddev]
    everything = bool(opts.get("everything"))
    if opts.get("median") or everything:
        row.append(median_text(numeric_values(values, False))
                   if typ in ("Integer", "Float") else "")
    if opts.get("mode") or everything:
        counts = Counter(values)
        if counts:
            top = max(counts.values())
            modes = [value for value, count in counts.items() if count == top]
            row.append(modes[0] if len(modes) == 1 else "N/A")
        else:
            row.append("")
    if opts.get("cardinality") or everything:
        row.append(str(len(set(values))))
    return row


def run_stats(opts, positional):
    path = command_input(positional)
    nh = no_headers(opts)
    header, records, first = rows_and_header(
        path, delimiter(opts.get("delimiter", ",")), nh)
    indices = select_indices(opts.get("select", ""), first, not nh)
    names = [str(index + 1) for index in indices] if nh else selected(header, indices)
    headings = ["field", "type", "sum", "min", "max", "min_length",
                "max_length", "mean", "stddev"]
    if opts.get("median") or opts.get("everything"):
        headings.append("median")
    if opts.get("mode") or opts.get("everything"):
        headings.append("mode")
    if opts.get("cardinality") or opts.get("everything"):
        headings.append("cardinality")
    out = [headings]
    for name, index in zip(names, indices):
        values = [row[index] if index < len(row) else "" for row in records]
        out.append(stats_row(name, values, opts))
    write_bytes(csv_bytes(out), opts.get("output"))


def trim_frequency(value):
    try:
        encode_text(value).decode("utf-8")
        return value.strip()
    except UnicodeDecodeError:
        return value


def run_frequency(opts, positional):
    path = command_input(positional)
    nh = no_headers(opts)
    header, records, first = rows_and_header(
        path, delimiter(opts.get("delimiter", ",")), nh)
    indices = select_indices(opts.get("select", ""), first, not nh)
    names = [str(index + 1) for index in indices] if nh else selected(header, indices)
    limit = as_nonnegative(opts.get("limit", "10"), "limit")
    out = [["field", "value", "count"]]
    for name, index in zip(names, indices):
        values = [trim_frequency(row[index] if index < len(row) else "") for row in records]
        if opts.get("no_nulls"):
            values = [value for value in values if value != ""]
        counts = Counter(values)
        # The Rust frequency crate leaves equal-count order unspecified. A byte
        # tie break keeps this port deterministic while preserving count order.
        if opts.get("asc"):
            pairs = sorted(counts.items(), key=lambda pair: (pair[1], byte_key(pair[0])))
        else:
            pairs = sorted(counts.items(), key=lambda pair: (-pair[1], byte_key(pair[0])))
        if limit:
            pairs = pairs[:limit]
        for value, count in pairs:
            out.append([name, "(NULL)" if value == "" else value, str(count)])
    write_bytes(csv_bytes(out), opts.get("output"))


RUNNERS = {
    "headers": run_headers,
    "count": run_count,
    "select": run_select,
    "slice": run_slice,
    "search": run_search,
    "sort": run_sort,
    "table": run_table,
    "fmt": run_fmt,
    "stats": run_stats,
    "frequency": run_frequency,
}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        if not argv or argv[0] in ("-h", "--help", "help"):
            sys.stdout.write(MAIN_HELP)
            return 0
        if argv[0] == "--version":
            sys.stdout.write("xsv {}\n".format(VERSION))
            return 0
        if argv[0] == "--list":
            sys.stdout.write("\n".join(sorted(COMMANDS)) + "\n")
            return 0
        command = argv.pop(0)
        if command not in COMMANDS:
            raise XsvError(
                "Could not match '{}' with any of the allowed variants: "
                "[\"Cat\", \"Count\", \"FixLengths\", \"Flatten\", \"Fmt\", "
                "\"Frequency\", \"Headers\", \"Help\", \"Index\", \"Input\", "
                "\"Join\", \"Partition\", \"Sample\", \"Search\", \"Select\", "
                "\"Slice\", \"Sort\", \"Split\", \"Stats\", \"Table\"]"
                .format(command))
        if "-h" in argv or "--help" in argv:
            sys.stdout.write(SHORT_HELP[command] + "\n")
            return 0
        opts, positional = parse_options(command, argv)
        RUNNERS[command](opts, positional)
        return 0
    except BrokenPipeError:
        return 0
    except (XsvError, OSError, UnicodeError, csv.Error) as err:
        eprint(err)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
