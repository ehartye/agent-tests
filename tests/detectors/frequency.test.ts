import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectFrequency } from '../../src/detectors/frequency.ts';
import { defaultRiskMap } from '../../src/riskmap.ts';
import { makeTree } from '../helpers/tree.ts';

const rules = (findings: Array<{ rule: string }>): string[] => findings.map(finding => finding.rule).sort();

describe('detectFrequency', () => {
  it('flags an unscoped suite run in a git hook but not a scoped one', () => {
    const root = makeTree({ '.husky/pre-commit': 'npm test\n', '.husky/pre-push': 'npx vitest related --run\n' });
    const found = detectFrequency(root, null);
    expect(found.map(finding => `${finding.rule}@${finding.file}`)).toEqual(['frequency.hook-full-suite@.husky/pre-commit']);
  });

  it('flags a bare vitest test script as watch mode and a pretest that runs tests', () => {
    const root = makeTree({ 'package.json': JSON.stringify({ scripts: { test: 'vitest', pretest: 'vitest run' } }) });
    expect(rules(detectFrequency(root, null))).toEqual(['frequency.hook-full-suite', 'frequency.watch-default']);
  });

  it('accepts vitest run', () => {
    const root = makeTree({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) });
    expect(detectFrequency(root, null)).toEqual([]);
  });

  it('flags automatic CI triggers and expensive OS matrices, but not manual or scheduled ones', () => {
    const automatic = makeTree({
      '.github/workflows/ci.yml': 'on:\n  push:\n    branches: [main]\njobs:\n  t:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, macos-latest]\n    runs-on: ${{ matrix.os }}\n    steps: []\n',
    });
    expect(rules(detectFrequency(automatic, null))).toEqual(['frequency.ci-on-push', 'frequency.ci-os-matrix-on-push']);
    const manual = makeTree({ '.github/workflows/ci.yml': "on:\n  workflow_dispatch:\n  schedule:\n    - cron: '0 6 * * 1'\njobs: {}\n" });
    expect(detectFrequency(manual, null)).toEqual([]);
  });

  it('accepts a single Linux job on pull_request, the recommended non-blocking check', () => {
    const root = makeTree({ '.github/workflows/ci.yml': 'on:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: []\n' });
    expect(detectFrequency(root, null)).toEqual([]);
  });

  it('flags a pull_request workflow that runs on Windows or macOS', () => {
    const literal = makeTree({ '.github/workflows/ci.yml': 'on:\n  pull_request:\njobs:\n  test:\n    runs-on: macos-latest\n    steps: []\n' });
    expect(rules(detectFrequency(literal, null))).toEqual(['frequency.ci-on-pull-request']);
    const matrix = makeTree({
      '.github/workflows/ci.yml': 'on:\n  pull_request:\njobs:\n  t:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, windows-latest]\n    runs-on: ${{ matrix.os }}\n    steps: []\n',
    });
    expect(rules(detectFrequency(matrix, null))).toEqual(['frequency.ci-on-pull-request', 'frequency.ci-os-matrix-on-push']);
  });

  it('accepts a path-filtered pull_request trigger', () => {
    const root = makeTree({ '.github/workflows/ci.yml': "on:\n  pull_request:\n    paths: ['src/**']\njobs: {}\n" });
    expect(detectFrequency(root, null)).toEqual([]);
  });

  it('accepts a tag-only push trigger as a release run, but not a branch push', () => {
    const tagsOnly = makeTree({ '.github/workflows/ci.yml': "on:\n  push:\n    tags: ['v*']\njobs: {}\n" });
    expect(detectFrequency(tagsOnly, null)).toEqual([]);
    const both = makeTree({ '.github/workflows/ci.yml': "on:\n  push:\n    branches: [main]\n    tags: ['v*']\njobs: {}\n" });
    expect(rules(detectFrequency(both, null))).toEqual(['frequency.ci-on-push']);
  });

  it('allows an OS matrix on a release-tag workflow', () => {
    const root = makeTree({
      '.github/workflows/ci.yml': "on:\n  push:\n    tags: ['v*']\njobs:\n  t:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, windows-latest, macos-latest]\n    runs-on: ${{ matrix.os }}\n    steps: []\n",
    });
    expect(detectFrequency(root, null)).toEqual([]);
  });

  it('adds dev-phase advice to CI findings', () => {
    const root = makeTree({ '.github/workflows/ci.yml': 'on: push\njobs: {}\n' });
    expect(detectFrequency(root, defaultRiskMap())[0]?.message).toContain('workflow_dispatch');
  });

  it('flags agent instructions that say to run every test', () => {
    const root = makeTree({ 'AGENTS.md': 'Be brief.\nAlways run all tests after every change.\n' });
    expect(detectFrequency(root, null).map(finding => `${finding.rule}:${finding.line}`)).toEqual(['frequency.agent-run-all:2']);
  });
});

