import { test, expect } from '@playwright/test';
const control = process.env.MUTATION_NATIVE_CONTROL;
const mismatch = () => expect('timeout import SyntaxError no tests').toBe('expected');
if (control === 'collection') throw new RangeError('collection RangeError');
if (control === 'import') await import('./missing-native-control.mjs');
if (control === 'beforeEach') test.beforeEach(mismatch);
if (control === 'afterEach') test.afterEach(mismatch);
if (control === 'beforeAll') test.beforeAll(mismatch);
if (control === 'afterAll') test.afterAll(mismatch);
if (control === 'mixed-teardown') test.afterEach(() => { throw new RangeError('teardown RangeError'); });
if (control === 'hook-timeout') test.beforeEach(() => new Promise(() => {}));
const customExpect = control === 'custom' ? expect.extend({ toExplode() { throw new RangeError('custom matcher RangeError'); } }) : expect;
if (['fixture-teardown', 'mixed-fixture'].includes(control)) {
  const fixtureTest = test.extend({ guard: async ({}, use) => { await use('ready'); mismatch(); } });
  fixtureTest('controlled fixture and body', async ({ guard }) => {
    expect(guard).toBe('ready');
    if (control === 'mixed-fixture') expect('timeout import SyntaxError no tests').toBe('expected');
  });
} else if (control === 'skipped') test.skip('skipped population', () => {});
else if (!['no-tests', 'collection', 'import'].includes(control)) {
  if (control === 'retry') test.describe.configure({ retries: 1 });
  test('controlled native body', async ({}, info) => {
    if (control === 'pass') expect(1).toBe(1);
    else if (['assertion', 'mixed-teardown'].includes(control)) expect('timeout import SyntaxError no tests').toBe('expected');
    else if (control === 'ordinary') throw new RangeError('ordinary body RangeError');
    else if (control === 'fake') throw Object.assign(new Error('fabricated assertion identity'), { name: 'AssertionError', actual: 'actual', expected: 'expected', showDiff: true });
    else if (control === 'custom') customExpect(1).toExplode();
    else if (control === 'mixed-throw') { try { mismatch(); } catch {} throw new RangeError('later body RangeError'); }
    else if (['test-timeout', 'global-timeout'].includes(control)) { if (control === 'global-timeout') test.setTimeout(10000); await new Promise(() => {}); }
    else if (control === 'retry' && info.retry === 0) mismatch();
    else if (control === 'expected-failure') { test.fail(); mismatch(); }
    else expect(1).toBe(1);
  });
}
