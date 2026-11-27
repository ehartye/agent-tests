import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { controlled, fixture, held, progress } from './native-fixture.ts';

type Control = 'pass' | 'gate' | 'late' | 'malformed' | 'append-error' | 'early-exit';
type Event = { event: string; [key: string]: unknown };
function sensor(path: string) {
  try {
    const events: Event[] = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => {
      const raw = JSON.parse(line);
      const event: Event = { event: String(raw.event).slice(0, 40) };
      for (const key of ['id', 'name', 'at', 'attempt', 'directory', 'path', 'message']) {
        if (typeof raw[key] === 'string') event[key] = raw[key].slice(0, 512);
      }
      for (const key of ['seq', 'sequence', 'pid']) if (Number.isSafeInteger(raw[key])) event[key] = raw[key];
      return event;
    });
    return { status: events[0]?.event === 'ready' ? 'ready' : 'unknown', events: events.slice(0, 8), omitted: Math.max(0, events.length - 8) };
  } catch { return { status: 'unavailable', events: [] as Event[], omitted: 0 }; }
}

function worker(control?: Control) {
  // Give controlled failures their own result batch. The genuine qualification keeps its synchronous assertion.
  const barrier = control && control !== 'early-exit' ? `
    writeFileSync('.local/assertion-ready', 'yes');
    const deadline = Date.now() + 30000;
    while (!existsSync('.local/run-assertion')) {
      if (Date.now() > deadline) throw Error('controlled assertion handshake timed out');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  ` : '';
  return `import { test, expect } from 'vitest';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
let seq = 0;
function trace(event) {
  try { appendFileSync('.local/worker.jsonl', JSON.stringify({ event, seq: ++seq, pid: process.pid, at: new Date().toISOString(), attempt: process.env.AGENT_TESTS_PROGRESS_ATTEMPT, name: 'early assertion' }) + '\\n'); } catch {}
}
trace('ready');
test('early assertion', ${barrier ? 'async ' : ''}() => {
  ${barrier}
  try { expect('prompt actual').toBe('prompt expected'); }
  catch (error) { trace('assertion-threw'); throw error; }
  trace('assertion-returned');
});
test('held later case', async () => {
  ${held.replace('15000', '45000').replace("writeFileSync('.local/b-held','yes');", "writeFileSync('.local/b-held','yes');trace('held');")}
});`;
}

// Faults live in private fixture configs. The real reporter and writer run in every control.
function config(control?: Control) {
  if (control === 'early-exit') return "throw Error('controlled exit before collection');";
  const setup = control === 'gate' || control === 'late' ? `
    const append = fs.appendFileSync;
    fs.appendFileSync = function(path, bytes, ...rest) {
      const result = append.call(fs, path, bytes, ...rest);
      if (String(path).endsWith('held-reporter.jsonl') && JSON.parse(bytes).event === 'callback') {
        const deadline = Date.now() + 30000;
        while (!fs.existsSync('.local/${control === 'late' ? 'release' : 'open-gate'}') && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
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
  const files: Record<string, string> = { 'owner.test.mjs': worker(control) };
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
      try {
        const record = JSON.parse(readFileSync(join(directory, file), 'utf8'));
        const scopes = (record.errors ?? []).map((e: {scope: string}) => String(e.scope).slice(0, 32));
        return { file, status: 'read', kind: String(record.kind).slice(0, 32), owner: record.owner?.id?.slice(0, 128), scopes: scopes.slice(0, 4), omittedScopes: Math.max(0, scopes.length - 4) };
      } catch { return { file, status: 'unreadable', kind: null, scopes: [], omittedScopes: null }; }
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
      omittedEndedOwners: records ? Math.max(0, records.filter(r => r.kind === 'owner-ended').length - 8) : null,
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
    if (control && control !== 'early-exit') {
      await wait('assertion-ready', () => existsSync(join(f.root, '.local/assertion-ready')));
      // The pinned runner batches updates for 100 ms. Separate the controlled assertion
      // from test preparation before allowing the worker to complete it.
      await new Promise(resolve => setTimeout(resolve, 250));
      writeFileSync(join(f.root, '.local/run-assertion'), 'yes');
    }
    await wait('held-marker', () => existsSync(marker));
    if (control === 'gate' || control === 'late') {
      await wait('callback-gate', () => sensor(reporterPath).events.some(e => e.event === 'callback'));
      beforeGate = snapshot();
      if (control === 'late') { phase = 'durable-error'; throw Error('controlled closed gate'); }
      writeFileSync(gate, 'open');
    }
    await wait('durable-error', () => {
      if (control === 'append-error' && sensor(reporterPath).events.some(e => e.event === 'append-error')) throw Error('controlled native-error write failure');
      return visible().some(r => r.kind === 'native-error');
    });
    phase = 'validated-case-error';
    if (control === 'malformed') writeFileSync(join(directory, '99999999.json'), '{');
    const assertOpen = () => {
      const result = progress(f.out);
      const validated = JSON.parse(result.stdout);
      if (result.status !== 0 || validated.problems.length) throw Error('Invalid open-owner progress');
      const owner = validated.owners.find((o: any) => resolve(o.file) === join(f.root, 'owner.test.mjs'));
      if (!owner || owner.ended || validated.endedOwners.length || !validated.records.some((r: any) =>
        r.kind === 'native-error' && r.errors.some((e: any) => e.ownerId === owner.id && e.scope === 'case' && e.error.message.includes('prompt actual')))) {
        throw Error('Missing validated case error in open owner');
      }
    };
    assertOpen();
    await wait('echo', () => /prompt actual/.test(c.output()) && /prompt expected/.test(c.output()));
    assertOpen();
    if (c.child.exitCode !== null || c.child.signalCode !== null) throw Error('Owner closed before echo');
  } catch (error) { failure = error; }
  finally {
    try { beforeRelease = inspect(); }
    finally {
      try { writeFileSync(release, 'yes'); }
      catch (error) { failure ??= error; }
      finally { await c.closed; }
    }
  }
  const final = { ...observer(), at: new Date().toISOString(), released: existsSync(release), worker: sensor(workerPath), reporter: sensor(reporterPath) };
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
        bytes = JSON.stringify({ ...incident, truncated: true, final: { ...final, worker: final.worker.status, reporter: final.reporter.status }, beforeRelease: {
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
