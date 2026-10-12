import { type Stats, linkSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CliError } from './errors.ts';
import { renderMarkdown } from './report.ts';
import { draftRiskMap } from './riskdraft.ts';
import { RISK_MAP_PATH, serializeRiskMap } from './riskmap.ts';
import { scan } from './scan.ts';

const COMMANDS = ['capabilities', 'risk-draft', 'scan', 'report'] as const;

const USAGE = `Usage: tests <${COMMANDS.join('|')}> [--root <dir>] [--write] [--max-files <n>] [--max-per-rule <n>]`;

const HINTS: Record<string, string> = {
  E_USAGE: USAGE,
  E_RISKMAP: 'Fix or delete .testing/risk.yml, then rerun',
  E_EXISTS: 'Delete the file first if you want a fresh draft',
};

export interface Failure {
  code: string;
  message: string;
  hint?: string;
  detail?: string;
}

function packageVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
}

const nodeCode = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
};

/**
 * The one-line JSON error the CLI prints for any failure. A CliError keeps its code and message; anything else is E_INTERNAL, with
 * the Node error code (ENOENT, ENOTDIR) appended to the message. The stack goes in "detail" only when AGENT_TESTS_DEBUG is set.
 */
export function failureFor(error: unknown, env: Record<string, string | undefined> = process.env): Failure {
  let failure: Failure;
  if (error instanceof CliError) {
    failure = { code: error.code, message: error.message };
    const hint = error.hint ?? HINTS[error.code];
    if (hint) failure.hint = hint;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    const code = nodeCode(error);
    failure = { code: 'E_INTERNAL', message: code ? `${message} [${code}]` : message };
  }
  if (env.AGENT_TESTS_DEBUG && error instanceof Error && error.stack) failure.detail = error.stack;
  return failure;
}

/** A positive integer option value, or undefined when the option was not given. */
export function positiveInteger(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < 1) throw new CliError('E_USAGE', `--${name} must be a positive integer (got "${raw}")`);
  return value;
}

/** A reader that closes the pipe early (for example "| head") is not an error. */
export function ignoreBrokenPipe(error: NodeJS.ErrnoException, exit: (code: number) => void = process.exit): void {
  if (error.code === 'EPIPE') {
    exit(0);
    return;
  }
  throw error;
}

/**
 * Create the file only if nothing is there, and never leave a partial file at the target: write a temp file beside it, then publish
 * it with a hard link, which fails instead of overwriting. Filesystems without hard links fall back to an exclusive create.
 */
function writeNewFile(target: string, text: string): void {
  const exists = () => new CliError('E_EXISTS', `${RISK_MAP_PATH} already exists. Edit it by hand or delete it first.`);
  const directory = dirname(target);
  const parent = statSync(directory, { throwIfNoEntry: false });
  if (parent && !parent.isDirectory()) throw new CliError('E_EXISTS', `${basename(directory)} exists and is not a directory`);
  // lstat, not stat: a dangling symlink at the target still counts as something being there.
  if (lstatSync(target, { throwIfNoEntry: false })) throw exists();
  mkdirSync(directory, { recursive: true });

  const temp = join(directory, `${basename(target)}.${process.pid}.tmp`);
  try {
    writeFileSync(temp, text, { flag: 'wx' });
    try {
      linkSync(temp, target);
    } catch (error) {
      const code = nodeCode(error);
      if (code === 'EEXIST') throw exists();
      if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP' && code !== 'ENOSYS') throw error;
      try {
        writeFileSync(target, text, { flag: 'wx' });
      } catch (fallback) {
        if (nodeCode(fallback) === 'EEXIST') throw exists();
        throw fallback;
      }
    }
  } finally {
    rmSync(temp, { force: true });
  }
}

function run(args: string[]): void {
  const [command, ...rest] = args;
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    throw new CliError('E_USAGE', USAGE);
  }
  let values: { root?: string; write?: boolean; 'max-files'?: string; 'max-per-rule'?: string };
  try {
    values = parseArgs({
      args: rest,
      options: { root: { type: 'string' }, write: { type: 'boolean' }, 'max-files': { type: 'string' }, 'max-per-rule': { type: 'string' } },
      strict: true,
    }).values;
  } catch (error) {
    throw new CliError('E_USAGE', (error as Error).message);
  }
  if (command === 'capabilities') {
    process.stdout.write(`${JSON.stringify({ name: 'agent-tests', version: packageVersion(), commands: COMMANDS })}\n`);
    return;
  }
  if (values.root === '') throw new CliError('E_USAGE', '--root needs a directory');
  const root = resolve(values.root ?? process.cwd());
  let rootStat: Stats | undefined;
  try {
    rootStat = statSync(root, { throwIfNoEntry: false });
  } catch (error) {
    // A path through a file (a/file.txt/sub) is ENOTDIR on POSIX; to the caller it is just a root that does not exist.
    if (nodeCode(error) !== 'ENOTDIR') throw error;
  }
  if (!rootStat) throw new CliError('E_USAGE', `Root does not exist: ${root}`);
  if (!rootStat.isDirectory()) throw new CliError('E_USAGE', `Root is not a directory: ${root}`);

  if (command === 'risk-draft') {
    const text = serializeRiskMap(draftRiskMap(root));
    if (!values.write) {
      process.stdout.write(text);
      return;
    }
    writeNewFile(join(root, RISK_MAP_PATH), text);
    process.stdout.write(`${JSON.stringify({ written: RISK_MAP_PATH })}\n`);
    return;
  }
  if (command === 'scan') {
    // scan always prints the full JSON, so the report caps do not apply to it.
    process.stdout.write(`${JSON.stringify(scan(root), null, 2)}\n`);
    return;
  }
  const maxFiles = positiveInteger('max-files', values['max-files']);
  const maxPerRule = positiveInteger('max-per-rule', values['max-per-rule']);
  process.stdout.write(
    renderMarkdown(scan(root), {
      ...(maxFiles !== undefined ? { maxFiles } : {}),
      ...(maxPerRule !== undefined ? { maxPerRule } : {}),
    }),
  );
}

export async function main(argv: string[]): Promise<void> {
  process.stdout.on('error', error => ignoreBrokenPipe(error));
  try {
    run(argv.slice(2));
  } catch (error) {
    const failure = failureFor(error);
    console.error(JSON.stringify({ error: failure }));
    process.exitCode = failure.code === 'E_USAGE' ? 2 : 1;
  }
}
