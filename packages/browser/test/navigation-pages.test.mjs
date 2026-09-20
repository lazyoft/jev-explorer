import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideNavigationPages } from '../dist/navigation-pages.js';
import { decideFrontier, emptyDecisionUsage } from '../dist/frontier.js';
import { estimateRequest } from '../dist/request-budget.js';
import { compactDecision } from '../dist/decision-context.js';

function observation() {
  const elements = Array.from({ length: 60 }, (_, i) => ({ id: 'e' + i, name: i === 59 ? 'Wanted detail' : 'Other ' + i, role: 'button', frame: 0, context: ('Context ' + i + ' ').repeat(160) }));
  const texts = elements.map((e, i) => ({ id: 't' + i, text: 'Source ' + i, context: e.context, frame: 0 }));
  const actions = Object.fromEntries(elements.map((target, i) => ['a' + i, { kind: 'click', target }]));
  return { state: { task: 'Find the wanted detail.', history: [{ kind: 'click', target: { name: 'Earlier actual step' } }], page: { url: 'https://example.invalid', title: 'Fixture', elements, texts }, actions }, questions: { action: { type: 'choice', instructions: 'Choose an action.', criteria: { ...actions, __none__: 'No match', __done__: 'Done' } }, ...Object.fromEntries(elements.map((_, i) => ['effect_a' + i, { type: 'choice', instructions: 'Classify this effect.', criteria: { advance: 'Navigation', forbidden: 'Not authorized' } }])) } };
}
async function run(raw, pick, limit = 80) {
  const requests = [], usage = emptyDecisionUsage(), abort = new AbortController();
  const engine = { prepare: compactDecision, async decide(request) {
    requests.push(request);
    assert.equal(estimateRequest(request).fits, true);
    const answers = {};
    for (const [id, q] of Object.entries(request.questions)) {
      const choice = id === 'action' ? pick(request) : 'advance';
      assert.ok(Object.hasOwn(q.criteria, choice));
      answers[id] = { choice, confidence: 0.99 };
    }
    return { answers };
  } };
  const result = await decideNavigationPages(raw, engine, request => decideFrontier(engine, request, { signal: abort.signal, usage, maxRequests: limit }), abort.signal);
  return { result, requests };
}

test('later-page actions remain reachable with their original identity, objective and history', async () => {
  const raw = observation(), before = structuredClone(raw);
  const { result, requests } = await run(raw, request => Object.hasOwn(request.questions.action.criteria, 'a59') ? 'a59' : '__next_page__');
  assert.equal(result.answers.action.choice, 'a59');
  assert.ok(requests.length > 1);
  for (const request of requests) {
    assert.equal(request.state.task, raw.state.task);
    assert.deepEqual(request.state.history, raw.state.history);
    const visible = new Set(request.state.page.elements.map(e => e.id));
    for (const action of Object.values(request.state.actions)) assert.ok(visible.has(action.target?.id ?? action.target?.elementId));
  }
  assert.deepEqual(raw, before);
});

test('no-match advances through every page without dropping observed controls or text', async () => {
  const raw = observation();
  const { result, requests } = await run(raw, () => '__none__');
  assert.equal(result.answers.action.choice, '__none__');
  const pageIds = new Set(requests.map(request => request.state.pagination.pageNumber));
  assert.equal(pageIds.size, requests[0].state.pagination.pageCount);
  assert.deepEqual(new Set(requests.flatMap(request => request.state.page.elements.map(e => e.id))), new Set(raw.state.page.elements.map(e => e.id)));
  assert.deepEqual(new Set(requests.flatMap(request => request.state.page.texts.map(e => e.id))), new Set(raw.state.page.texts.map(e => e.id)));
  for (const request of requests) if (!request.state.pagination.wholeObservationInspected) assert.ok(!Object.hasOwn(request.questions.action.criteria, '__done__'));
});

test('backward paging is available and remains bounded by the existing inference budget', async () => {
  await assert.rejects(run(observation(), request => request.state.pagination.pageNumber === 1 ? '__next_page__' : '__previous_page__', 4), { code: 'DECISION_LIMIT' });
});

test('an indivisible observation item is rejected before inference without truncating it', async () => {
  const raw = observation(); raw.state.page.elements[0].name = 'x'.repeat(100000);
  let calls = 0;
  await assert.rejects(decideNavigationPages(raw, { prepare: compactDecision, async decide() { calls++; return { answers: {} }; } }, async () => { calls++; return { answers: {} }; }, new AbortController().signal), { code: 'OBSERVATION_LIMIT' });
  assert.equal(calls, 0);
  assert.equal(raw.state.page.elements[0].name.length, 100000);
});
