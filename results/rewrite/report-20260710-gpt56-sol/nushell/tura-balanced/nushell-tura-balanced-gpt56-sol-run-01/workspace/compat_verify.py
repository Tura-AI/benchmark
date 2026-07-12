#!/usr/bin/env python3
"""Differential process-level verifier; never imported by the implementation."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent
REF=Path((ROOT/"REFERENCE_BINARY.txt").read_text().strip())
PORT=["cmd.exe","/d","/c",str(ROOT/"executable.cmd")]
CASES=[
    "1 + 2 * 3", "(1 + 2) * 3", "true and false", "null", '"hello world"',
    "[1 2 3]", "{a: 1, b: x}", "[[a b]; [1 2] [3 4]]",
    "[1 2 3] | length", '" hello " | str trim', '"abc" | str upcase',
    '"abcabc" | str replace a X', "[3 1 2] | sort", "[1 2 2 3] | uniq",
    "1..5 | math sum", "[1 2 3] | each {|x| $x * 2 }",
    "{a: 1, b: [true null]} | to json", "[[a b]; [1 x] [2 y]] | to csv",
    '"a,b\\n1,x\\n2,y\\n" | from csv',
    "[[name age]; [alice 30] [bob 20]] | where age > 20 | get name",
    "[1 2 3] | first 2", "let x = 4; $x ** 2", "1 / 0",
    "[1 2 3 4] | math avg", "[1 5 2] | math median", "[2 3 4] | math product",
    "9 | math sqrt", "-4 | math abs", '"AbCa" | str downcase',
    '"hello world" | str contains world', '"abcdef" | str substring 1..3',
    '"abcabc" | str replace --all a X', "[[a b]; [1 x] [2 y]] | select b",
    "[[a b c]; [1 2 3]] | reject b", "[1 2 3] | enumerate", "[1 2] | wrap value",
    "[[1 2] [3 4]] | flatten", "[1 2 3 4] | where {|x| $x mod 2 == 0 }",
    "[1 2 3] | reduce {|it, acc| $it + $acc }", "[[a b]; [2 x] [1 y]] | sort-by a --reverse",
    "{a: 1, b: 2} | columns", "{a: 1, b: 2} | values",
    "{a: 1, b: [true null]} | to json --raw",
    '"{\\"a\\":1}" | from json | get a',
    '"{\\"a\\":1}\\n{\\"a\\":2}" | from json --objects | get a',
    "[[a b]; [1 x]] | to csv --noheaders", '"1,x\\n2,y\\n" | from csv --noheaders',
    '"a;b\\n1;x\\n" | from csv --separator ";"',
]

SPECIAL_CASES=[
    (["--no-newline","-c","1 + 2"],b""),
    (["--no-newline","-c","[1 2]"],b""),
    (["--no-newline","-c","{a: 1}"],b""),
    (["--stdin","-c","$in | str trim"],b"  hello  \n"),
]

def run(cmd,cwd):
    env=dict(os.environ); env["NO_COLOR"]="1"
    return subprocess.run(cmd,cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)

def main():
    failures=0
    for source in CASES:
        with tempfile.TemporaryDirectory() as td:
            ref=run([str(REF),"-n","--no-std-lib","-c",source],td)
            got=run(PORT+["-n","--no-std-lib","-c",source],td)
        fields=[]
        if ref.returncode!=got.returncode:fields.append(f"status {ref.returncode}!={got.returncode}")
        if ref.stdout!=got.stdout:fields.append(f"stdout {ref.stdout!r}!={got.stdout!r}")
        if ref.stderr!=got.stderr:fields.append(f"stderr {ref.stderr!r}!={got.stderr!r}")
        if fields:
            failures+=1;print(f"FAIL {source}: {'; '.join(fields)}")
    for args,stdin in SPECIAL_CASES:
        with tempfile.TemporaryDirectory() as td:
            env=dict(os.environ); env["NO_COLOR"]="1"
            ref=subprocess.run([str(REF),"-n","--no-std-lib"]+args,cwd=td,env=env,input=stdin,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            got=subprocess.run(PORT+["-n","--no-std-lib"]+args,cwd=td,env=env,input=stdin,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if (ref.returncode,ref.stdout,ref.stderr)!=(got.returncode,got.stdout,got.stderr):
            failures+=1;print(f"FAIL args {args}: ref={(ref.returncode,ref.stdout,ref.stderr)!r} got={(got.returncode,got.stdout,got.stderr)!r}")
    fs_source='"hello" | save a.txt; open a.txt'
    with tempfile.TemporaryDirectory() as ref_dir, tempfile.TemporaryDirectory() as got_dir:
        ref=run([str(REF),"-n","--no-std-lib","-c",fs_source],ref_dir)
        got=run(PORT+["-n","--no-std-lib","-c",fs_source],got_dir)
        ref_file=(Path(ref_dir)/"a.txt").read_bytes() if (Path(ref_dir)/"a.txt").exists() else None
        got_file=(Path(got_dir)/"a.txt").read_bytes() if (Path(got_dir)/"a.txt").exists() else None
    if (ref.returncode,ref.stdout,ref.stderr,ref_file)!=(got.returncode,got.stdout,got.stderr,got_file):
        failures+=1;print(f"FAIL filesystem save/open: ref={(ref.returncode,ref.stdout,ref.stderr,ref_file)!r} got={(got.returncode,got.stdout,got.stderr,got_file)!r}")
    fs_source='mkdir sub; touch sub/x.txt; "hello" | save sub/a.txt; cp sub/a.txt sub/b.txt; mv sub/b.txt sub/c.txt; rm sub/c.txt; ls sub | select name type'
    with tempfile.TemporaryDirectory() as ref_dir, tempfile.TemporaryDirectory() as got_dir:
        ref=run([str(REF),"-n","--no-std-lib","-c",fs_source],ref_dir)
        got=run(PORT+["-n","--no-std-lib","-c",fs_source],got_dir)
        ref_files=sorted(str(x.relative_to(ref_dir)).replace("\\","/") for x in Path(ref_dir).rglob("*") if x.is_file())
        got_files=sorted(str(x.relative_to(got_dir)).replace("\\","/") for x in Path(got_dir).rglob("*") if x.is_file())
    if (ref.returncode,ref.stdout,ref.stderr,ref_files)!=(got.returncode,got.stdout,got.stderr,got_files):
        failures+=1;print(f"FAIL filesystem operations: ref={(ref.returncode,ref.stdout,ref.stderr,ref_files)!r} got={(got.returncode,got.stdout,got.stderr,got_files)!r}")
    total=len(CASES)+len(SPECIAL_CASES)+2
    print(f"{total-failures}/{total} differential cases passed")
    return 1 if failures else 0

if __name__=="__main__":raise SystemExit(main())
