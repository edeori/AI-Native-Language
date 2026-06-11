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
import { runAgenticReview } from './agenticReview.js';

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
      await importSourceProject(context, diagnostics, registry, outputChannel, refreshViews);
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
      await runGraphGeneration(context, diagnostics, registry, outputChannel);
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
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Validating semantic source',
      cancellable: false,
    },
    async (progress) => {
      const report = (message: string, increment = 0): void => {
        progress.report({ message, increment });
        outputChannel.appendLine(`[validation] ${message}`);
      };

      const source = await resolveSemanticSourceDocument(document);
      if (!source) {
        vscode.window.showWarningMessage('Open a Semantic Markdown file first.');
        return;
      }

      report('Loading validation policy from MCP...');
      const validationPolicy = await resolveValidationPolicyText(registry);

      report('Running MCP validation...');
      const response = await registry.callTool('validator', 'validate_semantic_markdown', {
        content: source.getText(),
        policyText: validationPolicy,
        persist: false,
      });

      const payload = asValidationPayload(response.json);
      const validationStatus = deriveValidationStatus(payload.summary);
      const logLines = publishValidationDiagnostics(diagnostics, source, payload, 'AI Native Validation');
      outputChannel.show(true);
      outputChannel.appendLine(`[validation] ${path.basename(source.fileName)}`);
      outputChannel.appendLine(
        `  summary: gaps=${payload.summary.gaps}, conflicts=${payload.summary.conflicts}, warnings=${payload.summary.warnings}, violations=${payload.summary.violations}`,
      );
      for (const line of logLines) {
        outputChannel.appendLine(line);
      }

      const config = getConfig();
      report(`Running AI review with ${config.reviewProvider}...`);
      const agenticReview = await runAgenticReview({
        provider: config.reviewProvider,
        mode: config.reviewMode,
        model: config.reviewModel,
        endpoint: config.reviewEndpoint,
        commandId: config.reviewCommandId,
        commandArgsJson: config.reviewCommandArgsJson,
        promptFileName: config.reviewPromptFileName,
        workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        sourcePath: source.fileName,
        semanticSource: source.getText(),
        expectationDocuments: [{ path: 'mcp-validation-policy.md', content: validationPolicy }],
        graph: payload.graph,
        validation: {
          status: validationStatus,
          summary: payload.summary,
          issues: payload.issues,
        },
      });

      const combinedIssues = [
        ...payload.issues.map((issue) => ({
          severity: issue.severity,
          code: issue.code,
          message: issue.message,
          sourceRef: issue.sourceRef,
          sourceLine: issue.sourceLine,
          sourceLabel: 'AI Native Validation',
        })),
        ...agenticReview.issues.map((issue) => ({
          severity: issue.severity,
          code: issue.code,
          message: issue.message,
          sourceRef: issue.sourceRef,
          sourceLine: issue.sourceLine,
          sourceLabel: 'AI Native Review',
        })),
      ];
      publishValidationDiagnostics(
        diagnostics,
        source,
        {
          issues: combinedIssues,
          summary: payload.summary,
        },
        'AI Native Review',
      );

      outputChannel.appendLine(`  expectations: mcp-validation-policy.md`);
      outputChannel.appendLine(
        `[agentic-validation] provider=${agenticReview.provider} mode=${agenticReview.mode} model=${agenticReview.model}${agenticReview.usedEndpoint ? ` endpoint=${agenticReview.usedEndpoint}` : ''}`,
      );
      outputChannel.appendLine(`  bridge: ${agenticReview.bridgeAction}`);
      outputChannel.appendLine(`  summary: ${agenticReview.summary}`);
      for (const note of agenticReview.notes) {
        outputChannel.appendLine(`  note: ${note}`);
      }
      if (agenticReview.issues.length > 0) {
        outputChannel.appendLine(`  issues: ${agenticReview.issues.length}`);
      }

      report('Validation finished.');
      await vscode.window.showTextDocument(source, { preview: false });
      await vscode.window.showInformationMessage(
        `Validation completed: ${payload.summary.gaps} gaps, ${payload.summary.conflicts} conflicts, ${payload.summary.warnings} warnings, ${payload.summary.violations} violations.`,
      );
    },
  );
}

