import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { threadId } from 'node:worker_threads';

// Shared by separately imported copies in this JS isolate, not other threads/processes
// or unmanaged Inspector clients. This helper acquires no authority over those clients.
const slot = Symbol.for('agent-tests.worker-cpu-profile.active');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const errorDetails = error => ({ name: error.name, message: error.message, ...(error instanceof AggregateError ? { errors: error.errors.map(errorDetails) } : {}) });

async function writeNew(path, bytes) {
  const file = await open(path, 'wx');
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function publish(directory, descriptor) {
  const temporary = join(directory, `descriptor-${randomUUID()}.tmp`);
  await writeNew(temporary, JSON.stringify(descriptor, null, 2) + '\n');
  await rename(temporary, join(directory, 'descriptor.json'));
}

/** Explicit opt-in lifecycle. An instance permits exactly one start and one stop. */
export function createWorkerCpuProfile({ outputDirectory, ownerId }) {
  let state = 'new';
  let session;
  let descriptor;
  let ownedDirectory = false;
  const token = {};

  function release() {
    try {
      session?.disconnect();
    } finally {
      if (globalThis[slot] === token) delete globalThis[slot];
    }
  }

  async function failed(error, phase) {
    state = 'failed';
    if (ownedDirectory && descriptor) {
      descriptor = { ...descriptor, status: 'failed', endedAt: new Date().toISOString(), error: { phase, ...errorDetails(error) } };
      try {
        await publish(outputDirectory, descriptor);
      } catch (evidenceError) {
        return new AggregateError([error, evidenceError], `${phase} failed; failed descriptor could not be published`);
      }
    }
    return error;
  }

  return {
    async start() {
      if (state !== 'new') throw new Error(`Cannot start CPU profile in state ${state}`);
      state = 'starting';
      try {
        if (typeof ownerId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ownerId) || ownerId.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(ownerId)) {
          throw new Error('ownerId must be a portable nonempty identifier');
        }
        if (typeof outputDirectory !== 'string' || !isAbsolute(outputDirectory) || resolve(outputDirectory) !== normalize(outputDirectory)) {
          throw new Error('outputDirectory must be an absolute normalized new directory');
        }
        const parent = dirname(outputDirectory);
        const physical = await realpath(parent);
        const canonical = path => process.platform === 'win32' ? path.toLowerCase() : path;
        if (canonical(physical) !== canonical(parent)) throw new Error('outputDirectory parent must be physical (no symlink ancestry)');
        if (globalThis[slot]) throw new Error('Another helper CPU profile is active in this JavaScript isolate');
        globalThis[slot] = token;
        await mkdir(outputDirectory); // Exclusive: never reuse or clean an existing attempt.
        ownedDirectory = true;
        descriptor = {
          schema: 'agent-tests/worker-cpu-profile@1', status: 'started', ownerId,
          node: process.version, platform: process.platform, architecture: process.arch,
          worker: { pid: process.pid, threadId, vitestPoolId: process.env.VITEST_POOL_ID ?? null, vitestWorkerId: process.env.VITEST_WORKER_ID ?? null },
          startedAt: new Date().toISOString(), endedAt: null, raw: null,
        };
        await publish(outputDirectory, descriptor);
        session = new Session();
        session.connect();
        await session.post('Profiler.enable');
        await session.post('Profiler.start');
        state = 'started';
        return descriptor;
      } catch (error) {
        let failure = error;
        try { release(); } catch (cleanupError) { failure = new AggregateError([error, cleanupError], 'CPU profile start and disconnect failed'); }
        throw await failed(failure, 'start');
      }
    },

    async stop() {
      if (state !== 'started') throw new Error(`Cannot stop CPU profile in state ${state}`);
      state = 'stopping';
      let failure;
      let raw;
      try {
        const { profile } = await session.post('Profiler.stop');
        const bytes = Buffer.from(JSON.stringify(profile));
        const file = 'worker.cpuprofile';
        await writeNew(join(outputDirectory, file), bytes);
        const retained = await readFile(join(outputDirectory, file));
        if (retained.length !== bytes.length || hash(retained) !== hash(bytes)) throw new Error('Raw CPU profile verification failed');
        raw = { file, bytes: retained.length, sha256: hash(retained) };
      } catch (error) {
        failure = error;
      } finally {
        try { release(); } catch (cleanupError) {
          failure = failure ? new AggregateError([failure, cleanupError], 'CPU profile stop and disconnect failed') : cleanupError;
        }
      }
      if (failure) throw await failed(failure, 'stop');
      descriptor = { ...descriptor, status: 'completed', endedAt: new Date().toISOString(), raw };
      try {
        await publish(outputDirectory, descriptor);
      } catch (error) {
        throw await failed(error, 'publish');
      }
      state = 'completed';
      return descriptor;
    },
  };
}

