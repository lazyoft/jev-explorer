import { perform, readBack, readObservation, settle } from './browser/client.js';
import { askEffect } from './jev/questions.js';
import { blocked, needsDecision } from './domain/errors.js';
import { buildReport, type Report } from './domain/report.js';
import { saveObservation, trace } from './domain/trace.js';
import type { Decider } from './jev/client.js';
import type { Effect } from './domain/types.js';
import type { SessionStore } from './domain/sessions.js';

export interface ActRequest {
  sessionId: string;
  ref: string;
  text?: string | undefined;
}

export async function actInSession(store: SessionStore, decider: Decider, request: ActRequest, signal: AbortSignal): Promise<Report> {
  return store.exclusive(request.sessionId, async session => {
    const action = session.observation.actions.find(item => item.ref === request.ref);
    if (!action) throw blocked('UNKNOWN_CONTROL', 'That control is not in the last view of the page. Inspect the page again and use a fresh reference.');
    if (session.awaitingCommit) throw needsDecision('CONFIRM_FIRST', 'Say whether the previous step happened before you act again.');
    if (action.kind === 'type' && request.text === undefined) throw blocked('NO_TEXT', 'This control needs text. Send the text to type.');
    if (action.inputType === 'password' && request.text) session.secrets.push(request.text);

    let effect: Effect = 'move';
    if (!['scroll', 'back', 'close-tab'].includes(action.kind)) {
      const answers = await decider.ask({ effect: askEffect(session, action) }, signal);
      session.usage.messages++;
      effect = answers.answers.effect!.id as Effect;
    }
    if (effect === 'commit' && !session.commitAllowed) {
      throw needsDecision('COMMIT_NOT_ALLOWED', `The action on "${action.name}" acts outside the page. Allow commits for this session first.`);
    }

    await perform(session.page, action, request.text);
    await settle(session.page, 800);
    const label = `the supervisor did ${action.kind} on "${action.name}"`;
    if (effect === 'commit') session.awaitingCommit = true;
    session.steps.push({ action: label, effect, outcome: effect === 'commit' ? 'done, but the outcome is not proven' : (await readBack(session.page, action)) ?? 'done' });
    session.usage.steps++;
    await trace(session, { kind: 'supervisor-acted', action: label, effect });

    session.observation = await readObservation(session.page);
    await saveObservation(session);
    session.status = effect === 'commit' ? 'needs_decision' : session.status;
    if (effect === 'commit') session.need = 'The action was done. Nothing proves its outcome yet. Check the page, then confirm it.';
    return buildReport(session);
  });
}
