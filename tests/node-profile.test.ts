/** @lane merge
 * @subject scripts/node-profile.mjs
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { makeTree } from './helpers/tree.ts';

const reporter = new URL('../scripts/node-profile.mjs', import.meta.url).href;

describe('Node profiling reporter', () => {
  it('measures file lifetimes separately from nested test durations and retains failed runs', () => {
    const root = makeTree({
      'pass.test.mjs': "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('parent',async t=>{await t.test('child',()=>assert.ok(true));}); test.skip('skip',()=>{});",
      'fail.test.mjs': "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('bad',()=>assert.equal(1,2));",
    });
    const result = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, 'pass.test.mjs', 'fail.test.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000 });
    expect(result.status).toBe(1);
    const profile = JSON.parse(result.stdout);
    expect(profile.schema).toBe('agent-tests/node-profile@1');
    expect(profile.success).toBe(false);
    expect(profile.wallMs).toBeGreaterThan(0);
    expect(profile.files.map((f: {file:string})=>f.file).sort()).toEqual(['fail.test.mjs','pass.test.mjs']);
    expect(profile.files.find((f: {file:string})=>f.file==='pass.test.mjs')).toMatchObject({ success:true });
    expect(profile.files.find((f: {file:string})=>f.file==='fail.test.mjs')).toMatchObject({ success:false });
    for (const file of profile.files) {
      expect(file.elapsedMs).toBeGreaterThan(0);
      expect(file.counts.tests).toBeGreaterThan(0);
    }
    expect(profile.files.find((f: {file:string})=>f.file==='pass.test.mjs').counts).toMatchObject({ passed:2, skipped:1 });
    expect(profile.slowestTests.some((t: {name:string})=>t.name==='bad')).toBe(true);
    expect(profile.counts.failed).toBe(1);
    expect(profile.counts.skipped).toBe(1);
  });
  it('retains module-load failures and emits usable JSON when tests log output', () => {
    const root = makeTree({ 'broken.test.mjs': "console.log('diagnostic'); throw new Error('module failed');" });
    const result = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, 'broken.test.mjs'], { cwd:root, encoding:'utf8', windowsHide:true, timeout:15000 });
    expect(result.status).toBe(1);
    const profile=JSON.parse(result.stdout);
    expect(profile.success).toBe(false);
    expect(profile.files).toHaveLength(1);
    expect(profile.files[0].file).toBe('broken.test.mjs');
  });
});
