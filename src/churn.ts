import { execFileSync } from 'node:child_process';

/** Files touched by each of the last `limit` commits, newest first, relative to `root`. Null when `root` has no usable git history. */
export function commitFileSets(root: string, limit: number): Array<Set<string>> | null {
  let log: string;
  try {
    log = execFileSync('git', ['-c', 'core.quotepath=off', 'log', '--relative', '--name-only', '--pretty=format:%x00', '-n', String(limit)], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  return log
    .split('\0')
    .slice(1)
    .map(chunk => new Set(chunk.split(/\r?\n/).filter(Boolean)));
}

/**
 * edits: commits that touched the test. churn: those that touched it without touching any code it covers,
 * which is the signature of a brittle test being rewritten for its own sake. Churn is unknown without subjects.
 */
export function churnOf(testRel: string, subjects: string[], sets: Array<Set<string>> | null): { churn: number | null; edits: number | null } {
  if (sets === null) return { churn: null, edits: null };
  let edits = 0;
  let churn = 0;
  for (const set of sets) {
    if (!set.has(testRel)) continue;
    edits++;
    if (subjects.length > 0 && !subjects.some(subject => set.has(subject))) churn++;
  }
  return { churn: subjects.length > 0 ? churn : null, edits };
}
