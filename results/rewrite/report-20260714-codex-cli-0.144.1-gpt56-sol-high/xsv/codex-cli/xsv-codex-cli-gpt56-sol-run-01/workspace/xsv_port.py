#!/usr/bin/env python3
"""A clean-room Python port of the xsv 0.13.0 commands used by the benchmark."""

from __future__ import annotations

import math
import os
import re
import statistics
import sys
import unicodedata
from decimal import Decimal
from collections import Counter
from functools import cmp_to_key
from pathlib import Path


VERSION = "0.13.0"


class XsvError(Exception):
    pass


class UsageError(XsvError):
    pass


def parse_delimiter(value: str) -> int:
    if value == r"\t":
        return 9
    raw = value.encode("utf-8", "surrogateescape")
    if len(raw) != 1:
        raise XsvError("Could not convert '{}' to a single ASCII character.".format(value))
    if raw[0] > 127:
        raise XsvError("Could not convert '{}' to ASCII delimiter.".format(value))
    return raw[0]


def toggled_no_headers(value: bool) -> bool:
    return not value if os.environ.get("XSV_TOGGLE_HEADERS", "0") == "1" else value


def infer_delimiter(path: str | None) -> int:
    return 9 if path and path != "-" and path.endswith(".tsv") else 44


def read_input(path: str | None) -> bytes:
    if path is None or path == "-":
        return sys.stdin.buffer.read()
    try:
        with open(path, "rb") as fh:
            return fh.read()
    except OSError as e:
        raise XsvError(f"failed to open {path}: {e.strerror or e}")


def write_output(path: str | None, data: bytes) -> None:
    try:
        if path is None or path == "-":
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
        else:
            with open(path, "wb") as fh:
                fh.write(data)
    except BrokenPipeError:
        return
    except OSError as e:
        raise XsvError(str(e))


def parse_csv(data: bytes, delimiter: int = 44, quote: int = 34,
              validate_lengths: bool = True) -> list[list[bytes]]:
    """Parse RFC-4180-ish byte CSV using the defaults of rust-csv 1.0."""
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    rows: list[list[bytes]] = []
    row: list[bytes] = []
    field = bytearray()
    i = 0
    quoted = False
    at_start = True
    row_touched = False
    line = 1
    row_start_line = 1
    row_start_byte = 0
    positions: list[tuple[int, int]] = []
    while i < len(data):
        c = data[i]
        if quoted:
            if c == quote:
                if i + 1 < len(data) and data[i + 1] == quote:
                    field.append(quote)
                    i += 2
                    continue
                quoted = False
                i += 1
                continue
            field.append(c)
            if c == 10:
                line += 1
            elif c == 13 and not (i + 1 < len(data) and data[i + 1] == 10):
                line += 1
            i += 1
            continue
        if at_start and c == quote:
            quoted = True
            at_start = False
            row_touched = True
            i += 1
            continue
        if c == delimiter:
            row.append(bytes(field))
            field.clear()
            at_start = True
            row_touched = True
            i += 1
            continue
        if c == 10 or c == 13:
            crlf = c == 13 and i + 1 < len(data) and data[i + 1] == 10
            if c == 13 and i + 1 < len(data) and data[i + 1] == 10:
                i += 1
            emitted = bool(row_touched or field or row)
            if emitted:
                row.append(bytes(field))
                rows.append(row)
                positions.append((row_start_line, row_start_byte))
            row = []
            field.clear()
            at_start = True
            row_touched = False
            i += 1
            if emitted:
                if crlf:
                    row_start_line = line
                    row_start_byte = i - 1
                    line += 1
                else:
                    line += 1
                    row_start_line = line
                    row_start_byte = i
            continue
        field.append(c)
        at_start = False
        row_touched = True
        i += 1
    if quoted:
        # rust-csv accepts an EOF-terminated quoted field.
        quoted = False
    if row_touched or field or row:
        row.append(bytes(field))
        rows.append(row)
        positions.append((row_start_line, row_start_byte))
    if rows and validate_lengths:
        expected = len(rows[0])
        for n, r in enumerate(rows[1:], 2):
            if len(r) != expected:
                err_line, err_byte = positions[n - 1]
                raise XsvError(
                    "CSV error: record {} (line: {}, byte: {}): found record with {} fields, "
                    "but the previous record has {} fields".format(n - 1, err_line, err_byte, len(r), expected)
                )
    return rows


