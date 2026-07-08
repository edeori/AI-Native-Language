import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { runCloudRawPrompt, CreditExhaustedError, type AgenticReviewContext } from './agenticReview.js';
import { getConfig } from './config.js';
import { commandIds } from './constants.js';
import type { McpRegistry } from './mcpRegistry.js';

function makeStreamTracker(postFn: ((msg: unknown) => void) | undefined, label: string) {
  let lineBuffer = '';
  let charsReceived = 0;
  let lastCharPost = 0;
  let lastSection = '';

  return (chunk: string) => {
    charsReceived += chunk.length;
    lineBuffer += chunk;
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (parsed.type === 'assistant') {
          const content = (parsed.message as Record<string, unknown> | undefined)?.content;
          if (Array.isArray(content)) {
            for (const block of content as Record<string, unknown>[]) {
              if (block.type === 'text' && typeof block.text === 'string') {
                const headings = [...block.text.matchAll(/(?:^|\n)(##\s+\S[^\n]{0,50})/g)];
                const last = headings.at(-1)?.[1]?.trim();
                if (last && last !== lastSection) {
                  lastSection = last;
                  postFn?.({ type: 'progress', message: `${label} → ${last}` });
                }
              }
            }
          }
        }
      } catch {
        // not JSON, ignore
      }
    }

    const now = Date.now();
    if (now - lastCharPost > 3000) {
      lastCharPost = now;
      postFn?.({ type: 'progress', message: `${label} (${Math.round(charsReceived / 1000)}k chars)` });
    }
  };
}

export interface AnalyzeDocImportsOptions {
  workspaceRoot: string;
  outputChannel: vscode.OutputChannel;
  postFn?: (msg: unknown) => void;
  registry?: McpRegistry;
}

export async function analyzeDocImports(opts: AnalyzeDocImportsOptions): Promise<void> {
  try {
    await _runAnalyzeDocImports(opts);
  } catch (err) {
    if (err instanceof CreditExhaustedError) {
      const msg = err.message || 'API credit or usage limit reached.';
      opts.outputChannel.appendLine(`[doc-import-ai] CREDIT EXHAUSTED: ${msg}`);
      opts.postFn?.({ type: 'creditExhausted', message: msg });
      vscode.window.showErrorMessage(
        `AI credit limit reached: ${msg}`,
        'Open Claude.ai',
      ).then((action) => {
        if (action === 'Open Claude.ai') {
          void vscode.env.openExternal(vscode.Uri.parse('https://claude.ai'));
        }
      });
      return;
    }
    throw err;
  }
}

async function _runAnalyzeDocImports(opts: AnalyzeDocImportsOptions): Promise<void> {
  const { workspaceRoot, outputChannel, postFn } = opts;

  const progress = (message: string) => {
    outputChannel.appendLine(`[doc-import-ai] ${message}`);
    postFn?.({ type: 'progress', message });
  };

  const outputDir = path.join(workspaceRoot, '.ai-native');
  const importsDir = path.join(outputDir, 'imports');
  const semanticPath = path.join(outputDir, 'source.semantic.md');

  let importFiles: string[];
  try {
    importFiles = (await fs.readdir(importsDir)).filter((f) => f.endsWith('.md'));
  } catch {
    progress('No imported documents found. Run Import Documents first.');
    vscode.window.showWarningMessage('No imported documents found. Run "Import Documents" first.');
    postFn?.({ type: 'analysisDone', error: true });
    return;
  }

  if (importFiles.length === 0) {
    progress('No .md files in .ai-native/imports/. Run Import Documents first.');
    vscode.window.showWarningMessage('No .md files found in .ai-native/imports/. Run "Import Documents" first.');
    postFn?.({ type: 'analysisDone', error: true });
    return;
  }

  progress(`Reading ${importFiles.length} imported document(s)…`);

  const docs = await Promise.all(
    importFiles.map(async (f) => ({
      name: f.replace(/\.md$/, ''),
      content: await fs.readFile(path.join(importsDir, f), 'utf8'),
    })),
  );

  const existingSemanticMd = await fs.readFile(semanticPath, 'utf8').catch(() => '');

  const config = getConfig();
  const agContext: AgenticReviewContext = {
    provider: config.reviewProvider,
    mode: config.reviewMode,
    model: config.reviewModel,
    endpoint: config.reviewEndpoint,
    commandId: config.reviewCommandId,
    commandArgsJson: config.reviewCommandArgsJson,
    promptFileName: config.reviewPromptFileName,
    workspaceRoot,
    sourcePath: semanticPath,
    semanticSource: existingSemanticMd,
    artifactName: 'doc-import-analysis',
  };

  // Phase 1: compact per-doc extraction — keeps each call small
  progress(`Phase 1/2 — extracting facts from ${docs.length} document(s)…`);

  const extracts: { name: string; facts: string }[] = [];
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    progress(`[${i + 1}/${docs.length}] Extracting: ${doc.name}…`);

    const extractPrompt = `Extract all technical facts from this document. Output ONLY a compact bullet list.
Do NOT use tools. Do NOT write files. Output ONLY the bullet list — no prose, no headers.

Include every item found (skip categories not present in this document):
- api: METHOD /path — brief description
- table: TableName — key fields
- flow: FlowName — key steps (1-2 lines)
- rule: RuleName — what it does
- integration: ServiceName — how it is used
- model: ModelName — key fields
- config: SettingName — meaning

Max 100 bullets. No prose. No markdown headers.

DOCUMENT: ${doc.name}
---
${doc.content.slice(0, 60_000)}`;

    const extractTracker = makeStreamTracker(postFn, `  [${i + 1}/${docs.length}] extracting`);
    const facts = await runCloudRawPrompt(agContext, extractPrompt, extractTracker).catch((e: unknown) => {
      if (e instanceof CreditExhaustedError) throw e;
      progress(`  Warning: extraction failed for ${doc.name}: ${e instanceof Error ? e.message : String(e)}`);
      return '';
    });
    const factLines = facts?.trim().split('\n').filter(Boolean) ?? [];
    if (factLines.length > 0) {
      progress(`  → ${factLines.length} facts extracted`);
    }
    extracts.push({ name: doc.name, facts: facts?.trim() ?? '' });
  }

  // Phase 2: synthesis from compact extracts — much smaller prompt than sending all raw docs
  const validExtracts = extracts.filter((e) => e.facts.length > 0);
  if (validExtracts.length === 0) {
    progress('No facts extracted. Check AI Review provider configuration.');
    vscode.window.showWarningMessage('AI analysis returned no results. Check the AI Review provider configuration.');
    postFn?.({ type: 'analysisDone', error: true });
    return;
  }

  const factsSection = validExtracts.map((e) => `### ${e.name}\n${e.facts}`).join('\n\n---\n\n');
  progress(`Phase 2/2 — synthesizing into source.semantic.md (${Math.round(factsSection.length / 1000)}k chars of facts)…`);

  const synthesisPrompt = `TASK: Write a complete source.semantic.md from these extracted technical facts.

CRITICAL INSTRUCTIONS:
- Output ONLY the raw markdown content. Do NOT use any tools. Do NOT write to files.
- Your entire response must be the file content and nothing else.
- Include EVERY fact listed below. Be exhaustive — more detail is better. Use sub-bullets for details.
- Write in English even if source documents are in Hungarian or another language.

${existingSemanticMd.trim() ? `EXISTING source.semantic.md (enrich and expand — do not lose existing content):\n---\n${existingSemanticMd.trim()}\n---\n\n` : ''}EXTRACTED FACTS FROM ${docs.length} DOCUMENT(S):

${factsSection}

---

OUTPUT FORMAT — use EXACTLY this heading structure (H1 for system title, H2 for all sections):

# <name of the system>

## intent
<2-4 sentences: what does this system do, what business problem does it solve>

## context
<list every component, module, service, database entity, tech found>
- ComponentName — what it does
- tech: full tech stack

## interfaces
<list EVERY API endpoint and event found — use EXACTLY these prefixes>
- api: \`METHOD /path\` — description
- event: TopicName — description, key format, schema

## processes
<describe EVERY flow, process, workflow, migration step in detail>
- **Process Name**:
  - step 1: ...
  - step 2: ...

## data_flows
<describe how data moves, transformations, persistence>
- EntityName: source → transformation → destination

## database_schema
<list every database table found — use EXACTLY this format: "table TableName | columns: col1:type, col2:type">
- table TableName | columns: id:uuid, field1:type, field2:type

## dependencies
<every external system, service, tech dependency>
- ServiceName — how it's used`;

  const result = await runCloudRawPrompt(agContext, synthesisPrompt, makeStreamTracker(postFn, 'Synthesizing'));

  if (result && result.trim().length > 20) {
    const content = result.trim().replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
    await fs.mkdir(outputDir, { recursive: true });

    if (existingSemanticMd.trim()) {
      // semantic.md already exists → do NOT overwrite. The synthesized content is
      // already an AI merge (the synthesis prompt was given the existing doc and
      // told to enrich, not lose it), so write it as a clean proposal (no conflict
      // markers) for a plain 2-pane review + apply.
      const proposedPath = path.join(outputDir, 'source.semantic.proposed.md');
      if (content.trim() !== existingSemanticMd.trim()) {
        await fs.writeFile(proposedPath, content + '\n', 'utf8');
        progress('AI merge proposal ready → source.semantic.proposed.md (review & apply)');
        postFn?.({ type: 'analysisDone', proposed: true });
        void vscode.commands.executeCommand(commandIds.reviewReconcile, { artifactRoot: outputDir });
      } else {
        progress('No changes vs current source.semantic.md.');
        postFn?.({ type: 'analysisDone', chars: content.length });
        vscode.window.showInformationMessage('Document import: no changes vs current source.semantic.md.');
      }
    } else {
      // First import → create the source of truth, then derive the canonical graph
      // AND the database schema from it so source.graph.json / source.database.*
      // exist right away (kept consistent with source.semantic.md).
      await fs.writeFile(semanticPath, content + '\n', 'utf8');
      progress(`Done — source.semantic.md created (${content.length} chars)`);
      if (opts.registry) {
        await regenerateSemanticDerivedArtifacts({ registry: opts.registry, semanticContent: content, outputDir, progress });
      }
      postFn?.({ type: 'analysisDone', chars: content.length });
      vscode.window.showInformationMessage(`AI analysis complete — source.semantic.md created (${content.length} chars)`);
    }
  } else {
    progress('AI returned empty result. Check AI Review provider configuration.');
    postFn?.({ type: 'analysisDone', error: true });
    vscode.window.showWarningMessage('AI analysis returned no result. Check the AI Review provider configuration.');
  }
}

