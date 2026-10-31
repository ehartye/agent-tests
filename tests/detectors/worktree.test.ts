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

    it('does not open a block comment from a slash-star inside a regex literal', () => {
      const found = run("s.replace(/\\/*$/, '');", 'server.listen(3000);', 'const home = homedir();');
      expect(found.map(finding => [finding.rule, finding.line])).toEqual([
        ['worktree.fixed-port', 2],
        ['worktree.home-dir', 3],
      ]);
    });

    it('still skips a genuine multi-line block comment', () => {
      expect(run("s.replace(/\\/*$/, '');", '/* note', 'server.listen(3000);', 'const home = homedir(); */', 'const ok = 1;')).toEqual([]);
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

describe('detectWorktreeHazards process.cwd() and timestamp rules', () => {
  const run = (...text: string[]) => detectWorktreeHazards('t.test.ts', text);

  describe('timestamp-tmp-path', () => {
    it('flags a name built from a timestamp under tmpdir() or /tmp', () => {
      expect(rules(run('const db = join(tmpdir(), `x-${Date.now()}.db`);'))).toEqual(['worktree.timestamp-tmp-path']);
      expect(rules(run("const moved = join(tmpdir(), 'sprite-set-moved-' + Date.now());"))).toEqual(['worktree.timestamp-tmp-path']);
      expect(rules(run('const p = join(os.tmpdir(), `ref-${Date.now()}.png`);'))).toEqual(['worktree.timestamp-tmp-path']);
      expect(rules(run('const p = `/tmp/run-${process.pid}.log`;'))).toEqual(['worktree.timestamp-tmp-path']);
    });

    it('flags a separator-ended name joined to a timestamp', () => {
      expect(rules(run("const dir = 'name-' + Date.now();"))).toEqual(['worktree.timestamp-tmp-path']);
    });

    it('accepts a path built from a mkdtemp directory', () => {
      expect(run('const dir = mkdtempSync(join(tmpdir(), `x-${Date.now()}-`));')).toEqual([]);
      expect(run('const dir = mkdtempSync(', '  join(tmpdir(), `x-${Date.now()}-`),', ');')).toEqual([]);
      expect(run("const dir = mkdtempSync(join(tmpdir(), 'x-'));", "const db = join(dir, 'y-' + Date.now());")).toEqual([]);
      expect(run("const dir = mkdtempSync(join(tmpdir(), 'x-'));", 'const other = 1;', "const db = join(dir, 'y-' + Date.now());")).toEqual([]);
    });

    it('accepts a name that also carries a random part', () => {
      expect(run('const db = join(tmpdir(), `t-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);')).toEqual([]);
      expect(run('const db = join(tmpdir(), `t-${randomUUID()}.db`);')).toEqual([]);
    });

    it('accepts a clock read that is not a name', () => {
      expect(run('const started = Date.now();')).toEqual([]);
      expect(run('expect(Date.now() - started).toBeLessThan(3000);')).toEqual([]);
      expect(run('const dir = join(tmpdir(), name);')).toEqual([]);
    });

    it('quotes the line as evidence', () => {
      const [finding] = run('const db = join(tmpdir(), `x-${Date.now()}.db`);');
      expect(finding?.evidence).toBe('const db = join(tmpdir(), `x-${Date.now()}.db`);');
    });
  });

  describe('cwd-write', () => {
    it('flags writes under the working directory', () => {
      expect(rules(run("writeFileSync(join(process.cwd(), 'out.txt'), 'x');"))).toEqual(['worktree.cwd-write']);
      expect(rules(run("mkdirSync(join(process.cwd(), 'assets', 'tmp'), { recursive: true });"))).toEqual(['worktree.cwd-write']);
      expect(rules(run("rmSync(path.resolve(process.cwd(), 'out'), { recursive: true });"))).toEqual(['worktree.cwd-write']);
    });

    it('flags a copy or move only when the working directory is the destination', () => {
      expect(rules(run("copyFileSync(join(src, 'a.txt'), join(process.cwd(), 'a.txt'));"))).toEqual(['worktree.cwd-write']);
      expect(rules(run("copyFileSync(join(process.cwd(), 'scripts', f), join(root, f));"))).toEqual(['worktree.cwd-locate']);
      expect(rules(run("writeFileSync(file, `x${process.cwd()}`);"))).toEqual([]);
    });

    it('accepts a working directory that is only passed along or read', () => {
      expect(run("writeFileSync(join(dir, 'out.txt'), 'x');")).toEqual([]);
      expect(run('const child = spawn(cmd, args, { cwd: process.cwd() });')).toEqual([]);
    });
  });

  describe('cwd-locate', () => {
    it('flags repository files located from the working directory', () => {
      expect(rules(run("const cli = join(process.cwd(), 'scripts', 'x.mjs');"))).toEqual(['worktree.cwd-locate']);
      expect(rules(run("const cli = path.resolve(process.cwd(), 'scripts/sprite.js');"))).toEqual(['worktree.cwd-locate']);
      expect(rules(run("const cli = process.cwd() + '/scripts/sprite.js';"))).toEqual(['worktree.cwd-locate']);
      expect(rules(run("const cli = resolve('scripts/sprite.js');"))).toEqual(['worktree.cwd-locate']);
    });

    it('leaves a write to cwd-write and accepts paths from the test file', () => {
      expect(rules(run("writeFileSync(join(process.cwd(), 'out.txt'), 'x');"))).not.toContain('worktree.cwd-locate');
      expect(run("const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'x.mjs');")).toEqual([]);
      expect(run('const cwd = process.cwd();')).toEqual([]);
    });
  });
});
