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
  unittest discover them. It is listed even when it holds no test or could not be parsed (flag `unparsed`, no tests, no
  subjects, no tags). A file over 2,000,000 bytes is not read at all and is listed the same way, as `unparsed`: parsing time
  grows with size, and such a file is data or generated code rather than a test a reviewer would audit.
- `conftest.py` is a support file: never a test and never a subject. Its presence still selects the pytest runner.
- A function decorated `@pytest.fixture`, `@fixture` or `@pytest_asyncio.fixture` (bare or called) is not a test, even when
  its name starts with `test`.
- A file named by a hosted-CI workflow is a candidate. The scan reads `.github/workflows/*.yml` and `*.yaml` at the
  project root and looks at the `run:` string of every job step. A candidate joins the inventory only if it parses
  cleanly and defines at least one test by the rules below (a unittest `TestCase` with `test*` methods, or pytest-style
  tests); a candidate that is missing, unreadable, has a syntax error, defines no test, sits in a skipped directory or is
  `conftest.py` is dropped without a trace. Candidates count in the Python `files` total only when they hold tests.
- Symbolic links and junctions are never followed here: a workflow file, the `.github` or `.github/workflows` directory,
  a candidate file, or a directory above a candidate that is a link reads as absent. The same holds for the Python config
  files read for the runner and the `python_files` note.
- The token rules for a `run:` string. The string is split into commands at newlines, `&&`, `||`, `;`, `|` and `&` (a
  trailing backslash joins lines).
  - Any token ending in `.py` is a file candidate, wherever it appears (after `python`, `pytest`, a wrapper, anything),
    when it is a project-relative path: absolute paths, `..`, globs, variables, options, whitespace and quote or shell
    characters make a token name nothing. A leading `./` and backslashes are normalized.
  - After `python -m unittest` or `python -m pytest` (also `python3`, `python3.12`, `py`, or a path to one of them; options
    between the binary and `-m` are tolerated), the dotted names that follow are module candidates. `unittest` also takes
    a bare name; `pytest` needs a dotted name. Reading stops at `discover` or the next python command, and the values of
    options such as `-k`, `-p`, `-t` and `--pattern` are skipped. A module `a.b` resolves to `a/b.py` under the project root
    only (not the package roots used for subjects).
  - Bounds: a token longer than 512 characters is skipped, and a `run:` string longer than 65,536 characters is ignored
    whole. A workflow can only add candidates; it never stops a scan.
  - Nothing is executed or resolved beyond the file system: directories such as `pytest tests/` name no files. A step's
    `working-directory:` is ignored, so paths and modules are always taken relative to the project root, and PowerShell
    backtick line continuation is not handled (only a trailing backslash joins lines).

### What counts as a test

Tests are declarations, as JavaScript counts `.each` once:

- a module-level `def test*` or `async def test*` (also inside a module-level `if`, `try` or `with` block);
- the `test*` methods of a class named `Test*` that has no `__init__` (as pytest collects it);
- the `test*` methods of a `unittest.TestCase` subclass: a base named `TestCase`, `unittest.TestCase`, or any base whose
  last name ends in `TestCase`. A `TestCase` subclass counts even if it has an `__init__` or is not named `Test*`.

A parametrized test counts once, however many cases it expands to. Nested classes (pytest collects a nested `Test*`
class; the scan does not), functions nested in tests, test functions or classes assigned dynamically and tests imported
from another module are not counted. The count is recognized declarations, not the cases the runner would expand.

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

The tag rules are the same as JavaScript's: only the first `@lane <word>` is looked at, and it is kept only when the word
is a lane (`edit`, `merge`, `scheduled` or `release`; a later valid `@lane` does not replace an invalid first one);
`@risk` takes the first word and is honored only when it is `critical`, `standard` or `low`; every `@subject` accumulates.
A file that fails to parse keeps its leading-comment tags, except an oversize file, which is not read.

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
  one, is `Test*`, `*Test` or `*TestCase`, because the runner collects an imported test class in the importing module,
  and only when `X` is a project module: an absolute module that resolves to a project file under the same package roots
  as a subject, or a relative import that resolves against the test file's directory (a bare `from . import Name` needs
  an `__init__.py` there). Stdlib and third-party sources do not count, so `from unittest import TestCase` and
  `from django.test import TestCase` are not opaque; test and support files are project modules. A `from` clause the scan
  cannot read from the source line is kept as opaque, since an unknown source is the incomplete side;
- a non-literal dynamic import: `import_module(name)` or `__import__(name)` with an argument that is not a plain string.

### Runner detection and `python_files`

The Python runner is chosen from files only, by the first rule that applies. Only cleanly parsed files count as evidence
(an unparsed file shows nothing):

1. pytest signals give `pytest`: a `pytest.ini`, a `[pytest]` or `[tool:pytest]` section in `tox.ini` or `setup.cfg`, or
   a `pyproject.toml` that mentions `pytest`, all at the project root; any `conftest.py`; or an inventoried file that
   imports `pytest`.
2. Otherwise any inventoried test that belongs to a `TestCase`-derived class gives `unittest`.
3. Otherwise any other inventoried test (a module-level function or a method of a plain `Test*` class, which only pytest
   collects) gives `pytest`, inferred from the test style.
4. Otherwise an inventoried file that imports `unittest` gives `unittest`. Importing `unittest` alone therefore no longer
   decides the runner when tests exist; it matters only for files with no test.
