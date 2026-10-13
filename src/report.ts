import { Category, type EvidenceReport, type Finding, type TestFileRecord } from './schema.ts';

export interface ReportOptions {
  /** How many test files the table lists. */
  maxFiles?: number;
  /** How many findings one rule lists in the per-file section. */
  maxPerRule?: number;
}

const DEFAULT_MAX_FILES = 40;
const DEFAULT_MAX_PER_RULE = 30;
const MAX_EVIDENCE = 160;
const MAX_UNPARSED_LISTED = 10;
const MAX_RULES_PER_ROW = 4;

/** Wiring rules in the order the audit should read them; other wiring rules follow. */
const WIRING_ORDER = ['wiring.uncovered-critical', 'wiring.drift', 'wiring.no-risk-map'];

/** Any run of whitespace, newlines and carriage returns included, becomes one space, so a value stays on one line. */
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** A table cell: flattened, with pipes escaped. */
const cell = (text: string): string => flat(text).replace(/\|/g, '\\|');

/** An inline code span whose fence is longer than any backtick run inside, so the text cannot break out of it. */
function span(text: string): string {
  const body = flat(text);
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map(run => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = body.startsWith('`') || body.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${body}${pad}${fence}`;
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

const isUnparsed = (file: TestFileRecord): boolean => file.flags.includes('unparsed');
const hasOpaqueRegistration = (file: TestFileRecord): boolean => file.findings.some(finding => finding.rule === 'wiring.opaque-test-registration');

function rulesCell(file: TestFileRecord): string {
  const counts = ruleCounts(file);
  if (counts.length === 0) return '-';
  const shown = counts.slice(0, MAX_RULES_PER_ROW).map(([rule, count]) => (count > 1 ? `${rule} x${count}` : rule));
  if (counts.length > MAX_RULES_PER_ROW) shown.push(`+${counts.length - MAX_RULES_PER_ROW} more`);
  return cell(shown.join(', '));
}

/** Unparsed files first (their structure is unknown), then the breadth of evidence, its volume, the file's size, and the path. */
function rankFiles(files: TestFileRecord[]): TestFileRecord[] {
  return files
    .map(file => ({ file, distinct: ruleCounts(file).length }))
    .sort(
      (a, b) =>
        Number(isUnparsed(b.file)) - Number(isUnparsed(a.file)) ||
        Number(hasOpaqueRegistration(b.file)) - Number(hasOpaqueRegistration(a.file)) ||
        b.distinct - a.distinct ||
        b.file.findings.length - a.file.findings.length ||
        b.file.cost.agent - a.file.cost.agent ||
        compare(a.file.file, b.file.file),
    )
    .map(entry => entry.file);
}

function projectLine(finding: Finding): string {
  const evidence = finding.evidence ? ` Evidence: ${span(clip(finding.evidence))}.` : '';
  const note = finding.note ? ` Note: ${flat(finding.note)}` : '';
  return `- ${span(where(finding))} **${flat(finding.rule)}**: ${flat(finding.message)}${evidence}${note}`;
}

function fileLine(finding: Finding): string {
  const evidence = finding.evidence ? ` ${span(clip(finding.evidence))}` : '';
  const note = finding.note ? ` (${flat(finding.note)})` : '';
  return `- ${span(where(finding))}${evidence}${note}`;
}

/**
 * Markdown view of an evidence report for the audit skill to read and the owner to skim. It ranks, caps and de-duplicates
 * so the evidence that matters comes first; the scan JSON holds everything. Pure and deterministic.
 */
export function renderMarkdown(report: EvidenceReport, options: ReportOptions = {}): string {
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
  if (unparsed.length > 0) {
    const listed = unparsed.slice(0, MAX_UNPARSED_LISTED).map(span);
    if (unparsed.length > MAX_UNPARSED_LISTED) listed.push(`+${unparsed.length - MAX_UNPARSED_LISTED} more`);
    out.push(`- Unparsed files: ${unparsed.length}. The tool could not read their structure, so read them directly: ${listed.join(', ')}`);
  }
  out.push(
    '',
    '**How to read this.** Findings are evidence, not verdicts: judge each one against the risk map and the test itself.',
    'Files are ranked with unparsed files first, then opaque registration candidates, then by distinct finding rules, total findings and agent tokens.',
    'Agent is the estimated tokens in the file. Churn/edits counts edits that touched the test without the code it covers, over all edits that modified it; n/a means no git history or no resolvable subject.',
    'Wait time and CI minutes need a timed run and are not in this report.',
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
  const shown = ranked.slice(0, maxFiles);
  out.push('', `## Test files (top ${shown.length} of ${ranked.length}, most evidence first)`, '');
  if (ranked.length === 0) out.push('None.');
  else {
    out.push('| File | Tier | Lane | Tests | Asserts | Flags | Agent tokens | Churn/edits | Rules |', '|---|---|---|---|---|---|---|---|---|');
    for (const file of shown) {
      const tier = file.tier ?? (report.riskMapPresent ? 'untiered' : 'no map');
      const structure = isUnparsed(file) ? ['?', '?'] : [`${file.tests}${hasOpaqueRegistration(file) ? '+?' : ''}`, String(file.assertions)];
      const churn = file.cost.churn !== null && file.cost.edits !== null ? `${file.cost.churn}/${file.cost.edits}` : 'n/a';
      out.push(
        `| ${cell(file.file)} | ${tier} | ${file.tags.lane ?? '-'} | ${structure[0]} | ${structure[1]} | ${cell(file.flags.join(', ')) || '-'} | ${file.cost.agent} | ${churn} | ${rulesCell(file)} |`,
      );
    }
  }
  const omitted = ranked.slice(shown.length);
  if (omitted.length > 0) {
    const findings = omitted.reduce((sum, file) => sum + file.findings.length, 0);
    const none = omitted.filter(file => file.findings.length === 0).length;
    out.push('', `${omitted.length} more files omitted (${findings} findings, ${none} with none); the full data is in the JSON from the scan command.`);
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
      out.push(`### ${flat(rule)}`, '', flat(group[0]!.message), '');
      for (const finding of group.slice(0, maxPerRule)) out.push(fileLine(finding));
      if (group.length > maxPerRule) out.push(`- +${group.length - maxPerRule} more (see the scan JSON)`);
      out.push('');
    }
  }
  return out.join('\n').trimEnd() + '\n';
}
