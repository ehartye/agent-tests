# Read-only mutation evidence

Use a mutation to check whether a selected assertion detects a specific fault. First run the unchanged selection and require a green, nonempty native baseline. A failed mutant is a diagnostic input; it is never candidate-green acceptance.

The checked helper reads acquired evidence without applying source changes or running tests:

```text
node "<plugin-root>/scripts/run-managed.js" mutation-verdict classify --input <absolute-bundle.json>
```

Only the separated `classify --input` form is supported. There are no apply, run, reuse or resume actions. Exit 0 means valid diagnostic output, including `unclassified`; inspect the verdict and reasons. Exit 2 means invalid arguments, malformed evidence or referenced-byte integrity refusal. Neither exit 0 nor a mutation kill authorizes a merge, release or reuse.

## Acquire a bounded, useful case

1. Choose the actual native owner and exact selection. Keep its normal assertions, project, configuration, dependency lock and effective timeout. Record executable, Node/framework versions, argv, cwd, selection and declared input identities. Software/gpu routing and actual GPU-lock admission belong to the project; an empty GPU selection proves no rendering.
2. Allocate fresh ephemeral output and validate its parent before launching the baseline. Preserve accepted art/audio/render captures and measurements. Keep fresh native artifacts and attach their exact hashes. Deliberate promotion of accepted evidence needs its own source, renderer and hash review; this helper provides no promotion service.
3. Freeze an independent reporter/helper import closure before mutating source. Bind its actual invocation, version, raw before/after hashes and physical paths. The live report helper can be the subject under test; it cannot judge itself. Preserve all records if the reporter fails.
4. Capture the unchanged green nonempty baseline. Apply one nonempty unique raw-byte anchor replacement in one declared file, run the identical selected owner, and restore the original Buffer in the caller's lifecycle. Retain before, mutant and after snapshots. A missing restoration snapshot stays unknown; decoding text is insufficient for invalid UTF-8, BOM or CRLF.
5. Read the evidence through the checked helper. Keep native status separate from process exit/signal/timeout and from the strict verdict. Do not rename collection, hook, import, syntax, runtime, no-tests or interrupted failures as assertion kills.

One touched file is an exact transformation, not a whole-file exemption. The complete mutant must equal the original with precisely the one unique anchor replaced; every other declared source/config/assertion/provider entry remains unchanged. A hidden second edit or changed assertion/provider invalidates the qualification.

## Records and programmatic boundary

`agent-tests/mutation-evidence@1` carries `caseId`, a file inventory, source snapshots, the mutation declaration, baseline/mutant process and binding records, frozen judge closure and reviewed assertion sites. `agent-tests/mutation-native@1` records public native facts. The module declarations in `scripts/mutation-verdict.d.mts` define the precise fields.

Inventory entries contain unique IDs and relative forward-slash paths, raw SHA-256, byte lengths and kinds. Semantic fields refer to those IDs; unchanged snapshots can share an inventory entry. The filesystem reader requires contained physical regular files, refuses links/traversal/duplicate paths and verifies byte identity before parsing. Fixed exported `MUTATION_LIMITS` bound files, bytes, records, strings, error causes and ancestry. Explicitly absent acquisition information is different from a hash mismatch or malformed supplied record.

`readMutationEvidence(absolutePath)` returns a hydrated envelope with an explicit in-memory `artifacts` map of raw Buffers. `classifyMutationEvidence(bundle)` and `validateMutationComposition(manifest)` recheck inventory integrity for programmatic callers. They do not execute any referenced module, launch children, mutate files or authenticate a process history. Use the core module for imports; `mutation-verdict-cli.mjs` is the command entrypoint.

Attempt bindings repeat the exact source role, source hashes, toolchain/config/selection and frozen-judge identity in the native report. The judge `closureSha256` covers ordered UTF-8 JSON records `{path,physicalPath,sha256}` using the declared before digests. Supply canonical physical-path declarations and their platform; absent or ambiguous identity prevents strict proof. These are reviewed honest acquisition inputs, not cryptographic attestation or a complete inferred JavaScript dependency graph.

Incomplete or truncated native records publish `null` population totals. `retainedCounts` and `retainedDetails` describe only the records retained in the report. `omissions` records directly observed discarded callback/item boundaries and text losses as lower bounds; unsampled remaining populations stay unknown. Neither a retained count nor an omission lower bound supplies the missing complete native population.

When declared source and judge files still exist on this host, physical identity checks also detect hard-link aliases. Historical bundles can refer to acquisition paths that no longer exist; their path disjointness remains an honest acquisition declaration, not retroactive proof of historical file identity. Retained snapshot hashes alone cannot establish that two live acquisition paths were independent during the mutation.

## Outcomes and assertion scope

