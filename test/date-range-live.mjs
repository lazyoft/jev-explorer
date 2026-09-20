import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { BrowserExplorer } from '../dist/explore-browser.js';
import { widgetSite } from './widget-fixture.mjs';
import { temporaryRoot } from './fixtures.mjs';

test('real Jev applies and verifies a typed date range without supervisor actions', async t => {
  assert.ok(process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY);
  const site = await widgetSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot() }); t.after(() => explorer.shutdown());
  const started = performance.now();
  const report = await explorer.explore({ url: site.url + '?mode=range', objective: 'Set the Stay dates field to the supplied date range, close the calendar, and stop. Do not click Search.', data: { stay: { type: 'date-range', value: { start: '2030-04-11', end: '2030-04-14' }, description: 'Stay dates: check-in on start, check-out on end' } }, questions: [{ key: 'dates', question: 'The selected stay dates displayed in the date range field, verbatim.' }], maxCalls: 25 });
  const actual = await explorer.get(report.sessionId).core.page.evaluate(() => window.rangeValues);
  const evidence = { wallMs: Math.round(performance.now() - started), report, actual };
  await mkdir('results', { recursive: true }); await writeFile('results/date-range-live.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
  assert.deepEqual(actual, { start: '2030-04-11', end: '2030-04-14' });
  assert.equal(report.typedInputs[0]?.format, 'date-range-selection');
  assert.equal(report.status, 'ready_for_review');
  assert.ok(report.findings[0]?.value.includes('2030-04-11') && report.findings[0]?.value.includes('2030-04-14'));
  assert.equal(site.records.length, 0);
});
