/**
 * @lane scheduled
 */
import { describe, expect, it } from 'vitest';
import { pad } from '../../src/util/pad.ts';

describe('pad', () => {
  it('pads on the left to the requested width', () => {
    expect(pad('a', 3)).toBe('  a');
  });
});
