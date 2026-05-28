import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function getWorkspaceRoot(explicitRoot?: string): string {
  return explicitRoot || process.env.AI_NATIVE_WORKSPACE_ROOT || process.cwd();
}

export function getArtifactRoot(workspaceRoot: string): string {
  return join(workspaceRoot, '.ai-native');
}

export async function ensureDirectory(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await ensureDirectory(filePath);
  await writeFile(filePath, content, 'utf8');
}
