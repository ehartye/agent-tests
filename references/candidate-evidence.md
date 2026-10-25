# Observe a candidate test command

This opt-in helper records one actual Node-test or Vitest child plus content identities before and after it. It does
not select a lane, execute static audit findings, suppress tests, merge, deploy or authorize integration. `scan` and
`report` remain non-executing. Use the checked managed launcher from the loaded plugin; run tests-setup after updating
the plugin so the installed script matches its source.

## Observe explicitly selected owners

```text
node "<plugin-root>/scripts/run-managed.js" candidate-evidence observe node-test --root "<project>" --out "<existing-private-parent>/unique-owner-run" --generated-input public -- tests/owner.test.mjs
node "<plugin-root>/scripts/run-managed.js" candidate-evidence observe vitest --root "<project>" --out "<existing-private-parent>/unique-vitest-run" --generated-input assets -- tests/owner.test.ts
```

The Git root must be the complete checkout. Native arguments after `--` preserve the named selection and applicable
flags. Select an existing checkout file/directory; implicit discovery is refused. The output directory must be new
and its parent must exist. Output contains native stdout/stderr, native JSON, immutable `attempt-start.json`, numbered
`progress/` records, `progress-inventory.json` and terminal `receipt.json`. Nothing is silently overwritten. Keep it
private, normally outside the checkout or under its ignored evidence directory. The physical attempt path must not
traverse symbolic links or junctions.

Serial/unreviewed work defaults to one runner worker. `--cpu` declares that the operator reviewed the selected owners
as CPU-only and permits at most two; it does not infer resource use from filenames. Native concurrency flags may lower
that bound, never exceed it. Browser/GPU/server owners stay serial. Existing project protocols govern inner concurrency
and resource cleanup. Watch, single-run overrides, report replay, Node's `--test-rerun-failures` cached attempts and
reporter/output overrides are refused because this is a bounded recorder of a new native test run.
An optional `--timeout-ms N` stops only the recorded native child and retains interruption as failure; it is not a
replacement for each runner/test owning and cleaning its descendants.

Node uses `process.execPath` with `--test`, native TAP output and a candidate-only wrapper delegating to the unchanged
`node-profile.mjs` reporter. TAP retains its natural footer and native assertion details. The synchronized serial
case is qualified; arbitrary parallel output order has no immediate-output promise. Vitest
uses the checkout's installed `node_modules/vitest/vitest.mjs run`. Exact Vitest 5.0.3 uses default output plus a
public `vitest/node` JsonReporter subclass. Its constructor owns the attempt's JSON destination, even with conflicting
configured JSON options. It inherits initialization/coverage and awaits native final JSON; ordinary counts, snapshots
and coverage semantics remain native. Bounded native case/module/run errors are persisted before being echoed promptly,
so final default diagnostics can repeat them. Native worker callback batching can introduce a delay. Both runners use
argument arrays without a shell. The helper does not install a native runner. Any source/runner error prevents valid
evidence; a failed child still produces a receipt when observation can complete.

Other Vitest versions retain the previous default+JSON invocation and terminal predicate. Their owner progress is
explicitly `unsupported`; configured JSON destination interference remains a limitation of that fallback. This is
neither qualification of another version nor a new minimum version requirement. Explicit Node `--test-isolation=none`
also retains caller argv and terminal acceptance, with owner progress `unavailable`. Neither fallback invents owners.
CLI reporters already replace arbitrary configured reporter side effects; preserving those side effects is not promised.

Helper options are admitted per action before filesystem access. `observe` accepts `--root`, `--out`, repeated
`--generated-input`, `--cpu`, `--timeout-ms` and a native tail after `--`; `check` accepts only `--root`, `--receipt`
and `--candidate`. Duplicate singleton flags and action-inapplicable arguments are now rejected. Helper values use
separated arguments. Native arguments retain their runner syntax.

## Inspect durable progress without executing project code

```text
node "<plugin-root>/scripts/run-managed.js" candidate-evidence progress --attempt "<private-run>"
```

This action accepts exactly one separated `--attempt PATH`, without `--root`, equals form, native tail or other flags.
It reads only attempt evidence; it does not load the consumer runner or inspect current consumer source. It reports
selected argv separately from native discovery, known owners and native counts/errors, ended and discovered-unended
IDs, adapter capability, inventory integrity and known terminal child/report facts. Undiscovered remaining population,
observer liveness and cleanup stay `unknown`. Static records never establish that an observer is currently running.

