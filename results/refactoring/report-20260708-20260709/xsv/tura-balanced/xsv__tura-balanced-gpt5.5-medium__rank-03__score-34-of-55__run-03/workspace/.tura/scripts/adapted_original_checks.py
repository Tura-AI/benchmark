import csv
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EXE = [sys.executable, str(ROOT / "executable")]


def write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        csv.writer(f, lineterminator="\n").writerows(rows)


def run(args, cwd):
    return subprocess.run(EXE + args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def main():
    checks = []
    with tempfile.TemporaryDirectory(prefix="xsv-original-checks-") as td:
        d = Path(td)
        write_csv(d / "data.csv", [["h1", "h2", "h[]3", "h4", "h1"], ["a", "b", "c", "d", "e"]])
        checks.append(run(["select", "h1[1]-h1[0]", "data.csv"], d).stdout == b"h1,h4,h[]3,h2,h1\ne,d,c,b,a\n")

        write_csv(d / "s.csv", [["header"], ["a"], ["b"], ["c"], ["d"], ["e"]])
        checks.append(run(["slice", "--start", "1", "--end", "3", "s.csv"], d).stdout == b"header\nb\nc\n")

        write_csv(d / "search.csv", [["h1", "h2"], ["foobar", "barfoo"], ["a", "b"], ["barfoo", "foobar"]])
        checks.append(run(["search", "--select", "h2", "^foo", "search.csv"], d).stdout == b"h1,h2\nbarfoo,foobar\n")

        write_csv(d / "sort.csv", [["N", "S"], ["10", "a"], ["LETTER", "b"], ["2", "c"], ["1", "d"]])
        checks.append(run(["sort", "-N", "sort.csv"], d).stdout == b"N,S\nLETTER,b\n1,d\n2,c\n10,a\n")

        write_csv(d / "fmt.csv", [["h1", "h2"], ["abcdef", "ghijkl"], ["mnopqr", "stuvwx"]])
        checks.append(run(["fmt", "--quote-always", "fmt.csv"], d).stdout == b"\"h1\",\"h2\"\n\"abcdef\",\"ghijkl\"\n\"mnopqr\",\"stuvwx\"\n")

        write_csv(d / "table.csv", [["h1", "h2", "h3"], ["abcdefg", "a", "a"], ["a", "abc", "z"]])
        checks.append(run(["table", "table.csv"], d).stdout == b"h1       h2   h3\nabcdefg  a    a\na        abc  z\n")

        write_csv(d / "freq.csv", [["h1", "h2"], ["a", "z"], ["a", "y"], ["a", "y"], ["b", "z"], ["", "z"], ["(NULL)", "x"]])
        checks.append(run(["frequency", "--limit", "1", "freq.csv"], d).stdout == b"field,value,count\nh1,a,3\nh2,z,3\n")

        write_csv(d / "stats.csv", [["header"], ["1"], ["2"], ["3"]])
        out = run(["stats", "--median", "stats.csv"], d).stdout
        checks.append(b"header,Integer,6,1,3,1,1,2,0.816496580927726,2" in out)

    print("adapted original checks: %d/%d" % (sum(checks), len(checks)))
    if not all(checks):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
