import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { importTimings } from '../src/timings.ts';
import { makeTree } from './helpers/tree.ts';

const cli = (root: string, ...args: string[]) => spawnSync(process.execPath, ['scripts/tests.mjs', 'report', '--root', root, ...args], { encoding: 'utf8', windowsHide: true });
const suite = (name: string, startTime: number, endTime: number, status = 'passed') => ({ name, startTime, endTime, status });
const clean = "test('adds', () => expect(add(2, 3)).toBe(5))";
it('sorts measured suites across the whole inventory before capping, preserving static detail and input identity', () => {
  const rows = [suite('slow.test.ts', 1000, 12640), suite('fast.test.ts', 1100, 1360, 'failed'), suite('zero.test.ts', 99, 99),
    suite('tie.test.ts', 50, 310), suite('dup.test.ts', 1, 2), suite('dup.test.ts', 2, 3), suite('../other/slow.test.ts', 1, 2),
    suite('never.test.ts', 0, 1), suite('negative.test.ts', 2, 1), { name: 'missing.test.ts' }, suite('skip.test.ts', 1, 2, 'pending')];
  const input = JSON.stringify({ testResults: rows });
  const root = makeTree({ 'package.json': JSON.stringify({ scripts: { test: 'vitest', pretest: 'vitest run' } }), 'slow.test.ts': clean, 'fast.test.ts': "test('reads legacy data', () => expect(true).toBe(true))", 'zero.test.ts': clean,
    'tie.test.ts': clean, 'dup.test.ts': clean, 'unknown.test.ts': clean, 'run.json': input });
  const report = cli(root, '--timings', 'run.json');
  expect(report.status, report.stderr).toBe(0);
  const measured = report.stdout;
  expect(measured).toMatch(/matched files: 4.*unmatched rows: 1.*invalid rows: 3.*skipped rows: 1.*ambiguous files: 1/i);
  const table = measured.split('## Test files')[1]!.split('##')[0]!;
  expect(table).toMatch(/slow\.test\.ts[^\n]*11640[\s\S]+fast\.test\.ts[^\n]*260[^\n]*failed[\s\S]+tie\.test\.ts[^\n]*260[\s\S]+zero\.test\.ts[^\n]*\| 0 \|/);
  const capped = cli(root, '--timings', 'run.json', '--max-files', '1').stdout;
  expect(capped).toContain('frequency.watch-default');
  expect(capped).toContain('shim.title-marker');
  expect(capped).toContain('| slow.test.ts |');
  expect(capped).not.toContain('| fast.test.ts |');
  expect(capped).toMatch(/omitted[^\n]*runner JSON[^\n]*scan/i);
  expect(capped).toContain(createHash('sha256').update(input).digest('hex'));
  const untimed = cli(root, '--max-files', '1').stdout;
  expect(untimed).toContain('| fast.test.ts |');
  expect(untimed).toContain('Wait time and CI minutes need a timed run');
});

it.each(['vitest', 'jest'])('reads the portable %s JSON reporter capture', runner => {
  const root = makeTree({ 'sample.test.js': clean });
  const capture = JSON.parse(readFileSync(join('tests/fixtures/timings', runner + '.json'), 'utf8'));
  capture.testResults[0].name = capture.testResults[0].name.replace(/^<root>(?=\/)/, root.replaceAll('\\', '/'));
  const inputRoot = makeTree({ 'run.json': JSON.stringify(capture) });
  const report = cli(root, '--timings', join(inputRoot, 'run.json'));
  expect(report.status, report.stderr).toBe(0);
  expect(report.stdout).toContain('Matched files: 1');
  expect(report.stdout).toContain(`| sample.test.js | ${capture.testResults[0].endTime - capture.testResults[0].startTime} | passed |`);
});

it('guides a slow-suite audit to a saved run and documents collection with either runner', () => {
  const skill = readFileSync('skills/test-audit/SKILL.md', 'utf8');
  expect(skill).toMatch(/existing.*(?:saved|JSON).*report/i);
  expect(skill).toContain('--timings');
  expect(skill).toMatch(/static order.*unparsed/i);
  expect(readFileSync('references/audit-output.md', 'utf8')).toMatch(/vitest run --reporter=json[\s\S]+jest --json/);
});

