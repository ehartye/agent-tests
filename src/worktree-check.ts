import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CliError } from './errors.ts';

export const WORKTREE_CHECK_SCHEMA = 'agent-tests/worktree-check@1';
export const MAX_RUNS = 10;
export const DEFAULT_RUNS = 3;
export const DEFAULT_TIMEOUT_SECONDS = 600;
const MAX_FAILURE_LINES = 20;
const FAILURE_LINE = /FAIL|Error|×/;
const OUTPUT_LIMIT = 4 * 1024 * 1024;
const KILL_GRACE_MS = 2000;
const GIT_TIMEOUT_MS = 120_000;

export type Verdict = 'hazard-observed' | 'no-hazard-observed' | 'baseline-failed';

export interface WorktreeCheckOptions {
  root: string;
  runs?: number;
  command?: string;
  timeoutSeconds?: number;
  install?: boolean;
  /** Test seam: the throwaway branch name. Not exposed on the command line. */
  branchName?: string;
}

interface CommandResult {
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  timedOut: boolean;
  interrupted: boolean;
  output: string;
}

export interface CheckoutRun {
  exitCode: number | null;
  passed: boolean;
  durationMs: number;
  failureLines?: string[];
}

export interface WorktreeCheckReport {
  schema: typeof WORKTREE_CHECK_SCHEMA;
  verdict: Verdict;
  command: string;
  runs: number;
  timeoutSeconds: number;
  rootDirty: boolean;
  baseline: CheckoutRun;
  install: { performed: boolean; command?: string; exitCode?: number | null; durationMs?: number };
  results: Array<{ run: number; root: CheckoutRun; worktree: CheckoutRun }>;
  cleanup: CleanupResult;
}

export interface CleanupResult {
  ok: boolean;
  worktreeCreated: boolean;
  worktreeRemoved: boolean;
  branchDeleted: boolean;
  errors: string[];
  /** Every cleanup step that threw, with its message, even when a later step recovered. */
  failedSteps: Array<{ step: string; message: string }>;
}

/** The side effects of cleanup, replaceable so each step's failure can be simulated. */
export interface CleanupOps {
  removeWorktree(worktree: string): void;
  removeDirectory(directory: string): void;
  prune(): void;
  worktreeListed(name: string): boolean;
  branchExists(branch: string): boolean;
  deleteBranch(branch: string): void;
}

export interface CleanupTarget {
  root: string;
  holder?: string;
  worktree?: string;
  branch?: string;
  /** True only after `git worktree add -b` succeeded in this run; a branch this run did not create is never deleted. */
  branchCreated: boolean;
}

function defaultCleanupOps(root: string): CleanupOps {
  return {
    removeWorktree: worktree => void git(root, ['worktree', 'remove', '--force', worktree]),
    removeDirectory: directory => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
    prune: () => void git(root, ['worktree', 'prune']),
    worktreeListed: name => (tryGit(root, ['worktree', 'list', '--porcelain']) ?? '').includes(name),
    branchExists: branch => Boolean(tryGit(root, ['branch', '--list', branch])),
    deleteBranch: branch => void git(root, ['branch', '-D', branch]),
  };
}

/**
 * Remove the second worktree, its holder directory and the throwaway branch. Every step runs in its own try/catch so one failure
 * (an EBUSY on Windows, say) never skips the rest; failures are recorded on `cleanup` and this function itself never throws.
 */
export function runCleanup(target: CleanupTarget, cleanup: CleanupResult, ops: CleanupOps = defaultCleanupOps(target.root)): void {
  const failures = new Map<string, string>();
  const attempt = (step: string, action: () => void): void => {
    try {
      action();
    } catch (error) {
      const stderr = (error as { stderr?: unknown } | null)?.stderr;
      const message = String(stderr || (error as Error)?.message || error).trim();
      failures.set(step, message);
      cleanup.failedSteps.push({ step, message });
    }
  };
  const { worktree, holder, branch } = target;
  if (worktree && cleanup.worktreeCreated) attempt('git worktree remove', () => ops.removeWorktree(worktree));
  if (holder) attempt('remove holder directory', () => ops.removeDirectory(holder));
  if (worktree && cleanup.worktreeCreated) {
    attempt('git worktree prune', () => ops.prune());
    let listed = false;
    try {
      listed = ops.worktreeListed(basename(holder ?? 'checkout'));
    } catch {
      listed = false;
    }
    cleanup.worktreeRemoved = !existsSync(worktree) && !listed;
  }
  if (branch && target.branchCreated) {
    let exists = true;
    try {
      exists = ops.branchExists(branch);
    } catch {
      exists = true;
    }
    if (exists) attempt('git branch -D', () => ops.deleteBranch(branch));
    try {
      cleanup.branchDeleted = !ops.branchExists(branch);
    } catch {
      cleanup.branchDeleted = false;
    }
  }
  const holderGone = !holder || !existsSync(holder);
  const unresolved = (step: string): boolean =>
    failures.has(step) && !(step === 'git worktree remove' && cleanup.worktreeRemoved) && !(step === 'remove holder directory' && holderGone) && !(step === 'git branch -D' && cleanup.branchDeleted);
  cleanup.errors = [...failures].filter(([step]) => unresolved(step)).map(([step, message]) => `${step}: ${message}`);
  cleanup.ok = cleanup.errors.length === 0 && holderGone && (!cleanup.worktreeCreated || (cleanup.worktreeRemoved && cleanup.branchDeleted));
}

