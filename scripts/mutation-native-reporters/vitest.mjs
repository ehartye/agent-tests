import { fileURLToPath } from 'node:url';
import { NativeReport } from './report.mjs';

export default class MutationVitestReporter {
  report = new NativeReport('vitest', fileURLToPath(import.meta.url));
  ended = new Set();
  onTestCaseResult(test) { this.report.capture(() => this.ended.add(test.id)); }
  hook(phase, hook) { this.report.capture(() => this.report.native.hooks.push({ phase, name: this.report.text(hook.name), ownerId: this.report.text(hook.entity.id), ownerType: hook.entity.type, error: null, status: null })); }
  onHookStart(hook) { this.hook('start', hook); }
  onHookEnd(hook) { this.hook('end', hook); }
  onProcessTimeout() { this.report.failure('NATIVE_PROCESS_TIMEOUT'); }
  onTestRunEnd(modules, unhandledErrors, reason) {
    const r = this.report;
    r.capture(() => {
      for (const error of r.list(unhandledErrors)) r.scopedError('run', null, error);
      for (const module of r.list(modules)) {
        for (const error of r.list(module.errors())) r.scopedError('module', module.id, error);
        for (const suite of r.list(module.children.allSuites())) for (const error of r.list(suite.errors())) r.scopedError('suite', suite.id, error);
        for (const test of r.list(module.children.allTests())) {
          if (r.exhausted) break;
          const result = test.result(), diagnostic = test.diagnostic();
          const status = result.state === 'skipped' && test.options.mode === 'todo' ? 'todo' : result.state;
          r.native.cases.push({ id: r.text(test.id), project: r.text(test.project.name ?? test.project.config.name ?? ''), file: r.text(module.moduleId), location: r.location(test.location, module.moduleId), status, nativeStatus: result.state, retry: diagnostic?.retryCount ?? 0, repeat: diagnostic?.repeatCount ?? 0, expectedStatus: test.options.fails ? 'failed' : 'passed', retryPolicy: typeof test.options.retry === 'number' ? test.options.retry : test.options.retry == null ? 0 : 'unsupported', repeatPolicy: test.options.repeats ?? 0, nativeMode: test.options.mode, fails: test.options.fails ?? false, ended: this.ended.has(test.id), error: null, errors: r.list(result.errors ?? []).map(error => r.error(error)) });
        }
      }
    });
    r.publish(reason);
  }
}
