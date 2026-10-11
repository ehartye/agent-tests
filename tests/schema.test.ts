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
});
