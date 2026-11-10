import { describe, expect, it } from 'vitest';
import { extractPythonFacts, extractPythonFactsWith } from '../src/python/facts.ts';
import { loadPythonParser } from '../src/python/parser.ts';

/** Join lines into Python source, so the snippets keep their own indentation. */
const py = (...lines: string[]) => lines.join('\n') + '\n';

describe('what counts as a test', () => {
  const cases: Array<{ title: string; source: string; tests: Array<[name: string, line: number, className?: string]> }> = [
    {
      title: 'module-level def and async def, not helpers',
      source: py('def test_a(): pass', 'async def test_b(): pass', 'def helper(): pass', 'def testing_without_underscore(): pass'),
      tests: [['test_a', 1], ['test_b', 2], ['testing_without_underscore', 4]],
    },
    {
      title: 'methods of a Test class without __init__',
      source: py('class TestThing:', '    def test_one(self): pass', '    def helper(self): pass', '    async def test_two(self): pass'),
      tests: [['test_one', 2, 'TestThing'], ['test_two', 4, 'TestThing']],
    },
    {
      title: 'a Test class with __init__ is not collected',
      source: py('class TestThing:', '    def __init__(self): pass', '    def test_one(self): pass'),
      tests: [],
    },
    {
      title: 'a class not named Test and not a TestCase is not collected',
      source: py('class Thing:', '    def test_one(self): pass', 'class Base(object):', '    def test_two(self): pass'),
      tests: [],
    },
    {
      title: 'TestCase, unittest.TestCase and any base ending TestCase are collected, even with __init__',
      source: py(
        'import unittest',
        'class A(unittest.TestCase):', '    def test_a(self): pass',
        'class B(TestCase):', '    def test_b(self): pass',
        'class C(DjangoTestCase, Mixin):', '    def __init__(self): pass', '    def test_c(self): pass',
        'class D(helpers.CustomTestCase):', '    def test_d(self): pass',
      ),
      tests: [['test_a', 3, 'A'], ['test_b', 5, 'B'], ['test_c', 8, 'C'], ['test_d', 10, 'D']],
    },
    {
      title: 'decorated tests are one declaration at the def line; parametrize counts once',
      source: py('import pytest', '@pytest.mark.parametrize("n", [1, 2, 3])', '@pytest.mark.skip', 'def test_p(n): pass'),
      tests: [['test_p', 4]],
    },
    {
      title: 'defs inside a module-level if or try block count as module level; nested defs and classes inside tests do not',
      source: py(
        'import sys',
        'if sys.platform == "win32":', '    def test_win(): pass',
        'def test_outer():', '    def test_inner(): pass',
      ),
      tests: [['test_win', 3], ['test_outer', 4]],
    },
  ];
  it.each(cases)('$title', async ({ source, tests }) => {
    const facts = await extractPythonFacts(source);
    expect(facts.hasError).toBe(false);
    expect(facts.tests.map(t => [t.name, t.line, ...(t.className ? [t.className] : [])])).toEqual(tests);
  });
});

describe('assertions per test', () => {
  const cases: Array<{ title: string; body: string[]; assertions: number }> = [
    { title: 'none', body: ['    x = 1'], assertions: 0 },
    { title: 'assert statements', body: ['    assert x', '    assert y, "msg"'], assertions: 2 },
    { title: 'self.assert* calls and self.fail', body: ['    self.assertEqual(1, 1)', '    self.assertTrue(x)', '    self.fail("no")'], assertions: 3 },
    { title: 'self.assertRaises as a with-block (once) and as a call (once)', body: ['    with self.assertRaises(ValueError):', '        f()', '    self.assertRaises(KeyError, g)'], assertions: 2 },
    { title: 'self.assertWarns and assertRaisesRegex with an alias', body: ['    with self.assertWarns(UserWarning) as w:', '        f()', '    with self.assertRaisesRegex(E, "x"):', '        g()'], assertions: 2 },
    { title: 'pytest.raises as a with-block and as a call', body: ['    with pytest.raises(ValueError):', '        f()', '    pytest.raises(KeyError, g)'], assertions: 2 },
    { title: 'pytest.warns and pytest.fail', body: ['    with pytest.warns(UserWarning):', '        f()', '    pytest.fail("x")'], assertions: 2 },
    { title: 'other pytest and self calls are not assertions', body: ['    pytest.skip("x")', '    pytest.approx(1)', '    self.setUp()', '    self.helper(1)', '    other.assertEqual(1, 1)', '    assertEqual(1, 1)'], assertions: 0 },
    { title: 'assertions inside a nested def and a lambda count toward the test', body: ['    def check(v):', '        assert v', '    f = lambda: self.assertTrue(1)', '    check(1)'], assertions: 2 },
  ];
  it.each(cases)('$title', async ({ body, assertions }) => {
    const facts = await extractPythonFacts(py('def test_x(self):', ...body));
    expect(facts.hasError).toBe(false);
    expect(facts.tests).toHaveLength(1);
    expect(facts.tests[0]!.assertions).toBe(assertions);
  });

  it('keeps each test own count; imported helper assertions are not followed', async () => {
    const facts = await extractPythonFacts(py(
      'from helpers import check', 'def test_a():', '    assert 1', 'def test_b():', '    check(1)', 'def test_c():', '    assert 1', '    assert 2',
    ));
    expect(facts.tests.map(t => [t.name, t.assertions])).toEqual([['test_a', 1], ['test_b', 0], ['test_c', 2]]);
  });
});

