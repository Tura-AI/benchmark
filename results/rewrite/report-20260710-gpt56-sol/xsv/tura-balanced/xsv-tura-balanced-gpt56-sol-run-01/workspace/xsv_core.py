"""Shared byte-oriented machinery for the Python xsv compatibility port."""

from __future__ import annotations

from dataclasses import dataclass
import math
import os
from pathlib import Path
import re
import sys
from typing import BinaryIO, Iterable, Iterator, Sequence


class XsvError(Exception):
    """An xsv error whose message is written to stderr."""


class UsageError(XsvError):
    """A command-line error optionally followed by a short usage string."""

    def __init__(self, message: str, usage: str | None = None) -> None:
        super().__init__(message)
        self.usage = usage


def parse_delimiter(value: str) -> int:
    if value == r"\t":
        return 9
    encoded = value.encode("utf-8")
    if len(encoded) != 1:
        if len(value) == 1:
            raise XsvError(f"Could not convert '{value}' to ASCII delimiter.")
        raise XsvError(
            f"Could not convert '{value}' to a single ASCII character."
        )
    if encoded[0] > 127:
        raise XsvError(f"Could not convert '{value}' to ASCII delimiter.")
    return encoded[0]


def default_delimiter(path: str | None) -> int:
    return 9 if path not in (None, "-") and Path(path).suffix == ".tsv" else 44


def read_input(path: str | None) -> bytes:
    if path in (None, "-"):
        return sys.stdin.buffer.read()
    try:
        return Path(path).read_bytes()
    except OSError as error:
        raise XsvError(f"failed to open {path}: {error.strerror}") from None


def validate_index(path: str | None) -> None:
    """Apply xsv's passive stale-index check; valid indexes are optional."""
    if path in (None, "-"):
        return
    data_path = Path(path)
    index_path = Path(str(path) + ".idx")
    if not index_path.is_file():
        return
    try:
        if int(data_path.stat().st_mtime) > int(index_path.stat().st_mtime):
            raise XsvError(
                "The CSV file was modified after the index file. "
                "Please re-create the index."
            )
    except OSError as error:
        raise XsvError(str(error)) from None


def output_stream(path: str | None) -> tuple[BinaryIO, bool]:
    if path in (None, "-"):
        return sys.stdout.buffer, False
    try:
        return open(path, "wb"), True
    except OSError as error:
        raise XsvError(str(error)) from None


def _csv_error(record: int, expected: int, found: int) -> XsvError:
    return XsvError(
        "CSV error: record %d (line: %d, byte: 0): found record with %d fields, "
        "but the previous record has %d fields"
        % (record, record, found, expected)
    )


def parse_csv(data: bytes, delimiter: int = 44, flexible: bool = False) -> list[list[bytes]]:
    """Parse RFC 4180-style records while retaining arbitrary field bytes."""
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    records: list[list[bytes]] = []
    record: list[bytes] = []
    field = bytearray()
    quoted = False
    at_field_start = True
    i = 0
    while i < len(data):
        byte = data[i]
        if quoted:
            if byte == 34:
                if i + 1 < len(data) and data[i + 1] == 34:
                    field.append(34)
                    i += 2
                    continue
                quoted = False
                i += 1
                continue
            field.append(byte)
            i += 1
            continue

        if at_field_start and byte == 34:
            quoted = True
            at_field_start = False
            i += 1
            continue
        if byte == delimiter:
            record.append(bytes(field))
            field.clear()
            at_field_start = True
            i += 1
            continue
        if byte in (10, 13):
            if byte == 13 and i + 1 < len(data) and data[i + 1] == 10:
                i += 1
            record.append(bytes(field))
            field.clear()
            records.append(record)
            record = []
            at_field_start = True
            i += 1
            continue
        field.append(byte)
        at_field_start = False
        i += 1

    if quoted:
        # csv 1.x accepts EOF as the end of a quoted field.
        quoted = False
    if field or record or (data and data[-1] == delimiter):
        record.append(bytes(field))
        records.append(record)

    if not flexible and records:
        expected = len(records[0])
        for index, row in enumerate(records[1:], 2):
            if len(row) != expected:
                raise _csv_error(index, expected, len(row))
    return records


