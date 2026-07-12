#!/usr/bin/env python3
"""Standard-library functional port of zip-password-finder 0.11.1."""

from __future__ import annotations

import hashlib
import hmac
import itertools
import struct
import sys
import time
import zipfile
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(newline="\n")
    sys.stderr.reconfigure(newline="\n")

NAME = "zip-password-finder"
VERSION = "0.11.1"
LOWER = "abcdefghijklmnopqrstuvwxyz"
UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
DIGITS = "0123456789"
SYMBOLS = " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
PRESETS = {"l": LOWER, "u": UPPER, "d": DIGITS, "s": SYMBOLS,
           "h": DIGITS + "abcdef", "H": DIGITS + "ABCDEF"}

SHORT_HELP = """Find the password of protected ZIP files

Usage: zip-password-finder.exe [OPTIONS] --inputFile <inputFile>

Options:
  -i, --inputFile <inputFile>
          path to zip input file
  -w, --workers <workers>
          number of workers
  -p, --passwordDictionary <passwordDictionary>
          path to a password dictionary file
  -c, --charset <charset>
          charset to use to generate password [default: lud]
      --charsetFile <charsetFile>
          path to a charset file
      --minPasswordLen <minPasswordLen>
          minimum password length [default: 1]
      --maxPasswordLen <maxPasswordLen>
          maximum password length [default: 10]
      --fileNumber <fileNumber>
          file number in the zip archive [default: 0]
  -s, --startingPassword <startingPassword>
          password to start from
  -m, --mask <mask>
          mask pattern for mask attack (e.g. '?l?l?l?d?d')
  -1, --customCharset1 <customCharset1>
          custom charset 1 for mask attack, referenced as ?1 (e.g. 'aeiou' or '?l?d')
  -2, --customCharset2 <customCharset2>
          custom charset 2 for mask attack, referenced as ?2
  -3, --customCharset3 <customCharset3>
          custom charset 3 for mask attack, referenced as ?3
  -4, --customCharset4 <customCharset4>
          custom charset 4 for mask attack, referenced as ?4
  -h, --help
          Print help (see more with '--help')
  -V, --version
          Print version
"""

LONG_HELP = SHORT_HELP
for option_heading in (
    "  -w, --workers", "  -p, --passwordDictionary", "  -c, --charset",
    "      --charsetFile", "      --minPasswordLen", "      --maxPasswordLen",
    "      --fileNumber", "  -s, --startingPassword", "  -m, --mask",
    "  -1, --customCharset1", "  -2, --customCharset2", "  -3, --customCharset3",
    "  -4, --customCharset4", "  -h, --help", "  -V, --version",
):
    LONG_HELP = LONG_HELP.replace("\n" + option_heading, "\n\n" + option_heading)
LONG_HELP = LONG_HELP.replace(
    "          charset to use to generate password [default: lud]",
    "          charset to use to generate password\n          \n          [default: lud]",
).replace(
    "          minimum password length [default: 1]",
    "          minimum password length\n          \n          [default: 1]",
).replace(
    "          maximum password length [default: 10]",
    "          maximum password length\n          \n          [default: 10]",
).replace(
    "          file number in the zip archive [default: 0]",
    "          file number in the zip archive\n          \n          [default: 0]",
).replace(
    "          mask pattern for mask attack (e.g. '?l?l?l?d?d')",
    """          mask pattern for mask attack (e.g. '?l?l?l?d?d' for 3 lowercase + 2 digits).
          
          Available tokens:
            ?l  lowercase letters [a-z]
            ?u  uppercase letters [A-Z]
            ?d  digits [0-9]
            ?s  symbols
            ?a  all printable (?l?u?d?s)
            ?h  lowercase hex [0-9a-f]
            ?H  uppercase hex [0-9A-F]
            ?1  custom charset 1 (--customCharset1)
            ?2  custom charset 2 (--customCharset2)
            ?3  custom charset 3 (--customCharset3)
            ?4  custom charset 4 (--customCharset4)
            ??  literal '?'
          
          Any other character is treated as a literal.""",
).replace("Print help (see more with '--help')", "Print help (see a summary with '-h')")


class AppError(Exception):
    pass


