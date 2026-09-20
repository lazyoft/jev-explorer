import { McpServer, type ServerContext } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { startBrowsing } from '../start_browsing.js';
import { openBrowser } from '../open_browser.js';
import { inspectSession } from '../inspect_session.js';
import { actInSession } from '../act_in_session.js';
import { closeSession } from '../close_session.js';
import { ExplorerError } from '../domain/errors.js';
import type { SessionStore } from '../domain/sessions.js';
import type { Decider } from '../jev/client.js';

const sessionId = z.uuid();
const name = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,50}$/);

const browseInput = z.object({
  sessionId: sessionId.optional(),
  url: z.url().optional(),
  headed: z.boolean().default(false),
  goal: z.string().min(1).max(4000).optional(),
  questions: z.array(z.object({ key: name, question: z.string().min(1).max(600) })).max(8).default([]),
  values: z.record(name, z.string().max(2000)).default({}),
  note: z.string().max(2000).optional(),
  maxSteps: z.number().int().min(1).max(60).optional(),
  maxMessages: z.number().int().min(1).max(120).optional(),
  timeoutMs: z.number().int().min(5000).max(600000).optional(),
}).refine(input => input.sessionId || input.url, 'Send a web address or the id of an open session.');

export function createServer(store: SessionStore, decider: () => Decider) {
  const server = new McpServer({ name: 'jev-explorer', version: '1.0.0-alpha.1' });

  const add = <S extends z.ZodType>(toolName: string, description: string, input: S, work: (args: z.output<S>, signal: AbortSignal) => Promise<unknown>, readOnly = false) =>
    server.registerTool(toolName, {
      description,
      inputSchema: input as unknown as z.ZodObject,
      annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true },
    }, async (args: unknown, context: ServerContext) => {
      try {
        const result = await work(input.parse(args), context.mcpReq.signal) as Record<string, unknown>;
        const { image, ...data } = result;
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(data) },
            ...(image ? [{ type: 'image' as const, data: String(image), mimeType: 'image/png' }] : []),
          ],
          structuredContent: data,
        };
      } catch (error) {
        const detail = error instanceof ExplorerError
          ? { status: error.stop, code: error.code, message: error.message }
          : { status: 'blocked', code: 'FAILED', message: 'The request failed. Look at the trace file in the session folder.' };
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: detail }) }] };
      }
    });

  add('browse',
    'Give a browser goal in plain words and get back the findings with the exact source text. Send questions whose answers you do not know. The browser stays open, so you can add a missing value and call browse again with the same sessionId. Send a url without a goal only to open a browser for a manual sign-in. The run clicks whatever moves toward the goal, including buttons that save, send, buy or delete, so send a goal that stops short of those unless you mean them.',
    browseInput,
    (args, signal) => args.goal
      ? startBrowsing(store, decider(), { ...args, goal: args.goal }, signal)
      : openBrowser(store, { url: args.url!, headed: args.headed }));

  add('inspect',
    'Look at the live page of an open session. This never calls the model. Ask for controls when you want to act yourself, and page through them with offset. Ask for a screenshot only when you need the picture.',
    z.object({ sessionId, controls: z.boolean().default(false), screenshot: z.boolean().default(false), offset: z.number().int().min(0).max(2000).default(0) }),
    args => inspectSession(store, args), true);

  add('act',
    'Do one step yourself in an open session, using a control reference from inspect.',
    z.object({ sessionId, ref: z.string().min(1).max(60), text: z.string().max(4000).optional() }),
    args => actInSession(store, args));

  add('close',
    'Close the browser session. The evidence files stay on disk. Closing does not undo anything the session did.',
    z.object({ sessionId }),
    args => closeSession(store, args.sessionId));

  return server;
}
