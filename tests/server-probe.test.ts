/**
 * @lane merge
 * @subject scripts/server-probe.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyConnectError, overallOutcome, parseArgs } from '../scripts/server-probe.mjs';
import { physicalTemp } from './helpers/physical-temp.ts';

const script = fileURLToPath(new URL('../scripts/server-probe.mjs', import.meta.url));

interface Run { status: number | null; stdout: string; stderr: string; ms: number }
// The probe runs as a child process and the owned listeners live in this process, so the child must be asynchronous.
function probe(args: string[], options: { cwd?: string; env?: Record<string, string>; stdin?: string; entry?: string } = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, [options.entry ?? script, ...args], { cwd: options.cwd, env: { ...process.env, ...options.env }, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.stdin.on('error', () => {});
    child.stdin.end(options.stdin ?? '');
    child.on('close', status => resolve({ status, stdout, stderr, ms: performance.now() - started }));
  });
}
const report = (run: Run) => {
  expect(run.stderr).toBe('');
  expect(run.stdout.trimEnd().split('\n')).toHaveLength(1);
  return JSON.parse(run.stdout);
};

const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();
const made: string[] = [];
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(done => { if (server.listening) server.close(() => done()); else done(); })));
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** Opens an owned listener on an ephemeral port and counts the connections it accepts. */
async function listen<T extends net.Server>(server: T, host = '127.0.0.1'): Promise<{ server: T; port: number; accepted: () => number }> {
  let accepted = 0;
  server.on('connection', socket => { accepted += 1; sockets.add(socket); });
  servers.push(server);
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, host, done); });
  return { server, port: (server.address() as net.AddressInfo).port, accepted: () => accepted };
}
const httpServer = (status: number, delayMs = 0) => http.createServer((_request, response) => {
  setTimeout(() => response.writeHead(status, { 'content-type': 'text/plain', server: 'fixture' }).end('body'), delayMs);
});
const blackhole = () => net.createServer(() => {});
const garbage = () => net.createServer(socket => { socket.write('garbage\r\n'); });
/** A raw listener whose per-connection behavior is scripted; timers it starts stop when the connection closes. */
const raw = (behave: (socket: net.Socket, every: (ms: number, tick: () => void) => void) => void) => net.createServer(socket => {
  const timers: NodeJS.Timeout[] = [];
  socket.on('error', () => {});
  socket.on('close', () => timers.forEach(clearInterval));
  behave(socket, (ms, tick) => { timers.push(setInterval(tick, ms)); });
});
async function closedPort(): Promise<number> {
  const { server, port } = await listen(net.createServer());
  await new Promise<void>(done => server.close(() => done()));
  return port;
}
const ipv6 = await new Promise<boolean>(done => {
  const server = net.createServer();
  server.once('error', () => done(false));
  server.listen(0, '::1', () => server.close(() => done(true)));
});

describe('responding: any HTTP response is reported with its evidence', () => {
  it.each([200, 404, 500])('a listener replying %i is responding and meets the default expectation', async status => {
    const { port } = await listen(httpServer(status));
    const run = await probe(['--port', String(port), '--host', '127.0.0.1']);
    const result = report(run);
    expect(run.status).toBe(0);
    expect(result).toMatchObject({
      schema: 'agent-tests/server-probe@1', target: { host: '127.0.0.1', port }, outcome: 'responding', expect: 'responding', met: true, limits: { timeoutMs: 3000 },
      families: [{ address: '127.0.0.1', outcome: 'responding', connect: { ok: true }, http: { status, server: 'fixture', contentType: 'text/plain' } }],
    });
    expect(Number.isNaN(Date.parse(result.probedAt))).toBe(false);
  });

  it.skipIf(!ipv6)('the default host probes both loopback families', async () => {
    const { port } = await listen(httpServer(200), '::');
    const result = report(await probe(['--port', String(port)]));
    expect(result).toMatchObject({ target: { host: 'localhost', port }, outcome: 'responding', met: true });
    expect(result.families.map((family: { address: string; outcome: string }) => [family.address, family.outcome])).toEqual([['127.0.0.1', 'responding'], ['::1', 'responding']]);
  });
});

describe('closed: nothing is listening', () => {
  it.each([
    { args: ['--expect', 'closed'], status: 0, met: true },
    { args: [], status: 1, met: false },
  ])('a released port with $args exits $status', async ({ args, status, met }) => {
    const port = await closedPort();
    const run = await probe(['--port', String(port), ...args]);
    const result = report(run);
    expect(run.status).toBe(status);
    expect(result).toMatchObject({ outcome: 'closed', met });
    expect(result.families.length).toBeGreaterThan(0);
    for (const family of result.families) expect(family).toMatchObject({ outcome: 'closed', connect: { ok: false } });
    expect(result.families.some((family: { http?: unknown }) => 'http' in family)).toBe(false);
  });
});

