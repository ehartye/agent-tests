# Measure a Node test run

The static audit estimates reading cost. To measure an actual Node 24+ run, use the optional reporter at
`scripts/node-profile.mjs`. Select the project's real test files explicitly: automatic discovery can include
archived, browser-only or fixture files. This command runs project code; the audit's scan/report commands do not.

```text
node --test --test-reporter=<reporter-file-URL> --test-reporter-destination=profile.json <test files>
```

On Windows, a custom reporter must use a `file:///` URL. Convert an absolute path using Node's `pathToFileURL()`;
do not pass a drive path as an ESM module specifier. For a direct command, a second `tap` reporter exposes completed
case failure details promptly while retaining the natural footer and exit status:

```text
node --test --test-reporter=tap --test-reporter-destination=run.log --test-reporter=<reporter-file-URL> --test-reporter-destination=profile.json <test files>
```

The reporter writes `agent-tests/node-profile@1` JSON: Node/platform/root, start time, tracked Git provenance,
completion and success, overall `wallMs`, test counts, file summaries and the forty slowest cases. It preserves
failed runs and missing summaries as such. `elapsedMs` comes from Node's file summary and includes setup/teardown;
case durations overlap their parents and file lifetimes. Never add file/case durations to estimate wall-time savings.
The run's test process exit code remains the gate; a JSON file alone is insufficient. Tracked Git checks exclude
untracked files. `trackedStatusChangedDuringRun` compares status listings only: edits to an already-dirty file, committed
changes and edits subsequently restored can be invisible. It does not certify unchanged source bytes. The profile does not hash assets,
measure CI charges, claim statistical flakiness, or select affected tests.

First record the working dependency installation. Then compare a representative full command with a narrower lane
on the same source and environment. Record whether other workloads competed for CPU, and repeat only if uncertainty
changes the recommendation. Keep a failed setup attempt separate from a valid performance baseline.

