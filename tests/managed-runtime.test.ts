import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkDependencies, describeSource, installRuntime, inspectInstallation, resolveRuntime } from '../scripts/managed-runtime.js';
import { makeTree } from './helpers/tree.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const source = (extra: Record<string, string> = {}): string =>
  makeTree({
    'package.json': JSON.stringify({ name: 'agent-tests', version: '1.2.3' }),
    'package-lock.json': JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }),
    'scripts/tests.mjs': 'console.log("hi");\n',
    'src/cli.ts': 'export const x = 1;\n',
    ...extra,
  });

const fakes = { npm: () => '', checkDependencies: () => {} };

describe('describeSource', () => {
  it('fingerprints the runtime files and names a release key', () => {
    const described = describeSource(source());
    expect(described.version).toBe('1.2.3');
    expect(described.files).toEqual(['package.json', 'package-lock.json', 'scripts/tests.mjs', 'src/cli.ts']);
    expect(described.key).toMatch(/^1\.2\.3-[0-9a-f]{16}-/);
  });

  it('ignores line-ending differences in text files', () => {
    const lf = describeSource(source({ 'src/cli.ts': 'a\nb\n' }));
    const crlf = describeSource(source({ 'src/cli.ts': 'a\r\nb\r\n' }));
    expect(crlf.fingerprint).toBe(lf.fingerprint);
  });

  it('changes the fingerprint when source changes', () => {
    expect(describeSource(source({ 'src/cli.ts': 'a' })).fingerprint).not.toBe(describeSource(source({ 'src/cli.ts': 'b' })).fingerprint);
  });

  it('rejects a lockfile whose version differs from package.json', () => {
    const root = source({ 'package-lock.json': JSON.stringify({ version: '9.9.9', packages: { '': { version: '9.9.9' } } }) });
    expect(() => describeSource(root)).toThrow(/lockfile version mismatch/);
  });

  it('rejects a plugin manifest whose version differs from package.json', () => {
    const root = source({ '.claude-plugin/plugin.json': JSON.stringify({ name: 'agent-tests', version: '0.0.1' }) });
    expect(() => describeSource(root)).toThrow(/version mismatch/);
  });

  it('covers tsconfig, skills and references but not docs, tests or node_modules', () => {
    const described = describeSource(source({
      'tsconfig.json': '{}',
      'skills/audit/SKILL.md': '# skill\n',
      'references/doctrine.md': '# doctrine\n',
      'docs/plan.md': '# plan\n',
      'tests/a.test.ts': 'export {};\n',
      'node_modules/dep/index.js': 'module.exports = 1;\n',
    }));
    expect(described.files).toContain('tsconfig.json');
    expect(described.files).toContain('skills/audit/SKILL.md');
    expect(described.files).toContain('references/doctrine.md');
    expect(described.files.filter(name => /^(docs|tests|node_modules)\//.test(name))).toEqual([]);
  });

  it('ignores editor and OS litter, so it neither ships nor changes the fingerprint', () => {
    const plain = describeSource(source());
    const littered = describeSource(source({ 'src/.DS_Store': 'x', 'src/Thumbs.db': 'x', 'src/cli.ts~': 'x' }));
    expect(littered.files).toEqual(plain.files);
    expect(littered.fingerprint).toBe(plain.fingerprint);
  });
});

describe('resolveRuntime', () => {
  it('says to run tests-setup when nothing is installed', () => {
    expect(() => resolveRuntime(source(), { home: makeTree() })).toThrow(/tests-setup/);
  });

  it('refuses a home inside the plugin checkout', () => {
    const root = source();
    expect(() => resolveRuntime(root, { home: join(root, 'home') })).toThrow(/outside the plugin/);
  });

  it('refuses a home that contains the plugin checkout', () => {
    const root = source();
    expect(() => resolveRuntime(root, { home: dirname(root) })).toThrow(/outside the plugin/);
  });
});

describe('installRuntime', () => {
  it('copies the runtime, writes a receipt, and resolves afterwards', () => {
    const root = source();
    const home = makeTree();
    const installed = installRuntime(root, { home, ...fakes });
    expect(existsSync(join(installed.root, 'managed-install.json'))).toBe(true);
    expect(readFileSync(join(installed.root, 'scripts', 'tests.mjs'), 'utf8')).toContain('hi');
    expect(resolveRuntime(root, { home }).key).toBe(installed.key);
    expect(existsSync(join(home, 'setup.lock'))).toBe(false);
  });

  it('is idempotent', () => {
    const root = source();
    const home = makeTree();
    installRuntime(root, { home, ...fakes });
    expect(() => installRuntime(root, { home, ...fakes })).not.toThrow();
  });

  it('refuses to run while another setup holds the lock', () => {
    const root = source();
    const home = makeTree({ 'setup.lock': '{}' });
    expect(() => installRuntime(root, { home, ...fakes })).toThrow(/Another setup may be running/);
  });

  it('keeps a live setup lock when it refuses, and names the owner', () => {
    const root = source();
    const started = '2026-01-02T03:04:05.000Z';
    const home = makeTree({ 'setup.lock': JSON.stringify({ pid: process.pid, started }) });
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => installRuntime(root, { home, ...fakes })).toThrow(new RegExp(`Another setup may be running.*${process.pid}.*${started}`));
      expect(existsSync(join(home, 'setup.lock'))).toBe(true);
    }
  });

  it('refuses an unreadable lock and leaves it on disk', () => {
    const root = source();
    const home = makeTree({ 'setup.lock': 'not json' });
    expect(() => installRuntime(root, { home, ...fakes })).toThrow(/Another setup may be running/);
    expect(readFileSync(join(home, 'setup.lock'), 'utf8')).toBe('not json');
  });

  it('reclaims a lock left by an exited process and sweeps abandoned staging directories', () => {
    const root = source();
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    const home = makeTree({ 'setup.lock': JSON.stringify({ pid: gone, started: '2026-01-01T00:00:00.000Z' }) });
    mkdirSync(join(home, 'releases', '.install-abc'), { recursive: true });
    const installed = installRuntime(root, { home, ...fakes });
    expect(existsSync(join(installed.root, 'managed-install.json'))).toBe(true);
    expect(existsSync(join(home, 'setup.lock'))).toBe(false);
    expect(readdirSync(join(home, 'releases')).filter(name => name.startsWith('.install-'))).toEqual([]);
  });

  it('installs production dependencies from the lockfile', () => {
    const calls: string[][] = [];
    installRuntime(source(), { home: makeTree(), npm: (args: string[]) => { calls.push(args); return ''; }, checkDependencies: () => {} });
    expect(calls[0]?.slice(0, 2)).toEqual(['ci', '--omit=dev']);
  });

  it('cleans its staging directory and lock when dependency checks fail', () => {
    const root = source();
    const home = makeTree();
    const failing = { npm: () => '', checkDependencies: () => { throw new Error('missing zod'); } };
    expect(() => installRuntime(root, { home, ...failing })).toThrow(/missing zod/);
    expect(existsSync(join(home, 'setup.lock'))).toBe(false);
    expect(readdirSync(join(home, 'releases')).filter(name => name.startsWith('.install-'))).toEqual([]);
  });

  it('never reinstalls inside a live release whose dependencies fail the check', () => {
    const root = source();
    const home = makeTree();
    installRuntime(root, { home, ...fakes });
    const calls: string[][] = [];
    const broken = { npm: (args: string[]) => { calls.push(args); return ''; }, checkDependencies: () => { throw new Error('missing zod'); } };
    expect(() => installRuntime(root, { home, ...broken })).toThrow(/Move this release directory aside and rerun tests-setup/);
    expect(() => installRuntime(root, { home, ...broken })).toThrow(/missing zod/);
    expect(calls).toEqual([]);
    expect(existsSync(join(home, 'setup.lock'))).toBe(false);
  });

  it('detects a tampered release', () => {
    const root = source();
    const home = makeTree();
    const installed = installRuntime(root, { home, ...fakes });
    writeFileSync(join(installed.root, 'src', 'cli.ts'), 'tampered');
    expect(() => resolveRuntime(root, { home })).toThrow(/modified or version mismatch/);
  });
});