def quote_field(field: bytes, delimiter: int, quote: int = 34,
                always: bool = False, escape: int | None = None,
                record_specials: tuple[int, ...] = (10, 13)) -> bytes:
    needed = always or delimiter in field or quote in field or any(c in field for c in record_specials)
    if not needed:
        return field
    if escape is None:
        body = field.replace(bytes((quote,)), bytes((quote, quote)))
    else:
        body = field.replace(bytes((quote,)), bytes((escape, quote)))
    return bytes((quote,)) + body + bytes((quote,))


def encode_csv(rows: list[list[bytes]], delimiter: int = 44, term: bytes = b"\n",
               quote: int = 34, always: bool = False,
               escape: int | None = None) -> bytes:
    record_specials = (30,) if term == b"\x1e" else (10, 13)
    out = bytearray()
    for row in rows:
        out.extend(bytes((delimiter,)).join(
            quote_field(f, delimiter, quote, always, escape, record_specials) for f in row
        ))
        out.extend(term)
    return bytes(out)


def read_rows(path: str | None, delim_value: str | None,
              no_headers: bool) -> tuple[list[bytes], list[list[bytes]], int]:
    delim = parse_delimiter(delim_value) if delim_value is not None else infer_delimiter(path)
    rows = parse_csv(read_input(path), delim)
    nh = toggled_no_headers(no_headers)
    if nh:
        first = rows[0] if rows else []
        return first, rows, delim
    if rows:
        return rows[0], rows[1:], delim
    return [], [], delim


def out_delimiter(path: str | None, explicit: str | None = None) -> int:
    return parse_delimiter(explicit) if explicit is not None else infer_delimiter(path)


def parse_options(argv: list[str], bools: dict[str, str], values: dict[str, str]) -> tuple[dict[str, object], list[str]]:
    opts: dict[str, object] = {name: False for name in set(bools.values())}
    opts.update({name: None for name in set(values.values())})
    positionals: list[str] = []
    aliases = {**bools, **values}
    i = 0
    stop = False
    while i < len(argv):
        arg = argv[i]
        if stop or arg == "-" or not arg.startswith("-"):
            positionals.append(arg)
            i += 1
            continue
        if arg == "--":
            stop = True
            i += 1
            continue
        if arg.startswith("--"):
            name, eq, attached = arg.partition("=")
            if name not in aliases:
                raise UsageError(f"Unknown flag: '{name}'")
            canon = aliases[name]
            if name in bools:
                if eq:
                    raise UsageError(f"Flag '{name}' does not take a value")
                opts[canon] = True
            else:
                if eq:
                    opts[canon] = attached
                else:
                    i += 1
                    if i >= len(argv):
                        raise UsageError(f"Flag '{name}' requires an argument")
                    opts[canon] = argv[i]
            i += 1
            continue
        # Docopt accepts clusters of short boolean flags and attached values.
        j = 1
        while j < len(arg):
            name = "-" + arg[j]
            if name not in aliases:
                raise UsageError(f"Unknown flag: '{name}'")
            canon = aliases[name]
            if name in bools:
                opts[canon] = True
                j += 1
            else:
                if j + 1 < len(arg):
                    opts[canon] = arg[j + 1:]
                else:
                    i += 1
                    if i >= len(argv):
                        raise UsageError(f"Flag '{name}' requires an argument")
                    opts[canon] = argv[i]
                j = len(arg)
        i += 1
    return opts, positionals


COMMON_BOOL = {"-n": "no_headers", "--no-headers": "no_headers"}
COMMON_VAL = {"-d": "delimiter", "--delimiter": "delimiter",
              "-o": "output", "--output": "output"}


def one_input(pos: list[str], required_prefix: int = 0) -> str | None:
    if len(pos) > required_prefix + 1:
        raise UsageError("Invalid arguments.")
    return pos[required_prefix] if len(pos) > required_prefix else None


