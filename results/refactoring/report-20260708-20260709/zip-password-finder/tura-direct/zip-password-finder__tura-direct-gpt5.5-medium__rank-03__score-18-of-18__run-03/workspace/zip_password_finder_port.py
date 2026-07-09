#!/usr/bin/env python3
import hashlib
import os
import struct
import sys
import time
import zipfile


PROGRAM = "zip-password-finder.exe"
VERSION = "0.11.1"

LOWER = list("abcdefghijklmnopqrstuvwxyz")
UPPER = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = list("0123456789")
SYMBOLS = list(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
HEX_LOWER = list("0123456789abcdef")
HEX_UPPER = list("0123456789ABCDEF")


class CliError(Exception):
    def __init__(self, message, code=1):
        super().__init__(message)
        self.code = code
        self.message = message


def short_help():
    return f"""Find the password of protected ZIP files

Usage: {PROGRAM} [OPTIONS] --inputFile <inputFile>

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


def long_help():
    return f"""Find the password of protected ZIP files

Usage: {PROGRAM} [OPTIONS] --inputFile <inputFile>

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


def clap_error(message, usage=True):
    text = f"error: {message}\n"
    if usage:
        text += f"\nUsage: {PROGRAM} [OPTIONS] --inputFile <inputFile>\n"
    text += "\nFor more information, try '--help'.\n"
    raise CliError(text, 2)


def parse_usize(value, name):
    try:
        if value.startswith("-"):
            raise ValueError
        return int(value, 10)
    except Exception:
        clap_error(f"invalid value '{value}' for '--{name} <{name}>': invalid digit found in string", False)


LONG_TO_KEY = {
    "inputFile": "inputFile",
    "workers": "workers",
    "passwordDictionary": "passwordDictionary",
    "charset": "charset",
    "charsetFile": "charsetFile",
    "minPasswordLen": "minPasswordLen",
    "maxPasswordLen": "maxPasswordLen",
    "fileNumber": "fileNumber",
    "startingPassword": "startingPassword",
    "mask": "mask",
    "customCharset1": "customCharset1",
    "customCharset2": "customCharset2",
    "customCharset3": "customCharset3",
    "customCharset4": "customCharset4",
}
SHORT_TO_LONG = {
    "i": "inputFile",
    "w": "workers",
    "p": "passwordDictionary",
    "c": "charset",
    "s": "startingPassword",
    "m": "mask",
    "1": "customCharset1",
    "2": "customCharset2",
    "3": "customCharset3",
    "4": "customCharset4",
}


def parse_args(argv):
    opts = {"charset": "lud", "minPasswordLen": "1", "maxPasswordLen": "10", "fileNumber": "0"}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in ("-h", "--help"):
            print(short_help() if arg == "-h" else long_help(), end="")
            raise SystemExit(0)
        if arg in ("-V", "--version"):
            print(f"zip-password-finder {VERSION}")
            raise SystemExit(0)
        if arg.startswith("--"):
            raw = arg[2:]
            if "=" in raw:
                name, value = raw.split("=", 1)
            else:
                name = raw
                if name not in LONG_TO_KEY:
                    clap_error(f"unexpected argument '--{name}' found")
                if i + 1 >= len(argv):
                    clap_error(f"a value is required for '--{name} <{name}>' but none was supplied", False)
                i += 1
                value = argv[i]
            if name not in LONG_TO_KEY:
                clap_error(f"unexpected argument '--{name}' found")
            opts[LONG_TO_KEY[name]] = value
        elif arg.startswith("-") and len(arg) >= 2:
            flag = arg[1]
            if flag not in SHORT_TO_LONG:
                clap_error(f"unexpected argument '{arg}' found")
            name = SHORT_TO_LONG[flag]
            if len(arg) > 2:
                value = arg[2:]
            else:
                if i + 1 >= len(argv):
                    clap_error(f"a value is required for '--{name} <{name}>' but none was supplied", False)
                i += 1
                value = argv[i]
            opts[name] = value
        else:
            clap_error(f"unexpected argument '{arg}' found")
        i += 1

    if "inputFile" not in opts:
        sys.stderr.write(
            f"error: the following required arguments were not provided:\n  --inputFile <inputFile>\n\nUsage: {PROGRAM} --inputFile <inputFile>\n\nFor more information, try '--help'.\n"
        )
        raise SystemExit(2)

    for name in ("workers", "minPasswordLen", "maxPasswordLen", "fileNumber"):
        if name in opts:
            opts[name] = parse_usize(str(opts[name]), name)

    def cli_arg(msg):
        raise CliError(f'CLI argument error - "{msg}"', 1)

    if not os.path.isfile(opts["inputFile"]):
        cli_arg("'inputFile' does not exist")
    if "workers" in opts and opts["workers"] == 0:
        cli_arg("'workers' must be positive")
    if opts["minPasswordLen"] == 0:
        cli_arg("'minPasswordLen' must be positive")
    if opts["maxPasswordLen"] == 0:
        cli_arg("'maxPasswordLen' must be positive")
    if opts["maxPasswordLen"] < opts["minPasswordLen"]:
        cli_arg("'maxPasswordLen' must be equal or greater than 'minPasswordLen'")
    if "passwordDictionary" in opts and not os.path.isfile(opts["passwordDictionary"]):
        cli_arg("'passwordDictionary' does not exist")
    if "charsetFile" in opts and not os.path.isfile(opts["charsetFile"]):
        cli_arg("'charsetFile' does not exist")
    if "passwordDictionary" in opts and "mask" in opts:
        cli_arg("'mask' cannot be used with a dictionary file")
    if "passwordDictionary" not in opts and "mask" not in opts:
        charset_from_options(opts)
    return opts


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
        return HEX_LOWER[:]
    if token == "H":
        return HEX_UPPER[:]
    return None


def preset_to_charset(preset):
    out = []
    for ch in preset:
        chars = builtin_token(ch)
        if chars is None or ch == "a":
            raise CliError(f'CLI argument error - "Unknown charset option \'{ch}\'"', 1)
        out.extend(chars)
    return out


def dedup_sorted(chars):
    return sorted(set(chars), key=lambda c: ord(c))


def charset_from_options(opts):
    if "charsetFile" in opts:
        with open(opts["charsetFile"], "r", encoding="utf-8") as f:
            chars = list(f.read())
    else:
        chars = preset_to_charset(str(opts.get("charset", "lud")))
    return dedup_sorted(chars)


def parse_custom_charset(definition):
    chars = []
    i = 0
    while i < len(definition):
        c = definition[i]
        if c == "?":
            i += 1
            if i >= len(definition):
                raise CliError('CLI argument error - "Custom charset definition ends with incomplete token \'?\'"', 1)
            t = definition[i]
            if t == "?":
                chars.append("?")
            else:
                b = builtin_token(t)
                if b is None:
                    raise CliError(f'CLI argument error - "Unknown token \'?{t}\' in custom charset definition"', 1)
                chars.extend(b)
        else:
            chars.append(c)
        i += 1
    if not chars:
        raise CliError('CLI argument error - "Custom charset definition is empty"', 1)
    seen = []
    for c in chars:
        if c not in seen:
            seen.append(c)
    return seen


def parse_mask(mask, custom):
    positions = []
    i = 0
    while i < len(mask):
        c = mask[i]
        if c == "?":
            i += 1
            if i >= len(mask):
                raise CliError('CLI argument error - "Mask ends with incomplete token \'?\'"', 1)
            t = mask[i]
            if t == "?":
                positions.append(["?"])
            elif t in "1234":
                cs = custom[ord(t) - ord("1")]
                if cs is None:
                    raise CliError(f'CLI argument error - "Custom charset ?{t} used in mask but --customCharset{t} not provided"', 1)
                positions.append(cs[:])
            else:
                b = builtin_token(t)
                if b is None:
                    raise CliError(f'CLI argument error - "Unknown mask token \'?{t}\'"', 1)
                positions.append(b)
        else:
            positions.append([c])
        i += 1
    if not positions:
        raise CliError('CLI argument error - "Mask pattern is empty"', 1)
    return positions


def dictionary_iter(path):
    with open(path, "rb") as f:
        for line in f:
            if line.endswith(b"\n"):
                line = line[:-1]
                if line.endswith(b"\r"):
                    line = line[:-1]
            yield line


def brute_iter(charset, min_len, max_len, starting):
    if not charset:
        return
    chars = [c.encode("utf-8")[:1] for c in charset]
    lookup = {c: i for i, c in enumerate(chars)}
    if starting is not None:
        password = [bytes([b]) for b in starting.encode("utf-8")]
    else:
        password = [chars[0]] * min_len
    while len(password) <= max_len:
        yield b"".join(password)
        carry = True
        for i in range(len(password) - 1, -1, -1):
            if not carry:
                break
            idx = lookup.get(password[i], 0)
            if idx < len(chars) - 1:
                password[i] = chars[idx + 1]
                carry = False
            else:
                password[i] = chars[0]
        if carry:
            password = [chars[0]] * (len(password) + 1)


def mask_iter(positions):
    pos = [[c.encode("utf-8")[:1] for c in p] for p in positions]
    if not pos or any(not p for p in pos):
        return
    idx = [0] * len(pos)
    total = 1
    for p in pos:
        total *= len(p)
    for _ in range(total):
        yield b"".join(pos[i][idx[i]] for i in range(len(pos)))
        carry = True
        for i in range(len(idx) - 1, -1, -1):
            if carry:
                idx[i] += 1
                if idx[i] >= len(pos[i]):
                    idx[i] = 0
                else:
                    carry = False


def is_encrypted(info):
    return bool(info.flag_bits & 1)


def archive_listing(zf):
    infos = zf.infolist()
    total = len(infos)
    display = min(total, 20)
    out = [f"Archive contents ({total} files):"]
    for i, info in enumerate(infos[:display]):
        kind = "dir" if info.filename.endswith("/") else "file"
        enc = ", encrypted" if is_encrypted(info) else ""
        out.append(f"  [{i}] {info.filename} ({kind}{enc})")
    if total > display:
        out.append(f"  ... and {total - display} more files")
    return "\n".join(out)


def validate_zip(path, file_number):
    try:
        zf = zipfile.ZipFile(path)
    except Exception as e:
        raise CliError(f"Invalid zip file error - {e}", 1)
    infos = zf.infolist()
    target = None
    if 0 <= file_number < len(infos) and is_encrypted(infos[file_number]):
        target = file_number
    else:
        for i, info in enumerate(infos):
            if is_encrypted(info):
                target = i
                sys.stderr.write(
                    f"File at index {file_number} is not encrypted, auto-selecting file at index {i} ({info.filename})\n"
                )
                break
    if target is None:
        raise CliError(f"Invalid zip file error - no encrypted file found in archive\n{archive_listing(zf)}", 1)
    return zf, target


def aes_extra(info):
    extra = info.extra
    i = 0
    while i + 4 <= len(extra):
        header, size = struct.unpack_from("<HH", extra, i)
        data = extra[i + 4 : i + 4 + size]
        if header == 0x9901 and len(data) >= 7:
            strength = data[4]
            key_len = {1: 16, 2: 24, 3: 32}.get(strength)
            return key_len
        i += 4 + size
    return None


def aes_salt_and_verifier(zf, info, key_len):
    salt_len = {16: 8, 24: 12, 32: 16}[key_len]
    with open(zf.filename, "rb") as f:
        f.seek(info.header_offset)
        hdr = f.read(30)
        if len(hdr) != 30 or hdr[:4] != b"PK\x03\x04":
            raise CliError("Invalid zip file error - invalid local file header", 1)
        name_len, extra_len = struct.unpack_from("<HH", hdr, 26)
        f.seek(name_len + extra_len, os.SEEK_CUR)
        data = f.read(salt_len + 2)
    return data[:salt_len], data[salt_len : salt_len + 2]


def make_checker(zf, target):
    info = zf.infolist()[target]
    if info.compress_type == 99:
        key_len = aes_extra(info) or 32
        salt, verifier = aes_salt_and_verifier(zf, info, key_len)
        derived_len = 2 * key_len + 2

        def check(password):
            dk = hashlib.pbkdf2_hmac("sha1", password, salt, 1000, derived_len)
            return dk[-2:] == verifier

        return check

    def check_zipcrypto(password):
        try:
            with zf.open(info, "r", pwd=password) as f:
                while f.read(65536):
                    pass
            return True
        except Exception:
            return False

    return check_zipcrypto


def humantime(ns):
    if ns < 1000:
        return f"{ns}ns"
    parts = []
    s, ns = divmod(ns, 1_000_000_000)
    ms, ns = divmod(ns, 1_000_000)
    us, ns = divmod(ns, 1000)
    if s:
        parts.append(f"{s}s")
    if ms:
        parts.append(f"{ms}ms")
    if us:
        parts.append(f"{us}us")
    if ns:
        parts.append(f"{ns}ns")
    return " ".join(parts) or "0ns"


def candidate_iter(opts):
    if "passwordDictionary" in opts:
        return dictionary_iter(opts["passwordDictionary"])
    if "mask" in opts:
        custom = [None, None, None, None]
        for i in range(4):
            key = f"customCharset{i + 1}"
            if key in opts:
                custom[i] = parse_custom_charset(opts[key])
        return mask_iter(parse_mask(opts["mask"], custom))
    return brute_iter(
        charset_from_options(opts),
        opts["minPasswordLen"],
        opts["maxPasswordLen"],
        opts.get("startingPassword"),
    )


def run(argv):
    opts = parse_args(argv)
    start = time.perf_counter_ns()
    zf, target = validate_zip(opts["inputFile"], opts["fileNumber"])
    check = make_checker(zf, target)
    found = None
    for password in candidate_iter(opts):
        if check(password):
            try:
                found = password.decode("utf-8")
            except UnicodeDecodeError:
                found = password.decode("utf-8", "replace")
            break
    elapsed = time.perf_counter_ns() - start
    print(f"Time elapsed: {humantime(elapsed)}")
    if found is None:
        print("Password not found")
    else:
        print(f"Password found:{found}")
    return 0


def main():
    try:
        return run(sys.argv[1:])
    except SystemExit as e:
        return int(e.code or 0)
    except CliError as e:
        sys.stderr.write(e.message)
        if not e.message.endswith("\n"):
            sys.stderr.write("\n")
        return e.code


if __name__ == "__main__":
    raise SystemExit(main())
