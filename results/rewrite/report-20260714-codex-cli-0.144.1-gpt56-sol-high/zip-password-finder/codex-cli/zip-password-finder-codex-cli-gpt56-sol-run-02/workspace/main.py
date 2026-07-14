#!/usr/bin/env python3
"""Functional Python port of zip-password-finder 0.11.1."""

from __future__ import annotations

import binascii
import hashlib
import hmac
import itertools
import os
import struct
import sys
import time
import zipfile
import zlib

# Rust writes LF bytes on Windows; disable Python's normal CRLF translation.
sys.stdout.reconfigure(newline="\n")
sys.stderr.reconfigure(newline="\n")


PROGRAM = "zip-password-finder.exe"
LOWER = "abcdefghijklmnopqrstuvwxyz"
UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
DIGITS = "0123456789"
SYMBOLS = " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
LOWER_HEX = "0123456789abcdef"
UPPER_HEX = "0123456789ABCDEF"

OPTION_SPECS = {
    "-i": ("inputFile", True), "--inputFile": ("inputFile", True),
    "-w": ("workers", True), "--workers": ("workers", True),
    "-p": ("passwordDictionary", True), "--passwordDictionary": ("passwordDictionary", True),
    "-c": ("charset", True), "--charset": ("charset", True),
    "--charsetFile": ("charsetFile", True),
    "--minPasswordLen": ("minPasswordLen", True),
    "--maxPasswordLen": ("maxPasswordLen", True),
    "--fileNumber": ("fileNumber", True),
    "-s": ("startingPassword", True), "--startingPassword": ("startingPassword", True),
    "-m": ("mask", True), "--mask": ("mask", True),
    "-1": ("customCharset1", True), "--customCharset1": ("customCharset1", True),
    "-2": ("customCharset2", True), "--customCharset2": ("customCharset2", True),
    "-3": ("customCharset3", True), "--customCharset3": ("customCharset3", True),
    "-4": ("customCharset4", True), "--customCharset4": ("customCharset4", True),
}

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


