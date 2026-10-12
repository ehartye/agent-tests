#!/usr/bin/env node
// Install/check the managed runtime. Usage: node scripts/setup.js [--check] [--json]
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectInstallation, installRuntime } from './managed-runtime.js';

class UsageError extends Error {}
class SetupError extends Error {}
const source = join(dirname(fileURLToPath(import.meta.url)), '..');
const setupCommand = `node "${join(source, 'scripts', 'setup.js')}"`;
try {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--check', '--json'].includes(arg))) throw new UsageError('Usage: node scripts/setup.js [--check] [--json]');
  if (!args.includes('--check')) {
    try { installRuntime(source); } catch (error) { throw new SetupError(error.message, { cause: error }); }
  }
  const report = inspectInstallation(source);
  report.node = process.versions.node;
  console.log(JSON.stringify(report, null, args.includes('--json') ? undefined : 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  // Same error contract as the CLI and the launcher, whatever the flags; --json keeps its stdout report too.
  // An install failure must not point back at the setup skill that just failed.
  const [code, hint] = error instanceof UsageError ? ['E_USAGE', `Run the tests-setup skill (${setupCommand})`]
    : error instanceof SetupError ? ['E_SETUP_FAILED', `Fix the cause in the message, then rerun ${setupCommand}`]
    : ['E_RUNTIME_MISSING', `Run the tests-setup skill (${setupCommand})`];
  console.error(JSON.stringify({ error: { code, message: error.message, hint } }));
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, errors: [error.message] }));
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
