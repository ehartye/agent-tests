export interface Rule {
  title: string;
  claim: string | null;
  evidence: string[];
  opinion: string | null;
}

/** Splits a reference file into its `## Rule:` sections and reads the Claim, Evidence and Opinion lines of each. */
export function parseRules(text: string): Rule[] {
  return text
    .split(/^## Rule: /m)
    .slice(1)
    .map(section => {
      const [title, ...lines] = section.split('\n');
      const field = (name: string): string[] => lines.filter(line => line.startsWith(`${name}: `)).map(line => line.slice(name.length + 2).trim());
      return { title: title.trim(), claim: field('Claim')[0] ?? null, evidence: field('Evidence'), opinion: field('Opinion')[0] ?? null };
    });
}
