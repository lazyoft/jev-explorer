import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './server.js';
import { SessionStore } from '../domain/sessions.js';
import { JevDecider, type Decider } from '../jev/client.js';

const root = process.env.JEV_EXPLORER_RUNS
  ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'jev-explorer', 'runs');

const store = new SessionStore(root);
let decider: Decider | undefined;

let stopping: Promise<void> | undefined;
const stop = () => stopping ??= store.shutdown();

const handle = serveStdio(() => {
  const server = createServer(store, () => decider ??= new JevDecider());
  server.server.onclose = () => { void stop(); };
  return server;
}, { onerror: () => process.stderr.write('jev-explorer: transport error\n') });

process.stdin.once('end', () => { void stop(); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void handle.close().then(stop); });
