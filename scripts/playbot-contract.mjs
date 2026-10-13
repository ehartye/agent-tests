// Portable evidence only: no Node imports, game stepping, action delivery or wall-clock owner.
export const CONFIG_SCHEMA = 'agent-tests/playbot-config@1';
export const RESULT_SCHEMA = 'agent-tests/playbot-result@1';
export const CONTRACT_VERSION = 1;
const ROUTES = ['commands', 'native-driver', 'ordinary-input'];
const REASONS = ['target', 'budget', 'policy', 'input-failure', 'error', 'cancelled'];
const MAX_PENDING = 64, MAX_NAMES = 128;
const fail = message => { throw new Error(message); };
const assert = (ok, message) => { if (!ok) fail(message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fields = (value, names, label) => {
  assert(plain(value), label + ' must be a JSON object');
  assert(Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)), label + ' has missing or unknown fields');
};
const text = (value, label, max = 256) => assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, label + ' must be bounded nonempty text');
const number = (value, label, minimum = 0) => assert(typeof value === 'number' && Number.isFinite(value) && value >= minimum, label + ' must be finite and >= ' + minimum);
const integer = (value, label, minimum = 0) => assert(Number.isSafeInteger(value) && value >= minimum, label + ' must be an integer >= ' + minimum);
const oneOf = (value, options, label) => assert(options.includes(value), label + ' is unsupported');
const ref = (value, label) => { if (value !== null) text(value, label, 1024); };

function copy(value, maxBytes = 65536) {
  const seen = new Set();
  let visited = 0;
  const visit = (item, depth) => {
    assert(++visited <= maxBytes, 'JSON payload must have bounded entries');
    assert(depth <= 32, 'JSON payload must have bounded depth');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number') { number(item, 'JSON number', -Number.MAX_VALUE); return item; }
    assert(Array.isArray(item) || plain(item), 'JSON payload cannot contain executable or non-JSON values');
    assert(!seen.has(item), 'JSON payload cannot contain cycles'); seen.add(item);
    const keys = Reflect.ownKeys(item);
    let result;
    if (Array.isArray(item)) {
      assert(keys.length === item.length + 1 && keys.every(key => key === 'length' || typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < item.length), 'JSON arrays cannot contain holes or extra properties');
      result = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        assert(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'), 'JSON arrays cannot contain accessors or hidden entries');
        result.push(visit(descriptor.value, depth + 1));
      }
    } else {
      result = {};
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        assert(typeof key === 'string' && descriptor?.enumerable && Object.hasOwn(descriptor, 'value'), 'JSON objects cannot contain accessors, hidden or symbol properties');
        assert(!['__proto__', 'constructor', 'prototype'].includes(key), 'JSON payload contains an unsafe key');
        result[key] = visit(descriptor.value, depth + 1);
      }
    }
    seen.delete(item); return result;
  };
  const result = visit(value, 0);
  assert(new TextEncoder().encode(JSON.stringify(result)).length <= maxBytes, 'JSON payload must be bounded');
  return result;
}

function position(value) {
  value = copy(value, 1024);
  fields(value, ['beat', 'sim', 'wallMs'], 'observation clock');
  integer(value.beat, 'beat'); number(value.sim, 'sim'); number(value.wallMs, 'wallMs');
  return {...value};
}

export function validateJson(input) { return copy(input); }

export function validateProvenance(input) {
  const identity = copy(input);
  fields(identity, ['source','buildRef'], 'provenance'); fields(identity.source, ['revision','inputsRef'], 'source provenance');
  ref(identity.source.revision, 'source revision'); ref(identity.source.inputsRef, 'source inputs ref'); ref(identity.buildRef, 'build ref');
  return identity;
}

/** Adapters may admit static result metadata before setup, subscriptions or actions. */
export function validateVerdict(input) {
  const result = copy(input);
  fields(result, ['passed','targetReached','checks'], 'verdict');
  assert(typeof result.passed === 'boolean' && typeof result.targetReached === 'boolean' && Array.isArray(result.checks), 'Verdict must contain explicit booleans/checks');
  for (const check of result.checks) { fields(check, ['id','passed'], 'verdict check'); text(check.id, 'check id'); assert(typeof check.passed === 'boolean', 'Check must explicitly pass or fail'); }
  return result;
}

