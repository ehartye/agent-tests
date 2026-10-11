// @ts-nocheck -- plain Node script (no build step); exercised by tests/managed-runtime.test.ts
// Shared by setup and the skill launcher. Runtime selection never uses PATH.
// The Claude Code plugin cache is a bare git checkout with no node_modules.
// Setup copies the runtime files to ~/.agent-tests/releases/<key>, installs dependencies there,
// and skills run the launcher only. Adapted from agent-prose, without the npm-link and browser steps.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';

const NAME = 'agent-tests';
const RUNTIME_FILES = ['package.json', 'package-lock.json', 'tsconfig.json', 'scripts', 'src', 'skills', 'references'];
const RECEIPT = 'managed-install.json';
const TEXT = /\.(?:[cm]?[jt]s|json|ya?ml|md|txt)$/;
const LITTER = name => name === '.DS_Store' || name === 'Thumbs.db' || name.endsWith('~');
export const managedHome = () => resolve(process.env.AGENT_TESTS_HOME || join(homedir(), '.agent-tests'));
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const inside = (parent, child) => { const rel = relative(parent, child); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };

function canonical(path) {
  if (existsSync(path)) return realpathSync(path);
  return join(canonical(dirname(path)), basename(path));
}

function runtimeFiles(root) {
  const paths = [];
  function visit(name) {
    if (LITTER(basename(name))) return;
    const path = join(root, name);
    if (!existsSync(path)) return;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Runtime source must not contain symlinks: ${path}`);
    if (stat.isDirectory()) for (const child of readdirSync(path).sort()) visit(`${name}/${child}`);
    else if (stat.isFile()) paths.push(name);
  }
  for (const name of RUNTIME_FILES) visit(name);
  return paths;
}

export function describeSource(source) {
  source = realpathSync(source);
  const pkg = readJson(join(source, 'package.json'));
  if (pkg.name !== NAME || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) throw new Error(`Invalid ${NAME} package/version`);
  const pluginPath = join(source, '.claude-plugin', 'plugin.json');
  if (existsSync(pluginPath)) {
    const plugin = readJson(pluginPath);
    if (plugin.name !== pkg.name || plugin.version !== pkg.version) throw new Error('Plugin and CLI package version mismatch');
  }
  const lock = readJson(join(source, 'package-lock.json'));
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw new Error('Package and lockfile version mismatch');
  const files = runtimeFiles(source);
  const hash = createHash('sha256');
  for (const name of files) {
    const bytes = readFileSync(join(source, name));
    // Git checkouts can change CRLF. Normalize text, fingerprint anything else verbatim.
    const content = TEXT.test(name) ? bytes.toString('utf8').replaceAll('\r\n', '\n') : bytes;
    hash.update(name).update('\0').update(content).update('\0');
  }
  const fingerprint = hash.digest('hex');
  const key = `${pkg.version}-${fingerprint.slice(0, 16)}-${process.platform}-${process.arch}-${process.versions.modules}`;
  return { source, name: pkg.name, version: pkg.version, fingerprint, key, files };
}

function location(source, home) {
  const expected = describeSource(source);
  home = canonical(resolve(home));
  if (inside(expected.source, home) || inside(home, expected.source)) throw new Error('Managed installation must be outside the plugin/checkout, in a separate directory');
  const root = join(home, 'releases', expected.key);
  if (!inside(home, canonical(root))) throw new Error('Managed release resolves outside its installation home');
  return { ...expected, home, root, cli: join(root, 'scripts', 'tests.mjs') };
}

export function resolveRuntime(source, { home = managedHome() } = {}) {
  const runtime = location(source, home);
  const receiptPath = join(runtime.root, RECEIPT);
  if (!existsSync(receiptPath)) throw new Error(`Managed CLI ${runtime.version} is missing. Run the tests-setup skill (node "${join(runtime.source, 'scripts', 'setup.js')}").`);
  const receipt = readJson(receiptPath);
  if (receipt.fingerprint !== runtime.fingerprint || receipt.key !== runtime.key || describeSource(runtime.root).fingerprint !== runtime.fingerprint) {
    throw new Error(`Managed runtime modified or version mismatch at ${runtime.root}. Move this managed release aside and rerun tests-setup.`);
  }
  return runtime;
}

function assertNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 24) throw new Error(`agent-tests runs TypeScript directly and needs Node 24 or newer; this is Node ${process.versions.node}`);
}

function npmCli() {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  for (const entry of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    candidates.push(join(entry, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    const npm = join(entry, 'npm');
    if (existsSync(npm)) candidates.push(realpathSync(npm));
  }
  const found = candidates.find(path => path && path.endsWith('npm-cli.js') && existsSync(path));
  if (!found) throw new Error('Cannot locate npm-cli.js. Install Node.js with npm, then rerun tests-setup.');
  return found;
}

export function runNpm(args, { cwd, progress = false } = {}) {
  try {
    return execFileSync(process.execPath, [npmCli(), ...args], {
      cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      stdio: progress ? ['ignore', 2, 2] : ['ignore', 'pipe', 'pipe'],
    })?.trim() || '';
  } catch (error) {
    throw new Error(`npm ${args.join(' ')} failed: ${error.stderr || error.message}`);
  }
}

/** Exercise the runtime rather than only checking that directories exist. */
export function checkDependencies(root) {
  assertNode();
  // Parsing a line proves the platform's native TypeScript binary installed and starts, not just that the packages exist.
  const probe = [
    "await import('yaml'); await import('zod');",
    "const { openParseSession } = await import('./src/parse.ts');",
    'const session = openParseSession();',
    "try { session.parse('check.test.ts', \"it('x', () => {});\"); } finally { session.close(); }",
  ].join(' ');
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, windowsHide: true, stdio: 'pipe', encoding: 'utf8', timeout: 60_000 });
  } catch (error) {
    throw new Error(`Dependency check failed: ${summarizeFailure(error.stderr, error.message)}`);
  }
}

/** The raw error message echoes the probe source. Keep the line that names the problem and what follows it. */
function summarizeFailure(stderr, fallback) {
  const lines = String(stderr || '').split(/\r?\n/)
    .filter(line => line.trim() && !/^\s+at /.test(line) && !/^\s*[{}]\s*$/.test(line) && !/^\s*\^+\s*$/.test(line) && !/^Node\.js v/.test(line.trim()))
    .map(line => line.trim());
  const start = lines.findIndex(line => /\w*Error\b|Cannot find module/.test(line));
  const picked = start >= 0 ? lines.slice(start, start + 3) : lines.slice(0, 3);
  return picked.length ? picked.join(' | ') : fallback;
}

function lockOwner(lock) {
  try {
    const owner = JSON.parse(readFileSync(lock, 'utf8'));
    return Number.isInteger(owner?.pid) && owner.pid > 0 ? owner : null;
  } catch { return null; }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

/** Take setup.lock. A lock whose owner process has exited is stale: remove it and retry once. */
function acquireLock(lock) {
  for (let attempt = 0; ; attempt++) {
    try { return openSync(lock, 'wx'); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner = lockOwner(lock);
      if (attempt === 0 && owner && !isAlive(owner.pid)) {
        // Re-read just before unlinking: if another setup already reclaimed the lock and wrote its own, leave it alone.
        // A sliver remains between this read and the unlink (no atomic compare-and-delete on a file); it is not worth a lock of its own.
        const again = lockOwner(lock);
        if (again && again.pid === owner.pid && again.started === owner.started) {
          try { unlinkSync(lock); } catch (unlinkError) { if (unlinkError.code !== 'ENOENT') throw unlinkError; }
          continue;
        }
        owner = again;
      }
      const who = owner ? ` by pid ${owner.pid}${typeof owner.started === 'string' ? `, started ${owner.started}` : ''}` : '';
      throw new Error(`Another setup may be running (${lock}${who}). Remove a stale lock only after confirming no setup is active.`);
    }
  }
}

export function installRuntime(source, { home = managedHome(), npm = runNpm, checkDependencies: check = checkDependencies } = {}) {
  assertNode();
  const runtime = location(source, home);
  mkdirSync(runtime.home, { recursive: true });
  const lock = join(runtime.home, 'setup.lock');
  const fd = acquireLock(lock);
  let stage;
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
    const releases = join(runtime.home, 'releases');
    mkdirSync(releases, { recursive: true });
    // Holding the lock, so any .install-* directory is left over from a killed run.
    for (const name of readdirSync(releases)) if (name.startsWith('.install-')) rmSync(join(releases, name), { recursive: true, force: true });
    if (!existsSync(runtime.root)) {
      stage = mkdtempSync(join(releases, '.install-'));
      for (const name of runtime.files) {
        mkdirSync(dirname(join(stage, name)), { recursive: true });
        copyFileSync(join(runtime.source, name), join(stage, name));
      }
      npm(['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stage, progress: true });
      check(stage);
      if (describeSource(stage).fingerprint !== runtime.fingerprint) throw new Error('Runtime source changed during installation; rerun setup');
      writeFileSync(join(stage, RECEIPT), JSON.stringify({ key: runtime.key, version: runtime.version, fingerprint: runtime.fingerprint }, null, 2));
      renameSync(stage, runtime.root);
      stage = undefined;
    } else {
      resolveRuntime(source, { home });
      try { check(runtime.root); } catch (error) {
        // The receipt is valid, so only node_modules is suspect. Never rewrite a live release in place.
        throw new Error(`Managed release at ${runtime.root} fails its dependency check: ${error.message}. Move this release directory aside and rerun tests-setup.`);
      }
    }
    return runtime;
  } finally {
    closeSync(fd);
    if (stage && inside(join(runtime.home, 'releases'), realpathSync(stage))) rmSync(stage, { recursive: true, force: true });
    unlinkSync(lock);
  }
}

export function inspectInstallation(source, { home = managedHome(), checkDependencies: check = checkDependencies } = {}) {
  const expected = location(source, home);
  const report = { ok: false, pluginVersion: expected.version, cliVersion: null, runtimeRoot: expected.root, fingerprint: expected.fingerprint, dependencies: false, errors: [] };
  try {
    const runtime = resolveRuntime(source, { home });
    report.cliVersion = runtime.version;
    check(runtime.root);
    report.dependencies = true;
  } catch (error) { report.errors.push(error.message); }
  report.ok = report.dependencies && report.errors.length === 0;
  return report;
}
