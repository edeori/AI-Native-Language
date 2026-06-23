import * as vscode from 'vscode';
import {
  getDefaultAgentorModelsConfig,
  getEnrichmentModelCatalog,
  getLocalAgentDefinitions,
  listInstalledOllamaModels,
  probeLocalAgentProvider,
  readAgentorModelsConfig,
  writeAgentorModelsConfig,
  type AgentorModelsConfig,
  type CloudAgentKind,
  type LocalAgentConfig,
  type LocalAgentConfigKey,
} from '@ai-native/semantic-shared';
import { defaultReviewMode, defaultReviewModel, getConfig } from '../config.js';
import { writeMcpConfigFile } from '../mcpConfigStore.js';
import { probeAgentRuntime, resolveAgentCliPath } from '../agenticReview.js';
import type { McpRegistry } from '../mcpRegistry.js';

const LOCAL_AGENT_LABELS: Record<LocalAgentConfigKey, string> = {
  moduleClassifier: 'module-classifier-agent',
  generalEnrichment: 'general-enrichment-agent',
  astComponentClassifier: 'ast-component-classifier-agent',
  flowCandidate: 'flow-candidate-agent',
  repositoryPurpose: 'repository-purpose-agent',
  sqlMigrationSemantics: 'sql-migration-semantics-agent',
  componentPackaging: 'component-packaging-agent',
  validationTriage: 'validation-triage-agent',
  semanticPolishing: 'semantic-polishing-agent',
};

const ROLE_MODEL_PRESETS: Record<LocalAgentConfigKey, Record<AgentorModelsConfig['capability'], string>> = {
  moduleClassifier: {
    low: 'qwen2.5-coder:3b',
    normal: 'qwen2.5-coder:7b',
    high: 'qwen2.5-coder:14b',
  },
  generalEnrichment: {
    low: 'qwen2.5-coder:3b',
    normal: 'qwen2.5-coder:7b',
    high: 'qwen2.5-coder:14b',
  },
  astComponentClassifier: {
    low: 'qwen2.5-coder:3b',
    normal: 'qwen2.5-coder:7b',
    high: 'qwen2.5-coder:14b',
  },
  flowCandidate: {
    low: 'qwen2.5-coder:3b',
    normal: 'qwen2.5-coder:7b',
    high: 'qwen3:14b',
  },
  repositoryPurpose: {
    low: 'qwen2.5-coder:3b',
    normal: 'qwen2.5-coder:7b',
    high: 'qwen2.5-coder:14b',
  },
  sqlMigrationSemantics: {
    low: 'qwen2.5-coder:3b',
    normal: 'qwen2.5-coder:7b',
    high: 'qwen2.5-coder:14b',
  },
  componentPackaging: {
    low: 'qwen2.5-coder:3b',
    normal: 'qwen2.5-coder:7b',
    high: 'qwen3:14b',
  },
  validationTriage: {
    low: 'qwen2.5-coder:3b',
    normal: 'qwen2.5-coder:7b',
    high: 'qwen2.5-coder:14b',
  },
  semanticPolishing: {
    low: 'gemma3:4b',
    normal: 'gemma3:12b',
    high: 'qwen3:14b',
  },
};

const BULK_PRESET_HELPERS = [
  'Apply a preset to reset all local agent roles to a consistent starting profile.',
  'The preset updates role capability, model, provider, endpoint, timeout and confidence defaults.',
  'After applying a preset, save the panel to persist the updated role settings.',
];

