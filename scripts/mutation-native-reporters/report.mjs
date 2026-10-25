// Shared native projection/publication only. No framework import, runner or verdict predicate.
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const physical = value => realpathSync.native(value);
const LIMIT = Object.freeze({ text: 16384, stack: 65536, entries: 20000, bytes: 6 * 1024 * 1024, cause: 4, frames: 40 });
function checkedTransport() {
  const raw = process.env.AGENT_TESTS_MUTATION_TRANSPORT;
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 131072) throw new Error('Missing or oversized reserved mutation transport');
  const transport = JSON.parse(raw);
  if (!object(transport) || transport.schema !== 'agent-tests/mutation-transport@1' || !object(transport.binding) || !object(transport.binding.identity) || !object(transport.binding.judge) || typeof transport.output !== 'string' || !isAbsolute(transport.output)) throw new Error('Invalid reserved mutation transport');
  const output = resolve(transport.output), parent = dirname(output);
  if (!samePath(parent, physical(parent)) || !lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) throw new Error('Mutation output directory must be physical');
  if (existsSync(output)) throw new Error('Mutation output already exists');
  // lstat also refuses a dangling destination link that existsSync cannot see.
  try { lstatSync(output); throw new Error('Mutation output already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...transport, output };
}
export class NativeReport {
  constructor(framework, entrypoint) {
    const transport = checkedTransport();
    this.output = transport.output; this.used = 0; this.bytes = 0; this.exhausted = false;
    const cwd = physical(process.cwd()), requireConsumer = createRequire(join(cwd, 'package.json'));
    const packagePath = requireConsumer.resolve(framework === 'vitest' ? 'vitest/package.json' : '@playwright/test/package.json');
    const actualFramework = { name: framework, version: JSON.parse(readFileSync(packagePath, 'utf8')).version };
    const actual = { executable: physical(process.execPath), node: process.versions.node, cwd, argv: process.argv.slice(1), framework: actualFramework, judgeEntrypoint: physical(entrypoint) };
    this.native = { schema: 'agent-tests/mutation-native@1', binding: transport.binding, framework: actualFramework, adapter: `${framework}-${actualFramework.version}`, actual, complete: false, projectionFailures: [], truncated: false, runStatus: null, counts: { total: null, passed: null, failed: null, skipped: null, todo: null, pending: null }, retainedCounts: null, retainedDetails: null, omissions: { observedDiscardedCallbacks: 0, observedDiscardedItems: 0, observedTextValuesTruncatedOrOmitted: 0, observedTextUtf8BytesNotRetained: 0, unobservedRemainingPopulation: null, accounting: 'Observed projection-boundary losses are lower bounds; unsampled nested facts and remaining populations are unknown.' }, cases: [], errors: [], hooks: [], steps: [] };
    const identity = transport.binding.identity, judge = transport.binding.judge;
    if (identity.framework?.name !== actualFramework.name || identity.framework?.version !== actualFramework.version) this.failure('DECLARED_FRAMEWORK_DIFFERS');
    if (!samePath(identity.cwd ?? '', cwd)) this.failure('DECLARED_CWD_DIFFERS');
    if (JSON.stringify(identity.argv) !== JSON.stringify(actual.argv)) this.failure('DECLARED_ARGV_DIFFERS');
    if (identity.node !== actual.node || typeof identity.executable !== 'string' || !samePath(physical(identity.executable), actual.executable)) this.failure('DECLARED_NODE_DIFFERS');
    if (typeof judge.entrypoint !== 'string' || !samePath(physical(judge.entrypoint), actual.judgeEntrypoint) || judge.version !== 'mutation-native@1') this.failure('DECLARED_JUDGE_DIFFERS');
    if (typeof transport.binding.attemptId !== 'string' || !['before', 'mutant'].includes(transport.binding.sourceRole) || !Array.isArray(transport.binding.source)) this.failure('DECLARED_ATTEMPT_INVALID');
    if (!['vitest-5.0.5', 'playwright-1.64.1'].includes(this.native.adapter)) this.failure('NATIVE_VERSION_UNSUPPORTED');
    this.reserve(Buffer.byteLength(JSON.stringify(transport.binding)) + 2048);
    actual.argv = this.list(actual.argv).map(value => this.text(value, LIMIT.stack));
  }
  failure(reason) { if (this.native.projectionFailures.length < 32) this.native.projectionFailures.push(reason); else this.omitItems(1); }
  omitItems(count) { this.native.truncated = true; this.native.omissions.observedDiscardedItems += count; }
  reserve(bytes = 512, kind = 'items') {
    if (!this.exhausted && (++this.used > LIMIT.entries || bytes > LIMIT.bytes - this.bytes)) { this.exhausted = true; this.native.truncated = true; this.failure('NATIVE_PROJECTION_BUDGET'); }
    if (this.exhausted) {
      if (kind === 'callbacks') this.native.omissions.observedDiscardedCallbacks++;
      if (kind === 'items') this.native.omissions.observedDiscardedItems++;
      return false;
    }
    this.bytes += bytes; return true;
  }
  capture(fn) { if (!this.reserve(512, 'callbacks')) return null; try { return fn(); } catch { this.failure('PUBLIC_PROJECTION_FAILED'); return null; } }
  text(value, limit = LIMIT.text) {
    if (typeof value !== 'string') return null;
    const originalBytes = Buffer.byteLength(value);
    let result = value;
    if (originalBytes > limit) {
      this.native.truncated = true; result = Buffer.from(value.slice(0, limit)).subarray(0, limit).toString('utf8');
      while (Buffer.byteLength(result) > limit) result = result.slice(0, -1);
    }
    // Measure only one already bounded scalar, never a whole accumulated report.
    const retained = !this.exhausted && this.reserve(Buffer.byteLength(JSON.stringify(result)) + 32, null) ? result : null;
    const lostBytes = originalBytes - (retained === null ? 0 : Buffer.byteLength(retained));
    if (lostBytes > 0 || retained === null) { this.native.omissions.observedTextValuesTruncatedOrOmitted++; this.native.omissions.observedTextUtf8BytesNotRetained += lostBytes; }
    return retained;
  }
  list(iterable) {
    const out = [];
    for (const item of iterable) { if (!this.reserve()) break; out.push(item); }
    return out;
  }
  location(value, file) {
    if (value == null) return null;
    if (!object(value) || !Number.isSafeInteger(value.line) || value.line < 1 || !Number.isSafeInteger(value.column) || value.column < 1) { this.failure('PUBLIC_LOCATION_INVALID'); return null; }
    const result = { line: value.line, column: value.column };
    if (typeof value.file === 'string') result.file = this.text(value.file);
    else if (typeof file === 'string') result.file = this.text(file);
    return result;
  }
  error(value, depth = 0, seen = new Set()) {
    if (value == null) return null;
    if (!this.reserve()) return null;
    if (!object(value)) { this.failure('PUBLIC_ERROR_NOT_STRUCTURED'); return { value: this.text(String(value)) }; }
    if (depth > LIMIT.cause || seen.has(value)) { this.omitItems(1); return null; }
    seen.add(value); const out = {};
    for (const key of ['name', 'message', 'stack', 'value', 'actual', 'expected', 'operator', 'showDiff', 'code']) {
      const item = value[key];
      if (item === undefined) continue;
      if (typeof item === 'string') out[key] = this.text(item, key === 'stack' ? LIMIT.stack : LIMIT.text);
      else if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) out[key] = item;
      else this.failure(`PUBLIC_ERROR_${key}_NOT_SCALAR`);
    }
    if (value.location !== undefined) out.location = this.location(value.location);
    if (value.cause !== undefined) out.cause = value.cause === null ? null : this.error(value.cause, depth + 1, seen);
    if (Array.isArray(value.stacks)) {
      if (value.stacks.length > LIMIT.frames) this.omitItems(value.stacks.length - LIMIT.frames);
      out.stacks = value.stacks.slice(0, LIMIT.frames).map(frame => ({ ...this.location(frame), method: this.text(frame.method ?? '') }));
    }
    seen.delete(value); return this.exhausted ? null : out;
  }
  scopedError(scope, ownerId, error) { if (this.reserve()) this.native.errors.push({ scope, ownerId: this.text(ownerId), error: this.error(error) }); }
  summarize() {
    const counts = { total: this.native.cases.length, passed: 0, failed: 0, skipped: 0, todo: 0, pending: 0 };
    let unknown = 0;
    for (const item of this.native.cases) { if (Object.hasOwn(counts, item.status) && item.status !== 'total') counts[item.status]++; else { unknown++; this.failure('NATIVE_CASE_STATE_UNKNOWN'); } }
    this.native.complete = !this.native.truncated && this.native.projectionFailures.length === 0;
    this.native.counts = this.native.complete ? counts : Object.fromEntries(Object.keys(counts).map(key => [key, null]));
    this.native.retainedCounts = { ...counts, unknown };
    this.native.retainedDetails = { cases: this.native.cases.length, errors: this.native.errors.length, caseErrors: this.native.cases.reduce((sum, item) => sum + (Array.isArray(item.errors) ? item.errors.length : 0), 0), hooks: this.native.hooks.length, steps: this.native.steps.length };
    this.native.omissions.unobservedRemainingPopulation = this.native.complete ? 0 : null;
  }
  publish(status) {
    this.native.runStatus = this.text(status);
    this.summarize();
    let bytes = Buffer.from(JSON.stringify(this.native) + '\n');
    if (bytes.length > 8 * 1024 * 1024) { this.omitItems(this.native.cases.length + this.native.steps.length + this.native.errors.length + this.native.hooks.length); this.failure('NATIVE_AGGREGATE_BOUND'); this.native.cases = []; this.native.steps = []; this.native.errors = []; this.native.hooks = []; this.summarize(); bytes = Buffer.from(JSON.stringify(this.native) + '\n'); }
    const temporary = join(dirname(this.output), `.mutation-native-${randomUUID()}.tmp`);
    let fd, created = false;
    try { fd = openSync(temporary, 'wx', 0o600); created = true; writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined; linkSync(temporary, this.output); }
    finally { if (fd !== undefined) closeSync(fd); if (created && existsSync(temporary)) unlinkSync(temporary); }
  }
}
