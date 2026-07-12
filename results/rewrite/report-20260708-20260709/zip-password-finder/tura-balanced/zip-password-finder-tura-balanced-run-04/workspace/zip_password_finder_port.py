import argparse
import hashlib
import os
import struct
import sys
import time
import zipfile
from dataclasses import dataclass
from typing import Iterable, Iterator, Optional


LOWER = list("abcdefghijklmnopqrstuvwxyz")
UPPER = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = list("0123456789")
LOWER_HEX = list("0123456789abcdef")
UPPER_HEX = list("0123456789ABCDEF")
SYMBOLS = list(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")


class FinderError(Exception):
    def __init__(self, kind: str, message: str):
        self.kind = kind
        self.message = message
        super().__init__(message)

    def __str__(self) -> str:
        if self.kind == "cli":
            return f'CLI argument error - "{self.message}"'
        if self.kind == "io":
            return f"standard I/O error - {self.message}"
        if self.kind == "zip":
            return f"Invalid zip file error - {self.message}"
        return self.message


class ClapLikeParser(argparse.ArgumentParser):
    def __init__(self) -> None:
        super().__init__(add_help=False, allow_abbrev=False)
        self.add_argument("-i", "--inputFile")
        self.add_argument("-w", "--workers", type=parse_usize)
        self.add_argument("-p", "--passwordDictionary")
        self.add_argument("-c", "--charset", default="lud")
        self.add_argument("--charsetFile")
        self.add_argument("--minPasswordLen", type=parse_usize, default=1)
        self.add_argument("--maxPasswordLen", type=parse_usize, default=10)
        self.add_argument("--fileNumber", type=parse_usize, default=0)
        self.add_argument("-s", "--startingPassword")
        self.add_argument("-m", "--mask")
        self.add_argument("-1", "--customCharset1")
        self.add_argument("-2", "--customCharset2")
        self.add_argument("-3", "--customCharset3")
        self.add_argument("-4", "--customCharset4")
        self.add_argument("-h", "--help", action="store_true")
        self.add_argument("-V", "--version", action="store_true")

    def error(self, message: str) -> None:
        if "expected one argument" in message:
            opt = message.split(":", 1)[0]
            sys.stderr.write(f"error: a value is required for '{opt}' but none was supplied\n\n")
            sys.stderr.write("For more information, try '--help'.\n")
        elif "invalid parse_usize value" in message:
            opt = message.split(":", 1)[0]
            val = message.rsplit(":", 1)[-1].strip().strip("'")
            sys.stderr.write(
                f"error: invalid value '{val}' for '{opt}': invalid digit found in string\n\n"
            )
            sys.stderr.write("For more information, try '--help'.\n")
        elif "unrecognized arguments:" in message:
            arg = message.split(":", 1)[1].strip().split()[0]
            sys.stderr.write(f"error: unexpected argument '{arg}' found\n\n")
            sys.stderr.write("Usage: zip-password-finder.exe [OPTIONS] --inputFile <inputFile>\n\n")
            sys.stderr.write("For more information, try '--help'.\n")
        else:
            sys.stderr.write(f"error: {message}\n")
        raise SystemExit(2)


@dataclass
class Args:
    input_file: str
    workers: int
    charset: str
    charset_file: Optional[str]
    min_len: int
    max_len: int
    file_number: int
    password_dictionary: Optional[str]
    starting_password: Optional[str]
    mask: Optional[str]
    custom_charsets: list[Optional[list[str]]]


def parse_usize(value: str) -> int:
    if value.startswith("-"):
        raise argparse.ArgumentTypeError(value)
    try:
        return int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(value) from exc


def print_help() -> None:
    sys.stdout.write(
        "Find the password of protected ZIP files\n\n"
        "Usage: zip-password-finder.exe [OPTIONS] --inputFile <inputFile>\n\n"
        "Options:\n"
        "  -i, --inputFile <inputFile>\n          path to zip input file\n"
        "  -w, --workers <workers>\n          number of workers\n"
        "  -p, --passwordDictionary <passwordDictionary>\n          path to a password dictionary file\n"
        "  -c, --charset <charset>\n          charset to use to generate password [default: lud]\n"
        "      --charsetFile <charsetFile>\n          path to a charset file\n"
        "      --minPasswordLen <minPasswordLen>\n          minimum password length [default: 1]\n"
        "      --maxPasswordLen <maxPasswordLen>\n          maximum password length [default: 10]\n"
        "      --fileNumber <fileNumber>\n          file number in the zip archive [default: 0]\n"
        "  -s, --startingPassword <startingPassword>\n          password to start from\n"
        "  -m, --mask <mask>\n          mask pattern for mask attack (e.g. '?l?l?l?d?d')\n"
        "  -1, --customCharset1 <customCharset1>\n          custom charset 1 for mask attack, referenced as ?1 (e.g. 'aeiou' or '?l?d')\n"
        "  -2, --customCharset2 <customCharset2>\n          custom charset 2 for mask attack, referenced as ?2\n"
        "  -3, --customCharset3 <customCharset3>\n          custom charset 3 for mask attack, referenced as ?3\n"
        "  -4, --customCharset4 <customCharset4>\n          custom charset 4 for mask attack, referenced as ?4\n"
        "  -h, --help\n          Print help (see more with '--help')\n"
        "  -V, --version\n          Print version\n"
    )


def parse_args(argv: list[str]) -> Args:
    parser = ClapLikeParser()
    ns = parser.parse_args(argv)
    if ns.help:
        print_help()
        raise SystemExit(0)
    if ns.version:
        sys.stdout.write("zip-password-finder 0.11.1\n")
        raise SystemExit(0)
    if ns.inputFile is None:
        sys.stderr.write(
            "error: the following required arguments were not provided:\n"
            "  --inputFile <inputFile>\n\n"
            "Usage: zip-password-finder.exe --inputFile <inputFile>\n\n"
            "For more information, try '--help'.\n"
        )
        raise SystemExit(2)
    if not os.path.isfile(ns.inputFile):
        raise FinderError("cli", "'inputFile' does not exist")
    if ns.passwordDictionary is not None and not os.path.isfile(ns.passwordDictionary):
        raise FinderError("cli", "'passwordDictionary' does not exist")
    if ns.charsetFile is not None and not os.path.isfile(ns.charsetFile):
        raise FinderError("cli", "'charsetFile' does not exist")
    if ns.workers == 0:
        raise FinderError("cli", "'workers' must be positive")
    if ns.minPasswordLen == 0:
        raise FinderError("cli", "'minPasswordLen' must be positive")
    if ns.maxPasswordLen == 0:
        raise FinderError("cli", "'maxPasswordLen' must be positive")
    if ns.minPasswordLen > ns.maxPasswordLen:
        raise FinderError("cli", "'maxPasswordLen' must be equal or greater than 'minPasswordLen'")

    custom_values = [ns.customCharset1, ns.customCharset2, ns.customCharset3, ns.customCharset4]
    custom_charsets: list[Optional[list[str]]] = [None, None, None, None]
    for idx, value in enumerate(custom_values):
        name = f"customCharset{idx + 1}"
        if value is not None:
            if ns.mask is None:
                raise FinderError("cli", f"'--{name}' can only be used with --mask")
            custom_charsets[idx] = parse_custom_charset(value)

    if ns.mask is not None and ns.passwordDictionary is not None:
        raise FinderError("cli", "'mask' cannot be used with a dictionary file")
    if ns.startingPassword is not None:
        if ns.passwordDictionary is not None:
            raise FinderError("cli", "'startingPassword' cannot be used with a dictionary file")
        if ns.mask is not None:
            raise FinderError("cli", "'startingPassword' cannot be used with mask attack")
        charset = charset_from_choice(ns.charset, ns.charsetFile)
        if any(ch not in charset for ch in ns.startingPassword):
            raise FinderError("cli", "'startingPassword' uses characters out of the generation charset")
        if len(ns.startingPassword) > ns.maxPasswordLen or len(ns.startingPassword) < ns.minPasswordLen:
            raise FinderError(
                "cli",
                "'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration",
            )

    return Args(
        ns.inputFile,
        ns.workers or max(1, os.cpu_count() or 1),
        ns.charset,
        ns.charsetFile,
        ns.minPasswordLen,
        ns.maxPasswordLen,
        ns.fileNumber,
        ns.passwordDictionary,
        ns.startingPassword,
        ns.mask,
        custom_charsets,
    )


def preset_to_charset(choice: str) -> list[str]:
    out: list[str] = []
    for symbol in choice:
        if symbol == "l":
            out.extend(LOWER)
        elif symbol == "u":
            out.extend(UPPER)
        elif symbol == "d":
            out.extend(DIGITS)
        elif symbol == "s":
            out.extend(SYMBOLS)
        elif symbol == "h":
            out.extend(LOWER_HEX)
        elif symbol == "H":
            out.extend(UPPER_HEX)
        else:
            raise FinderError("cli", f"Unknown charset option '{symbol}'")
    return out


def charset_from_choice(choice: str, charset_file: Optional[str]) -> list[str]:
    if charset_file is not None:
        try:
            with open(charset_file, "r", encoding="utf-8") as fh:
                chars = list(fh.read())
        except OSError as exc:
            raise FinderError("io", str(exc)) from exc
    else:
        chars = preset_to_charset(choice)
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
                raise FinderError("cli", "Custom charset definition ends with incomplete token '?'")
            token = definition[i]
            if token == "?":
                charset.append("?")
            else:
                builtin = resolve_builtin_token(token)
                if builtin is None:
                    raise FinderError("cli", f"Unknown token '?{token}' in custom charset definition")
                charset.extend(builtin)
        else:
            charset.append(c)
        i += 1
    if not charset:
        raise FinderError("cli", "Custom charset definition is empty")
    seen: list[str] = []
    for c in charset:
        if c not in seen:
            seen.append(c)
    return seen


def parse_mask(mask: str, custom_charsets: list[Optional[list[str]]]) -> list[list[str]]:
    positions: list[list[str]] = []
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
                charset = custom_charsets[idx]
                if charset is None:
                    raise FinderError(
                        "cli",
                        f"Custom charset ?{token} used in mask but --customCharset{token} not provided",
                    )
                positions.append(charset.copy())
            else:
                builtin = resolve_builtin_token(token)
                if builtin is None:
                    raise FinderError("cli", f"Unknown mask token '?{token}'")
                positions.append(builtin)
        else:
            positions.append([c])
        i += 1
    if not positions:
        raise FinderError("cli", "Mask pattern is empty")
    return positions


def password_generator(charset: list[str], min_len: int, max_len: int, start: Optional[str]) -> Iterator[bytes]:
    if not charset:
        return
    current = list(start) if start is not None else [charset[0]] * min_len
    lookup = {c: i for i, c in enumerate(charset)}
    first = True
    while len(current) <= max_len:
        if first:
            first = False
        else:
            carry = True
            for i in range(len(current) - 1, -1, -1):
                if not carry:
                    break
                idx = lookup[current[i]]
                if idx < len(charset) - 1:
                    current[i] = charset[idx + 1]
                    carry = False
                else:
                    current[i] = charset[0]
            if carry:
                current = [charset[0]] * (len(current) + 1)
                if len(current) > max_len:
                    break
        yield "".join(current).encode("utf-8", errors="replace")


def mask_generator(positions: list[list[str]]) -> Iterator[bytes]:
    indices = [0] * len(positions)
    total = 1
    for p in positions:
        total *= len(p)
    for generated in range(total):
        yield "".join(positions[pos][idx] for pos, idx in enumerate(indices)).encode(
            "utf-8", errors="replace"
        )
        if generated == total - 1:
            break
        carry = True
        for i in range(len(indices) - 1, -1, -1):
            if carry:
                indices[i] += 1
                if indices[i] >= len(positions[i]):
                    indices[i] = 0
                else:
                    carry = False


def dictionary_generator(path: str) -> Iterator[bytes]:
    with open(path, "rb") as fh:
        for line in fh:
            if line.endswith(b"\n"):
                line = line[:-1]
                if line.endswith(b"\r"):
                    line = line[:-1]
            yield line


def is_encrypted(info: zipfile.ZipInfo) -> bool:
    return bool(info.flag_bits & 1)


def validate_zip(path: str, file_number: int) -> tuple[int, zipfile.ZipInfo]:
    try:
        archive = zipfile.ZipFile(path)
    except FileNotFoundError as exc:
        raise FinderError("io", str(exc)) from exc
    except (zipfile.BadZipFile, OSError) as exc:
        raise FinderError("zip", str(exc)) from exc
    infos = archive.infolist()
    archive.close()
    selected = infos[file_number] if 0 <= file_number < len(infos) else None
    if selected is not None and is_encrypted(selected):
        return file_number, selected
    for idx, info in enumerate(infos):
        if is_encrypted(info):
            sys.stderr.write(
                f"File at index {file_number} is not encrypted, auto-selecting file at index {idx} ({info.filename})\n"
            )
            return idx, info
    listing = f"Archive contents ({len(infos)} files):"
    for idx, info in enumerate(infos[:20]):
        kind = "dir" if info.filename.endswith("/") else "file"
        enc = ", encrypted" if is_encrypted(info) else ""
        listing += f"\n  [{idx}] {info.filename} ({kind}{enc})"
    if len(infos) > 20:
        listing += f"\n  ... and {len(infos) - 20} more files"
    raise FinderError("zip", f"no encrypted file found in archive\n{listing}")


def password_matches(zip_path: str, file_number: int, password: bytes) -> bool:
    try:
        with zipfile.ZipFile(zip_path) as archive:
            info = archive.infolist()[file_number]
            if info.compress_type == 99:
                return aes_password_verifier_matches(zip_path, info, password)
            with archive.open(info, "r", pwd=password) as fh:
                while fh.read(65536):
                    pass
        return True
    except Exception:
        return False


def aes_password_verifier_matches(zip_path: str, info: zipfile.ZipInfo, password: bytes) -> bool:
    strength = aes_strength(info.extra)
    if strength is None:
        return False
    key_len = {1: 16, 2: 24, 3: 32}.get(strength)
    salt_len = {1: 8, 2: 12, 3: 16}.get(strength)
    if key_len is None or salt_len is None:
        return False
    data_offset = local_file_data_offset(zip_path, info.header_offset)
    with open(zip_path, "rb") as fh:
        fh.seek(data_offset)
        salt = fh.read(salt_len)
        verifier = fh.read(2)
    derived = hashlib.pbkdf2_hmac("sha1", password, salt, 1000, 2 * key_len + 2)
    return derived[-2:] == verifier


def aes_strength(extra: bytes) -> Optional[int]:
    offset = 0
    while offset + 4 <= len(extra):
        header_id, size = struct.unpack_from("<HH", extra, offset)
        offset += 4
        data = extra[offset : offset + size]
        offset += size
        if header_id == 0x9901 and len(data) >= 7:
            return data[4]
    return None


def local_file_data_offset(zip_path: str, header_offset: int) -> int:
    with open(zip_path, "rb") as fh:
        fh.seek(header_offset)
        header = fh.read(30)
    if len(header) != 30 or header[:4] != b"PK\x03\x04":
        raise FinderError("zip", "invalid Zip archive")
    name_len, extra_len = struct.unpack_from("<HH", header, 26)
    return header_offset + 30 + name_len + extra_len


def find_password(args: Args) -> Optional[str]:
    file_number, _ = validate_zip(args.input_file, args.file_number)
    if args.password_dictionary is not None:
        candidates: Iterable[bytes] = dictionary_generator(args.password_dictionary)
    elif args.mask is not None:
        candidates = mask_generator(parse_mask(args.mask, args.custom_charsets))
    else:
        charset = charset_from_choice(args.charset, args.charset_file)
        candidates = password_generator(charset, args.min_len, args.max_len, args.starting_password)
    for password in candidates:
        if password_matches(args.input_file, file_number, password):
            return password.decode("utf-8", errors="replace")
    return None


def format_elapsed(seconds: float) -> str:
    ms = int(seconds * 1000)
    if ms > 0:
        return f"{ms}ms"
    us = int(seconds * 1_000_000)
    if us > 0:
        return f"{us}us"
    return "0ns"


def main(argv: Optional[list[str]] = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    try:
        args = parse_args(argv)
        started = time.perf_counter()
        password = find_password(args)
        sys.stdout.write(f"Time elapsed: {format_elapsed(time.perf_counter() - started)}\n")
        if password is None:
            sys.stdout.write("Password not found\n")
        else:
            sys.stdout.write(f"Password found:{password}\n")
        return 0
    except SystemExit as exc:
        return int(exc.code or 0)
    except FinderError as exc:
        sys.stderr.write(f"{exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
