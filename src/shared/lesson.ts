export const VERSION = '0.3.310';
export type Transport = 'sdk' | 'stdio';
export type Origin = 'recorded' | 'live';
export interface Event {
  kind: 'host' | 'connection' | 'agent' | 'message' | 'history' | 'result' | 'error' | 'done';
  title: string;
  detail: string;
  data?: unknown;
}
export interface Owner {
  id: string;
  origin: Origin;
  parentId?: string;
  createdAt: string;
}
export interface SessionCard extends Owner {
  title: string;
  tag: string | null;
  lastModified: number;
}
export interface MessageView {
  uuid: string;
  type: string;
  text: string;
}
export interface Detail {
  session: SessionCard;
  messages: MessageView[];
  subagents: { id: string; messages: MessageView[] }[];
}
export interface RunConfig {
  action: 'new' | 'resume' | 'delegate';
  transport: Transport;
  sessionId?: string;
  prompt: string;
}
export const DEFAULT_PROMPT =
  'Read README.md using the project MCP tool. Remember the project name and codeword. Explain one project risk in two short sentences.';
export const DEFAULT_CONFIG: RunConfig = {
  action: 'new',
  transport: 'sdk',
  prompt: DEFAULT_PROMPT,
};
export interface RunReport {
  ok: boolean;
  sessionId: string;
  text: string;
  transport: Transport;
  toolReads: number;
  agentStarts: number;
  agents: string[];
  connections: { name: string; status: string }[];
  costUsd: number;
}
export const TRANSPORTS = [
  {
    name: 'SDK-hosted',
    tag: 'RUN LOCALLY',
    description: 'Application tools run in the host process through createSdkMcpServer().',
  },
  {
    name: 'Local stdio',
    tag: 'RUN LOCALLY',
    description: 'A separate Node process serves the same fixture tools over stdin/stdout.',
  },
  {
    name: 'HTTP',
    tag: 'CONFIG EXAMPLE',
    description: 'Connect to a remote MCP endpoint. This lab never accepts arbitrary server URLs.',
  },
  {
    name: 'SSE',
    tag: 'CONFIG EXAMPLE',
    description: 'A legacy remote transport. It is distinct from this app’s UI event stream.',
  },
] as const;
export const GUIDE = [
  {
    group: 'Connection model',
    name: 'stdio / HTTP / SSE / SDK',
    text: 'Choose the transport for where the tool server runs. SDK and stdio are executable here; remote HTTP/SSE examples are compile-checked configuration only.',
  },
  {
    group: 'Tool lifecycle',
    name: 'Define → host → register → inspect',
    text: 'Define positional tool() contracts, host them, register a named server, inspect status, and call the namespaced capability. Healthy connection does not grant permission.',
  },
  {
    group: 'Active query',
    name: 'setMcpServers / mcpServerStatus',
    text: 'The live query waits for initialization, attaches its application-managed server dynamically, then inspects status before submitting input. These controls use one retained handle.',
  },
  {
    group: 'Specialization',
    name: 'agents / supportedAgents / Agent',
    text: 'Definition configures a specialist. supportedAgents discovers it. The Agent tool actually delegates. This app restricts delegation to one risk-reviewer with read-only MCP access.',
  },
  {
    group: 'Saved conversations',
    name: 'listSessions / getSessionInfo / getSessionMessages',
    text: 'These SDK APIs inspect private stored history. Recorded fixtures and live sessions are labeled separately; neither is a snapshot of the filesystem.',
  },
  {
    group: 'Organization',
    name: 'renameSession / tagSession / deleteSession',
    text: 'Names and tags organize saved work. Deletion applies only to app-owned sessions and requires an explicit confirmation in the UI.',
  },
  {
    group: 'Branching',
    name: 'forkSession / resume',
    text: 'A fork copies conversation context into a new identity. Resume continues the chosen branch. Forking does not copy file undo history or revert filesystem changes.',
  },
  {
    group: 'Subagent history',
    name: 'listSubagents / getSubagentMessages',
    text: 'Specialist transcripts are separate from the main conversation. The library shows actual mirrored subagent messages when available, rather than treating discovery as execution.',
  },
  {
    group: 'Version and storage',
    name: 'SessionStore · alpha',
    text: 'This sample deliberately uses the pinned alpha transcript-mirror adapter to keep SDK history APIs inside app-owned storage. Live persistence remains enabled; the mirror does not replace the local SDK write.',
  },
] as const;
export const QUIZ = [
  {
    question: 'When is stdio useful?',
    answers: [
      'When a local MCP process communicates over stdin/stdout',
      'Only for browser event delivery',
      'When renaming a session',
    ],
    correct: 0,
  },
  {
    question: 'Does supportedAgents() launch a specialist?',
    answers: ['Yes, automatically', 'No, it discovers availability', 'Only if a tag is set'],
    correct: 1,
  },
  {
    question: 'Why fork a conversation?',
    answers: [
      'To undo file changes',
      'To replace the original transcript',
      'To explore a new branch while preserving the original',
    ],
    correct: 2,
  },
  {
    question: 'Where should specialist conversation history be inspected?',
    answers: [
      'listSubagents() and getSubagentMessages()',
      'The MCP connection URL',
      'allowedTools',
    ],
    correct: 0,
  },
] as const;
