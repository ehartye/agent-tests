---
name: test-strategy
description: Structure a project's tests by phase (dev, test, production) and run frequency (edit, merge, scheduled, release lanes) using a risk map, and keep agent-written tests from bloating the suite.
when_to_use: Use when starting a project or feature area, or deciding how a project's tests and CI should be structured (what to test, how often each test runs, whether CI is needed and where, and what testing rules to give coding agents). For an existing suite that already feels bloated, use test-audit first.
---
# test-strategy

Efficiency means protection per unit of cost. The same test costs many times more on every edit than nightly, so
putting each test in the right lane usually saves more than deleting it, provided each lane still runs often enough
to keep the set of suspect changes small.

## 1. Know the phase

| Phase | Goal | Tests that matter | Automatic CI | Compat tests |
|---|---|---|---|---|
| dev (pre-release) | Iteration speed | Core invariants, a few user journeys | One non-blocking Linux job per pull request. OS matrix on demand only. | None: no consumers |
| test (stabilizing) | Release confidence | Journeys, public-surface contracts, critical-tier depth | The same, plus a scheduled OS matrix and release-tag runs | Only for declared consumers |
| production | Do not break people | Regression and compat for declared consumers, post-deploy smoke | Required, path-filtered pull-request checks | Yes, for declared consumers |

Ask the owner which phase the project is in. Moving to the next phase is an explicit step: fill in `consumers`,
change `phase`.

## 2. Write the risk map

`node "<plugin-root>/scripts/run-managed.js" risk-draft --root <project>` drafts `.testing/risk.yml` from directory
names. Show it to the owner, apply their corrections, then `--write` and commit it. Tiers: `critical` (data loss,
auth, money, public contracts), `standard`, `low` (presentation, examples). First matching area wins, so list
specific areas first. If the CLI is missing, load the tests-setup skill.

## 3. Assign lanes by frequency

| Lane | Runs | When |
|---|---|---|
| edit | Tests affected by the files just changed | After each agent edit, seconds |
| merge | The fast suite for critical and standard tiers | Locally, before pushing or merging |
| scheduled | Everything, on an OS matrix | Nightly or weekly cron |
| release | Everything plus a clean install and packaging check | On a release tag |

Tier decides the lane: critical tests run in edit or merge, standard in edit, merge or scheduled, low in scheduled or
release. A test file declares its lane in a leading docblock: `/** @lane merge */`.

Starting scripts until the lane tooling exists:

- vitest: edit `vitest related --run <changed files>`, merge `vitest run --changed origin/main`, full `vitest run`.
  `--changed` needs an `origin/main` ref; with no remote yet, `vitest run --changed` covers uncommitted changes.
- jest: edit `jest --findRelatedTests <changed files>`, merge `jest --onlyChanged`, full `jest`.

Make the `test` script a single run: `vitest run`, or `jest` without `--watch`. Bare `vitest` can start watch mode in an
interactive terminal, which blocks an agent that runs it there.

## 4. CI by phase, for a solo developer who works in pull requests

The local merge lane is the gate. CI adds an observer outside the agent, because an agent's "tests pass" is otherwise
its own report. Keep that observer cheap and non-blocking.

- **One Linux job on `pull_request`.** Path-filter it to code, config and lockfile, skip draft pull requests, set
  `concurrency` with `cancel-in-progress` so a newer push replaces the older run, and do not make it a required check.
  Nothing waits on it and a flaky red cannot block a merge. Read it at merge time: a red result means look, not block.
- **No `push` trigger on branches.** A pushed pull-request branch would fire both triggers. Skip a post-merge run too:
  the pull-request job already ran on the same tree.
- **OS matrix off the pull-request path.** Run Windows and macOS with `workflow_dispatch` (take an `os` input), a label
  such as `ci:full`, a weekly schedule and release tags. They bill at a higher per-minute rate than Linux on private
  repositories.
- **Evidence for the merge lane.** Have it write `{sha, lane, result}` and refuse to merge without evidence for the
  current commit.
- **Make checks required** only when someone else depends on main.

CI runs whatever suite was pushed, so it does not catch an agent weakening tests. The audit does.

## 5. Rules for writing tests

Agents write most tests, so prevent bloat at the source. Add this block to the project's `AGENTS.md` or `CLAUDE.md`
(project file only; never overwrite global instructions). If it already exists, update it in place.

    ## Testing rules (agent-tests)

    - `.testing/risk.yml` says which areas are critical, standard or low. Read it before adding or changing tests.
    - One owner per invariant. Before adding a test, search for an existing test of the same behavior and extend it.
    - Test behavior at seams (public functions, inputs, persistence, transfers), not implementation details. Do not
      assert on mocks alone, snapshot everything, or assert a value against itself.
    - Pre-release means no consumers: no backward-compatibility, legacy-format or fallback tests unless `consumers`
      in the risk map names who needs them.
    - Tests must not depend on the checkout: no fixed ports (use port 0), no fixed temp paths (use mkdtemp), no
      absolute paths, no reading `.git` directly, no writes under the home directory.
    - Declare the lane at the top of each test file: `/** @lane merge */` (edit, merge, scheduled or release). If the
      test reaches code only through a subprocess or the network, add `@subject <path>` for that code.
    - While editing, run only the tests for the files you changed. Run the merge lane before pushing. Do not run
      the full suite after every change.

## 6. Audit what exists

For an existing suite, load the test-audit skill instead of restructuring by hand.

Evidence for these rules, and where they are opinion, is in `references/doctrine.md`.