def selector_token(s: str, pos: int) -> tuple[tuple, int]:
    if pos < len(s) and s[pos] == '"':
        pos += 1
        chars: list[str] = []
        while True:
            if pos >= len(s):
                raise XsvError('Unclosed quote, missing closing ".')
            if s[pos] == '"':
                pos += 1
                if pos < len(s) and s[pos] == '"':
                    # This mirrors xsv 0.13's unusual preservation of doubled quotes.
                    chars.extend(['"', '"'])
                    pos += 1
                    continue
                break
            chars.append(s[pos])
            pos += 1
        name = "".join(chars)
    else:
        start = pos
        while pos < len(s) and s[pos] not in ",-[":
            pos += 1
        name = s[start:pos]
    if pos < len(s) and s[pos] == "[":
        end = s.find("]", pos + 1)
        if end < 0:
            raise XsvError("Unclosed index bracket, missing closing ].")
        raw = s[pos + 1:end]
        if not raw.isdigit():
            raise XsvError(f"Could not convert '{raw}' to an integer: invalid digit found in string")
        return ("name", name, int(raw)), end + 1
    if re.fullmatch(r"[0-9]+", name):
        return ("index", int(name)), pos
    return ("name", name, 0), pos


def parse_selection(spec: str, first: list[bytes], use_names: bool) -> list[int]:
    invert = spec.startswith("!")
    if invert:
        spec = spec[1:]
    selectors: list[tuple] = []
    pos = 0
    while pos < len(spec):
        if spec[pos] == "-":
            left = ("start",)
        else:
            left, pos = selector_token(spec, pos)
        if pos < len(spec) and spec[pos] == "-":
            pos += 1
            if pos >= len(spec) or spec[pos] == ",":
                right = ("end",)
            else:
                right, pos = selector_token(spec, pos)
            selectors.append(("range", left, right))
        else:
            selectors.append(("one", left))
        if pos < len(spec) and spec[pos] != ",":
            raise XsvError(f"Expected end of field but got '{spec[pos]}' instead.")
        if pos < len(spec):
            pos += 1
    if not selectors:
        return [] if invert else list(range(len(first)))

    def resolve(tok: tuple) -> int:
        if tok[0] == "start":
            return 0
        if tok[0] == "end":
            return max(0, len(first) - 1)
        if tok[0] == "index":
            n = tok[1]
            if n < 1 or n > len(first):
                raise XsvError(f"Selector index {n} is out of bounds. Index must be >= 1 and <= {len(first)}.")
            return n - 1
        _, name, occurrence = tok
        if not use_names:
            raise XsvError(f"Cannot use names ('{name}') in selection with --no-headers set.")
        target = name.encode("utf-8", "surrogateescape")
        matches = [i for i, field in enumerate(first) if field == target]
        if not matches:
            raise XsvError(f"Selector name '{name}' does not exist as a named header in the given CSV data.")
        if occurrence >= len(matches):
            raise XsvError(
                f"Selector index '{occurrence}' for name '{name}' is out of bounds. "
                f"Must be >= 0 and <= {len(matches) - 1}."
            )
        return matches[occurrence]

    result: list[int] = []
    for selector in selectors:
        if selector[0] == "one":
            result.append(resolve(selector[1]))
        else:
            a, b = resolve(selector[1]), resolve(selector[2])
            if a <= b:
                result.extend(range(a, b + 1))
            else:
                result.extend(range(a, b - 1, -1))
    if invert:
        excluded = set(result)
        return [i for i in range(len(first)) if i not in excluded]
    return result


def command_headers(argv: list[str]) -> None:
    b = {"-j": "just", "--just-names": "just", "--intersect": "intersect"}
    v = {"-d": "delimiter", "--delimiter": "delimiter"}
    opts, paths = parse_options(argv, b, v)
    if not paths:
        paths = ["-"]
    if sum(p == "-" for p in paths) > 1:
        raise XsvError("At most one <stdin> input is allowed.")
    headers: list[bytes] = []
    for path in paths:
        delim = parse_delimiter(opts["delimiter"]) if opts["delimiter"] is not None else infer_delimiter(path)
        rows = parse_csv(read_input(path), delim, validate_lengths=False)
        head = rows[0] if rows else []
        for field in head:
            if not opts["intersect"] or field not in headers:
                headers.append(field)
    just = bool(opts["just"]) or len(paths) != 1
    if just:
        data = b"".join(h + b"\n" for h in headers)
    else:
        cells = [[str(i + 1).encode(), h] for i, h in enumerate(headers)]
        data = align_table(cells, 2, 2)
    write_output(None, data)


