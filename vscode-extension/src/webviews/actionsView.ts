import * as vscode from 'vscode';
import { commandIds } from '../constants.js';

export class ActionsWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (typeof message?.command !== 'string') {
        return;
      }
      await vscode.commands.executeCommand(message.command);
    });
    webviewView.webview.html = this.render();
  }

  private render(): string {
    const cspSource = this.view?.webview.cspSource ?? '';
    const scriptNonce = nonce();
    return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Native Actions</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        margin: 0;
        padding: 12px;
        background: var(--vscode-sideBar-background);
      }
      .stack {
        display: grid;
        gap: 8px;
      }
      .card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
        background: var(--vscode-editor-background);
        padding: 10px;
      }
      .title {
        font-size: 12px;
        font-weight: 700;
        margin-bottom: 8px;
      }
      .muted {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        line-height: 1.4;
      }
      .actions {
        display: grid;
        gap: 6px;
        margin-top: 10px;
      }
      button {
        width: 100%;
        padding: 7px 10px;
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 8px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        font-weight: 600;
        font-size: 12px;
        cursor: pointer;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <div class="stack">
      <div class="card">
        <div class="title">Actions</div>
        <div class="actions">
          <button data-command="${commandIds.importSourceProject}">Import source project</button>
          <button data-command="${commandIds.createSemanticSourceTemplate}">Start from scratch</button>
          <button data-command="${commandIds.validateActiveSemanticMarkdown}">Validate input</button>
          <button data-command="${commandIds.openGraphPreview}">Show graph</button>
          <button data-command="${commandIds.generateCanonicalGraph}">Generate / refresh graph</button>
          <button data-command="${commandIds.generateSpringBootSkeleton}">Generate Spring Boot</button>
        </div>
      </div>
    </div>
    <script nonce="${scriptNonce}">
      const vscode = acquireVsCodeApi();
      document.querySelectorAll('button[data-command]').forEach((button) => {
        button.addEventListener('click', () => vscode.postMessage({ command: button.dataset.command }));
      });
    </script>
  </body>
</html>`;
  }
}

function nonce(): string {
  return Math.random().toString(36).slice(2);
}