5. Otherwise `unknown` (only unparsed files, or files with no test and no such import).

Only the text of the config files is checked, and only for these facts; a config file that is a symbolic link is ignored.

If a pytest config file at the project root (`pytest.ini`, `tox.ini`, `setup.cfg` or `pyproject.toml`) contains the text
`python_files`, the scan adds the note `custom python_files configured; discovery used defaults`, because the setting
changes which files pytest collects and the scan used the defaults. No other pytest or unittest setting is read, and a
config file below the project root is not looked at, so a `python_files` set there is not seen.

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

Some tests are missed without any note, and the count undercounts silently:

- a nested `Test*` class, which pytest collects, is not counted;
- a `test_*` function imported into a module, which pytest collects there, is not counted and raises no note (only an
  imported test class from a project module does, see Opaque registration);
- a workflow step's `working-directory:` is ignored, so a command run from a subdirectory (`python -m unittest tests.x`
  from `backend/`) may be missed, because its names are taken relative to the project root;
- PowerShell backtick line continuation in a `run:` string is not handled;
- `python_files` in a pytest config below the project root is not seen (the project root only is read);
- importing `unittest` does not by itself decide the runner (see Runner detection).

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
  test-named files (including any flagged `unparsed`, oversize ones too) plus workflow-named files that proved to hold tests. Every other
  language has `runner: "unknown"`, its counted file total, and status `detected-unsupported`.
- `complete` is `false` when a language is `detected-unsupported` (part of the suite was not read), or when any Python note
  exists (a note below); it is `true` for a repo whose only other language is Python with no note.
- `notes` is still a list of strings: the unsupported-language note first when it applies, then the Python notes in the
  order config, facade, opaque, unparsed. The Python note texts are `custom python_files configured; discovery used defaults`,
  `imports through a package __init__ may reach other modules`,
  `some Python tests are registered in ways the scan cannot read (load_tests, an imported test class or a non-literal import)`
  and `Python test files could not be parsed: <files>`.
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
  - The unparsed-files note appears when any name-matched Python test file could not be parsed (a syntax error, a construct
    the grammar rejects, an unreadable file, or a file over 2,000,000 bytes). It lists the sorted paths, up to five, then
    `and K more` (non-ASCII characters in a path show as `?`), for example
    `Python test files could not be parsed: tests/test_broken.py`. Its scope is always `"all"`, because an unparsed file
    gives no subjects, so there is no telling which area its tests cover. It makes `complete` false. A workflow-named
    candidate that fails to parse is dropped without a note.
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
repository, with or without an `inventory`; the JSON is unchanged by it. Python test files, unparsed ones included, count
as test files, so a repository that has Python test files does not get this line. A Python-only repo therefore shows the
`Languages` line, and an `Inventory incomplete` line only when a Python note exists; it still shows
`JavaScript (unknown, 0 files)` in the `Languages` line.

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
   `0 inventoried test files import this area; Python notes: <texts>`. One unparsed Python test file adds a note scoped
   `"all"`, so every uncovered critical area that holds Python files then reads as coverage unknown until that file is read.

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
detected-unsupported language does not, and neither does Python with runner `unknown`. A Python-only repo whose test
files parse does not get the warning: a plain `assert` test or a module-level test function infers `pytest`, and a
`TestCase` test infers `unittest`. A repo whose only Python test file is unparsed has Python runner `unknown` and keeps
the warning.

Edge case: vitest configured but 0 JavaScript test files, plus a detected Go test. JavaScript is `supported` with
runner `vitest`, but it has 0 files, so the warning still appears.

## Implementation constraints

For a maintainer of the scan:

- The parser is an exact-pinned dependency pair in `package.json`: `web-tree-sitter` (currently 0.27.2) and
  `tree-sitter-python` (currently 0.25.0). They are chosen as a pair: the grammar WASM's language ABI must be one the
  runtime loads. Change them together, never one alone, and keep them exact. The launcher's dependency probe parses a valid and an invalid Python
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
  leading-comment tags (an oversize file, over 2,000,000 bytes, is not read and has none). A workflow-named candidate with
  a syntax error is dropped instead. A syntax error is just an `unparsed` file; it is not a runtime failure.
- If the parser itself cannot load (a missing package or WASM file), `scanProject()` throws an error with code
  `E_RUNTIME_BROKEN` and a hint to run the tests-setup skill to repair the managed runtime, so the CLI reports a broken
  runtime instead of treating every Python file as unparsed.
- Reading Python never follows symbolic links (workflow files, candidates, config files), as discovery never does, and the
  workflow bounds (512-character tokens, 65,536-character `run:` strings) keep a hostile workflow from stalling a scan.

## Reading an incomplete report

1. Treat counts, redundancy and coverage findings as describing the JavaScript, TypeScript and Python tests the scan read.
2. For each `wiring.inventory-incomplete` area, open the tests the message points to (the named unsupported languages, or
   the Python files behind the note) and check whether they exercise the area. Do not report it as untested, and do not
   report it as covered, until you have looked.
3. Say in the audit that the inventory is incomplete, which languages were counted but not read, and which Python notes
   applied.
4. For Python, remember the unknowns above: a `+?` file may hold more tests than counted, nested classes and imported
   test functions are not counted, and lanes set only by custom markers are not visible.
