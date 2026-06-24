import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveArtifactRoot } from '../workspaceArtifacts.js';
import { readVersionedArtifactIndex, type ArtifactVersionKind, type VersionedArtifactIndex } from '../versionedArtifacts.js';

type ArtifactTreeMode = 'markdown-only' | 'graph-preview' | 'all';

interface VersionedArtifactTreeOptions {
  mode?: ArtifactTreeMode;
}

export class VersionedArtifactTreeDataProvider implements vscode.TreeDataProvider<VersionedArtifactTreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly kind: ArtifactVersionKind,
    private readonly title: string,
    private readonly description: string,
    private readonly options: VersionedArtifactTreeOptions = {},
  ) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: VersionedArtifactTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: VersionedArtifactTreeItem): Promise<VersionedArtifactTreeItem[]> {
    console.debug?.(`[ai-native][${this.kind}] getChildren(${element?.kind ?? 'root'})`);
    const root = await resolveArtifactRoot();
    if (!root) {
      return [
        new VersionedArtifactTreeItem(
          this.title,
          this.description,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          new vscode.ThemeIcon('warning'),
        ),
      ];
    }

    if (!element) {
      const kindRoots = await findKindRoots(root.fsPath, this.kind);
      if (kindRoots.length === 0) {
        return await this.getFallbackItems(root);
      }

      const baseNames = await collectBaseNames(kindRoots);
      if (baseNames.length === 0) {
        return await this.getFallbackItems(root);
      }

      if (baseNames.length === 1) {
        const index = await findLatestIndex(this.kind, baseNames[0], kindRoots);
        if (!index) {
          return await this.getFallbackItems(root);
        }
        if (this.kind === 'validation' || this.kind === 'review') {
          return renderVersionItems(baseNames[0], index, this.kind, this.options);
        }
        const latest = index.records[index.records.length - 1];
        const files = filterFilesByMode(latest.files, this.kind, this.options.mode ?? 'all');
        const fileEntries = Object.entries(files).sort(([left], [right]) => left.localeCompare(right));
        const latestFile = fileEntries[0];
        if (!latestFile) {
          return [
            new VersionedArtifactTreeItem(
              baseNames[0],
              `${index.records.length} versions · no markdown files`,
              vscode.TreeItemCollapsibleState.Collapsed,
              undefined,
              new vscode.ThemeIcon('archive'),
              { baseName: baseNames[0] },
            ),
          ];
        }

        const [relativePath, fullPath] = latestFile;
        const label = this.kind === 'semantic'
          ? 'Current semantic source'
          : this.kind === 'databaseSchema'
            ? 'Current database schema'
            : path.basename(relativePath);
        const dirtyHint = this.kind === 'semantic' ? getDirtySemanticHintSync() : undefined;
        return [
          new VersionedArtifactTreeItem(
            label,
            [
              path.relative(root.fsPath, fullPath),
              `${index.records.length} version${index.records.length === 1 ? '' : 's'}`,
              latest.createdAt ? `latest ${latest.createdAt}` : '',
              dirtyHint ?? '',
            ]
              .filter(Boolean)
              .join(' · '),
            index.records.length > 1 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            {
              command: 'vscode.open',
              title: `Open ${label}`,
              arguments: [vscode.Uri.file(fullPath)],
            },
            this.kind === 'semantic'
              ? new vscode.ThemeIcon('symbol-text')
              : this.kind === 'databaseSchema'
                ? new vscode.ThemeIcon('symbol-field')
                : new vscode.ThemeIcon('file'),
            { baseName: baseNames[0] },
          ),
        ];
      }

      const sortedBaseNames = await sortBaseNamesByFreshness(this.kind, baseNames, kindRoots);
      return sortedBaseNames.flatMap(({ baseName, index }) => {
        if (!index || index.records.length === 0) {
          return [];
        }

        const latest = index.records[index.records.length - 1];
        const files = filterFilesByMode(latest.files, this.kind, this.options.mode ?? 'all');
        const fileEntries = Object.entries(files).sort(([left], [right]) => left.localeCompare(right));
        const latestFile = fileEntries[0];
        if (!latestFile) {
          return [
            new VersionedArtifactTreeItem(
              baseName,
              `${index.records.length} versions · no markdown files`,
              vscode.TreeItemCollapsibleState.Collapsed,
              undefined,
              new vscode.ThemeIcon('archive'),
              { baseName },
            ),
          ];
        }

        const [relativePath, fullPath] = latestFile;
        const label = this.kind === 'semantic'
          ? 'Current semantic source'
          : this.kind === 'databaseSchema'
            ? 'Current database schema'
            : path.basename(relativePath);
        const dirtyHint = this.kind === 'semantic' ? getDirtySemanticHintSync() : undefined;
        return [
          new VersionedArtifactTreeItem(
            label,
            [
              path.relative(root.fsPath, fullPath),
              `${index.records.length} version${index.records.length === 1 ? '' : 's'}`,
              latest.createdAt ? `latest ${latest.createdAt}` : '',
              dirtyHint ?? '',
            ]
              .filter(Boolean)
              .join(' · '),
            index.records.length > 1 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            {
              command: 'vscode.open',
              title: `Open ${label}`,
              arguments: [vscode.Uri.file(fullPath)],
            },
            this.kind === 'semantic'
              ? new vscode.ThemeIcon('symbol-text')
              : this.kind === 'databaseSchema'
                ? new vscode.ThemeIcon('symbol-field')
                : new vscode.ThemeIcon('file'),
            { baseName },
          ),
        ];
      });
    }

    if (element.kind === 'version') {
      const files = filterFilesByMode(element.files ?? {}, this.kind, this.options.mode ?? 'all');
      if ((this.options.mode ?? 'all') === 'graph-preview') {
        const firstFile = Object.entries(files)[0];
        if (!firstFile) {
          return [new VersionedArtifactTreeItem('No graph preview available', 'This version has no graph file.', vscode.TreeItemCollapsibleState.None)];
        }
        const [relativePath, fullPath] = firstFile;
        return [
          new VersionedArtifactTreeItem(
            'Open graph preview',
            relativePath,
            vscode.TreeItemCollapsibleState.None,
            {
              command: 'aiNative.openGraphPreview',
              title: 'Open graph preview',
              arguments: [vscode.Uri.file(fullPath)],
            },
            new vscode.ThemeIcon('graph'),
          ),
        ];
      }

      const fileEntries = Object.entries(files);
      if (fileEntries.length === 0) {
        return [new VersionedArtifactTreeItem('No markdown artifact files', 'This version has no markdown outputs.', vscode.TreeItemCollapsibleState.None)];
      }

      return fileEntries
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([relativePath, fullPath]) => {
          const label = relativePath.split('/').pop() ?? relativePath;
          return new VersionedArtifactTreeItem(
            label,
            relativePath,
            vscode.TreeItemCollapsibleState.None,
            {
              command: 'vscode.open',
              title: `Open ${label}`,
              arguments: [vscode.Uri.file(fullPath)],
            },
            new vscode.ThemeIcon('file'),
          );
        });
    }

    if (element.kind !== 'baseName') {
      return [];
    }

    const index = await findLatestIndex(this.kind, element.baseName ?? '', await findKindRoots(root.fsPath, this.kind));
    return renderVersionItems(element.baseName ?? '', index, this.kind, this.options);
  }

  private async getFallbackItems(root: vscode.Uri): Promise<VersionedArtifactTreeItem[]> {
    if (this.kind === 'semantic') {
      const canonicalSemantic = vscode.Uri.joinPath(root, 'source.semantic.md');
      if (await pathExists(canonicalSemantic)) {
        return [
          new VersionedArtifactTreeItem(
            'Current semantic source',
            'editable source · .ai-native/source.semantic.md',
            vscode.TreeItemCollapsibleState.None,
            {
              command: 'vscode.open',
              title: 'Open current semantic source',
              arguments: [canonicalSemantic],
            },
            new vscode.ThemeIcon('symbol-text'),
          ),
        ];
      }

      const sources = await findSemanticSourceFiles();
      if (sources.length > 0) {
        const active = vscode.window.activeTextEditor?.document;
        const orderedSources = sources.slice().sort((left, right) => {
          const leftActive = active?.fileName === left.fsPath ? 1 : 0;
          const rightActive = active?.fileName === right.fsPath ? 1 : 0;
          return rightActive - leftActive || left.fsPath.localeCompare(right.fsPath);
        });

        return orderedSources.map((source, index) => {
          const isActive = active?.fileName === source.fsPath;
          return new VersionedArtifactTreeItem(
            isActive ? 'Current semantic source' : path.basename(source.fsPath),
            [
              path.relative(root.fsPath, source.fsPath),
              isActive ? 'active' : 'source',
            ]
              .filter(Boolean)
              .join(' · '),
            vscode.TreeItemCollapsibleState.None,
            {
              command: 'vscode.open',
              title: `Open ${path.basename(source.fsPath)}`,
              arguments: [source],
            },
            new vscode.ThemeIcon(isActive || index === 0 ? 'symbol-text' : 'file'),
          );
        });
      }
      return [
        new VersionedArtifactTreeItem(
          'No semantic source found',
          'Open or create a *.semantic.md file to populate this view.',
          vscode.TreeItemCollapsibleState.None,
          undefined,
          new vscode.ThemeIcon('warning'),
        ),
      ];
    }

    if (this.kind === 'graph') {
      return [
        new VersionedArtifactTreeItem(
          'Open graph preview',
          'Render the latest graph or generate one from the active semantic source.',
          vscode.TreeItemCollapsibleState.None,
          {
            command: 'aiNative.openGraphPreview',
            title: 'Open graph preview',
          },
          new vscode.ThemeIcon('graph'),
        ),
      ];
    }

    if (this.kind === 'databaseSchema') {
      const canonicalSchema = vscode.Uri.joinPath(root, 'source.database.md');
      if (await pathExists(canonicalSchema)) {
        return [
          new VersionedArtifactTreeItem(
            'Current database schema',
            'editable schema · .ai-native/source.database.md',
            vscode.TreeItemCollapsibleState.None,
            {
              command: 'vscode.open',
              title: 'Open current database schema',
              arguments: [canonicalSchema],
            },
            new vscode.ThemeIcon('symbol-field'),
          ),
        ];
      }
    }

    if (this.kind === 'validation' || this.kind === 'review') {
      const directFolder = vscode.Uri.joinPath(root, this.kind);
      const directMarkdownFiles = await findMarkdownFiles(directFolder, this.kind);
      if (directMarkdownFiles.length > 0) {
        return directMarkdownFiles.map((file, index) => new VersionedArtifactTreeItem(
          index === 0 ? `Current ${this.kind} output` : path.basename(file.fsPath),
          path.relative(root.fsPath, file.fsPath),
          vscode.TreeItemCollapsibleState.None,
          {
            command: this.kind === 'semantic'
              ? 'vscode.open'
              : 'aiNative.openMarkdownArtifactPreview',
            title: `Open ${path.basename(file.fsPath)}`,
            arguments: [file],
          },
          new vscode.ThemeIcon(index === 0 ? 'symbol-text' : 'file'),
        ));
      }

      const canonicalFile = this.kind === 'validation'
        ? vscode.Uri.joinPath(root, 'source.validation.md')
        : vscode.Uri.joinPath(root, 'source.review.md');
      if (await pathExists(canonicalFile)) {
        return [
          new VersionedArtifactTreeItem(
            this.kind === 'validation' ? 'Current validation output' : 'Current review output',
            `editable report · ${path.relative(root.fsPath, canonicalFile.fsPath)}`,
            vscode.TreeItemCollapsibleState.None,
            {
              command: 'aiNative.openMarkdownArtifactPreview',
              title: `Open ${path.basename(canonicalFile.fsPath)}`,
              arguments: [canonicalFile],
            },
            new vscode.ThemeIcon('symbol-text'),
          ),
        ];
      }
    }

    const emptyDescription = this.kind === 'validation'
      ? 'Run Validate input to create the first validation markdown.'
      : this.kind === 'review'
        ? 'Run Generate / refresh graph to create the first review markdown.'
        : this.kind === 'databaseSchema'
          ? 'Run source import or graph generation to create the first schema markdown.'
          : 'Generate outputs to populate this view.';

    return [
      new VersionedArtifactTreeItem(
        this.kind === 'validation'
          ? 'Validation outputs missing'
          : this.kind === 'review'
            ? 'Review outputs missing'
            : this.kind === 'databaseSchema'
              ? 'Database schema outputs missing'
              : `No ${this.kind} markdown yet`,
        emptyDescription,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        new vscode.ThemeIcon('warning'),
      ),
    ];
  }

  async resolveTreeItem(item: VersionedArtifactTreeItem): Promise<VersionedArtifactTreeItem> {
    const files = item.files ?? {};
    const fileNames = Object.keys(files);
    if (item.kind === 'version' && fileNames.length > 0) {
      item.description = `${item.descriptionText} · ${fileNames.length} file(s)`;
    }
    return item;
  }
}

class VersionedArtifactTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly descriptionText: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command,
    public readonly iconPath?: vscode.ThemeIcon,
    public readonly data?: { baseName?: string; versionId?: string; files?: Record<string, string> },
  ) {
    super(label, collapsibleState);
    this.description = descriptionText;
    this.iconPath = iconPath;
    if (data?.versionId && data.files) {
      this.kind = 'version';
      this.files = data.files;
    } else if (data?.baseName) {
      this.kind = 'baseName';
      this.baseName = data.baseName;
    } else {
      this.kind = 'root';
    }
    if (data?.versionId && data.files) {
      this.command = undefined;
    }
  }

  public kind: 'root' | 'baseName' | 'version' = 'root';
  public baseName?: string;
  public files?: Record<string, string>;
}

async function collectBaseNames(kindRoots: string[]): Promise<string[]> {
  const nested = await Promise.all(kindRoots.map(async (kindRoot) => readDirectories(kindRoot)));
  return Array.from(new Set(nested.flat())).sort((left, right) => left.localeCompare(right));
}

async function sortBaseNamesByFreshness(
  kind: ArtifactVersionKind,
  baseNames: string[],
  kindRoots: string[],
): Promise<Array<{ baseName: string; index?: VersionedArtifactIndex }>> {
  const entries = await Promise.all(
    baseNames.map(async (baseName) => ({ baseName, index: await findLatestIndex(kind, baseName, kindRoots) })),
  );
  return entries.sort((left, right) => {
    const leftCreatedAt = left.index?.records[left.index.records.length - 1]?.createdAt ?? '';
    const rightCreatedAt = right.index?.records[right.index.records.length - 1]?.createdAt ?? '';
    return rightCreatedAt.localeCompare(leftCreatedAt);
  });
}

