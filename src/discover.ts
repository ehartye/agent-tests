import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { relPosix } from './paths.ts';

/**
 * Directory names skipped at any depth and case-sensitively, so a source directory named `build` or `out` is skipped too.
 * `.worktrees` and `.claude` hold nested git worktrees, which would otherwise double-count every test.
 */
export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'out',
  'fixtures',
  '.worktrees',
  '.claude',
  '.venv',
  'vendor',
]);

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const SUPPORT_DIR = /(^|\/)(?:tests?|__tests__|__mocks__|fixtures?|helpers?|testing|test-utils?)\//;

export const isTestPath = (rel: string): boolean => TEST_FILE.test(rel) || (/(^|\/)__tests__\//.test(rel) && CODE_FILE.test(rel));

/** Test helpers and fixtures are not the code a test protects, so they never count as a test's subject. */
export const isSupportPath = (rel: string): boolean => SUPPORT_DIR.test(rel);

const UNREADABLE = new Set(['ENOENT', 'EACCES', 'EPERM']);

/** List a directory, or nothing when it is missing or not permitted; any other error still throws. */
export function readEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (UNREADABLE.has((error as NodeJS.ErrnoException).code ?? '')) return [];
    throw error;
  }
}

const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Visit every regular file under root. Symbolic links and junctions are intentionally not followed (this prevents loops;
 * a symlinked test file or directory is therefore not audited), and unreadable directories are skipped.
 */
export function walk(root: string, visit: (absolute: string, rel: string) => void, dir = root): void {
  for (const entry of readEntries(dir).sort(byName)) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(root, visit, absolute);
    } else if (entry.isFile()) visit(absolute, relPosix(root, absolute));
  }
}

export function discoverTests(root: string): string[] {
  const found: string[] = [];
  walk(root, (_absolute, rel) => {
    if (isTestPath(rel)) found.push(rel);
  });
  return found.sort();
}

export type Runner = 'vitest' | 'jest' | 'unknown';

export function detectRunner(root: string): Runner {
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies?: object; devDependencies?: object };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ('vitest' in deps) return 'vitest';
      if ('jest' in deps || 'ts-jest' in deps || '@jest/globals' in deps) return 'jest';
    } catch {
      // An unreadable package.json falls through to the config-file check.
    }
  }
  let names: string[];
  try {
    names = readdirSync(root);
  } catch (error) {
    if (!UNREADABLE.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
    names = [];
  }
  if (names.some(name => /^vitest\.config\./.test(name))) return 'vitest';
  if (names.some(name => /^jest\.config\./.test(name))) return 'jest';
  return 'unknown';
}
