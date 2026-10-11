/**
 * @lane scheduled
 */
import { describe, expect, it } from 'vitest';
import { label } from '../../src/ui/label.ts';

describe('label', () => {
  it('trims surrounding whitespace', () => {
    expect(label('  hi  ')).toBe('hi');
  });
});
