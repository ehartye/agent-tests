import { Category, type EvidenceReport, type Finding, type TestFileRecord } from './schema.ts';

import type { Timings } from './timings.ts';

export interface ReportOptions {
  timings?: Timings;
  /** How many test files the table lists. */
  maxFiles?: number;
  /** How many findings one rule lists in the per-file section. */
  maxPerRule?: number;
}

export const DEFAULT_MAX_FILES = 40;
export const DEFAULT_MAX_PER_RULE = 30;
const MAX_EVIDENCE = 160;
const MAX_UNPARSED_LISTED = 10;
const MAX_BROWSER_DRIVERS = 10;
const MAX_RULES_PER_ROW = 4;
/** The No direct assertions section names at most this many tests per file and lists this many files; the Skips section lists at most as many files. */
const MAX_NAMED_PER_FILE = 5;
const MAX_LISTED_FILES = 20;
const MAX_SKIP_REASONS_PER_FILE = 3;
/** Only the first rows of the table spell out their shared title words. */
const MAX_OVERLAP_ROWS = 5;

/** Wiring rules in the order the audit should read them; other wiring rules follow. */
const WIRING_ORDER = ['wiring.uncovered-critical', 'wiring.inventory-incomplete', 'wiring.drift', 'wiring.no-risk-map'];

/** Any run of whitespace, newlines and carriage returns included, becomes one space, so a value stays on one line. */
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** A table cell: flattened, with pipes escaped. */
const cell = (text: string): string => flat(text).replace(/\|/g, '\\|');

