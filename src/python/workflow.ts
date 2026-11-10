import { lstatSync, readdirSync, readFileSync } from 'node:fs';
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

/**
 * Bounds on hostile or odd workflow text, so reading a workflow can never stall or fail a scan. A `run:` string longer than
 * MAX_RUN_LENGTH characters is ignored whole (real commands are far shorter), and a token longer than MAX_TOKEN_LENGTH characters
 * is skipped (no real path or module name is that long).
 */
export const MAX_RUN_LENGTH = 65_536;
export const MAX_TOKEN_LENGTH = 512;

/** `python`, `python3`, `python3.12`, `py`, with a leading path and `.exe` allowed. */
const PYTHON_BIN = /^(?:.*\/)?(?:python(?:\d+(?:\.\d+)*)?|py)(?:\.exe)?$/i;
const MODULE_NAME = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
/** Options of unittest and pytest that take a value, which is therefore not a module name. */
const VALUE_OPTIONS = new Set(['-k', '-p', '-s', '-t', '-m', '-c', '-o', '--rootdir', '--start-directory', '--top-level-directory', '--pattern']);
const BAD_PATH_CHARACTERS = /[\s$*?{}=()<>`!"'~]/;

const unique = (items: string[]): string[] => [...new Set(items)];

/** A token without leading quotes and without trailing quotes and commas, by one index scan (no backtracking). */
function trimToken(token: string): string {
  let start = 0;
  let end = token.length;
  while (start < end && (token[start] === '"' || token[start] === "'")) start++;
  while (end > start && (token[end - 1] === '"' || token[end - 1] === "'" || token[end - 1] === ',')) end--;
  return token.slice(start, end);
}

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
 * Nothing is resolved here and nothing is executed, so `$VARIABLES`, globs, `..`, absolute paths and options name nothing. The
 * work is linear in the length of the string; see MAX_RUN_LENGTH and MAX_TOKEN_LENGTH for what is ignored outright.
 */
export function pythonTargetsOfRun(run: string): WorkflowTargets {
  const files: string[] = [];
  const modules: string[] = [];
  if (run.length > MAX_RUN_LENGTH) return { files, modules };
  for (const command of run.replace(/\\\r?\n/g, ' ').split(/\r?\n|&&|\|\||[;|&]/)) {
    const tokens = command.split(/\s+/).filter(token => token.length <= MAX_TOKEN_LENGTH).map(trimToken).filter(Boolean);
    // A python binary awaits its `-m`; a script or `-c` ends the wait, so options and their values in between are tolerated.
    let awaitingModuleFlag = false;
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]!;
      const file = projectFile(token);
      if (file) files.push(file);
      if (PYTHON_BIN.test(token.replace(/\\/g, '/'))) {
        awaitingModuleFlag = true;
      } else if (awaitingModuleFlag && (token === '-c' || token.endsWith('.py'))) {
        awaitingModuleFlag = false;
      } else if (awaitingModuleFlag && token === '-m') {
        awaitingModuleFlag = false;
        const runner = tokens[index + 1];
        if (runner !== 'unittest' && runner !== 'pytest') continue;
        let skipValue = false;
        for (let next = index + 2; next < tokens.length; next++) {
          const arg = tokens[next]!;
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

/**
 * Symbolic links and junctions are never followed here, as `walk` never follows them for discovery: a link is neither a real file nor
 * a real directory under `lstat`, so a linked workflow, workflows directory, candidate file or directory above one reads as absent.
 */
const isRealFile = (path: string): boolean => {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
};
const isRealDirectory = (path: string): boolean => {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** A project-relative path that is a real file (no link in it) outside ignored directories and is not `conftest.py`. */
function isCandidateFile(root: string, rel: string): boolean {
  const directories = rel.split('/').slice(0, -1);
  if (isPythonSupportFile(rel) || directories.some(name => IGNORED_DIRS.has(name) || skipForCensus(name))) return false;
  for (let depth = 1; depth <= directories.length; depth++) {
    if (!isRealDirectory(join(root, ...directories.slice(0, depth)))) return false;
  }
  return isRealFile(join(root, rel));
}

/**
 * The Python files that exist under `root` and that a workflow command names: tokens ending in `.py`, and modules after
 * `python -m unittest` or `python -m pytest` resolved to `<dotted path>.py` against the project root. A file that is missing, a
 * link, in an ignored directory (the ones discovery skips) or `conftest.py` is dropped; a workflow that is a link, is not valid YAML
 * or has no steps is ignored, and so is any `run:` string that fails to read for whatever reason: a workflow can only add
 * candidates, never stop the scan. Sorted, project-relative with forward slashes.
 */
export function workflowPythonFiles(root: string): string[] {
  const directory = join(root, '.github', 'workflows');
  if (!isRealDirectory(join(root, '.github')) || !isRealDirectory(directory)) return [];
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
      if (!isRealFile(join(directory, name))) continue;
      workflow = parse(readFileSync(join(directory, name), 'utf8'), { logLevel: 'silent' });
    } catch {
      continue;
    }
    for (const run of runStrings(workflow)) {
      try {
        const { files, modules } = pythonTargetsOfRun(run);
        for (const rel of [...files, ...modules.map(module => `${module.replace(/\./g, '/')}.py`)]) {
          if (isCandidateFile(root, rel)) found.add(rel);
        }
      } catch {
        // Whatever is wrong with this command names no file.
      }
    }
  }
  return [...found].sort();
}
