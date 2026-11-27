/** @lane merge
 * @subject scripts/candidate-vitest-reporter.mjs
 */
import { describe, expect, it } from 'vitest';
import { exerciseHeld } from './helpers/held-vitest.ts';

describe('held Vitest publication controls', () => {
  it('opens a gated callback after sampling the held owner', async () => {
    const { beforeGate, beforeRelease, final } = await exerciseHeld({ control: 'gate' });
    expect(beforeGate).toMatchObject({ held: true, released: false, endedOwners: [], caseError: false });
    expect(beforeGate?.reporter.events.map(e => e.event)).toEqual(['ready', 'callback']);
    expect(beforeRelease).toMatchObject({ held: true, released: false, endedOwners: [], caseError: true, echoActual: true, echoExpected: true });
    expect(beforeRelease.worker.events.map(e => e.event)).toEqual(['ready', 'assertion-threw', 'held']);
    expect(beforeRelease.reporter.events.map(e => e.event)).toEqual(['ready', 'callback', 'append', 'published']);
    expect(final.code).toBe(1);
  }, 90000);

  it('records the real append exception and releases the owner', async () => {
    const { beforeRelease, final } = await exerciseHeld({ control: 'append-error' });
    expect(beforeRelease).toMatchObject({ phase: 'durable-error', held: true, released: false, endedOwners: [], caseError: false });
    expect(beforeRelease.reporter.events.at(-1)).toMatchObject({ event: 'append-error', message: 'controlled native-error write failure' });
    expect(final.code).toBe(1);
  }, 90000);

  it('identifies an observer exit during the marker wait', async () => {
    const { beforeRelease, final } = await exerciseHeld({ control: 'early-exit' });
    expect(beforeRelease).toMatchObject({ phase: 'held-marker', held: false, observer: { code: 1 } });
    expect(final.code).toBe(1);
  }, 90000);
});
