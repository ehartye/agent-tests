/**
 * @lane edit
 * @subject src/discover.ts
 * @subject src/scan.ts
 */
import { existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan } from '../src/scan.ts';
import { EvidenceReport } from '../src/schema.ts';
import { makeTree } from './helpers/tree.ts';

describe('declared standalone browser drivers', () => {
  it.each([false, true])('adds only the declaration to existing scan evidence (mixed languages: %s)', mixed => {
    const root = makeTree({
      'package.json': '{}',
      'tests/first.test.mjs': "import { test } from 'node:test'; test('first', () => {});",
      'tests/second.test.mjs': "import { test } from 'node:test'; test('second', () => {});",
      'tests/browser.mjs': "import { writeFileSync } from 'node:fs'; writeFileSync(new URL('../executed', import.meta.url), 'yes');",
      ...(mixed ? { 'service_test.go': 'package service' } : {}),
    });
    const before = scan(root);
    expect(before).not.toHaveProperty('standaloneBrowserDrivers');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { 'test:browser': 'node tests/browser.mjs' } }));
    const evidence = scan(root);
    expect(evidence.files.map(({ file }) => file)).toEqual(['tests/first.test.mjs', 'tests/second.test.mjs']);
    expect(evidence.runner).toBe('node:test');
    expect(evidence).toEqual({
      ...before,
      standaloneBrowserDrivers: [{ file: 'tests/browser.mjs', scripts: ['test:browser'], inspection: 'uninspected' }],
    });
    expect(EvidenceReport.parse(evidence)).toEqual(evidence);
    expect(existsSync(join(root, 'executed'))).toBe(false);
  });

  it('groups aliases by normalized path and distinguishes completed infrastructure inspections from failed reads', () => {
    const root = makeTree({
      'package.json': JSON.stringify({ scripts: {
        'test:browser:z': 'node "./tests/browser smoke.js" --mode fast',
        'test:browser:a:smoke': "node 'tests/helpers/../browser smoke.js' --label 'two words'",
        'test:browser:helper': 'node tests/helpers/driver.cjs',
        'test:browser:inventoried': 'node tests/unit.test.mjs',
      } }),
      'tests/browser smoke.js': '',
      'tests/helpers/driver.cjs': '',
      'tests/unit.test.mjs': '',
    });
    const uninspected = { file: 'tests/browser smoke.js', scripts: ['test:browser:a:smoke', 'test:browser:z'], inspection: 'uninspected' };
    const helper = { file: 'tests/helpers/driver.cjs', scripts: ['test:browser:helper'] };
    expect(scan(root).standaloneBrowserDrivers).toEqual([uninspected, { ...helper, inspection: 'infrastructure-only' }]);
    expect(scan(root, { readInfrastructure() { throw new Error('read failed'); } }).standaloneBrowserDrivers)
      .toEqual([uninspected, { ...helper, inspection: 'uninspected' }]);
  });

  it('omits missing, out-of-scope and indirect entries, including shell syntax in arguments', () => {
    const external = makeTree({ 'driver.js': '' });
    const commands = [
      '', 'node', 'node missing.mjs', 'node folder.js', 'node driver.ts', 'node fixtures/driver.js',
      `node ../${basename(external)}/driver.js`, 'node linked/driver.js', 'node --trace-warnings driver.js',
      'node linked/../driver.js', 'node fixtures/../driver.js', 'node absent/../driver.js',
      'npm run browser', 'node driver.js && npm test', 'node driver.js | tee log', 'node driver.js > log',
      'node driver.js; true', 'node driver.js\ntrue', 'node driver.js "$(hostname)"', 'node driver.js $LABEL',
      'node driver.js %LABEL%', 'node driver.js *.txt', 'node "unclosed.js', 'node driver.js `hostname`',
    ];
    const scripts = Object.fromEntries(commands.map((cmd, i) => [`test:browser:${i}`, cmd]));
    const root = makeTree({
      'package.json': JSON.stringify({ scripts: { ...scripts, browser: 'node driver.js', 'test:browserish': 'node driver.js' } }),
      'driver.js': '', 'driver.ts': '', 'fixtures/driver.js': '', 'folder.js/child': '',
    });
    symlinkSync(external, join(root, 'linked'), 'junction');
    expect(scan(root)).not.toHaveProperty('standaloneBrowserDrivers');
  });
});
