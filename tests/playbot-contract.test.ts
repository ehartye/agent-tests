import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {beforeAll, describe, expect, it} from 'vitest';
let createRunRecorder: any, validateConfig: any, summarizeRun: any;
beforeAll(async () => {
  const module = new URL('../scripts/playbot-contract.mjs', import.meta.url);
  expect(existsSync(fileURLToPath(module)), 'producer provides the portable Playbot contract').toBe(true);
  ({createRunRecorder, validateConfig, summarizeRun} = await import(module.href));
});

const capabilities = {simUnits: ['test-tick'], actions: ['commands', 'native-driver', 'ordinary-input'], fallbackAccounting: true};
const provenance = {source: {revision: 'a'.repeat(40), inputsRef: null}, buildRef: null};
const at = (beat = 0, sim = 0, wallMs = 0) => ({beat, sim, wallMs});
function config(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'agent-tests/playbot-config@1', id: 'probe-1', game: 'test-game', adapter: 'test-adapter@1',
    scenario: {id: 'short-probe@1', params: {}}, seeds: {game: null, bot: 7},
    policy: {id: 'local-policy@1', effective: {weights: {advance: .8}, maxDenials: 6}},
    origin: {kind: 'fresh', stateRef: null, prefixRef: null, bot: 'new'},
    transport: {host: 'headless', actions: 'commands', clock: 'controlled', fallback: 'allow-recorded'},
    budget: {beats: 4, sim: {unit: 'test-tick', max: 20}, wallMs: 1000},
    stop: {id: 'local-stop@1', params: {}}, observe: {sampleEveryBeats: 2, tail: 3}, ...overrides,
  };
}
const recorder = (overrides: Record<string, unknown> = {}) => createRunRecorder(config(overrides), {capabilities, provenance, start: at()});
const verdict = (passed = true, targetReached = true) => ({passed, targetReached, checks: [{id: 'actual-state', passed}]});

