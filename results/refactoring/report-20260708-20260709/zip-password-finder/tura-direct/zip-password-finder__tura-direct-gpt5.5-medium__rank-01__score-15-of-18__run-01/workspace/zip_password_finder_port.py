import itertools
import hashlib
import os
import struct
import sys
import time
import zipfile


VERSION = "0.11.1"
APP = "zip-password-finder.exe" if os.name == "nt" else "zip-password-finder"
RED = "\x1b[31;1m"
RESET = "\x1b[0m"

LOWER = "abcdefghijklmnopqrstuvwxyz"
UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
DIGITS = "0123456789"
HEX_LOWER = "0123456789abcdef"
HEX_UPPER = "0123456789ABCDEF"
SYMBOLS = " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"


class CliExit(Exception):
    def __init__(self, code, stdout="", stderr=""):
        self.code = code
        self.stdout = stdout
        self.stderr = stderr


def eprint_red(text):
    if text:
        for line in text.splitlines():
            print(line, file=sys.stderr)


def help_text(long=True):
    if not long:
        return (
            "Find the password of protected ZIP files\n\n"
            f"Usage: {APP} [OPTIONS] --inputFile <inputFile>\n\n"
            "Options:\n"
            "  -i, --inputFile <inputFile>                    path to zip input file\n"
            "  -w, --workers <workers>                        number of workers\n"
            "  -p, --passwordDictionary <passwordDictionary>  path to a password dictionary file\n"
            "  -c, --charset <charset>                        charset to use to generate password [default: lud]\n"
            "      --charsetFile <charsetFile>                path to a charset file\n"
            "      --minPasswordLen <minPasswordLen>          minimum password length [default: 1]\n"
            "      --maxPasswordLen <maxPasswordLen>          maximum password length [default: 10]\n"
            "      --fileNumber <fileNumber>                  file number in the zip archive [default: 0]\n"
            "  -s, --startingPassword <startingPassword>      password to start from\n"
            "  -m, --mask <mask>                              mask pattern for mask attack (e.g. '?l?l?l?d?d')\n"
            "  -1, --customCharset1 <customCharset1>          custom charset 1 for mask attack, referenced as ?1\n"
            "  -2, --customCharset2 <customCharset2>          custom charset 2 for mask attack, referenced as ?2\n"
            "  -3, --customCharset3 <customCharset3>          custom charset 3 for mask attack, referenced as ?3\n"
            "  -4, --customCharset4 <customCharset4>          custom charset 4 for mask attack, referenced as ?4\n"
            "  -h, --help                                     Print help\n"
            "  -V, --version                                  Print version\n"
        )
    return (
        "Find the password of protected ZIP files\n\n"
        f"Usage: {APP} [OPTIONS] --inputFile <inputFile>\n\n"
        "Options:\n"
        "  -i, --inputFile <inputFile>\n          path to zip input file\n\n"
        "  -w, --workers <workers>\n          number of workers\n\n"
        "  -p, --passwordDictionary <passwordDictionary>\n          path to a password dictionary file\n\n"
        "  -c, --charset <charset>\n          charset to use to generate password\n          \n          [default: lud]\n\n"
        "      --charsetFile <charsetFile>\n          path to a charset file\n\n"
        "      --minPasswordLen <minPasswordLen>\n          minimum password length\n          \n          [default: 1]\n\n"
        "      --maxPasswordLen <maxPasswordLen>\n          maximum password length\n          \n          [default: 10]\n\n"
        "      --fileNumber <fileNumber>\n          file number in the zip archive\n          \n          [default: 0]\n\n"
        "  -s, --startingPassword <startingPassword>\n          password to start from\n\n"
        "  -m, --mask <mask>\n          mask pattern for mask attack (e.g. '?l?l?l?d?d' for 3 lowercase + 2 digits).\n          \n"
        "          Available tokens:\n            ?l  lowercase letters [a-z]\n            ?u  uppercase letters [A-Z]\n            ?d  digits [0-9]\n            ?s  symbols\n            ?a  all printable (?l?u?d?s)\n            ?h  lowercase hex [0-9a-f]\n            ?H  uppercase hex [0-9A-F]\n            ?1  custom charset 1 (--customCharset1)\n            ?2  custom charset 2 (--customCharset2)\n            ?3  custom charset 3 (--customCharset3)\n            ?4  custom charset 4 (--customCharset4)\n            ??  literal '?'\n          \n          Any other character is treated as a literal.\n\n"
        "  -1, --customCharset1 <customCharset1>\n          custom charset 1 for mask attack, referenced as ?1 (e.g. 'aeiou' or '?l?d')\n\n"
        "  -2, --customCharset2 <customCharset2>\n          custom charset 2 for mask attack, referenced as ?2\n\n"
        "  -3, --customCharset3 <customCharset3>\n          custom charset 3 for mask attack, referenced as ?3\n\n"
        "  -4, --customCharset4 <customCharset4>\n          custom charset 4 for mask attack, referenced as ?4\n\n"
        "  -h, --help\n          Print help (see a summary with '-h')\n\n"
        "  -V, --version\n          Print version\n"
    )


