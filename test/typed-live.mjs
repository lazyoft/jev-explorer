import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { typedSite, tripData } from './typed-fixture.mjs';
import { temporaryRoot } from './fixtures.mjs';

test('real Jev chooses fields and supplied typed data across a guest and travel form', async t => {
  assert.ok(process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY, 'Set the API key for this opt-in live test.');
  const site = await typedSite(t); const root = await temporaryRoot();
  const client = new Client({ name: 'typed-live', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('bin/jev-explorer.mjs')], env: { ...Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'PLAYWRIGHT_BROWSERS_PATH', 'TYPESAFE_API_KEY', 'JEV_API_KEY', 'JEV_MODEL'].filter(key => process.env[key]).map(key => [key, process.env[key]])), JEV_EXPLORER_RUNS: root }, stderr: 'pipe' });
  t.after(() => client.close()); await client.connect(transport);
  const started = performance.now();
  const response = await client.callTool({ name: 'jev_explore', arguments: {
    url: site.url + '/start',
    objective: 'Fill the guest first and last name from supplied data, click Next, then fill all supplied travel details including breakfast and click Search. Stop when synthetic hotel availability appears. This is an authorized local search; do not book anything.',
    data: tripData, questions: [{ key: 'availability', question: 'Quote the synthetic hotel availability result including cleanliness and nights.' }],
    maxSteps: 25, maxCalls: 45, timeoutMs: 90000,
  } }, { timeout: 240000 });
  const report = response.structuredContent;
  const evidence = { wallMs: Math.round(performance.now() - started), report, records: site.records };
  await mkdir('results', { recursive: true }); await writeFile('results/typed-live.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
  assert.notEqual(response.isError, true);
  assert.deepEqual(site.records, [{ first: 'Ada', last: 'Example', place: 'Harbor City', arrival: '2030-04-11', departure: '14/04/2030', adults: '2', breakfast: true }]);
  assert.equal(report.typedInputs.length, 7);
  assert.equal(report.status, 'ready_for_review');
  assert.equal(report.pendingEffect, false);
  assert.ok(report.findings.some(finding => finding.value.includes('9.4')));
  assert.equal(report.recentActions.some(action => action.action.startsWith('supervisor')), false);
  await client.callTool({ name: 'jev_close', arguments: { sessionId: report.sessionId } });
});
