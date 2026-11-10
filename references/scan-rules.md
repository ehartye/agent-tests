# Scan rules

Per-rule detail for the rules the test-audit skill reads most often. Every rule here is a review hint, not a verdict:
the scan matches text and paths, so open the test and the code under test before judging. The examples are the planted
cases from this tool's own detector tests.

File-system pollution (shared temp paths, writes into the checkout) is a minority cause of flaky tests in the measured
studies, so a `worktree.*` hit is a reason to read the test, not evidence that the test is flaky.

## worktree.timestamp-tmp-path

Means: a temp path named from a clock value (`Date.now()`, `new Date().getTime()`, `performance.now()`,
`process.hrtime`, `process.pid`) with no random part and no `mkdtemp`. Two runs in the same millisecond, or two
worktrees running at once, can build the same name and share or clobber the file.

Recommend: create the directory with `mkdtemp` under `tmpdir()`, put every file inside it, and remove it in cleanup
(`afterEach`/`afterAll`). `mkdtemp` appends its random characters directly to the prefix, so the prefix must end with a
path separator or a dash: `mkdtemp(join(tmpdir(), 'name-'))` yields `name-Ab12Cd`, while `mkdtemp(join(tmpdir(), 'name'))`
yields `nameAb12Cd` beside other temp entries.

Flagged:

```ts
const db = join(tmpdir(), `x-${Date.now()}.db`);
const moved = join(tmpdir(), 'set-moved-' + Date.now());
const p = `/tmp/run-${process.pid}.log`;
const dir = 'name-' + Date.now();
```

Quiet (the fix is already in place, or the name is unique):

```ts
const dir = mkdtempSync(join(tmpdir(), 'x-'));
const db = join(dir, 'y-' + Date.now());
const db2 = join(tmpdir(), `t-${randomUUID()}.db`);
const started = Date.now();
```

## worktree.shared-tmp

Means: a fixed `/tmp/...` string literal, or a fixed name after `tmpdir(),` that is not a `mkdtemp` prefix (one ending in
`-` or `_`). Every worktree and every parallel run builds the same path, so they share or clobber what is there. The rule
reads one line at a time and stays quiet when `mkdtemp` is on the same or the previous line.

Recommend: create the directory with `mkdtemp` (see above) and put the file inside it.

Flagged:

```ts
writeFileSync('/tmp/out.log', x);
const dir = '/tmp/work';
mkdirSync("/tmp/fixed");
const p = join(tmpdir(), 'fixed');
```

An array row (`'/tmp/assets',` alone on its line) and the argument line of a call split over several lines
(`writeFileSync(`, then `'/tmp/out.log',`, then `data)`) stay flagged, and the finding is on the literal's line. Such a
line looks the same as a write, and a silent miss on a real hazard is worse than a hit to read past.

Quiet (a value that is not written, or a path only checked for absence):

```ts
{ path: '/tmp/assets' },
expect(existsSync('/tmp/gone')).toBe(false);
```

Only an object-property data row (`key: '/tmp/x'`, alone on its line) and an absence check (`existsSync` or `exists` of
the literal asserted false) are quiet, besides the existing `mkdtemp` cases.

## worktree.fixed-db-file

Means: a quoted database file name ending `.sqlite`, `.sqlite3` or `.db`, such as `'test.sqlite'` or `'data/app.db'`. Two
worktrees, or two parallel runs, open the same file unless the path is unique per run. A name under `fixtures/` is quiet,
as is a line with `mkdtemp` on it or on the line before.

Quiet when the file sits in a directory the test file made: once the file has assigned an identifier from
`mkdtemp` or `mkdtempSync` (also `await mkdtemp`) on an earlier line, a match is not flagged when that identifier is an
argument of the same join, `path.join` or `resolve` call that holds the quoted file name, for example
`new DatabaseSync(join(runDir, 'run.sqlite'))`. The identifier merely appearing elsewhere on the line, or inside a string
literal, does not make it quiet.

