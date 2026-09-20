import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactDecision } from '../dist/decision-context.js';

function largeRequest() {
  const context = 'Observed filter group with the exact caller-visible labels. '.repeat(12);
  const elements = Array.from({ length: 90 }, (_, i) => ({ id: 'e' + i, frame: 0, role: 'checkbox', name: 'Filter ' + i, context, disabled: false, readOnly: false, fillable: false, checked: i === 0, tag: 'input', inputType: 'checkbox', fieldName: '', controls: [] }));
  const actions = Object.fromEntries(elements.map((element, i) => ['a' + i, { kind: element.checked ? 'uncheck' : 'check', target: { id: element.id, frame: element.frame, role: element.role, name: element.name, context } }]));
  const texts = elements.map((element, i) => ({ id: 't' + i, frame: 0, role: 'checkbox', text: element.name, context, value: element.checked }));
  texts.push({ id: 'notice', frame: 0, role: 'status', text: 'No booking has been made.', context: 'Current status' });
  return { state: { task: 'Inspect the requested filter.', page: { url: 'https://example.invalid', elements, texts }, actions }, questions: { action: { type: 'choice', instructions: 'Choose an action.', criteria: { ...actions, __none__: 'No applicable action.' } }, effect_a0: { type: 'choice', instructions: 'Classify action a0.', criteria: { advance: 'Allowed requested filter change.', forbidden: 'Not requested.' } } } };
}

test('large navigation requests share context without losing target attributes or nonduplicate evidence', () => {
  const original = largeRequest(); const before = structuredClone(original);
  const encoded = compactDecision(original);
  assert.deepEqual(original, before);
  assert.ok(JSON.stringify(encoded).length < JSON.stringify(original).length / 2);
  const decoded = encoded.state.page.elements.map(element => {
    const result = { ...encoded.state.page.elementDefaults, ...element };
    if (result.contextRef) { result.context = encoded.state.observationContexts[result.contextRef]; delete result.contextRef; }
    return result;
  });
  assert.deepEqual(decoded, original.state.page.elements);
  for (const [id, action] of Object.entries(encoded.state.actions)) {
    assert.equal(encoded.questions.action.criteria[id].actionId, id);
    const element = decoded.find(element => element.id === action.target.elementId);
    const expected = original.state.actions[id];
    assert.equal(action.kind, expected.kind);
    assert.deepEqual(Object.fromEntries(Object.keys(expected.target).map(key => [key, element[key]])), expected.target);
  }
  assert.equal(encoded.state.page.texts.length, 1);
  assert.equal(encoded.state.page.texts[0].text, 'No booking has been made.');
  assert.equal(encoded.questions.action.criteria.__none__, original.questions.action.criteria.__none__);
});

test('small requests are unchanged and context aliases never overwrite existing keys', () => {
  const small = { state: { task: 'Read.' }, questions: { next: { type:'choice', criteria:{ done:'Done' } } } };
  assert.equal(compactDecision(small), small);
  const request = largeRequest(); request.state.observationContexts = 'caller data'; request.state.contextRef = 'original reference';
  const encoded = compactDecision(request);
  assert.equal(encoded.state.observationContexts, 'caller data');
  assert.equal(encoded.state.contextRef, 'original reference');
  assert.ok(encoded.state._observationContexts);
  assert.ok(encoded.state.page.elements[0]._contextRef);
});
