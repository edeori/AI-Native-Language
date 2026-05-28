import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { commandIds } from './constants.js';
import { getConfig } from './config.js';
import { McpRegistry } from './mcpRegistry.js';
import { WorkflowTreeDataProvider } from './views/workflowTree.js';
import { ArtifactTreeDataProvider } from './views/artifactTree.js';
import { TutorialTreeDataProvider } from './views/tutorialTree.js';
import { DashboardPanel } from './webviews/dashboard.js';
import { ConfigurationPanel } from './webviews/configuration.js';
import { resolveArtifactRoot } from './workspaceArtifacts.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('AI Native Semantic Workflow');
  context.subscriptions.push(outputChannel);

  const registry = new McpRegistry(outputChannel);
  context.subscriptions.push({
    dispose: () => {
      void registry.dispose();
    },
  });

  const workflowProvider = new WorkflowTreeDataProvider();
  const artifactProvider = new ArtifactTreeDataProvider();
  const tutorialProvider = new TutorialTreeDataProvider();

  const workflowView = vscode.window.createTreeView('aiNativeWorkflow', { treeDataProvider: workflowProvider });
  const artifactView = vscode.window.createTreeView('aiNativeArtifacts', { treeDataProvider: artifactProvider });
  const tutorialView = vscode.window.createTreeView('aiNativeTutorials', { treeDataProvider: tutorialProvider });
  context.subscriptions.push(workflowView, artifactView, tutorialView);

  const refreshViews = async (): Promise<void> => {
    workflowProvider.refresh();
    artifactProvider.refresh();
    tutorialProvider.refresh();
    const status = await registry.pingAll();
    outputChannel.appendLine(JSON.stringify({ event: 'refresh', status }, null, 2));
  };

  const openDashboard = async (): Promise<void> => {
    const status = await registry.pingAll();
    DashboardPanel.show(context.extensionUri, context, JSON.stringify(status, null, 2));
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(commandIds.openDashboard, openDashboard),
    vscode.commands.registerCommand(commandIds.openConfiguration, async () => {
      ConfigurationPanel.show(context);
    }),
    vscode.commands.registerCommand(commandIds.openTutorial, async () => {
      await vscode.commands.executeCommand('workbench.view.extension.aiNativeSemantic');
    }),
    vscode.commands.registerCommand(commandIds.refreshAll, refreshViews),
    vscode.commands.registerCommand(commandIds.showMcpStatus, async () => {
      const status = await registry.pingAll();
      outputChannel.show(true);
      outputChannel.appendLine(JSON.stringify(status, null, 2));
      await openDashboard();
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
      await runValidation(context, registry, outputChannel);
    }),
    vscode.commands.registerCommand(commandIds.generateCanonicalGraph, async () => {
      await runGraphGeneration(context, registry, outputChannel);
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
      await runValidation(context, registry, outputChannel, document);
    }),
  );

  await refreshViews();
}

export function deactivate(): void {}

async function runValidation(
  context: vscode.ExtensionContext,
  registry: McpRegistry,
  outputChannel: vscode.OutputChannel,
  document?: vscode.TextDocument,
): Promise<void> {
  const source = document ?? vscode.window.activeTextEditor?.document;
  if (!source) {
    vscode.window.showWarningMessage('Open a Semantic Markdown file first.');
    return;
  }

  const response = await registry.callTool('validator', 'validate_semantic_markdown', {
    path: source.uri.scheme === 'file' ? source.uri.fsPath : undefined,
    content: source.getText(),
    persist: true,
  });

  const payload = asObject(response.json);
  const artifactRoot = await resolveArtifactRoot();
  if (artifactRoot) {
    const validationFolder = vscode.Uri.joinPath(artifactRoot, 'validation');
    await vscode.workspace.fs.createDirectory(validationFolder);
    const outputPath = vscode.Uri.joinPath(validationFolder, `${slug(source.fileName)}.validation.json`);
    await vscode.workspace.fs.writeFile(outputPath, Buffer.from(response.text, 'utf8'));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(outputPath), { preview: false });
  }

  outputChannel.appendLine(JSON.stringify({ tool: 'validate_semantic_markdown', payload }, null, 2));
  await vscode.window.showInformationMessage('Validation completed.');
}

async function runGraphGeneration(
  context: vscode.ExtensionContext,
  registry: McpRegistry,
  outputChannel: vscode.OutputChannel,
  document?: vscode.TextDocument,
): Promise<void> {
  const source = document ?? vscode.window.activeTextEditor?.document;
  if (!source) {
    vscode.window.showWarningMessage('Open a Semantic Markdown file first.');
    return;
  }

  const response = await registry.callTool('semanticCore', 'generate_canonical_graph', {
    path: source.uri.scheme === 'file' ? source.uri.fsPath : undefined,
    content: source.getText(),
    persist: true,
  });

  const payload = asObject(response.json);
  const artifactRoot = await resolveArtifactRoot();
  if (artifactRoot) {
    const graphFolder = vscode.Uri.joinPath(artifactRoot, 'graph');
    await vscode.workspace.fs.createDirectory(graphFolder);
    const outputPath = vscode.Uri.joinPath(graphFolder, `${slug(source.fileName)}.graph.json`);
    await vscode.workspace.fs.writeFile(outputPath, Buffer.from(response.text, 'utf8'));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(outputPath), { preview: false });
  }

  outputChannel.appendLine(JSON.stringify({ tool: 'generate_canonical_graph', payload }, null, 2));
  await vscode.window.showInformationMessage('Graph generation completed.');
}

async function runSpringGeneration(
  context: vscode.ExtensionContext,
  registry: McpRegistry,
  outputChannel: vscode.OutputChannel,
  document?: vscode.TextDocument,
): Promise<void> {
  const source = document ?? vscode.window.activeTextEditor?.document;
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
    path: source.uri.scheme === 'file' ? source.uri.fsPath : undefined,
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

function isSemanticMarkdown(document: vscode.TextDocument): boolean {
  return document.fileName.endsWith('.md') || document.fileName.endsWith('.semantic.md');
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
