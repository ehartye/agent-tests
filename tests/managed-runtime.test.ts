import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeSource, installRuntime, inspectInstallation, resolveRuntime } from '../scripts/managed-runtime.js';
import { makeTree } from './helpers/tree.ts';

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
});

describe('resolveRuntime', () => {
  it('says to run tests-setup when nothing is installed', () => {
    expect(() => resolveRuntime(source(), { home: makeTree() })).toThrow(/tests-setup/);
  });

  it('refuses a home inside the plugin checkout', () => {
    const root = source();
    expect(() => resolveRuntime(root, { home: join(root, 'home') })).toThrow(/outside the plugin/);
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

  it('cleans its staging directory and lock when dependency checks fail', () => {
    const root = source();
    const home = makeTree();
    const failing = { npm: () => '', checkDependencies: () => { throw new Error('missing zod'); } };
    expect(() => installRuntime(root, { home, ...failing })).toThrow(/missing zod/);
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
