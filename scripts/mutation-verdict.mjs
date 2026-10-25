/** Read-only supplied-byte consistency. Callers acquire, launch and restore; hashes do not attest history. */
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MUTATION_LIMITS = Object.freeze({ files: 1024, jsonBytes: 8 * 1024 * 1024, fileBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, compositionBytes: 64 * 1024 * 1024, records: 20000, stringBytes: 16384, stackBytes: 65536, depth: 16, causeDepth: 4, ancestry: 32 });
const EVIDENCE = 'agent-tests/mutation-evidence@1', NATIVE = 'agent-tests/mutation-native@1', VERDICT = 'agent-tests/mutation-verdict@1', COMPOSITION = 'agent-tests/mutation-composition@1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
const integer = v => Number.isSafeInteger(v) && v >= 0;
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const text = v => typeof v === 'string' && v.length > 0;
function invalid(message) { const error = new Error(`Mutation evidence integrity refusal: ${message}`); error.code = 'MUTATION_EVIDENCE_INVALID'; throw error; }
function bound(value, depth = 0, key = '', causes = 0) {
  if (depth > MUTATION_LIMITS.depth) invalid('record depth bound exceeded');
  if (typeof value === 'string' && Buffer.byteLength(value) > (key === 'stack' ? MUTATION_LIMITS.stackBytes : MUTATION_LIMITS.stringBytes)) invalid('string bound exceeded');
  if (typeof value === 'number' && !Number.isFinite(value)) invalid('nonfinite scalar');
  if (value === null || ['string', 'boolean', 'number', 'undefined'].includes(typeof value)) return;
  if (!object(value) && !Array.isArray(value)) invalid('non-JSON record value');
  if (Array.isArray(value) && value.length > MUTATION_LIMITS.records) invalid('record count bound exceeded');
  for (const [name, child] of Object.entries(value)) {
    const next = name === 'cause' ? causes + 1 : causes;
    if (next > MUTATION_LIMITS.causeDepth) invalid('cause depth bound exceeded');
    if (name === 'ancestry' && Array.isArray(child) && child.length > MUTATION_LIMITS.ancestry) invalid('ancestry bound exceeded');
    bound(child, depth + 1, name, next);
  }
}
function parse(bytes, label) {
  if (bytes.length > MUTATION_LIMITS.jsonBytes) invalid(`${label} JSON read bound exceeded`);
  let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { invalid(`${label} malformed JSON`); }
  bound(value); return value;
}
function declarations(input) {
  if (!object(input)) invalid('expected object envelope');
  const { artifacts: _artifacts, ...envelope } = input; bound(envelope);
  if (!Array.isArray(input.files) || input.files.length > MUTATION_LIMITS.files) invalid('inventory file count bound exceeded or absent');
  const files = new Map(), paths = new Set(); let total = 0;
  for (const file of input.files) {
    if (!object(file) || !text(file.id) || !text(file.path) || !hash(file.sha256) || !integer(file.bytes) || !['bytes', 'native', 'legacy', 'catalogue', 'verdict', 'evidence'].includes(file.kind)) invalid('malformed inventory entry');
    if (file.path.includes('\\') || posix.isAbsolute(file.path) || win32.isAbsolute(file.path) || /^[A-Za-z]:/.test(file.path) || file.path.split('/').some(part => !part || part === '.' || part === '..') || file.path.includes('\0')) invalid('inventory path is not a contained relative file');
    const path = process.platform === 'win32' ? file.path.toLowerCase() : file.path;
    if (files.has(file.id) || paths.has(path)) invalid('duplicate inventory ID/path');
    if (file.bytes > MUTATION_LIMITS.fileBytes || (total += file.bytes) > MUTATION_LIMITS.totalBytes) invalid('inventory byte bound exceeded');
    files.set(file.id, file); paths.add(path);
  }
  return files;
}
function inventory(input) {
  const files = declarations(input);
  if (!object(input.artifacts)) invalid('hydrated raw artifacts map missing');
  for (const [id, file] of files) {
    const bytes = input.artifacts[id];
    if (!Object.hasOwn(input.artifacts, id) || !Buffer.isBuffer(bytes) || bytes.length !== file.bytes || digest(bytes) !== file.sha256) invalid(`hash/length mismatch or missing own raw entry for ${id}`);
    if (file.kind !== 'bytes') parse(bytes, id);
  }
  if (Object.keys(input.artifacts).some(id => !files.has(id))) invalid('unlisted raw artifact');
  return files;
}
function physicalFile(root, file, limit, physicalIdentities, declaredLength) {
  // Windows file IDs can exceed Number's exact range; rounding can falsely alias distinct snapshots.
  const path = join(root, file), info = lstatSync(path, { bigint: true }), actual = realpathSync.native(path);
  const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  const rel = relative(root, actual);
  if (!info.isFile() || info.isSymbolicLink() || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel) || !same(actual, path)) invalid('file is not physically contained or is linked');
  let cursor = dirname(path);
  while (!same(cursor, root)) { if (lstatSync(cursor).isSymbolicLink()) invalid('linked physical directory refused'); const next = dirname(cursor); if (next === cursor) invalid('physical containment failure'); cursor = next; }
  if (info.size > limit) invalid('physical file read bound exceeded');
  if (declaredLength !== undefined && info.size !== BigInt(declaredLength)) invalid('physical file length differs from declaration before read');
  if (physicalIdentities && info.ino !== 0n) {
    const identity = `${info.dev}:${info.ino}`;
    if (physicalIdentities.has(identity)) invalid('multiple inventory paths alias one physical file');
    physicalIdentities.add(identity);
  }
  const length = declaredLength ?? Number(info.size), fd = openSync(path, 'r');
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== BigInt(length)) invalid('physical file identity/length changed before read');
    // One sentinel byte detects growth; never let readFileSync allocate from a racing file size.
    const bytes = Buffer.alloc(length + 1); let used = 0;
    while (used < bytes.length) { const count = readSync(fd, bytes, used, bytes.length - used, null); if (count === 0) break; used += count; }
    const after = fstatSync(fd, { bigint: true });
    if (used !== length || after.size !== BigInt(length) || after.dev !== opened.dev || after.ino !== opened.ino) invalid('physical file length/identity changed during bounded read');
    return bytes.subarray(0, used);
  } finally { closeSync(fd); }
}
/** Reads only the envelope and inventoried contained files, without executing referenced modules.
 * Returns an explicit raw Buffer map; public classifiers recheck its hashes and lengths.
 */