def command_count(argv: list[str]) -> None:
    opts, pos = parse_options(argv, COMMON_BOOL, {"-d": "delimiter", "--delimiter": "delimiter"})
    path = one_input(pos)
    _, rows, _ = read_rows(path, opts["delimiter"], bool(opts["no_headers"]))
    sys.stdout.buffer.write(str(len(rows)).encode() + b"\n")


def command_select(argv: list[str]) -> None:
    opts, pos = parse_options(argv, COMMON_BOOL, COMMON_VAL)
    if not pos or len(pos) > 2:
        raise UsageError("Invalid arguments.")
    spec, path = pos[0], one_input(pos, 1)
    first, rows, _ = read_rows(path, opts["delimiter"], bool(opts["no_headers"]))
    use_names = not toggled_no_headers(bool(opts["no_headers"]))
    sel = parse_selection(spec, first, use_names)
    output_rows: list[list[bytes]] = []
    if use_names:
        output_rows.append([first[i] for i in sel])
    output_rows.extend([[row[i] for i in sel] for row in rows])
    write_output(opts["output"], encode_csv(output_rows, out_delimiter(opts["output"])))


def parse_usize(value: object, name: str) -> int | None:
    if value is None:
        return None
    s = str(value)
    if not re.fullmatch(r"[0-9]+", s):
        raise XsvError(f"Could not deserialize '{s}' to u64 for '{name}'.")
    return int(s)


def command_slice(argv: list[str]) -> None:
    values = {**COMMON_VAL, "-s": "start", "--start": "start", "-e": "end", "--end": "end",
              "-l": "len", "--len": "len", "-i": "index", "--index": "index"}
    opts, pos = parse_options(argv, COMMON_BOOL, values)
    path = one_input(pos)
    start = parse_usize(opts["start"], "--start")
    end = parse_usize(opts["end"], "--end")
    length = parse_usize(opts["len"], "--len")
    index = parse_usize(opts["index"], "--index")
    if index is not None and any(x is not None for x in (start, end, length)):
        raise XsvError("--index cannot be used with --start, --end or --len")
    if end is not None and length is not None:
        raise XsvError("--end and --len cannot be used at the same time.")
    if index is not None:
        start, end = index, index + 1
    else:
        start = start or 0
        if end is not None and start > end:
            raise XsvError(f"The end of the range ({end}) must be greater than or\nequal to the start of the range ({start}).")
        if length is not None:
            end = start + length
    first, rows, _ = read_rows(path, opts["delimiter"], bool(opts["no_headers"]))
    use_headers = not toggled_no_headers(bool(opts["no_headers"]))
    chosen = rows[start:end]
    if use_headers and first:
        chosen = [first] + chosen
    write_output(opts["output"], encode_csv(chosen, out_delimiter(opts["output"])))


def command_search(argv: list[str]) -> None:
    bools = {**COMMON_BOOL, "-i": "ignore", "--ignore-case": "ignore",
             "-v": "invert", "--invert-match": "invert"}
    values = {**COMMON_VAL, "-s": "select", "--select": "select"}
    opts, pos = parse_options(argv, bools, values)
    if not pos or len(pos) > 2:
        raise UsageError("Invalid arguments.")
    pattern_text, path = pos[0], one_input(pos, 1)
    flags = re.IGNORECASE if opts["ignore"] else 0
    try:
        pattern = re.compile(pattern_text.encode("utf-8", "surrogateescape"), flags)
    except re.error as e:
        raise XsvError(f"regex parse error:\n    {pattern_text}\n    {e}")
    try:
        text_pattern = re.compile(pattern_text, flags)
    except re.error:
        text_pattern = None
    first, rows, _ = read_rows(path, opts["delimiter"], bool(opts["no_headers"]))
    use_headers = not toggled_no_headers(bool(opts["no_headers"]))
    sel = parse_selection(str(opts["select"] or ""), first, use_headers)
    output_rows = [first] if use_headers else []
    for row in rows:
        def field_matches(field: bytes) -> bool:
            if text_pattern is not None:
                try:
                    return text_pattern.search(field.decode("utf-8")) is not None
                except UnicodeDecodeError:
                    pass
            return pattern.search(field) is not None
        matched = any(field_matches(row[i]) for i in sel)
        if bool(opts["invert"]) != matched:
            output_rows.append(row)
    write_output(opts["output"], encode_csv(output_rows, out_delimiter(opts["output"])))


