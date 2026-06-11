import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { commandIds } from './constants.js';
import { getConfig } from './config.js';
import { McpRegistry } from './mcpRegistry.js';
import { WorkflowTreeDataProvider } from './views/workflowTree.js';
import { ArtifactTreeDataProvider } from './views/artifactTree.js';
import { TutorialTreeDataProvider } from './views/tutorialTree.js';
import { GenerateTreeDataProvider } from './views/generateTree.js';
import { McpTreeDataProvider } from './views/mcpTree.js';
import { ActionsWebviewProvider } from './webviews/actionsView.js';
import { ConfigurationPanel } from './webviews/configuration.js';
import { GraphPreviewPanel } from './webviews/graphPreview.js';
import { resolveArtifactRoot } from './workspaceArtifacts.js';
import { initializeMcpConfigStorage } from './mcpConfigStore.js';
import { importSourceProjectState } from '@ai-native/semantic-shared';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('AI Native Semantic Workflow');
  context.subscriptions.push(outputChannel);
  initializeMcpConfigStorage(context.globalStorageUri);
  const diagnostics = vscode.languages.createDiagnosticCollection('ai-native-semantic-workflow');
  context.subscriptions.push(diagnostics);

  const registry = new McpRegistry(outputChannel);
  context.subscriptions.push({
    dispose: () => {
      void registry.dispose();
    },
  });

  const workflowProvider = new WorkflowTreeDataProvider();
  const modelProvider = new TutorialTreeDataProvider();
  const generateProvider = new GenerateTreeDataProvider();
  const reviewProvider = new ArtifactTreeDataProvider();
  const mcpProvider = new McpTreeDataProvider(registry);
  const actionsProvider = new ActionsWebviewProvider(context);

  const workflowView = vscode.window.createTreeView('aiNativeInputs', { treeDataProvider: workflowProvider });
  const modelView = vscode.window.createTreeView('aiNativeModel', { treeDataProvider: modelProvider });
  const generateView = vscode.window.createTreeView('aiNativeGenerate', { treeDataProvider: generateProvider });
  const reviewView = vscode.window.createTreeView('aiNativeReview', { treeDataProvider: reviewProvider });
  const mcpView = vscode.window.createTreeView('aiNativeMcpHub', { treeDataProvider: mcpProvider });
  const actionsView = vscode.window.registerWebviewViewProvider('aiNativeActions', actionsProvider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  context.subscriptions.push(workflowView, modelView, generateView, reviewView, mcpView, actionsView);

  const refreshViews = async (): Promise<void> => {
    workflowProvider.refresh();
    modelProvider.refresh();
    generateProvider.refresh();
    reviewProvider.refresh();
    mcpProvider.refresh();
    await registry.pingAll();
  };

  const openDashboard = async (): Promise<void> => {
    try {
      await vscode.commands.executeCommand('workbench.view.extension.aiNativeSemantic');
    } catch {
      // ignore: focus command is best-effort
    }
    await refreshViews();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(commandIds.openDashboard, openDashboard),
    vscode.commands.registerCommand(commandIds.openConfiguration, async () => {
      ConfigurationPanel.show(context, registry, refreshViews);
    }),
    vscode.commands.registerCommand(commandIds.createSemanticSourceTemplate, async () => {
      await createSemanticSourceTemplate();
    }),
    vscode.commands.registerCommand(commandIds.importSourceProject, async () => {
      await importSourceProject(context, outputChannel, refreshViews);
    }),
    vscode.commands.registerCommand(commandIds.openTutorial, async () => {
      await openExampleSlice();
    }),
    vscode.commands.registerCommand(commandIds.refreshAll, refreshViews),
    vscode.commands.registerCommand(commandIds.showMcpStatus, async () => {
      const status = await registry.pingAll();
      outputChannel.show(true);
      outputChannel.appendLine(JSON.stringify(status, null, 2));
      await refreshViews();
    }),
    vscode.commands.registerCommand(commandIds.openArtifactsFolder, async () => {
      const root = await resolveArtifactRoot();
      if (!root) {
        vscode.window.showWarningMessage('Open a workspace first to inspect local artifacts.');
        return;
      }
      const document = await ensureDirectoryDocument(root);
      await vscode.window.showTextDocument(document, { preview: false });
    }),
    vscode.commands.registerCommand(commandIds.validateActiveSemanticMarkdown, async () => {
      await runValidation(context, diagnostics, registry, outputChannel);
    }),
    vscode.commands.registerCommand(commandIds.generateCanonicalGraph, async () => {
      await runGraphGeneration(context, registry, outputChannel);
    }),
    vscode.commands.registerCommand(commandIds.openGraphPreview, async () => {
      await openGraphPreview(context, registry, outputChannel);
    }),
    vscode.commands.registerCommand(commandIds.generateSpringBootSkeleton, async () => {
      await runSpringGeneration(context, registry, outputChannel);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (!getConfig().autoValidateOnSave) {
        return;
      }
      if (!isSemanticMarkdown(document)) {
        return;
      }
      await runValidation(context, diagnostics, registry, outputChannel, document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnostics.delete(document.uri);
    }),
  );

  await refreshViews();
}

export function deactivate(): void {}

async function runValidation(
  context: vscode.ExtensionContext,
  diagnostics: vscode.DiagnosticCollection,
  registry: McpRegistry,
  outputChannel: vscode.OutputChannel,
  document?: vscode.TextDocument,
): Promise<void> {
  const source = await resolveSemanticSourceDocument(document);
  if (!source) {
    vscode.window.showWarningMessage('Open a Semantic Markdown file first.');
    return;
  }

  const response = await registry.callTool('validator', 'validate_semantic_markdown', {
    content: source.getText(),
    persist: false,
  });

  const payload = asValidationPayload(response.json);
  const logLines = publishValidationDiagnostics(diagnostics, source, payload);
  outputChannel.show(true);
  outputChannel.appendLine(`[validation] ${path.basename(source.fileName)}`);
  outputChannel.appendLine(
    `  summary: gaps=${payload.summary.gaps}, conflicts=${payload.summary.conflicts}, warnings=${payload.summary.warnings}, violations=${payload.summary.violations}`,
  );
  for (const line of logLines) {
    outputChannel.appendLine(line);
  }
  await vscode.window.showTextDocument(source, { preview: false });
  await vscode.window.showInformationMessage(
    `Validation completed: ${payload.summary.gaps} gaps, ${payload.summary.conflicts} conflicts, ${payload.summary.warnings} warnings, ${payload.summary.violations} violations.`,
  );
}

async function runGraphGeneration(
  context: vscode.ExtensionContext,
  registry: McpRegistry,
  outputChannel: vscode.OutputChannel,
  document?: vscode.TextDocument,
): Promise<void> {
  const source = await resolveSemanticSourceDocument(document);
  if (!source) {
    vscode.window.showWarningMessage('Open a Semantic Markdown file first.');
    return;
  }

  const response = await registry.callTool('semanticCore', 'generate_canonical_graph', {
    content: source.getText(),
    persist: true,
  });

  const payload = asObject(response.json);
  const graph = asGraphObject(payload?.graph);
  const artifactRoot = await resolveArtifactRoot();
  if (artifactRoot) {
    const graphFolder = vscode.Uri.joinPath(artifactRoot, 'graph');
    await vscode.workspace.fs.createDirectory(graphFolder);
    const outputPath = vscode.Uri.joinPath(graphFolder, `${slug(source.fileName)}.graph.json`);
    await vscode.workspace.fs.writeFile(outputPath, Buffer.from(response.text, 'utf8'));
  }

  outputChannel.appendLine(JSON.stringify({ tool: 'generate_canonical_graph', payload }, null, 2));
  if (graph) {
    GraphPreviewPanel.show(context, graph, path.basename(source.fileName));
  }
  await vscode.window.showInformationMessage('Graph generation completed.');
}

async function runSpringGeneration(
  context: vscode.ExtensionContext,
  registry: McpRegistry,
  outputChannel: vscode.OutputChannel,
  document?: vscode.TextDocument,
): Promise<void> {
  const source = await resolveSemanticSourceDocument(document);
  if (!source) {
    vscode.window.showWarningMessage('Open a Semantic Markdown file first.');
    return;
  }

  const config = getConfig();
  const artifactRoot = await resolveArtifactRoot();
  const outputDir = artifactRoot ? vscode.Uri.joinPath(artifactRoot, 'generated').fsPath : undefined;
  if (artifactRoot) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(artifactRoot, 'generated'));
  }

  const response = await registry.callTool('compiler', 'generate_spring_boot_skeleton', {
    content: source.getText(),
    outputDir,
    basePackage: config.javaBasePackage,
    artifactName: slug(source.fileName).replace(/\.semantic$/, ''),
    persist: true,
  });

  const payload = asObject(response.json);
  outputChannel.appendLine(JSON.stringify({ tool: 'generate_spring_boot_skeleton', payload }, null, 2));
  await vscode.commands.executeCommand(commandIds.openDashboard);
  await vscode.window.showInformationMessage('Spring Boot skeleton generation completed.');
}

