/** @lane merge @subject src/scan.ts @subject src/discover.ts @subject src/python/subjects.ts @subject src/python/workflow.ts @subject src/detectors/wiring.ts @subject src/cli.ts @subject src/schema.ts */
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { auditArtifact } from '../src/audit-output.ts';
import { loadPythonParser } from '../src/python/parser.ts';
import { pythonTargetsOfRun } from '../src/python/workflow.ts';
import { renderMarkdown } from '../src/report.ts';
import { scan, scanProject } from '../src/scan.ts';
import { EvidenceReport, type TestFileRecord } from '../src/schema.ts';
import { makeTree } from './helpers/tree.ts';

// Count parser loads without changing them, so a JavaScript-only scan can be shown never to load the Python parser.
vi.mock('../src/python/parser.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/python/parser.ts')>();
  return { ...actual, loadPythonParser: vi.fn(actual.loadPythonParser) };
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'python-mixed');
const cli = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'scripts/tests.mjs'), ...args], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
const ZERO_COUNT = '- No supported runner detected; a zero test count does not prove the project has no tests.';
const ARTIFACT_WARNING = 'No supported runner detected; a zero static test count does not prove that the project has no tests.';
const py = (...lines: string[]) => `${lines.join('\n')}\n`;
const FACADE_NOTE = 'imports through a package __init__ may reach other modules';
const OPAQUE_NOTE = 'some Python tests are registered in ways the scan cannot read (load_tests, an imported test class or a non-literal import)';
const CONFIG_NOTE = 'custom python_files configured; discovery used defaults';
const coverageOf = (evidence: EvidenceReport): string[] =>
  evidence.projectFindings.filter(finding => ['wiring.inventory-incomplete', 'wiring.uncovered-critical'].includes(finding.rule)).map(finding => `${finding.rule}@${finding.file}`).sort();

describe('the python-mixed fixture, through the CLI', () => {
  const scanned = cli('scan', '--root', FIXTURE);
  const evidence = JSON.parse(scanned.stdout) as EvidenceReport;
  const expected = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8')) as {
    runner: string; testFiles: string[]; records: Record<string, Record<string, unknown>>; opaque: Record<string, unknown>; laneMismatch: string[]; inventory: unknown; coverage: string[];
  };
  const byFile = new Map(evidence.files.map(file => [file.file, file]));

  it('lists name-matched Python tests beside the JavaScript one, never conftest.py or the venv file, and survives the syntax error', () => {
    expect(scanned.status, scanned.stderr).toBe(0);
    expect(EvidenceReport.safeParse(evidence).success).toBe(true);
    expect(evidence.runner).toBe(expected.runner);
    expect(evidence.files.map(file => file.file)).toEqual(expected.testFiles);
    expect('language' in byFile.get('web/app.test.ts')!).toBe(false);
  });

  it('counts tests and assertions, names the assertionless test, resolves direct subjects and reads lanes', () => {
    // expected.json names the fields to compare per file, so later work can extend it without disturbing these.
    const project = (record: TestFileRecord, fields: string[]) => Object.fromEntries(fields.map(field => [field, (record as unknown as Record<string, unknown>)[field]]));
    expect(Object.fromEntries(Object.entries(expected.records).map(([file, fields]) => [file, project(byFile.get(file)!, Object.keys(fields))]))).toEqual(expected.records);
    expect(evidence.files.filter(file => file.findings.some(finding => finding.rule === 'wiring.lane-mismatch')).map(file => file.file)).toEqual(expected.laneMismatch);
  });

  it('names the files whose tests the reader cannot fully see, with the line and what is opaque', () => {
    const opaque = Object.fromEntries(evidence.files.flatMap(file => {
      const found = file.findings.filter(finding => finding.rule === 'wiring.opaque-test-registration');
      return found.length > 0 ? [[file.file, found.map(finding => ({ line: finding.line, evidence: finding.evidence }))]] : [];
    }));
    expect(opaque).toEqual(expected.opaque);
  });

  it('promotes Python to supported with its runner, keeps Go unsupported and reports only Go coverage as unknown', () => {
    expect(evidence.inventory).toEqual(expected.inventory);
    expect(coverageOf(evidence)).toEqual(expected.coverage);
  });

  it('shows the supported language and its runner in the report header and the unparsed file as unreadable', () => {
    const markdown = cli('report', '--root', FIXTURE).stdout;
    expect(markdown).toContain('- Languages: JavaScript (vitest, 1 files), Go (detected-unsupported, 1 files), Python (pytest, 9 files)');
    const incomplete = markdown.split('\n').find(line => line.startsWith('- Inventory incomplete:')) ?? '';
    expect(incomplete).toContain('Go detected but not inventoried.');
    expect(incomplete).toContain(FACADE_NOTE);
    expect(incomplete).toContain(OPAQUE_NOTE);
    expect(markdown).toMatch(/\| tests\/test_scheduled\.py \| critical \| scheduled \|/);
    // A count marked +? has opaque registration; a file with none shows its plain count.
    expect(markdown).toMatch(/\| tests\/test_dynamic\.py \| critical \| - \| 2\+\? \| 2 \|/);
    expect(markdown).toMatch(/\| tests\/test_loadtests\.py \| critical \| - \| 1\+\? \| 1 \|/);
    expect(markdown).toMatch(/\| tests\/test_facade\.py \| untiered \| - \| 1 \| 1 \|/);
    expect(markdown).toContain('- Unparsed files: 1.');
  });
});

