import { describe, expect, it } from 'vitest';
import { parseOld } from '../../src/legacy/format.ts';

describe('legacy format compatibility', () => {
  it('parses the comma separated layout', () => {
    expect(parseOld('a,b')).toEqual(['a', 'b']);
  });
});
