import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { SessionStore } from '../dist/domain/sessions.js';
import { createServer } from '../dist/mcp/server.js';
import { startSite, scriptedDecider, pick, withRoot } from './helpers.mjs';

const holds = (needle) => (label) => label.toLowerCase().includes(needle.toLowerCase());

test('the four tools work over the real protocol', async () => {
  const site = await startSite();
  const decider = scriptedDecider((id, ask) => {
    if (id === 'effect') return 'move';
    if (id === 'action') return pick(ask, holds('Reject optional')) ?? pick(ask, holds('link Contact')) ?? '__nothing__';
    if (id.startsWith('answer_')) return pick(ask, label => label.includes('+39')) ?? '__not_here__';
    return undefined;
  });
  await withRoot(async root => {
    const store = new SessionStore(root);
    const server = createServer(store, () => decider);
    const client = new Client({ name: 'protocol-test', version: '1' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverSide);
      await client.connect(clientSide);

      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['act', 'browse', 'close', 'inspect']);

      const browsed = await client.callTool({ name: 'browse', arguments: {
        url: site.url,
        goal: 'Find the workshop phone number.',
        questions: [{ key: 'phone', question: 'What is the workshop phone number?' }],
      } });
      assert.notEqual(browsed.isError, true, JSON.stringify(browsed));
      const report = browsed.structuredContent;
      assert.equal(report.status, 'answered');
      assert.match(report.findings[0].answer, /\+39 02 5555 1234/);

      const inspected = await client.callTool({ name: 'inspect', arguments: { sessionId: report.sessionId, controls: true, screenshot: true } });
      assert.ok(inspected.content.some(item => item.type === 'image'));
      const back = inspected.structuredContent.controls.find(control => control.name.includes('start page'));
      assert.ok(back, 'no control to act on');

      const acted = await client.callTool({ name: 'act', arguments: { sessionId: report.sessionId, ref: back.ref } });
      assert.notEqual(acted.isError, true, JSON.stringify(acted));
      assert.match(acted.structuredContent.page.url, /index\.html$|\/$/);

      const refused = await client.callTool({ name: 'act', arguments: { sessionId: report.sessionId, ref: 'made-up' } });
      assert.equal(refused.isError, true);

      const closed = await client.callTool({ name: 'close', arguments: { sessionId: report.sessionId } });
      assert.equal(closed.structuredContent.status, 'closed');
    } finally {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
      await store.shutdown();
      await site.stop();
    }
  });
});

test('the installed server starts over stdio and lists its tools', async () => {
  const client = new Client({ name: 'stdio-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/mcp/main.js'], env: { ...process.env, TYPESAFE_API_KEY: '' } });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['act', 'browse', 'close', 'inspect']);
    assert.ok(tools.tools.every(tool => tool.description.length > 40));
  } finally {
    await client.close().catch(() => {});
  }
});

