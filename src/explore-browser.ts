import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, appendFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { JevBrowser, JevDecisionEngine, BrowserError } from '@tontoko/jev-browser';
import { z } from 'zod';
import { compactReport, short } from './compact.js';
import type { BrowserLaunchOptions, DecisionEngine, DecisionRequest, GroundedAction, NativeCommand, RunResult, RunValue } from '@tontoko/jev-browser';
import type { Page } from 'playwright';
import type { Session, ExplorerOptions, ExploreArgs, ContinueArgs, Operation, Values } from './types.js';
import { asError, record } from './types.js';
import { dataSchema, fillTypedData } from './typed-data.js';

const flatten = (value: Values, path = ''): [string, RunValue][] => Object.entries(value ?? {}).flatMap(([key, item]) => {
  const next = path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1');
  return item && typeof item === 'object' && !Array.isArray(item) ? flatten(item, next) : [[next, item]];
});
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const actionText = (action: GroundedAction) => [action.kind, action.target?.role, action.target?.name, action.option?.label, action.key, action.direction].filter(Boolean).join(' ');
const errorInfo = (error: ReturnType<typeof asError>) => ({ code: error?.code ?? 'OPERATION_FAILED', message: short(error?.message ?? 'Operation failed', 500) });
const noWriteWords = /\b(save|submit|post|delete|reverse|approve|reject|purchase|pay|send|publish|schedule)\b/i;

export class BrowserExplorer {
  root: string;
  launch: NonNullable<ExplorerOptions['launch']>;
  engineFactory: NonNullable<ExplorerOptions['engineFactory']>;
  maxSessions: number;
  sessions: Map<string, Session>;
  opening: number;
  timer: ReturnType<typeof setInterval>;
  constructor({ root = resolve('runs'), launch = options => JevBrowser.launch(options), engineFactory = () => new JevDecisionEngine({ model: process.env.JEV_MODEL ?? 'jev-1.13.0' }), maxSessions = 3, idleMs = 1800000 }: ExplorerOptions = {}) {
    this.root = root;
    this.launch = launch;
    this.engineFactory = engineFactory;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
    this.opening = 0;
    this.timer = setInterval(() => {
      for (const session of this.sessions.values()) if (!session.busy && Date.now() - session.touched > idleMs) void this.close(session.id).catch(() => {});
    }, Math.min(idleMs, 30000));
    this.timer.unref();
  }

  get(id: string) {
    const session = this.sessions.get(id);
    if (!session || session.closed) throw new BrowserError('SESSION_NOT_FOUND', 'This browser session is not alive. An archived trace cannot restore its cookies or replay its effects.');
    return session;
  }

  async exclusive<T>(id: string, work: (session: Session) => Promise<T>): Promise<T> {
    const session = this.get(id);
    if (session.busy) throw new BrowserError('BUSY', 'Another operation owns this session.');
    session.busy = true;
    session.touched = Date.now();
    try { return await work(session); }
    finally { session.busy = false; session.touched = Date.now(); }
  }

  scrub<T>(session: Session, value: T): T {
    let encoded = JSON.stringify(value);
    for (const literal of session.redactions) if (literal) encoded = encoded.replaceAll(JSON.stringify(literal).slice(1, -1), '[redacted]');
    return JSON.parse(encoded);
  }

  async event(session: Session, event: Record<string, unknown>) {
    await appendFile(join(session.dir, 'trace.jsonl'), JSON.stringify(this.scrub(session, { at: new Date().toISOString(), ...event })) + '\n', { mode: 0o600 });
  }

