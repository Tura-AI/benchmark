#!/usr/bin/env python3
"""Standalone functional port of zip-password-finder 0.11.1."""

from __future__ import annotations

import binascii
import bz2
import hashlib
import hmac
import itertools
import lzma
import os
import struct
import sys
import time
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator

APP = "zip-password-finder.exe" if os.name == "nt" else "zip-password-finder"
VERSION = "0.11.1"
LOWER = "abcdefghijklmnopqrstuvwxyz"
UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
DIGITS = "0123456789"
SYMBOLS = " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
BUILTINS = {
    "l": LOWER,
    "u": UPPER,
    "d": DIGITS,
    "s": SYMBOLS,
    "a": LOWER + UPPER + DIGITS + SYMBOLS,
    "h": DIGITS + "abcdef",
    "H": DIGITS + "ABCDEF",
}

HELP = f"""Find the password of protected ZIP files

Usage: {APP} [OPTIONS] --inputFile <inputFile>

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


class CliExit(Exception):
    def __init__(self, status: int, text: str, stdout: bool = False):
        self.status, self.text, self.stdout = status, text, stdout


class FinderError(Exception):
    pass


def clap_error(message: str, usage: bool = False) -> CliExit:
    suffix = ""
    if usage:
        suffix = f"\nUsage: {APP} [OPTIONS] --inputFile <inputFile>\n"
    return CliExit(2, f"error: {message}\n{suffix}\nFor more information, try '--help'.\n")


OPTIONS = {
    "-i": ("inputFile", "inputFile"), "--inputFile": ("inputFile", "inputFile"),
    "-w": ("workers", "workers"), "--workers": ("workers", "workers"),
    "-p": ("passwordDictionary", "passwordDictionary"),
    "--passwordDictionary": ("passwordDictionary", "passwordDictionary"),
    "-c": ("charset", "charset"), "--charset": ("charset", "charset"),
    "--charsetFile": ("charsetFile", "charsetFile"),
    "--minPasswordLen": ("minPasswordLen", "minPasswordLen"),
    "--maxPasswordLen": ("maxPasswordLen", "maxPasswordLen"),
    "--fileNumber": ("fileNumber", "fileNumber"),
    "-s": ("startingPassword", "startingPassword"),
    "--startingPassword": ("startingPassword", "startingPassword"),
    "-m": ("mask", "mask"), "--mask": ("mask", "mask"),
    "-1": ("customCharset1", "customCharset1"), "--customCharset1": ("customCharset1", "customCharset1"),
    "-2": ("customCharset2", "customCharset2"), "--customCharset2": ("customCharset2", "customCharset2"),
    "-3": ("customCharset3", "customCharset3"), "--customCharset3": ("customCharset3", "customCharset3"),
    "-4": ("customCharset4", "customCharset4"), "--customCharset4": ("customCharset4", "customCharset4"),
}
NUMERIC = {"workers", "minPasswordLen", "maxPasswordLen", "fileNumber"}


def parse_usize(name: str, value: str) -> int:
    try:
        if not value or value.startswith(("-", "+")) or not value.isascii() or not value.isdigit():
            raise ValueError
        result = int(value)
        if result > (2 ** 64 - 1 if sys.maxsize > 2**32 else 2**32 - 1):
            raise OverflowError
        return result
    except OverflowError:
        raise clap_error(
            f"invalid value '{value}' for '--{name} <{name}>': number too large to fit in target type"
        )
    except ValueError:
        raise clap_error(
            f"invalid value '{value}' for '--{name} <{name}>': invalid digit found in string"
        )


def parse_args(argv: list[str]) -> dict[str, object]:
    if "--help" in argv or "-h" in argv:
        raise CliExit(0, HELP, True)
    if "--version" in argv or "-V" in argv:
        raise CliExit(0, f"zip-password-finder {VERSION}\n", True)
    values: dict[str, object] = {"charset": "lud", "minPasswordLen": 1,
                                 "maxPasswordLen": 10, "fileNumber": 0}
    seen: set[str] = set()
    i = 0
    while i < len(argv):
        raw = argv[i]
        if raw == "--":
            unexpected = argv[i + 1] if i + 1 < len(argv) else raw
            raise clap_error(f"unexpected argument '{unexpected}' found", True)
        token, attached = (raw.split("=", 1) + [None])[:2] if raw.startswith("--") and "=" in raw else (raw, None)
        if token not in OPTIONS and token.startswith("-") and not token.startswith("--") and len(token) > 2:
            short = token[:2]
            if short in OPTIONS:
                token, attached = short, token[2:]
        if token not in OPTIONS:
            raise clap_error(f"unexpected argument '{raw}' found", True)
        name, display = OPTIONS[token]
        if name in seen:
            raise clap_error(f"the argument '--{name} <{display}>' cannot be used multiple times", True)
        if attached is None:
            i += 1
            if i >= len(argv) or argv[i] in OPTIONS:
                raise clap_error(f"a value is required for '--{name} <{display}>' but none was supplied")
            attached = argv[i]
        values[name] = parse_usize(name, attached) if name in NUMERIC else attached
        seen.add(name)
        i += 1
    if "inputFile" not in values:
        raise CliExit(2, f"error: the following required arguments were not provided:\n  --inputFile <inputFile>\n\nUsage: {APP} --inputFile <inputFile>\n\nFor more information, try '--help'.\n")
    return values


def cli(message: str) -> FinderError:
    return FinderError(f'CLI argument error - "{message}"')


def unique(text: Iterable[str], sort: bool = False) -> str:
    result = "".join(dict.fromkeys(text))
    return "".join(sorted(result)) if sort else result


def preset_charset(value: str) -> str:
    chars = ""
    for symbol in value:
        if symbol not in {"l", "u", "d", "s", "h", "H"}:
            raise cli(f"Unknown charset option '{symbol}'")
        chars += BUILTINS[symbol]
    return unique(chars, True)


def custom_charset(value: str) -> str:
    out, i = "", 0
    while i < len(value):
        if value[i] != "?":
            out += value[i]; i += 1; continue
        if i + 1 == len(value):
            raise cli("Custom charset definition ends with incomplete token '?'")
        token = value[i + 1]; i += 2
        if token == "?": out += "?"
        elif token in BUILTINS: out += BUILTINS[token]
        else: raise cli(f"Unknown token '?{token}' in custom charset definition")
    if not out:
        raise cli("Custom charset definition is empty")
    return unique(out)


def parse_mask(value: str, custom: list[str | None]) -> list[bytes]:
    positions: list[bytes] = []
    i = 0
    while i < len(value):
        c = value[i]
        if c != "?":
            positions.append(c.encode("utf-8")); i += 1; continue
        if i + 1 == len(value):
            raise cli("Mask ends with incomplete token '?'")
        token = value[i + 1]; i += 2
        if token == "?": chars = "?"
        elif token in "1234":
            chars = custom[int(token) - 1]
            if chars is None:
                raise cli(f"Custom charset ?{token} used in mask but --customCharset{token} not provided")
        elif token in BUILTINS: chars = BUILTINS[token]
        else: raise cli(f"Unknown mask token '?{token}'")
        positions.append(chars.encode("utf-8"))
    if not positions:
        raise cli("Mask pattern is empty")
    return positions


def validate(values: dict[str, object]) -> tuple[dict[str, object], list[str | None]]:
    path = str(values["inputFile"])
    if not Path(path).is_file(): raise cli("'inputFile' does not exist")
    dictionary = values.get("passwordDictionary")
    if dictionary is not None and not Path(str(dictionary)).is_file():
        raise cli("'passwordDictionary' does not exist")
    charset_file = values.get("charsetFile")
    if charset_file is not None and not Path(str(charset_file)).is_file():
        raise cli("'charsetFile' does not exist")
    if values.get("workers") == 0: raise cli("'workers' must be positive")
    if values["minPasswordLen"] == 0: raise cli("'minPasswordLen' must be positive")
    if values["maxPasswordLen"] == 0: raise cli("'maxPasswordLen' must be positive")
    if int(values["minPasswordLen"]) > int(values["maxPasswordLen"]):
        raise cli("'maxPasswordLen' must be equal or greater than 'minPasswordLen'")
    mask = values.get("mask")
    custom: list[str | None] = [None] * 4
    for index in range(4):
        name = f"customCharset{index + 1}"
        if name in values:
            if mask is None: raise cli(f"'--{name}' can only be used with --mask")
            custom[index] = custom_charset(str(values[name]))
    if mask is not None and dictionary is not None:
        raise cli("'mask' cannot be used with a dictionary file")
    starting = values.get("startingPassword")
    if starting is not None:
        if dictionary is not None: raise cli("'startingPassword' cannot be used with a dictionary file")
        if mask is not None: raise cli("'startingPassword' cannot be used with mask attack")
        charset = load_charset(values)
        if any(c not in charset for c in str(starting)):
            raise cli("'startingPassword' uses characters out of the generation charset")
        if not int(values["minPasswordLen"]) <= len(str(starting)) <= int(values["maxPasswordLen"]):
            raise cli("'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration")
    return values, custom


def load_charset(values: dict[str, object]) -> str:
    if "charsetFile" in values:
        try: text = Path(str(values["charsetFile"])).read_text(encoding="utf-8")
        except OSError as error: raise FinderError(f"standard I/O error - {error}")
        return unique(text, True)
    return preset_charset(str(values["charset"]))


def brute_candidates(charset: str, minimum: int, maximum: int, starting: str | None) -> Iterator[bytes]:
    begin = starting.encode() if starting is not None else charset[0].encode() * minimum
    chars = charset.encode("ascii")
    current = bytearray(begin)
    lookup = {value: index for index, value in enumerate(chars)}
    while len(current) <= maximum:
        yield bytes(current)
        for index in range(len(current) - 1, -1, -1):
            position = lookup[current[index]]
            if position + 1 < len(chars):
                current[index] = chars[position + 1]
                break
            current[index] = chars[0]
        else:
            current = bytearray([chars[0]]) * (len(current) + 1)


def mask_candidates(positions: list[bytes]) -> Iterator[bytes]:
    yield from (bytes(candidate) for candidate in itertools.product(*positions))


@dataclass
class ZipMember:
    name: str
    flags: int
    method: int
    crc: int
    compressed_size: int
    size: int
    local_offset: int
    extra: bytes
    mod_time: int
    aes_strength: int = 0
    actual_method: int = 0
    data: bytes = b""


def parse_zip(path: str) -> list[ZipMember]:
    try: raw = Path(path).read_bytes()
    except OSError as error: raise FinderError(f"standard I/O error - {error}")
    eocd = raw.rfind(b"PK\x05\x06")
    if eocd < 0 or eocd + 22 > len(raw): raise FinderError("Invalid zip file error - invalid Zip archive: Could not find EOCD")
    count, offset = struct.unpack_from("<HI", raw, eocd + 10)[0], struct.unpack_from("<I", raw, eocd + 16)[0]
    members: list[ZipMember] = []
    cursor = offset
    try:
        for _ in range(count):
            if raw[cursor:cursor + 4] != b"PK\x01\x02": raise ValueError
            fields = struct.unpack_from("<6H3I5H2I", raw, cursor + 4)
            flags, method, mod_time = fields[2], fields[3], fields[4]
            crc, compressed, size = fields[6], fields[7], fields[8]
            name_len, extra_len, comment_len = fields[9], fields[10], fields[11]
            local_offset = fields[15]
            start = cursor + 46
            name_raw, extra = raw[start:start + name_len], raw[start + name_len:start + name_len + extra_len]
            encoding = "utf-8" if flags & 0x800 else "cp437"
            member = ZipMember(name_raw.decode(encoding, "replace"), flags, method, crc, compressed, size, local_offset, extra, mod_time)
            pos = 0
            while pos + 4 <= len(extra):
                kind, length = struct.unpack_from("<HH", extra, pos); payload = extra[pos + 4:pos + 4 + length]; pos += 4 + length
                if kind == 0x9901 and len(payload) >= 7:
                    member.aes_strength = payload[4]
                    member.actual_method = struct.unpack_from("<H", payload, 5)[0]
            if raw[local_offset:local_offset + 4] != b"PK\x03\x04": raise ValueError
            local_name, local_extra = struct.unpack_from("<HH", raw, local_offset + 26)
            data_at = local_offset + 30 + local_name + local_extra
            member.data = raw[data_at:data_at + compressed]
            members.append(member)
            cursor = start + name_len + extra_len + comment_len
    except (ValueError, struct.error, IndexError):
        raise FinderError("Invalid zip file error - invalid Zip archive: Invalid central directory")
    return members


def crc32_byte(crc: int, value: int) -> int:
    crc ^= value & 0xff
    for _ in range(8):
        crc = (crc >> 1) ^ (0xedb88320 if crc & 1 else 0)
    return crc & 0xffffffff


def zipcrypto_decrypt(member: ZipMember, password: bytes) -> bytes | None:
    keys = [0x12345678, 0x23456789, 0x34567890]
    def update(value: int) -> None:
        keys[0] = crc32_byte(keys[0], value)
        keys[1] = (keys[1] + (keys[0] & 0xff)) & 0xffffffff
        keys[1] = (keys[1] * 134775813 + 1) & 0xffffffff
        keys[2] = crc32_byte(keys[2], (keys[1] >> 24) & 0xff)
    for value in password: update(value)
    out = bytearray()
    for value in member.data:
        temp = (keys[2] | 2) & 0xffff
        plain = value ^ (((temp * (temp ^ 1)) >> 8) & 0xff)
        update(plain); out.append(plain)
    if len(out) < 12: return None
    expected = (member.mod_time >> 8) & 0xff if member.flags & 8 else (member.crc >> 24) & 0xff
    if out[11] != expected: return None
    return bytes(out[12:])


def gf_multiply(left: int, right: int) -> int:
    result = 0
    for _ in range(8):
        if right & 1: result ^= left
        left = ((left << 1) ^ (0x11b if left & 0x80 else 0)) & 0xff
        right >>= 1
    return result


def gf_power(value: int, exponent: int) -> int:
    result = 1
    while exponent:
        if exponent & 1: result = gf_multiply(result, value)
        value = gf_multiply(value, value)
        exponent >>= 1
    return result


def aes_sbox(value: int) -> int:
    inverse = gf_power(value, 254) if value else 0
    rotate = lambda amount: ((inverse << amount) | (inverse >> (8 - amount))) & 0xff
    return inverse ^ rotate(1) ^ rotate(2) ^ rotate(3) ^ rotate(4) ^ 0x63


SBOX = bytes(aes_sbox(value) for value in range(256))
RCON = (0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54)


def aes_expand(key: bytes) -> list[list[int]]:
    nk, nr = len(key) // 4, len(key) // 4 + 6
    words = [list(key[i:i + 4]) for i in range(0, len(key), 4)]
    for i in range(nk, 4 * (nr + 1)):
        temp = words[i - 1][:]
        if i % nk == 0:
            temp = [SBOX[x] for x in temp[1:] + temp[:1]]; temp[0] ^= RCON[i // nk]
        elif nk > 6 and i % nk == 4: temp = [SBOX[x] for x in temp]
        words.append([a ^ b for a, b in zip(words[i - nk], temp)])
    return [[x for word in words[i:i + 4] for x in word] for i in range(0, len(words), 4)]


def aes_block(block: bytes, rounds: list[list[int]]) -> bytes:
    state = list(block)
    state = [a ^ b for a, b in zip(state, rounds[0])]
    def xtime(x: int) -> int: return ((x << 1) ^ (0x11b if x & 0x80 else 0)) & 0xff
    for number, round_key in enumerate(rounds[1:], 1):
        state = [SBOX[x] for x in state]
        state = [state[i] for i in (0,5,10,15,4,9,14,3,8,13,2,7,12,1,6,11)]
        if number != len(rounds) - 1:
            mixed = []
            for i in range(0, 16, 4):
                a = state[i:i + 4]; total = a[0] ^ a[1] ^ a[2] ^ a[3]
                mixed.extend([a[j] ^ total ^ xtime(a[j] ^ a[(j + 1) % 4]) for j in range(4)])
            state = mixed
        state = [a ^ b for a, b in zip(state, round_key)]
    return bytes(state)


def decompress(method: int, data: bytes) -> bytes:
    if method == 0: return data
    if method == 8: return zlib.decompress(data, -15)
    if method == 12: return bz2.decompress(data)
    if method == 14: return lzma.decompress(data)
    raise ValueError


def verify(member: ZipMember, password: bytes) -> bool:
    try:
        if member.method == 99 and member.aes_strength:
            key_len = {1: 16, 2: 24, 3: 32}[member.aes_strength]
            salt_len = key_len // 2
            if len(member.data) < salt_len + 12: return False
            salt = member.data[:salt_len]; verifier = member.data[salt_len:salt_len + 2]
            derived = hashlib.pbkdf2_hmac("sha1", password, salt, 1000, 2 * key_len + 2)
            if not hmac.compare_digest(derived[-2:], verifier): return False
            encrypted = member.data[salt_len + 2:-10]; authentication = member.data[-10:]
            if not hmac.compare_digest(hmac.new(derived[key_len:2 * key_len], encrypted, hashlib.sha1).digest()[:10], authentication): return False
            rounds = aes_expand(derived[:key_len]); plain = bytearray()
            for counter, offset in enumerate(range(0, len(encrypted), 16), 1):
                stream = aes_block(counter.to_bytes(16, "little"), rounds)
                plain.extend(a ^ b for a, b in zip(encrypted[offset:offset + 16], stream))
            extracted = decompress(member.actual_method, bytes(plain))
        else:
            decrypted = zipcrypto_decrypt(member, password)
            if decrypted is None: return False
            extracted = decompress(member.method, decrypted)
        return len(extracted) == member.size and (member.crc == 0 or binascii.crc32(extracted) & 0xffffffff == member.crc)
    except (ValueError, zlib.error, OSError, lzma.LZMAError, KeyError):
        return False
    except Exception:
        return False


def rust_path_debug(path: str) -> str:
    return '"' + path.replace("\\", "\\\\").replace('"', '\\"') + '"'


def candidates(values: dict[str, object], custom: list[str | None]) -> Iterator[bytes]:
    if "passwordDictionary" in values:
        with open(str(values["passwordDictionary"]), "rb") as source:
            for line in source:
                yield line[:-1][:-1] if line.endswith(b"\r\n") else line[:-1] if line.endswith(b"\n") else line
    elif "mask" in values:
        yield from mask_candidates(parse_mask(str(values["mask"]), custom))
    else:
        charset = load_charset(values)
        yield from brute_candidates(charset, int(values["minPasswordLen"]), int(values["maxPasswordLen"]), values.get("startingPassword"))


def format_duration(seconds: float) -> str:
    ns = max(0, int(seconds * 1_000_000_000))
    units = ((3_600_000_000_000, "h"), (60_000_000_000, "m"), (1_000_000_000, "s"),
             (1_000_000, "ms"), (1_000, "us"), (1, "ns"))
    parts = []
    for scale, label in units:
        if ns >= scale:
            value, ns = divmod(ns, scale); parts.append(f"{value}{label}")
            if len(parts) == 3: break
    return " ".join(parts) if parts else "0s"


def write_stdout(text: str) -> None:
    sys.stdout.buffer.write(text.encode("utf-8"))


def write_stderr(text: str) -> None:
    sys.stderr.buffer.write(text.encode("utf-8"))


def run(argv: list[str]) -> int:
    start = time.perf_counter()
    values, custom = validate(parse_args(argv))
    members = parse_zip(str(values["inputFile"]))
    requested = int(values["fileNumber"])
    target = requested if requested < len(members) and members[requested].flags & 1 else None
    if target is None:
        target = next((i for i, member in enumerate(members) if member.flags & 1), None)
        if target is None:
            listing = [f"Archive contents ({len(members)} files):"]
            for i, member in enumerate(members[:20]):
                kind = "dir" if member.name.endswith("/") else "file"
                encrypted = ", encrypted" if member.flags & 1 else ""
                listing.append(f"  [{i}] {member.name} ({kind}{encrypted})")
            if len(members) > 20: listing.append(f"  ... and {len(members) - 20} more files")
            raise FinderError("Invalid zip file error - no encrypted file found in archive\n" + "\n".join(listing))
        write_stderr(f"File at index {requested} is not encrypted, auto-selecting file at index {target} ({members[target].name})\n")
    found = next((password for password in candidates(values, custom) if verify(members[target], password)), None)
    result = f"Time elapsed: {format_duration(time.perf_counter() - start)}\n"
    result += "Password not found\n" if found is None else "Password found:" + found.decode("utf-8", "replace") + "\n"
    write_stdout(result)
    return 0


def main() -> int:
    try: return run(sys.argv[1:])
    except CliExit as exit_error:
        (write_stdout if exit_error.stdout else write_stderr)(exit_error.text)
        return exit_error.status
    except FinderError as error:
        write_stderr(f"{error}\n")
        return 1
    except OSError as error:
        write_stderr(f"standard I/O error - {error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
