import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { churnOf, commitFileSets } from './churn.ts';
import { detectFrequency } from './detectors/frequency.ts';
import { detectRedundancy } from './detectors/redundancy.ts';
import { detectShims } from './detectors/shims.ts';
import { classifiableFiles, detectWiring, unmappedSubjectFinding } from './detectors/wiring.ts';
import { detectWorktreeHazards } from './detectors/worktree.ts';
import { detectRunner, discoverTestInfrastructure, discoverTests } from './discover.ts';
import { declaredSubjects, openParseSession, parseTags, resolveSubjects, type ParsedFile, type ParsedTest } from './parse.ts';
import { candidateDirs } from './riskdraft.ts';
import { loadRiskMap, tierFor } from './riskmap.ts';
import { EVIDENCE_SCHEMA, Tier, type EvidenceReport, type FileFlag, type Finding, type RiskMap, type TestFileRecord } from './schema.ts';

export interface ScanOptions {
  commitLimit?: number;
}

const RANK: Record<Tier, number> = { critical: 3, standard: 2, low: 1 };

/**
 * The tier of a test file. Its subjects decide it (the highest tier among them); the file's own path is used only when it has
 * no subjects. A valid `@risk` tag overrides the tier, but `area` still names the subjects' area. An invalid `@risk` is
 * ignored when the subjects give a tier.
 */
function tierOfFile(
  map: RiskMap | null,
  rel: string,
  subjects: string[],
  risk: string | undefined,
): { tier: Tier | null; area: string | null; unmapped: string[] } {
  if (!map) return { tier: null, area: null, unmapped: [] };
  const override = Tier.safeParse(risk);
  const paths = subjects.length > 0 ? subjects : [rel];
  const hits: { tier: Tier; area: string }[] = [];
  const unmapped: string[] = [];
  for (const path of paths) {
    const hit = tierFor(map, path);
    if (hit) hits.push(hit);
    else unmapped.push(path);
  }
  if (hits.length === 0) return { tier: override.success ? override.data : null, area: null, unmapped: [] };
  const best = hits.reduce((a, b) => (RANK[b.tier] > RANK[a.tier] ? b : a));
  // Only real subjects are reported as unmapped; the file's own path stands in when it has none.
  return { tier: override.success ? override.data : best.tier, area: best.area, unmapped: subjects.length > 0 ? unmapped : [] };
}

/** At most this many tests are named per file, and a test name or a skip reason is cut to this many characters. */
const MAX_NAMED_TESTS = 5;
const MAX_SKIP_REASONS = 3;
const MAX_TEXT = 80;

/** Tests whose body makes no assertion. A todo or a declared skip is a placeholder or never runs, so it is not named. */
const bareTests = (parsed: ParsedFile): ParsedTest[] => parsed.tests.filter(test => !test.todo && !test.skipped && test.assertions === 0);

function flagsOf(parsed: ParsedFile): FileFlag[] {
  const flags: FileFlag[] = [];
  if (parsed.tautologies > 0) flags.push('tautological');
  if (parsed.assertions > 0 && parsed.snapshotAssertions === parsed.assertions) flags.push('snapshot-only');
  if (parsed.assertions > 0 && parsed.mockAssertions === parsed.assertions) flags.push('mock-only');
  if (bareTests(parsed).length > 0) flags.push('no-direct-assertions');
  return flags;
}

/** The record fields a file adds only when it has something to say, so a file without them keeps its JSON unchanged. */
function skipFieldsOf(parsed: ParsedFile): Pick<TestFileRecord, 'noAssertionTests' | 'skips'> {
  const fields: Pick<TestFileRecord, 'noAssertionTests' | 'skips'> = {};
  const bare = bareTests(parsed);
  if (bare.length > 0) fields.noAssertionTests = bare.slice(0, MAX_NAMED_TESTS).map(test => ({ name: test.name.slice(0, MAX_TEXT), line: test.line }));
  // A test counts once: a declared skip never runs, so only a test that can run is conditional.
  const declared = parsed.tests.filter(test => test.skipped).length;
  const conditional = parsed.tests.filter(test => !test.skipped && (test.conditional || test.bodySkip)).length + (parsed.suiteSkips?.length ?? 0);
  if (declared + conditional > 0) {
    const reasons = [...parsed.tests.filter(test => !test.skipped).flatMap(test => test.skipReasons), ...(parsed.suiteSkips ?? []).flatMap(skip => (skip.reason === undefined ? [] : [skip.reason]))]
      .map(reason => reason.slice(0, MAX_TEXT));
    fields.skips = { declared, conditional, reasons: [...new Set(reasons)].slice(0, MAX_SKIP_REASONS) };
  }
  return fields;
}

interface LoadedFile {
  rel: string;
  text: string;
  lines: string[];
  parsed: ParsedFile;
  subjects: string[];
  /** The file could not be read as a parsed test, so its parse facts are empty. */
  unparsed: boolean;
}

