import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CliError } from './errors.ts';
import { renderMarkdown } from './report.ts';
import { draftRiskMap } from './riskdraft.ts';
import { RISK_MAP_PATH, serializeRiskMap } from './riskmap.ts';
import { scan } from './scan.ts';

const COMMANDS = ['capabilities', 'risk-draft', 'scan', 'report'] as const;

const USAGE = `Usage: tests <${COMMANDS.join('|')}> [--root <dir>] [--write] [--max-files <n>] [--max-per-rule <n>]`;

function packageVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
}

/** A positive integer option value, or undefined when the option was not given. */
function positiveInteger(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < 1) throw new CliError('E_USAGE', `--${name} must be a positive integer (got "${raw}")`);
  return value;
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
  const root = resolve(values.root ?? process.cwd());
  if (!existsSync(root)) throw new CliError('E_USAGE', `Root does not exist: ${root}`);

  if (command === 'risk-draft') {
    const text = serializeRiskMap(draftRiskMap(root));
    if (!values.write) {
      process.stdout.write(text);
      return;
    }
    const target = join(root, RISK_MAP_PATH);
    if (existsSync(target)) throw new CliError('E_EXISTS', `${RISK_MAP_PATH} already exists. Edit it by hand or delete it first.`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
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
  try {
    run(argv.slice(2));
  } catch (error) {
    const failure = error instanceof CliError ? error : new CliError('E_INTERNAL', error instanceof Error ? error.message : String(error));
    console.error(JSON.stringify({ error: { code: failure.code, message: failure.message, ...(failure.hint ? { hint: failure.hint } : {}) } }));
    process.exitCode = failure.code === 'E_USAGE' ? 2 : 1;
  }
}
