import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { churnOf, commitFileSets } from './churn.ts';
import { detectFrequency } from './detectors/frequency.ts';
import { detectRedundancy } from './detectors/redundancy.ts';
import { detectShims } from './detectors/shims.ts';
import { detectWiring } from './detectors/wiring.ts';
import { detectWorktreeHazards } from './detectors/worktree.ts';
import { detectRunner, discoverTests } from './discover.ts';
import { openParseSession, resolveSubjects, type ParsedFile } from './parse.ts';
import { candidateDirs } from './riskdraft.ts';
import { loadRiskMap, tierFor } from './riskmap.ts';
import { EVIDENCE_SCHEMA, Tier, type EvidenceReport, type FileFlag, type Finding, type RiskMap, type TestFileRecord } from './schema.ts';

export interface ScanOptions {
  commitLimit?: number;
}

const RANK: Record<Tier, number> = { critical: 3, standard: 2, low: 1 };

function tierOfFile(map: RiskMap | null, rel: string, subjects: string[], risk: string | undefined): { tier: Tier | null; area: string | null } {
  if (!map) return { tier: null, area: null };
  const override = Tier.safeParse(risk);
  const hits = (subjects.length > 0 ? subjects : [rel]).map(path => tierFor(map, path)).filter((hit): hit is { tier: Tier; area: string } => hit !== null);
  if (hits.length === 0) return { tier: override.success ? override.data : null, area: null };
  const best = hits.reduce((a, b) => (RANK[b.tier] > RANK[a.tier] ? b : a));
  return { tier: override.success ? override.data : best.tier, area: best.area };
}

function flagsOf(parsed: ParsedFile): FileFlag[] {
  const flags: FileFlag[] = [];
  if (parsed.tautologies > 0) flags.push('tautological');
  if (parsed.assertions > 0 && parsed.snapshotAssertions === parsed.assertions) flags.push('snapshot-only');
  if (parsed.assertions > 0 && parsed.mockAssertions === parsed.assertions) flags.push('mock-only');
  if (parsed.tests.some(test => !test.todo && test.assertions === 0)) flags.push('no-direct-assertions');
  return flags;
}

const byLocation = (a: Finding, b: Finding): number => (a.line ?? 0) - (b.line ?? 0) || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0);

/** Gather evidence about a project's tests. Never executes them and never judges: verdicts belong to the audit skill. */
export function scan(rootInput: string, options: ScanOptions = {}): EvidenceReport {
  const root = resolve(rootInput);
  const map = loadRiskMap(root);
  const sets = commitFileSets(root, options.commitLimit ?? 500);

  const session = openParseSession();
  let loaded;
  try {
    loaded = discoverTests(root).map(rel => {
      const text = readFileSync(join(root, rel), 'utf8');
      const parsed = session.parse(rel, text);
      const declared = (parsed.tags.subjects ?? []).filter(path => existsSync(join(root, path)));
      const subjects = [...new Set([...resolveSubjects(root, rel, parsed.imports), ...declared])].sort();
      return { rel, text, lines: text.split(/\r?\n/), parsed, subjects };
    });
  } finally {
    session.close();
  }

  const records = new Map<string, TestFileRecord>();
  for (const file of loaded) {
    const { tier, area } = tierOfFile(map, file.rel, file.subjects, file.parsed.tags.risk);
    const { churn, edits } = churnOf(file.rel, file.subjects, sets);
    records.set(file.rel, {
      file: file.rel,
      tests: file.parsed.tests.length,
      assertions: file.parsed.assertions,
      flags: flagsOf(file.parsed),
      subjects: file.subjects,
      tags: file.parsed.tags,
      tier,
      area,
      cost: { wait: null, agent: Math.ceil(Buffer.byteLength(file.text) / 4), ci: null, churn, edits },
      findings: [],
    });
  }

  const projectFindings: Finding[] = [];
  const attach = (findings: Finding[]): void => {
    for (const finding of findings) (records.get(finding.file)?.findings ?? projectFindings).push(finding);
  };

  for (const file of loaded) {
    const shimNote = map ? (map.consumers.length === 0 ? 'No consumers declared in the risk map.' : undefined) : 'No risk map, so consumers are unknown.';
    attach(detectShims(file.rel, file.parsed).map(finding => (shimNote ? { ...finding, note: shimNote } : finding)));
    attach(detectWorktreeHazards(file.rel, file.lines));
  }
  const redundancy = detectRedundancy(loaded);
  attach(redundancy.findings);
  attach(
    detectWiring(
      map,
      [...records.values()].map(record => ({ rel: record.file, tier: record.tier, tags: record.tags, subjects: record.subjects })),
      candidateDirs(root),
    ),
  );
  attach(detectFrequency(root, map));

  for (const record of records.values()) record.findings.sort(byLocation);
  projectFindings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : byLocation(a, b)));

  return {
    schema: EVIDENCE_SCHEMA,
    root,
    runner: detectRunner(root),
    phase: map?.phase ?? null,
    riskMapPresent: map !== null,
    files: [...records.values()],
    clusters: redundancy.clusters,
    projectFindings,
  };
}
