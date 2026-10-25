// Test-only public native fact capture. This is not a product report or classifier.
import fs from 'node:fs';

const scalar = value => value === null || ['string', 'number', 'boolean'].includes(typeof value);
export function errorFacts(error, depth = 0) {
  if (error == null) return null;
  if (depth > 5) return { truncated: true };
  if (typeof error !== 'object') return { thrownValue: String(error) };
  const out = { ownKeys: Object.getOwnPropertyNames(error).sort() };
  for (const key of ['name', 'message', 'stack', 'value', 'actual', 'expected', 'operator', 'showDiff', 'code']) {
    const value = error[key];
    if (scalar(value)) out[key] = typeof value === 'string' ? value.slice(0, 32768) : value;
    if (typeof value === 'string' && value.length > 32768) out.truncated = true;
  }
  if (error.location) out.location = locationFacts(error.location);
  if (Array.isArray(error.stacks)) out.stacks = error.stacks.slice(0, 40).map(frame => ({ file: frame.file, line: frame.line, column: frame.column, method: frame.method }));
  if (error.stacks?.length > 40) out.truncated = true;
  if (error.cause) out.cause = errorFacts(error.cause, depth + 1);
  return out;
}
export function locationFacts(value) {
  return value ? { file: value.file, line: value.line, column: value.column } : null;
}
export function recorder(framework) {
  const output = process.env.MUTATION_NATIVE_CAPTURE;
  if (!output) throw new Error('MUTATION_NATIVE_CAPTURE is required');
  const capture = { schema: 'agent-tests/mutation-native-facts@1', framework, control: process.env.MUTATION_NATIVE_CONTROL, complete: false, events: [], projectionErrors: [] };
  const publish = () => fs.writeFileSync(output, JSON.stringify(capture, null, 2) + '\n');
  publish();
  const record = (type, project) => {
    try { capture.events.push({ sequence: capture.events.length + 1, type, ...project() }); }
    catch (error) { capture.projectionErrors.push({ type, error: errorFacts(error) }); }
    publish();
  };
  return { capture, publish, record };
}
