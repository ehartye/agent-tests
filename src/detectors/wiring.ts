import { join } from 'node:path';
import { IGNORED_DIRS, isSupportPath, isTestPath, readEntries } from '../discover.ts';
import { globToRegExp } from '../paths.ts';
import { RISK_MAP_PATH, tierFor } from '../riskmap.ts';
import type { Finding, LaneName, RiskMap, Tier } from '../schema.ts';

/** `rel` and every entry of `subjects` must be repo-relative with forward slashes, as `relPosix` produces. */
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

const TAG_HELP = 'Add `@risk <critical|standard|low>` or `@subject <path>` at the top of the file.';
const TIERS: readonly string[] = ['critical', 'standard', 'low'];
const EVIDENCE_LIMIT = 160;
/** An area whose glob is one literal segment followed by `/**` (`src/**`): it assigns a tier to everything, so it hides drift. */
const CATCH_ALL = /^[^/*?]+\/\*\*$/;

/** The subjects joined by ', ', cut at a comma boundary with '...' when they would exceed the limit. */
function subjectEvidence(subjects: string[]): string {
  const joined = subjects.join(', ');
  if (joined.length <= EVIDENCE_LIMIT) return joined;
  let kept = '';
  for (const subject of subjects) {
    const next = kept ? `${kept}, ${subject}` : subject;
    if (next.length + 3 > EVIDENCE_LIMIT) break;
    kept = next;
  }
  return `${kept || subjects[0].slice(0, EVIDENCE_LIMIT - 3)}...`;
}

function untieredFinding(file: WiringFile): Finding {
  const badRisk = file.tags.risk !== undefined && !TIERS.includes(file.tags.risk);
  const base =
    file.subjects.length === 0
      ? `This test has no code subject, so it has no tier. ${TAG_HELP}`
      : `Test exercises code that matches no risk-map area, so it has no tier. Add an area for it, or: ${TAG_HELP}`;
  return {
    category: 'wiring',
    rule: 'wiring.untiered',
    file: file.rel,
    message: badRisk ? `${base} \`@risk\` must be critical, standard or low.` : base,
    evidence: badRisk ? `@risk ${file.tags.risk}` : file.subjects.length === 0 ? 'no code subjects' : subjectEvidence(file.subjects),
  };
}

/**
 * A review hint for a test that has some subjects in a risk-map area and some in none. The unmapped subjects were dropped
 * from the tier decision (the test keeps the highest tier among its mapped subjects), so this names them for the owner.
 */
export function unmappedSubjectFinding(rel: string, unmapped: string[], mappedArea: string): Finding {
  return {
    category: 'wiring',
    rule: 'wiring.unmapped-subject',
    file: rel,
    message: `Test exercises code that matches no risk-map area (${subjectEvidence(unmapped)}) although other subjects map to ${mappedArea}. The tier ignores the unmapped code. Add an area for it if it matters.`,
    evidence: `${subjectEvidence(unmapped)}; mapped area: ${mappedArea}`,
  };
}

/**
 * The files a directory holds that the risk map is expected to classify: nested directories are walked, but ignored output
 * directories, dot directories, test files, test support files and probe artifacts are skipped. Sorted, repo-relative.
 */
export function classifiableFiles(root: string, dir: string): string[] {
  const found: string[] = [];
  const visit = (rel: string): void => {
    for (const entry of readEntries(join(root, rel))) {
      const path = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) visit(path);
      } else if (entry.isFile() && !entry.name.startsWith('__probe__') && !isTestPath(path) && !isSupportPath(path)) found.push(path);
    }
  };
  visit(dir);
  return found.sort();
}

/** Tests not tied to a risk tier or lane, lane/tier mismatches, critical areas nobody tests, and directories the map has never seen. */
export function detectWiring(map: RiskMap | null, files: WiringFile[], candidateDirs: string[], filesIn?: (dir: string) => string[]): Finding[] {
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
      findings.push(untieredFinding(file));
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
    if (!files.some(file => pattern.test(file.rel) || file.subjects.some(subject => pattern.test(subject)))) {
      findings.push({
        category: 'wiring',
        rule: 'wiring.uncovered-critical',
        file: area.path,
        message: 'Critical area with no test file exercising it. A test reaching it only through a subprocess needs `@subject <path>`.',
        evidence: '0 test files import this area',
      });
    }
  }
  // A catch-all such as src/** would make every directory below it look classified, so drift probes without the catch-alls that
  // are strict ancestors of the directory. A catch-all that names the directory itself (`Source/**` for `Source`) is an explicit
  // area for it and stays. When a directory has no area of its own, its files are classified one by one with the same
  // first-match rule `tierFor` applies, so a directory whose files are all covered by narrower areas is not drift.
  for (const dir of candidateDirs) {
    const probeMap: RiskMap = { ...map, areas: map.areas.filter(area => !(CATCH_ALL.test(area.path) && dir.startsWith(`${area.path.slice(0, -3)}/`))) };
    if (tierFor(probeMap, `${dir}/__probe__.ts`)) continue;
    const dirFiles = filesIn?.(dir) ?? [];
    const unclassified = dirFiles.filter(path => !tierFor(probeMap, path));
    if (dirFiles.length > 0 && unclassified.length === 0) continue;
    findings.push({
      category: 'wiring',
      rule: 'wiring.drift',
      file: dir,
      message: unclassified.length > 0 ? 'Directory has files that match no risk-map area. Add them with a tier.' : 'Directory matches no risk-map area. Add it with a tier.',
      evidence: unclassified.length > 0 ? subjectEvidence(unclassified) : '',
    });
  }
  return findings;
}
