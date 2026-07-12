"""Implementations of the benchmark xsv command surface."""

from __future__ import annotations

from collections import Counter
from functools import cmp_to_key
import math
import re
import sys
from typing import Any, Iterable

from xsv_core import (
    XsvError,
    load_dataset,
    default_delimiter,
    encode_record,
    output_stream,
    parse_csv,
    parse_f64,
    parse_i64,
    read_input,
    rust_float,
    select_columns,
    trim_unicode,
    validate_index,
    write_rows,
)


def headers(opts: dict[str, Any]) -> None:
    paths = opts["inputs"] or [None]
    if sum(path in (None, "-") for path in paths) > 1:
        raise XsvError("At most one <stdin> input is allowed.")
    result: list[bytes] = []
    for path in paths:
        data = load_dataset(path, opts["delimiter"], no_headers=True)
        for field in data.first:
            if not opts["intersect"] or field not in result:
                result.append(field)
    stream = sys.stdout.buffer
    indexed = len(paths) == 1 and not opts["just_names"]
    if indexed:
        width = 4
        for index, field in enumerate(result, 1):
            prefix = str(index).encode()
            stream.write(prefix + b" " * (width - len(prefix)) + field + b"\n")
    else:
        for field in result:
            stream.write(field + b"\n")
    stream.flush()


def count(opts: dict[str, Any]) -> None:
    validate_index(opts["input"])
    data = load_dataset(opts["input"], opts["delimiter"], opts["no_headers"])
    sys.stdout.buffer.write(f"{len(data.rows)}\n".encode())


def select(opts: dict[str, Any]) -> None:
    data = load_dataset(opts["input"], opts["delimiter"], opts["no_headers"])
    selected = select_columns(opts["selection"], data.first, not data.no_headers)
    rows: list[list[bytes]] = []
    if not data.no_headers:
        rows.append([data.headers[index] for index in selected])
    rows.extend([[row[index] for index in selected] for row in data.rows])
    write_rows(rows, opts["output"])


def slice_rows(opts: dict[str, Any]) -> None:
    validate_index(opts["input"])
    start = opts["start"]
    end = opts["end"]
    length = opts["len"]
    index = opts["index"]
    data = load_dataset(opts["input"], opts["delimiter"], opts["no_headers"])
    stream, close = output_stream(opts["output"])
    delimiter = default_delimiter(opts["output"])
    try:
        if not data.no_headers and data.headers:
            stream.write(encode_record(data.headers, delimiter))
            stream.flush()
        if index is not None:
            if any(value is not None for value in (start, end, length)):
                raise XsvError("--index cannot be used with --start, --end or --len")
            start, end = index, index + 1
        elif end is not None and length is not None:
            raise XsvError("--end and --len cannot be used at the same time.")
        else:
            start = 0 if start is None else start
            if end is None:
                end = start + length if length is not None else sys.maxsize
            elif start > end:
                raise XsvError(
                    f"The end of the range ({end}) must be greater than or\n"
                    f"equal to the start of the range ({start})."
                )
        for row in data.rows[start:end]:
            stream.write(encode_record(row, delimiter))
        stream.flush()
    finally:
        if close:
            stream.close()


def search(opts: dict[str, Any]) -> None:
    flags = re.IGNORECASE if opts["ignore_case"] else 0
    try:
        pattern = re.compile(opts["regex"].encode(), flags)
    except re.error as error:
        raise XsvError(str(error)) from None
    data = load_dataset(opts["input"], opts["delimiter"], opts["no_headers"])
    selected = select_columns(opts["select"], data.first, not data.no_headers)
    rows: list[list[bytes]] = []
    if not data.no_headers:
        rows.append(data.headers)
    for row in data.rows:
        matched = any(pattern.search(row[index]) is not None for index in selected)
        if matched != opts["invert"]:
            rows.append(row)
    write_rows(rows, opts["output"])


def _lex_compare(left: list[bytes], right: list[bytes], selected: list[int]) -> int:
    a = [left[index] for index in selected]
    b = [right[index] for index in selected]
    return (a > b) - (a < b)


def _num(value: bytes) -> int | float | None:
    integer = parse_i64(value)
    if integer is not None:
        return integer
    return parse_f64(value)


