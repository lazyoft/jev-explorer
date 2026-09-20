import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserExplorer } from '../dist/explore-browser.js';
import { temporaryRoot, localSite } from './fixtures.mjs';

function engineFor({ target = 'Read result', effect = 'advance' } = {}) {
  const requests = [];
  return { requests, async decide(request) {
    requests.push(request);
    const answers = {};
    for (const [id, q] of Object.entries(request.questions)) {
      let choice = '__none__';
      if (id === 'page_phase') choice = request.state.modals.some(item => item.text.includes('Optional offer')) ? 'dismiss_optional' : 'ready';
      else if (id.startsWith('dismiss_')) choice = request.state.controls[id.slice(8)]?.name === 'Not now' ? 'optional_dismissal' : 'unsafe_or_ambiguous';
      else if (id === 'action') choice = Object.entries(q.criteria).find(([, item]) => item?.kind === 'click' && [target, 'Next'].includes(item.target?.name))?.[0] ?? '__done__';
      else if (id.startsWith('effect_') || id === 'action_effect') choice = effect;
      else if (id.startsWith('blocker_')) choice = 'observation';
      else if (id === 'f0') choice = Object.entries(q.criteria).find(([, item]) => item?.text === '36 hours')?.[0] ?? '__none__';
      answers[id] = { choice, confidence: 0.98 };
    }
    return { answers };
  } };
}
async function fixture(t, engine, body) {
  const site = await localSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: () => engine });
  t.after(() => explorer.shutdown());
  const opened = await explorer.open({ url: site.url });
  const page = explorer.get(opened.sessionId).core.page;
  await page.setContent(body);
  return { explorer, page, id: opened.sessionId };
}

test('navigation without typed data observes and dismisses an overlay appearing after the first step', async t => {
  const engine = engineFor();
  const { explorer, page, id } = await fixture(t, engine, `<button onclick="this.remove();document.querySelector('#offer').hidden=false">Next</button><div id="offer" role="dialog" hidden>Optional offer<button onclick="window.dismissed=true;this.parentElement.remove()">Not now</button></div><button onclick="window.read=true;this.remove()">Read result</button>`);
  const report = await explorer.explore({ sessionId: id, objective: 'Read the result, dismissing optional offers.' });
  assert.deepEqual(await page.evaluate(() => [window.dismissed, window.read]), [true, true], JSON.stringify(report));
  assert.ok(engine.requests.some(item => item.questions.page_phase && item.state.modals.length));
});

test('a nonblocking dialog does not hide navigation and extraction elsewhere on the page', async t => {
  const engine = engineFor();
  const { explorer, page, id } = await fixture(t, engine, '<div role="dialog">Help chat<button>Close help</button></div><button onclick="this.remove();document.querySelector(\'article\').hidden=false">Read result</button><article hidden><h2>Cancellation notice</h2><p>36 hours</p></article>');
  const report = await explorer.explore({ sessionId: id, objective: 'Read the cancellation notice.', questions: [{ key: 'notice', question: 'Cancellation notice, with its unit.' }] });
  assert.equal(report.status, 'ready_for_review', JSON.stringify(report));
  assert.equal(report.findings[0].value, '36 hours');
  assert.equal(await page.locator('article').isVisible(), true);
});

test('unrelated invalid newsletter fields and status text do not override collected evidence', async t => {
  const { explorer, id } = await fixture(t, engineFor(), '<article><h2>Cancellation notice</h2><p>36 hours</p></article><form><label>Newsletter email<input type="email" required aria-invalid="true" aria-errormessage="error"></label><p id="error">Please enter an email</p></form><p role="status">12 results</p>');
  const report = await explorer.explore({ sessionId: id, objective: 'Read the cancellation notice.', questions: [{ key: 'notice', question: 'Cancellation notice, with its unit.' }] });
  assert.equal(report.status, 'ready_for_review', JSON.stringify(report));
  assert.equal(report.findings[0].value, '36 hours');
  assert.deepEqual(report.needs, []);
});

test('navigation uses the semantic effect rather than English words or submit button type', async t => {
  for (const name of ['Schedule', 'Save', 'Post']) {
    const engine = engineFor({ target: name });
    const { explorer, page, id } = await fixture(t, engine, `<form onsubmit="event.preventDefault();window.opened=true;this.remove()"><button type="submit">${name}</button></form>`);
    const report = await explorer.explore({ sessionId: id, objective: 'Open the requested information page.' });
    assert.equal(await page.evaluate(() => window.opened), true, JSON.stringify(report));
    assert.equal(engine.requests.filter(item => item.questions.action_effect).length, 0);
  }
});

test('a model-classified commit is blocked without authorization regardless of language', async t => {
  for (const name of ['Invia richiesta', 'Löschen', 'Confirmer']) {
    const { explorer, page, id } = await fixture(t, engineFor({ target: name, effect: 'commit' }), `<button onclick="window.wrote=true">${name}</button>`);
    const report = await explorer.explore({ sessionId: id, objective: 'Inspect this workflow.', allowCommit: false });
    assert.equal(report.reason, 'permission-required', JSON.stringify(report));
    assert.equal(await page.evaluate(() => window.wrote), undefined);
  }
});

test('commit permission does not authorize a model-classified conflicting effect', async t => {
  const { explorer, page, id } = await fixture(t, engineFor({ target: 'Continua', effect: 'forbidden' }), '<button onclick="window.wrote=true">Continua</button>');
  const report = await explorer.explore({ sessionId: id, objective: 'Save only the requested record.', allowCommit: true });
  assert.equal(report.reason, 'permission-required');
  assert.equal(await page.evaluate(() => window.wrote), undefined);
});

test('supervised clicks also use semantic classification and keep unauthorized writes unexecuted', async t => {
  for (const [name, effect] of [['Schedule', 'advance'], ['Invia richiesta', 'commit']]) {
    const { explorer, page, id } = await fixture(t, engineFor({ effect }), `<button onclick="window.clicked=true">${name}</button>`);
    const view = await explorer.inspect(id, { targets: true });
    const action = { command: 'click', ref: view.targets.find(item => item.name === name).ref };
    if (effect === 'advance') await explorer.act(id, action);
    else await assert.rejects(explorer.act(id, action), { code: 'ACTION_DENIED' });
    assert.equal(await page.evaluate(() => window.clicked), effect === 'advance' ? true : undefined);
    assert.equal(explorer.get(id).policyUsage.calls, 1);
  }
});
