import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect } from 'vitest';
import { physicalTemp } from './physical-temp.ts';
const checkout = fileURLToPath(new URL('../../', import.meta.url));
const script = join(checkout, 'scripts/candidate-evidence.mjs');
const made: string[] = [];
afterEach(() => { for (const p of made.splice(0)) rmSync(p, { recursive: true, force: true }); });
function git(root: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  expect(r.status, r.stderr).toBe(0); return r.stdout.trim();
}
function fixture(files: Record<string, string>, vitest = false) {
  const parent = process.env.AGENT_TESTS_NATIVE_EVIDENCE_DIR ?? tmpdir(); mkdirSync(parent, { recursive: true });
  const base = physicalTemp('native-owner-', parent);
  if (!process.env.AGENT_TESTS_NATIVE_EVIDENCE_DIR) made.push(base);
  const root = join(base, 'repo'); mkdirSync(root);
  for (const [name, body] of Object.entries({ '.gitignore': 'node_modules/\n.local/\n', 'package.json': '{"name":"native-fixture","type":"module"}', ...files })) writeFileSync(join(root, name), body);
  mkdirSync(join(root, '.local'));
  if (vitest) { mkdirSync(join(root, 'node_modules')); symlinkSync(join(checkout, 'node_modules/vitest'), join(root, 'node_modules/vitest'), process.platform === 'win32' ? 'junction' : 'dir'); }
  git(root, 'init', '-q'); git(root, 'add', '.'); git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  return { root, out: join(base, 'attempt'), base, sha: git(root, 'rev-parse', 'HEAD') };
}
function run(args: string[], env = process.env) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true, timeout: 20000, env }); }
const progress = (out: string) => run(['progress', '--attempt', out]);
const json = (out: string, file = 'receipt.json') => JSON.parse(readFileSync(join(out, file), 'utf8'));
async function waitFor(predicate: () => boolean, context: () => string, timeout = 12000) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw Error(`Marker deadline: ${context()}`); await new Promise(resolve => setTimeout(resolve, 25)); }
}
function controlled(f: ReturnType<typeof fixture>, mode: string, args: string[], extra: string[] = [], env = process.env) {
  const child = spawn(process.execPath, [script, 'observe', mode, '--root', f.root, '--out', f.out, ...extra, '--', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const closed = new Promise<number | null>(resolve => child.once('close', code => resolve(code)));
  return { child, closed, output: () => output };
}
const held = "const{existsSync,writeFileSync}=await import('node:fs');writeFileSync('.local/b-held','yes');await new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{if(existsSync('.local/release')){clearInterval(timer);resolve();}else if(Date.now()-started>15000){clearInterval(timer);reject(Error('fixture release deadline'));}},20)});";

export { checkout, script, made, git, fixture, run, progress, json, waitFor, controlled, held };