def _numeric_compare(left: list[bytes], right: list[bytes], selected: list[int]) -> int:
    for index in selected:
        a, b = _num(left[index]), _num(right[index])
        if a is None and b is None:
            return 0
        if a is None:
            return -1
        if b is None:
            return 1
        if isinstance(a, float) and math.isnan(a) or isinstance(b, float) and math.isnan(b):
            continue
        if a != b:
            return -1 if a < b else 1
    return 0


def sort(opts: dict[str, Any]) -> None:
    data = load_dataset(opts["input"], opts["delimiter"], opts["no_headers"])
    selected = select_columns(opts["select"], data.first, not data.no_headers)
    compare = _numeric_compare if opts["numeric"] else _lex_compare
    sign = -1 if opts["reverse"] else 1
    ordered = sorted(
        data.rows,
        key=cmp_to_key(lambda left, right: sign * compare(left, right, selected)),
    )
    rows: list[list[bytes]] = []
    if not data.no_headers:
        rows.append(data.headers)
    rows.extend(ordered)
    write_rows(rows, opts["output"])


def _condense(value: bytes, limit: int | None) -> bytes:
    if limit is None:
        return value
    try:
        text = value.decode("utf-8")
        if len(text) <= limit:
            return value
        return (text[:limit] + "...").encode("utf-8")
    except UnicodeDecodeError:
        return value if len(value) <= limit else value[:limit] + b"..."


def table(opts: dict[str, Any]) -> None:
    delim = opts["delimiter"]
    records = parse_csv(read_input(opts["input"]), delim if delim is not None else 9 if str(opts["input"]).endswith(".tsv") else 44)
    records = [[_condense(value, opts["condense"]) for value in row] for row in records]
    columns = max((len(row) for row in records), default=0)
    widths = [opts["width"]] * columns
    for row in records:
        for index, value in enumerate(row):
            widths[index] = max(widths[index], len(value))
    stream, close = output_stream(opts["output"])
    try:
        for row in records:
            for index, value in enumerate(row):
                stream.write(value)
                if index + 1 < len(row):
                    stream.write(b" " * (widths[index] - len(value) + opts["pad"]))
            stream.write(b"\n")
        stream.flush()
    finally:
        if close:
            stream.close()


def fmt(opts: dict[str, Any]) -> None:
    in_delim = opts["delimiter"]
    if in_delim is None:
        in_delim = 9 if str(opts["input"]).endswith(".tsv") else 44
    records = parse_csv(read_input(opts["input"]), in_delim)
    delimiter = opts["out_delimiter"]
    terminator = b"\r\n" if opts["crlf"] else b"\n"
    if opts["ascii"]:
        delimiter, terminator = 31, b"\x1e"
    write_rows(
        records,
        opts["output"],
        delimiter,
        terminator,
        opts["quote"],
        opts["quote_always"],
        opts["escape"],
    )


def _field_type(values: list[bytes]) -> str:
    kind = "NULL"
    for value in values:
        if not value:
            continue
        if parse_i64(value) is not None:
            sample = "Integer"
        elif parse_f64(value) is not None:
            sample = "Float"
        else:
            try:
                value.decode("utf-8")
                sample = "Unicode"
            except UnicodeDecodeError:
                sample = "Unknown"
        if kind == "NULL":
            kind = sample
        elif "Unknown" in (kind, sample):
            kind = "Unknown"
        elif "Unicode" in (kind, sample):
            kind = "Unicode"
        elif "Float" in (kind, sample):
            kind = "Float"
    return kind


def _mode(values: list[bytes]) -> bytes:
    counts = Counter(values)
    if not counts:
        return b"N/A"
    highest = max(counts.values())
    if highest <= 1:
        return b"N/A"
    modes = [value for value, amount in counts.items() if amount == highest]
    return modes[0] if len(modes) == 1 else b"N/A"


