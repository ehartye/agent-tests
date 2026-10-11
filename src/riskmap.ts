import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { CliError } from './errors.ts';
import { globToRegExp } from './paths.ts';
import { RiskMap, type Tier } from './schema.ts';

export const RISK_MAP_PATH = '.testing/risk.yml';

export function defaultRiskMap(): RiskMap {
  return {
    phase: 'dev',
    consumers: [],
    weights: { wait: 1, agent: 1, ci: 1, churn: 1 },
    lanes: {
      edit: { runs: 'affected-files', trigger: 'agent-edit' },
      merge: { runs: 'critical+standard', trigger: 'local-pre-push' },
      scheduled: { runs: 'all', trigger: 'cron', os: ['ubuntu', 'windows', 'macos'] },
      release: { runs: 'all+clean-install', trigger: 'tag', os: ['ubuntu', 'windows', 'macos'] },
    },
    areas: [],
  };
}

/** Returns null when the project has no risk map yet. Throws E_RISKMAP when the file is present but invalid. */
export function loadRiskMap(root: string): RiskMap | null {
  const path = join(root, RISK_MAP_PATH);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new CliError('E_RISKMAP', `Cannot parse ${RISK_MAP_PATH}: ${(error as Error).message}`);
  }
  const result = RiskMap.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new CliError('E_RISKMAP', `Invalid ${RISK_MAP_PATH}: ${issues}`);
  }
  return result.data;
}

export function serializeRiskMap(map: RiskMap): string {
  const header =
    '# agent-tests risk map. Confirm or edit, then commit it.\n' +
    '# First matching area wins, so list specific areas before broad ones.\n' +
    '# consumers: who depends on this code? An empty list means compat and fallback tests guard nobody.\n';
  return header + stringify(map, { lineWidth: 0 });
}

export function tierFor(map: RiskMap, relPath: string): { tier: Tier; area: string } | null {
  for (const area of map.areas) {
    if (globToRegExp(area.path).test(relPath)) return { tier: area.tier, area: area.path };
  }
  return null;
}
