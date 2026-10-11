# agent-tests — design

Date: 2026-10-11. Status: design approved section by section; awaiting spec review.

## Problem

Agent-built projects accumulate large test suites. Local runs and GitHub CI slow down, and every change waits on them. Most of this owner's projects are pre-release and internal, so heavy rigor is wasted, but some risk-based gating is still needed to catch real defects.

`agent-tests` is a plugin (Claude Code and Codex; Windows and macOS) that teaches an agent how to structure tests efficiently from the start and audits and remediates existing suites.

## Goals and non-goals

Goals:
- **Efficiency**: protection delivered per unit cost. Duration is one input; necessity decides.
- Structure tests by project phase (dev, test, production) and frequency lane, driven by an explicit risk map.
- Audit an existing suite for five problems: redundant coverage, backward-compat and fallback shim tests, worktree-hostile tests, tests not wired for risk-based testing, tests run too often.
- Remediate by demotion, merge, rewrite, quarantine or deletion, with before/after evidence.
- Answer "do we need CI?" per phase. Solo pre-release default: no automatic on-push CI.

Non-goals (v1): Python/pytest (follows v0.4), runners beyond vitest and jest, auto-applying deletions without owner approval, enterprise test-management features.

## Efficiency model

- **Value** of a test: the risk it protects (risk-map tier), its unique contribution (marginal over other tests), and whether the consumer it protects exists.
- **Cost** of a test, multiplied by how often its lane runs, reported as four separate columns:
  - Wait: measured time x lane frequency.
  - Agent attention: failing-output size, file size, tokens to read and fix.
  - CI minutes: weighted by runner OS.
  - Churn: edits to the test without a change to the code it covers (from git history).
- Default weights are equal; the owner can reweight in the risk map.
- Most efficiency comes from **placement**, not deletion: the same test costs about 100x more on every edit than nightly.

Verdicts: **keep, demote, merge, rewrite, quarantine, delete.**

## Phases and lanes

`phase` is a field in the risk map.

| Phase | Goal | Tests that matter | Automatic CI | Compat tests |
|---|---|---|---|---|
| dev (pre-release) | Iteration speed | Core invariants, a few journeys | None; on-demand only | None (no consumers) |
| test (stabilizing) | Release confidence | Journeys, public-surface contracts, critical-tier depth | Scheduled, Windows+macOS matrix; release tags | Only for declared consumers |
| production | Don't break people | Regression and compat for declared consumers, post-deploy smoke | PR-level with path filters | Yes, for declared consumers |

Lanes are defined by frequency: **edit** (tests affected by changed files, seconds), **merge** (fast lane for critical and standard tiers, run locally, writes an evidence stamp `{sha, lane, result}`), **scheduled** (full suite, OS matrix), **release** (everything, clean-environment install, packaging check). Moving between phases is an explicit step: populate `consumers`, change `phase`.

CI guidance for solo pre-release work: no on-push workflow; `workflow_dispatch` or a label for on-demand runs; a cron for scheduled; tag triggers for release; local evidence stamp as the merge gate. The industry basis and runner pricing are verified in M0 and cited in `references/`; unsourced claims are labeled opinion.

## Architecture

```
agent-tests/
  .claude-plugin/plugin.json
  .codex/INSTALL.md
  skills/ tests-setup, test-strategy, test-audit, test-remediate, test-lanes
  scripts/ setup.js, managed-runtime.js, run-managed.js   (adapted from agent-prose)
  src/     the `tests` CLI
  references/ cited doctrine
  tests/ evals/ docs/
```

