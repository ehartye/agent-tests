import { z } from 'zod';

export const Tier = z.enum(['critical', 'standard', 'low']);
export type Tier = z.infer<typeof Tier>;

export const Phase = z.enum(['dev', 'test', 'production']);
export type Phase = z.infer<typeof Phase>;

export const LaneName = z.enum(['edit', 'merge', 'scheduled', 'release']);
export type LaneName = z.infer<typeof LaneName>;

const LaneSpec = z.object({
  runs: z.string().min(1),
  trigger: z.string().min(1),
  os: z.array(z.string()).optional(),
});

export const RiskMap = z.object({
  phase: Phase,
  consumers: z.array(z.string()),
  weights: z.object({
    wait: z.number().nonnegative(),
    agent: z.number().nonnegative(),
    ci: z.number().nonnegative(),
    churn: z.number().nonnegative(),
  }),
  lanes: z.object({ edit: LaneSpec, merge: LaneSpec, scheduled: LaneSpec, release: LaneSpec }),
  areas: z.array(z.object({ path: z.string().min(1), tier: Tier, why: z.string().optional() })),
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
});
export type Finding = z.infer<typeof Finding>;

export const FileFlag = z.enum(['tautological', 'snapshot-only', 'mock-only', 'no-direct-assertions']);
export type FileFlag = z.infer<typeof FileFlag>;

export const TestFileRecord = z.object({
  file: z.string(),
  tests: z.number().int().nonnegative(),
  assertions: z.number().int().nonnegative(),
  flags: z.array(FileFlag),
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

export const EVIDENCE_SCHEMA = 'agent-tests/evidence@1';

export const EvidenceReport = z.object({
  schema: z.literal(EVIDENCE_SCHEMA),
  root: z.string(),
  runner: z.enum(['vitest', 'jest', 'unknown']),
  phase: Phase.nullable(),
  riskMapPresent: z.boolean(),
  files: z.array(TestFileRecord),
  clusters: z.array(Cluster),
  projectFindings: z.array(Finding),
});
export type EvidenceReport = z.infer<typeof EvidenceReport>;
