import { buildRequest, MAX_REQUEST_BYTES, type Ask } from './client.js';
import type { Action } from '../domain/types.js';

const bytes = (ask: Ask) => Buffer.byteLength(JSON.stringify(buildRequest({ probe: ask })), 'utf8');

export function sliceActions(actions: Action[], build: (actions: Action[]) => Ask): Action[][] {
  if (!actions.length) return [[]];
  if (bytes(build(actions)) <= MAX_REQUEST_BYTES) return [actions];
  const slices: Action[][] = [];
  let current: Action[] = [];
  for (const action of actions) {
    const candidate = [...current, action];
    if (current.length && bytes(build(candidate)) > MAX_REQUEST_BYTES) {
      slices.push(current);
      current = [action];
    } else current = candidate;
  }
  if (current.length) slices.push(current);
  return slices;
}
