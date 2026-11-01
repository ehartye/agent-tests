# worktree-check

An opt-in command that runs a project's test command to see whether two checkouts of the same commit can run it at the same
time. Use it to confirm or dismiss a static `worktree.*` finding (a fixed port, a fixed temp or database path, a shared
cache directory) with an observation. It runs the project's tests, unlike `scan` and `report`, which stay static and never
call it. Run it only when the owner has agreed to a test run, and read the cost and limits below first.

## Command

    node "<plugin-root>/scripts/run-managed.js" worktree-check --root "<project>" [--runs <n>] [--command "<cmd>"] [--timeout-seconds <n>] [--no-install]

| Option | Meaning |
|---|---|
| `--root <dir>` | The project, inside a git repository with at least one commit. |
| `--runs <n>` | How many concurrent rounds to run. Default 3, allowed 1 to 10; anything else is `E_USAGE`. |
| `--command "<cmd>"` | The command to run. Without it the check runs `npm test` and needs a `scripts.test` entry in `package.json`. |
| `--timeout-seconds <n>` | Limit for each single command run, including the install. Default 600. |
| `--no-install` | Skip the install in the second checkout (the project has no dependencies, or they are resolved another way). |

These options belong to `worktree-check` only; `scan` and `report` refuse them with `E_USAGE`.

## What it does

1. Runs the command once alone in the root (the baseline).
2. If the baseline passed, creates a second git worktree of HEAD on a throwaway branch in a temporary directory outside the
   root.
3. Installs in the second checkout: `npm ci` when a lockfile exists, otherwise `npm install`, unless `--no-install`.
4. Runs the command in both checkouts at the same time, `--runs` times in a row.
5. Always removes the worktree and the branch, also after a failure, a timeout or an interrupt.

Cost: a full check is about six commands (the baseline, the worktree creation, the install, the concurrent rounds, and the
worktree and branch removal). The install dominates the wall time on a project with many dependencies; the rest is roughly
the baseline duration times (runs + 1). Each round loads the machine with two copies of the suite at once.

## Verdicts

| Verdict | Meaning |
|---|---|
| `hazard-observed` | The baseline passed and at least one concurrent run failed, in either checkout. The suite shares state between checkouts, or is too heavy to run twice at once; read `failureLines` to tell which. |
| `no-hazard-observed` | The baseline and every concurrent run passed. This is evidence for the runs made, not proof: a rare collision can still pass `--runs` rounds. |
| `baseline-failed` | The command failed alone, so concurrency cannot be judged. No worktree is created. Fix the baseline, or pass a `--command` that works. |

## Report

The default output is JSON, like `scan`, with `schema` `agent-tests/worktree-check@1`.

| Field | Contents |
|---|---|
| `verdict` | One of the three verdicts. |
| `command` | The command that ran (`npm test` by default). |
| `runs`, `timeoutSeconds` | The values used. |
| `rootDirty` | Whether the root's working tree had uncommitted changes (see limits). |
| `baseline` | The alone run: `exitCode`, `passed`, `durationMs`, and `failureLines` when it failed. |
| `install` | `performed`, and when it ran, `command`, `exitCode`, `durationMs`. |
| `results` | One entry per round: `run`, then `root` and `worktree`, each with `exitCode`, `passed`, `durationMs` and, for a failed run, up to 20 `failureLines`. |
| `cleanup` | `ok`, `worktreeCreated`, `worktreeRemoved`, `branchDeleted`, `errors`, and `failedSteps` (each step that failed, with its message). `ok: false` means something was left behind: report it to the owner. |

`failureLines` are the output lines matching `FAIL`, `Error` or the cross mark, at most 20 per failed run.

## Errors

A failure is one JSON line on stderr, like every other command. `E_USAGE` exits 2; the rest exit 1.

