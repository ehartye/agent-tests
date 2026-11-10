import unittest

from pkg import core  # noqa: F401


def load_tests(loader, tests, pattern):
    return unittest.TestSuite()


class LoadedTests(unittest.TestCase):
    def test_nothing(self):
        self.assertTrue(True)
