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
and its parent must exist. Output contains native stdout/stderr, native JSON and `receipt.json`; nothing is silently
overwritten. Keep it private, normally outside the checkout or under its ignored evidence directory.

Serial/unreviewed work defaults to one runner worker. `--cpu` declares that the operator reviewed the selected owners
as CPU-only and permits at most two; it does not infer resource use from filenames. Native concurrency flags may lower
that bound, never exceed it. Browser/GPU/server owners stay serial. Existing project protocols govern inner concurrency
and resource cleanup. Watch, single-run overrides, report replay, Node's `--test-rerun-failures` cached attempts and
reporter/output overrides are refused because this is a bounded recorder of a new native test run.
An optional `--timeout-ms N` stops only the recorded native child and retains interruption as failure; it is not a
replacement for each runner/test owning and cleaning its descendants.

Node uses `process.execPath` with `--test`, ordinary spec output and the existing `node-profile.mjs` reporter. Vitest
uses the checkout's installed `node_modules/vitest/vitest.mjs run`, ordinary output and its JSON reporter. Both use
argument arrays without a shell. The helper does not install a native runner. Any source/runner error prevents valid
evidence; a failed child still produces a receipt when observation can complete.

## Check the captured identity

```text
node "<plugin-root>/scripts/run-managed.js" candidate-evidence check --root "<project>" --receipt "<private-run>/receipt.json" --candidate <expected-HEAD-SHA>
```

Check returns nonzero for different candidate/source/index/content/path sets, unsupported closure, changed toolchain,
failed/signalled/spawn-error children, or missing/incomplete native reports. It reparses the native report and checks
its captured hash. Exact mismatch paths and before/after identity details are retained. A matching observation returns
`matched`, `matched-with-skips` or `matched-with-todo`; the actual counts stay visible. Skips/todo are not zero-skip
release acceptance. Missing native fields remain null/unknown—for example, Vitest does not report cancellation counts.

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
This is advice for the project collector, not progressive reporting implemented by this recorder. Keep flush status, native
test result, coverage counts and resource cleanup as separate facts.

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
