import type { GraphEdge, GraphNode } from './models.js';
import type { ApiFamilySummary, JavaArtifactSummary, JavaEndpointSummary, SchemaHint, SqlArtifactSummary, SourceProjectAnalysis, SourceProjectSnapshot } from './source-learning.js';
import type { JavaAstFile } from './java-ast.js';

export interface CodeKnowledgeGraph {
  schemaVersion: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: CodeKnowledgeGraphSummary;
  metadata: {
    projectName: string;
    projectRoot: string;
    source: 'code-first';
    createdAt: string;
  };
}

export interface CodeKnowledgeGraphSummary {
  applicationItems: string[];
  moduleRoots: string[];
  packageRoots: string[];
  typeCounts: Record<string, number>;
  endpointFamilies: Array<{ family: string; count: number; samples: string[] }>;
  apiFamilies: ApiFamilySummary[];
  apiClientNames: string[];
  apiEnumNames: string[];
  appRuntimeItems: string[];
  serviceNames: string[];
  controllerNames: string[];
  repositoryNames: string[];
  entityNames: string[];
  jobNames: string[];
  listenerNames: string[];
  integrationInterfaces: string[];
  persistenceTargets: string[];
  externalSystems: string[];
  validationBoundaries: string[];
  exceptionHandlers: string[];
  webConfigurations: string[];
  webSecurityBoundaries: string[];
  persistenceRepositoryDetails: string[];
  persistenceMapperDetails: string[];
  serviceDetailItems: string[];
  serviceExceptionDetails: string[];
  flowTraces: string[];
  schemaTables: Array<{ name: string; columns: string[]; primaryKey?: string[] }>;
}

export interface CodeKnowledgeGraphProgressEvent {
  phase:
    | 'project'
    | 'modules'
    | 'packages'
    | 'types'
    | 'endpoints'
    | 'external-systems'
    | 'persistence'
    | 'schema'
    | 'flows'
    | 'linking'
    | 'summary'
    | 'complete';
  message: string;
}