This uses the documented custom reporter and per-file/overall summary events in
[Node 24's test runner documentation](https://nodejs.org/docs/latest-v24.x/api/test.html#custom-reporters).

For before/after source-byte and index evidence around one newly executed native command, use the checked
managed [candidate evidence recorder](candidate-evidence.md). It supports Node-test and Vitest, refuses cached
reruns/report replay and reports declared scope limits. It does not authorize test reuse or integration.
That recorder currently uses `spec`; the direct TAP recommendation above does not change its output or add progressive
owner records. Child completion also does not prove descendant cleanup.

## Retain an opt-in worker CPU profile

`node-profile.mjs` records native timings and counts. It does not collect Inspector CPU samples. When a fork worker is
killed during normal runner shutdown, process-exit `--cpu-prof` flushing can be lost. The separate Node-only module
`scripts/worker-cpu-profile.mjs` exports `createWorkerCpuProfile({outputDirectory, ownerId})` and
`summarizeCpuProfile(profile)`. It imports no runner and launches no process. Creating an instance does no I/O and
opens no Inspector session; explicit awaited `start()` and `stop()` own one selected profile scope.

First run the loaded plugin's `tests-setup` skill. Before each diagnostic, obtain `runtimeRoot` from a successful
checked installed setup; do not import from a guessed plugin-cache or managed-release path. For example, in PowerShell:

```powershell
$checkJson = & node "<plugin-root>/scripts/setup.js" --check --json
if ($LASTEXITCODE -ne 0) { throw 'Tests runtime check failed' }
$checked = $checkJson | ConvertFrom-Json
if (-not $checked.ok) { throw 'Tests runtime is not checked' }
$env:TESTS_RUNTIME_ROOT = $checked.runtimeRoot
$env:TEST_CPU_PROFILE_DIR = '<existing-physical-parent>/unique-owner-attempt'
$env:TEST_CPU_PROFILE_OWNER = 'selected-owner'
```

Record the actual project Vitest version and verify its public `beforeAll`/`afterAll` hooks. Put these two files beside
the project's actual `vite.config.ts`; the executable recipe supports a synchronous exported object, including
`defineConfig({...})`. Adapt the import filename to the real base config. Functions, promises, workspace configs and
other executable/async shapes require project-owned composition; this overlay refuses unsupported shapes rather than
dropping settings. The original aliases, environment, pool, isolation, timeout and other test settings remain in `base`.

```js
// profile-setup.mjs
import { beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

if (process.env.TEST_CPU_PROFILE_DIR) {
  if (!process.env.TESTS_RUNTIME_ROOT) throw new Error('A successful checked runtimeRoot is required');
  const { createWorkerCpuProfile } = await import(pathToFileURL(
    join(process.env.TESTS_RUNTIME_ROOT, 'scripts', 'worker-cpu-profile.mjs'),
  ).href);
  const profile = createWorkerCpuProfile({
    outputDirectory: process.env.TEST_CPU_PROFILE_DIR,
    ownerId: process.env.TEST_CPU_PROFILE_OWNER,
  });
  beforeAll(async () => { await profile.start(); });
  afterAll(async () => { await profile.stop(); });
}
```

```js
// profile.config.mjs
import base from './vite.config.ts';
import { fileURLToPath } from 'node:url';

if (!base || typeof base !== 'object' || Array.isArray(base) || typeof base.then === 'function') {
  throw new Error('This profiling overlay requires an object config; adapt executable configs explicitly');
}
const previous = base.test?.setupFiles;
const setups = previous == null ? [] : Array.isArray(previous) ? previous : [previous];
if (!setups.every(setup => typeof setup === 'string')) throw new Error('Unsupported setupFiles shape');
export default {
  ...base,
  test: {
    ...base.test,
    setupFiles: [...setups, fileURLToPath(new URL('./profile-setup.mjs', import.meta.url))],
  },
};
```

Run only the admitted owner with the original title/seed/policy population and deadline. For example:

```text
node node_modules/vitest/vitest.mjs run --config=profile.config.mjs tests/owner.test.ts --maxWorkers=1 --no-file-parallelism --testNamePattern="selected owner" --reporter=default --reporter=json --outputFile=native.json
```

The one-worker bound requires review against the project's real worker policy; preserve its pool/isolation and
per-case limits. Keep the overlay out of normal edit/test commands. Without `TEST_CPU_PROFILE_DIR`, the setup registers
no profiling hooks. Unset these diagnostic environment variables when finished. A hook failure remains a native runner
error; do not catch it into success or replace the original assertion details. Assertion failures and profiler/cleanup
failures must remain separately visible. `afterAll` is not guaranteed after a hard kill, `process.exit`, crash or blocked
event loop. Hooks shared across files are not supported by one instance: select one owner scope per attempt.

The attempt parent must already exist and have physical ancestry; `outputDirectory` must be a normalized absolute new
directory. `ownerId` is a portable 1–128 character ASCII identifier (letters/digits followed by letters/digits/dot/dash/
underscore), excluding Windows device names and a trailing dot. Existing attempts, duplicate start, stop before start,
overlapping helper instances and repeated stop are refused. A stopped or failed instance cannot restart; create a new
instance and new output. Overlap protection covers this helper in the same JavaScript isolate, including separately
imported copies. It does not arbitrate other threads/processes or unmanaged Inspector clients.

`descriptor.json` uses `agent-tests/worker-cpu-profile@1`, with owner, Node/platform/architecture, PID/thread and available
Vitest worker metadata, timestamps and explicit `started`, `failed` or `completed` status. `started` is durably written
before Inspector acquisition. `completed` is atomically published only after awaited `Profiler.stop`, exclusive raw
`worker.cpuprofile` write, retained-byte SHA-256/length verification and disconnect. Known failures reject and retain
failed evidence where possible; failed evidence publication can itself fail and is reported separately. The helper
disconnects and releases its slot without removing old evidence, other sessions or processes. A started descriptor,
missing raw file or hard-killed worker remains incomplete. Metadata is diagnostic identity, not process-tree authority.

Pair the raw hash with the exact argv, runtime/dependency identities, before/after source snapshot and native JSON.
Record selected/passed/failed/filtered counts and cleanup separately. A completed profile does not certify correct
counts, a green test, descendant drain or whole-project acceptance. Retain failed partial attempts. The historical
private Fallow profile does not qualify this helper; current acceptance must run unchanged assertions/config/aliases/
setups and the admitted seed/policy population. A selected owner with filtered cases is partial coverage.

`summarizeCpuProfile(JSON.parse(raw))` validates a usable single-parent connected node graph, sample references,
`startTime`/`endTime` and finite nonnegative matching `timeDeltas`. Missing samples, zero total sampled duration and
malformed profiles are refused. `totalSampledUs` weights each sampled frame by its actual delta; `profileSpanUs` is
the separate Inspector collection span. `selfUs` belongs to the sampled leaf and sums to the sampled denominator;
`inclusiveUs` also credits ancestors and overlaps. Shares are fractions of that same denominator, including runtime
frames. `sampledRuntimeUs` covers V8 `(root)`, `(program)`, `(idle)` and `(garbage collector)` self frames; `sampledGcUs`
is the GC subset, not additional time. Do not add GC again or sum inclusive frames into saved wall time. Generated Vite
positions remain generated positions unless independent source-map attribution establishes original source locations.
Inspector overhead, native test duration and command wall time are separate measurements. One profile estimates sampled
hotspots; it does not establish a causal optimization or controlled speedup.
