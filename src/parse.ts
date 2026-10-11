import { existsSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { SyntaxKind, type CallExpression, type ImportDeclaration, type Node, type PropertyAccessExpression, type SourceFile } from 'typescript/unstable/ast';
import { isCallExpression, isIdentifier, isImportDeclaration, isNamedImports, isNoSubstitutionTemplateLiteral, isPropertyAccessExpression, isStringLiteral, isTaggedTemplateExpression } from 'typescript/unstable/ast/is';
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

/**
 * One native TypeScript process that parses many files. The child process does not keep Node alive and is killed
 * when Node exits, but call close() anyway: it releases the process and its memory early, which matters in a
 * long-lived process or when many sessions are opened.
 */
export interface ParseSession {
  parse(fileName: string, text: string): ParsedFile;
  close(): void;
}

const TEST_CALLEE = /^(?:it|test)(?:\.(?:only|skip|todo|concurrent|sequential|fails|skipIf|runIf|each|for))*$/;
const SUITE_CALLEE = /^describe(?:\.(?:only|skip|todo|concurrent|sequential|each|for|skipIf|runIf))*$/;
const MOCK_CALLEE = /^(?:vi|jest)\.(?:mock|doMock|fn|spyOn)$/;
/** `expect(x)`, `expect.soft(x)` and `expect.poll(fn)` start an assertion; `expect.assertions(n)` does not. */
const EXPECT_CALLEE = /^expect(?:\.(?:soft|poll))?$/;
const SNAPSHOT_MATCHER = /^(?:toMatch(?:Inline|File)?Snapshot|toThrowErrorMatching(?:Inline)?Snapshot)$/;
const MOCK_MATCHER = /^(?:toHaveBeen(?:Last|Nth)?Called(?:Once|With|Times|ExactlyOnceWith)?|toBeCalled(?:With|Times)?|toHave(?:Last|Nth)?(?:Returned|Resolved)(?:With|Times)?|lastCalledWith|nthCalledWith)$/;
const IDENTITY_MATCHER = /^(?:toBe|toEqual|toStrictEqual)$/;
/** Whitespace, block comments and line comments at the start of a file: the only place tags are read from. */
const LEADING_COMMENTS = /^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*)*/;
const LANES: readonly LaneName[] = ['edit', 'merge', 'scheduled', 'release'];

/** Parse only: no type information, no module resolution, no default library. */
const COMPILER_OPTIONS = { allowJs: true, noResolve: true, noLib: true, types: [], jsx: 'preserve' };

