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

interface DiagramItem {
  name: string;
  detail?: string;
  sourceRef?: string;
}

interface DiagramLayer {
  title: string;
  description?: string;
  accent?: string;
  items: DiagramItem[];
}

interface DiagramClassification {
  title?: string;
  summary?: string;
  layers: DiagramLayer[];
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
  };
};

type Region = 'center' | 'north' | 'west' | 'east' | 'south';

interface LayoutNode extends GraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
  region: Region;
  fill: string;
  accent: string;
}

interface LayoutEdge {
  from: LayoutNode;
  to: LayoutNode;
  type: string;
  labelX: number;
  labelY: number;
  path: string;
  color: string;
}

const TYPE_ORDER = [
  'SystemSlice',
  'Module',
  'Service',
  'SecurityPolicy',
  'Rule',
  'Interface',
  'IntegrationEndpoint',
  'ExternalSystem',
  'Dependency',
  'Persistence',
  'Process',
  'Transformation',
  'DataFlow',
  'Monitor',
  'Metric',
  'Alert',
  'Example',
  'AcceptanceCriterion',
];

const REGION_TITLES: Record<Region, string> = {
  center: 'System',
  north: 'Rules and security',
  west: 'Entry points and dependencies',
  east: 'Processing and runtime',
  south: 'Examples and acceptance',
};

const TYPE_COLORS: Record<string, string> = {
  SystemSlice: '#7c3aed',
  Module: '#a855f7',
  Service: '#2563eb',
  SecurityPolicy: '#ef4444',
  Rule: '#f97316',
  Interface: '#0ea5e9',
  IntegrationEndpoint: '#14b8a6',
  ExternalSystem: '#06b6d4',
  Dependency: '#8b5cf6',
  Persistence: '#0891b2',
  Process: '#22c55e',
  Transformation: '#16a34a',
  DataFlow: '#0f766e',
  Monitor: '#eab308',
  Metric: '#fb923c',
  Alert: '#f43f5e',
  Example: '#64748b',
  AcceptanceCriterion: '#334155',
};