@dataclass
class Dataset:
    first: list[bytes]
    headers: list[bytes]
    rows: list[list[bytes]]
    no_headers: bool


def load_dataset(
    path: str | None,
    delimiter: int | None = None,
    no_headers: bool = False,
    flexible: bool = False,
) -> Dataset:
    if os.environ.get("XSV_TOGGLE_HEADERS", "0") == "1":
        no_headers = not no_headers
    delim = default_delimiter(path) if delimiter is None else delimiter
    records = parse_csv(read_input(path), delim, flexible)
    first = records[0] if records else []
    if no_headers:
        return Dataset(first, first, records, True)
    return Dataset(first, first, records[1:] if records else [], False)


def needs_quote(field: bytes, delimiter: int, quote: int) -> bool:
    return any(byte in (delimiter, quote, 10, 13) for byte in field)


def encode_field(
    field: bytes,
    delimiter: int = 44,
    quote: int = 34,
    always: bool = False,
    escape: int | None = None,
) -> bytes:
    if not always and not needs_quote(field, delimiter, quote):
        return field
    q = bytes((quote,))
    if escape is None:
        value = field.replace(q, q + q)
    else:
        value = field.replace(q, bytes((escape, quote)))
    return q + value + q


def encode_record(
    row: Iterable[bytes | str],
    delimiter: int = 44,
    terminator: bytes = b"\n",
    quote: int = 34,
    always: bool = False,
    escape: int | None = None,
) -> bytes:
    fields = [value.encode() if isinstance(value, str) else value for value in row]
    encoded = [encode_field(field, delimiter, quote, always, escape) for field in fields]
    return bytes((delimiter,)).join(encoded) + terminator


def write_rows(
    rows: Iterable[Iterable[bytes | str]],
    path: str | None = None,
    delimiter: int | None = None,
    terminator: bytes = b"\n",
    quote: int = 34,
    always: bool = False,
    escape: int | None = None,
) -> None:
    delim = default_delimiter(path) if delimiter is None else delimiter
    stream, close = output_stream(path)
    try:
        for row in rows:
            stream.write(encode_record(row, delim, terminator, quote, always, escape))
        stream.flush()
    finally:
        if close:
            stream.close()


@dataclass(frozen=True)
class OneSelector:
    kind: str
    value: int | str | None = None
    occurrence: int = 0


@dataclass(frozen=True)
class Selector:
    start: OneSelector
    end: OneSelector | None = None