async function runGraphGeneration(
  context: vscode.ExtensionContext,
  diagnostics: vscode.DiagnosticCollection,
  registry: McpRegistry,
  outputChannel: vscode.OutputChannel,
  document?: vscode.TextDocument,
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Generating reviewed graph',
      cancellable: false,
    },
    async (progress) => {
      const report = (message: string, increment = 0): void => {
        progress.report({ message, increment });
        outputChannel.appendLine(`[graph-generation] ${message}`);
      };

      report('Resolving semantic source...');
      const source = await resolveSemanticSourceDocument(document);
      if (!source) {
        vscode.window.showWarningMessage('Open a Semantic Markdown file first.');
        return;
      }

      report('Generating canonical graph...');
      const validationPolicy = await resolveValidationPolicyText(registry);
      const response = await registry.callTool('semanticCore', 'generate_canonical_graph', {
        content: source.getText(),
        policyText: validationPolicy,
        persist: true,
      });

      const payload = asObject(response.json);
      const graph = asGraphObject(payload?.graph);
      const graphValidation = asValidationPayload(payload?.validation);
      const artifactRoot = await resolveArtifactRoot();

      outputChannel.appendLine(JSON.stringify({ tool: 'generate_canonical_graph', payload }, null, 2));
      report('Running validation...');
      const logLines = publishValidationDiagnostics(diagnostics, source, graphValidation, 'AI Native Validation');
      outputChannel.appendLine(
        `[graph-review] ${path.basename(source.fileName)}: gaps=${graphValidation.summary.gaps}, conflicts=${graphValidation.summary.conflicts}, warnings=${graphValidation.summary.warnings}, violations=${graphValidation.summary.violations}`,
      );
      for (const line of logLines) {
        outputChannel.appendLine(line);
      }
      if (graph) {
        const config = getConfig();
        report(`Running AI review with ${config.reviewProvider}...`);
        const agenticReview = await runAgenticReview({
          provider: config.reviewProvider,
          mode: config.reviewMode,
          model: config.reviewModel,
          endpoint: config.reviewEndpoint,
          commandId: config.reviewCommandId,
          commandArgsJson: config.reviewCommandArgsJson,
          promptFileName: config.reviewPromptFileName,
          workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          sourcePath: source.fileName,
          semanticSource: source.getText(),
          expectationDocuments: [{ path: 'mcp-validation-policy.md', content: validationPolicy }],
          graph,
          validation: {
            status: deriveValidationStatus(graphValidation.summary),
            summary: graphValidation.summary,
            issues: graphValidation.issues,
          },
        });
        const reviewedIssues = [
          ...graphValidation.issues.map((issue) => ({
            severity: issue.severity,
            code: issue.code,
            message: issue.message,
            sourceRef: issue.sourceRef,
            sourceLine: issue.sourceLine,
            sourceLabel: 'AI Native Validation',
          })),
          ...agenticReview.issues.map((issue) => ({
            severity: issue.severity,
            code: issue.code,
            message: issue.message,
            sourceRef: issue.sourceRef,
            sourceLine: issue.sourceLine,
            sourceLabel: 'AI Native Review',
          })),
        ];
        publishValidationDiagnostics(
          diagnostics,
          source,
          {
            issues: reviewedIssues,
            summary: graphValidation.summary,
          },
          'AI Native Review',
        );
        const reviewedGraph = applyReviewToGraph(graph, agenticReview);
        if (artifactRoot) {
          report('Writing reviewed graph artifact...');
          const graphFolder = vscode.Uri.joinPath(artifactRoot, 'graph');
          await vscode.workspace.fs.createDirectory(graphFolder);
          const reviewedPath = vscode.Uri.joinPath(graphFolder, `${slug(source.fileName)}.graph.json`);
          await vscode.workspace.fs.writeFile(reviewedPath, Buffer.from(JSON.stringify(reviewedGraph, null, 2), 'utf8'));
          outputChannel.appendLine(`  reviewed graph: ${reviewedPath.fsPath}`);
        }
        report('Opening reviewed graph...');
        GraphPreviewPanel.show(context, reviewedGraph, `${path.basename(source.fileName)} · reviewed`);
        outputChannel.appendLine(
          `[agentic-review] provider=${agenticReview.provider} mode=${agenticReview.mode} model=${agenticReview.model}${agenticReview.usedEndpoint ? ` endpoint=${agenticReview.usedEndpoint}` : ''}${agenticReview.promptPath ? ` prompt=${agenticReview.promptPath}` : ''}`,
        );
        outputChannel.appendLine(`  bridge: ${agenticReview.bridgeAction}`);
        outputChannel.appendLine(`  summary: ${agenticReview.summary}`);
        if (agenticReview.reviewArtifactPath) {
          outputChannel.appendLine(`  review artifact: ${agenticReview.reviewArtifactPath}`);
        }
        if (agenticReview.promptArtifactPath) {
          outputChannel.appendLine(`  prompt artifact: ${agenticReview.promptArtifactPath}`);
        }
        for (const note of agenticReview.notes) {
          outputChannel.appendLine(`  note: ${note}`);
        }
        if (agenticReview.issues.length > 0) {
          outputChannel.appendLine(`  issues: ${agenticReview.issues.length}`);
        }
      }
      await vscode.window.showInformationMessage('Graph generation completed.');
    },
  );
}

