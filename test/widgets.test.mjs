import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserExplorer } from '../dist/explore-browser.js';
import { temporaryRoot, scriptedEngine } from './fixtures.mjs';
import { widgetSite, widgetData } from './widget-fixture.mjs';

function widgetEngine() {
  const fallback = scriptedEngine(); const requests = [];
  return { requests, async decide(request, options) {
    requests.push(request);
    if (request.state.phase === 'typed-input') {
      const answers = {};
      for (const [id, field] of Object.entries(request.state.fields)) {
        const key = { Destination: 'city', Arrival: 'start', Departure: 'end' }[field.name];
        const datum = Object.entries(request.state.data).find(([, data]) => data.key === key);
        answers['datum_' + id] = { choice: datum?.[0] ?? '__none__', confidence: 0.99 };
      }
 return { answers };
    }
    if (request.questions.autocomplete_option) {
      const option = Object.entries(request.questions.autocomplete_option.criteria).find(([, item]) => item?.label === 'Harbor City, North Coast');
      return { answers: { autocomplete_option: { choice: option?.[0] ?? '__none__', confidence: 0.99 } } };
    }
    if (request.questions.calendar_action) {
      const entries = Object.entries(request.questions.calendar_action.criteria);
      const date = new Date(request.state.requestedDate + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
      const prior = request.state.previousActions;
      let name = prior.at(-1) === date ? 'Apply date' : request.state.observedText.some(item => item.text.includes('March 2030')) ? 'Next month' : date;
      const option = entries.find(([, item]) => item?.name === name);
      return { answers: { calendar_action: { choice: option?.[0] ?? '__none__', confidence: 0.99 } } };
    }
    if (request.questions.widget_readback) return { answers: { widget_readback: { choice: request.state.actual === request.state.expected ? 'match' : 'different', confidence: 0.99 } } };
    const result = await fallback.decide(request, options);
    if (request.questions.action) {
      const option = Object.entries(request.questions.action.criteria).find(([, item]) => item?.kind === 'click' && item.target?.name === 'Search');
      result.answers.action = { choice: option?.[0] ?? '__done__', confidence: 0.99 };
    }
    return result;
  } };
}

test('autocomplete selects an owned semantic option and custom calendars navigate and confirm exact dates', async t => {
  const site = await widgetSite(t); const engine = widgetEngine();
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: () => engine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url, objective: 'Search with the supplied destination and travel dates.', data: widgetData, maxCalls: 40 });
  assert.deepEqual(site.records, [{ place: 'Harbor City, North Coast', placeId: 'harbor-north', arrival: '2030-04-11', departure: '2030-04-14' }]);
  const page = explorer.get(report.sessionId).core.page;
  assert.equal(await page.evaluate(() => window.wrongClicks), 0);
  assert.equal(await page.evaluate(() => window.selectionClicks), 1);
  assert.equal(await page.evaluate(() => window.monthClicks), 2);
  assert.deepEqual(report.typedInputs.map(input => input.format), ['autocomplete-selection', 'calendar-selection', 'calendar-selection']);
  assert.equal(engine.requests.find(request => request.questions.autocomplete_option).questions.autocomplete_option.criteria.o0.label, 'Harbor City, North Coast');
});

test('ambiguous options and an option that never commits are not successful fills', async t => {
  const site = await widgetSite(t);
  for (const [mode, reason] of [['ambiguous', 'INPUT_AMBIGUOUS'], ['reject-option', 'INPUT_READBACK_FAILED']]) {
    const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: widgetEngine }); t.after(() => explorer.shutdown());
    const report = await explorer.explore({ url: site.url + '?mode=' + mode, objective: 'Choose the supplied destination.', data: { city: widgetData.city } });
    assert.equal(report.reason, reason, JSON.stringify(report)); assert.equal(report.typedInputs.length, 0); assert.equal(site.records.length, 0);
  }
});

