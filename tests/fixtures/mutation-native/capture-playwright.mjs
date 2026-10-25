// Test-only implementation of public Playwright reporter callbacks.
import { recorder, errorFacts, locationFacts } from './capture-utils.mjs';

export default class CapturePlaywright {
  store = recorder('playwright');
  ids = new WeakMap();
  nextId = 1;
  stepId(step) { if (!step) return null; if (!this.ids.has(step)) this.ids.set(step, this.nextId++); return this.ids.get(step); }
  test(test) { return { id: test.id, title: test.title, location: locationFacts(test.location), expectedStatus: test.expectedStatus, repeatEachIndex: test.repeatEachIndex, retries: test.retries, project: test.parent.project()?.name ?? '' }; }
  step(step, depth = 0) { return depth > 12 ? { truncated: true } : { id: this.stepId(step), parentId: this.stepId(step.parent), category: step.category, location: locationFacts(step.location), error: errorFacts(step.error), steps: step.steps.map(child => this.step(child, depth + 1)) }; }
  onBegin(config, suite) { this.store.record('run-start', () => ({ projects: config.projects.map(project => ({ name: project.name, retries: project.retries, repeatEach: project.repeatEach })), tests: suite.allTests().map(test => this.test(test)) })); }
  onError(error) { this.store.record('run-error', () => ({ error: errorFacts(error) })); }
  onTestBegin(test, result) { this.store.record('case-begin', () => ({ test: this.test(test), retry: result.retry })); }
  onStepBegin(test, result, step) { this.store.record('step-begin', () => ({ testId: test.id, retry: result.retry, step: this.step(step) })); }
  onStepEnd(test, result, step) { this.store.record('step-end', () => ({ testId: test.id, retry: result.retry, step: this.step(step) })); }
  onTestEnd(test, result) { this.store.record('case-end', () => ({ test: this.test(test), status: result.status, retry: result.retry, error: errorFacts(result.error), errors: result.errors.map(error => errorFacts(error)), steps: result.steps.map(step => this.step(step)) })); }
  onEnd(result) { this.store.record('run-end', () => ({ status: result.status })); this.store.capture.complete = true; this.store.publish(); }
  onExit() { this.store.record('reporter-exit', () => ({})); }
}
