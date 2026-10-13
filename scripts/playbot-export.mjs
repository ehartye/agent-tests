import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describeSource} from './managed-runtime.js';

const MODULE = 'playbot-contract.mjs', TYPES = 'playbot-contract.d.mts', PIN = 'PLAYBOT_VERSION.json';
const NAMES = [PIN, MODULE, TYPES].sort(), SCHEMA = 'agent-tests/playbot-pin@1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (ok, message) => { if (!ok) throw Error(message); };
const regular = path => { const stat = lstatSync(path); assert(stat.isFile() && !stat.isSymbolicLink(), 'Pin files must be physical regular files'); };
const directory = path => { const stat = lstatSync(path); assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Pin directory must be physical'); };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function inventory(path) {
  if (!existsSync(path)) return null;
  directory(path);
  const names = readdirSync(path).sort();
  assert(names.every(name => NAMES.includes(name)), 'Refusing foreign files in Playbot pin directory');
  return names.map(name => { const file = join(path, name); regular(file); return {name, sha256: sha(readFileSync(file))}; });
}
function metadata(path) {
  regular(join(path, PIN));
  const pin = JSON.parse(readFileSync(join(path, PIN), 'utf8'));
  const keys = ['schema','version','contractVersion','sourceFingerprint','sha256','file','types','typesSha256'].sort();
  assert(same(Object.keys(pin).sort(), keys) && pin.schema === SCHEMA, 'Unsupported Playbot pin schema');
  assert(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pin.version) && pin.contractVersion === 1 && pin.file === MODULE && pin.types === TYPES, 'Unsupported Playbot pin version/module');
  for (const name of ['sourceFingerprint','sha256','typesSha256']) assert(/^[a-f0-9]{64}$/.test(pin[name]), 'Invalid Playbot pin digest');
  return pin;
}
export function verifyPlaybotPin(output, {source} = {}) {
  output = resolve(output);
  const files = inventory(output);
  assert(files !== null && same(files.map(row => row.name), NAMES), 'Incomplete Playbot pin inventory');
  const pin = metadata(output);
  assert(sha(readFileSync(join(output, MODULE))) === pin.sha256, 'Playbot module digest mismatch');
  assert(sha(readFileSync(join(output, TYPES))) === pin.typesSha256, 'Playbot declaration digest mismatch');
  let current = null;
  if (source !== undefined) {
    const producer = describeSource(source);
    assert(pin.version === producer.version && pin.sourceFingerprint === producer.fingerprint, 'Playbot source identity mismatch');
    const actual = readFileSync(join(producer.source, 'scripts', MODULE), 'utf8').replaceAll('\r\n', '\n');
    assert(sha(Buffer.from(actual)) === pin.sha256, 'Pin does not match the actual producer module digest');
    const declarations = readFileSync(join(producer.source, 'scripts', TYPES), 'utf8').replaceAll('\r\n', '\n');
    assert(sha(Buffer.from(declarations)) === pin.typesSha256, 'Pin does not match the actual producer declaration digest');
    current = true;
  }
  return {valid: true, current, pin};
}

/** Explicit export owns module, declarations and metadata. Read-only verification never repairs them. */
export function exportPlaybot(source, output) {
  const producer = describeSource(source), bytes = Buffer.from(readFileSync(join(producer.source, 'scripts', MODULE), 'utf8').replaceAll('\r\n', '\n'));
  const typesBytes = Buffer.from(readFileSync(join(producer.source, 'scripts', TYPES), 'utf8').replaceAll('\r\n', '\n'));
  const pin = {schema: SCHEMA, version: producer.version, contractVersion: 1, sourceFingerprint: producer.fingerprint, sha256: sha(bytes), file: MODULE, types: TYPES, typesSha256: sha(typesBytes)};
  const pinBytes = Buffer.from(JSON.stringify(pin, null, 2) + '\n');
  output = resolve(output);
  const before = inventory(output), expected = [{name: PIN, sha256: sha(pinBytes)}, {name: MODULE, sha256: sha(bytes)}, {name: TYPES, sha256: sha(typesBytes)}].sort((a, b) => a.name < b.name ? -1 : 1);
  if (before?.length) metadata(output); // Refuse replacing an unrelated or unsupported pair.
  if (same(before, expected)) {
    assert(describeSource(producer.source).fingerprint === producer.fingerprint, 'Producer source changed during pin check');
    return {changed: false, output, ...verifyPlaybotPin(output, {source: producer.source})};
  }
  const parent = dirname(output); mkdirSync(parent, {recursive: true}); directory(parent);
  const stage = mkdtempSync(join(realpathSync(parent), '.playbot-export-')), backup = stage + '.previous';
  const cleanup = path => {
    if (!existsSync(path)) return;
    const files = inventory(path);
    for (const row of files) unlinkSync(join(path, row.name));
    rmdirSync(path);
  };
  let movedOld = false, published = false, result;
  try {
    writeFileSync(join(stage, MODULE), bytes, {flag: 'wx'}); writeFileSync(join(stage, TYPES), typesBytes, {flag: 'wx'}); writeFileSync(join(stage, PIN), pinBytes, {flag: 'wx'});
    assert(same(inventory(stage), expected), 'Staged Playbot pin bytes changed');
    assert(describeSource(producer.source).fingerprint === producer.fingerprint, 'Producer source changed during export');
    assert(same(inventory(output), before), 'Existing Playbot pin changed during export');
    if (before !== null) { renameSync(output, backup); movedOld = true; }
    renameSync(stage, output); published = true;
    result = verifyPlaybotPin(output, {source: producer.source});
  } catch (error) {
    if (published) { renameSync(output, stage); published = false; }
    if (movedOld && existsSync(backup)) { renameSync(backup, output); movedOld = false; }
    throw error;
  } finally {
    cleanup(stage);
  }
  // Publication is accepted. A partially removed old backup cannot be restored.
  // Keep the verified new pin and report any owned backup left for inspection.
  if (movedOld) {
    try { cleanup(backup); }
    catch (error) { return {changed: true, output, ...result, cleanupWarning: error.message, retainedBackup: backup}; }
  }
  return {changed: true, output, ...result};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), outIndex = args.indexOf('--out'), verify = args.includes('--verify');
    assert(outIndex >= 0 && args[outIndex + 1] && !args[outIndex + 1].startsWith('--'), 'Usage: playbot-export --out <directory> [--verify]');
    assert(args.length === (verify ? 3 : 2) && args.every((arg, index) => index === outIndex + 1 || ['--out','--verify'].includes(arg)), 'Unknown Playbot export arguments');
    const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    console.log(JSON.stringify(verify ? verifyPlaybotPin(args[outIndex + 1], {source}) : exportPlaybot(source, args[outIndex + 1])));
  } catch (error) {
    console.error(JSON.stringify({error: {code: 'E_PLAYBOT_PIN', message: error.message}})); process.exitCode = 1;
  }
}
