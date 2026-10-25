import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {beforeAll, describe, expect, it, vi} from 'vitest';
import {makeTree} from './helpers/tree.ts';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const cleanupFault = vi.hoisted(() => ({remaining: 0}));
const publicationFault = vi.hoisted(() => ({source: '', output: ''}));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {...actual, renameSync: (from: import('node:fs').PathLike, to: import('node:fs').PathLike) => {
    actual.renameSync(from, to);
    if (publicationFault.source && String(to) === publicationFault.output && String(from).includes('.playbot-export-') && !String(from).endsWith('.previous')) {
      const source = publicationFault.source; publicationFault.source = '';
      actual.writeFileSync(join(source, 'scripts/unrelated.mjs'), '// producer changes after publication\n');
    }
  }, unlinkSync: (file: import('node:fs').PathLike) => {
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
const pinNames = ['PLAYBOT_VERSION.json', 'playbot-contract.mjs', 'playbot-contract.d.mts'];
const snapshot = (out: string) => ({
  names: readdirSync(out).sort(), directoryMtime: statSync(out).mtimeMs,
  files: pinNames.map(name => ({name, bytes: readFileSync(join(out, name)), mtime: statSync(join(out, name)).mtimeMs})),
});
function setVersion(source: string, version: string) {
  writeFileSync(join(source, 'package.json'), JSON.stringify({name: 'agent-tests', version}));
  writeFileSync(join(source, 'package-lock.json'), JSON.stringify({version, packages: {'': {version}}}));
}
function cliProducer() {
  const source = producer();
  writeFileSync(join(source, 'package.json'), JSON.stringify({name: 'agent-tests', version: '1.2.3', type: 'module'}));
  for (const name of ['playbot-export.mjs', 'managed-runtime.js']) writeFileSync(join(source, 'scripts', name), readFileSync(new URL(`../scripts/${name}`, import.meta.url)));
  return source;
}
const cli = (source: string, ...args: string[]) => spawnSync(process.execPath, [join(source, 'scripts/playbot-export.mjs'), ...args], {encoding: 'utf8'});

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

  it('refuses changed producer module bytes, and only explicit export updates it', () => {
    const source = producer(), out = makeTree({}); exportPlaybot(source, out);
    writeFileSync(join(source, 'scripts/playbot-contract.mjs'), moduleSource + '\n// changed producer\n');
    expect(() => verifyPlaybotPin(out, {source})).toThrow(/actual producer module digest/);
    expect(exportPlaybot(source, out).changed).toBe(true);
    expect(verifyPlaybotPin(out, {source}).current).toBe(true);
  });

  it.each(['version', 'fingerprint'])('reports byte-identical %s drift without changing pin bytes or mtimes', kind => {
    const source = producer(), out = makeTree({}); exportPlaybot(source, out);
    const original = verifyPlaybotPin(out, {source}), before = snapshot(out);
    if (kind === 'version') setVersion(source, '1.2.4');
    else writeFileSync(join(source, 'scripts/unrelated.mjs'), '// changes whole-runtime identity only\n');
    const result = verifyPlaybotPin(out, {source});
    expect(result).toMatchObject({valid: true, current: false, drift: {
      pinVersion: '1.2.3', producerVersion: kind === 'version' ? '1.2.4' : '1.2.3', bytesIdentical: true,
      pinSourceFingerprint: original.pin.sourceFingerprint,
    }});
    expect(result.drift.producerSourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.drift.producerSourceFingerprint).not.toBe(original.pin.sourceFingerprint);
    expect(() => verifyPlaybotPin(out, {source, requireCurrent: true})).toThrow(/Playbot source identity mismatch/);
    expect(snapshot(out)).toEqual(before);
    expect(exportPlaybot(source, out)).toMatchObject({changed: true, current: true});
    expect(verifyPlaybotPin(out, {source, requireCurrent: true})).toMatchObject({valid: true, current: true});
    expect(verifyPlaybotPin(out, {source})).not.toHaveProperty('drift');
  });

  it('distinguishes authenticated pin integrity from producer equivalence without a source', () => {
    const source = producer(), out = makeTree({}); exportPlaybot(source, out);
    const before = snapshot(out);
    expect(verifyPlaybotPin(out)).toMatchObject({valid: true, current: null});
    expect(verifyPlaybotPin(out)).not.toHaveProperty('drift');
    expect(() => verifyPlaybotPin(out, {requireCurrent: true})).toThrow(/requireCurrent requires a producer source/);
    expect(snapshot(out)).toEqual(before);
  });

  it('refuses changed producer declarations even when the exported module is byte-identical', () => {
    const source = producer(), out = makeTree({}); exportPlaybot(source, out);
    const before = snapshot(out);
    writeFileSync(join(source, 'scripts/playbot-contract.d.mts'), declarationSource + '\n// changed declaration\n');
    expect(() => verifyPlaybotPin(out, {source})).toThrow(/actual producer declaration digest/);
    expect(snapshot(out)).toEqual(before);
  });

  it('compares both actual producer payloads with CRLF normalized without changing the pin', () => {
    const source = producer(), out = makeTree({}); exportPlaybot(source, out);
    const before = snapshot(out);
    for (const name of ['playbot-contract.mjs', 'playbot-contract.d.mts']) {
      const path = join(source, 'scripts', name);
      writeFileSync(path, readFileSync(path, 'utf8').replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'));
    }
    expect(verifyPlaybotPin(out, {source, requireCurrent: true})).toMatchObject({valid: true, current: true});
    expect(snapshot(out)).toEqual(before);
  });

  it.each(['foreign', 'incomplete', 'nonregular'])('refuses a %s pin inventory', kind => {
    const source = producer(), out = makeTree({}); exportPlaybot(source, out);
    if (kind === 'foreign') writeFileSync(join(out, 'foreign.txt'), 'keep');
    else { unlinkSync(join(out, 'playbot-contract.mjs')); if (kind === 'nonregular') mkdirSync(join(out, 'playbot-contract.mjs')); }
    const before = readdirSync(out);
    expect(() => verifyPlaybotPin(out, {source})).toThrow(/foreign|Incomplete|regular/);
    expect(readdirSync(out)).toEqual(before);
  });

  it('CLI preserves drift as successful evidence, offers strict release verification and never mutates during verification', () => {
    const source = cliProducer(), out = makeTree({});
    expect(cli(source, '--out', out).status).toBe(0);
    const exact = cli(source, '--out', out, '--verify', '--require-current');
    expect(exact.status, exact.stderr).toBe(0);
    expect(JSON.parse(exact.stdout)).toMatchObject({valid: true, current: true});
    setVersion(source, '1.2.4'); // source remains an ES module through .mjs; managed-runtime.js needs package type.
    writeFileSync(join(source, 'package.json'), JSON.stringify({name: 'agent-tests', version: '1.2.4', type: 'module'}));
    const before = snapshot(out), compatible = cli(source, '--verify', '--out', out);
    expect(compatible.status, compatible.stderr).toBe(0);
    expect(JSON.parse(compatible.stdout)).toMatchObject({valid: true, current: false, drift: {bytesIdentical: true}});
    const strict = cli(source, '--out', out, '--verify', '--require-current');
    expect(strict.status).toBe(1); expect(strict.stdout).toBe('');
    expect(JSON.parse(strict.stderr)).toMatchObject({error: {code: 'E_PLAYBOT_PIN', message: 'Playbot source identity mismatch'}});
    expect(snapshot(out)).toEqual(before);
    writeFileSync(join(source, 'scripts/playbot-contract.mjs'), moduleSource + '// changed\n');
    const changed = cli(source, '--out', out, '--verify');
    expect(changed.status).toBe(1); expect(JSON.parse(changed.stderr).error.message).toMatch(/actual producer module digest/);
    expect(snapshot(out)).toEqual(before);
  });

  it.each([
    ['--require-current'], ['--verify', '--verify'], ['--verify', '--require-current', '--require-current'],
    ['--out', 'second'], ['--bogus'], ['--verify', '--bogus'],
  ])('CLI rejects invalid flags before output mutation: %j', (...flags) => {
    const source = cliProducer(), out = join(makeTree({}), 'not-created');
    const result = cli(source, '--out', out, ...flags);
    expect(result.status).toBe(1); expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr).error.code).toBe('E_PLAYBOT_PIN');
    expect(existsSync(out)).toBe(false);
  });

  it('CLI rejects a missing output value before mutation', () => {
    const result = cli(cliProducer(), '--out', '--verify', '--require-current');
    expect(result.status).toBe(1); expect(JSON.parse(result.stderr).error.message).toMatch(/Usage/);
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
    const before = snapshot(out);
    expect(() => verifyPlaybotPin(out, {source})).toThrow(/schema/);
    expect(snapshot(out)).toEqual(before);
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

  it('rolls back publication if producer identity drifts after the final pre-publication check', () => {
    const source = producer(), out = makeTree({}); exportPlaybot(source, out);
    const before = snapshot(out);
    setVersion(source, '1.2.4');
    publicationFault.source = source; publicationFault.output = out;
    try { expect(() => exportPlaybot(source, out)).toThrow(/Playbot source identity mismatch/); }
    finally { publicationFault.source = ''; publicationFault.output = ''; }
    expect(snapshot(out)).toEqual(before);
    expect(verifyPlaybotPin(out, {source})).toMatchObject({valid: true, current: false, drift: {bytesIdentical: true}});
  });
});
