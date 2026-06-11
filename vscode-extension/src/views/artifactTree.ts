import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveArtifactRoot } from '../workspaceArtifacts.js';
import { commandIds } from '../constants.js';

export class ArtifactTreeDataProvider implements vscode.TreeDataProvider<ArtifactTreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: ArtifactTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ArtifactTreeItem): Promise<ArtifactTreeItem[]> {
    if (!element) {
      const root = await resolveArtifactRoot();
      if (!root) {
        return [
          new ArtifactTreeItem('Open graph preview', 'Render the latest generated canonical graph.', vscode.TreeItemCollapsibleState.None, undefined, commandIds.openGraphPreview),
          new ArtifactTreeItem('Open artifact folder', 'Open a workspace to inspect generated outputs.', vscode.TreeItemCollapsibleState.None, undefined, commandIds.openArtifactsFolder),
        ];
      }

      const exists = await pathExists(root.fsPath);
      if (!exists) {
        return [
          new ArtifactTreeItem('Open graph preview', 'Render the latest generated canonical graph.', vscode.TreeItemCollapsibleState.None, undefined, commandIds.openGraphPreview),
          new ArtifactTreeItem('Open artifact folder', 'Browse local outputs.', vscode.TreeItemCollapsibleState.None, undefined, commandIds.openArtifactsFolder),
          new ArtifactTreeItem('No local artifacts yet', 'Run validation or generation to populate the review area.', vscode.TreeItemCollapsibleState.None),
        ];
      }

      const directoryItems = await this.readDirectory(root.fsPath);
      return [
        new ArtifactTreeItem('Open graph preview', 'Render the latest generated canonical graph.', vscode.TreeItemCollapsibleState.None, undefined, commandIds.openGraphPreview),
        new ArtifactTreeItem('Open artifact folder', 'Browse local outputs.', vscode.TreeItemCollapsibleState.None, undefined, commandIds.openArtifactsFolder),
        ...directoryItems,
      ];
    }

    if (element.kind !== 'directory') {
      return [];
    }

    if (!element.path) {
      return [];
    }

    return this.readDirectory(element.path);
  }

  private async readDirectory(directoryPath: string): Promise<ArtifactTreeItem[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch {
      return [];
    }

    return entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) =>
        new ArtifactTreeItem(
          entry.name,
          entry.isDirectory() ? 'directory' : 'file',
          entry.isDirectory() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
          path.join(directoryPath, entry.name),
        ),
      );
  }
}

class ArtifactTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly kind: 'directory' | 'file' | string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly path?: string,
    commandId?: string,
  ) {
    super(label, collapsibleState);
    this.description = kind;
    const resolvedPath = path;
    if (commandId) {
      this.command = {
        command: commandId,
        title: label,
      };
    } else if (kind === 'file' && resolvedPath) {
      this.command = {
        command: 'vscode.open',
        title: 'Open artifact file',
        arguments: [vscode.Uri.file(resolvedPath)],
      };
    }
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
