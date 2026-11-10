import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/report.ts';
import { scan } from '../src/scan.ts';
import { makeTree } from './helpers/tree.ts';
import { EVIDENCE_SCHEMA, type EvidenceReport, type Finding, type TestFileRecord } from '../src/schema.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function finding(overrides: Partial<Finding> & Pick<Finding, 'rule' | 'file'>): Finding {
  return { category: 'worktree', message: 'A message.', evidence: '', ...overrides };
}

function record(file: string, overrides: Partial<TestFileRecord> = {}): TestFileRecord {
  return {
    file,
    tests: 2,
    assertions: 3,
    flags: [],
    subjects: [],
    tags: {},
    tier: 'standard',
    area: null,
    cost: { wait: null, agent: 100, ci: null, churn: 0, edits: 0 },
    findings: [],
    ...overrides,
  };
}

function report(overrides: Partial<EvidenceReport> = {}): EvidenceReport {
  return {
    schema: EVIDENCE_SCHEMA,
    root: '/x',
    runner: 'vitest',
    phase: 'dev',
    riskMapPresent: true,
    files: [],
    clusters: [],
    projectFindings: [],
    ...overrides,
  };
}

it('labels opaque factory counts as incomplete while preserving evidence JSON', () => {
  const markdown = renderMarkdown(report({ files: [record('tests/sources.test.js', {
    tests: 0, findings: [finding({ category: 'wiring', file: 'tests/sources.test.js',
      rule: 'wiring.opaque-test-registration', evidence: 'sourceTest' })],
  })] }));
  expect(markdown).toContain('0+?');
  expect(markdown).toContain('Recognized declarations');
});

