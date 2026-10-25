// Test-only serial native acquisition. No classifier, browser, install or source mutation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.dirname(fileURLToPath(import.meta.url));
const [framework, outputRoot, ...selected] = process.argv.slice(2);
if (!['vitest', 'playwright'].includes(framework) || !path.isAbsolute(outputRoot)) throw new Error('usage: acquire-facts.mjs vitest|playwright ABSOLUTE_OUTPUT [controls]');
const controls = selected.length ? selected : framework === 'vitest' ? ['pass', 'assertion', 'ordinary', 'fake', 'custom', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'mixed-teardown', 'mixed-collection', 'collection', 'import', 'syntax', 'no-tests', 'skipped', 'retry', 'expected-failure', 'test-timeout', 'hook-timeout', 'aroundEach', 'onTestFinished'] : ['pass', 'assertion', 'ordinary', 'fake', 'custom', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'fixture-teardown', 'mixed-fixture', 'mixed-teardown', 'mixed-throw', 'collection', 'import', 'syntax', 'no-tests', 'skipped', 'retry', 'expected-failure', 'test-timeout', 'hook-timeout', 'global-timeout'];
const cli = path.join(root, 'node_modules', framework === 'vitest' ? 'vitest/vitest.mjs' : '@playwright/test/cli.js');
const args = framework === 'vitest' ? [cli, 'run', '--config', path.join(root, 'vitest.config.mjs')] : [cli, 'test', '--config', path.join(root, 'playwright.config.mjs')];
fs.mkdirSync(outputRoot, { recursive: true });
const summaries = [];
for (const control of controls) {
  if (!/^[A-Za-z-]+$/.test(control)) throw new Error('Invalid control');
  const attempt = path.join(outputRoot, framework, control);
  fs.mkdirSync(attempt, { recursive: true });
  const capturePath = path.join(attempt, 'capture.json');
  if (fs.existsSync(capturePath) || fs.existsSync(path.join(attempt, 'process.json'))) throw new Error('Attempt already exists; preserve evidence');
  const started = Date.now();
  const child = spawnSync(process.execPath, args, { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 18000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', CI: '1', MUTATION_NATIVE_CONTROL: control, MUTATION_NATIVE_CAPTURE: capturePath, MUTATION_NATIVE_ATTACHMENTS: path.join(attempt, 'attachments') } });
  fs.writeFileSync(path.join(attempt, 'stdout.txt'), child.stdout ?? '');
  fs.writeFileSync(path.join(attempt, 'stderr.txt'), child.stderr ?? '');
  const capture = fs.existsSync(capturePath) ? JSON.parse(fs.readFileSync(capturePath)) : null;
  const processRecord = { schema: 'agent-tests/mutation-native-process@1', framework, control, node: process.version, executable: fs.realpathSync(process.execPath), argv: args, cwd: root, deadlineMs: 18000, elapsedMs: Date.now() - started, pid: child.pid ?? null, status: child.status, signal: child.signal, error: child.error ? { name: child.error.name, message: child.error.message, code: child.error.code } : null, childCloseObserved: child.status !== null || child.signal !== null, descendantCleanup: 'unknown; no process-tree claim', captureSha256: capture ? crypto.createHash('sha256').update(fs.readFileSync(capturePath)).digest('hex') : null };
  fs.writeFileSync(path.join(attempt, 'process.json'), JSON.stringify(processRecord, null, 2) + '\n');
  const end = capture?.events.find(event => event.type === 'run-end');
  const summary = { framework, control, status: child.status, signal: child.signal, processError: processRecord.error, complete: capture?.complete ?? false, projectionErrors: capture?.projectionErrors ?? null, nativeStatus: end?.reason ?? end?.status ?? null, events: capture?.events.length ?? 0 };
  summaries.push(summary);
  console.log(JSON.stringify(summary));
  if (child.error || child.signal) throw new Error('Child interrupted or acquisition deadline reached; stop serial acquisition pending handle review');
}
fs.writeFileSync(path.join(outputRoot, `${framework}-summary-${controls[0]}-${controls.at(-1)}.json`), JSON.stringify(summaries, null, 2) + '\n');