const WF = '.github/workflows/ci.yml';
const workflow = (text: string): string => makeTree({ [WF]: text });
const scriptsTree = (scripts: Record<string, unknown>): string => makeTree({ 'package.json': JSON.stringify({ scripts }) });
const watchRules = (script: unknown): string[] => rules(detectFrequency(scriptsTree({ test: script }), null)).filter(rule => rule === 'frequency.watch-default');

describe('detectFrequency build gates', () => {
  const buildFindings = (scripts: Record<string, unknown>) => detectFrequency(scriptsTree(scripts), null).filter(finding => finding.rule === 'frequency.build-full-suite');

  it('reports the APcademy build gate with its script chain', () => {
    const found = buildFindings({ build: 'npm run validate:explanations && npm test && vite build', test: 'vitest run' });
    expect(found).toHaveLength(1);
    expect(found[0].file).toBe('package.json');
    expect(found[0].evidence).toContain('build -> test');
    expect(found[0].message).toContain('release');
  });

  it('follows local script delegation without executing it', () => {
    const found = buildFindings({ build: 'npm run check && vite build', check: 'npm run test:unit', 'test:unit': 'vitest run' });
    expect(found).toHaveLength(1);
    expect(found[0].evidence).toContain('build -> check -> test:unit');
  });

  it.each(['pnpm exec vitest run', 'npx vitest run', 'bun test'])('reports a direct test tool in build: %s', command => {
    expect(buildFindings({ build: `${command} && vite build` })).toHaveLength(1);
  });

  it.each(['prebuild', 'postbuild'])('reports a suite in the %s lifecycle gate', name => {
    const found = buildFindings({ build: 'vite build', [name]: 'vitest run' });
    expect(found).toHaveLength(1);
    expect(found[0].evidence).toContain(name);
  });

  it.each([
    { build: 'vite build', test: 'vitest run' },
    { build: 'npm run check && vite build', check: 'vitest related --run src/app.test.js' },
    { build: 'npm run test:smoke && vite build', 'test:smoke': 'vitest related --run src/app.test.js' },
    { build: 'npm run check -- --changed && vite build', check: 'vitest run' },
    { build: 'npm test -- src/foo.test.ts && vite build', test: 'vitest run' },
    { build: 'vitest run src/foo.test.ts && vite build' },
    { build: 'npm run check', check: 'npm run build' },
    { build: 'echo "npm test" && vite build', test: 'vitest run' },
    { build: 'npm --prefix server test && vite build', test: 'vitest run' },
    { build: 'npm run test --prefix server && vite build', test: 'vitest run' },
    { build: 'npm run test --workspace server && vite build', test: 'vitest run' },
    { build: 'npm run t && vite build', t: 'echo smoke', test: 'vitest run' },
    { build: 'echo "review; npm test" && vite build', test: 'vitest run' },
    { build: 'echo "review && npm test" && vite build', test: 'vitest run' },
    { build: 'vite build # disabled && npm test', test: 'vitest run' },
    { build: 'vite build # disabled; npm test', test: 'vitest run' },
    { build: 'vitest run Library && vite build' },
    { build: 'vitest run ./integration && vite build' },
    { build: 'vitest run --project unit && vite build' },
    { build: 'vitest run $TEST_FILTER && vite build' },
    { build: 'node scripts/build.mjs', test: 'vitest run' },
  ])('does not infer an unscoped local suite from %j', scripts => {
    expect(buildFindings(scripts)).toEqual([]);
  });
});

