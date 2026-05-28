import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getConfig } from './config.js';

export interface ArtifactNode {
  label: string;
  path: string;
  kind: 'file' | 'directory';
}

export async function resolveArtifactRoot(): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }

  const config = getConfig();
  return vscode.Uri.joinPath(folders[0].uri, config.artifactRoot);
}

export async function listArtifactNodes(maxDepth = 2): Promise<ArtifactNode[]> {
  const root = await resolveArtifactRoot();
  if (!root) {
    return [];
  }

  return walkDirectory(root.fsPath, maxDepth);
}

async function walkDirectory(currentPath: string, maxDepth: number, depth = 0): Promise<ArtifactNode[]> {
  if (depth > maxDepth) {
    return [];
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: ArtifactNode[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const fullPath = path.join(currentPath, entry.name);
    nodes.push({
      label: entry.name,
      path: fullPath,
      kind: entry.isDirectory() ? 'directory' : 'file',
    });
    if (entry.isDirectory()) {
      nodes.push(...(await walkDirectory(fullPath, maxDepth, depth + 1)));
    }
  }

  return nodes;
}
