/** Test-only bridge from live owned native acquisitions to the public hydrated evidence API.
 * Reads existing raw facts; never launches, applies, restores or rewrites native records.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HydratedMutationEvidence, MutationAttempt, MutationAttemptBinding, MutationFile, MutationReviewedAssertionSite } from '../../scripts/mutation-verdict.mjs';

interface AcquiredAttempt { attempt: string; output: string; binding: MutationAttemptBinding }
interface ConsumerInput {
  directory: string;
  baseline: AcquiredAttempt;
  mutant: AcquiredAttempt;
  site: MutationReviewedAssertionSite;
  providerPhysicalPath: string;
  anchor: Buffer;
  replacement: Buffer;
}
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function hydrateNativeConsumer(input: ConsumerInput): HydratedMutationEvidence {
  const files: MutationFile[] = [], artifacts: Record<string, Buffer> = Object.create(null);
  const put = (id: string, path: string, kind: MutationFile['kind'], bytes: Buffer) => {
    const owned = Buffer.from(bytes); artifacts[id] = owned;
    files.push({ id, path, kind, bytes: owned.length, sha256: hash(owned) }); return id;
  };
  const source = input.baseline.binding.source.map((entry, index) => {
    const before = readFileSync(join(input.baseline.attempt, 'source', entry.path));
    const mutant = readFileSync(join(input.mutant.attempt, 'source', entry.path));
    if (hash(before) !== entry.sha256 || hash(mutant) !== input.mutant.binding.source[index]?.sha256 || input.mutant.binding.source[index]?.path !== entry.path) throw new Error('raw native source-role snapshot differs from predeclared binding');
    return {
      path: entry.path, physicalPath: entry.path === input.site.provider ? input.providerPhysicalPath : join(input.directory, entry.path),
      before: put(`source-before-${index}`, `raw/source/before/${entry.path}`, 'bytes', before),
      mutant: put(`source-mutant-${index}`, `raw/source/mutant/${entry.path}`, 'bytes', mutant),
      after: put(`source-after-${index}`, `raw/source/after/${entry.path}`, 'bytes', readFileSync(join(input.directory, 'source-after', entry.path)))
    };
  });
  // The full retained judge bytes must match BOTH before-run closure declarations.
  // Before/after refer to equal raw witnesses, not independently timed filesystem snapshots.
  const judgeEntries = ['report.mjs', 'vitest.mjs', 'playwright.mjs'].map((path, index) => {
    const bytes = readFileSync(join(input.directory, 'judge', path));
    return { path, physicalPath: join(input.directory, 'judge', path), before: put(`judge-before-${index}`, `raw/judge/before/${path}`, 'bytes', bytes), after: put(`judge-after-${index}`, `raw/judge/after/${path}`, 'bytes', bytes) };
  });
  const closureSha256 = hash(JSON.stringify(judgeEntries.map(entry => ({ path: entry.path, physicalPath: entry.physicalPath, sha256: hash(artifacts[entry.before]!) }))));
  if (closureSha256 !== input.baseline.binding.judge.closureSha256 || closureSha256 !== input.mutant.binding.judge.closureSha256) throw new Error('retained judge bytes differ from predeclared frozen judge closure');
  const attempt = (role: 'before' | 'mutant', acquired: AcquiredAttempt): MutationAttempt => {
    const native = readFileSync(acquired.output), observed = JSON.parse(readFileSync(join(acquired.attempt, 'process.json'), 'utf8'));
    if (!equal(JSON.parse(native.toString('utf8')).binding, acquired.binding) || acquired.binding.sourceRole !== role) throw new Error('native binding or source role differs');
    if (observed.childClosed !== true || !Number.isInteger(observed.status) || observed.signal !== null || observed.spawnError !== null) throw new Error('bounded child did not complete with supported process facts');
    put(`${role}-process-origin`, `raw/${role}/process.json`, 'bytes', readFileSync(join(acquired.attempt, 'process.json')));
    put(`${role}-transport-origin`, `raw/${role}/transport.json`, 'bytes', readFileSync(join(acquired.attempt, 'transport.json')));
    return { native: put(`${role}-native`, `raw/${role}/native.json`, 'native', native), binding: structuredClone(acquired.binding), process: { closed: observed.childClosed, exitCode: observed.status, signal: observed.signal, timedOut: false, spawnError: observed.spawnError } };
  };
  const baseline = attempt('before', input.baseline), mutant = attempt('mutant', input.mutant);
  for (const name of ['reviewed-site-before-baseline.json', 'reviewed-site-before-mutation.json', 'provider-origin-before-run.json', 'consumer-witness.json']) put(`declaration-${name}`, `raw/declarations/${name}`, 'bytes', readFileSync(join(input.directory, name)));
  put('acquisition-scope', 'raw/declarations/acquisition-scope.json', 'bytes', Buffer.from(JSON.stringify({
    sourceScope: 'Reviewed unchanged ordinary builtin hard body toBe; source/provider/site/scope frozen before baseline; native case ID frozen from baseline before mutation.',
    providerScope: 'Actual public import entry reread before both roles and after restoration; nominal entry/version/lock identity, not a complete transitive import graph or process-history attestation.',
    judgeScope: 'All three retained frozen judge files match both predeclared closure digests; equal before/after raw witnesses, not independently timed filesystem snapshots.',
    processScope: 'timedOut=false maps a bounded spawnSync return with numeric status and null signal/spawn error; descendant cleanup remains unknown.',
    wholeConsumerOwnerOrCatalogueRun: false
  })));
  return {
    schema: 'agent-tests/mutation-evidence@1', caseId: `rattletin-extracted-report-selfmutation-${input.site.framework.name}`, files, artifacts,
    pathPlatform: process.platform === 'win32' ? 'win32' : 'posix', physicalPathsCanonical: true,
    source: { entries: source }, mutation: { path: 'tools/mutation/report.mjs', applied: true, anchorBase64: input.anchor.toString('base64'), replacementBase64: input.replacement.toString('base64') },
    baseline, mutant, judge: { frozen: true, entrypoint: input.baseline.binding.judge.entrypoint, version: input.baseline.binding.judge.version, entries: judgeEntries },
    assertionSites: [structuredClone(input.site)]
  };
}
