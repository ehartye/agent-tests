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
