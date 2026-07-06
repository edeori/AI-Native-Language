import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveArtifactRoot } from '../workspaceArtifacts.js';

interface SourceEntry {
  label: string;
  fileName: string;
  icon: string;
}

// The canonical "current" source artifacts, in display order. Each is the single
// live file at the artifact root — git already carries their history, so there is
// no per-version listing here (that used to be the versioned-artifact store).
const SOURCE_ENTRIES: SourceEntry[] = [
  { label: 'Current semantic source', fileName: 'source.semantic.md', icon: 'symbol-text' },
  { label: 'Current database schema', fileName: 'source.database.md', icon: 'symbol-field' },
  { label: 'Current review', fileName: 'source.review.md', icon: 'file' },
];

export class SourcesTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: vscode.ThemeIcon,
    command?: vscode.Command,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
    if (command) this.command = command;
  }
}

// Single "Sources" view that replaces the former Review / Semantic / Database
// Schema versioned-artifact views. It only ever shows the current canonical file
// for each source, opening it on click.
export class SourcesTreeDataProvider implements vscode.TreeDataProvider<SourcesTreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: SourcesTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SourcesTreeItem): Promise<SourcesTreeItem[]> {
    if (element) return [];

    const root = await resolveArtifactRoot();
    if (!root) {
      return [new SourcesTreeItem('Open a workspace first', 'no artifact root', new vscode.ThemeIcon('warning'))];
    }

    const items: SourcesTreeItem[] = [];
    for (const entry of SOURCE_ENTRIES) {
      const fullPath = path.join(root.fsPath, entry.fileName);
      if (!(await pathExists(fullPath))) continue;
      items.push(new SourcesTreeItem(
        entry.label,
        path.relative(root.fsPath, fullPath),
        new vscode.ThemeIcon(entry.icon),
        {
          command: 'vscode.open',
          title: `Open ${entry.label}`,
          arguments: [vscode.Uri.file(fullPath)],
        },
      ));
    }

    if (items.length === 0) {
      return [new SourcesTreeItem('No sources yet — run an import first', 'imports create source.semantic.md', new vscode.ThemeIcon('info'))];
    }
    return items;
  }
}

async function pathExists(fsPath: string): Promise<boolean> {
  try {
    await fs.access(fsPath);
    return true;
  } catch {
    return false;
  }
}
