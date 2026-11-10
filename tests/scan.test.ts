import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CliError } from '../src/errors.ts';
import { defaultRiskMap, serializeRiskMap } from '../src/riskmap.ts';
import { scan } from '../src/scan.ts';
import { EvidenceReport } from '../src/schema.ts';
import { makeTree } from './helpers/tree.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const expected = JSON.parse(readFileSync(join(FIXTURES, 'bloated', 'expected.json'), 'utf8')) as {
  findings: Array<{ rule: string; file: string }>;
  flags: Record<string, string[]>;
  clusters: Array<{ subject: string; files: string[] }>;
  noAssertionTests: Record<string, Array<{ name: string; line: number }>>;
};

const everyFinding = (report: EvidenceReport) => [...report.files.flatMap(file => file.findings), ...report.projectFindings];

it('retains contextual publication suite evidence through a real deterministic scan', () => {
  const root = makeTree({
    '.testing/risk.yml': serializeRiskMap(defaultRiskMap()),
    'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
    '.github/workflows/publish.yml': 'on:\n  push:\n    branches: [main]\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n      - uses: actions/deploy-pages@v4\n',
  });
  const report = scan(root);
  expect(EvidenceReport.safeParse(report).success).toBe(true);
  const frequency = report.projectFindings.filter(finding => finding.category === 'frequency');
  expect(frequency).toHaveLength(1);
  expect(frequency[0]).toMatchObject({ rule: 'frequency.publication-validation', file: '.github/workflows/publish.yml' });
  expect(frequency[0].evidence).toContain('test: vitest run');
  expect(scan(root)).toEqual(report);
});

it('reports opaque helper registration instead of implying zero native coverage', () => {
  const root = makeTree({
    'tests/sources.test.js': `import { expect } from 'vitest';
      sourceTest(['external.md'])('fidelity', () => { expect(true).toBeTruthy(); });`,
  });
  const file = scan(root, { commitLimit: 1 }).files[0]!;
  expect(file.tests).toBe(0); // recognized declarations only, never invented native cases
  expect(file.findings).toContainEqual(expect.objectContaining({
    rule: 'wiring.opaque-test-registration', line: 2,
    evidence: 'sourceTest',
  }));
  expect(EvidenceReport.safeParse(scan(root, { commitLimit: 1 })).success).toBe(true);
});

describe('scan of the bloated fixture', () => {
  const report = scan(join(FIXTURES, 'bloated'), { commitLimit: 1 });

  it('produces a valid evidence report', () => {
    expect(EvidenceReport.safeParse(report).success).toBe(true);
    expect(report.runner).toBe('vitest');
    expect(report.phase).toBe('dev');
  });

  // Compared as sorted lists, not sets, so a rule that fires twice on one file is caught too.
  it('reports exactly the planted smells, each once', () => {
    const key = (finding: { rule: string; file: string }): string => `${finding.rule}@${finding.file}`;
    expect(everyFinding(report).map(key).sort()).toEqual(expected.findings.map(key).sort());
  });

  it('sets the quality flags on exactly the planted files', () => {
    const flags = Object.fromEntries(report.files.filter(file => file.flags.length > 0).map(file => [file.file, file.flags]));
    expect(flags).toEqual(expected.flags);
  });

  it('clusters files that share a subject', () => {
    expect(report.clusters.map(({ subject, files }) => ({ subject, files }))).toEqual(expected.clusters);
    expect(report.clusters.map(cluster => cluster.layers)).toEqual([['integration', 'unit'], ['unit']]);
  });

  it('annotates shim findings with the empty consumers list', () => {
    const shim = everyFinding(report).find(finding => finding.category === 'shim');
    expect(shim?.note).toContain('No consumers declared');
  });

  it('derives tiers from the risk map', () => {
    const tiers = Object.fromEntries(report.files.map(file => [file.file, file.tier]));
    expect(tiers['tests/persistence/store.unit.test.ts']).toBe('critical');
    expect(tiers['tests/ui/button.test.ts']).toBe('low');
    expect(tiers['tests/misc/invoice.test.ts']).toBeNull();
  });

  it('is deterministic', () => {
    expect(scan(join(FIXTURES, 'bloated'), { commitLimit: 1 })).toEqual(report);
  });
});

