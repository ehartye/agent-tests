import type { Node } from 'web-tree-sitter';
import type { LaneName } from '../schema.ts';
import { loadPythonParser, type ParsePython } from './parser.ts';

/**
 * Facts read from one Python source text, by syntax only: nothing is imported, resolved or executed.
 *
 * Entry points: `extractPythonFacts(source)` awaits the shared parser (loaded once per process by
 * `loadPythonParser`) and reads the facts; `extractPythonFactsWith(parse, source)` is the synchronous core for a
 * caller that already holds the parse function. Both free the syntax tree before returning or throwing.
 *
 * What is read, and what is deliberately not:
 * - Tests are declarations: a parametrized test is one entry. A def inside a module-level `if` or `try` block counts
 *   as module level. Nested classes, defs nested in tests and imported tests are not read.
 * - Assertions inside a nested def or lambda within a test body count toward that test. Helpers imported from other
 *   files are not followed.
 * - Markers are `pytest.mark.<name>` only (bare or called), never `mark.<name>` through a from-import.
 */
export interface PythonTest {
  name: string;
  /** 1-based line of the `def` (decorators excluded). */
  line: number;
  assertions: number;
  /** A method of a unittest `TestCase`-derived class (base `TestCase`, `unittest.TestCase` or a name ending `TestCase`); false for module-level functions and plain `Test*` classes. */
  testCase: boolean;
  /** Python has no todo form; never set. Present so a Python test is shaped like a JavaScript one. */
  todo?: false;
  /** The enclosing class, for a method. */
  className?: string;
  /** Marker names from the test's decorators and its class's decorators and class-level `pytestmark`, in that order, unique. Module markers are separate. */
  markers: string[];
}

export interface PythonImport {
  /** Dotted module without leading dots; `''` for `from . import m`. */
  module: string;
  /** Names after `import` in a from-import (originals, not aliases; `'*'` for a wildcard); empty for `import a.b`. */
  names: string[];
  /** Number of leading dots of a relative import; 0 for an absolute one. */
  level: number;
}

export type PythonOpaqueReason = 'load_tests' | 'imported-test-class' | 'non-literal-import';

export interface PythonOpaque {
  reason: PythonOpaqueReason;
  line: number;
  /** `load_tests`, or the imported name (its alias if it has one) for an imported test class. */
  name?: string;
  /** `imported-test-class` only: the module of the from-import, without leading dots (`''` for `from . import X`), read from the parsed statement. */
  module?: string;
  /** `imported-test-class` only: the number of leading dots of the from-import; 0 for an absolute one. */
  level?: number;
}

export interface PythonFacts {
  /**
   * The source has syntax-error or missing nodes. The facts below are then best effort: whatever the parser
   * recovered is still read, so a caller that flags the file `unparsed` may ignore or keep them.
   */
  hasError: boolean;
  tests: PythonTest[];
  /** Marker names from a module-level `pytestmark = pytest.mark.x` or a list or tuple of them. */
  moduleMarkers: string[];
  /** From the leading `#` comment lines. */
  tags: { lane?: LaneName; risk?: string; subjects?: string[] };
  /**
   * Every import anywhere in the file. For `from a import b` a resolver tries `a/b.py`, `a/b/__init__.py` and
   * `a/b/<name>.py` for each name; for `import a.b` it tries `a/b.py` and `a/b/__init__.py`.
   */
  imports: PythonImport[];
  /** `importlib.import_module(...)`, `import_module(...)` and `__import__(...)` calls; `module` is null when the first argument is not a string literal. */
  dynamicImports: Array<{ module: string | null }>;
  /** Reasons a collector may register tests this reader cannot see, in source order. */
  opaque: PythonOpaque[];
  /** The file imports `unittest` or `pytest` (or a submodule of either). */
  signals: { unittest: boolean; pytest: boolean };
}

const LANES: readonly LaneName[] = ['edit', 'merge', 'scheduled', 'release'];
const TEST_CLASS_NAME = /^Test|Test$|TestCase$/;
const PYTEST_ASSERTING_CALLS = new Set(['pytest.raises', 'pytest.warns', 'pytest.fail']);
const DYNAMIC_IMPORT_CALLEES = new Set(['import_module', '__import__']);