describe('inspectInstallation', () => {
  it('reports ok after install and the problem before', () => {
    const root = source();
    const home = makeTree();
    expect(inspectInstallation(root, { home, checkDependencies: () => {} }).ok).toBe(false);
    installRuntime(root, { home, ...fakes });
    const report = inspectInstallation(root, { home, checkDependencies: () => {} });
    expect(report).toMatchObject({ ok: true, pluginVersion: '1.2.3', cliVersion: '1.2.3', dependencies: true });
  });
});

describe('checkDependencies', () => {
  it('fails with a concise message that does not echo the probe source', () => {
    let message = '';
    try { checkDependencies(makeTree()); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/^Dependency check failed: /);
    expect(message).not.toContain('openParseSession');
  });
});

describe('launcher contract', () => {
  const run = (script: string, args: string[], home: string) =>
    spawnSync(process.execPath, [join(repoRoot, 'scripts', script), ...args], { encoding: 'utf8', env: { ...process.env, AGENT_TESTS_HOME: home } });
  const errorOf = (stderr: string) => {
    expect(stderr.trim().split('\n')).toHaveLength(1);
    return JSON.parse(stderr).error;
  };

  it('setup.js rejects unknown flags with E_USAGE and exit 2', () => {
    const result = run('setup.js', ['--bogus'], makeTree());
    expect(result.status).toBe(2);
    expect(errorOf(result.stderr).code).toBe('E_USAGE');
  });

  it('setup.js --check --json reports ok:false on stdout and exits 1 when nothing is installed', () => {
    const result = run('setup.js', ['--check', '--json'], makeTree());
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
  });

  it('setup.js reports an install failure as E_SETUP_FAILED without the circular hint', () => {
    const home = makeTree({ 'setup.lock': JSON.stringify({ pid: process.pid, started: '2026-01-02T03:04:05.000Z' }) });
    const result = run('setup.js', [], home);
    expect(result.status).toBe(1);
    const error = errorOf(result.stderr);
    expect(error.code).toBe('E_SETUP_FAILED');
    expect(error.message).toMatch(/Another setup may be running/);
    expect(error.hint).toMatch(/^Fix the cause in the message, then rerun node /);
    expect(error.hint).not.toContain('tests-setup skill');
  });

  it('run-managed.js reports a missing runtime as E_RUNTIME_MISSING and exit 1', () => {
    const result = run('run-managed.js', ['capabilities'], makeTree());
    expect(result.status).toBe(1);
    expect(errorOf(result.stderr).code).toBe('E_RUNTIME_MISSING');
  });
});
