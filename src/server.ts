import { McpServer, type ServerContext } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { dataSchema } from './typed-data.js';
import type { NativeCommand } from '@tontoko/jev-browser';
import type { BrowserExplorer } from './explore-browser.js';
import { BrowserError } from '@tontoko/jev-browser';

const id = z.string().uuid();
const question = z.object({ key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,50}$/), question: z.string().min(1).max(800) });
const values = z.record(z.string(), z.json());
const native = z.discriminatedUnion('command', [
  z.object({ command: z.literal('click'), ref: z.string().min(1) }),
  z.object({ command: z.literal('hover'), ref: z.string().min(1) }),
  z.object({ command: z.literal('mouse'), action: z.literal('wheel'), deltaX: z.number().optional(), deltaY: z.number() }),
  z.object({ command: z.literal('type'), ref: z.string().min(1), text: z.string().max(10000) }),
  z.object({ command: z.literal('press_key'), key: z.string().max(60), ref: z.string().optional() }),
  z.object({ command: z.literal('select_option'), ref: z.string(), values: z.array(z.string()).max(30) }),
  z.object({ command: z.literal('check'), ref: z.string(), checked: z.boolean() }),
  z.object({ command: z.literal('navigate'), url: z.string().url() }),
  z.object({ command: z.literal('navigate_back') }),
  z.object({ command: z.literal('wait_for'), text: z.string().max(500) }),
]);

export function createExplorerServer(explorer: BrowserExplorer) {
  const server = new McpServer({ name: 'jev-explorer', version: '0.3.0' });
  const add = <S extends z.ZodObject>(name: string, description: string, inputSchema: S, work: (args: z.output<S>, signal?: AbortSignal) => Promise<unknown>, readOnly = false) => server.registerTool(name, {
    description, inputSchema: inputSchema as z.ZodObject,
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true },
  }, async (args: unknown, context: ServerContext) => {
    const started = performance.now();
    try {
      const result = await work(inputSchema.parse(args), context.mcpReq.signal);
      const { image, ...data } = result as Record<string, unknown>;
      data.toolElapsedMs = Math.round(performance.now() - started);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data) }, ...(image ? [{ type: 'image' as const, data: String(image), mimeType: 'image/png' }] : [])],
        structuredContent: data,
      };
    } catch (error) {
      const detail = error instanceof BrowserError ? { code: error.code, message: error.message } : { code: 'OPERATION_FAILED', message: 'The browser operation failed. Inspect the retained session or local trace.' };
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: detail }) }] };
    }
  });
  add('jev_open', 'Open an isolated browser session without inference. Use for authentication or to inspect the initial page before delegating a goal. A headed session can be operated by the user. The session stays alive until closed or idle expiry.', z.object({ url: z.string().url(), headed: z.boolean().default(false) }), (args, signal) => explorer.open(args, { signal }));
  add('jev_explore', 'Delegate a complete browser exploration objective to Jev. Supply questions whose answers are unknown; answers include verbatim source evidence. Returns a compact handoff, not the full DOM. The browser stays open for inspection and continuation. ready_for_review is evidence for the caller to review, not certified business correctness. Use only within the user-authorized scope. Default submission guards are conservative heuristics, not a read-only security boundary.', z.object({
    sessionId: id.optional(), url: z.string().url().optional(), headed: z.boolean().optional(),
    objective: z.string().min(1).max(6000), values: values.optional(), data: dataSchema.optional(),
    questions: z.array(question).max(8).default([]), allowCommit: z.boolean().default(false),
    maxSteps: z.number().int().min(1).max(100).default(35), maxCalls: z.number().int().min(1).max(60).default(20),
    maxTokens: z.number().int().min(1000).max(3000000).default(800000), timeoutMs: z.number().int().min(1000).max(180000).default(60000),
  }).refine(args => args.sessionId || args.url, 'Provide sessionId or url.'), (args, signal) => explorer.explore(args, { signal }));
  add('jev_continue', 'Continue the same objective in the same live browser. Add missing values, a supervisor note or sourced facts. Keeps discoveries and prior effects and does not replay the whole workflow. Input values should be supplied data, not guessed answers.', z.object({
    sessionId: id, note: z.string().max(6000).default(''), values: values.default({}), data: dataSchema.default({}),
    effectResolution: z.enum(['confirmed', 'not_applied']).optional(),
    facts: z.array(z.object({ key: z.string().max(100), value: z.string().max(3000), url: z.string().url().optional() })).max(8).default([]),
  }), ({ sessionId, ...args }, signal) => explorer.continue(sessionId, args, { signal }));
  add('jev_inspect', 'Inspect a retained session with no model call. Default output stays compact. Request targets only when taking over; use nextOffset to page through targets. Request screenshot explicitly to receive the image. Refs become stale when the page changes.', z.object({ sessionId: id, targets: z.boolean().default(false), screenshot: z.boolean().default(false), offset: z.number().int().min(0).max(1000).default(0) }), ({ sessionId, ...args }) => explorer.inspect(sessionId, args), true);
  add('jev_act', 'Take one explicit native browser action in the retained session, with no Jev call. Use a current ref from jev_inspect. For typing provide the text; passwords are not returned in the handoff. Then continue the exploration with jev_continue. This tool does not generate selectors or execute arbitrary JavaScript.', z.object({ sessionId: id, action: native }), ({ sessionId, action }, signal) => explorer.act(sessionId, action as NativeCommand, { signal }));
  add('jev_close', 'Close the browser session and retain its local evidence. Closing does not undo business effects. A closed session cannot be resumed by replaying its trace.', z.object({ sessionId: id }), ({ sessionId }) => explorer.close(sessionId));
  return server;
}
