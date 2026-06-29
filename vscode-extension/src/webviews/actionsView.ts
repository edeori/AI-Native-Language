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
      if (typeof message?.command !== 'string') return;
      await vscode.commands.executeCommand(message.command);
    });
    webviewView.webview.html = this.render();
  }

  private render(): string {
    const cspSource = this.view?.webview.cspSource ?? '';
    const n = nonce();
    return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${n}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Native Actions</title>
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

      .btn-group { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }

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

      .btn-icon {
        font-size: 14px; flex-shrink: 0; line-height: 1;
        color: var(--vscode-descriptionForeground);
      }
      .btn-label { flex: 1; }
      .btn-desc {
        font-size: 10px; font-weight: 400;
        color: var(--vscode-descriptionForeground);
        margin-top: 1px;
      }
    </style>
  </head>
  <body>

    <div class="section-label">Graph</div>
    <div class="btn-group">
      <button class="action-btn" data-command="${commandIds.openGraphPreview}">
        <span class="btn-icon">⬡</span>
        <span>
          <div class="btn-label">Show graph</div>
          <div class="btn-desc">Open the latest canonical graph</div>
        </span>
      </button>
      <button class="action-btn" data-command="${commandIds.showEndpoints}">
        <span class="btn-icon">⚡</span>
        <span>
          <div class="btn-label">Endpoint summary</div>
          <div class="btn-desc">REST · SOAP · GraphQL · Events · gRPC</div>
        </span>
      </button>
    </div>

    <div class="section-label">Validation</div>
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

    <script nonce="${n}">
      const vscode = acquireVsCodeApi();
      document.querySelectorAll('button[data-command]').forEach((btn) => {
        btn.addEventListener('click', () => vscode.postMessage({ command: btn.dataset.command }));
      });
    </script>
  </body>
</html>`;
  }
}

function nonce(): string {
  return Math.random().toString(36).slice(2);
}
