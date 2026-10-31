import { describe, expect, it } from 'vitest';
import { defaultRiskMap } from '../src/riskmap.ts';
import { EVIDENCE_SCHEMA, EvidenceReport, Finding, RiskMap } from '../src/schema.ts';

describe('RiskMap', () => {
  it('accepts the default map', () => {
    expect(RiskMap.safeParse(defaultRiskMap()).success).toBe(true);
  });

  it('rejects an unknown tier', () => {
    const map = { ...defaultRiskMap(), areas: [{ path: 'src/**', tier: 'urgent' }] };
    expect(RiskMap.safeParse(map).success).toBe(false);
  });

  it('rejects a negative weight', () => {
    const map = { ...defaultRiskMap(), weights: { wait: -1, agent: 1, ci: 1, churn: 1 } };
    expect(RiskMap.safeParse(map).success).toBe(false);
  });

  it('rejects unknown keys at every level', () => {
    expect(RiskMap.safeParse({ ...defaultRiskMap(), extra: 1 }).success).toBe(false);
    expect(RiskMap.safeParse({ ...defaultRiskMap(), weights: { wait: 1, agent: 1, ci: 1, churn: 1, extra: 1 } }).success).toBe(false);
    expect(RiskMap.safeParse({ ...defaultRiskMap(), areas: [{ path: 'src/**', tier: 'low', Why: 'typo' }] }).success).toBe(false);
  });

  it('rejects an unknown phase', () => {
    expect(RiskMap.safeParse({ ...defaultRiskMap(), phase: 'beta' }).success).toBe(false);
  });
});

describe('Finding', () => {
  it('requires a message', () => {
    const finding = { category: 'shim', rule: 'shim.title-marker', file: 'a.test.ts', message: '', evidence: '' };
    expect(Finding.safeParse(finding).success).toBe(false);
  });
});

describe('EvidenceReport', () => {
  it('pins the schema identifier', () => {
    const report = { schema: EVIDENCE_SCHEMA, root: '.', runner: 'vitest', phase: null, riskMapPresent: false, files: [], clusters: [], projectFindings: [] };
    expect(EvidenceReport.safeParse(report).success).toBe(true);
    expect(EvidenceReport.safeParse({ ...report, schema: 'other@1' }).success).toBe(false);
  });

  it('represents a static scan: unknown costs and tiers are null', () => {
    const file = {
      file: 'tests/a.test.ts',
      tests: 1,
      assertions: 1,
      flags: [],
      subjects: [],
      tags: {},
      tier: null,
      area: null,
      cost: { wait: null, agent: 120, ci: null, churn: null, edits: null },
      findings: [],
    };
    const report = { schema: EVIDENCE_SCHEMA, root: '.', runner: 'vitest', phase: null, riskMapPresent: false, files: [file], clusters: [], projectFindings: [] };
    expect(EvidenceReport.safeParse(report).success).toBe(true);
  });
});

describe('Finding overlap', () => {
  const base = { category: 'redundancy', rule: 'redundancy.shared-subject', file: 'tests/a.test.ts', message: 'm', evidence: 'e' };
  it('accepts a finding with or without the optional overlap and rejects a non-positive one', () => {
    expect(Finding.safeParse(base).success).toBe(true);
    expect(Finding.safeParse({ ...base, overlap: 5 }).success).toBe(true);
    expect(Finding.safeParse({ ...base, overlap: 0 }).success).toBe(false);
  });
});
