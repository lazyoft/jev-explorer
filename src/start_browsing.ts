import { writeFile } from 'node:fs/promises';
import { goto } from './browser/client.js';
import { exploreLoop } from './explore_loop.js';
import { DEFAULT_BUDGETS, type SessionStore } from './domain/sessions.js';
import { ExplorerError, blocked, needsDecision } from './domain/errors.js';
import { buildReport, type Report } from './domain/report.js';
import { trace } from './domain/trace.js';
import type { Decider } from './jev/client.js';
import type { Session } from './domain/types.js';

export interface BrowseRequest {
  sessionId?: string | undefined;
  url?: string | undefined;
  headed?: boolean | undefined;
  goal: string;
  questions?: { key: string; question: string }[] | undefined;
  values?: Record<string, string> | undefined;
  allowCommit?: boolean | undefined;
  confirm?: 'done' | 'not_done' | undefined;
  note?: string | undefined;
  maxSteps?: number | undefined;
  maxMessages?: number | undefined;
  timeoutMs?: number | undefined;
}

const SECRET = /pass|secret|token|api.?key|credential/i;

export async function startBrowsing(store: SessionStore, decider: Decider, request: BrowseRequest, signal: AbortSignal): Promise<Report> {
  if (!request.sessionId && !request.url) throw blocked('NO_TARGET', 'Send a web address, or the id of a session that is already open.');
  let sessionId = request.sessionId;
  if (!sessionId) {
    const created = await store.create(request.headed ?? false);
    sessionId = created.id;
    try { await goto(created.page, request.url!); }
    catch (error) { await store.close(created.id).catch(() => {}); throw error; }
  }
  return store.exclusive(sessionId, async session => {
    resolveCommit(session, request);
    applyRequest(session, request);
    await trace(session, { kind: 'goal', goal: session.goal, values: Object.keys(session.values) });
    try {
      await exploreLoop(session, decider, signal);
    } catch (error) {
      const known = error instanceof ExplorerError ? error : blocked('RUN_FAILED', 'The run stopped on an unexpected problem. Look at the page and at the trace file.');
      session.status = known.stop;
      session.need = known.message;
      await trace(session, { kind: 'stopped', code: known.code, need: known.message });
    }
    await writeFile(session.artifacts.screenshot, await session.page.screenshot({ fullPage: false }), { mode: 0o600 }).catch(() => {});
    return buildReport(session);
  });
}

function resolveCommit(session: Session, request: BrowseRequest) {
  if (!session.awaitingCommit) return;
  if (!request.confirm) {
    throw needsDecision('CONFIRM_FIRST', 'The last step may have changed something outside the page. Say whether it happened before this session continues.');
  }
  session.awaitingCommit = false;
  session.steps.push({
    action: 'the supervisor checked the last step',
    effect: 'commit',
    outcome: request.confirm === 'done' ? 'it happened' : 'it did not happen',
  });
}

function applyRequest(session: Session, request: BrowseRequest) {
  const sameGoal = session.goal === request.goal;
  session.goal = request.goal;
  session.questions = request.questions ?? session.questions;
  if (!sameGoal) {
    session.findings = [];
    session.placed = {};
    session.steps = [];
  }
  for (const [name, value] of Object.entries(request.values ?? {})) {
    session.values[name] = value;
    delete session.placed[name];
    if (SECRET.test(name)) session.secrets.push(value);
  }
  if (request.note) session.notes.push(request.note);
  session.commitAllowed = request.allowCommit ?? false;
  session.budgets = {
    maxSteps: request.maxSteps ?? DEFAULT_BUDGETS.maxSteps,
    maxMessages: request.maxMessages ?? DEFAULT_BUDGETS.maxMessages,
    timeoutMs: request.timeoutMs ?? DEFAULT_BUDGETS.timeoutMs,
  };
  session.usage = { steps: 0, messages: 0, inputTokens: 0, outputTokens: 0, elapsedMs: 0 };
  session.need = '';
}
