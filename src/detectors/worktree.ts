import type { Finding } from '../schema.ts';

interface Rule {
  rule: string;
  pattern: RegExp;
  message: string;
  skip?: RegExp;
}

const RULES: Rule[] = [
  {
    rule: 'worktree.fixed-port',
    pattern: /(?:\blisten\(\s*|\bport\s*[:=]\s*|localhost:|127\.0\.0\.1:|0\.0\.0\.0:)(\d{4,5})\b/i,
    message: 'Hard-coded port: two worktrees running tests at once collide. Use port 0 or a per-run port.',
  },
  {
    rule: 'worktree.absolute-path',
    pattern: /['"`](?:[A-Za-z]:[\\/]|\/(?:Users|home)\/)[^'"`]*['"`]/,
    message: 'Absolute path into one checkout or machine; another worktree resolves elsewhere. Derive paths from the test file or repo root.',
  },
  {
    rule: 'worktree.shared-tmp',
    pattern: /['"`]\/tmp\/[^'"`]*['"`]|tmpdir\(\)\s*,\s*['"`][^'"`$]+['"`]\s*\)/,
    skip: /mkdtemp/,
    message: 'Fixed temp path shared by every worktree and every parallel run. Use mkdtemp for a unique directory.',
  },
  {
    rule: 'worktree.dot-git-dir',
    pattern: /['"`/\\]\.git(?:['"`/\\])/,
    message: 'In a linked worktree .git is a file, not a directory. Ask git (rev-parse --git-dir) instead of reading .git directly.',
  },
  {
    rule: 'worktree.home-dir',
    pattern: /\bhomedir\(\)|process\.env\.(?:HOME|USERPROFILE)\b/,
    message: 'State under the user home directory is shared by every worktree. Use a per-run temp directory.',
  },
  {
    rule: 'worktree.fixed-db-file',
    pattern: /['"`][^'"`\s$]*\.(?:sqlite3?|db)['"`]/,
    message: 'Fixed database file name: concurrent worktrees share or clobber it unless the path is unique per run.',
  },
];

/** Hazards that make a test pass alone in one checkout and fail beside a second worktree. */
export function detectWorktreeHazards(file: string, lines: string[]): Finding[] {
  const findings: Finding[] = [];
  lines.forEach((text, index) => {
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    for (const rule of RULES) {
      if (rule.skip?.test(text)) continue;
      if (rule.pattern.test(text)) {
        findings.push({ category: 'worktree', rule: rule.rule, file, line: index + 1, message: rule.message, evidence: trimmed.slice(0, 160) });
      }
    }
  });
  return findings;
}
