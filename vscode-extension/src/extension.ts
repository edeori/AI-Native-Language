import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { commandIds } from './constants.js';
import { getConfig } from './config.js';
import { McpRegistry } from './mcpRegistry.js';
import { VersionedArtifactTreeDataProvider } from './views/versionedArtifactTree.js';
import { McpTreeDataProvider } from './views/mcpTree.js';
import { ActionsWebviewProvider } from './webviews/actionsView.js';
import { ConfigurationPanel } from './webviews/configuration.js';
import { GraphPreviewPanel } from './webviews/graphPreview.js';
import { ReconRunsWebviewProvider, type ReconRunModuleSnapshot, type ReconRunSnapshot } from './webviews/reconRunsView.js';
import { resolveArtifactRoot } from './workspaceArtifacts.js';
import { initializeMcpConfigStorage } from './mcpConfigStore.js';
import {
  appendFeedbackDelta,
  buildReviewDossier,
  importSourceProjectState,
  readLocalAgentOutputs,
  runLocalAgentRole,
  writeReviewDossier,
  type EnrichmentOutput,
  type JavaAstFile,
} from '@ai-native/semantic-shared';
import { runAgenticPrompt, runAgenticReviewBundle, type AgenticDiagramClassification, type AgenticReviewResult, type ReviewPromptBundle } from './agenticReview.js';
import { hashArtifactContent, readLatestVersionedArtifact, writeVersionedArtifact } from './versionedArtifacts.js';

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

  const validationProvider = new VersionedArtifactTreeDataProvider('validation', 'Validation', 'Versioned validation runs.');
  const reviewProvider = new VersionedArtifactTreeDataProvider('review', 'Review', 'Versioned AI review outputs.');
  const semanticProvider = new VersionedArtifactTreeDataProvider('semantic', 'Semantic', 'Versioned semantic source states.');
  const databaseSchemaProvider = new VersionedArtifactTreeDataProvider('databaseSchema', 'Database Schema', 'Versioned database schema outputs.');
  const mcpProvider = new McpTreeDataProvider(registry);
  const actionsProvider = new ActionsWebviewProvider(context);
  const reconRunsProvider = new ReconRunsWebviewProvider(context);

  const validationView = vscode.window.createTreeView('aiNativeValidation', { treeDataProvider: validationProvider });
  const reviewView = vscode.window.createTreeView('aiNativeReviewArtifacts', { treeDataProvider: reviewProvider });
  const semanticView = vscode.window.createTreeView('aiNativeSemanticArtifacts', { treeDataProvider: semanticProvider });
  const databaseSchemaView = vscode.window.createTreeView('aiNativeDatabaseSchema', { treeDataProvider: databaseSchemaProvider });
  const mcpView = vscode.window.createTreeView('aiNativeMcpHub', { treeDataProvider: mcpProvider });
  const actionsView = vscode.window.registerWebviewViewProvider('aiNativeActions', actionsProvider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  const reconRunsView = vscode.window.registerWebviewViewProvider('aiNativeRecon', reconRunsProvider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  context.subscriptions.push(
    validationView,
    reviewView,
    semanticView,
    databaseSchemaView,
    mcpView,
    actionsView,
    reconRunsView,
  );

  const refreshViews = async (): Promise<void> => {
    validationProvider.refresh();
    reviewProvider.refresh();
    semanticProvider.refresh();
    databaseSchemaProvider.refresh();
    mcpProvider.refresh();
    reconRunsProvider.refresh();
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
    vscode.commands.registerCommand(commandIds.openReconRuns, async () => {
      try {
        await vscode.commands.executeCommand('workbench.view.extension.aiNativeSemantic');
      } catch {
        // ignore: focus command is best-effort
      }
    }),
    vscode.commands.registerCommand(commandIds.createSemanticSourceTemplate, async () => {
      await createSemanticSourceTemplate();
    }),
    vscode.commands.registerCommand(commandIds.importSourceProject, async () => {
      await importSourceProject(context, diagnostics, registry, outputChannel, refreshViews, reconRunsProvider);
    }),
    vscode.commands.registerCommand(commandIds.resumeRecon, async (stage?: string) => {
      if (stage) {
        outputChannel.appendLine(`[source-to-semantic] resume recon requested from stage: ${stage}`);
      }
      await importSourceProject(context, diagnostics, registry, outputChannel, refreshViews, reconRunsProvider, stage);
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
      await runValidation(context, diagnostics, registry, outputChannel, undefined, refreshViews);
    }),
    vscode.commands.registerCommand(commandIds.generateCanonicalGraph, async () => {
      await runGraphGeneration(context, diagnostics, registry, outputChannel, undefined, refreshViews);
    }),
    vscode.commands.registerCommand(commandIds.openMarkdownArtifactPreview, async (resource?: vscode.Uri | string) => {
      await openMarkdownArtifactPreview(resource, outputChannel);
    }),
    vscode.commands.registerCommand(commandIds.openGraphPreview, async (resource?: vscode.Uri | string) => {
      await openGraphPreview(context, registry, outputChannel, resource);
    }),
    vscode.commands.registerCommand(commandIds.generateSpringBootSkeleton, async () => {
      await runSpringGeneration(context, registry, outputChannel);
    }),
  );

  context.subscriptions.push(
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
  refreshViews?: () => Promise<void>,
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
      const artifactRoot = await resolveArtifactRoot();
      await ensureSemanticVersionCheckpoint(artifactRoot, source, 'validation checkpoint');

      report('Loading validation policy from MCP...');
      const validationPolicy = await resolveValidationPolicyText(registry);

      report('Running MCP validation...');
      const response = await registry.callTool('validator', 'validate_semantic_markdown', {
        content: source.getText(),
        policyText: validationPolicy,
        persist: true,
      });

      const payload = asValidationPayload(response.json);
      const logLines = publishValidationDiagnostics(diagnostics, source, payload, 'AI Native Validation');
      outputChannel.show(true);
      outputChannel.appendLine(`[validation] ${path.basename(source.fileName)}`);
      outputChannel.appendLine(
        `  summary: gaps=${payload.summary.gaps}, conflicts=${payload.summary.conflicts}, warnings=${payload.summary.warnings}, violations=${payload.summary.violations}`,
      );
      if (payload.reportPath) {
        outputChannel.appendLine(`  validation artifact: ${payload.reportPath}`);
      }
      for (const line of logLines) {
        outputChannel.appendLine(line);
      }

      if (artifactRoot) {
        report('Writing validation artifact...');
        const validationFolder = vscode.Uri.joinPath(artifactRoot, 'validation');
        await vscode.workspace.fs.createDirectory(validationFolder);
        const validationPath = vscode.Uri.joinPath(validationFolder, `${slug(source.fileName)}.validation.md`);
        const graph = asGraphObject(payload.graph);
        const validationDelta = buildValidationDelta({
          sourcePath: source.fileName,
          reportPath: payload.reportPath,
          validationPolicyLoadedFrom: 'mcp-validator:get_validation_policy',
          graph,
          summary: payload.summary,
          issues: payload.issues,
        });
        await vscode.workspace.fs.writeFile(
          validationPath,
          Buffer.from(
            [
              '# AI Native Validation',
              '',
              `- Source: ${source.fileName}`,
              `- MCP report path: ${payload.reportPath ?? 'n/a'}`,
              `- MCP summary: gaps=${payload.summary.gaps}, conflicts=${payload.summary.conflicts}, warnings=${payload.summary.warnings}, violations=${payload.summary.violations}`,
              '',
              '## MCP issues',
              ...(payload.issues.length
                ? payload.issues.map((issue) => `- [${issue.severity ?? 'info'}] ${issue.code ?? 'issue'}: ${issue.message ?? ''}`)
                : ['- none']),
              '',
              '## Retraining delta',
              `- missing sections: ${validationDelta.missingSections.length ? validationDelta.missingSections.join(', ') : 'none'}`,
              `- schema gaps: ${validationDelta.schemaGaps.length ? validationDelta.schemaGaps.join(', ') : 'none'}`,
              `- persistence gaps: ${validationDelta.persistenceSignals.length ? validationDelta.persistenceSignals.join(', ') : 'none'}`,
              `- review targets: ${validationDelta.reviewTargets.length ? validationDelta.reviewTargets.join(', ') : 'none'}`,
              '',
              '## Graph signals',
              `- nodes: ${validationDelta.graphSignals.nodeCount}`,
              `- edges: ${validationDelta.graphSignals.edgeCount}`,
              `- database schema tables: ${validationDelta.graphSignals.databaseSchemaTables}`,
              `- graph layers: ${validationDelta.graphSignals.layers.length ? validationDelta.graphSignals.layers.join(', ') : 'none'}`,
              '',
              '## Delta hints',
              ...(validationDelta.hints.length ? validationDelta.hints.map((hint) => `- ${hint}`) : ['- none']),
            ].join('\n'),
            'utf8',
          ),
        );
        await writeVersionedArtifact({
          artifactRoot: artifactRoot.fsPath,
          kind: 'validation',
          baseName: slug(source.fileName),
          sourcePath: source.fileName,
          sourceHash: hashArtifactContent(source.getText()),
          label: 'validation',
          files: {
            'validation.md': [
              '# AI Native Validation',
              '',
              `- Source: ${source.fileName}`,
              `- MCP report path: ${payload.reportPath ?? 'n/a'}`,
              `- MCP summary: gaps=${payload.summary.gaps}, conflicts=${payload.summary.conflicts}, warnings=${payload.summary.warnings}, violations=${payload.summary.violations}`,
              '',
              '## MCP issues',
              ...(payload.issues.length
                ? payload.issues.map((issue) => `- [${issue.severity ?? 'info'}] ${issue.code ?? 'issue'}: ${issue.message ?? ''}`)
                : ['- none']),
              '',
              '## Retraining delta',
              `- missing sections: ${validationDelta.missingSections.length ? validationDelta.missingSections.join(', ') : 'none'}`,
              `- schema gaps: ${validationDelta.schemaGaps.length ? validationDelta.schemaGaps.join(', ') : 'none'}`,
              `- persistence gaps: ${validationDelta.persistenceSignals.length ? validationDelta.persistenceSignals.join(', ') : 'none'}`,
              `- review targets: ${validationDelta.reviewTargets.length ? validationDelta.reviewTargets.join(', ') : 'none'}`,
              '',
              '## Graph signals',
              `- nodes: ${validationDelta.graphSignals.nodeCount}`,
              `- edges: ${validationDelta.graphSignals.edgeCount}`,
              `- database schema tables: ${validationDelta.graphSignals.databaseSchemaTables}`,
              `- graph layers: ${validationDelta.graphSignals.layers.length ? validationDelta.graphSignals.layers.join(', ') : 'none'}`,
              '',
              '## Delta hints',
              ...(validationDelta.hints.length ? validationDelta.hints.map((hint) => `- ${hint}`) : ['- none']),
            ].join('\n') + '\n',
          },
          metadata: {
            reportPath: payload.reportPath,
            summary: payload.summary,
            validationPolicyLoadedFrom: 'mcp-validator:get_validation_policy',
          },
        });
        outputChannel.appendLine(`  validation markdown: ${validationPath.fsPath}`);

          await submitFeedbackDelta({
            registry,
            workspaceRoot: artifactRoot.fsPath,
            server: 'validator',
            kind: 'validation',
          sourcePath: source.fileName,
          sourceHash: hashArtifactContent(source.getText()),
          summary: {
            source: source.fileName,
            reportPath: payload.reportPath,
            validationSummary: payload.summary,
          },
          delta: validationDelta,
          issues: payload.issues,
            evidence: [
            { kind: 'validation-report', path: validationPath.fsPath },
          ],
          metadata: {
            validationPolicyLoadedFrom: 'mcp-validator:get_validation_policy',
          },
        });
      }

      report('Validation finished.');
      await vscode.window.showTextDocument(source, { preview: false });
      await vscode.window.showInformationMessage(
        `Validation completed: ${payload.summary.gaps} gaps, ${payload.summary.conflicts} conflicts, ${payload.summary.warnings} warnings, ${payload.summary.violations} violations.`,
      );
      await refreshViews?.();
    },
  );
}

