import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ExtensionConfig } from './config.js';

export interface AgenticReviewIssue {
  severity: 'info' | 'warning' | 'gap' | 'conflict' | 'violation';
  code: string;
  message: string;
  sourceRef?: string;
  sourceLine?: number;
}

export interface AgenticDiagramItem {
  name: string;
  detail?: string;
  sourceRef?: string;
}

export interface AgenticDiagramLayer {
  title: string;
  description?: string;
  accent?: string;
  items: AgenticDiagramItem[];
}

export interface AgenticDiagramClassification {
  title?: string;
  summary?: string;
  layers: AgenticDiagramLayer[];
  databaseSchema?: {
    title?: string;
    summary?: string;
    tables: Array<{
      name: string;
      description?: string;
      primaryKey?: string[];
      columns: Array<{
        name: string;
        type?: string;
        detail?: string;
      }>;
    }>;
    relationships?: Array<{
      fromTable: string;
      fromColumn: string;
      toTable: string;
      toColumn: string;
      cardinality: string;
      description?: string;
    }>;
  };
}

export interface AgenticReviewContext {
  provider: ExtensionConfig['reviewProvider'];
  mode: ExtensionConfig['reviewMode'];
  model: string;
  endpoint: string;
  commandId: string;
  commandArgsJson: string;
  promptFileName: string;
  workspaceRoot?: string;
  sourcePath: string;
  artifactDir?: string;
  artifactName?: string;
  semanticSource: string;
  expectationDocuments?: Array<{ path: string; content: string }>;
  graph: unknown;
  validation: {
    status: string;
    summary: { gaps: number; conflicts: number; warnings: number; violations: number };
    issues: Array<{
      severity?: string;
      code?: string;
      message?: string;
      sourceRef?: string;
      sourceLine?: number;
    }>;
  };
}

export interface AgenticReviewResult {
  provider: string;
  mode: string;
  model: string;
  bridgeAction: string;
  usedEndpoint?: string;
  promptPath?: string;
  reviewArtifactPath?: string;
  promptArtifactPath?: string;
  rawOutput?: string;
  summary: string;
  notes: string[];
  issues: AgenticReviewIssue[];
  refinedSemanticMarkdown?: string;
  diagramClassification?: AgenticDiagramClassification;
}

export interface AgentRuntimeProbeResult {
  provider: string;
  model: string;
  command: string;
  bridgeAction: string;
  ok: boolean;
  rawOutput?: string;
  error?: string;
}

export async function runAgenticReview(context: AgenticReviewContext): Promise<AgenticReviewResult> {
  const prompt = buildPrompt(context);
  return runAgenticPrompt(context, prompt);
}

export async function runAgenticPrompt(context: AgenticReviewContext, prompt: string): Promise<AgenticReviewResult> {
  let result: AgenticReviewResult;

  if (context.mode === 'endpoint' && context.endpoint) {
    result = await runEndpointReview(context, prompt);
  } else if (context.mode === 'cli') {
    result = await runCliReview(context, prompt);
  } else if (context.mode === 'command' && context.commandId.trim()) {
    result = await runCommandReview(context, prompt);
  } else if (context.mode === 'prompt-file') {
    result = await runPromptFileReview(context, prompt);
  } else {
    result = localReview(context);
  }

  return persistReviewArtifacts(context, prompt, result);
}

