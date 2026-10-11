import { describe, expect, it } from 'vitest';
import { CliError } from '../src/errors.ts';
import { RISK_MAP_PATH, defaultRiskMap, loadRiskMap, serializeRiskMap, tierFor } from '../src/riskmap.ts';
import { makeTree } from './helpers/tree.ts';

describe('loadRiskMap', () => {
  it('returns null when the project has no risk map', () => {
    expect(loadRiskMap(makeTree())).toBeNull();
  });

  it('round-trips a serialized map', () => {
    const map = { ...defaultRiskMap(), areas: [{ path: 'src/db/**', tier: 'critical' as const, why: 'data loss' }] };
    const root = makeTree({ [RISK_MAP_PATH]: serializeRiskMap(map) });
    expect(loadRiskMap(root)).toEqual(map);
  });

  it('throws E_RISKMAP naming the bad field', () => {
    const root = makeTree({ [RISK_MAP_PATH]: 'phase: beta\nconsumers: []\n' });
    expect(() => loadRiskMap(root)).toThrow(CliError);
    try {
      loadRiskMap(root);
    } catch (error) {
      expect((error as CliError).code).toBe('E_RISKMAP');
      expect((error as CliError).message).toContain('phase');
    }
  });

  it('throws E_RISKMAP for unparseable YAML', () => {
    const root = makeTree({ [RISK_MAP_PATH]: 'phase: [unclosed\n' });
    expect(() => loadRiskMap(root)).toThrow(/Cannot parse/);
  });
});

describe('tierFor', () => {
  const map = {
    ...defaultRiskMap(),
    areas: [
      { path: 'src/persistence/migrations/**', tier: 'standard' as const },
      { path: 'src/persistence/**', tier: 'critical' as const },
    ],
  };

  it('lets the first matching area win', () => {
    expect(tierFor(map, 'src/persistence/migrations/001.ts')).toEqual({ tier: 'standard', area: 'src/persistence/migrations/**' });
    expect(tierFor(map, 'src/persistence/store.ts')).toEqual({ tier: 'critical', area: 'src/persistence/**' });
  });

  it('returns null when nothing matches', () => {
    expect(tierFor(map, 'src/ui/button.ts')).toBeNull();
  });
});
