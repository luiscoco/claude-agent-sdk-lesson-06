import { mkdir, readFile, writeFile, rename, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SessionStore, SessionKey, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk';
/** Pinned alpha SessionStore implementation. Single host; per-file writes are serialized and atomic. */
export class FileTranscriptStore implements SessionStore {
  readonly root: string;
  lastProjectKey?: string;
  private pending = new Map<string, Promise<unknown>>();
  constructor(root: string) {
    this.root = path.resolve(root);
  }
  private project(projectKey: string) {
    if (!projectKey || projectKey.length > 500) throw new Error('Invalid project key.');
    return path.join(this.root, Buffer.from(projectKey).toString('base64url'));
  }
  private session(key: { projectKey: string; sessionId: string }) {
    z.uuid().parse(key.sessionId);
    const target = path.resolve(this.project(key.projectKey), key.sessionId);
    if (!target.startsWith(this.root + path.sep)) throw new Error('Storage containment failed.');
    return target;
  }
  private file(key: SessionKey) {
    if (key.subpath && !/^subagents\/agent-[A-Za-z0-9_-]{1,160}$/.test(key.subpath))
      throw new Error('Invalid subagent key.');
    return path.join(
      this.session(key),
      key.subpath ? Buffer.from(key.subpath).toString('base64url') + '.json' : 'main.json',
    );
  }
  private async raw(file: string): Promise<SessionStoreEntry[] | null> {
    try {
      const text = await readFile(file, 'utf8');
      if (text.length > 4000000) throw new Error('Transcript exceeds lab limit.');
      const value: unknown = JSON.parse(text);
      if (
        !Array.isArray(value) ||
        !value.every((e) => e && typeof e === 'object' && typeof e.type === 'string')
      )
        throw new Error('Invalid transcript data.');
      return value as SessionStoreEntry[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  private async serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const current = (this.pending.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    this.pending.set(key, current);
    try {
      return await current;
    } finally {
      if (this.pending.get(key) === current) this.pending.delete(key);
    }
  }
  async idle() {
    await Promise.all([...this.pending.values()]);
  }
  append = async (key: SessionKey, entries: SessionStoreEntry[]) => {
    const file = this.file(key);
    await this.serial(file, async () => {
      const previous = (await this.raw(file)) ?? [];
      const ids = new Set(previous.flatMap((e) => (typeof e.uuid === 'string' ? [e.uuid] : [])));
      for (const entry of entries) {
        if (typeof entry.uuid === 'string') {
          if (ids.has(entry.uuid)) continue;
          ids.add(entry.uuid);
        }
        previous.push(structuredClone(entry));
      }
      await mkdir(path.dirname(file), { recursive: true });
      const temporary = file + '.tmp-' + randomUUID();
      const serialized = JSON.stringify(previous);
      if (serialized.length > 4000000) throw new Error('Transcript exceeds lab limit.');
      await writeFile(temporary, serialized, 'utf8');
      await rename(temporary, file);
    });
  };
  load = async (key: SessionKey) => {
    const file = this.file(key);
    await this.pending.get(file);
    return this.raw(file);
  };
  listSessions = async (projectKey: string) => {
    this.lastProjectKey = projectKey;
    await this.idle();
    const directory = this.project(projectKey);
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const result = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !z.uuid().safeParse(entry.name).success) continue;
        try {
          const info = await stat(path.join(directory, entry.name, 'main.json'));
          result.push({ sessionId: entry.name, mtime: Math.floor(info.mtimeMs) });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  };
  listSubkeys = async (key: { projectKey: string; sessionId: string }) => {
    await this.idle();
    try {
      return (await readdir(this.session(key)))
        .filter((name) => name.endsWith('.json') && name !== 'main.json')
        .map((name) => Buffer.from(name.slice(0, -5), 'base64url').toString())
        .filter((name) => /^subagents\/agent-[A-Za-z0-9_-]{1,160}$/.test(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  };
  delete = async (key: SessionKey) => {
    await this.idle();
    const target = key.subpath ? this.file(key) : this.session(key);
    if (!path.resolve(target).startsWith(this.root + path.sep))
      throw new Error('Delete leaves private storage.');
    await rm(target, { recursive: !key.subpath, force: true });
  };
}
