import unittest

import main


class AesTests(unittest.TestCase):
    def test_standard_aes_128_vector(self):
        key = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
        block = bytes.fromhex("00112233445566778899aabbccddeeff")
        self.assertEqual(main.aes_block(block, key).hex(), "69c4e0d86a7b0430d8cdb78070b4c55a")

    def test_aes_fixture_password(self):
        target = main.ZipTarget.load("rust-reference/test-files/2.test.txt.zip", 0)
        self.assertTrue(target.check(b"ab"))
        self.assertFalse(target.check(b"wrong"))


if __name__ == "__main__":
    unittest.main()
