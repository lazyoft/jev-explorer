import type { Ask, Choice } from './client.js';
import type { Action, Observation, Session, TextBlock } from '../domain/types.js';

export const NOTHING = '__nothing__';
export const NEXT_SLICE = '__next_slice__';
export const PREVIOUS_SLICE = '__previous_slice__';
export const NONE = '__none__';
export const NOT_HERE = '__not_here__';

const actionChoice = (action: Action): Choice => ({
  id: action.ref,
  label: [action.kind, action.role, action.name].filter(Boolean).join(' '),
  detail: {
    ...(action.context ? { context: action.context } : {}),
    ...(action.value ? { currentValue: action.value } : {}),
    ...(action.checked === undefined ? {} : { checked: action.checked }),
  },
});

const textChoice = (text: TextBlock): Choice => ({ id: text.ref, label: text.text, detail: { context: text.context } });

const history = (session: Session) => session.steps.slice(-8).map(step => step.action);

export function askNextAction(session: Session, actions: Action[], slice?: { number: number; count: number; allSeen: boolean }): Ask {
  const choices = actions.map(actionChoice);
  if (slice && slice.number < slice.count) choices.push({ id: NEXT_SLICE, label: 'show me the rest of this same page; this does not click anything' });
  if (slice && slice.number > 1) choices.push({ id: PREVIOUS_SLICE, label: 'show me the earlier part of this same page; this does not click anything' });
  choices.push({ id: NOTHING, label: 'nothing offered here moves toward the goal' });
  return {
    state: {
      goal: session.goal,
      page: { url: session.observation.url, title: session.observation.title },
      alreadyDone: history(session),
      valuesInHand: Object.keys(session.values),
      ...(slice ? { partOfPage: { number: slice.number, of: slice.count, wholePageSeen: slice.allSeen } } : {}),
    },
    question: 'Which one of these options moves toward the goal? Closing a pop-up, a banner or a cookie notice that covers the page also counts, because the page cannot be used until it is gone. Refuse what is optional rather than accept it, and never sign in or accept terms to get past it. Use what was already done, so the same step is not repeated. A missing option in this list is not proof that the website lacks it.',
    choices,
  };
}

export function askEffect(session: Session, action: Action): Ask {
  return {
    state: {
      goal: session.goal,
      action: { kind: action.kind, role: action.role, name: action.name, context: action.context },
      commitAllowed: session.commitAllowed,
    },
    question: 'What does this one action do? "move" goes to another view, opens a menu or scrolls. "change" edits a field, a filter or a search on this page. "commit" makes a durable change outside the page, such as save, send, buy, book or delete. A search or a filter is "change", never "commit".',
    choices: [
      { id: 'move', label: 'it moves to another view or reveals more of the page' },
      { id: 'change', label: 'it changes a field, a filter or a search on this page' },
      { id: 'commit', label: 'it saves, sends, buys, books, deletes or otherwise acts outside the page' },
    ],
  };
}

export function askBindings(session: Session, pending: string[], fields: Action[]): Record<string, Ask> {
  const choices = [...fields.map(actionChoice), { id: NONE, label: 'none of these fields takes this value' }];
  const asks: Record<string, Ask> = {};
  for (const name of pending) {
    asks['bind_' + name] = {
      state: { goal: session.goal, page: { url: session.observation.url, title: session.observation.title }, valueName: name },
      question: `Which field should receive the value named "${name}"? Keep roles apart, such as start and end, or first name and last name. Choose "none" when no field on this page takes it.`,
      choices,
    };
  }
  return asks;
}

export function askAnswers(session: Session, texts: TextBlock[], questions: Session['questions']): Record<string, Ask> {
  const choices = [...texts.map(textChoice), { id: NOT_HERE, label: 'this page does not hold the answer' }];
  const asks: Record<string, Ask> = {};
  for (const item of questions) {
    asks['answer_' + item.key] = {
      state: { goal: session.goal, page: { url: session.observation.url, title: session.observation.title } },
      question: `Which one of these text blocks answers this question: "${item.question}"? Choose the block that holds the answer itself, not its label. Choose "not here" rather than a block that only looks similar.`,
      choices,
    };
  }
  return asks;
}

export function selectableFields(observation: Observation): Action[] {
  return observation.actions.filter(action => ['type', 'select', 'check'].includes(action.kind));
}

export function navigableActions(observation: Observation): Action[] {
  return observation.actions.filter(action => ['click', 'scroll', 'back'].includes(action.kind) && action.onScreen !== false);
}
