#!/usr/bin/env python3
import os
import sys
import time
import struct
import zipfile
import hashlib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from itertools import product


LOWER = list("abcdefghijklmnopqrstuvwxyz")
UPPER = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = list("0123456789")
SYMBOLS = list(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
LOWER_HEX = list("0123456789abcdef")
UPPER_HEX = list("0123456789ABCDEF")


class FinderError(Exception):
    pass


class CliArgumentError(FinderError):
    def __str__(self):
        return f'CLI argument error - "{self.args[0]}"'


class InvalidZipError(FinderError):
    def __str__(self):
        return f"Invalid zip file error - {self.args[0]}"


@dataclass
class Args:
    input_file: str
    workers: int | None
    password_dictionary: str | None
    charset: str
    charset_file: str | None
    min_password_len: int
    max_password_len: int
    file_number: int
    starting_password: str | None
    mask: str | None
    custom_charsets: list[list[str] | None]


def eprint(text: str) -> None:
    print(text, file=sys.stderr)


def clap_value_error(flag: str, value: str, typ: str = "usize") -> int:
    eprint(f"error: invalid value '{value}' for '{flag} <{flag.lstrip('-')}>': invalid digit found in string")
    eprint("")
    eprint(f"For more information, try '--help'.")
    return 2


def print_help(long: bool) -> None:
    exe = os.path.basename(sys.argv[0]) or "zip-password-finder.exe"
    print("Find the password of protected ZIP files")
    print("")
    print(f"Usage: {exe} [OPTIONS] --inputFile <inputFile>")
    print("")
    print("Options:")
    lines = [
        ("  -i, --inputFile <inputFile>", "path to zip input file", None),
        ("  -w, --workers <workers>", "number of workers", None),
        ("  -p, --passwordDictionary <passwordDictionary>", "path to a password dictionary file", None),
        ("  -c, --charset <charset>", "charset to use to generate password", "[default: lud]"),
        ("      --charsetFile <charsetFile>", "path to a charset file", None),
        ("      --minPasswordLen <minPasswordLen>", "minimum password length", "[default: 1]"),
        ("      --maxPasswordLen <maxPasswordLen>", "maximum password length", "[default: 10]"),
        ("      --fileNumber <fileNumber>", "file number in the zip archive", "[default: 0]"),
        ("  -s, --startingPassword <startingPassword>", "password to start from", None),
        ("  -m, --mask <mask>", "mask pattern for mask attack (e.g. '?l?l?l?d?d' for 3 lowercase + 2 digits).", None),
        ("  -1, --customCharset1 <customCharset1>", "custom charset 1 for mask attack, referenced as ?1 (e.g. 'aeiou' or '?l?d')", None),
        ("  -2, --customCharset2 <customCharset2>", "custom charset 2 for mask attack, referenced as ?2", None),
        ("  -3, --customCharset3 <customCharset3>", "custom charset 3 for mask attack, referenced as ?3", None),
        ("  -4, --customCharset4 <customCharset4>", "custom charset 4 for mask attack, referenced as ?4", None),
        ("  -h, --help", "Print help (see a summary with '-h')", None),
        ("  -V, --version", "Print version", None),
    ]
    if not long:
        for opt, desc, default in lines:
            text = f"{opt:<48} {desc}"
            if default:
                text += f" {default}"
            print(text)
        return
    for opt, desc, default in lines:
        print(f"{opt}")
        print(f"          {desc}")
        if opt.startswith("  -m"):
            print("          ")
            print("          Available tokens:")
            print("            ?l  lowercase letters [a-z]")
            print("            ?u  uppercase letters [A-Z]")
            print("            ?d  digits [0-9]")
            print("            ?s  symbols")
            print("            ?a  all printable (?l?u?d?s)")
            print("            ?h  lowercase hex [0-9a-f]")
            print("            ?H  uppercase hex [0-9A-F]")
            print("            ?1  custom charset 1 (--customCharset1)")
            print("            ?2  custom charset 2 (--customCharset2)")
            print("            ?3  custom charset 3 (--customCharset3)")
            print("            ?4  custom charset 4 (--customCharset4)")
            print("            ??  literal '?'")
            print("          ")
            print("          Any other character is treated as a literal.")
        if default:
            print("          ")
            print(f"          {default}")
        print("")


def parse_usize(name: str, value: str) -> int:
    if value.startswith("-") or not value.isdecimal():
        raise ValueError(name)
    return int(value)


def parse_args(argv: list[str]) -> Args | int:
    if "--help" in argv:
        print_help(True)
        return 0
    if "-h" in argv:
        print_help(False)
        return 0
    if "--version" in argv or "-V" in argv:
        print("zip-password-finder 0.11.1")
        return 0
    vals: dict[str, str | None] = {
        "inputFile": None, "workers": None, "passwordDictionary": None,
        "charset": "lud", "charsetFile": None, "minPasswordLen": "1",
        "maxPasswordLen": "10", "fileNumber": "0", "startingPassword": None,
        "mask": None, "customCharset1": None, "customCharset2": None,
        "customCharset3": None, "customCharset4": None,
    }
    flags = {
        "-i": "inputFile", "--inputFile": "inputFile", "-w": "workers", "--workers": "workers",
        "-p": "passwordDictionary", "--passwordDictionary": "passwordDictionary", "-c": "charset", "--charset": "charset",
        "--charsetFile": "charsetFile", "--minPasswordLen": "minPasswordLen", "--maxPasswordLen": "maxPasswordLen",
        "--fileNumber": "fileNumber", "-s": "startingPassword", "--startingPassword": "startingPassword",
        "-m": "mask", "--mask": "mask", "-1": "customCharset1", "--customCharset1": "customCharset1",
        "-2": "customCharset2", "--customCharset2": "customCharset2", "-3": "customCharset3", "--customCharset3": "customCharset3",
        "-4": "customCharset4", "--customCharset4": "customCharset4",
    }
    i = 0
    while i < len(argv):
        raw = argv[i]
        if raw not in flags:
            eprint(f"error: unexpected argument '{raw}' found")
            eprint("")
            eprint("Usage: zip-password-finder.exe [OPTIONS] --inputFile <inputFile>")
            eprint("")
            eprint("For more information, try '--help'.")
            return 2
        if i + 1 >= len(argv):
            eprint(f"error: a value is required for '{raw} <{flags[raw]}>' but none was supplied")
            return 2
        vals[flags[raw]] = argv[i + 1]
        i += 2
    if vals["inputFile"] is None:
        eprint("error: the following required arguments were not provided:")
        eprint("  --inputFile <inputFile>")
        eprint("")
        eprint("Usage: zip-password-finder.exe --inputFile <inputFile>")
        eprint("")
        eprint("For more information, try '--help'.")
        return 2
    try:
        workers = None if vals["workers"] is None else parse_usize("--workers", vals["workers"] or "")
        min_len = parse_usize("--minPasswordLen", vals["minPasswordLen"] or "")
        max_len = parse_usize("--maxPasswordLen", vals["maxPasswordLen"] or "")
        file_num = parse_usize("--fileNumber", vals["fileNumber"] or "")
    except ValueError as exc:
        return clap_value_error(str(exc), "")
    custom = [vals[f"customCharset{i}"] for i in range(1, 5)]
    return Args(vals["inputFile"] or "", workers, vals["passwordDictionary"], vals["charset"] or "", vals["charsetFile"], min_len, max_len, file_num, vals["startingPassword"], vals["mask"], custom)


def builtin(token: str) -> list[str] | None:
    return {"l": LOWER, "u": UPPER, "d": DIGITS, "s": SYMBOLS, "h": LOWER_HEX, "H": UPPER_HEX}.get(token)


def preset_to_charset(choice: str) -> list[str]:
    out: list[str] = []
    for ch in choice:
        b = builtin(ch)
        if b is None:
            raise CliArgumentError(f"Unknown charset option '{ch}'")
        out.extend(b)
    return out


def charset_from_args(args: Args) -> list[str]:
    if args.charset_file:
        if not os.path.isfile(args.charset_file):
            raise CliArgumentError("'charsetFile' does not exist")
        with open(args.charset_file, "r", encoding="utf-8") as f:
            chars = list(f.read())
    else:
        chars = preset_to_charset(args.charset)
    return sorted(set(chars))


def parse_custom_charset(defn: str) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(defn):
        ch = defn[i]
        if ch == "?":
            i += 1
            if i >= len(defn):
                raise CliArgumentError("Custom charset definition ends with incomplete token '?'")
            token = defn[i]
            if token == "?":
                out.append("?")
            else:
                b = builtin(token)
                if b is None:
                    raise CliArgumentError(f"Unknown token '?{token}' in custom charset definition")
                out.extend(b)
        else:
            out.append(ch)
        i += 1
    if not out:
        raise CliArgumentError("Custom charset definition is empty")
    seen: list[str] = []
    for ch in out:
        if ch not in seen:
            seen.append(ch)
    return seen


def parse_mask(mask: str, custom: list[list[str] | None]) -> list[list[str]]:
    positions: list[list[str]] = []
    i = 0
    while i < len(mask):
        ch = mask[i]
        if ch == "?":
            i += 1
            if i >= len(mask):
                raise CliArgumentError("Mask ends with incomplete token '?'")
            token = mask[i]
            if token == "?":
                positions.append(["?"])
            elif token in "1234":
                val = custom[int(token) - 1]
                if val is None:
                    raise CliArgumentError(f"Custom charset ?{token} used in mask but --customCharset{token} not provided")
                positions.append(val)
            else:
                b = builtin(token)
                if token == "a":
                    b = LOWER + UPPER + DIGITS + SYMBOLS
                if b is None:
                    raise CliArgumentError(f"Unknown mask token '?{token}'")
                positions.append(list(b))
        else:
            positions.append([ch])
        i += 1
    if not positions:
        raise CliArgumentError("Mask pattern is empty")
    return positions


def validate_args(args: Args) -> tuple[list[str] | None, list[list[str]] | None]:
    if not os.path.isfile(args.input_file):
        raise CliArgumentError("'inputFile' does not exist")
    if args.password_dictionary and not os.path.isfile(args.password_dictionary):
        raise CliArgumentError("'passwordDictionary' does not exist")
    if args.workers == 0:
        raise CliArgumentError("'workers' must be positive")
    if args.min_password_len == 0:
        raise CliArgumentError("'minPasswordLen' must be positive")
    if args.max_password_len == 0:
        raise CliArgumentError("'maxPasswordLen' must be positive")
    if args.min_password_len > args.max_password_len:
        raise CliArgumentError("'maxPasswordLen' must be equal or greater than 'minPasswordLen'")
    parsed_custom: list[list[str] | None] = [None, None, None, None]
    for i, val in enumerate(args.custom_charsets):
        if val is not None:
            if args.mask is None:
                raise CliArgumentError(f"'--customCharset{i + 1}' can only be used with --mask")
            parsed_custom[i] = parse_custom_charset(val)
    if args.mask and args.password_dictionary:
        raise CliArgumentError("'mask' cannot be used with a dictionary file")
    parsed_mask = parse_mask(args.mask, parsed_custom) if args.mask else None
    charset = None if parsed_mask or args.password_dictionary else charset_from_args(args)
    if args.starting_password:
        if args.password_dictionary:
            raise CliArgumentError("'startingPassword' cannot be used with a dictionary file")
        if args.mask:
            raise CliArgumentError("'startingPassword' cannot be used with mask attack")
        if charset is None:
            charset = charset_from_args(args)
        if any(ch not in charset for ch in args.starting_password):
            raise CliArgumentError("'startingPassword' uses characters out of the generation charset")
        if not (args.min_password_len <= len(args.starting_password) <= args.max_password_len):
            raise CliArgumentError("'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration")
    return charset, parsed_mask


def password_count(charset_len: int, min_len: int, max_len: int) -> int:
    return sum(charset_len ** i for i in range(min_len, max_len + 1))


def passwords_generated(charset: list[str], min_len: int, max_len: int, start: str | None):
    started = start is None
    for length in range(min_len, max_len + 1):
        for combo in product(charset, repeat=length):
            pwd = "".join(combo)
            if not started:
                if pwd == start:
                    started = True
                else:
                    continue
            yield pwd.encode("utf-8", "replace")


def passwords_mask(mask: list[list[str]]):
    for combo in product(*mask):
        yield "".join(combo).encode("utf-8", "replace")


def passwords_dictionary(path: str):
    with open(path, "rb") as f:
        for line in f:
            if line.endswith(b"\n"):
                line = line[:-1]
                if line.endswith(b"\r"):
                    line = line[:-1]
            yield line


def validate_zip(path: str, file_number: int) -> tuple[zipfile.ZipFile, int, str]:
    try:
        zf = zipfile.ZipFile(path)
    except Exception as exc:
        raise InvalidZipError(str(exc))
    infos = zf.infolist()
    def encrypted(i: int) -> bool:
        return 0 <= i < len(infos) and bool(infos[i].flag_bits & 0x1)
    if encrypted(file_number):
        idx = file_number
    else:
        idx = next((i for i in range(len(infos)) if encrypted(i)), None)
        if idx is None:
            listing = f"Archive contents ({len(infos)} files):"
            for i, info in enumerate(infos[:20]):
                kind = "dir" if info.filename.endswith("/") else "file"
                enc = ", encrypted" if encrypted(i) else ""
                listing += f"\n  [{i}] {info.filename} ({kind}{enc})"
            if len(infos) > 20:
                listing += f"\n  ... and {len(infos) - 20} more files"
            raise InvalidZipError(f"no encrypted file found in archive\n{listing}")
        name = infos[idx].filename if idx < len(infos) else "<unknown>"
        eprint(f"File at index {file_number} is not encrypted, auto-selecting file at index {idx} ({name})")
    return zf, idx, infos[idx].filename


def aes_info(path: str, info: zipfile.ZipInfo) -> tuple[bytes, bytes, int] | None:
    extra = info.extra
    pos = 0
    strength = None
    while pos + 4 <= len(extra):
        header_id, size = struct.unpack_from("<HH", extra, pos)
        pos += 4
        body = extra[pos:pos + size]
        pos += size
        if header_id == 0x9901 and len(body) >= 7:
            strength = body[4]
            break
    if strength is None:
        return None
    key_len = {1: 16, 2: 24, 3: 32}.get(strength)
    if key_len is None:
        return None
    salt_len = {16: 8, 24: 12, 32: 16}[key_len]
    with open(path, "rb") as f:
        f.seek(info.header_offset)
        local = f.read(30)
        if len(local) != 30 or local[:4] != b"PK\x03\x04":
            return None
        name_len, extra_len = struct.unpack_from("<HH", local, 26)
        f.seek(name_len + extra_len, os.SEEK_CUR)
        salt = f.read(salt_len)
        verifier = f.read(2)
    if len(salt) != salt_len or len(verifier) != 2:
        return None
    return salt, verifier, key_len


def aes_password_matches(password: bytes, aes: tuple[bytes, bytes, int]) -> bool:
    salt, verifier, key_len = aes
    derived = hashlib.pbkdf2_hmac("sha1", password, salt, 1000, 2 * key_len + 2)
    return derived[-2:] == verifier


def find_password(args: Args, charset: list[str] | None, mask: list[list[str]] | None) -> str | None:
    zf, idx, _name = validate_zip(args.input_file, args.file_number)
    info = zf.infolist()[idx]
    aes = aes_info(args.input_file, info)
    if args.password_dictionary:
        candidates = passwords_dictionary(args.password_dictionary)
    elif mask is not None:
        candidates = passwords_mask(mask)
    else:
        candidates = passwords_generated(charset or [], args.min_password_len, args.max_password_len, args.starting_password)
    if aes is not None:
        workers = max(1, min(os.cpu_count() or 1, 16))
        batch_size = workers * 64
        with ThreadPoolExecutor(max_workers=workers) as pool:
            while True:
                batch = []
                try:
                    for _ in range(batch_size):
                        batch.append(next(candidates))
                except StopIteration:
                    pass
                if not batch:
                    break
                for pwd, matched in zip(batch, pool.map(lambda p: aes_password_matches(p, aes), batch)):
                    if matched:
                        return pwd.decode("utf-8", "replace")
                if len(batch) < batch_size:
                    break
        return None
    for pwd in candidates:
        try:
            with zf.open(info, "r", pwd=pwd) as fh:
                data = fh.read()
            if len(data) == info.file_size:
                return pwd.decode("utf-8", "replace")
        except Exception:
            continue
    return None


def format_duration(seconds: float) -> str:
    ns = int(seconds * 1_000_000_000)
    if ns < 1_000:
        return f"{ns}ns"
    if ns < 1_000_000:
        return f"{ns // 1_000}us"
    if ns < 1_000_000_000:
        ms = ns // 1_000_000
        us = (ns % 1_000_000) // 1_000
        return f"{ms}ms {us}us" if us else f"{ms}ms"
    return f"{seconds:.2f}s"


def main(argv: list[str]) -> int:
    parsed = parse_args(argv)
    if isinstance(parsed, int):
        return parsed
    try:
        charset, mask = validate_args(parsed)
        start = time.perf_counter()
        password = find_password(parsed, charset, mask)
        print(f"Time elapsed: {format_duration(time.perf_counter() - start)}")
        if password is None:
            print("Password not found")
        else:
            print(f"Password found:{password}")
        return 0
    except FinderError as exc:
        eprint(str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
