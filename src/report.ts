import { Category, type EvidenceReport, type Finding } from './schema.ts';

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const where = (finding: Finding): string => `${finding.file}${finding.line ? `:${finding.line}` : ''}`;

/** Markdown view of an evidence report for the audit skill to read and the owner to skim. */
export function renderMarkdown(report: EvidenceReport): string {
  const all = [...report.files.flatMap(file => file.findings), ...report.projectFindings];
  const out: string[] = [
    '# Test audit evidence',
    '',
    `- Runner: ${report.runner}`,
    `- Phase: ${report.phase ?? 'unknown (no risk map)'}`,
    `- Risk map: ${report.riskMapPresent ? 'present' : 'missing'}`,
    `- Test files: ${report.files.length}`,
    '- Cost columns: agent is the estimated tokens in the test file; churn counts commits that edited the test without touching the code it covers; wait and CI need a timed run and are not filled by this report.',
    '',
    '## Findings by category',
    '',
    '| Category | Count |',
    '|---|---|',
    ...Category.options.map(category => `| ${category} | ${all.filter(finding => finding.category === category).length} |`),
    '',
    '## Test files (most findings first)',
    '',
    '| File | Tier | Lane | Tests | Asserts | Flags | Agent tokens | Churn | Findings |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  const ranked = [...report.files].sort((a, b) => b.findings.length - a.findings.length || b.cost.agent - a.cost.agent || (a.file < b.file ? -1 : 1));
  for (const file of ranked) {
    out.push(
      `| ${cell(file.file)} | ${file.tier ?? '-'} | ${file.tags.lane ?? '-'} | ${file.tests} | ${file.assertions} | ${file.flags.join(', ') || '-'} | ${file.cost.agent} | ${file.cost.churn ?? '-'} | ${file.findings.length} |`,
    );
  }
  if (report.clusters.length > 0) {
    out.push('', '## Files sharing a subject', '');
    for (const cluster of report.clusters) out.push(`- \`${cluster.subject}\` (${cluster.layers.join(', ')}): ${cluster.files.map(file => `\`${file}\``).join(', ')}`);
  }
  out.push('', '## Findings', '');
  if (all.length === 0) out.push('None.');
  for (const category of Category.options) {
    const group = all.filter(finding => finding.category === category).sort((a, b) => (where(a) < where(b) ? -1 : where(a) > where(b) ? 1 : 0));
    if (group.length === 0) continue;
    out.push(`### ${category}`, '');
    for (const finding of group) {
      const evidence = finding.evidence ? ` Evidence: \`${finding.evidence.replace(/`/g, "'")}\`.` : '';
      const note = finding.note ? ` Note: ${finding.note}` : '';
      out.push(`- \`${where(finding)}\` **${finding.rule}**: ${finding.message}${evidence}${note}`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}
