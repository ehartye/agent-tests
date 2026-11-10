import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { relPosix } from './paths.ts';
import { openParseSession } from './parse.ts';

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
  '.local',
  'test-results',
  'playwright-report',
  'out',
  'fixtures',
  '.worktrees',
  '.claude',
  '.playwright-mcp',
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
export function walk(root: string, visit: (absolute: string, rel: string) => void, dir = root, skip: (name: string) => boolean = () => false): void {
  for (const entry of readEntries(dir).sort(byName)) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name) && !skip(entry.name)) walk(root, visit, absolute, skip);
    } else if (entry.isFile()) visit(absolute, relPosix(root, absolute));
  }
}

/** Python test files are recognized by name alone, as pytest and unittest discover them; `conftest.py` is shared support, never a test. */
const PYTHON_TEST_FILE = /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/;
const PYTHON_SUPPORT_FILE = /(?:^|\/)conftest\.py$/;

export const isPythonTestPath = (rel: string): boolean => PYTHON_TEST_FILE.test(rel);
export const isPythonSupportFile = (rel: string): boolean => PYTHON_SUPPORT_FILE.test(rel);

/** Test files by conventional file name (the extension decides the language). Python is inventoried; the others are counted by name only. */
const CENSUS_NAMES: ReadonlyArray<{ language: string; pattern: RegExp }> = [
  { language: 'Python', pattern: PYTHON_TEST_FILE },
  { language: 'Go', pattern: /_test\.go$/ },
  { language: 'Ruby', pattern: /(?:^|\/)(?:test_[^/]*\.rb|[^/]*_spec\.rb)$/ },
  { language: 'PowerShell', pattern: /\.Tests\.ps1$/ },
  { language: 'Java', pattern: /Tests?\.java$/ },
  { language: 'Kotlin', pattern: /Tests?\.kt$/ },
  { language: 'C#', pattern: /Tests?\.cs$/ },
  { language: 'PHP', pattern: /Tests?\.php$/ },
];

/**
 * Directories the census skips in addition to IGNORED_DIRS (JavaScript discovery does not): Python environments, caches and build
 * metadata, and vendored or generated trees whose test files are not the project's own. Case-sensitive, like IGNORED_DIRS.
 */
const CENSUS_IGNORED_DIRS = new Set([
  '__pycache__', 'venv', 'env', 'site-packages', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  'third_party', 'thirdparty', 'testdata', 'Pods', 'target',
]);
export const skipForCensus = (name: string): boolean => CENSUS_IGNORED_DIRS.has(name) || name.endsWith('.egg-info');

/** The non-JavaScript language whose conventional test-file naming this path follows, or null. JavaScript and TypeScript keep `isTestPath`. */
export function censusLanguage(rel: string): string | null {
  return CENSUS_NAMES.find(({ pattern }) => pattern.test(rel))?.language ?? null;
}

export interface Census {
  /** Test-named files by language name (sorted), each group's paths sorted. */
  groups: Array<{ language: string; files: string[] }>;
  /** Every `conftest.py`, sorted: shared pytest support that is never a test but tells the runner apart. */
  conftests: string[];
}

/** One walk of the census directories: test-named files of every non-JavaScript language, plus the conftest.py files. */
export function inspectCensus(root: string): Census {
  const rels: string[] = [];
  const conftests: string[] = [];
  walk(root, (_absolute, rel) => {
    if (censusLanguage(rel)) rels.push(rel);
    else if (isPythonSupportFile(rel)) conftests.push(rel);
  }, root, skipForCensus);
  return { groups: groupCensusFiles(rels), conftests: conftests.sort() };
}

/** Test-named files of languages other than JavaScript, grouped by language name (sorted), each group's paths sorted. */
export function discoverCensus(root: string): Array<{ language: string; files: string[] }> {
  return inspectCensus(root).groups;
}

