/**
 * @lane merge
 * @subject src/cli.ts
 * @subject scripts/tests.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeTree } from './helpers/tree.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');

const tests = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'tests.mjs'), ...args], { encoding: 'utf8', windowsHide: true });

describe('tests CLI', () => {
  it('prints capabilities as JSON', () => {
    const result = tests('capabilities');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ name: 'agent-tests', commands: ['capabilities', 'risk-draft', 'scan', 'report'] });
  });

  it('rejects an unknown command with E_USAGE and exit 2', () => {
    const result = tests('frobnicate');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr).error.code).toBe('E_USAGE');
  });

  it('rejects an unknown flag with E_USAGE', () => {
    const result = tests('scan', '--bogus');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr).error.code).toBe('E_USAGE');
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
    expect(JSON.parse(result.stderr).error.code).toBe('E_RISKMAP');
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

    const again = tests('risk-draft', '--root', root, '--write');
    expect(again.status).toBe(1);
    expect(JSON.parse(again.stderr).error.code).toBe('E_EXISTS');
  });

  it('rejects a root that does not exist', () => {
    const result = tests('scan', '--root', join(ROOT, 'no-such-directory'));
    expect(result.status).toBe(2);
  });

  it('report --max-files caps the test-file table and says how many were omitted', () => {
    const result = tests('report', '--root', join(FIXTURES, 'bloated'), '--max-files', '1');
    expect(result.status).toBe(0);
    const section = result.stdout.split('\n## Test files')[1]!.split('\n## ')[0]!;
    const rows = section.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| File ') && !line.startsWith('|---'));
    expect(rows).toHaveLength(1);
    expect(result.stdout).toMatch(/\d+ more files omitted/);
  });

  it('report --max-per-rule is accepted', () => {
    const result = tests('report', '--root', join(FIXTURES, 'bloated'), '--max-per-rule', '1');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('# Test audit evidence');
  });

  it.each([
    ['--max-files', '0'],
    ['--max-files', 'abc'],
    ['--max-files=-1', ''],
    ['--max-files', '1.5'],
    ['--max-per-rule', '0'],
    ['--max-per-rule', 'abc'],
    ['--max-per-rule=-2', ''],
  ])('report rejects %s %s with E_USAGE and exit 2', (flag, value) => {
    const result = tests('report', '--root', join(FIXTURES, 'clean'), flag, ...(value ? [value] : []));
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr).error.code).toBe('E_USAGE');
  });

  it('names the offending option in the message', () => {
    const result = tests('report', '--root', join(FIXTURES, 'clean'), '--max-files', '0');
    expect(JSON.parse(result.stderr).error.message).toContain('--max-files must be a positive integer');
  });

  it('scan ignores --max-files and still prints the full JSON', () => {
    const result = tests('scan', '--root', join(FIXTURES, 'bloated'), '--max-files', '3');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).schema).toBe('agent-tests/evidence@1');
  });
});
