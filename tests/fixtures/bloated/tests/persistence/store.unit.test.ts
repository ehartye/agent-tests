import { describe, expect, it } from 'vitest';
import { load, save } from '../../src/persistence/store.ts';

describe('store', () => {
  it('round-trips a saved value through load', () => {
    expect(load(save('a', 'b'))).toBe('b');
  });
});