Diagnostic `completed` requires valid terminal child closure and usable native terminal evidence for a qualified adapter.
It can include failed tests or a native no-tests result; check remains the separate acceptance decision. `interrupted`
requires explicit persisted timeout, signal or native interruption evidence. Missing terminal evidence, recorder death
or unsupported owner capability yields `unknown`. Known child/native facts are still exposed. Valid incomplete snapshots
exit 0; usage and integrity problems exit nonzero. `progressGateReasons` expose incomplete qualified adapter facts without
mislabeling an ordinary interrupted partial as corruption. No diagnostic state or exit status authorizes integration,
reuse or resume. Native cleanup and process descendant drain are never inferred from child closure or completed owners.

Node owner ends use actual isolated `test:summary.file` boundaries. Definition-file fallback rows in node-profile remain
provenance only. Error `entryFile`, when natively available, supplies owner association; missing `entryFile` keeps the
error unscoped and retains its definition file. Overall summaries never become file owners. Vitest owners retain module
and project identity, including independent IDs for a shared physical path. Module end also occurs on collection failure;
it does not prove assertions executed. Passed retry cases may retain actual prior errors without becoming newly rejected.
Counts use native public case results once; unavailable cancellation counts remain null. Receipt time and native duration
are separate; body-start times are never reconstructed by subtracting durations.

New observations use `agent-tests/candidate-evidence@2`. Start publication precedes spawn and binds the existing source,
toolchain and actual command identity. Reserved reporter transport overrides inherited transport environment values.
One synchronous adapter publisher serializes callback writes. Unique `wx` temporary files are synced and closed, then
published by an exclusive hard link and temporary unlink; this avoids rename's destination-replacement behavior.
The attempt filesystem must support hard links. Publication failure prevents qualified acceptance; start failure prevents
spawn. A crash between link and unlink can leave a recognized temporary file, which readers ignore.

Each numbered record binds its attempt ID and exact start-byte hash. Child closure seals sorted start/record raw hashes
and lengths; @2 check requires the receipt's matching inventory reference, contiguous sequences and valid transitions.
Qualified adapters also require native run end, no projection/reporter failure and representation of genuine reported
owner boundaries. Silent partial or empty adapter output cannot certify a nonempty native report. Existing input,
toolchain, candidate, native count and native child gates still apply. All three new helpers are explicitly fingerprinted.

Readers enforce fixed filenames, contained regular files, schema, binding and sealed inventory integrity. Symlink/junction
escapes, directory records and changed/missing/extra final records are refused. Limits are 512 KiB per progress record,
20,000 records and 32 MiB per bounded diagnostic read set. Error projection retains scalar allowlists, 4 cause levels,
4,096 UTF-8 bytes per error string, at most 128 case and 64 error details per projection and a 192 KiB shared detail budget.
Exact counts and explicit omitted/truncated totals remain visible. No engine/project/task graphs are serialized.
An unsealed enumeration is best effort: another record can publish immediately afterward. Hashes are local integrity
descriptors, not signatures; coherent rewriting of receipt plus inventory is not authenticated history.

## Check the captured identity

```text
node "<plugin-root>/scripts/run-managed.js" candidate-evidence check --root "<project>" --receipt "<private-run>/receipt.json" --candidate <expected-HEAD-SHA>
```

Check returns nonzero for different candidate/source/index/content/path sets, unsupported closure, changed toolchain,
failed/signalled/spawn-error children, or missing/incomplete native reports. It reparses the native report and checks
its captured hash. Exact mismatch paths and before/after identity details are retained. A matching observation returns
`matched`, `matched-with-skips` or `matched-with-todo`; the actual counts stay visible. Skips/todo are not zero-skip
release acceptance. Missing native fields remain null/unknown—for example, Vitest does not report cancellation counts.
`check` can parse legacy `agent-tests/candidate-evidence@1` under its old terminal rules. This promises neither legacy
progress availability nor cross-version replay; current helper/source fingerprints still govern matching.

`--candidate` must match both the captured and current HEAD. If the capture was dirty, HEAD is the committed base for
the observed working tree, not a tested final commit. Committing/rebasing/squashing later produces a different source
identity even if some bytes match; check does not promote or remap that receipt. A clean HEAD with declared ignored
generated roots is likewise accompanied by their separate content identity.