export async function probeAgentRuntime(
  provider: AgenticReviewContext['provider'],
  model: string,
  workspaceRoot?: string,
): Promise<AgentRuntimeProbeResult> {
  const prompt = 'Return exactly OK.';
  const cli = await resolveProviderCli(provider, model, prompt, workspaceRoot);
  if (!cli) {
    return {
      provider,
      model,
      command: provider,
      bridgeAction: `cli-unavailable:${provider}`,
      ok: false,
      error: `No CLI command is configured for ${provider}.`,
    };
  }

  try {
    const cwd = workspaceRoot ?? process.cwd();
    const output = await executeCli(cli.command, cli.args, cli.stdin ?? '', cwd);
    const normalized = normalizeCliOutput(output.stdout, output.stderr);
    return {
      provider,
      model,
      command: cli.command,
      bridgeAction: `cli:${cli.command}${cli.args.length ? ` ${cli.args.join(' ')}` : ''}`,
      ok: true,
      rawOutput: normalized,
    };
  } catch (error) {
    return {
      provider,
      model,
      command: cli.command,
      bridgeAction: `cli-failed:${cli.command}`,
      ok: false,
      error: stringifyError(error),
    };
  } finally {
    await cli.cleanup?.().catch(() => undefined);
  }
}

async function runEndpointReview(context: AgenticReviewContext, prompt: string): Promise<AgenticReviewResult> {
  try {
    const response = await fetch(context.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: context.provider,
        model: context.model,
        prompt,
        context: {
          sourcePath: context.sourcePath,
          validation: context.validation,
          graph: context.graph,
        },
      }),
    });

    if (response.ok) {
      const json = (await response.json()) as Partial<AgenticReviewResult> & { summary?: string; notes?: string[] };
      return {
        provider: context.provider,
        mode: context.mode,
        model: context.model,
        bridgeAction: `endpoint:${context.endpoint}`,
        usedEndpoint: context.endpoint,
        summary: json.summary?.trim() || `Provider ${context.provider} returned a review response.`,
        notes: Array.isArray(json.notes) ? json.notes.filter(Boolean) : [],
        issues: normalizeIssues(json.issues),
      };
    }
  } catch {
    // fall through
  }

  const fallback = localReview(context);
  fallback.bridgeAction = `endpoint-fallback:${context.endpoint}`;
  fallback.usedEndpoint = context.endpoint;
  fallback.notes.unshift(`Endpoint bridge failed, fell back to local review for ${context.provider}.`);
  return fallback;
}

async function runCliReview(context: AgenticReviewContext, prompt: string): Promise<AgenticReviewResult> {
  const cwd = context.workspaceRoot ?? path.dirname(context.sourcePath);
  const cli = await resolveProviderCli(context.provider, context.model, prompt, cwd);
  if (!cli) {
    return {
      bridgeAction: `cli-unavailable:${context.provider}`,
      provider: context.provider,
      mode: 'cli',
      model: context.model,
      summary: `${context.provider} CLI is not available on this machine.`,
      notes: [`No CLI command is configured for ${context.provider}.`],
      issues: [],
    };
  }

  try {
    const output = await executeCli(cli.command, cli.args, cli.stdin ?? '', cwd);
    const normalized = normalizeCliOutput(output.stdout, output.stderr);
    const parsed = cli.provider === 'claude'
      ? parseClaudeCliReviewOutput(normalized, context, cli.command)
      : parseCodexCliReviewOutput(normalized, context, cli.command);
    return {
      provider: context.provider,
      mode: 'cli',
      model: context.model,
      bridgeAction: `cli:${cli.command}${cli.args.length ? ` ${cli.args.join(' ')}` : ''}`,
      summary: parsed.summary,
      notes: parsed.notes,
      issues: parsed.issues,
      rawOutput: normalized,
    };
  } catch (error) {
    return {
      provider: context.provider,
      mode: 'cli',
      model: context.model,
      bridgeAction: `cli-failed:${cli.command}`,
      summary: `${context.provider} CLI failed to run.`,
      notes: [
        `CLI command ${cli.command} failed: ${stringifyError(error)}`,
        'No local fallback was used because a non-local provider was selected.',
      ],
      issues: [],
      rawOutput: stringifyError(error),
    };
  } finally {
    await cli.cleanup?.().catch(() => undefined);
  }
}

