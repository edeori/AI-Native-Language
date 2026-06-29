import * as vscode from 'vscode';
import { commandIds } from '../constants.js';
import { getConfig } from '../config.js';

export class FlowWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  postFlowExtractionResult(flows: number, processes: number, sources: { fromDocs: number; fromGraph: number; fromExisting: number }): void {
    this.view?.webview.postMessage({ type: 'flowExtractionResult', flows, processes, sources });
  }

  refreshHtml(): void {
    if (this.view) this.view.webview.html = this.render(this.view.webview);
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (message) => {
      const ollamaEnabled: boolean = message.ollamaEnabled ?? false;
      const aiReviewEnabled: boolean = message.aiReviewEnabled ?? false;
      const flowAiEnabled: boolean = message.flowAiEnabled ?? false;
      const semanticLocalEnabled: boolean = message.semanticLocalEnabled ?? false;
      const semanticCloudEnabled: boolean = message.semanticCloudEnabled ?? false;

      const jqassistantEnabled: boolean = message.jqassistantEnabled ?? false;
      const sourceCloudEnabled: boolean = message.sourceCloudEnabled ?? false;

      const enabledSteps: string[] = message.steps ?? (message.stepId ? [message.stepId] : []);

      const dispatch = async (stepId: string): Promise<void> => {
        switch (stepId) {
          case 'jqassistant':
            await vscode.commands.executeCommand(commandIds.runJqassistantScan);
            break;
          case 'activate':
            await vscode.commands.executeCommand(commandIds.importSourceProject, { ollamaEnabled, jqassistantEnabled, sourceCloudEnabled, enabledSteps });
            break;
          case 'ai-enrichment':
            await vscode.commands.executeCommand(commandIds.runAiEnrichment, { ollamaEnabled: semanticLocalEnabled, cloudEnabled: semanticCloudEnabled });
            break;
          case 'flow-extraction':
            await vscode.commands.executeCommand(commandIds.runFlowExtraction, { flowAiEnabled });
            break;
          case 'graph':
            await vscode.commands.executeCommand(commandIds.generateCanonicalGraph, { aiReviewEnabled });
            break;
        }
      };

      if (message?.type === 'runStep') {
        await dispatch(message.stepId);
      } else if (message?.type === 'runFlow') {
        for (const stepId of (message.steps ?? []) as string[]) {
          await dispatch(stepId);
        }
      }
    });
    webviewView.webview.html = this.render(webviewView.webview);
  }

  private render(webview: vscode.Webview): string {
    const cspSource = webview.cspSource;
    const scriptNonce = nonce();
    const config = getConfig();
    const cloudLabel = config.reviewProvider === 'claude' ? '☁ Claude' : '☁ Codex';
    return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Import Source</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        margin: 0;
        padding: 12px 10px;
        background: var(--vscode-sideBar-background);
      }

      .step-card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        background: var(--vscode-editor-background);
        padding: 9px 10px;
      }
      .step-card.disabled { opacity: 0.45; }

      .step-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      .step-toggle {
        display: flex;
        align-items: center;
        gap: 7px;
        cursor: pointer;
        flex: 1;
        min-width: 0;
      }
      .step-check {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        accent-color: var(--vscode-button-background);
        cursor: pointer;
      }
      .step-label {
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .step-desc {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-top: 4px;
        line-height: 1.4;
        padding-left: 21px;
      }

      /* sub-option (Local AI Agents inside Source Import) */
      .sub-option {
        display: flex;
        align-items: center;
        gap: 7px;
        margin-top: 8px;
        padding: 5px 8px;
        border-radius: 5px;
        background: var(--vscode-sideBar-background);
        border: 1px solid var(--vscode-panel-border);
        cursor: pointer;
      }
      .sub-check {
        width: 13px;
        height: 13px;
        flex-shrink: 0;
        cursor: pointer;
      }
      .sub-check.ollama { accent-color: #e8ab5d; }
      .sub-label {
        font-size: 11px;
        font-weight: 600;
        flex: 1;
      }

      /* badges */
      .badge {
        font-size: 9px;
        padding: 1px 5px;
        border-radius: 3px;
        font-weight: 700;
        flex-shrink: 0;
        letter-spacing: 0.3px;
      }
      .badge-ai { background: #e8ab5d; color: #000; }
      .badge-cloud { background: #4da6ff22; color: #4da6ff; border: 1px solid #4da6ff44; }
      .badge-local { background: #e8ab5d22; color: #e8ab5d; border: 1px solid #e8ab5d55; }

      .sub-desc {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        padding-left: 21px;
        margin-top: 3px;
        line-height: 1.3;
      }

      .run-step {
        flex-shrink: 0;
        padding: 3px 7px;
        border: 1px solid var(--vscode-button-secondaryBorder, var(--vscode-panel-border));
        border-radius: 5px;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        font-size: 11px;
        cursor: pointer;
        line-height: 1;
      }
      .run-step:hover { background: var(--vscode-button-secondaryHoverBackground); }

      .flow-connector {
        display: flex;
        flex-direction: column;
        align-items: center;
        height: 22px;
        justify-content: center;
      }
      .flow-line { width: 1px; flex: 1; background: var(--vscode-panel-border); }
      .flow-arrow { font-size: 10px; color: var(--vscode-descriptionForeground); line-height: 1; }

      .run-flow-btn {
        width: 100%;
        margin-top: 14px;
        padding: 8px 10px;
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 8px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        font-weight: 700;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      .run-flow-btn:hover { background: var(--vscode-button-hoverBackground); }
    </style>
  </head>
  <body>

    <!-- Step 1: Source Import (includes jQAssistant Scan as sub-step) -->
    <div class="step-card" id="card-activate">
      <div class="step-header">
        <label class="step-toggle">
          <input type="checkbox" class="step-check" id="check-activate" checked />
          <span class="step-label">Source Import</span>
        </label>
        <button class="run-step" id="run-activate">▶</button>
      </div>
      <div class="step-desc">Java AST, project analysis, code graph</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:8px;">
        <label class="sub-option" style="flex:1;margin-top:0;">
          <input type="checkbox" class="sub-check" id="check-jqassistant" checked />
          <span class="sub-label">jQAssistant Scan</span>
          <span class="badge badge-local">⬡ Bytecode</span>
        </label>
        <button class="run-step" id="run-jqassistant">▶</button>
      </div>
      <div class="sub-desc">Maven module, bytecode &amp; call graph analysis — runs before import</div>
      <label class="sub-option" style="margin-top:4px;">
        <input type="checkbox" class="sub-check ollama" id="check-ollama" />
        <span class="sub-label">Local AI Agents</span>
        <span class="badge badge-local">⬡ Agents</span>
      </label>
      <div class="sub-desc">Ollama or Cloud per role — configure in Settings → Local AI Agents</div>
      <label class="sub-option" style="margin-top:4px;">
        <input type="checkbox" class="sub-check" id="check-source-cloud" />
        <span class="sub-label">Cloud AI</span>
        <span class="badge badge-cloud">${cloudLabel}</span>
      </label>
      <div class="sub-desc">Cloud enrichment pass during import — configure in Settings → AI Review Provider</div>
    </div>

    <div class="flow-connector"><div class="flow-line"></div><div class="flow-arrow">▼</div></div>

    <!-- Step 3: AI Enrichment -->
    <div class="step-card" id="card-ai-enrichment">
      <div class="step-header">
        <label class="step-toggle">
          <input type="checkbox" class="step-check" id="check-ai-enrichment" />
          <span class="step-label">Semantic Enrichment</span>
        </label>
        <button class="run-step" id="run-ai-enrichment">▶</button>
      </div>
      <div class="step-desc">Re-generates source.semantic.md from cached AST &amp; graph artifacts</div>
      <label class="sub-option">
        <input type="checkbox" class="sub-check ollama" id="check-semantic-local" />
        <span class="sub-label">Local AI Agents</span>
        <span class="badge badge-local">⬡ Agents</span>
      </label>
      <div class="sub-desc">Runs Semantic Polishing agent — configure in Settings → Local AI Agents</div>
      <label class="sub-option" style="margin-top:4px;">
        <input type="checkbox" class="sub-check" id="check-semantic-cloud" />
        <span class="sub-label">Cloud AI</span>
        <span class="badge badge-cloud">${cloudLabel}</span>
      </label>
      <div class="sub-desc">Cloud enrichment pass — configure in Settings → AI Review Provider</div>
    </div>

    <div class="flow-connector"><div class="flow-line"></div><div class="flow-arrow">▼</div></div>

    <!-- Step 4: Flow Extraction -->
    <div class="step-card" id="card-flow-extraction">
      <div class="step-header">
        <label class="step-toggle">
          <input type="checkbox" class="step-check" id="check-flow-extraction" />
          <span class="step-label">Flow Extraction</span>
        </label>
        <button class="run-step" id="run-flow-extraction">▶</button>
      </div>
      <div class="step-desc"
        title="Reads: doc-entities.json + graph.json + existing source.semantic.md&#10;Writes: updates # processes and # data_flows sections in source.semantic.md&#10;AI Synthesis: cloud AI enhances flow sections after deterministic merge">
        Merges flows &amp; processes from graph, AST and imported docs
      </div>
      <label class="sub-option">
        <input type="checkbox" class="sub-check" id="check-flow-ai" />
        <span class="sub-label">AI Synthesis</span>
        <span class="badge badge-cloud">${cloudLabel}</span>
      </label>
      <div class="sub-desc">AI enhances flows after merge — configure in Settings → AI Review Provider</div>
      <div id="flow-extraction-result" style="display:none;font-size:10px;color:var(--vscode-descriptionForeground);padding-left:21px;margin-top:4px;"></div>
    </div>

    <div class="flow-connector"><div class="flow-line"></div><div class="flow-arrow">▼</div></div>

    <!-- Step 5: Generate Graph -->
    <div class="step-card" id="card-graph">
      <div class="step-header">
        <label class="step-toggle">
          <input type="checkbox" class="step-check" id="check-graph" checked />
          <span class="step-label">Generate Graph</span>
        </label>
        <button class="run-step" id="run-graph">▶</button>
      </div>
      <div class="step-desc">Canonical semantic graph from source.semantic.md</div>
      <label class="sub-option">
        <input type="checkbox" class="sub-check" id="check-ai-review" />
        <span class="sub-label">AI Review</span>
        <span class="badge badge-cloud">${cloudLabel}</span>
      </label>
      <div class="sub-desc">Agentic graph review — configure in Settings → AI Review Provider</div>
    </div>

    <button class="run-flow-btn" id="runFlowBtn">▶ Run Selected Steps</button>

    <script nonce="${scriptNonce}">
      const vscode = acquireVsCodeApi();
      const STEP_IDS = ['activate', 'ai-enrichment', 'flow-extraction', 'graph'];

      // restore persisted state
      const saved = vscode.getState() ?? {};
      for (const id of STEP_IDS) {
        const cb = document.getElementById('check-' + id);
        if (id in saved) cb.checked = saved[id];
        document.getElementById('card-' + id).classList.toggle('disabled', !cb.checked);
      }
      if ('jqassistant' in saved) document.getElementById('check-jqassistant').checked = saved.jqassistant;
      if ('ollama' in saved) document.getElementById('check-ollama').checked = saved.ollama;
      if ('sourceCloud' in saved) document.getElementById('check-source-cloud').checked = saved.sourceCloud;
      if ('aiReview' in saved) document.getElementById('check-ai-review').checked = saved.aiReview;
      if ('flowAi' in saved) document.getElementById('check-flow-ai').checked = saved.flowAi;
      if ('semanticLocal' in saved) document.getElementById('check-semantic-local').checked = saved.semanticLocal;
      if ('semanticCloud' in saved) document.getElementById('check-semantic-cloud').checked = saved.semanticCloud;
      if (saved.flowExtractionResult) showFlowResult(saved.flowExtractionResult);

      function showFlowResult(r) {
        const el = document.getElementById('flow-extraction-result');
        if (!el) return;
        el.textContent = 'Last run: ' + r.flows + ' flow(s), ' + r.processes + ' process(es)'
          + ' — docs: ' + r.sources.fromDocs + ', graph: ' + r.sources.fromGraph + ', existing: ' + r.sources.fromExisting;
        el.style.display = 'block';
      }

      function saveState() {
        const state = {
          jqassistant: document.getElementById('check-jqassistant').checked,
          ollama: document.getElementById('check-ollama').checked,
          sourceCloud: document.getElementById('check-source-cloud').checked,
          aiReview: document.getElementById('check-ai-review').checked,
          flowAi: document.getElementById('check-flow-ai').checked,
          semanticLocal: document.getElementById('check-semantic-local').checked,
          semanticCloud: document.getElementById('check-semantic-cloud').checked,
        };
        for (const id of STEP_IDS) state[id] = document.getElementById('check-' + id).checked;
        vscode.setState(state);
      }

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg?.type === 'flowExtractionResult') {
          const result = { flows: msg.flows, processes: msg.processes, sources: msg.sources };
          showFlowResult(result);
          const s = vscode.getState() ?? {};
          vscode.setState({ ...s, flowExtractionResult: result });
        }
      });

      for (const id of STEP_IDS) {
        const cb = document.getElementById('check-' + id);
        cb.addEventListener('change', () => {
          document.getElementById('card-' + id).classList.toggle('disabled', !cb.checked);
          saveState();
        });
      }
      document.getElementById('check-jqassistant').addEventListener('change', saveState);
      document.getElementById('check-ollama').addEventListener('change', () => {
        if (document.getElementById('check-ollama').checked) document.getElementById('check-source-cloud').checked = false;
        saveState();
      });
      document.getElementById('check-source-cloud').addEventListener('change', () => {
        if (document.getElementById('check-source-cloud').checked) document.getElementById('check-ollama').checked = false;
        saveState();
      });
      document.getElementById('check-ai-review').addEventListener('change', saveState);
      document.getElementById('check-flow-ai').addEventListener('change', saveState);
      document.getElementById('check-semantic-local').addEventListener('change', () => {
        if (document.getElementById('check-semantic-local').checked) document.getElementById('check-semantic-cloud').checked = false;
        saveState();
      });
      document.getElementById('check-semantic-cloud').addEventListener('change', () => {
        if (document.getElementById('check-semantic-cloud').checked) document.getElementById('check-semantic-local').checked = false;
        saveState();
      });

      const jqassistantEnabled = () => document.getElementById('check-jqassistant').checked;
      const ollamaEnabled = () => document.getElementById('check-ollama').checked;
      const sourceCloudEnabled = () => document.getElementById('check-source-cloud').checked;
      const aiReviewEnabled = () => document.getElementById('check-ai-review').checked;
      const flowAiEnabled = () => document.getElementById('check-flow-ai').checked;
      const semanticLocalEnabled = () => document.getElementById('check-semantic-local').checked;
      const semanticCloudEnabled = () => document.getElementById('check-semantic-cloud').checked;

      document.getElementById('run-jqassistant').addEventListener('click', () =>
        vscode.postMessage({ type: 'runStep', stepId: 'jqassistant' }));
      document.getElementById('run-activate').addEventListener('click', () =>
        vscode.postMessage({ type: 'runStep', stepId: 'activate', jqassistantEnabled: jqassistantEnabled(), ollamaEnabled: ollamaEnabled(), sourceCloudEnabled: sourceCloudEnabled() }));
      document.getElementById('run-ai-enrichment').addEventListener('click', () =>
        vscode.postMessage({ type: 'runStep', stepId: 'ai-enrichment', semanticLocalEnabled: semanticLocalEnabled(), semanticCloudEnabled: semanticCloudEnabled() }));
      document.getElementById('run-flow-extraction').addEventListener('click', () =>
        vscode.postMessage({ type: 'runStep', stepId: 'flow-extraction', flowAiEnabled: flowAiEnabled() }));
      document.getElementById('run-graph').addEventListener('click', () =>
        vscode.postMessage({ type: 'runStep', stepId: 'graph', aiReviewEnabled: aiReviewEnabled() }));

      document.getElementById('runFlowBtn').addEventListener('click', () => {
        const steps = STEP_IDS.filter((id) => document.getElementById('check-' + id).checked);
        if (steps.length === 0) return;
        vscode.postMessage({ type: 'runFlow', steps, jqassistantEnabled: jqassistantEnabled(), ollamaEnabled: ollamaEnabled(), sourceCloudEnabled: sourceCloudEnabled(), aiReviewEnabled: aiReviewEnabled(), flowAiEnabled: flowAiEnabled(), semanticLocalEnabled: semanticLocalEnabled(), semanticCloudEnabled: semanticCloudEnabled() });
      });
    </script>
  </body>
</html>`;
  }
}

function nonce(): string {
  return Math.random().toString(36).slice(2);
}