def parse_number(field: bytes) -> tuple[int, int | float] | None:
    try:
        s = field.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if re.fullmatch(r"[+-]?[0-9]+", s):
        try:
            n = int(s)
            if -(1 << 63) <= n <= (1 << 63) - 1:
                return (0, n)
        except ValueError:
            pass
    try:
        return (1, float(s))
    except ValueError:
        return None


def cmp_numeric(a: list[bytes], b: list[bytes], sel: list[int]) -> int:
    for i in sel:
        x, y = parse_number(a[i]), parse_number(b[i])
        if x is None and y is None:
            return 0
        if x is None:
            return -1
        if y is None:
            return 1
        xv, yv = x[1], y[1]
        if isinstance(xv, float) and math.isnan(xv) or isinstance(yv, float) and math.isnan(yv):
            c = 0
        else:
            c = (xv > yv) - (xv < yv)
        if c:
            return c
    return 0


def command_sort(argv: list[str]) -> None:
    bools = {**COMMON_BOOL, "-N": "numeric", "--numeric": "numeric",
             "-R": "reverse", "--reverse": "reverse"}
    values = {**COMMON_VAL, "-s": "select", "--select": "select"}
    opts, pos = parse_options(argv, bools, values)
    path = one_input(pos)
    first, rows, _ = read_rows(path, opts["delimiter"], bool(opts["no_headers"]))
    use_headers = not toggled_no_headers(bool(opts["no_headers"]))
    sel = parse_selection(str(opts["select"] or ""), first, use_headers)
    if opts["numeric"]:
        cmp = lambda a, b: cmp_numeric(a, b, sel)
    else:
        def cmp(a: list[bytes], b: list[bytes]) -> int:
            aa, bb = tuple(a[i] for i in sel), tuple(b[i] for i in sel)
            return (aa > bb) - (aa < bb)
    rows.sort(key=cmp_to_key(cmp), reverse=bool(opts["reverse"]))
    if use_headers and first:
        rows.insert(0, first)
    write_output(opts["output"], encode_csv(rows, out_delimiter(opts["output"])))


def condense(field: bytes, n: int | None) -> bytes:
    if n is None:
        return field
    try:
        s = field.decode("utf-8")
    except UnicodeDecodeError:
        return field if n >= len(field) else field[:n] + b"..."
    if n >= len(s):
        return field
    return (s[:n] + "...").encode("utf-8")


def align_table(rows: list[list[bytes]], minwidth: int, padding: int) -> bytes:
    if not rows:
        return b""
    ncols = max((len(r) for r in rows), default=0)
    def display_width(value: bytes) -> int:
        try:
            s = value.decode("utf-8")
        except UnicodeDecodeError:
            return len(value)
        return sum(0 if unicodedata.combining(c) else
                   2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in s)

    widths = []
    for c in range(ncols):
        width = max((display_width(r[c]) for r in rows if c < len(r)), default=0)
        widths.append(max(minwidth, width))
    out = bytearray()
    for row in rows:
        for c, field in enumerate(row):
            out.extend(field)
            if c + 1 < len(row):
                out.extend(b" " * (widths[c] - display_width(field) + padding))
        out.extend(b"\n")
    return bytes(out)


def command_table(argv: list[str]) -> None:
    values = {**COMMON_VAL, "-w": "width", "--width": "width", "-p": "pad", "--pad": "pad",
              "-c": "condense", "--condense": "condense"}
    opts, pos = parse_options(argv, {}, values)
    path = one_input(pos)
    width = parse_usize(opts["width"], "--width")
    pad = parse_usize(opts["pad"], "--pad")
    limit = parse_usize(opts["condense"], "--condense")
    delim = parse_delimiter(opts["delimiter"]) if opts["delimiter"] is not None else infer_delimiter(path)
    rows = parse_csv(read_input(path), delim)
    rows = [[quote_field(condense(f, limit), 9) for f in r] for r in rows]
    # TabWriter sees every tab in the serialized CSV stream, including tabs
    # inside quoted fields.
    rows = [b"\t".join(r).split(b"\t") for r in rows]
    write_output(opts["output"], align_table(rows, 2 if width is None else width, 2 if pad is None else pad))


