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

const LOCAL_AGENT_READABLE: Record<LocalAgentConfigKey, string> = {
  moduleClassifier: 'Module Classifier',
  generalEnrichment: 'General Enrichment',
  astComponentClassifier: 'AST Component Classifier',
  flowCandidate: 'Flow Candidate',
  repositoryPurpose: 'Repository Purpose',
  sqlMigrationSemantics: 'SQL Migration Semantics',
  componentPackaging: 'Component Packaging',
  validationTriage: 'Validation Triage',
  semanticPolishing: 'Semantic Polishing',
};

// Which flow panel step triggers this agent, and at what sub-phase
const AGENT_STEP: Record<LocalAgentConfigKey, { step: string; phase: string; desc: string }> = {
  astComponentClassifier: { step: 'Source Import', phase: 'AST', desc: 'Classifies Java classes by architectural role (controller, service, repository…)' },
  repositoryPurpose:      { step: 'Source Import', phase: 'Graph', desc: 'Identifies the business domain and purpose of each repository/module' },
  sqlMigrationSemantics:  { step: 'Source Import', phase: 'Graph', desc: 'Interprets SQL migration files into semantic data model descriptions' },
  flowCandidate:          { step: 'Source Import', phase: 'Flow', desc: 'Identifies candidate application flows and entry-point chains from call graphs' },
  componentPackaging:     { step: 'Source Import', phase: 'Flow', desc: 'Maps components to deployment units and packaging boundaries' },
  moduleClassifier:       { step: 'Source Import', phase: 'Enrichment', desc: 'Classifies Maven/Gradle modules into architectural layers' },
  generalEnrichment:      { step: 'Source Import', phase: 'Enrichment', desc: 'General-purpose semantic enrichment of components and relationships' },
  validationTriage:       { step: 'Source Import', phase: 'Enrichment', desc: 'Triages and prioritises semantic validation issues found during enrichment' },
  semanticPolishing:      { step: 'Source Import', phase: 'Semantic', desc: 'Final pass: polishes and consolidates the generated source.semantic.md draft' },
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
      const roleStatus = this.lastLocalAgentProbe[definition.key]?.join('\n') ?? '';
      const modelInstalled = role.provider === 'ollama' ? this.installedOllamaModels.has(role.model) : undefined;
      const modelStatusText = modelInstalled === undefined ? '' : modelInstalled ? '✓ installed' : '✗ not installed';
      const agentStep = AGENT_STEP[definition.key];
      return /* html */ `
        <div class="card agent-card">
          <div style="display:flex;align-items:center;gap:5px;margin-bottom:6px;flex-wrap:wrap;">
            <span class="section-tag" style="margin:0">${escapeHtml(agentStep.step)}</span>
            <span style="font-size:10px;color:var(--vscode-descriptionForeground);">phase: ${escapeHtml(agentStep.phase)}</span>
          </div>
          <div class="agent-header">
            <span class="agent-name">${escapeHtml(LOCAL_AGENT_READABLE[definition.key])}</span>
            <span class="agent-key muted">${escapeHtml(LOCAL_AGENT_LABELS[definition.key])}</span>
          </div>
          <p style="font-size:11px;color:var(--vscode-descriptionForeground);margin:4px 0 8px;">${escapeHtml(agentStep.desc)}</p>

          <label for="${definition.key}_provider">Provider</label>
          <select id="${definition.key}_provider" class="role-provider" data-role="${definition.key}">
            <option value="none" ${role.provider === 'none' ? 'selected' : ''}>none</option>
            <option value="ollama" ${role.provider === 'ollama' ? 'selected' : ''}>ollama</option>
          </select>

          <div class="ollama-fields" data-role="${definition.key}">
            <label for="${definition.key}_model">Model ${modelStatusText ? `<span class="model-status ${modelInstalled ? 'ok' : 'warn'}">${escapeHtml(modelStatusText)}</span>` : ''}</label>
            <select id="${definition.key}_model">
              ${modelCatalog.map((item) => `<option value="${escapeAttr(item.name)}" ${item.name === role.model ? 'selected' : ''}>${escapeHtml(item.name)} (${escapeHtml(item.capabilities.join(' / '))})</option>`).join('')}
            </select>

            <label for="${definition.key}_endpoint">Ollama endpoint</label>
            <input id="${definition.key}_endpoint" type="text" value="${escapeAttr(role.endpoint)}" />

            <div class="row-2">
              <div>
                <label for="${definition.key}_timeoutMs">Timeout (ms)</label>
                <input id="${definition.key}_timeoutMs" type="number" value="${escapeAttr(String(role.timeoutMs))}" />
              </div>
              <div>
                <label for="${definition.key}_maxInputSize">Max input size</label>
                <input id="${definition.key}_maxInputSize" type="number" value="${escapeAttr(String(role.maxInputSize))}" />
              </div>
            </div>
          </div>

          <div class="row-2">
            <div>
              <label for="${definition.key}_capability">Capability</label>
              <select id="${definition.key}_capability" data-role="${definition.key}" class="role-capability">
                <option value="low" ${role.capability === 'low' ? 'selected' : ''}>low</option>
                <option value="normal" ${role.capability === 'normal' ? 'selected' : ''}>normal</option>
                <option value="high" ${role.capability === 'high' ? 'selected' : ''}>high</option>
              </select>
            </div>
            <div>
              <label for="${definition.key}_minConfidence">Min confidence</label>
              <input id="${definition.key}_minConfidence" type="number" step="0.01" min="0" max="1" value="${escapeAttr(String(role.minConfidence))}" />
            </div>
          </div>

          <div class="card-actions">
            <button class="btn-secondary test-local-agent" data-role="${definition.key}">Test</button>
            <button class="btn-secondary install-agent-model ollama-action" data-role="${definition.key}">Install model</button>
          </div>
          ${roleStatus ? `<pre class="status-log">${escapeHtml(roleStatus)}</pre>` : ''}
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
      * { box-sizing: border-box; }
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px 24px 40px; max-width: 1200px; }
      h2 { margin: 28px 0 4px; font-size: 14px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
      h2:first-child { margin-top: 0; }
      .section-desc { font-size: 12px; color: var(--vscode-descriptionForeground); margin: 0 0 12px; }
      .section-tag { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 3px; background: #e8ab5d22; color: #e8ab5d; border: 1px solid #e8ab5d55; margin-left: 8px; vertical-align: middle; letter-spacing: 0.2px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
      .agent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; align-items: start; }
      .card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 14px 16px; background: var(--vscode-editor-background); }
      label { display: block; margin-top: 10px; font-size: 12px; font-weight: 600; }
      input[type="text"], input[type="number"], select { width: 100%; margin-top: 4px; padding: 6px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 4px; font-family: var(--vscode-font-family); font-size: 12px; }
      .checkbox-row { display: flex; align-items: center; gap: 8px; cursor: pointer; }
      .checkbox-row input { width: auto; margin-top: 0; }
      button { padding: 6px 12px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 5px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 12px; font-weight: 600; cursor: pointer; }
      button:hover { background: var(--vscode-button-hoverBackground); }
      .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-color: var(--vscode-button-secondaryBorder, var(--vscode-panel-border)); }
      .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
      .btn-save { min-width: 80px; }
      code { background: var(--vscode-textBlockQuote-background); padding: 2px 5px; border-radius: 3px; font-size: 11px; }
      pre.status-log { background: var(--vscode-textBlockQuote-background); padding: 8px 10px; border-radius: 5px; overflow-x: auto; font-size: 11px; margin: 10px 0 0; white-space: pre-wrap; word-break: break-all; }
      .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
      .hidden { display: none; }
      .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .section-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
      .card-actions { display: flex; gap: 6px; margin-top: 12px; }
      .agent-card { padding: 12px 14px; }
      .agent-header { margin-bottom: 4px; }
      .agent-name { font-size: 13px; font-weight: 700; display: block; }
      .agent-key { font-size: 10px; font-family: monospace; display: block; margin-top: 1px; }
      .model-status { font-size: 10px; font-weight: 400; margin-left: 6px; }
      .model-status.ok { color: #5cb85c; }
      .model-status.warn { color: #e8ab5d; }
      .header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
      .header-row h1 { margin: 0; font-size: 16px; }
      .preset-row { display: flex; align-items: flex-end; gap: 8px; }
      .preset-row select { width: auto; min-width: 90px; }
      .preset-hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
    </style>
  </head>
  <body>

    <!-- Header -->
    <div class="header-row">
      <h1>Settings</h1>
      <button class="btn-save" id="save">Save</button>
    </div>

    <!-- Cloud AI Provider -->
    <h2>AI Review Provider
      <span class="section-tag">Semantic Enrichment</span>
      <span class="section-tag">Flow Extraction</span>
      <span class="section-tag">Generate Graph → AI Review</span>
    </h2>
    <p class="section-desc">Claude or Codex CLI — shared by Semantic Enrichment, Flow Extraction, and the AI Review sub-step in Generate Graph. Provider CLI must be available on this machine.</p>
    <div class="grid" style="margin-bottom:8px;">
      <div class="card">
        <label for="reviewProvider">Provider</label>
        <select id="reviewProvider">
          <option value="codex" ${config.reviewProvider !== 'claude' ? 'selected' : ''}>codex</option>
          <option value="claude" ${config.reviewProvider === 'claude' ? 'selected' : ''}>claude</option>
        </select>
        <p class="muted" style="margin-top:8px;">CLI: ${escapeHtml(agentStatus)}</p>
        <div class="card-actions">
          <button class="btn-secondary" id="testAgent">Test AI Review</button>
        </div>
        ${this.lastAgentProbe.length ? `<pre class="status-log">${escapeHtml(this.lastAgentProbe.join('\n'))}</pre>` : ''}
      </div>
    </div>

    <!-- MCP Services -->
    <h2>MCP Services</h2>
    <p class="section-desc">HTTP endpoints for the running MCP servers. Edit only if you changed the default ports.</p>
    <div class="card" style="margin-bottom:8px;">
      <div class="grid" style="gap:10px;">
        <div>
          <label for="semanticCoreUrl">semantic-core</label>
          <input id="semanticCoreUrl" type="text" value="${escapeAttr(config.semanticCoreUrl)}" />
        </div>
        <div>
          <label for="validatorUrl">validator</label>
          <input id="validatorUrl" type="text" value="${escapeAttr(config.validatorUrl)}" />
        </div>
        <div>
          <label for="compilerUrl">compiler</label>
          <input id="compilerUrl" type="text" value="${escapeAttr(config.compilerUrl)}" />
        </div>
        <div>
          <label for="javaParserUrl">java-parser</label>
          <input id="javaParserUrl" type="text" value="${escapeAttr(config.javaParserUrl)}" />
        </div>
        <div>
          <label for="jqassistantUrl">jqassistant</label>
          <input id="jqassistantUrl" type="text" value="${escapeAttr(config.jqassistantUrl)}" />
        </div>
        <div>
          <label for="documentImportUrl">document-import</label>
          <input id="documentImportUrl" type="text" value="${escapeAttr(config.documentImportUrl)}" />
        </div>
      </div>
      <div class="card-actions">
        <button class="btn-secondary" id="testMcp">Test MCP servers</button>
      </div>
      ${this.lastMcpStatus.length ? `<pre class="status-log">${escapeHtml(this.lastMcpStatus.join('\n'))}</pre>` : ''}
    </div>

    <!-- General -->
    <h2>General</h2>
    <div class="grid" style="margin-bottom:8px;">
      <div class="card">
        <label for="artifactRoot">Artifact root</label>
        <input id="artifactRoot" type="text" value="${escapeAttr(config.artifactRoot)}" />
      </div>
      <div class="card">
        <label for="javaBasePackage">Java base package</label>
        <input id="javaBasePackage" type="text" value="${escapeAttr(config.javaBasePackage)}" />
      </div>
    </div>

    <!-- Local AI Agents -->
    <h2>Local AI Agents
      <span class="section-tag">Source Import → Local AI Agents</span>
    </h2>
    <p class="section-desc">Ollama-based enrichment used by the Local AI Agents sub-option in Source Import. Each role uses its own model — config saved to <code>.ai-native/config/models.yaml</code>.</p>
    <div class="section-actions">
      <div class="preset-row">
        <select id="bulkPreset">
          <option value="low">low</option>
          <option value="normal" selected>normal</option>
          <option value="high">high</option>
        </select>
        <button class="btn-secondary" id="applyBulkPreset">Apply preset to all</button>
      </div>

      <button class="btn-secondary" id="installMissingModels">Install missing models</button>
      <button class="btn-secondary" id="installOllama">Install Ollama</button>
    </div>
    <div class="agent-grid">${agentCards}</div>

    <div style="margin-top:24px;display:flex;justify-content:flex-end;">
      <button class="btn-save" id="save2">Save</button>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const localAgentDefinitions = ${JSON.stringify(agentDefinitions.map((definition) => definition.key))};
      const roleModelPresets = ${JSON.stringify(ROLE_MODEL_PRESETS)};
      const roleDefaults = ${JSON.stringify(defaultRoleConfig)};

      function getRoleValues(role) {
        return {
          enabled: true,
          provider: document.getElementById(role + '_provider').value,
          capability: document.getElementById(role + '_capability').value,
          model: document.getElementById(role + '_model').value,
          endpoint: document.getElementById(role + '_endpoint').value,
          timeoutMs: Number(document.getElementById(role + '_timeoutMs').value || 0),
          maxInputSize: Number(document.getElementById(role + '_maxInputSize').value || 0),
          minConfidence: Number(document.getElementById(role + '_minConfidence').value || 0)
        };
      }

      function applyBulkPreset(preset) {
        for (const role of localAgentDefinitions) {
          const defaults = roleDefaults[role];
          const model = roleModelPresets[role]?.[preset] || defaults.model;
          document.getElementById(role + '_provider').value = defaults.provider;
          document.getElementById(role + '_capability').value = preset;
          document.getElementById(role + '_model').value = model;
          document.getElementById(role + '_endpoint').value = defaults.endpoint;
          document.getElementById(role + '_timeoutMs').value = String(defaults.timeoutMs);
          document.getElementById(role + '_maxInputSize').value = String(defaults.maxInputSize);
          document.getElementById(role + '_minConfidence').value = String(defaults.minConfidence);
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
          documentImportUrl: document.getElementById('documentImportUrl').value,
          artifactRoot: document.getElementById('artifactRoot').value,
          javaBasePackage: document.getElementById('javaBasePackage').value,
          localAgents
        };
      }

      function updateProviderVisibility(role) {
        const provider = document.getElementById(role + '_provider').value;
        const ollamaFields = document.querySelector('.ollama-fields[data-role="' + role + '"]');
        const installBtn = document.querySelector('.install-agent-model.ollama-action[data-role="' + role + '"]');
        const isOllama = provider === 'ollama';
        ollamaFields.classList.toggle('hidden', !isOllama);
        installBtn.classList.toggle('hidden', !isOllama);
      }

      for (const role of localAgentDefinitions) {
        updateProviderVisibility(role);
        document.getElementById(role + '_provider').addEventListener('change', () => updateProviderVisibility(role));

        const capabilityElement = document.getElementById(role + '_capability');
        const modelElement = document.getElementById(role + '_model');
        capabilityElement.addEventListener('change', () => {
          const recommended = roleModelPresets[role]?.[capabilityElement.value];
          if (recommended) modelElement.value = recommended;
        });
      }

      function doSave() { vscode.postMessage({ command: 'save', values: collectAllValues() }); }
      document.getElementById('save').addEventListener('click', doSave);
      document.getElementById('save2').addEventListener('click', doSave);
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
          vscode.postMessage({ command: 'test-local-agent', role, values: getRoleValues(role) });
        });
      }

      for (const button of document.querySelectorAll('.install-agent-model')) {
        button.addEventListener('click', () => {
          const role = button.getAttribute('data-role');
          vscode.postMessage({ command: 'install-agent-model', role, values: getRoleValues(role) });
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
      documentImportUrl: String(values.documentImportUrl ?? this.currentValues.documentImportUrl),
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
    await this.onChange?.();
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
  return value === 'ollama' ? value : 'none';
}

function normalizeCapability(value: string): AgentorModelsConfig['capability'] {
  return value === 'low' || value === 'high' ? value : 'normal';
}

function normalizeSingleRoleInput(values: Record<string, unknown>, fallback: LocalAgentConfig): LocalAgentConfig {
  return {
    enabled: typeof values.enabled === 'boolean' ? values.enabled : fallback.enabled,
    provider: normalizeProvider(String(values.provider ?? fallback.provider)),
    capability: normalizeCapability(String(values.capability ?? fallback.capability)),
    model: String(values.model ?? fallback.model).trim() || fallback.model,
    endpoint: String(values.endpoint ?? fallback.endpoint).trim() || fallback.endpoint,
    timeoutMs: positiveInteger(values.timeoutMs, fallback.timeoutMs),
    maxInputSize: positiveInteger(values.maxInputSize, fallback.maxInputSize),
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
