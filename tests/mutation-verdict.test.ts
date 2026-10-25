/** @lane merge
 * @subject scripts/mutation-verdict.mjs
 * Synthetic records below test the verifier contract, not native-profile qualification.
 */
import crypto, { createHash } from 'node:crypto';
import fs, { linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as mutation from '../scripts/mutation-verdict.mjs';
import { physicalTemp } from './helpers/physical-temp.ts';

const made: string[] = [];
afterEach(() => { for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true }); });
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
// Mutable fixture type intentionally permits individual malformed-acquisition controls.
type Fixture = Record<string, any>;
function fixture(): Fixture {
  const bundle: Fixture = { schema: 'agent-tests/mutation-evidence@1', caseId: 'reporter-self', pathPlatform: 'posix', physicalPathsCanonical: true, files: [], artifacts: {}, source: { entries: [] }, mutation: { path: 'subject.mjs', applied: true, anchorBase64: Buffer.from('false').toString('base64'), replacementBase64: Buffer.from('true').toString('base64') }, assertionSites: [] };
  const add = (id: string, bytes: Buffer | string, kind = 'bytes') => {
    const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    bundle.files.push({ id, path: `${id}.bin`, sha256: hash(raw), bytes: raw.length, kind }); bundle.artifacts[id] = raw; return id;
  };
  const subject = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('\ufeffexport const answer = false;\r\n')]);
  const changed = Buffer.concat([subject.subarray(0, subject.indexOf('false')), Buffer.from('true'), subject.subarray(subject.indexOf('false') + 5)]);
  bundle.source.entries.push({ path: 'subject.mjs', physicalPath: '/acquired/source/subject.mjs', before: add('source-before', subject), mutant: add('source-mutant', changed), after: add('source-after', subject) });
  const assertion = add('assertion', 'expect(answer).toBe(false);\r\n');
  const provider = add('provider', 'native builtin provider fixture\n');
  bundle.source.entries.push({ path: 'assertion.test.ts', physicalPath: '/acquired/source/assertion.test.ts', before: assertion, mutant: assertion, after: assertion }, { path: 'provider.mjs', physicalPath: '/acquired/source/provider.mjs', before: provider, mutant: provider, after: provider });
  const frozen = add('judge', 'independent frozen reporter\n');
  bundle.judge = { frozen: true, entrypoint: '/acquired/frozen/reporter.mjs', version: 'fixture-1', entries: [{ path: 'reporter.mjs', physicalPath: '/acquired/frozen/reporter.mjs', before: frozen, after: frozen }] };
  const judgeDigest = hash(JSON.stringify(bundle.judge.entries.map((entry: Fixture) => ({ path: entry.path, physicalPath: entry.physicalPath, sha256: bundle.files.find((file: Fixture) => file.id === entry.before).sha256 }))));
  const identity = { executable: '/acquired/node', node: '26.7.0', argv: ['runner.mjs', '--reporter', bundle.judge.entrypoint], cwd: '/acquired/source', framework: { name: 'vitest', version: '5.0.5' }, project: 'unit', selection: ['assertion.test.ts'], configSha256: hash('config'), setupSha256: hash('setup'), lockfileSha256: hash('lock'), toolchainSha256: hash('toolchain') };
  for (const [role, sourceRole] of [['baseline', 'before'], ['mutant', 'mutant']]) {
    const binding = { attemptId: role, sourceRole, source: bundle.source.entries.map((entry: Fixture) => ({ path: entry.path, sha256: bundle.files.find((file: Fixture) => file.id === entry[sourceRole!]).sha256 })), identity: structuredClone(identity), judge: { entrypoint: bundle.judge.entrypoint, version: bundle.judge.version, closureSha256: judgeDigest } };
    const actual = { executable: identity.executable, node: identity.node, cwd: identity.cwd, argv: structuredClone(identity.argv), framework: structuredClone(identity.framework), judgeEntrypoint: bundle.judge.entrypoint };
    const native = { schema: 'agent-tests/mutation-native@1', binding: structuredClone(binding), framework: structuredClone(identity.framework), adapter: 'vitest-5.0.5', actual, complete: true, projectionFailures: [], truncated: false, runStatus: 'passed', counts: { total: 1, passed: 1, failed: 0, skipped: 0, todo: 0, pending: 0 }, cases: [{ id: 'native-case-1', project: 'unit', file: 'assertion.test.ts', location: { line: 1, column: 1 }, status: 'passed', nativeStatus: 'passed', retry: 0, repeat: 0, retryPolicy: 0, repeatPolicy: 0, nativeMode: 'run', fails: false, ended: true, expectedStatus: 'passed', error: null, errors: [] }], errors: [], hooks: [], steps: [] };
    bundle[role!] = { process: { closed: true, exitCode: 0, signal: null, timedOut: false, spawnError: null }, binding, native: add(`${role}-native`, JSON.stringify(native), 'native') };
  }
  return bundle;
}
function replaceArtifact(bundle: Fixture, id: string, bytes: Buffer | string) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes); bundle.artifacts[id] = raw;
  Object.assign(bundle.files.find((file: Fixture) => file.id === id), { sha256: hash(raw), bytes: raw.length });
}
function editNative(bundle: Fixture, role: string, edit: (native: Fixture) => void) {
  const id = bundle[role].native; const native = JSON.parse(bundle.artifacts[id].toString('utf8')); edit(native); replaceArtifact(bundle, id, JSON.stringify(native));
}
function classify(bundle: Fixture) { return mutation.classifyMutationEvidence(bundle); }
function disk(bundle = fixture()) {
  const directory = physicalTemp('tests-mutation-'); made.push(directory);
  for (const file of bundle.files) writeFileSync(join(directory, file.path), bundle.artifacts[file.id]);
  const { artifacts: _artifacts, ...envelope } = bundle;
  const path = join(directory, 'bundle.json'); writeFileSync(path, JSON.stringify(envelope)); return { directory, path, bundle, envelope };
}
/** Synthetic projections exercise nominal admission only; actual consumer acceptance is separate. */
function profileFixture(framework: 'vitest' | 'playwright'): Fixture {
  const bundle = fixture(), version = framework === 'vitest' ? '5.0.5' : '1.64.1';
  const test = bundle.files.find((file: Fixture) => file.id === 'assertion'), provider = bundle.files.find((file: Fixture) => file.id === 'provider');
  const site = { profile: framework === 'vitest' ? 'vitest-5.0.5-builtin-toBe-site-v1' : 'playwright-1.64.1-hard-builtin-toBe-site-v1', reviewed: true, builtin: 'toBe', framework: { name: framework, version }, caseId: 'native-case-1', project: 'unit', file: 'assertion.test.ts', sha256: test.sha256, bytes: test.bytes, line: 1, column: 1, provider: 'provider.mjs', providerSha256: provider.sha256, providerBytes: provider.bytes, providerModule: framework === 'vitest' ? 'vitest' : '@playwright/test', providerVersion: version, sourceScope: { reviewed: true, contract: 'hook-free-builtin-toBe-v1' } };
  bundle.assertionSites = [site]; bundle.mutant.process.exitCode = 1;
  for (const role of ['baseline', 'mutant']) {
    bundle[role].binding.identity.framework = { name: framework, version };
    editNative(bundle, role, native => {
      native.binding = structuredClone(bundle[role].binding); native.framework = { name: framework, version }; native.actual.framework = { name: framework, version }; native.adapter = `${framework}-${version}`;
      native.cases[0].file = '/acquired/source/assertion.test.ts';
      if (framework === 'playwright') { native.cases[0].repeatPolicy = 1; native.actual.projects = [{ name: 'unit', retries: 0, repeatEach: 1 }]; }
      if (role === 'mutant') {
        native.runStatus = 'failed'; native.counts.passed = 0; native.counts.failed = 1; native.cases[0].status = 'failed'; native.cases[0].nativeStatus = 'failed';
        const location = { file: '/acquired/source/assertion.test.ts', line: 1, column: 1 };
        const error = framework === 'vitest' ? { name: 'AssertionError', message: 'timeout import SyntaxError no tests', stack: 'diagnostic only', actual: 'true', expected: 'false', operator: 'strictEqual', showDiff: true, stacks: [{ ...location, method: 'native assertion' }] } : { message: 'timeout import SyntaxError no tests', stack: 'diagnostic only', location };
        native.cases[0].errors = [error];
        if (framework === 'playwright') { native.cases[0].error = structuredClone(error); native.steps = [{ id: 'before-hooks', caseId: 'native-case-1', parentId: null, category: 'hook', location: null, error: null, ended: true }, { id: 'failed-expect', caseId: 'native-case-1', parentId: null, category: 'expect', location, error: structuredClone(error), ended: true }]; }
      }
    });
  }
  return bundle;
}