def command_fmt(argv: list[str]) -> None:
    bools = {"--crlf": "crlf", "--ascii": "ascii", "--quote-always": "always"}
    values = {**COMMON_VAL, "-t": "out_delimiter", "--out-delimiter": "out_delimiter",
              "--quote": "quote", "--escape": "escape"}
    opts, pos = parse_options(argv, bools, values)
    path = one_input(pos)
    delim = parse_delimiter(opts["delimiter"]) if opts["delimiter"] is not None else infer_delimiter(path)
    rows = parse_csv(read_input(path), delim)
    odelim = out_delimiter(opts["output"], opts["out_delimiter"])
    term = b"\r\n" if opts["crlf"] else b"\n"
    if opts["ascii"]:
        odelim, term = 31, b"\x1e"
    quote = parse_delimiter(opts["quote"] if opts["quote"] is not None else '"')
    escape = parse_delimiter(opts["escape"]) if opts["escape"] is not None else None
    write_output(opts["output"], encode_csv(rows, odelim, term, quote, bool(opts["always"]), escape))


def rust_float(value: float) -> str:
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "inf" if value > 0 else "-inf"
    if value == 0:
        return "0"
    s = repr(value)
    # The Rust toolchain used by xsv 0.13 rendered Display<f64> in fixed
    # notation, even for magnitudes where modern Python chooses exponent form.
    if "e" in s.lower():
        s = format(Decimal(s), "f")
    if s.endswith(".0"):
        s = s[:-2]
    return s


def classify(field: bytes) -> tuple[str, int | float | None]:
    if not field:
        return "NULL", None
    try:
        s = field.decode("utf-8")
    except UnicodeDecodeError:
        return "Unknown", None
    if re.fullmatch(r"[+-]?[0-9]+", s):
        n = int(s)
        if -(1 << 63) <= n <= (1 << 63) - 1:
            return "Integer", n
    try:
        return "Float", float(s)
    except ValueError:
        return "Unicode", None


def merge_type(old: str, new: str) -> str:
    if old == "NULL":
        return new
    if new == "NULL":
        return old
    if old == "Unknown" or new == "Unknown":
        return "Unknown"
    if old == "Unicode" or new == "Unicode":
        return "Unicode"
    if old == "Float" or new == "Float":
        return "Float"
    return "Integer"


def column_stats(values: list[bytes], include_nulls: bool,
                 want_median: bool, want_mode: bool, want_card: bool) -> list[str]:
    typ = "NULL"
    int_sum = 0
    float_sum: float | None = None
    strings: list[bytes] = []
    lengths: list[int] = []
    ints: list[int] = []
    floats: list[float] = []
    online: list[float] = []
    medians: list[float] = []
    counts: Counter[bytes] = Counter()
    for field in values:
        sample_type, number = classify(field)
        typ = merge_type(typ, sample_type)
        lengths.append(len(field))
        counts[field] += 1
        if field:
            strings.append(field)
        if typ == "Float" and field:
            n = float(field.decode("utf-8"))
            if float_sum is None:
                float_sum = float(int_sum) + n
            else:
                float_sum += n
        elif typ == "Integer" and field:
            n = int(field.decode("utf-8"))
            if float_sum is None:
                int_sum += n
            else:
                float_sum += float(n)
        if typ == "Float" and field:
            n = float(field.decode("utf-8"))
            floats.append(n)
        elif typ == "Integer" and field:
            n = int(field.decode("utf-8"))
            ints.append(n)
            floats.append(float(n))
        if typ in ("Integer", "Float"):
            if not field:
                if include_nulls:
                    online.append(0.0)
            else:
                n = float(field.decode("utf-8"))
                online.append(n)
                medians.append(n)
    if typ == "Integer":
        sum_s = str(int_sum)
        min_s, max_s = (str(min(ints)), str(max(ints))) if ints else ("", "")
    elif typ == "Float":
        sum_s = rust_float(float_sum or 0.0)
        min_s, max_s = (rust_float(min(floats)), rust_float(max(floats))) if floats else ("", "")
    elif typ in ("Unicode", "Unknown"):
        sum_s = ""
        if strings:
            min_s = min(strings).decode("utf-8", "replace")
            max_s = max(strings).decode("utf-8", "replace")
        else:
            min_s = max_s = ""
    else:
        sum_s = min_s = max_s = ""
    min_len, max_len = (str(min(lengths)), str(max(lengths))) if lengths else ("", "")
    if typ in ("Integer", "Float") and online:
        # streaming-stats uses Welford's online recurrence, whose last-bit
        # rounding is observably different from sum(xs) / len(xs).
        mean = 0.0
        squared = 0.0
        for count, x in enumerate(online, 1):
            delta = x - mean
            mean += delta / count
            squared += delta * (x - mean)
        variance = squared / len(online)
        mean_s, std_s = rust_float(mean), rust_float(math.sqrt(variance))
    else:
        mean_s = std_s = ""
    out = [typ, sum_s, min_s, max_s, min_len, max_len, mean_s, std_s]
    if want_median:
        out.append(rust_float(float(statistics.median(medians))) if medians else "")
    if want_mode:
        if counts:
            high = max(counts.values())
            winners = [v for v, n in counts.items() if n == high]
            out.append(winners[0].decode("utf-8", "replace") if high > 1 and len(winners) == 1 else "N/A")
        else:
            out.append("N/A")
    if want_card:
        out.append(str(len(counts)))
    return out


