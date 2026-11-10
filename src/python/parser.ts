import { createRequire } from 'node:module';
import { Language, Parser, type Tree } from 'web-tree-sitter';

export interface PythonParse {
  /** The concrete syntax tree, held in WASM memory: call `tree.delete()` when done with it. Parsing reads text only: no Python runs. */
  tree: Tree;
  /** True when the tree has syntax-error or missing nodes, so facts read from it may be incomplete. */
  hasError: boolean;
}

export type ParsePython = (source: string) => PythonParse;

const require = createRequire(import.meta.url);

/** The Python grammar WASM shipped inside the `tree-sitter-python` package, resolved from node_modules. */
export function pythonGrammarPath(): string {
  return require.resolve('tree-sitter-python/tree-sitter-python.wasm');
}

let loading: Promise<ParsePython> | undefined;

/** Load the runtime and grammar once per process; later calls return the same promise. A failed load is not cached. */
export function loadPythonParser(): Promise<ParsePython> {
  loading ??= load().catch(error => {
    loading = undefined;
    throw error;
  });
  return loading;
}

async function load(): Promise<ParsePython> {
  await Parser.init();
  const language = await Language.load(pythonGrammarPath());
  const parser = new Parser();
  parser.setLanguage(language);
  return source => {
    const tree = parser.parse(source);
    if (!tree) throw new Error('Python parser returned no tree');
    return { tree, hasError: tree.rootNode.hasError };
  };
}
