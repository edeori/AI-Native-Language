import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getConfig } from '../config.js';
import { runCloudRawPrompt, type AgenticReviewContext } from '../agenticReview.js';

const SUMMARIZE_AFTER = 2;

// ── Public API ───────────────────────────────────────────────────

export async function appendMemoryUpdate(
  update: string,
  taskId: string,
  artifactRoot: string,
  workspaceRoot: string,
): Promise<void> {
  const trimmed = update.trim();
  if (!trimmed) return;

  const memFile = memFilePath(artifactRoot);
  await fs.mkdir(path.dirname(memFile), { recursive: true });

  const memory = await loadMemoryFile(memFile);
  memory.recent.push({ taskId, content: trimmed });

  if (memory.recent.length >= SUMMARIZE_AFTER) {
    const newSummary = await summarize(memory.summary, memory.recent, workspaceRoot);
    if (newSummary) {
      memory.summary = newSummary;
      memory.recent = [];
    }
  }

  await writeMemoryFile(memFile, memory);
}

export async function readMemory(artifactRoot: string): Promise<string> {
  try {
    const raw = await fs.readFile(memFilePath(artifactRoot), 'utf8');
    return raw.trim();
  } catch {
    return '';
  }
}

// ── File format ──────────────────────────────────────────────────
// ## Summary
// - bullet 1
// - bullet 2
//
// ---
//
// ## Recent
// ### taskId-A
// - discovery 1
//
// ### taskId-B
// - discovery 2

interface MemoryEntry { taskId: string; content: string; }
interface MemoryFile { summary: string; recent: MemoryEntry[]; }

async function loadMemoryFile(memFile: string): Promise<MemoryFile> {
  try {
    const raw = await fs.readFile(memFile, 'utf8');
    const summaryMatch = /^## Summary\s*$([\s\S]*?)(?=^---|\z)/m.exec(raw);
    const recentSection = /^## Recent\s*$([\s\S]*)/m.exec(raw)?.[1] ?? '';

    const summary = summaryMatch?.[1]?.trim() ?? '';
    const recent: MemoryEntry[] = [];
    const entryRe = /^### (.+)\s*$([\s\S]*?)(?=^### |\z)/gm;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(recentSection)) !== null) {
      const content = m[2].trim();
      if (content) recent.push({ taskId: m[1].trim(), content });
    }
    return { summary, recent };
  } catch {
    return { summary: '', recent: [] };
  }
}

async function writeMemoryFile(memFile: string, memory: MemoryFile): Promise<void> {
  const parts: string[] = [];
  if (memory.summary) {
    parts.push(`## Summary\n${memory.summary}`);
  }
  if (memory.recent.length > 0) {
    const entries = memory.recent.map(e => `### ${e.taskId}\n${e.content}`).join('\n\n');
    parts.push(`## Recent\n${entries}`);
  }
  await fs.writeFile(memFile, parts.join('\n\n---\n\n'), 'utf8');
}

// ── Summarization ────────────────────────────────────────────────

async function summarize(
  existingSummary: string,
  recent: MemoryEntry[],
  workspaceRoot: string,
): Promise<string | null> {
  try {
    const config = getConfig();
    const ctx: AgenticReviewContext = {
      provider: config.reviewProvider,
      mode: config.reviewMode === 'cli' || config.reviewMode === 'endpoint' ? config.reviewMode : 'cli',
      model: config.reviewModel,
      endpoint: config.reviewEndpoint,
      commandId: config.reviewCommandId ?? '',
      commandArgsJson: config.reviewCommandArgsJson ?? '{}',
      promptFileName: 'memory-summarize.prompt.md',
      workspaceRoot,
      sourcePath: workspaceRoot,
      artifactName: 'memory-summarize',
      artifactDir: workspaceRoot,
      semanticSource: '',
    };

    const recentText = recent.map(e => `From task ${e.taskId}:\n${e.content}`).join('\n\n');
    const prompt = [
      'Merge and deduplicate these project memory notes into a concise list.',
      '',
      existingSummary ? `## Existing summary\n${existingSummary}` : '',
      `## New discoveries\n${recentText}`,
      '',
      'Rules:',
      '- Output ONLY bullet points starting with "- ", no headers, no other text',
      '- Maximum 12 bullet points total',
      '- Remove duplicates and outdated items',
      '- Keep only project-specific facts useful for future coding tasks',
    ].filter(Boolean).join('\n');

    const result = await runCloudRawPrompt(ctx, prompt);
    const bullets = result.split('\n').filter(l => l.trimStart().startsWith('- ')).join('\n');
    return bullets || null;
  } catch {
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function memFilePath(artifactRoot: string): string {
  return path.join(artifactRoot, 'development', 'memory', 'memory.md');
}
