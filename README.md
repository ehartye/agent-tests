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
dependencies. Node.js 24 or newer is required.

On this host, Codex CLI 0.162.1 supports the existing `.claude-plugin/plugin.json` manifest and native installation:

    codex plugin marketplace upgrade hartye-plugins --json
    codex plugin add agent-tests@hartye-plugins --json
    codex plugin list --marketplace hartye-plugins --json

Inspect the returned version, then run `tests-setup` from the installed plugin. This host check establishes packaging
support; it does not establish another host's installation or end-to-end skill behavior. Restart the conversation
when needed to discover updated skills.

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
5. Tests that run too often: full suites in hooks or builds, watch-mode test scripts, CI on every push, Windows and macOS matrices on the push path.

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
| `capabilities` | Name, version, standalone CLI `commands`; checked launcher adds `launcherCommands` from its helper dispatch map |
| `risk-draft [--write]` | A draft risk map; `--write` creates `.testing/risk.yml` if absent |
| `scan` | Evidence report as JSON (`agent-tests/evidence@1`) |
| `report [--max-files n] [--max-per-rule n]` | The same evidence as ranked, capped Markdown: project findings first, then a table of the most suspect test files with the rules that fired |

Every failure is one JSON line on stderr (`{"error":{"code","message","hint"}}`) with exit code 2 for a usage error and 1
otherwise. A broken runtime is reported the same way (`E_RUNTIME_BROKEN`), so an agent never has to read a stack trace.

The checked launcher also accepts `candidate-evidence observe node-test|vitest` and `candidate-evidence check` as an
explicit standalone helper. Observation runs project tests; scan/report stay static. See the [portable usage and
input-scope limits](references/candidate-evidence.md) before recording or checking a receipt.

The managed launcher also exports one browser-safe Playbot evidence module:

    node "<plugin-root>/scripts/run-managed.js" playbot-export --out <game-vendor-directory>
    node "<plugin-root>/scripts/run-managed.js" playbot-export --out <game-vendor-directory> --verify
    node "<plugin-root>/scripts/run-managed.js" playbot-export --out <game-vendor-directory> --verify --require-current

The three-file pin contains the actual module, its TypeScript declaration, final digests, producer version and source fingerprint.
Verification is read-only. It authenticates the three-file inventory and its declared payload digests, then compares
both module and declaration bytes with the actual producer (normalizing CRLF). Matching payloads with different
producer version or whole-runtime fingerprint return `valid:true`, `current:false` and explicit `drift` with
`bytesIdentical:true`. This does not authenticate a historical producer or endorse metadata edits. Changed payloads,
corrupt pins and malformed inventories fail. Strict release verification (`--verify --require-current`, or API
`requireCurrent:true`) also rejects identity drift. Exact identity returns `current:true` without drift.
API verification without a source returns `current:null`, proving pin integrity without producer equivalence;
strict mode requires a source. Export explicitly refreshes the owned pin to the exact current producer and refuses
foreign output files. Verification never refreshes or relabels a pin.
Games import `playbot-contract.mjs` directly; no tool process runs per bot beat.

`validateConfig` checks the common run envelope against declared adapter capabilities.
`createRunRecorder` records effective policy, independent game/bot seeds, origin, transport,
cooperative budgets, confirmed action outcomes, refusals and fallbacks. `snapshot` returns JSON;
`summarizeRun` produces a compact text summary. Game adapters retain their directors, rules,
local option validation, stop precedence, clocks, watchdogs and cleanup.

Adapters can preflight JSON observation options, provenance, static checks and artifact references with
`validateJson`, `validateProvenance`, `validateVerdict` and `validateEvidence` before setup or subscriptions.
These return detached, validated JSON data; native callbacks remain outside the observation data.
The recorder uses those same validators when accepting final reports.

Call `attempt` before delivery, retain its action ID, then `confirm` only after observing the actual
result. A forbidden alternate route records input failure and throws before delivery.
Adapters can then call `attachEvidence({evidence, native})` with actual artifact references; this
operation preserves the closed failure verdict, action counters and termination. JSON inputs must
contain plain, enumerable data without getters, hidden/symbol properties or sparse arrays. Signed
integer seeds are preserved; each game retains its own seed normalization.
Ordinary-input admission requires browser transport and complete forbidden-fallback accounting. Diagnostic snapshots
are sampled, but action/refusal/fallback counters are always collected; omitted tail events are counted.
Exact serialized bot continuation is unsupported in contract version 1.

