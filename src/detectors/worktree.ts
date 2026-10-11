import type { Finding } from '../schema.ts';

interface Rule {
  rule: string;
  pattern: RegExp;
  message: string;
  /** When this matches the line or the line before it, the rule stays quiet (the fix is already in place). */
  skip?: RegExp;
}

const RULES: Rule[] = [
  {
    rule: 'worktree.fixed-port',
    // A name that is `port` or ends in `_PORT` or `Port` (not report, passport, viewport), a loopback host, or a listen call, then a 4-5 digit literal.
    pattern:
      /(?:\blisten\(\s*|(?:\b(?:port|PORT|Port)|[A-Za-z0-9]Port|_(?:port|PORT))['"`]?\s*(?::|=(?!=))\s*['"`]?|localhost:|127\.0\.0\.1:|0\.0\.0\.0:|\[::1\]:)(\d{4,5})\b/,
    message: 'Hard-coded port: two worktrees running tests at once collide. Use port 0 or a per-run port.',
  },
  {
    rule: 'worktree.absolute-path',
    pattern: /['"`](?:[A-Za-z]:[\\/]|\/(?:Users|home)\/)[^'"`]*['"`]/,
    message: 'Absolute path into one checkout or machine; another worktree resolves elsewhere. Derive paths from the test file or repo root.',
  },
  {
    rule: 'worktree.shared-tmp',
    // A fixed /tmp literal (not `'/tmp/' + id` or a template with ${}), or a fixed name under tmpdir() that is not a mkdtemp prefix ending in - or _.
    pattern: /['"`]\/tmp\/[^'"`$]*['"`](?!\s*\+)|tmpdir\(\)\s*,\s*['"`][^'"`$]+(?<![-_])['"`]\s*\)/,
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
    // Reads only: assigning or deleting HOME and USERPROFILE is how a test isolates itself.
    pattern: /\bhomedir\(\)|(?<!delete\s+)process\.env\.(?:HOME|USERPROFILE)\b(?!\s*(?:\?\?|\|\||&&)?=(?!=))/,
    message: 'State under the user home directory is shared by every worktree. Use a per-run temp directory.',
  },
  {
    rule: 'worktree.fixed-db-file',
    // A named database file outside fixtures/, not inside a mkdtemp directory; a bare '.db' extension is not a file name.
    pattern: /['"`](?![^'"`]*fixtures[/\\])[^'"`\s$]*[^'"`\s$/\\.]\.(?:sqlite3?|db)['"`]/i,
    skip: /mkdtemp/,
    message: 'Fixed database file name: concurrent worktrees share or clobber it unless the path is unique per run.',
  },
];

const EVIDENCE_WIDTH = 160;

/**
 * Remove comments from one line, keeping string contents (the hazards live in strings).
 * `inBlock` says a block comment is still open from an earlier line; the result says whether one is open after this line.
 */
function stripComments(line: string, inBlock: boolean): { code: string; inBlock: boolean } {
  let code = '';
  let quote = '';
  let index = 0;
  while (index < line.length) {
    if (inBlock) {
      const end = line.indexOf('*/', index);
      if (end === -1) return { code, inBlock: true };
      index = end + 2;
      inBlock = false;
      code += ' ';
      continue;
    }
    const char = line.charAt(index);
    if (quote) {
      code += char;
      if (char === '\\' && index + 1 < line.length) {
        code += line.charAt(index + 1);
        index += 2;
        continue;
      }
      if (char === quote) quote = '';
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      code += char;
      index += 1;
      continue;
    }
    if (line.startsWith('/*', index)) {
      inBlock = true;
      index += 2;
      continue;
    }
    if (line.startsWith('//', index) && (index === 0 || /\s/.test(line.charAt(index - 1)))) break;
    code += char;
    index += 1;
  }
  return { code, inBlock };
}

/** Up to EVIDENCE_WIDTH characters of the line, centred on the match so a hit far along a long line stays visible. */
function evidenceWindow(code: string, match: RegExpExecArray): string {
  if (code.length <= EVIDENCE_WIDTH) return code;
  const middle = match.index + Math.floor(match[0].length / 2);
  const start = Math.max(0, Math.min(middle - EVIDENCE_WIDTH / 2, code.length - EVIDENCE_WIDTH));
  return code.slice(start, start + EVIDENCE_WIDTH);
}

/** Hazards that make a test pass alone in one checkout and fail beside a second worktree. */
export function detectWorktreeHazards(file: string, lines: string[]): Finding[] {
  const findings: Finding[] = [];
  let inBlock = false;
  let previous = '';
  for (const [index, text] of lines.entries()) {
    const trimmed = text.trim();
    // A doc-comment body line (` * text`) whose opening comment is not among the lines we were given; `*/ code` closes a comment.
    if (!inBlock && /^\*(?:\s|$)/.test(trimmed)) {
      previous = '';
      continue;
    }
    const stripped = stripComments(text, inBlock || trimmed.startsWith('*/'));
    inBlock = stripped.inBlock;
    const code = stripped.code.trim();
    if (code) {
      for (const rule of RULES) {
        if (rule.skip && (rule.skip.test(code) || rule.skip.test(previous))) continue;
        const match = rule.pattern.exec(code);
        if (match) {
          findings.push({ category: 'worktree', rule: rule.rule, file, line: index + 1, message: rule.message, evidence: evidenceWindow(code, match) });
        }
      }
    }
    previous = code;
  }
  return findings;
}