## Scope and limitations

### Attribute runtime evidence and reuse

For a native renderer or offline build, record the actual renderer/version, served URL and build identity, asset URLs
and hashes of the final bytes loaded, including packaging or postprocessing. Tie captures to the same owner attempt.
A source revision, successful build or file on disk does not prove the server loaded it; check the served artifact
against the intended build so stale offline output cannot certify current source. The caller owns this evidence;
neither static scan/report nor this receipt establishes runtime renderer or served-byte identity automatically.

Consumer collectors should retain partial scope at their existing boundaries: planned owners/cases, actually executed,
failed and unrun scope, plus bounded full diagnostics for failures. Unknown discovery or cleanup stays unknown. A missing
final report is incomplete even if some owners completed; neither a batch index nor a CPU profile makes it whole-run green.
The recorder retains native owner facts at the boundaries above; caller-owned population and cleanup policies still apply.
Keep flush status, native test result, coverage counts and resource cleanup as separate facts.

Refuse an existing attempt directory before acquisition instead of overwriting it. After capture, inventory/hash the final
artifacts and associate each with its producing owner/attempt. Retain failed partial attempts. For ordinary corruption controls,
copy inputs to an exclusively owned OS-temp directory and remove only that temporary copy in `finally`; never delete historical
evidence as cleanup. A receipt or artifact path alone proves neither restoration nor descendant drain.

### Mutation evidence remains a separate contract

Start from a green, nonempty baseline with the same selection and actual assertions. A mutation kill requires an executed
assertion failure; collection/import/syntax errors, no tests, infrastructure errors, timeouts and missing terminal reports remain
unclassified. Nonzero exit alone is insufficient. Keep an independent frozen, hash-verified judging reporter outside the mutation
set, especially when mutating a reporter. Restore original source bytes in `finally` and verify their exact hashes even after
failure; a failed restore invalidates accepted mutation proof. Partial rerun composition must retain each original command,
source/dependency identity and omitted scope, and must be labeled composed source-pinned evidence. Only a newly executed complete
list establishes whole-list fresh execution. These are consumer obligations: a generic mutation-verdict command is unshipped,
and the inspected consumer heuristics do not constitute a finished portable classifier. Candidate checks still require green runs.

### Reuse and identity limits

Record same-attempt reused owner evidence separately from newly executed checks, with its original result and scope.
Reuse is eligible only when all relevant inputs, helpers, tool/dependency/environment identities, build and final asset
bytes are unchanged and the project policy permits it. Unknown dependencies widen the affected scope and require fresh
owner evidence; a matching receipt cannot fill that gap or waive full/release gates. This is caller-owned attribution,
not a new recorder mode: cached-attempt replay remains refused, and receipts cannot be remapped to later commits.

The receipt records HEAD/tree, logical index entries, Git-visible tracked/nonignored-untracked bytes and full path/type
sets, plus explicitly declared generated-input roots. Additions, deletions, already-dirty byte edits, staged changes,
package/lock changes and generated bytes can invalidate equality. Missing declared roots are recorded. Input traversal,
symbolic links and Git submodules are refused; only the helper's declared output subtree is excluded.

Git-ignored inputs must be named with repeated `--generated-input` flags when relevant. This is a declared observation
scope, not a dependency tracer. Installed dependency contents, external producers/tool assets and other ignored inputs
remain unverified; runner version/entrypoint hashes do not certify that closure. Environment values beyond recorded
toolchain/argv are also unverified. Caller-owned input policy and required checks remain necessary.

Before/after equality cannot detect transient edits restored between snapshots. The helper records Node/ABI/platform/
architecture, observer/helper/profile and native entrypoint identities, argv, actual child status/timestamps and actual
reported counts. It does not establish statistical flakiness, CI charges, complete gameplay coverage or permission to
reuse a required check. A successful check only matches this recorded command and declared scope.

Native interfaces: [Node custom reporters](https://nodejs.org/docs/latest-v24.x/api/test.html#custom-reporters),
[Vitest JSON reporter](https://vitest.dev/guide/reporters.html#json-reporter) and [Vitest CLI](https://vitest.dev/guide/cli.html).
The existing [Node profiling reference](node-profiling.md) explains overlapping duration/count semantics.
