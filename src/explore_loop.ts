import { perform, readBack, readObservation, settle } from './browser/client.js';
import { buildRequest, type Ask, type Answer, type Decider } from './jev/client.js';
import { sliceItems } from './jev/slices.js';
import { askAnswers, askBindings, askEffect, askNextAction, navigableActions, selectableFields, NEXT_SLICE, NONE, NOTHING, NOT_HERE, PREVIOUS_SLICE } from './jev/questions.js';
import { ExplorerError, needsDecision, needsValue, spent } from './domain/errors.js';
import { trace, saveObservation } from './domain/trace.js';
import type { Action, Effect, Session } from './domain/types.js';

const CONFIDENT = 0.7;
const ANSWER_CONFIDENT = 0.6;
const TEXT_LIMIT = 250;

function formatValue(value: string, field: Action): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (field.inputType === 'date') return value;
  if (!field.format) {
    throw needsValue('DATE_FORMAT_UNKNOWN', `The field "${field.name}" does not say how to write a date. Send the value written the way the website shows it.`);
  }
  const [year = '', month = '', day = ''] = value.split('-');
  return field.format.replace('yyyy', year).replace('mm', month).replace('dd', day);
}

const truthy = (value: string) => ['true', 'yes', 'on', '1'].includes(value.trim().toLowerCase());

