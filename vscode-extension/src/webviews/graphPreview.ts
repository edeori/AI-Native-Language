import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';

type GraphNode = {
  id: string;
  type: string;
  name: string;
  description?: string;
  sourceRef?: string;
};

type GraphEdge = {
  from: string;
  to: string;
  type: string;
};

interface DiagramClassification {
  title?: string;
  summary?: string;
  databaseSchema?: {
    title?: string;
    summary?: string;
    tables: Array<{
      name: string;
      description?: string;
      primaryKey?: string[];
      columns: Array<{
        name: string;
        type?: string;
        detail?: string;
      }>;
    }>;
    relationships?: Array<{
      fromTable: string;
      fromColumn: string;
      toTable: string;
      toColumn: string;
      cardinality: string;
      description?: string;
    }>;
  };
}

type DatabaseColumn = {
  name: string;
  type?: string;
  detail?: string;
};

type DatabaseTable = {
  name: string;
  description?: string;
  primaryKey?: string[];
  columns: DatabaseColumn[];
};

type DatabaseTables = NonNullable<DiagramClassification['databaseSchema']>['tables'];

interface PreviewMetadata {
  applications?: string[];
  applicationsDetailed?: Array<{
    name: string;
    role: string;
    multiModule?: boolean;
    modules?: string[];
    cards?: Array<{
      key: string;
      title: string;
      subtitle?: string;
      items?: string[];
      flow?: string[];
    }>;
  }>;
  buildSupport?: string[];
  runtimeModules?: string[];
  api?: string[];
  app?: string[];
  common?: string[];
  events?: { types?: string[]; producers?: string[]; flow?: string[] };
  web?: { ingress?: string[]; validation?: string[]; errorHandling?: string[]; configuration?: string[]; securityBoundary?: string[] };
  persistence?: { repositories?: string[]; mappers?: string[]; entities?: string[] };
  service?: { catalog?: string[]; details?: string[]; exceptions?: string[]; violations?: string[] };
  security?: string[];
}

type CanonicalGraph = {
  schemaVersion?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata?: {
    title?: string;
    sourcePath?: string;
    createdAt?: string;
    reviewedAt?: string;
    databaseSchema?: DiagramClassification['databaseSchema'];
    review?: {
      reviewedAt?: string;
      diagramClassification?: DiagramClassification;
      provider?: string;
      mode?: string;
      model?: string;
      bridgeAction?: string;
      usedEndpoint?: string;
      promptPath?: string;
      reviewArtifactPath?: string;
      promptArtifactPath?: string;
      summary?: string;
      notes?: string[];
      issues?: Array<{ severity: string; code: string; message: string }>;
    };
    preview?: PreviewMetadata;
  };
};

interface AstIndexArtifactLite {
  summary?: {
    javaFileCount?: number;
    packageCount?: number;
    typeCount?: number;
    methodCount?: number;
    fieldCount?: number;
    endpointCount?: number;
    annotationCount?: number;
  };
  packages?: Array<{
    packageName: string;
    fileCount: number;
    typeCount: number;
    topImports?: string[];
  }>;
  types?: Array<{
    name: string;
    applicationHint?: string;
    layerHint?: string;
    annotations?: string[];
    methods?: Array<{ name: string }>;
  }>;
  endpoints?: Array<{
    method: string;
    path: string;
    typeName?: string;
  }>;
  annotations?: Array<{
    name: string;
    occurrences: number;
  }>;
}

interface JqassistantSupportArtifactLite {
  status?: string;
  summary?: {
    applicationCount?: number;
    moduleCount?: number;
    technologyCount?: number;
    packageCount?: number;
    typeDependencyCount?: number;
    technologies?: string[];
  };
  applications?: Array<{
    name: string;
    role: string;
    multiModule: boolean;
    moduleRoots: string[];
    internalModules: Array<{
      name: string;
      purpose: string;
      source: string;
      pathHints: string[];
    }>;
  }>;
  runtimeLayers?: Array<{ name: string; role: string }>;
  supportModules?: Array<{ name: string; role: string }>;
  graphs?: {
    projectGraph?: {
      projects?: Array<{
        artifactId: string;
        groupId?: string;
        name?: string;
      }>;
      modules?: Array<{
        parentArtifactId: string;
        moduleName: string;
      }>;
    };
    packageGraph?: {
      packages?: string[];
      relations?: Array<{
        fromPackage: string;
        toPackage: string;
        count: number;
      }>;
    };
  };
  warnings?: string[];
}

interface FlowMapArtifactLite {
  support?: {
    astEndpoints?: number;
    jqassistantPackages?: number;
    jqassistantTypeDependencies?: number;
    supportGraphNodes?: number;
    supportGraphEdges?: number;
  };
  triggers?: Array<{
    kind: string;
    name: string;
    source: string;
    target: string;
    notes?: string[];
  }>;
  flows?: Array<{
    name: string;
    trigger: string;
    summary: string;
    steps: string[];
    confidence?: number;
    warnings?: string[];
  }>;
  stages?: {
    entrypointDiscovery?: {
      count?: number;
      entrypoints?: Array<{
        kind: string;
        name: string;
        trigger: string;
        target: string;
        notes?: string[];
      }>;
    };
    flowValidation?: {
      count?: number;
      issues?: Array<{
        severity: string;
        category: string;
        message: string;
      }>;
    };
  };
}

interface DeveloperArtifacts {
  outputDir?: string;
  astIndex?: AstIndexArtifactLite;
  jqassistant?: JqassistantSupportArtifactLite;
  flowMap?: FlowMapArtifactLite;
}

export class GraphPreviewPanel {
  private static currentPanel: GraphPreviewPanel | undefined;
  private renderVersion = 0;

  static show(
    context: vscode.ExtensionContext,
    graph: CanonicalGraph,
    title: string,
  ): GraphPreviewPanel {
    if (GraphPreviewPanel.currentPanel) {
      GraphPreviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.Two);
      GraphPreviewPanel.currentPanel.update(graph, title);
      return GraphPreviewPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiNativeGraphPreview',
      'AI Native Graph Preview',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    GraphPreviewPanel.currentPanel = new GraphPreviewPanel(panel, context, graph, title);
    return GraphPreviewPanel.currentPanel;
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private graph: CanonicalGraph,
    private title: string,
  ) {
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.render();
  }

  update(graph: CanonicalGraph, title: string): void {
    this.graph = graph;
    this.title = title;
    this.render();
  }

  dispose(): void {
    GraphPreviewPanel.currentPanel = undefined;
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
    this.panel.dispose();
  }

  private render(): void {
    const version = ++this.renderVersion;
    void this.renderAsync(version);
  }