export async function buildCodeKnowledgeGraph(
  analysis: SourceProjectAnalysis,
  snapshot: SourceProjectSnapshot,
  onProgress?: (event: CodeKnowledgeGraphProgressEvent) => void | Promise<void>,
): Promise<CodeKnowledgeGraph> {
  const emitProgress = async (event: CodeKnowledgeGraphProgressEvent): Promise<void> => {
    await onProgress?.(event);
    await Promise.resolve();
  };

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const projectId = `code.${slug(analysis.projectName)}`;
  const projectNode = pushNode(nodes, {
    id: projectId,
    type: 'CodeProject',
    name: analysis.projectName,
    description: `Code-first knowledge graph for ${analysis.projectName}`,
    status: 'ready',
    sourceRef: `${analysis.projectRoot}#code-first`,
    version: '1.0.0',
  });

  const modules = analysis.modules.length ? analysis.modules : ['.'];
  await emitProgress({ phase: 'project', message: 'Creating project node' });
  await emitProgress({ phase: 'modules', message: `Indexing ${modules.length} module roots` });
  const moduleNodes = modules.map((moduleRoot, index) =>
    pushNode(nodes, {
      id: `${projectId}.module.${index + 1}`,
      type: 'Module',
      name: moduleRoot,
      description: `Module root ${moduleRoot}`,
      status: 'draft',
      sourceRef: `${analysis.projectRoot}#module:${moduleRoot}`,
      version: '1.0.0',
    }),
  );

  const packageRoots = unique(
    Object.entries(analysis.packageMap)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 24)
      .map(([pkg]) => pkg.split('.').slice(0, 3).join('.')),
  ).filter(Boolean);
  await emitProgress({ phase: 'packages', message: `Collecting ${packageRoots.length} package roots` });
  const packageNodes = packageRoots.map((packageName, index) =>
    pushNode(nodes, {
      id: `${projectId}.package.${index + 1}`,
      type: 'Package',
      name: packageName,
      description: `Package root ${packageName}`,
      status: 'draft',
      sourceRef: `${analysis.projectRoot}#package:${packageName}`,
      version: '1.0.0',
    }),
  );

  await emitProgress({
    phase: 'types',
    message: `Preparing Java type nodes`,
  });
  const javaTypeNodes = await buildJavaTypeNodes(analysis, nodes, projectId, async (event) => {
    await emitProgress({
      phase: 'types',
      message: event.message,
    });
  });
  await emitProgress({
    phase: 'types',
    message: `Built ${javaTypeNodes.length} Java type nodes`,
  });

  const endpointFamilies = groupEndpointFamilies(analysis.endpointCatalog);
  await emitProgress({ phase: 'endpoints', message: `Grouping ${analysis.endpointCatalog.length} endpoints into ${endpointFamilies.length} families` });
  const endpointFamilyNodes = endpointFamilies.map((family, index) =>
    pushNode(nodes, {
      id: `${projectId}.endpoint-family.${index + 1}`,
      type: 'EndpointFamily',
      name: family.family,
      description: `${family.count} endpoints${family.samples.length ? `; samples: ${family.samples.join(', ')}` : ''}`,
      status: 'draft',
      sourceRef: `${analysis.projectRoot}#endpoints:${family.family}`,
      version: '1.0.0',
    }),
  );

  const endpointNodes = analysis.endpointCatalog.map((entry, index) =>
    pushNode(nodes, {
      id: `${projectId}.endpoint.${index + 1}`,
      type: 'HttpEndpoint',
      name: `${entry.method} ${entry.path}`,
      description: `${entry.method} ${entry.path} (${entry.typeName ?? basename(entry.file)})`,
      status: 'draft',
      sourceRef: `file://${relativePath(entry.file, analysis.projectRoot)}#${entry.method}:${entry.path}`,
      version: '1.0.0',
      method: entry.method,
      path: entry.path,
    }),
  );

  const externalSystemNames = unique(collectExternalSystems(analysis)).sort((left, right) => left.localeCompare(right));
  await emitProgress({ phase: 'external-systems', message: `Inferring ${externalSystemNames.length} external systems` });
  const externalSystemNodes = externalSystemNames.map((name, index) =>
    pushNode(nodes, {
      id: `${projectId}.external.${index + 1}`,
      type: 'ExternalSystem',
      name,
      description: `External integration inferred from source: ${name}`,
      status: 'draft',
      sourceRef: `${analysis.projectRoot}#external:${name}`,
      version: '1.0.0',
    }),
  );

  const persistenceTargets = unique(collectPersistenceTargets(analysis)).sort((left, right) => left.localeCompare(right));
  await emitProgress({ phase: 'persistence', message: `Inferring ${persistenceTargets.length} persistence targets` });
  const persistenceNodes = persistenceTargets.map((name, index) =>
    pushNode(nodes, {
      id: `${projectId}.persistence.${index + 1}`,
      type: 'PersistenceTarget',
      name,
      description: `Persistence target inferred from code and schema evidence: ${name}`,
      status: 'draft',
      sourceRef: `${analysis.projectRoot}#persistence:${name}`,
      version: '1.0.0',
    }),
  );

  const schemaNodes = buildSchemaNodes(analysis, nodes, projectId);
  await emitProgress({ phase: 'schema', message: `Building ${analysis.schemaHints.length + analysis.sqlCatalog.length} schema nodes` });
  const flowNodes = buildFlowNodes(analysis, nodes, projectId);
  await emitProgress({ phase: 'flows', message: `Building flow nodes from ${analysis.moduleDossiers?.flatMap((module) => module.flowTraces).length ?? 0} traces` });
  const webConcernNodes = buildWebConcernNodes(analysis, nodes, projectId);

  void onProgress?.({ phase: 'project', message: 'Creating project node' });
  void onProgress?.({ phase: 'modules', message: `Indexing ${modules.length} module roots` });
  void onProgress?.({ phase: 'packages', message: `Collecting ${packageRoots.length} package roots` });
  void onProgress?.({
    phase: 'types',
    message: `Building ${analysis.javaAstCatalog?.length ? analysis.javaAstCatalog.reduce((count, astFile) => count + astFile.types.length, 0) : analysis.javaCatalog.length} Java type nodes`,
  });
  void onProgress?.({ phase: 'endpoints', message: `Grouping ${analysis.endpointCatalog.length} endpoints into ${endpointFamilies.length} families` });
  void onProgress?.({ phase: 'external-systems', message: `Inferring ${externalSystemNames.length} external systems` });
  void onProgress?.({ phase: 'persistence', message: `Inferring ${persistenceTargets.length} persistence targets` });
  void onProgress?.({ phase: 'schema', message: `Building ${analysis.schemaHints.length + analysis.sqlCatalog.length} schema nodes` });
  void onProgress?.({ phase: 'flows', message: `Building flow nodes from ${analysis.moduleDossiers?.flatMap((module) => module.flowTraces).length ?? 0} traces` });

  for (const moduleNode of moduleNodes) {
    pushEdge(edges, projectId, moduleNode.id, 'contains');
  }
  for (const packageNode of packageNodes) {
    pushEdge(edges, projectId, packageNode.id, 'contains');
  }
  for (const typeNode of javaTypeNodes) {
    pushEdge(edges, projectId, typeNode.id, 'contains');
  }
  for (const endpointFamilyNode of endpointFamilyNodes) {
    pushEdge(edges, projectId, endpointFamilyNode.id, 'contains');
  }
  for (const endpointNode of endpointNodes) {
    pushEdge(edges, projectId, endpointNode.id, 'contains');
  }
  for (const externalSystemNode of externalSystemNodes) {
    pushEdge(edges, projectId, externalSystemNode.id, 'contains');
  }
  for (const persistenceNode of persistenceNodes) {
    pushEdge(edges, projectId, persistenceNode.id, 'contains');
  }
  for (const schemaNode of schemaNodes) {
    pushEdge(edges, projectId, schemaNode.id, 'contains');
  }
  for (const flowNode of flowNodes) {
    pushEdge(edges, projectId, flowNode.id, 'contains');
  }
  for (const webConcernNode of webConcernNodes) {
    pushEdge(edges, projectId, webConcernNode.id, 'contains');
  }

  await emitProgress({ phase: 'linking', message: 'Linking modules, packages, endpoints, persistence, and flows' });
  linkModulesToTypes(analysis, moduleNodes, javaTypeNodes, edges);
  linkPackagesToTypes(packageNodes, javaTypeNodes, edges);
  linkEndpointsToTypes(analysis, endpointFamilyNodes, endpointNodes, javaTypeNodes, edges);
  linkTypesToPersistence(analysis, javaTypeNodes, persistenceNodes, schemaNodes, edges);
  linkTypesToExternalSystems(analysis, javaTypeNodes, externalSystemNodes, edges);
  linkFlowNodes(analysis, flowNodes, javaTypeNodes, persistenceNodes, externalSystemNodes, edges);
  linkWebConcernNodes(analysis, webConcernNodes, javaTypeNodes, endpointFamilyNodes, edges);

  const summary: CodeKnowledgeGraphSummary = {
    applicationItems: analysis.repositoryStructure.topLevelProjects.map((item) => `${item.name} (${item.role})`),
    moduleRoots: modules,
    packageRoots,
    typeCounts: countTypes(analysis.javaCatalog),
    endpointFamilies,
    apiFamilies: analysis.apiSurface?.families ?? [],
    apiClientNames: analysis.apiSurface?.clientImplementations.map((item) => item.name) ?? [],
    apiEnumNames: analysis.apiSurface?.enumTypes.map((item) => item.name) ?? [],
    appRuntimeItems: collectAppRuntimeItems(analysis),
    serviceNames: collectKinds(analysis, 'service'),
    controllerNames: collectKinds(analysis, 'controller'),
    repositoryNames: collectKinds(analysis, 'repository'),
    entityNames: collectKinds(analysis, 'entity'),
    jobNames: collectKinds(analysis, 'job'),
    listenerNames: collectKinds(analysis, 'listener'),
    integrationInterfaces: collectIntegrationInterfaces(analysis),
    persistenceTargets,
    externalSystems: externalSystemNames,
    validationBoundaries: collectValidationBoundaryNames(analysis),
    exceptionHandlers: collectExceptionHandlerNames(analysis),
    webConfigurations: collectWebConfigurationNames(analysis),
    webSecurityBoundaries: collectWebSecurityBoundaryNames(analysis),
    persistenceRepositoryDetails: analysis.persistenceSummary.repositories.map((item) => `${item.name} (${item.style}; ${item.operationGroups.join(', ') || 'general persistence'})`),
    persistenceMapperDetails: [
      ...(analysis.persistenceSummary.mapperSummary.abstractBase ? [`${analysis.persistenceSummary.mapperSummary.abstractBase} (${analysis.persistenceSummary.mapperSummary.abstractBaseNotes.join(', ') || 'shared row helpers'})`] : []),
      ...analysis.persistenceSummary.mapperSummary.rowMappers.map((item) => `row mapper: ${item}`),
      ...analysis.persistenceSummary.mapperSummary.dtoMappers.map((item) => `mapper: ${item}`),
    ],
    serviceDetailItems: [
      ...analysis.serviceSummary.clientImplementations.map((item) => `client: ${item.name} (${item.purpose})`),
      ...analysis.serviceSummary.misplacedDtos.map((item) => `dto: ${item.name} (${item.purpose})`),
      ...analysis.serviceSummary.serviceEvents.map((item) => `event: ${item.name} (${item.purpose})`),
      ...analysis.serviceSummary.serviceInterfaces.map((item) => `interface: ${item.name} (${item.purpose})`),
      ...analysis.serviceSummary.executionServices.map((item) => `execution service: ${item.name} (${item.purpose})`),
      ...analysis.serviceSummary.executionServices.map((item) => `service summary: ${item.name} (${item.purpose})`),
      ...analysis.serviceSummary.executionServices.flatMap((item) => item.operations.map((operation) => `operation: ${item.name}.${operation.name} (${operation.purpose})`)),
      ...analysis.serviceSummary.executionServices.flatMap((item) => item.operations.map((operation) => `flow prep: ${item.name}.${operation.name} [deps=${item.dependencies.join(', ') || 'none'}; collab=${operation.collaborators.join(', ') || 'none'}; effects=${operation.sideEffects.join(', ') || 'none'}]`)),
      ...analysis.serviceSummary.mailCapabilities.config.map((item) => `mail config: ${item}`),
      ...analysis.serviceSummary.mailCapabilities.templates.map((item) => `mail template: ${item.name} (${item.purpose})`),
      ...analysis.serviceSummary.mailCapabilities.operations.map((item) => `mail op: ${item.name} (${item.purpose}${item.issue ? `; ${item.issue}` : ''})`),
      ...analysis.serviceSummary.storageCapabilities.summary.map((item) => `storage: ${item}`),
      ...analysis.serviceSummary.storageCapabilities.uploads.map((item) => `storage upload: ${item.name} (${item.purpose})`),
      ...analysis.serviceSummary.schedulingModel.map((item) => `scheduling: ${item}`),
      ...analysis.serviceSummary.scheduledJobs.map((item) => `job: ${item.name} (${item.schedule}; ${item.purpose})`),
      ...analysis.serviceSummary.asyncListeners.map((item) => `listener: ${item.name} (${item.purpose})`),
      ...analysis.serviceSummary.asyncListeners.flatMap((item) => item.triggers.map((trigger) => `listener trigger: ${trigger.event} from ${trigger.source}`)),
      ...analysis.serviceSummary.violations.map((item) => `violation: ${item}`),
    ],
    serviceExceptionDetails: analysis.serviceSummary.exceptionTypes.map((item) => `${item.name} (${item.thrownBy.length ? `thrown by ${item.thrownBy.join(', ')}` : item.purpose})`),
    flowTraces: unique([
      ...(analysis.moduleDossiers?.flatMap((module) => module.flowTraces) ?? []),
      ...analysis.flowSummary.flows.map((flow) => `${flow.trigger} -> ${flow.name}: ${flow.summary}`),
      ...analysis.flowSummary.triggers.map((trigger) => `${trigger.kind}:${trigger.source} -> ${trigger.target}`),
    ]).slice(0, 48),
    schemaTables: collectSchemaTables(analysis),
  };
  await emitProgress({ phase: 'summary', message: `Summarized ${nodes.length} nodes and ${edges.length} edges` });

  const graph: CodeKnowledgeGraph = {
    schemaVersion: '1.0.0',
    nodes,
    edges,
    summary,
    metadata: {
      projectName: analysis.projectName,
      projectRoot: analysis.projectRoot,
      source: 'code-first',
      createdAt: new Date().toISOString(),
    },
  };
  await emitProgress({ phase: 'complete', message: 'Code graph build complete' });
  return graph;
}