class PortError(Exception):
    def __init__(self, kind: str, message: str):
        self.kind = kind
        self.message = message

    def rendered(self) -> str:
        if self.kind == "cli":
            # Rust {:?} string rendering for the messages used by this program.
            escaped = (self.message.replace("\\", "\\\\").replace('"', '\\"')
                       .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t"))
            return f'CLI argument error - "{escaped}"'
        if self.kind == "io":
            return f"standard I/O error - {self.message}"
        return f"Invalid zip file error - {self.message}"


def clap_error(message: str, usage: bool = False, minimal_usage: bool = False) -> None:
    sys.stderr.write(f"error: {message}\n")
    if usage:
        options = "" if minimal_usage else "[OPTIONS] "
        sys.stderr.write(f"\nUsage: {PROGRAM} {options}--inputFile <inputFile>\n")
    sys.stderr.write("\nFor more information, try '--help'.\n")
    raise SystemExit(2)


def parse_usize(value: str, displayed: str) -> int:
    # Rust usize parser accepts an optional plus, but no sign otherwise.
    raw = value[1:] if value.startswith("+") else value
    if not raw or not raw.isascii() or not raw.isdigit():
        clap_error(f"invalid value '{value}' for '{displayed}': invalid digit found in string")
    number = int(raw)
    if number > (1 << (8 * struct.calcsize("P"))) - 1:
        clap_error(f"invalid value '{value}' for '{displayed}': number too large to fit in target type")
    return number


def parse_args(argv: list[str]) -> dict[str, object]:
    if argv == ["-h"]:
        sys.stdout.write(SHORT_HELP); raise SystemExit(0)
    if argv == ["--help"]:
        sys.stdout.write(LONG_HELP); raise SystemExit(0)
    if argv in (["-V"], ["--version"]):
        sys.stdout.write("zip-password-finder 0.11.1\n"); raise SystemExit(0)

    values: dict[str, str] = {}
    used_spelling: dict[str, str] = {}
    i = 0
    while i < len(argv):
        token = argv[i]
        original = token
        if token == "--":
            if i + 1 < len(argv):
                clap_error(f"unexpected argument '{argv[i + 1]}' found", usage=True)
            break
        inline = None
        if token.startswith("--") and "=" in token:
            token, inline = token.split("=", 1)
        elif token.startswith("-") and not token.startswith("--") and len(token) > 2:
            short = token[:2]
            if short in OPTION_SPECS:
                token, inline = short, token[2:]
                if inline.startswith("="):
                    inline = inline[1:]
        if token in ("-h", "--help"):
            sys.stdout.write(SHORT_HELP if token == "-h" else LONG_HELP); raise SystemExit(0)
        if token in ("-V", "--version"):
            sys.stdout.write("zip-password-finder 0.11.1\n"); raise SystemExit(0)
        spec = OPTION_SPECS.get(token)
        if spec is None:
            clap_error(f"unexpected argument '{original}' found", usage=True)
        name, _ = spec
        display = f"--{name} <{name}>"
        if name in values:
            clap_error(f"the argument '{display}' cannot be used multiple times", usage=True)
        if inline is None:
            if i + 1 >= len(argv):
                clap_error(f"a value is required for '{display}' but none was supplied")
            following = argv[i + 1]
            if following.startswith("-") and following != "-":
                key = following.split("=", 1)[0]
                recognized = key in OPTION_SPECS or key in ("-h", "--help", "-V", "--version")
                if not recognized and len(key) > 2 and not key.startswith("--"):
                    recognized = key[:2] in OPTION_SPECS
                if recognized:
                    clap_error(f"a value is required for '{display}' but none was supplied")
                clap_error(f"unexpected argument '{following}' found", usage=True,
                           minimal_usage=following.startswith("--"))
            i += 1
            inline = argv[i]
        values[name] = inline
        used_spelling[name] = token
        i += 1

    if "inputFile" not in values:
        sys.stderr.write("error: the following required arguments were not provided:\n  --inputFile <inputFile>\n\n")
        sys.stderr.write(f"Usage: {PROGRAM} --inputFile <inputFile>\n\nFor more information, try '--help'.\n")
        raise SystemExit(2)

    numeric = {
        "workers": "--workers <workers>",
        "minPasswordLen": "--minPasswordLen <minPasswordLen>",
        "maxPasswordLen": "--maxPasswordLen <maxPasswordLen>",
        "fileNumber": "--fileNumber <fileNumber>",
    }
    out: dict[str, object] = dict(values)
    out.setdefault("charset", "lud")
    out.setdefault("minPasswordLen", "1")
    out.setdefault("maxPasswordLen", "10")
    out.setdefault("fileNumber", "0")
    for name, display in numeric.items():
        if name in out:
            out[name] = parse_usize(str(out[name]), display)
    return out


def builtin(token: str) -> str | None:
    return {"l": LOWER, "u": UPPER, "d": DIGITS, "s": SYMBOLS,
            "a": LOWER + UPPER + DIGITS + SYMBOLS,
            "h": LOWER_HEX, "H": UPPER_HEX}.get(token)


def parse_custom(definition: str) -> str:
    chars: list[str] = []
    i = 0
    while i < len(definition):
        if definition[i] != "?":
            chars.append(definition[i]); i += 1; continue
        if i + 1 == len(definition):
            raise PortError("cli", "Custom charset definition ends with incomplete token '?'")
        token = definition[i + 1]
        if token == "?": chars.append("?")
        else:
            resolved = builtin(token)
            if resolved is None:
                raise PortError("cli", f"Unknown token '?{token}' in custom charset definition")
            chars.extend(resolved)
        i += 2
    if not chars:
        raise PortError("cli", "Custom charset definition is empty")
    return "".join(dict.fromkeys(chars))


def parse_mask(pattern: str, custom: list[str | None]) -> list[str]:
    positions: list[str] = []
    i = 0
    while i < len(pattern):
        if pattern[i] != "?":
            positions.append(pattern[i]); i += 1; continue
        if i + 1 == len(pattern): raise PortError("cli", "Mask ends with incomplete token '?'")
        token = pattern[i + 1]
        if token == "?": positions.append("?")
        elif token in "1234":
            value = custom[int(token) - 1]
            if value is None:
                raise PortError("cli", f"Custom charset ?{token} used in mask but --customCharset{token} not provided")
            positions.append(value)
        else:
            value = builtin(token)
            if value is None: raise PortError("cli", f"Unknown mask token '?{token}'")
            positions.append(value)
        i += 2
    if not positions: raise PortError("cli", "Mask pattern is empty")
    return positions


def validate_args(a: dict[str, object]) -> tuple[str, object]:
    input_file = str(a["inputFile"])
    if not os.path.isfile(input_file): raise PortError("cli", "'inputFile' does not exist")
    dictionary = a.get("passwordDictionary")
    if dictionary is not None and not os.path.isfile(str(dictionary)):
        raise PortError("cli", "'passwordDictionary' does not exist")
    charset_file = a.get("charsetFile")
    if charset_file is not None and not os.path.isfile(str(charset_file)):
        raise PortError("cli", "'charsetFile' does not exist")
    if a.get("workers") == 0: raise PortError("cli", "'workers' must be positive")
    if a["minPasswordLen"] == 0: raise PortError("cli", "'minPasswordLen' must be positive")
    if a["maxPasswordLen"] == 0: raise PortError("cli", "'maxPasswordLen' must be positive")
    if int(a["minPasswordLen"]) > int(a["maxPasswordLen"]):
        raise PortError("cli", "'maxPasswordLen' must be equal or greater than 'minPasswordLen'")

    custom: list[str | None] = [None] * 4
    for i in range(4):
        name = f"customCharset{i + 1}"
        if name in a:
            if "mask" not in a: raise PortError("cli", f"'--{name}' can only be used with --mask")
            custom[i] = parse_custom(str(a[name]))
    if "mask" in a and dictionary is not None:
        raise PortError("cli", "'mask' cannot be used with a dictionary file")
    starting = a.get("startingPassword")
    if starting is not None:
        if dictionary is not None: raise PortError("cli", "'startingPassword' cannot be used with a dictionary file")
        if "mask" in a: raise PortError("cli", "'startingPassword' cannot be used with mask attack")

    if dictionary is not None:
        return "dictionary", str(dictionary)
    if "mask" in a:
        return "mask", parse_mask(str(a["mask"]), custom)

    if charset_file is not None:
        try:
            with open(str(charset_file), "r", encoding="utf-8") as f: charset = f.read()
        except UnicodeError:
            raise PortError("io", "stream did not contain valid UTF-8")
        except OSError as e:
            message = e.strerror or str(e)
            if e.errno is not None: message += f" (os error {e.errno})"
            raise PortError("io", message)
    else:
        pieces = []
        for c in str(a["charset"]):
            value = builtin(c)
            if value is None: raise PortError("cli", f"Unknown charset option '{c}'")
            pieces.append(value)
        charset = "".join(pieces)
    charset = "".join(sorted(set(charset)))
    if starting is not None:
        s = str(starting)
        if any(c not in charset for c in s):
            raise PortError("cli", "'startingPassword' uses characters out of the generation charset")
        if not int(a["minPasswordLen"]) <= len(s) <= int(a["maxPasswordLen"]):
            raise PortError("cli", "'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration")
    return "generate", (charset, int(a["minPasswordLen"]), int(a["maxPasswordLen"]), None if starting is None else str(starting))


def candidate_iter(strategy: tuple[str, object]):
    kind, data = strategy
    if kind == "dictionary":
        with open(str(data), "rb") as f:
            for line in f:
                if line.endswith(b"\n"):
                    line = line[:-1]
                    if line.endswith(b"\r"): line = line[:-1]
                yield line
        return
    if kind == "mask":
        positions = [bytes((ord(c) & 255 for c in p)) for p in data]  # type: ignore[arg-type]
        yield from (bytes(x) for x in itertools.product(*positions))
        return
    charset, min_len, max_len, starting = data  # type: ignore[misc]
    chars = bytes((ord(c) & 255 for c in charset))
    total = sum(len(chars) ** n for n in range(min_len, max_len + 1))
    password = bytearray([chars[0]] * min_len)
    if starting is not None:
        password = bytearray(starting.encode("utf-8"))
        base = len(charset)
        already = sum(base ** n for n in range(min_len, len(starting.encode("utf-8"))))
        already += sum(charset.index(c) * base ** i for i, c in enumerate(reversed(starting))) + 1
        total -= already
    lookup = {value: i for i, value in enumerate(chars)}
    generated = 0
    while len(password) <= max_len:
        if generated == 0:
            generated += 1
            yield bytes(password)
            continue
        if generated == total:
            return
        carry = True
        for i in range(len(password) - 1, -1, -1):
            index = lookup[password[i]]
            if index < len(chars) - 1:
                password[i] = chars[index + 1]
                carry = False
                break
            password[i] = chars[0]
        if carry:
            password = bytearray([chars[0]] * (len(password) + 1))
        generated += 1
        yield bytes(password)


def extra_fields(extra: bytes):
    pos = 0
    while pos + 4 <= len(extra):
        tag, size = struct.unpack_from("<HH", extra, pos); pos += 4
        yield tag, extra[pos:pos + size]
        pos += size


def aes_metadata(info: zipfile.ZipInfo):
    for tag, data in extra_fields(info.extra):
        if tag == 0x9901 and len(data) >= 7:
            version, vendor, strength, method = struct.unpack_from("<H2sBH", data)
            return version, strength, method
    return None


# Compact, dependency-free AES encryption (used for WinZip AES CTR keystream).
SBOX = bytes.fromhex(
    "637c777bf26b6fc53001672bfed7ab76ca82c97dfa5947f0add4a2af9ca472c0"
    "b7fd9326363ff7cc34a5e5f171d8311504c723c31896059a071280e2eb27b275"
    "09832c1a1b6e5aa0523bd6b329e32f8453d100ed20fcb15b6acbbe394a4c58cf"
    "d0efaafb434d338545f9027f503c9fa851a3408f929d38f5bcb6da2110fff3d2"
    "cd0c13ec5f974417c4a77e3d645d197360814fdc222a908846eeb814de5e0bdb"
    "e0323a0a4906245cc2d3ac629195e479e7c8376d8dd54ea96c56f4ea657aae08"
    "ba78252e1ca6b4c6e8dd741f4bbd8b8a703eb5664803f60e613557b986c11d9e"
    "e1f8981169d98e949b1e87e9ce5528df8ca1890dbfe6426841992d0fb054bb16"
)
RCON = (0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54)


def aes_keys(key: bytes) -> list[bytes]:
    nk, nr = len(key) // 4, len(key) // 4 + 6
    words = [list(key[i:i + 4]) for i in range(0, len(key), 4)]
    while len(words) < 4 * (nr + 1):
        temp = words[-1][:]
        i = len(words)
        if i % nk == 0:
            temp = [SBOX[x] for x in temp[1:] + temp[:1]]
            temp[0] ^= RCON[i // nk]
        elif nk > 6 and i % nk == 4:
            temp = [SBOX[x] for x in temp]
        words.append([words[i - nk][j] ^ temp[j] for j in range(4)])
    return [bytes(sum(words[i:i + 4], [])) for i in range(0, len(words), 4)]


def aes_block(block: bytes, rounds: list[bytes]) -> bytes:
    s = [x ^ y for x, y in zip(block, rounds[0])]
    for rnd in range(1, len(rounds)):
        s = [SBOX[x] for x in s]
        s = [s[0],s[5],s[10],s[15], s[4],s[9],s[14],s[3], s[8],s[13],s[2],s[7], s[12],s[1],s[6],s[11]]
        if rnd != len(rounds) - 1:
            for c in range(4):
                i = 4*c; a,b,c1,d = s[i:i+4]; x=a^b^c1^d
                s[i] = a ^ x ^ ((a^b)<<1 & 255) ^ (0x1b if a^b & 0x80 else 0)
                s[i+1] = b ^ x ^ ((b^c1)<<1 & 255) ^ (0x1b if b^c1 & 0x80 else 0)
                s[i+2] = c1 ^ x ^ ((c1^d)<<1 & 255) ^ (0x1b if c1^d & 0x80 else 0)
                s[i+3] = d ^ x ^ ((d^a)<<1 & 255) ^ (0x1b if d^a & 0x80 else 0)
        s = [x ^ y for x, y in zip(s, rounds[rnd])]
    return bytes(s)


class ArchiveTarget:
    def __init__(self, path: str, file_number: int):
        self.path = path
        try:
            self.zf = zipfile.ZipFile(path)
            self.infos = self.zf.infolist()
        except OSError as e:
            message = e.strerror or str(e)
            if e.errno is not None: message += f" (os error {e.errno})"
            raise PortError("io", message)
        except zipfile.BadZipFile as e:
            msg = str(e)
            if msg == "File is not a zip file": msg = "invalid Zip archive: Could not find EOCD"
            raise PortError("zip", msg)
        encrypted = [i for i, x in enumerate(self.infos) if x.flag_bits & 1]
        if 0 <= file_number < len(self.infos) and file_number in encrypted:
            target = file_number
        elif encrypted:
            target = encrypted[0]
            sys.stderr.write(f"File at index {file_number} is not encrypted, auto-selecting file at index {target} ({self.infos[target].filename})\n")
        else:
            listing = f"Archive contents ({len(self.infos)} files):"
            for i, info in enumerate(self.infos[:20]):
                kind = "dir" if info.filename.endswith("/") else "file"
                enc = ", encrypted" if info.flag_bits & 1 else ""
                listing += f"\n  [{i}] {info.filename} ({kind}{enc})"
            if len(self.infos) > 20: listing += f"\n  ... and {len(self.infos)-20} more files"
            raise PortError("zip", "no encrypted file found in archive\n" + listing)
        self.info = self.infos[target]
        self.aes = aes_metadata(self.info)
        self.raw = None
        if self.aes:
            with open(path, "rb") as f:
                f.seek(self.info.header_offset)
                header = f.read(30)
                if len(header) != 30 or header[:4] != b"PK\x03\x04": raise PortError("zip", "invalid local file header")
                name_len, extra_len = struct.unpack_from("<HH", header, 26)
                f.seek(name_len + extra_len, 1)
                self.raw = f.read(self.info.compress_size)

    def check(self, password: bytes) -> bool:
        if not self.aes:
            try:
                self.zf.read(self.info, pwd=password)
                return True
            except (RuntimeError, zipfile.BadZipFile, zlib.error, EOFError):
                return False
        _version, strength, method = self.aes
        key_len = {1: 16, 2: 24, 3: 32}.get(strength)
        if key_len is None: return False
        salt_len = key_len // 2
        raw = self.raw
        if raw is None or len(raw) < salt_len + 12: return False
        salt, verifier = raw[:salt_len], raw[salt_len:salt_len+2]
        ciphertext, auth = raw[salt_len+2:-10], raw[-10:]
        derived = hashlib.pbkdf2_hmac("sha1", password, salt, 1000, 2*key_len+2)
        if derived[-2:] != verifier: return False
        if not hmac.compare_digest(hmac.new(derived[key_len:2*key_len], ciphertext, hashlib.sha1).digest()[:10], auth):
            return False
        rounds = aes_keys(derived[:key_len])
        clear = bytearray()
        for n, pos in enumerate(range(0, len(ciphertext), 16), 1):
            stream = aes_block(n.to_bytes(16, "little"), rounds)
            clear.extend(x ^ y for x, y in zip(ciphertext[pos:pos+16], stream))
        try:
            if method == 0: data = bytes(clear)
            elif method == 8: data = zlib.decompress(clear, -15)
            elif method == 12: data = __import__("bz2").decompress(clear)
            elif method == 14: data = __import__("lzma").decompress(clear)
            else: return False
        except Exception:
            return False
        if len(data) != self.info.file_size: return False
        # AE-1 uses CRC; AE-2 normally records zero and authenticates instead.
        return self.info.CRC == 0 or (binascii.crc32(data) & 0xffffffff) == self.info.CRC


def format_duration(ns: int) -> str:
    units = [(604800_000_000_000,"week"),(86400_000_000_000,"day"),(3600_000_000_000,"h"),
             (60_000_000_000,"m"),(1_000_000_000,"s"),(1_000_000,"ms"),(1_000,"us"),(1,"ns")]
    parts = []
    for size, label in units:
        value, ns = divmod(ns, size)
        if value:
            if label in ("week","day"): label += "s" if value != 1 else ""
            parts.append(f"{value}{label}")
    return " ".join(parts) if parts else "0s"


def main(argv: list[str]) -> int:
    try:
        args = parse_args(argv)
        strategy = validate_args(args)
        started = time.perf_counter_ns()
        archive = ArchiveTarget(str(args["inputFile"]), int(args["fileNumber"]))
        found = None
        try:
            for password in candidate_iter(strategy):
                if archive.check(password):
                    found = password.decode("utf-8", "replace")
                    break
        except OSError as e:
            message = e.strerror or str(e)
            if e.errno is not None: message += f" (os error {e.errno})"
            raise PortError("io", message)
        elapsed = format_duration(time.perf_counter_ns() - started)
        sys.stdout.write(f"Time elapsed: {elapsed}\n")
        sys.stdout.write(f"Password found:{found}\n" if found is not None else "Password not found\n")
        return 0
    except PortError as e:
        sys.stderr.write(e.rendered() + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
