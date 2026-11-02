import {
  createSdkMcpServer,
  tool,
  type McpStdioServerConfig,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { readFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { FIXTURE_ROOT, PROJECT_ROOT } from './paths.js';
import { childEnvironment } from './config.js';
import type { Transport } from '../shared/lesson.js';
export const FULL_TOOL = 'mcp__project__get_project_note';
export function createProjectServer() {
  return createSdkMcpServer({
    name: 'aurora-project',
    version: '1.0.0',
    tools: [
      tool(
        'get_project_note',
        'Read a bundled Aurora Tasks note. Only README.md or risks.json are available.',
        { file: z.enum(['README.md', 'risks.json']) },
        async ({ file }) => {
          const root = await realpath(FIXTURE_ROOT);
          const target = await realpath(path.join(root, file));
          if (!target.startsWith(root + path.sep)) throw new Error('Note leaves the fixture.');
          const text = await readFile(target, 'utf8');
          if (text.length > 16000) throw new Error('Note too large.');
          const note = { file, text };
          return {
            content: [{ type: 'text', text: JSON.stringify(note) }],
            structuredContent: note,
          };
        },
        { annotations: { readOnlyHint: true, openWorldHint: false } },
      ),
    ],
  });
}
export function runtimeEntry(name: string) {
  const compiled = fileURLToPath(new URL(`./${name}.js`, import.meta.url));
  return existsSync(compiled)
    ? [compiled]
    : ['--import', 'tsx', fileURLToPath(new URL(`./${name}.ts`, import.meta.url))];
}
export function stdioConfiguration(): McpStdioServerConfig {
  return {
    type: 'stdio',
    command: process.execPath,
    args: runtimeEntry('mcp-stdio'),
    env: Object.fromEntries(
      Object.entries({ ...childEnvironment(), ANTHROPIC_API_KEY: '' }).filter(
        (e): e is [string, string] => typeof e[1] === 'string',
      ),
    ),
  };
}
export async function inspectConnection(
  transport: Transport,
  signal: AbortSignal = new AbortController().signal,
) {
  signal.throwIfAborted();
  const client = new Client({ name: 'lesson-6-inspector', version: '1.0.0' });
  const hosted = transport === 'sdk' ? createProjectServer() : undefined;
  const abort = () => {
    void client.close();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (hosted) {
      const [a, b] = InMemoryTransport.createLinkedPair();
      await hosted.instance.connect(b);
      await client.connect(a);
    } else {
      const config = stdioConfiguration();
      await client.connect(
        new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: config.env,
          stderr: 'pipe',
        }),
      );
    }
    signal.throwIfAborted();
    const tools = await client.listTools({}, { signal, timeout: 10000 });
    const result = await client.callTool(
      { name: 'get_project_note', arguments: { file: 'README.md' } },
      undefined,
      { signal, timeout: 10000 },
    );
    if (result.isError) throw new Error('The MCP read failed.');
    return {
      transport,
      toolNames: tools.tools.map((t) => t.name),
      queryToolName: FULL_TOOL,
      result,
    };
  } finally {
    signal.removeEventListener('abort', abort);
    await client.close().catch(() => {});
    await hosted?.instance.close().catch(() => {});
  }
}