async function buildJavaTypeNodes(
  analysis: SourceProjectAnalysis,
  nodes: GraphNode[],
  projectId: string,
  onProgress?: (event: { message: string; current?: number; total?: number }) => void | Promise<void>,
): Promise<GraphNode[]> {
  const astFiles = analysis.javaAstCatalog ?? [];
  if (astFiles.length > 0) {
    const result: GraphNode[] = [];
    const grouped = groupAstFilesByPackageFamily(astFiles);
    const total = astFiles.reduce((count, astFile) => count + astFile.types.length, 0);
    let counter = 0;
    let groupIndex = 0;
    for (const [family, group] of grouped) {
      groupIndex += 1;
      await onProgress?.({
        message: `Processing package group ${family} (${groupIndex}/${grouped.size}) with ${group.length} files`,
        current: counter,
        total,
      });
      for (const astFile of group) {
        const packageName = astFile.packageName;
        for (const type of astFile.types) {
          counter += 1;
          const kind = classifyJavaAstKind(type, astFile.file);
          result.push(
            pushNode(nodes, {
              id: `${projectId}.type.${counter}`,
              type: mapJavaKind(kind),
              name: type.name,
              description: describeJavaAstType(astFile, type),
              status: 'draft',
              sourceRef: `file://${relativePath(astFile.file, analysis.projectRoot)}`,
              version: '1.0.0',
              packageName,
              kind,
            }),
          );
          if (counter % 25 === 0 || counter === total) {
            await onProgress?.({
              message: `Indexed ${counter}/${total} Java type nodes`,
              current: counter,
              total,
            });
            await yieldToEventLoop();
          }
        }
      }
      await yieldToEventLoop();
    }
    return uniqueBy(result, (node) => node.id);
  }

  return analysis.javaCatalog.map((item, index) =>
    pushNode(nodes, {
      id: `${projectId}.type.${index + 1}`,
      type: mapJavaKind(item.kind),
      name: item.typeName ?? basename(item.file),
      description: describeJavaArtifact(item),
      status: 'draft',
      sourceRef: `file://${relativePath(item.file, analysis.projectRoot)}`,
      version: '1.0.0',
      packageName: item.packageName,
      kind: item.kind,
    }),
  );
}

