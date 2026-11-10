import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { censusLanguage, detectRunner, discoverCensus, discoverTests, groupCensusFiles, inspectCensus, isPythonSupportFile, isPythonTestPath, isSupportPath, isTestPath, walk } from '../src/discover.ts';
import { makeTree } from './helpers/tree.ts';

describe('isTestPath', () => {
  it('recognizes .test and .spec files and __tests__ directories', () => {
    expect(isTestPath('src/a.test.ts')).toBe(true);
    expect(isTestPath('src/a.spec.mjs')).toBe(true);
    expect(isTestPath('src/__tests__/a.ts')).toBe(true);
    expect(isTestPath('src/a.ts')).toBe(false);
    expect(isTestPath('src/a.test.md')).toBe(false);
  });

  it('covers module-flavored extensions and rejects declaration files', () => {
    expect(isTestPath('src/a.test.d.ts')).toBe(false);
    expect(isTestPath('src/a.test.mts')).toBe(true);
    expect(isTestPath('src/a.spec.cts')).toBe(true);
    expect(isTestPath('src/a.test.tsx')).toBe(true);
  });
});

describe('isSupportPath', () => {
  it('treats helpers, fixtures and mocks as support code', () => {
    expect(isSupportPath('tests/helpers/tree.ts')).toBe(true);
    expect(isSupportPath('src/__mocks__/fs.ts')).toBe(true);
    expect(isSupportPath('src/persistence/store.ts')).toBe(false);
  });
});

describe('walk', () => {
  it('skips a directory that cannot be read instead of throwing', () => {
    const root = makeTree({ 'a.test.ts': '' });
    const visited: string[] = [];
    expect(() => walk(join(root, 'missing'), (_absolute, rel) => visited.push(rel))).not.toThrow();
    expect(visited).toEqual([]);
  });
});

describe('discoverTests', () => {
  it('excludes browser automation archive checkouts', () => {
    const root = makeTree({ 'tests/live.test.mjs': '', '.playwright-mcp/matrix/source/tests/copied.test.mjs': '' });
    expect(discoverTests(root)).toEqual(['tests/live.test.mjs']);
  });
  it('excludes archived local releases and generated reports', () => {
    const root = makeTree({ 'tests/live.test.mjs': '', '.local/releases/old/tests/stale.test.mjs': '', 'test-results/copy.test.mjs': '', 'playwright-report/copy.spec.mjs': '' });
    expect(discoverTests(root)).toEqual(['tests/live.test.mjs']);
  });
  it('finds test files in sorted order and skips ignored directories, including fixtures', () => {
    const root = makeTree({
      'b.test.ts': '',
      'a.test.ts': '',
      'src/util.ts': '',
      'src/__tests__/helper.ts': '',
      'node_modules/pkg/x.test.ts': '',
      'dist/y.test.js': '',
      'tests/fixtures/sample/z.test.ts': '',
    });
    expect(discoverTests(root)).toEqual(['a.test.ts', 'b.test.ts', 'src/__tests__/helper.ts']);
  });

  it('skips nested git worktrees', () => {
    const root = makeTree({
      'a.test.ts': '',
      '.worktrees/x/a.test.ts': '',
      '.claude/worktrees/y/b.test.ts': '',
    });
    expect(discoverTests(root)).toEqual(['a.test.ts']);
  });

  it('returns plain code-unit order of the full path, not traversal order', () => {
    const root = makeTree({ 'a/x.test.ts': '', 'a-b/x.test.ts': '' });
    expect(discoverTests(root)).toEqual(['a-b/x.test.ts', 'a/x.test.ts']);
  });
});

describe('detectRunner', () => {
  it('does not identify example text in comments or string fixtures as active Node imports', () => {
    const root = makeTree({ 'tests/example.test.mjs': '// Example: import test from "node:test";\nconst fixture = "import test from \'node:test\';";\nexport {};' });
    expect(detectRunner(root)).toBe('unknown');
  });
  it('detects a Node test suite behind a wrapper and still prefers configured vitest', () => {
    const files = { 'package.json': JSON.stringify({ scripts: { test: 'node scripts/test.mjs' } }), 'scripts/test.mjs': '', 'tests/live.test.mjs': "import {test} from 'node:test'; test('works',()=>{});" };
    expect(detectRunner(makeTree(files))).toBe('node:test');
    expect(detectRunner(makeTree({ ...files, 'vitest.config.ts': '' }))).toBe('vitest');
    expect(detectRunner(makeTree({ '.local/old.test.mjs': "import test from 'node:test';" }))).toBe('unknown');
  });
  it('prefers vitest from package.json', () => {
    const root = makeTree({ 'package.json': JSON.stringify({ devDependencies: { vitest: '5.0.3', jest: '30.0.0' } }) });
    expect(detectRunner(root)).toBe('vitest');
  });

  it('detects jest from dependencies', () => {
    expect(detectRunner(makeTree({ 'package.json': JSON.stringify({ devDependencies: { jest: '30.0.0' } }) }))).toBe('jest');
  });

  it('falls back to a config file', () => {
    expect(detectRunner(makeTree({ 'package.json': '{}', 'jest.config.js': '' }))).toBe('jest');
  });

  it('reports unknown for a root with no package.json and no config', () => {
    expect(detectRunner(makeTree())).toBe('unknown');
  });

  it('detects vitest from a config file when package.json lists no dependencies', () => {
    expect(detectRunner(makeTree({ 'package.json': '{}', 'vitest.config.ts': '' }))).toBe('vitest');
  });

  it('reports unknown when nothing identifies a runner', () => {
    expect(detectRunner(makeTree({ 'package.json': '{not json' }))).toBe('unknown');
  });
});

