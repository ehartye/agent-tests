import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Finding, RiskMap } from '../schema.ts';

const RUNS_TESTS = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|npx\s+(?:vitest|jest)|vitest|jest|pytest)\b/;
const SCOPED = /--changed|--related|\brelated\b|--findRelatedTests|--onlyChanged|--affected|\baffected\b/;
const HOOK_FILES = ['.husky/pre-commit', '.husky/pre-push', '.githooks/pre-commit', '.githooks/pre-push', 'lefthook.yml'];
const HOOK_SCRIPTS = ['pretest', 'precommit', 'pre-commit', 'prepush', 'pre-push'];
const AGENT_RUN_ALL = /\b(?:run|execute)\s+(?:all|the\s+(?:full|entire|whole)|every)\s+tests?(?:\s+suite)?\b|\balways\s+run\s+(?:the\s+)?tests?\b/i;
const EXPENSIVE_OS = /^(?:macos|windows)/i;

const readText = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null);

function phaseAdvice(map: RiskMap | null): string {
  if (!map) return '';
  if (map.phase === 'dev') return ' In the dev phase, prefer one non-blocking Linux job on pull_request, plus workflow_dispatch and a scheduled run for the OS matrix.';
  return '';
}

function triggersOf(workflow: Record<string, unknown>): Record<string, unknown> {
  const on = workflow.on ?? workflow['true'];
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map(name => [String(name), null]));
  if (on && typeof on === 'object') return on as Record<string, unknown>;
  return {};
}

/** Where and how often the suite runs: hooks, watch mode, CI triggers and OS matrices, and agent instructions. */
export function detectFrequency(root: string, map: RiskMap | null): Finding[] {
  const findings: Finding[] = [];

  const scanHookText = (file: string, text: string): void => {
    text.split(/\r?\n/).forEach((line, index) => {
      if (RUNS_TESTS.test(line) && !SCOPED.test(line) && !line.trim().startsWith('#')) {
        findings.push({
          category: 'frequency',
          rule: 'frequency.hook-full-suite',
          file,
          line: index + 1,
          message: 'A git hook runs the whole suite on every commit or push. Run only affected tests, or move the full run to a slower lane.',
          evidence: line.trim().slice(0, 160),
        });
      }
    });
  };
  for (const hook of HOOK_FILES) {
    const text = readText(join(root, hook));
    if (text !== null) scanHookText(hook, text);
  }

  const pkgText = readText(join(root, 'package.json'));
  if (pkgText !== null) {
    let scripts: Record<string, string> = {};
    try {
      scripts = (JSON.parse(pkgText) as { scripts?: Record<string, string> }).scripts ?? {};
    } catch {
      // Unreadable package.json: nothing to report here.
    }
    for (const name of HOOK_SCRIPTS) {
      if (scripts[name] && RUNS_TESTS.test(scripts[name]) && !SCOPED.test(scripts[name])) {
        findings.push({
          category: 'frequency',
          rule: 'frequency.hook-full-suite',
          file: 'package.json',
          message: `The ${name} script runs the whole suite automatically.`,
          evidence: `${name}: ${scripts[name]}`,
        });
      }
    }
    for (const segment of (scripts.test ?? '').split('&&').map(part => part.trim())) {
      const bareVitest = /^vitest(?:\s|$)/.test(segment) && !/(?:^|\s)(?:run|related|bench)(?:\s|$)|--run\b/.test(segment);
      if (bareVitest || /--watch(?:All)?\b/.test(segment)) {
        findings.push({
          category: 'frequency',
          rule: 'frequency.watch-default',
          file: 'package.json',
          message: 'The test script can start watch mode, which blocks an agent running in an interactive terminal. Make it a single run (vitest run, jest without --watch).',
          evidence: `test: ${scripts.test}`,
        });
        break;
      }
    }
  }

  const workflowDir = join(root, '.github', 'workflows');
  if (existsSync(workflowDir)) {
    for (const name of readdirSync(workflowDir).filter(entry => /\.ya?ml$/.test(entry)).sort()) {
      const file = `.github/workflows/${name}`;
      let workflow: Record<string, unknown>;
      try {
        workflow = (parse(readFileSync(join(workflowDir, name), 'utf8')) ?? {}) as Record<string, unknown>;
      } catch {
        continue;
      }
      const triggers = triggersOf(workflow);
      const jobs = (workflow.jobs ?? {}) as Record<string, { 'runs-on'?: unknown; strategy?: { matrix?: { os?: unknown } } }>;
      const expensiveRunners = [
        ...new Set(
          Object.values(jobs).flatMap(job => {
            const os = job?.strategy?.matrix?.os;
            const runsOn = job?.['runs-on'];
            return [...(Array.isArray(os) ? os : []), ...(typeof runsOn === 'string' ? [runsOn] : [])].map(String).filter(entry => EXPENSIVE_OS.test(entry));
          }),
        ),
      ];
      const automatic: string[] = [];
      for (const trigger of ['push', 'pull_request'].filter(name => name in triggers)) {
        const config = triggers[trigger];
        const has = (key: string): boolean => !!config && typeof config === 'object' && key in config;
        // A tag-only push trigger is a release-lane run, not a run on every push.
        const filtered = has('paths') || has('paths-ignore') || (trigger === 'push' && has('tags') && !has('branches'));
        if (filtered) continue;
        // One Linux job per pull-request update is the recommended non-blocking check; only Windows or macOS makes it costly.
        if (trigger === 'pull_request' && expensiveRunners.length === 0) continue;
        automatic.push(trigger);
        findings.push({
          category: 'frequency',
          rule: trigger === 'push' ? 'frequency.ci-on-push' : 'frequency.ci-on-pull-request',
          file,
          message:
            trigger === 'push'
              ? `CI runs on every push to a branch with no path filter. A pull_request trigger fires once per pull-request update instead.${phaseAdvice(map)}`
              : `A pull_request workflow runs on ${expensiveRunners.join(', ')}, which bills at a higher rate than Linux. Keep the OS matrix off the pull-request path.${phaseAdvice(map)}`,
          evidence: `on: ${trigger}`,
        });
      }
      if (automatic.length > 0) {
        for (const job of Object.values(jobs)) {
          const os = job?.strategy?.matrix?.os;
          const expensive = Array.isArray(os) ? os.map(String).filter(entry => EXPENSIVE_OS.test(entry)) : [];
          if (expensive.length > 0) {
            findings.push({
              category: 'frequency',
              rule: 'frequency.ci-os-matrix-on-push',
              file,
              message: 'An automatic workflow fans out to Windows or macOS runners, which bill at a higher rate than Linux.',
              evidence: `matrix.os: ${expensive.join(', ')}`,
            });
          }
        }
      }
    }
  }

  for (const doc of ['AGENTS.md', 'CLAUDE.md']) {
    const text = readText(join(root, doc));
    if (text === null) continue;
    text.split(/\r?\n/).forEach((line, index) => {
      if (AGENT_RUN_ALL.test(line)) {
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