const emptyParsed = (): ParsedFile => ({
  imports: [],
  tests: [],
  titles: [],
  assertions: 0,
  snapshotAssertions: 0,
  mockAssertions: 0,
  mockCalls: 0,
  tautologies: 0,
  tags: {},
});

/**
 * Read and parse every test file. One file that cannot be read or parsed (a parser stack overflow on absurd nesting, say)
 * must not stop the scan or hide the others: it keeps empty parse facts and is flagged `unparsed`. Its leading-comment tags
 * and line-based detectors still work when its text was read.
 */
function loadTests(root: string): LoadedFile[] {
  const session = openParseSession();
  try {
    return discoverTests(root).map(rel => {
      let text = '';
      let parsed = emptyParsed();
      let unparsed = false;
      try {
        text = readFileSync(join(root, rel), 'utf8');
        parsed = session.parse(rel, text);
      } catch {
        unparsed = true;
        parsed = { ...emptyParsed(), tags: parseTags(text) };
      }
      const subjects = [...new Set([...resolveSubjects(root, rel, parsed.imports), ...declaredSubjects(root, parsed.tags.subjects ?? [])])].sort();
      return { rel, text, lines: text.split(/\r?\n/), parsed, subjects, unparsed };
    });
  } finally {
    session.close();
  }
}

const byLocation = (a: Finding, b: Finding): number => (a.line ?? 0) - (b.line ?? 0) || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0);

/** Gather evidence about a project's tests. Never executes them and never judges: verdicts belong to the audit skill. */
export function scan(rootInput: string, options: ScanOptions = {}): EvidenceReport {
  const root = resolve(rootInput);
  const map = loadRiskMap(root);
  const sets = commitFileSets(root, options.commitLimit ?? 500);
  const loaded = loadTests(root);

  const records = new Map<string, TestFileRecord>();
  const unmappedFindings: Finding[] = [];
  for (const file of loaded) {
    const { tier, area, unmapped } = tierOfFile(map, file.rel, file.subjects, file.parsed.tags.risk);
    if (unmapped.length > 0 && area) unmappedFindings.push(unmappedSubjectFinding(file.rel, unmapped, area));
    const { churn, edits } = churnOf(file.rel, file.subjects, sets);
    records.set(file.rel, {
      file: file.rel,
      tests: file.parsed.tests.length,
      assertions: file.parsed.assertions,
      flags: file.unparsed ? ['unparsed'] : flagsOf(file.parsed),
      ...(file.unparsed ? {} : skipFieldsOf(file.parsed)),
      subjects: file.subjects,
      tags: file.parsed.tags,
      tier,
      area,
      // `wait` and `ci` stay null in this version because it never runs tests; a later `time` command fills them.
      cost: { wait: null, agent: Math.ceil(Buffer.byteLength(file.text) / 4), ci: null, churn, edits },
      findings: [],
    });
  }

  const projectFindings: Finding[] = [];
  const attach = (findings: Finding[]): void => {
    for (const finding of findings) (records.get(finding.file)?.findings ?? projectFindings).push(finding);
  };

  const shimNote = !map
    ? 'No risk map, so consumers are unknown.'
    : map.consumers.length === 0
      ? 'No consumers declared in the risk map.'
      : `Consumers declared in the risk map: ${map.consumers.join(', ')}. Check whether any still needs this path.`;
  for (const file of loaded) {
    attach((file.parsed.opaqueTestCalls ?? []).map(call => ({
      category: 'wiring' as const,
      rule: 'wiring.opaque-test-registration',
      file: file.rel,
      line: call.line,
      message: 'A curried helper resembles test registration, but its provider is unknown. Recognized declarations may undercount this file; inspect the helper or compare a native inventory.',
      evidence: call.callee,
    })));
    attach(detectShims(file.rel, file.parsed).map(finding => ({ ...finding, note: shimNote })));
    attach(detectWorktreeHazards(file.rel, file.lines));
  }
  for (const rel of discoverTestInfrastructure(root)) {
    try {
      attach(detectWorktreeHazards(rel, readFileSync(join(root, rel), 'utf8').split(/\r?\n/)));
    } catch {
      // Infrastructure may be unreadable; tests still have their own parse diagnostics.
    }
  }
  const redundancy = detectRedundancy(loaded);
  attach(redundancy.findings);
  attach(
    detectWiring(
      map,
      [...records.values()].map(record => ({ rel: record.file, tier: record.tier, tags: record.tags, subjects: record.subjects })),
      candidateDirs(root),
      dir => classifiableFiles(root, dir),
    ),
  );
  attach(unmappedFindings);
  attach(detectFrequency(root, map));

  for (const record of records.values()) record.findings.sort(byLocation);
  projectFindings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : byLocation(a, b)));

  return {
    schema: EVIDENCE_SCHEMA,
    root,
    runner: detectRunner(root, loaded.flatMap(file => file.parsed.imports)),
    phase: map?.phase ?? null,
    riskMapPresent: map !== null,
    files: [...records.values()],
    clusters: redundancy.clusters,
    projectFindings,
  };
}
