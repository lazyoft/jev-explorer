import type { Browser, BrowserContext, Page } from 'playwright';
import type { Stop } from './errors.js';

export type ActionKind = 'click' | 'type' | 'select' | 'check' | 'uncheck' | 'scroll' | 'back' | 'close-tab';

export interface Action {
  ref: string;
  onScreen?: boolean;
  kind: ActionKind;
  role: string;
  name: string;
  context: string;
  frame: number;
  value?: string;
  checked?: boolean;
  required?: boolean;
  filled?: boolean;
  inputType?: string;
  format?: string;
  options?: { index: number; label: string }[];
}

export interface TextBlock {
  ref: string;
  role: string;
  text: string;
  context: string;
  frame: number;
}

export interface Observation {
  url: string;
  title: string;
  busy: boolean;
  actions: Action[];
  texts: TextBlock[];
}

export interface Finding {
  key: string;
  question: string;
  text: string;
  context: string;
  url: string;
}

export interface Step {
  action: string;
  effect: Effect;
  outcome: string;
}

export type Effect = 'move' | 'change' | 'commit';

export interface Budgets {
  maxSteps: number;
  maxMessages: number;
  timeoutMs: number;
}

export interface Usage {
  steps: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
}

export interface Session {
  id: string;
  dir: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  busy: boolean;
  closed: boolean;
  touched: number;
  goal: string;
  questions: { key: string; question: string }[];
  values: Record<string, string>;
  placed: Record<string, { ref: string; name: string; value: string }>;
  commitAllowed: boolean;
  budgets: Budgets;
  usage: Usage;
  status: Stop;
  need: string;
  steps: Step[];
  findings: Finding[];
  notes: string[];
  secrets: string[];
  awaitingCommit: boolean;
  observation: Observation;
  artifacts: { trace: string; observation: string; screenshot: string };
}

export const emptyObservation = (): Observation => ({ url: '', title: '', busy: false, actions: [], texts: [] });
