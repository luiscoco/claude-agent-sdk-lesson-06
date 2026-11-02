import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { HistoryService } from '../src/server/history.js';
export async function temporaryHistory() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lesson-06-'));
  const history = new HistoryService(root);
  return {
    root,
    history,
    async close() {
      await Promise.all(Object.values(history.stores).map((s) => s.idle()));
      assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
      await rm(root, { recursive: true, force: true });
    },
  };
}
