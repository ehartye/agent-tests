/**
 * @lane merge
 * @subject src/worktree-check.ts
 * @subject src/cli.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runCleanup, tokenize, worktreeCheck, type CleanupOps, type CleanupResult } from '../src/worktree-check.ts';
import { physicalTemp } from './helpers/physical-temp.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = join(ROOT, 'scripts', 'tests.mjs');

/** The environment with GIT_* removed so a hook cannot point git at another repository. */
const cleanEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_')));

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: cleanEnv(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

/** A committed git project with the given test script body (a Node script) and package.json scripts. */
function project(files: Record<string, string>, scripts: Record<string, string> | null = { test: 'node test.js' }): { base: string; root: string } {
  const base = physicalTemp('agent-tests-wc-');
  made.push(base);
  const root = join(base, 'repo');
  mkdirSync(root);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'fixture', private: true, ...(scripts ? { scripts } : {}) })}\n`);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');
  return { base, root };
}

/** Writes a token to one path, waits 150 ms and reads it back: two processes sharing the path clobber each other. */
const sharedFileTest = (path: string, unique: boolean) => `
const fs = require('node:fs');
const path = ${JSON.stringify(path)}${unique ? " + '.' + process.pid" : ''};
const token = String(process.pid) + '-' + Math.random();
fs.writeFileSync(path, token);
setTimeout(() => {
  const seen = fs.readFileSync(path, 'utf8');
  if (seen !== token) {
    console.error('FAIL shared file was overwritten by another run');
    process.exit(1);
  }
}, 150);
`;

function check(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [LAUNCHER, 'worktree-check', '--root', root, ...args], {
    env: { ...cleanEnv(), AGENT_TESTS_DEBUG: '' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

const reportOf = (stdout: string) => JSON.parse(stdout) as {
  schema: string;
  verdict: string;
  command: string;
  rootDirty: boolean;
  baseline: { passed: boolean; exitCode: number };
  results: Array<{ run: number; root: { passed: boolean; exitCode: number; durationMs: number; failureLines?: string[] }; worktree: { passed: boolean; exitCode: number; durationMs: number; failureLines?: string[] } }>;
  cleanup: { ok: boolean; worktreeCreated: boolean; worktreeRemoved: boolean; branchDeleted: boolean; errors: string[] };
};

const errorOf = (stderr: string) => {
  const lines = stderr.trimEnd().split('\n');
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!).error as { code: string; message: string; hint?: string };
};

/** After a run the repository must show only its own worktree and no throwaway branch. */
function expectNoLeftovers(root: string): void {
  const worktrees = git(root, 'worktree', 'list', '--porcelain').split(/\r?\n/).filter(line => line.startsWith('worktree '));
  expect(worktrees).toHaveLength(1);
  expect(git(root, 'branch', '--list')).not.toContain('worktree-check');
  expect(git(root, 'branch', '--list', '--format=%(refname:short)').split(/\r?\n/).filter(Boolean)).toHaveLength(1);
}

describe('worktree-check', () => {
  it('reports hazard-observed when two checkouts share a fixed file, with the failing lines', () => {
    const { base, root } = project({ 'test.js': '' });
    writeFileSync(join(root, 'test.js'), sharedFileTest(join(base, 'shared-token').replace(/\\/g, '/'), false));
    git(root, 'commit', '-qam', 'shared path');
    const result = check(root, '--no-install', '--runs', '4');
    expect(result.status, result.stderr).toBe(0);
    const report = reportOf(result.stdout);
    expect(report.schema).toBe('agent-tests/worktree-check@1');
    expect(report.verdict).toBe('hazard-observed');
    expect(report.command).toBe('npm test');
    expect(report.baseline.passed).toBe(true);
    expect(report.rootDirty).toBe(false);
    expect(report.results).toHaveLength(4);
    const failed = report.results.flatMap(entry => [entry.root, entry.worktree]).filter(side => !side.passed);
    expect(failed.length).toBeGreaterThan(0);
    for (const side of failed) {
      expect(side.exitCode).toBe(1);
      expect(side.failureLines?.length).toBeGreaterThan(0);
      expect(side.failureLines!.length).toBeLessThanOrEqual(20);
      expect(side.failureLines!.join('\n')).toContain('FAIL shared file was overwritten');
    }
    for (const entry of report.results) expect(entry.root.durationMs).toBeGreaterThan(0);
    expect(report.cleanup).toMatchObject({ ok: true, worktreeCreated: true, worktreeRemoved: true, branchDeleted: true });
    expectNoLeftovers(root);
  });

  it('reports no-hazard-observed when each process uses its own path, and notes a dirty root', () => {
    const { base, root } = project({ 'test.js': '' });
    writeFileSync(join(root, 'test.js'), sharedFileTest(join(base, 'own-token').replace(/\\/g, '/'), true));
    git(root, 'commit', '-qam', 'unique path');
    writeFileSync(join(root, 'untracked.txt'), 'dirty\n');
    const result = check(root, '--no-install', '--runs', '2');
    expect(result.status, result.stderr).toBe(0);
    const report = reportOf(result.stdout);
    expect(report.verdict).toBe('no-hazard-observed');
    expect(report.rootDirty).toBe(true);
    expect(report.results.every(entry => entry.root.passed && entry.worktree.passed)).toBe(true);
    expectNoLeftovers(root);
  });

  it('reports baseline-failed when the command fails alone, without creating a worktree', () => {
    const { root } = project({ 'test.js': "console.error('FAIL always');\nprocess.exit(3);\n" });
    const result = check(root, '--no-install');
    expect(result.status, result.stderr).toBe(0);
    const report = reportOf(result.stdout);
    expect(report.verdict).toBe('baseline-failed');
    expect(report.baseline).toMatchObject({ passed: false, exitCode: 3 });
    expect(report.results).toEqual([]);
    expect(report.cleanup).toMatchObject({ ok: true, worktreeCreated: false });
    expectNoLeftovers(root);
  });

  it('runs a --command that is not npm test', () => {
    const { root } = project({ 'check.js': 'process.exit(0);\n' }, null);
    const result = check(root, '--no-install', '--runs', '1', '--command', 'node check.js');
    expect(result.status, result.stderr).toBe(0);
    const report = reportOf(result.stdout);
    expect(report.command).toBe('node check.js');
    expect(report.verdict).toBe('no-hazard-observed');
    expectNoLeftovers(root);
  });

  it('kills a hanging command at --timeout-seconds, exits with E_TIMEOUT and still removes the worktree and branch', () => {
    // The baseline passes and the concurrent runs hang, so the timeout fires while the worktree exists.
    const { base, root } = project({ 'test.js': '' });
    writeFileSync(
      join(root, 'test.js'),
      `
