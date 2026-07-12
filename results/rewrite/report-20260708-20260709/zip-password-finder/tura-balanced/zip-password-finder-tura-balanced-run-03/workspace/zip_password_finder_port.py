#!/usr/bin/env python3
import os
import sys
import time
import hashlib
import struct
import zipfile
from concurrent.futures import ThreadPoolExecutor, FIRST_COMPLETED, wait


LOWER = list("abcdefghijklmnopqrstuvwxyz")
UPPER = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = list("0123456789")
SYMBOLS = list(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
LOWER_HEX = list("0123456789abcdef")
UPPER_HEX = list("0123456789ABCDEF")
BINARY_NAME = "zip-password-finder.exe"


class CliError(Exception):
    pass


class InvalidZipError(Exception):
    pass


def usage(binary_name: str) -> str:
    return f"Usage: {binary_name} [OPTIONS] --inputFile <inputFile>"


def help_text(binary_name: str) -> str:
    return f"""Find the password of protected ZIP files

{usage(binary_name)}

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


def short_help_text(binary_name: str) -> str:
    return f"""Find the password of protected ZIP files

{usage(binary_name)}

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


def parse_usize(value: str, name: str) -> int:
    try:
        if value.startswith("-"):
            raise ValueError
        return int(value, 10)
    except ValueError as exc:
        raise SystemExit(clap_value_error(name, value)) from exc


def clap_value_error(name: str, value: str) -> tuple[int, str]:
    return 2, f"error: invalid value '{value}' for '--{name} <{name}>': invalid digit found in string\n\nFor more information, try '--help'.\n"


def parse_args(argv: list[str]) -> dict[str, object]:
    opts: dict[str, object] = {
        "charset": "lud",
        "minPasswordLen": 1,
        "maxPasswordLen": 10,
        "fileNumber": 0,
        "customCharset1": None,
        "customCharset2": None,
        "customCharset3": None,
        "customCharset4": None,
    }
    aliases = {
        "-i": "inputFile", "--inputFile": "inputFile",
        "-w": "workers", "--workers": "workers",
        "-p": "passwordDictionary", "--passwordDictionary": "passwordDictionary",
        "-c": "charset", "--charset": "charset",
        "--charsetFile": "charsetFile",
        "--minPasswordLen": "minPasswordLen",
        "--maxPasswordLen": "maxPasswordLen",
        "--fileNumber": "fileNumber",
        "-s": "startingPassword", "--startingPassword": "startingPassword",
        "-m": "mask", "--mask": "mask",
        "-1": "customCharset1", "--customCharset1": "customCharset1",
        "-2": "customCharset2", "--customCharset2": "customCharset2",
        "-3": "customCharset3", "--customCharset3": "customCharset3",
        "-4": "customCharset4", "--customCharset4": "customCharset4",
    }
    numeric = {"workers", "minPasswordLen", "maxPasswordLen", "fileNumber"}
    i = 0
    while i < len(argv):
        token = argv[i]
        if token == "-h":
            print(short_help_text(BINARY_NAME), end="")
            raise SystemExit(0)
        if token == "--help":
            print(help_text(BINARY_NAME), end="")
            raise SystemExit(0)
        if token in ("-V", "--version"):
            print("zip-password-finder 0.11.1")
            raise SystemExit(0)
        if token not in aliases:
            sys.stderr.write(f"error: unexpected argument '{token}' found\n\nUsage: {BINARY_NAME} --inputFile <inputFile>\n\nFor more information, try '--help'.\n")
            raise SystemExit(2)
        name = aliases[token]
        if i + 1 >= len(argv) or argv[i + 1].startswith("-") and name in numeric:
            sys.stderr.write(f"error: a value is required for '{token} <{name}>' but none was supplied\n\nFor more information, try '--help'.\n")
            raise SystemExit(2)
        if i + 1 >= len(argv):
            sys.stderr.write(f"error: a value is required for '{token} <{name}>' but none was supplied\n\nFor more information, try '--help'.\n")
            raise SystemExit(2)
        value = argv[i + 1]
        if name in numeric:
            parsed = parse_usize(value, name)
            opts[name] = parsed
        else:
            opts[name] = value
        i += 2

    if "inputFile" not in opts:
        sys.stderr.write(f"error: the following required arguments were not provided:\n  --inputFile <inputFile>\n\nUsage: {BINARY_NAME} --inputFile <inputFile>\n\nFor more information, try '--help'.\n")
        raise SystemExit(2)
    validate_args(opts)
    return opts


def validate_args(opts: dict[str, object]) -> None:
    if not os.path.isfile(str(opts["inputFile"])):
        raise CliError("'inputFile' does not exist")
    dictionary = opts.get("passwordDictionary")
    if dictionary is not None and not os.path.isfile(str(dictionary)):
        raise CliError("'passwordDictionary' does not exist")
    charset_file = opts.get("charsetFile")
    if charset_file is not None and not os.path.isfile(str(charset_file)):
        raise CliError("'charsetFile' does not exist")
    if opts.get("workers") == 0:
        raise CliError("'workers' must be positive")
    if opts["minPasswordLen"] == 0:
        raise CliError("'minPasswordLen' must be positive")
    if opts["maxPasswordLen"] == 0:
        raise CliError("'maxPasswordLen' must be positive")
    if int(opts["minPasswordLen"]) > int(opts["maxPasswordLen"]):
        raise CliError("'maxPasswordLen' must be equal or greater than 'minPasswordLen'")
    mask = opts.get("mask")
    custom = [opts.get(f"customCharset{i}") for i in range(1, 5)]
    parsed_custom = []
    for idx, value in enumerate(custom, 1):
        if value is not None:
            if mask is None:
                raise CliError(f"'--customCharset{idx}' can only be used with --mask")
            parsed_custom.append(parse_custom_charset(str(value)))
        else:
            parsed_custom.append(None)
    opts["parsedCustomCharsets"] = parsed_custom
    if mask is not None and dictionary is not None:
        raise CliError("'mask' cannot be used with a dictionary file")
    starting = opts.get("startingPassword")
    if starting is not None:
        if dictionary is not None:
            raise CliError("'startingPassword' cannot be used with a dictionary file")
        if mask is not None:
            raise CliError("'startingPassword' cannot be used with mask attack")
        charset = charset_from_options(opts)
        if any(ch not in charset for ch in str(starting)):
            raise CliError("'startingPassword' uses characters out of the generation charset")
        if not (int(opts["minPasswordLen"]) <= len(str(starting)) <= int(opts["maxPasswordLen"])):
            raise CliError("'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration")


def preset_to_charset(choice: str) -> list[str]:
    result: list[str] = []
    for symbol in choice:
        if symbol == "l":
            result.extend(LOWER)
        elif symbol == "u":
            result.extend(UPPER)
        elif symbol == "d":
            result.extend(DIGITS)
        elif symbol == "s":
            result.extend(SYMBOLS)
        elif symbol == "h":
            result.extend(LOWER_HEX)
        elif symbol == "H":
            result.extend(UPPER_HEX)
        else:
            raise CliError(f"Unknown charset option '{symbol}'")
    return result


def charset_from_options(opts: dict[str, object]) -> list[str]:
    if opts.get("charsetFile") is not None:
        with open(str(opts["charsetFile"]), "r", encoding="utf-8") as fh:
            chars = list(fh.read())
    else:
        chars = preset_to_charset(str(opts.get("charset", "lud")))
    return sorted(set(chars))


def resolve_builtin(token: str) -> list[str] | None:
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


def parse_custom_charset(definition: str) -> list[str]:
    chars: list[str] = []
    i = 0
    while i < len(definition):
        c = definition[i]
        if c == "?":
            i += 1
            if i >= len(definition):
                raise CliError("Custom charset definition ends with incomplete token '?'")
            token = definition[i]
            if token == "?":
                chars.append("?")
            else:
                builtin = resolve_builtin(token)
                if builtin is None:
                    raise CliError(f"Unknown token '?{token}' in custom charset definition")
                chars.extend(builtin)
        else:
            chars.append(c)
        i += 1
    if not chars:
        raise CliError("Custom charset definition is empty")
    seen: list[str] = []
    for c in chars:
        if c not in seen:
            seen.append(c)
    return seen


def parse_mask(mask: str, custom: list[list[str] | None]) -> list[list[str]]:
    positions: list[list[str]] = []
    i = 0
    while i < len(mask):
        c = mask[i]
        if c == "?":
            i += 1
            if i >= len(mask):
                raise CliError("Mask ends with incomplete token '?'")
            token = mask[i]
            if token == "?":
                positions.append(["?"])
            elif token in "1234":
                idx = int(token) - 1
                if custom[idx] is None:
                    raise CliError(f"Custom charset ?{token} used in mask but --customCharset{token} not provided")
                positions.append(list(custom[idx] or []))
            else:
                builtin = resolve_builtin(token)
                if builtin is None:
                    raise CliError(f"Unknown mask token '?{token}'")
                positions.append(builtin)
        else:
            positions.append([c])
        i += 1
    if not positions:
        raise CliError("Mask pattern is empty")
    return positions


def password_count(charset_len: int, min_len: int, max_len: int) -> int:
    return sum(charset_len ** size for size in range(min_len, max_len + 1))


def generated_before(charset: list[str], min_len: int, starting: str) -> int:
    base = len(charset)
    count = sum(base ** size for size in range(min_len, len(starting)))
    for i, c in enumerate(reversed(starting)):
        count += charset.index(c) * (base ** i)
    return count + 1


def generate_passwords(charset: list[str], min_len: int, max_len: int, starting: str | None):
    current = list(starting) if starting is not None else [charset[0]] * min_len
    total = password_count(len(charset), min_len, max_len)
    if starting is not None:
        total -= generated_before(charset, min_len, starting)
    produced = 0
    while len(current) <= max_len:
        if produced == 0:
            produced += 1
            yield "".join(current)
            continue
        if produced == total:
            return
        carry = True
        for pos in range(len(current) - 1, -1, -1):
            if not carry:
                break
            idx = charset.index(current[pos])
            if idx < len(charset) - 1:
                current[pos] = charset[idx + 1]
                carry = False
            else:
                current[pos] = charset[0]
        if carry:
            current = [charset[0]] * (len(current) + 1)
        produced += 1
        yield "".join(current)


def generate_mask_passwords(positions: list[list[str]]):
    indices = [0] * len(positions)
    total = 1
    for pos in positions:
        total *= len(pos)
    for _ in range(total):
        yield "".join(positions[i][indices[i]] for i in range(len(indices)))
        for i in range(len(indices) - 1, -1, -1):
            indices[i] += 1
            if indices[i] < len(positions[i]):
                break
            indices[i] = 0


def dictionary_passwords(path: str):
    with open(path, "rb") as fh:
        for raw in fh:
            if raw.endswith(b"\n"):
                raw = raw[:-1]
                if raw.endswith(b"\r"):
                    raw = raw[:-1]
            yield raw.decode("utf-8", errors="replace")


def encrypted_index(zf: zipfile.ZipFile, requested: int) -> int:
    infos = zf.infolist()
    if requested < len(infos) and infos[requested].flag_bits & 0x1:
        return requested
    for idx, info in enumerate(infos):
        if info.flag_bits & 0x1:
            if requested < len(infos):
                sys.stderr.write(f"File at index {requested} is not encrypted, auto-selecting file at index {idx} ({info.filename})\n")
            return idx
    listing = f"Archive contents ({len(infos)} files):"
    for idx, info in enumerate(infos[:20]):
        kind = "dir" if info.filename.endswith("/") else "file"
        enc = ", encrypted" if info.flag_bits & 0x1 else ""
        listing += f"\n  [{idx}] {info.filename} ({kind}{enc})"
    if len(infos) > 20:
        listing += f"\n  ... and {len(infos) - 20} more files"
    raise InvalidZipError(f"no encrypted file found in archive\n{listing}")


def aes_password_works(aes_info: tuple[bytes, bytes, int], password: str) -> bool:
    salt, verification, key_len = aes_info
    derived = hashlib.pbkdf2_hmac("sha1", password.encode("utf-8"), salt, 1000, 2 * key_len + 2)
    return derived[-2:] == verification


def password_works(zf: zipfile.ZipFile, info: zipfile.ZipInfo, password: str, aes_info: tuple[bytes, bytes, int] | None) -> bool:
    if aes_info is not None:
        return aes_password_works(aes_info, password)
    try:
        with zf.open(info, "r", pwd=password.encode("utf-8")) as fh:
            while fh.read(1024 * 64):
                pass
        return True
    except (RuntimeError, zipfile.BadZipFile, zlib_error()):
        return False


def zlib_error():
    import zlib
    return zlib.error


def aes_verification_info(zf: zipfile.ZipFile, info: zipfile.ZipInfo) -> tuple[bytes, bytes, int] | None:
    if info.compress_type != 99:
        return None
    extra = info.extra
    strength = None
    pos = 0
    while pos + 4 <= len(extra):
        header_id, size = struct.unpack_from("<HH", extra, pos)
        pos += 4
        data = extra[pos:pos + size]
        pos += size
        if header_id == 0x9901 and len(data) >= 7:
            strength = data[4]
            break
    if strength is None:
        raise InvalidZipError("AES metadata not found")
    key_len_by_strength = {1: 16, 2: 24, 3: 32}
    salt_len_by_strength = {1: 8, 2: 12, 3: 16}
    key_len = key_len_by_strength.get(strength)
    salt_len = salt_len_by_strength.get(strength)
    if key_len is None or salt_len is None:
        raise InvalidZipError("Unsupported AES strength")
    fp = zf.fp
    if fp is None:
        raise InvalidZipError("ZIP file is closed")
    fp.seek(info.header_offset)
    local = fp.read(30)
    if len(local) != 30 or local[:4] != b"PK\x03\x04":
        raise InvalidZipError("Bad local file header")
    name_len, extra_len = struct.unpack_from("<HH", local, 26)
    fp.seek(name_len + extra_len, os.SEEK_CUR)
    salt = fp.read(salt_len)
    verification = fp.read(2)
    if len(salt) != salt_len or len(verification) != 2:
        raise InvalidZipError("Incomplete AES verification data")
    return salt, verification, key_len


def find_password(opts: dict[str, object]) -> str | None:
    try:
        zf = zipfile.ZipFile(str(opts["inputFile"]), "r")
    except FileNotFoundError as exc:
        raise CliError("'inputFile' does not exist") from exc
    except zipfile.BadZipFile as exc:
        raise InvalidZipError(str(exc)) from exc
    with zf:
        idx = encrypted_index(zf, int(opts["fileNumber"]))
        info = zf.infolist()[idx]
        aes_info = aes_verification_info(zf, info)
        if opts.get("passwordDictionary") is not None:
            candidates = dictionary_passwords(str(opts["passwordDictionary"]))
        elif opts.get("mask") is not None:
            candidates = generate_mask_passwords(parse_mask(str(opts["mask"]), opts["parsedCustomCharsets"]))
        else:
            charset = charset_from_options(opts)
            candidates = generate_passwords(charset, int(opts["minPasswordLen"]), int(opts["maxPasswordLen"]), opts.get("startingPassword"))
        if aes_info is not None:
            return find_aes_password(aes_info, candidates, int(opts.get("workers") or (os.cpu_count() or 1)))
        for candidate in candidates:
            if password_works(zf, info, candidate, aes_info):
                return candidate
    return None


def find_aes_password(aes_info: tuple[bytes, bytes, int], candidates, workers: int) -> str | None:
    if workers <= 1:
        for candidate in candidates:
            if aes_password_works(aes_info, candidate):
                return candidate
        return None
    pending = set()
    with ThreadPoolExecutor(max_workers=workers) as executor:
        for candidate in candidates:
            future = executor.submit(aes_password_works, aes_info, candidate)
            future.candidate = candidate  # type: ignore[attr-defined]
            pending.add(future)
            if len(pending) >= workers * 4:
                done, pending = wait(pending, return_when=FIRST_COMPLETED)
                for item in done:
                    if item.result():
                        return item.candidate  # type: ignore[attr-defined]
        while pending:
            done, pending = wait(pending, return_when=FIRST_COMPLETED)
            for item in done:
                if item.result():
                    return item.candidate  # type: ignore[attr-defined]
    return None


def format_elapsed(seconds: float) -> str:
    if seconds < 1:
        ms = int(seconds * 1000)
        us = int((seconds * 1_000_000) % 1000)
        return f"{ms}ms {us}us"
    return f"{seconds:.0f}s"


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        opts = parse_args(argv)
        start = time.perf_counter()
        password = find_password(opts)
        print(f"Time elapsed: {format_elapsed(time.perf_counter() - start)}")
        if password is None:
            print("Password not found")
        else:
            print(f"Password found:{password}")
        return 0
    except SystemExit as exc:
        code = exc.code
        if isinstance(code, tuple):
            status, message = code
            sys.stderr.write(message)
            return int(status)
        return int(code or 0)
    except CliError as exc:
        sys.stderr.write(f"CLI argument error - \"{exc}\"\n")
        return 1
    except InvalidZipError as exc:
        sys.stderr.write(f"Invalid zip file error - {exc}\n")
        return 1
    except OSError as exc:
        sys.stderr.write(f"standard I/O error - {exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
