import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { inspectConnection, createProjectServer, stdioConfiguration } from '../src/server/mcp.js';
for (const transport of ['sdk', 'stdio'] as const)
  test(`${transport} performs real initialize, discovery and bounded tool execution`, async () => {
    const result = await inspectConnection(transport);
    assert.deepEqual(result.toolNames, ['get_project_note']);
    assert.equal(result.queryToolName, 'mcp__project__get_project_note');
    assert.match(JSON.stringify(result.result), /Aurora Tasks/);
    assert.match(JSON.stringify(result.result), /ORBIT-42/);
  });
test('MCP schema rejects arbitrary note paths', async () => {
  const server = createProjectServer();
  const client = new Client({ name: 'test', version: '1.0.0' });
  try {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(b);
    await client.connect(a);
    const result = await client.callTool({
      name: 'get_project_note',
      arguments: { file: '../../.env' },
    });
    assert.equal(result.isError, true);
  } finally {
    await client.close();
    await server.instance.close();
  }
});
test('stdio config uses a fixed Node entry and does not pass the model key to that child', () => {
  const config = stdioConfiguration();
  assert.equal(config.command, process.execPath);
  assert.equal(config.env?.ANTHROPIC_API_KEY, '');
  assert.ok(config.args?.at(-1)?.includes('mcp-stdio'));
});
test('pre-aborted inspection never starts a connection', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(inspectConnection('stdio', controller.signal), /abort/i);
});