async function collectLatestMarkdownItems(
  kind: ArtifactVersionKind,
  kindRoots: string[],
  baseNames: string[],
  options: VersionedArtifactTreeOptions,
): Promise<VersionedArtifactTreeItem[]> {
  const latestEntries = await Promise.all(
    baseNames.map(async (baseName) => ({ baseName, index: await findLatestIndex(kind, baseName, kindRoots) })),
  );

  return latestEntries
    .sort((left, right) => {
      const leftCreatedAt = left.index?.records[left.index.records.length - 1]?.createdAt ?? '';
      const rightCreatedAt = right.index?.records[right.index.records.length - 1]?.createdAt ?? '';
      return rightCreatedAt.localeCompare(leftCreatedAt);
    })
    .flatMap(({ baseName, index }) => {
      if (!index || index.records.length === 0) {
        return [];
      }
      const latest = index.records[index.records.length - 1];
      const files = filterFilesByMode(latest.files, kind, options.mode ?? 'all');
      const versionLabel = formatVersionLabel(latest);
        return Object.entries(files)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([relativePath, fullPath]) => {
          const label = path.basename(relativePath);
          return new VersionedArtifactTreeItem(
            label,
            [baseName, latest.createdAt, versionLabel, relativePath].filter(Boolean).join(' · '),
            vscode.TreeItemCollapsibleState.None,
            {
              command: kind === 'semantic' ? 'vscode.open' : 'aiNative.openMarkdownArtifactPreview',
              title: `Open ${label}`,
              arguments: [vscode.Uri.file(fullPath)],
            },
            new vscode.ThemeIcon(kind === 'semantic' ? 'symbol-text' : 'file'),
          );
        });
    });
}

