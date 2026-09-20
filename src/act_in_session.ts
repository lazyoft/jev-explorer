import { perform, readBack, readObservation, settle } from './browser/client.js';
import { blocked } from './domain/errors.js';
import { buildReport, type Report } from './domain/report.js';
import { saveObservation, trace } from './domain/trace.js';
import type { SessionStore } from './domain/sessions.js';

export interface ActRequest {
  sessionId: string;
  ref: string;
  text?: string | undefined;
}

export async function actInSession(store: SessionStore, request: ActRequest): Promise<Report> {
  return store.exclusive(request.sessionId, async session => {
    const action = session.observation.actions.find(item => item.ref === request.ref);
    if (!action) throw blocked('UNKNOWN_CONTROL', 'That control is not in the last view of the page. Inspect the page again and use a fresh reference.');
    if (action.kind === 'type' && request.text === undefined) throw blocked('NO_TEXT', 'This control needs text. Send the text to type.');
    if (action.inputType === 'password' && request.text) session.secrets.push(request.text);

    await perform(session.page, action, request.text);
    await settle(session.page, 800);
    const label = `the supervisor did ${action.kind} on "${action.name}"`;
    session.steps.push({ action: label, outcome: (await readBack(session.page, action)) ?? 'done' });
    session.usage.steps++;
    await trace(session, { kind: 'supervisor-acted', action: label });

    session.observation = await readObservation(session.page);
    await saveObservation(session);
    return buildReport(session);
  });
}
