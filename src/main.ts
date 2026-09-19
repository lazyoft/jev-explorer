import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BrowserExplorer } from './explore-browser.js';
import { createExplorerServer } from './server.js';

const root = process.env.JEV_EXPLORER_RUNS ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'jev-explorer', 'runs');
const explorer = new BrowserExplorer({ root });
let closing: Promise<void> | undefined;
const stop = () => closing ??= explorer.shutdown();
const handle = serveStdio(() => {
  const server = createExplorerServer(explorer);
  server.server.onclose = () => { void stop(); };
  return server;
}, { onerror: () => process.stderr.write('jev-explorer: transport error\n') });
process.stdin.once('end', () => { void stop(); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void handle.close().then(stop); });
