import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declaredSubjects, openParseSession, parseTags, resolveSubjects } from '../src/parse.ts';
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

describe('opaque test factory candidates', () => {
  it('preserves uncertainty for top-level and describe-nested helper registrations', () => {
    const parsed = parseTestFile('factory.test.js', `import { test, expect, describe } from 'vitest';
      sourceTest(['wiki.md'])('quoted content', () => { expect(1).toBeTruthy(); });
      describe('sources', () => { sourceTest([])('nested content', async () => {}); });
      test('known', () => { ordinaryFactory()('not a registration', () => {}); });`);
    expect(parsed.tests.map(test => test.name)).toEqual(['known']);
    expect(parsed.opaqueTestCalls?.map(call => call.callee)).toEqual(['sourceTest', 'sourceTest']);
  });

  it('does not flag ordinary helper bodies or native curried declarations', () => {
    const parsed = parseTestFile('ordinary.test.js', `function helper() { curry()('value', () => {}); }
      class Ordinary { method() { curry()('value', () => {}); } }
      test.skipIf(false)('native', () => {});
      const value = mapper()('value', () => {});`);
    expect(parsed.opaqueTestCalls).toBeUndefined();
  });
});

describe('TypeScript path aliases as subjects', () => {
  it('does not substitute a JS module for a missing explicit Svelte component', () => {
    const root = makeTree({ 'src/Screen.svelte.js': '' });
    expect(resolveSubjects(root, 'tests/screen.test.js', ['../src/Screen.svelte'])).toEqual([]);
  });

  it('gives exact aliases and then the longest wildcard prefix precedence', () => {
    const root = makeTree({
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@*': ['src/broad/*'], '@sim/*': ['src/sim/*'], '@sim/value': ['src/exact.ts'] } } }),
      'src/broad/sim/value.ts': '', 'src/sim/value.ts': '', 'src/exact.ts': '', 'src/sim/other.ts': '', 'src/broad/sim/other.ts': '',
    });
    expect(resolveSubjects(root,'tests/value.test.ts',['@sim/value','@sim/other'])).toEqual(['src/exact.ts','src/sim/other.ts']);
  });
  it('keeps relative subjects while declining inherited or JSONC alias configurations', () => {
    for (const config of ['{"extends":"./base.json","compilerOptions":{"paths":{"@x":["src/x.ts"]}}}', '{/*config*/"compilerOptions":{"paths":{"@x":["src/x.ts"]}}}']) {
      const root=makeTree({'tsconfig.json':config,'src/x.ts':''});
      expect(resolveSubjects(root,'tests/x.test.ts',['@x','../src/x.ts'])).toEqual(['src/x.ts']);
    }
  });
  it('resolves exact and wildcard aliases from a direct tsconfig without treating packages as aliases', () => {
    const root = makeTree({
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@sim/*': ['./src/sim/*'], '@clock': ['./src/sim/clock.ts'] } } }),
      'src/sim/clock.ts': '', 'tests/clock.test.ts': '',
    });
    expect(resolveSubjects(root, 'tests/clock.test.ts', ['@sim/clock', '@clock', 'vitest'])).toEqual(['src/sim/clock.ts']);
  });
  it('tries ordered targets and respects baseUrl while excluding test support and missing targets', () => {
    const root = makeTree({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: './src', paths: { '@sim/*': ['missing/*', 'sim/*'], '@helper': ['../tests/helpers/value.ts'] } } }),
      'src/sim/value.ts': '', 'tests/helpers/value.ts': '', 'tests/value.test.ts': '',
    });
    expect(resolveSubjects(root, 'tests/value.test.ts', ['@sim/value', '@sim/missing', '@helper'])).toEqual(['src/sim/value.ts']);
  });
});

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
    // Each padded line is far longer than any shift a byte-versus-character mix-up could cause on a short line.
    const pad = `// ${'é—✓🙂'.repeat(60)}`;
    const lines = parseTestFile('a.test.ts', `${pad}\n${pad}\n${pad}\nit('first', () => {});\n${pad}\n\nit('second', () => {});\n`);
    expect(lines.tests.map(test => [test.name, test.line])).toEqual([
      ['first', 4],
      ['second', 7],
    ]);
  });

  it('reports the right lines in a CRLF source', () => {
    const lines = parseTestFile('a.test.ts', "it('first', () => {});\r\n\r\nit('second', () => {});\r\n");
    expect(lines.tests.map(test => [test.name, test.line])).toEqual([
      ['first', 1],
      ['second', 3],
    ]);
  });

  it('parses a file that starts with a byte order mark', () => {
    const parsed = parseTestFile('a.test.ts', "﻿it('first', () => {});\nit('second', () => {});");
    expect(parsed.tests.map(test => [test.name, test.line])).toEqual([
      ['first', 1],
      ['second', 2],
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

  it('collects require and dynamic import specifiers but not mocked modules', () => {
    const source = [
      "const a = require('./a.cjs');",
      "const b = await import('./b.js');",
      "vi.mock('./mocked.ts');",
      "jest.mock('./also-mocked.ts', () => ({}));",
      'const c = require(name);',
      'const d = await import(name);',
    ].join('\n');
    expect(parseTestFile('a.test.ts', source).imports).toEqual(['./a.cjs', './b.js']);
  });
});

describe('parseTestFile test and suite forms', () => {
  it('counts curried, tagged-template and line-split forms once each', () => {
    const source = [
      "it.each([1, 2])('each %s', value => {});",
      "it.skipIf(true)('skip if', () => {});",
      "it.runIf(false)('run if', () => {});",
      "test.for([1])('for %s', value => {});",
      "it.each`a | b\n${1} | ${2}`('tagged %s', () => {});",
      "it\n  .skip('split over lines', () => {});",
      "it.concurrent.each([1])('concurrent each', () => {});",
      "it.sequential('sequential', () => {});",
      "it.todo('not written');",
      "describe.each([1])('suite %s', () => {});",
      "describe\n  .skip('split suite', () => {});",
    ].join('\n');
    const parsed = parseTestFile('forms.test.ts', source);
    expect(parsed.tests.map(test => test.name)).toEqual(['each %s', 'skip if', 'run if', 'for %s', 'tagged %s', 'split over lines', 'concurrent each', 'sequential', 'not written']);
    expect(parsed.tests.map(test => test.todo)).toEqual([false, false, false, false, false, false, false, false, true]);
    expect(parsed.titles.map(title => title.text)).toEqual([...parsed.tests.map(test => test.name), 'suite %s', 'split suite']);
  });

  it('does not count a one-argument call that only builds a curried test', () => {
    const parsed = parseTestFile('forms.test.ts', "it.each([1, 2]);\nit.skipIf(true);\ndescribe.each([1]);");
    expect(parsed.tests).toEqual([]);
    expect(parsed.titles).toEqual([]);
  });
});

describe('parseTestFile assertions and matchers', () => {
  it('counts expect.soft and expect.poll but not expect.assertions', () => {
    const source = [
      "it('a', async () => {",
      '  expect.assertions(2);',
      '  expect.soft(a).toBe(1);',
      '  await expect.poll(() => b).toBe(2);',
      '  expect.soft(c).not.toBeNull();',
      '});',
    ].join('\n');
    const parsed = parseTestFile('a.test.ts', source);
    expect(parsed.assertions).toBe(3);
    expect(parsed.tests[0]?.assertions).toBe(3);
  });

  it('recognises every snapshot matcher', () => {
    const matchers = ['toMatchSnapshot', 'toMatchInlineSnapshot', 'toMatchFileSnapshot', 'toThrowErrorMatchingSnapshot', 'toThrowErrorMatchingInlineSnapshot'];
    const source = `it('a', () => {\n${matchers.map(matcher => `  expect(x).${matcher}();`).join('\n')}\n});`;
    expect(parseTestFile('a.test.ts', source).snapshotAssertions).toBe(matchers.length);
  });

  it('recognises every mock matcher, old and new', () => {
    const matchers = [
      'toHaveBeenCalled',
      'toHaveBeenCalledWith',
      'toHaveBeenCalledTimes',
      'toHaveBeenLastCalledWith',
      'toHaveBeenNthCalledWith',
      'toBeCalled',
      'toBeCalledWith',
      'toBeCalledTimes',
      'toHaveReturned',
      'toHaveReturnedWith',
      'toHaveReturnedTimes',
      'toHaveBeenCalledOnce',
      'toHaveBeenCalledExactlyOnceWith',
      'toHaveLastReturnedWith',
      'toHaveNthReturnedWith',
      'toHaveResolved',
      'toHaveResolvedWith',
      'toHaveLastResolvedWith',
      'toHaveNthResolvedWith',
      'toHaveResolvedTimes',
      'lastCalledWith',
      'nthCalledWith',
    ];
    const source = `it('a', () => {\n${matchers.map(matcher => `  expect(x).${matcher}();`).join('\n')}\n});`;
    expect(parseTestFile('a.test.ts', source).mockAssertions).toBe(matchers.length);
  });

  it('does not count ordinary matchers as mock or snapshot assertions', () => {
    const parsed = parseTestFile('a.test.ts', "it('a', () => {\n  expect(x).toBe(1);\n  expect(x).toHaveLength(1);\n});");
    expect([parsed.mockAssertions, parsed.snapshotAssertions]).toEqual([0, 0]);
  });
});

describe('parseTestFile tautologies', () => {
  const count = (body: string): number => parseTestFile('a.test.ts', `it('a', () => {\n${body}\n});`).tautologies;

  it('flags a direct comparison of an expression with itself', () => {
    expect(count('expect(true).toBe(true);')).toBe(1);
    expect(count('expect(value).toEqual(value);')).toBe(1);
  });

  it('does not flag a negated or resolved comparison', () => {
    expect(count('expect(value).not.toBe(value);')).toBe(0);
    expect(count('await expect(value).resolves.toBe(value);')).toBe(0);
  });

  it('does not flag a repeated call, which is a determinism check', () => {
    expect(count("expect(hash('a')).toBe(hash('a'));")).toBe(0);
  });
});

describe('parseTestFile session', () => {
  it.runIf(process.env.AGENT_TESTS_STRESS === '1')('parses a thousand and more distinct files in one session, across its restart', { timeout: 60_000 }, () => {
    const session = openParseSession();
    try {
      for (let i = 0; i < 1200; i++) {
        const parsed = session.parse(`f${i}.test.ts`, `import { x${i} } from './x${i}.ts';\nit('t${i}', () => {\n  expect(x${i}).toBe(${i});\n});\n`);
        expect(parsed.imports).toEqual([`./x${i}.ts`]);
        expect(parsed.tests.map(test => [test.name, test.line, test.assertions])).toEqual([[`t${i}`, 2, 1]]);
      }
    } finally {
      session.close();
    }
  });
});

describe('parseTags', () => {
  it('ignores an unknown lane', () => {
    expect(parseTags('/** @lane nightly */')).toEqual({});
  });

  it('reads tags from every leading comment, line or block', () => {
    expect(parseTags('\n// @lane edit\n/* @risk high */\n\nimport x from "y";')).toEqual({ lane: 'edit', risk: 'high' });
  });

  it('ignores tag-like text outside the leading comments', () => {
    expect(parseTags("import x from 'y';\nconst note = 'contact @risk critical';\n")).toEqual({});
    expect(parseTags("/** @lane merge */\nimport x from 'y';\n// @risk critical\n")).toEqual({ lane: 'merge' });
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

  it('maps .mjs and .cjs imports to .mts and .cts sources and finds an index.mts', () => {
    const root = makeTree({ 'src/esm.mts': '', 'src/x.cts': '', 'src/lib/index.mts': '', 'tests/a.test.ts': '' });
    expect(resolveSubjects(root, 'tests/a.test.ts', ['../src/esm.mjs', '../src/x.cjs', '../src/lib'])).toEqual(['src/esm.mts', 'src/lib/index.mts', 'src/x.cts']);
  });

  it('never treats a non-code file as a subject', () => {
    const root = makeTree({ 'src/data.json': '{}', 'src/style.css': '', 'tests/a.test.ts': '' });
    expect(resolveSubjects(root, 'tests/a.test.ts', ['../src/data.json', '../src/style.css'])).toEqual([]);
  });

  it('skips test files, helpers and unresolved paths', () => {
    const root = makeTree({ 'src/a.test.ts': '', 'tests/helpers/tree.ts': '', 'tests/a.test.ts': '' });
    expect(resolveSubjects(root, 'tests/a.test.ts', ['../src/a.test.ts', './helpers/tree.ts', './missing.ts'])).toEqual([]);
  });
});

describe('declaredSubjects', () => {
  const tree = () => makeTree({ 'src/x.ts': '', 'src/y.sql': '', 'tests/b.test.ts': '', 'tests/helpers/tree.ts': '' });

  it('normalises ./ and .. segments and dedupes', () => {
    expect(declaredSubjects(tree(), ['./src/x.ts', 'src/x.ts', 'src/../src/x.ts'])).toEqual(['src/x.ts']);
  });

  it('accepts the backslash form', () => {
    expect(declaredSubjects(tree(), ['src\\x.ts'])).toEqual(['src/x.ts']);
  });

  it('allows a non-code file such as a SQL migration, and sorts', () => {
    expect(declaredSubjects(tree(), ['src/y.sql', 'src/x.ts'])).toEqual(['src/x.ts', 'src/y.sql']);
  });

  it('drops paths outside the root, directories, test files, helpers and missing files', () => {
    const outside = makeTree({ 'x.ts': '' });
    expect(declaredSubjects(tree(), ['../../x', '../x.ts', join(outside, 'x.ts'), 'src', 'tests/b.test.ts', 'tests/helpers/tree.ts', 'src/missing.ts'])).toEqual([]);
  });
});

describe('parseTestFile skipped cases', () => {
  const skipFacts = (source: string) => parseTestFile('skips.test.ts', source).tests.map(test => ({ name: test.name, skipped: test.skipped, conditional: test.conditional, bodySkip: test.bodySkip, skipReasons: test.skipReasons }));

  it('records a declared skip, a conditional declaration and a plain test apart', () => {
    const facts = skipFacts([
      "it('plain', () => {});",
      "it.skip('declared', () => {});",
      "test.skip('declared too', () => {});",
      "it.skipIf(offline)('conditional', () => {});",
      "it.runIf(online)('also conditional', () => {});",
    ].join('\n'));
    expect(facts.map(fact => [fact.name, fact.skipped, fact.conditional, fact.bodySkip])).toEqual([
      ['plain', false, false, false],
      ['declared', true, false, false],
      ['declared too', true, false, false],
      ['conditional', false, true, false],
      ['also conditional', false, true, false],
    ]);
  });

  it('records a body that calls the context skip, whatever the first parameter is called', () => {
    const facts = skipFacts([
      "it('ctx', ctx => { ctx.skip('no network'); });",
      "it('context', async (context) => { context.skip('no network'); });",
      "it('t', function (t) { t.skip('no network'); });",
      "it('destructured', ({ skip }) => { skip('no network'); });",
      "it('renamed', ({ skip: bail }) => { bail('no network'); });",
      "it('expression body', t => t.skip('no network'));",
    ].join('\n'));
    expect(facts.map(fact => [fact.name, fact.bodySkip, fact.skipReasons])).toEqual([
      ['ctx', true, ['no network']],
      ['context', true, ['no network']],
      ['t', true, ['no network']],
      ['destructured', true, ['no network']],
      ['renamed', true, ['no network']],
      ['expression body', true, ['no network']],
    ]);
  });

  it('takes the first string-literal argument as the reason and allows none', () => {
    const facts = skipFacts([
      "it('bare', ctx => { ctx.skip(); });",
      "it('condition first', ctx => { ctx.skip(isCI, 'flaky on CI'); });",
      "it('template', ctx => { ctx.skip(`plain`); });",
      "it('dynamic', ctx => { ctx.skip(reason); });",
    ].join('\n'));
    expect(facts.map(fact => [fact.name, fact.bodySkip, fact.skipReasons])).toEqual([
      ['bare', true, []],
      ['condition first', true, ['flaky on CI']],
      ['template', true, ['plain']],
      ['dynamic', true, []],
    ]);
  });

  it('ignores skip on anything but the context, and a skip in a different test', () => {
    const facts = skipFacts([
      "it('other object', ctx => { other.skip('x'); ctx.log('y'); });",
      "it('not a skip', ctx => { ctx.skipped('x'); });",
      "it('clean', ctx => { expect(ctx).toBeDefined(); });",
      "it('no parameter', () => { skip('x'); });",
    ].join('\n'));
    expect(facts.map(fact => fact.bodySkip)).toEqual([false, false, false, false]);
  });

  it('does not read the first parameter of an each callback as the context', () => {
    const facts = skipFacts("it.each([1])('row %s', row => { row.skip('x'); });");
    expect(facts.map(fact => fact.bodySkip)).toEqual([false]);
  });

  it('counts a test once however many skip calls its body makes', () => {
    const facts = skipFacts("it('twice', ctx => { if (a) ctx.skip('one'); if (b) ctx.skip('two'); });");
    expect(facts).toEqual([{ name: 'twice', skipped: false, conditional: false, bodySkip: true, skipReasons: ['one', 'two'] }]);
  });

  it('keeps a skipped stub declared-skipped', () => {
    const facts = skipFacts("it.skip('later', () => {});");
    expect(facts).toEqual([{ name: 'later', skipped: true, conditional: false, bodySkip: false, skipReasons: [] }]);
  });
});

describe('parseTestFile Playwright-style conditional skips', () => {
  it('does not parse test.skip(condition, reason) in a body as a new test and attributes it to that test', () => {
    const parsed = parseTestFile('pw.test.ts', [
      "test('flaky', async ({ page }) => {",
      "  test.skip(isCI, 'flaky on CI');",
      '  await expect(page).toHaveTitle(/x/);',
      '});',
    ].join('\n'));
    expect(parsed.tests.map(test => test.name)).toEqual(['flaky']);
    expect(parsed.titles.map(title => title.text)).toEqual(['flaky']);
    expect(parsed.tests[0]).toMatchObject({ skipped: false, conditional: false, bodySkip: true, skipReasons: ['flaky on CI'] });
    expect(parsed.tests[0]!.assertions).toBe(1);
  });

  it('accepts a function condition or a bare condition, and counts each test once', () => {
    const parsed = parseTestFile('pw.test.ts', [
      "test('a', async () => { test.skip(({ browserName }) => browserName === 'firefox', 'no firefox'); });",
      "test('b', async () => { test.skip(process.platform === 'win32'); test.skip(true, 'never'); });",
    ].join('\n'));
    expect(parsed.tests.map(test => [test.name, test.bodySkip, test.skipReasons])).toEqual([
      ['a', true, ['no firefox']],
      ['b', true, ['never']],
    ]);
  });

  it('treats a dynamic reason or a template reason as a skip, not as a test, and invents no reason', () => {
    const parsed = parseTestFile('pw.test.ts', [
      "test('a', async () => { test.skip(isCI, `flaky on ${os}`); });",
      "test('b', async () => { test.skip(isCI, REASON); });",
      "test('c', async () => { test.skip(isCI, `plain reason`); });",
      "test('d', async () => { it.skip(isCI, reasons.ci); });",
    ].join('\n'));
    expect(parsed.tests.map(test => [test.name, test.skipped, test.bodySkip, test.skipReasons])).toEqual([
      ['a', false, true, []],
      ['b', false, true, []],
      ['c', false, true, ['plain reason']],
      ['d', false, true, []],
    ]);
    expect(parsed.titles.map(title => title.text)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('counts a suite-level skip with a dynamic reason as a suite skip with no reason', () => {
    const parsed = parseTestFile('pw.test.ts', "describe('s', () => {\n  test.skip(isCI, REASON);\n  test('a', () => {});\n});");
    expect(parsed.tests.map(test => test.name)).toEqual(['a']);
    expect(parsed.suiteSkips).toEqual([{}]);
  });

  it('keeps a string title, or a function second argument, as a declaration', () => {
    const parsed = parseTestFile('pw.test.ts', "test.skip('title', 'not a reason', () => {});\ntest.skip(title, function () {});\ntest.skip(title, () => {});");
    expect(parsed.tests.map(test => test.skipped)).toEqual([true, true, true]);
  });

  it('counts a skip outside any test as a suite skip, not as a test', () => {
    const parsed = parseTestFile('pw.test.ts', [
      "describe('suite', () => {",
      "  test.skip(isCI, 'suite is slow on CI');",
      "  test('a', () => {});",
      '});',
    ].join('\n'));
    expect(parsed.tests.map(test => test.name)).toEqual(['a']);
    expect(parsed.suiteSkips).toEqual([{ reason: 'suite is slow on CI' }]);
  });

  it('still reads test.skip(title, body) as a declaration, even with a dynamic title', () => {
    const parsed = parseTestFile('pw.test.ts', "test.skip(title, async () => {});\nit.skip(`a ${b}`, () => {});");
    expect(parsed.tests.map(test => test.skipped)).toEqual([true, true]);
    expect(parsed.suiteSkips).toBeUndefined();
  });
});

describe('parseTestFile attributes assertions to the right test', () => {
  it('gives it.each rows and nested describe tests only their own assertions', () => {
    const parsed = parseTestFile('attribute.test.ts', [
      "describe('outer', () => {",
      "  it('before', () => { run(); });",
      "  it.each([1, 2])('row %s', value => { expect(value).toBeGreaterThan(0); });",
      "  describe('inner', () => {",
      "    it('nested asserts', () => { expect(1).toBe(1); expect(2).toBe(2); });",
      "    it.each`a | b\n${1} | ${2}`('tagged %s', () => { run(); });",
      '  });',
      "  it('after', () => { run(); });",
      '});',
    ].join('\n'));
    expect(parsed.tests.map(test => [test.name, test.assertions])).toEqual([
      ['before', 0],
      ['row %s', 1],
      ['nested asserts', 2],
      ['tagged %s', 0],
      ['after', 0],
    ]);
  });
});
