/**
 * @lane merge
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { slug, total } from '../../src/core/text.ts';

// Every case below sits next to a pattern a detector looks for, and none of them may be flagged.
describe('text helpers', () => {
  it('mixes a mock assertion with a real value assertion', () => {
    const report = vi.fn();
    report(slug(' Hello World '));
    expect(report).toHaveBeenCalledWith('hello-world');
    expect(slug(' Hello World ')).toBe('hello-world');
  });

  it('pairs a snapshot with a plain value assertion', () => {
    expect(slug('A B')).toMatchSnapshot();
    expect(total([1, 2, 3])).toBe(6);
  });

  it('compares two different expressions', () => {
    expect(total([2, 2])).toBe(total([4]));
  });

  it('uses a unique scratch directory and dotfile names that are not .git', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'text-'));
    const names = ['.gitignore', '.github/workflows'];
    expect(scratch.length).toBeGreaterThan(0);
    expect(names).toHaveLength(2);
  });

  it.todo('handles unicode');
});