/** An inline code span whose fence is longer than any backtick run inside, so the text cannot break out of it. */
function literalSpan(body: string): string {
  const longest = (body.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  const pad = body.startsWith('`') || body.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${body}${pad}${fence}`;
}

const span = (text: string): string => literalSpan(flat(text));

/** Single-quote a path for PowerShell on Windows or a POSIX shell elsewhere. */
function shellPath(path: string): string {
  const escaped = process.platform === 'win32' ? path.replace(/['\u2018-\u201b]/g, quote => "'" + quote) : path.replaceAll("'", "'\\''");
  return `'${escaped}'`;
}

function clip(text: string): string {
  const chars = [...flat(text)];
  return chars.length > MAX_EVIDENCE ? `${chars.slice(0, MAX_EVIDENCE - 1).join('')}…` : chars.join('');
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const where = (finding: Finding): string => `${flat(finding.file)}${finding.line ? `:${finding.line}` : ''}`;
/** Findings without a line sort first (lines are positive); lines compare as numbers, never as text. */
const byLocation = (a: Finding, b: Finding): number => compare(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || compare(a.rule, b.rule);

const categoryIndex = (category: Finding['category']): number => Category.options.indexOf(category);

/** Project findings read wiring first (the risk map's own gaps), then the other categories in schema order. */
function byProjectOrder(a: Finding, b: Finding): number {
  const rank = (finding: Finding): number => (finding.category === 'wiring' ? 0 : 1 + categoryIndex(finding.category));
  const ruleRank = (finding: Finding): number => (finding.category === 'wiring' ? (WIRING_ORDER.includes(finding.rule) ? WIRING_ORDER.indexOf(finding.rule) : WIRING_ORDER.length) : 0);
  return rank(a) - rank(b) || ruleRank(a) - ruleRank(b) || byLocation(a, b);
}

/** The distinct rules of a file with their counts, most frequent first, then alphabetical. */
function ruleCounts(file: TestFileRecord): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const finding of file.findings) counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]));
}

const skipTotal = (file: TestFileRecord): number => (file.skips?.declared ?? 0) + (file.skips?.conditional ?? 0);

const isUnparsed = (file: TestFileRecord): boolean => file.flags.includes('unparsed');
const hasOpaqueRegistration = (file: TestFileRecord): boolean => file.findings.some(finding => finding.rule === 'wiring.opaque-test-registration');

/** The largest title-word overlap carried by the file's findings; 0 when it has none. */
const overlapOf = (file: TestFileRecord): number => Math.max(0, ...file.findings.map(finding => finding.overlap ?? 0));

/** The shared-title-words part of the best overlap finding's evidence (it ends at the first semicolon), or undefined. */
function overlapEvidence(file: TestFileRecord): string | undefined {
  const best = [...file.findings].sort((a, b) => (b.overlap ?? 0) - (a.overlap ?? 0))[0];
  if (!best?.overlap) return undefined;
  const head = best.evidence.split(';')[0] ?? '';
  return head ? flat(head) : undefined;
}

function rulesCell(file: TestFileRecord, showOverlap = false): string {
  const counts = ruleCounts(file);
  if (counts.length === 0) return '-';
  const shown = counts.slice(0, MAX_RULES_PER_ROW).map(([rule, count]) => (count > 1 ? `${rule} x${count}` : rule));
  if (counts.length > MAX_RULES_PER_ROW) shown.push(`+${counts.length - MAX_RULES_PER_ROW} more`);
  const evidence = showOverlap ? overlapEvidence(file) : undefined;
  return cell(evidence ? `${shown.join(', ')} (${evidence})` : shown.join(', '));
}

/** Unparsed files first (their structure is unknown), then the breadth of evidence, its volume, the file's size, and the path. */
function rankFiles(files: TestFileRecord[]): TestFileRecord[] {
  return files
    .map(file => {
      const confirmed = file.findings.filter(finding => finding.confidence !== 'possible');
      return { file, distinct: new Set(confirmed.map(finding => finding.rule)).size, total: confirmed.length };
    })
    .sort(
      (a, b) =>
        Number(isUnparsed(b.file)) - Number(isUnparsed(a.file)) ||
        Number(hasOpaqueRegistration(b.file)) - Number(hasOpaqueRegistration(a.file)) ||
        b.distinct - a.distinct ||
        overlapOf(b.file) - overlapOf(a.file) ||
        b.total - a.total ||
        b.file.cost.agent - a.file.cost.agent ||
        compare(a.file.file, b.file.file),
    )
    .map(entry => entry.file);
}

function messageOf(finding: Finding): string {
  const text = flat(finding.message);
  return finding.confidence === 'possible' && !/^possible\b/i.test(text) ? `Possible: ${text}` : text;
}

function projectLine(finding: Finding): string {
  const evidence = finding.evidence ? ` Evidence: ${span(clip(finding.evidence))}.` : '';
  const note = finding.note ? ` Note: ${flat(finding.note)}` : '';
  return `- ${span(where(finding))} **${flat(finding.rule)}**: ${messageOf(finding)}${evidence}${note}`;
}

function fileLine(finding: Finding, showMessage: boolean): string {
  const evidence = finding.evidence ? ` ${span(clip(finding.evidence))}` : '';
  const note = finding.note ? ` (${flat(finding.note)})` : '';
  return `- ${span(where(finding))}${evidence}${showMessage ? " " + messageOf(finding) : ""}${note}`;
}

/**
 * Markdown view of an evidence report for the audit skill to read and the owner to skim. It ranks, caps and de-duplicates
 * so the evidence that matters comes first; the scan JSON holds everything. Pure and deterministic.
 */
export function renderMarkdown(report: EvidenceReport, options: ReportOptions = {}): string {
  const timings = options.timings;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxPerRule = options.maxPerRule ?? DEFAULT_MAX_PER_RULE;
  const perFile = report.files.flatMap(file => file.findings);
  const all = [...perFile, ...report.projectFindings];
  const unparsed = report.files.filter(isUnparsed).map(file => file.file).sort(compare);

  const out: string[] = [
    '# Test audit evidence',
    '',
    `- Runner: ${report.runner}`,
    `- Phase: ${report.phase ?? 'unknown (no risk map)'}`,
    `- Risk map: ${report.riskMapPresent ? 'present' : 'missing'}`,
    `- Test files: ${report.files.length}`,
  ];
  const drivers = report.standaloneBrowserDrivers;
  if (drivers?.length) {
    out.push('- Standalone browser drivers outside the test file count');
    for (const driver of drivers.slice(0, MAX_BROWSER_DRIVERS)) {
      out.push(`  - ${literalSpan(driver.file)} (${driver.scripts.map(literalSpan).join(', ')}), ${driver.inspection}`);
    }
    if (drivers.length > MAX_BROWSER_DRIVERS) {
      const omitted = drivers.length - MAX_BROWSER_DRIVERS;
      const command = `node "<plugin-root>/scripts/run-managed.js" scan --root ${shellPath(report.root)}`;
      out.push(`  - ${omitted} omitted. For the full list, run ${literalSpan(command)}.`);
    }
  }
  if (timings) out.push(
    `- Timing input SHA-256: ${timings.sha256} (run outcome: ${timings.outcome})`,
    `- Matched files: ${timings.files.size}, unmatched rows: ${timings.unmatched}, invalid rows: ${timings.invalid}, skipped rows: ${timings.skipped}, ambiguous files: ${timings.ambiguous}`,
  );
  if (report.inventory) {
    const { languages, complete, notes } = report.inventory;
    out.push(`- Languages: ${languages.map(entry => `${flat(entry.language)} (${entry.status === 'supported' ? flat(entry.runner) : entry.status}, ${entry.files} files)`).join(', ')}`);
    if (!complete) {
      const unsupported = languages.filter(entry => entry.status === 'detected-unsupported').map(entry => flat(entry.language));
      // The unsupported-language statement is a sentence of its own. The notes follow as clauses: each loses one trailing period, they
      // are joined with "; " (spec-fixed note texts carry no final punctuation) and the line ends with one period.
      const clauses = notes.map(note => flat(note).replace(/\.$/, '')).filter(Boolean).join('; ');
      out.push(`- Inventory incomplete: ${[unsupported.length > 0 ? `${unsupported.join(', ')} detected but not inventoried.` : '', clauses ? `${clauses}.` : ''].filter(Boolean).join(' ')}`);
    }
  }
  if (report.runner === 'unknown' && report.files.length === 0) out.push('- No supported runner detected; a zero test count does not prove the project has no tests.');
  if (unparsed.length > 0) {
    const listed = unparsed.slice(0, MAX_UNPARSED_LISTED).map(span);
    if (unparsed.length > MAX_UNPARSED_LISTED) listed.push(`+${unparsed.length - MAX_UNPARSED_LISTED} more`);
    out.push(`- Unparsed files: ${unparsed.length}. The tool could not read their structure, so read them directly: ${listed.join(', ')}`);
  }
  const skipFiles = report.files.filter(file => file.skips).sort((a, b) => skipTotal(b) - skipTotal(a) || compare(a.file, b.file));
  if (skipFiles.length > 0) {
    const declared = skipFiles.reduce((sum, file) => sum + file.skips!.declared, 0);
    const conditional = skipFiles.reduce((sum, file) => sum + file.skips!.conditional, 0);
    out.push(`- Skipped cases: ${declared} declared, ${conditional} conditional in ${skipFiles.length} files`);
  }
  out.push(
    '',
    '**How to read this.** Findings are evidence, not verdicts: judge each one against the risk map and the test itself.',
    timings ? 'Measured files rank first by descending elapsed milliseconds, with path breaking ties. Unmeasured files retain static evidence order.' : 'Files are ranked with unparsed files first, then opaque registration candidates, then by confirmed distinct finding rules, the largest title-word overlap with a same-subject file, total confirmed findings and agent tokens.',
    'Agent is the estimated tokens in the file. Churn/edits counts edits that touched the test without the code it covers, over all edits that modified it; n/a means no git history or no resolvable subject.',
    timings ? 'The static scan imports suite intervals by path. Matching paths across revisions do not establish identical contents. Overlapping spans cannot be added to derive wall time, CI minutes, price or savings.' : 'Wait time and CI minutes need a timed run and are not in this report.',
    'Flags: tautological, snapshot-only, mock-only, no-direct-assertions (possibly assertions in a helper), unparsed.',
    'Recognized declarations are static calls, not native expanded case counts. A count marked +? has opaque helper registration candidates; inspect their provider before treating it as complete.',
    '',
    '## Findings by category',
    '',
    '| Category | Count |',
    '|---|---|',
    ...Category.options.map(category => `| ${category} | ${all.filter(finding => finding.category === category).length} |`),
    '',
    `## Project findings (${report.projectFindings.length})`,
    '',
  );
  if (report.projectFindings.length === 0) out.push('None.');
  else for (const finding of [...report.projectFindings].sort(byProjectOrder)) out.push(projectLine(finding));

  const ranked = rankFiles(report.files);
  if (timings) ranked.sort((a, b) => {
    const left = timings.files.get(a.file), right = timings.files.get(b.file);
    if (left && right) return right.elapsed - left.elapsed || compare(a.file, b.file);
    return Number(Boolean(right)) - Number(Boolean(left));
  });
  const shown = ranked.slice(0, maxFiles);
  out.push('', `## Test files (top ${shown.length} of ${ranked.length}, ${timings ? 'measured files first' : 'most evidence first'})`, '');
  if (ranked.length === 0) out.push('None.');
  else {
    out.push(`| File |${timings ? ' Elapsed ms | Suite outcome |' : ''} Tier | Lane | Tests | Asserts | Flags | Agent tokens | Churn/edits | Rules |`, `|${'---|'.repeat(timings ? 11 : 9)}`);
    for (const [index, file] of shown.entries()) {
      const interval = timings?.files.get(file.file);
      const measurement = timings ? ` ${interval?.elapsed ?? 'unknown'} | ${interval?.outcome ?? 'unknown'} |` : '';
      const tier = file.tier ?? (report.riskMapPresent ? 'untiered' : 'no map');
      const structure = isUnparsed(file) ? ['?', '?'] : [`${file.tests}${hasOpaqueRegistration(file) ? '+?' : ''}`, String(file.assertions)];
      const churn = file.cost.churn !== null && file.cost.edits !== null ? `${file.cost.churn}/${file.cost.edits}` : 'n/a';
      out.push(
        `| ${cell(file.file)} |${measurement} ${tier} | ${file.tags.lane ?? '-'} | ${structure[0]} | ${structure[1]} | ${cell(file.flags.join(', ')) || '-'} | ${file.cost.agent} | ${churn} | ${rulesCell(file, index < MAX_OVERLAP_ROWS)} |`,
      );
    }
  }
  const omitted = ranked.slice(shown.length);
  if (omitted.length > 0) {
    const findings = omitted.reduce((sum, file) => sum + file.findings.length, 0);
    const none = omitted.filter(file => file.findings.length === 0).length;
    out.push('', `${omitted.length} more files omitted (${findings} findings, ${none} with none); ${timings ? 'see the original runner JSON for timings and scan JSON for full static findings.' : 'the full data is in the JSON from the scan command.'}`);
  }

  // Every flagged file, not only those in the table: table order first, then the files the table cut, by path.
  const named = [...shown, ...omitted.slice().sort((a, b) => compare(a.file, b.file))].filter(file => (file.noAssertionTests?.length ?? 0) > 0);
  if (named.length > 0) {
    out.push('', '## No direct assertions', '', 'These tests make no assertion of their own, and a helper they call may. Read each before treating it as empty.');
    for (const file of named.slice(0, MAX_LISTED_FILES)) {
      const tests = file.noAssertionTests!;
      for (const test of tests.slice(0, MAX_NAMED_PER_FILE)) out.push(`- ${flat(file.file)}: "${flat(test.name)}" (line ${test.line})`);
      if (tests.length > MAX_NAMED_PER_FILE) out.push(`- ${flat(file.file)}: and ${tests.length - MAX_NAMED_PER_FILE} more`);
    }
    if (named.length > MAX_LISTED_FILES) out.push(`- +${named.length - MAX_LISTED_FILES} more files (see the JSON noAssertionTests)`);
  }

  if (skipFiles.length > 0) {
    out.push('', '## Skips', '', 'A declared skip never runs; a conditional skip runs only when its condition allows it. Counts are tests, and a reason is the first string in a skip call.');
    for (const file of skipFiles.slice(0, MAX_LISTED_FILES)) {
      const { declared, conditional, reasons } = file.skips!;
      const why = reasons.length > 0 ? `; reasons: ${reasons.slice(0, MAX_SKIP_REASONS_PER_FILE).map(reason => `"${flat(reason)}"`).join(', ')}` : '';
      out.push(`- ${flat(file.file)}: ${declared} declared, ${conditional} conditional${why}`);
    }
    if (skipFiles.length > MAX_LISTED_FILES) out.push(`- +${skipFiles.length - MAX_LISTED_FILES} more files (see the scan JSON)`);
  }

  if (report.clusters.length > 0) {
    out.push('', '## Files sharing a subject', '');
    for (const cluster of report.clusters) out.push(`- ${span(cluster.subject)} (${cluster.layers.map(flat).join(', ')}): ${cluster.files.map(span).join(', ')}`);
  }

  out.push('', '## Per-file findings', '');
  if (perFile.length === 0) out.push('None.');
  for (const category of Category.options) {
    const rules = [...new Set(perFile.filter(finding => finding.category === category).map(finding => finding.rule))].sort(compare);
    for (const rule of rules) {
      const group = perFile.filter(finding => finding.category === category && finding.rule === rule).sort(byLocation);
      const messages = new Set(group.map(messageOf));
      out.push(`### ${flat(rule)}`, '');
      if (messages.size === 1) out.push(messageOf(group[0]!), '');
      for (const finding of group.slice(0, maxPerRule)) out.push(fileLine(finding, messages.size > 1));
      if (group.length > maxPerRule) out.push(`- +${group.length - maxPerRule} more (see the scan JSON)`);
      out.push('');
    }
  }
  return out.join('\n').trimEnd() + '\n';
}