/** Read the facts of one Python source text, loading the shared parser on first use. */
export async function extractPythonFacts(source: string): Promise<PythonFacts> {
  return extractPythonFactsWith(await loadPythonParser(), source);
}

export function extractPythonFactsWith(parse: ParsePython, source: string): PythonFacts {
  const { tree, hasError } = parse(source);
  try {
    const root = tree.rootNode;
    const imports = readImports(root);
    return {
      hasError,
      tests: readTests(root),
      moduleMarkers: readModuleMarkers(root),
      tags: readTags(source),
      imports,
      ...readDynamicImportsAndOpaque(root),
      signals: {
        unittest: imports.some(i => i.level === 0 && isModuleOrChild(i.module, 'unittest')),
        pytest: imports.some(i => i.level === 0 && isModuleOrChild(i.module, 'pytest')),
      },
    };
  } finally {
    tree.delete();
  }
}

const isModuleOrChild = (module: string, root: string) => module === root || module.startsWith(`${root}.`);
const compact = (text: string) => text.replace(/\s+/g, '');
const line = (node: Node) => node.startPosition.row + 1;

/**
 * Leading comment lines before the first statement (blank lines are skipped; a docstring or code ends them), read with
 * the same patterns as the JavaScript tags in `parseTags`: the first `@lane` match only, kept only if it names a lane;
 * the first `@risk`; every `@subject`.
 */
function readTags(source: string): PythonFacts['tags'] {
  const comments: string[] = [];
  for (const raw of source.split(/\r\n|\r|\n/)) {
    const text = raw.trim();
    if (text === '') continue;
    if (!text.startsWith('#')) break;
    comments.push(text);
  }
  const head = comments.join('\n');
  const tags: PythonFacts['tags'] = {};
  const lane = head.match(/@lane\s+([a-z]+)/)?.[1];
  if (lane && (LANES as readonly string[]).includes(lane)) tags.lane = lane as LaneName;
  const risk = head.match(/@risk\s+([A-Za-z][\w-]*)/)?.[1];
  if (risk) tags.risk = risk;
  const subjects = [...head.matchAll(/@subject\s+(\S+)/g)].map(match => match[1]!);
  if (subjects.length > 0) tags.subjects = subjects;
  return tags;
}

/**
 * Module-level definitions, imports and assignments: everything not inside a def or class, including statements
 * nested in `if`, `try`, `with` and error-recovery nodes. Definitions are yielded, not entered.
 */
function* moduleLevel(node: Node): Generator<Node> {
  for (const child of node.namedChildren) {
    switch (child.type) {
      case 'function_definition':
      case 'class_definition':
      case 'decorated_definition':
      case 'import_from_statement':
      case 'assignment':
        yield child;
        break;
      default:
        yield* moduleLevel(child);
    }
  }
}

/** The definition a `decorated_definition` wraps, or the node itself. */
const undecorated = (node: Node): Node | null => node.type === 'decorated_definition' ? node.childForFieldName('definition') : node;

function decoratorExpressions(node: Node): Node[] {
  if (node.type !== 'decorated_definition') return [];
  return node.namedChildren.filter(child => child.type === 'decorator').flatMap(decorator => {
    const expression = decorator.namedChildren.find(child => child.type !== 'comment');
    return expression ? [expression] : [];
  });
}

/** `pytest.fixture`, `fixture` or `pytest_asyncio.fixture`, bare or called: a decorated function is not collected as a test. */
function isFixtureDecorator(expression: Node): boolean {
  const callee = expression.type === 'call' ? expression.childForFieldName('function') : expression;
  return !!callee && /^(?:pytest\.|pytest_asyncio\.)?fixture$/.test(compact(callee.text));
}

/** `pytest.mark.<name>` or a call of it. */
function markerName(expression: Node | null | undefined): string | null {
  let node = expression;
  if (node?.type === 'parenthesized_expression') node = node.namedChildren.find(child => child.type !== 'comment');
  if (node?.type === 'call') node = node.childForFieldName('function');
  if (node?.type !== 'attribute') return null;
  return /^pytest\.mark\.(\w+)$/.exec(compact(node.text))?.[1] ?? null;
}