describe('detectFrequency on odd input', () => {
  it.each([
    ['a directory named AGENTS.md', { 'AGENTS.md/x': '' }],
    ['a directory named CLAUDE.md', { 'CLAUDE.md/x': '' }],
    ['a directory named package.json', { 'package.json/x': '' }],
    ['a directory named like a hook file', { '.husky/pre-commit/x': '' }],
    ['a directory named like a lefthook file', { 'lefthook.yml/x': '' }],
    ['.github/workflows being a file', { '.github/workflows': 'not a directory' }],
    ['a directory named x.yml', { '.github/workflows/x.yml/inner': '' }],
    ['an invalid package.json', { 'package.json': '{not json' }],
    ['a package.json holding null', { 'package.json': 'null' }],
    ['a package.json whose scripts is a string', { 'package.json': '{"scripts": "vitest"}' }],
    ['a workflow that is not valid YAML', { [WF]: 'on: [push\njobs: {' }],
    ['a workflow that is a scalar', { [WF]: 'just text\n' }],
    ['a workflow whose jobs is a list', { [WF]: 'on: push\njobs:\n  - a\n  - b\n' }],
    ['a workflow whose job is null', { [WF]: 'on: pull_request\njobs:\n  a:\n' }],
    ['a workflow whose matrix is a string', { [WF]: 'on: pull_request\njobs:\n  a:\n    strategy:\n      matrix: ${{ fromJson(x) }}\n    runs-on: ubuntu-latest\n' }],
  ])('does not throw on %s', (_label, files) => {
    expect(() => detectFrequency(makeTree(files), null)).not.toThrow();
  });

  it('reports nothing for a non-string test script', () => {
    expect(detectFrequency(scriptsTree({ test: 5 }), null)).toEqual([]);
    expect(detectFrequency(scriptsTree({ test: ['vitest'] }), null)).toEqual([]);
    expect(detectFrequency(scriptsTree({ pretest: 5 }), null)).toEqual([]);
    expect(detectFrequency(scriptsTree({ pretest: { run: 'npm test' } }), null)).toEqual([]);
  });

  it('does not throw on a dangling symlink where a file is expected', () => {
    const root = makeTree({});
    try {
      symlinkSync(join(root, 'nowhere'), join(root, 'AGENTS.md'));
    } catch {
      return; // Creating symlinks needs a privilege this machine does not grant.
    }
    expect(() => detectFrequency(root, null)).not.toThrow();
  });
});

describe('detectFrequency agent instructions', () => {
  const agentFindings = (line: string, file = 'AGENTS.md'): string[] => detectFrequency(makeTree({ [file]: `${line}\n` }), null).map(finding => finding.rule);

  it.each([
    'Always run all tests after every change.',
    'Run the whole test suite after each edit',
    'Execute every test before you answer.',
    'Always run the tests.',
  ])('flags %s', line => {
    expect(agentFindings(line)).toEqual(['frequency.agent-run-all']);
  });

  it.each([
    'Do not run all tests after every change.',
    'Never run the full suite.',
    "Don't always run all tests.",
    'Agents should not run every test.',
    'Avoid running all tests when one file changed. Only run all tests in CI.',
    'Always run tests that cover the changed file.',
    'Always run tests related to the change.',
    'Always run tests for the module you touched.',
    'Always run affected tests.',
    'Run all tests before opening a PR.',
    'Run the full test suite before merge.',
    'Run all tests before pushing.',
    'Run every test once before you merge.',
  ])('does not flag %s', line => {
    expect(agentFindings(line)).toEqual([]);
  });

  it('does not flag a line inside a fenced code block', () => {
    const text = 'Use this:\n```sh\nalways run all tests after every change\n```\n~~~\nrun all tests\n~~~\n';
    expect(detectFrequency(makeTree({ 'AGENTS.md': text }), null)).toEqual([]);
    const after = detectFrequency(makeTree({ 'AGENTS.md': `${text}Always run all tests after every change.\n` }), null);
    expect(after.map(finding => finding.line)).toEqual([8]);
  });

  it.each(['GEMINI.md', '.github/copilot-instructions.md', '.cursorrules', 'CLAUDE.md'])('scans %s', file => {
    const found = detectFrequency(makeTree({ [file]: 'Always run all tests after every change.\n' }), null);
    expect(found.map(finding => `${finding.rule}@${finding.file}`)).toEqual([`frequency.agent-run-all@${file}`]);
  });
});

