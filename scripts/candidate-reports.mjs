const integer = value => Number.isSafeInteger(value) && value >= 0;
const number = value => integer(value) ? value : null;
export function summarizeReport(mode, report) {
  if (mode === 'node-test') {
    const counts = { total: number(report?.counts?.tests), passed: number(report?.counts?.passed), failed: number(report?.counts?.failed), cancelled: number(report?.counts?.cancelled), skipped: number(report?.counts?.skipped), todo: number(report?.counts?.todo) };
    const complete = report?.schema === 'agent-tests/node-profile@1' && report.complete === true && Object.values(counts).every(integer)
      && counts.total > 0 && counts.total === counts.passed + counts.failed + counts.cancelled + counts.skipped + counts.todo
      && Array.isArray(report.files) && report.files.length > 0 && report.files.every(file => typeof file.file === 'string' && file.success === true);
    return { complete, success: report?.success === true, counts, files: report?.files ?? null, durationMs: report?.wallMs ?? null };
  }
  const assertions = Array.isArray(report?.testResults) && report.testResults.every(file => Array.isArray(file.assertionResults)) ? report.testResults.flatMap(file => file.assertionResults) : null;
  const observed = status => assertions ? assertions.filter(test => test.status === status).length : null;
  const counts = { total: number(report?.numTotalTests), passed: number(report?.numPassedTests), failed: number(report?.numFailedTests), cancelled: null, skipped: observed('skipped'), todo: number(report?.numTodoTests), pending: observed('pending') };
  const complete = Object.entries(counts).filter(([key]) => key !== 'cancelled').every(([, value]) => integer(value)) && counts.total > 0 && assertions?.length === counts.total
    && assertions.every(test => ['passed', 'failed', 'skipped', 'todo', 'pending'].includes(test.status))
    && counts.passed === observed('passed') && counts.failed === observed('failed') && counts.todo === observed('todo')
    && number(report.numPendingTests) === counts.skipped + counts.pending && number(report.numPendingTestSuites) === 0
    && number(report.numFailedTestSuites) === 0 && report.testResults.every(file => file.status === 'passed');
  return { complete, success: report?.success === true, counts, files: report?.testResults ?? null, durationMs: null };
}
export function reportProblems(summary) {
  const reasons = [];
  if (!summary?.complete) reasons.push('Missing, zero or incomplete native count evidence');
  if (summary?.success !== true) reasons.push('Native report did not report success');
  if (summary?.counts?.failed > 0 || summary?.counts?.cancelled > 0 || summary?.counts?.pending > 0) reasons.push('Native failures, cancellations or pending cases');
  return reasons;
}
