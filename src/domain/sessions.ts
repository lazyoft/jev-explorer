import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launchBrowser } from '../browser/client.js';
import { blocked } from './errors.js';
import { emptyObservation, type Budgets, type Session } from './types.js';

export const DEFAULT_BUDGETS: Budgets = { maxSteps: 25, maxMessages: 40, timeoutMs: 180000 };

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly root: string, private readonly maxSessions = 3, idleMs = 1800000) {
    this.timer = setInterval(() => {
      for (const session of this.sessions.values()) {
        if (!session.busy && Date.now() - session.touched > idleMs) void this.close(session.id).catch(() => {});
      }
    }, Math.min(idleMs, 60000));
    this.timer.unref();
  }

  async create(headed: boolean): Promise<Session> {
    if (this.sessions.size >= this.maxSessions) {
      throw blocked('TOO_MANY_SESSIONS', 'Close a browser session before you open another one.');
    }
    const id = randomUUID();
    const dir = join(this.root, id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const { browser, context, page } = await launchBrowser(headed);
    const session: Session = {
      id, dir, browser, context, page,
      busy: false, closed: false, touched: Date.now(),
      goal: '', questions: [], values: {}, placed: {}, commitAllowed: false,
      budgets: { ...DEFAULT_BUDGETS },
      usage: { steps: 0, messages: 0, inputTokens: 0, outputTokens: 0, elapsedMs: 0 },
      status: 'needs_decision', need: 'The browser is open. Send a goal.',
      steps: [], findings: [], notes: [], secrets: [], awaitingCommit: false,
      observation: emptyObservation(),
      artifacts: { trace: join(dir, 'trace.jsonl'), observation: join(dir, 'page.json'), screenshot: join(dir, 'page.png') },
    };
    context.on('page', opened => {
      opened.on('dialog', dialog => void dialog.dismiss().catch(() => {}));
      opened.on('close', () => {
        const open = context.pages().filter(other => !other.isClosed());
        session.page = open[open.length - 1] ?? session.page;
      });
      session.page = opened;
    });
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.closed) throw blocked('NO_SESSION', 'This browser session is not open any more. Start a new one.');
    return session;
  }

  async exclusive<T>(id: string, work: (session: Session) => Promise<T>): Promise<T> {
    const session = this.get(id);
    if (session.busy) throw blocked('SESSION_BUSY', 'Another request is using this browser session. Wait for it to finish.');
    session.busy = true;
    session.touched = Date.now();
    try { return await work(session); }
    finally { session.busy = false; session.touched = Date.now(); }
  }

  async close(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw blocked('NO_SESSION', 'This browser session is not open any more.');
    await session.browser.close().catch(() => {});
    session.closed = true;
    this.sessions.delete(id);
    return session;
  }

  async shutdown() {
    clearInterval(this.timer);
    for (const session of [...this.sessions.values()]) await this.close(session.id).catch(() => {});
  }
}