  private async renderAsync(version: number): Promise<void> {
    const developerArtifacts = await loadDeveloperArtifacts(this.graph);
    if (version !== this.renderVersion) {
      return;
    }
    const cspSource = this.panel.webview.cspSource;
    const nonce = createNonce();
    const insights = deriveInsights(this.graph);
    const artifacts = extractArtifactSummary(this.graph);
    const graphJson = escapeHtml(JSON.stringify(this.graph, null, 2));
    const summary = `nodes=${this.graph.nodes.length}, edges=${this.graph.edges.length}`;
    const developerSections = renderDeveloperSections(insights, developerArtifacts);

    this.panel.webview.html = /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Native Graph Preview</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        margin: 0;
        padding: 20px;
      }
      .header {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 14px;
      }
      .title {
        font-size: 20px;
        font-weight: 700;
      }
      .subtitle {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      .artifact-strip {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin: 14px 0 12px;
      }
      .artifact-card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        padding: 10px 12px;
        background: var(--vscode-sideBar-background);
        display: grid;
        gap: 4px;
      }
      .artifact-label {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 700;
      }
      .artifact-value {
        font-size: 12px;
        font-weight: 700;
        line-height: 1.35;
        word-break: break-word;
      }
      .artifact-meta {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.35;
      }
      .reading-order {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        padding: 10px 12px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        font-size: 13px;
        margin-bottom: 14px;
      }
      .reading-order strong {
        margin-right: 8px;
      }
      .component-section {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 16px;
        background: var(--vscode-sideBar-background);
        padding: 14px;
        margin-bottom: 14px;
        display: grid;
        gap: 12px;
      }
      .component-section-title {
        font-size: 14px;
        font-weight: 800;
      }
      .component-section-subtitle {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.35;
      }
      .component-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
      }
      .component-card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 14px;
        background: var(--vscode-editor-background);
        padding: 12px;
        display: grid;
        gap: 10px;
      }
      .component-card-title {
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .component-card-subtitle {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.35;
      }
      .component-list {
        display: grid;
        gap: 6px;
      }
      .component-list-item {
        font-size: 12px;
        line-height: 1.5;
        color: var(--vscode-foreground);
        padding-left: 14px;
        position: relative;
        word-break: break-word;
      }
      .component-list-item::before {
        content: "•";
        position: absolute;
        left: 0;
        color: var(--vscode-descriptionForeground);
      }
      .mini-flow {
        display: flex;
        flex-wrap: nowrap;
        gap: 8px;
        align-items: center;
        overflow-x: auto;
        padding-bottom: 2px;
      }
      .mini-flow-box {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
        background: var(--vscode-sideBar-background);
        padding: 8px 10px;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.3;
      }
      .mini-flow-arrow {
        color: var(--vscode-descriptionForeground);
        font-weight: 800;
      }
      .drawio-notes {
        display: grid;
        gap: 10px;
        grid-template-columns: 1fr 1fr;
      }
      .drawio-note {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        background: var(--vscode-editor-background);
        padding: 10px 12px;
      }
      .drawio-note-title {
        font-size: 12px;
        font-weight: 800;
        margin-bottom: 4px;
      }
      .database-schema {
        display: grid;
        gap: 10px;
      }
      .database-schema-summary {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        line-height: 1.45;
      }
      .database-schema-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 12px;
      }
      .database-schema-table {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 16px;
        background: linear-gradient(180deg, var(--vscode-editor-background), var(--vscode-sideBar-background));
        padding: 0;
        overflow: hidden;
        display: grid;
        gap: 0;
      }
      .database-schema-table-header {
        padding: 12px 14px 10px;
        background: linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 92%, transparent), var(--vscode-sideBar-background));
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      .database-schema-table-title {
        font-size: 13px;
        font-weight: 800;
      }
      .database-schema-table-description {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-top: 4px;
        line-height: 1.35;
      }
      .database-schema-columns {
        display: grid;
        gap: 8px;
        padding: 12px 14px 14px;
      }
      .database-schema-column {
        display: grid;
        grid-template-columns: minmax(120px, 180px) 1fr;
        gap: 10px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        background: var(--vscode-editor-background);
        padding: 9px 10px;
      }
      .database-schema-column-name {
        font-size: 12px;
        font-weight: 800;
        line-height: 1.25;
      }
      .database-schema-column-detail {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.4;
      }
      .er-canvas {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 16px;
        background: linear-gradient(180deg, var(--vscode-editor-background), var(--vscode-sideBar-background));
        overflow: auto;
        padding: 12px;
      }
      .er-svg {
        display: block;
        min-width: 100%;
      }
      .er-table {
        fill: var(--vscode-editor-background);
        stroke: color-mix(in srgb, var(--vscode-editor-foreground) 18%, var(--vscode-panel-border));
        stroke-width: 1.3;
      }
      .er-table-header {
        fill: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-sideBar-background));
        stroke: none;
      }
      .er-table-title {
        fill: var(--vscode-foreground);
        font-size: 12px;
        font-weight: 800;
      }
      .er-table-description {
        fill: var(--vscode-descriptionForeground);
        font-size: 8px;
      }
      .er-column-name {
        fill: var(--vscode-foreground);
        font-size: 10px;
        font-weight: 700;
      }
      .er-column-type {
        fill: var(--vscode-descriptionForeground);
        font-size: 9px;
      }
      .er-divider {
        stroke: color-mix(in srgb, var(--vscode-editor-foreground) 12%, var(--vscode-panel-border));
        stroke-width: 1;
      }
      .er-edge {
        fill: none;
        stroke: color-mix(in srgb, var(--vscode-foreground) 88%, var(--vscode-descriptionForeground));
        stroke-width: 1.7;
        opacity: 0.85;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .er-terminal {
        fill: var(--vscode-foreground);
        opacity: 0.82;
      }
      .er-relationship {
        fill: color-mix(in srgb, var(--vscode-editor-background) 94%, var(--vscode-sideBar-background));
        stroke: var(--vscode-panel-border);
        stroke-width: 1.3;
        opacity: 0.97;
      }
      .er-relationship-label {
        fill: var(--vscode-foreground);
        font-size: 8px;
        font-weight: 800;
        letter-spacing: 0.2px;
      }
      .er-relation-cardinality {
        fill: var(--vscode-descriptionForeground);
        font-size: 9px;
        font-weight: 700;
      }
      .er-pk-label {
        fill: var(--vscode-descriptionForeground);
        font-size: 9px;
        font-weight: 700;
        font-style: italic;
      }
      .er-end-label {
        fill: var(--vscode-descriptionForeground);
        font-size: 9px;
        font-weight: 800;
      }
      .schematic-items {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .schematic-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 5px 10px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        font-size: 12px;
        line-height: 1.2;
        max-width: 100%;
      }
      .schematic-pill strong {
        font-weight: 700;
      }
      .flow-panel {
        margin-top: 14px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        padding: 12px;
        background: var(--vscode-sideBar-background);
      }
      .flow-grid {
        display: grid;
        gap: 12px;
      }
      .flow-card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        padding: 12px;
        background: var(--vscode-editor-background);
      }
      .flow-card-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        margin-bottom: 8px;
      }
      .flow-card-title {
        font-size: 14px;
        font-weight: 800;
      }
      .flow-card-subtitle {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
      .flow-card-steps {
        display: grid;
        gap: 6px;
      }
      .flow-step {
        display: flex;
        gap: 8px;
        align-items: baseline;
        line-height: 1.35;
      }
      .flow-step code {
        flex: 0 0 auto;
        font-size: 11px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        padding: 2px 6px;
        border-radius: 999px;
      }
      .timeline {
        display: flex;
        gap: 10px;
        align-items: stretch;
        overflow-x: auto;
        padding-bottom: 4px;
      }
      svg {
        display: block;
      }
      .footer {
        margin-top: 12px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .panel {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        padding: 12px;
        background: var(--vscode-sideBar-background);
      }
      .panel-title {
        font-weight: 700;
        margin-bottom: 8px;
      }
      .insight-group {
        display: grid;
        gap: 4px;
        margin-bottom: 10px;
      }
      .insight-label {
        font-size: 11px;
        font-weight: 700;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .insight-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .insight-pill {
        padding: 4px 8px;
        border-radius: 999px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        font-size: 12px;
      }
      .flow-list {
        margin: 0;
        padding-left: 18px;
      }
      .flow-list li {
        margin: 5px 0;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 11px;
        line-height: 1.45;
      }
      ul {
        margin: 0;
        padding-left: 18px;
      }
      li {
        margin: 4px 0;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="title">${escapeHtml(this.title || 'Graph Preview')}</div>
      <div class="subtitle">Developer view built from deterministic artifacts: AST, jqassistant structure, execution flows, and ER schema.</div>
      <div class="meta">
        <div>Schema: <code>${escapeHtml(this.graph.schemaVersion ?? 'n/a')}</code></div>
        <div>Summary: <code>${escapeHtml(summary)}</code></div>
        ${this.graph.metadata?.sourcePath ? `<div>Source: <code>${escapeHtml(this.graph.metadata.sourcePath)}</code></div>` : ''}
      </div>
    </div>

    <div class="artifact-strip">
      <div class="artifact-card">
        <div class="artifact-label">Semantic view</div>
        <div class="artifact-value">${escapeHtml(artifacts.semanticView)}</div>
        <div class="artifact-meta">${escapeHtml(artifacts.semanticMeta)}</div>
      </div>
      <div class="artifact-card">
        <div class="artifact-label">Validation</div>
        <div class="artifact-value">${escapeHtml(artifacts.validationView)}</div>
        <div class="artifact-meta">${escapeHtml(artifacts.validationMeta)}</div>
      </div>
      <div class="artifact-card">
        <div class="artifact-label">Review</div>
        <div class="artifact-value">${escapeHtml(artifacts.reviewView)}</div>
        <div class="artifact-meta">${escapeHtml(artifacts.reviewMeta)}</div>
      </div>
      <div class="artifact-card">
        <div class="artifact-label">Graph</div>
        <div class="artifact-value">${escapeHtml(artifacts.graphView)}</div>
        <div class="artifact-meta">${escapeHtml(artifacts.graphMeta)}</div>
      </div>
    </div>

    <div class="reading-order">
      <strong>Reading order:</strong>
      1) inspect AST structure, 2) inspect jqassistant structure and dependencies, 3) review deterministic flow-map, 4) verify ER schema, 5) open raw graph only if needed.
    </div>

    ${developerSections}

    <div class="panel">
      <div class="panel-title">External dependencies</div>
      <div class="insight-list">${renderList(insights.externalDependencies)}</div>
    </div>

    <div class="flow-panel">
      <div class="panel-title">Execution flows</div>
      <div class="flow-grid">
        ${renderFlowScenarios(insights.flowScenarios)}
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Database schema</div>
      ${renderDatabaseSchema(extractDatabaseSchema(this.graph), insights)}
    </div>

    <div class="panel">
      <div class="panel-title">Graph snapshot</div>
      <details>
        <summary>Raw JSON</summary>
        <pre>${graphJson}</pre>
      </details>
    </div>
  </body>
