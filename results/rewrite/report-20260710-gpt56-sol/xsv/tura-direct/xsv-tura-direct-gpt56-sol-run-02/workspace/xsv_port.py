#!/usr/bin/env python3
"""A dependency-free Python port of the benchmark-relevant xsv 0.13.0 CLI."""

import csv
import functools
import io
import math
import os
import re
import statistics
import sys
from collections import Counter


VERSION = "0.13.0"
COMMANDS = ("headers", "count", "select", "slice", "search", "sort",
            "table", "fmt", "stats", "frequency")


class CliError(Exception):
    pass


def delimiter(value):
    if value == r"\t":
        return b"\t"
    raw = value.encode("utf-8")
    if len(raw) != 1 or raw[0] > 127:
        raise CliError("Could not convert '{}' to a single ASCII character.".format(value))
    return raw


def path_delimiter(path, explicit):
    if explicit is not None:
        return delimiter(explicit)
    return b"\t" if path and path != "-" and path.endswith(".tsv") else b","


def read_input(path):
    if path is None or path == "-":
        return sys.stdin.buffer.read()
    try:
        with open(path, "rb") as source:
            return source.read()
    except OSError as err:
        raise CliError("failed to open {}: {}".format(path, err.strerror))


def parse_csv(data, delim=b",", quote=b'"'):
    """Parse byte CSV with the material behavior of csv 1.x ByteRecord."""
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    d, q = delim[0], quote[0]
    rows, row, field = [], [], bytearray()
    quoted = False
    touched = False
    i = 0
    while i < len(data):
        c = data[i]
        if quoted:
            if c == q:
                if i + 1 < len(data) and data[i + 1] == q:
                    field.append(q)
                    i += 2
                    continue
                quoted = False
            else:
                field.append(c)
            i += 1
            continue
        if c == q and not field:
            quoted = True
            touched = True
        elif c == d:
            row.append(bytes(field)); field.clear()
            touched = True
        elif c == 10 or c == 13:
            if c == 13 and i + 1 < len(data) and data[i + 1] == 10:
                i += 1
            if touched or row or field:
                row.append(bytes(field)); rows.append(row)
            field.clear(); row = []; touched = False
        else:
            field.append(c)
            touched = True
        i += 1
    if field or row or touched:
        row.append(bytes(field)); rows.append(row)
    if rows:
        width = len(rows[0])
        byte_pos = 0
        for number, record in enumerate(rows[1:], 1):
            if len(record) != width:
                raise CliError("CSV error: record {}: found record with {} fields, but the previous record has {} fields".format(number, len(record), width))
    return rows


def needs_quote(field, delim, quote):
    return any(c in field for c in (delim, quote, b"\n", b"\r"))


def encode_csv(rows, delim=b",", term=b"\n", quote=b'"', always=False,
               escape=None):
    out = bytearray()
    for row in rows:
        encoded = []
        for value in row:
            value = value if isinstance(value, bytes) else str(value).encode("utf-8")
            if always or needs_quote(value, delim, quote):
                if escape is None:
                    value = value.replace(quote, quote + quote)
                else:
                    value = value.replace(quote, escape + quote)
                value = quote + value + quote
            encoded.append(value)
        out.extend(delim.join(encoded)); out.extend(term)
    return bytes(out)


def write_output(data, path=None):
    if path:
        with open(path, "wb") as dest:
            dest.write(data)
    else:
        sys.stdout.buffer.write(data)


def get_option(argv, short, long, default=None, cast=None):
    for i, arg in enumerate(argv):
        if arg == short or arg == long:
            if i + 1 >= len(argv):
                raise CliError("Flag '{}' requires argument".format(arg))
            value = argv[i + 1]
            return cast(value) if cast else value
        prefix = long + "="
        if arg.startswith(prefix):
            value = arg[len(prefix):]
            return cast(value) if cast else value
    return default


def has(argv, *names):
    return any(name in argv for name in names)


VALUE_OPTIONS = {
    "-d", "--delimiter", "-o", "--output", "-s", "--select",
    "--start", "-e", "--end", "-l", "--len", "-i", "--index",
    "-w", "--width", "-p", "--pad", "-c", "--condense", "-t",
    "--out-delimiter", "--quote", "--escape", "-j", "--jobs",
    "--limit",
}