async function runCommandReview(context: AgenticReviewContext, prompt: string): Promise<AgenticReviewResult> {
  const commandArgs = parseCommandArgs(context.commandArgsJson, prompt, context);
  try {
    await vscode.commands.executeCommand(context.commandId, commandArgs);
    const fallback = localReview(context);
    fallback.bridgeAction = `command:${context.commandId}`;
    fallback.notes.unshift(`Executed review command ${context.commandId}.`);
    return fallback;
  } catch (error) {
    const fallback = localReview(context);
    fallback.bridgeAction = `command-fallback:${context.commandId}`;
    fallback.notes.unshift(`Review command ${context.commandId} failed: ${stringifyError(error)}. Falling back to local review.`);
    return fallback;
  }
}

async function runPromptFileReview(context: AgenticReviewContext, prompt: string): Promise<AgenticReviewResult> {
  const workspaceRoot = context.workspaceRoot;
  if (!workspaceRoot) {
    const fallback = localReview(context);
    fallback.bridgeAction = 'prompt-file-fallback:no-workspace';
    fallback.notes.unshift('No workspace root is available for prompt-file review. Falling back to local review.');
    return fallback;
  }

  const promptPath = path.join(workspaceRoot, context.promptFileName || '.github/prompts/ai-native-review.prompt.md');
  await fs.mkdir(path.dirname(promptPath), { recursive: true });
  await fs.writeFile(promptPath, prompt, 'utf8');

  const fallback = localReview(context);
  fallback.bridgeAction = `prompt-file:${promptPath}`;
  fallback.promptPath = promptPath;
  fallback.notes.unshift(`Wrote review prompt to ${promptPath} without opening an editor.`);
  return fallback;
}

function localReview(context: AgenticReviewContext): AgenticReviewResult {
  const notes: string[] = [];
  const issues: AgenticReviewIssue[] = context.validation.issues.map((issue) => ({
    severity: normalizeSeverity(issue.severity),
    code: issue.code ?? 'issue',
    message: issue.message ?? '',
    sourceRef: issue.sourceRef,
    sourceLine: issue.sourceLine,
  }));

  if (context.validation.summary.violations === 0 && context.validation.summary.gaps === 0) {
    notes.push('Semantic source is structurally coherent.');
  }

  if (context.validation.summary.warnings > 0) {
    notes.push('Review warnings before trusting the generated graph as a final architecture view.');
  }

  if (!issues.some((issue) => issue.code === 'missing_modules')) {
    notes.push('If the app is layered or modular, verify that module boundaries are explicit.');
  }

  notes.push('Review the graph as a schematic, not as a proof of completeness.');

  return {
    provider: context.provider,
    mode: context.mode,
    model: context.model,
    bridgeAction: 'local',
    summary: `Local review completed for ${context.sourcePath}.`,
    notes,
    issues,
  };
}