describe('markers', () => {
  const cases: Array<{ title: string; source: string; markers: Record<string, string[]>; moduleMarkers: string[] }> = [
    {
      title: 'function decorators, bare and called, other decorators ignored',
      source: py('import pytest', '@pytest.mark.merge', '@pytest.mark.parametrize("n", [1])', '@other.mark.nope', '@staticmethod', 'def test_a(n): pass', 'def test_b(): pass'),
      markers: { test_a: ['merge', 'parametrize'], test_b: [] },
      moduleMarkers: [],
    },
    {
      title: 'class markers apply to its methods, before the method own markers, without duplicates',
      source: py('import pytest', '@pytest.mark.release', '@pytest.mark.slow', 'class TestA:', '    @pytest.mark.slow', '    @pytest.mark.edit', '    def test_a(self): pass', '    def test_b(self): pass', 'def test_c(): pass'),
      markers: { test_a: ['release', 'slow', 'edit'], test_b: ['release', 'slow'], test_c: [] },
      moduleMarkers: [],
    },
    {
      title: 'a class-level pytestmark applies to its methods',
      source: py('import pytest', 'class TestA:', '    pytestmark = pytest.mark.scheduled', '    def test_a(self): pass'),
      markers: { test_a: ['scheduled'] },
      moduleMarkers: [],
    },
    {
      title: 'pytestmark single marker is a module marker, not a test marker',
      source: py('import pytest', 'pytestmark = pytest.mark.scheduled', 'def test_a(): pass'),
      markers: { test_a: [] },
      moduleMarkers: ['scheduled'],
    },
    {
      title: 'pytestmark list or tuple, with called markers',
      source: py('import pytest', 'pytestmark = [pytest.mark.merge, pytest.mark.skipif(True, reason="x")]', 'def test_a(): pass'),
      markers: { test_a: [] },
      moduleMarkers: ['merge', 'skipif'],
    },
    {
      title: 'pytestmark tuple and an annotated assignment',
      source: py('import pytest', 'pytestmark: list = (pytest.mark.edit, pytest.mark.slow)', 'def test_a(): pass'),
      markers: { test_a: [] },
      moduleMarkers: ['edit', 'slow'],
    },
    {
      title: 'non-marker values in pytestmark are ignored',
      source: py('import pytest', 'pytestmark = some_function()', 'other = pytest.mark.merge'),
      markers: {},
      moduleMarkers: [],
    },
  ];
  it.each(cases)('$title', async ({ source, markers, moduleMarkers }) => {
    const facts = await extractPythonFacts(source);
    expect(facts.hasError).toBe(false);
    expect(Object.fromEntries(facts.tests.map(t => [t.name, t.markers]))).toEqual(markers);
    expect(facts.moduleMarkers).toEqual(moduleMarkers);
  });
});

describe('tags in leading comments', () => {
  const cases: Array<{ title: string; source: string; tags: object }> = [
    { title: 'all three tags', source: py('# @lane merge', '# @risk auth-core', '# @subject src/a.py', '# @subject src/b.py', 'def test_a(): pass'), tags: { lane: 'merge', risk: 'auth-core', subjects: ['src/a.py', 'src/b.py'] } },
    { title: 'a shebang, an encoding line and blank lines may precede', source: py('#!/usr/bin/env python', '# -*- coding: utf-8 -*-', '', '# @lane release', 'x = 1'), tags: { lane: 'release' } },
    { title: 'a docstring may follow the comments', source: py('# @lane scheduled', '"""Doc."""', 'def test_a(): pass'), tags: { lane: 'scheduled' } },
    { title: 'a docstring before the comments means they are not leading', source: py('"""Doc."""', '# @lane merge', '# @subject src/a.py', 'def test_a(): pass'), tags: {} },
    { title: 'a tag after the first statement is ignored', source: py('import pytest', '# @lane merge', '# @risk x', 'def test_a(): pass'), tags: {} },
    { title: 'an invalid lane is ignored, other tags still read', source: py('# @lane nightly', '# @risk payments', 'x = 1'), tags: { risk: 'payments' } },
    { title: 'a risk must start with a letter', source: py('# @risk 9lives', 'x = 1'), tags: {} },
    { title: 'a subject takes the first non-space token', source: py('# @subject src/a.py extra words', 'x = 1'), tags: { subjects: ['src/a.py'] } },
    { title: 'a tag inside a docstring or a string is not read', source: py('"""', '@lane merge', '"""', 'x = 1'), tags: {} },
    { title: 'no comments at all', source: py('def test_a(): pass'), tags: {} },
  ];
  it.each(cases)('$title', async ({ source, tags }) => {
    expect((await extractPythonFacts(source)).tags).toEqual(tags);
  });
});

