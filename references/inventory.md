# Test inventory: what the scan can and cannot see

The scan reads the tests of two language families: JavaScript and TypeScript (`*.test.*` and `*.spec.*` files with a
`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts` or `.cts` extension, and code files under `__tests__/`) and Python
(pytest and unittest files, read statically; see [The Python adapter](#the-python-adapter)). Everything it reports about
tests, coverage of risk areas and redundancy is about those files. Tests in other languages (Go, Ruby, PowerShell, Java,
Kotlin, C# and PHP) are counted by file name only and never parsed. This page says what the scan reads, how it tells you
that tests it cannot read may exist, and how to read the result. Per-rule detail is in [scan-rules.md](scan-rules.md);
saved artifacts are in [audit-output.md](audit-output.md).

## The language census

Besides discovering JavaScript and TypeScript tests, the scan runs a census: it counts files whose name follows the
conventional test-file naming of another language. For every language except Python the census never opens those files.
It counts names only, so a file named like a test is counted even if it holds none, and the report says "named like
tests". Python files found by the census are then read by the Python adapter below.

| Language   | Counted when the file name is                                              | Read by the scan |
| ---------- | -------------------------------------------------------------------------- | ---------------- |
| Python     | `test_*.py` or `*_test.py`                                                 | yes              |
| Go         | `*_test.go`                                                                | no               |
| Ruby       | `test_*.rb` or `*_spec.rb`                                                 | no               |
| PowerShell | `*.Tests.ps1`                                                              | no               |
| Java       | ending `Test.java` or `Tests.java`                                         | no               |
| Kotlin     | ending `Test.kt` or `Tests.kt`                                             | no               |
| C#         | ending `Test.cs` or `Tests.cs`                                             | no               |
| PHP        | ending `Test.php` or `Tests.php`                                           | no               |

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

## The Python adapter

Python is `supported`: the scan parses each Python test file with a WASM tree-sitter parser and reads its tests,
assertions, imports, tags and markers from the syntax tree. Nothing executes Python. `pytest --collect-only` is
deliberately not used, because collection imports and runs project code, and `scan` and `report` never run tests or
project code. The cost of reading syntax alone is that anything decided at run time stays unknown (see
[What stays unknown](#what-stays-unknown-even-for-supported-python)).

### Which Python files are test files

- A file named `test_*.py` or `*_test.py` at any depth (outside the skipped directories above) is a test file, as pytest and
  unittest discover them. It is listed even when it holds no test or fails to parse.
- `conftest.py` is a support file: never a test and never a subject. Its presence still selects the pytest runner.
- A file named by a hosted-CI workflow is a candidate. The scan reads `.github/workflows/*.yml` and `*.yaml` at the
  project root and looks at the `run:` string of every job step. A candidate joins the inventory only if it parses
  cleanly and defines at least one test by the rules below (a unittest `TestCase` with `test*` methods, or pytest-style
  tests); a candidate that is missing, unreadable, has a syntax error, defines no test, sits in a skipped directory or is
  `conftest.py` is dropped without a trace. Candidates count in the Python `files` total only when they hold tests.
- The token rules for a `run:` string. The string is split into commands at newlines, `&&`, `||`, `;`, `|` and `&` (a
  trailing backslash joins lines).
  - Any token ending in `.py` is a file candidate, wherever it appears (after `python`, `pytest`, a wrapper, anything),
    when it is a project-relative path: absolute paths, `..`, globs, variables, options, whitespace and quote or shell
    characters make a token name nothing. A leading `./` and backslashes are normalized.
  - After `python -m unittest` or `python -m pytest` (also `python3`, `python3.12`, `py`, or a path to one of them), the
    dotted names that follow are module candidates. `unittest` also takes a bare name; `pytest` needs a dotted name.
    Reading stops at `discover` or the next python command, and the values of options such as `-k`, `-p`, `-t` and
    `--pattern` are skipped. A module `a.b` resolves to `a/b.py` under the project root only (not the package roots
    used for subjects).
  - Nothing is executed or resolved beyond the file system: directories such as `pytest tests/` name no files.

### What counts as a test

Tests are declarations, as JavaScript counts `.each` once:

- a module-level `def test*` or `async def test*` (also inside a module-level `if`, `try` or `with` block);
- the `test*` methods of a class named `Test*` that has no `__init__` (as pytest collects it);
- the `test*` methods of a `unittest.TestCase` subclass: a base named `TestCase`, `unittest.TestCase`, or any base whose
  last name ends in `TestCase`. A `TestCase` subclass counts even if it has an `__init__` or is not named `Test*`.

A parametrized test counts once, however many cases it expands to. Nested classes, functions nested in tests, test
functions or classes assigned dynamically and tests imported from another module are not counted. The count is recognized
declarations, not the cases the runner would expand.

Assertions per test are counted from the body, nested defs and lambdas included: `assert` statements; `self.assert*` and
`self.fail` calls (so `self.assertRaises*` counts); and `pytest.raises`, `pytest.warns` and `pytest.fail` (a `with` block
or a call counts once). They are matched by their spelling, with the receiver exactly `self` or `pytest`, so a name
imported on its own (`from pytest import raises`) is not recognized. Helper assertions in other functions or files are not followed. A test
with none is named in `noAssertionTests` and the file gets the `no-direct-assertions` flag. Skip and xfail marks are not
read, so a skipped test with no assertion is still named.

### Subjects

A subject is a project file the test imports directly. The scan reads imports and resolves them against file names; it
never imports anything:

- `import a.b`, `from a.b import c`, and `from a import b` where `b` is a submodule (`a/b.py` or `a/b/__init__.py`).
- Relative imports: `from .m import x` and `from . import m` (one dot is the test file's directory, each further dot goes
  up one directory).
- A string-literal `importlib.import_module("a.b")` or `__import__("a.b")` (a bare `import_module(...)` also counts).
  A name that is not a plain dotted module (a relative name, say) names no file.
- A dotted module resolves to `a/b.py` or `a/b/__init__.py` under each candidate package root, in this order, and the first
  root that resolves it wins: the project root, then `src/`, then every ancestor directory of the test file (its own
  directory first, up to but excluding the project root), each followed by that directory's `src/`. So
  `backend/tests/test_svc.py` importing `app.svc` tries `app/svc.py`, `src/app/svc.py`, `backend/tests/app/svc.py`,
  `backend/tests/src/app/svc.py`, `backend/app/svc.py`, `backend/src/app/svc.py` and finds `backend/app/svc.py`.
- Facade imports: an import that reaches a package only through its `__init__.py` (`import pkg`, or `from pkg import name`
  where `name` is not a submodule) records `pkg/__init__.py` as the subject and adds the facade note, because the package
  may re-export names from modules the scan cannot see. `from pkg import m, name` is a facade for `name` even though `m`
  resolves.
- A leading `# @subject <path>` tag adds a subject: a path from the project root to an existing regular file.
- Stdlib and third-party imports resolve to no file and are ignored (a project file with the same name as a third-party
  package would match). Test files, `conftest.py` and files under test support directories (`tests/`, `test/`,
  `__tests__/`, `__mocks__/`, `fixtures/`, `helpers/`, `testing/`, `test-utils/`) are dropped as subjects.
- A non-literal `import_module(name)` or `__import__(name)` names no subject; it is an opaque registration (below).

The tier of a Python test comes from its subjects as for JavaScript: the highest tier among them, the file's own path only
when it has none, and a valid `@risk` tag overrides it.

### Tags and lanes

`@lane`, `@risk` and `@subject` are read only from the leading `#` comment lines: comment lines (blank lines allowed)
before the first statement. A module docstring or any statement ends the leading block, so tags after a docstring are not
read; put the tags first and the docstring after:

```python
# @lane merge
# @risk critical
# @subject src/pkg/core.py
"""Tests for the core."""
```

The value rules match JavaScript: `@lane` takes the first valid lane (`edit`, `merge`, `scheduled`, `release`), `@risk`
takes the first word and is honored only when it is `critical`, `standard` or `low`, and `@subject` may repeat. A file that
fails to parse keeps its leading-comment tags.

A lane is also read from pytest markers named exactly `edit`, `merge`, `scheduled` or `release`: `@pytest.mark.<lane>` on a
test or its class, a class-level `pytestmark`, or a module-level `pytestmark = pytest.mark.<lane>` (a list or tuple
works). Only the spelling `pytest.mark.<name>` is read, not `mark.<name>` through a from-import. Precedence for the file's
lane:

1. a `# @lane` tag in the leading comment;
2. a module-level `pytestmark` that names exactly one lane (two different lane markers there are ambiguous and give no lane;
   the lookup does not fall through to the tests);
3. the one lane that every test in the file carries (a test's markers include its class's), when they all agree;
4. otherwise no lane.

Custom markers such as `slow`, `db` or `real_data` are NOT mapped to lanes. A repo that uses only custom markers gets no
lane on its Python files; lane output for it is none until the files carry a `# @lane` comment or a lane-named marker.
Mapping custom markers (for example from a map in the risk file) is not built.

### Opaque registration

Some constructs register tests in ways the reader cannot see. Each is reported as `wiring.opaque-test-registration` on
the file and line, shown with the `+?` marker in the report (the same finding and marker JavaScript helpers use). The
recognized declarations are still counted, and the count may undercount the file:

- the module defines `load_tests` (unittest calls it to change the set; pytest ignores it);
- a module-level `from X import Name` (also inside a module-level `if` or `try`) whose bound name, the alias when there is
  one, is `Test*`, `*Test` or `*TestCase`, because the runner collects an imported test class in the importing module.
  The module `X` is not checked, so `from unittest import TestCase` counts too;
- a non-literal dynamic import: `import_module(name)` or `__import__(name)` with an argument that is not a plain string.

### Runner detection and `python_files`

The Python runner is chosen from files only. It is `pytest` when the project root has `pytest.ini`, a `[pytest]` or
`[tool:pytest]` section in `tox.ini` or `setup.cfg`, or a `pyproject.toml` that mentions `pytest`; or when any
`conftest.py` exists; or when an inventoried file imports `pytest`. Otherwise it is `unittest` when an inventoried file
imports `unittest`, else `unknown`. Only the text of the config files is checked, and only for these facts.

If a pytest config file at the project root (`pytest.ini`, `tox.ini`, `setup.cfg` or `pyproject.toml`) contains the text
`python_files`, the scan adds the note `custom python_files configured; discovery used defaults`, because the setting
changes which files pytest collects and the scan used the defaults. No other pytest or unittest setting is read.

### What stays unknown, even for supported Python

A static reader cannot see what is decided at collection time or in configuration. These stay unknown:

- marks registered by plugins or hooks, and `pytest_generate_tests` or `pytest_collection_modifyitems` (they change which
  tests exist and which marks they carry);
- non-literal parametrization, and the number of cases a parametrized test expands to;
- the tests that a `load_tests` function returns;
- `collect_ignore`, `collect_ignore_glob` and every other value computed in a `conftest.py`;
- every pytest or unittest setting other than the `python_files` note: `testpaths`, `python_classes`, `python_functions`,
  `addopts`, `norecursedirs`, marker expressions passed with `-m`, and a unittest start directory or pattern;
- whether a test is skipped, xfailed or deselected.

Python files are not fed to the JavaScript line-based detectors, so a Python file gets no shim findings, no worktree
hazard findings and no redundancy clusters, and none of the `tautological`, `snapshot-only` or `mock-only` flags. A Python
record also has no `skips` field. A test file in the repo that the scan did not read is absent from every count.

## The `inventory` object

The scan JSON (`agent-tests/evidence@1`) gains an optional top-level `inventory` key:

```json
{
  "complete": false,
  "languages": [
    { "language": "JavaScript", "runner": "vitest", "files": 10, "status": "supported" },
    { "language": "Python", "runner": "pytest", "files": 111, "status": "supported" },
    { "language": "Go", "runner": "unknown", "files": 4, "status": "detected-unsupported" }
  ],
  "notes": [
    "Those files are named like tests and were counted by file name only, never read, so their test counts and the coverage they give are unknown.",
    "imports through a package __init__ may reach other modules"
  ],
  "noteScopes": [
    { "text": "imports through a package __init__ may reach other modules", "scope": ["src/pkg"] }
  ]
}
```

- Present only when the scan reads at least one Python test file or the census finds a test-named file in a language
  other than JavaScript. A repository with neither has no `inventory` key, and its JSON is the same as before the census
  existed.
- `languages` lists JavaScript first, with the primary runner the scan detected (`unknown` when none) and the number of
  inventoried JavaScript and TypeScript test files, status `supported`. Each other language follows, sorted by name.
  Python is `supported` with its own runner (`pytest`, `unittest` or `unknown`) and `files`, the Python test files read:
  test-named files (including any flagged `unparsed`) plus workflow-named files that proved to hold tests. Every other
  language has `runner: "unknown"`, its counted file total, and status `detected-unsupported`.
- `complete` is `false` when a language is `detected-unsupported` (part of the suite was not read), or when any Python note
  exists (a note below); it is `true` for a repo whose only other language is Python with no note.
- `notes` is still a list of strings: the unsupported-language note first when it applies, then the Python notes in the
  order config, facade, opaque. The Python note texts are the three strings above and
  `some Python tests are registered in ways the scan cannot read (load_tests, an imported test class or a non-literal import)`.
- `noteScopes` is new and optional: present only when a Python note exists, one `{ text, scope }` entry per Python note, with
  `scope` either `"all"` or a list of directories relative to the project root (forward slashes, no trailing slash). A
  consumer that reads only `notes` is unaffected. The unsupported-language note has no scope entry.
  - The `python_files` note is scoped `"all"`.
  - The facade note is scoped to the package directories of the `__init__.py` files that tests import through (`"all"` for
    one in the project root).
  - The opaque-registration note is scoped to the package directories of the subjects of each opaque file; when a file has
    none, to its nearest ancestor directory that holds an `__init__.py` or is named `src` (never the project root), else
    the test file's own directory (`"all"` for a file in the project root). The scopes of one note merge: `"all"` wins,
    otherwise the sorted union.
- `runner` keeps its meaning: the top-level `runner` is still the primary JavaScript runner, `unknown` when none is
  detected. It does not describe Python, so a Python-only repo keeps `runner: "unknown"` there and its Python runner
  under `inventory`.
- A Python test file record carries `language: "python"` (optional, absent on JavaScript and TypeScript records). Its
  `flags` are only `no-direct-assertions` or `unparsed`. A repo with Python files lists every file sorted by path.

## What the report says

When `inventory` exists, the `report` header gains up to two lines:

- `- Languages: JavaScript (vitest, 10 files), Python (pytest, 111 files), Go (detected-unsupported, 4 files)`. A
  supported language shows its runner; a detected-unsupported one shows its status.
- `- Inventory incomplete: Go detected but not inventoried. <notes>`. Only when `complete` is false. It names the
  unsupported languages, if any, and repeats the notes (Python notes included).

Separately, whenever `runner` is `unknown` and the scan found 0 test files, the header adds
`- No supported runner detected; a zero test count does not prove the project has no tests.` This holds for every such
repository, with or without an `inventory`; the JSON is unchanged by it. Python test files count as test files, so a
repository that has Python tests does not get this line.

## A missing `inventory` key does not mean the inventory is complete

The census sees conventional file names only. A repository whose tests are named unconventionally, or whose tests are
inline, gets no `inventory` key, and a zero or low test count there still proves nothing. Treat the key as a positive
signal (tests in another language were found, or Python was read) and never as a clean bill of health. When the runner
is `unknown` and the count is 0, read the zero-count line above and look for tests by hand before concluding the project
has none.

## `wiring.inventory-incomplete`

A critical risk-map area normally gets `wiring.uncovered-critical` when no inventoried test imports it or tags it as a
subject (a test inside the area counts too). Two rules turn that into `wiring.inventory-incomplete`, meaning coverage is
unknown, not absent. "Classifiable files" are the files the drift check already classifies: not tests (JavaScript,
TypeScript or Python), not test support files (`conftest.py` included), not under ignored or dot directories.

1. Unsupported languages. At least one language is `detected-unsupported`, and the area holds a classifiable file that is
   neither JavaScript or TypeScript (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`) nor Python (`.py`,
   `.pyi`). Python is an inventoried language, so a Python-only area is not softened by an unrelated language such as Go.
   An area with no classifiable files stays `wiring.uncovered-critical`. The message names the unsupported languages and
   the evidence reads `0 inventoried test files import this area; unsupported: <languages>`.
2. Python notes. The area holds classifiable `.py` or `.pyi` files and lies within the scope of at least one Python note
   (see `noteScopes`). A note scoped `"all"` covers every area. A note scoped to directories covers an area when the
   area's glob can reach a path at or under one of them: the leading path segments match the directory's segments, where
   `**` matches any number of segments and `*` and `?` stay inside one. So `src/pkg/io.py`, `src/pkg/**` and
   `src/pkg/sub/*.py` are inside `src/pkg`, and so is `src/**` (it can reach it); `src/*.py` is not (it cannot reach
   below `src`), and `src/package/io.py` is not (a shared name prefix is not containment). A Python area outside every
   note's scope stays `wiring.uncovered-critical`, so one odd file cannot mute every area. The message says some Python
   tests may not be fully inventoried and quotes the note texts; the evidence reads
   `0 inventoried test files import this area; Python notes: <texts>`.

Rule 1 is checked first. In the report these findings follow the `wiring.uncovered-critical` ones.

Trade-off of rule 1: it needs no map from source files to languages, so it also covers an area written in one language
and tested in another (for example C++ source with PowerShell tests). The cost is that in a mixed repository an area
holding a file that is not JavaScript, TypeScript or Python, and having no covering test, reads "coverage unknown" even if
it is genuinely untested. The message names the unsupported languages so the reader can judge: open those tests, and decide
whether they exercise the area.

An area made only of JavaScript, TypeScript or Python files with no covering test stays `wiring.uncovered-critical`
unless rule 2 applies. With no unsupported language and no Python note, nothing changes.

## Saved artifacts

A saved scan or report (`--out`) carries a limit saying that no supported runner was detected and that a zero static
test count does not prove the project has no tests. Without an `inventory`, that warning appears when `runner` is
`unknown`. With an `inventory`, it is suppressed only when a language with status `supported` has a runner other
than `unknown` and at least one inventoried file. JavaScript with `runner: "unknown"` does not suppress it, a
detected-unsupported language does not, and neither does Python with runner `unknown`. A Python-only repo with a
detected `pytest` or `unittest` runner and one read file does not get the warning.

Edge case: vitest configured but 0 JavaScript test files, plus a detected Go test. JavaScript is `supported` with
runner `vitest`, but it has 0 files, so the warning still appears.

## Implementation constraints

For a maintainer of the scan:

- The parser is an exact-pinned dependency pair in `package.json`: `web-tree-sitter` (currently 0.27.2) and
  `tree-sitter-python` (currently 0.25.0). They are chosen as a pair: the grammar WASM's language ABI must be one the
  runtime loads. Change them together, never one alone, and keep them exact (the owner's rule is to use current releases
  rather than pin an older line to avoid friction). The launcher's dependency probe parses a valid and an invalid Python
  snippet and reads the error indicator, so a mismatched pair fails `setup.js --check`.
- The grammar WASM ships in the `tree-sitter-python` npm package (`tree-sitter-python.wasm`), is resolved from
  `node_modules` and loaded in-process once per scan. No download, no registry call beyond `npm ci`, and no Python on the
  machine are needed.
- `tree-sitter-python` declares an install script (`node-gyp-build`) that current npm versions do not run, and nothing
  needs it: only the `.wasm` file is used, never a native binding.
- The parser loads only when the census finds Python test-named files or a workflow names a Python file. A JavaScript-only
  scan never loads it, and its output is unchanged.
- Programmatic use: `scan()` is synchronous and cannot load the WASM, so it throws when Python test files exist and no
  reader was passed in `options.python`. `scanProject()` is the async entry that loads the parser (only then) and is what
  the CLI uses; use it unless you can supply a reader.
- A syntax error never aborts a scan: the file is listed with `flags: ["unparsed"]`, no facts (tests 0) and its
  leading-comment tags. A workflow-named candidate with a syntax error is dropped instead.

## Reading an incomplete report

1. Treat counts, redundancy and coverage findings as describing the JavaScript, TypeScript and Python tests the scan read.
2. For each `wiring.inventory-incomplete` area, open the tests the message points to (the named unsupported languages, or
   the Python files behind the note) and check whether they exercise the area. Do not report it as untested, and do not
   report it as covered, until you have looked.
3. Say in the audit that the inventory is incomplete, which languages were counted but not read, and which Python notes
   applied.
4. For Python, remember the unknowns above: a `+?` file may hold more tests than counted, and lanes set only by custom
   markers are not visible.
