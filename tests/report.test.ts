import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/report.ts';
import { scan } from '../src/scan.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('renderMarkdown', () => {
  it('summarizes the bloated fixture with findings grouped by category', () => {
    const markdown = renderMarkdown(scan(join(FIXTURES, 'bloated'), { commitLimit: 1 }));
    expect(markdown).toContain('# Test audit evidence');
    expect(markdown).toContain('- Phase: dev');
    expect(markdown).toContain('| shim | 3 |');
    expect(markdown).toContain('### worktree');
    expect(markdown).toContain('`tests/net/server.test.ts:');
    expect(markdown).toContain('**frequency.watch-default**');
    expect(markdown).toContain('## Files sharing a subject');
  });

  it('lists files with the most findings first', () => {
    const markdown = renderMarkdown(scan(join(FIXTURES, 'bloated'), { commitLimit: 1 }));
    const table = markdown.split('## Test files')[1]?.split('\n').filter(line => line.startsWith('| tests/')) ?? [];
    expect(table[0]).toContain('tests/net/server.test.ts');
  });

  it('says None when there are no findings', () => {
    const markdown = renderMarkdown(scan(join(FIXTURES, 'clean'), { commitLimit: 1 }));
    expect(markdown).toContain('## Findings\n\nNone.');
  });

  it('escapes pipes in table cells', () => {
    const report = scan(join(FIXTURES, 'clean'), { commitLimit: 1 });
    report.files[0]!.file = 'a|b.test.ts';
    expect(renderMarkdown(report)).toContain('a\\|b.test.ts');
  });
});
