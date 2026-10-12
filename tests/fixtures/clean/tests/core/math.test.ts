/**
 * @lane merge
 */
import { describe, expect, it } from 'vitest';
import { add } from '../../src/core/math.ts';

describe('add', () => {
  it('adds two positive numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('cancels opposite numbers', () => {
    expect(add(-1, 1)).toBe(0);
  });
});
