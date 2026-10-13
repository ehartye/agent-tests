export declare const CONFIG_SCHEMA: 'agent-tests/playbot-config@1';
export declare const RESULT_SCHEMA: 'agent-tests/playbot-result@1';
export declare const CONTRACT_VERSION: 1;
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};
export type JsonObject = {[key: string]: JsonValue};
export type ActionRoute = 'commands' | 'native-driver' | 'ordinary-input';
export type TerminationReason = 'target' | 'budget' | 'policy' | 'input-failure' | 'error' | 'cancelled';
export interface RunPosition {beat: number; sim: number; wallMs: number}
export interface AdapterCapabilities {simUnits: readonly string[]; actions: readonly ActionRoute[]; fallbackAccounting: boolean}
export interface RunConfig {
  schema: typeof CONFIG_SCHEMA; id: string; game: string; adapter: string;
  scenario: {id: string; params: JsonObject}; seeds: {game: number | null; bot: number};
  policy: {id: string; effective: JsonObject};
  origin: {kind: 'fresh' | 'fixture' | 'earned-prefix' | 'saved'; stateRef: string | null; prefixRef: string | null; bot: 'new'};
  transport: {host: 'headless' | 'browser'; actions: ActionRoute; clock: 'native' | 'controlled'; fallback: 'allow-recorded' | 'forbid'};
  budget: {beats: number | null; sim: {unit: string; max: number} | null; wallMs: number};
  stop: {id: string; params: JsonObject}; observe: {sampleEveryBeats: number; tail: number};
}
export interface Provenance {source: {revision: string | null; inputsRef: string | null}; buildRef: string | null}
export interface Verdict {passed: boolean; targetReached: boolean; checks: {id: string; passed: boolean}[]}
export interface RunEvent extends RunPosition {seq: number; run: string; kind: string; payload: JsonValue}
export interface RunResult {
  schema: typeof RESULT_SCHEMA; config: RunConfig; provenance: Provenance & {contractVersion: typeof CONTRACT_VERSION};
  phase: 'running' | 'finished'; termination: {reason: TerminationReason; detail: string; at: RunPosition} | null; verdict: Verdict | null;
  summary: {beats: number; sim: {unit: string | null; start: number; end: number}; wallMs: number;
    byIntent: Record<string, number>; actions: {attempted: number; accepted: number; refused: number; unconfirmed: number}; fallbacks: number; refusals: Record<string, number>};
  tail: {events: RunEvent[]; omitted: number; coverage: 'full' | 'tail'}; evidence: JsonValue[]; native: JsonValue;
}
export type BudgetHit = {kind: 'wall' | 'beats'; max: number; actual: number} | {kind: 'sim'; unit: string; max: number; actual: number};
export interface RunRecorder {
  snapshot(): RunResult;
  attachEvidence(result: {evidence: JsonValue[]; native: JsonValue}): void;
  budget(at: RunPosition): BudgetHit | null;
  observe(event: {at: RunPosition; intent?: string; data?: JsonValue}): void;
  attempt(action: {name: string; route: ActionRoute; at: RunPosition; fallbackReason?: string | null}): number;
  confirm(id: number, result: {status: 'accepted' | 'refused'; reason?: string | null; at: RunPosition}): void;
  refusal(reason: string, event: {at: RunPosition}): void;
  progress(name: string, event: {at: RunPosition; data?: JsonValue}): void;
  finish(result: {reason: TerminationReason; detail: string; at: RunPosition; verdict: Verdict; evidence: JsonValue[]; native: JsonValue}): RunResult;
}
export declare function validateConfig(input: unknown, capabilities: AdapterCapabilities): RunConfig;
export declare function validateJson(input: unknown): JsonValue;
export declare function validateProvenance(input: unknown): Provenance;
export declare function validateVerdict(input: unknown): Verdict;
export declare function validateEvidence(input: unknown): JsonValue[];
export declare function createRunRecorder(input: unknown, options: {capabilities: AdapterCapabilities; provenance: Provenance; start: RunPosition}): RunRecorder;
export declare function summarizeRun(result: RunResult): string;
