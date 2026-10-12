# APcademy Government: component ownership and build gates

Inspected on 2026-10-12 at [APcademy Government commit 1d69542](https://github.com/ehartye/apcademy-government/tree/1d695428340975746be9943dfcd75c7b499d94c5).
The baseline auditor is agent-tests 0.3.0 at `dde1752`. The comparison uses the same clean app checkout and full Git history.
No app code, test files or risk decisions were changed, and no app test suite was executed.

## What the project exposes

- Static discovery finds 185 JavaScript/ESM test files. There is no `.testing/risk.yml`, so this investigation assigns
  no keep, delete, merge or demote verdicts and makes no claim about the suite's necessity.
- The root [package.json](https://github.com/ehartye/apcademy-government/blob/1d695428340975746be9943dfcd75c7b499d94c5/package.json)
  defines `test: vitest run` and `build: npm run validate:explanations && npm test && vite build`.
- [vite.config.js](https://github.com/ehartye/apcademy-government/blob/1d695428340975746be9943dfcd75c7b499d94c5/vite.config.js)
  sets jsdom, a Svelte compiler plugin and `vitest.setup.js`; includes `src/**/*.test.js` and `scripts/**/*.test.mjs`;
  and excludes `server/`. The [server package](https://github.com/ehartye/apcademy-government/blob/1d695428340975746be9943dfcd75c7b499d94c5/server/package.json)
  separately runs `node --test`. A root Vitest receipt cannot establish that the server suite ran.
- UI tests import `.svelte` components and a shared `render-live.svelte.js` helper. Some tests read separately maintained
  content inputs. Filename patterns alone do not establish runtime isolation, test size or duplicated behavior.

## Changes to agent-tests

| Evidence | Baseline | Revised scanner |
|---|---|---|
| Discovered test files | 185 | 185 |
| Files with a `.svelte` component subject | 0 | 47 |
| Root build's suite gate | No frequency finding | `frequency.build-full-suite`, evidence `build -> test: vitest run` |

For example, [Library.test.js](https://github.com/ehartye/apcademy-government/blob/1d695428340975746be9943dfcd75c7b499d94c5/src/lib/screens/Library.test.js)
previously had only its render helper and content module as subjects. It now includes `src/lib/screens/Library.svelte`.
This allows a confirmed component risk area and component edits to participate in tier and churn calculations.
An explicit missing `.svelte` import remains unresolved; a similarly named `.svelte.js` module is not substituted.

Build evidence traverses literal local package-script calls from `prebuild`, `build` and `postbuild` without executing
them. Cycles terminate. Quoted separators and shell comments do not invent commands, and explicit script `t` is distinct
from bare `npm t`. Scoped runs, package selectors, forwarded script arguments and unknown runner filters/options are not
treated as a full root-suite trace.
The finding asks for review: this project's build may be a deliberate deployment gate.

Regression checks reproduce the missing component subject and build finding before the fixes, and guard against
misleading traces. A complete tool-suite run and typecheck validate the implementation; the real checkout comparison
validates these two observed outcomes. This does not measure app test duration, CI charges or flakiness.

## Remaining limitations

1. Discovery is a static file inventory. The report's primary runner does not describe every package, configuration,
   environment or native test count. Table-driven test declarations also do not establish native case counts.
2. Infrastructure discovery does not inspect `vite.config.js` or discover its configured setup file. Blindly scanning
   the entire Vite config for fixed ports would flag this app's development server even when tests never start it.
3. The current risk draft yields broad `src/lib/**` and `src/**` areas and misses the sibling server and content-port
   scripts. The owner must confirm phase, consumers and meaningful areas before a per-file audit can judge protection.
4. Generic loop bounds, duplicate title templates, path-rejection fixtures and home-directory reads require inspection.
   A matching range does not prove duplicate coverage; a rejected absolute path does not prove shared mutable state.

These are follow-up investigations rather than implemented runner/config tracing or safe affected-only selection.

## Architecture advisory: when should build run tests?

The project's full-suite build gate is structurally visible; its duration has not been measured. These alternatives
are project advice, not a recommendation to remove the existing gate without replacement coverage.

**Keep the current gate.** Use this while establishing the risk map and deployment contract.

- **Time:** no implementation effort; each build still incurs the complete root test run. Cost is unmeasured.
- **Risk:** retains current client protection; server protection still needs its separate command. Low change risk.
- **Complexity:** no additional commands or receipt rules.
- **Best practice:** reasonable for a deliberate release gate; inspect callers before declaring the repeated work wasteful.
- **Maintainability:** one build entrypoint, with its existing coupling between bundling and verification.

**Separate bundling from a named release check.** Consider only after identifying all build/deploy callers and confirming
which client, content and server checks the release command must own.

- **Time:** estimated small script/caller change, plus verification; bundling can skip a repeated test run. Savings and
  the later detection delay remain unmeasured.
- **Risk:** an unchecked deployment could omit tests. The release command must run the agreed suites and validators,
  and the deployment entrypoint must require that command against the same candidate.
- **Complexity:** introduces another entrypoint and a requirement to keep release ownership explicit.
- **Best practice:** separates artifact production from verification while preserving a complete release gate.
- **Maintainability:** every deploy/build caller must use the appropriate command; changes to suite ownership update
  the release check as well as the test scripts.