/** The text of one `##` section, from its heading to the next `##` heading. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`);
  expect(start, `section "${heading}" is missing`).toBeGreaterThanOrEqual(0);
  const rest = markdown.slice(start + 3);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

const tableRows = (markdown: string): string[] => section(markdown, 'Test files').split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| File ') && !line.startsWith('|---'));

describe('renderMarkdown on the fixtures', () => {
  const bloated = renderMarkdown(scan(join(FIXTURES, 'bloated'), { commitLimit: 1 }));

  it('opens with the header bullets and the reading guide', () => {
    expect(bloated.startsWith('# Test audit evidence\n')).toBe(true);
    expect(bloated).toContain('- Runner: vitest');
    expect(bloated).toContain('- Phase: dev');
    expect(bloated).toContain('- Risk map: present');
    expect(bloated).toContain('How to read this');
    expect(bloated.indexOf('How to read this')).toBeLessThan(bloated.indexOf('## Findings by category'));
    expect(bloated).toContain('| shim | 3 |');
  });

  it('ranks the file with the most distinct rules first and shows its rules', () => {
    const rows = tableRows(bloated);
    expect(rows[0]).toContain('tests/net/server.test.ts');
    expect(rows[0]).toContain('worktree.absolute-path, worktree.cwd-locate, worktree.dot-git-dir, worktree.fixed-db-file, +3 more');
    expect(section(bloated, 'Test files')).toContain('(top 10 of 10, most evidence first)');
  });

  it('groups per-file findings by rule and keeps project findings apart', () => {
    const perFile = section(bloated, 'Per-file findings');
    expect(perFile).toContain('### worktree.fixed-port');
    expect(perFile).toContain('`tests/net/server.test.ts:8`');
    expect(perFile).not.toContain('frequency.');
    expect(perFile).not.toContain('src/auth/**');
    expect(section(bloated, 'Files sharing a subject')).toContain('tests/persistence/store.unit.test.ts');
  });

  it('lists project findings with uncovered-critical before the frequency rules', () => {
    const project = section(bloated, 'Project findings');
    expect(project).toContain('src/auth/**');
    expect(project.indexOf('wiring.uncovered-critical')).toBeGreaterThan(-1);
    expect(project.indexOf('wiring.uncovered-critical')).toBeLessThan(project.indexOf('wiring.drift'));
    expect(project.indexOf('wiring.drift')).toBeLessThan(project.indexOf('frequency.'));
    expect(project).toContain('**frequency.watch-default**');
  });

  it('says None. under both findings sections for the clean fixture', () => {
    const clean = renderMarkdown(scan(join(FIXTURES, 'clean'), { commitLimit: 1 }));
    expect(clean).toContain('## Project findings (0)\n\nNone.');
    expect(clean).toContain('## Per-file findings\n\nNone.');
    expect(clean).not.toContain('## Files sharing a subject');
  });
});

describe('renderMarkdown ranking', () => {
  it('puts an unparsed file first even with no findings, and lists it in the header', () => {
    const md = renderMarkdown(
      report({
        files: [
          record('tests/a.test.ts', { findings: [finding({ rule: 'worktree.fixed-port', file: 'tests/a.test.ts', line: 1 })] }),
          record('tests/z.test.ts', { flags: ['unparsed'], tests: 0, assertions: 0 }),
        ],
      }),
    );
    expect(tableRows(md)[0]).toContain('tests/z.test.ts');
    expect(md).toContain('- Unparsed files: 1. The tool could not read their structure, so read them directly: `tests/z.test.ts`');
    expect(tableRows(md)[0]).toContain('| ? | ? |');
  });

  it('caps the unparsed list at 10 paths', () => {
    const files = Array.from({ length: 13 }, (_, i) => record(`tests/u${String(i).padStart(2, '0')}.test.ts`, { flags: ['unparsed'] }));
    const md = renderMarkdown(report({ files }));
    expect(md).toContain('- Unparsed files: 13.');
    expect(md).toContain('`tests/u09.test.ts`');
    expect(md).not.toContain('`tests/u10.test.ts`');
    expect(md).toContain('+3 more');
  });

  it('omits the unparsed bullet when every file parsed', () => {
    expect(renderMarkdown(report({ files: [record('tests/a.test.ts')] }))).not.toContain('Unparsed files');
  });

  it('ranks distinct rules above raw finding counts', () => {
    const a = record('tests/a.test.ts', {
      findings: Array.from({ length: 5 }, (_, i) => finding({ rule: 'worktree.fixed-port', file: 'tests/a.test.ts', line: i + 1 })),
    });
    const b = record('tests/b.test.ts', {
      findings: ['worktree.fixed-port', 'worktree.shared-tmp', 'worktree.home-dir'].map((rule, i) => finding({ rule, file: 'tests/b.test.ts', line: i + 1 })),
    });
    const rows = tableRows(renderMarkdown(report({ files: [a, b] })));
    expect(rows[0]).toContain('tests/b.test.ts');
    expect(rows[1]).toContain('tests/a.test.ts');
  });

  it('breaks ties by finding count, then agent tokens, then path', () => {
    const one = (file: string, agent: number, count = 1): TestFileRecord =>
      record(file, {
        cost: { wait: null, agent, ci: null, churn: 0, edits: 0 },
        findings: Array.from({ length: count }, (_, i) => finding({ rule: 'worktree.fixed-port', file, line: i + 1 })),
      });
    const md = renderMarkdown(report({ files: [one('tests/d.test.ts', 10), one('tests/c.test.ts', 50), one('tests/b.test.ts', 50), one('tests/e.test.ts', 1, 3)] }));
    expect(tableRows(md).map(row => row.split('|')[1]!.trim())).toEqual(['tests/e.test.ts', 'tests/b.test.ts', 'tests/c.test.ts', 'tests/d.test.ts']);
  });

  it('prints distinct rules with counts, most frequent first, at most four', () => {
    const f = 'tests/a.test.ts';
    const rules = ['worktree.fixed-port', 'worktree.fixed-port', 'redundancy.shared-subject', 'worktree.home-dir', 'shim.path-marker', 'shim.title-marker', 'worktree.shared-tmp'];
    const md = renderMarkdown(report({ files: [record(f, { findings: rules.map((rule, i) => finding({ rule, file: f, line: i + 1 })) })] }));
    expect(tableRows(md)[0]).toContain('| worktree.fixed-port x2, redundancy.shared-subject, shim.path-marker, shim.title-marker, +2 more |');
  });
});

describe('renderMarkdown caps', () => {
  const five = (): EvidenceReport =>
    report({
      files: ['a', 'b', 'c', 'd', 'e'].map((name, i) => {
        const file = `tests/${name}.test.ts`;
        return record(file, {
          cost: { wait: null, agent: 100 - i, ci: null, churn: 0, edits: 0 },
          findings: i < 3 ? Array.from({ length: 3 - i }, (_, n) => finding({ rule: 'worktree.fixed-port', file, line: n + 1 })) : [],
        });
      }),
    });

  it('limits the table to maxFiles and counts what was omitted', () => {
    const md = renderMarkdown(five(), { maxFiles: 2 });
    expect(tableRows(md)).toHaveLength(2);
    expect(section(md, 'Test files')).toContain('(top 2 of 5, most evidence first)');
    // Omitted: c (1 finding), d and e (none).
    expect(md).toContain('3 more files omitted (1 findings, 2 with none); the full data is in the JSON from the scan command.');
  });

  it('shows every file and no omission line when under the cap', () => {
    const md = renderMarkdown(five());
    expect(tableRows(md)).toHaveLength(5);
    expect(md).not.toContain('omitted');
  });

  it('truncates a rule with more than maxPerRule findings', () => {
    const f = 'tests/a.test.ts';
    const findings = Array.from({ length: 5 }, (_, i) => finding({ rule: 'worktree.fixed-port', file: f, line: i + 1 }));
    const md = renderMarkdown(report({ files: [record(f, { findings })] }), { maxPerRule: 2 });
    const perFile = section(md, 'Per-file findings');
    expect(perFile).toContain('`tests/a.test.ts:1`');
    expect(perFile).toContain('`tests/a.test.ts:2`');
    expect(perFile).not.toContain('`tests/a.test.ts:3`');
    expect(perFile).toContain('- +3 more (see the scan JSON)');
  });

  it('defaults to 40 files and 30 findings per rule', () => {
    const files = Array.from({ length: 45 }, (_, i) => record(`tests/f${String(i).padStart(2, '0')}.test.ts`));
    expect(tableRows(renderMarkdown(report({ files })))).toHaveLength(40);
    const f = 'tests/a.test.ts';
    const findings = Array.from({ length: 33 }, (_, i) => finding({ rule: 'worktree.fixed-port', file: f, line: i + 1 }));
    expect(renderMarkdown(report({ files: [record(f, { findings })] }))).toContain('- +3 more (see the scan JSON)');
  });
});

describe('renderMarkdown ordering and grouping', () => {
  it('orders lines numerically, with line-less findings first', () => {
    const f = 'tests/a.test.ts';
    const findings = [100, 10, 2, 9, 1].map(line => finding({ rule: 'worktree.fixed-port', file: f, line }));
    findings.push(finding({ rule: 'worktree.fixed-port', file: f }));
    const perFile = section(renderMarkdown(report({ files: [record(f, { findings })] })), 'Per-file findings');
    const positions = ['`tests/a.test.ts`', '`tests/a.test.ts:1`', '`tests/a.test.ts:2`', '`tests/a.test.ts:9`', '`tests/a.test.ts:10`', '`tests/a.test.ts:100`'].map(token => perFile.indexOf(token));
    expect(positions.every(position => position > -1)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
  });

  it('orders project findings numerically by line within a file', () => {
    const findings = [10, 9, 2].map(line => finding({ category: 'frequency', rule: 'frequency.hook-full-suite', file: 'package.json', line }));
    const project = section(renderMarkdown(report({ projectFindings: findings })), 'Project findings (3)');
    expect(project.indexOf('package.json:2`')).toBeLessThan(project.indexOf('package.json:9`'));
    expect(project.indexOf('package.json:9`')).toBeLessThan(project.indexOf('package.json:10`'));
  });

  it('orders project findings: wiring first in its own rule order, then schema category order', () => {
    const make = (category: Finding['category'], rule: string, file = 'x'): Finding => finding({ category, rule, file });
    const md = renderMarkdown(
      report({
        projectFindings: [
          make('frequency', 'frequency.watch-default', 'package.json'),
          make('wiring', 'wiring.no-risk-map'),
          make('redundancy', 'redundancy.hub-subject', 'src/hub.ts'),
          make('wiring', 'wiring.drift'),
          make('wiring', 'wiring.uncovered-critical'),
          make('shim', 'shim.path-marker', 'src/old'),
        ],
      }),
    );
    const order = ['wiring.uncovered-critical', 'wiring.drift', 'wiring.no-risk-map', 'redundancy.hub-subject', 'shim.path-marker', 'frequency.watch-default'].map(rule => md.indexOf(`**${rule}**`));
    expect(order.every(position => position > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('groups per-file findings by category order then rule, with the message once per rule', () => {
    const f = 'tests/a.test.ts';
    const findings = [
      finding({ category: 'worktree', rule: 'worktree.shared-tmp', file: f, line: 3, message: 'Tmp message.' }),
      finding({ category: 'redundancy', rule: 'redundancy.duplicate-title', file: f, line: 5, message: 'Dup message.' }),
      finding({ category: 'worktree', rule: 'worktree.fixed-port', file: f, line: 7, message: 'Port message.', evidence: 'listen(3000)', note: 'check it' }),
      finding({ category: 'worktree', rule: 'worktree.fixed-port', file: f, line: 8, message: 'Port message.' }),
    ];
    const perFile = section(renderMarkdown(report({ files: [record(f, { findings })] })), 'Per-file findings');
    expect(perFile.indexOf('### redundancy.duplicate-title')).toBeLessThan(perFile.indexOf('### worktree.fixed-port'));
    expect(perFile.indexOf('### worktree.fixed-port')).toBeLessThan(perFile.indexOf('### worktree.shared-tmp'));
    expect(perFile.split('Port message.')).toHaveLength(2);
    expect(perFile).toContain('- `tests/a.test.ts:7` `listen(3000)` (check it)');
    expect(perFile).toContain('- `tests/a.test.ts:8`\n');
  });

  it('prints clusters only when there are some', () => {
    const md = renderMarkdown(report({ clusters: [{ subject: 'src/store.ts', files: ['tests/a.test.ts', 'tests/b.test.ts'], layers: ['unit', 'integration'] }] }));
    expect(section(md, 'Files sharing a subject')).toContain('- `src/store.ts` (unit, integration): `tests/a.test.ts`, `tests/b.test.ts`');
    expect(renderMarkdown(report())).not.toContain('Files sharing a subject');
  });

  it('counts project and per-file findings together in the category table', () => {
    const md = renderMarkdown(
      report({
        files: [record('tests/a.test.ts', { findings: [finding({ rule: 'worktree.fixed-port', file: 'tests/a.test.ts', line: 1 })] })],
        projectFindings: [finding({ category: 'worktree', rule: 'worktree.home-dir', file: 'x' })],
      }),
    );
    expect(md).toContain('| worktree | 2 |');
  });
});

describe('renderMarkdown escaping', () => {
  it('escapes pipes in table cells', () => {
    const md = renderMarkdown(report({ files: [record('a|b.test.ts')] }));
    expect(tableRows(md)[0]).toContain('| a\\|b.test.ts |');
  });

  it('does not let a backtick in a path break a code span', () => {
    const f = 'tests/we`ird.test.ts';
    const md = renderMarkdown(report({ files: [record(f, { findings: [finding({ rule: 'worktree.fixed-port', file: f, line: 4 })] })] }));
    expect(md).toContain('- ``tests/we`ird.test.ts:4``');
  });

  it('pads a span whose text begins or ends with a backtick', () => {
    const md = renderMarkdown(report({ projectFindings: [finding({ rule: 'frequency.watch-default', category: 'frequency', file: 'package.json', evidence: '`x`' })] }));
    expect(md).toContain('`` `x` ``');
  });

  it('collapses newlines and CRLF in messages, evidence, notes and paths', () => {
    const md = renderMarkdown(
      report({
        files: [record('tests/a\r\nb.test.ts', { findings: [finding({ rule: 'worktree.fixed-port', file: 'tests/a\r\nb.test.ts', line: 1, message: 'Line one.\r\nLine two.', evidence: 'a\r\n\tb\n  c', note: 'n1\nn2' })] })],
        projectFindings: [finding({ category: 'frequency', rule: 'frequency.watch-default', file: 'package.json', message: 'm1\r\nm2', evidence: 'e1\ne2', note: 'x\r\ny' })],
      }),
    );
    expect(md).not.toContain('\r');
    expect(md).toContain('Line one. Line two.');
    expect(md).toContain('`a b c`');
    expect(md).toContain('(n1 n2)');
    expect(md).toContain('`tests/a b.test.ts:1`');
    expect(md).toContain('**frequency.watch-default**: m1 m2 Evidence: `e1 e2`. Note: x y');
  });

  it('caps long evidence at 160 characters with an ellipsis', () => {
    const f = 'tests/a.test.ts';
    const md = renderMarkdown(report({ files: [record(f, { findings: [finding({ rule: 'worktree.fixed-port', file: f, line: 1, evidence: 'x'.repeat(500) })] })] }));
    const span = /`tests\/a\.test\.ts:1` `(x+…)`/.exec(md);
    expect(span).not.toBeNull();
    expect(span![1]!.length).toBe(160);
    expect(md).not.toContain('x'.repeat(161));
  });

  it('keeps evidence of exactly 160 characters intact', () => {
    const f = 'tests/a.test.ts';
    const md = renderMarkdown(report({ files: [record(f, { findings: [finding({ rule: 'worktree.fixed-port', file: f, line: 1, evidence: 'y'.repeat(160) })] })] }));
    expect(md).toContain(`\`${'y'.repeat(160)}\``);
  });
});

describe('renderMarkdown cells and labels', () => {
  it('labels a missing tier untiered with a risk map and no map without one', () => {
    const withMap = renderMarkdown(report({ files: [record('tests/a.test.ts', { tier: null })] }));
    expect(tableRows(withMap)[0]).toContain('| untiered |');
    const without = renderMarkdown(report({ phase: null, riskMapPresent: false, files: [record('tests/a.test.ts', { tier: null })] }));
    expect(tableRows(without)[0]).toContain('| no map |');
    expect(without).toContain('- Phase: unknown (no risk map)');
    expect(without).toContain('- Risk map: missing');
  });

  it('prints churn over edits, or n/a without history or subjects', () => {
    const md = renderMarkdown(
      report({
        files: [
          record('tests/a.test.ts', { cost: { wait: null, agent: 3, ci: null, churn: 1, edits: 3 } }),
          record('tests/b.test.ts', { cost: { wait: null, agent: 2, ci: null, churn: null, edits: null } }),
          record('tests/c.test.ts', { cost: { wait: null, agent: 1, ci: null, churn: null, edits: 4 } }),
        ],
      }),
    );
    const rows = tableRows(md);
    expect(rows[0]).toContain('| 3 | 1/3 |');
    expect(rows[1]).toContain('| 2 | n/a |');
    expect(rows[2]).toContain('| 1 | n/a |');
  });

  it('prints the lane, flags and dashes for empty cells', () => {
    const md = renderMarkdown(
      report({ files: [record('tests/a.test.ts', { tags: { lane: 'edit' }, flags: ['tautological', 'mock-only'] }), record('tests/b.test.ts')] }),
    );
    const rows = tableRows(md);
    expect(rows[0]).toContain('| standard | edit | 2 | 3 | tautological, mock-only | 100 | 0/0 | - |');
    expect(rows[1]).toContain('| standard | - | 2 | 3 | - | 100 | 0/0 | - |');
  });
});

describe('renderMarkdown shape', () => {
  it('renders an empty report', () => {
    const md = renderMarkdown(report());
    expect(md).toContain('- Test files: 0');
    expect(md).toContain('## Project findings (0)\n\nNone.');
    expect(md).toContain('## Per-file findings\n\nNone.');
    expect(md).toContain('| redundancy | 0 |');
  });

  it('renders a report with no phase', () => {
    expect(renderMarkdown(report({ phase: null }))).toContain('- Phase: unknown (no risk map)');
  });

  it('ends with exactly one newline and never uses carriage returns', () => {
    for (const md of [renderMarkdown(report()), renderMarkdown(scan(join(FIXTURES, 'bloated'), { commitLimit: 1 }))]) {
      expect(md.endsWith('\n')).toBe(true);
      expect(md.endsWith('\n\n')).toBe(false);
      expect(md).not.toContain('\r');
    }
  });

  it('is deterministic', () => {
    const scanned = scan(join(FIXTURES, 'bloated'), { commitLimit: 1 });
    expect(renderMarkdown(scanned)).toBe(renderMarkdown(scanned));
  });
});

describe('title overlap ranking', () => {
  const rules = ['redundancy.shared-subject', 'redundancy.duplicate-title'];
  const withRules = (file: string, overlap?: number, evidence = ''): TestFileRecord =>
    record(file, {
      findings: rules.map(rule => finding({
        category: 'redundancy', rule, file,
        evidence: rule === 'redundancy.shared-subject' ? evidence : 'x',
        ...(rule === 'redundancy.shared-subject' && overlap ? { overlap } : {}),
      })),
    });

  it('ranks the file with title overlap above a subject-only file with the same rules', () => {
    const markdown = renderMarkdown(report({ files: [
      withRules('tests/a-subject-only.test.ts'),
      withRules('tests/z-overlap.test.ts', 5, 'shared title words with tests/b.test.ts (5): alpha, beta, delta, gamma, omega; core: tests/b.test.ts'),
    ] }));
    const table = section(markdown, 'Test files');
    expect(table.indexOf('z-overlap')).toBeGreaterThan(-1);
    expect(table.indexOf('z-overlap')).toBeLessThan(table.indexOf('a-subject-only'));
    expect(table).toContain('shared title words with tests/b.test.ts (5): alpha, beta, delta, gamma, omega');
  });

  it('ranks by the largest overlap and still puts more distinct rules first', () => {
    const more = record('tests/m.test.ts', { findings: [...rules, 'redundancy.hub-subject'].map(rule => finding({ category: 'redundancy', rule, file: 'tests/m.test.ts' })) });
    const markdown = renderMarkdown(report({ files: [withRules('tests/two.test.ts', 2), withRules('tests/six.test.ts', 6), more] }));
    const table = section(markdown, 'Test files');
    expect(table.indexOf('m.test.ts')).toBeLessThan(table.indexOf('six.test.ts'));
    expect(table.indexOf('six.test.ts')).toBeLessThan(table.indexOf('two.test.ts'));
  });
});

describe('renderMarkdown names tests with no direct assertions', () => {
  it('lists each name with its line under a No direct assertions section', () => {
    const md = renderMarkdown(report({ files: [record('tests/a.test.ts', { flags: ['no-direct-assertions'], noAssertionTests: [{ name: 'does nothing', line: 3 }] })] }));
    expect(section(md, 'No direct assertions')).toContain('tests/a.test.ts: "does nothing" (line 3)');
  });

  it('lists at most five names per file, then how many more, for a real scan of seven bare tests', () => {
    const source = Array.from({ length: 7 }, (_, i) => `it('bare ${i + 1}', () => { run(); });`).join('\n');
    const md = renderMarkdown(scan(makeTree({ 'tests/a.test.ts': source }), { commitLimit: 1 }));
    const listed = section(md, 'No direct assertions');
    expect(listed).toContain('"bare 5" (line 5)');
    expect(listed).not.toContain('"bare 6"');
    expect(listed).toContain('tests/a.test.ts: and 2 more');
  });

  it('lists every flagged file, including files below the table cut', () => {
    const files = [
      record('tests/a.test.ts', { findings: [finding({ rule: 'worktree.fixed-port', file: 'tests/a.test.ts', line: 1 })], noAssertionTests: [{ name: 'shown', line: 1 }] }),
      record('tests/z.test.ts', { noAssertionTests: [{ name: 'below the table', line: 2 }] }),
    ];
    const md = renderMarkdown(report({ files }), { maxFiles: 1 });
    expect(tableRows(md)).toHaveLength(1);
    const listed = section(md, 'No direct assertions');
    expect(listed).toContain('tests/a.test.ts: "shown" (line 1)');
    expect(listed).toContain('tests/z.test.ts: "below the table" (line 2)');
    expect(listed.indexOf('tests/a.test.ts')).toBeLessThan(listed.indexOf('tests/z.test.ts'));
  });

  it('orders files as the table does, then the rest by path', () => {
    const files = [
      record('tests/b.test.ts', { noAssertionTests: [{ name: 'b', line: 1 }] }),
      record('tests/a.test.ts', { noAssertionTests: [{ name: 'a', line: 1 }] }),
      record('tests/c.test.ts', { findings: [finding({ rule: 'worktree.fixed-port', file: 'tests/c.test.ts', line: 1 })], noAssertionTests: [{ name: 'c', line: 1 }] }),
    ];
    const listed = section(renderMarkdown(report({ files }), { maxFiles: 2 }), 'No direct assertions');
    expect([...listed.matchAll(/tests\/(\w)\.test\.ts/g)].map(match => match[1])).toEqual(['c', 'a', 'b']);
  });

  it('lists at most 20 files, then counts the rest', () => {
    const files = Array.from({ length: 23 }, (_, i) => record(`tests/f${String(i).padStart(2, '0')}.test.ts`, { noAssertionTests: [{ name: `n${i}`, line: 1 }] }));
    const listed = section(renderMarkdown(report({ files })), 'No direct assertions');
    expect(listed.match(/^- tests\//gm)).toHaveLength(20);
    expect(listed).toContain('+3 more files (see the JSON noAssertionTests)');
  });

  it('keeps a name on one line', () => {
    const md = renderMarkdown(report({ files: [record('tests/a.test.ts', { noAssertionTests: [{ name: 'two\nlines', line: 4 }] })] }));
    expect(section(md, 'No direct assertions')).toContain('"two lines" (line 4)');
  });

  it('omits the section when no file has names', () => {
    expect(renderMarkdown(report({ files: [record('tests/a.test.ts', { flags: ['no-direct-assertions'] })] }))).not.toContain('## No direct assertions');
  });
});

describe('renderMarkdown reports skipped cases', () => {
  const skipped = (file: string, declared: number, conditional: number, reasons: string[] = []) => record(file, { skips: { declared, conditional, reasons } });

  it('adds the Skipped cases header line with totals and the number of files', () => {
    const md = renderMarkdown(report({ files: [skipped('tests/a.test.ts', 1, 3, ['no network']), skipped('tests/b.test.ts', 2, 0), record('tests/c.test.ts')] }));
    expect(md).toContain('- Skipped cases: 3 declared, 3 conditional in 2 files');
    expect(md.indexOf('- Skipped cases')).toBeLessThan(md.indexOf('How to read this'));
  });

  it('prints the one-file form exactly', () => {
    expect(renderMarkdown(report({ files: [skipped('tests/a.test.ts', 1, 3, ['no network'])] }))).toContain('- Skipped cases: 1 declared, 3 conditional in 1 files');
  });

  it('leaves the header line and the section out when nothing is skipped', () => {
    const md = renderMarkdown(report({ files: [record('tests/a.test.ts')] }));
    expect(md).not.toContain('Skipped cases');
    expect(md).not.toContain('## Skips');
  });

  it('lists reasons in a Skips section, at most three per file', () => {
    const md = renderMarkdown(report({ files: [skipped('tests/a.test.ts', 0, 4, ['r1', 'r2', 'r3', 'r4'])] }));
    const listed = section(md, 'Skips');
    expect(listed).toContain('tests/a.test.ts');
    for (const reason of ['r1', 'r2', 'r3']) expect(listed).toContain(reason);
    expect(listed).not.toContain('r4');
  });

  it('lists at most 20 files and counts the rest', () => {
    const files = Array.from({ length: 23 }, (_, i) => skipped(`tests/f${String(i).padStart(2, '0')}.test.ts`, 1, 0, [`why ${i}`]));
    const listed = section(renderMarkdown(report({ files })), 'Skips');
    expect(listed.match(/^- tests\//gm)).toHaveLength(20);
    expect(listed).toContain('3 more');
  });

  it('shows a file that has skips but no reason', () => {
    expect(section(renderMarkdown(report({ files: [skipped('tests/a.test.ts', 2, 0)] })), 'Skips')).toContain('tests/a.test.ts');
  });

  it('is unchanged for a scan of the clean fixture', () => {
    const md = renderMarkdown(scan(join(FIXTURES, 'clean'), { commitLimit: 1 }));
    expect(md).not.toContain('Skipped cases');
    expect(md).not.toContain('## Skips');
    expect(md).not.toContain('## No direct assertions');
  });

  it('names the planted test in the bloated fixture report', () => {
    const md = renderMarkdown(scan(join(FIXTURES, 'bloated'), { commitLimit: 1 }));
    expect(section(md, 'No direct assertions')).toContain('tests/misc/invoice.test.ts: "creates an invoice without throwing" (line 5)');
    expect(md).not.toContain('Skipped cases');
  });
});

describe('renderMarkdown inventory header', () => {
  const language = (name: string, runner: string, files: number, status: 'supported' | 'detected-unsupported') => ({ language: name, runner, files, status });
  const header = (overrides: Partial<EvidenceReport>): string[] => renderMarkdown(report(overrides)).split('\n').filter(line => /^- (Languages|Inventory incomplete|No supported runner)/.test(line));

  it('lists the languages and, when incomplete, the unsupported ones with the notes', () => {
    const lines = header({
      inventory: { complete: false, languages: [language('JavaScript', 'vitest', 3, 'supported'), language('Python', 'unknown', 7, 'detected-unsupported')], notes: ['Counted by file name only.'] },
      files: [record('tests/a.test.ts')],
    });
    expect(lines).toEqual(['- Languages: JavaScript (vitest, 3 files), Python (detected-unsupported, 7 files)', '- Inventory incomplete: Python detected but not inventoried. Counted by file name only.']);
  });

  it.each([
    { name: 'a note without final punctuation', notes: ['imports go through __init__'], expected: '- Inventory incomplete: imports go through __init__.' },
    { name: 'several notes, separated and ended once', notes: ['first note', 'second note: a, b and 1 more', 'third note'], expected: '- Inventory incomplete: first note; second note: a, b and 1 more; third note.' },
    { name: 'a note that already ends with a period is not doubled', notes: ['A sentence.', 'a clause'], expected: '- Inventory incomplete: A sentence; a clause.' },
    { name: 'an empty note is dropped', notes: ['', 'only'], expected: '- Inventory incomplete: only.' },
  ])('joins notes with semicolons and no unsupported language: $name', ({ notes, expected }) => {
    const lines = header({ inventory: { complete: false, languages: [language('JavaScript', 'vitest', 3, 'supported'), language('Python', 'pytest', 7, 'supported')], notes }, files: [record('tests/a.test.ts')] });
    expect(lines[1]).toBe(expected);
  });

  it('keeps the unsupported-language sentence first and separates the notes after it', () => {
    const lines = header({
      inventory: { complete: false, languages: [language('JavaScript', 'vitest', 3, 'supported'), language('Go', 'unknown', 2, 'detected-unsupported')], notes: ['Counted by file name only.', 'a python note'] },
      files: [record('tests/a.test.ts')],
    });
    expect(lines[1]).toBe('- Inventory incomplete: Go detected but not inventoried. Counted by file name only; a python note.');
  });

  it('shows a supported language by its runner and lists its Python files with their lane, with no zero-count line', () => {
    const md = renderMarkdown(report({
      runner: 'unknown',
      inventory: { complete: true, languages: [language('JavaScript', 'unknown', 0, 'supported'), language('Python', 'pytest', 1, 'supported')], notes: [] },
      files: [record('tests/test_a.py', { language: 'python', tags: { lane: 'merge' } })],
    }));
    expect(md).toContain('- Languages: JavaScript (unknown, 0 files), Python (pytest, 1 files)');
    expect(md).toContain('| tests/test_a.py | standard | merge | 2 | 3 |');
    expect(md).not.toContain('- Inventory incomplete:');
    expect(md).not.toContain('- No supported runner detected');
  });

  it('omits the incomplete line when the inventory is complete and both lines without an inventory', () => {
    expect(header({ inventory: { complete: true, languages: [language('JavaScript', 'vitest', 3, 'supported')], notes: [] }, files: [record('tests/a.test.ts')] })).toEqual(['- Languages: JavaScript (vitest, 3 files)']);
    expect(header({ files: [record('tests/a.test.ts')] })).toEqual([]);
  });

  it.each([
    { runner: 'unknown' as const, files: 0, line: true },
    { runner: 'unknown' as const, files: 1, line: false },
    { runner: 'vitest' as const, files: 0, line: false },
  ])('prints the zero-count line only for runner $runner with $files files: $line', ({ runner, files, line }) => {
    const md = renderMarkdown(report({ runner, files: Array.from({ length: files }, (_, i) => record(`tests/t${i}.test.ts`)) }));
    expect(md.includes('- No supported runner detected; a zero test count does not prove the project has no tests.')).toBe(line);
  });

  it('lists coverage unknown after uncovered-critical and before drift', () => {
    const project = section(renderMarkdown(report({ projectFindings: ['wiring.drift', 'wiring.inventory-incomplete', 'wiring.uncovered-critical'].map(rule => finding({ category: 'wiring', rule, file: rule })) })), 'Project findings');
    const order = ['wiring.uncovered-critical', 'wiring.inventory-incomplete', 'wiring.drift'].map(rule => project.indexOf(`**${rule}**`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBeGreaterThan(-1);
  });
});