describe('read-only mutation evidence', () => {
  it('keeps explicitly unknown native totals distinct from contradictory known totals', () => {
    const unknown = fixture();
    editNative(unknown, 'mutant', native => {
      for (const key of Object.keys(native.counts)) native.counts[key] = null;
      native.complete = false;
    });
    const unknownResult = classify(unknown);
    expect(unknownResult.verdict).toBe('unclassified');
    expect(unknownResult.reasons).toContain('MUTANT_NATIVE_COUNTS_UNKNOWN');
    expect(unknownResult.reasons).not.toContain('MUTANT_NATIVE_COUNTS_CONTRADICT');
    const contradiction = fixture();
    editNative(contradiction, 'mutant', native => { native.counts.passed = 2; });
    expect(classify(contradiction).reasons).toContain('MUTANT_NATIVE_COUNTS_CONTRADICT');
  });
  it('exposes checked classification and bounded composition/reader functions', () => {
    expect(mutation.classifyMutationEvidence).toBeTypeOf('function'); expect(mutation.validateMutationComposition).toBeTypeOf('function'); expect(mutation.readMutationEvidence).toBeTypeOf('function');
  });
  it('accepts the exact single-anchor raw transformation and retains invalid UTF-8, BOM and CRLF', () => {
    const bundle = fixture(); const before = Buffer.from(bundle.artifacts['source-before']);
    expect(classify(bundle)).toMatchObject({ schema: 'agent-tests/mutation-verdict@1', caseId: 'reporter-self', verdict: 'survived', restoration: 'exact' });
    expect(bundle.artifacts['source-before']).toEqual(before);
  });
  it.each(['hidden-edit', 'duplicate-anchor', 'same-replacement', 'unchanged-entry', 'site-change', 'wrong-role', 'missing-after', 'wrong-after', 'missing-logical-path'])('keeps %s source proof unclassified', control => {
    const bundle = fixture();
    if (control === 'hidden-edit') replaceArtifact(bundle, 'source-mutant', Buffer.concat([bundle.artifacts['source-mutant'], Buffer.from('extra')]));
    if (control === 'duplicate-anchor') replaceArtifact(bundle, 'source-before', Buffer.from('false false'));
    if (control === 'same-replacement') bundle.mutation.replacementBase64 = bundle.mutation.anchorBase64;
    if (control === 'unchanged-entry' || control === 'site-change') { bundle.source.entries[1].mutant = 'source-mutant'; if (control === 'site-change') bundle.assertionSites = [{ file: 'assertion.test.ts', provider: 'provider.mjs', line: 1, column: 1 }]; }
    if (control === 'wrong-role') bundle.baseline.binding.sourceRole = 'mutant';
    if (control === 'missing-after') delete bundle.source.entries[0].after;
    if (control === 'wrong-after') bundle.source.entries[0].after = 'source-mutant';
    if (control === 'missing-logical-path') delete bundle.source.entries[1].path;
    expect(classify(bundle).verdict).toBe('unclassified');
  });
  it.each(['red-baseline', 'no-tests', 'all-skipped', 'pending', 'count-contradiction', 'disappeared', 'signal', 'timeout', 'process-disagrees', 'missing-native', 'native-binding', 'config', 'selection', 'retry', 'expected-failure', 'unknown-framework', 'truncated'])('does not accept %s as a survivor', control => {
    const bundle = fixture();
    if (control === 'red-baseline') { bundle.baseline.process.exitCode = 1; editNative(bundle, 'baseline', native => { native.runStatus = 'failed'; native.counts.passed = 0; native.counts.failed = 1; native.cases[0].status = 'failed'; }); }
    if (['no-tests', 'all-skipped', 'pending', 'count-contradiction', 'disappeared', 'retry', 'expected-failure', 'unknown-framework', 'truncated', 'native-binding'].includes(control)) editNative(bundle, 'mutant', native => {
      if (control === 'no-tests') { native.cases = []; native.counts.total = 0; native.counts.passed = 0; }
      if (control === 'all-skipped') { native.cases[0].status = 'skipped'; native.counts.passed = 0; native.counts.skipped = 1; }
      if (control === 'pending') { native.cases[0].status = 'pending'; native.counts.passed = 0; native.counts.pending = 1; }
      if (control === 'count-contradiction') native.counts.passed = 2;
      if (control === 'disappeared') native.cases[0].id = 'other-case';
      if (control === 'retry') native.cases[0].retry = 1;
      if (control === 'expected-failure') native.cases[0].expectedStatus = 'failed';
      if (control === 'unknown-framework') native.framework.version = '5.0.6';
      if (control === 'truncated') native.truncated = true;
      if (control === 'native-binding') native.binding.attemptId = 'other';
    });
    if (control === 'signal') bundle.mutant.process.signal = 'SIGTERM';
    if (control === 'timeout') bundle.mutant.process.timedOut = true;
    if (control === 'process-disagrees') bundle.mutant.process.exitCode = 1;
    if (control === 'missing-native') delete bundle.mutant.native;
    if (control === 'config') bundle.mutant.binding.identity.configSha256 = hash('changed');
    if (control === 'selection') bundle.mutant.binding.identity.selection = [];
    expect(classify(bundle).verdict).toBe('unclassified');
  });
  it('does not promote a fabricated assertion-looking failure before native qualification', () => {
    const bundle = fixture(); bundle.mutant.process.exitCode = 1;
    editNative(bundle, 'mutant', native => { native.runStatus = 'failed'; native.counts.passed = 0; native.counts.failed = 1; native.cases[0].status = 'failed'; native.cases[0].errors = [{ name: 'AssertionError', actual: true, expected: false, message: 'expected true to be false' }]; });
    expect(classify(bundle)).toMatchObject({ verdict: 'unclassified' });
  });
  it('supports explicitly empty native project names without inventing a project', () => {
    const bundle = fixture();
    for (const role of ['baseline', 'mutant']) {
      bundle[role].binding.identity.project = '';
      editNative(bundle, role, native => { native.binding = structuredClone(bundle[role].binding); native.cases[0].project = ''; });
    }
    expect(classify(bundle).verdict).toBe('survived');
  });
  it.each(['all', 'executable', 'node', 'cwd', 'argv', 'framework', 'judgeEntrypoint'])('keeps missing actual %s facts unknown even with fully populated binding', field => {
    const bundle = fixture(); editNative(bundle, 'mutant', native => { if (field === 'all') delete native.actual; else delete native.actual[field]; });
    expect(classify(bundle).verdict).toBe('unclassified');
  });
  it.each(['executable', 'node', 'cwd', 'argv', 'framework', 'judgeEntrypoint'])('rejects contradictory actual %s facts without overriding them from binding', field => {
    const bundle = fixture(); editNative(bundle, 'mutant', native => {
      if (field === 'framework') native.actual.framework = { name: 'vitest', version: '5.0.6' };
      else if (field === 'argv') native.actual.argv = ['different-native-argv'];
      else native.actual[field] = `${native.actual[field]}-different`;
    });
    expect(classify(bundle).verdict).toBe('unclassified');
  });
  it('does not accept configured retries even when the first native attempt passed', () => {
    const bundle = fixture(); editNative(bundle, 'mutant', native => native.cases[0].retryPolicy = 1);
    expect(classify(bundle).verdict).toBe('unclassified');
  });
  it.each(['source-entry', 'judge-entry', 'native-case', 'native-hook'])('refuses malformed null %s with a coded integrity failure', control => {
    const bundle = fixture();
    if (control === 'source-entry') bundle.source.entries.push(null);
    if (control === 'judge-entry') bundle.judge.entries.push(null);
    if (control === 'native-case') editNative(bundle, 'mutant', native => native.cases.push(null));
    if (control === 'native-hook') editNative(bundle, 'mutant', native => native.hooks.push(null));
    expect(() => classify(bundle)).toThrow(/Mutation evidence integrity refusal/);
  });
  it('refuses malformed native steps rather than admitting green labels', () => {
    const bundle = fixture(); editNative(bundle, 'mutant', native => native.steps.push(null));
    expect(() => classify(bundle)).toThrow(/Mutation evidence integrity refusal.*step/i);
  });
  it.each(['failed-step', 'unfinished-step', 'unknown-parent', 'cyclic-parent', 'wrong-case', 'unknown-category'])('keeps %s native facts unclassified', control => {
    const bundle = fixture();
    editNative(bundle, 'mutant', native => {
      const step: Fixture = { id: 's1', caseId: 'native-case-1', parentId: null, category: 'expect', location: null, error: null, ended: true };
      if (control === 'failed-step') step.error = { message: 'retained native error' };
      if (control === 'unfinished-step') step.ended = false;
      if (control === 'unknown-parent') step.parentId = 'missing';
      if (control === 'cyclic-parent') step.parentId = step.id;
      if (control === 'wrong-case') step.caseId = 'absent-case';
      if (control === 'unknown-category') step.category = 'unqualified-native-category';
      native.steps.push(step);
    });
    expect(classify(bundle).verdict).toBe('unclassified');
  });
  it('admits a completed successful supported native step without fabricating assertion proof', () => {
    const bundle = fixture();
    for (const role of ['baseline', 'mutant']) {
      bundle[role].binding.identity.framework = { name: 'playwright', version: '1.64.1' };
      editNative(bundle, role, native => { native.binding = structuredClone(bundle[role].binding); native.framework = structuredClone(native.binding.identity.framework); native.actual.framework = structuredClone(native.framework); native.actual.projects = [{ name: 'unit', retries: 0, repeatEach: 1 }]; native.cases[0].repeatPolicy = 1; native.adapter = 'playwright-1.64.1'; native.steps.push({ id: 's1', caseId: 'native-case-1', parentId: null, category: 'expect', location: null, error: null, ended: true }); });
    }
    expect(classify(bundle).verdict).toBe('survived');
  });
  it.each(['changed-judge', 'live-judge', 'argv-unbound', 'missing-freeze'])('does not admit %s', control => {
    const bundle = fixture();
    if (control === 'changed-judge') bundle.judge.entries[0].after = 'source-mutant';
    if (control === 'live-judge') bundle.judge.entries[0].physicalPath = bundle.source.entries[0].physicalPath;
    if (control === 'argv-unbound') bundle.baseline.binding.identity.argv = ['runner.mjs'];
    if (control === 'missing-freeze') bundle.judge.frozen = false;
    expect(classify(bundle).verdict).toBe('unclassified');
  });
  it('refuses an existing live frozen judge hard-linked to the touched source despite distinct canonical paths', () => {
    const bundle = fixture(), directory = physicalTemp('tests-mutation-live-identity-'); made.push(directory);
    const sourceDirectory = join(directory, 'source'), judgeDirectory = join(directory, 'frozen'); mkdirSync(sourceDirectory); mkdirSync(judgeDirectory);
    bundle.pathPlatform = process.platform === 'win32' ? 'win32' : 'posix';
    for (const entry of bundle.source.entries) { entry.physicalPath = join(sourceDirectory, entry.path); writeFileSync(entry.physicalPath, bundle.artifacts[entry.before]); }
    // Equal frozen bytes at separate inodes are legitimate; only the final hard link removes independence.
    replaceArtifact(bundle, 'judge', Buffer.from(bundle.artifacts['source-before']));
    const judgePath = join(judgeDirectory, 'reporter.mjs'); writeFileSync(judgePath, bundle.artifacts.judge);
    bundle.judge.entrypoint = judgePath; bundle.judge.entries[0].physicalPath = judgePath;
    const closureSha256 = hash(JSON.stringify(bundle.judge.entries.map((entry: Fixture) => ({ path: entry.path, physicalPath: entry.physicalPath, sha256: bundle.files.find((file: Fixture) => file.id === entry.before).sha256 }))));
    for (const role of ['baseline', 'mutant']) {
      const binding = bundle[role].binding; binding.identity.executable = fs.realpathSync.native(process.execPath); binding.identity.cwd = sourceDirectory; binding.identity.argv = ['runner.mjs', '--reporter', judgePath]; binding.judge.entrypoint = judgePath; binding.judge.closureSha256 = closureSha256;
      editNative(bundle, role, native => { native.binding = structuredClone(binding); native.actual.executable = binding.identity.executable; native.actual.cwd = sourceDirectory; native.actual.argv = structuredClone(binding.identity.argv); native.actual.judgeEntrypoint = judgePath; native.cases[0].file = bundle.source.entries[1].physicalPath; });
    }
    expect(classify(bundle).verdict).toBe('survived');
    rmSync(judgePath); linkSync(bundle.source.entries[0].physicalPath, judgePath);
    const result = classify(bundle);
    expect(result.verdict).toBe('unclassified'); expect(result.reasons).toContain('JUDGE_IS_MUTATED_SUBJECT');
  });
  it('classifies explicit nonapplication only when no mutant launch and unchanged evidence are supplied', () => {
    const bundle = fixture(); bundle.mutation.applied = false; bundle.mutation.skipReason = 'declared-exclusion'; bundle.mutant = null; bundle.source.entries[0].mutant = bundle.source.entries[0].before;
    expect(classify(bundle).verdict).toBe('skipped');
    bundle.mutant = fixture().mutant; expect(classify(bundle).verdict).toBe('unclassified');
  });
  it('keeps valid historical claims separate from strict evidence', () => {
    const bundle = { schema: 'agent-tests/mutation-evidence@1', caseId: 'legacy', files: [], artifacts: {}, legacy: { claims: { killed: 76, reused: 74, fresh: 2 }, newFullBatchRun: false } };
    expect(classify(bundle)).toMatchObject({ verdict: 'unclassified', historical: { claims: { killed: 76, reused: 74, fresh: 2 }, newFullBatchRun: false } });
  });
  it('rechecks programmatic byte integrity rather than trusting a prior reader', () => {
    const bundle = fixture(); bundle.artifacts['source-mutant'] = Buffer.from('tampered');
    expect(() => classify(bundle)).toThrow(/integrity|hash|length/i);
  });
});