describe('scan of the clean fixture', () => {
  const report = scan(join(FIXTURES, 'clean'), { commitLimit: 1 });

  it('reports no findings and no flags', () => {
    expect(everyFinding(report)).toEqual([]);
    expect(report.files.flatMap(file => file.flags)).toEqual([]);
  });

  it('adds neither noAssertionTests nor skips to any record', () => {
    for (const file of report.files) expect(Object.keys(file)).toEqual(['file', 'tests', 'assertions', 'flags', 'subjects', 'tags', 'tier', 'area', 'cost', 'findings']);
  });

  it('still tiers every file', () => {
    expect(report.files.map(file => file.tier)).toEqual(['critical', 'critical', 'low', 'standard']);
  });
});

describe('scan edge cases', () => {
  it('tiers a mounted Svelte screen by the component it imports', () => {
    const map = defaultRiskMap();
    map.areas = [
      { path: 'src/lib/screens/**', tier: 'critical' },
      { path: 'src/lib/components/**', tier: 'low' },
    ];
    const root = makeTree({
      '.testing/risk.yml': serializeRiskMap(map),
      'src/lib/screens/Library.svelte': '<h1>Library</h1>',
      'src/lib/components/render-live.svelte.js': 'export const renderLive = () => {};',
      'src/lib/screens/Library.test.js': "import { test, expect } from 'vitest';\nimport Library from './Library.svelte';\nimport { renderLive } from '../components/render-live.svelte.js';\ntest('opens the library', () => { expect(renderLive(Library)).toBeDefined(); });",
    });
    const [file] = scan(root).files;
    expect(file.subjects).toEqual(['src/lib/components/render-live.svelte.js', 'src/lib/screens/Library.svelte']);
    expect(file.tier).toBe('critical');
    expect(file.area).toBe('src/lib/screens/**');
  });

  it('finds worktree hazards in browser configuration and shared test infrastructure', () => {
    const root = makeTree({
      'tests/live.test.mjs': "import test from 'node:test'; test('live',()=>{});",
      'playwright.phaser.config.mjs': "export default {use:{baseURL:'http://127.0.0.1:5327'}};",
      'tests/support/server.mjs': 'export const port = 5332;',
      'src/app.mjs': 'export const port = 5432;',
    });
    const report = scan(root);
    expect(report.projectFindings.filter(f=>f.rule==='worktree.fixed-port').map(f=>f.file)).toEqual(['playwright.phaser.config.mjs', 'tests/support/server.mjs']);
    expect(report.files).toHaveLength(1);
    expect(EvidenceReport.parse(report).runner).toBe('node:test');
  });
  it('reports a missing risk map and treats shim consumers as unknown', () => {
    const root = makeTree({ 'src/legacy/x.ts': '', 'tests/legacy.test.ts': "import '../src/legacy/x.ts';\ndescribe('legacy', () => {});" });
    const report = scan(root);
    expect(report.riskMapPresent).toBe(false);
    expect(report.phase).toBeNull();
    expect(report.projectFindings.map(finding => finding.rule)).toContain('wiring.no-risk-map');
    expect(report.files[0]?.findings.find(finding => finding.category === 'shim')?.note).toContain('No risk map');
  });

  it('throws E_RISKMAP for an invalid risk map', () => {
    const root = makeTree({ '.testing/risk.yml': 'phase: nope\n' });
    expect(() => scan(root)).toThrow(CliError);
    expect(() => scan(root)).toThrow(expect.objectContaining({ code: 'E_RISKMAP' }));
  });

  it('counts a declared @subject, so a subprocess test still covers its code', () => {
    const root = makeTree({
      '.testing/risk.yml': `${serializeRiskMap({ ...defaultRiskMap(), areas: [{ path: 'src/**', tier: 'critical' }] })}`,
      'src/cli.ts': '',
      'tests/cli.test.ts': '/**\n * @subject src/cli.ts\n * @subject src/missing.ts\n */\nit("runs", () => { expect(1).toBe(2); });',
    });
    const report = scan(root);
    expect(report.files[0]?.subjects).toEqual(['src/cli.ts']);
    expect(report.files[0]?.tier).toBe('critical');
    expect(report.projectFindings.map(finding => finding.rule)).not.toContain('wiring.uncovered-critical');
  });

  it('lets a @risk tier name stand in for a test with no code subject', () => {
    const root = makeTree({
      '.testing/risk.yml': serializeRiskMap({ ...defaultRiskMap(), areas: [{ path: 'src/**', tier: 'critical' }] }),
      'tests/docs.test.ts': '/** @risk low */\nit("checks docs", () => { expect(1).toBe(1); });',
    });
    expect(scan(root).files[0]?.tier).toBe('low');
  });

  it('handles a project with no tests', () => {
    const report = scan(makeTree({ 'src/a.ts': '' }));
    expect(report.files).toEqual([]);
  });
});

