---
name: test-audit
description: Audit a project's test suite for necessity and efficiency - redundant coverage, compat and fallback shim tests, worktree-hostile tests, tests not tied to a risk tier or lane, and tests that run too often - and return a verdict per test file.
when_to_use: Use when an existing test suite or its CI feels too big, slow or redundant ("tests take forever", "too many tests", "is this overkill", "do we need all of these"), before pruning, merging or demoting tests, or when asked to audit how a project's tests are structured.
---
# test-audit

The goal is efficiency: protection per unit of cost. A slow test that guards data loss is worth keeping;
a fast test that repeats three others is waste. Speed alone never decides a verdict.

The CLI gathers evidence and never judges. You judge, using the rubric below. Do not edit tests in this skill.

## Steps

1. **Runtime.** `node "<plugin-root>/scripts/setup.js" --check --json`. If `ok` is false, load the tests-setup skill.
2. **Risk map.** Look for `.testing/risk.yml` in the project.
   - Missing: run `node "<plugin-root>/scripts/run-managed.js" risk-draft --root <project>` and show the owner the draft.
     Ask two things: the project phase (`dev` pre-release, `test` stabilizing, `production` released) and who consumes
     this code (`consumers`; an empty list means nobody). Apply their answers, then write it with `--write`.
     Never write the map before the owner has confirmed tiers, phase and consumers.
   - Present: read it. Treat `phase`, `consumers` and `areas` as the owner's decisions.
3. **Evidence.** `node "<plugin-root>/scripts/run-managed.js" report --root <project>` prints a ranked Markdown view
   (add `--max-files <n>` for a longer table); `scan` prints the full JSON.
   - Project findings (CI, hooks, scripts, agent instructions, risk-map gaps) come first, then a table of test files.
   - The table ranks unparsed files first (the tool could not read their structure, so read those directly), then files
     with the most distinct finding rules. The Rules column shows which rules fired. Several `redundancy.shared-subject`
     findings are weak evidence; one `worktree.*` or `shim.*` rule on a real hazard is strong.
   - This version never runs the tests, so wait time and CI minutes are absent. Agent cost is estimated tokens in the
     file. Churn/edits is edits that touched the test without the code it covers, over all edits that modified it;
     `n/a` means no git history (a shallow clone has none) or no resolvable subject.
4. **Read before judging.** Findings are evidence, not verdicts. Open the test files behind the highest-ranked findings
   and the files in each cluster. Pattern matches produce false positives: a test titled "falls back to the default" may
   guard real behavior. Read the code under test too: a test of a one-line pass-through, or a bound the code can never
   reach, protects nothing however it is tagged, and a loose bound can hide a real bug.
5. **Judge** each file with the rubric, then write the verdict table.

## Rubric

Ask in this order. Stop at the first question that settles it.

1. **What failure does this test catch, and who is hurt?** Use the file's risk tier. No tier means the risk map has a gap:
   say so, do not guess.
2. **Does a consumer exist?** Shim, compat, legacy and fallback tests protect a consumer. With `consumers: []` nobody
   depends on the old path, so the test guards nothing.
3. **Does something cheaper already catch it?** Compare the files in a cluster and the duplicate titles and repeated
   sweeps. Name the test that is the single owner of the behavior.
4. **Is the test sound?** `tautological`, `snapshot-only`, `mock-only` and `no-direct-assertions` flags mean the test
   may assert nothing real. Confirm by reading it.
5. **Is it safe beside another worktree?** Fixed ports, fixed temp or database paths, absolute paths, reads of `.git`
   and writes under the home directory break parallel runs. Fix the hazard; do not delete the test for it.
6. **Does it run at the right frequency?** Compare its tier to its lane tag. Critical tests belong in the edit or merge
   lane, low-tier tests in scheduled or release. A full suite in a hook or on every push is a frequency problem for the
   project, not for one file.

## Verdicts

| Verdict | Use when |
|---|---|
| keep | Protects a declared risk, nothing cheaper covers it, runs in the right lane. |
| demote | Valid but runs too often for its value: move it to a less frequent lane. The most common verdict. |
| merge | Two tests assert the same behavior over the same subject: keep one owner. |
| rewrite | Brittle or hollow: mock-only, snapshot-only, tautological, or high churn with no code change. |
| quarantine | Flaky or worktree-hostile: isolate until the hazard is fixed. |
| delete | Guards a consumer that does not exist, or duplicates another test exactly. |

Never recommend deleting a critical-tier test without naming its replacement.

## Output

1. A table: `File | Tier | Verdict | Why (finding rule and evidence) | Agent tokens | Churn`.
   Order it by review priority: expensive and low value first. Show the cost columns separately; do not collapse them
   into one score unless the risk map's `weights` ask you to.
2. Project-level actions from the `frequency.*` and `wiring.*` findings: hooks, watch mode, CI triggers, OS matrices,
   missing risk-map areas, critical areas with no tests.
3. CI advice for the phase: `dev` wants one non-blocking Linux job per pull request and the OS matrix on demand only,
   `test` adds a scheduled OS matrix and release-tag runs, `production` makes path-filtered pull-request checks
   required. Flag any `push` trigger on branches and any Windows or macOS run on the pull-request path.
4. What this audit could not measure: wait time, CI minutes and flakiness need a timed run.

Stop after the table and let the owner decide what to apply.
