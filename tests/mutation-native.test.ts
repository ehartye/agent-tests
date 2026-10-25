/** @lane merge
 * @subject scripts/mutation-native-reporters/report.mjs
 * @subject scripts/mutation-native-reporters/vitest.mjs
 * @subject scripts/mutation-native-reporters/playwright.mjs
 * These real native fixtures qualify adapters. A failed native child is not itself mutation proof.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { physicalTemp } from './helpers/physical-temp.ts';
import { hydrateNativeConsumer } from './helpers/mutation-native-bundle.ts';
import { classifyMutationEvidence } from '../scripts/mutation-verdict.mjs';
import type { HydratedMutationEvidence, MutationReviewedAssertionSite } from '../scripts/mutation-verdict.mjs';

const checkout = realpathSync.native(fileURLToPath(new URL('../', import.meta.url)));
const fixtureRoot = realpathSync.native(join(checkout, 'tests/fixtures/mutation-native'));
const requireFixture = createRequire(join(fixtureRoot, 'package.json'));
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const made: string[] = [];
type Framework = 'vitest' | 'playwright';
type Data = Record<string, any>;
afterEach(() => {
  for (const directory of made.splice(0)) {
    if (dirname(directory) !== fixtureRoot || !directory.startsWith(join(fixtureRoot, 'owner-'))) throw new Error('unsafe native fixture cleanup');
    const retained = process.env.AGENT_TESTS_MUTATION_NATIVE_EVIDENCE;
    if (retained) { const target = join(resolve(retained), directory.slice(directory.lastIndexOf('owner-'))); mkdirSync(dirname(target), { recursive: true }); cpSync(directory, target, { recursive: true, errorOnExist: true, force: false }); }
    rmSync(directory, { recursive: true, force: true });
  }
});
function setup(framework: Framework, control = 'pass', consumer = false) {
  const directory = physicalTemp('owner-', fixtureRoot); made.push(directory);
  mkdirSync(join(directory, 'tests')); mkdirSync(join(directory, 'tools/mutation'), { recursive: true }); mkdirSync(join(directory, 'judge'));
  writeFileSync(join(directory, 'package.json'), '{"name":"native-qualification-owner","type":"module","private":true}\n');
  const judge = join(directory, 'judge', `${framework}.mjs`);
  for (const file of ['report.mjs', 'vitest.mjs', 'playwright.mjs']) {
    const source = join(checkout, 'scripts/mutation-native-reporters', file);
    if (existsSync(source)) writeFileSync(join(directory, 'judge', file), readFileSync(source));
  }
  const suffix = framework === 'vitest' ? 'test.ts' : 'spec.ts';
  const test = join(directory, 'tests', consumer ? `reporter.${suffix}` : `owner.${suffix}`);
  if (consumer) {
    writeFileSync(join(directory, 'tools/mutation/report.mjs'), readFileSync(join(fixtureRoot, 'consumer-source/tools/mutation/report.mjs')));
    writeFileSync(test, framework === 'vitest' ? readFileSync(join(fixtureRoot, 'consumer-source/tests/reporter-source.txt')) : "import {expect,test} from '@playwright/test'\nimport {isInfrastructureError} from '../tools/mutation/report.mjs'\ntest('quotes a diagnostic',()=>expect(isInfrastructureError({name:'AssertionError',message:'SyntaxError: quoted'})).toBe(false))\n");
  } else if (control === 'long-error') writeFileSync(test, `import {${framework === 'vitest' ? 'it' : 'test'}} from '${framework === 'vitest' ? 'vitest' : '@playwright/test'}';\n${framework === 'vitest' ? 'it' : 'test'}('bounded error',()=>{throw new Error('x'.repeat(100000))})\n`);
  else writeFileSync(test, readFileSync(join(fixtureRoot, control === 'syntax' ? `syntax.${framework}.case.mjs` : `controls.${framework}.case.mjs`)));
  if (control === 'mixed-collection') writeFileSync(join(directory, 'tests/extra.test.ts'), readFileSync(join(fixtureRoot, 'collection-extra.vitest.case.mjs')));
  const config = join(directory, 'config.mjs');
  writeFileSync(config, framework === 'vitest' ? "export default {test:{include:['tests/**/*.test.ts'],maxWorkers:1,fileParallelism:false,testTimeout:120,hookTimeout:120,retry:0,watch:false}}\n" : `export default {testDir:'./tests',testMatch:'**/*.spec.ts',workers:1,fullyParallel:false,retries:0,repeatEach:1,timeout:200,globalTimeout:${control === 'global-timeout' ? 800 : 12000},outputDir:'./attachments'}\n`);
  const cli = join(fixtureRoot, 'node_modules', framework === 'vitest' ? 'vitest/vitest.mjs' : '@playwright/test/cli.js');
  const argv = framework === 'vitest' ? [cli, 'run', '--root', directory, '--config', config, '--reporter', judge, '--maxWorkers', '1'] : [cli, 'test', '--config', config, '--reporter', judge, '--workers', '1'];
  const identity = { executable: realpathSync.native(process.execPath), node: process.versions.node, argv, cwd: directory, framework: { name: framework, version: framework === 'vitest' ? '5.0.5' : '1.64.1' }, project: '', selection: [relative(directory, test).replaceAll('\\', '/')], configSha256: hash(readFileSync(config)), setupSha256: hash(''), lockfileSha256: hash(readFileSync(join(fixtureRoot, 'package-lock.json'))), toolchainSha256: hash(JSON.stringify({ node: process.versions.node, framework })) };
  const frozen = ['report.mjs', 'vitest.mjs', 'playwright.mjs'].filter(file => existsSync(join(directory, 'judge', file))).map(file => ({ path: file, physicalPath: join(directory, 'judge', file), sha256: hash(readFileSync(join(directory, 'judge', file))) }));
  const sourceFiles = consumer ? [test, join(directory, 'tools/mutation/report.mjs'), config] : [test, config];
  let provider: Data | null = null;
  if (consumer) {
    // Read the public import export as data; do not import a private matcher implementation.
    const specifier = framework === 'vitest' ? 'vitest' : '@playwright/test';
    const packagePath = requireFixture.resolve(`${specifier}/package.json`), metadata = read(packagePath);
    const importExport = metadata.exports['.'].import;
    const publicEntry = typeof importExport === 'string' ? importExport : importExport.default;
    const physicalPath = realpathSync.native(resolve(dirname(packagePath), publicEntry));
    const snapshot = join(directory, 'provider/expect.mjs'); mkdirSync(dirname(snapshot)); writeFileSync(snapshot, readFileSync(physicalPath));
    provider = { specifier, export: '.', condition: 'import', packageVersion: metadata.version, physicalPath, path: 'provider/expect.mjs', sha256: hash(readFileSync(physicalPath)) };
    writeFileSync(join(directory, 'provider-origin-before-run.json'), JSON.stringify(provider, null, 2)); sourceFiles.push(snapshot);
  }
  const run = (sourceRole: 'before' | 'mutant' = 'before', edit?: (transport: Data) => void, missing = false) => {
    const attempt = join(directory, `attempt-${randomUUID()}`); mkdirSync(attempt);
    const output = join(attempt, 'native.json');
    const source = sourceFiles.map(path => {
      const logical = relative(directory, path).replaceAll('\\', '/');
      const bytes = readFileSync(provider?.path === logical ? provider.physicalPath : path), snapshot = join(attempt, 'source', logical);
      if (provider?.path === logical) expect(bytes, 'actual public import entry drifted before native role').toEqual(readFileSync(path));
      mkdirSync(dirname(snapshot), { recursive: true }); writeFileSync(snapshot, bytes);
      return { path: logical, sha256: hash(bytes) };
    });
    const binding = { attemptId: randomUUID(), sourceRole, source, identity: structuredClone(identity), judge: { entrypoint: judge, version: 'mutation-native@1', closureSha256: hash(JSON.stringify(frozen)) } };
    const transport: Data = { schema: 'agent-tests/mutation-transport@1', output, binding }; edit?.(transport);
    const env = { ...process.env, FORCE_COLOR: '0', CI: '1', MUTATION_NATIVE_CONTROL: control, AGENT_TESTS_MUTATION_TRANSPORT: JSON.stringify(transport) }; if (missing) delete (env as Record<string, string | undefined>).AGENT_TESTS_MUTATION_TRANSPORT;
    const result = spawnSync(process.execPath, argv, { cwd: directory, env, windowsHide: true, encoding: 'utf8', timeout: 18000, maxBuffer: 8 * 1024 * 1024 });
    writeFileSync(join(attempt, 'stdout.txt'), result.stdout ?? ''); writeFileSync(join(attempt, 'stderr.txt'), result.stderr ?? '');
    writeFileSync(join(attempt, 'transport.json'), JSON.stringify(transport, null, 2));
    writeFileSync(join(attempt, 'process.json'), JSON.stringify({ pid: result.pid, executable: realpathSync.native(process.execPath), argv, status: result.status, signal: result.signal, spawnError: result.error?.message ?? null, childClosed: result.status !== null || result.signal !== null, descendantCleanup: 'unknown' }, null, 2));
    expect(result.error, result.stderr).toBeUndefined(); expect(result.signal).toBeNull();
    let native: Data | null = null; try { if (existsSync(output)) native = read(output); } catch { /* A preexisting non-JSON output is never a native record. */ }
    return { result, native: native as Data, output, binding, attempt, transport };
  };
  return { directory, test, judge, sourceFiles, provider, run };
}
const failedSteps = (native: Data) => native.steps.filter((step: Data) => step.error !== null);
const tuple = (error: Data) => Object.fromEntries(['message', 'stack', 'value', 'location', 'cause'].filter(key => Object.hasOwn(error, key)).map(key => [key, error[key]]));