def positionals(argv):
    result, skip, after_dash = [], False, False
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--":
            after_dash = True; i += 1; continue
        if not after_dash and arg in VALUE_OPTIONS:
            i += 2; continue
        if not after_dash and any(arg.startswith(x + "=") for x in VALUE_OPTIONS if x.startswith("--")):
            i += 1; continue
        if not after_dash and arg.startswith("-"):
            i += 1; continue
        result.append(arg); i += 1
    return result


def common(argv):
    d = get_option(argv, "-d", "--delimiter")
    out = get_option(argv, "-o", "--output")
    no_headers = has(argv, "-n", "--no-headers")
    if os.environ.get("XSV_TOGGLE_HEADERS", "0") == "1":
        no_headers = not no_headers
    return d, out, no_headers


def records_for(argv, input_index=-1, force_no_headers=None):
    d, out, no_headers = common(argv)
    pos = positionals(argv)
    path = pos[input_index] if pos and input_index < len(pos) else None
    delim = path_delimiter(path, d)
    rows = parse_csv(read_input(path), delim)
    if force_no_headers is not None:
        no_headers = force_no_headers
    header = rows[0] if rows and not no_headers else (rows[0] if rows else [])
    body = rows if no_headers else rows[1:]
    return header, body, delim, out, no_headers, path


def parse_selector(text):
    invert = text.startswith("!")
    if invert:
        text = text[1:]
    try:
        parts = next(csv.reader([text], delimiter=",", quotechar='"')) if text else []
    except csv.Error as err:
        raise CliError(str(err))
    return invert, parts


def one_selector(token, headers, use_names):
    if token == "":
        return 0
    match = re.fullmatch(r"(.*)\[([0-9]+)\]", token)
    name, occurrence = (match.group(1), int(match.group(2))) if match else (token, 0)
    if token.isdigit():
        idx = int(token)
        if idx < 1 or idx > len(headers):
            raise CliError("Selector index {} is out of bounds. Index must be >= 1 and <= {}.".format(idx, len(headers)))
        return idx - 1
    if not use_names:
        raise CliError("Cannot use names ('{}') in selection with --no-headers set.".format(name))
    encoded = name.encode("utf-8")
    found = [i for i, value in enumerate(headers) if value == encoded]
    if not found:
        raise CliError("Selector name '{}' does not exist as a named header in the given CSV data.".format(name))
    if occurrence >= len(found):
        raise CliError("Selector index '{}' for name '{}' is out of bounds. Must be >= 0 and <= {}.".format(occurrence, name, len(found) - 1))
    return found[occurrence]


def selection(text, headers, use_names=True):
    if text is None or text == "":
        return list(range(len(headers)))
    invert, parts = parse_selector(text)
    selected = []
    for part in parts:
        split = None
        if part.startswith("-"):
            split = ("", part[1:])
        elif part.endswith("-"):
            split = (part[:-1], "")
        else:
            for i, char in enumerate(part):
                if char == "-":
                    split = (part[:i], part[i + 1:]); break
        if split is None:
            selected.append(one_selector(part, headers, use_names)); continue
        start = 0 if split[0] == "" else one_selector(split[0], headers, use_names)
        end = len(headers) - 1 if split[1] == "" else one_selector(split[1], headers, use_names)
        step = 1 if start <= end else -1
        selected.extend(range(start, end + step, step))
    if invert:
        excluded = set(selected)
        return [i for i in range(len(headers)) if i not in excluded]
    return selected


def selected_rows(rows, indexes):
    return [[row[i] for i in indexes] for row in rows]


def command_headers(argv):
    d, _, _ = common(argv)
    paths = positionals(argv) or [None]
    if sum(path is None or path == "-" for path in paths) > 1:
        raise CliError("At most one <stdin> input is allowed.")
    values = []
    intersect = has(argv, "--intersect")
    for path in paths:
        rows = parse_csv(read_input(path), path_delimiter(path, d))
        for value in (rows[0] if rows else []):
            if not intersect or value not in values:
                values.append(value)
    just = has(argv, "-j", "--just-names")
    if len(paths) == 1 and not just:
        width = len(str(len(values)))
        lines = [str(i + 1).encode() + b" " * (width - len(str(i + 1)) + 3) + v
                 for i, v in enumerate(values)]
    else:
        lines = values
    write_output(b"".join(line + b"\n" for line in lines))


