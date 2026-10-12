# agent-tests

Test-efficiency toolkit for coding agents, for Claude Code and Codex on Windows and macOS.

Agent-built projects accumulate huge test suites, and local runs and CI slow every change. agent-tests helps an
agent structure tests by project phase and risk from the start, and audits an existing suite for what is
unnecessary. The measure is efficiency: protection per unit of cost, not test count and not speed alone.

## Install

Once published to the hartye-plugins marketplace:

    /plugin marketplace add ehartye/hartye-claude-plugins
    /plugin install agent-tests@hartye-plugins

Then run the `tests-setup` skill. It copies a managed runtime outside the plugin cache and installs its
dependencies. Node.js 24 or newer is required. Codex installation is documented once the Codex packaging lands.

## Skills

| Skill | Use it to |
|---|---|
| `tests-setup` | Install, check and repair the managed runtime |
| `test-strategy` | Structure tests by phase and lane for a new project, and write testing rules for agents |
| `test-audit` | Audit an existing suite and get a verdict per test file |

## What the audit looks for

1. Redundant coverage: test files sharing a subject, repeated seed sweeps, duplicate titles.
2. Compat, legacy and fallback tests, judged against who actually consumes the code.
3. Tests that break beside a second worktree: fixed ports, fixed temp or database paths, absolute paths, reads of `.git`.
4. Tests not tied to a risk tier or lane, and critical areas nobody tests.
5. Tests that run too often: full suites in hooks, watch-mode test scripts, CI on every push, Windows and macOS matrices on the push path.

The CLI gathers evidence and never judges. The skill's rubric turns evidence into verdicts: keep, demote, merge, rewrite,
quarantine or delete.
The audit also advises on architectural causes of testing cost: shared dependency fanout, repeated setup, multiple
asset pipelines and duplicated verification ownership. It compares changes to boundaries or artifact contracts with
their time, risk, complexity and maintenance implications before recommending a redesign.

## References

Every rule the skills teach is cited to a public source or labeled as opinion, so nothing depends on a private note or
on this machine.

| File | Covers |
|---|---|
| `references/doctrine.md` | How much to test and how often: efficiency, run frequency, test size, flaky tests, affected-only runs, compat tests, CI for a solo developer, risk tiers, mutation testing |
| `references/craft.md` | How to write a good test at each level: a function or class (assertions, test doubles, test data, property-based tests), a feature (integration, contract and end-to-end tests, time, isolation, third-party APIs) and the suite (ownership, determinism, coverage, legacy code, agent-written tests) |
| `references/architecture-cost.md` | Advisory investigation of architecture that makes tests costly, including complete generated-asset inputs and final verification ownership |
| `references/node-profiling.md` | Optional Node 24+ reporter, per-file and overall duration, provenance limits and repeatable lane experiments |
| `references/candidate-evidence.md` | Explicit checked observation of Node-test/Vitest children, content/path/index identities, native counts and honest reuse limits |

## Risk map

`.testing/risk.yml` is committed to the project. It records the phase (`dev`, `test`, `production`), who consumes the code
(`consumers`), the lanes, cost weights, and which areas are `critical`, `standard` or `low`. `risk-draft` proposes it; the
owner confirms it once.

## CLI

Skills run the CLI through the checked launcher, never from PATH:

    node "<plugin-root>/scripts/run-managed.js" <command> [--root <dir>]

| Command | Output |
|---|---|
| `capabilities` | Name, version, commands |
| `risk-draft [--write]` | A draft risk map; `--write` creates `.testing/risk.yml` if absent |
| `scan` | Evidence report as JSON (`agent-tests/evidence@1`) |
| `report [--max-files n] [--max-per-rule n]` | The same evidence as ranked, capped Markdown: project findings first, then a table of the most suspect test files with the rules that fired |

Every failure is one JSON line on stderr (`{"error":{"code","message","hint"}}`) with exit code 2 for a usage error and 1
otherwise. A broken runtime is reported the same way (`E_RUNTIME_BROKEN`), so an agent never has to read a stack trace.

The checked launcher also accepts `candidate-evidence observe node-test|vitest` and `candidate-evidence check` as an
explicit standalone helper. Observation runs project tests; scan/report stay static. See the [portable usage and
input-scope limits](references/candidate-evidence.md) before recording or checking a receipt.

## Status

Version 0.3 includes static audits for TypeScript and JavaScript projects using vitest, jest or Node's test runner,
an optional Node reporter, and explicitly invoked observational candidate evidence for Node-test/Vitest. Scan and
report never run tests. Candidate observation does not select lanes, suppress checks or authorize integration.
CI charges and statistical flakiness are not measured; remediation and wider runner/language support remain separate work.

## Known limitations

- Pattern detectors also match strings inside tests that are about those patterns, including this repository's own tests.
  Findings are evidence for the agent to read, not verdicts.
- Discovery skips `.local`, `.playwright-mcp`, `test-results` and `playwright-report` so archived checkouts and generated reports do not
  inflate the current suite. Test support modules and root Playwright/Jest/Vitest configs are checked for worktree
  hazards without being counted as tests. Runner detection reports the primary unit runner, not every browser tool.
- Subjects are found through relative imports, `require()` and dynamic `import()` of project files, plus `@subject`
  tags and exact/single-wildcard `paths` in a direct JSON `tsconfig.json` (including `baseUrl`). Inherited configs,
  JSONC and bundler-only aliases remain unresolved, so those tests can still have no subject and show as untiered.
- Churn needs git history. It is `n/a` in a shallow clone (the usual CI checkout), outside a repository, and for tests with
  no resolvable subject. A test's creation commit is not counted as an edit.
- The parser reads files through TypeScript 7's JS API, which its authors label `unstable`; the dependency is pinned
  exactly and only `src/parse.ts` uses it. A file it cannot parse is reported with the `unparsed` flag, not skipped.
- Drift detection ignores a one-segment catch-all such as `src/**`, so a new directory under `src` is reported until it
  has its own area; add areas by hand for anything nested deeper than the draft looks.

## Development

    npm ci
    npm test
    npm run typecheck

CI follows the plugin's own doctrine: one non-blocking Ubuntu job per pull request (path-filtered, drafts skipped, newer pushes cancel older runs), and the Windows and macOS runs on demand, weekly and on release tags.

Vitest runs at most two workers to bound native parser processes and memory. Real-native restart boundaries run in the ordinary suite;
the 1,200-file production-threshold stress workload runs on manual, weekly and release-tag CI. To include it locally, set
`AGENT_TESTS_STRESS=1` for `npm test`. The production parser still restarts after 1,000 files.

## License

MIT