describe('nominal exact native builtin profiles (synthetic gate controls)', () => {
  it.each(['vitest', 'playwright'] as const)('admits a fully bound reviewed %s mismatch without classifying diagnostic words', framework => {
    expect(classify(profileFixture(framework))).toMatchObject({ verdict: 'killed', restoration: 'exact' });
  });
  it('normalizes absolute Windows native separators without relaxing declared physical source paths', () => {
    const bundle = profileFixture('vitest'); bundle.pathPlatform = 'win32';
    const winPath = (path: string) => path.startsWith('/acquired/') ? `C:${path.replaceAll('/', '\\')}` : path;
    for (const entry of bundle.source.entries) entry.physicalPath = winPath(entry.physicalPath);
    bundle.judge.entrypoint = winPath(bundle.judge.entrypoint);
    for (const entry of bundle.judge.entries) entry.physicalPath = winPath(entry.physicalPath);
    const closureSha256 = hash(JSON.stringify(bundle.judge.entries.map((entry: Fixture) => ({ path: entry.path, physicalPath: entry.physicalPath, sha256: bundle.files.find((file: Fixture) => file.id === entry.before).sha256 }))));
    for (const role of ['baseline', 'mutant']) {
      const binding = bundle[role].binding; binding.identity.executable = winPath(binding.identity.executable); binding.identity.cwd = winPath(binding.identity.cwd); binding.identity.argv = binding.identity.argv.map(winPath); binding.judge.entrypoint = bundle.judge.entrypoint; binding.judge.closureSha256 = closureSha256;
      editNative(bundle, role, native => {
        native.binding = structuredClone(binding); native.actual.executable = winPath(native.actual.executable); native.actual.cwd = winPath(native.actual.cwd); native.actual.argv = native.actual.argv.map(winPath); native.actual.judgeEntrypoint = bundle.judge.entrypoint;
        native.cases[0].file = 'C:/acquired/source/assertion.test.ts';
        if (role === 'mutant') native.cases[0].errors[0].stacks[0].file = native.cases[0].file;
      });
    }
    expect(classify(bundle)).toMatchObject({ verdict: 'killed', restoration: 'exact' });
    bundle.source.entries[1].physicalPath = 'C:/acquired/source/assertion.test.ts';
    expect(classify(bundle).verdict).toBe('unclassified');
  });
  it.each(['case', 'stack'])('does not guess a physical path from a relative native %s path', field => {
    const bundle = profileFixture('vitest');
    for (const role of ['baseline', 'mutant']) editNative(bundle, role, native => { if (field === 'case') native.cases[0].file = 'assertion.test.ts'; if (field === 'stack' && role === 'mutant') native.cases[0].errors[0].stacks[0].file = 'assertion.test.ts'; });
    expect(classify(bundle).verdict).toBe('unclassified');
  });
  it.each(['unreviewed', 'unknown-scope', 'profile-version', 'provider-module', 'provider-version', 'provider-hash', 'site-hash', 'site-bytes', 'provider-bytes', 'case-id', 'project', 'site-line', 'site-column', 'runtime-error', 'additional-global-error', 'extra-case-error', 'hook-activity', 'retry-policy', 'repeat-policy', 'unfinished-case', 'native-timeout', 'truncated', 'abnormal-process'])('keeps %s outside both exact profiles', control => {
    for (const framework of ['vitest', 'playwright'] as const) {
      const bundle = profileFixture(framework), site = bundle.assertionSites[0];
      if (control === 'unreviewed') site.reviewed = false;
      if (control === 'unknown-scope') site.sourceScope.contract = 'unreviewed-hook-scope';
      if (control === 'profile-version') site.profile += '-unknown';
      if (control === 'provider-module') site.providerModule = 'custom-expect';
      if (control === 'provider-version') site.providerVersion = 'different';
      if (control === 'provider-hash') site.providerSha256 = hash('different-provider');
      if (control === 'site-hash') site.sha256 = hash('different-site');
      if (control === 'site-bytes') site.bytes++;
      if (control === 'provider-bytes') site.providerBytes++;
      if (control === 'case-id') site.caseId = 'different-case';
      if (control === 'project') site.project = 'different-project';
      if (control === 'site-line') site.line++;
      if (control === 'site-column') site.column++;
      if (control === 'abnormal-process') bundle.mutant.process.signal = 'SIGTERM';
      editNative(bundle, 'mutant', native => {
        if (control === 'runtime-error') native.cases[0].errors = [{ name: 'RangeError', message: 'arbitrary runtime failure' }];
        if (control === 'additional-global-error') native.errors.push({ scope: 'module', ownerId: 'module', error: { message: 'independent error' } });
        if (control === 'extra-case-error') native.cases[0].errors.push({ message: 'unaccounted second error' });
        if (control === 'hook-activity') native.hooks.push({ phase: 'start', name: 'beforeEach', ownerId: 'native-case-1', ownerType: 'test', error: null, status: null });
        if (control === 'retry-policy') native.cases[0].retryPolicy = 1;
        if (control === 'repeat-policy') native.cases[0].repeatPolicy++;
        if (control === 'unfinished-case') native.cases[0].ended = false;
        if (control === 'native-timeout') native.cases[0].nativeStatus = 'timedOut';
        if (control === 'truncated') native.truncated = true;
      });
      expect(classify(bundle).verdict, `${framework}/${control}`).toBe('unclassified');
    }
  });
  it.each(['name-alone', 'wrong-operator', 'no-show-diff', 'unsupported-actual', 'wrong-stack-file', 'wrong-stack-site', 'no-structured-stack', 'lifecycle-helper-stack'])('does not accept Vitest %s as native builtin origin', control => {
    const bundle = profileFixture('vitest');
    editNative(bundle, 'mutant', native => {
      const error = native.cases[0].errors[0];
      if (control === 'name-alone') native.cases[0].errors = [{ name: 'AssertionError', message: 'ordinary fabricated throw' }];
      if (control === 'wrong-operator') error.operator = 'custom';
      if (control === 'no-show-diff') error.showDiff = false;
      if (control === 'unsupported-actual') error.actual = true;
      if (control === 'wrong-stack-file') error.stacks[0].file = '/acquired/source/other.test.ts';
      if (control === 'wrong-stack-site') error.stacks[0].column++;
      if (control === 'no-structured-stack') delete error.stacks;
      if (control === 'lifecycle-helper-stack') error.stacks = [{ file: '/acquired/source/assertion.test.ts', line: 3, column: 12, method: 'onTestFinished' }];
    });
    expect(classify(bundle).verdict).toBe('unclassified');
  });
  it.each(['missing-alias', 'different-alias', 'null-vs-absent', 'wrong-step-site', 'failed-parent', 'extra-failed-expect', 'caught-expect-later-error', 'nested-expect', 'custom-definition-location'])('does not accept Playwright %s as an accounted root builtin assertion', control => {
    const bundle = profileFixture('playwright');
    editNative(bundle, 'mutant', native => {
      const failed = native.steps[1];
      if (control === 'missing-alias') delete native.cases[0].error;
      if (control === 'different-alias') native.cases[0].error.message = 'different native alias';
      if (control === 'null-vs-absent') native.cases[0].error.value = null;
      if (control === 'wrong-step-site') failed.location.column++;
      if (control === 'failed-parent') native.steps[0].error = structuredClone(failed.error);
      if (control === 'extra-failed-expect') native.steps.push({ ...structuredClone(failed), id: 'another-failed-expect' });
      if (control === 'caught-expect-later-error') { native.cases[0].errors = [{ message: 'later ordinary error', stack: 'different native stack' }]; native.cases[0].error = structuredClone(native.cases[0].errors[0]); }
      if (control === 'nested-expect') failed.parentId = 'before-hooks';
      if (control === 'custom-definition-location') { failed.error.location.line = 12; native.cases[0].error.location.line = 12; native.cases[0].errors[0].location.line = 12; }
    });
    expect(classify(bundle).verdict).toBe('unclassified');
  });
});

