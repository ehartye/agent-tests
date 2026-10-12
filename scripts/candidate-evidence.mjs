#!/usr/bin/env node
// Explicit observation only. This is not the static audit CLI and does not select lanes or authorize integration.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalRoot, hashFile, inputMismatches, inside, snapshotInputs } from './candidate-inputs.mjs';
import { reportProblems, summarizeReport } from './candidate-reports.mjs';

const home = dirname(fileURLToPath(import.meta.url));
const schema = 'agent-tests/candidate-evidence@1';
const limitations = [
  'Only Git-visible files and explicitly declared generated-input roots are observed; ignored inputs outside that scope are unverified.',
  'Installed dependency contents, external producer/tool assets and transitive dependency closure are unverified. Runner metadata/entrypoint hashes do not certify installed dependencies.',
  'Environment values beyond the recorded toolchain and selected argv are unverified; no secret-bearing environment dump is collected.',
  'Before/after equality cannot detect transient edits restored during execution.',
  'This receipt records one command and its actual reported counts, not full-suite coverage, release acceptance or merge/deployment authorization.',
];
function parse(argv) {
  const action = argv.shift(), mode = action === 'observe' ? argv.shift() : null;
  if (!['observe', 'check'].includes(action) || (action === 'observe' && !['node-test', 'vitest'].includes(mode))) throw Error('Use observe node-test|vitest or check');
  const options = { action, mode, generatedInputs: [], cpu: false, nativeArgs: [] };
  while (argv.length) {
    const flag = argv.shift();
    if (flag === '--') { options.nativeArgs = argv; break; }
    if (flag === '--cpu' && action === 'observe') { options.cpu = true; continue; }
    const names = { '--root': 'root', '--out': 'out', '--receipt': 'receipt', '--candidate': 'candidate', '--timeout-ms': 'timeoutMs' };
    if (flag === '--generated-input' && action === 'observe') {
      const value = argv.shift(); if (!value || value.startsWith('--')) throw Error('Missing generated-input root'); options.generatedInputs.push(value); continue;
    }
    if (!names[flag]) throw Error(`Unknown helper argument: ${flag}`);
    const value = argv.shift(); if (!value || value.startsWith('--')) throw Error(`Missing value for ${flag}`);
    options[names[flag]] = value;
  }
  if (!options.root) throw Error('--root is required');
  if (action === 'observe' && (!options.out || !options.nativeArgs.length)) throw Error('Observation requires --out NEW_PRIVATE_DIRECTORY and explicit native test arguments after --');
  if (action === 'check' && (!options.receipt || !/^[a-f0-9]{40,64}$/.test(options.candidate ?? ''))) throw Error('Check requires --receipt and --candidate SHA (dirty capture SHA identifies only its committed base)');
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(Number(options.timeoutMs)) || Number(options.timeoutMs) <= 0)) throw Error('--timeout-ms must be a positive integer');
  return options;
}
function nativeArguments(mode, root, args, cpu, report) {
  let concurrency = cpu ? 2 : 1;
  const retained = [];
  const workerFlags = mode === 'node-test' ? ['--test-concurrency'] : ['--maxWorkers', '--max-workers'];
  const takesValue = new Set(['--test-name-pattern', '--test-skip-pattern', '--test-timeout', '--import', '--require', '--conditions', '--config', '-c', '--testNamePattern', '-t', '--project', '--pool', '--environment', '--dir', '--root', '--minWorkers', '--min-workers']);
  let hasSelection = false;
  for (let index = 0; index < args.length; index++) {
    const token = args[index], key = token.split('=')[0];
    if (mode === 'node-test' && key === '--test-rerun-failures') throw Error(`Cached-attempt replay is unsupported: ${token}`);
    if (/^--(?:watch|test-watch|ui|reporter|outputFile|output-file|test-reporter)/.test(token)) throw Error(`Watch/report destination overrides are unsupported: ${token}`);
    if (mode === 'vitest' && (/^-w/.test(token) || ['--standalone', '--mergeReports', '--merge-reports', '--run', '--no-run'].includes(key))) throw Error(`Single-run/report replay overrides are unsupported: ${token}`);
    if (workerFlags.includes(key)) {
      const value = Number(token.includes('=') ? token.slice(token.indexOf('=') + 1) : args[++index]);
      if (!Number.isSafeInteger(value) || value < 1 || value > (cpu ? 2 : 1)) throw Error('Concurrency exceeds the resource cap: serial/unreviewed=1, explicitly reviewed CPU=2');
      concurrency = value; continue;
    }
    retained.push(token);
    if (takesValue.has(key) && !token.includes('=')) { if (!args[index + 1]) throw Error(`Missing native option value: ${token}`); retained.push(args[++index]); continue; }
    if (!token.startsWith('-') && existsSync(resolve(root, token)) && inside(root, resolve(root, token))) hasSelection = true;
  }
  if (!hasSelection) throw Error('Select at least one existing checkout test file/directory explicitly; automatic discovery is unsupported');
  const argsOut = mode === 'node-test'
    ? ['--test', `--test-concurrency=${concurrency}`, '--test-reporter=spec', '--test-reporter-destination=stdout', `--test-reporter=${pathToFileURL(join(home, 'node-profile.mjs')).href}`, `--test-reporter-destination=${report}`, ...retained]
    : [join(root, 'node_modules/vitest/vitest.mjs'), 'run', `--maxWorkers=${concurrency}`, '--reporter=default', '--reporter=json', `--outputFile.json=${report}`, ...retained];
  return { args: argsOut, concurrency };
}
function toolchain(root, mode) {
  const runner = mode === 'vitest' ? join(root, 'node_modules/vitest/vitest.mjs') : process.execPath;
  const pkg = mode === 'vitest' ? JSON.parse(readFileSync(join(root, 'node_modules/vitest/package.json'), 'utf8')) : null;
  return {
    node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch,
    executable: realpathSync(process.execPath), executableSha256: hashFile(process.execPath),
    runner: { name: mode, version: pkg?.version ?? process.version, entrypoint: realpathSync(runner), sha256: hashFile(runner), packageSha256: pkg ? hashFile(join(root, 'node_modules/vitest/package.json')) : null },
    observer: { name: 'agent-tests', version: JSON.parse(readFileSync(join(home, '../package.json'), 'utf8')).version, packageSha256: hashFile(join(home, '../package.json')) },
    helpers: Object.fromEntries(['candidate-evidence.mjs', 'candidate-inputs.mjs', 'candidate-reports.mjs', 'node-profile.mjs'].map(name => [name, hashFile(join(home, name))])),
  };
}
function capturedSummary(saved, directory) {
  const reasons = [];
  if (!saved.report || !['node-profile.json', 'vitest.json'].includes(saved.report.file)) return { reasons: ['Missing or invalid report path'], summary: null };
  try {
    const path = join(directory, saved.report.file);
    if (hashFile(path) !== saved.report.sha256) reasons.push('Native report bytes differ from the captured report');
    const summary = summarizeReport(saved.command.mode, JSON.parse(readFileSync(path, 'utf8')));
    reasons.push(...reportProblems(summary));
    if (JSON.stringify(summary) !== JSON.stringify(saved.report.summary)) reasons.push('Captured native summary does not match report bytes');
    for (const file of summary.files ?? []) {
      const path = file.file ?? file.name;
      if (typeof path !== 'string' || !inside(saved.before.root, resolve(saved.before.root, path))) reasons.push('Native report contains a test file outside checkout scope');
      else {
        const local = fileURLToPath(pathToFileURL(resolve(saved.before.root, path))).slice(saved.before.root.length + 1).replaceAll('\\', '/');
        if (!saved.before.files[local]?.sha256) reasons.push(`Native test file was not captured in input scope: ${local}`);
      }
    }
    return { reasons, summary };
  } catch (error) { return { reasons: [`Native report unavailable: ${error.message}`], summary: null }; }
}
function validate(saved, directory, current, currentToolchain, candidate) {
  const reasons = [];
  if (saved?.schema !== schema || !['node-test', 'vitest'].includes(saved?.command?.mode) || !saved.before?.files || !saved.child) return { ok: false, state: 'rejected', reasons: ['Malformed or unsupported receipt'] };
  if (saved.child.exitCode !== 0 || saved.child.signal !== null || saved.child.spawnError !== null) reasons.push('Observed child did not exit successfully without signal/spawn error');
  if (saved.child.timedOut) reasons.push('Observed child exceeded its explicit timeout');
  if (candidate !== saved.before.head.sha || candidate !== current?.head?.sha) reasons.push('Candidate SHA differs from receipt/current source; dirty capture cannot be remapped to a later commit');
  const changedDuringRun = inputMismatches(saved.before, saved.after);
  if (changedDuringRun.length) reasons.push('Input identity changed during the observed run');
  const changedSince = inputMismatches(saved.before, current);
  if (changedSince.length) reasons.push('Current input identity differs from captured inputs');
  if (JSON.stringify(saved.toolchainBefore) !== JSON.stringify(saved.toolchainAfter)) reasons.push('Toolchain/helper identity changed during the observed run');
  if (JSON.stringify(saved.toolchainBefore) !== JSON.stringify(currentToolchain)) reasons.push('Current toolchain/helper identity differs');
  const result = capturedSummary(saved, directory); reasons.push(...result.reasons);
  return { ok: reasons.length === 0, state: reasons.length ? 'rejected' : result.summary?.counts.todo > 0 ? 'matched-with-todo' : result.summary?.counts.skipped > 0 ? 'matched-with-skips' : 'matched', sourceRole: saved.before.sourceRole, reasons, changedDuringRun, changedSince, counts: result.summary?.counts ?? null };
}
async function execute(root, args, directory, timeoutMs) {
  const stdout = openSync(join(directory, 'stdout.log'), 'wx', 0o600), stderr = openSync(join(directory, 'stderr.log'), 'wx', 0o600);
  const startedAt = new Date().toISOString(), started = performance.now();
  let timer, killTimer, spawnError = null, timedOut = false;
  try {
    const child = spawn(process.execPath, args, { cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = new Promise(resolve => child.once('close', (exitCode, signal) => resolve({ exitCode, signal })));
    child.once('error', error => { spawnError = { code: error.code ?? null, message: error.message }; });
    child.stdout.on('data', bytes => { writeSync(stdout, bytes); process.stdout.write(bytes); });
    child.stderr.on('data', bytes => { writeSync(stderr, bytes); process.stderr.write(bytes); });
    if (timeoutMs) timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 2000); }, timeoutMs);
    return { ...await closed, spawnError, timedOut, startedAt, endedAt: new Date().toISOString(), wallMs: performance.now() - started };
  } finally { clearTimeout(timer); clearTimeout(killTimer); closeSync(stdout); closeSync(stderr); }
}
async function main() {
  const options = parse(process.argv.slice(2)), root = canonicalRoot(options.root);
  if (options.action === 'check') {
    const receiptPath = realpathSync(resolve(options.receipt)), directory = dirname(receiptPath), saved = JSON.parse(readFileSync(receiptPath, 'utf8'));
    let current, tools;
    try { current = snapshotInputs(root, { generatedInputs: saved.before?.scope.generatedInputs, outputDirectory: saved.before?.scope.excludedOutputs?.[0] }); tools = toolchain(root, saved.command?.mode); }
    catch (error) { current = { error: error.message }; }
    const result = validate(saved, directory, current, tools, options.candidate);
    console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1; return;
  }
  if (existsSync(resolve(options.out))) throw Error('Evidence output directory already exists; no overwrite is permitted');
  const directory = join(realpathSync(dirname(resolve(options.out))), basename(resolve(options.out)));
  if (inside(directory, root)) throw Error('Evidence output must not contain the checkout');
  const reportFile = options.mode === 'node-test' ? 'node-profile.json' : 'vitest.json';
  const invocation = nativeArguments(options.mode, root, options.nativeArgs, options.cpu, join(directory, reportFile));
  // Validate source scope and runner availability before creating output or executing project code.
  const before = snapshotInputs(root, { generatedInputs: options.generatedInputs, outputDirectory: directory }), tools = toolchain(root, options.mode);
  mkdirSync(directory, { mode: 0o700 });
  const saved = { schema, before, toolchainBefore: tools, command: { executable: process.execPath, cwd: root, mode: options.mode, args: invocation.args, selectedArgs: options.nativeArgs, concurrency: invocation.concurrency, resourceDeclaration: options.cpu ? 'CPU reviewed by caller' : 'serial/unreviewed' }, limitations };
  saved.child = await execute(root, invocation.args, directory, Number(options.timeoutMs) || undefined);
  try { saved.after = snapshotInputs(root, { generatedInputs: options.generatedInputs, outputDirectory: directory }); saved.toolchainAfter = toolchain(root, options.mode); }
  catch (error) { saved.after = { error: error.message }; saved.toolchainAfter = null; }
  try { const path = join(directory, reportFile); saved.report = { file: reportFile, sha256: hashFile(path), summary: summarizeReport(options.mode, JSON.parse(readFileSync(path, 'utf8'))) }; }
  catch (error) { saved.report = { file: reportFile, sha256: null, summary: null, error: error.message }; }
  saved.validation = validate(saved, directory, saved.after, saved.toolchainAfter, before.head.sha);
  writeFileSync(join(directory, 'receipt.json'), JSON.stringify(saved, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ receipt: join(directory, 'receipt.json'), ...saved.validation }));
  process.exitCode = saved.validation.ok ? 0 : 1;
}
main().catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
