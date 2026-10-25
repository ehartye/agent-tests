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
function fixture(mode: 'node-test' | 'vitest' = 'node-test') {
  const directory = mkdtempSync(join(tmpdir(), 'tests-progress-')); made.push(directory);
  const facts = { before: { root: directory, head: { sha: '1'.repeat(40) }, files: {} }, toolchainBefore: { node: process.version, executable: process.execPath, helpers: { 'candidate-progress.mjs': '2'.repeat(64) } }, command: { executable: process.execPath, cwd: directory, mode, args: ['a.mjs'], selectedArgs: ['a.mjs'], concurrency: 1, resourceDeclaration: 'serial/unreviewed' }, progress: { capability: 'qualified', adapter: mode === 'vitest' ? 'vitest-5.0.3' : 'node-events', version: mode === 'vitest' ? '5.0.3' : process.version }, limitations: [] };
  const binding = startAttempt(directory, facts);
  const writer = openProgressWriter({ directory, ...binding });
  return { directory, binding, writer };
}
const ownerEnd = () => ({ owner: { id: 'a', file: 'a.mjs' }, state: 'passed', counts: { total: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0, topLevel: 1 }, nativeDurationMs: 1, cleanup: 'unknown' });
const runEnd = () => ({ state: 'passed', nativeDurationMs: 1, projectionFailed: false });
const nativeError = () => { const d = boundedDetails(); d.error({ scope: 'case', id: 'a', ownerId: null, definitionFile: 'a.mjs' }, Error('native failure')); return d.result(); };
function raw(f: ReturnType<typeof fixture>, sequence: number, changes: object) {
  const name = `${String(sequence).padStart(8, '0')}.json`;
  const path = join(f.directory, 'progress', name);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...value, ...changes }));
}
describe('immutable candidate progress', () => {
  it('binds ordered facts to immutable start bytes and seals a contiguous inventory', () => {
    const f = fixture(); f.writer.append('owner-discovered', { owner: { id: 'a', file: 'a.mjs' } });
    f.writer.append('owner-ended', ownerEnd());
    f.writer.append('run-ended', runEnd());
    expect(readProgress(f.directory)).toMatchObject({ sealed: false, problems: [], endedOwners: ['a'], observerLiveness: 'unknown' });
    const inventory = sealProgress(f.directory, f.binding);
    expect(readProgress(f.directory, inventory)).toMatchObject({ sealed: true, problems: [], endedOwners: ['a'] });
    expect(() => f.writer.append('run-ended', { state: 'passed' })).toThrow(/sealed/);
  });
  it.each(['binding', 'duplicate-owner', 'duplicate-sequence', 'transition', 'truncated', 'directory', 'traversal'])('rejects %s final records', kind => {
    const f = fixture(); f.writer.append('owner-ended', ownerEnd());
    if (kind === 'binding') raw(f, 1, { startSha256: '0'.repeat(64) });
    if (kind === 'duplicate-owner') f.writer.append('owner-ended', ownerEnd());
    if (kind === 'duplicate-sequence') { f.writer.append('run-ended', runEnd()); raw(f, 2, { sequence: 1 }); }
    if (kind === 'transition') f.writer.append('owner-started', { owner: { id: 'a', file: 'a.mjs' } });
    if (kind === 'truncated') writeFileSync(join(f.directory, 'progress/00000001.json'), '{');
    if (kind === 'directory') { rmSync(join(f.directory, 'progress/00000001.json')); mkdirSync(join(f.directory, 'progress/00000001.json')); }
    if (kind === 'traversal') writeFileSync(join(f.directory, 'progress/escape.json'), '{}');
    expect(readProgress(f.directory).problems.length).toBeGreaterThan(0);
  });
  it.each(['edit', 'remove', 'add', 'inventory'])('rejects sealed %s corruption', kind => {
    const f = fixture(); f.writer.append('run-ended', runEnd()); const ref = sealProgress(f.directory, f.binding);
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
  it.each(['deep', 'cycle', 'scalar'])('propagates nested %s cause truncation to aggregate details', kind => {
    const primary: { message: string; cause?: unknown } = { message: 'primary' };
    if (kind === 'cycle') primary.cause = primary;
    else if (kind === 'scalar') primary.cause = 'nested detail'.repeat(1000);
    else {
      let cursor = primary;
      for (let depth = 0; depth < 6; depth++) { const cause = { message: `cause ${depth}` }; cursor.cause = cause; cursor = cause; }
    }
    const details = boundedDetails(); details.error({ scope: 'case', id: 'native-case' }, primary);
    const result = details.result();
    expect(result.errors[0].error).toMatchObject({ message: 'primary', truncated: true });
    expect(result).toMatchObject({ truncated: true, omittedErrors: 0 });
    if (kind !== 'scalar') expect(JSON.stringify(result)).toContain('[cause omitted]');
    const f = fixture(); f.writer.append('native-error', result); expect(readProgress(f.directory).problems).toEqual([]);
  });
  it('serializes overlapping callers and refuses a second writer or replaced write directory', async () => {
    const f = fixture(); await Promise.all(Array.from({ length: 64 }, () => Promise.resolve().then(() => f.writer.append('native-error', nativeError()))));
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
    const f = fixture(), details = boundedDetails(); for (let i = 0; i < 24; i++) details.error({ scope: 'run' }, { message: 'x'.repeat(4096), stack: 'x'.repeat(4096) });
    for (let i = 0; i < 190; i++) f.writer.append('native-error', details.result());
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
  it.each([false, true])('rejects valid-envelope invalid payloads (sealed=%s)', sealed => {
    for (const changes of [{ state: { impossible: true } }, { counts: { ...ownerEnd().counts, total: -7 } }, { counts: { ...ownerEnd().counts, passed: 'many' } }, { counts: { total: 1 } }, { cleanup: 'complete' }, { nativeDurationMs: -1 }, { owner: { id: 'a', file: 'a.mjs', project: {} } }]) {
      const f = fixture(); f.writer.append('owner-ended', { ...ownerEnd(), ...changes });
      if (sealed) {
        // Seal raw bytes directly so the reader must validate payloads beyond coherent local hashes.
        const files = ['attempt-start.json', 'progress/00000001.json'].map(file => { const raw = readFileSync(join(f.directory, file)); return { file, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') }; });
        writeFileSync(join(f.directory, 'progress-inventory.json'), JSON.stringify({ schema: 'agent-tests/candidate-inventory@1', ...f.binding, files }));
      }
      expect(readProgress(f.directory).problems.length, JSON.stringify(changes)).toBeGreaterThan(0);
    }
  });
  it('rejects malformed start, runner end and bounded detail payloads', () => {
    for (const changes of [{ state: 'interrupted' }, { projectionFailed: 'false' }, { reportedOwners: [] }, { nativeDurationMs: '1' }]) {
      const f = fixture(); f.writer.append('run-ended', { ...runEnd(), ...changes }); expect(readProgress(f.directory).problems.length).toBeGreaterThan(0);
    }
    for (const changes of [{ errors: [{ scope: 'case', error: { message: {}, truncated: false } }] }, { omittedErrors: -1 }, { truncated: 'yes' }, { errors: new Array(65).fill(nativeError().errors[0]) }, { cases: [{ id: 'a', state: 'passed', engine: {} }] }]) {
      const f = fixture(); f.writer.append('native-error', { ...nativeError(), ...changes }); expect(readProgress(f.directory).problems.length).toBeGreaterThan(0);
    }
    const f = fixture(), start = JSON.parse(readFileSync(join(f.directory, 'attempt-start.json'), 'utf8')); start.command.concurrency = 'many';
    writeFileSync(join(f.directory, 'attempt-start.json'), JSON.stringify(start)); expect(readProgress(f.directory).problems.length).toBeGreaterThan(0);
    const v = fixture('vitest'); v.writer.append('run-ended', { state: 'passed', projectionFailed: false, reportedOwners: [{ id: 'a', file: {} }] }); expect(readProgress(v.directory).problems.length).toBeGreaterThan(0);
  });
  it('accepts the emitted detail byte budget including JSON array punctuation', () => {
    const f = fixture(), details = boundedDetails();
    for (let i = 0; i < 64; i++) details.error({ scope: 'run' }, { message: 'x'.repeat(4096) });
    const retained = details.result().errors.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)), 0);
    const overhead = Buffer.byteLength(JSON.stringify({ scope: 'run', error: projectError({ message: '' }) }));
    const remaining = 192 * 1024 - retained - overhead; expect(remaining).toBeGreaterThanOrEqual(0);
    details.error({ scope: 'run' }, { message: 'x'.repeat(remaining) }); f.writer.append('native-error', details.result());
    expect(readProgress(f.directory).problems).toEqual([]);
  });
});
