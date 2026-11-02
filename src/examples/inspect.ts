import { inspectConnection } from '../server/mcp.js';
import { HistoryService } from '../server/history.js';
for (const transport of ['sdk', 'stdio'] as const) {
  const result = await inspectConnection(transport);
  console.log(
    JSON.stringify({
      transport,
      tools: result.toolNames,
      queryToolName: result.queryToolName,
      realMcpCall: true,
    }),
  );
}
const history = new HistoryService();
const fixture = await history.seed();
console.log(
  JSON.stringify({
    recordedFixture: true,
    id: fixture.session.id,
    messages: fixture.messages.length,
    modelRequests: 0,
  }),
);
