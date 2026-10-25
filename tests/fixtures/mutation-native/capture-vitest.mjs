// Test-only implementation of public Vitest reporter callbacks.
import { recorder, errorFacts } from './capture-utils.mjs';

function owner(entity) {
  return { id: entity.id, nativeType: entity.type, name: entity.name, moduleId: entity.moduleId ?? entity.module?.moduleId, location: entity.location ?? null, project: entity.project.name ?? entity.project.config.name ?? '' };
}
function result(test) {
  const value = test.result();
  return { ...owner(test), state: value.state, errors: (value.errors ?? []).map(error => errorFacts(error)), options: { mode: test.options.mode, fails: test.options.fails, retry: test.options.retry, repeats: test.options.repeats, concurrent: test.options.concurrent }, diagnostic: test.diagnostic() ?? null };
}
export default class CaptureVitest {
  store = recorder('vitest');
  onTestRunStart(specifications) { this.store.record('run-start', () => ({ specifications: specifications.map(spec => ({ moduleId: spec.moduleId, project: spec.project.name ?? spec.project.config.name ?? '' })) })); }
  onTestModuleQueued(module) { this.store.record('module-queued', () => owner(module)); }
  onTestModuleCollected(module) { this.store.record('module-collected', () => ({ ...owner(module), tests: [...module.children.allTests()].map(test => owner(test)) })); }
  onTestModuleStart(module) { this.store.record('module-start', () => owner(module)); }
  onTestModuleEnd(module) { this.store.record('module-end', () => ({ ...owner(module), state: module.state(), errors: module.errors().map(error => errorFacts(error)) })); }
  onTestCaseReady(test) { this.store.record('case-ready', () => result(test)); }
  onTestCaseResult(test) { this.store.record('case-result', () => result(test)); }
  onHookStart(hook) { this.store.record('hook-start', () => ({ hook: hook.name, owner: owner(hook.entity) })); }
  onHookEnd(hook) { this.store.record('hook-end', () => ({ hook: hook.name, owner: owner(hook.entity) })); }
  onProcessTimeout() { this.store.record('process-timeout', () => ({})); }
  onTestRunEnd(modules, unhandledErrors, reason) {
    this.store.record('run-end', () => ({ reason, unhandledErrors: unhandledErrors.map(error => errorFacts(error)), modules: modules.map(module => ({ ...owner(module), state: module.state(), errors: module.errors().map(error => errorFacts(error)), suites: [...module.children.allSuites()].map(suite => ({ ...owner(suite), state: suite.state(), errors: suite.errors().map(error => errorFacts(error)) })), tests: [...module.children.allTests()].map(test => result(test)) })) }));
    this.store.capture.complete = true;
    this.store.publish();
  }
}
