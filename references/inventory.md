# Test inventory: what the scan can and cannot see

The scan reads the tests of one language family: JavaScript and TypeScript (`*.test.*` and `*.spec.*` files with a
`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts` or `.cts` extension, and code files under `__tests__/`). Everything it reports about
tests, coverage of risk areas and redundancy is about those files. Tests in other languages are not parsed. This page
says how the scan tells you that such tests may exist, and how to read the result. Per-rule detail is in
[scan-rules.md](scan-rules.md); saved artifacts are in [audit-output.md](audit-output.md).

## The language census

Besides discovering JavaScript and TypeScript tests, the scan runs a census: it counts files whose name follows the
conventional test-file naming of another language. The census never opens those files. It counts names only, so a
file named like a test is counted even if it holds none, and the report says "named like tests".

| Language   | Counted when the file name is                                              |
| ---------- | -------------------------------------------------------------------------- |
| Python     | `test_*.py` or `*_test.py`                                                 |
| Go         | `*_test.go`                                                                |
| Ruby       | `test_*.rb` or `*_spec.rb`                                                 |
| PowerShell | `*.Tests.ps1`                                                              |
| Java       | ending `Test.java` or `Tests.java`                                         |
| Kotlin     | ending `Test.kt` or `Tests.kt`                                             |
| C#         | ending `Test.cs` or `Tests.cs`                                             |
| PHP        | ending `Test.php` or `Tests.php`                                           |

Matching is by file name and is case-sensitive. The census walk skips the directories the scan always ignores (for
example `node_modules`, `.git`, `dist`, `build`, `fixtures`, `.venv`, `vendor`) and these census-only directories:
`__pycache__`, `venv`, `env`, `site-packages`, `.tox`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `third_party`,
`thirdparty`, `testdata`, `Pods`, `target` and any `*.egg-info`. The names up to `.ruff_cache` are Python environments and caches;
the others are vendored, generated or fixture trees whose test files are not the project's own. Names match
case-sensitively at any depth.

These census-only skips apply to the census alone, not to JavaScript and TypeScript test discovery, whose own ignore
list is unchanged: a JavaScript test inside `testdata` or `target` is still found and inventoried. A skipped directory
name applies to every language: a Go test file under `env/` or `testdata/` is not counted either, although
most of these names come from Python trees.

The list is not exhaustive. The census cannot see tests with unconventional names, and it cannot see inline tests
(tests that live inside the source file, as in Rust). A language not in the table is not counted at all.

## The `inventory` object

The scan JSON (`agent-tests/evidence@1`) gains an optional top-level `inventory` key:

```json
{
  "complete": false,
  "languages": [
    { "language": "JavaScript", "runner": "vitest", "files": 10, "status": "supported" },
    { "language": "Python", "runner": "unknown", "files": 111, "status": "detected-unsupported" }
  ],
  "notes": ["Those files are named like tests and were counted by file name only, never read, so their test counts and the coverage they give are unknown."]
}
```

- Present only when the census finds a test-named file in at least one language other than JavaScript. A repository
  with no such file has no `inventory` key, and its JSON is the same as before the census existed.
- `languages` lists JavaScript first, with the primary runner the scan detected (`unknown` when none) and the number
  of inventoried JavaScript and TypeScript test files, status `supported`. Each other detected language follows,
  sorted by name, with `runner: "unknown"`, its counted file total, and status `detected-unsupported`.
- `complete` is always `false` when the object is present: a detected-unsupported language means the scan did not
  read part of the suite.
- `runner` keeps its meaning: the top-level `runner` is still the primary JavaScript runner, `unknown` when none is
  detected. It does not describe other languages.

## What the report says

When `inventory` exists, the `report` header gains two lines:

- `- Languages: JavaScript (vitest, 10 files), Python (detected-unsupported, 111 files)`. A supported language shows
  its runner; a detected-unsupported one shows its status.
- `- Inventory incomplete: Python detected but not inventoried. <notes>`. It names the unsupported languages and
  repeats the notes.

Separately, whenever `runner` is `unknown` and the scan found 0 test files, the header adds
`- No supported runner detected; a zero test count does not prove the project has no tests.` This holds for every such
repository, with or without an `inventory`; the JSON is unchanged by it. A Python-only repository therefore shows the
two inventory lines and this line.

## A missing `inventory` key does not mean the inventory is complete

The census sees conventional file names only. A repository whose tests are named unconventionally, or whose tests are
inline, gets no `inventory` key, and a zero or low test count there still proves nothing. Treat the key as a positive
signal (tests in another language were found) and never as a clean bill of health. When the runner is `unknown` and the
count is 0, read the zero-count line above and look for tests by hand before concluding the project has none.

## `wiring.inventory-incomplete`

A critical risk-map area normally gets `wiring.uncovered-critical` when no inventoried test imports it or tags it as a
subject (a test inside the area counts too). When at least one language is `detected-unsupported`, such an area is reported as
`wiring.inventory-incomplete` instead, meaning coverage is unknown, unless every classifiable file in the area is
JavaScript or TypeScript (extensions `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`). The tests of those
files are inventoried, so the scan can trust the "no test" result for them. An area with no classifiable files stays
`wiring.uncovered-critical`. "Classifiable files" are the files the drift check already classifies: not tests, not test
support files, not under ignored or dot directories.

The message names the unsupported languages, says that tests in them exist and are not inventoried, and tells the reader
to check those tests before treating the area as uncovered. The evidence reads
`0 inventoried test files import this area; unsupported: <languages>`. In the report, these findings follow the
`wiring.uncovered-critical` ones.

Trade-off: the rule needs no map from source files to languages, so it also covers an area written in one language and
tested in another (for example C++ source with PowerShell tests). The cost is that in a mixed repository an area
holding any file that is not JavaScript or TypeScript, and having no covering test, reads "coverage unknown" even if it
is genuinely untested. It softens a genuinely untested mixed-language area. The message names the unsupported languages
so the reader can judge: open those tests, and decide whether they exercise the area.

An area made only of JavaScript or TypeScript files with no covering test stays `wiring.uncovered-critical` even when
another language is detected. With no unsupported language detected, nothing changes.

## Saved artifacts

A saved scan or report (`--out`) carries a limit saying that no supported runner was detected and that a zero static
test count does not prove the project has no tests. Without an `inventory`, that warning appears when `runner` is
`unknown`. With an `inventory`, it is suppressed only when a language with status `supported` has a runner other
than `unknown` and at least one inventoried file. JavaScript with `runner: "unknown"` does not suppress it, and
neither does a detected-unsupported language.

Edge case: vitest configured but 0 JavaScript test files, plus a detected Python test. JavaScript is `supported` with
runner `vitest`, but it has 0 files, so the warning still appears.

## Reading an incomplete report

1. Treat counts, redundancy and coverage findings as describing the JavaScript and TypeScript tests only.
2. For each `wiring.inventory-incomplete` area, open the named languages' tests and check whether they exercise the
   area. Do not report it as untested, and do not report it as covered, until you have looked.
3. Say in the audit that the inventory is incomplete and which languages were counted but not read.
