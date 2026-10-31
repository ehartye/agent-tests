import type { ParsedFile } from '../parse.ts';
import type { Cluster, Finding } from '../schema.ts';

export interface RedundancyInput {
  rel: string;
  subjects: string[];
  parsed: ParsedFile;
  lines: string[];
}

const SWEEP = /\bfor\s*\(\s*(?:let|const|var)\s+(\w+)\s*=\s*(\d+)\s*;\s*\w+\s*(<=|<)\s*(\d+)\s*;/;
/** A sweep repeats a test over many generated inputs. A loop counter named `i` is just a loop. */
const SWEEP_VARIABLE = /^(?:seed|trial|run|case|sample|iter|round)\w*$/i;
const MIN_SWEEP = 10;
const MIN_TITLE = 12;

const MAX_FOCUSED_SUBJECTS = 3;
/** A subject imported by more than this many test files is shared infrastructure, not duplicated coverage. */
const MAX_CLUSTER = 10;

/** A cluster ranks as real overlap only when its files share at least this many non-trivial title words. */
const MIN_SHARED_WORDS = 2;
const STOPWORDS = new Set(
  'the and for with when that this from into onto than then are was were has have had its not but any all each only also can will would should shall does did via per out off over under without within returns return given test tests works work case cases'.split(' '),
);

/** Lowercased words of a test title, minus short words, numbers and stopwords. */
const titleTokens = (title: string): string[] =>
  (title.toLowerCase().match(/[a-z][a-z0-9]*/g) ?? []).filter(word => word.length >= 3 && !STOPWORDS.has(word));

const stem = (rel: string): string =>
  (rel.split('/').pop() ?? rel)
    .replace(/\.(?:test|spec)\.[cm]?[jt]sx?$/, '')
    .replace(/\.[cm]?[jt]sx?$/, '')
    .replace(/\.(?:unit|integration|e2e|contract)$/, '');

/** A test that imports many modules touches most of them incidentally. It counts for a subject only when it is focused or named after it. */
const isFocused = (file: RedundancyInput, subject: string): boolean => file.subjects.length <= MAX_FOCUSED_SUBJECTS || stem(subject).toLowerCase() === stem(file.rel).toLowerCase();

/** Two test files share a subject only when both are focused on it. A hub is shared infrastructure, so it never counts. */
const sharesFocusedSubject = (a: RedundancyInput, b: RedundancyInput, hubs: ReadonlySet<string>): boolean =>
  a.subjects.some(subject => !hubs.has(subject) && b.subjects.includes(subject) && isFocused(a, subject) && isFocused(b, subject));

export function layerOf(rel: string): string {
  if (/(?:^|[/._-])(?:e2e|end-to-end)(?:[/._-]|$)/i.test(rel)) return 'e2e';
  // A hyphen after the word does not end it: `integration-helpers/` is support code, but `integration-tests/` is the layer.
  if (/(?:^|[/._-])integrations?(?:-tests?)?(?:[/._]|$)/i.test(rel)) return 'integration';
  if (/(?:^|[/._-])contracts?(?:[/._-]|$)/i.test(rel)) return 'contract';
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
  const hubSubjects = new Set([...bySubject].filter(([, members]) => members.length > MAX_CLUSTER).map(([subject]) => subject));
  const clusters: Cluster[] = [];
  const sharedBy = new Map<string, string[]>();
  const hubs: Array<{ subject: string; files: string[] }> = [];
  for (const [subject, members] of [...bySubject].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (members.length < 2) continue;
    const sorted = [...members].sort();
    clusters.push({ subject, files: sorted, layers: [...new Set(sorted.map(layerOf))].sort() });
    if (sorted.length > MAX_CLUSTER) {
      hubs.push({ subject, files: sorted });
      continue;
    }
    for (const member of sorted) {
      sharedBy.set(member, [...(sharedBy.get(member) ?? []), `${subject}: ${sorted.filter(other => other !== member).join(', ')}`]);
    }
  }
  const byRel = new Map(files.map(file => [file.rel, file]));
  const titleWords = new Map<string, Set<string>>();
  const wordsOf = (rel: string): Set<string> => {
    const cached = titleWords.get(rel);
    if (cached) return cached;
    const words = new Set<string>();
    for (const test of byRel.get(rel)?.parsed.tests ?? []) for (const word of titleTokens(test.name)) words.add(word);
    titleWords.set(rel, words);
    return words;
  };
  const sharedFindings: Array<{ finding: Finding; overlap: number }> = [];
  for (const [file, shared] of [...sharedBy].sort(([a], [b]) => (a < b ? -1 : 1))) {
    // Title words this file has in common with another file of one of its clusters. Subject overlap alone says little; title overlap says the tests talk about the same behavior.
    const own = wordsOf(file);
    let best: { other: string; words: string[] } | undefined;
    for (const cluster of clusters) {
      if (cluster.files.length > MAX_CLUSTER || !cluster.files.includes(file)) continue;
      for (const other of cluster.files) {
        if (other === file) continue;
        const theirs = wordsOf(other);
        const pair = [...own].filter(word => theirs.has(word));
        // Judged per pair of files: a union across a whole cluster would make any big cluster look redundant.
        if (pair.length < MIN_SHARED_WORDS) continue;
        if (!best || pair.length > best.words.length || (pair.length === best.words.length && other < best.other)) best = { other, words: pair.sort() };
      }
    }
    const words = best?.words ?? [];
    const overlap = words.length;
    const subjects = shared.join('; ');
    sharedFindings.push({
      overlap,
      finding: {
        category: 'redundancy',
        rule: 'redundancy.shared-subject',
        file,
        message: `This file shares ${shared.length} subject${shared.length === 1 ? '' : 's'} with other test files. Check whether they assert the same behavior.`,
        evidence: (overlap > 0 ? `shared title words with ${best?.other} (${words.length}): ${words.slice(0, 8).join(', ')}${words.length > 8 ? ', ...' : ''}; ${subjects}` : subjects).slice(0, 300),
        ...(overlap > 0 ? { overlap } : {}),
      },
    });
  }
  // Real title overlap first, most words first; files that share only a subject follow. The sort is stable, so ties stay in path order.
  sharedFindings.sort((a, b) => b.overlap - a.overlap);
  for (const entry of sharedFindings) findings.push(entry.finding);
  for (const hub of hubs) {
    findings.push({
      category: 'redundancy',
      rule: 'redundancy.hub-subject',
      file: hub.subject,
      message: `${hub.files.length} test files import this module. It looks like shared infrastructure rather than duplicated coverage. Check each file's own assertions if you suspect duplication.`,
      evidence: hub.files.slice(0, 5).join('; '),
    });
  }

  const sweeps = new Map<string, Array<{ input: RedundancyInput; line: number; text: string }>>();
  for (const file of files) {
    file.lines.forEach((text, index) => {
      const trimmed = text.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;
      const match = SWEEP.exec(text);
      if (!match || !SWEEP_VARIABLE.test(match[1] ?? '')) return;
      const start = Number(match[2]);
      const end = Number(match[4]);
      if (end - start + (match[3] === '<=' ? 1 : 0) < MIN_SWEEP) return;
      const key = `${start}${match[3]}${end}`;
      sweeps.set(key, [...(sweeps.get(key) ?? []), { input: file, line: index + 1, text: trimmed }]);
    });
  }
  for (const [key, spots] of sweeps) {
    // A location counts only with a partner in the same file or in a test file that shares a focused subject.
    const related = spots.filter(spot => spots.some(other => other !== spot && (other.input === spot.input || sharesFocusedSubject(spot.input, other.input, hubSubjects))));
    if (related.length < 2) continue;
    for (const spot of related) {
      findings.push({
        category: 'redundancy',
        rule: 'redundancy.repeated-sweep',
        file: spot.input.rel,
        line: spot.line,
        message: `The same sweep (${key}) appears ${related.length} times in the suite. Share the work or keep one owner.`,
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
      const sharesSubject = spots.some(other => other.file !== spot.file && sharesFocusedSubject(spot.file, other.file, hubSubjects));
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
