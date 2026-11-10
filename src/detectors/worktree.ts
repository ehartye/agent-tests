import type { Finding } from '../schema.ts';

interface Rule {
  rule: string;
  pattern: RegExp;
  message: string;
  /** Qualifies a finding that is kept but not settled; it flows into Finding.note. Return undefined for no note. */
  note?: (code: string, match: RegExpExecArray, madeDirs: ReadonlySet<string>) => string | undefined;
  /**
   * Finds an identifier assigned from mkdtemp (capture group 1). Once a file has assigned one, a match whose file
   * name is joined to it (an argument of the same join or resolve call) stays quiet: the path sits inside a
   * directory unique to the run. The identifier merely appearing elsewhere on the line does not count.
   */
  madeDir?: RegExp;
  /** When this matches the line or the line before it, the rule stays quiet (the fix is already in place). */
  skip?: RegExp;
  /** When this matches the line itself, the rule stays quiet (another rule owns that line, or the line is known safe). */
  unless?: RegExp;
  /**
   * A weaker second pattern. It counts only while `weakQuietAfter` has not matched an earlier line of the file,
   * so a name built inside a directory the file already made with mkdtemp stays quiet.
   */
  weak?: RegExp;
  weakQuietAfter?: RegExp;
}

/** Timestamp-like values two runs (or two worktrees) can produce at the same moment. */
const CLOCK = String.raw`(?:Date\.now\(\)|new Date\(\)\.getTime\(\)|performance\.now\(\)|process\.hrtime\b|process\.pid\b)`;

/** A write call with process.cwd() in the path it writes to (the first argument, or the second for a copy or move). */
const CWD_WRITE = new RegExp(
  String.raw`\b(?:write(?:File|FileSync|Stream)?|append(?:File|FileSync)?|mkdir(?:Sync|p)?|rm(?:Sync|dir|dirSync)?|unlink(?:Sync)?|truncate(?:Sync)?|createWriteStream|outputFile(?:Sync)?|outputJson(?:Sync)?|ensureDir(?:Sync)?|emptyDir(?:Sync)?)\s*\((?:[^,()]|\()*?process\.cwd\(\)` +
    String.raw`|\b(?:copyFile|copyFileSync|cp|cpSync|rename|renameSync|symlink|symlinkSync)\s*\(\s*(?:[^,()]|\((?:[^()]|\([^()]*\))*\))*,\s*(?:[^,()]|\()*?process\.cwd\(\)`,
);

/** A fixed /tmp string literal, as shared-tmp matches it. */
const TMP_LITERAL = String.raw`['"\`]/tmp/[^'"\`$]*['"\`]`;

/** An object-property data row (`key: '/tmp/x'`, alone on its line, braces and comma allowed): a value, not a call argument. */
const TMP_PROPERTY_ROW = new RegExp(String.raw`^\{?\s*(?:[A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*:\s*${TMP_LITERAL}\s*\}?\s*,?$`);

/** A statement that only checks the /tmp path is absent, so nothing is created there. */
const TMP_ABSENCE_CHECK = new RegExp(
  String.raw`^(?:await\s+)?(?:` +
    String.raw`expect\(\s*(?:[\w$]+\.)*(?:existsSync|exists)\(\s*${TMP_LITERAL}\s*\)\s*\)\s*\.(?:toBe\(\s*false\s*\)|toBeFalsy\(\s*\)|not\.toBeTruthy\(\s*\)|not\.toBe\(\s*true\s*\))` +
    String.raw`|assert(?:\.ok)?\(\s*!\s*(?:[\w$]+\.)*(?:existsSync|exists)\(\s*${TMP_LITERAL}\s*\)\s*(?:,[^()]*)?\)` +
    String.raw`|assert\.(?:equal|strictEqual)\(\s*(?:[\w$]+\.)*(?:existsSync|exists)\(\s*${TMP_LITERAL}\s*\)\s*,\s*false\s*\)` +
    String.raw`)\s*;?$`,
);

