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

1. **TypeScript 7.0.2, not an older line.** The owner asked for current versions, so every pin is the registry's latest as of 2026-10-11. TypeScript 7 is a native compiler whose main entry has no `createSourceFile`; its JS API lives on `typescript/unstable/*` subpaths and talks to the native binary over RPC. `src/parse.ts` uses it: one `API` session, a virtual filesystem (`typescript/unstable/fs`), one tiny project per file, then `forEachChild` over the returned AST. The costs are accepted and contained: the subpaths are named `unstable`, so the version is pinned exactly and `src/parse.ts` is the only file that touches them; the platform binary must install, so the managed-runtime dependency check parses a line for real; and a session must be closed, so `scan` closes it in a `finally`. Measured: about half a second to start, then about one millisecond per file.
2. **The managed runtime has no `npm link` step and no browser step.** Skills always call the launcher, so a bare `tests` on PATH is never used.
3. **`scan` prints evidence JSON and `report` prints Markdown.** The spec listed `scan`, `time`, `report`; `time` belongs to the next plan.
4. **Noise controls found by running the audit on this repository itself:** type-only imports are not subjects; a test counts for a subject only when it imports three or fewer modules or is named after it; shared-subject findings collapse to one per file; `fixtures` directories are never scanned; a tag-only `push` trigger is a release run, not "every push", and may carry an OS matrix; `risk-draft` adds a catch-all `src/**` area when code sits directly under `src`; `@subject <path>` declares code a test reaches without importing it (a CLI run in a subprocess), and `@risk <tier>` states a tier for a test with no code subject.
5. **Doctrine is verified, not asserted.** Task 2 turns the spec's CI and testing claims into cited rules in `references/doctrine.md`. One claim was already corrected while planning: bare `vitest` starts watch mode only in an interactive terminal, so the skill says "can block", not "waits forever".
6. **A test with no `@lane` tag is not a finding in v0.1.** Tagging is opt-in and the risk map's tier already places every test, so a `wiring.no-lane` rule would flag nearly every test in a project that has not adopted tags. A lane-versus-tier mismatch is flagged only when a tag exists. Revisit it once `test-lanes` (a later plan) writes the tags.
7. **The CI default follows the owner's pull-request workflow, and replaces the spec's "no automatic CI in dev".** The doctrine research (rule 7) found team-oriented sources agree a build should run on every integration and that a local pass is an agent reporting on itself. The owner never pushes to the default branch, so the recommended default is one non-blocking Linux job per `pull_request` update (path-filtered, drafts skipped, newer runs cancel older ones), no `push` trigger and no post-merge run, with the Windows and macOS runs on demand, weekly and on release tags. The frequency detector accepts a Linux-only `pull_request` workflow and flags `push` triggers on branches and Windows or macOS on the pull-request path. The spec and doctrine rule 7 were amended to match.
8. **Tasks 3 and 4 and the fixtures were hardened after code review, and the code blocks show the final versions.** Task 3: the risk-map schema rejects unknown keys, and read and parse failures are reported separately. Task 4: a stale `setup.lock` is reclaimed when its owner process is gone, the repair path never runs `npm ci` inside a live release, dependency-check failures keep the line that names the cause, and the install contract has tests. Task 5: the `clean` fixture gained near-miss cases. Task 14 compares exact sorted finding lists, so a rule that fires twice is caught.

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

export const FileFlag = z.enum(['tautological', 'snapshot-only', 'mock-only', 'no-direct-assertions']);
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
import { detectRunner, discoverTests, isSupportPath, isTestPath } from '../src/discover.ts';
import { makeTree } from './helpers/tree.ts';

describe('isTestPath', () => {
  it('recognizes .test and .spec files and __tests__ directories', () => {
    expect(isTestPath('src/a.test.ts')).toBe(true);
    expect(isTestPath('src/a.spec.mjs')).toBe(true);
    expect(isTestPath('src/__tests__/a.ts')).toBe(true);
    expect(isTestPath('src/a.ts')).toBe(false);
    expect(isTestPath('src/a.test.md')).toBe(false);
  });
});

