/** @lane merge
 * @subject scripts/candidate-evidence.mjs
 * @subject scripts/candidate-node-reporter.mjs
 * @subject scripts/candidate-vitest-reporter.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { startAttempt, openProgressWriter, sealProgress } from '../scripts/candidate-progress.mjs';
import { createHash } from 'node:crypto';
import { nodeErrorFact } from '../scripts/candidate-node-reporter.mjs';
import { installRuntime } from '../scripts/managed-runtime.js';
const checkout = fileURLToPath(new URL('../', import.meta.url));
const script = join(checkout, 'scripts/candidate-evidence.mjs');
const made: string[] = [];
afterEach(() => { for (const p of made.splice(0)) rmSync(p, { recursive: true, force: true }); });
function git(root: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  expect(r.status, r.stderr).toBe(0); return r.stdout.trim();
}
function fixture(files: Record<string, string>, vitest = false) {
  const parent = process.env.AGENT_TESTS_NATIVE_EVIDENCE_DIR ?? tmpdir(); mkdirSync(parent, { recursive: true });
  const base = realpathSync(mkdtempSync(join(parent, 'native-owner-')));
  if (!process.env.AGENT_TESTS_NATIVE_EVIDENCE_DIR) made.push(base);
  const root = join(base, 'repo'); mkdirSync(root);
  for (const [name, body] of Object.entries({ '.gitignore': 'node_modules/\n.local/\n', 'package.json': '{"name":"native-fixture","type":"module"}', ...files })) writeFileSync(join(root, name), body);
  mkdirSync(join(root, '.local'));
  if (vitest) { mkdirSync(join(root, 'node_modules')); symlinkSync(join(checkout, 'node_modules/vitest'), join(root, 'node_modules/vitest'), process.platform === 'win32' ? 'junction' : 'dir'); }
  git(root, 'init', '-q'); git(root, 'add', '.'); git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  return { root, out: join(base, 'attempt'), base, sha: git(root, 'rev-parse', 'HEAD') };
}
function run(args: string[], env = process.env) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true, timeout: 20000, env }); }
const progress = (out: string) => run(['progress', '--attempt', out]);
const json = (out: string, file = 'receipt.json') => JSON.parse(readFileSync(join(out, file), 'utf8'));
async function waitFor(predicate: () => boolean, context: () => string, timeout = 12000) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw Error(`Marker deadline: ${context()}`); await new Promise(resolve => setTimeout(resolve, 25)); }
}
function controlled(f: ReturnType<typeof fixture>, mode: string, args: string[], extra: string[] = []) {
  const child = spawn(process.execPath, [script, 'observe', mode, '--root', f.root, '--out', f.out, ...extra, '--', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const closed = new Promise<number | null>(resolve => child.once('close', code => resolve(code)));
  return { child, closed, output: () => output };
}
const held = "const{existsSync,writeFileSync}=await import('node:fs');writeFileSync('.local/b-held','yes');await new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{if(existsSync('.local/release')){clearInterval(timer);resolve();}else if(Date.now()-started>15000){clearInterval(timer);reject(Error('fixture release deadline'));}},20)});";

describe('native durable candidate diagnostics', () => {
  it('admits only the exact per-action grammar before touching paths', () => {
    for (const args of [ ['progress', '--attempt=x'], ['progress', '--attempt', 'missing', '--root', 'missing'], ['progress', '--attempt', 'missing', '--attempt', 'other'], ['progress', '--attempt', 'missing', '--', 'tail'], ['check', '--root', 'missing', '--out', 'other'], ['observe', 'node-test', '--root', 'missing', '--root', 'other'] ]) {
      const r = run(args); expect(r.status).toBe(1); expect(r.stderr).toMatch(/argument|duplicate|requires|missing|required|Use/i); expect(r.stderr).not.toMatch(/ENOENT|realpath|checkout root/);
    }
  });
  it.each([false, true])('retains Node A-ended/B-held counts and prompt TAP details (failure=%s)', async fail => {
    const f = fixture({ 'a.mjs': `import{test}from'node:test';import assert from'node:assert/strict';test('A',()=>{${fail ? "assert.equal('actual-value','expected-value')" : ''}});test.skip('skip',()=>{});test.todo('todo');`, 'b.mjs': `import{test}from'node:test';test('B',async()=>{${held}});` });
    const c = controlled(f, 'node-test', ['a.mjs', 'b.mjs']);
    try {
      await waitFor(() => existsSync(join(f.root, '.local/b-held')), c.output);
      await waitFor(() => { if (!existsSync(join(f.out, 'progress'))) return false; return readdirSync(join(f.out, 'progress')).filter(n => n.endsWith('.json')).some(n => json(join(f.out, 'progress'), n).kind === 'owner-ended'); }, c.output);
      const r = progress(f.out); expect(r.status, r.stderr).toBe(0); const p = JSON.parse(r.stdout);
      expect(p).toMatchObject({ state: 'unknown', observerLiveness: 'unknown', cleanup: 'unknown', sealed: false });
      expect(p.owners.find((o: any) => o.file.endsWith('a.mjs')).result.counts).toMatchObject({ total: 3, passed: fail ? 0 : 1, failed: fail ? 1 : 0, skipped: 1, todo: 1 });
      expect(existsSync(join(f.out, 'receipt.json'))).toBe(false);
      if (fail) expect(c.output()).toMatch(/actual-value[\s\S]*expected-value|expected-value[\s\S]*actual-value/);
    } finally { writeFileSync(join(f.root, '.local/release'), 'yes'); await c.closed; }
    expect(await c.closed, c.output()).toBe(fail ? 1 : 0);
    const p = JSON.parse(progress(f.out).stdout); expect(p.state).toBe('completed'); expect(p.sealed).toBe(true);
    expect(p.endedOwners).toHaveLength(2); expect(json(f.out).validation.ok).toBe(!fail);
  }, 30000);
  it('keeps nonisolated acceptance and unsupported progress explicit, and reserves transport', () => {
    const f = fixture({ 'owner.mjs': "import{test}from'node:test';test('pass',()=>{});" });
    const r = run(['observe', 'node-test', '--root', f.root, '--out', f.out, '--', '--test-isolation=none', 'owner.mjs'], { ...process.env, AGENT_TESTS_PROGRESS_DIRECTORY: 'untrusted', AGENT_TESTS_PROGRESS_ATTEMPT: 'untrusted', AGENT_TESTS_PROGRESS_START: 'untrusted' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const p = JSON.parse(progress(f.out).stdout); expect(p.state).toBe('unknown'); expect(p.capability).toMatchObject({ capability: 'unavailable' }); expect(p.owners).toEqual([]);
    const saved = json(f.out); expect(saved.schema).toBe('agent-tests/candidate-evidence@2');
    for (const name of ['candidate-progress.mjs', 'candidate-node-reporter.mjs', 'candidate-vitest-reporter.mjs']) expect(saved.toolchainBefore.helpers[name]).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([false, true])('retains Vitest A-ended/B-held native counts and separate primary/teardown failures (failure=%s)', async fail => {
    const f = fixture({
      'a.test.mjs': `import{test,describe,expect,afterAll}from'vitest';import value from'fixture-alias';describe('nested',()=>{test('A',()=>{expect(globalThis.fixtureSetup).toBe(true);expect(value).toBe(7);${fail ? "expect('actual-value').toBe('expected-value')" : ''}});test.skip('skip',()=>{});test.todo('todo');${fail ? "afterAll(()=>{throw Error('separate teardown failure')});" : ''}});`,
      'b.test.mjs': `import{test}from'vitest';test('B',async()=>{${held}});`,
      'value.mjs': 'export default 7;', 'setup.mjs': 'globalThis.fixtureSetup=true;',
      'vitest.config.mjs': `import{BaseSequencer}from'vitest/node';export default{resolve:{alias:{'fixture-alias':new URL('./value.mjs',import.meta.url).pathname}},test:{pool:'forks',isolate:true,setupFiles:['./setup.mjs'],sequence:{sequencer:class extends BaseSequencer{async sort(specs){return specs.sort((a,b)=>a.moduleId.localeCompare(b.moduleId))}}},reporters:[['json',{outputFile:new URL('../redirected.json',import.meta.url).pathname}]],outputFile:{json:new URL('../redirected-config.json',import.meta.url).pathname}}};`,
    }, true);
    const c = controlled(f, 'vitest', ['a.test.mjs', 'b.test.mjs']);
    try {
      await waitFor(() => existsSync(join(f.root, '.local/b-held')), c.output);
      const r = progress(f.out); expect(r.status, r.stderr + r.stdout).toBe(0); const p = JSON.parse(r.stdout);
      expect(p.state).toBe('unknown'); const a = p.owners.find((o: any) => o.file.endsWith('a.test.mjs'));
      expect(a.ended).toBe(true); expect(a.result.counts).toMatchObject({ total: 3, passed: fail ? 0 : 1, failed: fail ? 1 : 0, skipped: 1, todo: 1, cancelled: null });
      if (fail) {
        expect(a.result.errors.map((e: any) => e.scope)).toEqual(expect.arrayContaining(['case', 'suite']));
        expect(c.output()).toMatch(/actual-value/); expect(c.output()).toMatch(/expected-value/); expect(c.output()).toMatch(/separate teardown failure/);
      }
      expect(existsSync(join(f.out, 'receipt.json'))).toBe(false);
    } finally { writeFileSync(join(f.root, '.local/release'), 'yes'); await c.closed; }
    expect(await c.closed, c.output()).toBe(fail ? 1 : 0);
    expect(JSON.parse(progress(f.out).stdout)).toMatchObject({ state: 'completed', sealed: true });
    expect(existsSync(join(f.base, 'redirected.json'))).toBe(false); expect(existsSync(join(f.base, 'redirected-config.json'))).toBe(false);
    expect(json(f.out).validation.ok).toBe(!fail);
    if (!fail) {
      const native = spawnSync(process.execPath, [join(f.root, 'node_modules/vitest/vitest.mjs'), 'run', '--maxWorkers=1', '--reporter=json', `--outputFile.json=${join(f.base, 'ordinary.json')}`, 'a.test.mjs', 'b.test.mjs'], { cwd: f.root, encoding: 'utf8', windowsHide: true, timeout: 15000 });
      // Tuple outputFile wins in ordinary native JSON, which is precisely why the adapter owns its destination.
      expect(native.status, native.stdout + native.stderr).toBe(0);
      const ordinaryPath = existsSync(join(f.base, 'ordinary.json')) ? join(f.base, 'ordinary.json') : join(f.base, 'redirected.json');
      const ordinary = JSON.parse(readFileSync(ordinaryPath, 'utf8'));
      const normalize = (value: any): any => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k]) => !['duration', 'startTime', 'endTime'].includes(k)).map(([k, v]) => [k, normalize(v)])) : value;
      expect(normalize(json(f.out, 'vitest.json'))).toEqual(normalize(ordinary));
    }
  }, 30000);
  it.each(['collection', 'empty', 'unhandled', 'retry'])('preserves actual Vitest %s terminal behavior', kind => {
    const bodies: Record<string, string> = {
      collection: "throw Error('native collection failure');",
      empty: 'export const noTests=true;',
      unhandled: "import{test}from'vitest';test('native',()=>{process.emit('unhandledRejection',Error('native unscoped rejection'));});",
      retry: "import{test,expect}from'vitest';let count=0;test('eventual pass',{retry:1},()=>{expect(++count).toBe(2)});",
    };
    const f = fixture({ 'owner.test.mjs': bodies[kind] }, true);
    const r = run(['observe', 'vitest', '--root', f.root, '--out', f.out, '--', 'owner.test.mjs', ...(kind === 'empty' ? ['--passWithNoTests'] : [])]);
    expect(r.status, r.stdout + r.stderr).toBe(kind === 'retry' ? 0 : 1);
    const p = JSON.parse(progress(f.out).stdout); expect(p.owners).toHaveLength(1); expect(p.owners[0].ended).toBe(true);
    if (kind === 'collection') expect(p.owners[0].result).toMatchObject({ state: 'failed', counts: { total: 0 } });
    if (kind === 'unhandled') expect(p.records.some((record: any) => record.kind === 'native-error' && record.errors.some((e: any) => e.scope === 'run'))).toBe(true);
  }, 30000);
  it('inherits public JsonReporter initialization and coverage while ignoring injected destinations', async () => {
    const f = fixture({ 'owner.test.mjs': '' }, true); mkdirSync(f.out);
    const binding = startAttempt(f.out, { before: { root: f.root, head: { sha: f.sha }, files: {} }, toolchainBefore: { node: process.version, executable: process.execPath, helpers: {} }, command: { executable: process.execPath, cwd: f.root, mode: 'vitest', args: [], selectedArgs: [], concurrency: 1, resourceDeclaration: 'serial/unreviewed' }, progress: { capability: 'qualified', adapter: 'vitest-5.0.3', version: '5.0.3' }, limitations: [] });
    const keys = ['AGENT_TESTS_PROGRESS_DIRECTORY', 'AGENT_TESTS_PROGRESS_ATTEMPT', 'AGENT_TESTS_PROGRESS_START'];
    const previous = keys.map(k => process.env[k]);
    Object.assign(process.env, { AGENT_TESTS_PROGRESS_DIRECTORY: f.out, AGENT_TESTS_PROGRESS_ATTEMPT: binding.attemptId, AGENT_TESTS_PROGRESS_START: binding.startSha256 });
    try {
      const { default: Reporter } = await import(pathToFileURL(join(checkout, 'scripts/candidate-vitest-reporter.mjs')).href);
      const reporter = new Reporter({ outputFile: join(f.base, 'injected.json') });
      expect(Object.hasOwn(Reporter.prototype, 'onInit')).toBe(false); expect(Object.hasOwn(Reporter.prototype, 'onCoverage')).toBe(false);
      const context = { marker: 'public context' }; reporter.onInit(context); expect(reporter.ctx).toBe(context);
      const coverage = { marker: 'inherited coverage map' }; reporter.onCoverage(coverage); expect(reporter.coverageMap).toBe(coverage);
      expect(reporter.options.outputFile).toBe(join(f.out, 'vitest.json'));
    } finally { keys.forEach((k, i) => { if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i]; }); }
  });
  it('retains completed A bytes after a real observed timeout without making partial evidence green', async () => {
    const f = fixture({ 'a.mjs': "import{test}from'node:test';test('A',()=>{});", 'b.mjs': `import{test}from'node:test';test('B',async()=>{${held}});` });
    const c = controlled(f, 'node-test', ['a.mjs', 'b.mjs'], ['--timeout-ms', '5000']);
    let before = '';
    try {
      await waitFor(() => existsSync(join(f.root, '.local/b-held')), c.output);
      const p = JSON.parse(progress(f.out).stdout); const a = p.owners.find((o: any) => o.file.endsWith('a.mjs'));
      expect(a.ended).toBe(true); before = JSON.stringify(a.result);
      expect(await c.closed).toBe(1);
      const r = progress(f.out); expect(r.status, r.stdout + r.stderr).toBe(0);
      const after = JSON.parse(r.stdout); expect(after.state).toBe('interrupted');
      expect(JSON.stringify(after.owners.find((o: any) => o.file.endsWith('a.mjs')).result)).toBe(before);
      expect(run(['check', '--root', f.root, '--receipt', join(f.out, 'receipt.json'), '--candidate', f.sha]).status).toBe(1);
    } finally { writeFileSync(join(f.root, '.local/release'), 'yes'); await c.closed; }
  }, 30000);
  it('keeps an actual interrupted recorder unknown without inferring liveness or leaving a native child', async () => {
    const f = fixture({ 'owner.mjs': "import{test}from'node:test';test('unused',()=>{});" });
    // Test-only public Node preload replaces spawn with a held stream handle. The real recorder
    // publishes its real start before acquisition; there is deliberately no descendant to clean up.
    const preload = join(f.base, 'held-spawn.mjs');
    writeFileSync(preload, "import cp from'node:child_process';import{syncBuiltinESMExports}from'node:module';import{EventEmitter}from'node:events';import{PassThrough}from'node:stream';cp.spawn=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;setInterval(()=>{},1000);return child;};syncBuiltinESMExports();");
    const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, script, 'observe', 'node-test', '--root', f.root, '--out', f.out, '--', 'owner.mjs'], { windowsHide: true, stdio: 'ignore' }); const closed = new Promise(resolve => child.once('close', resolve));
    try { await waitFor(() => existsSync(join(f.out, 'progress')), () => 'controlled actual recorder start'); }
    finally { child.kill('SIGTERM'); await closed; }
    const r = progress(f.out); expect(r.status, r.stderr).toBe(0); expect(JSON.parse(r.stdout)).toMatchObject({ state: 'unknown', observerLiveness: 'unknown', sealed: false });
    expect(existsSync(join(f.out, 'receipt.json'))).toBe(false);
  });
  it('retains an actual spawn-error seam as red terminal evidence', () => {
    const f = fixture({ 'owner.mjs': "import{test}from'node:test';test('unused',()=>{});" });
    const preload = join(f.base, 'failed-spawn.mjs');
    writeFileSync(preload, "import cp from'node:child_process';import{syncBuiltinESMExports}from'node:module';import{EventEmitter}from'node:events';import{PassThrough}from'node:stream';cp.spawn=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;queueMicrotask(()=>{child.emit('error',Object.assign(Error('controlled spawn failure'),{code:'EAGAIN'}));child.emit('close',-2,null)});return child;};syncBuiltinESMExports();");
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, script, 'observe', 'node-test', '--root', f.root, '--out', f.out, '--', 'owner.mjs'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    expect(r.status, r.stdout + r.stderr).toBe(1); expect(json(f.out).child.spawnError).toEqual({ code: 'EAGAIN', message: 'controlled spawn failure' });
    const p = progress(f.out); expect(p.status, p.stdout + p.stderr).toBe(0); expect(JSON.parse(p.stdout)).toMatchObject({ state: 'unknown', nativeReport: null });
  });
  it('retains unsupported Vitest terminal invocation without guessing public API compatibility', () => {
    // A runner protocol fixture proves fallback admission, not qualification of another Vitest version.
    const f = fixture({ 'owner.test.mjs': '' }); mkdirSync(join(f.root, 'node_modules/vitest'), { recursive: true });
    writeFileSync(join(f.root, 'node_modules/vitest/package.json'), '{"name":"vitest","version":"4.99.0"}');
    writeFileSync(join(f.root, 'node_modules/vitest/vitest.mjs'), `import{writeFileSync}from'node:fs';const path=process.argv.find(a=>a.startsWith('--outputFile.json=')).slice('--outputFile.json='.length);writeFileSync(path,JSON.stringify({numTotalTests:1,numPassedTests:1,numFailedTests:0,numPendingTests:0,numTodoTests:0,numPendingTestSuites:0,numFailedTestSuites:0,success:true,testResults:[{name:${JSON.stringify(join(f.root, 'owner.test.mjs'))},status:'passed',assertionResults:[{status:'passed'}]}]}));`);
    const r = run(['observe', 'vitest', '--root', f.root, '--out', f.out, '--', 'owner.test.mjs']); expect(r.status, r.stdout + r.stderr).toBe(0);
    const p = JSON.parse(progress(f.out).stdout); expect(p).toMatchObject({ state: 'unknown', capability: { capability: 'unsupported', version: '4.99.0' }, owners: [], nativeReport: { usable: true, success: true } });
    expect(json(f.out).command.args).toContain('--reporter=json');
  });
  it('retains explicit passWithNoTests native success without accepting an empty observation', () => {
    const f = fixture({ 'owner.test.mjs': "import{test}from'vitest';test('excluded',()=>{});" }, true);
    const r = run(['observe', 'vitest', '--root', f.root, '--out', f.out, '--', '.', '--exclude', '**/*.test.mjs', '--passWithNoTests']);
    expect(r.status, r.stdout + r.stderr).toBe(1); expect(json(f.out).child.exitCode).toBe(0);
    expect(json(f.out, 'vitest.json')).toMatchObject({ numTotalTests: 0, success: true, testResults: [] });
    const p = JSON.parse(progress(f.out).stdout); expect(p).toMatchObject({ state: 'completed', owners: [], nativeReport: { usable: true, success: true } });
    expect(p.checkVerdict.ok).toBe(false);
  });
  it('keeps missing entryFile errors unscoped and definition-only file provenance out of owner identities', () => {
    const error = nodeErrorFact({ file: '/definition.mjs', name: 'assertion', details: { error: Error('native error') } });
    expect(error.errors[0]).toMatchObject({ ownerId: null, definitionFile: '/definition.mjs', scope: 'case' });
    const f = fixture({ 'owner.mjs': "import './definition.mjs';", 'definition.mjs': "import{test}from'node:test';test('defined elsewhere',()=>{});" });
    const r = run(['observe', 'node-test', '--root', f.root, '--out', f.out, '--', 'owner.mjs']);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const p = JSON.parse(progress(f.out).stdout); expect(p.endedOwners).toHaveLength(1); expect(p.owners[0].file).toBe(join(f.root, 'owner.mjs'));
    expect(json(f.out, 'node-profile.json').files.find((file: any) => file.file === 'definition.mjs').counts).toBe(null);
  });
  it('checks legacy @1 receipts under terminal rules without implying cross-version replay', () => {
    const f = fixture({ 'owner.mjs': "import{test}from'node:test';test('native',()=>{});" });
    expect(run(['observe', 'node-test', '--root', f.root, '--out', f.out, '--', 'owner.mjs']).status).toBe(0);
    const saved = json(f.out); saved.schema = 'agent-tests/candidate-evidence@1'; delete saved.inventory; delete saved.progress; delete saved.attemptId;
    writeFileSync(join(f.out, 'receipt.json'), JSON.stringify(saved));
    const checked = run(['check', '--root', f.root, '--receipt', join(f.out, 'receipt.json'), '--candidate', f.sha]);
    expect(checked.status, checked.stdout + checked.stderr).toBe(0);
  });
  it('routes progress through the exact checked managed runtime and refuses modified new helpers', () => {
    const f = fixture({ 'owner.mjs': "import{test}from'node:test';test('native',()=>{});" });
    const home = join(f.base, 'managed'); mkdirSync(home);
    const installed = installRuntime(checkout, { home, npm: () => '', checkDependencies: () => {} });
    const invoke = (...args: string[]) => spawnSync(process.execPath, [join(checkout, 'scripts/run-managed.js'), 'candidate-evidence', ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, AGENT_TESTS_HOME: home } });
    const observed = invoke('observe', 'node-test', '--root', f.root, '--out', f.out, '--', 'owner.mjs');
    expect(observed.status, observed.stdout + observed.stderr).toBe(0);
    const queried = invoke('progress', '--attempt', f.out); expect(queried.status, queried.stderr).toBe(0); expect(JSON.parse(queried.stdout).state).toBe('completed');
    for (const name of ['candidate-progress.mjs', 'candidate-node-reporter.mjs', 'candidate-vitest-reporter.mjs']) expect(existsSync(join(installed.root, 'scripts', name))).toBe(true);
    writeFileSync(join(installed.root, 'scripts/candidate-progress.mjs'), "throw Error('must not run');");
    const refused = invoke('progress', '--attempt', f.out); expect(refused.status).toBe(1); expect(refused.stdout).toBe(''); expect(refused.stderr).toMatch(/E_RUNTIME_MISSING/);
  });
  it('publishes completed Vitest case diagnostics while its own module is still held', async () => {
    const f = fixture({ 'owner.test.mjs': `import{test,expect}from'vitest';test('early assertion',()=>expect('prompt actual').toBe('prompt expected'));test('held later case',async()=>{${held}});` }, true);
    const c = controlled(f, 'vitest', ['owner.test.mjs']);
    try {
      await waitFor(() => existsSync(join(f.root, '.local/b-held')), c.output);
      // Native worker result transport is batched; the callback publication is the evidence barrier.
      await waitFor(() => readdirSync(join(f.out, 'progress')).filter(n => n.endsWith('.json')).some(n => json(join(f.out, 'progress'), n).kind === 'native-error'), c.output);
      const p = JSON.parse(progress(f.out).stdout); expect(p.endedOwners).toEqual([]);
      expect(p.records.some((r: any) => r.kind === 'native-error' && r.errors.some((e: any) => e.scope === 'case' && e.error.message.includes('prompt actual')))).toBe(true);
      expect(c.output()).toMatch(/prompt actual/); expect(c.output()).toMatch(/prompt expected/);
    } finally { writeFileSync(join(f.root, '.local/release'), 'yes'); await c.closed; }
    expect(await c.closed).toBe(1);
  }, 30000);
  it('retains real A publication when the actual recorder handle is interrupted before B ends', async () => {
    const f = fixture({
      'a.mjs': "import{test}from'node:test';test('A',()=>{});",
      'b.mjs': `import{test}from'node:test';import{writeFileSync}from'node:fs';test('B',async()=>{try{${held.replace('15000', '4000')}}finally{writeFileSync('.local/native-finally','yes')}});`,
    });
    // Preserve this partial even outside the external-evidence lane. The recorder's handle closure
    // and B's finally marker do not establish native descendant drain, so cleanup makes no such claim.
    const cleanupIndex = made.indexOf(f.base); if (cleanupIndex >= 0) made.splice(cleanupIndex, 1);
    const c = controlled(f, 'node-test', ['a.mjs', 'b.mjs']);
    let aBytes = '';
    try {
      await waitFor(() => existsSync(join(f.root, '.local/b-held')), c.output);
      const p = JSON.parse(progress(f.out).stdout); const a = p.owners.find((o: any) => o.file.endsWith('a.mjs'));
      expect(a.ended).toBe(true); aBytes = JSON.stringify(a.result);
      expect(c.child.kill('SIGTERM')).toBe(true); await c.closed;
      const partial = progress(f.out); expect(partial.status, partial.stdout + partial.stderr).toBe(0);
      const state = JSON.parse(partial.stdout); expect(state).toMatchObject({ state: 'unknown', observerLiveness: 'unknown', cleanup: 'unknown', sealed: false });
      expect(JSON.stringify(state.owners.find((o: any) => o.file.endsWith('a.mjs')).result)).toBe(aBytes);
      expect(existsSync(join(f.out, 'receipt.json'))).toBe(false);
    } finally {
      writeFileSync(join(f.root, '.local/release'), 'yes');
      if (c.child.exitCode === null && c.child.signalCode === null) c.child.kill('SIGTERM');
      await c.closed;
      writeFileSync(join(f.base, 'interruption-control.json'), JSON.stringify({ actualRecorderHandleClosed: true, releasePublished: true, nativeFinallyMarkerAtInspection: existsSync(join(f.root, '.local/native-finally')), automaticNativeDeadlineMs: 4000, cleanup: 'unknown', claim: 'A publication and unknown orphan progress; no descendant-drain claim' }));
    }
  }, 15000);
  it('preserves independent native module identities for a shared Vitest file in two projects', () => {
    const f = fixture({
      'owner.test.mjs': "import{test}from'vitest';test('shared',()=>{});",
      'vitest.config.mjs': "export default{test:{projects:[{test:{name:'one',include:['owner.test.mjs'],pool:'forks',isolate:true}},{test:{name:'two',include:['owner.test.mjs'],pool:'forks',isolate:true}}]}};",
    }, true);
    const r = run(['observe', 'vitest', '--root', f.root, '--out', f.out, '--', 'owner.test.mjs']); expect(r.status, r.stdout + r.stderr).toBe(0);
    const p = JSON.parse(progress(f.out).stdout); expect(p.endedOwners).toHaveLength(2); expect(new Set(p.endedOwners).size).toBe(2);
    expect(new Set(p.owners.map((owner: any) => owner.file)).size).toBe(1); expect(p.owners.map((owner: any) => owner.project).sort()).toEqual(['one', 'two']);
  });
  it.each(['silent', 'reporter-failed', 'missing-run-end'])('rejects a coherently sealed %s adapter even when native child and JSON are green', kind => {
    const f = fixture({ 'owner.mjs': "import{test}from'node:test';test('native',()=>{});" });
    expect(run(['observe', 'node-test', '--root', f.root, '--out', f.out, '--', 'owner.mjs']).status).toBe(0);
    const saved = json(f.out), bytes = readFileSync(join(f.out, 'attempt-start.json'));
    const originalRecords = readdirSync(join(f.out, 'progress')).filter(n => n.endsWith('.json')).sort().map(n => json(join(f.out, 'progress'), n));
    const binding = { attemptId: saved.attemptId, startSha256: createHash('sha256').update(bytes).digest('hex') };
    rmSync(join(f.out, 'progress-inventory.json')); rmSync(join(f.out, 'progress'), { recursive: true }); mkdirSync(join(f.out, 'progress'));
    const writer = openProgressWriter({ directory: f.out, ...binding });
    if (kind === 'silent') writer.append('run-ended', originalRecords.find(record => record.kind === 'run-ended'));
    else {
      for (const record of originalRecords) if (kind !== 'missing-run-end' || record.kind !== 'run-ended') writer.append(record.kind, record);
      if (kind === 'reporter-failed') writer.append('reporter-failed', { message: 'controlled projection failure' });
    }
    saved.inventory = sealProgress(f.out, binding); writeFileSync(join(f.out, 'receipt.json'), JSON.stringify(saved));
    const checked = run(['check', '--root', f.root, '--receipt', join(f.out, 'receipt.json'), '--candidate', f.sha]);
    expect(checked.status).toBe(1); expect(checked.stdout).toMatch(kind === 'silent' ? /Missing genuine native owner boundary/ : kind === 'reporter-failed' ? /reporter\/projection failure/ : /Missing native run-ended/);
  });
  it('never acquires a native child when immutable start publication fails', () => {
    const f = fixture({ 'owner.mjs': "import{test}from'node:test';test('unused',()=>{});" });
    const preload = join(f.base, 'failed-start.mjs');
    writeFileSync(preload, "import fs from'node:fs';import{syncBuiltinESMExports}from'node:module';const original=fs.linkSync;fs.linkSync=(from,to)=>{if(to.endsWith('attempt-start.json'))throw Error('controlled start publication failure');return original(from,to)};syncBuiltinESMExports();");
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, script, 'observe', 'node-test', '--root', f.root, '--out', f.out, '--', 'owner.mjs'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    expect(r.status).toBe(1); expect(r.stderr).toMatch(/controlled start publication failure/);
    expect(existsSync(join(f.out, 'stdout.log'))).toBe(false); expect(existsSync(join(f.out, 'receipt.json'))).toBe(false);
  });
  it('rejects missing or wrongly typed terminal child closure instead of fabricating completion/interruption', () => {
    const f = fixture({ 'owner.mjs': "import{test}from'node:test';test('native',()=>{});" });
    expect(run(['observe', 'node-test', '--root', f.root, '--out', f.out, '--', 'owner.mjs']).status).toBe(0);
    const saved = json(f.out), original = saved.child;
    for (const child of [{}, null, { ...original, exitCode: undefined }, { ...original, exitCode: '0' }, { ...original, signal: 7 }, { ...original, timedOut: 'false' }, { ...original, spawnError: {} }, { ...original, startedAt: null }, { ...original, endedAt: 'yesterday' }, { ...original, wallMs: -1 }, { ...original, exitCode: null, signal: null, spawnError: null }]) {
      writeFileSync(join(f.out, 'receipt.json'), JSON.stringify({ ...saved, child }));
      const r = progress(f.out); expect(r.status, JSON.stringify(child)).toBe(1); const p = JSON.parse(r.stdout);
      expect(p.problems.join(' ')).toMatch(/child|closure/i); expect(['completed', 'interrupted']).not.toContain(p.state);
    }
    writeFileSync(join(f.out, 'receipt.json'), JSON.stringify(saved)); expect(JSON.parse(progress(f.out).stdout).state).toBe('completed');
  });
});