| Code | Cause and remedy |
|---|---|
| `E_NO_TEST_COMMAND` | No `--command` and no `scripts.test` in `package.json`. The message names `--command`; pass it. |
| `E_NOT_GIT` | The root is not inside a git work tree, or the repository has no commit. Commit first. |
| `E_TIMEOUT` | A command (baseline, install or a concurrent run) did not finish in `--timeout-seconds` and was killed. A timeout in a concurrent run is this error, not a hazard verdict. Raise the limit or pass a faster `--command`. |
| `E_NPM_NOT_FOUND` | The npm CLI could not be located for `npm` or `npx`. Install Node.js with npm, or use `--command "node <script>"`. |
| `E_WORKTREE_FAILED` | `git worktree add` failed, or the root's subdirectory does not exist at HEAD. |
| `E_INSTALL_FAILED` | `npm ci` or `npm install` failed in the second checkout. Fix the install, or pass `--no-install` if nothing needs installing. |
| `E_INTERRUPTED` | The check was interrupted (Ctrl+C or a termination signal). The worktree and branch are still removed. |

When cleanup also fails, the error message says so; run `git worktree list` and `git branch` in the root to look for
leftovers.

## Example

A committed project whose test writes a token to one fixed file, waits, and reads it back. Two runs at once clobber each
other:

    mkdir demo && cd demo && git init -q
    # package.json: { "name": "demo", "private": true, "scripts": { "test": "node test.js" } }
    # test.js:
    #   const fs = require('node:fs');
    #   const path = require('node:path').join(require('node:os').tmpdir(), 'shared-token');
    #   const token = String(process.pid) + '-' + Math.random();
    #   fs.writeFileSync(path, token);
    #   setTimeout(() => {
    #     if (fs.readFileSync(path, 'utf8') !== token) {
    #       console.error('FAIL shared file was overwritten by another run');
    #       process.exit(1);
    #     }
    #   }, 150);
    git add . && git commit -qm demo
    node "<plugin-root>/scripts/run-managed.js" worktree-check --root . --no-install --runs 1

Real output (one round; formatted, durations vary, the failing side varies between runs):

    {
      "schema": "agent-tests/worktree-check@1",
      "command": "npm test",
      "runs": 1,
      "timeoutSeconds": 600,
      "rootDirty": false,
      "baseline": { "exitCode": 0, "passed": true, "durationMs": 647 },
      "verdict": "hazard-observed",
      "install": { "performed": false },
      "results": [
        {
          "run": 1,
          "root": { "exitCode": 1, "passed": false, "durationMs": 564,
                    "failureLines": ["FAIL shared file was overwritten by another run"] },
          "worktree": { "exitCode": 0, "passed": true, "durationMs": 553 }
        }
      ],
      "cleanup": { "ok": true, "worktreeCreated": true, "worktreeRemoved": true,
                   "branchDeleted": true, "errors": [], "failedSteps": [] }
    }

The remedy is the one the static rule gives: a per-process or `mkdtemp` path (see `scan-rules.md`). Rerun to confirm
`no-hazard-observed`.

## Limits

- It runs the committed state (HEAD), not uncommitted changes. A dirty root can behave differently from HEAD; the report's
  `rootDirty` says whether it was dirty. Commit or stash first for a clean comparison.
- The project's tests must be runnable from a fresh install of HEAD. If they need an untracked file, a built artifact,
  a secret or a local service, the second checkout fails for that reason and the verdict is `hazard-observed` without
  being a sharing hazard. Read `failureLines` before reporting.
- `--command` is tokenized and runs without a shell. It refuses unquoted `|`, `&`, `;`, `<`, `>`, backticks and `$(` with
  `E_USAGE`; put a pipeline in a script and pass `node script.js` or `npm run <name>`.
- A Windows `.cmd` shim such as `pnpm` cannot be started without a shell. Use `npm`, `npx` or `node`; otherwise the
  command does not start and the report shows `baseline-failed`.
- Output is captured up to 4 MB per run, so failure lines near the end of a very large log are lost.
- A timeout in a concurrent run is `E_TIMEOUT`, not a hazard verdict: a heavy suite that is merely slow when run twice is
  not shown as a sharing hazard.
- It observes one machine and a few rounds. `no-hazard-observed` lowers the doubt about a static finding; it does not
  clear it.
- `scan` and `report` stay static and never run it.
