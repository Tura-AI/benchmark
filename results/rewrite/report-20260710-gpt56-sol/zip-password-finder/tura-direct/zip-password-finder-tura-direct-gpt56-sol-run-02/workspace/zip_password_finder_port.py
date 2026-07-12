#!/usr/bin/env python3
"""Source-derived Python port of zip-password-finder 0.11.1."""

import binascii
import hashlib
import itertools
import os
import struct
import sys
import time
import zipfile
import zlib

LOWER = list("abcdefghijklmnopqrstuvwxyz")
UPPER = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = list("0123456789")
SYMBOLS = list(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
PRESETS = {"l": LOWER, "u": UPPER, "d": DIGITS, "s": SYMBOLS,
           "h": list("0123456789abcdef"), "H": list("0123456789ABCDEF")}
VERSION = "zip-password-finder 0.11.1"
USAGE = "Usage: zip-password-finder.exe [OPTIONS] --inputFile <inputFile>"

OPTIONS = {
    "-i": ("inputFile", True), "--inputFile": ("inputFile", True),
    "-w": ("workers", True), "--workers": ("workers", True),
    "-p": ("passwordDictionary", True), "--passwordDictionary": ("passwordDictionary", True),
    "-c": ("charset", True), "--charset": ("charset", True),
    "--charsetFile": ("charsetFile", True), "--minPasswordLen": ("minPasswordLen", True),
    "--maxPasswordLen": ("maxPasswordLen", True), "--fileNumber": ("fileNumber", True),
    "-s": ("startingPassword", True), "--startingPassword": ("startingPassword", True),
    "-m": ("mask", True), "--mask": ("mask", True),
    "-1": ("customCharset1", True), "--customCharset1": ("customCharset1", True),
    "-2": ("customCharset2", True), "--customCharset2": ("customCharset2", True),
    "-3": ("customCharset3", True), "--customCharset3": ("customCharset3", True),
    "-4": ("customCharset4", True), "--customCharset4": ("customCharset4", True),
}

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

HELP = """Find the password of protected ZIP files

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


class PortError(Exception):
    pass


def cli_error(message):
    raise PortError('CLI argument error - "' + message + '"')


def clap_error(message):
    sys.stderr.write(message)
    raise SystemExit(2)


def parse_usize(value, label):
    if not value or not value.isascii() or not value.isdigit():
        reason = "cannot parse integer from empty string" if not value else "invalid digit found in string"
        clap_error(f"error: invalid value '{value}' for '--{label} <{label}>': {reason}\n\nFor more information, try '--help'.\n")
    return int(value)


def parse_args(argv):
    if "--help" in argv or "-h" in argv:
        print(HELP if "--help" in argv else SHORT_HELP, end="")
        raise SystemExit(0)
    if "--version" in argv or "-V" in argv:
        print(VERSION)
        raise SystemExit(0)
    values = {"charset": "lud", "minPasswordLen": "1", "maxPasswordLen": "10", "fileNumber": "0"}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg.startswith("--") and "=" in arg:
            arg, attached = arg.split("=", 1)
            argv = argv[:i] + [arg, attached] + argv[i + 1:]
        if arg not in OPTIONS:
            clap_error(f"error: unexpected argument '{arg}' found\n\n{USAGE}\n\nFor more information, try '--help'.\n")
        name, _ = OPTIONS[arg]
        if i + 1 >= len(argv) or argv[i + 1] in OPTIONS:
            clap_error(f"error: a value is required for '{arg} <{name}>' but none was supplied\n\nFor more information, try '--help'.\n")
        values[name] = argv[i + 1]
        i += 2
    if "inputFile" not in values:
        clap_error("error: the following required arguments were not provided:\n  --inputFile <inputFile>\n\nUsage: zip-password-finder.exe --inputFile <inputFile>\n\nFor more information, try '--help'.\n")
    for key in ("workers", "minPasswordLen", "maxPasswordLen", "fileNumber"):
        if key in values:
            values[key] = parse_usize(values[key], key)
    if not os.path.isfile(values["inputFile"]):
        cli_error("'inputFile' does not exist")
    if "passwordDictionary" in values and not os.path.isfile(values["passwordDictionary"]):
        cli_error("'passwordDictionary' does not exist")
    if "charsetFile" in values and not os.path.isfile(values["charsetFile"]):
        cli_error("'charsetFile' does not exist")
    if values.get("workers") == 0:
        cli_error("'workers' must be positive")
    if values["minPasswordLen"] == 0:
        cli_error("'minPasswordLen' must be positive")
    if values["maxPasswordLen"] == 0:
        cli_error("'maxPasswordLen' must be positive")
    if values["minPasswordLen"] > values["maxPasswordLen"]:
        cli_error("'maxPasswordLen' must be equal or greater than 'minPasswordLen'")
    custom = [None] * 4
    for index in range(4):
        name = f"customCharset{index + 1}"
        if name in values:
            if "mask" not in values:
                cli_error(f"'--{name}' can only be used with --mask")
            custom[index] = parse_custom(values[name])
    values["custom"] = custom
    if "mask" in values and "passwordDictionary" in values:
        cli_error("'mask' cannot be used with a dictionary file")
    if "startingPassword" in values:
        if "passwordDictionary" in values:
            cli_error("'startingPassword' cannot be used with a dictionary file")
        if "mask" in values:
            cli_error("'startingPassword' cannot be used with mask attack")
        charset = get_charset(values)
        if any(ch not in charset for ch in values["startingPassword"]):
            cli_error("'startingPassword' uses characters out of the generation charset")
        length = len(values["startingPassword"])
        if not values["minPasswordLen"] <= length <= values["maxPasswordLen"]:
            cli_error("'startingPassword' does not respect 'max_password_len' or 'min_password_len' configuration")
    return values


def dedup_sorted(chars):
    return sorted(set(chars))


def get_charset(args):
    if "charsetFile" in args:
        try:
            with open(args["charsetFile"], encoding="utf-8") as stream:
                return dedup_sorted(stream.read())
        except (OSError, UnicodeError) as exc:
            raise PortError("standard I/O error - " + str(exc))
    chars = []
    for symbol in args["charset"]:
        if symbol not in PRESETS:
            cli_error(f"Unknown charset option '{symbol}'")
        chars.extend(PRESETS[symbol])
    return dedup_sorted(chars)


def parse_custom(text):
    if not text:
        cli_error("Custom charset definition is empty")
    chars, i = [], 0
    while i < len(text):
        if text[i] != "?":
            chars.append(text[i]); i += 1; continue
        if i + 1 == len(text):
            cli_error("Custom charset ends with incomplete token '?'")
        token = text[i + 1]; i += 2
        if token == "?": chars.append("?")
        elif token in PRESETS: chars.extend(PRESETS[token])
        elif token == "a": chars.extend(LOWER + UPPER + DIGITS + SYMBOLS)
        else: cli_error(f"Unknown custom charset token '?{token}'")
    return list(dict.fromkeys(chars))


def parse_mask(text, custom):
    if not text:
        cli_error("Mask pattern is empty")
    positions, i = [], 0
    while i < len(text):
        if text[i] != "?":
            positions.append([text[i]]); i += 1; continue
        if i + 1 == len(text):
            cli_error("Mask ends with incomplete token '?'")
        token = text[i + 1]; i += 2
        if token == "?": positions.append(["?"])
        elif token in PRESETS: positions.append(PRESETS[token])
        elif token == "a": positions.append(LOWER + UPPER + DIGITS + SYMBOLS)
        elif token in "1234":
            value = custom[int(token) - 1]
            if value is None: cli_error(f"Custom charset ?{token} used in mask but --customCharset{token} not provided")
            positions.append(value)
        else: cli_error(f"Unknown mask token '?{token}'")
    return positions


def candidates(args):
    if "passwordDictionary" in args:
        with open(args["passwordDictionary"], "rb") as stream:
            for line in stream:
                yield line[:-1].rstrip(b"\r") if line.endswith(b"\n") else line
        return
    if "mask" in args:
        for item in itertools.product(*parse_mask(args["mask"], args["custom"])):
            yield "".join(item).encode("utf-8")
        return
    charset = get_charset(args)
    start = args.get("startingPassword")
    started = start is None
    for length in range(args["minPasswordLen"], args["maxPasswordLen"] + 1):
        for item in itertools.product(charset, repeat=length):
            text = "".join(item)
            if not started:
                if text == start: started = True
                else: continue
            yield bytes((ord(ch) & 0xff for ch in text))


def aes_info(path, info):
    extra = info.extra
    mode = None
    i = 0
    while i + 4 <= len(extra):
        kind, size = struct.unpack_from("<HH", extra, i); data = extra[i + 4:i + 4 + size]; i += 4 + size
        if kind == 0x9901 and len(data) >= 7:
            strength = data[4]; mode = {1: 16, 2: 24, 3: 32}.get(strength)
    if not mode:
        return None
    with open(path, "rb") as stream:
        stream.seek(info.header_offset)
        header = stream.read(30)
        name_len, extra_len = struct.unpack_from("<HH", header, 26)
        stream.seek(name_len + extra_len, 1)
        salt = stream.read({16: 8, 24: 12, 32: 16}[mode])
        verifier = stream.read(2)
    return mode, salt, verifier


def validate_zip(path, requested):
    try:
        archive = zipfile.ZipFile(path)
        infos = archive.infolist()
    except (OSError, zipfile.BadZipFile) as exc:
        raise PortError("Invalid zip file error - " + str(exc))
    encrypted = [i for i, info in enumerate(infos) if info.flag_bits & 1]
    if not encrypted:
        listing = f"Archive contents ({len(infos)} files):"
        for i, info in enumerate(infos[:20]):
            listing += f"\n  [{i}] {info.filename} ({'dir' if info.is_dir() else 'file'})"
        raise PortError("Invalid zip file error - no encrypted file found in archive\n" + listing)
    target = requested if requested < len(infos) and requested in encrypted else encrypted[0]
    if target != requested:
        sys.stderr.write(f"File at index {requested} is not encrypted, auto-selecting file at index {target} ({infos[target].filename})\n")
    return archive, infos[target], aes_info(path, infos[target])


def find_password(args):
    archive, info, aes = validate_zip(args["inputFile"], args["fileNumber"])
    for password in candidates(args):
        if aes:
            key_len, salt, verifier = aes
            derived = hashlib.pbkdf2_hmac("sha1", password, salt, 1000, 2 * key_len + 2)
            if derived[-2:] == verifier:
                return password.decode("utf-8", "replace")
        else:
            try:
                archive.read(info, pwd=password)
                return password.decode("utf-8", "replace")
            except (RuntimeError, zipfile.BadZipFile, binascii.Error, zlib.error):
                pass
    return None


def format_duration(seconds):
    ns = max(1, int(seconds * 1_000_000_000))
    units = ((3_600_000_000_000, "h"), (60_000_000_000, "m"), (1_000_000_000, "s"),
             (1_000_000, "ms"), (1_000, "us"), (1, "ns"))
    parts = []
    for scale, suffix in units:
        if ns >= scale:
            value, ns = divmod(ns, scale)
            parts.append(f"{value}{suffix}")
            if len(parts) == 3: break
    return " ".join(parts)


def main(argv):
    try:
        args = parse_args(list(argv))
        started = time.perf_counter()
        password = find_password(args)
        print("Time elapsed: " + format_duration(time.perf_counter() - started))
        print("Password found:" + password if password is not None else "Password not found")
        return 0
    except PortError as exc:
        sys.stderr.write(str(exc) + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
