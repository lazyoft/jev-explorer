import type { BrowserLaunchOptions, DecisionEngine, JevBrowser, RunResult, RunValue, Snapshot, TextEvidence } from '@tontoko/jev-browser';
import type { TypedData, AppliedDatum } from './typed-data.js';

export type Values = Record<string, RunValue>;
export interface Fact { key: string; value: string; url?: string; origin: 'observed' | 'caller'; current: boolean; observedAt: string; evidence?: TextEvidence }
export interface History { action: string; outcome: string; source: 'browser-action' | 'supervisor' | 'runtime' | 'typed-input' }
export interface Settings { maxSteps: number; maxCalls: number; maxTokens: number; timeoutMs: number }
export interface ActiveRun extends Settings {
  calls: number; failedCalls: number; inputTokens: number; outputTokens: number; elapsedMs: number; observationRetries: number;
  observations: { url?: unknown; changed: boolean; previousAction?: string }[];
  repetitions: Map<string, number>; lastFingerprint?: string; lastAction?: string;
}
export interface Session {
  id: string; dir: string; core: JevBrowser; touched: number; busy: boolean; closed: boolean; status: string; reason: string;
  objective: string; values: Values; data: TypedData; typedApplied: Record<string, AppliedDatum>;
  questions: { key: string; question: string }[]; facts: Fact[]; history: History[]; notes: string[]; needs: string[];
  applied: Record<string, { role?: string; name?: string; frame?: number; readback: boolean }>;
  redactions: string[]; limitations: string[]; allowCommit: boolean; pendingEffect?: boolean;
  artifacts: { report: string; memory: string; trace: string; screenshot: string };
  view: Snapshot & { validation: { field: string; message: string }[] };
  provider?: DecisionEngine; active?: ActiveRun; settings: Settings; workflow?: { status: string; reason: string };
}
export interface ExplorerOptions {
  root?: string; launch?: (options: BrowserLaunchOptions) => Promise<JevBrowser>;
  engineFactory?: (session: Session) => DecisionEngine; maxSessions?: number; idleMs?: number;
}
export interface ExploreArgs extends Partial<Settings> {
  sessionId?: string; url?: string; headed?: boolean; objective: string; values?: Values; data?: TypedData;
  questions?: { key: string; question: string }[]; allowCommit?: boolean;
}
export interface ContinueArgs {
  note?: string; values?: Values; data?: TypedData; facts?: { key: string; value: string; url?: string }[];
  effectResolution?: 'confirmed' | 'not_applied';
}
export type Operation = { signal?: AbortSignal };
export function asError(value: unknown): Error & { code?: string; partial?: RunResult } {
  return value instanceof Error ? value : new Error(String(value));
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