/** The environment with GIT_* removed, so a hook or wrapper cannot point git at another repository. */
function gitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_')));
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: gitEnv(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

function tryGit(cwd: string, args: string[]): string | undefined {
  try {
    return git(cwd, args);
  } catch {
    return undefined;
  }
}

/**
 * Split a command line into arguments without a shell: whitespace separates, single and double quotes group, a backslash only
 * escapes a double quote inside double quotes (so Windows paths survive). Unquoted shell operators are refused, not passed on.
 */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;
    if (quote) {
      if (char === quote) quote = null;
      else if (quote === '"' && char === '\\' && line[index + 1] === '"') current += line[++index];
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      inToken = true;
    } else if (/\s/.test(char)) {
      if (inToken) tokens.push(current);
      current = '';
      inToken = false;
    } else if ('|&;<>`'.includes(char) || (char === '$' && line[index + 1] === '(')) {
      throw new CliError('E_USAGE', `--command runs without a shell, so "${char}" is not supported`, 'Put the pipeline in a script and pass "node script.js" or "npm run <name>"');
    } else {
      current += char;
      inToken = true;
    }
  }
  if (quote) throw new CliError('E_USAGE', `--command has an unterminated ${quote} quote`);
  if (inToken) tokens.push(current);
  if (tokens.length === 0) throw new CliError('E_USAGE', '--command is empty');
  return tokens;
}

/** The npm CLI entry points, found without the npm.cmd shim so the command can run with shell:false on every platform. */
function npmBin(file: 'npm-cli.js' | 'npx-cli.js'): string {
  const candidates: string[] = [];
  const execpath = process.env.npm_execpath;
  if (execpath) candidates.push(join(dirname(execpath), file));
  const nodeDir = dirname(process.execPath);
  candidates.push(join(nodeDir, 'node_modules', 'npm', 'bin', file), join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', file));
  for (const entry of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    candidates.push(join(entry, 'node_modules', 'npm', 'bin', file));
    const shim = join(entry, 'npm');
    try {
      if (existsSync(shim)) candidates.push(join(dirname(realpathSync(shim)), file));
    } catch {
      // an unreadable PATH entry is not a candidate
    }
  }
  const found = candidates.find(path => existsSync(path));
  if (!found) throw new CliError('E_NPM_NOT_FOUND', `Cannot locate ${file}`, 'Install Node.js with npm, or pass --command "node <script>"');
  return found;
}

/** Map a tokenized command to an executable and arguments: node, npm and npx run through this Node; anything else runs as given. */
function resolveCommand(tokens: string[]): { file: string; args: string[] } {
  const [head, ...rest] = tokens as [string, ...string[]];
  const name = head.toLowerCase().replace(/\.(cmd|exe)$/, '');
  if (name === 'node') return { file: process.execPath, args: rest };
  if (name === 'npm') return { file: process.execPath, args: [npmBin('npm-cli.js'), ...rest] };
  if (name === 'npx') return { file: process.execPath, args: [npmBin('npx-cli.js'), ...rest] };
  return { file: head, args: rest };
}

function killTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise(done => {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 }, () => done());
    });
  }
  const signal = (name: NodeJS.Signals): void => {
    try {
      process.kill(-pid, name);
    } catch {
      // the group is already gone
    }
  };
  signal('SIGTERM');
  const timer = setTimeout(() => signal('SIGKILL'), KILL_GRACE_MS);
  timer.unref();
  return new Promise(done => {
    child.once('close', () => {
      clearTimeout(timer);
      signal('SIGKILL');
      done();
    });
    // already closed, or never closes: do not wait longer than the grace period
    setTimeout(done, KILL_GRACE_MS + 500).unref();
  });
}