export class GraphPreviewPanel {
  private static currentPanel: GraphPreviewPanel | undefined;

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
    const cspSource = this.panel.webview.cspSource;
    const nonce = createNonce();
    const insights = deriveInsights(this.graph);
    const diagramClassification = extractDiagramClassification(this.graph);
    const artifacts = extractArtifactSummary(this.graph);
    const graphJson = escapeHtml(JSON.stringify(this.graph, null, 2));
    const summary = `nodes=${this.graph.nodes.length}, edges=${this.graph.edges.length}`;
    const applicationDiagram = renderApplicationDiagram(insights, diagramClassification);

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
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 12px 0 14px;
      }
      .application-diagram {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 16px;
        background: var(--vscode-sideBar-background);
        padding: 14px;
        margin-bottom: 14px;
      }
      .application-diagram-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        margin-bottom: 10px;
      }
      .application-diagram-title {
        font-size: 14px;
        font-weight: 800;
      }
      .application-diagram-subtitle {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
      .application-diagram-grid {
        display: grid;
        grid-template-columns: minmax(180px, 1fr) 28px minmax(180px, 1fr) 28px minmax(180px, 1fr) 28px minmax(180px, 1fr);
        gap: 10px;
        align-items: stretch;
      }
      .application-layer {
        border-radius: 14px;
        padding: 12px;
        border: 1px solid var(--vscode-panel-border);
        background: var(--vscode-editor-background);
        min-height: 340px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .application-layer.highlight {
        background: linear-gradient(180deg, var(--vscode-editor-background), var(--vscode-editor-inactiveSelectionBackground));
      }
      .application-layer-title {
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--vscode-descriptionForeground);
      }
      .application-layer-subtitle {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.35;
      }
      .application-layer-items {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1 1 auto;
      }
      .application-layer-item {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        background: var(--vscode-sideBar-background);
        padding: 10px 12px;
        display: grid;
        gap: 4px;
      }
      .application-layer-item-title {
        font-size: 12px;
        font-weight: 800;
        line-height: 1.25;
      }
      .application-layer-item-meta {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.35;
      }
      .application-layer-divider {
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--vscode-descriptionForeground);
        font-size: 20px;
        font-weight: 700;
      }
      .drawio-board {
        display: grid;
        gap: 12px;
      }
      .drawio-stage-row {
        display: flex;
        gap: 12px;
        align-items: stretch;
        overflow-x: auto;
        padding-bottom: 2px;
      }
      .drawio-stage {
        flex: 1 1 0;
        min-width: 180px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 14px;
        background: linear-gradient(180deg, var(--vscode-editor-background), var(--vscode-sideBar-background));
        padding: 12px;
        display: grid;
        gap: 6px;
      }
      .drawio-stage-title {
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .drawio-stage-desc {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.35;
      }
      .drawio-stage-arrow {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        color: var(--vscode-descriptionForeground);
        font-weight: 700;
      }
      .drawio-swimlanes {
        display: grid;
        grid-template-columns: repeat(4, minmax(220px, 1fr));
        gap: 12px;
        align-items: stretch;
      }
      .drawio-lane {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 16px;
        background: var(--vscode-editor-background);
        display: grid;
        grid-template-rows: auto 1fr;
        overflow: hidden;
        min-height: 360px;
      }
      .drawio-lane-header {
        border-bottom: 1px solid var(--vscode-panel-border);
        padding: 12px 12px 10px;
        background: linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 94%, transparent), var(--vscode-sideBar-background));
      }
      .drawio-lane-title {
        font-size: 13px;
        font-weight: 800;
      }
      .drawio-lane-desc {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.35;
        margin-top: 4px;
      }
      .drawio-lane-body {
        padding: 12px;
        display: grid;
        gap: 10px;
        align-content: start;
      }
      .drawio-box {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        background: linear-gradient(180deg, var(--vscode-sideBar-background), var(--vscode-editor-background));
        padding: 10px 12px;
        display: grid;
        gap: 4px;
        box-shadow: inset 0 -3px 0 color-mix(in srgb, var(--box-accent) 22%, transparent);
      }
      .drawio-box-title {
        font-size: 12px;
        font-weight: 800;
        line-height: 1.25;
      }
      .drawio-box-detail {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.35;
      }
      .drawio-box-tag {
        display: inline-flex;
        align-self: start;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 800;
        color: var(--vscode-editor-background);
        background: var(--box-accent);
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
      .application-diagram-empty {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        line-height: 1.35;
      }
      .legend-group {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-right: 10px;
      }
      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 999px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        font-size: 12px;
      }
      .swatch {
        width: 10px;
        height: 10px;
        border-radius: 999px;
      }
      .canvas {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        background: var(--vscode-editor-background);
        overflow: auto;
        padding: 8px;
      }
      .schematic {
        display: grid;
        gap: 14px;
        min-width: 1180px;
      }
      .schematic-topbar {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .schematic-rail {
        display: grid;
        grid-template-columns: repeat(4, minmax(220px, 1fr));
        gap: 12px;
        align-items: stretch;
      }
      .schematic-column {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 16px;
        background: var(--vscode-sideBar-background);
        padding: 12px;
        min-height: 150px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .schematic-top-note {
        min-height: 92px;
      }
      .schematic-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }
      .schematic-title {
        font-size: 13px;
        font-weight: 800;
      }
      .schematic-subtitle {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.35;
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
      .schematic-arrow-row {
        display: grid;
        grid-template-columns: repeat(7, auto);
        justify-content: center;
        align-items: center;
        gap: 10px;
        color: var(--vscode-descriptionForeground);
        font-size: 22px;
        line-height: 1;
        margin-top: -4px;
      }
      .schematic-arrow-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--vscode-descriptionForeground);
        text-align: center;
      }
      .schematic-footer {
        display: grid;
        grid-template-columns: 1.15fr 0.85fr;
        gap: 12px;
      }
      .schematic-note {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 14px;
        background: var(--vscode-sideBar-background);
        padding: 12px;
      }
      .schematic-note-title {
        font-weight: 800;
        margin-bottom: 8px;
      }
      .schematic-relations {
        display: grid;
        gap: 8px;
      }
      .schematic-relation {
        display: flex;
        gap: 8px;
        align-items: baseline;
        line-height: 1.35;
      }
      .schematic-relation code {
        flex: 0 0 auto;
        font-size: 11px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        padding: 2px 6px;
        border-radius: 999px;
      }
      .schematic-flow-summary {
        display: grid;
        gap: 8px;
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
      .timeline-card {
        min-width: 180px;
        flex: 1 0 180px;
        border-radius: 12px;
        padding: 10px 12px;
        border: 1px solid var(--vscode-panel-border);
        background: var(--vscode-editor-background);
        box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
      }
      .timeline-step {
        font-size: 11px;
        font-weight: 800;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 6px;
      }
      .timeline-title {
        font-size: 14px;
        font-weight: 700;
        margin-bottom: 6px;
      }
      .timeline-text {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.45;
      }
      .timeline-arrow {
        align-self: center;
        font-size: 20px;
        color: var(--vscode-descriptionForeground);
        padding: 0 2px;
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
      .node-box {
        stroke: var(--vscode-panel-border);
        stroke-width: 1.2;
      }
      .node-label {
        fill: var(--vscode-foreground);
        font-size: 12px;
        font-weight: 600;
      }
      .node-type {
        fill: var(--vscode-descriptionForeground);
        font-size: 10px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .edge {
        fill: none;
        stroke-width: 1.7;
        opacity: 0.75;
      }
      .edge-label {
        fill: var(--vscode-descriptionForeground);
        font-size: 10px;
        font-weight: 600;
        paint-order: stroke;
        stroke: var(--vscode-editor-background);
        stroke-width: 3px;
      }
      .region-title {
        fill: var(--vscode-descriptionForeground);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="title">${escapeHtml(this.title || 'Graph Preview')}</div>
      <div class="subtitle">Read it as a system map plus execution path: ingress, security, service, external call, persistence, and outcome.</div>
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
      1) identify the incoming interface, 2) confirm the security gate, 3) follow the service path, 4) check external calls, 5) verify persistence, 6) read the outcome.
    </div>

    ${applicationDiagram}

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