def command_count(argv):
    _, body, _, _, no_headers, _ = records_for(argv)
    sys.stdout.buffer.write(str(len(body)).encode() + b"\n")


def command_select(argv):
    d, out, no_headers = common(argv)
    pos = positionals(argv)
    if not pos:
        raise CliError("Invalid arguments.")
    spec = pos[0]
    path = pos[1] if len(pos) > 1 else None
    rows = parse_csv(read_input(path), path_delimiter(path, d))
    first = rows[0] if rows else []
    indexes = selection(spec, first, not no_headers)
    write_output(encode_csv(selected_rows(rows, indexes)), out)


def command_slice(argv):
    header, body, _, out, no_headers, _ = records_for(argv)
    start = get_option(argv, "-s", "--start", cast=int)
    end = get_option(argv, "-e", "--end", cast=int)
    length = get_option(argv, "-l", "--len", cast=int)
    index = get_option(argv, "-i", "--index", cast=int)
    if index is not None and any(x is not None for x in (start, end, length)):
        if not no_headers and header: write_output(encode_csv([header]), out)
        raise CliError("--index cannot be used with --start, --end or --len")
    if end is not None and length is not None:
        if not no_headers and header: write_output(encode_csv([header]), out)
        raise CliError("--end and --len cannot be used at the same time.")
    if index is not None:
        start, end = index, index + 1
    else:
        start = start or 0
        if end is not None and start > end:
            if not no_headers and header: write_output(encode_csv([header]), out)
            raise CliError("The end of the range ({}) must be greater than or\nequal to the start of the range ({}).".format(end, start))
        end = start + length if length is not None else end
    result = body[start:end]
    if not no_headers and header:
        result.insert(0, header)
    write_output(encode_csv(result), out)


def command_search(argv):
    d, out, no_headers = common(argv)
    pos = positionals(argv)
    if not pos:
        raise CliError("Invalid arguments.")
    pattern_text = pos[0]
    path = pos[1] if len(pos) > 1 else None
    rows = parse_csv(read_input(path), path_delimiter(path, d))
    header = rows[0] if rows else []
    flags = re.IGNORECASE if has(argv, "-i", "--ignore-case") else 0
    try:
        pattern = re.compile(pattern_text.encode("utf-8"), flags)
    except re.error as err:
        raise CliError(str(err))
    indexes = selection(get_option(argv, "-s", "--select"), header, not no_headers)
    body = rows if no_headers else rows[1:]
    invert = has(argv, "-v", "--invert-match")
    kept = [row for row in body if (any(pattern.search(row[i]) for i in indexes) != invert)]
    if not no_headers and header:
        kept.insert(0, header)
    write_output(encode_csv(kept), out)


def numeric_value(value):
    try:
        text = value.decode("utf-8")
        if re.fullmatch(r"[+-]?[0-9]+", text):
            number = int(text)
            if -(2 ** 63) <= number < 2 ** 63:
                return number
        return float(text)
    except (ValueError, UnicodeDecodeError):
        return None


def command_sort(argv):
    header, body, _, out, no_headers, _ = records_for(argv)
    indexes = selection(get_option(argv, "-s", "--select"), header, not no_headers)
    numeric = has(argv, "-N", "--numeric")
    reverse = has(argv, "-R", "--reverse")
    def compare(left, right):
        for idx in indexes:
            a, b = left[idx], right[idx]
            if numeric:
                a, b = numeric_value(a), numeric_value(b)
                if a is None and b is None: continue
                if a is None: result = -1
                elif b is None: result = 1
                elif isinstance(a, float) and math.isnan(a) or isinstance(b, float) and math.isnan(b): result = 0
                else: result = (a > b) - (a < b)
            else:
                result = (a > b) - (a < b)
            if result:
                return -result if reverse else result
        return 0
    body.sort(key=functools.cmp_to_key(compare))
    if not no_headers and header:
        body.insert(0, header)
    write_output(encode_csv(body), out)


def display_width(value):
    try:
        return len(value.decode("utf-8"))
    except UnicodeDecodeError:
        return len(value)


def condense(value, limit):
    if limit is None:
        return value
    try:
        text = value.decode("utf-8")
        return value if len(text) <= limit else text[:limit].encode("utf-8") + b"..."
    except UnicodeDecodeError:
        return value if len(value) <= limit else value[:limit] + b"..."


