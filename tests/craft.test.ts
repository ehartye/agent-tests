/**
 * @lane scheduled
 * @risk low
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRules } from './helpers/rules.ts';

const CRAFT = join(dirname(fileURLToPath(import.meta.url)), '..', 'references', 'craft.md');

/** The levels the file promises, in order. Each must hold rules, so a level cannot quietly empty out. */
const LEVELS = ['A function or class', 'A feature', 'The suite and the process around it'];

/** Rules the skills lean on: the audit's soundness question and the agent-instruction block. */
const LOAD_BEARING = [
  'Assert observable behavior through the public seam, not internals',
  'Prefer real collaborators or fakes; use mocks only at boundaries you do not own',
  'Make every assertion capable of failing, and do not stop at "the mock was called"',
  'For agent-written tests, treat mocking and weak assertions as defaults to fight',
  "Isolate every test's resources so tests run in parallel and beside other checkouts",
  'Give each behavior one owning test, named by its subject',
  'Reproduce a bug with a failing test before fixing it',
];

describe('references/craft.md', () => {
  const text = readFileSync(CRAFT, 'utf8');
  const rules = parseRules(text);

  it('has the three levels, each with rules', () => {
    const headings = [...text.matchAll(/^## Level: (.+)$/gm)].map(match => match[1]);
    expect(headings).toEqual(LEVELS);
    const sections = text.split(/^## Level: /m).slice(1);
    for (const section of sections) expect(parseRules(section).length).toBeGreaterThanOrEqual(5);
  });

  it('keeps the rules the skills rely on', () => {
    const titles = rules.map(rule => rule.title);
    for (const title of LOAD_BEARING) expect(titles).toContain(title);
  });

  it('gives every rule a unique title and a claim', () => {
    const titles = rules.map(rule => rule.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const rule of rules) expect(rule.claim, rule.title).toBeTruthy();
  });

  it('cites evidence or labels the rule as opinion', () => {
    for (const rule of rules) expect(rule.evidence.length || (rule.opinion ? 1 : 0), rule.title).toBeGreaterThan(0);
  });

  it('cites evidence as a public URL with what the page says', () => {
    for (const rule of rules) for (const evidence of rule.evidence) expect(evidence, rule.title).toMatch(/^https:\/\/\S+ — .{20}/);
  });
});
