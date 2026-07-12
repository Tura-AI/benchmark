#!/usr/bin/env python3
import hashlib
import os
import struct
import sys
import time
import zipfile


VERSION = "0.11.1"

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

    def __str__(self):
        if self.kind == "cli":
            return f'CLI argument error - "{self.message}"'
        if self.kind == "invalid_zip":
            return f"Invalid zip file error - {self.message}"
        if self.kind == "io":
            return f"standard I/O error - {self.message}"
        return self.message


def print_long_help():
    print("""Find the password of protected ZIP files

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
          Print version""")


def print_short_help():
    print("""Find the password of protected ZIP files

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
          Print version""")


def parse_usize(value, name):
    try:
        if value.startswith("-"):
            raise ValueError
        return int(value, 10)
    except Exception:
        sys.stderr.write(
            f"error: invalid value '{value}' for '{name}': invalid digit found in string\n\n"
        )
        sys.stderr.write("For more information, try '--help'.\n")
        raise SystemExit(2)


def take_value(argv, i, opt, display):
    if i + 1 >= len(argv):
        sys.stderr.write(f"error: a value is required for '{display}' but none was supplied\n\n")
        sys.stderr.write("For more information, try '--help'.\n")
        raise SystemExit(2)
    return argv[i + 1], i + 2


