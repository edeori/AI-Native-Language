import { mkdir, appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getArtifactRoot, getWorkspaceRoot } from './paths.js';
import { normalizeArtifactName } from './artifacts.js';

export interface FeedbackDeltaRecord {
  id?: string;
  server: string;
  kind: string;
  sourcePath: string;
  sourceHash?: string;
  createdAt?: string;
  summary?: Record<string, unknown>;
  delta?: Record<string, unknown>;
  issues?: Array<Record<string, unknown>>;
  evidence?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export interface FeedbackStoreResult {
  feedbackRoot: string;
  eventLogPath: string;
  snapshotPath: string;
  recordPath: string;
}

export async function appendFeedbackDelta(
  workspaceRoot: string | undefined,
  record: FeedbackDeltaRecord,
): Promise<FeedbackStoreResult> {
  const root = getWorkspaceRoot(workspaceRoot);
  const feedbackRoot = join(getArtifactRoot(root), 'feedback', normalizeArtifactName(record.server, 'server'));
  await mkdir(feedbackRoot, { recursive: true });
  const createdAt = record.createdAt ?? new Date().toISOString();
  const id = record.id ?? createdAt.replace(/[:.]/g, '-');
  const normalizedRecord = {
    ...record,
    id,
    createdAt,
  };
  const eventLogPath = join(feedbackRoot, 'events.ndjson');
  const snapshotPath = join(feedbackRoot, 'current.json');
  const recordPath = join(feedbackRoot, 'records', `${normalizeArtifactName(id)}.json`);
  await mkdir(join(feedbackRoot, 'records'), { recursive: true });
  await appendFile(eventLogPath, `${JSON.stringify(normalizedRecord)}\n`, 'utf8');
  await writeFile(snapshotPath, JSON.stringify(normalizedRecord, null, 2) + '\n', 'utf8');
  await writeFile(recordPath, JSON.stringify(normalizedRecord, null, 2) + '\n', 'utf8');
  return { feedbackRoot, eventLogPath, snapshotPath, recordPath };
}

export async function readLatestFeedbackSnapshot(
  workspaceRoot: string | undefined,
  server: string,
): Promise<FeedbackDeltaRecord | undefined> {
  const root = getWorkspaceRoot(workspaceRoot);
  const snapshotPath = join(getArtifactRoot(root), 'feedback', normalizeArtifactName(server, 'server'), 'current.json');
  try {
    const raw = await readFile(snapshotPath, 'utf8');
    return JSON.parse(raw) as FeedbackDeltaRecord;
  } catch {
    return undefined;
  }
}
