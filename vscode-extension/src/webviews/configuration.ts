import * as vscode from 'vscode';
import { defaultReviewMode, defaultReviewModel, getConfig } from '../config.js';
import { writeMcpConfigFile } from '../mcpConfigStore.js';
import { probeAgentRuntime, resolveAgentCliPath } from '../agenticReview.js';
import type { McpRegistry } from '../mcpRegistry.js';

export class ConfigurationPanel {
  private static currentPanel: ConfigurationPanel | undefined;
  private currentValues = getConfig();
  private lastMcpStatus: string[] = [];
  private lastAgentProbe: string[] = [];

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
      'AI Agent Configuration',
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
        if (message?.command === 'test-mcp') {
          await this.testMcpServers();
          return;
        }
        if (message?.command === 'test-agent') {
          await this.testAgent();
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
    const agentCliPath = resolveAgentCliPath(config.reviewProvider);
    const agentStatus = agentCliPath ? `available at ${agentCliPath}` : 'not found on this machine';

    this.panel.webview.html = /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Agent Configuration</title>
    <style>
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 24px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
      .card { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 16px; background: var(--vscode-editor-background); }
      label { display: block; margin-top: 12px; font-weight: 600; }
      input[type="text"], select { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 8px; }
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
    <h2>Settings</h2>
    <p class="muted">Choose the agent once. Configure service endpoints below.</p>
    <div class="grid">
      <div class="card">
        <label for="reviewProvider">AI agent</label>
        <select id="reviewProvider">
          <option value="codex" ${config.reviewProvider !== 'claude' ? 'selected' : ''}>codex</option>
          <option value="claude" ${config.reviewProvider === 'claude' ? 'selected' : ''}>claude</option>
        </select>
        <p class="muted">The plugin auto-selects the review path for this agent.</p>
        <p class="muted"><strong>Agent CLI:</strong> ${escapeHtml(agentStatus)}</p>
      </div>
      <div class="card">
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

      </div>
    </div>
    <div class="actions">
      <button id="save">Save</button>
      <button id="testMcp">Test MCP servers</button>
      <button id="testAgent">Test AI agent</button>
    </div>
    <pre>${escapeHtml(this.lastMcpStatus.join('\n') || 'MCP test not run yet.')}</pre>
    <pre>${escapeHtml(this.lastAgentProbe.join('\n') || 'AI agent test not run yet.')}</pre>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const reviewProvider = document.getElementById('reviewProvider');
      const semanticCoreUrl = document.getElementById('semanticCoreUrl');
      const validatorUrl = document.getElementById('validatorUrl');
      const compilerUrl = document.getElementById('compilerUrl');
      const artifactRoot = document.getElementById('artifactRoot');
      const javaBasePackage = document.getElementById('javaBasePackage');
      const saveButton = document.getElementById('save');
      const testMcpButton = document.getElementById('testMcp');
      const testAgentButton = document.getElementById('testAgent');
      saveButton.addEventListener('click', () => {
        vscode.postMessage({
          command: 'save',
          values: {
            reviewProvider: reviewProvider.value,
            semanticCoreUrl: semanticCoreUrl.value,
            validatorUrl: validatorUrl.value,
            compilerUrl: compilerUrl.value,
            artifactRoot: artifactRoot.value,
            javaBasePackage: javaBasePackage.value
          }
        });
      });
      testMcpButton.addEventListener('click', () => vscode.postMessage({ command: 'test-mcp' }));
      testAgentButton.addEventListener('click', () => vscode.postMessage({ command: 'test-agent' }));
    </script>
  </body>
</html>`;
  }

  private async saveSettings(values: Record<string, unknown>): Promise<void> {
    const reviewProvider = String(values.reviewProvider ?? 'codex') as 'codex' | 'claude';
    const persistedValues = {
      ...this.currentValues,
      semanticCoreUrl: String(values.semanticCoreUrl ?? this.currentValues.semanticCoreUrl),
      validatorUrl: String(values.validatorUrl ?? this.currentValues.validatorUrl),
      compilerUrl: String(values.compilerUrl ?? this.currentValues.compilerUrl),
      artifactRoot: String(values.artifactRoot ?? this.currentValues.artifactRoot),
      javaBasePackage: String(values.javaBasePackage ?? this.currentValues.javaBasePackage),
      reviewProvider,
      reviewMode: defaultReviewMode(reviewProvider),
      reviewModel: defaultReviewModel(reviewProvider),
    };

    await writeMcpConfigFile(persistedValues);
    this.currentValues = persistedValues;
    await this.onChange?.();
    vscode.window.showInformationMessage('AI agent configuration saved.');
    this.render();
  }

  private async testMcpServers(): Promise<void> {
    const results = await this.registry.pingAll();
    this.lastMcpStatus = results.map((result) => {
      if (result.connected) {
        return `${result.server}: ok (${result.tools ?? 0} tools)`;
      }
      return `${result.server}: failed (${result.error ?? 'unreachable'})`;
    });
    this.render();
    vscode.window.showInformationMessage('MCP connection test completed.');
  }

  private async testAgent(): Promise<void> {
    const probe = await probeAgentRuntime(
      this.currentValues.reviewProvider,
      this.currentValues.reviewModel,
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    );
    this.lastAgentProbe = [
      `${probe.provider}: ${probe.ok ? 'ok' : 'failed'}`,
      probe.bridgeAction,
      probe.ok ? (probe.rawOutput ? probe.rawOutput.slice(0, 1200) : 'OK') : (probe.error ?? 'unknown error'),
    ];
    this.render();
    if (probe.ok) {
      vscode.window.showInformationMessage(`${probe.provider} agent test completed.`);
    } else {
      vscode.window.showWarningMessage(`${probe.provider} agent test failed.`);
    }
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
