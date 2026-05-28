import * as vscode from 'vscode';
import { getConfig } from '../config.js';
import { commandIds } from '../constants.js';

export class ConfigurationPanel {
  private static currentPanel: ConfigurationPanel | undefined;

  static show(context: vscode.ExtensionContext): ConfigurationPanel {
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

    ConfigurationPanel.currentPanel = new ConfigurationPanel(panel, context);
    return ConfigurationPanel.currentPanel;
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message?.command === 'save') {
          await this.saveSettings(message.values);
          return;
        }
        if (message?.command === 'openSettingsJson') {
          await vscode.commands.executeCommand('workbench.action.openSettingsJson');
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
    const config = getConfig();
    const nonce = createNonce();
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
          <button id="openSettingsJson">Open settings.json</button>
        </div>
      </div>
      <div class="card">
        <h3>Current values</h3>
        <pre id="current">${escapeHtml(JSON.stringify(currentStatus, null, 2))}</pre>
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
      document.getElementById('openSettingsJson').addEventListener('click', () => {
        vscode.postMessage({ command: 'openSettingsJson' });
      });
    </script>
  </body>
</html>`;
  }

  private async saveSettings(values: Record<string, unknown>): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('aiNative');
    await configuration.update('mcp.semanticCoreUrl', String(values.semanticCoreUrl ?? ''), vscode.ConfigurationTarget.Workspace);
    await configuration.update('mcp.validatorUrl', String(values.validatorUrl ?? ''), vscode.ConfigurationTarget.Workspace);
    await configuration.update('mcp.compilerUrl', String(values.compilerUrl ?? ''), vscode.ConfigurationTarget.Workspace);
    await configuration.update('artifactRoot', String(values.artifactRoot ?? '.ai-native'), vscode.ConfigurationTarget.Workspace);
    await configuration.update('java.basePackage', String(values.javaBasePackage ?? 'com.example.generated'), vscode.ConfigurationTarget.Workspace);
    await configuration.update('autoValidateOnSave', Boolean(values.autoValidateOnSave), vscode.ConfigurationTarget.Workspace);
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
