/** @lane merge
 * @subject scripts/candidate-vitest-reporter.mjs
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { exerciseHeld, qualifyHeld } from './helpers/held-vitest.ts';

const roots: string[] = [];
function destination() {
  const root = mkdtempSync(join(tmpdir(), 'held-control-'));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true }); });

describe('held Vitest publication controls', () => {
  it('opens a gated callback after sampling the held owner', async () => {
    const { beforeGate, beforeRelease, final } = await exerciseHeld({ control: 'gate' });
    expect(beforeGate).toMatchObject({ held: true, released: false, endedOwners: [], caseError: false });
    expect(beforeGate?.reporter.events.map(e => e.event)).toEqual(['ready', 'callback']);
    expect(beforeRelease).toMatchObject({ held: true, released: false, endedOwners: [], caseError: true, echoActual: true, echoExpected: true });
    if (!('worker' in beforeRelease)) throw Error('Unavailable fixture snapshot');
    expect(beforeRelease.worker.events.map(e => e.event)).toEqual(['ready', 'assertion-threw', 'held']);
    expect(beforeRelease.reporter.events.map(e => e.event)).toEqual(['ready', 'callback', 'append', 'published']);
    expect(final.code).toBe(1);
  }, 90000);

  it('records the real append exception and releases the owner', async () => {
    const { beforeRelease, final } = await exerciseHeld({ control: 'append-error' });
    expect(beforeRelease).toMatchObject({ phase: 'durable-error', held: true, released: false, endedOwners: [], caseError: false });
    if (!('reporter' in beforeRelease)) throw Error('Unavailable fixture snapshot');
    expect(beforeRelease.reporter.events.at(-1)).toMatchObject({ event: 'append-error', message: 'controlled native-error write failure' });
    expect(final.code).toBe(1);
  }, 90000);

  it('publishes only a completed failure after release and preserves the original exception', async () => {
    const root = destination();
    await expect(qualifyHeld(root, 'append-error')).rejects.toThrow('controlled native-error write failure');
    const bytes = readFileSync(join(root, 'incident.json'));
    expect(bytes.length).toBeLessThanOrEqual(64 * 1024);
    const incident = JSON.parse(bytes.toString());
    expect(incident.beforeRelease).toMatchObject({ phase: 'durable-error', released: false, caseError: false });
    expect(incident.final).toMatchObject({ code: 1, released: true });
    expect(incident.beforeRelease.reporter.events.at(-1).event).toBe('append-error');
  }, 90000);

  it('keeps the marker failure when incident publication fails', async () => {
    const file = join(destination(), 'occupied');
    writeFileSync(file, 'untouched');
    await expect(qualifyHeld(file, 'early-exit')).rejects.toThrow('Observer exited during held-marker');
    expect(readFileSync(file, 'utf8')).toBe('untouched');
  }, 90000);

  it('produces no incident for a passing qualification', async () => {
    const root = destination();
    await qualifyHeld(root);
    expect(existsSync(join(root, 'incident.json'))).toBe(false);
  }, 90000);

  it('identifies an observer exit during the marker wait', async () => {
    const { beforeRelease, final } = await exerciseHeld({ control: 'early-exit' });
    expect(beforeRelease).toMatchObject({ phase: 'held-marker', held: false, observer: { code: 1 } });
    expect(final.code).toBe(1);
  }, 90000);
});