def command_stats(argv: list[str]) -> None:
    bools = {**COMMON_BOOL, "--everything": "everything", "--mode": "mode",
             "--cardinality": "cardinality", "--median": "median", "--nulls": "nulls"}
    values = {**COMMON_VAL, "-s": "select", "--select": "select", "-j": "jobs", "--jobs": "jobs"}
    opts, pos = parse_options(argv, bools, values)
    path = one_input(pos)
    if opts["jobs"] is not None:
        parse_usize(opts["jobs"], "--jobs")
    first, rows, _ = read_rows(path, opts["delimiter"], bool(opts["no_headers"]))
    use_headers = not toggled_no_headers(bool(opts["no_headers"]))
    sel = parse_selection(str(opts["select"] or ""), first, use_headers)
    everything = bool(opts["everything"])
    median = bool(opts["median"]) or everything
    mode = bool(opts["mode"]) or everything
    card = bool(opts["cardinality"]) or everything
    headers = [b"field", b"type", b"sum", b"min", b"max", b"min_length", b"max_length", b"mean", b"stddev"]
    if median:
        headers.append(b"median")
    if mode:
        headers.append(b"mode")
    if card:
        headers.append(b"cardinality")
    output_rows: list[list[bytes]] = [headers]
    for out_i, col in enumerate(sel):
        name = first[col] if use_headers else str(out_i).encode()
        vals = [r[col] for r in rows]
        fields = column_stats(vals, bool(opts["nulls"]), median, mode, card)
        output_rows.append([name] + [s.encode("utf-8") for s in fields])
    write_output(opts["output"], encode_csv(output_rows, out_delimiter(opts["output"])))


def trim_frequency(field: bytes) -> bytes:
    try:
        return field.decode("utf-8").strip().encode("utf-8")
    except UnicodeDecodeError:
        return field


def command_frequency(argv: list[str]) -> None:
    bools = {**COMMON_BOOL, "-a": "asc", "--asc": "asc", "--no-nulls": "no_nulls"}
    values = {**COMMON_VAL, "-s": "select", "--select": "select", "-l": "limit", "--limit": "limit",
              "-j": "jobs", "--jobs": "jobs"}
    opts, pos = parse_options(argv, bools, values)
    path = one_input(pos)
    limit = parse_usize(opts["limit"], "--limit")
    if limit is None:
        limit = 10
    if opts["jobs"] is not None:
        parse_usize(opts["jobs"], "--jobs")
    first, rows, _ = read_rows(path, opts["delimiter"], bool(opts["no_headers"]))
    use_headers = not toggled_no_headers(bool(opts["no_headers"]))
    sel = parse_selection(str(opts["select"] or ""), first, use_headers)
    normal = sorted(set(sel))
    tables: list[Counter[bytes]] = []
    for col in normal:
        counter: Counter[bytes] = Counter()
        for row in rows:
            value = trim_frequency(row[col])
            if value or not opts["no_nulls"]:
                counter[value] += 1
        tables.append(counter)
    output_rows: list[list[bytes]] = [[b"field", b"value", b"count"]]
    selected_headers = [first[i] for i in sel]
    for i, table in enumerate(tables):
        field = str(i + 1).encode() if not use_headers else selected_headers[i]
        items = list(table.items())
        if opts["asc"]:
            items.sort(key=lambda x: (x[1], x[0]))
        else:
            items.sort(key=lambda x: (-x[1], x[0]))
        if limit:
            items = items[:limit]
        for value, count in items:
            shown = b"(NULL)" if value == b"" else value
            output_rows.append([field, shown, str(count).encode()])
    write_output(opts["output"], encode_csv(output_rows, out_delimiter(opts["output"])))


