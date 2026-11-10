import { describe, expect, it } from 'vitest';
import { areaInNoteScope, classifiableFiles, detectWiring, unmappedSubjectFinding } from '../../src/detectors/wiring.ts';
import { candidateDirs } from '../../src/riskdraft.ts';
import { defaultRiskMap, loadRiskMap, serializeRiskMap, tierFor } from '../../src/riskmap.ts';
import type { NoteScope, RiskMap } from '../../src/schema.ts';
import { makeTree } from '../helpers/tree.ts';

const rules = (findings: Array<{ rule: string }>): string[] => findings.map(finding => finding.rule).sort();

describe('detectWiring', () => {
  const map: RiskMap = {
    ...defaultRiskMap(),
    areas: [
      { path: 'src/db/**', tier: 'critical' },
      { path: 'src/auth/**', tier: 'critical' },
      { path: 'src/ui/**', tier: 'low' },
    ],
  };

  it('reports a missing risk map as one finding', () => {
    expect(rules(detectWiring(null, [], []))).toEqual(['wiring.no-risk-map']);
  });

  it('reports untiered files, lane mismatches, uncovered critical areas and drift', () => {
    const findings = detectWiring(
      map,
      [
        { rel: 'tests/db.test.ts', tier: 'critical', tags: { lane: 'merge' }, subjects: ['src/db/store.ts'] },
        { rel: 'tests/ui.test.ts', tier: 'low', tags: { lane: 'edit' }, subjects: ['src/ui/button.ts'] },
        { rel: 'tests/misc.test.ts', tier: null, tags: {}, subjects: ['src/misc/x.ts'] },
      ],
      ['src/db', 'src/auth', 'src/ui', 'src/billing'],
    );
    expect(findings.map(finding => `${finding.rule}@${finding.file}`).sort()).toEqual([
      'wiring.drift@src/billing',
      'wiring.lane-mismatch@tests/ui.test.ts',
      'wiring.uncovered-critical@src/auth/**',
      'wiring.untiered@tests/misc.test.ts',
    ]);
  });

  it('returns only the no-map finding when there is no map, whatever else is passed', () => {
    const findings = detectWiring(
      null,
      [{ rel: 'tests/a.test.ts', tier: null, tags: { lane: 'edit' }, subjects: [] }],
      ['src/billing'],
    );
    expect(findings.map(finding => finding.rule)).toEqual(['wiring.no-risk-map']);
  });

  it('does not flag a test with no @lane tag', () => {
    const findings = detectWiring(map, [{ rel: 'tests/ui.test.ts', tier: 'low', tags: {}, subjects: ['src/ui/button.ts'] }], []);
    expect(rules(findings.filter(finding => finding.file === 'tests/ui.test.ts'))).toEqual([]);
  });

  it('allows a standard test in the scheduled lane', () => {
    const findings = detectWiring(map, [{ rel: 'tests/u.test.ts', tier: 'standard', tags: { lane: 'scheduled' }, subjects: ['src/ui/button.ts'] }], []);
    expect(rules(findings.filter(finding => finding.file === 'tests/u.test.ts'))).toEqual([]);
  });

  it('covers and uncovers a critical area that is a single file', () => {
    const single: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'src/auth.ts', tier: 'critical' }] };
    const covered = detectWiring(single, [{ rel: 'tests/a.test.ts', tier: 'critical', tags: {}, subjects: ['src/auth.ts'] }], []);
    expect(rules(covered)).toEqual([]);
    const uncovered = detectWiring(single, [{ rel: 'tests/a.test.ts', tier: 'critical', tags: {}, subjects: ['src/other.ts'] }], []);
    expect(uncovered.map(finding => `${finding.rule}@${finding.file}`)).toEqual(['wiring.uncovered-critical@src/auth.ts']);
  });

  it('counts a test whose own path is inside a critical area as covering it', () => {
    const colocated = detectWiring(map, [{ rel: 'src/auth/login.test.ts', tier: 'critical', tags: {}, subjects: [] }], ['src/auth']);
    expect(colocated.map(finding => `${finding.rule}@${finding.file}`)).toEqual(['wiring.uncovered-critical@src/db/**']);
  });

  it('explains an uncovered critical area and how to cover it without an import', () => {
    const [finding] = detectWiring(map, [], []).filter(item => item.file === 'src/auth/**');
    expect(finding.message).toBe('Critical area with no test file exercising it. A test reaching it only through a subprocess needs `@subject <path>`.');
    expect(finding.evidence.startsWith('0 test files import this area')).toBe(true);
  });

  describe('untiered', () => {
    const only = (file: Parameters<typeof detectWiring>[1][number]) => detectWiring(map, [file], []).filter(finding => finding.rule === 'wiring.untiered');

    it('says a test with no subjects has no code subject and how to fix it', () => {
      const [finding] = only({ rel: 'tests/e2e.test.ts', tier: null, tags: {}, subjects: [] });
      expect(finding.message).toBe('This test has no code subject, so it has no tier. Add `@risk <critical|standard|low>` or `@subject <path>` at the top of the file.');
      expect(finding.evidence).toBe('no code subjects');
    });

    it('says code with no matching area and keeps the subjects as evidence', () => {
      const [finding] = only({ rel: 'tests/m.test.ts', tier: null, tags: {}, subjects: ['src/misc/x.ts', 'src/misc/y.ts'] });
      expect(finding.message).toContain('matches no risk-map area');
      expect(finding.message).toContain('`@risk <critical|standard|low>`');
      expect(finding.message).toContain('`@subject <path>`');
      expect(finding.evidence).toBe('src/misc/x.ts, src/misc/y.ts');
    });

    it('caps long subject evidence at 160 characters on a comma boundary', () => {
      const subjects = Array.from({ length: 30 }, (_, index) => `src/module${index}/file.ts`);
      const [finding] = only({ rel: 'tests/m.test.ts', tier: null, tags: {}, subjects });
      expect(finding.evidence.length).toBeLessThanOrEqual(160);
      expect(finding.evidence.endsWith('...')).toBe(true);
      const kept = finding.evidence.slice(0, -3).split(', ');
      expect(kept).toEqual(subjects.slice(0, kept.length));
    });

    it('does not truncate evidence that fits', () => {
      const subjects = Array.from({ length: 5 }, (_, index) => `src/m${index}/f.ts`);
      const [finding] = only({ rel: 'tests/m.test.ts', tier: null, tags: {}, subjects });
      expect(finding.evidence).toBe(subjects.join(', '));
    });

    it('names a @risk value that is not a tier', () => {
      const [finding] = only({ rel: 'tests/m.test.ts', tier: null, tags: { risk: 'hgh' }, subjects: [] });
      expect(finding.message).toContain('`@risk` must be critical, standard or low');
      expect(finding.evidence).toContain('hgh');
    });
  });

  describe('drift and catch-all areas', () => {
    const withCatchAll: RiskMap = {
      ...defaultRiskMap(),
      areas: [
        { path: 'src/auth/**', tier: 'critical' },
        { path: 'src/**', tier: 'standard' },
      ],
    };
    const drift = (areaMap: RiskMap, dirs: string[]) =>
      detectWiring(areaMap, [], dirs)
        .filter(finding => finding.rule === 'wiring.drift')
        .map(finding => finding.file);

    it('ignores a src/** catch-all when probing directories', () => {
      expect(drift(withCatchAll, ['src/auth', 'src/billing'])).toEqual(['src/billing']);
    });

    it('ignores lib/** and app/** catch-alls too', () => {
      const map2: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'lib/**', tier: 'standard' }, { path: 'app/**', tier: 'standard' }] };
      expect(drift(map2, ['lib/a', 'app/b'])).toEqual(['lib/a', 'app/b']);
    });

    it('still lets a catch-all assign a tier to files outside the drift probe', () => {
      expect(detectWiring(withCatchAll, [], ['src/auth']).filter(finding => finding.rule === 'wiring.drift')).toEqual([]);
    });

    it('does not treat src/app/** as a catch-all', () => {
      const appOnly: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'src/app/**', tier: 'standard' }] };
      expect(drift(appOnly, ['src/app'])).toEqual([]);
    });

    it('does not treat a wildcard-segment glob as a catch-all', () => {
      const wild: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'src/*/foo/**', tier: 'standard' }] };
      expect(drift(wild, ['src/x/foo'])).toEqual([]);
      expect(drift(wild, ['src/x/bar'])).toEqual(['src/x/bar']);
    });
  });
});

