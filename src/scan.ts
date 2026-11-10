import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { churnOf, commitFileSets } from './churn.ts';
import { detectFrequency } from './detectors/frequency.ts';
import { detectRedundancy } from './detectors/redundancy.ts';
import { detectShims } from './detectors/shims.ts';
import { classifiableFiles, detectWiring, unmappedSubjectFinding } from './detectors/wiring.ts';
import { detectWorktreeHazards } from './detectors/worktree.ts';
import { detectPythonRunner, detectRunner, discoverTestInfrastructure, discoverTests, inspectCensus, isPythonSupportFile, isPythonTestPath, pythonFilesConfigured, type Census } from './discover.ts';
import { declaredSubjects, openParseSession, parseTags, resolveSubjects, type ParsedFile } from './parse.ts';
import { candidateDirs } from './riskdraft.ts';
import type { PythonFacts, PythonOpaque } from './python/facts.ts';
import { createPythonSubjectResolver, facadeScope, mergeScopes, opaqueScope, PYTHON_NOTES } from './python/subjects.ts';
import { workflowPythonFiles } from './python/workflow.ts';
import { loadRiskMap, tierFor } from './riskmap.ts';
import { CliError } from './errors.ts';
import { EVIDENCE_SCHEMA, LaneName, Tier, type EvidenceReport, type FileFlag, type Finding, type Inventory, type NoteScope, type RiskMap, type TestFileRecord } from './schema.ts';

/**
 * A Python test file larger than this many bytes is neither read nor parsed: parsing time grows with size (a 10 MB generated literal
 * took seconds), and such a file is data or generated code, not a test a reviewer would audit. It is listed with the `unparsed` flag,
 * like a file with a syntax error, with no tests, assertions, subjects or tags.
 */
export const MAX_PYTHON_FILE_BYTES = 2_000_000;

const RUNTIME_BROKEN_HINT = 'Run the tests-setup skill to repair the managed runtime';

/** Reads the facts of one Python source text by syntax only. */
export type PythonReader = (source: string) => PythonFacts;