describe('detectFrequency workflows', () => {
  it('ignores a job that its if condition keeps off pull requests', () => {
    const nightly = workflow("on:\n  pull_request:\njobs:\n  nightly:\n    if: github.event_name == 'schedule'\n    runs-on: windows-latest\n    steps: []\n");
    expect(detectFrequency(nightly, null)).toEqual([]);
    const dispatch = workflow("on:\n  pull_request:\njobs:\n  manual:\n    if: github.event_name == 'workflow_dispatch'\n    runs-on: macos-latest\n    steps: []\n");
    expect(detectFrequency(dispatch, null)).toEqual([]);
    const counted = workflow("on:\n  pull_request:\njobs:\n  t:\n    if: github.event_name == 'pull_request'\n    runs-on: macos-latest\n    steps: []\n");
    expect(rules(detectFrequency(counted, null))).toContain('frequency.ci-on-pull-request');
  });

  it('still counts a pull-request-excluded job against a branch push', () => {
    const root = workflow("on:\n  push:\n    branches: [dev]\njobs:\n  t:\n    if: github.event_name == 'push'\n    strategy:\n      matrix:\n        os: [windows-latest]\n    runs-on: ${{ matrix.os }}\n    steps: []\n");
    expect(rules(detectFrequency(root, null))).toEqual(['frequency.ci-on-push', 'frequency.ci-os-matrix-on-push']);
  });

  it.each([
    ['a matrix os string', 'strategy:\n      matrix:\n        os: windows-latest\n    runs-on: ${{ matrix.os }}', true],
    ['matrix include entries', 'strategy:\n      matrix:\n        include:\n          - os: ubuntu-latest\n          - os: macos-14\n    runs-on: ${{ matrix.os }}', true],
    ['a runs-on string', 'runs-on: windows-2022', false],
    ['a runs-on array', 'runs-on: [macos-latest]', false],
    ['a runs-on object with labels', 'runs-on:\n      group: big\n      labels: windows-latest', false],
    ['a runs-on object with a label list', 'runs-on:\n      labels: [macos-latest]', false],
  ])('finds expensive runners in %s', (_label, jobBody, isMatrix) => {
    const root = workflow(`on:\n  pull_request:\njobs:\n  t:\n    ${jobBody}\n    steps: []\n`);
    expect(rules(detectFrequency(root, null))).toEqual(isMatrix ? ['frequency.ci-on-pull-request', 'frequency.ci-os-matrix-on-push'] : ['frequency.ci-on-pull-request']);
  });

  it('ignores self-hosted runners', () => {
    const labelled = workflow('on:\n  pull_request:\njobs:\n  t:\n    runs-on: [self-hosted, macos]\n    steps: []\n');
    expect(detectFrequency(labelled, null)).toEqual([]);
    const withMatrix = workflow('on:\n  pull_request:\njobs:\n  t:\n    strategy:\n      matrix:\n        os: [macos-latest]\n    runs-on: [self-hosted, "${{ matrix.os }}"]\n    steps: []\n');
    expect(detectFrequency(withMatrix, null)).toEqual([]);
    const object = workflow('on:\n  pull_request:\njobs:\n  t:\n    runs-on:\n      labels: [self-hosted, windows]\n    steps: []\n');
    expect(detectFrequency(object, null)).toEqual([]);
  });

  it('does not let a path filter excuse Windows or macOS on pull_request', () => {
    const windows = workflow("on:\n  pull_request:\n    paths: ['src/**']\njobs:\n  t:\n    runs-on: windows-latest\n    steps: []\n");
    const found = detectFrequency(windows, null);
    expect(rules(found)).toEqual(['frequency.ci-on-pull-request']);
    expect(found.find(finding => finding.rule === 'frequency.ci-on-pull-request')?.message).not.toContain('no path filter');
    const linux = workflow("on:\n  pull_request:\n    paths-ignore: ['docs/**']\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps: []\n");
    expect(detectFrequency(linux, null)).toEqual([]);
  });

  it('reports Windows or macOS on a path-filtered push, and the matrix rule only for a real matrix', () => {
    const literal = workflow("on:\n  push:\n    paths: ['src/**']\njobs:\n  t:\n    runs-on: macos-latest\n    steps: []\n");
    expect(rules(detectFrequency(literal, null))).toEqual(['frequency.ci-on-push']);
    const matrix = workflow("on:\n  push:\n    paths: ['src/**']\njobs:\n  t:\n    strategy:\n      matrix:\n        os: [macos-latest]\n    runs-on: ${{ matrix.os }}\n    steps: []\n");
    expect(rules(detectFrequency(matrix, null))).toEqual(['frequency.ci-on-push', 'frequency.ci-os-matrix-on-push']);
    const linux = workflow("on:\n  push:\n    paths: ['src/**']\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps: []\n");
    expect(detectFrequency(linux, null)).toEqual([]);
  });

  it('reports each matrix finding once when push and pull_request both fire', () => {
    const root = workflow('on:\n  push:\n    branches: [dev]\n  pull_request:\njobs:\n  t:\n    strategy:\n      matrix:\n        os: [windows-latest]\n    runs-on: ${{ matrix.os }}\n    steps: []\n');
    expect(rules(detectFrequency(root, null))).toEqual(['frequency.ci-on-pull-request', 'frequency.ci-on-push', 'frequency.ci-os-matrix-on-push']);
  });

  it('describes a push restricted to the default branch as a post-merge run', () => {
    const root = workflow('on:\n  push:\n    branches: [main]\n  pull_request:\njobs: {}\n');
    const message = detectFrequency(root, null)[0]?.message ?? '';
    expect(message).toContain('post-merge');
    expect(message).toContain('already ran on the same tree');
    const master = workflow('on:\n  push:\n    branches: [master]\njobs: {}\n');
    expect(detectFrequency(master, null)[0]?.message).toContain('post-merge');
    const other = workflow('on:\n  push:\n    branches: [main, dev]\njobs: {}\n');
    expect(detectFrequency(other, null)[0]?.message).toContain('every push to a branch');
    const bare = workflow('on: push\njobs: {}\n');
    expect(detectFrequency(bare, null)[0]?.message).toContain('every push to a branch');
  });

  it('does not treat tags with branches-ignore as tag-only', () => {
    const root = workflow("on:\n  push:\n    tags: ['v*']\n    branches-ignore: [wip]\njobs: {}\n");
    expect(rules(detectFrequency(root, null))).toEqual(['frequency.ci-on-push']);
  });

  it('gives the whole dev-phase recommendation', () => {
    const message = detectFrequency(workflow('on: push\njobs: {}\n'), defaultRiskMap())[0]?.message ?? '';
    for (const part of ['non-blocking Linux job', 'path-filtered', 'drafts skipped', 'newer runs cancelled', 'workflow_dispatch', 'weekly schedule', 'release tags']) {
      expect(message).toContain(part);
    }
  });
});