describe('wiring.unmapped-subject', () => {
  const map: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'src/db/**', tier: 'critical' }] };

  it('names the unmapped path and the area that did map, with the evidence quoting both', () => {
    const finding = unmappedSubjectFinding('tests/a.test.ts', ['src/misc/x.ts'], 'src/db/**');
    expect(finding).toMatchObject({ category: 'wiring', rule: 'wiring.unmapped-subject', file: 'tests/a.test.ts' });
    expect(finding.message).toContain('src/misc/x.ts');
    expect(finding.evidence).toBe('src/misc/x.ts; mapped area: src/db/**');
  });

  it('is not emitted by the file-level wiring checks, which still see the tier', () => {
    const findings = detectWiring(map, [{ rel: 'tests/a.test.ts', tier: 'critical', tags: {}, subjects: ['src/db/s.ts', 'src/misc/x.ts'] }], []);
    expect(rules(findings)).toEqual([]);
  });
});

describe('bare-directory wiring.drift', () => {
  const driftOf = (areaMap: RiskMap, dirs: string[], files: Record<string, string[]> = {}) =>
    detectWiring(areaMap, [], dirs, dir => files[dir] ?? [])
      .filter(finding => finding.rule === 'wiring.drift')
      .map(finding => `${finding.file}|${finding.evidence}`);

  it('does not flag a root folder that has its own folder/** area', () => {
    const roots: RiskMap = { ...defaultRiskMap(), areas: ['Source', 'Content', 'Config', 'Art'].map(dir => ({ path: `${dir}/**`, tier: 'standard' as const })) };
    expect(driftOf(roots, ['Art', 'Config', 'Content', 'Source'])).toEqual([]);
  });

  it('does not flag a directory whose files are all classified by narrower or overlapping areas', () => {
    const overlap: RiskMap = {
      ...defaultRiskMap(),
      areas: [
        { path: 'engine/core/**', tier: 'critical' },
        { path: 'engine/*.json', tier: 'low' },
        { path: 'engine/**', tier: 'standard' },
        { path: 'bin/cli.js', tier: 'standard' },
      ],
    };
    const files = { engine: ['engine/core/a.ts', 'engine/x.json'], bin: ['bin/cli.js'] };
    expect(driftOf(overlap, ['engine', 'bin'], files)).toEqual([]);
  });

  it('classifies descendants first-match, with a catch-all ancestor never counting', () => {
    const map: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'src/auth/session/**', tier: 'critical' }, { path: 'src/**', tier: 'standard' }] };
    expect(driftOf(map, ['src/auth'], { 'src/auth': ['src/auth/session/a.ts'] })).toEqual([]);
    expect(driftOf(map, ['src/auth'], { 'src/auth': ['src/auth/session/a.ts', 'src/auth/orphan.ts'] })).toEqual(['src/auth|src/auth/orphan.ts']);
  });

  it('still reports a genuinely unclassified file in a partly covered directory with its exact path', () => {
    const map: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'tools/build.js', tier: 'standard' }] };
    expect(driftOf(map, ['tools'], { tools: ['tools/build.js', 'tools/orphan.js'] })).toEqual(['tools|tools/orphan.js']);
  });

  it('keeps reporting an empty or unknown directory with no evidence', () => {
    expect(driftOf({ ...defaultRiskMap(), areas: [] }, ['lonely'])).toEqual(['lonely|']);
  });
});

