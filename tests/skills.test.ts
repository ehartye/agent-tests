/**
 * @lane edit
 * @risk standard
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/cli.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'skills');
const REQUIRED = ['tests-setup', 'test-audit', 'test-strategy'];
const CLI_COMMANDS: readonly string[] = COMMANDS;
const CLI_FLAGS = ['root', 'write', 'max-files', 'max-per-rule'];
// Helper commands are checked by the launcher's executable dispatch tests, not src/cli.ts's COMMANDS.
const HELPER_FLAGS: Record<string, string[]> = {'playbot-export': ['out', 'verify', 'require-current']};
const SETUP_FLAGS = ['check', 'json'];

const skillNames = readdirSync(SKILLS, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

function load(name: string): { text: string; meta: Record<string, string>; body: string } {
  const text = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`${name}/SKILL.md has no frontmatter`);
  return { text, meta: parse(match[1]) as Record<string, string>, body: match[2] };
}

/** Every source file that can emit an error code: the launcher scripts and the CLI. */
function sourceFiles(directory: string, extensions: string[]): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path, extensions);
    return extensions.some(extension => entry.endsWith(extension)) ? [path] : [];
  });
}

const SOURCES = [
  ...sourceFiles(join(ROOT, 'scripts'), ['.js', '.mjs']),
  ...sourceFiles(join(ROOT, 'src'), ['.ts']),
]
  .map(path => readFileSync(path, 'utf8'))
  .join('\n');

/**
 * Each example is a line that calls run-managed.js or setup.js plus the lines that continue it: up to a blank line or the
 * next list item, heading or table row. Which script it calls decides which flags are real.
 */
function examples(body: string): { script: 'cli' | 'setup'; text: string }[] {
  const lines = body.split('\n');
  const found: { script: 'cli' | 'setup'; text: string }[] = [];
  lines.forEach((line, index) => {
    if (!/run-managed\.js|setup\.js/.test(line)) return;
    let text = line;
    for (let next = index + 1; next < lines.length; next++) {
      if (lines[next].trim() === '' || /^\s*(?:[-*]|\d+\.|#|\|)\s/.test(lines[next])) break;
      text += `\n${lines[next]}`;
    }
    found.push({ script: /setup\.js/.test(line) ? 'setup' : 'cli', text });
  });
  return found;
}

describe('skills', () => {
  it('ships the expected skills', () => {
    expect(skillNames).toEqual(expect.arrayContaining(REQUIRED));
  });

  it('reads the commands from the CLI itself', () => {
    expect(CLI_COMMANDS).toEqual(['capabilities', 'risk-draft', 'scan', 'report']);
  });

  describe.each(skillNames)('%s', name => {
    const { text, meta, body } = load(name);

    it('has frontmatter matching its directory', () => {
      expect(meta.name).toBe(name);
      expect(typeof meta.description).toBe('string');
      expect(meta.description.length).toBeGreaterThan(40);
      expect(meta.description.length).toBeLessThanOrEqual(400);
    });

    it('says when to use it', () => {
      expect(meta.when_to_use).toMatch(/^Use /);
    });

    it('keeps description and when_to_use within the listing budget, with no colon-space in a value', () => {
      expect(meta.description.length + meta.when_to_use.length).toBeLessThan(1536);
      const frontmatter = text.split(/\r?\n---\r?\n/)[0];
      for (const line of frontmatter.split(/\r?\n/).slice(1)) expect(line.replace(/^[a-z_]+: /, '')).not.toContain(': ');
    });

    it('stays short enough to hold in context', () => {
      expect(body.split('\n').length).toBeLessThanOrEqual(160);
    });

    it('is plain ASCII with no argument placeholders', () => {
      expect(text).toMatch(/^[\x00-\x7F]*$/);
      expect(text).not.toMatch(/\$[1-9]|\$ARGUMENTS/);
    });

    it('only calls CLI commands or checked launcher helpers that exist', () => {
      const called = [...body.matchAll(/run-managed\.js" ([a-z-]+)/g)].map(match => match[1]);
      for (const command of called) expect([...CLI_COMMANDS, ...Object.keys(HELPER_FLAGS)]).toContain(command);
    });

    it('only names options the scripts accept', () => {
      for (const example of examples(body)) {
        const helper = example.text.match(/run-managed\.js" ([a-z-]+)/)?.[1];
        const allowed = example.script === 'setup' ? SETUP_FLAGS : helper && HELPER_FLAGS[helper] || CLI_FLAGS;
        for (const match of example.text.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)) expect(allowed, `--${match[1]} in: ${example.text}`).toContain(match[1]);
      }
    });

    it('only points at scripts and references that exist', () => {
      for (const match of body.matchAll(/scripts\/([\w-]+\.js)/g)) expect(existsSync(join(ROOT, 'scripts', match[1]))).toBe(true);
      for (const match of body.matchAll(/references\/([\w-]+(?:\.[\w-]+)*)/g)) expect(existsSync(join(ROOT, 'references', match[1])), match[0]).toBe(true);
    });

    it('only names error codes the code can emit', () => {
      for (const match of text.matchAll(/\bE_[A-Z_]+\b/g)) expect(SOURCES.includes(match[0]), `${match[0]} is not emitted by any source`).toBe(true);
    });

    it('defines <plugin-root> when it launches a script', () => {
      if (!/run-managed\.js|setup\.js/.test(body)) return;
      expect(body).toMatch(/^.*`<plugin-root>` is the directory.*$/m);
    });
  });

  it('has tests-setup name the setup script', () => {
    expect(load('tests-setup').body).toContain('scripts/setup.js');
  });
});