function renderVersionItems(
  baseName: string,
  index: VersionedArtifactIndex | undefined,
  kind: ArtifactVersionKind,
  options: VersionedArtifactTreeOptions,
): VersionedArtifactTreeItem[] {
  if (!index) {
    return [];
  }

  return index.records
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((record) => {
      const summary = record.metadata && typeof record.metadata === 'object' && 'summary' in record.metadata
        ? String((record.metadata as Record<string, unknown>).summary ?? '')
        : '';
      const files = filterFilesByMode(record.files, kind, options.mode ?? 'all');
      const descriptionParts = [record.createdAt, summary].filter(Boolean);
      if (kind === 'semantic' && getDirtySemanticHintSync()) {
        descriptionParts.push(getDirtySemanticHintSync()!);
      }
      return new VersionedArtifactTreeItem(
        formatVersionLabel(record),
        descriptionParts.join(' · ') || `${Object.keys(files).length} file(s)`,
        Object.keys(files).length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        undefined,
        kind === 'graph' ? new vscode.ThemeIcon('graph') : new vscode.ThemeIcon('history'),
        { baseName, versionId: record.versionId, files },
      );
    });
}

function formatVersionLabel(record: VersionedArtifactIndex['records'][number]): string {
  const label = (record.label ?? '').trim();
  if (!label) {
    return record.versionId;
  }
  if (/^(validation|review|graph|semantic|database schema|import validation)$/i.test(label)) {
    return `${label} · ${record.createdAt}`;
  }
  return `${label} · ${record.createdAt}`;
}

