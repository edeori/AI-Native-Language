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
    return [
      new WorkflowItem('Create semantic source template', 'Start a new Semantic Markdown file in a structured location.', vscode.TreeItemCollapsibleState.None, {
        command: commandIds.createSemanticSourceTemplate,
        title: 'Create semantic source template',
      }),
      new WorkflowItem('Open the example slice', 'Open the reference notes service example.', vscode.TreeItemCollapsibleState.None, {
        command: commandIds.openTutorial,
        title: 'Open example slice',
      }),
    ];
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