describe('Python tags, lanes and subjects', () => {
  const tree = {
    'conftest.py': '',
    'top.py': 'x = 1\n',
    'pkg/__init__.py': '',
    'pkg/m.py': 'x = 1\n',
    'pkg/m2.py': 'x = 1\n',
    'pkg/sub/__init__.py': 'VALUE = 1\n',
    'pkg/sub/leaf.py': 'x = 1\n',
    'src/lib/__init__.py': '',
    'src/lib/tool.py': 'x = 1\n',
    'src/lib/other.py': 'x = 1\n',
    'tests/helpers.py': 'h = 1\n',
    'pkg/test_rel.py': py('from .m import x', 'from . import m2', 'from .sub import leaf', 'from .. import top', '', 'def test_r():', '    assert 1'),
    'tests/test_abs.py': py(
      'import os, json', 'import requests', 'import pkg.m', 'from pkg import m2', 'from pkg.sub import VALUE', 'from lib import tool',
      'from tests.helpers import h', 'from conftest import y', 'import importlib', '',
      'def test_a():', '    assert importlib.import_module("lib.other")', '    assert importlib.import_module(".m", "pkg")',
    ),
    'tests/test_lane_comment.py': py('# @lane merge', '# @risk standard', '# @subject top.py', '# @subject tests/helpers.py', 'import pytest', 'pytestmark = pytest.mark.scheduled', '', 'def test_x():', '    assert 1'),
    'tests/test_lane_module.py': py('import pytest', 'pytestmark = [pytest.mark.slow, pytest.mark.release]', '', 'def test_x():', '    assert 1'),
    'tests/test_lane_agree.py': py('import pytest', '', '@pytest.mark.edit', 'def test_x():', '    assert 1', '', '@pytest.mark.edit', 'class TestY:', '    def test_y(self):', '        assert 1'),
    'tests/test_lane_mixed.py': py('import pytest', '', '@pytest.mark.merge', 'def test_x():', '    assert 1', '', 'def test_y():', '    assert 1'),
    'tests/test_lane_custom.py': py('import pytest', '', '@pytest.mark.slow', 'def test_x():', '    assert 1'),
  };

  it('resolves direct project imports only and applies the lane precedence', async () => {
    const evidence = await scanProject(makeTree(tree), { commitLimit: 1 });
    expect(EvidenceReport.safeParse(evidence).success).toBe(true);
    const seen = Object.fromEntries(evidence.files.map(file => [file.file, { language: file.language, lane: file.tags.lane ?? null, subjects: file.subjects }]));
    const python = (lane: string | null, subjects: string[]) => ({ language: 'python', lane, subjects });
    expect(seen).toEqual({
      // relative imports resolve against the test file's package directory by level; a submodule import names the submodule, not its package
      'pkg/test_rel.py': python(null, ['pkg/m.py', 'pkg/m2.py', 'pkg/sub/leaf.py', 'top.py']),
      // project root, then src/; stdlib, third-party, test, support and non-literal-relative imports resolve to nothing
      'tests/test_abs.py': python(null, ['pkg/m.py', 'pkg/m2.py', 'pkg/sub/__init__.py', 'src/lib/other.py', 'src/lib/tool.py']),
      // a leading-comment lane beats pytestmark; @subject adds declared subjects but never a support file
      'tests/test_lane_comment.py': python('merge', ['top.py']),
      'tests/test_lane_module.py': python('release', []),
      'tests/test_lane_agree.py': python('edit', []),
      'tests/test_lane_mixed.py': python(null, []),
      'tests/test_lane_custom.py': python(null, []),
    });
    expect(evidence.files.find(file => file.file === 'tests/test_lane_comment.py')!.tags).toEqual({ lane: 'merge', risk: 'standard', subjects: ['top.py', 'tests/helpers.py'] });
  });
});