async function openGraphPreview(
  context: vscode.ExtensionContext,
  registry: McpRegistry,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  const source = await resolveSemanticSourceDocument();
  if (source) {
    const response = await registry.callTool('semanticCore', 'generate_canonical_graph', {
      content: source.getText(),
      persist: false,
    });
    const payload = asObject(response.json);
    const graph = asGraphObject(payload?.graph);
    if (graph) {
      GraphPreviewPanel.show(context, graph, path.basename(source.fileName));
      outputChannel.show(true);
      outputChannel.appendLine(`[graph-preview] current source: ${source.fileName}`);
      return;
    }
  }

  const artifactRoot = await resolveArtifactRoot();
  const candidates: vscode.Uri[] = [];

  if (artifactRoot) {
    const graphFolder = vscode.Uri.joinPath(artifactRoot, 'graph');
    let items: Array<[string, vscode.FileType]> = [];
    try {
      items = await vscode.workspace.fs.readDirectory(graphFolder);
    } catch {
      items = [];
    }
    candidates.push(
      ...items
        .filter(([, type]) => type === vscode.FileType.File)
        .map(([name]) => vscode.Uri.joinPath(graphFolder, name))
        .filter((uri) => uri.fsPath.endsWith('.graph.json')),
    );
  }

  for (const candidate of candidates) {
    if (!(await pathExists(candidate))) {
      continue;
    }

    const document = await vscode.workspace.openTextDocument(candidate);
    const graph = parseGraphFromText(document.getText());
    if (graph) {
      GraphPreviewPanel.show(context, graph, path.basename(candidate.fsPath));
      outputChannel.show(true);
      outputChannel.appendLine(`[graph-preview] ${candidate.fsPath}`);
      return;
    }
  }

  vscode.window.showWarningMessage('No generated graph artifact was found yet.');
}

