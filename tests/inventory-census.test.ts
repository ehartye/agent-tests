/** @lane merge @subject src/discover.ts @subject src/scan.ts @subject src/report.ts @subject src/audit-output.ts @subject src/detectors/wiring.ts */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditArtifact } from '../src/audit-output.ts';
import { renderMarkdown } from '../src/report.ts';
import { scanProject } from '../src/scan.ts';
import { EvidenceReport } from '../src/schema.ts';
import { makeTree } from './helpers/tree.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'inventory-census');
const cli = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'scripts/tests.mjs'), ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
const ZERO_COUNT = '- No supported runner detected; a zero test count does not prove the project has no tests.';
const ARTIFACT_WARNING = 'No supported runner detected; a zero static test count does not prove that the project has no tests.';

describe('the inventory-census fixture, through the CLI', () => {
  const scanned = cli('scan', '--root', FIXTURE);
  const evidence = JSON.parse(scanned.stdout) as EvidenceReport;
  const markdown = cli('report', '--root', FIXTURE).stdout;
  const expected = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8')) as {
    runner: string; testFiles: string[]; inventory: unknown; coverageFindings: string[];
  };
  const coverage = evidence.projectFindings.filter(finding => ['wiring.inventory-incomplete', 'wiring.uncovered-critical'].includes(finding.rule));

  it('inventories JavaScript and Python, counts Go by name, ignores the venv file, and reports coverage unknown instead of uncovered', () => {
    expect(scanned.status, scanned.stderr).toBe(0);
    expect(EvidenceReport.safeParse(evidence).success).toBe(true);
    const { notes, ...inventory } = evidence.inventory!;
    expect({
      runner: evidence.runner,
      testFiles: evidence.files.map(file => file.file),
      inventory,
      coverageFindings: coverage.map(finding => `${finding.rule}@${finding.file}`),
    }).toEqual(expected);
    expect(notes.length).toBeGreaterThan(0);
    // The Python test sits under py/, so py/ is a package root and py/pkg/** is covered; only Go stays coverage-unknown.
    expect(evidence.files.find(file => file.file === 'py/tests/test_core.py')!.subjects).toEqual(['py/pkg/core.py']);
    for (const finding of coverage) {
      expect(finding.message).toMatch(/Go.*coverage is unknown|coverage is unknown.*Go/);
      expect(finding.message).not.toContain('Python');
    }
  });

  it('puts the languages and the incomplete inventory in the report header', () => {
    expect(markdown).toContain('- Languages: JavaScript (vitest, 1 files), Go (detected-unsupported, 1 files), Python (pytest, 1 files)');
    const line = markdown.split('\n').find(text => text.startsWith('- Inventory incomplete:')) ?? '';
    expect(line).toContain('Go');
    expect(line).not.toContain('Python');
    expect(markdown).not.toContain(ZERO_COUNT);
  });
});

describe('repos where the census sees some or none of the tests', () => {
  const cases: Array<{ name: string; files: Record<string, string>; inventory: string[] | null; zeroLine: boolean; incompleteLine: boolean; warning: boolean }> = [
    {
      name: 'a Python-only repo with plain test functions is inventoried as pytest: no zero-count line and no artifact warning',
      files: { 'tests/test_x.py': 'def test_x():\n    assert True\n', 'src/x.py': 'x = 1\n' },
      inventory: ['JavaScript unknown 0 supported', 'Python pytest 1 supported'],
      zeroLine: false,
      incompleteLine: false,
      warning: false,
    },
    {
      name: 'tests with unconventional names get no inventory but still the zero-count line',
      files: { 'tests/check_core.py': 'x = 1\n', 'spec/Thing_Check.java': 'class Thing_Check {}\n' },
      inventory: null,
      zeroLine: true,
      incompleteLine: false,
      warning: true,
    },
    {
      name: 'a configured runner with no tests gets neither line',
      files: { 'package.json': JSON.stringify({ devDependencies: { vitest: '5.0.3' } }) },
      inventory: null,
      zeroLine: false,
      incompleteLine: false,
      warning: false,
    },
  ];

  it.each(cases)('$name', async ({ files, inventory, zeroLine, incompleteLine, warning }) => {
    const evidence = await scanProject(makeTree(files), { commitLimit: 1 });
    expect(evidence.inventory?.languages.map(entry => `${entry.language} ${entry.runner} ${entry.files} ${entry.status}`) ?? null).toEqual(inventory);
    expect('inventory' in evidence).toBe(inventory !== null);
    const markdown = renderMarkdown(evidence);
    expect(markdown.includes(ZERO_COUNT)).toBe(zeroLine);
    expect(markdown.includes('- Inventory incomplete:')).toBe(incompleteLine);
    // The saved artifacts keep the unknown-runner warning unless a supported language has a known runner and files.
    expect(auditArtifact(evidence, 'report').includes(ARTIFACT_WARNING)).toBe(warning);
    expect(auditArtifact(evidence, 'scan').includes(ARTIFACT_WARNING)).toBe(warning);
  });

  it('leaves the JSON of a repo with unconventional names without an inventory key', () => {
    const text = cli('scan', '--root', makeTree({ 'tests/check_core.py': 'x = 1\n' })).stdout;
    expect(Object.keys(JSON.parse(text))).toEqual(['schema', 'root', 'runner', 'phase', 'riskMapPresent', 'files', 'clusters', 'projectFindings']);
  });
});