const fs = require('node:fs');
const marker = ${JSON.stringify(join(base, 'baseline-done').replaceAll('\\', '/'))};
if (!fs.existsSync(marker)) { fs.writeFileSync(marker, 'x'); process.exit(0); }
setTimeout(() => {}, 60000);
`,
    );
    git(root, 'commit', '-qam', 'hang after the baseline');
    const started = Date.now();
    const result = check(root, '--no-install', '--timeout-seconds', '1', '--runs', '1');
    expect(result.status).toBe(1);
    expect(errorOf(result.stderr).code).toBe('E_TIMEOUT');
    expect(Date.now() - started).toBeLessThan(40_000);
    expectNoLeftovers(root);
  });

  it('kills a command that hangs in the baseline run and exits with E_TIMEOUT', () => {
    const { root } = project({ 'test.js': 'setTimeout(() => {}, 60000);\n' });
    const result = check(root, '--no-install', '--timeout-seconds', '1');
    expect(result.status).toBe(1);
    expect(errorOf(result.stderr).code).toBe('E_TIMEOUT');
    expectNoLeftovers(root);
  });

  it('refuses a root that is not a git repository with E_NOT_GIT', () => {
    const base = physicalTemp('agent-tests-wc-');
    made.push(base);
    writeFileSync(join(base, 'package.json'), '{"scripts":{"test":"node test.js"}}\n');
    const result = check(base);
    expect(result.status).toBe(1);
    expect(errorOf(result.stderr).code).toBe('E_NOT_GIT');
  });

  it('fails with E_NO_TEST_COMMAND naming --command when there is no scripts.test and no --command', () => {
    const { root } = project({}, null);
    const result = check(root, '--no-install');
    expect(result.status).toBe(1);
    const error = errorOf(result.stderr);
    expect(error.code).toBe('E_NO_TEST_COMMAND');
    expect(`${error.message} ${error.hint}`).toContain('--command');
    expectNoLeftovers(root);
  });

  it.each(['11', '0', 'abc'])('rejects --runs %s with E_USAGE and exit 2', runs => {
    const { root } = project({ 'test.js': '' });
    const result = check(root, '--runs', runs);
    expect(result.status).toBe(2);
    expect(errorOf(result.stderr).code).toBe('E_USAGE');
  });

  it('accepts the worktree-check options only on worktree-check', () => {
    const { root } = project({ 'test.js': '' });
    const result = spawnSync(process.execPath, [LAUNCHER, 'scan', '--root', root, '--runs', '2'], { env: cleanEnv(), encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    expect(result.status).toBe(2);
    expect(errorOf(result.stderr).code).toBe('E_USAGE');
  });

  it('is never called by scan or report, and leaves scan output unchanged', () => {
    for (const file of ['scan.ts', 'report.ts']) expect(readFileSync(join(ROOT, 'src', file), 'utf8')).not.toContain('worktree-check');
    const { root } = project({ 'test.js': 'process.exit(0);\n' });
    const scanOf = () => spawnSync(process.execPath, [LAUNCHER, 'scan', '--root', root], { env: cleanEnv(), encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    const before = scanOf();
    expect(before.status, before.stderr).toBe(0);
    expect(check(root, '--no-install', '--runs', '1').status).toBe(0);
    expect(scanOf().stdout).toBe(before.stdout);
  });
});

describe('tokenize', () => {
  it('splits on whitespace, groups quotes and keeps Windows backslashes', () => {
    expect(tokenize('node "my script.js" --flag \'a b\' C:\\x\\y.js')).toEqual(['node', 'my script.js', '--flag', 'a b', 'C:\\x\\y.js']);
  });

  it.each(['npm test | tee out', 'a && b', 'a > out', 'echo $(date)', 'node "unterminated', '   '])('refuses %j', line => {
    expect(() => tokenize(line)).toThrowError(expect.objectContaining({ code: 'E_USAGE' }));
  });
});

describe('worktree-check cleanup hardening', () => {
  const freshCleanup = (): CleanupResult => ({ ok: true, worktreeCreated: true, worktreeRemoved: false, branchDeleted: false, errors: [], failedSteps: [] });

  it('still deletes the branch and reports the failure when removing the holder directory throws', () => {
    const { root } = project({ 'test.js': '' });
    const holder = join(root, '..', 'holder-dir');
    mkdirSync(holder);
    const worktree = join(holder, 'checkout');
    git(root, 'worktree', 'add', '-q', '-b', 'throwaway', worktree, 'HEAD');
    const calls: string[] = [];
    const real: CleanupOps = {
      removeWorktree: w => void git(root, 'worktree', 'remove', '--force', w),
      removeDirectory: () => {
        calls.push('removeDirectory');
        throw new Error('EBUSY: resource busy or locked');
      },
      prune: () => void git(root, 'worktree', 'prune'),
      worktreeListed: name => git(root, 'worktree', 'list', '--porcelain').includes(name),
      branchExists: b => git(root, 'branch', '--list', b) !== '',
      deleteBranch: b => void git(root, 'branch', '-D', b),
    };
    const cleanup = freshCleanup();
    runCleanup({ root, holder, worktree, branch: 'throwaway', branchCreated: true }, cleanup, real);
    expect(calls).toEqual(['removeDirectory']);
    expect(git(root, 'branch', '--list', 'throwaway')).toBe('');
    expect(cleanup.branchDeleted).toBe(true);
    expect(cleanup.ok).toBe(false);
    expect(cleanup.failedSteps).toEqual([{ step: 'remove holder directory', message: 'EBUSY: resource busy or locked' }]);
    expect(cleanup.errors.join(' ')).toContain('remove holder directory: EBUSY');
  });

  it('runs every step independently when each earlier step throws', () => {
    const order: string[] = [];
    const boom = (step: string) => () => {
      order.push(step);
      throw new Error(`${step} failed`);
    };
    const ops: CleanupOps = {
      removeWorktree: boom('removeWorktree'),
      removeDirectory: boom('removeDirectory'),
      prune: boom('prune'),
      worktreeListed: () => true,
      branchExists: () => true,
      deleteBranch: boom('deleteBranch'),
    };
    const cleanup = freshCleanup();
    expect(() => runCleanup({ root: 'unused', holder: join(tmpdir(), 'no-such-holder-xyz'), worktree: join(tmpdir(), 'no-such-holder-xyz', 'checkout'), branch: 'b', branchCreated: true }, cleanup, ops)).not.toThrow();
    expect(order).toEqual(['removeWorktree', 'removeDirectory', 'prune', 'deleteBranch']);
    expect(cleanup.failedSteps.map(entry => entry.step)).toEqual(['git worktree remove', 'remove holder directory', 'git worktree prune', 'git branch -D']);
    expect(cleanup.ok).toBe(false);
    expect(cleanup.branchDeleted).toBe(false);
  });

  it('does not delete a branch this run did not create', () => {
    const deleted: string[] = [];
    const ops: CleanupOps = {
      removeWorktree: () => {},
      removeDirectory: () => {},
      prune: () => {},
      worktreeListed: () => false,
      branchExists: () => true,
      deleteBranch: b => void deleted.push(b),
    };
    const cleanup = { ...freshCleanup(), worktreeCreated: false };
    runCleanup({ root: 'unused', branch: 'preexisting', branchCreated: false }, cleanup, ops);
    expect(deleted).toEqual([]);
    expect(cleanup.branchDeleted).toBe(false);
    expect(cleanup.ok).toBe(true);
  });

  it('keeps a pre-existing branch of the same name when the worktree add fails', async () => {
    const { root } = project({ 'test.js': 'process.exit(0);\n' });
    git(root, 'branch', 'preexisting-branch');
    const before = git(root, 'rev-parse', 'preexisting-branch');
    await expect(worktreeCheck({ root, runs: 1, install: false, command: 'node test.js', branchName: 'preexisting-branch' })).rejects.toMatchObject({ code: 'E_WORKTREE_FAILED' });
    expect(git(root, 'rev-parse', 'preexisting-branch')).toBe(before);
    expect(git(root, 'worktree', 'list', '--porcelain').split(/\r?\n/).filter(line => line.startsWith('worktree '))).toHaveLength(1);
  });

  it('reports an empty failedSteps list on a clean run', () => {
    const { root } = project({ 'test.js': 'process.exit(0);\n' });
    const result = check(root, '--no-install', '--runs', '1');
    expect(result.status, result.stderr).toBe(0);
    const report = reportOf(result.stdout);
    expect(report.cleanup).toMatchObject({ ok: true, branchDeleted: true, failedSteps: [] });
    expectNoLeftovers(root);
  });
});
