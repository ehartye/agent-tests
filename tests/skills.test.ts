/**
 * @lane edit
 * @risk standard
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'skills');
const COMMANDS = ['capabilities', 'risk-draft', 'scan', 'report'];
const REQUIRED = ['tests-setup', 'test-audit', 'test-strategy'];

const skillNames = readdirSync(SKILLS, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

function load(name: string): { meta: Record<string, string>; body: string } {
  const text = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${name}/SKILL.md has no frontmatter`);
  return { meta: parse(match[1]) as Record<string, string>, body: match[2] };
}

describe('skills', () => {
  it('ships the expected skills', () => {
    expect(skillNames).toEqual(expect.arrayContaining(REQUIRED));
  });

  describe.each(skillNames)('%s', name => {
    const { meta, body } = load(name);

    it('has frontmatter matching its directory', () => {
      expect(meta.name).toBe(name);
      expect(typeof meta.description).toBe('string');
      expect(meta.description.length).toBeGreaterThan(40);
      expect(meta.description.length).toBeLessThanOrEqual(400);
    });

    it('says when to use it', () => {
      expect(meta.when_to_use).toMatch(/^Use /);
    });

    it('stays short enough to hold in context', () => {
      expect(body.split('\n').length).toBeLessThanOrEqual(160);
    });

    it('only calls CLI commands that exist', () => {
      const called = [...body.matchAll(/run-managed\.js" ([a-z-]+)/g)].map(match => match[1]);
      for (const command of called) expect(COMMANDS).toContain(command);
    });

    it('only points at scripts and references that exist', () => {
      for (const match of body.matchAll(/scripts\/([\w-]+\.js)/g)) expect(existsSync(join(ROOT, 'scripts', match[1]))).toBe(true);
    });
  });
});
