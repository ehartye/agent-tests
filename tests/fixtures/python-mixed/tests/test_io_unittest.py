import unittest

from pkg import io as pkg_io


class IoTests(unittest.TestCase):
    def test_read_missing(self):
        self.assertIsNone(pkg_io.read("missing.txt"))


if __name__ == "__main__":
    unittest.main()
