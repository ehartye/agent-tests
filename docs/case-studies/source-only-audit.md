# Source-only audit qualification (0.9.1)

The change is skill routing, not a new CLI mode. A manual audit can read bounded source/risk evidence without managed
setup; managed commands still resolve the matching checked runtime. No project-specific private examples are shipped.

## Behavioral exercise

Two independent evaluators received the same synthetic fixture and request: inspect only `src/cache.mjs` and
`tests/cache.test.mjs`, optionally run `npm run test:selected`, do not install, inspect the unselected test, or run the
whole suite. No risk tier was confirmed. The implementation returned `values.slice(0, limit)` and the selected test
checked only output length for three values and limit two. The unselected test throws if executed.

Both evaluators identified the real but incomplete assertion: incorrect contents/order can pass. They withheld
formal verdicts without confirmed tiers, labeled static counterexamples rather than claiming executed mutations,
and ran the selected native test (one pass, zero failures). Neither inspected or executed the unselected test.

The baseline audit entry point unconditionally ran a readiness check against an isolated empty managed home and
received exit 1 with `ok:false`. It then continued the bounded audit. This is evidence of an unnecessary prerequisite,
not proof that the old skill always blocks manual work: the baseline evaluator also saw the updated setup guidance.
The updated entry point needed no setup/check/install and reported inspected scope, exclusions and unmeasured metrics.
It correctly distinguished the separate hypothetical managed-report request: preserve the missing-runtime error,
state that no managed report was produced, and honor the no-install constraint. That scenario was reasoning evidence;
the executable guards and real install/report exercise below separately cover actual command behavior.

## Executable qualification

The managed-runtime suite exercises all eight launcher routes with an empty isolated home and a sentinel. Each must
exit 1 with `E_RUNTIME_MISSING`, emit no report on stdout, leave the sentinel intact and install nothing. Existing
tests retain matching-runtime dispatch, tamper refusal, setup locking and failed dependency checks.

A separate disposable home exercised actual missing readiness, clean `setup.js`, matching plugin/CLI 0.9.1 readiness
and a real managed `report` against the synthetic project. The report identified the missing risk map and statically
inventoried both files without executing the throwing negative control. This broader managed inventory is distinct
from the two-file manual result. No real user managed home or global CLI link was modified.

The generic skill-creator validator rejects this repository's existing `when_to_use` frontmatter extension. The
repository's own skill tests validate that supported field, reference paths, commands, flags and listing/body budgets.
The first focused run caught a one-line body-budget overrun; it was corrected without weakening the 160-line limit.
Independent review found no blockers and prompted an explicit manual exception to the later managed output checklist.

Local qualification on Node 24.18.0: full suite 1,135 passed, three skipped (32 files), typecheck passed; the final
focused skills/managed-runtime selection passed all 78 tests after the wording clarification. The three full-suite
skips are retained conditional tests, not new exclusions. The first focused run had 77 passes and the single body
budget failure described above. Hosted platform results belong to the release record; local checks do not imply them.
