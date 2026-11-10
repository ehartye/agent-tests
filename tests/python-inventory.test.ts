/** @lane merge @subject src/scan.ts @subject src/discover.ts @subject src/python/subjects.ts @subject src/cli.ts @subject src/schema.ts */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { auditArtifact } from '../src/audit-output.ts';
import { loadPythonParser } from '../src/python/parser.ts';
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

describe('the python-mixed fixture, through the CLI', () => {
  const scanned = cli('scan', '--root', FIXTURE);
  const evidence = JSON.parse(scanned.stdout) as EvidenceReport;
  const expected = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8')) as {
    runner: string; testFiles: string[]; records: Record<string, Record<string, unknown>>; laneMismatch: string[]; inventory: unknown; goCoverage: string[];
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

  it('promotes Python to supported with its runner, keeps Go unsupported and reports only Go coverage as unknown', () => {
    const { notes, ...inventory } = evidence.inventory!;
    expect(inventory).toEqual(expected.inventory);
    expect(notes.length).toBeGreaterThan(0);
    const go = evidence.projectFindings.filter(finding => finding.file === 'go/**').map(finding => `${finding.rule}@${finding.file}`);
    expect(go).toEqual(expected.goCoverage);
  });

  it('shows the supported language and its runner in the report header and the unparsed file as unreadable', () => {
    const markdown = cli('report', '--root', FIXTURE).stdout;
    expect(markdown).toContain('- Languages: JavaScript (vitest, 1 files), Go (detected-unsupported, 1 files), Python (pytest, 8 files)');
    expect(markdown).toContain('- Inventory incomplete: Go detected but not inventoried.');
    expect(markdown).toMatch(/\| tests\/test_scheduled\.py \| critical \| scheduled \|/);
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
