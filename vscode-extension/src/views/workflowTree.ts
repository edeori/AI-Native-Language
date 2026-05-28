import * as vscode from 'vscode';
import { commandIds } from '../constants.js';

export class WorkflowTreeDataProvider implements vscode.TreeDataProvider<WorkflowItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: WorkflowItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: WorkflowItem): WorkflowItem[] {
    if (!element) {
      return [
        new WorkflowItem('1. Author Semantic Markdown', 'Write a system slice in .semantic.md or annotated Markdown.', vscode.TreeItemCollapsibleState.Collapsed),
        new WorkflowItem('2. Validate the slice', 'Run semantic and security validation against the active document.', vscode.TreeItemCollapsibleState.Collapsed),
        new WorkflowItem('3. Generate the graph', 'Convert the source into the canonical graph JSON artifact.', vscode.TreeItemCollapsibleState.Collapsed),
        new WorkflowItem('4. Generate Spring Boot', 'Create the constrained Java 17+ / Spring Boot scaffold.', vscode.TreeItemCollapsibleState.Collapsed),
        new WorkflowItem('5. Review diff and issues', 'Inspect gaps, contradictions, violations, and generated files.', vscode.TreeItemCollapsibleState.Collapsed),
      ];
    }

    switch (element.label) {
      case '1. Author Semantic Markdown':
        return [
          new WorkflowItem('Open the example system slice', 'Shows the reference document-processing slice.', vscode.TreeItemCollapsibleState.None, {
            command: commandIds.openTutorial,
            title: 'Open tutorial',
          }),
        ];
      case '2. Validate the slice':
        return [
          new WorkflowItem('Validate active file', 'Uses the validator MCP server and writes a validation artifact.', vscode.TreeItemCollapsibleState.None, {
            command: commandIds.validateActiveSemanticMarkdown,
            title: 'Validate active file',
          }),
        ];
      case '3. Generate the graph':
        return [
          new WorkflowItem('Generate canonical graph', 'Uses the semantic-core MCP server and persists the graph snapshot.', vscode.TreeItemCollapsibleState.None, {
            command: commandIds.generateCanonicalGraph,
            title: 'Generate graph',
          }),
        ];
      case '4. Generate Spring Boot':
        return [
          new WorkflowItem('Generate Spring Boot skeleton', 'Uses the compiler MCP server and writes the generated Java scaffold.', vscode.TreeItemCollapsibleState.None, {
            command: commandIds.generateSpringBootSkeleton,
            title: 'Generate Spring Boot skeleton',
          }),
        ];
      case '5. Review diff and issues':
        return [
          new WorkflowItem('Open dashboard', 'Review statuses, artifacts, and tutorial shortcuts in one place.', vscode.TreeItemCollapsibleState.None, {
            command: commandIds.openDashboard,
            title: 'Open dashboard',
          }),
          new WorkflowItem('Refresh all views', 'Reload the workflow, artifacts, and tutorial panels.', vscode.TreeItemCollapsibleState.None, {
            command: commandIds.refreshAll,
            title: 'Refresh views',
          }),
        ];
      default:
        return [];
    }
  }
}

class WorkflowItem extends vscode.TreeItem {
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