export function readMutationEvidence(path) {
  if (!text(path) || !isAbsolute(path)) invalid('input path must be absolute');
  const absolute = resolve(path), root = dirname(absolute);
  if (lstatSync(root).isSymbolicLink() || realpathSync.native(root) !== root) invalid('bundle directory must use a physical path');
  const input = parse(physicalFile(root, relative(root, absolute), MUTATION_LIMITS.jsonBytes), 'envelope');
  if (!object(input) || Object.hasOwn(input, 'artifacts')) invalid('envelope cannot supply hydrated artifacts');
  if (![EVIDENCE, COMPOSITION].includes(input.schema)) invalid('unsupported envelope schema');
  const files = declarations(input), artifacts = Object.create(null), physicalIdentities = new Set();
  for (const [id, file] of files) {
    const bytes = physicalFile(root, file.path, MUTATION_LIMITS.fileBytes, physicalIdentities, file.bytes);
    if (digest(bytes) !== file.sha256) invalid(`hash mismatch for ${id}`);
    artifacts[id] = bytes;
  }
  const hydrated = { ...input, artifacts }; inventory(hydrated); return hydrated;
}
function canonicalKey(path, platform) {
  if (!text(path)) return null;
  const api = platform === 'win32' ? win32 : platform === 'posix' ? posix : null;
  if (!api || !api.isAbsolute(path) || api.normalize(path) !== path) return null;
  let actual = path;
  if ((platform === 'win32') === (process.platform === 'win32') && existsSync(path)) actual = realpathSync.native(path);
  return platform === 'win32' ? actual.toLowerCase() : actual;
}
function liveRegularIdentity(path, platform) {
  if (platform !== (process.platform === 'win32' ? 'win32' : 'posix') || !text(path)) return null;
  let fd;
  try {
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.ino === 0n) return null;
    fd = openSync(path, 'r'); const held = fstatSync(fd, { bigint: true });
    if (!held.isFile() || held.dev !== before.dev || held.ino !== before.ino) return null;
    return `${held.dev}:${held.ino}`;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function sourceProof(input, files, reasons) {
  const entries = input.source?.entries;
  if (!Array.isArray(entries) || !entries.length || !object(input.mutation)) { reasons.push('SOURCE_EVIDENCE_MISSING'); return null; }
  const byPath = new Map(), physical = new Set();
  const raw = id => files.has(id) ? input.artifacts[id] : null;
  const skipped = input.mutation.applied === false; let restored = true;
  for (const entry of entries) {
    if (!object(entry)) invalid('malformed source entry');
    if (!text(entry.path) || byPath.has(entry.path)) { reasons.push('SOURCE_CLOSURE_INVALID'); continue; }
    const key = canonicalKey(entry.physicalPath, input.pathPlatform);
    if (!input.physicalPathsCanonical || !key || physical.has(key)) reasons.push('SOURCE_PHYSICAL_IDENTITY_UNKNOWN');
    if (key) physical.add(key); byPath.set(entry.path, entry);
    const before = raw(entry.before), mutant = raw(entry.mutant), after = raw(entry.after);
    if (!before || !after) { restored = false; reasons.push('RESTORATION_UNKNOWN'); }
    else if (!before.equals(after)) { restored = false; reasons.push('RESTORATION_FAILED'); }
    if (!before || !mutant) reasons.push('SOURCE_SNAPSHOT_MISSING');
    else if ((skipped || entry.path !== input.mutation.path) && !before.equals(mutant)) reasons.push('UNCHANGED_CLOSURE_CHANGED');
  }
  const touched = byPath.get(input.mutation.path);
  if (!touched) reasons.push('TOUCHED_SOURCE_MISSING');
  if (!skipped && touched) {
    const before = raw(touched.before), actual = raw(touched.mutant); let anchor, replacement;
    try {
      if (!text(input.mutation.anchorBase64) || typeof input.mutation.replacementBase64 !== 'string') throw Error();
      anchor = Buffer.from(input.mutation.anchorBase64, 'base64'); replacement = Buffer.from(input.mutation.replacementBase64, 'base64');
      if (anchor.toString('base64') !== input.mutation.anchorBase64 || replacement.toString('base64') !== input.mutation.replacementBase64) throw Error();
    } catch { reasons.push('MUTATION_DECLARATION_INVALID'); }
    if (input.mutation.applied !== true || !anchor?.length || !replacement || anchor.equals(replacement)) reasons.push('MUTATION_NOT_EXACTLY_APPLIED');
    else if (before && actual) {
      const index = before.indexOf(anchor);
      if (index < 0 || before.indexOf(anchor, index + 1) >= 0) reasons.push('ANCHOR_NOT_UNIQUE');
      else if (!Buffer.concat([before.subarray(0, index), replacement, before.subarray(index + anchor.length)]).equals(actual)) reasons.push('MUTANT_HAS_UNDECLARED_DELTA');
    }
  }
  for (const site of input.assertionSites ?? []) {
    if (!object(site) || !integer(site.line) || site.line === 0 || !integer(site.column) || site.column === 0) { reasons.push('ASSERTION_SITE_UNSUPPORTED'); continue; }
    for (const path of [site.file, site.provider]) { const entry = byPath.get(path); if (!entry || !raw(entry.before)?.equals(raw(entry.mutant) ?? Buffer.alloc(0)) || path === input.mutation.path) reasons.push('ASSERTION_PROVIDER_OR_SITE_CHANGED'); }
    for (const [path, sha, size] of [[site.file, site.sha256, site.bytes], [site.provider, site.providerSha256, site.providerBytes]]) {
      const file = files.get(byPath.get(path)?.before);
      if ((sha !== undefined && file?.sha256 !== sha) || (size !== undefined && file?.bytes !== size)) reasons.push('ASSERTION_PROVIDER_OR_SITE_QUALIFICATION_DIFFERS');
    }
  }
  return { entries, touched, restored, raw };
}
function judgeProof(input, files, source, reasons) {
  const judge = input.judge;
  if (!object(judge) || judge.frozen !== true || !text(judge.version) || !Array.isArray(judge.entries) || !judge.entries.length) { reasons.push('FROZEN_JUDGE_MISSING'); return null; }
  const projected = [], seen = new Set(); let entrypoint = false;
  const touched = canonicalKey(source?.touched?.physicalPath, input.pathPlatform);
  // Strengthen available live facts without inventing inode evidence for deleted historical paths.
  const touchedIdentity = liveRegularIdentity(source?.touched?.physicalPath, input.pathPlatform);
  for (const entry of judge.entries) {
    if (!object(entry)) invalid('malformed judge entry');
    const before = files.get(entry.before), after = files.get(entry.after), key = canonicalKey(entry.physicalPath, input.pathPlatform);
    if (!input.physicalPathsCanonical || !key || seen.has(key)) reasons.push('JUDGE_PHYSICAL_IDENTITY_UNKNOWN');
    if (key && key === touched) reasons.push('JUDGE_IS_MUTATED_SUBJECT'); seen.add(key);
    const judgeIdentity = liveRegularIdentity(entry.physicalPath, input.pathPlatform);
    if (touchedIdentity !== null && judgeIdentity === touchedIdentity) reasons.push('JUDGE_IS_MUTATED_SUBJECT');
    if (!before || !after || before.sha256 !== after.sha256 || before.bytes !== after.bytes) reasons.push('FROZEN_JUDGE_CHANGED_OR_MISSING');
    if (entry.physicalPath === judge.entrypoint) entrypoint = true;
    projected.push({ path: entry.path, physicalPath: entry.physicalPath, sha256: before?.sha256 });
  }
  if (!entrypoint) reasons.push('JUDGE_ENTRYPOINT_NOT_IN_CLOSURE');
  return { entrypoint: judge.entrypoint, version: judge.version, closureSha256: digest(JSON.stringify(projected)) };
}
const greenProcess = p => object(p) && p.closed === true && p.exitCode === 0 && p.signal === null && p.timedOut === false && p.spawnError === null;
function actualFacts(native, identity, judge, platform, role, reasons) {
  const actual = native.actual;
  if (!object(actual) || !['executable', 'node', 'cwd', 'judgeEntrypoint'].every(key => text(actual[key])) || !Array.isArray(actual.argv) || !actual.argv.every(value => typeof value === 'string') || !object(actual.framework) || !text(actual.framework.name) || !text(actual.framework.version)) { reasons.push(`${role}_ACTUAL_NATIVE_FACTS_MISSING`); return; }
  const samePhysical = (a, b) => { const left = canonicalKey(a, platform), right = canonicalKey(b, platform); return left !== null && right !== null && left === right; };
  if (!samePhysical(actual.executable, identity?.executable) || actual.node !== identity?.node) reasons.push(`${role}_ACTUAL_NODE_DIFFERS`);
  if (!samePhysical(actual.cwd, identity?.cwd)) reasons.push(`${role}_ACTUAL_CWD_DIFFERS`);
  if (!equal(actual.argv, identity?.argv)) reasons.push(`${role}_ACTUAL_ARGV_DIFFERS`);
  if (!equal(actual.framework, native.framework) || !equal(actual.framework, identity?.framework)) reasons.push(`${role}_ACTUAL_FRAMEWORK_DIFFERS`);
  if (!samePhysical(actual.judgeEntrypoint, judge?.entrypoint)) reasons.push(`${role}_ACTUAL_JUDGE_DIFFERS`);
}
function stepFacts(steps, caseIds, role, reasons) {
  const byId = new Map(), failed = [];
  const location = value => value === null || (object(value) && text(value.file) && integer(value.line) && value.line > 0 && integer(value.column) && value.column > 0);
  for (const step of steps) {
    if (!object(step)) invalid('malformed native step');
    if (!['id', 'caseId', 'parentId', 'category', 'location', 'error', 'ended'].every(key => Object.hasOwn(step, key))) { reasons.push(`${role}_STEP_FACTS_MISSING`); continue; }
    if (!text(step.id) || !text(step.caseId) || !(step.parentId === null || text(step.parentId)) || !text(step.category) || !location(step.location) || !(step.error === null || object(step.error)) || typeof step.ended !== 'boolean') invalid('malformed native step fields');
    if (!['expect', 'hook', 'fixture', 'pw:api', 'test.step', 'test.attach'].includes(step.category)) reasons.push(`${role}_STEP_CATEGORY_UNSUPPORTED`);
    if (byId.has(step.id)) reasons.push(`${role}_STEP_ID_DUPLICATE`); else byId.set(step.id, step);
    if (!caseIds.has(step.caseId) || !step.ended) reasons.push(`${role}_STEP_OWNER_OR_LIFECYCLE_UNACCOUNTED`);
    if (step.error !== null) failed.push(step);
  }
  for (const step of byId.values()) {
    const visited = new Set([step.id]); let current = step;
    while (current.parentId !== null) {
      const parent = byId.get(current.parentId);
      if (!parent || parent.caseId !== step.caseId || visited.has(parent.id) || visited.size >= MUTATION_LIMITS.ancestry) { reasons.push(`${role}_STEP_ANCESTRY_UNKNOWN_OR_INVALID`); break; }
      visited.add(parent.id); current = parent;
    }
  }
  return failed;
}
function nativeFacts(input, attempt, role, files, source, judge, reasons) {
  if (!object(attempt) || !object(attempt.binding) || !files.has(attempt.native)) { reasons.push(`${role}_ACQUISITION_MISSING`); return null; }
  const file = files.get(attempt.native); if (file.kind !== 'native') invalid('native reference has wrong inventory kind');
  const native = parse(input.artifacts[attempt.native], attempt.native);
  if (!object(native) || native.schema !== NATIVE) invalid('malformed native record/schema');
  const binding = attempt.binding, identity = binding.identity;
  if (!equal(native.binding, binding)) reasons.push(`${role}_NATIVE_BINDING_DIFFERS`);
  if (!text(binding.attemptId) || binding.sourceRole !== (role === 'BASELINE' ? 'before' : 'mutant')) reasons.push(`${role}_SOURCE_ROLE_DIFFERS`);
  const expectedSource = source?.entries.map(entry => ({ path: entry.path, sha256: files.get(entry[binding.sourceRole])?.sha256 }));
  if (!equal(binding.source, expectedSource)) reasons.push(`${role}_SOURCE_BINDING_DIFFERS`);
  if (!object(identity) || !['executable', 'node', 'cwd'].every(key => text(identity[key])) || typeof identity.project !== 'string' || !Array.isArray(identity.argv) || !identity.argv.every(text) || !Array.isArray(identity.selection) || !identity.selection.length || !identity.selection.every(text) || !['configSha256', 'setupSha256', 'lockfileSha256', 'toolchainSha256'].every(key => hash(identity[key]))) reasons.push(`${role}_IDENTITY_MISSING`);
  if (!equal(binding.judge, judge) || !identity?.argv?.includes(judge?.entrypoint)) reasons.push(`${role}_JUDGE_INVOCATION_DIFFERS`);
  if (!equal(native.framework, identity?.framework)) reasons.push(`${role}_FRAMEWORK_BINDING_DIFFERS`);
  actualFacts(native, identity, judge, input.pathPlatform, role, reasons);
  const supported = (native.framework?.name === 'vitest' && native.framework.version === '5.0.5' && native.adapter === 'vitest-5.0.5') || (native.framework?.name === 'playwright' && native.framework.version === '1.64.1' && native.adapter === 'playwright-1.64.1');
  if (!supported) reasons.push(`${role}_NATIVE_PROFILE_UNSUPPORTED`);
  if (native.complete !== true || native.truncated !== false || !Array.isArray(native.projectionFailures) || native.projectionFailures.length) reasons.push(`${role}_NATIVE_INCOMPLETE`);
  if (!Array.isArray(native.cases) || !Array.isArray(native.errors) || !Array.isArray(native.hooks) || !Array.isArray(native.steps) || !object(native.counts)) { reasons.push(`${role}_NATIVE_POPULATION_UNKNOWN`); return { native, identity, population: null, green: false }; }
  const counts = { total: native.cases.length, passed: 0, failed: 0, skipped: 0, todo: 0, pending: 0 }, population = [], ids = new Set();
  for (const item of native.cases) {
    if (!object(item)) invalid('malformed native case');
    if (!text(item.id) || ids.has(item.id) || !text(item.file) || typeof item.project !== 'string' || !Object.hasOwn(counts, item.status) || item.status === 'total') { reasons.push(`${role}_NATIVE_CASE_INVALID`); continue; }
    ids.add(item.id); counts[item.status]++; population.push({ id: item.id, project: item.project, file: item.file, executed: ['passed', 'failed'].includes(item.status), inactive: ['passed', 'failed'].includes(item.status) ? null : item.status });
    if (item.retry !== 0 || item.repeat !== 0 || item.expectedStatus !== 'passed') reasons.push(`${role}_CASE_POLICY_UNSUPPORTED`);
    if (item.retryPolicy !== 0 || item.repeatPolicy !== (native.framework?.name === 'playwright' ? 1 : 0) || (native.framework?.name === 'vitest' && (item.fails !== false || item.nativeMode !== 'run'))) reasons.push(`${role}_CONFIGURED_CASE_POLICY_UNSUPPORTED`);
    if (['passed', 'failed'].includes(item.status) && (item.ended !== true || item.nativeStatus !== item.status)) reasons.push(`${role}_CASE_TERMINAL_FACTS_UNSUPPORTED`);
    if (!Array.isArray(item.errors) || (item.errors.length && item.status === 'passed')) reasons.push(`${role}_CASE_ERRORS_UNACCOUNTED`);
    if (item.error != null && item.status === 'passed') reasons.push(`${role}_CASE_ERROR_ALIAS_UNACCOUNTED`);
    if (item.project !== identity?.project) reasons.push(`${role}_CASE_PROJECT_DIFFERS`);
  }
  const countKeys = Object.keys(counts);
  if (countKeys.some(key => native.counts[key] === null || native.counts[key] === undefined)) reasons.push(`${role}_NATIVE_COUNTS_UNKNOWN`);
  if (countKeys.some(key => native.counts[key] !== null && native.counts[key] !== undefined && (!integer(native.counts[key]) || native.counts[key] !== counts[key]))) reasons.push(`${role}_NATIVE_COUNTS_CONTRADICT`);
  if (counts.passed + counts.failed === 0 || counts.pending > 0) reasons.push(`${role}_EXECUTED_POPULATION_EMPTY_OR_PENDING`);
  if (native.hooks.some(hook => !object(hook))) invalid('malformed native hook');
  if (native.errors.length || native.hooks.some(hook => hook.error || hook.status === 'failed')) reasons.push(`${role}_NATIVE_ERRORS_UNACCOUNTED`);
  const failedSteps = stepFacts(native.steps, ids, role, reasons);
  if (native.runStatus === 'passed' && failedSteps.length) reasons.push(`${role}_STEP_ERRORS_DISAGREE_WITH_GREEN`);
  if (native.framework?.name === 'playwright') {
    for (const item of native.cases) {
      const projects = Array.isArray(native.actual?.projects) ? native.actual.projects.filter(project => object(project) && project.name === item.project) : [];
      if (projects.length !== 1 || projects[0].retries !== 0 || projects[0].repeatEach !== 1) reasons.push(`${role}_ACTUAL_PROJECT_POLICY_UNSUPPORTED`);
    }
  }
  const green = greenProcess(attempt.process) && native.runStatus === 'passed' && counts.passed > 0 && counts.failed === 0 && !native.cases.some(item => item.errors?.length || item.error != null) && native.errors.length === 0 && failedSteps.length === 0;
  return { native, identity, population: population.sort((a, b) => a.id.localeCompare(b.id)), failedSteps, green };
}
function nativePath(path, platform) {
  if (typeof path === 'string' && path.startsWith('file:')) { try { path = fileURLToPath(path, { windows: platform === 'win32' }); } catch { return null; } }
  const api = platform === 'win32' ? win32 : platform === 'posix' ? posix : null;
  if (typeof path !== 'string' || !api || !api.isAbsolute(path)) return null;
  // Native frameworks may report C:/... while acquisition records retain physical C:\... .
  // Normalize native absolute syntax only; declared source paths still require canonical spelling.
  return canonicalKey(api.normalize(path), platform);
}
function sourceLocation(location, site, entry, platform) {
  const key = canonicalKey(entry.physicalPath, platform);
  return object(location) && key !== null && nativePath(location.file, platform) === key && location.line === site.line && location.column === site.column;
}
function admittedSite(input, files, item, framework) {
  if (!Array.isArray(input.assertionSites) || !Array.isArray(input.source?.entries) || !object(framework)) return null;
  const profile = framework.name === 'vitest' ? 'vitest-5.0.5-builtin-toBe-site-v1' : 'playwright-1.64.1-hard-builtin-toBe-site-v1';
  const candidates = (input.assertionSites ?? []).filter(site => object(site) && site.caseId === item.id);
  if (candidates.length !== 1) return null;
  const site = candidates[0], entry = input.source.entries.find(entry => entry.path === site.file), provider = input.source.entries.find(entry => entry.path === site.provider);
  if (site.profile !== profile || site.reviewed !== true || site.builtin !== 'toBe' || !equal(site.framework, framework) || site.project !== item.project || !integer(site.line) || site.line === 0 || !integer(site.column) || site.column === 0 || site.sourceScope?.reviewed !== true || site.sourceScope.contract !== 'hook-free-builtin-toBe-v1') return null;
  if (!entry || !provider || site.providerModule !== (framework.name === 'vitest' ? 'vitest' : '@playwright/test') || site.providerVersion !== framework.version) return null;
  for (const [source, sha, size] of [[entry, site.sha256, site.bytes], [provider, site.providerSha256, site.providerBytes]]) {
    if (!hash(sha) || !integer(size) || ['before', 'mutant', 'after'].some(role => files.get(source[role])?.sha256 !== sha || files.get(source[role])?.bytes !== size)) return null;
  }
  const key = canonicalKey(entry.physicalPath, input.pathPlatform);
  if (key === null || nativePath(item.file, input.pathPlatform) !== key) return null;
  return { site, entry, profile };
}
function errorTuple(error, depth = 0) {
  if (!object(error) || depth > MUTATION_LIMITS.causeDepth || error.truncated === true) return null;
  return ['message', 'stack', 'value', 'location', 'cause'].map(key => {
    if (!Object.hasOwn(error, key)) return { present: false };
    const value = error[key];
    if (key === 'cause' && value !== null) return { present: true, value: errorTuple(value, depth + 1) };
    if (key === 'location' && object(value)) return { present: true, value: { file: value.file, line: value.line, column: value.column } };
    return { present: true, value };
  });
}
function qualifiedFailure(input, files, facts) {
  if (!facts) return null;
  const native = facts.native, child = input.mutant?.process;
  if (!object(native.framework) || ![native.cases, native.errors, native.hooks, native.steps, facts.failedSteps].every(Array.isArray)) return null;
  if (!object(child) || child.closed !== true || !Number.isSafeInteger(child.exitCode) || child.exitCode < 1 || child.signal !== null || child.timedOut !== false || child.spawnError !== null || native.runStatus !== 'failed' || native.errors.length || native.hooks.length) return null;
  const failed = native.cases.filter(item => item.status === 'failed');
  if (failed.length !== 1 || native.cases.some(item => item.status !== 'passed' && item !== failed[0])) return null;
  const item = failed[0];
  if (!Array.isArray(item.errors) || item.errors.length !== 1 || item.ended !== true || item.nativeStatus !== 'failed' || item.expectedStatus !== 'passed' || item.retry !== 0 || item.repeat !== 0) return null;
  const admitted = admittedSite(input, files, item, native.framework);
  if (!admitted) return null;
  const { site, entry, profile } = admitted, error = item.errors[0];
  if (!object(error) || error.truncated === true) return null;
  if (native.framework.name === 'vitest') {
    if (native.steps.length || item.error !== null || error.name !== 'AssertionError' || error.operator !== 'strictEqual' || error.showDiff !== true || typeof error.actual !== 'string' || typeof error.expected !== 'string' || !Array.isArray(error.stacks) || error.stacks.length > 40) return null;
    if (error.stacks.filter(frame => sourceLocation(frame, site, entry, input.pathPlatform)).length !== 1) return null;
  } else if (native.framework.name === 'playwright') {
    if (facts.failedSteps.length !== 1) return null;
    const step = facts.failedSteps[0], alias = item.error;
    if (step.caseId !== item.id || step.parentId !== null || step.category !== 'expect' || step.ended !== true || !sourceLocation(step.location, site, entry, input.pathPlatform) || !sourceLocation(step.error?.location, site, entry, input.pathPlatform)) return null;
    // Exact native-controlled initial projection: message/stack/location present; value/cause absent.
    for (const candidate of [error, alias, step.error]) if (!object(candidate) || candidate.truncated === true || typeof candidate.message !== 'string' || typeof candidate.stack !== 'string' || !object(candidate.location) || Object.hasOwn(candidate, 'value') || Object.hasOwn(candidate, 'cause')) return null;
    const tuple = errorTuple(error);
    if (!tuple || !equal(tuple, errorTuple(alias)) || !equal(tuple, errorTuple(step.error))) return null;
  } else return null;
  return profile;
}
/** Explicitly hydrated input, rechecked raw hashes/lengths. No writes or consumer module execution.
 * Missing acquisition => unclassified; malformed bytes/inventory throw MUTATION_EVIDENCE_INVALID.
 * Assertion profiles are nominal reviewed-scope checks, never authenticated assertion origin.
 */
function canonicalJSON(value) {
  if (Array.isArray(value)) return value.map(canonicalJSON);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJSON(value[key])]));
}
function inputClosure(input, files) {
  if (!Array.isArray(input.source?.entries) || !input.source.entries.length || input.source.entries.some(entry => !object(entry) || !text(entry.path) || !files.has(entry.before))) return null;
  if (object(input.judge) && Array.isArray(input.judge.entries) && input.judge.entries.some(entry => !object(entry) || !text(entry.path))) return null;
  const byPath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  const source = input.source.entries.map(entry => ({ path: entry.path, physicalPath: entry.physicalPath, sha256: files.get(entry.before).sha256, bytes: files.get(entry.before).bytes })).sort(byPath);
  const judge = object(input.judge) && Array.isArray(input.judge.entries) ? { entrypoint: input.judge.entrypoint, version: input.judge.version, entries: input.judge.entries.map(entry => ({ path: entry.path, physicalPath: entry.physicalPath, sha256: files.get(entry.before)?.sha256 ?? null, bytes: files.get(entry.before)?.bytes ?? null })).sort(byPath) } : null;
  return digest(JSON.stringify(canonicalJSON({ source, identity: input.baseline?.binding?.identity ?? null, judge, assertionSites: input.assertionSites ?? [], mutation: input.mutation ? { path: input.mutation.path, anchorBase64: input.mutation.anchorBase64 ?? null, replacementBase64: input.mutation.replacementBase64 ?? null } : null })));
}
export function classifyMutationEvidence(input) {
  const files = inventory(input);
  if (input.schema !== EVIDENCE || !text(input.caseId)) invalid('unsupported evidence schema/case ID');
  const reasons = [], source = sourceProof(input, files, reasons);
  const result = { schema: VERDICT, caseId: input.caseId, verdict: 'unclassified', reasons, restoration: source?.restored ? 'exact' : reasons.includes('RESTORATION_FAILED') ? 'failed' : 'unknown', inputClosureSha256: null, native: { baseline: null, mutant: null }, ...(input.legacy ? { historical: input.legacy } : {}) };
  if (input.legacy) { reasons.push('LEGACY_BINDINGS_NOT_STRICT'); return result; }
  if (input.mutation?.applied === false) {
    if (!text(input.mutation.skipReason)) reasons.push('NONAPPLICATION_REASON_MISSING');
    if (input.mutant !== null && input.mutant !== undefined) reasons.push('SKIP_HAS_MUTANT_LAUNCH');
    result.inputClosureSha256 = inputClosure(input, files);
    if (!reasons.length) result.verdict = 'skipped'; return result;
  }
  const judge = judgeProof(input, files, source, reasons);
  result.inputClosureSha256 = inputClosure(input, files);
  const baseline = nativeFacts(input, input.baseline, 'BASELINE', files, source, judge, reasons), mutant = nativeFacts(input, input.mutant, 'MUTANT', files, source, judge, reasons);
  result.native = { baseline: baseline?.native.runStatus ?? null, mutant: mutant?.native.runStatus ?? null };
  if (!baseline?.green) reasons.push('BASELINE_NOT_GREEN');
  if (!equal(baseline?.identity, mutant?.identity)) reasons.push('ATTEMPT_IDENTITY_DIFFERS');
  if (!baseline?.population || !mutant?.population || !equal(baseline.population, mutant.population)) reasons.push('NATIVE_POPULATION_DIFFERS_OR_UNKNOWN');
  if (mutant?.green) { if (!reasons.length) result.verdict = 'survived'; }
  else {
    const profile = qualifiedFailure(input, files, mutant);
    if (profile && !reasons.length) { result.verdict = 'killed'; result.profile = profile; }
    else reasons.push('MUTANT_NOT_GREEN_OR_FAILURE_PROFILE_UNSUPPORTED');
  }
  result.reasons = [...new Set(reasons)]; return result;
}
/** Small reference validator. Strict verdicts are recomputed from evidence, never copied from claims.
 * No dependency inference, scheduling, additional filesystem reads or reuse authorization.
 * Cumulative work charges each referenced JSON envelope/verdict and its declared classification
 * artifact bytes against compositionBytes, before reparsing/rehashing, in addition to initial inventory bounds.
 */
