import { describe, expect, it } from 'vitest';
import { detectRedundancy, layerOf } from '../../src/detectors/redundancy.ts';
import { parseTestFile } from '../helpers/parse.ts';

describe('detectRedundancy', () => {
  const file = (rel: string, subjects: string[], text: string) => {
    const parsed = parseTestFile(rel, text);
    return { rel, subjects, parsed, lines: text.split('\n') };
  };

  it('clusters test files that share a subject and records their layers', () => {
    const { clusters } = detectRedundancy([
      file('tests/a.unit.test.ts', ['src/a.ts'], ''),
      file('tests/a.e2e.test.ts', ['src/a.ts'], ''),
      file('tests/b.test.ts', ['src/b.ts'], ''),
    ]);
    expect(clusters).toEqual([{ subject: 'src/a.ts', files: ['tests/a.e2e.test.ts', 'tests/a.unit.test.ts'], layers: ['e2e', 'unit'] }]);
  });

  it('ignores incidental subjects of an unfocused test unless it is named after them', () => {
    const wide = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'];
    const { clusters } = detectRedundancy([
      file('tests/wide.test.ts', wide, ''),
      file('tests/a.test.ts', wide, ''),
      file('tests/a.unit.test.ts', ['src/a.ts'], ''),
      file('tests/other.test.ts', ['src/b.ts'], ''),
    ]);
    expect(clusters.map(cluster => ({ subject: cluster.subject, files: cluster.files }))).toEqual([{ subject: 'src/a.ts', files: ['tests/a.test.ts', 'tests/a.unit.test.ts'] }]);
  });

  it('reports one shared-subject finding per file however many subjects it shares', () => {
    const { findings } = detectRedundancy([file('tests/x.test.ts', ['src/a.ts', 'src/b.ts'], ''), file('tests/y.test.ts', ['src/a.ts', 'src/b.ts'], '')]);
    expect(findings.filter(finding => finding.rule === 'redundancy.shared-subject').map(finding => finding.file)).toEqual(['tests/x.test.ts', 'tests/y.test.ts']);
  });

  it('flags a sweep repeated across files but not a short or unique one', () => {
    const sweep = 'for (let seed = 1; seed <= 30; seed++) {}';
    const { findings } = detectRedundancy([
      file('tests/a.test.ts', [], `${sweep}\nfor (let i = 0; i < 3; i++) {}`),
      file('tests/b.test.ts', [], sweep),
      file('tests/c.test.ts', [], 'for (let seed = 1; seed <= 50; seed++) {}'),
    ]);
    expect(findings.filter(finding => finding.rule === 'redundancy.repeated-sweep').map(finding => finding.file)).toEqual(['tests/a.test.ts', 'tests/b.test.ts']);
  });

  it('flags duplicate titles only when the files share a subject', () => {
    const title = "it('round-trips a saved value through load', () => {});";
    const shared = detectRedundancy([file('tests/a.test.ts', ['src/s.ts'], title), file('tests/b.test.ts', ['src/s.ts'], title)]);
    expect(shared.findings.filter(finding => finding.rule === 'redundancy.duplicate-title')).toHaveLength(2);
    const unrelated = detectRedundancy([file('tests/a.test.ts', ['src/s.ts'], title), file('tests/b.test.ts', ['src/t.ts'], title)]);
    expect(unrelated.findings.filter(finding => finding.rule === 'redundancy.duplicate-title')).toEqual([]);
  });

  it('infers layers from the path', () => {
    expect(layerOf('tests/e2e/login.test.ts')).toBe('e2e');
    expect(layerOf('tests/store.integration.test.ts')).toBe('integration');
    expect(layerOf('tests/api.contract.test.ts')).toBe('contract');
    expect(layerOf('tests/store.test.ts')).toBe('unit');
  });
});
