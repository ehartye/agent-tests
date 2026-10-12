import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { churnOf, commitFileSets } from '../src/churn.ts';
import { makeTree } from './helpers/tree.ts';

/** The environment with every GIT_* variable removed, so a hook or wrapper cannot redirect git at another repository. */
const isGitVariable = (name: string): boolean => name.toUpperCase().startsWith('GIT_');
const cleanEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([name]) => !isGitVariable(name)));

// commitFileSets runs git with the inherited environment, so scrub it for the whole file and restore it afterwards.
const saved: Array<[string, string]> = [];
beforeAll(() => {
  for (const [name, value] of Object.entries(process.env)) {
    if (isGitVariable(name) && value !== undefined) saved.push([name, value]);
  }
  for (const [name] of saved) delete process.env[name];
});
afterAll(() => {
  for (const [name, value] of saved) process.env[name] = value;
});

const git = (root: string, ...args: string[]): void => {
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', '-c', 'init.defaultBranch=main', ...args],
    { cwd: root, env: cleanEnv(), stdio: 'ignore', windowsHide: true },
  );
};

const write = (root: string, rel: string, text: string): void => {
  writeFileSync(join(root, rel), text);
};

const entries = (set: Map<string, string> | undefined): Array<[string, string]> => [...(set ?? [])].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Commit one creates both files, commit two edits only the test, commit three edits the test and the code. */
function repoWithHistory(): string {
  const root = makeTree({ 'src/a.ts': 'v1', 'tests/a.test.ts': 'v1' });
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'one');
  write(root, 'tests/a.test.ts', 'v2');
  git(root, 'commit', '-q', '-am', 'two: test only');
  write(root, 'tests/a.test.ts', 'v3');
  write(root, 'src/a.ts', 'v2');
  git(root, 'commit', '-q', '-am', 'three: both');
  return root;
}

describe('commitFileSets', () => {
  it('returns null outside a git repository', () => {
    expect(commitFileSets(makeTree({ 'a.txt': '' }), 10)).toBeNull();
  });

  it('returns null for a repository with no commits', () => {
    const root = makeTree({ 'a.txt': '' });
    git(root, 'init', '-q');
    expect(commitFileSets(root, 10)).toBeNull();
  });

  it('returns null for a shallow clone, whose grafted commit lists every file', () => {
    const source = repoWithHistory();
    const parent = makeTree();
    const clone = join(parent, 'clone');
    git(parent, 'clone', '-q', '--depth', '1', pathToFileURL(source).href, clone);
    expect(commitFileSets(clone, 10)).toBeNull();
  });

  it('maps each commit to the files it touched and their status, newest first', () => {
    const sets = commitFileSets(repoWithHistory(), 10);
    expect(sets?.map(entries)).toEqual([
      [
        ['src/a.ts', 'M'],
        ['tests/a.test.ts', 'M'],
      ],
      [['tests/a.test.ts', 'M']],
      [
        ['src/a.ts', 'A'],
        ['tests/a.test.ts', 'A'],
      ],
    ]);
  });

  it('honours the commit limit and keeps the newest commits', () => {
    const sets = commitFileSets(repoWithHistory(), 2);
    expect(sets?.map(entries)).toEqual([
      [
        ['src/a.ts', 'M'],
        ['tests/a.test.ts', 'M'],
      ],
      [['tests/a.test.ts', 'M']],
    ]);
  });

  it('counts the limit in commits that touched this root, with paths relative to it', () => {
    const root = makeTree({ 'pkg/a.ts': 'v1', 'pkg/a.test.ts': 'v1', 'other/x.txt': 'v1' });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'one');
    write(root, 'pkg/a.ts', 'v2');
    git(root, 'commit', '-q', '-am', 'two: pkg code');
    write(root, 'pkg/a.test.ts', 'v2');
    git(root, 'commit', '-q', '-am', 'three: pkg test');
    for (const n of [2, 3, 4, 5]) {
      write(root, 'other/x.txt', `v${n}`);
      git(root, 'commit', '-q', '-am', `outside ${n}`);
    }
    const sets = commitFileSets(join(root, 'pkg'), 3);
    expect(sets?.map(entries)).toEqual([
      [['a.test.ts', 'M']],
      [['a.ts', 'M']],
      [
        ['a.test.ts', 'A'],
        ['a.ts', 'A'],
      ],
    ]);
  });

  it('round-trips a path with spaces and non-ASCII characters', () => {
    const root = makeTree({ 'sub dir/ü é.test.ts': 'v1' });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'one');
    expect(commitFileSets(root, 10)?.map(entries)).toEqual([[['sub dir/ü é.test.ts', 'A']]]);
  });

  it('records a rename under its new path with the status R', () => {
    const root = makeTree({ 'tests/a.test.ts': 'a body long enough to be recognised as the same file\n' });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'one');
    git(root, 'mv', 'tests/a.test.ts', 'tests/b.test.ts');
    git(root, 'commit', '-q', '-m', 'two: rename');
    expect(commitFileSets(root, 10)?.map(entries)).toEqual([[['tests/b.test.ts', 'R']], [['tests/a.test.ts', 'A']]]);
  });
});

