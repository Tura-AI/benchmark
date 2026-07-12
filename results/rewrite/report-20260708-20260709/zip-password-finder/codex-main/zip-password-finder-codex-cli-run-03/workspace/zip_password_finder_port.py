import hashlib
import hmac
import os
import struct
import sys
import time
import zipfile
import zlib
from concurrent.futures import ProcessPoolExecutor


LOWER = list("abcdefghijklmnopqrstuvwxyz")
UPPER = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = list("0123456789")
SYMBOLS = list(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
LOWER_HEX = list("0123456789abcdef")
UPPER_HEX = list("0123456789ABCDEF")


class FinderError(Exception):
    def __init__(self, kind, message):
        self.kind = kind
        self.message = message

    def __str__(self):
        if self.kind == "cli":
            return f'CLI argument error - "{self.message}"'
        if self.kind == "zip":
            return f"Invalid zip file error - {self.message}"
        if self.kind == "io":
            return f"standard I/O error - {self.message}"
        return self.message


def parse_usize(text):
    try:
        value = int(text, 10)
    except ValueError:
        raise ValueError("invalid digit found in string")
    if value < 0:
        raise ValueError("invalid digit found in string")
    return value


class Args:
    input_file = None
    workers = None
    password_dictionary = None
    charset = "lud"
    charset_file = None
    minPasswordLen = 1
    maxPasswordLen = 10
    fileNumber = 0
    starting_password = None
    mask = None
    custom1 = None
    custom2 = None
    custom3 = None
    custom4 = None


def clap_error(message, usage=True):
    print(f"error: {message}", file=sys.stderr)
    if usage:
        print("", file=sys.stderr)
        print("Usage: zip-password-finder.exe --inputFile <inputFile>", file=sys.stderr)
    print("", file=sys.stderr)
    print("For more information, try '--help'.", file=sys.stderr)
    raise SystemExit(2)


def parse_cli(argv):
    opts = {
        "-i": ("input_file", "--inputFile", False),
        "--inputFile": ("input_file", "--inputFile", False),
        "-w": ("workers", "--workers", True),
        "--workers": ("workers", "--workers", True),
        "-p": ("password_dictionary", "--passwordDictionary", False),
        "--passwordDictionary": ("password_dictionary", "--passwordDictionary", False),
        "-c": ("charset", "--charset", False),
        "--charset": ("charset", "--charset", False),
        "--charsetFile": ("charset_file", "--charsetFile", False),
        "--minPasswordLen": ("minPasswordLen", "--minPasswordLen", True),
        "--maxPasswordLen": ("maxPasswordLen", "--maxPasswordLen", True),
        "--fileNumber": ("fileNumber", "--fileNumber", True),
        "-s": ("starting_password", "--startingPassword", False),
        "--startingPassword": ("starting_password", "--startingPassword", False),
        "-m": ("mask", "--mask", False),
        "--mask": ("mask", "--mask", False),
        "-1": ("custom1", "--customCharset1", False),
        "--customCharset1": ("custom1", "--customCharset1", False),
        "-2": ("custom2", "--customCharset2", False),
        "--customCharset2": ("custom2", "--customCharset2", False),
        "-3": ("custom3", "--customCharset3", False),
        "--customCharset3": ("custom3", "--customCharset3", False),
        "-4": ("custom4", "--customCharset4", False),
        "--customCharset4": ("custom4", "--customCharset4", False),
    }
    args = Args()
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in ("-h", "--help"):
            print_help()
            raise SystemExit(0)
        if arg in ("-V", "--version"):
            print("zip-password-finder 0.11.1")
            raise SystemExit(0)
        value_from_eq = None
        key = arg
        if arg.startswith("--") and "=" in arg:
            key, value_from_eq = arg.split("=", 1)
        if key not in opts:
            clap_error(f"unexpected argument '{arg}' found")
        attr, display, numeric = opts[key]
        if value_from_eq is not None:
            value = value_from_eq
        else:
            if i + 1 >= len(argv) or (argv[i + 1] in opts and not numeric):
                clap_error(f"a value is required for '{display} <{attr_to_value(attr)}>' but none was supplied", usage=False)
            i += 1
            value = argv[i]
        if numeric:
            try:
                value = parse_usize(value)
            except ValueError as e:
                clap_error(f"invalid value '{value}' for '{display} <{attr_to_value(attr)}>': {e}", usage=False)
        setattr(args, attr, value)
        i += 1
    if args.input_file is None:
        print("error: the following required arguments were not provided:", file=sys.stderr)
        print("  --inputFile <inputFile>", file=sys.stderr)
        print("", file=sys.stderr)
        print("Usage: zip-password-finder.exe --inputFile <inputFile>", file=sys.stderr)
        print("", file=sys.stderr)
        print("For more information, try '--help'.", file=sys.stderr)
        raise SystemExit(2)
    return args


def attr_to_value(attr):
    return {
        "input_file": "inputFile",
        "password_dictionary": "passwordDictionary",
        "charset_file": "charsetFile",
        "minPasswordLen": "minPasswordLen",
        "maxPasswordLen": "maxPasswordLen",
        "fileNumber": "fileNumber",
        "starting_password": "startingPassword",
        "custom1": "customCharset1",
        "custom2": "customCharset2",
        "custom3": "customCharset3",
        "custom4": "customCharset4",
    }.get(attr, attr)


def print_help():
    print("""Find the password of protected ZIP files

Usage: zip-password-finder.exe [OPTIONS] --inputFile <inputFile>

Options:
  -i, --inputFile <inputFile>                    path to zip input file
  -w, --workers <workers>                        number of workers
  -p, --passwordDictionary <passwordDictionary>  path to a password dictionary file
  -c, --charset <charset>                        charset to use to generate password [default: lud]
      --charsetFile <charsetFile>                path to a charset file
      --minPasswordLen <minPasswordLen>          minimum password length [default: 1]
      --maxPasswordLen <maxPasswordLen>          maximum password length [default: 10]
      --fileNumber <fileNumber>                  file number in the zip archive [default: 0]
  -s, --startingPassword <startingPassword>      password to start from
  -m, --mask <mask>                              mask pattern for mask attack (e.g. '?l?l?l?d?d')
  -1, --customCharset1 <customCharset1>          custom charset 1 for mask attack, referenced as ?1
  -2, --customCharset2 <customCharset2>          custom charset 2 for mask attack, referenced as ?2
  -3, --customCharset3 <customCharset3>          custom charset 3 for mask attack, referenced as ?3
  -4, --customCharset4 <customCharset4>          custom charset 4 for mask attack, referenced as ?4
  -h, --help                                     Print help
  -V, --version                                  Print version""")


def preset_to_charset(choice):
    out = []
    for ch in choice:
        if ch == "l":
            out.extend(LOWER)
        elif ch == "u":
            out.extend(UPPER)
        elif ch == "d":
            out.extend(DIGITS)
        elif ch == "s":
            out.extend(SYMBOLS)
        elif ch == "h":
            out.extend(LOWER_HEX)
        elif ch == "H":
            out.extend(UPPER_HEX)
        else:
            raise FinderError("cli", f"Unknown charset option '{ch}'")
    return out


def charset_from_choice(args):
    if args.charset_file:
        try:
            data = open(args.charset_file, "r", encoding="utf-8").read()
        except OSError as e:
            raise FinderError("io", str(e))
        charset = list(data)
    else:
        charset = preset_to_charset(args.charset)
    return sorted(set(charset))


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


def parse_custom_charset(definition):
    charset = []
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
                built = builtin_token(token)
                if built is None:
                    raise FinderError("cli", f"Unknown token '?{token}' in custom charset definition")
                charset.extend(built)
        else:
            charset.append(c)
        i += 1
    if not charset:
        raise FinderError("cli", "Custom charset definition is empty")
    seen = []
    for c in charset:
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
                raise FinderError("cli", "Mask ends with incomplete token '?'")
            token = mask[i]
            if token == "?":
                positions.append(["?"])
            elif token in "1234":
                idx = int(token) - 1
                if custom[idx] is None:
                    raise FinderError("cli", f"Custom charset ?{token} used in mask but --customCharset{token} not provided")
                positions.append(custom[idx])
            else:
                built = builtin_token(token)
                if built is None:
                    raise FinderError("cli", f"Unknown mask token '?{token}'")
                positions.append(built)
        else:
            positions.append([c])
        i += 1
    if not positions:
        raise FinderError("cli", "Mask pattern is empty")
    return positions


def validate_args(args):
    if not os.path.isfile(args.input_file):
        raise FinderError("cli", "'inputFile' does not exist")
    if args.password_dictionary and not os.path.isfile(args.password_dictionary):
        raise FinderError("cli", "'passwordDictionary' does not exist")
    if args.charset_file and not os.path.isfile(args.charset_file):
        raise FinderError("cli", "'charsetFile' does not exist")
    if args.workers == 0:
        raise FinderError("cli", "'workers' must be positive")
    if args.minPasswordLen == 0:
        raise FinderError("cli", "'minPasswordLen' must be positive")
    if args.maxPasswordLen == 0:
        raise FinderError("cli", "'maxPasswordLen' must be positive")
    if args.minPasswordLen > args.maxPasswordLen:
        raise FinderError("cli", "'maxPasswordLen' must be equal or greater than 'minPasswordLen'")

    custom = [None, None, None, None]
    for idx, attr in enumerate(("custom1", "custom2", "custom3", "custom4"), start=1):
        val = getattr(args, attr)
        if val is not None:
            if args.mask is None:
                raise FinderError("cli", f"'--customCharset{idx}' can only be used with --mask")
            custom[idx - 1] = parse_custom_charset(val)

    if args.mask is not None and args.password_dictionary is not None:
        raise FinderError("cli", "'mask' cannot be used with a dictionary file")
    if args.starting_password is not None:
        if args.password_dictionary is not None:
            raise FinderError("cli", "'startingPassword' cannot be used with a dictionary file")
        if args.mask is not None:
            raise FinderError("cli", "'startingPassword' cannot be used with mask attack")
        charset = charset_from_choice(args)
        if any(c not in charset for c in args.starting_password):
            raise FinderError("cli", "'startingPassword' uses characters out of the generation charset")
        ln = len(args.starting_password)
        if ln > args.maxPasswordLen or ln < args.minPasswordLen:
            raise FinderError("cli", "'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration")
    return custom


def count_passwords(charset_len, min_len, max_len):
    return sum(charset_len ** n for n in range(min_len, max_len + 1))


def count_already_generated(charset, min_len, password):
    base = len(charset)
    count = sum(base ** n for n in range(min_len, len(password)))
    for i, c in enumerate(reversed(password)):
        count += charset.index(c) * (base ** i)
    return count + 1


def brute_passwords(charset, min_len, max_len, start=None):
    if start is None:
        pwd = [charset[0]] * min_len
        total = count_passwords(len(charset), min_len, max_len)
    else:
        pwd = list(start)
        total = count_passwords(len(charset), min_len, max_len) - count_already_generated(charset, min_len, start)
    generated = 0
    while len(pwd) <= max_len and generated < total:
        yield "".join(pwd).encode("utf-8")
        generated += 1
        if generated >= total:
            break
        carry = True
        for i in range(len(pwd) - 1, -1, -1):
            idx = charset.index(pwd[i])
            if idx < len(charset) - 1:
                pwd[i] = charset[idx + 1]
                carry = False
                break
            pwd[i] = charset[0]
        if carry:
            pwd = [charset[0]] * (len(pwd) + 1)


def dict_passwords(path):
    with open(path, "rb") as f:
        for line in f:
            if line.endswith(b"\n"):
                line = line[:-1]
                if line.endswith(b"\r"):
                    line = line[:-1]
            yield line


def mask_passwords(positions):
    indices = [0] * len(positions)
    total = 1
    for pos in positions:
        total *= len(pos)
    for _ in range(total):
        yield "".join(positions[i][indices[i]] for i in range(len(indices))).encode("utf-8")
        for i in range(len(indices) - 1, -1, -1):
            indices[i] += 1
            if indices[i] < len(positions[i]):
                break
            indices[i] = 0


def archive_listing(zf):
    infos = zf.infolist()
    lines = [f"Archive contents ({len(infos)} files):"]
    for i, info in enumerate(infos[:20]):
        kind = "dir" if info.filename.endswith("/") else "file"
        enc = ", encrypted" if info.flag_bits & 1 else ""
        lines.append(f"  [{i}] {info.filename} ({kind}{enc})")
    if len(infos) > 20:
        lines.append(f"  ... and {len(infos) - 20} more files")
    return "\n".join(lines)


def validate_zip(path, requested):
    try:
        zf = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as e:
        raise FinderError("zip", str(e))
    infos = zf.infolist()
    if requested < len(infos) and infos[requested].flag_bits & 1:
        return zf, requested
    first = None
    for i, info in enumerate(infos):
        if info.flag_bits & 1:
            first = i
            break
    if first is None:
        raise FinderError("zip", f"no encrypted file found in archive\n{archive_listing(zf)}")
    name = infos[first].filename
    print(f"File at index {requested} is not encrypted, auto-selecting file at index {first} ({name})", file=sys.stderr)
    return zf, first


def aes_extra(info):
    data = info.extra
    i = 0
    while i + 4 <= len(data):
        hid, size = struct.unpack_from("<HH", data, i)
        body = data[i + 4:i + 4 + size]
        if hid == 0x9901 and len(body) >= 7:
            ver, vendor, strength, method = struct.unpack_from("<H2sBH", body, 0)
            key_len = {1: 16, 2: 24, 3: 32}.get(strength)
            return key_len, method
        i += 4 + size
    return None


SBOX = [
    99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,
    183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,
    9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,
    170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,
    19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,
    58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,
    37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,
    152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22
]
RCON = [0,1,2,4,8,16,32,64,128,27,54]


def xtime(a):
    return ((a << 1) ^ 0x1B) & 0xFF if a & 0x80 else (a << 1)


def sub_word(w):
    return [SBOX[b] for b in w]


def rot_word(w):
    return w[1:] + w[:1]


def expand_key(key):
    nk = len(key) // 4
    nr = nk + 6
    words = [list(key[i:i + 4]) for i in range(0, len(key), 4)]
    for i in range(nk, 4 * (nr + 1)):
        temp = words[i - 1][:]
        if i % nk == 0:
            temp = sub_word(rot_word(temp))
            temp[0] ^= RCON[i // nk]
        elif nk > 6 and i % nk == 4:
            temp = sub_word(temp)
        words.append([words[i - nk][j] ^ temp[j] for j in range(4)])
    return [sum(words[4*r:4*r+4], []) for r in range(nr + 1)]


def add_round_key(s, rk):
    for i in range(16):
        s[i] ^= rk[i]


def sub_bytes(s):
    for i in range(16):
        s[i] = SBOX[s[i]]


def shift_rows(s):
    s[1], s[5], s[9], s[13] = s[5], s[9], s[13], s[1]
    s[2], s[6], s[10], s[14] = s[10], s[14], s[2], s[6]
    s[3], s[7], s[11], s[15] = s[15], s[3], s[7], s[11]


def mix_columns(s):
    for c in range(4):
        i = 4 * c
        a = s[i:i + 4]
        t = a[0] ^ a[1] ^ a[2] ^ a[3]
        u = a[0]
        s[i] ^= t ^ xtime(a[0] ^ a[1])
        s[i + 1] ^= t ^ xtime(a[1] ^ a[2])
        s[i + 2] ^= t ^ xtime(a[2] ^ a[3])
        s[i + 3] ^= t ^ xtime(a[3] ^ u)


def aes_encrypt_block(block, round_keys):
    s = list(block)
    add_round_key(s, round_keys[0])
    for rnd in range(1, len(round_keys) - 1):
        sub_bytes(s)
        shift_rows(s)
        mix_columns(s)
        add_round_key(s, round_keys[rnd])
    sub_bytes(s)
    shift_rows(s)
    add_round_key(s, round_keys[-1])
    return bytes(s)


def aes_ctr_decrypt(data, key):
    keys = expand_key(key)
    out = bytearray()
    counter = 1
    for off in range(0, len(data), 16):
        stream = aes_encrypt_block(counter.to_bytes(16, "little"), keys)
        chunk = data[off:off + 16]
        out.extend(b ^ stream[i] for i, b in enumerate(chunk))
        counter += 1
    return bytes(out)


def local_encrypted_payload(path, info):
    with open(path, "rb") as f:
        f.seek(info.header_offset)
        hdr = f.read(30)
        if len(hdr) != 30 or hdr[:4] != b"PK\x03\x04":
            raise FinderError("zip", "invalid Zip archive")
        name_len, extra_len = struct.unpack_from("<HH", hdr, 26)
        f.seek(name_len + extra_len, 1)
        return f.read(info.compress_size)


def try_aes(path, info, password):
    extra = aes_extra(info)
    if not extra:
        return False
    key_len, method = extra
    salt_len = {16: 8, 24: 12, 32: 16}[key_len]
    payload = local_encrypted_payload(path, info)
    if len(payload) < salt_len + 12:
        return False
    salt = payload[:salt_len]
    verifier = payload[salt_len:salt_len + 2]
    cipher = payload[salt_len + 2:-10]
    auth = payload[-10:]
    derived = hashlib.pbkdf2_hmac("sha1", password, salt, 1000, 2 * key_len + 2)
    if derived[-2:] != verifier:
        return False
    if hmac.new(derived[key_len:2 * key_len], cipher, hashlib.sha1).digest()[:10] != auth:
        return False
    plain = aes_ctr_decrypt(cipher, derived[:key_len])
    try:
        if method == zipfile.ZIP_DEFLATED:
            zlib.decompress(plain, -15)
        else:
            bytes(plain)
        return True
    except zlib.error:
        return False


def try_aes_payload(task):
    key_len, method, salt, verifier, cipher, auth, passwords = task
    for password in passwords:
        derived = hashlib.pbkdf2_hmac("sha1", password, salt, 1000, 2 * key_len + 2)
        if derived[-2:] != verifier:
            continue
        if hmac.new(derived[key_len:2 * key_len], cipher, hashlib.sha1).digest()[:10] != auth:
            continue
        plain = aes_ctr_decrypt(cipher, derived[:key_len])
        try:
            if method == zipfile.ZIP_DEFLATED:
                zlib.decompress(plain, -15)
            else:
                bytes(plain)
            return password
        except zlib.error:
            pass
    return None


def aes_payload_params(path, info):
    extra = aes_extra(info)
    if not extra:
        return None
    key_len, method = extra
    salt_len = {16: 8, 24: 12, 32: 16}[key_len]
    payload = local_encrypted_payload(path, info)
    if len(payload) < salt_len + 12:
        return None
    salt = payload[:salt_len]
    verifier = payload[salt_len:salt_len + 2]
    cipher = payload[salt_len + 2:-10]
    auth = payload[-10:]
    return key_len, method, salt, verifier, cipher, auth


def chunked(iterable, size):
    chunk = []
    for item in iterable:
        chunk.append(item)
        if len(chunk) == size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def try_zipcrypto(zf, info, password):
    try:
        with zf.open(info, "r", pwd=password) as f:
            while f.read(65536):
                pass
        return True
    except Exception:
        return False


def find_password(args, custom):
    zf, idx = validate_zip(args.input_file, args.fileNumber)
    info = zf.infolist()[idx]
    if args.password_dictionary:
        candidates = dict_passwords(args.password_dictionary)
    elif args.mask:
        candidates = mask_passwords(parse_mask(args.mask, custom))
    else:
        candidates = brute_passwords(charset_from_choice(args), args.minPasswordLen, args.maxPasswordLen, args.starting_password)
    is_aes = info.compress_type == 99 or aes_extra(info) is not None
    if is_aes:
        params = aes_payload_params(args.input_file, info)
        if params is None:
            return None
        worker_count = max(os.cpu_count() or 1, args.workers or 1)
        if worker_count > 1:
            tasks = ((*params, chunk) for chunk in chunked(candidates, 256))
            with ProcessPoolExecutor(max_workers=worker_count) as pool:
                for found in pool.map(try_aes_payload, tasks, chunksize=1):
                    if found is not None:
                        pool.shutdown(cancel_futures=True)
                        return found.decode("utf-8", errors="replace")
            return None
    for password in candidates:
        if is_aes:
            ok = try_aes(args.input_file, info, password)
        else:
            ok = try_zipcrypto(zf, info, password)
        if ok:
            return password.decode("utf-8", errors="replace")
    return None


def fmt_duration(seconds):
    ns = int(seconds * 1_000_000_000)
    parts = []
    h, ns = divmod(ns, 3_600_000_000_000)
    m, ns = divmod(ns, 60_000_000_000)
    s, ns = divmod(ns, 1_000_000_000)
    ms, ns = divmod(ns, 1_000_000)
    us, ns = divmod(ns, 1_000)
    if h:
        parts.append(f"{h}h")
    if m:
        parts.append(f"{m}m")
    if s:
        parts.append(f"{s}s")
    if ms:
        parts.append(f"{ms}ms")
    if us:
        parts.append(f"{us}us")
    if ns or not parts:
        parts.append(f"{ns}ns")
    return " ".join(parts)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        args = parse_cli(argv)
        custom = validate_args(args)
        start = time.perf_counter()
        password = find_password(args, custom)
        print(f"Time elapsed: {fmt_duration(time.perf_counter() - start)}")
        if password is None:
            print("Password not found")
        else:
            print(f"Password found:{password}")
        return 0
    except FinderError as e:
        print(str(e), file=sys.stderr)
        return 1
    except SystemExit as e:
        return int(e.code or 0)


if __name__ == "__main__":
    sys.exit(main())