export interface ScanOptions {
  commitLimit?: number;
  /**
   * How Python test files are read. `scan` is synchronous and cannot load the parser, so it needs this whenever the repo has Python
   * test files; `scanProject` loads the parser itself (only then) and is what the CLI uses.
   */
  python?: PythonReader;
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

/** At most this many skip reasons are kept per file, and a test name or a skip reason is cut to this many characters. */
const MAX_SKIP_REASONS = 3;
const MAX_TEXT = 80;

/** Tests whose body makes no assertion. A todo or a declared skip is a placeholder or never runs, so it is not named. */
const bareTests = <T extends { todo?: boolean; skipped?: boolean; assertions: number }>(tests: readonly T[]): T[] => tests.filter(test => !test.todo && !test.skipped && test.assertions === 0);

function flagsOf(parsed: ParsedFile): FileFlag[] {
  const flags: FileFlag[] = [];
  if (parsed.tautologies > 0) flags.push('tautological');
  if (parsed.assertions > 0 && parsed.snapshotAssertions === parsed.assertions) flags.push('snapshot-only');
  if (parsed.assertions > 0 && parsed.mockAssertions === parsed.assertions) flags.push('mock-only');
  if (bareTests(parsed.tests).length > 0) flags.push('no-direct-assertions');
  return flags;
}

/** The tests that make no assertion, named in file order, or no field at all so a file without any keeps its JSON unchanged. */
const noAssertionTestsOf = (tests: ReadonlyArray<{ name: string; line: number; todo?: boolean; skipped?: boolean; assertions: number }>): Pick<TestFileRecord, 'noAssertionTests'> => {
  const bare = bareTests(tests);
  return bare.length > 0 ? { noAssertionTests: bare.map(test => ({ name: test.name.slice(0, MAX_TEXT), line: test.line })) } : {};
};

/** The record fields a JavaScript file adds only when it has something to say, so a file without them keeps its JSON unchanged. */
function skipFieldsOf(parsed: ParsedFile): Pick<TestFileRecord, 'noAssertionTests' | 'skips'> {
  const fields: Pick<TestFileRecord, 'noAssertionTests' | 'skips'> = { ...noAssertionTestsOf(parsed.tests) };
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

interface LoadedPythonFile {
  rel: string;
  /** The file's size in bytes, for the agent-token estimate. */
  bytes: number;
  /** The facts of a file that parsed cleanly; null when it could not be read or parsed, so it is flagged `unparsed`. */
  facts: PythonFacts | null;
  subjects: string[];
  /** The package `__init__.py` files among the subjects that the file imports through. */
  facades: string[];
  tags: TestFileRecord['tags'];
}

const LANE_NAMES: readonly string[] = LaneName.options;

/**
 * The lane of a Python file: its leading-comment `# @lane` tag, else a lane-named marker in a module-level `pytestmark`, else the
 * one lane every test of the file carries (a test's markers include its class's); otherwise none. Only a marker named exactly like
 * a lane counts. Two different lane markers at one level are ambiguous and give none, as do tests that disagree or carry no lane.
 */
function pythonLaneOf(facts: PythonFacts): LaneName | undefined {
  if (facts.tags.lane) return facts.tags.lane;
  const lanesOf = (markers: readonly string[]): string[] => [...new Set(markers.filter(marker => LANE_NAMES.includes(marker)))];
  const module = lanesOf(facts.moduleMarkers);
  if (module.length > 0) return module.length === 1 ? (module[0] as LaneName) : undefined;
  const perTest = facts.tests.map(test => lanesOf(test.markers));
  const first = perTest[0]?.[0];
  return first !== undefined && perTest.every(lanes => lanes.length === 1 && lanes[0] === first) ? (first as LaneName) : undefined;
}

/**
 * Read every Python test file with the facts reader. Like JavaScript, one file that cannot be read or has a syntax error must not stop
 * the scan: it keeps no facts and is flagged `unparsed` (its leading-comment tags are still read when the parser recovered them).
 *
 * `candidates` are files a workflow command names whose names are not test names. They are read the same way but join the result only
 * when their facts show tests: one that is unreadable, has a syntax error or defines no test is not a test file and is dropped.
 */
function loadPythonTests(root: string, rels: readonly string[], candidates: readonly string[], read: PythonReader): LoadedPythonFile[] {
  const resolveSubjectsOf = createPythonSubjectResolver(root);
  const load = (rel: string): LoadedPythonFile => {
    let bytes = 0;
    let facts: PythonFacts | null = null;
    let tags: PythonFacts['tags'] = {};
    try {
      bytes = statSync(join(root, rel)).size;
      if (bytes <= MAX_PYTHON_FILE_BYTES) {
        const text = readFileSync(join(root, rel), 'utf8');
        bytes = Buffer.byteLength(text);
        const read_ = read(text.replace(/^\uFEFF/, ''));
        tags = read_.tags;
        if (!read_.hasError) facts = read_;
      }
    } catch {
      // Unreadable or unparsable: the file stays listed, flagged unparsed.
    }
    const lane = facts ? pythonLaneOf(facts) : tags.lane;
    const declared = declaredSubjects(root, tags.subjects ?? []).filter(path => !isPythonTestPath(path) && !isPythonSupportFile(path));
    const resolved = facts ? resolveSubjectsOf(rel, facts) : { subjects: [], facades: [] };
    return {
      rel,
      bytes,
      facts,
      subjects: [...new Set([...resolved.subjects, ...declared])].sort(),
      facades: resolved.facades,
      tags: { ...(lane ? { lane } : {}), ...(tags.risk ? { risk: tags.risk } : {}), ...(tags.subjects ? { subjects: tags.subjects } : {}) },
    };
  };
  return [...rels.map(load), ...candidates.map(load).filter(file => file.facts !== null && file.facts.tests.length > 0)];
}

/**
 * The Python incompleteness notes of a scan, in a fixed order (config, facade, opaque), each with its merged scope: the config note
 * when a pytest config mentions `python_files` (scope all; only when Python tests were inventoried); the facade note for every
 * package `__init__.py` a test imports through (the package directories); and the opaque-registration note for every file whose
 * tests the reader cannot fully see (see `opaqueScope`). Empty when nothing makes the Python inventory incomplete.
 */
function pythonNotesOf(root: string, python: readonly LoadedPythonFile[]): NoteScope[] {
  if (python.length === 0) return [];
  const notes: NoteScope[] = [];
  if (pythonFilesConfigured(root)) notes.push({ text: PYTHON_NOTES.config, scope: 'all' });
  const facades = python.flatMap(file => file.facades.map(facadeScope));
  if (facades.length > 0) notes.push({ text: PYTHON_NOTES.facade, scope: mergeScopes(facades) });
  const opaque = python.filter(file => (file.facts?.opaque.length ?? 0) > 0).map(file => opaqueScope(root, file.rel, file.subjects));
  if (opaque.length > 0) notes.push({ text: PYTHON_NOTES.opaque, scope: mergeScopes(opaque) });
  return notes;
}

/** What a Python opaque-registration candidate may hide, as a finding message; the `+?` marker and the opaque rule are the JavaScript ones. */
const OPAQUE_PYTHON_MESSAGE: Record<PythonOpaque['reason'], string> = {
  'load_tests': 'This module defines load_tests, which unittest calls to change the tests it collects (pytest ignores it). Recognized declarations may undercount this file; inspect load_tests or compare a native inventory.',
  'imported-test-class': 'A test class is imported into this module, and the runner collects it here, but its tests are declared elsewhere. Recognized declarations may undercount this file; inspect the class or compare a native inventory.',
  'non-literal-import': 'A dynamic import names its module by an expression, so the module it loads and any tests or subjects behind it are unknown. Recognized declarations may undercount this file; inspect the import or compare a native inventory.',
};

/**
 * The language census, or undefined for a repo with no non-JavaScript test-named files and no Python test file, so a JavaScript-only
 * report keeps its exact JSON. Python is inventoried (supported, with its runner and the number of Python test files read, which
 * includes workflow-named files that proved to be tests); every other language is counted by file name only and is never read,
 * hence detected-unsupported and the inventory incomplete. A Python incompleteness note also makes the inventory incomplete.
 */
function inventoryOf(census: Census, runner: EvidenceReport['runner'], jsFiles: number, python: { runner: string; files: number }, pythonNotes: readonly NoteScope[]): Inventory | undefined {
  const unsupported = census.groups.filter(group => group.language !== 'Python');
  if (unsupported.length === 0 && python.files === 0) return undefined;
  const others: Inventory['languages'] = [
    ...unsupported.map(({ language, files }) => ({ language, runner: 'unknown', files: files.length, status: 'detected-unsupported' as const })),
    ...(python.files > 0 ? [{ language: 'Python', runner: python.runner, files: python.files, status: 'supported' as const }] : []),
  ].sort((a, b) => (a.language < b.language ? -1 : a.language > b.language ? 1 : 0));
  const languages: Inventory['languages'] = [{ language: 'JavaScript', runner, files: jsFiles, status: 'supported' }, ...others];
  const incomplete = unsupported.length > 0;
  return {
    complete: !incomplete && pythonNotes.length === 0,
    languages,
    notes: [...(incomplete ? ['Those files are named like tests and were counted by file name only, never read, so their test counts and the coverage they give are unknown.'] : []), ...pythonNotes.map(note => note.text)],
    ...(pythonNotes.length > 0 ? { noteScopes: pythonNotes.map(note => ({ text: note.text, scope: note.scope })) } : {}),
  };
}

const byLocation = (a: Finding, b: Finding): number => (a.line ?? 0) - (b.line ?? 0) || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0);

/**
 * Gather evidence about a project's tests, synchronously. Never executes them and never judges: verdicts belong to the audit skill.
 * A repo with Python test files needs `options.python` (see `scanProject`, which supplies it); without one this throws instead of
 * reporting those files as unread.
 */
export function scan(rootInput: string, options: ScanOptions = {}): EvidenceReport {
  const root = resolve(rootInput);
  const census = inspectCensus(root);
  return scanWithCensus(root, options, census, workflowCandidates(root, census), options.python);
}

/** Python files a workflow command names that are not test-named files, which the test-file rule must still read to decide. */
function workflowCandidates(root: string, census: Census): string[] {
  const named = new Set(census.groups.find(group => group.language === 'Python')?.files ?? []);
  return workflowPythonFiles(root).filter(rel => !named.has(rel));
}

/**
 * Gather evidence like `scan`, loading the Python parser (WASM, asynchronous) only when the census finds Python test files, so a
 * repo without them never loads it and reports exactly what `scan` does. This is the entry point for callers that can wait.
 */
export async function scanProject(rootInput: string, options: ScanOptions = {}): Promise<EvidenceReport> {
  const root = resolve(rootInput);
  const census = inspectCensus(root);
  const candidates = workflowCandidates(root, census);
  let read = options.python;
  if (!read && (candidates.length > 0 || census.groups.some(group => group.language === 'Python'))) {
    try {
      const [{ loadPythonParser }, { extractPythonFactsWith }] = await Promise.all([import('./python/parser.ts'), import('./python/facts.ts')]);
      const parse = await loadPythonParser();
      read = source => extractPythonFactsWith(parse, source);
    } catch (error) {
      // The parser itself cannot load (a missing package or WASM): the runtime is broken, which is not a syntax error in a Python file.
      const first = (error instanceof Error ? error.message : String(error)).split(/\r?\n/)[0]!.replace(/[^\x20-\x7e]/g, '?').trim();
      throw new CliError('E_RUNTIME_BROKEN', first || 'The Python parser could not be loaded', RUNTIME_BROKEN_HINT, { cause: error });
    }
  }
  return scanWithCensus(root, options, census, candidates, read);
}

function scanWithCensus(root: string, options: ScanOptions, census: Census, candidates: string[], readPython: PythonReader | undefined): EvidenceReport {
  const pythonRels = census.groups.find(group => group.language === 'Python')?.files ?? [];
  if (pythonRels.length + candidates.length > 0 && !readPython) {
    throw new Error(`${pythonRels.length} Python test file(s) and ${candidates.length} workflow-named Python file(s) need a parser: use scanProject, or pass options.python`);
  }
  const map = loadRiskMap(root);
  const sets = commitFileSets(root, options.commitLimit ?? 500);
  const loaded = loadTests(root);
  const python = readPython ? loadPythonTests(root, pythonRels, candidates, readPython) : [];

  const records = new Map<string, TestFileRecord>();
  const unmappedFindings: Finding[] = [];
  /** Tier, area and cost come from the same rules for every language: subjects decide the tier, git history the churn. */
  const placement = (rel: string, bytes: number, subjects: string[], risk: string | undefined): Pick<TestFileRecord, 'tier' | 'area' | 'cost'> => {
    const { tier, area, unmapped } = tierOfFile(map, rel, subjects, risk);
    if (unmapped.length > 0 && area) unmappedFindings.push(unmappedSubjectFinding(rel, unmapped, area));
    const { churn, edits } = churnOf(rel, subjects, sets);
    // `wait` and `ci` stay null in this version because it never runs tests; a later `time` command fills them.
    return { tier, area, cost: { wait: null, agent: Math.ceil(bytes / 4), ci: null, churn, edits } };
  };
  for (const file of loaded) {
    records.set(file.rel, {
      file: file.rel,
      tests: file.parsed.tests.length,
      assertions: file.parsed.assertions,
      flags: file.unparsed ? ['unparsed'] : flagsOf(file.parsed),
      ...(file.unparsed ? {} : skipFieldsOf(file.parsed)),
      subjects: file.subjects,
      tags: file.parsed.tags,
      ...placement(file.rel, Buffer.byteLength(file.text), file.subjects, file.parsed.tags.risk),
      findings: [],
    });
  }
  // Python records take part in wiring and the report tables but not in the JavaScript line detectors below (shims, worktree
  // hazards, redundancy), which read JavaScript syntax. Only the flags and fields a Python reader can state are set.
  for (const file of python) {
    records.set(file.rel, {
      file: file.rel,
      language: 'python',
      tests: file.facts?.tests.length ?? 0,
      assertions: file.facts?.tests.reduce((sum, test) => sum + test.assertions, 0) ?? 0,
      flags: file.facts ? (bareTests(file.facts.tests).length > 0 ? ['no-direct-assertions'] : []) : ['unparsed'],
      ...(file.facts ? noAssertionTestsOf(file.facts.tests) : {}),
      subjects: file.subjects,
      tags: file.tags,
      ...placement(file.rel, file.bytes, file.subjects, file.tags.risk),
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
  for (const file of python) {
    attach((file.facts?.opaque ?? []).map(opaque => ({
      category: 'wiring' as const,
      rule: 'wiring.opaque-test-registration',
      file: file.rel,
      line: opaque.line,
      message: OPAQUE_PYTHON_MESSAGE[opaque.reason],
      evidence: opaque.name ?? 'non-literal import',
    })));
  }
  for (const rel of discoverTestInfrastructure(root)) {
    try {
      attach(detectWorktreeHazards(rel, readFileSync(join(root, rel), 'utf8').split(/\r?\n/)));
    } catch {
      // Infrastructure may be unreadable; tests still have their own parse diagnostics.
    }
  }
  const runner = detectRunner(root, loaded.flatMap(file => file.parsed.imports));
  const pythonTests = python.flatMap(file => file.facts?.tests ?? []);
  const pythonRunner = detectPythonRunner(root, census.conftests.length > 0, {
    importsPytest: python.some(file => file.facts?.signals.pytest),
    importsUnittest: python.some(file => file.facts?.signals.unittest),
    hasTestCaseTests: pythonTests.some(test => test.testCase),
    hasPlainTests: pythonTests.some(test => !test.testCase),
  });
  const inventory = inventoryOf(census, runner, loaded.length, { runner: pythonRunner, files: python.length }, pythonNotesOf(root, python));
  const redundancy = detectRedundancy(loaded);
  attach(redundancy.findings);
  attach(
    detectWiring(
      map,
      [...records.values()].map(record => ({ rel: record.file, tier: record.tier, tags: record.tags, subjects: record.subjects })),
      candidateDirs(root),
      dir => classifiableFiles(root, dir),
      inventory?.languages.filter(entry => entry.status === 'detected-unsupported').map(entry => entry.language),
      inventory?.noteScopes,
    ),
  );
  attach(unmappedFindings);
  attach(detectFrequency(root, map));

  for (const record of records.values()) record.findings.sort(byLocation);
  projectFindings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : byLocation(a, b)));

  return {
    schema: EVIDENCE_SCHEMA,
    root,
    runner,
    phase: map?.phase ?? null,
    riskMapPresent: map !== null,
    // JavaScript files come first from discovery; a repo with Python files lists every file by path instead.
    files: python.length > 0 ? [...records.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)) : [...records.values()],
    clusters: redundancy.clusters,
    projectFindings,
    ...(inventory ? { inventory } : {}),
  };
}