describe('classifiableFiles', () => {
  it('skips ignored output, dot directories, tests, support files and probe artifacts but keeps nested sources', () => {
    const root = makeTree({
      'engine/core/a.ts': '',
      'engine/dist/out.js': '',
      'engine/.cache/c.js': '',
      'engine/a.test.ts': '',
      'engine/fixtures/f.ts': '',
      'engine/__probe__.ts': '',
      'engine/README.md': '',
    });
    expect(classifiableFiles(root, 'engine')).toEqual(['engine/README.md', 'engine/core/a.ts']);
  });

  it('treats Python test files and conftest.py as tests and support, never as source', () => {
    const root = makeTree({ 'svc/app.py': '', 'svc/test_app.py': '', 'svc/app_test.py': '', 'svc/conftest.py': '', 'svc/pkg/conftest.py': '', 'svc/pkg/core.py': '' });
    expect(classifiableFiles(root, 'svc')).toEqual(['svc/app.py', 'svc/pkg/core.py']);
  });

  it('returns nothing for a missing directory', () => {
    expect(classifiableFiles(makeTree(), 'nope')).toEqual([]);
  });
});

describe('a fixture project with folder/** roots', () => {
  const root = () =>
    makeTree({
      '.testing/risk.yml': serializeRiskMap({
        ...defaultRiskMap(),
        areas: [
          { path: 'Source/**', tier: 'critical' },
          { path: 'Content/**', tier: 'low' },
          { path: 'Config/**', tier: 'standard' },
          { path: 'Art/**', tier: 'low' },
          { path: 'engine/core/**', tier: 'critical' },
          { path: 'engine/**', tier: 'standard' },
        ],
      }),
      'Source/a.ts': 'export const a = 1;\n',
      'Content/c.ts': 'export const c = 1;\n',
      'Config/g.ts': 'export const g = 1;\n',
      'Art/r.ts': 'export const r = 1;\n',
      'engine/core/e.ts': 'export const e = 1;\n',
      'engine/dist/generated.js': 'x\n',
      'tools/build.ts': 'export const b = 1;\n',
    });

  it('reports no bare-directory drift for the covered roots (the folder/** report did not come from the risk-map load)', () => {
    const dir = root();
    const map = loadRiskMap(dir);
    expect(tierFor(map!, 'Source/a.ts')).toEqual({ tier: 'critical', area: 'Source/**' });
    const drift = detectWiring(map, [], candidateDirs(dir), d => classifiableFiles(dir, d)).filter(finding => finding.rule === 'wiring.drift');
    expect(drift.map(finding => finding.file)).toEqual(['tools']);
    expect(drift[0].evidence).toBe('tools/build.ts');
  });
});

