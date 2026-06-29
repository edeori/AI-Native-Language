import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { commandIds } from '../constants.js';
import type { McpRegistry } from '../mcpRegistry.js';

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
    aiReviewEnabled: boolean;
  }): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('Open a workspace first.');
      return;
    }

    const outputDir = path.join(workspaceFolder.uri.fsPath, '.ai-native');
    const semanticPath = path.join(outputDir, 'source.semantic.md');

    this.post({ type: 'progress', message: 'Starting document import…' });
    this.outputChannel.show(true);

    let existingSemanticMd: string | undefined;
    try {
      existingSemanticMd = await fs.readFile(semanticPath, 'utf8');
      this.post({ type: 'progress', message: `Existing source.semantic.md found — enriching (${existingSemanticMd.length} chars)` });
    } catch {
      this.post({ type: 'progress', message: 'No source.semantic.md found — will create new' });
    }

    let mergedMd = existingSemanticMd ?? '';
    const results: Array<{ name: string; ok: boolean; docKind?: string; error?: string }> = [];
    const accumulatedEntities: Record<string, Set<string>> = {
      components: new Set(), flows: new Set(), apis: new Set(),
      dataModels: new Set(), techStack: new Set(), processes: new Set(),
    };

    for (const item of message.items) {
      this.post({ type: 'progress', message: `Processing: ${item.name}…` });
      this.outputChannel.appendLine(`[document-import] processing: ${item.kind === 'file' ? item.fsPath : item.url}`);

      try {
        let markdown: string;

        if (item.kind === 'file') {
          const convertResult = await this.registry.callTool('documentImport', 'convert_document_to_markdown', {
            sourcePath: item.fsPath,
            outputDir: path.join(outputDir, 'imports'),
            persist: true,
          });
          const converted = convertResult.json as Record<string, unknown> | undefined;
          if (!converted?.ok) throw new Error(String((converted as Record<string, unknown> | undefined)?.['error'] ?? 'Conversion failed'));
          markdown = String(converted.markdown ?? converted.markdownPreview ?? '');
          this.post({ type: 'progress', message: `Converted to Markdown (${markdown.length} chars)` });
        } else {
          const fetchResult = await this.registry.callTool('documentImport', 'fetch_confluence_page', {
            pageUrl: item.url,
            ...(item.user ? { user: item.user } : {}),
            ...(item.token ? { token: item.token } : {}),
            persist: true,
          });
          const fetched = fetchResult.json as Record<string, unknown> | undefined;
          if (!fetched?.ok) throw new Error('Confluence fetch failed');
          markdown = String(fetched.markdown ?? fetched.markdownPreview ?? '');
          this.post({ type: 'progress', message: `Fetched Confluence page "${fetched.title ?? item.url}" (${markdown.length} chars)` });
        }

        this.post({ type: 'progress', message: `Analyzing ${item.name}…` });
        const analyzeResult = await this.registry.callTool('documentImport', 'analyze_document_for_semantic', {
          markdown,
          existingSemanticMd: mergedMd || undefined,
          projectName: item.name,
          persist: false,
        });
        const analyzed = analyzeResult.json as Record<string, unknown> | undefined;
        if (!analyzed?.ok) throw new Error('Analysis failed');

        mergedMd = String(analyzed.mergedSemanticMd ?? mergedMd);
        results.push({ name: item.name, ok: true, docKind: String(analyzed.docKind ?? '') });

        // Accumulate entities across all documents for doc-entities.json
        const entities = analyzed.entities as Record<string, unknown> | undefined;
        if (entities) {
          for (const key of Object.keys(accumulatedEntities)) {
            const arr = entities[key];
            if (Array.isArray(arr)) arr.forEach((v: unknown) => { if (typeof v === 'string') accumulatedEntities[key].add(v); });
          }
        }

        this.post({ type: 'progress', message: `Done: ${analyzed.docKind} — components: ${countArr(analyzed.entities, 'components')}, flows: ${countArr(analyzed.entities, 'flows')}, apis: ${countArr(analyzed.entities, 'apis')}` });

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ name: item.name, ok: false, error: msg });
        this.post({ type: 'progress', message: `Error: ${msg}` });
        this.outputChannel.appendLine(`[document-import] error: ${msg}`);
      }
    }

    if (mergedMd && results.some((r) => r.ok)) {
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(semanticPath, mergedMd, 'utf8');
      this.outputChannel.appendLine(`[document-import] wrote ${semanticPath}`);
      this.post({ type: 'progress', message: `Wrote source.semantic.md (${mergedMd.length} chars)` });

      // Persist doc-entities.json — enables alignment check and flow extraction
      const docEntities = Object.fromEntries(
        Object.entries(accumulatedEntities).map(([k, s]) => [k, [...s]]),
      );
      const docEntitiesPath = path.join(outputDir, 'doc-entities.json');
      await fs.writeFile(docEntitiesPath, JSON.stringify(docEntities, null, 2) + '\n', 'utf8');
      this.outputChannel.appendLine(`[document-import] wrote ${docEntitiesPath}`);
      this.post({ type: 'progress', message: `Wrote doc-entities.json (${Object.values(docEntities).flat().length} entities)` });

      if (message.aiReviewEnabled) {
        this.post({ type: 'progress', message: 'Running AI Review enrichment…' });
        await vscode.commands.executeCommand(commandIds.runAiEnrichment);
      }
    }

    this.post({ type: 'done', results, semanticPath: mergedMd ? semanticPath : undefined });

    const okCount = results.filter((r) => r.ok).length;
    if (okCount > 0) {
      const choice = await vscode.window.showInformationMessage(
        `Document import complete: ${okCount}/${results.length} file(s) processed`,
        'Open semantic.md',
      );
      if (choice === 'Open semantic.md') {
        await vscode.window.showTextDocument(vscode.Uri.file(semanticPath));
      }
    }
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
      <label class="sub-option" style="margin-top:7px;">
        <input type="checkbox" class="sub-check" id="checkAiReview" />
        <span class="sub-label">AI Review</span>
        <span class="badge-ai">AI</span>
      </label>
      <div class="sub-desc">Optional — Semantic Enrichment via the configured AI Review provider after heuristic analysis</div>
    </div>

    <hr class="divider" />

    <!-- Confluence URLs -->
    <div class="source-section">
      <div class="source-label">Confluence pages <span class="badge-ai" style="vertical-align:middle;margin-left:4px;">AI</span></div>
      <div class="conf-input-row">
        <input class="conf-input" id="confUrl" type="url" placeholder="https://your-domain.atlassian.net/wiki/…" />
        <button class="conf-add-btn" id="confAddBtn">Add</button>
      </div>
      <div class="conf-note">Claude reads pages via configured Atlassian skill or public URL — no credentials needed here</div>
    </div>

    <hr class="divider" />

    <!-- Unified item list -->
    <div class="item-list" id="itemList">
      <div class="empty-hint" id="emptyHint">No documents or pages added yet.</div>
    </div>

    <button class="run-btn" id="runBtn" disabled>▶ Import into Semantic</button>
    <div class="log-area" id="logArea"></div>

    <script nonce="${n}">
      const vscode = acquireVsCodeApi();

      let items = [];

      const itemListEl = document.getElementById('itemList');
      const emptyHint  = document.getElementById('emptyHint');
      const runBtn     = document.getElementById('runBtn');
      const logArea    = document.getElementById('logArea');

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
        runBtn.disabled = true;
        vscode.postMessage({
          type: 'runImport',
          items,
          aiReviewEnabled: document.getElementById('checkAiReview').checked,
        });
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
        } else if (msg.type === 'done') {
          runBtn.disabled = items.length === 0;
          for (const r of (msg.results ?? [])) {
            logArea.textContent += (r.ok ? '✓' : '✗') + ' ' + r.name + (r.error ? ': ' + r.error : '') + '\\n';
          }
          if (msg.semanticPath) logArea.textContent += '→ ' + msg.semanticPath + '\\n';
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

function countArr(entities: unknown, key: string): number {
  if (!entities || typeof entities !== 'object') return 0;
  const arr = (entities as Record<string, unknown>)[key];
  return Array.isArray(arr) ? arr.length : 0;
}
