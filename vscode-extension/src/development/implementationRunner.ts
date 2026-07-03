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
import { detectBestJdk, ensureVscodeJavaSettings } from './workspaceJavaSetup.js';
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
  let streamedText = '';

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

    // For scaffolding tasks, point VS Code's Java/Maven tooling at a real JDK (17+)
    // so the generated multi-module project resolves instead of failing under an
    // older default JDK. Best-effort — never block the task on this.
    if (isCreating) {
      try {
        const jdk = await detectBestJdk(17);
        if (jdk) {
          const outcome = await ensureVscodeJavaSettings(workspaceRoot, jdk);
          outputChannel.appendLine(`[development] .vscode Java runtime (JavaSE-${jdk.major} @ ${jdk.home}): ${outcome}`);
        } else {
          outputChannel.appendLine('[development] no JDK 17+ found to write into .vscode/settings.json — build tooling may use the wrong Java version');
        }
      } catch (e) {
        outputChannel.appendLine(`[development] .vscode Java setup skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

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
    const chunkHandler = (raw: string) => {
      lineBuf += raw;
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        const text = streamLineToText(line, config.reviewProvider);
        if (text) {
          streamedText += (streamedText ? '\n' : '') + text;
          onStreamChunk?.(text);
        }
      }
    };
    // Implementation runs are agentic and can legitimately take longer than a review —
    // give them a 20 min ceiling (vs. the 10 min default) so a valid task isn't SIGKILLed.
    const rawOutput = await runCloudRawPrompt(reviewContext, prompt, chunkHandler, 20 * 60 * 1000);

    // The CLI's final "result" text is often empty when the agent finishes via tool
    // calls without a closing summary — but it still did the work. Fall back to the
    // streamed transcript so a successful run is never mistaken for a failure.
    const effectiveOutput = (rawOutput.trim() ? rawOutput : streamedText).trim();

    // Always persist whatever came back — a successful run, an API error, or an empty
    // run must all leave a trace on disk.
    const reportPath = path.join(taskRunDir, 'report.md');
    await fs.writeFile(reportPath, effectiveOutput || '(no output captured)', 'utf8');
    outputChannel.appendLine(`[development] report saved → ${reportPath}`);

    const apiError = detectProviderError(effectiveOutput);
    if (apiError) {
      throw new Error(apiError);
    }

    const [changedFiles] = await getChangedFiles(workspaceRoot, effectiveOutput);

    // Hard-fail only when the CLI produced nothing AND changed nothing on disk —
    // that is the real "it never ran / needs approval / not on PATH" case.
    if (!effectiveOutput && changedFiles === 0) {
      throw new Error(`${config.reviewProvider} CLI returned no output and changed no files — the CLI may need approval for a tool/command, or is not installed / on PATH. See the Output channel and report.md.`);
    }
    outputChannel.appendLine(`[development] response received (${effectiveOutput.length} chars, ${changedFiles} file(s) changed)`);

    const risks = countRisks(effectiveOutput);
    const summary = extractSection(effectiveOutput, 'Summary')
      ?? (effectiveOutput ? effectiveOutput.slice(0, 300).trim() : `Completed — ${changedFiles} file(s) changed (agent returned no summary text).`);

    const memorySection = extractSection(effectiveOutput, 'Memory update');
    if (memorySection) {
      void appendMemoryUpdate(memorySection, task.taskId, artifactRoot, workspaceRoot);
    }

    // docDrift: Claude reports it explicitly in "# Semantic drift" — not a file-name heuristic
    const driftNotes = extractSection(effectiveOutput, 'Semantic drift') ?? '';
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
    // Persist whatever streamed before the failure (e.g. a timeout SIGKILL) so the run
    // leaves a trace instead of vanishing with an empty report.
    try {
      await fs.writeFile(
        path.join(taskRunDir, 'report.md'),
        `# Failed\n\n${msg}\n\n---\n\n## Partial transcript\n\n${streamedText || '(nothing streamed before failure)'}`,
        'utf8',
      );
    } catch { /* best-effort */ }
    // Put the task back on the queue but keep why it failed so the UI can show it.
    await patchTask(artifactRoot, task.taskId, {
      status: 'queued',
      failureReason: msg,
      failedAt: new Date().toISOString(),
    });
    await onStateChange(task.taskId);
    throw err;
  }
}

// ── Changed files ────────────────────────────────────────────────

async function getChangedFiles(workspaceRoot: string, report: string): Promise<[number, string[]]> {
  try {
    // `git status --porcelain` covers modified, staged AND untracked files — a fresh
    // skeleton is all-untracked, which `git diff` alone would miss (reporting 0 changes).
    const { stdout } = await execAsync('git status --porcelain', { cwd: workspaceRoot });
    const paths = stdout
      .split('\n')
      .map(l => l.slice(3).trim())   // strip the 2-char status code + separator
      .filter(Boolean);
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

// The provider CLIs exit 0 and print the API/gateway error as their "result" text,
// so an invalid model or auth failure otherwise sails through as a successful "done".
// Detect the common error shapes and turn them into a hard failure with a clear message.
function detectProviderError(output: string): string | undefined {
  const head = output.trim().slice(0, 600);
  if (/^\s*API Error\b/i.test(head)) return head.split('\n')[0].trim();
  if (/Invalid model name/i.test(head)) return head.replace(/\s+/g, ' ').trim();
  if (/^\s*Error:/i.test(head) && /model|api|auth|credit|quota|permission/i.test(head)) {
    return head.split('\n')[0].trim();
  }
  return undefined;
}

function streamLineToText(line: string, provider: string): string {
  if (!line.trim()) return '';
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return ''; }
  if (!parsed || typeof parsed !== 'object') return '';
  const item = parsed as Record<string, unknown>;

  if (provider === 'claude') {
    // stream-json: assistant messages carry an array of content blocks. Text blocks
    // are prose; tool_use blocks are the file edits / commands. Both live INSIDE
    // message.content — there is no top-level "tool_use" envelope.
    if (item.type === 'assistant') {
      const content = ((item.message as Record<string, unknown>)?.content ?? []) as Array<Record<string, unknown>>;
      const parts: string[] = [];
      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          parts.push(block.text);
        } else if (block.type === 'tool_use') {
          const name = typeof block.name === 'string' ? block.name : 'Tool';
          const input = block.input as Record<string, unknown> | undefined;
          const fp = (input?.file_path ?? input?.path ?? input?.command ?? '') as string;
          parts.push(`→ ${name}${fp ? ': ' + fp : ''}`);
        }
      }
      return parts.join('\n');
    }
    if (item.type === 'result' && typeof item.result === 'string') {
      return '';  // final summary is captured as the report — don't duplicate in the live log
    }
  } else if (provider === 'codex') {
    if (item.type === 'item.completed') {
      const inner = item.item as Record<string, unknown> | undefined;
      if (inner?.type === 'agent_message' && typeof inner.text === 'string') return inner.text;
      // Surface tool activity (command runs, file edits) so the live log isn't blank
      // while Codex works. Field names vary by version — fall back to the item type.
      if (inner && typeof inner.type === 'string') {
        const label = (inner.command ?? inner.path ?? inner.file ?? '') as string;
        return `→ ${inner.type}${label ? ': ' + label : ''}`;
      }
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
