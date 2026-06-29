import * as vscode from 'vscode';

export type ReconTaskStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ReconRunStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface ReconRunModuleSnapshot {
  moduleRoot: string;
  status: ReconTaskStatus;
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  bridgeAction?: string;
  artifactPath?: string;
  promptPath?: string;
  notes?: string[];
  issues?: number;
  error?: string;
}

export interface ReconRunEventSnapshot {
  at: string;
  kind: 'phase' | 'project' | 'module' | 'artifact' | 'error';
  message: string;
  moduleRoot?: string;
}

export interface ReconRunSnapshot {
  runId: string;
  projectName: string;
  projectRoot: string;
  outputDir: string;
  status: ReconRunStatus;
  phase: string;
  startedAt: string;
  finishedAt?: string;
  enabledSteps?: string[];
  jqassistantStatus?: ReconTaskStatus | 'off';
  astStatus?: ReconTaskStatus;
  astStartedAt?: string;
  astFinishedAt?: string;
  astArtifactPath?: string;
  astFileCount?: number;
  analysisStatus?: ReconTaskStatus;
  analysisStartedAt?: string;
  analysisFinishedAt?: string;
  analysisPhase?: string;
  codeGraphStatus?: ReconTaskStatus;
  codeGraphStartedAt?: string;
  codeGraphFinishedAt?: string;
  codeGraphArtifactPath?: string;
  codeGraphProgressPath?: string;
  codeGraphProgressUpdatedAt?: string;
  codeGraphHeartbeatCount?: number;
  codeGraphPhase?: string;
  aiEnrichmentEnabled?: boolean;
  aiEnrichmentStatus?: ReconTaskStatus | 'off';
  localAgentStatus?: ReconTaskStatus | 'off';
  localAgentStartedAt?: string;
  localAgentFinishedAt?: string;
  localAgentPhase?: string;
  projectPromptStatus: ReconTaskStatus;
  projectPromptStartedAt?: string;
  projectPromptFinishedAt?: string;
  projectPromptSummary?: string;
  projectPromptBridge?: string;
  projectPromptArtifactPath?: string;
  moduleRuns: ReconRunModuleSnapshot[];
  activeTask?: string;
  activeModuleRoot?: string;
  events?: ReconRunEventSnapshot[];
  artifactRoot?: string;
}

