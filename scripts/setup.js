#!/usr/bin/env node
// Install/check the managed runtime. Usage: node scripts/setup.js [--check] [--json]
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectInstallation, installRuntime } from './managed-runtime.js';

class UsageError extends Error {}
const source = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--check', '--json'].includes(arg))) throw new UsageError('Usage: node scripts/setup.js [--check] [--json]');
  if (!args.includes('--check')) installRuntime(source);
  const report = inspectInstallation(source);
  report.node = process.versions.node;
  console.log(JSON.stringify(report, null, args.includes('--json') ? undefined : 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  // Same error contract as the CLI and the launcher, whatever the flags; --json keeps its stdout report too.
  const hint = `Run the tests-setup skill (node "${join(source, 'scripts', 'setup.js')}")`;
  console.error(JSON.stringify({ error: { code: error instanceof UsageError ? 'E_USAGE' : 'E_RUNTIME_MISSING', message: error.message, hint } }));
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, errors: [error.message] }));
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