class ParseError(Exception):
    pass


@dataclass
class Args:
    input_file: str
    workers: int | None = None
    dictionary: str | None = None
    charset: str = "lud"
    charset_file: str | None = None
    minimum: int = 1
    maximum: int = 10
    file_number: int = 0
    starting: str | None = None
    mask: str | None = None
    custom: tuple[list[str] | None, ...] = (None, None, None, None)


OPTIONS = {
    "-i": "input_file", "--inputFile": "input_file",
    "-w": "workers", "--workers": "workers",
    "-p": "dictionary", "--passwordDictionary": "dictionary",
    "-c": "charset", "--charset": "charset",
    "--charsetFile": "charset_file", "--minPasswordLen": "minimum",
    "--maxPasswordLen": "maximum", "--fileNumber": "file_number",
    "-s": "starting", "--startingPassword": "starting",
    "-m": "mask", "--mask": "mask",
    "-1": "custom1", "--customCharset1": "custom1",
    "-2": "custom2", "--customCharset2": "custom2",
    "-3": "custom3", "--customCharset3": "custom3",
    "-4": "custom4", "--customCharset4": "custom4",
}
DISPLAY = {"workers": "--workers <workers>", "minimum": "--minPasswordLen <minPasswordLen>",
           "maximum": "--maxPasswordLen <maxPasswordLen>", "file_number": "--fileNumber <fileNumber>"}


def app_error(message: str) -> AppError:
    return AppError(f'CLI argument error - "{message}"')


def parse_usize(value: str, field: str) -> int:
    if not value or not value.isascii() or not value.isdigit():
        reason = "invalid digit found in string"
        if value.startswith("-") and value[1:].isdigit():
            reason = "invalid digit found in string"
        raise ParseError(f"error: invalid value '{value}' for '{DISPLAY[field]}': {reason}\n\nFor more information, try '--help'.")
    number = int(value)
    if number > (1 << (64 if sys.maxsize > 2**32 else 32)) - 1:
        raise ParseError(f"error: invalid value '{value}' for '{DISPLAY[field]}': number too large to fit in target type\n\nFor more information, try '--help'.")
    return number


def parse_custom(definition: str) -> list[str]:
    result: list[str] = []
    i = 0
    while i < len(definition):
        char = definition[i]
        if char != "?":
            result.append(char); i += 1; continue
        if i + 1 == len(definition):
            raise app_error("Custom charset definition ends with incomplete token '?'")
        token = definition[i + 1]; i += 2
        if token == "?": result.append("?")
        elif token in PRESETS: result.extend(PRESETS[token])
        else: raise app_error(f"Unknown token '?{token}' in custom charset definition")
    if not result:
        raise app_error("Custom charset definition is empty")
    return list(dict.fromkeys(result))


