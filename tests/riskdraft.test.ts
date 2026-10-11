import { describe, expect, it } from 'vitest';
import { candidateDirs, draftRiskMap } from '../src/riskdraft.ts';
import { RiskMap } from '../src/schema.ts';
import { makeTree } from './helpers/tree.ts';

describe('candidateDirs', () => {
  it('lists the children of src, skipping tests, docs and dot directories', () => {
    const root = makeTree({ 'src/auth/a.ts': '', 'src/ui/b.ts': '', 'src/tests/c.ts': '', 'src/.cache/d.ts': '', 'src/loose.ts': '' });
    expect(candidateDirs(root)).toEqual(['src/auth', 'src/ui']);
  });

  it('uses the root when there is no conventional source directory', () => {
    const root = makeTree({ 'core/a.ts': '', 'docs/readme.md': '', 'node_modules/x/y.js': '' });
    expect(candidateDirs(root)).toEqual(['core']);
  });

  it('includes packages and apps children', () => {
    const root = makeTree({ 'packages/api/a.ts': '', 'apps/web/b.ts': '' });
    expect(candidateDirs(root)).toEqual(['apps/web', 'packages/api']);
  });
});

describe('draftRiskMap', () => {
  const root = makeTree({ 'src/persistence/a.ts': '', 'src/ui/b.ts': '', 'src/parser/c.ts': '', 'src/billing/d.ts': '' });
  const map = draftRiskMap(root);

  it('produces a valid dev-phase map with no consumers', () => {
    expect(RiskMap.safeParse(map).success).toBe(true);
    expect(map.phase).toBe('dev');
    expect(map.consumers).toEqual([]);
  });

  it('adds a catch-all last when code sits directly in the source directory', () => {
    const flat = draftRiskMap(makeTree({ 'src/auth/a.ts': '', 'src/scan.ts': '' }));
    expect(flat.areas.map(area => `${area.path}:${area.tier}`)).toEqual(['src/auth/**:critical', 'src/**:standard']);
    expect(draftRiskMap(makeTree({ 'src/auth/a.ts': '' })).areas.map(area => area.path)).toEqual(['src/auth/**']);
  });

  it('classifies directories by name and says why', () => {
    const byPath = Object.fromEntries(map.areas.map(area => [area.path, area.tier]));
    expect(byPath).toEqual({
      'src/billing/**': 'critical',
      'src/parser/**': 'standard',
      'src/persistence/**': 'critical',
      'src/ui/**': 'low',
    });
    expect(map.areas.every(area => area.why && area.why.length > 0)).toBe(true);
  });
});
