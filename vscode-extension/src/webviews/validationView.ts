import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { commandIds } from '../constants.js';
import { resolveArtifactRoot } from '../workspaceArtifacts.js';

interface ArtifactEntry {
  label: string;
  description: string;
  fsPath: string;
}

// The Validation view. Rendered as a webview (not a tree) so the two action
// buttons match the styled buttons in the Actions view: buttons on top, a
// separator, then the Semantic Validation and Doc-Code Alignment outputs below.
export class ValidationWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (typeof message?.open === 'string') {
        await vscode.commands.executeCommand(commandIds.openMarkdownArtifactPreview, vscode.Uri.file(message.open));
        return;
      }
      if (typeof message?.command === 'string') {
        await vscode.commands.executeCommand(message.command);
      }
    });
    webviewView.webview.html = await this.render();
  }

  async refresh(): Promise<void> {
    if (this.view) {
      this.view.webview.html = await this.render();
    }
  }

  private async loadArtifacts(rootPath: string, kind: 'validation' | 'alignment'): Promise<ArtifactEntry[]> {
    const ext = kind === 'alignment' ? '.alignment.md' : '.validation.md';
    const folder = path.join(rootPath, kind);
    let files: Array<{ name: string; fsPath: string; mtimeMs: number }> = [];
    try {
      const entries = await fs.readdir(folder, { withFileTypes: true });
      files = await Promise.all(
        entries
          .filter((e) => e.isFile() && e.name.endsWith(ext))
          .map(async (e) => {
            const fsPath = path.join(folder, e.name);
            const stat = await fs.stat(fsPath);
            return { name: e.name, fsPath, mtimeMs: stat.mtimeMs };
          }),
      );
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
      // folder doesn't exist yet
    }
    return files.slice(0, 10).map((f, i) => ({
      label: i === 0 ? (kind === 'alignment' ? 'Latest alignment report' : 'Latest validation output') : f.name,
      description: new Date(f.mtimeMs).toLocaleString(),
      fsPath: f.fsPath,
    }));
  }

  private async render(): Promise<string> {
    const cspSource = this.view?.webview.cspSource ?? '';
    const n = nonce();
    const root = await resolveArtifactRoot();
    const [validation, alignment] = root
      ? await Promise.all([this.loadArtifacts(root.fsPath, 'validation'), this.loadArtifacts(root.fsPath, 'alignment')])
      : [[], []];

    return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${n}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Native Validation</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        margin: 0; padding: 10px;
        background: var(--vscode-sideBar-background);
      }
      .section-label {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.5px; color: var(--vscode-descriptionForeground);
        margin: 0 0 6px 2px;
      }
      .btn-group { display: flex; flex-direction: column; gap: 5px; }
      .action-btn {
        display: flex; align-items: center; gap: 8px;
        width: 100%; padding: 7px 10px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 7px;
        background: var(--vscode-editor-background);
        color: var(--vscode-foreground);
        font-size: 12px; font-weight: 600;
        cursor: pointer; text-align: left;
        transition: background 0.1s;
      }
      .action-btn:hover { background: var(--vscode-list-hoverBackground); }
      .btn-icon { font-size: 14px; flex-shrink: 0; line-height: 1; color: var(--vscode-descriptionForeground); }
      .btn-label { flex: 1; }
      .btn-desc { font-size: 10px; font-weight: 400; color: var(--vscode-descriptionForeground); margin-top: 1px; }

      .sep { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 14px 0; }

      .art-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
      .art-item {
        display: flex; align-items: center; gap: 8px;
        width: 100%; padding: 6px 9px;
        border: 1px solid var(--vscode-panel-border); border-radius: 6px;
        background: var(--vscode-editor-background); color: var(--vscode-foreground);
        cursor: pointer; text-align: left; transition: background 0.1s;
      }
      .art-item:hover { background: var(--vscode-list-hoverBackground); }
      .art-icon { font-size: 13px; flex-shrink: 0; color: var(--vscode-descriptionForeground); }
      .art-label { flex: 1; font-size: 12px; }
      .art-desc { font-size: 10px; color: var(--vscode-descriptionForeground); white-space: nowrap; }
      .art-empty { font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic; padding: 2px; }
    </style>
  </head>
  <body>

    <div class="section-label">Validation actions</div>
    <div class="btn-group">
      <button class="action-btn" data-command="${commandIds.validateActiveSemanticMarkdown}">
        <span class="btn-icon">✓</span>
        <span>
          <div class="btn-label">Validate semantic</div>
          <div class="btn-desc">Check active source.semantic.md against policy</div>
        </span>
      </button>
      <button class="action-btn" data-command="${commandIds.runDocCodeAlignment}">
        <span class="btn-icon">⇄</span>
        <span>
          <div class="btn-label">Doc-code alignment</div>
          <div class="btn-desc">Check imported docs against code artifacts</div>
        </span>
      </button>
    </div>

    <hr class="sep" />

    <div class="section-label">Semantic Validation</div>
    <div class="art-list">${renderArtifacts(validation, 'Run Validate to create the first report')}</div>

    <div class="section-label">Doc-Code Alignment</div>
    <div class="art-list">${renderArtifacts(alignment, 'Import documents first, then run Doc-Code Alignment')}</div>

    <script nonce="${n}">
      const vscode = acquireVsCodeApi();
      document.querySelectorAll('button[data-command]').forEach((btn) => {
        btn.addEventListener('click', () => vscode.postMessage({ command: btn.dataset.command }));
      });
      document.querySelectorAll('[data-open]').forEach((el) => {
        el.addEventListener('click', () => vscode.postMessage({ open: el.dataset.open }));
      });
    </script>
  </body>
</html>`;
  }
}

function renderArtifacts(items: ArtifactEntry[], emptyHint: string): string {
  if (items.length === 0) {
    return `<div class="art-empty">${escapeHtml(emptyHint)}</div>`;
  }
  return items
    .map(
      (item) => `<div class="art-item" data-open="${escapeHtml(item.fsPath)}">
        <span class="art-icon">📄</span>
        <span class="art-label">${escapeHtml(item.label)}</span>
        <span class="art-desc">${escapeHtml(item.description)}</span>
      </div>`,
    )
    .join('');
}

function nonce(): string {
  return Math.random().toString(36).slice(2);
}

function escapeHtml(value: string): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
