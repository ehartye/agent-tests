import unittest


def load_tests(loader, tests, pattern):
    return unittest.TestSuite()


class LoadedTests(unittest.TestCase):
    def test_nothing(self):
        self.assertTrue(True)
