import * as vscode from 'vscode';
import { commandIds } from '../constants.js';

export class TutorialTreeDataProvider implements vscode.TreeDataProvider<TutorialTreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: TutorialTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TutorialTreeItem): TutorialTreeItem[] {
    if (!element) {
      return [
        new TutorialTreeItem('Start here', 'Open the workflow overview and the repo README.', vscode.TreeItemCollapsibleState.Collapsed),
        new TutorialTreeItem('Semantic Markdown', 'Learn the recommended system-slice format.', vscode.TreeItemCollapsibleState.Collapsed),
        new TutorialTreeItem('MCP servers', 'Connect to remote semantic-core, validator, and compiler services.', vscode.TreeItemCollapsibleState.Collapsed),
        new TutorialTreeItem('Validation loop', 'Check gaps, contradictions, and security violations.', vscode.TreeItemCollapsibleState.Collapsed),
        new TutorialTreeItem('Code generation', 'Generate the Spring Boot skeleton and review the diff.', vscode.TreeItemCollapsibleState.Collapsed),
      ];
    }

    switch (element.label) {
      case 'Start here':
        return [
          new TutorialTreeItem('Open root README', 'High-level repo overview and distribution instructions.', vscode.TreeItemCollapsibleState.None, {
            command: 'vscode.open',
            title: 'Open README',
            arguments: [resolveRepoUri('README.md')],
          }),
          new TutorialTreeItem('Open bootstrap guide', 'Step-by-step setup and execution flow.', vscode.TreeItemCollapsibleState.None, {
            command: 'vscode.open',
            title: 'Open bootstrap guide',
            arguments: [resolveRepoUri('docs/BOOTSTRAP_GUIDE.md')],
          }),
        ];
      case 'Semantic Markdown':
        return [
          new TutorialTreeItem('Open the example semantic slice', 'Uses the document-processing reference artifact.', vscode.TreeItemCollapsibleState.None, {
            command: 'vscode.open',
            title: 'Open example',
            arguments: [resolveRepoUri('examples/document_processing_service.semantic.md')],
          }),
          new TutorialTreeItem('Validate the active document', 'Runs the validator MCP server on the current editor buffer.', vscode.TreeItemCollapsibleState.None, {
            command: commandIds.validateActiveSemanticMarkdown,
            title: 'Validate',
          }),
        ];
      case 'MCP servers':
        return [
          new TutorialTreeItem('Show MCP status', 'Checks remote connectivity to the containerized services.', vscode.TreeItemCollapsibleState.None, {
            command: commandIds.showMcpStatus,
            title: 'Show status',
          }),
          new TutorialTreeItem('Refresh all views', 'Reloads the tree views and dashboard.', vscode.TreeItemCollapsibleState.None, {
            command: commandIds.refreshAll,
            title: 'Refresh',
          }),
        ];
      case 'Validation loop':
        return [
          new TutorialTreeItem('Generate canonical graph', 'Produces the graph snapshot artifact from the current source.', vscode.TreeItemCollapsibleState.None, {
            command: commandIds.generateCanonicalGraph,
            title: 'Generate graph',
          }),
          new TutorialTreeItem('Open generated validation result', 'Inspect the validation artifact after a run.', vscode.TreeItemCollapsibleState.None, {
            command: commandIds.openDashboard,
            title: 'Open dashboard',
          }),
        ];
      case 'Code generation':
        return [
          new TutorialTreeItem('Generate Spring Boot skeleton', 'Creates the constrained Java 17+ scaffold.', vscode.TreeItemCollapsibleState.None, {
            command: commandIds.generateSpringBootSkeleton,
            title: 'Generate Spring Boot',
          }),
        ];
      default:
        return [];
    }
  }
}

function resolveRepoUri(relativePath: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return vscode.Uri.file(relativePath);
  }
  return vscode.Uri.joinPath(folder.uri, ...relativePath.split('/'));
}

class TutorialTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly descriptionText: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    command?: vscode.Command,
  ) {
    super(label, collapsibleState);
    this.description = descriptionText;
    this.command = command;
  }
}
