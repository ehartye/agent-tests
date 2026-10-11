import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { globToRegExp, toPosix } from '../src/paths.ts';

describe('globToRegExp', () => {
  it('lets ** cross directories', () => {
    expect(globToRegExp('src/persistence/**').test('src/persistence/a/b.ts')).toBe(true);
  });

  it('keeps * inside one path segment', () => {
    const pattern = globToRegExp('src/*.ts');
    expect(pattern.test('src/a.ts')).toBe(true);
    expect(pattern.test('src/a/b.ts')).toBe(false);
  });

  it('treats **/ as zero or more leading directories', () => {
    const pattern = globToRegExp('**/x.ts');
    expect(pattern.test('x.ts')).toBe(true);
    expect(pattern.test('a/b/x.ts')).toBe(true);
  });

  it('escapes regex metacharacters', () => {
    expect(globToRegExp('a.b').test('axb')).toBe(false);
  });

  it('does not match a sibling directory with the same prefix', () => {
    expect(globToRegExp('src/auth/**').test('src/authors/x.ts')).toBe(false);
  });
});

describe('toPosix', () => {
  it('converts the platform separator to a forward slash', () => {
    expect(toPosix(['a', 'b', 'c.ts'].join(sep))).toBe('a/b/c.ts');
  });
});