async function runGraphGeneration(
  context: vscode.ExtensionContext,
  diagnostics: vscode.DiagnosticCollection,
  registry: McpRegistry,
  outputChannel: vscode.OutputChannel,
  document?: vscode.TextDocument,
  refreshViews?: () => Promise<void>,
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
      const artifactRoot = await resolveArtifactRoot();
      const sourceHash = hashArtifactContent(source.getText());
      await ensureSemanticVersionCheckpoint(artifactRoot, source, 'graph checkpoint');
      const latestValidation = artifactRoot
        ? await readLatestVersionedArtifact(artifactRoot.fsPath, 'validation', slug(source.fileName))
        : undefined;
      if (!latestValidation) {
        vscode.window.showWarningMessage('Graph generation requires a fresh validated version first.');
        return;
      }
      if (latestValidation.sourceHash !== sourceHash) {
        vscode.window.showWarningMessage('The latest validation version is stale. Run Validate input before generating the graph.');
        return;
      }
      const response = await registry.callTool('semanticCore', 'generate_canonical_graph', {
        content: source.getText(),
        policyText: validationPolicy,
        persist: true,
      });

      const payload = asObject(response.json);
      const graph = asGraphObject(payload?.graph);
      const graphValidation = asValidationPayload(payload?.validation);

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
        const reviewPromptBundle = await loadReviewPromptBundle(registry, {
          sourcePath: source.fileName,
          projectRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          semanticSource: source.getText(),
          graph,
          enrichment: undefined,
          validation: {
            status: deriveValidationStatus(graphValidation.summary),
            summary: graphValidation.summary,
            issues: graphValidation.issues,
          },
          expectationDocuments: [{ path: 'mcp-validation-policy.md', content: validationPolicy }],
        });
        const agenticReview = await runAgenticReviewBundle({
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
        }, reviewPromptBundle);
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
          await writeVersionedArtifact({
            artifactRoot: artifactRoot.fsPath,
            kind: 'graph',
            baseName: slug(source.fileName),
            sourcePath: source.fileName,
            sourceHash,
            label: 'reviewed graph',
            files: {
              'graph.json': JSON.stringify(reviewedGraph, null, 2) + '\n',
            },
            metadata: {
              review: agenticReview.summary,
            },
          });
          const reviewedDatabaseSchema = asObject(reviewedGraph.metadata)?.databaseSchema as
            | NonNullable<AgenticDiagramClassification['databaseSchema']>
            | undefined;
          if (reviewedDatabaseSchema) {
            await writeVersionedArtifact({
              artifactRoot: artifactRoot.fsPath,
              kind: 'databaseSchema',
              baseName: slug(source.fileName),
              sourcePath: source.fileName,
              sourceHash,
              label: 'reviewed database schema',
              files: {
                'database.schema.json': JSON.stringify(reviewedDatabaseSchema, null, 2) + '\n',
              },
              metadata: {
                reviewedAt: new Date().toISOString(),
                source: 'reviewed graph metadata',
                reviewSummary: agenticReview.summary,
              },
            });
          }
          outputChannel.appendLine(`  reviewed graph: ${reviewedPath.fsPath}`);
          const validationFolder = vscode.Uri.joinPath(artifactRoot, 'validation');
          await vscode.workspace.fs.createDirectory(validationFolder);
          const validationPath = vscode.Uri.joinPath(validationFolder, `${slug(source.fileName)}.validation.md`);
          await vscode.workspace.fs.writeFile(
            validationPath,
            Buffer.from(
              [
                '# AI Native Validation',
                '',
                `- Source: ${source.fileName}`,
                `- MCP report path: ${graphValidation.reportPath ?? 'n/a'}`,
                `- MCP summary: gaps=${graphValidation.summary.gaps}, conflicts=${graphValidation.summary.conflicts}, warnings=${graphValidation.summary.warnings}, violations=${graphValidation.summary.violations}`,
                `- AI provider: ${agenticReview.provider}`,
                `- AI mode: ${agenticReview.mode}`,
                `- AI model: ${agenticReview.model}`,
                `- Bridge: ${agenticReview.bridgeAction}`,
                '',
                '## MCP issues',
                ...(graphValidation.issues.length
                  ? graphValidation.issues.map((issue) => `- [${issue.severity ?? 'info'}] ${issue.code ?? 'issue'}: ${issue.message ?? ''}`)
                  : ['- none']),
                '',
                '## AI review',
                agenticReview.summary,
                '',
                '### Notes',
                ...(agenticReview.notes.length ? agenticReview.notes.map((note) => `- ${note}`) : ['- none']),
                '',
                '### Issues',
                ...(agenticReview.issues.length
                  ? agenticReview.issues.map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.message}`)
                  : ['- none']),
              ].join('\n'),
              'utf8',
            ),
          );
          await writeVersionedArtifact({
            artifactRoot: artifactRoot.fsPath,
            kind: 'review',
            baseName: slug(source.fileName),
            sourcePath: source.fileName,
            sourceHash,
            label: 'review',
            files: {
              'review.md': [
                '# AI Native Validation',
                '',
                `- Source: ${source.fileName}`,
                `- MCP report path: ${graphValidation.reportPath ?? 'n/a'}`,
                `- MCP summary: gaps=${graphValidation.summary.gaps}, conflicts=${graphValidation.summary.conflicts}, warnings=${graphValidation.summary.warnings}, violations=${graphValidation.summary.violations}`,
                `- AI provider: ${agenticReview.provider}`,
                `- AI mode: ${agenticReview.mode}`,
                `- AI model: ${agenticReview.model}`,
                `- Bridge: ${agenticReview.bridgeAction}`,
                '',
                '## MCP issues',
                ...(graphValidation.issues.length
                  ? graphValidation.issues.map((issue) => `- [${issue.severity ?? 'info'}] ${issue.code ?? 'issue'}: ${issue.message ?? ''}`)
                  : ['- none']),
                '',
                '## AI review',
                agenticReview.summary,
                '',
                '### Notes',
                ...(agenticReview.notes.length ? agenticReview.notes.map((note) => `- ${note}`) : ['- none']),
                '',
                '### Issues',
                ...(agenticReview.issues.length
                  ? agenticReview.issues.map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.message}`)
                  : ['- none']),
              ].join('\n') + '\n',
            },
            metadata: {
              reviewedAt: new Date().toISOString(),
              summary: agenticReview.summary,
              provider: agenticReview.provider,
              mode: agenticReview.mode,
            },
          });
          outputChannel.appendLine(`  validation markdown: ${validationPath.fsPath}`);
          await submitFeedbackDelta({
            registry,
            workspaceRoot: artifactRoot?.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            server: 'validator',
            kind: 'validation',
            sourcePath: source.fileName,
            sourceHash,
            summary: {
              source: source.fileName,
              reportPath: graphValidation.reportPath,
              validationSummary: graphValidation.summary,
              reviewSummary: agenticReview.summary,
            },
            delta: {
              validationDelta: buildValidationDelta({
                sourcePath: source.fileName,
                reportPath: graphValidation.reportPath,
                validationPolicyLoadedFrom: 'mcp-validator:get_validation_policy',
                graph,
                summary: graphValidation.summary,
                issues: graphValidation.issues,
              }),
              reviewedIssuesCount: reviewedIssues.length,
              reviewSummary: agenticReview.summary,
            },
            issues: reviewedIssues,
            evidence: [
              { kind: 'graph', path: reviewedPath.fsPath },
              { kind: 'validation-md', path: validationPath.fsPath },
            ],
            metadata: {
              validationPolicyLoadedFrom: 'mcp-validator:get_validation_policy',
              reviewedAt: new Date().toISOString(),
            },
          });

          await submitFeedbackDelta({
            registry,
            workspaceRoot: artifactRoot.fsPath,
            server: 'semanticCore',
            kind: 'graph',
            sourcePath: source.fileName,
            sourceHash,
            summary: {
              source: source.fileName,
              graphValidationSummary: graphValidation.summary,
              reviewSummary: agenticReview.summary,
              reviewedAt: new Date().toISOString(),
            },
            delta: {
              diagramClassification: agenticReview.diagramClassification ?? undefined,
              reviewedIssuesCount: reviewedIssues.length,
              graphNodeCount: reviewedGraph.nodes.length,
              graphEdgeCount: reviewedGraph.edges.length,
              databaseSchemaTables: reviewedDatabaseSchema?.tables?.length ?? 0,
            },
            issues: reviewedIssues,
            evidence: [
              { kind: 'graph', path: reviewedPath.fsPath },
              ...(agenticReview.reviewArtifactPath ? [{ kind: 'review', path: agenticReview.reviewArtifactPath }] : []),
            ],
            metadata: {
              validationPolicyLoadedFrom: 'mcp-validator:get_validation_policy',
              reviewedAt: new Date().toISOString(),
            },
          });
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
      await refreshViews?.();
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
    diagramClassification?: AgenticDiagramClassification;
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
        diagramClassification: review.diagramClassification,
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
  resource?: vscode.Uri | string,
): Promise<void> {
  const artifactRoot = await resolveArtifactRoot();
  const candidateUri = typeof resource === 'string'
    ? vscode.Uri.file(resource)
    : resource instanceof vscode.Uri
      ? resource
      : undefined;

  if (candidateUri && (await pathExists(candidateUri))) {
    const document = await vscode.workspace.openTextDocument(candidateUri);
    const graph = parseGraphFromText(document.getText());
    if (graph) {
      GraphPreviewPanel.show(context, graph, path.basename(candidateUri.fsPath));
      outputChannel.show(true);
      outputChannel.appendLine(`[graph-preview] ${candidateUri.fsPath}`);
      return;
    }
  }

  const source = await resolveSemanticSourceDocument();
  if (source) {
    const reviewedArtifactRecord = artifactRoot
      ? await readLatestVersionedArtifact(artifactRoot.fsPath, 'graph', slug(source.fileName))
      : undefined;
    const reviewedArtifact = reviewedArtifactRecord?.files['graph.json']
      ? vscode.Uri.file(reviewedArtifactRecord.files['graph.json'])
      : artifactRoot
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

  if (artifactRoot) {
    const canonicalSemanticPath = vscode.Uri.joinPath(artifactRoot, 'source.semantic.md');
    if (await pathExists(canonicalSemanticPath)) {
      const document = await vscode.workspace.openTextDocument(canonicalSemanticPath);
      const graph = parseGraphFromText(document.getText());
      if (graph) {
        GraphPreviewPanel.show(context, graph, 'source.semantic.md');
        outputChannel.show(true);
        outputChannel.appendLine(`[graph-preview] canonical source: ${canonicalSemanticPath.fsPath}`);
        return;
      }
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

async function openMarkdownArtifactPreview(resource: vscode.Uri | string | undefined, outputChannel: vscode.OutputChannel): Promise<void> {
  const candidateUri = typeof resource === 'string'
    ? vscode.Uri.file(resource)
    : resource instanceof vscode.Uri
      ? resource
      : undefined;

  if (!candidateUri || !(await pathExists(candidateUri))) {
    vscode.window.showWarningMessage('No markdown artifact was found.');
    return;
  }

  await vscode.commands.executeCommand('markdown.showPreview', candidateUri);
  outputChannel.show(true);
  outputChannel.appendLine(`[markdown-preview] ${candidateUri.fsPath}`);
}

function deriveValidationStatus(summary: { gaps: number; conflicts: number; warnings: number; violations: number }): string {
  return summary.violations > 0 || summary.conflicts > 0 || summary.gaps > 0
    ? 'draft'
    : summary.warnings > 0
      ? 'ready'
      : 'validated';
}

async function ensureSemanticVersionCheckpoint(
  artifactRoot: vscode.Uri | undefined,
  source: vscode.TextDocument,
  reason: string,
): Promise<void> {
  if (!artifactRoot) {
    return;
  }

  const sourceText = source.getText();
  const sourceHash = hashArtifactContent(sourceText);
  const baseName = slug(source.fileName);
  const latest = await readLatestVersionedArtifact(artifactRoot.fsPath, 'semantic', baseName);
  if (latest?.sourceHash === sourceHash) {
    return;
  }

  await writeVersionedArtifact({
    artifactRoot: artifactRoot.fsPath,
    kind: 'semantic',
    baseName,
    sourcePath: source.fileName,
    sourceHash,
    label: reason,
    files: {
      'semantic.md': `${sourceText}\n`,
    },
    metadata: {
      source: source.fileName,
      checkpointReason: reason,
      checkpointedAt: new Date().toISOString(),
    },
  });
}

async function submitFeedbackDelta(context: {
  registry: McpRegistry;
  workspaceRoot?: string;
  server: 'validator' | 'semanticCore';
  kind: string;
  sourcePath: string;
  sourceHash?: string;
  summary?: Record<string, unknown>;
  delta?: Record<string, unknown>;
  issues?: Array<Record<string, unknown>>;
  evidence?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const localStore = await appendFeedbackDelta(context.workspaceRoot, {
      server: context.server,
      kind: context.kind,
      sourcePath: context.sourcePath,
      sourceHash: context.sourceHash,
      summary: context.summary,
      delta: context.delta,
      issues: context.issues,
      evidence: context.evidence,
      metadata: context.metadata,
    });
    console.debug?.(`[feedback][${context.server}] stored locally at ${localStore.recordPath}`);
  } catch (error) {
    console.warn(`Failed to store local feedback delta for ${context.server}:`, error);
  }

  try {
    const response = await context.registry.callTool(context.server, 'ingest_feedback_delta', {
      workspaceRoot: context.workspaceRoot,
      sourcePath: context.sourcePath,
      sourceHash: context.sourceHash,
      summary: context.summary,
      delta: context.delta,
      issues: context.issues,
      evidence: context.evidence,
      metadata: context.metadata,
    });
    console.debug?.(`[feedback][${context.server}] MCP ingest response: ${JSON.stringify(response.json ?? response.text).slice(0, 400)}`);
  } catch (error) {
    console.warn(`Failed to push feedback delta to ${context.server}:`, error);
  }
}

function buildValidationDelta(context: {
  sourcePath: string;
  reportPath?: string;
  validationPolicyLoadedFrom: string;
  graph?: ReturnType<typeof asGraphObject>;
  summary: { gaps: number; conflicts: number; warnings: number; violations: number };
  issues: Array<{ severity?: string; code?: string; message?: string; sourceRef?: string; sourceLine?: number; sourceColumn?: number; nodeId?: string }>;
}): {
  sourcePath: string;
  reportPath?: string;
  validationPolicyLoadedFrom: string;
  summary: { gaps: number; conflicts: number; warnings: number; violations: number };
  issues: Array<{ severity?: string; code?: string; message?: string; sourceRef?: string; sourceLine?: number; sourceColumn?: number; nodeId?: string }>;
  missingSections: string[];
  schemaGaps: string[];
  persistenceSignals: string[];
  reviewTargets: string[];
  hints: string[];
  graphSignals: {
    nodeCount: number;
    edgeCount: number;
    databaseSchemaTables: number;
    layers: string[];
  };
} {
  const issueCodes = context.issues.map((issue) => issue.code ?? 'issue');
  const missingSections = context.issues
    .filter((issue) => issue.code === 'missing_section')
    .map((issue) => (issue.message ?? '').replace(/^Required section\s+"?/i, '').replace(/"?\s+is missing\.?$/i, '').trim())
    .filter(Boolean);
  const schemaGaps = context.issues
    .filter((issue) => issue.code === 'missing_database_schema')
    .map((issue) => issue.message ?? 'Database schema inference gap')
    .filter(Boolean);
  const persistenceSignals = context.issues
    .filter((issue) => issue.code === 'dependency_unreferenced' || issue.code === 'missing_database_schema')
    .map((issue) => issue.message ?? issue.code ?? 'persistence gap')
    .filter(Boolean);
  const reviewTargets = Array.from(
    new Set(
      context.issues
        .map((issue) => issue.sourceRef ?? issue.sourceLine?.toString() ?? issue.code ?? 'unknown')
        .filter(Boolean),
    ),
  );
  const hints = new Set<string>();

  for (const code of issueCodes) {
    switch (code) {
      case 'missing_section':
        hints.add('Add the missing semantic section explicitly so the MCP validator can anchor the expectation.');
        break;
      case 'missing_modules':
        hints.add('Add explicit module boundaries when the slice is layered or enterprise-like.');
        break;
      case 'missing_database_schema':
        hints.add('Describe tables, keys, and relationships in the semantic source so DB schema inference has stable anchors.');
        break;
      case 'security_missing_authentication':
        hints.add('Make authentication explicit in the security section and in the affected flows.');
        break;
      case 'security_missing_authorization':
        hints.add('Make authorization, ownership, and write access rules explicit.');
        break;
      case 'dependency_unreferenced':
        hints.add('Reference dependencies from the processes or interfaces that actually use them.');
        break;
      default:
        break;
    }
  }

  const graph = context.graph as
    | (ReturnType<typeof asGraphObject> & {
        metadata?: { databaseSchema?: { tables?: Array<unknown> } };
      })
    | undefined;
  const graphSignals = {
    nodeCount: graph?.nodes.length ?? 0,
    edgeCount: graph?.edges.length ?? 0,
    databaseSchemaTables: graph?.metadata?.databaseSchema?.tables?.length ?? 0,
    layers: Array.from(new Set((graph?.nodes ?? []).map((node) => node.type).filter(Boolean))).slice(0, 12),
  };

  if (graphSignals.databaseSchemaTables === 0 && context.summary.warnings === 0 && context.summary.violations === 0) {
    hints.add('No database schema was inferred; consider adding explicit persistence terminology if storage should be modeled.');
  }

  return {
    sourcePath: context.sourcePath,
    reportPath: context.reportPath,
    validationPolicyLoadedFrom: context.validationPolicyLoadedFrom,
    summary: context.summary,
    issues: context.issues,
    missingSections,
    schemaGaps,
    persistenceSignals,
    reviewTargets,
    hints: Array.from(hints),
    graphSignals,
  };
}

async function importSourceProject(
  context: vscode.ExtensionContext,
  diagnostics: vscode.DiagnosticCollection,
  registry: McpRegistry,
  outputChannel: vscode.OutputChannel,
  refreshViews: () => Promise<void>,
  reconRunsProvider: ReconRunsWebviewProvider,
  resumeFromStage?: string,
): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Open the project workspace first, then import source learning from its root.');
    return;
  }

  const sourceRoot = workspaceFolder.uri.fsPath;
  const projectName = slug(path.basename(sourceRoot));
  const outputDir = path.join(workspaceFolder.uri.fsPath, '.ai-native');

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

      const reconRunsRootDir = path.join(outputDir, 'source.recon.runs');
      const reconRunId = createReconRunId(projectName);
      const reconRunDir = path.join(reconRunsRootDir, reconRunId);
      const reconProjectArtifactsDir = path.join(reconRunDir, 'project');
      const reconModuleArtifactsDir = path.join(reconRunDir, 'modules');
      await fs.mkdir(reconModuleArtifactsDir, { recursive: true });

      let reconRunState: ReconRunSnapshot = {
        runId: reconRunId,
        projectName,
        projectRoot: sourceRoot,
        outputDir,
        status: 'running',
        phase: 'Parsing workspace Java files with MCP java-parser',
        startedAt: new Date().toISOString(),
        astStatus: 'running',
        astStartedAt: new Date().toISOString(),
        analysisStatus: 'pending',
        codeGraphStatus: 'pending',
        localAgentStatus: 'pending',
        projectPromptStatus: 'pending',
        moduleRuns: [],
        events: [
          {
            at: new Date().toISOString(),
            kind: 'phase',
            message: 'Parsing workspace Java files with MCP java-parser.',
          },
        ],
        artifactRoot: outputDir,
      };
      reconRunsProvider.setSnapshot(reconRunState);
      await persistReconRunState(reconRunState, reconRunDir, outputDir);

      const updateReconRunState = async (mutator: (state: ReconRunSnapshot) => void): Promise<void> => {
        mutator(reconRunState);
        reconRunsProvider.setSnapshot(reconRunState);
        await persistReconRunState(reconRunState, reconRunDir, outputDir);
      };

      const astPath = path.join(outputDir, 'source.ast.json');
      const analysisProgressPath = path.join(outputDir, 'source.analysis.progress.json');
      const codeGraphProgressPath = path.join(outputDir, 'source.codegraph.progress.json');
      report('Parsing workspace Java files with MCP java-parser...');
      const cachedJavaAstProject = await loadCachedJavaAstProject(astPath);
      const javaAstProject = cachedJavaAstProject ?? await collectWorkspaceJavaAstProject(registry, sourceRoot, projectName);
      if (cachedJavaAstProject) {
        outputChannel.appendLine(`[source-to-semantic] reused ${astPath}`);
      }
      const javaAstCatalog = javaAstProject?.catalog;
      outputChannel.appendLine(
        `[source-to-semantic] java AST catalog: ${javaAstCatalog?.length ?? 0} files`,
      );
      if (javaAstProject) {
        await fs.writeFile(
          astPath,
          JSON.stringify(
            {
              projectName,
              projectRoot: sourceRoot,
              generatedAt: new Date().toISOString(),
              fileCount: javaAstProject.fileCount,
              summary: javaAstProject.summary,
              catalog: javaAstProject.catalog,
            },
            null,
            2,
          ) + '\n',
          'utf8',
        );
        outputChannel.appendLine(`[source-to-semantic] wrote ${astPath}`);
      }

      await updateReconRunState((state) => {
        state.astStatus = javaAstProject ? 'completed' : 'failed';
        state.astFinishedAt = new Date().toISOString();
        state.astArtifactPath = javaAstProject ? astPath : undefined;
        state.astFileCount = Number(javaAstProject?.fileCount ?? javaAstCatalog?.length ?? 0);
        state.analysisStatus = javaAstProject ? 'running' : 'pending';
        state.analysisStartedAt = javaAstProject ? new Date().toISOString() : undefined;
        state.analysisPhase = javaAstProject ? 'Deterministic analysis and snapshot are starting from the AST catalog.' : undefined;
        state.codeGraphStatus = 'running';
        state.codeGraphStartedAt = new Date().toISOString();
        state.codeGraphProgressPath = codeGraphProgressPath;
        state.codeGraphProgressUpdatedAt = new Date().toISOString();
        state.codeGraphHeartbeatCount = 0;
        state.phase = javaAstProject
          ? 'AST catalog written; deterministic analysis and graph bundle are starting'
          : 'Java AST parsing failed or returned no catalog';
        state.events?.push(
          {
            at: new Date().toISOString(),
            kind: 'artifact',
            message: javaAstProject
              ? `AST catalog written to ${path.basename(astPath)}`
              : 'Java AST parsing returned no catalog',
          },
          {
            at: new Date().toISOString(),
            kind: 'phase',
            message: javaAstProject
              ? 'Starting deterministic analysis and graph bundle construction.'
              : 'AST parsing failed; deterministic graph stages will remain pending.',
          },
        );
        state.events = state.events?.slice(-20);
      });

      await persistCodeGraphProgressArtifact(codeGraphProgressPath, {
        runId: reconRunId,
        projectName,
        projectRoot: sourceRoot,
        outputDir,
        status: 'running',
        phase: 'AST catalog written; deterministic graph bundle is starting',
        analysisStatus: 'running',
        startedAt: reconRunState.codeGraphStartedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        astArtifactPath: astPath,
        astFileCount: Number(javaAstProject?.fileCount ?? javaAstCatalog?.length ?? 0),
        progress: {
          phase: 'pending',
          message: 'Waiting for code graph build to begin.',
        },
        events: [
          {
            at: new Date().toISOString(),
            phase: 'started',
            message: 'AST catalog written; deterministic graph bundle starting.',
          },
        ],
      });
      outputChannel.appendLine(`[source-to-semantic] wrote ${codeGraphProgressPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${analysisProgressPath}`);

      let codeGraphHeartbeatCount = 0;
      let codeGraphHeartbeatInterval: NodeJS.Timeout | undefined;
      const startCodeGraphHeartbeat = (): void => {
        if (codeGraphHeartbeatInterval) {
          return;
        }
        codeGraphHeartbeatInterval = setInterval(() => {
          codeGraphHeartbeatCount += 1;
          const heartbeatAt = new Date().toISOString();
          void persistCodeGraphProgressArtifact(codeGraphProgressPath, {
            runId: reconRunId,
            projectName,
            projectRoot: sourceRoot,
            outputDir,
            status: 'running',
            phase: reconRunState.phase,
            startedAt: reconRunState.codeGraphStartedAt ?? heartbeatAt,
            updatedAt: heartbeatAt,
            astArtifactPath: astPath,
            astFileCount: Number(javaAstProject?.fileCount ?? javaAstCatalog?.length ?? 0),
            codeGraphArtifactPath: reconRunState.codeGraphArtifactPath,
            progress: {
              phase: reconRunState.codeGraphPhase ? 'heartbeat' : 'building',
              message: reconRunState.codeGraphPhase ?? 'Building deterministic graph bundle.',
            },
            heartbeatAt,
            heartbeatCount: codeGraphHeartbeatCount,
            events: [
              {
                at: heartbeatAt,
                phase: 'heartbeat',
                message: `Deterministic graph bundle still running (${codeGraphHeartbeatCount}).`,
              },
            ],
          });
          void updateReconRunState((state) => {
            state.codeGraphHeartbeatCount = codeGraphHeartbeatCount;
            state.codeGraphProgressUpdatedAt = heartbeatAt;
            state.events ??= [];
            state.events.push({
              at: heartbeatAt,
              kind: 'phase',
              message: `Graph heartbeat ${codeGraphHeartbeatCount}: deterministic graph bundle still running.`,
            });
            state.events = state.events.slice(-20);
          });
        }, 4000);
        codeGraphHeartbeatInterval.unref?.();
      };
      const stopCodeGraphHeartbeat = (): void => {
        if (codeGraphHeartbeatInterval) {
          clearInterval(codeGraphHeartbeatInterval);
          codeGraphHeartbeatInterval = undefined;
        }
      };
      startCodeGraphHeartbeat();

      let result: Awaited<ReturnType<typeof importSourceProjectState>> | undefined;
      try {
        let jqassistantArtifact: unknown;
        try {
          report('Running jqassistant MCP scan...');
          const jqassistantResponse = await registry.callTool('jqassistant', 'jqassistant_scan_project', {
            projectName,
            projectRoot: sourceRoot,
            outputDir,
          });
          jqassistantArtifact = jqassistantResponse.json;
        } catch (error) {
          outputChannel.appendLine(`[source-to-semantic] jqassistant MCP scan skipped: ${error instanceof Error ? error.message : String(error)}`);
        }

        result = await importSourceProjectState({
          projectRoot: sourceRoot,
          projectName,
          outputDir,
          resumeFromStage: normalizeResumeStage(resumeFromStage),
          javaAstCatalog,
          jqassistantArtifact: jqassistantArtifact as never,
          onAnalysisProgress: async (event) => {
            const analysisAt = new Date().toISOString();
            outputChannel.appendLine(
              `[source-to-semantic] analysis ${event.phase}: ${event.message}${event.currentFile ? ` · ${event.currentFile}` : ''}`,
            );
            await persistCodeGraphProgressArtifact(analysisProgressPath, {
              runId: reconRunId,
              projectName,
              projectRoot: sourceRoot,
              outputDir,
              status: 'running',
              phase: event.message,
              startedAt: reconRunState.startedAt,
              updatedAt: analysisAt,
              astArtifactPath: astPath,
              astFileCount: Number(javaAstProject?.fileCount ?? javaAstCatalog?.length ?? 0),
              progress: {
                phase: event.phase,
                message: event.message,
                currentFile: event.currentFile,
                completed: event.completed,
                total: event.total,
              },
              events: [
                {
                  at: analysisAt,
                  phase: event.phase,
                  message: event.message,
                },
              ],
            });
            await updateReconRunState((state) => {
              state.codeGraphProgressUpdatedAt = analysisAt;
              state.analysisStatus = 'running';
              state.analysisStartedAt ??= analysisAt;
              state.analysisPhase = `${event.phase}: ${event.message}`;
              state.phase = event.currentFile ? `${event.message} (${path.basename(event.currentFile)})` : event.message;
              state.events ??= [];
              state.events.push({
                at: analysisAt,
                kind: 'phase',
                message: `Analysis ${event.phase}: ${event.message}${event.currentFile ? ` · ${event.currentFile}` : ''}`,
              });
              state.events = state.events.slice(-20);
            });
          },
          onLifecycleProgress: async (event) => {
            const lifecycleAt = new Date().toISOString();
            outputChannel.appendLine(`[source-to-semantic] lifecycle ${event.phase}: ${event.message}`);
            await persistCodeGraphProgressArtifact(codeGraphProgressPath, {
              runId: reconRunId,
              projectName,
              projectRoot: sourceRoot,
              outputDir,
              status: event.phase === 'complete' ? 'completed' : 'running',
              phase: event.message,
              startedAt: reconRunState.startedAt,
              updatedAt: lifecycleAt,
              astArtifactPath: astPath,
              astFileCount: Number(javaAstProject?.fileCount ?? javaAstCatalog?.length ?? 0),
              codeGraphArtifactPath: reconRunState.codeGraphArtifactPath,
              progress: {
                phase: event.phase,
                message: event.message,
              },
              events: [
                {
                  at: lifecycleAt,
                  phase: event.phase,
                  message: event.message,
                },
              ],
            });
            await updateReconRunState((state) => {
              state.codeGraphProgressUpdatedAt = lifecycleAt;
              state.phase = event.message;
              if (event.phase === 'analysis' || event.phase === 'snapshot') {
                state.analysisStatus = event.message.includes('complete') ? 'completed' : 'running';
                state.analysisStartedAt ??= lifecycleAt;
                state.analysisPhase = event.message;
                if (event.message.includes('complete') || event.phase === 'snapshot' && /complete/i.test(event.message)) {
                  state.analysisFinishedAt = lifecycleAt;
                }
              }
              if (event.phase === 'graph') {
                state.codeGraphStatus = event.message.includes('complete') ? 'completed' : 'running';
                state.codeGraphStartedAt ??= lifecycleAt;
              }
              if (event.phase === 'enrichment') {
                state.localAgentStatus = event.message.includes('completed') ? 'completed' : 'running';
                state.localAgentStartedAt ??= lifecycleAt;
                state.localAgentPhase = event.message;
                if (event.message.includes('completed')) {
                  state.localAgentFinishedAt = lifecycleAt;
                }
              } else if (event.phase === 'artifacts' || event.phase === 'complete') {
                if (state.localAgentStatus === 'running') {
                  state.localAgentStatus = 'completed';
                  state.localAgentFinishedAt = lifecycleAt;
                }
              }
              state.events ??= [];
              state.events.push({
                at: lifecycleAt,
                kind: 'phase',
                message: `Lifecycle ${event.phase}: ${event.message}`,
              });
              state.events = state.events.slice(-20);
            });
          },
          onCodeGraphProgress: async (event) => {
            outputChannel.appendLine(`[source-to-semantic] code graph ${event.phase}: ${event.message}`);
            await persistCodeGraphProgressArtifact(codeGraphProgressPath, {
              runId: reconRunId,
              projectName,
              projectRoot: sourceRoot,
              outputDir,
              status: event.phase === 'complete' ? 'completed' : 'running',
              phase: `Building deterministic graph bundle: ${event.message}`,
              startedAt: reconRunState.codeGraphStartedAt ?? new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              astArtifactPath: astPath,
              astFileCount: Number(javaAstProject?.fileCount ?? javaAstCatalog?.length ?? 0),
              progress: {
                phase: event.phase,
                message: event.message,
              },
              events: [
                {
                  at: new Date().toISOString(),
                  phase: event.phase,
                  message: event.message,
                },
              ],
            });
            void updateReconRunState((state) => {
              state.codeGraphStatus = event.phase === 'complete' ? 'completed' : 'running';
              state.codeGraphPhase = event.message;
              state.codeGraphProgressUpdatedAt = new Date().toISOString();
              if (event.phase === 'complete') {
                state.codeGraphFinishedAt = new Date().toISOString();
                state.analysisStatus = state.analysisStatus === 'running' ? 'completed' : state.analysisStatus;
                state.analysisFinishedAt ??= new Date().toISOString();
              }
              state.phase = `Building deterministic graph bundle: ${event.message}`;
              state.events ??= [];
              state.events.push({
                at: new Date().toISOString(),
                kind: 'phase',
                message: `Code graph ${event.phase}: ${event.message}`,
              });
              state.events = state.events.slice(-20);
            });
          },
        });
      } finally {
        stopCodeGraphHeartbeat();
      }
      if (!result) {
        throw new Error('Code graph build did not return a result.');
      }
      await persistCodeGraphProgressArtifact(codeGraphProgressPath, {
        runId: reconRunId,
        projectName,
        projectRoot: sourceRoot,
        outputDir,
        status: 'completed',
        phase: 'Source import complete',
        startedAt: reconRunState.codeGraphStartedAt ?? reconRunState.startedAt,
        updatedAt: new Date().toISOString(),
        astArtifactPath: result.astPath,
        astFileCount: result.analysis.javaAstCatalog.length,
        codeGraphArtifactPath: result.codeKnowledgeGraphPath,
        progress: {
          phase: 'complete',
          message: 'Source import complete',
        },
        events: [
          {
            at: new Date().toISOString(),
            phase: 'complete',
            message: 'Source import complete',
          },
        ],
      });

      report('Building reconnaissance prompt from MCP...');
      const reconResponse = await registry.callTool('semanticCore', 'generate_reconnaissance_prompt', {
        analysis: result.analysis,
        moduleDossiers: result.analysis.moduleDossiers ?? [],
      });
      const reconPayload = asReconnaissancePayload(reconResponse.json);
      await fs.writeFile(result.reconnaissancePath, JSON.stringify(reconPayload, null, 2) + '\n', 'utf8');
      await fs.writeFile(result.reconnaissancePromptPath, `${reconPayload.projectPrompt ?? ''}\n`, 'utf8');
      for (const modulePrompt of reconPayload.modulePrompts ?? []) {
        outputChannel.appendLine(`[source-to-semantic] recon module ${modulePrompt.moduleRoot}`);
      }

      outputChannel.appendLine(`[source-to-semantic] wrote ${result.semanticPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.semanticJsonPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.enrichmentPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.enrichmentSchemaPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.astPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.codeKnowledgeGraphPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.codeKnowledgeGraphMdPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.reconnaissancePath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.reconnaissancePromptPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.databaseSchemaPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.databaseSchemaMdPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${result.graphPath}`);
      const semanticDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(result.semanticPath));
      const sourceHash = hashArtifactContent(await fs.readFile(result.semanticPath, 'utf8'));
      if (outputDir) {
        await writeVersionedArtifact({
          artifactRoot: outputDir,
          kind: 'semantic',
          baseName: slug(result.semanticPath),
          sourcePath: result.semanticPath,
          sourceHash,
          label: 'imported semantic',
          files: {
            'semantic.md': `${await fs.readFile(result.semanticPath, 'utf8')}\n`,
            'semantic.json': `${await fs.readFile(result.semanticJsonPath, 'utf8')}`,
            'analysis.json': `${await fs.readFile(result.analysisPath, 'utf8')}`,
          },
          metadata: {
            databaseSchemaPath: result.databaseSchemaPath,
            graphPath: result.graphPath,
          },
        });
        await writeVersionedArtifact({
          artifactRoot: outputDir,
          kind: 'databaseSchema',
          baseName: slug(result.semanticPath),
          sourcePath: result.semanticPath,
          sourceHash,
          label: 'import database schema',
          files: {
            'database.schema.json': `${await fs.readFile(result.databaseSchemaPath, 'utf8')}`,
            'database.schema.md': `${await fs.readFile(result.databaseSchemaMdPath, 'utf8')}`,
          },
          metadata: {
            semanticPath: result.semanticPath,
            graphPath: result.graphPath,
          },
        });
      }

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
      if (outputDir) {
        await writeVersionedArtifact({
          artifactRoot: outputDir,
          kind: 'validation',
          baseName: slug(result.semanticPath),
          sourcePath: result.semanticPath,
          sourceHash,
          label: 'import validation',
          files: {
            'validation.md': [
              '# AI Native Validation',
              '',
              `- Source: ${result.semanticPath}`,
              `- MCP report path: ${validationPayload.reportPath ?? 'n/a'}`,
              `- MCP summary: gaps=${validationPayload.summary.gaps}, conflicts=${validationPayload.summary.conflicts}, warnings=${validationPayload.summary.warnings}, violations=${validationPayload.summary.violations}`,
              '',
              '## MCP issues',
              ...(validationPayload.issues.length
                ? validationPayload.issues.map((issue) => `- [${issue.severity ?? 'info'}] ${issue.code ?? 'issue'}: ${issue.message ?? ''}`)
                : ['- none']),
              '',
              '## Retraining delta',
              `- missing sections: ${buildValidationDelta({
                sourcePath: result.semanticPath,
                reportPath: validationPayload.reportPath,
                validationPolicyLoadedFrom: 'mcp-validator:get_validation_policy',
                graph: asGraphObject(validationPayload.graph),
                summary: validationPayload.summary,
                issues: validationPayload.issues,
              }).missingSections.join(', ') || 'none'}`,
            ].join('\n') + '\n',
          },
          metadata: {
            reportPath: validationPayload.reportPath,
            summary: validationPayload.summary,
            validationPolicyLoadedFrom: 'mcp-validator:get_validation_policy',
          },
        });
      }

      const config = getConfig();
      await updateReconRunState((state) => {
        state.astStatus = 'completed';
        state.astFinishedAt = new Date().toISOString();
        state.astArtifactPath = result.astPath;
        state.astFileCount = result.analysis.javaAstCatalog.length;
        state.codeGraphStatus = 'completed';
        state.codeGraphStartedAt ??= new Date().toISOString();
        state.codeGraphFinishedAt = new Date().toISOString();
        state.codeGraphArtifactPath = result.codeKnowledgeGraphPath;
        state.analysisStatus = 'completed';
        state.analysisFinishedAt ??= new Date().toISOString();
        state.analysisPhase = 'Deterministic analysis, snapshot, and artifact indexing completed.';
        state.phase = 'Deterministic graph bundle prepared; recon prompt received from MCP';
        state.events?.push(
          {
            at: new Date().toISOString(),
            kind: 'artifact',
            message: `AST catalog written to ${path.basename(result.astPath)}`,
          },
          {
            at: new Date().toISOString(),
            kind: 'artifact',
            message: `Code knowledge graph written to ${path.basename(result.codeKnowledgeGraphPath)}`,
          },
        );
        state.events = state.events?.slice(-20);
        state.projectPromptStatus = reconPayload.projectPrompt?.trim() ? 'pending' : 'completed';
        state.projectPromptSummary = reconPayload.projectPrompt?.trim() ? undefined : 'No project-level prompt was returned by MCP.';
        state.moduleRuns = (reconPayload.modulePrompts ?? [])
          .filter((modulePrompt) => Boolean(modulePrompt.prompt?.trim()))
          .map((modulePrompt) => ({
            moduleRoot: modulePrompt.moduleRoot ?? '.',
            status: 'pending' as const,
          }));
        state.events?.push({
          at: new Date().toISOString(),
          kind: 'phase',
          message: reconPayload.projectPrompt?.trim()
            ? 'Deterministic artifacts are ready; recon prompt received from MCP and ready to dispatch agents.'
            : 'Deterministic artifacts are ready; no project-level prompt returned, module agents will run only.',
        });
        state.events = state.events?.slice(-20);
      });

      const reconBaseContext = {
        provider: config.reviewProvider,
        mode: config.reviewMode,
        model: config.reviewModel,
        endpoint: config.reviewEndpoint,
        commandId: config.reviewCommandId,
        commandArgsJson: config.reviewCommandArgsJson,
        promptFileName: config.reviewPromptFileName,
        workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        semanticSource: semanticText,
        javaAstCatalog: result.analysis.javaAstCatalog,
        codeKnowledgeGraph: result.codeKnowledgeGraph,
        expectationDocuments: [{ path: 'mcp-validation-policy.md', content: validationPolicy }],
        graph: result.graph,
        validation: {
          status: deriveValidationStatus(validationPayload.summary),
          summary: validationPayload.summary,
          issues: validationPayload.issues,
        },
      };

      const appendReconEvent = async (
        kind: 'phase' | 'project' | 'module' | 'artifact' | 'error',
        message: string,
        moduleRoot?: string,
      ): Promise<void> => {
        await updateReconRunState((state) => {
          state.events ??= [];
          state.events.push({
            at: new Date().toISOString(),
            kind,
            message,
            moduleRoot,
          });
          state.events = state.events.slice(-20);
        });
      };

      const runReconstructionPrompt = async (
        sourcePath: string,
        artifactName: string,
        prompt: string,
        artifactDir: string,
        moduleRoot?: string,
      ): Promise<AgenticReviewResult> => {
        report(`Running AI reconnaissance with ${config.reviewProvider}: ${artifactName}`);
        await updateReconRunState((state) => {
          state.activeTask = artifactName;
          state.activeModuleRoot = moduleRoot;
          if (moduleRoot) {
            const module = state.moduleRuns.find((entry) => entry.moduleRoot === moduleRoot);
            if (module) {
              module.status = 'running';
              module.startedAt = new Date().toISOString();
            }
            state.phase = `Recon agent running for ${artifactName}`;
          } else {
            state.projectPromptStatus = 'running';
            state.projectPromptStartedAt = new Date().toISOString();
            state.phase = 'Project reconnaissance agent running';
          }
        });
        await appendReconEvent(moduleRoot ? 'module' : 'project', `Started recon agent for ${artifactName}`, moduleRoot);

        try {
          const runContext = {
            ...reconBaseContext,
            sourcePath,
            artifactName,
            artifactDir,
          };
          const result = await runAgenticPrompt(runContext, prompt);
          if (moduleRoot) {
            await updateReconRunState((state) => {
              state.activeTask = artifactName;
              state.activeModuleRoot = moduleRoot;
              const module = state.moduleRuns.find((entry) => entry.moduleRoot === moduleRoot);
              if (module) {
                module.status = 'completed';
                module.finishedAt = new Date().toISOString();
                module.summary = result.summary;
                module.bridgeAction = result.bridgeAction;
                module.artifactPath = result.reviewArtifactPath;
                module.promptPath = result.promptArtifactPath;
                module.notes = result.notes;
                module.issues = result.issues.length;
                delete module.error;
              }
              state.phase = `Recon agent finished for ${artifactName}`;
            });
            await appendReconEvent(
              'artifact',
              `Completed recon agent for ${artifactName}${result.reviewArtifactPath ? ` → ${path.basename(result.reviewArtifactPath)}` : ''}`,
              moduleRoot,
            );
          } else {
            await updateReconRunState((state) => {
              state.activeTask = artifactName;
              state.activeModuleRoot = moduleRoot;
              state.projectPromptStatus = 'completed';
              state.projectPromptFinishedAt = new Date().toISOString();
              state.projectPromptSummary = result.summary;
              state.projectPromptBridge = result.bridgeAction;
              state.projectPromptArtifactPath = result.reviewArtifactPath;
              state.phase = 'Project reconnaissance agent completed';
            });
            await appendReconEvent('artifact', `Completed project reconnaissance → ${path.basename(result.reviewArtifactPath ?? 'review.md')}`);
          }
          outputChannel.appendLine(`[source-to-semantic-recon] ${artifactName}`);
          outputChannel.appendLine(`  bridge: ${result.bridgeAction}`);
          outputChannel.appendLine(`  summary: ${result.summary}`);
          for (const note of result.notes) {
            outputChannel.appendLine(`  note: ${note}`);
          }
          if (result.issues.length > 0) {
            outputChannel.appendLine(`  issues: ${result.issues.length}`);
          }
          if (result.reviewArtifactPath) {
            outputChannel.appendLine(`  review artifact: ${result.reviewArtifactPath}`);
          }
          if (result.promptArtifactPath) {
            outputChannel.appendLine(`  prompt artifact: ${result.promptArtifactPath}`);
          }
          return result;
        } catch (error) {
          await updateReconRunState((state) => {
            state.activeTask = artifactName;
            state.activeModuleRoot = moduleRoot;
            if (moduleRoot) {
              const module = state.moduleRuns.find((entry) => entry.moduleRoot === moduleRoot);
              if (module) {
                module.status = 'failed';
                module.finishedAt = new Date().toISOString();
                module.error = String(error);
              }
              state.phase = `Recon agent failed for ${artifactName}`;
            } else {
              state.projectPromptStatus = 'failed';
              state.projectPromptFinishedAt = new Date().toISOString();
              state.phase = 'Project reconnaissance agent failed';
            }
          });
          await appendReconEvent('error', `Recon agent failed for ${artifactName}: ${String(error)}`, moduleRoot);
          throw error;
        }
      };

      const projectReconPromise = reconPayload.projectPrompt?.trim()
        ? runReconstructionPrompt(result.semanticPath, 'project', reconPayload.projectPrompt, reconProjectArtifactsDir).catch((error) => {
            outputChannel.appendLine(`[source-to-semantic-recon] project failed: ${String(error)}`);
            return undefined;
          })
        : Promise.resolve(undefined);
      const moduleReconPromises = (reconPayload.modulePrompts ?? [])
        .filter((modulePrompt) => Boolean(modulePrompt.prompt?.trim()))
        .map((modulePrompt) => {
          const moduleRoot = modulePrompt.moduleRoot ?? '.';
          const moduleArtifactName = moduleRoot === '.' ? projectName : moduleRoot;
          const moduleArtifactDir = path.join(reconModuleArtifactsDir, slug(moduleArtifactName));
          return runReconstructionPrompt(
            path.join(sourceRoot, moduleRoot),
            moduleArtifactName,
            modulePrompt.prompt ?? '',
            moduleArtifactDir,
            moduleRoot,
          ).catch(async (error) => {
            await updateReconRunState((state) => {
              const module = state.moduleRuns.find((entry) => entry.moduleRoot === moduleRoot);
              if (module) {
                module.status = 'failed';
                module.finishedAt = new Date().toISOString();
                module.error = String(error);
              }
              state.phase = `Recon agent failed for ${moduleArtifactName}`;
            });
            return undefined;
        });
      });

      const reviewPromptBundle = await loadReviewPromptBundle(registry, {
        sourcePath: result.semanticPath,
        projectRoot: result.projectRoot,
        semanticSource: semanticText,
        graph: result.graph,
        enrichment: result.enrichment,
        validation: {
          status: deriveValidationStatus(validationPayload.summary),
          summary: validationPayload.summary,
          issues: validationPayload.issues,
        },
        expectationDocuments: [{ path: 'mcp-validation-policy.md', content: validationPolicy }],
      });

      const [agenticReview, projectReconResult, moduleReconResults] = await Promise.all([
        runAgenticReviewBundle({
          ...reconBaseContext,
          sourcePath: result.semanticPath,
        }, reviewPromptBundle),
        projectReconPromise,
        Promise.allSettled(moduleReconPromises),
      ]);

      const settledModuleResults = moduleReconResults
        .map((entry) => (entry.status === 'fulfilled' ? entry.value : undefined))
        .filter((value): value is AgenticReviewResult => Boolean(value));

      if (projectReconResult) {
        outputChannel.appendLine(`[source-to-semantic] project reconnaissance artifact: ${projectReconResult.reviewArtifactPath ?? 'n/a'}`);
      }
      outputChannel.appendLine(`[source-to-semantic] module reconnaissance runs: ${settledModuleResults.length}`);
      if (settledModuleResults.length > 0) {
        const moduleReconIndexPath = path.join(reconRunDir, 'modules.index.json');
        await fs.writeFile(
          moduleReconIndexPath,
          JSON.stringify(
            settledModuleResults.map((entry) => ({
              artifactPath: entry.reviewArtifactPath,
              provider: entry.provider,
              mode: entry.mode,
              model: entry.model,
              bridgeAction: entry.bridgeAction,
              summary: entry.summary,
              notes: entry.notes,
              issues: entry.issues,
            })),
            null,
            2,
          ) + '\n',
          'utf8',
        );
        outputChannel.appendLine(`[source-to-semantic] wrote ${moduleReconIndexPath}`);
      }

      await updateReconRunState((state) => {
        state.status = 'completed';
        state.phase = 'Reconnaissance complete';
        state.finishedAt = new Date().toISOString();
        state.activeTask = undefined;
        state.activeModuleRoot = undefined;
      });
      await appendReconEvent('phase', 'Reconnaissance complete');

      const reviewMarkdownPath = path.join(outputDir, 'source.review.md');
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
      if (outputDir) {
        await writeVersionedArtifact({
          artifactRoot: outputDir,
          kind: 'review',
          baseName: slug(result.semanticPath),
          sourcePath: result.semanticPath,
          sourceHash,
          label: 'import review',
          files: {
            'review.md': [
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
            ].join('\n') + '\n',
          },
          metadata: {
            reviewedAt: new Date().toISOString(),
            summary: agenticReview.summary,
            provider: agenticReview.provider,
            mode: agenticReview.mode,
          },
        });
      }

      const reviewArtifactPath = reviewMarkdownPath;
      if (agenticReview.refinedSemanticMarkdown) {
        const reviewedSemanticPath = path.join(outputDir, 'source.semantic.reviewed.md');
        await fs.writeFile(reviewedSemanticPath, agenticReview.refinedSemanticMarkdown, 'utf8');
        if (result.createdSemantic) {
          await fs.writeFile(result.semanticPath, agenticReview.refinedSemanticMarkdown, 'utf8');
        }
        if (outputDir) {
          await writeVersionedArtifact({
            artifactRoot: outputDir,
            kind: 'semantic',
            baseName: slug(result.semanticPath),
            sourcePath: result.semanticPath,
            sourceHash: hashArtifactContent(agenticReview.refinedSemanticMarkdown),
            label: 'reviewed semantic',
            files: {
              'semantic.reviewed.md': `${agenticReview.refinedSemanticMarkdown}\n`,
            },
            metadata: {
              reviewedAt: new Date().toISOString(),
              reviewSummary: agenticReview.summary,
            },
          });
        }
        outputChannel.appendLine(`[source-to-semantic] wrote ${reviewedSemanticPath}`);
      }

      const reviewedGraph = applyReviewToGraph(result.graph, agenticReview);
      const reviewedGraphPath = path.join(outputDir, 'source.graph.reviewed.json');
      await fs.writeFile(reviewedGraphPath, JSON.stringify(reviewedGraph, null, 2) + '\n', 'utf8');
      if (outputDir) {
        await writeVersionedArtifact({
          artifactRoot: outputDir,
          kind: 'graph',
          baseName: slug(result.semanticPath),
          sourcePath: result.semanticPath,
          sourceHash,
          label: 'import reviewed graph',
          files: {
            'graph.json': JSON.stringify(reviewedGraph, null, 2) + '\n',
          },
          metadata: {
            reviewedAt: new Date().toISOString(),
            reviewSummary: agenticReview.summary,
          },
        });
      }
      outputChannel.appendLine(`[source-to-semantic] wrote ${reviewedGraphPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${reviewArtifactPath}`);
      outputChannel.appendLine(`[source-to-semantic] wrote ${reviewMarkdownPath}`);
      outputChannel.appendLine(
        `[source-to-semantic-review] provider=${agenticReview.provider} mode=${agenticReview.mode} model=${agenticReview.model}`,
      );
      outputChannel.appendLine(`  bridge: ${agenticReview.bridgeAction}`);
      outputChannel.appendLine(`  summary: ${agenticReview.summary}`);
      outputChannel.appendLine(`  recon modules: ${reconPayload.modulePrompts?.length ?? 0}`);
      outputChannel.appendLine(`[source-to-semantic] recon run: ${reconRunId}`);
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
    const graphRecord = await readLatestVersionedArtifact(outputDir, 'graph', slug(semanticPath.fsPath));
    const graphPath = graphRecord?.files['graph.json'] ?? path.join(outputDir, 'source.graph.reviewed.json');
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
  await vscode.window.showInformationMessage('Imported source workspace into .ai-native');
}

interface JavaParserProjectPayload {
  fileCount?: number;
  catalog?: JavaAstFile[];
  summary?: {
    statistics?: {
      nodes?: number;
      namedNodes?: number;
      types?: number;
      fields?: number;
      methods?: number;
    };
  };
  [key: string]: unknown;
}

async function collectWorkspaceJavaAstProject(
  registry: McpRegistry,
  sourceRoot: string,
  projectName: string,
): Promise<JavaParserProjectPayload | undefined> {
  const javaFiles = await vscode.workspace.findFiles(
    new vscode.RelativePattern(sourceRoot, '**/*.java'),
    '**/{node_modules,target,build,dist,out,.git,.ai-native}/**',
  );

  if (!javaFiles.length) {
    return undefined;
  }

  const pomFiles = await vscode.workspace.findFiles(
    new vscode.RelativePattern(sourceRoot, '**/pom.xml'),
    '**/{node_modules,target,build,dist,out,.git,.ai-native}/**',
  );
  const applicationRoots = detectApplicationRootsFromPomFiles(sourceRoot, pomFiles);
  const fileGroups = groupJavaFilesByApplicationRoot(sourceRoot, javaFiles, applicationRoots);

  const payloads: JavaParserProjectPayload[] = [];
  for (const [appRoot, uris] of fileGroups) {
    const files = await Promise.all(
      uris.map(async (uri) => ({
        path: path.relative(sourceRoot, uri.fsPath).split(path.sep).join('/'),
        content: await fs.readFile(uri.fsPath, 'utf8'),
      })),
    );
    const response = await registry.callTool('javaParser', 'scan_java_project', {
      projectName: appRoot === '.' ? projectName : `${projectName}:${appRoot}`,
      projectRoot: sourceRoot,
      files,
      includeTree: false,
      maxDepth: 6,
    });
    const payload = response.json as JavaParserProjectPayload | undefined;
    if (payload && Array.isArray(payload.catalog)) {
      payloads.push(payload);
    }
  }

  if (!payloads.length) {
    return undefined;
  }

  return {
    fileCount: payloads.reduce((sum, payload) => sum + Number(payload.fileCount ?? payload.catalog?.length ?? 0), 0),
    catalog: payloads.flatMap((payload) => payload.catalog ?? []),
    summary: {
      statistics: payloads.reduce<{ nodes: number; namedNodes: number; types: number; fields: number; methods: number }>((acc, payload) => ({
        nodes: acc.nodes + Number(payload.summary?.statistics?.nodes ?? 0),
        namedNodes: acc.namedNodes + Number(payload.summary?.statistics?.namedNodes ?? 0),
        types: acc.types + Number(payload.summary?.statistics?.types ?? 0),
        fields: acc.fields + Number(payload.summary?.statistics?.fields ?? 0),
        methods: acc.methods + Number(payload.summary?.statistics?.methods ?? 0),
      }), { nodes: 0, namedNodes: 0, types: 0, fields: 0, methods: 0 }),
    },
  };
}

function detectApplicationRootsFromPomFiles(sourceRoot: string, pomFiles: vscode.Uri[]): string[] {
  const moduleDirs = pomFiles
    .map((uri) => path.relative(sourceRoot, path.dirname(uri.fsPath)).split(path.sep).join('/'))
    .filter((value) => value && value !== '.');
  if (!moduleDirs.length) {
    return ['.'];
  }
  const roots = [...new Set(moduleDirs.map((value) => value.split('/')[0]).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  return roots.length ? roots : ['.'];
}

function groupJavaFilesByApplicationRoot(
  sourceRoot: string,
  javaFiles: vscode.Uri[],
  applicationRoots: string[],
): Map<string, vscode.Uri[]> {
  const grouped = new Map<string, vscode.Uri[]>();
  for (const root of applicationRoots) {
    grouped.set(root, []);
  }
  for (const uri of javaFiles) {
    const relativePathName = path.relative(sourceRoot, uri.fsPath).split(path.sep).join('/');
    const matchedRoot = applicationRoots.find((root) => root === '.' ? true : relativePathName === root || relativePathName.startsWith(`${root}/`)) ?? applicationRoots[0] ?? '.';
    grouped.get(matchedRoot)?.push(uri);
  }
  return new Map([...grouped.entries()].filter(([, uris]) => uris.length > 0));
}

async function loadReviewPromptBundle(
  registry: McpRegistry,
  context: {
    sourcePath: string;
    projectRoot?: string;
    semanticSource: string;
    graph: unknown;
    enrichment?: EnrichmentOutput;
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
    expectationDocuments: Array<{ path: string; content: string }>;
  },
): Promise<ReviewPromptBundle> {
  const graphObject = context.graph && typeof context.graph === 'object' ? context.graph as { metadata?: { preview?: Record<string, unknown> } } : undefined;
  const componentMap = context.projectRoot
    ? await readJsonIfExists(path.join(path.dirname(context.sourcePath), 'source.component-map.json'))
    : undefined;
  const flowMap = context.projectRoot
    ? await readJsonIfExists(path.join(path.dirname(context.sourcePath), 'source.flow-map.json'))
    : undefined;
  const localAgentOutputs = context.projectRoot
    ? await runValidationTriageIfConfigured(context.projectRoot, context.graph, context.validation, componentMap, flowMap)
    : [];
  const reviewDossier = buildReviewDossier({
    sourcePath: context.sourcePath,
    graph: context.graph,
    preview: graphObject?.metadata?.preview,
    componentMap,
    flowMap,
    enrichment: context.enrichment,
    localAgentOutputs,
    validation: context.validation,
  });
  if (context.projectRoot) {
    await writeReviewDossier(context.projectRoot, reviewDossier);
  }
  const response = await registry.callTool('semanticCore', 'generate_review_prompt_bundle', {
    sourcePath: context.sourcePath,
    semanticSource: context.semanticSource,
    graph: context.graph,
    reviewDossier,
    validation: context.validation,
    expectationDocuments: context.expectationDocuments,
  });
  const payload = asObject(response.json);
  const bundle = {
    promptVersion: typeof payload?.promptVersion === 'string' ? payload.promptVersion : '1.0.0',
    architecturePrompt: String(payload?.architecturePrompt ?? ''),
    flowPrompt: String(payload?.flowPrompt ?? ''),
    dataModelPrompt: String(payload?.dataModelPrompt ?? ''),
    consistencyPrompt: String(payload?.consistencyPrompt ?? ''),
    mergePrompt: String(payload?.mergePrompt ?? ''),
  };
  if (!bundle.architecturePrompt.trim() || !bundle.flowPrompt.trim() || !bundle.dataModelPrompt.trim() || !bundle.consistencyPrompt.trim() || !bundle.mergePrompt.trim()) {
    throw new Error('semantic-core returned an incomplete review prompt bundle.');
  }
  return bundle;
}

async function readJsonIfExists(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

async function runValidationTriageIfConfigured(
  projectRoot: string,
  graph: unknown,
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
  },
  componentMap: unknown,
  flowMap: unknown,
) {
  await runLocalAgentRole({
    projectRoot,
    role: 'validationTriage',
    prompt: buildValidationTriagePrompt(projectRoot, graph, validation, componentMap, flowMap),
  });
  return await readLocalAgentOutputs(projectRoot);
}

function buildValidationTriagePrompt(
  projectRoot: string,
  graph: unknown,
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
  },
  componentMap: unknown,
  flowMap: unknown,
): string {
  const graphObject = graph && typeof graph === 'object' ? graph as { metadata?: Record<string, unknown>; nodes?: unknown[]; edges?: unknown[] } : undefined;
  const preview = graphObject?.metadata?.preview;
  return [
    'You are validation-triage-agent.',
    'Group and prioritize validation issues for downstream cloud review.',
    'Use only deterministic graph summaries, preview/component/flow artifacts and validation issues.',
    'Do not modify the graph.',
    'Return JSON only as { "triageGroups": [...] }.',
    'Every triage group must include agentId, applicationId, model, confidence, evidence, warnings, severity, category, summary, affectedItems and recommendedAction.',
    '',
    JSON.stringify({
      applicationId: path.basename(projectRoot),
      graph: {
        title: graphObject?.metadata?.title,
        nodeCount: Array.isArray(graphObject?.nodes) ? graphObject.nodes.length : 0,
        edgeCount: Array.isArray(graphObject?.edges) ? graphObject.edges.length : 0,
        preview,
      },
      componentMap,
      flowMap,
      validation,
    }, null, 2),
  ].join('\n');
}

async function loadCachedJavaAstProject(astPath: string): Promise<JavaParserProjectPayload | undefined> {
  try {
    const text = await fs.readFile(astPath, 'utf8');
    const payload = JSON.parse(text) as JavaParserProjectPayload;
    return payload && Array.isArray(payload.catalog) ? payload : undefined;
  } catch {
    return undefined;
  }
}

function normalizeResumeStage(stage?: string): 'ast' | 'analysis' | 'snapshot' | 'graph' | 'prompt' | 'modules' | 'semantic' | undefined {
  const normalized = stage?.toLowerCase().trim();
  if (!normalized) return undefined;
  if (normalized.includes('ast')) return 'ast';
  if (normalized.includes('analysis')) return 'analysis';
  if (normalized.includes('snapshot')) return 'snapshot';
  if (normalized.includes('deterministic analysis')) return 'analysis';
  if (normalized.includes('deterministic graph') || normalized.includes('code graph') || normalized.includes('graph bundle') || normalized.includes('graph')) return 'graph';
  if (normalized.includes('local enrichment')) return 'graph';
  if (normalized.includes('recon prompt') || normalized.includes('project prompt') || normalized.includes('prompt')) return 'prompt';
  if (normalized.includes('module') || normalized.includes('recon prompts and agents')) return 'modules';
  if (normalized.includes('semantic')) return 'semantic';
  return undefined;
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
  return document.fileName.endsWith('.semantic.md') || path.basename(document.fileName) === 'source.semantic.md';
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
  metadata?: {
    title?: string;
    sourcePath?: string;
    createdAt?: string;
    reviewedAt?: string;
    databaseSchema?: NonNullable<AgenticDiagramClassification['databaseSchema']>;
    review?: {
      diagramClassification?: AgenticDiagramClassification;
    };
  };
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
          reviewedAt: typeof asObject(object.metadata)?.reviewedAt === 'string' ? (asObject(object.metadata)?.reviewedAt as string) : undefined,
          databaseSchema: asObject(object.metadata)?.databaseSchema as NonNullable<AgenticDiagramClassification['databaseSchema']> | undefined,
          review: asObject(object.metadata)?.review as { diagramClassification?: AgenticDiagramClassification } | undefined,
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

function asReconnaissancePayload(
  value: unknown,
): {
  projectPrompt?: string;
  modulePrompts?: Array<{ moduleRoot?: string; prompt?: string }>;
} {
  const object = asObject(value) ?? {};
  return {
    projectPrompt: typeof object.projectPrompt === 'string' ? object.projectPrompt : undefined,
    modulePrompts: Array.isArray(object.modulePrompts)
      ? (object.modulePrompts as Array<{ moduleRoot?: string; prompt?: string }>).map((item) => ({
          moduleRoot: typeof item.moduleRoot === 'string' ? item.moduleRoot : undefined,
          prompt: typeof item.prompt === 'string' ? item.prompt : undefined,
        }))
      : [],
  };
}

function asValidationPayload(
  value: unknown,
): {
  reportPath?: string;
  issues: Array<{ severity?: string; code?: string; message?: string; sourceRef?: string; sourceLine?: number; sourceColumn?: number; nodeId?: string }>;
  summary: { gaps: number; conflicts: number; warnings: number; violations: number };
  graph: unknown;
} {
  const object = asObject(value) ?? {};
  const summaryObject = asObject(object.summary) ?? {};
  return {
    reportPath: typeof object.reportPath === 'string' ? object.reportPath : undefined,
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

async function persistReconRunState(
  state: ReconRunSnapshot,
  reconRunDir: string,
  outputDir: string,
): Promise<void> {
  await fs.mkdir(reconRunDir, { recursive: true });
  await fs.mkdir(path.join(outputDir, 'source.recon.runs'), { recursive: true });
  const currentPath = path.join(outputDir, 'source.recon.current.json');
  const statePath = path.join(reconRunDir, 'state.json');
  const snapshot = JSON.parse(JSON.stringify(state)) as ReconRunSnapshot;
  await fs.writeFile(currentPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  await fs.writeFile(statePath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
}

async function persistCodeGraphProgressArtifact(progressPath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(progressPath), { recursive: true });
  await fs.writeFile(progressPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function createReconRunId(projectName: string): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}.${slug(projectName)}`;
}