def parse_args(argv):
    if any(a == "-h" for a in argv):
        print_short_help()
        raise SystemExit(0)
    if any(a == "--help" for a in argv):
        print_long_help()
        raise SystemExit(0)
    if any(a in ("-V", "--version") for a in argv):
        print("zip-password-finder 0.11.1")
        raise SystemExit(0)

    opts = {
        "charset": "lud",
        "minPasswordLen": 1,
        "maxPasswordLen": 10,
        "fileNumber": 0,
        "custom": [None, None, None, None],
    }
    display = {
        "inputFile": "--inputFile <inputFile>",
        "workers": "--workers <workers>",
        "passwordDictionary": "--passwordDictionary <passwordDictionary>",
        "charset": "--charset <charset>",
        "charsetFile": "--charsetFile <charsetFile>",
        "minPasswordLen": "--minPasswordLen <minPasswordLen>",
        "maxPasswordLen": "--maxPasswordLen <maxPasswordLen>",
        "fileNumber": "--fileNumber <fileNumber>",
        "startingPassword": "--startingPassword <startingPassword>",
        "mask": "--mask <mask>",
        "customCharset1": "--customCharset1 <customCharset1>",
        "customCharset2": "--customCharset2 <customCharset2>",
        "customCharset3": "--customCharset3 <customCharset3>",
        "customCharset4": "--customCharset4 <customCharset4>",
    }
    seen = set()

    def reject_duplicate(name):
        if name in seen:
            sys.stderr.write(f"error: the argument '{display[name]}' cannot be used multiple times\n\n")
            sys.stderr.write("Usage: zip-password-finder.exe [OPTIONS] --inputFile <inputFile>\n\n")
            sys.stderr.write("For more information, try '--help'.\n")
            raise SystemExit(2)
        seen.add(name)

    i = 0
    while i < len(argv):
        a = argv[i]
        key = None
        if a.startswith("--") and "=" in a:
            a, inline_value = a.split("=", 1)
            argv = argv[:i + 1] + [inline_value] + argv[i + 1:]
        if a in ("-i", "--inputFile"):
            key = "inputFile"
        elif a in ("-w", "--workers"):
            reject_duplicate("workers")
            v, i = take_value(argv, i, a, display["workers"])
            opts["workers"] = parse_usize(v, "--workers <workers>")
            continue
        elif a in ("-p", "--passwordDictionary"):
            key = "passwordDictionary"
        elif a in ("-c", "--charset"):
            key = "charset"
        elif a == "--charsetFile":
            key = "charsetFile"
        elif a == "--minPasswordLen":
            reject_duplicate("minPasswordLen")
            v, i = take_value(argv, i, a, display["minPasswordLen"])
            opts["minPasswordLen"] = parse_usize(v, "--minPasswordLen <minPasswordLen>")
            continue
        elif a == "--maxPasswordLen":
            reject_duplicate("maxPasswordLen")
            v, i = take_value(argv, i, a, display["maxPasswordLen"])
            opts["maxPasswordLen"] = parse_usize(v, "--maxPasswordLen <maxPasswordLen>")
            continue
        elif a == "--fileNumber":
            reject_duplicate("fileNumber")
            v, i = take_value(argv, i, a, display["fileNumber"])
            opts["fileNumber"] = parse_usize(v, "--fileNumber <fileNumber>")
            continue
        elif a in ("-s", "--startingPassword"):
            key = "startingPassword"
        elif a in ("-m", "--mask"):
            key = "mask"
        elif a in ("-1", "--customCharset1", "-2", "--customCharset2", "-3", "--customCharset3", "-4", "--customCharset4"):
            idx = {"-1": 0, "--customCharset1": 0, "-2": 1, "--customCharset2": 1, "-3": 2, "--customCharset3": 2, "-4": 3, "--customCharset4": 3}[a]
            name = f"customCharset{idx + 1}"
            reject_duplicate(name)
            v, i = take_value(argv, i, a, display[name])
            opts["custom"][idx] = v
            continue
        else:
            sys.stderr.write(f"error: unexpected argument '{a}' found\n\n")
            sys.stderr.write("Usage: zip-password-finder.exe [OPTIONS] --inputFile <inputFile>\n\n")
            sys.stderr.write("For more information, try '--help'.\n")
            raise SystemExit(2)
        reject_duplicate(key)
        v, i = take_value(argv, i, a, display[key])
        opts[key] = v

    if "inputFile" not in opts:
        sys.stderr.write("error: the following required arguments were not provided:\n  --inputFile <inputFile>\n\n")
        sys.stderr.write("Usage: zip-password-finder.exe --inputFile <inputFile>\n\n")
        sys.stderr.write("For more information, try '--help'.\n")
        raise SystemExit(2)

    if not os.path.isfile(opts["inputFile"]):
        raise FinderError("cli", "'inputFile' does not exist")
    if opts.get("passwordDictionary") and not os.path.isfile(opts["passwordDictionary"]):
        raise FinderError("cli", "'passwordDictionary' does not exist")
    if opts.get("charsetFile") and not os.path.isfile(opts["charsetFile"]):
        raise FinderError("cli", "'charsetFile' does not exist")
    if opts.get("workers") == 0:
        raise FinderError("cli", "'workers' must be positive")
    if opts["minPasswordLen"] == 0:
        raise FinderError("cli", "'minPasswordLen' must be positive")
    if opts["maxPasswordLen"] == 0:
        raise FinderError("cli", "'maxPasswordLen' must be positive")
    if opts["minPasswordLen"] > opts["maxPasswordLen"]:
        raise FinderError("cli", "'maxPasswordLen' must be equal or greater than 'minPasswordLen'")

    mask = opts.get("mask")
    for idx, val in enumerate(opts["custom"], start=1):
        if val is not None and mask is None:
            raise FinderError("cli", f"'--customCharset{idx}' can only be used with --mask")
    if mask is not None and opts.get("passwordDictionary"):
        raise FinderError("cli", "'mask' cannot be used with a dictionary file")
    if opts.get("startingPassword") and opts.get("passwordDictionary"):
        raise FinderError("cli", "'startingPassword' cannot be used with a dictionary file")
    if opts.get("startingPassword") and mask is not None:
        raise FinderError("cli", "'startingPassword' cannot be used with mask attack")
    return opts


def preset_to_charset(choice):
    out = []
    for ch in choice:
        if ch == "l":
            out += LOWER
        elif ch == "u":
            out += UPPER
        elif ch == "d":
            out += DIGITS
        elif ch == "s":
            out += SYMBOLS
        elif ch == "h":
            out += LOWER_HEX
        elif ch == "H":
            out += UPPER_HEX
        else:
            raise FinderError("cli", f"Unknown charset option '{ch}'")
    return out


def charset_from_choice(opts):
    if opts.get("charsetFile"):
        with open(opts["charsetFile"], "r", encoding="utf-8") as f:
            chars = list(f.read())
    else:
        chars = preset_to_charset(opts["charset"])
    return sorted(set(chars))


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


