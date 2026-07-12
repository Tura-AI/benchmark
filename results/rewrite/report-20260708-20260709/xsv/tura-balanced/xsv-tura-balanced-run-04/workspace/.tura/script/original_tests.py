#!/usr/bin/env python3
import csv
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PORT = [sys.executable, str(ROOT / "xsv_port.py")]


def write_csv(path, rows):
    with path.open("w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(rows)


def run(args, rows=None):
    with tempfile.TemporaryDirectory() as td:
        wd = Path(td)
        if rows is not None:
            write_csv(wd / "in.csv", rows)
            args = args + [str(wd / "in.csv")]
        p = subprocess.run(PORT + args, cwd=wd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        return p.returncode, p.stdout, p.stderr


def rows_out(args, rows):
    code, out, err = run(args, rows)
    assert code == 0, (args, code, out, err)
    return list(csv.reader(out.decode("utf-8").splitlines()))


def text_out(args, rows):
    code, out, err = run(args, rows)
    assert code == 0, (args, code, out, err)
    return out.decode("utf-8")


def assert_err(args, rows):
    code, out, err = run(args, rows)
    assert code != 0, (args, out, err)


def test_headers():
    with tempfile.TemporaryDirectory() as td:
        wd = Path(td)
        write_csv(wd / "in1.csv", [["h1", "h2"], ["a", "b"]])
        write_csv(wd / "in2.csv", [["h2", "h3"], ["y", "z"]])
        def r(args):
            p = subprocess.run(PORT + ["headers"] + args, cwd=wd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
            assert p.returncode == 0, p
            return p.stdout.decode().rstrip("\r\n")
        assert r(["in1.csv"]) == "1   h1\n2   h2"
        assert r(["--just-names", "in1.csv"]) == "h1\nh2"
        assert r(["in1.csv", "in2.csv"]) == "h1\nh2\nh2\nh3"
        assert r(["in1.csv", "in2.csv", "--intersect"]) == "h1\nh2\nh3"


def test_count_slice_select_search_sort_fmt_table_frequency():
    assert text_out(["count"], [["h"], ["a"], ["b"]]).strip() == "2"
    assert text_out(["count", "--no-headers"], [["h"], ["a"], ["b"]]).strip() == "3"

    data = [["h1", "h2", "h[]3", "h4", "h1"], ["a", "b", "c", "d", "e"]]
    assert rows_out(["select", "h1"], data) == [["h1"], ["a"]]
    assert rows_out(["select", "h1[1]-h1[0]"], data) == [["h1", "h4", "h[]3", "h2", "h1"], ["e", "d", "c", "b", "a"]]
    assert rows_out(["select", '!"h[]3"[0]'], data) == [["h1", "h2", "h4", "h1"], ["a", "b", "d", "e"]]
    for sel in ["dne", "0", "6", "1[0]", "h1[2]", "h1[2.0]", '"h1', '"h1"[1', "a-b-"]:
        assert_err(["select", sel], data)

    slice_rows = [["header"], ["a"], ["b"], ["c"], ["d"], ["e"]]
    assert rows_out(["slice", "--start", "1", "--end", "3"], slice_rows) == [["header"], ["b"], ["c"]]
    assert rows_out(["slice", "--index", "1"], slice_rows) == [["header"], ["b"]]
    assert rows_out(["slice", "--start", "3"], slice_rows) == [["header"], ["d"], ["e"]]

    search = [["h1", "h2"], ["foobar", "barfoo"], ["a", "b"], ["barfoo", "foobar"]]
    assert rows_out(["search", "^foo"], search) == [["h1", "h2"], ["foobar", "barfoo"], ["barfoo", "foobar"]]
    assert rows_out(["search", "^foo", "--select", "h2"], search) == [["h1", "h2"], ["barfoo", "foobar"]]
    assert rows_out(["search", "xxx"], search) == [["h1", "h2"]]

    sort_rows = [["N", "S"], ["10", "a"], ["LETTER", "b"], ["2", "c"], ["1", "d"]]
    assert rows_out(["sort", "-N"], sort_rows) == [["N", "S"], ["LETTER", "b"], ["1", "d"], ["2", "c"], ["10", "a"]]
    assert rows_out(["sort", "--no-headers", "--select", "2"], [["1", "b"], ["2", "a"]]) == [["2", "a"], ["1", "b"]]

    fmt_rows = [["h1", "h2"], ["abcdef", "ghijkl"], ["mnopqr", "stuvwx"]]
    assert text_out(["fmt", "--out-delimiter", "\\t"], fmt_rows).rstrip("\n") == "h1\th2\nabcdef\tghijkl\nmnopqr\tstuvwx"
    assert text_out(["fmt", "--quote-always"], fmt_rows).rstrip("\n") == '"h1","h2"\n"abcdef","ghijkl"\n"mnopqr","stuvwx"'

    table_rows = [["h1", "h2", "h3"], ["abcdefg", "a", "a"], ["a", "abc", "z"]]
    assert text_out(["table"], table_rows) == "h1       h2   h3\nabcdefg  a    a\na        abc  z\n"

    freq_rows = [["h1", "h2"], ["a", "z"], ["a", "y"], ["a", "y"], ["b", "z"], ["", "z"], ["(NULL)", "x"]]
    got = rows_out(["frequency", "--limit", "0", "--select", "h1"], freq_rows)
    assert sorted(got) == sorted([["field", "value", "count"], ["h1", "(NULL)", "1"], ["h1", "(NULL)", "1"], ["h1", "a", "3"], ["h1", "b", "1"]])


def get_stat(field, rows, extra=None):
    got = rows_out(["stats"] + (extra or []), [["header"]] + [[x] for x in rows])
    headers = got[0]
    return got[1][headers.index(field)]


def test_stats():
    cases = [
        ("type", ["a"], "Unicode", []), ("type", ["1"], "Integer", []),
        ("type", ["1.2"], "Float", []), ("type", [""], "NULL", []),
        ("sum", ["1", "2"], "3", []), ("sum", ["1.5", "2.8"], "4.3", []),
        ("min", ["2", "1.1"], "1.1", []), ("max", ["2", "1.1"], "2", []),
        ("min_length", ["aa", "a"], "1", []), ("max_length", ["a", "aa"], "2", []),
        ("mean", ["5", "15", "10"], "10", []),
        ("stddev", ["1", "2", "3"], "0.816496", []),
        ("cardinality", ["a", "b", "a"], "2", ["--cardinality"]),
        ("mode", ["a", "b", "a"], "a", ["--mode"]),
        ("median", ["1", "2", "3"], "2", ["--median"]),
        ("median", ["1", "2", "3", "4"], "2.5", ["--median"]),
    ]
    for field, rows, expected, extra in cases:
        got = get_stat(field, rows, extra)
        assert got.startswith(expected), (field, rows, expected, got)


if __name__ == "__main__":
    test_headers()
    test_count_slice_select_search_sort_fmt_table_frequency()
    test_stats()
    print("adapted original tests passed")
