/**
 * @lane merge
 * @subject src/cli.ts
 * @subject scripts/tests.mjs
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { failureFor, ignoreBrokenPipe, positiveInteger } from '../src/cli.ts';
import { CliError } from '../src/errors.ts';
import { makeTree } from './helpers/tree.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');

interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  launcher?: string;
}

const run = (options: RunOptions, ...args: string[]) =>
  spawnSync(process.execPath, [options.launcher ?? join(ROOT, 'scripts', 'tests.mjs'), ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: { ...process.env, AGENT_TESTS_DEBUG: '', ...options.env },
  });
const tests = (...args: string[]) => run({}, ...args);

/** The parsed error object, after asserting stderr is exactly one JSON line. */
function errorOf(stderr: string): { code: string; message: string; hint?: string; detail?: string } {
  const lines = stderr.trimEnd().split('\n');
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!).error;
}

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

const canSymlink = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-tests-symlink-'));
  try {
    symlinkSync(join(dir, 'nowhere'), join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

describe('tests CLI', () => {
  it('prints capabilities as JSON, with the package version', () => {
    const result = tests('capabilities');
    expect(result.status).toBe(0);
    const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
    expect(JSON.parse(result.stdout)).toMatchObject({ name: 'agent-tests', version, commands: ['capabilities', 'risk-draft', 'scan', 'report'] });
  });

  it('rejects an unknown command with E_USAGE and exit 2', () => {
    const result = tests('frobnicate');
    expect(result.status).toBe(2);
    expect(errorOf(result.stderr).code).toBe('E_USAGE');
  });

  it('rejects an unknown flag with E_USAGE', () => {
    const result = tests('scan', '--bogus');
    expect(result.status).toBe(2);
    expect(errorOf(result.stderr).code).toBe('E_USAGE');
  });

  it('scan prints evidence JSON', () => {
    const result = tests('scan', '--root', join(FIXTURES, 'clean'));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).schema).toBe('agent-tests/evidence@1');
  });

  it('report prints Markdown', () => {
    const result = tests('report', '--root', join(FIXTURES, 'bloated'));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('# Test audit evidence');
  });

  it('reports an invalid risk map as E_RISKMAP', () => {
    const result = tests('scan', '--root', makeTree({ '.testing/risk.yml': 'phase: nope\n' }));
    expect(result.status).toBe(1);
    expect(errorOf(result.stderr).code).toBe('E_RISKMAP');
  });

  it('risk-draft prints YAML, and --write creates the file once', () => {
    const root = makeTree({ 'src/auth/a.ts': '', 'src/ui/b.ts': '' });
    const preview = tests('risk-draft', '--root', root);
    expect(preview.status).toBe(0);
    expect(preview.stdout).toContain('src/auth/**');
    expect(existsSync(join(root, '.testing', 'risk.yml'))).toBe(false);

    const written = tests('risk-draft', '--root', root, '--write');
    expect(written.status).toBe(0);
    expect(existsSync(join(root, '.testing', 'risk.yml'))).toBe(true);
    expect(readdirSync(join(root, '.testing'))).toEqual(['risk.yml']);

    const again = tests('risk-draft', '--root', root, '--write');
    expect(again.status).toBe(1);
    expect(errorOf(again.stderr).code).toBe('E_EXISTS');
  });

  it('rejects a root that does not exist with E_USAGE', () => {
    const missing = join(ROOT, 'no-such-directory');
    const result = tests('scan', '--root', missing);
    expect(result.status).toBe(2);
    const error = errorOf(result.stderr);
    expect(error.code).toBe('E_USAGE');
    expect(error.message).toBe(`Root does not exist: ${missing}`);
  });

  describe('roots', () => {
    it('rejects a file root on scan, report and risk-draft', () => {
      const file = join(makeTree({ 'a-file.txt': 'x' }), 'a-file.txt');
      for (const command of ['scan', 'report', 'risk-draft']) {
        const result = tests(command, '--root', file);
        expect(result.status, command).toBe(2);
        const error = errorOf(result.stderr);
        expect(error.code).toBe('E_USAGE');
        expect(error.message).toBe(`Root is not a directory: ${file}`);
      }
    });

    it.each([[['--root=']], [['--root', '']]])('rejects an empty root (%j)', args => {
      const result = tests('scan', ...args);
      expect(result.status).toBe(2);
      const error = errorOf(result.stderr);
      expect(error.code).toBe('E_USAGE');
      expect(error.message).toBe('--root needs a directory');
    });

    it('treats a root path that runs through a file as a missing root', () => {
      const file = join(makeTree({ 'a-file.txt': 'x' }), 'a-file.txt');
      const result = tests('scan', '--root', join(file, 'sub'));
      expect(result.status).toBe(2);
      expect(errorOf(result.stderr).code).toBe('E_USAGE');
    });

    it('accepts --root=<dir>', () => {
      const result = tests('scan', `--root=${join(FIXTURES, 'clean')}`);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).schema).toBe('agent-tests/evidence@1');
    });

    it('accepts a root whose path has spaces', () => {
      const root = join(scratchDir('agent tests '), 'my project');
      mkdirSync(root);
      const result = tests('scan', '--root', root);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).root).toBe(root);
    });

    it('resolves a relative root against the working directory', () => {
      const result = run({ cwd: FIXTURES }, 'scan', '--root', 'clean');
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).root).toBe(join(FIXTURES, 'clean'));
    });
  });

  describe('report caps', () => {
    it('--max-files caps the test-file table and says how many were omitted', () => {
      const result = tests('report', '--root', join(FIXTURES, 'bloated'), '--max-files', '1');
      expect(result.status).toBe(0);
      const section = result.stdout.split('\n## Test files')[1]!.split('\n## ')[0]!;
      const rows = section.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| File ') && !line.startsWith('|---'));
      expect(rows).toHaveLength(1);
      expect(result.stdout).toMatch(/\d+ more files omitted/);
    });

    it('--max-per-rule is accepted', () => {
      const result = tests('report', '--root', join(FIXTURES, 'bloated'), '--max-per-rule', '1');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('# Test audit evidence');
    });

    it('rejects a bad --max-files end to end', () => {
      const result = tests('report', '--root', join(FIXTURES, 'clean'), '--max-files', '0');
      expect(result.status).toBe(2);
      const error = errorOf(result.stderr);
      expect(error.code).toBe('E_USAGE');
      expect(error.message).toContain('--max-files must be a positive integer');
    });

    it('rejects a bad --max-per-rule end to end', () => {
      const result = tests('report', '--root', join(FIXTURES, 'clean'), '--max-per-rule=abc');
      expect(result.status).toBe(2);
      const error = errorOf(result.stderr);
      expect(error.code).toBe('E_USAGE');
      expect(error.message).toContain('--max-per-rule must be a positive integer');
    });

    it('scan ignores --max-files: the output is the same with and without it', () => {
      const root = join(FIXTURES, 'bloated');
      const plain = tests('scan', '--root', root);
      const flagged = tests('scan', '--root', root, '--max-files', '3');
      expect(plain.status).toBe(0);
      expect(flagged.status).toBe(0);
      expect(JSON.parse(flagged.stdout)).toEqual(JSON.parse(plain.stdout));
    });
  });

  describe('positiveInteger', () => {
    it('returns undefined when the option is absent', () => {
      expect(positiveInteger('max-files', undefined)).toBeUndefined();
    });

    it.each([
      ['1', 1],
      ['40', 40],
      ['007', 7],
    ])('accepts %s', (raw, value) => {
      expect(positiveInteger('max-files', raw)).toBe(value);
    });

    it.each(['0', 'abc', '-1', '1.5', '', ' 3', '1e3', '99999999999999999999'])('rejects "%s" with E_USAGE naming the option', raw => {
      const failure = (() => {
        try {
          positiveInteger('max-per-rule', raw);
        } catch (error) {
          return error;
        }
      })();
      expect(failure).toBeInstanceOf(CliError);
      expect((failure as CliError).code).toBe('E_USAGE');
      expect((failure as CliError).message).toContain('--max-per-rule must be a positive integer');
    });
  });

  describe('risk-draft --write', () => {
    it('leaves an existing risk map untouched, byte for byte', () => {
      const original = '# hand written\nphase: dev\r\n';
      const root = makeTree({ '.testing/risk.yml': original, 'src/auth/a.ts': '' });
      const result = tests('risk-draft', '--root', root, '--write');
      expect(result.status).toBe(1);
      expect(errorOf(result.stderr).code).toBe('E_EXISTS');
      expect(readFileSync(join(root, '.testing', 'risk.yml'), 'utf8')).toBe(original);
      expect(readdirSync(join(root, '.testing'))).toEqual(['risk.yml']);
    });

    it.skipIf(!canSymlink)('treats a dangling symlink at the target as existing and does not write through it', () => {
      const root = makeTree({ 'src/auth/a.ts': '' });
      mkdirSync(join(root, '.testing'));
      const outside = join(root, 'elsewhere.yml');
      symlinkSync(outside, join(root, '.testing', 'risk.yml'));
      const result = tests('risk-draft', '--root', root, '--write');
      expect(result.status).toBe(1);
      expect(errorOf(result.stderr).code).toBe('E_EXISTS');
      expect(existsSync(outside)).toBe(false);
      expect(lstatSync(join(root, '.testing', 'risk.yml')).isSymbolicLink()).toBe(true);
      expect(readdirSync(join(root, '.testing'))).toEqual(['risk.yml']);
    });

    it('reports E_EXISTS when .testing is a file', () => {
      const root = makeTree({ '.testing': 'not a directory', 'src/auth/a.ts': '' });
      const result = tests('risk-draft', '--root', root, '--write');
      expect(result.status).toBe(1);
      const error = errorOf(result.stderr);
      expect(error.code).toBe('E_EXISTS');
      expect(error.message).toBe('.testing exists and is not a directory');
      expect(readFileSync(join(root, '.testing'), 'utf8')).toBe('not a directory');
    });
  });

  describe('error contract', () => {
    it('E_USAGE carries the usage string as its hint', () => {
      const error = errorOf(tests('frobnicate').stderr);
      expect(error.hint).toMatch(/^Usage: tests </);
      expect(error.hint).toContain('--max-files <n>');
      expect(error.hint).toContain('--max-per-rule <n>');
    });

    it('E_RISKMAP hints at fixing or deleting the risk map', () => {
      const error = errorOf(tests('scan', '--root', makeTree({ '.testing/risk.yml': 'phase: nope\n' })).stderr);
      expect(error.hint).toBe('Fix or delete .testing/risk.yml, then rerun');
    });

    it('E_EXISTS hints at deleting the file', () => {
      const root = makeTree({ '.testing/risk.yml': 'phase: dev\n' });
      const error = errorOf(tests('risk-draft', '--root', root, '--write').stderr);
      expect(error.hint).toBe('Delete the file first if you want a fresh draft');
    });

    it('failureFor appends a Node error code to an internal error and keeps the detail out by default', () => {
      const cause = Object.assign(new Error('boom'), { code: 'ENOTDIR' });
      expect(failureFor(cause, {})).toEqual({ code: 'E_INTERNAL', message: 'boom [ENOTDIR]' });
    });

    it('failureFor leaves the message alone when there is no Node code, and handles non-Error throws', () => {
      expect(failureFor(new Error('plain'), {}).message).toBe('plain');
      expect(failureFor('text', {})).toMatchObject({ code: 'E_INTERNAL', message: 'text' });
    });

    it('failureFor adds the stack as detail only when AGENT_TESTS_DEBUG is set', () => {
      const error = new Error('boom');
      expect(failureFor(error, { AGENT_TESTS_DEBUG: '1' }).detail).toBe(error.stack);
      expect(failureFor(error, { AGENT_TESTS_DEBUG: '' }).detail).toBeUndefined();
    });

    it('failureFor keeps a CliError as is, with the hint for its code', () => {
      expect(failureFor(new CliError('E_EXISTS', 'there'), {})).toEqual({ code: 'E_EXISTS', message: 'there', hint: 'Delete the file first if you want a fresh draft' });
      expect(failureFor(new CliError('E_X', 'own', 'my hint'), {})).toEqual({ code: 'E_X', message: 'own', hint: 'my hint' });
      expect(failureFor(new CliError('E_X', 'no hint'), {})).toEqual({ code: 'E_X', message: 'no hint' });
    });

    it('adds the stack as one escaped detail string only in debug mode, still on one line', () => {
      const root = makeTree({ '.testing/risk.yml/inner': 'the risk map path is a directory' });
      const plain = tests('scan', '--root', root);
      expect(plain.status).toBe(1);
      expect(errorOf(plain.stderr).code).toBe('E_RISKMAP');
      expect(errorOf(plain.stderr).detail).toBeUndefined();

      const debug = run({ env: { AGENT_TESTS_DEBUG: '1' } }, 'scan', '--root', root);
      expect(debug.status).toBe(1);
      expect(errorOf(debug.stderr).detail).toBeTypeOf('string');
    });
  });

  describe('broken pipes', () => {
    it('ignoreBrokenPipe exits quietly with 0 on EPIPE', () => {
      const exit = vi.fn();
      ignoreBrokenPipe(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }), exit);
      expect(exit).toHaveBeenCalledWith(0);
    });

    it('ignoreBrokenPipe rethrows any other error', () => {
      const exit = vi.fn();
      const other = Object.assign(new Error('disk on fire'), { code: 'EIO' });
      expect(() => ignoreBrokenPipe(other, exit)).toThrow(other);
      expect(exit).not.toHaveBeenCalled();
    });
  });

  describe('launcher', () => {
    it('reports a runtime that cannot load as one E_RUNTIME_BROKEN line', () => {
      const copy = scratchDir('agent-tests-nodeps-');
      for (const entry of ['scripts', 'src', 'package.json']) cpSync(join(ROOT, entry), join(copy, entry), { recursive: true });
      expect(existsSync(join(copy, 'node_modules'))).toBe(false);
      const result = run({ launcher: join(copy, 'scripts', 'tests.mjs') }, 'capabilities');
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      const error = errorOf(result.stderr);
      expect(error.code).toBe('E_RUNTIME_BROKEN');
      expect(error.message).not.toContain('\n');
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.hint).toBe('Run the tests-setup skill to repair the managed runtime');
    });
  });
});