describe('a Python-only repo', () => {
  const test = py('def test_x():', '    assert 1');
  const cases: Array<{ name: string; files: Record<string, string>; runner: string }> = [
    { name: 'importing pytest', files: { 'tests/test_x.py': py('import pytest', '', 'def test_x():', '    assert 1') }, runner: 'pytest' },
    { name: 'importing unittest only', files: { 'tests/test_x.py': py('import unittest', '', 'class T(unittest.TestCase):', '    def test_x(self):', '        self.assertTrue(1)') }, runner: 'unittest' },
    { name: 'a conftest.py', files: { 'tests/test_x.py': test, 'tests/conftest.py': '' }, runner: 'pytest' },
    { name: 'a pytest.ini', files: { 'tests/test_x.py': test, 'pytest.ini': '[pytest]\n' }, runner: 'pytest' },
    { name: 'a tox.ini with a pytest section', files: { 'tests/test_x.py': test, 'tox.ini': '[testenv]\n[pytest]\naddopts = -q\n' }, runner: 'pytest' },
    { name: 'a setup.cfg with a tool:pytest section', files: { 'tests/test_x.py': test, 'setup.cfg': '[tool:pytest]\naddopts = -q\n' }, runner: 'pytest' },
    { name: 'a pyproject.toml mentioning pytest', files: { 'tests/test_x.py': test, 'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "-q"\n' }, runner: 'pytest' },
    { name: 'a tox.ini without a pytest section', files: { 'tests/test_x.py': test, 'tox.ini': '[testenv]\ncommands = python -m unittest\n' }, runner: 'unknown' },
    { name: 'nothing that names a runner', files: { 'tests/test_x.py': test }, runner: 'unknown' },
  ];

  it.each(cases)('is inventoried and complete with $name', async ({ files, runner }) => {
    const evidence = await scanProject(makeTree(files), { commitLimit: 1 });
    expect(evidence.runner).toBe('unknown');
    expect(evidence.files.map(file => file.file)).toEqual(['tests/test_x.py']);
    expect(evidence.inventory).toEqual({
      complete: true,
      languages: [{ language: 'JavaScript', runner: 'unknown', files: 0, status: 'supported' }, { language: 'Python', runner, files: 1, status: 'supported' }],
      notes: [],
    });
    const markdown = renderMarkdown(evidence);
    expect(markdown).toContain('tests/test_x.py');
    expect(markdown).toContain(`Python (${runner}, 1 files)`);
    expect(markdown).not.toContain(ZERO_COUNT);
    expect(markdown).not.toContain('- Inventory incomplete:');
    // The saved artifact keeps its unknown-runner warning only when Python's runner is unknown too.
    expect(auditArtifact(evidence, 'report').includes(ARTIFACT_WARNING)).toBe(runner === 'unknown');
    expect(auditArtifact(evidence, 'scan').includes(ARTIFACT_WARNING)).toBe(runner === 'unknown');
  });

  it('counts a Python file that does not parse and flags it unparsed', async () => {
    const evidence = await scanProject(makeTree({ 'tests/test_bad.py': 'def test_bad(:\n', 'tests/test_ok.py': test }), { commitLimit: 1 });
    expect(evidence.files.map(file => [file.file, file.flags])).toEqual([['tests/test_bad.py', ['unparsed']], ['tests/test_ok.py', []]]);
    expect(evidence.inventory!.languages[1]).toMatchObject({ language: 'Python', files: 2, status: 'supported' });
  });
});

