import { buildRequest, MAX_CHOICES, MAX_REQUEST_BYTES, type Ask } from './client.js';

const fits = (asks: Record<string, Ask>) =>
  Buffer.byteLength(JSON.stringify(buildRequest(asks)), 'utf8') <= MAX_REQUEST_BYTES
  && Object.values(asks).every(ask => ask.choices.length <= MAX_CHOICES);

export function sliceItems<T>(items: T[], build: (items: T[]) => Record<string, Ask>): T[][] {
  if (!items.length) return [[]];
  if (fits(build(items))) return [items];
  const slices: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    const candidate = [...current, item];
    if (current.length && !fits(build(candidate))) {
      slices.push(current);
      current = [item];
    } else current = candidate;
  }
  if (current.length) slices.push(current);
  return slices;
}