def command_table(argv):
    d, out, _ = common(argv)
    pos = positionals(argv)
    path = pos[-1] if pos else None
    rows = parse_csv(read_input(path), path_delimiter(path, d))
    width = get_option(argv, "-w", "--width", 2, int)
    pad = get_option(argv, "-p", "--pad", 2, int)
    limit = get_option(argv, "-c", "--condense", None, int)
    rows = [[condense(field, limit) for field in row] for row in rows]
    if not rows:
        write_output(b"", out); return
    widths = [width] * len(rows[0])
    for row in rows:
        for i, field in enumerate(row):
            widths[i] = max(widths[i], display_width(field))
    output = bytearray()
    for row in rows:
        for i, field in enumerate(row):
            output.extend(field)
            if i + 1 < len(row):
                output.extend(b" " * (widths[i] - display_width(field) + pad))
        output.extend(b"\n")
    write_output(bytes(output), out)


def command_fmt(argv):
    d, out, _ = common(argv)
    pos = positionals(argv)
    path = pos[-1] if pos else None
    rows = parse_csv(read_input(path), path_delimiter(path, d))
    out_delim = delimiter(get_option(argv, "-t", "--out-delimiter", ","))
    term = b"\r\n" if has(argv, "--crlf") else b"\n"
    if has(argv, "--ascii"):
        out_delim, term = b"\x1f", b"\x1e"
    quote = delimiter(get_option(argv, "--quote", "--quote", '"'))
    escape_value = get_option(argv, "--escape", "--escape")
    escape = delimiter(escape_value) if escape_value is not None else None
    write_output(encode_csv(rows, out_delim, term, quote,
                            has(argv, "--quote-always"), escape), out)


def rust_float(value):
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "inf" if value > 0 else "-inf"
    if value == 0:
        return "0"
    if value.is_integer():
        return str(int(value))
    return repr(value)


def infer_type(values):
    typ = "NULL"
    for raw in values:
        if raw == b"":
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            return "Unknown"
        if re.fullmatch(r"[+-]?[0-9]+", text):
            try:
                number = int(text)
                sample = "Integer" if -(2 ** 63) <= number < 2 ** 63 else "Float"
            except ValueError:
                sample = "Float"
        else:
            try:
                float(text); sample = "Float"
            except ValueError:
                sample = "Unicode"
        if typ == "NULL": typ = sample
        elif typ == "Unknown" or sample == "Unknown": typ = "Unknown"
        elif typ == "Unicode" or sample == "Unicode": typ = "Unicode"
        elif typ != sample: typ = "Float"
    return typ


def mode_value(values):
    counts = Counter(values)
    if not counts:
        return "N/A"
    common = counts.most_common()
    if len(common) > 1 and common[0][1] == common[1][1]:
        return "N/A"
    return common[0][0].decode("utf-8", "replace")


def stats_record(values, include_nulls, want_median, want_mode, want_cardinality):
    typ = infer_type(values)
    nonempty = [v for v in values if v]
    lengths = [len(v) for v in values]
    result = [typ]
    numbers = []
    median_numbers = []
    rolling_type = "NULL"
    for value in nonempty:
        try: numbers.append(float(value.decode("utf-8")))
        except (ValueError, UnicodeDecodeError): pass
    for value in values:
        sample_type = infer_type([value])
        if rolling_type == "NULL": rolling_type = sample_type
        elif sample_type == "NULL": pass
        elif rolling_type == "Unknown" or sample_type == "Unknown": rolling_type = "Unknown"
        elif rolling_type == "Unicode" or sample_type == "Unicode": rolling_type = "Unicode"
        elif rolling_type != sample_type: rolling_type = "Float"
        if value and rolling_type in ("Integer", "Float"):
            median_numbers.append(float(value.decode("utf-8")))
    if typ == "Integer":
        result.append(str(sum(int(v.decode("utf-8")) for v in nonempty)))
    elif typ == "Float":
        result.append(rust_float(sum(numbers)))
    else:
        result.append("")
    if typ == "Integer" and nonempty:
        ints = [int(v.decode()) for v in nonempty]
        result.extend([str(min(ints)), str(max(ints))])
    elif typ == "Float" and numbers:
        finite_order = [n for n in numbers if not math.isnan(n)]
        result.extend([rust_float(min(finite_order)), rust_float(max(finite_order))] if finite_order else ["NaN", "NaN"])
    elif typ in ("Unicode", "Unknown") and nonempty:
        result.extend([min(nonempty).decode("utf-8", "replace"), max(nonempty).decode("utf-8", "replace")])
    else:
        result.extend(["", ""])
    result.extend([str(min(lengths)), str(max(lengths))] if lengths else ["", ""])
    if typ in ("Integer", "Float"):
        population = []
        for value in values:
            if value:
                population.append(float(value.decode("utf-8")))
            elif include_nulls:
                population.append(0.0)
        if population:
            count, mean, squared = 0, 0.0, 0.0
            for number in population:
                count += 1
                delta = number - mean
                mean += delta / count
                squared += delta * (number - mean)
            result.extend([rust_float(mean), rust_float(math.sqrt(squared / count))])
        else:
            result.extend(["", ""])
    else:
        result.extend(["", ""])
    if want_median:
        if median_numbers:
            result.append(rust_float(float(statistics.median(median_numbers))))
        else:
            result.append("")
    if want_mode:
        result.append(mode_value(values))
    if want_cardinality:
        result.append(str(len(set(values))))
    return result


