# Measure a Node test run

The static audit estimates reading cost. To measure an actual Node 24+ run, use the optional reporter at
`scripts/node-profile.mjs`. Select the project's real test files explicitly: automatic discovery can include
archived, browser-only or fixture files. This command runs project code; the audit's scan/report commands do not.

```text
node --test --test-reporter=<reporter-file-URL> --test-reporter-destination=profile.json <test files>
```

On Windows, a custom reporter must use a `file:///` URL. Convert an absolute path using Node's `pathToFileURL()`;
do not pass a drive path as an ESM module specifier. A second `spec` reporter can preserve ordinary failure diagnostics:

```text
node --test --test-reporter=spec --test-reporter-destination=run.log --test-reporter=<reporter-file-URL> --test-reporter-destination=profile.json <test files>
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
