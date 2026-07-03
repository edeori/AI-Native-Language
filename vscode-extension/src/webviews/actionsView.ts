import * as vscode from 'vscode';
import * as path from 'node:path';
import { commandIds } from '../constants.js';
import {
  readMetrics,
  estimateRawBaselineTokens,
  billedEquivalentInputTokens,
  faceValueInputTokens,
  isValidMetric,
  type OperationMetric,
} from '../metrics.js';

interface EfficiencySummary {
  calls: number;         // valid calls only
  outputTokens: number;
  freshInput: number;
  cacheRead: number;
  cacheWrite: number;
  faceValue: number;    // face-value input + output
  billedEquiv: number;  // cache-adjusted input + output — the honest cost
  cacheSavedPct: number; // how much prompt caching saved on the input side
  hasCacheData: boolean;
  corpusBaseline: number; // full doc+code corpus, one dump — reference only
  legacyCount: number;   // # of invalid (pre-cache-split) operations, excluded
  legacyTokens: number;  // their face-value tokens, shown for context only
  operations: Array<{ name: string; tokens: number; legacy: boolean }>;
}

function sumMetrics(list: OperationMetric[]): OperationMetric {
  return list.reduce<OperationMetric>(
    (acc, m) => {
      acc.calls += m.calls;
      acc.inputTokens += m.inputTokens;
      acc.cachedInputTokens += m.cachedInputTokens;
      acc.cacheWriteTokens += m.cacheWriteTokens;
      acc.outputTokens += m.outputTokens;
      return acc;
    },
    { calls: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, schemaVersion: 0 },
  );
}