def clap_error(msg, usage=None):
    if usage is None:
        usage = f"Usage: {APP} [OPTIONS] --inputFile <inputFile>"
    text = f"error: {msg}\n\n{usage}\n\nFor more information, try '--help'."
    raise CliExit(2, stderr=text)


def parse_usize(name, value):
    try:
        if value.startswith("-"):
            raise ValueError
        return int(value, 10)
    except Exception:
        clap_error(f"invalid value '{value}' for '{name}': invalid digit found in string")


def parse_args(argv):
    opts = {
        "charset": "lud",
        "minPasswordLen": 1,
        "maxPasswordLen": 10,
        "fileNumber": 0,
        "workers": None,
        "inputFile": None,
        "passwordDictionary": None,
        "charsetFile": None,
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
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-h", "--help"):
            raise CliExit(0, stdout=help_text(a == "--help"))
        if a in ("-V", "--version"):
            raise CliExit(0, stdout=f"zip-password-finder {VERSION}\n")
        if a not in names:
            clap_error(f"unexpected argument '{a}' found")
        key = names[a]
        if i + 1 >= len(argv) or argv[i + 1].startswith("-") and key not in ("startingPassword", "mask"):
            raise CliExit(2, stderr=f"error: a value is required for '{a} <{key}>' but none was supplied\n\nFor more information, try '--help'.")
        if i + 1 >= len(argv):
            raise CliExit(2, stderr=f"error: a value is required for '{a} <{key}>' but none was supplied\n\nFor more information, try '--help'.")
        val = argv[i + 1]
        if key in ("workers", "minPasswordLen", "maxPasswordLen", "fileNumber"):
            val = parse_usize(key, val)
        opts[key] = val
        i += 2
    if opts["inputFile"] is None:
        clap_error("the following required arguments were not provided:\n  --inputFile <inputFile>", f"Usage: {APP} --inputFile <inputFile>")
    return opts


def app_error(msg):
    raise CliExit(1, stderr=f"CLI argument error - \"{msg}\"")


def charset_from_choice(choice):
    out = ""
    for ch in choice:
        if ch == "l": out += LOWER
        elif ch == "u": out += UPPER
        elif ch == "d": out += DIGITS
        elif ch == "h": out += HEX_LOWER
        elif ch == "H": out += HEX_UPPER
        elif ch == "s": out += SYMBOLS
        else: app_error(f"'{choice}' is not a valid charset choice")
    return out


def parse_custom_charset(s):
    return "".join(parse_mask(s, {}, custom_mode=True))


def parse_mask(mask, custom, custom_mode=False):
    groups = []
    i = 0
    while i < len(mask):
        if mask[i] == "?" and i + 1 < len(mask):
            t = mask[i + 1]
            if t == "l": groups.append(LOWER)
            elif t == "u": groups.append(UPPER)
            elif t == "d": groups.append(DIGITS)
            elif t == "s": groups.append(SYMBOLS)
            elif t == "a": groups.append(LOWER + UPPER + DIGITS + SYMBOLS)
            elif t == "h": groups.append(HEX_LOWER)
            elif t == "H": groups.append(HEX_UPPER)
            elif t == "?": groups.append("?")
            elif t in "1234" and not custom_mode:
                v = custom.get(t)
                if not v:
                    app_error(f"custom charset ?{t} is referenced but not defined")
                groups.append(v)
            else:
                groups.append("?")
                groups.append(t)
            i += 2
        else:
            groups.append(mask[i])
            i += 1
    return groups


def gen_bruteforce(charset, min_len, max_len, starting=None):
    started = starting is None
    for n in range(min_len, max_len + 1):
        for tup in itertools.product(charset, repeat=n):
            pwd = "".join(tup)
            if not started:
                if pwd == starting:
                    started = True
                else:
                    continue
            yield pwd


def gen_mask(groups):
    for tup in itertools.product(*groups):
        yield "".join(tup)


def gen_dictionary(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            yield line.rstrip("\n").rstrip("\r")


def validate_zip(path, file_number):
    if not os.path.exists(path):
        app_error("'inputFile' does not exist")
    try:
        zf = zipfile.ZipFile(path)
    except Exception:
        raise CliExit(1, stderr="Invalid zip file")
    infos = zf.infolist()
    if file_number >= len(infos):
        for idx, info in enumerate(infos):
            if info.flag_bits & 1:
                print(f"File at index {file_number} is not encrypted, auto-selecting file at index {idx} ({info.filename})", file=sys.stderr)
                return zf, idx
        raise CliExit(1, stderr=f"File number {file_number} is out of bounds")
    target = file_number
    if not (infos[target].flag_bits & 1):
        for idx, info in enumerate(infos):
            if info.flag_bits & 1:
                print(f"File at index {file_number} is not encrypted, auto-selecting file at index {idx} ({info.filename})", file=sys.stderr)
                target = idx
                break
    return zf, target


def check_password(zf, idx, password):
    info = zf.infolist()[idx]
    if info.compress_type == 99:
        return check_aes_verifier(zf.filename, info, password)
    try:
        with zf.open(info, "r", pwd=password.encode("utf-8")) as f:
            while f.read(65536):
                pass
        return True
    except NotImplementedError:
        return False
    except RuntimeError:
        return False
    except zipfile.BadZipFile:
        return False
    except Exception:
        return False


def check_aes_verifier(path, info, password):
    try:
        with open(path, "rb") as f:
            f.seek(info.header_offset)
            header = f.read(30)
            if len(header) != 30:
                return False
            sig, _ver, _flag, _cm, _mt, _md, _crc, _cs, _us, name_len, extra_len = struct.unpack("<IHHHHHIIIHH", header)
            if sig != 0x04034B50:
                return False
            f.read(name_len)
            extra = f.read(extra_len)
            strength = None
            pos = 0
            while pos + 4 <= len(extra):
                hid, size = struct.unpack_from("<HH", extra, pos)
                body = extra[pos + 4:pos + 4 + size]
                if hid == 0x9901 and len(body) >= 7:
                    strength = body[4]
                    break
                pos += 4 + size
            if strength == 1:
                key_len, salt_len = 16, 8
            elif strength == 2:
                key_len, salt_len = 24, 12
            elif strength == 3:
                key_len, salt_len = 32, 16
            else:
                return False
            salt = f.read(salt_len)
            verifier = f.read(2)
            derived = hashlib.pbkdf2_hmac("sha1", password.encode("utf-8"), salt, 1000, key_len * 2 + 2)
            return derived[-2:] == verifier
    except Exception:
        return False


def fmt_elapsed(seconds):
    if seconds >= 1:
        whole = int(seconds)
        ms = int((seconds - whole) * 1000)
        return f"{whole}s {ms}ms"
    ms = int(seconds * 1000)
    us = int((seconds * 1_000_000) % 1000)
    return f"{ms}ms {us}us"


def run(argv):
    opts = parse_args(argv)
    if opts["passwordDictionary"] and not os.path.exists(opts["passwordDictionary"]):
        app_error("'passwordDictionary' does not exist")
    if opts["charsetFile"]:
        if not os.path.exists(opts["charsetFile"]):
            app_error("'charsetFile' does not exist")
        with open(opts["charsetFile"], "r", encoding="utf-8", errors="replace") as f:
            charset = f.readline().rstrip("\n").rstrip("\r")
    else:
        charset = charset_from_choice(opts["charset"])
    zf, idx = validate_zip(opts["inputFile"], opts["fileNumber"])
    if opts["passwordDictionary"]:
        passwords = gen_dictionary(opts["passwordDictionary"])
    elif opts["mask"] is not None:
        custom = {}
        for n in "1234":
            v = opts.get(f"customCharset{n}")
            if v is not None:
                custom[n] = parse_custom_charset(v)
        passwords = gen_mask(parse_mask(opts["mask"], custom))
    else:
        passwords = gen_bruteforce(charset, opts["minPasswordLen"], opts["maxPasswordLen"], opts["startingPassword"])
    start = time.perf_counter()
    found = None
    for pwd in passwords:
        if check_password(zf, idx, pwd):
            found = pwd
            break
    print(f"Time elapsed: {fmt_elapsed(time.perf_counter() - start)}")
    if found is None:
        print("Password not found")
    else:
        print(f"Password found:{found}")
    return 0


def main():
    try:
        code = run(sys.argv[1:])
    except CliExit as e:
        if e.stdout:
            sys.stdout.write(e.stdout)
        if e.stderr:
            eprint_red(e.stderr) if e.code != 0 else sys.stderr.write(e.stderr)
        code = e.code
    return code


if __name__ == "__main__":
    raise SystemExit(main())