def parse_args(argv: list[str]) -> Args | int:
    if "-V" in argv or "--version" in argv:
        print(f"{NAME} {VERSION}"); return 0
    if "--help" in argv:
        print(LONG_HELP, end=""); return 0
    if "-h" in argv:
        print(SHORT_HELP, end=""); return 0
    values: dict[str, str] = {}
    i = 0
    while i < len(argv):
        raw = argv[i]
        key, equals, attached = raw.partition("=")
        if key not in OPTIONS:
            raise ParseError(f"error: unexpected argument '{raw}' found\n\nUsage: zip-password-finder.exe [OPTIONS] --inputFile <inputFile>\n\nFor more information, try '--help'.")
        field = OPTIONS[key]
        if equals:
            value = attached
        else:
            i += 1
            if i >= len(argv) or argv[i] in OPTIONS:
                label = key if key.startswith("--") else next(k for k, v in OPTIONS.items() if v == field and k.startswith("--"))
                raise ParseError(f"error: a value is required for '{label} <{label[2:]}>' but none was supplied\n\nFor more information, try '--help'.")
            value = argv[i]
        if field in values:
            label = key if key.startswith("--") else next(k for k, v in OPTIONS.items() if v == field and k.startswith("--"))
            raise ParseError(f"error: the argument '{label} <{label[2:]}>' cannot be used multiple times\n\nUsage: zip-password-finder.exe [OPTIONS] --inputFile <inputFile>\n\nFor more information, try '--help'.")
        values[field] = value; i += 1
    if "input_file" not in values:
        raise ParseError("error: the following required arguments were not provided:\n  --inputFile <inputFile>\n\nUsage: zip-password-finder.exe --inputFile <inputFile>\n\nFor more information, try '--help'.")
    for field in ("workers", "minimum", "maximum", "file_number"):
        if field in values: values[field] = parse_usize(values[field], field)  # type: ignore[assignment]
    custom_defs = [values.pop(f"custom{i}", None) for i in range(1, 5)]
    args = Args(**values)  # type: ignore[arg-type]
    if not Path(args.input_file).is_file(): raise app_error("'inputFile' does not exist")
    if args.dictionary and not Path(args.dictionary).is_file(): raise app_error("'passwordDictionary' does not exist")
    if args.charset_file and not Path(args.charset_file).is_file(): raise app_error("'charsetFile' does not exist")
    if args.workers == 0: raise app_error("'workers' must be positive")
    if args.minimum == 0: raise app_error("'minPasswordLen' must be positive")
    if args.maximum == 0: raise app_error("'maxPasswordLen' must be positive")
    if args.minimum > args.maximum: raise app_error("'maxPasswordLen' must be equal or greater than 'minPasswordLen'")
    custom: list[list[str] | None] = [None] * 4
    for index, definition in enumerate(custom_defs):
        if definition is not None:
            if args.mask is None: raise app_error(f"'--customCharset{index + 1}' can only be used with --mask")
            custom[index] = parse_custom(definition)
    args.custom = tuple(custom)
    if args.mask is not None and args.dictionary is not None: raise app_error("'mask' cannot be used with a dictionary file")
    if args.starting is not None:
        if args.dictionary is not None: raise app_error("'startingPassword' cannot be used with a dictionary file")
        if args.mask is not None: raise app_error("'startingPassword' cannot be used with mask attack")
        chars = make_charset(args)
        if any(char not in chars for char in args.starting): raise app_error("'startingPassword' uses characters out of the generation charset")
        if not args.minimum <= len(args.starting) <= args.maximum:
            raise app_error("'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration")
    return args


def make_charset(args: Args) -> list[str]:
    if args.charset_file:
        try: text = Path(args.charset_file).read_text(encoding="utf-8")
        except OSError as exc: raise AppError(f"standard I/O error - {exc.strerror} (os error {exc.errno})") from exc
        except UnicodeDecodeError as exc: raise AppError(f"standard I/O error - stream did not contain valid UTF-8") from exc
        return sorted(set(text))
    chars: list[str] = []
    for token in args.charset:
        if token not in PRESETS: raise app_error(f"Unknown charset option '{token}'")
        chars.extend(PRESETS[token])
    return sorted(set(chars))


def parse_mask(pattern: str, custom: tuple[list[str] | None, ...]) -> list[list[str]]:
    positions: list[list[str]] = []
    i = 0
    while i < len(pattern):
        if pattern[i] != "?": positions.append([pattern[i]]); i += 1; continue
        if i + 1 == len(pattern): raise app_error("Mask ends with incomplete token '?'")
        token = pattern[i + 1]; i += 2
        if token == "?": positions.append(["?"])
        elif token in "1234":
            charset = custom[int(token) - 1]
            if charset is None: raise app_error(f"Custom charset ?{token} used in mask but --customCharset{token} not provided")
            positions.append(charset)
        elif token in PRESETS: positions.append(list(PRESETS[token]))
        elif token == "a": positions.append(list(LOWER + UPPER + DIGITS + SYMBOLS))
        else: raise app_error(f"Unknown mask token '?{token}'")
    if not positions: raise app_error("Mask pattern is empty")
    return positions


def candidates(args: Args) -> Iterator[bytes]:
    as_rust_bytes = lambda text: bytes(ord(char) & 0xFF for char in text)
    if args.dictionary:
        with open(args.dictionary, "rb") as source:
            for line in source:
                yield line[:-1].removesuffix(b"\r") if line.endswith(b"\n") else line
        return
    if args.mask is not None:
        positions = parse_mask(args.mask, args.custom)
        for item in itertools.product(*positions):
            yield as_rust_bytes("".join(item))
        return
    charset = make_charset(args)
    start = args.starting
    started = start is None
    for length in range(args.minimum, args.maximum + 1):
        for item in itertools.product(charset, repeat=length):
            word = "".join(item)
            if not started:
                if word != start: continue
                started = True
            yield as_rust_bytes(word)