COMMANDS = {
    "headers": command_headers,
    "count": command_count,
    "select": command_select,
    "slice": command_slice,
    "search": command_search,
    "sort": command_sort,
    "table": command_table,
    "fmt": command_fmt,
    "stats": command_stats,
    "frequency": command_frequency,
}

USAGE_SUMMARIES = {
    "headers": "Usage:\n    xsv headers [options] [<input>...]",
    "count": "Usage:\n    xsv count [options] [<input>]",
    "select": "Usage:\n    xsv select [options] [--] <selection> [<input>]\n    xsv select --help",
    "slice": "Usage:\n    xsv slice [options] [<input>]",
    "search": "Usage:\n    xsv search [options] <regex> [<input>]\n    xsv search --help",
    "sort": "Usage:\n    xsv sort [options] [<input>]",
    "table": "Usage:\n    xsv table [options] [<input>]",
    "fmt": "Usage:\n    xsv fmt [options] [<input>]",
    "stats": "Usage:\n    xsv stats [options] [<input>]",
    "frequency": "Usage:\n    xsv frequency [options] [<input>]",
}


def command_help(command: str) -> bytes:
    """Load the release's literal usage text when the bundled source is present."""
    source = Path(__file__).resolve().parent / "rust-reference" / "src" / "cmd" / f"{command}.rs"
    try:
        text = source.read_text(encoding="utf-8")
        match = re.search(r'static USAGE:.*?= "(.*?)";\s*\n', text, re.DOTALL)
        if match:
            raw = match.group(1)
            decoded = bytes(raw, "utf-8").decode("unicode_escape")
            return decoded.lstrip("\n").encode("utf-8")
    except (OSError, UnicodeError):
        pass
    return (USAGE_SUMMARIES[command] + "\n").encode()


COMMAND_LIST = """    cat         Concatenate by row or column
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
    table       Align CSV data into columns"""


def main(argv: list[str]) -> int:
    if len(argv) == 1:
        sys.stderr.buffer.write(("xsv is a suite of CSV command line utilities.\n\nPlease choose one of the following commands:\n" + COMMAND_LIST + "\n\n").encode())
        return 0
    if argv[1] == "--version":
        sys.stdout.buffer.write((VERSION + "\n").encode())
        return 0
    if argv[1] == "--list":
        sys.stdout.buffer.write(("Installed commands:\n" + COMMAND_LIST + "\n\n").encode())
        return 0
    if argv[1] in ("-h", "--help", "help"):
        lead = "\n" if argv[1] == "help" else ""
        tail = "\n" if argv[1] == "help" else ""
        msg = (lead + "Usage:\n    xsv <command> [<args>...]\n    xsv [options]\n\nOptions:\n"
               "    --list        List all commands available.\n"
               "    -h, --help    Display this message\n"
               "    <command> -h  Display the command help message\n"
               "    --version     Print version info and exit\n\nCommands:\n" + COMMAND_LIST + "\n" + tail)
        sys.stdout.buffer.write(msg.encode())
        return 0
    command = argv[1]
    if command not in COMMANDS:
        variants = '["Cat", "Count", "FixLengths", "Flatten", "Fmt", "Frequency", "Headers", "Help", "Index", "Input", "Join", "Partition", "Sample", "Search", "Select", "Slice", "Sort", "Split", "Stats", "Table"]'
        sys.stderr.buffer.write(f"Could not match '{command}' with any of the allowed variants: {variants}\n".encode())
        return 1
    if any(a in ("-h", "--help") for a in argv[2:]):
        sys.stdout.buffer.write(command_help(command))
        return 0
    try:
        COMMANDS[command](argv[2:])
        return 0
    except UsageError as e:
        msg = str(e) + "\n\n" + USAGE_SUMMARIES[command] + "\n"
        sys.stderr.buffer.write(msg.encode("utf-8", "surrogateescape"))
        return 1
    except XsvError as e:
        sys.stderr.buffer.write((str(e) + "\n").encode("utf-8", "surrogateescape"))
        return 1
    except BrokenPipeError:
        return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
