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
