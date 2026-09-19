import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { localSite, temporaryRoot } from './fixtures.mjs';

test('real Jev through MCP discovers an unknown value, requests missing input and resumes the same draft', async t => {
  assert.ok(process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY, 'Set TYPESAFE_API_KEY to run paid, opt-in live tests.');
  await mkdir('results', { recursive: true });
  const site = await localSite(t);
  const root = await temporaryRoot();
  const client = new Client({ name: 'jev-explorer-live', version: '0.1.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('bin/jev-explorer.mjs')], env: { ...Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'PLAYWRIGHT_BROWSERS_PATH', 'TYPESAFE_API_KEY', 'JEV_API_KEY', 'JEV_MODEL'].filter(key => process.env[key]).map(key => [key, process.env[key]])), JEV_EXPLORER_RUNS: root }, stderr: 'pipe' });
  t.after(() => client.close());
  await client.connect(transport);
  const call = async (name, args) => {
    const started = performance.now();
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    console.log(JSON.stringify({ tool: name, wallMs: Math.round(performance.now() - started), reportChars: JSON.stringify(result.structuredContent).length, report: result.structuredContent }));
    return result.structuredContent;
  };
  const first = await call('jev_explore', {
    url: site.url + '/form',
    objective: 'Create a contact with the supplied name and email, and find the cancellation notice for video appointments from this page. If a required value is not supplied, stop and ask the supervisor. Do not invent a missing email.',
    values: { name: 'Ada Example' }, allowCommit: true,
    questions: [{ key: 'notice', question: 'Minimum cancellation notice for a video appointment, verbatim with the unit.' }],
  });
  await writeFile(resolve('results/prototype-live-first.json'), JSON.stringify(first, null, 2));
  assert.equal(first.status, 'needs_input', JSON.stringify(first));
  assert.equal(first.findings[0]?.value, '36 hours');
  assert.equal(site.records.length, 0);
  const second = await call('jev_continue', { sessionId: first.sessionId, values: { email: 'ada@example.invalid' }, note: 'Here is the missing email. Continue the existing draft; the name was already filled. Save the local test contact once.' });
  await writeFile(resolve('results/prototype-live-second.json'), JSON.stringify(second, null, 2));
  assert.deepEqual(site.records, [{ '/name': 'Ada Example', '/email': 'ada@example.invalid' }]);
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(second.sessionAlive, true);
  if (second.pendingEffect) {
    await call('jev_continue', { sessionId: first.sessionId, effectResolution: 'confirmed', note: 'The independent local server has exactly one saved record with both expected fields. No replay is needed.' });
    assert.equal(site.records.length, 1);
  }
  const inspected = await call('jev_inspect', { sessionId: first.sessionId, targets: true });
  assert.equal(inspected.page.url, site.url + '/form');
  await call('jev_close', { sessionId: first.sessionId });
});