describe('a JavaScript-only repo', () => {
  const FIXTURES = join(ROOT, 'tests', 'fixtures');

  it('gets the same report from scanProject as from scan, with no inventory or language key, and never loads the Python parser', async () => {
    vi.mocked(loadPythonParser).mockClear();
    for (const name of ['clean', 'bloated']) {
      const evidence = await scanProject(join(FIXTURES, name), { commitLimit: 1 });
      expect(JSON.stringify(evidence)).toBe(JSON.stringify(scan(join(FIXTURES, name), { commitLimit: 1 })));
      expect('inventory' in evidence).toBe(false);
      expect(evidence.files.some(file => 'language' in file)).toBe(false);
    }
    expect(loadPythonParser).not.toHaveBeenCalled();
    await scanProject(makeTree({ 'tests/test_x.py': 'def test_x():\n    assert 1\n' }), { commitLimit: 1 });
    expect(loadPythonParser).toHaveBeenCalledTimes(1);
  });
});

describe('workflow-named Python files', () => {
  it.each([
    { run: 'python -m unittest a.b', files: [], modules: ['a.b'] },
    { run: 'python3 -m pytest tests/x.py -q', files: ['tests/x.py'], modules: [] },
    { run: 'python scripts/check.py --flag', files: ['scripts/check.py'], modules: [] },
    { run: 'pytest tests/a.py', files: ['tests/a.py'], modules: [] },
    { run: 'py -m unittest pkg.one pkg.two', files: [], modules: ['pkg.one', 'pkg.two'] },
    { run: 'python3.12 -X dev -m unittest -v pkg.mod', files: [], modules: ['pkg.mod'] },
    { run: 'python -m unittest geometry_check', files: [], modules: ['geometry_check'] },
    { run: 'python -m unittest discover -s tests -p "test_*.py"', files: [], modules: [] },
    { run: 'python -m pytest pkg.mod', files: [], modules: ['pkg.mod'] },
    { run: 'pip install -r requirements.txt\npython -m unittest checks.a checks.b && python tools/gen.py; echo done', files: ['tools/gen.py'], modules: ['checks.a', 'checks.b'] },
    { run: 'python -m unittest \\\n  pkg.a', files: [], modules: ['pkg.a'] },
    { run: 'python "./scripts\\check.py" ./scripts/check.py', files: ['scripts/check.py'], modules: [] },
    { run: 'python ../outside.py /abs/x.py C:/x.py tests/*.py $SCRIPT.py --cov=src/a.py -x.py', files: [], modules: [] },
    { run: 'npm test', files: [], modules: [] },
  ])('reads $files and $modules from: $run', ({ run, files, modules }) => {
    expect(pythonTargetsOfRun(run)).toEqual({ files, modules });
  });

  const WORKFLOW = (...runs: string[]) => `on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n${runs.map(run => `      - run: ${run}\n`).join('')}`;
  const SUITE = py('import unittest', '', 'class Suite(unittest.TestCase):', '    def test_it(self):', '        self.assertTrue(1)');
  const SCRIPT = py('def build():', '    return 1', '', 'if __name__ == "__main__":', '    build()');
  const cases: Array<{ name: string; files: Record<string, string>; inventoried: string[] }> = [
    { name: 'a unittest module named by a workflow command', files: { 'checks/suite.py': SUITE, '.github/workflows/ci.yml': WORKFLOW('python -m unittest checks.suite') }, inventoried: ['checks/suite.py'] },
    { name: 'a unittest script named by its file path in a .yaml workflow', files: { 'tools/suite.py': SUITE, '.github/workflows/ci.yaml': WORKFLOW('python tools/suite.py') }, inventoried: ['tools/suite.py'] },
    { name: 'a pytest-style file named by a workflow', files: { 'checks/chk.py': py('def test_a():', '    assert 1'), '.github/workflows/ci.yml': WORKFLOW('python -m pytest checks/chk.py') }, inventoried: ['checks/chk.py'] },
    { name: 'a script with no tests, which is not counted', files: { 'tools/gen.py': SCRIPT, '.github/workflows/ci.yml': WORKFLOW('python tools/gen.py') }, inventoried: [] },
    { name: 'a named file with a syntax error, which cannot show tests and is not counted', files: { 'tools/bad.py': 'def test_x(:\n', '.github/workflows/ci.yml': WORKFLOW('python tools/bad.py') }, inventoried: [] },
    { name: 'a named file that is missing', files: { '.github/workflows/ci.yml': WORKFLOW('python tools/nothing.py', 'python -m unittest no.such') }, inventoried: [] },
    { name: 'a named file in an ignored directory', files: { 'venv/lib/suite.py': SUITE, 'build/suite.py': SUITE, '.github/workflows/ci.yml': WORKFLOW('python venv/lib/suite.py', 'python build/suite.py') }, inventoried: [] },
    { name: 'a named conftest.py, which is support and never a test', files: { 'tests/conftest.py': py('def test_hook():', '    assert 1'), '.github/workflows/ci.yml': WORKFLOW('python tests/conftest.py') }, inventoried: [] },
    { name: 'a name-matched test that a workflow also names, counted once', files: { 'tests/test_a.py': SUITE, '.github/workflows/ci.yml': WORKFLOW('python -m unittest tests.test_a') }, inventoried: ['tests/test_a.py'] },
    {
      name: 'a malformed workflow, a workflow without jobs and steps without run, beside a good workflow',
      files: {
        'checks/suite.py': SUITE,
        '.github/workflows/broken.yml': 'jobs: [unclosed\n  - : :\n',
        '.github/workflows/list.yml': '- just\n- a list\n',
        '.github/workflows/nojobs.yml': 'name: x\njobs: nope\n',
        '.github/workflows/steps.yml': 'jobs:\n  a:\n    steps: oops\n  b:\n    steps:\n      - uses: x/y@v1\n      - name: no run\n      - run: 12\n',
        '.github/workflows/good.yml': WORKFLOW('python -m unittest checks.suite'),
      },
      inventoried: ['checks/suite.py'],
    },
  ];

  it.each(cases)('inventories $inventoried for $name', async ({ files, inventoried }) => {
    const evidence = await scanProject(makeTree(files), { commitLimit: 1 });
    expect(evidence.files.map(file => file.file)).toEqual(inventoried);
    expect(evidence.files.every(file => file.language === 'python' && file.tests === 1)).toBe(true);
    expect('inventory' in evidence).toBe(inventoried.length > 0);
    expect(evidence.inventory?.languages.find(entry => entry.language === 'Python')?.files ?? 0).toBe(inventoried.length);
  });

  it('refuses a workflow-named file without a parser, like a name-matched one, since it may be a test', () => {
    expect(() => scan(makeTree({ 'checks/suite.py': SUITE, '.github/workflows/ci.yml': WORKFLOW('python -m unittest checks.suite') }), { commitLimit: 1 })).toThrow(/scanProject/);
  });
});

