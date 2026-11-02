import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FIXTURE_ROOT = path.join(PROJECT_ROOT, 'fixtures', 'project');
export const HISTORY_ROOT = path.resolve(
  PROJECT_ROOT,
  process.env.LESSON6_HISTORY_ROOT || '.local/history',
);
if (!HISTORY_ROOT.startsWith(path.join(PROJECT_ROOT, '.local') + path.sep))
  throw new Error('History must stay inside this workshop’s .local directory.');
export const CONFIG_DIRECTORY = path.join(PROJECT_ROOT, '.local', 'sdk-state');