describe('occupied: TCP connects but HTTP does not answer', () => {
  it('a blackhole listener times out, is probed once and is left untouched', async () => {
    const { server, port, accepted } = await listen(blackhole());
    const run = await probe(['--port', String(port), '--host', '127.0.0.1', '--timeout-ms', '300']);
    const result = report(run);
    expect(run.status).toBe(1);
    expect(run.ms).toBeLessThan(2 * 300 + 2000); // the spec bound is 2 x timeout + 250 ms; child startup and a loaded runner are included here
    expect(result).toMatchObject({ outcome: 'occupied-no-http-response', met: false, limits: { timeoutMs: 300 } });
    expect(result.families[0]).toMatchObject({ connect: { ok: true }, http: { timedOut: true } });
    await new Promise(done => setTimeout(done, 50));
    expect(accepted()).toBe(1);
    expect(server.listening).toBe(true);
  });

  it('a listener that is not HTTP is occupied with a parser error code', async () => {
    const { server, port } = await listen(garbage());
    const result = report(await probe(['--port', String(port), '--host', '127.0.0.1']));
    expect(result.outcome).toBe('occupied-no-http-response');
    expect(typeof result.families[0].http.error).toBe('string');
    expect(result.families[0].http.error.length).toBeGreaterThan(0);
    expect(server.listening).toBe(true);
  });

  it.each([
    { timeoutMs: 2000, outcome: 'responding', status: 0 },
    { timeoutMs: 100, outcome: 'occupied-no-http-response', status: 1 },
  ])('a reply after 300 ms with a $timeoutMs ms timeout is $outcome', async ({ timeoutMs, outcome, status }) => {
    const { port } = await listen(httpServer(200, 300));
    const run = await probe(['--port', String(port), '--host', '127.0.0.1', '--timeout-ms', String(timeoutMs)]);
    expect(report(run).outcome).toBe(outcome);
    expect(run.status).toBe(status);
  });
});

describe('any HTTP reply counts, including interim and upgrade replies', () => {
  it.each([
    { name: '100 Continue', reply: 'HTTP/1.1 100 Continue\r\n\r\n', status: 100 },
    { name: '103 Early Hints', reply: 'HTTP/1.1 103 Early Hints\r\nLink: </a.css>; rel=preload\r\n\r\n', status: 103 },
    { name: '101 Switching Protocols', reply: 'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n', status: 101 },
  ])('a listener sending $name and then nothing is responding with that status', async ({ reply, status }) => {
    const { port } = await listen(raw(socket => { socket.write(reply); }));
    const run = await probe(['--port', String(port), '--host', '127.0.0.1', '--timeout-ms', '3000']);
    expect(run.status).toBe(0);
    expect(run.ms).toBeLessThan(2500);
    expect(report(run)).toMatchObject({ outcome: 'responding', met: true, families: [{ outcome: 'responding', http: { status } }] });
  });
});

describe('the exit stays bounded whatever the listener does', () => {
  // The spec bound is 2 x timeout + 250 ms; the margin here covers child startup and a loaded runner.
  const timeoutMs = 500;
  it.each([
    { name: 'drips a status line one byte at a time', make: () => raw((socket, every) => { let at = 0; every(100, () => { if (at < 17) socket.write('HTTP/1.1 200 OK\r\n'[at++]); }); }), outcome: 'occupied-no-http-response', timedOut: true },
    { name: 'streams header lines forever', make: () => raw((socket, every) => { socket.write('HTTP/1.1 200 OK\r\n'); every(1, () => socket.write(`X-Pad: ${'a'.repeat(1000)}\r\n`)); }), outcome: 'occupied-no-http-response', timedOut: false },
    { name: 'sends headers and never ends the body', make: () => raw(socket => { socket.write('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial'); }), outcome: 'responding', timedOut: false },
    { name: 'resets the connection after accepting it', make: () => raw(socket => { socket.resetAndDestroy(); }), outcome: 'occupied-no-http-response', timedOut: false },
    { name: 'closes the connection after accepting it', make: () => raw(socket => { socket.end(); }), outcome: 'occupied-no-http-response', timedOut: false },
  ])('a listener that $name is $outcome', async ({ make, outcome, timedOut }) => {
    const { port } = await listen(make());
    const run = await probe(['--port', String(port), '--host', '127.0.0.1', '--timeout-ms', String(timeoutMs)]);
    const result = report(run);
    expect(run.ms).toBeLessThan(2 * timeoutMs + 2000);
    expect(run.status).toBe(outcome === 'responding' ? 0 : 1);
    expect(result.outcome).toBe(outcome);
    if (outcome === 'occupied-no-http-response') expect(typeof result.families[0].http.error).toBe('string');
    if (timedOut) expect(result.families[0].http.timedOut).toBe(true);
  });
});