describe('required exact native adapter qualification', () => {
  it('resolves exact standalone dev packages and public consumer entrypoints without aliasing producer Vitest', () => {
    expect(read(requireFixture.resolve('vitest/package.json')).version).toBe('5.0.5');
    expect(read(requireFixture.resolve('@playwright/test/package.json')).version).toBe('1.64.1');
    expect(requireFixture.resolve('vitest/node').startsWith(join(fixtureRoot, 'node_modules'))).toBe(true);
    expect(createRequire(join(checkout, 'package.json')).resolve('vitest/package.json')).not.toBe(requireFixture.resolve('vitest/package.json'));
  });
  for (const framework of ['vitest', 'playwright'] as const) {
    it(`${framework} retains actual green native facts, default project and complete attempt binding`, () => {
      const f = setup(framework), { result, native, binding } = f.run();
      expect(result.status, result.stderr).toBe(0);
      expect(native).toMatchObject({ schema: 'agent-tests/mutation-native@1', binding, framework: binding.identity.framework, adapter: `${framework}-${binding.identity.framework.version}`, complete: true, truncated: false, projectionFailures: [], runStatus: 'passed', counts: { total: 1, passed: 1, failed: 0, skipped: 0, todo: 0, pending: 0 } });
      expect(native.cases).toHaveLength(1); expect(native.cases[0]).toMatchObject({ project: '', status: 'passed', retry: 0, repeat: 0, expectedStatus: 'passed', errors: [] });
      expect(native.errors).toEqual([]); expect(native.actual).toMatchObject({ cwd: f.directory, node: process.versions.node, framework: binding.identity.framework });
    });
    it(`${framework} acquires real consumer Boolean baseline/mutant with unchanged authored assertion and raw restoration`, () => {
      const f = setup(framework, 'consumer', true), subject = join(f.directory, 'tools/mutation/report.mjs');
      const original = readFileSync(subject), assertion = readFileSync(f.test), judgeBefore = readFileSync(f.judge);
      const assertionLine = assertion.toString('utf8').split('\n')[2]!;
      expect(assertionLine.indexOf('.toBe(')).toBeGreaterThanOrEqual(0); expect(assertionLine.lastIndexOf('.toBe(')).toBe(assertionLine.indexOf('.toBe('));
      const declaredSite = { file: f.test, line: 3, column: assertionLine.indexOf('.toBe(') + 2, assertionSha256: hash(assertion), provider: framework === 'vitest' ? 'vitest:expect' : '@playwright/test:expect', frameworkVersion: framework === 'vitest' ? '5.0.5' : '1.64.1', scope: 'reviewed unchanged single builtin hard body toBe; no lifecycle registration' };
      // Review source/provider/scope before baseline; only the native case ID is filled afterwards.
      const reviewedBeforeBaseline: Omit<MutationReviewedAssertionSite, 'caseId'> = {
        profile: framework === 'vitest' ? 'vitest-5.0.5-builtin-toBe-site-v1' : 'playwright-1.64.1-hard-builtin-toBe-site-v1', reviewed: true, builtin: 'toBe',
        framework: framework === 'vitest' ? { name: 'vitest', version: '5.0.5' } : { name: 'playwright', version: '1.64.1' }, project: '',
        file: relative(f.directory, f.test).replaceAll('\\', '/'), sha256: hash(assertion), bytes: assertion.length, line: declaredSite.line, column: declaredSite.column,
        provider: f.provider!.path, providerSha256: f.provider!.sha256, providerBytes: readFileSync(f.provider!.physicalPath).length,
        providerModule: framework === 'vitest' ? 'vitest' : '@playwright/test', providerVersion: declaredSite.frameworkVersion,
        sourceScope: { reviewed: true, contract: 'hook-free-builtin-toBe-v1' }
      };
      writeFileSync(join(f.directory, 'reviewed-site-before-baseline.json'), JSON.stringify(reviewedBeforeBaseline, null, 2));
      const baseline = f.run(); expect(baseline.result.status, baseline.result.stderr).toBe(0);
      expect(baseline.binding.source).toContainEqual({ path: 'provider/expect.mjs', sha256: f.provider!.sha256 });
      const siteBeforeMutation = { ...declaredSite, nativeCaseId: baseline.native.cases[0].id, project: baseline.native.cases[0].project };
      writeFileSync(join(f.directory, 'assertion-site-before-mutation.json'), JSON.stringify(siteBeforeMutation, null, 2));
      const reviewedSite: MutationReviewedAssertionSite = { ...reviewedBeforeBaseline, caseId: baseline.native.cases[0].id };
      writeFileSync(join(f.directory, 'reviewed-site-before-mutation.json'), JSON.stringify(reviewedSite, null, 2));
      const anchor = Buffer.from("if (error?.name === 'AssertionError') return false"), replacement = Buffer.from("if (error?.name === 'AssertionError') return true");
      const at = original.indexOf(anchor); expect(at).toBeGreaterThanOrEqual(0); expect(original.indexOf(anchor, at + 1)).toBe(-1);
      const changed = Buffer.concat([original.subarray(0, at), replacement, original.subarray(at + anchor.length)]);
      let mutant: ReturnType<typeof f.run>;
      try { writeFileSync(subject, changed); mutant = f.run('mutant'); } finally { writeFileSync(subject, original); }
      expect(readFileSync(subject)).toEqual(original); expect(readFileSync(f.test)).toEqual(assertion); expect(readFileSync(f.judge)).toEqual(judgeBefore);
      expect(hash(readFileSync(f.provider!.physicalPath))).toBe(f.provider!.sha256);
      expect(mutant!.binding.source.find(item => item.path === 'provider/expect.mjs')).toEqual(baseline.binding.source.find(item => item.path === 'provider/expect.mjs'));
      for (const source of f.sourceFiles) {
        const logical = relative(f.directory, source).replaceAll('\\', '/'), snapshot = join(f.directory, 'source-after', logical);
        mkdirSync(dirname(snapshot), { recursive: true }); writeFileSync(snapshot, readFileSync(f.provider!.path === logical ? f.provider!.physicalPath : source));
      }
      expect(mutant!.result.status, mutant!.result.stderr).toBe(1); expect(mutant!.native).toMatchObject({ complete: true, truncated: false, projectionFailures: [], runStatus: 'failed', counts: { total: 1, passed: 0, failed: 1 } });
      const test = mutant!.native.cases[0]; expect(test.errors).toHaveLength(1); expect(test.id).toBe(baseline.native.cases[0].id);
      if (framework === 'vitest') {
        expect(assertion).toEqual(readFileSync(join(fixtureRoot, 'consumer-source/tests/reporter-source.txt')));
        expect(test.location).toBeNull(); expect(test.errors[0]).toMatchObject({ name: 'AssertionError', actual: 'true', expected: 'false', operator: 'strictEqual', showDiff: true });
        expect(test.errors[0].stacks).toContainEqual(expect.objectContaining({ file: f.test.replaceAll('\\', '/'), line: declaredSite.line, column: declaredSite.column }));
      } else {
        const steps = failedSteps(mutant!.native); expect(steps).toHaveLength(1); expect(steps[0]).toMatchObject({ caseId: test.id, category: 'expect', parentId: null, ended: true });
        expect(tuple(test.error)).toEqual(tuple(test.errors[0])); expect(tuple(test.error)).toEqual(tuple(steps[0].error)); expect(steps[0].error.location).toEqual(steps[0].location);
        expect(steps[0].location).toEqual({ file: f.test, line: declaredSite.line, column: declaredSite.column });
      }
      writeFileSync(join(f.directory, 'consumer-witness.json'), JSON.stringify({ framework, extractedConsumer: true, wholeOwnerOrCatalogueRun: false, provider: f.provider, assertionSha256: hash(assertion), beforeBase64: original.toString('base64'), mutantBase64: changed.toString('base64'), afterBase64: readFileSync(subject).toString('base64'), restoredExact: true, baseline: baseline.output, mutant: mutant!.output }, null, 2));
      const bundle = hydrateNativeConsumer({ directory: f.directory, baseline, mutant: mutant!, site: reviewedSite, providerPhysicalPath: f.provider!.physicalPath, anchor, replacement });
      const verdict = classifyMutationEvidence(bundle); writeFileSync(join(f.directory, 'core-verdict.json'), JSON.stringify(verdict, null, 2));
      expect(verdict).toMatchObject({ verdict: 'killed', restoration: 'exact', reasons: [], profile: reviewedSite.profile });

      // Diagnostic in-memory declarations reuse the real raw facts, without claiming new executions.
      const clone = (): HydratedMutationEvidence => { const { artifacts, ...envelope } = bundle; return { ...structuredClone(envelope), artifacts: Object.fromEntries(Object.entries(artifacts).map(([id, bytes]) => [id, Buffer.from(bytes)])) }; };
      const nativeBefore = [bundle.baseline!, bundle.mutant!].map(attempt => Buffer.from(bundle.artifacts[attempt.native]!));
      const diagnostics: Data = {};
      for (const control of ['changed-judge', 'failed-restoration', 'unknown-restoration', 'absent-anchor']) {
        const diagnostic = clone(), touched = diagnostic.source!.entries.find(entry => entry.path === diagnostic.mutation!.path)!;
        if (control === 'changed-judge') diagnostic.judge!.entries[0]!.after = touched.mutant!;
        else if (control === 'failed-restoration') touched.after = touched.mutant;
        else if (control === 'unknown-restoration') delete touched.after;
        else diagnostic.mutation!.anchorBase64 = Buffer.from('not an applied source anchor').toString('base64');
        const result = classifyMutationEvidence(diagnostic); diagnostics[control] = result;
        expect(result.verdict, control).toBe('unclassified');
        if (control === 'changed-judge') expect(result.reasons).toContain('FROZEN_JUDGE_CHANGED_OR_MISSING');
        if (control === 'failed-restoration') expect(result.restoration).toBe('failed');
        if (control === 'unknown-restoration') expect(result.restoration).toBe('unknown');
        if (control === 'absent-anchor') expect(result.reasons).toContain('ANCHOR_NOT_UNIQUE');
        expect(diagnostic.artifacts[diagnostic.baseline!.native]).toEqual(nativeBefore[0]); expect(diagnostic.artifacts[diagnostic.mutant!.native]).toEqual(nativeBefore[1]);
      }
      writeFileSync(join(f.directory, 'core-diagnostic-negatives.json'), JSON.stringify({ diagnosticOnly: true, additionalNativeChildren: 0, diagnostics }, null, 2));
      expect(classifyMutationEvidence(bundle)).toEqual(verdict);
    });
    for (const control of ['assertion', 'ordinary', 'fake', 'custom', 'beforeEach', 'afterEach', 'mixed-teardown', 'collection', 'syntax', 'no-tests', 'skipped', 'retry', 'expected-failure', 'test-timeout', ...(framework === 'vitest' ? ['aroundEach', 'onTestFinished'] : ['fixture-teardown', 'mixed-fixture', 'mixed-throw', 'global-timeout'])]) {
      it(`${framework} preserves ${control} native outcomes and scoped errors without classifying message text`, () => {
        const f = setup(framework, control), { native, result } = f.run();
        expect(native, result.stderr).not.toBeNull(); expect(native.complete).toBe(true); expect(native.projectionFailures).toEqual([]); expect(native.truncated).toBe(false);
        if (['skipped', 'retry', 'expected-failure'].includes(control)) expect(result.status).toBe(0); else expect(result.status).toBe(1);
        if (['collection', 'syntax', 'no-tests'].includes(control)) { expect(native.cases).toEqual([]); expect(native.errors.length).toBeGreaterThan(0); }
        if (control === 'skipped') expect(native.counts).toMatchObject({ passed: 0, skipped: 1 });
        if (control === 'retry') { expect(native.cases).toHaveLength(1); expect(native.cases[0].retry).toBe(1); }
        if (control === 'expected-failure') expect(native.cases[0].expectedStatus).toBe('failed');
        if (control === 'assertion') {
          const test = native.cases[0]; expect(test.errors).toHaveLength(1);
          if (framework === 'vitest') expect(test.errors[0]).toMatchObject({ name: 'AssertionError', actual: 'timeout import SyntaxError no tests', operator: 'strictEqual' });
          else { const steps = failedSteps(native); expect(steps).toHaveLength(1); expect(tuple(test.error)).toEqual(tuple(steps[0].error)); }
        }
        if (framework === 'vitest' && ['beforeEach', 'afterEach', 'mixed-teardown'].includes(control)) expect(native.hooks).toContainEqual(expect.objectContaining({ phase: 'start', name: control === 'beforeEach' ? 'beforeEach' : 'afterEach' }));
        if (framework === 'playwright' && ['ordinary', 'fake'].includes(control)) expect(failedSteps(native)).toEqual([]);
        if (framework === 'playwright' && ['fixture-teardown', 'mixed-fixture'].includes(control)) expect(native.steps).toContainEqual(expect.objectContaining({ category: 'fixture' }));
        if (framework === 'playwright' && ['mixed-teardown', 'mixed-fixture'].includes(control)) expect(native.cases[0].errors).toHaveLength(2);
        if (framework === 'playwright' && control === 'mixed-throw') expect(tuple(native.cases[0].error)).not.toEqual(tuple(failedSteps(native)[0].error));
        if (framework === 'playwright' && control === 'global-timeout') expect(native.runStatus).toBe('timedout');
      });
    }
  }
});