/** Tracks live children so a timeout in one command or an interrupt can end every process tree. */
class Runner {
  interrupted = false;
  private readonly live = new Set<ChildProcess>();

  private readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  async killAll(): Promise<void> {
    await Promise.all([...this.live].map(child => killTree(child)));
  }

  run(tokens: string[], cwd: string): Promise<CommandResult> {
    const started = Date.now();
    return new Promise(finish => {
      let output = '';
      let timedOut = false;
      let settled = false;
      let child: ChildProcess | undefined;
      let timer: NodeJS.Timeout | undefined;
      const done = (exitCode: number | null, signal: string | null): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (child) this.live.delete(child);
        finish({ exitCode, signal, durationMs: Date.now() - started, timedOut, interrupted: this.interrupted, output });
      };
      const collect = (chunk: Buffer): void => {
        if (output.length < OUTPUT_LIMIT) output += chunk.toString('utf8');
      };
      const { file, args } = resolveCommand(tokens);
      let spawned: ChildProcess;
      try {
        spawned = spawn(file, args, {
          cwd,
          shell: false,
          windowsHide: true,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        output = `Error: cannot start ${tokens[0]}: ${(error as Error).message}`;
        done(null, null);
        return;
      }
      child = spawned;
      this.live.add(child);
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);
      child.on('error', error => {
        output += `\nError: cannot start ${tokens[0]}: ${error.message}`;
        done(null, null);
      });
      child.on('close', (code, signal) => done(code, signal));
      timer = setTimeout(() => {
        timedOut = true;
        void this.killAll().then(() => done(null, 'SIGKILL'));
      }, this.timeoutMs);
    });
  }
}

function failureLinesOf(output: string): string[] {
  const lines: string[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!FAILURE_LINE.test(line)) continue;
    lines.push(line.length > 300 ? `${line.slice(0, 300)}...` : line);
    if (lines.length >= MAX_FAILURE_LINES) break;
  }
  return lines;
}

function checkoutRun(result: CommandResult): CheckoutRun {
  const passed = result.exitCode === 0 && !result.timedOut;
  return {
    exitCode: result.exitCode,
    passed,
    durationMs: result.durationMs,
    ...(passed ? {} : { failureLines: failureLinesOf(result.output) }),
  };
}

function testCommand(root: string, command: string | undefined): { display: string; tokens: string[] } {
  if (command !== undefined) return { display: command, tokens: tokenize(command) };
  let scripts: unknown;
  try {
    scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: unknown }).scripts;
  } catch {
    scripts = undefined;
  }
  const test = (scripts as { test?: unknown } | undefined)?.test;
  if (typeof test !== 'string' || test.trim() === '') {
    throw new CliError('E_NO_TEST_COMMAND', `${root} has no scripts.test entry in package.json`, 'Pass the command to run with --command "<cmd>"');
  }
  return { display: 'npm test', tokens: ['npm', 'test'] };
}

/**
 * Run the project's test command alone, then in the root and in a second worktree of HEAD at the same time, to see whether the
 * suite shares state (ports, files, databases) between checkouts. The worktree and its throwaway branch are removed in every case.
 */
