import { z } from 'zod';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { CONFIG_DIRECTORY } from './paths.js';
export const RunSchema = z
  .strictObject({
    action: z.enum(['new', 'resume', 'delegate']),
    transport: z.enum(['sdk', 'stdio']),
    sessionId: z.uuid().optional(),
    prompt: z.string().trim().min(10).max(1500),
  })
  .superRefine((v, c) => {
    if (v.action === 'resume' && !v.sessionId)
      c.addIssue({ code: 'custom', path: ['sessionId'], message: 'Choose an owned live session.' });
    if (v.action !== 'resume' && v.sessionId)
      c.addIssue({
        code: 'custom',
        path: ['sessionId'],
        message: 'Only resume accepts a saved ID.',
      });
  });
export function childEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NonNullable<Options['env']> {
  const names = [
    'PATH',
    'Path',
    'PATHEXT',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'APPDATA',
    'LOCALAPPDATA',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'OS',
    'SystemDrive',
    'CLAUDE_CODE_GIT_BASH_PATH',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'NODE_EXTRA_CA_CERTS',
    'ANTHROPIC_API_KEY',
  ];
  const env: Record<string, string> = {};
  for (const name of names) if (source[name]) env[name] = source[name]!;
  return {
    ...env,
    CLAUDE_CONFIG_DIR: CONFIG_DIRECTORY,
    CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: '1',
  };
}
export const redact = (text: string) => text.replace(/sk-ant-[\w-]+/g, '[redacted]').slice(0, 3500);
