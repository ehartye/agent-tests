import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { IGNORED_DIRS, isPythonSupportFile, skipForCensus } from '../discover.ts';

/**
 * Python files a hosted-CI workflow runs, found by reading `.github/workflows/*.yml|yaml` at the project root. They are candidates
 * for the scan's test-file rule, not tests: a candidate counts only if its facts show tests.
 */
export interface WorkflowTargets {
  /** Tokens that name a `.py` file, as project-relative paths with forward slashes. */
  files: string[];
  /** Dotted module names after `python -m unittest` or `python -m pytest` (a bare name is also read after `unittest`). */
  modules: string[];
}

/** `python`, `python3`, `python3.12`, `py`, with a leading path and `.exe` allowed. */
const PYTHON_BIN = /^(?:.*\/)?(?:python(?:\d+(?:\.\d+)*)?|py)(?:\.exe)?$/i;
const MODULE_NAME = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
/** Options of unittest and pytest that take a value, which is therefore not a module name. */
const VALUE_OPTIONS = new Set(['-k', '-p', '-s', '-t', '-m', '-c', '-o', '--rootdir', '--start-directory', '--top-level-directory', '--pattern']);
const BAD_PATH_CHARACTERS = /[\s$*?{}=()<>`!"'~]/;

const unique = (items: string[]): string[] => [...new Set(items)];

/** A token as a project-relative `.py` path, or null for a glob, a variable, an option, or a path outside the project. */
function projectFile(token: string): string | null {
  const path = token.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  const segments = path.split('/');
  const name = segments[segments.length - 1] ?? '';
  if (!name.endsWith('.py') || name.length <= 3 || path.startsWith('-') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null;
  if (BAD_PATH_CHARACTERS.test(path) || segments.some(segment => segment === '' || segment === '..')) return null;
  return path;
}

/**
 * The Python files and modules one `run:` string names. A token ending in `.py` is a file wherever it appears (after `python`,
 * `pytest`, a wrapper, anything). After `python -m unittest` or `python -m pytest` (also `python3`, `py`, a path to either), the
 * dotted names that follow are modules (`unittest` also takes a bare name); reading stops at `discover`, which takes directories.
 * Nothing is resolved here and nothing is executed, so `$VARIABLES`, globs, `..`, absolute paths and options name nothing.
 */
export function pythonTargetsOfRun(run: string): WorkflowTargets {
  const files: string[] = [];
  const modules: string[] = [];
  const commands = run.replace(/\\\r?\n/g, ' ').split(/\r?\n|&&|\|\||[;|&]/);
  for (const command of commands) {
    const tokens = command.split(/\s+/).map(token => token.replace(/^["']+|["',]+$/g, '')).filter(Boolean);
    for (const token of tokens) {
      const file = projectFile(token);
      if (file) files.push(file);
    }
    for (let index = 0; index < tokens.length; index++) {
      if (!PYTHON_BIN.test(tokens[index]!.replace(/\\/g, '/'))) continue;
      let flag = index + 1;
      while (flag < tokens.length && tokens[flag] !== '-m' && tokens[flag] !== '-c' && !tokens[flag]!.endsWith('.py')) flag++;
      const runner = tokens[flag] === '-m' ? tokens[flag + 1] : undefined;
      if (runner !== 'unittest' && runner !== 'pytest') continue;
      let skipValue = false;
      for (const arg of tokens.slice(flag + 2)) {
        if (skipValue) {
          skipValue = false;
        } else if (arg === 'discover' || PYTHON_BIN.test(arg)) {
          break;
        } else if (VALUE_OPTIONS.has(arg)) {
          skipValue = true;
        } else if (!arg.startsWith('-') && !arg.endsWith('.py') && MODULE_NAME.test(arg) && (runner === 'unittest' || arg.includes('.'))) {
          modules.push(arg);
        }
      }
    }
  }
  return { files: unique(files), modules: unique(modules) };
}

/** The `run:` strings of every job step of one parsed workflow; anything not shaped like a workflow gives none. */
function runStrings(workflow: unknown): string[] {
  const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!record(workflow) || !record(workflow.jobs)) return [];
  return Object.values(workflow.jobs).flatMap(job => {
    if (!record(job) || !Array.isArray(job.steps)) return [];
    return job.steps.flatMap(step => (record(step) && typeof step.run === 'string' ? [step.run] : []));
  });
}

/** A project-relative path that is a regular file outside ignored directories and is not `conftest.py`. */
function isCandidateFile(root: string, rel: string): boolean {
  const directories = rel.split('/').slice(0, -1);
  if (isPythonSupportFile(rel) || directories.some(name => IGNORED_DIRS.has(name) || skipForCensus(name))) return false;
  try {
    return statSync(join(root, rel)).isFile();
  } catch {
    return false;
  }
}

/**
 * The Python files that exist under `root` and that a workflow command names: tokens ending in `.py`, and modules after
 * `python -m unittest` or `python -m pytest` resolved to `<dotted path>.py` against the project root. A file that is missing, in an
 * ignored directory (the ones discovery skips) or `conftest.py` is dropped; a workflow that is not valid YAML or has no steps is
 * ignored. Sorted, project-relative with forward slashes.
 */
export function workflowPythonFiles(root: string): string[] {
  const directory = join(root, '.github', 'workflows');
  let names: string[];
  try {
    names = readdirSync(directory).filter(name => /\.ya?ml$/.test(name)).sort();
  } catch {
    return [];
  }
  const found = new Set<string>();
  for (const name of names) {
    let workflow: unknown;
    try {
      workflow = parse(readFileSync(join(directory, name), 'utf8'), { logLevel: 'silent' });
    } catch {
      continue;
    }
    for (const run of runStrings(workflow)) {
      const { files, modules } = pythonTargetsOfRun(run);
      for (const rel of [...files, ...modules.map(module => `${module.replace(/\./g, '/')}.py`)]) {
        if (isCandidateFile(root, rel)) found.add(rel);
      }
    }
  }
  return [...found].sort();
}
