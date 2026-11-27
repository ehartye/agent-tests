import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { controlled, fixture, held, progress } from './native-fixture.ts';

type Control = 'gate' | 'append-error' | 'early-exit';
type Event = { event: string; [key: string]: unknown };
function sensor(path: string) {
  try {
    const events: Event[] = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
    return { status: events[0]?.event === 'ready' ? 'ready' : 'unknown', events: events.slice(0, 8), omitted: Math.max(0, events.length - 8) };
  } catch { return { status: 'unavailable', events: [] as Event[], omitted: 0 }; }
}

const worker = `import { test, expect } from 'vitest';
import { appendFileSync } from 'node:fs';
let seq = 0;
function trace(event) {
  try { appendFileSync('.local/worker.jsonl', JSON.stringify({ event, seq: ++seq, pid: process.pid, at: new Date().toISOString(), attempt: process.env.AGENT_TESTS_PROGRESS_ATTEMPT, name: 'early assertion' }) + '\\n'); } catch {}
}
trace('ready');
test('early assertion', () => {
  try { expect('prompt actual').toBe('prompt expected'); }
  catch (error) { trace('assertion-threw'); throw error; }
  trace('assertion-returned');
});
test('held later case', async () => {
  ${held.replace('15000', '45000').replace("writeFileSync('.local/b-held','yes');", "writeFileSync('.local/b-held','yes');trace('held');")}
});`;

// Faults live in private fixture configs. The real reporter and writer run in every control.
function config(control?: Control) {
  if (control === 'early-exit') return "throw Error('controlled exit before collection');";
  const setup = control === 'gate' ? `
    const append = fs.appendFileSync;
    fs.appendFileSync = function(path, bytes, ...rest) {
      const result = append.call(fs, path, bytes, ...rest);
      if (String(path).endsWith('held-reporter.jsonl') && JSON.parse(bytes).event === 'callback') {
        const deadline = Date.now() + 30000;
        while (!fs.existsSync('.local/open-gate') && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
      return result;
    };
  ` : control === 'append-error' ? `
    const link = fs.linkSync;
    fs.linkSync = function(from, to) {
      if (String(to).endsWith('.json') && JSON.parse(fs.readFileSync(from)).kind === 'native-error') throw Error('controlled native-error write failure');
      return link.call(fs, from, to);
    };
  ` : '';
  return `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module'; ${setup}
    syncBuiltinESMExports(); export default {};`;
}

