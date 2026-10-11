import { existsSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { SyntaxKind, type CallExpression, type ImportDeclaration, type Node, type PropertyAccessExpression, type SourceFile } from 'typescript/unstable/ast';
import { isCallExpression, isIdentifier, isImportDeclaration, isNamedImports, isNoSubstitutionTemplateLiteral, isPropertyAccessExpression, isStringLiteral } from 'typescript/unstable/ast/is';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { API } from 'typescript/unstable/sync';
import { isSupportPath, isTestPath } from './discover.ts';
import { relPosix } from './paths.ts';
import type { LaneName } from './schema.ts';

export interface ParsedTest {
  name: string;
  line: number;
  assertions: number;
  todo: boolean;
}

export interface ParsedFile {
  imports: string[];
  tests: ParsedTest[];
  /** Every describe and it/test title, for marker detection. */
  titles: Array<{ text: string; line: number }>;
  assertions: number;
  snapshotAssertions: number;
  mockAssertions: number;
  mockCalls: number;
  tautologies: number;
  /** `@subject` lists code the test reaches without importing it, such as a CLI run in a subprocess. */
  tags: { lane?: LaneName; risk?: string; subjects?: string[] };
}

/** One native TypeScript process that parses many files. Call close() when done: the process outlives the script otherwise. */
export interface ParseSession {
  parse(fileName: string, text: string): ParsedFile;
  close(): void;
}

const TEST_CALLEE = /^(?:it|test)(?:\.(?:only|skip|todo|concurrent|fails))?$/;
const EACH_CALLEE = /^(?:it|test)\.each$/;
const SUITE_CALLEE = /^describe(?:\.(?:only|skip|todo|concurrent))?$/;
const MOCK_CALLEE = /^(?:vi|jest)\.(?:mock|doMock|fn|spyOn)$/;
const SNAPSHOT_MATCHER = /^toMatch(?:Inline|File)?Snapshot$/;
const MOCK_MATCHER = /^(?:toHaveBeenCalled(?:With|Times)?|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|toBeCalled(?:With|Times)?|toHaveReturned(?:With|Times)?)$/;
const IDENTITY_MATCHER = /^(?:toBe|toEqual|toStrictEqual)$/;
const LANES: readonly LaneName[] = ['edit', 'merge', 'scheduled', 'release'];

/** Parse only: no type information, no module resolution, no default library. */
const COMPILER_OPTIONS = { allowJs: true, noResolve: true, noLib: true, types: [], jsx: 'preserve' };

export function parseTags(text: string): ParsedFile['tags'] {
  const head = text.slice(0, 2000);
  const tags: ParsedFile['tags'] = {};
  const lane = head.match(/@lane\s+([a-z]+)/)?.[1];
  if (lane && (LANES as readonly string[]).includes(lane)) tags.lane = lane as LaneName;
  const risk = head.match(/@risk\s+([A-Za-z][\w-]*)/)?.[1];
  if (risk) tags.risk = risk;
  const subjects = [...head.matchAll(/@subject\s+(\S+)/g)].map(match => match[1]);
  if (subjects.length > 0) tags.subjects = subjects;
  return tags;
}

function titleOf(call: CallExpression): string {
  const first = call.arguments[0];
  if (first && (isStringLiteral(first) || isNoSubstitutionTemplateLiteral(first))) return first.text;
  return first ? first.getText() : '<dynamic>';
}

function isTestCall(call: CallExpression): boolean {
  const callee = call.expression;
  if (isCallExpression(callee)) return EACH_CALLEE.test(callee.expression.getText()); // it.each(table)('name', fn)
  const text = callee.getText();
  return TEST_CALLEE.test(text) && (call.arguments.length >= 2 || text.endsWith('.todo'));
}

/** The expect(...) call at the root of `expect(x).not.toBe(y)` style chains, or null. */
function expectRoot(callee: PropertyAccessExpression): CallExpression | null {
  let node: Node = callee.expression;
  while (isPropertyAccessExpression(node)) node = node.expression;
  if (isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === 'expect') return node;
  return null;
}

/** `import type { X }` and `import { type X }` bring in no runtime code, so the module is not exercised. */
function isTypeOnlyImport(node: ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.phaseModifier === SyntaxKind.TypeKeyword) return true;
  const named = clause.namedBindings;
  return !clause.name && !!named && isNamedImports(named) && named.elements.length > 0 && named.elements.every(element => element.isTypeOnly);
}

