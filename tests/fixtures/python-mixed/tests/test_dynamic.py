import importlib
from importlib import import_module


def test_literal_import():
    module = importlib.import_module("pkg.core")
    assert module.add(1, 1) == 2


def test_computed_import():
    name = "pkg." + "io"
    assert import_module(name) is not None
