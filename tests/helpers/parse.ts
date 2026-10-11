import { afterAll } from 'vitest';
import { openParseSession, type ParseSession } from '../../src/parse.ts';

let session: ParseSession | null = null;

afterAll(() => {
  session?.close();
  session = null;
});

/** Parse one file with a session shared by the whole test file, so the native TypeScript process starts once. */
export function parseTestFile(fileName: string, text: string): ReturnType<ParseSession['parse']> {
  session ??= openParseSession();
  return session.parse(fileName, text);
}