function lineIndex(text: string): (position: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return position => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= position) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

function extractFacts(sourceFile: SourceFile, text: string): ParsedFile {
  const out: ParsedFile = {
    imports: [],
    tests: [],
    titles: [],
    assertions: 0,
    snapshotAssertions: 0,
    mockAssertions: 0,
    mockCalls: 0,
    tautologies: 0,
    tags: parseTags(text),
  };
  const lineAt = lineIndex(text);
  const lineOf = (node: Node): number => lineAt(node.getStart());

  const visit = (node: Node, current: ParsedTest | null): void => {
    let next = current;
    if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier) && !isTypeOnlyImport(node)) out.imports.push(node.moduleSpecifier.text);
    if (isCallExpression(node)) {
      const callee = node.expression;
      const calleeText = callee.getText();
      if (isTestCall(node)) {
        const name = titleOf(node);
        next = { name, line: lineOf(node), assertions: 0, todo: calleeText.endsWith('.todo') };
        out.tests.push(next);
        out.titles.push({ text: name, line: next.line });
      } else if (SUITE_CALLEE.test(calleeText)) {
        out.titles.push({ text: titleOf(node), line: lineOf(node) });
      } else if (MOCK_CALLEE.test(calleeText)) {
        out.mockCalls++;
      } else if (isIdentifier(callee) && callee.text === 'expect') {
        out.assertions++;
        if (current) current.assertions++;
      } else if (/^assert(?:\.\w+)?$/.test(calleeText)) {
        out.assertions++;
        if (current) current.assertions++;
      } else if (isPropertyAccessExpression(callee)) {
        const root = expectRoot(callee);
        if (root) {
          const matcher = callee.name.text;
          if (SNAPSHOT_MATCHER.test(matcher)) out.snapshotAssertions++;
          if (MOCK_MATCHER.test(matcher)) out.mockAssertions++;
          if (IDENTITY_MATCHER.test(matcher) && root.arguments.length === 1 && node.arguments.length === 1) {
            if (root.arguments[0].getText() === node.arguments[0].getText()) out.tautologies++;
          }
        }
      }
    }
    // forEachChild stops early when its callback returns a value, so the callback must not return one.
    node.forEachChild(child => {
      visit(child, next);
    });
  };
  visit(sourceFile, null);
  return out;
}

/** Open a parse session. Files are fed to the TypeScript 7 API through an in-memory filesystem, one tiny project per file. */
export function openParseSession(): ParseSession {
  const fs = createVirtualFileSystem({ '/agent-tests/session.json': '{}' });
  const api = new API({ cwd: '/agent-tests', fs });
  let count = 0;
  return {
    parse(fileName, text) {
      const dir = `/agent-tests/${count++}`;
      const base = `source${extname(fileName) || '.ts'}`; // the extension picks TS, TSX, JS or JSX parsing
      const config = `${dir}/tsconfig.json`;
      fs.writeFile?.(`${dir}/${base}`, text);
      fs.writeFile?.(config, JSON.stringify({ compilerOptions: COMPILER_OPTIONS, files: [base] }));
      const snapshot = api.updateSnapshot({ openProject: config });
      try {
        const sourceFile = snapshot.getProject(config)?.program.getSourceFile(`${dir}/${base}`);
        if (!sourceFile) throw new Error(`TypeScript could not parse ${fileName}`);
        return extractFacts(sourceFile, text);
      } finally {
        snapshot.dispose();
      }
    },
    close() {
      api.close();
    },
  };
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** Repo-relative non-test source files a test file imports through relative specifiers. */
export function resolveSubjects(root: string, testRel: string, imports: string[]): string[] {
  const dir = dirname(resolve(root, testRel));
  const found = new Set<string>();
  for (const spec of imports) {
    if (!spec.startsWith('.')) continue;
    const base = resolve(dir, spec);
    const stripped = base.replace(/\.[cm]?[jt]sx?$/, '');
    const candidates = [base, ...EXTENSIONS.map(ext => stripped + ext), ...EXTENSIONS.map(ext => resolve(base, `index${ext}`))];
    const hit = candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile());
    if (!hit) continue;
    const rel = relPosix(root, hit);
    if (rel.startsWith('..') || isTestPath(rel) || isSupportPath(rel)) continue;
    found.add(rel);
  }
  return [...found].sort();
}