- Managed runtime, as in agent-prose: the plugin cache holds source only; `setup.js` copies a versioned runtime to `~/.agent-tests/releases/<version>-<fingerprint>` (override `AGENT_TESTS_HOME`), runs `npm ci`, writes a receipt. Skills call `node "<plugin-root>/scripts/run-managed.js" <cmd>`, never a bare `tests` on PATH. Node 24+. No Chromium.
- Nothing to compile. TS/JS parsing uses TypeScript 7's JS API (`typescript/unstable/sync` with an in-memory filesystem), which drives the prebuilt per-platform native binary; the package is pinned exactly because its subpaths are named `unstable`. `web-tree-sitter` (WASM) handles Python (v0.4+).
- CLI subcommands: `risk-draft`, `scan`, `time`, `report`. The CLI gathers evidence and never judges.
- The **evidence-record JSON schema** is defined in M1 and is the contract between CLI and skills.

### Risk map: `.testing/risk.yml` (committed; shared across worktrees)

```yaml
phase: dev
consumers: []        # empty pre-release: compat and fallback tests guard nobody
weights: {wait: 1, agent: 1, ci: 1, churn: 1}
lanes:
  edit:      {runs: affected-files, trigger: agent-edit}
  merge:     {runs: critical+standard, trigger: local-pre-push}
  scheduled: {runs: all, trigger: cron, os: [ubuntu, windows, macos]}
  release:   {runs: all+clean-install, trigger: tag, os: [ubuntu, windows, macos]}
areas:
  - {path: "src/persistence/**", tier: critical, why: data loss}
  - {path: "src/ui/**", tier: low}
```

`risk-draft` proposes it from path and keyword signals; the owner confirms once. Later scans flag drift (directories with no tier). A test declares its lane and risk in a file-level docblock (`@lane merge`, `@risk persistence`); the path-based area map is the fallback when absent.

### Evidence per test file

Subject (imports exercised) and risk tier; assertion shape (counts; tautological, snapshot-only, mock-only, assertion-free flags); the four cost columns; stability (flakes, parallel failures, second-worktree failures).

Detectors for the five problems:
1. Redundancy: files sharing subjects, duplicated seed sweeps and fixtures, one behavior asserted at unit, integration and e2e layers.
2. Shims: `legacy`/`compat`/`deprecated`/`fallback` in names, comments and branches, cross-checked against `consumers`.
3. Worktree hazards: fixed ports, hard-coded absolute paths, shared temp or database paths, `process.cwd()` assumptions, global singletons, git-state assumptions; confirmed by a second-worktree run.
4. Risk wiring: tests with no lane, lane/tier mismatches, critical areas with no tests.
5. Frequency: full suite in pre-commit, watch mode, `on: push` without path filters, agent instructions saying "run all tests".

`time` runs the suite once with the runner's JSON reporter, in a disposable `git worktree` by default (which doubles as the worktree check). It requires owner confirmation because it executes the tests.

## Skills

- **tests-setup**: install, check, repair the managed runtime.
- **test-strategy**: new projects and feature areas. Runs `risk-draft`; adds an agent-instruction block to `AGENTS.md`/`CLAUDE.md` (one test owner per invariant; test behavior at seams, not implementation; no compat tests pre-release; deterministic seeds, unique temp dirs, port 0; every test declares lane and risk). Prevention at the source is the cheapest remediation, since agents write most tests.
- **test-audit**: checks setup, drafts the risk map if missing, runs `scan` then `time`, applies the rubric, outputs a verdict table.
- **test-remediate**: works on a branch or worktree; applies verdicts in order of increasing risk (demote, merge, rewrite, quarantine, delete), one commit per verdict class, re-runs affected lanes, reports before/after cost columns. Never deletes a critical-tier test without a replacement; deletions need owner approval.
- **test-lanes**: wires lanes into `package.json` scripts and vitest/jest projects, the local evidence stamp, git hooks (pre-push), and CI templates (`workflow_dispatch`, label, cron, tag). Default for solo pre-release: no on-push workflow.

## Codex and cross-platform

