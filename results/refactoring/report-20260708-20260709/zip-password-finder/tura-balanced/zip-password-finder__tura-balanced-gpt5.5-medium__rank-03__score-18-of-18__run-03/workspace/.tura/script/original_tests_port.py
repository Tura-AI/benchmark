import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from zip_password_finder_port import (  # noqa: E402
    LOWER,
    charset_from_options,
    dictionary_passwords,
    generate_mask_passwords,
    generate_passwords,
    parse_custom_charset,
    parse_mask,
    password_count,
)


FIXTURES = ROOT / "rust-reference" / "test-files"


def assert_equal(actual, expected):
    if actual != expected:
        raise AssertionError(f"expected {expected!r}, got {actual!r}")


def run_port(*args):
    return subprocess.run(
        [sys.executable, str(ROOT / "executable"), *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_generators():
    assert_equal(password_count(3, 1, 2), 12)
    assert_equal(list(generate_passwords(list("abc"), 1, 2, None))[:12], [
        "a", "b", "c", "aa", "ab", "ac", "ba", "bb", "bc", "ca", "cb", "cc"
    ])
    assert_equal(list(generate_passwords(list("abc"), 1, 2, "bb")), ["bb", "bc", "ca", "cb"])
    assert_equal(list(generate_passwords(["a"], 1, 3, None)), ["a", "aa", "aaa"])


def test_charsets_and_masks():
    assert_equal(charset_from_options({"charset": "l"}), LOWER)
    assert_equal(parse_custom_charset("aab"), ["a", "b"])
    assert_equal(parse_custom_charset("a??b"), ["a", "?", "b"])
    assert_equal(len(parse_custom_charset("?h?d")), 16)
    mask = parse_mask("?1?2", [["a", "b"], ["1", "2", "3"], None, None])
    assert_equal(list(generate_mask_passwords(mask)), ["a1", "a2", "a3", "b1", "b2", "b3"])


def test_dictionary_reader():
    words = dictionary_passwords(str(FIXTURES / "generated-passwords-lowercase.txt"))
    assert_equal(next(words), "a")
    assert_equal(sum(1 for _ in dictionary_passwords(str(FIXTURES / "generated-passwords-lowercase.txt"))), 18278)


def test_end_to_end_fixtures():
    cases = [
        ("2.test.txt.zip", ["-c", "l", "--minPasswordLen", "1", "--maxPasswordLen", "2"], "Password found:ab"),
        ("3.test.txt.zip", ["-c", "l", "--minPasswordLen", "1", "--maxPasswordLen", "3"], "Password found:abc"),
        ("2.test.txt.zip", ["--mask", "?d?d"], "Password not found"),
        ("multi-file-with-dir.zip", ["-c", "l", "--minPasswordLen", "1", "--maxPasswordLen", "2"], "Password found:ab"),
    ]
    for archive, args, expected in cases:
        proc = run_port("-i", str(FIXTURES / archive), "--workers", "1", *args)
        assert_equal(proc.returncode, 0)
        if expected not in proc.stdout:
            raise AssertionError(proc.stdout)


def main():
    test_generators()
    test_charsets_and_masks()
    test_dictionary_reader()
    test_end_to_end_fixtures()
    print("adapted original tests passed")


if __name__ == "__main__":
    main()