function createNonce(): string {
  return Math.random().toString(36).slice(2);
}

function layoutRelationGraph(graph: CanonicalGraph): {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  regionLegend: Array<{ label: string; color: string }>;
  edgeLegend: Array<{ label: string; color: string }>;
} {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const systemNode = graph.nodes.find((node) => node.type === 'SystemSlice') ?? graph.nodes[0];

  const grouped = new Map<Region, GraphNode[]>();
  for (const region of ['north', 'west', 'east', 'south'] as const) {
    grouped.set(region, []);
  }

  for (const node of graph.nodes) {
    if (node.id === systemNode?.id) continue;
    grouped.get(regionForType(node.type))?.push(node);
  }

  const width = 1600;
  const height = 1080;
  const centerX = width / 2;
  const centerY = height / 2 + 20;

  const layoutNodes: LayoutNode[] = [];
  const regionLegend = Object.entries(REGION_TITLES).map(([region, label]) => ({
    label,
    color: regionColor(region as Region),
  }));
  const edgeLegend = [
    { label: 'contains', color: edgeColor('contains') },
    { label: 'uses', color: edgeColor('uses') },
    { label: 'flowsTo', color: edgeColor('flowsTo') },
    { label: 'dependsOn', color: edgeColor('dependsOn') },
    { label: 'requires', color: edgeColor('requires') },
    { label: 'supports', color: edgeColor('supports') },
  ];

  if (systemNode) {
    layoutNodes.push({
      ...systemNode,
      x: centerX - 165,
      y: centerY - 82,
      width: 330,
      height: 164,
      region: 'center',
      fill: '#ede9fe',
      accent: TYPE_COLORS[systemNode.type] ?? '#7c3aed',
    });
  }

  positionGroup(layoutNodes, grouped.get('north') ?? [], {
    region: 'north',
    baseX: 240,
    baseY: 64,
    spacingX: 250,
    spacingY: 98,
    columns: 4,
  });
  positionGroup(layoutNodes, grouped.get('west') ?? [], {
    region: 'west',
    baseX: 68,
    baseY: 250,
    spacingX: 0,
    spacingY: 110,
    columns: 1,
  });
  positionGroup(layoutNodes, grouped.get('east') ?? [], {
    region: 'east',
    baseX: 1288,
    baseY: 250,
    spacingX: 0,
    spacingY: 110,
    columns: 1,
  });
  positionGroup(layoutNodes, grouped.get('south') ?? [], {
    region: 'south',
    baseX: 240,
    baseY: 896,
    spacingX: 250,
    spacingY: 98,
    columns: 4,
  });

  const byId = new Map(layoutNodes.map((node) => [node.id, node] as const));
  const edges = graph.edges
    .map((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) {
        return undefined;
      }
      const path = buildEdgePath(from, to);
      const [labelX, labelY] = midpoint(from, to);
      return {
        from,
        to,
        type: edge.type,
        path,
        labelX,
        labelY,
        color: edgeColor(edge.type),
      };
    })
    .filter((edge): edge is LayoutEdge => Boolean(edge));

  return { nodes: layoutNodes, edges, width, height, regionLegend, edgeLegend };
}

