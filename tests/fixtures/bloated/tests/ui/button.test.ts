/**
 * @lane edit
 */
import { describe, expect, it } from 'vitest';
import { label } from '../../src/ui/button.ts';

describe('button', () => {
  it('trims the label', () => {
    expect(label(' a ')).toBe('a');
    expect(true).toBe(true);
  });
});