async function importSourceProject(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  refreshViews: () => Promise<void>,
): Promise<void> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select source project folder',
  });

  if (!selected?.[0]) {
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Open the AI Native Language repository first, then import a source project.');
    return;
  }

  const sourceRoot = selected[0].fsPath;
  const projectName = slug(path.basename(sourceRoot));
  const outputDir = path.join(workspaceFolder.uri.fsPath, 'learning-projects', projectName);

  await fs.mkdir(outputDir, { recursive: true });
  outputChannel.show(true);
  outputChannel.appendLine(`[source-to-semantic] ${sourceRoot} -> ${outputDir}`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Importing ${projectName} into source-to-semantic state`,
      cancellable: false,
    },
    async () => {
      const result = await importSourceProjectState({
        projectRoot: sourceRoot,
        projectName,
        outputDir,
      });
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.semanticPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.graphPath}`);
    },
  );

  const semanticPath = vscode.Uri.file(path.join(outputDir, 'source.semantic.md'));
  const semanticDocument = await vscode.workspace.openTextDocument(semanticPath);
  await vscode.window.showTextDocument(semanticDocument, { preview: false });

  try {
    const graphPath = path.join(outputDir, 'source.graph.json');
    const rawGraph = await fs.readFile(graphPath, 'utf8');
    const graph = JSON.parse(rawGraph) as {
      schemaVersion?: string;
      nodes: Array<{ id: string; type: string; name: string; description?: string; sourceRef?: string }>;
      edges: Array<{ from: string; to: string; type: string }>;
      metadata?: { title?: string; sourcePath?: string; createdAt?: string };
    };
    GraphPreviewPanel.show(context, graph, projectName);
  } catch {
    // best effort preview only
  }

  await refreshViews();
  await vscode.window.showInformationMessage(`Imported source project into learning-projects/${projectName}`);
}