/** Group repo-relative paths by the unsupported language their name follows; other paths are dropped. */
export function groupCensusFiles(rels: readonly string[]): Array<{ language: string; files: string[] }> {
  const groups = new Map<string, string[]>();
  for (const rel of rels) {
    const language = censusLanguage(rel);
    if (!language) continue;
    const files = groups.get(language);
    if (files) files.push(rel);
    else groups.set(language, [rel]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([language, files]) => ({ language, files: files.sort() }));
}

export function discoverTests(root: string): string[] {
  const found: string[] = [];
  walk(root, (_absolute, rel) => {
    if (isTestPath(rel)) found.push(rel);
  });
  return found.sort();
}

export type Runner = 'vitest' | 'jest' | 'node:test' | 'unknown';

/** Infrastructure is audited for shared resources, but never counted as a test file. */
export function discoverTestInfrastructure(root: string): string[] {
  const files: string[] = [];
  walk(root, (_absolute, rel) => {
    if (!isTestPath(rel) && CODE_FILE.test(rel) && (
      /^(?:playwright|vitest|jest)(?:\.[\w-]+)*\.config\./.test(rel) ||
      /^(?:tests?|__tests__)\/(?:support|helpers?|test-utils)\//.test(rel)
    )) files.push(rel);
  });
  return files.sort();
}

export type PythonRunner = 'pytest' | 'unittest' | 'unknown';

const readIfPresent = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

const PYTEST_SECTION = /^\s*\[(?:tool:)?pytest\]/m;

/** The project-root files that can configure pytest, which the scan reads only for text and not for settings. */
const PYTEST_CONFIG_FILES = ['pytest.ini', 'tox.ini', 'setup.cfg', 'pyproject.toml'];

/**
 * Whether a pytest config file at the project root mentions `python_files`, the setting that changes which files pytest collects.
 * The settings are not read, so the scan's name-based discovery (the defaults) may miss or add files when it is set.
 */
export const pythonFilesConfigured = (root: string): boolean => PYTEST_CONFIG_FILES.some(name => readIfPresent(join(root, name)).includes('python_files'));

/** What the inventoried (cleanly parsed) Python test files show about their runner. */
export interface PythonRunnerEvidence {
  /** A file imports pytest. */
  importsPytest: boolean;
  /** A file imports unittest. */
  importsUnittest: boolean;
  /** Some test is a method of a unittest.TestCase subclass. */
  hasTestCaseTests: boolean;
  /** Some test is a module-level function or a method of a plain `Test*` class, which only pytest collects. */
  hasPlainTests: boolean;
}

/**
 * The runner of a repo's Python tests, from files only (nothing is executed), by the first rule that applies:
 * 1. an explicit pytest signal: a pytest config at the project root (`pytest.ini`; a pytest section in `tox.ini` or `setup.cfg`;
 *    `pyproject.toml` mentioning pytest), a `conftest.py` anywhere, or an inventoried file that imports pytest: pytest;
 * 2. an inventoried test derived from `unittest.TestCase`: unittest;
 * 3. any other inventoried test (a module-level function or a plain `Test*` class): pytest, inferred, because only pytest collects those;
 * 4. an inventoried file that imports unittest: unittest;
 * 5. otherwise unknown (only unparsed files, or files with no tests and no import).
 * Configured settings are not read.
 */
export function detectPythonRunner(root: string, hasConftest: boolean, evidence: PythonRunnerEvidence): PythonRunner {
  const configured =
    existsSync(join(root, 'pytest.ini')) ||
    PYTEST_SECTION.test(readIfPresent(join(root, 'tox.ini'))) ||
    PYTEST_SECTION.test(readIfPresent(join(root, 'setup.cfg'))) ||
    readIfPresent(join(root, 'pyproject.toml')).includes('pytest');
  if (configured || hasConftest || evidence.importsPytest) return 'pytest';
  if (evidence.hasTestCaseTests) return 'unittest';
  if (evidence.hasPlainTests) return 'pytest';
  return evidence.importsUnittest ? 'unittest' : 'unknown';
}

export function detectRunner(root: string, importedModules?: readonly string[]): Runner {
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
  if (importedModules) return importedModules.includes('node:test') ? 'node:test' : 'unknown';
  const session = openParseSession();
  try {
    for (const rel of discoverTests(root)) {
      try {
        if (session.parse(rel, readFileSync(join(root, rel), 'utf8')).imports.includes('node:test')) return 'node:test';
      } catch {
        // Unreadable files remain visible to the scan's unparsed-file reporting.
      }
    }
  } finally {
    session.close();
  }
  return 'unknown';
}
