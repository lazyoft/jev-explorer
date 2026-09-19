import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { BrowserExplorer } from '../dist/explore-browser.js';
import { temporaryRoot } from './fixtures.mjs';
import { readinessSite } from './page-state-fixture.mjs';

test('real Jev handles delayed loading and stacked optional overlays before searching', async t => {
  assert.ok(process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY);
  const url = await readinessSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot() }); t.after(() => explorer.shutdown());
  const started = performance.now();
  const report = await explorer.explore({ url: url + '?mode=delay', objective: 'Dismiss optional newsletter offers and decline optional analytics cookies. Fill the destination with supplied data, click Search and return the displayed search result. Do not accept analytics or register for anything.', data: { city: { type: 'text', value: 'Harbor City', description: 'Destination city' } }, questions: [{ key: 'result', question: 'The displayed search result, verbatim including destination.' }], maxCalls: 25 });
  const page = explorer.get(report.sessionId).core.page;
  const state = await page.evaluate(() => ({ dismissed: window.dismissals, unwanted: window.unwanted, searches: window.searches }));
  const evidence = { wallMs: Math.round(performance.now() - started), report, state };
  await mkdir('results', { recursive: true }); await writeFile('results/page-state-live.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
  assert.deepEqual({ ...state, dismissed: [...state.dismissed].sort() }, { dismissed: ['analytics','newsletter'], unwanted: 0, searches: 1 });
  assert.equal(report.status, 'ready_for_review');
  assert.equal(report.findings[0]?.value, 'Search result: Harbor City');
});
