#!/usr/bin/env python3
"""Python port of zip-password-finder 0.11.1."""

from __future__ import annotations

import hashlib
import hmac
import itertools
import os
import struct
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterator

# Rust writes `\n` bytes unchanged on Windows.  Disable Python's platform
# newline translation so captured stdout/stderr are byte-for-byte compatible.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="strict", newline="\n")
    sys.stderr.reconfigure(encoding="utf-8", errors="strict", newline="\n")


PROGRAM = "zip-password-finder.exe"
VERSION = "0.11.1"

LOWER = list("abcdefghijklmnopqrstuvwxyz")
UPPER = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = list("0123456789")
SYMBOLS = list(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
LOWER_HEX = list("0123456789abcdef")
UPPER_HEX = list("0123456789ABCDEF")

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

LONG_HELP = """Find the password of protected ZIP files

Usage: zip-password-finder.exe [OPTIONS] --inputFile <inputFile>

Options:
  -i, --inputFile <inputFile>
          path to zip input file

  -w, --workers <workers>
          number of workers

  -p, --passwordDictionary <passwordDictionary>
          path to a password dictionary file

  -c, --charset <charset>
          charset to use to generate password
          
          [default: lud]

      --charsetFile <charsetFile>
          path to a charset file

      --minPasswordLen <minPasswordLen>
          minimum password length
          
          [default: 1]

      --maxPasswordLen <maxPasswordLen>
          maximum password length
          
          [default: 10]

      --fileNumber <fileNumber>
          file number in the zip archive
          
          [default: 0]

  -s, --startingPassword <startingPassword>
          password to start from

  -m, --mask <mask>
          mask pattern for mask attack (e.g. '?l?l?l?d?d' for 3 lowercase + 2 digits).
          
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
          
          Any other character is treated as a literal.

  -1, --customCharset1 <customCharset1>
          custom charset 1 for mask attack, referenced as ?1 (e.g. 'aeiou' or '?l?d')

  -2, --customCharset2 <customCharset2>
          custom charset 2 for mask attack, referenced as ?2

  -3, --customCharset3 <customCharset3>
          custom charset 3 for mask attack, referenced as ?3

  -4, --customCharset4 <customCharset4>
          custom charset 4 for mask attack, referenced as ?4

  -h, --help
          Print help (see a summary with '-h')

  -V, --version
          Print version
"""


class AppError(Exception):
    pass


class CliError(AppError):
    pass


class ClapError(Exception):
    def __init__(self, text: str):
        self.text = text


def rust_debug_string(value: str) -> str:
    escaped = []
    for ch in value:
        code = ord(ch)
        if ch == '"':
            escaped.append('\\"')
        elif ch == "\\":
            escaped.append("\\\\")
        elif ch == "\n":
            escaped.append("\\n")
        elif ch == "\r":
            escaped.append("\\r")
        elif ch == "\t":
            escaped.append("\\t")
        elif code < 32 or code == 127:
            escaped.append(f"\\u{{{code:x}}}")
        else:
            escaped.append(ch)
    return '"' + "".join(escaped) + '"'


def clap_usage(opts: list[str] | None = None) -> str:
    if opts:
        return f"Usage: {PROGRAM} " + " ".join(opts)
    return f"Usage: {PROGRAM} [OPTIONS] --inputFile <inputFile>"


def clap_fail(message: str, usage: list[str] | None = None, show_usage: bool = True) -> None:
    text = f"error: {message}\n"
    if show_usage:
        text += f"\n{clap_usage(usage)}\n"
    text += "\nFor more information, try '--help'.\n"
    raise ClapError(text)


@dataclass
class Arguments:
    input_file: str
    workers: int | None
    dictionary: str | None
    charset: str
    charset_file: str | None
    min_len: int
    max_len: int
    file_number: int
    starting: str | None
    mask: str | None
    custom_defs: list[str | None]


VALUE_OPTIONS = {
    "-i": ("input_file", "inputFile"), "--inputFile": ("input_file", "inputFile"),
    "-w": ("workers", "workers"), "--workers": ("workers", "workers"),
    "-p": ("dictionary", "passwordDictionary"), "--passwordDictionary": ("dictionary", "passwordDictionary"),
    "-c": ("charset", "charset"), "--charset": ("charset", "charset"),
    "--charsetFile": ("charset_file", "charsetFile"),
    "--minPasswordLen": ("min_len", "minPasswordLen"),
    "--maxPasswordLen": ("max_len", "maxPasswordLen"),
    "--fileNumber": ("file_number", "fileNumber"),
    "-s": ("starting", "startingPassword"), "--startingPassword": ("starting", "startingPassword"),
    "-m": ("mask", "mask"), "--mask": ("mask", "mask"),
    "-1": ("custom1", "customCharset1"), "--customCharset1": ("custom1", "customCharset1"),
    "-2": ("custom2", "customCharset2"), "--customCharset2": ("custom2", "customCharset2"),
    "-3": ("custom3", "customCharset3"), "--customCharset3": ("custom3", "customCharset3"),
    "-4": ("custom4", "customCharset4"), "--customCharset4": ("custom4", "customCharset4"),
}


def parse_usize(value: str, name: str) -> int:
    try:
        if not value or not value.isascii() or not value.isdigit():
            raise ValueError
        result = int(value)
        if result > 18_446_744_073_709_551_615:
            clap_fail(f"invalid value '{value}' for '--{name} <{name}>': number too large to fit in target type", show_usage=False)
        return result
    except ValueError:
        clap_fail(f"invalid value '{value}' for '--{name} <{name}>': invalid digit found in string", show_usage=False)
    raise AssertionError


def parse_args(argv: list[str]) -> Arguments:
    values: dict[str, str | None] = {
        "input_file": None, "workers": None, "dictionary": None,
        "charset": "lud", "charset_file": None, "min_len": "1",
        "max_len": "10", "file_number": "0", "starting": None,
        "mask": None, "custom1": None, "custom2": None,
        "custom3": None, "custom4": None,
    }
    seen: set[str] = set()
    used: list[str] = []
    i = 0
    while i < len(argv):
        token = argv[i]
        if token == "--help":
            sys.stdout.write(LONG_HELP)
            raise SystemExit(0)
        if token == "--version":
            print(f"zip-password-finder {VERSION}")
            raise SystemExit(0)
        if token.startswith("-") and not token.startswith("--") and len(token) > 1 and token[1] in "hV":
            if token[1] == "h":
                sys.stdout.write(SHORT_HELP)
            else:
                print(f"zip-password-finder {VERSION}")
            raise SystemExit(0)
        if token == "--":
            if i + 1 < len(argv):
                clap_fail(f"unexpected argument '{argv[i + 1]}' found")
            break
        option = token
        attached: str | None = None
        if token.startswith("--") and "=" in token:
            option, attached = token.split("=", 1)
        elif len(token) > 2 and token[:2] in VALUE_OPTIONS:
            option, attached = token[:2], token[2:]
            if attached.startswith("="):
                attached = attached[1:]
        if option not in VALUE_OPTIONS:
            usage: list[str] | None
            if not used:
                usage = None
            else:
                usage = used[:]
                if "input_file" not in seen:
                    usage.append("--inputFile <inputFile>")
            clap_fail(f"unexpected argument '{token}' found", usage)
        dest, display = VALUE_OPTIONS[option]
        canonical = f"--{display}"
        if dest in seen:
            clap_fail(f"the argument '{canonical} <{display}>' cannot be used multiple times", used + [f"{canonical} <{display}>"])
        if attached is None:
            if i + 1 >= len(argv) or argv[i + 1].startswith("-"):
                clap_fail(f"a value is required for '{canonical} <{display}>' but none was supplied", show_usage=False)
            i += 1
            attached = argv[i]
        values[dest] = attached
        seen.add(dest)
        used.append(f"{canonical} <{display}>")
        i += 1

    if values["input_file"] is None:
        clap_fail("the following required arguments were not provided:\n  --inputFile <inputFile>", ["--inputFile <inputFile>"])

    workers = parse_usize(values["workers"], "workers") if values["workers"] is not None else None  # type: ignore[arg-type]
    min_len = parse_usize(values["min_len"], "minPasswordLen")  # type: ignore[arg-type]
    max_len = parse_usize(values["max_len"], "maxPasswordLen")  # type: ignore[arg-type]
    file_number = parse_usize(values["file_number"], "fileNumber")  # type: ignore[arg-type]
    return Arguments(
        input_file=values["input_file"], workers=workers, dictionary=values["dictionary"],  # type: ignore[arg-type]
        charset=values["charset"], charset_file=values["charset_file"],  # type: ignore[arg-type]
        min_len=min_len, max_len=max_len, file_number=file_number,
        starting=values["starting"], mask=values["mask"],  # type: ignore[arg-type]
        custom_defs=[values[f"custom{i}"] for i in range(1, 5)],  # type: ignore[list-item]
    )


def builtin(token: str) -> list[str] | None:
    return {
        "l": LOWER, "u": UPPER, "d": DIGITS, "s": SYMBOLS,
        "a": LOWER + UPPER + DIGITS + SYMBOLS,
        "h": LOWER_HEX, "H": UPPER_HEX,
    }.get(token)


def parse_custom(definition: str) -> list[str]:
    result: list[str] = []
    i = 0
    while i < len(definition):
        char = definition[i]
        if char != "?":
            result.append(char)
            i += 1
            continue
        if i + 1 == len(definition):
            raise CliError("Custom charset definition ends with incomplete token '?'")
        token = definition[i + 1]
        if token == "?":
            result.append("?")
        else:
            chars = builtin(token)
            if chars is None:
                raise CliError(f"Unknown token '?{token}' in custom charset definition")
            result.extend(chars)
        i += 2
    if not result:
        raise CliError("Custom charset definition is empty")
    return list(dict.fromkeys(result))


def parse_mask(mask: str, custom: list[list[str] | None]) -> list[list[str]]:
    positions: list[list[str]] = []
    i = 0
    while i < len(mask):
        char = mask[i]
        if char != "?":
            positions.append([char])
            i += 1
            continue
        if i + 1 == len(mask):
            raise CliError("Mask ends with incomplete token '?'")
        token = mask[i + 1]
        if token == "?":
            positions.append(["?"])
        elif token in "1234":
            chars = custom[int(token) - 1]
            if chars is None:
                raise CliError(f"Custom charset ?{token} used in mask but --customCharset{token} not provided")
            positions.append(chars[:])
        else:
            chars = builtin(token)
            if chars is None:
                raise CliError(f"Unknown mask token '?{token}'")
            positions.append(chars[:])
        i += 2
    if not positions:
        raise CliError("Mask pattern is empty")
    return positions


def charset_from_preset(choice: str) -> list[str]:
    chars: list[str] = []
    for token in choice:
        resolved = builtin(token)
        if resolved is None or token == "a":
            raise CliError(f"Unknown charset option '{token}'")
        chars.extend(resolved)
    return chars


def load_charset(args: Arguments) -> list[str]:
    if args.charset_file is not None:
        try:
            text = Path(args.charset_file).read_text(encoding="utf-8")
        except UnicodeDecodeError:
            raise AppError("standard I/O error - stream did not contain valid UTF-8")
        except OSError as exc:
            raise AppError(f"standard I/O error - {exc.strerror or exc}")
        chars = list(text)
    else:
        chars = charset_from_preset(args.charset)
    return sorted(set(chars))


def validate_args(args: Arguments) -> tuple[list[list[str] | None], list[str] | None]:
    if not Path(args.input_file).is_file():
        raise CliError("'inputFile' does not exist")
    if args.dictionary is not None and not Path(args.dictionary).is_file():
        raise CliError("'passwordDictionary' does not exist")
    if args.charset_file is not None and not Path(args.charset_file).is_file():
        raise CliError("'charsetFile' does not exist")
    if args.workers == 0:
        raise CliError("'workers' must be positive")
    if args.min_len == 0:
        raise CliError("'minPasswordLen' must be positive")
    if args.max_len == 0:
        raise CliError("'maxPasswordLen' must be positive")
    if args.min_len > args.max_len:
        raise CliError("'maxPasswordLen' must be equal or greater than 'minPasswordLen'")

    custom: list[list[str] | None] = [None, None, None, None]
    for i, definition in enumerate(args.custom_defs):
        if definition is not None:
            if args.mask is None:
                raise CliError(f"'--customCharset{i + 1}' can only be used with --mask")
            custom[i] = parse_custom(definition)
    if args.mask is not None and args.dictionary is not None:
        raise CliError("'mask' cannot be used with a dictionary file")
    charset: list[str] | None = None
    if args.starting is not None:
        if args.dictionary is not None:
            raise CliError("'startingPassword' cannot be used with a dictionary file")
        if args.mask is not None:
            raise CliError("'startingPassword' cannot be used with mask attack")
        charset = load_charset(args)
        if any(c not in charset for c in args.starting):
            raise CliError("'startingPassword' uses characters out of the generation charset")
        if not (args.min_len <= len(args.starting) <= args.max_len):
            raise CliError("'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration")
    return custom, charset


def byte_for_char(char: str) -> int:
    return ord(char) & 0xFF


def generated_passwords(charset: list[str], min_len: int, max_len: int, starting: str | None) -> Iterator[bytes]:
    byteset = bytes(byte_for_char(c) for c in charset)
    base = len(byteset)
    total = sum(base ** length for length in range(min_len, max_len + 1))
    if starting is None:
        password = bytearray([byteset[0]] * min_len)
        total_to_generate = total
    else:
        password = bytearray(starting.encode("utf-8"))
        already = sum(base ** length for length in range(min_len, len(starting)))
        for power, char in enumerate(reversed(starting)):
            already += charset.index(char) * (base ** power)
        already += 1
        total_to_generate = total - already

    lookup = {value: index for index, value in enumerate(byteset)}
    generated = 0
    while len(password) <= max_len:
        if generated == 0:
            generated += 1
            yield bytes(password)
            continue
        if generated == total_to_generate:
            return
        carry = True
        for i in range(len(password) - 1, -1, -1):
            if not carry:
                break
            index = lookup.get(password[i], 0)
            if index < base - 1:
                password[i] = byteset[index + 1]
                carry = False
            else:
                password[i] = byteset[0]
        if carry:
            password = bytearray([byteset[0]] * (len(password) + 1))
        generated += 1
        yield bytes(password)


def dictionary_passwords(path: str) -> Iterator[bytes]:
    with open(path, "rb") as stream:
        for line in stream:
            if line.endswith(b"\n"):
                line = line[:-1]
                if line.endswith(b"\r"):
                    line = line[:-1]
            yield line


def mask_passwords(positions: list[list[str]]) -> Iterator[bytes]:
    byte_positions = [[byte_for_char(c) for c in chars] for chars in positions]
    for product in itertools.product(*byte_positions):
        yield bytes(product)


def safe_enclosed_name(name: str) -> bool:
    name = name.replace("\\", "/")
    path = PurePosixPath(name)
    return not path.is_absolute() and ".." not in path.parts and not (len(name) >= 2 and name[1] == ":")


def aes_details(info: zipfile.ZipInfo) -> tuple[int, int] | None:
    extra = info.extra
    pos = 0
    while pos + 4 <= len(extra):
        kind, size = struct.unpack_from("<HH", extra, pos)
        data = extra[pos + 4:pos + 4 + size]
        if kind == 0x9901 and len(data) >= 7:
            strength = data[4]
            return ({1: 16, 2: 24, 3: 32}.get(strength, 0), struct.unpack_from("<H", data, 5)[0])
        pos += 4 + size
    return None


@dataclass
class Target:
    archive: zipfile.ZipFile
    info: zipfile.ZipInfo
    index: int
    aes_key_len: int
    aes_salt: bytes = b""
    aes_verify: bytes = b""
    aes_ciphertext: bytes = b""
    aes_auth: bytes = b""


def validate_zip(path: str, requested_index: int) -> Target:
    try:
        archive = zipfile.ZipFile(path, "r")
        infos = archive.infolist()
    except (zipfile.BadZipFile, OSError):
        raise AppError("Invalid zip file error - invalid Zip archive: Could not find EOCD")

    def encrypted(index: int) -> bool:
        return 0 <= index < len(infos) and bool(infos[index].flag_bits & 1)

    if encrypted(requested_index):
        index = requested_index
    else:
        index = next((i for i in range(len(infos)) if encrypted(i)), -1)
        if index < 0:
            lines = [f"Archive contents ({len(infos)} files):"]
            for i, info in enumerate(infos[:20]):
                kind = "dir" if info.filename.endswith("/") else "file"
                enc = ", encrypted" if encrypted(i) else ""
                lines.append(f"  [{i}] {info.filename} ({kind}{enc})")
            if len(infos) > 20:
                lines.append(f"  ... and {len(infos) - 20} more files")
            raise AppError("Invalid zip file error - no encrypted file found in archive\n" + "\n".join(lines))
        print(f"File at index {requested_index} is not encrypted, auto-selecting file at index {index} ({infos[index].filename})", file=sys.stderr)

    info = infos[index]
    aes = aes_details(info)
    if aes is None:
        return Target(archive, info, index, 0)
    key_len, _actual_method = aes
    if key_len == 0:
        raise AppError("Invalid zip file error - unsupported AES encryption strength")
    salt_len = key_len // 2
    try:
        with open(path, "rb") as stream:
            stream.seek(info.header_offset)
            header = stream.read(30)
            if len(header) != 30 or header[:4] != b"PK\x03\x04":
                raise OSError
            name_len, extra_len = struct.unpack_from("<HH", header, 26)
            stream.seek(name_len + extra_len, os.SEEK_CUR)
            payload = stream.read(info.compress_size)
        if len(payload) < salt_len + 12:
            raise OSError
    except OSError:
        raise AppError("Invalid zip file error - invalid Zip archive: Invalid local file header")
    return Target(
        archive, info, index, key_len,
        payload[:salt_len], payload[salt_len:salt_len + 2],
        payload[salt_len + 2:-10], payload[-10:],
    )


def password_matches(target: Target, password: bytes) -> bool:
    if not safe_enclosed_name(target.info.filename):
        return False
    if target.aes_key_len:
        derived = hashlib.pbkdf2_hmac(
            "sha1", password, target.aes_salt, 1000,
            dklen=target.aes_key_len * 2 + 2,
        )
        if not hmac.compare_digest(derived[-2:], target.aes_verify):
            return False
        auth_key = derived[target.aes_key_len:target.aes_key_len * 2]
        expected = hmac.new(auth_key, target.aes_ciphertext, hashlib.sha1).digest()[:10]
        return hmac.compare_digest(expected, target.aes_auth)
    try:
        with target.archive.open(target.info, "r", pwd=password) as member:
            data = member.read()
        return len(data) == target.info.file_size
    except (RuntimeError, zipfile.BadZipFile, NotImplementedError, EOFError, OSError):
        return False


def format_duration(nanoseconds: int) -> str:
    units = [
        (86_400_000_000_000, "day"), (3_600_000_000_000, "h"),
        (60_000_000_000, "m"), (1_000_000_000, "s"),
        (1_000_000, "ms"), (1_000, "us"), (1, "ns"),
    ]
    parts: list[str] = []
    remaining = nanoseconds
    for size, label in units:
        value, remaining = divmod(remaining, size)
        if value:
            if label == "day":
                label = "day" if value == 1 else "days"
            parts.append(f"{value}{label}")
    return " ".join(parts) if parts else "0s"


def run(args: Arguments, custom: list[list[str] | None], preloaded_charset: list[str] | None) -> None:
    if args.dictionary is not None:
        candidates = dictionary_passwords(args.dictionary)
    elif args.mask is not None:
        candidates = mask_passwords(parse_mask(args.mask, custom))
    else:
        charset = preloaded_charset if preloaded_charset is not None else load_charset(args)
        candidates = generated_passwords(charset, args.min_len, args.max_len, args.starting)

    started = time.perf_counter_ns()
    target = validate_zip(args.input_file, args.file_number)
    found: bytes | None = None
    try:
        for candidate in candidates:
            if password_matches(target, candidate):
                found = candidate
                break
    finally:
        target.archive.close()
    elapsed = time.perf_counter_ns() - started
    print(f"Time elapsed: {format_duration(elapsed)}")
    if found is None:
        print("Password not found")
    else:
        password = found.decode("utf-8", errors="replace")
        print(f"Password found:{password}")


def main() -> int:
    try:
        args = parse_args(sys.argv[1:])
        custom, charset = validate_args(args)
        run(args, custom, charset)
        return 0
    except ClapError as exc:
        sys.stderr.write(exc.text)
        return 2
    except CliError as exc:
        print(f"CLI argument error - {rust_debug_string(str(exc))}", file=sys.stderr)
        return 1
    except AppError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except BrokenPipeError:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