## Status

Version 0.4.2 advertises managed helper commands and verifies byte-identical Playbot pins without rewriting
provenance metadata. Use `--verify --require-current` for exact producer identity at release gates.


Version 0.3 includes static audits for TypeScript and JavaScript projects using vitest, jest or Node's test runner,
an optional Node reporter, and explicitly invoked observational candidate evidence for Node-test/Vitest. Scan and
report never run tests. Candidate observation does not select lanes, suppress checks or authorize integration.
CI charges and statistical flakiness are not measured; remediation and wider runner/language support remain separate work.

Version 0.3.1 adds explicit Svelte component subjects and advisory evidence for full test suites chained into build scripts,
based on the APcademy Government case study.

Version 0.3.2 marks possible helper-based test registrations as incomplete inventory (`+?` in Markdown), preserving the
JSON count of recognized declarations. Its skills distinguish audit-only requests from authorized implementation and
shipping, keep full merge checks until a replacement is verified, and measure cold selection/setup cost before choosing
an edit lane. Current invalid-input behavior is separate from old-format preservation obligations.

Version 0.4 adds the portable Playbot configuration/recording contract and checked pin export described above.
It supplies evidence and validation, rather than a common game director or input executor.

## Known limitations

- Pattern detectors also match strings inside tests that are about those patterns, including this repository's own tests.
  Findings are evidence for the agent to read, not verdicts.
- Discovery skips `.local`, `.playwright-mcp`, `test-results` and `playwright-report` so archived checkouts and generated reports do not
  inflate the current suite. Test support modules and root Playwright/Jest/Vitest configs are checked for worktree
  hazards without being counted as tests. Runner detection reports the primary unit runner, not every browser tool.
- Subjects are found through relative imports, `require()` and dynamic `import()` of project files, plus `@subject`
  tags and exact/single-wildcard `paths` in a direct JSON `tsconfig.json` (including `baseUrl`). Inherited configs,
  JSONC and bundler-only aliases remain unresolved, so those tests can still have no subject and show as untiered.
  Explicit `.svelte` imports count as component subjects; component bodies are not parsed as tests.
- Build-gate evidence follows literal local package scripts from `prebuild`, `build` and `postbuild`, stopping on cycles.
  Cross-package selectors, forwarded script arguments, unknown runner options/filters and arbitrary shell/JS wrappers remain unresolved. A finding can
  describe an intentional release gate: confirm its purpose and replacement protection before separating tests from builds.
- Churn needs git history. It is `n/a` in a shallow clone (the usual CI checkout), outside a repository, and for tests with
  no resolvable subject. A test's creation commit is not counted as an edit.
- The parser reads files through TypeScript 7's JS API, which its authors label `unstable`; the dependency is pinned
  exactly and only `src/parse.ts` uses it. A file it cannot parse is reported with the `unparsed` flag, not skipped.
- Test counts are recognized static declarations, not native expanded cases. `wiring.opaque-test-registration` flags
  literal-title curried calls with inline callbacks at module/recognized-suite scope; the provider is unknown and
  `+?` marks that uncertainty. Ordinary callback APIs can match, and other helper shapes can remain undetected.
  Inspect the helper and compare the native inventory before judging a zero count or omitting checks.
- Drift detection ignores a one-segment catch-all such as `src/**`, so a new directory under `src` is reported until it
  has its own area; add areas by hand for anything nested deeper than the draft looks.

## Development

The [APcademy Government case study](docs/case-studies/apcademy-government.md) records the real inputs, audit changes,
and remaining execution-scope limitations that motivated component subjects and build-gate evidence.

    npm ci
    npm test
    npm run typecheck

CI follows the plugin's own doctrine: one non-blocking Ubuntu job per pull request (path-filtered, drafts skipped, newer pushes cancel older runs), and the Windows and macOS runs on demand, weekly and on release tags.

Vitest runs at most two workers to bound native parser processes and memory. Real-native restart boundaries run in the ordinary suite;
the 1,200-file production-threshold stress workload runs on manual, weekly and release-tag CI. To include it locally, set
`AGENT_TESTS_STRESS=1` for `npm test`. The production parser still restarts after 1,000 files.

## License

MIT