function positionGroup(
  target: LayoutNode[],
  nodes: GraphNode[],
  config: { region: Region; baseX: number; baseY: number; spacingX: number; spacingY: number; columns: number },
): void {
  const sorted = [...nodes].sort((left, right) => {
    const leftOrder = TYPE_ORDER.indexOf(left.type);
    const rightOrder = TYPE_ORDER.indexOf(right.type);
    return (leftOrder === -1 ? 999 : leftOrder) - (rightOrder === -1 ? 999 : rightOrder) || left.name.localeCompare(right.name);
  });

  sorted.forEach((node, index) => {
    const column = config.columns > 1 ? index % config.columns : 0;
    const row = config.columns > 1 ? Math.floor(index / config.columns) : index;
    const width = config.region === 'north' || config.region === 'south' ? 220 : 238;
    const wrapped = wrapText(node.name, 23);
    const height = Math.max(72, 34 + wrapped.length * 16);
    const x =
      config.region === 'north' || config.region === 'south'
        ? config.baseX + column * config.spacingX
        : config.baseX;
    const y =
      config.region === 'north' || config.region === 'south'
        ? config.baseY
        : config.baseY + row * config.spacingY;

    target.push({
      ...node,
      x,
      y,
      width,
      height,
      region: config.region,
      fill: regionFill(config.region),
      accent: TYPE_COLORS[node.type] ?? '#64748b',
    });
  });
}