def command_stats(argv):
    header, body, _, out, no_headers, _ = records_for(argv)
    indexes = selection(get_option(argv, "-s", "--select"), header, not no_headers)
    everything = has(argv, "--everything")
    med = everything or has(argv, "--median")
    mode = everything or has(argv, "--mode")
    cardinality = everything or has(argv, "--cardinality")
    names = [b"field", b"type", b"sum", b"min", b"max", b"min_length",
             b"max_length", b"mean", b"stddev"]
    if med: names.append(b"median")
    if mode: names.append(b"mode")
    if cardinality: names.append(b"cardinality")
    output = [names]
    for ordinal, index in enumerate(indexes):
        label = str(ordinal).encode() if no_headers else header[index]
        values = [row[index] for row in body]
        output.append([label] + [v.encode("utf-8") for v in stats_record(
            values, has(argv, "--nulls"), med, mode, cardinality)])
    write_output(encode_csv(output), out)


def frequency_order(counter, ascending):
    indexed = {value: i for i, value in enumerate(counter)}
    return sorted(counter.items(), key=lambda item: (
        item[1] if ascending else -item[1], indexed[item[0]]))


def command_frequency(argv):
    header, body, _, out, no_headers, _ = records_for(argv)
    indexes = selection(get_option(argv, "-s", "--select"), header, not no_headers)
    limit = get_option(argv, "-l", "--limit", 10, int)
    ascending = has(argv, "-a", "--asc")
    output = [[b"field", b"value", b"count"]]
    normal = sorted(set(indexes))
    for ordinal, index in enumerate(normal):
        label = str(ordinal + 1).encode() if no_headers else header[index]
        values = []
        for row in body:
            value = row[index]
            try: value = value.decode("utf-8").strip().encode("utf-8")
            except UnicodeDecodeError: pass
            if not value and has(argv, "--no-nulls"):
                continue
            values.append(value)
        counts = frequency_order(Counter(values), ascending)
        if limit > 0: counts = counts[:limit]
        for value, count in counts:
            output.append([label, value if value else b"(NULL)", str(count).encode()])
    write_output(encode_csv(output), out)


DISPATCH = {
    "headers": command_headers, "count": command_count,
    "select": command_select, "slice": command_slice,
    "search": command_search, "sort": command_sort,
    "table": command_table, "fmt": command_fmt,
    "stats": command_stats, "frequency": command_frequency,
}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv == ["--version"]:
        sys.stdout.buffer.write(VERSION.encode() + b"\n"); return 0
    if not argv:
        sys.stderr.buffer.write(b"xsv is a suite of CSV command line utilities.\n")
        return 0
    command, args = argv[0], argv[1:]
    if command not in DISPATCH:
        raise CliError("Could not match '{}' with any of the allowed variants.".format(command))
    if has(args, "-h", "--help"):
        sys.stdout.buffer.write("xsv {} (Python port of xsv {})\n".format(command, VERSION).encode())
        return 0
    DISPATCH[command](args)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        raise SystemExit(0)
    except (CliError, OSError, ValueError) as err:
        sys.stderr.buffer.write(str(err).encode("utf-8", "replace") + b"\n")
        raise SystemExit(1)
