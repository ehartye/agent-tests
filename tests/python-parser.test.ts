import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPythonParser, pythonGrammarPath } from '../src/python/parser.ts';

describe('python parser loader', () => {
  it('returns a parse function that reports errors without running Python', async () => {
    const parse = await loadPythonParser();
    expect(typeof parse).toBe('function');
    const valid = parse('def test_x(): pass\n');
    expect(valid.hasError).toBe(false);
    expect(valid.tree.rootNode.type).toBe('module');
    expect(parse('def (:\n').hasError).toBe(true);
  });

  it('parses pytest functions, classes and markers', async () => {
    const parse = await loadPythonParser();
    const source = [
      'import pytest',
      'pytestmark = pytest.mark.merge',
      '',
      '@pytest.mark.parametrize("n", [1, 2])',
      'async def test_values(n):',
      '    assert n',
      '',
      'class TestThing:',
      '    def test_it(self):',
      '        with pytest.raises(ValueError):',
      '            raise ValueError',
      '',
    ].join('\n');
    const { tree, hasError } = parse(source);
    expect(hasError).toBe(false);
    const names = tree.rootNode.descendantsOfType(['function_definition', 'class_definition'])
      .map(node => node!.childForFieldName('name')!.text);
    expect(names).toEqual(['test_values', 'TestThing', 'test_it']);
  });

  it('loads once per process', async () => {
    const first = loadPythonParser();
    const second = loadPythonParser();
    expect(second).toBe(first);
    expect(await second).toBe(await first);
  });

  it('resolves the grammar from node_modules, not a hard-coded path', () => {
    const path = pythonGrammarPath();
    expect(path.endsWith('.wasm')).toBe(true);
    expect(path).toContain(`${sep}node_modules${sep}`);
    expect(existsSync(path)).toBe(true);
    expect(path).toBe(createRequire(import.meta.url).resolve('tree-sitter-python/tree-sitter-python.wasm'));
  });
});
