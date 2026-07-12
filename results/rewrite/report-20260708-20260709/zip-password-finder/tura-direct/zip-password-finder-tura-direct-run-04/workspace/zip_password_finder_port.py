import binascii
import hashlib
import os
import struct
import sys
import time
import zipfile

sys.stdout.reconfigure(newline="\n")
sys.stderr.reconfigure(newline="\n")


LOWER = list("abcdefghijklmnopqrstuvwxyz")
UPPER = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = list("0123456789")
SYMBOLS = list(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
LOWER_HEX = list("0123456789abcdef")
UPPER_HEX = list("0123456789ABCDEF")


class CliError(Exception):
    pass


class ClapExit(Exception):
    def __init__(self, code, text, stream="stderr"):
        super().__init__(text)
        self.code = code
        self.text = text
        self.stream = stream


def red(text):
    return text


def help_text():
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


def parse_usize(name, value):
    try:
        if value.startswith("-"):
            raise ValueError("invalid digit found in string")
        return int(value, 10)
    except ValueError as exc:
        msg = str(exc) if str(exc) == "invalid digit found in string" else "invalid digit found in string"
        raise ClapExit(2, red(f"error: invalid value '{value}' for '--{name} <{name}>': {msg}\n") + red("\n") + red("For more information, try '--help'.\n"))


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
    names = {
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
    int_names = {"workers", "minPasswordLen", "maxPasswordLen", "fileNumber"}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-h", "--help"):
            raise ClapExit(0, help_text(), "stdout")
        if a in ("-V", "--version"):
            raise ClapExit(0, "zip-password-finder 0.11.1\n", "stdout")
        if a not in names:
            text = red(f"error: unexpected argument '{a}' found\n") + red("\n") + red("Usage: zip-password-finder.exe [OPTIONS] --inputFile <inputFile>\n") + red("\n") + red("For more information, try '--help'.\n")
            raise ClapExit(2, text)
        name = names[a]
        if i + 1 >= len(argv):
            text = red(f"error: a value is required for '--{name} <{name}>' but none was supplied\n") + red("\n") + red("For more information, try '--help'.\n")
            raise ClapExit(2, text)
        v = argv[i + 1]
        opts[name] = parse_usize(name, v) if name in int_names else v
        i += 2
    if opts["inputFile"] is None:
        text = red("error: the following required arguments were not provided:\n  --inputFile <inputFile>\n") + red("\n") + red("Usage: zip-password-finder.exe --inputFile <inputFile>\n") + red("\n") + red("For more information, try '--help'.\n")
        raise ClapExit(2, text)
    validate_args(opts)
    return opts


def validate_args(o):
    if not os.path.isfile(o["inputFile"]):
        raise CliError("'inputFile' does not exist")
    if o["workers"] is not None and o["workers"] <= 0:
        raise CliError("'workers' must be positive")
    if o["passwordDictionary"] is not None and not os.path.isfile(o["passwordDictionary"]):
        raise CliError("'passwordDictionary' does not exist")
    if o["charsetFile"] is not None and not os.path.isfile(o["charsetFile"]):
        raise CliError("'charsetFile' does not exist")
    if o["minPasswordLen"] <= 0:
        raise CliError("'minPasswordLen' must be positive")
    if o["maxPasswordLen"] <= 0:
        raise CliError("'maxPasswordLen' must be positive")
    if o["maxPasswordLen"] < o["minPasswordLen"]:
        raise CliError("'maxPasswordLen' must be equal or greater than 'minPasswordLen'")
    if o["passwordDictionary"] is not None:
        if o["startingPassword"] is not None:
            raise CliError("'startingPassword' cannot be used with a dictionary file")
        if o["mask"] is not None:
            raise CliError("'mask' cannot be used with a dictionary file")
    if o["mask"] is not None and o["startingPassword"] is not None:
        raise CliError("'startingPassword' cannot be used with a mask")
    for k in ("customCharset1", "customCharset2", "customCharset3", "customCharset4"):
        if o[k] is not None:
            parse_custom_charset(o[k])


def preset_to_charset(s, context="charset"):
    out = []
    for ch in s:
        if ch == "l": out += LOWER
        elif ch == "u": out += UPPER
        elif ch == "d": out += DIGITS
        elif ch == "s": out += SYMBOLS
        elif ch == "h": out += LOWER_HEX
        elif ch == "H": out += UPPER_HEX
        else:
            if context == "custom":
                raise CliError(f"Unknown token '?{ch}' in custom charset definition")
            raise CliError(f"Unknown charset option '{ch}'")
    return out


def sorted_dedup(chars):
    return sorted(set(chars))


def charset_from_options(o):
    if o["charsetFile"] is not None:
        with open(o["charsetFile"], "r", encoding="utf-8") as f:
            return sorted_dedup(list(f.read()))
    return sorted_dedup(preset_to_charset(o["charset"]))


def parse_custom_charset(s):
    out = []
    i = 0
    while i < len(s):
        if s[i] != "?":
            out.append(s[i]); i += 1; continue
        if i + 1 >= len(s):
            raise CliError("Custom charset definition ends with incomplete token '?'")
        t = s[i + 1]
        if t == "?": out.append("?")
        elif t in "luds hH".replace(" ", ""):
            out += preset_to_charset(t, "custom")
        else:
            raise CliError(f"Unknown token '?{t}' in custom charset definition")
        i += 2
    return sorted_dedup(out)


def parse_mask(mask, o):
    customs = {str(i): o[f"customCharset{i}"] for i in range(1, 5)}
    parts = []
    i = 0
    while i < len(mask):
        if mask[i] != "?":
            parts.append([mask[i]]); i += 1; continue
        if i + 1 >= len(mask):
            raise CliError("Mask ends with incomplete token '?'")
        t = mask[i + 1]
        if t == "?": parts.append(["?"])
        elif t == "a": parts.append(LOWER + UPPER + DIGITS + SYMBOLS)
        elif t in "luds hH".replace(" ", ""):
            parts.append(preset_to_charset(t))
        elif t in customs:
            if customs[t] is None:
                raise CliError(f"Custom charset ?{t} used in mask but --customCharset{t} not provided")
            parts.append(parse_custom_charset(customs[t]))
        else:
            raise CliError(f"Unknown mask token '?{t}'")
        i += 2
    return parts


def gen_bruteforce(charset, min_len, max_len, start):
    if start is None:
        pwd = [charset[0]] * min_len
    else:
        pwd = list(start)
    total_left = None
    yielded = 0
    while len(pwd) <= max_len:
        if total_left is not None and yielded >= total_left:
            return
        yield "".join(pwd).encode()
        yielded += 1
        carry = True
        for i in range(len(pwd) - 1, -1, -1):
            if not carry: break
            idx = charset.index(pwd[i])
            if idx == len(charset) - 1:
                pwd[i] = charset[0]
            else:
                pwd[i] = charset[idx + 1]
                carry = False
        if carry:
            pwd = [charset[0]] * (len(pwd) + 1)


def gen_mask(parts):
    if not parts:
        yield b""
        return
    idx = [0] * len(parts)
    while True:
        yield "".join(parts[i][idx[i]] for i in range(len(parts))).encode()
        for pos in range(len(idx) - 1, -1, -1):
            idx[pos] += 1
            if idx[pos] < len(parts[pos]):
                break
            idx[pos] = 0
        else:
            return


def gen_dictionary(path):
    with open(path, "rb") as f:
        for line in f:
            yield line.rstrip(b"\n").rstrip(b"\r")


def find_local_header(fp, info):
    fp.seek(info.header_offset)
    hdr = fp.read(30)
    if len(hdr) != 30 or hdr[:4] != b"PK\x03\x04":
        raise zipfile.BadZipFile("Bad magic number for file header")
    vals = struct.unpack("<IHHHHHIIIHH", hdr)
    nlen, xlen = vals[9], vals[10]
    name = fp.read(nlen)
    extra = fp.read(xlen)
    data_off = info.header_offset + 30 + nlen + xlen
    return extra, data_off


def aes_extra(extra):
    i = 0
    while i + 4 <= len(extra):
        hid, size = struct.unpack_from("<HH", extra, i)
        body = extra[i + 4:i + 4 + size]
        if hid == 0x9901 and len(body) >= 7:
            strength = body[4]
            actual = struct.unpack_from("<H", body, 5)[0]
            return strength, actual
        i += 4 + size
    return None


def verify_aes(fp, info, password):
    extra, data_off = find_local_header(fp, info)
    meta = aes_extra(extra)
    if meta is None:
        return False
    strength, _actual = meta
    salt_len = {1: 8, 2: 12, 3: 16}.get(strength, 16)
    key_len = {1: 16, 2: 24, 3: 32}.get(strength, 32)
    fp.seek(data_off)
    salt = fp.read(salt_len)
    verifier = fp.read(2)
    dk = hashlib.pbkdf2_hmac("sha1", password, salt, 1000, key_len * 2 + 2)
    return dk[-2:] == verifier


CRC_TABLE = []
for n in range(256):
    c = n
    for _ in range(8):
        c = 0xEDB88320 ^ (c >> 1) if c & 1 else c >> 1
    CRC_TABLE.append(c)


def zcrypto_update_keys(keys, c):
    keys[0] = binascii.crc32(bytes([c]), keys[0]) & 0xffffffff
    keys[1] = (keys[1] + (keys[0] & 0xff)) & 0xffffffff
    keys[1] = (keys[1] * 134775813 + 1) & 0xffffffff
    keys[2] = binascii.crc32(bytes([(keys[1] >> 24) & 0xff]), keys[2]) & 0xffffffff


def zcrypto_byte(keys):
    temp = (keys[2] | 2) & 0xffffffff
    return ((temp * (temp ^ 1)) >> 8) & 0xff


def verify_zipcrypto(fp, info, password):
    _extra, data_off = find_local_header(fp, info)
    keys = [0x12345678, 0x23456789, 0x34567890]
    for b in password:
        zcrypto_update_keys(keys, b)
    fp.seek(data_off)
    header = fp.read(12)
    if len(header) < 12:
        return False
    plain = []
    for b in header:
        c = b ^ zcrypto_byte(keys)
        zcrypto_update_keys(keys, c)
        plain.append(c)
    check = (info.CRC >> 24) & 0xff
    if info.flag_bits & 8:
        check = (info._raw_time >> 8) & 0xff if hasattr(info, "_raw_time") else check
    return plain[-1] == check


def is_encrypted(info):
    return bool(info.flag_bits & 1)


def select_info(zf, file_number):
    infos = zf.infolist()
    try:
        info = infos[file_number]
    except IndexError:
        info = None
    if info is not None and is_encrypted(info):
        return info
    for i, cand in enumerate(infos):
        if is_encrypted(cand):
            chosen_name = cand.filename
            sys.stderr.write(f"File at index {file_number} is not encrypted, auto-selecting file at index {i} ({chosen_name})\n")
            return cand
    raise CliError("No encrypted file found in zip archive")


def password_ok(zip_path, info, password):
    with open(zip_path, "rb") as fp:
        if info.compress_type == 99:
            return verify_aes(fp, info, password)
    if info.flag_bits & 1:
        try:
            with zipfile.ZipFile(zip_path) as zf:
                with zf.open(info, "r", pwd=password) as fh:
                    while fh.read(1024 * 64):
                        pass
            return True
        except Exception:
            return False
    return False


def format_elapsed(seconds):
    ns = max(0, int(seconds * 1_000_000_000))
    if ns >= 1_000_000_000:
        s, ns = divmod(ns, 1_000_000_000)
        ms, ns = divmod(ns, 1_000_000)
        us, ns = divmod(ns, 1_000)
        parts = [f"{s}s"]
        if ms: parts.append(f"{ms}ms")
        if us: parts.append(f"{us}us")
        if ns: parts.append(f"{ns}ns")
        return " ".join(parts)
    ms, ns = divmod(ns, 1_000_000)
    us, ns = divmod(ns, 1_000)
    parts = []
    if ms: parts.append(f"{ms}ms")
    if us: parts.append(f"{us}us")
    if ns or not parts: parts.append(f"{ns}ns")
    return " ".join(parts)


def run(argv):
    o = parse_args(argv)
    start = time.perf_counter()
    try:
        with zipfile.ZipFile(o["inputFile"]) as zf:
            info = select_info(zf, o["fileNumber"])
    except zipfile.BadZipFile as exc:
        raise Exception(f"Invalid zip file error - {exc}")
    if o["passwordDictionary"] is not None:
        candidates = gen_dictionary(o["passwordDictionary"])
    elif o["mask"] is not None:
        candidates = gen_mask(parse_mask(o["mask"], o))
    else:
        candidates = gen_bruteforce(charset_from_options(o), o["minPasswordLen"], o["maxPasswordLen"], o["startingPassword"])
    found = None
    for pwd in candidates:
        if password_ok(o["inputFile"], info, pwd):
            found = pwd.decode(errors="replace")
            break
    sys.stdout.write(f"Time elapsed: {format_elapsed(time.perf_counter() - start)}\n")
    if found is None:
        sys.stdout.write("Password not found\n")
    else:
        sys.stdout.write(f"Password found:{found}\n")
    return 0


def main():
    try:
        code = run(sys.argv[1:])
    except ClapExit as exc:
        (sys.stdout if exc.stream == "stdout" else sys.stderr).write(exc.text)
        code = exc.code
    except CliError as exc:
        sys.stderr.write(red(f"CLI argument error - \"{str(exc)}\"\n"))
        code = 1
    except Exception as exc:
        sys.stderr.write(str(exc) + "\n")
        code = 1
    sys.exit(code)


if __name__ == "__main__":
    main()
