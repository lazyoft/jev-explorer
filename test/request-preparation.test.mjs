import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserExplorer } from '../dist/explore-browser.js';
import { compactDecision } from '@lazyoft/jev-browser';
import { decideFrontier, emptyDecisionUsage } from '../packages/browser/dist/frontier.js';

const options = () => ({ signal: new AbortController().signal, usage: emptyDecisionUsage() });
const request = () => {
  const context = 'Observed detail including the exact value 9.5 and the label Cleanliness. '.repeat(20);
  const elements = Array.from({ length: 100 }, (_, i) => ({ id: 'e' + i, role: 'link', name: 'Property ' + i, frame: 0, context }));
  const actions = Object.fromEntries(elements.map((target, i) => ['a' + i, { kind: 'click', target }]));
  return { state: { page: { elements, texts: [{ id: 't0', text: 'Cleanliness 9.5', context, frame: 0 }] }, actions }, questions: { action: { type: 'choice', instructions: 'Choose a property to inspect.', criteria: { ...actions, __none__: 'None' } } } };
};
const response = { answers: { action: { choice: 'a0', confidence: 0.9 } } };

test('oversized repeated observations are compacted before the local frontier byte check', async () => {
  const raw = request(); const before = structuredClone(raw); const received = [];
  assert.ok(Buffer.byteLength(JSON.stringify(raw)) > 128 * 1024);
  const result = await decideFrontier({ async decide(value) { received.push(value); return response; } }, raw, options());
  assert.equal(result.answers.action.choice, 'a0');
  assert.equal(received.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(received[0])) <= 128 * 1024);
  assert.deepEqual(raw, before);
  assert.equal(received[0].state.page.texts[0].text, 'Cleanliness 9.5');
  assert.equal(Object.keys(received[0].questions.action.criteria).length, 101);
});

test('explorer preparation includes memory before the size check and sends the checked object unchanged', async t => {
  const explorer = new BrowserExplorer(); t.after(() => explorer.shutdown());
  const events = []; explorer.event = async (_session, event) => events.push(event);
  const session = { redactions: [], objective: 'Inspect the matching property', facts: [], history: [], notes: ['Keep dates unchanged'], active: { calls: 0, maxCalls: 5, inputTokens: 0, maxTokens: 100000, outputTokens: 0, failedCalls: 0, observations: [], repetitions: new Map() } };
  let sent;
  const wrapped = explorer.wrapEngine(session, { async decide(value) { sent = value; return response; } });
  const raw = request(); const before = structuredClone(raw); let checked;
  const engine = { prepare(value) { checked = wrapped.prepare(value); return checked; }, decide: wrapped.decide };
  await decideFrontier(engine, raw, options());
  assert.equal(sent, checked);
  assert.equal(sent.state.explorationMemory.objective, session.objective);
  assert.deepEqual(sent.state.explorationMemory.supervisorNotes, session.notes);
  assert.ok(Buffer.byteLength(JSON.stringify(sent)) <= 128 * 1024);
  assert.deepEqual(raw, before);
  assert.equal(session.active.calls, 1);
  assert.equal(events.filter(event => event.kind === 'decision-request').length, 1);
  assert.equal(session.active.lastAction, JSON.stringify(raw.questions.action.criteria.a0));
});

test('irreducible data and oversized prepared memory stop before any provider call', async t => {
  let calls = 0;
  const decide = async () => { calls++; return response; };
  const raw = { state: { content: 'x'.repeat(140000) }, questions: request().questions };
  await assert.rejects(decideFrontier({ decide }, raw, options()), { code: 'OBSERVATION_LIMIT' });
  const small = { state: {}, questions: { action: { type: 'choice', criteria: { a0: 'Continue' } } } };
  await assert.rejects(decideFrontier({ prepare: value => compactDecision({ ...value, state: { content: 'x'.repeat(140000) } }), decide }, small, options()), { code: 'OBSERVATION_LIMIT' });
  assert.equal(calls, 0);
});