describe('bounded physical evidence reader', () => {
  it('reads bound bytes without rewriting envelopes, snapshots or reports', () => {
    const f = disk(); const original = readFileSync(f.path);
    expect(classify(mutation.readMutationEvidence(f.path))).toMatchObject({ verdict: 'survived' }); expect(readFileSync(f.path)).toEqual(original);
  });
  it.each(['hash', 'length', 'traversal', 'absolute', 'duplicate-id', 'duplicate-path', 'directory', 'native-json'])('refuses %s inventory integrity defects', control => {
    const f = disk(); const first = f.envelope.files[0];
    if (control === 'hash') first.sha256 = '0'.repeat(64);
    if (control === 'length') first.bytes++;
    if (control === 'traversal') first.path = '../escape.bin';
    if (control === 'absolute') first.path = join(f.directory, first.path);
    if (control === 'duplicate-id') f.envelope.files[1].id = first.id;
    if (control === 'duplicate-path') f.envelope.files[1].path = first.path;
    if (control === 'directory') { rmSync(join(f.directory, first.path)); mkdirSync(join(f.directory, first.path)); }
    if (control === 'native-json') { const native = f.envelope.files.find((file: Fixture) => file.kind === 'native'); const raw = Buffer.from('{'); writeFileSync(join(f.directory, native.path), raw); native.sha256 = hash(raw); native.bytes = raw.length; }
    writeFileSync(f.path, JSON.stringify(f.envelope)); expect(() => mutation.readMutationEvidence(f.path)).toThrow(/Mutation evidence integrity refusal/);
  });
  it('refuses a linked artifact directory escaping the physical bundle', () => {
    const f = disk(); const outside = physicalTemp('tests-mutation-outside-'); made.push(outside);
    writeFileSync(join(outside, 'data.bin'), f.bundle.artifacts[f.envelope.files[0].id]);
    symlinkSync(outside, join(f.directory, 'alias'), process.platform === 'win32' ? 'junction' : 'dir'); f.envelope.files[0].path = 'alias/data.bin'; writeFileSync(f.path, JSON.stringify(f.envelope));
    expect(() => mutation.readMutationEvidence(f.path)).toThrow(/physical|contain|link/i);
  });
  it('refuses excessive declarations before opening referenced files', () => {
    const f = disk(); f.envelope.files = Array.from({ length: 1025 }, (_, index) => ({ id: `f${index}`, path: `absent${index}`, sha256: hash(''), bytes: 0, kind: 'bytes' })); writeFileSync(f.path, JSON.stringify(f.envelope));
    expect(() => mutation.readMutationEvidence(f.path)).toThrow(/bound|limit|inventory/i);
  });
  it('refuses two inventory paths aliasing the same physical file through hard links', () => {
    const f = disk(); const first = f.envelope.files[0];
    linkSync(join(f.directory, first.path), join(f.directory, 'hard-link.bin'));
    f.envelope.files.push({ ...first, id: 'hard-link', path: 'hard-link.bin' }); writeFileSync(f.path, JSON.stringify(f.envelope));
    expect(() => mutation.readMutationEvidence(f.path)).toThrow(/Mutation evidence integrity refusal.*alias/i);
  });
  it('requires raw artifacts to be own map entries rather than inherited properties', () => {
    const bundle = fixture(); const inherited = bundle.artifacts['source-before']; delete bundle.artifacts['source-before']; Object.setPrototypeOf(bundle.artifacts, { 'source-before': inherited });
    expect(() => classify(bundle)).toThrow(/Mutation evidence integrity refusal/);
  });
  it('hydrates prototype-looking inventory IDs as explicit own raw entries', () => {
    const f = disk(); f.envelope.files[0].id = '__proto__'; writeFileSync(f.path, JSON.stringify(f.envelope));
    const hydrated = mutation.readMutationEvidence(f.path);
    expect(Object.hasOwn(hydrated.artifacts, '__proto__')).toBe(true);
    expect(Buffer.isBuffer(hydrated.artifacts.__proto__)).toBe(true);
  });
  it('refuses understated actual lengths before reading referenced bytes', () => {
    const f = disk(); f.envelope.files[0].bytes = 0; writeFileSync(f.path, JSON.stringify(f.envelope));
    const originalReadFile = fs.readFileSync, originalOpen = fs.openSync, originalRead = fs.readSync;
    const opened = new Map<number, string>(); let referencedReads = 0;
    const mocks = [
      vi.spyOn(fs, 'readFileSync').mockImplementation(((...args: unknown[]) => { if (String(args[0]) !== f.path) referencedReads++; return Reflect.apply(originalReadFile, fs, args); }) as typeof fs.readFileSync),
      vi.spyOn(fs, 'openSync').mockImplementation(((...args: unknown[]) => { const fd = Reflect.apply(originalOpen, fs, args); opened.set(fd, String(args[0])); return fd; }) as typeof fs.openSync),
      vi.spyOn(fs, 'readSync').mockImplementation(((...args: unknown[]) => { if (opened.get(args[0] as number) !== f.path) referencedReads++; return Reflect.apply(originalRead, fs, args); }) as typeof fs.readSync),
    ]; syncBuiltinESMExports();
    try { expect(() => mutation.readMutationEvidence(f.path)).toThrow(/Mutation evidence integrity refusal/); expect(referencedReads).toBe(0); }
    finally { for (const mock of mocks) mock.mockRestore(); syncBuiltinESMExports(); }
  });
  it('bounds a racing file read to its declared length plus one sentinel and closes the descriptor', () => {
    const f = disk(), first = f.envelope.files[0], target = join(f.directory, first.path);
    const originalOpen = fs.openSync, originalRead = fs.readSync, originalClose = fs.closeSync;
    let ownedFd: number | null = null, requested = 0, closed = false, grown = false;
    const mocks = [
      vi.spyOn(fs, 'openSync').mockImplementation(((...args: unknown[]) => { const fd = Reflect.apply(originalOpen, fs, args); if (String(args[0]) === target) ownedFd = fd; return fd; }) as typeof fs.openSync),
      vi.spyOn(fs, 'readSync').mockImplementation(((...args: unknown[]) => {
        if (args[0] === ownedFd) { requested += args[3] as number; if (!grown) { grown = true; writeFileSync(target, Buffer.alloc(first.bytes + 200, 65)); } }
        return Reflect.apply(originalRead, fs, args);
      }) as typeof fs.readSync),
      vi.spyOn(fs, 'closeSync').mockImplementation(((...args: unknown[]) => { if (args[0] === ownedFd) closed = true; return Reflect.apply(originalClose, fs, args); }) as typeof fs.closeSync),
    ]; syncBuiltinESMExports();
    try { expect(() => mutation.readMutationEvidence(f.path)).toThrow(/Mutation evidence integrity refusal.*during bounded read/); expect(requested).toBeLessThanOrEqual(first.bytes + 1); expect(grown).toBe(true); expect(closed).toBe(true); }
    finally { for (const mock of mocks) mock.mockRestore(); syncBuiltinESMExports(); }
  });
});