function renderSvg(layout: ReturnType<typeof layoutRelationGraph>): string {
  const countByRegion = layout.nodes.reduce<Record<Region, number>>(
    (accumulator, node) => {
      accumulator[node.region] = (accumulator[node.region] ?? 0) + 1;
      return accumulator;
    },
    { center: 0, north: 0, west: 0, east: 0, south: 0 },
  );

  const nodeLabels = layout.nodes
    .map((node) => {
      const lines = wrapText(node.name, 24);
      const textY = node.y + 30;
      return `
        <g transform="translate(${node.x}, ${node.y})">
          <rect class="node-box" rx="16" ry="16" width="${node.width}" height="${node.height}" fill="${node.fill}22" />
          <rect x="0.5" y="0.5" rx="16" ry="16" width="${node.width - 1}" height="${node.height - 1}" fill="transparent" class="node-box" />
          <rect x="0" y="0" rx="16" ry="16" width="8" height="${node.height}" fill="${node.accent}" opacity="0.9" />
          <text x="16" y="18" class="node-type">${escapeHtml(node.type)}</text>
          ${lines
            .map((line, index) => `<text x="16" y="${textY + index * 16}" class="node-label">${escapeHtml(line)}</text>`)
            .join('')}
          <title>${escapeHtml(`${node.type}: ${node.name}${node.description ? `\n${node.description}` : ''}${node.sourceRef ? `\n${node.sourceRef}` : ''}`)}</title>
        </g>
      `;
    })
    .join('');

  const regionPanels = [
    regionPanel('north', 50, 18, 1500, 210, `Rules and security · ${countByRegion.north}`),
    regionPanel('west', 18, 220, 440, 700, `Ingress and dependencies · ${countByRegion.west}`),
    regionPanel('east', 1140, 220, 442, 700, `Service and runtime · ${countByRegion.east}`),
    regionPanel('south', 50, 850, 1500, 200, `Examples and acceptance · ${countByRegion.south}`),
    regionPanel('center', 500, 250, 600, 460, `System core · ${countByRegion.center}`),
  ].join('');

  const regionTitles = [
    regionTitle('north', 800, 46),
    regionTitle('west', 238, 244),
    regionTitle('east', 1360, 244),
    regionTitle('south', 800, 876),
    regionTitle('center', 800, 418),
  ].join('');

  const edges = layout.edges
    .map((edge) => {
      const label = edge.type.replace(/([a-z])([A-Z])/g, '$1 $2');
      return `
        <g>
          <path class="edge" d="${edge.path}" stroke="${edge.color}" marker-end="url(#arrow-${edge.color.replace('#', '')})" />
          <text class="edge-label" x="${edge.labelX}" y="${edge.labelY - 4}" text-anchor="middle">${escapeHtml(label)}</text>
        </g>
      `;
    })
    .join('');

  const markers = [...new Set(layout.edges.map((edge) => edge.color))]
    .map((color) => {
      const id = `arrow-${color.replace('#', '')}`;
      return `
        <marker id="${id}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="${color}" />
        </marker>
      `;
    })
    .join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">
      <defs>${markers}</defs>
      ${regionPanels}
      ${regionTitles}
      ${edges}
      ${nodeLabels}
    </svg>
  `;
}

function renderSchematic(insights: ReturnType<typeof deriveInsights>): string {
  const layers = [
    {
      title: 'Data Access Layer',
      subtitle: 'Repositories, databases, stores, and durable state.',
      items: insights.persistence,
      accent: '#0ea5e9',
      empty: 'No persistence boundary found.',
    },
    {
      title: 'Business Logic',
      subtitle: 'Services, modules, rules, and orchestration.',
      items: [...insights.services, ...insights.modules, ...insights.security].filter(Boolean),
      accent: '#22c55e',
      empty: 'No service or module boundary found.',
    },
    {
      title: 'Flow Logic',
      subtitle: 'Processes, transformations, and execution steps.',
      items: [...insights.flowTrace],
      accent: '#8b5cf6',
      empty: 'No flow trace found.',
    },
    {
      title: 'Presentation Logic',
      subtitle: 'REST, UI, inbound endpoints, and entry points.',
      items: insights.interfaces,
      accent: '#f59e0b',
      empty: 'No inbound interface found.',
    },
  ];

  const layerCards = layers
    .map(
      (layer) => `
        <div class="schematic-column" style="box-shadow: inset 0 0 0 1px ${layer.accent}22;">
          <div class="schematic-header">
            <div class="schematic-title">${escapeHtml(layer.title)}</div>
            <span class="schematic-pill" style="border: 1px solid ${layer.accent}55;">
              <strong>${layer.items.length}</strong>
            </span>
          </div>
          <div class="schematic-subtitle">${escapeHtml(layer.subtitle)}</div>
          <div class="schematic-items">
            ${
              layer.items.length > 0
                ? layer.items.slice(0, 6).map((item) => `<span class="schematic-pill">${escapeHtml(item)}</span>`).join('')
                : `<span class="schematic-pill">${escapeHtml(layer.empty)}</span>`
            }
            ${
              layer.items.length > 6
                ? `<span class="schematic-pill">+${layer.items.length - 6} more</span>`
                : ''
            }
          </div>
        </div>
      `,
    )
    .join('');

  const flowSketch = insights.flowScenarios.slice(0, 3);

  const flowRail = flowSketch
    .map(
      (flow) => `
        <div class="schematic-note">
          <div class="schematic-note-title">${escapeHtml(flow.title)}</div>
          <div class="schematic-subtitle">${escapeHtml(flow.summary)}</div>
        </div>
      `,
    )
    .join('<div style="font-size:18px;color:var(--vscode-descriptionForeground);align-self:center;">→</div>');

  const relations = insights.relationships.slice(0, 5);
  const relationList =
    relations.length > 0
      ? relations
          .map(
            (relation) => `
              <div class="schematic-relation">
                <code>relation</code>
                <div>${escapeHtml(relation)}</div>
              </div>
            `,
          )
          .join('')
      : '<div class="schematic-subtitle">No explicit relations were inferred from the source slice.</div>';

  const flowTrace = insights.flowTrace.slice(0, 8);
  const traceList =
    flowTrace.length > 0
      ? flowTrace
          .map(
            (step, index) => `
              <div class="schematic-relation">
                <code>${index + 1}</code>
                <div>${escapeHtml(step)}</div>
              </div>
            `,
          )
          .join('')
      : '<div class="schematic-subtitle">No explicit flow trace was inferred from the source slice.</div>';

  return `
    <div class="schematic">
      <div class="schematic-topbar">
        <div class="schematic-note schematic-top-note">
          <div class="schematic-note-title">External dependencies</div>
          <div class="schematic-items">
            ${insights.externalDependencies.length > 0 ? insights.externalDependencies.slice(0, 5).map((item) => `<span class="schematic-pill">${escapeHtml(item)}</span>`).join('') : '<span class="schematic-pill">none detected</span>'}
          </div>
        </div>
        <div class="schematic-note schematic-top-note">
          <div class="schematic-note-title">Security gate</div>
          <div class="schematic-items">
            ${insights.security.length > 0 ? insights.security.slice(0, 5).map((item) => `<span class="schematic-pill">${escapeHtml(item)}</span>`).join('') : '<span class="schematic-pill">none detected</span>'}
          </div>
        </div>
      </div>
      <div class="schematic-arrow-row" aria-hidden="true">
        <span>◉</span><span>→</span><span>◉</span><span>→</span><span>◉</span><span>→</span><span>◉</span>
      </div>
      <div class="schematic-arrow-row" style="margin-top:-6px; grid-template-columns: repeat(4, auto);">
        <div class="schematic-arrow-label">Presentation</div>
        <div class="schematic-arrow-label">Business</div>
        <div class="schematic-arrow-label">Flow</div>
        <div class="schematic-arrow-label">Data access</div>
      </div>
      <div class="schematic-rail">${layerCards}</div>
      <div class="schematic-footer">
        <div class="schematic-note">
          <div class="schematic-note-title">Execution sketch</div>
          <div class="schematic-flow-summary">${flowRail}</div>
        </div>
        <div class="schematic-note">
          <div class="schematic-note-title">Key relations</div>
          <div class="schematic-relations">${relationList}</div>
          <div class="schematic-note-title" style="margin-top:12px;">Flow trace</div>
          <div class="schematic-relations">${traceList}</div>
        </div>
      </div>
    </div>
  `;
}

function renderApplicationDiagram(
  insights: ReturnType<typeof deriveInsights>,
  diagramClassification?: DiagramClassification,
): string {
  const integrationItems = insights.externalDependencies.filter((item) =>
    /websocket|redis|mail|kafka|queue|stream|object storage|http client|webhook|mqtt|rabbit|nsq|socket/i.test(item),
  );
  const persistenceItems = insights.persistence.filter((item) =>
    /postgres|mysql|oracle|database|sql|migration|flyway|liquibase|object storage|minio|s3|redis/i.test(item),
  );
  const fallbackLayers: DiagramLayer[] = [
    {
      title: 'Web / HTTP ingress',
      description: 'HTTP endpoints and inbound UI or API entry families.',
      accent: '#0ea5e9',
      items: [
        ...insights.interfaces.map((item) => ({ name: item, detail: 'HTTP / web ingress' })),
      ],
    },
    {
      title: 'Integration interfaces',
      description: 'WebSocket, Redis, Mail, messaging, and external client boundaries.',
      accent: '#f59e0b',
      items: [
        ...integrationItems.map((item) => ({ name: item, detail: 'External integration' })),
      ],
    },
    {
      title: 'Security',
      description: 'Authentication, authorization, and policy gates.',
      accent: '#ef4444',
      items: [
        ...insights.security.map((item) => ({ name: item, detail: 'Security guard' })),
      ],
    },
    {
      title: 'Services',
      description: 'Application services, processors, and orchestration components.',
      accent: '#8b5cf6',
      items: [
        ...insights.services.map((item) => ({ name: item, detail: 'Service / processor' })),
      ],
    },
    {
      title: 'Persistence / storage',
      description: 'Databases, tables, migrations, and durable stores.',
      accent: '#22c55e',
      items: [
        ...persistenceItems.map((item) => ({ name: item, detail: 'Persistence target' })),
      ],
    },
  ];

  const layers = diagramClassification?.layers?.length ? diagramClassification.layers : fallbackLayers;
  const colors = ['#0ea5e9', '#f59e0b', '#ef4444', '#22c55e', '#8b5cf6', '#14b8a6'];

  const renderLane = (layer: DiagramLayer, index: number): string => {
    const accent = layer.accent ?? colors[index % colors.length];
    const items = layer.items.length > 0
      ? layer.items
          .map(
            (item) => `
              <div class="drawio-box" style="--box-accent:${accent};">
                <div class="drawio-box-tag">${escapeHtml(layer.title)}</div>
                <div class="drawio-box-title">${escapeHtml(item.name)}</div>
                <div class="drawio-box-detail">${escapeHtml(item.detail || 'Component')}</div>
              </div>
            `,
          )
          .join('')
      : `
        <div class="drawio-box" style="--box-accent:${accent};">
          <div class="drawio-box-tag">${escapeHtml(layer.title)}</div>
          <div class="drawio-box-title">None detected</div>
          <div class="drawio-box-detail">No component inferred from the source slice.</div>
        </div>
      `;

    return `
      <div class="drawio-lane">
        <div class="drawio-lane-header">
          <div class="drawio-lane-title" style="color:${accent};">${escapeHtml(layer.title)}</div>
          <div class="drawio-lane-desc">${escapeHtml(layer.description || 'Architecture layer')}</div>
        </div>
        <div class="drawio-lane-body">
          ${items}
        </div>
      </div>
    `;
  };

  const stageRow = layers
    .map(
      (layer, index) => `
        <div class="drawio-stage" style="--box-accent:${layer.accent ?? colors[index % colors.length]}; border-top: 4px solid ${layer.accent ?? colors[index % colors.length]};">
          <div class="drawio-stage-title" style="color:${layer.accent ?? colors[index % colors.length]};">${escapeHtml(layer.title)}</div>
          <div class="drawio-stage-desc">${escapeHtml(layer.description || 'Architecture layer')}</div>
        </div>
      `,
    )
    .join('<div class="drawio-stage-arrow">→</div>');

  const topNotes = `
    <div class="drawio-notes">
      <div class="drawio-note">
        <div class="drawio-note-title">External dependencies</div>
        <div class="schematic-items">
          ${
            insights.externalDependencies.length > 0
              ? insights.externalDependencies.map((item) => `<span class="schematic-pill">${escapeHtml(item)}</span>`).join('')
              : '<span class="schematic-pill">none detected</span>'
          }
        </div>
      </div>
      <div class="drawio-note">
        <div class="drawio-note-title">Security gate</div>
        <div class="schematic-items">
          ${
            insights.security.length > 0
              ? insights.security.map((item) => `<span class="schematic-pill">${escapeHtml(item)}</span>`).join('')
              : '<span class="schematic-pill">none detected</span>'
          }
        </div>
      </div>
    </div>
  `;

  return `
    <div class="application-diagram">
      <div class="application-diagram-header">
        <div class="application-diagram-title">Software architecture</div>
        <div class="application-diagram-subtitle">
          ${
            diagramClassification?.summary
              ? escapeHtml(diagramClassification.summary)
              : 'Draw.io-style lane diagram with one box per detected component.'
          }
        </div>
      </div>
      ${topNotes}
      <div class="drawio-board">
        <div class="drawio-stage-row">${stageRow}</div>
        <div class="drawio-swimlanes" style="grid-template-columns: repeat(${layers.length}, minmax(220px, 1fr));">${layers.map(renderLane).join('')}</div>
      </div>
    </div>
  `;
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

function extractDiagramClassification(graph: CanonicalGraph): DiagramClassification | undefined {
  const review = graph.metadata?.review;
  if (!review || typeof review !== 'object') {
    return undefined;
  }

  const diagramClassification = (review as { diagramClassification?: DiagramClassification }).diagramClassification;
  if (!diagramClassification || !Array.isArray(diagramClassification.layers) || diagramClassification.layers.length === 0) {
    return undefined;
  }

  return diagramClassification;
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

function regionPanel(region: Region, x: number, y: number, width: number, height: number, label: string): string {
  return `
    <g>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" ry="22" fill="${regionFill(region)}" opacity="0.12" stroke="${regionColor(region)}" stroke-width="1.4" stroke-dasharray="8 6" />
      <text x="${x + 18}" y="${y + 24}" class="region-title">${escapeHtml(label)}</text>
    </g>
  `;
}

function regionTitle(region: Region, x: number, y: number): string {
  return `<text x="${x}" y="${y}" text-anchor="middle" class="region-title">${escapeHtml(REGION_TITLES[region])}</text>`;
}

function regionForType(type: string): Region {
  switch (type) {
    case 'SystemSlice':
      return 'center';
    case 'Module':
      return 'west';
    case 'Service':
      return 'east';
    case 'SecurityPolicy':
    case 'Rule':
      return 'north';
    case 'Interface':
    case 'IntegrationEndpoint':
    case 'ExternalSystem':
    case 'Dependency':
      return 'west';
    case 'Persistence':
    case 'Process':
    case 'Transformation':
    case 'DataFlow':
    case 'Monitor':
    case 'Metric':
    case 'Alert':
      return 'east';
    case 'Example':
    case 'AcceptanceCriterion':
      return 'south';
    default:
      return 'east';
  }
}

function regionFill(region: Region): string {
  switch (region) {
    case 'center':
      return '#ede9fe';
    case 'north':
      return '#fef3c7';
    case 'west':
      return '#e0f2fe';
    case 'east':
      return '#dcfce7';
    case 'south':
      return '#e2e8f0';
  }
}

function regionColor(region: Region): string {
  switch (region) {
    case 'center':
      return '#7c3aed';
    case 'north':
      return '#f59e0b';
    case 'west':
      return '#0ea5e9';
    case 'east':
      return '#22c55e';
    case 'south':
      return '#64748b';
  }
}

function edgeColor(type: string): string {
  switch (type) {
    case 'contains':
      return '#94a3b8';
    case 'uses':
      return '#0ea5e9';
    case 'exposes':
      return '#2563eb';
    case 'dependsOn':
      return '#8b5cf6';
    case 'flowsTo':
      return '#22c55e';
    case 'transformsInto':
      return '#16a34a';
    case 'writesTo':
      return '#f59e0b';
    case 'readsFrom':
      return '#14b8a6';
    case 'guardedBy':
      return '#ef4444';
    case 'requires':
      return '#e879f9';
    case 'supports':
      return '#64748b';
    case 'belongsTo':
      return '#64748b';
    case 'observes':
      return '#f97316';
    case 'emits':
      return '#fb7185';
    case 'triggers':
      return '#ea580c';
    case 'describes':
      return '#0f766e';
    case 'refines':
      return '#0f766e';
    default:
      return '#94a3b8';
  }
}

function buildEdgePath(from: LayoutNode, to: LayoutNode): string {
  const start = anchorPoint(from, to);
  const end = anchorPoint(to, from);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const bend = Math.max(80, Math.abs(dx) * 0.35, Math.abs(dy) * 0.35);
  const c1 = { x: start.x + Math.sign(dx) * bend, y: start.y };
  const c2 = { x: end.x - Math.sign(dx) * bend, y: end.y };
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}

function anchorPoint(node: LayoutNode, other: LayoutNode): { x: number; y: number } {
  const horizontal = other.x > node.x ? 1 : -1;
  const vertical = other.y > node.y ? 1 : -1;

  switch (node.region) {
    case 'center':
      return {
        x: node.x + node.width / 2 + horizontal * node.width / 2,
        y: node.y + node.height / 2 + vertical * 0,
      };
    case 'west':
      return {
        x: node.x + node.width,
        y: node.y + node.height / 2,
      };
    case 'east':
      return {
        x: node.x,
        y: node.y + node.height / 2,
      };
    case 'north':
      return {
        x: node.x + node.width / 2,
        y: node.y + node.height,
      };
    case 'south':
      return {
        x: node.x + node.width / 2,
        y: node.y,
      };
  }
}

function midpoint(from: LayoutNode, to: LayoutNode): [number, number] {
  return [from.x + from.width / 2 + (to.x - from.x) * 0.25, from.y + from.height / 2 + (to.y - from.y) * 0.25];
}

function wrapText(value: string, maxChars: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, 3);
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
  const externalDependencies = unique([
    ...graph.nodes
      .filter((node) => ['ExternalSystem', 'IntegrationEndpoint', 'Dependency'].includes(node.type))
      .map((node) => node.name),
  ]);

  const interfaces = unique(
    graph.nodes
      .filter((node) => node.type === 'Interface')
      .map((node) => node.name),
  );

  const modules = unique(
    graph.nodes
      .filter((node) => node.type === 'Module')
      .map((node) => node.name),
  );

  const services = unique([
    ...graph.nodes.filter((node) => ['SystemSlice', 'Service'].includes(node.type)).map((node) => node.name),
    ...graph.nodes.filter((node) => node.type === 'Process').map((node) => node.name),
  ]);

  const persistence = unique(
    graph.nodes
      .filter((node) => node.type === 'Persistence' || /persistence|database|storage|repository|file|postgres|oracle|sql/i.test(node.name) || /persistence|database|storage|repository|file|postgres|oracle|sql/i.test(node.description ?? ''))
      .map((node) => node.name),
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

  return { externalDependencies, interfaces, modules, services, persistence, security, relationships, flowScenarios, flowTrace };
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

function renderFlowSteps(items: string[]): string {
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
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

function renderTimeline(items: string[]): string {
  if (items.length === 0) {
    return `<div class="timeline-card"><div class="timeline-step">No flow</div><div class="timeline-title">No explicit execution path</div><div class="timeline-text">Add process and data flow detail to the semantic source to make the flow visible here.</div></div>`;
  }

  return items
    .slice(0, 8)
    .map((item, index) => {
      const phase = classifyTimelineStep(item);
      return `
        <div class="timeline-card">
          <div class="timeline-step">Step ${index + 1}</div>
          <div class="timeline-title">${escapeHtml(phase)}</div>
          <div class="timeline-text">${escapeHtml(item)}</div>
        </div>
      `;
    })
    .join('<div class="timeline-arrow">→</div>');
}

function classifyTimelineStep(value: string): string {
  if (/auth|authoriz|permission|role/i.test(value)) return 'Security gate';
  if (/validate|required|reject|invalid/i.test(value)) return 'Validation';
  if (/load|read|fetch|lookup|current state/i.test(value)) return 'State lookup';
  if (/audit|notification|external call|call|request|query|invoke/i.test(value)) return 'External dependency';
  if (/persist|save|store|write|record|database/i.test(value)) return 'Persistence';
  if (/return|response|result/i.test(value)) return 'Response';
  return 'Process step';
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}
