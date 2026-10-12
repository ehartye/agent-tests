import { describe, expect, it } from 'vitest';
import { load, save } from '../../src/persistence/store.ts';

describe('store integration', () => {
  it('round-trips a saved value through load', () => {
    expect(load(save('key', 'value'))).toBe('value');
  });
});
