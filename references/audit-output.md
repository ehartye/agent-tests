# Saved audit artifacts

A `wiring.invalid-subject` finding names the test file and up to five rejected `@subject` paths in declaration order. Each entry gives the reason and the finding counts additional entries. Check misspellings against the project root. Valid declared and inferred subjects still determine coverage and tier.

After normal tests-setup readiness, use the checked launcher from the currently selected plugin:

```sh
node "<plugin-root>/scripts/run-managed.js" report --root "<project>" --out "docs/evidence/audit.md"
node "<plugin-root>/scripts/run-managed.js" scan --root "<project>" --out "docs/evidence/scan.json"
```

`--out` is opt-in and valid only for `scan` and `report`. Relative destinations resolve against
`--root`; absolute destinations are also explicit choices. Create the destination's parent directory
first. An existing file, directory or dangling symlink is refused with `E_EXISTS`, without replacement.
Directory aliases are resolved to the explicitly selected parent. Choose a new filename for each
retained audit; there is no overwrite flag. Prefer `.md` for report and `.json` for scan, outside test
discovery/configuration paths. The saved file is the only requested project mutation.

Without `--out`, the existing Markdown/JSON stdout contract is unchanged. With `--out`, stdout is one
JSON receipt containing the canonical `written` path, UTF-8 byte count and SHA-256 of the exact saved
bytes. Save or cite that receipt alongside the artifact when byte integrity matters. A successful
publication can also return `cleanupWarnings` and the owned `staging` directory; this means the
artifact exists and its receipt is valid, not that publication failed.

Saved scan JSON retains `agent-tests/evidence@1` and adds an `artifact` annotation with schema
`agent-tests/audit-output@1`. Saved Markdown contains the same annotation under **Artifact identity**.
It records the producer name/version, normalized runtime-source fingerprint, Node version, command,
audited root, effective report caps, and limits. The existing managed-runtime fingerprint covers its
declared package/lock/scripts/src/skills/references inputs. It does not depend on the absolute plugin
cache location and normalizes text line endings. It is producer identity, not an attestation of
installed dependencies or a content snapshot of the audited project. Capture a separate reviewed
commit/input inventory when a reproducible project snapshot is required.

There is no timestamp or output filename in the artifact. Equivalent evidence and identity at the
same root serialize identically; changing the root spelling, Node version, source, options or
evidence can change its hash. A saved scan or report warns that zero
recognized static tests does not prove absence of tests when no supported runner was detected: without an `inventory` when the
runner is `unknown`; with an `inventory`, unless a language with status `supported` has a runner other than `unknown` and at least
one inventoried file (JavaScript with runner `unknown` does not suppress it). See [inventory.md](inventory.md). Both formats say that project tests were
not executed. New runner adapters and inferred unsupported-runner declarations are outside this change.

The complete scan/report is generated before publication. The writer stages and flushes bytes in a
unique directory beside the target, then creates a same-volume hard link without replacing any name.
Concurrent destination creation refuses safely. Partial staged writes never become the artifact;
filesystems without hard-link support refuse with `E_OUTPUT` and have no copy fallback. Failures clean
only the attempt's own stage; an interruption or cleanup error can leave that directory for inspection.
This is single-file publication, not transactional capture of concurrently edited project inputs.

No global `tests` wrapper is installed, and no existing global link is changed. Resolve `<plugin-root>`
from the host's selected plugin, check its managed runtime normally, and cite the saved artifact's
producer identity rather than a versioned cache path. A separate versionless launcher remains a
possible usability follow-up; it is not required to cite or validate these saved outputs.

## Import saved suite timings

For a duration investigation, start with an existing Vitest or Jest JSON report. Supply one file, relative to the project root or absolute.

```sh
node "<plugin-root>/scripts/run-managed.js" report --root "<project>" --timings run.json --max-files 10 --out audit.md
```

To collect a report, run the appropriate command in the project with its installed runner and normal test selection.

```sh
vitest run --reporter=json --outputFile=run.json
jest --json --outputFile=run.json
```

For example, a file running from 1,000 to 1,900 ms occupies 900 ms of a 1,000 ms matched window (90.0%) if the other matched file runs from 1,800 to 2,000 ms. Inspect that file’s cases and setup to see where its elapsed time went. Measure the runner process from launch through exit to establish end-to-end time. Overlapping files can each occupy the full window.

Each measured interval spans one suite's start and end timestamps. The table sorts matched files by elapsed milliseconds and then path. Unmeasured files follow in static order. Overlap prevents summing durations into wall time or cost. Paths can match across revisions with different contents. The Markdown identifies the original JSON by SHA-256 and counts excluded rows and ambiguous files. An unreadable or unsupported report returns `E_TIMINGS` before publication.