// Persist the canonical schema pair (source.database.json + source.database.md)
// git carries their history — no file-level version snapshot is kept.
async function writeSchemaArtifacts(
  schema: DatabaseSchemaLike,
  outputDir: string,
): Promise<void> {
  const schemaJson = JSON.stringify(schema, null, 2) + '\n';
  const schemaMd = renderDatabaseSchemaMd(schema);
  await fs.writeFile(path.join(outputDir, 'source.database.json'), schemaJson, 'utf8');
  await fs.writeFile(path.join(outputDir, 'source.database.md'), schemaMd, 'utf8');
}

// AI-driven merge of the semantic source. Given the CURRENT source.semantic.md and
// the INCOMING (freshly generated) version, an AI agent produces one clean merged
// markdown — the new content is authoritative but existing curated detail is kept.
// Writes source.semantic.proposed.md (NO conflict markers) for a plain 2-pane review.
export async function reconcileSemanticWithAi(opts: {
  currentMarkdown: string;
  incomingMarkdown: string;
  workspaceRoot: string;
  outputDir: string;
  progress?: (msg: string) => void;
}): Promise<{ proposedPath: string; changed: boolean }> {
  const { currentMarkdown, incomingMarkdown, workspaceRoot, outputDir } = opts;
  const progress = opts.progress ?? (() => { /* noop */ });
  const proposedPath = path.join(outputDir, 'source.semantic.proposed.md');

  // Nothing to merge against → the incoming version is the proposal as-is.
  if (!currentMarkdown.trim()) {
    await fs.writeFile(proposedPath, incomingMarkdown.trimEnd() + '\n', 'utf8');
    return { proposedPath, changed: incomingMarkdown.trim().length > 0 };
  }

  const config = getConfig();
  const agContext: AgenticReviewContext = {
    provider: config.reviewProvider,
    mode: config.reviewMode,
    model: config.reviewModel,
    endpoint: config.reviewEndpoint,
    commandId: config.reviewCommandId,
    commandArgsJson: config.reviewCommandArgsJson,
    promptFileName: config.reviewPromptFileName,
    workspaceRoot,
    sourcePath: path.join(outputDir, 'source.semantic.md'),
    semanticSource: currentMarkdown,
    artifactName: 'semantic-reconcile',
  };

  const mergePrompt = `TASK: Merge two versions of a Semantic Markdown document into ONE.

RULES:
- The INCOMING version is the source of truth for NEW information. Add every genuinely new section, component, table, endpoint, rule or detail it introduces.
- Do NOT lose curated detail: when the CURRENT version describes something richer than INCOMING (e.g. a component catalogue, table descriptions, business rules) and INCOMING is thinner or silent about it, KEEP the current detail.
- Where the two genuinely conflict on the same fact, prefer the INCOMING value.
- Preserve the Semantic Markdown structure (H1 title, H2 sections like intent/context/interfaces/processes/data_flows/database_schema/dependencies). Merge same-named sections; append new sections.
- Output ONLY the final merged markdown document. No code fences, no commentary, no conflict markers.

CURRENT source.semantic.md:
---
${currentMarkdown}
---

INCOMING (freshly generated) version:
---
${incomingMarkdown}
---`;

  progress('Merging semantic source with AI…');
  const raw = await runCloudRawPrompt(agContext, mergePrompt, makeStreamTracker(undefined, 'Merging semantic'));
  let merged = (raw ?? '').trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

  // If the agent returned nothing usable, fall back to the incoming version so the
  // proposal still reflects the latest content rather than silently doing nothing.
  if (merged.length < 20) {
    progress('Semantic merge: AI returned no usable output — falling back to the incoming version.');
    merged = incomingMarkdown.trim();
  }

  await fs.writeFile(proposedPath, merged + '\n', 'utf8');
  return { proposedPath, changed: merged.trim() !== currentMarkdown.trim() };
}

