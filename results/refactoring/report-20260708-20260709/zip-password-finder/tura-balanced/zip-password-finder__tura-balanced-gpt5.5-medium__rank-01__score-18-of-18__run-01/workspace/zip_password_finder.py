#!/usr/bin/env python
import argparse
import hashlib
import os
import struct
import sys
import time
import zipfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(newline="\n")
    sys.stderr.reconfigure(newline="\n")


LOWER = list("abcdefghijklmnopqrstuvwxyz")
UPPER = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = list("0123456789")
SYMBOLS = list(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
LOWER_HEX = list("0123456789abcdef")
UPPER_HEX = list("0123456789ABCDEF")


class FinderError(Exception):
    prefix = "CLI argument error"

    def __str__(self):
        return f'{self.prefix} - "{self.args[0]}"'


class InvalidZipError(FinderError):
    prefix = "Invalid zip file error"


class StdIoError(FinderError):
    prefix = "standard I/O error"


    def __str__(self):
        return f"standard I/O error - {self.args[0]}"


def rust_path(p):
    return str(p)


class ClapParser(argparse.ArgumentParser):
    def error(self, message):
        if "the following arguments are required: -i/--inputFile" in message:
            sys.stderr.write(
                "error: the following required arguments were not provided:\n"
                "  --inputFile <inputFile>\n\n"
                "Usage: zip-password-finder.exe --inputFile <inputFile>\n\n"
                "For more information, try '--help'.\n"
            )
            raise SystemExit(2)
        sys.stderr.write(f"error: {message}\n")
        raise SystemExit(2)


def help_text(long_help=False):
    mask_help = "mask pattern for mask attack (e.g. '?l?l?l?d?d')"
    if long_help:
        mask_help = """mask pattern for mask attack (e.g. '?l?l?l?d?d' for 3 lowercase + 2 digits).

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

Any other character is treated as a literal."""
    if long_help:
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
          %s

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
""" % mask_help.replace("\n", "\n          ")
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


def parse_args(argv):
    if "--help" in argv:
        sys.stdout.write(help_text(True)); raise SystemExit(0)
    if "-h" in argv:
        sys.stdout.write(help_text(False)); raise SystemExit(0)
    if "--version" in argv or "-V" in argv:
        sys.stdout.write("zip-password-finder 0.11.1\n"); raise SystemExit(0)
    p = ClapParser(add_help=False, prog="zip-password-finder.exe")
    p.add_argument("-i", "--inputFile", dest="inputFile", required=True)
    p.add_argument("-w", "--workers", type=parse_usize)
    p.add_argument("-p", "--passwordDictionary")
    p.add_argument("-c", "--charset", default="lud")
    p.add_argument("--charsetFile")
    p.add_argument("--minPasswordLen", type=parse_usize, default=1)
    p.add_argument("--maxPasswordLen", type=parse_usize, default=10)
    p.add_argument("--fileNumber", type=parse_usize, default=0)
    p.add_argument("-s", "--startingPassword")
    p.add_argument("-m", "--mask")
    for n in range(1, 5):
        p.add_argument(f"-{n}", f"--customCharset{n}")
    return p.parse_args(argv)


def parse_usize(s):
    if s.startswith("-"):
        raise argparse.ArgumentTypeError(f"invalid value '{s}'")
    try:
        return int(s, 10)
    except ValueError:
        raise argparse.ArgumentTypeError(f"invalid digit found in string")


def preset_to_charset(choice):
    out = []
    for ch in choice:
        if ch == "l": out += LOWER
        elif ch == "u": out += UPPER
        elif ch == "d": out += DIGITS
        elif ch == "s": out += SYMBOLS
        elif ch == "h": out += LOWER_HEX
        elif ch == "H": out += UPPER_HEX
        else: raise FinderError(f"Unknown charset option '{ch}'")
    return out


def charset_from_choice(ns):
    if ns.charsetFile:
        try:
            chars = list(open(ns.charsetFile, "r", encoding="utf-8").read())
        except OSError as e:
            raise StdIoError(e)
    else:
        chars = preset_to_charset(ns.charset)
    return sorted(set(chars))


def builtin_token(token):
    if token == "l": return LOWER[:]
    if token == "u": return UPPER[:]
    if token == "d": return DIGITS[:]
    if token == "s": return SYMBOLS[:]
    if token == "a": return LOWER + UPPER + DIGITS + SYMBOLS
    if token == "h": return LOWER_HEX[:]
    if token == "H": return UPPER_HEX[:]
    return None


def parse_custom(defn):
    out = []
    i = 0
    while i < len(defn):
        c = defn[i]; i += 1
        if c == "?":
            if i >= len(defn): raise FinderError("Custom charset definition ends with incomplete token '?'")
            t = defn[i]; i += 1
            if t == "?": out.append("?")
            else:
                b = builtin_token(t)
                if b is None: raise FinderError(f"Unknown token '?{t}' in custom charset definition")
                out.extend(b)
        else:
            out.append(c)
    if not out: raise FinderError("Custom charset definition is empty")
    seen = []
    for c in out:
        if c not in seen: seen.append(c)
    return seen


def parse_mask(mask, custom):
    positions = []
    i = 0
    while i < len(mask):
        c = mask[i]; i += 1
        if c == "?":
            if i >= len(mask): raise FinderError("Mask ends with incomplete token '?'")
            t = mask[i]; i += 1
            if t == "?": positions.append(["?"])
            elif t in "1234":
                cs = custom[int(t) - 1]
                if cs is None: raise FinderError(f"Custom charset ?{t} used in mask but --customCharset{t} not provided")
                positions.append(cs[:])
            else:
                b = builtin_token(t)
                if b is None: raise FinderError(f"Unknown mask token '?{t}'")
                positions.append(b)
        else:
            positions.append([c])
    if not positions: raise FinderError("Mask pattern is empty")
    return positions


def gen_passwords(charset, min_len, max_len, start=None):
    pwd = list(start) if start is not None else [charset[0]] * min_len
    first = True
    while len(pwd) <= max_len:
        if first:
            first = False
        else:
            carry = True
            for i in range(len(pwd) - 1, -1, -1):
                if not carry: break
                idx = charset.index(pwd[i])
                if idx < len(charset) - 1:
                    pwd[i] = charset[idx + 1]; carry = False
                else:
                    pwd[i] = charset[0]
            if carry:
                pwd = [charset[0]] * (len(pwd) + 1)
                if len(pwd) > max_len: break
        yield "".join(pwd).encode()


def gen_mask(positions):
    idx = [0] * len(positions)
    total = 1
    for p in positions: total *= len(p)
    for _ in range(total):
        yield "".join(positions[i][idx[i]] for i in range(len(idx))).encode()
        carry = True
        for i in range(len(idx) - 1, -1, -1):
            if carry:
                idx[i] += 1
                if idx[i] >= len(positions[i]): idx[i] = 0
                else: carry = False


def read_dict(path):
    with open(path, "rb") as f:
        for line in f:
            if line.endswith(b"\n"):
                line = line[:-1]
                if line.endswith(b"\r"): line = line[:-1]
            yield line


def is_encrypted(info):
    return bool(info.flag_bits & 1)


def format_listing(zf):
    infos = zf.infolist(); total = len(infos); lines = [f"Archive contents ({total} files):"]
    for i, info in enumerate(infos[:20]):
        kind = "dir" if info.filename.endswith("/") else "file"
        enc = ", encrypted" if is_encrypted(info) else ""
        lines.append(f"  [{i}] {info.filename} ({kind}{enc})")
    if total > 20: lines.append(f"  ... and {total - 20} more files")
    return "\n".join(lines)


def aes_info(zip_path, info):
    with open(zip_path, "rb") as f:
        f.seek(info.header_offset)
        hdr = f.read(30)
        if len(hdr) != 30 or hdr[:4] != b"PK\x03\x04":
            return None
        name_len, extra_len = struct.unpack_from("<HH", hdr, 26)
        f.seek(name_len, 1)
        extra = f.read(extra_len)
        strength = None
        p = 0
        while p + 4 <= len(extra):
            hid, size = struct.unpack_from("<HH", extra, p); p += 4
            data = extra[p:p+size]; p += size
            if hid == 0x9901 and len(data) >= 7:
                strength = data[4]
                break
        key_len = {1: 16, 2: 24, 3: 32}.get(strength, 16)
        salt_len = {16: 8, 24: 12, 32: 16}[key_len]
        f.seek(info.header_offset + 30 + name_len + extra_len)
        salt = f.read(salt_len)
        verifier = f.read(2)
        return key_len, salt, verifier


def validate_zip(path, file_number):
    try:
        zf = zipfile.ZipFile(path)
    except Exception as e:
        raise InvalidZipError(str(e))
    infos = zf.infolist()
    target = file_number if file_number < len(infos) and is_encrypted(infos[file_number]) else None
    if target is None:
        for i, info in enumerate(infos):
            if is_encrypted(info): target = i; break
        if target is None:
            raise InvalidZipError("no encrypted file found in archive\n" + format_listing(zf))
        name = infos[target].filename
        sys.stderr.write(f"File at index {file_number} is not encrypted, auto-selecting file at index {target} ({name})\n")
    return zf, target


def check_password(zf, zip_path, index, pwd):
    info = zf.infolist()[index]
    if info.compress_type == 99:
        ai = aes_info(zip_path, info)
        if ai is None: return False
        key_len, salt, verifier = ai
        dk = hashlib.pbkdf2_hmac("sha1", pwd, salt, 1000, 2 * key_len + 2)
        return dk[-2:] == verifier
    try:
        with zf.open(info, "r", pwd=pwd) as fp:
            fp.read()
        return True
    except Exception:
        return False


def validate_args(ns):
    if not os.path.isfile(ns.inputFile): raise FinderError("'inputFile' does not exist")
    if ns.passwordDictionary and not os.path.isfile(ns.passwordDictionary): raise FinderError("'passwordDictionary' does not exist")
    if ns.charsetFile and not os.path.isfile(ns.charsetFile): raise FinderError("'charsetFile' does not exist")
    if ns.workers == 0: raise FinderError("'workers' must be positive")
    if ns.minPasswordLen == 0: raise FinderError("'minPasswordLen' must be positive")
    if ns.maxPasswordLen == 0: raise FinderError("'maxPasswordLen' must be positive")
    if ns.minPasswordLen > ns.maxPasswordLen: raise FinderError("'maxPasswordLen' must be equal or greater than 'minPasswordLen'")
    custom = [None, None, None, None]
    for i in range(4):
        val = getattr(ns, f"customCharset{i+1}")
        if val is not None:
            if ns.mask is None: raise FinderError(f"'--customCharset{i+1}' can only be used with --mask")
            custom[i] = parse_custom(val)
    if ns.mask and ns.passwordDictionary: raise FinderError("'mask' cannot be used with a dictionary file")
    if ns.startingPassword:
        if ns.passwordDictionary: raise FinderError("'startingPassword' cannot be used with a dictionary file")
        if ns.mask: raise FinderError("'startingPassword' cannot be used with mask attack")
        charset = charset_from_choice(ns)
        if any(c not in charset for c in ns.startingPassword): raise FinderError("'startingPassword' uses characters out of the generation charset")
        if len(ns.startingPassword) > ns.maxPasswordLen or len(ns.startingPassword) < ns.minPasswordLen:
            raise FinderError("'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration")
    return custom


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        ns = parse_args(argv)
        custom = validate_args(ns)
        start = time.monotonic_ns()
        if ns.passwordDictionary:
            candidates = read_dict(ns.passwordDictionary)
        elif ns.mask:
            candidates = gen_mask(parse_mask(ns.mask, custom))
        else:
            candidates = gen_passwords(charset_from_choice(ns), ns.minPasswordLen, ns.maxPasswordLen, ns.startingPassword)
        zf, index = validate_zip(ns.inputFile, ns.fileNumber)
        found = None
        for pwd in candidates:
            if check_password(zf, ns.inputFile, index, pwd):
                found = pwd.decode("utf-8", "replace")
                break
        elapsed = time.monotonic_ns() - start
        sys.stdout.write(f"Time elapsed: {format_duration(elapsed)}\n")
        sys.stdout.write(f"Password found:{found}\n" if found is not None else "Password not found\n")
        return 0
    except SystemExit as e:
        return int(e.code or 0)
    except FinderError as e:
        sys.stderr.write(str(e) + "\n")
        return 1
    except OSError as e:
        sys.stderr.write(str(StdIoError(e)) + "\n")
        return 1


def format_duration(ns):
    if ns < 1_000: return f"{ns}ns"
    us, n = divmod(ns, 1_000)
    if us < 1_000: return f"{us}us {n}ns"
    ms, u = divmod(us, 1_000)
    if ms < 1_000: return f"{ms}ms {u}us {n}ns"
    s, m = divmod(ms, 1_000)
    return f"{s}s {m}ms {u}us {n}ns"


if __name__ == "__main__":
    raise SystemExit(main())