def _stats_record(values: list[bytes], opts: dict[str, Any]) -> list[bytes]:
    kind = _field_type(values)
    nonempty = [value for value in values if value]
    numbers = [parse_f64(value) for value in nonempty]
    numbers = [value for value in numbers if value is not None]
    numeric = kind in ("Integer", "Float")

    total = b""
    minimum = maximum = b""
    if numeric:
        if kind == "Integer":
            ints = [parse_i64(value) for value in nonempty]
            actual = [value for value in ints if value is not None]
            total = str(sum(actual)).encode()
            if actual:
                minimum, maximum = str(min(actual)).encode(), str(max(actual)).encode()
        else:
            total = rust_float(sum(numbers)).encode()
            if numbers:
                minimum = rust_float(min(numbers)).encode()
                maximum = rust_float(max(numbers)).encode()
    elif kind in ("Unicode", "Unknown") and nonempty:
        minimum, maximum = min(nonempty), max(nonempty)

    lengths = [len(value) for value in values]
    min_length = str(min(lengths)).encode() if lengths else b""
    max_length = str(max(lengths)).encode() if lengths else b""
    mean = stddev = b""
    if numeric and numbers:
        count = 0
        mean_value = 0.0
        moment = 0.0
        for value in values:
            parsed = parse_f64(value)
            if parsed is None:
                if not opts["nulls"] or value:
                    continue
                parsed = 0.0
            count += 1
            delta = parsed - mean_value
            mean_value += delta / count
            moment += delta * (parsed - mean_value)
        variance = moment / count
        mean = rust_float(mean_value).encode()
        stddev = rust_float(math.sqrt(variance)).encode()

    result = [kind.encode(), total, minimum, maximum, min_length, max_length, mean, stddev]
    if opts["median"] or opts["everything"]:
        median_numbers: list[float] = []
        running_kind = "NULL"
        for value in values:
            sample_kind = _field_type([value])
            if sample_kind != "NULL":
                if running_kind == "NULL":
                    running_kind = sample_kind
                elif "Unknown" in (running_kind, sample_kind):
                    running_kind = "Unknown"
                elif "Unicode" in (running_kind, sample_kind):
                    running_kind = "Unicode"
                elif "Float" in (running_kind, sample_kind):
                    running_kind = "Float"
            parsed = parse_f64(value)
            if running_kind in ("Integer", "Float") and parsed is not None:
                median_numbers.append(parsed)
        if median_numbers:
            ordered = sorted(median_numbers)
            middle = len(ordered) // 2
            median = ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2
            result.append(rust_float(median).encode())
        else:
            result.append(b"")
    if opts["mode"] or opts["everything"]:
        result.append(_mode(values))
    if opts["cardinality"] or opts["everything"]:
        result.append(str(len(set(values))).encode())
    return result


def stats(opts: dict[str, Any]) -> None:
    validate_index(opts["input"])
    data = load_dataset(opts["input"], opts["delimiter"], opts["no_headers"])
    selected = select_columns(opts["select"], data.first, not data.no_headers)
    headings = [b"field", b"type", b"sum", b"min", b"max", b"min_length", b"max_length", b"mean", b"stddev"]
    if opts["median"] or opts["everything"]:
        headings.append(b"median")
    if opts["mode"] or opts["everything"]:
        headings.append(b"mode")
    if opts["cardinality"] or opts["everything"]:
        headings.append(b"cardinality")
    rows = [headings]
    for output_index, column in enumerate(selected):
        name = str(output_index).encode() if data.no_headers else data.headers[column]
        values = [row[column] for row in data.rows]
        rows.append([name] + _stats_record(values, opts))
    write_rows(rows, opts["output"])


def frequency(opts: dict[str, Any]) -> None:
    validate_index(opts["input"])
    data = load_dataset(opts["input"], opts["delimiter"], opts["no_headers"])
    selected = select_columns(opts["select"], data.first, not data.no_headers)
    rows: list[list[bytes | str]] = [[b"field", b"value", b"count"]]
    for output_index, column in enumerate(sorted(set(selected))):
        name = str(output_index + 1).encode() if data.no_headers else data.headers[column]
        values = [trim_unicode(row[column]) for row in data.rows]
        if opts["no_nulls"]:
            values = [value for value in values if value]
        counts = Counter(values)
        ordered = sorted(counts.items(), key=lambda pair: pair[0], reverse=True)
        ordered.sort(key=lambda pair: pair[1], reverse=not opts["asc"])
        if opts["limit"]:
            ordered = ordered[: opts["limit"]]
        for value, amount in ordered:
            rows.append([name, b"(NULL)" if not value else value, str(amount)])
    write_rows(rows, opts["output"])


COMMANDS = {
    "headers": headers,
    "count": count,
    "select": select,
    "slice": slice_rows,
    "search": search,
    "sort": sort,
    "table": table,
    "fmt": fmt,
    "stats": stats,
    "frequency": frequency,
}
