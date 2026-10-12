# agent-tests v0.1 (Static Audit) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use h-superpowers:subagent-driven-development, h-superpowers:team-driven-development, or h-superpowers:executing-plans to implement this plan (ask user which approach). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship agent-tests v0.1: a Claude Code and Codex plugin whose managed Node CLI gathers static evidence about a TypeScript or JavaScript project's tests (vitest or jest), and whose skills turn that evidence into a risk-based, efficiency-focused audit and a strategy for structuring tests by project phase.

**Architecture:** A managed runtime (adapted from agent-prose) installs a versioned copy of the CLI outside the plugin cache. The CLI parses test files with TypeScript 7's JS API (`typescript/unstable/sync`, one native process fed from an in-memory filesystem), reads a committed risk map (`.testing/risk.yml`), runs five detector families (redundancy, shims, worktree hazards, wiring, frequency) and prints an evidence report as JSON or Markdown. It never runs the tests and never judges. Three skills (`tests-setup`, `test-strategy`, `test-audit`) carry the doctrine and the rubric that turns evidence into verdicts.

**Tech Stack:** Node 24+ running TypeScript directly (no build step), `typescript@7.0.2` (parser through its `unstable` JS API, and `tsc` for typechecking), `yaml@2.9.1`, `zod@4.6.6`, `vitest@5.0.3`, `@types/node@26.6.5`. Nothing to compile: TypeScript 7 ships a prebuilt native binary per platform as an optional dependency.

**Spec:** `docs/superpowers/specs/2026-10-11-agent-tests-design.md` (milestones M0 to M2).

---

## Conventions

- **Working copy:** all work happens in the worktree created in Task 1, `C:\Users\ehart\repos\agent-tests-v0.1`, on branch `feat/v0.1-static-audit`. Never commit to `main` or to `design/agent-tests-spec` from the main checkout.
- **Shells:** commands use only `git`, `npm`, `npx` and `node`, and forward-slash paths, so they run unchanged in PowerShell and Bash. Where syntax differs, both forms are shown.
- **Commits:** end every commit message with the attribution trailer your session specifies.
- **Test discipline:** every code task is test first. Run the new test and watch it fail for the stated reason before you write the implementation. Do not skip the failing run: it proves the test can fail.
- **Test runs are targeted:** each task runs only its own test files. The whole suite runs in Task 18.
- **Code is final:** the code blocks below were built and run before this plan was written. Type them exactly. If a test fails after you type a block, you mis-typed it; re-read the block rather than "fixing" the test.

## Deviations from the spec (and why)

1. **TypeScript 7.0.2, not an older line.** The owner asked for current versions, so every pin is the registry's latest as of 2026-10-11. TypeScript 7 is a native compiler whose main entry has no `createSourceFile`; its JS API lives on `typescript/unstable/*` subpaths and talks to the native binary over RPC. `src/parse.ts` uses it: one `API` session, a virtual filesystem (`typescript/unstable/fs`), one tiny project per file, then `forEachChild` over the returned AST. The costs are accepted and contained: the subpaths are named `unstable`, so the version is pinned exactly and `src/parse.ts` is the only file that touches them; the platform binary must install, so the managed-runtime dependency check parses a line for real; and a session must be closed, so `scan` closes it in a `finally`. Measured: about half a second to start, then about 1.5 milliseconds per file, flat, because each file's project is closed after use and the native process restarts every 1,000 files.
2. **The managed runtime has no `npm link` step and no browser step.** Skills always call the launcher, so a bare `tests` on PATH is never used.
3. **`scan` prints evidence JSON and `report` prints Markdown.** The spec listed `scan`, `time`, `report`; `time` belongs to the next plan.
4. **Noise controls found by running the audit on this repository itself:** type-only imports are not subjects; a test counts for a subject only when it imports three or fewer modules or is named after it; shared-subject findings collapse to one per file; `fixtures` directories are never scanned; a tag-only `push` trigger is a release run, not "every push", and may carry an OS matrix; `risk-draft` adds a catch-all `src/**` area when code sits directly under `src`; `@subject <path>` declares code a test reaches without importing it (a CLI run in a subprocess), and `@risk <tier>` states a tier for a test with no code subject.
5. **Doctrine is verified, not asserted.** Task 2 turns the spec's CI and testing claims into cited rules in `references/doctrine.md`. One claim was already corrected while planning: bare `vitest` starts watch mode only in an interactive terminal, so the skill says "can block", not "waits forever".
6. **A test with no `@lane` tag is not a finding in v0.1.** Tagging is opt-in and the risk map's tier already places every test, so a `wiring.no-lane` rule would flag nearly every test in a project that has not adopted tags. A lane-versus-tier mismatch is flagged only when a tag exists. Revisit it once `test-lanes` (a later plan) writes the tags.
7. **The CI default follows the owner's pull-request workflow, and replaces the spec's "no automatic CI in dev".** The doctrine research (rule 7) found team-oriented sources agree a build should run on every integration and that a local pass is an agent reporting on itself. The owner never pushes to the default branch, so the recommended default is one non-blocking Linux job per `pull_request` update (path-filtered, drafts skipped, newer runs cancel older ones), no `push` trigger and no post-merge run, with the Windows and macOS runs on demand, weekly and on release tags. The frequency detector accepts a Linux-only `pull_request` workflow and flags `push` triggers on branches and Windows or macOS on the pull-request path. The spec and doctrine rule 7 were amended to match.
8. **Every task was reviewed twice (spec compliance, then code quality), and the code blocks show the final, reviewed versions.** The reviews ran the detectors against realistic inputs and changed behavior, so the blocks differ from a first draft in these ways:
   - **Task 3:** the risk-map schema rejects unknown keys; read and parse failures are reported separately; `unparsed` is a file flag.
   - **Task 4:** a stale `setup.lock` is reclaimed when its owner is gone; the repair path never runs `npm ci` inside a live release; dependency-check failures keep the line naming the cause; the install contract has tests.
   - **Task 5:** the `clean` fixture sits next to each detector's false-positive guards.
   - **Task 6:** an unreadable directory is skipped instead of aborting; nested worktrees (`.worktrees`, `.claude`) are never scanned.
   - **Task 7:** BOM files parse; per-file time is flat; `it.skipIf`, `test.for`, `describe.each`, `expect.soft`, `require()` and `.mts` resolution are understood; tags come only from the leading comment; `declaredSubjects` validates `@subject` paths.
   - **Tasks 8 to 10:** the detectors were tuned so they never flag the recommended fixes (a `mkdtemp` prefix split over lines, `process.env.HOME = tmp`), repeated sweeps need a seed-like variable and a shared subject, hub subjects collapse to one finding, job-level `if:` gates and tag-gated jobs are understood, and nothing throws on odd input.
   - **Task 11:** `risk-draft` classifies by name tokens (not substrings), classifies loose files and route groups, and looks through generic container directories.
   - **Task 12:** churn counts rewrites only (a creation, rename or deletion is not an edit), scopes the window to the project, and reports unknown for shallow clones.
   - **Task 13:** drift ignores a one-segment catch-all such as `src/**`; findings point at the `@risk` and `@subject` tags.
   - **Task 14:** a file that cannot be parsed is flagged `unparsed` and the scan continues.
   - **Task 15:** the report ranks (unparsed files first, then distinct rules), caps its table and per-rule lists, separates project findings from per-file findings and de-duplicates messages, because an uncapped report would cost an agent about as much as reading the suite.
   - **Task 16:** every failure, including a broken runtime and a broken pipe, stays inside the one-line JSON contract; `report` takes `--max-files` and `--max-per-rule`; `risk-draft --write` never overwrites.

## Not in this plan

`time` (timed run, flake and parallel detection, second-worktree check), `test-remediate`, `test-lanes`, CI templates, Codex packaging, Python, and publishing to GitHub or the marketplace. Each gets its own plan after v0.1 ships.

## File structure

| Path | Responsibility |
|---|---|
| `scripts/managed-runtime.js`, `setup.js`, `run-managed.js`, `tests.mjs` | Install, verify and launch the managed runtime; the CLI entry |
| `src/schema.ts` | Zod schemas and types: risk map, findings, evidence report (the CLI/skills contract) |
| `src/errors.ts`, `src/paths.ts` | `CliError`; POSIX path helpers and glob matching |
| `src/riskmap.ts`, `src/riskdraft.ts` | Load, validate, serialize and draft `.testing/risk.yml`; tier lookup |
| `src/discover.ts` | Find test files and the runner |
| `src/parse.ts` | Parse a test file into facts; resolve subjects |
| `src/churn.ts` | Git history: edits and churn per test |
| `src/detectors/*.ts` | One file per detector family; pure functions returning findings |
| `src/scan.ts`, `src/report.ts`, `src/cli.ts` | Assemble the evidence report; render Markdown; command dispatch |
| `skills/*/SKILL.md` | `tests-setup`, `test-strategy`, `test-audit` |
| `references/doctrine.md` | Cited rules behind the skills |
| `tests/` | Unit tests, two fixture repositories and the acceptance test |

---

## Task 1: Worktree, scaffold and path helpers

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.gitattributes`, `.gitignore`, `.claude-plugin/plugin.json`, `LICENSE`
- Create: `tests/helpers/tree.ts`, `tests/paths.test.ts`, `src/paths.ts`

- [ ] **Step 1: Create the worktree and check Node**

From the main checkout:

```bash
cd C:/Users/ehart/repos/agent-tests
git worktree add ../agent-tests-v0.1 -b feat/v0.1-static-audit design/agent-tests-spec
cd ../agent-tests-v0.1
node --version
```

Expected: `v24.` or newer. Stop and upgrade Node if older. Every later command runs inside `agent-tests-v0.1`.

- [ ] **Step 2: Create the project files**

Create `package.json`:

```json
{
  "name": "agent-tests",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Test-efficiency toolkit for coding agents: risk-based test structure, suite audits and remediation",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ehartye/agent-tests.git"
  },
  "homepage": "https://github.com/ehartye/agent-tests#readme",
  "bugs": {
    "url": "https://github.com/ehartye/agent-tests/issues"
  },
  "keywords": ["testing", "ci", "risk-based-testing", "claude-code-plugin", "codex"],
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "setup": "node scripts/setup.js"
  },
  "license": "MIT",
  "dependencies": {
    "typescript": "7.0.2",
    "yaml": "2.9.1",
    "zod": "4.6.6"
  },
  "devDependencies": {
    "@types/node": "26.6.5",
    "vitest": "5.0.3"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023", "module": "NodeNext", "moduleResolution": "NodeNext",
    "lib": ["ES2023"], "strict": true,
    "noEmit": true, "allowImportingTsExtensions": true, "skipLibCheck": true,
    "erasableSyntaxOnly": true, "verbatimModuleSyntax": true,
    "allowJs": true,
    "types": ["node"]
  },
  "include": ["src", "tests"],
  "exclude": ["tests/fixtures", "node_modules"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/fixtures/**', 'node_modules/**'], testTimeout: 60000, hookTimeout: 60000 },
});
```

Create `.gitattributes`:

```
* text=auto eol=lf
```

Create `.gitignore`:

```
node_modules/
.local/
*.log
```

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "agent-tests",
  "version": "0.1.0",
  "description": "Test-efficiency toolkit for coding agents: structure tests by project phase and risk, audit a suite for redundant, shim, worktree-hostile, unwired and over-frequent tests, and remediate with evidence.",
  "author": { "name": "ehartye" },
  "repository": "https://github.com/ehartye/agent-tests",
  "license": "MIT",
  "keywords": ["testing", "ci", "risk-based-testing", "test-audit", "agents"]
}
```

Copy the MIT license used by the sibling plugins:

```powershell
Copy-Item C:/Users/ehart/repos/agent-prose/LICENSE LICENSE
```

```bash
cp C:/Users/ehart/repos/agent-prose/LICENSE LICENSE
```

- [ ] **Step 3: Install and confirm the pinned versions**

Run: `npm install`

Then run: `npm ls --depth=0`

Expected: the tree lists exactly `typescript@7.0.2`, `yaml@2.9.1`, `zod@4.6.6`, `@types/node@26.6.5` and `vitest@5.0.3`, and `package-lock.json` now exists. `node_modules/@typescript/typescript-win32-x64` (or your platform's package) is installed beside it.

- [ ] **Step 4: Write the temp-tree test helper and the failing path test**

Create `tests/helpers/tree.ts` (used by most later tests):

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Create a temp directory holding the given files (repo-relative path to text). Removed after each test. */
export function makeTree(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-tests-'));
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}
```

Create `tests/paths.test.ts`:

```ts
import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { globToRegExp, toPosix } from '../src/paths.ts';

describe('globToRegExp', () => {
  it('lets ** cross directories', () => {
    expect(globToRegExp('src/persistence/**').test('src/persistence/a/b.ts')).toBe(true);
  });

  it('keeps * inside one path segment', () => {
    const pattern = globToRegExp('src/*.ts');
    expect(pattern.test('src/a.ts')).toBe(true);
    expect(pattern.test('src/a/b.ts')).toBe(false);
  });

  it('treats **/ as zero or more leading directories', () => {
    const pattern = globToRegExp('**/x.ts');
    expect(pattern.test('x.ts')).toBe(true);
    expect(pattern.test('a/b/x.ts')).toBe(true);
  });

  it('escapes regex metacharacters', () => {
    expect(globToRegExp('a.b').test('axb')).toBe(false);
  });

  it('does not match a sibling directory with the same prefix', () => {
    expect(globToRegExp('src/auth/**').test('src/authors/x.ts')).toBe(false);
  });
});

describe('toPosix', () => {
  it('converts the platform separator to a forward slash', () => {
    expect(toPosix(['a', 'b', 'c.ts'].join(sep))).toBe('a/b/c.ts');
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run tests/paths.test.ts`

Expected: FAIL. The test file cannot import `../src/paths.ts` (module not found).

- [ ] **Step 6: Implement the path helpers**

Create `src/paths.ts`:

```ts
import { relative, sep } from 'node:path';

/** Repo-relative paths are stored with forward slashes on every OS. */
export const toPosix = (path: string): string => path.split(sep).join('/');

export const relPosix = (root: string, absolute: string): string => toPosix(relative(root, absolute));

/** Minimal glob: `**` crosses directories, `*` and `?` stay inside one path segment. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}
```

- [ ] **Step 7: Run the test and the typecheck**

Run: `npx vitest run tests/paths.test.ts`

Expected: PASS, 6 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitattributes .gitignore .claude-plugin LICENSE src/paths.ts tests/helpers/tree.ts tests/paths.test.ts
git commit -m "feat: scaffold agent-tests with pinned toolchain and path helpers"
```

---

## Task 2: Doctrine (M0 research)

This task is independent of Tasks 3 to 17 and can run in a parallel session from the moment Task 1 is committed. Task 17 needs it finished. It follows `CLAUDE.md`: the wiki is the source of truth, so search it first, then discover and ingest, and only then write.

**Files:**
- Create: `tests/doctrine.test.ts`, `references/doctrine.md`

- [ ] **Step 1: Write the failing doctrine test**

The test pins the twelve rules the skills teach, and requires each one to state a claim and either cite evidence or be labeled opinion.

Create `tests/doctrine.test.ts`:

```ts
/**
 * @lane scheduled
 * @risk low
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DOCTRINE = join(dirname(fileURLToPath(import.meta.url)), '..', 'references', 'doctrine.md');

/** Every rule the skills teach. A rule with no outside evidence must say so as Opinion. */
const REQUIRED_RULES = [
  'Efficiency is protection per unit of cost',
  'Run frequency multiplies cost',
  'Test size and layers',
  'Flaky tests cost more than their runtime',
  'Run only affected tests in the edit loop',
  'No compatibility tests without consumers',
  'Automatic CI on every push for a solo pre-release project',
  'Windows and macOS runners cost more than Linux',
  'Bare vitest can start watch mode in an interactive terminal',
  'Agent-written tests drift toward hollow and duplicated tests',
  'Risk tiers decide test depth',
  'Mutation testing measures whether a test can fail',
];

interface Rule {
  title: string;
  claim: string | null;
  evidence: string[];
  opinion: string | null;
}

function parseRules(text: string): Rule[] {
  return text
    .split(/^## Rule: /m)
    .slice(1)
    .map(section => {
      const [title, ...lines] = section.split('\n');
      const field = (name: string): string[] => lines.filter(line => line.startsWith(`${name}: `)).map(line => line.slice(name.length + 2).trim());
      return { title: title.trim(), claim: field('Claim')[0] ?? null, evidence: field('Evidence'), opinion: field('Opinion')[0] ?? null };
    });
}

describe('references/doctrine.md', () => {
  const rules = parseRules(readFileSync(DOCTRINE, 'utf8'));

  it('covers every rule the skills teach', () => {
    expect(rules.map(rule => rule.title).sort()).toEqual([...REQUIRED_RULES].sort());
  });

  it.each(REQUIRED_RULES)('%s states a claim', title => {
    expect(rules.find(rule => rule.title === title)?.claim).toBeTruthy();
  });

  it.each(REQUIRED_RULES)('%s cites evidence or is labeled opinion', title => {
    const rule = rules.find(candidate => candidate.title === title);
    expect(rule?.evidence.length || (rule?.opinion ? 1 : 0)).toBeGreaterThan(0);
  });

  it('cites evidence as a wiki page or a URL', () => {
    for (const rule of rules) for (const evidence of rule.evidence) expect(evidence).toMatch(/^(?:wiki\/|https?:\/\/)\S+ — \S/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/doctrine.test.ts`

Expected: FAIL. `references/doctrine.md` does not exist (ENOENT).

- [ ] **Step 3: Search the wiki first**

For each rule in the table below, run the wiki-search skill (`wiki-master:wiki-search`) with `--json --limit=10`, read the status line, and note every page that supports or contradicts the claim. The vault already holds one relevant page: `wiki/authored/no-claudes-sky/notes/test-strategy-review.md` (the owner's Planetforge review: judge a suite by defects caught and runtime, not headline count).

| # | Rule title (exact) | Seed claim to verify or refute | Look for |
|---|---|---|---|
| 1 | Efficiency is protection per unit of cost | A test is worth keeping when the risk it protects outweighs what it costs to run, read and maintain; neither test count nor speed alone says whether a suite is healthy. | The Planetforge note above; Google Testing Blog on test value and cost |
| 2 | Run frequency multiplies cost | The same test costs far more run on every edit than nightly, so placing tests in lanes by frequency saves more than deleting them. | Google presubmit and postsubmit split; DORA fast-feedback and CI capabilities |
| 3 | Test size and layers | Industry guidance splits tests by size or layer and runs cheaper ones more often; pyramid, trophy and honeycomb shapes disagree on proportions. | Google "Test Sizes"; Fowler "Practical Test Pyramid"; the testing trophy; Spotify honeycomb |
| 4 | Flaky tests cost more than their runtime | A flaky test erodes trust and wastes reruns and investigation, so it is quarantined or fixed, not tolerated. | Google "Flaky Tests at Google and How We Mitigate Them"; Fowler "Eradicating Non-Determinism in Tests" |
| 5 | Run only affected tests in the edit loop | Running only tests affected by a change keeps feedback fast; large companies use test impact analysis or predictive test selection. | Meta "Predictive Test Selection"; vitest `related` and `--changed`; jest `--findRelatedTests` and `--onlyChanged` |
| 6 | No compatibility tests without consumers | Compatibility and fallback behavior exists to protect consumers; where none exist, tests of it protect nothing. | Semantic Versioning section on major version zero; Hyrum's Law |
| 7 | Automatic CI on every push for a solo pre-release project | For one developer who runs the suite locally before merging, CI on every push repeats work; on-demand, scheduled and release-tag runs deliver the clean-environment value. | Fowler "Continuous Integration" (the counter-argument); DORA. This is the most contested rule: record the counter-evidence |
| 8 | Windows and macOS runners cost more than Linux | GitHub-hosted Windows and macOS runners bill at a higher per-minute rate than Linux. | GitHub Docs on Actions runner pricing and minute multipliers. Quote no numbers unless you read them today |
| 9 | Bare vitest can start watch mode in an interactive terminal | `vitest` without `run` enters watch mode only when stdin is an interactive terminal; `vitest run` always exits. | Vitest CLI documentation; jest `--watch` |
| 10 | Agent-written tests drift toward hollow and duplicated tests | Coding agents tend to produce mock-only, snapshot-only, tautological and duplicated tests. | Any measured study; if none exists, label as Opinion and say what evidence would change it |
| 11 | Risk tiers decide test depth | Risk-based testing allocates effort by likelihood and impact of failure. | ISTQB risk-based testing; James Bach's risk heuristics |
| 12 | Mutation testing measures whether a test can fail | Mutation testing injects faults to check that tests detect them, so it measures a test's ability to fail, not the lines it executes. | Google "State of Mutation Testing at Google"; Stryker documentation |

- [ ] **Step 4: Discover and ingest what the wiki lacks**

For every rule with no adequate wiki page, run `wiki-master:wiki-discover` on the "Look for" terms, capture the chosen sources with the matching `clip-*` skill, then run `wiki-master:wiki-ingest`. Reddit and Medium material stays in its own sections, as `wiki-maintainer` requires, and is never the sole evidence for a rule.

For rules 3 and 7, run `h-superpowers:perspective-research` before writing: rule 3 asks which test shape fits agent-built suites; rule 7 asks whether automatic CI on every push is worth it for a solo pre-release project. Keep the ADR it produces in the wiki, not in this repository.

- [ ] **Step 5: Write `references/doctrine.md`**

One section per rule, with the exact title from the table, in this format:

    ## Rule: <exact title>
    Claim: <one sentence, possibly revised from the seed>
    Evidence: wiki/sources/<page>.md — <one sentence on what it says>
    Evidence: https://example.org/page — <one sentence>
    Opinion: <only when no source supports the claim: say so, and say what would change the view>

Requirements, all enforced by the test:
- exactly the twelve titles above, no more and no fewer;
- every rule has a `Claim:` line;
- every rule has at least one `Evidence:` line or an `Opinion:` line;
- every `Evidence:` line starts with `wiki/` or `http`, followed by ` — ` and a sentence.

Cite only what you read in the vault or on the page. If the evidence contradicts a seed claim, change the claim, and note in the task's commit message which skill text in Task 17 must change with it.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/doctrine.test.ts`

Expected: PASS, 26 tests.

- [ ] **Step 7: Commit**

```bash
git add tests/doctrine.test.ts references/doctrine.md
git commit -m "docs: add cited doctrine for the testing rules the skills teach"
```

- [ ] **Step 8: Amend rule 7 for the owner's pull-request workflow**

The owner never pushes to the default branch and works only through feature branches and pull requests, so rule 7 recommends the non-blocking Linux job on `pull_request`, not on push to the default branch. Reword its `Claim:` accordingly (one non-blocking Linux job per pull-request update; OS matrix on demand, on a schedule and on release), change its `Opinion:` to say pull-request job instead of mainline job, and add a second `Note:` line recording the amendment and that no post-merge run is recommended because the pull-request job already ran on the same tree. Also tighten three phrases the spec review found stronger than their sources: say that the party whose commits more often touch tests runs the agent-reported merge gate (not "most often edits the tests"); label the "lots of unit tests would reward mock-heavy tests" clause as this doctrine's inference; and say a bare `vitest` call by an agent "may exit" because how Vitest detects an agent is not documented. Re-run `npx vitest run tests/doctrine.test.ts`; it still passes 26 tests.

```bash
git add references/doctrine.md
git commit -m "docs: amend doctrine rule 7 for the pull-request workflow and trim three overstatements"
```

---

## Task 3: Errors, schema and risk map

The schema is the contract between the CLI and the skills. Every later task builds on it.

**Files:**
- Create: `tests/schema.test.ts`, `tests/riskmap.test.ts`, `src/errors.ts`, `src/schema.ts`, `src/riskmap.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultRiskMap } from '../src/riskmap.ts';
import { EVIDENCE_SCHEMA, EvidenceReport, Finding, RiskMap } from '../src/schema.ts';

describe('RiskMap', () => {
  it('accepts the default map', () => {
    expect(RiskMap.safeParse(defaultRiskMap()).success).toBe(true);
  });

  it('rejects an unknown tier', () => {
    const map = { ...defaultRiskMap(), areas: [{ path: 'src/**', tier: 'urgent' }] };
    expect(RiskMap.safeParse(map).success).toBe(false);
  });

  it('rejects a negative weight', () => {
    const map = { ...defaultRiskMap(), weights: { wait: -1, agent: 1, ci: 1, churn: 1 } };
    expect(RiskMap.safeParse(map).success).toBe(false);
  });

  it('rejects unknown keys at every level', () => {
    expect(RiskMap.safeParse({ ...defaultRiskMap(), extra: 1 }).success).toBe(false);
    expect(RiskMap.safeParse({ ...defaultRiskMap(), weights: { wait: 1, agent: 1, ci: 1, churn: 1, extra: 1 } }).success).toBe(false);
    expect(RiskMap.safeParse({ ...defaultRiskMap(), areas: [{ path: 'src/**', tier: 'low', Why: 'typo' }] }).success).toBe(false);
  });

  it('rejects an unknown phase', () => {
    expect(RiskMap.safeParse({ ...defaultRiskMap(), phase: 'beta' }).success).toBe(false);
  });
});

describe('Finding', () => {
  it('requires a message', () => {
    const finding = { category: 'shim', rule: 'shim.title-marker', file: 'a.test.ts', message: '', evidence: '' };
    expect(Finding.safeParse(finding).success).toBe(false);
  });
});

describe('EvidenceReport', () => {
  it('pins the schema identifier', () => {
    const report = { schema: EVIDENCE_SCHEMA, root: '.', runner: 'vitest', phase: null, riskMapPresent: false, files: [], clusters: [], projectFindings: [] };
    expect(EvidenceReport.safeParse(report).success).toBe(true);
    expect(EvidenceReport.safeParse({ ...report, schema: 'other@1' }).success).toBe(false);
  });

  it('represents a static scan: unknown costs and tiers are null', () => {
    const file = {
      file: 'tests/a.test.ts',
      tests: 1,
      assertions: 1,
      flags: [],
      subjects: [],
      tags: {},
      tier: null,
      area: null,
      cost: { wait: null, agent: 120, ci: null, churn: null, edits: null },
      findings: [],
    };
    const report = { schema: EVIDENCE_SCHEMA, root: '.', runner: 'vitest', phase: null, riskMapPresent: false, files: [file], clusters: [], projectFindings: [] };
    expect(EvidenceReport.safeParse(report).success).toBe(true);
  });
});
```

Create `tests/riskmap.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CliError } from '../src/errors.ts';
import { RISK_MAP_PATH, defaultRiskMap, loadRiskMap, serializeRiskMap, tierFor } from '../src/riskmap.ts';
import { makeTree } from './helpers/tree.ts';

describe('loadRiskMap', () => {
  it('returns null when the project has no risk map', () => {
    expect(loadRiskMap(makeTree())).toBeNull();
  });

  it('round-trips a serialized map', () => {
    const map = { ...defaultRiskMap(), areas: [{ path: 'src/db/**', tier: 'critical' as const, why: 'data loss' }] };
    const root = makeTree({ [RISK_MAP_PATH]: serializeRiskMap(map) });
    expect(loadRiskMap(root)).toEqual(map);
  });

  const failure = (root: string): CliError => {
    try {
      loadRiskMap(root);
    } catch (error) {
      return error as CliError;
    }
    throw new Error('expected loadRiskMap to throw');
  };

  it('throws E_RISKMAP naming the bad field', () => {
    const error = failure(makeTree({ [RISK_MAP_PATH]: 'phase: beta\nconsumers: []\n' }));
    expect(error).toBeInstanceOf(CliError);
    expect(error.code).toBe('E_RISKMAP');
    expect(error.message).toContain('phase');
  });

  it('names the root when the file is empty', () => {
    expect(failure(makeTree({ [RISK_MAP_PATH]: '' })).message).toContain('(root)');
  });

  it('rejects a mistyped key instead of dropping it', () => {
    const typo = serializeRiskMap({ ...defaultRiskMap(), areas: [{ path: 'src/**', tier: 'low' }] }).replace('tier: low', 'tier: low\n    Why: typo');
    const error = failure(makeTree({ [RISK_MAP_PATH]: typo }));
    expect(error.code).toBe('E_RISKMAP');
    expect(error.message).toContain('Why');
  });

  it('reports an unreadable risk map as unreadable, not unparseable', () => {
    const error = failure(makeTree({ [`${RISK_MAP_PATH}/inner.txt`]: '' }));
    expect(error.code).toBe('E_RISKMAP');
    expect(error.message).toContain('Cannot read');
    expect(error.cause).toBeDefined();
  });

  it('throws E_RISKMAP for unparseable YAML', () => {
    const root = makeTree({ [RISK_MAP_PATH]: 'phase: [unclosed\n' });
    expect(() => loadRiskMap(root)).toThrow(/Cannot parse/);
  });
});

describe('tierFor', () => {
  const map = {
    ...defaultRiskMap(),
    areas: [
      { path: 'src/persistence/migrations/**', tier: 'standard' as const },
      { path: 'src/persistence/**', tier: 'critical' as const },
    ],
  };

  it('lets the first matching area win', () => {
    expect(tierFor(map, 'src/persistence/migrations/001.ts')).toEqual({ tier: 'standard', area: 'src/persistence/migrations/**' });
    expect(tierFor(map, 'src/persistence/store.ts')).toEqual({ tier: 'critical', area: 'src/persistence/**' });
  });

  it('returns null when nothing matches', () => {
    expect(tierFor(map, 'src/ui/button.ts')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/schema.test.ts tests/riskmap.test.ts`

Expected: FAIL. Both files cannot import their `src/` modules (module not found).

- [ ] **Step 3: Implement**

Create `src/errors.ts`:

```ts
/** Error with a stable machine-readable code; the CLI prints it as one-line JSON on stderr. */
export class CliError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(code: string, message: string, hint?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CliError';
    this.code = code;
    if (hint) this.hint = hint;
  }
}
```

Create `src/schema.ts`:

```ts
import { z } from 'zod';

export const Tier = z.enum(['critical', 'standard', 'low']);
export type Tier = z.infer<typeof Tier>;

export const Phase = z.enum(['dev', 'test', 'production']);
export type Phase = z.infer<typeof Phase>;

export const LaneName = z.enum(['edit', 'merge', 'scheduled', 'release']);
export type LaneName = z.infer<typeof LaneName>;

// The risk map is hand-edited and committed, so unknown keys are errors: a typo like `Why:` must not be dropped silently.
const LaneSpec = z.strictObject({
  runs: z.string().min(1),
  trigger: z.string().min(1),
  os: z.array(z.string()).optional(),
});

export const RiskMap = z.strictObject({
  phase: Phase,
  consumers: z.array(z.string()),
  weights: z.strictObject({
    wait: z.number().nonnegative(),
    agent: z.number().nonnegative(),
    ci: z.number().nonnegative(),
    churn: z.number().nonnegative(),
  }),
  lanes: z.strictObject({ edit: LaneSpec, merge: LaneSpec, scheduled: LaneSpec, release: LaneSpec }),
  areas: z.array(z.strictObject({ path: z.string().min(1), tier: Tier, why: z.string().optional() })),
});
export type RiskMap = z.infer<typeof RiskMap>;

export const Category = z.enum(['redundancy', 'shim', 'worktree', 'wiring', 'frequency']);
export type Category = z.infer<typeof Category>;

export const Finding = z.object({
  category: Category,
  rule: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  message: z.string().min(1),
  evidence: z.string(),
  note: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;

export const FileFlag = z.enum(['tautological', 'snapshot-only', 'mock-only', 'no-direct-assertions', 'unparsed']);
export type FileFlag = z.infer<typeof FileFlag>;

export const TestFileRecord = z.object({
  file: z.string(),
  tests: z.number().int().nonnegative(),
  assertions: z.number().int().nonnegative(),
  flags: z.array(FileFlag),
  subjects: z.array(z.string()),
  tags: z.object({ lane: LaneName.optional(), risk: z.string().optional(), subjects: z.array(z.string()).optional() }),
  tier: Tier.nullable(),
  area: z.string().nullable(),
  cost: z.object({
    wait: z.number().nullable(),
    agent: z.number().int().nonnegative(),
    ci: z.number().nullable(),
    churn: z.number().int().nonnegative().nullable(),
    edits: z.number().int().nonnegative().nullable(),
  }),
  findings: z.array(Finding),
});
export type TestFileRecord = z.infer<typeof TestFileRecord>;

export const Cluster = z.object({
  subject: z.string(),
  files: z.array(z.string()),
  layers: z.array(z.string()),
});
export type Cluster = z.infer<typeof Cluster>;

export const EVIDENCE_SCHEMA = 'agent-tests/evidence@1';

export const EvidenceReport = z.object({
  schema: z.literal(EVIDENCE_SCHEMA),
  root: z.string(),
  runner: z.enum(['vitest', 'jest', 'unknown']),
  phase: Phase.nullable(),
  riskMapPresent: z.boolean(),
  files: z.array(TestFileRecord),
  clusters: z.array(Cluster),
  projectFindings: z.array(Finding),
});
export type EvidenceReport = z.infer<typeof EvidenceReport>;
```

Create `src/riskmap.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { CliError } from './errors.ts';
import { globToRegExp } from './paths.ts';
import { RiskMap, type Tier } from './schema.ts';

export const RISK_MAP_PATH = '.testing/risk.yml';

export function defaultRiskMap(): RiskMap {
  return {
    phase: 'dev',
    consumers: [],
    weights: { wait: 1, agent: 1, ci: 1, churn: 1 },
    lanes: {
      edit: { runs: 'affected-files', trigger: 'agent-edit' },
      merge: { runs: 'critical+standard', trigger: 'local-pre-push' },
      scheduled: { runs: 'all', trigger: 'cron', os: ['ubuntu', 'windows', 'macos'] },
      release: { runs: 'all+clean-install', trigger: 'tag', os: ['ubuntu', 'windows', 'macos'] },
    },
    areas: [],
  };
}

/** Returns null when the project has no risk map yet. Throws E_RISKMAP when the file is present but invalid. */
export function loadRiskMap(root: string): RiskMap | null {
  const path = join(root, RISK_MAP_PATH);
  if (!existsSync(path)) return null;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new CliError('E_RISKMAP', `Cannot read ${RISK_MAP_PATH}: ${(error as Error).message}`, undefined, { cause: error });
  }
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw new CliError('E_RISKMAP', `Cannot parse ${RISK_MAP_PATH}: ${(error as Error).message}`, undefined, { cause: error });
  }
  const result = RiskMap.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
    throw new CliError('E_RISKMAP', `Invalid ${RISK_MAP_PATH}: ${issues}`);
  }
  return result.data;
}

export function serializeRiskMap(map: RiskMap): string {
  const header =
    '# agent-tests risk map. Confirm or edit, then commit it.\n' +
    '# First matching area wins, so list specific areas before broad ones.\n' +
    '# consumers: who depends on this code? An empty list means compat and fallback tests guard nobody.\n';
  return header + stringify(map, { lineWidth: 0 });
}

/** `relPath` must be repo-relative with forward slashes, as `relPosix` produces. */
export function tierFor(map: RiskMap, relPath: string): { tier: Tier; area: string } | null {
  for (const area of map.areas) {
    if (globToRegExp(area.path).test(relPath)) return { tier: area.tier, area: area.path };
  }
  return null;
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/schema.test.ts tests/riskmap.test.ts`

Expected: PASS, 8 plus 9 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts src/schema.ts src/riskmap.ts tests/schema.test.ts tests/riskmap.test.ts
git commit -m "feat: add evidence schema, risk map loading and tier lookup"
```

---

## Task 4: Managed runtime

Adapted from agent-prose. The cache holds source only; setup copies a fingerprinted release to `~/.agent-tests/releases/...`, runs `npm ci`, and writes a receipt. The launcher refuses a missing or modified release.

**Files:**
- Create: `tests/managed-runtime.test.ts`, `scripts/managed-runtime.js`, `scripts/setup.js`, `scripts/run-managed.js`

- [ ] **Step 1: Write the failing test**

Create `tests/managed-runtime.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkDependencies, describeSource, installRuntime, inspectInstallation, resolveRuntime } from '../scripts/managed-runtime.js';
import { makeTree } from './helpers/tree.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const source = (extra: Record<string, string> = {}): string =>
  makeTree({
    'package.json': JSON.stringify({ name: 'agent-tests', version: '1.2.3' }),
    'package-lock.json': JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }),
    'scripts/tests.mjs': 'console.log("hi");\n',
    'src/cli.ts': 'export const x = 1;\n',
    ...extra,
  });

const fakes = { npm: () => '', checkDependencies: () => {} };

describe('describeSource', () => {
  it('fingerprints the runtime files and names a release key', () => {
    const described = describeSource(source());
    expect(described.version).toBe('1.2.3');
    expect(described.files).toEqual(['package.json', 'package-lock.json', 'scripts/tests.mjs', 'src/cli.ts']);
    expect(described.key).toMatch(/^1\.2\.3-[0-9a-f]{16}-/);
  });

  it('ignores line-ending differences in text files', () => {
    const lf = describeSource(source({ 'src/cli.ts': 'a\nb\n' }));
    const crlf = describeSource(source({ 'src/cli.ts': 'a\r\nb\r\n' }));
    expect(crlf.fingerprint).toBe(lf.fingerprint);
  });

  it('changes the fingerprint when source changes', () => {
    expect(describeSource(source({ 'src/cli.ts': 'a' })).fingerprint).not.toBe(describeSource(source({ 'src/cli.ts': 'b' })).fingerprint);
  });

  it('rejects a lockfile whose version differs from package.json', () => {
    const root = source({ 'package-lock.json': JSON.stringify({ version: '9.9.9', packages: { '': { version: '9.9.9' } } }) });
    expect(() => describeSource(root)).toThrow(/lockfile version mismatch/);
  });

  it('rejects a plugin manifest whose version differs from package.json', () => {
    const root = source({ '.claude-plugin/plugin.json': JSON.stringify({ name: 'agent-tests', version: '0.0.1' }) });
    expect(() => describeSource(root)).toThrow(/version mismatch/);
  });

  it('covers tsconfig, skills and references but not docs, tests or node_modules', () => {
    const described = describeSource(source({
      'tsconfig.json': '{}',
      'skills/audit/SKILL.md': '# skill\n',
      'references/doctrine.md': '# doctrine\n',
      'docs/plan.md': '# plan\n',
      'tests/a.test.ts': 'export {};\n',
      'node_modules/dep/index.js': 'module.exports = 1;\n',
    }));
    expect(described.files).toContain('tsconfig.json');
    expect(described.files).toContain('skills/audit/SKILL.md');
    expect(described.files).toContain('references/doctrine.md');
    expect(described.files.filter(name => /^(docs|tests|node_modules)\//.test(name))).toEqual([]);
  });

  it('ignores editor and OS litter, so it neither ships nor changes the fingerprint', () => {
    const plain = describeSource(source());
    const littered = describeSource(source({ 'src/.DS_Store': 'x', 'src/Thumbs.db': 'x', 'src/cli.ts~': 'x' }));
    expect(littered.files).toEqual(plain.files);
    expect(littered.fingerprint).toBe(plain.fingerprint);
  });
});

describe('resolveRuntime', () => {
  it('says to run tests-setup when nothing is installed', () => {
    expect(() => resolveRuntime(source(), { home: makeTree() })).toThrow(/tests-setup/);
  });

  it('refuses a home inside the plugin checkout', () => {
    const root = source();
    expect(() => resolveRuntime(root, { home: join(root, 'home') })).toThrow(/outside the plugin/);
  });

  it('refuses a home that contains the plugin checkout', () => {
    const root = source();
    expect(() => resolveRuntime(root, { home: dirname(root) })).toThrow(/outside the plugin/);
  });
});

describe('installRuntime', () => {
  it('copies the runtime, writes a receipt, and resolves afterwards', () => {
    const root = source();
    const home = makeTree();
    const installed = installRuntime(root, { home, ...fakes });
    expect(existsSync(join(installed.root, 'managed-install.json'))).toBe(true);
    expect(readFileSync(join(installed.root, 'scripts', 'tests.mjs'), 'utf8')).toContain('hi');
    expect(resolveRuntime(root, { home }).key).toBe(installed.key);
    expect(existsSync(join(home, 'setup.lock'))).toBe(false);
  });

  it('is idempotent', () => {
    const root = source();
    const home = makeTree();
    installRuntime(root, { home, ...fakes });
    expect(() => installRuntime(root, { home, ...fakes })).not.toThrow();
  });

  it('refuses to run while another setup holds the lock', () => {
    const root = source();
    const home = makeTree({ 'setup.lock': '{}' });
    expect(() => installRuntime(root, { home, ...fakes })).toThrow(/Another setup may be running/);
  });

  it('keeps a live setup lock when it refuses, and names the owner', () => {
    const root = source();
    const started = '2026-01-02T03:04:05.000Z';
    const home = makeTree({ 'setup.lock': JSON.stringify({ pid: process.pid, started }) });
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => installRuntime(root, { home, ...fakes })).toThrow(new RegExp(`Another setup may be running.*${process.pid}.*${started}`));
      expect(existsSync(join(home, 'setup.lock'))).toBe(true);
    }
  });

  it('refuses an unreadable lock and leaves it on disk', () => {
    const root = source();
    const home = makeTree({ 'setup.lock': 'not json' });
    expect(() => installRuntime(root, { home, ...fakes })).toThrow(/Another setup may be running/);
    expect(readFileSync(join(home, 'setup.lock'), 'utf8')).toBe('not json');
  });

  it('reclaims a lock left by an exited process and sweeps abandoned staging directories', () => {
    const root = source();
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    const home = makeTree({ 'setup.lock': JSON.stringify({ pid: gone, started: '2026-01-01T00:00:00.000Z' }) });
    mkdirSync(join(home, 'releases', '.install-abc'), { recursive: true });
    const installed = installRuntime(root, { home, ...fakes });
    expect(existsSync(join(installed.root, 'managed-install.json'))).toBe(true);
    expect(existsSync(join(home, 'setup.lock'))).toBe(false);
    expect(readdirSync(join(home, 'releases')).filter(name => name.startsWith('.install-'))).toEqual([]);
  });

  it('installs production dependencies from the lockfile', () => {
    const calls: string[][] = [];
    installRuntime(source(), { home: makeTree(), npm: (args: string[]) => { calls.push(args); return ''; }, checkDependencies: () => {} });
    expect(calls[0]?.slice(0, 2)).toEqual(['ci', '--omit=dev']);
  });

  it('cleans its staging directory and lock when dependency checks fail', () => {
    const root = source();
    const home = makeTree();
    const failing = { npm: () => '', checkDependencies: () => { throw new Error('missing zod'); } };
    expect(() => installRuntime(root, { home, ...failing })).toThrow(/missing zod/);
    expect(existsSync(join(home, 'setup.lock'))).toBe(false);
    expect(readdirSync(join(home, 'releases')).filter(name => name.startsWith('.install-'))).toEqual([]);
  });

  it('never reinstalls inside a live release whose dependencies fail the check', () => {
    const root = source();
    const home = makeTree();
    installRuntime(root, { home, ...fakes });
    const calls: string[][] = [];
    const broken = { npm: (args: string[]) => { calls.push(args); return ''; }, checkDependencies: () => { throw new Error('missing zod'); } };
    expect(() => installRuntime(root, { home, ...broken })).toThrow(/Move this release directory aside and rerun tests-setup/);
    expect(() => installRuntime(root, { home, ...broken })).toThrow(/missing zod/);
    expect(calls).toEqual([]);
    expect(existsSync(join(home, 'setup.lock'))).toBe(false);
  });

  it('detects a tampered release', () => {
    const root = source();
    const home = makeTree();
    const installed = installRuntime(root, { home, ...fakes });
    writeFileSync(join(installed.root, 'src', 'cli.ts'), 'tampered');
    expect(() => resolveRuntime(root, { home })).toThrow(/modified or version mismatch/);
  });
});

describe('inspectInstallation', () => {
  it('reports ok after install and the problem before', () => {
    const root = source();
    const home = makeTree();
    expect(inspectInstallation(root, { home, checkDependencies: () => {} }).ok).toBe(false);
    installRuntime(root, { home, ...fakes });
    const report = inspectInstallation(root, { home, checkDependencies: () => {} });
    expect(report).toMatchObject({ ok: true, pluginVersion: '1.2.3', cliVersion: '1.2.3', dependencies: true });
  });
});

describe('checkDependencies', () => {
  const failureOf = (root: string): string => {
    try { checkDependencies(root); } catch (error) { return (error as Error).message; }
    return '';
  };

  it('names the missing module and does not echo the probe source', () => {
    // yaml and zod resolve, but the runtime has no src/parse.ts.
    const root = makeTree({
      'node_modules/yaml/package.json': JSON.stringify({ name: 'yaml', version: '0.0.0', main: 'index.js' }),
      'node_modules/yaml/index.js': 'module.exports = {};\n',
      'node_modules/zod/package.json': JSON.stringify({ name: 'zod', version: '0.0.0', main: 'index.js' }),
      'node_modules/zod/index.js': 'module.exports = {};\n',
    });
    const message = failureOf(root);
    expect(message).toMatch(/^Dependency check failed: /);
    expect(message).toMatch(/Cannot find module/);
    expect(message).not.toContain('openParseSession');
  });

  it('keeps the line that names the problem when a package is missing entirely', () => {
    const message = failureOf(makeTree());
    expect(message).toMatch(/^Dependency check failed: .*Cannot find package 'yaml'/);
    expect(message).not.toMatch(/Node\.js v|\bat .*:\d+:\d+/);
  });
});

describe('launcher contract', () => {
  const run = (script: string, args: string[], home: string) =>
    spawnSync(process.execPath, [join(repoRoot, 'scripts', script), ...args], { encoding: 'utf8', env: { ...process.env, AGENT_TESTS_HOME: home } });
  const errorOf = (stderr: string) => {
    expect(stderr.trim().split('\n')).toHaveLength(1);
    return JSON.parse(stderr).error;
  };

  it('setup.js rejects unknown flags with E_USAGE and exit 2', () => {
    const result = run('setup.js', ['--bogus'], makeTree());
    expect(result.status).toBe(2);
    expect(errorOf(result.stderr).code).toBe('E_USAGE');
  });

  it('setup.js --check --json reports ok:false on stdout and exits 1 when nothing is installed', () => {
    const result = run('setup.js', ['--check', '--json'], makeTree());
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
  });

  it('setup.js reports an install failure as E_SETUP_FAILED without the circular hint', () => {
    const home = makeTree({ 'setup.lock': JSON.stringify({ pid: process.pid, started: '2026-01-02T03:04:05.000Z' }) });
    const result = run('setup.js', [], home);
    expect(result.status).toBe(1);
    const error = errorOf(result.stderr);
    expect(error.code).toBe('E_SETUP_FAILED');
    expect(error.message).toMatch(/Another setup may be running/);
    expect(error.hint).toMatch(/^Fix the cause in the message, then rerun node /);
    expect(error.hint).not.toContain('tests-setup skill');
  });

  it('run-managed.js reports a missing runtime as E_RUNTIME_MISSING and exit 1', () => {
    const result = run('run-managed.js', ['capabilities'], makeTree());
    expect(result.status).toBe(1);
    expect(errorOf(result.stderr).code).toBe('E_RUNTIME_MISSING');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/managed-runtime.test.ts`

Expected: FAIL. The test cannot import `../scripts/managed-runtime.js` (module not found).

- [ ] **Step 3: Implement**

Create `scripts/managed-runtime.js`:

```js
// @ts-nocheck -- plain Node script (no build step); exercised by tests/managed-runtime.test.ts
// Shared by setup and the skill launcher. Runtime selection never uses PATH.
// The Claude Code plugin cache is a bare git checkout with no node_modules.
// Setup copies the runtime files to ~/.agent-tests/releases/<key>, installs dependencies there,
// and skills run the launcher only. Adapted from agent-prose, without the npm-link and browser steps.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';

const NAME = 'agent-tests';
const RUNTIME_FILES = ['package.json', 'package-lock.json', 'tsconfig.json', 'scripts', 'src', 'skills', 'references'];
const RECEIPT = 'managed-install.json';
const TEXT = /\.(?:[cm]?[jt]s|json|ya?ml|md|txt)$/;
const LITTER = name => name === '.DS_Store' || name === 'Thumbs.db' || name.endsWith('~');
export const managedHome = () => resolve(process.env.AGENT_TESTS_HOME || join(homedir(), '.agent-tests'));
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const inside = (parent, child) => { const rel = relative(parent, child); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };

function canonical(path) {
  if (existsSync(path)) return realpathSync(path);
  return join(canonical(dirname(path)), basename(path));
}

function runtimeFiles(root) {
  const paths = [];
  function visit(name) {
    if (LITTER(basename(name))) return;
    const path = join(root, name);
    if (!existsSync(path)) return;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Runtime source must not contain symlinks: ${path}`);
    if (stat.isDirectory()) for (const child of readdirSync(path).sort()) visit(`${name}/${child}`);
    else if (stat.isFile()) paths.push(name);
  }
  for (const name of RUNTIME_FILES) visit(name);
  return paths;
}

export function describeSource(source) {
  source = realpathSync(source);
  const pkg = readJson(join(source, 'package.json'));
  if (pkg.name !== NAME || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) throw new Error(`Invalid ${NAME} package/version`);
  const pluginPath = join(source, '.claude-plugin', 'plugin.json');
  if (existsSync(pluginPath)) {
    const plugin = readJson(pluginPath);
    if (plugin.name !== pkg.name || plugin.version !== pkg.version) throw new Error('Plugin and CLI package version mismatch');
  }
  const lock = readJson(join(source, 'package-lock.json'));
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw new Error('Package and lockfile version mismatch');
  const files = runtimeFiles(source);
  const hash = createHash('sha256');
  for (const name of files) {
    const bytes = readFileSync(join(source, name));
    // Git checkouts can change CRLF. Normalize text, fingerprint anything else verbatim.
    const content = TEXT.test(name) ? bytes.toString('utf8').replaceAll('\r\n', '\n') : bytes;
    hash.update(name).update('\0').update(content).update('\0');
  }
  const fingerprint = hash.digest('hex');
  const key = `${pkg.version}-${fingerprint.slice(0, 16)}-${process.platform}-${process.arch}-${process.versions.modules}`;
  return { source, name: pkg.name, version: pkg.version, fingerprint, key, files };
}

function location(source, home) {
  const expected = describeSource(source);
  home = canonical(resolve(home));
  if (inside(expected.source, home) || inside(home, expected.source)) throw new Error('Managed installation must be outside the plugin/checkout, in a separate directory');
  const root = join(home, 'releases', expected.key);
  if (!inside(home, canonical(root))) throw new Error('Managed release resolves outside its installation home');
  return { ...expected, home, root, cli: join(root, 'scripts', 'tests.mjs') };
}

export function resolveRuntime(source, { home = managedHome() } = {}) {
  const runtime = location(source, home);
  const receiptPath = join(runtime.root, RECEIPT);
  if (!existsSync(receiptPath)) throw new Error(`Managed CLI ${runtime.version} is missing. Run the tests-setup skill (node "${join(runtime.source, 'scripts', 'setup.js')}").`);
  const receipt = readJson(receiptPath);
  if (receipt.fingerprint !== runtime.fingerprint || receipt.key !== runtime.key || describeSource(runtime.root).fingerprint !== runtime.fingerprint) {
    throw new Error(`Managed runtime modified or version mismatch at ${runtime.root}. Move this managed release aside and rerun tests-setup.`);
  }
  return runtime;
}

function assertNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 24) throw new Error(`agent-tests runs TypeScript directly and needs Node 24 or newer; this is Node ${process.versions.node}`);
}

function npmCli() {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  for (const entry of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    candidates.push(join(entry, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    const npm = join(entry, 'npm');
    if (existsSync(npm)) candidates.push(realpathSync(npm));
  }
  const found = candidates.find(path => path && path.endsWith('npm-cli.js') && existsSync(path));
  if (!found) throw new Error('Cannot locate npm-cli.js. Install Node.js with npm, then rerun tests-setup.');
  return found;
}

export function runNpm(args, { cwd, progress = false } = {}) {
  try {
    return execFileSync(process.execPath, [npmCli(), ...args], {
      cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      stdio: progress ? ['ignore', 2, 2] : ['ignore', 'pipe', 'pipe'],
    })?.trim() || '';
  } catch (error) {
    throw new Error(`npm ${args.join(' ')} failed: ${error.stderr || error.message}`);
  }
}

/** Exercise the runtime rather than only checking that directories exist. */
export function checkDependencies(root) {
  assertNode();
  // Parsing a line proves the platform's native TypeScript binary installed and starts, not just that the packages exist.
  const probe = [
    "await import('yaml'); await import('zod');",
    "const { openParseSession } = await import('./src/parse.ts');",
    'const session = openParseSession();',
    "try { session.parse('check.test.ts', \"it('x', () => {});\"); } finally { session.close(); }",
  ].join(' ');
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, windowsHide: true, stdio: 'pipe', encoding: 'utf8', timeout: 60_000 });
  } catch (error) {
    throw new Error(`Dependency check failed: ${summarizeFailure(error.stderr, error.message)}`);
  }
}

/** The raw error message echoes the probe source. Keep the line that names the problem and what follows it. */
function summarizeFailure(stderr, fallback) {
  const lines = String(stderr || '').split(/\r?\n/)
    .filter(line => line.trim() && !/^\s+at /.test(line) && !/^\s*[{}]\s*$/.test(line) && !/^\s*\^+\s*$/.test(line) && !/^Node\.js v/.test(line.trim()))
    .map(line => line.trim());
  const start = lines.findIndex(line => /\w*Error\b|Cannot find module/.test(line));
  const picked = start >= 0 ? lines.slice(start, start + 3) : lines.slice(0, 3);
  return picked.length ? picked.join(' | ') : fallback;
}

function lockOwner(lock) {
  try {
    const owner = JSON.parse(readFileSync(lock, 'utf8'));
    return Number.isInteger(owner?.pid) && owner.pid > 0 ? owner : null;
  } catch { return null; }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

/** Take setup.lock. A lock whose owner process has exited is stale: remove it and retry once. */
function acquireLock(lock) {
  for (let attempt = 0; ; attempt++) {
    try { return openSync(lock, 'wx'); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner = lockOwner(lock);
      if (attempt === 0 && owner && !isAlive(owner.pid)) {
        // Re-read just before unlinking: if another setup already reclaimed the lock and wrote its own, leave it alone.
        // A sliver remains between this read and the unlink (no atomic compare-and-delete on a file); it is not worth a lock of its own.
        const again = lockOwner(lock);
        if (again && again.pid === owner.pid && again.started === owner.started) {
          try { unlinkSync(lock); } catch (unlinkError) { if (unlinkError.code !== 'ENOENT') throw unlinkError; }
          continue;
        }
        owner = again;
      }
      const who = owner ? ` by pid ${owner.pid}${typeof owner.started === 'string' ? `, started ${owner.started}` : ''}` : '';
      throw new Error(`Another setup may be running (${lock}${who}). Remove a stale lock only after confirming no setup is active.`);
    }
  }
}

export function installRuntime(source, { home = managedHome(), npm = runNpm, checkDependencies: check = checkDependencies } = {}) {
  assertNode();
  const runtime = location(source, home);
  mkdirSync(runtime.home, { recursive: true });
  const lock = join(runtime.home, 'setup.lock');
  const fd = acquireLock(lock);
  let stage;
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
    const releases = join(runtime.home, 'releases');
    mkdirSync(releases, { recursive: true });
    // Holding the lock, so any .install-* directory is left over from a killed run.
    for (const name of readdirSync(releases)) if (name.startsWith('.install-')) rmSync(join(releases, name), { recursive: true, force: true });
    if (!existsSync(runtime.root)) {
      stage = mkdtempSync(join(releases, '.install-'));
      for (const name of runtime.files) {
        mkdirSync(dirname(join(stage, name)), { recursive: true });
        copyFileSync(join(runtime.source, name), join(stage, name));
      }
      npm(['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stage, progress: true });
      check(stage);
      if (describeSource(stage).fingerprint !== runtime.fingerprint) throw new Error('Runtime source changed during installation; rerun setup');
      writeFileSync(join(stage, RECEIPT), JSON.stringify({ key: runtime.key, version: runtime.version, fingerprint: runtime.fingerprint }, null, 2));
      renameSync(stage, runtime.root);
      stage = undefined;
    } else {
      resolveRuntime(source, { home });
      try { check(runtime.root); } catch (error) {
        // The receipt is valid, so only node_modules is suspect. Never rewrite a live release in place.
        throw new Error(`Managed release at ${runtime.root} fails its dependency check: ${error.message}. Move this release directory aside and rerun tests-setup.`);
      }
    }
    return runtime;
  } finally {
    closeSync(fd);
    if (stage && inside(join(runtime.home, 'releases'), realpathSync(stage))) rmSync(stage, { recursive: true, force: true });
    unlinkSync(lock);
  }
}

export function inspectInstallation(source, { home = managedHome(), checkDependencies: check = checkDependencies } = {}) {
  const expected = location(source, home);
  const report = { ok: false, pluginVersion: expected.version, cliVersion: null, runtimeRoot: expected.root, fingerprint: expected.fingerprint, dependencies: false, errors: [] };
  try {
    const runtime = resolveRuntime(source, { home });
    report.cliVersion = runtime.version;
    check(runtime.root);
    report.dependencies = true;
  } catch (error) { report.errors.push(error.message); }
  report.ok = report.dependencies && report.errors.length === 0;
  return report;
}
```

Create `scripts/setup.js`:

```js
#!/usr/bin/env node
// Install/check the managed runtime. Usage: node scripts/setup.js [--check] [--json]
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectInstallation, installRuntime } from './managed-runtime.js';

class UsageError extends Error {}
class SetupError extends Error {}
const source = join(dirname(fileURLToPath(import.meta.url)), '..');
const setupCommand = `node "${join(source, 'scripts', 'setup.js')}"`;
try {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--check', '--json'].includes(arg))) throw new UsageError('Usage: node scripts/setup.js [--check] [--json]');
  if (!args.includes('--check')) {
    try { installRuntime(source); } catch (error) { throw new SetupError(error.message, { cause: error }); }
  }
  const report = inspectInstallation(source);
  report.node = process.versions.node;
  console.log(JSON.stringify(report, null, args.includes('--json') ? undefined : 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  // Same error contract as the CLI and the launcher, whatever the flags; --json keeps its stdout report too.
  // An install failure must not point back at the setup skill that just failed.
  const [code, hint] = error instanceof UsageError ? ['E_USAGE', `Run the tests-setup skill (${setupCommand})`]
    : error instanceof SetupError ? ['E_SETUP_FAILED', `Fix the cause in the message, then rerun ${setupCommand}`]
    : ['E_RUNTIME_MISSING', `Run the tests-setup skill (${setupCommand})`];
  console.error(JSON.stringify({ error: { code, message: error.message, hint } }));
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, errors: [error.message] }));
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
```

Create `scripts/run-managed.js`:

```js
#!/usr/bin/env node
// Skill launcher: run the managed agent-tests CLI that matches this plugin, never a PATH or checkout CLI.
// Failures follow the CLI's error contract: one-line JSON on stderr, non-zero exit.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRuntime } from './managed-runtime.js';

const source = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const runtime = resolveRuntime(source);
  const child = spawnSync(process.execPath, [runtime.cli, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
} catch (error) {
  const hint = `Run the tests-setup skill (node "${join(source, 'scripts', 'setup.js')}")`;
  console.error(JSON.stringify({ error: { code: 'E_RUNTIME_MISSING', message: error.message, hint } }));
  process.exitCode = 1;
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/managed-runtime.test.ts`

Expected: PASS, 27 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines. (`managed-runtime.js` carries `// @ts-nocheck`; the test imports it through `allowJs`.)

- [ ] **Step 5: Commit**

```bash
git add scripts/managed-runtime.js scripts/setup.js scripts/run-managed.js tests/managed-runtime.test.ts
git commit -m "feat: add managed runtime install, check and launcher"
```

---

## Task 5: Fixture repositories

Two miniature repositories with known ground truth. `bloated` plants every smell the audit hunts; `clean` must report nothing, and it deliberately sits next to each detector's false-positive guards (mixed mock and value assertions, a snapshot plus a value, `mkdtemp`, dotfile names, a path-filtered `pull_request`, a tag-only `push`, a standard-tier area, a scoped pre-push hook). They are data, never executed: `vitest.config.ts` and `tsconfig.json` exclude `tests/fixtures`, and the scanner skips directories named `fixtures`. `expected.json` is the planted truth the acceptance test (Task 14) checks against.

The files are deliberately crude: tautologies, a fixed port, a `/tmp` path and a bare `vitest` script are the point. Do not tidy them.

**Files:** everything under `tests/fixtures/bloated/` and `tests/fixtures/clean/` listed below.

- [ ] **Step 1: Create the `bloated` fixture**

Create `tests/fixtures/bloated/package.json`:

```json
{
  "name": "bloated-fixture",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest",
    "pretest": "vitest run"
  },
  "devDependencies": {
    "vitest": "5.0.3"
  }
}
```

Create `tests/fixtures/bloated/.testing/risk.yml`:

```yaml
phase: dev
consumers: []
weights: {wait: 1, agent: 1, ci: 1, churn: 1}
lanes:
  edit: {runs: affected-files, trigger: agent-edit}
  merge: {runs: critical+standard, trigger: local-pre-push}
  scheduled: {runs: all, trigger: cron, os: [ubuntu, windows, macos]}
  release: {runs: all+clean-install, trigger: tag, os: [ubuntu, windows, macos]}
areas:
  - {path: "src/persistence/**", tier: critical, why: data loss}
  - {path: "src/auth/**", tier: critical, why: credentials}
  - {path: "src/legacy/**", tier: low}
  - {path: "src/ui/**", tier: low}
  - {path: "src/util/**", tier: standard}
```

Create `tests/fixtures/bloated/src/persistence/store.ts`:

```ts
export const save = (key: string, value: string): string => `${key}=${value}`;
export const load = (entry: string): string => entry.split('=')[1];
```

Create `tests/fixtures/bloated/src/auth/login.ts`:

```ts
export const login = (user: string, password: string): boolean => user.length > 0 && password.length > 7;
```

Create `tests/fixtures/bloated/src/legacy/format.ts`:

```ts
export const parseOld = (line: string): string[] => line.split(',');
```

Create `tests/fixtures/bloated/src/ui/button.ts`:

```ts
export const label = (text: string): string => text.trim();
```

Create `tests/fixtures/bloated/src/util/server.ts`:

```ts
export const start = (port: number): number => port;
```

Create `tests/fixtures/bloated/src/util/mailer.ts`:

```ts
export const send = (transport: (message: string) => void, message: string): void => transport(message);
```

Create `tests/fixtures/bloated/src/util/render.ts`:

```ts
export const render = (name: string): string => `<p>${name}</p>`;
```

Create `tests/fixtures/bloated/src/util/sweep.ts`:

```ts
export const roll = (seed: number): number => (seed * 7) % 6;
```

Create `tests/fixtures/bloated/src/billing/invoice.ts` (in no risk-map area, on purpose):

```ts
export const createInvoice = (amount: number): { amount: number } => ({ amount });
```

- [ ] **Step 2: Create the `bloated` fixture's tests**

Create `tests/fixtures/bloated/tests/persistence/store.unit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { load, save } from '../../src/persistence/store.ts';

describe('store', () => {
  it('round-trips a saved value through load', () => {
    expect(load(save('a', 'b'))).toBe('b');
  });
});
```

Create `tests/fixtures/bloated/tests/persistence/store.integration.test.ts` (same title, same subject: redundancy):

```ts
import { describe, expect, it } from 'vitest';
import { load, save } from '../../src/persistence/store.ts';

describe('store integration', () => {
  it('round-trips a saved value through load', () => {
    expect(load(save('key', 'value'))).toBe('value');
  });
});
```

Create `tests/fixtures/bloated/tests/legacy/compat-format.test.ts` (shim title, path and import):

```ts
import { describe, expect, it } from 'vitest';
import { parseOld } from '../../src/legacy/format.ts';

describe('legacy format compatibility', () => {
  it('parses the comma separated layout', () => {
    expect(parseOld('a,b')).toEqual(['a', 'b']);
  });
});
```

Create `tests/fixtures/bloated/tests/ui/button.test.ts` (low-tier code in the `edit` lane; a tautology):

```ts
/**
 * @lane edit
 */
import { describe, expect, it } from 'vitest';
import { label } from '../../src/ui/button.ts';

describe('button', () => {
  it('trims the label', () => {
    expect(label(' a ')).toBe('a');
    expect(true).toBe(true);
  });
});
```

Create `tests/fixtures/bloated/tests/net/server.test.ts` (every worktree hazard):

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { start } from '../../src/util/server.ts';

describe('server', () => {
  it('listens on the dev port', () => {
    const url = 'http://localhost:3000/health';
    const checkout = 'C:/Users/dev/project';
    const scratch = '/tmp/server-test.log';
    const head = join(process.cwd(), '.git', 'HEAD');
    const home = homedir();
    const db = 'test.sqlite';
    expect(start(3000)).toBe(3000);
    expect([url, checkout, scratch, head, home, db].length).toBe(6);
  });
});
```

Create `tests/fixtures/bloated/tests/sweeps/a.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { roll } from '../../src/util/sweep.ts';

describe('sweep a', () => {
  it('stays in range for every seed', () => {
    for (let seed = 1; seed <= 30; seed++) {
      expect(roll(seed)).toBeLessThan(7);
    }
  });
});
```

Create `tests/fixtures/bloated/tests/sweeps/b.test.ts` (the same 30-seed sweep):

```ts
import { describe, expect, it } from 'vitest';
import { roll } from '../../src/util/sweep.ts';

describe('sweep b', () => {
  it('is deterministic for every seed', () => {
    for (let seed = 1; seed <= 30; seed++) {
      expect(roll(seed)).toBeGreaterThanOrEqual(0);
    }
  });
});
```

Create `tests/fixtures/bloated/tests/mocks/mailer.test.ts` (asserts only on a mock):

```ts
import { describe, expect, it, vi } from 'vitest';
import { send } from '../../src/util/mailer.ts';

describe('mailer', () => {
  it('calls the transport once', () => {
    const transport = vi.fn();
    send(transport, 'hi');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith('hi');
  });
});
```

Create `tests/fixtures/bloated/tests/snap/render.test.ts` (asserts only a snapshot):

```ts
import { describe, expect, it } from 'vitest';
import { render } from '../../src/util/render.ts';

describe('render', () => {
  it('renders the name', () => {
    expect(render('x')).toMatchSnapshot();
  });
});
```

Create `tests/fixtures/bloated/tests/misc/invoice.test.ts` (no assertion, untiered code):

```ts
import { describe, it } from 'vitest';
import { createInvoice } from '../../src/billing/invoice.ts';

describe('invoice', () => {
  it('creates an invoice without throwing', () => {
    createInvoice(5);
  });
});
```

- [ ] **Step 3: Create the `bloated` fixture's hooks, CI and agent instructions**

Create `tests/fixtures/bloated/.husky/pre-commit`:

```
#!/usr/bin/env sh
npm test
```

Create `tests/fixtures/bloated/.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v5
      - run: npm test
```

Create `tests/fixtures/bloated/AGENTS.md`:

```markdown
# Agent instructions

Write small, focused changes.
Always run all tests after every change.
```

- [ ] **Step 4: Create the planted ground truth**

Create `tests/fixtures/bloated/expected.json`:

```json
{
  "findings": [
    {
      "rule": "redundancy.shared-subject",
      "file": "tests/persistence/store.unit.test.ts"
    },
    {
      "rule": "redundancy.shared-subject",
      "file": "tests/persistence/store.integration.test.ts"
    },
    {
      "rule": "redundancy.shared-subject",
      "file": "tests/sweeps/a.test.ts"
    },
    {
      "rule": "redundancy.shared-subject",
      "file": "tests/sweeps/b.test.ts"
    },
    {
      "rule": "redundancy.duplicate-title",
      "file": "tests/persistence/store.unit.test.ts"
    },
    {
      "rule": "redundancy.duplicate-title",
      "file": "tests/persistence/store.integration.test.ts"
    },
    {
      "rule": "redundancy.repeated-sweep",
      "file": "tests/sweeps/a.test.ts"
    },
    {
      "rule": "redundancy.repeated-sweep",
      "file": "tests/sweeps/b.test.ts"
    },
    {
      "rule": "shim.title-marker",
      "file": "tests/legacy/compat-format.test.ts"
    },
    {
      "rule": "shim.path-marker",
      "file": "tests/legacy/compat-format.test.ts"
    },
    {
      "rule": "shim.legacy-import",
      "file": "tests/legacy/compat-format.test.ts"
    },
    {
      "rule": "worktree.fixed-port",
      "file": "tests/net/server.test.ts"
    },
    {
      "rule": "worktree.absolute-path",
      "file": "tests/net/server.test.ts"
    },
    {
      "rule": "worktree.shared-tmp",
      "file": "tests/net/server.test.ts"
    },
    {
      "rule": "worktree.dot-git-dir",
      "file": "tests/net/server.test.ts"
    },
    {
      "rule": "worktree.home-dir",
      "file": "tests/net/server.test.ts"
    },
    {
      "rule": "worktree.fixed-db-file",
      "file": "tests/net/server.test.ts"
    },
    {
      "rule": "wiring.lane-mismatch",
      "file": "tests/ui/button.test.ts"
    },
    {
      "rule": "wiring.untiered",
      "file": "tests/misc/invoice.test.ts"
    },
    {
      "rule": "wiring.uncovered-critical",
      "file": "src/auth/**"
    },
    {
      "rule": "wiring.drift",
      "file": "src/billing"
    },
    {
      "rule": "frequency.hook-full-suite",
      "file": ".husky/pre-commit"
    },
    {
      "rule": "frequency.hook-full-suite",
      "file": "package.json"
    },
    {
      "rule": "frequency.watch-default",
      "file": "package.json"
    },
    {
      "rule": "frequency.ci-on-push",
      "file": ".github/workflows/ci.yml"
    },
    {
      "rule": "frequency.ci-on-pull-request",
      "file": ".github/workflows/ci.yml"
    },
    {
      "rule": "frequency.ci-os-matrix-on-push",
      "file": ".github/workflows/ci.yml"
    },
    {
      "rule": "frequency.agent-run-all",
      "file": "AGENTS.md"
    }
  ],
  "flags": {
    "tests/ui/button.test.ts": [
      "tautological"
    ],
    "tests/mocks/mailer.test.ts": [
      "mock-only"
    ],
    "tests/snap/render.test.ts": [
      "snapshot-only"
    ],
    "tests/misc/invoice.test.ts": [
      "no-direct-assertions"
    ]
  },
  "clusters": [
    {
      "subject": "src/persistence/store.ts",
      "files": [
        "tests/persistence/store.integration.test.ts",
        "tests/persistence/store.unit.test.ts"
      ]
    },
    {
      "subject": "src/util/sweep.ts",
      "files": [
        "tests/sweeps/a.test.ts",
        "tests/sweeps/b.test.ts"
      ]
    }
  ]
}
```

- [ ] **Step 5: Create the `clean` fixture**

Create `tests/fixtures/clean/package.json`:

```json
{
  "name": "clean-fixture",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "5.0.3"
  }
}
```

Create `tests/fixtures/clean/.testing/risk.yml`:

```yaml
phase: dev
consumers: []
weights: {wait: 1, agent: 1, ci: 1, churn: 1}
lanes:
  edit: {runs: affected-files, trigger: agent-edit}
  merge: {runs: critical+standard, trigger: local-pre-push}
  scheduled: {runs: all, trigger: cron, os: [ubuntu, windows, macos]}
  release: {runs: all+clean-install, trigger: tag, os: [ubuntu, windows, macos]}
areas:
  - {path: "src/core/**", tier: critical, why: core arithmetic}
  - {path: "src/util/**", tier: standard, why: small helpers}
  - {path: "src/ui/**", tier: low}
```

Create `tests/fixtures/clean/src/core/math.ts`:

```ts
export const add = (a: number, b: number): number => a + b;
```

Create `tests/fixtures/clean/src/ui/label.ts`:

```ts
export const label = (text: string): string => text.trim();
```

Create `tests/fixtures/clean/src/core/text.ts`:

```ts
export const slug = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, '-');
export const total = (items: number[]): number => items.reduce((sum, item) => sum + item, 0);
```

Create `tests/fixtures/clean/tests/core/text.test.ts` (every case sits next to a pattern a detector looks for, and none of them may be flagged):

```ts
/**
 * @lane merge
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { slug, total } from '../../src/core/text.ts';

// Every case below sits next to a pattern a detector looks for, and none of them may be flagged.
describe('text helpers', () => {
  it('mixes a mock assertion with a real value assertion', () => {
    const report = vi.fn();
    report(slug(' Hello World '));
    expect(report).toHaveBeenCalledWith('hello-world');
    expect(slug(' Hello World ')).toBe('hello-world');
  });

  it('pairs a snapshot with a plain value assertion', () => {
    expect(slug('A B')).toMatchSnapshot();
    expect(total([1, 2, 3])).toBe(6);
  });

  it('compares two different expressions', () => {
    expect(total([2, 2])).toBe(total([4]));
  });

  it('uses a unique scratch directory and dotfile names that are not .git', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'text-'));
    const names = ['.gitignore', '.github/workflows'];
    expect(scratch.length).toBeGreaterThan(0);
    expect(names).toHaveLength(2);
  });

  it.todo('handles unicode');
});
```

Create `tests/fixtures/clean/src/util/pad.ts`:

```ts
export const pad = (text: string, width: number): string => text.padStart(width, ' ');
```

Create `tests/fixtures/clean/tests/util/pad.test.ts` (a standard-tier area with a `scheduled` lane, which that tier allows):

```ts
/**
 * @lane scheduled
 */
import { describe, expect, it } from 'vitest';
import { pad } from '../../src/util/pad.ts';

describe('pad', () => {
  it('pads on the left to the requested width', () => {
    expect(pad('a', 3)).toBe('  a');
  });
});
```

Create `tests/fixtures/clean/tests/core/math.test.ts`:

```ts
/**
 * @lane merge
 */
import { describe, expect, it } from 'vitest';
import { add } from '../../src/core/math.ts';

describe('add', () => {
  it('adds two positive numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('cancels opposite numbers', () => {
    expect(add(-1, 1)).toBe(0);
  });
});
```

Create `tests/fixtures/clean/tests/ui/label.test.ts`:

```ts
/**
 * @lane scheduled
 */
import { describe, expect, it } from 'vitest';
import { label } from '../../src/ui/label.ts';

describe('label', () => {
  it('trims surrounding whitespace', () => {
    expect(label('  hi  ')).toBe('hi');
  });
});
```

Create `tests/fixtures/clean/.husky/pre-push`:

```
#!/usr/bin/env sh
npx vitest run --changed origin/main
```

Create `tests/fixtures/clean/.github/workflows/ci.yml`:

```yaml
name: CI
on:
  workflow_dispatch:
  schedule:
    - cron: '0 6 * * 1'
  pull_request:
    paths: ['src/**']
  push:
    tags: ['v*']
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - run: npm test
```

Create `tests/fixtures/clean/AGENTS.md`:

```markdown
# Agent instructions

Run the edit lane after each change and the merge lane before pushing.
```

- [ ] **Step 6: Confirm the fixtures stay out of the project's own test and type runs**

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (the fixtures are excluded).

Run: `npx vitest list`

Expected: lists the test files from Tasks 1 to 4 only, none under `tests/fixtures`.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures
git commit -m "test: add bloated and clean fixture repositories with planted ground truth"
```

---

## Task 6: Test discovery

**Files:**
- Create: `tests/discover.test.ts`, `src/discover.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/discover.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { detectRunner, discoverTests, isSupportPath, isTestPath, walk } from '../src/discover.ts';
import { makeTree } from './helpers/tree.ts';

describe('isTestPath', () => {
  it('recognizes .test and .spec files and __tests__ directories', () => {
    expect(isTestPath('src/a.test.ts')).toBe(true);
    expect(isTestPath('src/a.spec.mjs')).toBe(true);
    expect(isTestPath('src/__tests__/a.ts')).toBe(true);
    expect(isTestPath('src/a.ts')).toBe(false);
    expect(isTestPath('src/a.test.md')).toBe(false);
  });

  it('covers module-flavored extensions and rejects declaration files', () => {
    expect(isTestPath('src/a.test.d.ts')).toBe(false);
    expect(isTestPath('src/a.test.mts')).toBe(true);
    expect(isTestPath('src/a.spec.cts')).toBe(true);
    expect(isTestPath('src/a.test.tsx')).toBe(true);
  });
});

describe('isSupportPath', () => {
  it('treats helpers, fixtures and mocks as support code', () => {
    expect(isSupportPath('tests/helpers/tree.ts')).toBe(true);
    expect(isSupportPath('src/__mocks__/fs.ts')).toBe(true);
    expect(isSupportPath('src/persistence/store.ts')).toBe(false);
  });
});

describe('walk', () => {
  it('skips a directory that cannot be read instead of throwing', () => {
    const root = makeTree({ 'a.test.ts': '' });
    const visited: string[] = [];
    expect(() => walk(join(root, 'missing'), (_absolute, rel) => visited.push(rel))).not.toThrow();
    expect(visited).toEqual([]);
  });
});

describe('discoverTests', () => {
  it('finds test files in sorted order and skips ignored directories, including fixtures', () => {
    const root = makeTree({
      'b.test.ts': '',
      'a.test.ts': '',
      'src/util.ts': '',
      'src/__tests__/helper.ts': '',
      'node_modules/pkg/x.test.ts': '',
      'dist/y.test.js': '',
      'tests/fixtures/sample/z.test.ts': '',
    });
    expect(discoverTests(root)).toEqual(['a.test.ts', 'b.test.ts', 'src/__tests__/helper.ts']);
  });

  it('skips nested git worktrees', () => {
    const root = makeTree({
      'a.test.ts': '',
      '.worktrees/x/a.test.ts': '',
      '.claude/worktrees/y/b.test.ts': '',
    });
    expect(discoverTests(root)).toEqual(['a.test.ts']);
  });

  it('returns plain code-unit order of the full path, not traversal order', () => {
    const root = makeTree({ 'a/x.test.ts': '', 'a-b/x.test.ts': '' });
    expect(discoverTests(root)).toEqual(['a-b/x.test.ts', 'a/x.test.ts']);
  });
});

describe('detectRunner', () => {
  it('prefers vitest from package.json', () => {
    const root = makeTree({ 'package.json': JSON.stringify({ devDependencies: { vitest: '5.0.3', jest: '30.0.0' } }) });
    expect(detectRunner(root)).toBe('vitest');
  });

  it('detects jest from dependencies', () => {
    expect(detectRunner(makeTree({ 'package.json': JSON.stringify({ devDependencies: { jest: '30.0.0' } }) }))).toBe('jest');
  });

  it('falls back to a config file', () => {
    expect(detectRunner(makeTree({ 'package.json': '{}', 'jest.config.js': '' }))).toBe('jest');
  });

  it('reports unknown for a root with no package.json and no config', () => {
    expect(detectRunner(makeTree())).toBe('unknown');
  });

  it('detects vitest from a config file when package.json lists no dependencies', () => {
    expect(detectRunner(makeTree({ 'package.json': '{}', 'vitest.config.ts': '' }))).toBe('vitest');
  });

  it('reports unknown when nothing identifies a runner', () => {
    expect(detectRunner(makeTree({ 'package.json': '{not json' }))).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/discover.test.ts`

Expected: FAIL. Cannot import `../src/discover.ts`.

- [ ] **Step 3: Implement**

Create `src/discover.ts`:

```ts
import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { relPosix } from './paths.ts';

/**
 * Directory names skipped at any depth and case-sensitively, so a source directory named `build` or `out` is skipped too.
 * `.worktrees` and `.claude` hold nested git worktrees, which would otherwise double-count every test.
 */
export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'out',
  'fixtures',
  '.worktrees',
  '.claude',
  '.venv',
  'vendor',
]);

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const SUPPORT_DIR = /(^|\/)(?:tests?|__tests__|__mocks__|fixtures?|helpers?|testing|test-utils?)\//;

export const isTestPath = (rel: string): boolean => TEST_FILE.test(rel) || (/(^|\/)__tests__\//.test(rel) && CODE_FILE.test(rel));

/** Test helpers and fixtures are not the code a test protects, so they never count as a test's subject. */
export const isSupportPath = (rel: string): boolean => SUPPORT_DIR.test(rel);

const UNREADABLE = new Set(['ENOENT', 'EACCES', 'EPERM']);

/** List a directory, or nothing when it is missing or not permitted; any other error still throws. */
export function readEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (UNREADABLE.has((error as NodeJS.ErrnoException).code ?? '')) return [];
    throw error;
  }
}

const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Visit every regular file under root. Symbolic links and junctions are intentionally not followed (this prevents loops;
 * a symlinked test file or directory is therefore not audited), and unreadable directories are skipped.
 */
export function walk(root: string, visit: (absolute: string, rel: string) => void, dir = root): void {
  for (const entry of readEntries(dir).sort(byName)) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(root, visit, absolute);
    } else if (entry.isFile()) visit(absolute, relPosix(root, absolute));
  }
}

export function discoverTests(root: string): string[] {
  const found: string[] = [];
  walk(root, (_absolute, rel) => {
    if (isTestPath(rel)) found.push(rel);
  });
  return found.sort();
}

export type Runner = 'vitest' | 'jest' | 'unknown';

export function detectRunner(root: string): Runner {
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies?: object; devDependencies?: object };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ('vitest' in deps) return 'vitest';
      if ('jest' in deps || 'ts-jest' in deps || '@jest/globals' in deps) return 'jest';
    } catch {
      // An unreadable package.json falls through to the config-file check.
    }
  }
  let names: string[];
  try {
    names = readdirSync(root);
  } catch (error) {
    if (!UNREADABLE.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
    names = [];
  }
  if (names.some(name => /^vitest\.config\./.test(name))) return 'vitest';
  if (names.some(name => /^jest\.config\./.test(name))) return 'jest';
  return 'unknown';
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/discover.test.ts`

Expected: PASS, 13 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/discover.ts tests/discover.test.ts
git commit -m "feat: discover test files and detect the runner"
```

---

## Task 7: Test file parser

The parser turns one test file into facts: imports, titles, tests with their assertion counts, snapshot and mock assertions, tautologies, tags, and the repo-relative source files it imports (its subjects).

It uses TypeScript 7's JS API, which drives a native process. `openParseSession()` starts that process once and returns `parse(fileName, text)` and `close()`; each call writes the text into an in-memory filesystem, opens a one-file project, and walks the returned AST. Always `close()` the session, or the native process outlives the script. Tests share one session per test file through a small helper, so the process starts once per file, not once per test.

**Files:**
- Create: `tests/helpers/parse.ts`, `tests/parse.test.ts`, `src/parse.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/helpers/parse.ts` (used by this task's test and by the detector tests in Tasks 8 and 9):

```ts
import { afterAll } from 'vitest';
import { openParseSession, type ParseSession } from '../../src/parse.ts';

let session: ParseSession | null = null;

// This module-level session relies on vitest's per-file isolation: every test file gets a fresh copy of this module,
// so each file starts its own session and this afterAll closes it. Turning isolation off would share one session.
afterAll(() => {
  session?.close();
  session = null;
});

/** Parse one file with a session shared by the whole test file, so the native TypeScript process starts once. */
export function parseTestFile(fileName: string, text: string): ReturnType<ParseSession['parse']> {
  session ??= openParseSession();
  return session.parse(fileName, text);
}
```

Create `tests/parse.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declaredSubjects, openParseSession, parseTags, resolveSubjects } from '../src/parse.ts';
import { parseTestFile } from './helpers/parse.ts';
import { makeTree } from './helpers/tree.ts';

const SAMPLE = `/**
 * @lane merge
 * @risk critical
 */
import { describe, expect, it, vi } from 'vitest';
import { save } from '../src/store.ts';
import legacy from './legacy/format.js';

describe('store', () => {
  it('saves a value', () => {
    expect(save('a', 'b')).toBe('a=b');
    expect(true).toBe(true);
  });
  it.skip('is skipped but still a test', () => {
    expect(1).toBeTruthy();
  });
  it.todo('is not written yet');
  it.each([1, 2])('handles %s', value => {
    expect(value).toBeGreaterThan(0);
  });
  it('calls the transport', () => {
    const transport = vi.fn();
    transport('x');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('matches a snapshot', () => {
    expect(save('a', 'b')).toMatchSnapshot();
  });
  it('asserts nothing', () => {
    save('a', 'b');
  });
});
`;

describe('parseTestFile', () => {
  const parsed = parseTestFile('tests/store.test.ts', SAMPLE);

  it('collects imports and titles', () => {
    expect(parsed.imports).toEqual(['vitest', '../src/store.ts', './legacy/format.js']);
    expect(parsed.titles.map(title => title.text)).toContain('store');
    expect(parsed.titles.map(title => title.text)).toContain('saves a value');
  });

  it('counts tests, including skipped, todo and each', () => {
    expect(parsed.tests.map(test => test.name)).toEqual([
      'saves a value',
      'is skipped but still a test',
      'is not written yet',
      'handles %s',
      'calls the transport',
      'matches a snapshot',
      'asserts nothing',
    ]);
    expect(parsed.tests.find(test => test.name === 'is not written yet')?.todo).toBe(true);
  });

  it('attributes assertions to the test that contains them', () => {
    const byName = Object.fromEntries(parsed.tests.map(test => [test.name, test.assertions]));
    expect(byName['saves a value']).toBe(2);
    expect(byName['asserts nothing']).toBe(0);
  });

  it('counts total, snapshot, mock assertions and mock calls', () => {
    expect(parsed.assertions).toBe(6);
    expect(parsed.snapshotAssertions).toBe(1);
    expect(parsed.mockAssertions).toBe(1);
    expect(parsed.mockCalls).toBe(1);
  });

  it('flags a tautological identity assertion but not a real one', () => {
    expect(parsed.tautologies).toBe(1);
  });

  it('reports 1-based line numbers, including after non-ASCII text', () => {
    // Each padded line is far longer than any shift a byte-versus-character mix-up could cause on a short line.
    const pad = `// ${'é—✓🙂'.repeat(60)}`;
    const lines = parseTestFile('a.test.ts', `${pad}\n${pad}\n${pad}\nit('first', () => {});\n${pad}\n\nit('second', () => {});\n`);
    expect(lines.tests.map(test => [test.name, test.line])).toEqual([
      ['first', 4],
      ['second', 7],
    ]);
  });

  it('reports the right lines in a CRLF source', () => {
    const lines = parseTestFile('a.test.ts', "it('first', () => {});\r\n\r\nit('second', () => {});\r\n");
    expect(lines.tests.map(test => [test.name, test.line])).toEqual([
      ['first', 1],
      ['second', 3],
    ]);
  });

  it('parses a file that starts with a byte order mark', () => {
    const parsed = parseTestFile('a.test.ts', "﻿it('first', () => {});\nit('second', () => {});");
    expect(parsed.tests.map(test => [test.name, test.line])).toEqual([
      ['first', 1],
      ['second', 2],
    ]);
  });

  it('reads lane and risk tags from the leading docblock', () => {
    expect(parsed.tags).toEqual({ lane: 'merge', risk: 'critical' });
  });
});

describe('parseTestFile imports', () => {
  it('leaves out type-only imports but keeps mixed ones', () => {
    const source = [
      "import type { A } from './a.ts';",
      "import { type B } from './b.ts';",
      "import { type C, c } from './c.ts';",
      "import d from './d.ts';",
      "import './e.ts';",
    ].join('\n');
    const parsed = parseTestFile('a.test.ts', source);
    expect(parsed.imports).toEqual(['./c.ts', './d.ts', './e.ts']);
  });

  it('collects require and dynamic import specifiers but not mocked modules', () => {
    const source = [
      "const a = require('./a.cjs');",
      "const b = await import('./b.js');",
      "vi.mock('./mocked.ts');",
      "jest.mock('./also-mocked.ts', () => ({}));",
      'const c = require(name);',
      'const d = await import(name);',
    ].join('\n');
    expect(parseTestFile('a.test.ts', source).imports).toEqual(['./a.cjs', './b.js']);
  });
});

describe('parseTestFile test and suite forms', () => {
  it('counts curried, tagged-template and line-split forms once each', () => {
    const source = [
      "it.each([1, 2])('each %s', value => {});",
      "it.skipIf(true)('skip if', () => {});",
      "it.runIf(false)('run if', () => {});",
      "test.for([1])('for %s', value => {});",
      "it.each`a | b\n${1} | ${2}`('tagged %s', () => {});",
      "it\n  .skip('split over lines', () => {});",
      "it.concurrent.each([1])('concurrent each', () => {});",
      "it.sequential('sequential', () => {});",
      "it.todo('not written');",
      "describe.each([1])('suite %s', () => {});",
      "describe\n  .skip('split suite', () => {});",
    ].join('\n');
    const parsed = parseTestFile('forms.test.ts', source);
    expect(parsed.tests.map(test => test.name)).toEqual(['each %s', 'skip if', 'run if', 'for %s', 'tagged %s', 'split over lines', 'concurrent each', 'sequential', 'not written']);
    expect(parsed.tests.map(test => test.todo)).toEqual([false, false, false, false, false, false, false, false, true]);
    expect(parsed.titles.map(title => title.text)).toEqual([...parsed.tests.map(test => test.name), 'suite %s', 'split suite']);
  });

  it('does not count a one-argument call that only builds a curried test', () => {
    const parsed = parseTestFile('forms.test.ts', "it.each([1, 2]);\nit.skipIf(true);\ndescribe.each([1]);");
    expect(parsed.tests).toEqual([]);
    expect(parsed.titles).toEqual([]);
  });
});

describe('parseTestFile assertions and matchers', () => {
  it('counts expect.soft and expect.poll but not expect.assertions', () => {
    const source = [
      "it('a', async () => {",
      '  expect.assertions(2);',
      '  expect.soft(a).toBe(1);',
      '  await expect.poll(() => b).toBe(2);',
      '  expect.soft(c).not.toBeNull();',
      '});',
    ].join('\n');
    const parsed = parseTestFile('a.test.ts', source);
    expect(parsed.assertions).toBe(3);
    expect(parsed.tests[0]?.assertions).toBe(3);
  });

  it('recognises every snapshot matcher', () => {
    const matchers = ['toMatchSnapshot', 'toMatchInlineSnapshot', 'toMatchFileSnapshot', 'toThrowErrorMatchingSnapshot', 'toThrowErrorMatchingInlineSnapshot'];
    const source = `it('a', () => {\n${matchers.map(matcher => `  expect(x).${matcher}();`).join('\n')}\n});`;
    expect(parseTestFile('a.test.ts', source).snapshotAssertions).toBe(matchers.length);
  });

  it('recognises every mock matcher, old and new', () => {
    const matchers = [
      'toHaveBeenCalled',
      'toHaveBeenCalledWith',
      'toHaveBeenCalledTimes',
      'toHaveBeenLastCalledWith',
      'toHaveBeenNthCalledWith',
      'toBeCalled',
      'toBeCalledWith',
      'toBeCalledTimes',
      'toHaveReturned',
      'toHaveReturnedWith',
      'toHaveReturnedTimes',
      'toHaveBeenCalledOnce',
      'toHaveBeenCalledExactlyOnceWith',
      'toHaveLastReturnedWith',
      'toHaveNthReturnedWith',
      'toHaveResolved',
      'toHaveResolvedWith',
      'toHaveLastResolvedWith',
      'toHaveNthResolvedWith',
      'toHaveResolvedTimes',
      'lastCalledWith',
      'nthCalledWith',
    ];
    const source = `it('a', () => {\n${matchers.map(matcher => `  expect(x).${matcher}();`).join('\n')}\n});`;
    expect(parseTestFile('a.test.ts', source).mockAssertions).toBe(matchers.length);
  });

  it('does not count ordinary matchers as mock or snapshot assertions', () => {
    const parsed = parseTestFile('a.test.ts', "it('a', () => {\n  expect(x).toBe(1);\n  expect(x).toHaveLength(1);\n});");
    expect([parsed.mockAssertions, parsed.snapshotAssertions]).toEqual([0, 0]);
  });
});

describe('parseTestFile tautologies', () => {
  const count = (body: string): number => parseTestFile('a.test.ts', `it('a', () => {\n${body}\n});`).tautologies;

  it('flags a direct comparison of an expression with itself', () => {
    expect(count('expect(true).toBe(true);')).toBe(1);
    expect(count('expect(value).toEqual(value);')).toBe(1);
  });

  it('does not flag a negated or resolved comparison', () => {
    expect(count('expect(value).not.toBe(value);')).toBe(0);
    expect(count('await expect(value).resolves.toBe(value);')).toBe(0);
  });

  it('does not flag a repeated call, which is a determinism check', () => {
    expect(count("expect(hash('a')).toBe(hash('a'));")).toBe(0);
  });
});

describe('parseTestFile session', () => {
  it('parses a thousand and more distinct files in one session, across its restart', { timeout: 60_000 }, () => {
    const session = openParseSession();
    try {
      for (let i = 0; i < 1200; i++) {
        const parsed = session.parse(`f${i}.test.ts`, `import { x${i} } from './x${i}.ts';\nit('t${i}', () => {\n  expect(x${i}).toBe(${i});\n});\n`);
        expect(parsed.imports).toEqual([`./x${i}.ts`]);
        expect(parsed.tests.map(test => [test.name, test.line, test.assertions])).toEqual([[`t${i}`, 2, 1]]);
      }
    } finally {
      session.close();
    }
  });
});

describe('parseTags', () => {
  it('ignores an unknown lane', () => {
    expect(parseTags('/** @lane nightly */')).toEqual({});
  });

  it('reads tags from every leading comment, line or block', () => {
    expect(parseTags('\n// @lane edit\n/* @risk high */\n\nimport x from "y";')).toEqual({ lane: 'edit', risk: 'high' });
  });

  it('ignores tag-like text outside the leading comments', () => {
    expect(parseTags("import x from 'y';\nconst note = 'contact @risk critical';\n")).toEqual({});
    expect(parseTags("/** @lane merge */\nimport x from 'y';\n// @risk critical\n")).toEqual({ lane: 'merge' });
  });

  it('collects every @subject path', () => {
    expect(parseTags('/**\n * @subject src/cli.ts\n * @subject scripts/run-managed.js\n */')).toEqual({ subjects: ['src/cli.ts', 'scripts/run-managed.js'] });
  });
});

describe('parseTestFile on JSX and plain JavaScript', () => {
  it('parses a .jsx test without throwing', () => {
    const parsed = parseTestFile('a.test.jsx', "it('renders', () => { expect(<div />).toBeTruthy(); });");
    expect(parsed.tests).toHaveLength(1);
  });

  it('parses a .mjs test', () => {
    expect(parseTestFile('a.test.mjs', "import { test } from 'node:test';\ntest('x', () => {});").tests).toHaveLength(1);
  });
});

describe('resolveSubjects', () => {
  it('resolves relative imports to repo-relative source files, mapping .js to .ts', () => {
    const root = makeTree({ 'src/store.ts': '', 'src/legacy/format.ts': '', 'tests/store.test.ts': '' });
    expect(resolveSubjects(root, 'tests/store.test.ts', ['vitest', '../src/store.ts', '../src/legacy/format.js'])).toEqual(['src/legacy/format.ts', 'src/store.ts']);
  });

  it('resolves a directory import to its index file', () => {
    const root = makeTree({ 'src/store/index.ts': '', 'tests/a.test.ts': '' });
    expect(resolveSubjects(root, 'tests/a.test.ts', ['../src/store'])).toEqual(['src/store/index.ts']);
  });

  it('maps .mjs and .cjs imports to .mts and .cts sources and finds an index.mts', () => {
    const root = makeTree({ 'src/esm.mts': '', 'src/x.cts': '', 'src/lib/index.mts': '', 'tests/a.test.ts': '' });
    expect(resolveSubjects(root, 'tests/a.test.ts', ['../src/esm.mjs', '../src/x.cjs', '../src/lib'])).toEqual(['src/esm.mts', 'src/lib/index.mts', 'src/x.cts']);
  });

  it('never treats a non-code file as a subject', () => {
    const root = makeTree({ 'src/data.json': '{}', 'src/style.css': '', 'tests/a.test.ts': '' });
    expect(resolveSubjects(root, 'tests/a.test.ts', ['../src/data.json', '../src/style.css'])).toEqual([]);
  });

  it('skips test files, helpers and unresolved paths', () => {
    const root = makeTree({ 'src/a.test.ts': '', 'tests/helpers/tree.ts': '', 'tests/a.test.ts': '' });
    expect(resolveSubjects(root, 'tests/a.test.ts', ['../src/a.test.ts', './helpers/tree.ts', './missing.ts'])).toEqual([]);
  });
});

describe('declaredSubjects', () => {
  const tree = () => makeTree({ 'src/x.ts': '', 'src/y.sql': '', 'tests/b.test.ts': '', 'tests/helpers/tree.ts': '' });

  it('normalises ./ and .. segments and dedupes', () => {
    expect(declaredSubjects(tree(), ['./src/x.ts', 'src/x.ts', 'src/../src/x.ts'])).toEqual(['src/x.ts']);
  });

  it('accepts the backslash form', () => {
    expect(declaredSubjects(tree(), ['src\\x.ts'])).toEqual(['src/x.ts']);
  });

  it('allows a non-code file such as a SQL migration, and sorts', () => {
    expect(declaredSubjects(tree(), ['src/y.sql', 'src/x.ts'])).toEqual(['src/x.ts', 'src/y.sql']);
  });

  it('drops paths outside the root, directories, test files, helpers and missing files', () => {
    const outside = makeTree({ 'x.ts': '' });
    expect(declaredSubjects(tree(), ['../../x', '../x.ts', join(outside, 'x.ts'), 'src', 'tests/b.test.ts', 'tests/helpers/tree.ts', 'src/missing.ts'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/parse.test.ts`

Expected: FAIL. The helper and the test cannot import `../src/parse.ts`.

- [ ] **Step 3: Implement**

Create `src/parse.ts`:

```ts
import { existsSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { SyntaxKind, type CallExpression, type ImportDeclaration, type Node, type PropertyAccessExpression, type SourceFile } from 'typescript/unstable/ast';
import { isCallExpression, isIdentifier, isImportDeclaration, isNamedImports, isNoSubstitutionTemplateLiteral, isPropertyAccessExpression, isStringLiteral, isTaggedTemplateExpression } from 'typescript/unstable/ast/is';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { API } from 'typescript/unstable/sync';
import { isSupportPath, isTestPath } from './discover.ts';
import { relPosix } from './paths.ts';
import type { LaneName } from './schema.ts';

export interface ParsedTest {
  name: string;
  line: number;
  assertions: number;
  todo: boolean;
}

export interface ParsedFile {
  imports: string[];
  tests: ParsedTest[];
  /** Every describe and it/test title, for marker detection. */
  titles: Array<{ text: string; line: number }>;
  assertions: number;
  snapshotAssertions: number;
  mockAssertions: number;
  mockCalls: number;
  tautologies: number;
  /** `@subject` lists code the test reaches without importing it, such as a CLI run in a subprocess. */
  tags: { lane?: LaneName; risk?: string; subjects?: string[] };
}

/**
 * One native TypeScript process that parses many files. The child process does not keep Node alive and is killed
 * when Node exits, but call close() anyway: it releases the process and its memory early, which matters in a
 * long-lived process or when many sessions are opened.
 */
export interface ParseSession {
  parse(fileName: string, text: string): ParsedFile;
  close(): void;
}

const TEST_CALLEE = /^(?:it|test)(?:\.(?:only|skip|todo|concurrent|sequential|fails|skipIf|runIf|each|for))*$/;
const SUITE_CALLEE = /^describe(?:\.(?:only|skip|todo|concurrent|sequential|each|for|skipIf|runIf))*$/;
const MOCK_CALLEE = /^(?:vi|jest)\.(?:mock|doMock|fn|spyOn)$/;
/** `expect(x)`, `expect.soft(x)` and `expect.poll(fn)` start an assertion; `expect.assertions(n)` does not. */
const EXPECT_CALLEE = /^expect(?:\.(?:soft|poll))?$/;
const SNAPSHOT_MATCHER = /^(?:toMatch(?:Inline|File)?Snapshot|toThrowErrorMatching(?:Inline)?Snapshot)$/;
const MOCK_MATCHER = /^(?:toHaveBeen(?:Last|Nth)?Called(?:Once|With|Times|ExactlyOnceWith)?|toBeCalled(?:With|Times)?|toHave(?:Last|Nth)?(?:Returned|Resolved)(?:With|Times)?|lastCalledWith|nthCalledWith)$/;
const IDENTITY_MATCHER = /^(?:toBe|toEqual|toStrictEqual)$/;
/** Whitespace, block comments and line comments at the start of a file: the only place tags are read from. */
const LEADING_COMMENTS = /^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*)*/;
const LANES: readonly LaneName[] = ['edit', 'merge', 'scheduled', 'release'];

/** Parse only: no type information, no module resolution, no default library. */
const COMPILER_OPTIONS = { allowJs: true, noResolve: true, noLib: true, types: [], jsx: 'preserve' };

export function parseTags(text: string): ParsedFile['tags'] {
  const head = LEADING_COMMENTS.exec(text)?.[0] ?? '';
  const tags: ParsedFile['tags'] = {};
  const lane = head.match(/@lane\s+([a-z]+)/)?.[1];
  if (lane && (LANES as readonly string[]).includes(lane)) tags.lane = lane as LaneName;
  const risk = head.match(/@risk\s+([A-Za-z][\w-]*)/)?.[1];
  if (risk) tags.risk = risk;
  const subjects = [...head.matchAll(/@subject\s+(\S+)/g)].map(match => match[1]);
  if (subjects.length > 0) tags.subjects = subjects;
  return tags;
}

function titleOf(call: CallExpression): string {
  const first = call.arguments[0];
  if (first && (isStringLiteral(first) || isNoSubstitutionTemplateLiteral(first))) return first.text;
  return first ? first.getText() : '<dynamic>';
}

/**
 * The dotted name a call goes through, ignoring whitespace, line breaks and the arguments of curried calls:
 * `it\n  .skip`, `it.each(table)` and ``it.each`a | b` `` all name `it.skip` or `it.each`.
 */
function calleeName(node: Node): string {
  if (isIdentifier(node)) return node.text;
  if (isPropertyAccessExpression(node)) return `${calleeName(node.expression)}.${node.name.text}`;
  if (isCallExpression(node)) return calleeName(node.expression);
  if (isTaggedTemplateExpression(node)) return calleeName(node.tag);
  return node.getText().replace(/\s+/g, '');
}

/**
 * A test or suite declaration has a title and a body. In the curried forms `it.each(table)('name', fn)` and
 * `it.skipIf(cond)('name', fn)` the inner call has one argument, so only the outer call counts.
 */
function isDeclaration(call: CallExpression, name: string): boolean {
  return call.arguments.length >= 2 || (call.arguments.length === 1 && name.endsWith('.todo'));
}

/** The expect(...) call at the root of `expect(x).not.toBe(y)` style chains, or null. */
function expectRoot(callee: PropertyAccessExpression): CallExpression | null {
  let node: Node = callee.expression;
  while (isPropertyAccessExpression(node)) node = node.expression;
  if (isCallExpression(node) && EXPECT_CALLEE.test(calleeName(node.expression))) return node;
  return null;
}

/** `import type { X }` and `import { type X }` bring in no runtime code, so the module is not exercised. */
function isTypeOnlyImport(node: ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.phaseModifier === SyntaxKind.TypeKeyword) return true;
  const named = clause.namedBindings;
  return !clause.name && !!named && isNamedImports(named) && named.elements.length > 0 && named.elements.every(element => element.isTypeOnly);
}

function lineIndex(text: string): (position: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return position => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= position) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

function extractFacts(sourceFile: SourceFile, text: string): ParsedFile {
  const out: ParsedFile = {
    imports: [],
    tests: [],
    titles: [],
    assertions: 0,
    snapshotAssertions: 0,
    mockAssertions: 0,
    mockCalls: 0,
    tautologies: 0,
    tags: parseTags(text),
  };
  const lineAt = lineIndex(text);
  const lineOf = (node: Node): number => lineAt(node.getStart());

  const visit = (node: Node, current: ParsedTest | null): void => {
    let next = current;
    if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier) && !isTypeOnlyImport(node)) out.imports.push(node.moduleSpecifier.text);
    if (isCallExpression(node)) {
      const callee = node.expression;
      const name = calleeName(callee);
      // require('x') and import('x') load code; vi.mock('x') and jest.mock('x') do not, so mocked modules are not imports.
      const specifier = node.arguments[0];
      if (specifier && isStringLiteral(specifier) && (callee.kind === SyntaxKind.ImportKeyword || (isIdentifier(callee) && callee.text === 'require'))) {
        out.imports.push(specifier.text);
      }
      if (TEST_CALLEE.test(name) && isDeclaration(node, name)) {
        const title = titleOf(node);
        next = { name: title, line: lineOf(node), assertions: 0, todo: name.endsWith('.todo') };
        out.tests.push(next);
        out.titles.push({ text: title, line: next.line });
      } else if (SUITE_CALLEE.test(name) && isDeclaration(node, name)) {
        out.titles.push({ text: titleOf(node), line: lineOf(node) });
      } else if (MOCK_CALLEE.test(name)) {
        out.mockCalls++;
      } else if (EXPECT_CALLEE.test(name)) {
        out.assertions++;
        if (current) current.assertions++;
      } else if (/^assert(?:\.\w+)?$/.test(name)) {
        out.assertions++;
        if (current) current.assertions++;
      } else if (isPropertyAccessExpression(callee)) {
        const root = expectRoot(callee);
        if (root) {
          const matcher = callee.name.text;
          if (SNAPSHOT_MATCHER.test(matcher)) out.snapshotAssertions++;
          if (MOCK_MATCHER.test(matcher)) out.mockAssertions++;
          // Only `expect(x).toBe(x)` itself: not `.not` or `.resolves`, and not a repeated call such as hash('a'), which checks determinism.
          if (IDENTITY_MATCHER.test(matcher) && isCallExpression(callee.expression) && root.arguments.length === 1 && node.arguments.length === 1) {
            const actual = root.arguments[0].getText();
            if (actual === node.arguments[0].getText() && !actual.includes('(')) out.tautologies++;
          }
        }
      }
    }
    // forEachChild stops early when its callback returns a value, so the callback must not return one.
    node.forEachChild(child => {
      visit(child, next);
    });
  };
  visit(sourceFile, null);
  return out;
}

type VirtualFs = ReturnType<typeof createVirtualFileSystem>;
type WritableFs = VirtualFs & Required<Pick<VirtualFs, 'writeFile' | 'removeFile'>>;

/** The native process is restarted after this many files, so its memory stays bounded without relying on undocumented native cleanup. */
const RESTART_EVERY = 1000;

function startNative(): { fs: WritableFs; api: API } {
  const fs = createVirtualFileSystem({ '/agent-tests/session.json': '{}' });
  if (typeof fs.writeFile !== 'function' || typeof fs.removeFile !== 'function') {
    throw new Error('The TypeScript virtual filesystem no longer offers writeFile and removeFile; src/parse.ts needs updating for this TypeScript version');
  }
  return { fs: fs as WritableFs, api: new API({ cwd: '/agent-tests', fs }) };
}

/**
 * Open a parse session. Files are fed to the TypeScript 7 API through an in-memory filesystem, one tiny project per file.
 * Each file gets its own directory: reusing a path after its project was closed returned the old content. The previous
 * project is closed and its files removed on the next call, so the native side holds one project at a time.
 */
export function openParseSession(): ParseSession {
  let native = startNative();
  let count = 0;
  let previous: { config: string; source: string } | null = null;
  return {
    parse(fileName, rawText) {
      // The native side drops a leading byte order mark from the text but node positions still count it, so drop it here too.
      const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
      if (count >= RESTART_EVERY) {
        native.api.close();
        native = startNative();
        count = 0;
        previous = null;
      }
      const { api, fs } = native;
      const dir = `/agent-tests/${count++}`;
      const base = `source${extname(fileName) || '.ts'}`; // the extension picks TS, TSX, JS or JSX parsing
      const source = `${dir}/${base}`;
      const config = `${dir}/tsconfig.json`;
      fs.writeFile(source, text);
      fs.writeFile(config, JSON.stringify({ compilerOptions: COMPILER_OPTIONS, files: [base] }));
      const stale = previous;
      previous = { config, source };
      const snapshot = api.updateSnapshot({ openProjects: [config], closeProjects: stale ? [stale.config] : [] });
      try {
        const sourceFile = snapshot.getProject(config)?.program.getSourceFile(source);
        if (!sourceFile) throw new Error(`TypeScript could not parse ${fileName}`);
        return extractFacts(sourceFile, text);
      } finally {
        snapshot.dispose();
        if (stale) {
          fs.removeFile(stale.source);
          fs.removeFile(stale.config);
        }
      }
    },
    close() {
      native.api.close();
    },
  };
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const CODE_FILE = /\.[cm]?[jt]sx?$/;

/** Repo-relative non-test source files a test file imports through relative specifiers. */
export function resolveSubjects(root: string, testRel: string, imports: string[]): string[] {
  const dir = dirname(resolve(root, testRel));
  const found = new Set<string>();
  for (const spec of imports) {
    if (!spec.startsWith('.')) continue;
    const base = resolve(dir, spec);
    const stripped = base.replace(/\.[cm]?[jt]sx?$/, '');
    const candidates = [base, ...EXTENSIONS.map(ext => stripped + ext), ...EXTENSIONS.map(ext => resolve(base, `index${ext}`))];
    const hit = candidates.find(candidate => CODE_FILE.test(candidate) && existsSync(candidate) && statSync(candidate).isFile());
    if (!hit) continue;
    const rel = relPosix(root, hit);
    if (rel.startsWith('..') || isTestPath(rel) || isSupportPath(rel)) continue;
    found.add(rel);
  }
  return [...found].sort();
}

const isRegularFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * Repo-relative files a test declares with `@subject`. Paths are normalised (backslashes, `./`, `..` segments) and kept only
 * when they name a regular file inside the root that is neither a test nor test support code. Any file type is allowed,
 * because a SQL migration or a JSON config can be a deliberate subject.
 */
export function declaredSubjects(root: string, declared: string[]): string[] {
  const found = new Set<string>();
  for (const path of declared) {
    const absolute = resolve(root, path.replaceAll('\\', '/'));
    const rel = relPosix(root, absolute);
    if (rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) continue;
    if (!isRegularFile(absolute) || isTestPath(rel) || isSupportPath(rel)) continue;
    found.add(rel);
  }
  return [...found].sort();
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/parse.test.ts`

Expected: PASS, 36 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/parse.ts tests/parse.test.ts tests/helpers/parse.ts
git commit -m "feat: parse test files into assertion, mock, tag and subject facts"
```

---

## Task 8: Shim and worktree detectors

Two pure detectors. Shims flag tests that protect legacy, compat or fallback paths; the scan later annotates them with whether the risk map declares any consumers. Worktree hazards flag fixed ports, absolute paths, shared temp or database paths, reads of `.git`, and writes under the home directory.

**Files:**
- Create: `tests/detectors/shims.test.ts`, `tests/detectors/worktree.test.ts`, `src/detectors/shims.ts`, `src/detectors/worktree.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/detectors/shims.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectShims } from '../../src/detectors/shims.ts';
import { parseTestFile } from '../helpers/parse.ts';

const rules = (findings: Array<{ rule: string }>): string[] => findings.map(finding => finding.rule).sort();

describe('detectShims', () => {
  it('flags legacy, compat and fallback markers in titles, paths and imports', () => {
    const parsed = parseTestFile(
      'tests/legacy/compat.test.ts',
      "import { x } from '../../src/legacy/x.ts';\ndescribe('legacy format', () => { it('falls back to defaults', () => {}); });",
    );
    expect(rules(detectShims('tests/legacy/compat.test.ts', parsed))).toEqual(['shim.legacy-import', 'shim.path-marker', 'shim.title-marker']);
  });

  it('does not flag ordinary names', () => {
    const parsed = parseTestFile('tests/store.test.ts', "describe('store', () => { it('saves a value', () => {}); });");
    expect(detectShims('tests/store.test.ts', parsed)).toEqual([]);
  });
});

describe('detectShims tuning', () => {
  const shims = (file: string, source: string) => detectShims(file, parseTestFile(file, source));
  const evidenceOf = (findings: Array<{ rule: string; evidence?: string }>, rule: string): Array<string | undefined> =>
    findings.filter(finding => finding.rule === rule).map(finding => finding.evidence);
  const titled = (title: string): string => `describe(${JSON.stringify(title)}, () => { it('works', () => {}); });`;

  it('attributes each rule to the title, the path or the import that produced it', () => {
    const found = shims(
      'tests/legacy/compat.test.ts',
      "import { x } from '../../src/legacy/x.ts';\ndescribe('legacy format', () => { it('falls back to defaults', () => {}); });",
    );
    expect(evidenceOf(found, 'shim.title-marker')).toEqual(['legacy format']);
    expect(evidenceOf(found, 'shim.path-marker')).toEqual(['tests/legacy/compat.test.ts']);
    expect(evidenceOf(found, 'shim.legacy-import')).toEqual(['../../src/legacy/x.ts']);
    expect(found.find(finding => finding.rule === 'shim.title-marker')?.line).toBe(2);
  });

  it('matches inflected title markers', () => {
    for (const title of [
      'shim for old runtimes',
      'shims the clock',
      'loads the polyfill',
      'polyfills fetch',
      'deprecated option',
      'deprecates the flag',
      'deprecate the flag',
      'deprecation warning',
      'migrates from v1',
      'migrated from v1',
      'migrating from v1',
      'migration from v1',
      'uses a fallback',
      'uses fallbacks',
      'fall-back path',
      'backwards compatible output',
      'back-compat mode',
      'back-compatibility',
      'compat layer',
      'compatibility layer',
      'old format input',
      'legacy input',
    ]) {
      const found = shims('tests/a.test.ts', titled(title));
      expect(evidenceOf(found, 'shim.title-marker'), title).toEqual([title]);
    }
  });

  it('stays quiet on near misses', () => {
    for (const title of ['incompatible types', 'shimmer effect', 'legacies of the past', 'falls back to the default', 'compatible values']) {
      expect(shims('tests/a.test.ts', titled(title)), title).toEqual([]);
    }
  });

  it('caps title evidence at 160 characters', () => {
    const title = `legacy ${'x'.repeat(300)}`;
    const found = shims('tests/a.test.ts', titled(title));
    expect(evidenceOf(found, 'shim.title-marker')).toEqual([title.slice(0, 160)]);
  });

  it('matches fallback in a path but not look-alike words', () => {
    expect(evidenceOf(shims('tests/fallback/a.test.ts', titled('works')), 'shim.path-marker')).toEqual(['tests/fallback/a.test.ts']);
    expect(shims('tests/incompatible.test.ts', titled('works'))).toEqual([]);
    expect(shims('tests/shimmer.test.ts', titled('works'))).toEqual([]);
    expect(shims('tests/legacies.test.ts', titled('works'))).toEqual([]);
  });

  it('accepts relative and alias import specifiers with a marker segment', () => {
    const source = [
      "import a from './legacy/a.ts';",
      "import b from '@/legacy/b.ts';",
      "import c from '~/compat/c.ts';",
      "import d from '#shims/d.ts';",
      "import e from 'src/deprecated/e.ts';",
      "import f from '../fallback/f.ts';",
    ].join('\n');
    const found = shims('tests/a.test.ts', source);
    expect(evidenceOf(found, 'shim.legacy-import')).toEqual([
      './legacy/a.ts',
      '@/legacy/b.ts',
      '~/compat/c.ts',
      '#shims/d.ts',
      'src/deprecated/e.ts',
      '../fallback/f.ts',
    ]);
    expect(found.every(finding => finding.rule === 'shim.legacy-import')).toBe(true);
  });

  it('excludes ordinary imports and package names with a marker', () => {
    const source = [
      "import a from './store.ts';",
      "import b from '@/store.ts';",
      "import c from 'core-js/shim';",
      "import d from '@babel/polyfill';",
      "import e from 'legacy-package';",
      "import f from 'node:fs';",
    ].join('\n');
    expect(shims('tests/a.test.ts', source)).toEqual([]);
  });

  it('reports a repeated import specifier once', () => {
    const source = "import a from './legacy/a.ts';\nimport b from './legacy/a.ts';\nimport './legacy/a.ts';";
    expect(evidenceOf(shims('tests/a.test.ts', source), 'shim.legacy-import')).toEqual(['./legacy/a.ts']);
  });
});
```

Create `tests/detectors/worktree.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectWorktreeHazards } from '../../src/detectors/worktree.ts';

const rules = (findings: Array<{ rule: string }>): string[] => findings.map(finding => finding.rule).sort();

describe('detectWorktreeHazards', () => {
  const lines = (text: string): string[] => text.split('\n');

  it('flags each hazard once per line', () => {
    const found = detectWorktreeHazards(
      't.test.ts',
      lines(
        [
          "const url = 'http://localhost:3000/x';",
          "const root = 'C:/Users/dev/app';",
          "const log = '/tmp/out.log';",
          "const head = join(cwd, '.git', 'HEAD');",
          'const home = homedir();',
          "const db = 'app.sqlite';",
        ].join('\n'),
      ),
    );
    expect(rules(found)).toEqual([
      'worktree.absolute-path',
      'worktree.dot-git-dir',
      'worktree.fixed-db-file',
      'worktree.fixed-port',
      'worktree.home-dir',
      'worktree.shared-tmp',
    ]);
  });

  it('accepts safe equivalents', () => {
    const found = detectWorktreeHazards(
      't.test.ts',
      lines(["const dir = mkdtempSync(join(tmpdir(), 'x-'));", 'server.listen(0);', "const ignore = '.gitignore';", "const gh = '.github/workflows';"].join('\n')),
    );
    expect(found).toEqual([]);
  });

  it('ignores comment lines', () => {
    expect(detectWorktreeHazards('t.test.ts', ['// uses localhost:3000 in prod', ' * homedir() is shared'])).toEqual([]);
  });
});

describe('detectWorktreeHazards tuning', () => {
  const run = (...text: string[]) => detectWorktreeHazards('t.test.ts', text);

  describe('shared-tmp', () => {
    it('flags a fixed /tmp literal', () => {
      expect(rules(run("const log = '/tmp/server-test.log';"))).toEqual(['worktree.shared-tmp']);
      expect(rules(run('const log = `/tmp/fixed.log`;'))).toEqual(['worktree.shared-tmp']);
    });

    it('accepts per-run unique /tmp paths', () => {
      expect(run("const a = '/tmp/' + id;")).toEqual([]);
      expect(run('const b = `/tmp/${id}`;')).toEqual([]);
      expect(run("const c = '/tmp/' + randomUUID();")).toEqual([]);
    });

    it('accepts a mkdtemp prefix on the previous line or ending in a separator', () => {
      expect(run('const dir = mkdtempSync(', "  join(tmpdir(), 'x-'),", ');')).toEqual([]);
      expect(run('const dir = mkdtempSync(', "  join(tmpdir(), 'x'),", ');')).toEqual([]);
      expect(run("const dir = join(tmpdir(), 'run_');")).toEqual([]);
      expect(run("const dir = join(tmpdir(), 'x-');")).toEqual([]);
    });

    it('still flags a fixed name under tmpdir()', () => {
      expect(rules(run("const dir = join(tmpdir(), 'shared');"))).toEqual(['worktree.shared-tmp']);
    });
  });

  describe('fixed-db-file', () => {
    it('flags a fixed db name case-insensitively', () => {
      expect(rules(run("const db = 'App.SQLite';"))).toEqual(['worktree.fixed-db-file']);
      expect(rules(run("const db = 'data/app.db';"))).toEqual(['worktree.fixed-db-file']);
    });

    it('accepts a db inside a mkdtemp directory, a fixtures path, a bare extension and memory', () => {
      expect(run("const db = join(await mkdtemp(tmp), 'app.sqlite');")).toEqual([]);
      expect(run('const dir = mkdtempSync(prefix);', "const db = join(dir, 'app.sqlite');")).toEqual([]);
      expect(run("const db = 'tests/fixtures/app.sqlite';")).toEqual([]);
      expect(run("expect(extname(file)).toBe('.db');")).toEqual([]);
      expect(run("const db = ':memory:';")).toEqual([]);
    });
  });

  describe('home-dir', () => {
    it('flags reads', () => {
      expect(rules(run('const home = process.env.HOME;'))).toEqual(['worktree.home-dir']);
      expect(rules(run('const home = process.env.USERPROFILE ?? x;'))).toEqual(['worktree.home-dir']);
      expect(rules(run('if (process.env.HOME === x) {}'))).toEqual(['worktree.home-dir']);
      expect(rules(run('const home = homedir();'))).toEqual(['worktree.home-dir']);
    });

    it('accepts assignments and deletes, the isolation fix', () => {
      expect(run('process.env.HOME = tmp;')).toEqual([]);
      expect(run('process.env.USERPROFILE = dir;')).toEqual([]);
      expect(run('delete process.env.HOME;')).toEqual([]);
    });
  });

  describe('fixed-port', () => {
    it('flags compound names, quoted values and bracketed loopback', () => {
      for (const line of [
        'DB_PORT: 5432,',
        'const TEST_PORT = 4000;',
        'defaultPort: 8080,',
        'redisPort: 6379,',
        "process.env.PORT = '3000';",
        "env: { PORT: '3000' },",
        'port: "3000",',
        "const url = 'http://[::1]:3000/x';",
        'server.listen(3000);',
      ]) {
        expect(rules(run(line)), line).toEqual(['worktree.fixed-port']);
      }
    });

    it('accepts port zero, variables, interpolation and look-alike names', () => {
      for (const line of [
        'port: 0,',
        'server.listen(0);',
        'server.listen(PORT);',
        'const url = `http://localhost:${port}/x`;',
        'report: 12345,',
        'passport: 1234,',
        'const viewport = 1280;',
        'import: 12345,',
        "const version = '1.2.3';",
        'timeout: 5000,',
      ]) {
        expect(run(line), line).toEqual([]);
      }
    });
  });

  describe('comments', () => {
    it('ignores block comments, doc comments and trailing comments', () => {
      expect(run('/* localhost:3000 */')).toEqual([]);
      expect(run('/** listen(3000) */')).toEqual([]);
      expect(run('const a = 1; // localhost:3000')).toEqual([]);
      expect(run('const a = 1; /* homedir() */ const b = 2;')).toEqual([]);
    });

    it('ignores the body of a multi-line block even without a leading star', () => {
      expect(run('/*', 'localhost:3000', 'homedir()', '*/')).toEqual([]);
    });

    it('scans code after a block comment ends', () => {
      const found = run('/*', 'note', '*/ homedir()');
      expect(rules(found)).toEqual(['worktree.home-dir']);
      expect(found[0]?.line).toBe(3);
      expect(rules(run('/* c */ const home = homedir();'))).toEqual(['worktree.home-dir']);
    });

    it('does not open a block comment from a slash-star inside a regex literal', () => {
      const found = run("s.replace(/\\/*$/, '');", 'server.listen(3000);', 'const home = homedir();');
      expect(found.map(finding => [finding.rule, finding.line])).toEqual([
        ['worktree.fixed-port', 2],
        ['worktree.home-dir', 3],
      ]);
    });

    it('still skips a genuine multi-line block comment', () => {
      expect(run("s.replace(/\\/*$/, '');", '/* note', 'server.listen(3000);', 'const home = homedir(); */', 'const ok = 1;')).toEqual([]);
    });

    it('does not treat a url or a glob inside a string as a comment', () => {
      expect(rules(run("const url = 'http://localhost:3000/x';"))).toEqual(['worktree.fixed-port']);
      expect(rules(run("const g = 'src/**/*.ts'; const h = homedir();"))).toEqual(['worktree.home-dir']);
      expect(rules(run("const g = 'src/**/*.ts';", 'const h = homedir();'))).toEqual(['worktree.home-dir']);
    });
  });

  describe('other negatives', () => {
    it('accepts .gitattributes, urls containing /home/ and a plain path', () => {
      expect(run("const a = '.gitattributes';")).toEqual([]);
      expect(run("const u = 'https://example.com/home/index';")).toEqual([]);
      expect(run("const p = join(root, 'src', 'a.ts');")).toEqual([]);
    });
  });

  describe('reporting', () => {
    it('reports one-based line numbers', () => {
      const found = run('const a = 1;', 'const b = 2;', 'const home = homedir();');
      expect(found.map(finding => finding.line)).toEqual([3]);
    });

    it('centres the evidence window on the match', () => {
      const line = `const pad = '${'x'.repeat(300)}'; const home = homedir(); const tail = '${'y'.repeat(300)}';`;
      const [finding] = run(line);
      expect(finding?.evidence?.length).toBeLessThanOrEqual(160);
      expect(finding?.evidence).toContain('homedir()');
    });

    it('keeps short evidence whole and trimmed', () => {
      expect(run('    const home = homedir();')[0]?.evidence).toBe('const home = homedir();');
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/detectors/shims.test.ts tests/detectors/worktree.test.ts`

Expected: FAIL. Neither detector module exists.

- [ ] **Step 3: Implement**

Create `src/detectors/shims.ts`:

```ts
import type { ParsedFile } from '../parse.ts';
import type { Finding } from '../schema.ts';

const TITLE_MARKER =
  /\b(?:legacy|back(?:wards?)?[- ]?compat(?:ibility|ible)?|compat(?:ibility)?|deprecat(?:ed|es|e|ion)|fall-?backs?|polyfills?|shims?|migrat(?:e|es|ed|ing|ion) from|old[- ]format)\b/i;
const PATH_MARKER = /(?:^|[/._-])(?:legacy|compat|deprecated|shims?|polyfills?|fallbacks?)(?:[/._-]|$)/i;
/** A specifier is project code, not a package, when it is relative or starts with a common alias. */
const PROJECT_SPECIFIER = /^(?:\.|@\/|~\/|#|src\/)/;
const EVIDENCE_WIDTH = 160;

/** Tests that protect legacy, compatibility or fallback paths. Whether anyone still needs them is the consumers list's call. */
export function detectShims(file: string, parsed: ParsedFile): Finding[] {
  const findings: Finding[] = [];
  for (const title of parsed.titles) {
    if (TITLE_MARKER.test(title.text)) {
      findings.push({
        category: 'shim',
        rule: 'shim.title-marker',
        file,
        line: title.line,
        message: 'Test title names a legacy, compatibility or fallback path. Check that a consumer still needs it.',
        evidence: title.text.slice(0, EVIDENCE_WIDTH),
      });
    }
  }
  if (PATH_MARKER.test(file)) {
    findings.push({
      category: 'shim',
      rule: 'shim.path-marker',
      file,
      message: 'Test file path names a legacy, compatibility or fallback area.',
      evidence: file,
    });
  }
  for (const spec of new Set(parsed.imports)) {
    if (PROJECT_SPECIFIER.test(spec) && PATH_MARKER.test(spec.replace(/^(?:@\/|~\/|#)/, ''))) {
      findings.push({
        category: 'shim',
        rule: 'shim.legacy-import',
        file,
        message: 'Test imports a legacy, compat or shim module.',
        evidence: spec,
      });
    }
  }
  return findings;
}
```

Create `src/detectors/worktree.ts`:

```ts
import type { Finding } from '../schema.ts';

interface Rule {
  rule: string;
  pattern: RegExp;
  message: string;
  /** When this matches the line or the line before it, the rule stays quiet (the fix is already in place). */
  skip?: RegExp;
}

const RULES: Rule[] = [
  {
    rule: 'worktree.fixed-port',
    // A name that is `port` or ends in `_PORT` or `Port` (not report, passport, viewport), a loopback host, or a listen call, then a 4-5 digit literal.
    pattern:
      /(?:\blisten\(\s*|(?:\b(?:port|PORT|Port)|[A-Za-z0-9]Port|_(?:port|PORT))['"`]?\s*(?::|=(?!=))\s*['"`]?|localhost:|127\.0\.0\.1:|0\.0\.0\.0:|\[::1\]:)(\d{4,5})\b/,
    message: 'Hard-coded port: two worktrees running tests at once collide. Use port 0 or a per-run port.',
  },
  {
    rule: 'worktree.absolute-path',
    pattern: /['"`](?:[A-Za-z]:[\\/]|\/(?:Users|home)\/)[^'"`]*['"`]/,
    message: 'Absolute path into one checkout or machine; another worktree resolves elsewhere. Derive paths from the test file or repo root.',
  },
  {
    rule: 'worktree.shared-tmp',
    // A fixed /tmp literal (not `'/tmp/' + id` or a template with ${}), or a fixed name under tmpdir() that is not a mkdtemp prefix ending in - or _.
    pattern: /['"`]\/tmp\/[^'"`$]*['"`](?!\s*\+)|tmpdir\(\)\s*,\s*['"`][^'"`$]+(?<![-_])['"`]\s*\)/,
    skip: /mkdtemp/,
    message: 'Fixed temp path shared by every worktree and every parallel run. Use mkdtemp for a unique directory.',
  },
  {
    rule: 'worktree.dot-git-dir',
    pattern: /['"`/\\]\.git(?:['"`/\\])/,
    message: 'In a linked worktree .git is a file, not a directory. Ask git (rev-parse --git-dir) instead of reading .git directly.',
  },
  {
    rule: 'worktree.home-dir',
    // Reads only: assigning or deleting HOME and USERPROFILE is how a test isolates itself.
    pattern: /\bhomedir\(\)|(?<!delete\s+)process\.env\.(?:HOME|USERPROFILE)\b(?!\s*(?:\?\?|\|\||&&)?=(?!=))/,
    message: 'State under the user home directory is shared by every worktree. Use a per-run temp directory.',
  },
  {
    rule: 'worktree.fixed-db-file',
    // A named database file outside fixtures/, not inside a mkdtemp directory; a bare '.db' extension is not a file name.
    pattern: /['"`](?![^'"`]*fixtures[/\\])[^'"`\s$]*[^'"`\s$/\\.]\.(?:sqlite3?|db)['"`]/i,
    skip: /mkdtemp/,
    message: 'Fixed database file name: concurrent worktrees share or clobber it unless the path is unique per run.',
  },
];

const EVIDENCE_WIDTH = 160;

/**
 * Remove comments from one line, keeping string contents (the hazards live in strings).
 * `inBlock` says a block comment is still open from an earlier line; the result says whether one is open after this line.
 */
function stripComments(line: string, inBlock: boolean): { code: string; inBlock: boolean } {
  let code = '';
  let quote = '';
  let index = 0;
  while (index < line.length) {
    if (inBlock) {
      const end = line.indexOf('*/', index);
      if (end === -1) return { code, inBlock: true };
      index = end + 2;
      inBlock = false;
      code += ' ';
      continue;
    }
    const char = line.charAt(index);
    if (quote) {
      code += char;
      if (char === '\\' && index + 1 < line.length) {
        code += line.charAt(index + 1);
        index += 2;
        continue;
      }
      if (char === quote) quote = '';
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      code += char;
      index += 1;
      continue;
    }
    // A backslash before the slash means this is an escaped slash in a regex literal, not a comment opener.
    if (line.startsWith('/*', index) && line.charAt(index - 1) !== '\\') {
      inBlock = true;
      index += 2;
      continue;
    }
    if (line.startsWith('//', index) && (index === 0 || /\s/.test(line.charAt(index - 1)))) break;
    code += char;
    index += 1;
  }
  return { code, inBlock };
}

/** Up to EVIDENCE_WIDTH characters of the line, centred on the match so a hit far along a long line stays visible. */
function evidenceWindow(code: string, match: RegExpExecArray): string {
  if (code.length <= EVIDENCE_WIDTH) return code;
  const middle = match.index + Math.floor(match[0].length / 2);
  const start = Math.max(0, Math.min(middle - EVIDENCE_WIDTH / 2, code.length - EVIDENCE_WIDTH));
  return code.slice(start, start + EVIDENCE_WIDTH);
}

/** Hazards that make a test pass alone in one checkout and fail beside a second worktree. */
export function detectWorktreeHazards(file: string, lines: string[]): Finding[] {
  const findings: Finding[] = [];
  let inBlock = false;
  let previous = '';
  for (const [index, text] of lines.entries()) {
    const trimmed = text.trim();
    // A doc-comment body line (` * text`) whose opening comment is not among the lines we were given; `*/ code` closes a comment.
    if (!inBlock && /^\*(?:\s|$)/.test(trimmed)) {
      previous = '';
      continue;
    }
    const stripped = stripComments(text, inBlock || trimmed.startsWith('*/'));
    inBlock = stripped.inBlock;
    const code = stripped.code.trim();
    if (code) {
      for (const rule of RULES) {
        if (rule.skip && (rule.skip.test(code) || rule.skip.test(previous))) continue;
        const match = rule.pattern.exec(code);
        if (match) {
          findings.push({ category: 'worktree', rule: rule.rule, file, line: index + 1, message: rule.message, evidence: evidenceWindow(code, match) });
        }
      }
    }
    previous = code;
  }
  return findings;
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/detectors/shims.test.ts tests/detectors/worktree.test.ts`

Expected: PASS, 10 plus 23 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/detectors/shims.ts src/detectors/worktree.ts tests/detectors/shims.test.ts tests/detectors/worktree.test.ts
git commit -m "feat: detect compat-shim tests and worktree-hostile patterns"
```

---

## Task 9: Redundancy detector

Clusters test files that share a subject (only focused tests count: three or fewer imports, or named after the subject), flags a sweep repeated across the suite, and flags duplicate titles over a shared subject. Shared-subject findings collapse to one per file.

**Files:**
- Create: `tests/detectors/redundancy.test.ts`, `src/detectors/redundancy.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/detectors/redundancy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectRedundancy, layerOf } from '../../src/detectors/redundancy.ts';
import { parseTestFile } from '../helpers/parse.ts';

describe('detectRedundancy', () => {
  const file = (rel: string, subjects: string[], text: string) => {
    const parsed = parseTestFile(rel, text);
    return { rel, subjects, parsed, lines: text.split('\n') };
  };

  it('clusters test files that share a subject and records their layers', () => {
    const { clusters } = detectRedundancy([
      file('tests/a.unit.test.ts', ['src/a.ts'], ''),
      file('tests/a.e2e.test.ts', ['src/a.ts'], ''),
      file('tests/b.test.ts', ['src/b.ts'], ''),
    ]);
    expect(clusters).toEqual([{ subject: 'src/a.ts', files: ['tests/a.e2e.test.ts', 'tests/a.unit.test.ts'], layers: ['e2e', 'unit'] }]);
  });

  it('ignores incidental subjects of an unfocused test unless it is named after them', () => {
    const wide = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'];
    const { clusters } = detectRedundancy([
      file('tests/wide.test.ts', wide, ''),
      file('tests/a.test.ts', wide, ''),
      file('tests/a.unit.test.ts', ['src/a.ts'], ''),
      file('tests/other.test.ts', ['src/b.ts'], ''),
    ]);
    expect(clusters.map(cluster => ({ subject: cluster.subject, files: cluster.files }))).toEqual([{ subject: 'src/a.ts', files: ['tests/a.test.ts', 'tests/a.unit.test.ts'] }]);
  });

  it('reports one shared-subject finding per file however many subjects it shares', () => {
    const { findings } = detectRedundancy([file('tests/x.test.ts', ['src/a.ts', 'src/b.ts'], ''), file('tests/y.test.ts', ['src/a.ts', 'src/b.ts'], '')]);
    expect(findings.filter(finding => finding.rule === 'redundancy.shared-subject').map(finding => finding.file)).toEqual(['tests/x.test.ts', 'tests/y.test.ts']);
  });

  it('flags a sweep repeated across files but not a short or unique one', () => {
    const sweep = 'for (let seed = 1; seed <= 30; seed++) {}';
    const { findings } = detectRedundancy([
      file('tests/a.test.ts', ['src/s.ts'], `${sweep}\nfor (let i = 0; i < 3; i++) {}`),
      file('tests/b.test.ts', ['src/s.ts'], sweep),
      file('tests/c.test.ts', ['src/s.ts'], 'for (let seed = 1; seed <= 50; seed++) {}'),
    ]);
    expect(findings.filter(finding => finding.rule === 'redundancy.repeated-sweep').map(finding => finding.file)).toEqual(['tests/a.test.ts', 'tests/b.test.ts']);
  });

  it('flags duplicate titles only when the files share a subject', () => {
    const title = "it('round-trips a saved value through load', () => {});";
    const shared = detectRedundancy([file('tests/a.test.ts', ['src/s.ts'], title), file('tests/b.test.ts', ['src/s.ts'], title)]);
    expect(shared.findings.filter(finding => finding.rule === 'redundancy.duplicate-title')).toHaveLength(2);
    const unrelated = detectRedundancy([file('tests/a.test.ts', ['src/s.ts'], title), file('tests/b.test.ts', ['src/t.ts'], title)]);
    expect(unrelated.findings.filter(finding => finding.rule === 'redundancy.duplicate-title')).toEqual([]);
  });

  it('infers layers from the path', () => {
    expect(layerOf('tests/e2e/login.test.ts')).toBe('e2e');
    expect(layerOf('tests/store.integration.test.ts')).toBe('integration');
    expect(layerOf('tests/api.contract.test.ts')).toBe('contract');
    expect(layerOf('tests/store.test.ts')).toBe('unit');
  });

  it('matches layer words on boundaries only', () => {
    expect(layerOf('tests/integration-helpers/foo.test.ts')).toBe('unit');
    expect(layerOf('tests/disintegration.test.ts')).toBe('unit');
    expect(layerOf('tests/a.integration.test.ts')).toBe('integration');
    expect(layerOf('tests/integration/a.test.ts')).toBe('integration');
    expect(layerOf('tests/integrations/a.test.ts')).toBe('integration');
    expect(layerOf('tests/integration-tests/a.test.ts')).toBe('integration');
    expect(layerOf('tests/store-integration.test.ts')).toBe('integration');
    expect(layerOf('tests/contracts/a.test.ts')).toBe('contract');
    expect(layerOf('tests/subcontract.test.ts')).toBe('unit');
    expect(layerOf('tests/e2e/a.test.ts')).toBe('e2e');
    expect(layerOf('tests/end-to-end/a.test.ts')).toBe('e2e');
  });

  describe('repeated sweeps', () => {
    const sweep = 'for (let seed = 1; seed <= 30; seed++) {}';
    const sweepFindings = (inputs: ReturnType<typeof file>[]) => detectRedundancy(inputs).findings.filter(finding => finding.rule === 'redundancy.repeated-sweep');

    it('ignores the same sweep in files with unrelated subjects', () => {
      expect(sweepFindings([file('tests/a.test.ts', ['src/a.ts'], sweep), file('tests/b.test.ts', ['src/b.ts'], sweep)])).toEqual([]);
    });

    it('ignores generic loop variables however long the loop', () => {
      const generic = 'for (let i = 0; i < 100; i++) {}';
      expect(sweepFindings([file('tests/a.test.ts', ['src/s.ts'], generic), file('tests/b.test.ts', ['src/s.ts'], generic)])).toEqual([]);
    });

    it('flags a seed sweep that appears twice in one file', () => {
      const findings = sweepFindings([file('tests/a.test.ts', [], `${sweep}\n\n${sweep}`)]);
      expect(findings.map(finding => [finding.file, finding.line])).toEqual([['tests/a.test.ts', 1], ['tests/a.test.ts', 3]]);
    });

    it('does not count a commented-out sweep', () => {
      const text = `// ${sweep}\n * ${sweep}`;
      expect(sweepFindings([file('tests/a.test.ts', ['src/s.ts'], text), file('tests/b.test.ts', ['src/s.ts'], sweep)])).toEqual([]);
    });

    it('flags a sweep in two files that share a focused subject, with line numbers', () => {
      const findings = sweepFindings([file('tests/a.test.ts', ['src/s.ts'], `\n\n  ${sweep}`), file('tests/b.test.ts', ['src/s.ts'], `\n${sweep}`)]);
      expect(findings.map(finding => [finding.file, finding.line])).toEqual([['tests/a.test.ts', 3], ['tests/b.test.ts', 2]]);
    });

    it('accepts loop variables that start with a sweep word and rejects look-alikes', () => {
      const counts = (name: string) => {
        const loop = `for (let ${name} = 1; ${name} <= 30; ${name}++) {}`;
        return sweepFindings([file('tests/a.test.ts', ['src/s.ts'], loop), file('tests/b.test.ts', ['src/s.ts'], loop)]).length === 2;
      };
      for (const name of ['seed', 'seedValue', 'trial', 'run', 'caseIndex', 'iteration', 'round2', 'sampleIdx']) expect(counts(name), name).toBe(true);
      for (const name of ['ground', 'around', 'rerun', 'lowercase', 'i', 'index']) expect(counts(name), name).toBe(false);
    });

    it('does not pair files that share only an incidental subject', () => {
      const wide = ['src/s.ts', 'src/x.ts', 'src/y.ts', 'src/z.ts'];
      expect(sweepFindings([file('tests/a.test.ts', ['src/s.ts'], sweep), file('tests/b.test.ts', wide, sweep)])).toEqual([]);
    });
  });

  it('does not flag duplicate titles when the only shared subject is incidental to one file', () => {
    const title = "it('round-trips a saved value through load', () => {});";
    const wide = ['src/s.ts', 'src/x.ts', 'src/y.ts', 'src/z.ts'];
    const { findings } = detectRedundancy([file('tests/a.test.ts', ['src/s.ts'], title), file('tests/b.test.ts', wide, title)]);
    expect(findings.filter(finding => finding.rule === 'redundancy.duplicate-title')).toEqual([]);
  });

  describe('hub subjects', () => {
    const hubFiles = (count: number) => Array.from({ length: count }, (_, index) => file(`tests/t${index}.test.ts`, ['src/helper.ts', `src/m${index}.ts`], ''));

    it('reports one hub finding instead of per-file findings for a subject shared by more than 10 files', () => {
      const { clusters, findings } = detectRedundancy(hubFiles(12));
      expect(findings.filter(finding => finding.rule === 'redundancy.shared-subject')).toEqual([]);
      const hubs = findings.filter(finding => finding.rule === 'redundancy.hub-subject');
      expect(hubs).toHaveLength(1);
      expect(hubs[0]?.file).toBe('src/helper.ts');
      expect(hubs[0]?.message).toContain('12 test files');
      expect(hubs[0]?.message).toContain('shared infrastructure');
      expect(clusters).toHaveLength(1);
      expect(clusters[0]?.subject).toBe('src/helper.ts');
      expect(clusters[0]?.files).toHaveLength(12);
    });

    it('does not let a hub subject drive sweep or title findings', () => {
      const body = "for (let seed = 1; seed <= 30; seed++) {}\nit('round-trips a saved value through load', () => {});";
      const inputs = Array.from({ length: 11 }, (_, index) => file(`tests/t${index}.test.ts`, ['src/helper.ts', `src/m${index}.ts`], body));
      const { findings } = detectRedundancy(inputs);
      expect(findings.filter(finding => finding.rule === 'redundancy.repeated-sweep')).toEqual([]);
      expect(findings.filter(finding => finding.rule === 'redundancy.duplicate-title')).toEqual([]);
      expect(findings.map(finding => finding.rule)).toEqual(['redundancy.hub-subject']);
    });

    it('still reports sweep and title findings for a cluster of exactly 10 files', () => {
      const body = "for (let seed = 1; seed <= 30; seed++) {}\nit('round-trips a saved value through load', () => {});";
      const inputs = Array.from({ length: 10 }, (_, index) => file(`tests/t${index}.test.ts`, ['src/helper.ts', `src/m${index}.ts`], body));
      const { findings } = detectRedundancy(inputs);
      expect(findings.filter(finding => finding.rule === 'redundancy.repeated-sweep')).toHaveLength(10);
      expect(findings.filter(finding => finding.rule === 'redundancy.duplicate-title')).toHaveLength(10);
    });

    it('still counts a sweep repeated inside one file of a hub', () => {
      const inputs = Array.from({ length: 11 }, (_, index) => file(`tests/t${index}.test.ts`, ['src/helper.ts', `src/m${index}.ts`], index === 0 ? 'for (let seed = 1; seed <= 30; seed++) {}\nfor (let seed = 1; seed <= 30; seed++) {}' : ''));
      const sweeps = detectRedundancy(inputs).findings.filter(finding => finding.rule === 'redundancy.repeated-sweep');
      expect(sweeps.map(finding => [finding.file, finding.line])).toEqual([['tests/t0.test.ts', 1], ['tests/t0.test.ts', 2]]);
    });

    it('still reports per-file findings for a cluster of exactly 10 files', () => {
      const { clusters, findings } = detectRedundancy(hubFiles(10));
      expect(findings.filter(finding => finding.rule === 'redundancy.shared-subject')).toHaveLength(10);
      expect(findings.filter(finding => finding.rule === 'redundancy.hub-subject')).toEqual([]);
      expect(clusters).toHaveLength(1);
    });
  });

  describe('focus', () => {
    const shared = (extra: string[]) => ['src/shared.ts', ...extra];

    it('counts a test with three imports as focused', () => {
      const { clusters } = detectRedundancy([file('tests/a.test.ts', shared(['src/x.ts', 'src/y.ts']), ''), file('tests/b.test.ts', shared(['src/p.ts', 'src/q.ts']), '')]);
      expect(clusters.map(cluster => cluster.subject)).toEqual(['src/shared.ts']);
    });

    it('does not count a test with four imports unless it is named after the subject', () => {
      const { clusters } = detectRedundancy([file('tests/a.test.ts', shared(['src/x.ts', 'src/y.ts', 'src/w.ts']), ''), file('tests/b.test.ts', shared(['src/p.ts']), '')]);
      expect(clusters).toEqual([]);
    });

    it('matches the test name to the subject case-insensitively', () => {
      const { clusters } = detectRedundancy([
        file('tests/Store.test.ts', ['src/store.ts', 'src/x.ts', 'src/y.ts', 'src/z.ts'], ''),
        file('tests/store.unit.test.ts', ['src/store.ts'], ''),
      ]);
      expect(clusters.map(cluster => ({ subject: cluster.subject, files: cluster.files }))).toEqual([{ subject: 'src/store.ts', files: ['tests/Store.test.ts', 'tests/store.unit.test.ts'] }]);
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/detectors/redundancy.test.ts`

Expected: FAIL. Cannot import `../../src/detectors/redundancy.ts`.

- [ ] **Step 3: Implement**

Create `src/detectors/redundancy.ts`:

```ts
import type { ParsedFile } from '../parse.ts';
import type { Cluster, Finding } from '../schema.ts';

export interface RedundancyInput {
  rel: string;
  subjects: string[];
  parsed: ParsedFile;
  lines: string[];
}

const SWEEP = /\bfor\s*\(\s*(?:let|const|var)\s+(\w+)\s*=\s*(\d+)\s*;\s*\w+\s*(<=|<)\s*(\d+)\s*;/;
/** A sweep repeats a test over many generated inputs. A loop counter named `i` is just a loop. */
const SWEEP_VARIABLE = /^(?:seed|trial|run|case|sample|iter|round)\w*$/i;
const MIN_SWEEP = 10;
const MIN_TITLE = 12;

const MAX_FOCUSED_SUBJECTS = 3;
/** A subject imported by more than this many test files is shared infrastructure, not duplicated coverage. */
const MAX_CLUSTER = 10;

const stem = (rel: string): string =>
  (rel.split('/').pop() ?? rel)
    .replace(/\.(?:test|spec)\.[cm]?[jt]sx?$/, '')
    .replace(/\.[cm]?[jt]sx?$/, '')
    .replace(/\.(?:unit|integration|e2e|contract)$/, '');

/** A test that imports many modules touches most of them incidentally. It counts for a subject only when it is focused or named after it. */
const isFocused = (file: RedundancyInput, subject: string): boolean => file.subjects.length <= MAX_FOCUSED_SUBJECTS || stem(subject).toLowerCase() === stem(file.rel).toLowerCase();

/** Two test files share a subject only when both are focused on it. A hub is shared infrastructure, so it never counts. */
const sharesFocusedSubject = (a: RedundancyInput, b: RedundancyInput, hubs: ReadonlySet<string>): boolean =>
  a.subjects.some(subject => !hubs.has(subject) && b.subjects.includes(subject) && isFocused(a, subject) && isFocused(b, subject));

export function layerOf(rel: string): string {
  if (/(?:^|[/._-])(?:e2e|end-to-end)(?:[/._-]|$)/i.test(rel)) return 'e2e';
  // A hyphen after the word does not end it: `integration-helpers/` is support code, but `integration-tests/` is the layer.
  if (/(?:^|[/._-])integrations?(?:-tests?)?(?:[/._]|$)/i.test(rel)) return 'integration';
  if (/(?:^|[/._-])contracts?(?:[/._-]|$)/i.test(rel)) return 'contract';
  return 'unit';
}

/** Clusters of test files exercising one subject, repeated seed sweeps, and duplicate titles over a shared subject. */
export function detectRedundancy(files: RedundancyInput[]): { clusters: Cluster[]; findings: Finding[] } {
  const findings: Finding[] = [];

  const bySubject = new Map<string, string[]>();
  for (const file of files) {
    for (const subject of file.subjects) {
      if (isFocused(file, subject)) bySubject.set(subject, [...(bySubject.get(subject) ?? []), file.rel]);
    }
  }
  const hubSubjects = new Set([...bySubject].filter(([, members]) => members.length > MAX_CLUSTER).map(([subject]) => subject));
  const clusters: Cluster[] = [];
  const sharedBy = new Map<string, string[]>();
  const hubs: Array<{ subject: string; files: string[] }> = [];
  for (const [subject, members] of [...bySubject].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (members.length < 2) continue;
    const sorted = [...members].sort();
    clusters.push({ subject, files: sorted, layers: [...new Set(sorted.map(layerOf))].sort() });
    if (sorted.length > MAX_CLUSTER) {
      hubs.push({ subject, files: sorted });
      continue;
    }
    for (const member of sorted) {
      sharedBy.set(member, [...(sharedBy.get(member) ?? []), `${subject}: ${sorted.filter(other => other !== member).join(', ')}`]);
    }
  }
  for (const [file, shared] of [...sharedBy].sort(([a], [b]) => (a < b ? -1 : 1))) {
    findings.push({
      category: 'redundancy',
      rule: 'redundancy.shared-subject',
      file,
      message: `This file shares ${shared.length} subject${shared.length === 1 ? '' : 's'} with other test files. Check whether they assert the same behavior.`,
      evidence: shared.join('; ').slice(0, 300),
    });
  }
  for (const hub of hubs) {
    findings.push({
      category: 'redundancy',
      rule: 'redundancy.hub-subject',
      file: hub.subject,
      message: `${hub.files.length} test files import this module. It looks like shared infrastructure rather than duplicated coverage. Check each file's own assertions if you suspect duplication.`,
      evidence: hub.files.slice(0, 5).join('; '),
    });
  }

  const sweeps = new Map<string, Array<{ input: RedundancyInput; line: number; text: string }>>();
  for (const file of files) {
    file.lines.forEach((text, index) => {
      const trimmed = text.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;
      const match = SWEEP.exec(text);
      if (!match || !SWEEP_VARIABLE.test(match[1] ?? '')) return;
      const start = Number(match[2]);
      const end = Number(match[4]);
      if (end - start + (match[3] === '<=' ? 1 : 0) < MIN_SWEEP) return;
      const key = `${start}${match[3]}${end}`;
      sweeps.set(key, [...(sweeps.get(key) ?? []), { input: file, line: index + 1, text: trimmed }]);
    });
  }
  for (const [key, spots] of sweeps) {
    // A location counts only with a partner in the same file or in a test file that shares a focused subject.
    const related = spots.filter(spot => spots.some(other => other !== spot && (other.input === spot.input || sharesFocusedSubject(spot.input, other.input, hubSubjects))));
    if (related.length < 2) continue;
    for (const spot of related) {
      findings.push({
        category: 'redundancy',
        rule: 'redundancy.repeated-sweep',
        file: spot.input.rel,
        line: spot.line,
        message: `The same sweep (${key}) appears ${related.length} times in the suite. Share the work or keep one owner.`,
        evidence: spot.text.slice(0, 160),
      });
    }
  }

  const byTitle = new Map<string, Array<{ file: RedundancyInput; line: number; text: string }>>();
  for (const file of files) {
    for (const title of file.parsed.tests.map(test => ({ text: test.name, line: test.line }))) {
      if (title.text.length < MIN_TITLE) continue;
      const key = title.text.toLowerCase();
      byTitle.set(key, [...(byTitle.get(key) ?? []), { file, line: title.line, text: title.text }]);
    }
  }
  for (const spots of byTitle.values()) {
    for (const spot of spots) {
      const sharesSubject = spots.some(other => other.file !== spot.file && sharesFocusedSubject(spot.file, other.file, hubSubjects));
      if (!sharesSubject) continue;
      findings.push({
        category: 'redundancy',
        rule: 'redundancy.duplicate-title',
        file: spot.file.rel,
        line: spot.line,
        message: 'Another test file with the same subject has a test with this title.',
        evidence: spot.text,
      });
    }
  }
  return { clusters, findings };
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/detectors/redundancy.test.ts`

Expected: PASS, 23 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/detectors/redundancy.ts tests/detectors/redundancy.test.ts
git commit -m "feat: detect shared subjects, repeated sweeps and duplicate titles"
```

---

## Task 10: Frequency detector

Reads hooks, `package.json` scripts, GitHub workflows and agent instruction files for places the suite runs too often: an unscoped suite in a hook, a `test` script that can start watch mode, CI on every branch push, a pull-request workflow that runs Windows or macOS, an OS matrix on an automatic trigger, and "run all tests" instructions. A scheduled, manual or tag-only workflow, a path-filtered trigger, and a Linux-only `pull_request` job (the recommended non-blocking check) are accepted.

**Files:**
- Create: `tests/detectors/frequency.test.ts`, `src/detectors/frequency.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/detectors/frequency.test.ts`:

````ts
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectFrequency } from '../../src/detectors/frequency.ts';
import { defaultRiskMap } from '../../src/riskmap.ts';
import { makeTree } from '../helpers/tree.ts';

const rules = (findings: Array<{ rule: string }>): string[] => findings.map(finding => finding.rule).sort();

describe('detectFrequency', () => {
  it('flags an unscoped suite run in a git hook but not a scoped one', () => {
    const root = makeTree({ '.husky/pre-commit': 'npm test\n', '.husky/pre-push': 'npx vitest related --run\n' });
    const found = detectFrequency(root, null);
    expect(found.map(finding => `${finding.rule}@${finding.file}`)).toEqual(['frequency.hook-full-suite@.husky/pre-commit']);
  });

  it('flags a bare vitest test script as watch mode and a pretest that runs tests', () => {
    const root = makeTree({ 'package.json': JSON.stringify({ scripts: { test: 'vitest', pretest: 'vitest run' } }) });
    expect(rules(detectFrequency(root, null))).toEqual(['frequency.hook-full-suite', 'frequency.watch-default']);
  });

  it('accepts vitest run', () => {
    const root = makeTree({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) });
    expect(detectFrequency(root, null)).toEqual([]);
  });

  it('flags automatic CI triggers and expensive OS matrices, but not manual or scheduled ones', () => {
    const automatic = makeTree({
      '.github/workflows/ci.yml': 'on:\n  push:\n    branches: [main]\njobs:\n  t:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, macos-latest]\n    runs-on: ${{ matrix.os }}\n    steps: []\n',
    });
    expect(rules(detectFrequency(automatic, null))).toEqual(['frequency.ci-on-push', 'frequency.ci-os-matrix-on-push']);
    const manual = makeTree({ '.github/workflows/ci.yml': "on:\n  workflow_dispatch:\n  schedule:\n    - cron: '0 6 * * 1'\njobs: {}\n" });
    expect(detectFrequency(manual, null)).toEqual([]);
  });

  it('accepts a single Linux job on pull_request, the recommended non-blocking check', () => {
    const root = makeTree({ '.github/workflows/ci.yml': 'on:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: []\n' });
    expect(detectFrequency(root, null)).toEqual([]);
  });

  it('flags a pull_request workflow that runs on Windows or macOS', () => {
    const literal = makeTree({ '.github/workflows/ci.yml': 'on:\n  pull_request:\njobs:\n  test:\n    runs-on: macos-latest\n    steps: []\n' });
    expect(rules(detectFrequency(literal, null))).toEqual(['frequency.ci-on-pull-request']);
    const matrix = makeTree({
      '.github/workflows/ci.yml': 'on:\n  pull_request:\njobs:\n  t:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, windows-latest]\n    runs-on: ${{ matrix.os }}\n    steps: []\n',
    });
    expect(rules(detectFrequency(matrix, null))).toEqual(['frequency.ci-on-pull-request', 'frequency.ci-os-matrix-on-push']);
  });

  it('accepts a path-filtered pull_request trigger', () => {
    const root = makeTree({ '.github/workflows/ci.yml': "on:\n  pull_request:\n    paths: ['src/**']\njobs: {}\n" });
    expect(detectFrequency(root, null)).toEqual([]);
  });

  it('accepts a tag-only push trigger as a release run, but not a branch push', () => {
    const tagsOnly = makeTree({ '.github/workflows/ci.yml': "on:\n  push:\n    tags: ['v*']\njobs: {}\n" });
    expect(detectFrequency(tagsOnly, null)).toEqual([]);
    const both = makeTree({ '.github/workflows/ci.yml': "on:\n  push:\n    branches: [main]\n    tags: ['v*']\njobs: {}\n" });
    expect(rules(detectFrequency(both, null))).toEqual(['frequency.ci-on-push']);
  });

  it('allows an OS matrix on a release-tag workflow', () => {
    const root = makeTree({
      '.github/workflows/ci.yml': "on:\n  push:\n    tags: ['v*']\njobs:\n  t:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, windows-latest, macos-latest]\n    runs-on: ${{ matrix.os }}\n    steps: []\n",
    });
    expect(detectFrequency(root, null)).toEqual([]);
  });

  it('adds dev-phase advice to CI findings', () => {
    const root = makeTree({ '.github/workflows/ci.yml': 'on: push\njobs: {}\n' });
    expect(detectFrequency(root, defaultRiskMap())[0]?.message).toContain('workflow_dispatch');
  });

  it('flags agent instructions that say to run every test', () => {
    const root = makeTree({ 'AGENTS.md': 'Be brief.\nAlways run all tests after every change.\n' });
    expect(detectFrequency(root, null).map(finding => `${finding.rule}:${finding.line}`)).toEqual(['frequency.agent-run-all:2']);
  });
});

const WF = '.github/workflows/ci.yml';
const workflow = (text: string): string => makeTree({ [WF]: text });
const scriptsTree = (scripts: Record<string, unknown>): string => makeTree({ 'package.json': JSON.stringify({ scripts }) });
const watchRules = (script: unknown): string[] => rules(detectFrequency(scriptsTree({ test: script }), null)).filter(rule => rule === 'frequency.watch-default');

describe('detectFrequency on odd input', () => {
  it.each([
    ['a directory named AGENTS.md', { 'AGENTS.md/x': '' }],
    ['a directory named CLAUDE.md', { 'CLAUDE.md/x': '' }],
    ['a directory named package.json', { 'package.json/x': '' }],
    ['a directory named like a hook file', { '.husky/pre-commit/x': '' }],
    ['a directory named like a lefthook file', { 'lefthook.yml/x': '' }],
    ['.github/workflows being a file', { '.github/workflows': 'not a directory' }],
    ['a directory named x.yml', { '.github/workflows/x.yml/inner': '' }],
    ['an invalid package.json', { 'package.json': '{not json' }],
    ['a package.json holding null', { 'package.json': 'null' }],
    ['a package.json whose scripts is a string', { 'package.json': '{"scripts": "vitest"}' }],
    ['a workflow that is not valid YAML', { [WF]: 'on: [push\njobs: {' }],
    ['a workflow that is a scalar', { [WF]: 'just text\n' }],
    ['a workflow whose jobs is a list', { [WF]: 'on: push\njobs:\n  - a\n  - b\n' }],
    ['a workflow whose job is null', { [WF]: 'on: pull_request\njobs:\n  a:\n' }],
    ['a workflow whose matrix is a string', { [WF]: 'on: pull_request\njobs:\n  a:\n    strategy:\n      matrix: ${{ fromJson(x) }}\n    runs-on: ubuntu-latest\n' }],
  ])('does not throw on %s', (_label, files) => {
    expect(() => detectFrequency(makeTree(files), null)).not.toThrow();
  });

  it('reports nothing for a non-string test script', () => {
    expect(detectFrequency(scriptsTree({ test: 5 }), null)).toEqual([]);
    expect(detectFrequency(scriptsTree({ test: ['vitest'] }), null)).toEqual([]);
    expect(detectFrequency(scriptsTree({ pretest: 5 }), null)).toEqual([]);
    expect(detectFrequency(scriptsTree({ pretest: { run: 'npm test' } }), null)).toEqual([]);
  });

  it('does not throw on a dangling symlink where a file is expected', () => {
    const root = makeTree({});
    try {
      symlinkSync(join(root, 'nowhere'), join(root, 'AGENTS.md'));
    } catch {
      return; // Creating symlinks needs a privilege this machine does not grant.
    }
    expect(() => detectFrequency(root, null)).not.toThrow();
  });
});

describe('detectFrequency agent instructions', () => {
  const agentFindings = (line: string, file = 'AGENTS.md'): string[] => detectFrequency(makeTree({ [file]: `${line}\n` }), null).map(finding => finding.rule);

  it.each([
    'Always run all tests after every change.',
    'Run the whole test suite after each edit',
    'Execute every test before you answer.',
    'Always run the tests.',
  ])('flags %s', line => {
    expect(agentFindings(line)).toEqual(['frequency.agent-run-all']);
  });

  it.each([
    'Do not run all tests after every change.',
    'Never run the full suite.',
    "Don't always run all tests.",
    'Agents should not run every test.',
    'Avoid running all tests when one file changed. Only run all tests in CI.',
    'Always run tests that cover the changed file.',
    'Always run tests related to the change.',
    'Always run tests for the module you touched.',
    'Always run affected tests.',
    'Run all tests before opening a PR.',
    'Run the full test suite before merge.',
    'Run all tests before pushing.',
    'Run every test once before you merge.',
  ])('does not flag %s', line => {
    expect(agentFindings(line)).toEqual([]);
  });

  it('does not flag a line inside a fenced code block', () => {
    const text = 'Use this:\n```sh\nalways run all tests after every change\n```\n~~~\nrun all tests\n~~~\n';
    expect(detectFrequency(makeTree({ 'AGENTS.md': text }), null)).toEqual([]);
    const after = detectFrequency(makeTree({ 'AGENTS.md': `${text}Always run all tests after every change.\n` }), null);
    expect(after.map(finding => finding.line)).toEqual([8]);
  });

  it.each(['GEMINI.md', '.github/copilot-instructions.md', '.cursorrules', 'CLAUDE.md'])('scans %s', file => {
    const found = detectFrequency(makeTree({ [file]: 'Always run all tests after every change.\n' }), null);
    expect(found.map(finding => `${finding.rule}@${finding.file}`)).toEqual([`frequency.agent-run-all@${file}`]);
  });
});

describe('detectFrequency workflows', () => {
  it('ignores a job that its if condition keeps off pull requests', () => {
    const nightly = workflow("on:\n  pull_request:\njobs:\n  nightly:\n    if: github.event_name == 'schedule'\n    runs-on: windows-latest\n    steps: []\n");
    expect(detectFrequency(nightly, null)).toEqual([]);
    const dispatch = workflow("on:\n  pull_request:\njobs:\n  manual:\n    if: github.event_name == 'workflow_dispatch'\n    runs-on: macos-latest\n    steps: []\n");
    expect(detectFrequency(dispatch, null)).toEqual([]);
    const counted = workflow("on:\n  pull_request:\njobs:\n  t:\n    if: github.event_name == 'pull_request'\n    runs-on: macos-latest\n    steps: []\n");
    expect(rules(detectFrequency(counted, null))).toContain('frequency.ci-on-pull-request');
  });

  it('still counts a pull-request-excluded job against a branch push', () => {
    const root = workflow("on:\n  push:\n    branches: [dev]\njobs:\n  t:\n    if: github.event_name == 'push'\n    strategy:\n      matrix:\n        os: [windows-latest]\n    runs-on: ${{ matrix.os }}\n    steps: []\n");
    expect(rules(detectFrequency(root, null))).toEqual(['frequency.ci-on-push', 'frequency.ci-os-matrix-on-push']);
  });

  it.each([
    ['a matrix os string', 'strategy:\n      matrix:\n        os: windows-latest\n    runs-on: ${{ matrix.os }}', true],
    ['matrix include entries', 'strategy:\n      matrix:\n        include:\n          - os: ubuntu-latest\n          - os: macos-14\n    runs-on: ${{ matrix.os }}', true],
    ['a runs-on string', 'runs-on: windows-2022', false],
    ['a runs-on array', 'runs-on: [macos-latest]', false],
    ['a runs-on object with labels', 'runs-on:\n      group: big\n      labels: windows-latest', false],
    ['a runs-on object with a label list', 'runs-on:\n      labels: [macos-latest]', false],
  ])('finds expensive runners in %s', (_label, jobBody, isMatrix) => {
    const root = workflow(`on:\n  pull_request:\njobs:\n  t:\n    ${jobBody}\n    steps: []\n`);
    expect(rules(detectFrequency(root, null))).toEqual(isMatrix ? ['frequency.ci-on-pull-request', 'frequency.ci-os-matrix-on-push'] : ['frequency.ci-on-pull-request']);
  });

  it('ignores self-hosted runners', () => {
    const labelled = workflow('on:\n  pull_request:\njobs:\n  t:\n    runs-on: [self-hosted, macos]\n    steps: []\n');
    expect(detectFrequency(labelled, null)).toEqual([]);
    const withMatrix = workflow('on:\n  pull_request:\njobs:\n  t:\n    strategy:\n      matrix:\n        os: [macos-latest]\n    runs-on: [self-hosted, "${{ matrix.os }}"]\n    steps: []\n');
    expect(detectFrequency(withMatrix, null)).toEqual([]);
    const object = workflow('on:\n  pull_request:\njobs:\n  t:\n    runs-on:\n      labels: [self-hosted, windows]\n    steps: []\n');
    expect(detectFrequency(object, null)).toEqual([]);
  });

  it('does not let a path filter excuse Windows or macOS on pull_request', () => {
    const windows = workflow("on:\n  pull_request:\n    paths: ['src/**']\njobs:\n  t:\n    runs-on: windows-latest\n    steps: []\n");
    const found = detectFrequency(windows, null);
    expect(rules(found)).toEqual(['frequency.ci-on-pull-request']);
    expect(found.find(finding => finding.rule === 'frequency.ci-on-pull-request')?.message).not.toContain('no path filter');
    const linux = workflow("on:\n  pull_request:\n    paths-ignore: ['docs/**']\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps: []\n");
    expect(detectFrequency(linux, null)).toEqual([]);
  });

  it('reports Windows or macOS on a path-filtered push, and the matrix rule only for a real matrix', () => {
    const literal = workflow("on:\n  push:\n    paths: ['src/**']\njobs:\n  t:\n    runs-on: macos-latest\n    steps: []\n");
    expect(rules(detectFrequency(literal, null))).toEqual(['frequency.ci-on-push']);
    const matrix = workflow("on:\n  push:\n    paths: ['src/**']\njobs:\n  t:\n    strategy:\n      matrix:\n        os: [macos-latest]\n    runs-on: ${{ matrix.os }}\n    steps: []\n");
    expect(rules(detectFrequency(matrix, null))).toEqual(['frequency.ci-on-push', 'frequency.ci-os-matrix-on-push']);
    const linux = workflow("on:\n  push:\n    paths: ['src/**']\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps: []\n");
    expect(detectFrequency(linux, null)).toEqual([]);
  });

  it('reports each matrix finding once when push and pull_request both fire', () => {
    const root = workflow('on:\n  push:\n    branches: [dev]\n  pull_request:\njobs:\n  t:\n    strategy:\n      matrix:\n        os: [windows-latest]\n    runs-on: ${{ matrix.os }}\n    steps: []\n');
    expect(rules(detectFrequency(root, null))).toEqual(['frequency.ci-on-pull-request', 'frequency.ci-on-push', 'frequency.ci-os-matrix-on-push']);
  });

  it('describes a push restricted to the default branch as a post-merge run', () => {
    const root = workflow('on:\n  push:\n    branches: [main]\n  pull_request:\njobs: {}\n');
    const message = detectFrequency(root, null)[0]?.message ?? '';
    expect(message).toContain('post-merge');
    expect(message).toContain('already ran on the same tree');
    const master = workflow('on:\n  push:\n    branches: [master]\njobs: {}\n');
    expect(detectFrequency(master, null)[0]?.message).toContain('post-merge');
    const other = workflow('on:\n  push:\n    branches: [main, dev]\njobs: {}\n');
    expect(detectFrequency(other, null)[0]?.message).toContain('every push to a branch');
    const bare = workflow('on: push\njobs: {}\n');
    expect(detectFrequency(bare, null)[0]?.message).toContain('every push to a branch');
  });

  it('does not treat tags with branches-ignore as tag-only', () => {
    const root = workflow("on:\n  push:\n    tags: ['v*']\n    branches-ignore: [wip]\njobs: {}\n");
    expect(rules(detectFrequency(root, null))).toEqual(['frequency.ci-on-push']);
  });

  it('gives the whole dev-phase recommendation', () => {
    const message = detectFrequency(workflow('on: push\njobs: {}\n'), defaultRiskMap())[0]?.message ?? '';
    for (const part of ['non-blocking Linux job', 'path-filtered', 'drafts skipped', 'newer runs cancelled', 'workflow_dispatch', 'weekly schedule', 'release tags']) {
      expect(message).toContain(part);
    }
  });
});

describe('detectFrequency hooks', () => {
  const hookRules = (files: Record<string, string>): string[] => detectFrequency(makeTree(files), null).map(finding => `${finding.rule}@${finding.file}`);

  it('ignores trailing comments and lines that only echo', () => {
    expect(hookRules({ '.husky/pre-commit': '#!/usr/bin/env sh\necho "skipping npm test"\nnpx prettier --check . # npm test\nprintf "vitest\\n"\n' })).toEqual([]);
    expect(hookRules({ '.husky/pre-commit': 'echo start && npm test\n' })).toEqual(['frequency.hook-full-suite@.husky/pre-commit']);
  });

  it.each([
    'npx vitest run $FILES',
    'npx vitest run "$@"',
    'npx jest --findRelatedTests {staged_files}',
    'npx vitest run {push_files}',
    'pnpm test --filter=...[HEAD^]',
  ])('treats %s as scoped', command => {
    expect(hookRules({ '.husky/pre-commit': `${command}\n` })).toEqual([]);
  });

  it('reads only the run values of a lefthook file', () => {
    const scoped = 'pre-commit:\n  commands:\n    jest:\n      run: npx jest --findRelatedTests {staged_files}\n    vitest:\n      glob: "*.ts"\n      run: npx vitest related --run {staged_files}\n';
    expect(hookRules({ 'lefthook.yml': scoped })).toEqual([]);
    const full = 'pre-commit:\n  commands:\n    unit:\n      run: npm test\n';
    const found = detectFrequency(makeTree({ 'lefthook.yml': full }), null);
    expect(found.map(finding => `${finding.rule}@${finding.file}:${finding.line}`)).toEqual(['frequency.hook-full-suite@lefthook.yml:4']);
    const block = 'pre-push:\n  jobs:\n    - name: t\n      run: |\n        echo hi\n        npm test\n';
    expect(detectFrequency(makeTree({ 'lefthook.yml': block }), null).map(finding => finding.line)).toEqual([6]);
  });

  it.each(['lefthook.yaml', '.lefthook.yml', '.config/lefthook.yml'])('scans %s', file => {
    expect(hookRules({ [file]: 'pre-commit:\n  commands:\n    t:\n      run: npm test\n' })).toEqual([`frequency.hook-full-suite@${file}`]);
  });

  it('scans .husky/pre-merge-commit', () => {
    expect(hookRules({ '.husky/pre-merge-commit': 'npm test\n' })).toEqual(['frequency.hook-full-suite@.husky/pre-merge-commit']);
  });

  it('scans simple-git-hooks values in package.json', () => {
    const flagged = JSON.stringify({ 'simple-git-hooks': { 'pre-commit': 'npm test' } });
    expect(hookRules({ 'package.json': flagged })).toEqual(['frequency.hook-full-suite@package.json']);
    const scoped = JSON.stringify({ 'simple-git-hooks': { 'pre-commit': 'npx vitest related --run', 'pre-push': 5 } });
    expect(hookRules({ 'package.json': scoped })).toEqual([]);
  });

  it.each(['npm t', 'pnpm -r test', 'pnpm --filter x test', 'npm run -s test', 'yarn test', 'bun run test'])('recognises %s as a suite run', command => {
    expect(hookRules({ '.husky/pre-commit': `${command}\n` })).toEqual(['frequency.hook-full-suite@.husky/pre-commit']);
  });

  it('does not take npm tsc or npm run lint for a suite run', () => {
    expect(hookRules({ '.husky/pre-commit': 'npm run lint\nnpm tsc\n' })).toEqual([]);
  });
});

describe('detectFrequency watch mode', () => {
  it.each([
    'vitest',
    'npx vitest',
    'pnpm vitest',
    'pnpm exec vitest',
    'yarn vitest',
    'cross-env NODE_ENV=test vitest',
    'vitest --coverage',
    'vitest --watch',
    'vitest --watch=true',
    'vitest dev',
    'jest --watch',
    'jest --watchAll',
    'npm run lint && vitest',
  ])('flags %s', script => {
    expect(watchRules(script)).toEqual(['frequency.watch-default']);
  });

  it.each([
    'vitest run',
    'vitest --run',
    'vitest --watch=false',
    'vitest --watch false',
    'jest --watchAll=false',
    'jest --watch=false',
    'vitest --no-watch',
    'vitest list',
    'vitest typecheck',
    'vitest bench',
    'vitest related src/a.ts',
    'CI=1 vitest',
    'cross-env CI=1 vitest',
    'jest',
    'npm run build',
    'tsc --noEmit && vitest run',
  ])('does not flag %s', script => {
    expect(watchRules(script)).toEqual([]);
  });

  it('words the finding without over-claiming', () => {
    const message = detectFrequency(scriptsTree({ test: 'vitest' }), null)[0]?.message ?? '';
    expect(message).toContain('stdin is a terminal');
    expect(message).toContain('CI is unset');
    expect(message).toContain('vitest run');
  });
});

describe('detectFrequency fixtures', () => {
  const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

  it('finds each planted problem in the bloated fixture exactly once', () => {
    const found = detectFrequency(fixture('bloated'), null).map(finding => `${finding.rule}@${finding.file}`);
    expect(found.sort()).toEqual(
      [
        'frequency.agent-run-all@AGENTS.md',
        'frequency.ci-on-pull-request@.github/workflows/ci.yml',
        'frequency.ci-on-push@.github/workflows/ci.yml',
        'frequency.ci-os-matrix-on-push@.github/workflows/ci.yml',
        'frequency.hook-full-suite@.husky/pre-commit',
        'frequency.hook-full-suite@package.json',
        'frequency.watch-default@package.json',
      ].sort(),
    );
  });

  it('finds nothing in the clean fixture', () => {
    expect(detectFrequency(fixture('clean'), null)).toEqual([]);
  });
});

describe('detectFrequency job if-gates', () => {
  const RECOMMENDED = `on:
  pull_request:
    paths: ['src/**', 'package.json']
  workflow_dispatch:
  schedule:
    - cron: '0 6 * * 1'
  push:
    tags: ['v*']
concurrency:
  group: ci-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  linux:
    if: github.event_name != 'pull_request' || !github.event.pull_request.draft
    runs-on: ubuntu-latest
    steps: []
  os-matrix:
    if: github.event_name != 'pull_request'
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest]
    runs-on: \${{ matrix.os }}
    steps: []
`;

  const macJob = (condition: string | null): string => {
    const gate = condition === null ? '' : `    if: ${condition}\n`;
    return `on:\n  pull_request:\njobs:\n  t:\n${gate}    runs-on: macos-latest\n    steps: []\n`;
  };

  it('accepts the recommended workflow without findings', () => {
    expect(detectFrequency(workflow(RECOMMENDED), null)).toEqual([]);
    expect(detectFrequency(workflow(RECOMMENDED), defaultRiskMap())).toEqual([]);
  });

  it.each([
    "github.event_name != 'pull_request'",
    'github.event_name != "pull_request"',
    "github.event_name!='pull_request'",
    "${{ github.event_name != 'pull_request' }}",
    "github.event_name == 'push'",
    "github.event_name == 'schedule'",
    'github.event_name == "workflow_dispatch"',
    "github.event_name == 'push' || github.event_name == 'schedule'",
  ])('treats a macOS job gated by %s as off the pull-request path', condition => {
    expect(detectFrequency(workflow(macJob(condition)), null)).toEqual([]);
  });

  it.each([
    ['no if at all', null],
    ['a positive pull_request check', "github.event_name == 'pull_request'"],
    ['a condition that ignores the event name', "github.ref == 'refs/heads/main'"],
    ['a draft clause beside a negation', "github.event_name != 'pull_request' || !github.event.pull_request.draft"],
  ])('treats a macOS job with %s as running on pull requests', (_label, condition) => {
    expect(rules(detectFrequency(workflow(macJob(condition)), null))).toEqual(['frequency.ci-on-pull-request']);
  });
});

describe('detectFrequency matrix rule', () => {
  it('fires only for a real matrix, never for a literal runs-on', () => {
    const literal = workflow('on:\n  push:\n    branches: [dev]\njobs:\n  t:\n    runs-on: macos-latest\n    steps: []\n');
    expect(rules(detectFrequency(literal, null))).toEqual(['frequency.ci-on-push']);
    const matrix = workflow('on:\n  push:\n    branches: [dev]\njobs:\n  t:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, macos-latest]\n    runs-on: ${{ matrix.os }}\n    steps: []\n');
    expect(rules(detectFrequency(matrix, null))).toEqual(['frequency.ci-on-push', 'frequency.ci-os-matrix-on-push']);
  });
});

describe('detectFrequency tag-gated and dispatch-gated jobs', () => {
  const macJob = (condition: string): string => `on:\n  pull_request:\njobs:\n  t:\n    if: ${condition}\n    runs-on: macos-latest\n    steps: []\n`;

  it.each([
    "startsWith(github.ref, 'refs/tags/')",
    'startsWith(github.ref, "refs/tags/v")',
    "github.ref_type == 'tag'",
    "github.event_name == 'release'",
    "github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/')",
    "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
    "inputs.full == 'true'",
    "github.event.inputs.os == 'mac'",
    "github.event_name == 'workflow_dispatch' || inputs.full",
    "${{ startsWith(github.ref, 'refs/tags/') && github.event_name == 'push' }}",
  ])('treats a macOS job gated by %s as off the pull-request path', condition => {
    expect(detectFrequency(workflow(macJob(condition)), null)).toEqual([]);
  });

  it.each([
    "startsWith(github.ref, 'refs/heads/')",
    "github.ref == 'refs/heads/main'",
    "github.ref_type != 'tag'",
    "${{ !startsWith(github.ref, 'refs/tags/') }}",
    "github.event_name == 'release' || github.ref == 'refs/heads/main'",
  ])('still flags a macOS job gated by %s', condition => {
    expect(rules(detectFrequency(workflow(macJob(condition)), null))).toEqual(['frequency.ci-on-pull-request']);
  });

  it('keeps the draft-skip Linux job on the pull-request path without findings', () => {
    const root = workflow("on:\n  pull_request:\njobs:\n  linux:\n    if: github.event_name != 'pull_request' || !github.event.pull_request.draft\n    runs-on: ubuntu-latest\n    steps: []\n");
    expect(detectFrequency(root, null)).toEqual([]);
  });
});

describe('detectFrequency test tools at command position', () => {
  const hookRules = (hook: string): string[] => detectFrequency(makeTree({ '.husky/pre-commit': `${hook}\n` }), null).map(finding => finding.rule);

  it.each(['node scripts/vitest.config.js', 'cat jest.config.js', 'npx eslint --plugin jest src', 'node scripts/run-jest-helper.js', 'git diff -- vitest.config.ts', 'grep -r pytest docs'])(
    'does not count %s as running the suite',
    command => {
      expect(hookRules(command)).toEqual([]);
    },
  );

  it.each([
    'npm test',
    'npm run test',
    'pnpm test',
    'vitest run',
    'jest',
    'pytest',
    'npx vitest run',
    'npx --no-install jest',
    'pnpm exec vitest run',
    'yarn jest',
    'bunx vitest run',
    'CI=1 jest',
    'cross-env NODE_ENV=test jest',
    'cross-env NODE_ENV=test npm test',
    'echo start && jest',
    'npm run lint; pytest',
    'python -m pytest',
    './node_modules/.bin/vitest run',
  ])('counts %s as running the suite', command => {
    expect(hookRules(command)).toEqual(['frequency.hook-full-suite']);
  });

  it('does not count vitest.config as a tool even at command position', () => {
    expect(hookRules('vitest.config.js')).toEqual([]);
  });
});

describe('detectFrequency hook line continuations', () => {
  it('joins a backslash continuation so a scope flag on the next line counts', () => {
    expect(detectFrequency(makeTree({ '.husky/pre-commit': 'npx vitest run \\\n  --changed origin/main\n' }), null)).toEqual([]);
  });

  it('reports the first physical line of a continued unscoped command', () => {
    const found = detectFrequency(makeTree({ '.husky/pre-push': 'echo hi\nnpx vitest run \\\n  --reporter dot\n' }), null);
    expect(found.map(finding => `${finding.rule}:${finding.line}`)).toEqual(['frequency.hook-full-suite:2']);
  });

  it('joins continuations inside a lefthook block scalar too', () => {
    const text = 'pre-push:\n  jobs:\n    - run: |\n        npx jest \\\n          --findRelatedTests {push_files}\n';
    expect(detectFrequency(makeTree({ 'lefthook.yml': text }), null)).toEqual([]);
  });
});
````

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/detectors/frequency.test.ts`

Expected: FAIL. Cannot import `../../src/detectors/frequency.ts`.

- [ ] **Step 3: Implement**

Create `src/detectors/frequency.ts`:

````ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Finding, RiskMap } from '../schema.ts';

const PM_TEST = /^(?:npm|pnpm|yarn|bun)\s+(?:(?:run|-r|--recursive|-s|--silent|--if-present|--filter(?:=|\s+)\S+|-F\s+\S+)\s+)*(?:test|t)\b/;
const TEST_TOOLS = new Set(['vitest', 'jest', 'pytest']);
const TOOL_WRAPPERS = new Set(['cross-env', 'env', 'npx', 'pnpm', 'exec', 'yarn', 'bunx', 'bun', 'npm', 'run', 'dlx', 'x', 'uv', 'poetry', 'pipenv', 'then', 'do', 'else', 'time', 'nohup']);
const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=/;
const SCOPED = /--changed|--related|\brelated\b|--findRelatedTests|--onlyChanged|--affected|\baffected\b|\{staged_files\}|\{push_files\}|\$\{?FILES\b|\$@|\[HEAD/;
const HOOK_FILES = ['.husky/pre-commit', '.husky/pre-push', '.husky/pre-merge-commit', '.githooks/pre-commit', '.githooks/pre-push'];
const LEFTHOOK_FILES = ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.config/lefthook.yml'];
const HOOK_SCRIPTS = ['pretest', 'precommit', 'pre-commit', 'prepush', 'pre-push'];
const AGENT_DOCS = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md', '.cursorrules'];
const AGENT_RUN_ALL =
  /\b(?:run|execute)\s+(?:all|every|the\s+(?:full|entire|whole))\s+(?:test\s+suites?|tests?|suites?)\b|\balways\s+run\s+(?:the\s+)?tests?\b(?!\s+(?:that|related|affected|covering|for)\b)/gi;
const AGENT_NEGATION = /\bnot\b|n['’]t\b|\bnever\b|\bavoid\b|\bonly\b/i;
const AGENT_MERGE_GATE = /^(?:\s+\w+){0,2}\s*,?\s*(?:before|prior\s+to)\s+(?:you\s+)?(?:opening|open|creating|create|raising|submitting|merg\w*|push\w*|a\s+pr\b|the\s+pr\b|a\s+pull|releas\w*|shipping)/i;
const EXPENSIVE_OS = /^(?:macos|windows)/i;
const NOT_WATCH_COMMANDS = new Set(['run', 'related', 'bench', 'list', 'typecheck', 'init']);
const LAUNCHERS = new Set(['cross-env', 'env', 'npx', 'pnpm', 'exec', 'yarn', 'bunx', 'bun', 'npm', 'run', 'dlx', 'x']);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).filter((entry): entry is string => typeof entry === 'string');

/** The text of a regular file, or null when it is missing, a directory, unreadable or otherwise odd. */
function readText(path: string): string | null {
  try {
    return statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

function phaseAdvice(map: RiskMap | null): string {
  if (!map) return '';
  if (map.phase === 'dev') {
    return ' In the dev phase, prefer one non-blocking Linux job on pull_request (path-filtered, drafts skipped, newer runs cancelled), and workflow_dispatch, a weekly schedule and release tags for the OS matrix.';
  }
  return '';
}

function triggersOf(workflow: Record<string, unknown>): Record<string, unknown> {
  const on = workflow.on ?? workflow['true'];
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map(name => [String(name), null]));
  if (isRecord(on)) return on;
  return {};
}

/** True when one command starts a test run: a package-manager test script, or a test tool at command position. */
function runsTestTool(part: string): boolean {
  const tokens = part.split(/\s+/).filter(Boolean);
  let position = 0;
  while (position < tokens.length && (ENV_ASSIGNMENT.test(tokens[position] ?? '') || tokens[position] === 'cross-env' || tokens[position] === 'env')) position++;
  if (PM_TEST.test(tokens.slice(position).join(' '))) return true;
  while (position < tokens.length) {
    const token = tokens[position] ?? '';
    if (!TOOL_WRAPPERS.has(token) && !token.startsWith('-') && !ENV_ASSIGNMENT.test(token)) break;
    position++;
  }
  const name = (value: string | undefined): string => (value ?? '').replace(/^.*[\\/]/, '').replace(/\.cmd$/, '');
  const command = name(tokens[position]);
  return TEST_TOOLS.has(/^(?:python3?|py)$/.test(command) && tokens[position + 1] === '-m' ? name(tokens[position + 2]) : command);
}

/** True when a hook command runs the whole suite: any `&&`, `||` or `;` part that runs tests, is not scoped and is not an echo. */
function runsWholeSuite(raw: string): boolean {
  const line = raw.replace(/(^|\s)#.*$/, '$1');
  return line.split(/&&|\|\||;/).some(part => {
    const command = part.trim();
    return command !== '' && !/^(?:echo|printf)\b/.test(command) && runsTestTool(command) && !SCOPED.test(command);
  });
}

/** Join lines that end in a backslash with the next one; each result keeps the number of its first physical line. */
function joinContinuations(entries: Array<{ line: number; command: string }>): Array<{ line: number; command: string }> {
  const joined: Array<{ line: number; command: string }> = [];
  let carry: { line: number; command: string; last: number } | null = null;
  for (const entry of entries) {
    if (carry && entry.line !== carry.last + 1) {
      joined.push({ line: carry.line, command: carry.command });
      carry = null;
    }
    const merged: { line: number; command: string; last: number } = carry
      ? { line: carry.line, command: `${carry.command} ${entry.command.trim()}`, last: entry.line }
      : { line: entry.line, command: entry.command, last: entry.line };
    if (/\\\s*$/.test(merged.command)) {
      carry = { ...merged, command: merged.command.replace(/\\\s*$/, '') };
    } else {
      joined.push({ line: merged.line, command: merged.command });
      carry = null;
    }
  }
  if (carry) joined.push({ line: carry.line, command: carry.command });
  return joined;
}

/** The `run:` values of a lefthook file, with their line numbers; a block scalar yields one entry per line. */
function lefthookCommands(text: string): Array<{ line: number; command: string }> {
  const lines = text.split(/\r?\n/);
  const found: Array<{ line: number; command: string }> = [];
  for (let index = 0; index < lines.length; index++) {
    const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[index] ?? '');
    if (!match) continue;
    const indent = (match[1] ?? '').length;
    const value = (match[2] ?? '').trim();
    if (/^[|>][+-]?\s*(?:#.*)?$/.test(value)) {
      for (let next = index + 1; next < lines.length; next++) {
        const body = lines[next] ?? '';
        if (body.trim() !== '' && (/^\s*/.exec(body)?.[0].length ?? 0) <= indent) break;
        found.push({ line: next + 1, command: body });
        index = next;
      }
    } else {
      found.push({ line: index + 1, command: /^(["'])(.*)\1\s*(?:#.*)?$/.exec(value)?.[2] ?? value });
    }
  }
  return found;
}

/** True when one command of a test script starts the runner in watch mode when nothing says otherwise. */
function startsWatchMode(segment: string): boolean {
  const tokens = segment.split(/\s+/).filter(Boolean);
  let watchOn = false;
  let watchOff = false;
  tokens.forEach((token, index) => {
    const flag = /^--(?:watch|watchAll)(?:=(.*))?$/.exec(token);
    if (flag) {
      const next = tokens[index + 1];
      const value = flag[1] ?? (next === 'true' || next === 'false' ? next : 'true');
      if (value === 'false') watchOff = true;
      else watchOn = true;
    } else if (token === '--no-watch') {
      watchOff = true;
    }
  });
  if (watchOn) return true;
  if (watchOff) return false;

  let position = 0;
  let ciSet = false;
  for (; position < tokens.length; position++) {
    const token = tokens[position] ?? '';
    const assignment = /^([A-Za-z_]\w*)=(.*)$/.exec(token);
    if (assignment) {
      if (assignment[1] === 'CI' && assignment[2] !== 'false') ciSet = true;
    } else if (!LAUNCHERS.has(token) && !token.startsWith('-')) {
      break;
    }
  }
  const command = (tokens[position] ?? '').replace(/^.*[\\/]/, '').replace(/\.cmd$/, '');
  if (command !== 'vitest' || ciSet) return false;
  return !tokens.slice(position + 1).some(token => NOT_WATCH_COMMANDS.has(token) || /^--run(?:=true)?$/.test(token));
}

/**
 * Windows or macOS runners a job uses: `all` covers a literal `runs-on`, `matrix.os` and `matrix.include`;
 * `matrix` is the part that comes from a real matrix. Self-hosted jobs are ignored.
 */
function expensiveRunnersOf(job: Record<string, unknown>): { all: string[]; matrix: string[] } {
  const runsOn = job['runs-on'];
  const labels = isRecord(runsOn) ? asStrings(runsOn.labels) : asStrings(runsOn);
  if (labels.some(label => /^self-hosted$/i.test(label))) return { all: [], matrix: [] };
  const strategy = isRecord(job.strategy) ? job.strategy : {};
  const matrix = isRecord(strategy.matrix) ? strategy.matrix : {};
  const include = Array.isArray(matrix.include) ? matrix.include.flatMap(entry => (isRecord(entry) ? asStrings(entry.os) : [])) : [];
  const expensive = (entries: string[]): string[] => [...new Set(entries.filter(entry => EXPENSIVE_OS.test(entry)))];
  return { all: expensive([...asStrings(matrix.os), ...include, ...labels]), matrix: expensive([...asStrings(matrix.os), ...include]) };
}

/** Condition fragments that cannot hold on a pull request: another event, a tag ref, or a dispatch input. */
const NOT_PULL_REQUEST = [
  /github\.event_name\s*(?:!=\s*['"]pull_request['"]|==\s*['"](?:push|schedule|workflow_dispatch|release)['"])/,
  /(?<!!\s*)startsWith\(\s*github\.ref\s*,\s*['"]refs\/tags\//,
  /github\.ref_type\s*==\s*['"]tag['"]/,
  /\binputs\./,
];

/**
 * False when a job's `if:` keeps it off pull requests: it has no positive `github.event_name == 'pull_request'` and
 * every `||` clause of it holds only for another event, a tag ref or a dispatch input. A clause that says
 * nothing of those (a draft check, a branch ref) can still hold on a pull request.
 */
function runsOnPullRequest(job: Record<string, unknown>): boolean {
  const condition = job.if;
  if (typeof condition !== 'string') return true;
  if (/github\.event_name\s*==\s*['"]pull_request['"]/.test(condition)) return true;
  return condition.split('||').some(clause => !NOT_PULL_REQUEST.some(marker => marker.test(clause)));
}

/** Where and how often the suite runs: hooks, watch mode, CI triggers and OS matrices, and agent instructions. */
export function detectFrequency(root: string, map: RiskMap | null): Finding[] {
  const findings: Finding[] = [];

  const addHookFinding = (file: string, line: number | undefined, evidence: string): void => {
    findings.push({
      category: 'frequency',
      rule: 'frequency.hook-full-suite',
      file,
      ...(line === undefined ? {} : { line }),
      message: 'A git hook runs the whole suite on every commit or push. Run only affected tests, or move the full run to a slower lane.',
      evidence: evidence.trim().slice(0, 160),
    });
  };

  for (const hook of HOOK_FILES) {
    const text = readText(join(root, hook));
    if (text === null) continue;
    for (const { line, command } of joinContinuations(text.split(/\r?\n/).map((command, index) => ({ line: index + 1, command })))) {
      if (runsWholeSuite(command)) addHookFinding(hook, line, command);
    }
  }
  for (const hook of LEFTHOOK_FILES) {
    const text = readText(join(root, hook));
    if (text === null) continue;
    for (const { line, command } of joinContinuations(lefthookCommands(text))) {
      if (runsWholeSuite(command)) addHookFinding(hook, line, command);
    }
  }

  const pkgText = readText(join(root, 'package.json'));
  if (pkgText !== null) {
    let pkg: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(pkgText);
      if (isRecord(parsed)) pkg = parsed;
    } catch {
      // Unreadable package.json: nothing to report here.
    }
    const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
    for (const name of HOOK_SCRIPTS) {
      const script = scripts[name];
      if (typeof script === 'string' && runsWholeSuite(script)) {
        findings.push({
          category: 'frequency',
          rule: 'frequency.hook-full-suite',
          file: 'package.json',
          message: `The ${name} script runs the whole suite automatically.`,
          evidence: `${name}: ${script}`.slice(0, 160),
        });
      }
    }
    const simpleGitHooks = isRecord(pkg['simple-git-hooks']) ? pkg['simple-git-hooks'] : {};
    for (const [name, command] of Object.entries(simpleGitHooks)) {
      if (typeof command === 'string' && runsWholeSuite(command)) addHookFinding('package.json', undefined, `${name}: ${command}`);
    }
    const testScript = scripts.test;
    if (typeof testScript === 'string' && testScript.split(/&&|\|\||;/).some(segment => startsWatchMode(segment.trim()))) {
      findings.push({
        category: 'frequency',
        rule: 'frequency.watch-default',
        file: 'package.json',
        message:
          'The test script starts watch mode when stdin is a terminal and CI is unset, so an interactive session can wait on it. Make it a single run: `vitest run` (jest without --watch).',
        evidence: `test: ${testScript}`.slice(0, 160),
      });
    }
  }

  const workflowDir = join(root, '.github', 'workflows');
  let workflowNames: string[] = [];
  try {
    workflowNames = readdirSync(workflowDir).filter(entry => /\.ya?ml$/.test(entry)).sort();
  } catch {
    // No workflows directory, or not a directory: nothing to report here.
  }
  for (const name of workflowNames) {
    const file = `.github/workflows/${name}`;
    const text = readText(join(workflowDir, name));
    if (text === null) continue;
    let workflow: unknown;
    try {
      workflow = parse(text);
    } catch {
      continue;
    }
    if (!isRecord(workflow)) continue;
    const triggers = triggersOf(workflow);
    const jobs = (isRecord(workflow.jobs) ? Object.values(workflow.jobs) : []).filter(isRecord).map(job => ({ ...expensiveRunnersOf(job), onPullRequest: runsOnPullRequest(job) }));
    const reportedMatrix = new Set<number>();
    const reportMatrix = (applies: (job: { onPullRequest: boolean }) => boolean): void => {
      jobs.forEach((job, index) => {
        if (job.matrix.length === 0 || reportedMatrix.has(index) || !applies(job)) return;
        reportedMatrix.add(index);
        findings.push({
          category: 'frequency',
          rule: 'frequency.ci-os-matrix-on-push',
          file,
          message: 'An automatic workflow fans out to Windows or macOS runners, which bill at a higher rate than Linux.',
          evidence: `matrix.os: ${job.matrix.join(', ')}`,
        });
      });
    };

    if ('push' in triggers) {
      const config = triggers.push;
      const has = (key: string): boolean => isRecord(config) && key in config;
      // A tag-only push trigger is a release-lane run, not a run on every push.
      const tagOnly = has('tags') && !has('branches') && !has('branches-ignore');
      if (!tagOnly) {
        const pushRunners = [...new Set(jobs.flatMap(job => job.all))];
        if (has('paths') || has('paths-ignore')) {
          // A path filter excuses Linux but not Windows or macOS.
          if (pushRunners.length > 0) {
            findings.push({
              category: 'frequency',
              rule: 'frequency.ci-on-push',
              file,
              message: `A push-triggered workflow runs on ${pushRunners.join(', ')}, which bills at a higher rate than Linux, and a path filter does not change that. Keep Windows and macOS off the push path.${phaseAdvice(map)}`,
              evidence: 'on: push',
            });
          }
        } else {
          const branches = isRecord(config) ? asStrings(config.branches) : [];
          const defaultBranchOnly = branches.length > 0 && !has('branches-ignore') && branches.every(branch => /^(?:main|master)$/.test(branch));
          findings.push({
            category: 'frequency',
            rule: 'frequency.ci-on-push',
            file,
            message: defaultBranchOnly
              ? `CI runs on every push to the default branch, a post-merge run. ${'pull_request' in triggers ? 'The pull-request job already ran on the same tree. ' : 'A pull_request trigger tests the change before it lands. '}Drop it, or keep it as the single post-merge check.${phaseAdvice(map)}`
              : `CI runs on every push to a branch with no path filter. A pull_request trigger fires once per pull-request update instead.${phaseAdvice(map)}`,
            evidence: 'on: push',
          });
        }
        reportMatrix(() => true);
      }
    }
    if ('pull_request' in triggers) {
      // One Linux job per pull-request update is the recommended non-blocking check; a path filter does not excuse Windows or macOS.
      const runners = [...new Set(jobs.filter(job => job.onPullRequest).flatMap(job => job.all))];
      if (runners.length > 0) {
        findings.push({
          category: 'frequency',
          rule: 'frequency.ci-on-pull-request',
          file,
          message: `A pull_request workflow runs on ${runners.join(', ')}, which bills at a higher rate than Linux, and a path filter does not change that. Keep Windows and macOS off the pull-request path.${phaseAdvice(map)}`,
          evidence: 'on: pull_request',
        });
        reportMatrix(job => job.onPullRequest);
      }
    }
  }

  for (const doc of AGENT_DOCS) {
    const text = readText(join(root, doc));
    if (text === null) continue;
    let fenced = false;
    text.split(/\r?\n/).forEach((line, index) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        fenced = !fenced;
        return;
      }
      if (fenced) return;
      const flagged = [...line.matchAll(AGENT_RUN_ALL)].some(match => {
        const before = line.slice(0, match.index);
        const after = line.slice(match.index + match[0].length);
        return !AGENT_NEGATION.test(before) && !AGENT_MERGE_GATE.test(after);
      });
      if (flagged) {
        findings.push({
          category: 'frequency',
          rule: 'frequency.agent-run-all',
          file: doc,
          line: index + 1,
          message: 'Agent instructions tell the agent to run the whole suite. Point it at the edit lane instead.',
          evidence: line.trim().slice(0, 160),
        });
      }
    });
  }
  return findings;
}
````

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/detectors/frequency.test.ts`

Expected: PASS, 174 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/detectors/frequency.ts tests/detectors/frequency.test.ts
git commit -m "feat: detect over-frequent test runs in hooks, scripts, CI and agent instructions"
```

---

## Task 11: Risk-map drafting

`risk-draft` proposes a risk map from directory names. It is a first guess that the owner confirms; the same `candidateDirs` list later powers drift detection.

**Files:**
- Create: `tests/riskdraft.test.ts`, `src/riskdraft.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/riskdraft.test.ts`:

```ts
import { symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { candidateDirs, draftRiskMap } from '../src/riskdraft.ts';
import { loadRiskMap, serializeRiskMap, tierFor } from '../src/riskmap.ts';
import { RiskMap } from '../src/schema.ts';
import { makeTree } from './helpers/tree.ts';

describe('candidateDirs', () => {
  it('lists the children of src, skipping tests, docs and dot directories', () => {
    const root = makeTree({ 'src/auth/a.ts': '', 'src/ui/b.ts': '', 'src/tests/c.ts': '', 'src/.cache/d.ts': '', 'src/loose.ts': '' });
    expect(candidateDirs(root)).toEqual(['src/auth', 'src/ui']);
  });

  it('uses the root when there is no conventional source directory', () => {
    const root = makeTree({ 'core/a.ts': '', 'docs/readme.md': '', 'node_modules/x/y.js': '' });
    expect(candidateDirs(root)).toEqual(['core']);
  });

  it('includes packages and apps children', () => {
    const root = makeTree({ 'packages/api/a.ts': '', 'apps/web/b.ts': '' });
    expect(candidateDirs(root)).toEqual(['apps/web', 'packages/api']);
  });
});

describe('draftRiskMap', () => {
  const root = makeTree({ 'src/persistence/a.ts': '', 'src/ui/b.ts': '', 'src/parser/c.ts': '', 'src/billing/d.ts': '' });
  const map = draftRiskMap(root);

  it('produces a valid dev-phase map with no consumers', () => {
    expect(RiskMap.safeParse(map).success).toBe(true);
    expect(map.phase).toBe('dev');
    expect(map.consumers).toEqual([]);
  });

  it('adds a catch-all last when code sits directly in the source directory', () => {
    const flat = draftRiskMap(makeTree({ 'src/auth/a.ts': '', 'src/scan.ts': '' }));
    expect(flat.areas.map(area => `${area.path}:${area.tier}`)).toEqual(['src/auth/**:critical', 'src/**:standard']);
    expect(draftRiskMap(makeTree({ 'src/auth/a.ts': '' })).areas.map(area => area.path)).toEqual(['src/auth/**']);
  });

  it('classifies directories by name and says why', () => {
    const byPath = Object.fromEntries(map.areas.map(area => [area.path, area.tier]));
    expect(byPath).toEqual({
      'src/billing/**': 'critical',
      'src/parser/**': 'standard',
      'src/persistence/**': 'critical',
      'src/ui/**': 'low',
    });
    expect(map.areas.every(area => area.why && area.why.length > 0)).toBe(true);
  });
});

/** Draft a map from `src/<name>/a.ts` for every name and return the tier by directory name. */
function tiersByName(names: string[]): Record<string, string> {
  const files = Object.fromEntries(names.map(name => [`src/${name}/a.ts`, '']));
  const map = draftRiskMap(makeTree(files));
  return Object.fromEntries(map.areas.map(area => [area.path.replace(/^src\//, '').replace(/\/\*\*$/, ''), area.tier]));
}

const expectAll = (names: string[], tier: string): void => {
  const tiers = tiersByName(names);
  expect(Object.fromEntries(names.map(name => [name, tiers[name]]))).toEqual(Object.fromEntries(names.map(name => [name, tier])));
};

describe('candidateDirs on unreadable roots', () => {
  it('returns nothing for a missing root', () => {
    expect(candidateDirs(join(tmpdir(), 'agent-tests-no-such-directory-xyz'))).toEqual([]);
  });

  it('returns nothing when the root is a file', () => {
    const root = makeTree({ 'a.txt': 'x' });
    expect(candidateDirs(join(root, 'a.txt'))).toEqual([]);
    expect(draftRiskMap(join(root, 'a.txt')).areas).toEqual([]);
  });
});

describe('name-token classification', () => {
  it('marks every security or money keyword critical', () => {
    expectAll(
      [
        'auth', 'authn', 'authz', 'oauth', 'oauth2', 'authentication', 'authorization', 'login', 'logout', 'session', 'sessions', 'user-session',
        'token', 'tokens', 'credentials', 'password', 'secret', 'secrets', 'security', 'crypto', 'encryption', 'jwt', 'rbac', 'acl', 'permissions',
        'payments', 'billing', 'invoice', 'checkout', 'wallet', 'ledger', 'money', 'transactions', 'account', 'accountSettings', 'DBUtils', 'db', 'database',
        'datastore', 'persistence', 'storage', 'migrations', 'schema',
      ],
      'critical',
    );
  });

  it('does not match keywords inside other words', () => {
    expectAll(
      ['author', 'authors', 'restore', 'stored', 'storefront', 'bookstore', 'dbus', 'mydb', 'subsession', 'accounting', 'guide', 'store', 'data_store', 'parser', 'orders', 'ui-kit', 'design'],
      'standard',
    );
  });

  it('marks presentation names low only when every token is presentation', () => {
    expectAll(['ui', 'views', 'components', 'styles', 'theme', 'examples', 'demo', 'playground', 'storybook', 'stories', 'assets', 'icons', 'images', 'fonts', 'public', 'static'], 'low');
  });

  it('writes a plain-language reason', () => {
    const map = draftRiskMap(makeTree({ 'src/auth/a.ts': '', 'src/db/a.ts': '', 'src/ui/a.ts': '', 'src/parser/a.ts': '' }));
    expect(Object.fromEntries(map.areas.map(area => [area.path, area.why]))).toEqual({
      'src/auth/**': 'name suggests authentication; confirm',
      'src/db/**': 'name suggests data persistence; confirm',
      'src/parser/**': 'no risk keyword in the name; confirm',
      'src/ui/**': 'presentation or example code; confirm',
    });
  });

  it('lets a critical token win over a presentation token', () => {
    expectAll(['ui-auth'], 'critical');
  });
});

describe('loose files directly under the source directory', () => {
  it('emits a critical area per risky file before the catch-all', () => {
    const map = draftRiskMap(makeTree({ 'src/core/a.ts': '', 'src/auth.ts': '', 'src/db.ts': '', 'src/util.ts': '' }));
    expect(map.areas.map(area => `${area.path}:${area.tier}`)).toEqual(['src/core/**:standard', 'src/auth.ts:critical', 'src/db.ts:critical', 'src/**:standard']);
    expect(map.areas.find(area => area.path === 'src/auth.ts')?.why).toBe('file name suggests authentication; confirm');
  });

  it('classifies a file by its stem and skips test files', () => {
    const map = draftRiskMap(makeTree({ 'src/auth.service.ts': '', 'src/auth.test.ts': '', 'src/author.ts': '' }));
    expect(map.areas.map(area => area.path)).toEqual(['src/auth.service.ts', 'src/**']);
  });

  it('resolves a risky file to its own area and other files to the catch-all after a round trip', () => {
    const map = draftRiskMap(makeTree({ 'src/core/a.ts': '', 'src/auth.ts': '', 'src/other.ts': '' }));
    const loaded = loadRiskMap(makeTree({ '.testing/risk.yml': serializeRiskMap(map) }));
    expect(loaded).toEqual(map);
    expect(tierFor(map, 'src/auth.ts')).toEqual({ tier: 'critical', area: 'src/auth.ts' });
    expect(tierFor(map, 'src/other.ts')).toEqual({ tier: 'standard', area: 'src/**' });
    expect(tierFor(map, 'src/core/a.ts')).toEqual({ tier: 'standard', area: 'src/core/**' });
  });
});

describe('container directories', () => {
  it('descends through generic containers up to three levels', () => {
    const map = draftRiskMap(makeTree({ 'src/app/features/auth/a.ts': '', 'src/app/features/billing/b.ts': '', 'src/core/c.ts': '' }));
    expect(map.areas.map(area => `${area.path}:${area.tier}`)).toEqual(['src/app/features/auth/**:critical', 'src/app/features/billing/**:critical', 'src/core/**:standard']);
  });

  it('lists a container that has no subdirectories, and stops descending at the third level', () => {
    expect(candidateDirs(makeTree({ 'src/modules/x.ts': '' }))).toEqual(['src/modules']);
    expect(candidateDirs(makeTree({ 'src/modules/modules/modules/modules/a.ts': '' }))).toEqual(['src/modules/modules/modules']);
  });

  it('covers loose code inside a container with the catch-all', () => {
    const map = draftRiskMap(makeTree({ 'src/app/page.ts': '', 'src/app/features/auth/a.ts': '' }));
    expect(map.areas.map(area => area.path)).toEqual(['src/app/features/auth/**', 'src/**']);
  });

  it('stays at the package level under packages', () => {
    expect(candidateDirs(makeTree({ 'packages/core/src/auth/a.ts': '', 'packages/web/src/b.ts': '' }))).toEqual(['packages/core', 'packages/web']);
  });
});

describe('skipped names', () => {
  it('skips test support, mocks and tool directories under src', () => {
    const root = makeTree({
      'src/__mocks__/a.ts': '', 'src/mocks/a.ts': '', 'src/testing/a.ts': '', 'src/test-utils/a.ts': '', 'src/e2e/a.ts': '', 'src/spec/a.ts': '', 'src/specs/a.ts': '',
      'src/bench/a.ts': '', 'src/benchmarks/a.ts': '', 'src/helpers/a.ts': '', 'src/fixtures/a.ts': '', 'src/docs/a.ts': '', 'src/doc/a.ts': '', 'src/scripts/a.ts': '',
      'src/build/a.ts': '', 'src/real/a.ts': '',
    });
    expect(candidateDirs(root)).toEqual(['src/real']);
  });

  it('skips language tool directories at the root only when there is no source directory', () => {
    expect(candidateDirs(makeTree({ 'venv/x.py': '', 'env/x.py': '', 'target/x': '', '__pycache__/x': '', 'core/a.ts': '' }))).toEqual(['core']);
    expect(candidateDirs(makeTree({ 'src/target/a.ts': '' }))).toEqual(['src/target']);
  });
});

describe('real directory names', () => {
  it('keeps the casing of the source directory', () => {
    const root = makeTree({ 'Src/auth/a.ts': '', 'Src/loose.ts': '' });
    expect(candidateDirs(root)).toEqual(['Src/auth']);
    expect(draftRiskMap(root).areas.map(area => area.path)).toEqual(['Src/auth/**', 'Src/**']);
  });

  it('does not follow a symlinked source directory', () => {
    const root = makeTree({ 'real/auth/a.ts': '' });
    symlinkSync(join(root, 'real'), join(root, 'src'), 'junction');
    expect(candidateDirs(root)).toEqual(['real']);
  });
});

describe('route groups and decorated names', () => {
  it('classifies framework route groups by the word inside the brackets', () => {
    const map = draftRiskMap(makeTree({ 'app/(auth)/login/page.tsx': '', 'app/(marketing)/home/page.tsx': '', 'app/[slug]/page.tsx': '' }));
    expect(map.areas.map(area => `${area.path}:${area.tier}`)).toEqual(['app/(auth)/**:critical', 'app/(marketing)/**:standard', 'app/[slug]/**:standard']);
  });

  it('ignores brackets and other punctuation around a keyword', () => {
    expectAll(['[auth]', '@auth', '_auth', '(billing)', '$session'], 'critical');
  });
});

describe('critical files inside a descended container', () => {
  it('gives a risky file in a container its own area before the catch-all', () => {
    const map = draftRiskMap(makeTree({ 'src/app/auth.service.ts': '', 'src/app/user.service.ts': '', 'src/app/features/billing/a.ts': '' }));
    expect(map.areas.map(area => `${area.path}:${area.tier}`)).toEqual(['src/app/features/billing/**:critical', 'src/app/auth.service.ts:critical', 'src/**:standard']);
    expect(map.areas.find(area => area.path === 'src/app/auth.service.ts')?.why).toBe('file name suggests authentication; confirm');
  });

  it('only adds to the catch-all for a file that is not risky or is a test', () => {
    const map = draftRiskMap(makeTree({ 'src/app/user.service.ts': '', 'src/app/auth.test.ts': '', 'src/app/features/ok/a.ts': '' }));
    expect(map.areas.map(area => area.path)).toEqual(['src/app/features/ok/**', 'src/**']);
  });

  it('keeps risky container files in a tier order that resolves them first', () => {
    const map = draftRiskMap(makeTree({ 'src/app/auth.service.ts': '', 'src/app/features/ok/a.ts': '' }));
    expect(tierFor(map, 'src/app/auth.service.ts')).toEqual({ tier: 'critical', area: 'src/app/auth.service.ts' });
    expect(tierFor(map, 'src/app/other.ts')).toEqual({ tier: 'standard', area: 'src/**' });
  });
});

describe('grouping directories that hide critical children', () => {
  it('descends through api, routes, services, controllers and server directories', () => {
    const map = draftRiskMap(
      makeTree({ 'src/api/auth/a.ts': '', 'src/routes/auth/a.ts': '', 'src/services/payments/a.ts': '', 'src/server/auth/a.ts': '', 'src/controllers/billing/a.ts': '', 'src/handlers/misc/a.ts': '' }),
    );
    expect(map.areas.map(area => `${area.path}:${area.tier}`)).toEqual([
      'src/api/auth/**:critical',
      'src/controllers/billing/**:critical',
      'src/handlers/misc/**:standard',
      'src/routes/auth/**:critical',
      'src/server/auth/**:critical',
      'src/services/payments/**:critical',
    ]);
    expect(candidateDirs(makeTree({ 'app/api/auth/a.ts': '' }))).toEqual(['app/api/auth']);
    expect(candidateDirs(makeTree({ 'src/backend/db/a.ts': '', 'src/domain/ledger/a.ts': '' }))).toEqual(['src/backend/db', 'src/domain/ledger']);
  });

  it('lists a grouping directory as itself when it has no usable subdirectory', () => {
    expect(candidateDirs(makeTree({ 'src/api/x.ts': '' }))).toEqual(['src/api']);
    expect(candidateDirs(makeTree({ 'src/api/tests/a.ts': '', 'src/core/b.ts': '' }))).toEqual(['src/api', 'src/core']);
  });

  it('classifies the children of core and covers its loose files with the catch-all', () => {
    const map = draftRiskMap(makeTree({ 'src/core/auth/a.ts': '', 'src/core/util.ts': '' }));
    expect(map.areas.map(area => `${area.path}:${area.tier}`)).toEqual(['src/core/auth/**:critical', 'src/**:standard']);
  });
});

describe('more security vocabulary', () => {
  it('marks identity, web security, secrets and payment provider names critical', () => {
    expectAll(['iam', 'identity', 'identities', 'sso', 'mfa', 'otp', 'vault', 'csrf', 'cookie', 'cookies', 'stripe', 'webhook', 'webhooks', 'authorisation'], 'critical');
  });

  it('leaves order names standard and says tokens may be design tokens', () => {
    expectAll(['order', 'orders'], 'standard');
    const map = draftRiskMap(makeTree({ 'src/tokens/a.ts': '' }));
    expect(map.areas[0]?.why).toBe('name suggests tokens (auth or design); confirm');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/riskdraft.test.ts`

Expected: FAIL. Cannot import `../src/riskdraft.ts`.

- [ ] **Step 3: Implement**

Create `src/riskdraft.ts`:

```ts
import { type Dirent, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IGNORED_DIRS, isTestPath, readEntries } from './discover.ts';
import { defaultRiskMap } from './riskmap.ts';
import type { RiskMap, Tier } from './schema.ts';

const BASES = new Set(['src', 'lib', 'app', 'packages', 'apps']);
const SOURCE_BASES = new Set(['src', 'lib', 'app']);
/** Directories that only group other directories. The draft looks through them instead of listing them. */
const CONTAINERS = new Set(['app', 'apps', 'packages', 'internal', 'pkg', 'features', 'modules', 'domain', 'domains', 'api', 'routes', 'services', 'controllers', 'handlers', 'server', 'backend', 'core']);
const MAX_DEPTH = 3;

/**
 * Directory names that are never areas, at any depth and in any case. IGNORED_DIRS contributes `build`, `out`, `vendor` and the like,
 * so a real `src/build` module needs a hand-written area. Dot directories are skipped as well.
 */
const SKIPPED = new Set(['tests', 'test', '__tests__', '__mocks__', 'mocks', 'spec', 'specs', 'e2e', 'bench', 'benchmarks', 'testing', 'test-utils', 'helpers', 'fixture', 'fixtures', 'docs', 'doc', 'scripts']);
/** Tool output that sits at the root of a project with no conventional source directory. */
const ROOT_SKIPPED = new Set(['venv', 'env', 'target', '__pycache__']);

const isDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

function isSkipped(name: string, atRoot: boolean): boolean {
  const lower = name.toLowerCase();
  return name.startsWith('.') || IGNORED_DIRS.has(name) || SKIPPED.has(lower) || (atRoot && ROOT_SKIPPED.has(lower));
}

const CODE = /\.[cm]?[jt]sx?$/;
const isCode = (entry: Dirent): boolean => entry.isFile() && CODE.test(entry.name);

interface Draft {
  dirs: string[];
  /** Per source directory: its real name and the repo-relative code files sitting directly in it or in a container below it. */
  sources: { base: string; files: string[] }[];
}

/**
 * Walk the candidate directories. Symbolic links and junctions are not followed, as in discover.ts, and that includes a
 * symlinked `src`. Areas stop three levels below a base (`src/app/features/auth`); anything deeper, such as
 * `packages/core/src/auth`, must be added to the risk map by hand. Unreadable directories are skipped.
 * The code files of every container that was looked through are added to `files`, because no listed directory covers them.
 */
function collect(root: string, prefix: string, entries: Dirent[], level: number, atRoot: boolean, workspaces: boolean, out: string[], files: string[]): void {
  for (const entry of entries) {
    if (!entry.isDirectory() || isSkipped(entry.name, atRoot)) continue;
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (CONTAINERS.has(entry.name.toLowerCase()) && level < MAX_DEPTH && !(workspaces && level === 1)) {
      const children = readEntries(join(root, path));
      const before = out.length;
      const nestedFiles: string[] = [];
      collect(root, path, children, level + 1, atRoot, workspaces, out, nestedFiles);
      if (out.length > before) {
        files.push(...nestedFiles, ...children.filter(isCode).map(child => `${path}/${child.name}`));
        continue;
      }
    }
    out.push(path);
  }
}

function draft(root: string): Draft {
  const result: Draft = { dirs: [], sources: [] };
  if (!isDir(root)) return result;
  const rootEntries = readEntries(root);
  // Sorted, so the order of the areas does not depend on the order the filesystem lists the root.
  const bases = rootEntries
    .filter(entry => entry.isDirectory() && BASES.has(entry.name.toLowerCase()))
    .map(entry => entry.name)
    .sort();
  if (bases.length === 0) {
    collect(root, '', rootEntries, 1, true, false, result.dirs, []);
  }
  for (const base of bases) {
    const entries = readEntries(join(root, base));
    const files = entries.filter(isCode).map(entry => `${base}/${entry.name}`);
    collect(root, base, entries, 1, false, !SOURCE_BASES.has(base.toLowerCase()), result.dirs, files);
    // Only src, lib and app get per-file areas and a catch-all. The children of packages and apps are workspaces, so they are
    // listed whole and never looked through, and loose code directly in packages or apps is covered by no area: add one by hand.
    if (SOURCE_BASES.has(base.toLowerCase())) result.sources.push({ base, files: files.sort() });
  }
  result.dirs.sort();
  return result;
}

/** Directories the risk map should classify: the children of src/lib/app/packages/apps, or of the root when none exist. */
export function candidateDirs(root: string): string[] {
  return draft(root).dirs;
}

/** Keyword groups with the plain-language label used in `why`. A token matches a keyword exactly, or starts with a stem. */
const CRITICAL: { label: string; words: string[]; stems: string[] }[] = [
  { label: 'authentication', words: ['auth', 'authn', 'oauth', 'login', 'logout'], stems: ['authent'] },
  { label: 'authorization', words: ['authz', 'rbac', 'acl'], stems: ['authoriz', 'authoris', 'permission'] },
  { label: 'identity and access', words: ['iam', 'identity', 'sso', 'mfa', 'otp'], stems: [] },
  { label: 'sessions', words: ['session'], stems: [] },
  { label: 'tokens (auth or design)', words: ['token', 'jwt'], stems: [] },
  { label: 'credentials or secrets', words: ['password', 'secret', 'vault'], stems: ['credential'] },
  { label: 'web security', words: ['csrf', 'cookie'], stems: [] },
  { label: 'security', words: ['security'], stems: [] },
  { label: 'cryptography', words: [], stems: ['crypt', 'encrypt', 'decrypt'] },
  { label: 'payments or money', words: ['billing', 'invoice', 'checkout', 'wallet', 'ledger', 'money', 'transaction', 'stripe'], stems: ['payment'] },
  { label: 'webhooks', words: ['webhook'], stems: [] },
  { label: 'accounts', words: ['account'], stems: [] },
  { label: 'data persistence', words: ['db', 'database', 'datastore', 'storage', 'schema'], stems: ['persist', 'migrat'] },
];
const LOW = new Set(['ui', 'view', 'component', 'style', 'theme', 'example', 'demo', 'playground', 'storybook', 'story', 'asset', 'icon', 'image', 'font', 'public', 'static']);

/**
 * Lowercase tokens of a name: split on camelCase boundaries and on anything that is not a letter or digit (so `(auth)`,
 * `[auth]`, `@auth` and `_auth` all give `auth`), drop trailing digits and a plural s.
 */
function tokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map(token => token.toLowerCase().replace(/(?<=[a-z])\d+$/, ''))
    .filter(token => token.length > 0)
    .map(token => (token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token));
}

/** A token as written (`cookie`), and with `ie` read as `y` (`stories` loses its s to `storie`, which is `story`). */
const forms = (token: string): string[] => (token.endsWith('ie') ? [token, `${token.slice(0, -2)}y`] : [token]);

/** The first token that names something risky, as the label for `why`. */
function criticalLabel(parts: string[]): string | undefined {
  for (const token of parts) {
    for (const group of CRITICAL) {
      if (forms(token).some(form => group.words.includes(form) || group.stems.some(stem => form.startsWith(stem)))) return group.label;
    }
  }
  return undefined;
}

function classify(dir: string): { tier: Tier; why: string } {
  const parts = tokens(dir.split('/').pop() ?? dir);
  const label = criticalLabel(parts);
  if (label) return { tier: 'critical', why: `name suggests ${label}; confirm` };
  if (parts.length > 0 && parts.every(token => forms(token).some(form => LOW.has(form)))) return { tier: 'low', why: 'presentation or example code; confirm' };
  return { tier: 'standard', why: 'no risk keyword in the name; confirm' };
}

/** A first guess from directory names. The owner confirms it once; later scans flag drift. */
export function draftRiskMap(root: string): RiskMap {
  const { dirs, sources } = draft(root);
  const map = defaultRiskMap();
  map.areas = dirs.map(dir => ({ path: `${dir}/**`, ...classify(dir) }));
  for (const { base, files } of sources) {
    // A risky file name gets its own area. Test files are not subjects, so they never do.
    for (const file of files) {
      const name = file.split('/').pop() ?? file;
      const label = isTestPath(name) ? undefined : criticalLabel(tokens(name.replace(CODE, '')));
      if (label) map.areas.push({ path: file, tier: 'critical', why: `file name suggests ${label}; confirm` });
    }
    // Code outside every listed directory (directly in the source directory, or in a container that was looked through)
    // belongs to no area. First match wins, so this catch-all goes last.
    if (files.length > 0) map.areas.push({ path: `${base}/**`, tier: 'standard', why: 'files directly under the source directory; confirm' });
  }
  return map;
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/riskdraft.test.ts`

Expected: PASS, 34 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/riskdraft.ts tests/riskdraft.test.ts
git commit -m "feat: draft a risk map from directory names"
```

---

## Task 12: Git churn

Churn counts commits that rewrote a test without touching the code it covers: the signature of a brittle test rewritten for its own sake. Creating, renaming or deleting a test is not an edit. It needs history that exists for the project: outside a repository, in a repository with no commits, and in a shallow clone (the default CI checkout) it reports `null`. The log window counts commits that touched the project directory.

**Files:**
- Create: `tests/churn.test.ts`, `src/churn.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/churn.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { churnOf, commitFileSets } from '../src/churn.ts';
import { makeTree } from './helpers/tree.ts';

/** The environment with every GIT_* variable removed, so a hook or wrapper cannot redirect git at another repository. */
const isGitVariable = (name: string): boolean => name.toUpperCase().startsWith('GIT_');
const cleanEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([name]) => !isGitVariable(name)));

// commitFileSets runs git with the inherited environment, so scrub it for the whole file and restore it afterwards.
const saved: Array<[string, string]> = [];
beforeAll(() => {
  for (const [name, value] of Object.entries(process.env)) {
    if (isGitVariable(name) && value !== undefined) saved.push([name, value]);
  }
  for (const [name] of saved) delete process.env[name];
});
afterAll(() => {
  for (const [name, value] of saved) process.env[name] = value;
});

const git = (root: string, ...args: string[]): void => {
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', '-c', 'init.defaultBranch=main', ...args],
    { cwd: root, env: cleanEnv(), stdio: 'ignore', windowsHide: true },
  );
};

const write = (root: string, rel: string, text: string): void => {
  writeFileSync(join(root, rel), text);
};

const entries = (set: Map<string, string> | undefined): Array<[string, string]> => [...(set ?? [])].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Commit one creates both files, commit two edits only the test, commit three edits the test and the code. */
function repoWithHistory(): string {
  const root = makeTree({ 'src/a.ts': 'v1', 'tests/a.test.ts': 'v1' });
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'one');
  write(root, 'tests/a.test.ts', 'v2');
  git(root, 'commit', '-q', '-am', 'two: test only');
  write(root, 'tests/a.test.ts', 'v3');
  write(root, 'src/a.ts', 'v2');
  git(root, 'commit', '-q', '-am', 'three: both');
  return root;
}

describe('commitFileSets', () => {
  it('returns null outside a git repository', () => {
    expect(commitFileSets(makeTree({ 'a.txt': '' }), 10)).toBeNull();
  });

  it('returns null for a repository with no commits', () => {
    const root = makeTree({ 'a.txt': '' });
    git(root, 'init', '-q');
    expect(commitFileSets(root, 10)).toBeNull();
  });

  it('returns null for a shallow clone, whose grafted commit lists every file', () => {
    const source = repoWithHistory();
    const parent = makeTree();
    const clone = join(parent, 'clone');
    git(parent, 'clone', '-q', '--depth', '1', pathToFileURL(source).href, clone);
    expect(commitFileSets(clone, 10)).toBeNull();
  });

  it('maps each commit to the files it touched and their status, newest first', () => {
    const sets = commitFileSets(repoWithHistory(), 10);
    expect(sets?.map(entries)).toEqual([
      [
        ['src/a.ts', 'M'],
        ['tests/a.test.ts', 'M'],
      ],
      [['tests/a.test.ts', 'M']],
      [
        ['src/a.ts', 'A'],
        ['tests/a.test.ts', 'A'],
      ],
    ]);
  });

  it('honours the commit limit and keeps the newest commits', () => {
    const sets = commitFileSets(repoWithHistory(), 2);
    expect(sets?.map(entries)).toEqual([
      [
        ['src/a.ts', 'M'],
        ['tests/a.test.ts', 'M'],
      ],
      [['tests/a.test.ts', 'M']],
    ]);
  });

  it('counts the limit in commits that touched this root, with paths relative to it', () => {
    const root = makeTree({ 'pkg/a.ts': 'v1', 'pkg/a.test.ts': 'v1', 'other/x.txt': 'v1' });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'one');
    write(root, 'pkg/a.ts', 'v2');
    git(root, 'commit', '-q', '-am', 'two: pkg code');
    write(root, 'pkg/a.test.ts', 'v2');
    git(root, 'commit', '-q', '-am', 'three: pkg test');
    for (const n of [2, 3, 4, 5]) {
      write(root, 'other/x.txt', `v${n}`);
      git(root, 'commit', '-q', '-am', `outside ${n}`);
    }
    const sets = commitFileSets(join(root, 'pkg'), 3);
    expect(sets?.map(entries)).toEqual([
      [['a.test.ts', 'M']],
      [['a.ts', 'M']],
      [
        ['a.test.ts', 'A'],
        ['a.ts', 'A'],
      ],
    ]);
  });

  it('round-trips a path with spaces and non-ASCII characters', () => {
    const root = makeTree({ 'sub dir/ü é.test.ts': 'v1' });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'one');
    expect(commitFileSets(root, 10)?.map(entries)).toEqual([[['sub dir/ü é.test.ts', 'A']]]);
  });

  it('records a rename under its new path with the status R', () => {
    const root = makeTree({ 'tests/a.test.ts': 'a body long enough to be recognised as the same file\n' });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'one');
    git(root, 'mv', 'tests/a.test.ts', 'tests/b.test.ts');
    git(root, 'commit', '-q', '-m', 'two: rename');
    expect(commitFileSets(root, 10)?.map(entries)).toEqual([[['tests/b.test.ts', 'R']], [['tests/a.test.ts', 'A']]]);
  });
});

describe('churnOf', () => {
  it('counts edits to the test and those that never touched the code it covers, not its creation', () => {
    const sets = commitFileSets(repoWithHistory(), 10);
    // Commit one creates the test (not an edit), commit two edits it alone (churn), commit three edits it with its code.
    expect(churnOf('tests/a.test.ts', ['src/a.ts'], sets)).toEqual({ churn: 1, edits: 2 });
  });

  it('reports unknown churn without subjects or without history', () => {
    const sets = commitFileSets(repoWithHistory(), 10);
    expect(churnOf('tests/a.test.ts', [], sets)).toEqual({ churn: null, edits: 2 });
    expect(churnOf('tests/a.test.ts', ['src/a.ts'], null)).toEqual({ churn: null, edits: null });
  });

  it('does not count an edit as churn when any one of several subjects changed with it', () => {
    const root = makeTree({ 'src/a.ts': 'v1', 'src/b.ts': 'v1', 'tests/a.test.ts': 'v1' });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'one');
    write(root, 'tests/a.test.ts', 'v2');
    write(root, 'src/b.ts', 'v2');
    git(root, 'commit', '-q', '-am', 'two: test and the second subject');
    write(root, 'tests/a.test.ts', 'v3');
    git(root, 'commit', '-q', '-am', 'three: test alone');
    write(root, 'tests/a.test.ts', 'v4');
    write(root, 'src/a.ts', 'v2');
    git(root, 'commit', '-q', '-am', 'four: test and the first subject');
    const sets = commitFileSets(root, 10);
    expect(churnOf('tests/a.test.ts', ['src/a.ts', 'src/b.ts'], sets)).toEqual({ churn: 1, edits: 3 });
  });

  it('does not count a rename as an edit', () => {
    const root = makeTree({ 'src/a.ts': 'v1', 'tests/a.test.ts': 'a body long enough to be recognised as the same file\n' });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'one');
    git(root, 'mv', 'tests/a.test.ts', 'tests/b.test.ts');
    git(root, 'commit', '-q', '-m', 'two: rename');
    write(root, 'tests/b.test.ts', 'a different body\n');
    git(root, 'commit', '-q', '-am', 'three: edit');
    const sets = commitFileSets(root, 10);
    expect(churnOf('tests/b.test.ts', ['src/a.ts'], sets)).toEqual({ churn: 1, edits: 1 });
  });

  it('counts only modifications as edits', () => {
    const sets = [
      new Map([['tests/a.test.ts', 'T']]),
      new Map([['tests/a.test.ts', 'D']]),
      new Map([['tests/a.test.ts', 'C']]),
      new Map([['tests/a.test.ts', 'R']]),
      new Map([['tests/a.test.ts', 'A']]),
      new Map([['tests/a.test.ts', 'M']]),
    ];
    expect(churnOf('tests/a.test.ts', ['src/a.ts'], sets)).toEqual({ churn: 2, edits: 2 });
  });

  it('treats a subject touched with any status as touched', () => {
    const sets = [new Map([['tests/a.test.ts', 'M'], ['src/a.ts', 'D']])];
    expect(churnOf('tests/a.test.ts', ['src/a.ts'], sets)).toEqual({ churn: 0, edits: 1 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/churn.test.ts`

Expected: FAIL. Cannot import `../src/churn.ts`.

- [ ] **Step 3: Implement**

Create `src/churn.ts`:

```ts
import { execFileSync } from 'node:child_process';

const git = (root: string, args: string[], maxBuffer?: number): string =>
  execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    ...(maxBuffer === undefined ? {} : { maxBuffer }),
    stdio: ['ignore', 'pipe', 'ignore'],
  });

/**
 * The files touched by each of the last `limit` commits that touched `root`, newest first. Each set maps a path relative
 * to `root` to its status letter (A added, M modified, T type change, D deleted; a rename or copy is recorded under its
 * new path as R or C). Null when `root` has no usable history: not a repository, no commits yet, or a shallow clone,
 * whose oldest commit would list every file it holds as added.
 */
export function commitFileSets(root: string, limit: number): Array<Map<string, string>> | null {
  let log: string;
  try {
    if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') return null;
    log = git(root, ['log', '-M', '--relative', '--name-status', '--pretty=format:%x00', '-n', String(limit), '--', '.'], 256 * 1024 * 1024);
  } catch {
    return null;
  }
  return log
    .split('\0')
    .slice(1)
    .map(chunk => {
      const files = new Map<string, string>();
      for (const line of chunk.split(/\r?\n/)) {
        if (line === '') continue;
        const [status = '', first = '', second] = line.split('\t');
        const moved = status.startsWith('R') || status.startsWith('C');
        files.set(moved ? (second ?? first) : first, status.charAt(0));
      }
      return files;
    });
}

/**
 * edits: commits that modified the test (status M or T); creating, renaming, copying or deleting it is not an edit.
 * churn: those edits that touched none of the code it covers (any status counts as touching), which is the signature
 * of a brittle test being rewritten for its own sake. Both are null without history. Without subjects churn is null
 * but edits is still counted.
 */
export function churnOf(testRel: string, subjects: string[], sets: Array<Map<string, string>> | null): { churn: number | null; edits: number | null } {
  if (sets === null) return { churn: null, edits: null };
  let edits = 0;
  let churn = 0;
  for (const set of sets) {
    const status = set.get(testRel);
    if (status !== 'M' && status !== 'T') continue;
    edits++;
    if (subjects.length > 0 && !subjects.some(subject => set.has(subject))) churn++;
  }
  return { churn: subjects.length > 0 ? churn : null, edits };
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/churn.test.ts`

Expected: PASS, 14 tests. The test creates throwaway git repositories under your temp directory.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/churn.ts tests/churn.test.ts
git commit -m "feat: measure test churn from git history"
```

---

## Task 13: Wiring detector

Ties tests to the risk map: no map at all, tests with no tier, a lane tag outside what the tier allows, critical areas no test exercises, and directories the map has never seen.

**Files:**
- Create: `tests/detectors/wiring.test.ts`, `src/detectors/wiring.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/detectors/wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectWiring } from '../../src/detectors/wiring.ts';
import { defaultRiskMap } from '../../src/riskmap.ts';
import type { RiskMap } from '../../src/schema.ts';

const rules = (findings: Array<{ rule: string }>): string[] => findings.map(finding => finding.rule).sort();

describe('detectWiring', () => {
  const map: RiskMap = {
    ...defaultRiskMap(),
    areas: [
      { path: 'src/db/**', tier: 'critical' },
      { path: 'src/auth/**', tier: 'critical' },
      { path: 'src/ui/**', tier: 'low' },
    ],
  };

  it('reports a missing risk map as one finding', () => {
    expect(rules(detectWiring(null, [], []))).toEqual(['wiring.no-risk-map']);
  });

  it('reports untiered files, lane mismatches, uncovered critical areas and drift', () => {
    const findings = detectWiring(
      map,
      [
        { rel: 'tests/db.test.ts', tier: 'critical', tags: { lane: 'merge' }, subjects: ['src/db/store.ts'] },
        { rel: 'tests/ui.test.ts', tier: 'low', tags: { lane: 'edit' }, subjects: ['src/ui/button.ts'] },
        { rel: 'tests/misc.test.ts', tier: null, tags: {}, subjects: ['src/misc/x.ts'] },
      ],
      ['src/db', 'src/auth', 'src/ui', 'src/billing'],
    );
    expect(findings.map(finding => `${finding.rule}@${finding.file}`).sort()).toEqual([
      'wiring.drift@src/billing',
      'wiring.lane-mismatch@tests/ui.test.ts',
      'wiring.uncovered-critical@src/auth/**',
      'wiring.untiered@tests/misc.test.ts',
    ]);
  });

  it('returns only the no-map finding when there is no map, whatever else is passed', () => {
    const findings = detectWiring(
      null,
      [{ rel: 'tests/a.test.ts', tier: null, tags: { lane: 'edit' }, subjects: [] }],
      ['src/billing'],
    );
    expect(findings.map(finding => finding.rule)).toEqual(['wiring.no-risk-map']);
  });

  it('does not flag a test with no @lane tag', () => {
    const findings = detectWiring(map, [{ rel: 'tests/ui.test.ts', tier: 'low', tags: {}, subjects: ['src/ui/button.ts'] }], []);
    expect(rules(findings.filter(finding => finding.file === 'tests/ui.test.ts'))).toEqual([]);
  });

  it('allows a standard test in the scheduled lane', () => {
    const findings = detectWiring(map, [{ rel: 'tests/u.test.ts', tier: 'standard', tags: { lane: 'scheduled' }, subjects: ['src/ui/button.ts'] }], []);
    expect(rules(findings.filter(finding => finding.file === 'tests/u.test.ts'))).toEqual([]);
  });

  it('covers and uncovers a critical area that is a single file', () => {
    const single: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'src/auth.ts', tier: 'critical' }] };
    const covered = detectWiring(single, [{ rel: 'tests/a.test.ts', tier: 'critical', tags: {}, subjects: ['src/auth.ts'] }], []);
    expect(rules(covered)).toEqual([]);
    const uncovered = detectWiring(single, [{ rel: 'tests/a.test.ts', tier: 'critical', tags: {}, subjects: ['src/other.ts'] }], []);
    expect(uncovered.map(finding => `${finding.rule}@${finding.file}`)).toEqual(['wiring.uncovered-critical@src/auth.ts']);
  });

  it('counts a test whose own path is inside a critical area as covering it', () => {
    const colocated = detectWiring(map, [{ rel: 'src/auth/login.test.ts', tier: 'critical', tags: {}, subjects: [] }], ['src/auth']);
    expect(colocated.map(finding => `${finding.rule}@${finding.file}`)).toEqual(['wiring.uncovered-critical@src/db/**']);
  });

  it('explains an uncovered critical area and how to cover it without an import', () => {
    const [finding] = detectWiring(map, [], []).filter(item => item.file === 'src/auth/**');
    expect(finding.message).toBe('Critical area with no test file exercising it. A test reaching it only through a subprocess needs `@subject <path>`.');
    expect(finding.evidence.startsWith('0 test files import this area')).toBe(true);
  });

  describe('untiered', () => {
    const only = (file: Parameters<typeof detectWiring>[1][number]) => detectWiring(map, [file], []).filter(finding => finding.rule === 'wiring.untiered');

    it('says a test with no subjects has no code subject and how to fix it', () => {
      const [finding] = only({ rel: 'tests/e2e.test.ts', tier: null, tags: {}, subjects: [] });
      expect(finding.message).toBe('This test has no code subject, so it has no tier. Add `@risk <critical|standard|low>` or `@subject <path>` at the top of the file.');
      expect(finding.evidence).toBe('no code subjects');
    });

    it('says code with no matching area and keeps the subjects as evidence', () => {
      const [finding] = only({ rel: 'tests/m.test.ts', tier: null, tags: {}, subjects: ['src/misc/x.ts', 'src/misc/y.ts'] });
      expect(finding.message).toContain('matches no risk-map area');
      expect(finding.message).toContain('`@risk <critical|standard|low>`');
      expect(finding.message).toContain('`@subject <path>`');
      expect(finding.evidence).toBe('src/misc/x.ts, src/misc/y.ts');
    });

    it('caps long subject evidence at 160 characters on a comma boundary', () => {
      const subjects = Array.from({ length: 30 }, (_, index) => `src/module${index}/file.ts`);
      const [finding] = only({ rel: 'tests/m.test.ts', tier: null, tags: {}, subjects });
      expect(finding.evidence.length).toBeLessThanOrEqual(160);
      expect(finding.evidence.endsWith('...')).toBe(true);
      const kept = finding.evidence.slice(0, -3).split(', ');
      expect(kept).toEqual(subjects.slice(0, kept.length));
    });

    it('does not truncate evidence that fits', () => {
      const subjects = Array.from({ length: 5 }, (_, index) => `src/m${index}/f.ts`);
      const [finding] = only({ rel: 'tests/m.test.ts', tier: null, tags: {}, subjects });
      expect(finding.evidence).toBe(subjects.join(', '));
    });

    it('names a @risk value that is not a tier', () => {
      const [finding] = only({ rel: 'tests/m.test.ts', tier: null, tags: { risk: 'hgh' }, subjects: [] });
      expect(finding.message).toContain('`@risk` must be critical, standard or low');
      expect(finding.evidence).toContain('hgh');
    });
  });

  describe('drift and catch-all areas', () => {
    const withCatchAll: RiskMap = {
      ...defaultRiskMap(),
      areas: [
        { path: 'src/auth/**', tier: 'critical' },
        { path: 'src/**', tier: 'standard' },
      ],
    };
    const drift = (areaMap: RiskMap, dirs: string[]) =>
      detectWiring(areaMap, [], dirs)
        .filter(finding => finding.rule === 'wiring.drift')
        .map(finding => finding.file);

    it('ignores a src/** catch-all when probing directories', () => {
      expect(drift(withCatchAll, ['src/auth', 'src/billing'])).toEqual(['src/billing']);
    });

    it('ignores lib/** and app/** catch-alls too', () => {
      const map2: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'lib/**', tier: 'standard' }, { path: 'app/**', tier: 'standard' }] };
      expect(drift(map2, ['lib/a', 'app/b'])).toEqual(['lib/a', 'app/b']);
    });

    it('still lets a catch-all assign a tier to files outside the drift probe', () => {
      expect(detectWiring(withCatchAll, [], ['src/auth']).filter(finding => finding.rule === 'wiring.drift')).toEqual([]);
    });

    it('does not treat src/app/** as a catch-all', () => {
      const appOnly: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'src/app/**', tier: 'standard' }] };
      expect(drift(appOnly, ['src/app'])).toEqual([]);
    });

    it('does not treat a wildcard-segment glob as a catch-all', () => {
      const wild: RiskMap = { ...defaultRiskMap(), areas: [{ path: 'src/*/foo/**', tier: 'standard' }] };
      expect(drift(wild, ['src/x/foo'])).toEqual([]);
      expect(drift(wild, ['src/x/bar'])).toEqual(['src/x/bar']);
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/detectors/wiring.test.ts`

Expected: FAIL. Cannot import `../../src/detectors/wiring.ts`.

- [ ] **Step 3: Implement**

Create `src/detectors/wiring.ts`:

```ts
import { globToRegExp } from '../paths.ts';
import { RISK_MAP_PATH, tierFor } from '../riskmap.ts';
import type { Finding, LaneName, RiskMap, Tier } from '../schema.ts';

/** `rel` and every entry of `subjects` must be repo-relative with forward slashes, as `relPosix` produces. */
export interface WiringFile {
  rel: string;
  tier: Tier | null;
  tags: { lane?: LaneName; risk?: string };
  subjects: string[];
}

/** Lanes a test of each tier normally belongs in. A tag outside the set is evidence to review, not an error. */
export const ALLOWED_LANES: Record<Tier, LaneName[]> = {
  critical: ['edit', 'merge'],
  standard: ['edit', 'merge', 'scheduled'],
  low: ['scheduled', 'release'],
};

const TAG_HELP = 'Add `@risk <critical|standard|low>` or `@subject <path>` at the top of the file.';
const TIERS: readonly string[] = ['critical', 'standard', 'low'];
const EVIDENCE_LIMIT = 160;
/** An area whose glob is one literal segment followed by `/**` (`src/**`): it assigns a tier to everything, so it hides drift. */
const CATCH_ALL = /^[^/*?]+\/\*\*$/;

/** The subjects joined by ', ', cut at a comma boundary with '...' when they would exceed the limit. */
function subjectEvidence(subjects: string[]): string {
  const joined = subjects.join(', ');
  if (joined.length <= EVIDENCE_LIMIT) return joined;
  let kept = '';
  for (const subject of subjects) {
    const next = kept ? `${kept}, ${subject}` : subject;
    if (next.length + 3 > EVIDENCE_LIMIT) break;
    kept = next;
  }
  return `${kept || subjects[0].slice(0, EVIDENCE_LIMIT - 3)}...`;
}

function untieredFinding(file: WiringFile): Finding {
  const badRisk = file.tags.risk !== undefined && !TIERS.includes(file.tags.risk);
  const base =
    file.subjects.length === 0
      ? `This test has no code subject, so it has no tier. ${TAG_HELP}`
      : `Test exercises code that matches no risk-map area, so it has no tier. Add an area for it, or: ${TAG_HELP}`;
  return {
    category: 'wiring',
    rule: 'wiring.untiered',
    file: file.rel,
    message: badRisk ? `${base} \`@risk\` must be critical, standard or low.` : base,
    evidence: badRisk ? `@risk ${file.tags.risk}` : file.subjects.length === 0 ? 'no code subjects' : subjectEvidence(file.subjects),
  };
}

/** Tests not tied to a risk tier or lane, lane/tier mismatches, critical areas nobody tests, and directories the map has never seen. */
export function detectWiring(map: RiskMap | null, files: WiringFile[], candidateDirs: string[]): Finding[] {
  if (!map) {
    return [
      {
        category: 'wiring',
        rule: 'wiring.no-risk-map',
        file: RISK_MAP_PATH,
        message: 'No risk map: tests cannot be tied to risk tiers or lanes. Run risk-draft and confirm the result.',
        evidence: '',
      },
    ];
  }
  const findings: Finding[] = [];
  for (const file of files) {
    if (!file.tier) {
      findings.push(untieredFinding(file));
    } else if (file.tags.lane && !ALLOWED_LANES[file.tier].includes(file.tags.lane)) {
      findings.push({
        category: 'wiring',
        rule: 'wiring.lane-mismatch',
        file: file.rel,
        message: `A ${file.tier}-tier test normally runs in ${ALLOWED_LANES[file.tier].join(' or ')}, not ${file.tags.lane}. Confirm or retag.`,
        evidence: `@lane ${file.tags.lane}`,
      });
    }
  }
  for (const area of map.areas) {
    if (area.tier !== 'critical') continue;
    const pattern = globToRegExp(area.path);
    if (!files.some(file => pattern.test(file.rel) || file.subjects.some(subject => pattern.test(subject)))) {
      findings.push({
        category: 'wiring',
        rule: 'wiring.uncovered-critical',
        file: area.path,
        message: 'Critical area with no test file exercising it. A test reaching it only through a subprocess needs `@subject <path>`.',
        evidence: '0 test files import this area',
      });
    }
  }
  // A catch-all such as src/** would make every directory look classified, so drift probes the map without them.
  const probeMap: RiskMap = { ...map, areas: map.areas.filter(area => !CATCH_ALL.test(area.path)) };
  for (const dir of candidateDirs) {
    if (!tierFor(probeMap, `${dir}/__probe__.ts`)) {
      findings.push({
        category: 'wiring',
        rule: 'wiring.drift',
        file: dir,
        message: 'Directory matches no risk-map area. Add it with a tier.',
        evidence: '',
      });
    }
  }
  return findings;
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/detectors/wiring.test.ts`

Expected: PASS, 18 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/detectors/wiring.ts tests/detectors/wiring.test.ts
git commit -m "feat: detect tests not wired to risk tiers and lanes"
```

---

## Task 14: Scan assembly and fixture acceptance

`scan` ties everything together and is checked against the planted ground truth: every smell in `bloated` must be found, nothing beyond it may be reported, and `clean` must report nothing. This is the test that tells you whether the detectors work as a system.

**Files:**
- Create: `tests/scan.test.ts`, `src/scan.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/scan.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CliError } from '../src/errors.ts';
import { defaultRiskMap, serializeRiskMap } from '../src/riskmap.ts';
import { scan } from '../src/scan.ts';
import { EvidenceReport } from '../src/schema.ts';
import { makeTree } from './helpers/tree.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const expected = JSON.parse(readFileSync(join(FIXTURES, 'bloated', 'expected.json'), 'utf8')) as {
  findings: Array<{ rule: string; file: string }>;
  flags: Record<string, string[]>;
  clusters: Array<{ subject: string; files: string[] }>;
};

const everyFinding = (report: EvidenceReport) => [...report.files.flatMap(file => file.findings), ...report.projectFindings];

describe('scan of the bloated fixture', () => {
  const report = scan(join(FIXTURES, 'bloated'), { commitLimit: 1 });

  it('produces a valid evidence report', () => {
    expect(EvidenceReport.safeParse(report).success).toBe(true);
    expect(report.runner).toBe('vitest');
    expect(report.phase).toBe('dev');
  });

  // Compared as sorted lists, not sets, so a rule that fires twice on one file is caught too.
  it('reports exactly the planted smells, each once', () => {
    const key = (finding: { rule: string; file: string }): string => `${finding.rule}@${finding.file}`;
    expect(everyFinding(report).map(key).sort()).toEqual(expected.findings.map(key).sort());
  });

  it('sets the quality flags on exactly the planted files', () => {
    const flags = Object.fromEntries(report.files.filter(file => file.flags.length > 0).map(file => [file.file, file.flags]));
    expect(flags).toEqual(expected.flags);
  });

  it('clusters files that share a subject', () => {
    expect(report.clusters.map(({ subject, files }) => ({ subject, files }))).toEqual(expected.clusters);
    expect(report.clusters.map(cluster => cluster.layers)).toEqual([['integration', 'unit'], ['unit']]);
  });

  it('annotates shim findings with the empty consumers list', () => {
    const shim = everyFinding(report).find(finding => finding.category === 'shim');
    expect(shim?.note).toContain('No consumers declared');
  });

  it('derives tiers from the risk map', () => {
    const tiers = Object.fromEntries(report.files.map(file => [file.file, file.tier]));
    expect(tiers['tests/persistence/store.unit.test.ts']).toBe('critical');
    expect(tiers['tests/ui/button.test.ts']).toBe('low');
    expect(tiers['tests/misc/invoice.test.ts']).toBeNull();
  });

  it('is deterministic', () => {
    expect(scan(join(FIXTURES, 'bloated'), { commitLimit: 1 })).toEqual(report);
  });
});

describe('scan of the clean fixture', () => {
  const report = scan(join(FIXTURES, 'clean'), { commitLimit: 1 });

  it('reports no findings and no flags', () => {
    expect(everyFinding(report)).toEqual([]);
    expect(report.files.flatMap(file => file.flags)).toEqual([]);
  });

  it('still tiers every file', () => {
    expect(report.files.map(file => file.tier)).toEqual(['critical', 'critical', 'low', 'standard']);
  });
});

describe('scan edge cases', () => {
  it('reports a missing risk map and treats shim consumers as unknown', () => {
    const root = makeTree({ 'src/legacy/x.ts': '', 'tests/legacy.test.ts': "import '../src/legacy/x.ts';\ndescribe('legacy', () => {});" });
    const report = scan(root);
    expect(report.riskMapPresent).toBe(false);
    expect(report.phase).toBeNull();
    expect(report.projectFindings.map(finding => finding.rule)).toContain('wiring.no-risk-map');
    expect(report.files[0]?.findings.find(finding => finding.category === 'shim')?.note).toContain('No risk map');
  });

  it('throws E_RISKMAP for an invalid risk map', () => {
    const root = makeTree({ '.testing/risk.yml': 'phase: nope\n' });
    expect(() => scan(root)).toThrow(CliError);
    expect(() => scan(root)).toThrow(expect.objectContaining({ code: 'E_RISKMAP' }));
  });

  it('counts a declared @subject, so a subprocess test still covers its code', () => {
    const root = makeTree({
      '.testing/risk.yml': `${serializeRiskMap({ ...defaultRiskMap(), areas: [{ path: 'src/**', tier: 'critical' }] })}`,
      'src/cli.ts': '',
      'tests/cli.test.ts': '/**\n * @subject src/cli.ts\n * @subject src/missing.ts\n */\nit("runs", () => { expect(1).toBe(2); });',
    });
    const report = scan(root);
    expect(report.files[0]?.subjects).toEqual(['src/cli.ts']);
    expect(report.files[0]?.tier).toBe('critical');
    expect(report.projectFindings.map(finding => finding.rule)).not.toContain('wiring.uncovered-critical');
  });

  it('lets a @risk tier name stand in for a test with no code subject', () => {
    const root = makeTree({
      '.testing/risk.yml': serializeRiskMap({ ...defaultRiskMap(), areas: [{ path: 'src/**', tier: 'critical' }] }),
      'tests/docs.test.ts': '/** @risk low */\nit("checks docs", () => { expect(1).toBe(1); });',
    });
    expect(scan(root).files[0]?.tier).toBe('low');
  });

  it('handles a project with no tests', () => {
    const report = scan(makeTree({ 'src/a.ts': '' }));
    expect(report.files).toEqual([]);
  });
});

describe('scan of declared subjects', () => {
  it('drops an @subject that points outside the root, at a directory or at a test file', () => {
    const root = makeTree({
      'src/cli.ts': '',
      'tests/other.test.ts': 'it("x", () => { expect(1).toBe(1); });',
      'tests/cli.test.ts': '/**\n * @subject ./src/cli.ts\n * @subject ../../x\n * @subject src\n * @subject tests/other.test.ts\n * @subject src\cli.ts\n */\nit("runs", () => { expect(1).toBe(2); });',
    });
    expect(scan(root).files.find(file => file.file === 'tests/cli.test.ts')?.subjects).toEqual(['src/cli.ts']);
  });
});

describe('scan with a file that cannot be parsed', () => {
  const deep = (): string => "it('deep', () => {\n  const nested = " + '['.repeat(6000) + ']'.repeat(6000) + ';\n  expect(nested).toBeTruthy();\n});';

  it('marks only that file as unparsed and reports the others normally', () => {
    const root = makeTree({
      'src/a.ts': '',
      'src/z.ts': '',
      'tests/a.test.ts': "import '../src/a.ts';\nit('a', () => { expect(1).toBe(2); });",
      'tests/m-bad.test.ts': deep(),
      'tests/z.test.ts': "import '../src/z.ts';\nit('z', () => { expect(1).toBe(2); });",
    });
    const report = scan(root);
    expect(EvidenceReport.safeParse(report).success).toBe(true);
    const byFile = Object.fromEntries(report.files.map(file => [file.file, file]));
    expect(byFile['tests/m-bad.test.ts']?.flags).toEqual(['unparsed']);
    expect(byFile['tests/m-bad.test.ts']?.tests).toBe(0);
    expect(byFile['tests/m-bad.test.ts']?.assertions).toBe(0);
    expect(byFile['tests/a.test.ts']).toMatchObject({ tests: 1, assertions: 1, flags: [], subjects: ['src/a.ts'] });
    expect(byFile['tests/z.test.ts']).toMatchObject({ tests: 1, assertions: 1, flags: [], subjects: ['src/z.ts'] });
    expect(scan(root).files.map(file => file.flags)).toEqual(report.files.map(file => file.flags));
  });

  it('still runs the line-based detectors on an unparsed file', () => {
    const root = makeTree({ 'tests/bad.test.ts': deep() + "\nconst root = '/Users/me/work';\n" });
    const report = scan(root);
    expect(report.files[0]?.flags).toEqual(['unparsed']);
    expect(report.files[0]?.findings.map(finding => finding.rule)).toContain('worktree.absolute-path');
    expect(report.files[0]?.cost.agent).toBe(Math.ceil(Buffer.byteLength(readFileSync(join(root, 'tests/bad.test.ts'), 'utf8')) / 4));
  });
});

describe('scan details', () => {
  const critical = (): string => serializeRiskMap({ ...defaultRiskMap(), areas: [{ path: 'src/**', tier: 'critical' }] });

  it('names the declared consumers in the shim note', () => {
    const root = makeTree({
      '.testing/risk.yml': serializeRiskMap({ ...defaultRiskMap(), consumers: ['mobile app', 'cli'] }),
      'src/legacy/x.ts': '',
      'tests/legacy.test.ts': "import '../src/legacy/x.ts';\ndescribe('legacy', () => {});",
    });
    const shim = scan(root).files[0]?.findings.find(finding => finding.category === 'shim');
    expect(shim?.note).toBe('Consumers declared in the risk map: mobile app, cli. Check whether any still needs this path.');
  });

  it('puts a hub-subject finding on the shared helper, at project level', () => {
    const files: Record<string, string> = { '.testing/risk.yml': critical(), 'src/shared.ts': '' };
    for (let index = 0; index < 11; index++) {
      files['src/m' + index + '.ts'] = '';
      files['tests/m' + index + '.test.ts'] = "import '../src/shared.ts';\nimport '../src/m" + index + ".ts';\nit('m" + index + "', () => { expect(1).toBe(2); });";
    }
    const report = scan(makeTree(files));
    const hub = report.projectFindings.filter(finding => finding.rule === 'redundancy.hub-subject');
    expect(hub.map(finding => finding.file)).toEqual(['src/shared.ts']);
    expect(report.files.flatMap(file => file.findings).map(finding => finding.rule)).not.toContain('redundancy.hub-subject');
  });

  it('estimates agent cost as a quarter of the byte length', () => {
    const text = "it('x', () => { expect('héllo').toBe('héllo!'); });";
    const report = scan(makeTree({ 'tests/x.test.ts': text }));
    expect(report.files[0]?.cost.agent).toBe(Math.ceil(Buffer.byteLength(text) / 4));
    expect(report.files[0]?.cost.wait).toBeNull();
    expect(report.files[0]?.cost.ci).toBeNull();
  });

  it('leaves churn and edits null for a tree outside git', () => {
    const report = scan(makeTree({ 'tests/x.test.ts': "it('x', () => { expect(1).toBe(2); });" }));
    expect(report.files[0]?.cost.churn).toBeNull();
    expect(report.files[0]?.cost.edits).toBeNull();
  });

  it('lets @risk low override a critical subject area but keeps the area', () => {
    const root = makeTree({
      '.testing/risk.yml': critical(),
      'src/a.ts': '',
      'tests/a.test.ts': "/** @risk low */\nimport '../src/a.ts';\nit('a', () => { expect(1).toBe(2); });",
    });
    expect(scan(root).files[0]).toMatchObject({ tier: 'low', area: 'src/**' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/scan.test.ts`

Expected: FAIL. Cannot import `../src/scan.ts`.

- [ ] **Step 3: Implement**

Create `src/scan.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { churnOf, commitFileSets } from './churn.ts';
import { detectFrequency } from './detectors/frequency.ts';
import { detectRedundancy } from './detectors/redundancy.ts';
import { detectShims } from './detectors/shims.ts';
import { detectWiring } from './detectors/wiring.ts';
import { detectWorktreeHazards } from './detectors/worktree.ts';
import { detectRunner, discoverTests } from './discover.ts';
import { declaredSubjects, openParseSession, parseTags, resolveSubjects, type ParsedFile } from './parse.ts';
import { candidateDirs } from './riskdraft.ts';
import { loadRiskMap, tierFor } from './riskmap.ts';
import { EVIDENCE_SCHEMA, Tier, type EvidenceReport, type FileFlag, type Finding, type RiskMap, type TestFileRecord } from './schema.ts';

export interface ScanOptions {
  commitLimit?: number;
}

const RANK: Record<Tier, number> = { critical: 3, standard: 2, low: 1 };

/**
 * The tier of a test file. Its subjects decide it (the highest tier among them); the file's own path is used only when it has
 * no subjects. A valid `@risk` tag overrides the tier, but `area` still names the subjects' area. An invalid `@risk` is
 * ignored when the subjects give a tier.
 */
function tierOfFile(map: RiskMap | null, rel: string, subjects: string[], risk: string | undefined): { tier: Tier | null; area: string | null } {
  if (!map) return { tier: null, area: null };
  const override = Tier.safeParse(risk);
  const hits = (subjects.length > 0 ? subjects : [rel]).map(path => tierFor(map, path)).filter((hit): hit is { tier: Tier; area: string } => hit !== null);
  if (hits.length === 0) return { tier: override.success ? override.data : null, area: null };
  const best = hits.reduce((a, b) => (RANK[b.tier] > RANK[a.tier] ? b : a));
  return { tier: override.success ? override.data : best.tier, area: best.area };
}

function flagsOf(parsed: ParsedFile): FileFlag[] {
  const flags: FileFlag[] = [];
  if (parsed.tautologies > 0) flags.push('tautological');
  if (parsed.assertions > 0 && parsed.snapshotAssertions === parsed.assertions) flags.push('snapshot-only');
  if (parsed.assertions > 0 && parsed.mockAssertions === parsed.assertions) flags.push('mock-only');
  if (parsed.tests.some(test => !test.todo && test.assertions === 0)) flags.push('no-direct-assertions');
  return flags;
}

interface LoadedFile {
  rel: string;
  text: string;
  lines: string[];
  parsed: ParsedFile;
  subjects: string[];
  /** The file could not be read as a parsed test, so its parse facts are empty. */
  unparsed: boolean;
}

const emptyParsed = (): ParsedFile => ({
  imports: [],
  tests: [],
  titles: [],
  assertions: 0,
  snapshotAssertions: 0,
  mockAssertions: 0,
  mockCalls: 0,
  tautologies: 0,
  tags: {},
});

/**
 * Read and parse every test file. One file that cannot be read or parsed (a parser stack overflow on absurd nesting, say)
 * must not stop the scan or hide the others: it keeps empty parse facts and is flagged `unparsed`. Its leading-comment tags
 * and line-based detectors still work when its text was read.
 */
function loadTests(root: string): LoadedFile[] {
  const session = openParseSession();
  try {
    return discoverTests(root).map(rel => {
      let text = '';
      let parsed = emptyParsed();
      let unparsed = false;
      try {
        text = readFileSync(join(root, rel), 'utf8');
        parsed = session.parse(rel, text);
      } catch {
        unparsed = true;
        parsed = { ...emptyParsed(), tags: parseTags(text) };
      }
      const subjects = [...new Set([...resolveSubjects(root, rel, parsed.imports), ...declaredSubjects(root, parsed.tags.subjects ?? [])])].sort();
      return { rel, text, lines: text.split(/\r?\n/), parsed, subjects, unparsed };
    });
  } finally {
    session.close();
  }
}

const byLocation = (a: Finding, b: Finding): number => (a.line ?? 0) - (b.line ?? 0) || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0);

/** Gather evidence about a project's tests. Never executes them and never judges: verdicts belong to the audit skill. */
export function scan(rootInput: string, options: ScanOptions = {}): EvidenceReport {
  const root = resolve(rootInput);
  const map = loadRiskMap(root);
  const sets = commitFileSets(root, options.commitLimit ?? 500);
  const loaded = loadTests(root);

  const records = new Map<string, TestFileRecord>();
  for (const file of loaded) {
    const { tier, area } = tierOfFile(map, file.rel, file.subjects, file.parsed.tags.risk);
    const { churn, edits } = churnOf(file.rel, file.subjects, sets);
    records.set(file.rel, {
      file: file.rel,
      tests: file.parsed.tests.length,
      assertions: file.parsed.assertions,
      flags: file.unparsed ? ['unparsed'] : flagsOf(file.parsed),
      subjects: file.subjects,
      tags: file.parsed.tags,
      tier,
      area,
      // `wait` and `ci` stay null in this version because it never runs tests; a later `time` command fills them.
      cost: { wait: null, agent: Math.ceil(Buffer.byteLength(file.text) / 4), ci: null, churn, edits },
      findings: [],
    });
  }

  const projectFindings: Finding[] = [];
  const attach = (findings: Finding[]): void => {
    for (const finding of findings) (records.get(finding.file)?.findings ?? projectFindings).push(finding);
  };

  const shimNote = !map
    ? 'No risk map, so consumers are unknown.'
    : map.consumers.length === 0
      ? 'No consumers declared in the risk map.'
      : `Consumers declared in the risk map: ${map.consumers.join(', ')}. Check whether any still needs this path.`;
  for (const file of loaded) {
    attach(detectShims(file.rel, file.parsed).map(finding => ({ ...finding, note: shimNote })));
    attach(detectWorktreeHazards(file.rel, file.lines));
  }
  const redundancy = detectRedundancy(loaded);
  attach(redundancy.findings);
  attach(
    detectWiring(
      map,
      [...records.values()].map(record => ({ rel: record.file, tier: record.tier, tags: record.tags, subjects: record.subjects })),
      candidateDirs(root),
    ),
  );
  attach(detectFrequency(root, map));

  for (const record of records.values()) record.findings.sort(byLocation);
  projectFindings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : byLocation(a, b)));

  return {
    schema: EVIDENCE_SCHEMA,
    root,
    runner: detectRunner(root),
    phase: map?.phase ?? null,
    riskMapPresent: map !== null,
    files: [...records.values()],
    clusters: redundancy.clusters,
    projectFindings,
  };
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/scan.test.ts`

Expected: PASS, 22 tests. If "reports exactly the planted smells, each once" fails, the diff names the exact `rule@file` that is missing, extra or duplicated; fix the fixture file or code block you mis-typed, never `expected.json`.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/scan.ts tests/scan.test.ts
git commit -m "feat: assemble the evidence report and verify it against planted ground truth"
```

---

## Task 15: Markdown report

**Files:**
- Create: `tests/report.test.ts`, `src/report.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/report.test.ts`:

```ts
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/report.ts';
import { scan } from '../src/scan.ts';
import { EVIDENCE_SCHEMA, type EvidenceReport, type Finding, type TestFileRecord } from '../src/schema.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function finding(overrides: Partial<Finding> & Pick<Finding, 'rule' | 'file'>): Finding {
  return { category: 'worktree', message: 'A message.', evidence: '', ...overrides };
}

function record(file: string, overrides: Partial<TestFileRecord> = {}): TestFileRecord {
  return {
    file,
    tests: 2,
    assertions: 3,
    flags: [],
    subjects: [],
    tags: {},
    tier: 'standard',
    area: null,
    cost: { wait: null, agent: 100, ci: null, churn: 0, edits: 0 },
    findings: [],
    ...overrides,
  };
}

function report(overrides: Partial<EvidenceReport> = {}): EvidenceReport {
  return {
    schema: EVIDENCE_SCHEMA,
    root: '/x',
    runner: 'vitest',
    phase: 'dev',
    riskMapPresent: true,
    files: [],
    clusters: [],
    projectFindings: [],
    ...overrides,
  };
}

/** The text of one `##` section, from its heading to the next `##` heading. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`);
  expect(start, `section "${heading}" is missing`).toBeGreaterThanOrEqual(0);
  const rest = markdown.slice(start + 3);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

const tableRows = (markdown: string): string[] => section(markdown, 'Test files').split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| File ') && !line.startsWith('|---'));

describe('renderMarkdown on the fixtures', () => {
  const bloated = renderMarkdown(scan(join(FIXTURES, 'bloated'), { commitLimit: 1 }));

  it('opens with the header bullets and the reading guide', () => {
    expect(bloated.startsWith('# Test audit evidence\n')).toBe(true);
    expect(bloated).toContain('- Runner: vitest');
    expect(bloated).toContain('- Phase: dev');
    expect(bloated).toContain('- Risk map: present');
    expect(bloated).toContain('How to read this');
    expect(bloated.indexOf('How to read this')).toBeLessThan(bloated.indexOf('## Findings by category'));
    expect(bloated).toContain('| shim | 3 |');
  });

  it('ranks the file with the most distinct rules first and shows its rules', () => {
    const rows = tableRows(bloated);
    expect(rows[0]).toContain('tests/net/server.test.ts');
    expect(rows[0]).toContain('worktree.fixed-port');
    expect(rows[0]).toContain('worktree.absolute-path, worktree.dot-git-dir, worktree.fixed-db-file, worktree.fixed-port, +2 more');
    expect(section(bloated, 'Test files')).toContain('(top 10 of 10, most evidence first)');
  });

  it('groups per-file findings by rule and keeps project findings apart', () => {
    const perFile = section(bloated, 'Per-file findings');
    expect(perFile).toContain('### worktree.fixed-port');
    expect(perFile).toContain('`tests/net/server.test.ts:8`');
    expect(perFile).not.toContain('frequency.');
    expect(perFile).not.toContain('src/auth/**');
    expect(section(bloated, 'Files sharing a subject')).toContain('tests/persistence/store.unit.test.ts');
  });

  it('lists project findings with uncovered-critical before the frequency rules', () => {
    const project = section(bloated, 'Project findings');
    expect(project).toContain('src/auth/**');
    expect(project.indexOf('wiring.uncovered-critical')).toBeGreaterThan(-1);
    expect(project.indexOf('wiring.uncovered-critical')).toBeLessThan(project.indexOf('wiring.drift'));
    expect(project.indexOf('wiring.drift')).toBeLessThan(project.indexOf('frequency.'));
    expect(project).toContain('**frequency.watch-default**');
  });

  it('says None. under both findings sections for the clean fixture', () => {
    const clean = renderMarkdown(scan(join(FIXTURES, 'clean'), { commitLimit: 1 }));
    expect(clean).toContain('## Project findings (0)\n\nNone.');
    expect(clean).toContain('## Per-file findings\n\nNone.');
    expect(clean).not.toContain('## Files sharing a subject');
  });
});

describe('renderMarkdown ranking', () => {
  it('puts an unparsed file first even with no findings, and lists it in the header', () => {
    const md = renderMarkdown(
      report({
        files: [
          record('tests/a.test.ts', { findings: [finding({ rule: 'worktree.fixed-port', file: 'tests/a.test.ts', line: 1 })] }),
          record('tests/z.test.ts', { flags: ['unparsed'], tests: 0, assertions: 0 }),
        ],
      }),
    );
    expect(tableRows(md)[0]).toContain('tests/z.test.ts');
    expect(md).toContain('- Unparsed files: 1. The tool could not read their structure, so read them directly: `tests/z.test.ts`');
    expect(tableRows(md)[0]).toContain('| ? | ? |');
  });

  it('caps the unparsed list at 10 paths', () => {
    const files = Array.from({ length: 13 }, (_, i) => record(`tests/u${String(i).padStart(2, '0')}.test.ts`, { flags: ['unparsed'] }));
    const md = renderMarkdown(report({ files }));
    expect(md).toContain('- Unparsed files: 13.');
    expect(md).toContain('`tests/u09.test.ts`');
    expect(md).not.toContain('`tests/u10.test.ts`');
    expect(md).toContain('+3 more');
  });

  it('omits the unparsed bullet when every file parsed', () => {
    expect(renderMarkdown(report({ files: [record('tests/a.test.ts')] }))).not.toContain('Unparsed files');
  });

  it('ranks distinct rules above raw finding counts', () => {
    const a = record('tests/a.test.ts', {
      findings: Array.from({ length: 5 }, (_, i) => finding({ rule: 'worktree.fixed-port', file: 'tests/a.test.ts', line: i + 1 })),
    });
    const b = record('tests/b.test.ts', {
      findings: ['worktree.fixed-port', 'worktree.shared-tmp', 'worktree.home-dir'].map((rule, i) => finding({ rule, file: 'tests/b.test.ts', line: i + 1 })),
    });
    const rows = tableRows(renderMarkdown(report({ files: [a, b] })));
    expect(rows[0]).toContain('tests/b.test.ts');
    expect(rows[1]).toContain('tests/a.test.ts');
  });

  it('breaks ties by finding count, then agent tokens, then path', () => {
    const one = (file: string, agent: number, count = 1): TestFileRecord =>
      record(file, {
        cost: { wait: null, agent, ci: null, churn: 0, edits: 0 },
        findings: Array.from({ length: count }, (_, i) => finding({ rule: 'worktree.fixed-port', file, line: i + 1 })),
      });
    const md = renderMarkdown(report({ files: [one('tests/d.test.ts', 10), one('tests/c.test.ts', 50), one('tests/b.test.ts', 50), one('tests/e.test.ts', 1, 3)] }));
    expect(tableRows(md).map(row => row.split('|')[1]!.trim())).toEqual(['tests/e.test.ts', 'tests/b.test.ts', 'tests/c.test.ts', 'tests/d.test.ts']);
  });

  it('prints distinct rules with counts, most frequent first, at most four', () => {
    const f = 'tests/a.test.ts';
    const rules = ['worktree.fixed-port', 'worktree.fixed-port', 'redundancy.shared-subject', 'worktree.home-dir', 'shim.path-marker', 'shim.title-marker', 'worktree.shared-tmp'];
    const md = renderMarkdown(report({ files: [record(f, { findings: rules.map((rule, i) => finding({ rule, file: f, line: i + 1 })) })] }));
    expect(tableRows(md)[0]).toContain('| worktree.fixed-port x2, redundancy.shared-subject, shim.path-marker, shim.title-marker, +2 more |');
  });
});

describe('renderMarkdown caps', () => {
  const five = (): EvidenceReport =>
    report({
      files: ['a', 'b', 'c', 'd', 'e'].map((name, i) => {
        const file = `tests/${name}.test.ts`;
        return record(file, {
          cost: { wait: null, agent: 100 - i, ci: null, churn: 0, edits: 0 },
          findings: i < 3 ? Array.from({ length: 3 - i }, (_, n) => finding({ rule: 'worktree.fixed-port', file, line: n + 1 })) : [],
        });
      }),
    });

  it('limits the table to maxFiles and counts what was omitted', () => {
    const md = renderMarkdown(five(), { maxFiles: 2 });
    expect(tableRows(md)).toHaveLength(2);
    expect(section(md, 'Test files')).toContain('(top 2 of 5, most evidence first)');
    // Omitted: c (1 finding), d and e (none).
    expect(md).toContain('3 more files omitted (1 findings, 2 with none); the full data is in the JSON from the scan command.');
  });

  it('shows every file and no omission line when under the cap', () => {
    const md = renderMarkdown(five());
    expect(tableRows(md)).toHaveLength(5);
    expect(md).not.toContain('omitted');
  });

  it('truncates a rule with more than maxPerRule findings', () => {
    const f = 'tests/a.test.ts';
    const findings = Array.from({ length: 5 }, (_, i) => finding({ rule: 'worktree.fixed-port', file: f, line: i + 1 }));
    const md = renderMarkdown(report({ files: [record(f, { findings })] }), { maxPerRule: 2 });
    const perFile = section(md, 'Per-file findings');
    expect(perFile).toContain('`tests/a.test.ts:1`');
    expect(perFile).toContain('`tests/a.test.ts:2`');
    expect(perFile).not.toContain('`tests/a.test.ts:3`');
    expect(perFile).toContain('- +3 more (see the scan JSON)');
  });

  it('defaults to 40 files and 30 findings per rule', () => {
    const files = Array.from({ length: 45 }, (_, i) => record(`tests/f${String(i).padStart(2, '0')}.test.ts`));
    expect(tableRows(renderMarkdown(report({ files })))).toHaveLength(40);
    const f = 'tests/a.test.ts';
    const findings = Array.from({ length: 33 }, (_, i) => finding({ rule: 'worktree.fixed-port', file: f, line: i + 1 }));
    expect(renderMarkdown(report({ files: [record(f, { findings })] }))).toContain('- +3 more (see the scan JSON)');
  });
});

describe('renderMarkdown ordering and grouping', () => {
  it('orders lines numerically, with line-less findings first', () => {
    const f = 'tests/a.test.ts';
    const findings = [100, 10, 2, 9, 1].map(line => finding({ rule: 'worktree.fixed-port', file: f, line }));
    findings.push(finding({ rule: 'worktree.fixed-port', file: f }));
    const perFile = section(renderMarkdown(report({ files: [record(f, { findings })] })), 'Per-file findings');
    const positions = ['`tests/a.test.ts`', '`tests/a.test.ts:1`', '`tests/a.test.ts:2`', '`tests/a.test.ts:9`', '`tests/a.test.ts:10`', '`tests/a.test.ts:100`'].map(token => perFile.indexOf(token));
    expect(positions.every(position => position > -1)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
  });

  it('orders project findings numerically by line within a file', () => {
    const findings = [10, 9, 2].map(line => finding({ category: 'frequency', rule: 'frequency.hook-full-suite', file: 'package.json', line }));
    const project = section(renderMarkdown(report({ projectFindings: findings })), 'Project findings (3)');
    expect(project.indexOf('package.json:2`')).toBeLessThan(project.indexOf('package.json:9`'));
    expect(project.indexOf('package.json:9`')).toBeLessThan(project.indexOf('package.json:10`'));
  });

  it('orders project findings: wiring first in its own rule order, then schema category order', () => {
    const make = (category: Finding['category'], rule: string, file = 'x'): Finding => finding({ category, rule, file });
    const md = renderMarkdown(
      report({
        projectFindings: [
          make('frequency', 'frequency.watch-default', 'package.json'),
          make('wiring', 'wiring.no-risk-map'),
          make('redundancy', 'redundancy.hub-subject', 'src/hub.ts'),
          make('wiring', 'wiring.drift'),
          make('wiring', 'wiring.uncovered-critical'),
          make('shim', 'shim.path-marker', 'src/old'),
        ],
      }),
    );
    const order = ['wiring.uncovered-critical', 'wiring.drift', 'wiring.no-risk-map', 'redundancy.hub-subject', 'shim.path-marker', 'frequency.watch-default'].map(rule => md.indexOf(`**${rule}**`));
    expect(order.every(position => position > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('groups per-file findings by category order then rule, with the message once per rule', () => {
    const f = 'tests/a.test.ts';
    const findings = [
      finding({ category: 'worktree', rule: 'worktree.shared-tmp', file: f, line: 3, message: 'Tmp message.' }),
      finding({ category: 'redundancy', rule: 'redundancy.duplicate-title', file: f, line: 5, message: 'Dup message.' }),
      finding({ category: 'worktree', rule: 'worktree.fixed-port', file: f, line: 7, message: 'Port message.', evidence: 'listen(3000)', note: 'check it' }),
      finding({ category: 'worktree', rule: 'worktree.fixed-port', file: f, line: 8, message: 'Port message.' }),
    ];
    const perFile = section(renderMarkdown(report({ files: [record(f, { findings })] })), 'Per-file findings');
    expect(perFile.indexOf('### redundancy.duplicate-title')).toBeLessThan(perFile.indexOf('### worktree.fixed-port'));
    expect(perFile.indexOf('### worktree.fixed-port')).toBeLessThan(perFile.indexOf('### worktree.shared-tmp'));
    expect(perFile.split('Port message.')).toHaveLength(2);
    expect(perFile).toContain('- `tests/a.test.ts:7` `listen(3000)` (check it)');
    expect(perFile).toContain('- `tests/a.test.ts:8`\n');
  });

  it('prints clusters only when there are some', () => {
    const md = renderMarkdown(report({ clusters: [{ subject: 'src/store.ts', files: ['tests/a.test.ts', 'tests/b.test.ts'], layers: ['unit', 'integration'] }] }));
    expect(section(md, 'Files sharing a subject')).toContain('- `src/store.ts` (unit, integration): `tests/a.test.ts`, `tests/b.test.ts`');
    expect(renderMarkdown(report())).not.toContain('Files sharing a subject');
  });

  it('counts project and per-file findings together in the category table', () => {
    const md = renderMarkdown(
      report({
        files: [record('tests/a.test.ts', { findings: [finding({ rule: 'worktree.fixed-port', file: 'tests/a.test.ts', line: 1 })] })],
        projectFindings: [finding({ category: 'worktree', rule: 'worktree.home-dir', file: 'x' })],
      }),
    );
    expect(md).toContain('| worktree | 2 |');
  });
});

describe('renderMarkdown escaping', () => {
  it('escapes pipes in table cells', () => {
    const md = renderMarkdown(report({ files: [record('a|b.test.ts')] }));
    expect(tableRows(md)[0]).toContain('| a\\|b.test.ts |');
  });

  it('does not let a backtick in a path break a code span', () => {
    const f = 'tests/we`ird.test.ts';
    const md = renderMarkdown(report({ files: [record(f, { findings: [finding({ rule: 'worktree.fixed-port', file: f, line: 4 })] })] }));
    expect(md).toContain('- ``tests/we`ird.test.ts:4``');
  });

  it('pads a span whose text begins or ends with a backtick', () => {
    const md = renderMarkdown(report({ projectFindings: [finding({ rule: 'frequency.watch-default', category: 'frequency', file: 'package.json', evidence: '`x`' })] }));
    expect(md).toContain('`` `x` ``');
  });

  it('collapses newlines and CRLF in messages, evidence, notes and paths', () => {
    const md = renderMarkdown(
      report({
        files: [record('tests/a\r\nb.test.ts', { findings: [finding({ rule: 'worktree.fixed-port', file: 'tests/a\r\nb.test.ts', line: 1, message: 'Line one.\r\nLine two.', evidence: 'a\r\n\tb\n  c', note: 'n1\nn2' })] })],
        projectFindings: [finding({ category: 'frequency', rule: 'frequency.watch-default', file: 'package.json', message: 'm1\r\nm2', evidence: 'e1\ne2', note: 'x\r\ny' })],
      }),
    );
    expect(md).not.toContain('\r');
    expect(md).toContain('Line one. Line two.');
    expect(md).toContain('`a b c`');
    expect(md).toContain('(n1 n2)');
    expect(md).toContain('`tests/a b.test.ts:1`');
    expect(md).toContain('**frequency.watch-default**: m1 m2 Evidence: `e1 e2`. Note: x y');
  });

  it('caps long evidence at 160 characters with an ellipsis', () => {
    const f = 'tests/a.test.ts';
    const md = renderMarkdown(report({ files: [record(f, { findings: [finding({ rule: 'worktree.fixed-port', file: f, line: 1, evidence: 'x'.repeat(500) })] })] }));
    const span = /`tests\/a\.test\.ts:1` `(x+…)`/.exec(md);
    expect(span).not.toBeNull();
    expect(span![1]!.length).toBe(160);
    expect(md).not.toContain('x'.repeat(161));
  });

  it('keeps evidence of exactly 160 characters intact', () => {
    const f = 'tests/a.test.ts';
    const md = renderMarkdown(report({ files: [record(f, { findings: [finding({ rule: 'worktree.fixed-port', file: f, line: 1, evidence: 'y'.repeat(160) })] })] }));
    expect(md).toContain(`\`${'y'.repeat(160)}\``);
  });
});

describe('renderMarkdown cells and labels', () => {
  it('labels a missing tier untiered with a risk map and no map without one', () => {
    const withMap = renderMarkdown(report({ files: [record('tests/a.test.ts', { tier: null })] }));
    expect(tableRows(withMap)[0]).toContain('| untiered |');
    const without = renderMarkdown(report({ phase: null, riskMapPresent: false, files: [record('tests/a.test.ts', { tier: null })] }));
    expect(tableRows(without)[0]).toContain('| no map |');
    expect(without).toContain('- Phase: unknown (no risk map)');
    expect(without).toContain('- Risk map: missing');
  });

  it('prints churn over edits, or n/a without history or subjects', () => {
    const md = renderMarkdown(
      report({
        files: [
          record('tests/a.test.ts', { cost: { wait: null, agent: 3, ci: null, churn: 1, edits: 3 } }),
          record('tests/b.test.ts', { cost: { wait: null, agent: 2, ci: null, churn: null, edits: null } }),
          record('tests/c.test.ts', { cost: { wait: null, agent: 1, ci: null, churn: null, edits: 4 } }),
        ],
      }),
    );
    const rows = tableRows(md);
    expect(rows[0]).toContain('| 3 | 1/3 |');
    expect(rows[1]).toContain('| 2 | n/a |');
    expect(rows[2]).toContain('| 1 | n/a |');
  });

  it('prints the lane, flags and dashes for empty cells', () => {
    const md = renderMarkdown(
      report({ files: [record('tests/a.test.ts', { tags: { lane: 'edit' }, flags: ['tautological', 'mock-only'] }), record('tests/b.test.ts')] }),
    );
    const rows = tableRows(md);
    expect(rows[0]).toContain('| standard | edit | 2 | 3 | tautological, mock-only | 100 | 0/0 | - |');
    expect(rows[1]).toContain('| standard | - | 2 | 3 | - | 100 | 0/0 | - |');
  });
});

describe('renderMarkdown shape', () => {
  it('renders an empty report', () => {
    const md = renderMarkdown(report());
    expect(md).toContain('- Test files: 0');
    expect(md).toContain('## Project findings (0)\n\nNone.');
    expect(md).toContain('## Per-file findings\n\nNone.');
    expect(md).toContain('| redundancy | 0 |');
  });

  it('renders a report with no phase', () => {
    expect(renderMarkdown(report({ phase: null }))).toContain('- Phase: unknown (no risk map)');
  });

  it('ends with exactly one newline and never uses carriage returns', () => {
    for (const md of [renderMarkdown(report()), renderMarkdown(scan(join(FIXTURES, 'bloated'), { commitLimit: 1 }))]) {
      expect(md.endsWith('\n')).toBe(true);
      expect(md.endsWith('\n\n')).toBe(false);
      expect(md).not.toContain('\r');
    }
  });

  it('is deterministic', () => {
    const scanned = scan(join(FIXTURES, 'bloated'), { commitLimit: 1 });
    expect(renderMarkdown(scanned)).toBe(renderMarkdown(scanned));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/report.test.ts`

Expected: FAIL. Cannot import `../src/report.ts`.

- [ ] **Step 3: Implement**

Create `src/report.ts`:

```ts
import { Category, type EvidenceReport, type Finding, type TestFileRecord } from './schema.ts';

export interface ReportOptions {
  /** How many test files the table lists. */
  maxFiles?: number;
  /** How many findings one rule lists in the per-file section. */
  maxPerRule?: number;
}

const DEFAULT_MAX_FILES = 40;
const DEFAULT_MAX_PER_RULE = 30;
const MAX_EVIDENCE = 160;
const MAX_UNPARSED_LISTED = 10;
const MAX_RULES_PER_ROW = 4;

/** Wiring rules in the order the audit should read them; other wiring rules follow. */
const WIRING_ORDER = ['wiring.uncovered-critical', 'wiring.drift', 'wiring.no-risk-map'];

/** Any run of whitespace, newlines and carriage returns included, becomes one space, so a value stays on one line. */
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** A table cell: flattened, with pipes escaped. */
const cell = (text: string): string => flat(text).replace(/\|/g, '\\|');

/** An inline code span whose fence is longer than any backtick run inside, so the text cannot break out of it. */
function span(text: string): string {
  const body = flat(text);
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map(run => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = body.startsWith('`') || body.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${body}${pad}${fence}`;
}

function clip(text: string): string {
  const chars = [...flat(text)];
  return chars.length > MAX_EVIDENCE ? `${chars.slice(0, MAX_EVIDENCE - 1).join('')}…` : chars.join('');
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const where = (finding: Finding): string => `${flat(finding.file)}${finding.line ? `:${finding.line}` : ''}`;
/** Findings without a line sort first (lines are positive); lines compare as numbers, never as text. */
const byLocation = (a: Finding, b: Finding): number => compare(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || compare(a.rule, b.rule);

const categoryIndex = (category: Finding['category']): number => Category.options.indexOf(category);

/** Project findings read wiring first (the risk map's own gaps), then the other categories in schema order. */
function byProjectOrder(a: Finding, b: Finding): number {
  const rank = (finding: Finding): number => (finding.category === 'wiring' ? 0 : 1 + categoryIndex(finding.category));
  const ruleRank = (finding: Finding): number => (finding.category === 'wiring' ? (WIRING_ORDER.includes(finding.rule) ? WIRING_ORDER.indexOf(finding.rule) : WIRING_ORDER.length) : 0);
  return rank(a) - rank(b) || ruleRank(a) - ruleRank(b) || byLocation(a, b);
}

/** The distinct rules of a file with their counts, most frequent first, then alphabetical. */
function ruleCounts(file: TestFileRecord): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const finding of file.findings) counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]));
}

const isUnparsed = (file: TestFileRecord): boolean => file.flags.includes('unparsed');

function rulesCell(file: TestFileRecord): string {
  const counts = ruleCounts(file);
  if (counts.length === 0) return '-';
  const shown = counts.slice(0, MAX_RULES_PER_ROW).map(([rule, count]) => (count > 1 ? `${rule} x${count}` : rule));
  if (counts.length > MAX_RULES_PER_ROW) shown.push(`+${counts.length - MAX_RULES_PER_ROW} more`);
  return cell(shown.join(', '));
}

/** Unparsed files first (their structure is unknown), then the breadth of evidence, its volume, the file's size, and the path. */
function rankFiles(files: TestFileRecord[]): TestFileRecord[] {
  return files
    .map(file => ({ file, distinct: ruleCounts(file).length }))
    .sort(
      (a, b) =>
        Number(isUnparsed(b.file)) - Number(isUnparsed(a.file)) ||
        b.distinct - a.distinct ||
        b.file.findings.length - a.file.findings.length ||
        b.file.cost.agent - a.file.cost.agent ||
        compare(a.file.file, b.file.file),
    )
    .map(entry => entry.file);
}

function projectLine(finding: Finding): string {
  const evidence = finding.evidence ? ` Evidence: ${span(clip(finding.evidence))}.` : '';
  const note = finding.note ? ` Note: ${flat(finding.note)}` : '';
  return `- ${span(where(finding))} **${flat(finding.rule)}**: ${flat(finding.message)}${evidence}${note}`;
}

function fileLine(finding: Finding): string {
  const evidence = finding.evidence ? ` ${span(clip(finding.evidence))}` : '';
  const note = finding.note ? ` (${flat(finding.note)})` : '';
  return `- ${span(where(finding))}${evidence}${note}`;
}

/**
 * Markdown view of an evidence report for the audit skill to read and the owner to skim. It ranks, caps and de-duplicates
 * so the evidence that matters comes first; the scan JSON holds everything. Pure and deterministic.
 */
export function renderMarkdown(report: EvidenceReport, options: ReportOptions = {}): string {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxPerRule = options.maxPerRule ?? DEFAULT_MAX_PER_RULE;
  const perFile = report.files.flatMap(file => file.findings);
  const all = [...perFile, ...report.projectFindings];
  const unparsed = report.files.filter(isUnparsed).map(file => file.file).sort(compare);

  const out: string[] = [
    '# Test audit evidence',
    '',
    `- Runner: ${report.runner}`,
    `- Phase: ${report.phase ?? 'unknown (no risk map)'}`,
    `- Risk map: ${report.riskMapPresent ? 'present' : 'missing'}`,
    `- Test files: ${report.files.length}`,
  ];
  if (unparsed.length > 0) {
    const listed = unparsed.slice(0, MAX_UNPARSED_LISTED).map(span);
    if (unparsed.length > MAX_UNPARSED_LISTED) listed.push(`+${unparsed.length - MAX_UNPARSED_LISTED} more`);
    out.push(`- Unparsed files: ${unparsed.length}. The tool could not read their structure, so read them directly: ${listed.join(', ')}`);
  }
  out.push(
    '',
    '**How to read this.** Findings are evidence, not verdicts: judge each one against the risk map and the test itself.',
    'Files are ranked with unparsed files first, then by distinct finding rules, then total findings, then agent tokens.',
    'Agent is the estimated tokens in the file. Churn/edits counts edits that touched the test without the code it covers, over all edits that modified it; n/a means no git history or no resolvable subject.',
    'Wait time and CI minutes need a timed run and are not in this report.',
    'Flags: tautological, snapshot-only, mock-only, no-direct-assertions (possibly assertions in a helper), unparsed.',
    '',
    '## Findings by category',
    '',
    '| Category | Count |',
    '|---|---|',
    ...Category.options.map(category => `| ${category} | ${all.filter(finding => finding.category === category).length} |`),
    '',
    `## Project findings (${report.projectFindings.length})`,
    '',
  );
  if (report.projectFindings.length === 0) out.push('None.');
  else for (const finding of [...report.projectFindings].sort(byProjectOrder)) out.push(projectLine(finding));

  const ranked = rankFiles(report.files);
  const shown = ranked.slice(0, maxFiles);
  out.push('', `## Test files (top ${shown.length} of ${ranked.length}, most evidence first)`, '');
  if (ranked.length === 0) out.push('None.');
  else {
    out.push('| File | Tier | Lane | Tests | Asserts | Flags | Agent tokens | Churn/edits | Rules |', '|---|---|---|---|---|---|---|---|---|');
    for (const file of shown) {
      const tier = file.tier ?? (report.riskMapPresent ? 'untiered' : 'no map');
      const structure = isUnparsed(file) ? ['?', '?'] : [String(file.tests), String(file.assertions)];
      const churn = file.cost.churn !== null && file.cost.edits !== null ? `${file.cost.churn}/${file.cost.edits}` : 'n/a';
      out.push(
        `| ${cell(file.file)} | ${tier} | ${file.tags.lane ?? '-'} | ${structure[0]} | ${structure[1]} | ${cell(file.flags.join(', ')) || '-'} | ${file.cost.agent} | ${churn} | ${rulesCell(file)} |`,
      );
    }
  }
  const omitted = ranked.slice(shown.length);
  if (omitted.length > 0) {
    const findings = omitted.reduce((sum, file) => sum + file.findings.length, 0);
    const none = omitted.filter(file => file.findings.length === 0).length;
    out.push('', `${omitted.length} more files omitted (${findings} findings, ${none} with none); the full data is in the JSON from the scan command.`);
  }

  if (report.clusters.length > 0) {
    out.push('', '## Files sharing a subject', '');
    for (const cluster of report.clusters) out.push(`- ${span(cluster.subject)} (${cluster.layers.map(flat).join(', ')}): ${cluster.files.map(span).join(', ')}`);
  }

  out.push('', '## Per-file findings', '');
  if (perFile.length === 0) out.push('None.');
  for (const category of Category.options) {
    const rules = [...new Set(perFile.filter(finding => finding.category === category).map(finding => finding.rule))].sort(compare);
    for (const rule of rules) {
      const group = perFile.filter(finding => finding.category === category && finding.rule === rule).sort(byLocation);
      out.push(`### ${flat(rule)}`, '', flat(group[0]!.message), '');
      for (const finding of group.slice(0, maxPerRule)) out.push(fileLine(finding));
      if (group.length > maxPerRule) out.push(`- +${group.length - maxPerRule} more (see the scan JSON)`);
      out.push('');
    }
  }
  return out.join('\n').trimEnd() + '\n';
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/report.test.ts`

Expected: PASS, 34 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/report.ts tests/report.test.ts
git commit -m "feat: render the evidence report as Markdown"
```

---

## Task 16: CLI

Four commands: `capabilities`, `risk-draft [--write]`, `scan`, `report [--max-files n] [--max-per-rule n]`. Failures are one-line JSON on stderr with a stable code and a hint (`E_USAGE` exits 2; everything else exits 1), including a broken runtime (`E_RUNTIME_BROKEN`) and a root that is not a directory. A broken pipe exits quietly. `risk-draft --write` publishes the file atomically and never overwrites.

**Files:**
- Create: `tests/cli.test.ts`, `src/cli.ts`, `scripts/tests.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/cli.test.ts`:

```ts
/**
 * @lane merge
 * @subject src/cli.ts
 * @subject scripts/tests.mjs
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { failureFor, ignoreBrokenPipe, positiveInteger } from '../src/cli.ts';
import { CliError } from '../src/errors.ts';
import { makeTree } from './helpers/tree.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');

interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  launcher?: string;
}

const run = (options: RunOptions, ...args: string[]) =>
  spawnSync(process.execPath, [options.launcher ?? join(ROOT, 'scripts', 'tests.mjs'), ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: { ...process.env, AGENT_TESTS_DEBUG: '', ...options.env },
  });
const tests = (...args: string[]) => run({}, ...args);

/** The parsed error object, after asserting stderr is exactly one JSON line. */
function errorOf(stderr: string): { code: string; message: string; hint?: string; detail?: string } {
  const lines = stderr.trimEnd().split('\n');
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!).error;
}

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

const canSymlink = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-tests-symlink-'));
  try {
    symlinkSync(join(dir, 'nowhere'), join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

describe('tests CLI', () => {
  it('prints capabilities as JSON, with the package version', () => {
    const result = tests('capabilities');
    expect(result.status).toBe(0);
    const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
    expect(JSON.parse(result.stdout)).toMatchObject({ name: 'agent-tests', version, commands: ['capabilities', 'risk-draft', 'scan', 'report'] });
  });

  it('rejects an unknown command with E_USAGE and exit 2', () => {
    const result = tests('frobnicate');
    expect(result.status).toBe(2);
    expect(errorOf(result.stderr).code).toBe('E_USAGE');
  });

  it('rejects an unknown flag with E_USAGE', () => {
    const result = tests('scan', '--bogus');
    expect(result.status).toBe(2);
    expect(errorOf(result.stderr).code).toBe('E_USAGE');
  });

  it('scan prints evidence JSON', () => {
    const result = tests('scan', '--root', join(FIXTURES, 'clean'));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).schema).toBe('agent-tests/evidence@1');
  });

  it('report prints Markdown', () => {
    const result = tests('report', '--root', join(FIXTURES, 'bloated'));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('# Test audit evidence');
  });

  it('reports an invalid risk map as E_RISKMAP', () => {
    const result = tests('scan', '--root', makeTree({ '.testing/risk.yml': 'phase: nope\n' }));
    expect(result.status).toBe(1);
    expect(errorOf(result.stderr).code).toBe('E_RISKMAP');
  });

  it('risk-draft prints YAML, and --write creates the file once', () => {
    const root = makeTree({ 'src/auth/a.ts': '', 'src/ui/b.ts': '' });
    const preview = tests('risk-draft', '--root', root);
    expect(preview.status).toBe(0);
    expect(preview.stdout).toContain('src/auth/**');
    expect(existsSync(join(root, '.testing', 'risk.yml'))).toBe(false);

    const written = tests('risk-draft', '--root', root, '--write');
    expect(written.status).toBe(0);
    expect(existsSync(join(root, '.testing', 'risk.yml'))).toBe(true);
    expect(readdirSync(join(root, '.testing'))).toEqual(['risk.yml']);

    const again = tests('risk-draft', '--root', root, '--write');
    expect(again.status).toBe(1);
    expect(errorOf(again.stderr).code).toBe('E_EXISTS');
  });

  it('rejects a root that does not exist with E_USAGE', () => {
    const missing = join(ROOT, 'no-such-directory');
    const result = tests('scan', '--root', missing);
    expect(result.status).toBe(2);
    const error = errorOf(result.stderr);
    expect(error.code).toBe('E_USAGE');
    expect(error.message).toBe(`Root does not exist: ${missing}`);
  });

  describe('roots', () => {
    it('rejects a file root on scan, report and risk-draft', () => {
      const file = join(makeTree({ 'a-file.txt': 'x' }), 'a-file.txt');
      for (const command of ['scan', 'report', 'risk-draft']) {
        const result = tests(command, '--root', file);
        expect(result.status, command).toBe(2);
        const error = errorOf(result.stderr);
        expect(error.code).toBe('E_USAGE');
        expect(error.message).toBe(`Root is not a directory: ${file}`);
      }
    });

    it.each([[['--root=']], [['--root', '']]])('rejects an empty root (%j)', args => {
      const result = tests('scan', ...args);
      expect(result.status).toBe(2);
      const error = errorOf(result.stderr);
      expect(error.code).toBe('E_USAGE');
      expect(error.message).toBe('--root needs a directory');
    });

    it('treats a root path that runs through a file as a missing root', () => {
      const file = join(makeTree({ 'a-file.txt': 'x' }), 'a-file.txt');
      const result = tests('scan', '--root', join(file, 'sub'));
      expect(result.status).toBe(2);
      expect(errorOf(result.stderr).code).toBe('E_USAGE');
    });

    it('accepts --root=<dir>', () => {
      const result = tests('scan', `--root=${join(FIXTURES, 'clean')}`);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).schema).toBe('agent-tests/evidence@1');
    });

    it('accepts a root whose path has spaces', () => {
      const root = join(scratchDir('agent tests '), 'my project');
      mkdirSync(root);
      const result = tests('scan', '--root', root);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).root).toBe(root);
    });

    it('resolves a relative root against the working directory', () => {
      const result = run({ cwd: FIXTURES }, 'scan', '--root', 'clean');
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).root).toBe(join(FIXTURES, 'clean'));
    });
  });

  describe('report caps', () => {
    it('--max-files caps the test-file table and says how many were omitted', () => {
      const result = tests('report', '--root', join(FIXTURES, 'bloated'), '--max-files', '1');
      expect(result.status).toBe(0);
      const section = result.stdout.split('\n## Test files')[1]!.split('\n## ')[0]!;
      const rows = section.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| File ') && !line.startsWith('|---'));
      expect(rows).toHaveLength(1);
      expect(result.stdout).toMatch(/\d+ more files omitted/);
    });

    it('--max-per-rule is accepted', () => {
      const result = tests('report', '--root', join(FIXTURES, 'bloated'), '--max-per-rule', '1');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('# Test audit evidence');
    });

    it('rejects a bad --max-files end to end', () => {
      const result = tests('report', '--root', join(FIXTURES, 'clean'), '--max-files', '0');
      expect(result.status).toBe(2);
      const error = errorOf(result.stderr);
      expect(error.code).toBe('E_USAGE');
      expect(error.message).toContain('--max-files must be a positive integer');
    });

    it('rejects a bad --max-per-rule end to end', () => {
      const result = tests('report', '--root', join(FIXTURES, 'clean'), '--max-per-rule=abc');
      expect(result.status).toBe(2);
      const error = errorOf(result.stderr);
      expect(error.code).toBe('E_USAGE');
      expect(error.message).toContain('--max-per-rule must be a positive integer');
    });

    it('scan ignores --max-files: the output is the same with and without it', () => {
      const root = join(FIXTURES, 'bloated');
      const plain = tests('scan', '--root', root);
      const flagged = tests('scan', '--root', root, '--max-files', '3');
      expect(plain.status).toBe(0);
      expect(flagged.status).toBe(0);
      expect(JSON.parse(flagged.stdout)).toEqual(JSON.parse(plain.stdout));
    });
  });

  describe('positiveInteger', () => {
    it('returns undefined when the option is absent', () => {
      expect(positiveInteger('max-files', undefined)).toBeUndefined();
    });

    it.each([
      ['1', 1],
      ['40', 40],
      ['007', 7],
    ])('accepts %s', (raw, value) => {
      expect(positiveInteger('max-files', raw)).toBe(value);
    });

    it.each(['0', 'abc', '-1', '1.5', '', ' 3', '1e3', '99999999999999999999'])('rejects "%s" with E_USAGE naming the option', raw => {
      const failure = (() => {
        try {
          positiveInteger('max-per-rule', raw);
        } catch (error) {
          return error;
        }
      })();
      expect(failure).toBeInstanceOf(CliError);
      expect((failure as CliError).code).toBe('E_USAGE');
      expect((failure as CliError).message).toContain('--max-per-rule must be a positive integer');
    });
  });

  describe('risk-draft --write', () => {
    it('leaves an existing risk map untouched, byte for byte', () => {
      const original = '# hand written\nphase: dev\r\n';
      const root = makeTree({ '.testing/risk.yml': original, 'src/auth/a.ts': '' });
      const result = tests('risk-draft', '--root', root, '--write');
      expect(result.status).toBe(1);
      expect(errorOf(result.stderr).code).toBe('E_EXISTS');
      expect(readFileSync(join(root, '.testing', 'risk.yml'), 'utf8')).toBe(original);
      expect(readdirSync(join(root, '.testing'))).toEqual(['risk.yml']);
    });

    it.skipIf(!canSymlink)('treats a dangling symlink at the target as existing and does not write through it', () => {
      const root = makeTree({ 'src/auth/a.ts': '' });
      mkdirSync(join(root, '.testing'));
      const outside = join(root, 'elsewhere.yml');
      symlinkSync(outside, join(root, '.testing', 'risk.yml'));
      const result = tests('risk-draft', '--root', root, '--write');
      expect(result.status).toBe(1);
      expect(errorOf(result.stderr).code).toBe('E_EXISTS');
      expect(existsSync(outside)).toBe(false);
      expect(lstatSync(join(root, '.testing', 'risk.yml')).isSymbolicLink()).toBe(true);
      expect(readdirSync(join(root, '.testing'))).toEqual(['risk.yml']);
    });

    it('reports E_EXISTS when .testing is a file', () => {
      const root = makeTree({ '.testing': 'not a directory', 'src/auth/a.ts': '' });
      const result = tests('risk-draft', '--root', root, '--write');
      expect(result.status).toBe(1);
      const error = errorOf(result.stderr);
      expect(error.code).toBe('E_EXISTS');
      expect(error.message).toBe('.testing exists and is not a directory');
      expect(readFileSync(join(root, '.testing'), 'utf8')).toBe('not a directory');
    });
  });

  describe('error contract', () => {
    it('E_USAGE carries the usage string as its hint', () => {
      const error = errorOf(tests('frobnicate').stderr);
      expect(error.hint).toMatch(/^Usage: tests </);
      expect(error.hint).toContain('--max-files <n>');
      expect(error.hint).toContain('--max-per-rule <n>');
    });

    it('E_RISKMAP hints at fixing or deleting the risk map', () => {
      const error = errorOf(tests('scan', '--root', makeTree({ '.testing/risk.yml': 'phase: nope\n' })).stderr);
      expect(error.hint).toBe('Fix or delete .testing/risk.yml, then rerun');
    });

    it('E_EXISTS hints at deleting the file', () => {
      const root = makeTree({ '.testing/risk.yml': 'phase: dev\n' });
      const error = errorOf(tests('risk-draft', '--root', root, '--write').stderr);
      expect(error.hint).toBe('Delete the file first if you want a fresh draft');
    });

    it('failureFor appends a Node error code to an internal error and keeps the detail out by default', () => {
      const cause = Object.assign(new Error('boom'), { code: 'ENOTDIR' });
      expect(failureFor(cause, {})).toEqual({ code: 'E_INTERNAL', message: 'boom [ENOTDIR]' });
    });

    it('failureFor leaves the message alone when there is no Node code, and handles non-Error throws', () => {
      expect(failureFor(new Error('plain'), {}).message).toBe('plain');
      expect(failureFor('text', {})).toMatchObject({ code: 'E_INTERNAL', message: 'text' });
    });

    it('failureFor adds the stack as detail only when AGENT_TESTS_DEBUG is set', () => {
      const error = new Error('boom');
      expect(failureFor(error, { AGENT_TESTS_DEBUG: '1' }).detail).toBe(error.stack);
      expect(failureFor(error, { AGENT_TESTS_DEBUG: '' }).detail).toBeUndefined();
    });

    it('failureFor keeps a CliError as is, with the hint for its code', () => {
      expect(failureFor(new CliError('E_EXISTS', 'there'), {})).toEqual({ code: 'E_EXISTS', message: 'there', hint: 'Delete the file first if you want a fresh draft' });
      expect(failureFor(new CliError('E_X', 'own', 'my hint'), {})).toEqual({ code: 'E_X', message: 'own', hint: 'my hint' });
      expect(failureFor(new CliError('E_X', 'no hint'), {})).toEqual({ code: 'E_X', message: 'no hint' });
    });

    it('adds the stack as one escaped detail string only in debug mode, still on one line', () => {
      const root = makeTree({ '.testing/risk.yml/inner': 'the risk map path is a directory' });
      const plain = tests('scan', '--root', root);
      expect(plain.status).toBe(1);
      expect(errorOf(plain.stderr).code).toBe('E_RISKMAP');
      expect(errorOf(plain.stderr).detail).toBeUndefined();

      const debug = run({ env: { AGENT_TESTS_DEBUG: '1' } }, 'scan', '--root', root);
      expect(debug.status).toBe(1);
      expect(errorOf(debug.stderr).detail).toBeTypeOf('string');
    });
  });

  describe('broken pipes', () => {
    it('ignoreBrokenPipe exits quietly with 0 on EPIPE', () => {
      const exit = vi.fn();
      ignoreBrokenPipe(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }), exit);
      expect(exit).toHaveBeenCalledWith(0);
    });

    it('ignoreBrokenPipe rethrows any other error', () => {
      const exit = vi.fn();
      const other = Object.assign(new Error('disk on fire'), { code: 'EIO' });
      expect(() => ignoreBrokenPipe(other, exit)).toThrow(other);
      expect(exit).not.toHaveBeenCalled();
    });
  });

  describe('launcher', () => {
    it('reports a runtime that cannot load as one E_RUNTIME_BROKEN line', () => {
      const copy = scratchDir('agent-tests-nodeps-');
      for (const entry of ['scripts', 'src', 'package.json']) cpSync(join(ROOT, entry), join(copy, entry), { recursive: true });
      expect(existsSync(join(copy, 'node_modules'))).toBe(false);
      const result = run({ launcher: join(copy, 'scripts', 'tests.mjs') }, 'capabilities');
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      const error = errorOf(result.stderr);
      expect(error.code).toBe('E_RUNTIME_BROKEN');
      expect(error.message).not.toContain('\n');
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.hint).toBe('Run the tests-setup skill to repair the managed runtime');
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/cli.test.ts`

Expected: FAIL. Every case fails because `scripts/tests.mjs` does not exist.

- [ ] **Step 3: Implement**

Create `src/cli.ts`:

```ts
import { type Stats, linkSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CliError } from './errors.ts';
import { renderMarkdown } from './report.ts';
import { draftRiskMap } from './riskdraft.ts';
import { RISK_MAP_PATH, serializeRiskMap } from './riskmap.ts';
import { scan } from './scan.ts';

export const COMMANDS = ['capabilities', 'risk-draft', 'scan', 'report'] as const;

const USAGE = `Usage: tests <${COMMANDS.join('|')}> [--root <dir>] [--write] [--max-files <n>] [--max-per-rule <n>]`;

const HINTS: Record<string, string> = {
  E_USAGE: USAGE,
  E_RISKMAP: 'Fix or delete .testing/risk.yml, then rerun',
  E_EXISTS: 'Delete the file first if you want a fresh draft',
};

export interface Failure {
  code: string;
  message: string;
  hint?: string;
  detail?: string;
}

function packageVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
}

const nodeCode = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
};

/**
 * The one-line JSON error the CLI prints for any failure. A CliError keeps its code and message; anything else is E_INTERNAL, with
 * the Node error code (ENOENT, ENOTDIR) appended to the message. The stack goes in "detail" only when AGENT_TESTS_DEBUG is set.
 */
export function failureFor(error: unknown, env: Record<string, string | undefined> = process.env): Failure {
  let failure: Failure;
  if (error instanceof CliError) {
    failure = { code: error.code, message: error.message };
    const hint = error.hint ?? HINTS[error.code];
    if (hint) failure.hint = hint;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    const code = nodeCode(error);
    failure = { code: 'E_INTERNAL', message: code ? `${message} [${code}]` : message };
  }
  if (env.AGENT_TESTS_DEBUG && error instanceof Error && error.stack) failure.detail = error.stack;
  return failure;
}

/** A positive integer option value, or undefined when the option was not given. */
export function positiveInteger(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < 1) throw new CliError('E_USAGE', `--${name} must be a positive integer (got "${raw}")`);
  return value;
}

/** A reader that closes the pipe early (for example "| head") is not an error. */
export function ignoreBrokenPipe(error: NodeJS.ErrnoException, exit: (code: number) => void = process.exit): void {
  if (error.code === 'EPIPE') {
    exit(0);
    return;
  }
  throw error;
}

/**
 * Create the file only if nothing is there, and never leave a partial file at the target: write a temp file beside it, then publish
 * it with a hard link, which fails instead of overwriting. Filesystems without hard links fall back to an exclusive create.
 */
function writeNewFile(target: string, text: string): void {
  const exists = () => new CliError('E_EXISTS', `${RISK_MAP_PATH} already exists. Edit it by hand or delete it first.`);
  const directory = dirname(target);
  const parent = statSync(directory, { throwIfNoEntry: false });
  if (parent && !parent.isDirectory()) throw new CliError('E_EXISTS', `${basename(directory)} exists and is not a directory`);
  // lstat, not stat: a dangling symlink at the target still counts as something being there.
  if (lstatSync(target, { throwIfNoEntry: false })) throw exists();
  mkdirSync(directory, { recursive: true });

  const temp = join(directory, `${basename(target)}.${process.pid}.tmp`);
  try {
    writeFileSync(temp, text, { flag: 'wx' });
    try {
      linkSync(temp, target);
    } catch (error) {
      const code = nodeCode(error);
      if (code === 'EEXIST') throw exists();
      if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP' && code !== 'ENOSYS') throw error;
      try {
        writeFileSync(target, text, { flag: 'wx' });
      } catch (fallback) {
        if (nodeCode(fallback) === 'EEXIST') throw exists();
        throw fallback;
      }
    }
  } finally {
    rmSync(temp, { force: true });
  }
}

function run(args: string[]): void {
  const [command, ...rest] = args;
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    throw new CliError('E_USAGE', USAGE);
  }
  let values: { root?: string; write?: boolean; 'max-files'?: string; 'max-per-rule'?: string };
  try {
    values = parseArgs({
      args: rest,
      options: { root: { type: 'string' }, write: { type: 'boolean' }, 'max-files': { type: 'string' }, 'max-per-rule': { type: 'string' } },
      strict: true,
    }).values;
  } catch (error) {
    throw new CliError('E_USAGE', (error as Error).message);
  }
  if (command === 'capabilities') {
    process.stdout.write(`${JSON.stringify({ name: 'agent-tests', version: packageVersion(), commands: COMMANDS })}\n`);
    return;
  }
  if (values.root === '') throw new CliError('E_USAGE', '--root needs a directory');
  const root = resolve(values.root ?? process.cwd());
  let rootStat: Stats | undefined;
  try {
    rootStat = statSync(root, { throwIfNoEntry: false });
  } catch (error) {
    // A path through a file (a/file.txt/sub) is ENOTDIR on POSIX; to the caller it is just a root that does not exist.
    if (nodeCode(error) !== 'ENOTDIR') throw error;
  }
  if (!rootStat) throw new CliError('E_USAGE', `Root does not exist: ${root}`);
  if (!rootStat.isDirectory()) throw new CliError('E_USAGE', `Root is not a directory: ${root}`);

  if (command === 'risk-draft') {
    const text = serializeRiskMap(draftRiskMap(root));
    if (!values.write) {
      process.stdout.write(text);
      return;
    }
    writeNewFile(join(root, RISK_MAP_PATH), text);
    process.stdout.write(`${JSON.stringify({ written: RISK_MAP_PATH })}\n`);
    return;
  }
  if (command === 'scan') {
    // scan always prints the full JSON, so the report caps do not apply to it.
    process.stdout.write(`${JSON.stringify(scan(root), null, 2)}\n`);
    return;
  }
  const maxFiles = positiveInteger('max-files', values['max-files']);
  const maxPerRule = positiveInteger('max-per-rule', values['max-per-rule']);
  process.stdout.write(
    renderMarkdown(scan(root), {
      ...(maxFiles !== undefined ? { maxFiles } : {}),
      ...(maxPerRule !== undefined ? { maxPerRule } : {}),
    }),
  );
}

export async function main(argv: string[]): Promise<void> {
  process.stdout.on('error', error => ignoreBrokenPipe(error));
  try {
    run(argv.slice(2));
  } catch (error) {
    const failure = failureFor(error);
    console.error(JSON.stringify({ error: failure }));
    process.exitCode = failure.code === 'E_USAGE' ? 2 : 1;
  }
}
```

Create `scripts/tests.mjs`:

```js
#!/usr/bin/env node
// The CLI loads lazily so a runtime that cannot start (old Node, missing node_modules, a broken source file) still ends in the
// one-line JSON error contract instead of a raw stack.
function broken(message, hint) {
  console.error(JSON.stringify({ error: { code: 'E_RUNTIME_BROKEN', message, hint } }));
  process.exitCode = 1;
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  broken(`agent-tests needs Node 24 or newer; this is Node ${process.versions.node}`, 'Install Node 24 or newer');
} else {
  let main;
  try {
    ({ main } = await import('../src/cli.ts'));
  } catch (error) {
    broken(String(error instanceof Error ? error.message : error).split('\n')[0], 'Run the tests-setup skill to repair the managed runtime');
  }
  if (main) await main(process.argv);
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/cli.test.ts`

Expected: PASS, 46 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts scripts/tests.mjs tests/cli.test.ts
git commit -m "feat: add the tests CLI with capabilities, risk-draft, scan and report"
```

---

## Task 17: Skills

Three skills. A test keeps them honest: frontmatter matches the directory, descriptions stay short, each starts "Use ...", bodies stay short enough to hold in context, and every CLI command and script they name exists.

**Files:**
- Create: `tests/skills.test.ts`, `skills/tests-setup/SKILL.md`, `skills/test-audit/SKILL.md`, `skills/test-strategy/SKILL.md`

- [ ] **Step 1: Write the failing test**

Create `tests/skills.test.ts`:

```ts
/**
 * @lane edit
 * @risk standard
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/cli.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'skills');
const REQUIRED = ['tests-setup', 'test-audit', 'test-strategy'];
const CLI_COMMANDS: readonly string[] = COMMANDS;
const CLI_FLAGS = ['root', 'write', 'max-files', 'max-per-rule'];
const SETUP_FLAGS = ['check', 'json'];

const skillNames = readdirSync(SKILLS, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

function load(name: string): { text: string; meta: Record<string, string>; body: string } {
  const text = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`${name}/SKILL.md has no frontmatter`);
  return { text, meta: parse(match[1]) as Record<string, string>, body: match[2] };
}

/** Every source file that can emit an error code: the launcher scripts and the CLI. */
function sourceFiles(directory: string, extensions: string[]): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path, extensions);
    return extensions.some(extension => entry.endsWith(extension)) ? [path] : [];
  });
}

const SOURCES = [
  ...sourceFiles(join(ROOT, 'scripts'), ['.js', '.mjs']),
  ...sourceFiles(join(ROOT, 'src'), ['.ts']),
]
  .map(path => readFileSync(path, 'utf8'))
  .join('\n');

/**
 * Each example is a line that calls run-managed.js or setup.js plus the lines that continue it: up to a blank line or the
 * next list item, heading or table row. Which script it calls decides which flags are real.
 */
function examples(body: string): { script: 'cli' | 'setup'; text: string }[] {
  const lines = body.split('\n');
  const found: { script: 'cli' | 'setup'; text: string }[] = [];
  lines.forEach((line, index) => {
    if (!/run-managed\.js|setup\.js/.test(line)) return;
    let text = line;
    for (let next = index + 1; next < lines.length; next++) {
      if (lines[next].trim() === '' || /^\s*(?:[-*]|\d+\.|#|\|)\s/.test(lines[next])) break;
      text += `\n${lines[next]}`;
    }
    found.push({ script: /setup\.js/.test(line) ? 'setup' : 'cli', text });
  });
  return found;
}

describe('skills', () => {
  it('ships the expected skills', () => {
    expect(skillNames).toEqual(expect.arrayContaining(REQUIRED));
  });

  it('reads the commands from the CLI itself', () => {
    expect(CLI_COMMANDS).toEqual(['capabilities', 'risk-draft', 'scan', 'report']);
  });

  describe.each(skillNames)('%s', name => {
    const { text, meta, body } = load(name);

    it('has frontmatter matching its directory', () => {
      expect(meta.name).toBe(name);
      expect(typeof meta.description).toBe('string');
      expect(meta.description.length).toBeGreaterThan(40);
      expect(meta.description.length).toBeLessThanOrEqual(400);
    });

    it('says when to use it', () => {
      expect(meta.when_to_use).toMatch(/^Use /);
    });

    it('keeps description and when_to_use within the listing budget, with no colon-space in a value', () => {
      expect(meta.description.length + meta.when_to_use.length).toBeLessThan(1536);
      const frontmatter = text.split(/\r?\n---\r?\n/)[0];
      for (const line of frontmatter.split(/\r?\n/).slice(1)) expect(line.replace(/^[a-z_]+: /, '')).not.toContain(': ');
    });

    it('stays short enough to hold in context', () => {
      expect(body.split('\n').length).toBeLessThanOrEqual(160);
    });

    it('is plain ASCII with no argument placeholders', () => {
      expect(text).toMatch(/^[\x00-\x7F]*$/);
      expect(text).not.toMatch(/\$[1-9]|\$ARGUMENTS/);
    });

    it('only calls CLI commands that exist', () => {
      const called = [...body.matchAll(/run-managed\.js" ([a-z-]+)/g)].map(match => match[1]);
      for (const command of called) expect(CLI_COMMANDS).toContain(command);
    });

    it('only names options the scripts accept', () => {
      for (const example of examples(body)) {
        const allowed = example.script === 'setup' ? SETUP_FLAGS : CLI_FLAGS;
        for (const match of example.text.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)) expect(allowed, `--${match[1]} in: ${example.text}`).toContain(match[1]);
      }
    });

    it('only points at scripts and references that exist', () => {
      for (const match of body.matchAll(/scripts\/([\w-]+\.js)/g)) expect(existsSync(join(ROOT, 'scripts', match[1]))).toBe(true);
      for (const match of body.matchAll(/references\/([\w-]+(?:\.[\w-]+)*)/g)) expect(existsSync(join(ROOT, 'references', match[1])), match[0]).toBe(true);
    });

    it('only names error codes the code can emit', () => {
      for (const match of text.matchAll(/\bE_[A-Z_]+\b/g)) expect(SOURCES.includes(match[0]), `${match[0]} is not emitted by any source`).toBe(true);
    });

    it('defines <plugin-root> when it launches a script', () => {
      if (!/run-managed\.js|setup\.js/.test(body)) return;
      expect(body).toMatch(/^.*`<plugin-root>` is the directory.*$/m);
    });
  });

  it('has tests-setup name the setup script', () => {
    expect(load('tests-setup').body).toContain('scripts/setup.js');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/skills.test.ts`

Expected: FAIL. The `skills` directory does not exist (ENOENT).

- [ ] **Step 3: Write the skills**

Create `skills/tests-setup/SKILL.md`:

```markdown
---
name: tests-setup
description: Install, check and repair the managed agent-tests runtime (the tests CLI and its Node dependencies) outside the plugin cache.
when_to_use: Use before the first agent-tests command in a session, after a plugin update, or when an agent-tests skill reports "Managed CLI ... is missing", "rerun tests-setup", E_RUNTIME_MISSING, E_RUNTIME_BROKEN, E_SETUP_FAILED, or a runtime version mismatch.
---
# tests-setup

The plugin cache holds source only. The `tests` CLI runs from a managed release in
`~/.agent-tests/releases/<version>-<fingerprint>-...` (override with `AGENT_TESTS_HOME`).
Skills always launch it through the plugin's checked launcher, never a `tests` on PATH:

    node "<plugin-root>/scripts/run-managed.js" <command> [args]

`<plugin-root>` is the directory that holds scripts/run-managed.js, the parent of the skills directory (two levels
up from this skill's directory). In Codex, resolve it from the SKILL.md file you loaded, not from the current directory.

## Check

    node "<plugin-root>/scripts/setup.js" --check --json

Done when the JSON reports `"ok": true` and `cliVersion` equals `pluginVersion`.

## Install or repair

1. Confirm Node 24 or newer: `node --version`. The CLI runs TypeScript directly and refuses older Node.
2. Run `node "<plugin-root>/scripts/setup.js"`. It copies the runtime, runs `npm ci`, verifies the
   imports and writes a receipt.
3. Run the check again and confirm `"ok": true`.
4. Smoke test: `node "<plugin-root>/scripts/run-managed.js" capabilities` prints JSON with `"name":"agent-tests"`.

## When it fails

| Message | Fix |
|---|---|
| `Managed CLI x.y.z is missing` | Run step 2. |
| `Managed runtime modified or version mismatch` | Move the release directory aside (`runtimeRoot` in the check JSON names it), then run step 2. |
| `Dependency check failed`, `fails its dependency check` or `E_RUNTIME_BROKEN` (unless it says `needs Node 24`) | Move the release directory aside (`runtimeRoot` in the check JSON names it), then run step 2. |
| `E_SETUP_FAILED` (the message says what failed) | Fix the stated cause, then rerun step 2. |
| `Another setup may be running (...setup.lock)` | Confirm no setup process is running, delete the lock, rerun. |
| `needs Node 24 or newer` | Upgrade Node; do not work around it. |
| `Cannot locate npm-cli.js` | Install Node.js with npm, then rerun. |

Never edit files inside a managed release; reinstall instead.
```

Create `skills/test-audit/SKILL.md`:

```markdown
---
name: test-audit
description: Audit a project's test suite for necessity and efficiency - redundant coverage, compat and fallback shim tests, worktree-hostile tests, tests not tied to a risk tier or tagged for the wrong lane, and tests that run too often - and return a verdict per test file.
when_to_use: Use when an existing test suite or its CI feels too big, slow or redundant ("tests take forever", "too many tests", "is this overkill", "do we need all of these"), before pruning, merging or demoting tests, or when asked to audit how a project's tests are structured.
---
# test-audit

The goal is efficiency: protection per unit of cost. A slow test that guards data loss is worth keeping;
a fast test that repeats three others is waste. Speed alone never decides a verdict.

The CLI gathers evidence and never judges. You judge, using the rubric below. Do not edit tests in this skill.

`<plugin-root>` is the directory that holds scripts/run-managed.js, the parent of the skills directory (two levels
up from this skill's directory). In Codex, resolve it from the SKILL.md file you loaded, not from the current directory.
Quote the project path (`"<project>"`) so a Windows path with spaces survives.

## Steps

1. **Runtime.** `node "<plugin-root>/scripts/setup.js" --check --json`. If `ok` is false, load the tests-setup skill.
2. **Risk map.** Look for `.testing/risk.yml` in the project.
   - Missing: run `node "<plugin-root>/scripts/run-managed.js" risk-draft --root "<project>"`, which prints a draft and
     writes nothing, and show the owner the draft. Ask three things: the project phase (`dev` pre-release, `test`
     stabilizing, `production` released), who consumes this code (`consumers`; an empty list means nobody), and which
     areas are critical, standard or low. Never write the file before the owner has confirmed all three. Then run the
     same command with `--write` to create the file, edit `.testing/risk.yml` to apply their answers (phase, consumers,
     tiers), and rerun `report` to validate it; an `E_RISKMAP` error names the bad field.
   - Present: read it. Treat `phase`, `consumers` and `areas` as the owner's decisions.
3. **Evidence.** `node "<plugin-root>/scripts/run-managed.js" report --root "<project>"` prints a ranked Markdown view
   (add `--max-files <n>` for a longer table); `scan` prints the full JSON.
   - The report opens with a header and category counts. Project findings (CI, hooks, scripts, agent instructions,
     risk-map gaps) follow, then a table of test files.
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
   On a large suite do not open every file. A file with no findings, no flags, a tier, and either no lane tag or a lane
   that fits its tier gets `keep` without being opened; count these files and report the count, not rows. A flagged file
   is never kept unread: the flags are the evidence for question 4 of the rubric.
5. **Judge** each remaining file with the rubric, then write the verdict table.

## Rubric

Ask in this order. Stop at the first question that settles it.

1. **What failure does this test catch, and who is hurt?** Use the file's risk tier. A file with no tier gets no
   verdict: report it as a risk-map gap and do not guess.
2. **Is the code kept for an old format or API, and does a consumer exist?** Read the code under test first. A runtime
   fallback for missing input is current behavior, not a shim: judge it with questions 3 to 6. A shim, compat, legacy or
   migration test protects a consumer. Before you accept `consumers: []` as "nobody", look for the kinds of consumer the
   doctrine counts: other repositories, plugin or package installs from this repo, stored data in the old format and
   a published API. With none of those, nobody depends on the old path and the test guards nothing.
3. **Does something cheaper already catch it?** Compare the files in a cluster and the duplicate titles and repeated
   sweeps. Name the test that is the single owner of the behavior.
4. **Is the test sound?** `tautological`, `snapshot-only`, `mock-only` and `no-direct-assertions` flags mean the test
   may assert nothing real. Confirm by reading it.
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
6. What this audit could not measure: wait time, CI minutes and flakiness need a timed run.

Stop after this output and let the owner decide what to apply.
```

Create `skills/test-strategy/SKILL.md`:

```markdown
---
name: test-strategy
description: Structure a project's tests by phase (dev, test, production) and run frequency (edit, merge, scheduled, release lanes) using a risk map, and keep agent-written tests from bloating the suite.
when_to_use: Use when starting a project or feature area, or deciding how a project's tests and CI should be structured (what to test, how often each test runs, whether CI is needed and where, and what testing rules to give coding agents). For an existing suite that already feels bloated, use test-audit first.
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

Starting scripts until the lane tooling exists:

- vitest: edit `vitest related --run <changed files>`, merge `vitest run --changed origin/main`, full `vitest run`.
  `--changed` needs an `origin/main` ref; with no remote yet, `vitest run --changed` covers uncommitted changes.
- jest: edit `jest --findRelatedTests <changed files>`, merge `jest --changedSince=origin/main`, full `jest`.
  `--onlyChanged` sees uncommitted changes only, so it is not a merge lane.

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
    - Pre-release usually means no consumers: no backward-compatibility, legacy-format or fallback tests unless
      `consumers` in the risk map names who needs them. The risk map decides.
    - Tests must not depend on the checkout: no fixed ports (use port 0), no fixed temp paths (use mkdtemp), no
      absolute paths, no reading `.git` directly, no writes under the home directory.
    - Declare the lane in the file's first comment, before any import: `/** @lane merge */` (edit, merge, scheduled or
      release). Tags are read only from that leading comment. If the test reaches code only through a subprocess or the
      network, add `@subject <path>` for that code, as a path from the project root (`src/cli.ts`, not an import-style
      `../src/cli.ts`, which is dropped). A test with no code subject gets `@risk <critical|standard|low>`.
    - While editing, run only the tests for the files you changed. Run the project's merge script before pushing. Do
      not run the full suite after every change.

## 6. Audit what exists

For an existing suite, load the test-audit skill instead of restructuring by hand.

Evidence for these rules, and where they are opinion, is in `<plugin-root>/references/doctrine.md`.
```

- [ ] **Step 4: Reconcile the skills with the doctrine**

Open `references/doctrine.md` from Task 2. For every rule whose claim was revised or whose evidence contradicted a seed claim, edit the matching sentence in `test-strategy` or `test-audit` so the skill never states more than the doctrine supports. Rule 7 (automatic CI) was already amended for the owner's pull-request workflow and the skill drafts below follow it. Check the others: 8 (runner pricing: the skill says only "a higher rate", keep it that way unless you cite numbers), 9 (watch mode) and 3 (test shapes).

- [ ] **Step 5: Review the skills' triggers**

The skill drafts above were already reviewed with `hartye-skills:yoda`, including paired with-skill and without-skill runs on the `bloated` fixture and on a new project. What that review changed, so you do not undo it:
- `test-audit` and `test-strategy` triggers were separated (audit is for an existing suite that feels big or slow; strategy is for deciding structure) and `test-strategy` no longer claims "an agent is about to write many tests", which belongs to the test-driven-development skill;
- `test-audit` now tells the reader to read the code under test, because a test of a pass-through or an unreachable bound protects nothing;
- `test-strategy` notes that `--changed origin/main` needs a remote.

Frontmatter values are plain YAML scalars, so a colon followed by a space inside one makes the skill fail to load without any error; `tests/skills.test.ts` catches it. Re-run yoda only if Step 4 changes a description. Keep descriptions plus `when_to_use` under 1,536 characters in total and every body at 160 lines or fewer.

- [ ] **Step 6: Run the test and the typecheck**

Run: `npx vitest run tests/skills.test.ts`

Expected: PASS, 33 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 7: Commit**

```bash
git add skills tests/skills.test.ts
git commit -m "feat: add tests-setup, test-strategy and test-audit skills"
```

---

## Task 18: README, dogfood CI and this repository's risk map

The plugin follows its own doctrine: its CI never runs on every push, and the audit is run on its own repository. After this task the audit reports zero wiring findings on this repo.

**Files:**
- Create: `README.md`, `.github/workflows/ci.yml`, `.testing/risk.yml`

- [ ] **Step 1: Create the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

# Follows the doctrine in skills/test-strategy: one non-blocking Linux job per pull-request update,
# and the Windows and macOS runs only on demand, weekly and on release tags. Nothing runs on a plain push.
on:
  pull_request:
    paths:
      - 'src/**'
      - 'scripts/**'
      - 'skills/**'
      - 'references/**'
      - 'tests/**'
      - 'package.json'
      - 'package-lock.json'
      - 'tsconfig.json'
      - 'vitest.config.ts'
      - '.github/workflows/ci.yml'
  workflow_dispatch:
  schedule:
    - cron: '0 6 * * 1'
  push:
    tags: ['v*']

permissions:
  contents: read

# A newer push to the same pull request cancels the older run.
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  linux:
    if: github.event_name != 'pull_request' || !github.event.pull_request.draft
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run typecheck

  os-matrix:
    if: github.event_name != 'pull_request'
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run typecheck
```

- [ ] **Step 2: Create the risk map for this repository**

Draft it with the tool, then replace the draft with the confirmed version below. The draft only knows directory names; the confirmed map records why `scripts/` and two source files are critical (they install software on a user's machine, write into a user's project, and read the owner's risk decisions).

Run: `node scripts/tests.mjs risk-draft --root .`

Expected: YAML printed to the terminal with `src/detectors/**`, a critical per-file area for `src/schema.ts` (its name suggests data persistence) and a `src/**` catch-all. Nothing is written.

Create `.testing/risk.yml`:

```yaml
# agent-tests risk map. Confirm or edit, then commit it.
# First matching area wins, so list specific areas before broad ones.
# consumers: who depends on this code? An empty list means compat and fallback tests guard nobody.
phase: dev
consumers: []
weights:
  wait: 1
  agent: 1
  ci: 1
  churn: 1
lanes:
  edit:
    runs: affected-files
    trigger: agent-edit
  merge:
    runs: critical+standard
    trigger: local-pre-push
  scheduled:
    runs: all
    trigger: cron
    os:
      - ubuntu
      - windows
      - macos
  release:
    runs: all+clean-install
    trigger: tag
    os:
      - ubuntu
      - windows
      - macos
areas:
  - path: scripts/**
    tier: critical
    why: installs and launches the runtime on the user's machine
  - path: src/cli.ts
    tier: critical
    why: writes .testing/risk.yml into the user's project
  - path: src/riskmap.ts
    tier: critical
    why: reads and validates the owner's risk decisions
  - path: src/detectors/**
    tier: standard
    why: detectors produce evidence for the audit; a wrong finding misleads but cannot damage a project
  - path: src/**
    tier: standard
    why: evidence gathering; wrong output misleads the audit but cannot damage a project
```

- [ ] **Step 3: Write the README**

Create `README.md`:

```markdown
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

## Status

Version 0.1 is a static audit for TypeScript and JavaScript projects using vitest or jest. It never runs your tests, so
wait time, CI minutes and flakiness are not measured yet. Planned: a timed run with a second-worktree check (0.2),
remediation and CI templates (0.3), Codex packaging verified on both hosts (0.4), then Python and pytest.

## Known limitations

- Pattern detectors also match strings inside tests that are about those patterns, including this repository's own tests.
  Findings are evidence for the agent to read, not verdicts.
- Subjects are found through relative imports, `require()` and dynamic `import()` of project files, plus any `@subject`
  tags. Path aliases (`@/x`, tsconfig `paths`) are not resolved yet, so tests that import code only through an alias have
  no subject and show as untiered.
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

## License

MIT
```

- [ ] **Step 4: Run the audit on this repository**

Run: `node scripts/tests.mjs report --root .`

Expected:
- `Phase: dev`, `Risk map: present`, 18 test files;
- `wiring | 0` and `frequency | 0` in the findings table;
- `shim | 7` and `worktree | 50`: false positives from `tests/detectors/shims.test.ts` (4), `tests/detectors/worktree.test.ts` (45), `tests/managed-runtime.test.ts` (1), `tests/report.test.ts` (2), `tests/riskdraft.test.ts` (1), `tests/scan.test.ts` (4), whose test data is made of those very patterns;
- `redundancy | 16`, all `redundancy.shared-subject`: several tests import `src/riskmap.ts` or `src/schema.ts` to build fixtures, not to test them.

Do not "fix" any of these. They are the evidence the audit skill would read and dismiss, and they are listed under Known limitations in the README. If your counts differ, a code block was mis-typed.

- [ ] **Step 5: Commit**

```bash
git add README.md .github/workflows/ci.yml .testing/risk.yml
git commit -m "docs: add README, on-demand CI and this repository's risk map"
```

---

## Task 19: Final verification and hand-off

Invoke `h-superpowers:verification-before-completion` first: nothing below may be claimed done without its command output.

- [ ] **Step 1: Run the whole suite and the typecheck**

Run: `npm test`

Expected: `Test Files  18 passed (18)` and `Tests  556 passed (556)`.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 2: Install the managed runtime for real, into a throwaway home**

PowerShell:

```powershell
$env:AGENT_TESTS_HOME = "$env:TEMP/agent-tests-smoke"
node scripts/run-managed.js capabilities
node scripts/setup.js --json
node scripts/setup.js --check --json
node scripts/run-managed.js capabilities
node scripts/run-managed.js report --root tests/fixtures/clean
Remove-Item Env:AGENT_TESTS_HOME
```

Bash:

```bash
export AGENT_TESTS_HOME="$(mktemp -d)/agent-tests-smoke"
node scripts/run-managed.js capabilities
node scripts/setup.js --json
node scripts/setup.js --check --json
node scripts/run-managed.js capabilities
node scripts/run-managed.js report --root tests/fixtures/clean
unset AGENT_TESTS_HOME
```

Expected, in order:
1. the first `capabilities` fails with one-line JSON on stderr containing `E_RUNTIME_MISSING` and exit code 1;
2. `setup.js --json` prints `"ok":true`, `"dependencies":true` and `"errors":[]`;
3. `--check` prints `"ok":true` with `cliVersion` equal to `pluginVersion`;
4. the second `capabilities` prints `{"name":"agent-tests","version":"0.1.0","commands":["capabilities","risk-draft","scan","report"]}`;
5. `report` prints `# Test audit evidence` with `Test files: 4` and `None.` under both `Project findings (0)` and `Per-file findings`.

This proves the real `npm ci`, the receipt, and Node 24 running the `.ts` CLI from the managed release on this OS.

- [ ] **Step 3: Confirm a clean tree and the commit history**

Run: `git status -sb` and `git log --oneline`

Expected: no uncommitted changes; one commit per task on `feat/v0.1-static-audit`, after the two spec commits.

- [ ] **Step 4: Update the spec status**

In `docs/superpowers/specs/2026-10-11-agent-tests-design.md`, change the status line to: `Status: v0.1 (M0 to M2) implemented per docs/superpowers/plans/2026-10-11-agent-tests-v0.1-static-audit.md; M3 to M6 pending their own plans.` Commit with `docs: mark v0.1 implemented`.

- [ ] **Step 5: Hand off**

Invoke `h-superpowers:finishing-a-development-branch`. Do not publish the repository to GitHub and do not open the marketplace PR in `hartye-claude-plugins`: both are outward-facing and need the owner's explicit go-ahead. Then write the next plan: M3 (`time`, vitest and jest adapters, flake and parallel detection, the second-worktree check, cost columns).

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Managed runtime, `tests-setup`, launcher, Node 24+, nothing to compile (prebuilt TypeScript 7 binary) | 1, 4, 17 |
| Evidence-record schema as the CLI/skills contract | 3 |
| Risk map `.testing/risk.yml`: phase, consumers, weights, lanes, areas, first match wins | 3, 11 |
| `risk-draft`, owner confirms once, drift flagged later | 11, 13, 16 |
| Lane and risk tags in a docblock; path map as fallback | 7, 13, 14 |
| Evidence per test file: subject, tier, assertion shape, flags | 7, 14 |
| Cost columns shown separately: agent tokens, churn (wait and CI are `null` until `time`) | 12, 14, 15 |
| Detector 1, redundancy | 9 |
| Detector 2, shims judged against `consumers` | 8, 14 |
| Detector 3, worktree hazards (static half; the second-worktree run is the next plan) | 8 |
| Detector 4, risk wiring | 13 |
| Detector 5, frequency | 10 |
| Seeded `bloated` fixture with ground truth and a `clean` fixture | 5, 14 |
| `test-audit` rubric and verdicts; stops before applying them | 17 |
| `test-strategy`: phases, lanes, CI by phase, agent-instruction block | 17 |
| Doctrine cited or labeled opinion | 2, 17 |
| Dogfooding: its own CI follows the doctrine; the audit runs on this repo | 18, 19 |
| CLI error contract (`E_USAGE`, `E_RISKMAP`, `E_EXISTS`, `E_RUNTIME_MISSING`) | 3, 4, 16 |
| `time`, second-worktree check, `test-remediate`, `test-lanes`, Codex packaging, Python, publishing | next plans |