describe('ancestor package roots and facade imports', () => {
  const t = (...body: string[]) => py(...body, '', 'def test_x():', '    assert 1');
  const cases: Array<{ name: string; files: Record<string, string>; test: string; subjects: string[]; facades: string[] | null }> = [
    { name: 'an ancestor directory is a package root', files: { 'backend/app/svc.py': '', 'backend/tests/test_a.py': t('from app import svc') }, test: 'backend/tests/test_a.py', subjects: ['backend/app/svc.py'], facades: null },
    { name: 'an ancestor src/ is a package root', files: { 'svc/src/lib/m.py': '', 'svc/tests/test_a.py': t('import lib.m') }, test: 'svc/tests/test_a.py', subjects: ['svc/src/lib/m.py'], facades: null },
    { name: 'the project root wins over an ancestor', files: { 'lib/m.py': '', 'svc/lib/m.py': '', 'svc/tests/test_a.py': t('import lib.m') }, test: 'svc/tests/test_a.py', subjects: ['lib/m.py'], facades: null },
    { name: 'the project src/ wins over an ancestor', files: { 'src/lib/m.py': '', 'svc/lib/m.py': '', 'svc/tests/test_a.py': t('import lib.m') }, test: 'svc/tests/test_a.py', subjects: ['src/lib/m.py'], facades: null },
    { name: 'a nearer ancestor wins over a farther one', files: { 'svc/lib/m.py': '', 'svc/pkgs/lib/m.py': '', 'svc/pkgs/tests/test_a.py': t('import lib.m') }, test: 'svc/pkgs/tests/test_a.py', subjects: ['svc/pkgs/lib/m.py'], facades: null },
    { name: 'a module that no root resolves is ignored', files: { 'other/lib/m.py': '', 'svc/tests/test_a.py': t('import lib.m', 'import requests') }, test: 'svc/tests/test_a.py', subjects: [], facades: null },
    { name: 'a name that is not a submodule goes through the package __init__', files: { 'pkg/__init__.py': 'value = 1\n', 'tests/test_a.py': t('from pkg import value') }, test: 'tests/test_a.py', subjects: ['pkg/__init__.py'], facades: ['pkg'] },
    { name: 'a plain import of a package goes through its __init__', files: { 'pkg/__init__.py': '', 'tests/test_a.py': t('import pkg') }, test: 'tests/test_a.py', subjects: ['pkg/__init__.py'], facades: ['pkg'] },
    { name: 'a literal dynamic import of a package goes through its __init__', files: { 'pkg/__init__.py': '', 'tests/test_a.py': t('import importlib', 'importlib.import_module("pkg")') }, test: 'tests/test_a.py', subjects: ['pkg/__init__.py'], facades: ['pkg'] },
    { name: 'a submodule import does not', files: { 'pkg/__init__.py': '', 'pkg/m.py': '', 'tests/test_a.py': t('from pkg import m') }, test: 'tests/test_a.py', subjects: ['pkg/m.py'], facades: null },
    { name: 'a from-import out of a module does not', files: { 'pkg/__init__.py': '', 'pkg/m.py': '', 'tests/test_a.py': t('from pkg.m import x') }, test: 'tests/test_a.py', subjects: ['pkg/m.py'], facades: null },
    { name: 'a submodule and a name from the __init__ together do', files: { 'pkg/__init__.py': '', 'pkg/m.py': '', 'tests/test_a.py': t('from pkg import m, value') }, test: 'tests/test_a.py', subjects: ['pkg/__init__.py', 'pkg/m.py'], facades: ['pkg'] },
    { name: 'a relative import through the test directory __init__ does', files: { 'pkg/__init__.py': '', 'pkg/test_a.py': t('from . import value') }, test: 'pkg/test_a.py', subjects: ['pkg/__init__.py'], facades: ['pkg'] },
    { name: 'two facades give a sorted list of their directories', files: { 'a/__init__.py': '', 'pkg/__init__.py': '', 'tests/test_a.py': t('import pkg', 'import a') }, test: 'tests/test_a.py', subjects: ['a/__init__.py', 'pkg/__init__.py'], facades: ['a', 'pkg'] },
  ];

  it.each(cases)('$name', async ({ files, test, subjects, facades }) => {
    const evidence = await scanProject(makeTree(files), { commitLimit: 1 });
    expect(evidence.files.find(file => file.file === test)!.subjects).toEqual(subjects);
    const scoped = (evidence.inventory?.noteScopes ?? []).filter(note => note.text === FACADE_NOTE).map(note => note.scope);
    expect(scoped).toEqual(facades ? [facades] : []);
    expect(evidence.inventory?.notes.includes(FACADE_NOTE) ?? false).toBe(facades !== null);
    expect(evidence.inventory?.complete).toBe(facades === null);
  });
});

