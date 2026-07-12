#!/usr/bin/env python3
"""Python port of zip-password-finder 0.11.1."""

import binascii
import hashlib
import hmac
import itertools
import os
import struct
import sys
import time
import zlib


LOWER = list("abcdefghijklmnopqrstuvwxyz")
UPPER = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = list("0123456789")
SYMBOLS = list(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
BUILTINS = {
    "l": LOWER,
    "u": UPPER,
    "d": DIGITS,
    "s": SYMBOLS,
    "a": LOWER + UPPER + DIGITS + SYMBOLS,
    "h": list("0123456789abcdef"),
    "H": list("0123456789ABCDEF"),
}

HELP = """Find the password of protected ZIP files

Usage: {program} [OPTIONS] --inputFile <inputFile>

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


class PortError(Exception):
    pass


def cli_error(message):
    raise PortError('CLI argument error - "' + message.replace('"', '\\"') + '"')


def clap_error(message, usage=None):
    text = "error: " + message + "\n\n"
    if usage:
        text += "Usage: " + usage + "\n\n"
    text += "For more information, try '--help'.\n"
    sys.stderr.write(text)
    raise SystemExit(2)


OPTIONS = {
    "-i": "inputFile", "--inputFile": "inputFile",
    "-w": "workers", "--workers": "workers",
    "-p": "passwordDictionary", "--passwordDictionary": "passwordDictionary",
    "-c": "charset", "--charset": "charset",
    "--charsetFile": "charsetFile",
    "--minPasswordLen": "minPasswordLen", "--maxPasswordLen": "maxPasswordLen",
    "--fileNumber": "fileNumber",
    "-s": "startingPassword", "--startingPassword": "startingPassword",
    "-m": "mask", "--mask": "mask",
    "-1": "customCharset1", "--customCharset1": "customCharset1",
    "-2": "customCharset2", "--customCharset2": "customCharset2",
    "-3": "customCharset3", "--customCharset3": "customCharset3",
    "-4": "customCharset4", "--customCharset4": "customCharset4",
}


def program_name():
    return "zip-password-finder.exe" if os.name == "nt" else "zip-password-finder"


def parse_args(argv):
    if "--help" in argv or "-h" in argv:
        sys.stdout.write(HELP.format(program=program_name()))
        raise SystemExit(0)
    if "--version" in argv or "-V" in argv:
        print("zip-password-finder 0.11.1")
        raise SystemExit(0)
    values = {"charset": "lud", "minPasswordLen": "1", "maxPasswordLen": "10", "fileNumber": "0"}
    i = 0
    while i < len(argv):
        raw = argv[i]
        attached = None
        if raw.startswith("--") and "=" in raw:
            raw, attached = raw.split("=", 1)
        if raw not in OPTIONS:
            clap_error("unexpected argument '" + raw + "' found", program_name() + " [OPTIONS] --inputFile <inputFile>")
        key = OPTIONS[raw]
        if key in values and key not in ("charset", "minPasswordLen", "maxPasswordLen", "fileNumber"):
            clap_error("the argument '" + raw + " <" + key + ">' cannot be used multiple times")
        if attached is None:
            i += 1
            if i >= len(argv) or argv[i] in OPTIONS:
                clap_error("a value is required for '" + raw + " <" + key + ">' but none was supplied")
            attached = argv[i]
        values[key] = attached
        i += 1
    if "inputFile" not in values:
        clap_error("the following required arguments were not provided:\n  --inputFile <inputFile>", program_name() + " --inputFile <inputFile>")
    for key in ("workers", "minPasswordLen", "maxPasswordLen", "fileNumber"):
        if key in values:
            value = values[key]
            try:
                if value.startswith("-") or not value.isascii():
                    raise ValueError
                values[key] = int(value)
            except ValueError:
                clap_error("invalid value '" + value + "' for '--" + key + " <" + key + ">': invalid digit found in string")
    validate_args(values)
    return values


def validate_args(v):
    if not os.path.isfile(v["inputFile"]):
        cli_error("'inputFile' does not exist")
    if v.get("passwordDictionary") and not os.path.isfile(v["passwordDictionary"]):
        cli_error("'passwordDictionary' does not exist")
    if v.get("charsetFile") and not os.path.isfile(v["charsetFile"]):
        cli_error("'charsetFile' does not exist")
    if v.get("workers") == 0:
        cli_error("'workers' must be positive")
    if v["minPasswordLen"] == 0:
        cli_error("'minPasswordLen' must be positive")
    if v["maxPasswordLen"] == 0:
        cli_error("'maxPasswordLen' must be positive")
    if v["minPasswordLen"] > v["maxPasswordLen"]:
        cli_error("'maxPasswordLen' must be equal or greater than 'minPasswordLen'")
    custom = [None] * 4
    for n in range(1, 5):
        key = "customCharset" + str(n)
        if key in v:
            if "mask" not in v:
                cli_error("'--" + key + "' can only be used with --mask")
            custom[n - 1] = parse_custom(v[key])
    v["custom"] = custom
    if "mask" in v and "passwordDictionary" in v:
        cli_error("'mask' cannot be used with a dictionary file")
    if "startingPassword" in v:
        if "passwordDictionary" in v:
            cli_error("'startingPassword' cannot be used with a dictionary file")
        if "mask" in v:
            cli_error("'startingPassword' cannot be used with mask attack")
        charset = get_charset(v)
        if any(c not in charset for c in v["startingPassword"]):
            cli_error("'startingPassword' uses characters out of the generation charset")
        if not v["minPasswordLen"] <= len(v["startingPassword"]) <= v["maxPasswordLen"]:
            cli_error("'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration")


def dedup(items):
    return list(dict.fromkeys(items))


def parse_custom(text):
    result = []
    i = 0
    while i < len(text):
        if text[i] != "?":
            result.append(text[i]); i += 1; continue
        i += 1
        if i == len(text):
            cli_error("Custom charset definition ends with incomplete token '?'")
        token = text[i]; i += 1
        if token == "?": result.append("?")
        elif token in BUILTINS: result.extend(BUILTINS[token])
        else: cli_error("Unknown token '?" + token + "' in custom charset definition")
    if not result:
        cli_error("Custom charset definition is empty")
    return dedup(result)


def parse_mask(text, custom):
    positions = []
    i = 0
    while i < len(text):
        if text[i] != "?": positions.append([text[i]]); i += 1; continue
        i += 1
        if i == len(text): cli_error("Mask ends with incomplete token '?'")
        token = text[i]; i += 1
        if token == "?": positions.append(["?"])
        elif token in "1234":
            chars = custom[int(token) - 1]
            if chars is None: cli_error("Custom charset ?" + token + " used in mask but --customCharset" + token + " not provided")
            positions.append(chars)
        elif token in BUILTINS: positions.append(BUILTINS[token])
        else: cli_error("Unknown mask token '?" + token + "'")
    if not positions: cli_error("Mask cannot be empty")
    return positions


def get_charset(v):
    if "charsetFile" in v:
        try:
            with open(v["charsetFile"], "r", encoding="utf-8") as f: chars = list(f.read())
        except OSError as e:
            raise PortError("standard I/O error - " + str(e))
    else:
        chars = []
        for token in v["charset"]:
            if token not in BUILTINS or token == "a": cli_error("Unknown charset option '" + token + "'")
            chars.extend(BUILTINS[token])
    return sorted(set(chars))


def candidates(v):
    if "passwordDictionary" in v:
        with open(v["passwordDictionary"], "rb") as f:
            for line in f:
                if line.endswith(b"\n"):
                    line = line[:-1]
                    if line.endswith(b"\r"): line = line[:-1]
                yield line
        return
    if "mask" in v:
        positions = parse_mask(v["mask"], v["custom"])
        for item in itertools.product(*positions):
            yield bytes((ord(c) & 255 for c in item))
        return
    charset_chars = get_charset(v)
    charset = [ord(c) & 255 for c in charset_chars]
    start = v.get("startingPassword")
    started = start is None
    start_bytes = start.encode("utf-8") if start is not None else None
    remaining = None
    if start is not None:
        base = len(charset_chars)
        already = sum(base ** length for length in range(v["minPasswordLen"], len(start.encode("utf-8"))))
        already += sum(charset_chars.index(c) * base ** i for i, c in enumerate(reversed(start))) + 1
        total = sum(base ** length for length in range(v["minPasswordLen"], v["maxPasswordLen"] + 1))
        remaining = total - already
    for length in range(v["minPasswordLen"], v["maxPasswordLen"] + 1):
        for item in itertools.product(charset, repeat=length):
            password = bytes(item)
            if not started:
                if password == start_bytes: started = True
                else: continue
            if remaining is not None:
                if remaining == 0: return
                remaining -= 1
            yield password


def extra_fields(data):
    pos = 0
    while pos + 4 <= len(data):
        kind, size = struct.unpack_from("<HH", data, pos); pos += 4
        yield kind, data[pos:pos + size]
        pos += size


def parse_archive(path):
    try:
        data = open(path, "rb").read()
    except OSError as e:
        raise PortError("standard I/O error - " + str(e))
    eocd = data.rfind(b"PK\x05\x06")
    if eocd < 0 or eocd + 22 > len(data):
        raise PortError("Invalid zip file error - invalid Zip archive: Could not find central directory end")
    count = struct.unpack_from("<H", data, eocd + 10)[0]
    pos = struct.unpack_from("<I", data, eocd + 16)[0]
    entries = []
    for _ in range(count):
        if data[pos:pos + 4] != b"PK\x01\x02":
            raise PortError("Invalid zip file error - invalid Zip archive: Invalid central directory header")
        fields = struct.unpack_from("<5H3I5H2I", data, pos + 6)
        flags, method, mtime, mdate = fields[1:5]
        crc, csize, usize = fields[5:8]
        nlen, xlen, clen = fields[8:11]
        offset = fields[-1]
        raw_name = data[pos + 46:pos + 46 + nlen]
        encoding = "utf-8" if flags & 0x800 else "cp437"
        name = raw_name.decode(encoding, "replace")
        extra = data[pos + 46 + nlen:pos + 46 + nlen + xlen]
        aes = None
        actual_method = method
        for kind, value in extra_fields(extra):
            if kind == 0x9901 and len(value) >= 7:
                strength = value[4]
                actual_method = struct.unpack_from("<H", value, 5)[0]
                aes = strength
        entries.append({"name": name, "flags": flags, "method": actual_method, "crc": crc,
                        "csize": csize, "usize": usize, "offset": offset, "aes": aes,
                        "mtime": mtime})
        pos += 46 + nlen + xlen + clen
    return data, entries


def encrypted(entry):
    return bool(entry["flags"] & 1)


def choose_entry(entries, requested):
    if requested < len(entries) and encrypted(entries[requested]):
        return requested
    selected = next((i for i, e in enumerate(entries) if encrypted(e)), None)
    if selected is not None:
        sys.stderr.write("File at index {} is not encrypted, auto-selecting file at index {} ({})\n".format(requested, selected, entries[selected]["name"]))
        return selected
    lines = ["Invalid zip file error - no encrypted file found in archive", "Archive contents ({} files):".format(len(entries))]
    for i, e in enumerate(entries[:20]):
        kind = "dir" if e["name"].endswith("/") else "file"
        enc = ", encrypted" if encrypted(e) else ""
        lines.append("  [{}] {} ({}{})".format(i, e["name"], kind, enc))
    if len(entries) > 20: lines.append("  ... and {} more files".format(len(entries) - 20))
    raise PortError("\n".join(lines))


def compressed_payload(data, entry):
    pos = entry["offset"]
    if data[pos:pos + 4] != b"PK\x03\x04": return None
    nlen, xlen = struct.unpack_from("<HH", data, pos + 26)
    start = pos + 30 + nlen + xlen
    return data[start:start + entry["csize"]]


def crc32_byte(old, value):
    crc = old ^ value
    for _ in range(8):
        crc = (crc >> 1) ^ (0xedb88320 if crc & 1 else 0)
    return crc & 0xffffffff


def zipcrypto_decrypt(blob, password):
    keys = [0x12345678, 0x23456789, 0x34567890]
    def update(value):
        keys[0] = crc32_byte(keys[0], value)
        keys[1] = (keys[1] + (keys[0] & 255)) & 0xffffffff
        keys[1] = (keys[1] * 134775813 + 1) & 0xffffffff
        keys[2] = crc32_byte(keys[2], (keys[1] >> 24) & 255)
    for b in password: update(b)
    out = bytearray()
    for b in blob:
        temp = (keys[2] | 2) & 0xffffffff
        plain = b ^ ((temp * (temp ^ 1) >> 8) & 255)
        update(plain); out.append(plain)
    return bytes(out)


SBOX = bytes.fromhex("637c777bf26b6fc53001672bfed7ab76ca82c97dfa5947f0adc9a2af9c472c0b7fd9326363ff7cc34a5e5f171d83115c04c723c31896059a071280e2eb27b27509832c1a1b6e5aa0523bd6b329e32f8453d100ed20fcb15b6acbbe394a4c58cfd0efaafb434d338545f9027f503c9fa851a3408f929d38f5bcb6da2110fff3d2cd0c13ec5f974417c4a77e3d645d197360814fdc222a908846eeb814de5e0bdbe0323a0a4906245cc2d3ac629195e479e7c8376d8dd54ea96c56f4ea657aae08ba78252e1ca6b4c6e8dd741f4bbd8b8a703eb5664803f60e613557b986c11d9ee1f8981169d98e949b1e87e9ce5528df8ca1890dbfe6426841992d0fb054bb16")


def xtime(x): return ((x << 1) ^ (0x11b if x & 0x80 else 0)) & 255


def aes_keys(key):
    nk, nr = len(key) // 4, len(key) // 4 + 6
    words = [list(key[i:i + 4]) for i in range(0, len(key), 4)]
    rcon = 1
    for i in range(nk, 4 * (nr + 1)):
        t = words[i - 1][:]
        if i % nk == 0:
            t = [SBOX[t[1]], SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]]
            t[0] ^= rcon; rcon = xtime(rcon)
        elif nk > 6 and i % nk == 4: t = [SBOX[x] for x in t]
        words.append([words[i - nk][j] ^ t[j] for j in range(4)])
    return [sum(words[4*r:4*r+4], []) for r in range(nr + 1)]


def aes_block(block, rounds):
    s = list(block)
    def add(k):
        for i in range(16): s[i] ^= k[i]
    add(rounds[0])
    for rnd in range(1, len(rounds)):
        s[:] = [SBOX[x] for x in s]
        s[:] = [s[0],s[5],s[10],s[15], s[4],s[9],s[14],s[3], s[8],s[13],s[2],s[7], s[12],s[1],s[6],s[11]]
        if rnd != len(rounds) - 1:
            for c in range(4):
                i=4*c; a=s[i:i+4]; x=a[0]^a[1]^a[2]^a[3]
                s[i]=a[0]^x^xtime(a[0]^a[1]); s[i+1]=a[1]^x^xtime(a[1]^a[2])
                s[i+2]=a[2]^x^xtime(a[2]^a[3]); s[i+3]=a[3]^x^xtime(a[3]^a[0])
        add(rounds[rnd])
    return bytes(s)


def extract(data, entry, password):
    blob = compressed_payload(data, entry)
    if blob is None: return False
    if entry["aes"]:
        keylen = {1: 16, 2: 24, 3: 32}[entry["aes"]]
        saltlen = {1: 8, 2: 12, 3: 16}[entry["aes"]]
        if len(blob) < saltlen + 12: return False
        salt, verify = blob[:saltlen], blob[saltlen:saltlen + 2]
        derived = hashlib.pbkdf2_hmac("sha1", password, salt, 1000, 2 * keylen + 2)
        if not hmac.compare_digest(verify, derived[-2:]): return False
        encrypted_data, auth = blob[saltlen + 2:-10], blob[-10:]
        if not hmac.compare_digest(hmac.new(derived[keylen:2*keylen], encrypted_data, hashlib.sha1).digest()[:10], auth): return False
        rounds = aes_keys(derived[:keylen]); plain = bytearray()
        for n in range(0, len(encrypted_data), 16):
            stream = aes_block(struct.pack("<I", n // 16 + 1) + b"\0" * 12, rounds)
            plain.extend(a ^ b for a, b in zip(encrypted_data[n:n+16], stream))
        compressed = bytes(plain)
    else:
        decrypted = zipcrypto_decrypt(blob, password)
        if len(decrypted) < 12: return False
        check = (entry["mtime"] >> 8) & 255 if entry["flags"] & 8 else (entry["crc"] >> 24) & 255
        if decrypted[11] != check: return False
        compressed = decrypted[12:]
    try:
        if entry["method"] == 0: plain = compressed
        elif entry["method"] == 8: plain = zlib.decompress(compressed, -15)
        elif entry["method"] == 12:
            import bz2
            plain = bz2.decompress(compressed)
        elif entry["method"] == 14:
            import lzma
            plain = lzma.decompress(compressed)
        else: return False
    except Exception:
        return False
    return len(plain) == entry["usize"] and (entry["aes"] is not None or binascii.crc32(plain) & 0xffffffff == entry["crc"])


def rust_duration(seconds):
    ns = max(0, int(seconds * 1_000_000_000))
    parts = []
    for unit, scale in (("h",3600_000_000_000),("m",60_000_000_000),("s",1_000_000_000),("ms",1_000_000),("us",1_000),("ns",1)):
        amount, ns = divmod(ns, scale)
        if amount: parts.append(str(amount) + unit)
    return " ".join(parts) if parts else "0s"


def run(argv):
    started = time.perf_counter()
    v = parse_args(argv)
    data, entries = parse_archive(v["inputFile"])
    index = choose_entry(entries, v["fileNumber"])
    found = None
    for password in candidates(v):
        if extract(data, entries[index], password):
            found = password.decode("utf-8", "replace")
            break
    print("Time elapsed: " + rust_duration(time.perf_counter() - started))
    print("Password found:" + found if found is not None else "Password not found")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(newline="\n")
        sys.stderr.reconfigure(newline="\n")
    try:
        run(sys.argv[1:])
    except PortError as e:
        sys.stderr.write(str(e) + "\n")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
