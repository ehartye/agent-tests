/**
 * @lane scheduled
 * @risk low
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DOCTRINE = join(dirname(fileURLToPath(import.meta.url)), '..', 'references', 'doctrine.md');

/** Every rule the skills teach. A rule with no outside evidence must say so as Opinion. */
const REQUIRED_RULES = [
  'Efficiency is protection per unit of cost',
  'Run frequency multiplies cost',
  'Test size and layers',
  'Flaky tests cost more than their runtime',
  'Run only affected tests in the edit loop',
  'No compatibility tests without consumers',
  'Automatic CI on every push for a solo pre-release project',
  'Windows and macOS runners cost more than Linux',
  'Bare vitest can start watch mode in an interactive terminal',
  'Agent-written tests drift toward hollow and duplicated tests',
  'Risk tiers decide test depth',
  'Mutation testing measures whether a test can fail',
];

interface Rule {
  title: string;
  claim: string | null;
  evidence: string[];
  opinion: string | null;
}

function parseRules(text: string): Rule[] {
  return text
    .split(/^## Rule: /m)
    .slice(1)
    .map(section => {
      const [title, ...lines] = section.split('\n');
      const field = (name: string): string[] => lines.filter(line => line.startsWith(`${name}: `)).map(line => line.slice(name.length + 2).trim());
      return { title: title.trim(), claim: field('Claim')[0] ?? null, evidence: field('Evidence'), opinion: field('Opinion')[0] ?? null };
    });
}

describe('references/doctrine.md', () => {
  const rules = parseRules(readFileSync(DOCTRINE, 'utf8'));

  it('covers every rule the skills teach', () => {
    expect(rules.map(rule => rule.title).sort()).toEqual([...REQUIRED_RULES].sort());
  });

  it.each(REQUIRED_RULES)('%s states a claim', title => {
    expect(rules.find(rule => rule.title === title)?.claim).toBeTruthy();
  });

  it.each(REQUIRED_RULES)('%s cites evidence or is labeled opinion', title => {
    const rule = rules.find(candidate => candidate.title === title);
    expect(rule?.evidence.length || (rule?.opinion ? 1 : 0)).toBeGreaterThan(0);
  });

  it('cites evidence as a wiki page or a URL', () => {
    for (const rule of rules) for (const evidence of rule.evidence) expect(evidence).toMatch(/^(?:wiki\/|https?:\/\/)\S+ — \S/);
  });
});
