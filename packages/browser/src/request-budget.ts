import type { DecisionRequest } from './decision.js';
import { BrowserError } from './errors.js';

export const REQUEST_BUDGET = Object.freeze({
  bytesPerToken: 2,
  requestOverheadTokens: 1024,
  questionOverheadTokens: 64,
  maxTotalTokens: 48000,
  maxStateAndQuestionTokens: 24000,
  maxBytes: 128 * 1024,
});

export function estimateRequest(request: DecisionRequest) {
  const estimate = (value: unknown) => Math.ceil(Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') / REQUEST_BUDGET.bytesPerToken);
  const stateTokens = estimate(request.state);
  const questions = Object.entries(request.questions).map(([id, question]) => ({ id, tokens: estimate(question) + REQUEST_BUDGET.questionOverheadTokens }));
  const longest = questions.reduce<{ id?: string; tokens: number }>((max, question) => question.tokens > max.tokens ? question : max, { tokens: 0 });
  const totalTokens = REQUEST_BUDGET.requestOverheadTokens + stateTokens + questions.reduce((sum, question) => sum + question.tokens, 0);
  const stateAndQuestionTokens = REQUEST_BUDGET.requestOverheadTokens + stateTokens + longest.tokens;
  const bytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
  return { method: 'utf8-bytes/2-plus-reserves', stateTokens, totalTokens, stateAndQuestionTokens, longestQuestion: longest.id, bytes,
    fits: totalTokens <= REQUEST_BUDGET.maxTotalTokens && stateAndQuestionTokens <= REQUEST_BUDGET.maxStateAndQuestionTokens && bytes <= REQUEST_BUDGET.maxBytes };
}

export class RequestBudgetError extends BrowserError {
  constructor(readonly estimate: ReturnType<typeof estimateRequest>) {
    super('OBSERVATION_LIMIT', `Conservative token estimate exceeds the request budget: state + longest question ${estimate.stateAndQuestionTokens}/${REQUEST_BUDGET.maxStateAndQuestionTokens}, total ${estimate.totalTokens}/${REQUEST_BUDGET.maxTotalTokens}, bytes ${estimate.bytes}/${REQUEST_BUDGET.maxBytes}. Narrow the observed scope; no provider call was made.`);
  }
}

export function assertRequestBudget(request: DecisionRequest) {
  const estimate = estimateRequest(request);
  if (!estimate.fits) throw new RequestBudgetError(estimate);
  return estimate;
}
