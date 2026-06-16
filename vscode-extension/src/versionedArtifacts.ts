import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export type ArtifactVersionKind = 'semantic' | 'validation' | 'graph' | 'review' | 'recon' | 'databaseSchema';

export interface VersionedArtifactFile {
  path: string;
  content: string;
}

export interface VersionedArtifactRecord {
  versionId: string;
  kind: ArtifactVersionKind;
  baseName: string;
  createdAt: string;
  sourcePath?: string;
  sourceHash?: string;
  label?: string;
  files: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface VersionedArtifactIndex {
  kind: ArtifactVersionKind;
  baseName: string;
  records: VersionedArtifactRecord[];
}

export interface WriteVersionedArtifactParams {
  artifactRoot: string;
  kind: ArtifactVersionKind;
  baseName: string;
  sourcePath?: string;
  sourceHash?: string;
  label?: string;
  files: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export async function writeVersionedArtifact(params: WriteVersionedArtifactParams): Promise<VersionedArtifactRecord> {
  const versionId = createVersionId();
  const createdAt = new Date().toISOString();
  const safeBaseName = normalizeArtifactName(params.baseName);
  const versionRoot = path.join(params.artifactRoot, 'versions', params.kind, safeBaseName, versionId);
  await fs.mkdir(versionRoot, { recursive: true });

  const filePaths: Record<string, string> = {};
  for (const [relativePath, content] of Object.entries(params.files)) {
    const fullPath = path.join(versionRoot, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
    filePaths[relativePath] = fullPath;
  }

  const record: VersionedArtifactRecord = {
    versionId,
    kind: params.kind,
    baseName: safeBaseName,
    createdAt,
    sourcePath: params.sourcePath,
    sourceHash: params.sourceHash,
    label: params.label,
    files: filePaths,
    metadata: params.metadata,
  };

  const indexPath = path.join(params.artifactRoot, 'versions', params.kind, safeBaseName, 'index.json');
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  const index = await readVersionedArtifactIndex(params.artifactRoot, params.kind, safeBaseName);
  const records = [...(index?.records ?? []), record];
  const nextIndex: VersionedArtifactIndex = {
    kind: params.kind,
    baseName: safeBaseName,
    records,
  };
  await fs.writeFile(indexPath, JSON.stringify(nextIndex, null, 2) + '\n', 'utf8');
  return record;
}

export async function readVersionedArtifactIndex(
  artifactRoot: string,
  kind: ArtifactVersionKind,
  baseName: string,
): Promise<VersionedArtifactIndex | undefined> {
  const indexPath = path.join(artifactRoot, 'versions', kind, normalizeArtifactName(baseName), 'index.json');
  try {
    const text = await fs.readFile(indexPath, 'utf8');
    const parsed = JSON.parse(text) as VersionedArtifactIndex;
    if (!parsed || parsed.kind !== kind || !Array.isArray(parsed.records)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export async function readLatestVersionedArtifact(
  artifactRoot: string,
  kind: ArtifactVersionKind,
  baseName: string,
): Promise<VersionedArtifactRecord | undefined> {
  const index = await readVersionedArtifactIndex(artifactRoot, kind, baseName);
  if (!index || index.records.length === 0) {
    return undefined;
  }
  return index.records[index.records.length - 1];
}

export function hashArtifactContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
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

function createVersionId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
