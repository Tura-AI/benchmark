#!/usr/bin/env python3
import csv
import os
import subprocess
import sys
import tempfile


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EXE = os.path.join(ROOT, "executable")


def write_csv(path, rows):
    with open(path, "w", encoding="utf-8", newline="") as f:
        csv.writer(f, lineterminator="\n").writerows(rows)


def run(tmp, args):
    return subprocess.run([sys.executable, EXE] + args, cwd=tmp, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)


def out_text(tmp, args):
    return run(tmp, args).stdout.decode("utf-8").strip("\r\n")


def out_rows(tmp, args):
    data = run(tmp, args).stdout.decode("utf-8")
    return list(csv.reader(data.splitlines()))


def main():
    with tempfile.TemporaryDirectory() as tmp:
        write_csv(os.path.join(tmp, "h.csv"), [["h1", "h2"], ["a", "b"]])
        assert out_text(tmp, ["headers", "h.csv"]) == "1   h1\n2   h2"
        assert out_text(tmp, ["headers", "--just-names", "h.csv"]) == "h1\nh2"
        assert out_text(tmp, ["count", "h.csv"]) == "1"
        assert out_text(tmp, ["count", "--no-headers", "h.csv"]) == "2"

        rows = [["h1", "h2", "h[]3", "h4", "h1"], ["a", "b", "c", "d", "e"]]
        write_csv(os.path.join(tmp, "sel.csv"), rows)
        assert out_rows(tmp, ["select", "h1[1]-h1[0]", "sel.csv"]) == [["h1", "h4", "h[]3", "h2", "h1"], ["e", "d", "c", "b", "a"]]
        assert out_rows(tmp, ["select", "!\"h[]3\"[0]", "sel.csv"]) == [["h1", "h2", "h4", "h1"], ["a", "b", "d", "e"]]

        write_csv(os.path.join(tmp, "slice.csv"), [["header"], ["a"], ["b"], ["c"], ["d"], ["e"]])
        assert out_rows(tmp, ["slice", "--start", "1", "--end", "3", "slice.csv"]) == [["header"], ["b"], ["c"]]
        assert out_rows(tmp, ["slice", "--index", "1", "slice.csv"]) == [["header"], ["b"]]

        search_rows = [["h1", "h2"], ["foobar", "barfoo"], ["a", "b"], ["barfoo", "foobar"]]
        write_csv(os.path.join(tmp, "search.csv"), search_rows)
        assert out_rows(tmp, ["search", "^foo", "search.csv"]) == [["h1", "h2"], ["foobar", "barfoo"], ["barfoo", "foobar"]]
        assert out_rows(tmp, ["search", "^foo", "--select", "h2", "search.csv"]) == [["h1", "h2"], ["barfoo", "foobar"]]

        write_csv(os.path.join(tmp, "sort.csv"), [["N", "S"], ["10", "a"], ["LETTER", "b"], ["2", "c"], ["1", "d"]])
        assert out_rows(tmp, ["sort", "-N", "sort.csv"]) == [["N", "S"], ["LETTER", "b"], ["1", "d"], ["2", "c"], ["10", "a"]]

        write_csv(os.path.join(tmp, "fmt.csv"), [["h1", "h2"], ["abcdef", "ghijkl"], ["mnopqr", "stuvwx"]])
        assert out_text(tmp, ["fmt", "--out-delimiter", r"\t", "fmt.csv"]) == "h1\th2\nabcdef\tghijkl\nmnopqr\tstuvwx"
        assert out_text(tmp, ["fmt", "--quote-always", "fmt.csv"]) == '"h1","h2"\n"abcdef","ghijkl"\n"mnopqr","stuvwx"'

        write_csv(os.path.join(tmp, "table.csv"), [["h1", "h2", "h3"], ["abcdefg", "a", "a"], ["a", "abc", "z"]])
        assert run(tmp, ["table", "table.csv"]).stdout == b"h1       h2   h3\nabcdefg  a    a\na        abc  z\n"

        write_csv(os.path.join(tmp, "freq.csv"), [["h1", "h2"], ["a", "z"], ["a", "y"], ["a", "y"], ["b", "z"], ["", "z"], ["(NULL)", "x"]])
        freq = out_rows(tmp, ["frequency", "--limit", "1", "freq.csv"])
        assert freq == [["field", "value", "count"], ["h1", "a", "3"], ["h2", "z", "3"]]

        write_csv(os.path.join(tmp, "stats.csv"), [["header"], ["5"], ["15"], ["10"]])
        stats = out_rows(tmp, ["stats", "stats.csv"])
        assert stats[0][:9] == ["field", "type", "sum", "min", "max", "min_length", "max_length", "mean", "stddev"]
        assert stats[1][0:8] == ["header", "Integer", "30", "5", "15", "1", "2", "10"]

    print("adapted original scope tests passed")


if __name__ == "__main__":
    main()
