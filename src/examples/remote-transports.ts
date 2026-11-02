import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
/** Configuration examples only. No remote connection is made by the workshop. */
export const remoteHttp: McpServerConfig = { type: 'http', url: 'https://example.invalid/mcp' };
export const remoteSse: McpServerConfig = { type: 'sse', url: 'https://example.invalid/sse' };
