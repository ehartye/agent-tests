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
};

const everyFinding = (report: EvidenceReport) => [...report.files.flatMap(file => file.findings), ...report.projectFindings];

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

  it('still tiers every file', () => {
    expect(report.files.map(file => file.tier)).toEqual(['critical', 'critical', 'low', 'standard']);
  });
});

describe('scan edge cases', () => {
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
