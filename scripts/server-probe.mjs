#!/usr/bin/env node
// Bounded, read-only preflight for a local dev-server port.
//
//   node scripts/server-probe.mjs --port <1-65535> [--host localhost|127.0.0.1|::1]
//                                 [--timeout-ms <1-60000>] [--expect closed|responding]
//
// Per loopback family it makes one TCP connect and one `GET /`, reads only the response headers and
// reports `responding`, `occupied-no-http-response`, `closed` or `unreachable`. It never starts, stops
// or signals anything, binds nothing and writes no file. It reports what answered, never who owns the
// listener. Dependency-free (node:http only); it does not use the managed runtime.
import { realpathSync } from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const SCHEMA = 'agent-tests/server-probe@1';
export const OUTCOMES = ['responding', 'occupied-no-http-response', 'unreachable', 'closed']; // precedence order
const HOSTS = ['localhost', '127.0.0.1', '::1'];
const EXPECTATIONS = ['closed', 'responding'];
const DEFAULT_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 60000;
const USAGE = 'node scripts/server-probe.mjs --port <1-65535> [--host localhost|127.0.0.1|::1] [--timeout-ms <1-60000>] [--expect closed|responding]';
const CLOSED_CODES = new Set(['ECONNREFUSED', 'EADDRNOTAVAIL', 'EAFNOSUPPORT']);

export class UsageError extends Error {
  constructor(message, hint = USAGE) {
    super(message);
    this.code = 'E_USAGE';
    this.hint = hint;
  }
}

/** Maps a failed TCP connect to `closed` (nothing listening or family unavailable) or `unreachable`. */
export function classifyConnectError(error) {
  if (error && !error.timedOut && CLOSED_CODES.has(error.code)) return 'closed';
  return 'unreachable';
}

/** The overall outcome of several family outcomes: responding, then occupied, then unreachable, then closed. */
export function overallOutcome(outcomes) {
  return OUTCOMES.find(outcome => outcomes.includes(outcome)) ?? 'closed';
}

const FLAGS = ['--port', '--host', '--timeout-ms', '--expect'];

/** Parses and validates argv (without the node and script entries). Throws UsageError. */
export function parseArgs(argv) {
  const raw = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equals = argument.startsWith('--') ? argument.indexOf('=') : -1;
    const flag = equals === -1 ? argument : argument.slice(0, equals);
    if (!FLAGS.includes(flag)) throw new UsageError(`unknown argument ${JSON.stringify(argument)}`);
    if (raw.has(flag)) throw new UsageError(`${flag} was given more than once`);
    const value = equals === -1 ? argv[++index] : argument.slice(equals + 1);
    if (value === undefined || (equals === -1 && value.startsWith('--'))) throw new UsageError(`${flag} needs a value`);
    raw.set(flag, value);
  }
  const integer = (flag, text, min, max) => {
    const value = /^\d{1,9}$/.test(text) ? Number(text) : NaN;
    if (!(value >= min && value <= max)) throw new UsageError(`${flag} must be an integer from ${min} to ${max} (got ${JSON.stringify(text)})`);
    return value;
  };
  if (!raw.has('--port')) throw new UsageError('--port is required');
  const host = raw.get('--host') ?? 'localhost';
  if (!HOSTS.includes(host)) throw new UsageError(`--host must be one of ${HOSTS.join(', ')} (got ${JSON.stringify(host)})`, 'Only loopback hosts are probed; this is a preflight for local dev servers, not a network scanner.');
  const expect = raw.get('--expect') ?? 'responding';
  if (!EXPECTATIONS.includes(expect)) throw new UsageError(`--expect must be one of ${EXPECTATIONS.join(', ')} (got ${JSON.stringify(expect)})`);
  return {
    port: integer('--port', raw.get('--port'), 1, 65535),
    host,
    timeoutMs: raw.has('--timeout-ms') ? integer('--timeout-ms', raw.get('--timeout-ms'), 1, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
    expect,
  };
}

const elapsed = start => Math.round(performance.now() - start);
const errorName = error => (error && (error.code || error.name)) || 'ERROR';

