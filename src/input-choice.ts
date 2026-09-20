import { BrowserError } from '@lazyoft/jev-browser';
import type { DecisionEngine } from '@lazyoft/jev-browser';

export function chosen(result: Awaited<ReturnType<DecisionEngine['decide']>>, key: string, criteria: Record<string, unknown>, minConfidence = 0.7): string {
  const answer = result.answers[key];
  if (!answer || !Object.hasOwn(criteria, answer.choice)) throw new BrowserError('INVALID_DECISION', 'The decision did not identify an offered choice.');
  if (answer.confidence < minConfidence) throw new BrowserError('INPUT_AMBIGUOUS', 'The input decision needs supervisor review.');
  return answer.choice;
}