async function ensureDirectoryDocument(folder: vscode.Uri): Promise<vscode.TextDocument> {
  const items = await vscode.workspace.fs.readDirectory(folder);
  const lines = [
    `# ${path.basename(folder.fsPath)}`,
    '',
    'Local artifact root:',
    folder.fsPath,
    '',
    'Contents:',
    ...items.map(([name, type]) => `- ${name} (${type === vscode.FileType.Directory ? 'directory' : 'file'})`),
  ];
  const scratch = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: lines.join('\n'),
  });
  return scratch;
}

async function createSemanticSourceTemplate(): Promise<void> {
  const template = `# system

Simple notes service with one web UI and one API.

## intent
Create, edit, list, and search notes.

## context
- inbound: browser UI
- outbound: persistence layer
- external systems: none for v0

## interfaces
- ui: note editor, note list, search field
- api: create note, update note, delete note, list notes

## data_flows
User edits a note in the UI. The service stores it and returns the updated list.

## processes
- create note
- update note
- delete note
- search notes

## rules
- note title is required
- note content may be empty
- note ids must be stable

## security
- local authentication only for v0
- no external SSO integration yet
- protect note data by default

## dependencies
- Spring Boot backend
- local file or database persistence

## examples
- user creates a note called "Shopping"
- user searches for notes containing "project"

## acceptance_criteria
- notes can be created, updated, deleted, and searched
- graph validation passes
- Spring Boot skeleton is generated
`;

  const folder = vscode.workspace.workspaceFolders?.[0];
  const defaultUri = folder
    ? vscode.Uri.joinPath(folder.uri, 'semantic', 'simple_notes_service.semantic.md')
    : vscode.Uri.file('simple_notes_service.semantic.md');
  const targetUri = await vscode.window.showSaveDialog({
    defaultUri,
    saveLabel: 'Create Semantic Source',
    filters: {
      Markdown: ['md', 'semantic.md'],
    },
  });
  if (!targetUri) {
    return;
  }

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetUri.fsPath)));
  await vscode.workspace.fs.writeFile(targetUri, Buffer.from(template, 'utf8'));
  const document = await vscode.workspace.openTextDocument(targetUri);
  await vscode.window.showTextDocument(document, { preview: false });
}

async function openExampleSlice(): Promise<void> {
  const matches = await vscode.workspace.findFiles('**/examples/simple_notes_service.semantic.md', '**/node_modules/**', 1);
  if (matches.length > 0) {
    const document = await vscode.workspace.openTextDocument(matches[0]);
    await vscode.window.showTextDocument(document, { preview: false });
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    const fallbackUri = vscode.Uri.joinPath(folder.uri, 'examples', 'simple_notes_service.semantic.md');
    try {
      const document = await vscode.workspace.openTextDocument(fallbackUri);
      await vscode.window.showTextDocument(document, { preview: false });
      return;
    } catch {
      // fall through to info document
    }
  }

  const fallback = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: `# Example slice not found\n\nOpen \`examples/simple_notes_service.semantic.md\` from this repository.`,
  });
  await vscode.window.showTextDocument(fallback, { preview: false });
}

function publishValidationDiagnostics(
  diagnostics: vscode.DiagnosticCollection,
  document: vscode.TextDocument,
  payload: {
    issues: Array<{ severity?: string; code?: string; message?: string; sourceRef?: string; nodeId?: string }>;
    summary: { gaps: number; conflicts: number; warnings: number; violations: number };
  },
): string[] {
  const diagnosticsList: vscode.Diagnostic[] = [];
  const logLines: string[] = [];

  for (const issue of payload.issues) {
    const resolved = issueToDiagnostic(document, issue);
    if (!resolved) {
      continue;
    }
    diagnosticsList.push(resolved.diagnostic);
    const location = `${document.fileName}:${resolved.diagnostic.range.start.line + 1}:${resolved.diagnostic.range.start.character + 1}`;
    logLines.push(`  ${issue.severity?.toUpperCase() ?? 'INFO'} ${issue.code ?? 'issue'} (${location}): ${issue.message ?? ''}`);
  }

  diagnostics.set(document.uri, diagnosticsList);
  return logLines;
}

