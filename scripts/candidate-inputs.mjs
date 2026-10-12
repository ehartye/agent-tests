import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function hashFile(path) {
  const hash = createHash('sha256'), bytes = Buffer.alloc(65536), fd = openSync(path, 'r');
  try { let count; while ((count = readSync(fd, bytes, 0, bytes.length, null))) hash.update(bytes.subarray(0, count)); }
  finally { closeSync(fd); }
  return hash.digest('hex');
}
export const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 * 1024 });
export const inside = (root, path) => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)); };
const pathKey = path => path.replaceAll('\\', '/');
function safeRelative(path) {
  if (!path || path.includes('\\') || isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split('/').some(part => part === '..' || part === '.' || part === '' || part === '.git')) throw Error(`Unsupported or traversing input path: ${path}`);
  return path;
}
function nulPaths(bytes) { return new TextDecoder('utf8', { fatal: true }).decode(bytes).split('\0').filter(Boolean); }
function checkedPath(root, name) {
  safeRelative(name);
  let path = root;
  for (const part of name.split('/')) {
    path = join(path, part);
    try { if (lstatSync(path).isSymbolicLink()) throw Error(`Symbolic-link input closure is unsupported: ${name}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!inside(root, resolve(path))) throw Error(`Input escaped checkout: ${name}`);
  return path;
}
export function canonicalRoot(root) {
  root = realpathSync(resolve(root));
  const top = realpathSync(git(root, 'rev-parse', '--show-toplevel').toString('utf8').trim());
  // Windows realpath can preserve caller casing while Git returns another spelling.
  if (relative(root, top) !== '') throw Error('Input scope must be the full Git checkout root');
  return top;
}
export function snapshotInputs(root, { generatedInputs = [], outputDirectory } = {}) {
  root = canonicalRoot(root);
  const output = outputDirectory ? resolve(outputDirectory) : null;
  const excluded = path => output && inside(output, path);
  const index = git(root, 'ls-files', '--stage', '-z');
  for (const entry of nulPaths(index)) if (/^(120000|160000) /.test(entry)) throw Error(`Unsupported symbolic-link or gitlink index input: ${entry.split('\t').at(-1)}`);
  const names = [...new Set(nulPaths(git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z')))].sort();
  const files = Object.create(null), generatedRoots = Object.create(null);
  function add(name, recurse) {
    const path = checkedPath(root, name);
    if (excluded(path)) return;
    let stat;
    try { stat = lstatSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; files[name] = { type: 'missing' }; return; }
    if (stat.isDirectory()) {
      if (!recurse) throw Error(`Git-visible directory input is unsupported: ${name}`);
      files[name] = { type: 'directory' };
      for (const child of readdirSync(path).sort()) add(`${name}/${child}`, true);
    } else if (stat.isFile()) files[name] = { type: 'file', bytes: stat.size, executable: !!(stat.mode & 0o111), sha256: hashFile(path) };
    else throw Error(`Unsupported input type: ${name}`);
  }
  for (const name of names) add(name, false);
  const declared = [...new Set(generatedInputs.map(path => safeRelative(pathKey(path))))].sort();
  for (const name of declared) {
    const path = checkedPath(root, name);
    generatedRoots[name] = existsSync(path) ? 'present' : 'missing'; add(name, true);
  }
  const status = git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all');
  const sorted = Object.fromEntries(Object.keys(files).sort().map(name => [name, files[name]]));
  return {
    root, head: { sha: git(root, 'rev-parse', 'HEAD').toString('utf8').trim(), tree: git(root, 'rev-parse', 'HEAD^{tree}').toString('utf8').trim() },
    sourceRole: status.length ? 'committed-base-for-observed-working-tree' : declared.length ? 'committed-base-with-declared-generated-inputs' : 'tested-committed-source',
    workingTreeDirty: status.length > 0, indexSha256: sha256(index), files: sorted,
    scope: { gitVisible: 'tracked and nonignored untracked', generatedInputs: declared, generatedRoots, excludedOutputs: output ? [output] : [] },
    packageHashes: Object.fromEntries(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'].filter(name => sorted[name]?.sha256).map(name => [name, sorted[name].sha256])),
  };
}
export function inputMismatches(before, after) {
  if (after?.error) return [{ kind: 'snapshot-unavailable', detail: after.error }];
  const mismatches = [];
  for (const field of ['root', 'head', 'indexSha256', 'scope']) if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) mismatches.push({ kind: field, before: before[field], after: after[field] });
  for (const path of [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort()) {
    if (JSON.stringify(before.files[path]) !== JSON.stringify(after.files[path])) mismatches.push({ kind: !before.files[path] ? 'added' : !after.files[path] ? 'deleted' : 'changed', path, before: before.files[path] ?? null, after: after.files[path] ?? null });
  }
  return mismatches;
}
