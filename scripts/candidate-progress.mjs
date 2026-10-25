// Internal durable diagnostics. These facts never authorize acceptance, liveness or reuse.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const START = 'agent-tests/candidate-start@1', RECORD = 'agent-tests/candidate-progress@1', INVENTORY = 'agent-tests/candidate-inventory@1';
const kinds = new Set(['owner-discovered', 'owner-collected', 'owner-started', 'owner-ended', 'native-error', 'run-ended', 'reporter-failed']);
const finalName = /^\d{8}\.json$/, temporary = /^\.\d{8}\.json\.[a-f0-9]{16}\.tmp$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_RECORD = 512 * 1024, MAX_READ = 32 * 1024 * 1024, MAX_RECORDS = 20000;
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const text = (value, limit = 16384) => typeof value === 'string' && Buffer.byteLength(value) <= limit;
const nullableText = value => value === null || text(value);
const timestamp = value => text(value, 64) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const fields = (value, required, optional = []) => object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
function validStart(start) {
  if (!fields(start, ['schema', 'attemptId', 'createdAt', 'before', 'toolchainBefore', 'command', 'progress', 'limitations']) || start.schema !== START || !text(start.attemptId, 64) || !/^[a-f0-9-]{36}$/.test(start.attemptId) || !timestamp(start.createdAt)) return false;
  const { before, toolchainBefore: tools, command, progress } = start;
  // Source/toolchain snapshots retain their existing contract; validate the identity-bearing seam,
  // without introducing another recursive input-manifest implementation here.
  if (!object(before) || !text(before.root) || !object(before.head) || !/^[a-f0-9]{40,64}$/.test(before.head.sha) || !object(before.files)) return false;
  if (!object(tools) || !text(tools.node, 128) || !text(tools.executable) || !object(tools.helpers) || Object.values(tools.helpers).some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) return false;
  if (!fields(command, ['executable', 'cwd', 'mode', 'args', 'selectedArgs', 'concurrency', 'resourceDeclaration']) || !text(command.executable) || !text(command.cwd) || before.root !== command.cwd || !['node-test', 'vitest'].includes(command.mode) || ![1, 2].includes(command.concurrency) || !['CPU reviewed by caller', 'serial/unreviewed'].includes(command.resourceDeclaration)) return false;
  if (![command.args, command.selectedArgs].every(args => Array.isArray(args) && args.length <= MAX_RECORDS && args.every(arg => text(arg)))) return false;
  if (!fields(progress, ['capability', 'adapter', 'version'], ['reason']) || !text(progress.version, 128) || (Object.hasOwn(progress, 'reason') && !text(progress.reason))) return false;
  if (progress.capability === 'qualified') {
    if (progress.adapter !== (command.mode === 'node-test' ? 'node-events' : 'vitest-5.0.3') || (command.mode === 'vitest' && progress.version !== '5.0.3')) return false;
  } else if (progress.capability === 'unavailable') {
    if (command.mode !== 'node-test' || progress.adapter !== 'node-events' || !text(progress.reason)) return false;
  } else if (progress.capability === 'unsupported') {
    if (command.mode !== 'vitest' || progress.adapter !== null || !text(progress.reason)) return false;
  } else return false;
  return Array.isArray(start.limitations) && start.limitations.length <= 32 && start.limitations.every(value => text(value));
}
function validOwner(owner) {
  return fields(owner, ['id', 'file'], ['project', 'pool', 'relativeModuleId']) && text(owner.id) && owner.id.length > 0 && text(owner.file) && owner.file.length > 0 && ['project', 'pool', 'relativeModuleId'].every(key => !Object.hasOwn(owner, key) || nullableText(owner[key]));
}
function validDiagnostic(value, module = false) {
  const keys = module ? ['environmentSetupDuration', 'prepareDuration', 'collectDuration', 'setupDuration', 'duration', 'heap', 'concurrencyId', 'workerId'] : ['duration', 'startTime', 'retryCount', 'repeatCount', 'flaky', 'slow', 'heap'];
  return fields(value, keys) && keys.every(key => value[key] === null || (['flaky', 'slow'].includes(key) ? typeof value[key] === 'boolean' : ['retryCount', 'repeatCount', 'concurrencyId', 'workerId'].includes(key) ? integer(value[key]) : number(value[key])));
}
function validError(error, depth = 0) {
  if (error === null) return true;
  const keys = ['name', 'message', 'stack', 'code', 'failureType', 'diff', 'actual', 'expected', 'operator'];
  if (depth > 4 || !fields(error, ['truncated'], [...keys, 'cause']) || typeof error.truncated !== 'boolean') return false;
  if (depth === 4 && (!error.truncated || Object.hasOwn(error, 'cause'))) return false;
  if (!keys.every(key => !Object.hasOwn(error, key) || error[key] === null || typeof error[key] === 'boolean' || (typeof error[key] === 'number' && Number.isFinite(error[key])) || text(error[key], 4096))) return false;
  return !Object.hasOwn(error, 'cause') || validError(error.cause, depth + 1);
}
function validDetails(value) {
  if (!Array.isArray(value.cases) || value.cases.length > 128 || !Array.isArray(value.errors) || value.errors.length > 64 || !integer(value.omittedCases) || !integer(value.omittedErrors) || typeof value.truncated !== 'boolean') return false;
  if ((value.omittedCases > 0 || value.omittedErrors > 0) && !value.truncated) return false;
  if (Buffer.byteLength(JSON.stringify(value.cases)) + Buffer.byteLength(JSON.stringify(value.errors)) > 192 * 1024 + value.cases.length + value.errors.length + 4) return false;
  for (const item of value.cases) {
    if (!fields(item, ['id', 'name', 'fullName', 'state', 'mode', 'diagnostic']) || !text(item.id) || !nullableText(item.name) || !nullableText(item.fullName) || !['passed', 'failed', 'pending', 'skipped'].includes(item.state) || !['run', 'skip', 'todo', 'only'].includes(item.mode) || !validDiagnostic(item.diagnostic)) return false;
  }
  for (const item of value.errors) {
    if (!fields(item, ['scope', 'error'], ['id', 'ownerId', 'definitionFile', 'nativeState']) || !['case', 'module', 'suite', 'run', 'reporter'].includes(item.scope) || !['id', 'ownerId', 'definitionFile'].every(key => !Object.hasOwn(item, key) || nullableText(item[key])) || (Object.hasOwn(item, 'nativeState') && !['passed', 'failed', 'pending', 'skipped'].includes(item.nativeState)) || !validError(item.error)) return false;
  }
  return true;
}
function validPayload(record, start) {
  const envelope = ['schema', 'attemptId', 'startSha256', 'sequence', 'kind', 'reporterReceivedAt'];
  const details = ['cases', 'errors', 'omittedCases', 'omittedErrors', 'truncated'];
  const node = start.command.mode === 'node-test';
  if (record.kind.startsWith('owner-')) {
    if (!validOwner(record.owner)) return false;
    if (record.kind !== 'owner-ended') return fields(record, [...envelope, 'owner']) && (!node || record.kind === 'owner-discovered');
    if (record.cleanup !== 'unknown') return false;
    const keys = node ? ['total', 'passed', 'failed', 'cancelled', 'skipped', 'todo', 'suites', 'topLevel'] : ['total', 'passed', 'failed', 'pending', 'skipped', 'todo', 'cancelled'];
    if (!fields(record.counts, keys) || !keys.every(key => node ? record.counts[key] === null || integer(record.counts[key]) : key === 'cancelled' ? record.counts[key] === null : integer(record.counts[key]))) return false;
    if (node) {
      const known = ['total', 'passed', 'failed', 'cancelled', 'skipped', 'todo'];
      return fields(record, [...envelope, 'owner', 'state', 'counts', 'nativeDurationMs', 'cleanup']) && ['passed', 'failed', 'unknown'].includes(record.state) && (record.nativeDurationMs === null || number(record.nativeDurationMs)) && (!known.every(key => record.counts[key] !== null) || record.counts.total === known.slice(1).reduce((sum, key) => sum + record.counts[key], 0));
    }
    return fields(record, [...envelope, 'owner', 'state', 'counts', 'projectionComplete', 'cleanup', 'diagnostic', ...details]) && ['queued', 'pending', 'skipped', 'failed', 'passed'].includes(record.state) && typeof record.projectionComplete === 'boolean' && (!record.projectionComplete || (!['queued', 'pending'].includes(record.state) && record.counts.pending === 0 && record.counts.total === ['passed', 'failed', 'pending', 'skipped', 'todo'].reduce((sum, key) => sum + record.counts[key], 0))) && validDiagnostic(record.diagnostic, true) && validDetails(record);
  }
  if (record.kind === 'run-ended') {
    if (typeof record.projectionFailed !== 'boolean') return false;
    if (node) return fields(record, [...envelope, 'state', 'nativeDurationMs', 'projectionFailed']) && ['passed', 'failed'].includes(record.state) && (record.nativeDurationMs === null || number(record.nativeDurationMs));
    return fields(record, [...envelope, 'state', 'projectionFailed', 'reportedOwners']) && ['passed', 'failed', 'interrupted'].includes(record.state) && Array.isArray(record.reportedOwners) && record.reportedOwners.length <= MAX_RECORDS && record.reportedOwners.every(validOwner) && new Set(record.reportedOwners.map(owner => owner.id)).size === record.reportedOwners.length;
  }
  if (record.kind === 'reporter-failed' && Object.hasOwn(record, 'message')) return fields(record, [...envelope, 'message']) && text(record.message, 4096);
  return fields(record, [...envelope, ...details]) && validDetails(record) && record.errors.length + record.omittedErrors > 0;
}
export function physicalFile(directory, name, limit = MAX_READ) {
  if (!['attempt-start.json', 'progress-inventory.json', 'receipt.json', 'node-profile.json', 'vitest.json'].includes(name) && !/^progress\/\d{8}\.json$/.test(name)) throw Error('Invalid fixed evidence filename');
  const root = resolve(directory);
  if (lstatSync(root).isSymbolicLink() || !samePath(realpathSync.native(root), root)) throw Error('Symbolic-link attempt path refused');
  const path = join(root, name);
  if (name.startsWith('progress/')) {
    const info = lstatSync(join(root, 'progress'));
    if (info.isSymbolicLink() || !info.isDirectory()) throw Error('Symbolic-link progress directory refused');
  }
  const info = lstatSync(path), actual = realpathSync.native(path), rel = relative(root, actual);
  if (!info.isFile() || info.isSymbolicLink() || rel.startsWith('..') || !samePath(actual, path)) throw Error('Evidence file is not a contained regular file');
  if (info.size > limit) throw Error('Evidence read bound exceeded');
  return readFileSync(path);
}
function publish(directory, name, value, limit = MAX_RECORD) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  if (bytes.length > limit) throw Error('Progress publication bound exceeded');
  const destination = join(directory, name), temp = join(directory, `.${name}.${randomBytes(8).toString('hex')}.tmp`);
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  // Hard-link publication is atomic and refuses an existing destination on every supported OS.
  // Unlike rename(), it cannot replace a completed record. Only this writer owns the directory.
  linkSync(temp, destination); unlinkSync(temp);
  return { file: name, sha256: hash(bytes), bytes: bytes.length };
}
export function startAttempt(directory, facts) {
  const attemptId = randomUUID();
  const ref = publish(directory, 'attempt-start.json', { ...facts, schema: START, attemptId, createdAt: new Date().toISOString() }, MAX_READ);
  mkdirSync(join(directory, 'progress'), { mode: 0o700 });
  return { attemptId, startSha256: ref.sha256 };
}
export function openProgressWriter(binding) {
  const { directory, attemptId, startSha256 } = binding;
  const start = physicalFile(directory, 'attempt-start.json');
  if (hash(start) !== startSha256 || JSON.parse(start).attemptId !== attemptId) throw Error('Wrong attempt/start binding');
  if (recordNames(directory).length) throw Error('Progress already has a writer');
  let sequence = 0;
  return {
    append(kind, facts) {
      if (!kinds.has(kind)) throw Error('Invalid progress kind');
      if (existsSync(join(directory, 'progress-inventory.json'))) throw Error('Progress is sealed');
      if (sequence >= MAX_RECORDS) throw Error('Progress record bound exceeded');
      // Validate the physical write directory; never follow a replaced junction into another attempt.
      const path = join(directory, 'progress'), info = lstatSync(path);
      if (info.isSymbolicLink() || !info.isDirectory() || !samePath(realpathSync.native(path), path)) throw Error('Symbolic-link progress directory refused');
      const next = sequence + 1;
      const ref = publish(join(directory, 'progress'), `${String(next).padStart(8, '0')}.json`, { ...facts, schema: RECORD, attemptId, startSha256, sequence: next, kind, reporterReceivedAt: new Date().toISOString() });
      sequence = next; return ref;
    },
  };
}
export function reporterTransport() {
  const directory = process.env.AGENT_TESTS_PROGRESS_DIRECTORY;
  const attemptId = process.env.AGENT_TESTS_PROGRESS_ATTEMPT;
  const startSha256 = process.env.AGENT_TESTS_PROGRESS_START;
  if (!directory || !attemptId || !startSha256) throw Error('Missing reserved candidate reporter transport');
  const writer = openProgressWriter({ directory, attemptId, startSha256 });
  return { directory, writer, start: JSON.parse(physicalFile(directory, 'attempt-start.json').toString('utf8')) };
}
function recordNames(directory) {
  const path = join(directory, 'progress'), info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isDirectory() || !samePath(realpathSync.native(path), path)) throw Error('Symbolic-link progress directory refused');
  const names = readdirSync(path);
  if (names.length > MAX_RECORDS + 32) throw Error('Progress record count bound exceeded');
  for (const name of names) if (!finalName.test(name) && !temporary.test(name)) throw Error(`Invalid progress filename: ${name.slice(0, 100)}`);
  return names.filter(name => finalName.test(name)).sort().map(name => `progress/${name}`);
}
export function sealProgress(directory, binding) {
  const snapshot = readProgress(directory);
  if (snapshot.problems.length) throw Error(`Cannot seal invalid progress: ${snapshot.problems.join('; ')}`);
  const files = ['attempt-start.json', ...recordNames(directory)].sort().map(file => {
    const bytes = physicalFile(directory, file); return { file, sha256: hash(bytes), bytes: bytes.length };
  });
  return publish(directory, 'progress-inventory.json', { schema: INVENTORY, ...binding, files }, MAX_READ);
}
/** @param {string} directory @param {{file: string, sha256: string, bytes: number} | undefined} [reference] */
export function readProgress(directory, reference = undefined) {
  const result = { sealed: false, problems: [], start: null, records: [], owners: [], endedOwners: [], discoveredUnended: [], observerLiveness: 'unknown', cleanup: 'unknown', remainingPopulation: 'unknown' };
  try {
    const bytes = physicalFile(directory, 'attempt-start.json'); const start = JSON.parse(bytes.toString('utf8')); result.start = start;
    if (!validStart(start)) throw Error('Malformed attempt start payload');
    const startSha256 = hash(bytes), names = recordNames(directory);
    let budget = bytes.length;
    let inventory = null; const verified = new Map();
    if (reference !== undefined || existsSync(join(directory, 'progress-inventory.json'))) {
      const raw = physicalFile(directory, 'progress-inventory.json'); inventory = JSON.parse(raw.toString('utf8'));
      if (reference && (reference.file !== 'progress-inventory.json' || reference.sha256 !== hash(raw) || reference.bytes !== raw.length)) throw Error('Inventory reference differs');
      if (inventory.schema !== INVENTORY || inventory.attemptId !== start.attemptId || inventory.startSha256 !== startSha256 || !Array.isArray(inventory.files)) throw Error('Malformed or wrongly bound inventory');
      const expected = ['attempt-start.json', ...names].sort();
      if (JSON.stringify(inventory.files.map(f => f.file)) !== JSON.stringify(expected)) throw Error('Missing, extra or unsorted inventory files');
      let declaredBytes = 0;
      for (const f of inventory.files) {
        if (!Number.isSafeInteger(f.bytes) || f.bytes < 0 || typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256)) throw Error('Malformed inventory descriptor');
        declaredBytes += f.bytes;
        if (declaredBytes > MAX_READ) throw Error('Aggregate progress read bound exceeded');
      }
      for (const f of inventory.files) {
        const raw = f.file === 'attempt-start.json' ? bytes : physicalFile(directory, f.file, MAX_RECORD);
        if (f.bytes !== raw.length || f.sha256 !== hash(raw)) throw Error(`Inventory bytes differ: ${f.file}`);
        verified.set(f.file, raw);
      }
      result.sealed = true;
    }
    const owners = new Map(); let runEnded = false;
    for (let i = 0; i < names.length; i++) {
      const raw = verified.get(names[i]) ?? physicalFile(directory, names[i], MAX_RECORD); budget += raw.length;
      if (budget > MAX_READ) throw Error('Aggregate progress read bound exceeded');
      const record = JSON.parse(raw.toString('utf8'));
      const number = Number(names[i].slice(9, 17));
      if (record.schema !== RECORD || record.attemptId !== start.attemptId || record.startSha256 !== startSha256 || record.sequence !== number || number < 1 || !kinds.has(record.kind) || !timestamp(record.reporterReceivedAt)) throw Error('Malformed or wrongly bound progress record');
      if (!validPayload(record, start)) throw Error(`Malformed ${record.kind} payload`);
      if (inventory && number !== i + 1) throw Error('Noncontiguous sealed sequence');
      if (runEnded && record.kind !== 'reporter-failed') throw Error('Contradictory record after run end');
      if (record.kind.startsWith('owner-')) {
        const owner = record.owner;
        if (!owner || typeof owner.id !== 'string' || !owner.id || typeof owner.file !== 'string') throw Error('Malformed owner identity');
        const previous = owners.get(owner.id);
        if (previous && previous.file !== owner.file) throw Error('Contradictory owner identity');
        if (previous?.ended) throw Error('Duplicate terminal owner or contradictory transition');
        const state = previous ?? { ...owner, ended: false, lifecycle: [] };
        if (state.lifecycle.includes(record.kind)) throw Error('Duplicate owner transition');
        const rank = ['owner-discovered', 'owner-collected', 'owner-started', 'owner-ended'];
        if (state.lifecycle.length && rank.indexOf(record.kind) < rank.indexOf(state.lifecycle.at(-1))) throw Error('Contradictory owner transition');
        state.lifecycle.push(record.kind);
        if (record.kind === 'owner-ended') { state.ended = true; state.result = record; }
        owners.set(owner.id, state);
      }
      if (record.kind === 'run-ended') { if (runEnded) throw Error('Duplicate run end'); runEnded = true; }
      result.records.push(record);
    }
    result.owners = [...owners.values()];
    result.endedOwners = result.owners.filter(owner => owner.ended).map(owner => owner.id);
    result.discoveredUnended = result.owners.filter(owner => !owner.ended).map(owner => owner.id);
  } catch (error) { result.problems.push(error.message); }
  return result;
}

