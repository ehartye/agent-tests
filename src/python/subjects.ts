import { statSync } from 'node:fs';
import { join } from 'node:path';
import { isPythonSupportFile, isPythonTestPath, isSupportPath } from '../discover.ts';
import type { PythonFacts } from './facts.ts';

/**
 * Package roots a dotted module is looked up under, in order: the project root, then `src/`. (A test's ancestor directories are
 * not roots yet, and neither are namespace-package layouts beyond these two.)
 */
const PACKAGE_ROOTS: readonly string[] = ['', 'src'];

/** A literal module name from `import_module("a.b")`; anything else (relative, empty parts, path characters) names no project file. */
const DOTTED_NAME = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;

export type PythonSubjectResolver = (testRel: string, facts: Pick<PythonFacts, 'imports' | 'dynamicImports'>) => string[];

/**
 * A resolver of the project files a Python test imports directly, by file names only: nothing is imported or run.
 *
 * - `import a.b` and a literal `import_module("a.b")` name `a/b.py` or `a/b/__init__.py`.
 * - `from a.b import c` names `a/b/c.py` (or `a/b/c/__init__.py`) when `c` is a submodule, otherwise the module `a/b` itself;
 *   `from a import *` names the module.
 * - `from .m import x` and `from . import m` resolve against the test file's directory (one dot) or its parents (more dots).
 * - A dotted module is tried under the project root and then `src/`; the first root that resolves wins.
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

  /** The files `from <base>/<parts> import <names>` names; no names means a plain `import <base>/<parts>`. */
  const resolveFrom = (base: string, parts: string[], names: readonly string[]): string[] => {
    const hits = new Set<string>();
    let needsModule = names.length === 0;
    for (const name of names) {
      const submodule = name === '*' ? undefined : asModule(base, [...parts, name]);
      if (submodule) hits.add(submodule);
      else needsModule = true;
    }
    const module = needsModule ? asModule(base, parts) : undefined;
    if (module) hits.add(module);
    return [...hits];
  };
  const resolveAbsolute = (parts: string[], names: readonly string[]): string[] => {
    for (const base of PACKAGE_ROOTS) {
      const hits = resolveFrom(base, parts, names);
      if (hits.length > 0) return hits;
    }
    return [];
  };

  return (testRel, facts) => {
    const found = new Set<string>();
    const directory = testRel.split('/').slice(0, -1);
    for (const { module, names, level } of facts.imports) {
      if (level === 0) {
        for (const hit of resolveAbsolute(module.split('.'), names)) found.add(hit);
      } else if (level - 1 <= directory.length) {
        const base = directory.slice(0, directory.length - (level - 1)).join('/');
        for (const hit of resolveFrom(base, module ? module.split('.') : [], names)) found.add(hit);
      }
    }
    for (const { module } of facts.dynamicImports) {
      if (module !== null && DOTTED_NAME.test(module)) for (const hit of resolveAbsolute(module.split('.'), [])) found.add(hit);
    }
    return [...found].filter(rel => !isPythonTestPath(rel) && !isPythonSupportFile(rel) && !isSupportPath(rel)).sort();
  };
}