Qualified, not silenced, when the directory cannot be traced. `join(dir, 'x.sqlite')` where `dir` is a function parameter,
or has no earlier assignment from `mkdtemp` in this file, is still flagged, and its `note` starts
`Path uniqueness unresolved:` and names `dir` (the note says there is no earlier assignment because the scan reads the
file once, top to bottom: an assignment further down, such as in a `beforeEach`, is not seen). The path may be unique
because the caller passes a per-run directory or the assignment comes later; the scan cannot see that, so check the caller
and the rest of the file. A bare fixed name (`'test.sqlite'`, `'data/app.db'`) is flagged with no note.

Limits: a template literal containing `${...}` is never matched by this rule at all, so an untraced `${dir}/x.sqlite` gives
no finding and no note, and a traced one is not checked either; read such paths yourself. Identifier tracing is name-based,
not scope-aware: a `mkdtemp` assignment to `runDir` anywhere earlier in the file (a leading `this.` is ignored) counts for
every later `runDir`, including one in another function or a parameter with the same name.

Recommend: build the path inside a `mkdtemp` directory and remove it in cleanup.

## no-direct-assertions

A file flag, not a rule with its own finding. It is set when at least one test in the file has no assertion in its own
body (`expect`, `assert` or another recognized form). A helper the test calls may assert for it, so the flag is a reason
to read the test, not proof that it checks nothing. A `todo` test and a declared skip (`it.skip`, `test.skip`) are
exempt: a stub body is a placeholder or never runs, so it is not named. Python tests use the same flag (assertions are
`assert`, `self.assert*`, `self.fail`, `pytest.raises`, `pytest.warns` and `pytest.fail`); skip and xfail marks are not
read, so a skipped Python test with no assertion is still named.

The scan JSON names the tests: `noAssertionTests` is a list of `{ name, line }` in file order that keeps every assertionless
test of the file, each name cut to 80 characters. A file without the flag has no `noAssertionTests` key. `report` prints a
`No direct assertions` section for every flagged file, not only those in the findings table (table order first, then the
rest by path), up to 20 files and then `+K more files (see the JSON noAssertionTests)`. Each file shows at most 5 names,
one line each, `<file>: "does nothing" (line 12)`, then `and K more` with K the real number left.
`it.each` rows and nested `describe` blocks attribute their assertions to the test that contains them.

## Skipped cases

The scan records skips in an optional `skips` field on a test file: `{ declared, conditional, reasons }`. A file without
skips has no `skips` key.

- Declared: the test is declared with `it.skip` or `test.skip`. It never runs.
- Conditional: it is declared with `it.skipIf(cond)` or `it.runIf(cond)`, or its body skips it at run time with
  `ctx.skip('no network')` on the context parameter (any name: `ctx`, `context`, `t`) or a destructured `skip(...)`.
  A Playwright-style `test.skip(isCI, 'flaky on CI')` inside a test body is not a test: a `test.skip` or `it.skip` call
  whose first argument is not a string or template literal and whose second argument is not a function counts as one
  conditional skip. A call with a string title or a function body, `test.skip('later', () => {})`, is a declared skip.
  Known limit: because a skip call whose second argument is not a function is read as an inline conditional skip, a
  skipped declaration whose handler is a bare reference or call (`it.skip(name, handler)`, `test.skip(title, vi.fn())`,
  `test.skip(title, runCase.bind(null, 1))`) is counted as a conditional skip and not as a test, and a one-argument
  `test.skip(title)` is likewise counted as a conditional skip. A skipped test written that way is missing from the
  declared count; read such files yourself.
- Counts are tests, not calls. A declared skip is counted once and never also as conditional.
- `reasons` holds the reason of each skip call, distinct, at most 3 per file and 80 characters each. A context skip
  takes its first string argument; an inline `test.skip(cond, 'reason')` takes its second argument. The reason is recorded
  only when it is a plain string or a template without `${...}`; a variable or a template with substitutions adds no
  reason, and none is invented.