function filterFilesByMode(files: Record<string, string>, kind: ArtifactVersionKind, mode: ArtifactTreeMode): Record<string, string> {
  const entries = Object.entries(files).filter(([relativePath]) => {
    if (mode === 'graph-preview') {
      return relativePath.endsWith('.graph.json');
    }
    if (kind === 'semantic' || kind === 'validation' || kind === 'review' || kind === 'databaseSchema') {
      return isRelevantMarkdownFile(relativePath, kind);
    }
    if (mode === 'markdown-only') {
      return relativePath.endsWith('.md');
    }
    return true;
  });
  return Object.fromEntries(entries);
}

function isRelevantMarkdownFile(fileName: string, kind: ArtifactVersionKind): boolean {
  if (kind === 'semantic') {
    return fileName.endsWith('.semantic.md') || fileName === 'semantic.md' || fileName === 'source.semantic.md';
  }
  if (kind === 'validation') {
    return fileName.endsWith('.validation.md') || fileName === 'validation.md';
  }
  if (kind === 'review') {
    return fileName.endsWith('.review.md') || fileName === 'review.md';
  }
  if (kind === 'databaseSchema') {
    return fileName.endsWith('.database.schema.md') || fileName === 'database.schema.md' || fileName === 'source.database.md';
  }
  return fileName.endsWith('.md');
}

async function readDirectories(directoryPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function findSemanticSourceFiles(): Promise<vscode.Uri[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return [];
  }

  const matches: vscode.Uri[] = [];
  for (const workspaceFolder of workspaceFolders) {
    await walkForSemanticSources(workspaceFolder.uri.fsPath, matches);
  }

  if (matches.length > 0) {
    return matches.sort((left, right) => left.fsPath.localeCompare(right.fsPath));
  }

  const activeSemanticDocument = vscode.window.activeTextEditor?.document;
  if (activeSemanticDocument?.fileName.endsWith('.semantic.md')) {
    return [activeSemanticDocument.uri];
  }

  return [];
}

async function pathExists(target: vscode.Uri): Promise<boolean> {
  try {
    await fs.access(target.fsPath);
    return true;
  } catch {
    return false;
  }
}

async function walkForSemanticSources(currentPath: string, matches: vscode.Uri[], depth = 0): Promise<void> {
  if (depth > 5) {
    return;
  }

  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.ai-native' || entry.name === 'node_modules' || entry.name === '.vscode') {
      continue;
    }

    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      await walkForSemanticSources(entryPath, matches, depth + 1);
      continue;
    }

    if (entry.name.endsWith('.semantic.md')) {
      matches.push(vscode.Uri.file(entryPath));
    }
  }
}

async function findMarkdownFiles(folder: vscode.Uri, kind: ArtifactVersionKind): Promise<vscode.Uri[]> {
  try {
    const entries = await fs.readdir(folder.fsPath, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && isRelevantMarkdownFile(entry.name, kind))
        .map(async (entry) => {
          const uri = vscode.Uri.joinPath(folder, entry.name);
          const stat = await fs.stat(uri.fsPath);
          return { uri, stat };
        }),
    );

    return files
      .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)
      .map((entry) => entry.uri);
  } catch {
    return [];
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function findKindRoots(rootPath: string, kind: ArtifactVersionKind): Promise<string[]> {
  const roots: string[] = [];
  await walkForKindRoots(rootPath, kind, roots);
  return roots;
}

async function walkForKindRoots(currentPath: string, kind: ArtifactVersionKind, roots: string[], depth = 0): Promise<void> {
  if (depth > 4) {
    return;
  }

  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const entryPath = path.join(currentPath, entry.name);
    if (entry.name === 'versions') {
      const kindPath = path.join(entryPath, kind);
      if (await exists(kindPath)) {
        roots.push(kindPath);
      }
    } else {
      await walkForKindRoots(entryPath, kind, roots, depth + 1);
    }
  }
}

async function findLatestIndex(
  kind: ArtifactVersionKind,
  baseName: string,
  kindRoots: string[],
): Promise<VersionedArtifactIndex | undefined> {
  for (const kindRoot of kindRoots) {
    // kindRoot is .../versions/{kind} — go up two levels to get the artifactRoot
    const artifactRootForKind = path.dirname(path.dirname(kindRoot));
    const index = await readVersionedArtifactIndex(artifactRootForKind, kind, baseName);
    if (index) {
      return index;
    }
  }
  return undefined;
}

function getDirtySemanticHintSync(): string | undefined {
  const dirtySemanticDocument = vscode.workspace.textDocuments.find((document) => document.fileName.endsWith('.semantic.md') && document.isDirty);
  return dirtySemanticDocument ? 'unsaved changes' : undefined;
}

async function getDirtySemanticHint(): Promise<string | undefined> {
  return getDirtySemanticHintSync();
}
