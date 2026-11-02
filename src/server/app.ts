import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { VERSION, TRANSPORTS, type Event } from '../shared/lesson.js';
import { RunSchema, redact } from './config.js';
import { inspectConnection } from './mcp.js';
import { HistoryService } from './history.js';
import { WorkflowRunner, type QueryFactory } from './runner.js';
export function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    length += Buffer.byteLength(chunk);
    if (length > 8192) throw new Error();
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
const commandSchema = z.strictObject({
  id: z.uuid(),
  action: z.enum(['rename', 'tag', 'fork', 'delete']),
  value: z.string().max(80).optional(),
  confirmId: z.uuid().optional(),
});
export interface AppOptions {
  history?: HistoryService;
  queryFactory?: QueryFactory;
  liveAvailable?: boolean;
}
export function createApiHandler(options: AppOptions = {}) {
  const history = options.history ?? new HistoryService();
  const workflow = new WorkflowRunner(history);
  let busy = false;
  let closing = false;
  let active: AbortController | undefined;
  let finished: Promise<void> | undefined;
  const available = () => options.liveAvailable ?? Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  function lease() {
    busy = true;
    let done!: () => void;
    const completion = new Promise<void>((resolve) => {
      done = resolve;
    });
    finished = completion;
    return () => {
      busy = false;
      active = undefined;
      done();
      if (finished === completion) finished = undefined;
    };
  }
  const api = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/api/')) return false;
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) {
      json(res, 403, { error: 'Use the local application URL.' });
      return true;
    }
    try {
      if (req.method === 'GET' && url.pathname === '/api/meta') {
        json(res, 200, {
          version: VERSION,
          liveAvailable: available(),
          model: process.env.ANTHROPIC_MODEL || 'SDK default',
          transports: TRANSPORTS,
        });
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/library') {
        json(res, 200, await history.list());
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/session') {
        const id = z.uuid().safeParse(url.searchParams.get('id'));
        if (!id.success) {
          json(res, 400, { error: 'Choose a valid owned session.' });
          return true;
        }
        try {
          json(res, 200, await history.detail(id.data));
        } catch {
          json(res, 404, { error: 'That owned session is unavailable.' });
        }
        return true;
      }
      if (
        req.method !== 'POST' ||
        !['/api/inspect', '/api/seed', '/api/command', '/api/run'].includes(url.pathname)
      ) {
        json(res, 404, { error: 'Unknown API endpoint.' });
        return true;
      }
      if (closing) {
        json(res, 503, { error: 'The workshop is shutting down.' });
        return true;
      }
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
        json(res, 403, { error: 'Cross-origin requests are not allowed.' });
        return true;
      }
      if (!req.headers['content-type']?.startsWith('application/json')) {
        json(res, 415, { error: 'Send application/json.' });
        return true;
      }
      let input: unknown;
      try {
        input = await body(req);
      } catch {
        json(res, 400, { error: 'Provide valid JSON no larger than 8 KB.' });
        return true;
      }
      if (busy) {
        json(res, 409, { error: 'An operation is active. Wait or stop the current run.' });
        return true;
      }
      if (url.pathname === '/api/inspect') {
        const parsed = z.strictObject({ transport: z.enum(['sdk', 'stdio']) }).safeParse(input);
        if (!parsed.success) {
          json(res, 400, { error: 'Choose SDK-hosted or local stdio transport.' });
          return true;
        }
        const release = lease();
        const controller = new AbortController();
        active = controller;
        const disconnect = () => controller.abort();
        res.on('close', disconnect);
        const timer = setTimeout(disconnect, 15000);
        try {
          json(res, 200, await inspectConnection(parsed.data.transport, controller.signal));
        } finally {
          clearTimeout(timer);
          res.removeListener('close', disconnect);
          controller.abort();
          release();
        }
        return true;
      }
      if (url.pathname === '/api/seed') {
        if (!z.strictObject({}).safeParse(input).success) {
          json(res, 400, { error: 'No fixture arguments are accepted.' });
          return true;
        }
        const release = lease();
        try {
          json(res, 201, await history.seed());
        } finally {
          release();
        }
        return true;
      }
      if (url.pathname === '/api/command') {
        const parsed = commandSchema.safeParse(input);
        if (!parsed.success) {
          json(res, 400, { error: 'Choose an owned session and valid history action.' });
          return true;
        }
        if (parsed.data.action === 'delete' && parsed.data.confirmId !== parsed.data.id) {
          json(res, 400, { error: 'Confirm the exact session ID before deletion.' });
          return true;
        }
        const release = lease();
        try {
          json(
            res,
            200,
            await history.command(parsed.data.id, parsed.data.action, parsed.data.value),
          );
        } catch {
          json(res, 400, {
            error:
              'The owned history action could not be completed. Check the selected session and value.',
          });
        } finally {
          release();
        }
        return true;
      }
      const parsed = RunSchema.safeParse(input);
      if (!parsed.success) {
        json(res, 400, {
          error: 'Choose a valid live action and transport, with a prompt of 10–1,500 characters.',
        });
        return true;
      }
      if (!available()) {
        json(res, 409, {
          error:
            'Live workflows require your server-side ANTHROPIC_API_KEY. Transport inspection and recorded history need no key.',
        });
        return true;
      }
      if (parsed.data.action === 'resume') {
        try {
          const owner = await history.owned(parsed.data.sessionId!);
          if (owner.origin !== 'live') throw new Error();
        } catch {
          json(res, 400, { error: 'Resume requires a live session created by this workshop.' });
          return true;
        }
      }
      if (busy) {
        json(res, 409, { error: 'Another operation started. Try again after it finishes.' });
        return true;
      }
      const release = lease();
      const controller = new AbortController();
      active = controller;
      const disconnect = () => controller.abort();
      res.on('close', disconnect);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      const send = (event: Event) => {
        if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      const heartbeat = setInterval(() => {
        if (!res.destroyed) res.write(': waiting\n\n');
      }, 10000);
      try {
        const report = await workflow.run(
          parsed.data,
          controller.signal,
          send,
          options.queryFactory,
        );
        send({
          kind: 'result',
          title: 'Live workflow completed',
          detail: report.text,
          data: report,
        });
        send({ kind: 'done', title: 'Finished', detail: report.ok ? 'success' : 'error' });
      } catch (error) {
        send({
          kind: 'error',
          title: controller.signal.aborted ? 'Cancelled' : 'Workflow failed',
          detail: controller.signal.aborted
            ? 'The host cancelled the workflow.'
            : redact(error instanceof Error ? error.message : 'Workflow failed.'),
        });
        send({
          kind: 'done',
          title: 'Finished',
          detail: controller.signal.aborted ? 'cancelled' : 'error',
        });
      } finally {
        clearInterval(heartbeat);
        res.removeListener('close', disconnect);
        controller.abort();
        res.end();
        release();
      }
      return true;
    } catch {
      if (!res.headersSent)
        json(res, 500, {
          error:
            'The workshop could not complete this operation. Its history scope remains private.',
        });
      else res.end();
      return true;
    }
  };
  return Object.assign(api, {
    async dispose() {
      closing = true;
      active?.abort();
      await finished;
    },
  });
}