describe('bounded mutation composition', () => {
  function composition(): Fixture {
    const result: Fixture = { schema: 'agent-tests/mutation-composition@1', files: [], artifacts: {}, catalogue: { ref: 'catalogue', caseIds: ['a', 'b', 'omitted'] }, entries: [], omitted: ['omitted'], closureSha256: hash('declared-source-test-config-closure'), historical: { claims: { killed: 76, reused: 74, fresh: 2 }, newFullBatchRun: false } };
    const add = (id: string, value: unknown, kind: string) => { const bytes = Buffer.from(JSON.stringify(value)); result.files.push({ id, path: `${id}.json`, sha256: hash(bytes), bytes: bytes.length, kind }); result.artifacts[id] = bytes; };
    add('catalogue', { caseIds: result.catalogue.caseIds }, 'catalogue');
    const acquired = fixture(); acquired.caseId = 'a';
    result.requiredClosures = [{ caseId: 'a', closureSha256: (classify(acquired) as Fixture).inputClosureSha256 ?? result.closureSha256 }, { caseId: 'b', closureSha256: result.closureSha256 }];
    result.files.push(...acquired.files); Object.assign(result.artifacts, acquired.artifacts);
    const { artifacts: _artifacts, ...envelope } = acquired; add('evidence-a', envelope, 'evidence');
    for (const [caseId, verdict, origin] of [['a', 'survived', 'fresh'], ['b', 'unclassified', 'reused']]) {
      add(caseId!, { schema: 'agent-tests/mutation-verdict@1', caseId, verdict }, 'verdict'); result.entries.push({ caseId, evidence: caseId === 'a' ? 'evidence-a' : undefined, verdict: caseId, origin, closureSha256: result.requiredClosures.find((entry: Fixture) => entry.caseId === caseId).closureSha256 });
    }
    return result;
  }
  it('counts only strict referenced verdicts and preserves omitted scope and historical claims', () => {
    expect(mutation.validateMutationComposition(composition())).toMatchObject({ valid: true, totals: { killed: 0, survived: 1, skipped: 0, unclassified: 1 }, omitted: ['omitted'], origins: { fresh: 1, reused: 1 }, historical: { claims: { killed: 76, reused: 74, fresh: 2 }, newFullBatchRun: false }, reuseAuthorized: false });
  });
  it.each(['duplicate-case', 'missing-case', 'undeclared-case', 'closure-drift', 'wrong-verdict-case', 'unknown-origin', 'omitted-overlap'])('refuses %s composition claims', control => {
    const manifest = composition();
    if (control === 'duplicate-case') manifest.entries.push(manifest.entries[0]);
    if (control === 'missing-case') manifest.omitted = [];
    if (control === 'undeclared-case') manifest.entries[0].caseId = 'outside-catalogue';
    if (control === 'closure-drift') manifest.entries[0].closureSha256 = hash('changed');
    if (control === 'wrong-verdict-case') replaceArtifact(manifest, 'a', JSON.stringify({ schema: 'agent-tests/mutation-verdict@1', caseId: 'other', verdict: 'survived' }));
    if (control === 'unknown-origin') manifest.entries[0].origin = 'inferred';
    if (control === 'omitted-overlap') manifest.omitted.push('a');
    expect(mutation.validateMutationComposition(manifest).valid).toBe(false);
  });
  it('refuses modified raw referenced verdict bytes', () => {
    const manifest = composition(); manifest.artifacts.a = Buffer.from('{}'); expect(() => mutation.validateMutationComposition(manifest)).toThrow(/integrity|hash|length/i);
  });
  it('does not launder a hash-bound recorded kill into strict totals without recomputed evidence', () => {
    const manifest = composition(); replaceArtifact(manifest, 'b', JSON.stringify({ schema: 'agent-tests/mutation-verdict@1', caseId: 'b', verdict: 'killed' }));
    expect(mutation.validateMutationComposition(manifest)).toMatchObject({ totals: { killed: 0, survived: 1, skipped: 0, unclassified: 1 }, reuseAuthorized: false });
  });
  it('rejects jointly relabelled outer closure claims while retaining the actual reference as unknown', () => {
    const manifest = composition(); const changed = hash('different-current-config-and-helper');
    manifest.closureSha256 = changed; manifest.entries[0].closureSha256 = changed; manifest.requiredClosures[0].closureSha256 = changed;
    expect(mutation.validateMutationComposition(manifest)).toMatchObject({ valid: false, totals: { survived: 0, unclassified: 2 }, diagnostics: [{ verdict: 'unclassified' }, { verdict: 'unclassified' }] });
  });
  it('does not accept changed declared native config identity under an old required closure', () => {
    const manifest = composition(); const envelope = JSON.parse(manifest.artifacts['evidence-a'].toString('utf8'));
    envelope.artifacts = Object.fromEntries(envelope.files.map((file: Fixture) => [file.id, manifest.artifacts[file.id]]));
    for (const role of ['baseline', 'mutant']) {
      envelope[role].binding.identity.configSha256 = hash('new-config');
      editNative(envelope, role, native => native.binding = structuredClone(envelope[role].binding));
    }
    for (const file of envelope.files) Object.assign(manifest.files.find((global: Fixture) => global.id === file.id), file);
    Object.assign(manifest.artifacts, envelope.artifacts); const { artifacts: _artifacts, ...updated } = envelope; replaceArtifact(manifest, 'evidence-a', JSON.stringify(updated));
    expect(mutation.validateMutationComposition(manifest)).toMatchObject({ valid: false, totals: { survived: 0, unclassified: 2 } });
  });
  it.each(['null', 'duplicate', 'undeclared'])('does not parse evidence for an invalid %s composition entry or inflate strict totals', control => {
    const manifest = composition();
    if (control === 'null') manifest.entries.push(null);
    if (control === 'duplicate') manifest.entries.push({ ...manifest.entries[0], evidence: 'unlisted-do-not-read' });
    if (control === 'undeclared') manifest.entries.push({ ...manifest.entries[0], caseId: 'outside', evidence: 'unlisted-do-not-read' });
    expect(mutation.validateMutationComposition(manifest)).toMatchObject({ valid: false, totals: { killed: 0, survived: 1, skipped: 0, unclassified: 1 } });
  });
  it('does not count a valid referenced survivor as proof for a different declared case', () => {
    const manifest = composition(); manifest.entries[1].evidence = 'evidence-a'; manifest.entries[1].closureSha256 = manifest.entries[0].closureSha256; manifest.requiredClosures[1].closureSha256 = manifest.entries[0].closureSha256;
    expect(mutation.validateMutationComposition(manifest)).toMatchObject({ valid: false, totals: { survived: 1, unclassified: 1 }, diagnostics: [{ verdict: 'survived' }, { verdict: 'unclassified' }] });
  });
  it('caps cumulative shared-artifact classification work before the next rehash', () => {
    const acquired = fixture(), bulk = Buffer.alloc(16 * 1024 * 1024, 97);
    acquired.files.push({ id: 'bulk', path: 'bulk.bin', sha256: hash(bulk), bytes: bulk.length, kind: 'bytes' }); acquired.artifacts.bulk = bulk;
    acquired.source.entries.push({ path: 'bulk.bin', physicalPath: '/acquired/source/bulk.bin', before: 'bulk', mutant: 'bulk', after: 'bulk' });
    for (const role of ['baseline', 'mutant']) { acquired[role].binding.source.push({ path: 'bulk.bin', sha256: hash(bulk) }); editNative(acquired, role, native => native.binding = structuredClone(acquired[role].binding)); }
    const closure = classify(acquired).inputClosureSha256;
    const caseIds = ['a', 'b', 'c', 'd', 'e'];
    const manifest: Fixture = { schema: 'agent-tests/mutation-composition@1', files: [...acquired.files], artifacts: { ...acquired.artifacts }, catalogue: { ref: 'catalogue', caseIds }, entries: [], requiredClosures: [], omitted: [] };
    const add = (id: string, value: unknown, kind: string) => { const bytes = Buffer.from(JSON.stringify(value)); manifest.files.push({ id, path: `${id}.json`, sha256: hash(bytes), bytes: bytes.length, kind }); manifest.artifacts[id] = bytes; };
    add('catalogue', { caseIds }, 'catalogue');
    const { artifacts: _artifacts, ...envelope } = acquired;
    for (const caseId of caseIds) { add(`evidence-${caseId}`, { ...envelope, caseId }, 'evidence'); manifest.entries.push({ caseId, evidence: `evidence-${caseId}`, origin: 'fresh', closureSha256: closure }); manifest.requiredClosures.push({ caseId, closureSha256: closure }); }
    let bulkHashes = 0; const original = crypto.createHash;
    const mock = vi.spyOn(crypto, 'createHash').mockImplementation(((...args: unknown[]) => {
      const digest = Reflect.apply(original, crypto, args), update = digest.update;
      digest.update = ((...values: unknown[]) => { if (values[0] === bulk) bulkHashes++; return Reflect.apply(update, digest, values); }) as typeof digest.update;
      return digest;
    }) as typeof crypto.createHash); syncBuiltinESMExports();
    try {
      expect(() => mutation.validateMutationComposition(manifest)).toThrow(/Mutation evidence integrity refusal.*composition.*byte.*bound/i);
      expect(mutation.MUTATION_LIMITS.compositionBytes).toBe(64 * 1024 * 1024);
      expect(bulkHashes).toBe(4); // One initial global validation plus only three admitted classifications.
    } finally { mock.mockRestore(); syncBuiltinESMExports(); }
  });
});
