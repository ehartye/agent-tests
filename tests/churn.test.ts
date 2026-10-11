import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { churnOf, commitFileSets } from '../src/churn.ts';
import { makeTree } from './helpers/tree.ts';

const git = (root: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, stdio: 'ignore', windowsHide: true });
};

function repoWithHistory(): string {
  const root = makeTree({ 'src/a.ts': 'v1', 'tests/a.test.ts': 'v1' });
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'one');
  writeFileSync(join(root, 'tests/a.test.ts'), 'v2');
  git(root, 'commit', '-q', '-am', 'two: test only');
  writeFileSync(join(root, 'tests/a.test.ts'), 'v3');
  writeFileSync(join(root, 'src/a.ts'), 'v2');
  git(root, 'commit', '-q', '-am', 'three: both');
  return root;
}

describe('commitFileSets', () => {
  it('returns null outside a git repository', () => {
    expect(commitFileSets(makeTree({ 'a.txt': '' }), 10)).toBeNull();
  });

  it('lists the files each commit touched, newest first', () => {
    const sets = commitFileSets(repoWithHistory(), 10);
    expect(sets?.map(set => [...set].sort())).toEqual([
      ['src/a.ts', 'tests/a.test.ts'],
      ['tests/a.test.ts'],
      ['src/a.ts', 'tests/a.test.ts'],
    ]);
  });

  it('honours the commit limit', () => {
    expect(commitFileSets(repoWithHistory(), 2)).toHaveLength(2);
  });
});

describe('churnOf', () => {
  it('counts edits to the test that never touched the code it covers', () => {
    const sets = commitFileSets(repoWithHistory(), 10);
    expect(churnOf('tests/a.test.ts', ['src/a.ts'], sets)).toEqual({ churn: 1, edits: 3 });
  });

  it('reports unknown churn without subjects or without history', () => {
    const sets = commitFileSets(repoWithHistory(), 10);
    expect(churnOf('tests/a.test.ts', [], sets)).toEqual({ churn: null, edits: 3 });
    expect(churnOf('tests/a.test.ts', ['src/a.ts'], null)).toEqual({ churn: null, edits: null });
  });
});