</html>`;
  }
}

async function loadDeveloperArtifacts(graph: CanonicalGraph): Promise<DeveloperArtifacts> {
  const sourcePath = graph.metadata?.sourcePath;
  if (!sourcePath) {
    return {};
  }
  const outputDir = path.dirname(sourcePath);
  const [astIndex, jqassistant, flowMap] = await Promise.all([
    readJsonIfExists<AstIndexArtifactLite>(path.join(outputDir, 'source.ast-index.json')),
    readJsonIfExists<JqassistantSupportArtifactLite>(path.join(outputDir, 'source.jqassistant-graph.json')),
    readJsonIfExists<FlowMapArtifactLite>(path.join(outputDir, 'source.flow-map.json')),
  ]);
  return { outputDir, astIndex, jqassistant, flowMap };
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function createNonce(): string {
  return Math.random().toString(36).slice(2);
}

function renderDeveloperSections(
  insights: ReturnType<typeof deriveInsights>,
  artifacts: DeveloperArtifacts,
): string {
  return [
    renderAstSection(artifacts.astIndex),
    renderJqassistantSection(artifacts.jqassistant, insights),
    renderFlowMapSection(artifacts.flowMap, insights),
  ].join('');
}

function renderAstSection(astIndex: AstIndexArtifactLite | undefined): string {
  const summary = astIndex?.summary;
  const types = astIndex?.types ?? [];
  const packages = [...(astIndex?.packages ?? [])].sort((left, right) => (right.typeCount - left.typeCount) || left.packageName.localeCompare(right.packageName));
  const endpoints = astIndex?.endpoints ?? [];
  const annotations = [...(astIndex?.annotations ?? [])].sort((left, right) => (right.occurrences - left.occurrences) || left.name.localeCompare(right.name));
  const applicationHints = countLabels(types.map((item) => item.applicationHint).filter(Boolean) as string[]);
  const layerHints = countLabels(types.map((item) => item.layerHint).filter(Boolean) as string[]);

  return `
    <div class="component-section">
      <div class="component-section-title">AST view</div>
      <div class="component-section-subtitle">AST = Abstract Syntax Tree. Deterministic source structure indexed from Java code.</div>
      <div class="component-grid">
        ${renderMetricCard('AST summary', [
          `Java files: ${summary?.javaFileCount ?? 0}`,
          `Packages: ${summary?.packageCount ?? 0}`,
          `Types: ${summary?.typeCount ?? 0}`,
          `Methods: ${summary?.methodCount ?? 0}`,
          `Fields: ${summary?.fieldCount ?? 0}`,
          `Endpoints: ${summary?.endpointCount ?? 0}`,
          `Annotations: ${summary?.annotationCount ?? 0}`,
        ], 'AST summary not available.')}
        ${renderMetricCard('Application hints', applicationHints, 'No application hints inferred from AST types.')}
        ${renderMetricCard('Layer hints', layerHints, 'No layer hints inferred from AST types.')}
        ${renderMetricCard('Top packages', packages.slice(0, 12).map((item) => `${item.packageName} — ${item.typeCount} types, ${item.fileCount} files`), 'No package index found.')}
        ${renderMetricCard('Endpoints', endpoints.slice(0, 12).map((item) => `${item.method} ${item.path}${item.typeName ? ` → ${item.typeName}` : ''}`), 'No endpoints found in AST index.')}
        ${renderMetricCard('Top annotations', annotations.slice(0, 12).map((item) => `${item.name} — ${item.occurrences}`), 'No annotation summary found.')}
      </div>
    </div>
  `;
}

function renderJqassistantSection(
  jqassistant: JqassistantSupportArtifactLite | undefined,
  insights: ReturnType<typeof deriveInsights>,
): string {
  const summary = jqassistant?.summary;
  const apps = jqassistant?.applications ?? [];
  const runtimeLayers = jqassistant?.runtimeLayers ?? [];
  const supportModules = jqassistant?.supportModules ?? [];
  const projectModules = jqassistant?.graphs?.projectGraph?.modules ?? [];
  const packageRelations = [...(jqassistant?.graphs?.packageGraph?.relations ?? [])]
    .sort((left, right) => (right.count - left.count) || left.fromPackage.localeCompare(right.fromPackage))
    .slice(0, 12)
    .map((item) => `${item.fromPackage} → ${item.toPackage} (${item.count})`);

  return `
    <div class="component-section">
      <div class="component-section-title">jqassistant structure graph</div>
      <div class="component-section-subtitle">Repository structure, Maven/application boundaries, package relations, and architectural support evidence.</div>
      <div class="component-grid">
        ${renderMetricCard('jqassistant summary', [
          `Status: ${jqassistant?.status ?? 'not available'}`,
          `Applications: ${summary?.applicationCount ?? apps.length}`,
          `Modules: ${summary?.moduleCount ?? projectModules.length}`,
          `Technologies: ${summary?.technologyCount ?? summary?.technologies?.length ?? 0}`,
          `Packages: ${summary?.packageCount ?? 0}`,
          `Type dependencies: ${summary?.typeDependencyCount ?? 0}`,
        ], 'jqassistant summary not available.')}
        ${renderMetricCard('Maven projects', apps.length > 0
          ? apps.map((app) => `${app.name} — ${app.role}${app.multiModule ? ' · multi-module' : ''}`.trimEnd())
          : insights.applications.map((item) => item.replace(/^APPLICATION:\s*/i, '')), 'No Maven projects found.')}
        ${renderMetricCard('Internal modules', apps.flatMap((app) => app.internalModules.map((module) => `${app.name} / ${module.name} — ${module.purpose}`)), 'No internal modules found.')}
        ${renderMetricCard('Runtime layers', runtimeLayers.map((item) => `${item.name} — ${item.role}`), 'No runtime layers found.')}
        ${renderMetricCard('Support modules', supportModules.map((item) => `${item.name} — ${item.role}`), 'No support modules found.')}
        ${renderMetricCard('Project graph modules', projectModules.map((item) => `${item.parentArtifactId} → ${item.moduleName}`), 'No Maven/project graph modules found.')}
        ${renderMetricCard('Package relations', packageRelations, 'No package relations found.')}
        ${renderMetricCard('Warnings', jqassistant?.warnings ?? [], 'No jqassistant warnings.')}
      </div>
    </div>
  `;
}

function renderFlowMapSection(
  flowMap: FlowMapArtifactLite | undefined,
  insights: ReturnType<typeof deriveInsights>,
): string {
  const flows = flowMap?.flows ?? insights.flowScenarios.map((item) => ({
    name: item.title,
    trigger: item.summary,
    summary: item.summary,
    steps: item.steps,
    confidence: undefined,
    warnings: [],
  }));
  const entrypoints = flowMap?.stages?.entrypointDiscovery?.entrypoints ?? [];
  const issues = flowMap?.stages?.flowValidation?.issues ?? [];

  return `
    <div class="component-section">
      <div class="component-section-title">Execution flows</div>
      <div class="component-section-subtitle">Deterministic flow-map assembled from entrypoints, traces, clustering, interpretation, and validation.</div>
      <div class="component-grid">
        ${renderMetricCard('Flow-map summary', [
          `Entrypoints: ${flowMap?.stages?.entrypointDiscovery?.count ?? entrypoints.length}`,
          `Flows: ${flows.length}`,
          `Validation issues: ${flowMap?.stages?.flowValidation?.count ?? issues.length}`,
          ...(flowMap?.support ? [
            `AST endpoints: ${flowMap.support.astEndpoints ?? 0}`,
            `jqassistant packages: ${flowMap.support.jqassistantPackages ?? 0}`,
            `Support graph nodes: ${flowMap.support.supportGraphNodes ?? 0}`,
          ] : []),
        ], 'Flow-map summary not available.')}
        ${renderMetricCard('Entrypoints', entrypoints.slice(0, 12).map((item) => `${item.kind} — ${item.name} → ${item.target}`), 'No entrypoints found.')}
        ${renderMetricCard('Validation issues', issues.slice(0, 12).map((item) => `${item.severity} / ${item.category} — ${item.message}`), 'No flow validation issues.')}
      </div>
      <div class="flow-panel">
        <div class="panel-title">Flow paths</div>
        <div class="flow-grid">
          ${flows.length > 0
            ? flows.slice(0, 8).map((flow, index) => renderDeveloperFlowCard(flow, index)).join('')
            : renderFlowScenarios(insights.flowScenarios)}
        </div>
      </div>
    </div>
  `;
}

function renderDeveloperFlowCard(
  flow: {
    name: string;
    trigger: string;
    summary: string;
    steps: string[];
    confidence?: number;
    warnings?: string[];
  },
  index: number,
): string {
  return `
    <div class="flow-card">
      <div class="flow-card-header">
        <div class="flow-card-title">${escapeHtml(flow.name)}</div>
        <div class="flow-card-subtitle">Flow ${index + 1}${typeof flow.confidence === 'number' ? ` · confidence ${Math.round(flow.confidence * 100)}%` : ''}</div>
      </div>
      <div class="flow-card-subtitle"><strong>Trigger:</strong> ${escapeHtml(flow.trigger)}</div>
      <div class="flow-card-subtitle">${escapeHtml(flow.summary)}</div>
      <div class="flow-card-steps">
        ${flow.steps.slice(0, 10).map((step, stepIndex) => `<div class="flow-step"><code>${stepIndex + 1}</code><div>${escapeHtml(step)}</div></div>`).join('')}
      </div>
      ${flow.warnings?.length ? `<div class="component-list" style="margin-top:10px;">${flow.warnings.map((warning) => `<div class="component-list-item">${escapeHtml(warning)}</div>`).join('')}</div>` : ''}
    </div>
  `;
}

function renderMetricCard(title: string, items: string[], empty: string): string {
  const filtered = items.filter(Boolean);
  return `
    <div class="component-card">
      <div class="component-card-title">${escapeHtml(title)}</div>
      <div class="component-list">
        ${(filtered.length > 0 ? filtered : [empty]).map((item) => `<div class="component-list-item">${escapeHtml(item)}</div>`).join('')}
      </div>
    </div>
  `;
}

function countLabels(items: string[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, count]) => `${label} — ${count}`);
}

function renderDatabaseSchema(
  schema: DiagramClassification['databaseSchema'] | undefined,
  insights: ReturnType<typeof deriveInsights>,
): string {
  const schemaTables = schema?.tables?.length
    ? schema.tables
    : buildFallbackDatabaseSchema(insights);

  const summary = schema?.summary || 'Database schema inferred from persistence and repository signals.';
  const relationships = (schema?.relationships?.length ? schema.relationships : inferErRelationships(schemaTables));
  const erDiagram = renderErDiagram(schemaTables, relationships);

  return `
    <div class="database-schema">
      <div class="database-schema-summary">${escapeHtml(summary)}</div>
      ${erDiagram}
      <div class="drawio-notes" style="margin-top: 12px;">
        <div class="drawio-note">
          <div class="drawio-note-title">Tables</div>
          <div class="schematic-items">
            ${schemaTables.map((table) => `<span class="schematic-pill">${escapeHtml(table.name)}</span>`).join('')}
          </div>
        </div>
        <div class="drawio-note">
          <div class="drawio-note-title">Relationships</div>
          <div class="schematic-items">
            ${
              relationships.length > 0
                ? relationships.slice(0, 10).map((relation) => `<span class="schematic-pill">${escapeHtml(`${relation.fromTable}.${relation.fromColumn} → ${relation.toTable}.${relation.toColumn} (${relation.cardinality})`)}</span>`).join('')
                : '<span class="schematic-pill">none inferred</span>'
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

interface ErRelationship {
  fromTable: string;
  toTable: string;
  fromColumn: string;
  toColumn: string;
  cardinality: string;
  description?: string;
}

interface LayoutTable {
  name: string;
  description?: string;
  primaryKey?: string[];
  columns: DatabaseColumn[];
  x: number;
  y: number;
  width: number;
  height: number;
  headerHeight: number;
}

function inferErRelationships(tables: DatabaseTables): ErRelationship[] {
  const tableNames = tables.map((table) => table.name);
  const relationships: ErRelationship[] = [];
  const seen = new Set<string>();

  for (const table of tables) {
    for (const column of table.columns) {
      if (!/_id$/i.test(column.name) || column.name === 'id') {
        continue;
      }

      const base = column.name.replace(/_id$/i, '');
      const target = guessTableForForeignKey(base, table.name, tableNames);
      if (!target || target === table.name) {
        continue;
      }

      const key = `${table.name}:${column.name}:${target}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      relationships.push({
        fromTable: table.name,
        toTable: target,
        fromColumn: column.name,
        toColumn: 'id',
        cardinality: 'N:1',
      });
    }
  }

  return relationships;
}

function guessTableForForeignKey(base: string, sourceTable: string, tableNames: string[]): string | undefined {
  const normalized = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const candidates = new Set<string>([
    normalized,
    `${normalized}s`,
    `${normalized}es`,
    normalized.replace(/s$/, ''),
  ]);

  if (normalized === 'owner' || normalized === 'user' || normalized === 'actor' || normalized === 'author' || normalized === 'creator') {
    candidates.add('users');
  }
  if (normalized === 'subject') {
    candidates.add('notes');
    candidates.add('users');
  }
  if (normalized === 'note') {
    candidates.add('notes');
  }
  if (normalized === 'audit') {
    candidates.add('audit_log');
  }
  if (normalized === 'parent') {
    candidates.add(sourceTable);
  }

  for (const candidate of candidates) {
    if (tableNames.includes(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function renderErDiagram(
  tables: DatabaseTables,
  relationships: ErRelationship[],
): string {
  const layout = layoutErTables(tables);
  const relationElements = relationships
    .map((relation) => {
      const from = layout.find((table) => table.name === relation.fromTable);
      const to = layout.find((table) => table.name === relation.toTable);
      if (!from || !to) {
        return '';
      }
      const fromPoint = edgeAnchor(from, to);
      const toPoint = edgeAnchor(to, from);
      const midX = Math.round((fromPoint.x + toPoint.x) / 2);
      const midY = Math.round((fromPoint.y + toPoint.y) / 2);
      const path = `M ${fromPoint.x} ${fromPoint.y} L ${midX} ${fromPoint.y} L ${midX} ${toPoint.y} L ${toPoint.x} ${toPoint.y}`;
      const diamondWidth = 18;
      const diamondHeight = 18;
      const diamondPoints = [
        `${midX},${midY - diamondHeight / 2}`,
        `${midX + diamondWidth / 2},${midY}`,
        `${midX},${midY + diamondHeight / 2}`,
        `${midX - diamondWidth / 2},${midY}`,
      ].join(' ');
      const sourceCardinality = relation.cardinality.startsWith('N') ? 'N' : '1';
      const targetCardinality = relation.cardinality.endsWith('N') ? 'N' : '1';
      return `
        <g>
          <path class="er-edge" d="${path}">
            <title>${escapeHtml(relation.description ?? `${relation.fromTable}.${relation.fromColumn} → ${relation.toTable}.${relation.toColumn}`)}</title>
          </path>
          <polygon points="${diamondPoints}" class="er-relationship">
            <title>${escapeHtml(relation.description ?? `${relation.fromTable}.${relation.fromColumn} → ${relation.toTable}.${relation.toColumn}`)}</title>
          </polygon>
          <circle cx="${fromPoint.x}" cy="${fromPoint.y}" r="4.5" class="er-terminal" />
          <circle cx="${toPoint.x}" cy="${toPoint.y}" r="4.5" class="er-terminal" />
          <text x="${fromPoint.x + (fromPoint.x < toPoint.x ? 10 : -10)}" y="${fromPoint.y - 8}" text-anchor="${fromPoint.x < toPoint.x ? 'start' : 'end'}" class="er-end-label">${escapeHtml(sourceCardinality)}</text>
          <text x="${toPoint.x + (toPoint.x < fromPoint.x ? 10 : -10)}" y="${toPoint.y - 8}" text-anchor="${toPoint.x < fromPoint.x ? 'start' : 'end'}" class="er-end-label">${escapeHtml(targetCardinality)}</text>
        </g>
      `;
    })
    .join('');

  const tableElements = layout
    .map((table) => {
      const titleLines = wrapSvgText(table.name, 22);
      const descriptionLines = wrapSvgText(table.description ?? '', 28);
      const columnLines = table.columns
        .map((column, index) => {
          const columnY = table.y + table.headerHeight + 26 + index * 18;
          return `
            <g>
              <text x="${table.x + 16}" y="${columnY}" class="er-column-name">${escapeHtml(column.name)}</text>
              ${column.type ? `<text x="${table.x + table.width - 16}" y="${columnY}" text-anchor="end" class="er-column-type">${escapeHtml(column.type)}</text>` : ''}
            </g>
          `;
        })
        .join('');

      return `
        <g>
          <rect x="${table.x}" y="${table.y}" width="${table.width}" height="${table.height}" rx="16" ry="16" class="er-table" />
          <rect x="${table.x}" y="${table.y}" width="${table.width}" height="${table.headerHeight}" rx="16" ry="16" class="er-table-header" />
          <text x="${table.x + 16}" y="${table.y + 22}" class="er-table-title">
            ${titleLines.map((line, lineIndex) => `<tspan x="${table.x + 16}" dy="${lineIndex === 0 ? 0 : 13}">${escapeHtml(line)}</tspan>`).join('')}
          </text>
          ${
            descriptionLines.length
              ? `<text x="${table.x + 16}" y="${table.y + 22 + Math.max(1, titleLines.length) * 13 + 2}" class="er-table-description">${descriptionLines
                  .map((line, lineIndex) => `<tspan x="${table.x + 16}" dy="${lineIndex === 0 ? 0 : 13}">${escapeHtml(line)}</tspan>`)
                  .join('')}</text>`
              : ''
          }
          <line x1="${table.x}" y1="${table.y + table.headerHeight}" x2="${table.x + table.width}" y2="${table.y + table.headerHeight}" class="er-divider" />
          ${
            table.primaryKey?.length
              ? `<text x="${table.x + 16}" y="${table.y + table.headerHeight + 18}" class="er-pk-label">PK ${escapeHtml(table.primaryKey.join(', '))}</text>`
              : ''
          }
          ${columnLines}
        </g>
      `;
    })
    .join('');

  const width = layout.reduce((max, table) => Math.max(max, table.x + table.width + 24), 1200);
  const height = layout.reduce((max, table) => Math.max(max, table.y + table.height + 24), 520);

  return `
    <div class="er-canvas">
      <svg class="er-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
        ${relationElements}
        ${tableElements}
      </svg>
    </div>
  `;
}

function layoutErTables(tables: DatabaseTables): LayoutTable[] {
  const count = tables.length;
  const columns = count <= 2 ? count : count <= 4 ? 2 : 3;
  const boxWidth = 330;
  const boxHeights = tables.map((table) => {
    const headerHeight = computeErHeaderHeight(table);
    return Math.max(220, headerHeight + 34 + table.columns.length * 18 + 14);
  });
  const gapX = 56;
  const gapY = 42;
  const rowHeights = [] as number[];

  for (let index = 0; index < count; index += columns) {
    rowHeights.push(Math.max(...boxHeights.slice(index, index + columns)));
  }

  const rowOffsets: number[] = [];
  let offsetY = 24;
  for (const rowHeight of rowHeights) {
    rowOffsets.push(offsetY);
    offsetY += rowHeight + gapY;
  }

  return tables.map((table, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const height = boxHeights[index];
    const x = 24 + col * (boxWidth + gapX);
    const y = rowOffsets[row] + Math.floor((rowHeights[row] - height) / 2);
    return {
      ...table,
      x,
      y,
      width: boxWidth,
      height,
      headerHeight: computeErHeaderHeight(table),
    };
  });
}

function computeErHeaderHeight(table: DatabaseTable): number {
  const titleLines = wrapSvgText(table.name, 22);
  const descriptionLines = wrapSvgText(table.description ?? '', 28);
  const titleHeight = Math.max(1, titleLines.length) * 13;
  const descriptionHeight = descriptionLines.length ? descriptionLines.length * 12 + 2 : 0;
  return Math.max(58, 16 + titleHeight + descriptionHeight + 10);
}

function wrapSvgText(value: string, maxChars: number): string[] {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return [];
  }

  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function edgeAnchor(source: LayoutTable, target: LayoutTable): { x: number; y: number } {
  const sourceCenterX = source.x + source.width / 2;
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterX = target.x + target.width / 2;
  const targetCenterY = target.y + target.height / 2;

  if (Math.abs(sourceCenterX - targetCenterX) >= Math.abs(sourceCenterY - targetCenterY)) {
    return sourceCenterX <= targetCenterX
      ? { x: source.x + source.width, y: sourceCenterY }
      : { x: source.x, y: sourceCenterY };
  }

  return sourceCenterY <= targetCenterY
    ? { x: sourceCenterX, y: source.y + source.height }
    : { x: sourceCenterX, y: source.y };
}

function buildFallbackDatabaseSchema(insights: ReturnType<typeof deriveInsights>): Array<{ name: string; description?: string; columns: Array<{ name: string; type?: string; detail?: string }> }> {
  const tables = unique(
    [
      ...insights.persistence,
      ...insights.relationships.filter((item) => /persist|repository|database|table|entity/i.test(item)),
    ].map((item) => item.replace(/^(.*?)(?:\s+to\s+.*)?$/i, '$1')),
  );

  return tables.map((name) => ({
    name,
    description: /repository|persistence|database|table|entity/i.test(name) ? 'Persistence model element' : 'Potential schema element',
    columns: [
      { name: 'id', type: 'identifier', detail: 'Stable identifier used by the model' },
      { name: 'created_at', type: 'timestamp', detail: 'Creation timestamp' },
      { name: 'updated_at', type: 'timestamp', detail: 'Last update timestamp' },
    ],
  }));
}

function extractDatabaseSchema(graph: CanonicalGraph): DiagramClassification['databaseSchema'] | undefined {
  const metadataSchema = graph.metadata?.databaseSchema;
  if (metadataSchema?.tables?.length) {
    return metadataSchema;
  }

  const review = graph.metadata?.review;
  if (!review || typeof review !== 'object') {
    return undefined;
  }

  const diagramClassification = (review as { diagramClassification?: DiagramClassification }).diagramClassification;
  const schema = diagramClassification?.databaseSchema;
  if (!schema || !Array.isArray(schema.tables) || schema.tables.length === 0) {
    return undefined;
  }

  return schema;
}

function extractArtifactSummary(graph: CanonicalGraph): {
  semanticView: string;
  semanticMeta: string;
  validationView: string;
  validationMeta: string;
  reviewView: string;
  reviewMeta: string;
  graphView: string;
  graphMeta: string;
} {
  const sourcePath = graph.metadata?.sourcePath ?? 'semantic source';
  const reviewedAt = graph.metadata?.reviewedAt;
  const review = graph.metadata?.review;
  const validationStatus = review?.issues?.length
    ? `${review.issues.length} review issue(s)`
    : 'validated/reviewed';
  return {
    semanticView: pathBaseName(sourcePath),
    semanticMeta: sourcePath,
    validationView: review?.reviewArtifactPath ? 'validation report' : 'validation output',
    validationMeta: validationStatus,
    reviewView: review?.reviewArtifactPath ? pathBaseName(review.reviewArtifactPath) : 'review artifact',
    reviewMeta: review?.summary ?? 'AI reviewed graph',
    graphView: reviewedAt ? 'reviewed graph' : 'graph snapshot',
    graphMeta: reviewedAt ? `reviewed at ${reviewedAt}` : 'current graph snapshot',
  };
}

function pathBaseName(value: string): string {
  return value.split(/[/\\]/).pop() ?? value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function deriveInsights(graph: CanonicalGraph): {
  preview?: PreviewMetadata;
  applications: string[];
  api: string[];
  app: string[];
  common: string[];
  commonEvents: string[];
  persistenceDetails: string[];
  serviceDetails: string[];
  serviceSummaries: string[];
  serviceExceptions: string[];
  securityDetails: string[];
  externalDependencies: string[];
  interfaces: string[];
  modules: string[];
  services: string[];
  persistence: string[];
  security: string[];
  relationships: string[];
  flowScenarios: Array<{ title: string; summary: string; steps: string[] }>;
  flowTrace: string[];
} {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const preview = graph.metadata?.preview;
  const interfaceItems = unique(
    graph.nodes
      .filter((node) => node.type === 'Interface')
      .map((node) => node.name),
  );
  const externalDependencies = unique([
    ...graph.nodes
      .filter((node) => ['ExternalSystem', 'IntegrationEndpoint', 'Dependency'].includes(node.type))
      .map((node) => normalizeExternalDependency(node.name))
      .filter(Boolean) as string[],
    ...interfaceItems
      .filter((item) => /^APP:\s*external dependencies\s*—/i.test(item))
      .flatMap((item) => item.replace(/^APP:\s*external dependencies\s*—/i, '').split('|'))
      .map((item) => normalizeExternalDependency(item))
      .filter(Boolean) as string[],
  ]);

  const interfaces = interfaceItems;
  const applications = unique(preview?.applications ?? interfaces.filter((item) => /^APPLICATION:/i.test(item)));
  const api = unique(preview?.api ?? interfaces.filter((item) => /^API:/i.test(item) || /contract source:|swagger \/ OpenAPI|API clients:|API enums:/i.test(item)));
  const app = unique(preview?.app ?? interfaces.filter((item) => /^APP:/i.test(item)));
  const common = unique(preview?.common ?? interfaces.filter((item) => /^COMMON:/i.test(item)));
  const commonEvents = unique(
    preview?.events
      ? [
          ...(preview.events.types ?? []),
          ...((preview.events.producers ?? []).map((item) => `producer: ${item}`)),
        ]
      : interfaces.filter((item) => /^EVENTS:/i.test(item)),
  );
  const persistenceDetailItems = unique(
    preview?.persistence
      ? [
          ...(preview.persistence.repositories ?? []),
          ...(preview.persistence.mappers ?? []),
          ...(preview.persistence.entities ?? []).map((item) => `entity: ${item}`),
        ]
      : interfaces.filter((item) => /^PERSISTENCE:/i.test(item)),
  );
  const serviceDetailItems = unique(preview?.service?.details ?? interfaces.filter((item) => /^SERVICE:/i.test(item)));
  const serviceSummaryItems = unique(preview?.service?.catalog ?? interfaces.filter((item) => /^SERVICE_SUMMARY:/i.test(item)));
  const serviceFlowPrepItems = unique(preview?.service?.violations ?? interfaces.filter((item) => /^SERVICE_FLOW_PREP:/i.test(item)));
  const serviceExceptionItems = unique(preview?.service?.exceptions ?? interfaces.filter((item) => /^SERVICE_EXCEPTIONS:/i.test(item)));
  const securityDetailItems = unique([
    ...(preview?.security ?? interfaces.filter((item) => /^SECURITY:/i.test(item))),
    ...graph.nodes.filter((node) => node.type === 'Rule').map((node) => node.name),
  ]);
  const ingressInterfaces = unique(
    preview?.web
      ? [
          ...(preview.web.ingress ?? []),
          ...(preview.web.validation ?? []).map((item) => `validation: ${item}`),
          ...(preview.web.errorHandling ?? []).map((item) => `error handling: ${item}`),
          ...(preview.web.configuration ?? []).map((item) => `configuration: ${item}`),
          ...(preview.web.securityBoundary ?? []).map((item) => `security boundary: ${item}`),
        ]
      : interfaces.filter((item) => !applications.includes(item) && !api.includes(item) && !app.includes(item) && !common.includes(item) && !commonEvents.includes(item) && !persistenceDetailItems.includes(item) && !serviceDetailItems.includes(item) && !serviceExceptionItems.includes(item) && !securityDetailItems.includes(item)),
  );

  const modules = unique(
    graph.nodes
      .filter((node) => node.type === 'Module')
      .map((node) => node.name),
  );

  const services = unique([
    ...serviceSummaryItems.map((item) => item.replace(/^SERVICE_SUMMARY:\s*/i, '').split(' — ')[0]?.trim()).filter(Boolean),
    ...graph.nodes.filter((node) => ['SystemSlice', 'Service'].includes(node.type)).map((node) => node.name),
    ...graph.nodes.filter((node) => node.type === 'Process').map((node) => node.name),
  ]);

  const persistence = unique(
    [
      ...persistenceDetailItems.map((item) => item.replace(/^PERSISTENCE:\s*/i, '')),
      ...graph.nodes
      .filter((node) => node.type === 'Persistence' || /persistence|database|storage|repository|file|postgres|oracle|sql/i.test(node.name) || /persistence|database|storage|repository|file|postgres|oracle|sql/i.test(node.description ?? ''))
      .map((node) => node.name),
    ],
  );

  const security = unique([
    ...graph.nodes.filter((node) => node.type === 'SecurityPolicy').map((node) => node.name || 'Security policy'),
    ...graph.nodes.filter((node) => node.type === 'Rule').map((node) => node.name),
  ]);

  const relationships = unique(
    graph.edges.flatMap((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) {
        return [];
      }

      if (from.type === 'Interface' && to.type === 'Service') {
        return [`${from.name} enters ${to.name}`];
      }
      if (from.type === 'SecurityPolicy' && to.type === 'Service') {
        return [`${from.name} guards ${to.name}`];
      }
      if (from.type === 'Service' && to.type === 'ExternalSystem') {
        return [`${from.name} calls ${to.name}`];
      }
      if (from.type === 'Service' && to.type === 'Persistence') {
        return [`${from.name} persists to ${to.name}`];
      }
      if (from.type === 'Process' && to.type === 'Persistence') {
        return [`${from.name} writes to ${to.name}`];
      }
      if (from.type === 'Example' && to.type === 'Process') {
        return [`${from.name} illustrates ${to.name}`];
      }
      if (from.type === 'AcceptanceCriterion' && to.type === 'SystemSlice') {
        return [`${from.name} validates ${to.name}`];
      }
      if (from.type === 'DataFlow' && to.type === 'Process') {
        return [`${from.name} flows into ${to.name}`];
      }
      return [];
    }),
  );

  const flowTexts = [
    ...graph.nodes.filter((node) => node.type === 'DataFlow').map((node) => node.description || node.name),
    ...graph.nodes.filter((node) => node.type === 'Process').map((node) => node.description || node.name),
  ].filter(Boolean) as string[];
  const flowScenarios = buildFlowScenarios(flowTexts);
  const flowTrace = expandFlowTrace(flowScenarios.flatMap((scenario) => scenario.steps));

  return {
    preview,
    applications,
    api,
    app,
    common,
    commonEvents,
    persistenceDetails: persistenceDetailItems,
    serviceDetails: [...serviceDetailItems, ...serviceFlowPrepItems],
    serviceSummaries: serviceSummaryItems,
    serviceExceptions: serviceExceptionItems,
    securityDetails: securityDetailItems,
    externalDependencies,
    interfaces: ingressInterfaces,
    modules,
    services,
    persistence,
    security,
    relationships,
    flowScenarios,
    flowTrace,
  };
}

function normalizeExternalDependency(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (/redis/i.test(text)) return 'Redis';
  if (/mail/i.test(text)) return 'Mail service';
  if (/minio|object storage|s3/i.test(text)) return 'MinIO / object storage';
  if (/oauth|oidc|external identity|auth provider/i.test(text)) return 'External auth providers';
  if (/websocket/i.test(text)) return 'WebSocket';
  if (/external http client|http client|rest client/i.test(text)) return 'External HTTP client';
  if (/kafka|rabbit|mqtt|nsq/.test(text)) return 'Message broker / event stream';
  return undefined;
}

function buildFlowScenarios(flowTexts: string[]): Array<{ title: string; summary: string; steps: string[] }> {
  const uniqueTexts = unique(flowTexts.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean));
  if (uniqueTexts.length === 0) {
    return [
      {
        title: 'No explicit flow',
        summary: 'No explicit data flow or process narrative was described in the semantic source.',
        steps: ['Add more data_flow and process detail to expose multiple execution paths.'],
      },
    ];
  }

  return uniqueTexts.slice(0, 6).map((text, index) => {
    const steps = splitFlowText(text);
    const title = classifyFlowScenarioTitle(text, index);
    const summary = steps.length > 0 ? steps[0] : text;
    return { title, summary, steps };
  });
}

function classifyFlowScenarioTitle(value: string, index: number): string {
  const normalized = value.toLowerCase();
  if (/create|add|new/i.test(normalized)) return `Create flow ${index + 1}`;
  if (/update|edit|modify/i.test(normalized)) return `Update flow ${index + 1}`;
  if (/delete|remove|archive/i.test(normalized)) return `Delete flow ${index + 1}`;
  if (/search|list|query|read/i.test(normalized)) return `Read/search flow ${index + 1}`;
  if (/auth|login|permission|role|authorize/i.test(normalized)) return `Security flow ${index + 1}`;
  if (/import|sync|batch|job/i.test(normalized)) return `Batch flow ${index + 1}`;
  return `Flow ${index + 1}`;
}

function splitFlowText(value: string): string[] {
  return value
    .split(/(?:\.\s+|;\s+|\n+)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function expandFlowTrace(parts: string[]): string[] {
  if (parts.length === 0) {
    return ['No explicit flow steps were described.'];
  }

  const normalized = parts
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const expanded: string[] = [];
  for (const step of normalized) {
    if (/auth|authoriz|permission|role/i.test(step)) {
      expanded.push(`Security gate: ${step}`);
      continue;
    }
    if (/fetch|lookup|call|request|query|invoke/i.test(step)) {
      expanded.push(`External call: ${step}`);
      continue;
    }
    if (/persist|save|store|write|record|database/i.test(step)) {
      expanded.push(`Persistence: ${step}`);
      continue;
    }
    if (/error|fail|reject|invalid/i.test(step)) {
      expanded.push(`Failure path: ${step}`);
      continue;
    }
    expanded.push(step);
  }

  return unique(expanded);
}

function renderList(items: string[]): string {
  if (items.length === 0) {
    return '<span class="insight-pill">none detected</span>';
  }

  return items.map((item) => `<span class="insight-pill">${escapeHtml(item)}</span>`).join('');
}

function renderFlowScenarios(items: Array<{ title: string; summary: string; steps: string[] }>): string {
  return items
    .map(
      (scenario, index) => `
        <div class="flow-card">
          <div class="flow-card-header">
            <div class="flow-card-title">${escapeHtml(scenario.title)}</div>
            <div class="flow-card-subtitle">Flow ${index + 1} · ${scenario.steps.length} step${scenario.steps.length === 1 ? '' : 's'}</div>
          </div>
          <div class="flow-card-subtitle">${escapeHtml(scenario.summary)}</div>
          <div class="flow-card-steps">
            ${scenario.steps
              .slice(0, 8)
              .map((step, stepIndex) => `<div class="flow-step"><code>${stepIndex + 1}</code><div>${escapeHtml(step)}</div></div>`)
              .join('')}
          </div>
        </div>
      `,
    )
    .join('');
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}
