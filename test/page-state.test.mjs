import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageState } from '../dist/page-state.js';
import { BrowserExplorer } from '../dist/explore-browser.js';
import { temporaryRoot } from './fixtures.mjs';
import { readinessSite } from './page-state-fixture.mjs';

function readinessEngine() {
  return { async decide(request) {
    const answers = {};
    for (const [id, q] of Object.entries(request.questions)) {
      let choice = '__none__';
      if (id === 'page_phase') choice = request.state.modals.some(modal => modal.text.includes('Security challenge')) ? 'blocked' : request.state.modals.some(modal => modal.text.includes('Optional')) ? 'dismiss_optional' : request.state.afterNoMatch ? 'blocked' : 'ready';
      else if (id.startsWith('dismiss_')) { const control = request.state.controls[id.slice('dismiss_'.length)]; choice = control.name === 'Decline' ? 'decline_optional_consent' : control.name === 'Not now' ? 'optional_dismissal' : 'unsafe_or_ambiguous'; }
      else if (id.startsWith('datum_')) choice = 'd0';
      else if (id === 'action') choice = Object.entries(q.criteria).find(([, item]) => item?.kind === 'click' && item.target?.name === 'Search')?.[0] ?? '__done__';
      else if (id.startsWith('effect_')) choice = 'advance';
      else if (id === 'f0') choice = Object.entries(q.criteria).find(([, item]) => item?.text?.startsWith('Search result:'))?.[0] ?? '__none__';
      answers[id] = { choice, confidence: 0.99 };
    }
    return { answers };
  } };
}
const input = { city: { type: 'text', value: 'Harbor City', description: 'Destination city' } };

test('stacked optional dialogs are dismissed and verified before filling the form', async t => {
  const url = await readinessSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: readinessEngine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url, objective: 'Dismiss optional offers, decline optional analytics, fill the destination and search.', data: input });
  const page = explorer.get(report.sessionId).core.page;
  assert.deepEqual(await page.evaluate(() => ({ dismissed: window.dismissals, unwanted: window.unwanted, searches: window.searches })), { dismissed: ['analytics','newsletter'], unwanted: 0, searches: 1 });
  assert.equal(await page.locator('#result').innerText(), 'Search result: Harbor City');
  assert.ok(report.typedInputs.length === 1, JSON.stringify(report));
});

test('a delayed page is observed again without deciding that an empty page is complete', async t => {
  const url = await readinessSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: readinessEngine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: url + '?mode=delay', objective: 'Dismiss optional offers, decline analytics and search with supplied data.', data: input });
  assert.equal(await explorer.get(report.sessionId).core.page.locator('#result').innerText(), 'Search result: Harbor City');
  assert.ok(explorer.get(report.sessionId).history.some(item => item.action === 'wait for page change'));
});

test('a dismissal without visible effect stops before input or another click', async t => {
  const url = await readinessSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: readinessEngine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: url + '?mode=noop', objective: 'Dismiss optional offers and search.', data: input });
  assert.equal(report.reason, 'DISMISS_NOT_CONFIRMED');
  assert.deepEqual(await explorer.get(report.sessionId).core.page.evaluate(() => ({ dismissed: window.dismissals, searches: window.searches })), { dismissed: ['analytics','newsletter'], searches: 0 });
  assert.equal(report.typedInputs.length, 0);
});

test('required workflow dialogs remain usable and security challenges hand off untouched', async t => {
  const url = await readinessSite(t);
  for (const mode of ['workflow', 'security']) {
    const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: readinessEngine }); t.after(() => explorer.shutdown());
    const report = await explorer.explore({ url: url + '?mode=' + mode, objective: 'Fill the destination and search. Do not bypass security challenges.', data: input });
    const state = await explorer.get(report.sessionId).core.page.evaluate(() => ({ unwanted: window.unwanted, searches: window.searches }));
    assert.equal(state.unwanted, 0);
    assert.equal(state.searches, mode === 'workflow' ? 1 : 0);
    if (mode === 'security') assert.equal(report.reason, 'PAGE_BLOCKED');
  }
});


test('no next action triggers diagnosis rather than being treated as completion', async t => {
  const url = await readinessSite(t); const base = readinessEngine(); let diagnoses = 0;
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: () => ({ async decide(request) {
    const result = await base.decide(request);
    if (request.questions.action) result.answers.action = { choice: '__none__', confidence: 0.99 };
    if (request.questions.page_phase) { diagnoses++; result.answers.page_phase = { choice: 'ready', confidence: 0.99 }; }
    return result;
  } }) }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: url + '?mode=deadend', objective: 'Find the requested result.', data: input });
  assert.equal(diagnoses, 1);
  assert.equal(report.reason, 'NO_GROUNDED_ACTION');
  assert.notEqual(report.status, 'ready_for_review');
});


test('optional dialogs remain observable beyond the background page element limit', async t => {
  const url = await readinessSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: readinessEngine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: url + '?mode=crowded', objective: 'Dismiss optional offers, decline analytics and fill the destination.', data: input, maxSteps: 3 });
  const state = await explorer.get(report.sessionId).core.page.evaluate(() => ({ dismissed: window.dismissals, unwanted: window.unwanted }));
  assert.deepEqual(state.dismissed.sort(), ['analytics', 'newsletter']);
  assert.equal(state.unwanted, 0);
  assert.equal(report.typedInputs.length, 1, JSON.stringify(report));
});


test('a navigation race during a loading observation becomes a retriable stale snapshot', async () => {
  let actions = 0;
  await assert.rejects(pageState({
    core: { snapshot: async () => { throw new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation'); } },
    snapshot: { url: 'https://example.invalid', elements: [], texts: [], busy: false },
    objective: 'Find the result.', suppliedKeys: [], memory: { waits: 0, noMatchChecked: false }, operation: { timeoutMs: 500 },
    engine: { decide: async () => { throw new Error('No decision should be needed while loading.'); } },
    act: async () => { actions++; }, record: async () => {},
  }), error => error.code === 'STALE_SNAPSHOT');
  assert.equal(actions, 0);
});
