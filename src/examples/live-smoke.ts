import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { HistoryService } from '../server/history.js';
import { WorkflowRunner } from '../server/runner.js';
import { DEFAULT_CONFIG } from '../shared/lesson.js';
import { redact } from '../server/config.js';
if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.ANTHROPIC_API_KEY) throw new Error('Configure your own server-side key.');
console.log(
  'REAL SDK CHECKS — billable queries, $0.35 estimated budget per run. History actions use only app-owned private storage.',
);
const history = new HistoryService();
const workflow = new WorkflowRunner(history);
const run = async (config: typeof DEFAULT_CONFIG) => {
  const report = await workflow.run(config, new AbortController().signal, () => {});
  assert.equal(report.ok, true);
  console.log(JSON.stringify({ action: config.action, transport: config.transport, report }));
  return report;
};
try {
  const first = await run(DEFAULT_CONFIG);
  assert.ok(first.connections.some((c) => c.name === 'project' && c.status === 'connected'));
  assert.ok(first.agents.includes('risk-reviewer'));
  const detail = await history.detail(first.sessionId);
  assert.ok(detail.messages.length >= 2);
  if (process.argv.includes('--all')) {
    const resumed = await run({
      ...DEFAULT_CONFIG,
      action: 'resume',
      sessionId: first.sessionId,
      prompt:
        'What is the project name and codeword we discussed? Answer in one sentence without reading any tools.',
    });
    assert.match(resumed.text, /ORBIT-42/i);
    await history.command(first.sessionId, 'rename', 'Live Aurora review');
    await history.command(first.sessionId, 'tag', 'verified');
    const before = await history.detail(first.sessionId);
    const branch = await history.command(first.sessionId, 'fork', 'Alternative review branch');
    assert.ok(branch);
    assert.notEqual(branch.session.id, first.sessionId);
    assert.equal((await history.detail(first.sessionId)).messages.length, before.messages.length);
    await run({
      ...DEFAULT_CONFIG,
      action: 'resume',
      sessionId: branch.session.id,
      prompt:
        'Continue this branch. State the remembered codeword and suggest a different next step in two sentences.',
    });
    const delegated = await run({ ...DEFAULT_CONFIG, action: 'delegate', transport: 'stdio' });
    assert.ok(delegated.agentStarts >= 1);
    const specialists = await history.detail(delegated.sessionId);
    assert.ok(specialists.subagents.length >= 1);
    assert.ok(specialists.subagents.some((a) => a.messages.length > 0));
    await history.command(branch.session.id, 'delete');
    assert.ok((await history.list()).some((s) => s.id === first.sessionId));
    console.log(
      JSON.stringify({
        historyActionsVerified: [
          'list',
          'detail',
          'rename',
          'tag',
          'fork',
          'resume-fork',
          'delete-owned-fork',
          'subagent-history',
        ],
        originalPreserved: true,
      }),
    );
  }
} catch (error) {
  console.log(
    JSON.stringify({
      verified: false,
      error: redact(error instanceof Error ? error.message : 'Live verification failed.'),
    }),
  );
  process.exitCode = 1;
}