export async function worktreeCheck(options: WorktreeCheckOptions): Promise<WorktreeCheckReport> {
  const root = options.root;
  const runs = options.runs ?? DEFAULT_RUNS;
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > MAX_RUNS) throw new CliError('E_USAGE', `--runs must be an integer from 1 to ${MAX_RUNS} (got ${runs})`);
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1) throw new CliError('E_USAGE', `--timeout-seconds must be a positive integer (got ${timeoutSeconds})`);

  if (tryGit(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') throw new CliError('E_NOT_GIT', `${root} is not inside a git work tree`, 'Run the check from a git repository with at least one commit');
  if (tryGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD']) === undefined) throw new CliError('E_NOT_GIT', `${root} has no commits, so there is nothing to check out in a second worktree`, 'Commit first, then rerun');
  const prefix = git(root, ['rev-parse', '--show-prefix']);
  const { display, tokens } = testCommand(root, options.command);
  const rootDirty = git(root, ['status', '--porcelain']) !== '';

  const runner = new Runner(timeoutSeconds * 1000);
  const onSignal = (): void => {
    runner.interrupted = true;
    void runner.killAll();
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  for (const name of signals) process.on(name, onSignal);

  const cleanup: CleanupResult = { ok: true, worktreeCreated: false, worktreeRemoved: false, branchDeleted: false, errors: [], failedSteps: [] };
  let holder: string | undefined;
  let worktree: string | undefined;
  let branch: string | undefined;
  let branchCreated = false;

  const guard = (result: CommandResult, step: string): void => {
    if (runner.interrupted || result.interrupted) throw new CliError('E_INTERRUPTED', `Interrupted during ${step}`);
    if (result.timedOut) throw new CliError('E_TIMEOUT', `${step} did not finish within ${timeoutSeconds} s and was killed`, 'Raise --timeout-seconds or pass a faster --command');
  };

  const report = async (): Promise<Omit<WorktreeCheckReport, 'cleanup'>> => {
    const baselineResult = await runner.run(tokens, root);
    guard(baselineResult, 'the baseline run');
    const baseline = checkoutRun(baselineResult);
    const base = { schema: WORKTREE_CHECK_SCHEMA, command: display, runs, timeoutSeconds, rootDirty, baseline } as const;
    if (!baseline.passed) return { ...base, verdict: 'baseline-failed', install: { performed: false }, results: [] };

    holder = mkdtempSync(join(tmpdir(), 'agent-tests-worktree-check-'));
    worktree = join(holder, 'checkout');
    branch = options.branchName ?? `agent-tests-worktree-check-${process.pid}-${randomBytes(4).toString('hex')}`;
    try {
      git(root, ['worktree', 'add', '-q', '-b', branch, worktree, 'HEAD']);
    } catch (error) {
      const stderr = String((error as { stderr?: unknown }).stderr ?? (error as Error).message).trim();
      throw new CliError('E_WORKTREE_FAILED', `git worktree add failed: ${stderr}`);
    }
    branchCreated = true;
    cleanup.worktreeCreated = true;
    const other = join(worktree, prefix);
    if (!existsSync(other) || !statSync(other).isDirectory()) throw new CliError('E_WORKTREE_FAILED', `${prefix} does not exist at HEAD`);

    let install: WorktreeCheckReport['install'] = { performed: false };
    if (options.install !== false) {
      const locked = existsSync(join(other, 'package-lock.json')) || existsSync(join(other, 'npm-shrinkwrap.json'));
      const installCommand = locked ? 'npm ci' : 'npm install';
      if (existsSync(join(other, 'package.json'))) {
        const result = await runner.run(tokenize(installCommand), other);
        guard(result, `${installCommand} in the worktree`);
        install = { performed: true, command: installCommand, exitCode: result.exitCode, durationMs: result.durationMs };
        if (result.exitCode !== 0) {
          const tail = failureLinesOf(result.output).slice(0, 5).join(' | ');
          throw new CliError('E_INSTALL_FAILED', `${installCommand} failed in the worktree (exit ${result.exitCode})${tail ? `: ${tail}` : ''}`, 'Fix the install, or pass --no-install if the project has no dependencies');
        }
      }
    }

    const results: WorktreeCheckReport['results'] = [];
    for (let run = 1; run <= runs; run++) {
      const [inRoot, inWorktree] = await Promise.all([runner.run(tokens, root), runner.run(tokens, other)]);
      guard(inRoot, `concurrent run ${run} in the root`);
      guard(inWorktree, `concurrent run ${run} in the worktree`);
      results.push({ run, root: checkoutRun(inRoot), worktree: checkoutRun(inWorktree) });
    }
    const hazard = results.some(entry => !entry.root.passed || !entry.worktree.passed);
    return { ...base, verdict: hazard ? 'hazard-observed' : 'no-hazard-observed', install, results };
  };

  const clean = async (): Promise<void> => {
    try {
      await runner.killAll();
    } catch (error) {
      cleanup.failedSteps.push({ step: 'kill processes', message: String((error as Error)?.message ?? error) });
    }
    runCleanup({ root, holder, worktree, branch, branchCreated }, cleanup);
  };

  let outcome: Omit<WorktreeCheckReport, 'cleanup'> | undefined;
  let failure: unknown;
  try {
    outcome = await report();
  } catch (error) {
    failure = error;
  } finally {
    try {
      await clean();
    } catch (error) {
      cleanup.ok = false;
      cleanup.errors.push(`cleanup: ${(error as Error).message}`);
    }
    for (const name of signals) process.off(name, onSignal);
  }
  if (failure !== undefined) {
    if (!cleanup.ok && failure instanceof CliError) {
      throw new CliError(failure.code, `${failure.message}; cleanup incomplete (${cleanup.errors.join('; ') || 'worktree or branch left behind'})`, failure.hint, { cause: failure });
    }
    throw failure;
  }
  return { ...outcome!, cleanup };
}