export class ConfigurationPanel {
  private static currentPanel: ConfigurationPanel | undefined;
  private currentValues = getConfig();
  private currentEnrichmentValues: AgentorModelsConfig = getDefaultAgentorModelsConfig();
  private lastMcpStatus: string[] = [];
  private lastAgentProbe: string[] = [];
  private lastLocalAgentProbe: Partial<Record<LocalAgentConfigKey, string[]>> = {};
  private installedOllamaModels = new Set<string>();

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
        if (message?.command === 'test-local-agent') {
          await this.testLocalAgent(String(message.role) as LocalAgentConfigKey, message.values);
          return;
        }
        if (message?.command === 'install-ollama') {
          await this.installOllama();
          return;
        }
        if (message?.command === 'install-agent-model') {
          await this.installSelectedModel(String(message.role) as LocalAgentConfigKey, message.values);
          return;
        }
        if (message?.command === 'install-missing-models') {
          await this.installMissingSelectedModels(message.values);
          return;
        }
      },
      null,
      this.disposables,
    );
    void this.reloadEnrichmentConfig();
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
    const enrichment = this.currentEnrichmentValues;
    const modelCatalog = getEnrichmentModelCatalog(enrichment);
    const agentDefinitions = getLocalAgentDefinitions();
    const defaultRoleConfig = getDefaultAgentorModelsConfig().localAgents;
    const agentCliPath = resolveAgentCliPath(config.reviewProvider);
    const agentStatus = agentCliPath ? `available at ${agentCliPath}` : 'not found on this machine';

    const agentCards = agentDefinitions.map((definition) => {
      const role = enrichment.localAgents[definition.key];
      const roleStatus = this.lastLocalAgentProbe[definition.key]?.join('\n') ?? 'Test not run yet.';
      const modelInstalled = role.provider === 'ollama' ? this.installedOllamaModels.has(role.model) : undefined;
      return /* html */ `
        <div class="card">
          <h3>${escapeHtml(LOCAL_AGENT_LABELS[definition.key])}</h3>
          <p class="muted">Stored under <code>.ai-native/enrichment/${escapeHtml(definition.outputDir)}/</code></p>
          <p class="muted">${modelInstalled === undefined ? 'Provider is not Ollama.' : modelInstalled ? 'Selected model is installed.' : 'Selected model is not installed.'}</p>
          <label class="checkbox-row">
            <input id="${definition.key}_enabled" type="checkbox" ${role.enabled ? 'checked' : ''} />
            <span>enabled</span>
          </label>

          <label for="${definition.key}_provider">provider</label>
          <select id="${definition.key}_provider">
            <option value="none" ${role.provider === 'none' ? 'selected' : ''}>none</option>
            <option value="ollama" ${role.provider === 'ollama' ? 'selected' : ''}>ollama</option>
            <option value="cloud" ${role.provider === 'cloud' ? 'selected' : ''}>cloud</option>
          </select>

          <label for="${definition.key}_cloudAgent">cloud agent</label>
          <select id="${definition.key}_cloudAgent">
            <option value="codex" ${role.cloudAgent === 'codex' ? 'selected' : ''}>codex</option>
            <option value="claude" ${role.cloudAgent === 'claude' ? 'selected' : ''}>claude</option>
          </select>

          <label for="${definition.key}_capability">capability</label>
          <select id="${definition.key}_capability" data-role="${definition.key}" class="role-capability">
            <option value="low" ${role.capability === 'low' ? 'selected' : ''}>low</option>
            <option value="normal" ${role.capability === 'normal' ? 'selected' : ''}>normal</option>
            <option value="high" ${role.capability === 'high' ? 'selected' : ''}>high</option>
          </select>

          <label for="${definition.key}_model">model</label>
          <select id="${definition.key}_model">
            ${modelCatalog.map((item) => `<option value="${escapeAttr(item.name)}" ${item.name === role.model ? 'selected' : ''}>${escapeHtml(item.name)} (${escapeHtml(item.capabilities.join(' / '))})</option>`).join('')}
          </select>

          <label for="${definition.key}_endpoint">Ollama endpoint</label>
          <input id="${definition.key}_endpoint" type="text" value="${escapeAttr(role.endpoint)}" />

          <label for="${definition.key}_timeoutMs">timeout (ms)</label>
          <input id="${definition.key}_timeoutMs" type="number" value="${escapeAttr(String(role.timeoutMs))}" />

          <label for="${definition.key}_maxInputSize">max input size</label>
          <input id="${definition.key}_maxInputSize" type="number" value="${escapeAttr(String(role.maxInputSize))}" />

          <label for="${definition.key}_minConfidence">minimum confidence threshold</label>
          <input id="${definition.key}_minConfidence" type="number" step="0.01" min="0" max="1" value="${escapeAttr(String(role.minConfidence))}" />

          <label class="checkbox-row">
            <input id="${definition.key}_autoMerge" type="checkbox" ${role.autoMerge ? 'checked' : ''} />
            <span>auto merge</span>
          </label>

          <div class="actions card-actions">
            <button class="test-local-agent" data-role="${definition.key}">Test connection</button>
            <button class="install-agent-model" data-role="${definition.key}">Install selected model</button>
          </div>
          <pre>${escapeHtml(roleStatus)}</pre>
        </div>
      `;
    }).join('');

    this.panel.webview.html = /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Agent Configuration</title>
    <style>
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 24px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
      .agent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; align-items: start; }
      .card { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 16px; background: var(--vscode-editor-background); }
      h2 { margin-top: 28px; }
      h3 { margin-top: 0; }
      label { display: block; margin-top: 12px; font-weight: 600; }
      input[type="text"], input[type="number"], select { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 8px; }
      .checkbox-row { display: flex; align-items: center; gap: 8px; }
      .checkbox-row input { width: auto; margin-top: 0; }
      .actions { margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
      .card-actions { margin-bottom: 12px; }
      button { padding: 8px 12px; }
      code, pre { background: var(--vscode-textBlockQuote-background); padding: 8px; border-radius: 6px; overflow-x: auto; }
      .muted { color: var(--vscode-descriptionForeground); }
    </style>
  </head>
  <body>
    <h2>Settings</h2>
    <p class="muted">Main plugin settings and MCP service endpoints.</p>
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

        <label for="javaParserUrl">java-parser URL</label>
        <input id="javaParserUrl" type="text" value="${escapeAttr(config.javaParserUrl)}" />

        <label for="jqassistantUrl">jqassistant URL</label>
        <input id="jqassistantUrl" type="text" value="${escapeAttr(config.jqassistantUrl)}" />

        <label for="deterministicGraphUrl">deterministic-graph URL</label>
        <input id="deterministicGraphUrl" type="text" value="${escapeAttr((config as typeof config & { deterministicGraphUrl?: string }).deterministicGraphUrl ?? '')}" />

        <label for="artifactRoot">artifact root</label>
        <input id="artifactRoot" type="text" value="${escapeAttr(config.artifactRoot)}" />

        <label for="javaBasePackage">Java base package</label>
        <input id="javaBasePackage" type="text" value="${escapeAttr(config.javaBasePackage)}" />
      </div>
    </div>

    <h2>AI Native Language &gt; Local AI Agents</h2>
    <p class="muted">Each role routes to its own local AI provider/model. The deterministic graph still remains authoritative.</p>
    <p class="muted">Saved to <code>.ai-native/config/models.yaml</code> in the current workspace.</p>
    <div class="card">
      <label for="bulkPreset">Bulk preset</label>
      <select id="bulkPreset">
        <option value="low">low</option>
        <option value="normal" selected>normal</option>
        <option value="high">high</option>
      </select>
      <div class="actions">
        <button id="applyBulkPreset">Apply preset to all roles</button>
      </div>
      <ul>
        ${BULK_PRESET_HELPERS.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
      </ul>
    </div>
    <div class="actions">
      <button id="save">Save</button>
      <button id="testMcp">Test MCP servers</button>
      <button id="testAgent">Test AI agent</button>
      <button id="installMissingModels">Install missing selected models</button>
      <button id="installOllama">Install Ollama</button>
    </div>
    <div class="agent-grid">${agentCards}</div>
    <pre>${escapeHtml(this.lastMcpStatus.join('\n') || 'MCP test not run yet.')}</pre>
    <pre>${escapeHtml(this.lastAgentProbe.join('\n') || 'AI agent test not run yet.')}</pre>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const localAgentDefinitions = ${JSON.stringify(agentDefinitions.map((definition) => definition.key))};
      const roleModelPresets = ${JSON.stringify(ROLE_MODEL_PRESETS)};
      const roleDefaults = ${JSON.stringify(defaultRoleConfig)};

      function getRoleValues(role) {
        return {
          enabled: document.getElementById(role + '_enabled').checked,
          provider: document.getElementById(role + '_provider').value,
          cloudAgent: document.getElementById(role + '_cloudAgent').value,
          capability: document.getElementById(role + '_capability').value,
          model: document.getElementById(role + '_model').value,
          endpoint: document.getElementById(role + '_endpoint').value,
          timeoutMs: Number(document.getElementById(role + '_timeoutMs').value || 0),
          maxInputSize: Number(document.getElementById(role + '_maxInputSize').value || 0),
          autoMerge: document.getElementById(role + '_autoMerge').checked,
          minConfidence: Number(document.getElementById(role + '_minConfidence').value || 0)
        };
      }

      function applyBulkPreset(preset) {
        for (const role of localAgentDefinitions) {
          const defaults = roleDefaults[role];
          const model = roleModelPresets[role]?.[preset] || defaults.model;
          document.getElementById(role + '_provider').value = defaults.provider;
          document.getElementById(role + '_cloudAgent').value = defaults.cloudAgent;
          document.getElementById(role + '_capability').value = preset;
          document.getElementById(role + '_model').value = model;
          document.getElementById(role + '_endpoint').value = defaults.endpoint;
          document.getElementById(role + '_timeoutMs').value = String(defaults.timeoutMs);
          document.getElementById(role + '_maxInputSize').value = String(defaults.maxInputSize);
          document.getElementById(role + '_minConfidence').value = String(defaults.minConfidence);
          document.getElementById(role + '_autoMerge').checked = !!defaults.autoMerge;
        }
      }

      function collectAllValues() {
        const localAgents = {};
        for (const role of localAgentDefinitions) {
          localAgents[role] = getRoleValues(role);
        }
        return {
          reviewProvider: document.getElementById('reviewProvider').value,
          semanticCoreUrl: document.getElementById('semanticCoreUrl').value,
          validatorUrl: document.getElementById('validatorUrl').value,
          compilerUrl: document.getElementById('compilerUrl').value,
          javaParserUrl: document.getElementById('javaParserUrl').value,
          jqassistantUrl: document.getElementById('jqassistantUrl').value,
          deterministicGraphUrl: document.getElementById('deterministicGraphUrl').value,
          artifactRoot: document.getElementById('artifactRoot').value,
          javaBasePackage: document.getElementById('javaBasePackage').value,
          localAgents
        };
      }

      for (const role of localAgentDefinitions) {
        const capabilityElement = document.getElementById(role + '_capability');
        const modelElement = document.getElementById(role + '_model');
        capabilityElement.addEventListener('change', () => {
          const recommended = roleModelPresets[role]?.[capabilityElement.value];
          if (recommended) {
            modelElement.value = recommended;
          }
        });
      }

      document.getElementById('save').addEventListener('click', () => {
        vscode.postMessage({ command: 'save', values: collectAllValues() });
      });
      document.getElementById('applyBulkPreset').addEventListener('click', () => {
        applyBulkPreset(document.getElementById('bulkPreset').value);
      });
      document.getElementById('testMcp').addEventListener('click', () => vscode.postMessage({ command: 'test-mcp' }));
      document.getElementById('testAgent').addEventListener('click', () => vscode.postMessage({ command: 'test-agent' }));
      document.getElementById('installMissingModels').addEventListener('click', () => {
        vscode.postMessage({ command: 'install-missing-models', values: collectAllValues() });
      });
      document.getElementById('installOllama').addEventListener('click', () => vscode.postMessage({ command: 'install-ollama' }));

      for (const button of document.querySelectorAll('.test-local-agent')) {
        button.addEventListener('click', () => {
          const role = button.getAttribute('data-role');
          vscode.postMessage({
            command: 'test-local-agent',
            role,
            values: getRoleValues(role)
          });
        });
      }

      for (const button of document.querySelectorAll('.install-agent-model')) {
        button.addEventListener('click', () => {
          const role = button.getAttribute('data-role');
          vscode.postMessage({
            command: 'install-agent-model',
            role,
            values: getRoleValues(role)
          });
        });
      }
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
      javaParserUrl: String(values.javaParserUrl ?? this.currentValues.javaParserUrl),
      jqassistantUrl: String(values.jqassistantUrl ?? this.currentValues.jqassistantUrl),
      deterministicGraphUrl: String(values.deterministicGraphUrl ?? (this.currentValues as typeof this.currentValues & { deterministicGraphUrl?: string }).deterministicGraphUrl ?? ''),
      artifactRoot: String(values.artifactRoot ?? this.currentValues.artifactRoot),
      javaBasePackage: String(values.javaBasePackage ?? this.currentValues.javaBasePackage),
      reviewProvider,
      reviewMode: defaultReviewMode(reviewProvider),
      reviewModel: defaultReviewModel(reviewProvider),
    };

    await writeMcpConfigFile(persistedValues);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      const incomingLocalAgents = normalizeLocalAgentsInput(values.localAgents, this.currentEnrichmentValues.localAgents);
      const generalRole = incomingLocalAgents.generalEnrichment;
      this.currentEnrichmentValues = {
        ...this.currentEnrichmentValues,
        provider: generalRole.provider,
        capability: generalRole.capability,
        model: generalRole.model,
        ollamaEndpoint: generalRole.endpoint,
        localAgents: incomingLocalAgents,
      };
      await writeAgentorModelsConfig(workspaceRoot, this.currentEnrichmentValues);
    }
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
    void this.onChange?.();
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

  private async reloadEnrichmentConfig(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      this.currentEnrichmentValues = getDefaultAgentorModelsConfig();
      return;
    }
    this.currentEnrichmentValues = await readAgentorModelsConfig(workspaceRoot);
    const installed = await listInstalledOllamaModels(workspaceRoot, this.currentEnrichmentValues.ollamaEndpoint);
    this.installedOllamaModels = installed.ok ? new Set(installed.models) : new Set<string>();
    this.render();
  }

  private async testLocalAgent(role: LocalAgentConfigKey, values?: Record<string, unknown>): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showWarningMessage('Open a workspace first to test local agents.');
      return;
    }
    const override = values ? normalizeSingleRoleInput(values, this.currentEnrichmentValues.localAgents[role]) : undefined;
    const probe = await probeLocalAgentProvider(workspaceRoot, role, override);
    this.lastLocalAgentProbe[role] = [
      `${LOCAL_AGENT_LABELS[role]}: ${probe.ok ? 'ok' : 'failed'}`,
      probe.message,
    ];
    this.render();
    if (probe.ok) {
      vscode.window.showInformationMessage(`${LOCAL_AGENT_LABELS[role]} test completed.`);
    } else {
      vscode.window.showWarningMessage(`${LOCAL_AGENT_LABELS[role]} test failed: ${probe.message}`);
    }
  }

  private async installOllama(): Promise<void> {
    const terminal = vscode.window.createTerminal('AI Native Install Ollama');
    const command = resolveOllamaInstallCommand();
    terminal.show(true);
    if (command) {
      terminal.sendText(command, true);
      vscode.window.showInformationMessage('Opened terminal with Ollama install command.');
      return;
    }
    void vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
    vscode.window.showInformationMessage('Opened Ollama download page.');
  }

  private async installSelectedModel(role: LocalAgentConfigKey, values?: Record<string, unknown>): Promise<void> {
    const roleValues = values ? normalizeSingleRoleInput(values, this.currentEnrichmentValues.localAgents[role]) : this.currentEnrichmentValues.localAgents[role];
    if (roleValues.provider !== 'ollama') {
      vscode.window.showWarningMessage('Selected model install is currently supported for the Ollama provider only.');
      return;
    }
    const model = roleValues.model.trim();
    if (!model) {
      vscode.window.showWarningMessage('Select a model first.');
      return;
    }
    const terminal = vscode.window.createTerminal(`AI Native Install Model: ${model}`);
    terminal.show(true);
    terminal.sendText(resolveOllamaModelInstallCommand(model), true);
    vscode.window.showInformationMessage(`Opened terminal to install model ${model}.`);
  }

  private async installMissingSelectedModels(values?: Record<string, unknown>): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showWarningMessage('Open a workspace first to install models.');
      return;
    }
    const localAgents = normalizeLocalAgentsInput(values?.localAgents, this.currentEnrichmentValues.localAgents);
    const endpoint = [...new Set(Object.values(localAgents)
      .filter((role) => role.enabled && role.provider === 'ollama')
      .map((role) => role.endpoint.trim())
      .filter(Boolean))][0] ?? this.currentEnrichmentValues.ollamaEndpoint;
    const installed = await listInstalledOllamaModels(workspaceRoot, endpoint);
    if (!installed.ok) {
      vscode.window.showWarningMessage(`Could not query installed Ollama models: ${installed.message}`);
      return;
    }
    const installedSet = new Set(installed.models);
    const missingModels = [...new Set(Object.values(localAgents)
      .filter((role) => role.enabled && role.provider === 'ollama')
      .map((role) => role.model.trim())
      .filter((model) => model && !installedSet.has(model)))];
    if (missingModels.length === 0) {
      vscode.window.showInformationMessage('All selected Ollama models are already installed.');
      return;
    }
    const terminal = vscode.window.createTerminal('AI Native Install Missing Models');
    terminal.show(true);
    for (const model of missingModels) {
      terminal.sendText(resolveOllamaModelInstallCommand(model), true);
    }
    vscode.window.showInformationMessage(`Opened terminal to install ${missingModels.length} missing model(s).`);
  }
}

