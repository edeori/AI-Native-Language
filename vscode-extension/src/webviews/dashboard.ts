import * as vscode from 'vscode';
import { commandIds } from '../constants.js';
import { getConfig } from '../config.js';

export class DashboardPanel {
  private static currentPanel: DashboardPanel | undefined;

  static show(extensionUri: vscode.Uri, context: vscode.ExtensionContext, statusHtml: string): DashboardPanel {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      DashboardPanel.currentPanel.update(statusHtml);
      return DashboardPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiNativeDashboard',
      'AI Native Dashboard',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, context, statusHtml);
    return DashboardPanel.currentPanel;
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private statusHtml: string,
  ) {
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        if (typeof message?.command !== 'string') {
          return;
        }
        await vscode.commands.executeCommand(message.command);
      },
      null,
      this.disposables,
    );
    this.render();
  }

  update(statusHtml: string): void {
    this.statusHtml = statusHtml;
    this.render();
  }

  dispose(): void {
    DashboardPanel.currentPanel = undefined;
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
    this.panel.dispose();
  }

  private render(): void {
    const config = getConfig();
    const cspSource = this.panel.webview.cspSource;
    const scriptNonce = nonce();
    this.panel.webview.html = /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Native Dashboard</title>
    <style>
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 24px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
      .card { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 16px; background: var(--vscode-editor-background); }
      .title { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
      .muted { color: var(--vscode-descriptionForeground); }
      .primary-actions { display: grid; gap: 10px; margin-top: 12px; }
      button { margin: 0; padding: 10px 14px; }
      button.primary { width: 100%; font-size: 14px; font-weight: 600; }
      code { background: var(--vscode-textBlockQuote-background); padding: 1px 4px; border-radius: 4px; }
      pre { white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <div class="title">AI Native Semantic Workflow</div>
    <p class="muted">Remote services: semantic-core, validator, compiler. Local artifact root: <code>${escapeHtml(config.artifactRoot)}</code>.</p>
    <div class="grid">
      <div class="card">
        <h3>Primary flow</h3>
        <p class="muted">Use these buttons to move from input to model to code.</p>
        <div class="primary-actions">
          <button class="primary" data-command="${commandIds.createSemanticSourceTemplate}">Start from scratch</button>
          <button class="primary" data-command="${commandIds.validateActiveSemanticMarkdown}">Validate input</button>
          <button class="primary" data-command="${commandIds.generateCanonicalGraph}">Generate / refresh graph</button>
          <button class="primary" data-command="${commandIds.generateSpringBootSkeleton}">Generate Spring Boot</button>
        </div>
      </div>
      <div class="card">
        <h3>Configuration</h3>
        <div>semantic-core: <code>${escapeHtml(config.semanticCoreUrl)}</code></div>
        <div>validator: <code>${escapeHtml(config.validatorUrl)}</code></div>
        <div>compiler: <code>${escapeHtml(config.compilerUrl)}</code></div>
        <div>java-parser: <code>${escapeHtml(config.javaParserUrl)}</code></div>
        <div>deterministic-graph: <code>${escapeHtml((config as typeof config & { deterministicGraphUrl?: string }).deterministicGraphUrl ?? '')}</code></div>
        <button data-command="${commandIds.openConfiguration}">Configure Settings & AI agent</button>
        <button data-command="${commandIds.refreshAll}">Refresh views</button>
      </div>
      <div class="card">
        <h3>Status</h3>
        <pre>${escapeHtml(this.statusHtml)}</pre>
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