function issueToDiagnostic(
  document: vscode.TextDocument,
  issue: { severity?: string; code?: string; message?: string; sourceRef?: string; sourceLine?: number; sourceColumn?: number; nodeId?: string },
): { diagnostic: vscode.Diagnostic; range: vscode.Range } | undefined {
  const severity = issue.severity === 'violation' || issue.severity === 'conflict'
    ? vscode.DiagnosticSeverity.Error
    : issue.severity === 'gap' || issue.severity === 'warning'
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Information;

  const range = resolveIssueRange(document, issue.sourceRef, issue.sourceLine, issue.sourceColumn, issue.code);
  const diagnostic = new vscode.Diagnostic(
    range,
    [issue.code, issue.message].filter(Boolean).join(': '),
    severity,
  );
  diagnostic.source = 'AI Native Semantic Workflow';
  return { diagnostic, range };
}

function resolveIssueRange(
  document: vscode.TextDocument,
  sourceRef: string | undefined,
  sourceLine: number | undefined,
  sourceColumn: number | undefined,
  code: string | undefined,
): vscode.Range {
  if (sourceLine !== undefined && Number.isInteger(sourceLine) && sourceLine >= 0 && sourceLine < document.lineCount) {
    const line = document.lineAt(sourceLine);
    const startCharacter = sourceColumn !== undefined && Number.isInteger(sourceColumn) && sourceColumn >= 0 ? sourceColumn : 0;
    return new vscode.Range(sourceLine, startCharacter, sourceLine, line.text.length);
  }

  const reference = sourceRef?.replace(/^#/, '').trim();
  if (reference) {
    const [sectionName, itemIndexText] = reference.split(':', 2);
    const itemIndex = itemIndexText ? Number.parseInt(itemIndexText, 10) : undefined;
    if (sectionName) {
      if (itemIndex !== undefined && Number.isInteger(itemIndex)) {
        const listItemRange = findListItemRange(document, sectionName, itemIndex);
        if (listItemRange) {
          return listItemRange;
        }
      }

      const sectionRange = findSectionHeadingRange(document, sectionName);
      if (sectionRange) {
        return sectionRange;
      }
    }
  }

  if (code === 'missing_section') {
    return new vscode.Range(0, 0, 0, 0);
  }

  return new vscode.Range(0, 0, 0, 1);
}

function findSectionHeadingRange(document: vscode.TextDocument, sectionName: string): vscode.Range | undefined {
  const target = normalizeHeading(sectionName);
  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const line = document.lineAt(lineNumber);
    const heading = /^#{1,6}\s+(.+)$/.exec(line.text.trim());
    if (!heading) continue;
    if (normalizeHeading(heading[1]) === target) {
      return new vscode.Range(lineNumber, 0, lineNumber, line.text.length);
    }
  }
  return undefined;
}

function findListItemRange(document: vscode.TextDocument, sectionName: string, itemIndex: number): vscode.Range | undefined {
  const target = normalizeHeading(sectionName);
  let inSection = false;
  let seenItems = 0;

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const line = document.lineAt(lineNumber);
    const heading = /^#{1,6}\s+(.+)$/.exec(line.text.trim());
    if (heading) {
      if (inSection) {
        break;
      }
      inSection = normalizeHeading(heading[1]) === target;
      continue;
    }

    if (!inSection) {
      continue;
    }

    if (!/^[-*]\s+/.test(line.text.trim())) {
      continue;
    }

    if (seenItems === itemIndex) {
      return new vscode.Range(lineNumber, 0, lineNumber, line.text.length);
    }
    seenItems += 1;
  }

  return undefined;
}

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function isSemanticMarkdown(document: vscode.TextDocument): boolean {
  return document.fileName.endsWith('.semantic.md') || document.fileName.endsWith('.md');
}