/** One TCP connect and one header-only GET / on it (node:http, no agent). Each wait is bounded by timeoutMs. */
function probeFamily({ address, hostHeader, port, timeoutMs }) {
  return new Promise(resolve => {
    const start = performance.now();
    let settled = false;
    let connected = null; // the connect evidence, once the socket is connected
    let httpStart = 0;
    let timer;
    const request = http.request({ host: address, port, agent: false, method: 'GET', path: '/', headers: { Host: hostHeader, Connection: 'close' } });
    const finish = family => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy(); // closes the socket; the response body is never read
      resolve({ address, ...family });
    };
    const fail = (error, timedOut) => {
      if (!connected) {
        const connect = { ok: false, ms: elapsed(start), error: timedOut ? 'timeout' : errorName(error) };
        finish({ outcome: classifyConnectError({ code: error?.code, timedOut }), connect });
      } else {
        const http = { ms: elapsed(httpStart), error: timedOut ? 'timeout' : errorName(error), ...(timedOut ? { timedOut: true } : {}) };
        finish({ outcome: 'occupied-no-http-response', connect: connected, http });
      }
    };
    request.on('error', error => fail(error, false));
    request.on('socket', socket => {
      timer = setTimeout(() => fail(null, true), timeoutMs); // the connect bound
      socket.once('connect', () => {
        clearTimeout(timer);
        connected = { ok: true, ms: elapsed(start) };
        httpStart = performance.now();
        timer = setTimeout(() => fail(null, true), timeoutMs); // the response-header bound
      });
    });
    // Any status line with headers counts: final replies, interim 1xx replies (100 Continue, 103 Early Hints) and 101 upgrades.
    const answered = (status, headers) => {
      const header = name => (typeof headers[name] === 'string' ? headers[name] : undefined);
      const http = { status, ms: elapsed(httpStart), server: header('server'), contentType: header('content-type') };
      for (const key of Object.keys(http)) if (http[key] === undefined) delete http[key];
      finish({ outcome: 'responding', connect: connected, http });
    };
    request.on('response', response => answered(response.statusCode, response.headers));
    request.on('information', info => answered(info.statusCode, info.headers ?? {}));
    request.on('continue', () => answered(100, {}));
    request.on('upgrade', (response, socket) => { socket.on('error', () => {}); answered(response.statusCode, response.headers); });
    request.end();
  });
}

/** Probes the requested loopback families in parallel and returns the report object. */
export async function runProbe({ port, host, timeoutMs, expect }) {
  const addresses = host === 'localhost' ? ['127.0.0.1', '::1'] : [host];
  const hostHeader = address => `${host === 'localhost' ? 'localhost' : address.includes(':') ? `[${address}]` : address}:${port}`;
  const families = await Promise.all(addresses.map(address => probeFamily({ address, hostHeader: hostHeader(address), port, timeoutMs })));
  const outcome = overallOutcome(families.map(family => family.outcome));
  return {
    schema: SCHEMA,
    target: { host, port },
    outcome,
    expect,
    met: outcome === expect,
    families,
    limits: { timeoutMs },
    probedAt: new Date().toISOString(),
  };
}

function exitAfterWrite(stream, text, code) {
  stream.write(text, () => process.exit(code));
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    exitAfterWrite(process.stderr, `${JSON.stringify({ error: { code: error.code, message: error.message, hint: error.hint } })}\n`, 2);
    return;
  }
  const result = await runProbe(options);
  exitAfterWrite(process.stdout, `${JSON.stringify(result)}\n`, result.met ? 0 : 1);
}

/**
 * True when the module described by `meta` (import.meta) is the one node was launched with. `meta.main` is true for a file
 * launch, but node 24.0 and 24.1 do not set it and node reports a module piped on stdin or --eval as not main, naming it
 * [eval1]. Staying silent in those cases would exit 0, which reads as "closed", so they are recognized here. Importing the
 * file matches none of them.
 */
export function isEntryPoint(meta, argv1) {
  if (meta.main === true || /\/\[eval\d*\]$/.test(meta.url)) return true;
  if (typeof meta.main === 'boolean') return false;
  try {
    return Boolean(argv1) && pathToFileURL(realpathSync(argv1)).href === meta.url;
  } catch {
    return false;
  }
}

if (isEntryPoint(import.meta, process.argv[1])) {
  main(process.argv.slice(2)).catch(error => {
    // Exit 1 means "outcome does not meet --expect"; an internal failure must not look like that.
    exitAfterWrite(process.stderr, `${JSON.stringify({ error: { code: 'E_PROBE', message: String(error?.message ?? error), hint: 'Re-run; report this if it repeats.' } })}\n`, 2);
  });
}
