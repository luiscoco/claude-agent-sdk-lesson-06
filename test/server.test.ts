import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createApiHandler } from '../src/server/app.js';
import { DEFAULT_CONFIG } from '../src/shared/lesson.js';
import { temporaryHistory } from './helpers.js';
async function host() {
  const fixture = await temporaryHistory();
  const app = createApiHandler({ history: fixture.history, liveAvailable: false });
  const server = createServer((req, res) => {
    void app(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    post: (url: string, value: unknown, headers: Record<string, string> = {}) =>
      fetch(base + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(value),
      }),
    async close() {
      await app.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fixture.close();
    },
  };
}
test('metadata and library begin inside this workshop’s private scope', async () => {
  const h = await host();
  try {
    const meta = await (await fetch(h.base + '/api/meta')).json();
    assert.equal(meta.version, '0.3.310');
    assert.equal(meta.liveAvailable, false);
    assert.equal(meta.transports.length, 4);
    assert.deepEqual(await (await fetch(h.base + '/api/library')).json(), []);
    assert.ok(!JSON.stringify(meta).includes('sk-ant-'));
  } finally {
    await h.close();
  }
});
test('HTTP transport inspection executes a real bounded MCP call', async () => {
  const h = await host();
  try {
    const response = await h.post('/api/inspect', { transport: 'sdk' });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.toolNames, ['get_project_note']);
    assert.match(JSON.stringify(data.result), /Aurora Tasks/);
    assert.equal(
      (await h.post('/api/inspect', { transport: 'http', url: 'https://example.com' })).status,
      400,
    );
  } finally {
    await h.close();
  }
});
test('HTTP fixture, metadata changes and fork use SDK history operations', async () => {
  const h = await host();
  try {
    const seeded = await h.post('/api/seed', {});
    assert.equal(seeded.status, 201);
    const source = await seeded.json();
    assert.equal(source.session.origin, 'recorded');
    const id = source.session.id;
    const renamed = await (
      await h.post('/api/command', { id, action: 'rename', value: 'Classroom review' })
    ).json();
    assert.equal(renamed.session.title, 'Classroom review');
    const tagged = await (
      await h.post('/api/command', { id, action: 'tag', value: 'practice' })
    ).json();
    assert.equal(tagged.session.tag, 'practice');
    const branch = await (
      await h.post('/api/command', { id, action: 'fork', value: 'Alternative route' })
    ).json();
    assert.notEqual(branch.session.id, id);
    assert.equal(branch.session.parentId, id);
    assert.equal(branch.messages.length, source.messages.length);
    assert.equal((await (await fetch(h.base + '/api/library')).json()).length, 2);
  } finally {
    await h.close();
  }
});
test('delete requires exact confirmation and leaves the source of an owned fork intact', async () => {
  const h = await host();
  try {
    const source = await (await h.post('/api/seed', {})).json();
    const branch = await (
      await h.post('/api/command', { id: source.session.id, action: 'fork', value: 'Delete me' })
    ).json();
    const id = branch.session.id;
    assert.equal((await h.post('/api/command', { id, action: 'delete' })).status, 400);
    assert.equal(
      (await h.post('/api/command', { id, action: 'delete', confirmId: randomUUID() })).status,
      400,
    );
    assert.equal(
      (await h.post('/api/command', { id, action: 'delete', confirmId: id })).status,
      200,
    );
    assert.equal((await fetch(h.base + `/api/session?id=${id}`)).status, 404);
    assert.equal((await fetch(h.base + `/api/session?id=${source.session.id}`)).status, 200);
  } finally {
    await h.close();
  }
});
test('unowned IDs and missing credentials never reach arbitrary history or a model', async () => {
  const h = await host();
  try {
    assert.equal((await fetch(h.base + `/api/session?id=${randomUUID()}`)).status, 404);
    assert.equal((await fetch(h.base + '/api/session?id=../../outside')).status, 400);
    assert.equal(
      (await h.post('/api/command', { id: randomUUID(), action: 'rename', value: 'Forbidden' }))
        .status,
      400,
    );
    assert.equal((await h.post('/api/run', DEFAULT_CONFIG)).status, 409);
  } finally {
    await h.close();
  }
});
test('HTTP boundaries reject cross-origin, oversized and arbitrary capability settings', async () => {
  const h = await host();
  try {
    assert.equal((await h.post('/api/seed', {}, { Origin: 'https://example.com' })).status, 403);
    assert.equal((await h.post('/api/seed', {}, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await h.post('/api/seed', { path: 'outside' })).status, 400);
    assert.equal((await h.post('/api/seed', { padding: 'x'.repeat(9000) })).status, 400);
    assert.equal(
      (
        await h.post('/api/run', {
          ...DEFAULT_CONFIG,
          mcpServers: { evil: { command: 'anything' } },
        })
      ).status,
      400,
    );
    assert.equal((await fetch(h.base + '/api/unknown')).status, 404);
  } finally {
    await h.close();
  }
});
