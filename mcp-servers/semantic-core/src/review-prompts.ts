export interface ReviewPromptBundleInput {
  sourcePath: string;
  semanticSource: string;
  graph: unknown;
  reviewDossier?: unknown;
  flowMap?: unknown;
  validation: {
    status: string;
    summary: { gaps: number; conflicts: number; warnings: number; violations: number };
    issues: Array<{
      severity?: string;
      code?: string;
      message?: string;
      sourceRef?: string;
      sourceLine?: number;
    }>;
  };
  expectationDocuments?: Array<{ path: string; content: string }>;
}

export interface ReviewPromptBundle {
  promptVersion: string;
  architecturePrompt: string;
  flowPrompt: string;
  dataModelPrompt: string;
  consistencyPrompt: string;
  mergePrompt: string;
}

export function buildReviewPromptBundle(input: ReviewPromptBundleInput): ReviewPromptBundle {
  const semanticDigest = summarizeSemanticSource(input.semanticSource);
  const graphDigest = renderCanonicalGraphDigest(input.graph);
  const previewDigest = renderPreviewDigest(input.graph);
  const dossierDigest = renderReviewDossierDigest(input.reviewDossier);
  const expectationDigest = renderExpectationDocuments(input.expectationDocuments ?? []);
  const flowDigest = renderFlowMapDigest(input.flowMap);

  const commonContext = [
    `Source: ${input.sourcePath}`,
    '',
    'Expectation documents:',
    expectationDigest,
    '',
    'Semantic source digest:',
    semanticDigest,
    '',
    'Preview/component digest:',
    previewDigest,
    '',
    'Graph digest:',
    graphDigest,
    '',
    'Review dossier digest:',
    dossierDigest,
    '',
    'Validation summary:',
    JSON.stringify(input.validation.summary, null, 2),
    '',
    'Validation issues:',
    JSON.stringify(input.validation.issues, null, 2),
  ].join('\n');

  return {
    promptVersion: '1.2.0',
    architecturePrompt: [
      '# Architecture review agent',
      '',
      commonContext,
      '',
      'Task:',
      'Infer the software architecture only. Classify the system into these lanes: Web / HTTP ingress, Integration interfaces, Security, Services, Persistence / storage.',
      'Exclude API documentation and generic logic-layer buzzwords.',
      'Return valid JSON with summary, notes, issues, and diagramClassification layers focused on architecture.',
    ].join('\n'),
    flowPrompt: [
      '# Flow review agent',
      '',
      commonContext,
      '',
      'Detected flow traces (deterministic, from bytecode analysis):',
      flowDigest,
      '',
      'Task:',
      'Use the detected flow traces above as ground truth for execution paths. Infer the real request, command, async, and scheduled flows only. Focus on paths through controllers, services, jobs, listeners, and persistence boundaries.',
      'Return valid JSON with summary, notes, issues, and refinedSemanticMarkdown concentrated on flow scenarios.',
    ].join('\n'),
    dataModelPrompt: [
      '# Data model review agent',
      '',
      commonContext,
      '',
      'Task:',
      'Infer the database model only. Trust schema files and migrations first, then JPA hints. Return valid JSON with summary, notes, issues, and diagramClassification.databaseSchema.',
    ].join('\n'),
    consistencyPrompt: [
      '# Consistency review agent',
      '',
      commonContext,
      '',
      'Task:',
      'Cross-check the architecture, flow, and data model findings for contradictions, missing pieces, and overclaiming. Return valid JSON with summary, notes, and issues only.',
    ].join('\n'),
    mergePrompt: [
      '# Merge semantic agent',
      '',
      commonContext,
      '',
      'Task:',
      'Merge the architecture, flow, data model, and consistency outputs into the final refined semantic markdown and diagram classification JSON.',
      'Write the semantic markdown for humans, not for graph parsing.',
      'Use descriptive section headings and short explanatory paragraphs or bullets.',
      'Do not emit helper prefixes such as API:, APP:, COMMON:, SERVICE_SUMMARY:, SERVICE_FLOW_PREP:, PERSISTENCE:, or SECURITY: inside refinedSemanticMarkdown.',
      'Assume graph-preview and machine support data live in separate artifacts; the markdown should stay readable as documentation.',
      'Return valid JSON with summary, notes, issues, refinedSemanticMarkdown, and diagramClassification.',
    ].join('\n'),
  };
}