- `killed`: all baseline, exact delta, population, toolchain, independent judge and raw restoration gates pass, with a supported native assertion-failure profile accounting for every relevant error.
- `survived`: those integrity gates pass and the mutant completes green with a compatible nonempty executed population and no invalidating errors.
- `skipped`: an explicit nonapplication/exclusion with no mutant launch and unchanged/restored evidence. A failed native run is not a skip.
- `unclassified`: unknown or unsupported evidence, including red/empty baselines, arbitrary throws, hook/collection/runtime errors, retries/expected failures, timeouts/signals, disappearing cases, missing/truncated reports, mismatched bindings or failed/unknown restoration.

The two narrow profile contracts are `vitest-5.0.5-builtin-toBe-site-v1` and `playwright-1.64.1-hard-builtin-toBe-site-v1`. They require exact native versions, completed native outcomes and an unchanged reviewed builtin site/provider. Source inspection or a handcrafted `AssertionError` is not native acceptance. Do not infer another version or matcher family.

An assertion-site declaration binds the exact case/project, logical source/provider paths, raw qualification hashes/lengths and file/line/column. Its `sourceScope` is `{reviewed:true,contract:'hook-free-builtin-toBe-v1'}`: the caller reviewed the scope to exclude per-test/suite/around hooks, lifecycle cleanup callbacks, custom matchers, soft or fixture assertions, nested steps and runtime alteration of the builtin provider. The native case ID may be filled from the successful baseline before mutation; declaration locations must come from reviewed source, not retroactively chosen failing frames.

This is nominal classification under honest acquisition. Provider qualification binds the reviewed public import-entry bytes and exact dependency lock/version; a forwarding entry does not prove all transitive matcher implementation bytes or authenticate a process history. Retain actual physical provider-entry bytes in every role and after restoration, not only a once-copied file. Broader closure or attribution uncertainty stays outside the qualified profile.

Vitest requires one failed case/error with its actual standard operator/scalar projection and exact structured site; observed hooks or unaccounted global errors refuse the profile. Playwright requires one ended failed root hard expect step, exact presence-aware equality of result alias, sole result error and step error, matching source location and no other failed steps. The initial Playwright projection admits the actually qualified message/stack/location tuple with value/cause absent; other projections remain unsupported. Both profiles preserve configured retry/repeat/expected-failure refusal. Initial qualified runs require active ordinary cases; mixed inactive/skip/todo cases, focused native modes and additional failed cases remain unsupported rather than being silently omitted.

The narrow intended profiles use an unchanged reviewed builtin `toBe` site/provider and exact native case/source mapping. Vitest public error shape does not universally distinguish body and cleanup errors; some cleanup callbacks emit no hook event. Playwright expect steps also contain custom matcher throws. Native structured fields, exact source scope and complete error accounting are required together. Error-name matching, message keywords, step titles and broad body ranges are insufficient. An assertion value containing `timeout` or `import` must not be discarded by a text filter.

## Honest partial composition

The same command can read `agent-tests/mutation-composition@1`. It validates explicit catalogue/case references, uniqueness, omitted scope, declared closure compatibility and fresh/reused labels. Strict totals come from recomputing referenced evidence, not trusting a file that merely says `killed`. Missing strict evidence stays unclassified. An optional recorded verdict that disagrees with recomputation is reported as a composition problem.

Composition also bounds cumulative verification work with `MUTATION_LIMITS.compositionBytes` (64 MiB), separately from the stored-file inventory bound. It charges referenced catalogue/evidence/verdict JSON and declared evidence-subset bytes before repeated parsing or classification. Over-budget input is an integrity refusal. Malformed, undeclared and duplicate cases are rejected before following their references; case-identity or recorded-verdict contradictions cannot contribute a strict kill or survivor.

Each referenced classification derives `inputClosureSha256` from its actual declared before-source, native execution identity, judge, assertion sites and mutation declaration. Composition supplies `requiredClosures` per case and checks both that requirement and the entry's claimed closure against the derived value. Changing two outer labels cannot revalidate old inputs. Incompatible entries become unclassified while `referenceVerdict` retains their original scoped result. An optional old global closure label has no compatibility authority.

Keep historical counts separately, with original artifact hashes and `newFullBatchRun=false`. A historical account of 74 reused plus 2 fresh kills does not become 76 newly qualified strict kills. The tool does not infer dependency completeness, decide which cases to rerun, authorize reuse or manufacture a full catalogue execution. Report the exact selected population and its limits.

## Qualification ownership

Framework packages belong to the caller's development/test setup. The installed managed runtime does not need Vitest, Playwright or browsers to read a bundle. Producer qualification has its own standalone locked dev fixture package; dependencies are installed explicitly once, never from a test body. Missing exact packages fail the required qualification owner instead of silently skipping advertised support.
