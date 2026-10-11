import type { ParsedFile } from '../parse.ts';
import type { Cluster, Finding } from '../schema.ts';

export interface RedundancyInput {
  rel: string;
  subjects: string[];
  parsed: ParsedFile;
  lines: string[];
}

const SWEEP = /\bfor\s*\(\s*(?:let|const|var)\s+\w+\s*=\s*(\d+)\s*;\s*\w+\s*(<=|<)\s*(\d+)\s*;/;
const MIN_SWEEP = 10;
const MIN_TITLE = 12;

const MAX_FOCUSED_SUBJECTS = 3;

const stem = (rel: string): string =>
  (rel.split('/').pop() ?? rel)
    .replace(/\.(?:test|spec)\.[cm]?[jt]sx?$/, '')
    .replace(/\.[cm]?[jt]sx?$/, '')
    .replace(/\.(?:unit|integration|e2e|contract)$/, '');

/** A test that imports many modules touches most of them incidentally. It counts for a subject only when it is focused or named after it. */
const isFocused = (file: RedundancyInput, subject: string): boolean => file.subjects.length <= MAX_FOCUSED_SUBJECTS || stem(subject) === stem(file.rel);

export function layerOf(rel: string): string {
  if (/(?:^|[/._-])(?:e2e|end-to-end)(?:[/._-]|$)/i.test(rel)) return 'e2e';
  if (/integration/i.test(rel)) return 'integration';
  if (/(?:^|[/._-])contract(?:[/._-]|$)/i.test(rel)) return 'contract';
  return 'unit';
}

/** Clusters of test files exercising one subject, repeated seed sweeps, and duplicate titles over a shared subject. */
export function detectRedundancy(files: RedundancyInput[]): { clusters: Cluster[]; findings: Finding[] } {
  const findings: Finding[] = [];

  const bySubject = new Map<string, string[]>();
  for (const file of files) {
    for (const subject of file.subjects) {
      if (isFocused(file, subject)) bySubject.set(subject, [...(bySubject.get(subject) ?? []), file.rel]);
    }
  }
  const clusters: Cluster[] = [];
  const sharedBy = new Map<string, string[]>();
  for (const [subject, members] of [...bySubject].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (members.length < 2) continue;
    const sorted = [...members].sort();
    clusters.push({ subject, files: sorted, layers: [...new Set(sorted.map(layerOf))].sort() });
    for (const member of sorted) {
      sharedBy.set(member, [...(sharedBy.get(member) ?? []), `${subject}: ${sorted.filter(other => other !== member).join(', ')}`]);
    }
  }
  for (const [file, shared] of [...sharedBy].sort(([a], [b]) => (a < b ? -1 : 1))) {
    findings.push({
      category: 'redundancy',
      rule: 'redundancy.shared-subject',
      file,
      message: `This file shares ${shared.length} subject${shared.length === 1 ? '' : 's'} with other test files. Check whether they assert the same behavior.`,
      evidence: shared.join('; ').slice(0, 300),
    });
  }

  const sweeps = new Map<string, Array<{ file: string; line: number; text: string }>>();
  for (const file of files) {
    file.lines.forEach((text, index) => {
      const match = SWEEP.exec(text);
      if (!match) return;
      const start = Number(match[1]);
      const end = Number(match[3]);
      if (end - start + (match[2] === '<=' ? 1 : 0) < MIN_SWEEP) return;
      const key = `${start}${match[2]}${end}`;
      sweeps.set(key, [...(sweeps.get(key) ?? []), { file: file.rel, line: index + 1, text: text.trim() }]);
    });
  }
  for (const [key, spots] of sweeps) {
    if (spots.length < 2) continue;
    for (const spot of spots) {
      findings.push({
        category: 'redundancy',
        rule: 'redundancy.repeated-sweep',
        file: spot.file,
        line: spot.line,
        message: `The same sweep (${key}) appears ${spots.length} times in the suite. Share the work or keep one owner.`,
        evidence: spot.text.slice(0, 160),
      });
    }
  }

  const byTitle = new Map<string, Array<{ file: RedundancyInput; line: number; text: string }>>();
  for (const file of files) {
    for (const title of file.parsed.tests.map(test => ({ text: test.name, line: test.line }))) {
      if (title.text.length < MIN_TITLE) continue;
      const key = title.text.toLowerCase();
      byTitle.set(key, [...(byTitle.get(key) ?? []), { file, line: title.line, text: title.text }]);
    }
  }
  for (const spots of byTitle.values()) {
    for (const spot of spots) {
      const sharesSubject = spots.some(other => other.file !== spot.file && other.file.subjects.some(subject => spot.file.subjects.includes(subject)));
      if (!sharesSubject) continue;
      findings.push({
        category: 'redundancy',
        rule: 'redundancy.duplicate-title',
        file: spot.file.rel,
        line: spot.line,
        message: 'Another test file with the same subject has a test with this title.',
        evidence: spot.text,
      });
    }
  }
  return { clusters, findings };
}
