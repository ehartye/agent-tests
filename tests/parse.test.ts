import { describe, expect, it } from 'vitest';
import { parseTags, resolveSubjects } from '../src/parse.ts';
import { parseTestFile } from './helpers/parse.ts';
import { makeTree } from './helpers/tree.ts';

const SAMPLE = `/**
 * @lane merge
 * @risk critical
 */
import { describe, expect, it, vi } from 'vitest';
import { save } from '../src/store.ts';
import legacy from './legacy/format.js';

describe('store', () => {
  it('saves a value', () => {
    expect(save('a', 'b')).toBe('a=b');
    expect(true).toBe(true);
  });
  it.skip('is skipped but still a test', () => {
    expect(1).toBeTruthy();
  });
  it.todo('is not written yet');
  it.each([1, 2])('handles %s', value => {
    expect(value).toBeGreaterThan(0);
  });
  it('calls the transport', () => {
    const transport = vi.fn();
    transport('x');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('matches a snapshot', () => {
    expect(save('a', 'b')).toMatchSnapshot();
  });
  it('asserts nothing', () => {
    save('a', 'b');
  });
});
`;

describe('parseTestFile', () => {
  const parsed = parseTestFile('tests/store.test.ts', SAMPLE);

  it('collects imports and titles', () => {
    expect(parsed.imports).toEqual(['vitest', '../src/store.ts', './legacy/format.js']);
    expect(parsed.titles.map(title => title.text)).toContain('store');
    expect(parsed.titles.map(title => title.text)).toContain('saves a value');
  });

  it('counts tests, including skipped, todo and each', () => {
    expect(parsed.tests.map(test => test.name)).toEqual([
      'saves a value',
      'is skipped but still a test',
      'is not written yet',
      'handles %s',
      'calls the transport',
      'matches a snapshot',
      'asserts nothing',
    ]);
    expect(parsed.tests.find(test => test.name === 'is not written yet')?.todo).toBe(true);
  });

  it('attributes assertions to the test that contains them', () => {
    const byName = Object.fromEntries(parsed.tests.map(test => [test.name, test.assertions]));
    expect(byName['saves a value']).toBe(2);
    expect(byName['asserts nothing']).toBe(0);
  });

  it('counts total, snapshot, mock assertions and mock calls', () => {
    expect(parsed.assertions).toBe(6);
    expect(parsed.snapshotAssertions).toBe(1);
    expect(parsed.mockAssertions).toBe(1);
    expect(parsed.mockCalls).toBe(1);
  });

  it('flags a tautological identity assertion but not a real one', () => {
    expect(parsed.tautologies).toBe(1);
  });

  it('reports 1-based line numbers, including after non-ASCII text', () => {
    const lines = parseTestFile('a.test.ts', "// héllo — ✓\nit('first', () => {});\n\nit('second', () => {});\n");
    expect(lines.tests.map(test => [test.name, test.line])).toEqual([
      ['first', 2],
      ['second', 4],
    ]);
  });

  it('reads lane and risk tags from the leading docblock', () => {
    expect(parsed.tags).toEqual({ lane: 'merge', risk: 'critical' });
  });
});

describe('parseTestFile imports', () => {
  it('leaves out type-only imports but keeps mixed ones', () => {
    const source = [
      "import type { A } from './a.ts';",
      "import { type B } from './b.ts';",
      "import { type C, c } from './c.ts';",
      "import d from './d.ts';",
      "import './e.ts';",
    ].join('\n');
    const parsed = parseTestFile('a.test.ts', source);
    expect(parsed.imports).toEqual(['./c.ts', './d.ts', './e.ts']);
  });
});

describe('parseTags', () => {
  it('ignores an unknown lane', () => {
    expect(parseTags('/** @lane nightly */')).toEqual({});
  });

  it('collects every @subject path', () => {
    expect(parseTags('/**\n * @subject src/cli.ts\n * @subject scripts/run-managed.js\n */')).toEqual({ subjects: ['src/cli.ts', 'scripts/run-managed.js'] });
  });
});

describe('parseTestFile on JSX and plain JavaScript', () => {
  it('parses a .jsx test without throwing', () => {
    const parsed = parseTestFile('a.test.jsx', "it('renders', () => { expect(<div />).toBeTruthy(); });");
    expect(parsed.tests).toHaveLength(1);
  });

  it('parses a .mjs test', () => {
    expect(parseTestFile('a.test.mjs', "import { test } from 'node:test';\ntest('x', () => {});").tests).toHaveLength(1);
  });
});

describe('resolveSubjects', () => {
  it('resolves relative imports to repo-relative source files, mapping .js to .ts', () => {
    const root = makeTree({ 'src/store.ts': '', 'src/legacy/format.ts': '', 'tests/store.test.ts': '' });
    expect(resolveSubjects(root, 'tests/store.test.ts', ['vitest', '../src/store.ts', '../src/legacy/format.js'])).toEqual(['src/legacy/format.ts', 'src/store.ts']);
  });

  it('resolves a directory import to its index file', () => {
    const root = makeTree({ 'src/store/index.ts': '', 'tests/a.test.ts': '' });
    expect(resolveSubjects(root, 'tests/a.test.ts', ['../src/store'])).toEqual(['src/store/index.ts']);
  });

  it('skips test files, helpers and unresolved paths', () => {
    const root = makeTree({ 'src/a.test.ts': '', 'tests/helpers/tree.ts': '', 'tests/a.test.ts': '' });
    expect(resolveSubjects(root, 'tests/a.test.ts', ['../src/a.test.ts', './helpers/tree.ts', './missing.ts'])).toEqual([]);
  });
});