describe('detectWiring with tests the scan cannot read', () => {
  const critical = (path: string): RiskMap => ({ ...defaultRiskMap(), areas: [{ path, tier: 'critical' }] });
  const run = (path: string, files: string[], unsupported: string[], tests: Array<{ rel: string; subjects: string[] }> = [], notes: NoteScope[] = []) =>
    detectWiring(critical(path), tests.map(test => ({ ...test, tier: 'critical' as const, tags: {} })), [], () => files, unsupported, notes)
      .filter(finding => finding.rule.startsWith('wiring.uncovered') || finding.rule.startsWith('wiring.inventory'));

  it.each([
    { name: 'an area of C++ files, with only PowerShell tests detected', area: 'Source/**', files: ['Source/a.cpp', 'Source/a.h'], unsupported: ['PowerShell'], rule: 'wiring.inventory-incomplete' },
    { name: 'an area mixing Python and C++ files, with Go detected', area: 'src/**', files: ['src/a.py', 'src/b.cpp'], unsupported: ['Go'], rule: 'wiring.inventory-incomplete' },
    { name: 'an area mixing TypeScript, Python and C++ files, with Go detected', area: 'src/**', files: ['src/a.ts', 'src/b.py', 'src/c.cpp'], unsupported: ['Go'], rule: 'wiring.inventory-incomplete' },
    { name: 'an area mixing TypeScript and Python files only, with Go detected (both are inventoried languages)', area: 'src/**', files: ['src/a.ts', 'src/b.py'], unsupported: ['Go'], rule: 'wiring.uncovered-critical' },
    { name: 'an area of Python files only, with Go detected', area: 'tools/**', files: ['tools/a.py', 'tools/b.py'], unsupported: ['Go'], rule: 'wiring.uncovered-critical' },
    { name: 'a single-file area written in Python, with Go detected', area: 'src/core.py', files: ['src/core.py', 'src/other.ts'], unsupported: ['Go'], rule: 'wiring.uncovered-critical' },
    { name: 'an area of JS and TS files only, although Go is detected', area: 'web/**', files: ['web/a.ts', 'web/b.mjs', 'web/c.tsx'], unsupported: ['Go'], rule: 'wiring.uncovered-critical' },
    { name: 'an area of C++ files when no unsupported language is detected', area: 'Source/**', files: ['Source/a.cpp'], unsupported: [], rule: 'wiring.uncovered-critical' },
  ])('reports $rule for $name', ({ area, files, unsupported, rule }) => {
    const findings = run(area, files, unsupported);
    expect(findings.map(finding => `${finding.rule}@${finding.file}`)).toEqual([`${rule}@${area}`]);
    if (rule === 'wiring.inventory-incomplete') {
      expect(findings[0]!.message).toContain(unsupported.join(', '));
      expect(findings[0]!.message).toContain('coverage is unknown');
    }
  });

  it('reports nothing for an area that a supported test covers', () => {
    expect(run('Source/**', ['Source/a.cpp'], ['PowerShell'], [{ rel: 'tests/a.test.ts', subjects: ['Source/a.cpp'] }])).toEqual([]);
  });

  const FACADE: NoteScope = { text: 'imports through a package __init__ may reach other modules', scope: ['src/pkg'] };
  const GLOBAL: NoteScope = { text: 'custom python_files configured; discovery used defaults', scope: 'all' };
  it.each([
    { name: 'a Python area inside a note scope', area: 'src/pkg/io.py', files: ['src/pkg/io.py'], unsupported: [], notes: [FACADE], rule: 'wiring.inventory-incomplete', names: ['Python', FACADE.text] },
    { name: 'a Python area outside every note scope', area: 'tools/untested.py', files: ['tools/untested.py'], unsupported: [], notes: [FACADE], rule: 'wiring.uncovered-critical', names: [] },
    { name: 'a Python area outside every note scope, with Go detected', area: 'tools/untested.py', files: ['tools/untested.py'], unsupported: ['Go'], notes: [FACADE], rule: 'wiring.uncovered-critical', names: [] },
    { name: 'a Python area under a global note', area: 'tools/untested.py', files: ['tools/untested.py'], unsupported: [], notes: [GLOBAL], rule: 'wiring.inventory-incomplete', names: ['Python', GLOBAL.text] },
    { name: 'a Python area in scope of one of two notes names only that note', area: 'src/pkg/**', files: ['src/pkg/a.py'], unsupported: [], notes: [FACADE, { text: 'other note', scope: ['lib'] }], rule: 'wiring.inventory-incomplete', names: ['Python', FACADE.text] },
    { name: 'a Python area in scope with Go detected (the Python rule, not the language rule)', area: 'src/pkg/**', files: ['src/pkg/a.py'], unsupported: ['Go'], notes: [FACADE], rule: 'wiring.inventory-incomplete', names: ['Python', FACADE.text] },
    { name: 'an area with no Python files, although a note covers its directory', area: 'src/pkg/**', files: ['src/pkg/a.ts'], unsupported: [], notes: [FACADE], rule: 'wiring.uncovered-critical', names: [] },
  ])('reports $rule for $name', ({ area, files, unsupported, notes, rule, names }) => {
    const findings = run(area, files, unsupported, [], notes);
    expect(findings.map(finding => `${finding.rule}@${finding.file}`)).toEqual([`${rule}@${area}`]);
    for (const name of names) expect(findings[0]!.message).toContain(name);
    if (rule === 'wiring.uncovered-critical') expect(findings[0]!.message).not.toContain('Python');
    if (names.length > 0) expect(findings[0]!.message).not.toContain('other note');
  });

  it('reports nothing for a Python area that a test covers, whatever the notes say', () => {
    expect(run('src/pkg/io.py', ['src/pkg/io.py'], [], [{ rel: 'tests/test_io.py', subjects: ['src/pkg/io.py'] }], [GLOBAL])).toEqual([]);
  });
});

