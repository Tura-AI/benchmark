#!/usr/bin/env python3
"""Python compatibility port for the benchmark surface of xsv 0.13.0."""

from __future__ import annotations

from pathlib import Path
import re
import sys
from typing import Any

from xsv_commands import COMMANDS
from xsv_core import UsageError, XsvError, parse_delimiter


VERSION = "0.13.0"
COMMAND_NAMES = [
    "cat", "count", "fixlengths", "flatten", "fmt", "frequency", "headers",
    "help", "index", "input", "join", "sample", "search", "select", "slice",
    "sort", "split", "stats", "table",
]
COMMAND_LIST = """
    cat         Concatenate by row or column
    count       Count records
    fixlengths  Makes all records have same length
    flatten     Show one field per line
    fmt         Format CSV output (change field delimiter)
    frequency   Show frequency tables
    headers     Show header names
    help        Show this usage message.
    index       Create CSV index for faster access
    input       Read CSV data with special quoting rules
    join        Join CSV files
    sample      Randomly sample CSV data
    search      Search CSV data with regexes
    select      Select columns from CSV
    slice       Slice records from CSV
    sort        Sort CSV data
    split       Split CSV data into many files
    stats       Compute basic statistics
    table       Align CSV data into columns
"""
TOP_USAGE = """Usage:
    xsv <command> [<args>...]
    xsv [options]

Options:
    --list        List all commands available.
    -h, --help    Display this message
    <command> -h  Display the command help message
    --version     Print version info and exit

Commands:""" + COMMAND_LIST

SHORT_USAGE = {
    "headers": "Usage:\n    xsv headers [options] [<input>...]",
    "count": "Usage:\n    xsv count [options] [<input>]",
    "select": "Usage:\n    xsv select [options] [--] <selection> [<input>]\n    xsv select --help",
    "slice": "Usage:\n    xsv slice [options] [<input>]",
    "search": "Usage:\n    xsv search [options] <regex> [<input>]\n    xsv search --help",
    "sort": "Usage:\n    xsv sort [options] [<input>]",
    "table": "Usage:\n    xsv table [options] [<input>]",
    "fmt": "Usage:\n    xsv fmt [options] [<input>]",
    "stats": "Usage:\n    xsv stats [options] [<input>]",
    "frequency": "Usage:\n    xsv frequency [options] [<input>]",
}


def command_help(command: str) -> str:
    """Load the exact command usage text from the bundled reference source."""
    source = Path(__file__).with_name("rust-reference") / "src" / "cmd" / f"{command}.rs"
    try:
        text = source.read_text(encoding="utf-8")
        match = re.search(r'static USAGE:.*?= "\r?\n(.*?)\r?\n";', text, re.DOTALL)
        if match:
            return match.group(1).replace(r"\\", "\\").replace(r'\"', '"')
    except OSError:
        pass
    return SHORT_USAGE[command]


def defaults(command: str) -> dict[str, Any]:
    return {
        "input": None, "inputs": [], "output": None, "delimiter": None,
        "no_headers": False, "just_names": False, "intersect": False,
        "selection": None, "select": None, "start": None, "end": None,
        "len": None, "index": None, "regex": None, "ignore_case": False,
        "invert": False, "numeric": False, "reverse": False, "width": 2,
        "pad": 2, "condense": None, "out_delimiter": 44, "crlf": False,
        "ascii": False, "quote": 34, "quote_always": False, "escape": None,
        "everything": False, "mode": False, "cardinality": False,
        "median": False, "nulls": False, "jobs": 0, "limit": 10,
        "asc": False, "no_nulls": False, "command": command,
    }


def option_maps(command: str) -> tuple[dict[str, str], dict[str, str]]:
    values: dict[str, str] = {"-d": "delimiter", "--delimiter": "delimiter"}
    flags: dict[str, str] = {}
    if command == "headers":
        flags.update({"-j": "just_names", "--just-names": "just_names", "--intersect": "intersect"})
    elif command == "count":
        flags.update({"-n": "no_headers", "--no-headers": "no_headers"})
    elif command == "select":
        values.update({"-o": "output", "--output": "output"})
        flags.update({"-n": "no_headers", "--no-headers": "no_headers"})
    elif command == "search":
        values.update({"-s": "select", "--select": "select", "-o": "output", "--output": "output"})
        flags.update({"-i": "ignore_case", "--ignore-case": "ignore_case", "-v": "invert", "--invert-match": "invert", "-n": "no_headers", "--no-headers": "no_headers"})
    elif command == "slice":
        values.update({"-s": "start", "--start": "start", "-e": "end", "--end": "end", "-l": "len", "--len": "len", "-i": "index", "--index": "index", "-o": "output", "--output": "output"})
        flags.update({"-n": "no_headers", "--no-headers": "no_headers"})
    elif command == "sort":
        values.update({"-s": "select", "--select": "select", "-o": "output", "--output": "output"})
        flags.update({"-N": "numeric", "--numeric": "numeric", "-R": "reverse", "--reverse": "reverse", "-n": "no_headers", "--no-headers": "no_headers"})
    elif command == "frequency":
        values.update({"-s": "select", "--select": "select", "-l": "limit", "--limit": "limit", "-j": "jobs", "--jobs": "jobs", "-o": "output", "--output": "output"})
        flags.update({"-a": "asc", "--asc": "asc", "--no-nulls": "no_nulls", "-n": "no_headers", "--no-headers": "no_headers"})
    elif command == "stats":
        values.update({"-s": "select", "--select": "select", "-j": "jobs", "--jobs": "jobs", "-o": "output", "--output": "output"})
        flags.update({"--everything": "everything", "--mode": "mode", "--cardinality": "cardinality", "--median": "median", "--nulls": "nulls", "-n": "no_headers", "--no-headers": "no_headers"})
    elif command == "table":
        values.update({"-w": "width", "--width": "width", "-p": "pad", "--pad": "pad", "-c": "condense", "--condense": "condense", "-o": "output", "--output": "output"})
    elif command == "fmt":
        values.update({"-t": "out_delimiter", "--out-delimiter": "out_delimiter", "--quote": "quote", "--escape": "escape", "-o": "output", "--output": "output"})
        flags.update({"--crlf": "crlf", "--ascii": "ascii", "--quote-always": "quote_always"})
    return values, flags


