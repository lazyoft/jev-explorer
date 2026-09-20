import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateRequest, REQUEST_BUDGET } from '../dist/request-budget.js';
import { JevDecisionEngine } from '../dist/decision.js';
import { decideFrontier, emptyDecisionUsage } from '../dist/frontier.js';

const question = (size = 0) => ({ type: 'choice', instructions: 'Judge only the supplied observation. ' + 'x'.repeat(size), criteria: { yes: 'Yes', no: 'No' } });
const options = () => ({ signal: new AbortController().signal, usage: emptyDecisionUsage() });
const reply = request => ({ answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, { choice: 'yes', confidence: 0.9 }])) });

test('request estimates account for UTF-8 and the state plus longest question separately', () => {
  const ascii = estimateRequest({ state: 'a'.repeat(1000), questions: { q: question() } });
  const unicode = estimateRequest({ state: '界'.repeat(1000), questions: { q: question() } });
  assert.ok(unicode.stateTokens > ascii.stateTokens);
  const request = { state: 'a'.repeat(40000), questions: { short: question(100), long: question(7000) } };
  const estimate = estimateRequest(request);
  assert.ok(estimate.bytes < REQUEST_BUDGET.maxBytes);
  assert.ok(estimate.totalTokens < REQUEST_BUDGET.maxTotalTokens);
  assert.ok(estimate.stateAndQuestionTokens > REQUEST_BUDGET.maxStateAndQuestionTokens);
  assert.equal(estimate.longestQuestion, 'long');
  assert.equal(estimate.fits, false);
});

test('a batch over the total token estimate is split without dropping questions or altering state', async () => {
  const raw = { state: { source: 'x'.repeat(1000) }, questions: Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['q' + i, question(8000)])) };
  const before = structuredClone(raw);
  assert.ok(estimateRequest(raw).totalTokens > REQUEST_BUDGET.maxTotalTokens);
  assert.ok(estimateRequest(raw).stateAndQuestionTokens < REQUEST_BUDGET.maxStateAndQuestionTokens);
  const sent = [];
  const result = await decideFrontier({ async decide(request) { sent.push(request); return reply(request); } }, raw, options());
  assert.ok(sent.length > 1);
  for (const part of sent) { assert.equal(estimateRequest(part).fits, true); assert.deepEqual(part.state, raw.state); }
  assert.deepEqual(Object.keys(result.answers), Object.keys(raw.questions));
  assert.deepEqual(raw, before);
});

test('one over-budget question stops every batch before any provider call', async () => {
  let calls = 0;
  const raw = { state: 'x'.repeat(40000), questions: { small: question(), big: question(8000) } };
  await assert.rejects(decideFrontier({ async decide() { calls++; return { answers: {} }; } }, raw, options()), { code: 'OBSERVATION_LIMIT' });
  assert.equal(calls, 0);
});

test('the final provider boundary also rejects an oversized direct request before HTTP', async () => {
  let calls = 0;
  const provider = new JevDecisionEngine({ apiKey: 'test-only', fetch: async () => { calls++; return Response.json({}); } });
  await assert.rejects(provider.decide({ state: 'x'.repeat(50000), questions: { q: question() } }), { code: 'OBSERVATION_LIMIT' });
  assert.equal(calls, 0);
});

test('an API token rejection remains identifiable even when a local estimate fitted', async () => {
  let calls = 0;
  const provider = new JevDecisionEngine({ apiKey: 'test-only', fetch: async () => { calls++; return Response.json({ detail: { error_type: 'max_tokens_exceeded' } }, { status: 400 }); } });
  await assert.rejects(provider.decide({ state: 'Small fixture', questions: { q: question() } }), error => error.code === 'PROVIDER_CONTEXT_LIMIT' && error.message.includes('max_tokens_exceeded'));
  assert.equal(calls, 1);
});
