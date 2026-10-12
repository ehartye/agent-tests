import { describe, expect, it } from 'vitest';
import { detectWiring } from '../../src/detectors/wiring.ts';
import { defaultRiskMap } from '../../src/riskmap.ts';
import type { RiskMap } from '../../src/schema.ts';

const rules = (findings: Array<{ rule: string }>): string[] => findings.map(finding => finding.rule).sort();

describe('detectWiring', () => {
  const map: RiskMap = {
    ...defaultRiskMap(),
    areas: [
      { path: 'src/db/**', tier: 'critical' },
      { path: 'src/auth/**', tier: 'critical' },
      { path: 'src/ui/**', tier: 'low' },
    ],
  };

  it('reports a missing risk map as one finding', () => {
    expect(rules(detectWiring(null, [], []))).toEqual(['wiring.no-risk-map']);
  });

  it('reports untiered files, lane mismatches, uncovered critical areas and drift', () => {
    const findings = detectWiring(
      map,
      [
        { rel: 'tests/db.test.ts', tier: 'critical', tags: { lane: 'merge' }, subjects: ['src/db/store.ts'] },
        { rel: 'tests/ui.test.ts', tier: 'low', tags: { lane: 'edit' }, subjects: ['src/ui/button.ts'] },
        { rel: 'tests/misc.test.ts', tier: null, tags: {}, subjects: ['src/misc/x.ts'] },
      ],
      ['src/db', 'src/auth', 'src/ui', 'src/billing'],
    );
    expect(findings.map(finding => `${finding.rule}@${finding.file}`).sort()).toEqual([
      'wiring.drift@src/billing',
      'wiring.lane-mismatch@tests/ui.test.ts',
      'wiring.uncovered-critical@src/auth/**',
      'wiring.untiered@tests/misc.test.ts',
    ]);
  });

  it('returns only the no-map finding when there is no map, whatever else is passed', () => {
    const findings = detectWiring(
      null,
      [{ rel: 'tests/a.test.ts', tier: null, tags: { lane: 'edit' }, subjects: [] }],
      ['src/billing'],
    );
    expect(findings.map(finding => finding.rule)).toEqual(['wiring.no-risk-map']);
  });

  it('does not flag a test with no @lane tag', () => {
    const findings = detectWiring(map, [{ rel: 'tests/ui.test.ts', tier: 'low', tags: {}, subjects: ['src/ui/button.ts'] }], []);
    expect(rules(findings.filter(finding => finding.file === 'tests/ui.test.ts'))).toEqual([]);
  });

  it('allows a standard test in the scheduled lane', () => {
    const findings = detectWiring(map, [{ rel: 'tests/u.test.ts', tier: 'standard', tags: { lane: 'scheduled' }, subjects: ['src/ui/button.ts'] }], []);
    expect(rules(findings.filter(finding => finding.file === 'tests/u.test.ts'))).toEqual([]);
  });

  it('covers and uncovers a critical area that is a single file', () => {
    const single: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'src/auth.ts', tier: 'critical' }] };
    const covered = detectWiring(single, [{ rel: 'tests/a.test.ts', tier: 'critical', tags: {}, subjects: ['src/auth.ts'] }], []);
    expect(rules(covered)).toEqual([]);
    const uncovered = detectWiring(single, [{ rel: 'tests/a.test.ts', tier: 'critical', tags: {}, subjects: ['src/other.ts'] }], []);
    expect(uncovered.map(finding => `${finding.rule}@${finding.file}`)).toEqual(['wiring.uncovered-critical@src/auth.ts']);
  });

  it('counts a test whose own path is inside a critical area as covering it', () => {
    const colocated = detectWiring(map, [{ rel: 'src/auth/login.test.ts', tier: 'critical', tags: {}, subjects: [] }], ['src/auth']);
    expect(colocated.map(finding => `${finding.rule}@${finding.file}`)).toEqual(['wiring.uncovered-critical@src/db/**']);
  });

  it('explains an uncovered critical area and how to cover it without an import', () => {
    const [finding] = detectWiring(map, [], []).filter(item => item.file === 'src/auth/**');
    expect(finding.message).toBe('Critical area with no test file exercising it. A test reaching it only through a subprocess needs `@subject <path>`.');
    expect(finding.evidence.startsWith('0 test files import this area')).toBe(true);
  });

  describe('untiered', () => {
    const only = (file: Parameters<typeof detectWiring>[1][number]) => detectWiring(map, [file], []).filter(finding => finding.rule === 'wiring.untiered');

    it('says a test with no subjects has no code subject and how to fix it', () => {
      const [finding] = only({ rel: 'tests/e2e.test.ts', tier: null, tags: {}, subjects: [] });
      expect(finding.message).toBe('This test has no code subject, so it has no tier. Add `@risk <critical|standard|low>` or `@subject <path>` at the top of the file.');
      expect(finding.evidence).toBe('no code subjects');
    });

    it('says code with no matching area and keeps the subjects as evidence', () => {
      const [finding] = only({ rel: 'tests/m.test.ts', tier: null, tags: {}, subjects: ['src/misc/x.ts', 'src/misc/y.ts'] });
      expect(finding.message).toContain('matches no risk-map area');
      expect(finding.message).toContain('`@risk <critical|standard|low>`');
      expect(finding.message).toContain('`@subject <path>`');
      expect(finding.evidence).toBe('src/misc/x.ts, src/misc/y.ts');
    });

    it('caps long subject evidence at 160 characters on a comma boundary', () => {
      const subjects = Array.from({ length: 30 }, (_, index) => `src/module${index}/file.ts`);
      const [finding] = only({ rel: 'tests/m.test.ts', tier: null, tags: {}, subjects });
      expect(finding.evidence.length).toBeLessThanOrEqual(160);
      expect(finding.evidence.endsWith('...')).toBe(true);
      const kept = finding.evidence.slice(0, -3).split(', ');
      expect(kept).toEqual(subjects.slice(0, kept.length));
    });

    it('does not truncate evidence that fits', () => {
      const subjects = Array.from({ length: 5 }, (_, index) => `src/m${index}/f.ts`);
      const [finding] = only({ rel: 'tests/m.test.ts', tier: null, tags: {}, subjects });
      expect(finding.evidence).toBe(subjects.join(', '));
    });

    it('names a @risk value that is not a tier', () => {
      const [finding] = only({ rel: 'tests/m.test.ts', tier: null, tags: { risk: 'hgh' }, subjects: [] });
      expect(finding.message).toContain('`@risk` must be critical, standard or low');
      expect(finding.evidence).toContain('hgh');
    });
  });

  describe('drift and catch-all areas', () => {
    const withCatchAll: RiskMap = {
      ...defaultRiskMap(),
      areas: [
        { path: 'src/auth/**', tier: 'critical' },
        { path: 'src/**', tier: 'standard' },
      ],
    };
    const drift = (areaMap: RiskMap, dirs: string[]) =>
      detectWiring(areaMap, [], dirs)
        .filter(finding => finding.rule === 'wiring.drift')
        .map(finding => finding.file);

    it('ignores a src/** catch-all when probing directories', () => {
      expect(drift(withCatchAll, ['src/auth', 'src/billing'])).toEqual(['src/billing']);
    });

    it('ignores lib/** and app/** catch-alls too', () => {
      const map2: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'lib/**', tier: 'standard' }, { path: 'app/**', tier: 'standard' }] };
      expect(drift(map2, ['lib/a', 'app/b'])).toEqual(['lib/a', 'app/b']);
    });

    it('still lets a catch-all assign a tier to files outside the drift probe', () => {
      expect(detectWiring(withCatchAll, [], ['src/auth']).filter(finding => finding.rule === 'wiring.drift')).toEqual([]);
    });

    it('does not treat src/app/** as a catch-all', () => {
      const appOnly: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'src/app/**', tier: 'standard' }] };
      expect(drift(appOnly, ['src/app'])).toEqual([]);
    });

    it('does not treat a wildcard-segment glob as a catch-all', () => {
      const wild: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'src/*/foo/**', tier: 'standard' }] };
      expect(drift(wild, ['src/x/foo'])).toEqual([]);
      expect(drift(wild, ['src/x/bar'])).toEqual(['src/x/bar']);
    });
  });
});