function groupAstFilesByPackageFamily(astFiles: JavaAstFile[]): Map<string, JavaAstFile[]> {
  const groups = new Map<string, JavaAstFile[]>();
  for (const astFile of astFiles) {
    const family = classifyPackageFamily(astFile.packageName, astFile.file);
    const bucket = groups.get(family) ?? [];
    bucket.push(astFile);
    groups.set(family, bucket);
  }
  return new Map([...groups.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

function classifyPackageFamily(packageName?: string, file?: string): string {
  const text = `${packageName ?? ''} ${file ?? ''}`.toLowerCase();
  if (/\bapi\b/.test(text) || /\/api\//.test(text)) return 'api';
  if (/\bweb\b/.test(text) || /\/web\//.test(text)) return 'web';
  if (/\bservice\b/.test(text) || /\/service\//.test(text)) return 'service';
  if (/\bpersistence\b/.test(text) || /\/persistence\//.test(text)) return 'persistence';
  if (/\brepository\b/.test(text) || /\/repository\//.test(text)) return 'repository';
  if (/\bcommon\b/.test(text) || /\/common\//.test(text)) return 'common';
  if (/\bapp\b/.test(text) || /\/app\//.test(text)) return 'app';
  if (/\bnotification\b/.test(text) || /\/notification\//.test(text)) return 'notification';
  if (/\bsecurity\b/.test(text) || /\/security\//.test(text)) return 'security';
  if (/\bjob\b/.test(text) || /\/jobs\//.test(text)) return 'jobs';
  if (/\blistener\b/.test(text) || /\/listeners\//.test(text)) return 'listeners';
  return 'other';
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function classifyJavaAstKind(type: JavaAstFile['types'][number], file: string): JavaArtifactSummary['kind'] {
  const annotationSet = new Set(type.annotations.map((annotation) => annotation.toLowerCase()));
  if (annotationSet.has('restcontroller') || annotationSet.has('controller') || /controller\.java$/i.test(file)) return 'controller';
  if (annotationSet.has('service') || /service\.java$/i.test(file)) return 'service';
  if (annotationSet.has('repository') || /repository\.java$/i.test(file)) return 'repository';
  if (annotationSet.has('entity') || annotationSet.has('table') || /entity\.java$/i.test(file)) return 'entity';
  if (annotationSet.has('configuration') || annotationSet.has('config') || /(?:config|configuration)\.java$/i.test(file)) return 'configuration';
  if (annotationSet.has('preauthorize') || annotationSet.has('secured') || annotationSet.has('rolesallowed') || annotationSet.has('securityfilterchain') || /security\//i.test(file)) return 'security';
  if (annotationSet.has('scheduled') || /\/jobs\//i.test(file)) return 'job';
  if (annotationSet.has('eventlistener') || annotationSet.has('kafkalistener') || annotationSet.has('messagelistener') || /\/listeners\//i.test(file)) return 'listener';
  if (/websocket/i.test(file) || type.annotations.some((annotation) => /websocket/i.test(annotation))) return 'websocket';
  return 'component';
}

function describeJavaAstType(astFile: JavaAstFile, type: JavaAstFile['types'][number]): string {
  const parts = [
    astFile.packageName ? `package: ${astFile.packageName}` : undefined,
    type.annotations.length ? `annotations: ${type.annotations.join(', ')}` : undefined,
    type.modifiers.length ? `modifiers: ${type.modifiers.join(', ')}` : undefined,
    type.fields.length ? `fields: ${type.fields.map((field: JavaAstFile['types'][number]['fields'][number]) => `${field.name}:${field.type}`).join(', ')}` : undefined,
    type.methods.length ? `methods: ${type.methods.map((method: JavaAstFile['types'][number]['methods'][number]) => `${method.name}(${method.parameters.map((parameter: JavaAstFile['types'][number]['methods'][number]['parameters'][number]) => `${parameter.name}:${parameter.type}`).join(', ')})`).join(', ')}` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(' | ') : type.kind;
}

export function renderCodeKnowledgeGraphMarkdown(graph: CodeKnowledgeGraph): string {
  return [
    `# ${graph.metadata.projectName} code-first knowledge graph`,
    '',
    '## overview',
    ...(graph.summary.applicationItems.length ? graph.summary.applicationItems.map((item) => `- application: ${item}`) : []),
    `- source root: ${graph.metadata.projectRoot}`,
    `- modules: ${graph.summary.moduleRoots.length}`,
    `- packages: ${graph.summary.packageRoots.length}`,
    `- java types: ${graph.summary.typeCounts.total ?? 0}`,
    `- endpoints: ${graph.summary.endpointFamilies.reduce((total, family) => total + family.count, 0)}`,
    `- persistence targets: ${graph.summary.persistenceTargets.length}`,
    `- external systems: ${graph.summary.externalSystems.length}`,
    '',
    '## endpoint families',
    ...(graph.summary.endpointFamilies.length
      ? graph.summary.endpointFamilies.map((family) => `- ${family.family} (${family.count})${family.samples.length ? ` — ${family.samples.join(', ')}` : ''}`)
      : ['- none']),
    '',
    '## api surface',
    ...(graph.summary.apiFamilies.length
      ? graph.summary.apiFamilies.map((family) => {
          const parts = [
            `${family.endpointCount} endpoints`,
            family.authMode === 'protected' ? `auth=${family.securitySchemes.join('|') || 'required'}` : family.authMode === 'mixed' ? 'auth=mixed' : 'auth=public',
            family.permissionHints.length ? `rights=${family.permissionHints.join('|')}` : '',
            family.dtoTypes.length ? `dtos=${family.dtoTypes.slice(0, 6).join('|')}` : '',
            family.enumTypes.length ? `enums=${family.enumTypes.slice(0, 4).join('|')}` : '',
            family.hasSwagger ? 'swagger' : '',
            family.hasValidation ? 'validation' : '',
          ].filter(Boolean);
          return `- ${family.family}: ${parts.join(' ; ')}`;
        })
      : ['- none']),
    ...(graph.summary.apiClientNames.length ? [`- api clients: ${graph.summary.apiClientNames.join(' | ')}`] : []),
    ...(graph.summary.apiEnumNames.length ? [`- api enums: ${graph.summary.apiEnumNames.join(' | ')}`] : []),
    '',
    '## app runtime',
    ...(graph.summary.appRuntimeItems.length ? graph.summary.appRuntimeItems.map((item) => `- ${item}`) : ['- none']),
    '',
    '## service details',
    ...(graph.summary.serviceDetailItems.length ? graph.summary.serviceDetailItems.map((item) => `- ${item}`) : ['- none']),
    '',
    '## service exceptions',
    ...(graph.summary.serviceExceptionDetails.length ? graph.summary.serviceExceptionDetails.map((item) => `- ${item}`) : ['- none']),
    '',
    '## flow traces',
    ...(graph.summary.flowTraces.length ? graph.summary.flowTraces.map((trace) => `- ${trace}`) : ['- none']),
    '',
    '## persistence targets',
    ...(graph.summary.persistenceTargets.length ? graph.summary.persistenceTargets.map((target) => `- ${target}`) : ['- none']),
    '',
    '## persistence repository details',
    ...(graph.summary.persistenceRepositoryDetails.length ? graph.summary.persistenceRepositoryDetails.map((item) => `- ${item}`) : ['- none']),
    '',
    '## persistence mapper details',
    ...(graph.summary.persistenceMapperDetails.length ? graph.summary.persistenceMapperDetails.map((item) => `- ${item}`) : ['- none']),
    '',
    '## external systems',
    ...(graph.summary.externalSystems.length ? graph.summary.externalSystems.map((system) => `- ${system}`) : ['- none']),
    '',
    '## web concerns',
    ...(graph.summary.validationBoundaries.length ? [`- validation boundaries: ${graph.summary.validationBoundaries.join(' | ')}`] : []),
    ...(graph.summary.exceptionHandlers.length ? [`- exception handlers: ${graph.summary.exceptionHandlers.join(' | ')}`] : []),
    ...(graph.summary.webConfigurations.length ? [`- web configurations: ${graph.summary.webConfigurations.join(' | ')}`] : []),
    ...(graph.summary.webSecurityBoundaries.length ? [`- web security boundaries: ${graph.summary.webSecurityBoundaries.join(' | ')}`] : []),
    ...(!graph.summary.validationBoundaries.length && !graph.summary.exceptionHandlers.length && !graph.summary.webConfigurations.length && !graph.summary.webSecurityBoundaries.length ? ['- none'] : []),
    '',
    '## schema tables',
    ...(graph.summary.schemaTables.length
      ? graph.summary.schemaTables.map((table) => `- ${table.name}${table.primaryKey?.length ? ` (pk: ${table.primaryKey.join(', ')})` : ''}${table.columns.length ? ` | columns: ${table.columns.join(', ')}` : ''}`)
      : ['- none']),
  ].join('\n');
}

function buildSchemaNodes(analysis: SourceProjectAnalysis, nodes: GraphNode[], projectId: string): GraphNode[] {
  const result: GraphNode[] = [];
  for (const hint of analysis.schemaHints) {
    const tableName = hint.tableName ?? hint.typeName ?? basename(hint.file);
    result.push(
      pushNode(nodes, {
        id: `${projectId}.schema.${slug(tableName)}`,
        type: 'Table',
        name: tableName,
        description: hint.fields?.length ? hint.fields.map((field) => `${field.name}${field.type ? `:${field.type}` : ''}`).join(', ') : hint.columns.join(', '),
        status: 'draft',
        sourceRef: `file://${relativePath(hint.file, analysis.projectRoot)}#schema`,
        version: '1.0.0',
        primaryKey: hint.primaryKey ?? [],
      }),
    );
  }
  for (const sqlFile of analysis.sqlCatalog) {
    for (const table of sqlFile.tables) {
      result.push(
        pushNode(nodes, {
          id: `${projectId}.sqltable.${slug(table.name)}`,
          type: 'Table',
          name: table.name,
          description: table.columns.map((column) => `${column.name}${column.type ? `:${column.type}` : ''}`).join(', '),
          status: 'draft',
          sourceRef: `file://${relativePath(sqlFile.file, analysis.projectRoot)}#sql`,
          version: '1.0.0',
          primaryKey: table.primaryKey ?? [],
        }),
      );
    }
  }
  return uniqueBy(result, (node) => node.id);
}

function buildFlowNodes(analysis: SourceProjectAnalysis, nodes: GraphNode[], projectId: string): GraphNode[] {
  const result: GraphNode[] = [];
  const traces = unique(analysis.moduleDossiers?.flatMap((module) => module.flowTraces) ?? []);
  for (const [index, trace] of traces.slice(0, 64).entries()) {
    result.push(
      pushNode(nodes, {
        id: `${projectId}.flow.${index + 1}`,
        type: 'Flow',
        name: trace,
        description: trace,
        status: 'draft',
        sourceRef: `${analysis.projectRoot}#flow:${index + 1}`,
        version: '1.0.0',
      }),
    );
  }
  return result;
}

function buildWebConcernNodes(analysis: SourceProjectAnalysis, nodes: GraphNode[], projectId: string): GraphNode[] {
  const result: GraphNode[] = [];
  for (const [index, name] of collectValidationBoundaryNames(analysis).entries()) {
    result.push(pushNode(nodes, {
      id: `${projectId}.web.validation.${index + 1}`,
      type: 'ValidationBoundary',
      name,
      description: `HTTP request validation boundary inferred from ${name}`,
      status: 'draft',
      sourceRef: `${analysis.projectRoot}#web-validation:${slug(name)}`,
      version: '1.0.0',
    }));
  }
  for (const [index, name] of collectExceptionHandlerNames(analysis).entries()) {
    result.push(pushNode(nodes, {
      id: `${projectId}.web.error.${index + 1}`,
      type: 'ExceptionHandler',
      name,
      description: `Global exception handling component inferred from ${name}`,
      status: 'draft',
      sourceRef: `${analysis.projectRoot}#web-error:${slug(name)}`,
      version: '1.0.0',
    }));
  }
  for (const [index, name] of collectWebConfigurationNames(analysis).entries()) {
    result.push(pushNode(nodes, {
      id: `${projectId}.web.config.${index + 1}`,
      type: 'WebConfiguration',
      name,
      description: `Web configuration component inferred from ${name}`,
      status: 'draft',
      sourceRef: `${analysis.projectRoot}#web-config:${slug(name)}`,
      version: '1.0.0',
    }));
  }
  for (const [index, name] of collectWebSecurityBoundaryNames(analysis).entries()) {
    result.push(pushNode(nodes, {
      id: `${projectId}.web.security.${index + 1}`,
      type: 'SecurityBoundary',
      name,
      description: `Web security boundary inferred from ${name}`,
      status: 'draft',
      sourceRef: `${analysis.projectRoot}#web-security:${slug(name)}`,
      version: '1.0.0',
    }));
  }
  return result;
}

function linkWebConcernNodes(
  analysis: SourceProjectAnalysis,
  webConcernNodes: GraphNode[],
  types: GraphNode[],
  endpointFamilies: GraphNode[],
  edges: GraphEdge[],
): void {
  const controllerNodes = types.filter((node) => String(node.kind).toLowerCase() === 'controller');
  for (const concernNode of webConcernNodes) {
    const concernType = String(concernNode.type);
    if (concernType === 'ValidationBoundary') {
      for (const endpointFamily of endpointFamilies) {
        pushEdge(edges, concernNode.id, endpointFamily.id, 'validates');
      }
      for (const controllerNode of controllerNodes.slice(0, 32)) {
        pushEdge(edges, concernNode.id, controllerNode.id, 'guards');
      }
      continue;
    }
    if (concernType === 'ExceptionHandler') {
      for (const controllerNode of controllerNodes.slice(0, 32)) {
        pushEdge(edges, concernNode.id, controllerNode.id, 'handlesErrorsFor');
      }
      continue;
    }
    if (concernType === 'WebConfiguration') {
      for (const controllerNode of controllerNodes.slice(0, 32)) {
        pushEdge(edges, concernNode.id, controllerNode.id, 'configures');
      }
      continue;
    }
    if (concernType === 'SecurityBoundary') {
      for (const controllerNode of controllerNodes.slice(0, 32)) {
        pushEdge(edges, concernNode.id, controllerNode.id, 'protects');
      }
    }
  }
}

function linkModulesToTypes(analysis: SourceProjectAnalysis, modules: GraphNode[], types: GraphNode[], edges: GraphEdge[]): void {
  const moduleRoots = analysis.modules.length ? analysis.modules : ['.'];
  for (const typeNode of types) {
    const sourceFile = String(typeNode.sourceRef ?? '');
    const typeFile = sourceFile.startsWith('file://') ? sourceFile.slice('file://'.length).split('#')[0] : '';
    const matchedModule = moduleRoots.find((moduleRoot) => matchesModule(typeFile, analysis.projectRoot, moduleRoot));
    if (matchedModule) {
      const moduleNode = modules[moduleRoots.indexOf(matchedModule)];
      if (moduleNode) {
        pushEdge(edges, moduleNode.id, typeNode.id, 'contains');
      }
    }
  }
}

function linkPackagesToTypes(packages: GraphNode[], types: GraphNode[], edges: GraphEdge[]): void {
  for (const typeNode of types) {
    const packageName = String(typeNode.packageName ?? '');
    const matchedPackage = packages.find((packageNode) => packageName.startsWith(packageNode.name));
    if (matchedPackage) {
      pushEdge(edges, matchedPackage.id, typeNode.id, 'contains');
    }
  }
}

function linkEndpointsToTypes(
  analysis: SourceProjectAnalysis,
  endpointFamilies: GraphNode[],
  endpoints: GraphNode[],
  types: GraphNode[],
  edges: GraphEdge[],
): void {
  for (const endpointNode of endpoints) {
    const endpointText = String(endpointNode.name).toLowerCase();
    const matchedType = types.find((typeNode) => {
      const typeName = String(typeNode.name).toLowerCase();
      const source = String(typeNode.sourceRef ?? '');
      return endpointText.includes(typeName) || source.includes(typeName);
    });
    if (matchedType) {
      pushEdge(edges, matchedType.id, endpointNode.id, 'exposes');
    }
    const family = endpointFamilies.find((entry) => endpointText.startsWith(entry.name.toLowerCase()));
    if (family) {
      pushEdge(edges, family.id, endpointNode.id, 'contains');
    }
  }
}

function linkTypesToPersistence(
  analysis: SourceProjectAnalysis,
  types: GraphNode[],
  persistenceNodes: GraphNode[],
  schemaNodes: GraphNode[],
  edges: GraphEdge[],
): void {
  for (const typeNode of types) {
    const typeName = String(typeNode.name).toLowerCase();
    const kind = String(typeNode.kind ?? '').toLowerCase();
    for (const persistenceNode of persistenceNodes) {
      const persistenceName = persistenceNode.name.toLowerCase();
      if (typeName.includes(persistenceName) || persistenceName.includes(typeName) || /entity|repository|persistence/.test(kind)) {
        pushEdge(edges, typeNode.id, persistenceNode.id, 'persistsTo');
      }
    }
    for (const schemaNode of schemaNodes) {
      const schemaName = schemaNode.name.toLowerCase();
      if (typeName.includes(schemaName) || schemaName.includes(typeName) || /entity/.test(kind)) {
        pushEdge(edges, typeNode.id, schemaNode.id, 'mapsTo');
      }
    }
  }
}

function linkTypesToExternalSystems(analysis: SourceProjectAnalysis, types: GraphNode[], externalNodes: GraphNode[], edges: GraphEdge[]): void {
  for (const typeNode of types) {
    const typeText = `${typeNode.name} ${typeNode.description}`.toLowerCase();
    for (const externalNode of externalNodes) {
      const externalText = externalNode.name.toLowerCase();
      if (
        typeText.includes(externalText) ||
        (externalText.includes('redis') && /redis/.test(typeText)) ||
        (externalText.includes('mail') && /mail|smtp|email/.test(typeText)) ||
        (externalText.includes('object storage') && /s3|minio|storage/.test(typeText)) ||
        (externalText.includes('kafka') && /kafka|listener|event/.test(typeText))
      ) {
        pushEdge(edges, typeNode.id, externalNode.id, 'uses');
      }
    }
  }
}

function linkFlowNodes(
  analysis: SourceProjectAnalysis,
  flowNodes: GraphNode[],
  types: GraphNode[],
  persistenceNodes: GraphNode[],
  externalNodes: GraphNode[],
  edges: GraphEdge[],
): void {
  for (const [index, flowNode] of flowNodes.entries()) {
    const controller = types.find((node) => String(node.kind).toLowerCase() === 'controller');
    const service = types.find((node) => String(node.kind).toLowerCase() === 'service');
    const repository = types.find((node) => String(node.kind).toLowerCase() === 'repository');
    const persistence = persistenceNodes[index % Math.max(persistenceNodes.length, 1)];
    const external = externalNodes[index % Math.max(externalNodes.length, 1)];
    if (controller) pushEdge(edges, controller.id, flowNode.id, 'starts');
    if (service) pushEdge(edges, flowNode.id, service.id, 'routesTo');
    if (repository) pushEdge(edges, service?.id ?? flowNode.id, repository.id, 'uses');
    if (persistence) pushEdge(edges, repository?.id ?? flowNode.id, persistence.id, 'writesTo');
    if (external) pushEdge(edges, service?.id ?? flowNode.id, external.id, 'uses');
  }
}

function groupEndpointFamilies(endpoints: JavaEndpointSummary[]): Array<{ family: string; count: number; samples: string[] }> {
  const grouped = new Map<string, JavaEndpointSummary[]>();
  for (const endpoint of endpoints) {
    const family = classifyEndpointFamily(endpoint.path);
    const entries = grouped.get(family) ?? [];
    entries.push(endpoint);
    grouped.set(family, entries);
  }

  return [...grouped.entries()]
    .map(([family, entries]) => ({
      family,
      count: entries.length,
      samples: unique(entries.slice(0, 3).map((entry) => `${entry.method} ${entry.path}`)),
    }))
    .sort((left, right) => right.count - left.count || left.family.localeCompare(right.family));
}

function classifyEndpointFamily(pathValue: string): string {
  const cleaned = pathValue.split('?')[0].replace(/\/+/g, '/').replace(/^\/+/, '');
  if (!cleaned) {
    return '/';
  }
  const parts = cleaned.split('/').filter(Boolean);
  const filtered = parts.filter((part) => !/^(api|rest|web|public|internal|v\d+)$/i.test(part));
  const first = filtered[0] ?? parts[0] ?? cleaned;
  return `/${first}`;
}

function collectExternalSystems(analysis: SourceProjectAnalysis): string[] {
  const items = new Set<string>(analysis.appRuntime.externalDependencies ?? []);
  if (analysis.counts.websocketHandlers > 0) items.add('WebSocket');
  if (
    analysis.javaCatalog.some((item) => item.integrationHints.some((hint) => /feignclient|http client|rest client/i.test(hint)))
  ) items.add('External HTTP client');
  if (
    analysis.technologies.some((item) => /kafka|rabbit|nsq|mqtt/i.test(item)) ||
    analysis.appRuntime.externalDependencies.some((item) => /message broker/i.test(item))
  ) items.add('Message broker / event stream');
  return [...items];
}

function collectPersistenceTargets(analysis: SourceProjectAnalysis): string[] {
  const items = new Set<string>();
  if (analysis.technologies.some((item) => /postgres|postgresql/i.test(item))) items.add('PostgreSQL');
  if (analysis.technologies.some((item) => /mysql/i.test(item))) items.add('MySQL');
  if (analysis.technologies.some((item) => /oracle/i.test(item))) items.add('Oracle');
  if (analysis.technologies.some((item) => /redis/i.test(item))) items.add('Redis cache / data store');
  if (analysis.technologies.some((item) => /minio|s3/i.test(item))) items.add('Object storage');
  if (analysis.counts.sqlFiles > 0) items.add(`SQL migrations (${analysis.counts.sqlFiles})`);
  for (const hint of analysis.schemaHints.slice(0, 8)) {
    const tableName = hint.tableName ?? hint.typeName ?? basename(hint.file);
    items.add(`table ${tableName}`);
  }
  return [...items];
}

function collectIntegrationInterfaces(analysis: SourceProjectAnalysis): string[] {
  return unique([
    ...collectExternalSystems(analysis),
    ...(analysis.technologies.some((item) => /oauth|oidc/i.test(item)) ? ['OAuth / external identity client'] : []),
    ...(analysis.javaCatalog.some((item) => item.integrationHints.some((hint) => /feignclient|http client|rest client/i.test(hint))) ? ['external HTTP adapter'] : []),
  ]);
}

function collectValidationBoundaryNames(analysis: SourceProjectAnalysis): string[] {
  const result: string[] = [];
  for (const astFile of analysis.javaAstCatalog ?? []) {
    const packageName = astFile.packageName ?? '';
    const file = astFile.file;
    const isWebFacing = /\/api\//i.test(file) || /\/web\/controller\//i.test(file) || /\.api(?:\.|$)/i.test(packageName);
    if (!isWebFacing) continue;
    for (const type of astFile.types) {
      const hasValidated = type.annotations.some((annotation) => /Validated/i.test(annotation));
      const hasMethodValidation = type.methods.some((method) => method.annotations.some((annotation) => /Valid/i.test(annotation)));
      if (hasValidated || hasMethodValidation) {
        result.push(type.name);
      }
    }
  }
  return unique(result);
}

function collectAppRuntimeItems(analysis: SourceProjectAnalysis): string[] {
  const items = new Set<string>();
  if (analysis.appRuntime.applicationEntryPoint) items.add(`entry point: ${analysis.appRuntime.applicationEntryPoint}`);
  if (analysis.appRuntime.bootstrapClass) items.add(`bootstrap: ${analysis.appRuntime.bootstrapClass}`);
  for (const config of analysis.appRuntime.importedConfigFiles.slice(0, 8)) {
    items.add(`config: ${config.name} (${config.purpose})`);
  }
  for (const bean of analysis.appRuntime.configurationBeans.slice(0, 8)) {
    items.add(`bean: ${bean.name} (${bean.purpose})`);
  }
  for (const securityConfig of analysis.appRuntime.securityConfigurations.slice(0, 8)) {
    items.add(`security config: ${securityConfig}`);
  }
  for (const feature of analysis.appRuntime.runtimeFeatures.slice(0, 8)) {
    items.add(`runtime: ${feature}`);
  }
  return [...items];
}

function collectExceptionHandlerNames(analysis: SourceProjectAnalysis): string[] {
  const result: string[] = [];
  for (const astFile of analysis.javaAstCatalog ?? []) {
    const inErrorHandlerPackage = /\/errorhandler\//i.test(astFile.file) || /\.errorhandler(?:\.|$)/i.test(astFile.packageName ?? '');
    for (const type of astFile.types) {
      const hasAdvice = type.annotations.some((annotation) => /RestControllerAdvice|ControllerAdvice/i.test(annotation));
      const hasExceptionHandler = type.methods.some((method) => method.annotations.some((annotation) => /ExceptionHandler/i.test(annotation)));
      if ((hasAdvice || hasExceptionHandler || inErrorHandlerPackage) && /Handler|Advice/i.test(type.name)) {
        result.push(type.name);
      }
    }
  }
  return unique(result);
}

function collectWebConfigurationNames(analysis: SourceProjectAnalysis): string[] {
  const result: string[] = [];
  for (const astFile of analysis.javaAstCatalog ?? []) {
    const packageName = astFile.packageName ?? '';
    for (const type of astFile.types) {
      const isWebConfig = /\/web\/config\//i.test(astFile.file)
        || /\.web\.config(?:\.|$)/i.test(packageName)
        || (type.annotations.some((annotation) => /Configuration/i.test(annotation)) && /cors/i.test(`${type.name} ${astFile.file}`));
      if (isWebConfig) {
        result.push(type.name);
      }
    }
  }
  return unique(result);
}

function collectWebSecurityBoundaryNames(analysis: SourceProjectAnalysis): string[] {
  const result: string[] = [];
  for (const astFile of analysis.javaAstCatalog ?? []) {
    const packageName = astFile.packageName ?? '';
    for (const type of astFile.types) {
      const inSecurityPackage = /\/common\/src\/main\/java\/.*\/security\//i.test(astFile.file)
        || /\/security\//i.test(astFile.file)
        || /\.security(?:\.|$)/i.test(packageName);
      const namedWebSecurityType = /SecurityConfig|JwtDecoderConfig|JwtValidator|JwtIssuer|JwtKeyConfig|AuthProps/i.test(type.name);
      const isSecurityBoundary = namedWebSecurityType
        || (inSecurityPackage && (type.annotations.some((annotation) => /EnableWebSecurity|Configuration/i.test(annotation)) || /Jwt|Token|Security|Bearer|Auth/i.test(type.name)));
      if (isSecurityBoundary) {
        result.push(type.name);
      }
    }
  }
  return unique(result);
}

function collectSchemaTables(analysis: SourceProjectAnalysis): Array<{ name: string; columns: string[]; primaryKey?: string[] }> {
  const tables: Array<{ name: string; columns: string[]; primaryKey?: string[] }> = [];
  for (const hint of analysis.schemaHints.slice(0, 32)) {
    tables.push({
      name: hint.tableName ?? hint.typeName ?? basename(hint.file),
      columns: hint.fields?.map((field) => field.name) ?? hint.columns,
      primaryKey: hint.primaryKey,
    });
  }
  for (const sqlFile of analysis.sqlCatalog.slice(0, 32)) {
    for (const table of sqlFile.tables) {
      tables.push({
        name: table.name,
        columns: table.columns.map((column) => column.name),
        primaryKey: table.primaryKey,
      });
    }
  }
  return uniqueBy(tables, (item) => item.name);
}

function collectKinds(analysis: SourceProjectAnalysis, kind: JavaArtifactSummary['kind']): string[] {
  const astKinds = collectAstKinds(analysis, kind);
  if (astKinds.length > 0) {
    return astKinds;
  }
  return unique(
    analysis.javaCatalog
      .filter((item) => item.kind === kind)
      .map((item) => item.typeName ?? basename(item.file)),
  );
}

function countTypes(catalog: JavaArtifactSummary[]): Record<string, number> {
  // Keep the existing shape for compatibility, but the graph nodes are AST-driven.
  const counts = new Map<string, number>();
  for (const item of catalog) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return {
    ...Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    total: catalog.length,
  };
}

function collectAstKinds(analysis: SourceProjectAnalysis, kind: JavaArtifactSummary['kind']): string[] {
  const astFiles = analysis.javaAstCatalog ?? [];
  if (!astFiles.length) {
    return [];
  }
  const result: string[] = [];
  for (const astFile of astFiles) {
    for (const type of astFile.types) {
      if (classifyJavaAstKind(type, astFile.file) === kind) {
        result.push(type.name);
      }
    }
  }
  return unique(result);
}

function describeJavaArtifact(item: JavaArtifactSummary): string {
  const parts = [
    item.packageName ? `package: ${item.packageName}` : undefined,
    item.annotations.length ? `annotations: ${item.annotations.join(', ')}` : undefined,
    item.endpoints.length ? `endpoints: ${item.endpoints.join(', ')}` : undefined,
    item.persistenceHints.length ? `persistence: ${item.persistenceHints.join(', ')}` : undefined,
    item.securityHints.length ? `security: ${item.securityHints.join(', ')}` : undefined,
    item.integrationHints.length ? `integration: ${item.integrationHints.join(', ')}` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(' | ') : item.kind;
}

function mapJavaKind(kind: string): string {
  switch (kind) {
    case 'controller':
      return 'Controller';
    case 'service':
      return 'Service';
    case 'repository':
      return 'Repository';
    case 'entity':
      return 'Entity';
    case 'configuration':
      return 'Configuration';
    case 'job':
      return 'Job';
    case 'listener':
      return 'Listener';
    case 'security':
      return 'SecurityComponent';
    case 'websocket':
      return 'WebSocketComponent';
    default:
      return 'JavaType';
  }
}

function matchesModule(filePath: string, projectRoot: string, moduleRoot: string): boolean {
  const normalized = relativePath(filePath, projectRoot);
  const modulePath = moduleRoot === '.' ? '' : moduleRoot.replace(/\/+$/g, '');
  if (!modulePath) return !normalized.includes('/');
  return normalized === modulePath || normalized.startsWith(`${modulePath}/`);
}

function relativePath(file: string, root: string): string {
  const relativeValue = file.startsWith(root) ? file.slice(root.length).replace(/^\/+/, '') : file;
  return relativeValue.replace(/\\/g, '/');
}

function basename(value: string): string {
  return value.split(/[\\/]/).pop() ?? value;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'item';
}

function pushNode(nodes: GraphNode[], node: GraphNode): GraphNode {
  nodes.push(node);
  return node;
}

function pushEdge(edges: GraphEdge[], from: string, to: string, type: string): void {
  edges.push({ from, to, type });
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items.filter(Boolean))];
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