def parse_custom_charset(defn):
    chars = []
    i = 0
    while i < len(defn):
        c = defn[i]
        if c == "?":
            i += 1
            if i >= len(defn):
                raise FinderError("cli", "Custom charset definition ends with incomplete token '?'")
            token = defn[i]
            if token == "?":
                chars.append("?")
            else:
                b = builtin_token(token)
                if b is None:
                    raise FinderError("cli", f"Unknown token '?{token}' in custom charset definition")
                chars += b
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


def parse_mask(mask, custom_defs):
    custom = [parse_custom_charset(c) if c is not None else None for c in custom_defs]
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
                cs = custom[int(token) - 1]
                if cs is None:
                    raise FinderError("cli", f"Custom charset ?{token} used in mask but --customCharset{token} not provided")
                positions.append(cs)
            else:
                b = builtin_token(token)
                if b is None:
                    raise FinderError("cli", f"Unknown mask token '?{token}'")
                positions.append(b)
        else:
            positions.append([c])
        i += 1
    if not positions:
        raise FinderError("cli", "Mask pattern is empty")
    return positions


def password_count(charset_len, mn, mx):
    return sum(charset_len ** n for n in range(mn, mx + 1))


def already_generated(charset, mn, pwd):
    base = len(charset)
    count = sum(base ** n for n in range(mn, len(pwd)))
    for i, c in enumerate(reversed(pwd)):
        count += charset.index(c) * (base ** i)
    return count + 1


def generated_passwords(charset, mn, mx, starting=None):
    if starting is None:
        current = [charset[0]] * mn
        total = password_count(len(charset), mn, mx)
    else:
        current = list(starting)
        total = password_count(len(charset), mn, mx) - already_generated(charset, mn, starting)
    produced = 0
    last_idx = len(charset) - 1
    lookup = {c: i for i, c in enumerate(charset)}
    while len(current) <= mx and produced < total:
        if produced == 0:
            produced += 1
            yield "".join(current).encode()
            continue
        carry = True
        for pos in range(len(current) - 1, -1, -1):
            if not carry:
                break
            idx = lookup[current[pos]]
            if idx < last_idx:
                current[pos] = charset[idx + 1]
                carry = False
            else:
                current[pos] = charset[0]
        if carry:
            current = [charset[0]] * (len(current) + 1)
        produced += 1
        yield "".join(current).encode()


def dictionary_passwords(path):
    with open(path, "rb") as f:
        for line in f:
            if line.endswith(b"\n"):
                line = line[:-1]
                if line.endswith(b"\r"):
                    line = line[:-1]
            yield line


def mask_passwords(positions):
    idx = [0] * len(positions)
    total = 1
    for p in positions:
        total *= len(p)
    for _ in range(total):
        yield "".join(positions[i][idx[i]] for i in range(len(idx))).encode()
        for pos in range(len(idx) - 1, -1, -1):
            idx[pos] += 1
            if idx[pos] < len(positions[pos]):
                break
            idx[pos] = 0


def dos_time_crc_byte(info):
    return ((info._raw_time >> 8) & 0xff) if hasattr(info, "_raw_time") else ((info.CRC >> 24) & 0xff)


def parse_aes_info(zip_path, info):
    extra = info.extra
    i = 0
    strength = None
    while i + 4 <= len(extra):
        header, size = struct.unpack_from("<HH", extra, i)
        data = extra[i + 4:i + 4 + size]
        if header == 0x9901 and len(data) >= 7:
            strength = data[4]
            break
        i += 4 + size
    if strength is None:
        return None
    key_len = {1: 16, 2: 24, 3: 32}.get(strength)
    salt_len = {1: 8, 2: 12, 3: 16}.get(strength)
    if key_len is None:
        return None
    with open(zip_path, "rb") as f:
        f.seek(info.header_offset)
        local = f.read(30)
        if len(local) != 30 or local[:4] != b"PK\x03\x04":
            raise FinderError("invalid_zip", "invalid Zip archive")
        name_len, extra_len = struct.unpack_from("<HH", local, 26)
        f.seek(name_len + extra_len, os.SEEK_CUR)
        salt = f.read(salt_len)
        verifier = f.read(2)
    return key_len, salt, verifier


