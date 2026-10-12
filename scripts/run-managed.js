#!/usr/bin/env node
// Skill launcher: run the managed agent-tests CLI that matches this plugin, never a PATH or checkout CLI.
// Failures follow the CLI's error contract: one-line JSON on stderr, non-zero exit.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRuntime } from './managed-runtime.js';

const source = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const runtime = resolveRuntime(source);
  const args = process.argv.slice(2);
  const observation = args[0] === 'candidate-evidence';
  const entrypoint = observation ? join(runtime.root, 'scripts', 'candidate-evidence.mjs') : runtime.cli;
  const child = spawnSync(process.execPath, [entrypoint, ...(observation ? args.slice(1) : args)], { stdio: 'inherit', windowsHide: true });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
} catch (error) {
  const hint = `Run the tests-setup skill (node "${join(source, 'scripts', 'setup.js')}")`;
  console.error(JSON.stringify({ error: { code: 'E_RUNTIME_MISSING', message: error.message, hint } }));
  process.exitCode = 1;
}
