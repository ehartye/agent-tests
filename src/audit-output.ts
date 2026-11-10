import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, linkSync, lstatSync, mkdtempSync, openSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSource } from '../scripts/managed-runtime.js';
import { CliError } from './errors.ts';
import { DEFAULT_MAX_FILES, DEFAULT_MAX_PER_RULE, renderMarkdown, type ReportOptions } from './report.ts';
import type { EvidenceReport } from './schema.ts';

export function producerIdentity(source = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const { name, version, fingerprint } = describeSource(source);
  return { name, version, sourceFingerprint: fingerprint, node: process.versions.node };
}

/**
 * The unknown-runner warning stays unless a supported language with a runner other than `unknown` has at least one inventoried file.
 * Without an inventory the primary runner decides; JavaScript with runner `unknown` never suppresses it.
 */
const noSupportedRunner = (evidence: EvidenceReport): boolean =>
  evidence.inventory
    ? !evidence.inventory.languages.some(entry => entry.status === 'supported' && entry.runner !== 'unknown' && entry.files > 0)
    : evidence.runner === 'unknown';

/** Identity of the producer, not a fingerprint or snapshot of the audited project. */
export function auditArtifact(evidence: EvidenceReport, command: 'scan' | 'report', options: ReportOptions = {}, producer = producerIdentity()): string {
  const artifact = {
    schema: 'agent-tests/audit-output@1', producer, command, root: evidence.root,
    options: command === 'report' ? { maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES, maxPerRule: options.maxPerRule ?? DEFAULT_MAX_PER_RULE } : {},
    limits: [
      'Static evidence only; project tests were not executed. Audited inputs are not an immutable snapshot.',
      ...(noSupportedRunner(evidence) ? ['No supported runner detected; a zero static test count does not prove that the project has no tests.'] : []),
    ],
  };
  if (command === 'scan') return `${JSON.stringify({ ...evidence, artifact }, null, 2)}\n`;
  const warning = noSupportedRunner(evidence) ? '> No supported runner detected; a zero static test count does not prove that the project has no tests.\n\n' : '';
  return renderMarkdown(evidence, options).replace('# Test audit evidence\n\n', `# Test audit evidence\n\n${warning}`)
    + `\n## Artifact identity\n\n\`\`\`json\n${JSON.stringify(artifact, null, 2)}\n\`\`\`\n`;
}

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
const existsError = (target: string) => new CliError('E_EXISTS', `Output already exists: ${target}`, 'Choose a new output filename; existing evidence is never replaced.');

export function admitOutput(root: string, out: string): string {
  if (!out.trim() || out.includes('\0')) throw new CliError('E_USAGE', '--out needs a nonempty file path');
  const target = resolve(root, out);
  if (lstatSync(target, { throwIfNoEntry: false })) throw existsError(target);
  const parent = statSync(dirname(target), { throwIfNoEntry: false });
  if (!parent?.isDirectory()) throw new CliError('E_OUTPUT', 'The output parent must already exist and be a directory', 'Create the chosen output directory, then rerun.');
  return target;
}

/** Complete staged bytes publish atomically without overwriting; no partial-copy fallback. */
export function publishAudit(target: string, text: string, io = {
  write: (fd: number, bytes: Buffer) => writeFileSync(fd, bytes),
  link: linkSync, unlink: unlinkSync, rmdir: rmdirSync,
}) {
  const bytes = Buffer.from(text, 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  // Pin the explicitly selected parent, including deliberate directory aliases.
  const parent = realpathSync(dirname(target));
  const destination = join(parent, basename(target));
  if (lstatSync(destination, { throwIfNoEntry: false })) throw existsError(target);
  const stage = mkdtempSync(join(parent, '.agent-tests-output-'));
  const file = join(stage, 'body');
  let fd: number | undefined, failure: unknown, published = false;
  const cleanupWarnings: string[] = [];
  try {
    fd = openSync(file, 'wx'); io.write(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    io.link(file, destination); published = true;
  } catch (error) { failure = error; }
  if (fd !== undefined) { try { closeSync(fd); } catch (error) { cleanupWarnings.push(String(error)); } }
  try { io.unlink(file); } catch (error) { if (codeOf(error) !== 'ENOENT') cleanupWarnings.push(String(error)); }
  try { io.rmdir(stage); } catch (error) { cleanupWarnings.push(String(error)); }
  if (!published) {
    if (codeOf(failure) === 'EEXIST') {
      if (cleanupWarnings.length) throw new CliError('E_EXISTS', `Output already exists: ${target}; owned staging retained at ${stage}`, 'The existing destination was preserved. Inspect the retained stage; choose a new output filename.');
      throw existsError(target);
    }
    throw new CliError('E_OUTPUT', `Output publication failed (${codeOf(failure) ?? String(failure)})${cleanupWarnings.length ? `; owned staging retained at ${stage}` : ''}`, 'No output file was published by this attempt. Same-volume hard-link support is required.');
  }
  return { written: destination, bytes: bytes.length, sha256, ...(cleanupWarnings.length ? { cleanupWarnings, staging: stage } : {}) };
}