/** Time-weighted generated-frame locations; neither source mapping nor wall savings. */
export function summarizeCpuProfile(profile) {
  const invalid = message => { throw new Error(`Invalid CPU profile: ${message}`); };
  const finite = value => Number.isFinite(value) && value >= 0;
  if (!profile || !Array.isArray(profile.nodes) || !profile.nodes.length || !Array.isArray(profile.samples) || !profile.samples.length || !Array.isArray(profile.timeDeltas)) invalid('missing nodes, samples or timing');
  if (!finite(profile.startTime) || !finite(profile.endTime) || profile.endTime <= profile.startTime || profile.samples.length !== profile.timeDeltas.length) invalid('inconsistent timing');
  const nodes = new Map();
  const sourceNodes = new Map();
  const parents = new Map();
  for (const node of profile.nodes) {
    if (!node || !Number.isSafeInteger(node.id) || node.id <= 0 || nodes.has(node.id)) invalid('duplicate or invalid node');
    const frame = node.callFrame;
    if (!frame || typeof frame.functionName !== 'string' || typeof frame.url !== 'string' || typeof frame.scriptId !== 'string' || !Number.isInteger(frame.lineNumber) || frame.lineNumber < -1 || !Number.isInteger(frame.columnNumber) || frame.columnNumber < -1) invalid('unusable node callFrame');
    if (node.children !== undefined && !Array.isArray(node.children)) invalid('invalid node children');
    nodes.set(node.id, { id: node.id, callFrame: { ...frame }, selfUs: 0, inclusiveUs: 0 });
    sourceNodes.set(node.id, node);
  }
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) {
      if (!nodes.has(child) || child === node.id || parents.has(child)) invalid('missing child or multiple-parent graph');
      parents.set(child, node.id);
    }
  }
  const roots = profile.nodes.filter(node => !parents.has(node.id));
  if (roots.length !== 1) invalid('graph must have one root');
  const visited = new Set();
  const pending = [roots[0]];
  while (pending.length) {
    const node = pending.pop();
    if (visited.has(node.id)) invalid('cyclic graph');
    visited.add(node.id);
    for (const child of node.children ?? []) pending.push(sourceNodes.get(child));
  }
  if (visited.size !== nodes.size) invalid('disconnected or cyclic graph');
  let totalSampledUs = 0;
  for (let index = 0; index < profile.samples.length; index++) {
    const sampled = nodes.get(profile.samples[index]);
    const delta = profile.timeDeltas[index];
    if (!sampled || !finite(delta)) invalid('invalid sample reference or duration');
    totalSampledUs += delta;
    sampled.selfUs += delta;
    for (let id = sampled.id; id !== undefined; id = parents.get(id)) nodes.get(id).inclusiveUs += delta;
  }
  if (!finite(totalSampledUs) || totalSampledUs === 0) invalid('no positive finite sampled duration');
  const runtimeNames = new Set(['(root)', '(program)', '(idle)', '(garbage collector)']);
  const frames = [...nodes.values()].map(frame => ({ ...frame, selfShare: frame.selfUs / totalSampledUs, inclusiveShare: frame.inclusiveUs / totalSampledUs }));
  const sampledRuntimeUs = frames.reduce((sum, frame) => sum + (runtimeNames.has(frame.callFrame.functionName) ? frame.selfUs : 0), 0);
  const sampledGcUs = frames.reduce((sum, frame) => sum + (frame.callFrame.functionName === '(garbage collector)' ? frame.selfUs : 0), 0);
  return {
    schema: 'agent-tests/cpu-profile-summary@1', totalSampledUs,
    profileSpanUs: profile.endTime - profile.startTime, samples: profile.samples.length,
    sampledRuntimeUs, sampledGcUs, runtimeShare: sampledRuntimeUs / totalSampledUs, gcShare: sampledGcUs / totalSampledUs,
    frames: frames.sort((a, b) => b.selfUs - a.selfUs || a.id - b.id),
  };
}