describe('reserved native transport and exclusive output', () => {
  it('preserves an unowned temporary file when exclusive creation collides', () => {
    // Process-local filesystem fault injection; no native assertion/verdict claim.
    const f = setup('vitest'), output = join(f.directory, 'collision-native.json');
    const transport = { schema: 'agent-tests/mutation-transport@1', output, binding: { attemptId: randomUUID(), sourceRole: 'before', source: [], identity: { executable: realpathSync.native(process.execPath), node: process.versions.node, argv: [], cwd: f.directory, framework: { name: 'vitest', version: '5.0.5' } }, judge: { entrypoint: f.judge, version: 'mutation-native@1' } } };
    const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; const originalOpen=fs.openSync; let collision; fs.openSync=(path,...args)=>{if(String(path).includes('.mutation-native-')){collision=path;const fd=originalOpen(path,'wx');fs.writeSync(fd,'unowned collision');fs.closeSync(fd);const error=new Error('controlled collision');error.code='EEXIST';throw error;}return originalOpen(path,...args)};syncBuiltinESMExports();const {NativeReport}=await import(${JSON.stringify(pathToFileURL(join(checkout, 'scripts/mutation-native-reporters/report.mjs')).href)});const report=new NativeReport('vitest',${JSON.stringify(f.judge)});let refused=false;try{report.publish('passed')}catch(error){refused=error.code==='EEXIST'}console.log(JSON.stringify({refused,collisionPreserved:fs.existsSync(collision)&&fs.readFileSync(collision,'utf8')==='unowned collision',outputAbsent:!fs.existsSync(${JSON.stringify(output)})}));`;
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: f.directory, env: { ...process.env, AGENT_TESTS_MUTATION_TRANSPORT: JSON.stringify(transport) }, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    writeFileSync(join(f.directory, 'collision-probe.json'), JSON.stringify({ status: probe.status, signal: probe.signal, stdout: probe.stdout, stderr: probe.stderr }));
    expect(probe.error, probe.stderr).toBeUndefined(); expect(probe.status, probe.stderr).toBe(0);
    expect(JSON.parse(probe.stdout)).toEqual({ refused: true, collisionPreserved: true, outputAbsent: true });
  });
  it('refuses a missing transport and preserves absent output', () => { const f = setup('vitest'), run = f.run('before', undefined, true); expect(run.result.status).not.toBe(0); expect(run.native).toBeNull(); });
  it('never replaces an existing accepted byte record', () => { const f = setup('vitest'), original = Buffer.from([0xff, 0xfe, 13, 10]); const run = f.run('before', transport => writeFileSync(transport.output, original)); expect(readFileSync(run.output)).toEqual(original); });
  it('refuses output symlinks without touching their target', () => {
    const f = setup('vitest'), target = join(f.directory, 'accepted.bin'), original = Buffer.from('accepted\r\n'); writeFileSync(target, original);
    const run = f.run('before', transport => symlinkSync(target, transport.output, 'file')); expect(readFileSync(target)).toEqual(original); expect(run.result.status).not.toBe(0);
  });
  it.each(['framework', 'cwd', 'argv'])('retains actual facts separately from a mismatched declared %s', field => {
    const f = setup('vitest'), run = f.run('before', transport => { if (field === 'framework') transport.binding.identity.framework.version = '5.0.3'; else if (field === 'cwd') transport.binding.identity.cwd = fixtureRoot; else transport.binding.identity.argv.push('--unexecuted-selection'); });
    expect(run.native).not.toBeNull(); expect(run.native.framework.version).toBe('5.0.5'); expect(run.native.actual.cwd).toBe(f.directory); expect(run.native.complete).toBe(false); expect(run.native.projectionFailures.length).toBeGreaterThan(0);
  });
  it('retains bounded error evidence with an explicit truncation gate', () => { const f = setup('vitest', 'long-error'), run = f.run(); expect(run.native).toMatchObject({ truncated: true, complete: false }); expect(Buffer.byteLength(JSON.stringify(run.native))).toBeLessThan(300000); });
  it('stops retaining aggregate projected strings before final JSON serialization', () => {
    // This is a serializer resource control, not handcrafted native assertion qualification.
    const f = setup('vitest');
    const transport = { schema: 'agent-tests/mutation-transport@1', output: join(f.directory, 'unpublished-budget-probe.json'), binding: { attemptId: randomUUID(), sourceRole: 'before', source: [], identity: { executable: realpathSync.native(process.execPath), node: process.versions.node, argv: [], cwd: f.directory, framework: { name: 'vitest', version: '5.0.5' } }, judge: { entrypoint: f.judge, version: 'mutation-native@1' } } };
    const script = `import {NativeReport} from ${JSON.stringify(pathToFileURL(join(checkout, 'scripts/mutation-native-reporters/report.mjs')).href)}; import VitestReporter from ${JSON.stringify(pathToFileURL(f.judge).href)}; const report=new NativeReport('vitest',${JSON.stringify(f.judge)}); const text='x'.repeat(9000); for(let n=0;n<600;n++)report.scopedError('run',null,{name:'Error',message:text,stack:text}); report.text('observed discarded scalar'); const hooks=new VitestReporter(); report.publish('failed'); for(let n=0;n<20000;n++)hooks.onHookStart({name:'beforeEach',entity:{id:'owner',type:'test'}}); console.log(JSON.stringify({retained:report.native.errors.length,bytes:Buffer.byteLength(JSON.stringify(report.native.errors)),truncated:report.native.truncated,counts:report.native.counts,retainedCounts:report.native.retainedCounts,retainedDetails:report.native.retainedDetails,omissions:report.native.omissions,hooks:hooks.report.native.hooks.length,hookTruncated:hooks.report.native.truncated,hookOmissions:hooks.report.native.omissions}));`;
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: f.directory, env: { ...process.env, AGENT_TESTS_MUTATION_TRANSPORT: JSON.stringify(transport) }, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    writeFileSync(join(f.directory, 'budget-probe.json'), JSON.stringify({ status: probe.status, signal: probe.signal, stdout: probe.stdout, stderr: probe.stderr }));
    expect(probe.error, probe.stderr).toBeUndefined(); expect(probe.status, probe.stderr).toBe(0);
    const projected = JSON.parse(probe.stdout); expect(projected.retained).toBeLessThan(600); expect(projected.bytes).toBeLessThan(8 * 1024 * 1024); expect(projected.truncated).toBe(true);
    expect(projected.hooks).toBeLessThan(20000); expect(projected.hookTruncated).toBe(true);
    expect(projected.counts).toEqual({ total: null, passed: null, failed: null, skipped: null, todo: null, pending: null });
    expect(projected.retainedCounts).toEqual({ total: 0, passed: 0, failed: 0, skipped: 0, todo: 0, pending: 0, unknown: 0 });
    expect(projected.retainedDetails).toMatchObject({ cases: 0, errors: projected.retained, hooks: 0, steps: 0 });
    expect(projected.omissions.observedDiscardedItems).toBeGreaterThan(0); expect(projected.omissions.observedTextUtf8BytesNotRetained).toBeGreaterThan(0);
    expect(projected.omissions.unobservedRemainingPopulation).toBeNull(); expect(projected.hookOmissions.observedDiscardedCallbacks).toBeGreaterThan(0);
  });
});