def encrypted_by_index(zf, idx):
    try:
        info = zf.infolist()[idx]
    except IndexError:
        return False
    if info.flag_bits & 0x1:
        return True
    try:
        zf.read(info, pwd=b"")
        return False
    except RuntimeError as e:
        return "password required" in str(e).lower()
    except NotImplementedError:
        return info.flag_bits & 0x1 != 0
    except Exception:
        return False


def archive_listing(zf):
    infos = zf.infolist()
    lines = [f"Archive contents ({len(infos)} files):"]
    for i, info in enumerate(infos[:20]):
        kind = "dir" if info.filename.endswith("/") else "file"
        enc = ", encrypted" if encrypted_by_index(zf, i) else ""
        lines.append(f"  [{i}] {info.filename} ({kind}{enc})")
    if len(infos) > 20:
        lines.append(f"  ... and {len(infos) - 20} more files")
    return "\n".join(lines)


def validate_zip(path, file_number):
    try:
        zf = zipfile.ZipFile(path)
    except Exception as e:
        raise FinderError("invalid_zip", str(e))
    infos = zf.infolist()
    target = file_number if file_number < len(infos) and encrypted_by_index(zf, file_number) else None
    if target is None:
        for i in range(len(infos)):
            if encrypted_by_index(zf, i):
                target = i
                name = infos[i].filename
                sys.stderr.write(f"File at index {file_number} is not encrypted, auto-selecting file at index {i} ({name})\n")
                break
    if target is None:
        raise FinderError("invalid_zip", "no encrypted file found in archive\n" + archive_listing(zf))
    return zf, target, parse_aes_info(path, infos[target])


def verify_zipcrypto(zf, idx, password):
    info = zf.infolist()[idx]
    try:
        with zf.open(info, "r", pwd=password) as f:
            while f.read(65536):
                pass
        return True
    except Exception:
        return False


def verify_aes(aes_info, password):
    key_len, salt, verifier = aes_info
    derived = hashlib.pbkdf2_hmac("sha1", password, salt, 1000, 2 * key_len + 2)
    return derived[-2:] == verifier


def human_duration(seconds):
    ns = int(seconds * 1_000_000_000)
    parts = []
    sec, ns = divmod(ns, 1_000_000_000)
    ms, ns = divmod(ns, 1_000_000)
    us, ns = divmod(ns, 1_000)
    if sec:
        parts.append(f"{sec}s")
    if ms:
        parts.append(f"{ms}ms")
    if us:
        parts.append(f"{us}us")
    if ns or not parts:
        parts.append(f"{ns}ns")
    return " ".join(parts)


def main_result(argv):
    opts = parse_args(argv)
    charset = None
    if not opts.get("passwordDictionary") and opts.get("mask") is None:
        charset = charset_from_choice(opts)
    if opts.get("startingPassword"):
        sp = opts["startingPassword"]
        if any(c not in charset for c in sp):
            raise FinderError("cli", "'startingPassword' uses characters out of the generation charset")
        if len(sp) > opts["maxPasswordLen"] or len(sp) < opts["minPasswordLen"]:
            raise FinderError("cli", "'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration")

    if opts.get("passwordDictionary"):
        candidates = dictionary_passwords(opts["passwordDictionary"])
    elif opts.get("mask") is not None:
        candidates = mask_passwords(parse_mask(opts["mask"], opts["custom"]))
    else:
        candidates = generated_passwords(
            charset,
            opts["minPasswordLen"],
            opts["maxPasswordLen"],
            opts.get("startingPassword"),
        )

    start = time.perf_counter()
    zf, idx, aes_info = validate_zip(opts["inputFile"], opts["fileNumber"])
    found = None
    for pwd in candidates:
        ok = verify_aes(aes_info, pwd) if aes_info else verify_zipcrypto(zf, idx, pwd)
        if ok:
            found = pwd.decode("utf-8", "replace")
            break
    print(f"Time elapsed: {human_duration(time.perf_counter() - start)}")
    if found is None:
        print("Password not found")
    else:
        print(f"Password found:{found}")


def main():
    try:
        main_result(sys.argv[1:])
        return 0
    except SystemExit as e:
        return int(e.code or 0)
    except FinderError as e:
        sys.stderr.write(str(e) + "\n")
        return 1
    except OSError as e:
        sys.stderr.write(f"standard I/O error - {e}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