export function validateEvidence(input) {
  assert(Array.isArray(input), 'Evidence must be an explicit JSON array');
  return copy(input);
}

/** Validate the common envelope. The adapter owns validation/resolution of local policy and scenario options. */
export function validateConfig(input, capabilities) {
  const config = copy(input);
  capabilities = copy(capabilities);
  fields(config, ['schema','id','game','adapter','scenario','seeds','policy','origin','transport','budget','stop','observe'], 'config');
  assert(config.schema === CONFIG_SCHEMA, 'Unsupported Playbot config schema');
  for (const name of ['id','game','adapter']) text(config[name], name);
  fields(capabilities, ['simUnits','actions','fallbackAccounting'], 'adapter capabilities');
  assert(Array.isArray(capabilities.simUnits) && Array.isArray(capabilities.actions) && typeof capabilities.fallbackAccounting === 'boolean', 'Invalid adapter capabilities');
  for (const unit of capabilities.simUnits) text(unit, 'adapter sim unit');
  for (const route of capabilities.actions) oneOf(route, ROUTES, 'adapter action route');
  for (const name of ['scenario','stop']) { fields(config[name], ['id','params'], name); text(config[name].id, name + ' id'); assert(plain(config[name].params), name + ' params must be a JSON object'); }
  fields(config.policy, ['id','effective'], 'policy'); text(config.policy.id, 'policy id'); assert(plain(config.policy.effective), 'Effective policy must be a JSON object');
  fields(config.seeds, ['game','bot'], 'seeds');
  if (config.seeds.game !== null) integer(config.seeds.game, 'game seed', -Number.MAX_SAFE_INTEGER); integer(config.seeds.bot, 'bot seed', -Number.MAX_SAFE_INTEGER);
  fields(config.origin, ['kind','stateRef','prefixRef','bot'], 'origin');
  oneOf(config.origin.kind, ['fresh','fixture','earned-prefix','saved'], 'origin kind');
  assert(config.origin.bot === 'new', 'Portable exact bot continuation is unsupported in v1');
  ref(config.origin.stateRef, 'state ref'); ref(config.origin.prefixRef, 'prefix ref');
  if (['saved','earned-prefix'].includes(config.origin.kind)) assert(config.origin.stateRef !== null, 'Saved/prefix origin requires state ref');
  if (config.origin.kind === 'earned-prefix') assert(config.origin.prefixRef !== null, 'Earned prefix origin requires prefix evidence');
  if (config.origin.kind === 'fresh') assert(config.origin.stateRef === null && config.origin.prefixRef === null, 'Fresh origin cannot claim saved/prefix evidence');
  fields(config.transport, ['host','actions','clock','fallback'], 'transport');
  oneOf(config.transport.host, ['headless','browser'], 'host'); oneOf(config.transport.actions, capabilities.actions, 'action route');
  oneOf(config.transport.clock, ['native','controlled'], 'clock'); oneOf(config.transport.fallback, ['allow-recorded','forbid'], 'fallback policy');
  if (config.transport.actions === 'ordinary-input') assert(config.transport.host === 'browser' && config.transport.fallback === 'forbid', 'ordinary input requires browser and forbidden fallback');
  if (config.transport.fallback === 'forbid') assert(capabilities.fallbackAccounting, 'Forbidden fallback requires complete adapter fallback accounting');
  fields(config.budget, ['beats','sim','wallMs'], 'budget');
  if (config.budget.beats !== null) integer(config.budget.beats, 'beat budget', 1);
  if (config.budget.sim !== null) {
    fields(config.budget.sim, ['unit','max'], 'sim budget');
    oneOf(config.budget.sim.unit, capabilities.simUnits, 'sim unit'); number(config.budget.sim.max, 'sim budget', Number.MIN_VALUE);
  }
  assert(config.budget.beats !== null || config.budget.sim !== null, 'A deterministic work cap is required'); number(config.budget.wallMs, 'wall budget', Number.MIN_VALUE);
  fields(config.observe, ['sampleEveryBeats','tail'], 'observe'); integer(config.observe.sampleEveryBeats, 'sample cadence', 1); integer(config.observe.tail, 'tail');
  assert(config.observe.tail <= 10000, 'Diagnostic tail must be bounded');
  return config;
}

