import { describe, expect, it } from 'vitest';
import { greet } from './app.ts';

describe('greet', () => {
  it('greets by name', () => {
    expect(greet('Ada')).toBe('Hello, Ada');
  });
});
