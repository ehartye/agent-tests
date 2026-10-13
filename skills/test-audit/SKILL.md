---
name: test-audit
description: Audit a project's test suite for necessity and efficiency - redundant coverage, compat and fallback shim tests, worktree-hostile tests, tests not tied to a risk tier or tagged for the wrong lane, and tests that run too often - and return a verdict per test file.
when_to_use: Use when an existing test suite or its CI feels too big, slow or redundant ("tests take forever", "too many tests", "is this overkill"), when architectural decisions or generated-asset pipelines make testing costly, before pruning tests, or when asked to audit testing structure.
---
# test-audit

The goal is efficiency: protection per unit of cost. A slow test that guards data loss is worth keeping;
a fast test that repeats three others is waste. Speed alone never decides a verdict.

The CLI gathers evidence and never judges. You judge, using the rubric below. The audit phase is read-only.

An audit-only request ends with findings. If the owner also authorized applying or shipping improvements, finish
the audit and continue the approved work under the development workflow; do not add another approval pause or
leave supported actions as an unspecified future phase. Authorization does not justify pruning without replacement
coverage. Deliver the measured change, its verification and any precise remaining limitation.

`<plugin-root>` is the directory that holds scripts/run-managed.js, the parent of the skills directory (two levels
up from this skill's directory). In Codex, resolve it from the SKILL.md file you loaded, not from the current directory.
Quote the project path (`"<project>"`) so a Windows path with spaces survives.

## Steps

1. **Runtime.** `node "<plugin-root>/scripts/setup.js" --check --json`. If `ok` is false, load the tests-setup skill.
2. **Risk map.** Look for `.testing/risk.yml` in the project.
   - Missing: run `node "<plugin-root>/scripts/run-managed.js" risk-draft --root "<project>"`, which prints a draft and
     writes nothing, and show the owner the draft. Ask three things: the project phase (`dev` pre-release, `test`
     stabilizing, `production` released), who consumes this code (`consumers`; an empty list means nobody), and which
     areas are critical, standard or low. For audit-only work, report the draft and risk gaps without writing it.
     When map creation or implementation is authorized and those decisions are confirmed, run the same command with
     `--write`, edit `.testing/risk.yml` to apply the answers, and rerun `report` to validate it; an `E_RISKMAP` error
     names the bad field. Reuse decisions already confirmed in the session.
   - Present: read it. Treat `phase`, `consumers` and `areas` as the owner's decisions.
3. **Evidence.** `node "<plugin-root>/scripts/run-managed.js" report --root "<project>"` prints a ranked Markdown view
   (add `--max-files <n>` for a longer table); `scan` prints the full JSON.
   - The report opens with a header and category counts. Project findings (CI, hooks, scripts, agent instructions,
     risk-map gaps) follow, then a table of test files.
   - The table ranks unparsed files first, then possible opaque registrations (inventory may be incomplete), then files
     with the most distinct finding rules. Read the first two directly. The Rules column shows which rules fired. Several `redundancy.shared-subject`
     findings are weak evidence; one `worktree.*` or `shim.*` rule on a real hazard is strong.
   - This version never runs the tests, so wait time and CI minutes are absent. Agent cost is estimated tokens in the
     file. Churn/edits is edits that touched the test without the code it covers, over all edits that modified it;
     `n/a` means no git history (a shallow clone has none) or no resolvable subject.
   - The CLI checks hooks, scripts and workflows for frequency only. Also read the CI workflow and `package.json`
     yourself: a `pretest` that repeats `test` runs the suite twice, and a workflow with no install step or cache
     fails or wastes minutes.
4. **Read before judging.** Findings are evidence, not verdicts. Open the test files behind the highest-ranked findings
   and the files in each cluster. Pattern matches produce false positives: a test titled "falls back to the default" may
   guard real behavior. Read the code under test too: a test of a one-line pass-through, or a bound the code can never
   reach, protects nothing however it is tagged, and a loose bound can hide a real bug.
   On a large suite do not open every file. A file with no findings, no flags, a tier, and either no lane tag or a lane
   that fits its tier gets `keep` without being opened; count these files and report the count, not rows. A flagged file
   is never kept unread: the flags are the evidence for question 4 of the rubric.
5. **Architecture advisory.** Read `<plugin-root>/references/architecture-cost.md`. Trace expensive tests to dependency
   fanout, repeated setup, pipeline diversity and verification ownership. Inspect actual producers, complete manifest
   inputs and final output identities before advising consolidation or affected-only reuse. Report concrete alternatives
   with Time, Risk, Complexity, Best practice and Maintainability; label estimates and name replacement coverage.
   Missing risk tiers prevent file verdicts, but do not prevent this structural advice. Do not change product architecture.
6. **Judge** each remaining file with the rubric, then write the verdict table.

Treat `wiring.opaque-test-registration` as an inventory gap before assigning a file verdict. Its `+?` report count
means a literal-title curried callback may register tests through an unknown helper; inspect that helper and the native
runner's inventory. The numeric JSON count remains recognized static declarations, not expanded native cases.
Do not infer that a file has no tests from zero recognized declarations, or that no warning proves discovery complete.

## Rubric

Ask in this order. Stop at the first question that settles it.

1. **What failure does this test catch, and who is hurt?** Use the file's risk tier. A file with no tier gets no
   verdict: report it as a risk-map gap and do not guess.
2. **Is the code kept for an old format or API, and does a consumer exist?** Read the code under test first. A runtime
   fallback for missing input is current behavior, not a shim: judge it with questions 3 to 6. A shim, compat, legacy or
   migration test protects a declared preservation obligation. Before you accept `consumers: []` as "nobody", look for the kinds of consumer the
   doctrine counts: other repositories, plugin or package installs from this repo, stored data in the old format and
   a published API. Confirm obligations rather than assuming every stored test record needs preservation. With no
   obligation, judge whether the old path has any current behavior worth protecting; surface intentional history loss.
3. **Does something cheaper already catch it?** Compare the files in a cluster and the duplicate titles and repeated
   sweeps. Name the test that is the single owner of the behavior.
4. **Is the test sound?** `tautological`, `snapshot-only`, `mock-only` and `no-direct-assertions` flags mean the test
   may assert nothing real. Confirm by reading it against the rules in `<plugin-root>/references/craft.md`: concrete
   assertions that could fail, real collaborators or fakes before mocks, one behavior per test.
5. **Is it safe beside another worktree?** Fixed ports, fixed temp or database paths, absolute paths, reads of `.git`
   and writes under the home directory break parallel runs. Fix the hazard with a `rewrite`; do not delete or
   quarantine the test for it.
6. **Does it run at the right frequency?** Compare its tier to its lane tag. Critical tests belong in the edit or merge
   lane, low-tier tests in scheduled or release. A full suite in a hook or on every push is a frequency problem for the
   project, not for one file.

## Verdicts

| Verdict | Use when |
|---|---|
| keep | Protects a declared risk, nothing cheaper covers it, runs in the right lane. |
| demote | Valid but runs too often for its value. Change the file's `@lane` tag and the project's scripts or include globs so the lane's command skips it; until lane tooling exists, the tag only records the decision. |
| merge | Two tests assert the same behavior and one should remain: keep one owner. |
| rewrite | The behavior is worth protecting but the test is brittle, hollow or worktree-hostile: mock-only, snapshot-only, tautological, a fixed port or path, or high churn with no code change. |
| quarantine | Flaky, and only when the owner or CI history reports it (this version cannot observe flakiness). Name an owner and a time limit, and isolate it from the gating lanes until fixed. |
| delete | Nothing worth protecting is behind the test: the code it covers is gone or has no consumer (a dead shim: also recommend removing the shim code with its test), or it asserts nothing and there is no behavior to rewrite it around. |

Never recommend deleting a critical-tier test without naming its replacement.

## Output

1. A table: `File | Tier | Verdict | Why (finding rule and evidence) | Agent tokens | Churn`.
   List only files that are not trivially kept, and add one line with the count of files kept unopened.
   Order it by review priority: expensive and low value first. Show the cost columns separately. The default `weights`
   are all 1; combine them into one score only if the owner edited the weights.
2. Files with no tier, listed without a verdict, as risk-map gaps.
3. Project-level actions from the `frequency.*` and `wiring.*` findings: hooks, watch mode, CI triggers, OS matrices,
   missing risk-map areas, critical areas with no tests.
4. CI advice for the phase: `dev` wants one non-blocking Linux job per pull request, with the OS matrix on demand,
   weekly and on release tags; `test` runs the OS matrix nightly, with release-tag runs gating the release; `production`
   makes path-filtered pull-request checks required. Flag any `push` trigger on branches and any Windows or macOS run
   on the pull-request path.
5. Totals: estimated tokens in files marked `delete` or `merge`, and how many files with a Lane of `edit` you demote
   out of the edit lane.
6. What this audit could not measure. Static scan/report do not measure wait time; an optional explicitly requested Node
   profile can measure one run (see references/node-profiling.md). CI minutes and statistical flakiness remain unmeasured.
7. Architecture advisory with evidence, alternatives and replacement protection, separate from per-file verdicts.

For an audit-only request, stop after this output and let the owner decide what to apply. For already-authorized
implementation, use the findings to complete that scope, verify the full replacement checks and report the result.
