import { describe, expect, it } from 'vitest';
import { detectWorktreeHazards } from '../../src/detectors/worktree.ts';

const rules = (findings: Array<{ rule: string }>): string[] => findings.map(finding => finding.rule).sort();

describe('detectWorktreeHazards', () => {
  const lines = (text: string): string[] => text.split('\n');

  it('flags each hazard once per line', () => {
    const found = detectWorktreeHazards(
      't.test.ts',
      lines(
        [
          "const url = 'http://localhost:3000/x';",
          "const root = 'C:/Users/dev/app';",
          "const log = '/tmp/out.log';",
          "const head = join(cwd, '.git', 'HEAD');",
          'const home = homedir();',
          "const db = 'app.sqlite';",
        ].join('\n'),
      ),
    );
    expect(rules(found)).toEqual([
      'worktree.absolute-path',
      'worktree.dot-git-dir',
      'worktree.fixed-db-file',
      'worktree.fixed-port',
      'worktree.home-dir',
      'worktree.shared-tmp',
    ]);
  });

  it('accepts safe equivalents', () => {
    const found = detectWorktreeHazards(
      't.test.ts',
      lines(["const dir = mkdtempSync(join(tmpdir(), 'x-'));", 'server.listen(0);', "const ignore = '.gitignore';", "const gh = '.github/workflows';"].join('\n')),
    );
    expect(found).toEqual([]);
  });

  it('ignores comment lines', () => {
    expect(detectWorktreeHazards('t.test.ts', ['// uses localhost:3000 in prod', ' * homedir() is shared'])).toEqual([]);
  });
});