// Deterministically regenerate the semantic-derived canonical artifacts after a
// reconcile has been applied. The approved source.semantic.md is the single source
// of truth; one generate_canonical_graph call rebuilds the graph AND the database
// schema from it, so source.graph.json + source.database.json/.md stay consistent.
// No AI review here — the AI merge already happened at the semantic level.
export async function regenerateSemanticDerivedArtifacts(opts: {
  registry: McpRegistry;
  semanticContent: string;
  outputDir: string;
  progress?: (msg: string) => void;
}): Promise<void> {
  const { registry, semanticContent, outputDir } = opts;
  const progress = opts.progress ?? (() => { /* noop */ });

  const response = await registry.callTool('semanticCore', 'generate_canonical_graph', {
    content: normalizeSemanticSections(semanticContent),
    persist: false,
  });
  const payload = response.json as Record<string, unknown> | undefined;
  const graph = payload?.graph as Record<string, unknown> | undefined;
  if (!graph) {
    progress('Graph regeneration skipped — semantic-core returned no graph.');
    return;
  }

  await fs.writeFile(path.join(outputDir, 'source.graph.json'), JSON.stringify(graph, null, 2) + '\n', 'utf8');
  progress('Regenerated source.graph.json');

  const dbSchema = (graph.metadata as Record<string, unknown> | undefined)?.databaseSchema as DatabaseSchemaLike | undefined;
  if (dbSchema?.tables?.length) {
    await writeSchemaArtifacts(dbSchema, outputDir);
    progress(`Regenerated source.database.json/.md (${dbSchema.tables.length} table(s))`);
  } else {
    progress('Database schema: no tables inferred — leaving existing schema files unchanged.');
  }
}