def extra_fields(extra: bytes) -> Iterator[tuple[int, bytes]]:
    offset = 0
    while offset + 4 <= len(extra):
        kind, size = struct.unpack_from("<HH", extra, offset); offset += 4
        yield kind, extra[offset:offset + size]; offset += size


@dataclass
class ZipTarget:
    path: str
    info: zipfile.ZipInfo
    index: int
    aes_strength: int | None
    actual_method: int
    raw: bytes

    @classmethod
    def load(cls, path: str, requested: int) -> "ZipTarget":
        try:
            raw = Path(path).read_bytes()
            archive = zipfile.ZipFile(path)
            infos = archive.infolist()
        except (OSError, zipfile.BadZipFile) as exc:
            message = "invalid Zip archive: Could not find EOCD" if isinstance(exc, zipfile.BadZipFile) else str(exc)
            raise AppError(f"Invalid zip file error - {message}") from exc
        encrypted = [i for i, info in enumerate(infos) if info.flag_bits & 1]
        if requested < len(infos) and requested in encrypted:
            index = requested
        elif encrypted:
            index = encrypted[0]
            print(f"File at index {requested} is not encrypted, auto-selecting file at index {index} ({infos[index].filename})", file=sys.stderr)
        else:
            lines = [f"Archive contents ({len(infos)} files):"]
            for i, info in enumerate(infos[:20]):
                kind = "dir" if info.filename.endswith("/") else "file"
                enc = ", encrypted" if info.flag_bits & 1 else ""
                lines.append(f"  [{i}] {info.filename} ({kind}{enc})")
            if len(infos) > 20: lines.append(f"  ... and {len(infos) - 20} more files")
            raise AppError("Invalid zip file error - no encrypted file found in archive\n" + "\n".join(lines))
        info = infos[index]; strength = None; actual = info.compress_type
        for kind, data in extra_fields(info.extra):
            if kind == 0x9901 and len(data) >= 7:
                strength, actual = data[4], struct.unpack_from("<H", data, 5)[0]
        return cls(path, info, index, strength, actual, raw)

    def encrypted_payload(self) -> bytes:
        offset = self.info.header_offset
        if self.raw[offset:offset + 4] != b"PK\x03\x04": raise AppError("Invalid zip file error - invalid local file header")
        name_len, extra_len = struct.unpack_from("<HH", self.raw, offset + 26)
        start = offset + 30 + name_len + extra_len
        return self.raw[start:start + self.info.compress_size]

    def check(self, password: bytes) -> bool:
        if self.aes_strength is None:
            try:
                with zipfile.ZipFile(self.path).open(self.info, pwd=password) as member:
                    data = member.read()
                return len(data) == self.info.file_size
            except (RuntimeError, zipfile.BadZipFile, zlib.error, EOFError):
                return False
        key_len = {1: 16, 2: 24, 3: 32}[self.aes_strength]
        payload = self.encrypted_payload(); salt_len = key_len // 2
        if len(payload) < salt_len + 12: return False
        salt = payload[:salt_len]; verifier = payload[salt_len:salt_len + 2]
        derived = hashlib.pbkdf2_hmac("sha1", password, salt, 1000, 2 * key_len + 2)
        if not hmac.compare_digest(derived[-2:], verifier): return False
        encrypted = payload[salt_len + 2:-10]; auth = payload[-10:]
        if not hmac.compare_digest(hmac.new(derived[key_len:2 * key_len], encrypted, hashlib.sha1).digest()[:10], auth): return False
        plain = aes_ctr_decrypt(encrypted, derived[:key_len])
        try:
            if self.actual_method == 0: data = plain
            elif self.actual_method == 8: data = zlib.decompress(plain, -15)
            else: return False
        except zlib.error: return False
        return len(data) == self.info.file_size


