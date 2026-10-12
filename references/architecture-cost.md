# Architecture advice for testing cost

An audit should explain why changes are expensive, not only label tests. The most useful recommendation may be a
boundary or ownership change: one artifact contract instead of many unrelated generation pipelines, a testable seam
instead of replaying a complete story, or one compiler setup instead of many. This is advisory work. Do not rewrite
product architecture as part of the audit.

## Trace cost to a decision

Start with measured slow files or repeated setup. Without timings, label structural observations and hypotheses;
do not rank a large file as slow from its length. Read scripts, test helpers and the source they exercise. Trace:

1. **Dependency fanout.** Which central modules make apparently unrelated changes affect many tests? A common import
   can be a legitimate public facade; it is not proof of duplication or a reason to split everything. Identify the
   smallest cohesive owner that could expose the behavior directly. Account for coupling introduced by the split.
2. **Repeated setup.** Count compiler programs, server starts, raster renders, builds, fixtures and complete journey
   prefixes. Distinguish repeated necessary assertions from repeated expensive preparation. Cache immutable fixture
   preparation within one test run when every assertion remains independent. Inspect collection-time work in suite
   declarations: a filtered test can still prepare every scenario before its callbacks run. Reporter assertion spans
   may omit this preparation, so compare actual command wall time and collection before blaming a fast assertion.
3. **Pipeline diversity.** Inventory actual entrypoints, producer versions, manifests, outputs and postprocessors.
   Many manifest files can describe one pipeline; several renderer techniques do not automatically mean several
   independent contracts. Count verified implementations, not names or filenames. Follow one representative output
   from text input to final runtime bytes and identify who certifies each boundary.
4. **Verification ownership.** Find invariants repeatedly asserted by a generator, a consumer and a packaging suite.
   Generic export validity belongs to the producer; game-required IDs, resource routing, actual loading/rendering and
   final package membership belong to the consumer. A producer check cannot certify a consumer's later mutation.
5. **Artifact identity.** For changed-only generation or reuse, inspect complete inputs: imported helpers, fonts,
   shared profiles, generated prerequisites, toolchain and downstream transformations. Check output content hashes,
   not just existence. Missing declared dependencies invalidate a precise skip decision. Use conservative area routes
   until completeness is established, and verify final artifacts after any transformation.
6. **Process boundaries.** Identify fixed resources, shared mutable files, hardware assumptions and incomplete teardown
   that force serialization or expensive retries. Suggest isolation before adding workers. Never treat reruns as a
   repair for nondeterministic fixtures.

## Compare concrete alternatives

For each material cause, record `decision -> evidence -> cost -> alternative -> replacement protection`. Prefer the
smallest change that improves the edit loop; include keeping the current architecture when a redesign does not pay
for itself. A common manifest/verification protocol often costs less than replacing every renderer. Recommend one
generation implementation only when feature parity, authoring quality and maintenance costs justify it.

Below each alternative, state:

- **Time:** setup effort now, measured or estimated feedback savings, and detection deferred to later lanes.
- **Risk:** specific regressions, likelihood/severity, and the remaining test or fixture that catches them.
- **Complexity:** abstractions, adapters, cache invalidation and configuration introduced or removed.
- **Best practice:** how it serves real behavior and explicit ownership; identify project opinion separately from cited guidance.
- **Maintainability:** the number of places future content/schema/toolchain changes must update.

Use confidence labels and a review trigger. A timing prototype with fewer tests is not a proven safe merge lane;
name omitted behavior and its proposed cheaper protection. Do not claim a target speed until the complete replacement
lane, including smoke checks, has been measured. Do not issue delete/demote verdicts without the owner's risk decisions.

## Output

Add an **Architecture advisory** after project findings: prioritized decisions, exact evidence paths, measured costs
or explicitly labeled hypotheses, alternatives with the five implications, replacement coverage, effort and next
experiment. Separate the implemented tool changes from proposed product architecture changes. List missing dependency
or artifact data that prevents a trustworthy affected-only plan.

Ground behavioral and fixture advice in [Playwright's official best practices](https://playwright.dev/docs/best-practices)
and process isolation in [its worker model](https://playwright.dev/docs/test-parallel). The architecture decision rubric
above is project advice rather than a vendor mandate. For Node measurements, read [node-profiling.md](node-profiling.md).