describe('imports', () => {
  const cases: Array<{ title: string; source: string; imports: Array<{ module: string; names: string[]; level: number }> }> = [
    { title: 'plain, dotted and multiple', source: py('import a', 'import a.b.c', 'import x, y.z'), imports: [{ module: 'a', names: [], level: 0 }, { module: 'a.b.c', names: [], level: 0 }, { module: 'x', names: [], level: 0 }, { module: 'y.z', names: [], level: 0 }] },
    { title: 'from-imports with several names', source: py('from a.b import c, d', 'from a import b'), imports: [{ module: 'a.b', names: ['c', 'd'], level: 0 }, { module: 'a', names: ['b'], level: 0 }] },
    { title: 'aliases keep the original names', source: py('import a.b as ab', 'from a import b as bb, c as cc'), imports: [{ module: 'a.b', names: [], level: 0 }, { module: 'a', names: ['b', 'c'], level: 0 }] },
    { title: 'relative level 1 and 2, with and without a module', source: py('from .m import x', 'from ..pkg.m import y', 'from . import m', 'from .. import n, o'), imports: [{ module: 'm', names: ['x'], level: 1 }, { module: 'pkg.m', names: ['y'], level: 2 }, { module: '', names: ['m'], level: 1 }, { module: '', names: ['n', 'o'], level: 2 }] },
    { title: 'parenthesised names and a wildcard', source: py('from a import (b,', '    c)', 'from d import *'), imports: [{ module: 'a', names: ['b', 'c'], level: 0 }, { module: 'd', names: ['*'], level: 0 }] },
    { title: 'imports inside functions and conditional blocks are recorded', source: py('def test_a():', '    import late', 'try:', '    from opt import thing', 'except ImportError:', '    pass'), imports: [{ module: 'late', names: [], level: 0 }, { module: 'opt', names: ['thing'], level: 0 }] },
  ];
  it.each(cases)('$title', async ({ source, imports }) => {
    const facts = await extractPythonFacts(source);
    expect(facts.hasError).toBe(false);
    expect(facts.imports).toEqual(imports);
  });
});

describe('dynamic imports', () => {
  const cases: Array<{ title: string; source: string; dynamic: Array<string | null> }> = [
    { title: 'importlib.import_module with a literal', source: py('import importlib', 'm = importlib.import_module("a.b")'), dynamic: ['a.b'] },
    { title: 'a bare import_module with a literal, single quotes', source: py("from importlib import import_module", "m = import_module('a.b')"), dynamic: ['a.b'] },
    { title: '__import__ with a literal', source: py('m = __import__("a.b")'), dynamic: ['a.b'] },
    { title: 'a relative literal keeps its dots', source: py('m = import_module(".x", "pkg")'), dynamic: ['.x'] },
    { title: 'a name= keyword literal', source: py('m = import_module(name="a.b")'), dynamic: ['a.b'] },
    { title: 'non-literal: a variable, an f-string, a concatenation, a call and no argument', source: py('import_module(name)', 'import_module(f"pkg.{n}")', 'import_module("a" + ".b")', '__import__(get())', 'import_module()'), dynamic: [null, null, null, null, null] },
    { title: 'inside a function, mixed with ordinary calls', source: py('def test_a():', '    importlib.import_module("a")', '    other.import_thing("b")', '    import_module(x)'), dynamic: ['a', null] },
  ];
  it.each(cases)('$title', async ({ source, dynamic }) => {
    const facts = await extractPythonFacts(source);
    expect(facts.hasError).toBe(false);
    expect(facts.dynamicImports.map(d => d.module)).toEqual(dynamic);
  });
});