describe('detectFrequency hooks', () => {
  const hookRules = (files: Record<string, string>): string[] => detectFrequency(makeTree(files), null).map(finding => `${finding.rule}@${finding.file}`);

  it('ignores trailing comments and lines that only echo', () => {
    expect(hookRules({ '.husky/pre-commit': '#!/usr/bin/env sh\necho "skipping npm test"\nnpx prettier --check . # npm test\nprintf "vitest\\n"\n' })).toEqual([]);
    expect(hookRules({ '.husky/pre-commit': 'echo start && npm test\n' })).toEqual(['frequency.hook-full-suite@.husky/pre-commit']);
  });

  it.each([
    'npx vitest run $FILES',
    'npx vitest run "$@"',
    'npx jest --findRelatedTests {staged_files}',
    'npx vitest run {push_files}',
    'pnpm test --filter=...[HEAD^]',
  ])('treats %s as scoped', command => {
    expect(hookRules({ '.husky/pre-commit': `${command}\n` })).toEqual([]);
  });

  it('reads only the run values of a lefthook file', () => {
    const scoped = 'pre-commit:\n  commands:\n    jest:\n      run: npx jest --findRelatedTests {staged_files}\n    vitest:\n      glob: "*.ts"\n      run: npx vitest related --run {staged_files}\n';
    expect(hookRules({ 'lefthook.yml': scoped })).toEqual([]);
    const full = 'pre-commit:\n  commands:\n    unit:\n      run: npm test\n';
    const found = detectFrequency(makeTree({ 'lefthook.yml': full }), null);
    expect(found.map(finding => `${finding.rule}@${finding.file}:${finding.line}`)).toEqual(['frequency.hook-full-suite@lefthook.yml:4']);
    const block = 'pre-push:\n  jobs:\n    - name: t\n      run: |\n        echo hi\n        npm test\n';
    expect(detectFrequency(makeTree({ 'lefthook.yml': block }), null).map(finding => finding.line)).toEqual([6]);
  });

  it.each(['lefthook.yaml', '.lefthook.yml', '.config/lefthook.yml'])('scans %s', file => {
    expect(hookRules({ [file]: 'pre-commit:\n  commands:\n    t:\n      run: npm test\n' })).toEqual([`frequency.hook-full-suite@${file}`]);
  });

  it('scans .husky/pre-merge-commit', () => {
    expect(hookRules({ '.husky/pre-merge-commit': 'npm test\n' })).toEqual(['frequency.hook-full-suite@.husky/pre-merge-commit']);
  });

  it('scans simple-git-hooks values in package.json', () => {
    const flagged = JSON.stringify({ 'simple-git-hooks': { 'pre-commit': 'npm test' } });
    expect(hookRules({ 'package.json': flagged })).toEqual(['frequency.hook-full-suite@package.json']);
    const scoped = JSON.stringify({ 'simple-git-hooks': { 'pre-commit': 'npx vitest related --run', 'pre-push': 5 } });
    expect(hookRules({ 'package.json': scoped })).toEqual([]);
  });

  it.each(['npm t', 'pnpm -r test', 'pnpm --filter x test', 'npm run -s test', 'yarn test', 'bun run test'])('recognises %s as a suite run', command => {
    expect(hookRules({ '.husky/pre-commit': `${command}\n` })).toEqual(['frequency.hook-full-suite@.husky/pre-commit']);
  });

  it('does not take npm tsc or npm run lint for a suite run', () => {
    expect(hookRules({ '.husky/pre-commit': 'npm run lint\nnpm tsc\n' })).toEqual([]);
  });
});