function summarizeSemanticSource(source: string): string {
  const sections = source.split(/\n(?=## )/g);
  return sections
    .slice(0, 12)
    .map((section) => section.trim())
    .join('\n\n');
}

function renderExpectationDocuments(documents: Array<{ path: string; content: string }>): string {
  if (!documents.length) {
    return 'No expectation documents provided.';
  }

  return documents
    .map((document) => `### ${document.path}\n${document.content}`)
    .join('\n\n');
}

function renderCanonicalGraphDigest(graph: unknown): string {
  if (!graph || typeof graph !== 'object') {
    return 'No canonical graph provided.';
  }

  const item = graph as Record<string, unknown>;
  const nodes = Array.isArray(item.nodes) ? item.nodes.filter((node) => node && typeof node === 'object') as Array<Record<string, unknown>> : [];
  const edges = Array.isArray(item.edges) ? item.edges.filter((edge) => edge && typeof edge === 'object') as Array<Record<string, unknown>> : [];
  const metadata = item.metadata && typeof item.metadata === 'object' ? (item.metadata as Record<string, unknown>) : undefined;
  const nodeSamples = nodes.slice(0, 18).map((node) => `${stringValue(node.type) ?? 'node'}:${stringValue(node.name) ?? stringValue(node.id) ?? 'unnamed'}`);
  const edgeSamples = edges.slice(0, 18).map((edge) => `${stringValue(edge.from) ?? 'from'} -> ${stringValue(edge.to) ?? 'to'} (${stringValue(edge.type) ?? 'edge'})`);

  return [
    `- schemaVersion: ${stringValue(item.schemaVersion) ?? 'unknown'}`,
    `- title: ${metadata ? stringValue(metadata.title) ?? 'n/a' : 'n/a'}`,
    `- nodes: ${nodes.length}`,
    `- edges: ${edges.length}`,
    `- node samples: ${nodeSamples.join(' | ') || 'none'}`,
    `- edge samples: ${edgeSamples.join(' | ') || 'none'}`,
  ].join('\n');
}

function renderReviewDossierDigest(reviewDossier: unknown): string {
  if (!reviewDossier || typeof reviewDossier !== 'object') {
    return 'No review dossier provided.';
  }
  const dossier = reviewDossier as Record<string, unknown>;
  const graph = dossier.graph && typeof dossier.graph === 'object' ? dossier.graph as Record<string, unknown> : undefined;
  const enrichment = dossier.enrichment && typeof dossier.enrichment === 'object' ? dossier.enrichment as Record<string, unknown> : undefined;
  const validation = dossier.validation && typeof dossier.validation === 'object' ? dossier.validation as Record<string, unknown> : undefined;
  const reviewFocus = Array.isArray(dossier.reviewFocus) ? dossier.reviewFocus.filter((item): item is string => typeof item === 'string') : [];
  const tasks = Array.isArray(enrichment?.tasks) ? enrichment?.tasks as Array<Record<string, unknown>> : [];
  const candidateCount = typeof enrichment?.candidateCount === 'number' ? enrichment.candidateCount : 0;
  const flows = dossier.flows && typeof dossier.flows === 'object' ? dossier.flows as Record<string, unknown> : undefined;
  return [
    `- graph nodes: ${typeof graph?.nodeCount === 'number' ? graph.nodeCount : 'n/a'}`,
    `- graph edges: ${typeof graph?.edgeCount === 'number' ? graph.edgeCount : 'n/a'}`,
    `- enrichment provider: ${stringValue(enrichment?.provider) ?? 'none'}`,
    `- enrichment capability: ${stringValue(enrichment?.capability) ?? 'n/a'}`,
    `- enrichment model: ${stringValue(enrichment?.model) ?? 'n/a'}`,
    `- enrichment candidates: ${candidateCount}`,
    `- enrichment tasks: ${tasks.map((task) => `${stringValue(task.task) ?? 'task'}:${stringValue(task.status) ?? 'unknown'}:${typeof task.candidateCount === 'number' ? task.candidateCount : 0}`).join(' | ') || 'none'}`,
    `- validation issues: ${Array.isArray(validation?.issues) ? validation.issues.length : 'n/a'}`,
    `- review focus: ${reviewFocus.slice(0, 12).join(' | ') || 'none'}`,
    ...(flows ? [
      `- flow triggers: ${typeof flows.triggerCount === 'number' ? flows.triggerCount : 'n/a'} (${Array.isArray(flows.triggerKinds) ? (flows.triggerKinds as string[]).join(', ') : 'n/a'})`,
      `- flows: ${typeof flows.flowCount === 'number' ? flows.flowCount : 'n/a'} (${Array.isArray(flows.flowNames) ? (flows.flowNames as string[]).slice(0, 8).join(' | ') : 'n/a'})`,
    ] : []),
  ].join('\n');
}

function renderFlowMapDigest(flowMap: unknown): string {
  if (!flowMap || typeof flowMap !== 'object') return 'No flow trace data available.';
  const obj = flowMap as Record<string, unknown>;
  const triggers = Array.isArray(obj.triggers) ? obj.triggers as Array<Record<string, unknown>> : [];
  const flows = Array.isArray(obj.flows) ? obj.flows as Array<Record<string, unknown>> : [];
  if (!triggers.length && !flows.length) return 'No flow trace data available.';

  const lines: string[] = [
    `Entrypoints (${triggers.length}):`,
    ...triggers.slice(0, 20).map((t) =>
      `  [${stringValue(t.kind) ?? 'unknown'}] ${stringValue(t.name) ?? '?'} → ${stringValue(t.target) ?? '?'}`,
    ),
    '',
    `Flow traces (${flows.length}):`,
    ...flows.slice(0, 15).map((flow) => {
      const steps = Array.isArray(flow.steps) ? flow.steps as Array<Record<string, unknown>> : [];
      const stepStr = steps.map((s) => `${stringValue(s.role) ?? '?'}:${stringValue(s.nodeName) ?? '?'}`).join(' → ');
      return `  [${stringValue(flow.flowType) ?? 'flow'}] ${stringValue(flow.name) ?? '?'}: ${stepStr || '(no steps)'}`;
    }),
  ];
  return lines.join('\n');
}

function renderPreviewDigest(graph: unknown): string {
  if (!graph || typeof graph !== 'object') {
    return 'No preview metadata available.';
  }
  const metadata = (graph as Record<string, unknown>).metadata;
  if (!metadata || typeof metadata !== 'object') {
    return 'No preview metadata available.';
  }
  const preview = (metadata as Record<string, unknown>).preview;
  if (!preview || typeof preview !== 'object') {
    return 'No preview metadata available.';
  }
  const object = preview as Record<string, unknown>;
  const stringifyList = (value: unknown): string =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 12).join(' | ') || 'none' : 'none';
  const web = object.web && typeof object.web === 'object' ? object.web as Record<string, unknown> : undefined;
  const persistence = object.persistence && typeof object.persistence === 'object' ? object.persistence as Record<string, unknown> : undefined;
  const service = object.service && typeof object.service === 'object' ? object.service as Record<string, unknown> : undefined;
  const notification = object.notification && typeof object.notification === 'object' ? object.notification as Record<string, unknown> : undefined;
  return [
    `- applications: ${stringifyList(object.applications)}`,
    `- api: ${stringifyList(object.api)}`,
    `- app: ${stringifyList(object.app)}`,
    `- common: ${stringifyList(object.common)}`,
    `- web ingress: ${stringifyList(web?.ingress)}`,
    `- persistence repositories: ${stringifyList(persistence?.repositories)}`,
    `- service catalog: ${stringifyList(service?.catalog)}`,
    `- security: ${stringifyList(object.security)}`,
    `- notification api: ${stringifyList(notification?.api)}`,
    `- notification realtime: ${stringifyList(notification?.realtime)}`,
  ].join('\n');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