/** `name = mkdtemp(...)` in any of its forms: const/let, a type annotation, await, a namespace, or one wrapping call (realpathSync). */
const MKDTEMP_ASSIGNMENT = /\b(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*(?::\s*[\w<>[\]. |]+)?=(?!=)\s*(?:await\s+)?(?:[\w$.]+\(\s*(?:await\s+)?)*[\w$.]*\bmkdtemp(?:Sync)?\s*\(/;

/** Names that stand for a fixed location, never for a per-run directory a file could be unique inside. */
const FIXED_LOCATIONS = new Set(['__dirname', '__filename', 'import.meta.dirname', 'import.meta.filename']);

/** The bare identifiers joined in the call that holds the matched file name, such as `dir` in join(dir, 'x.sqlite'). */
function joinedIdentifiers(code: string, match: RegExpExecArray): string[] {
  const args = /\b(?:join|resolve)\(([^()]*)$/.exec(code.slice(0, match.index))?.[1];
  if (args === undefined) return [];
  return args
    .split(',')
    .map(arg => arg.trim())
    .filter(arg => /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(arg) && !FIXED_LOCATIONS.has(arg));
}

/** A made directory is tracked by its bare name, so `this.runDir` is the same directory as `runDir`. */
function dirKey(name: string): string {
  return name.replace(/^this\./, '');
}

/** A finding on a file joined to a directory held in an identifier the file never assigned from mkdtemp stays, qualified. */
function unresolvedDirNote(code: string, match: RegExpExecArray, madeDirs: ReadonlySet<string>): string | undefined {
  const untraced = joinedIdentifiers(code, match).filter(name => !madeDirs.has(dirKey(name)));
  if (untraced.length === 0) return undefined;
  return `Path uniqueness unresolved: ${untraced.join(', ')} has no earlier assignment from mkdtemp in this file, so the path may be shared; confirm the caller passes a per-run directory.`;
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
    // Quiet only for a property data row and an absence check; an array row or a split call's argument line looks the same as a write, so it stays flagged.
    unless: new RegExp(`${TMP_PROPERTY_ROW.source}|${TMP_ABSENCE_CHECK.source}`),
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
    // A line that joins a directory the file assigned from mkdtemp is unique per run; one that joins an untraced identifier is kept, with a note.
    madeDir: MKDTEMP_ASSIGNMENT,
    note: unresolvedDirNote,
    message: 'Fixed database file name: concurrent worktrees share or clobber it unless the path is unique per run.',
  },
  {
    rule: 'worktree.timestamp-tmp-path',
    // A timestamp (or pid) in a name under tmpdir() or /tmp. A random part on the same line makes the name unique, so it stays quiet.
    pattern: new RegExp(String.raw`^(?!.*(?:Math\.random|randomUUID|randomBytes|randomInt|nanoid|uuid))(?=.*(?:tmpdir\(\)|['"\`]/tmp/|\bTMPDIR\b)).*${CLOCK}`, 'i'),
    // A separator-ended name prefix joined to a timestamp ('name-' + Date.now()) is a name two runs can share wherever it lands.
    weak: new RegExp(String.raw`^(?!.*(?:Math\.random|randomUUID|randomBytes|randomInt|nanoid|uuid)).*['"\`][\w.\-]*[-_]['"\`]\s*\+\s*${CLOCK}`, 'i'),
    weakQuietAfter: /mkdtemp/,
    skip: /mkdtemp/,
    message: 'Temp path named from a timestamp: two runs in the same millisecond, or two worktrees, can share it. Use mkdtemp for a unique directory.',
  },
  {
    rule: 'worktree.cwd-write',
    // process.cwd() in the destination of a write call: the first argument of most calls, the second of a copy or move.
    pattern: CWD_WRITE,
    message: 'Write under process.cwd() lands in the checkout the suite runs from. Write into a per-run temp directory instead.',
  },
  {
    rule: 'worktree.cwd-locate',
    // process.cwd() joined, resolved or concatenated into a path, or a relative repo-directory resolve(); writes belong to cwd-write.
    pattern: /\b(?:join|resolve|pathToFileURL)\(\s*process\.cwd\(\)\s*,|process\.cwd\(\)\s*\+\s*['"`]|\bresolve\(\s*['"`](?:\.\/)?(?:scripts|src|bin|lib|dist|docs|packages|examples|server|tests?|fixtures|assets|public)\//,
    unless: CWD_WRITE,
    message: 'process.cwd() locates repository files: this breaks when the suite runs from another directory or worktree. Derive the path from import.meta.url or the test file.',
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
    // A backslash before the slash means this is an escaped slash in a regex literal, not a comment opener.
    if (line.startsWith('/*', index) && line.charAt(index - 1) !== '\\') {
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
  const madeQuiet = new Set<string>();
  /** Identifiers the file assigned from mkdtemp so far; a path inside one is unique to the run. */
  const madeDirs = new Set<string>();
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
        if (rule.unless?.test(code)) continue;
        let match = rule.pattern.exec(code);
        if (!match && rule.weak && !madeQuiet.has(rule.rule)) match = rule.weak.exec(code);
        if (match && rule.madeDir && joinedIdentifiers(code, match).some(name => madeDirs.has(dirKey(name)))) continue;
        if (match) {
          const note = rule.note?.(code, match, madeDirs);
          findings.push({
            category: 'worktree',
            rule: rule.rule,
            file,
            line: index + 1,
            message: rule.message,
            evidence: evidenceWindow(code, match),
            ...(note ? { note } : {}),
          });
        }
      }
      for (const rule of RULES) {
        if (rule.weakQuietAfter?.test(code)) madeQuiet.add(rule.rule);
        const made = rule.madeDir?.exec(code)?.[1];
        if (made) madeDirs.add(made);
      }
    }
    previous = code;
  }
  return findings;
}
