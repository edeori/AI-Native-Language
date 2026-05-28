import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getArtifactRoot, getWorkspaceRoot } from './paths.js';

export interface ArtifactRecord {
  path: string;
  content: string;
}

export function makeArtifactPath(
  workspaceRoot: string,
  kind: 'graph' | 'validation' | 'generated' | 'cache',
  name: string,
  extension: string,
): string {
  const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact';
  return join(getArtifactRoot(workspaceRoot), kind, `${safeName}.${extension}`);
}

export async function saveArtifact(
  workspaceRoot: string | undefined,
  kind: 'graph' | 'validation' | 'generated' | 'cache',
  name: string,
  extension: string,
  content: string,
): Promise<string> {
  const root = getWorkspaceRoot(workspaceRoot);
  const filePath = makeArtifactPath(root, kind, name, extension);
  await mkdir(join(getArtifactRoot(root), kind), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

export async function loadTextArtifact(path: string): Promise<string> {
  return readFile(path, 'utf8');
}