export async function exploreLoop(session: Session, decider: Decider, signal: AbortSignal) {
  const started = Date.now();
  const deadline = started + session.budgets.timeoutMs;
  let lastMark = '';
  let staleRetries = 0;
  const unhelpful = new Set<string>();

  const ask = async (asks: Record<string, Ask>): Promise<Record<string, Answer>> => {
    if (session.usage.messages >= session.budgets.maxMessages) {
      throw spent('MESSAGE_BUDGET', 'The run used all the questions it was allowed. Raise the budget or narrow the goal.');
    }
    if (Date.now() > deadline) throw spent('TIME_BUDGET', 'The run used all its time. Raise the budget or narrow the goal.');
    session.usage.messages++;
    const result = await decider.ask(asks, signal);
    session.usage.inputTokens += result.inputTokens;
    session.usage.outputTokens += result.outputTokens;
    await trace(session, { kind: 'asked', request: buildRequest(asks), answers: result.answers });
    return result.answers;
  };

  const read = async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      signal.throwIfAborted();
      session.observation = await readObservation(session.page);
      const fromPage = session.observation.actions.filter(action => action.ref.includes(':')).length + session.observation.texts.filter(text => text.ref !== 'title').length;
      if (!session.observation.busy && fromPage > 0) break;
      await settle(session.page, 800);
    }
    await saveObservation(session);
  };

  const placeOneValue = async (): Promise<boolean> => {
    const pending = Object.keys(session.values).filter(name => !session.placed[name]);
    if (!pending.length) return false;
    const taken = new Set(Object.values(session.placed).map(placement => placement.ref));
    const fields = selectableFields(session.observation).filter(field => !taken.has(field.ref));
    if (!fields.length) return false;
    const answers = await ask(askBindings(session, pending, fields));
    for (const name of pending) {
      const answer = answers['bind_' + name];
      if (!answer || answer.id === NONE || answer.confidence < CONFIDENT) continue;
      const field = fields.find(item => item.ref === answer.id);
      if (!field) continue;
      const raw = session.values[name]!;
      const wanted = field.kind === 'check' ? String(truthy(raw)) : formatValue(raw, field);
      if (field.kind === 'check') await perform(session.page, { ...field, kind: truthy(raw) ? 'check' : 'uncheck' });
      else await perform(session.page, field, wanted);
      await settle(session.page, 400);
      const actual = await readBack(session.page, field);
      if (actual === null || actual.trim() !== wanted.trim()) {
        throw needsValue('VALUE_NOT_ACCEPTED', `The field "${field.name}" did not keep the value named "${name}". Check the value and send it again.`);
      }
      session.placed[name] = { ref: field.ref, name: field.name, value: wanted };
      session.steps.push({ action: `put the value "${name}" into "${field.name}"`, effect: 'change', outcome: 'the field kept the value' });
      session.usage.steps++;
      await trace(session, { kind: 'placed', value: name, field: field.name });
      return true;
    }
    return false;
  };

  const markOf = (action: Action) => session.observation.url + '|' + action.ref + '|' + action.name;

  const chooseAction = async (): Promise<Action | null> => {
    const bothPagingChoices = { number: 2, count: 3, allSeen: false };
    const offered = navigableActions(session.observation).filter(action => !unhelpful.has(markOf(action)));
    const slices = sliceItems(offered, group => ({ action: askNextAction(session, group, bothPagingChoices) }));
    const seen = new Set<number>();
    let index = 0;
    for (;;) {
      seen.add(index);
      const group = slices[index] ?? [];
      const answers = await ask({ action: askNextAction(session, group, { number: index + 1, count: slices.length, allSeen: seen.size === slices.length }) });
      const choice = answers.action!.id;
      if (choice === NEXT_SLICE && index + 1 < slices.length) { index++; continue; }
      if (choice === PREVIOUS_SLICE && index > 0) { index--; continue; }
      if (choice === NOTHING || choice === NEXT_SLICE || choice === PREVIOUS_SLICE) {
        const unseen = slices.findIndex((_slice, position) => !seen.has(position));
        if (unseen >= 0) { index = unseen; continue; }
        return null;
      }
      return group.find(item => item.ref === choice) ?? null;
    }
  };

  const collectAnswers = async (): Promise<boolean> => {
    if (!session.questions.length) return false;
    const texts = session.observation.texts.slice(0, TEXT_LIMIT);
    if (!texts.length) return false;
    const unanswered = () => session.questions.filter(item => !session.findings.some(finding => finding.key === item.key));
    for (const group of sliceItems(texts, part => askAnswers(session, part, unanswered()))) {
      const remaining = unanswered();
      if (!remaining.length) break;
      const answers = await ask(askAnswers(session, group, remaining));
      for (const item of remaining) {
        const answer = answers['answer_' + item.key];
        if (!answer || answer.id === NOT_HERE || answer.confidence < ANSWER_CONFIDENT) continue;
        const block = group.find(text => text.ref === answer.id);
        if (!block) continue;
        session.findings.push({ key: item.key, question: item.question, text: block.text, context: block.context, url: session.observation.url });
      }
    }
    return !unanswered().length;
  };

  try {
    for (;;) {
      signal.throwIfAborted();
      if (session.usage.steps >= session.budgets.maxSteps) throw spent('STEP_BUDGET', 'The run used all the steps it was allowed. Raise the budget or narrow the goal.');
      if (Date.now() > deadline) throw spent('TIME_BUDGET', 'The run used all its time. Raise the budget or narrow the goal.');

      await read();
      if (await placeOneValue()) continue;

      const action = await chooseAction();
      if (!action) {
        if (await collectAnswers()) {
          session.status = 'answered';
          session.need = 'Read the findings and their source text.';
          return;
        }
        const missing = session.observation.actions.find(item => item.required && item.filled === false);
        if (missing) throw needsValue('MISSING_VALUE', `The page asks for "${missing.name}" and no value was sent for it.`);
        session.status = 'needs_decision';
        session.need = 'No offered step moves toward the goal, and the answer is not on this page. Look at the page and decide.';
        return;
      }

      const mark = markOf(action);
      if (mark === lastMark && action.kind !== 'scroll') {
        unhelpful.add(mark);
        lastMark = '';
        session.steps.push({ action: `${action.kind} "${action.name}"`, effect: 'move', outcome: 'chosen twice with no change; not offered again' });
        continue;
      }
      lastMark = mark;

      let effect: Effect = 'move';
      if (action.kind !== 'scroll' && action.kind !== 'back') {
        const answers = await ask({ effect: askEffect(session, action) });
        effect = answers.effect!.id as Effect;
      }
      const label = `${action.kind} "${action.name}"`;

      if (effect === 'commit' && !session.commitAllowed) {
        throw needsDecision('COMMIT_NOT_ALLOWED', `The next step ${label} acts outside the page. Allow it, or take over.`);
      }

      try {
        await perform(session.page, action);
      } catch (error) {
        if (!(error instanceof ExplorerError) || error.code !== 'STALE_CONTROL' || ++staleRetries > 3) throw error;
        await trace(session, { kind: 'stale', action: label });
        lastMark = '';
        await settle(session.page, 800);
        continue;
      }
      await settle(session.page, 800);
      session.usage.steps++;
      await trace(session, { kind: 'acted', action: label, effect });

      if (effect === 'commit') {
        session.awaitingCommit = true;
        session.steps.push({ action: label, effect, outcome: 'done, but the outcome is not proven' });
        await read();
        session.status = 'needs_decision';
        session.need = `The step ${label} was done. Nothing proves its outcome yet. Check the page, then confirm it.`;
        return;
      }
      session.steps.push({ action: label, effect, outcome: 'done' });
    }
  } finally {
    session.usage.elapsedMs = Date.now() - started;
  }
}