`report` shows the totals in the header line `- Skipped cases: <n> declared, <m> conditional in <k> files` (only when
any skip exists) and a `Skips` section with one line per file (at most 20 files, then a count of the rest) giving the
counts and up to 3 reasons. A declared skip protects nothing today: ask whether to restore or remove it. A conditional
skip protects only where its condition allows, so check that the condition holds in the lane that needs the test.

## frequency.ci-on-push (path filter)

Means: a push-triggered workflow with a `paths:` filter on an expensive runner. The finding asks for a review of overlap
with local or PR validation.

A paths filter is a trigger, not an ownership list; the scan does not map workflow steps to test files.

Which tests a workflow runs, and which job owns a behavior, must be read from the workflow itself. The sentence is on
this finding only: `frequency.ci-on-pull-request` does not parse `paths:` and its message is unchanged.

## worktree.cwd-write

Means: a write call (`writeFile`, `appendFile`, `mkdir`, `rm`, `unlink`, `truncate`, `createWriteStream`, or the
destination of `copyFile`/`cp`/`rename`/`symlink`) whose path contains `process.cwd()`. The test writes into the
checkout the suite was started from, so it dirties the working tree and collides with a second worktree or a parallel run.

Recommend: write into a per-run `mkdtemp` directory (see above) and clean it up. If the code under test needs a
working directory, pass the temp directory in rather than relying on the process's.

Flagged:

```ts
writeFileSync(join(process.cwd(), 'out.txt'), 'x');
mkdirSync(join(process.cwd(), 'assets', 'tmp'), { recursive: true });
copyFileSync(join(src, 'a.txt'), join(process.cwd(), 'a.txt'));
```

Quiet: `writeFileSync(join(dir, 'out.txt'), 'x')`, `spawn(cmd, args, { cwd: process.cwd() })`, and a copy that only
reads from `process.cwd()`.

## worktree.cwd-locate

Means: `process.cwd()` joined, resolved or concatenated into a path, or a relative `resolve('scripts/...')` of a
repository directory, to find repository files. It works only while the suite starts at the repository root, so it breaks
when the suite runs from another directory, a package subfolder or another worktree. A line that writes is reported as
`worktree.cwd-write` instead.

Recommend: build the path from the test file's own location (`import.meta.url` with `fileURLToPath`, or `__dirname`) or
from the repository root, and keep any output in a `mkdtemp` directory.

Flagged:

```ts
const cli = join(process.cwd(), 'scripts', 'x.mjs');
const cli = process.cwd() + '/scripts/sprite.js';
const cli = resolve('scripts/sprite.js');
```

Quiet: `join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'x.mjs')` and a bare `const cwd = process.cwd();`.

## wiring.unmapped-subject

Means: a test has at least one subject covered by a risk-map area and at least one other subject that no area covers.
The tier stays the highest tier among the mapped subjects, so the unmapped code is silently left out of the tier decision.
The finding names the unmapped path and the area that did map. It appears only for real subjects (imports or `@subject`
tags), not for a file mapped by its own path.

Recommend: if the unmapped code matters, add a risk-map area for it with a tier; if it is incidental, leave it or tag
the file with `@risk` to state the tier explicitly. Do not treat the tier as wrong without reading the test.

Example evidence: `src/misc/x.ts; mapped area: src/db/**` (a test importing `src/db/s.ts` and `src/misc/x.ts` with only
`src/db/**` mapped).

## wiring.inventory-incomplete

Means: a critical risk-map area has no inventoried test, but the scan cannot fully see the tests that might cover it, so
coverage of the area is unknown, not absent. It replaces `wiring.uncovered-critical` in two cases:

