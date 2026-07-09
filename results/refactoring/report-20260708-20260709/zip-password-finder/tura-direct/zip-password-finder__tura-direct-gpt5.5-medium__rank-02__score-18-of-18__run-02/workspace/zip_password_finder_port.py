#!/usr/bin/env python3
import hashlib
import os
import struct
import sys
import time
import zipfile


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(newline="\n")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(newline="\n")


APP = "zip-password-finder.exe"
VERSION = "zip-password-finder 0.11.1"

LOWER = list("abcdefghijklmnopqrstuvwxyz")
UPPER = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = list("0123456789")
SYMBOLS = list(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
LOWER_HEX = list("0123456789abcdef")
UPPER_HEX = list("0123456789ABCDEF")


FULL_HELP = """Find the password of protected ZIP files

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


class CliArgumentError(Exception):
    pass


class InvalidZipError(Exception):
    pass


def clap_error(message):
    return f"error: {message}\n\nUsage: {APP} [OPTIONS] --inputFile <inputFile>\n\nFor more information, try '--help'.\n"


def required_input_error():
    return (
        "error: the following required arguments were not provided:\n"
        "  --inputFile <inputFile>\n\n"
        f"Usage: {APP} --inputFile <inputFile>\n\n"
        "For more information, try '--help'.\n"
    )


def parse_usize(value, display):
    if not value or any(ch < "0" or ch > "9" for ch in value):
        raise ValueError(
            f"invalid value '{value}' for '{display}': invalid digit found in string"
        )
    return int(value)


def parse_args(argv):
    opts = {
        "inputFile": None,
        "workers": None,
        "passwordDictionary": None,
        "charset": "lud",
        "charsetFile": None,
        "minPasswordLen": 1,
        "maxPasswordLen": 10,
        "fileNumber": 0,
        "startingPassword": None,
        "mask": None,
        "customCharset1": None,
        "customCharset2": None,
        "customCharset3": None,
        "customCharset4": None,
    }
    spec = {
        "-i": ("inputFile", "--inputFile <inputFile>", str),
        "--inputFile": ("inputFile", "--inputFile <inputFile>", str),
        "-w": ("workers", "--workers <workers>", int),
        "--workers": ("workers", "--workers <workers>", int),
        "-p": ("passwordDictionary", "--passwordDictionary <passwordDictionary>", str),
        "--passwordDictionary": ("passwordDictionary", "--passwordDictionary <passwordDictionary>", str),
        "-c": ("charset", "--charset <charset>", str),
        "--charset": ("charset", "--charset <charset>", str),
        "--charsetFile": ("charsetFile", "--charsetFile <charsetFile>", str),
        "--minPasswordLen": ("minPasswordLen", "--minPasswordLen <minPasswordLen>", int),
        "--maxPasswordLen": ("maxPasswordLen", "--maxPasswordLen <maxPasswordLen>", int),
        "--fileNumber": ("fileNumber", "--fileNumber <fileNumber>", int),
        "-s": ("startingPassword", "--startingPassword <startingPassword>", str),
        "--startingPassword": ("startingPassword", "--startingPassword <startingPassword>", str),
        "-m": ("mask", "--mask <mask>", str),
        "--mask": ("mask", "--mask <mask>", str),
        "-1": ("customCharset1", "--customCharset1 <customCharset1>", str),
        "--customCharset1": ("customCharset1", "--customCharset1 <customCharset1>", str),
        "-2": ("customCharset2", "--customCharset2 <customCharset2>", str),
        "--customCharset2": ("customCharset2", "--customCharset2 <customCharset2>", str),
        "-3": ("customCharset3", "--customCharset3 <customCharset3>", str),
        "--customCharset3": ("customCharset3", "--customCharset3 <customCharset3>", str),
        "-4": ("customCharset4", "--customCharset4 <customCharset4>", str),
        "--customCharset4": ("customCharset4", "--customCharset4 <customCharset4>", str),
    }

    if "--help" in argv:
        sys.stdout.write(FULL_HELP)
        raise SystemExit(0)
    if "-h" in argv:
        sys.stdout.write(SHORT_HELP)
        raise SystemExit(0)
    if "--version" in argv or "-V" in argv:
        sys.stdout.write(VERSION + "\n")
        raise SystemExit(0)

    i = 0
    while i < len(argv):
        raw = argv[i]
        if raw.startswith("--") and "=" in raw:
            key, val = raw.split("=", 1)
            argv = argv[:i] + [key, val] + argv[i + 1 :]
            raw = key
        if raw not in spec:
            sys.stderr.write(clap_error(f"unexpected argument '{raw}' found"))
            raise SystemExit(1)
        name, display, kind = spec[raw]
        if i + 1 >= len(argv):
            sys.stderr.write(clap_error(f"a value is required for '{display}' but none was supplied"))
            raise SystemExit(1)
        value = argv[i + 1]
        if kind is int:
            try:
                opts[name] = parse_usize(value, display)
            except ValueError as e:
                sys.stderr.write(f"error: {e}\n\nFor more information, try '--help'.\n")
                raise SystemExit(1)
        else:
            opts[name] = value
        i += 2

    if opts["inputFile"] is None:
        sys.stderr.write(required_input_error())
        raise SystemExit(1)
    validate_args(opts)
    return opts


def validate_args(opts):
    if not os.path.isfile(opts["inputFile"]):
        raise CliArgumentError("'inputFile' does not exist")
    if opts["passwordDictionary"] is not None and not os.path.isfile(opts["passwordDictionary"]):
        raise CliArgumentError("'passwordDictionary' does not exist")
    if opts["charsetFile"] is not None and not os.path.isfile(opts["charsetFile"]):
        raise CliArgumentError("'charsetFile' does not exist")
    if opts["workers"] == 0:
        raise CliArgumentError("'workers' must be positive")
    if opts["minPasswordLen"] == 0:
        raise CliArgumentError("'minPasswordLen' must be positive")
    if opts["maxPasswordLen"] == 0:
        raise CliArgumentError("'maxPasswordLen' must be positive")
    if opts["minPasswordLen"] > opts["maxPasswordLen"]:
        raise CliArgumentError("'maxPasswordLen' must be equal or greater than 'minPasswordLen'")

    custom = [None, None, None, None]
    for idx in range(4):
        key = f"customCharset{idx + 1}"
        if opts[key] is not None:
            if opts["mask"] is None:
                raise CliArgumentError(f"'--{key}' can only be used with --mask")
            custom[idx] = parse_custom_charset(opts[key])
    opts["customCharsets"] = custom

    if opts["mask"] is not None and opts["passwordDictionary"] is not None:
        raise CliArgumentError("'mask' cannot be used with a dictionary file")
    if opts["startingPassword"] is not None:
        if opts["passwordDictionary"] is not None:
            raise CliArgumentError("'startingPassword' cannot be used with a dictionary file")
        if opts["mask"] is not None:
            raise CliArgumentError("'startingPassword' cannot be used with mask attack")
        charset = charset_from_choice(opts)
        if any(c not in charset for c in opts["startingPassword"]):
            raise CliArgumentError("'startingPassword' uses characters out of the generation charset")
        size = len(opts["startingPassword"])
        if size > opts["maxPasswordLen"] or size < opts["minPasswordLen"]:
            raise CliArgumentError(
                "'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration"
            )


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


def preset_to_charset(choice):
    chars = []
    for symbol in choice:
        if symbol == "l":
            chars.extend(LOWER)
        elif symbol == "u":
            chars.extend(UPPER)
        elif symbol == "d":
            chars.extend(DIGITS)
        elif symbol == "s":
            chars.extend(SYMBOLS)
        elif symbol == "h":
            chars.extend(LOWER_HEX)
        elif symbol == "H":
            chars.extend(UPPER_HEX)
        else:
            raise CliArgumentError(f"Unknown charset option '{symbol}'")
    return chars


def charset_from_choice(opts):
    if opts.get("charsetFile"):
        with open(opts["charsetFile"], "r", encoding="utf-8") as fh:
            chars = list(fh.read())
    else:
        chars = preset_to_charset(opts["charset"])
    return sorted(set(chars))


def parse_custom_charset(definition):
    chars = []
    i = 0
    while i < len(definition):
        c = definition[i]
        if c == "?":
            i += 1
            if i >= len(definition):
                raise CliArgumentError("Custom charset definition ends with incomplete token '?'")
            token = definition[i]
            if token == "?":
                chars.append("?")
            else:
                builtin = builtin_token(token)
                if builtin is None:
                    raise CliArgumentError(f"Unknown token '?{token}' in custom charset definition")
                chars.extend(builtin)
        else:
            chars.append(c)
        i += 1
    if not chars:
        raise CliArgumentError("Custom charset definition is empty")
    seen = []
    for c in chars:
        if c not in seen:
            seen.append(c)
    return seen


def parse_mask(mask, custom):
    if mask == "":
        raise CliArgumentError("Mask cannot be empty")
    positions = []
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
                    raise CliArgumentError(
                        f"Custom charset ?{token} used in mask but --customCharset{token} not provided"
                    )
                positions.append(custom[idx])
            else:
                builtin = builtin_token(token)
                if builtin is None:
                    raise CliArgumentError(f"Unknown mask token '?{token}'")
                positions.append(builtin)
        else:
            positions.append([c])
        i += 1
    return positions


def mask_passwords(positions):
    if not positions:
        return
    idx = [0] * len(positions)
    while True:
        yield "".join(positions[pos][idx[pos]] for pos in range(len(positions))).encode("utf-8")
        carry = True
        for pos in range(len(positions) - 1, -1, -1):
            if not carry:
                break
            idx[pos] += 1
            if idx[pos] == len(positions[pos]):
                idx[pos] = 0
            else:
                carry = False
        if carry:
            break


def password_count_already_generated(charset, min_len, starting):
    base = len(charset)
    count = 0
    for size in range(min_len, len(starting)):
        count += base ** size
    for power, c in enumerate(reversed(starting)):
        count += charset.index(c) * (base ** power)
    return count + 1


def generated_passwords(charset, min_len, max_len, starting=None):
    if not charset:
        return
    password = list(starting) if starting is not None else [charset[0]] * min_len
    while len(password) <= max_len:
        yield "".join(password).encode("utf-8")
        carry = True
        for i in range(len(password) - 1, -1, -1):
            if not carry:
                break
            idx = charset.index(password[i])
            if idx < len(charset) - 1:
                password[i] = charset[idx + 1]
                carry = False
            else:
                password[i] = charset[0]
        if carry:
            password = [charset[0]] * (len(password) + 1)


def dictionary_passwords(path):
    with open(path, "rb") as fh:
        for line in fh:
            if line.endswith(b"\n"):
                line = line[:-1]
                if line.endswith(b"\r"):
                    line = line[:-1]
            yield line


def is_encrypted(info):
    return bool(info.flag_bits & 1)


def archive_listing(zf):
    infos = zf.infolist()
    out = [f"Archive contents ({len(infos)} files):"]
    for i, info in enumerate(infos[:20]):
        kind = "dir" if info.filename.endswith("/") else "file"
        enc = ", encrypted" if is_encrypted(info) else ""
        out.append(f"  [{i}] {info.filename} ({kind}{enc})")
    if len(infos) > 20:
        out.append(f"  ... and {len(infos) - 20} more files")
    return "\n".join(out)


def aes_strength(info):
    extra = info.extra
    pos = 0
    while pos + 4 <= len(extra):
        header_id, size = struct.unpack_from("<HH", extra, pos)
        data = extra[pos + 4 : pos + 4 + size]
        if header_id == 0x9901 and len(data) >= 7:
            strength = data[4]
            if strength == 1:
                return 16
            if strength == 2:
                return 24
            if strength == 3:
                return 32
        pos += 4 + size
    return None


def aes_salt_and_verifier(zf, info):
    key_len = aes_strength(info)
    if key_len is None:
        return None
    salt_len = {16: 8, 24: 12, 32: 16}[key_len]
    with open(zf.filename, "rb") as fh:
        fh.seek(info.header_offset)
        header = fh.read(30)
        if len(header) != 30 or header[:4] != b"PK\x03\x04":
            return None
        name_len, extra_len = struct.unpack_from("<HH", header, 26)
        fh.seek(name_len + extra_len, os.SEEK_CUR)
        data = fh.read(salt_len + 2)
    if len(data) != salt_len + 2:
        return None
    return key_len, data[:salt_len], data[salt_len:]


def validate_zip(path, file_number):
    try:
        zf = zipfile.ZipFile(path)
    except Exception as e:
        raise InvalidZipError(str(e))
    infos = zf.infolist()
    target = file_number if 0 <= file_number < len(infos) and is_encrypted(infos[file_number]) else None
    if target is None:
        for idx, info in enumerate(infos):
            if is_encrypted(info):
                target = idx
                if file_number != idx:
                    sys.stderr.write(
                        f"File at index {file_number} is not encrypted, auto-selecting file at index {idx} ({info.filename})\n"
                    )
                break
    if target is None:
        try:
            listing = archive_listing(zf)
        finally:
            zf.close()
        raise InvalidZipError(f"no encrypted file found in archive\n{listing}")
    return zf, target, aes_salt_and_verifier(zf, infos[target])


def check_password(zf, file_number, aes_info, password):
    if aes_info is not None:
        key_len, salt, verifier = aes_info
        derived = hashlib.pbkdf2_hmac("sha1", password, salt, 1000, 2 * key_len + 2)
        return derived[-2:] == verifier
    try:
        with zf.open(zf.infolist()[file_number], "r", pwd=password) as fh:
            while fh.read(65536):
                pass
        return True
    except Exception:
        return False


def find_password(opts):
    zf, file_number, aes_info = validate_zip(opts["inputFile"], opts["fileNumber"])
    try:
        if opts["passwordDictionary"] is not None:
            candidates = dictionary_passwords(opts["passwordDictionary"])
        elif opts["mask"] is not None:
            candidates = mask_passwords(parse_mask(opts["mask"], opts["customCharsets"]))
        else:
            candidates = generated_passwords(
                charset_from_choice(opts),
                opts["minPasswordLen"],
                opts["maxPasswordLen"],
                opts["startingPassword"],
            )
        for password in candidates:
            if check_password(zf, file_number, aes_info, password):
                return password.decode("utf-8", errors="replace")
        return None
    finally:
        zf.close()


def format_duration(ns):
    units = [(1_000_000_000, "s"), (1_000_000, "ms"), (1_000, "us"), (1, "ns")]
    parts = []
    for value, suffix in units:
        amount, ns = divmod(ns, value)
        if amount:
            parts.append(f"{amount}{suffix}")
    return " ".join(parts) if parts else "0ns"


def rust_debug_string(message):
    return '"' + message.replace('\\', '\\\\').replace('"', '\\"') + '"'


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        opts = parse_args(argv)
        start = time.perf_counter_ns()
        password = find_password(opts)
        elapsed = time.perf_counter_ns() - start
        sys.stdout.write(f"Time elapsed: {format_duration(elapsed)}\n")
        if password is None:
            sys.stdout.write("Password not found\n")
        else:
            sys.stdout.write(f"Password found:{password}\n")
        return 0
    except SystemExit as e:
        return int(e.code or 0)
    except CliArgumentError as e:
        sys.stderr.write(f"CLI argument error - {rust_debug_string(str(e))}\n")
        return 1
    except InvalidZipError as e:
        sys.stderr.write(f"Invalid zip file error - {e}\n")
        return 1
    except OSError as e:
        sys.stderr.write(f"standard I/O error - {e}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
