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

describe('detectWorktreeHazards tuning', () => {
  const run = (...text: string[]) => detectWorktreeHazards('t.test.ts', text);

  describe('shared-tmp', () => {
    it('flags a fixed /tmp literal', () => {
      expect(rules(run("const log = '/tmp/server-test.log';"))).toEqual(['worktree.shared-tmp']);
      expect(rules(run('const log = `/tmp/fixed.log`;'))).toEqual(['worktree.shared-tmp']);
    });

    it('accepts per-run unique /tmp paths', () => {
      expect(run("const a = '/tmp/' + id;")).toEqual([]);
      expect(run('const b = `/tmp/${id}`;')).toEqual([]);
      expect(run("const c = '/tmp/' + randomUUID();")).toEqual([]);
    });

    it('accepts a mkdtemp prefix on the previous line or ending in a separator', () => {
      expect(run('const dir = mkdtempSync(', "  join(tmpdir(), 'x-'),", ');')).toEqual([]);
      expect(run('const dir = mkdtempSync(', "  join(tmpdir(), 'x'),", ');')).toEqual([]);
      expect(run("const dir = join(tmpdir(), 'run_');")).toEqual([]);
      expect(run("const dir = join(tmpdir(), 'x-');")).toEqual([]);
    });

    it('still flags a fixed name under tmpdir()', () => {
      expect(rules(run("const dir = join(tmpdir(), 'shared');"))).toEqual(['worktree.shared-tmp']);
    });
  });

  describe('fixed-db-file', () => {
    it('flags a fixed db name case-insensitively', () => {
      expect(rules(run("const db = 'App.SQLite';"))).toEqual(['worktree.fixed-db-file']);
      expect(rules(run("const db = 'data/app.db';"))).toEqual(['worktree.fixed-db-file']);
    });

    it('accepts a db inside a mkdtemp directory, a fixtures path, a bare extension and memory', () => {
      expect(run("const db = join(await mkdtemp(tmp), 'app.sqlite');")).toEqual([]);
      expect(run('const dir = mkdtempSync(prefix);', "const db = join(dir, 'app.sqlite');")).toEqual([]);
      expect(run("const db = 'tests/fixtures/app.sqlite';")).toEqual([]);
      expect(run("expect(extname(file)).toBe('.db');")).toEqual([]);
      expect(run("const db = ':memory:';")).toEqual([]);
    });
  });

  describe('home-dir', () => {
    it('flags reads', () => {
      expect(rules(run('const home = process.env.HOME;'))).toEqual(['worktree.home-dir']);
      expect(rules(run('const home = process.env.USERPROFILE ?? x;'))).toEqual(['worktree.home-dir']);
      expect(rules(run('if (process.env.HOME === x) {}'))).toEqual(['worktree.home-dir']);
      expect(rules(run('const home = homedir();'))).toEqual(['worktree.home-dir']);
    });

    it('accepts assignments and deletes, the isolation fix', () => {
      expect(run('process.env.HOME = tmp;')).toEqual([]);
      expect(run('process.env.USERPROFILE = dir;')).toEqual([]);
      expect(run('delete process.env.HOME;')).toEqual([]);
    });
  });

  describe('fixed-port', () => {
    it('flags compound names, quoted values and bracketed loopback', () => {
      for (const line of [
        'DB_PORT: 5432,',
        'const TEST_PORT = 4000;',
        'defaultPort: 8080,',
        'redisPort: 6379,',
        "process.env.PORT = '3000';",
        "env: { PORT: '3000' },",
        'port: "3000",',
        "const url = 'http://[::1]:3000/x';",
        'server.listen(3000);',
      ]) {
        expect(rules(run(line)), line).toEqual(['worktree.fixed-port']);
      }
    });

    it('accepts port zero, variables, interpolation and look-alike names', () => {
      for (const line of [
        'port: 0,',
        'server.listen(0);',
        'server.listen(PORT);',
        'const url = `http://localhost:${port}/x`;',
        'report: 12345,',
        'passport: 1234,',
        'const viewport = 1280;',
        'import: 12345,',
        "const version = '1.2.3';",
        'timeout: 5000,',
      ]) {
        expect(run(line), line).toEqual([]);
      }
    });
  });

  describe('comments', () => {
    it('ignores block comments, doc comments and trailing comments', () => {
      expect(run('/* localhost:3000 */')).toEqual([]);
      expect(run('/** listen(3000) */')).toEqual([]);
      expect(run('const a = 1; // localhost:3000')).toEqual([]);
      expect(run('const a = 1; /* homedir() */ const b = 2;')).toEqual([]);
    });

    it('ignores the body of a multi-line block even without a leading star', () => {
      expect(run('/*', 'localhost:3000', 'homedir()', '*/')).toEqual([]);
    });

    it('scans code after a block comment ends', () => {
      const found = run('/*', 'note', '*/ homedir()');
      expect(rules(found)).toEqual(['worktree.home-dir']);
      expect(found[0]?.line).toBe(3);
      expect(rules(run('/* c */ const home = homedir();'))).toEqual(['worktree.home-dir']);
    });

    it('does not treat a url or a glob inside a string as a comment', () => {
      expect(rules(run("const url = 'http://localhost:3000/x';"))).toEqual(['worktree.fixed-port']);
      expect(rules(run("const g = 'src/**/*.ts'; const h = homedir();"))).toEqual(['worktree.home-dir']);
      expect(rules(run("const g = 'src/**/*.ts';", 'const h = homedir();'))).toEqual(['worktree.home-dir']);
    });
  });

  describe('other negatives', () => {
    it('accepts .gitattributes, urls containing /home/ and a plain path', () => {
      expect(run("const a = '.gitattributes';")).toEqual([]);
      expect(run("const u = 'https://example.com/home/index';")).toEqual([]);
      expect(run("const p = join(root, 'src', 'a.ts');")).toEqual([]);
    });
  });

  describe('reporting', () => {
    it('reports one-based line numbers', () => {
      const found = run('const a = 1;', 'const b = 2;', 'const home = homedir();');
      expect(found.map(finding => finding.line)).toEqual([3]);
    });

    it('centres the evidence window on the match', () => {
      const line = `const pad = '${'x'.repeat(300)}'; const home = homedir(); const tail = '${'y'.repeat(300)}';`;
      const [finding] = run(line);
      expect(finding?.evidence?.length).toBeLessThanOrEqual(160);
      expect(finding?.evidence).toContain('homedir()');
    });

    it('keeps short evidence whole and trimmed', () => {
      expect(run('    const home = homedir();')[0]?.evidence).toBe('const home = homedir();');
    });
  });
});