function markersOf(expression: Node | null): string[] {
  if (expression?.type === 'list' || expression?.type === 'tuple') {
    return expression.namedChildren.flatMap(child => markerName(child) ?? []);
  }
  const single = markerName(expression);
  return single ? [single] : [];
}

const unique = (names: string[]) => [...new Set(names)];

/** `pytestmark = ...` assignments directly in `scope` (a module or class body). */
function pytestmarkIn(assignments: Iterable<Node>): string[] {
  const names: string[] = [];
  for (const assignment of assignments) {
    if (assignment.type === 'assignment' && assignment.childForFieldName('left')?.text === 'pytestmark') {
      names.push(...markersOf(assignment.childForFieldName('right')));
    }
  }
  return unique(names);
}

function readModuleMarkers(root: Node): string[] {
  return pytestmarkIn(moduleLevel(root));
}

function classBases(definition: Node): string[] {
  const bases = definition.childForFieldName('superclasses');
  if (!bases) return [];
  return bases.namedChildren.filter(child => child.type === 'identifier' || child.type === 'attribute').map(child => compact(child.text));
}

const isTestCaseBase = (base: string) => base.split('.').pop()!.endsWith('TestCase');

function hasInit(body: Node): boolean {
  return body.namedChildren.some(child => undecorated(child)?.type === 'function_definition' && undecorated(child)?.childForFieldName('name')?.text === '__init__');
}

function readTests(root: Node): PythonTest[] {
  const tests: PythonTest[] = [];
  for (const node of moduleLevel(root)) {
    const definition = undecorated(node);
    if (definition?.type === 'function_definition') {
      const name = definition.childForFieldName('name')?.text ?? '';
      if (name.startsWith('test') && !decoratorExpressions(node).some(isFixtureDecorator)) {
        tests.push(makeTest(definition, name, unique(decoratorExpressions(node).flatMap(e => markerName(e) ?? [])), false));
      }
    } else if (definition?.type === 'class_definition') {
      const className = definition.childForFieldName('name')?.text ?? '';
      const body = definition.childForFieldName('body');
      if (!body) continue;
      const unittestClass = classBases(definition).some(isTestCaseBase);
      if (!unittestClass && !(className.startsWith('Test') && !hasInit(body))) continue;
      const classMarkers = unique([...decoratorExpressions(node).flatMap(e => markerName(e) ?? []), ...pytestmarkIn(body.namedChildren.flatMap(child => child.type === 'expression_statement' ? child.namedChildren : []))]);
      for (const member of body.namedChildren) {
        const method = undecorated(member);
        if (method?.type !== 'function_definition') continue;
        const name = method.childForFieldName('name')?.text ?? '';
        if (!name.startsWith('test') || decoratorExpressions(member).some(isFixtureDecorator)) continue;
        const own = decoratorExpressions(member).flatMap(e => markerName(e) ?? []);
        tests.push({ ...makeTest(method, name, unique([...classMarkers, ...own]), unittestClass), className });
      }
    }
  }
  return tests;
}

function makeTest(definition: Node, name: string, markers: string[], testCase: boolean): PythonTest {
  return { name, line: line(definition), assertions: countAssertions(definition.childForFieldName('body')), testCase, markers };
}

/** Assert statements and asserting calls anywhere in the body, nested defs and lambdas included. A with-block or call of the same call node counts once. */
function countAssertions(body: Node | null): number {
  if (!body) return 0;
  let count = 0;
  for (const node of body.descendantsOfType(['assert_statement', 'call'])) {
    if (node.type === 'assert_statement') {
      count++;
      continue;
    }
    const callee = node.childForFieldName('function');
    if (callee?.type !== 'attribute') continue;
    if (PYTEST_ASSERTING_CALLS.has(compact(callee.text))) {
      count++;
      continue;
    }
    const attribute = callee.childForFieldName('attribute')?.text ?? '';
    if (callee.childForFieldName('object')?.text === 'self' && (attribute.startsWith('assert') || attribute === 'fail')) count++;
  }
  return count;
}

