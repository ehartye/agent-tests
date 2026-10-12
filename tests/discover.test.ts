import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { detectRunner, discoverTests, isSupportPath, isTestPath, walk } from '../src/discover.ts';
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
