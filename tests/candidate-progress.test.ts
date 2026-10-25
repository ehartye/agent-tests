/** @lane merge
 * @subject scripts/candidate-progress.mjs
 */
import fs, { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startAttempt, openProgressWriter, sealProgress, readProgress, projectError, boundedDetails } from '../scripts/candidate-progress.mjs';
const made: string[] = [];
afterEach(() => { for (const p of made.splice(0)) rmSync(p, { recursive: true, force: true }); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'tests-progress-')); made.push(directory);
  const binding = startAttempt(directory, { command: { mode: 'node-test', selectedArgs: ['a.mjs'] }, progress: { capability: 'qualified' } });
  const writer = openProgressWriter({ directory, ...binding });
  return { directory, binding, writer };
}
function raw(f: ReturnType<typeof fixture>, sequence: number, changes: object) {
  const name = `${String(sequence).padStart(8, '0')}.json`;
  const path = join(f.directory, 'progress', name);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...value, ...changes }));
}
describe('immutable candidate progress', () => {
  it('binds ordered facts to immutable start bytes and seals a contiguous inventory', () => {
    const f = fixture(); f.writer.append('owner-discovered', { owner: { id: 'a', file: 'a.mjs' } });
    f.writer.append('owner-ended', { owner: { id: 'a', file: 'a.mjs' }, state: 'passed', counts: { total: 1, passed: 1 }, cleanup: 'unknown' });
    f.writer.append('run-ended', { state: 'passed' });
    expect(readProgress(f.directory)).toMatchObject({ sealed: false, problems: [], endedOwners: ['a'], observerLiveness: 'unknown' });
    const inventory = sealProgress(f.directory, f.binding);
    expect(readProgress(f.directory, inventory)).toMatchObject({ sealed: true, problems: [], endedOwners: ['a'] });
    expect(() => f.writer.append('run-ended', { state: 'passed' })).toThrow(/sealed/);
  });
  it.each(['binding', 'duplicate-owner', 'duplicate-sequence', 'transition', 'truncated', 'directory', 'traversal'])('rejects %s final records', kind => {
    const f = fixture(); f.writer.append('owner-ended', { owner: { id: 'a', file: 'a.mjs' }, state: 'passed' });
    if (kind === 'binding') raw(f, 1, { startSha256: '0'.repeat(64) });
    if (kind === 'duplicate-owner') f.writer.append('owner-ended', { owner: { id: 'a', file: 'a.mjs' }, state: 'passed' });
    if (kind === 'duplicate-sequence') { f.writer.append('run-ended', {}); raw(f, 2, { sequence: 1 }); }
    if (kind === 'transition') f.writer.append('owner-started', { owner: { id: 'a', file: 'a.mjs' } });
    if (kind === 'truncated') writeFileSync(join(f.directory, 'progress/00000001.json'), '{');
    if (kind === 'directory') { rmSync(join(f.directory, 'progress/00000001.json')); mkdirSync(join(f.directory, 'progress/00000001.json')); }
    if (kind === 'traversal') writeFileSync(join(f.directory, 'progress/escape.json'), '{}');
    expect(readProgress(f.directory).problems.length).toBeGreaterThan(0);
  });
  it.each(['edit', 'remove', 'add', 'inventory'])('rejects sealed %s corruption', kind => {
    const f = fixture(); f.writer.append('run-ended', { state: 'passed' }); const ref = sealProgress(f.directory, f.binding);
    const path = join(f.directory, 'progress/00000001.json');
    if (kind === 'edit') raw(f, 1, { state: 'failed' });
    if (kind === 'remove') rmSync(path);
    if (kind === 'add') writeFileSync(join(f.directory, 'progress/00000002.json'), readFileSync(path));
    if (kind === 'inventory') writeFileSync(join(f.directory, ref.file), '{}');
    expect(readProgress(f.directory, ref).problems.length).toBeGreaterThan(0);
  });
  it('ignores only recognized unfinished publications, refuses collisions and escaping links', () => {
    const f = fixture(); writeFileSync(join(f.directory, 'progress/.00000001.json.0123456789abcdef.tmp'), '{');
    expect(readProgress(f.directory).problems).toEqual([]);
    writeFileSync(join(f.directory, 'progress/00000001.json'), '{}');
    expect(() => f.writer.append('run-ended', {})).toThrow();
    const outside = mkdtempSync(join(tmpdir(), 'tests-progress-outside-')); made.push(outside);
    const g = fixture(); rmSync(join(g.directory, 'progress'), { recursive: true });
    symlinkSync(outside, join(g.directory, 'progress'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(readProgress(g.directory).problems.join(' ')).toMatch(/symbolic|contain|link/i);
  });
  it('projects only bounded scalar errors and handles cycles without reading arbitrary properties', () => {
    const error = Object.assign(new Error('x'.repeat(40000)), { actual: { engine: 'graph' }, expected: 3, secret: 'do not serialize', cause: undefined as unknown });
    error.cause = error;
    const projected = projectError(error);
    expect(JSON.stringify(projected).length).toBeLessThan(20000);
    expect(projected).toMatchObject({ expected: 3, actual: null, truncated: true });
    expect(JSON.stringify(projected)).not.toMatch(/secret|engine/);
  });
  it('serializes overlapping callers and refuses a second writer or replaced write directory', async () => {
    const f = fixture(); await Promise.all(Array.from({ length: 64 }, (_, index) => Promise.resolve().then(() => f.writer.append('native-error', { message: String(index) }))));
    expect(readProgress(f.directory).records.map((r: any) => r.sequence)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
    expect(() => openProgressWriter({ directory: f.directory, ...f.binding })).toThrow(/writer/);
    const outside = mkdtempSync(join(tmpdir(), 'tests-progress-write-')); made.push(outside);
    rmSync(join(f.directory, 'progress'), { recursive: true }); symlinkSync(outside, join(f.directory, 'progress'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => f.writer.append('run-ended', {})).toThrow(/link/i); expect(readdirSync(outside)).toEqual([]);
  });
  it('bounds UTF-8 scalar bytes rather than only JavaScript character count', () => {
    const projected = projectError({ message: '🌱'.repeat(4000) }) as { message: string; truncated: boolean };
    expect(Buffer.byteLength(projected.message)).toBeLessThanOrEqual(4096); expect(projected.truncated).toBe(true);
  });
  it('bounds sealed aggregate reads before traversing an oversized inventory', () => {
    const f = fixture(); for (let i = 0; i < 70; i++) f.writer.append('native-error', { message: 'x'.repeat(500000) });
    const files = ['attempt-start.json', ...readdirSync(join(f.directory, 'progress')).map(n => `progress/${n}`)].sort().map(file => {
      const raw = readFileSync(join(f.directory, file)); return { file, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') };
    });
    writeFileSync(join(f.directory, 'progress-inventory.json'), JSON.stringify({ schema: 'agent-tests/candidate-inventory@1', ...f.binding, files }));
    const original = fs.readFileSync; let bytesRead = 0;
    fs.readFileSync = ((...args: Parameters<typeof original>) => { const result = original(...args); if (String(args[0]).startsWith(f.directory)) bytesRead += Buffer.byteLength(result); return result; }) as typeof original;
    syncBuiltinESMExports();
    try {
      expect(readProgress(f.directory).problems.join(' ')).toMatch(/aggregate.*bound/i);
      expect(bytesRead).toBeLessThan(33 * 1024 * 1024);
    } finally { fs.readFileSync = original; syncBuiltinESMExports(); }
  });
  it('caps aggregate detail populations and reports exact omitted totals', () => {
    const details = boundedDetails();
    for (let i = 0; i < 1000; i++) { details.case({ id: String(i), state: 'passed' }); details.error({ scope: 'case', id: String(i) }, Error(`failure ${i}`)); }
    const result = details.result(); expect(result.cases.length).toBeLessThanOrEqual(128); expect(result.errors.length).toBeLessThanOrEqual(64);
    expect(result.cases.length + result.omittedCases).toBe(1000); expect(result.errors.length + result.omittedErrors).toBe(1000);
    expect(result.truncated).toBe(true); expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(200 * 1024);
  });
});