describe('isSupportPath', () => {
  it('treats helpers, fixtures and mocks as support code', () => {
    expect(isSupportPath('tests/helpers/tree.ts')).toBe(true);
    expect(isSupportPath('src/__mocks__/fs.ts')).toBe(true);
    expect(isSupportPath('src/persistence/store.ts')).toBe(false);
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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { relPosix } from './paths.ts';

export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo', '.cache', 'out', 'fixtures']);

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const SUPPORT_DIR = /(^|\/)(?:tests?|__tests__|__mocks__|fixtures?|helpers?|testing|test-utils?)\//;

export const isTestPath = (rel: string): boolean => TEST_FILE.test(rel) || (/(^|\/)__tests__\//.test(rel) && CODE_FILE.test(rel));

/** Test helpers and fixtures are not the code a test protects, so they never count as a test's subject. */
export const isSupportPath = (rel: string): boolean => SUPPORT_DIR.test(rel);

const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function walk(root: string, visit: (absolute: string, rel: string) => void, dir = root): void {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort(byName)) {
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
  const names = readdirSync(root);
  if (names.some(name => /^vitest\.config\./.test(name))) return 'vitest';
  if (names.some(name => /^jest\.config\./.test(name))) return 'jest';
  return 'unknown';
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/discover.test.ts`

Expected: PASS, 7 tests.

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
import { describe, expect, it } from 'vitest';
import { parseTags, resolveSubjects } from '../src/parse.ts';
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
    const lines = parseTestFile('a.test.ts', "// héllo — ✓\nit('first', () => {});\n\nit('second', () => {});\n");
    expect(lines.tests.map(test => [test.name, test.line])).toEqual([
      ['first', 2],
      ['second', 4],
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
});

describe('parseTags', () => {
  it('ignores an unknown lane', () => {
    expect(parseTags('/** @lane nightly */')).toEqual({});
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

  it('skips test files, helpers and unresolved paths', () => {
    const root = makeTree({ 'src/a.test.ts': '', 'tests/helpers/tree.ts': '', 'tests/a.test.ts': '' });
    expect(resolveSubjects(root, 'tests/a.test.ts', ['../src/a.test.ts', './helpers/tree.ts', './missing.ts'])).toEqual([]);
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
import { dirname, extname, resolve } from 'node:path';
import { SyntaxKind, type CallExpression, type ImportDeclaration, type Node, type PropertyAccessExpression, type SourceFile } from 'typescript/unstable/ast';
import { isCallExpression, isIdentifier, isImportDeclaration, isNamedImports, isNoSubstitutionTemplateLiteral, isPropertyAccessExpression, isStringLiteral } from 'typescript/unstable/ast/is';
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

/** One native TypeScript process that parses many files. Call close() when done: the process outlives the script otherwise. */
export interface ParseSession {
  parse(fileName: string, text: string): ParsedFile;
  close(): void;
}

const TEST_CALLEE = /^(?:it|test)(?:\.(?:only|skip|todo|concurrent|fails))?$/;
const EACH_CALLEE = /^(?:it|test)\.each$/;
const SUITE_CALLEE = /^describe(?:\.(?:only|skip|todo|concurrent))?$/;
const MOCK_CALLEE = /^(?:vi|jest)\.(?:mock|doMock|fn|spyOn)$/;
const SNAPSHOT_MATCHER = /^toMatch(?:Inline|File)?Snapshot$/;
const MOCK_MATCHER = /^(?:toHaveBeenCalled(?:With|Times)?|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|toBeCalled(?:With|Times)?|toHaveReturned(?:With|Times)?)$/;
const IDENTITY_MATCHER = /^(?:toBe|toEqual|toStrictEqual)$/;
const LANES: readonly LaneName[] = ['edit', 'merge', 'scheduled', 'release'];

/** Parse only: no type information, no module resolution, no default library. */
const COMPILER_OPTIONS = { allowJs: true, noResolve: true, noLib: true, types: [], jsx: 'preserve' };

export function parseTags(text: string): ParsedFile['tags'] {
  const head = text.slice(0, 2000);
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

function isTestCall(call: CallExpression): boolean {
  const callee = call.expression;
  if (isCallExpression(callee)) return EACH_CALLEE.test(callee.expression.getText()); // it.each(table)('name', fn)
  const text = callee.getText();
  return TEST_CALLEE.test(text) && (call.arguments.length >= 2 || text.endsWith('.todo'));
}

/** The expect(...) call at the root of `expect(x).not.toBe(y)` style chains, or null. */
function expectRoot(callee: PropertyAccessExpression): CallExpression | null {
  let node: Node = callee.expression;
  while (isPropertyAccessExpression(node)) node = node.expression;
  if (isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === 'expect') return node;
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
      const calleeText = callee.getText();
      if (isTestCall(node)) {
        const name = titleOf(node);
        next = { name, line: lineOf(node), assertions: 0, todo: calleeText.endsWith('.todo') };
        out.tests.push(next);
        out.titles.push({ text: name, line: next.line });
      } else if (SUITE_CALLEE.test(calleeText)) {
        out.titles.push({ text: titleOf(node), line: lineOf(node) });
      } else if (MOCK_CALLEE.test(calleeText)) {
        out.mockCalls++;
      } else if (isIdentifier(callee) && callee.text === 'expect') {
        out.assertions++;
        if (current) current.assertions++;
      } else if (/^assert(?:\.\w+)?$/.test(calleeText)) {
        out.assertions++;
        if (current) current.assertions++;
      } else if (isPropertyAccessExpression(callee)) {
        const root = expectRoot(callee);
        if (root) {
          const matcher = callee.name.text;
          if (SNAPSHOT_MATCHER.test(matcher)) out.snapshotAssertions++;
          if (MOCK_MATCHER.test(matcher)) out.mockAssertions++;
          if (IDENTITY_MATCHER.test(matcher) && root.arguments.length === 1 && node.arguments.length === 1) {
            if (root.arguments[0].getText() === node.arguments[0].getText()) out.tautologies++;
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

/** Open a parse session. Files are fed to the TypeScript 7 API through an in-memory filesystem, one tiny project per file. */
export function openParseSession(): ParseSession {
  const fs = createVirtualFileSystem({ '/agent-tests/session.json': '{}' });
  const api = new API({ cwd: '/agent-tests', fs });
  let count = 0;
  return {
    parse(fileName, text) {
      const dir = `/agent-tests/${count++}`;
      const base = `source${extname(fileName) || '.ts'}`; // the extension picks TS, TSX, JS or JSX parsing
      const config = `${dir}/tsconfig.json`;
      fs.writeFile?.(`${dir}/${base}`, text);
      fs.writeFile?.(config, JSON.stringify({ compilerOptions: COMPILER_OPTIONS, files: [base] }));
      const snapshot = api.updateSnapshot({ openProject: config });
      try {
        const sourceFile = snapshot.getProject(config)?.program.getSourceFile(`${dir}/${base}`);
        if (!sourceFile) throw new Error(`TypeScript could not parse ${fileName}`);
        return extractFacts(sourceFile, text);
      } finally {
        snapshot.dispose();
      }
    },
    close() {
      api.close();
    },
  };
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** Repo-relative non-test source files a test file imports through relative specifiers. */
export function resolveSubjects(root: string, testRel: string, imports: string[]): string[] {
  const dir = dirname(resolve(root, testRel));
  const found = new Set<string>();
  for (const spec of imports) {
    if (!spec.startsWith('.')) continue;
    const base = resolve(dir, spec);
    const stripped = base.replace(/\.[cm]?[jt]sx?$/, '');
    const candidates = [base, ...EXTENSIONS.map(ext => stripped + ext), ...EXTENSIONS.map(ext => resolve(base, `index${ext}`))];
    const hit = candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile());
    if (!hit) continue;
    const rel = relPosix(root, hit);
    if (rel.startsWith('..') || isTestPath(rel) || isSupportPath(rel)) continue;
    found.add(rel);
  }
  return [...found].sort();
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/parse.test.ts`

Expected: PASS, 15 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/parse.ts tests/parse.test.ts
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
  /\b(?:legacy|back(?:wards?)?[- ]?compat(?:ibility|ible)?|compat(?:ibility)?|deprecated|fall-?back|polyfill|shim|migrat(?:e|es|ion|ing) from|old[- ]format)\b/i;
const PATH_MARKER = /(?:^|[/._-])(?:legacy|compat|deprecated|shims?|polyfills?)(?:[/._-]|$)/i;

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
        evidence: title.text,
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
  for (const spec of parsed.imports) {
    if (spec.startsWith('.') && PATH_MARKER.test(spec)) {
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
  skip?: RegExp;
}

const RULES: Rule[] = [
  {
    rule: 'worktree.fixed-port',
    pattern: /(?:\blisten\(\s*|\bport\s*[:=]\s*|localhost:|127\.0\.0\.1:|0\.0\.0\.0:)(\d{4,5})\b/i,
    message: 'Hard-coded port: two worktrees running tests at once collide. Use port 0 or a per-run port.',
  },
  {
    rule: 'worktree.absolute-path',
    pattern: /['"`](?:[A-Za-z]:[\\/]|\/(?:Users|home)\/)[^'"`]*['"`]/,
    message: 'Absolute path into one checkout or machine; another worktree resolves elsewhere. Derive paths from the test file or repo root.',
  },
  {
    rule: 'worktree.shared-tmp',
    pattern: /['"`]\/tmp\/[^'"`]*['"`]|tmpdir\(\)\s*,\s*['"`][^'"`$]+['"`]\s*\)/,
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
    pattern: /\bhomedir\(\)|process\.env\.(?:HOME|USERPROFILE)\b/,
    message: 'State under the user home directory is shared by every worktree. Use a per-run temp directory.',
  },
  {
    rule: 'worktree.fixed-db-file',
    pattern: /['"`][^'"`\s$]*\.(?:sqlite3?|db)['"`]/,
    message: 'Fixed database file name: concurrent worktrees share or clobber it unless the path is unique per run.',
  },
];

/** Hazards that make a test pass alone in one checkout and fail beside a second worktree. */
export function detectWorktreeHazards(file: string, lines: string[]): Finding[] {
  const findings: Finding[] = [];
  lines.forEach((text, index) => {
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    for (const rule of RULES) {
      if (rule.skip?.test(text)) continue;
      if (rule.pattern.test(text)) {
        findings.push({ category: 'worktree', rule: rule.rule, file, line: index + 1, message: rule.message, evidence: trimmed.slice(0, 160) });
      }
    }
  });
  return findings;
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/detectors/shims.test.ts tests/detectors/worktree.test.ts`

Expected: PASS, 2 plus 3 tests.

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
      file('tests/a.test.ts', [], `${sweep}\nfor (let i = 0; i < 3; i++) {}`),
      file('tests/b.test.ts', [], sweep),
      file('tests/c.test.ts', [], 'for (let seed = 1; seed <= 50; seed++) {}'),
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

const SWEEP = /\bfor\s*\(\s*(?:let|const|var)\s+\w+\s*=\s*(\d+)\s*;\s*\w+\s*(<=|<)\s*(\d+)\s*;/;
const MIN_SWEEP = 10;
const MIN_TITLE = 12;

const MAX_FOCUSED_SUBJECTS = 3;

const stem = (rel: string): string =>
  (rel.split('/').pop() ?? rel)
    .replace(/\.(?:test|spec)\.[cm]?[jt]sx?$/, '')
    .replace(/\.[cm]?[jt]sx?$/, '')
    .replace(/\.(?:unit|integration|e2e|contract)$/, '');

/** A test that imports many modules touches most of them incidentally. It counts for a subject only when it is focused or named after it. */
const isFocused = (file: RedundancyInput, subject: string): boolean => file.subjects.length <= MAX_FOCUSED_SUBJECTS || stem(subject) === stem(file.rel);

export function layerOf(rel: string): string {
  if (/(?:^|[/._-])(?:e2e|end-to-end)(?:[/._-]|$)/i.test(rel)) return 'e2e';
  if (/integration/i.test(rel)) return 'integration';
  if (/(?:^|[/._-])contract(?:[/._-]|$)/i.test(rel)) return 'contract';
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
  const clusters: Cluster[] = [];
  const sharedBy = new Map<string, string[]>();
  for (const [subject, members] of [...bySubject].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (members.length < 2) continue;
    const sorted = [...members].sort();
    clusters.push({ subject, files: sorted, layers: [...new Set(sorted.map(layerOf))].sort() });
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

  const sweeps = new Map<string, Array<{ file: string; line: number; text: string }>>();
  for (const file of files) {
    file.lines.forEach((text, index) => {
      const match = SWEEP.exec(text);
      if (!match) return;
      const start = Number(match[1]);
      const end = Number(match[3]);
      if (end - start + (match[2] === '<=' ? 1 : 0) < MIN_SWEEP) return;
      const key = `${start}${match[2]}${end}`;
      sweeps.set(key, [...(sweeps.get(key) ?? []), { file: file.rel, line: index + 1, text: text.trim() }]);
    });
  }
  for (const [key, spots] of sweeps) {
    if (spots.length < 2) continue;
    for (const spot of spots) {
      findings.push({
        category: 'redundancy',
        rule: 'redundancy.repeated-sweep',
        file: spot.file,
        line: spot.line,
        message: `The same sweep (${key}) appears ${spots.length} times in the suite. Share the work or keep one owner.`,
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
      const sharesSubject = spots.some(other => other.file !== spot.file && other.file.subjects.some(subject => spot.file.subjects.includes(subject)));
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

Expected: PASS, 6 tests.

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

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/detectors/frequency.test.ts`

Expected: FAIL. Cannot import `../../src/detectors/frequency.ts`.

- [ ] **Step 3: Implement**

Create `src/detectors/frequency.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Finding, RiskMap } from '../schema.ts';

const RUNS_TESTS = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|npx\s+(?:vitest|jest)|vitest|jest|pytest)\b/;
const SCOPED = /--changed|--related|\brelated\b|--findRelatedTests|--onlyChanged|--affected|\baffected\b/;
const HOOK_FILES = ['.husky/pre-commit', '.husky/pre-push', '.githooks/pre-commit', '.githooks/pre-push', 'lefthook.yml'];
const HOOK_SCRIPTS = ['pretest', 'precommit', 'pre-commit', 'prepush', 'pre-push'];
const AGENT_RUN_ALL = /\b(?:run|execute)\s+(?:all|the\s+(?:full|entire|whole)|every)\s+tests?(?:\s+suite)?\b|\balways\s+run\s+(?:the\s+)?tests?\b/i;
const EXPENSIVE_OS = /^(?:macos|windows)/i;

const readText = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null);

function phaseAdvice(map: RiskMap | null): string {
  if (!map) return '';
  if (map.phase === 'dev') return ' In the dev phase, prefer one non-blocking Linux job on pull_request, plus workflow_dispatch and a scheduled run for the OS matrix.';
  return '';
}

function triggersOf(workflow: Record<string, unknown>): Record<string, unknown> {
  const on = workflow.on ?? workflow['true'];
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map(name => [String(name), null]));
  if (on && typeof on === 'object') return on as Record<string, unknown>;
  return {};
}

/** Where and how often the suite runs: hooks, watch mode, CI triggers and OS matrices, and agent instructions. */
export function detectFrequency(root: string, map: RiskMap | null): Finding[] {
  const findings: Finding[] = [];

  const scanHookText = (file: string, text: string): void => {
    text.split(/\r?\n/).forEach((line, index) => {
      if (RUNS_TESTS.test(line) && !SCOPED.test(line) && !line.trim().startsWith('#')) {
        findings.push({
          category: 'frequency',
          rule: 'frequency.hook-full-suite',
          file,
          line: index + 1,
          message: 'A git hook runs the whole suite on every commit or push. Run only affected tests, or move the full run to a slower lane.',
          evidence: line.trim().slice(0, 160),
        });
      }
    });
  };
  for (const hook of HOOK_FILES) {
    const text = readText(join(root, hook));
    if (text !== null) scanHookText(hook, text);
  }

  const pkgText = readText(join(root, 'package.json'));
  if (pkgText !== null) {
    let scripts: Record<string, string> = {};
    try {
      scripts = (JSON.parse(pkgText) as { scripts?: Record<string, string> }).scripts ?? {};
    } catch {
      // Unreadable package.json: nothing to report here.
    }
    for (const name of HOOK_SCRIPTS) {
      if (scripts[name] && RUNS_TESTS.test(scripts[name]) && !SCOPED.test(scripts[name])) {
        findings.push({
          category: 'frequency',
          rule: 'frequency.hook-full-suite',
          file: 'package.json',
          message: `The ${name} script runs the whole suite automatically.`,
          evidence: `${name}: ${scripts[name]}`,
        });
      }
    }
    for (const segment of (scripts.test ?? '').split('&&').map(part => part.trim())) {
      const bareVitest = /^vitest(?:\s|$)/.test(segment) && !/(?:^|\s)(?:run|related|bench)(?:\s|$)|--run\b/.test(segment);
      if (bareVitest || /--watch(?:All)?\b/.test(segment)) {
        findings.push({
          category: 'frequency',
          rule: 'frequency.watch-default',
          file: 'package.json',
          message: 'The test script can start watch mode, which blocks an agent running in an interactive terminal. Make it a single run (vitest run, jest without --watch).',
          evidence: `test: ${scripts.test}`,
        });
        break;
      }
    }
  }

  const workflowDir = join(root, '.github', 'workflows');
  if (existsSync(workflowDir)) {
    for (const name of readdirSync(workflowDir).filter(entry => /\.ya?ml$/.test(entry)).sort()) {
      const file = `.github/workflows/${name}`;
      let workflow: Record<string, unknown>;
      try {
        workflow = (parse(readFileSync(join(workflowDir, name), 'utf8')) ?? {}) as Record<string, unknown>;
      } catch {
        continue;
      }
      const triggers = triggersOf(workflow);
      const jobs = (workflow.jobs ?? {}) as Record<string, { 'runs-on'?: unknown; strategy?: { matrix?: { os?: unknown } } }>;
      const expensiveRunners = [
        ...new Set(
          Object.values(jobs).flatMap(job => {
            const os = job?.strategy?.matrix?.os;
            const runsOn = job?.['runs-on'];
            return [...(Array.isArray(os) ? os : []), ...(typeof runsOn === 'string' ? [runsOn] : [])].map(String).filter(entry => EXPENSIVE_OS.test(entry));
          }),
        ),
      ];
      const automatic: string[] = [];
      for (const trigger of ['push', 'pull_request'].filter(name => name in triggers)) {
        const config = triggers[trigger];
        const has = (key: string): boolean => !!config && typeof config === 'object' && key in config;
        // A tag-only push trigger is a release-lane run, not a run on every push.
        const filtered = has('paths') || has('paths-ignore') || (trigger === 'push' && has('tags') && !has('branches'));
        if (filtered) continue;
        // One Linux job per pull-request update is the recommended non-blocking check; only Windows or macOS makes it costly.
        if (trigger === 'pull_request' && expensiveRunners.length === 0) continue;
        automatic.push(trigger);
        findings.push({
          category: 'frequency',
          rule: trigger === 'push' ? 'frequency.ci-on-push' : 'frequency.ci-on-pull-request',
          file,
          message:
            trigger === 'push'
              ? `CI runs on every push to a branch with no path filter. A pull_request trigger fires once per pull-request update instead.${phaseAdvice(map)}`
              : `A pull_request workflow runs on ${expensiveRunners.join(', ')}, which bills at a higher rate than Linux. Keep the OS matrix off the pull-request path.${phaseAdvice(map)}`,
          evidence: `on: ${trigger}`,
        });
      }
      if (automatic.length > 0) {
        for (const job of Object.values(jobs)) {
          const os = job?.strategy?.matrix?.os;
          const expensive = Array.isArray(os) ? os.map(String).filter(entry => EXPENSIVE_OS.test(entry)) : [];
          if (expensive.length > 0) {
            findings.push({
              category: 'frequency',
              rule: 'frequency.ci-os-matrix-on-push',
              file,
              message: 'An automatic workflow fans out to Windows or macOS runners, which bill at a higher rate than Linux.',
              evidence: `matrix.os: ${expensive.join(', ')}`,
            });
          }
        }
      }
    }
  }

  for (const doc of ['AGENTS.md', 'CLAUDE.md']) {
    const text = readText(join(root, doc));
    if (text === null) continue;
    text.split(/\r?\n/).forEach((line, index) => {
      if (AGENT_RUN_ALL.test(line)) {
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
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/detectors/frequency.test.ts`

Expected: PASS, 11 tests.

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
import { describe, expect, it } from 'vitest';
import { candidateDirs, draftRiskMap } from '../src/riskdraft.ts';
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/riskdraft.test.ts`

Expected: FAIL. Cannot import `../src/riskdraft.ts`.

- [ ] **Step 3: Implement**

Create `src/riskdraft.ts`:

```ts
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IGNORED_DIRS } from './discover.ts';
import { defaultRiskMap } from './riskmap.ts';
import type { RiskMap, Tier } from './schema.ts';

const BASES = ['src', 'lib', 'app', 'packages', 'apps'];
const SKIPPED = /^(?:tests?|__tests__|docs?|scripts|fixtures?)$/i;
const CRITICAL = /(auth|security|crypto|secret|payment|billing|money|ledger|persist|storage|store|database|db|migrat|schema|session|permission|account)/i;
const LOW = /^(?:ui|views?|components?|styles?|themes?|examples?|demo|playground|storybook|stories|assets)$/i;

const isDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

/** Directories the risk map should classify: the children of src/lib/app/packages/apps, or of the root when none exist. */
export function candidateDirs(root: string): string[] {
  const bases = BASES.filter(base => isDir(join(root, base)));
  const parents = bases.length > 0 ? bases : ['.'];
  const found: string[] = [];
  for (const base of parents) {
    for (const entry of readdirSync(join(root, base), { withFileTypes: true })) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.') || SKIPPED.test(entry.name)) continue;
      found.push(base === '.' ? entry.name : `${base}/${entry.name}`);
    }
  }
  return found.sort();
}

function classify(dir: string): { tier: Tier; why: string } {
  const name = dir.split('/').pop() ?? dir;
  const critical = name.match(CRITICAL);
  if (critical) return { tier: 'critical', why: `name suggests ${critical[1].toLowerCase()}; confirm` };
  if (LOW.test(name)) return { tier: 'low', why: 'presentation or example code; confirm' };
  return { tier: 'standard', why: 'default; confirm' };
}

const CODE = /\.[cm]?[jt]sx?$/;
const SOURCE_BASES = ['src', 'lib', 'app'];

const hasLooseCode = (root: string, base: string): boolean => readdirSync(join(root, base), { withFileTypes: true }).some(entry => entry.isFile() && CODE.test(entry.name));

/** A first guess from directory names. The owner confirms it once; later scans flag drift. */
export function draftRiskMap(root: string): RiskMap {
  const map = defaultRiskMap();
  map.areas = candidateDirs(root).map(dir => ({ path: `${dir}/**`, ...classify(dir) }));
  // Code that sits directly in the source directory belongs to no subdirectory. First match wins, so this catch-all goes last.
  for (const base of SOURCE_BASES) {
    if (isDir(join(root, base)) && hasLooseCode(root, base)) {
      map.areas.push({ path: `${base}/**`, tier: 'standard', why: 'files directly under the source directory; confirm' });
    }
  }
  return map;
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/riskdraft.test.ts`

Expected: PASS, 6 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/riskdraft.ts tests/riskdraft.test.ts
git commit -m "feat: draft a risk map from directory names"
```

---

## Task 12: Git churn

Churn counts commits that edited a test without touching the code it covers: the signature of a brittle test rewritten for its own sake. It needs git history; outside a repository it reports `null`.

**Files:**
- Create: `tests/churn.test.ts`, `src/churn.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/churn.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { churnOf, commitFileSets } from '../src/churn.ts';
import { makeTree } from './helpers/tree.ts';

const git = (root: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, stdio: 'ignore', windowsHide: true });
};

function repoWithHistory(): string {
  const root = makeTree({ 'src/a.ts': 'v1', 'tests/a.test.ts': 'v1' });
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'one');
  writeFileSync(join(root, 'tests/a.test.ts'), 'v2');
  git(root, 'commit', '-q', '-am', 'two: test only');
  writeFileSync(join(root, 'tests/a.test.ts'), 'v3');
  writeFileSync(join(root, 'src/a.ts'), 'v2');
  git(root, 'commit', '-q', '-am', 'three: both');
  return root;
}

describe('commitFileSets', () => {
  it('returns null outside a git repository', () => {
    expect(commitFileSets(makeTree({ 'a.txt': '' }), 10)).toBeNull();
  });

  it('lists the files each commit touched, newest first', () => {
    const sets = commitFileSets(repoWithHistory(), 10);
    expect(sets?.map(set => [...set].sort())).toEqual([
      ['src/a.ts', 'tests/a.test.ts'],
      ['tests/a.test.ts'],
      ['src/a.ts', 'tests/a.test.ts'],
    ]);
  });

  it('honours the commit limit', () => {
    expect(commitFileSets(repoWithHistory(), 2)).toHaveLength(2);
  });
});

describe('churnOf', () => {
  it('counts edits to the test that never touched the code it covers', () => {
    const sets = commitFileSets(repoWithHistory(), 10);
    expect(churnOf('tests/a.test.ts', ['src/a.ts'], sets)).toEqual({ churn: 1, edits: 3 });
  });

  it('reports unknown churn without subjects or without history', () => {
    const sets = commitFileSets(repoWithHistory(), 10);
    expect(churnOf('tests/a.test.ts', [], sets)).toEqual({ churn: null, edits: 3 });
    expect(churnOf('tests/a.test.ts', ['src/a.ts'], null)).toEqual({ churn: null, edits: null });
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

/** Files touched by each of the last `limit` commits, newest first, relative to `root`. Null when `root` has no usable git history. */
export function commitFileSets(root: string, limit: number): Array<Set<string>> | null {
  let log: string;
  try {
    log = execFileSync('git', ['-c', 'core.quotepath=off', 'log', '--relative', '--name-only', '--pretty=format:%x00', '-n', String(limit)], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  return log
    .split('\0')
    .slice(1)
    .map(chunk => new Set(chunk.split(/\r?\n/).filter(Boolean)));
}

/**
 * edits: commits that touched the test. churn: those that touched it without touching any code it covers,
 * which is the signature of a brittle test being rewritten for its own sake. Churn is unknown without subjects.
 */
export function churnOf(testRel: string, subjects: string[], sets: Array<Set<string>> | null): { churn: number | null; edits: number | null } {
  if (sets === null) return { churn: null, edits: null };
  let edits = 0;
  let churn = 0;
  for (const set of sets) {
    if (!set.has(testRel)) continue;
    edits++;
    if (subjects.length > 0 && !subjects.some(subject => set.has(subject))) churn++;
  }
  return { churn: subjects.length > 0 ? churn : null, edits };
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/churn.test.ts`

Expected: PASS, 5 tests. The test creates throwaway git repositories under your temp directory.

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
      findings.push({
        category: 'wiring',
        rule: 'wiring.untiered',
        file: file.rel,
        message: 'Test exercises code that matches no risk-map area, so it has no tier.',
        evidence: file.subjects.join(', '),
      });
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
    if (!files.some(file => file.subjects.some(subject => pattern.test(subject)))) {
      findings.push({
        category: 'wiring',
        rule: 'wiring.uncovered-critical',
        file: area.path,
        message: 'Critical area with no test file exercising it.',
        evidence: area.why ?? '',
      });
    }
  }
  for (const dir of candidateDirs) {
    if (!tierFor(map, `${dir}/__probe__.ts`)) {
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

Expected: PASS, 2 tests.

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/scan.test.ts`

Expected: FAIL. Cannot import `../src/scan.ts`.

- [ ] **Step 3: Implement**

Create `src/scan.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { churnOf, commitFileSets } from './churn.ts';
import { detectFrequency } from './detectors/frequency.ts';
import { detectRedundancy } from './detectors/redundancy.ts';
import { detectShims } from './detectors/shims.ts';
import { detectWiring } from './detectors/wiring.ts';
import { detectWorktreeHazards } from './detectors/worktree.ts';
import { detectRunner, discoverTests } from './discover.ts';
import { openParseSession, resolveSubjects, type ParsedFile } from './parse.ts';
import { candidateDirs } from './riskdraft.ts';
import { loadRiskMap, tierFor } from './riskmap.ts';
import { EVIDENCE_SCHEMA, Tier, type EvidenceReport, type FileFlag, type Finding, type RiskMap, type TestFileRecord } from './schema.ts';

export interface ScanOptions {
  commitLimit?: number;
}

const RANK: Record<Tier, number> = { critical: 3, standard: 2, low: 1 };

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

const byLocation = (a: Finding, b: Finding): number => (a.line ?? 0) - (b.line ?? 0) || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0);

/** Gather evidence about a project's tests. Never executes them and never judges: verdicts belong to the audit skill. */
export function scan(rootInput: string, options: ScanOptions = {}): EvidenceReport {
  const root = resolve(rootInput);
  const map = loadRiskMap(root);
  const sets = commitFileSets(root, options.commitLimit ?? 500);

  const session = openParseSession();
  let loaded;
  try {
    loaded = discoverTests(root).map(rel => {
      const text = readFileSync(join(root, rel), 'utf8');
      const parsed = session.parse(rel, text);
      const declared = (parsed.tags.subjects ?? []).filter(path => existsSync(join(root, path)));
      const subjects = [...new Set([...resolveSubjects(root, rel, parsed.imports), ...declared])].sort();
      return { rel, text, lines: text.split(/\r?\n/), parsed, subjects };
    });
  } finally {
    session.close();
  }

  const records = new Map<string, TestFileRecord>();
  for (const file of loaded) {
    const { tier, area } = tierOfFile(map, file.rel, file.subjects, file.parsed.tags.risk);
    const { churn, edits } = churnOf(file.rel, file.subjects, sets);
    records.set(file.rel, {
      file: file.rel,
      tests: file.parsed.tests.length,
      assertions: file.parsed.assertions,
      flags: flagsOf(file.parsed),
      subjects: file.subjects,
      tags: file.parsed.tags,
      tier,
      area,
      cost: { wait: null, agent: Math.ceil(Buffer.byteLength(file.text) / 4), ci: null, churn, edits },
      findings: [],
    });
  }

  const projectFindings: Finding[] = [];
  const attach = (findings: Finding[]): void => {
    for (const finding of findings) (records.get(finding.file)?.findings ?? projectFindings).push(finding);
  };

  for (const file of loaded) {
    const shimNote = map ? (map.consumers.length === 0 ? 'No consumers declared in the risk map.' : undefined) : 'No risk map, so consumers are unknown.';
    attach(detectShims(file.rel, file.parsed).map(finding => (shimNote ? { ...finding, note: shimNote } : finding)));
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

Expected: PASS, 14 tests. If "reports exactly the planted smells, each once" fails, the diff names the exact `rule@file` that is missing, extra or duplicated; fix the fixture file or code block you mis-typed, never `expected.json`.

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

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('renderMarkdown', () => {
  it('summarizes the bloated fixture with findings grouped by category', () => {
    const markdown = renderMarkdown(scan(join(FIXTURES, 'bloated'), { commitLimit: 1 }));
    expect(markdown).toContain('# Test audit evidence');
    expect(markdown).toContain('- Phase: dev');
    expect(markdown).toContain('| shim | 3 |');
    expect(markdown).toContain('### worktree');
    expect(markdown).toContain('`tests/net/server.test.ts:');
    expect(markdown).toContain('**frequency.watch-default**');
    expect(markdown).toContain('## Files sharing a subject');
  });

  it('lists files with the most findings first', () => {
    const markdown = renderMarkdown(scan(join(FIXTURES, 'bloated'), { commitLimit: 1 }));
    const table = markdown.split('## Test files')[1]?.split('\n').filter(line => line.startsWith('| tests/')) ?? [];
    expect(table[0]).toContain('tests/net/server.test.ts');
  });

  it('says None when there are no findings', () => {
    const markdown = renderMarkdown(scan(join(FIXTURES, 'clean'), { commitLimit: 1 }));
    expect(markdown).toContain('## Findings\n\nNone.');
  });

  it('escapes pipes in table cells', () => {
    const report = scan(join(FIXTURES, 'clean'), { commitLimit: 1 });
    report.files[0]!.file = 'a|b.test.ts';
    expect(renderMarkdown(report)).toContain('a\\|b.test.ts');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/report.test.ts`

Expected: FAIL. Cannot import `../src/report.ts`.

- [ ] **Step 3: Implement**

Create `src/report.ts`:

```ts
import { Category, type EvidenceReport, type Finding } from './schema.ts';

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const where = (finding: Finding): string => `${finding.file}${finding.line ? `:${finding.line}` : ''}`;

/** Markdown view of an evidence report for the audit skill to read and the owner to skim. */
export function renderMarkdown(report: EvidenceReport): string {
  const all = [...report.files.flatMap(file => file.findings), ...report.projectFindings];
  const out: string[] = [
    '# Test audit evidence',
    '',
    `- Runner: ${report.runner}`,
    `- Phase: ${report.phase ?? 'unknown (no risk map)'}`,
    `- Risk map: ${report.riskMapPresent ? 'present' : 'missing'}`,
    `- Test files: ${report.files.length}`,
    '- Cost columns: agent is the estimated tokens in the test file; churn counts commits that edited the test without touching the code it covers; wait and CI need a timed run and are not filled by this report.',
    '',
    '## Findings by category',
    '',
    '| Category | Count |',
    '|---|---|',
    ...Category.options.map(category => `| ${category} | ${all.filter(finding => finding.category === category).length} |`),
    '',
    '## Test files (most findings first)',
    '',
    '| File | Tier | Lane | Tests | Asserts | Flags | Agent tokens | Churn | Findings |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  const ranked = [...report.files].sort((a, b) => b.findings.length - a.findings.length || b.cost.agent - a.cost.agent || (a.file < b.file ? -1 : 1));
  for (const file of ranked) {
    out.push(
      `| ${cell(file.file)} | ${file.tier ?? '-'} | ${file.tags.lane ?? '-'} | ${file.tests} | ${file.assertions} | ${file.flags.join(', ') || '-'} | ${file.cost.agent} | ${file.cost.churn ?? '-'} | ${file.findings.length} |`,
    );
  }
  if (report.clusters.length > 0) {
    out.push('', '## Files sharing a subject', '');
    for (const cluster of report.clusters) out.push(`- \`${cluster.subject}\` (${cluster.layers.join(', ')}): ${cluster.files.map(file => `\`${file}\``).join(', ')}`);
  }
  out.push('', '## Findings', '');
  if (all.length === 0) out.push('None.');
  for (const category of Category.options) {
    const group = all.filter(finding => finding.category === category).sort((a, b) => (where(a) < where(b) ? -1 : where(a) > where(b) ? 1 : 0));
    if (group.length === 0) continue;
    out.push(`### ${category}`, '');
    for (const finding of group) {
      const evidence = finding.evidence ? ` Evidence: \`${finding.evidence.replace(/`/g, "'")}\`.` : '';
      const note = finding.note ? ` Note: ${finding.note}` : '';
      out.push(`- \`${where(finding)}\` **${finding.rule}**: ${finding.message}${evidence}${note}`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/report.test.ts`

Expected: PASS, 4 tests.

Run: `npm run typecheck`

Expected: exit code 0 and no `error TS` lines (npm prints a two-line banner first).

- [ ] **Step 5: Commit**

```bash
git add src/report.ts tests/report.test.ts
git commit -m "feat: render the evidence report as Markdown"
```

---

## Task 16: CLI

Four commands: `capabilities`, `risk-draft [--write]`, `scan`, `report`. Failures are one-line JSON on stderr with a stable code (`E_USAGE` exits 2; everything else exits 1).

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
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeTree } from './helpers/tree.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');

const tests = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'tests.mjs'), ...args], { encoding: 'utf8', windowsHide: true });

describe('tests CLI', () => {
  it('prints capabilities as JSON', () => {
    const result = tests('capabilities');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ name: 'agent-tests', commands: ['capabilities', 'risk-draft', 'scan', 'report'] });
  });

  it('rejects an unknown command with E_USAGE and exit 2', () => {
    const result = tests('frobnicate');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr).error.code).toBe('E_USAGE');
  });

  it('rejects an unknown flag with E_USAGE', () => {
    const result = tests('scan', '--bogus');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr).error.code).toBe('E_USAGE');
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
    expect(JSON.parse(result.stderr).error.code).toBe('E_RISKMAP');
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

    const again = tests('risk-draft', '--root', root, '--write');
    expect(again.status).toBe(1);
    expect(JSON.parse(again.stderr).error.code).toBe('E_EXISTS');
  });

  it('rejects a root that does not exist', () => {
    const result = tests('scan', '--root', join(ROOT, 'no-such-directory'));
    expect(result.status).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/cli.test.ts`

Expected: FAIL. Every case fails because `scripts/tests.mjs` does not exist.

- [ ] **Step 3: Implement**

Create `src/cli.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CliError } from './errors.ts';
import { renderMarkdown } from './report.ts';
import { draftRiskMap } from './riskdraft.ts';
import { RISK_MAP_PATH, serializeRiskMap } from './riskmap.ts';
import { scan } from './scan.ts';

const COMMANDS = ['capabilities', 'risk-draft', 'scan', 'report'] as const;

function packageVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
}

function run(args: string[]): void {
  const [command, ...rest] = args;
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    throw new CliError('E_USAGE', `Usage: tests <${COMMANDS.join('|')}> [--root <dir>] [--write]`);
  }
  let values: { root?: string; write?: boolean };
  try {
    values = parseArgs({ args: rest, options: { root: { type: 'string' }, write: { type: 'boolean' } }, strict: true }).values;
  } catch (error) {
    throw new CliError('E_USAGE', (error as Error).message);
  }
  if (command === 'capabilities') {
    process.stdout.write(`${JSON.stringify({ name: 'agent-tests', version: packageVersion(), commands: COMMANDS })}\n`);
    return;
  }
  const root = resolve(values.root ?? process.cwd());
  if (!existsSync(root)) throw new CliError('E_USAGE', `Root does not exist: ${root}`);

  if (command === 'risk-draft') {
    const text = serializeRiskMap(draftRiskMap(root));
    if (!values.write) {
      process.stdout.write(text);
      return;
    }
    const target = join(root, RISK_MAP_PATH);
    if (existsSync(target)) throw new CliError('E_EXISTS', `${RISK_MAP_PATH} already exists. Edit it by hand or delete it first.`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    process.stdout.write(`${JSON.stringify({ written: RISK_MAP_PATH })}\n`);
    return;
  }
  const report = scan(root);
  process.stdout.write(command === 'scan' ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
}

export async function main(argv: string[]): Promise<void> {
  try {
    run(argv.slice(2));
  } catch (error) {
    const failure = error instanceof CliError ? error : new CliError('E_INTERNAL', (error as Error).message);
    console.error(JSON.stringify({ error: { code: failure.code, message: failure.message, ...(failure.hint ? { hint: failure.hint } : {}) } }));
    process.exitCode = failure.code === 'E_USAGE' ? 2 : 1;
  }
}
```

Create `scripts/tests.mjs`:

```js
#!/usr/bin/env node
import { main } from '../src/cli.ts';
await main(process.argv);
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/cli.test.ts`

Expected: PASS, 8 tests.

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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'skills');
const COMMANDS = ['capabilities', 'risk-draft', 'scan', 'report'];
const REQUIRED = ['tests-setup', 'test-audit', 'test-strategy'];

const skillNames = readdirSync(SKILLS, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

function load(name: string): { meta: Record<string, string>; body: string } {
  const text = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${name}/SKILL.md has no frontmatter`);
  return { meta: parse(match[1]) as Record<string, string>, body: match[2] };
}

describe('skills', () => {
  it('ships the expected skills', () => {
    expect(skillNames).toEqual(expect.arrayContaining(REQUIRED));
  });

  describe.each(skillNames)('%s', name => {
    const { meta, body } = load(name);

    it('has frontmatter matching its directory', () => {
      expect(meta.name).toBe(name);
      expect(typeof meta.description).toBe('string');
      expect(meta.description.length).toBeGreaterThan(40);
      expect(meta.description.length).toBeLessThanOrEqual(400);
    });

    it('says when to use it', () => {
      expect(meta.when_to_use).toMatch(/^Use /);
    });

    it('stays short enough to hold in context', () => {
      expect(body.split('\n').length).toBeLessThanOrEqual(160);
    });

    it('only calls CLI commands that exist', () => {
      const called = [...body.matchAll(/run-managed\.js" ([a-z-]+)/g)].map(match => match[1]);
      for (const command of called) expect(COMMANDS).toContain(command);
    });

    it('only points at scripts and references that exist', () => {
      for (const match of body.matchAll(/scripts\/([\w-]+\.js)/g)) expect(existsSync(join(ROOT, 'scripts', match[1]))).toBe(true);
    });
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
when_to_use: Use before the first agent-tests command in a session, after a plugin update, or when an agent-tests skill reports "Managed CLI ... is missing", "rerun tests-setup", E_RUNTIME_MISSING, or a runtime version mismatch.
---
# tests-setup

The plugin cache holds source only. The `tests` CLI runs from a managed release in
`~/.agent-tests/releases/<version>-<fingerprint>-...` (override with `AGENT_TESTS_HOME`).
Skills always launch it through the plugin's checked launcher, never a `tests` on PATH:

    node "<plugin-root>/scripts/run-managed.js" <command> [args]

`<plugin-root>` is the directory two levels above this SKILL.md. In Codex, resolve it from the
SKILL.md file you actually loaded, not from the current directory.

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
| `Managed runtime modified or version mismatch` | Move the named release directory aside, then run step 2. |
| `Another setup may be running (...setup.lock)` | Confirm no setup process is running, delete the lock, rerun. |
| `needs Node 24 or newer` | Upgrade Node; do not work around it. |
| `Cannot locate npm-cli.js` | Install Node.js with npm, then rerun. |

Never edit files inside a managed release; reinstall instead.
```

Create `skills/test-audit/SKILL.md`:

```markdown
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
3. **Evidence.** `node "<plugin-root>/scripts/run-managed.js" report --root <project>` for the Markdown view, or `scan` for JSON.
   This version never runs the tests, so the wait and CI cost columns are empty. Agent cost is estimated tokens in the file.
   Churn is commits that edited the test without touching the code it covers.
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
```

Create `skills/test-strategy/SKILL.md`:

```markdown
---
name: test-strategy
description: Structure a project's tests by phase (dev, test, production) and run frequency (edit, merge, scheduled, release lanes) using a risk map, and keep agent-written tests from bloating the suite.
when_to_use: Use when starting a project or feature area, or deciding how a project's tests and CI should be structured (what to test, how often each test runs, whether CI is needed and where, and what testing rules to give coding agents). For an existing suite that already feels bloated, use test-audit first.
---
# test-strategy

Efficiency means protection per unit of cost. The same test costs about a hundred times more on every edit than
nightly, so most of the win is putting each test in the right lane, not deleting tests.

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

Expected: PASS, 16 tests.

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

Expected: YAML printed to the terminal with `src/detectors/**` and a `src/**` catch-all. Nothing is written.

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
| `report` | The same evidence as Markdown |

## Status

Version 0.1 is a static audit for TypeScript and JavaScript projects using vitest or jest. It never runs your tests, so
wait time, CI minutes and flakiness are not measured yet. Planned: a timed run with a second-worktree check (0.2),
remediation and CI templates (0.3), Codex packaging verified on both hosts (0.4), then Python and pytest.

## Known limitations

- Pattern detectors also match strings inside tests that are about those patterns, including this repository's own tests.
  Findings are evidence for the agent to read, not verdicts.
- Subjects are found through relative imports only. Path aliases are not resolved yet.
- Churn needs git history and is unknown for tests with no resolvable subject.

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
- `shim | 5` and `worktree | 9`: false positives from `tests/detectors/shims.test.ts` (3), `tests/detectors/worktree.test.ts` (8), `tests/managed-runtime.test.ts` (1), `tests/scan.test.ts` (2), whose test data is made of those very patterns;
- `redundancy | 7`, all `redundancy.shared-subject`: several tests import `src/riskmap.ts` or `src/schema.ts` to build fixtures, not to test them.

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

Expected: `Test Files  18 passed (18)` and `Tests  175 passed (175)`.

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
5. `report` prints `# Test audit evidence` with `Test files: 4` and `None.` under Findings.

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
