import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { McpRegistry } from '../mcpRegistry.js';
import { analyzeDocImports } from '../docImportAnalysis.js';

type ImportItem =
  | { kind: 'file'; name: string; fsPath: string; ext: string }
  | { kind: 'confluence'; name: string; url: string; user?: string; token?: string };

export class DocumentImportWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly registry: McpRegistry,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message?.type) {
        case 'pickFiles':
          await this.handlePickFiles();
          break;
        case 'runImport':
          await this.handleRunImport(message);
          break;
        case 'runDocImportAnalysis': {
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!workspaceRoot) {
            this.post({ type: 'progress', message: 'Open a workspace first.' });
            this.post({ type: 'analysisDone', error: true });
            break;
          }
          await analyzeDocImports({
            workspaceRoot,
            outputChannel: this.outputChannel,
            postFn: (msg) => this.post(msg),
            registry: this.registry,
          });
          break;
        }
        case 'getConfluenceCredentials': {
          const url = vscode.workspace.getConfiguration('aiNative').get<string>('confluence.url', '');
          const hasToken = !!(await this.context.secrets.get('confluencePersonalToken'));
          this.post({ type: 'confluenceCredentials', url, hasToken });
          break;
        }
        case 'saveConfluenceCredentials': {
          await vscode.workspace.getConfiguration('aiNative').update('confluence.url', message.url ?? '', vscode.ConfigurationTarget.Global);
          if (message.token) await this.context.secrets.store('confluencePersonalToken', message.token);
          else if (message.clearToken) await this.context.secrets.delete('confluencePersonalToken');
          this.post({ type: 'confluenceCredentialsSaved', hasToken: !!(await this.context.secrets.get('confluencePersonalToken')) });
          break;
        }
      }
    });
    webviewView.webview.html = this.render(webviewView.webview);
  }

  private post(message: unknown): void {
    this.view?.webview.postMessage(message);
  }

  private async handlePickFiles(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Add to import',
      filters: { 'Documents': ['pdf', 'docx', 'doc', 'md', 'markdown', 'html', 'htm', 'txt'] },
    });
    if (!uris?.length) return;
    const files: ImportItem[] = uris.map((u) => ({
      kind: 'file' as const,
      name: path.basename(u.fsPath),
      fsPath: u.fsPath,
      ext: path.extname(u.fsPath).replace('.', '').toLowerCase(),
    }));
    this.post({ type: 'itemsAdded', items: files });
  }

  private async handleRunImport(message: {
    items: ImportItem[];
  }): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('Open a workspace first.');
      return;
    }

    const outputDir = path.join(workspaceFolder.uri.fsPath, '.ai-native');
    const importsDir = path.join(outputDir, 'imports');
    await fs.mkdir(importsDir, { recursive: true });

    this.post({ type: 'progress', message: 'Starting document import…' });
    this.outputChannel.show(true);

    const results: Array<{ name: string; ok: boolean; error?: string }> = [];

    for (const item of message.items) {
      this.post({ type: 'progress', message: `Fetching: ${item.name}…` });
      this.outputChannel.appendLine(`[document-import] fetching: ${item.kind === 'file' ? item.fsPath : item.url}`);

      try {
        let markdown: string;
        let safeName: string;

        if (item.kind === 'file') {
          const fileBuffer = await fs.readFile(item.fsPath);
          const convertResult = await this.registry.callTool('documentImport', 'convert_document_to_markdown', {
            contentBase64: fileBuffer.toString('base64'),
            fileName: path.basename(item.fsPath),
            persist: false,
          });
          const converted = convertResult.json as Record<string, unknown> | undefined;
          if (!converted?.ok) throw new Error(String((converted as Record<string, unknown> | undefined)?.['error'] ?? 'Conversion failed'));
          markdown = String(converted.markdown ?? converted.markdownPreview ?? '');
          safeName = path.basename(item.fsPath, path.extname(item.fsPath));
          this.post({ type: 'progress', message: `Converted "${item.name}" (${markdown.length} chars)` });
        } else {
          const confluenceToken = await this.context.secrets.get('confluencePersonalToken') ?? item.token;
          const fetchResult = await this.registry.callTool('documentImport', 'fetch_confluence_page', {
            pageUrl: item.url,
            ...(item.user ? { user: item.user } : {}),
            ...(confluenceToken ? { token: confluenceToken } : {}),
            persist: false,
          });
          const fetched = fetchResult.json as Record<string, unknown> | undefined;
          if (!fetched?.ok) throw new Error(String((fetched as Record<string, unknown> | undefined)?.['error'] ?? 'Confluence fetch failed'));
          markdown = String(fetched.markdown ?? fetched.markdownPreview ?? '');
          safeName = String(fetched.title ?? item.name).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
          this.post({ type: 'progress', message: `Fetched "${fetched.title ?? item.url}" (${markdown.length} chars)` });
        }

        const mdPath = path.join(importsDir, `${safeName}.md`);
        await fs.writeFile(mdPath, markdown, 'utf8');
        this.outputChannel.appendLine(`[document-import] saved ${mdPath}`);
        results.push({ name: item.name, ok: true });

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ name: item.name, ok: false, error: msg });
        this.post({ type: 'progress', message: `Error: ${msg}` });
        this.outputChannel.appendLine(`[document-import] error: ${msg}`);
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    if (okCount > 0) {
      this.post({ type: 'progress', message: `Saved ${okCount} document(s) to .ai-native/imports/ — run "Analyze with AI" to update semantic.md` });
    }

    this.post({ type: 'done', results, importsDir: okCount > 0 ? importsDir : undefined });
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
    <title>Document Import</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        margin: 0; padding: 12px 10px 20px;
        background: var(--vscode-sideBar-background);
      }

      /* ── Source sections ── */
      .source-section { margin-bottom: 10px; }
      .source-label {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.5px; color: var(--vscode-descriptionForeground);
        margin-bottom: 5px;
      }

      .drop-zone {
        border: 1.5px dashed var(--vscode-panel-border);
        border-radius: 7px; padding: 10px;
        text-align: center; cursor: pointer;
        background: var(--vscode-editor-background);
        transition: border-color 0.15s;
      }
      .drop-zone:hover { border-color: var(--vscode-button-background); }
      .drop-zone-icon { font-size: 18px; margin-bottom: 2px; }
      .drop-zone-label { font-size: 12px; font-weight: 600; }
      .drop-zone-sub { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px; }

      /* Confluence credentials panel */
      .cred-panel {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px; padding: 8px 10px; margin-bottom: 8px;
      }
      .cred-panel summary {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.5px; color: var(--vscode-descriptionForeground);
        cursor: pointer; user-select: none; list-style: none;
        display: flex; align-items: center; gap: 5px;
      }
      .cred-panel summary::before { content: '⚙'; }
      .cred-row { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
      .cred-field { display: flex; flex-direction: column; gap: 2px; }
      .cred-label { font-size: 10px; color: var(--vscode-descriptionForeground); }
      .cred-input {
        padding: 5px 7px; font-size: 11px; font-family: var(--vscode-font-family);
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
        border-radius: 4px;
      }
      .cred-input::placeholder { color: var(--vscode-input-placeholderForeground); }
      .cred-status { font-size: 10px; color: var(--vscode-terminal-ansiGreen); }
      .cred-actions { display: flex; gap: 5px; margin-top: 4px; }
      .cred-save-btn {
        padding: 4px 10px; font-size: 10px; font-weight: 600; cursor: pointer;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground);
        border: none; border-radius: 4px;
      }
      .cred-save-btn:hover { background: var(--vscode-button-hoverBackground); }
      .cred-clear-btn {
        padding: 4px 8px; font-size: 10px; cursor: pointer;
        background: none; color: var(--vscode-descriptionForeground);
        border: 1px solid var(--vscode-panel-border); border-radius: 4px;
      }
      .cred-clear-btn:hover { color: var(--vscode-errorForeground); }

      /* Confluence URL input */
      .conf-input-row {
        display: flex; gap: 5px; align-items: stretch;
      }
      .conf-input {
        flex: 1; padding: 6px 8px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
        border-radius: 5px; font-size: 11px; font-family: var(--vscode-font-family);
      }
      .conf-input::placeholder { color: var(--vscode-input-placeholderForeground); }
      .conf-add-btn {
        flex-shrink: 0; padding: 5px 10px;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: 1px solid var(--vscode-button-secondaryBorder, var(--vscode-panel-border));
        border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer;
      }
      .conf-add-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
      .conf-note {
        font-size: 10px; color: var(--vscode-descriptionForeground);
        margin-top: 5px; line-height: 1.4;
      }

      /* Item list */
      .item-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
      .item-entry {
        display: flex; align-items: center; gap: 6px;
        padding: 5px 7px;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 5px; font-size: 11px;
      }
      .item-badge {
        font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px;
        text-transform: uppercase; flex-shrink: 0; letter-spacing: 0.3px;
      }
      .badge-file { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
      .badge-conf { background: #2563eb; color: #fff; }
      .item-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .item-remove {
        flex-shrink: 0; background: none; border: none;
        color: var(--vscode-descriptionForeground);
        cursor: pointer; padding: 0 2px; font-size: 13px; line-height: 1;
      }
      .item-remove:hover { color: var(--vscode-errorForeground); }
      .empty-hint { font-size: 11px; color: var(--vscode-descriptionForeground); text-align: center; padding: 6px 0; }

      .sub-option {
        display: flex; align-items: center; gap: 7px; margin-top: 8px;
        padding: 5px 8px; border-radius: 5px;
        background: var(--vscode-sideBar-background);
        border: 1px solid var(--vscode-panel-border); cursor: pointer;
      }
      .sub-check { width: 13px; height: 13px; flex-shrink: 0; cursor: pointer; accent-color: #e8ab5d; }
      .sub-label { font-size: 11px; font-weight: 600; flex: 1; }
      .badge-ai { font-size: 9px; padding: 1px 5px; border-radius: 3px; font-weight: 700; background: #e8ab5d; color: #000; }
      .sub-desc { font-size: 10px; color: var(--vscode-descriptionForeground); padding-left: 21px; margin-top: 3px; }

      .run-btn {
        width: 100%; padding: 8px 10px;
        border: 1px solid transparent; border-radius: 8px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        font-weight: 700; font-size: 12px; cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 6px;
        margin-top: 4px;
      }
      .run-btn:hover { background: var(--vscode-button-hoverBackground); }
      .run-btn:disabled { opacity: 0.45; cursor: default; }

      .log-area {
        margin-top: 10px; padding: 8px 9px;
        background: var(--vscode-textBlockQuote-background);
        border-radius: 5px; font-size: 10px; font-family: monospace;
        max-height: 150px; overflow-y: auto;
        white-space: pre-wrap; word-break: break-all;
        display: none;
      }
      .log-area.visible { display: block; }
      .credit-error-banner {
        display: none; margin-top: 8px; padding: 10px 12px;
        background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
        border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
        border-radius: 5px; font-size: 11px; color: var(--vscode-errorForeground, #f48771);
        font-weight: 600; line-height: 1.5;
      }
      .credit-error-banner.visible { display: block; }
      .credit-error-banner .credit-title {
        font-size: 12px; margin-bottom: 4px; letter-spacing: 0.02em;
      }
      .credit-error-banner .credit-detail {
        font-weight: 400; font-size: 10px; opacity: 0.85; font-family: monospace;
        white-space: pre-wrap; word-break: break-all;
      }

      .divider { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 10px 0; }
    </style>
  </head>
  <body>

    <!-- Local files -->
    <div class="source-section">
      <div class="source-label">Local files</div>
      <div class="drop-zone" id="dropZone">
        <div class="drop-zone-icon">📄</div>
        <div class="drop-zone-label">Add documents</div>
        <div class="drop-zone-sub">PDF · DOCX · MD · HTML · TXT</div>
      </div>
    </div>

    <hr class="divider" />

    <!-- Confluence URLs -->
    <div class="source-section">
      <div class="source-label">Confluence pages <span class="badge-ai" style="vertical-align:middle;margin-left:4px;">AI</span></div>

      <details class="cred-panel" id="credPanel">
        <summary>Confluence credentials</summary>
        <div class="cred-row">
          <div class="cred-field">
            <span class="cred-label">Instance URL</span>
            <input class="cred-input" id="credUrl" type="url" placeholder="https://wiki.example.com/confluence" />
          </div>
          <div class="cred-field">
            <span class="cred-label">Personal Access Token</span>
            <input class="cred-input" id="credToken" type="password" placeholder="Leave blank to keep existing" />
            <span class="cred-status" id="credStatus"></span>
          </div>
          <div class="cred-actions">
            <button class="cred-save-btn" id="credSaveBtn">Save</button>
            <button class="cred-clear-btn" id="credClearBtn">Clear token</button>
          </div>
        </div>
      </details>

      <div class="conf-input-row">
        <input class="conf-input" id="confUrl" type="url" placeholder="https://wiki.example.com/confluence/spaces/TEAM/pages/…" />
        <button class="conf-add-btn" id="confAddBtn">Add</button>
      </div>
    </div>

    <hr class="divider" />

    <!-- Unified item list -->
    <div class="item-list" id="itemList">
      <div class="empty-hint" id="emptyHint">No documents or pages added yet.</div>
    </div>

    <button class="run-btn" id="runBtn" disabled>▶ Import Documents</button>
    <button class="run-btn" id="analyzeBtn" style="margin-top:6px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);">✦ Analyze with AI</button>
    <div class="log-area" id="logArea"></div>
    <div class="credit-error-banner" id="creditErrorBanner">
      <div class="credit-title">⛔ API credit / usage limit reached</div>
      <div class="credit-detail" id="creditErrorDetail"></div>
    </div>

    <script nonce="${n}">
      const vscode = acquireVsCodeApi();

      let items = [];

      const itemListEl = document.getElementById('itemList');
      const emptyHint  = document.getElementById('emptyHint');
      const runBtn     = document.getElementById('runBtn');
      const logArea    = document.getElementById('logArea');

      // ── Confluence credentials ───────────────────────────────
      vscode.postMessage({ type: 'getConfluenceCredentials' });

      document.getElementById('credSaveBtn').addEventListener('click', () => {
        const url   = document.getElementById('credUrl').value.trim();
        const token = document.getElementById('credToken').value.trim();
        vscode.postMessage({ type: 'saveConfluenceCredentials', url, token: token || undefined });
        document.getElementById('credToken').value = '';
      });

      document.getElementById('credClearBtn').addEventListener('click', () => {
        vscode.postMessage({ type: 'saveConfluenceCredentials', url: document.getElementById('credUrl').value.trim(), clearToken: true });
      });

      // ── Drop zone (local files) ──────────────────────────────
      document.getElementById('dropZone').addEventListener('click', () =>
        vscode.postMessage({ type: 'pickFiles' }));

      // ── Confluence input ─────────────────────────────────────
      function addConfluenceItem() {
        const url = document.getElementById('confUrl').value.trim();
        if (!url) return;
        if (items.some((i) => i.kind === 'confluence' && i.url === url)) return;
        const name = url.replace(/^https?:\\/\\/[^\\/]+/, '').slice(0, 60) || url.slice(0, 60);
        items.push({ kind: 'confluence', name, url });
        document.getElementById('confUrl').value = '';
        renderItems();
      }

      document.getElementById('confAddBtn').addEventListener('click', addConfluenceItem);
      document.getElementById('confUrl').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addConfluenceItem();
      });

      // ── Render item list ─────────────────────────────────────
      function renderItems() {
        itemListEl.querySelectorAll('.item-entry').forEach((el) => el.remove());
        emptyHint.style.display = items.length ? 'none' : '';
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const isConf = it.kind === 'confluence';
          const label  = isConf ? (it.url.length > 55 ? it.url.slice(0, 52) + '…' : it.url) : it.name;
          const badge  = isConf ? '<span class="item-badge badge-conf">CONF</span>' : '<span class="item-badge badge-file">' + escHtml(it.ext || '?') + '</span>';
          const title  = isConf ? escAttr(it.url) : escAttr(it.fsPath ?? it.name);
          const el = document.createElement('div');
          el.className = 'item-entry';
          el.innerHTML = badge +
            '<span class="item-name" title="' + title + '">' + escHtml(label) + '</span>' +
            '<button class="item-remove" data-i="' + i + '" title="Remove">✕</button>';
          itemListEl.appendChild(el);
        }
        runBtn.disabled = items.length === 0;
      }

      itemListEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.item-remove');
        if (!btn) return;
        items.splice(Number(btn.dataset.i), 1);
        renderItems();
      });

      // ── Run ──────────────────────────────────────────────────
      runBtn.addEventListener('click', () => {
        if (!items.length) return;
        logArea.textContent = '';
        logArea.classList.add('visible');
        creditErrorBanner.classList.remove('visible');
        creditErrorDetail.textContent = '';
        runBtn.disabled = true;
        vscode.postMessage({
          type: 'runImport',
          items,
        });
      });

      const analyzeBtn = document.getElementById('analyzeBtn');
      const creditErrorBanner = document.getElementById('creditErrorBanner');
      const creditErrorDetail = document.getElementById('creditErrorDetail');
      analyzeBtn.addEventListener('click', () => {
        analyzeBtn.disabled = true;
        logArea.textContent = '';
        logArea.classList.add('visible');
        creditErrorBanner.classList.remove('visible');
        creditErrorDetail.textContent = '';
        vscode.postMessage({ type: 'runDocImportAnalysis' });
      });

      // ── Messages from extension ──────────────────────────────
      window.addEventListener('message', ({ data: msg }) => {
        if (msg.type === 'itemsAdded') {
          for (const f of msg.items) {
            if (!items.some((e) => e.kind === 'file' && e.fsPath === f.fsPath)) items.push(f);
          }
          renderItems();
        } else if (msg.type === 'progress') {
          logArea.textContent += msg.message + '\\n';
          logArea.scrollTop = logArea.scrollHeight;
        } else if (msg.type === 'confluenceCredentials') {
          document.getElementById('credUrl').value = msg.url || '';
          document.getElementById('credStatus').textContent = msg.hasToken ? '● Token configured' : '';
          if (msg.url || msg.hasToken) document.getElementById('credPanel').open = false;
        } else if (msg.type === 'confluenceCredentialsSaved') {
          document.getElementById('credStatus').textContent = msg.hasToken ? '● Token configured' : '';
          document.getElementById('credPanel').open = false;
        } else if (msg.type === 'creditExhausted') {
          analyzeBtn.disabled = false;
          logArea.textContent += '⛔ Credit limit reached — analysis stopped.\\n';
          logArea.scrollTop = logArea.scrollHeight;
          creditErrorBanner.classList.add('visible');
          creditErrorDetail.textContent = msg.message || 'API credit or usage limit reached.';
        } else if (msg.type === 'analysisDone') {
          analyzeBtn.disabled = false;
        } else if (msg.type === 'done') {
          runBtn.disabled = items.length === 0;
          for (const r of (msg.results ?? [])) {
            logArea.textContent += (r.ok ? '✓' : '✗') + ' ' + r.name + (r.error ? ': ' + r.error : '') + '\\n';
          }
          if (msg.importsDir) logArea.textContent += '→ ' + msg.importsDir + '\\n';
          const okCount = (msg.results ?? []).filter(r => r.ok).length;
          const failCount = (msg.results ?? []).length - okCount;
          const summary = failCount > 0 ? 'Import finished — ' + okCount + ' ok, ' + failCount + ' failed.' : 'Import finished — ' + okCount + ' document(s) saved.';
          logArea.textContent += summary + '\\n';
          logArea.scrollTop = logArea.scrollHeight;
        }
      });

      function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
      function escAttr(s) { return escHtml(s).replace(/"/g,'&quot;'); }

      renderItems();
    </script>
  </body>
</html>`;
  }
}

function nonce(): string {
  return Math.random().toString(36).slice(2);
}