describe('opaque registration and its scope', () => {
  const run = ['', 'def test_x():', '    assert 1'];
  const load = ['def load_tests(loader, tests, pattern):', '    return tests'];
  const cases: Array<{ name: string; files: Record<string, string>; scope: string[] | 'all'; evidence: string }> = [
    { name: 'load_tests scopes to the package of its subject', files: { 'src/lib/tool.py': '', 'tests/test_a.py': py('from lib import tool', ...load, ...run) }, scope: ['src/lib'], evidence: 'load_tests' },
    { name: 'subjects in two packages give both directories', files: { 'src/lib/tool.py': '', 'pkg/m.py': '', 'tests/test_a.py': py('from lib import tool', 'from pkg import m', ...load, ...run) }, scope: ['pkg', 'src/lib'], evidence: 'load_tests' },
    { name: 'an imported test class scopes to the package of its subject', files: { 'src/lib/tool.py': '', 'tests/test_a.py': py('from lib.tool import TestBase', ...run) }, scope: ['src/lib'], evidence: 'TestBase' },
    { name: 'a non-literal import scopes to the package of its subject', files: { 'src/lib/tool.py': '', 'tests/test_a.py': py('import lib.tool', 'from importlib import import_module', 'def test_x():', '    assert import_module(name)') }, scope: ['src/lib'], evidence: 'non-literal import' },
    { name: 'no subject: the nearest ancestor with an __init__.py', files: { 'pkg/__init__.py': '', 'pkg/tests/test_a.py': py(...load, ...run) }, scope: ['pkg'], evidence: 'load_tests' },
    { name: 'no subject: the nearest of two ancestors with an __init__.py', files: { 'pkg/__init__.py': '', 'pkg/tests/__init__.py': '', 'pkg/tests/test_a.py': py(...load, ...run) }, scope: ['pkg/tests'], evidence: 'load_tests' },
    { name: 'no subject: an ancestor named src', files: { 'src/tests/test_a.py': py(...load, ...run) }, scope: ['src'], evidence: 'load_tests' },
    { name: 'no subject, no package: the parent directory of the test', files: { 'tests/unit/test_a.py': py(...load, ...run) }, scope: ['tests/unit'], evidence: 'load_tests' },
    { name: 'a subject in the project root names no package, so the fallback applies', files: { 'top.py': '', 'tests/test_a.py': py('import top', ...load, ...run) }, scope: ['tests'], evidence: 'load_tests' },
    { name: 'a test file in the project root is global', files: { 'test_a.py': py(...load, ...run) }, scope: 'all', evidence: 'load_tests' },
  ];

  it.each(cases)('$name', async ({ files, scope, evidence: what }) => {
    const evidence = await scanProject(makeTree(files), { commitLimit: 1 });
    expect(evidence.inventory).toMatchObject({ complete: false, notes: [OPAQUE_NOTE], noteScopes: [{ text: OPAQUE_NOTE, scope }] });
    const opaque = evidence.files.flatMap(file => file.findings).filter(finding => finding.rule === 'wiring.opaque-test-registration');
    expect(opaque).toHaveLength(1);
    expect(opaque[0]!.evidence).toBe(what);
    expect(opaque[0]!.message).toMatch(/Recognized declarations may undercount/);
    expect(renderMarkdown(evidence)).toMatch(/\| 1\+\? \| 1 \|/);
  });

  it('merges the scopes of several files into one note and lets a global scope win over directories', async () => {
    const source = py(...load, ...run);
    const dirs = await scanProject(makeTree({ 'b/tests/test_a.py': source, 'a/tests/test_b.py': source, 'a/tests/test_c.py': source }), { commitLimit: 1 });
    expect(dirs.inventory!.noteScopes).toEqual([{ text: OPAQUE_NOTE, scope: ['a/tests', 'b/tests'] }]);
    const mixed = await scanProject(makeTree({ 'b/tests/test_a.py': source, 'test_b.py': source }), { commitLimit: 1 });
    expect(mixed.inventory!.noteScopes).toEqual([{ text: OPAQUE_NOTE, scope: 'all' }]);
  });
});

