import unittest
from pathlib import Path

import zip_password_finder_port as port


class PortTests(unittest.TestCase):
    def test_preset_is_sorted_and_deduplicated(self):
        self.assertEqual(port.preset_charset("hd"), "0123456789abcdef")

    def test_custom_charset_tokens_preserve_order(self):
        self.assertEqual(port.custom_charset("a??a?d"), "a?0123456789")

    def test_bruteforce_order(self):
        self.assertEqual(list(port.brute_candidates("ab", 1, 2, None)),
                         [b"a", b"b", b"aa", b"ab", b"ba", b"bb"])

    def test_mask_order(self):
        positions = port.parse_mask("?1?d", ["ab", None, None, None])
        values = list(port.mask_candidates(positions))
        self.assertEqual(values[:3], [b"a0", b"a1", b"a2"])
        self.assertEqual(values[-1], b"b9")

    def test_reference_aes_fixtures(self):
        expected = {"2.test.txt.zip": b"ab", "3.test.txt.zip": b"abc", "4.test.txt.zip": b"abcd"}
        for name, password in expected.items():
            member = port.parse_zip(str(Path("rust-reference/test-files") / name))[0]
            self.assertTrue(port.verify(member, password), name)
            self.assertFalse(port.verify(member, password + b"x"), name)

    def test_reference_zipcrypto_fixture(self):
        members = port.parse_zip("rust-reference/test-files/multi-file-with-dir.zip")
        self.assertTrue(port.verify(members[1], b"ab"))
        self.assertFalse(port.verify(members[1], b"wrong"))


if __name__ == "__main__":
    unittest.main()
