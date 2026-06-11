import type { CanonicalGraph, GraphEdge, GraphNode, SemanticDocument } from './models.js';
import { isEnterpriseLikeDocument, loadReferenceCorpus } from './reference-corpus.js';
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

function serviceNameFromTitle(title: string): string {
  const trimmed = title.replace(/\s+with.*$/i, '').trim();
  return trimmed || title;
}

function inferGraphNodes(document: SemanticDocument, systemId: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const title = deriveSystemName(document);
  const serviceName = serviceNameFromTitle(title);
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

  const serviceNode = pushNode(nodes, {
    id: `${systemId}.service`,
    type: 'Service',
    name: serviceName,
    description: getSectionText(document, 'processes') || getSectionText(document, 'data_flows') || title,
    status: 'draft',
    sourceRef: `${sourceRefBase}#system`,
    version: '1.0.0',
  });

  const interfaceItems = getSectionItems(document, 'interfaces');
  const dataFlowItems = getSectionItems(document, 'data_flows');
  const processItems = getSectionItems(document, 'processes');
  const moduleItems = getSectionItems(document, 'modules');
  const ruleItems = getSectionItems(document, 'rules');
  const securityItems = getSectionItems(document, 'security');
  const dependencyItems = getSectionItems(document, 'dependencies');
  const exampleItems = getSectionItems(document, 'examples');
  const acceptanceItems = getSectionItems(document, 'acceptance_criteria');
  const contextText = getSectionText(document, 'context').toLowerCase();
  const combinedText = [
    ...interfaceItems,
    ...dataFlowItems,
    ...processItems,
    ...ruleItems,
    ...securityItems,
    ...dependencyItems,
    contextText,
  ]
    .join(' ')
    .toLowerCase();
  const referenceCorpus = loadReferenceCorpus();
  const enterpriseLike = isEnterpriseLikeDocument({
    interfaceCount: interfaceItems.length,
    dependencyCount: dependencyItems.length,
    processCount: processItems.length,
    securityCount: securityItems.length,
    dataFlowCount: dataFlowItems.length,
  }, combinedText);

  const inferredModuleItems =
    moduleItems.length > 0 ? moduleItems : inferModulesFromSource(combinedText, referenceCorpus.moduleHints, enterpriseLike);

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

  const moduleNodes = inferredModuleItems.map((item, index) =>
    pushNode(nodes, {
      id: createNodeId(`${systemId}.module`, item, index),
      type: 'Module',
      name: item,
      description: item,
      status: 'draft',
      sourceRef: `${sourceRefBase}#modules`,
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

  const dependencyNodes = dependencyItems.map((item, index) => {
    const isPersistence = /persistence|database|storage|repository|file|postgres|oracle|sql/i.test(item);
    return pushNode(nodes, {
      id: createNodeId(`${systemId}.${isPersistence ? 'persistence' : 'dependency'}`, item, index),
      type: isPersistence ? 'Persistence' : 'Dependency',
      name: item,
      description: item,
      status: 'draft',
      sourceRef: `${sourceRefBase}#dependencies`,
      version: '1.0.0',
    });
  });

  const persistenceNodes = dependencyNodes.filter((node) => node.type === 'Persistence');
  const dependencyOnlyNodes = dependencyNodes.filter((node) => node.type !== 'Persistence');

  const externalSystemSeeds = [
    ['Kafka', /\bkafka\b|\bevent stream\b|\bstream\b/],
    ['Redis', /\bredis\b/i],
    ['WebSocket gateway', /\bwebsocket\b|\bws\b/i],
    ['Mail service', /\bmail\b|\bsmtp\b|\bemail\b/i],
    ['Object storage', /\bminio\b|\bs3\b|\bobject storage\b/i],
    ['OAuth provider', /\boauth\b|\boidc\b|\blogin\b/i],
    ['Feature policy service', /\bfeature guard\b|\bfeature policy\b/i],
    ['Audit log service', /\baudit(?: log)?\b|\baudit log service\b/],
    ['Notification service', /\bnotification\b|\bnotify\b|\bwebhook\b/],
    ['Message Queue', /\bmq\b|\bqueue\b|\bmessage queue\b/i],
    ['Event Stream', /\bkafka\b|\bevent stream\b|\bstream\b/i],
    ['Relational Database', /\bpostgres(ql)?\b|\boracle\b|\bdatabase\b|\bsql\b/i],
  ] as const;

  const externalSystemNodes = externalSystemSeeds
    .filter(([, pattern]) => pattern.test(combinedText))
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

  const monitorNodes = /monitor|alert|metric|health|throughput|latency|failure/i.test(combinedText)
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
    serviceNode,
    ...interfaceNodes,
    ...dataFlowNodes,
    ...processNodes,
    ...moduleNodes,
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

  pushEdge(edges, securityNode.id, serviceNode.id, 'guardedBy');

  interfaceNodes.forEach((node) => {
    pushEdge(edges, node.id, serviceNode.id, 'flowsTo');
    pushEdge(edges, serviceNode.id, node.id, 'exposes');
  });

  dataFlowNodes.forEach((flowNode, index) => {
    const nextProcess = processNodes[index % Math.max(processNodes.length, 1)];
    if (nextProcess) {
      pushEdge(edges, flowNode.id, nextProcess.id, 'flowsTo');
      pushEdge(edges, nextProcess.id, flowNode.id, 'describes');
    }
    pushEdge(edges, flowNode.id, serviceNode.id, 'flowsTo');
  });

  processNodes.forEach((processNode) => {
    pushEdge(edges, serviceNode.id, processNode.id, 'contains');
    for (const dependencyNode of [...dependencyOnlyNodes, ...persistenceNodes]) {
      if (
        processNode.name.toLowerCase().includes(dependencyNode.name.toLowerCase()) ||
        dependencyNode.name.toLowerCase().includes(processNode.name.toLowerCase())
      ) {
        pushEdge(edges, processNode.id, dependencyNode.id, dependencyNode.type === 'Persistence' ? 'writesTo' : 'dependsOn');
      }
    }
    for (const externalSystemNode of externalSystemNodes) {
      const processName = processNode.name.toLowerCase();
      const externalName = externalSystemNode.name.toLowerCase();
      if (
        processName.includes(externalName) ||
        (processName.includes('audit') && externalName.includes('audit')) ||
        (processName.includes('notification') && externalName.includes('notification')) ||
        (processName.includes('call') && externalName.includes('service'))
      ) {
        pushEdge(edges, processNode.id, externalSystemNode.id, 'uses');
      }
    }
  });

  moduleNodes.forEach((moduleNode) => {
    pushEdge(edges, systemNode.id, moduleNode.id, 'contains');
    pushEdge(edges, moduleNode.id, serviceNode.id, 'contains');
    for (const dependencyNode of dependencyNodes) {
      const moduleName = moduleNode.name.toLowerCase();
      const dependencyName = dependencyNode.name.toLowerCase();
      if (
        moduleName.includes(dependencyName) ||
        dependencyName.includes(moduleName) ||
        /web|api|controller|rest/i.test(moduleName) && /ui|api|web/i.test(dependencyName) ||
        /service|domain|business/i.test(moduleName) && /service|policy|guard/i.test(dependencyName) ||
        /persistence|repository|db|database/i.test(moduleName) && /persistence|database|repository|sql|postgres|oracle/i.test(dependencyName)
      ) {
        pushEdge(edges, moduleNode.id, dependencyNode.id, 'dependsOn');
      }
    }
  });

  integrationEndpointNodes.forEach((endpointNode) => {
    pushEdge(edges, serviceNode.id, endpointNode.id, 'uses');
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
    pushEdge(edges, serviceNode.id, transformationNode.id, 'uses');
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
    pushEdge(edges, serviceNode.id, metricNode.id, 'observes');
  });

  alertNodes.forEach((alertNode) => {
    for (const processNode of processNodes) {
      pushEdge(edges, processNode.id, alertNode.id, 'triggers');
    }
    pushEdge(edges, securityNode.id, alertNode.id, 'emits');
  });

  for (const ruleNode of ruleNodes) {
    pushEdge(edges, securityNode.id, ruleNode.id, 'contains');
  }

  for (const dependencyNode of dependencyNodes) {
    pushEdge(edges, securityNode.id, dependencyNode.id, 'requires');
    pushEdge(edges, serviceNode.id, dependencyNode.id, dependencyNode.type === 'Persistence' ? 'writesTo' : 'dependsOn');
  }

  externalSystemNodes.forEach((externalSystemNode) => {
    pushEdge(edges, serviceNode.id, externalSystemNode.id, 'uses');
  });

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

function inferModulesFromSource(sourceText: string, hints: string[], enterpriseLike: boolean): string[] {
  if (!enterpriseLike) {
    return [];
  }

  const lower = sourceText.toLowerCase();
  const inferred = new Set<string>();

  const patterns: Array<[string, RegExp]> = [
    ['api', /\bapi\b|\brest\b|\bdto\b|\bopenapi\b|\bhttp\b/],
    ['web', /\bweb\b|\bui\b|\bcontroller\b|\bendpoint\b/],
    ['service', /\bservice\b|\borchestrat|\bworkflow\b|\bjob\b|\blistener\b/],
    ['persistence', /\bpersist\b|\brepository\b|\bdatabase\b|\bjpa\b|\bjdbc\b|\bentity\b|\bmigration\b/],
    ['common', /\bsecurity\b|\bjwt\b|\boauth\b|\bpermission\b|\brole\b|\bfeature\b/],
    ['app', /\bboot\b|\bapplication\b|\bconfig\b|\bstarter\b/],
    ['notification', /\bnotification\b|\bwebsocket\b|\bredis\b|\bmail\b|\bminio\b|\bs3\b/],
  ];

  for (const [moduleName, pattern] of patterns) {
    if (pattern.test(lower) && hints.includes(moduleName)) {
      inferred.add(moduleName);
    }
  }

  return [...inferred];
}
