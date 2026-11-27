import { describe, expect, it } from 'vitest';
import { parseTestFile } from '../helpers/parse.ts';
import { detectWorktreeHazards } from '../../src/detectors/worktree.ts';

function hazards(file: string, lines: string[]) {
  let resources;
  try { resources = parseTestFile(file, lines.join('\n')).resourceFindings ?? []; }
  catch { resources = null; }
  return detectWorktreeHazards(file, lines, resources);
}
const rules = (findings: Array<{ rule: string }>): string[] => findings.map(finding => finding.rule).sort();

describe('detectWorktreeHazards', () => {
  const lines = (text: string): string[] => text.split('\n');

  it('flags each hazard once per line', () => {
    const found = hazards(
      't.test.ts',
      lines(
        [
          "import { readFileSync } from 'node:fs'; fetch('http://localhost:3000/x');",
          "readFileSync('C:/shared/app');",
          "readFileSync('/tmp/out.log');",
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
    const found = hazards(
      't.test.ts',
      lines(["const dir = mkdtempSync(join(tmpdir(), 'x-'));", 'server.listen(0);', "const ignore = '.gitignore';", "const gh = '.github/workflows';"].join('\n')),
    );
    expect(found).toEqual([]);
  });

  it('ignores comment lines', () => {
    expect(hazards('t.test.ts', ['// uses localhost:3000 in prod', ' * homedir() is shared'])).toEqual([]);
  });
});

describe('detectWorktreeHazards tuning', () => {
  const run = (...text: string[]) => hazards('t.test.ts', text);

  describe('resource operations', () => {
    const fs = "import { writeFileSync as write, readFileSync as read, existsSync, copyFileSync } from 'node:fs';";
    it('uses the destination argument, cites earlier immutable bindings and respects lexical shadowing', () => {
      const found = run(fs, "const output = 'C:/shared/result';", "write('relative', '/tmp/payload');",
        "function fake(write) { write('/tmp/shadowed', data); }",
        "{ const output = 'relative'; write(output, data); }", 'write(output, data);',
        "const {spawn: launch} = require('node:child_process');", "launch(cmd, [], {", "  cwd: '/tmp/shared'", "});");
      expect(found.map(f => [f.rule, f.line])).toEqual([['worktree.absolute-path', 2], ['worktree.shared-tmp', 9]]);
      expect(found[0].message).toMatch(/write.*line 6/i);
      expect(found[1].message).toMatch(/working directory/i);
    });
    it('ignores fixture data, mutable bindings and a second alias', () => {
      expect(run(fs, "it.each(['C:/escape', '/tmp/escape'])('rejects', verify);",
        "const env = {HOME:'/home/fixture', TMPDIR:'/tmp/fixture'};",
        "const paths = ['http://localhost:5173', 'http://127.0.0.1:3388'];",
        "let target = '/tmp/mutable'; write(target, data);",
        "const first = '/tmp/a'; const second = first; write(second, data);",
        "buildCommand({root:'C:/ignored'});")).toEqual([]);
    });
    it('recognizes named, namespace and CommonJS fs, preserving source and destination roles', () => {
      const found = run(fs, "import * as fsp from 'node:fs/promises';", "const fs = require('fs');",
        "fsp.readFile('/home/fixture/input');", "fs.writeFileSync('/tmp/fixed', 'C:/payload');",
        "copyFileSync('C:/input',", "  '/tmp/copied');");
      expect(found.map(f => f.line)).toEqual([4, 5, 6, 7]);
      expect(found.map(f => f.message.toLowerCase())).toEqual([
        expect.stringContaining('read'), expect.stringContaining('writ'), expect.stringContaining('source'), expect.stringContaining('destination')]);
    });
    it('preserves fixed-name temp joins and absence checks, including mixed uses on the same line', () => {
      const found = run(fs, "import {tmpdir} from 'node:os'; import {join} from 'node:path';",
        "write(join(tmpdir(), 'shared'), data);",
        "expect(existsSync('/tmp/gone')).toBe(false); read('/tmp/needed');",
        "assert.equal(existsSync('/tmp/absent'), false);",
        "expect(existsSync('/tmp/needed')).toBe(true);",
        "read('/tmp/' + id); read(`/tmp/${id}`);");
      expect(found.map(f => f.line)).toEqual([3, 4, 6]);
      expect(found[1].message).toMatch(/read/i);
    });
    it('qualifies exported paths whose use is unknown, and favors a confirmed use of the same line', () => {
      const found = run(fs, "export const unused = '/tmp/exposed';", "export const dest = 'C:/shared/output';", 'write(dest, bytes);',
        "const local = '/tmp/later'; export {local};");
      expect(found.map(f => [f.line, f.confidence])).toEqual([[2, 'possible'], [3, undefined], [5, 'possible']]);
      expect(found[0].message).toMatch(/export|consumer/i);
    });
    it('distinguishes listener and client use and ignores comparison operands, headers and zero', () => {
      const found = run("server.listen(5173);", "fetch('http://localhost:5173');", "server.listen(0);",
        "fetch(url, {headers:{Origin:'http://localhost:4567'}});", "if (url === 'http://localhost:4567') ok();",
        "const url = 'http://[::1]:4356';", "page.goto(url);");
      expect(found.map(f => [f.rule, f.line])).toEqual([1,2,6].map(line => ['worktree.fixed-port', line]));
      expect(found[0].message).toMatch(/bind|listen/i);
      expect(found[1].message).toMatch(/client|connect/i);
      expect(found[1].message).not.toMatch(/bind|collid/i);
    });
    it('ignores locally defined lookalike methods and recognizes server and browser owners', () => {
      const found = run("import {createServer} from 'node:http';",
        "const fixture = {listen() {}, goto() {}};",
        "fixture.listen(5173); fixture.goto('http://localhost:5173');",
        "const server = fixture; server.listen(5273);",
        "const page = {goto() {}}; page.goto('http://localhost:5180');",
        "const service = createServer(); service.listen(5333);",
        "test('opens', async ({page: tab}) => tab.goto('http://localhost:5444'));",
        "const navigation = {goto() {}}; navigation.goto('http://localhost:5555');");
      expect(found.map(f => f.line)).toEqual([6, 7]);
    });
    it('traces exactly one immutable filename binding in a temp join', () => {
      const found = run(fs, "import {tmpdir} from 'node:os'; import {join} from 'node:path';",
        "const filename = 'fixed.txt';", "write(join(tmpdir(), filename), data);",
        "const copy = filename; write(join(tmpdir(), copy), data);",
        "const dest = join(tmpdir(), filename); write(dest, data);",
        "let other = 'mutable.txt'; write(join(tmpdir(), other), data);");
      expect(found.map(f => [f.line, f.rule])).toEqual([[3,'worktree.shared-tmp']]);
      expect(found[0].message).toMatch(/line 4/i);
    });
    it('uses the last effective option and declines earlier keys obscured by a later spread', () => {
      const found = hazards('playwright.config.ts', ["import { spawn } from 'node:child_process';",
        "export default {use:{baseURL:'http://localhost:5111', ...overrides},",
        "webServer:{port:0, ...overrides, port:5888}};",
        "server.listen({port:5173, port:0});", "server.listen({port:4000, ...overrides});",
        "spawn(cmd, {cwd:'/tmp/ignored', cwd:'relative'});",
        "spawn(cmd, {cwd:'/tmp/ignored', ...overrides});", "spawn(cmd, {...overrides, cwd:'/tmp/used'});"]);
      expect(found.map(f => [f.line, f.rule])).toEqual([[3,'worktree.fixed-port'],[8,'worktree.shared-tmp']]);
    });
    it('admits supported CommonJS namespace members and respects CommonJS export shadowing', () => {
      const found = run("const {readFileSync} = require('node:fs').constants;",
        "readFileSync('/tmp/not-fs');", "require('fs').fixture.readFileSync('/tmp/also-not-fs');",
        "const {readFile} = require('fs').promises; readFile('/tmp/real');",
        "function local(module, exports) { module.exports = '/tmp/data'; exports.x = 'C:/data'; }",
        "module.exports = '/tmp/shared';");
      expect(found.map(f => [f.line,f.confidence])).toEqual([[4, undefined],[6,'possible']]);
    });
    it('cites the endpoint option use line in a multiline configuration', () => {
      const found = hazards('playwright.config.ts', ["const port = 5173;", "export default {", "  webServer: {",
        "    port,", "  },", "};"]);
      expect(found).toHaveLength(1);
      expect(found[0].line).toBe(1);
      expect(found[0].message).toMatch(/line 4\b/i);
    });
    it('qualifies directly exported helper return values and ignores nested local callbacks', () => {
      const found = run("export const pathOf = () => '/tmp/first';", "export const other = () => { return 'C:/second'; };",
        "export const third = function() { return '/tmp/third'; };",
        "export const wrapper = () => { const local = () => '/tmp/hidden'; return 42; };",
        "export function outer() { function local() { return '/tmp/hidden'; } return '/tmp/last'; }");
      expect(found.map(f => [f.line,f.confidence])).toEqual([1,2,3,5].map(line => [line, 'possible']));
    });
    it('shares one binding budget across options and their leaf values', () => {
      const found = run("import {spawn} from 'node:child_process';", "const dir = '/tmp/deep';", "const options = {cwd:dir};",
        "spawn(cmd, options);", "const single = {cwd:'/tmp/container'};", "spawn(cmd, single);",
        "const leaf = '/tmp/leaf';", "spawn(cmd, {cwd:leaf});");
      expect(found.map(f => f.line)).toEqual([5, 7]);
    });
    it('requires a recognized Playwright fixture or browser owner for a locally bound page', () => {
      const found = run("import {test as browserTest} from '@playwright/test';", "const fixture = {newPage() {return {goto() {}};}};",
        "const pretend = fixture.newPage(); pretend.goto('http://localhost:5123');",
        "function test(label, body) { body({page:fixture}); }", "test('x', ({page}) => page.goto('http://localhost:5223'));",
        "browserTest('x', ({page:real}) => real.goto('http://localhost:5323'));",
        "browserTest('x', async ({browser}) => { const tab = await browser.newPage(); tab.goto('http://localhost:5423'); });");
      expect(found.map(f => f.line)).toEqual([6, 7]);
    });
    it('marks direct CommonJS helper returns as possible only for the real export', () => {
      const found = run("exports.path = () => '/tmp/first';", "module.exports = function() { return 'C:/second'; };",
        "function local(exports, module) { exports.path = () => '/tmp/hidden'; module.exports = function() {return 'C:/hidden';}; }");
      expect(found.map(f => [f.line,f.confidence])).toEqual([[1,'possible'],[2,'possible']]);
    });
    it('ignores erased type-only exports', () => {
      expect(run("const file = '/tmp/type';", "export type {file};")).toEqual([]);
    });
    it('recognizes a default-export specifier for a previously declared Playwright config', () => {
      const found = hazards('playwright.config.ts', ["const options = {webServer:{port:5173}};", "export {options as default};"]);
      expect(found.map(f => [f.line, f.rule])).toEqual([[1,'worktree.fixed-port']]);
    });
    it('retains a possible helper result through a named local value export', () => {
      const found = run("const fileOf = () => '/tmp/exported';", "export {fileOf};", "const unused = () => '/tmp/hidden';");
      expect(found.map(f => [f.line, f.confidence])).toEqual([[1,'possible']]);
    });
    it('keeps namespace-local path and helper bindings inside their module block', () => {
      const found = run("import {readFileSync as read} from 'node:fs';", "const path = '/tmp/outer';",
        "namespace Inner { const read = () => {}; const path = 'C:/shadowed'; read(path); }",
        "read(path);");
      expect(found.map(f => [f.rule, f.line])).toEqual([['worktree.shared-tmp',2]]);
    });
    it('follows transparent syntax around negative existence checks', () => {
      const found = run("import {existsSync} from 'node:fs';", "expect((existsSync('/tmp/absent'))).not.toBeTruthy();",
        "expect(existsSync('/tmp/absent') as boolean).toBe(false);", "assert.equal((existsSync('/tmp/absent')), false);",
        "expect((existsSync('/tmp/present'))).toBe(true);");
      expect(found.map(f => f.line)).toEqual([5]);
    });
    it('recognizes only exported Playwright endpoint configuration', () => {
      const found = hazards('playwright.config.ts', ["import {defineConfig} from '@playwright/test';",
        "const fixture = {use:{baseURL:'http://localhost:5666'}, webServer:{port:5888}};",
        "export default defineConfig({use:{baseURL:'http://localhost:5111'},", "webServer:{port:5222}});"]);
      expect(found.map(f => f.line)).toEqual([3,4]);
      expect(found[0].message).toMatch(/client/i);
      expect(found[1].message).toMatch(/server/i);
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

    it.each([
      ["const runDir = mkdtempSync(join(tmpdir(), 'run-'));"],
      ["const runDir = await mkdtemp(join(tmpdir(), 'run-'));"],
      ["const runDir = fs.mkdtempSync(join(os.tmpdir(), 'run-'));"],
      ["const runDir: string = realpathSync(mkdtempSync(join(tmpdir(), 'run-')));"],
      ["let runDir;\nrunDir = await fsp.mkdtemp(prefix);"],
    ])('is quiet for a file joined to a directory made by mkdtemp: %s', setup => {
      const between = ['const other = 1;', 'const more = 2;'];
      const code = [...setup.split('\n'), ...between];
      expect(run(...code, "const db = new DatabaseSync(join(runDir, 'run.sqlite'));")).toEqual([]);
      expect(run(...code, "const db = path.join(runDir, 'sub', 'run.db');")).toEqual([]);
      expect(run(...code, 'const db = `${runDir}/run.sqlite`;')).toEqual([]);
    });

    it.each([
      ['a made directory named in a string literal', 'tmp', "const db = new Database('tmp.sqlite');"],
      ['a made directory used for another argument, not joined to the file', 'tmp', "copyFileSync(join(tmp, 'seed'), 'shared.sqlite');"],
      ['a made directory whose name is the first segment of a fixed path', 'data', "const db = 'data/app.db';"],
      ['a made directory joined to a different call than the file', 'tmp', "const db = [join(tmp, 'a'), join(root, 'x.sqlite')];"],
      ['a made directory only closing a nested join', 'tmp', "const db = join(join(tmp, 'a'), 'x.sqlite');"],
    ])('stays flagged for %s', (_label, made, line) => {
      const setup = [`const ${made} = mkdtempSync(join(tmpdir(), 'run-'));`, 'const a = 1;', 'const b = 2;'];
      expect(rules(run(...setup, line))).toEqual(['worktree.fixed-db-file']);
    });

    it('goes quiet only when the made directory is an argument of the join that holds the file name', () => {
      const setup = ["const tmp = mkdtempSync(join(tmpdir(), 'run-'));", 'const a = 1;', 'const b = 2;'];
      expect(run(...setup, "const db = join(tmp, 'x.sqlite');")).toEqual([]);
      expect(run(...setup, "const db = path.join(tmp, 'sub', 'x.sqlite');")).toEqual([]);
      expect(run(...setup, "const db = resolve(root, tmp, 'x.db');")).toEqual([]);
      const [mixed] = run(...setup, "const db = join(dir, tmp, 'x.sqlite');");
      expect(mixed).toBeUndefined();
    });

    it('keeps flagging fixed names, whatever the file made', () => {
      const made = ["const runDir = mkdtempSync(join(tmpdir(), 'run-'));", 'const a = 1;', 'const b = 2;'];
      expect(rules(run(...made, "const db = 'test.sqlite';"))).toEqual(['worktree.fixed-db-file']);
      expect(rules(run(...made, "const db = 'data/app.db';"))).toEqual(['worktree.fixed-db-file']);
      expect(run(...made, "const db = 'test.sqlite';")[0]?.note).toBeUndefined();
    });

    it('does not trust an identifier that is only used, not assigned from mkdtemp', () => {
      const found = run("const dir = join(root, 'out');", 'const a = 1;', 'const b = 2;', "const db = join(dir, 'x.sqlite');");
      expect(found.map(finding => [finding.rule, finding.line])).toEqual([['worktree.fixed-db-file', 4]]);
      expect(found[0]?.note).toMatch(/^Path uniqueness unresolved:/);
    });

    it('qualifies a finding that joins an untraced identifier with a note naming it', () => {
      const [parameter] = run('function open(dir: string) {', "  return new DatabaseSync(join(dir, 'x.sqlite'));", '}');
      expect(parameter?.rule).toBe('worktree.fixed-db-file');
      expect(parameter?.note).toMatch(/^Path uniqueness unresolved:/);
      expect(parameter?.note).toContain('dir');
      const [dotted] = run("const db = path.resolve(opts.dir, 'x.db');");
      expect(dotted?.note).toMatch(/^Path uniqueness unresolved:.*opts\.dir/);
    });

    it('words the note as no earlier assignment, since only earlier lines are traced', () => {
      const found = run(
        'async function open(dir: string) {',
        "  return new DatabaseSync(join(dir, 'x.sqlite'));",
        '}',
        'beforeEach(async () => {',
        "  dir = await mkdtemp(join(tmpdir(), 'run-'));",
        '});',
      );
      expect(found).toHaveLength(1);
      expect(found[0]?.note).toMatch(/^Path uniqueness unresolved: dir has no earlier assignment from mkdtemp in this file/);
      expect(found[0]?.note).not.toContain('is not assigned');
    });

    it('names an untraced identifier even when the file made some other directory', () => {
      const [finding] = run("const runDir = mkdtempSync(join(tmpdir(), 'run-'));", 'const a = 1;', 'const b = 2;', "const db = join(dir, 'x.sqlite');");
      expect(finding?.note).toMatch(/^Path uniqueness unresolved:.*\bdir\b/);
    });

    it('adds no note when no identifier is joined', () => {
      expect(run("const db = join(tmpdir(), 'x.sqlite');")[0]?.note).toBeUndefined();
      expect(run("const db = join(__dirname, 'x.sqlite');")[0]?.note).toBeUndefined();
      expect(run("const db = 'App.SQLite';")[0]?.note).toBeUndefined();
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
    it('ignores declarations and fixture values without an endpoint operation', () => {
      for (const line of [
        'DB_PORT: 5432,',
        'const TEST_PORT = 4000;',
        'defaultPort: 8080,',
        'redisPort: 6379,',
        "process.env.PORT = '3000';",
        "env: { PORT: '3000' },",
        'port: "3000",',
        "const url = 'http://[::1]:3000/x';",
      ]) {
        expect(run(line), line).toEqual([]);
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
      expect(rules(run("fetch('http://localhost:3000/x');"))).toEqual(['worktree.fixed-port']);
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
  const run = (...text: string[]) => hazards('t.test.ts', text);

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