describe('the python_files config note', () => {
  const test = py('def test_x():', '    assert 1');
  it.each([
    { file: 'pytest.ini', text: '[pytest]\npython_files = check_*.py\n', note: true },
    { file: 'tox.ini', text: '[testenv]\n[pytest]\npython_files = check_*.py\n', note: true },
    { file: 'setup.cfg', text: '[tool:pytest]\npython_files = check_*.py\n', note: true },
    { file: 'pyproject.toml', text: '[tool.pytest.ini_options]\npython_files = ["check_*.py"]\n', note: true },
    { file: 'pytest.ini', text: '[pytest]\naddopts = -q\n', note: false },
  ])('$file with $text gives the note: $note', async ({ file, text, note }) => {
    const evidence = await scanProject(makeTree({ 'tests/test_x.py': test, [file]: text }), { commitLimit: 1 });
    expect(evidence.inventory!.complete).toBe(!note);
    expect(evidence.inventory!.notes).toEqual(note ? [CONFIG_NOTE] : []);
    expect(evidence.inventory!.noteScopes).toEqual(note ? [{ text: CONFIG_NOTE, scope: 'all' }] : undefined);
    expect(evidence.inventory!.languages[1]).toMatchObject({ language: 'Python', runner: 'pytest', files: 1 });
    expect(renderMarkdown(evidence).includes(`- Inventory incomplete: ${CONFIG_NOTE}`)).toBe(note);
  });

  it('is not reported for a repo with no Python tests, where a stray config says nothing about the inventory', async () => {
    const evidence = await scanProject(makeTree({ 'tox.ini': '[pytest]\npython_files = x\n' }), { commitLimit: 1 });
    expect('inventory' in evidence).toBe(false);
  });
});

