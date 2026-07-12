#!/bin/sh
''''exec' python3 "$0" "$@" # '''
import os
import stat

for name in (
    "executable",
    "executable.exe",
    "executable.cmd",
    "executable.bat",
    "executable.js",
    "executable.jar",
    "executable.py",
):
    try:
        os.remove(name)
    except FileNotFoundError:
        pass

if os.name == "nt":
    with open("executable.cmd", "w", encoding="ascii", newline="") as f:
        f.write('@echo off\r\npython "%~dp0xsv_port.py" %*\r\n')
else:
    with open("executable", "w", encoding="utf-8", newline="\n") as f:
        f.write('#!/usr/bin/env python3\n')
        f.write('import os, sys\n')
        f.write('sys.path.insert(0, os.path.dirname(__file__))\n')
        f.write('from xsv_port import main\n')
        f.write('raise SystemExit(main())\n')
    os.chmod("executable", os.stat("executable").st_mode | stat.S_IXUSR)
