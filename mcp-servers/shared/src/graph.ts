import type { CanonicalGraph, GraphEdge, GraphNode, SemanticDocument } from './models.js';
import { deriveSystemName, getSectionItems, getSectionText } from './semantic-markdown.js';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'item';
}

function createNodeId(prefix: string, name: string, index: number): string {
  return `${prefix}.${slugify(name)}.${index + 1}`;
}

function pushNode(nodes: GraphNode[], node: GraphNode): GraphNode {
  nodes.push(node);
  return node;
}

function pushEdge(edges: GraphEdge[], from: string, to: string, type: string): void {
  edges.push({ from, to, type });
}

function addKeywordNode(
  nodes: GraphNode[],
  systemId: string,
  sourceRefBase: string,
  type: string,
  name: string,
  description: string,
): GraphNode {
  return pushNode(nodes, {
    id: `${systemId}.${type.toLowerCase()}.${slugify(name)}`,
    type,
    name,
    description,
    status: 'draft',
    sourceRef: `${sourceRefBase}#generated`,
    version: '1.0.0',
  });
}

function inferGraphNodes(document: SemanticDocument, systemId: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const title = deriveSystemName(document);
  const sourceRefBase = document.sourcePath || 'semantic-markdown';

  const systemNode = pushNode(nodes, {
    id: systemId,
    type: 'SystemSlice',
    name: title,
    description: getSectionText(document, 'intent') || title,
    status: 'draft',
    sourceRef: `${sourceRefBase}#system`,
    version: '1.0.0',
  });

  const interfaceItems = getSectionItems(document, 'interfaces');
  const dataFlowItems = getSectionItems(document, 'data_flows');
  const processItems = getSectionItems(document, 'processes');
  const ruleItems = getSectionItems(document, 'rules');
  const securityItems = getSectionItems(document, 'security');
  const dependencyItems = getSectionItems(document, 'dependencies');
  const exampleItems = getSectionItems(document, 'examples');
  const acceptanceItems = getSectionItems(document, 'acceptance_criteria');
  const combinedText = [
    ...interfaceItems,
    ...dataFlowItems,
    ...processItems,
    ...ruleItems,
    ...securityItems,
    ...dependencyItems,
  ]
    .join(' ')
    .toLowerCase();

  const interfaceNodes = interfaceItems.map((item, index) =>
    pushNode(nodes, {
      id: createNodeId(`${systemId}.interface`, item, index),
      type: 'Interface',
      name: item,
      description: item,
      status: 'draft',
      sourceRef: `${sourceRefBase}#interfaces`,
      version: '1.0.0',
    }),
  );

  const dataFlowNodes = dataFlowItems.map((item, index) =>
    pushNode(nodes, {
      id: createNodeId(`${systemId}.flow`, item, index),
      type: 'DataFlow',
      name: item,
      description: item,
      status: 'draft',
      sourceRef: `${sourceRefBase}#data_flows`,
      version: '1.0.0',
    }),
  );

  const processNodes = processItems.map((item, index) =>
    pushNode(nodes, {
      id: createNodeId(`${systemId}.process`, item, index),
      type: 'Process',
      name: item,
      description: item,
      status: 'draft',
      sourceRef: `${sourceRefBase}#processes`,
      version: '1.0.0',
    }),
  );

  const ruleNodes = ruleItems.map((item, index) =>
    pushNode(nodes, {
      id: createNodeId(`${systemId}.rule`, item, index),
      type: 'Rule',
      name: item,
      description: item,
      status: 'draft',
      sourceRef: `${sourceRefBase}#rules`,
      version: '1.0.0',
    }),
  );

  const securityNode = pushNode(nodes, {
    id: `${systemId}.security`,
    type: 'SecurityPolicy',
    name: 'Security policy',
    description: securityItems.join(' '),
    status: 'draft',
    sourceRef: `${sourceRefBase}#security`,
    version: '1.0.0',
  });

  const dependencyNodes = dependencyItems.map((item, index) =>
    pushNode(nodes, {
      id: createNodeId(`${systemId}.dependency`, item, index),
      type: 'Dependency',
      name: item,
      description: item,
      status: 'draft',
      sourceRef: `${sourceRefBase}#dependencies`,
      version: '1.0.0',
    }),
  );

  const externalSystemSeeds = [
    ['IBM MQ', /ibm\s*mq|\bmq\b/i],
    ['Kafka', /\bkafka\b/i],
    ['Oracle', /\boracle\b/i],
    ['PostgreSQL', /\bpostgres(ql)?\b/i],
  ] as const;

  const externalSystemNodes = externalSystemSeeds
    .filter(([name, pattern]) => pattern.test(combinedText))
    .map(([name]) =>
      addKeywordNode(
        nodes,
        systemId,
        sourceRefBase,
        'ExternalSystem',
        name,
        `External system inferred from the semantic source: ${name}.`,
      ),
    );

  const integrationEndpointNodes = interfaceItems
    .filter((item) => /mq|kafka|api|ui|endpoint|listener|gateway|interface/i.test(item))
    .map((item, index) =>
      pushNode(nodes, {
        id: createNodeId(`${systemId}.endpoint`, item, index),
        type: 'IntegrationEndpoint',
        name: item,
        description: item,
        status: 'draft',
        sourceRef: `${sourceRefBase}#interfaces`,
        version: '1.0.0',
      }),
    );

  const transformationNodes = processItems
    .filter((item) => /transform|map|normalize|enrich|route|convert|process|classify/i.test(item))
    .map((item, index) =>
      pushNode(nodes, {
        id: createNodeId(`${systemId}.transformation`, item, index),
        type: 'Transformation',
        name: item,
        description: item,
        status: 'draft',
        sourceRef: `${sourceRefBase}#processes`,
        version: '1.0.0',
      }),
    );

  const monitorNodes =
    /monitor|alert|metric|health|throughput|latency|failure/i.test(combinedText)
      ? [
          addKeywordNode(
            nodes,
            systemId,
            sourceRefBase,
            'Monitor',
            'Operational monitor',
            'Monitor inferred from monitoring and alerting references in the semantic source.',
          ),
        ]
      : [];

  const metricNodes = /throughput|latency|metric/i.test(combinedText)
    ? [
        addKeywordNode(
          nodes,
          systemId,
          sourceRefBase,
          'Metric',
          'Processing latency',
          'Metric inferred from process performance language in the semantic source.',
        ),
      ]
    : [];

  const alertNodes = /alert|failure|error/i.test(combinedText)
    ? [
        addKeywordNode(
          nodes,
          systemId,
          sourceRefBase,
          'Alert',
          'Processing failure alert',
          'Alert inferred from failure and alert language in the semantic source.',
        ),
      ]
    : [];

  const exampleNodes = exampleItems.map((item, index) =>
    pushNode(nodes, {
      id: createNodeId(`${systemId}.example`, item, index),
      type: 'Example',
      name: item,
      description: item,
      status: 'draft',
      sourceRef: `${sourceRefBase}#examples`,
      version: '1.0.0',
    }),
  );

  const acceptanceNodes = acceptanceItems.map((item, index) =>
    pushNode(nodes, {
      id: createNodeId(`${systemId}.acceptance`, item, index),
      type: 'AcceptanceCriterion',
      name: item,
      description: item,
      status: 'draft',
      sourceRef: `${sourceRefBase}#acceptance_criteria`,
      version: '1.0.0',
    }),
  );

  for (const node of [
    ...interfaceNodes,
    ...dataFlowNodes,
    ...processNodes,
    ...ruleNodes,
    ...dependencyNodes,
    ...exampleNodes,
    ...acceptanceNodes,
    ...externalSystemNodes,
    ...integrationEndpointNodes,
    ...transformationNodes,
    ...monitorNodes,
    ...metricNodes,
    ...alertNodes,
    securityNode,
  ]) {
    pushEdge(edges, systemNode.id, node.id, 'contains');
  }

  interfaceNodes.forEach((node) => {
    for (const processNode of processNodes) {
      pushEdge(edges, processNode.id, node.id, 'uses');
    }
  });

  dataFlowNodes.forEach((flowNode, index) => {
    const nextProcess = processNodes[index % Math.max(processNodes.length, 1)];
    if (nextProcess) {
      pushEdge(edges, flowNode.id, nextProcess.id, 'flowsTo');
    }
  });

  processNodes.forEach((processNode) => {
    for (const dependencyNode of dependencyNodes) {
      if (
        processNode.name.toLowerCase().includes(dependencyNode.name.toLowerCase()) ||
        dependencyNode.name.toLowerCase().includes(processNode.name.toLowerCase())
      ) {
        pushEdge(edges, processNode.id, dependencyNode.id, 'dependsOn');
      }
    }
  });

  integrationEndpointNodes.forEach((endpointNode) => {
    for (const externalSystemNode of externalSystemNodes) {
      if (endpointNode.name.toLowerCase().includes(externalSystemNode.name.toLowerCase().split(' ')[0])) {
        pushEdge(edges, endpointNode.id, externalSystemNode.id, 'uses');
      }
    }
  });

  transformationNodes.forEach((transformationNode, index) => {
    const sourceFlow = dataFlowNodes[index % Math.max(dataFlowNodes.length, 1)];
    const targetFlow = dataFlowNodes[(index + 1) % Math.max(dataFlowNodes.length, 1)];
    if (sourceFlow) pushEdge(edges, sourceFlow.id, transformationNode.id, 'flowsTo');
    if (targetFlow) pushEdge(edges, transformationNode.id, targetFlow.id, 'transformsInto');
  });

  monitorNodes.forEach((monitorNode) => {
    for (const metricNode of metricNodes) {
      pushEdge(edges, monitorNode.id, metricNode.id, 'observes');
    }
    for (const alertNode of alertNodes) {
      pushEdge(edges, monitorNode.id, alertNode.id, 'emits');
    }
  });

  metricNodes.forEach((metricNode) => {
    for (const processNode of processNodes) {
      pushEdge(edges, metricNode.id, processNode.id, 'observes');
    }
  });

  alertNodes.forEach((alertNode) => {
    for (const processNode of processNodes) {
      pushEdge(edges, processNode.id, alertNode.id, 'triggers');
    }
  });

  for (const ruleNode of ruleNodes) {
    pushEdge(edges, securityNode.id, ruleNode.id, 'contains');
  }

  for (const dependencyNode of dependencyNodes) {
    pushEdge(edges, securityNode.id, dependencyNode.id, 'requires');
  }

  exampleNodes.forEach((node) => {
    const firstProcess = processNodes[0];
    if (firstProcess) {
      pushEdge(edges, node.id, firstProcess.id, 'refines');
    }
  });

  acceptanceNodes.forEach((node) => {
    pushEdge(edges, node.id, systemNode.id, 'supports');
  });

  return { nodes, edges };
}

export function generateCanonicalGraph(document: SemanticDocument): CanonicalGraph {
  const systemId = `sys.${slugify(deriveSystemName(document))}`;
  const { nodes, edges } = inferGraphNodes(document, systemId);

  return {
    schemaVersion: '1.0.0',
    nodes,
    edges,
    metadata: {
      sourcePath: document.sourcePath,
      title: deriveSystemName(document),
      createdAt: new Date().toISOString(),
    },
  };
}

export function graphPreview(graph: CanonicalGraph): string {
  return JSON.stringify(
    {
      schemaVersion: graph.schemaVersion,
      nodes: graph.nodes.map((node) => ({ id: node.id, type: node.type, name: node.name, status: node.status })),
      edges: graph.edges,
    },
    null,
    2,
  );
}
