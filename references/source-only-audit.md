# Manual source-only audit

Use this route when the request can be answered by reading selected source, tests, risk decisions and existing evidence.
Do not run setup or install a managed runtime just to read files. Missing runtime availability is not a product defect.
If a managed command or its inventory is needed, return to test-audit's managed steps. A failed check is not permission
to bypass the checked launcher, use an arbitrary CLI on PATH, or present manual findings as a managed report.

## Scope and evidence

- Record the repository/root, revision or working-tree state, exact files or bounded roots actually inspected,
  selection method and exclusions. Distinguish inspected files from merely listed files and supplied evidence from fresh runs.
- Read existing `.testing/risk.yml` and confirmed session decisions. If absent or incomplete, report the gap;
  a manual review does not need `risk-draft`. Do not invent tiers, consumers, phase or risk-map validity.
  Files without a confirmed tier receive no verdict; concrete risks and structural advice can still be reported.
- Read the selected tests and the behavior they exercise before applying the shared rubric. Cite paths and concrete
  failure modes, affected consumers and replacement coverage where supported. Unread or excluded files receive no
  verdict, including no automatic `keep`. No warning in a sample establishes whole-suite completeness.
- Use repository-native checks only when authorized and relevant. Inspect their scripts and isolation first; preserve
  unrelated data/processes. Record the exact command, selection, result and environment limits. A selected passing
  check is evidence for that selection, not a managed scan or whole-suite acceptance. If checks cannot safely run,
  report them as not run and explain why; a source-only audit can still conclude with bounded findings.

## Output

Label the result **Manual source-only audit**. Include inspected scope and exclusions, risk-map gaps, path-bound
findings and evidence, any native checks and limitations. Use the shared verdict rubric only for directly inspected
files with confirmed tiers. In the output table, replace a managed finding rule with the concrete source evidence;
mark uncollected token/churn/frequency metrics as unmeasured. Omit managed category counts, unopened-keep counts and
suite-wide savings totals unless independently collected for the stated scope; explain their provenance if included.
Do not emit a CLI evidence schema or call the result a managed inventory/report.

For example, reviewing `src/cache.ts` and `tests/cache.test.ts` can identify an unasserted eviction branch. A passing
native selector for that file does not prove all cache tests were discovered or the rest of the suite is sound.
With no confirmed risk tier, report the missing map and the branch risk without assigning a keep/rewrite verdict.

If the owner explicitly requested a managed report and readiness fails, preserve the exact command/error and state
that the managed report was not produced. Offer or perform a bounded manual fallback only within the authorized scope,
clearly separating it from the unmet managed deliverable. Never silently convert one into the other.
