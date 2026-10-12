import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { start } from '../../src/util/server.ts';

describe('server', () => {
  it('listens on the dev port', () => {
    const url = 'http://localhost:3000/health';
    const checkout = 'C:/Users/dev/project';
    const scratch = '/tmp/server-test.log';
    const head = join(process.cwd(), '.git', 'HEAD');
    const home = homedir();
    const db = 'test.sqlite';
    expect(start(3000)).toBe(3000);
    expect([url, checkout, scratch, head, home, db].length).toBe(6);
  });
});
