import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { CliError } from './errors.ts';
import { relPosix } from './paths.ts';

type Outcome = 'passed' | 'failed' | 'unknown';
type Interval = { start: number; end: number; elapsed: number; outcome: Outcome };
export interface Timings {
  sha256: string;
  outcome: Outcome;
  files: Map<string, Interval>;
  windowMs: number | null;
  ambiguous: number;
  invalid: number;
  skipped: number;
  unmatched: number;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const skippedStatus = (status: unknown) => status === 'skipped' || status === 'pending' || status === 'todo';

interface TimingInput {
  sha256: string;
  outcome: Outcome;
  rows: unknown[];
}

/** Decode and identify one input before opening the audited project's parser session. */
export function readTimingInput(root: string, input: string): TimingInput {
  let bytes: Buffer;
  let data: unknown;
  try {
    const path = resolve(root, input);
    if (!statSync(path).isFile()) throw new Error('Expected a regular file');
    bytes = readFileSync(path);
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new CliError('E_TIMINGS', `Cannot read timing input: ${(error as Error).message}`);
  }
  if (!record(data) || !Array.isArray(data.testResults)) throw new CliError('E_TIMINGS', 'Expected a JSON object with a testResults array');
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    outcome: data.success === true ? 'passed' : data.success === false ? 'failed' : 'unknown',
    rows: data.testResults,
  };
}

export function importTimings(root: string, input: string | TimingInput, inventory: readonly { file: string }[]): Timings {
  const { sha256, outcome, rows } = typeof input === 'string' ? readTimingInput(root, input) : input;
  const known = new Set(inventory.map(entry => entry.file));
  const ambiguous = new Set<string>();
  const result: Timings = {
    sha256, outcome,
    files: new Map(), windowMs: null, ambiguous: 0, invalid: 0, skipped: 0, unmatched: 0,
  };
  for (const row of rows) {
    if (record(row) && (skippedStatus(row.status) || (row.status !== 'failed' && Array.isArray(row.assertionResults) && row.assertionResults.length &&
      row.assertionResults.every((item: unknown) => record(item) && skippedStatus(item.status))))) {
      result.skipped++;
      continue;
    }
    if (!record(row) || typeof row.name !== 'string' || !row.name.trim() ||
      typeof row.startTime !== 'number' || !Number.isFinite(row.startTime) || row.startTime <= 0 ||
      typeof row.endTime !== 'number' || !Number.isFinite(row.endTime) || row.endTime < row.startTime) {
      result.invalid++;
      continue;
    }
    const path = row.name.replaceAll('\\', '/');
    // Reject drive-relative and foreign absolute paths before native resolution can rebase them.
    const foreign = (/^[A-Za-z]:/.test(path) && !/^[A-Za-z]:\//.test(path)) ||
      (/^(?:[A-Za-z]:\/|\/\/)/.test(path) && process.platform !== 'win32') ||
      (process.platform === 'win32' && /^\/(?!\/)/.test(path));
    const candidates = new Set<string>();
    if (!foreign) {
      for (const spelling of [row.name, path]) {
        const relative = relPosix(root, resolve(root, spelling));
        if (known.has(relative)) candidates.add(relative);
      }
    }
    if (!candidates.size) result.unmatched++;
    for (const file of candidates) {
      if (candidates.size > 1 || result.files.has(file) || ambiguous.has(file)) {
        result.files.delete(file);
        ambiguous.add(file);
      } else {
        result.files.set(file, { start: row.startTime, end: row.endTime, elapsed: row.endTime - row.startTime, outcome: row.status === 'passed' || row.status === 'failed' ? row.status : 'unknown' });
      }
    }
  }
  let earliest = Infinity, latest = -Infinity;
  for (const { start, end } of result.files.values()) {
    earliest = Math.min(earliest, start);
    latest = Math.max(latest, end);
  }
  if (result.files.size) result.windowMs = latest - earliest;
  result.ambiguous = ambiguous.size;
  return result;
}
