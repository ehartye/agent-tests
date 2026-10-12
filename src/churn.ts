import { execFileSync } from 'node:child_process';

const git = (root: string, args: string[], maxBuffer?: number): string =>
  execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    ...(maxBuffer === undefined ? {} : { maxBuffer }),
    stdio: ['ignore', 'pipe', 'ignore'],
  });

/**
 * The files touched by each of the last `limit` commits that touched `root`, newest first. Each set maps a path relative
 * to `root` to its status letter (A added, M modified, T type change, D deleted; a rename or copy is recorded under its
 * new path as R or C). Null when `root` has no usable history: not a repository, no commits yet, or a shallow clone,
 * whose oldest commit would list every file it holds as added.
 */
export function commitFileSets(root: string, limit: number): Array<Map<string, string>> | null {
  let log: string;
  try {
    if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') return null;
    log = git(root, ['log', '-M', '--relative', '--name-status', '--pretty=format:%x00', '-n', String(limit), '--', '.'], 256 * 1024 * 1024);
  } catch {
    return null;
  }
  return log
    .split('\0')
    .slice(1)
    .map(chunk => {
      const files = new Map<string, string>();
      for (const line of chunk.split(/\r?\n/)) {
        if (line === '') continue;
        const [status = '', first = '', second] = line.split('\t');
        const moved = status.startsWith('R') || status.startsWith('C');
        files.set(moved ? (second ?? first) : first, status.charAt(0));
      }
      return files;
    });
}

/**
 * edits: commits that modified the test (status M or T); creating, renaming, copying or deleting it is not an edit.
 * churn: those edits that touched none of the code it covers (any status counts as touching), which is the signature
 * of a brittle test being rewritten for its own sake. Both are null without history. Without subjects churn is null
 * but edits is still counted.
 */
export function churnOf(testRel: string, subjects: string[], sets: Array<Map<string, string>> | null): { churn: number | null; edits: number | null } {
  if (sets === null) return { churn: null, edits: null };
  let edits = 0;
  let churn = 0;
  for (const set of sets) {
    const status = set.get(testRel);
    if (status !== 'M' && status !== 'T') continue;
    edits++;
    if (subjects.length > 0 && !subjects.some(subject => set.has(subject))) churn++;
  }
  return { churn: subjects.length > 0 ? churn : null, edits };
}
