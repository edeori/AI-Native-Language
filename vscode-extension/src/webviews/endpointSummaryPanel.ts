import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

export interface DetectedEndpoint {
  kind: 'REST' | 'SOAP' | 'GraphQL' | 'Event' | 'gRPC';
  method?: string;
  path?: string;
  className?: string;
  methodName?: string;
  description?: string;
  file: string;
  line: number;
  source?: 'code' | 'semantic' | 'document';
}

// ─── Scanner ───────────────────────────────────────────────────────────────

const REST_ANNOTATION = /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*(?:\(\s*(?:value\s*=\s*)?["']([^"']+)["'])?/g;
const REST_JAXRS = /@(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g;
const JAXRS_PATH = /@Path\s*\(\s*["']([^"']+)["']\s*\)/g;
const SOAP_ANNOTATION = /@(WebService|WebMethod|SoapAction)\b/g;
const GRAPHQL_ANNOTATION = /@(QueryMapping|MutationMapping|SubscriptionMapping|SchemaMapping|GraphQlExceptionHandler)\b/g;
const EVENT_ANNOTATION = /@(EventListener|KafkaListener|RabbitListener|SqsListener|JmsListener|MessageMapping|StreamListener)\b/g;
const CLASS_NAME = /(?:class|interface)\s+(\w+)/;
const METHOD_NAME_BEFORE = /(?:public|private|protected|static|\s)+\w[\w<>,\s]*\s+(\w+)\s*\([^)]*\)\s*\{?\s*$/;

const IGNORED_DIRS = new Set(['node_modules', '.git', 'target', 'build', 'out', '.ai-native', 'dist', '.gradle']);

const EXTENSIONS = new Set(['.java', '.kt', '.ts', '.tsx', '.js', '.jsx', '.py', '.cs', '.go']);

export async function scanEndpoints(workspaceRoot: string): Promise<DetectedEndpoint[]> {
  const results: DetectedEndpoint[] = [];
  await walk(workspaceRoot, workspaceRoot, results, 0);
  return results.sort((a, b) => a.kind.localeCompare(b.kind) || (a.path ?? '').localeCompare(b.path ?? ''));
}

async function walk(rootPath: string, currentPath: string, results: DetectedEndpoint[], depth: number): Promise<void> {
  if (depth > 12) return;
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(currentPath));
  } catch {
    return;
  }

  for (const [name, type] of entries) {
    if (IGNORED_DIRS.has(name)) continue;
    const fullPath = path.join(currentPath, name);
    if (type === vscode.FileType.Directory) {
      await walk(rootPath, fullPath, results, depth + 1);
    } else if (type === vscode.FileType.File && EXTENSIONS.has(path.extname(name).toLowerCase())) {
      await scanFile(fullPath, rootPath, results);
    }
  }
}