async function resolveSemanticSourceDocument(document?: vscode.TextDocument): Promise<vscode.TextDocument | undefined> {
  if (document && isSemanticMarkdown(document)) {
    return document;
  }

  const activeEditorDocument = vscode.window.activeTextEditor?.document;
  if (activeEditorDocument && isSemanticMarkdown(activeEditorDocument)) {
    return activeEditorDocument;
  }

  const visibleSemanticDocument = vscode.window.visibleTextEditors
    .map((editor) => editor.document)
    .find((editorDocument) => isSemanticMarkdown(editorDocument));
  if (visibleSemanticDocument) {
    return visibleSemanticDocument;
  }

  const openSemanticDocuments = vscode.workspace.textDocuments.filter((editorDocument) => isSemanticMarkdown(editorDocument));
  if (openSemanticDocuments.length === 1) {
    return openSemanticDocuments[0];
  }

  if (openSemanticDocuments.length > 1) {
    const picked = await vscode.window.showQuickPick(
      openSemanticDocuments.map((editorDocument) => ({
        label: path.basename(editorDocument.fileName),
        description: editorDocument.fileName,
        document: editorDocument,
      })),
      {
        placeHolder: 'Pick a Semantic Markdown file to use',
      },
    );
    return picked?.document;
  }

  return undefined;
}

function slug(fileName: string): string {
  const baseName = path.basename(fileName, path.extname(fileName));
  return baseName.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asGraphObject(value: unknown): {
  schemaVersion?: string;
  nodes: Array<{ id: string; type: string; name: string; description?: string; sourceRef?: string }>;
  edges: Array<{ from: string; to: string; type: string }>;
  metadata?: { title?: string; sourcePath?: string; createdAt?: string };
} | undefined {
  const object = asObject(value);
  if (!object) {
    return undefined;
  }

  const nodes = Array.isArray(object.nodes) ? object.nodes : [];
  const edges = Array.isArray(object.edges) ? object.edges : [];
  if (nodes.length === 0 && edges.length === 0) {
    return undefined;
  }

  return {
    schemaVersion: typeof object.schemaVersion === 'string' ? object.schemaVersion : undefined,
    nodes: nodes
      .map((node) => asObject(node))
      .filter((node): node is Record<string, unknown> => Boolean(node))
      .map((node) => ({
        id: typeof node.id === 'string' ? node.id : '',
        type: typeof node.type === 'string' ? node.type : 'Node',
        name: typeof node.name === 'string' ? node.name : 'Node',
        description: typeof node.description === 'string' ? node.description : undefined,
        sourceRef: typeof node.sourceRef === 'string' ? node.sourceRef : undefined,
      }))
      .filter((node) => Boolean(node.id)),
    edges: edges
      .map((edge) => asObject(edge))
      .filter((edge): edge is Record<string, unknown> => Boolean(edge))
      .map((edge) => ({
        from: typeof edge.from === 'string' ? edge.from : '',
        to: typeof edge.to === 'string' ? edge.to : '',
        type: typeof edge.type === 'string' ? edge.type : 'relatedTo',
      }))
      .filter((edge) => Boolean(edge.from) && Boolean(edge.to)),
    metadata: asObject(object.metadata)
      ? {
          title: typeof asObject(object.metadata)?.title === 'string' ? (asObject(object.metadata)?.title as string) : undefined,
          sourcePath: typeof asObject(object.metadata)?.sourcePath === 'string' ? (asObject(object.metadata)?.sourcePath as string) : undefined,
          createdAt: typeof asObject(object.metadata)?.createdAt === 'string' ? (asObject(object.metadata)?.createdAt as string) : undefined,
        }
      : undefined,
  };
}

async function pathExists(target: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function parseGraphFromText(text: string): ReturnType<typeof asGraphObject> {
  try {
    return asGraphObject(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function asValidationPayload(
  value: unknown,
): {
  issues: Array<{ severity?: string; code?: string; message?: string; sourceRef?: string; nodeId?: string }>;
  summary: { gaps: number; conflicts: number; warnings: number; violations: number };
} {
  const object = asObject(value) ?? {};
  const summaryObject = asObject(object.summary) ?? {};
  return {
    issues: Array.isArray(object.issues) ? (object.issues as Array<{ severity?: string; code?: string; message?: string; sourceRef?: string; nodeId?: string }>) : [],
    summary: {
      gaps: typeof summaryObject.gaps === 'number' ? summaryObject.gaps : 0,
      conflicts: typeof summaryObject.conflicts === 'number' ? summaryObject.conflicts : 0,
      warnings: typeof summaryObject.warnings === 'number' ? summaryObject.warnings : 0,
      violations: typeof summaryObject.violations === 'number' ? summaryObject.violations : 0,
    },
  };
}