describe('churnOf', () => {
  it('counts edits to the test and those that never touched the code it covers, not its creation', () => {
    const sets = commitFileSets(repoWithHistory(), 10);
    // Commit one creates the test (not an edit), commit two edits it alone (churn), commit three edits it with its code.
    expect(churnOf('tests/a.test.ts', ['src/a.ts'], sets)).toEqual({ churn: 1, edits: 2 });
  });

  it('reports unknown churn without subjects or without history', () => {
    const sets = commitFileSets(repoWithHistory(), 10);
    expect(churnOf('tests/a.test.ts', [], sets)).toEqual({ churn: null, edits: 2 });
    expect(churnOf('tests/a.test.ts', ['src/a.ts'], null)).toEqual({ churn: null, edits: null });
  });

  it('does not count an edit as churn when any one of several subjects changed with it', () => {
    const root = makeTree({ 'src/a.ts': 'v1', 'src/b.ts': 'v1', 'tests/a.test.ts': 'v1' });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'one');
    write(root, 'tests/a.test.ts', 'v2');
    write(root, 'src/b.ts', 'v2');
    git(root, 'commit', '-q', '-am', 'two: test and the second subject');
    write(root, 'tests/a.test.ts', 'v3');
    git(root, 'commit', '-q', '-am', 'three: test alone');
    write(root, 'tests/a.test.ts', 'v4');
    write(root, 'src/a.ts', 'v2');
    git(root, 'commit', '-q', '-am', 'four: test and the first subject');
    const sets = commitFileSets(root, 10);
    expect(churnOf('tests/a.test.ts', ['src/a.ts', 'src/b.ts'], sets)).toEqual({ churn: 1, edits: 3 });
  });

  it('does not count a rename as an edit', () => {
    const root = makeTree({ 'src/a.ts': 'v1', 'tests/a.test.ts': 'a body long enough to be recognised as the same file\n' });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'one');
    git(root, 'mv', 'tests/a.test.ts', 'tests/b.test.ts');
    git(root, 'commit', '-q', '-m', 'two: rename');
    write(root, 'tests/b.test.ts', 'a different body\n');
    git(root, 'commit', '-q', '-am', 'three: edit');
    const sets = commitFileSets(root, 10);
    expect(churnOf('tests/b.test.ts', ['src/a.ts'], sets)).toEqual({ churn: 1, edits: 1 });
  });

  it('counts only modifications as edits', () => {
    const sets = [
      new Map([['tests/a.test.ts', 'T']]),
      new Map([['tests/a.test.ts', 'D']]),
      new Map([['tests/a.test.ts', 'C']]),
      new Map([['tests/a.test.ts', 'R']]),
      new Map([['tests/a.test.ts', 'A']]),
      new Map([['tests/a.test.ts', 'M']]),
    ];
    expect(churnOf('tests/a.test.ts', ['src/a.ts'], sets)).toEqual({ churn: 2, edits: 2 });
  });

  it('treats a subject touched with any status as touched', () => {
    const sets = [new Map([['tests/a.test.ts', 'M'], ['src/a.ts', 'D']])];
    expect(churnOf('tests/a.test.ts', ['src/a.ts'], sets)).toEqual({ churn: 0, edits: 1 });
  });
});
