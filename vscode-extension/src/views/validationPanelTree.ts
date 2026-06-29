import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveArtifactRoot } from '../workspaceArtifacts.js';

type SectionKind = 'validation' | 'alignment';

interface SectionItem {
  type: 'section';
  kind: SectionKind;
  label: string;
}

interface ArtifactItem {
  type: 'artifact';
  kind: SectionKind;
  label: string;
  description: string;
  fsPath: string;
}

type PanelItem = SectionItem | ArtifactItem;

export class ValidationPanelTreeDataProvider implements vscode.TreeDataProvider<PanelItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: PanelItem): vscode.TreeItem {
    if (element.type === 'section') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = element.kind === 'alignment'
        ? new vscode.ThemeIcon('symbol-interface')
        : new vscode.ThemeIcon('checklist');
      item.contextValue = `section-${element.kind}`;
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.contextValue = `artifact-${element.kind}`;
    if (element.fsPath) {
      item.iconPath = new vscode.ThemeIcon('file');
      item.command = {
        command: 'aiNative.openMarkdownArtifactPreview',
        title: `Open ${element.label}`,
        arguments: [vscode.Uri.file(element.fsPath)],
      };
      item.resourceUri = vscode.Uri.file(element.fsPath);
    } else {
      item.iconPath = new vscode.ThemeIcon('info');
    }
    return item;
  }

  async getChildren(element?: PanelItem): Promise<PanelItem[]> {
    const root = await resolveArtifactRoot();
    if (!root) return [];

    if (!element) {
      return [
        { type: 'section', kind: 'validation', label: 'Semantic Validation' },
        { type: 'section', kind: 'alignment', label: 'Doc-Code Alignment' },
      ];
    }

    if (element.type === 'section') {
      return this.loadArtifacts(root.fsPath, element.kind);
    }

    return [];
  }

  private async loadArtifacts(rootPath: string, kind: SectionKind): Promise<ArtifactItem[]> {
    const ext = kind === 'alignment' ? '.alignment.md' : '.validation.md';
    const folder = path.join(rootPath, kind);
    let files: Array<{ name: string; fsPath: string; mtimeMs: number }> = [];

    try {
      const entries = await fs.readdir(folder, { withFileTypes: true });
      const stats = await Promise.all(
        entries
          .filter((e) => e.isFile() && e.name.endsWith(ext))
          .map(async (e) => {
            const fsPath = path.join(folder, e.name);
            const stat = await fs.stat(fsPath);
            return { name: e.name, fsPath, mtimeMs: stat.mtimeMs };
          }),
      );
      files = stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
      // folder doesn't exist yet
    }

    // Also check versioned artifacts under .ai-native/versions/{kind}/
    const versionsFolder = path.join(rootPath, 'versions', kind);
    try {
      const baseDirs = await fs.readdir(versionsFolder, { withFileTypes: true });
      for (const baseDir of baseDirs) {
        if (!baseDir.isDirectory()) continue;
        const versionDirs = await fs.readdir(path.join(versionsFolder, baseDir.name), { withFileTypes: true });
        for (const versionDir of versionDirs.filter((e) => e.isDirectory())) {
          const versionPath = path.join(versionsFolder, baseDir.name, versionDir.name);
          const versionFiles = await fs.readdir(versionPath, { withFileTypes: true });
          for (const f of versionFiles.filter((e) => e.isFile() && e.name.endsWith(ext))) {
            const fsPath = path.join(versionPath, f.name);
            const stat = await fs.stat(fsPath);
            files.push({ name: f.name, fsPath, mtimeMs: stat.mtimeMs });
          }
        }
      }
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
      // no versioned artifacts yet
    }

    if (files.length === 0) {
      return [{
        type: 'artifact',
        kind,
        label: kind === 'alignment' ? 'No alignment report yet' : 'No validation output yet',
        description: kind === 'alignment'
          ? 'Import documents first, then run Doc-Code Alignment'
          : 'Run Validate to create the first report',
        fsPath: '',
      }];
    }

    return files.slice(0, 10).map((f, i) => ({
      type: 'artifact' as const,
      kind,
      label: i === 0 ? (kind === 'alignment' ? 'Latest alignment report' : 'Latest validation output') : f.name,
      description: new Date(f.mtimeMs).toLocaleString(),
      fsPath: f.fsPath,
    }));
  }
}
