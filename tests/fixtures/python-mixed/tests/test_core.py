import pytest
from pkg.core import add


def test_add():
    assert add(2, 3) == 5


def test_add_negative():
    assert add(-1, -1) == -2


class TestAdd:
    def test_zero(self):
        assert add(0, 0) == 0

    def test_rejects_none(self):
        with pytest.raises(TypeError):
            add(None, 1)


@pytest.mark.merge
def test_merge_only():
    assert add(1, 1) == 2


def test_no_assertion():
    add(1, 2)
