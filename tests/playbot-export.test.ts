import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {beforeAll, describe, expect, it, vi} from 'vitest';
import {makeTree} from './helpers/tree.ts';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const cleanupFault = vi.hoisted(() => ({remaining: 0}));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {...actual, unlinkSync: (file: import('node:fs').PathLike) => {
    if (String(file).includes('.previous') && cleanupFault.remaining > 0 && --cleanupFault.remaining === 0) {
      throw new Error('injected backup cleanup refusal');
    }
    return actual.unlinkSync(file);
  }};
});
let moduleSource: string, declarationSource: string, exportPlaybot: any, verifyPlaybotPin: any;
beforeAll(async () => {
  const module = new URL('../scripts/playbot-contract.mjs', import.meta.url), exporter = new URL('../scripts/playbot-export.mjs', import.meta.url);
  expect(existsSync(fileURLToPath(module)), 'producer provides the portable Playbot module').toBe(true);
  expect(existsSync(fileURLToPath(exporter)), 'producer provides one pinned-module exporter').toBe(true);
  moduleSource = readFileSync(module, 'utf8');
  declarationSource = readFileSync(new URL('../scripts/playbot-contract.d.mts', import.meta.url), 'utf8');
  ({exportPlaybot, verifyPlaybotPin} = await import(exporter.href));
});
function producer() {
  return makeTree({
    'package.json': JSON.stringify({name: 'agent-tests', version: '1.2.3'}),
    'package-lock.json': JSON.stringify({version: '1.2.3', packages: {'': {version: '1.2.3'}}}),
    'scripts/playbot-contract.mjs': moduleSource,
    'scripts/playbot-contract.d.mts': declarationSource,
  });
}

describe('one producer-owned browser/headless Playbot pin', () => {
  it('exports the actual portable module with its exact final digest and producer identity', () => {
    const source = producer(), out = makeTree({});
    const receipt = exportPlaybot(source, out);
    const bytes = readFileSync(join(out, 'playbot-contract.mjs'));
    const pin = JSON.parse(readFileSync(join(out, 'PLAYBOT_VERSION.json'), 'utf8'));
    expect(pin.schema).toBe('agent-tests/playbot-pin@1');
    expect(pin.version).toBe('1.2.3');
    expect(pin.sha256).toBe(sha(bytes));
    expect(pin.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.changed).toBe(true);
    expect(verifyPlaybotPin(out, {source}).current).toBe(true);
  });

  it('ships and verifies the producer-owned TypeScript declaration alongside the module', () => {
    const source = producer(), out = makeTree({});
    writeFileSync(join(source, 'scripts/playbot-contract.d.mts'), 'export declare const CONTRACT_VERSION: 1;\n');
    exportPlaybot(source, out);
    const pin = JSON.parse(readFileSync(join(out, 'PLAYBOT_VERSION.json'), 'utf8'));
    expect(pin.types).toBe('playbot-contract.d.mts');
    expect(pin.typesSha256).toBe(sha(readFileSync(join(out, pin.types))));
    writeFileSync(join(out, pin.types), 'export declare const CONTRACT_VERSION: 2;\n');
    expect(() => verifyPlaybotPin(out, {source})).toThrow(/digest/);
  });

  it('does not rewrite unchanged pins or require a tool process at each bot beat', () => {
    const source = producer(), out = makeTree({}); exportPlaybot(source, out);
    const before = ['playbot-contract.mjs', 'playbot-contract.d.mts', 'PLAYBOT_VERSION.json'].map(name => readFileSync(join(out, name)));
    expect(exportPlaybot(source, out).changed).toBe(false);
    expect(['playbot-contract.mjs', 'playbot-contract.d.mts', 'PLAYBOT_VERSION.json'].map(name => readFileSync(join(out, name)))).toEqual(before);
  });

  it('refuses same-size module corruption without healing or relabeling it', () => {
    const source = producer(), out = makeTree({}); exportPlaybot(source, out);
    const path = join(out, 'playbot-contract.mjs'), changed = readFileSync(path);
    changed[changed.length - 2] ^= 1; writeFileSync(path, changed);
    expect(() => verifyPlaybotPin(out, {source})).toThrow(/digest/);
    expect(readFileSync(path)).toEqual(changed);
  });

  it('refuses a stale same-version producer fingerprint, and only explicit export updates it', () => {
    const source = producer(), out = makeTree({}); exportPlaybot(source, out);
    writeFileSync(join(source, 'scripts/playbot-contract.mjs'), moduleSource + '\n// changed producer\n');
    expect(() => verifyPlaybotPin(out, {source})).toThrow(/source/);
    expect(exportPlaybot(source, out).changed).toBe(true);
    expect(verifyPlaybotPin(out, {source}).current).toBe(true);
  });

  it('preserves foreign output files and refuses undeclared replacement ownership', () => {
    const out = makeTree({'foreign.txt': 'owner data'});
    expect(() => exportPlaybot(producer(), out)).toThrow(/foreign/);
    expect(readFileSync(join(out, 'foreign.txt'), 'utf8')).toBe('owner data');
    expect(existsSync(join(out, 'PLAYBOT_VERSION.json'))).toBe(false);
  });

  it('refuses malformed pin metadata instead of accepting digest alone', () => {
    const source = producer(), out = makeTree({}); exportPlaybot(source, out);
    const path = join(out, 'PLAYBOT_VERSION.json'), pin = JSON.parse(readFileSync(path, 'utf8'));
    pin.schema = 'future@99'; writeFileSync(path, JSON.stringify(pin));
    expect(() => verifyPlaybotPin(out, {source})).toThrow(/schema/);
  });

  it('preserves the verified new pin if old-backup cleanup fails partway through', () => {
    const source = producer(), out = makeTree({}); exportPlaybot(source, out);
    writeFileSync(join(source, 'scripts/playbot-contract.mjs'), moduleSource + '\n// new accepted producer\n');
    cleanupFault.remaining = 2; // One old file is gone when the next deletion fails.
    let receipt: any;
    try { receipt = exportPlaybot(source, out); } finally { cleanupFault.remaining = 0; }
    expect(receipt.changed).toBe(true);
    expect(receipt.valid).toBe(true);
    expect(receipt.cleanupWarning).toMatch(/cleanup refusal/);
    expect(existsSync(receipt.retainedBackup)).toBe(true);
    expect(verifyPlaybotPin(out, {source}).current).toBe(true);
    expect(readFileSync(join(out, 'playbot-contract.mjs'), 'utf8')).toContain('new accepted producer');
  });
});
