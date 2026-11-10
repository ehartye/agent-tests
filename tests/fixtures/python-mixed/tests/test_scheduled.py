import pytest
from pkg.core import add

pytestmark = pytest.mark.scheduled


def test_large_sum():
    assert add(10**6, 10**6) == 2 * 10**6
