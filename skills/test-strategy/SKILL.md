---
name: test-strategy
description: Structure a project's tests by phase (dev, test, production) and run frequency (edit, merge, scheduled, release lanes) using a risk map, and keep agent-written tests from bloating the suite.
when_to_use: Use when starting a project or feature area, or deciding how a project's tests and CI should be structured (what to test, how often each test runs, whether CI is needed and where, and what testing rules to give coding agents), or when writing or reviewing a test for a function, class or feature. For an existing suite that already feels bloated, use test-audit first.
---
# test-strategy

Efficiency means protection per unit of cost. The same test costs many times more on every edit than nightly, so
putting each test in the right lane usually saves more than deleting it, provided each lane still runs often enough
to keep the set of suspect changes small.

`<plugin-root>` is the directory that holds scripts/run-managed.js, the parent of the skills directory (two levels
up from this skill's directory). In Codex, resolve it from the SKILL.md file you loaded, not from the current directory.
Quote the project path (`"<project>"`) so a Windows path with spaces survives.

## 1. Know the phase

| Phase | Goal | Tests that matter | Automatic CI | Compat tests |
|---|---|---|---|---|
| dev (pre-release) | Iteration speed | Core invariants, a few user journeys | One non-blocking Linux job per pull request. OS matrix on demand, weekly and on release tags. | None unless `consumers` names one |
| test (stabilizing) | Release confidence | Journeys, public-surface contracts, critical-tier depth | The same, with the OS matrix nightly and release-tag runs gating the release | Only for declared consumers |
| production | Do not break people | Regression and compat for declared consumers, post-deploy smoke | Required, path-filtered pull-request checks | Yes, for declared consumers |

Ask the owner which phase the project is in. Moving to the next phase is an explicit step: fill in `consumers`,
change `phase`.

Deployment for evaluation does not establish production maturity. Record the owner's phase and compatibility
obligations: current integrity can be critical while disposable test history has no old-format preservation promise.
Surface intentional history loss; do not infer migration shims merely because stored records or paired devices exist.

## 2. Write the risk map

`node "<plugin-root>/scripts/run-managed.js" risk-draft --root "<project>"` prints a draft of `.testing/risk.yml` from
directory names and writes nothing. Show it to the owner and ask for the phase, the `consumers` and which areas are
critical, standard or low. Never write the file before they have confirmed all three. Then run the same command with
`--write` to create the file, edit `.testing/risk.yml` to apply their answers (phase, consumers, tiers), rerun
`report --root "<project>"` to validate it (an `E_RISKMAP` error names the bad field) and commit it. Tiers: `critical`
(data loss, auth, money, public contracts), `standard`, `low` (presentation, examples). First matching area wins, so
list specific areas first. If the CLI is missing, load the tests-setup skill.

## 3. Assign lanes by frequency

| Lane | Runs | When |
|---|---|---|
| edit | Tests affected by the files just changed | After each agent edit, seconds |
| merge | The fast suite for critical and standard tiers | Locally, before pushing or merging |
| scheduled | Everything, on an OS matrix | Weekly cron in dev, nightly from the test phase on |
| release | Everything plus a clean install and packaging check | On a release tag |

Tier decides the lane: critical tests run in edit or merge, standard in edit, merge or scheduled, low in scheduled or
release. A test file declares its lane in a leading docblock: `/** @lane merge */`.

Typecheck and lint are the cheapest checks: they take seconds, need no test to maintain and catch many agent mistakes
(the trophy in doctrine.md puts static checks at its base). Run them in the edit and merge lanes beside the tests.

Starting scripts until the lane tooling exists:

Measure the entire candidate command, including dependency-graph collection and filesystem/subprocess checks,
before choosing it as a faster lane. A cold `related` run can cost more than a direct file or full-project run.
Preserve known non-imported inputs with explicit guards or conservative fallback; `related`/`--changed` is not
complete selection evidence by itself. Keep full merge/release checks until their replacement is established.

- vitest: edit `vitest related --run <changed files>`, merge/full `vitest run`.
  `vitest run --changed origin/main` is optional edit feedback across a branch, not a complete merge gate.
- jest: edit `jest --findRelatedTests <changed files>`, merge/full `jest`.
  `--changedSince=origin/main` and `--onlyChanged` are optional edit feedback, not complete merge gates.

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
  such as `ci:full`, a weekly schedule (nightly from the test phase on) and release tags. They bill at a higher
  per-minute rate than Linux on private repositories.
- **Evidence for the merge lane (optional, if you build one).** Have the merge script write `{sha, lane, result}` and
  refuse to merge without evidence for the current commit.
- **Drop the pull-request job** only if the local merge gate is written by a verified tool over a clean tree, not by
  the agent reporting on itself, and the minutes are metered.
- **By phase.** `dev` is the setup above. `test` runs the OS matrix nightly, with release-tag runs gating the release.
  `production` makes the path-filtered pull-request checks required, because someone else now depends on main.

CI runs whatever suite was pushed, so it does not catch an agent weakening tests. The audit does.

## 5. Rules for writing tests

Agents write most tests, so prevent bloat at the source. Add this block to the project's `AGENTS.md` or `CLAUDE.md`
(project file only; never overwrite global instructions). If it already exists, update it in place.

    ## Testing rules (agent-tests)

    - `.testing/risk.yml` says which areas are critical, standard or low. Read it before adding or changing tests.
    - One owner per invariant. Before adding a test, search for an existing test of the same behavior and extend it.
    - Test behavior at seams (public functions, inputs, persistence, transfers), not implementation details. Do not
      assert on mocks alone, snapshot everything, or assert a value against itself.
    - Add old-format compatibility tests only for declared obligations. Current missing/invalid-input handling is
      ordinary behavior and can need coverage even with no legacy consumers. The risk map decides.
    - Tests must not depend on the checkout: no fixed ports (use port 0), no fixed temp paths (use mkdtemp), no
      absolute paths, no reading `.git` directly, no writes under the home directory.
    - Declare the lane in the file's first comment, before any import: `/** @lane merge */` (edit, merge, scheduled or
      release). Tags are read only from that leading comment. If the test reaches code only through a subprocess or the
      network, add `@subject <path>` for that code, as a path from the project root (`src/cli.ts`, not an import-style
      `../src/cli.ts`, which is dropped). A test with no code subject gets `@risk <critical|standard|low>`.
    - For a bug fix, write the failing test first and watch it fail for the reported reason. For any new test, check that
      it fails when the behavior it covers is broken.
    - While editing, run only the tests for the files you changed. Run the project's merge script before pushing. Do
      not run the full suite after every change.

## 6. Writing a test at each level

The block above is the short form. When writing or reviewing a test, read the level you are working at in
`<plugin-root>/references/craft.md`: a function or class (what to assert, test doubles, test data), a feature
(integration, contract and end-to-end tests, time, isolation, third-party APIs) or the suite and process (ownership,
determinism, coverage, legacy code, agent-written tests).

## 7. Audit what exists

For an existing suite, load the test-audit skill instead of restructuring by hand.
When structure itself makes testing costly, use `<plugin-root>/references/architecture-cost.md` to advise on boundaries,
shared setup and generated-asset verification ownership before proposing more tests. Keep this advisory until changes
are authorized; require complete input and output identities before trusting changed-only asset reuse.

Evidence for the structure rules (phases, lanes, CI) and where they are opinion is in
`<plugin-root>/references/doctrine.md`; evidence for the writing rules is in craft.md.