export function validateMutationComposition(input) {
  const files = inventory(input); if (input.schema !== COMPOSITION) invalid('unsupported composition schema');
  const problems = [], totals = { killed: 0, survived: 0, skipped: 0, unclassified: 0 }, origins = { fresh: 0, reused: 0 }, diagnostics = [];
  let referenceBytes = 0;
  const charge = bytes => { if (!integer(bytes) || bytes > MUTATION_LIMITS.compositionBytes - referenceBytes) invalid('composition cumulative reference byte work bound exceeded'); referenceBytes += bytes; };
  const unknown = (classified, reason) => ({ ...classified, verdict: 'unclassified', referenceVerdict: classified.referenceVerdict ?? classified.verdict, reasons: [...classified.reasons, reason] });
  const catalogueFile = files.get(input.catalogue?.ref);
  if (catalogueFile) charge(catalogueFile.bytes);
  const catalogue = catalogueFile?.kind === 'catalogue' ? parse(input.artifacts[catalogueFile.id], 'catalogue') : null;
  if (catalogueFile?.kind !== 'catalogue' || !Array.isArray(input.catalogue?.caseIds) || !equal(catalogue?.caseIds, input.catalogue.caseIds) || new Set(input.catalogue.caseIds).size !== input.catalogue.caseIds.length) problems.push('CATALOGUE_BINDING_INVALID');
  const declared = new Set(input.catalogue?.caseIds ?? []), seen = new Set();
  if (!Array.isArray(input.entries) || !Array.isArray(input.omitted)) problems.push('COMPOSITION_DECLARATION_MISSING');
  const required = new Map();
  if (!Array.isArray(input.requiredClosures)) problems.push('COMPOSITION_REQUIRED_CLOSURES_MISSING');
  for (const entry of Array.isArray(input.requiredClosures) ? input.requiredClosures : []) {
    if (!object(entry) || !text(entry.caseId) || !hash(entry.closureSha256) || required.has(entry.caseId) || !declared.has(entry.caseId)) problems.push('COMPOSITION_REQUIRED_CLOSURE_INVALID');
    else required.set(entry.caseId, entry.closureSha256);
  }
  for (const entry of Array.isArray(input.entries) ? input.entries : []) {
    if (!object(entry) || !text(entry.caseId) || !declared.has(entry.caseId) || seen.has(entry.caseId)) { problems.push('COMPOSITION_CASE_INVALID_OR_DUPLICATE'); continue; }
    seen.add(entry.caseId);
    let classified = { schema: VERDICT, caseId: entry.caseId, verdict: 'unclassified', reasons: ['REFERENCED_STRICT_EVIDENCE_MISSING'] };
    const admissionProblems = [];
    if (!['fresh', 'reused'].includes(entry.origin)) admissionProblems.push('COMPOSITION_ORIGIN_INVALID'); else origins[entry.origin]++;
    if (!required.has(entry.caseId) || entry.closureSha256 !== required.get(entry.caseId)) admissionProblems.push('COMPOSITION_DECLARED_CLOSURE_DIFFERS');
    if (admissionProblems.length) { problems.push(...admissionProblems); classified.reasons = admissionProblems; totals.unclassified++; diagnostics.push(classified); continue; }
    let reclassified = false;
    if (entry.evidence) {
      const file = files.get(entry.evidence); if (!file || file.kind !== 'evidence') invalid('composition evidence reference invalid');
      charge(file.bytes);
      const bundle = parse(input.artifacts[file.id], 'composition evidence');
      if (!object(bundle) || bundle.schema !== EVIDENCE || bundle.composition || Object.hasOwn(bundle, 'artifacts') || !Array.isArray(bundle.files)) invalid('nested composition/evidence envelope invalid');
      if (bundle.caseId !== entry.caseId) { problems.push('COMPOSITION_EVIDENCE_CASE_DIFFERS'); classified.reasons = ['COMPOSITION_EVIDENCE_CASE_DIFFERS']; }
      else {
        const artifacts = Object.create(null); let artifactBytes = 0;
        for (const local of bundle.files) { if (!object(local) || !equal(files.get(local.id), local)) invalid('composition evidence inventory differs from verified global inventory'); artifactBytes += local.bytes; artifacts[local.id] = input.artifacts[local.id]; }
        charge(artifactBytes);
        classified = classifyMutationEvidence({ ...bundle, artifacts }); reclassified = true;
      }
    }
    const evidenceVerdict = classified.verdict;
    if (reclassified && (!hash(classified.inputClosureSha256) || classified.inputClosureSha256 !== required.get(entry.caseId) || classified.inputClosureSha256 !== entry.closureSha256)) {
      problems.push('COMPOSITION_INPUT_CLOSURE_DIFFERS');
      classified = unknown(classified, 'COMPOSITION_INPUT_CLOSURE_DIFFERS');
    }
    if (entry.verdict) {
      const file = files.get(entry.verdict); if (!file || file.kind !== 'verdict') invalid('composition verdict reference invalid');
      charge(file.bytes);
      const recorded = parse(input.artifacts[file.id], 'recorded verdict');
      let problem = null;
      if (recorded.schema !== VERDICT || recorded.caseId !== entry.caseId || !Object.hasOwn(totals, recorded.verdict)) problem = 'COMPOSITION_RECORDED_VERDICT_INVALID';
      else if (reclassified && recorded.verdict !== evidenceVerdict) problem = 'COMPOSITION_RECORDED_VERDICT_DISAGREES';
      if (problem) { problems.push(problem); classified = unknown(classified, problem); }
    }
    totals[classified.verdict]++; diagnostics.push(classified);
  }
  for (const id of Array.isArray(input.omitted) ? input.omitted : []) { if (!declared.has(id) || seen.has(id)) problems.push('COMPOSITION_OMITTED_INVALID_OR_DUPLICATE'); seen.add(id); }
  if (seen.size !== declared.size || [...declared].some(id => !seen.has(id))) problems.push('COMPOSITION_CATALOGUE_PARTITION_INCOMPLETE');
  return { valid: problems.length === 0, problems: [...new Set(problems)], totals, origins, omitted: input.omitted ?? [], diagnostics, ...(input.historical ? { historical: input.historical } : {}), newFullBatchRun: false, reuseAuthorized: false };
}
