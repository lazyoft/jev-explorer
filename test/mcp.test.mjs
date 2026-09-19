import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { BrowserExplorer } from '../dist/explore-browser.js';
import { createExplorerServer } from '../dist/server.js';
import { localSite, temporaryRoot, scriptedEngine } from './fixtures.mjs';

test('MCP exposes a goal, compact evidence, inspection and closure through the real protocol', async t => {
  const site = await localSite(t); const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: scriptedEngine });
  const server = createExplorerServer(explorer);
  const client = new Client({ name: 'explorer-protocol-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); await explorer.shutdown(); });
  await server.connect(st); await client.connect(ct);
  const tools = await client.listTools(); assert.equal(tools.tools.length, 6);
  const response = await client.callTool({ name: 'jev_explore', arguments: { url: site.url, objective: 'Find the video cancellation notice.', questions: [{ key: 'notice', question: 'Video cancellation notice, verbatim with unit' }] } });
  assert.notEqual(response.isError, true, JSON.stringify(response));
  const report = response.structuredContent;
  assert.equal(report.status, 'ready_for_review'); assert.equal(report.findings[0].value, '36 hours');
  const inspected = await client.callTool({ name: 'jev_inspect', arguments: { sessionId: report.sessionId, screenshot: true } });
  assert.ok(inspected.content.some(item => item.type === 'image'));
  const invalid = await client.callTool({ name: 'jev_act', arguments: { sessionId: report.sessionId, action: { command: 'evaluate', expression: '1' } } });
  assert.equal(invalid.isError, true);
  const closed = await client.callTool({ name: 'jev_close', arguments: { sessionId: report.sessionId } });
  assert.equal(closed.structuredContent.status, 'closed');
});
