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

type CanonicalGraph = {
  schemaVersion?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata?: {
    title?: string;
    sourcePath?: string;
    createdAt?: string;
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
    const layout = layoutRelationGraph(this.graph);
    const svg = renderSvg(layout);
    const insights = deriveInsights(this.graph);
    const graphJson = escapeHtml(JSON.stringify(this.graph, null, 2));
    const summary = `nodes=${this.graph.nodes.length}, edges=${this.graph.edges.length}`;

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
      .overview {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 10px;
        margin: 14px 0 12px;
      }
      .overview-card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        padding: 10px 12px;
        background: var(--vscode-sideBar-background);
      }
      .overview-label {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 700;
      }
      .overview-value {
        font-size: 20px;
        font-weight: 800;
        margin-top: 4px;
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
      .flow-panel {
        margin-top: 14px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        padding: 12px;
        background: var(--vscode-sideBar-background);
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

    <div class="overview">
      <div class="overview-card"><div class="overview-label">External deps</div><div class="overview-value">${insights.externalDependencies.length}</div></div>
      <div class="overview-card"><div class="overview-label">Interfaces</div><div class="overview-value">${insights.interfaces.length}</div></div>
      <div class="overview-card"><div class="overview-label">Modules</div><div class="overview-value">${insights.modules.length}</div></div>
      <div class="overview-card"><div class="overview-label">Services</div><div class="overview-value">${insights.services.length}</div></div>
      <div class="overview-card"><div class="overview-label">Persistence</div><div class="overview-value">${insights.persistence.length}</div></div>
      <div class="overview-card"><div class="overview-label">Security</div><div class="overview-value">${insights.security.length}</div></div>
    </div>

    <div class="reading-order">
      <strong>Reading order:</strong>
      1) identify the incoming interface, 2) confirm the security gate, 3) follow the service path, 4) check external calls, 5) verify persistence, 6) read the outcome.
    </div>

    <div class="legend">
      <div class="legend-group">
        ${layout.regionLegend
          .map(
            (entry) =>
              `<span class="legend-item"><span class="swatch" style="background:${entry.color}"></span>${escapeHtml(entry.label)}</span>`,
          )
          .join('')}
      </div>
      <div class="legend-group">
        ${layout.edgeLegend
          .map(
            (entry) =>
              `<span class="legend-item"><span class="swatch" style="background:${entry.color}"></span>${escapeHtml(entry.label)}</span>`,
          )
          .join('')}
      </div>
    </div>

    <div class="canvas">
      ${svg}
    </div>

    <div class="flow-panel">
      <div class="panel-title">Execution path</div>
      <div class="timeline">
        ${renderTimeline(insights.flowTrace)}
      </div>
    </div>

    <div class="footer">
      <div class="panel">
        <div class="panel-title">What you should read from the graph</div>
        <div class="insight-group">
          <div class="insight-label">External dependencies</div>
          <div class="insight-list">${renderList(insights.externalDependencies)}</div>
        </div>
        <div class="insight-group">
          <div class="insight-label">Interfaces</div>
          <div class="insight-list">${renderList(insights.interfaces)}</div>
        </div>
        <div class="insight-group">
          <div class="insight-label">Services</div>
          <div class="insight-list">${renderList(insights.services)}</div>
        </div>
        <div class="insight-group">
          <div class="insight-label">Persistence</div>
          <div class="insight-list">${renderList(insights.persistence)}</div>
        </div>
        <div class="insight-group">
          <div class="insight-label">Security</div>
          <div class="insight-list">${renderList(insights.security)}</div>
        </div>
        <div class="insight-group">
          <div class="insight-label">Key relations</div>
          <div class="insight-list">${renderList(insights.relationships)}</div>
        </div>
        <div class="insight-group">
          <div class="insight-label">Flow trace</div>
          <ol class="flow-list">${renderFlowSteps(insights.flowTrace)}</ol>
        </div>
      </div>
      <div class="panel">
        <div class="panel-title">Graph snapshot</div>
        <details>
          <summary>Raw JSON</summary>
          <pre>${graphJson}</pre>
        </details>
      </div>
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

  const flowTrace = expandFlowTrace(
    graph.nodes
      .filter((node) => node.type === 'DataFlow' || node.type === 'Process')
      .flatMap((node) => splitFlowText(node.name || node.description || '')),
  );

  return { externalDependencies, interfaces, modules, services, persistence, security, relationships, flowTrace };
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