async function scanFile(filePath: string, rootPath: string, results: DetectedEndpoint[]): Promise<void> {
  let text: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    text = Buffer.from(bytes).toString('utf8');
  } catch {
    return;
  }

  const relPath = path.relative(rootPath, filePath);
  const lines = text.split('\n');

  // Current class name — track as we scan
  let currentClass: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const classMatch = CLASS_NAME.exec(line);
    if (classMatch) currentClass = classMatch[1];

    // gRPC: .proto files handled below; for Java look for stub method patterns
    if (filePath.endsWith('.proto')) {
      const rpcMatch = line.match(/^\s*rpc\s+(\w+)\s*\(([^)]+)\)/);
      if (rpcMatch) {
        results.push({ kind: 'gRPC', methodName: rpcMatch[1], path: rpcMatch[1], file: relPath, line: i + 1 });
      }
      continue;
    }

    // REST — Spring
    const restMatch = /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*(?:\(\s*(?:value\s*=\s*)?["']([^"']*?)["'])?/.exec(line);
    if (restMatch) {
      const verb = restMatch[1] === 'Request' ? 'ANY' : restMatch[1].toUpperCase();
      const p = restMatch[2] ?? '';
      const methodLine = lookAhead(lines, i, 3);
      results.push({ kind: 'REST', method: verb, path: p || '/', className: currentClass, methodName: methodLine, file: relPath, line: i + 1 });
      continue;
    }

    // REST — JAX-RS
    if (REST_JAXRS.test(line)) {
      REST_JAXRS.lastIndex = 0;
      const verbMatch = /@(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/.exec(line);
      const pathLine = findNearbyAnnotation(lines, i, JAXRS_PATH);
      const methodLine = lookAhead(lines, i, 3);
      results.push({ kind: 'REST', method: verbMatch?.[1], path: pathLine ?? '/', className: currentClass, methodName: methodLine, file: relPath, line: i + 1 });
      continue;
    }

    // SOAP
    if (SOAP_ANNOTATION.test(line)) {
      SOAP_ANNOTATION.lastIndex = 0;
      const ann = /@(WebService|WebMethod|SoapAction)/.exec(line);
      const methodLine = lookAhead(lines, i, 3);
      results.push({ kind: 'SOAP', className: currentClass, methodName: methodLine, method: ann?.[1], file: relPath, line: i + 1 });
      continue;
    }

    // GraphQL
    if (GRAPHQL_ANNOTATION.test(line)) {
      GRAPHQL_ANNOTATION.lastIndex = 0;
      const methodLine = lookAhead(lines, i, 3);
      results.push({ kind: 'GraphQL', className: currentClass, methodName: methodLine, file: relPath, line: i + 1 });
      continue;
    }

    // Events
    if (EVENT_ANNOTATION.test(line)) {
      EVENT_ANNOTATION.lastIndex = 0;
      const ann = /@(EventListener|KafkaListener|RabbitListener|SqsListener|JmsListener|MessageMapping|StreamListener)/.exec(line);
      const topicMatch = line.match(/topics\s*=\s*["'{]([^"'}]+)/);
      const methodLine = lookAhead(lines, i, 3);
      results.push({ kind: 'Event', method: ann?.[1], path: topicMatch?.[1], className: currentClass, methodName: methodLine, file: relPath, line: i + 1 });
      continue;
    }
  }

  // Handle .proto files via extension
  if (filePath.endsWith('.proto')) return;
}

function lookAhead(lines: string[], from: number, maxLines: number): string | undefined {
  for (let i = from + 1; i <= from + maxLines && i < lines.length; i++) {
    const m = METHOD_NAME_BEFORE.exec(lines[i]);
    if (m) return m[1];
  }
  return undefined;
}

function findNearbyAnnotation(lines: string[], from: number, re: RegExp): string | undefined {
  re.lastIndex = 0;
  for (let i = Math.max(0, from - 3); i <= from + 3 && i < lines.length; i++) {
    const m = re.exec(lines[i]);
    re.lastIndex = 0;
    if (m) return m[1];
  }
  return undefined;
}

// ─── Document import scanner ───────────────────────────────────────────────

const DOC_METHOD_PATH_LINE    = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/\S*)/;
const DOC_METHOD_PATH_HEADING = /^#+.*\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/\S+)/;
const DOC_METHOD_PATH_TABLE   = /^\|\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/[^\s|]*)/;

export async function scanImportedDocEndpoints(workspaceRoot: string): Promise<DetectedEndpoint[]> {
  const importsDir = path.join(workspaceRoot, '.ai-native', 'imports');
  let mdFiles: string[];
  try {
    mdFiles = (await fs.readdir(importsDir)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }

  const results: DetectedEndpoint[] = [];
  const seen = new Set<string>();

  for (const mdFile of mdFiles) {
    const filePath = path.join(importsDir, mdFile);
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    const relFile = path.join('.ai-native', 'imports', mdFile).replace(/\\/g, '/');
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const lineMatch = DOC_METHOD_PATH_LINE.exec(line);
      if (lineMatch) {
        const normPath = lineMatch[2].replace(/\/$/, '') || '/';
        const key = `${lineMatch[1]}:${normPath}`;
        if (!seen.has(key)) {
          seen.add(key);
          const desc = line.slice(lineMatch[0].length).replace(/^[\s—–\-]+/, '').trim();
          results.push({ kind: 'REST', method: lineMatch[1], path: lineMatch[2], description: desc || undefined, file: relFile, line: i + 1, source: 'document' });
        }
        continue;
      }

      const headingMatch = DOC_METHOD_PATH_HEADING.exec(line);
      if (headingMatch) {
        const normPath = headingMatch[2].replace(/\/$/, '') || '/';
        const key = `${headingMatch[1]}:${normPath}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ kind: 'REST', method: headingMatch[1], path: headingMatch[2], file: relFile, line: i + 1, source: 'document' });
        }
        continue;
      }

      const tableMatch = DOC_METHOD_PATH_TABLE.exec(line);
      if (tableMatch) {
        const rawPath = tableMatch[2].trim();
        const normPath = rawPath.replace(/\/$/, '') || '/';
        const key = `${tableMatch[1]}:${normPath}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ kind: 'REST', method: tableMatch[1], path: rawPath, file: relFile, line: i + 1, source: 'document' });
        }
      }
    }
  }

  return results;
}