async function persistReviewArtifacts(
  context: AgenticReviewContext,
  prompt: string,
  result: AgenticReviewResult,
): Promise<AgenticReviewResult> {
  if (!context.workspaceRoot) {
    return result;
  }

  const reviewDir = context.artifactDir ?? path.join(context.workspaceRoot, '.ai-native', 'review');
  await fs.mkdir(reviewDir, { recursive: true });

  const baseName = `${slugify(context.artifactName ?? path.basename(context.sourcePath))}.${slugify(result.provider)}.${slugify(result.mode)}`;
  const jsonPath = path.join(reviewDir, `${baseName}.json`);
  const mdPath = path.join(reviewDir, `${baseName}.md`);
  const promptPath = path.join(reviewDir, `${baseName}.prompt.md`);

  const artifact = {
    sourcePath: context.sourcePath,
    provider: result.provider,
    mode: result.mode,
    model: result.model,
    bridgeAction: result.bridgeAction,
    usedEndpoint: result.usedEndpoint,
    promptPath: result.promptPath,
    rawOutput: result.rawOutput,
    validation: context.validation,
    summary: result.summary,
    notes: result.notes,
    issues: result.issues,
    refinedSemanticMarkdown: result.refinedSemanticMarkdown,
    diagramClassification: result.diagramClassification,
    graph: context.graph,
  };

  await fs.writeFile(jsonPath, JSON.stringify(artifact, null, 2), 'utf8');
  await fs.writeFile(promptPath, prompt, 'utf8');
  const markdownLines = [
    '# AI Native Review',
    '',
    `- Source: ${context.sourcePath}`,
    `- Provider: ${result.provider}`,
    `- Mode: ${result.mode}`,
    `- Model: ${result.model}`,
    `- Bridge: ${result.bridgeAction}`,
    result.usedEndpoint ? `- Endpoint: ${result.usedEndpoint}` : undefined,
    result.promptPath ? `- Prompt file: ${result.promptPath}` : undefined,
    result.rawOutput ? `- Raw output: available` : undefined,
    '',
    '## Summary',
    result.summary,
  ];
  if (result.refinedSemanticMarkdown) {
    markdownLines.push('', '## Refined Semantic Markdown', result.refinedSemanticMarkdown);
  }
  if (result.diagramClassification?.layers?.length) {
    markdownLines.push('', '## Diagram Classification');
    if (result.diagramClassification.title) {
      markdownLines.push(`- title: ${result.diagramClassification.title}`);
    }
    if (result.diagramClassification.summary) {
      markdownLines.push(`- summary: ${result.diagramClassification.summary}`);
    }
    for (const layer of result.diagramClassification.layers) {
      markdownLines.push(
        '',
        `### ${layer.title}`,
        layer.description ? layer.description : '',
        ...layer.items.map((item) => `- ${item.name}${item.detail ? ` — ${item.detail}` : ''}`),
      );
    }
  }
  if (result.diagramClassification?.databaseSchema?.tables?.length) {
    markdownLines.push('', '## Database Schema');
    if (result.diagramClassification.databaseSchema.title) {
      markdownLines.push(`- title: ${result.diagramClassification.databaseSchema.title}`);
    }
    if (result.diagramClassification.databaseSchema.summary) {
      markdownLines.push(`- summary: ${result.diagramClassification.databaseSchema.summary}`);
    }
    for (const table of result.diagramClassification.databaseSchema.tables) {
      markdownLines.push(
        '',
        `### ${table.name}`,
        table.description ? table.description : '',
        ...(table.primaryKey?.length ? [`- primary key: ${table.primaryKey.join(', ')}`] : []),
        ...table.columns.map((column) => `- ${column.name}${column.type ? `: ${column.type}` : ''}${column.detail ? ` — ${column.detail}` : ''}`),
      );
    }
    if (result.diagramClassification.databaseSchema.relationships?.length) {
      markdownLines.push('', '### Relationships');
      for (const relationship of result.diagramClassification.databaseSchema.relationships) {
        markdownLines.push(
          `- ${relationship.fromTable}.${relationship.fromColumn} -> ${relationship.toTable}.${relationship.toColumn} (${relationship.cardinality})${relationship.description ? ` — ${relationship.description}` : ''}`,
        );
      }
    }
  }
  markdownLines.push(
    '',
    '## Notes',
    ...result.notes.map((note) => `- ${note}`),
    '',
    '## Issues',
    ...result.issues.map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.message}`),
    '',
    '## Validation summary',
    JSON.stringify(context.validation.summary, null, 2),
  );
  await fs.writeFile(
    mdPath,
    markdownLines.filter(Boolean).join('\n'),
    'utf8',
  );

  return {
    ...result,
    reviewArtifactPath: jsonPath,
    promptArtifactPath: promptPath,
  };
}

async function resolveProviderCli(
  provider: AgenticReviewContext['provider'],
  model: string,
  prompt: string,
  workspaceRoot?: string,
): Promise<{ command: string; args: string[]; stdin?: string; provider: AgenticReviewContext['provider']; cleanup?: () => Promise<void> } | undefined> {
  switch (provider) {
    case 'codex':
      return {
        command: resolveExecutablePath('codex') ?? 'codex',
        args: [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'workspace-write',
          ...(workspaceRoot ? ['--cd', workspaceRoot] : []),
          '--model',
          model || 'gpt-5.5',
          '--json',
          '-',
        ],
        stdin: prompt,
        provider,
      };
    case 'claude':
      return buildClaudeInvocation(model, prompt, workspaceRoot);
    default:
      return undefined;
  }
}

async function buildClaudeInvocation(
  model: string,
  prompt: string,
  workspaceRoot?: string,
): Promise<{ command: string; args: string[]; stdin?: string; provider: 'claude'; cleanup?: () => Promise<void> } | undefined> {
  const command = resolveExecutablePath('claude') ?? 'claude';
  return {
    command,
    provider: 'claude',
    args: [
      ...(workspaceRoot ? ['--cd', workspaceRoot] : []),
      '-p',
      '--output-format',
      'json',
      '--model',
      model || 'sonnet',
    ],
    stdin: prompt,
    cleanup: async () => {
      // no-op
    },
  };
}

function executeCli(command: string, args: string[], prompt: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Command ${command} timed out.`));
    }, 10 * 60 * 1000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command ${command} exited with code ${code}. ${stderr.trim()}`.trim()));
      }
    });
    if (prompt.trim()) {
      child.stdin.end(`${prompt}\n`);
    } else {
      child.stdin.end();
    }
  });
}

function normalizeCliOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
}

function parseCodexCliReviewOutput(output: string, context: AgenticReviewContext, command: string): { summary: string; notes: string[]; issues: AgenticReviewIssue[] } {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const agentMessages = lines
    .map((line) => safeJsonParse(line))
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .filter((item) => item.type === 'item.completed')
    .map((item) => item.item)
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .filter((item) => item.type === 'agent_message')
    .map((item) => (typeof item.text === 'string' ? item.text.trim() : ''))
    .filter(Boolean);

  return parseStructuredReviewOutput(
    agentMessages.at(-1) ?? lines.join('\n'),
    `${context.provider} CLI review completed via ${command}.`,
  );
}

function parseClaudeCliReviewOutput(output: string, context: AgenticReviewContext, command: string): { summary: string; notes: string[]; issues: AgenticReviewIssue[] } {
  return parseStructuredReviewOutput(
    output,
    `${context.provider} CLI review completed via ${command}.`,
  );
}

function normalizeSeverity(value: string | undefined): AgenticReviewIssue['severity'] {
  switch (value) {
    case 'info':
    case 'warning':
    case 'gap':
    case 'conflict':
    case 'violation':
      return value;
    default:
      return 'info';
  }
}

function normalizeIssues(issues: unknown): AgenticReviewIssue[] {
  if (!Array.isArray(issues)) {
    return [];
  }

  return issues
    .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : undefined))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      severity: normalizeSeverity(typeof item.severity === 'string' ? item.severity : undefined),
      code: typeof item.code === 'string' ? item.code : 'issue',
      message: typeof item.message === 'string' ? item.message : '',
      sourceRef: typeof item.sourceRef === 'string' ? item.sourceRef : undefined,
      sourceLine: typeof item.sourceLine === 'number' ? item.sourceLine : undefined,
    }));
}

function extractString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => extractString(item)).filter((item): item is string => Boolean(item));
}

function parseCommandArgs(raw: string, prompt: string, context: AgenticReviewContext): Record<string, unknown> {
  const fallback = { prompt, context: { sourcePath: context.sourcePath, provider: context.provider, mode: context.mode } };
  if (!raw.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return replacePlaceholders(parsed, {
      prompt,
      sourcePath: context.sourcePath,
      provider: context.provider,
      mode: context.mode,
      model: context.model,
    }) as Record<string, unknown>;
  } catch {
    return fallback;
  }
}

function replacePlaceholders(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return Object.entries(variables).reduce(
      (accumulator, [key, replacement]) => accumulator.replaceAll('${' + key + '}', replacement),
      value,
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholders(item, variables));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, replacePlaceholders(child, variables)]),
    );
  }
  return value;
}

function buildPrompt(context: AgenticReviewContext): string {
  const expectationDocuments = context.expectationDocuments ?? [];
  return [
    `You are reviewing an AI-native semantic application slice.`,
    `Provider: ${context.provider}`,
    `Mode: ${context.mode}`,
    `Model: ${context.model}`,
    `Source: ${context.sourcePath}`,
    '',
    'Expectation documents:',
    expectationDocuments.length > 0
      ? expectationDocuments.flatMap((document) => [
          `### ${document.path}`,
          document.content,
          '',
        ]).join('\n')
      : '### mcp-validation-policy.md\nNo expectation documents provided.',
    '',
    'Semantic source:',
    context.semanticSource,
    '',
    'Validation summary:',
    JSON.stringify(context.validation.summary, null, 2),
    '',
    'Validation issues:',
    JSON.stringify(context.validation.issues, null, 2),
    '',
    'Graph:',
    JSON.stringify(context.graph, null, 2),
    '',
    'Task:',
    'Review the slice against the policy and the graph. Return ONLY valid JSON with this schema:',
    '{ "summary": "string", "notes": ["string"], "issues": [{ "severity": "info|warning|gap|conflict|violation", "code": "string", "message": "string", "sourceRef": "string?", "sourceLine": 0? }], "refinedSemanticMarkdown": "string?", "diagramClassification": { "title": "string?", "summary": "string?", "layers": [{ "title": "string", "description": "string?", "accent": "string?", "items": [{ "name": "string", "detail": "string?", "sourceRef": "string?" }] }], "databaseSchema": { "title": "string?", "summary": "string?", "tables": [{ "name": "string", "description": "string?", "primaryKey": ["string?"]?, "columns": [{ "name": "string", "type": "string?", "detail": "string?" }] }], "relationships": [{ "fromTable": "string", "fromColumn": "string", "toTable": "string", "toColumn": "string", "cardinality": "1:1|1:N|N:1|N:M", "description": "string?" }] } } }',
    'The diagramClassification must group the graph into a software architecture diagram and a database schema diagram. Use software architecture lanes named: Web / HTTP ingress, Integration interfaces, Security, Services, Persistence / storage. Do not use a Logic layer or API documentation lane in the architecture diagram. Put websocket, redis, mail, object storage, message queues, and external HTTP clients under integration interfaces or persistence, not web ingress. Put scheduled jobs and async listeners under processes or service responsibilities, not web ingress. Include all significant components. Do not truncate with "+more". Flow scenarios must be separate rows with steps listed vertically.',
    'Do not wrap the JSON in markdown fences. Do not echo the input. Report only findings that are supported by the semantic source and policy.',
  ].join('\n');
}

