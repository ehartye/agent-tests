import { type Dirent, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IGNORED_DIRS, isTestPath, readEntries } from './discover.ts';
import { defaultRiskMap } from './riskmap.ts';
import type { RiskMap, Tier } from './schema.ts';

const BASES = new Set(['src', 'lib', 'app', 'packages', 'apps']);
const SOURCE_BASES = new Set(['src', 'lib', 'app']);
/** Directories that only group other directories. The draft looks through them instead of listing them. */
const CONTAINERS = new Set(['app', 'apps', 'packages', 'internal', 'pkg', 'features', 'modules', 'domains']);
const MAX_DEPTH = 3;

/**
 * Directory names that are never areas, at any depth and in any case. IGNORED_DIRS contributes `build`, `out`, `vendor` and the like,
 * so a real `src/build` module needs a hand-written area. Dot directories are skipped as well.
 */
const SKIPPED = new Set(['tests', 'test', '__tests__', '__mocks__', 'mocks', 'spec', 'specs', 'e2e', 'bench', 'benchmarks', 'testing', 'test-utils', 'helpers', 'fixture', 'fixtures', 'docs', 'doc', 'scripts']);
/** Tool output that sits at the root of a project with no conventional source directory. */
const ROOT_SKIPPED = new Set(['venv', 'env', 'target', '__pycache__']);

const isDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

function isSkipped(name: string, atRoot: boolean): boolean {
  const lower = name.toLowerCase();
  return name.startsWith('.') || IGNORED_DIRS.has(name) || SKIPPED.has(lower) || (atRoot && ROOT_SKIPPED.has(lower));
}

const CODE = /\.[cm]?[jt]sx?$/;
const isCode = (entry: Dirent): boolean => entry.isFile() && CODE.test(entry.name);

interface Draft {
  dirs: string[];
  /** Per source directory: its real name, and the code files sitting directly in it (or in a container below it). */
  sources: { base: string; files: string[]; looseCode: boolean }[];
}

/**
 * Walk the candidate directories. Symbolic links and junctions are not followed, as in discover.ts, and that includes a
 * symlinked `src`. Areas stop three levels below a base (`src/app/features/auth`); anything deeper, such as
 * `packages/core/src/auth`, must be added to the risk map by hand. Unreadable directories are skipped.
 */
function collect(root: string, prefix: string, entries: Dirent[], level: number, atRoot: boolean, out: string[]): boolean {
  let looseCode = false;
  for (const entry of entries) {
    if (!entry.isDirectory() || isSkipped(entry.name, atRoot)) continue;
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (CONTAINERS.has(entry.name.toLowerCase()) && level < MAX_DEPTH) {
      const children = readEntries(join(root, path));
      const before = out.length;
      const nested = collect(root, path, children, level + 1, atRoot, out);
      if (out.length > before) {
        looseCode ||= nested || children.some(isCode);
        continue;
      }
    }
    out.push(path);
  }
  return looseCode;
}

function draft(root: string): Draft {
  const result: Draft = { dirs: [], sources: [] };
  if (!isDir(root)) return result;
  const rootEntries = readEntries(root);
  const bases = rootEntries.filter(entry => entry.isDirectory() && BASES.has(entry.name.toLowerCase())).map(entry => entry.name);
  if (bases.length === 0) {
    collect(root, '', rootEntries, 1, true, result.dirs);
  }
  for (const base of bases) {
    const entries = readEntries(join(root, base));
    const nestedLoose = collect(root, base, entries, 1, false, result.dirs);
    if (SOURCE_BASES.has(base.toLowerCase())) {
      const files = entries.filter(isCode).map(entry => entry.name).sort();
      result.sources.push({ base, files, looseCode: files.length > 0 || nestedLoose });
    }
  }
  result.dirs.sort();
  return result;
}

/** Directories the risk map should classify: the children of src/lib/app/packages/apps, or of the root when none exist. */
export function candidateDirs(root: string): string[] {
  return draft(root).dirs;
}

/** Keyword groups with the plain-language label used in `why`. A token matches a keyword exactly, or starts with a stem. */
const CRITICAL: { label: string; words: string[]; stems: string[] }[] = [
  { label: 'authentication', words: ['auth', 'authn', 'oauth', 'login', 'logout'], stems: ['authent'] },
  { label: 'authorization', words: ['authz', 'rbac', 'acl'], stems: ['authoriz', 'permission'] },
  { label: 'sessions', words: ['session'], stems: [] },
  { label: 'tokens', words: ['token', 'jwt'], stems: [] },
  { label: 'credentials or secrets', words: ['password', 'secret'], stems: ['credential'] },
  { label: 'security', words: ['security'], stems: [] },
  { label: 'cryptography', words: [], stems: ['crypt', 'encrypt', 'decrypt'] },
  { label: 'payments or money', words: ['billing', 'invoice', 'checkout', 'wallet', 'ledger', 'money', 'transaction'], stems: ['payment'] },
  { label: 'accounts', words: ['account'], stems: [] },
  { label: 'data persistence', words: ['db', 'database', 'datastore', 'storage', 'schema'], stems: ['persist', 'migrat'] },
];
const LOW = new Set(['ui', 'view', 'component', 'style', 'theme', 'example', 'demo', 'playground', 'storybook', 'story', 'asset', 'icon', 'image', 'font', 'public', 'static']);

/** Lowercase tokens of a name: split on - _ . and camelCase boundaries, drop trailing digits and a plural s. */
function tokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s\-_.]+/)
    .map(token => token.toLowerCase().replace(/(?<=[a-z])\d+$/, ''))
    .filter(token => token.length > 0)
    .map(token => (token.endsWith('ies') ? `${token.slice(0, -3)}y` : token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token));
}

/** The first token that names something risky, as the label for `why`. */
function criticalLabel(parts: string[]): string | undefined {
  for (const token of parts) {
    for (const group of CRITICAL) {
      if (group.words.includes(token) || group.stems.some(stem => token.startsWith(stem))) return group.label;
    }
  }
  return undefined;
}

function classify(dir: string): { tier: Tier; why: string } {
  const parts = tokens(dir.split('/').pop() ?? dir);
  const label = criticalLabel(parts);
  if (label) return { tier: 'critical', why: `name suggests ${label}; confirm` };
  if (parts.length > 0 && parts.every(token => LOW.has(token))) return { tier: 'low', why: 'presentation or example code; confirm' };
  return { tier: 'standard', why: 'no risk keyword in the name; confirm' };
}

/** A first guess from directory names. The owner confirms it once; later scans flag drift. */
export function draftRiskMap(root: string): RiskMap {
  const { dirs, sources } = draft(root);
  const map = defaultRiskMap();
  map.areas = dirs.map(dir => ({ path: `${dir}/**`, ...classify(dir) }));
  for (const { base, files, looseCode } of sources) {
    // A risky file name gets its own area. Test files are not subjects, so they never do.
    for (const file of files) {
      const label = isTestPath(file) ? undefined : criticalLabel(tokens(file.replace(CODE, '')));
      if (label) map.areas.push({ path: `${base}/${file}`, tier: 'critical', why: `file name suggests ${label}; confirm` });
    }
    // Code that sits directly in the source directory belongs to no subdirectory. First match wins, so this catch-all goes last.
    if (looseCode) map.areas.push({ path: `${base}/**`, tier: 'standard', why: 'files directly under the source directory; confirm' });
  }
  return map;
}
