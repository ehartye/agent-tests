import { API } from 'typescript/unstable/sync';
import { describe, expect, it, vi } from 'vitest';
import { openParseSession } from '../src/parse.ts';

describe('native parse session boundaries', () => {
  it('releases each native process and preserves fresh facts across two restarts', () => {
    const close = vi.spyOn(API.prototype, 'close');
    const session = openParseSession({ restartEvery: 3 });
    let closed = false;
    try {
      for (let i = 0; i < 8; i++) {
        const result = session.parse('same.test.ts', `import { value${i} } from './value${i}.ts';\nit('case ${i}', () => expect(value${i}).toBe(${i}));`);
        expect(result.imports).toEqual([`./value${i}.ts`]);
        expect(result.tests.map(test => [test.name, test.line, test.assertions])).toEqual([[`case ${i}`, 2, 1]]);
        expect(close).toHaveBeenCalledTimes(Math.floor(i / 3));
      }
      session.close();
      closed = true;
      expect(close).toHaveBeenCalledTimes(3);
    } finally {
      if (!closed) session.close();
      close.mockRestore();
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses invalid restart interval %s', restartEvery => {
    expect(() => openParseSession({ restartEvery })).toThrow(/positive integer/);
  });
});