describe('scan of declared subjects', () => {
  it('drops an @subject that points outside the root, at a directory or at a test file', () => {
    const root = makeTree({
      'src/cli.ts': '',
      'tests/other.test.ts': 'it("x", () => { expect(1).toBe(1); });',
      'tests/cli.test.ts': '/**\n * @subject ./src/cli.ts\n * @subject ../../x\n * @subject src\n * @subject tests/other.test.ts\n * @subject src\cli.ts\n */\nit("runs", () => { expect(1).toBe(2); });',
    });
    expect(scan(root).files.find(file => file.file === 'tests/cli.test.ts')?.subjects).toEqual(['src/cli.ts']);
  });
});

describe('scan with a file that cannot be parsed', () => {
  const deep = (): string => "it('deep', () => {\n  const nested = " + '['.repeat(6000) + ']'.repeat(6000) + ';\n  expect(nested).toBeTruthy();\n});';

  it('marks only that file as unparsed and reports the others normally', () => {
    const root = makeTree({
      'src/a.ts': '',
      'src/z.ts': '',
      'tests/a.test.ts': "import '../src/a.ts';\nit('a', () => { expect(1).toBe(2); });",
      'tests/m-bad.test.ts': deep(),
      'tests/z.test.ts': "import '../src/z.ts';\nit('z', () => { expect(1).toBe(2); });",
    });
    const report = scan(root);
    expect(EvidenceReport.safeParse(report).success).toBe(true);
    const byFile = Object.fromEntries(report.files.map(file => [file.file, file]));
    expect(byFile['tests/m-bad.test.ts']?.flags).toEqual(['unparsed']);
    expect(byFile['tests/m-bad.test.ts']?.tests).toBe(0);
    expect(byFile['tests/m-bad.test.ts']?.assertions).toBe(0);
    expect(byFile['tests/a.test.ts']).toMatchObject({ tests: 1, assertions: 1, flags: [], subjects: ['src/a.ts'] });
    expect(byFile['tests/z.test.ts']).toMatchObject({ tests: 1, assertions: 1, flags: [], subjects: ['src/z.ts'] });
    expect(scan(root).files.map(file => file.flags)).toEqual(report.files.map(file => file.flags));
  });

  it('still runs the line-based detectors on an unparsed file', () => {
    const root = makeTree({ 'tests/bad.test.ts': deep() + "\nconst root = '/Users/me/work';\n" });
    const report = scan(root);
    expect(report.files[0]?.flags).toEqual(['unparsed']);
    expect(report.files[0]?.findings.map(finding => finding.rule)).toContain('worktree.absolute-path');
    expect(report.files[0]?.cost.agent).toBe(Math.ceil(Buffer.byteLength(readFileSync(join(root, 'tests/bad.test.ts'), 'utf8')) / 4));
  });
});