/** Cooperative record: owners must check budget at work boundaries and retain their own hard watchdog/cleanup. */
export function createRunRecorder(input, {capabilities, provenance, start}) {
  const admitted = copy(capabilities), config = validateConfig(input, admitted), initial = position(start);
  assert(initial.beat === 0 && initial.wallMs === 0, 'Run starts at beat/wall zero with explicitly declared sim origin');
  const identity = validateProvenance(provenance);
  const pending = new Map(), tail = [], byIntent = {}, refusals = {};
  let last = initial, observedBeat = initial.beat, currentIntent = null, phase = 'running', termination = null, verdict = null, native = null, evidence = [];
  let sequence = 0, actionSequence = 0, attempted = 0, accepted = 0, refused = 0, fallbacks = 0, omitted = 0;
  const active = () => assert(phase === 'running', 'Playbot run is already finished');
  const checkAt = value => {
    const next = position(value);
    assert(next.beat >= last.beat && next.sim >= last.sim && next.wallMs >= last.wallMs, 'Observation clocks must be monotonic');
    return next;
  };
  const event = (kind, payload, at) => {
    const entry = {seq: ++sequence, run: config.id, ...at, kind, payload: copy(payload, 8192)};
    if (config.observe.tail === 0) omitted++;
    else { tail.push(entry); if (tail.length > config.observe.tail) { tail.shift(); omitted++; } }
  };
  const count = (map, name, amount = 1) => {
    text(name, 'counter name'); assert(!['__proto__','constructor','prototype'].includes(name), 'Unsafe counter name');
    assert(Object.hasOwn(map, name) || Object.keys(map).length < MAX_NAMES, 'Counter names must be bounded');
    map[name] = (map[name] ?? 0) + amount;
  };
  const snapshot = () => copy({
    schema: RESULT_SCHEMA, config, provenance: {...identity, contractVersion: CONTRACT_VERSION}, phase, termination, verdict,
    summary: {beats: last.beat, sim: {unit: config.budget.sim?.unit ?? null, start: initial.sim, end: last.sim}, wallMs: last.wallMs,
      byIntent, actions: {attempted, accepted, refused, unconfirmed: pending.size}, fallbacks, refusals},
    tail: {events: tail, omitted, coverage: omitted ? 'tail' : 'full'}, evidence, native,
  }, 64 * 1024 * 1024);
  const attachEvidence = ({evidence: refs, native: nativeReport}) => {
    const nextEvidence = validateEvidence(refs), nextNative = copy(nativeReport);
    evidence = nextEvidence; native = nextNative;
  };
  return {
    snapshot,
    // Attribution may be finalized after strict refusal; verdict/actions remain closed.
    attachEvidence,
    budget(at) {
      active(); const current = checkAt(at), budget = config.budget;
      // This is only a prioritized budget observation, not the game's target/death/stop precedence.
      if (current.wallMs >= budget.wallMs) return {kind: 'wall', max: budget.wallMs, actual: current.wallMs};
      if (budget.beats !== null && current.beat >= budget.beats) return {kind: 'beats', max: budget.beats, actual: current.beat};
      const elapsed = current.sim - initial.sim;
      if (budget.sim && elapsed >= budget.sim.max) return {kind: 'sim', unit: budget.sim.unit, max: budget.sim.max, actual: elapsed};
      return null;
    },
    observe({at, intent, data}) {
      active(); const next = checkAt(at), payload = data === undefined ? null : copy(data, 4096);
      if (intent !== undefined) {
        text(intent, 'intent'); count(byIntent, intent, next.beat - observedBeat);
        if (intent !== currentIntent) { event('intent-change', {from: currentIntent, to: intent}, next); currentIntent = intent; }
      }
      observedBeat = next.beat; last = next;
      if (payload !== null && next.beat % config.observe.sampleEveryBeats === 0) event('sample', {intent: intent ?? null, data: payload}, next);
    },
    attempt({name, route, at, fallbackReason = null}) {
      active(); text(name, 'action name'); oneOf(route, admitted.actions, 'action route');
      const next = checkAt(at); assert(pending.size < MAX_PENDING, 'Too many pending actions');
      const alternate = route !== config.transport.actions;
      if (alternate) text(fallbackReason, 'fallback reason');
      const id = ++actionSequence; attempted++; pending.set(id, {name, route}); last = next;
      event('action-attempt', {id, name, route}, next);
      if (alternate) {
        fallbacks++; event('fallback', {id, name, route, intendedRoute: config.transport.actions, reason: fallbackReason}, next);
        if (config.transport.fallback === 'forbid') {
          phase = 'finished'; termination = {reason: 'input-failure', detail: 'fallback-forbidden', at: next};
          verdict = {passed: false, targetReached: false, checks: [{id: 'forbidden-fallback', passed: false}]};
          event('stop', {reason: termination.reason, detail: termination.detail}, next);
          fail('Forbidden Playbot fallback: ' + fallbackReason);
        }
      }
      return id;
    },
    confirm(id, {status, reason = null, at}) {
      active(); integer(id, 'action id', 1); assert(pending.has(id), 'Action result must correlate to a pending attempt');
      oneOf(status, ['accepted','refused'], 'action result'); const next = checkAt(at);
      if (status === 'refused' || reason !== null) text(reason, 'action result reason');
      const action = pending.get(id);
      if (status === 'accepted') accepted++; else { count(refusals, reason); refused++; }
      pending.delete(id); last = next; event('action-result', {id, ...action, status, reason}, next);
    },
    refusal(reason, {at}) {
      active(); text(reason, 'refusal reason'); const next = checkAt(at);
      count(refusals, reason); last = next; event('refusal', {reason}, next);
    },
    progress(name, {at, data = null}) {
      active(); text(name, 'progress name'); const next = checkAt(at), payload = copy(data, 4096);
      last = next; event('progress', {name, data: payload}, next);
    },
    finish({reason, detail, at, verdict: requested, evidence: refs, native: nativeReport}) {
      active(); oneOf(reason, REASONS, 'termination'); text(detail, 'termination detail', 1024);
      const next = checkAt(at), result = validateVerdict(requested);
      attachEvidence({evidence: refs, native: nativeReport});
      const invalid = ['input-failure','error','cancelled'].includes(reason) || pending.size > 0 || result.checks.some(check => !check.passed) || (reason === 'target' && !result.targetReached);
      result.passed = result.passed && !invalid; last = next; phase = 'finished'; termination = {reason, detail, at: next}; verdict = result;
      event(reason === 'error' ? 'error' : 'stop', {reason, detail}, next);
      return snapshot();
    },
  };
}

export function summarizeRun(result) {
  assert(result?.schema === RESULT_SCHEMA, 'Unsupported Playbot result schema');
  const {config, summary} = result;
  return `${config.game}/${config.scenario.id} ${result.phase}: ${result.termination?.reason ?? 'running'} (${result.termination?.detail ?? '-'}) ${result.verdict?.passed ? 'PASS' : result.verdict ? 'FAIL' : 'pending'}; `
    + `${summary.beats} beats, ${summary.wallMs}ms, ${summary.actions.accepted}/${summary.actions.attempted} confirmed actions, ${summary.actions.unconfirmed} unconfirmed, ${summary.fallbacks} fallbacks; `
    + `${config.transport.host}/${config.transport.actions}/${config.transport.clock}; origin=${config.origin.kind}, bot=${config.origin.bot}; tape=${result.tail.coverage} (${result.tail.omitted} omitted)`;
}
