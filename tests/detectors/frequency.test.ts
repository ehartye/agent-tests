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
