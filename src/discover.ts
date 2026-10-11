import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { relPosix } from './paths.ts';

export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo', '.cache', 'out', 'fixtures']);

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const SUPPORT_DIR = /(^|\/)(?:tests?|__tests__|__mocks__|fixtures?|helpers?|testing|test-utils?)\//;

export const isTestPath = (rel: string): boolean => TEST_FILE.test(rel) || (/(^|\/)__tests__\//.test(rel) && CODE_FILE.test(rel));

/** Test helpers and fixtures are not the code a test protects, so they never count as a test's subject. */
export const isSupportPath = (rel: string): boolean => SUPPORT_DIR.test(rel);

const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function walk(root: string, visit: (absolute: string, rel: string) => void, dir = root): void {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort(byName)) {
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
  const names = readdirSync(root);
  if (names.some(name => /^vitest\.config\./.test(name))) return 'vitest';
  if (names.some(name => /^jest\.config\./.test(name))) return 'jest';
  return 'unknown';
}