export class ReconRunsWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private snapshot: ReconRunSnapshot | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  refresh(): void {
    this.view?.webview.postMessage({ type: 'render', snapshot: this.snapshot });
    if (this.view) {
      this.view.webview.html = this.render();
    }
  }

  getSnapshot(): ReconRunSnapshot | undefined {
    return this.snapshot;
  }

  setSnapshot(snapshot: ReconRunSnapshot | undefined): void {
    this.snapshot = snapshot;
    this.refresh();
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
      webviewView.webview.onDidReceiveMessage(async (message) => {
        if (message?.command === 'open-artifacts') {
          await vscode.commands.executeCommand('aiNative.openArtifactsFolder');
        }
        if (message?.command === 'open-actions') {
          await vscode.commands.executeCommand('aiNative.openDashboard');
        }
      });
    webviewView.webview.html = this.render();
  }

  private render(): string {
    const cspSource = this.view?.webview.cspSource ?? '';
    const nonce = createNonce();
    const snapshot = this.snapshot;
    const runningModule = snapshot?.moduleRuns?.find((module) => module.status === 'running');
    const events = snapshot?.events?.slice(-8) ?? [];
    const enabled = new Set(snapshot?.enabledSteps ?? ['jqassistant', 'activate']);
    const showAll = !snapshot?.enabledSteps;

    // Source Import internal sub-status: worst-case of ast/analysis/graph
    const sourceImportStatus = (() => {
      const sub = [snapshot?.astStatus, snapshot?.analysisStatus, snapshot?.codeGraphStatus];
      if (sub.some((s) => s === 'failed')) return 'failed';
      if (sub.some((s) => s === 'running')) return 'running';
      if (sub.every((s) => s === 'completed')) return 'completed';
      return 'pending';
    })();
    const sourceImportDetail = (() => {
      if (snapshot?.codeGraphArtifactPath) {
        const files = snapshot.astFileCount ? ` · ${snapshot.astFileCount} files` : '';
        const modules = snapshot.moduleRuns?.length ? ` · ${snapshot.moduleRuns.length} modules` : '';
        return `AST${files}, analysis, code graph ready${modules}`;
      }
      if (snapshot?.analysisPhase) return snapshot.analysisPhase;
      if (snapshot?.codeGraphPhase) return snapshot.codeGraphPhase;
      if (snapshot?.astArtifactPath) return `AST indexed${snapshot.astFileCount ? ` (${snapshot.astFileCount} files)` : ''}, analysis running`;
      return 'AST parsing, deterministic analysis and code graph build';
    })();

    const stages: Array<{ label: string; status: string; detail: string; show: boolean }> = [
      {
        label: 'jQAssistant Scan',
        status: snapshot?.jqassistantStatus ?? 'pending',
        detail: snapshot?.jqassistantStatus === 'completed'
          ? 'Bytecode, Maven module and call graph scan complete.'
          : snapshot?.jqassistantStatus === 'running'
            ? 'Scanning bytecode and Maven module graph…'
            : snapshot?.jqassistantStatus === 'off'
              ? 'Skipped — jQAssistant scan was not selected.'
              : 'Maven module, bytecode and call graph analysis.',
        show: showAll || enabled.has('jqassistant'),
      },
      {
        label: 'Source Import',
        status: sourceImportStatus,
        detail: sourceImportDetail,
        show: showAll || enabled.has('activate'),
      },
      {
        label: 'Local AI Agents',
        status: snapshot?.localAgentStatus ?? 'pending',
        detail: snapshot?.localAgentStatus === 'off'
          ? 'Skipped — Local AI Agents was not selected.'
          : snapshot?.localAgentPhase ?? 'Local enrichment agents (flow candidates, service roles).',
        show: showAll || enabled.has('activate'),
      },
      {
        label: 'Semantic Enrichment',
        status: snapshot?.aiEnrichmentStatus ?? 'pending',
        detail: snapshot?.aiEnrichmentStatus === 'off'
          ? 'Skipped — Semantic Enrichment was not selected.'
          : snapshot?.aiEnrichmentStatus === 'completed'
            ? 'Cloud AI enrichment pass complete.'
            : 'Re-generates source.semantic.md from cached artifacts.',
        show: showAll || enabled.has('ai-enrichment'),
      },
      {
        label: 'Flow Extraction',
        status: 'pending',
        detail: 'Merges flows and processes from graph, AST and imported docs.',
        show: enabled.has('flow-extraction'),
      },
      {
        label: 'Generate Graph',
        status: snapshot?.status === 'completed' ? 'completed' : snapshot?.status === 'failed' ? 'failed' : 'pending',
        detail: snapshot?.status === 'completed'
          ? 'Canonical semantic graph and review artifacts ready.'
          : 'Canonical semantic graph from source.semantic.md.',
        show: showAll || enabled.has('graph'),
      },
    ];
    const finalOutputStatus = snapshot?.status === 'completed' ? 'completed' : snapshot?.status === 'failed' ? 'failed' : 'pending';
    const moduleCards = snapshot?.moduleRuns?.length
      ? snapshot.moduleRuns
          .map(
            (module) => `
              <div class="module-card ${module.status} ${runningModule?.moduleRoot === module.moduleRoot ? 'active' : ''}">
                <div class="module-header">
                  <div>
                    <div class="module-title">${escapeHtml(module.moduleRoot)}</div>
                    <div class="muted">${escapeHtml(module.summary || module.bridgeAction || 'Waiting for module agent output.')}</div>
                  </div>
                  <div class="badge ${module.status}">${escapeHtml(module.status)}${runningModule?.moduleRoot === module.moduleRoot ? ' • live' : ''}</div>
                </div>
                <div class="module-meta">
                  ${module.startedAt ? `<span>started ${escapeHtml(new Date(module.startedAt).toLocaleTimeString())}</span>` : ''}
                  ${module.finishedAt ? `<span>finished ${escapeHtml(new Date(module.finishedAt).toLocaleTimeString())}</span>` : ''}
                </div>
                <div class="muted small">${escapeHtml(module.artifactPath || 'Artifact path pending.')}</div>
                ${
                  module.notes?.length
                    ? `<ul class="notes">${module.notes.slice(0, 4).map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
                    : ''
                }
                ${
                  typeof module.issues === 'number'
                    ? `<div class="muted small">issues: ${module.issues}</div>`
                    : ''
                }
                ${
                  module.error
                    ? `<div class="error">${escapeHtml(module.error)}</div>`
                    : ''
                }
              </div>
            `,
          )
          .join('')
      : '<div class="muted">No recon run is active yet.</div>';

    return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Native Recon Runs</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        padding: 12px;
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
      }
      .stack { display: grid; gap: 10px; }
      .card {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
        padding: 12px;
      }
      .title { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
      .muted { color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.45; }
      .small { font-size: 10px; }
      .toolbar { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
      .toolbar { display: none; }
      button { font: inherit; }
      .summary {
        display: grid;
        gap: 8px;
      }
      .phase {
        font-weight: 700;
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .spinner {
        width: 14px;
        height: 14px;
        border-radius: 999px;
        border: 2px solid color-mix(in srgb, var(--vscode-foreground) 20%, transparent);
        border-top-color: #0ea5e9;
        animation: spin 1s linear infinite;
        flex: 0 0 auto;
      }
      .pulse {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .pulse-dots {
        display: inline-flex;
        gap: 3px;
      }
      .pulse-dots span {
        width: 5px;
        height: 5px;
        border-radius: 999px;
        background: #0ea5e9;
        animation: pulse 1.1s ease-in-out infinite;
      }
      .pulse-dots span:nth-child(2) { animation-delay: 0.15s; }
      .pulse-dots span:nth-child(3) { animation-delay: 0.3s; }
      .progress {
        width: 100%;
        height: 8px;
        border-radius: 999px;
        overflow: hidden;
        background: var(--vscode-editorWidget-border);
      }
      .bar {
        height: 100%;
        background: linear-gradient(90deg, #0ea5e9, #8b5cf6);
      }
      .chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .chip {
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 10px;
        border: 1px solid var(--vscode-panel-border);
        background: var(--vscode-badge-background);
      }
      .pipeline {
        display: grid;
        gap: 8px;
        grid-template-columns: 1fr;
      }
      .stage {
        border-radius: 10px;
        border: 1px solid var(--vscode-panel-border);
        padding: 10px;
        background: rgba(255,255,255,0.02);
        display: grid;
        gap: 6px;
      }
      .stage.running { box-shadow: inset 0 0 0 1px #0ea5e933; }
      .stage.completed { box-shadow: inset 0 0 0 1px #22c55e33; }
      .stage.failed { box-shadow: inset 0 0 0 1px #ef444433; }
      .stage.pending { box-shadow: inset 0 0 0 1px #f59e0b22; }
      .stage-title {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: center;
        font-size: 11px;
        font-weight: 700;
      }
      .stage-detail {
        color: var(--vscode-descriptionForeground);
        font-size: 10px;
        line-height: 1.35;
      }
      .badge {
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: 10px;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid var(--vscode-panel-border);
      }
      .badge.running { background: #0ea5e91f; color: #7dd3fc; }
      .badge.completed { background: #22c55e1f; color: #86efac; }
      .badge.failed { background: #ef44441f; color: #fca5a5; }
      .badge.pending { background: #f59e0b1f; color: #fdba74; }
      .module-list { display: grid; gap: 8px; }
      .module-card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
        padding: 10px;
        background: rgba(255,255,255,0.02);
      }
      .module-card.running { box-shadow: inset 0 0 0 1px #0ea5e933; }
      .module-card.running.active {
        background:
          linear-gradient(90deg, rgba(14, 165, 233, 0.10), rgba(139, 92, 246, 0.08)),
          rgba(255,255,255,0.02);
      }
      .module-card.completed { box-shadow: inset 0 0 0 1px #22c55e33; }
      .module-card.failed { box-shadow: inset 0 0 0 1px #ef444433; }
      .module-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 10px;
      }
      .module-title { font-size: 12px; font-weight: 700; }
      .module-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; color: var(--vscode-descriptionForeground); font-size: 10px; }
      .notes { margin: 8px 0 0 16px; padding: 0; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.45; }
      .error { margin-top: 8px; color: var(--vscode-errorForeground); font-size: 11px; }
      .activity {
        margin-top: 8px;
        border-radius: 10px;
        border: 1px solid var(--vscode-panel-border);
        background: var(--vscode-editor-background);
        padding: 10px;
        display: grid;
        gap: 8px;
      }
      .activity-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--vscode-descriptionForeground);
      }
      .activity-list {
        display: grid;
        gap: 6px;
      }
      .activity-item {
        display: grid;
        grid-template-columns: 72px 1fr;
        gap: 8px;
        align-items: start;
        font-size: 11px;
        line-height: 1.35;
      }
      .activity-time {
        color: var(--vscode-descriptionForeground);
        font-variant-numeric: tabular-nums;
      }
      .activity-message {
        word-break: break-word;
      }
      .running-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        background: #0ea5e91f;
        color: #7dd3fc;
        border: 1px solid #0ea5e954;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      @keyframes pulse {
        0%, 100% { opacity: 0.35; transform: translateY(0); }
        50% { opacity: 1; transform: translateY(-1px); }
      }
    </style>
  </head>
  <body>
    <div class="stack">
      <div class="card">
        <div class="title">Parallel reconnaissance</div>
        <div class="summary">
          <div class="phase">
            ${snapshot?.status === 'running' ? '<span class="spinner"></span>' : ''}
            <span>${escapeHtml(snapshot?.phase ?? 'Idle')}</span>
            ${snapshot?.status === 'running' ? '<span class="running-badge"><span class="pulse-dots"><span></span><span></span><span></span></span> live</span>' : ''}
          </div>
          <div class="muted">${escapeHtml(snapshot ? `${snapshot.projectName} · ${snapshot.runId}` : 'No active recon run yet.')}</div>
          <div class="progress"><div class="bar" style="width:${computeProgress(snapshot)}%"></div></div>
          <div class="chips">
            <span class="chip">jqa: ${escapeHtml(snapshot?.jqassistantStatus ?? 'off')}</span>
            <span class="chip">ast: ${escapeHtml(snapshot?.astStatus ?? 'pending')}</span>
            <span class="chip">analysis: ${escapeHtml(snapshot?.analysisStatus ?? 'pending')}</span>
            <span class="chip">graph: ${escapeHtml(snapshot?.codeGraphStatus ?? 'pending')}</span>
            <span class="chip">agents: ${escapeHtml(snapshot?.localAgentStatus ?? 'off')}</span>
            <span class="chip">enrichment: ${escapeHtml(snapshot?.aiEnrichmentStatus ?? 'off')}</span>
            <span class="chip">modules: ${escapeHtml(String(snapshot?.moduleRuns.length ?? 0))}</span>
          </div>
        </div>
        <div class="stage ${snapshot?.aiEnrichmentStatus ?? (snapshot?.aiEnrichmentEnabled === false ? 'completed' : 'pending')}">
          <div class="stage-title">
            <span>AI enrichment</span>
            <span class="badge ${snapshot?.aiEnrichmentStatus ?? (snapshot?.aiEnrichmentEnabled === false ? 'completed' : 'pending')}">${escapeHtml(snapshot?.aiEnrichmentStatus ?? (snapshot?.aiEnrichmentEnabled === false ? 'off' : snapshot?.localAgentStatus ?? 'pending'))}</span>
          </div>
          <div class="stage-detail">
            ${
              snapshot?.aiEnrichmentEnabled === false
                ? 'AI enrichment has not been run yet. Deterministic artifacts are already available.'
                : snapshot?.aiEnrichmentStatus === 'completed'
                  ? 'AI enrichment has already refined the deterministic artifacts.'
                  : snapshot?.aiEnrichmentStatus === 'running'
                    ? 'AI enrichment is currently running.'
                    : snapshot?.aiEnrichmentStatus === 'failed'
                      ? 'AI enrichment failed and can be rerun without repeating the deterministic import.'
                      : 'AI enrichment is pending. Use the AI enrichment button when you want refinement.'
            }
          </div>
        </div>
        <div class="pipeline">
          ${stages
            .filter((stage) => stage.show)
          .map(
              (stage) => {
                const displayStatus = stage.status === 'off' ? 'pending' : stage.status;
                return `
              <div class="stage ${displayStatus}">
                <div class="stage-title">
                  <span>${escapeHtml(stage.label)}</span>
                  <span class="badge ${displayStatus}">${escapeHtml(stage.status)}</span>
                </div>
                <div class="stage-detail">${escapeHtml(stage.detail)}</div>
              </div>
              `;
              },
            )
            .join('')}
        </div>
        <div class="activity">
          <div class="activity-title">
            <span>Current activity</span>
            <span>${escapeHtml(snapshot?.activeTask || runningModule?.moduleRoot || 'idle')}</span>
          </div>
          <div class="muted">The recon run updates this as AST indexing, deterministic analysis, deterministic graph construction, optional AI enrichment, and recon agents move through the new pipeline.</div>
          ${
            snapshot?.astArtifactPath
              ? `<div class="muted small">AST: ${escapeHtml(snapshot.astArtifactPath)}${snapshot.astFileCount != null ? ` · ${snapshot.astFileCount} files` : ''}</div>`
              : ''
          }
          ${
            snapshot?.codeGraphArtifactPath
              ? `<div class="muted small">Code graph: ${escapeHtml(snapshot.codeGraphArtifactPath)}</div>`
              : ''
          }
          ${
            snapshot?.codeGraphProgressPath
              ? `<div class="muted small">Code graph progress: ${escapeHtml(snapshot.codeGraphProgressPath)}${snapshot.codeGraphProgressUpdatedAt ? ` · updated ${escapeHtml(new Date(snapshot.codeGraphProgressUpdatedAt).toLocaleTimeString())}` : ''}</div>`
              : ''
          }
          ${
            typeof snapshot?.codeGraphHeartbeatCount === 'number'
              ? `<div class="muted small">Code graph heartbeat: ${snapshot.codeGraphHeartbeatCount}</div>`
              : ''
          }
        </div>
      </div>

      <div class="card">
        <div class="title">Final output</div>
        <div class="stage ${finalOutputStatus}">
          <div class="stage-title">
            <span>Semantic assembly</span>
            <span class="badge ${finalOutputStatus}">${escapeHtml(finalOutputStatus)}</span>
          </div>
          <div class="stage-detail">
            ${
              snapshot?.status === 'completed'
                ? 'Final semantic markdown, graph, validation, and review artifacts are ready.'
                : snapshot?.status === 'failed'
                  ? 'The run failed before the final semantic assembly stage completed.'
                  : 'Waiting for the final semantic rewrite and artifact write.'
            }
          </div>
        </div>
      </div>

      <div class="card">
        <div class="title">Current module activity</div>
        <div class="module-list">
          ${moduleCards}
        </div>
      </div>

      <div class="card">
        <div class="title">Recent activity</div>
        ${
          events.length
            ? `
              <div class="activity-list">
                ${events
                  .map(
                    (event) => `
                      <div class="activity-item">
                        <div class="activity-time">${escapeHtml(new Date(event.at).toLocaleTimeString())}</div>
                        <div class="activity-message">
                          <strong>${escapeHtml(event.kind)}</strong>
                          ${event.moduleRoot ? `<span class="muted"> · ${escapeHtml(event.moduleRoot)}</span>` : ''}
                          — ${escapeHtml(event.message)}
                        </div>
                      </div>
                    `,
                  )
                  .join('')}
              </div>
            `
            : '<div class="muted">No activity recorded yet.</div>'
        }
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.querySelectorAll('[data-command="open-artifacts"]').forEach((button) => {
        button.addEventListener('click', () => vscode.postMessage({ command: 'open-artifacts' }));
      });
      document.querySelectorAll('[data-command="open-actions"]').forEach((button) => {
        button.addEventListener('click', () => vscode.postMessage({ command: 'open-actions' }));
      });
    </script>
  </body>
</html>`;
  }
}

function computeProgress(snapshot: ReconRunSnapshot | undefined): number {
  if (!snapshot || snapshot.moduleRuns.length === 0) {
    const baseCompleted = [snapshot?.astStatus, snapshot?.analysisStatus, snapshot?.codeGraphStatus, snapshot?.localAgentStatus, snapshot?.projectPromptStatus].filter((status) => status === 'completed').length;
    return Math.max(0, Math.min(100, Math.round((baseCompleted / 5) * 100)));
  }

  const total = snapshot.moduleRuns.length + 5;
  const completed =
    snapshot.moduleRuns.filter((module) => module.status === 'completed').length +
    (snapshot.astStatus === 'completed' ? 1 : 0) +
    (snapshot.analysisStatus === 'completed' ? 1 : 0) +
    (snapshot.codeGraphStatus === 'completed' ? 1 : 0) +
    (snapshot.localAgentStatus === 'completed' ? 1 : 0) +
    (snapshot.projectPromptStatus === 'completed' ? 1 : 0);
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
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
