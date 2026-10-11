import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IGNORED_DIRS } from './discover.ts';
import { defaultRiskMap } from './riskmap.ts';
import type { RiskMap, Tier } from './schema.ts';

const BASES = ['src', 'lib', 'app', 'packages', 'apps'];
const SKIPPED = /^(?:tests?|__tests__|docs?|scripts|fixtures?)$/i;
const CRITICAL = /(auth|security|crypto|secret|payment|billing|money|ledger|persist|storage|store|database|db|migrat|schema|session|permission|account)/i;
const LOW = /^(?:ui|views?|components?|styles?|themes?|examples?|demo|playground|storybook|stories|assets)$/i;

const isDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

/** Directories the risk map should classify: the children of src/lib/app/packages/apps, or of the root when none exist. */
export function candidateDirs(root: string): string[] {
  const bases = BASES.filter(base => isDir(join(root, base)));
  const parents = bases.length > 0 ? bases : ['.'];
  const found: string[] = [];
  for (const base of parents) {
    for (const entry of readdirSync(join(root, base), { withFileTypes: true })) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.') || SKIPPED.test(entry.name)) continue;
      found.push(base === '.' ? entry.name : `${base}/${entry.name}`);
    }
  }
  return found.sort();
}

function classify(dir: string): { tier: Tier; why: string } {
  const name = dir.split('/').pop() ?? dir;
  const critical = name.match(CRITICAL);
  if (critical) return { tier: 'critical', why: `name suggests ${critical[1].toLowerCase()}; confirm` };
  if (LOW.test(name)) return { tier: 'low', why: 'presentation or example code; confirm' };
  return { tier: 'standard', why: 'default; confirm' };
}

const CODE = /\.[cm]?[jt]sx?$/;
const SOURCE_BASES = ['src', 'lib', 'app'];

const hasLooseCode = (root: string, base: string): boolean => readdirSync(join(root, base), { withFileTypes: true }).some(entry => entry.isFile() && CODE.test(entry.name));

/** A first guess from directory names. The owner confirms it once; later scans flag drift. */
export function draftRiskMap(root: string): RiskMap {
  const map = defaultRiskMap();
  map.areas = candidateDirs(root).map(dir => ({ path: `${dir}/**`, ...classify(dir) }));
  // Code that sits directly in the source directory belongs to no subdirectory. First match wins, so this catch-all goes last.
  for (const base of SOURCE_BASES) {
    if (isDir(join(root, base)) && hasLooseCode(root, base)) {
      map.areas.push({ path: `${base}/**`, tier: 'standard', why: 'files directly under the source directory; confirm' });
    }
  }
  return map;
}
