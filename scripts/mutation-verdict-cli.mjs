#!/usr/bin/env node
// Checked-launcher companion. The imported core is read-only and framework-independent.
import { isAbsolute } from 'node:path';
import { classifyMutationEvidence, readMutationEvidence, validateMutationComposition } from './mutation-verdict.mjs';

const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== 'classify' || args[1] !== '--input' ||
    !args[2] || args[2].includes('\0') || Buffer.byteLength(args[2]) > 16384 || !isAbsolute(args[2])) {
  console.error(JSON.stringify({ error: { code: 'E_MUTATION_INPUT', message: 'Usage: mutation-verdict classify --input ABSOLUTE_BUNDLE_JSON (one separated value, no other arguments)' } }));
  process.exitCode = 2;
} else {
  try {
    const bundle = readMutationEvidence(args[2]);
    const result = bundle.schema === 'agent-tests/mutation-composition@1'
      ? validateMutationComposition(bundle) : classifyMutationEvidence(bundle);
    // A zero diagnostic exit never means killed, valid composition or candidate success.
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ error: { code: 'E_MUTATION_EVIDENCE', message: error.message } }));
    process.exitCode = 2;
  }
}