describe.skipIf(!ipv6)('an IPv6-only listener is never read as closed', () => {
  it.each([
    { name: 'answering HTTP', make: () => httpServer(200), outcome: 'responding' },
    { name: 'silent', make: blackhole, outcome: 'occupied-no-http-response' },
  ])('a $name listener on ::1 with the default host and --expect closed', async ({ make, outcome }) => {
    const { port } = await listen(make(), '::1');
    const run = await probe(['--port', String(port), '--expect', 'closed', '--timeout-ms', '3000']);
    const result = report(run);
    expect(run.status).toBe(1);
    expect(result).toMatchObject({ outcome, expect: 'closed', met: false });
    expect(result.families.map((family: { address: string; outcome: string }) => [family.address, family.outcome])).toEqual([['127.0.0.1', 'closed'], ['::1', outcome]]);
  });
});

describe('pure decisions', () => {
  it.each([
    ['ECONNREFUSED', 'closed'], ['EADDRNOTAVAIL', 'closed'], ['EAFNOSUPPORT', 'closed'],
    ['ETIMEDOUT', 'unreachable'], ['EHOSTUNREACH', 'unreachable'], ['ENETUNREACH', 'unreachable'], ['ECONNRESET', 'unreachable'],
  ])('classifies connect error %s as %s', (code, outcome) => {
    expect(classifyConnectError({ code })).toBe(outcome);
  });
  it('classifies a connect timeout and an unknown error as unreachable', () => {
    expect(classifyConnectError({ timedOut: true })).toBe('unreachable');
    expect(classifyConnectError(new Error('boom'))).toBe('unreachable');
  });

  it('orders the overall outcome responding, occupied, unreachable, closed for every family combination', () => {
    const order = ['responding', 'occupied-no-http-response', 'unreachable', 'closed'];
    for (const first of order) {
      expect(overallOutcome([first])).toBe(first);
      for (const second of order) expect(overallOutcome([first, second])).toBe(order[Math.min(order.indexOf(first), order.indexOf(second))]);
    }
  });

  it('parses defaults and both flag spellings', () => {
    expect(parseArgs(['--port', '5173'])).toEqual({ port: 5173, host: 'localhost', timeoutMs: 3000, expect: 'responding' });
    expect(parseArgs(['--port=5173', '--host=::1', '--timeout-ms=1', '--expect=closed'])).toEqual({ port: 5173, host: '::1', timeoutMs: 1, expect: 'closed' });
  });
});

describe('usage errors', () => {
  it.each([
    [], ['--port'], ['--port', 'abc'], ['--port', '0'], ['--port', '65536'], ['--port', '80.5'],
    ['--port', '80', '--host', 'example.com'], ['--port', '80', '--host', '0.0.0.0'], ['--port', '80', '--expect', 'maybe'],
    ['--port', '80', '--timeout-ms', '0'], ['--port', '80', '--timeout-ms', '60001'], ['--port', '80', '--verbose'],
    ['--port', '80', '--port', '81'], ['80'],
  ].map(args => ({ args })))('$args exits 2 with E_USAGE on stderr and nothing on stdout', async ({ args }) => {
    const run = await probe(args);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(JSON.parse(run.stderr)).toMatchObject({ error: { code: 'E_USAGE', message: expect.any(String), hint: expect.any(String) } });
  });
});

describe('launch', () => {
  it('a script piped to node on stdin still probes instead of silently doing nothing', async () => {
    const port = await closedPort();
    const run = await probe(['--port', String(port), '--expect', 'closed'], { entry: '-', stdin: readFileSync(script, 'utf8') });
    expect(run.status, run.stderr).toBe(0);
    expect(report(run)).toMatchObject({ outcome: 'closed', met: true });
  });
});

describe('side effects', () => {
  it('leaves its working directory empty and needs no managed runtime', async () => {
    const cwd = physicalTemp('server-probe-cwd-');
    const home = physicalTemp('server-probe-home-');
    made.push(cwd, home);
    const { port } = await listen(httpServer(200));
    const open = await probe(['--port', String(port), '--host', '127.0.0.1'], { cwd });
    expect(open.status).toBe(0);
    const gone = await closedPort();
    const run = await probe(['--port', String(gone), '--expect', 'closed'], { cwd, env: { AGENT_TESTS_HOME: home } });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).not.toContain('E_RUNTIME_MISSING');
    expect(run.stdout).not.toContain('E_RUNTIME_MISSING');
    expect(report(run)).toMatchObject({ outcome: 'closed', met: true });
    expect(readdirSync(cwd)).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
  });
});
