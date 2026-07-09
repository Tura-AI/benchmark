import pathlib
import subprocess
import sys


CASES = [
    '"abc" | save -f tura_tmp_file.txt; open tura_tmp_file.txt',
    'rm -f tura_tmp_file.txt; "x" | save tura_tmp_file.txt; "tura_tmp_file.txt" | path exists; rm tura_tmp_file.txt',
    '"a,b`n1,2" | from csv | to json -r',
    "'hello\r\nworld' | lines | get 0 | str length",
    "[[name, age, grade]; [paul,21,a]] | drop column 1 | to json -r",
    '[[version, package]; ["two", "Abc"], ["three", "abc"], ["four", "abc"]] | sort-by -i package version | to json --raw',
]


def main():
    ref = pathlib.Path("REFERENCE_BINARY.txt").read_text().strip()
    failures = 0
    for case in CASES:
        expected = subprocess.run([ref, "-c", case], capture_output=True)
        actual = subprocess.run([sys.executable, "nushell_port.py", "-c", case], capture_output=True)
        match = (
            expected.returncode == actual.returncode
            and expected.stdout == actual.stdout
            and expected.stderr == actual.stderr
        )
        print(("OK  " if match else "BAD ") + case)
        if not match:
            failures += 1
            print("  ref ", expected.returncode, repr(expected.stdout.decode(errors="replace")), repr(expected.stderr.decode(errors="replace")[:240]))
            print("  port", actual.returncode, repr(actual.stdout.decode(errors="replace")), repr(actual.stderr.decode(errors="replace")[:240]))
    pathlib.Path("tura_tmp_file.txt").unlink(missing_ok=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