describe('scan details', () => {
  const critical = (): string => serializeRiskMap({ ...defaultRiskMap(), areas: [{ path: 'src/**', tier: 'critical' }] });

  it('names the declared consumers in the shim note', () => {
    const root = makeTree({
      '.testing/risk.yml': serializeRiskMap({ ...defaultRiskMap(), consumers: ['mobile app', 'cli'] }),
      'src/legacy/x.ts': '',
      'tests/legacy.test.ts': "import '../src/legacy/x.ts';\ndescribe('legacy', () => {});",
    });
    const shim = scan(root).files[0]?.findings.find(finding => finding.category === 'shim');
    expect(shim?.note).toBe('Consumers declared in the risk map: mobile app, cli. Check whether any still needs this path.');
  });

  it('puts a hub-subject finding on the shared helper, at project level', () => {
    const files: Record<string, string> = { '.testing/risk.yml': critical(), 'src/shared.ts': '' };
    for (let index = 0; index < 11; index++) {
      files['src/m' + index + '.ts'] = '';
      files['tests/m' + index + '.test.ts'] = "import '../src/shared.ts';\nimport '../src/m" + index + ".ts';\nit('m" + index + "', () => { expect(1).toBe(2); });";
    }
    const report = scan(makeTree(files));
    const hub = report.projectFindings.filter(finding => finding.rule === 'redundancy.hub-subject');
    expect(hub.map(finding => finding.file)).toEqual(['src/shared.ts']);
    expect(report.files.flatMap(file => file.findings).map(finding => finding.rule)).not.toContain('redundancy.hub-subject');
  });

  it('estimates agent cost as a quarter of the byte length', () => {
    const text = "it('x', () => { expect('héllo').toBe('héllo!'); });";
    const report = scan(makeTree({ 'tests/x.test.ts': text }));
    expect(report.files[0]?.cost.agent).toBe(Math.ceil(Buffer.byteLength(text) / 4));
    expect(report.files[0]?.cost.wait).toBeNull();
    expect(report.files[0]?.cost.ci).toBeNull();
  });

  it('leaves churn and edits null for a tree outside git', () => {
    const report = scan(makeTree({ 'tests/x.test.ts': "it('x', () => { expect(1).toBe(2); });" }));
    expect(report.files[0]?.cost.churn).toBeNull();
    expect(report.files[0]?.cost.edits).toBeNull();
  });

  it('lets @risk low override a critical subject area but keeps the area', () => {
    const root = makeTree({
      '.testing/risk.yml': critical(),
      'src/a.ts': '',
      'tests/a.test.ts': "/** @risk low */\nimport '../src/a.ts';\nit('a', () => { expect(1).toBe(2); });",
    });
    expect(scan(root).files[0]).toMatchObject({ tier: 'low', area: 'src/**' });
  });
});