describe('scoped coverage of Python areas, on variants of the python-mixed fixture', () => {
  type Changes = { remove?: string[]; add?: Record<string, string>; areas?: string[] };
  /** A copy of the fixture with files removed or added and critical areas appended to its risk map. */
  const variant = (changes: Changes): string => {
    const root = makeTree();
    cpSync(FIXTURE, root, { recursive: true });
    for (const rel of changes.remove ?? []) rmSync(join(root, rel));
    for (const [rel, text] of Object.entries(changes.add ?? {})) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    appendFileSync(join(root, '.testing', 'risk.yml'), (changes.areas ?? []).map(area => `  - {path: "${area}", tier: critical, why: variant}\n`).join(''));
    return root;
  };
  const INCOMPLETE = 'wiring.inventory-incomplete';
  const UNCOVERED = 'wiring.uncovered-critical';
  const NO_IO_TEST: Changes = { remove: ['tests/test_io_unittest.py'] };
  const UNTESTED: Changes = { add: { 'tools/untested.py': 'VALUE = 1\n' }, areas: ['tools/untested.py'] };
  const PYTHON_FILES = { 'pytest.ini': '[pytest]\npython_files = check_*.py\n' };

  const cases: Array<{ name: string; changes: Changes; coverage: string[] }> = [
    { name: 'the shipped fixture: only Go is coverage-unknown', changes: {}, coverage: [`${INCOMPLETE}@go/**`] },
    { name: 'io.py loses its test and sits in the facade note scope (src/pkg)', changes: NO_IO_TEST, coverage: [`${INCOMPLETE}@go/**`, `${INCOMPLETE}@src/pkg/io.py`] },
    { name: 'tools/untested.py is outside every note scope, so it stays uncovered although opaque files and Go exist', changes: UNTESTED, coverage: [`${INCOMPLETE}@go/**`, `${UNCOVERED}@tools/untested.py`] },
    { name: 'a scoped area and an unscoped one side by side', changes: { ...NO_IO_TEST, ...UNTESTED }, coverage: [`${INCOMPLETE}@go/**`, `${INCOMPLETE}@src/pkg/io.py`, `${UNCOVERED}@tools/untested.py`] },
    {
      name: 'a global python_files note makes every uncovered Python area coverage-unknown',
      changes: { ...NO_IO_TEST, ...UNTESTED, add: { ...UNTESTED.add, ...PYTHON_FILES } },
      coverage: [`${INCOMPLETE}@go/**`, `${INCOMPLETE}@src/pkg/io.py`, `${INCOMPLETE}@tools/untested.py`],
    },
  ];

  it.each(cases)('$name', async ({ changes, coverage }) => {
    const evidence = await scanProject(variant(changes), { commitLimit: 1 });
    expect(coverageOf(evidence)).toEqual(coverage);
    // backend/app/** and checks/** are covered in every variant. A Python finding names Python and the note; an uncovered one does not.
    for (const finding of evidence.projectFindings.filter(finding => finding.rule === INCOMPLETE && finding.file !== 'go/**')) {
      expect(finding.message).toContain('Python');
      expect(finding.message).toContain(finding.file === 'tools/untested.py' ? CONFIG_NOTE : FACADE_NOTE);
    }
    for (const finding of evidence.projectFindings.filter(finding => finding.rule === UNCOVERED)) expect(finding.message).not.toContain('Python');
    expect(evidence.inventory!.complete).toBe(false);
  });

  it('reports the config note with scope all in the global variant', async () => {
    const evidence = await scanProject(variant({ add: PYTHON_FILES }), { commitLimit: 1 });
    expect(evidence.inventory!.notes).toContain(CONFIG_NOTE);
    expect(evidence.inventory!.noteScopes).toContainEqual({ text: CONFIG_NOTE, scope: 'all' });
  });
});
