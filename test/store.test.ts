import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { temporaryHistory } from './helpers.js';
test('append preserves opaque entries, deduplicates UUID retries, and retains metadata updates', async () => {
  const h = await temporaryHistory();
  try {
    const store = h.history.stores.recorded;
    const key = { projectKey: 'project-a', sessionId: randomUUID() };
    const uuid = randomUUID();
    await store.append(key, [{ type: 'user', uuid, message: { role: 'user', content: 'One' } }]);
    await store.append(key, [
      { type: 'user', uuid, message: { role: 'user', content: 'Retry' } },
      { type: 'custom-title', customTitle: 'First' },
      { type: 'custom-title', customTitle: 'Second' },
    ]);
    const entries = await store.load(key);
    assert.equal(entries?.length, 3);
    assert.deepEqual(entries?.[0]?.message, { role: 'user', content: 'One' });
    assert.equal(entries?.[2]?.customTitle, 'Second');
  } finally {
    await h.close();
  }
});
test('concurrent append batches preserve call order and do not corrupt JSON', async () => {
  const h = await temporaryHistory();
  try {
    const store = h.history.stores.recorded;
    const key = { projectKey: 'project-a', sessionId: randomUUID() };
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.append(key, [{ type: 'fixture', index, uuid: randomUUID() }]),
      ),
    );
    assert.deepEqual(
      (await store.load(key))?.map((e) => e.index),
      Array.from({ length: 20 }, (_, i) => i),
    );
    assert.equal((await store.listSessions(key.projectKey)).length, 1);
  } finally {
    await h.close();
  }
});
test('project and subagent keys are scoped; delete removes only the selected session', async () => {
  const h = await temporaryHistory();
  try {
    const store = h.history.stores.recorded;
    const id = randomUUID();
    const a = { projectKey: 'A', sessionId: id },
      b = { projectKey: 'B', sessionId: id };
    await store.append(a, [{ type: 'a' }]);
    await store.append(b, [{ type: 'b' }]);
    await store.append({ ...a, subpath: 'subagents/agent-review' }, [{ type: 'child' }]);
    assert.deepEqual(await store.listSubkeys(a), ['subagents/agent-review']);
    await store.delete(a);
    assert.equal(await store.load(a), null);
    assert.equal((await store.load(b))?.[0]?.type, 'b');
    assert.deepEqual(await store.listSubkeys(a), []);
  } finally {
    await h.close();
  }
});
test('invalid session and subpath keys cannot escape private storage', async () => {
  const h = await temporaryHistory();
  try {
    const store = h.history.stores.recorded;
    await assert.rejects(store.load({ projectKey: 'A', sessionId: '../../outside' }));
    await assert.rejects(
      store.append({ projectKey: 'A', sessionId: randomUUID(), subpath: '../../.env' }, [
        { type: 'bad' },
      ]),
    );
    assert.equal(await store.load({ projectKey: 'A', sessionId: randomUUID() }), null);
  } finally {
    await h.close();
  }
});