describe('wiring.unmapped-subject in a scan', () => {
  const project = () =>
    makeTree({
      '.testing/risk.yml': serializeRiskMap({ ...defaultRiskMap(), areas: [{ path: 'src/db/**', tier: 'critical' }] }),
      'src/db/store.ts': 'export const store = 1;\n',
      'src/misc/x.ts': 'export const x = 1;\n',
      'src/other/y.ts': 'export const y = 1;\n',
      'tests/mixed.test.ts': "import { it, expect } from 'vitest';\nimport { store } from '../src/db/store.ts';\nimport { x } from '../src/misc/x.ts';\nit('a', () => { expect(store + x).toBe(2); });\n",
      'tests/orphan.test.ts': "import { it, expect } from 'vitest';\nimport { y } from '../src/other/y.ts';\nit('b', () => { expect(y).toBe(1); });\n",
    });

  it('flags the unmapped subject of a partly mapped test and keeps its tier', () => {
    const report = scan(project(), { commitLimit: 1 });
    const mixed = report.files.find(file => file.file === 'tests/mixed.test.ts')!;
    expect(mixed).toMatchObject({ tier: 'critical', area: 'src/db/**' });
    const hint = mixed.findings.filter(finding => finding.rule === 'wiring.unmapped-subject');
    expect(hint).toHaveLength(1);
    expect(hint[0].message).toContain('src/misc/x.ts');
    expect(hint[0].evidence).toBe('src/misc/x.ts; mapped area: src/db/**');
    expect(mixed.findings.some(finding => finding.rule === 'wiring.untiered')).toBe(false);
  });

  it('keeps reporting a wholly unmapped test as untiered with its exact subject path, not as unmapped-subject', () => {
    const report = scan(project(), { commitLimit: 1 });
    const orphan = report.files.find(file => file.file === 'tests/orphan.test.ts')!;
    expect(orphan.tier).toBeNull();
    expect(orphan.findings.find(finding => finding.rule === 'wiring.untiered')!.evidence).toBe('src/other/y.ts');
    expect(orphan.findings.some(finding => finding.rule === 'wiring.unmapped-subject')).toBe(false);
  });
});

