import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Session } from './types.js';

export function redact(secrets: string[], value: unknown): unknown {
  if (!secrets.length) return value;
  let encoded = JSON.stringify(value);
  for (const secret of secrets) {
    if (!secret) continue;
    encoded = encoded.replaceAll(JSON.stringify(secret).slice(1, -1), '[redacted]');
  }
  return JSON.parse(encoded);
}

export async function trace(session: Session, entry: Record<string, unknown>) {
  const line = JSON.stringify(redact(session.secrets, { at: new Date().toISOString(), ...entry }));
  await appendFile(session.artifacts.trace, line + '\n', { mode: 0o600 }).catch(() => {});
}

export async function saveObservation(session: Session) {
  const body = JSON.stringify(redact(session.secrets, session.observation), null, 2);
  await writeFile(session.artifacts.observation, body, { mode: 0o600 }).catch(() => {});
}

export const sessionDir = (root: string, id: string) => join(root, id);