# Compact AES encryption implementation used for WinZip AES CTR decryption.
def gf_multiply(left: int, right: int) -> int:
    result = 0
    for _ in range(8):
        if right & 1: result ^= left
        left = ((left << 1) ^ (0x11B if left & 0x80 else 0)) & 0xFF
        right >>= 1
    return result


def gf_power(value: int, exponent: int) -> int:
    result = 1
    while exponent:
        if exponent & 1: result = gf_multiply(result, value)
        value = gf_multiply(value, value); exponent >>= 1
    return result


def sbox_value(value: int) -> int:
    inverse = gf_power(value, 254) if value else 0
    rotate = lambda shift: ((inverse << shift) | (inverse >> (8 - shift))) & 0xFF
    return inverse ^ rotate(1) ^ rotate(2) ^ rotate(3) ^ rotate(4) ^ 0x63


SBOX = bytes(sbox_value(value) for value in range(256))
RCON = (0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54)


def aes_keys(key: bytes) -> tuple[list[list[int]], int]:
    nk, rounds = len(key) // 4, len(key) // 4 + 6
    words = [list(key[i:i + 4]) for i in range(0, len(key), 4)]
    while len(words) < 4 * (rounds + 1):
        temp = words[-1][:]; index = len(words)
        if index % nk == 0:
            temp = [SBOX[x] for x in temp[1:] + temp[:1]]; temp[0] ^= RCON[index // nk]
        elif nk > 6 and index % nk == 4: temp = [SBOX[x] for x in temp]
        words.append([a ^ b for a, b in zip(words[-nk], temp)])
    return words, rounds


def aes_block(block: bytes, key: bytes) -> bytes:
    words, rounds = aes_keys(key); state = list(block)
    def add(r: int) -> None:
        for column in range(4):
            for row in range(4): state[4 * column + row] ^= words[4 * r + column][row]
    add(0)
    for round_no in range(1, rounds + 1):
        state[:] = [SBOX[x] for x in state]
        state[:] = [state[0],state[5],state[10],state[15], state[4],state[9],state[14],state[3], state[8],state[13],state[2],state[7], state[12],state[1],state[6],state[11]]
        if round_no != rounds:
            for c in range(4):
                a = state[4*c:4*c+4]; x = a[0]^a[1]^a[2]^a[3]
                xt = lambda v: ((v << 1) ^ (0x11b if v & 0x80 else 0)) & 255
                state[4*c:4*c+4] = [a[0]^x^xt(a[0]^a[1]), a[1]^x^xt(a[1]^a[2]), a[2]^x^xt(a[2]^a[3]), a[3]^x^xt(a[3]^a[0])]
        add(round_no)
    return bytes(state)


def aes_ctr_decrypt(data: bytes, key: bytes) -> bytes:
    output = bytearray()
    for counter, offset in enumerate(range(0, len(data), 16), 1):
        stream = aes_block(struct.pack("<I", counter) + b"\0" * 12, key)
        output.extend(a ^ b for a, b in zip(data[offset:offset + 16], stream))
    return bytes(output)


def duration(start: int) -> str:
    ns = max(1, time.perf_counter_ns() - start)
    units = ((3_600_000_000_000, "h"), (60_000_000_000, "m"), (1_000_000_000, "s"), (1_000_000, "ms"), (1_000, "us"), (1, "ns"))
    parts = []
    for scale, suffix in units:
        value, ns = divmod(ns, scale)
        if value: parts.append(f"{value}{suffix}")
        if len(parts) == 3: break
    return " ".join(parts)


def run(argv: list[str]) -> int:
    try:
        parsed = parse_args(argv)
        if isinstance(parsed, int): return parsed
        start = time.perf_counter_ns()
        target = ZipTarget.load(parsed.input_file, parsed.file_number)
        found = None
        for candidate in candidates(parsed):
            if target.check(candidate):
                found = candidate.decode("utf-8", "replace"); break
        print(f"Time elapsed: {duration(start)}")
        print(f"Password found:{found}" if found is not None else "Password not found")
        return 0
    except ParseError as exc:
        print(exc, file=sys.stderr); return 2
    except AppError as exc:
        print(exc, file=sys.stderr); return 1


if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1:]))