function normalizeProvider(value: string): AgentorModelsConfig['provider'] {
  return value === 'ollama' || value === 'cloud' ? value : 'none';
}

function normalizeCloudAgent(value: string): CloudAgentKind {
  return value === 'claude' ? 'claude' : 'codex';
}

function normalizeCapability(value: string): AgentorModelsConfig['capability'] {
  return value === 'low' || value === 'high' ? value : 'normal';
}

function normalizeSingleRoleInput(values: Record<string, unknown>, fallback: LocalAgentConfig): LocalAgentConfig {
  return {
    enabled: typeof values.enabled === 'boolean' ? values.enabled : fallback.enabled,
    provider: normalizeProvider(String(values.provider ?? fallback.provider)),
    cloudAgent: normalizeCloudAgent(String(values.cloudAgent ?? fallback.cloudAgent)),
    capability: normalizeCapability(String(values.capability ?? fallback.capability)),
    model: String(values.model ?? fallback.model).trim() || fallback.model,
    endpoint: String(values.endpoint ?? fallback.endpoint).trim() || fallback.endpoint,
    timeoutMs: positiveInteger(values.timeoutMs, fallback.timeoutMs),
    maxInputSize: positiveInteger(values.maxInputSize, fallback.maxInputSize),
    autoMerge: typeof values.autoMerge === 'boolean' ? values.autoMerge : fallback.autoMerge,
    minConfidence: normalizeConfidence(values.minConfidence, fallback.minConfidence),
  };
}

function normalizeLocalAgentsInput(
  raw: unknown,
  fallback: AgentorModelsConfig['localAgents'],
): AgentorModelsConfig['localAgents'] {
  const result = { ...fallback };
  const object = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  for (const key of getLocalAgentDefinitions().map((definition) => definition.key)) {
    const roleValues = object[key];
    result[key] = normalizeSingleRoleInput(
      roleValues && typeof roleValues === 'object' ? roleValues as Record<string, unknown> : {},
      fallback[key],
    );
  }
  return result;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function normalizeConfidence(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(2));
}


function resolveOllamaInstallCommand(): string | undefined {
  switch (process.platform) {
    case 'darwin':
      return 'brew install --cask ollama';
    case 'win32':
      return 'winget install Ollama.Ollama';
    case 'linux':
      return 'curl -fsSL https://ollama.com/install.sh | sh';
    default:
      return undefined;
  }
}

function resolveOllamaModelInstallCommand(model: string): string {
  if (process.platform === 'win32') {
    return `ollama pull "${model.replaceAll('"', '\\"')}"`;
  }
  return `ollama pull '${model.replaceAll("'", "'\\''")}'`;
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