function parseStructuredReviewOutput(output: string, fallbackSummary: string): { summary: string; notes: string[]; issues: AgenticReviewIssue[]; refinedSemanticMarkdown?: string; diagramClassification?: AgenticDiagramClassification } {
  const candidates = extractJsonCandidates(output);
  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate);
    if (!parsed || typeof parsed !== 'object') {
      continue;
    }

    const item = parsed as Record<string, unknown>;
    return {
      summary: extractString(item.summary) ?? extractString(item.message) ?? fallbackSummary,
      notes: extractStringArray(item.notes),
      issues: normalizeIssues(item.issues),
      refinedSemanticMarkdown: extractString(item.refinedSemanticMarkdown),
      diagramClassification: normalizeDiagramClassification(item.diagramClassification),
    };
  }

  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    summary: lines[0] ?? fallbackSummary,
    notes: lines.slice(1),
    issues: [],
    refinedSemanticMarkdown: undefined,
    diagramClassification: undefined,
  };
}

function normalizeDiagramClassification(value: unknown): AgenticDiagramClassification | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const item = value as Record<string, unknown>;
  const layers = Array.isArray(item.layers)
    ? item.layers
        .map((layer) => (layer && typeof layer === 'object' ? (layer as Record<string, unknown>) : undefined))
        .filter((layer): layer is Record<string, unknown> => Boolean(layer))
        .map((layer) => ({
          title: extractString(layer.title) ?? 'Layer',
          description: extractString(layer.description),
          accent: extractString(layer.accent),
          items: Array.isArray(layer.items)
            ? layer.items
                .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : undefined))
                .filter((entry): entry is Record<string, unknown> => Boolean(entry))
                .map((entry) => ({
                  name: extractString(entry.name) ?? extractString(entry.label) ?? 'Unnamed component',
                  detail: extractString(entry.detail),
                  sourceRef: extractString(entry.sourceRef),
                }))
            : [],
        }))
    : [];

  const databaseSchema = item.databaseSchema && typeof item.databaseSchema === 'object'
    ? normalizeDatabaseSchema(item.databaseSchema)
    : undefined;

  if (layers.length === 0 && !databaseSchema) {
    return undefined;
  }

  return {
    title: extractString(item.title),
    summary: extractString(item.summary),
    layers,
    databaseSchema,
  };
}

