import { globToRegExp } from '../paths.ts';
import { RISK_MAP_PATH, tierFor } from '../riskmap.ts';
import type { Finding, LaneName, RiskMap, Tier } from '../schema.ts';

export interface WiringFile {
  rel: string;
  tier: Tier | null;
  tags: { lane?: LaneName; risk?: string };
  subjects: string[];
}

/** Lanes a test of each tier normally belongs in. A tag outside the set is evidence to review, not an error. */
export const ALLOWED_LANES: Record<Tier, LaneName[]> = {
  critical: ['edit', 'merge'],
  standard: ['edit', 'merge', 'scheduled'],
  low: ['scheduled', 'release'],
};

/** Tests not tied to a risk tier or lane, lane/tier mismatches, critical areas nobody tests, and directories the map has never seen. */
export function detectWiring(map: RiskMap | null, files: WiringFile[], candidateDirs: string[]): Finding[] {
  if (!map) {
    return [
      {
        category: 'wiring',
        rule: 'wiring.no-risk-map',
        file: RISK_MAP_PATH,
        message: 'No risk map: tests cannot be tied to risk tiers or lanes. Run risk-draft and confirm the result.',
        evidence: '',
      },
    ];
  }
  const findings: Finding[] = [];
  for (const file of files) {
    if (!file.tier) {
      findings.push({
        category: 'wiring',
        rule: 'wiring.untiered',
        file: file.rel,
        message: 'Test exercises code that matches no risk-map area, so it has no tier.',
        evidence: file.subjects.join(', '),
      });
    } else if (file.tags.lane && !ALLOWED_LANES[file.tier].includes(file.tags.lane)) {
      findings.push({
        category: 'wiring',
        rule: 'wiring.lane-mismatch',
        file: file.rel,
        message: `A ${file.tier}-tier test normally runs in ${ALLOWED_LANES[file.tier].join(' or ')}, not ${file.tags.lane}. Confirm or retag.`,
        evidence: `@lane ${file.tags.lane}`,
      });
    }
  }
  for (const area of map.areas) {
    if (area.tier !== 'critical') continue;
    const pattern = globToRegExp(area.path);
    if (!files.some(file => file.subjects.some(subject => pattern.test(subject)))) {
      findings.push({
        category: 'wiring',
        rule: 'wiring.uncovered-critical',
        file: area.path,
        message: 'Critical area with no test file exercising it.',
        evidence: area.why ?? '',
      });
    }
  }
  for (const dir of candidateDirs) {
    if (!tierFor(map, `${dir}/__probe__.ts`)) {
      findings.push({
        category: 'wiring',
        rule: 'wiring.drift',
        file: dir,
        message: 'Directory matches no risk-map area. Add it with a tier.',
        evidence: '',
      });
    }
  }
  return findings;
}
