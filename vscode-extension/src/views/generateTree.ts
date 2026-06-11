import * as vscode from 'vscode';
import { commandIds } from '../constants.js';

export class GenerateTreeDataProvider implements vscode.TreeDataProvider<GenerateItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: GenerateItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: GenerateItem): GenerateItem[] {
    return [
      new GenerateItem('Open artifact folder', 'Browse the local output and validation artifacts.', vscode.TreeItemCollapsibleState.None, {
        command: commandIds.openArtifactsFolder,
        title: 'Open artifact folder',
      }),
    ];
  }
}

class GenerateItem extends vscode.TreeItem {
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
