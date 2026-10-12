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
});
