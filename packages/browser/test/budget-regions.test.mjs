import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JevBrowser } from '../dist/browser.js';
import { estimateRequest } from '../dist/request-budget.js';
import { compactDecision } from '../dist/decision-context.js';
import { fixtureBrowser } from './helpers.mjs';

let browser;
before(async () => { browser = await fixtureBrowser(); });
after(async () => { await browser?.close(); });
const largeText = Array.from({ length: 100 }, (_, i) => `<p>Reference ${i}: ${('description ' + i + ' ').repeat(35)}</p>`).join('');
async function fixture(t, { selected = 'Useful details', scope, tooLarge = false, providerError = false } = {}) {
  const page = await browser.newPage(); t.after(() => page.close());
  await page.setContent(`<nav aria-label="Reference material">${largeText}</nav><section aria-label="Useful details">${tooLarge ? largeText : ''}<button onclick="window.opened=true;this.remove()">Open detail</button><p>Requested evidence</p></section>`);
  const requests = [];
  const core = new JevBrowser({ page, maxElements: 600, maxTexts: 800, engine: {
    prepare: compactDecision,
    async decide(request) {
      requests.push(request);
      assert.equal(estimateRequest(request).fits, true, 'No oversized request may reach the model');
      const answers = {};
      for (const [key, q] of Object.entries(request.questions)) {
        let choice = '__none__';
        if (key === 'region') choice = selected === '__ambiguous__' ? selected : Object.entries(q.criteria).find(([, value]) => value?.name === selected)?.[0] ?? '__none__';
        else if (key === 'action') {
          if (providerError) throw new Error('Synthetic provider failure');
          choice = Object.entries(q.criteria).find(([, value]) => {
            const action = value?.actionId ? request.state.actions[value.actionId] : value;
            const target = action?.target?.elementId ? request.state.page.elements.find(element => element.id === action.target.elementId) : action?.target;
            return target?.name === 'Open detail';
          })?.[0] ?? (q.criteria.__next_page__ ? '__next_page__' : q.criteria.__done__ ? '__done__' : '__none__');
        } else if (key.startsWith('effect_')) choice = 'advance';
        answers[key] = { choice, confidence: 0.99 };
      }
      return { answers };
    },
  } });
  t.after(() => core.close());
  return { page, core, requests, run: () => core.run('Open the requested detail in Useful details.', { scope, allowCommit: false, settleTimeoutMs: 10, until: async () => await page.evaluate(() => window.opened === true) }) };
}

test('a complete but over-budget observation pages before acting', async t => {
  const f = await fixture(t);
  assert.equal((await f.core.snapshot()).truncated, false);
  const result = await f.run();
  assert.equal(result.status, 'complete');
  assert.equal(await f.page.evaluate(() => window.opened), true);
  const regions = f.requests.filter(request => request.questions.region);
  assert.equal(regions.length, 0);
  assert.ok(f.requests.some(request => request.state.pagination?.pageCount > 1));
  assert.ok(f.requests.some(request => request.questions.action));
  assert.equal(result.steps.length, 1);
});

test('an explicit oversized region is paged without widening it', async t => {
  const f = await fixture(t, { scope: 'section', tooLarge: true });
  const result = await f.run();
  assert.equal(result.status, 'complete');
  assert.equal(await f.page.evaluate(() => window.opened), true);
  assert.equal(f.requests.filter(request => request.questions.region).length, 0);
  assert.ok(f.requests.some(request => request.state.pagination?.pageCount > 1));
});

test('paging an explicit scope never offers controls outside it', async t => {
  const f = await fixture(t, { scope: 'nav' });
  await f.run();
  assert.equal(await f.page.evaluate(() => window.opened), undefined);
  assert.ok(f.requests.length > 1);
  assert.ok(f.requests.every(request => !Object.values(request.questions.action?.criteria ?? {}).some(value => value?.target?.name === 'Open detail')));
});

test('an actual provider failure is not retried as a scope selection', async t => {
  const f = await fixture(t, { providerError: true });
  await assert.rejects(f.run(), { code: 'PROVIDER_ERROR' });
  assert.equal(f.requests.filter(request => request.questions.region).length, 0);
  assert.equal(f.requests.filter(request => request.questions.action).length, 1);
  assert.equal(await f.page.evaluate(() => window.opened), undefined);
});
