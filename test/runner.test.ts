import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { WorkflowRunner, type QueryFactory, type QueryPort } from '../src/server/runner.js';
import { DEFAULT_CONFIG, type Detail } from '../src/shared/lesson.js';
import { FULL_TOOL } from '../src/server/mcp.js';
import { temporaryHistory } from './helpers.js';
function fakeFactory(
  overrides: Partial<QueryPort> = {},
  check?: (request: Parameters<QueryFactory>[0]) => void,
): QueryFactory {
  return (request) => {
    check?.(request);
    const port = {
      async initializationResult() {
        return {};
      },
      async setMcpServers() {
        return { added: ['project'], removed: [], errors: {} };
      },
      async mcpServerStatus() {
        return [{ name: 'project', status: 'connected' }];
      },
      async supportedAgents() {
        return [{ name: 'risk-reviewer', description: 'Test' }];
      },
      async *[Symbol.asyncIterator]() {
        const input = request.prompt as AsyncIterable<unknown>;
        for await (const _message of input) {
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: 'Test result',
            session_id: request.options?.sessionId,
            total_cost_usd: 0.001,
          } as unknown as SDKMessage;
          break;
        }
      },
      close() {},
      ...overrides,
    };
    return port as unknown as QueryPort;
  };
}
test('live controls attach a server and discover agents on one retained query before the task', async () => {
  const h = await temporaryHistory();
  try {
    let registered = '';
    h.history.register = async (id) => {
      registered = id;
      return {} as Detail;
    };
    const workflow = new WorkflowRunner(h.history);
    const calls: string[] = [];
    const report = await workflow.run(
      DEFAULT_CONFIG,
      new AbortController().signal,
      () => {},
      fakeFactory(
        {
          async setMcpServers(servers) {
            calls.push('attach');
            assert.ok(servers.project);
            return { added: ['project'], removed: [], errors: {} };
          },
          async supportedAgents() {
            calls.push('discover');
            return [{ name: 'risk-reviewer', description: 'Test' }];
          },
        },
        (request) => {
          assert.equal(typeof request.prompt, 'object');
          assert.deepEqual(request.options?.mcpServers, {});
          assert.deepEqual(request.options?.tools, ['Agent']);
          assert.equal(request.options?.persistSession, true);
          assert.equal(request.options?.sessionStoreFlush, 'eager');
          assert.equal(request.options?.sessionStore, h.history.stores.live);
          assert.deepEqual(request.options?.agents?.['risk-reviewer']?.tools, [FULL_TOOL]);
          assert.equal(request.options?.agents?.['risk-reviewer']?.model, 'inherit');
        },
      ),
    );
    assert.equal(report.ok, true);
    assert.equal(report.agentStarts, 0);
    assert.deepEqual(report.agents, ['risk-reviewer']);
    assert.equal(registered, report.sessionId);
    assert.deepEqual(calls, ['attach', 'discover']);
  } finally {
    await h.close();
  }
});
test('only an owned live session can be resumed', async () => {
  const h = await temporaryHistory();
  try {
    const fixture = await h.history.seed();
    let calls = 0;
    await assert.rejects(
      new WorkflowRunner(h.history).run(
        { ...DEFAULT_CONFIG, action: 'resume', sessionId: fixture.session.id },
        new AbortController().signal,
        () => {},
        () => {
          calls++;
          throw new Error('Unexpected query');
        },
      ),
      /Recorded/,
    );
    assert.equal(calls, 0);
  } finally {
    await h.close();
  }
});
test('initialization failure closes the handle and releases the waiting input consumer', async () => {
  const h = await temporaryHistory();
  try {
    let closes = 0;
    await assert.rejects(
      new WorkflowRunner(h.history).run(
        DEFAULT_CONFIG,
        new AbortController().signal,
        () => {},
        fakeFactory({
          async initializationResult() {
            throw new Error('Handshake failed');
          },
          close() {
            closes++;
          },
        }),
      ),
      /Handshake failed/,
    );
    assert.equal(closes, 1);
  } finally {
    await h.close();
  }
});
test('missing result and mirror failure are not reported as saved workflow success', async () => {
  const h = await temporaryHistory();
  try {
    for (const mirror of [false, true]) {
      let closes = 0;
      await assert.rejects(
        new WorkflowRunner(h.history).run(
          DEFAULT_CONFIG,
          new AbortController().signal,
          () => {},
          fakeFactory({
            async *[Symbol.asyncIterator]() {
              if (mirror)
                yield { type: 'system', subtype: 'mirror_error' } as unknown as SDKMessage;
            },
            close() {
              closes++;
            },
          }),
        ),
        mirror ? /mirror reported/ : /without a result/,
      );
      assert.equal(closes, 1);
    }
  } finally {
    await h.close();
  }
});
test('unexpected session identity is rejected before history registration', async () => {
  const h = await temporaryHistory();
  try {
    let registered = false;
    h.history.register = async () => {
      registered = true;
      return {} as Detail;
    };
    await assert.rejects(
      new WorkflowRunner(h.history).run(
        DEFAULT_CONFIG,
        new AbortController().signal,
        () => {},
        fakeFactory({
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 'different',
              is_error: false,
              result: 'Wrong session',
            } as unknown as SDKMessage;
          },
        }),
      ),
      /unexpected session identity/,
    );
    assert.equal(registered, false);
  } finally {
    await h.close();
  }
});
test('pre-aborted runs never start the SDK', async () => {
  const h = await temporaryHistory();
  try {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await assert.rejects(
      new WorkflowRunner(h.history).run(
        DEFAULT_CONFIG,
        controller.signal,
        () => {},
        () => {
          calls++;
          throw new Error('Unexpected');
        },
      ),
      /abort/i,
    );
    assert.equal(calls, 0);
  } finally {
    await h.close();
  }
});