describe('scan names the tests with no direct assertions', () => {
  const fileOf = (source: string) => scan(makeTree({ 'tests/a.test.ts': source }), { commitLimit: 1 }).files[0]!;

  it('lists the test, its line and the flag, next to an asserting sibling', () => {
    const file = fileOf("it('does nothing', () => {\n  run();\n});\nit('checks', () => { expect(1).toBe(2); });\n");
    expect(file.flags).toContain('no-direct-assertions');
    expect(file.noAssertionTests).toEqual([{ name: 'does nothing', line: 1 }]);
    expect(file.skips).toBeUndefined();
  });

  it('has no noAssertionTests key without the flag, and no skips key without a skip', () => {
    const file = fileOf("it('checks', () => { expect(1).toBe(2); });\nit.todo('later');\n");
    expect(file.flags).toEqual([]);
    expect(Object.keys(file)).not.toContain('noAssertionTests');
    expect(Object.keys(file)).not.toContain('skips');
  });

  it('keeps every name, each cut to 80 characters, in file order', () => {
    const long = 'x'.repeat(120);
    const source = [...Array.from({ length: 8 }, (_, i) => `it('${i === 0 ? long : `bare ${i}`}', () => { run(); });`)].join('\n');
    const file = fileOf(source);
    expect(file.noAssertionTests).toHaveLength(8);
    expect(file.noAssertionTests![0]).toEqual({ name: 'x'.repeat(80), line: 1 });
    expect(file.noAssertionTests!.map(entry => entry.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('does not name a declared skip, a todo, or a test that asserts', () => {
    const file = fileOf("it.skip('later', () => {});\nit.todo('soon');\nit('asserts', () => { expect(1).toBe(2); });\n");
    expect(file.flags).toEqual([]);
    expect(file.noAssertionTests).toBeUndefined();
  });

  it('still names a conditionally declared test that asserts nothing', () => {
    const file = fileOf("it.skipIf(offline)('checks nothing', () => { run(); });\n");
    expect(file.noAssertionTests).toEqual([{ name: 'checks nothing', line: 1 }]);
  });

  it('survives a schema parse', () => {
    const report = scan(makeTree({ 'tests/a.test.ts': "it('bare', () => { run(); });\nit.skip('s', () => {});\n" }), { commitLimit: 1 });
    expect(EvidenceReport.parse(report).files[0]).toMatchObject({ noAssertionTests: [{ name: 'bare', line: 1 }], skips: { declared: 1, conditional: 0, reasons: [] } });
  });
});

describe('scan reports skipped cases', () => {
  const fileOf = (source: string) => scan(makeTree({ 'tests/a.test.ts': source }), { commitLimit: 1 }).files[0]!;

  it('counts tests, not calls: declared, conditional declarations and a context skip', () => {
    const file = fileOf([
      "it.skip('declared', () => { expect(1).toBe(2); });",
      "it.skipIf(c)('skip if', () => { expect(1).toBe(2); });",
      "it.runIf(c)('run if', () => { expect(1).toBe(2); });",
      "it('ctx', ctx => { ctx.skip('no network'); ctx.skip('no network'); expect(1).toBe(2); });",
    ].join('\n'));
    expect(file.skips).toEqual({ declared: 1, conditional: 3, reasons: ['no network'] });
  });

  it('reads context.skip, t.skip and a destructured skip the same way', () => {
    for (const body of ["context => { context.skip('no network'); }", "t => { t.skip('no network'); }", "({ skip }) => { skip('no network'); }"]) {
      expect(fileOf(`it('x', ${body});`).skips).toEqual({ declared: 0, conditional: 1, reasons: ['no network'] });
    }
  });

  it('counts a Playwright-style skip in a body as one conditional skip, not as a test', () => {
    const file = fileOf("test('page', async () => {\n  test.skip(isCI, 'flaky on CI');\n  expect(1).toBe(2);\n});\n");
    expect(file.tests).toBe(1);
    expect(file.skips).toEqual({ declared: 0, conditional: 1, reasons: ['flaky on CI'] });
    expect(file.flags).toEqual([]);
  });

  it('counts a suite-level Playwright skip as a conditional skip', () => {
    const file = fileOf("describe('s', () => {\n  test.skip(isCI, 'slow on CI');\n  test('a', () => { expect(1).toBe(2); });\n});\n");
    expect(file.tests).toBe(1);
    expect(file.skips).toEqual({ declared: 0, conditional: 1, reasons: ['slow on CI'] });
  });

  it('keeps at most three distinct reasons of 80 characters', () => {
    const file = fileOf(['a', 'b', 'c', 'd', 'a'].map((reason, i) => `it('t${i}', t => { t.skip('${i === 0 ? 'a'.repeat(100) : reason}'); expect(1).toBe(2); });`).join('\n'));
    expect(file.skips?.conditional).toBe(5);
    expect(file.skips?.reasons).toEqual(['a'.repeat(80), 'b', 'c']);
  });

  it('counts a Playwright-style skip with a dynamic reason as a skip with no reason', () => {
    const file = fileOf("test('page', async () => {\n  test.skip(isCI, `flaky on ${os}`);\n  test.skip(isCI, REASON);\n  expect(1).toBe(2);\n});\n");
    expect(file.tests).toBe(1);
    expect(file.skips).toEqual({ declared: 0, conditional: 1, reasons: [] });
  });

  it('counts a skip with no reason and leaves the reasons empty', () => {
    expect(fileOf("it('x', t => { t.skip(); expect(1).toBe(2); });").skips).toEqual({ declared: 0, conditional: 1, reasons: [] });
  });

  it('keeps a file with no skip free of both new keys, so its JSON is unchanged', () => {
    const file = fileOf("it('checks', () => { expect(1).toBe(2); });");
    expect(JSON.parse(JSON.stringify(file))).not.toHaveProperty('skips');
    expect(JSON.parse(JSON.stringify(file))).not.toHaveProperty('noAssertionTests');
  });

  it('adds only the legitimate new entries to the bloated fixture', () => {
    const files = scan(join(FIXTURES, 'bloated'), { commitLimit: 1 }).files;
    const withNames = Object.fromEntries(files.filter(file => file.noAssertionTests).map(file => [file.file, file.noAssertionTests]));
    expect(withNames).toEqual(expected.noAssertionTests);
    expect(files.filter(file => file.skips)).toEqual([]);
  });
});
