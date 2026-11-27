import {
  NodeFlags, SyntaxKind, type BindingName, type CallExpression, type Node, type SourceFile,
  isArrayBindingPattern, isArrayLiteralExpression, isArrowFunction, isAsExpression, isAwaitExpression, isBinaryExpression, isCallExpression,
  isClassDeclaration, isClassExpression, isExportAssignment, isExportDeclaration, isFunctionDeclaration, isFunctionExpression,
  isFunctionLikeDeclaration, isIdentifier, isImportDeclaration, isNamedExports, isNamedImports, isNamespaceImport,
  isNewExpression, isNoSubstitutionTemplateLiteral, isNonNullExpression, isNumericLiteral, isObjectBindingPattern,
  isObjectLiteralExpression, isParameterDeclaration, isParenthesizedExpression, isPrefixUnaryExpression, isPropertyAccessExpression,
  isPropertyAssignment, isSpreadAssignment, isComputedPropertyName, isReturnStatement, isSatisfiesExpression, isShorthandPropertyAssignment, isStringLiteral,
  isVariableDeclaration, isVariableStatement,
} from 'typescript/unstable/ast';
import type { Finding } from '../schema.ts';

type Imported = { module: string; name: string };
type Binding = { fixtureProvider?: Node; value?: Node; member?: string; imported?: Imported };

const token = (n?: Node) => n && (isIdentifier(n) || isStringLiteral(n) || isNoSubstitutionTemplateLiteral(n) || isNumericLiteral(n)) ? n.text : undefined;
const literal = (n: Node) => isStringLiteral(n) || isNoSubstitutionTemplateLiteral(n) || isNumericLiteral(n) ? n.text : undefined;
function unwrap(n: Node): Node {
  while (isAsExpression(n) || isParenthesizedExpression(n) || isNonNullExpression(n) || isSatisfiesExpression(n)) n = n.expression;
  return n;
}

function outsideWrappers(n: Node): Node {
  while (n.parent && unwrap(n.parent) === unwrap(n)) n = n.parent;
  return n;
}

const isScope = (n: Node) => isFunctionLikeDeclaration(n) || [SyntaxKind.SourceFile, SyntaxKind.ModuleBlock, SyntaxKind.Block, SyntaxKind.CatchClause, SyntaxKind.CaseBlock,
  SyntaxKind.ClassDeclaration, SyntaxKind.ClassExpression, SyntaxKind.ForStatement, SyntaxKind.ForInStatement, SyntaxKind.ForOfStatement].includes(n.kind);

/** Index all bindings before examining uses, so a later declaration shadows the entire lexical scope. */
function bindings(source: SourceFile) {
  const scopes = new Map<Node, Map<string, Binding>>();
  function bind(scope: Node, name: BindingName, binding: Binding) {
    if (isIdentifier(name)) {
      let names = scopes.get(scope);
      if (!names) scopes.set(scope, names = new Map());
      names.set(name.text, binding);
    } else if (isObjectBindingPattern(name) || isArrayBindingPattern(name)) {
      for (const e of name.elements) if ('name' in e && e.name) {
        const member = isObjectBindingPattern(name) && !e.dotDotDotToken && !e.initializer ? token(e.propertyName ?? e.name) : undefined;
        bind(scope, e.name, member && !binding.member ? { value: binding.value, member, fixtureProvider: binding.fixtureProvider } : {});
      }
    }
  }
  function visit(n: Node, parentScope: Node) {
    const scope = isScope(n) ? n : parentScope;
    if (isFunctionDeclaration(n) || isClassDeclaration(n)) {
      if (n.name) bind(parentScope, n.name, { value: n });
    } else if (isFunctionExpression(n) || isClassExpression(n)) {
      if (n.name) bind(scope, n.name, {});
    } else if (isImportDeclaration(n) && n.importClause && isStringLiteral(n.moduleSpecifier)) {
      const clause = n.importClause;
      const module = n.moduleSpecifier.text.replace(/^node:/, '');
      const add = (name: BindingName, imported: string, typeOnly = false) =>
        bind(scope, name, clause.phaseModifier === SyntaxKind.TypeKeyword || typeOnly ? {} : { imported: { module, name: imported } });
      if (clause.name) add(clause.name, '*');
      if (clause.namedBindings && isNamespaceImport(clause.namedBindings)) add(clause.namedBindings.name, '*');
      if (clause.namedBindings && isNamedImports(clause.namedBindings))
        for (const e of clause.namedBindings.elements) add(e.name, (e.propertyName ?? e.name).text, e.isTypeOnly);
    } else if (isParameterDeclaration(n)) {
      const parent = n.parent.parent;
      const fixtureProvider = isCallExpression(parent) && isObjectBindingPattern(n.name) ? parent.expression : undefined;
      bind(scope, n.name, { fixtureProvider });
    } else if (isVariableDeclaration(n)) {
      let owner = scope;
      if (n.parent.kind === SyntaxKind.VariableDeclarationList && !(n.parent.flags & NodeFlags.BlockScoped)) {
        while (owner !== source && owner.kind !== SyntaxKind.ModuleBlock && !isFunctionLikeDeclaration(owner)) owner = owner.parent;
      }
      bind(owner, n.name, n.parent.flags & NodeFlags.Const ? { value: n.initializer } : {});
    }
    n.forEachChild(c => visit(c, scope));
  }
  visit(source, source);
  return (n: Node): Binding | undefined => {
    if (!isIdentifier(n)) return;
    for (let scope: Node | undefined = n.parent; scope; scope = scope.parent) {
      const binding = scopes.get(scope)?.get(n.text);
      if (binding) return binding;
      if (scope === source) break;
    }
  };
}

