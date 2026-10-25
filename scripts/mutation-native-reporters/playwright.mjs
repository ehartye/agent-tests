import { fileURLToPath } from 'node:url';
import { NativeReport } from './report.mjs';

export default class MutationPlaywrightReporter {
  report = new NativeReport('playwright', fileURLToPath(import.meta.url));
  ids = new WeakMap();
  steps = new Map();
  cases = new Map();
  discovered = [];
  next = 1;
  id(step) { if (!step) return null; if (!this.ids.has(step)) this.ids.set(step, `step-${this.next++}`); return this.ids.get(step); }
  onBegin(config, suite) { this.report.capture(() => { this.discovered = this.report.list(suite.allTests()); this.report.native.actual.projects = this.report.list(config.projects).map(project => ({ name: this.report.text(project.name), retries: project.retries, repeatEach: project.repeatEach })); }); }
  onError(error) { this.report.capture(() => this.report.scopedError('run', null, error)); }
  step(test, step, ended) {
    const r = this.report;
    if (!r.reserve()) return;
    const id = this.id(step), previous = this.steps.get(id);
    if (!previous && this.steps.size >= 10000) { r.omitItems(1); return; }
    this.steps.set(id, { caseId: r.text(test.id), id, parentId: this.id(step.parent), category: r.text(step.category), location: r.location(step.location), error: r.error(step.error), ended: ended || previous?.ended === true });
  }
  onStepBegin(test, _result, step) { this.report.capture(() => this.step(test, step, false)); }
  onStepEnd(test, _result, step) { this.report.capture(() => this.step(test, step, true)); }
  test(test, result) {
    const r = this.report, status = result?.status === 'timedOut' ? 'failed' : result?.status === 'interrupted' ? 'pending' : result?.status ?? 'pending';
    return { id: r.text(test.id), project: r.text(test.parent.project()?.name ?? ''), file: r.text(test.location.file), location: r.location(test.location), status, nativeStatus: result?.status ?? null, retry: result?.retry ?? 0, repeat: test.repeatEachIndex, expectedStatus: test.expectedStatus, retryPolicy: test.retries, repeatPolicy: test.parent.project()?.repeatEach ?? null, ended: !!result, error: r.error(result?.error), errors: r.list(result?.errors ?? []).map(error => r.error(error)) };
  }
  onTestEnd(test, result) { this.report.capture(() => {
    this.cases.set(test.id, this.test(test, result));
    const visit = (steps, depth = 0) => { if (depth > 32) { this.report.omitItems(steps.length); return; } for (const step of this.report.list(steps)) { this.step(test, step, false); visit(step.steps, depth + 1); } };
    visit(result.steps);
  }); }
  onEnd(result) {
    const r = this.report;
    r.capture(() => { for (const test of this.discovered) if (!this.cases.has(test.id)) this.cases.set(test.id, this.test(test, null)); r.native.cases = r.list(this.cases.values()); r.native.steps = r.list(this.steps.values()); });
    r.publish(result.status);
  }
}
