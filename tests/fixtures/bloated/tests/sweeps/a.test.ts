import { describe, expect, it } from 'vitest';
import { roll } from '../../src/util/sweep.ts';

describe('sweep a', () => {
  it('stays in range for every seed', () => {
    for (let seed = 1; seed <= 30; seed++) {
      expect(roll(seed)).toBeLessThan(7);
    }
  });
});
