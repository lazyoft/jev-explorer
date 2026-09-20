import { readObservation } from './browser/client.js';
import { buildReport, type Report } from './domain/report.js';
import { saveObservation } from './domain/trace.js';
import type { SessionStore } from './domain/sessions.js';

export interface InspectRequest {
  sessionId: string;
  controls?: boolean | undefined;
  screenshot?: boolean | undefined;
  offset?: number | undefined;
}

export interface InspectResult extends Report {
  controls?: { ref: string; kind: string; role: string; name: string; value?: string }[];
  controlCount?: number;
  nextOffset?: number | null;
  image?: string;
}

export async function inspectSession(store: SessionStore, request: InspectRequest): Promise<InspectResult> {
  return store.exclusive(request.sessionId, async session => {
    session.observation = await readObservation(session.page);
    await saveObservation(session);
    const result: InspectResult = buildReport(session);
    if (request.controls) {
      const offset = request.offset ?? 0;
      const page = session.observation.actions.slice(offset, offset + 40);
      result.controls = page.map(action => ({ ref: action.ref, kind: action.kind, role: action.role, name: action.name, ...(action.value ? { value: action.value } : {}) }));
      result.controlCount = session.observation.actions.length;
      result.nextOffset = offset + page.length < result.controlCount ? offset + page.length : null;
    }
    if (request.screenshot) result.image = (await session.page.screenshot()).toString('base64');
    return result;
  });
}
