import type { SessionStore } from './domain/sessions.js';

export async function closeSession(store: SessionStore, sessionId: string) {
  const session = await store.close(sessionId);
  return { sessionId, status: 'closed', evidence: session.artifacts };
}
