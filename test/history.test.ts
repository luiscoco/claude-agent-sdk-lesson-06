import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HistoryService } from '../src/server/history.js';
import { temporaryHistory } from './helpers.js';
test('a recorded fixture is read through actual SDK history APIs and labeled separately', async () => {
  const h = await temporaryHistory();
  try {
    const fixture = await h.history.seed();
    assert.equal(fixture.session.origin, 'recorded');
    assert.equal(fixture.messages.length, 2);
    assert.match(fixture.messages[1]!.text, /ORBIT-42/);
    assert.equal(fixture.session.tag, 'fixture');
    assert.equal((await h.history.list()).length, 1);
  } finally {
    await h.close();
  }
});
test('rename and tag persist through a fresh service instance', async () => {
  const h = await temporaryHistory();
  try {
    const fixture = await h.history.seed();
    await h.history.command(fixture.session.id, 'rename', 'Student review');
    await h.history.command(fixture.session.id, 'tag', 'practice');
    const fresh = new HistoryService(h.root);
    const detail = await fresh.detail(fixture.session.id);
    assert.equal(detail.session.title, 'Student review');
    assert.equal(detail.session.tag, 'practice');
    await fresh.command(fixture.session.id, 'tag', '');
    assert.equal((await fresh.detail(fixture.session.id)).session.tag, null);
  } finally {
    await h.close();
  }
});
test('SDK fork creates a new identity and remaps messages without changing its source', async () => {
  const h = await temporaryHistory();
  try {
    const source = await h.history.seed();
    const before = await h.history.detail(source.session.id);
    const branch = await h.history.command(source.session.id, 'fork', 'Alternative path');
    assert.ok(branch);
    assert.notEqual(branch.session.id, source.session.id);
    assert.equal(branch.session.parentId, source.session.id);
    assert.equal(branch.messages.length, before.messages.length);
    assert.notEqual(branch.messages[0]!.uuid, before.messages[0]!.uuid);
    assert.deepEqual((await h.history.detail(source.session.id)).messages, before.messages);
    await h.history.command(branch.session.id, 'delete');
    assert.equal((await h.history.list()).length, 1);
    assert.equal((await h.history.detail(source.session.id)).messages.length, 2);
    await assert.rejects(h.history.detail(branch.session.id), /workshop/);
  } finally {
    await h.close();
  }
});
test('SDK subagent history APIs read the separate mirrored transcript', async () => {
  const h = await temporaryHistory();
  try {
    const parent = await h.history.seed();
    const store = h.history.stores.recorded;
    const first = randomUUID();
    await store.append(
      {
        projectKey: store.lastProjectKey!,
        sessionId: parent.session.id,
        subpath: 'subagents/agent-testreview',
      },
      [
        {
          type: 'user',
          uuid: first,
          parentUuid: null,
          sessionId: parent.session.id,
          isSidechain: true,
          message: { role: 'user', content: 'Recorded specialist task.' },
        },
        {
          type: 'assistant',
          uuid: randomUUID(),
          parentUuid: first,
          sessionId: parent.session.id,
          isSidechain: true,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Recorded specialist answer.' }],
          },
        },
      ],
    );
    const detail = await h.history.detail(parent.session.id);
    assert.equal(detail.subagents.length, 1);
    assert.equal(detail.subagents[0]!.id, 'testreview');
    assert.equal(detail.subagents[0]!.messages.length, 2);
  } finally {
    await h.close();
  }
});
test('unregistered or non-UUID session identities cannot be inspected or mutated', async () => {
  const h = await temporaryHistory();
  try {
    await assert.rejects(h.history.detail(randomUUID()), /workshop/);
    await assert.rejects(h.history.command(randomUUID(), 'delete'), /workshop/);
    await assert.rejects(h.history.detail('../../outside'));
    assert.deepEqual(await h.history.list(), []);
  } finally {
    await h.close();
  }
});
test('concurrent history metadata updates are serialized without losing sessions', async () => {
  const h = await temporaryHistory();
  try {
    const [a, b] = await Promise.all([h.history.seed(), h.history.seed()]);
    await Promise.all([
      h.history.command(a.session.id, 'rename', 'A'),
      h.history.command(b.session.id, 'tag', 'B'),
    ]);
    const list = await h.history.list();
    assert.equal(list.length, 2);
    assert.equal(list.find((s) => s.id === a.session.id)?.title, 'A');
    assert.equal(list.find((s) => s.id === b.session.id)?.tag, 'B');
  } finally {
    await h.close();
  }
});