describe('censusLanguage', () => {
  it.each([
    ['py/test_core.py', 'Python'], ['py/core_test.py', 'Python'], ['svc/service_test.go', 'Go'],
    ['spec/a_spec.rb', 'Ruby'], ['test/test_a.rb', 'Ruby'], ['tests/Core.Tests.ps1', 'PowerShell'],
    ['src/FooTest.java', 'Java'], ['src/FooTests.kt', 'Kotlin'], ['src/FooTest.cs', 'C#'], ['src/FooTests.php', 'PHP'],
    ['py/core.py', null], ['py/testing.py', null], ['py/test.txt', null], ['go/service.go', null], ['tests/Core.ps1', null],
    ['src/Contest.java', null], ['src/Test.cs.bak', null], ['a.test.ts', null],
  ])('names %s as %s', (rel, language) => {
    expect(censusLanguage(rel)).toBe(language);
  });
});

describe('discoverCensus', () => {
  it('groups test-named files by language in sorted order and skips Python-only ignored directories', () => {
    const root = makeTree({
      'b/test_b.py': '', 'a/test_a.py': '', 'go/x_test.go': '', 'web/a.test.ts': '', 'src/core.py': '',
      'venv/lib/test_v.py': '', 'env/test_e.py': '', '__pycache__/test_c.py': '', 'lib/site-packages/test_s.py': '',
      '.tox/py/test_t.py': '', '.mypy_cache/test_m.py': '', '.pytest_cache/test_p.py': '', '.ruff_cache/test_r.py': '',
      'pkg.egg-info/test_g.py': '', 'node_modules/x/test_n.py': '', '.venv/test_d.py': '',
      'third_party/x/test_t.py': '', 'thirdparty/y/z_test.go': '', 'testdata/FooTest.java': '', 'ios/Pods/Pod/PodTest.cs': '', 'target/debug/m_test.go': '',
    });
    expect(discoverCensus(root)).toEqual([
      { language: 'Go', files: ['go/x_test.go'] },
      { language: 'Python', files: ['a/test_a.py', 'b/test_b.py'] },
    ]);
  });

  it('finds conftest.py files for runner detection without ever listing one as a test, and skips the same directories', () => {
    const root = makeTree({ 'tests/conftest.py': '', 'conftest.py': '', 'tests/test_a.py': '', 'venv/lib/conftest.py': '', '.venv/conftest.py': '', 'node_modules/p/conftest.py': '' });
    expect(inspectCensus(root)).toEqual({ groups: [{ language: 'Python', files: ['tests/test_a.py'] }], conftests: ['conftest.py', 'tests/conftest.py'] });
    expect(discoverCensus(root)).toEqual(inspectCensus(root).groups);
  });

  it.each([
    ['tests/test_a.py', true, false], ['src/a_test.py', true, false], ['test_a.py', true, false], ['src/conftest.py', false, true], ['conftest.py', false, true],
    ['src/a.py', false, false], ['src/testing.py', false, false], ['src/my_conftest.py', false, false], ['src/test_a.pyc', false, false], ['checks/geometry_check.py', false, false],
  ])('classifies %s as a Python test: %s, as a Python support file: %s', (rel, test, support) => {
    expect(isPythonTestPath(rel)).toBe(test);
    expect(isPythonSupportFile(rel)).toBe(support);
  });

  it('leaves JavaScript discovery alone, directories the census skips included', () => {
    const dirs = ['venv', 'env', '__pycache__', 'site-packages', 'third_party', 'thirdparty', 'testdata', 'Pods', 'target'];
    const found = discoverTests(makeTree(Object.fromEntries([...dirs.map(dir => [`${dir}/pkg/a.test.js`, '']), ['src/a.test.ts', '']])));
    expect(found).toEqual([...dirs.map(dir => `${dir}/pkg/a.test.js`), 'src/a.test.ts'].sort());
  });

  it('groups 60,000 names in linear time, sorted', () => {
    const names = Array.from({ length: 60000 }, (_, i) => `pkg/t${String(60000 - i).padStart(6, '0')}/test_a.py`);
    const started = performance.now();
    const groups = groupCensusFiles([...names, 'svc/a_test.go', 'src/core.py']);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(groups.map(group => `${group.language}:${group.files.length}`)).toEqual(['Go:1', 'Python:60000']);
    expect(groups[1]!.files).toEqual([...names].sort());
  });
});