function applyReviewToGraph(
  graph: {
    schemaVersion?: string;
    nodes: Array<{ id: string; type: string; name: string; description?: string; sourceRef?: string }>;
    edges: Array<{ from: string; to: string; type: string }>;
    metadata?: { title?: string; sourcePath?: string; createdAt?: string };
  },
  review: {
    provider: string;
    mode: string;
    model: string;
    bridgeAction: string;
    usedEndpoint?: string;
    promptPath?: string;
    reviewArtifactPath?: string;
    promptArtifactPath?: string;
    summary: string;
    notes: string[];
    issues: Array<{ severity: string; code: string; message: string; sourceRef?: string; sourceLine?: number }>;
  },
): typeof graph {
  return {
    ...graph,
    metadata: {
      ...(graph.metadata ?? {}),
      reviewedAt: new Date().toISOString(),
      review: {
        provider: review.provider,
        mode: review.mode,
        model: review.model,
        bridgeAction: review.bridgeAction,
        usedEndpoint: review.usedEndpoint,
        promptPath: review.promptPath,
        reviewArtifactPath: review.reviewArtifactPath,
        promptArtifactPath: review.promptArtifactPath,
        summary: review.summary,
        notes: review.notes,
        issues: review.issues,
      },
    } as typeof graph.metadata & { reviewedAt: string; review: unknown },
  } as typeof graph;
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
  const artifactRoot = await resolveArtifactRoot();
  const source = await resolveSemanticSourceDocument();
  if (source) {
    const reviewedArtifact = artifactRoot
      ? vscode.Uri.joinPath(artifactRoot, 'graph', `${slug(source.fileName)}.graph.json`)
      : undefined;
    if (reviewedArtifact && (await pathExists(reviewedArtifact))) {
      const document = await vscode.workspace.openTextDocument(reviewedArtifact);
      const reviewedGraph = parseGraphFromText(document.getText());
      if (reviewedGraph) {
        GraphPreviewPanel.show(context, reviewedGraph, `${path.basename(source.fileName)} · reviewed`);
        outputChannel.show(true);
        outputChannel.appendLine(`[graph-preview] reviewed artifact: ${reviewedArtifact.fsPath}`);
        return;
      }
    }

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

function deriveValidationStatus(summary: { gaps: number; conflicts: number; warnings: number; violations: number }): string {
  return summary.violations > 0 || summary.conflicts > 0 || summary.gaps > 0
    ? 'draft'
    : summary.warnings > 0
      ? 'ready'
      : 'validated';
}

async function importSourceProject(
  context: vscode.ExtensionContext,
  diagnostics: vscode.DiagnosticCollection,
  registry: McpRegistry,
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
    async (progress) => {
      const report = (message: string, increment = 0): void => {
        progress.report({ message, increment });
        outputChannel.appendLine(`[source-to-semantic] ${message}`);
      };

      const result = await importSourceProjectState({
        projectRoot: sourceRoot,
        projectName,
        outputDir,
      });
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.semanticPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.graphPath}`);
      const semanticDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(result.semanticPath));

      const validationPolicy = await resolveValidationPolicyText(registry);
      const semanticText = await fs.readFile(result.semanticPath, 'utf8');
      report('Running MCP validation on imported semantic...');
      const validationResponse = await registry.callTool('validator', 'validate_semantic_markdown', {
        content: semanticText,
        policyText: validationPolicy,
        persist: false,
      });
      const validationPayload = asValidationPayload(validationResponse.json);
      const validationLines = publishValidationDiagnostics(
        diagnostics,
        semanticDocument,
        validationPayload,
        'AI Native Validation',
      );
      for (const line of validationLines) {
        outputChannel.appendLine(line);
      }

      report(`Running AI review with ${getConfig().reviewProvider}...`);
      const config = getConfig();
      const agenticReview = await runAgenticReview({
        provider: config.reviewProvider,
        mode: config.reviewMode,
        model: config.reviewModel,
        endpoint: config.reviewEndpoint,
        commandId: config.reviewCommandId,
        commandArgsJson: config.reviewCommandArgsJson,
        promptFileName: config.reviewPromptFileName,
        workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        sourcePath: result.semanticPath,
        semanticSource: semanticText,
        expectationDocuments: [{ path: 'mcp-validation-policy.md', content: validationPolicy }],
        graph: result.graph,
        validation: {
          status: deriveValidationStatus(validationPayload.summary),
          summary: validationPayload.summary,
          issues: validationPayload.issues,
        },
      });

      const reviewArtifactPath = path.join(outputDir, 'source.review.json');
      const reviewMarkdownPath = path.join(outputDir, 'source.review.md');
      await fs.writeFile(
        reviewArtifactPath,
        JSON.stringify(
          {
            sourcePath: result.semanticPath,
            provider: agenticReview.provider,
            mode: agenticReview.mode,
            model: agenticReview.model,
            bridgeAction: agenticReview.bridgeAction,
            summary: agenticReview.summary,
            notes: agenticReview.notes,
            issues: agenticReview.issues,
            refinedSemanticMarkdown: agenticReview.refinedSemanticMarkdown,
            validation: validationPayload,
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );
      await fs.writeFile(
        reviewMarkdownPath,
        [
          '# AI Review',
          '',
          `- provider: ${agenticReview.provider}`,
          `- mode: ${agenticReview.mode}`,
          `- model: ${agenticReview.model}`,
          `- bridge: ${agenticReview.bridgeAction}`,
          '',
          '## Summary',
          agenticReview.summary,
          '',
          '## Notes',
          ...agenticReview.notes.map((note) => `- ${note}`),
          '',
          '## Issues',
          ...agenticReview.issues.map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.message}`),
          '',
          '## Validation summary',
          JSON.stringify(validationPayload.summary, null, 2),
        ].join('\n'),
        'utf8',
      );

      if (agenticReview.refinedSemanticMarkdown) {
        const reviewedSemanticPath = path.join(outputDir, 'source.semantic.reviewed.md');
        await fs.writeFile(reviewedSemanticPath, agenticReview.refinedSemanticMarkdown, 'utf8');
        if (result.createdSemantic) {
          await fs.writeFile(result.semanticPath, agenticReview.refinedSemanticMarkdown, 'utf8');
        }
        outputChannel.appendLine(`[source-to-semantic] wrote ${reviewedSemanticPath}`);
      }

      const reviewedGraph = applyReviewToGraph(result.graph, agenticReview);
      const reviewedGraphPath = path.join(outputDir, 'source.graph.reviewed.json');
      await fs.writeFile(reviewedGraphPath, JSON.stringify(reviewedGraph, null, 2) + '\n', 'utf8');
      outputChannel.appendLine(`[source-to-semantic] wrote ${reviewedGraphPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${reviewArtifactPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${reviewMarkdownPath}`);
      outputChannel.appendLine(
        `[source-to-semantic-review] provider=${agenticReview.provider} mode=${agenticReview.mode} model=${agenticReview.model}`,
      );
      outputChannel.appendLine(`  bridge: ${agenticReview.bridgeAction}`);
      outputChannel.appendLine(`  summary: ${agenticReview.summary}`);
      for (const note of agenticReview.notes) {
        outputChannel.appendLine(`  note: ${note}`);
      }
      if (agenticReview.issues.length > 0) {
        outputChannel.appendLine(`  issues: ${agenticReview.issues.length}`);
      }
    },
  );

  const semanticPath = vscode.Uri.file(path.join(outputDir, 'source.semantic.md'));
  const semanticDocument = await vscode.workspace.openTextDocument(semanticPath);
  await vscode.window.showTextDocument(semanticDocument, { preview: false });

  try {
    const graphPath = path.join(outputDir, 'source.graph.reviewed.json');
    const rawGraph = await fs.readFile(graphPath, 'utf8').catch(async () => fs.readFile(path.join(outputDir, 'source.graph.json'), 'utf8'));
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
    issues: Array<{
      severity?: string;
      code?: string;
      message?: string;
      sourceRef?: string;
      sourceLine?: number;
      sourceColumn?: number;
      nodeId?: string;
      sourceLabel?: string;
    }>;
    summary: { gaps: number; conflicts: number; warnings: number; violations: number };
  },
  sourceLabel = 'AI Native Semantic Workflow',
): string[] {
  const diagnosticsList: vscode.Diagnostic[] = [];
  const logLines: string[] = [];

  for (const issue of payload.issues) {
    const resolved = issueToDiagnostic(document, issue);
    if (!resolved) {
      continue;
    }
    diagnosticsList.push(resolved.diagnostic);
    const effectiveSourceLabel = issue.sourceLabel ?? sourceLabel;
    resolved.diagnostic.source = effectiveSourceLabel;
    const location = `${document.fileName}:${resolved.diagnostic.range.start.line + 1}:${resolved.diagnostic.range.start.character + 1}`;
    logLines.push(`  [${effectiveSourceLabel}] ${issue.severity?.toUpperCase() ?? 'INFO'} ${issue.code ?? 'issue'} (${location}): ${issue.message ?? ''}`);
  }
  diagnostics.set(document.uri, diagnosticsList);
  return logLines;
}

