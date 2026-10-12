/**
 * @lane edit
 * @risk standard
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Everything a user receives and an agent reads or runs: guidance, launcher scripts and the manifest. */
const SHIPPED = ['skills', 'references', 'scripts', '.claude-plugin', 'README.md'];

function files(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap(entry => files(join(path, entry)));
}

const documents = SHIPPED.flatMap(entry => files(join(ROOT, entry))).map(path => ({
  name: relative(ROOT, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));

/** Private context and machine-specific paths. A skill that depends on any of these only works on the author's machine. */
const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  { label: 'a wiki or vault page path', pattern: /\bwiki\/(?:sources|authored|concepts|syntheses)\b|\braw\/clippings\b/ },
  { label: 'a mention of a wiki vault or wiki-master', pattern: /\bvault\b|wiki-master|\[\[[^\]]+\]\]/i },
  { label: 'a Windows drive path', pattern: /\b[A-Za-z]:[\\/](?:Users|Windows|Program Files|repos)\b/ },
  { label: 'a user home path', pattern: /\/(?:Users|home)\/[a-z][\w.-]*\//i },
  { label: 'a reference to the planning documents', pattern: /docs\/superpowers|\bthe seed claim\b|\bthe plan's\b/ },
];

describe('shipped files do not depend on this machine or on private notes', () => {
  it('finds files to check', () => {
    expect(documents.length).toBeGreaterThan(8);
  });

  describe.each(FORBIDDEN)('$label is absent', ({ pattern }) => {
    it('in any shipped file', () => {
      const hits = documents.filter(document => pattern.test(document.text)).map(document => document.name);
      expect(hits).toEqual([]);
    });
  });
});