function readImports(root: Node): PythonImport[] {
  const imports: PythonImport[] = [];
  for (const node of root.descendantsOfType(['import_statement', 'import_from_statement'])) {
    if (node.type === 'import_statement') {
      for (const entry of node.childrenForFieldName('name')) {
        const target = entry.type === 'aliased_import' ? entry.childForFieldName('name') : entry;
        if (target) imports.push({ module: compact(target.text), names: [], level: 0 });
      }
      continue;
    }
    imports.push({ ...fromImportSource(node), names: importedNames(node) });
  }
  return imports;
}

/** The module (without leading dots) and the dot count of an `import_from_statement`, read from its parse. */
function fromImportSource(node: Node): { module: string; level: number } {
  const moduleNode = node.childForFieldName('module_name');
  if (moduleNode?.type === 'relative_import') {
    return {
      level: (moduleNode.namedChildren.find(child => child.type === 'import_prefix')?.text.match(/\./g) ?? []).length,
      module: compact(moduleNode.namedChildren.find(child => child.type === 'dotted_name')?.text ?? ''),
    };
  }
  return { module: moduleNode ? compact(moduleNode.text) : '', level: 0 };
}

/** The original names of a from-import, with `'*'` for a wildcard. */
function importedNames(node: Node): string[] {
  const names = node.childrenForFieldName('name').flatMap(entry => {
    const target = entry.type === 'aliased_import' ? entry.childForFieldName('name') : entry;
    return target ? [compact(target.text)] : [];
  });
  if (node.namedChildren.some(child => child.type === 'wildcard_import')) names.push('*');
  return names;
}

/** The bound name of each imported name: its alias when it has one. */
function boundNames(node: Node): string[] {
  return node.childrenForFieldName('name').flatMap(entry => {
    const bound = entry.type === 'aliased_import' ? entry.childForFieldName('alias') : entry;
    return bound ? [compact(bound.text)] : [];
  });
}

/** The module named by the first argument of an import call: a plain string literal, else null. */
function literalModule(call: Node): string | null {
  const args = call.childForFieldName('arguments')?.namedChildren.filter(child => child.type !== 'comment') ?? [];
  const first = args.find(arg => arg.type !== 'keyword_argument')
    ?? args.find(arg => arg.type === 'keyword_argument' && arg.childForFieldName('name')?.text === 'name')?.childForFieldName('value');
  if (first?.type !== 'string') return null;
  let text = '';
  for (const part of first.children) {
    if (part.type === 'string_content') text += part.text;
    else if (part.type !== 'string_start' && part.type !== 'string_end') return null;
  }
  return text;
}

function readDynamicImportsAndOpaque(root: Node): Pick<PythonFacts, 'dynamicImports' | 'opaque'> {
  const dynamicImports: PythonFacts['dynamicImports'] = [];
  const opaque: PythonOpaque[] = [];
  for (const call of root.descendantsOfType('call')) {
    const callee = call.childForFieldName('function');
    const name = callee?.type === 'identifier' ? callee.text : callee?.type === 'attribute' ? callee.childForFieldName('attribute')?.text : undefined;
    if (!name || !DYNAMIC_IMPORT_CALLEES.has(name)) continue;
    const module = literalModule(call);
    dynamicImports.push({ module });
    if (module === null) opaque.push({ reason: 'non-literal-import', line: line(call) });
  }
  for (const node of moduleLevel(root)) {
    const definition = undecorated(node);
    if (definition?.type === 'function_definition' && definition.childForFieldName('name')?.text === 'load_tests') {
      opaque.push({ reason: 'load_tests', line: line(definition), name: 'load_tests' });
    } else if (node.type === 'import_from_statement') {
      const source = fromImportSource(node);
      for (const bound of boundNames(node)) {
        if (TEST_CLASS_NAME.test(bound)) opaque.push({ reason: 'imported-test-class', line: line(node), name: bound, ...source });
      }
    }
  }
  return { dynamicImports, opaque: opaque.sort((a, b) => a.line - b.line) };
}