describe('portable Playbot run evidence', () => {
  it('accepts signed integer seeds without changing native seed semantics', () => {
    expect(recorder({seeds: {game: -1, bot: -7}}).snapshot().config.seeds).toEqual({game: -1, bot: -7});
  });

  it('rejects JSON accessors without executing them', () => {
    let reads = 0;
    const params = Object.defineProperty({}, 'expensive', {enumerable: true, get() {reads++; return 1;}});
    expect(() => recorder({scenario: {id: 'local@1', params}})).toThrow(/JSON/);
    expect(reads).toBe(0);
  });

  it.each([
    ['hidden property', Object.defineProperty({}, 'misspelled', {value: true})],
    ['symbol property', {[Symbol('misspelled')]: true}],
    ['extra array property', Object.assign([1], {misspelled: true})],
    ['sparse array', new Array(2)],
  ])('refuses %s instead of silently dropping JSON input', (_name, value) => {
    expect(() => recorder({scenario: {id: 'local@1', params: {value}}})).toThrow(/JSON/);
  });

  it('keeps confirmation counters and critical tape unchanged when its payload is rejected', () => {
    const record = recorder(), id = record.attempt({name: 'take', route: 'commands', at: at(1, 1, 1)});
    const before = record.snapshot();
    expect(() => record.confirm(id, {status: 'accepted', reason: 'x'.repeat(9000), at: at(1, 1, 2)})).toThrow();
    expect(record.snapshot()).toEqual(before);
    record.confirm(id, {status: 'accepted', at: at(1, 1, 3)});
    expect(record.snapshot().summary.actions.accepted).toBe(1);
  });

  it('can attach actual native and pin evidence after refusing a fallback without changing failure', () => {
    const record = recorder({transport: {host: 'browser', actions: 'ordinary-input', clock: 'native', fallback: 'forbid'}});
    expect(() => record.attempt({name: 'leave', route: 'commands', fallbackReason: 'missing-control', at: at(1, 1, 1)})).toThrow(/fallback/);
    const before = record.snapshot();
    expect(typeof record.attachEvidence).toBe('function');
    const refs = [{kind: 'producer-pin', ref: 'PLAYBOT_VERSION.json'}], native = {ref: 'native-failure.json'};
    record.attachEvidence({evidence: refs, native});
    refs[0].ref = 'mutated'; native.ref = 'mutated';
    const result = record.snapshot();
    expect(result.evidence).toEqual([{kind: 'producer-pin', ref: 'PLAYBOT_VERSION.json'}]);
    expect(result.native).toEqual({ref: 'native-failure.json'});
    expect(result.verdict).toEqual(before.verdict);
    expect(result.termination).toEqual(before.termination);
    expect(result.summary).toEqual(before.summary);
    expect(() => record.confirm(1, {status: 'accepted', at: at(1, 1, 2)})).toThrow(/finished/);
    expect(() => record.attachEvidence({evidence: [], native: {invalid: () => true}})).toThrow(/JSON/);
    expect(record.snapshot()).toEqual(result);
  });

  it('keeps unseeded game attribution and freezes resolved policy independently of caller mutation', () => {
    const input = config(), record = createRunRecorder(input, {capabilities, provenance, start: at()});
    input.policy.effective.weights.advance = 100;
    expect(record.snapshot().config.seeds).toEqual({game: null, bot: 7});
    expect(record.snapshot().config.policy.effective.weights.advance).toBe(.8);
  });

  it('refuses misspelled caps and unsupported adapter clock units rather than ignoring them', () => {
    expect(() => validateConfig(config({budget: {beat: 4, sim: {unit: 'test-tick', max: 20}, wallMs: 1000}}), capabilities)).toThrow(/budget/);
    expect(() => validateConfig(config({budget: {beats: 4, sim: {unit: 'unknown', max: 20}, wallMs: 1000}}), capabilities)).toThrow(/unit/);
    expect(() => validateConfig(config({budget: {beats: null, sim: null, wallMs: 1000}}), capabilities)).toThrow(/work cap/);
  });

  it('refuses exact bot continuation and unproven earned-prefix origins', () => {
    expect(() => recorder({origin: {kind: 'saved', stateRef: 'save.json', prefixRef: null, bot: 'continued'}})).toThrow(/continu/);
    expect(() => recorder({origin: {kind: 'earned-prefix', stateRef: 'state.json', prefixRef: null, bot: 'new'}})).toThrow(/prefix/);
    expect(recorder({origin: {kind: 'saved', stateRef: 'save.json', prefixRef: null, bot: 'new'}}).snapshot().config.origin.kind).toBe('saved');
  });

  it('requires instrumented forbidden fallbacks before ordinary-input admission', () => {
    const input = config({transport: {host: 'browser', actions: 'ordinary-input', clock: 'native', fallback: 'forbid'}});
    expect(() => validateConfig(input, {...capabilities, fallbackAccounting: false})).toThrow(/account/);
    expect(() => validateConfig(config({transport: {...input.transport, fallback: 'allow-recorded'}}), capabilities)).toThrow(/ordinary/);
    expect(validateConfig(input, capabilities).transport.actions).toBe('ordinary-input');
  });

  it('counts a queued delivery as unconfirmed until its actual result is observed', () => {
    const record = recorder();
    const id = record.attempt({name: 'take-item', route: 'commands', at: at(1, 2, 10)});
    expect(record.snapshot().summary.actions).toEqual({attempted: 1, accepted: 0, refused: 0, unconfirmed: 1});
    record.confirm(id, {status: 'accepted', at: at(1, 3, 12)});
    expect(record.snapshot().summary.actions).toEqual({attempted: 1, accepted: 1, refused: 0, unconfirmed: 0});
    expect(() => record.confirm(id, {status: 'accepted', at: at(1, 3, 13)})).toThrow(/pending/);
  });

  it('correlates refusals to the original action and retains their cause', () => {
    const record = recorder();
    const id = record.attempt({name: 'plant', route: 'commands', at: at(1, 1, 10)});
    record.confirm(id, {status: 'refused', reason: 'not-enough-seeds', at: at(1, 1, 11)});
    expect(record.snapshot().summary.refusals).toEqual({'not-enough-seeds': 1});
    expect(record.snapshot().summary.actions.refused).toBe(1);
  });

  it('retains asynchronous native denials without relabeling an accepted command', () => {
    const record = recorder();
    const id = record.attempt({name: 'craft', route: 'commands', at: at(1, 1, 1)});
    record.confirm(id, {status: 'accepted', at: at(1, 1, 1)});
    expect(typeof record.refusal, 'native denial has a shared critical accounting owner').toBe('function');
    record.refusal('inventory-full', {at: at(1, 4, 12)});
    const result = record.snapshot();
    expect(result.summary.actions).toEqual({attempted: 1, accepted: 1, refused: 0, unconfirmed: 0});
    expect(result.summary.refusals).toEqual({'inventory-full': 1});
    expect(result.tail.events.at(-1).kind).toBe('refusal');
  });

  it('retains intent changes and terminal facts outside snapshot sampling', () => {
    const record = recorder();
    record.observe({at: at(1, 1, 1), intent: 'advance'});
    record.observe({at: at(2, 2, 2), intent: 'maintain'});
    const result = record.finish({reason: 'target', detail: 'done', at: at(2, 2, 2), verdict: verdict(), evidence: [], native: null});
    expect(result.tail.events.filter((event: {kind: string}) => event.kind === 'intent-change')).toHaveLength(2);
    expect(result.tail.events.at(-1).kind).toBe('stop');
    expect(result.summary.byIntent).toEqual({advance: 1, maintain: 1});
  });

  it('keeps admitted capability routes stable for the lifetime of the run', () => {
    const supported = {...capabilities, actions: ['native-driver']};
    const record = createRunRecorder(config({transport: {host: 'browser', actions: 'native-driver', clock: 'controlled', fallback: 'allow-recorded'}}), {capabilities: supported, provenance, start: at()});
    supported.actions.push('commands');
    expect(() => record.attempt({name: 'leave', route: 'commands', fallbackReason: 'missing-control', at: at(1, 1, 1)})).toThrow(/route/);
  });

  it('stops before a forbidden alternate delivery and retains the failed run', () => {
    const record = recorder({transport: {host: 'browser', actions: 'native-driver', clock: 'native', fallback: 'forbid'}});
    let dispatched = false;
    expect(() => {
      record.attempt({name: 'chapter-ask-well', route: 'commands', fallbackReason: 'missing-control', at: at(1, 1, 10)});
      dispatched = true;
    }).toThrow(/fallback/);
    expect(dispatched).toBe(false);
    const result = record.snapshot();
    expect(result.phase).toBe('finished');
    expect(result.termination.reason).toBe('input-failure');
    expect(result.verdict.passed).toBe(false);
    expect(result.summary.fallbacks).toBe(1);
    expect(result.tail.events.some((event: {kind: string}) => event.kind === 'fallback')).toBe(true);
  });

  it('records permitted exploratory fallbacks without relabeling transport', () => {
    const record = recorder({transport: {host: 'browser', actions: 'native-driver', clock: 'controlled', fallback: 'allow-recorded'}});
    const id = record.attempt({name: 'leave', route: 'commands', fallbackReason: 'route-unavailable', at: at(1, 2, 20)});
    record.confirm(id, {status: 'accepted', at: at(1, 3, 22)});
    expect(record.snapshot().summary.fallbacks).toBe(1);
    expect(record.snapshot().config.transport.actions).toBe('native-driver');
  });

  it('retains exact counters and omission counts when the diagnostic tail rotates', () => {
    const record = recorder();
    for (let n = 1; n <= 8; n++) {
      const id = record.attempt({name: 'wait', route: 'commands', at: at(n, n, n)});
      record.confirm(id, {status: 'accepted', at: at(n, n, n)});
    }
    const result = record.snapshot();
    expect(result.summary.actions).toEqual({attempted: 8, accepted: 8, refused: 0, unconfirmed: 0});
    expect(result.tail.events).toHaveLength(3);
    expect(result.tail.omitted).toBe(13);
    expect(result.tail.coverage).toBe('tail');
  });

  it('samples snapshots without sampling out critical action or refusal accounting', () => {
    const record = recorder();
    record.observe({at: at(1, 1, 1), intent: 'advance', data: {day: 1}});
    record.observe({at: at(2, 2, 2), intent: 'advance', data: {day: 2}});
    expect(record.snapshot().summary.byIntent).toEqual({advance: 2});
    expect(record.snapshot().tail.events.filter((event: {kind: string}) => event.kind === 'sample')).toHaveLength(1);
  });

  it('counts the completed intent beat even when actions already advanced its clock', () => {
    const record = recorder();
    const id = record.attempt({name: 'plant', route: 'commands', at: at(1, 1, 1)});
    record.confirm(id, {status: 'accepted', at: at(1, 1, 1)});
    record.observe({at: at(1, 1, 1), intent: 'advance'});
    expect(record.snapshot().summary.byIntent).toEqual({advance: 1});
  });

  it('measures simulation budgets relative to the declared starting state', () => {
    const record = createRunRecorder(config(), {capabilities, provenance, start: at(0, 100, 0)});
    expect(record.budget(at(2, 119, 900))).toBeNull();
    expect(record.budget(at(3, 120, 900))).toEqual({kind: 'sim', unit: 'test-tick', max: 20, actual: 20});
    expect(record.budget(at(4, 120, 1000))).toEqual({kind: 'wall', max: 1000, actual: 1000});
  });

  it('allows a checked survival-budget result without inventing target completion', () => {
    const record = recorder();
    const result = record.finish({reason: 'budget', detail: 'max-ticks', at: at(3, 20, 500), verdict: verdict(true, false), native: {schema: 'test-native@1', ref: 'native.json'}, evidence: []});
    expect(result.verdict).toEqual(verdict(true, false));
    expect(result.termination.detail).toBe('max-ticks');
    expect(result.summary.sim).toEqual({unit: 'test-tick', start: 0, end: 20});
    expect(summarizeRun(result)).toContain('budget');
  });

  it('cannot report success with unconfirmed actions or failed checks', () => {
    const queued = recorder(); queued.attempt({name: 'plant', route: 'commands', at: at(1, 2, 10)});
    expect(queued.finish({reason: 'target', detail: 'done', at: at(2, 3, 20), verdict: verdict(), evidence: [], native: null}).verdict.passed).toBe(false);
    const failed = recorder();
    expect(failed.finish({reason: 'target', detail: 'done', at: at(1, 1, 10), verdict: {...verdict(), checks: [{id: 'actual-state', passed: false}]}, evidence: [], native: null}).verdict.passed).toBe(false);
  });

  it('refuses backwards clock observations and mutation after termination', () => {
    const record = recorder(); record.observe({at: at(1, 10, 100), intent: 'advance'});
    expect(() => record.observe({at: at(2, 9, 101), intent: 'advance'})).toThrow(/monotonic/);
    record.finish({reason: 'cancelled', detail: 'owner-shutdown', at: at(1, 10, 100), verdict: verdict(false, false), evidence: [], native: null});
    expect(() => record.attempt({name: 'plant', route: 'commands', at: at(2, 11, 110)})).toThrow(/finished/);
  });

  it('limits pending work and rejects executable or oversized diagnostic payloads', () => {
    const record = recorder();
    expect(() => record.observe({at: at(), intent: 'advance', data: {callback: () => true}})).toThrow(/JSON/);
    expect(() => record.observe({at: at(), intent: 'advance', data: {text: 'x'.repeat(100000)}})).toThrow(/bounded/);
    for (let i = 0; i < 64; i++) record.attempt({name: 'async-action', route: 'commands', at: at()});
    expect(() => record.attempt({name: 'async-action', route: 'commands', at: at()})).toThrow(/pending/);
  });
});
