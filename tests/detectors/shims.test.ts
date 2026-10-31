import { describe, expect, it } from 'vitest';
import { detectShims } from '../../src/detectors/shims.ts';
import { parseTestFile } from '../helpers/parse.ts';

const rules = (findings: Array<{ rule: string }>): string[] => findings.map(finding => finding.rule).sort();

describe('detectShims', () => {
  it('flags legacy, compat and fallback markers in titles, paths and imports', () => {
    const parsed = parseTestFile(
      'tests/legacy/compat.test.ts',
      "import { x } from '../../src/legacy/x.ts';\ndescribe('legacy format', () => { it('falls back to defaults', () => {}); });",
    );
    expect(rules(detectShims('tests/legacy/compat.test.ts', parsed))).toEqual(['shim.legacy-import', 'shim.path-marker', 'shim.title-marker']);
  });

  it('does not flag ordinary names', () => {
    const parsed = parseTestFile('tests/store.test.ts', "describe('store', () => { it('saves a value', () => {}); });");
    expect(detectShims('tests/store.test.ts', parsed)).toEqual([]);
  });
});

describe('detectShims tuning', () => {
  const shims = (file: string, source: string) => detectShims(file, parseTestFile(file, source));
  const evidenceOf = (findings: Array<{ rule: string; evidence?: string }>, rule: string): Array<string | undefined> =>
    findings.filter(finding => finding.rule === rule).map(finding => finding.evidence);
  const titled = (title: string): string => `describe(${JSON.stringify(title)}, () => { it('works', () => {}); });`;

  it('attributes each rule to the title, the path or the import that produced it', () => {
    const found = shims(
      'tests/legacy/compat.test.ts',
      "import { x } from '../../src/legacy/x.ts';\ndescribe('legacy format', () => { it('falls back to defaults', () => {}); });",
    );
    expect(evidenceOf(found, 'shim.title-marker')).toEqual(['legacy format']);
    expect(evidenceOf(found, 'shim.path-marker')).toEqual(['tests/legacy/compat.test.ts']);
    expect(evidenceOf(found, 'shim.legacy-import')).toEqual(['../../src/legacy/x.ts']);
    expect(found.find(finding => finding.rule === 'shim.title-marker')?.line).toBe(2);
  });

  it('matches inflected title markers', () => {
    for (const title of [
      'shim for old runtimes',
      'shims the clock',
      'loads the polyfill',
      'polyfills fetch',
      'deprecated option',
      'deprecates the flag',
      'deprecate the flag',
      'deprecation warning',
      'migrates from v1',
      'migrated from v1',
      'migrating from v1',
      'migration from v1',
      'falls back to the legacy parser',
      'fall-back to previous format',
      'fallback shim for old runtimes',
      'keeps the legacy v1 loader shim for old files',
      'loads legacy JSON that only has cellSize',
      'still accepts legacy square cellSize',
      'legacy alias groups migrate with rename',
      'backwards compatible output',
      'back-compat mode',
      'back-compatibility',
      'compat layer',
      'compatibility layer',
      'compatibility with older files',
      'old format input',
      'legacy input',
    ]) {
      const found = shims('tests/a.test.ts', titled(title));
      expect(evidenceOf(found, 'shim.title-marker'), title).toEqual([title]);
    }
  });

  it('stays quiet on near misses', () => {
    for (const title of ['incompatible types', 'shimmer effect', 'legacies of the past', 'falls back to the default', 'compatible values']) {
      expect(shims('tests/a.test.ts', titled(title)), title).toEqual([]);
    }
  });

  it('keeps a title that announces an old-format or shim layer', () => {
    const found = shims('tests/a.test.ts', titled('keeps the legacy v1 loader shim for old files'));
    expect(evidenceOf(found, 'shim.title-marker')).toEqual(['keeps the legacy v1 loader shim for old files']);
  });

  it('stays quiet on titles that describe current fallback, compat or legacy-named behaviour', () => {
    for (const title of [
      'uses the fallback glyph when the font lacks a character',
      'reads the compat shorthand option',
      'uses a fallback',
      'uses fallbacks',
      'fall-back path',
      'legacy horizontal pagination keeps its topology',
      'omitting variants keeps the legacy names, tag and tile bytes',
      'a four-person walk atlas can exceed the legacy 100-frame grid restriction',
      'works without IntersectionObserver through the no-IntersectionObserver path',
    ]) {
      expect(evidenceOf(shims('tests/a.test.ts', titled(title)), 'shim.title-marker'), title).toEqual([]);
    }
  });

  it('caps title evidence at 160 characters', () => {
    const title = `legacy format ${'x'.repeat(300)}`;
    const found = shims('tests/a.test.ts', titled(title));
    expect(evidenceOf(found, 'shim.title-marker')).toEqual([title.slice(0, 160)]);
  });

  it('matches fallback in a path but not look-alike words', () => {
    expect(evidenceOf(shims('tests/fallback/a.test.ts', titled('works')), 'shim.path-marker')).toEqual(['tests/fallback/a.test.ts']);
    expect(shims('tests/incompatible.test.ts', titled('works'))).toEqual([]);
    expect(shims('tests/shimmer.test.ts', titled('works'))).toEqual([]);
    expect(shims('tests/legacies.test.ts', titled('works'))).toEqual([]);
  });

  it('accepts relative and alias import specifiers with a marker segment', () => {
    const source = [
      "import a from './legacy/a.ts';",
      "import b from '@/legacy/b.ts';",
      "import c from '~/compat/c.ts';",
      "import d from '#shims/d.ts';",
      "import e from 'src/deprecated/e.ts';",
      "import f from '../fallback/f.ts';",
    ].join('\n');
    const found = shims('tests/a.test.ts', source);
    expect(evidenceOf(found, 'shim.legacy-import')).toEqual([
      './legacy/a.ts',
      '@/legacy/b.ts',
      '~/compat/c.ts',
      '#shims/d.ts',
      'src/deprecated/e.ts',
      '../fallback/f.ts',
    ]);
    expect(found.every(finding => finding.rule === 'shim.legacy-import')).toBe(true);
  });

  it('excludes ordinary imports and package names with a marker', () => {
    const source = [
      "import a from './store.ts';",
      "import b from '@/store.ts';",
      "import c from 'core-js/shim';",
      "import d from '@babel/polyfill';",
      "import e from 'legacy-package';",
      "import f from 'node:fs';",
    ].join('\n');
    expect(shims('tests/a.test.ts', source)).toEqual([]);
  });

  it('reports a repeated import specifier once', () => {
    const source = "import a from './legacy/a.ts';\nimport b from './legacy/a.ts';\nimport './legacy/a.ts';";
    expect(evidenceOf(shims('tests/a.test.ts', source), 'shim.legacy-import')).toEqual(['./legacy/a.ts']);
  });
});