it('saves the measured view with timing identity while preserving existing evidence', () => {
  const input = JSON.stringify({testResults: [suite('sample.test.js', 50, 100)]});
  const root = makeTree({ 'package.json': JSON.stringify({ scripts: { test: 'vitest', pretest: 'vitest run' } }), 'other.test.js': clean, 'sample.test.js': clean, 'run.json': input, 'unsupported.json': '{}', 'broken.json': '{' });
  const args = ['--timings', 'run.json', '--max-files', '1'];
  const stdout = cli(root, ...args).stdout;
  const saved = cli(root, ...args, '--out', 'audit.md');
  expect(saved.status, saved.stderr).toBe(0);
  const artifact = readFileSync(join(root, 'audit.md'), 'utf8');
  expect(artifact).toContain(stdout.trimEnd().split('## Test files')[1]);
  expect(artifact).toMatch(/## Project findings \([2-9]\d*\)/);
  expect(artifact).toMatch(/omitted[^\n]*runner JSON[^\n]*scan/i);
  const identity = JSON.parse(artifact.split('```json')[1]!.split('```')[0]!);
  expect(identity.options.timingsSha256).toBe(createHash('sha256').update(input).digest('hex'));
  expect(identity.limits.join(' ')).toMatch(/imported file intervals/i);
  expect(JSON.parse(saved.stdout).sha256).toBe(createHash('sha256').update(artifact).digest('hex'));
  expect(cli(root, ...args, '--out', 'audit.md').status).toBe(1);
  expect(readFileSync(join(root, 'audit.md'), 'utf8')).toBe(artifact);
  for (const bad of ['unsupported.json', 'broken.json', 'missing.json', '.']) {
    const result = cli(root, '--timings', bad, '--out', 'bad.md');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr).error.code).toBe('E_TIMINGS');
    expect(result.stdout).toBe('');
    expect(existsSync(join(root, 'bad.md'))).toBe(false);
  }
});

it('rejects missing, repeated and misplaced flags', () => {
  for (const args of [['report','--write','--timings','tests/fixtures/timings/jest.json'],['scan','--timings','x'],['report','--timings'],['report','--timings','x','--timings','y']]) {
    const result = spawnSync(process.execPath, ['scripts/tests.mjs', ...args], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr).error.code).toBe('E_USAGE');
  }
});
it('reports empty and foreign-only runs without inferring measurements or resolving basename aliases', () => {
  const root = makeTree({ 'empty.json': '{"testResults":[]}', 'foreign.json': JSON.stringify({testResults: [
    suite('/other/checkout/nested/sample.test.js', 1, 2), suite('D:/elsewhere/nested/sample.test.js', 1, 2), suite('sample.test.js', 1, 2),
  ]}) });
  const inventory = [{file: 'nested/sample.test.js'}];
  for (const [file, count] of [['empty.json', 0], ['foreign.json', 3]] as const) {
    const result = importTimings(root, file, inventory);
    expect(result.files.size).toBe(0);
    expect(result.unmatched).toBe(count);
    expect(result.outcome).toBe('unknown');
  }
});

it.skipIf(process.platform === 'win32')('declines colliding native POSIX and normalized names', () => {
  const root = makeTree({});
  const input = makeTree({ 'run.json': JSON.stringify({testResults: [suite(join(root, 'a\\b.test.js'), 1, 2)]}) });
  const inventory = [{file: 'a/b.test.js'}, {file: 'a\\b.test.js'}];
  const result = importTimings(root, join(input, 'run.json'), inventory);
  expect(result.files.size).toBe(0);
  expect(result.ambiguous).toBe(2);
  const exact = importTimings(root, join(input, 'run.json'), inventory.slice(1));
  expect([...exact.files.keys()]).toEqual(['a\\b.test.js']);
});

it('validates the timing input before starting the project scan', () => {
  const root = makeTree({ 'bad.json': '{}', '.testing/risk.yml': 'invalid: [' });
  const result = cli(root, '--timings', 'bad.json', '--out', 'audit.md');
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stderr).error.code).toBe('E_TIMINGS');
  expect(result.stdout).toBe('');
  expect(existsSync(join(root, 'audit.md'))).toBe(false);
});