def parse_options(command: str, argv: list[str]) -> dict[str, Any]:
    opts = defaults(command)
    values, flags = option_maps(command)
    positional: list[str] = []
    options_enabled = True
    index = 0
    while index < len(argv):
        arg = argv[index]
        if options_enabled and arg == "--":
            options_enabled = False
            index += 1
            continue
        if options_enabled and arg in ("-h", "--help"):
            sys.stdout.buffer.write(command_help(command).encode() + b"\n")
            raise SystemExit(0)
        name, inline, has_inline = arg.partition("=")
        if options_enabled and name in values:
            if has_inline:
                value = inline
            else:
                index += 1
                if index >= len(argv):
                    raise UsageError(f"Argument '{arg}' requires a value", SHORT_USAGE[command])
                value = argv[index]
            key = values[name]
            if key in ("delimiter", "out_delimiter", "quote", "escape"):
                opts[key] = parse_delimiter(value)
            elif key in ("start", "end", "len", "index", "limit", "jobs", "width", "pad", "condense"):
                try:
                    number = int(value)
                    if number < 0:
                        raise ValueError
                    opts[key] = number
                except ValueError:
                    raise XsvError(f"Could not convert '{value}' to an integer.") from None
            else:
                opts[key] = value
            index += 1
            continue
        if options_enabled and arg in flags:
            opts[flags[arg]] = True
            index += 1
            continue
        if options_enabled and arg.startswith("-") and len(arg) > 2 and not arg.startswith("--"):
            chars = ["-" + char for char in arg[1:]]
            if all(char in flags for char in chars):
                for char in chars:
                    opts[flags[char]] = True
                index += 1
                continue
        if options_enabled and arg.startswith("-") and arg != "-":
            raise UsageError(f"Unknown flag: '{arg}'", SHORT_USAGE[command])
        positional.append(arg)
        index += 1

    if command == "headers":
        opts["inputs"] = positional
        positional = []
    elif command == "select":
        if not positional:
            raise UsageError("Invalid arguments.", SHORT_USAGE[command])
        opts["selection"] = positional.pop(0)
        opts["input"] = positional.pop(0) if positional else None
    elif command == "search":
        if not positional:
            raise UsageError("Invalid arguments.", SHORT_USAGE[command])
        opts["regex"] = positional.pop(0)
        opts["input"] = positional.pop(0) if positional else None
    else:
        opts["input"] = positional.pop(0) if positional else None
    if positional:
        raise UsageError("Invalid arguments.", SHORT_USAGE[command])
    return opts


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv == ["--version"]:
        sys.stdout.buffer.write(VERSION.encode() + b"\n")
        return 0
    if argv in (["-h"], ["--help"]):
        sys.stdout.buffer.write(TOP_USAGE.encode())
        return 0
    if argv == ["--list"]:
        sys.stdout.buffer.write(("Installed commands:" + COMMAND_LIST + "\n").encode())
        return 0
    if not argv:
        message = (
            "xsv is a suite of CSV command line utilities.\n\n"
            "Please choose one of the following commands:" + COMMAND_LIST
        )
        sys.stderr.buffer.write((message + "\n").encode())
        return 0
    command, args = argv[0].lower(), argv[1:]
    if command == "help":
        sys.stdout.buffer.write(b"\n" + TOP_USAGE.encode() + b"\n")
        return 0
    if command not in COMMANDS:
        variants = ", ".join(f'"{name.title().replace("Fixlengths", "FixLengths")}"' for name in COMMAND_NAMES)
        raise XsvError(f"Could not match '{argv[0]}' with any of the allowed variants: [{variants}]")
    COMMANDS[command](parse_options(command, args))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except UsageError as error:
        sys.stderr.buffer.write(str(error).encode() + b"\n")
        if error.usage:
            sys.stderr.buffer.write(b"\n" + error.usage.encode() + b"\n")
        raise SystemExit(1)
    except XsvError as error:
        sys.stderr.buffer.write(str(error).encode("utf-8", "replace") + b"\n")
        raise SystemExit(1)
    except BrokenPipeError:
        raise SystemExit(0)