export class ActionsWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message?.command === 'refreshEfficiency') {
        webviewView.webview.html = this.render(await this.computeEfficiency());
        return;
      }
      if (typeof message?.command !== 'string') return;
      await vscode.commands.executeCommand(message.command);
    });
    webviewView.webview.html = this.render(await this.computeEfficiency());
  }

  private async computeEfficiency(): Promise<EfficiencySummary | undefined> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return undefined;
    const artifactRoot = path.join(root, '.ai-native');
    const metrics = readMetrics(artifactRoot);
    const entries = Object.entries(metrics.operations);
    if (entries.length === 0) return undefined;

    // Only current-schema measurements are trustworthy. Legacy (pre-cache-split)
    // runs are flagged and excluded from the figures, not silently mixed in.
    const validEntries = entries.filter(([, m]) => isValidMetric(m));
    const legacyEntries = entries.filter(([, m]) => !isValidMetric(m));

    const t = sumMetrics(validEntries.map(([, m]) => m));
    const faceInput = faceValueInputTokens(t);
    const billedInput = billedEquivalentInputTokens(t);
    const cacheSavedPct = faceInput > 0 ? Math.round((1 - billedInput / faceInput) * 100) : 0;
    const corpusBaseline = await estimateRawBaselineTokens(root, artifactRoot).catch(() => 0);

    const legacyTotal = sumMetrics(legacyEntries.map(([, m]) => m));

    const operations = [
      ...validEntries.map(([name, m]) => ({ name, tokens: billedEquivalentInputTokens(m) + m.outputTokens, legacy: false })),
      ...legacyEntries.map(([name, m]) => ({ name, tokens: faceValueInputTokens(m) + m.outputTokens, legacy: true })),
    ]
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 6);

    return {
      calls: t.calls,
      outputTokens: t.outputTokens,
      freshInput: t.inputTokens,
      cacheRead: t.cachedInputTokens,
      cacheWrite: t.cacheWriteTokens,
      faceValue: faceInput + t.outputTokens,
      billedEquiv: billedInput + t.outputTokens,
      cacheSavedPct,
      hasCacheData: t.cachedInputTokens > 0 || t.cacheWriteTokens > 0,
      corpusBaseline,
      legacyCount: legacyEntries.length,
      legacyTokens: faceValueInputTokens(legacyTotal) + legacyTotal.outputTokens,
      operations,
    };
  }

  private render(efficiency?: EfficiencySummary): string {
    const cspSource = this.view?.webview.cspSource ?? '';
    const n = nonce();
    return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${n}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Native Actions</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        margin: 0; padding: 10px;
        background: var(--vscode-sideBar-background);
      }

      .section-label {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.5px; color: var(--vscode-descriptionForeground);
        margin: 0 0 6px 2px;
      }

      .btn-group { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }

      .action-btn {
        display: flex; align-items: center; gap: 8px;
        width: 100%; padding: 7px 10px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 7px;
        background: var(--vscode-editor-background);
        color: var(--vscode-foreground);
        font-size: 12px; font-weight: 600;
        cursor: pointer; text-align: left;
        transition: background 0.1s;
      }
      .action-btn:hover { background: var(--vscode-list-hoverBackground); }

      .btn-icon {
        font-size: 14px; flex-shrink: 0; line-height: 1;
        color: var(--vscode-descriptionForeground);
      }
      .btn-label { flex: 1; }
      .btn-desc {
        font-size: 10px; font-weight: 400;
        color: var(--vscode-descriptionForeground);
        margin-top: 1px;
      }

      .eff-card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 7px; padding: 10px 11px; margin-bottom: 14px;
        background: var(--vscode-editor-background);
      }
      .eff-headline { font-size: 20px; font-weight: 800; color: var(--vscode-testing-iconPassed, #4ade80); line-height: 1; }
      .eff-sub { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 3px; }
      .eff-row { display: flex; justify-content: space-between; font-size: 11px; margin-top: 6px; }
      .eff-row .k { color: var(--vscode-descriptionForeground); }
      .eff-ops { margin-top: 8px; border-top: 1px solid var(--vscode-panel-border); padding-top: 6px; }
      .eff-op { display: flex; justify-content: space-between; font-size: 10px; color: var(--vscode-descriptionForeground); }
      .eff-empty { font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic; }
      .eff-refresh { margin-top: 8px; font-size: 10px; background: none; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; padding: 0; text-decoration: underline; }
    </style>
  </head>
  <body>

    <div class="section-label">Graph</div>
    <div class="btn-group">
      <button class="action-btn" data-command="${commandIds.openGraphPreview}">
        <span class="btn-icon">⬡</span>
        <span>
          <div class="btn-label">Show graph</div>
          <div class="btn-desc">Open the latest canonical graph</div>
        </span>
      </button>
      <button class="action-btn" data-command="${commandIds.showEndpoints}">
        <span class="btn-icon">⚡</span>
        <span>
          <div class="btn-label">Endpoint summary</div>
          <div class="btn-desc">REST · SOAP · GraphQL · Events · gRPC</div>
        </span>
      </button>
    </div>

    <div class="section-label">Validation</div>
    <div class="btn-group">
      <button class="action-btn" data-command="${commandIds.validateActiveSemanticMarkdown}">
        <span class="btn-icon">✓</span>
        <span>
          <div class="btn-label">Validate semantic</div>
          <div class="btn-desc">Check active source.semantic.md against policy</div>
        </span>
      </button>
      <button class="action-btn" data-command="${commandIds.runDocCodeAlignment}">
        <span class="btn-icon">⇄</span>
        <span>
          <div class="btn-label">Doc-code alignment</div>
          <div class="btn-desc">Check imported docs against code artifacts</div>
        </span>
      </button>
    </div>

    <div class="section-label">Efficiency</div>
    <div class="eff-card">${renderEfficiency(efficiency)}</div>

    <script nonce="${n}">
      const vscode = acquireVsCodeApi();
      document.querySelectorAll('button[data-command]').forEach((btn) => {
        btn.addEventListener('click', () => vscode.postMessage({ command: btn.dataset.command }));
      });
      const effRefresh = document.getElementById('eff-refresh');
      if (effRefresh) effRefresh.addEventListener('click', () => vscode.postMessage({ command: 'refreshEfficiency' }));
    </script>
  </body>
</html>`;
  }
}

function nonce(): string {
  return Math.random().toString(36).slice(2);
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function renderEfficiency(eff?: EfficiencySummary): string {
  const refresh = '<button class="eff-refresh" id="eff-refresh">↻ Refresh</button>';
  if (!eff) {
    return `<div class="eff-empty">No AI activity recorded yet. Run an import or a development task.</div>${refresh}`;
  }

  const legacyFlag = eff.legacyCount > 0
    ? `<div class="eff-sub">⚠ ${eff.legacyCount} earlier run${eff.legacyCount === 1 ? '' : 's'} flagged invalid (pre-cache-split, ~${fmtTokens(eff.legacyTokens)}) — excluded</div>`
    : '';
  const opsList = eff.operations.length > 0
    ? `<div class="eff-ops">${eff.operations.map(renderOp).join('')}</div>`
    : '';

  // No trustworthy measurements yet — only legacy data. Don't show a number
  // that would be misleading; state plainly that valid data is pending.
  if (eff.calls === 0) {
    const corpus = eff.corpusBaseline > 0
      ? `<div class="eff-row"><span class="k">Full corpus (1 dump, ref)</span><span>${fmtTokens(eff.corpusBaseline)}</span></div>`
      : '';
    return `<div class="eff-headline" style="color:var(--vscode-descriptionForeground)">— tok</div>
      <div class="eff-sub">no valid measurements yet</div>${legacyFlag}${corpus}${opsList}${refresh}`;
  }

  const callLabel = `${eff.calls} AI call${eff.calls === 1 ? '' : 's'}`;
  // Headline is the honest, cache-adjusted cost.
  const headline = `<div class="eff-headline">${fmtTokens(eff.billedEquiv)} tok</div>
     <div class="eff-sub">billed-equivalent · ${callLabel}</div>`;

  const row = (k: string, v: string) => `<div class="eff-row"><span class="k">${k}</span><span>${v}</span></div>`;
  const rowParts: string[] = [row('Output (work produced)', fmtTokens(eff.outputTokens))];
  rowParts.push(row('Fresh input', fmtTokens(eff.freshInput)));
  if (eff.hasCacheData) {
    rowParts.push(row('Cache reads (billed ~10%)', fmtTokens(eff.cacheRead)));
    if (eff.cacheWrite > 0) rowParts.push(row('Cache writes (billed ~125%)', fmtTokens(eff.cacheWrite)));
    rowParts.push(row('Face-value total', fmtTokens(eff.faceValue)));
    rowParts.push(row('Prompt cache saved', `~${eff.cacheSavedPct}%`));
  }
  if (eff.corpusBaseline > 0) rowParts.push(row('Full corpus (1 dump, ref)', fmtTokens(eff.corpusBaseline)));
  const rows = rowParts.join('');

  return `${headline}${legacyFlag}${rows}${opsList}${refresh}`;
}

function renderOp(o: { name: string; tokens: number; legacy: boolean }): string {
  const label = o.legacy ? `${escapeHtml(o.name)} <span title="invalid: pre-cache-split">⚠</span>` : escapeHtml(o.name);
  const style = o.legacy ? ' style="opacity:0.55;text-decoration:line-through"' : '';
  return `<div class="eff-op"${style}><span>${label}</span><span>${fmtTokens(o.tokens)}</span></div>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