test('calendar stops on unavailable dates, wrong readback, no progress and action budget', async t => {
  const site = await widgetSite(t);
  for (const [mode, reason, maxSteps] of [['disabled', 'INPUT_AMBIGUOUS', 20], ['wrong-date', 'INPUT_READBACK_FAILED', 20], ['stuck', 'NO_PROGRESS', 20], ['', 'INPUT_STEP_LIMIT', 2]]) {
    const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: widgetEngine }); t.after(() => explorer.shutdown());
    const report = await explorer.explore({ url: site.url + '?mode=' + mode, objective: 'Choose the supplied arrival date.', data: { start: widgetData.start }, maxSteps });
    assert.equal(report.reason, reason, JSON.stringify(report)); assert.equal(report.typedInputs.length, 0); assert.equal(site.records.length, 0);
  }
});

test('popup snapshots exclude a crowded background and another field options', async t => {
  const site = await widgetSite(t); const engine = widgetEngine();
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: () => engine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url + '?mode=crowded', objective: 'Select the supplied destination.', data: { city: widgetData.city }, maxSteps: 2 });
  assert.equal(report.typedInputs.length, 1, JSON.stringify(report));
  const criteria = engine.requests.find(request => request.questions.autocomplete_option).questions.autocomplete_option.criteria;
  assert.equal(Object.values(criteria).filter(item => typeof item === 'object').length, 3);
  assert.equal(await explorer.get(report.sessionId).core.page.evaluate(() => window.wrongClicks), 0);
});


test('calendar grid cells omitted by the engine are observed and selected within their owned popup', async t => {
  const site = await widgetSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: widgetEngine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url + '?mode=grid-cells', objective: 'Choose the supplied arrival date.', data: { start: widgetData.start }, maxSteps: 4 });
  const page = explorer.get(report.sessionId).core.page;
  assert.equal(await page.getByLabel('Arrival', { exact: true }).inputValue(), '2030-04-11');
  assert.equal(report.typedInputs[0]?.format, 'calendar-selection');
  assert.equal(await page.evaluate(() => window.wrongClicks), 0);
});


test('autocomplete waits for a changed suggestion set without retyping or selecting stale options', async t => {
  const site = await widgetSite(t); const engine = widgetEngine();
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: () => engine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url + '?mode=stale-options', objective: 'Select the supplied destination.', data: { city: widgetData.city }, maxSteps: 2 });
  const page = explorer.get(report.sessionId).core.page;
  assert.equal(await page.getByLabel('Destination', { exact: true }).inputValue(), 'Harbor City, North Coast');
  assert.equal(await page.evaluate(() => window.wrongClicks), 0);
  assert.equal(await page.evaluate(() => window.selectionClicks), 1);
  assert.equal(report.typedInputs.length, 1);
});


test('navigation does not retype an autocomplete selection that is still displayed correctly', async t => {
  const site = await widgetSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: widgetEngine }); t.after(() => explorer.shutdown());
  const first = await explorer.explore({ url: site.url, objective: 'Choose the supplied destination.', data: { city: widgetData.city }, maxSteps: 2 });
  assert.equal(first.typedInputs.length, 1);
  const page = explorer.get(first.sessionId).core.page;
  await page.goto(site.url + '/persisted');
  const second = await explorer.continue(first.sessionId);
  assert.equal(await page.getByLabel('Destination').inputValue(), 'Harbor City, North Coast');
  assert.equal(await page.evaluate(() => window.retyped), 0);
  assert.ok(second.recentActions.some(action => action.outcome.includes('no typing needed')), JSON.stringify(second));
});


test('onward search uses the filled form despite a crowded background page', async t => {
  const site = await widgetSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: widgetEngine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url + '?mode=crowded', objective: 'Fill the supplied destination and dates, then Search.', data: widgetData, maxCalls: 40 });
  assert.deepEqual(site.records, [{ place: 'Harbor City, North Coast', placeId: 'harbor-north', arrival: '2030-04-11', departure: '2030-04-14' }], JSON.stringify(report));
});