describe('detectFrequency watch mode', () => {
  it.each([
    'vitest',
    'npx vitest',
    'pnpm vitest',
    'pnpm exec vitest',
    'yarn vitest',
    'cross-env NODE_ENV=test vitest',
    'vitest --coverage',
    'vitest --watch',
    'vitest --watch=true',
    'vitest dev',
    'jest --watch',
    'jest --watchAll',
    'npm run lint && vitest',
  ])('flags %s', script => {
    expect(watchRules(script)).toEqual(['frequency.watch-default']);
  });

  it.each([
    'vitest run',
    'vitest --run',
    'vitest --watch=false',
    'vitest --watch false',
    'jest --watchAll=false',
    'jest --watch=false',
    'vitest --no-watch',
    'vitest list',
    'vitest typecheck',
    'vitest bench',
    'vitest related src/a.ts',
    'CI=1 vitest',
    'cross-env CI=1 vitest',
    'jest',
    'npm run build',
    'tsc --noEmit && vitest run',
  ])('does not flag %s', script => {
    expect(watchRules(script)).toEqual([]);
  });

  it('words the finding without over-claiming', () => {
    const message = detectFrequency(scriptsTree({ test: 'vitest' }), null)[0]?.message ?? '';
    expect(message).toContain('stdin is a terminal');
    expect(message).toContain('CI is unset');
    expect(message).toContain('vitest run');
  });
});

