import { afterAll } from 'vitest';
import { openParseSession, type ParseSession } from '../../src/parse.ts';

let session: ParseSession | null = null;

// This module-level session relies on vitest's per-file isolation: every test file gets a fresh copy of this module,
// so each file starts its own session and this afterAll closes it. Turning isolation off would share one session.
afterAll(() => {
  session?.close();
  session = null;
});

/** Parse one file with a session shared by the whole test file, so the native TypeScript process starts once. */
export function parseTestFile(fileName: string, text: string): ReturnType<ParseSession['parse']> {
  session ??= openParseSession();
  return session.parse(fileName, text);
}