const scalarLimit = 4096;
const clipped = value => Buffer.byteLength(value) <= scalarLimit ? value : Buffer.from(value).subarray(0, scalarLimit - 3).toString('utf8');
export function projectError(error, seen = new Set(), depth = 0) {
  if (error == null) return null;
  if (depth >= 4 || seen.has(error)) return { truncated: true, message: '[cause omitted]' };
  if (typeof error !== 'object') return { message: clipped(String(error)), truncated: Buffer.byteLength(String(error)) > scalarLimit };
  seen.add(error);
  const projected = { truncated: false };
  for (const key of ['name', 'message', 'stack', 'code', 'failureType', 'diff', 'actual', 'expected', 'operator']) {
    const value = error[key];
    if (typeof value === 'string') { projected[key] = clipped(value); if (Buffer.byteLength(value) > scalarLimit) projected.truncated = true; }
    else if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) projected[key] = value;
    else if (value !== undefined) { projected[key] = null; projected.truncated = true; }
  }
  if (error.cause !== undefined) {
    projected.cause = projectError(error.cause, seen, depth + 1);
    if (projected.cause?.truncated) projected.truncated = true;
  }
  return projected;
}
export function boundedDetails() {
  const cases = [], errors = []; let caseTotal = 0, errorTotal = 0, retainedBytes = 0;
  const take = (array, value, limit) => {
    const size = Buffer.byteLength(JSON.stringify(value));
    if (array.length < limit && retainedBytes + size <= 192 * 1024) { array.push(value); retainedBytes += size; }
  };
  return {
    case(value) { caseTotal++; take(cases, value, 128); },
    error(scope, error) { errorTotal++; take(errors, { ...scope, error: projectError(error) }, 64); },
    result() { return { cases, errors, omittedCases: caseTotal - cases.length, omittedErrors: errorTotal - errors.length, truncated: caseTotal > cases.length || errorTotal > errors.length || errors.some(e => e.error?.truncated) }; },
  };
}
export function echoErrors(details) {
  // One bounded output operation after durable publication. Do not print private arbitrary properties.
  const lines = details.errors.slice(0, 16).map(({ scope, id, error }) => `[candidate ${scope}${id ? ` ${String(id).slice(0, 200)}` : ''}] ${error?.name ?? 'Error'}: ${error?.message ?? ''}\n${error?.stack ?? ''}${error?.diff ? `\n${error.diff}` : ''}${error?.actual !== undefined ? `\nactual: ${JSON.stringify(error.actual)}` : ''}${error?.expected !== undefined ? `\nexpected: ${JSON.stringify(error.expected)}` : ''}`);
  if (lines.length) process.stderr.write(lines.join('\n').slice(0, 32 * 1024) + '\n');
}
