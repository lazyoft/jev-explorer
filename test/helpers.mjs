import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pages = fileURLToPath(new URL('./pages/', import.meta.url));

export async function startSite() {
  const server = createServer(async (request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    const file = join(pages, path === '/' ? 'index.html' : path.replace(/^\/+/, ''));
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': extname(file) === '.html' ? 'text/html; charset=utf-8' : 'text/plain' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/html' });
      response.end('<h1>Not found</h1>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, stop: () => new Promise(resolve => server.close(resolve)) };
}

export function scriptedDecider(rules) {
  const seen = [];
  return {
    seen,
    messages: () => seen.length,
    async ask(asks) {
      seen.push(asks);
      const answers = {};
      for (const [id, ask] of Object.entries(asks)) {
        const chosen = rules(id, ask);
        if (chosen === undefined) throw new Error(`the test script has no answer for "${id}"`);
        answers[id] = typeof chosen === 'string' ? { id: chosen, confidence: 1 } : chosen;
      }
      return { answers, inputTokens: 0, outputTokens: 0 };
    },
  };
}

export const pick = (ask, match) => ask.choices.find(choice => match(choice.label, choice))?.id;

export async function withRoot(work) {
  const root = await mkdtemp(join(tmpdir(), 'jev-explorer-test-'));
  try { return await work(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