export function parseTags(text: string): ParsedFile['tags'] {
  const head = LEADING_COMMENTS.exec(text)?.[0] ?? '';
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

/**
 * The dotted name a call goes through, ignoring whitespace, line breaks and the arguments of curried calls:
 * `it\n  .skip`, `it.each(table)` and ``it.each`a | b` `` all name `it.skip` or `it.each`.
 */
function calleeName(node: Node): string {
  if (isIdentifier(node)) return node.text;
  if (isPropertyAccessExpression(node)) return `${calleeName(node.expression)}.${node.name.text}`;
  if (isCallExpression(node)) return calleeName(node.expression);
  if (isTaggedTemplateExpression(node)) return calleeName(node.tag);
  return node.getText().replace(/\s+/g, '');
}

/**
 * A test or suite declaration has a title and a body. In the curried forms `it.each(table)('name', fn)` and
 * `it.skipIf(cond)('name', fn)` the inner call has one argument, so only the outer call counts.
 */
function isDeclaration(call: CallExpression, name: string): boolean {
  return call.arguments.length >= 2 || (call.arguments.length === 1 && name.endsWith('.todo'));
}

/** The expect(...) call at the root of `expect(x).not.toBe(y)` style chains, or null. */
function expectRoot(callee: PropertyAccessExpression): CallExpression | null {
  let node: Node = callee.expression;
  while (isPropertyAccessExpression(node)) node = node.expression;
  if (isCallExpression(node) && EXPECT_CALLEE.test(calleeName(node.expression))) return node;
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
      const name = calleeName(callee);
      // require('x') and import('x') load code; vi.mock('x') and jest.mock('x') do not, so mocked modules are not imports.
      const specifier = node.arguments[0];
      if (specifier && isStringLiteral(specifier) && (callee.kind === SyntaxKind.ImportKeyword || (isIdentifier(callee) && callee.text === 'require'))) {
        out.imports.push(specifier.text);
      }
      if (TEST_CALLEE.test(name) && isDeclaration(node, name)) {
        const title = titleOf(node);
        next = { name: title, line: lineOf(node), assertions: 0, todo: name.endsWith('.todo') };
        out.tests.push(next);
        out.titles.push({ text: title, line: next.line });
      } else if (SUITE_CALLEE.test(name) && isDeclaration(node, name)) {
        out.titles.push({ text: titleOf(node), line: lineOf(node) });
      } else if (MOCK_CALLEE.test(name)) {
        out.mockCalls++;
      } else if (EXPECT_CALLEE.test(name)) {
        out.assertions++;
        if (current) current.assertions++;
      } else if (/^assert(?:\.\w+)?$/.test(name)) {
        out.assertions++;
        if (current) current.assertions++;
      } else if (isPropertyAccessExpression(callee)) {
        const root = expectRoot(callee);
        if (root) {
          const matcher = callee.name.text;
          if (SNAPSHOT_MATCHER.test(matcher)) out.snapshotAssertions++;
          if (MOCK_MATCHER.test(matcher)) out.mockAssertions++;
          // Only `expect(x).toBe(x)` itself: not `.not` or `.resolves`, and not a repeated call such as hash('a'), which checks determinism.
          if (IDENTITY_MATCHER.test(matcher) && isCallExpression(callee.expression) && root.arguments.length === 1 && node.arguments.length === 1) {
            const actual = root.arguments[0].getText();
            if (actual === node.arguments[0].getText() && !actual.includes('(')) out.tautologies++;
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

type VirtualFs = ReturnType<typeof createVirtualFileSystem>;
type WritableFs = VirtualFs & Required<Pick<VirtualFs, 'writeFile' | 'removeFile'>>;

/** The native process is restarted after this many files, so its memory stays bounded without relying on undocumented native cleanup. */
const RESTART_EVERY = 1000;

function startNative(): { fs: WritableFs; api: API } {
  const fs = createVirtualFileSystem({ '/agent-tests/session.json': '{}' });
  if (typeof fs.writeFile !== 'function' || typeof fs.removeFile !== 'function') {
    throw new Error('The TypeScript virtual filesystem no longer offers writeFile and removeFile; src/parse.ts needs updating for this TypeScript version');
  }
  return { fs: fs as WritableFs, api: new API({ cwd: '/agent-tests', fs }) };
}

/**
 * Open a parse session. Files are fed to the TypeScript 7 API through an in-memory filesystem, one tiny project per file.
 * Each file gets its own directory: reusing a path after its project was closed returned the old content. The previous
 * project is closed and its files removed on the next call, so the native side holds one project at a time.
 */
export function openParseSession(): ParseSession {
  let native = startNative();
  let count = 0;
  let previous: { config: string; source: string } | null = null;
  return {
    parse(fileName, rawText) {
      // The native side drops a leading byte order mark from the text but node positions still count it, so drop it here too.
      const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
      if (count >= RESTART_EVERY) {
        native.api.close();
        native = startNative();
        count = 0;
        previous = null;
      }
      const { api, fs } = native;
      const dir = `/agent-tests/${count++}`;
      const base = `source${extname(fileName) || '.ts'}`; // the extension picks TS, TSX, JS or JSX parsing
      const source = `${dir}/${base}`;
      const config = `${dir}/tsconfig.json`;
      fs.writeFile(source, text);
      fs.writeFile(config, JSON.stringify({ compilerOptions: COMPILER_OPTIONS, files: [base] }));
      const stale = previous;
      previous = { config, source };
      const snapshot = api.updateSnapshot({ openProjects: [config], closeProjects: stale ? [stale.config] : [] });
      try {
        const sourceFile = snapshot.getProject(config)?.program.getSourceFile(source);
        if (!sourceFile) throw new Error(`TypeScript could not parse ${fileName}`);
        return extractFacts(sourceFile, text);
      } finally {
        snapshot.dispose();
        if (stale) {
          fs.removeFile(stale.source);
          fs.removeFile(stale.config);
        }
      }
    },
    close() {
      native.api.close();
    },
  };
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const CODE_FILE = /\.[cm]?[jt]sx?$/;

/** Repo-relative non-test source files a test file imports through relative specifiers. */
export function resolveSubjects(root: string, testRel: string, imports: string[]): string[] {
  const dir = dirname(resolve(root, testRel));
  const found = new Set<string>();
  for (const spec of imports) {
    if (!spec.startsWith('.')) continue;
    const base = resolve(dir, spec);
    const stripped = base.replace(/\.[cm]?[jt]sx?$/, '');
    const candidates = [base, ...EXTENSIONS.map(ext => stripped + ext), ...EXTENSIONS.map(ext => resolve(base, `index${ext}`))];
    const hit = candidates.find(candidate => CODE_FILE.test(candidate) && existsSync(candidate) && statSync(candidate).isFile());
    if (!hit) continue;
    const rel = relPosix(root, hit);
    if (rel.startsWith('..') || isTestPath(rel) || isSupportPath(rel)) continue;
    found.add(rel);
  }
  return [...found].sort();
}
