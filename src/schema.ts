import { z } from 'zod';

export const Tier = z.enum(['critical', 'standard', 'low']);
export type Tier = z.infer<typeof Tier>;

export const Phase = z.enum(['dev', 'test', 'production']);
export type Phase = z.infer<typeof Phase>;

export const LaneName = z.enum(['edit', 'merge', 'scheduled', 'release']);
export type LaneName = z.infer<typeof LaneName>;

// The risk map is hand-edited and committed, so unknown keys are errors: a typo like `Why:` must not be dropped silently.
const LaneSpec = z.strictObject({
  runs: z.string().min(1),
  trigger: z.string().min(1),
  os: z.array(z.string()).optional(),
});

export const RiskMap = z.strictObject({
  phase: Phase,
  consumers: z.array(z.string()),
  weights: z.strictObject({
    wait: z.number().nonnegative(),
    agent: z.number().nonnegative(),
    ci: z.number().nonnegative(),
    churn: z.number().nonnegative(),
  }),
  lanes: z.strictObject({ edit: LaneSpec, merge: LaneSpec, scheduled: LaneSpec, release: LaneSpec }),
  areas: z.array(z.strictObject({ path: z.string().min(1), tier: Tier, why: z.string().optional() })),
});
export type RiskMap = z.infer<typeof RiskMap>;

export const Category = z.enum(['redundancy', 'shim', 'worktree', 'wiring', 'frequency']);
export type Category = z.infer<typeof Category>;

export const Finding = z.object({
  category: Category,
  rule: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  message: z.string().min(1),
  evidence: z.string(),
  note: z.string().optional(),
  /** Shared title words with the closest other file (redundancy.shared-subject only); absent when the files share only a subject. */
  overlap: z.number().int().positive().optional(),
});
export type Finding = z.infer<typeof Finding>;

export const FileFlag = z.enum(['tautological', 'snapshot-only', 'mock-only', 'no-direct-assertions', 'unparsed']);
export type FileFlag = z.infer<typeof FileFlag>;

export const TestFileRecord = z.object({
  file: z.string(),
  /**
   * The language of a test file the scan reads besides JavaScript and TypeScript; absent on JavaScript and TypeScript records, so a
   * JavaScript-only report is unchanged. A Python record is read by its own parser: it has no `tautological`, `snapshot-only` or
   * `mock-only` flag, no `skips`, and is not fed to the JavaScript line detectors (shims, worktree hazards, redundancy clusters).
   */
  language: z.literal('python').optional(),
  tests: z.number().int().nonnegative(),
  assertions: z.number().int().nonnegative(),
  flags: z.array(FileFlag),
  /** Every test behind a `no-direct-assertions` flag, in file order, names cut to 80 characters; absent when there are none. */
  noAssertionTests: z.array(z.object({ name: z.string(), line: z.number().int().positive() })).optional(),
  /** Skipped tests, counted as tests not calls, with a few distinct reasons; absent when nothing is skipped. */
  skips: z.object({ declared: z.number().int().nonnegative(), conditional: z.number().int().nonnegative(), reasons: z.array(z.string()) }).optional(),
  subjects: z.array(z.string()),
  tags: z.object({ lane: LaneName.optional(), risk: z.string().optional(), subjects: z.array(z.string()).optional() }),
  tier: Tier.nullable(),
  area: z.string().nullable(),
  cost: z.object({
    wait: z.number().nullable(),
    agent: z.number().int().nonnegative(),
    ci: z.number().nullable(),
    churn: z.number().int().nonnegative().nullable(),
    edits: z.number().int().nonnegative().nullable(),
  }),
  findings: z.array(Finding),
});
export type TestFileRecord = z.infer<typeof TestFileRecord>;

export const Cluster = z.object({
  subject: z.string(),
  files: z.array(z.string()),
  layers: z.array(z.string()),
});
export type Cluster = z.infer<typeof Cluster>;

export const NoteScope = z.object({ text: z.string(), scope: z.union([z.literal('all'), z.array(z.string())]) });
export type NoteScope = z.infer<typeof NoteScope>;

/**
 * Which languages' tests the scan could see. Present only when a language other than JavaScript is detected, so a JavaScript-only
 * report is unchanged; its absence does not mean the inventory is complete (the census sees conventional file names only).
 */
export const Inventory = z.object({
  complete: z.boolean(),
  languages: z.array(z.object({
    language: z.string(),
    /** The runner that reads this language's tests; `unknown` for a language the scan only counts by file name. */
    runner: z.string(),
    files: z.number().int().nonnegative(),
    status: z.enum(['supported', 'detected-unsupported']),
  })),
  /** The plain text of every note: why the inventory is incomplete. */
  notes: z.array(z.string()),
  /**
   * The scope of each Python note in `notes`, present only when one exists: `"all"`, or the directories (relative to the project
   * root, forward slashes, no trailing slash) whose areas the note can affect. A critical area inside a note's scope with no covering
   * test reads as coverage unknown; outside every scope it is uncovered.
   */
  noteScopes: z.array(NoteScope).optional(),
});
export type Inventory = z.infer<typeof Inventory>;

export const EVIDENCE_SCHEMA = 'agent-tests/evidence@1';

export const EvidenceReport = z.object({
  schema: z.literal(EVIDENCE_SCHEMA),
  root: z.string(),
  runner: z.enum(['vitest', 'jest', 'node:test', 'unknown']),
  phase: Phase.nullable(),
  riskMapPresent: z.boolean(),
  files: z.array(TestFileRecord),
  clusters: z.array(Cluster),
  projectFindings: z.array(Finding),
  inventory: Inventory.optional(),
});
export type EvidenceReport = z.infer<typeof EvidenceReport>;