const readPath = new Set('access exists stat lstat statfs realpath readFile readdir readlink opendir watch watchFile unwatchFile createReadStream openAsBlob'.split(' '));
const writePath = new Set('writeFile appendFile mkdir unlink rm rmdir truncate chmod chown lchmod lchown utimes lutimes createWriteStream'.split(' '));
const twoPaths = new Set(['copyFile', 'cp', 'link', 'symlink', 'rename']);
const processCalls = new Set(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']);
const localURL = /^(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{4,5}(?=[/?#]|$)/i;
const portNumber = /^\d{4,5}$/;
const absolutePath = /^(?:[a-z]:[\\/]|\/(?:home|Users)\/)/i;
const sharedTemp = /^\/tmp\/[^$]*$/;
const isExported = (n: { modifiers?: readonly Node[] }) => n.modifiers?.some(m => m.kind === SyntaxKind.ExportKeyword) === true;

function property(n: Node | undefined, key: string): Node | undefined {
  if (!n || !isObjectLiteralExpression(n)) return;
  for (const p of [...n.properties].reverse()) {
    // A later spread or dynamic key can replace any earlier value.
    if (isSpreadAssignment(p) || (p.name && isComputedPropertyName(p.name))) return;
    if (isPropertyAssignment(p) && token(p.name) === key) return p.initializer;
    if (isShorthandPropertyAssignment(p) && token(p.name) === key) return p.name;
    if (token(p.name) === key) return;
  }
}

/** An exists call directly inside a negative assertion checks absence, even beside another use on the same line. */
function checksAbsence(call: CallExpression): boolean {
  const expression = outsideWrappers(call), p = expression.parent;
  if (isPrefixUnaryExpression(p) && p.operator === SyntaxKind.ExclamationToken && isCallExpression(p.parent))
    return /^(?:assert|assert\.ok)$/.test(p.parent.expression.getText()) && p.parent.arguments[0] === p;
  if (!isCallExpression(p) || p.arguments[0] !== expression) return false;
  if (/^assert\.(?:strictEqual|equal)$/.test(p.expression.getText())) return p.arguments[1]?.kind === SyntaxKind.FalseKeyword;
  if (p.expression.getText() !== 'expect') return false;
  let method = outsideWrappers(p).parent;
  if (!isPropertyAccessExpression(method)) return false;
  const negated = method.name.text === 'not';
  if (negated) method = method.parent;
  if (!isPropertyAccessExpression(method) || !isCallExpression(method.parent)) return false;
  return method.name.text === (negated ? 'toBeTruthy' : 'toBeFalsy') ||
    (method.name.text === 'toBe' && method.parent.arguments[0]?.kind === (negated ? SyntaxKind.TrueKeyword : SyntaxKind.FalseKeyword));
}

export function resourceUses(source: SourceFile, file: string, text: string, lineAt: (pos: number) => number): Finding[] {
  const lookup = bindings(source);
  const found = new Map<string, Finding>();
  const lines = text.split(/\r?\n/);
  const playwright = /^playwright(?:\.[\w-]+)*\.config\.[cm]?[jt]s$/.test(file);
  // The argument, its containing options, and its filename share one immutable-binding hop.
  function trace(n: Node, hops: number) {
    n = unwrap(n);
    const b = lookup(n);
    if (hops && b?.value && !b.member && b.value.end <= n.pos) return { node: unwrap(b.value), hops: hops - 1 };
    return { node: n, hops };
  }
  function memberOf(base: Imported | undefined, key: string): Imported | undefined {
    if (base?.name === '*') return { module: base.module, name: key };
    if (base?.module === 'fs' && base.name === 'promises') return { module: 'fs/promises', name: key };
  }
  function required(n: Node): Imported | undefined {
    if (isPropertyAccessExpression(n)) return memberOf(required(n.expression), n.name.text);
    if (isCallExpression(n) && isIdentifier(n.expression) && n.expression.text === 'require' && !lookup(n.expression) &&
        n.arguments.length === 1 && isStringLiteral(n.arguments[0])) return { module: n.arguments[0].text.replace(/^node:/, ''), name: '*' };
  }
  function api(n: Node): Imported | undefined {
    if (isPropertyAccessExpression(n)) return memberOf(api(n.expression), n.name.text);
    if (!isIdentifier(n)) return required(n);
    const b = lookup(n);
    if (b?.imported) return b.imported;
    if (!b?.value || b.value.end > n.pos) return;
    const base = required(b.value);
    return b.member ? memberOf(base, b.member) : base;
  }
  function fixtureOwner(binding: Binding | undefined, names: readonly string[]): boolean {
    if (!binding?.fixtureProvider || !binding.member || !names.includes(binding.member)) return false;
    let provider = binding.fixtureProvider;
    if (isPropertyAccessExpression(provider) && ['only','skip','beforeEach','afterEach','beforeAll','afterAll'].includes(provider.name.text))
      provider = provider.expression;
    const target = api(provider);
    if (target) return target.module === '@playwright/test' && target.name === 'test';
    return isIdentifier(provider) && ['test','it'].includes(provider.text) && !lookup(provider);
  }
  function browserOwner(n: Node, hops: number): boolean {
    const binding = lookup(n);
    if (!binding && isIdentifier(n)) return ['browser', 'context'].includes(n.text);
    if (fixtureOwner(binding, ['browser', 'context'])) return true;
    const resolved = trace(n, hops);
    let maker = resolved.node;
    if (isAwaitExpression(maker)) maker = maker.expression;
    if (!isCallExpression(maker) || !isPropertyAccessExpression(maker.expression)) return false;
    const {expression: owner, name} = maker.expression;
    if (name.text === 'newContext') return browserOwner(owner, resolved.hops);
    const browser = api(owner);
    return name.text === 'launch' && !!browser && ['playwright', 'playwright-core', '@playwright/test'].includes(browser.module) &&
      ['chromium', 'firefox', 'webkit'].includes(browser.name);
  }
  function endpointOwner(receiver: Node, role: 'page' | 'server'): boolean {
    const binding = lookup(receiver);
    if (!binding && isIdentifier(receiver)) return receiver.text === role;
    // Playwright injects its page via destructured test and hook parameters, including renamed bindings.
    if (role === 'page' && fixtureOwner(binding, ['page'])) return true;
    let origin = trace(receiver, 1).node;
    if (isAwaitExpression(origin)) origin = origin.expression;
    if (!isCallExpression(origin) && !isNewExpression(origin)) return false;
    if (role === 'page') return isPropertyAccessExpression(origin.expression) && origin.expression.name.text === 'newPage' && browserOwner(origin.expression.expression, 1);
    const maker = api(origin.expression);
    return !!maker && ['http','https','http2','net','tls'].includes(maker.module) &&
      ['createServer','createSecureServer','Server'].includes(maker.name);
  }
  function commonJSExport(n: Node): boolean {
    if (!isPropertyAccessExpression(n)) return false;
    const object = n.expression;
    if (isIdentifier(object) && !lookup(object)) return object.text === 'exports' || (object.text === 'module' && n.name.text === 'exports');
    return isPropertyAccessExpression(object) && object.name.text === 'exports' &&
      isIdentifier(object.expression) && object.expression.text === 'module' && !lookup(object.expression);
  }
  const namedHelperExports = new Set<Node>();
  for (const statement of source.statements) {
    if (!isExportDeclaration(statement) || statement.isTypeOnly || statement.moduleSpecifier ||
        !statement.exportClause || !isNamedExports(statement.exportClause)) continue;
    for (const e of statement.exportClause.elements) {
      const helper = lookup(e.propertyName ?? e.name)?.value;
      if (!e.isTypeOnly && helper) namedHelperExports.add(unwrap(helper));
    }
  }
  function exportedHelper(n: Node): boolean {
    if (namedHelperExports.has(n)) return true;
    if (isFunctionDeclaration(n)) return isExported(n);
    if (!isArrowFunction(n) && !isFunctionExpression(n)) return false;
    if (isExportAssignment(n.parent)) return true;
    if (isBinaryExpression(n.parent) && n.parent.operatorToken.kind === SyntaxKind.EqualsToken && n.parent.right === n) return commonJSExport(n.parent.left);
    const d = n.parent;
    return isVariableDeclaration(d) && isVariableStatement(d.parent.parent) && isExported(d.parent.parent);
  }
  function emit(rule: string, origin: Node, use: Node, message: string, possible = false) {
    const pos = origin.getStart(), line = lineAt(pos), useLine = lineAt(use.getStart());
    const key = rule + ':' + line;
    const prior = found.get(key);
    if (prior && (possible || !prior.confidence)) return;
    const raw = lines[line - 1] ?? '';
    const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
    const start = Math.max(0, Math.min(raw.length - 160, pos - lineStart - 50));
    found.set(key, { category: 'worktree', rule, file, line, evidence: raw.slice(start, start + 160).trim(),
      message: message + (line !== useLine ? ` See line ${useLine}.` : ''), ...(possible ? { confidence: 'possible' } : {}) });
  }
  function pathAt(arg: Node | undefined, use: Node, role: string, possible = false, hops = 1) {
    if (!arg) return;
    const traced = trace(arg, hops);
    let origin = traced.node;
    let path = literal(origin);
    let rule: string;
    if (path !== undefined && absolutePath.test(path)) rule = 'worktree.absolute-path';
    else if (path !== undefined && sharedTemp.test(path)) rule = 'worktree.shared-tmp';
    else {
      if (!isCallExpression(origin) || origin.arguments.length !== 2) return;
      const join = api(origin.expression), [dir, name] = origin.arguments;
      if (join?.module !== 'path' || join.name !== 'join' || !isCallExpression(dir)) return;
      const tmp = api(dir.expression);
      origin = trace(name, traced.hops).node;
      path = literal(origin);
      if (tmp?.module !== 'os' || tmp.name !== 'tmpdir' || dir.arguments.length || !path || /[-_$]$|\$/.test(path)) return;
      rule = 'worktree.shared-tmp';
    }
    const kind = rule === 'worktree.shared-tmp' ? 'shared temp path' : 'machine-specific path';
    emit(rule, origin, use, `${role} (${kind}).`, possible);
  }
  function endpoint(arg: Node | undefined, use: Node, role: 'listener' | 'client' | 'server', port: boolean, hops = 1) {
    if (!arg) return;
    const origin = trace(arg, hops).node, s = literal(origin);
    if (!s || !(port ? portNumber : localURL).test(s)) return;
    const message = role === 'listener' ? 'Listener binds a fixed port; concurrent runs may collide.' :
      role === 'server' ? 'Server configuration requires a fixed endpoint.' : 'Client depends on a fixed endpoint.';
    emit('worktree.fixed-port', origin, use, message);
  }
  function config(n: Node) {
    let root = trace(n, 1);
    if (isCallExpression(root.node)) {
      const helper = api(root.node.expression);
      if (helper?.module !== '@playwright/test' || helper.name !== 'defineConfig' || !root.node.arguments[0]) return;
      root = trace(root.node.arguments[0], root.hops);
    }
    function endpointField(section: Node, key: string, role: 'client' | 'server', hops: number) {
      const field = property(section, key);
      if (field) endpoint(field, field.parent, role, key === 'port', hops);
    }
    const use = property(root.node, 'use'), server = property(root.node, 'webServer');
    if (use) {
      const resolved = trace(use, root.hops);
      endpointField(resolved.node, 'baseURL', 'client', resolved.hops);
    }
    if (server) {
      const resolved = trace(server, root.hops);
      const sections = isArrayLiteralExpression(resolved.node) ? resolved.node.elements.map(e => trace(e, resolved.hops)) : [resolved];
      for (const section of sections) {
        endpointField(section.node, 'port', 'server', section.hops);
        endpointField(section.node, 'url', 'server', section.hops);
      }
    }
  }
  function visit(n: Node) {
    if (isCallExpression(n)) {
      const callee = n.expression, [first, second] = n.arguments;
      const target = api(callee);
      if (target?.module === 'fs' || target?.module === 'fs/promises') {
        const method = target.name.replace(/Sync$/, '');
        if (twoPaths.has(method)) {
          pathAt(first, n, target.name + ' uses the source path'); pathAt(second, n, target.name + ' writes the destination');
        } else if (writePath.has(method)) pathAt(first, n, target.name + ' writes the path');
        else if (method === 'open') pathAt(first, n, target.name + ' opens the path');
        else if (readPath.has(method) && !(method === 'exists' && checksAbsence(n))) pathAt(first, n, target.name + ' reads the path');
      } else if (target?.module === 'child_process' && processCalls.has(target.name)) {
        const options = n.arguments.slice(1, /^(?:exec|execSync)$/.test(target.name) ? 2 : 3).map(a => trace(a, 1)).find(o => isObjectLiteralExpression(o.node));
        if (options) pathAt(property(options.node, 'cwd'), n, target.name + ' uses this working directory', false, options.hops);
      } else if (isPropertyAccessExpression(callee) && callee.name.text === 'listen' && first && endpointOwner(callee.expression, 'server')) {
        const arg = trace(first, 1);
        endpoint(isObjectLiteralExpression(arg.node) ? property(arg.node, 'port') : arg.node, n, 'listener', true, arg.hops);
      } else if ((isIdentifier(callee) && callee.text === 'fetch' && !lookup(callee)) ||
          (isPropertyAccessExpression(callee) && callee.name.text === 'goto' && endpointOwner(callee.expression, 'page')) ||
          (target && ['http', 'https'].includes(target.module) && ['get', 'request'].includes(target.name))) endpoint(first, n, 'client', false);
    } else if (isNewExpression(n) && isIdentifier(n.expression) && n.expression.text === 'WebSocket' && !lookup(n.expression))
      endpoint(n.arguments?.[0], n, 'client', false);
    else if (isVariableStatement(n) && isExported(n)) {
      for (const d of n.declarationList.declarations) if (d.initializer) pathAt(d.initializer, n, 'Possible path use: exported value has an unknown consumer', true);
    } else if (isExportAssignment(n)) {
      pathAt(n.expression, n, 'Possible path use: exported value has an unknown consumer', true);
      if (playwright) config(n.expression);
    } else if (isExportDeclaration(n) && !n.isTypeOnly && !n.moduleSpecifier && n.exportClause && isNamedExports(n.exportClause)) {
      for (const e of n.exportClause.elements) if (!e.isTypeOnly) {
        const local = e.propertyName ?? e.name;
        pathAt(local, n, 'Possible path use: exported value has an unknown consumer', true);
        if (playwright && e.name.text === 'default') config(local);
      }
    } else if (isBinaryExpression(n) && n.operatorToken.kind === SyntaxKind.EqualsToken && commonJSExport(n.left)) {
      pathAt(n.right, n, 'Possible path use: exported value has an unknown consumer', true);
      if (playwright && n.left.getText() === 'module.exports') config(n.right);
    } else if (isArrowFunction(n) && n.body.kind !== SyntaxKind.Block && exportedHelper(n)) {
      pathAt(n.body, n, 'Possible path use: exported helper returns it to an unknown consumer', true);
    } else if (isReturnStatement(n) && n.expression) {
      let owner = n.parent;
      while (owner !== source && !isFunctionLikeDeclaration(owner)) owner = owner.parent;
      if (exportedHelper(owner)) pathAt(n.expression, n, 'Possible path use: exported helper returns it to an unknown consumer', true);
    }
    n.forEachChild(visit);
  }
  visit(source);
  return [...found.values()].sort((a,b) => a.line! - b.line!);
}
