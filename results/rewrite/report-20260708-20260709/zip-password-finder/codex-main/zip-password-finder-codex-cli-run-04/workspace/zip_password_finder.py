#!/usr/bin/env python3
import os
import sys
import time
import zipfile
from dataclasses import dataclass
from typing import Iterable, Iterator, Optional


VERSION = "0.11.1"
NAME = "zip-password-finder"


LOWER = list("abcdefghijklmnopqrstuvwxyz")
UPPER = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = list("0123456789")
SYMBOLS = list(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
LOWER_HEX = list("0123456789abcdef")
UPPER_HEX = list("0123456789ABCDEF")


class FinderError(Exception):
    prefix = ""

    def __str__(self) -> str:
        return f"{self.prefix}{self.args[0]}"


class CliArgumentError(FinderError):
    prefix = "CLI argument error - "

    def __str__(self) -> str:
        return f'{self.prefix}"{self.args[0]}"'


class InvalidZipError(FinderError):
    prefix = "Invalid zip file error - "


@dataclass
class Args:
    input_file: str
    workers: Optional[int] = None
    password_dictionary: Optional[str] = None
    charset: str = "lud"
    charset_file: Optional[str] = None
    min_password_len: int = 1
    max_password_len: int = 10
    file_number: int = 0
    starting_password: Optional[str] = None
    mask: Optional[str] = None
    custom_charsets: tuple[Optional[list[str]], Optional[list[str]], Optional[list[str]], Optional[list[str]]] = (None, None, None, None)


@dataclass
class Target:
    info: zipfile.ZipInfo
    aes_key_length: int = 0
    aes_salt: bytes = b""
    aes_verifier: bytes = b""


HELP = """Find the password of protected ZIP files

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


def clap_missing_input() -> None:
    sys.stderr.write("""error: the following required arguments were not provided:
  --inputFile <inputFile>

Usage: zip-password-finder.exe --inputFile <inputFile>

For more information, try '--help'.
""")


def take_value(argv: list[str], i: int, opt: str) -> tuple[str, int]:
    if "=" in opt and opt.startswith("--"):
        return opt.split("=", 1)[1], i
    if i + 1 >= len(argv):
        raise SystemExit(2)
    return argv[i + 1], i + 1


def parse_usize(value: str, name: str) -> int:
    try:
        if value.startswith("-"):
            raise ValueError
        return int(value, 10)
    except ValueError:
        sys.stderr.write(
            f"error: invalid value '{value}' for '{name}': invalid digit found in string\n"
        )
        raise SystemExit(2)


def parse_args(argv: list[str]) -> Args:
    if any(a == "--help" for a in argv):
        sys.stdout.write(HELP)
        raise SystemExit(0)
    if any(a == "-h" for a in argv):
        sys.stdout.write(SHORT_HELP)
        raise SystemExit(0)
    if any(a in ("-V", "--version") for a in argv):
        sys.stdout.write(f"{NAME} {VERSION}\n")
        raise SystemExit(0)

    values: dict[str, object] = {}
    custom_defs: list[Optional[str]] = [None, None, None, None]
    i = 0
    while i < len(argv):
        arg = argv[i]
        key = None
        if arg in ("-i", "--inputFile") or arg.startswith("--inputFile="):
            key = "input_file"
        elif arg in ("-w", "--workers") or arg.startswith("--workers="):
            key = "workers"
        elif arg in ("-p", "--passwordDictionary") or arg.startswith("--passwordDictionary="):
            key = "password_dictionary"
        elif arg in ("-c", "--charset") or arg.startswith("--charset="):
            key = "charset"
        elif arg == "--charsetFile" or arg.startswith("--charsetFile="):
            key = "charset_file"
        elif arg == "--minPasswordLen" or arg.startswith("--minPasswordLen="):
            key = "min_password_len"
        elif arg == "--maxPasswordLen" or arg.startswith("--maxPasswordLen="):
            key = "max_password_len"
        elif arg == "--fileNumber" or arg.startswith("--fileNumber="):
            key = "file_number"
        elif arg in ("-s", "--startingPassword") or arg.startswith("--startingPassword="):
            key = "starting_password"
        elif arg in ("-m", "--mask") or arg.startswith("--mask="):
            key = "mask"
        elif arg in ("-1", "--customCharset1") or arg.startswith("--customCharset1="):
            value, i = take_value(argv, i, arg)
            custom_defs[0] = value
            i += 1
            continue
        elif arg in ("-2", "--customCharset2") or arg.startswith("--customCharset2="):
            value, i = take_value(argv, i, arg)
            custom_defs[1] = value
            i += 1
            continue
        elif arg in ("-3", "--customCharset3") or arg.startswith("--customCharset3="):
            value, i = take_value(argv, i, arg)
            custom_defs[2] = value
            i += 1
            continue
        elif arg in ("-4", "--customCharset4") or arg.startswith("--customCharset4="):
            value, i = take_value(argv, i, arg)
            custom_defs[3] = value
            i += 1
            continue
        else:
            sys.stderr.write(f"error: unexpected argument '{arg}' found\n")
            raise SystemExit(2)

        value, i = take_value(argv, i, arg)
        values[key] = value
        i += 1

    if "input_file" not in values:
        clap_missing_input()
        raise SystemExit(2)

    for name in ("workers", "min_password_len", "max_password_len", "file_number"):
        if name in values:
            values[name] = parse_usize(str(values[name]), f"--{camel_name(name)} <{camel_name(name)}>")

    args = Args(**values)  # type: ignore[arg-type]
    if not os.path.isfile(args.input_file):
        raise CliArgumentError("'inputFile' does not exist")
    if args.password_dictionary is not None and not os.path.isfile(args.password_dictionary):
        raise CliArgumentError("'passwordDictionary' does not exist")
    if args.charset_file is not None and not os.path.isfile(args.charset_file):
        raise CliArgumentError("'charsetFile' does not exist")
    if args.workers == 0:
        raise CliArgumentError("'workers' must be positive")
    if args.min_password_len == 0:
        raise CliArgumentError("'minPasswordLen' must be positive")
    if args.max_password_len == 0:
        raise CliArgumentError("'maxPasswordLen' must be positive")
    if args.min_password_len > args.max_password_len:
        raise CliArgumentError("'maxPasswordLen' must be equal or greater than 'minPasswordLen'")

    parsed_custom: list[Optional[list[str]]] = [None, None, None, None]
    for idx, definition in enumerate(custom_defs):
        if definition is not None:
            if args.mask is None:
                raise CliArgumentError(f"'--customCharset{idx + 1}' can only be used with --mask")
            parsed_custom[idx] = parse_custom_charset(definition)
    args.custom_charsets = tuple(parsed_custom)  # type: ignore[assignment]

    if args.mask is not None and args.password_dictionary is not None:
        raise CliArgumentError("'mask' cannot be used with a dictionary file")
    if args.starting_password is not None:
        if args.password_dictionary is not None:
            raise CliArgumentError("'startingPassword' cannot be used with a dictionary file")
        if args.mask is not None:
            raise CliArgumentError("'startingPassword' cannot be used with mask attack")
        charset = charset_from_args(args)
        if any(c not in charset for c in args.starting_password):
            raise CliArgumentError("'startingPassword' uses characters out of the generation charset")
        length = len(args.starting_password)
        if length > args.max_password_len or length < args.min_password_len:
            raise CliArgumentError("'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration")
    return args


def camel_name(name: str) -> str:
    mapping = {
        "min_password_len": "minPasswordLen",
        "max_password_len": "maxPasswordLen",
        "file_number": "fileNumber",
    }
    return mapping.get(name, name)


def preset_to_charset(choice: str) -> list[str]:
    charset: list[str] = []
    for symbol in choice:
        if symbol == "l":
            charset.extend(LOWER)
        elif symbol == "u":
            charset.extend(UPPER)
        elif symbol == "d":
            charset.extend(DIGITS)
        elif symbol == "s":
            charset.extend(SYMBOLS)
        elif symbol == "h":
            charset.extend(LOWER_HEX)
        elif symbol == "H":
            charset.extend(UPPER_HEX)
        else:
            raise CliArgumentError(f"Unknown charset option '{symbol}'")
    return charset


def charset_from_args(args: Args) -> list[str]:
    if args.charset_file is not None:
        with open(args.charset_file, "r", encoding="utf-8") as f:
            chars = list(f.read())
    else:
        chars = preset_to_charset(args.charset)
    return sorted(set(chars))


def resolve_builtin_token(token: str) -> Optional[list[str]]:
    if token == "l":
        return LOWER.copy()
    if token == "u":
        return UPPER.copy()
    if token == "d":
        return DIGITS.copy()
    if token == "s":
        return SYMBOLS.copy()
    if token == "a":
        return LOWER + UPPER + DIGITS + SYMBOLS
    if token == "h":
        return LOWER_HEX.copy()
    if token == "H":
        return UPPER_HEX.copy()
    return None


def parse_custom_charset(definition: str) -> list[str]:
    charset: list[str] = []
    i = 0
    while i < len(definition):
        c = definition[i]
        if c == "?":
            i += 1
            if i >= len(definition):
                raise CliArgumentError("Custom charset definition ends with incomplete token '?'")
            token = definition[i]
            if token == "?":
                charset.append("?")
            else:
                builtin = resolve_builtin_token(token)
                if builtin is None:
                    raise CliArgumentError(f"Unknown token '?{token}' in custom charset definition")
                charset.extend(builtin)
        else:
            charset.append(c)
        i += 1
    if not charset:
        raise CliArgumentError("Custom charset definition is empty")
    seen: list[str] = []
    for c in charset:
        if c not in seen:
            seen.append(c)
    return seen


def parse_mask(mask: str, custom: tuple[Optional[list[str]], Optional[list[str]], Optional[list[str]], Optional[list[str]]]) -> list[list[str]]:
    positions: list[list[str]] = []
    i = 0
    while i < len(mask):
        c = mask[i]
        if c == "?":
            i += 1
            if i >= len(mask):
                raise CliArgumentError("Mask ends with incomplete token '?'")
            token = mask[i]
            if token == "?":
                positions.append(["?"])
            elif token in "1234":
                idx = int(token) - 1
                if custom[idx] is None:
                    raise CliArgumentError(f"Custom charset ?{token} used in mask but --customCharset{token} not provided")
                positions.append(custom[idx].copy())  # type: ignore[union-attr]
            else:
                builtin = resolve_builtin_token(token)
                if builtin is None:
                    raise CliArgumentError(f"Unknown mask token '?{token}'")
                positions.append(builtin)
        else:
            positions.append([c])
        i += 1
    if not positions:
        raise CliArgumentError("Mask pattern is empty")
    return positions


def password_count(charset_len: int, min_len: int, max_len: int) -> int:
    return sum(charset_len ** i for i in range(min_len, max_len + 1))


def count_already_generated(charset: list[str], min_len: int, starting: str) -> int:
    base = len(charset)
    count = sum(base ** length for length in range(min_len, len(starting)))
    for i, c in enumerate(reversed(starting)):
        count += charset.index(c) * (base ** i)
    return count + 1


def gen_passwords(charset: list[str], min_len: int, max_len: int, starting: Optional[str]) -> Iterator[bytes]:
    if starting is None:
        password = [charset[0]] * min_len
        total = password_count(len(charset), min_len, max_len)
    else:
        password = list(starting)
        total = password_count(len(charset), min_len, max_len) - count_already_generated(charset, min_len, starting)
    generated = 0
    lookup = {c: i for i, c in enumerate(charset)}
    while len(password) <= max_len and generated < total:
        yield "".join(password).encode()
        generated += 1
        if generated == total:
            break
        carry = True
        for pos in range(len(password) - 1, -1, -1):
            if not carry:
                break
            idx = lookup[password[pos]]
            if idx < len(charset) - 1:
                password[pos] = charset[idx + 1]
                carry = False
            else:
                password[pos] = charset[0]
        if carry:
            password = [charset[0]] * (len(password) + 1)


def dictionary_passwords(path: str) -> Iterator[bytes]:
    with open(path, "rb") as f:
        for line in f:
            if line.endswith(b"\n"):
                line = line[:-1]
                if line.endswith(b"\r"):
                    line = line[:-1]
            yield line


def mask_passwords(positions: list[list[str]]) -> Iterator[bytes]:
    indices = [0] * len(positions)
    total = 1
    for pos in positions:
        total *= len(pos)
    for _ in range(total):
        yield "".join(positions[i][indices[i]] for i in range(len(indices))).encode()
        carry = True
        for i in range(len(indices) - 1, -1, -1):
            if carry:
                indices[i] += 1
                if indices[i] >= len(positions[i]):
                    indices[i] = 0
                else:
                    carry = False


def aes_strength(info: zipfile.ZipInfo) -> int:
    extra = info.extra
    i = 0
    while i + 4 <= len(extra):
        header_id = int.from_bytes(extra[i:i + 2], "little")
        size = int.from_bytes(extra[i + 2:i + 4], "little")
        data = extra[i + 4:i + 4 + size]
        if header_id == 0x9901 and len(data) >= 5:
            return data[4]
        i += 4 + size
    return 0


def aes_target(path: str, info: zipfile.ZipInfo) -> Target:
    strength = aes_strength(info)
    key_lengths = {1: 16, 2: 24, 3: 32}
    salt_lengths = {1: 8, 2: 12, 3: 16}
    key_len = key_lengths.get(strength, 0)
    salt_len = salt_lengths.get(strength, 0)
    if key_len == 0:
        return Target(info)
    with open(path, "rb") as f:
        f.seek(info.header_offset)
        header = f.read(30)
        if len(header) < 30 or header[:4] != b"PK\x03\x04":
            return Target(info)
        name_len = int.from_bytes(header[26:28], "little")
        extra_len = int.from_bytes(header[28:30], "little")
        f.seek(name_len + extra_len, os.SEEK_CUR)
        salt = f.read(salt_len)
        verifier = f.read(2)
    return Target(info, key_len, salt, verifier)


def selected_zip_info(path: str, file_number: int) -> Target:
    try:
        zf = zipfile.ZipFile(path)
    except Exception as e:
        raise InvalidZipError(str(e))
    with zf:
        infos = zf.infolist()
        def encrypted(idx: int) -> bool:
            return 0 <= idx < len(infos) and bool(infos[idx].flag_bits & 0x1)
        if encrypted(file_number):
            return aes_target(path, infos[file_number])
        for idx, info in enumerate(infos):
            if info.flag_bits & 0x1:
                name = info.filename
                sys.stderr.write(f"File at index {file_number} is not encrypted, auto-selecting file at index {idx} ({name})\n")
                return aes_target(path, info)
        listing = f"Archive contents ({len(infos)} files):"
        for idx, info in enumerate(infos[:20]):
            kind = "dir" if info.filename.endswith("/") else "file"
            enc = ", encrypted" if info.flag_bits & 0x1 else ""
            listing += f"\n  [{idx}] {info.filename} ({kind}{enc})"
        if len(infos) > 20:
            listing += f"\n  ... and {len(infos) - 20} more files"
        raise InvalidZipError(f"no encrypted file found in archive\n{listing}")


def check_password(path: str, target: Target, password: bytes) -> bool:
    info = target.info
    if target.aes_key_length:
        derived = __import__("hashlib").pbkdf2_hmac(
            "sha1",
            password,
            target.aes_salt,
            1000,
            2 * target.aes_key_length + 2,
        )
        return derived[-2:] == target.aes_verifier
    try:
        with zipfile.ZipFile(path) as zf:
            with zf.open(info, "r", pwd=password) as f:
                data = f.read()
        return len(data) == info.file_size
    except Exception:
        return False


def humantime(seconds: float) -> str:
    ns = max(0, int(seconds * 1_000_000_000))
    if ns >= 1_000_000_000:
        whole = ns // 1_000_000_000
        rem = ns % 1_000_000_000
        ms = rem // 1_000_000
        us = (rem % 1_000_000) // 1_000
        if us:
            return f"{whole}s {ms}ms {us}us"
        if ms:
            return f"{whole}s {ms}ms"
        return f"{whole}s"
    if ns >= 1_000_000:
        ms = ns // 1_000_000
        us = (ns % 1_000_000) // 1_000
        rem_ns = ns % 1_000
        if rem_ns:
            return f"{ms}ms {us}us {rem_ns}ns"
        if us:
            return f"{ms}ms {us}us"
        return f"{ms}ms"
    if ns >= 1_000:
        us = ns // 1_000
        rem_ns = ns % 1_000
        if rem_ns:
            return f"{us}us {rem_ns}ns"
        return f"{us}us"
    return f"{ns}ns"


def run(argv: list[str]) -> int:
    try:
        args = parse_args(argv)
        start = time.perf_counter()
        info = selected_zip_info(args.input_file, args.file_number)
        if args.password_dictionary is not None:
            candidates = dictionary_passwords(args.password_dictionary)
        elif args.mask is not None:
            candidates = mask_passwords(parse_mask(args.mask, args.custom_charsets))
        else:
            charset = charset_from_args(args)
            candidates = gen_passwords(charset, args.min_password_len, args.max_password_len, args.starting_password)

        found: Optional[bytes] = None
        for candidate in candidates:
            if check_password(args.input_file, info, candidate):
                found = candidate
                break

        sys.stdout.write(f"Time elapsed: {humantime(time.perf_counter() - start)}\n")
        if found is None:
            sys.stdout.write("Password not found\n")
        else:
            sys.stdout.write(f"Password found:{found.decode('utf-8', errors='replace')}\n")
        return 0
    except SystemExit as e:
        return int(e.code)
    except FinderError as e:
        sys.stderr.write(f"{e}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1:]))
