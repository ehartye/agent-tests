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

  describe('shared-subject title overlap', () => {
    const sharedFindings = (inputs: ReturnType<typeof file>[]) => detectRedundancy(inputs).findings.filter(finding => finding.rule === 'redundancy.shared-subject');

    it('ranks clusters with shared title words above clusters that share only a subject', () => {
      const findings = sharedFindings([
        // Sorted first by path, but shares only the subject: a stopword-only or unrelated title overlap does not count.
        file('tests/a1.test.ts', ['src/plain.ts'], "it('renders the header', () => {});"),
        file('tests/a2.test.ts', ['src/plain.ts'], "it('parses a number', () => {});"),
        file('tests/a3.test.ts', ['src/plain.ts'], "it('closes the socket', () => {});"),
        file('tests/z1.test.ts', ['src/store.ts'], "it('saves a pending order and reloads it', () => {});"),
        file('tests/z2.test.ts', ['src/store.ts'], "it('reloads a saved pending order after restart', () => {});"),
      ]);
      expect(findings.map(finding => finding.file)).toEqual(['tests/z1.test.ts', 'tests/z2.test.ts', 'tests/a1.test.ts', 'tests/a2.test.ts', 'tests/a3.test.ts']);
      expect(findings[0]?.evidence).toContain('shared title words with tests/z2.test.ts (3): order, pending, reloads');
      expect(findings[0]?.evidence).toContain('src/store.ts: tests/z2.test.ts');
      expect(findings[2]?.evidence).toBe('src/plain.ts: tests/a2.test.ts, tests/a3.test.ts');
    });

    it('orders by the number of shared words and does not count a single shared word', () => {
      const findings = sharedFindings([
        file('tests/a.test.ts', ['src/one.ts'], "it('rotates cache entries', () => {});"),
        file('tests/b.test.ts', ['src/one.ts'], "it('evicts cache entries', () => {});"),
        file('tests/c.test.ts', ['src/two.ts'], "it('rotates cache entries daily', () => {});"),
        file('tests/d.test.ts', ['src/two.ts'], "it('rotates cache entries hourly daily', () => {});"),
        file('tests/e.test.ts', ['src/three.ts'], "it('draws a border', () => {});"),
        file('tests/f.test.ts', ['src/three.ts'], "it('draws a circle', () => {});"),
      ]);
      expect(findings.map(finding => finding.file)).toEqual(['tests/c.test.ts', 'tests/d.test.ts', 'tests/a.test.ts', 'tests/b.test.ts', 'tests/e.test.ts', 'tests/f.test.ts']);
      expect(findings.find(finding => finding.file === 'tests/e.test.ts')?.evidence).not.toContain('shared title words');
    });

    it('carries the overlap size as a number on the finding and leaves it off subject-only findings', () => {
      const findings = sharedFindings([
        file('tests/a.test.ts', ['src/one.ts'], "it('rotates cache entries daily', () => {});"),
        file('tests/b.test.ts', ['src/one.ts'], "it('rotates cache entries hourly daily', () => {});"),
        file('tests/e.test.ts', ['src/three.ts'], "it('draws a border', () => {});"),
        file('tests/f.test.ts', ['src/three.ts'], "it('draws a circle', () => {});"),
      ]);
      expect(findings.map(finding => finding.overlap)).toEqual([4, 4, undefined, undefined]);
      expect(findings[2]).not.toHaveProperty('overlap');
    });
  });

  it('flags a sweep repeated across files but not a short or unique one', () => {
    const sweep = 'for (let seed = 1; seed <= 30; seed++) {}';
    const { findings } = detectRedundancy([
      file('tests/a.test.ts', ['src/s.ts'], `${sweep}\nfor (let i = 0; i < 3; i++) {}`),
      file('tests/b.test.ts', ['src/s.ts'], sweep),
      file('tests/c.test.ts', ['src/s.ts'], 'for (let seed = 1; seed <= 50; seed++) {}'),
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

  it('matches layer words on boundaries only', () => {
    expect(layerOf('tests/integration-helpers/foo.test.ts')).toBe('unit');
    expect(layerOf('tests/disintegration.test.ts')).toBe('unit');
    expect(layerOf('tests/a.integration.test.ts')).toBe('integration');
    expect(layerOf('tests/integration/a.test.ts')).toBe('integration');
    expect(layerOf('tests/integrations/a.test.ts')).toBe('integration');
    expect(layerOf('tests/integration-tests/a.test.ts')).toBe('integration');
    expect(layerOf('tests/store-integration.test.ts')).toBe('integration');
    expect(layerOf('tests/contracts/a.test.ts')).toBe('contract');
    expect(layerOf('tests/subcontract.test.ts')).toBe('unit');
    expect(layerOf('tests/e2e/a.test.ts')).toBe('e2e');
    expect(layerOf('tests/end-to-end/a.test.ts')).toBe('e2e');
  });

  describe('repeated sweeps', () => {
    const sweep = 'for (let seed = 1; seed <= 30; seed++) {}';
    const sweepFindings = (inputs: ReturnType<typeof file>[]) => detectRedundancy(inputs).findings.filter(finding => finding.rule === 'redundancy.repeated-sweep');

    it('ignores the same sweep in files with unrelated subjects', () => {
      expect(sweepFindings([file('tests/a.test.ts', ['src/a.ts'], sweep), file('tests/b.test.ts', ['src/b.ts'], sweep)])).toEqual([]);
    });

    it('ignores generic loop variables however long the loop', () => {
      const generic = 'for (let i = 0; i < 100; i++) {}';
      expect(sweepFindings([file('tests/a.test.ts', ['src/s.ts'], generic), file('tests/b.test.ts', ['src/s.ts'], generic)])).toEqual([]);
    });

    it('flags a seed sweep that appears twice in one file', () => {
      const findings = sweepFindings([file('tests/a.test.ts', [], `${sweep}\n\n${sweep}`)]);
      expect(findings.map(finding => [finding.file, finding.line])).toEqual([['tests/a.test.ts', 1], ['tests/a.test.ts', 3]]);
    });

    it('does not count a commented-out sweep', () => {
      const text = `// ${sweep}\n * ${sweep}`;
      expect(sweepFindings([file('tests/a.test.ts', ['src/s.ts'], text), file('tests/b.test.ts', ['src/s.ts'], sweep)])).toEqual([]);
    });

    it('flags a sweep in two files that share a focused subject, with line numbers', () => {
      const findings = sweepFindings([file('tests/a.test.ts', ['src/s.ts'], `\n\n  ${sweep}`), file('tests/b.test.ts', ['src/s.ts'], `\n${sweep}`)]);
      expect(findings.map(finding => [finding.file, finding.line])).toEqual([['tests/a.test.ts', 3], ['tests/b.test.ts', 2]]);
    });

    it('accepts loop variables that start with a sweep word and rejects look-alikes', () => {
      const counts = (name: string) => {
        const loop = `for (let ${name} = 1; ${name} <= 30; ${name}++) {}`;
        return sweepFindings([file('tests/a.test.ts', ['src/s.ts'], loop), file('tests/b.test.ts', ['src/s.ts'], loop)]).length === 2;
      };
      for (const name of ['seed', 'seedValue', 'trial', 'run', 'caseIndex', 'iteration', 'round2', 'sampleIdx']) expect(counts(name), name).toBe(true);
      for (const name of ['ground', 'around', 'rerun', 'lowercase', 'i', 'index']) expect(counts(name), name).toBe(false);
    });

    it('does not pair files that share only an incidental subject', () => {
      const wide = ['src/s.ts', 'src/x.ts', 'src/y.ts', 'src/z.ts'];
      expect(sweepFindings([file('tests/a.test.ts', ['src/s.ts'], sweep), file('tests/b.test.ts', wide, sweep)])).toEqual([]);
    });
  });

  it('does not flag duplicate titles when the only shared subject is incidental to one file', () => {
    const title = "it('round-trips a saved value through load', () => {});";
    const wide = ['src/s.ts', 'src/x.ts', 'src/y.ts', 'src/z.ts'];
    const { findings } = detectRedundancy([file('tests/a.test.ts', ['src/s.ts'], title), file('tests/b.test.ts', wide, title)]);
    expect(findings.filter(finding => finding.rule === 'redundancy.duplicate-title')).toEqual([]);
  });

  describe('hub subjects', () => {
    const hubFiles = (count: number) => Array.from({ length: count }, (_, index) => file(`tests/t${index}.test.ts`, ['src/helper.ts', `src/m${index}.ts`], ''));

    it('reports one hub finding instead of per-file findings for a subject shared by more than 10 files', () => {
      const { clusters, findings } = detectRedundancy(hubFiles(12));
      expect(findings.filter(finding => finding.rule === 'redundancy.shared-subject')).toEqual([]);
      const hubs = findings.filter(finding => finding.rule === 'redundancy.hub-subject');
      expect(hubs).toHaveLength(1);
      expect(hubs[0]?.file).toBe('src/helper.ts');
      expect(hubs[0]?.message).toContain('12 test files');
      expect(hubs[0]?.message).toContain('shared infrastructure');
      expect(clusters).toHaveLength(1);
      expect(clusters[0]?.subject).toBe('src/helper.ts');
      expect(clusters[0]?.files).toHaveLength(12);
    });

    it('does not let a hub subject drive sweep or title findings', () => {
      const body = "for (let seed = 1; seed <= 30; seed++) {}\nit('round-trips a saved value through load', () => {});";
      const inputs = Array.from({ length: 11 }, (_, index) => file(`tests/t${index}.test.ts`, ['src/helper.ts', `src/m${index}.ts`], body));
      const { findings } = detectRedundancy(inputs);
      expect(findings.filter(finding => finding.rule === 'redundancy.repeated-sweep')).toEqual([]);
      expect(findings.filter(finding => finding.rule === 'redundancy.duplicate-title')).toEqual([]);
      expect(findings.map(finding => finding.rule)).toEqual(['redundancy.hub-subject']);
    });

    it('still reports sweep and title findings for a cluster of exactly 10 files', () => {
      const body = "for (let seed = 1; seed <= 30; seed++) {}\nit('round-trips a saved value through load', () => {});";
      const inputs = Array.from({ length: 10 }, (_, index) => file(`tests/t${index}.test.ts`, ['src/helper.ts', `src/m${index}.ts`], body));
      const { findings } = detectRedundancy(inputs);
      expect(findings.filter(finding => finding.rule === 'redundancy.repeated-sweep')).toHaveLength(10);
      expect(findings.filter(finding => finding.rule === 'redundancy.duplicate-title')).toHaveLength(10);
    });

    it('still counts a sweep repeated inside one file of a hub', () => {
      const inputs = Array.from({ length: 11 }, (_, index) => file(`tests/t${index}.test.ts`, ['src/helper.ts', `src/m${index}.ts`], index === 0 ? 'for (let seed = 1; seed <= 30; seed++) {}\nfor (let seed = 1; seed <= 30; seed++) {}' : ''));
      const sweeps = detectRedundancy(inputs).findings.filter(finding => finding.rule === 'redundancy.repeated-sweep');
      expect(sweeps.map(finding => [finding.file, finding.line])).toEqual([['tests/t0.test.ts', 1], ['tests/t0.test.ts', 2]]);
    });

    it('still reports per-file findings for a cluster of exactly 10 files', () => {
      const { clusters, findings } = detectRedundancy(hubFiles(10));
      expect(findings.filter(finding => finding.rule === 'redundancy.shared-subject')).toHaveLength(10);
      expect(findings.filter(finding => finding.rule === 'redundancy.hub-subject')).toEqual([]);
      expect(clusters).toHaveLength(1);
    });
  });

  describe('focus', () => {
    const shared = (extra: string[]) => ['src/shared.ts', ...extra];

    it('counts a test with three imports as focused', () => {
      const { clusters } = detectRedundancy([file('tests/a.test.ts', shared(['src/x.ts', 'src/y.ts']), ''), file('tests/b.test.ts', shared(['src/p.ts', 'src/q.ts']), '')]);
      expect(clusters.map(cluster => cluster.subject)).toEqual(['src/shared.ts']);
    });

    it('does not count a test with four imports unless it is named after the subject', () => {
      const { clusters } = detectRedundancy([file('tests/a.test.ts', shared(['src/x.ts', 'src/y.ts', 'src/w.ts']), ''), file('tests/b.test.ts', shared(['src/p.ts']), '')]);
      expect(clusters).toEqual([]);
    });

    it('matches the test name to the subject case-insensitively', () => {
      const { clusters } = detectRedundancy([
        file('tests/Store.test.ts', ['src/store.ts', 'src/x.ts', 'src/y.ts', 'src/z.ts'], ''),
        file('tests/store.unit.test.ts', ['src/store.ts'], ''),
      ]);
      expect(clusters.map(cluster => ({ subject: cluster.subject, files: cluster.files }))).toEqual([{ subject: 'src/store.ts', files: ['tests/Store.test.ts', 'tests/store.unit.test.ts'] }]);
    });
  });
});
