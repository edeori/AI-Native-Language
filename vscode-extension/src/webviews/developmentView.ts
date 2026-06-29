import * as vscode from 'vscode';
import { commandIds } from '../constants.js';

export interface TaskResult {
  summary: string;
  changedFiles: number;
  risks: number;
  timestamp: string;
}

export interface TaskEntry {
  taskId: string;
  direction: string;
  status: 'queued' | 'pending' | 'running' | 'done';
  createdAt: string;
  result?: TaskResult;
  docDrift?: boolean;
}

export interface ContextSources {
  hasSemantic: boolean;
  hasCodegraph: boolean;
  hasDocEntities: boolean;
}

export interface DevelopmentViewState {
  hasContext: boolean;
  contextSources: ContextSources;
  tasks: TaskEntry[];
  selectedTaskId?: string;
  streamOutput?: string;
}

export class DevelopmentWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private state: DevelopmentViewState = {
    hasContext: false,
    contextSources: { hasSemantic: false, hasCodegraph: false, hasDocEntities: false },
    tasks: [],
  };

  constructor(private readonly context: vscode.ExtensionContext) {}

  updateState(state: Partial<DevelopmentViewState>): void {
    this.state = { ...this.state, ...state };
    this.view?.webview.postMessage({ type: 'state', data: this.state });
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message?.type) {
        case 'ready':
          webviewView.webview.postMessage({ type: 'state', data: this.state });
          break;
        case 'command':
          if (typeof message.command === 'string') {
            await vscode.commands.executeCommand(message.command, message.payload);
          }
          break;
      }
    });
    webviewView.webview.html = this.render(webviewView.webview);
  }

  private render(webview: vscode.Webview): string {
    const cspSource = webview.cspSource;
    const n = nonce();
    return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${n}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI Native Development</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }

    /* ── Context bar ─────────────────────────── */
    .context-bar {
      display: flex; flex-wrap: wrap; gap: 5px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .ctx-chip {
      font-size: 10px; padding: 2px 7px; border-radius: 10px; font-weight: 600;
    }
    .ctx-ok {
      background: color-mix(in srgb, var(--vscode-testing-iconPassed) 18%, transparent);
      color: var(--vscode-testing-iconPassed);
      border: 1px solid color-mix(in srgb, var(--vscode-testing-iconPassed) 35%, transparent);
    }
    .ctx-miss {
      background: color-mix(in srgb, var(--vscode-descriptionForeground) 10%, transparent);
      color: var(--vscode-descriptionForeground);
      border: 1px solid color-mix(in srgb, var(--vscode-descriptionForeground) 20%, transparent);
    }

    /* ── Collapsible sections ────────────────── */
    .section { border-bottom: 1px solid var(--vscode-panel-border); }
    .section-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 7px 12px; cursor: pointer; user-select: none;
      transition: background 0.1s;
    }
    .section-header:hover { background: var(--vscode-list-hoverBackground); }
    .section-left { display: flex; align-items: center; gap: 6px; }
    .section-title {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; color: var(--vscode-descriptionForeground);
    }
    .section-chevron {
      font-size: 10px; color: var(--vscode-descriptionForeground);
      transition: transform 0.15s;
    }
    .section-chevron.open { transform: rotate(90deg); }
    .section-body { padding: 10px 12px; }
    .section-body.hidden { display: none; }

    /* ── Buttons ─────────────────────────────── */
    .btn-row { display: flex; gap: 6px; }
    .btn-primary {
      flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
      padding: 7px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;
      cursor: pointer; border: none;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      transition: background 0.1s; white-space: nowrap;
    }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-primary:disabled { opacity: 0.45; cursor: default; }

    .btn-secondary {
      flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
      padding: 7px 10px; border-radius: 6px; font-size: 12px; font-weight: 500;
      cursor: pointer;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      border: 1px solid var(--vscode-panel-border);
      transition: background 0.1s; white-space: nowrap;
    }
    .btn-secondary:hover { background: var(--vscode-list-hoverBackground); }

    .btn-run-queue {
      display: flex; align-items: center; gap: 5px;
      padding: 3px 9px; border-radius: 5px; font-size: 11px; font-weight: 600;
      cursor: pointer; border: none;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      transition: background 0.1s;
    }
    .btn-run-queue:hover { background: var(--vscode-button-hoverBackground); }
    .btn-run-queue:disabled { opacity: 0.45; cursor: default; }

    .btn-link {
      background: none; border: none; cursor: pointer;
      color: var(--vscode-textLink-foreground);
      font-size: 11px; padding: 0; text-decoration: underline;
      font-family: var(--vscode-font-family);
    }
    .btn-link:hover { color: var(--vscode-textLink-activeForeground); }

    /* ── Direction textarea ──────────────────── */
    .direction-input {
      width: 100%; padding: 8px 10px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 6px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: 12px; line-height: 1.5;
      resize: vertical; min-height: 80px;
      outline: none; margin-bottom: 8px;
    }
    .direction-input:focus { border-color: var(--vscode-focusBorder); }
    .direction-input::placeholder { color: var(--vscode-input-placeholderForeground); }

    /* ── Result panel ────────────────────────── */
    .result-empty {
      font-size: 12px; color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .result-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 7px; padding: 10px 11px;
      display: flex; flex-direction: column; gap: 7px;
    }
    .result-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .result-task-id { font-size: 11px; font-weight: 700; }
    .result-summary { font-size: 12px; line-height: 1.55; }
    .result-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .result-stat { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .result-stat.warn { color: var(--vscode-editorWarning-foreground); }

    /* ── Task log ────────────────────────────── */
    .task-log { display: flex; flex-direction: column; gap: 5px; }

    .task-row {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 8px 10px; border-radius: 7px; cursor: pointer;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
      transition: background 0.1s;
    }
    .task-row:hover { background: var(--vscode-list-hoverBackground); }
    .task-row:hover .load-hint { opacity: 1; }
    .task-row:hover .delete-hint { opacity: 1; }
    .task-row-body { flex: 1; min-width: 0; }
    .task-row-id { font-size: 11px; font-weight: 700; }
    .task-row-dir {
      font-size: 11px; color: var(--vscode-descriptionForeground);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      margin-top: 2px;
    }
    .task-row-meta { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
    .task-row-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
    .load-hint {
      font-size: 10px; color: var(--vscode-textLink-foreground);
      opacity: 0; transition: opacity 0.15s;
    }
    .delete-hint {
      font-size: 10px; color: var(--vscode-errorForeground);
      opacity: 0; transition: opacity 0.15s;
      background: none; border: none; cursor: pointer; padding: 0;
    }
    .delete-hint:hover { text-decoration: underline; }

    /* ── Status badges ───────────────────────── */
    .badge {
      font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 8px;
      white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;
    }
    .badge-queued   { background: color-mix(in srgb,#888 12%,transparent); color:#999; border:1px solid #555; }
    .badge-pending  { background: color-mix(in srgb, var(--vscode-progressBar-background) 15%, transparent); color: var(--vscode-progressBar-background); border: 1px solid color-mix(in srgb, var(--vscode-progressBar-background) 35%, transparent); }
    .badge-running  { background: color-mix(in srgb, var(--vscode-progressBar-background) 20%, transparent); color: var(--vscode-progressBar-background); border: 1px solid color-mix(in srgb, var(--vscode-progressBar-background) 45%, transparent); }
    .badge-done     { background: color-mix(in srgb, var(--vscode-testing-iconPassed) 18%, transparent); color: var(--vscode-testing-iconPassed); border: 1px solid color-mix(in srgb, var(--vscode-testing-iconPassed) 35%, transparent); }
    .badge-drift    { background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 15%, transparent); color: var(--vscode-editorWarning-foreground); border: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground) 35%, transparent); }

    /* ── Running animation ───────────────────── */
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner {
      display: inline-block; width: 9px; height: 9px;
      border: 1.5px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%; animation: spin 0.7s linear infinite;
    }

    /* ── Live output ─────────────────────────── */
    .live-output { padding: 4px 0; }
    .live-output pre {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px; white-space: pre-wrap; word-break: break-word;
      margin: 0; height: 220px; overflow-y: auto;
      color: var(--vscode-editor-foreground);
    }

    /* ── No context ──────────────────────────── */
    .no-context-banner {
      margin: 12px; padding: 12px; border-radius: 8px;
      background: color-mix(in srgb, var(--vscode-editorInfo-foreground) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-editorInfo-foreground) 25%, transparent);
      font-size: 12px; line-height: 1.6;
    }
    .no-context-banner p { margin-bottom: 8px; }
    .btn-full {
      display: flex; align-items: center; justify-content: center; gap: 5px;
      width: 100%; padding: 7px 14px; border-radius: 6px;
      font-size: 12px; font-weight: 600; cursor: pointer; border: none;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-full:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>

  <div id="context-bar"></div>
  <div id="root"></div>

  <script nonce="${n}">
    const vscode = acquireVsCodeApi();
    const openSections = { result: true, newTask: true, log: true };
    let currentState = null;

    function cmd(command, payload) {
      vscode.postMessage({ type: 'command', command, payload: payload ?? {} });
    }

    function fmtTime(iso) {
      try {
        const d = new Date(iso);
        return d.toLocaleDateString('hu-HU', { month: '2-digit', day: '2-digit' }) + ' ' +
          d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
      } catch { return ''; }
    }

    function badge(status, docDrift) {
      const spinner = status === 'running' ? '<span class="spinner"></span>' : '';
      const driftBadge = docDrift ? '<span class="badge badge-drift">⚠ drift</span>' : '';
      return '<span class="badge badge-' + status + '">' + spinner + status + '</span>' + driftBadge;
    }

    // ── Context bar ──────────────────────────────────────────────
    function renderContextBar(src) {
      const chips = [
        { key: 'hasSemantic',    label: 'semantic' },
        { key: 'hasCodegraph',   label: 'codegraph' },
        { key: 'hasDocEntities', label: 'docs' },
      ];
      document.getElementById('context-bar').innerHTML =
        '<div class="context-bar">' +
        chips.map(c =>
          '<span class="ctx-chip ' + (src[c.key] ? 'ctx-ok' : 'ctx-miss') + '">' +
          (src[c.key] ? '✓' : '✗') + ' ' + c.label + '</span>'
        ).join('') + '</div>';
    }

    function esc(str) {
      return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Section wrapper ──────────────────────────────────────────
    function section(id, title, extraRight, body) {
      const isOpen = openSections[id] !== false;
      return \`<div class="section">
        <div class="section-header" data-sec="\${id}">
          <div class="section-left">
            <span class="section-chevron \${isOpen ? 'open' : ''}">▶</span>
            <span class="section-title">\${title}</span>
          </div>
          \${extraRight ? '<div onclick="event.stopPropagation()">' + extraRight + '</div>' : ''}
        </div>
        <div class="section-body \${isOpen ? '' : 'hidden'}" id="sec-body-\${id}">\${body}</div>
      </div>\`;
    }

    // ── Last Result ──────────────────────────────────────────────
    function resultHtml(task) {
      if (!task || !task.result) {
        return '<div class="result-empty">No result yet — run a task to see output here.</div>';
      }
      const r = task.result;
      return \`<div class="result-card">
        <div class="result-header">
          <span class="result-task-id">\${esc(task.taskId)}</span>
          \${badge(task.status, task.docDrift)}
          <span style="font-size:10px;color:var(--vscode-descriptionForeground)">\${fmtTime(r.timestamp)}</span>
        </div>
        <div class="result-summary">\${esc(r.summary)}</div>
        <div class="result-meta">
          <span class="result-stat">📄 \${r.changedFiles} file\${r.changedFiles !== 1 ? 's' : ''} changed</span>
          \${r.risks > 0 ? '<span class="result-stat warn">⚠ ' + r.risks + ' risk' + (r.risks !== 1 ? 's' : '') + '</span>' : ''}
          <button class="btn-link" data-cmd="${commandIds.openImplementationReport}" data-payload-task="\${task.taskId}">view full report</button>
        </div>
      </div>\`;
    }

    // ── Live Output ──────────────────────────────────────────────
    function liveOutputHtml(output) {
      return \`<div class="live-output"><pre id="live-pre">\${esc(output)}</pre></div>\`;
    }

    // ── New Task ─────────────────────────────────────────────────
    function newTaskHtml(isRunning) {
      return \`<textarea
          class="direction-input" id="direction-input"
          placeholder="Describe what the agent should implement...&#10;&#10;Short: 'Implement notification service'&#10;Detailed: full spec with constraints, modules, acceptance criteria..."
          rows="5"
        ></textarea>
        <div class="btn-row">
          <button class="btn-primary" id="btn-run" \${isRunning ? 'disabled title="A task is already running — add to queue instead"' : ''}>▶ Run Now</button>
          <button class="btn-secondary" id="btn-queue">+ Add to Queue</button>
        </div>\`;
    }

    // ── Task Log ─────────────────────────────────────────────────
    function taskLogHtml(tasks) {
      if (!tasks || tasks.length === 0) {
        return '<div style="font-size:12px;color:var(--vscode-descriptionForeground);font-style:italic;">No tasks yet.</div>';
      }
      const sorted = [...tasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return '<div class="task-log">' + sorted.map(t => \`
        <div class="task-row" data-task-load="\${encodeURIComponent(t.direction)}" data-task-id="\${t.taskId}">
          <div class="task-row-body">
            <div class="task-row-id">\${esc(t.taskId)}</div>
            <div class="task-row-dir">\${esc(t.direction)}</div>
            <div class="task-row-meta">\${fmtTime(t.createdAt)}</div>
          </div>
          <div class="task-row-right">
            \${badge(t.status, t.docDrift)}
            <span class="load-hint">↑ load</span>
            \${t.status === 'queued' ? \`<button class="delete-hint" data-delete-task="\${esc(t.taskId)}">✕ delete</button>\` : ''}
          </div>
        </div>
      \`).join('') + '</div>';
    }

    // ── Main render ──────────────────────────────────────────────
    function render(state) {
      currentState = state;
      if (state.contextSources) renderContextBar(state.contextSources);

      if (!state.hasContext) {
        document.getElementById('root').innerHTML = \`
          <div class="no-context-banner">
            <p><strong>No context available.</strong></p>
            <p>Run Source Import or Document Import first to provide context for development tasks.</p>
            <button class="btn-full" data-cmd="${commandIds.openDashboard}">Open Import Flow</button>
          </div>\`;
        attachHandlers(state);
        return;
      }

      const selectedTask = state.selectedTaskId
        ? (state.tasks || []).find(t => t.taskId === state.selectedTaskId)
        : (state.tasks || []).filter(t => t.status === 'done').sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      const queuedCount = (state.tasks || []).filter(t => t.status === 'queued').length;
      const isRunning = (state.tasks || []).some(t => t.status === 'running' || t.status === 'pending');
      const runQueueBtn = queuedCount > 0
        ? \`<button class="btn-run-queue" id="btn-run-queue" \${isRunning ? 'disabled title="A task is already running"' : ''}>▶ Run Queue (\${queuedCount})</button>\`
        : '';

      const showLive = isRunning && state.streamOutput;
      document.getElementById('root').innerHTML =
        section('result', showLive ? 'Live Output' : 'Last Result', '', showLive ? liveOutputHtml(state.streamOutput) : resultHtml(selectedTask)) +
        section('newTask', 'New Task', '', newTaskHtml(isRunning)) +
        section('log', 'Task Log', runQueueBtn, taskLogHtml(state.tasks));

      if (showLive) {
        const pre = document.getElementById('live-pre');
        if (pre) pre.scrollTop = pre.scrollHeight;
      }

      attachHandlers(state);
    }

    // ── Handlers ─────────────────────────────────────────────────
    function loadTaskIntoForm(direction, taskId) {
      openSections['newTask'] = true;
      const body = document.getElementById('sec-body-newTask');
      const chev = document.querySelector('[data-sec="newTask"] .section-chevron');
      if (body) body.classList.remove('hidden');
      if (chev) chev.classList.add('open');
      const input = document.getElementById('direction-input');
      if (input) {
        input.value = direction;
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.style.transition = 'border-color 0.15s';
        input.style.borderColor = 'var(--vscode-focusBorder)';
        setTimeout(() => { input.style.borderColor = ''; }, 1200);
      }
    }

    function attachHandlers(state) {
      // Section collapse
      document.querySelectorAll('[data-sec]').forEach(el => {
        el.addEventListener('click', () => {
          const id = el.dataset.sec;
          openSections[id] = !openSections[id];
          const body = document.getElementById('sec-body-' + id);
          const chev = el.querySelector('.section-chevron');
          if (body) body.classList.toggle('hidden', !openSections[id]);
          if (chev) chev.classList.toggle('open', !!openSections[id]);
        });
      });

      // Delete queued task
      document.querySelectorAll('[data-delete-task]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const taskId = btn.dataset.deleteTask;
          if (taskId) cmd('${commandIds.deleteTask}', { taskId });
        });
      });

      // Task row click → recall direction + show result
      document.querySelectorAll('[data-task-load]').forEach(el => {
        el.addEventListener('click', () => {
          const direction = decodeURIComponent(el.dataset.taskLoad || '');
          const taskId = el.dataset.taskId;
          loadTaskIntoForm(direction, taskId);
          const task = currentState?.tasks?.find(t => t.taskId === taskId);
          const resultBody = document.getElementById('sec-body-result');
          if (resultBody && task) {
            resultBody.innerHTML = resultHtml(task);
            attachCmdHandlers();
            openSections['result'] = true;
            const body = document.getElementById('sec-body-result');
            const chev = document.querySelector('[data-sec="result"] .section-chevron');
            if (body) body.classList.remove('hidden');
            if (chev) chev.classList.add('open');
          }
        });
      });

      // Run Now
      const btnRun = document.getElementById('btn-run');
      if (btnRun) {
        btnRun.addEventListener('click', () => {
          const direction = document.getElementById('direction-input')?.value?.trim();
          if (!direction) { document.getElementById('direction-input')?.focus(); return; }
          cmd('${commandIds.runImplementation}', { direction });
        });
      }

      // Add to Queue
      const btnQueue = document.getElementById('btn-queue');
      if (btnQueue) {
        btnQueue.addEventListener('click', () => {
          const direction = document.getElementById('direction-input')?.value?.trim();
          if (!direction) { document.getElementById('direction-input')?.focus(); return; }
          cmd('${commandIds.queueImplementation}', { direction });
          document.getElementById('direction-input').value = '';
        });
      }

      // Run Queue
      const btnRunQueue = document.getElementById('btn-run-queue');
      if (btnRunQueue) {
        btnRunQueue.addEventListener('click', (e) => {
          e.stopPropagation();
          cmd('${commandIds.runQueue}');
        });
      }

      attachCmdHandlers();
    }

    function attachCmdHandlers() {
      document.querySelectorAll('[data-cmd]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const payload = {};
          if (el.dataset.payloadTask) payload.taskId = el.dataset.payloadTask;
          cmd(el.dataset.cmd, payload);
        });
      });
    }

    window.addEventListener('message', e => {
      if (e.data?.type === 'state') render(e.data.data);
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function nonce(): string {
  return Math.random().toString(36).slice(2);
}