interface DatabaseSchemaLike {
  title?: string;
  summary?: string;
  source?: string;
  confidence?: string;
  tables: Array<{
    name: string;
    description?: string;
    primaryKey?: string[];
    columns: Array<{ name: string; type?: string; detail?: string }>;
  }>;
  relationships?: Array<{
    fromTable: string; fromColumn: string;
    toTable: string; toColumn: string;
    cardinality: string; description?: string;
  }>;
}

function renderDatabaseSchemaMd(schema: DatabaseSchemaLike): string {
  const tablesMd = schema.tables.length
    ? schema.tables.map((t) => [
        `- ${t.name}${t.primaryKey?.length ? ` (pk: ${t.primaryKey.join(', ')})` : ''}`,
        ...(t.columns.length
          ? t.columns.map((c) => `  - ${c.name}${c.type ? `: ${c.type}` : ''}${c.detail ? ` — ${c.detail}` : ''}`)
          : ['  - no columns inferred']),
      ].join('\n')).join('\n')
    : '- none';

  const relsMd = (schema.relationships?.length ?? 0) > 0
    ? schema.relationships!.map((r) =>
        `- ${r.fromTable}.${r.fromColumn} -> ${r.toTable}.${r.toColumn} (${r.cardinality})${r.description ? ` — ${r.description}` : ''}`
      ).join('\n')
    : '- none';

  return `# ${schema.title ?? 'database schema'}\n\n` +
    `## summary\n${schema.summary ?? 'Database schema inferred from semantic source.'}\n\n` +
    `## source\n- ${schema.source ?? 'source.semantic.md'}\n- confidence: ${schema.confidence ?? 'medium'}\n\n` +
    `## tables\n${tablesMd}\n\n` +
    `## relationships\n${relsMd}\n`;
}

const KNOWN_SEMANTIC_SECTIONS_SET = new Set([
  'system', 'intent', 'context', 'interfaces', 'processes',
  'data_flows', 'data_models', 'database_schema', 'rules',
  'security', 'dependencies', 'examples', 'acceptance_criteria',
]);

function normalizeSemanticSections(content: string): string {
  const lines = content.split('\n');
  const usesH1 = lines.some((line) => {
    const m = /^#\s+(\w[\w _-]*)\s*$/.exec(line.trim());
    return !!m && KNOWN_SEMANTIC_SECTIONS_SET.has(m[1].toLowerCase().replace(/[\s-]+/g, '_'));
  });
  if (!usesH1) return content;
  return lines.map((line) => {
    const m = /^(#{1,5})\s+(.+)$/.exec(line);
    if (!m) return line;
    if (m[1].length === 1) {
      const name = m[2].trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (KNOWN_SEMANTIC_SECTIONS_SET.has(name) || name === 'data_models') {
        return `## ${name === 'data_models' ? 'database_schema' : m[2].trim()}`;
      }
      return line;
    }
    return `#${line}`;
  }).join('\n');
}
