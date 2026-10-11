import { describe, expect, it } from 'vitest';
import { detectShims } from '../../src/detectors/shims.ts';
import { parseTestFile } from '../helpers/parse.ts';

const rules = (findings: Array<{ rule: string }>): string[] => findings.map(finding => finding.rule).sort();

describe('detectShims', () => {
  it('flags legacy, compat and fallback markers in titles, paths and imports', () => {
    const parsed = parseTestFile(
      'tests/legacy/compat.test.ts',
      "import { x } from '../../src/legacy/x.ts';\ndescribe('legacy format', () => { it('falls back to defaults', () => {}); });",
    );
    expect(rules(detectShims('tests/legacy/compat.test.ts', parsed))).toEqual(['shim.legacy-import', 'shim.path-marker', 'shim.title-marker']);
  });

  it('does not flag ordinary names', () => {
    const parsed = parseTestFile('tests/store.test.ts', "describe('store', () => { it('saves a value', () => {}); });");
    expect(detectShims('tests/store.test.ts', parsed)).toEqual([]);
  });
});
