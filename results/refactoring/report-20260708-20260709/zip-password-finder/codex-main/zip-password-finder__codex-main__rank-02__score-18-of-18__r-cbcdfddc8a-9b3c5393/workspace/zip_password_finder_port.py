#!/usr/bin/env python3
import hashlib
import os
import struct
import sys
import time
import zipfile
from dataclasses import dataclass
from itertools import product


VERSION = "0.11.1"
EXE_NAME = "zip-password-finder.exe"


LOWER = list("abcdefghijklmnopqrstuvwxyz")
UPPER = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = list("0123456789")
SYMBOLS = list(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
LOWER_HEX = list("0123456789abcdef")
UPPER_HEX = list("0123456789ABCDEF")


class FinderError(Exception):
    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind
        self.message = message

    def render(self):
        if self.kind == "cli":
            return f'CLI argument error - "{self.message}"'
        if self.kind == "zip":
            return f"Invalid zip file error - {self.message}"
        if self.kind == "io":
            return f"standard I/O error - {self.message}"
        return self.message


@dataclass
class Args:
    input_file: str
    workers: int | None
    charset: str
    charset_file: str | None
    min_len: int
    max_len: int
    file_number: int
    dictionary: str | None
    starting_password: str | None
    mask: str | None
    custom_charsets: list


@dataclass
class AesInfo:
    strength: int
    salt: bytes
    verifier: bytes

    @property
    def key_len(self):
        return {1: 16, 2: 24, 3: 32}.get(self.strength, 16)


def full_help():
    return """Find the password of protected ZIP files

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


def short_help():
    return """Find the password of protected ZIP files

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


OPTIONS = {
    "-i": ("inputFile", True),
    "--inputFile": ("inputFile", True),
    "-w": ("workers", True),
    "--workers": ("workers", True),
    "-p": ("passwordDictionary", True),
    "--passwordDictionary": ("passwordDictionary", True),
    "-c": ("charset", True),
    "--charset": ("charset", True),
    "--charsetFile": ("charsetFile", True),
    "--minPasswordLen": ("minPasswordLen", True),
    "--maxPasswordLen": ("maxPasswordLen", True),
    "--fileNumber": ("fileNumber", True),
    "-s": ("startingPassword", True),
    "--startingPassword": ("startingPassword", True),
    "-m": ("mask", True),
    "--mask": ("mask", True),
    "-1": ("customCharset1", True),
    "--customCharset1": ("customCharset1", True),
    "-2": ("customCharset2", True),
    "--customCharset2": ("customCharset2", True),
    "-3": ("customCharset3", True),
    "--customCharset3": ("customCharset3", True),
    "-4": ("customCharset4", True),
    "--customCharset4": ("customCharset4", True),
}


def clap_missing_input():
    return (
        "error: the following required arguments were not provided:\n"
        "  --inputFile <inputFile>\n\n"
        "Usage: zip-password-finder.exe --inputFile <inputFile>\n\n"
        "For more information, try '--help'.\n"
    )


def parse_usize(flag, metavar, value):
    try:
        if value.startswith("-"):
            raise ValueError
        return int(value, 10)
    except Exception:
        raise SystemExit(
            (
                f"error: invalid value '{value}' for '{flag} <{metavar}>': "
                "invalid digit found in string\n\n"
                "For more information, try '--help'.\n"
            ),
            2,
        )


class SystemExit(Exception):
    def __init__(self, text, code):
        super().__init__(text)
        self.text = text
        self.code = code


def parse_args(argv):
    raw = {
        "charset": "lud",
        "minPasswordLen": "1",
        "maxPasswordLen": "10",
        "fileNumber": "0",
    }
    i = 0
    while i < len(argv):
        token = argv[i]
        if token in ("--help", "-h"):
            raise SystemExit(full_help() if token == "--help" else short_help(), 0)
        if token in ("--version", "-V"):
            raise SystemExit(f"zip-password-finder {VERSION}\n", 0)
        if token.startswith("--") and "=" in token:
            key, value = token.split("=", 1)
            if key in OPTIONS:
                raw[OPTIONS[key][0]] = value
                i += 1
                continue
        if token not in OPTIONS:
            raise SystemExit(
                f"error: unexpected argument '{token}' found\n\n"
                f"Usage: {EXE_NAME} [OPTIONS] --inputFile <inputFile>\n\n"
                "For more information, try '--help'.\n",
                2,
            )
        name, needs_value = OPTIONS[token]
        if needs_value:
            if i + 1 >= len(argv):
                raise SystemExit(
                    f"error: a value is required for '{token} <{name}>' but none was supplied\n\n"
                    "For more information, try '--help'.\n",
                    2,
                )
            raw[name] = argv[i + 1]
            i += 2
        else:
            i += 1

    if "inputFile" not in raw:
        raise SystemExit(clap_missing_input(), 2)

    input_file = raw["inputFile"]
    if not os.path.isfile(input_file):
        raise FinderError("cli", "'inputFile' does not exist")

    dictionary = raw.get("passwordDictionary")
    if dictionary and not os.path.isfile(dictionary):
        raise FinderError("cli", "'passwordDictionary' does not exist")

    charset_file = raw.get("charsetFile")
    if charset_file and not os.path.isfile(charset_file):
        raise FinderError("cli", "'charsetFile' does not exist")

    workers = parse_usize("--workers", "workers", raw["workers"]) if "workers" in raw else None
    if workers == 0:
        raise FinderError("cli", "'workers' must be positive")
    min_len = parse_usize("--minPasswordLen", "minPasswordLen", raw["minPasswordLen"])
    max_len = parse_usize("--maxPasswordLen", "maxPasswordLen", raw["maxPasswordLen"])
    file_number = parse_usize("--fileNumber", "fileNumber", raw["fileNumber"])
    if min_len == 0:
        raise FinderError("cli", "'minPasswordLen' must be positive")
    if max_len == 0:
        raise FinderError("cli", "'maxPasswordLen' must be positive")
    if min_len > max_len:
        raise FinderError("cli", "'maxPasswordLen' must be equal or greater than 'minPasswordLen'")

    mask = raw.get("mask")
    custom = [None, None, None, None]
    for idx in range(4):
        name = f"customCharset{idx + 1}"
        if name in raw:
            if mask is None:
                raise FinderError("cli", f"'--{name}' can only be used with --mask")
            custom[idx] = parse_custom_charset(raw[name])

    if mask is not None and dictionary is not None:
        raise FinderError("cli", "'mask' cannot be used with a dictionary file")

    starting_password = raw.get("startingPassword")
    if starting_password is not None:
        if dictionary is not None:
            raise FinderError("cli", "'startingPassword' cannot be used with a dictionary file")
        if mask is not None:
            raise FinderError("cli", "'startingPassword' cannot be used with mask attack")
        charset = charset_from_choice(raw["charset"], charset_file)
        if any(c not in charset for c in starting_password):
            raise FinderError("cli", "'startingPassword' uses characters out of the generation charset")
        if len(starting_password) > max_len or len(starting_password) < min_len:
            raise FinderError(
                "cli",
                "'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration",
            )

    return Args(
        input_file,
        workers,
        raw["charset"],
        charset_file,
        min_len,
        max_len,
        file_number,
        dictionary,
        starting_password,
        mask,
        custom,
    )


def charset_from_choice(preset, charset_file):
    if charset_file:
        try:
            chars = list(open(charset_file, "r", encoding="utf-8").read())
        except OSError as e:
            raise FinderError("io", str(e))
    else:
        chars = preset_to_charset(preset)
    return sorted(set(chars))


def preset_to_charset(choice):
    chars = []
    for symbol in choice:
        if symbol == "l":
            chars += LOWER
        elif symbol == "u":
            chars += UPPER
        elif symbol == "d":
            chars += DIGITS
        elif symbol == "s":
            chars += SYMBOLS
        elif symbol == "h":
            chars += LOWER_HEX
        elif symbol == "H":
            chars += UPPER_HEX
        else:
            raise FinderError("cli", f"Unknown charset option '{symbol}'")
    return chars


def builtin_token(token):
    if token == "l":
        return LOWER[:]
    if token == "u":
        return UPPER[:]
    if token == "d":
        return DIGITS[:]
    if token == "s":
        return SYMBOLS[:]
    if token == "a":
        return LOWER + UPPER + DIGITS + SYMBOLS
    if token == "h":
        return LOWER_HEX[:]
    if token == "H":
        return UPPER_HEX[:]
    return None


def parse_custom_charset(definition):
    chars = []
    i = 0
    while i < len(definition):
        c = definition[i]
        if c == "?":
            i += 1
            if i >= len(definition):
                raise FinderError("cli", "Custom charset definition ends with incomplete token '?'")
            token = definition[i]
            if token == "?":
                chars.append("?")
            else:
                builtin = builtin_token(token)
                if builtin is None:
                    raise FinderError("cli", f"Unknown token '?{token}' in custom charset definition")
                chars += builtin
        else:
            chars.append(c)
        i += 1
    if not chars:
        raise FinderError("cli", "Custom charset definition is empty")
    seen = []
    for c in chars:
        if c not in seen:
            seen.append(c)
    return seen


def parse_mask(mask, custom_charsets):
    positions = []
    i = 0
    while i < len(mask):
        c = mask[i]
        if c == "?":
            i += 1
            if i >= len(mask):
                raise FinderError("cli", "Mask ends with incomplete token '?'")
            token = mask[i]
            if token == "?":
                positions.append(["?"])
            elif token in "1234":
                idx = int(token) - 1
                if custom_charsets[idx] is None:
                    raise FinderError("cli", f"Custom charset ?{token} used in mask but --customCharset{token} not provided")
                positions.append(custom_charsets[idx])
            else:
                builtin = builtin_token(token)
                if builtin is None:
                    raise FinderError("cli", f"Unknown mask token '?{token}'")
                positions.append(builtin)
        else:
            positions.append([c])
        i += 1
    if not positions:
        raise FinderError("cli", "Mask pattern is empty")
    return positions


def password_count(charset_len, min_len, max_len):
    return sum(charset_len ** i for i in range(min_len, max_len + 1))


def already_generated_count(charset, min_len, starting_password):
    base = len(charset)
    count = 0
    for length in range(min_len, len(starting_password)):
        count += base ** length
    for i, c in enumerate(reversed(starting_password)):
        count += charset.index(c) * (base ** i)
    return count + 1


def gen_passwords(charset, min_len, max_len, starting_password):
    if starting_password is None:
        for length in range(min_len, max_len + 1):
            for tup in product(charset, repeat=length):
                yield "".join(tup).encode()
        return
    started = False
    for length in range(min_len, max_len + 1):
        for tup in product(charset, repeat=length):
            pw = "".join(tup)
            if not started:
                if pw == starting_password:
                    started = True
                else:
                    continue
            yield pw.encode()


def dict_passwords(path):
    with open(path, "rb") as f:
        for line in f:
            if line.endswith(b"\n"):
                line = line[:-1]
                if line.endswith(b"\r"):
                    line = line[:-1]
            yield line


def mask_passwords(positions):
    for tup in product(*positions):
        yield "".join(tup).encode()


def archive_listing(zf):
    infos = zf.infolist()
    lines = [f"Archive contents ({len(infos)} files):"]
    for i, info in enumerate(infos[:20]):
        kind = "dir" if info.filename.endswith("/") else "file"
        enc = ", encrypted" if info.flag_bits & 0x1 else ""
        lines.append(f"  [{i}] {info.filename} ({kind}{enc})")
    if len(infos) > 20:
        lines.append(f"  ... and {len(infos) - 20} more files")
    return "\n".join(lines)


def get_aes_strength(info):
    data = info.extra
    pos = 0
    while pos + 4 <= len(data):
        header_id, size = struct.unpack_from("<HH", data, pos)
        pos += 4
        body = data[pos:pos + size]
        pos += size
        if header_id == 0x9901 and len(body) >= 7:
            return body[4]
    return None


def get_aes_info(zip_path, info):
    strength = get_aes_strength(info)
    if strength is None:
        return None
    salt_len = {1: 8, 2: 12, 3: 16}.get(strength)
    if salt_len is None:
        return None
    with open(zip_path, "rb") as f:
        f.seek(info.header_offset)
        local = f.read(30)
        if len(local) < 30 or local[:4] != b"PK\x03\x04":
            return None
        name_len, extra_len = struct.unpack_from("<HH", local, 26)
        f.seek(name_len + extra_len, os.SEEK_CUR)
        salt = f.read(salt_len)
        verifier = f.read(2)
    if len(salt) != salt_len or len(verifier) != 2:
        return None
    return AesInfo(strength, salt, verifier)


def validate_zip(zip_path, file_number):
    try:
        zf = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile as e:
        raise FinderError("zip", str(e))
    infos = zf.infolist()

    def is_encrypted(idx):
        return 0 <= idx < len(infos) and bool(infos[idx].flag_bits & 0x1)

    if is_encrypted(file_number):
        target = file_number
    else:
        target = next((i for i in range(len(infos)) if is_encrypted(i)), None)
        if target is None:
            raise FinderError("zip", "no encrypted file found in archive\n" + archive_listing(zf))
        name = infos[target].filename
        print(
            f"File at index {file_number} is not encrypted, auto-selecting file at index {target} ({name})",
            file=sys.stderr,
        )

    return zf, target, infos[target], get_aes_info(zip_path, infos[target])


def check_password(zf, info, aes_info, password):
    if aes_info is not None:
        dk_len = 2 * aes_info.key_len + 2
        derived = hashlib.pbkdf2_hmac("sha1", password, aes_info.salt, 1000, dk_len)
        return derived[-2:] == aes_info.verifier
    try:
        with zf.open(info, "r", pwd=password) as fh:
            data = fh.read()
            return len(data) == info.file_size
    except Exception:
        return False


def find_password(args):
    zf, file_number, info, aes_info = validate_zip(args.input_file, args.file_number)
    workers = args.workers or (os.cpu_count() or 1)
    _ = workers

    if args.dictionary:
        candidates = dict_passwords(args.dictionary)
    elif args.mask is not None:
        positions = parse_mask(args.mask, args.custom_charsets)
        candidates = mask_passwords(positions)
    else:
        charset = charset_from_choice(args.charset, args.charset_file)
        candidates = gen_passwords(charset, args.min_len, args.max_len, args.starting_password)

    for password in candidates:
        if check_password(zf, info, aes_info, password):
            return password.decode("utf-8", errors="replace")
    return None


def format_duration(seconds):
    ns = int(seconds * 1_000_000_000)
    parts = []
    units = [
        ("h", 3_600_000_000_000),
        ("m", 60_000_000_000),
        ("s", 1_000_000_000),
        ("ms", 1_000_000),
        ("us", 1_000),
        ("ns", 1),
    ]
    for name, size in units:
        if ns >= size:
            value, ns = divmod(ns, size)
            parts.append(f"{value}{name}")
    return " ".join(parts[:3]) if parts else "0ns"


def main(argv):
    try:
        args = parse_args(argv)
        start = time.perf_counter()
        password = find_password(args)
        elapsed = format_duration(time.perf_counter() - start)
        print(f"Time elapsed: {elapsed}")
        if password is None:
            print("Password not found")
        else:
            print(f"Password found:{password}")
        return 0
    except SystemExit as e:
        stream = sys.stdout if e.code == 0 else sys.stderr
        stream.write(e.text)
        return e.code
    except FinderError as e:
        print(e.render(), file=sys.stderr)
        return 1
    except OSError as e:
        print(f"standard I/O error - {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
