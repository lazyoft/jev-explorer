import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { widgetSite, widgetData } from './widget-fixture.mjs';
import { temporaryRoot } from './fixtures.mjs';

test('real Jev completes owned autocomplete and custom calendars without supervisor actions', async t => {
  assert.ok(process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY, 'Set the API key for this opt-in live test.');
  const site = await widgetSite(t); const root = await temporaryRoot();
  const client = new Client({ name: 'typed-live', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('bin/jev-explorer.mjs')], env: { ...Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'PLAYWRIGHT_BROWSERS_PATH', 'TYPESAFE_API_KEY', 'JEV_API_KEY', 'JEV_MODEL'].filter(key => process.env[key]).map(key => [key, process.env[key]])), JEV_EXPLORER_RUNS: root }, stderr: 'pipe' });
  t.after(() => client.close()); await client.connect(transport);
  const started = performance.now();
  const response = await client.callTool({ name: 'jev_explore', arguments: {
    url: site.url,
    objective: 'Choose the supplied destination in the autocomplete, select arrival and departure in their calendars, then click Search. Use the North Coast city. Stop when the widget search result appears. This is an authorized read-only local search, not a reservation.',
    data: widgetData, questions: [{ key: 'availability', question: 'Quote the displayed availability result, verbatim including the destination, arrival date, departure date and cleanliness rating.' }],
    maxSteps: 25, maxCalls: 45, timeoutMs: 90000,
  } }, { timeout: 240000 });
  const report = response.structuredContent;
  const evidence = { wallMs: Math.round(performance.now() - started), report, records: site.records };
  await mkdir('results', { recursive: true }); await writeFile('results/widget-live.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
  assert.notEqual(response.isError, true);
  assert.deepEqual(site.records, [{ place: 'Harbor City, North Coast', placeId: 'harbor-north', arrival: '2030-04-11', departure: '2030-04-14' }]);
  assert.equal(report.typedInputs.length, 3);
  assert.equal(report.status, 'ready_for_review');
  assert.equal(report.pendingEffect, false);
  assert.ok(report.findings.some(finding => ['Harbor City, North Coast', '2030-04-11', '2030-04-14', '9.4'].every(value => finding.value.includes(value))));
  assert.equal(report.recentActions.some(action => action.action.startsWith('supervisor')), false);
  await client.callTool({ name: 'jev_close', arguments: { sessionId: report.sessionId } });
});