describe('detectFrequency fixtures', () => {
  const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

  it('finds each planted problem in the bloated fixture exactly once', () => {
    const found = detectFrequency(fixture('bloated'), null).map(finding => `${finding.rule}@${finding.file}`);
    expect(found.sort()).toEqual(
      [
        'frequency.agent-run-all@AGENTS.md',
        'frequency.ci-on-pull-request@.github/workflows/ci.yml',
        'frequency.ci-on-push@.github/workflows/ci.yml',
        'frequency.ci-os-matrix-on-push@.github/workflows/ci.yml',
        'frequency.hook-full-suite@.husky/pre-commit',
        'frequency.hook-full-suite@package.json',
        'frequency.watch-default@package.json',
      ].sort(),
    );
  });

  it('finds nothing in the clean fixture', () => {
    expect(detectFrequency(fixture('clean'), null)).toEqual([]);
  });
});

describe('detectFrequency job if-gates', () => {
  const RECOMMENDED = `on:
  pull_request:
    paths: ['src/**', 'package.json']
  workflow_dispatch:
  schedule:
    - cron: '0 6 * * 1'
  push:
    tags: ['v*']
concurrency:
  group: ci-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  linux:
    if: github.event_name != 'pull_request' || !github.event.pull_request.draft
    runs-on: ubuntu-latest
    steps: []
  os-matrix:
    if: github.event_name != 'pull_request'
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest]
    runs-on: \${{ matrix.os }}
    steps: []
`;

  const macJob = (condition: string | null): string => {
    const gate = condition === null ? '' : `    if: ${condition}\n`;
    return `on:\n  pull_request:\njobs:\n  t:\n${gate}    runs-on: macos-latest\n    steps: []\n`;
  };

  it('accepts the recommended workflow without findings', () => {
    expect(detectFrequency(workflow(RECOMMENDED), null)).toEqual([]);
    expect(detectFrequency(workflow(RECOMMENDED), defaultRiskMap())).toEqual([]);
  });

  it.each([
    "github.event_name != 'pull_request'",
    'github.event_name != "pull_request"',
    "github.event_name!='pull_request'",
    "${{ github.event_name != 'pull_request' }}",
    "github.event_name == 'push'",
    "github.event_name == 'schedule'",
    'github.event_name == "workflow_dispatch"',
    "github.event_name == 'push' || github.event_name == 'schedule'",
  ])('treats a macOS job gated by %s as off the pull-request path', condition => {
    expect(detectFrequency(workflow(macJob(condition)), null)).toEqual([]);
  });

  it.each([
    ['no if at all', null],
    ['a positive pull_request check', "github.event_name == 'pull_request'"],
    ['a condition that ignores the event name', "github.ref == 'refs/heads/main'"],
    ['a draft clause beside a negation', "github.event_name != 'pull_request' || !github.event.pull_request.draft"],
  ])('treats a macOS job with %s as running on pull requests', (_label, condition) => {
    expect(rules(detectFrequency(workflow(macJob(condition)), null))).toEqual(['frequency.ci-on-pull-request']);
  });
});

describe('detectFrequency matrix rule', () => {
  it('fires only for a real matrix, never for a literal runs-on', () => {
    const literal = workflow('on:\n  push:\n    branches: [dev]\njobs:\n  t:\n    runs-on: macos-latest\n    steps: []\n');
    expect(rules(detectFrequency(literal, null))).toEqual(['frequency.ci-on-push']);
    const matrix = workflow('on:\n  push:\n    branches: [dev]\njobs:\n  t:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, macos-latest]\n    runs-on: ${{ matrix.os }}\n    steps: []\n');
    expect(rules(detectFrequency(matrix, null))).toEqual(['frequency.ci-on-push', 'frequency.ci-os-matrix-on-push']);
  });
});

