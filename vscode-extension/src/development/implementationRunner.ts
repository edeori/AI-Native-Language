import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getConfig } from '../config.js';
import { runCloudRawPrompt, type AgenticReviewContext } from '../agenticReview.js';
import { assemblePrompt } from './contextAssembler.js';
import { appendMemoryUpdate } from './memoryManager.js';
import { patchTask, runDir, updateTaskStatus } from './taskStore.js';
import type { TaskEntry } from './types.js';

const execAsync = promisify(exec);

export interface RunTaskResult {
  docDrift: boolean;
  driftNotes: string;
}

export async function runImplementationTask(
  task: TaskEntry,
  artifactRoot: string,
  workspaceRoot: string,
  outputChannel: vscode.OutputChannel,
  onStateChange: (taskId: string) => Promise<void>,
  onStreamChunk?: (text: string) => void,
): Promise<RunTaskResult> {
  const config = getConfig();
  const taskRunDir = await runDir(artifactRoot, task.taskId);

  outputChannel.appendLine(`[development] starting task ${task.taskId}`);
  await updateTaskStatus(artifactRoot, task.taskId, 'running');
  await onStateChange(task.taskId);

  try {
    const { prompt, directionPath, isCreating } = await assemblePrompt(
      artifactRoot,
      task.taskId,
      task.direction,
      workspaceRoot,
      taskRunDir,
    );
    outputChannel.appendLine(`[development] prompt assembled (${prompt.length} chars), direction saved → ${directionPath}`);

    const reviewContext: AgenticReviewContext = {
      provider: config.reviewProvider,
      mode: config.reviewMode === 'cli' || config.reviewMode === 'endpoint' ? config.reviewMode : 'cli',
      model: config.reviewModel,
      endpoint: config.reviewEndpoint,
      commandId: config.reviewCommandId ?? '',
      commandArgsJson: config.reviewCommandArgsJson ?? '{}',
      promptFileName: `dev-${task.taskId}.prompt.md`,
      workspaceRoot,
      sourcePath: taskRunDir,
      artifactName: task.taskId,
      artifactDir: taskRunDir,
      semanticSource: '',
      mcpServers: isCreating ? { compiler: config.compilerUrl } : undefined,
    };

    outputChannel.appendLine(`[development] calling ${config.reviewProvider} (${config.reviewModel})…`);
    let lineBuf = '';
    const chunkHandler = onStreamChunk ? (raw: string) => {
      lineBuf += raw;
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        const text = streamLineToText(line, config.reviewProvider);
        if (text) onStreamChunk(text);
      }
    } : undefined;
    const rawOutput = await runCloudRawPrompt(reviewContext, prompt, chunkHandler);
    if (!rawOutput.trim()) {
      throw new Error(`${config.reviewProvider} CLI returned empty output — is the CLI installed and on PATH?`);
    }
    outputChannel.appendLine(`[development] response received (${rawOutput.length} chars)`);

    const reportPath = path.join(taskRunDir, 'report.md');
    await fs.writeFile(reportPath, rawOutput, 'utf8');
    outputChannel.appendLine(`[development] report saved → ${reportPath}`);

    const [changedFiles] = await getChangedFiles(workspaceRoot, rawOutput);
    const risks = countRisks(rawOutput);
    const summary = extractSection(rawOutput, 'Summary') ?? rawOutput.slice(0, 300).trim();

    const memorySection = extractSection(rawOutput, 'Memory update');
    if (memorySection) {
      void appendMemoryUpdate(memorySection, task.taskId, artifactRoot, workspaceRoot);
    }

    // docDrift: Claude reports it explicitly in "# Semantic drift" — not a file-name heuristic
    const driftNotes = extractSection(rawOutput, 'Semantic drift') ?? '';
    const docDrift = driftNotes.trim().length > 0;
    if (docDrift) outputChannel.appendLine(`[development] ⚠ semantic drift noted by Claude for task ${task.taskId}`);

    await patchTask(artifactRoot, task.taskId, {
      status: 'done',
      docDrift,
      result: { summary, changedFiles, risks, timestamp: new Date().toISOString() },
    });

    outputChannel.appendLine(`[development] task ${task.taskId} done — ${changedFiles} files changed`);
    await onStateChange(task.taskId);
    return { docDrift, driftNotes };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[development] task ${task.taskId} ERROR: ${msg}`);
    await updateTaskStatus(artifactRoot, task.taskId, 'queued');
    await onStateChange(task.taskId);
    throw err;
  }
}

// ── Changed files ────────────────────────────────────────────────

async function getChangedFiles(workspaceRoot: string, report: string): Promise<[number, string[]]> {
  try {
    const { stdout } = await execAsync('git diff --name-only HEAD', { cwd: workspaceRoot });
    const paths = stdout.trim().split('\n').filter(Boolean);
    return [paths.length, paths];
  } catch {
    const section = extractSection(report, 'Changed files') ?? '';
    const lines = section.split('\n').filter(l => l.trim().startsWith('-'));
    const paths = lines.map(l => l.replace(/^-\s*/, '').split(' —')[0].trim());
    return [paths.length, paths];
  }
}

function countRisks(report: string): number {
  const section = extractSection(report, 'Risks') ?? '';
  return section.split('\n').filter(l => l.trim().startsWith('-')).length;
}

// ── Helpers ──────────────────────────────────────────────────────

function streamLineToText(line: string, provider: string): string {
  if (!line.trim()) return '';
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return ''; }
  if (!parsed || typeof parsed !== 'object') return '';
  const item = parsed as Record<string, unknown>;

  if (provider === 'claude') {
    if (item.type === 'assistant') {
      const content = ((item.message as Record<string, unknown>)?.content ?? []) as Array<Record<string, unknown>>;
      return content.filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text as string).join('');
    }
    if (item.type === 'tool_use') {
      const name = typeof item.name === 'string' ? item.name : 'Tool';
      const input = item.input as Record<string, unknown> | undefined;
      const fp = (input?.file_path ?? input?.path ?? '') as string;
      return `→ ${name}${fp ? ': ' + fp : ''}`;
    }
  } else if (provider === 'codex') {
    if (item.type === 'item.completed') {
      const inner = item.item as Record<string, unknown> | undefined;
      if (inner?.type === 'agent_message' && typeof inner.text === 'string') return inner.text;
    }
  }
  return '';
}

function extractSection(report: string, heading: string): string | undefined {
  const re = new RegExp(`^#+ ${heading}\\s*$`, 'mi');
  const match = re.exec(report);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const nextHeading = report.indexOf('\n#', start);
  return report.slice(start, nextHeading === -1 ? undefined : nextHeading).trim();
}