- Skills are plain `SKILL.md` (same frontmatter in both hosts), discovered in Codex through the `~/.agents/skills` link (junction on Windows), documented in `.codex/INSTALL.md`, with a short `codex.md` entry-guidance file as in superpowers. Skills say "load skill X", never "invoke the Skill tool"; `CLAUDE.md` mentions also mean `AGENTS.md`.
- No core dependency on host hooks, commands or agent definitions. Gating uses plain git hooks. Claude-only extras are optional and labeled.
- The launcher resolves its plugin root through the link; a Windows junction test covers this.
- Skills emit only `node ...` commands (shell-agnostic).
- Runners are spawned via their JS entry with `node`, because Node 24 refuses to spawn `.cmd` shims without a shell.
- Timeouts kill the process tree (`taskkill /T /F` on Windows, process group on POSIX).
- Paths use `node:path`; comparisons are case-insensitive; CRLF is normalized when parsing; temp paths stay short for Windows.
- Second-worktree check: `git worktree add` to a unique temp path, run, remove; refuses on a dirty or detached state it cannot reproduce. Dependencies for the worktree: `node_modules` junction (Windows) or symlink (POSIX), falling back to a fresh install.
- Runner detection v1: vitest and jest. Any other runner yields a static scan only plus an "unsupported runner" notice.

## Verification of the plugin

- Seeded fixture repo plants every smell with known ground truth; a clean fixture must report nothing. Detector tests assert both.
- Skill evals: an agent audits the bloated fixture; verdicts are scored against the planted truth (pattern follows agent-prose `evals/`).
- Dogfooding: its own CI follows the doctrine. No on-push runs; on-demand PR checks; scheduled and release lanes run an Ubuntu, Windows and macOS matrix. macOS is verified only in CI.

## Milestones

| # | Milestone | Outcome |
|---|---|---|
| M0 | Research: wiki-discover and ingest on pyramid, trophy and honeycomb; Google test sizes and flakiness; test impact analysis and predictive test selection; DORA and trunk-based development; mutation testing; failure modes of agent-written tests; GitHub Actions billing; risk-based testing; deprecation and compat policy. Perspective-research resolves conflicts. | Cited `references/`; wiki architecture page |
| M1 | Skeleton: repo, manifest, managed runtime, `tests-setup`, fixtures, evidence schema, dogfood CI | Installable empty plugin |
| M2 | `risk-draft`, `scan` (TS/JS), `report`, `test-audit`, `test-strategy` | v0.1 static audit |
| M3 | `time`, vitest and jest adapters, flake and parallel detection, second-worktree check, cost columns | v0.2 measured audit |
| M4 | `test-remediate`, `test-lanes`, CI templates, evals | v0.3 |
| M5 | Codex install doc, junction test, macOS and Windows release-lane runs | v0.4 verified on both hosts |
| M6 | Tag, publish to GitHub, marketplace entry and README row in `hartye-claude-plugins` | Installable from marketplace |

Publishing the repo and the marketplace PR are outward-facing; each needs the owner's go-ahead when reached.

## Revisions

- 2026-10-11, during planning: All dependencies are the registry's latest, including `typescript@7.0.2`. An earlier revision pinned 6.0.3 on the mistaken belief that TypeScript 7 has no JS API; the owner rejected pinning old versions for convenience, and the API turned out to exist under `typescript/unstable/*` (verified: 60 files parsed in about 50 ms after a half-second native start). The managed runtime drops agent-prose's `npm link` and browser steps because skills always use the launcher. The CLI's `scan` prints evidence JSON and `report` prints Markdown. Dogfooding the scan on this repository added noise controls: type-only imports are not subjects, a test counts for a subject only when it imports three or fewer modules or is named after it, shared-subject findings collapse to one per file, `fixtures` directories are not scanned, a tag-only push trigger is a release run, and `risk-draft` adds a catch-all area for code directly under `src`.
- Planning split: the first plan covers M0-M2 (v0.1). M3-M6 get their own plans once the evidence schema has been exercised.

## Risks

- Scan noise: the scan reports evidence only and the agent judges; fixtures measure precision.
- `time` executes the owner's tests: confirmation required, disposable worktree by default.
- Doctrine drift from evidence: every `references/` claim cites a source or is labeled opinion.
- Two hosts: the shared-markdown layer keeps Codex-specific code minimal.
