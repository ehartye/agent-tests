# Exact native mutation fact fixtures

This private standalone dev fixture package pins Vitest5.0.5 and Playwright1.64.1. It is not a root workspace, does not alias the producer's Vitest5.0.3, and adds no managed production runtime dependency. The capture tools retain raw public native facts. The required `tests/mutation-native.test.ts` owner separately runs the production adapters with frozen reporter files and checks their public projections; neither capture tool nor adapter classifies mutation verdicts.

Run setup once from the repository root, with browser downloads disabled:

```powershell
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
npm ci --prefix tests/fixtures/mutation-native
Remove-Item Env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
```

Preserve an existing environment value when applying this example in a session that already set it. Never install dependencies from a test body. Missing exact dependencies must fail the required qualification lane rather than silently skip. The coordinator owns the one native/heavy-job lease and pins the Node executable used for acquisition.

Run serial bounded capture from any directory with an explicit absolute fresh external output root:

```text
node tests/fixtures/mutation-native/acquire-facts.mjs vitest C:/absolute/fresh-output
node tests/fixtures/mutation-native/acquire-facts.mjs playwright C:/absolute/fresh-output
```

An optional list of control names limits a stage. Each native child uses the fixture's physically allocated config/dependencies, one worker and an18second acquisition guard. Playwright controls request no page/browser fixture. Failed assertion/negative controls intentionally exit nonzero; inspect retained process and capture files instead of treating every red child as an acquisition failure or a mutation kill.

Each attempt gets a unique framework/control directory. Existing captures refuse overwrite. Raw public-field captures, child argv/status/signal/error, stdout and stderr remain external; accepted canonical evidence is never an output destination. Actual child closure is recorded, but descendant cleanup is not authenticated. An interrupted/deadline acquisition stops subsequent children pending handle review.

Do not broaden these observations to other framework versions, all matchers, actual game browser owners, or whole mutation catalogues. The existing consumer helper and generated unchanged assertion are retained separately for actual extracted integration; generic controls do not replace that required seam.

The native owner allocates physical fixture directories, serializes native children, and removes only its own directories after each test. Set `AGENT_TESTS_MUTATION_NATIVE_EVIDENCE` to a fresh external directory to retain the entire acquisition before cleanup. Every attempt uses the reserved `AGENT_TESTS_MUTATION_TRANSPORT` JSON with a fresh output path and a predeclared binding. The adapter records actual invocation facts independently and publishes with exclusive creation. Oversized strings, events or aggregate projections set explicit truncation/incompleteness instead of supporting a verdict.

`counts` describes the complete native case population only when projection is complete; every count is `null` for incomplete or truncated records. `retainedCounts` separately counts the retained case entries (including an explicit `unknown` status bucket), and `retainedDetails` gives the exact lengths of retained cases, run errors, case-error entries, hooks and steps. `omissions` records observed discarded callback/item events and text-value/UTF-8 byte losses at projection boundaries. These are lower bounds, not a total population estimate: facts inside discarded callbacks or unvisited iterator tails remain unsampled, and `unobservedRemainingPopulation` stays `null` for incomplete records. The final publication fallback recomputes retained sizes after clearing arrays and preserves unknown native totals.

The extracted Vitest consumer test preserves all239 authored bytes. Its mutation changes only the helper's unique raw assertion-error guard anchor, and the owner restores and compares the original raw bytes in `finally`. The separate Playwright test exercises the same helper without browser fixtures. Consumer acquisition also snapshots the framework's public import entry as data before either run and records its physical origin; this is a source binding for the reviewed entry, not a transitive matcher implementation resolver or process attestation. Accepted evidence and canonical artifacts are never test output destinations.

Those same consumer runs feed their raw native/source/judge artifacts to the public mutation evidence classifier through the repository-local `tests/helpers/mutation-native-bundle.ts` helper. The owner requires each nominal reviewed profile to return `killed` with exact restoration. In-memory diagnostic changes to judge/restoration/anchor declarations must return `unclassified`; these variants launch no additional children and never rewrite the actual native records. Review coordinates and provider scope are declared before baseline, and the successful baseline supplies only the native case ID before mutation.
