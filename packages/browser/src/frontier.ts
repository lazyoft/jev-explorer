// Modified by lazyoft: prepare and compact requests before conservative token and byte checks.
import { estimateRequest, assertRequestBudget } from './request-budget.js';
import { compactDecision } from './decision-context.js';
import { BrowserError } from './errors.js';
import type { DecisionEngine, DecisionRequest, DecisionResult } from './decision.js';

export interface DecisionUsage {
  requests: number;
  questions: number;
  serialDecisionDepth: number;
  inputTokens: number;
  outputTokens: number;
  providerMs: number;
}

export const emptyDecisionUsage = (): DecisionUsage => ({
  requests: 0,
  questions: 0,
  serialDecisionDepth: 0,
  inputTokens: 0,
  outputTokens: 0,
  providerMs: 0,
});

const MAX_QUESTIONS = 64;

export function prepareDecisionParts(request: DecisionRequest, engine: DecisionEngine): DecisionRequest[] {
  const entries = Object.entries(request.questions);
  const result: DecisionRequest[] = [];
  for (let offset = 0; offset < entries.length;) {
    let count = Math.min(MAX_QUESTIONS, entries.length - offset);
    let candidate: DecisionRequest | undefined;
    while (count >= 1) {
      candidate = { state: request.state, questions: Object.fromEntries(entries.slice(offset, offset + count)) };
      candidate = engine.prepare ? engine.prepare(candidate) : compactDecision(candidate);
      if (estimateRequest(candidate).fits) break;
      if (count === 1) assertRequestBudget(candidate);
      count = Math.max(1, Math.floor(count / 2));
    }
    result.push(candidate!);
    offset += count;
  }
  return result;
}

export async function decideFrontier(
  engine: DecisionEngine,
  request: DecisionRequest,
  options: { signal: AbortSignal; usage: DecisionUsage; maxRequests?: number; maxRetries?: number },
): Promise<DecisionResult> {
  const entries = Object.entries(request.questions);
  if (!entries.length) return { answers: {} };
  options.signal.throwIfAborted();
  const parts = prepareDecisionParts(request, engine);
  if (options.maxRequests !== undefined && options.usage.requests + parts.length > options.maxRequests)
    throw new BrowserError('DECISION_LIMIT', 'The operation exhausted its decision request budget.');

  options.usage.serialDecisionDepth++;
  options.usage.requests += parts.length;
  options.usage.questions += entries.length;
  const started = performance.now();
  let results: DecisionResult[];
  try {
    results = await Promise.all(parts.map(part => engine.decide(part, { signal: options.signal, maxRetries: options.maxRetries })));
  } finally {
    options.usage.providerMs += performance.now() - started;
  }
  options.signal.throwIfAborted();

  const answers: DecisionResult['answers'] = {};
  let model: string | undefined;
  let inputTokens = 0, outputTokens = 0;
  for (const [partIndex, part] of parts.entries()) {
    const result = results[partIndex]!;
    if (model === undefined) model = result.model;
    else if (result.model !== model) model = undefined;
    inputTokens += result.usage?.input_tokens ?? 0;
    outputTokens += result.usage?.output_tokens ?? 0;
    for (const [id, question] of Object.entries(part.questions)) {
      const answer = result.answers[id];
      if (!answer || !Object.hasOwn(question.criteria, answer.choice) || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)
        throw new BrowserError('INVALID_DECISION', 'A frontier decision was missing, invalid, or outside its offered candidates.');
      answers[id] = answer;
    }
  }
  options.usage.inputTokens += inputTokens;
  options.usage.outputTokens += outputTokens;
  return {
    answers,
    ...(model ? { model } : {}),
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    elapsedMs: performance.now() - started,
  };
}
