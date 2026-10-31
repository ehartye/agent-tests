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

  const failure = (root: string): CliError => {
    try {
      loadRiskMap(root);
    } catch (error) {
      return error as CliError;
    }
    throw new Error('expected loadRiskMap to throw');
  };

  it('throws E_RISKMAP naming the bad field', () => {
    const error = failure(makeTree({ [RISK_MAP_PATH]: 'phase: beta\nconsumers: []\n' }));
    expect(error).toBeInstanceOf(CliError);
    expect(error.code).toBe('E_RISKMAP');
    expect(error.message).toContain('phase');
  });

  it('names the root when the file is empty', () => {
    expect(failure(makeTree({ [RISK_MAP_PATH]: '' })).message).toContain('(root)');
  });

  it('rejects a mistyped key instead of dropping it', () => {
    const typo = serializeRiskMap({ ...defaultRiskMap(), areas: [{ path: 'src/**', tier: 'low' }] }).replace('tier: low', 'tier: low\n    Why: typo');
    const error = failure(makeTree({ [RISK_MAP_PATH]: typo }));
    expect(error.code).toBe('E_RISKMAP');
    expect(error.message).toContain('Why');
  });

  it('reports an unreadable risk map as unreadable, not unparseable', () => {
    const error = failure(makeTree({ [`${RISK_MAP_PATH}/inner.txt`]: '' }));
    expect(error.code).toBe('E_RISKMAP');
    expect(error.message).toContain('Cannot read');
    expect(error.cause).toBeDefined();
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

describe('folder/** areas at the project root', () => {
  const map = { ...defaultRiskMap(), areas: ['Source', 'Content', 'Config', 'Art'].map(dir => ({ path: `${dir}/**`, tier: 'standard' as const })) };

  it('matches a file under each folder with the same glob rules as every other area', () => {
    for (const dir of ['Source', 'Content', 'Config', 'Art']) expect(tierFor(map, `${dir}/deep/file.ts`)).toEqual({ tier: 'standard', area: `${dir}/**` });
  });

  it('survives a serialize and load round trip', () => {
    const root = makeTree({ [RISK_MAP_PATH]: serializeRiskMap(map) });
    expect(loadRiskMap(root)?.areas.map(area => area.path)).toEqual(['Source/**', 'Content/**', 'Config/**', 'Art/**']);
  });
});
