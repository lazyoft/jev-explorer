import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserExplorer } from '../dist/explore-browser.js';
import { temporaryRoot } from './fixtures.mjs';
import { widgetSite } from './widget-fixture.mjs';
import { dataSchema } from '../dist/typed-data.js';

const range = { type: 'date-range', value: { start: '2030-04-11', end: '2030-04-14' }, description: 'Stay dates, check-in through check-out' };
function rangeEngine({ search = false, rejectReadback = false } = {}) {
  return { async decide(request) {
    const answers = {};
    for (const [id, question] of Object.entries(request.questions)) {
      let choice = '__none__';
      if (id.startsWith('datum_')) choice = 'd0';
      else if (id === 'range_panel') choice = 'p0';
      else if (id === 'range_day') {
        const label = new Date(request.state.requestedDate + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });
        choice = Object.entries(question.criteria).find(([,value]) => value?.name === label)?.[0] ?? '__none__';
      } else if (id === 'range_navigation') choice = Object.entries(question.criteria).find(([,value]) => value?.name === 'Next month')?.[0] ?? '__none__';
      else if (id === 'range_readback') choice = !rejectReadback && request.state.actual.includes(range.value.start) && request.state.actual.includes(range.value.end) ? 'match' : 'different';
      else if (id === 'action') choice = search ? Object.entries(question.criteria).find(([, item]) => item?.kind === 'click' && item.target?.name === 'Search')?.[0] ?? '__done__' : '__done__';
      else if (id.startsWith('effect_')) choice = 'advance';
      answers[id] = { choice, confidence: 0.99 };
    }
    return { answers };
  } };
}

test('a verified date range succeeds while its calendar remains open', async t => {
  const site = await widgetSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: rangeEngine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url + '?mode=range', objective: 'Select the supplied stay dates.', data: { stay: range } });
  const page = explorer.get(report.sessionId).core.page;
  assert.deepEqual(await page.evaluate(() => window.rangeValues), range.value, JSON.stringify(report));
  assert.equal(await page.locator('button[aria-expanded]').getAttribute('aria-expanded'), 'true');
  assert.equal(report.typedInputs.filter(input => input.key === 'stay').length, 1);
  assert.equal(await page.evaluate(() => window.monthClicks), 1);
});

test('date ranges reject reversed endpoints and invalid calendar dates', () => {
  assert.equal(dataSchema.safeParse({ stay: range }).success, true);
  assert.equal(dataSchema.safeParse({ stay: { ...range, value: { start: '2030-04-14', end: '2030-04-11' } } }).success, false);
  assert.equal(dataSchema.safeParse({ stay: { ...range, value: { start: '2030-02-30', end: '2030-04-11' } } }).success, false);
});


test('the navigation engine can choose Search after verified dates with an open calendar', async t => {
  const site = await widgetSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: () => rangeEngine({ search: true }) });
  t.after(() => explorer.shutdown());
  const opened = await explorer.open({ url: site.url + '?mode=range' });
  const page = explorer.get(opened.sessionId).core.page;
  await page.evaluate(() => {
    window.search = () => {
      window.searched = { dates: { ...window.rangeValues }, calendarOpen: !document.querySelector('#calendar').hidden };
      document.querySelector('form').remove();
      document.querySelector('#calendar').remove();
      document.querySelector('#results').textContent = 'Search complete';
    };
  });
  const report = await explorer.explore({ sessionId: opened.sessionId, objective: 'Search with the supplied stay dates.', data: { stay: range } });
  assert.deepEqual(await page.evaluate(() => window.searched), { dates: range.value, calendarOpen: true }, JSON.stringify(report));
  assert.equal(report.typedInputs.filter(input => input.key === 'stay').length, 1);
});

test('an unverified date range still blocks navigation', async t => {
  const site = await widgetSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: () => rangeEngine({ search: true, rejectReadback: true }) });
  t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url + '?mode=range', objective: 'Search with the supplied stay dates.', data: { stay: range } });
  assert.equal(report.reason, 'INPUT_READBACK_FAILED');
  assert.equal(report.typedInputs.length, 0);
  assert.equal(site.records.length, 0);
});
