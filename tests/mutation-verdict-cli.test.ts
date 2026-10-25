/** @lane merge
 * @subject scripts/mutation-verdict-cli.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { physicalTemp } from './helpers/physical-temp.ts';

const cli = fileURLToPath(new URL('../scripts/mutation-verdict-cli.mjs', import.meta.url));
const made: string[] = [];
afterEach(() => { for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true }); });
const invoke = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, timeout: 5000 });

describe('explicit read-only mutation helper admission', () => {
  it.each([
    [], ['classify'], ['classify', '--input'], ['classify', '--input=absent.json'],
    ['classify', '--input', 'relative.json'], ['classify', '--input', '/absent', '--input', '/other'],
    ['classify', '--input', '/absent', '--', '--reporter'], ['classify', '--out', '/absent'],
    ['apply', '--input', '/absent'], ['run', '--input', '/absent'], ['reuse', '--input', '/absent'],
  ].map(args => ({ args })))('refuses invalid arguments before evidence reads: $args', ({ args }) => {
    const result = invoke(...args);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: 'E_MUTATION_INPUT' } });
  });
  it('returns a valid unclassified diagnostic without changing the input or suggesting success', () => {
    const directory = physicalTemp('tests-mutation-cli-'); made.push(directory);
    const input = join(directory, 'bundle.json');
    const original = JSON.stringify({ schema: 'agent-tests/mutation-evidence@1', caseId: 'old-consumer', files: [], legacy: { claims: { killed: 76, reused: 74, fresh: 2 }, newFullBatchRun: false } });
    writeFileSync(input, original);
    const result = invoke('classify', '--input', input);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ caseId: 'old-consumer', verdict: 'unclassified', historical: { newFullBatchRun: false } });
    expect(result.stderr).toBe(''); expect(readFileSync(input, 'utf8')).toBe(original);
  });
  it('distinguishes malformed evidence from valid unknown acquisition', () => {
    const directory = physicalTemp('tests-mutation-cli-'); made.push(directory);
    const input = join(directory, 'bundle.json'); writeFileSync(input, '{');
    const result = invoke('classify', '--input', input);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stdout).toBe(''); expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: 'E_MUTATION_EVIDENCE' } });
  });
});
