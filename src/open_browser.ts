import { goto, readObservation } from './browser/client.js';
import { buildReport, type Report } from './domain/report.js';
import { saveObservation, trace } from './domain/trace.js';
import type { SessionStore } from './domain/sessions.js';

export interface OpenBrowserRequest {
  url: string;
  headed?: boolean | undefined;
}

export async function openBrowser(store: SessionStore, request: OpenBrowserRequest): Promise<Report> {
  const session = await store.create(request.headed ?? false);
  try {
    await goto(session.page, request.url);
    session.observation = await readObservation(session.page);
    await saveObservation(session);
    session.status = 'needs_decision';
    session.need = 'The browser is open on this page. Send a goal, or sign in yourself first.';
    await trace(session, { kind: 'opened', url: request.url });
    return buildReport(session);
  } catch (error) {
    await store.close(session.id).catch(() => {});
    throw error;
  }
}