async function resolveValidationPolicyText(registry: McpRegistry): Promise<string> {
  const response = await registry.callTool('validator', 'get_validation_policy', {});
  const payload = asObject(response.json);
  const policyText = typeof payload?.policyText === 'string' ? payload.policyText : undefined;
  if (policyText) {
    return policyText;
  }
  throw new Error('Unable to load validation policy from the MCP validator.');
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
  issues: Array<{ severity?: string; code?: string; message?: string; sourceRef?: string; sourceLine?: number; sourceColumn?: number; nodeId?: string }>;
  summary: { gaps: number; conflicts: number; warnings: number; violations: number };
  graph: unknown;
} {
  const object = asObject(value) ?? {};
  const summaryObject = asObject(object.summary) ?? {};
  return {
    issues: Array.isArray(object.issues) ? (object.issues as Array<{ severity?: string; code?: string; message?: string; sourceRef?: string; sourceLine?: number; sourceColumn?: number; nodeId?: string }>) : [],
    summary: {
      gaps: typeof summaryObject.gaps === 'number' ? summaryObject.gaps : 0,
      conflicts: typeof summaryObject.conflicts === 'number' ? summaryObject.conflicts : 0,
      warnings: typeof summaryObject.warnings === 'number' ? summaryObject.warnings : 0,
      violations: typeof summaryObject.violations === 'number' ? summaryObject.violations : 0,
    },
    graph: object.graph,
  };
}
