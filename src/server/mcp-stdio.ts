import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createProjectServer } from './mcp.js';
// stdout is reserved for MCP JSON-RPC. Do not load the host's .env or print banners here.
const server = createProjectServer();
await server.instance.connect(new StdioServerTransport());