  async persist(session: Session) {
    const data = this.scrub(session, {
      sessionId: session.id, browserAliveOnlyInCurrentProcess: !session.closed,
      status: session.status, reason: session.reason, objective: session.objective,
      pendingEffect: session.pendingEffect ?? false,
      facts: session.facts, history: session.history, needs: session.needs,
      inputPaths: flatten(session.values).map(([path]) => path),
      inputProgress: session.applied, typedInputProgress: Object.values(session.typedApplied).map(({ key, field, format, url }) => ({ key, field, format, url })), artifacts: session.artifacts,
    });
    const temporary = join(session.dir, `memory-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(temporary, join(session.dir, 'memory.json'));
    await writeFile(join(session.dir, 'report.json'), JSON.stringify(compactReport(session), null, 2), { mode: 0o600 });
  }

  wrapEngine(session: Session, provider: DecisionEngine): DecisionEngine {
    return { decide: async (request, options = {}) => {
      const run = session.active;
      if (!run) return provider.decide(request, options);
      if (run.calls >= run.maxCalls || run.inputTokens >= run.maxTokens) throw new BrowserError('BUDGET_EXHAUSTED', 'The exploration model budget is exhausted.');
      run.calls++;
      const page = record(record(request.state).page);
      const fingerprint = Object.keys(page).length ? hash(page) : undefined;
      if (fingerprint) {
        const changed = run.lastFingerprint !== undefined && run.lastFingerprint !== fingerprint;
        if (run.lastFingerprint) run.observations.push({ url: page.url, changed, previousAction: run.lastAction });
        run.lastFingerprint = fingerprint;
      }
      const augmented = this.scrub(session, {
        ...request,
        state: { observed: typeof request.state === 'object' ? undefined : request.state, ...record(request.state),
          explorationMemory: {
            objective: session.objective,
            facts: session.facts.slice(-8).map(({ key, value, origin, url, current }) => ({ key, value, origin, url, current })),
            previousOutcomes: session.history.slice(-8),
            recentObservationChanges: run.observations.slice(-4),
            supervisorNotes: session.notes.slice(-4),
          },
        },
      });
      await this.event(session, { kind: 'decision-request', call: run.calls, request: augmented });
      const started = performance.now();
      let result;
      try { result = await provider.decide(JSON.parse(JSON.stringify(augmented)) as DecisionRequest, options); }
      catch (caught) { const error = asError(caught); run.failedCalls++; await this.event(session, { kind: 'decision-failed', error: errorInfo(error) }); throw error; }
      run.inputTokens += result.usage?.input_tokens ?? 0;
      run.outputTokens += result.usage?.output_tokens ?? 0;
      await this.event(session, { kind: 'decision-response', milliseconds: Math.round(performance.now() - started), response: result });
      const selected = result.answers?.action?.choice;
      if (fingerprint && selected && !selected.startsWith('__')) {
        const candidate = record(request.questions.action?.criteria)[selected];
        const description = record(candidate);
        const key = fingerprint + ':' + hash(typeof candidate === 'object' ? { action: String(description.kind ?? '') + ':' + String(record(description.target).id ?? ''), valueKey: description.valueKey } : candidate);
        const count = (run.repetitions.get(key) ?? 0) + 1;
        run.repetitions.set(key, count);
        run.lastAction = typeof candidate === 'object' ? JSON.stringify(candidate) : String(candidate);
        if (count > 2) throw new BrowserError('NO_PROGRESS', 'The same action was chosen repeatedly on the same observed state.');
      }
      return result;
    } };
  }

  async open({ url, headed = false, redactions = [] }: { url: string; headed?: boolean; redactions?: string[] }, { page, signal }: Operation & { page?: Page } = {}) {
    if (this.sessions.size + this.opening >= this.maxSessions) throw new BrowserError('SESSION_LIMIT', 'Close an existing browser session before opening another.');
    const address = new URL(url);
    if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) throw new BrowserError('INVALID_URL', 'Use an HTTP(S) URL without embedded credentials.');
    const id = randomUUID();
    this.opening++;
    const dir = join(this.root, id);
    try { await mkdir(dir, { recursive: true, mode: 0o700 }); }
    catch (caught) { const error = asError(caught); this.opening--; throw error; }
    const session: Session = { id, dir, core: undefined!, data: {}, typedApplied: {}, view: { id: '', url: '', title: '', elements: [], texts: [], truncated: false, truncatedElements: false, truncatedTexts: false, scroll: { y: 0, maxY: 0, height: 0 }, validation: [] }, settings: { maxSteps: 35, maxCalls: 20, maxTokens: 800000, timeoutMs: 60000 }, touched: Date.now(), busy: false, closed: false, status: 'open', reason: 'session_created', objective: '', values: {}, questions: [], facts: [], history: [], notes: [], needs: [], applied: {}, redactions, limitations: [], allowCommit: false,
      artifacts: { report: join(dir, 'report.json'), memory: join(dir, 'memory.json'), trace: join(dir, 'trace.jsonl'), screenshot: join(dir, 'screen.png') } };
    const provider: DecisionEngine = { decide: (...args) => (session.provider ??= this.engineFactory(session)).decide(...args) };
    const options: BrowserLaunchOptions = { engine: this.wrapEngine(session, provider), headless: !headed, contextOptions: { viewport: { width: 1600, height: 1100 } }, timeoutMs: 60000,
      allowAction: async plan => {
        const allowed = session.allowCommit || !(plan.action.kind === 'dialog' || noWriteWords.test(plan.action.target?.name ?? '') || plan.action.target?.inputType === 'submit');
        await this.event(session, { kind: 'action-proposed', action: plan.action, allowed });
        return allowed;
      },
    };
    try {
      session.core = page ? new JevBrowser({ ...options, page }) : await this.launch(options);
      if (!page || page.url() !== url) await session.core.goto(url, { signal });
      this.sessions.set(id, session);
      await this.capture(session);
      await this.persist(session);
      return compactReport(session);
    } catch (caught) { const error = asError(caught); await session.core?.close(); this.sessions.delete(id); throw error; }
    finally { this.opening--; }
  }

  async capture(session: Session) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { session.view = { ...await session.core.snapshot({ timeoutMs: 5000 }), validation: [] }; break; }
      catch (caught) { const error = asError(caught);
        if (!['STALE_SNAPSHOT', 'STALE_TARGET'].includes(error.code ?? '') || attempt === 2) throw error;
        await session.core.page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => {});
      }
    }
    session.view = this.scrub(session, session.view);
    session.view.validation = [];
    for (const frame of session.core.page.frames()) {
      const invalid = await frame.locator('[aria-invalid="true"]').evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0).slice(0, 20).map(element => {
        const textFor = (attribute: string) => (element.getAttribute(attribute) ?? '').split(/\s+/).map(id => element.ownerDocument.getElementById(id)?.textContent ?? '').join(' ').trim();
        const labels = element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement ? Array.from(element.labels ?? []).map(label => label.textContent).join(' ') : '';
        return { field: element.getAttribute('aria-label') || textFor('aria-labelledby') || labels || 'Unlabelled control', message: textFor('aria-errormessage') || textFor('aria-describedby') || 'The application marks this control invalid.' };
      })).catch(() => []);
      session.view.validation.push(...this.scrub(session, invalid));
    }
    for (const fact of session.facts) if (fact.origin === 'observed') fact.current = fact.url === session.view.url && session.view.texts.some(text => text.text === fact.evidence?.text && text.context === fact.evidence?.context && text.frame === fact.evidence?.frame);
    await this.event(session, { kind: 'snapshot', snapshot: session.view });
  }

  rememberResult(session: Session, result?: RunResult) {
    if (result?.effects?.some(effect => effect.kind === 'commit')) session.pendingEffect = result.effects.some(effect => effect.kind === 'commit' && effect.status === 'unknown');
    for (const step of result?.steps ?? []) session.history.push({ action: actionText(step.plan.action), outcome: `Browser action ${step.status}; page ${short(step.url, 160)}`, source: 'browser-action' });
    for (const input of result?.inputs ?? []) {
      const target = result?.steps?.findLast(step => step.plan.action.valueKey === input.path)?.plan.action.target;
      if (input.applied) session.applied[input.path] = { role: target?.role, name: target?.name, frame: target?.frame, readback: input.readback };
    }
    if (result) session.history.push({ action: 'goal_run', outcome: `${result.status}: ${result.reason}`, source: 'runtime' });
  }

  async remainingValues(session: Session) {
    const omitted = new Set();
    for (const [path, value] of flatten(session.values)) {
      const prior = session.applied[path];
      if (!prior) continue;
      const candidates = session.view.elements.filter(element => element.role === prior.role && element.name === prior.name && element.frame === prior.frame);
      if (candidates.length === 0) { omitted.add(path); continue; }
      if (candidates.length !== 1 || typeof value !== 'string') continue;
      try {
        await session.core.native({ command: 'assert', ref: candidates[0].id, property: 'value', expected: value }, { timeoutMs: 100 });
        omitted.add(path);
      } catch { delete session.applied[path]; }
    }
    const copy = (value: Values, path = ''): Values => Object.fromEntries(Object.entries(value).flatMap(([key, item]): [string, RunValue][] => {
      const next = path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1');
      if (omitted.has(next)) return [];
      if (item && typeof item === 'object' && !Array.isArray(item)) { const nested = copy(item, next); return Object.keys(nested).length ? [[key, nested]] : []; }
      return [[key, item]];
    }));
    return copy(session.values);
  }

  async explore(args: ExploreArgs, { signal }: Operation = {}) {
    const data = dataSchema.parse(args.data ?? {});
    if (Object.keys(data).length && Object.keys(args.values ?? {}).length) throw new BrowserError('INVALID_INPUT', 'Use either data or legacy values in one exploration.');
    let id = args.sessionId;
    if (!id) {
      const opened = await this.open({ url: args.url ?? '', headed: args.headed ?? false });
      id = opened.sessionId;
    }
    return this.exclusive(id, async session => {
      if (session.pendingEffect) throw new BrowserError('EFFECT_UNRESOLVED', 'Inspect the last submission and resolve its outcome with jev_continue before starting another objective.');
      session.objective = args.objective;
      session.values = args.values ?? {};
      session.data = data;
      session.typedApplied = {};
      for (const [path, value] of flatten(session.values)) if (/password|secret|api.?key|access.?token/i.test(path) && typeof value === 'string') session.redactions.push(value);
      session.questions = args.questions ?? [];
      session.applied = {};
      session.notes = [];
      session.allowCommit = args.allowCommit ?? false;
      session.settings = { maxSteps: args.maxSteps ?? 35, maxCalls: args.maxCalls ?? 20, maxTokens: args.maxTokens ?? 800000, timeoutMs: args.timeoutMs ?? 60000 };
      return this.execute(session, signal);
    });
  }

  async continue(id: string, { note = '', values = {}, data = {}, facts = [], effectResolution }: ContinueArgs = {}, { signal }: Operation = {}) {
    const supplied = dataSchema.parse(data);
    return this.exclusive(id, async session => {
      if ((Object.keys(supplied).length && Object.keys(session.values).length) || (Object.keys(values).length && Object.keys(session.data).length) || (Object.keys(supplied).length && Object.keys(values).length)) throw new BrowserError('INVALID_INPUT', 'Use either data or legacy values in one exploration.');
      if (!session.objective) throw new BrowserError('NO_OBJECTIVE', 'Start an exploration before continuing it.');
      if (session.pendingEffect) {
        if (!effectResolution || !note.trim()) throw new BrowserError('EFFECT_UNRESOLVED', 'The last submission has an unknown outcome. Inspect it, then supply effectResolution and an evidence-backed note; do not replay it blindly.');
        session.pendingEffect = false;
        session.notes.push(note);
        session.history.push({ action: 'supervisor effect resolution', outcome: effectResolution + ': ' + note, source: 'supervisor' });
        if (effectResolution === 'confirmed') {
          session.status = 'ready_for_review'; session.reason = 'effect_confirmed_by_supervisor'; session.needs = [];
          await this.capture(session); await this.persist(session);
          return compactReport(session);
        }
      } else if (effectResolution) throw new BrowserError('NO_PENDING_EFFECT', 'There is no unresolved submission to confirm.');
      session.data = { ...session.data, ...supplied };
      const merge = (left: Values, right: Values): Values => {
        const output = { ...left };
        for (const [key, value] of Object.entries(right)) Object.defineProperty(output, key, { value: value && typeof value === 'object' && !Array.isArray(value) ? merge(record(Object.hasOwn(left, key) ? left[key] : {}) as Values, value) : value, enumerable: true, writable: true, configurable: true });
        return output;
      };
      for (const [path] of flatten(values)) delete session.applied[path];
      session.values = merge(session.values, values);
      for (const [path, value] of flatten(values)) if (/password|secret|api.?key|access.?token/i.test(path) && typeof value === 'string') session.redactions.push(value);
      if (note) session.notes.push(note);
      for (const fact of facts) session.facts.push({ ...fact, origin: 'caller', current: false, observedAt: new Date().toISOString() });
      for (const fact of session.facts) if (fact.origin === 'observed') fact.current = false;
      return this.execute(session, signal);
    });
  }

  async execute(session: Session, signal?: AbortSignal) {
    const started = performance.now();
    session.active = { ...session.settings, browserActions: 0, calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0, elapsedMs: 0, observationRetries: 0, observations: [], repetitions: new Map() };
    session.status = 'running'; session.reason = 'exploring'; session.needs = []; session.workflow = undefined;
    const deadline = Date.now() + session.settings.timeoutMs;
    const runSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(session.settings.timeoutMs)]) : AbortSignal.timeout(session.settings.timeoutMs);
    let result: RunResult | undefined;
    try {
      await this.capture(session);
      const currentValues = await this.remainingValues(session);
      const instructions = session.objective + '\nThis is browser exploration. If information or a required value is missing, stop and retain the current page. Do not invent values. Prior applied inputs and supervised discoveries are supplied in explorationMemory. Do not restart or repeat completed effects. ' + (session.allowCommit ? 'Only perform submission effects explicitly requested by this objective.' : 'Do not save, send, purchase, delete or submit business records. Read-only navigation, search and editing filters are allowed. Submitting a search/filter request solely to retrieve results is an advance/navigation action, not a business-record commit.');
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          result = Object.keys(session.data).length ? await this.runTyped(session, instructions, runSignal, deadline) : await session.core.run(instructions, { values: currentValues, maxSteps: session.settings.maxSteps, maxDecisions: session.settings.maxCalls, timeoutMs: Math.max(1, deadline - Date.now()), decisionRetries: 0, signal: runSignal });
          this.rememberResult(session, result);
          break;
        } catch (caught) { const error = asError(caught);
          this.rememberResult(session, error.partial);
          await this.event(session, { kind: 'run-error', error: errorInfo(error), partial: error.partial });
          const unsafe = error.partial?.effects?.some(effect => effect.kind === 'commit' || effect.status === 'unknown');
          if (!['STALE_SNAPSHOT', 'STALE_TARGET'].includes(error.code ?? '') || attempt === 2 || unsafe) throw error;
          session.active!.observationRetries++;
          await this.capture(session);
          session.notes.push('Observation changed during navigation. The same browser is still open. Continue from its current state; the earlier actions were not replayed by the supervisor.');
        }
      }
      await this.capture(session);
      session.workflow = result ? { status: result.status, reason: result.reason } : undefined;
      session.status = result?.reason === 'missing-input' ? 'needs_input' : 'needs_review';
      session.reason = result?.reason ?? 'no_result';
      const requiredMissing = session.view.elements.filter(element => element.required && element.filled === false && !element.disabled);
      if (session.view.validation.length) {
        session.status = 'needs_review'; session.reason = 'validation_observed';
      } else if (result?.status !== 'complete' && (result?.inputs?.some(input => input.applied) || Object.keys(session.typedApplied).length > 0) && requiredMissing.length) {
        session.status = 'needs_input';
        session.reason = 'missing_input_observed';
      }
      if (session.questions.length) {
        const fields = Object.fromEntries(session.questions.map(question => [question.key, z.string().describe(question.question)]));
        try {
          const extracted = await session.core.extract('Answer these questions using only verbatim source passages visible on the current page. Preserve the relevant record and its context; never infer a missing answer.', z.object(fields), { timeoutMs: Math.max(1, deadline - Date.now()), signal: runSignal });
          for (const question of session.questions) {
            session.facts = session.facts.filter(fact => fact.key !== question.key || fact.origin !== 'observed');
            session.facts.push({ key: question.key, value: extracted.data[question.key], evidence: extracted.evidence[question.key], url: session.view.url, origin: 'observed', current: true, observedAt: new Date().toISOString() });
          }
          if (session.status !== 'needs_input' && ['model-complete', 'verified', 'ui-readback', 'no-match'].includes(session.reason)) { session.status = 'ready_for_review'; session.reason = 'source_evidence_collected'; }
        } catch (caught) { const error = asError(caught);
          session.needs.push(`Evidence extraction: ${error.code ?? 'failed'}. ${short(error.message, 160)}`);
          if (error.code === 'BUDGET_EXHAUSTED') { session.status = 'budget_exhausted'; session.reason = 'BUDGET_EXHAUSTED'; }
          await this.event(session, { kind: 'extraction-error', error: errorInfo(error) });
        }
      }
      if (result?.status === 'complete' && result.verification?.source === 'caller') { session.status = 'verified'; session.reason = result.reason; }
      if (session.status !== 'ready_for_review' && session.status !== 'verified') {
        if (session.pendingEffect) session.needs.push('Inspect whether the last submission took effect. Resolve it with jev_continue effectResolution before any retry.');
        for (const invalid of session.view.validation) session.needs.push(`${invalid.field}: ${invalid.message}`);
        for (const element of session.view.elements.filter(element => element.required && element.filled === false && !element.disabled)) session.needs.push(`Required field without a confirmed value: ${element.name}`);
        const messages = session.view.texts.filter(text => ['alert', 'status'].includes(text.role)).map(text => text.text);
        session.needs.push(...messages);
        if (!session.needs.length) session.needs.push(`Inspect the current page before continuing: ${session.reason}.`);
      }
    } catch (caught) { const error = asError(caught);
      session.status = error.code === 'BUDGET_EXHAUSTED' ? 'budget_exhausted' : error.code === 'INPUT_MISSING' ? 'needs_input' : 'needs_review';
      session.reason = error.code ?? (runSignal.aborted ? 'CANCELLED' : 'OPERATION_FAILED');
      session.needs.push(errorInfo(error).message);
      await this.event(session, { kind: 'handoff-error', error: errorInfo(error) });
    } finally {
      session.active!.elapsedMs = Math.round(performance.now() - started);
      await this.capture(session).catch(error => session.limitations.push(`Final observation unavailable: ${asError(error).code ?? 'error'}`));
      await writeFile(session.artifacts.screenshot, await session.core.screenshot(), { mode: 0o600 }).catch(() => session.limitations.push('Screenshot unavailable.'));
      await this.persist(session);
    }
    return compactReport(session);
  }

  async runTyped(session: Session, instructions: string, signal: AbortSignal, deadline: number): Promise<RunResult> {
    const engine = this.wrapEngine(session, { decide: (...args) => (session.provider ??= this.engineFactory(session)).decide(...args) });
    const combined: RunResult = { status: 'stopped', reason: 'step-limit', steps: [], effects: [] };
    try {
      let steps = session.active!.browserActions;
      while (steps < session.settings.maxSteps) {
        signal.throwIfAborted();
        await this.capture(session);
        const operation = { signal, timeoutMs: Math.max(1, deadline - Date.now()) };
        const beforeSteps = steps;
        const filled = await fillTypedData({ core: session.core, snapshot: session.view, data: session.data, applied: session.typedApplied, objective: instructions, engine, operation, authorize: element => session.allowCommit || !(noWriteWords.test(element.name) || element.inputType === 'submit'),
          act: async (command, target) => {
            signal.throwIfAborted();
            if (steps >= session.settings.maxSteps) throw new BrowserError('INPUT_STEP_LIMIT', 'The typed interaction exhausted the browser action budget.');
            if (!session.allowCommit && (noWriteWords.test(target.name) || target.inputType === 'submit')) throw new BrowserError('ACTION_DENIED', 'This exploration did not authorize the selected widget effect.');
            steps++; session.active!.browserActions = steps;
            await session.core.native(command, { signal, timeoutMs: Math.max(1, deadline - Date.now()) });
            await this.event(session, { kind: 'typed-action', command: command.command, target: target.name });
          },
          record: async entry => {
            session.history.push({ action: `fill ${entry.field} from data.${entry.key}${entry.format ? ' as ' + entry.format : ''}`, outcome: entry.outcome, source: 'typed-input' });
            await this.event(session, { kind: 'typed-input', ...entry });
          },
        });
        if (filled.filled) { if (steps === beforeSteps) steps++; session.active!.browserActions = steps; continue; }
        const next = await session.core.run(instructions + '\nTyped data filling is handled separately. Continue navigation or finish if the objective is met. Do not invent or type additional values.', { maxSteps: 1, maxDecisions: session.settings.maxCalls, decisionRetries: 0, ...operation });
        steps += Math.max(1, next.steps.length); session.active!.browserActions = steps;
        combined.steps.push(...next.steps);
        combined.effects!.push(...next.effects ?? []);
        combined.status = next.status;
        combined.reason = next.reason;
        combined.verification = next.verification;
        if (next.reason !== 'step-limit' || next.effects?.some(effect => effect.kind === 'commit')) return combined;
      }
      combined.status = 'stopped'; combined.reason = 'step-limit';
      return combined;
    } catch (caught) {
      const error = asError(caught);
      error.partial = { ...combined, ...error.partial, steps: [...combined.steps, ...error.partial?.steps ?? []], effects: [...combined.effects ?? [], ...error.partial?.effects ?? []] };
      throw error;
    }
  }

  async inspect(id: string, { targets = false, screenshot = false, offset = 0 }: { targets?: boolean; screenshot?: boolean; offset?: number } = {}) {
    return this.exclusive(id, async session => {
      await this.capture(session);
      const result = compactReport(session, { targets, offset });
      if (screenshot) result.image = (await session.core.screenshot()).toString('base64');
      return result;
    });
  }

  async act(id: string, command: NativeCommand, { signal }: Operation = {}) {
    return this.exclusive(id, async session => {
      if ('ref' in command && command.ref && !session.view?.elements.some(element => element.id === command.ref)) throw new BrowserError('STALE_TARGET', 'Inspect targets and use a current observed ref.');
      const target = session.view?.elements.find(element => element.id === ('ref' in command ? command.ref : undefined));
      if (session.pendingEffect && ((command.command === 'click' && noWriteWords.test(target?.name ?? '')) || (command.command === 'press_key' && command.key === 'Enter'))) throw new BrowserError('EFFECT_UNRESOLVED', 'Resolve the previous submission before another submit attempt.');
      if (target?.inputType === 'password' && 'text' in command && typeof command.text === 'string') session.redactions.push(command.text);
      if (!session.allowCommit && command.command === 'click' && noWriteWords.test(target?.name ?? '')) throw new BrowserError('ACTION_DENIED', 'This exploration did not authorize submissions.');
      const result = await session.core.native(command, { signal });
      if (['navigate', 'navigate_back', 'navigate_forward', 'reload'].includes(command.command)) session.applied = {};
      session.history.push({ action: `supervisor ${command.command} ${target?.role ?? ''} ${target?.name ?? ''}`.trim(), outcome: 'Native operation returned; the page must be observed to establish its effect.', source: 'supervisor' });
      await this.capture(session);
      await this.persist(session);
      return compactReport(session);
    });
  }

  async close(id: string) {
    return this.exclusive(id, async session => {
      await session.core.close(); session.closed = true; session.status = 'closed'; session.reason = 'session_closed';
      await this.persist(session); this.sessions.delete(id);
      return { sessionId: id, status: 'closed', artifacts: session.artifacts };
    });
  }

  async shutdown() {
    clearInterval(this.timer);
    for (const session of this.sessions.values()) { await session.core.close().catch(() => {}); session.closed = true; session.status = 'closed'; session.reason = 'server_shutdown'; await this.persist(session).catch(() => {}); }
    this.sessions.clear();
  }
}
