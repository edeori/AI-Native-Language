import * as vscode from 'vscode';
import { commandIds } from '../constants.js';

export class TutorialTreeDataProvider implements vscode.TreeDataProvider<ModelItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: ModelItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ModelItem): ModelItem[] {
    return [
      new ModelItem('Open the root README', 'Read the high-level workflow and usage overview.', vscode.TreeItemCollapsibleState.None, {
        command: 'vscode.open',
        title: 'Open README',
        arguments: [resolveRepoUri('README.md')],
      }),
      new ModelItem('Open the bootstrap guide', 'Read the setup and runtime instructions.', vscode.TreeItemCollapsibleState.None, {
        command: 'vscode.open',
        title: 'Open bootstrap guide',
        arguments: [resolveRepoUri('docs/BOOTSTRAP_GUIDE.md')],
      }),
      new ModelItem('Open the example semantic slice', 'Inspect a reference system slice before editing your own.', vscode.TreeItemCollapsibleState.None, {
        command: commandIds.openTutorial,
        title: 'Open example slice',
      }),
    ];
  }
}

function resolveRepoUri(relativePath: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return vscode.Uri.file(relativePath);
  }
  return vscode.Uri.joinPath(folder.uri, ...relativePath.split('/'));
}

class ModelItem extends vscode.TreeItem {
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
