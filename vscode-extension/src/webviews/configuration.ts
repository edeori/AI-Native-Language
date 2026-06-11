import * as vscode from 'vscode';
import { getConfig } from '../config.js';
import type { McpRegistry, ServerConnectionStatus } from '../mcpRegistry.js';
import { ensureMcpConfigFile, resolveMcpConfigUri, writeMcpConfigFile } from '../mcpConfigStore.js';

type ConnectionStatus = Array<ServerConnectionStatus>;

export class ConfigurationPanel {
  private static currentPanel: ConfigurationPanel | undefined;
  private lastConnectionStatus: ConnectionStatus = [];
  private currentValues = getConfig();

  static show(
    context: vscode.ExtensionContext,
    registry: Pick<McpRegistry, 'pingAll'>,
    onChange?: () => Promise<void> | void,
  ): ConfigurationPanel {
    if (ConfigurationPanel.currentPanel) {
      ConfigurationPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      ConfigurationPanel.currentPanel.render();
      return ConfigurationPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiNativeConfiguration',
      'AI Native Configuration',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
      },
    );

    ConfigurationPanel.currentPanel = new ConfigurationPanel(panel, context, registry, onChange);
    return ConfigurationPanel.currentPanel;
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly registry: Pick<McpRegistry, 'pingAll'>,
    private readonly onChange?: () => Promise<void> | void,
  ) {
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message?.command === 'save') {
          await this.saveSettings(message.values);
          return;
        }
        if (message?.command === 'testConnections') {
          await this.testConnections();
          return;
        }
        if (message?.command === 'openMcpConfig') {
          await this.openMcpConfig();
          return;
        }
      },
      null,
      this.disposables,
    );
    this.render();
  }

  dispose(): void {
    ConfigurationPanel.currentPanel = undefined;
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
    this.panel.dispose();
  }

  private render(): void {
    const nonce = createNonce();
    const config = this.currentValues;
    const currentStatus = {
      semanticCoreUrl: config.semanticCoreUrl,
      validatorUrl: config.validatorUrl,
      compilerUrl: config.compilerUrl,
      artifactRoot: config.artifactRoot,
      javaBasePackage: config.javaBasePackage,
      autoValidateOnSave: config.autoValidateOnSave,
    };

    this.panel.webview.html = /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Native Configuration</title>
    <style>
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 24px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
      .card { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 16px; background: var(--vscode-editor-background); }
      label { display: block; margin-top: 12px; font-weight: 600; }
      input[type="text"] { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 8px; }
      .row { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
      .actions { margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
      button { padding: 8px 12px; }
      code, pre { background: var(--vscode-textBlockQuote-background); padding: 8px; border-radius: 6px; overflow-x: auto; }
      .muted { color: var(--vscode-descriptionForeground); }
      .status-list { list-style: none; padding-left: 0; margin: 0; display: grid; gap: 12px; }
      .status-list li { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 12px; }
      .status-icon { margin-right: 6px; }
    </style>
  </head>
  <body>
    <h2>AI Native MCP Configuration</h2>
    <p class="muted">This panel controls the remote MCP endpoints used by the VSCode extension.</p>
    <div class="grid">
      <div class="card">
        <h3>Endpoints</h3>
        <label for="semanticCoreUrl">semantic-core URL</label>
        <input id="semanticCoreUrl" type="text" value="${escapeAttr(config.semanticCoreUrl)}" />
        <label for="validatorUrl">validator URL</label>
        <input id="validatorUrl" type="text" value="${escapeAttr(config.validatorUrl)}" />
        <label for="compilerUrl">compiler URL</label>
        <input id="compilerUrl" type="text" value="${escapeAttr(config.compilerUrl)}" />
        <label for="artifactRoot">artifact root</label>
        <input id="artifactRoot" type="text" value="${escapeAttr(config.artifactRoot)}" />
        <label for="javaBasePackage">Java base package</label>
        <input id="javaBasePackage" type="text" value="${escapeAttr(config.javaBasePackage)}" />
        <div class="row">
          <input id="autoValidateOnSave" type="checkbox" ${config.autoValidateOnSave ? 'checked' : ''} />
          <label for="autoValidateOnSave">auto validate on save</label>
        </div>
        <div class="actions">
          <button id="save">Save</button>
          <button id="testConnections">Test connections</button>
          <button id="openMcpConfig">Open MCP config file</button>
        </div>
      </div>
      <div class="card">
        <h3>Current values</h3>
        <pre id="current">${escapeHtml(JSON.stringify(currentStatus, null, 2))}</pre>
      </div>
      <div class="card">
        <h3>Connection status</h3>
        ${this.renderConnectionStatus()}
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.getElementById('save').addEventListener('click', () => {
        vscode.postMessage({
          command: 'save',
          values: {
            semanticCoreUrl: document.getElementById('semanticCoreUrl').value,
            validatorUrl: document.getElementById('validatorUrl').value,
            compilerUrl: document.getElementById('compilerUrl').value,
            artifactRoot: document.getElementById('artifactRoot').value,
            javaBasePackage: document.getElementById('javaBasePackage').value,
            autoValidateOnSave: document.getElementById('autoValidateOnSave').checked,
          }
        });
      });
      document.getElementById('testConnections').addEventListener('click', () => {
        vscode.postMessage({ command: 'testConnections' });
      });
      document.getElementById('openMcpConfig').addEventListener('click', () => {
        vscode.postMessage({ command: 'openMcpConfig' });
      });
    </script>
  </body>
</html>`;
  }

  private renderConnectionStatus(): string {
    if (this.lastConnectionStatus.length === 0) {
      return `<p class="muted">Run <strong>Test connections</strong> to verify the MCP endpoints.</p>`;
    }

    const items = this.lastConnectionStatus
      .map((item) => {
        const icon = item.connected ? '✅' : '❌';
        const label = item.connected ? 'connected' : 'failed';
        const details = item.connected ? `tools: ${item.tools ?? 0}` : escapeHtml(item.error ?? 'unknown error');
        return `<li><span class="status-icon">${icon}</span> <strong>${escapeHtml(item.server)}</strong> — ${label}<br/><code>${escapeHtml(item.url)}</code><br/><span class="muted">${details}</span></li>`;
      })
      .join('');

    return `<ul class="status-list">${items}</ul>`;
  }

  private async testConnections(): Promise<void> {
    try {
      this.lastConnectionStatus = await this.registry.pingAll();
      this.render();
      await this.onChange?.();
      const connectedCount = this.lastConnectionStatus.filter((item) => item.connected).length;
      const total = this.lastConnectionStatus.length;
      if (connectedCount === total) {
        void vscode.window.showInformationMessage(`All MCP servers are reachable (${connectedCount}/${total}).`);
      } else {
        void vscode.window.showWarningMessage(`Some MCP servers are unreachable (${connectedCount}/${total}).`);
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to test MCP connections: ${String(error)}`);
    }
  }

  private async openMcpConfig(): Promise<void> {
    const configUri = (await ensureMcpConfigFile()) ?? resolveMcpConfigUri();
    if (!configUri) {
      vscode.window.showWarningMessage('Open a workspace first to access the MCP config file.');
      return;
    }

    const document = await vscode.workspace.openTextDocument(configUri);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  private async saveSettings(values: Record<string, unknown>): Promise<void> {
    const persistedValues = {
      semanticCoreUrl: String(values.semanticCoreUrl ?? ''),
      validatorUrl: String(values.validatorUrl ?? ''),
      compilerUrl: String(values.compilerUrl ?? ''),
      artifactRoot: String(values.artifactRoot ?? '.ai-native'),
      javaBasePackage: String(values.javaBasePackage ?? 'com.example.generated'),
      autoValidateOnSave: Boolean(values.autoValidateOnSave),
    };

    await writeMcpConfigFile(persistedValues);
    this.currentValues = persistedValues;
    await this.onChange?.();
    vscode.window.showInformationMessage('AI Native MCP configuration saved.');
    this.render();
  }
}

function createNonce(): string {
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

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll('\n', '&#10;');
}
