// Node 24+ custom reporter. Executes no commands except read-only Git provenance.
// Usage: node --test --test-reporter=<reporter file URL> <test files>
import {execFileSync} from 'node:child_process';
import {relative} from 'node:path';

const git = (...args) => {
  try {return execFileSync('git', args, {encoding:'utf8', windowsHide:true, timeout:5000, stdio:['ignore','pipe','ignore']}).trim();}
  catch {return null;}
};
const localPath = path => relative(process.cwd(), path).replaceAll('\\','/');

/** File summaries include setup and teardown; case timings overlap and must not be added to infer wall time. */
export default async function* nodeProfile(events) {
  const startedAt = new Date().toISOString();
  const source = git('rev-parse','HEAD');
  const before = git('status','--porcelain=v1','--untracked-files=no');
  const files = new Map();
  const slowestTests = [];
  let summary = null;
  for await (const {type,data} of events) {
    if (type === 'test:summary') {
      if (data.file) files.set(localPath(data.file), {file:localPath(data.file), elapsedMs:data.duration_ms, success:data.success, counts:data.counts});
      else summary = data;
    } else if ((type === 'test:pass' || type === 'test:fail') && data.file) {
      const file = localPath(data.file);
      if (!files.has(file)) files.set(file,{file, elapsedMs:null, success:type !== 'test:fail', counts:null});
      if (type === 'test:fail') files.get(file).success = false;
      slowestTests.push({file,name:data.name,line:data.line ?? null,nesting:data.nesting,durationMs:data.details?.duration_ms ?? null,status:type==='test:fail'?'failed':data.skip?'skipped':data.todo?'todo':'passed'});
    }
  }
  const after = git('status','--porcelain=v1','--untracked-files=no');
  const finite = x => Number.isFinite(x) ? x : -1;
  yield JSON.stringify({
    schema:'agent-tests/node-profile@1',
    node:process.version, platform:process.platform, root:process.cwd(), startedAt,
    source, trackedDirty:before === null ? null : before !== '', trackedStatusChangedDuringRun:before === null || after === null ? null : before !== after,
    complete:summary !== null, success:summary?.success ?? false,
    wallMs:summary?.duration_ms ?? null, counts:summary?.counts ?? null,
    files:[...files.values()].sort((a,b)=>finite(b.elapsedMs)-finite(a.elapsedMs)||a.file.localeCompare(b.file)),
    slowestTests:slowestTests.sort((a,b)=>finite(b.durationMs)-finite(a.durationMs)||a.file.localeCompare(b.file)).slice(0,40),
    notes:['One run, not a flakiness estimate. File and nested case durations overlap; summing them does not measure saved wall time. Missing file summaries remain null. Git provenance records tracked status listings only; same-status content edits and files changed then restored are not detected.'],
  },null,2)+'\n';
}