function normalizeDatabaseSchema(value: unknown): AgenticDiagramClassification['databaseSchema'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const item = value as Record<string, unknown>;
  const tables = Array.isArray(item.tables)
    ? item.tables
        .map((table) => (table && typeof table === 'object' ? (table as Record<string, unknown>) : undefined))
        .filter((table): table is Record<string, unknown> => Boolean(table))
        .map((table) => ({
          name: extractString(table.name) ?? 'table',
          description: extractString(table.description),
          primaryKey: extractStringArray(table.primaryKey),
          columns: Array.isArray(table.columns)
            ? table.columns
                .map((column) => (column && typeof column === 'object' ? (column as Record<string, unknown>) : undefined))
                .filter((column): column is Record<string, unknown> => Boolean(column))
                .map((column) => ({
                  name: extractString(column.name) ?? 'column',
                  type: extractString(column.type),
                  detail: extractString(column.detail),
                }))
            : [],
        }))
    : [];
  const relationships = Array.isArray(item.relationships)
    ? item.relationships
        .map((relationship) => (relationship && typeof relationship === 'object' ? (relationship as Record<string, unknown>) : undefined))
        .filter((relationship): relationship is Record<string, unknown> => Boolean(relationship))
        .map((relationship) => ({
          fromTable: extractString(relationship.fromTable) ?? 'source_table',
          fromColumn: extractString(relationship.fromColumn) ?? 'source_column',
          toTable: extractString(relationship.toTable) ?? 'target_table',
          toColumn: extractString(relationship.toColumn) ?? 'target_column',
          cardinality: extractString(relationship.cardinality) ?? 'N:1',
          description: extractString(relationship.description),
        }))
    : [];

  if (tables.length === 0 && relationships.length === 0) {
    return undefined;
  }

  return {
    title: extractString(item.title),
    summary: extractString(item.summary),
    tables,
    relationships,
  };
}

function extractJsonCandidates(text: string): string[] {
  const candidates = new Set<string>();
  const trimmed = text.trim();
  if (trimmed) {
    candidates.add(trimmed);
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) {
    candidates.add(fenced[1].trim());
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.add(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return [...candidates];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'artifact';
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function resolveExecutablePath(command: string): string | undefined {
  const candidates = new Set<string>();
  const pathValue = process.env.PATH ?? '';
  for (const entry of pathValue.split(path.delimiter)) {
    const trimmed = entry.trim();
    if (trimmed) {
      candidates.add(path.join(trimmed, command));
    }
  }

  const home = process.env.HOME ?? os.homedir();
  for (const extra of [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    '/usr/bin',
    '/bin',
  ]) {
    candidates.add(path.join(extra, command));
  }

  for (const candidate of candidates) {
    try {
      if (fsSync.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // best-effort only
    }
  }

  return undefined;
}

export function resolveAgentCliPath(provider: 'codex' | 'claude'): string | undefined {
  return resolveExecutablePath(provider);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
