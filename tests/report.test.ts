import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/report.ts';
import { scan } from '../src/scan.ts';
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
    expect(rows[0]).toContain('worktree.fixed-port');
    expect(rows[0]).toContain('worktree.absolute-path, worktree.dot-git-dir, worktree.fixed-db-file, worktree.fixed-port, +2 more');
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
