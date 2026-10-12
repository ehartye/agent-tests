/** @lane merge
 * @subject scripts/candidate-evidence.mjs
 * @subject scripts/candidate-inputs.mjs
 * @subject scripts/candidate-reports.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const checkout = fileURLToPath(new URL('../', import.meta.url));
const script = join(checkout, 'scripts/candidate-evidence.mjs');
const made: string[] = [];
afterEach(() => { for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true }); });
function git(root: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000 });
  expect(result.status, result.stderr).toBe(0); return result.stdout.trim();
}
function fixture(body = "import {test} from 'node:test';test('pass',()=>{});test.skip('skip',()=>{});") {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'agent-tests-candidate-'))); made.push(base);
  const root = join(base, 'repo'); mkdirSync(root);
  writeFileSync(join(root, '.gitignore'), 'node_modules/\nassets/\n.local/\n');
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","type":"module","private":true}\n');
  writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n');
  writeFileSync(join(root, 'owner.mjs'), body);
  writeFileSync(join(root, 'note.txt'), 'original\n');
  git(root, 'init', '-q'); git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'add', '.');
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  return { root, out: join(base, 'evidence'), sha: git(root, 'rev-parse', 'HEAD') };
}
function run(...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
}
const receipt = (out: string) => JSON.parse(readFileSync(join(out, 'receipt.json'), 'utf8'));
const observe = (f: ReturnType<typeof fixture>, ...extra: string[]) => run('observe', 'node-test', '--root', f.root, '--out', f.out, ...extra, '--', 'owner.mjs');
const check = (f: ReturnType<typeof fixture>, candidate = f.sha) => run('check', '--root', f.root, '--receipt', join(f.out, 'receipt.json'), '--candidate', candidate);

describe('observational candidate evidence', () => {
  it('records a real Node child, counts/skips, source/index/content and declared limits without overwriting output', () => {
    const f = fixture(); const result = observe(f);
    expect(result.status, result.stderr).toBe(0);
    const saved = receipt(f.out);
    expect(saved.schema).toBe('agent-tests/candidate-evidence@1');
    expect(saved.command.executable).toBe(process.execPath);
    expect(saved.command.concurrency).toBe(1);
    expect(saved.child).toMatchObject({ exitCode: 0, signal: null, spawnError: null });
    expect(saved.report.summary.counts).toMatchObject({ total: 2, passed: 1, failed: 0, skipped: 1 });
    expect(saved.before.head.sha).toBe(f.sha);
    expect(saved.before.sourceRole).toBe('tested-committed-source');
    expect(saved.before.indexSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.before.files['note.txt'].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.limitations.join(' ')).toMatch(/transient.*restor/i);
    expect(saved.limitations.join(' ')).toMatch(/installed dependenc/i);
    expect(check(f).status).toBe(0);
    expect(observe(f).stderr).toMatch(/already exists/);
  });
  it('detects an edit to already-dirty bytes during the actual child even when porcelain is unchanged', () => {
    const f = fixture("import {test} from 'node:test';import {writeFileSync} from 'node:fs';test('mutation',()=>writeFileSync('note.txt','second dirty value'));");
    writeFileSync(join(f.root, 'note.txt'), 'first dirty value');
    const beforeStatus = git(f.root, 'status', '--porcelain');
    expect(observe(f).status).toBe(1);
    expect(git(f.root, 'status', '--porcelain')).toBe(beforeStatus);
    const saved = receipt(f.out);
    expect(saved.child.exitCode).toBe(0);
    expect(saved.before.sourceRole).toBe('committed-base-for-observed-working-tree');
    expect(saved.validation.changedDuringRun).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'note.txt' })]));
  });
  it.each(['same-porcelain', 'addition', 'deletion', 'index', 'lock', 'generated'])('rejects changed %s identity after observation', kind => {
    const f = fixture();
    if (kind === 'same-porcelain') writeFileSync(join(f.root, 'note.txt'), 'dirty before');
    if (kind === 'generated') { mkdirSync(join(f.root, 'assets')); writeFileSync(join(f.root, 'assets', 'sprite.bin'), 'first'); }
    expect(observe(f, ...(kind === 'generated' ? ['--generated-input', 'assets'] : [])).status).toBe(0);
    if (kind === 'same-porcelain') writeFileSync(join(f.root, 'note.txt'), 'dirty after');
    if (kind === 'addition') writeFileSync(join(f.root, 'new.txt'), 'new');
    if (kind === 'deletion') rmSync(join(f.root, 'note.txt'));
    if (kind === 'index') { writeFileSync(join(f.root, 'note.txt'), 'staged'); git(f.root, 'add', 'note.txt'); writeFileSync(join(f.root, 'note.txt'), 'original\n'); }
    if (kind === 'lock') writeFileSync(join(f.root, 'package-lock.json'), '{"changed":true}');
    if (kind === 'generated') writeFileSync(join(f.root, 'assets', 'sprite.bin'), 'changed');
    const result = check(f);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(JSON.parse(result.stdout).changedSince.length).toBeGreaterThan(0);
  });
  it('rejects a different candidate and refuses to silently promote a dirty capture to its later commit', () => {
    const f = fixture(); writeFileSync(join(f.root, 'note.txt'), 'candidate bytes');
    expect(observe(f).status).toBe(0);
    expect(check(f).status).toBe(0);
    expect(check(f, '0'.repeat(40)).status).toBe(1);
    git(f.root, 'add', 'note.txt'); git(f.root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'candidate');
    const result = check(f, git(f.root, 'rev-parse', 'HEAD'));
    expect(result.status).toBe(1); expect(result.stdout).toMatch(/cannot be remapped/);
  });
  it('retains actual failed and signalled native children as rejected evidence', () => {
    const failed = fixture("import {test} from 'node:test';test('failed',()=>{throw Error('controlled failure')});");
    expect(observe(failed).status).toBe(1);
    expect(receipt(failed.out).child.exitCode).toBe(1);
    expect(receipt(failed.out).report.summary.counts.failed).toBe(1);
    const signalled = fixture("import {test} from 'node:test';test('held',()=>new Promise(()=>{}));setInterval(()=>{},1000);");
    const result = run('observe', 'node-test', '--root', signalled.root, '--out', signalled.out, '--timeout-ms', '500', '--', '--test-isolation=none', 'owner.mjs');
    expect(result.status).toBe(1);
    expect(receipt(signalled.out).child.timedOut).toBe(true);
    expect(receipt(signalled.out).child.signal).toBe('SIGTERM');
    expect(check(signalled).status).toBe(1);
  });
  it('rejects missing/incomplete count reports and a recorded spawn error rather than trusting a zero exit', () => {
    const f = fixture(); expect(observe(f).status).toBe(0);
    const saved = receipt(f.out), path = join(f.out, saved.report.file), raw = JSON.parse(readFileSync(path, 'utf8'));
    raw.counts = null; writeFileSync(path, JSON.stringify(raw));
    saved.report.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    writeFileSync(join(f.out, 'receipt.json'), JSON.stringify(saved));
    expect(check(f).stdout).toMatch(/incomplete native count/);
    rmSync(path); expect(check(f).status).toBe(1);
    saved.child.spawnError = { code: 'EAGAIN', message: 'controlled rejected metadata' };
    writeFileSync(join(f.out, 'receipt.json'), JSON.stringify(saved));
    expect(check(f).stdout).toMatch(/signal\/spawn error/);
  });
  it('rejects absent native test-file evidence even when global counts and exit status report success', () => {
    const f = fixture(); expect(observe(f).status).toBe(0);
    const saved = receipt(f.out), path = join(f.out, saved.report.file), raw = JSON.parse(readFileSync(path, 'utf8'));
    for (const files of [null, []]) {
      raw.files = files; writeFileSync(path, JSON.stringify(raw));
      saved.report.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
      saved.report.summary.files = files;
      writeFileSync(join(f.out, 'receipt.json'), JSON.stringify(saved));
      const result = check(f);
      expect(result.status, result.stdout + result.stderr).toBe(1);
      expect(result.stdout).toMatch(/incomplete native count/);
    }
  });
  it('refuses traversal/symlink closure and unsafe concurrency/watch/report overrides before launching', () => {
    const f = fixture();
    expect(observe(f, '--generated-input', '../outside').stderr).toMatch(/traversing input/);
    const external = join(dirname(f.root), 'external'); mkdirSync(external);
    symlinkSync(external, join(f.root, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(observe(f, '--generated-input', 'assets').stderr).toMatch(/Symbolic-link/);
    for (const flag of ['--test-concurrency=2', '--watch', '--test-reporter=tap']) {
      const result = run('observe', 'node-test', '--root', f.root, '--out', f.out, '--', flag, 'owner.mjs');
      expect(result.status).toBe(1); expect(existsSync(f.out)).toBe(false);
    }
  });
  it('permits an explicit reviewed CPU cap of two while preserving named native selection', () => {
    const f = fixture(); expect(observe(f, '--cpu').status).toBe(0);
    expect(receipt(f.out).command).toMatchObject({ concurrency: 2, selectedArgs: ['owner.mjs'] });
  });
  it('refuses Vitest watch/single-run overrides and report replay before creating evidence or starting a native runner', () => {
    const f = fixture();
    symlinkSync(join(checkout, 'node_modules'), join(f.root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const flag of ['--mergeReports=missing-replays', '--merge-reports=missing-replays', '-w', '--standalone', '--run=false', '--no-run']) {
      const result = run('observe', 'vitest', '--root', f.root, '--out', f.out, '--', flag, 'owner.mjs');
      expect(result.status).toBe(1);
      expect(existsSync(f.out)).toBe(false);
      expect(result.stderr).toMatch(/Single-run\/report replay overrides/);
    }
  });
  it('demonstrates native cached successes need not execute their bodies again', () => {
    const f = fixture("import {test} from 'node:test';import {appendFileSync,existsSync} from 'node:fs';test('cached success',()=>appendFileSync('.local/attempts.txt','executed\\n'));test('recoverable failure',()=>{if(!existsSync('.local/allow-pass'))throw Error('first run fails');});");
    const cache = join(f.root, '.local'); mkdirSync(cache);
    const profile = join(cache, 'profile.json');
    const invoke = () => spawnSync(process.execPath, ['--test', '--test-concurrency=1', `--test-rerun-failures=${join(cache, 'state.json')}`, `--test-reporter=${pathToFileURL(join(checkout, 'scripts/node-profile.mjs')).href}`, `--test-reporter-destination=${profile}`, 'owner.mjs'], { cwd: f.root, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    const first = invoke(); expect(first.status, first.stderr).toBe(1);
    expect(readFileSync(join(cache, 'attempts.txt'), 'utf8')).toBe('executed\n');
    writeFileSync(join(cache, 'allow-pass'), 'yes');
    const rerun = invoke(); expect(rerun.status, rerun.stderr).toBe(0);
    expect(JSON.parse(readFileSync(profile, 'utf8')).counts).toMatchObject({ tests: 2, passed: 2, failed: 0 });
    expect(readFileSync(join(cache, 'attempts.txt'), 'utf8')).toBe('executed\n');
  });
  it.each([{ flags: ['--test-rerun-failures=.local/state.json'] }, { flags: ['--test-rerun-failures', '.local/state.json'] }])('refuses Node cached-attempt flag $flags before creating evidence or launching', ({ flags }) => {
    const f = fixture();
    mkdirSync(join(f.root, '.local'));
    const result = run('observe', 'node-test', '--root', f.root, '--out', f.out, '--', ...flags, 'owner.mjs');
    expect(result.status).toBe(1);
    expect(existsSync(f.out)).toBe(false);
    expect(result.stderr).toMatch(/Cached-attempt replay/);
  });
  it('records actual Vitest results, preserving unreported cancellations as unknown and refusing absent counts', () => {
    const f = fixture();
    symlinkSync(join(checkout, 'node_modules'), join(f.root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(join(f.root, 'native.test.mjs'), "import {test} from 'vitest';test('pass',()=>{});test.skip('skip',()=>{});");
    const result = run('observe', 'vitest', '--root', f.root, '--out', f.out, '--', 'native.test.mjs');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const saved = receipt(f.out);
    expect(saved.toolchainBefore.runner.version).toBe(JSON.parse(readFileSync(join(checkout, 'node_modules/vitest/package.json'), 'utf8')).version);
    expect(saved.report.summary.counts).toMatchObject({ total: 2, passed: 1, skipped: 1, cancelled: null });
    expect(check(f).status).toBe(0);
    const path = join(f.out, saved.report.file), raw = JSON.parse(readFileSync(path, 'utf8')); delete raw.numTodoTests;
    writeFileSync(path, JSON.stringify(raw)); saved.report.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    writeFileSync(join(f.out, 'receipt.json'), JSON.stringify(saved));
    const checked = check(f); expect(checked.status).toBe(1); expect(JSON.parse(checked.stdout).counts.todo).toBe(null);
  });
  it('makes the before/after transient-restore limit explicit instead of claiming to detect restored edits', () => {
    const f = fixture("import {test} from 'node:test';import {writeFileSync} from 'node:fs';test('restore',()=>{writeFileSync('note.txt','transient');writeFileSync('note.txt','original\\n');});");
    expect(observe(f).status).toBe(0);
    expect(receipt(f.out).limitations.join(' ')).toMatch(/cannot detect transient edits restored/);
  });
});