function deduplicateEndpoints(
  semanticEndpoints: DetectedEndpoint[],
  docEndpoints: DetectedEndpoint[],
  codeEndpoints: DetectedEndpoint[],
): DetectedEndpoint[] {
  const seenKeys = new Set<string>();
  const normalizeKey = (ep: DetectedEndpoint) =>
    ep.kind === 'REST' && ep.method && ep.path
      ? `${ep.kind}:${ep.method}:${ep.path.replace(/\/$/, '')}`
      : `${ep.kind}:${ep.path ?? ep.methodName ?? ''}`;

  const merged: DetectedEndpoint[] = [];
  for (const ep of semanticEndpoints) {
    const k = normalizeKey(ep);
    seenKeys.add(k);
    merged.push(ep);
  }
  for (const ep of docEndpoints) {
    const k = normalizeKey(ep);
    if (!seenKeys.has(k)) { seenKeys.add(k); merged.push(ep); }
  }
  for (const ep of codeEndpoints) {
    const k = normalizeKey(ep);
    if (!seenKeys.has(k)) { seenKeys.add(k); merged.push(ep); }
  }
  return merged;
}

// ─── Panel ─────────────────────────────────────────────────────────────────

async function scanSemanticEndpoints(workspaceRoot: string): Promise<DetectedEndpoint[]> {
  const semanticPath = path.join(workspaceRoot, '.ai-native', 'source.semantic.md');
  let content: string;
  try {
    content = await fs.readFile(semanticPath, 'utf8');
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const results: DetectedEndpoint[] = [];
  let inInterfaces = false;
  let sectionDepth = 0; // depth of the # interfaces heading (1 or 2)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = /^(#{1,2})\s+interfaces\s*$/i.exec(line.trim());
    if (headingMatch) {
      inInterfaces = true;
      sectionDepth = headingMatch[1].length;
      continue;
    }
    // Stop at the next heading of the same or lower depth
    if (inInterfaces && new RegExp(`^#{1,${sectionDepth}}\\s+\\w`).test(line.trim())) break;
    if (!inInterfaces) continue;

    const item = line.trim().replace(/^[-*]\s+/, '');
    if (!item) continue;

    const apiMatch = item.match(/^api:\s*`([A-Z]+)\s+([^`]+)`(?:\s*[—–-]+\s*(.*))?/);
    if (apiMatch) {
      results.push({ kind: 'REST', method: apiMatch[1], path: apiMatch[2].trim(), description: apiMatch[3]?.trim(), file: '.ai-native/source.semantic.md', line: i + 1, source: 'semantic' });
      continue;
    }
    const eventMatch = item.match(/^event:\s*(\S+)(?:\s*[—–-]+\s*(.*))?/);
    if (eventMatch) {
      results.push({ kind: 'Event', path: eventMatch[1].trim(), description: eventMatch[2]?.trim(), file: '.ai-native/source.semantic.md', line: i + 1, source: 'semantic' });
      continue;
    }
    const gqlMatch = item.match(/^graphql:\s*(\S+)(?:\s*[—–-]+\s*(.*))?/);
    if (gqlMatch) {
      results.push({ kind: 'GraphQL', path: gqlMatch[1].trim(), description: gqlMatch[2]?.trim(), file: '.ai-native/source.semantic.md', line: i + 1, source: 'semantic' });
      continue;
    }
    const grpcMatch = item.match(/^grpc:\s*(\S+)(?:\s*[—–-]+\s*(.*))?/);
    if (grpcMatch) {
      results.push({ kind: 'gRPC', path: grpcMatch[1].trim(), description: grpcMatch[2]?.trim(), file: '.ai-native/source.semantic.md', line: i + 1, source: 'semantic' });
    }
  }
  return results;
}

export class EndpointSummaryPanel {
  private static currentPanel: EndpointSummaryPanel | undefined;

  static async show(context: vscode.ExtensionContext): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      vscode.window.showWarningMessage('Open a workspace first.');
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Scanning endpoints…', cancellable: false },
      async () => {
        const [codeEndpoints, semanticEndpoints, docEndpoints] = await Promise.all([
          Promise.all(workspaceFolders.map((wf) => scanEndpoints(wf.uri.fsPath))).then((r) => r.flat()),
          Promise.all(workspaceFolders.map((wf) => scanSemanticEndpoints(wf.uri.fsPath))).then((r) => r.flat()),
          Promise.all(workspaceFolders.map((wf) => scanImportedDocEndpoints(wf.uri.fsPath))).then((r) => r.flat()),
        ]);
        const endpoints = deduplicateEndpoints(semanticEndpoints, docEndpoints, codeEndpoints);

        if (EndpointSummaryPanel.currentPanel) {
          EndpointSummaryPanel.currentPanel.panel.reveal(vscode.ViewColumn.Two);
          EndpointSummaryPanel.currentPanel.update(endpoints);
          return;
        }

        const panel = vscode.window.createWebviewPanel(
          'aiNativeEndpoints',
          'Endpoint Summary',
          vscode.ViewColumn.Two,
          { enableScripts: true, retainContextWhenHidden: true },
        );

        EndpointSummaryPanel.currentPanel = new EndpointSummaryPanel(panel, context, endpoints);
      },
    );
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private endpoints: DetectedEndpoint[],
  ) {
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === 'open' && msg.file && msg.line) {
        const wf = vscode.workspace.workspaceFolders?.[0];
        if (!wf) return;
        const uri = vscode.Uri.file(path.join(wf.uri.fsPath, msg.file));
        const doc = await vscode.workspace.openTextDocument(uri);
        const ed = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        const lineIndex = Math.max(0, (msg.line as number) - 1);
        ed.revealRange(new vscode.Range(lineIndex, 0, lineIndex, 0), vscode.TextEditorRevealType.InCenter);
        ed.selection = new vscode.Selection(lineIndex, 0, lineIndex, 0);
      }
    }, null, this.disposables);
    this.render();
  }

  private update(endpoints: DetectedEndpoint[]): void {
    this.endpoints = endpoints;
    this.render();
  }

  private dispose(): void {
    EndpointSummaryPanel.currentPanel = undefined;
    while (this.disposables.length) this.disposables.pop()?.dispose();
    this.panel.dispose();
  }

  private render(): void {
    this.panel.webview.html = buildHtml(this.endpoints, this.panel.webview);
  }
}

// ─── HTML ──────────────────────────────────────────────────────────────────

const KIND_COLOR: Record<string, string> = {
  REST: '#22c55e',
  SOAP: '#f59e0b',
  GraphQL: '#a855f7',
  Event: '#3b82f6',
  gRPC: '#ef4444',
};

function buildHtml(endpoints: DetectedEndpoint[], webview: vscode.Webview): string {
  const n = Math.random().toString(36).slice(2);
  const cspSource = webview.cspSource;

  const kinds = ['REST', 'SOAP', 'GraphQL', 'Event', 'gRPC'] as const;
  const grouped = new Map<string, DetectedEndpoint[]>();
  for (const k of kinds) grouped.set(k, []);
  for (const ep of endpoints) {
    grouped.get(ep.kind)?.push(ep);
  }

  const totalCount = endpoints.length;

  const sectionHtml = kinds.map((kind) => {
    const items = grouped.get(kind) ?? [];
    if (items.length === 0) return '';
    const rows = items.map((ep) => {
      const badge = ep.method ? `<span class="method-badge" style="background:${KIND_COLOR[kind]}22;color:${KIND_COLOR[kind]};border-color:${KIND_COLOR[kind]}44">${esc(ep.method)}</span>` : '';
      const pathCell = ep.path ? `<span class="ep-path">${esc(ep.path)}</span>` : '<span class="ep-path muted">—</span>';
      const isSemantic = ep.source === 'semantic';
      const isDocument = ep.source === 'document';
      const classCell = (isSemantic || isDocument)
        ? `<span class="muted">${esc(ep.description ?? '')}</span>`
        : (ep.className ? `<span class="ep-class">${esc(ep.className)}</span>${ep.methodName ? `<span class="muted">::${esc(ep.methodName)}</span>` : ''}` : '');
      const fileCell = isSemantic
        ? `<span class="semantic-badge" title="From source.semantic.md">S</span>`
        : isDocument
          ? `<span class="document-badge" title="${esc(ep.file)}">D</span><span class="muted doc-file">${esc(ep.file.replace('.ai-native/imports/', ''))}</span>`
          : `<a class="ep-file" href="#" data-file="${esc(ep.file)}" data-line="${ep.line}">${esc(ep.file)}:${ep.line}</a>`;
      return `<tr>${[badge ? `<td>${badge}</td>` : '<td></td>', `<td>${pathCell}</td>`, `<td>${classCell}</td>`, `<td>${fileCell}</td>`].join('')}</tr>`;
    }).join('');

    return `
      <section>
        <div class="section-header">
          <span class="kind-dot" style="background:${KIND_COLOR[kind]}"></span>
          <span class="kind-title">${kind}</span>
          <span class="kind-count">${items.length}</span>
        </div>
        <table>
          <thead><tr><th>Method</th><th>Path / Topic</th><th>Class</th><th>File</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }).join('');

  const semanticCount = endpoints.filter((e) => e.source === 'semantic').length;
  const docCount = endpoints.filter((e) => e.source === 'document').length;
  const codeCount = endpoints.filter((e) => e.source !== 'semantic' && e.source !== 'document').length;
  const parts: string[] = [];
  if (codeCount > 0) parts.push(`${codeCount} code`);
  if (semanticCount > 0) parts.push(`${semanticCount} semantic`);
  if (docCount > 0) parts.push(`${docCount} document`);
  const sourceSummary = parts.length > 1 ? ` (${parts.join(' + ')})` : parts.length === 1 ? ` (${parts[0]})` : '';

  const emptyHtml = totalCount === 0
    ? `<div class="empty">No endpoints detected. Run Source Import or "Analyze with AI" from Document Import first.</div>`
    : '';

  return /* html */`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${n}';"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Endpoint Summary</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px 24px 40px; }

    .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    h1 { font-size: 16px; font-weight: 700; flex: 1; }
    .total { font-size: 12px; color: var(--vscode-descriptionForeground); }
    .filter-input {
      padding: 5px 9px; border-radius: 5px; font-size: 12px;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      font-family: var(--vscode-font-family); width: 220px;
    }
    .filter-input::placeholder { color: var(--vscode-input-placeholderForeground); }

    section { margin-bottom: 28px; }
    .section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .kind-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .kind-title { font-size: 13px; font-weight: 700; }
    .kind-count { font-size: 11px; color: var(--vscode-descriptionForeground); background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 6px; border-radius: 10px; }

    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    thead th { text-align: left; padding: 5px 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); }
    tbody tr { border-bottom: 1px solid var(--vscode-panel-border); }
    tbody tr:hover { background: var(--vscode-list-hoverBackground); }
    tbody tr.hidden { display: none; }
    td { padding: 6px 8px; vertical-align: middle; }

    .method-badge { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: 1px solid; white-space: nowrap; }
    .ep-path { font-family: monospace; font-size: 12px; }
    .ep-class { font-size: 12px; font-weight: 600; }
    .ep-file { font-size: 11px; font-family: monospace; color: var(--vscode-textLink-foreground); text-decoration: none; }
    .ep-file:hover { text-decoration: underline; }
    .muted { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .semantic-badge { display: inline-block; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px; background: #7c3aed22; color: #a78bfa; border: 1px solid #7c3aed44; cursor: default; }
    .document-badge { display: inline-block; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px; background: #d9770622; color: #fb923c; border: 1px solid #d9770644; cursor: default; margin-right: 4px; }
    .doc-file { font-family: monospace; font-size: 10px; }
    .empty { padding: 40px 0; text-align: center; color: var(--vscode-descriptionForeground); font-size: 13px; }
  </style>
</head>
<body>
  <div class="toolbar">
    <h1>Endpoint Summary</h1>
    <span class="total">${totalCount} endpoint${totalCount !== 1 ? 's' : ''} detected${sourceSummary}</span>
    <input class="filter-input" id="filter" type="search" placeholder="Filter by path, class, file…" />
  </div>
  ${emptyHtml}
  ${sectionHtml}
  <script nonce="${n}">
    const vscode = acquireVsCodeApi();

    document.querySelectorAll('a.ep-file').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        vscode.postMessage({ type: 'open', file: a.dataset.file, line: Number(a.dataset.line) });
      });
    });

    const filterInput = document.getElementById('filter');
    filterInput.addEventListener('input', () => {
      const q = filterInput.value.toLowerCase();
      document.querySelectorAll('tbody tr').forEach((row) => {
        row.classList.toggle('hidden', q.length > 0 && !row.textContent.toLowerCase().includes(q));
      });
    });
  </script>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