describe('areaInNoteScope', () => {
  // An area is in a directory note's scope when its glob base (the literal path before the first wildcard) is that directory or
  // below it, or when the area can reach below its base (it has a `**`) and the directory lies under that base.
  it.each([
    { area: 'src/pkg/io.py', scope: ['src/pkg'], expected: true, why: 'a file under the directory' },
    { area: 'src/pkg/**', scope: ['src/pkg'], expected: true, why: 'the base is the directory' },
    { area: 'src/pkg/sub/*.py', scope: ['src/pkg'], expected: true, why: 'the base is under the directory' },
    { area: 'src/**', scope: ['src/pkg'], expected: true, why: 'a recursive area above the directory' },
    { area: 'src/**/*.py', scope: ['src/pkg'], expected: true, why: 'a recursive glob above the directory' },
    { area: '**/*.py', scope: ['src/pkg'], expected: true, why: 'a recursive glob from the root' },
    { area: 'src/*.py', scope: ['src/pkg'], expected: false, why: 'a one-level glob cannot reach the directory below it' },
    { area: '*.py', scope: ['src/pkg'], expected: false, why: 'a one-level root glob cannot reach it either' },
    { area: 'src/pkg/core.py', scope: ['src/other'], expected: false, why: 'a sibling directory' },
    { area: 'src/package/io.py', scope: ['src/pkg'], expected: false, why: 'a shared name prefix is not containment' },
    { area: 'tools/untested.py', scope: ['src/pkg'], expected: false, why: 'an unrelated path' },
    { area: 'main.py', scope: ['src'], expected: false, why: 'a root file outside the directory' },
    { area: 'lib/**', scope: ['src/pkg', 'lib/deep'], expected: true, why: 'any directory of the list may match' },
    { area: 'tools/untested.py', scope: 'all' as const, expected: true, why: 'a global note covers every area' },
    { area: 'tools/untested.py', scope: [], expected: false, why: 'an empty list covers nothing' },
  ])('$area against $scope is $expected: $why', ({ area, scope, expected }) => {
    expect(areaInNoteScope(area, scope)).toBe(expected);
  });
});

