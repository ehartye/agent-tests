/** @lane merge
 * @subject scripts/worker-cpu-profile.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs, { existsSync, readdirSync, rmSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { makeTree as makeTemporaryTree } from './helpers/tree.ts';

// OS temp roots can have symlink ancestry (for example /var on macOS). These
// fixtures require a physical parent; the explicit alias-refusal case stays below.
const makeTree = (files: Record<string, string> = {}) => realpathSync.native(makeTemporaryTree(files));

const helper = new URL('../scripts/worker-cpu-profile.mjs', import.meta.url).href;
const vitest = import.meta.resolve('vitest');
const cli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const runtimeRoot = fileURLToPath(new URL('../', import.meta.url));
const reference = readFileSync(new URL('../references/node-profiling.md', import.meta.url), 'utf8');
function recipe(name: string) {
  const snippet = reference.split(`// ${name}\n`)[1]?.split('\n```')[0];
  if (!snippet) throw new Error(`Missing executable ${name} recipe`);
  return snippet;
}

function nativeWorker(fail: boolean, optedIn = true, breakFlush = false, setupAsString = false, executableConfig = false) {
  const root = makeTree({
    'package.json': '{"type":"module"}',
    'alias.mjs': 'export const answer = 42;',
    'existing-setup.mjs': 'globalThis.existingSetup = "retained";',
    'vite.config.ts': `import { fileURLToPath } from 'node:url'; export default ${executableConfig ? '() =>' : ''} ({ resolve: { alias: { '@fixture': fileURLToPath(new URL('./alias.mjs', import.meta.url)) } }, test: { include: ['owner.test.mjs'], environment: 'node', setupFiles: ${setupAsString ? "'./existing-setup.mjs'" : "['./existing-setup.mjs']"}, isolate: false, pool: 'forks', maxWorkers: 1 } });`,
    'profile-setup.mjs': recipe('profile-setup.mjs'),
    'profile.config.mjs': recipe('profile.config.mjs'),
    'owner.test.mjs': `import { expect, test } from ${JSON.stringify(vitest)}; import { answer } from '@fixture';
      import { writeFileSync } from 'node:fs'; import { join } from 'node:path';
      test('selected owner', () => { expect(globalThis.existingSetup).toBe('retained'); expect(answer).toBe(42); let n=0; for(let i=0;i<100000;i++) n+=Math.sqrt(i); expect(n).toBeGreaterThan(0); ${breakFlush ? "writeFileSync(join(process.env.TEST_CPU_PROFILE_DIR, 'worker.cpuprofile'), 'write failure witness');" : ''} expect('native assertion witness').toBe(${JSON.stringify(fail ? 'intentional failure' : 'native assertion witness')}); });
      test('filtered owner', () => { throw new Error('must remain filtered'); });`,
  });
  // The disposable consumer owns a normal public Vitest dependency resolution.
  symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const outputDirectory = join(root, 'attempt');
  const args = [cli, 'run', '--config=profile.config.mjs', '--maxWorkers=1', '--no-file-parallelism', '--testNamePattern=selected owner', '--reporter=json', '--outputFile=native.json'];
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000, env: { ...process.env, TESTS_RUNTIME_ROOT: runtimeRoot, TEST_CPU_PROFILE_DIR: optedIn ? outputDirectory : '', TEST_CPU_PROFILE_OWNER: 'fixture-owner' } });
  return { root, outputDirectory, result, native: existsSync(join(root, 'native.json')) ? JSON.parse(readFileSync(join(root, 'native.json'), 'utf8')) : null };
}

function retainRejectedProfile(base: string, raw: Buffer, descriptor: Buffer, testCase: string, rejection: unknown) {
  const complete = join(base, 'complete');
  fs.mkdirSync(complete, { recursive: true });
  const id = randomUUID();
  const stage = join(base, 'stage-' + id);
  fs.mkdirSync(stage);
  try {
    fs.writeFileSync(join(stage, 'worker.cpuprofile'), raw, { flag: 'wx' });
    fs.writeFileSync(join(stage, 'descriptor.json'), descriptor, { flag: 'wx' });
    const replay = {
      testCase, node: process.version, platform: process.platform, architecture: process.arch,
      rejection: rejection instanceof Error ? rejection.message : String(rejection),
      sha256: createHash('sha256').update(raw).digest('hex'),
    };
    fs.writeFileSync(join(stage, 'replay.json'), JSON.stringify(replay, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(stage, join(complete, id));
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

async function completedProfile(outputDirectory: string, testCase: string, evidenceBase: string | undefined) {
  const descriptorBytes = readFileSync(join(outputDirectory, 'descriptor.json'));
  const descriptor = JSON.parse(descriptorBytes.toString('utf8'));
  expect(descriptor).toMatchObject({ schema: 'agent-tests/worker-cpu-profile@1', status: 'completed', ownerId: 'fixture-owner', node: process.version, platform: process.platform, architecture: process.arch });
  expect(descriptor.raw.file).toBe('worker.cpuprofile');
  const raw = readFileSync(join(outputDirectory, 'worker.cpuprofile'));
  expect(raw.length).toBeGreaterThan(100);
  expect(descriptor.raw.bytes).toBe(raw.length);
  expect(descriptor.raw.sha256).toBe(createHash('sha256').update(raw).digest('hex'));
  const profile = JSON.parse(raw.toString());
  const { summarizeCpuProfile } = await import(helper);
  let summary;
  try {
    summary = summarizeCpuProfile(profile);
  } catch (rejection) {
    if (evidenceBase) {
      try { retainRejectedProfile(evidenceBase, raw, descriptorBytes, testCase, rejection); }
      catch (captureError) { console.error('Could not retain rejected worker CPU profile', captureError); }
    }
    throw rejection;
  }
  expect(profile.samples.length).toBeGreaterThan(0);
  expect(summary.samples).toBe(profile.samples.length);
  expect(summary.totalSampledUs).toBeGreaterThan(0);
  expect(summary.frames.reduce((sum: number, frame: { selfUs: number }) => sum + frame.selfUs, 0)).toBe(summary.totalSampledUs);
  expect(Date.parse(descriptor.endedAt)).toBeGreaterThanOrEqual(Date.parse(descriptor.startedAt));
}

describe('opt-in worker CPU profiling', () => {
  it('retains a real native worker profile while preserving setup, aliases and selected scope', async () => {
    const { result, native, outputDirectory } = nativeWorker(false);
    expect(result.status).toBe(0);
    expect(native).toMatchObject({ numPassedTests: 1, numFailedTests: 0, numPendingTests: 1, success: true });
    await completedProfile(outputDirectory, 'preserves setup, aliases and selected scope', process.env.AGENT_TESTS_PROFILE_EVIDENCE_DIR);
  });

  it('flushes after a real assertion failure without changing native failure details', async () => {
    const { result, native, outputDirectory } = nativeWorker(true);
    expect(result.status).toBe(1);
    expect(native).toMatchObject({ numPassedTests: 0, numFailedTests: 1, numPendingTests: 1, success: false });
    expect(native.testResults[0].assertionResults[0].failureMessages.join('\n')).toContain('native assertion witness');
    expect(native.testResults[0].assertionResults[0].failureMessages.join('\n')).toContain('intentional failure');
    await completedProfile(outputDirectory, 'flushes after a native assertion failure', process.env.AGENT_TESTS_PROFILE_EVIDENCE_DIR);
  });

  it('does nothing when profiling is not explicitly opted in', () => {
    const { result, native, outputDirectory } = nativeWorker(false, false);
    expect(result.status).toBe(0);
    expect(native).toMatchObject({ numPassedTests: 1, numPendingTests: 1, success: true });
    expect(existsSync(outputDirectory)).toBe(false);
  });

  it('preserves a string setup list through the executable object-config recipe', async () => {
    const { result, outputDirectory } = nativeWorker(false, true, false, true);
    expect(result.status).toBe(0);
    await completedProfile(outputDirectory, 'preserves a string setup list', process.env.AGENT_TESTS_PROFILE_EVIDENCE_DIR);
  });

  it('refuses executable base configs instead of silently losing the real settings', () => {
    const { result, outputDirectory } = nativeWorker(false, true, false, false, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('object config');
    expect(existsSync(outputDirectory)).toBe(false);
  });

  it('retains native assertion details alongside a separately failed profiler hook', () => {
    const { result, native, outputDirectory } = nativeWorker(true, true, true);
    expect(result.status).toBe(1);
    expect(native).toMatchObject({ numFailedTests: 1, success: false });
    expect(native.testResults[0].assertionResults[0].failureMessages.join('\n')).toContain('native assertion witness');
    expect(native.testResults[0].message).toContain('EEXIST');
    expect(JSON.parse(readFileSync(join(outputDirectory, 'descriptor.json'), 'utf8'))).toMatchObject({ status: 'failed', error: { phase: 'stop' } });
  });
});

// A deterministic independent oracle: three samples, deliberately unequal durations.
const weighted = () => ({
  startTime: 100, endTime: 1100,
  nodes: [
    { id: 1, callFrame: { functionName: '(root)', scriptId: '0', url: '', lineNumber: -1, columnNumber: -1 }, children: [2, 4] },
    { id: 2, callFrame: { functionName: 'outer', scriptId: '1', url: 'file:///generated.js', lineNumber: 1, columnNumber: 0 }, children: [3] },
    { id: 3, callFrame: { functionName: 'inner', scriptId: '1', url: 'file:///generated.js', lineNumber: 2, columnNumber: 0 } },
    { id: 4, callFrame: { functionName: '(garbage collector)', scriptId: '0', url: '', lineNumber: -1, columnNumber: -1 } },
  ],
  samples: [2, 3, 4], timeDeltas: [100, 300, 600],
});

function profileInput(samples: number[], timeDeltas: number[]) {
  // Preserve whitespace so a reserialized capture cannot pass the byte comparison.
  const bytes = Buffer.from(JSON.stringify({ ...weighted(), samples, timeDeltas }, null, 2) + '\r\n');
  const descriptor = Buffer.from(JSON.stringify({
    schema: 'agent-tests/worker-cpu-profile@1', status: 'completed', ownerId: 'fixture-owner',
    node: process.version, platform: process.platform, architecture: process.arch,
    startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:01Z',
    raw: { file: 'worker.cpuprofile', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
  }, null, 2) + '\n');
  const directory = makeTree({ 'worker.cpuprofile': bytes.toString(), 'descriptor.json': descriptor.toString() });
  return { bytes, descriptor, directory };
}

describe('rejected qualification profile evidence', () => {
  it('replays distinct failures from one evidence base after source cleanup', async () => {
    const base = makeTree();
    const inputs = [
      { ...profileInput([2, 99, 4], [100, 300, 600]), testCase: 'dangling sample', reason: 'Invalid CPU profile: sample[1] unknown node ID 99' },
      { ...profileInput([2, 3, 4], [100, -7, 600]), testCase: 'negative delta', reason: 'Invalid CPU profile: sample[1] invalid delta -7' },
    ];
    for (const input of inputs) {
      await expect(completedProfile(input.directory, input.testCase, base)).rejects.toThrow(new Error(input.reason));
      rmSync(input.directory, { recursive: true });
    }
    const published = join(base, 'complete');
    const names = readdirSync(published);
    expect(names).toHaveLength(2);
    const { summarizeCpuProfile } = await import(helper);
    const seen = new Set<string>();
    for (const name of names) {
      const path = join(published, name);
      expect(readdirSync(path).sort()).toEqual(['descriptor.json', 'replay.json', 'worker.cpuprofile']);
      const replay = JSON.parse(readFileSync(join(path, 'replay.json'), 'utf8'));
      const input = inputs.find(item => item.testCase === replay.testCase)!;
      const raw = readFileSync(join(path, 'worker.cpuprofile'));
      expect(raw).toEqual(input.bytes);
      expect(readFileSync(join(path, 'descriptor.json'))).toEqual(input.descriptor);
      expect(replay).toMatchObject({ rejection: input.reason, node: process.version, platform: process.platform, sha256: createHash('sha256').update(raw).digest('hex') });
      expect(() => summarizeCpuProfile(JSON.parse(raw.toString()))).toThrow(new Error(replay.rejection));
      seen.add(replay.testCase);
    }
    expect(seen).toEqual(new Set(inputs.map(input => input.testCase)));
  });

  it('creates no bundle on success or when capture is disabled', async () => {
    const base = makeTree();
    const good = profileInput([2, 3, 4], [100, 0, 600]);
    await completedProfile(good.directory, 'zero delta', base);
    const bad = profileInput([2, 3, 4], [100, -7, 600]);
    await expect(completedProfile(bad.directory, 'disabled', '')).rejects.toThrow('sample[1] invalid delta -7');
    expect(readdirSync(base)).toEqual([]);
  });

  it('preserves the rejection when the evidence base cannot be created', async () => {
    const base = makeTree({ occupied: 'file' });
    const bad = profileInput([2, 3, 4], [100, -7, 600]);
    await expect(completedProfile(bad.directory, 'unwritable', join(base, 'occupied', 'child'))).rejects.toThrow(new Error('Invalid CPU profile: sample[1] invalid delta -7'));
    expect(readdirSync(base)).toEqual(['occupied']);
  });

  it('excludes a partial stage when the second file cannot be written', async () => {
    const base = makeTree();
    const bad = profileInput([2, 3, 4], [100, -7, 600]);
    let faultObserved = false;
    const write = fs.writeFileSync;
    const injected = vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
      if (typeof file === 'string' && file.startsWith(base + sep) && basename(file) === 'descriptor.json') {
        expect(readFileSync(join(dirname(file), 'worker.cpuprofile'))).toEqual(bad.bytes);
        faultObserved = true;
        throw Error('injected evidence write failure');
      }
      write(file, data, options);
    });
    try {
      await expect(completedProfile(bad.directory, 'partial stage', base)).rejects.toThrow(new Error('Invalid CPU profile: sample[1] invalid delta -7'));
      expect(faultObserved).toBe(true);
      const complete = join(base, 'complete');
      expect(existsSync(complete) ? readdirSync(complete) : []).toEqual([]);
    } finally { injected.mockRestore(); }
  });
});

describe('sample-weighted CPU profile summary', () => {
  it('weights self and inclusive time by deltas and keeps runtime/GC in the denominator', async () => {
    const { summarizeCpuProfile } = await import(helper);
    expect(typeof summarizeCpuProfile).toBe('function');
    const result = summarizeCpuProfile(weighted());
    expect(result).toMatchObject({ schema: 'agent-tests/cpu-profile-summary@1', totalSampledUs: 1000, profileSpanUs: 1000, samples: 3, sampledRuntimeUs: 600, sampledGcUs: 600, runtimeShare: 0.6, gcShare: 0.6 });
    expect(result.frames.find((frame: { id: number }) => frame.id === 2)).toMatchObject({ selfUs: 100, selfShare: 0.1, inclusiveUs: 400, inclusiveShare: 0.4 });
    expect(result.frames.find((frame: { id: number }) => frame.id === 3)).toMatchObject({ selfUs: 300, selfShare: 0.3, inclusiveUs: 300 });
    expect(result.frames.find((frame: { id: number }) => frame.id === 1)).toMatchObject({ selfUs: 0, inclusiveUs: 1000 });
    expect(result.frames.reduce((sum: number, frame: { selfUs: number }) => sum + frame.selfUs, 0)).toBe(1000);
    // Root 1000 + outer 400 + inner 300 + GC 600: inclusive frames overlap.
    expect(result.frames.reduce((sum: number, frame: { inclusiveUs: number }) => sum + frame.inclusiveUs, 0)).toBe(2300);
  });

  it.each([
    [[2, 99, 4], [100, 300, 600], 'sample[1] unknown node ID 99'],
    [[2, 3, 4], [100, 300, -1], 'sample[2] invalid delta -1'],
    [[2, 99, 4], [100, -1, 600], 'sample[1] unknown node ID 99'],
    [[2, 3, 4], [100, { nested: 'x'.repeat(5000) }, 600], 'sample[1] invalid delta <object>'],
  ])('identifies the first rejected sample (%#)', async (samples, timeDeltas, reason) => {
    const { summarizeCpuProfile } = await import(helper);
    expect(() => summarizeCpuProfile({ ...weighted(), samples, timeDeltas })).toThrow(new Error('Invalid CPU profile: ' + reason));
  });

  it('accepts a zero delta among positive durations', async () => {
    const { summarizeCpuProfile } = await import(helper);
    expect(summarizeCpuProfile({ ...weighted(), timeDeltas: [100, 0, 600] })).toMatchObject({ samples: 3, totalSampledUs: 700 });
  });

  it('refuses missing timing, invalid references, malformed graphs and fabricated durations', async () => {
    const { summarizeCpuProfile } = await import(helper);
    expect(typeof summarizeCpuProfile).toBe('function');
    const cases: unknown[] = [null, {}, { ...weighted(), samples: [] }, { ...weighted(), timeDeltas: [1] }, { ...weighted(), timeDeltas: [-1, 2, 3] }, { ...weighted(), timeDeltas: [Infinity, 2, 3] }, { ...weighted(), timeDeltas: [0, 0, 0] }, { ...weighted(), samples: [2, 99, 4] }, { ...weighted(), startTime: NaN }, { ...weighted(), endTime: 0 }, { ...weighted(), endTime: 100 }];
    const cycle = weighted(); cycle.nodes[2]!.children = [1]; cases.push(cycle);
    const duplicate = weighted(); duplicate.nodes[2]!.id = 2; cases.push(duplicate);
    const multipleParents = weighted(); multipleParents.nodes[3]!.children = [3]; cases.push(multipleParents);
    const missingChild = weighted(); missingChild.nodes[0]!.children = [999]; cases.push(missingChild);
    for (const profile of cases) expect(() => summarizeCpuProfile(profile)).toThrow(/profile|timing|sample|node|graph|duration/i);
  });
});

describe('worker CPU profile lifecycle boundaries', () => {
  it('refuses bad owners, existing output and nonphysical parents before connecting Inspector', async () => {
    const { createWorkerCpuProfile } = await import(helper);
    const root = makeTree({ 'existing/keep.txt': 'old evidence' });
    const connect = vi.spyOn(Session.prototype, 'connect');
    try {
      for (const ownerId of ['', '../other', 'name with spaces', 'CON', 'a.']) {
        await expect(createWorkerCpuProfile({ outputDirectory: join(root, 'invalid'), ownerId }).start()).rejects.toThrow(/ownerId/);
      }
      await expect(createWorkerCpuProfile({ outputDirectory: join(root, 'existing'), ownerId: 'valid' }).start()).rejects.toThrow(/exist/i);
      symlinkSync(root, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      await expect(createWorkerCpuProfile({ outputDirectory: join(root, 'linked', 'attempt'), ownerId: 'valid' }).start()).rejects.toThrow(/physical/i);
      await expect(createWorkerCpuProfile({ outputDirectory: join(root, 'missing', 'attempt'), ownerId: 'valid' }).start()).rejects.toThrow();
      expect(connect).not.toHaveBeenCalled();
      expect(readFileSync(join(root, 'existing', 'keep.txt'), 'utf8')).toBe('old evidence');
    } finally { connect.mockRestore(); }
  });

  it('refuses overlapping instances, duplicate start and repeated stop; releases for a fresh attempt', async () => {
    const { createWorkerCpuProfile } = await import(helper);
    const root = makeTree();
    const first = createWorkerCpuProfile({ outputDirectory: join(root, 'first'), ownerId: 'first' });
    await expect(first.stop()).rejects.toThrow(/state new/);
    await first.start();
    await expect(first.start()).rejects.toThrow(/state started/);
    const secondCopy = await import(`${helper}?independent-copy`);
    await expect(secondCopy.createWorkerCpuProfile({ outputDirectory: join(root, 'overlap'), ownerId: 'second' }).start()).rejects.toThrow(/active/);
    expect(existsSync(join(root, 'overlap'))).toBe(false);
    await first.stop();
    await expect(first.stop()).rejects.toThrow(/state completed/);
    const next = createWorkerCpuProfile({ outputDirectory: join(root, 'next'), ownerId: 'next' });
    await next.start(); await next.stop();
  });

  it.each(['Profiler.start', 'Profiler.stop'])('retains %s failure, disconnects and releases the helper slot', async method => {
    const { createWorkerCpuProfile } = await import(helper);
    const root = makeTree();
    const original = Session.prototype.post;
    const disconnect = vi.spyOn(Session.prototype, 'disconnect');
    const post = vi.spyOn(Session.prototype, 'post').mockImplementation(function (this: Session, name: string, ...params: unknown[]) {
      if (name === method) return Promise.reject(new Error(`injected ${method} failure`));
      return Reflect.apply(original, this, [name, ...params]);
    });
    const profile = createWorkerCpuProfile({ outputDirectory: join(root, 'failed'), ownerId: 'failed' });
    try {
      if (method === 'Profiler.start') await expect(profile.start()).rejects.toThrow(`injected ${method} failure`);
      else { await profile.start(); await expect(profile.stop()).rejects.toThrow(`injected ${method} failure`); }
      expect(JSON.parse(readFileSync(join(root, 'failed', 'descriptor.json'), 'utf8'))).toMatchObject({ status: 'failed', error: { phase: method === 'Profiler.start' ? 'start' : 'stop', message: `injected ${method} failure` } });
      expect(disconnect).toHaveBeenCalledOnce();
    } finally { post.mockRestore(); disconnect.mockRestore(); }
    const recovered = createWorkerCpuProfile({ outputDirectory: join(root, 'recovered'), ownerId: 'recovered' });
    await recovered.start(); await recovered.stop();
  });

  it('retains a raw-write failure and existing bytes without claiming a completed profile', async () => {
    const { createWorkerCpuProfile } = await import(helper);
    const root = makeTree();
    const outputDirectory = join(root, 'failed');
    const profile = createWorkerCpuProfile({ outputDirectory, ownerId: 'write-failure' });
    await profile.start();
    writeFileSync(join(outputDirectory, 'worker.cpuprofile'), 'do not overwrite');
    await expect(profile.stop()).rejects.toThrow(/exist/i);
    expect(readFileSync(join(outputDirectory, 'worker.cpuprofile'), 'utf8')).toBe('do not overwrite');
    expect(JSON.parse(readFileSync(join(outputDirectory, 'descriptor.json'), 'utf8'))).toMatchObject({ status: 'failed', raw: null, error: { phase: 'stop' } });
    const recovered = createWorkerCpuProfile({ outputDirectory: join(root, 'recovered'), ownerId: 'recovered' });
    await recovered.start(); await recovered.stop();
  });

  it('keeps stop and disconnect errors separately instead of masking either with a completed descriptor', async () => {
    const { createWorkerCpuProfile } = await import(helper);
    const root = makeTree();
    const profile = createWorkerCpuProfile({ outputDirectory: join(root, 'failed'), ownerId: 'failed' });
    await profile.start();
    const originalDisconnect = Session.prototype.disconnect;
    const originalPost = Session.prototype.post;
    const disconnect = vi.spyOn(Session.prototype, 'disconnect').mockImplementation(function (this: Session) { originalDisconnect.call(this); throw new Error('disconnect witness'); });
    const post = vi.spyOn(Session.prototype, 'post').mockImplementation(function (this: Session, name: string, ...params: unknown[]) {
      if (name === 'Profiler.stop') return Promise.reject(new Error('stop witness'));
      return Reflect.apply(originalPost, this, [name, ...params]);
    });
    try {
      const failure = await profile.stop().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors.map(error => error.message)).toEqual(['stop witness', 'disconnect witness']);
      const descriptor = JSON.parse(readFileSync(join(root, 'failed', 'descriptor.json'), 'utf8'));
      expect(descriptor).toMatchObject({ status: 'failed', error: { phase: 'stop', errors: [{ message: 'stop witness' }, { message: 'disconnect witness' }] } });
    } finally { post.mockRestore(); disconnect.mockRestore(); }
    const recovered = createWorkerCpuProfile({ outputDirectory: join(root, 'recovered'), ownerId: 'recovered' });
    await recovered.start(); await recovered.stop();
  });

  it('leaves started evidence when its controlled standalone child is terminated through its own handle', async () => {
    const root = makeTree();
    const outputDirectory = join(root, 'interrupted');
    const code = `import { createWorkerCpuProfile } from ${JSON.stringify(helper)}; const profile = createWorkerCpuProfile({ outputDirectory: ${JSON.stringify(outputDirectory)}, ownerId: 'interrupted' }); await profile.start(); process.stdout.write('READY\\n'); setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('controlled child did not become ready')), 10000);
        child.stdout.on('data', chunk => { if (String(chunk).includes('READY')) { clearTimeout(timeout); resolve(); } });
        child.once('exit', () => { clearTimeout(timeout); reject(new Error('controlled child exited before ready')); });
      });
      expect(JSON.parse(readFileSync(join(outputDirectory, 'descriptor.json'), 'utf8'))).toMatchObject({ status: 'started', raw: null, endedAt: null });
      expect(child.kill('SIGTERM')).toBe(true);
      const result = await closed;
      expect(result.code === null || result.code !== 0).toBe(true);
      expect(JSON.parse(readFileSync(join(outputDirectory, 'descriptor.json'), 'utf8'))).toMatchObject({ status: 'started', raw: null });
      expect(existsSync(join(outputDirectory, 'worker.cpuprofile'))).toBe(false);
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await closed; }
  });
});