- A language the scan only counts by file name (Go, Ruby, PowerShell, Java, Kotlin, C# and PHP; status
  `detected-unsupported`) exists, and the area holds a classifiable file that is neither JavaScript, TypeScript nor Python.
  The message names the unsupported languages. Python is read, so a Python-only area is not softened by an unrelated
  language. Trade-off: in a mixed-language repository, an area with any other kind of file and no covering test reads
  "coverage unknown" even if it is genuinely untested, so it can soften a real gap.
- The area holds Python files and lies within the scope of a Python incompleteness note (`inventory.noteScopes`): a custom
  `python_files` setting (scope `"all"`), a facade import through a package `__init__.py` (scope: that package), or a Python
  file with opaque registration (scope: its subjects' packages). The message quotes the note. A Python area outside every
  note's scope stays `wiring.uncovered-critical`, so one odd file does not mute the rest of the repo.

The census names, the `inventory` object, the scope containment rule and the exact conditions are in
[inventory.md](inventory.md).

Recommend: open the tests the message points to (the named languages' tests, or the Python files the note describes) and
check whether they exercise the area. Do not report it as uncovered, or as covered, before reading them. If they do, the
risk-map area is fine; the scan simply cannot see it.

Example evidence: `0 inventoried test files import this area; unsupported: Go` (an area `go/**` whose tests are
`go/service_test.go`) and `0 inventoried test files import this area; Python notes: imports through a package __init__ may
reach other modules` (an area `src/pkg/io.py` when a test imports `pkg` through its `__init__.py`).

## wiring.opaque-test-registration (Python)

Means: a Python test file registers tests in a way the static reader cannot see, so its count of recognized declarations
may undercount it. The report shows `+?` on the file, as for JavaScript helpers. There are three Python triggers: a module
that defines `load_tests` (unittest only; pytest ignores it); a module-level import whose bound name is `Test*`, `*Test` or
`*TestCase` (an imported test class, collected in the importing module; the source module is not checked, so
`from unittest import TestCase` also matches); and a non-literal dynamic import (`import_module(name)` or
`__import__(name)`, whose target and subjects are unknown). The evidence is `load_tests`, the imported name, or
`non-literal import`.

Each such file also adds the opaque note to `inventory.notes` and `inventory.noteScopes`, which can turn an uncovered
critical Python area near it into `wiring.inventory-incomplete` (see above).

Recommend: open the module, read what `load_tests` returns or where the imported class is declared, and compare a native
inventory (the runner's own collection listing, run by you or the owner; the scan never runs it) before judging the
file's count or its coverage.

## shim.title-marker

Title-only: it reads the test title, never the code. Bare "fallback" and bare "compat" no longer match, because titles
use them for current behavior ("uses the fallback glyph when the font lacks a character", "reads the compat shorthand
option"). "legacy" counts only beside an old-data noun (format, file, config, loader, schema, v1) or migration wording.
Still matched: "legacy v1 loader shim for old files", "falls back to the legacy parser", "backwards compatible output",
"compatibility with older files", "deprecated", "polyfill", "shim", "migrated from v1", "old format input".
Not matched: "legacy horizontal pagination keeps its topology", "uses a fallback", "fall-back path".
A match still needs question 2 of the rubric: read the code under test and find the consumer.

## redundancy.shared-subject

Each finding carries the title words the file shares with its closest cluster partner in its evidence
(`shared title words with tests/z2.test.ts (3): order, pending, reloads`) and, when there are at least two such words,
a numeric `overlap` field in the scan JSON. A finding that shares only a subject has no `overlap`. The report breaks
ranking ties by the largest overlap and spells out the shared words for the first rows. A shared title overlap says the
tests talk about the same behavior, so read those clusters first; a subject-only finding is still weak evidence.
`redundancy.hub-subject` is unchanged: a subject imported by many files is shared infrastructure, not duplication.

## wiring.drift

A bare directory is no longer reported when a `folder/**` area covers it, or when every file in it is covered by its
descendants' areas. A directory with some unclassified files is reported with those file paths as evidence; an empty or
unknown directory is reported with none.
