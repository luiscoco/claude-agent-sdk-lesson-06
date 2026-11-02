import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type Options,
  type AgentDefinition,
  type PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { InputQueue } from './input.js';
import { createProjectServer, stdioConfiguration, FULL_TOOL } from './mcp.js';
import { RunSchema, childEnvironment, redact } from './config.js';
import { FIXTURE_ROOT, CONFIG_DIRECTORY } from './paths.js';
import { HistoryService } from './history.js';
import type { Event, RunReport } from '../shared/lesson.js';
export type QueryPort = AsyncIterable<SDKMessage> &
  Pick<
    Query,
    'close' | 'initializationResult' | 'setMcpServers' | 'mcpServerStatus' | 'supportedAgents'
  >;
export type QueryFactory = (request: Parameters<typeof query>[0]) => QueryPort;
export const specialist: AgentDefinition = {
  description: 'Review Aurora Tasks project risks using the project MCP note tool.',
  prompt:
    'Read risks.json with the project MCP tool. Identify the most useful next test in two concise sentences. Do not run other tools or delegate.',
  tools: [FULL_TOOL],
  model: 'inherit',
  maxTurns: 4,
  background: false,
  omitClaudeMd: true,
  skills: [],
  permissionMode: 'dontAsk',
};
export class WorkflowRunner {
  constructor(readonly history: HistoryService) {}
  async run(
    input: unknown,
    signal: AbortSignal,
    emit: (event: Event) => void,
    queryFactory: QueryFactory = query,
  ): Promise<RunReport> {
    const config = RunSchema.parse(input);
    signal.throwIfAborted();
    if (config.action === 'resume') {
      const owner = await this.history.owned(config.sessionId!);
      if (owner.origin !== 'live')
        throw new Error('Recorded fixtures cannot be resumed as live sessions.');
    }
    const sessionId = config.action === 'resume' ? config.sessionId! : randomUUID();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(abort, 120000);
    const messages = new InputQueue<SDKUserMessage>();
    const hosted = config.transport === 'sdk' ? createProjectServer() : undefined;
    const server = hosted ?? stdioConfiguration();
    let handle: QueryPort | undefined;
    let task: Promise<void> | undefined;
    let report: RunReport | undefined;
    let reads = 0,
      starts = 0,
      delegations = 0;
    try {
      await mkdir(CONFIG_DIRECTORY, { recursive: true });
      controller.signal.throwIfAborted();
      const options: Options = {
        cwd: FIXTURE_ROOT,
        env: childEnvironment(),
        tools: ['Agent'],
        allowedTools: [FULL_TOOL, 'Agent(risk-reviewer)'],
        disallowedTools: ['Agent(fork)', 'Agent(general-purpose)'],
        permissionMode: 'dontAsk',
        mcpServers: {},
        agents: { 'risk-reviewer': specialist },
        skills: [],
        settingSources: [],
        persistSession: true,
        sessionStore: this.history.stores.live,
        sessionStoreFlush: 'eager',
        maxTurns: 8,
        maxBudgetUsd: 0.35,
        abortController: controller,
        ...(process.env.ANTHROPIC_MODEL ? { model: process.env.ANTHROPIC_MODEL } : {}),
        ...(config.action === 'resume' ? { resume: sessionId } : { sessionId }),
        hooks: {
          PreToolUse: [
            {
              matcher: 'Agent',
              hooks: [
                async (input) => {
                  const args = (input as PreToolUseHookInput).tool_input as Record<string, unknown>;
                  if (
                    config.action !== 'delegate' ||
                    args.subagent_type !== 'risk-reviewer' ||
                    delegations >= 1
                  )
                    return {
                      hookSpecificOutput: {
                        hookEventName: 'PreToolUse',
                        permissionDecision: 'deny',
                        permissionDecisionReason:
                          'Only one configured risk-reviewer delegation is supported.',
                      },
                    };
                  delegations++;
                  emit({
                    kind: 'agent',
                    title: 'Delegation requested',
                    detail:
                      'The Agent tool requested the configured risk-reviewer. Discovery alone would not execute it.',
                  });
                  return {};
                },
              ],
            },
          ],
          SubagentStart: [
            {
              hooks: [
                async (input) => {
                  if ('agent_type' in input && input.agent_type === 'risk-reviewer') starts++;
                  emit({
                    kind: 'agent',
                    title: 'SubagentStart',
                    detail: 'A specialist actually started.',
                    data: { agentType: 'agent_type' in input ? input.agent_type : undefined },
                  });
                  return {};
                },
              ],
            },
          ],
          PostToolUse: [
            {
              matcher: FULL_TOOL,
              hooks: [
                async () => {
                  reads++;
                  emit({
                    kind: 'connection',
                    title: 'Project tool completed',
                    detail: 'A bounded note was read through the registered MCP capability.',
                  });
                  return {};
                },
              ],
            },
          ],
        },
        systemPrompt:
          'You are a concise TypeScript course tutor. Use only the project MCP note tool and, when explicitly requested, exactly one risk-reviewer agent. No source-file edits or shell commands. Keep final answers short. Preserve project facts across resumed conversations.',
      };
      handle = queryFactory({ prompt: messages, options });
      const retained = handle;
      task = (async () => {
        for await (const message of retained) {
          controller.signal.throwIfAborted();
          if (message.type === 'result') {
            if (message.session_id !== sessionId)
              throw new Error('The SDK returned an unexpected session identity.');
            report = {
              ok: message.subtype === 'success' && !message.is_error,
              sessionId: message.session_id,
              text: redact(
                message.subtype === 'success' ? message.result : message.errors.join('\n'),
              ),
              transport: config.transport,
              toolReads: reads,
              agentStarts: starts,
              agents: [],
              connections: [],
              costUsd: message.total_cost_usd,
            };
            emit({
              kind: 'message',
              title: `result · ${message.subtype}`,
              detail: 'The query produced its final outcome.',
            });
            break;
          }
          const raw = message as unknown as Record<string, unknown>;
          if (raw.subtype === 'mirror_error')
            throw new Error('The SDK transcript mirror reported a write failure.');
          emit({
            kind: 'message',
            title: `${message.type}${typeof raw.subtype === 'string' ? ' · ' + raw.subtype : ''}`,
            detail: 'Observed a selected typed SDK event.',
          });
        }
      })();
      void task.catch(() => {});
      await retained.initializationResult();
      emit({
        kind: 'host',
        title: 'Initialization handshake complete',
        detail: 'The retained handle is ready for runtime controls before the first user turn.',
      });
      await retained.setMcpServers({ project: server });
      emit({
        kind: 'connection',
        title: 'setMcpServers()',
        detail: `Attached the application-owned ${config.transport} server under "project".`,
      });
      let statuses = await retained.mcpServerStatus();
      for (
        let n = 0;
        n < 30 && !statuses.some((s) => s.name === 'project' && s.status === 'connected');
        n++
      ) {
        controller.signal.throwIfAborted();
        await new Promise((r) => setTimeout(r, 100));
        statuses = await retained.mcpServerStatus();
      }
      const connections = statuses.map((s) => ({ name: s.name, status: s.status }));
      if (!connections.some((s) => s.name === 'project' && s.status === 'connected'))
        throw new Error('The project MCP server did not connect.');
      emit({
        kind: 'connection',
        title: 'mcpServerStatus()',
        detail: 'Connection health is distinct from tool permission.',
        data: connections,
      });
      const agents = (await retained.supportedAgents()).map((a) => a.name);
      emit({
        kind: 'agent',
        title: 'supportedAgents()',
        detail: 'This call discovers agents; it does not launch them.',
        data: { agents },
      });
      const prompt =
        config.action === 'delegate'
          ? 'Use the risk-reviewer agent exactly once and wait for its report. Ask it to read risks.json with the project MCP tool and identify the most useful next test. Then summarize the report in two sentences.'
          : config.prompt;
      messages.push({
        type: 'user',
        message: { role: 'user', content: prompt },
        parent_tool_use_id: null,
        session_id: '',
        uuid: randomUUID(),
      });
      await task;
      if (!report) throw new Error('The SDK stream ended without a result.');
      const result: RunReport = report;
      result.agents = agents;
      result.connections = connections;
      if (result.ok) {
        await this.history.register(result.sessionId);
        emit({
          kind: 'history',
          title: config.action === 'resume' ? 'Saved continuation' : 'Session persisted',
          detail: 'The private mirror is readable through SDK history APIs.',
          data: { sessionId: result.sessionId },
        });
      }
      return result;
    } finally {
      clearTimeout(timer);
      controller.abort();
      signal.removeEventListener('abort', abort);
      messages.close();
      handle?.close();
      await task?.catch(() => {});
      await hosted?.instance.close().catch(() => {});
      await this.history.stores.live.idle();
      emit({
        kind: 'host',
        title: 'Cleanup',
        detail:
          'Query, input queue, MCP resources, listeners, and timeout released. Owned session history remains private.',
      });
    }
  }
}