describe('opaque registration', () => {
  const cases: Array<{ title: string; source: string; opaque: Array<{ reason: string; line: number; name?: string }> }> = [
    { title: 'a module-level load_tests', source: py('import unittest', '', 'def load_tests(loader, tests, pattern):', '    return tests'), opaque: [{ reason: 'load_tests', line: 3, name: 'load_tests' }] },
    { title: 'a nested or method load_tests is not opaque', source: py('class A:', '    def load_tests(self): pass', 'def f():', '    def load_tests(): pass'), opaque: [] },
    { title: 'imported Test*, *Test and *TestCase names, absolute and relative', source: py('from pkg.base import TestFoo', 'from .shared import BarTest, Helper', 'from unittest import TestCase', 'from . import SomeTestCase'), opaque: [{ reason: 'imported-test-class', line: 1, name: 'TestFoo' }, { reason: 'imported-test-class', line: 2, name: 'BarTest' }, { reason: 'imported-test-class', line: 3, name: 'TestCase' }, { reason: 'imported-test-class', line: 4, name: 'SomeTestCase' }] },
    { title: 'the bound alias is the name that is matched', source: py('from pkg import Helper as TestHelper', 'from pkg import TestReal as Real'), opaque: [{ reason: 'imported-test-class', line: 1, name: 'TestHelper' }] },
    { title: 'a function-level import of a Test name is not module-level', source: py('def f():', '    from pkg import TestFoo'), opaque: [] },
    { title: 'non-literal dynamic imports, literal ones are not opaque', source: py('import_module("a")', 'import_module(name)', '__import__(x)'), opaque: [{ reason: 'non-literal-import', line: 2 }, { reason: 'non-literal-import', line: 3 }] },
    { title: 'plain imports and non-matching names are not opaque', source: py('import pytest', 'from pkg import Contest, Retest, Helper, helper_Test_case', 'import pkg.TestThing'), opaque: [] },
  ];
  it.each(cases)('$title', async ({ source, opaque }) => {
    const facts = await extractPythonFacts(source);
    expect(facts.hasError).toBe(false);
    expect(facts.opaque).toEqual(opaque);
  });
});

describe('signals', () => {
  const cases: Array<{ title: string; source: string; signals: { unittest: boolean; pytest: boolean } }> = [
    { title: 'neither', source: py('import os', 'def test_a(): pass'), signals: { unittest: false, pytest: false } },
    { title: 'import pytest', source: py('import pytest'), signals: { unittest: false, pytest: true } },
    { title: 'import unittest', source: py('import unittest'), signals: { unittest: true, pytest: false } },
    { title: 'from-imports and submodules, both', source: py('from unittest import TestCase', 'from pytest import mark'), signals: { unittest: true, pytest: true } },
    { title: 'dotted submodules count', source: py('import unittest.mock', 'import pytest.fixture'), signals: { unittest: true, pytest: true } },
    { title: 'a similarly named module does not count', source: py('import pytest_helpers', 'import my_unittest', 'from .pytest import x'), signals: { unittest: false, pytest: false } },
  ];
  it.each(cases)('$title', async ({ source, signals }) => {
    expect((await extractPythonFacts(source)).signals).toEqual(signals);
  });
});

describe('syntax errors and tree disposal', () => {
  it('reports hasError for invalid source and still returns the facts it can read', async () => {
    const facts = await extractPythonFacts(py('# @lane merge', 'import pytest', 'def test_ok():', '    assert 1', 'def (:', '    broken'));
    expect(facts.hasError).toBe(true);
    expect(facts.tags).toEqual({ lane: 'merge' });
    expect(facts.signals.pytest).toBe(true);
    expect(facts.tests.map(t => t.name)).toContain('test_ok');
  });

  it('reports no error for valid source and returns empty facts for an empty file', async () => {
    const facts = await extractPythonFacts('');
    expect(facts).toEqual({ hasError: false, tests: [], moduleMarkers: [], tags: {}, imports: [], dynamicImports: [], opaque: [], signals: { unittest: false, pytest: false } });
  });

  it('deletes the tree on the success path, the error path and when reading throws', async () => {
    const real = await loadPythonParser();
    let deletes = 0;
    const counting = (source: string) => {
      const parsed = real(source);
      const original = parsed.tree.delete.bind(parsed.tree);
      parsed.tree.delete = () => { deletes++; original(); };
      return parsed;
    };
    await extractPythonFactsWith(counting, 'def test_a(): pass\n');
    await extractPythonFactsWith(counting, 'def (:\n');
    expect(deletes).toBe(2);

    const throwing = (source: string) => {
      const parsed = counting(source);
      Object.defineProperty(parsed.tree, 'rootNode', { get() { throw new Error('boom'); } });
      return parsed;
    };
    expect(() => extractPythonFactsWith(throwing, 'x = 1\n')).toThrow('boom');
    expect(deletes).toBe(3);
  });
});