class SelectorParser:
    def __init__(self, text: str) -> None:
        self.text = text
        self.pos = 0

    def current(self) -> str | None:
        return self.text[self.pos] if self.pos < len(self.text) else None

    def bump(self) -> None:
        if self.pos < len(self.text):
            self.pos += 1

    def at_selector_end(self) -> bool:
        return self.current() in (None, ",")

    def parse(self) -> list[Selector]:
        result: list[Selector] = []
        while self.current() is not None:
            first = OneSelector("start") if self.current() == "-" else self.parse_one()
            second = None
            if self.current() == "-":
                self.bump()
                second = OneSelector("end") if self.at_selector_end() else self.parse_one()
            if not self.at_selector_end():
                raise XsvError(
                    f"Expected end of field but got '{self.current()}' instead."
                )
            result.append(Selector(first, second))
            self.bump()
        return result

    def parse_one(self) -> OneSelector:
        name = self.parse_quoted() if self.current() == '"' else self.parse_name()
        if self.current() == "[":
            occurrence = self.parse_index()
            return OneSelector("name", name, occurrence)
        if re.fullmatch(r"[0-9]+", name):
            return OneSelector("index", int(name))
        return OneSelector("name", name, 0)

    def parse_name(self) -> str:
        start = self.pos
        while self.current() not in (None, ",", "-", "["):
            self.bump()
        return self.text[start:self.pos]

    def parse_quoted(self) -> str:
        self.bump()
        name: list[str] = []
        while True:
            char = self.current()
            if char is None:
                raise XsvError('Unclosed quote, missing closing ".')
            if char == '"':
                self.bump()
                if self.current() == '"':
                    self.bump()
                    name.extend(['"', '"'])
                    continue
                return "".join(name)
            name.append(char)
            self.bump()

    def parse_index(self) -> int:
        self.bump()
        start = self.pos
        while self.current() not in (None, "]"):
            self.bump()
        if self.current() is None:
            raise XsvError("Unclosed index bracket, missing closing ].")
        value = self.text[start:self.pos]
        self.bump()
        try:
            return int(value)
        except ValueError:
            detail = "cannot parse integer from empty string" if not value else "invalid digit found in string"
            raise XsvError(f"Could not convert '{value}' to an integer: {detail}") from None


def _one_index(selector: OneSelector, first: Sequence[bytes], use_names: bool) -> int:
    if selector.kind == "start":
        return 0
    if selector.kind == "end":
        return max(0, len(first) - 1)
    if selector.kind == "index":
        value = int(selector.value)
        if value < 1 or value > len(first):
            raise XsvError(
                f"Selector index {value} is out of bounds. Index must be >= 1 "
                f"and <= {len(first)}."
            )
        return value - 1
    name = str(selector.value)
    if not use_names:
        raise XsvError(
            f"Cannot use names ('{name}') in selection with --no-headers set."
        )
    encoded = name.encode("utf-8")
    matches = [index for index, field in enumerate(first) if field == encoded]
    if not matches:
        raise XsvError(
            f"Selector name '{name}' does not exist as a named header in the "
            "given CSV data."
        )
    if selector.occurrence >= len(matches):
        raise XsvError(
            f"Selector index '{selector.occurrence}' for name '{name}' is out "
            f"of bounds. Must be >= 0 and <= {len(matches) - 1}."
        )
    return matches[selector.occurrence]


def select_columns(text: str | None, first: Sequence[bytes], use_names: bool) -> list[int]:
    text = "" if text is None else text
    invert = text.startswith("!")
    if invert:
        text = text[1:]
    selectors = SelectorParser(text).parse()
    if not selectors:
        selected = [] if invert else list(range(len(first)))
    else:
        selected: list[int] = []
        for selector in selectors:
            start = _one_index(selector.start, first, use_names)
            if selector.end is None:
                selected.append(start)
                continue
            end = _one_index(selector.end, first, use_names)
            step = 1 if start <= end else -1
            selected.extend(range(start, end + step, step))
        if invert:
            omitted = set(selected)
            selected = [index for index in range(len(first)) if index not in omitted]
    return selected


INT_RE = re.compile(rb"[+-]?[0-9]+\Z")


def parse_i64(value: bytes) -> int | None:
    if not INT_RE.fullmatch(value):
        return None
    number = int(value)
    return number if -(1 << 63) <= number < (1 << 63) else None


def parse_f64(value: bytes) -> float | None:
    try:
        text = value.decode("utf-8")
        if not text or text.strip() != text:
            return None
        return float(text)
    except (UnicodeDecodeError, ValueError, OverflowError):
        return None


def rust_float(value: float) -> str:
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "-inf" if value < 0 else "inf"
    if value == 0:
        return "0"
    if value.is_integer() and abs(value) < 1e16:
        return str(int(value))
    return repr(value)


def trim_unicode(value: bytes) -> bytes:
    try:
        return value.decode("utf-8").strip().encode("utf-8")
    except UnicodeDecodeError:
        return value