describe('detectFrequency tag-gated and dispatch-gated jobs', () => {
  const macJob = (condition: string): string => `on:\n  pull_request:\njobs:\n  t:\n    if: ${condition}\n    runs-on: macos-latest\n    steps: []\n`;

  it.each([
    "startsWith(github.ref, 'refs/tags/')",
    'startsWith(github.ref, "refs/tags/v")',
    "github.ref_type == 'tag'",
    "github.event_name == 'release'",
    "github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/')",
    "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
    "inputs.full == 'true'",
    "github.event.inputs.os == 'mac'",
    "github.event_name == 'workflow_dispatch' || inputs.full",
    "${{ startsWith(github.ref, 'refs/tags/') && github.event_name == 'push' }}",
  ])('treats a macOS job gated by %s as off the pull-request path', condition => {
    expect(detectFrequency(workflow(macJob(condition)), null)).toEqual([]);
  });

  it.each([
    "startsWith(github.ref, 'refs/heads/')",
    "github.ref == 'refs/heads/main'",
    "github.ref_type != 'tag'",
    "${{ !startsWith(github.ref, 'refs/tags/') }}",
    "github.event_name == 'release' || github.ref == 'refs/heads/main'",
  ])('still flags a macOS job gated by %s', condition => {
    expect(rules(detectFrequency(workflow(macJob(condition)), null))).toEqual(['frequency.ci-on-pull-request']);
  });

  it('keeps the draft-skip Linux job on the pull-request path without findings', () => {
    const root = workflow("on:\n  pull_request:\njobs:\n  linux:\n    if: github.event_name != 'pull_request' || !github.event.pull_request.draft\n    runs-on: ubuntu-latest\n    steps: []\n");
    expect(detectFrequency(root, null)).toEqual([]);
  });
});

describe('detectFrequency test tools at command position', () => {
  const hookRules = (hook: string): string[] => detectFrequency(makeTree({ '.husky/pre-commit': `${hook}\n` }), null).map(finding => finding.rule);

  it.each(['node scripts/vitest.config.js', 'cat jest.config.js', 'npx eslint --plugin jest src', 'node scripts/run-jest-helper.js', 'git diff -- vitest.config.ts', 'grep -r pytest docs'])(
    'does not count %s as running the suite',
    command => {
      expect(hookRules(command)).toEqual([]);
    },
  );

  it.each([
    'npm test',
    'npm run test',
    'pnpm test',
    'vitest run',
    'jest',
    'pytest',
    'npx vitest run',
    'npx --no-install jest',
    'pnpm exec vitest run',
    'yarn jest',
    'bunx vitest run',
    'CI=1 jest',
    'cross-env NODE_ENV=test jest',
    'cross-env NODE_ENV=test npm test',
    'echo start && jest',
    'npm run lint; pytest',
    'python -m pytest',
    './node_modules/.bin/vitest run',
  ])('counts %s as running the suite', command => {
    expect(hookRules(command)).toEqual(['frequency.hook-full-suite']);
  });

  it('does not count vitest.config as a tool even at command position', () => {
    expect(hookRules('vitest.config.js')).toEqual([]);
  });
});

describe('detectFrequency hook line continuations', () => {
  it('joins a backslash continuation so a scope flag on the next line counts', () => {
    expect(detectFrequency(makeTree({ '.husky/pre-commit': 'npx vitest run \\\n  --changed origin/main\n' }), null)).toEqual([]);
  });

  it('reports the first physical line of a continued unscoped command', () => {
    const found = detectFrequency(makeTree({ '.husky/pre-push': 'echo hi\nnpx vitest run \\\n  --reporter dot\n' }), null);
    expect(found.map(finding => `${finding.rule}:${finding.line}`)).toEqual(['frequency.hook-full-suite:2']);
  });

  it('joins continuations inside a lefthook block scalar too', () => {
    const text = 'pre-push:\n  jobs:\n    - run: |\n        npx jest \\\n          --findRelatedTests {push_files}\n';
    expect(detectFrequency(makeTree({ 'lefthook.yml': text }), null)).toEqual([]);
  });
});
