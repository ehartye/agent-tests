// Exact Vitest 5.0.3 public reporter adapter. No private runner/task graph access.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedDetails, echoErrors, reporterTransport } from './candidate-progress.mjs';

const transport = reporterTransport();
const requireConsumer = createRequire(pathToFileURL(join(transport.start.command.cwd, 'package.json')));
const { JsonReporter } = await import(pathToFileURL(requireConsumer.resolve('vitest/node')).href);
const text = value => typeof value === 'string' ? value.slice(0, 4096) : null;
const diagnostic = (value, keys) => Object.fromEntries(keys.map(key => [key, typeof value?.[key] === 'boolean' || (typeof value?.[key] === 'number' && Number.isFinite(value[key])) ? value[key] : null]));
const owner = module => {
  if (typeof module.id !== 'string' || typeof module.moduleId !== 'string') throw Error('Unavailable public module identity');
  return { id: module.id, file: module.moduleId, project: text(module.project.name), relativeModuleId: text(module.relativeModuleId) };
};
export function projectModule(module) {
  const details = boundedDetails();
  const counts = { total: 0, passed: 0, failed: 0, pending: 0, skipped: 0, todo: 0, cancelled: null };
  let complete = true;
  for (const test of module.children.allTests()) {
    const result = test.result(); counts.total++;
    if (result.state === 'skipped') counts[test.options.mode === 'todo' ? 'todo' : 'skipped']++;
    else if (['passed', 'failed', 'pending'].includes(result.state)) counts[result.state]++;
    else complete = false;
    if (result.state === 'pending') complete = false;
    details.case({ id: text(test.id), name: text(test.name), fullName: text(test.fullName), state: text(result.state), mode: text(test.options.mode), diagnostic: diagnostic(test.diagnostic(), ['duration', 'startTime', 'retryCount', 'repeatCount', 'flaky', 'slow', 'heap']) });
    for (const error of result.errors ?? []) details.error({ scope: 'case', id: text(test.id), nativeState: text(result.state) }, error);
  }
  for (const suite of module.children.allSuites()) for (const error of suite.errors()) details.error({ scope: 'suite', id: text(suite.id) }, error);
  for (const error of module.errors()) details.error({ scope: 'module', id: text(module.id) }, error);
  const state = module.state();
  if (!['queued', 'pending', 'skipped', 'failed', 'passed'].includes(state) || ['queued', 'pending'].includes(state)) complete = false;
  return { owner: owner(module), state, counts, projectionComplete: complete, cleanup: 'unknown', diagnostic: diagnostic(module.diagnostic(), ['environmentSetupDuration', 'prepareDuration', 'collectDuration', 'setupDuration', 'duration', 'heap', 'concurrencyId', 'workerId']), ...details.result() };
}
export default class CandidateJsonReporter extends JsonReporter {
  constructor() {
    // Ignore config tuple arguments and outputFile.json. Only the admitted attempt owns this path.
    super({ outputFile: join(transport.directory, 'vitest.json') });
    this.discovered = new Set(); this.failed = false;
  }
  safely(action) {
    try { action(); }
    catch (error) {
      this.failed = true;
      const details = boundedDetails(); details.error({ scope: 'reporter' }, error);
      try { transport.writer.append('reporter-failed', details.result()); } catch { /* Missing run-end/inventory fails closed. */ }
      echoErrors(details.result());
    }
  }
  discover(value) {
    if (!this.discovered.has(value.id)) { transport.writer.append('owner-discovered', { owner: value }); this.discovered.add(value.id); }
  }
  onTestRunStart(specifications) {
    this.safely(() => {
      for (const spec of specifications) {
        if (typeof spec.taskId !== 'string' || typeof spec.moduleId !== 'string') throw Error('Unavailable public specification identity');
        this.discover({ id: spec.taskId, file: spec.moduleId, project: text(spec.project.name), pool: text(spec.pool) });
      }
    });
  }
  lifecycle(kind, module) { this.safely(() => { const value = owner(module); this.discover(value); transport.writer.append(kind, { owner: value }); }); }
  onTestModuleQueued(module) { this.safely(() => this.discover(owner(module))); }
  onTestModuleCollected(module) { this.lifecycle('owner-collected', module); }
  onTestModuleStart(module) { this.lifecycle('owner-started', module); }
  onTestCaseResult(test) {
    this.safely(() => {
      const result = test.result(), details = boundedDetails();
      for (const error of result.errors ?? []) details.error({ scope: 'case', id: text(test.id), ownerId: owner(test.module).id, nativeState: text(result.state) }, error);
      const value = details.result();
      if (value.errors.length) { transport.writer.append('native-error', value); echoErrors(value); }
    });
  }
  onTestModuleEnd(module) {
    this.safely(() => {
      const value = projectModule(module); this.discover(value.owner);
      transport.writer.append('owner-ended', value);
      echoErrors(value);
    });
  }
  async onTestRunEnd(modules, errors, reason) {
    // Always attempt inherited native JSON, even when diagnostic projection/publication failed.
    this.safely(() => {
      const details = boundedDetails(); for (const error of errors ?? []) details.error({ scope: 'run' }, error);
      if (details.result().errors.length) { transport.writer.append('native-error', details.result()); echoErrors(details.result()); }
    });
    try { await super.onTestRunEnd(modules); }
    catch (error) { this.safely(() => { throw error; }); throw error; }
    this.safely(() => transport.writer.append('run-ended', { state: reason, projectionFailed: this.failed, reportedOwners: modules.map(module => owner(module)) }));
  }
}