export async function exerciseHeld(options: { control?: Control } = {}) {
  const { control } = options;
  const files: Record<string, string> = { 'owner.test.mjs': worker };
  if (control) files['vitest.config.mjs'] = config(control);
  const f = fixture(files, true);
  const marker = join(f.root, '.local/b-held'), release = join(f.root, '.local/release');
  const gate = join(f.root, '.local/open-gate'), directory = join(f.out, 'progress');
  const reporterPath = join(f.out, 'held-reporter.jsonl'), workerPath = join(f.root, '.local/worker.jsonl');
  const c = controlled(f, 'vitest', ['owner.test.mjs', '--testTimeout=60000'], [], { ...process.env, AGENT_TESTS_HELD_TRACE: f.out });
  let phase = 'held-marker';
  const observer = () => ({ pid: c.child.pid, code: c.child.exitCode, signal: c.child.signalCode });
  function visible() {
    return readdirSync(directory).filter(n => /^\d{8}\.json$/.test(n)).sort().map(file => {
      const record = JSON.parse(readFileSync(join(directory, file), 'utf8'));
      return { file, kind: record.kind, owner: record.owner?.id, scopes: (record.errors ?? []).map((e: {scope: string}) => e.scope).slice(0, 4) };
    });
  }
  function snapshot() {
    let records: ReturnType<typeof visible> | null = null;
    try { records = visible(); } catch { /* Early exits may have no readable records. */ }
    const lines = c.output().split(/\r?\n/).filter(line => /prompt actual|prompt expected|controlled native-error write failure/.test(line));
    return {
      phase, at: new Date().toISOString(), marker, release, directory, held: existsSync(marker), released: existsSync(release), observer: observer(),
      worker: sensor(workerPath), reporter: sensor(reporterPath),
      records: records?.slice(0, 16) ?? null, omittedRecords: records ? Math.max(0, records.length - 16) : null,
      endedOwners: records?.filter(r => r.kind === 'owner-ended').map(r => r.owner).slice(0, 8) ?? null,
      caseError: records?.some(r => r.kind === 'native-error' && r.scopes.includes('case')) ?? null,
      echoActual: /prompt actual/.test(c.output()), echoExpected: /prompt expected/.test(c.output()),
      output: lines.slice(0, 8).map(line => line.slice(0, 256)), outputTruncated: lines.length > 8 || lines.some(l => l.length > 256),
    };
  }
  function inspect() {
    try { return snapshot(); }
    catch { return { phase, at: new Date().toISOString(), marker, release, directory, observer: observer(), unavailable: true }; }
  }
  async function wait(name: string, predicate: () => boolean) {
    phase = name;
    const deadline = Date.now() + 30000;
    while (!predicate()) {
      if (c.child.exitCode !== null || c.child.signalCode !== null) throw Error('Observer exited during ' + name);
      if (Date.now() >= deadline) throw Error('Marker deadline: ' + name);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  let beforeGate, beforeRelease;
  let failure: unknown;
  try {
    await wait('held-marker', () => existsSync(marker));
    if (control === 'gate') {
      await wait('callback-gate', () => sensor(reporterPath).events.some(e => e.event === 'callback'));
      beforeGate = snapshot();
      writeFileSync(gate, 'open');
    }
    await wait('durable-error', () => {
      if (control === 'append-error' && sensor(reporterPath).events.some(e => e.event === 'append-error')) throw Error('controlled native-error write failure');
      return visible().some(r => r.kind === 'native-error');
    });
    phase = 'validated-case-error';
    const state = () => JSON.parse(progress(f.out).stdout);
    const validated = state();
    if (validated.endedOwners.length || !validated.records.some((r: any) => r.kind === 'native-error' && r.errors.some((e: any) => e.scope === 'case' && e.error.message.includes('prompt actual')))) throw Error('Missing validated case error in open owner');
    await wait('echo', () => /prompt actual/.test(c.output()) && /prompt expected/.test(c.output()));
    if (state().endedOwners.length || c.child.exitCode !== null || c.child.signalCode !== null) throw Error('Owner closed before echo');
  } catch (error) { failure = error; }
  finally {
    try { beforeRelease = inspect(); }
    finally {
      try { writeFileSync(release, 'yes'); }
      catch (error) { failure ??= error; }
      finally { await c.closed; }
    }
  }
  const final = { ...observer(), at: new Date().toISOString(), released: existsSync(release) };
  if (!failure && final.code !== 1) { phase = 'final-exit'; failure = Error('Expected observer exit 1, got ' + final.code); }
  if (process.env.AGENT_TESTS_NATIVE_EVIDENCE_DIR) {
    try { writeFileSync(join(f.base, 'held-samples.json'), JSON.stringify({ control, beforeGate, beforeRelease, final })); }
    catch { /* Optional local certification copy. */ }
  }
  return { beforeGate, beforeRelease, final, failure, phase };
}

export async function qualifyHeld(destination?: string, control?: Control) {
  const { beforeRelease, final, failure, phase } = await exerciseHeld({ control });
  if (!failure) return;
  if (destination) {
    try {
      const incident = { schema: 'agent-tests/held-vitest-incident@1', phase, beforeRelease, final };
      let bytes = JSON.stringify(incident);
      if (Buffer.byteLength(bytes) > 65536) {
        bytes = JSON.stringify({ ...incident, truncated: true, beforeRelease: {
          phase: beforeRelease.phase, at: beforeRelease.at, observer: beforeRelease.observer,
          held: 'held' in beforeRelease ? beforeRelease.held : null,
          released: 'released' in beforeRelease ? beforeRelease.released : null,
          worker: 'worker' in beforeRelease ? beforeRelease.worker.status : 'unavailable',
          reporter: 'reporter' in beforeRelease ? beforeRelease.reporter.status : 'unavailable',
        } });
      }
      mkdirSync(destination, { recursive: true });
      const temporary = join(destination, 'incident.tmp');
      writeFileSync(temporary, bytes, { flag: 'wx' });
      renameSync(temporary, join(destination, 'incident.json'));
    } catch (error) {
      console.error('Held Vitest incident write failed:', error instanceof Error ? error.message : 'unknown');
    }
  }
  throw failure;
}
