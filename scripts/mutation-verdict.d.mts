/// <reference types="node" />
/** Raw referenced files are data, never modules to execute. Hashes establish byte consistency only. */
export type MutationVerdictKind = 'killed' | 'survived' | 'skipped' | 'unclassified';
export interface MutationFile {
  id: string;
  /** Forward-slash relative path beneath the physical input envelope directory. */
  path: string;
  sha256: string;
  bytes: number;
  kind: 'bytes' | 'native' | 'legacy' | 'catalogue' | 'verdict' | 'evidence';
}
export interface MutationProcess {
  closed: boolean | null;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean | null;
  spawnError: string | null;
}
export interface MutationIdentity {
  executable: string;
  node: string;
  argv: string[];
  cwd: string;
  framework: { name: string; version: string };
  project: string;
  selection: string[];
  configSha256: string;
  setupSha256: string;
  lockfileSha256: string;
  toolchainSha256: string;
}
export interface MutationJudgeBinding {
  entrypoint: string;
  version: string;
  /** SHA-256 of ordered UTF-8 JSON [{path,physicalPath,sha256}], using each before file digest. */
  closureSha256: string;
}
/** Reporter-derived process/framework facts, retained separately from caller-supplied binding. */
export interface MutationNativeActual {
  executable: string;
  /** Actual process.versions.node without a leading v. */
  node: string;
  cwd: string;
  /** Actual process.argv.slice(1), including the native entrypoint. */
  argv: string[];
  framework: { name: string; version: string };
  judgeEntrypoint: string;
}
export interface MutationAttemptBinding {
  attemptId: string;
  sourceRole: 'before' | 'mutant';
  source: Array<{ path: string; sha256: string }>;
  identity: MutationIdentity;
  judge: MutationJudgeBinding;
}
export interface MutationAttempt {
  process: MutationProcess;
  /** Inventory ID of the raw native record. */
  native: string;
  binding: MutationAttemptBinding;
}
export interface MutationSourceEntry {
  path: string;
  /** Honest acquisition declaration, not authenticated historical filesystem state. */
  physicalPath: string;
  before?: string;
  mutant?: string;
  after?: string;
}
/** Nominal trusted review declaration, not an inferred/import-authenticated assertion origin. */
export interface MutationReviewedAssertionSite {
  profile: 'vitest-5.0.5-builtin-toBe-site-v1' | 'playwright-1.64.1-hard-builtin-toBe-site-v1';
  reviewed: true;
  builtin: 'toBe';
  framework: { name: 'vitest'; version: '5.0.5' } | { name: 'playwright'; version: '1.64.1' };
  caseId: string;
  project: string;
  /** Logical unchanged source entry; native physical location is derived from that entry. */
  file: string;
  sha256: string;
  bytes: number;
  line: number;
  column: number;
  /** Unchanged public import-entry snapshot; no transitive provider graph is inferred. */
  provider: string;
  providerSha256: string;
  providerBytes: number;
  providerModule: 'vitest' | '@playwright/test';
  providerVersion: string;
  /** Excludes per-test/suite/around/lifecycle/custom/soft/fixture-assertion/nested-step behavior. */
  sourceScope: { reviewed: true; contract: 'hook-free-builtin-toBe-v1' };
}
export interface MutationEvidenceEnvelope {
  schema: 'agent-tests/mutation-evidence@1';
  caseId: string;
  files: MutationFile[];
  pathPlatform?: 'posix' | 'win32';
  physicalPathsCanonical?: boolean;
  source?: { entries: MutationSourceEntry[] };
  mutation?: { path: string; applied: boolean | null; anchorBase64?: string; replacementBase64?: string; skipReason?: string };
  baseline?: MutationAttempt | null;
  mutant?: MutationAttempt | null;
  judge?: { frozen: boolean; entrypoint: string; version: string; entries: Array<{ path: string; physicalPath: string; before: string; after: string }> };
  assertionSites?: MutationReviewedAssertionSite[];
  legacy?: Record<string, unknown>;
}
export interface MutationCompositionEnvelope {
  schema: 'agent-tests/mutation-composition@1';
  files: MutationFile[];
  catalogue: { ref: string; caseIds: string[] };
  /** Evidence JSON references a matching subset of this envelope's verified file inventory. */
  entries: Array<{ caseId: string; evidence?: string; verdict?: string; origin: 'fresh' | 'reused'; closureSha256: string }>;
  omitted: string[];
  /** Current declared per-case compatibility identities; compared with recomputed evidence input closures. */
  requiredClosures: Array<{ caseId: string; closureSha256: string }>;
  /** Optional historical outer label only. It never establishes strict compatibility. */
  closureSha256?: string;
  historical?: Record<string, unknown>;
}
/** Explicit in-memory raw bytes. Both programmatic functions recheck every inventory hash/length. */
export type HydratedMutationEvidence = MutationEvidenceEnvelope & { artifacts: Record<string, Buffer> };
export type HydratedMutationComposition = MutationCompositionEnvelope & { artifacts: Record<string, Buffer> };
export interface MutationVerdict {
  schema: 'agent-tests/mutation-verdict@1';
  caseId: string;
  verdict: MutationVerdictKind;
  reasons: string[];
  restoration: 'exact' | 'failed' | 'unknown';
  /** Canonical declared before-source/identity/judge/sites/mutation identity, not process attestation. */
  inputClosureSha256: string | null;
  /** Nominal evidence verdict before composition compatibility downgrades a reference to unknown. */
  referenceVerdict?: MutationVerdictKind;
  /** Exact nominal admitted scope when a supported assertion profile classifies a mismatch. */
  profile?: MutationReviewedAssertionSite['profile'];
  native: { baseline: string | null; mutant: string | null };
  historical?: Record<string, unknown>;
}
export interface MutationCompositionDiagnostic {
  valid: boolean;
  problems: string[];
  totals: Record<MutationVerdictKind, number>;
  origins: { fresh: number; reused: number };
  omitted: string[];
  diagnostics: Array<MutationVerdict | { schema: 'agent-tests/mutation-verdict@1'; caseId: string; verdict: 'unclassified'; reasons: string[] }>;
  historical?: Record<string, unknown>;
  newFullBatchRun: false;
  reuseAuthorized: false;
}
/** compositionBytes caps cumulative referenced envelope/verdict plus declared reclassification artifact
 * byte work, separately from the initial totalBytes inventory cap. Exceeding it is integrity refusal. */
export const MUTATION_LIMITS: Readonly<{ files: number; jsonBytes: number; fileBytes: number; totalBytes: number; compositionBytes: number; records: number; stringBytes: number; stackBytes: number; depth: number; causeDepth: number; ancestry: number }>;
/** Read-only bounded filesystem entry. Refuses malformed/hash/path input with MUTATION_EVIDENCE_INVALID. */
export function readMutationEvidence(absoluteBundlePath: string): HydratedMutationEvidence | HydratedMutationComposition;
/** Read-only pure acquisition verifier; does not launch, apply, restore, execute or authorize acceptance. */
export function classifyMutationEvidence(bundle: unknown): MutationVerdict;
/** Recomputes strict referenced evidence; never authorizes reuse or promotes historical claims. */
export function validateMutationComposition(manifest: unknown): MutationCompositionDiagnostic;
