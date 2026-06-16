import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getArtifactRoot, getWorkspaceRoot } from './paths.js';

export interface ArtifactRecord {
  path: string;
  content: string;
}

export function normalizeArtifactName(name: string, fallback = 'artifact', maxLength = 80): string {
  const sanitized = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');

  const base = sanitized || fallback;
  if (base.length <= maxLength) {
    return base;
  }

  const hash = createHash('sha1').update(name).digest('hex').slice(0, 8);
  const headLength = Math.max(1, maxLength - hash.length - 1);
  const head = base.slice(0, headLength).replace(/[-_.]+$/g, '') || fallback;
  return `${head}-${hash}`;
}

export function makeArtifactPath(
  workspaceRoot: string,
  kind: 'graph' | 'validation' | 'generated' | 'cache' | 'schema',
  name: string,
  extension: string,
): string {
  const safeName = normalizeArtifactName(name);
  return join(getArtifactRoot(workspaceRoot), kind, `${safeName}.${extension}`);
}

export async function saveArtifact(
  workspaceRoot: string | undefined,
  kind: 'graph' | 'validation' | 'generated' | 'cache' | 'schema',
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
