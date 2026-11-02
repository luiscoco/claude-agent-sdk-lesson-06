import {
  listSessions,
  getSessionInfo,
  getSessionMessages,
  listSubagents,
  getSubagentMessages,
  renameSession,
  tagSession,
  forkSession,
  deleteSession,
  type SessionMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FileTranscriptStore } from './store.js';
import { HISTORY_ROOT, FIXTURE_ROOT } from './paths.js';
import { redact } from './config.js';
import type { Origin, Owner, SessionCard, Detail, MessageView } from '../shared/lesson.js';
const OwnerSchema = z.strictObject({
  id: z.uuid(),
  origin: z.enum(['recorded', 'live']),
  parentId: z.uuid().optional(),
  createdAt: z.iso.datetime(),
});
const selected = (message: SessionMessage): MessageView => {
  const body = message.message as { content?: unknown } | undefined;
  const content = body?.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((block) =>
              block?.type === 'text' ? String(block.text) : `[${String(block?.type ?? 'block')}]`,
            )
            .join('\n')
        : '[message content]';
  return { uuid: message.uuid, type: message.type, text: redact(text) };
};
export class HistoryService {
  readonly stores: Record<Origin, FileTranscriptStore>;
  private registry: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly root = HISTORY_ROOT) {
    this.stores = {
      recorded: new FileTranscriptStore(path.join(root, 'recorded')),
      live: new FileTranscriptStore(path.join(root, 'live')),
    };
    this.registry = path.join(root, 'registry.json');
  }
  private async owners(): Promise<Owner[]> {
    try {
      return z.array(OwnerSchema).parse(JSON.parse(await readFile(this.registry, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  private async save(owners: Owner[]) {
    await mkdir(this.root, { recursive: true });
    const tmp = this.registry + '.tmp-' + randomUUID();
    await writeFile(tmp, JSON.stringify(owners), 'utf8');
    await rename(tmp, this.registry);
  }
  private async serial<T>(work: () => Promise<T>) {
    const next = this.queue.catch(() => {}).then(work);
    this.queue = next;
    return next;
  }
  private options(origin: Origin) {
    return { dir: FIXTURE_ROOT, sessionStore: this.stores[origin] };
  }
  async owned(id: string) {
    z.uuid().parse(id);
    const owner = (await this.owners()).find((x) => x.id === id);
    if (!owner) throw new Error('Choose a session created by this workshop.');
    return owner;
  }
  async list(): Promise<SessionCard[]> {
    const owners = await this.owners();
    const output: SessionCard[] = [];
    for (const origin of ['recorded', 'live'] as const) {
      const sessions = await listSessions({
        ...this.options(origin),
        includeWorktrees: false,
        limit: 100,
      });
      for (const info of sessions) {
        const owner = owners.find((x) => x.id === info.sessionId && x.origin === origin);
        if (owner)
          output.push({
            ...owner,
            title: redact(info.customTitle || info.summary),
            tag: info.tag ?? null,
            lastModified: info.lastModified,
          });
      }
    }
    return output.sort((a, b) => b.lastModified - a.lastModified);
  }
  async detail(id: string): Promise<Detail> {
    const owner = await this.owned(id);
    const options = this.options(owner.origin);
    const info = await getSessionInfo(id, options);
    if (!info) throw new Error('The saved session is unavailable.');
    const messages = await getSessionMessages(id, { ...options, limit: 50 });
    const agents = (await listSubagents(id, options)).slice(0, 4);
    const subagents = [];
    for (const agentId of agents)
      subagents.push({
        id: agentId,
        messages: (await getSubagentMessages(id, agentId, { ...options, limit: 25 })).map(selected),
      });
    return {
      session: {
        ...owner,
        title: redact(info.customTitle || info.summary),
        tag: info.tag ?? null,
        lastModified: info.lastModified,
      },
      messages: messages.map(selected),
      subagents,
    };
  }
  async seed() {
    return this.serial(async () => {
      const store = this.stores.recorded;
      await listSessions({ ...this.options('recorded'), includeWorktrees: false });
      const projectKey = store.lastProjectKey;
      if (!projectKey) throw new Error('SDK project scope was not resolved.');
      const id = randomUUID(),
        first = randomUUID();
      const timestamp = new Date().toISOString();
      await store.append({ projectKey, sessionId: id }, [
        {
          type: 'user',
          uuid: first,
          parentUuid: null,
          sessionId: id,
          isSidechain: false,
          timestamp,
          cwd: FIXTURE_ROOT,
          message: {
            role: 'user',
            content:
              'Recorded fixture: review Aurora Tasks. Its project codeword is ORBIT-42. What should we test first?',
          },
        },
        {
          type: 'assistant',
          uuid: randomUUID(),
          parentUuid: first,
          sessionId: id,
          isSidechain: false,
          timestamp,
          cwd: FIXTURE_ROOT,
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'Recorded fixture: define behavior for unknown task IDs and add a focused test. The codeword is ORBIT-42.',
              },
            ],
          },
        },
      ]);
      await renameSession(id, 'Recorded Aurora review', this.options('recorded'));
      await tagSession(id, 'fixture', this.options('recorded'));
      await this.save([...(await this.owners()), { id, origin: 'recorded', createdAt: timestamp }]);
      return this.detail(id);
    });
  }
  async register(id: string) {
    return this.serial(async () => {
      z.uuid().parse(id);
      const existing = (await this.owners()).find((x) => x.id === id);
      if (existing) return this.detail(id);
      for (let attempt = 0; attempt < 30; attempt++) {
        await this.stores.live.idle();
        const info = await getSessionInfo(id, this.options('live'));
        if (info) {
          await this.save([
            ...(await this.owners()),
            { id, origin: 'live', createdAt: new Date().toISOString() },
          ]);
          return this.detail(id);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('The SDK mirror has not produced readable history.');
    });
  }
  async command(id: string, action: 'rename' | 'tag' | 'fork' | 'delete', value?: string) {
    return this.serial(async () => {
      const owner = await this.owned(id);
      const options = this.options(owner.origin);
      if (action === 'rename') {
        const title = z.string().trim().min(1).max(80).parse(value);
        await renameSession(id, title, options);
      } else if (action === 'tag') {
        const tag = z
          .string()
          .trim()
          .max(30)
          .parse(value ?? '');
        await tagSession(id, tag || null, options);
      } else if (action === 'fork') {
        const title = z
          .string()
          .trim()
          .min(1)
          .max(80)
          .parse(value || 'Review branch');
        const fork = await forkSession(id, { ...options, title });
        await this.save([
          ...(await this.owners()),
          {
            id: fork.sessionId,
            origin: owner.origin,
            parentId: id,
            createdAt: new Date().toISOString(),
          },
        ]);
        return this.detail(fork.sessionId);
      } else {
        await deleteSession(id, options);
        await this.save((await this.owners()).filter((x) => x.id !== id));
        return null;
      }
      return this.detail(id);
    });
  }
}
