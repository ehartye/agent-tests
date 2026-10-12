#!/usr/bin/env node
// The CLI loads lazily so a runtime that cannot start (old Node, missing node_modules, a broken source file) still ends in the
// one-line JSON error contract instead of a raw stack.
function broken(message, hint) {
  console.error(JSON.stringify({ error: { code: 'E_RUNTIME_BROKEN', message, hint } }));
  process.exitCode = 1;
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  broken(`agent-tests needs Node 24 or newer; this is Node ${process.versions.node}`, 'Install Node 24 or newer');
} else {
  let main;
  try {
    ({ main } = await import('../src/cli.ts'));
  } catch (error) {
    broken(String(error instanceof Error ? error.message : error).split('\n')[0], 'Run the tests-setup skill to repair the managed runtime');
  }
  if (main) await main(process.argv);
}