describe('critical area globs through the real classifiableFiles, with Go detected', () => {
  const tree = { 'main.py': '', 'src/m.py': '', 'src/a.ts': '', 'src/b.py': '', 'lib/deep/c.py': '', 'lib/deep/d.ts': '', 'native/k.cpp': '', 'native/k.py': '' };
  const cases: Array<{ area: string; tests?: string[]; expected: string | null }> = [
    // Python is an inventoried language, so Go alone does not soften an area of Python files; a file of another language does.
    { area: 'src/*.py', expected: 'wiring.uncovered-critical' },
    { area: 'src/*.ts', expected: 'wiring.uncovered-critical' },
    { area: 'src/m.py', expected: 'wiring.uncovered-critical' },
    { area: 'main.py', expected: 'wiring.uncovered-critical' },
    { area: '*.py', expected: 'wiring.uncovered-critical' },
    { area: '**/*.py', expected: 'wiring.uncovered-critical' },
    { area: 'native/*', expected: 'wiring.inventory-incomplete' },
    { area: 'native/*.py', expected: 'wiring.uncovered-critical' },
    { area: 'native/*.cpp', expected: 'wiring.inventory-incomplete' },
    { area: 'lib/**/*.ts', expected: 'wiring.uncovered-critical' },
    { area: '**/*.ts', tests: ['src/a.test.ts'], expected: null },
  ];

  it.each(cases)('$area with tests [$tests] gives $expected', ({ area, tests = [], expected }) => {
    const root = makeTree(tree);
    const map: RiskMap = { ...defaultRiskMap(), areas: [{ path: area, tier: 'critical' }] };
    const files = tests.map(rel => ({ rel, tier: 'critical' as const, tags: {}, subjects: [] }));
    const findings = detectWiring(map, files, [], dir => classifiableFiles(root, dir), ['Go']);
    expect(findings.map(finding => finding.rule)).toEqual(expected ? [expected] : []);
  });

  it('lists repo-relative forward-slash paths from the root and from a directory, whatever the platform separator', () => {
    const root = makeTree(tree);
    expect(classifiableFiles(root, '')).toEqual(['lib/deep/c.py', 'lib/deep/d.ts', 'main.py', 'native/k.cpp', 'native/k.py', 'src/a.ts', 'src/b.py', 'src/m.py']);
    expect(classifiableFiles(root, 'lib')).toEqual(['lib/deep/c.py', 'lib/deep/d.ts']);
  });
});
