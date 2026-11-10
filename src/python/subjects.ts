import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isPythonSupportFile, isPythonTestPath, isSupportPath } from '../discover.ts';
import type { PythonFacts } from './facts.ts';

/** A literal module name from `import_module("a.b")`; anything else (relative, empty parts, path characters) names no project file. */
const DOTTED_NAME = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;

/**
 * Why the Python inventory can be incomplete, as the note text each reason adds. The reasons are scoped (see `NoteScope`): a facade
 * note to the package directory it reaches through, an opaque-registration note to the packages of the file's subjects, the config
 * note to the whole project.
 */
export const PYTHON_NOTES = {
  config: 'custom python_files configured; discovery used defaults',
  facade: 'imports through a package __init__ may reach other modules',
  opaque: 'some Python tests are registered in ways the scan cannot read (load_tests, an imported test class or a non-literal import)',
} as const;

/** At most this many unparsed files are named in their note; the rest are counted. */
const MAX_UNPARSED_LISTED = 5;

/**
 * The note for Python test files that could not be parsed (a syntax error, a construct the grammar rejects, or the size cap), which
 * give no subjects and so could cover any area. Their paths are sorted, the first five named (ASCII only: other characters become
 * `?`), the rest counted. Its scope is always "all".
 */
export function unparsedNote(files: readonly string[]): string {
  const sorted = [...files].sort();
  const listed = sorted.slice(0, MAX_UNPARSED_LISTED).map(file => file.replace(/[^\x20-\x7e]/g, '?'));
  const more = sorted.length - listed.length;
  return `Python test files could not be parsed: ${listed.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/** The directory part of a repo-relative path; `''` for a file in the project root. */
const parentOf = (rel: string): string => rel.slice(0, Math.max(rel.lastIndexOf('/'), 0));

export interface PythonSubjects {
  /** The project files the test imports directly, sorted. */
  subjects: string[];
  /** The package `__init__.py` files among the subjects that the test imports through (a facade), sorted. */
  facades: string[];
}

export interface PythonSubjectResolver {
  (testRel: string, facts: Pick<PythonFacts, 'imports' | 'dynamicImports'>): PythonSubjects;
  /**
   * Whether `from <module> import ...` in the test file names a project module or package: an absolute module resolves under the same
   * package roots as a subject, a relative one (`level` dots) against the test file's directory and its parents. Stdlib and third-party
   * modules resolve to nothing. Test and support files count: they are project modules, merely not subjects.
   */
  isProjectModule(testRel: string, module: string, level: number): boolean;
}

/**
 * The package roots a dotted module is looked up under for one test file, in order: the project root, then `src/`, then every
 * ancestor directory of the test file (its own directory first, up to but excluding the project root), each followed by its `src/`.
 * So `backend/tests/test_svc.py` importing `app.svc` finds `backend/app/svc.py`. The first root that resolves a module wins.
 */
function packageRoots(testRel: string): string[] {
  const roots = ['', 'src'];
  const directories = testRel.split('/').slice(0, -1);
  for (let depth = directories.length; depth > 0; depth--) {
    const directory = directories.slice(0, depth).join('/');
    roots.push(directory, `${directory}/src`);
  }
  return [...new Set(roots)];
}

/**
 * A resolver of the project files a Python test imports directly, by file names only: nothing is imported or run.
 *
 * - `import a.b` and a literal `import_module("a.b")` name `a/b.py` or `a/b/__init__.py`.
 * - `from a.b import c` names `a/b/c.py` (or `a/b/c/__init__.py`) when `c` is a submodule, otherwise the module `a/b` itself;
 *   `from a import *` names the module.
 * - `from .m import x` and `from . import m` resolve against the test file's directory (one dot) or its parents (more dots).
 * - A dotted module is tried under each of `packageRoots`; the first root that resolves wins.
 * - An import that reaches a package only through its `__init__.py` (`import pkg`, or `from pkg import name` where `name` is not a
 *   submodule) is a facade: the `__init__.py` is the subject, and it is also returned in `facades`, because the package may
 *   re-export names from modules the scan cannot see. `from pkg import m, name` is a facade too (for `name`) although `m` resolves.
 *
 * Stdlib and third-party modules resolve to nothing. Test files, `conftest.py` and test support paths are never subjects. The
 * result is sorted, repo-relative with forward slashes. The resolver remembers which paths are files, so one is made per scan.
 */
export function createPythonSubjectResolver(root: string): PythonSubjectResolver {
  const files = new Map<string, boolean>();
  const isFile = (rel: string): boolean => {
    let known = files.get(rel);
    if (known === undefined) {
      try {
        known = statSync(join(root, rel)).isFile();
      } catch {
        known = false;
      }
      files.set(rel, known);
    }
    return known;
  };
  const first = (...rels: string[]): string | undefined => rels.find(isFile);
  const at = (base: string, parts: string[]): string => [base, ...parts].filter(Boolean).join('/');
  const asModule = (base: string, parts: string[]): string | undefined =>
    parts.length > 0 ? first(`${at(base, parts)}.py`, `${at(base, parts)}/__init__.py`) : first(at(base, ['__init__.py']));
  const isInit = (rel: string): boolean => rel === '__init__.py' || rel.endsWith('/__init__.py');

  /** The files `from <base>/<parts> import <names>` names; no names means a plain `import <base>/<parts>`. `facade` is the package `__init__.py` reached by name. */
  const resolveFrom = (base: string, parts: string[], names: readonly string[]): { hits: string[]; facade?: string } => {
    const hits = new Set<string>();
    let needsModule = names.length === 0;
    for (const name of names) {
      const submodule = name === '*' ? undefined : asModule(base, [...parts, name]);
      if (submodule) hits.add(submodule);
      else needsModule = true;
    }
    const module = needsModule ? asModule(base, parts) : undefined;
    if (module) hits.add(module);
    return { hits: [...hits], ...(module && isInit(module) ? { facade: module } : {}) };
  };
  const resolveAbsolute = (roots: readonly string[], parts: string[], names: readonly string[]): { hits: string[]; facade?: string } => {
    for (const base of roots) {
      const resolved = resolveFrom(base, parts, names);
      if (resolved.hits.length > 0) return resolved;
    }
    return { hits: [] };
  };

  const resolver: PythonSubjectResolver['isProjectModule'] = (testRel, module, level) => {
    const parts = module ? module.split('.') : [];
    if (level === 0) return parts.length > 0 && packageRoots(testRel).some(base => asModule(base, parts) !== undefined);
    const directory = testRel.split('/').slice(0, -1);
    if (level - 1 > directory.length) return false;
    return asModule(directory.slice(0, directory.length - (level - 1)).join('/'), parts) !== undefined;
  };

  const resolve = (testRel: string, facts: Pick<PythonFacts, 'imports' | 'dynamicImports'>): PythonSubjects => {
    const found = new Set<string>();
    const facades = new Set<string>();
    const keep = (resolved: { hits: string[]; facade?: string }): void => {
      for (const hit of resolved.hits) found.add(hit);
      if (resolved.facade) facades.add(resolved.facade);
    };
    const roots = packageRoots(testRel);
    const directory = testRel.split('/').slice(0, -1);
    for (const { module, names, level } of facts.imports) {
      if (level === 0) {
        keep(resolveAbsolute(roots, module.split('.'), names));
      } else if (level - 1 <= directory.length) {
        const base = directory.slice(0, directory.length - (level - 1)).join('/');
        keep(resolveFrom(base, module ? module.split('.') : [], names));
      }
    }
    for (const { module } of facts.dynamicImports) {
      if (module !== null && DOTTED_NAME.test(module)) keep(resolveAbsolute(roots, module.split('.'), []));
    }
    const subjects = [...found].filter(rel => !isPythonTestPath(rel) && !isPythonSupportFile(rel) && !isSupportPath(rel)).sort();
    return { subjects, facades: [...facades].filter(rel => subjects.includes(rel)).sort() };
  };
  return Object.assign(resolve, { isProjectModule: resolver });
}

/** The scope of a note: every area (`"all"`), or the directories it can affect. A directory that is the project root is `"all"`. */
export type PythonNoteScope = 'all' | string[];

/** The scope of a facade note: the package directory of the `__init__.py`. */
export const facadeScope = (init: string): PythonNoteScope => (parentOf(init) === '' ? 'all' : [parentOf(init)]);

/**
 * The scope of an opaque-registration note for one test file: the package directories of its subjects (a subject in the project
 * root names no package and is skipped); when that leaves nothing, the nearest ancestor directory of the test file (its own
 * directory first, never the project root) that holds an `__init__.py` or is named `src`; otherwise the test file's own directory,
 * which is `"all"` for a test file in the project root.
 */
export function opaqueScope(root: string, testRel: string, subjects: readonly string[]): PythonNoteScope {
  const packages = [...new Set(subjects.map(parentOf).filter(directory => directory !== ''))].sort();
  if (packages.length > 0) return packages;
  const parts = testRel.split('/').slice(0, -1);
  for (let depth = parts.length; depth > 0; depth--) {
    const directory = parts.slice(0, depth).join('/');
    if (parts[depth - 1] === 'src' || existsSync(join(root, directory, '__init__.py'))) return [directory];
  }
  return parts.length > 0 ? [parts.join('/')] : 'all';
}

/** Merge scopes of one note into one: `"all"` wins over any directories; otherwise the sorted union. */
export function mergeScopes(scopes: readonly PythonNoteScope[]): PythonNoteScope {
  if (scopes.some(scope => scope === 'all')) return 'all';
  return [...new Set(scopes.flat())].sort();
}
