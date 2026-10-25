// Candidate-only observer; the standalone timing reporter deliberately has no transport side effects.
import nodeProfile from './node-profile.mjs';
import { boundedDetails, reporterTransport } from './candidate-progress.mjs';

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function nodeErrorFact(data) {
  const detail = boundedDetails();
  detail.error({ scope: 'case', id: typeof data.name === 'string' ? data.name.slice(0, 4096) : null, ownerId: typeof data.entryFile === 'string' ? data.entryFile : null, definitionFile: typeof data.file === 'string' ? data.file : null }, data.details?.error);
  return detail.result();
}
export default async function* candidateNodeReporter(events) {
  const { writer, start } = reporterTransport();
  const isolated = start.progress.capability === 'qualified', discovered = new Set();
  let failed = false;
  const append = (kind, facts) => {
    try { writer.append(kind, facts); }
    catch (error) {
      failed = true;
      try { const detail = boundedDetails(); detail.error({ scope: 'reporter' }, error); writer.append('reporter-failed', detail.result()); } catch { /* Parent inventory/run-end gate also fails closed. */ }
      process.stderr.write(`Candidate progress reporter failed: ${String(error.message).slice(0, 4096)}\n`);
    }
  };
  const discover = file => {
    if (!discovered.has(file)) { append('owner-discovered', { owner: { id: file, file } }); discovered.add(file); }
  };
  async function* observe() {
    try {
      for await (const event of events) {
        const { type, data } = event;
        if (isolated && typeof data?.entryFile === 'string') discover(data.entryFile);
        if (type === 'test:fail') append('native-error', nodeErrorFact(data));
        if (type === 'test:summary') {
          if (data.file && isolated) {
            discover(data.file);
            const counts = Object.fromEntries([['total', 'tests'], ['passed', 'passed'], ['failed', 'failed'], ['cancelled', 'cancelled'], ['skipped', 'skipped'], ['todo', 'todo'], ['suites', 'suites'], ['topLevel', 'topLevel']].map(([key, native]) => [key, count(data.counts?.[native])]));
            append('owner-ended', { owner: { id: data.file, file: data.file }, state: data.success === true ? 'passed' : data.success === false ? 'failed' : 'unknown', counts, nativeDurationMs: Number.isFinite(data.duration_ms) ? data.duration_ms : null, cleanup: 'unknown' });
          } else if (!data.file) append('run-ended', { state: data.success === true ? 'passed' : 'failed', nativeDurationMs: data.duration_ms ?? null, projectionFailed: failed });
        }
        yield event;
      }
    } catch (error) { append('reporter-failed', { message: String(error.message).slice(0, 4096) }); throw error; }
  }
  yield* nodeProfile(observe());
}
