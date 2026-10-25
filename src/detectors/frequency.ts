import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Finding, RiskMap } from '../schema.ts';

const PM_TEST = /^(?:npm|pnpm|yarn|bun)\s+(?:(?:run|-r|--recursive|-s|--silent|--if-present|--filter(?:=|\s+)\S+|-F\s+\S+)\s+)*(?:test|t)\b/;
const TEST_TOOLS = new Set(['vitest', 'jest', 'pytest']);
const TOOL_WRAPPERS = new Set(['cross-env', 'env', 'npx', 'pnpm', 'exec', 'yarn', 'bunx', 'bun', 'npm', 'run', 'dlx', 'x', 'uv', 'poetry', 'pipenv', 'then', 'do', 'else', 'time', 'nohup']);
const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=/;
const SCOPED = /--changed|--related|\brelated\b|--findRelatedTests|--onlyChanged|--affected|\baffected\b|\{staged_files\}|\{push_files\}|\$\{?FILES\b|\$@|\[HEAD/;
const HOOK_FILES = ['.husky/pre-commit', '.husky/pre-push', '.husky/pre-merge-commit', '.githooks/pre-commit', '.githooks/pre-push'];
const LEFTHOOK_FILES = ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.config/lefthook.yml'];
const HOOK_SCRIPTS = ['pretest', 'precommit', 'pre-commit', 'prepush', 'pre-push'];
const AGENT_DOCS = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md', '.cursorrules'];
const AGENT_RUN_ALL =
  /\b(?:run|execute)\s+(?:all|every|the\s+(?:full|entire|whole))\s+(?:test\s+suites?|tests?|suites?)\b|\balways\s+run\s+(?:the\s+)?tests?\b(?!\s+(?:that|related|affected|covering|for)\b)/gi;
const AGENT_NEGATION = /\bnot\b|n['’]t\b|\bnever\b|\bavoid\b|\bonly\b/i;
const AGENT_MERGE_GATE = /^(?:\s+\w+){0,2}\s*,?\s*(?:before|prior\s+to)\s+(?:you\s+)?(?:opening|open|creating|create|raising|submitting|merg\w*|push\w*|a\s+pr\b|the\s+pr\b|a\s+pull|releas\w*|shipping)/i;
const EXPENSIVE_OS = /^(?:macos|windows)/i;
const NOT_WATCH_COMMANDS = new Set(['run', 'related', 'bench', 'list', 'typecheck', 'init']);
const LAUNCHERS = new Set(['cross-env', 'env', 'npx', 'pnpm', 'exec', 'yarn', 'bunx', 'bun', 'npm', 'run', 'dlx', 'x']);
const CHANGES_DIRECTORY = /^\s*(?:cd|pushd|popd|Set-Location|Push-Location|Pop-Location)\b/i;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).filter((entry): entry is string => typeof entry === 'string');

/** The text of a regular file, or null when it is missing, a directory, unreadable or otherwise odd. */
function readText(path: string): string | null {
  try {
    return statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

function phaseAdvice(map: RiskMap | null): string {
  if (!map) return '';
  if (map.phase === 'dev') {
    return ' In the dev phase, subject to current owner policy and required checks, consider one non-blocking Linux job on pull_request (drafts skipped, newer runs cancelled), and workflow_dispatch, a weekly schedule and release tags for optional OS coverage.';
  }
  return '';
}

const CONFIGURED_CI = ' Configured workflows do not prove Actions is enabled or that jobs executed; charges are unmeasured.';

function platformAdvice(map: RiskMap | null): string {
  const declared = map ? (['merge', 'release'] as const).flatMap(lane => {
    const os = map.lanes[lane].os;
    return os?.length ? [`${lane}: ${os.join(', ')}`] : [];
  }) : [];
  const context = declared.length ? ` Preserve declared platform acceptance (${declared.join('; ')}).` : '';
  return `${context} ${map?.phase === 'production' ? 'Preserve production acceptance; establish platform obligations before pruning.' : 'Other platform obligations are unknown; review runner fanout before moving optional coverage to slower lanes.'}${phaseAdvice(map)}${CONFIGURED_CI}`;
}

function triggersOf(workflow: Record<string, unknown>): Record<string, unknown> {
  const on = workflow.on ?? workflow['true'];
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map(name => [String(name), null]));
  if (isRecord(on)) return on;
  return {};
}

/** True when one command starts a test run: a package-manager test script, or a test tool at command position. */
function runsTestTool(part: string): boolean {
  const tokens = part.split(/\s+/).filter(Boolean);
  let position = 0;
  while (position < tokens.length && (ENV_ASSIGNMENT.test(tokens[position] ?? '') || tokens[position] === 'cross-env' || tokens[position] === 'env')) position++;
  if (PM_TEST.test(tokens.slice(position).join(' '))) return true;
  while (position < tokens.length) {
    const token = tokens[position] ?? '';
    if (!TOOL_WRAPPERS.has(token) && !token.startsWith('-') && !ENV_ASSIGNMENT.test(token)) break;
    position++;
  }
  const name = (value: string | undefined): string => (value ?? '').replace(/^.*[\\/]/, '').replace(/\.cmd$/, '');
  const command = name(tokens[position]);
  return TEST_TOOLS.has(/^(?:python3?|py)$/.test(command) && tokens[position + 1] === '-m' ? name(tokens[position + 2]) : command);
}

/** True when a hook command runs the whole suite: any `&&`, `||` or `;` part that runs tests, is not scoped and is not an echo. */
function runsWholeSuite(raw: string): boolean {
  const line = raw.replace(/(^|\s)#.*$/, '$1');
  return line.split(/&&|\|\||;/).some(part => {
    const command = part.trim();
    return command !== '' && !/^(?:echo|printf)\b/.test(command) && runsTestTool(command) && !SCOPED.test(command);
  });
}

/** Only local, literal package script calls. Cross-package flags and arbitrary JS/shell wrappers stay unresolved. */
function localScriptCall(command: string): string | null {
  const match = /^(npm|pnpm|yarn|bun)\s+(?:(run|run-script)\s+)?([\w:.-]+)(?:\s|$)/.exec(command);
  if (!match || (!match[2] && match[1] === 'npm' && !['test', 't'].includes(match[3]!))) return null;
  if (!match[2] && (['exec', 'dlx', 'x'].includes(match[3]!) || (match[1] === 'bun' && match[3] === 'test'))) return null;
  return !match[2] && match[1] === 'npm' && match[3] === 't' ? 'test' : match[3]!;
}

/** Split simple shell command lists without inventing commands inside quoted arguments. */
function literalCommands(script: string): string[] {
  const commands: string[] = [];
  let quote = '';
  let start = 0;
  for (let index = 0; index < script.length; index++) {
    const char = script[index];
    if (char === '\\' && quote !== "'") { index++; continue; }
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#' && (index === start || /\s/.test(script[index - 1]!))) {
      commands.push(script.slice(start, index));
      while (index < script.length && script[index] !== '\n') index++;
      start = index + 1;
      continue;
    }
    const pair = (char === '&' || char === '|') && script[index + 1] === char;
    if (char !== ';' && char !== '\n' && !pair) continue;
    commands.push(script.slice(start, index));
    if (pair) index++;
    start = index + 1;
  }
  if (quote) return []; // Incomplete quoting is not a statically understood command list.
  commands.push(script.slice(start));
  return commands;
}

/** Unknown positional filters, selectors and option values cannot establish a full-suite run. */
const LITERAL_FULL_SUITE = /^(?:(?:npx|(?:npm|pnpm|yarn) exec|bunx|bun x)\s+)?(?:vitest(?:\s+run)?|jest|pytest|bun test)(?:\s+(?:--run|--ci|--runInBand|--coverage|--no-watch|--watch=false))*\s*$/;

/** Find a statically visible full-suite gate, keeping the script path for review and stopping on cycles. */
function buildSuiteTrace(scripts: Record<string, unknown>, name: string, chain: string[] = []): string | null {
  const script = scripts[name];
  if (typeof script !== 'string' || chain.includes(name)) return null;
  const path = [...chain, name];
  for (const part of literalCommands(script)) {
    const command = part.trim();
    if (CHANGES_DIRECTORY.test(command)) return null;
    if (SCOPED.test(command) || /(?:^|\s)--(?:prefix|workspace|workspaces|cwd|dir|filter)(?:=|\s|$)|(?:^|\s)-[wCF](?:\s|$)/.test(command)) continue;
    if (/\.(?:test|spec)\.[cm]?[jt]sx?\b|(?:^|\s)(?:src|tests?|__tests__)[/\\]|[`]|\$[({]/.test(command)) continue;
    const called = localScriptCall(command);
    if (called) {
      // Forwarded arguments may narrow a script's test scope; do not drop them when following its body.
      if (!/^(?:npm|pnpm|yarn|bun)\s+(?:(?:run|run-script)\s+)?[\w:.-]+\s*$/.test(command)) continue;
      const trace = buildSuiteTrace(scripts, called, path);
      if (trace) return trace;
    } else if (LITERAL_FULL_SUITE.test(command)) {
      return `${path.join(' -> ')}: ${command}`;
    }
  }
  return null;
}

// Positive, literal signals only. Ordinary upload-artifact, names and comments do not establish publication.
const PUBLICATION_ACTION = /^(?:actions\/(?:deploy-pages|upload-pages-artifact|upload-release-asset)|softprops\/action-gh-release|ncipollo\/release-action)@[^\s]+$/;
const PUBLICATION_COMMAND = /^(?:(?:npm|pnpm|yarn|bun)\s+publish|gh\s+release\s+(?:create|upload)|(?:npx\s+)?wrangler\s+pages\s+deploy)(?=\s|$)/;
const NONPUBLISHING_ARGUMENT = /(?:^|\s)["']?(?:--dry-run(?:=(?:true|1))?|--help|-h|--version)["']?(?=\s|$)/;

function publicationTrace(scripts: Record<string, unknown>, raw: string, chain: string[] = []): string | null {
  for (const part of literalCommands(raw)) {
    const command = part.trim();
    if (CHANGES_DIRECTORY.test(command)) return null;
    if (/[`$]/.test(command)) continue;
    if (PUBLICATION_COMMAND.test(command) && !NONPUBLISHING_ARGUMENT.test(command)) return [...chain, command].join(' -> ');
    const called = localScriptCall(command);
    if (!called || chain.includes(called) || typeof scripts[called] !== 'string') continue;
    if (!/^(?:npm|pnpm|yarn|bun)\s+(?:(?:run|run-script)\s+)?[\w:.-]+\s*$/.test(command)) continue;
    const trace = publicationTrace(scripts, scripts[called], [...chain, called]);
    if (trace) return trace;
  }
  return null;
}

/** Unknown coverage is worth reporting only for a visible test command or test-named script, not every build wrapper. */
function unknownValidation(raw: string): boolean {
  return literalCommands(raw).some(part => {
    const command = part.trim();
    const script = localScriptCall(command);
    return runsTestTool(command) || (script !== null && /^test(?:$|[:.-])/.test(script));
  });
}

/** Join lines that end in a backslash with the next one; each result keeps the number of its first physical line. */
function joinContinuations(entries: Array<{ line: number; command: string }>): Array<{ line: number; command: string }> {
  const joined: Array<{ line: number; command: string }> = [];
  let carry: { line: number; command: string; last: number } | null = null;
  for (const entry of entries) {
    if (carry && entry.line !== carry.last + 1) {
      joined.push({ line: carry.line, command: carry.command });
      carry = null;
    }
    const merged: { line: number; command: string; last: number } = carry
      ? { line: carry.line, command: `${carry.command} ${entry.command.trim()}`, last: entry.line }
      : { line: entry.line, command: entry.command, last: entry.line };
    if (/\\\s*$/.test(merged.command)) {
      carry = { ...merged, command: merged.command.replace(/\\\s*$/, '') };
    } else {
      joined.push({ line: merged.line, command: merged.command });
      carry = null;
    }
  }
  if (carry) joined.push({ line: carry.line, command: carry.command });
  return joined;
}

/** The `run:` values of a lefthook file, with their line numbers; a block scalar yields one entry per line. */
function lefthookCommands(text: string): Array<{ line: number; command: string }> {
  const lines = text.split(/\r?\n/);
  const found: Array<{ line: number; command: string }> = [];
  for (let index = 0; index < lines.length; index++) {
    const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[index] ?? '');
    if (!match) continue;
    const indent = (match[1] ?? '').length;
    const value = (match[2] ?? '').trim();
    if (/^[|>][+-]?\s*(?:#.*)?$/.test(value)) {
      for (let next = index + 1; next < lines.length; next++) {
        const body = lines[next] ?? '';
        if (body.trim() !== '' && (/^\s*/.exec(body)?.[0].length ?? 0) <= indent) break;
        found.push({ line: next + 1, command: body });
        index = next;
      }
    } else {
      found.push({ line: index + 1, command: /^(["'])(.*)\1\s*(?:#.*)?$/.exec(value)?.[2] ?? value });
    }
  }
  return found;
}

/** True when one command of a test script starts the runner in watch mode when nothing says otherwise. */
function startsWatchMode(segment: string): boolean {
  const tokens = segment.split(/\s+/).filter(Boolean);
  let watchOn = false;
  let watchOff = false;
  tokens.forEach((token, index) => {
    const flag = /^--(?:watch|watchAll)(?:=(.*))?$/.exec(token);
    if (flag) {
      const next = tokens[index + 1];
      const value = flag[1] ?? (next === 'true' || next === 'false' ? next : 'true');
      if (value === 'false') watchOff = true;
      else watchOn = true;
    } else if (token === '--no-watch') {
      watchOff = true;
    }
  });
  if (watchOn) return true;
  if (watchOff) return false;

  let position = 0;
  let ciSet = false;
  for (; position < tokens.length; position++) {
    const token = tokens[position] ?? '';
    const assignment = /^([A-Za-z_]\w*)=(.*)$/.exec(token);
    if (assignment) {
      if (assignment[1] === 'CI' && assignment[2] !== 'false') ciSet = true;
    } else if (!LAUNCHERS.has(token) && !token.startsWith('-')) {
      break;
    }
  }
  const command = (tokens[position] ?? '').replace(/^.*[\\/]/, '').replace(/\.cmd$/, '');
  if (command !== 'vitest' || ciSet) return false;
  return !tokens.slice(position + 1).some(token => NOT_WATCH_COMMANDS.has(token) || /^--run(?:=true)?$/.test(token));
}

/**
 * Windows or macOS runners a job uses: `all` covers a literal `runs-on`, `matrix.os` and `matrix.include`;
 * `matrix` is the part that comes from a real matrix. Self-hosted jobs are ignored.
 */
function expensiveRunnersOf(job: Record<string, unknown>): { all: string[]; matrix: string[] } {
  const runsOn = job['runs-on'];
  const labels = isRecord(runsOn) ? asStrings(runsOn.labels) : asStrings(runsOn);
  if (labels.some(label => /^self-hosted$/i.test(label))) return { all: [], matrix: [] };
  const strategy = isRecord(job.strategy) ? job.strategy : {};
  const matrix = isRecord(strategy.matrix) ? strategy.matrix : {};
  const include = Array.isArray(matrix.include) ? matrix.include.flatMap(entry => (isRecord(entry) ? asStrings(entry.os) : [])) : [];
  const expensive = (entries: string[]): string[] => [...new Set(entries.filter(entry => EXPENSIVE_OS.test(entry)))];
  return { all: expensive([...asStrings(matrix.os), ...include, ...labels]), matrix: expensive([...asStrings(matrix.os), ...include]) };
}

/** Condition fragments that cannot hold on a pull request: another event, a tag ref, or a dispatch input. */
const NOT_PULL_REQUEST = [
  /github\.event_name\s*(?:!=\s*['"]pull_request['"]|==\s*['"](?:push|schedule|workflow_dispatch|release)['"])/,
  /(?<!!\s*)startsWith\(\s*github\.ref\s*,\s*['"]refs\/tags\//,
  /github\.ref_type\s*==\s*['"]tag['"]/,
  /\binputs\./,
];

/**
 * False when a job's `if:` keeps it off pull requests: it has no positive `github.event_name == 'pull_request'` and
 * every `||` clause of it holds only for another event, a tag ref or a dispatch input. A clause that says
 * nothing of those (a draft check, a branch ref) can still hold on a pull request.
 */
function runsOnPullRequest(job: Record<string, unknown>): boolean {
  const condition = job.if;
  if (typeof condition !== 'string') return true;
  if (/github\.event_name\s*==\s*['"]pull_request['"]/.test(condition)) return true;
  return condition.split('||').some(clause => !NOT_PULL_REQUEST.some(marker => marker.test(clause)));
}

/** Each OR alternative must start with a literal constraint excluding branch push; unsupported forms stay possible. */
function mayRunOnBranchPush(owner: Record<string, unknown>): boolean {
  if (owner.if === false) return false;
  if (typeof owner.if !== 'string') return true;
  const raw = owner.if.trim();
  const condition = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(raw)?.[1] ?? raw;
  return condition.split('||').some(alternative => {
    // Only a leading conjunction constraint is understood, never fragments inside arbitrary functions or strings.
    const clause = alternative.split('&&')[0]!.trim();
    const event = /^github\.event_name\s*(==|!=)\s*(['"])([^'"]+)\2$/.exec(clause);
    if (event) {
      const isPush = event[3]!.toLowerCase() === 'push';
      return event[1] === '==' ? isPush : !isPush;
    }
    // GitHub string comparisons, including startsWith, ignore literal case; unknown syntax stays unsupported.
    const refType = /^github\.ref_type\s*==\s*(['"])([^'"]+)\1$/.exec(clause);
    const refPrefix = /^startsWith\(\s*github\.ref\s*,\s*(['"])([^'"]*)\1\s*\)$/.exec(clause);
    return !(clause === 'false'
      || refType?.[2]?.toLowerCase() === 'tag'
      || refPrefix?.[2]?.toLowerCase().startsWith('refs/tags/'));
  });
}

/** Where and how often the suite runs: hooks, watch mode, CI triggers and OS matrices, and agent instructions. */
export function detectFrequency(root: string, map: RiskMap | null): Finding[] {
  const findings: Finding[] = [];
  let scripts: Record<string, unknown> = {};

  const addHookFinding = (file: string, line: number | undefined, evidence: string): void => {
    findings.push({
      category: 'frequency',
      rule: 'frequency.hook-full-suite',
      file,
      ...(line === undefined ? {} : { line }),
      message: 'A git hook runs the whole suite on every commit or push. Run only affected tests, or move the full run to a slower lane.',
      evidence: evidence.trim().slice(0, 160),
    });
  };

  for (const hook of HOOK_FILES) {
    const text = readText(join(root, hook));
    if (text === null) continue;
    for (const { line, command } of joinContinuations(text.split(/\r?\n/).map((command, index) => ({ line: index + 1, command })))) {
      if (runsWholeSuite(command)) addHookFinding(hook, line, command);
    }
  }
  for (const hook of LEFTHOOK_FILES) {
    const text = readText(join(root, hook));
    if (text === null) continue;
    for (const { line, command } of joinContinuations(lefthookCommands(text))) {
      if (runsWholeSuite(command)) addHookFinding(hook, line, command);
    }
  }

  const pkgText = readText(join(root, 'package.json'));
  if (pkgText !== null) {
    let pkg: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(pkgText);
      if (isRecord(parsed)) pkg = parsed;
    } catch {
      // Unreadable package.json: nothing to report here.
    }
    scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
    for (const name of ['prebuild', 'build', 'postbuild']) {
      const trace = buildSuiteTrace(scripts, name);
      if (!trace) continue;
      findings.push({
        category: 'frequency',
        rule: 'frequency.build-full-suite',
        file: 'package.json',
        message: 'A build script reaches an unscoped test suite. Review whether this is a deliberate release gate or repeats tests during builds; retain equivalent protection before separating the commands.',
        evidence: trace.slice(0, 300),
      });
    }
    for (const name of HOOK_SCRIPTS) {
      const script = scripts[name];
      if (typeof script === 'string' && runsWholeSuite(script)) {
        findings.push({
          category: 'frequency',
          rule: 'frequency.hook-full-suite',
          file: 'package.json',
          message: `The ${name} script runs the whole suite automatically.`,
          evidence: `${name}: ${script}`.slice(0, 160),
        });
      }
    }
    const simpleGitHooks = isRecord(pkg['simple-git-hooks']) ? pkg['simple-git-hooks'] : {};
    for (const [name, command] of Object.entries(simpleGitHooks)) {
      if (typeof command === 'string' && runsWholeSuite(command)) addHookFinding('package.json', undefined, `${name}: ${command}`);
    }
    const testScript = scripts.test;
    if (typeof testScript === 'string' && testScript.split(/&&|\|\||;/).some(segment => startsWatchMode(segment.trim()))) {
      findings.push({
        category: 'frequency',
        rule: 'frequency.watch-default',
        file: 'package.json',
        message:
          'The test script starts watch mode when stdin is a terminal and CI is unset, so an interactive session can wait on it. Make it a single run: `vitest run` (jest without --watch).',
        evidence: `test: ${testScript}`.slice(0, 160),
      });
    }
  }

  const workflowDir = join(root, '.github', 'workflows');
  let workflowNames: string[] = [];
  try {
    workflowNames = readdirSync(workflowDir).filter(entry => /\.ya?ml$/.test(entry)).sort();
  } catch {
    // No workflows directory, or not a directory: nothing to report here.
  }
  for (const name of workflowNames) {
    const file = `.github/workflows/${name}`;
    const text = readText(join(workflowDir, name));
    if (text === null) continue;
    let workflow: unknown;
    try {
      workflow = parse(text);
    } catch {
      continue;
    }
    if (!isRecord(workflow)) continue;
    const triggers = triggersOf(workflow);
    const jobs = (isRecord(workflow.jobs) ? Object.entries(workflow.jobs) : []).flatMap(([key, raw]) => isRecord(raw)
      ? [{ key, raw, ...expensiveRunnersOf(raw), onPullRequest: runsOnPullRequest(raw) }]
      : []);
    const rootScriptsForStep = (job: Record<string, unknown>, step: Record<string, unknown>): Record<string, unknown> => {
      const defaultDirectory = (owner: Record<string, unknown>): unknown => {
        const defaults = isRecord(owner.defaults) ? owner.defaults : {};
        return isRecord(defaults.run) ? defaults.run['working-directory'] : undefined;
      };
      const directory = step['working-directory'] ?? defaultDirectory(job) ?? defaultDirectory(workflow);
      if (directory !== undefined && directory !== '.' && directory !== './') return {};
      // A shell directory change invalidates root-package tracing; do not build a shell state evaluator.
      if (typeof step.run === 'string' && literalCommands(step.run).some(command => CHANGES_DIRECTORY.test(command))) return {};
      return scripts;
    };
    const publication = jobs.flatMap(job => {
      const signals: string[] = [];
      if (typeof job.raw.environment === 'string' || isRecord(job.raw.environment)) signals.push(`${job.key}: environment`);
      for (const step of Array.isArray(job.raw.steps) ? job.raw.steps.filter(isRecord) : []) {
        if (typeof step.uses === 'string' && PUBLICATION_ACTION.test(step.uses)) signals.push(`${job.key}: ${step.uses}`);
        if (typeof step.run === 'string') {
          const trace = publicationTrace(rootScriptsForStep(job.raw, step), step.run);
          if (trace) signals.push(`${job.key}: ${trace}`);
        }
      }
      return signals;
    });
    const reportedMatrix = new Set<number>();
    const reportMatrix = (applies: (job: { onPullRequest: boolean }) => boolean): void => {
      jobs.forEach((job, index) => {
        if (job.matrix.length === 0 || reportedMatrix.has(index) || !applies(job)) return;
        reportedMatrix.add(index);
        findings.push({
          category: 'frequency',
          rule: 'frequency.ci-os-matrix-on-push',
          file,
          message: `An automatic workflow is configured to fan out to Windows or macOS runners.${platformAdvice(map)}${publication.length ? ' Preserve publication triggers.' : ''}`,
          evidence: `matrix.os: ${job.matrix.join(', ')}`,
        });
      });
    };

    if ('push' in triggers) {
      const config = triggers.push;
      const has = (key: string): boolean => isRecord(config) && key in config;
      // A tag-only push trigger is a release-lane run, not a run on every push.
      const tagOnly = has('tags') && !has('branches') && !has('branches-ignore');
      if (!tagOnly) {
        const pushRunners = [...new Set(jobs.flatMap(job => job.all))];
        if (publication.length > 0) {
          for (const job of jobs) {
            if (!mayRunOnBranchPush(job.raw)) continue;
            const steps = Array.isArray(job.raw.steps) ? job.raw.steps : [];
            steps.forEach((step, index) => {
              if (!isRecord(step) || typeof step.run !== 'string' || !mayRunOnBranchPush(step)) return;
              const trace = buildSuiteTrace({ ...rootScriptsForStep(job.raw, step), '<workflow-step>': step.run }, '<workflow-step>');
              if (!trace && !unknownValidation(step.run)) return;
              findings.push({
                category: 'frequency',
                rule: trace ? 'frequency.publication-validation' : 'frequency.publication-unknown-validation',
                file,
                message: trace
                  ? `A configured literal suite step in a publication context has potential overlap with other validation. Preserve every publication trigger. Review this step only after matching selection, source, dependencies, config, assets and an actual passing result; duplication is not established. Opaque wrappers have unknown coverage.${CONFIGURED_CI}`
                  : `A validation-looking command in a publication context has unknown coverage; a script name or wrapper does not prove a suite run. Preserve every publication trigger and required validation.${CONFIGURED_CI}`,
                evidence: `${job.key} / step ${index + 1}${typeof step.name === 'string' ? ` (${step.name})` : ''}: ${trace ?? step.run}; publication: ${publication.join('; ')}`,
              });
            });
          }
        } else if (has('paths') || has('paths-ignore')) {
          if (pushRunners.length > 0) {
            findings.push({
              category: 'frequency',
              rule: 'frequency.ci-on-push',
              file,
              message: `A push-triggered workflow is configured on ${pushRunners.join(', ')} with a path filter. Review potential overlap with local or PR validation; paths alone do not establish complete selection or waive required reporting. Unknown workflow purpose must be established before changing triggers.${platformAdvice(map)}`,
              evidence: 'on: push',
            });
          }
        } else {
          const branches = isRecord(config) ? asStrings(config.branches) : [];
          findings.push({
            category: 'frequency',
            rule: 'frequency.ci-on-push',
            file,
            message: `CI is configured on every push to a branch with no path filter.${branches.length ? ` Configured branches: ${branches.join(', ')}.` : ''} Review potential overlap with local or PR validation and retain an applicable validation owner. Trigger syntax does not establish duplicate execution or matching inputs and results. Workflow purpose is unknown without positive publication evidence; establish obligations before changing triggers.${pushRunners.length ? platformAdvice(map) : phaseAdvice(map) + CONFIGURED_CI}`,
            evidence: 'on: push',
          });
        }
        reportMatrix(() => true);
      }
    }
    if ('pull_request' in triggers) {
      // Describe configured platform fanout without inventing billing or required-check policy.
      const runners = [...new Set(jobs.filter(job => job.onPullRequest).flatMap(job => job.all))];
      if (runners.length > 0) {
        findings.push({
          category: 'frequency',
          rule: 'frequency.ci-on-pull-request',
          file,
          message: `A pull_request workflow is configured on ${runners.join(', ')}. A path filter alone does not establish platform acceptance or required-check policy.${platformAdvice(map)}${publication.length ? ' Preserve publication triggers.' : ''}`,
          evidence: 'on: pull_request',
        });
        reportMatrix(job => job.onPullRequest);
      }
    }
  }

  for (const doc of AGENT_DOCS) {
    const text = readText(join(root, doc));
    if (text === null) continue;
    let fenced = false;
    text.split(/\r?\n/).forEach((line, index) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        fenced = !fenced;
        return;
      }
      if (fenced) return;
      const flagged = [...line.matchAll(AGENT_RUN_ALL)].some(match => {
        const before = line.slice(0, match.index);
        const after = line.slice(match.index + match[0].length);
        return !AGENT_NEGATION.test(before) && !AGENT_MERGE_GATE.test(after);
      });
      if (flagged) {
        findings.push({
          category: 'frequency',
          rule: 'frequency.agent-run-all',
          file: doc,
          line: index + 1,
          message: 'Agent instructions tell the agent to run the whole suite. Point it at the edit lane instead.',
          evidence: line.trim().slice(0, 160),
        });
      }
    });
  }
  return findings;
}
