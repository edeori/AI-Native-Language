import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { DatabaseSchema } from './models.js';
import { parseSemanticMarkdown } from './semantic-markdown.js';
import { generateCanonicalGraph } from './graph.js';
import { generateDatabaseSchema } from './database-schema.js';
import { buildCodeKnowledgeGraph, renderCodeKnowledgeGraphMarkdown, type CodeKnowledgeGraph } from './code-graph.js';
import { parseJavaSourceFile, type JavaAstFile, type JavaAstType } from './java-ast.js';
import {
  readLocalAgentOutputs,
  runLocalAgentRole,
  runLocalEnrichment,
  runLocalDiscoveryPrompt,
  type LocalAgentOutput,
  type EnrichmentOutput,
} from './enrichment.js';
import { type JqassistantArtifact } from './jqassistant.js';

export interface SourceLearningImportOptions {
  projectRoot: string;
  projectName: string;
  outputDir: string;
  force?: boolean;
  resumeFromStage?: 'ast' | 'analysis' | 'snapshot' | 'graph' | 'prompt' | 'modules' | 'semantic';
  javaAstCatalog?: JavaAstFile[];
  jqassistantArtifact?: JqassistantArtifact;
  onAnalysisProgress?: (event: {
    phase: 'files' | 'java' | 'packages' | 'sql';
    message: string;
    currentFile?: string;
    completed?: number;
    total?: number;
  }) => void | Promise<void>;
  onLifecycleProgress?: (event: { phase: 'analysis' | 'snapshot' | 'graph' | 'enrichment' | 'artifacts' | 'complete'; message: string }) => void | Promise<void>;
  onCodeGraphProgress?: (event: { phase: string; message: string }) => void;
}

export interface SourceLearningResult {
  projectName: string;
  projectRoot: string;
  outputDir: string;
  astPath: string;
  astIndexPath: string;
  previewPath: string;
  componentMapPath: string;
  flowMapPath: string;
  jqassistantSupportPath: string;
  supportGraphPath: string;
  graphVerificationPath: string;
  graphVerificationSlicesPath: string;
  aiGraphPath: string;
  layerGraphsPath: string;
  enrichmentPath: string;
  enrichmentSchemaPath: string;
  reviewDossierPath: string;
  reconnaissancePath: string;
  reconnaissancePromptPath: string;
  reconnaissancePromptWritten: boolean;
  semanticJsonPath: string;
  jqassistantPath: string;
  databaseSchemaPath: string;
  databaseSchemaMdPath: string;
  codeKnowledgeGraphPath: string;
  codeKnowledgeGraphMdPath: string;
  analysisPath: string;
  analysisMdPath: string;
  snapshotPath: string;
  suggestedSemanticPath: string;
  semanticPath: string;
  graphPath: string;
  statePath: string;
  readmePath: string;
  createdSemantic: boolean;
  analysis: SourceProjectAnalysis;
  snapshot: SourceProjectSnapshot;
  codeKnowledgeGraph: CodeKnowledgeGraph;
  graph: ReturnType<typeof generateCanonicalGraph>;
  enrichment?: EnrichmentOutput;
  jqassistant?: JqassistantArtifact;
  localAgents?: LocalAgentOutput[];
}

export interface SourceProjectAnalysis {
  projectName: string;
  projectRoot: string;
  modules: string[];
  moduleDossiers?: ModuleDossier[];
  javaAstCatalog: JavaAstFile[];
  javaCatalog: JavaArtifactSummary[];
  endpointCatalog: JavaEndpointSummary[];
  apiSurface: ApiSurfaceSummary;
  appRuntime: AppRuntimeSummary;
  repositoryStructure: RepositoryStructureSummary;
  applicationLayouts: ApplicationLayoutSummary[];
  commonSummary: CommonSummary;
  persistenceSummary: PersistenceSummary;
  serviceSummary: ServiceSummary;
  flowSummary: FlowSummary;
  schemaHints: SchemaHint[];
  sqlCatalog: SqlArtifactSummary[];
  resourceFiles: {
    sql: string[];
    migrations: string[];
    markdown: string[];
    yaml: string[];
  };
  counts: {
    pomFiles: number;
    javaFiles: number;
    yamlFiles: number;
    sqlFiles: number;
    markdownFiles: number;
    controllers: number;
    services: number;
    repositories: number;
    entities: number;
    policies: number;
    configs: number;
    jobs: number;
    listeners: number;
    securityClasses: number;
    scheduledJobs: number;
    websocketHandlers: number;
  };
  layers: {
    api: number;
    web: number;
    service: number;
    persistence: number;
    common: number;
    app: number;
    notification: number;
  };
  technologies: string[];
  roles: Record<string, string[]>;
  keyPaths: {
    applicationYaml?: string;
    securityYaml?: string;
    openApiYaml?: string;
    readme?: string;
  };
  observations: string[];
  packageMap: Record<string, number>;
  databaseSchemaDraft?: DatabaseSchema;
  codeKnowledgeGraph?: CodeKnowledgeGraph;
  jqassistant?: JqassistantArtifact;
  reconnaissancePrompt?: string;
  signals: {
    controllers: string[];
    services: string[];
    repositories: string[];
    entities: string[];
    policies: string[];
    configs: string[];
    jobs: string[];
    listeners: string[];
    security: string[];
    scheduled: string[];
    websocket: string[];
    events: string[];
  };
}

export interface CommonSummary {
  crossCuttingComponents: Array<{ name: string; role: string }>;
  utilityComponents: string[];
  stateCarrierComponents: string[];
  securityComponents: string[];
  securityDetails: string[];
  eventTypes: Array<{ name: string; purpose: string }>;
  eventFlow?: {
    publisher: string;
    transport: string;
    channel: string;
    producerCallers: string[];
    subscriber: string;
    subscriberEffects: string[];
  };
}

export interface FlowSummary {
  triggers: Array<{
    kind: 'http-api' | 'scheduler' | 'event-listener' | 'message-stream' | 'external-callback';
    name: string;
    source: string;
    target: string;
    notes: string[];
  }>;
  flows: Array<{
    name: string;
    trigger: string;
    summary: string;
    steps: string[];
  }>;
}

export interface FlowMapEvidence {
  kind: 'ast' | 'endpoint' | 'service-summary' | 'graph-node' | 'graph-edge' | 'local-candidate' | 'schedule' | 'listener' | 'resource' | 'inference';
  ref: string;
  detail: string;
}

export interface FlowMapEntrypoint {
  entrypointId: string;
  applicationId: string;
  kind:
    | 'rest-endpoint'
    | 'soap-endpoint'
    | 'scheduler'
    | 'quartz-job'
    | 'spring-scheduled'
    | 'kafka-listener'
    | 'jms-listener'
    | 'mdb-listener'
    | 'rabbit-listener'
    | 'batch-job'
    | 'cli-command'
    | 'startup-runner'
    | 'webhook-endpoint'
    | 'callback-endpoint'
    | 'event-handler';
  name: string;
  trigger: string;
  target: string;
  sourceRef: string;
  nodeHints: string[];
  notes: string[];
  evidence: FlowMapEvidence[];
}

export interface FlowTraceStep {
  nodeId?: string;
  nodeName: string;
  role: 'entrypoint' | 'controller' | 'service' | 'validator' | 'repository' | 'external-client' | 'event-publisher' | 'mapper' | 'listener' | 'scheduler' | 'database' | 'helper';
  sourceRef?: string;
  evidence: FlowMapEvidence[];
}

export interface FlowTraceRecord {
  traceId: string;
  entrypointId: string;
  applicationId: string;
  flowType: 'api' | 'event' | 'scheduled' | 'batch' | 'integration' | 'internal';
  steps: FlowTraceStep[];
  primaryService?: string;
  collaboratorNames: string[];
  warnings: string[];
  evidence: FlowMapEvidence[];
}

export interface FlowClusterRecord {
  clusterId: string;
  applicationId: string;
  flowType: 'api' | 'event' | 'scheduled' | 'batch' | 'integration' | 'internal';
  name: string;
  entrypointIds: string[];
  traceIds: string[];
  sharedHelpers: string[];
  evidence: FlowMapEvidence[];
}

export interface SemanticFlowRecord {
  flowId: string;
  applicationId: string;
  name: string;
  flowType: 'api' | 'event' | 'scheduled' | 'batch' | 'integration' | 'internal';
  trigger: string;
  actor: string;
  businessMeaning: string;
  technicalPath: Array<{ nodeId?: string; nodeName: string; role: FlowTraceStep['role'] }>;
  outcome: string;
  confidence: number;
  evidence: FlowMapEvidence[];
  warnings: string[];
  candidateInterpretations?: Array<Record<string, unknown>>;
}

export interface FlowValidationRecord {
  flowId?: string;
  traceId?: string;
  severity: 'info' | 'warning' | 'error';
  category: 'missing-node' | 'broken-edge' | 'low-evidence' | 'mixed-flow' | 'utility-noise' | 'semantic-contradiction';
  message: string;
  evidence: FlowMapEvidence[];
}

export interface PersistenceSummary {
  moduleRole: string;
  repositoryStyles: Array<{
    style: 'jpa' | 'jdbc';
    repositories: string[];
    rationale: string;
  }>;
  repositories: Array<{
    name: string;
    style: 'jpa' | 'jdbc';
    purpose: string;
    operationGroups: string[];
    notableOperation?: string;
    mapperNames: string[];
    entityNames: string[];
  }>;
  entityNames: string[];
  mapperSummary: {
    abstractBase?: string;
    abstractBaseNotes: string[];
    rowMappers: string[];
    dtoMappers: string[];
    notes: string[];
  };
}

export interface ServiceSummary {
  moduleRole: string;
  clientImplementations: Array<{ name: string; purpose: string; issue?: string }>;
  misplacedDtos: Array<{ name: string; purpose: string; issue: string }>;
  serviceEvents: Array<{ name: string; purpose: string; issue?: string }>;
  exceptionTypes: Array<{ name: string; purpose: string; thrownBy: string[] }>;
  serviceInterfaces: Array<{ name: string; purpose: string; issue?: string }>;
  executionServices: Array<{
    name: string;
    purpose: string;
    operations: Array<{
      name: string;
      purpose: string;
      input?: string;
      collaborators: string[];
      sideEffects: string[];
      annotations: string[];
    }>;
    dependencies: string[];
  }>;
  mailCapabilities: {
    config: string[];
    templates: Array<{ name: string; purpose: string; personalization: string[] }>;
    operations: Array<{ name: string; purpose: string; flow: string; issue?: string }>;
  };
  storageCapabilities: {
    summary: string[];
    uploads: Array<{ name: string; purpose: string; targets: string[] }>;
  };
  schedulingModel: string[];
  scheduledJobs: Array<{
    name: string;
    schedule: string;
    executionModel: string;
    purpose: string;
    effects: string[];
  }>;
  asyncListeners: Array<{
    name: string;
    purpose: string;
    triggers: Array<{ event: string; source: string; effect: string }>;
  }>;
  violations: string[];
}

export interface RepositoryStructureSummary {
  multiModuleMaven: boolean;
  topLevelProjects: Array<{ name: string; role: string }>;
  backendAggregator?: string;
  backendSupportModules: Array<{ name: string; role: string }>;
  backendRuntimeLayers: Array<{ name: string; role: string }>;
  technicalBenefits: string[];
}

export interface ApplicationLayoutSummary {
  appRoot: string;
  role: string;
  multiModule: boolean;
  moduleRoots: string[];
  internalModules: Array<{
    name: string;
    purpose: string;
    source: 'maven' | 'deterministic' | 'local-ai';
    pathHints: string[];
  }>;
}

export interface AppRuntimeSummary {
  applicationEntryPoint?: string;
  bootstrapClass?: string;
  importedConfigFiles: Array<{ name: string; purpose: string }>;
  configurationBeans: Array<{ name: string; purpose: string }>;
  securityConfigurations: string[];
  runtimeFeatures: string[];
  externalDependencies: string[];
}

function collectApplicationInterfaceItems(repositoryStructure: RepositoryStructureSummary): string[] {
  return repositoryStructure.topLevelProjects.map((item) => {
    const scopeNote = item.name === 'event-notification'
      ? 'separate application boundary; detail independently from event-backend'
      : 'primary backend application boundary in this repository';
    return `APPLICATION: ${item.name} — ${item.role}; ${scopeNote}`;
  });
}

export interface ApiSurfaceSummary {
  contractSource: 'openapi-generated' | 'java-contracts' | 'unknown';
  openApiYamlPath?: string;
  swaggerConfigPresent: boolean;
  generatedContracts: boolean;
  validationEnabled: boolean;
  clientImplementations: Array<{ name: string; purpose: string }>;
  enumTypes: Array<{ name: string; purpose: string }>;
  families: ApiFamilySummary[];
}

export interface ApiFamilySummary {
  family: string;
  endpointCount: number;
  endpointSamples: string[];
  authMode: 'public' | 'protected' | 'mixed';
  securitySchemes: string[];
  permissionHints: string[];
  dtoTypes: string[];
  enumTypes: string[];
  hasValidation: boolean;
  hasSwagger: boolean;
}

export interface ModuleDossier {
  moduleRoot: string;
  packageRoots: string[];
  prompt: string;
  componentSummary: {
    controllers: number;
    services: number;
    repositories: number;
    entities: number;
    configs: number;
    jobs: number;
    listeners: number;
    security: number;
    endpoints: number;
    sqlFiles: number;
    schemaHints: number;
  };
  interfaceCatalog: {
    http: string[];
    integration: string[];
    internal: string[];
    persistence: string[];
  };
  flowTraces: string[];
  persistenceNotes: string[];
  observations: string[];
}

export interface JavaArtifactSummary {
  file: string;
  packageName?: string;
  typeName?: string;
  kind: string;
  annotations: string[];
  endpoints: string[];
  persistenceHints: string[];
  securityHints: string[];
  integrationHints: string[];
}

interface JavaSignalBundle {
  javaAstCatalog: JavaAstFile[];
  controllers: string[];
  services: string[];
  repositories: string[];
  entities: string[];
  policies: string[];
  configs: string[];
  jobs: string[];
  listeners: string[];
  security: string[];
  scheduled: string[];
  websocket: string[];
  events: string[];
  catalog: JavaArtifactSummary[];
  endpoints: JavaEndpointSummary[];
  schemaHints: SchemaHint[];
}

export interface JavaEndpointSummary {
  file: string;
  typeName?: string;
  method: string;
  path: string;
  source: string;
}

export interface SchemaHint {
  file: string;
  typeName?: string;
  tableName?: string;
  columns: string[];
  relationships: string[];
  annotations: string[];
  primaryKey?: string[];
  fields?: Array<{
    name: string;
    type?: string;
    annotations: string[];
    detail?: string;
    nullable?: boolean;
    relation?: string;
  }>;
  sourceKind?: 'entity' | 'sql' | 'fallback';
}

export interface SqlArtifactSummary {
  file: string;
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type?: string;
      detail?: string;
      nullable?: boolean;
    }>;
    primaryKey?: string[];
    foreignKeys: Array<{
      column: string;
      targetTable?: string;
      targetColumn?: string;
    }>;
  }>;
}

export interface SourceProjectSnapshot {
  projectRoot: string;
  topLevelDirectories: string[];
  topLevelFiles: string[];
  moduleRoots: string[];
  moduleDossiers?: ModuleDossier[];
  packageMap: Record<string, number>;
  javaAstCatalog: JavaAstFile[];
  javaCatalog: JavaArtifactSummary[];
  endpointCatalog: JavaEndpointSummary[];
  schemaHints: SchemaHint[];
  sqlCatalog: SqlArtifactSummary[];
  counts: SourceProjectAnalysis['counts'];
  layers: SourceProjectAnalysis['layers'];
}

export interface DeterministicGraphArtifacts {
  astIndex: AstIndexArtifact;
  jqassistantSupport: JqassistantSupportArtifact;
  codeKnowledgeGraph: CodeKnowledgeGraph;
  supportGraph: SupportGraphArtifact;
  graphVerification: GraphVerificationArtifact;
  graphVerificationSlices: GraphVerificationSlicesArtifact;
  layerGraphs: LayerGraphsArtifact;
  preview: ReturnType<typeof buildGraphPreviewMetadata>;
  componentMap: Record<string, unknown>;
  flowMap: Record<string, unknown>;
}

export async function buildDeterministicGraphArtifacts(
  analysis: SourceProjectAnalysis,
  snapshot: SourceProjectSnapshot,
  jqassistantArtifact?: JqassistantArtifact,
  prebuiltCodeKnowledgeGraph?: CodeKnowledgeGraph,
  onCodeGraphProgress?: (event: { phase: string; message: string }) => void | Promise<void>,
): Promise<DeterministicGraphArtifacts> {
  const effectiveJqassistant = jqassistantArtifact ?? analysis.jqassistant ?? buildSkippedJqassistantArtifact(analysis.projectName, analysis.projectRoot, analysis);
  analysis.jqassistant = effectiveJqassistant;
  applyJqassistantEvidence(analysis, effectiveJqassistant);

  const codeKnowledgeGraph = prebuiltCodeKnowledgeGraph ?? await buildCodeKnowledgeGraph(analysis, snapshot, onCodeGraphProgress);
  const astIndex = buildAstIndexArtifact(analysis);
  const jqassistantSupport = buildJqassistantSupportArtifact(analysis, effectiveJqassistant);
  const supportGraph = buildSupportGraphArtifact(analysis, codeKnowledgeGraph);
  const graphVerification = buildGraphVerificationArtifact(analysis, codeKnowledgeGraph);
  const graphVerificationSlices = buildGraphVerificationSlicesArtifact(analysis, graphVerification);
  const layerGraphs = buildLayerGraphsArtifact(supportGraph);
  const preview = buildGraphPreviewMetadata(analysis, codeKnowledgeGraph, astIndex, jqassistantSupport, supportGraph, graphVerification);
  const componentMap = buildComponentMapArtifact(analysis, preview, supportGraph, astIndex, jqassistantSupport);
  const flowMap = buildFlowMapArtifact(analysis, codeKnowledgeGraph, astIndex, jqassistantSupport, supportGraph);

  return {
    astIndex,
    jqassistantSupport,
    codeKnowledgeGraph,
    supportGraph,
    graphVerification,
    graphVerificationSlices,
    layerGraphs,
    preview,
    componentMap,
    flowMap,
  };
}

export interface AstIndexArtifact {
  schemaVersion: '1.0';
  generatedAt: string;
  projectName: string;
  projectRoot: string;
  summary: {
    javaFileCount: number;
    packageCount: number;
    typeCount: number;
    methodCount: number;
    fieldCount: number;
    endpointCount: number;
    annotationCount: number;
  };
  packages: Array<{
    packageName: string;
    fileCount: number;
    typeCount: number;
    topImports: string[];
  }>;
  types: Array<{
    id: string;
    name: string;
    kind: JavaAstType['kind'];
    packageName?: string;
    file: string;
    applicationHint?: string;
    layerHint?: string;
    annotations: string[];
    imports: string[];
    fields: string[];
    methods: Array<{
      name: string;
      returnType: string;
      annotations: string[];
      parameters: Array<{ name: string; type: string }>;
    }>;
  }>;
  endpoints: Array<{
    id: string;
    method: string;
    path: string;
    typeName?: string;
    file: string;
  }>;
  annotations: Array<{
    name: string;
    occurrences: number;
    typeNames: string[];
  }>;
  lookups: {
    packageToTypes: Record<string, string[]>;
    typeToFile: Record<string, string>;
    typeToMethods: Record<string, string[]>;
    annotationToTypes: Record<string, string[]>;
  };
}

export interface JqassistantSupportArtifact {
  schemaVersion: '1.0';
  generatedAt: string;
  projectName: string;
  projectRoot: string;
  status: JqassistantArtifact['status'];
  summary: JqassistantArtifact['summary'];
  applications: Array<{
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
  runtimeLayers: Array<{ name: string; role: string }>;
  supportModules: Array<{ name: string; role: string }>;
  graphs?: {
    projectGraph: {
      projects: Array<{
        artifactId: string;
        groupId?: string;
        name?: string;
      }>;
      modules: Array<{
        parentArtifactId: string;
        moduleName: string;
      }>;
    };
    packageGraph: {
      packages: string[];
      relations: Array<{
        fromPackage: string;
        toPackage: string;
        count: number;
      }>;
    };
    typeGraph: {
      types: Array<{
        fqn: string;
        packageName?: string;
        simpleName: string;
        kind?: string;
      }>;
      dependencies: Array<{
        fromType: string;
        toType: string;
        fromPackage?: string;
        toPackage?: string;
      }>;
    };
  };
  warnings: string[];
  error?: string;
}

export interface SupportGraphArtifact {
  schemaVersion: '1.0';
  generatedAt: string;
  projectName: string;
  projectRoot: string;
  nodes: Array<{
    id: string;
    type: 'project' | 'application' | 'layer' | 'component-group' | 'external-system' | 'flow-group' | 'module-group' | 'package-group';
    name: string;
    applicationId?: string;
    description?: string;
    items: string[];
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: 'contains' | 'uses' | 'exposes' | 'persists' | 'communicates-with';
  }>;
}

export interface GraphVerificationArtifact {
  schemaVersion: '1.0';
  generatedAt: string;
  projectName: string;
  projectRoot: string;
  summary: {
    applicationCount: number;
    endpointCount: number;
    graphNodeCount: number;
    graphEdgeCount: number;
    issueCount: number;
  };
  checks: Array<{
    id: string;
    status: 'ok' | 'warning' | 'error';
    category: 'applications' | 'endpoints' | 'layers' | 'flows' | 'persistence' | 'externals';
    message: string;
    evidence: string[];
  }>;
}

export interface GraphVerificationSlicesArtifact {
  schemaVersion: '1.0';
  generatedAt: string;
  projectName: string;
  projectRoot: string;
  slices: Array<{
    id: string;
    label: string;
    category: 'api-routes' | 'scheduler-flows' | 'listener-flows' | 'persistence-heavy';
    issueCount: number;
    checks: GraphVerificationArtifact['checks'];
  }>;
}

export interface AiGraphArtifact {
  schemaVersion: '1.0';
  generatedAt: string;
  projectName: string;
  projectRoot: string;
  sourcePriority: string[];
  nodes: Array<{
    id: string;
    applicationId?: string;
    layer?: string;
    kind: 'class-summary' | 'module-summary' | 'layer-summary' | 'flow-note' | 'validation-note';
    title: string;
    summary: string;
    evidence: string[];
  }>;
}

export interface LayerGraphsArtifact {
  schemaVersion: '1.0';
  generatedAt: string;
  projectName: string;
  projectRoot: string;
  layers: Array<{
    layer: string;
    applications: Array<{
      applicationId: string;
      items: string[];
    }>;
  }>;
}

export async function importSourceProjectState(options: SourceLearningImportOptions): Promise<SourceLearningResult> {
  const outputDir = options.outputDir;
  await mkdir(outputDir, { recursive: true });

  await options.onLifecycleProgress?.({ phase: 'analysis', message: 'Starting project analysis' });
  const analysisPath = join(outputDir, 'source.analysis.json');
  const snapshotPath = join(outputDir, 'source.snapshot.json');
  const codeKnowledgeGraphPath = join(outputDir, 'source.codegraph.json');
  const jqassistantPath = join(outputDir, 'source.jqassistant.json');
  const resumeFromStage = options.resumeFromStage ?? 'ast';
  const cachedAnalysis = await readJsonIfExists<SourceProjectAnalysis>(analysisPath);
  const shouldReuseAnalysis = cachedAnalysis && isStageAtOrAfter(resumeFromStage, 'snapshot');
  if (shouldReuseAnalysis) {
    await options.onLifecycleProgress?.({ phase: 'analysis', message: 'Reusing cached project analysis' });
  }
  const analysis = shouldReuseAnalysis
    ? cachedAnalysis
    : await analyzeProject(options.projectRoot, options.projectName, options.javaAstCatalog, options.onAnalysisProgress);
  if (options.javaAstCatalog?.length) {
    analysis.javaAstCatalog = options.javaAstCatalog;
  }
  await safeRunLocalAgentHook(
    options.projectRoot,
    'astComponentClassifier',
    undefined,
    buildAstComponentClassifierSlices(analysis),
    options.onLifecycleProgress,
  );
  await options.onLifecycleProgress?.({ phase: 'analysis', message: 'Project analysis complete' });

  await options.onLifecycleProgress?.({ phase: 'snapshot', message: 'Building directory snapshot' });
  const cachedSnapshot = await readJsonIfExists<SourceProjectSnapshot>(snapshotPath);
  const shouldReuseSnapshot = cachedSnapshot && isStageAtOrAfter(resumeFromStage, 'graph');
  if (shouldReuseSnapshot) {
    await options.onLifecycleProgress?.({ phase: 'snapshot', message: 'Reusing cached directory snapshot' });
  }
  const snapshot = shouldReuseSnapshot ? cachedSnapshot : await buildSnapshot(options.projectRoot, analysis);
  await options.onLifecycleProgress?.({ phase: 'snapshot', message: 'Directory snapshot complete' });

  if (!(await readJsonIfExists<SourceProjectAnalysis>(analysisPath))) {
    await writeFile(analysisPath, JSON.stringify(analysis, null, 2) + '\n');
  }
  if (!(await readJsonIfExists<SourceProjectSnapshot>(snapshotPath))) {
    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');
  }

  const jqassistantResult = {
    artifact: options.jqassistantArtifact ?? buildSkippedJqassistantArtifact(options.projectName, options.projectRoot, analysis),
  };
  analysis.jqassistant = jqassistantResult.artifact;
  applyJqassistantEvidence(analysis, jqassistantResult.artifact);

  await options.onLifecycleProgress?.({ phase: 'graph', message: 'Building code knowledge graph from AST' });
  const cachedCodeGraph = await readJsonIfExists<CodeKnowledgeGraph>(codeKnowledgeGraphPath);
  const shouldReuseCodeGraph = cachedCodeGraph && isStageAtOrAfter(resumeFromStage, 'prompt');
  if (shouldReuseCodeGraph) {
    await options.onLifecycleProgress?.({ phase: 'graph', message: 'Reusing cached code knowledge graph' });
  }
  const codeKnowledgeGraph = shouldReuseCodeGraph
    ? cachedCodeGraph
    : await buildCodeKnowledgeGraph(analysis, snapshot, options.onCodeGraphProgress);
  await options.onLifecycleProgress?.({ phase: 'graph', message: 'Code knowledge graph complete' });

  await safeRunLocalAgentHook(
    options.projectRoot,
    'repositoryPurpose',
    buildRepositoryPurposePrompt(analysis),
    undefined,
    options.onLifecycleProgress,
  );
  await safeRunLocalAgentHook(
    options.projectRoot,
    'sqlMigrationSemantics',
    undefined,
    buildSqlMigrationSemanticsSlices(analysis),
    options.onLifecycleProgress,
  );
  const analysisMdPath = join(outputDir, 'source.analysis.md');
  const astPath = join(outputDir, 'source.ast.json');
  const astIndexPath = join(outputDir, 'source.ast-index.json');
  const codeKnowledgeGraphMdPath = join(outputDir, 'source.codegraph.md');
  const jqassistantSupportPath = join(outputDir, 'source.jqassistant-graph.json');
  const supportGraphPath = join(outputDir, 'source.support-graph.json');
  const graphVerificationPath = join(outputDir, 'source.graph-verification.json');
  const graphVerificationSlicesPath = join(outputDir, 'source.graph-verification-slices.json');
  const aiGraphPath = join(outputDir, 'source.ai-graph.json');
  const layerGraphsPath = join(outputDir, 'source.layer-graphs.json');
  const semanticJsonPath = join(outputDir, 'source.semantic.json');
  const previewPath = join(outputDir, 'source.preview.json');
  const componentMapPath = join(outputDir, 'source.component-map.json');
  const flowMapPath = join(outputDir, 'source.flow-map.json');
  const reconnaissancePath = join(outputDir, 'source.recon.json');
  const reconnaissancePromptPath = join(outputDir, 'source.recon.prompt.md');
  const databaseSchemaPath = join(outputDir, 'source.database.json');
  const databaseSchemaMdPath = join(outputDir, 'source.database.md');
  const suggestedSemanticPath = join(outputDir, 'source.semantic.suggested.md');
  const semanticPath = join(outputDir, 'source.semantic.md');
  const graphPath = join(outputDir, 'source.graph.json');
  const statePath = join(outputDir, 'source.state.json');
  const readmePath = join(outputDir, 'README.md');
  await writeFile(analysisPath, JSON.stringify(analysis, null, 2) + '\n');
  await writeFile(analysisMdPath, renderAnalysisMarkdown(analysis, snapshot));
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');
  const deterministicArtifacts = await buildDeterministicGraphArtifacts(
    analysis,
    snapshot,
    jqassistantResult.artifact,
    codeKnowledgeGraph,
    options.onCodeGraphProgress,
  );
  const astIndexArtifact = deterministicArtifacts.astIndex;
  const jqassistantSupportArtifact = deterministicArtifacts.jqassistantSupport;
  const supportGraphArtifact = deterministicArtifacts.supportGraph;
  const graphVerificationArtifact = deterministicArtifacts.graphVerification;
  const graphVerificationSlicesArtifact = deterministicArtifacts.graphVerificationSlices;
  await writeFile(astPath, JSON.stringify(analysis.javaAstCatalog, null, 2) + '\n');
  await writeFile(astIndexPath, JSON.stringify(astIndexArtifact, null, 2) + '\n');
  await writeFile(jqassistantPath, JSON.stringify(jqassistantResult.artifact, null, 2) + '\n');
  await writeFile(jqassistantSupportPath, JSON.stringify(jqassistantSupportArtifact, null, 2) + '\n');
  await writeFile(codeKnowledgeGraphPath, JSON.stringify(codeKnowledgeGraph, null, 2) + '\n');
  await writeFile(codeKnowledgeGraphMdPath, renderCodeKnowledgeGraphMarkdown(codeKnowledgeGraph));
  await writeFile(supportGraphPath, JSON.stringify(supportGraphArtifact, null, 2) + '\n');
  await writeFile(graphVerificationPath, JSON.stringify(graphVerificationArtifact, null, 2) + '\n');
  await writeFile(graphVerificationSlicesPath, JSON.stringify(graphVerificationSlicesArtifact, null, 2) + '\n');

  const previewMetadata = deterministicArtifacts.preview;
  const componentMap = deterministicArtifacts.componentMap;
  const deterministicFlowMap = deterministicArtifacts.flowMap;
  const flowCandidateOutput = await safeRunLocalAgentHook(
    options.projectRoot,
    'flowCandidate',
    undefined,
    buildFlowCandidateSlices(analysis, codeKnowledgeGraph, deterministicFlowMap),
    options.onLifecycleProgress,
  );
  const flowMap = buildFlowMapArtifact(analysis, codeKnowledgeGraph, astIndexArtifact, jqassistantSupportArtifact, supportGraphArtifact, flowCandidateOutput);

  await safeRunLocalAgentHook(
    options.projectRoot,
    'componentPackaging',
    undefined,
    buildComponentPackagingSlices(analysis, previewMetadata, componentMap, flowMap),
    options.onLifecycleProgress,
  );

  await options.onLifecycleProgress?.({ phase: 'enrichment', message: 'Running local enrichment layer' });
  const enrichmentResult = await runLocalEnrichment({
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    analysis,
    snapshot,
    codeGraph: codeKnowledgeGraph,
    preview: previewMetadata,
    componentMap,
    flowMap,
  });
  const aiGraphArtifact = buildAiGraphArtifact(
    analysis,
    astIndexArtifact,
    jqassistantSupportArtifact,
    supportGraphArtifact,
    graphVerificationArtifact,
    flowMap,
    enrichmentResult.output,
  );
  const layerGraphsArtifact = buildLayerGraphsArtifact(supportGraphArtifact);
  await writeFile(aiGraphPath, JSON.stringify(aiGraphArtifact, null, 2) + '\n');
  await writeFile(layerGraphsPath, JSON.stringify(layerGraphsArtifact, null, 2) + '\n');

  analysis.codeKnowledgeGraph = codeKnowledgeGraph;
  analysis.reconnaissancePrompt = buildReconnaissancePrompt(analysis, analysis.moduleDossiers ?? []);

  const suggestedSemantic = renderSuggestedSemanticMarkdown(
    analysis,
    snapshot,
    codeKnowledgeGraph,
    astIndexArtifact,
    jqassistantSupportArtifact,
    supportGraphArtifact,
    graphVerificationArtifact,
  );
  await writeFile(suggestedSemanticPath, suggestedSemantic);
  await safeRunLocalAgentHook(
    options.projectRoot,
    'semanticPolishing',
    buildSemanticPolishingPrompt(analysis.projectName, suggestedSemantic, previewMetadata, componentMap, flowMap, supportGraphArtifact, astIndexArtifact, jqassistantSupportArtifact, graphVerificationArtifact),
    undefined,
    options.onLifecycleProgress,
  );

  let createdSemantic = false;
  let semanticSourceText: string;
  try {
    if (options.force) {
      throw new Error('force refresh requested');
    }
    semanticSourceText = await readFile(semanticPath, 'utf8');
  } catch {
    semanticSourceText = suggestedSemantic;
    await writeFile(semanticPath, semanticSourceText);
    createdSemantic = true;
  }

  const document = parseSemanticMarkdown(semanticSourceText, semanticPath);
  const graph = generateCanonicalGraph(document);
  (graph as typeof graph & { metadata?: Record<string, unknown> }).metadata = {
    ...(graph.metadata ?? {}),
    preview: previewMetadata,
    enrichment: {
      provider: enrichmentResult.output.provider,
      capability: enrichmentResult.output.capability,
      model: enrichmentResult.output.model,
      path: enrichmentResult.paths.outputPath,
      validationIssues: enrichmentResult.output.validationIssues,
    },
  };
  const databaseSchema = generateDatabaseSchema(document, graph);
  await options.onLifecycleProgress?.({ phase: 'artifacts', message: 'Writing semantic, graph, and schema artifacts' });
  const semanticJson = {
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    source: {
      createdSemantic,
      semanticPath,
      suggestedSemanticPath,
      codeKnowledgeGraphPath,
      jqassistantPath,
      jqassistantSupportPath,
      astIndexPath,
      supportGraphPath,
      graphVerificationPath,
      graphVerificationSlicesPath,
      aiGraphPath,
      layerGraphsPath,
      previewPath,
      componentMapPath,
      flowMapPath,
      enrichmentPath: enrichmentResult.paths.outputPath,
      enrichmentSchemaPath: enrichmentResult.paths.schemaPath,
      reviewDossierPath: enrichmentResult.paths.reviewDossierPath,
    },
    analysis,
    snapshot,
    codeKnowledgeGraph,
    enrichment: enrichmentResult.output,
    jqassistant: jqassistantResult.artifact,
    reconnaissance: {
      moduleDossiers: analysis.moduleDossiers,
      promptSource: 'mcp-generated-in-plugin-flow',
    },
    databaseSchema,
    graphSummary: {
      schemaVersion: graph.schemaVersion,
      title: graph.metadata?.title,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      nodeTypes: unique(graph.nodes.map((node) => node.type)),
    },
  };
  await writeFile(previewPath, JSON.stringify(previewMetadata, null, 2) + '\n');
  await writeFile(componentMapPath, JSON.stringify(componentMap, null, 2) + '\n');
  await writeFile(flowMapPath, JSON.stringify(flowMap, null, 2) + '\n');
  await writeFile(graphPath, JSON.stringify(graph, null, 2) + '\n');
  await writeFile(databaseSchemaPath, JSON.stringify(databaseSchema, null, 2) + '\n');
  await writeFile(databaseSchemaMdPath, renderDatabaseSchemaMarkdown(databaseSchema));
  await writeFile(semanticJsonPath, JSON.stringify(semanticJson, null, 2) + '\n');
  await writeFile(reconnaissancePath, JSON.stringify({
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    moduleDossiers: analysis.moduleDossiers,
    promptSource: 'mcp-generated-in-plugin-flow',
  }, null, 2) + '\n');
  await writeFile(statePath, JSON.stringify(buildState(analysis, snapshot, createdSemantic), null, 2) + '\n');
  await writeFile(readmePath, renderProjectReadme(analysis, snapshot, createdSemantic));
  await options.onLifecycleProgress?.({ phase: 'complete', message: 'Source import complete' });

  return {
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    outputDir,
    previewPath,
    componentMapPath,
    flowMapPath,
    jqassistantSupportPath,
    supportGraphPath,
    graphVerificationPath,
    graphVerificationSlicesPath,
    aiGraphPath,
    layerGraphsPath,
    enrichmentPath: enrichmentResult.paths.outputPath,
    enrichmentSchemaPath: enrichmentResult.paths.schemaPath,
    reviewDossierPath: enrichmentResult.paths.reviewDossierPath,
    reconnaissancePath,
    reconnaissancePromptPath,
    reconnaissancePromptWritten: false,
    semanticJsonPath,
    jqassistantPath,
    analysisPath,
    analysisMdPath,
    snapshotPath,
    astPath,
    astIndexPath,
    suggestedSemanticPath,
    semanticPath,
    graphPath,
    databaseSchemaPath,
    databaseSchemaMdPath,
    codeKnowledgeGraphPath,
    codeKnowledgeGraphMdPath,
    statePath,
    readmePath,
    createdSemantic,
    analysis,
    snapshot,
    codeKnowledgeGraph,
    graph,
    enrichment: enrichmentResult.output,
    jqassistant: jqassistantResult.artifact,
    localAgents: await readLocalAgentOutputs(options.projectRoot),
  };
}

function buildGraphPreviewMetadata(
  analysis: SourceProjectAnalysis,
  codeGraph: CodeKnowledgeGraph,
  astIndex: AstIndexArtifact,
  jqassistantSupport: JqassistantSupportArtifact,
  supportGraph: SupportGraphArtifact,
  verification: GraphVerificationArtifact,
): {
  applications: string[];
  applicationsDetailed: Array<{
    name: string;
    role: string;
    multiModule: boolean;
    modules: string[];
    cards: Array<{
      key: string;
      title: string;
      subtitle?: string;
      items: string[];
      flow?: string[];
    }>;
  }>;
  buildSupport: string[];
  runtimeModules: string[];
  api: string[];
  app: string[];
  common: string[];
  events: { types: string[]; producers: string[]; flow: string[] };
  web: { ingress: string[]; validation: string[]; errorHandling: string[]; configuration: string[]; securityBoundary: string[] };
  persistence: { repositories: string[]; mappers: string[]; entities: string[] };
  service: { catalog: string[]; details: string[]; exceptions: string[]; violations: string[] };
  security: string[];
} {
  const supportCards = buildSupportApplicationCardMap(supportGraph);
  const verificationWarnings = verification.checks
    .filter((check) => check.status !== 'ok')
    .map((check) => `${check.category}: ${check.message}`);
  const api = [
    ...(analysis.apiSurface.contractSource === 'openapi-generated' ? ['OpenAPI-generated contracts'] : []),
    ...(analysis.apiSurface.swaggerConfigPresent ? ['Swagger / OpenAPI docs'] : []),
    ...(analysis.apiSurface.validationEnabled ? ['API validation'] : []),
    ...jqassistantOrDeterministicApiFamilies(analysis, jqassistantSupport),
    ...analysis.apiSurface.clientImplementations.map((item) => `client: ${item.name} — ${item.purpose}`),
    ...analysis.apiSurface.enumTypes.map((item) => `enum: ${item.name} — ${item.purpose}`),
    ...astIndex.endpoints.slice(0, 8).map((endpoint) => `endpoint: ${endpoint.method} ${endpoint.path}`),
  ];
  const app = [
    ...(analysis.appRuntime.applicationEntryPoint ? [`entry point: ${analysis.appRuntime.applicationEntryPoint}`] : []),
    ...analysis.appRuntime.importedConfigFiles.map((item) => `${item.name} — ${item.purpose}`),
    ...analysis.appRuntime.configurationBeans.map((item) => `${item.name} — ${item.purpose}`),
    ...analysis.appRuntime.runtimeFeatures,
    ...analysis.appRuntime.externalDependencies.map((item) => `external dependency: ${item}`),
    ...verificationWarnings.slice(0, 4).map((warning) => `verification: ${warning}`),
  ];
  const common = [
    ...analysis.commonSummary.crossCuttingComponents.map((item) => `${item.name} — ${item.role}`),
    ...analysis.commonSummary.utilityComponents.map((item) => `utility: ${item}`),
    ...analysis.commonSummary.stateCarrierComponents.map((item) => `state carrier: ${item}`),
  ];
  const eventFlow = analysis.commonSummary.eventFlow
    ? [
        analysis.commonSummary.eventFlow.publisher,
        `${analysis.commonSummary.eventFlow.transport} (${analysis.commonSummary.eventFlow.channel})`,
        analysis.commonSummary.eventFlow.subscriber,
        'notification persistence',
      ]
    : [];
  const web = {
    ingress: groupEndpointFamilies(
      analysis.endpointCatalog.filter((entry) =>
        /^(GET|POST|PUT|DELETE|PATCH|REQUEST)$/i.test(entry.method)
        && /\/event-backend\/web\//i.test(entry.file),
      ),
    ).map((family) => `${family.family} (${family.count})`),
    validation: codeGraph.summary.validationBoundaries,
    errorHandling: codeGraph.summary.exceptionHandlers,
    configuration: codeGraph.summary.webConfigurations,
    securityBoundary: codeGraph.summary.webSecurityBoundaries.filter((item) => !/CookieOrHeaderBearerTokenResolver/i.test(item)),
  };
  const mapperParts = [
    ...(analysis.persistenceSummary.mapperSummary.abstractBase
      ? [`${analysis.persistenceSummary.mapperSummary.abstractBase} — ${analysis.persistenceSummary.mapperSummary.abstractBaseNotes.join(', ') || 'shared row helper base'}`]
      : []),
    ...analysis.persistenceSummary.mapperSummary.rowMappers,
    ...analysis.persistenceSummary.mapperSummary.dtoMappers,
  ];
  const serviceCatalog = analysis.serviceSummary.executionServices.map((service) => `${service.name} — ${service.purpose}`);
  const serviceDetails = [
    ...analysis.serviceSummary.clientImplementations.map((item) => `client: ${item.name} — ${item.purpose}${item.issue ? `; issue: ${item.issue}` : ''}`),
    ...analysis.serviceSummary.misplacedDtos.map((item) => `dto: ${item.name} — ${item.purpose}; issue: ${item.issue}`),
    ...analysis.serviceSummary.serviceEvents.map((item) => `event: ${item.name} — ${item.purpose}${item.issue ? `; issue: ${item.issue}` : ''}`),
    ...analysis.serviceSummary.serviceInterfaces.map((item) => `interface: ${item.name} — ${item.purpose}${item.issue ? `; issue: ${item.issue}` : ''}`),
    ...analysis.serviceSummary.mailCapabilities.config.map((item) => `mail config: ${item}`),
    ...analysis.serviceSummary.mailCapabilities.templates.map((item) => `mail template: ${item.name} — ${item.purpose}`),
    ...analysis.serviceSummary.mailCapabilities.operations.map((item) => `mail operation: ${item.name} — ${item.purpose}${item.issue ? `; issue: ${item.issue}` : ''}`),
    ...analysis.serviceSummary.storageCapabilities.summary.map((item) => `storage: ${item}`),
    ...analysis.serviceSummary.schedulingModel.map((item) => `scheduling: ${item}`),
    ...analysis.serviceSummary.scheduledJobs.map((item) => `job: ${item.name} — ${item.schedule}; ${item.purpose}`),
    ...analysis.serviceSummary.asyncListeners.map((item) => `listener: ${item.name} — ${item.purpose}`),
  ];

  const notificationAstFiles = analysis.javaAstCatalog.filter((astFile) => /\/event-notification\//i.test(astFile.file));
  const notificationEndpoints = analysis.endpointCatalog.filter((entry) => /\/event-notification\//i.test(entry.file));
  const notificationTypeEntries = notificationAstFiles.flatMap((astFile) =>
    astFile.types.map((type) => ({ file: astFile.file, packageName: astFile.packageName ?? '', type })),
  );
  const notificationTypeNames = unique(notificationTypeEntries.map((entry) => entry.type.name));
  const notificationResourceFiles = analysis.resourceFiles.yaml
    .filter((file) => /\/event-notification\/src\/main\/resources\//i.test(file))
    .map((file) => relativePath(file, analysis.projectRoot));
  const notificationMigrationFiles = analysis.resourceFiles.sql
    .filter((file) => /\/event-notification\/src\/main\/resources\/db\/migration\//i.test(file))
    .map((file) => relativePath(file, analysis.projectRoot));
  const notificationOpenApiFiles = notificationResourceFiles.filter((file) => /openapi\/.+\.ya?ml$/i.test(file));
  const notificationAppYamlFiles = notificationResourceFiles.filter((file) => /application\.ya?ml$/i.test(file));
  const notificationCorsFiles = notificationResourceFiles.filter((file) => /cors-config\.ya?ml$/i.test(file));
  const notificationStructure = unique([
    ...notificationAstFiles
      .map((astFile) => classifyNotificationStructureBucket(astFile))
      .filter((value): value is string => Boolean(value)),
    ...(notificationResourceFiles.length ? ['resources'] : []),
    ...(notificationAppYamlFiles.length ? ['application.yml'] : []),
    ...(notificationCorsFiles.length ? ['cors-config.yml'] : []),
    ...(notificationOpenApiFiles.length ? ['openapi'] : []),
    ...(notificationMigrationFiles.length ? ['db/migration'] : []),
  ]).sort((left, right) => left.localeCompare(right));
  const notificationWebConfigs = unique(
    notificationTypeNames.filter((name) => /WebConfig|OpenApiConfig|CorsProperties/i.test(name)),
  );
  const notificationExternalDependencies = unique([
    ...(notificationResourceFiles.length ? ['Redis'] : []),
  ]);
  const notificationHttpEndpoints = notificationEndpoints
    .filter((entry) => /^(GET|POST|PUT|DELETE|PATCH)$/i.test(entry.method))
    .map((entry) => `${entry.method} ${entry.path} — ${inferNotificationEndpointPurpose(entry.path)}`);
  const notificationApiFamilies = groupEndpointFamilies(notificationEndpoints)
    .map((family) => `family: ${family.family} — ${inferNotificationApiFamilyPurpose(family.family)} (${family.count} endpoints)`);
  const notificationRepositoryMethods = collectTypeMethodNames(notificationTypeEntries, /NotificationRepository/i)
    .map((name) => `${name} — ${inferNotificationRepositoryMethodPurpose(name)}`);
  const notificationServiceMethods = collectTypeMethodNames(notificationTypeEntries, /NotificationService/i)
    .map((name) => `${name} — ${inferNotificationServiceMethodPurpose(name)}`);
  const notificationControllerMethods = collectTypeMethodNames(notificationTypeEntries, /NotificationController/i)
    .filter((name) => /^_api/i.test(name))
    .map((name) => `${name} — ${inferNotificationControllerMethodPurpose(name)}`);
  const notificationRealtimeMethods = unique([
    ...collectTypeMethodNames(notificationTypeEntries, /WsHandler/i)
      .filter((name) => /afterConnectionEstablished|afterConnectionClosed/i.test(name))
      .map((name) => `WsHandler.${name} — ${inferNotificationRealtimeMethodPurpose(name)}`),
    ...collectTypeMethodNames(notificationTypeEntries, /WsGateway/i)
      .filter((name) => /sendToUser/i.test(name))
      .map((name) => `WsGateway.${name} — ${inferNotificationRealtimeMethodPurpose(name)}`),
  ]);
  const notification = {
    structure: notificationStructure,
    app: unique([
      ...notificationTypeNames.filter((name) => /EventNotificationApplication/i.test(name)).map((name) => `entry point: ${name}.main`),
      ...(notificationTypeNames.some((name) => /EventNotificationApplication/i.test(name)) ? ['Spring Boot notification application for asynchronous notification persistence and delivery'] : []),
      ...notificationAppYamlFiles.map((file) => `${file} — configures datasource, Redis channel, Flyway, actuator, websocket path, and JWT public key`),
      ...(notificationMigrationFiles.length ? [`${notificationMigrationFiles.length} Flyway migration scripts evolve the notifications schema`] : []),
      ...(notificationOpenApiFiles.length ? ['OpenAPI resource drives generated REST contracts and DTOs'] : []),
    ]),
    api: unique([
      ...(notificationTypeNames.some((name) => /NotificationsApi/i.test(name)) ? ['contract: NotificationsApi — generated REST contract for reading and acknowledging notifications'] : []),
      ...notificationApiFamilies,
      ...notificationHttpEndpoints,
      ...(notificationTypeNames.some((name) => /^Notification$/i.test(name)) ? ['dto: Notification — generated client-facing notification payload shape'] : []),
      ...(notificationOpenApiFiles.length ? notificationOpenApiFiles.map((file) => `source: ${file} — source-of-truth API contract with bearer auth`) : []),
    ]),
    web: unique([
      ...(notificationTypeNames.some((name) => /NotificationController/i.test(name)) ? ['NotificationController — resolves caller identity from the bearer token, delegates reads, and maps entities to API DTOs'] : []),
      ...notificationControllerMethods,
      ...(notificationTypeNames.some((name) => /NotificationsApi/i.test(name)) ? ['HTTP endpoints are bearer-auth protected and scoped to the authenticated user'] : []),
      ...(notificationTypeNames.some((name) => /WebConfig/i.test(name)) ? ['WebConfig — applies configured CORS rules to /api/**'] : []),
    ]),
    service: unique([
      ...(notificationTypeNames.some((name) => /NotificationService/i.test(name)) ? ['NotificationService — persists incoming notifications, serves recent and unread lists, and marks only owned records as read'] : []),
      ...notificationServiceMethods,
    ]),
    persistence: unique([
      ...(notificationTypeNames.some((name) => /NotificationRepository/i.test(name)) ? ['repository: NotificationRepository — JPA persistence boundary for user-scoped notification queries'] : []),
      ...notificationRepositoryMethods.map((item) => `repository method: ${item}`),
      ...(notificationTypeNames.some((name) => /^Notification$/i.test(name)) ? ['entity: Notification — stored notification record with read and delivery timestamps'] : []),
      ...(notificationMigrationFiles.length ? ['schema: Flyway migrations create and evolve the notifications.notification table'] : []),
      ...notificationMigrationFiles.map((file) => `schema file: ${file} — notification schema evolution`),
    ]),
    events: unique([
      ...(notificationTypeNames.some((name) => /NotificationEvent/i.test(name)) ? ['NotificationEvent — async payload consumed from the backend notification stream'] : []),
      ...(notificationTypeNames.some((name) => /NotificationSubscriber/i.test(name)) ? ['NotificationSubscriber — consumes Redis events, persists notifications, then triggers websocket fan-out'] : []),
      ...(notificationTypeNames.some((name) => /RedisConfig/i.test(name)) ? ['RedisConfig — subscribes to notifications:incoming for notification ingestion'] : []),
      ...(notificationTypeNames.some((name) => /NotificationSubscriber/i.test(name)) ? ['Delivery chain: Redis Pub/Sub -> NotificationSubscriber -> NotificationService.save -> WsGateway'] : []),
    ]),
    realtime: unique([
      ...(notificationTypeNames.some((name) => /WsConfig/i.test(name)) ? ['WsConfig — registers the /ws endpoint for realtime notification delivery'] : []),
      ...(notificationTypeNames.some((name) => /WsHandler/i.test(name)) ? ['WsHandler — authenticates websocket sessions and maintains a session registry per user'] : []),
      ...(notificationTypeNames.some((name) => /WsGateway/i.test(name)) ? ['WsGateway — broadcasts persisted notifications to all active sessions of a user'] : []),
      ...notificationRealtimeMethods,
    ]),
    security: unique([
      ...(notificationTypeNames.some((name) => /JwtValidator/i.test(name)) ? ['JwtValidator — loads the RSA public key, validates bearer JWTs, and extracts the caller UUID'] : []),
      ...(notificationTypeNames.some((name) => /NotificationController|WsHandler/i.test(name)) ? ['Both HTTP API access and websocket handshakes require a valid bearer/JWT credential'] : []),
      ...(notificationTypeNames.some((name) => /OpenApiConfig/i.test(name)) ? ['OpenApiConfig — publishes Swagger/OpenAPI metadata with bearerAuth security scheme'] : []),
    ]),
    config: unique([
      ...notificationWebConfigs.map((name) => `${name} — runtime/web configuration component`),
      ...notificationCorsFiles.map((file) => `${file} — allowed origins, methods, and credential policy`),
      ...notificationAppYamlFiles.map((file) => `${file} — server port, datasource, Redis, Flyway, actuator, JWT public key path`),
    ]),
    externalDependencies: notificationExternalDependencies,
  };

  const applicationsDetailed = analysis.applicationLayouts.map((layout) => {
    const layoutSupportCards = supportCards.get(layout.appRoot) ?? new Map<string, string[]>();
    if (layout.appRoot === 'event-backend') {
      const backendModules = [
        ...analysis.repositoryStructure.backendSupportModules.map((item) => item.name.replace(/^event-backend\//, '')),
        ...analysis.repositoryStructure.backendRuntimeLayers.map((item) => item.name.replace(/^event-backend\//, '')),
      ];
      const backendBuildItems = backendModules.filter((moduleName) => /^(bom|build|versions)$/i.test(moduleName));
      const backendRuntimeModuleItems = backendModules.filter((moduleName) => !/^(bom|build|versions)$/i.test(moduleName));
      return {
        name: layout.appRoot,
        role: layout.role,
        multiModule: layout.multiModule,
        modules: backendModules,
        cards: [
          { key: 'api', title: 'API', items: mergeCardItems(layoutSupportCards.get('api'), api) },
          { key: 'app', title: 'App', items: mergeCardItems(layoutSupportCards.get('app'), app) },
          { key: 'common', title: 'Common', items: mergeCardItems(layoutSupportCards.get('common'), common) },
          {
            key: 'events',
            title: 'Events',
            subtitle: 'Shared notification events and publish/subscribe flow.',
            items: analysis.commonSummary.eventTypes.map((item) => `${item.name} — ${item.purpose}`),
            flow: eventFlow,
          },
          {
            key: 'web',
            title: 'Web',
            items: mergeCardItems(layoutSupportCards.get('web'), unique([
              ...web.ingress.map((item) => `ingress: ${item}`),
              ...web.validation.map((item) => `validation: ${item}`),
              ...web.errorHandling.map((item) => `error handling: ${item}`),
              ...web.configuration.map((item) => `configuration: ${item}`),
              ...web.securityBoundary.map((item) => `security boundary: ${item}`),
            ])),
          },
          {
            key: 'persistence.repositories',
            title: 'Persistence · Repositories',
            items: mergeCardItems(layoutSupportCards.get('persistence'), analysis.persistenceSummary.repositories.map((item) => `${item.name} — ${item.purpose}; ops: ${item.operationGroups.join(', ') || 'general persistence'}${item.notableOperation ? `; notable: ${item.notableOperation}` : ''}`)),
          },
          { key: 'persistence.mappers', title: 'Persistence · Mappers', items: mapperParts },
          { key: 'persistence.entities', title: 'Persistence · Entities', items: mergeCardItems(layoutSupportCards.get('persistence'), analysis.persistenceSummary.entityNames) },
          { key: 'service.catalog', title: 'Service', items: mergeCardItems(layoutSupportCards.get('service'), serviceCatalog) },
          { key: 'service.details', title: 'Service Details', items: serviceDetails },
          {
            key: 'service.exceptions',
            title: 'Service Exceptions',
            items: analysis.serviceSummary.exceptionTypes.map((item) => `${item.name} — ${item.purpose}${item.thrownBy.length ? `; thrown by ${item.thrownBy.join(', ')}` : ''}`),
          },
          { key: 'security', title: 'Security', items: mergeCardItems(layoutSupportCards.get('security'), analysis.commonSummary.securityDetails.filter((item) => !/access_token cookie/i.test(item))) },
          { key: 'buildSupport', title: 'Build Support', items: backendBuildItems },
          { key: 'runtimeModules', title: 'Runtime Modules', items: backendRuntimeModuleItems },
        ],
      };
    }

    if (layout.appRoot === 'event-notification') {
      return {
        name: layout.appRoot,
        role: layout.role,
        multiModule: layout.multiModule,
        modules: notificationStructure,
        cards: [
          { key: 'api', title: 'API', items: mergeCardItems(layoutSupportCards.get('api'), notification.api) },
          { key: 'app', title: 'App', items: mergeCardItems(layoutSupportCards.get('app'), notification.app) },
          { key: 'web', title: 'Web', items: mergeCardItems(layoutSupportCards.get('web'), notification.web) },
          { key: 'service', title: 'Service', items: mergeCardItems(layoutSupportCards.get('service'), notification.service) },
          {
            key: 'persistence.repositories',
            title: 'Persistence · Repositories',
            items: mergeCardItems(layoutSupportCards.get('persistence'), notification.persistence.filter((item) => /^repository:/i.test(item) || /^repository method:/i.test(item))),
          },
          {
            key: 'persistence.entities',
            title: 'Persistence · Entities',
            items: mergeCardItems(layoutSupportCards.get('persistence'), notification.persistence.filter((item) => /^entity:/i.test(item))),
          },
          {
            key: 'persistence.schema',
            title: 'Persistence · Schema',
            items: notification.persistence.filter((item) => /^schema:/i.test(item) || /^schema file:/i.test(item)),
          },
          {
            key: 'events',
            title: 'Events',
            items: notification.events,
            flow: [
              'Backend service',
              'NotificationPublisher.publish()',
              'Redis Pub/Sub',
              'NotificationSubscriber',
              'NotificationService.save',
              'WsGateway',
            ],
          },
          { key: 'realtime', title: 'Realtime', items: notification.realtime },
          { key: 'security', title: 'Security', items: mergeCardItems(layoutSupportCards.get('security'), notification.security) },
          { key: 'config', title: 'Config', items: notification.config },
        ],
      };
    }

    const moduleDossiers = (analysis.moduleDossiers ?? []).filter((dossier) => dossier.moduleRoot.startsWith(`${layout.appRoot}::`));
    return {
      name: layout.appRoot,
      role: layout.role,
      multiModule: layout.multiModule,
      modules: layout.internalModules.map((item) => item.name),
      cards: layout.internalModules.map((module) => {
        const dossier = moduleDossiers.find((item) => item.moduleRoot === `${layout.appRoot}::${module.name}`);
        const items = unique([
          module.purpose,
          ...(dossier?.observations ?? []),
          ...(dossier?.flowTraces ?? []).slice(0, 4),
        ]).filter(Boolean);
        return {
          key: module.name,
          title: module.name,
          items,
        };
      }),
    };
  });

  return {
    applications: collectApplicationInterfaceItems(analysis.repositoryStructure),
    applicationsDetailed,
    buildSupport: analysis.repositoryStructure.backendSupportModules.map((item) => item.name.replace(/^event-backend\//, '')),
    runtimeModules: analysis.repositoryStructure.backendRuntimeLayers.map((item) => item.name.replace(/^event-backend\//, '')),
    api,
    app,
    common,
    events: {
      types: analysis.commonSummary.eventTypes.map((item) => `${item.name} — ${item.purpose}`),
      producers: analysis.commonSummary.eventFlow?.producerCallers ?? [],
      flow: eventFlow,
    },
    web,
    persistence: {
      repositories: analysis.persistenceSummary.repositories.map((item) => `${item.name} — ${item.purpose}; ops: ${item.operationGroups.join(', ') || 'general persistence'}${item.notableOperation ? `; notable: ${item.notableOperation}` : ''}`),
      mappers: mapperParts,
      entities: analysis.persistenceSummary.entityNames,
    },
    service: {
      catalog: serviceCatalog,
      details: serviceDetails,
      exceptions: analysis.serviceSummary.exceptionTypes.map((item) => `${item.name} — ${item.purpose}${item.thrownBy.length ? `; thrown by ${item.thrownBy.join(', ')}` : ''}`),
      violations: analysis.serviceSummary.violations,
    },
    security: analysis.commonSummary.securityDetails.filter((item) => !/access_token cookie/i.test(item)),
  };
}

function classifyNotificationStructureBucket(astFile: JavaAstFile): string | undefined {
  const normalized = astFile.file.replace(/\\/g, '/');
  const relativeJava = normalized.match(/\/event-notification\/src\/main\/java\/hu\/event\/notification\/(.*)$/i)?.[1] ?? '';
  if (!relativeJava) {
    return astFile.types.some((type) => /Application$/.test(type.name)) ? 'app' : undefined;
  }
  const firstSegment = relativeJava.split('/')[0]?.replace(/\.java$/i, '');
  if (!firstSegment) return undefined;
  if (/Application$/i.test(firstSegment)) return 'app';
  if (/^repository$/i.test(firstSegment)) return 'repository';
  if (/^domain$/i.test(firstSegment)) return 'domain';
  return firstSegment;
}

function collectTypeMethodNames(
  typeEntries: Array<{ file: string; packageName: string; type: JavaAstFile['types'][number] }>,
  typeNamePattern: RegExp,
): string[] {
  return unique(
    typeEntries
      .filter((entry) => typeNamePattern.test(entry.type.name))
      .flatMap((entry) => entry.type.methods.map((method) => method.name))
      .filter((name) => !/^lambda\$/.test(name)),
  );
}

function inferNotificationEndpointPurpose(pathValue: string): string {
  if (/\/unread$/i.test(pathValue)) return 'list unread notifications for the authenticated user';
  if (/\/read$/i.test(pathValue)) return 'mark a notification as read';
  if (/\/notifications$/i.test(pathValue)) return 'list recent notifications for the authenticated user';
  return 'notification API operation';
}

function inferNotificationApiFamilyPurpose(family: string): string {
  if (/\/notifications$/i.test(family)) return 'notification queries and read acknowledgement for the authenticated user';
  return 'notification API family';
}

function inferNotificationRepositoryMethodPurpose(name: string): string {
  if (/findByUserIdAndReadOrderByCreatedAtDesc/i.test(name)) return 'load unread notifications for a user ordered by newest first';
  if (/findByUserIdOrderByCreatedAtDesc/i.test(name)) return 'load recent notifications for a user ordered by newest first';
  if (/save/i.test(name)) return 'persist notification state';
  return 'repository operation';
}

function inferNotificationServiceMethodPurpose(name: string): string {
  if (/^save$/i.test(name)) return 'persist a new notification with generated identifiers and timestamps';
  if (/^listUnread$/i.test(name)) return 'return unread notifications for the caller';
  if (/^list$/i.test(name)) return 'return recent notifications for the caller';
  if (/^markRead$/i.test(name)) return 'mark an owned notification as read';
  return 'service operation';
}

function inferNotificationControllerMethodPurpose(name: string): string {
  if (/unread/i.test(name)) return 'serve unread notifications over HTTP';
  if (/read/i.test(name)) return 'acknowledge a notification as read over HTTP';
  if (/notifications|get/i.test(name)) return 'serve recent notifications over HTTP';
  return 'controller operation';
}

function inferNotificationRealtimeMethodPurpose(name: string): string {
  if (/afterConnectionEstablished/i.test(name)) return 'register an authenticated websocket session';
  if (/afterConnectionClosed/i.test(name)) return 'remove a websocket session from the registry';
  if (/sendToUser/i.test(name)) return 'fan out a notification to active websocket sessions';
  if (/extractToken|extractUserId/i.test(name)) return 'resolve caller identity from websocket authentication data';
  return 'realtime operation';
}

function buildSupportApplicationCardMap(supportGraph: SupportGraphArtifact): Map<string, Map<string, string[]>> {
  const result = new Map<string, Map<string, string[]>>();
  const applicationNodes = new Map(
    supportGraph.nodes
      .filter((node) => node.type === 'application')
      .map((node) => [node.id, node]),
  );
  for (const edge of supportGraph.edges) {
    if (edge.type !== 'contains') continue;
    const sourceApplication = applicationNodes.get(edge.from);
    if (!sourceApplication) continue;
    const targetNode = supportGraph.nodes.find((node) => node.id === edge.to);
    if (!targetNode || (targetNode.type !== 'layer' && targetNode.type !== 'module-group' && targetNode.type !== 'package-group')) continue;
    const appKey = sourceApplication.name;
    const bucket = result.get(appKey) ?? new Map<string, string[]>();
    bucket.set(targetNode.name.toLowerCase(), mergeCardItems(bucket.get(targetNode.name.toLowerCase()), targetNode.items));
    result.set(appKey, bucket);
  }
  return result;
}

function mergeCardItems(...groups: Array<string[] | undefined>): string[] {
  return unique(groups.flatMap((group) => group ?? []).filter(Boolean));
}

function jqassistantOrDeterministicApiFamilies(
  analysis: SourceProjectAnalysis,
  jqassistantSupport: JqassistantSupportArtifact,
): string[] {
  const packageHints = jqassistantSupport.graphs?.packageGraph.packages ?? [];
  const apiPackages = packageHints.filter((item) => /\.api(\.|$)/i.test(item));
  if (apiPackages.length > 0) {
    return unique([
      ...analysis.apiSurface.families.map((family) => `${family.family} (${family.endpointCount} endpoints)`),
      ...apiPackages.slice(0, 8).map((packageName) => `package: ${packageName}`),
    ]);
  }
  return analysis.apiSurface.families.map((family) => `${family.family} (${family.endpointCount} endpoints)`);
}

async function analyzeProject(
  root: string,
  name: string,
  javaAstCatalog: JavaAstFile[] | undefined,
  onProgress?: (event: { phase: 'files' | 'java' | 'packages' | 'sql'; message: string }) => void | Promise<void>,
): Promise<SourceProjectAnalysis> {
  await onProgress?.({ phase: 'files', message: 'Collecting project files' });
  const [pomFiles, javaFiles, yamlFiles, sqlFiles, markdownFiles] = await Promise.all([
    collectFiles(root, 'pom.xml', undefined, onProgress),
    collectFiles(root, '.java', undefined, onProgress),
    collectFiles(root, '.yaml', '.yml', onProgress),
    collectFiles(root, '.sql', undefined, onProgress),
    collectFiles(root, '.md', undefined, onProgress),
  ]);

  await onProgress?.({
    phase: 'files',
    message: `Collected ${pomFiles.length + javaFiles.length + yamlFiles.length + sqlFiles.length + markdownFiles.length} files`,
  });
  const [pomKeywords, yamlKeywords, sqlCatalog] = await Promise.all([
    collectPomKeywords(pomFiles),
    collectYamlKeywords(yamlFiles),
    collectSqlCatalog(sqlFiles, onProgress),
  ]);

  let javaSignals: JavaSignalBundle;
  let packageMap: Record<string, number>;
  if (javaAstCatalog?.length) {
    await onProgress?.({ phase: 'java', message: `Using remote AST catalog with ${javaAstCatalog.length} Java files` });
    [javaSignals, packageMap] = await Promise.all([
      collectJavaSignalsFromAst(javaAstCatalog, javaFiles, onProgress),
      collectPackageMapFromAst(javaAstCatalog, onProgress),
    ]);
  } else {
    [javaSignals, packageMap] = await Promise.all([
      collectJavaSignals(javaFiles, onProgress),
      collectPackageMap(javaFiles, onProgress),
    ]);
  }
  await onProgress?.({ phase: 'java', message: `Parsed ${javaSignals.javaAstCatalog.length} Java files into AST catalog` });

  const modules = pomFiles
    .map((file) => relative(root, dirname(file)).split(sep).join('/'))
    .filter((path) => path && path !== '.')
    .sort((left, right) => left.localeCompare(right));

  const counts = {
    pomFiles: pomFiles.length,
    javaFiles: javaFiles.length,
    yamlFiles: yamlFiles.length,
    sqlFiles: sqlFiles.length,
    markdownFiles: markdownFiles.length,
    controllers: javaSignals.controllers.length,
    services: javaSignals.services.length,
    repositories: javaSignals.repositories.length,
    entities: javaSignals.entities.length,
    policies: javaSignals.policies.length,
    configs: javaSignals.configs.length,
    jobs: javaSignals.jobs.length,
    listeners: javaSignals.listeners.length,
    securityClasses: javaSignals.security.length,
    scheduledJobs: javaSignals.scheduled.length,
    websocketHandlers: javaSignals.websocket.length,
  };

  const layers = {
    api: javaFiles.filter((file) => /\/api\//.test(file)).length,
    web: javaFiles.filter((file) => /\/web\//.test(file)).length,
    service: javaFiles.filter((file) => /\/service\//.test(file)).length,
    persistence: javaFiles.filter((file) => /\/persistence\//.test(file)).length,
    common: javaFiles.filter((file) => /\/common\//.test(file)).length,
    app: javaFiles.filter((file) => /\/app\//.test(file)).length,
    notification: javaFiles.filter((file) => /\/notification\//.test(file)).length,
  };

  const technologies = unique([...pomKeywords, ...yamlKeywords]).sort((left, right) => left.localeCompare(right));
  const observations = deriveObservations({ modules, counts, technologies, javaSignals, markdownFiles });
  const apiSurface = await collectApiSurfaceSummary(root, javaSignals.javaAstCatalog, javaSignals.endpoints, yamlFiles);
  const appRuntime = await collectAppRuntimeSummary(root, javaSignals.javaAstCatalog, yamlFiles, pomFiles);
  const repositoryStructure = collectRepositoryStructureSummary(root, modules);
  const applicationLayouts = await collectApplicationLayouts(root, repositoryStructure, javaSignals.javaAstCatalog, yamlFiles, sqlFiles);
  const commonSummary = await collectCommonSummary(root);
  const persistenceSummary = await collectPersistenceSummary(root);
  const serviceSummary = await collectServiceSummary(root);
  const flowSummary = await collectFlowSummary(root, javaSignals.endpoints, serviceSummary);
  const baseAnalysis: SourceProjectAnalysis = {
    projectName: name,
    projectRoot: root,
    modules,
    javaAstCatalog: javaSignals.javaAstCatalog,
    javaCatalog: javaSignals.catalog,
    endpointCatalog: javaSignals.endpoints,
    apiSurface,
    appRuntime,
    repositoryStructure,
    applicationLayouts,
    commonSummary,
    persistenceSummary,
    serviceSummary,
    flowSummary,
    schemaHints: javaSignals.schemaHints,
    sqlCatalog,
    resourceFiles: {
      sql: sqlFiles,
      migrations: sqlFiles.filter((file) => /flyway|liquibase|migration/i.test(file)),
      markdown: markdownFiles,
      yaml: yamlFiles,
    },
    counts,
    layers,
    technologies,
    roles: {
      controllers: javaSignals.controllers,
      services: javaSignals.services,
      repositories: javaSignals.repositories,
      entities: javaSignals.entities,
      policies: javaSignals.policies,
      security: javaSignals.security,
      configs: javaSignals.configs,
      jobs: javaSignals.jobs,
      listeners: javaSignals.listeners,
    },
    keyPaths: {
      applicationYaml: firstExisting(yamlFiles, /application\.yaml$/),
      securityYaml: firstExisting(yamlFiles, /security\.yaml$/),
      openApiYaml: firstExisting(yamlFiles, /openapi\.yaml$|event-api\.yaml$/),
      readme: firstExisting(markdownFiles, /README\.md$/),
    },
    observations,
    packageMap,
    signals: javaSignals,
  };

  const moduleDossiers = await buildModuleDossiers(baseAnalysis);

  return {
    ...baseAnalysis,
    moduleDossiers,
  };
}

async function buildSnapshot(root: string, analysis: SourceProjectAnalysis): Promise<SourceProjectSnapshot> {
  const tree = await buildDirectorySnapshot(root);
  return {
    projectRoot: root,
    topLevelDirectories: tree.directories,
    topLevelFiles: tree.files,
    moduleRoots: analysis.modules,
    packageMap: analysis.packageMap,
    javaAstCatalog: analysis.javaAstCatalog,
    javaCatalog: analysis.javaCatalog,
    endpointCatalog: analysis.endpointCatalog,
    schemaHints: analysis.schemaHints,
    sqlCatalog: analysis.sqlCatalog,
    counts: analysis.counts,
    layers: analysis.layers,
    moduleDossiers: analysis.moduleDossiers,
  };
}

async function collectApplicationLayouts(
  projectRoot: string,
  repositoryStructure: RepositoryStructureSummary,
  astCatalog: JavaAstFile[],
  yamlFiles: string[],
  sqlFiles: string[],
): Promise<ApplicationLayoutSummary[]> {
  const projectEntries = repositoryStructure.topLevelProjects.length
    ? repositoryStructure.topLevelProjects
    : [{ name: basename(projectRoot), role: 'single application rooted at the repository root' }];

  const layouts = await Promise.all(projectEntries.map(async (projectEntry) => {
    const childModules = [
      ...repositoryStructure.backendSupportModules,
      ...repositoryStructure.backendRuntimeLayers,
    ]
      .filter((item) => item.name.startsWith(`${projectEntry.name}/`))
      .map((item) => ({
        name: item.name.replace(`${projectEntry.name}/`, ''),
        purpose: item.role,
        source: 'maven' as const,
        pathHints: [item.name.replace(/\\/g, '/')],
      }));

    if (childModules.length > 0) {
      return {
        appRoot: projectEntry.name,
        role: projectEntry.role,
        multiModule: true,
        moduleRoots: childModules.map((item) => `${projectEntry.name}/${item.name}`),
        internalModules: childModules,
      } satisfies ApplicationLayoutSummary;
    }

    const appAstFiles = astCatalog.filter((astFile) => fileBelongsToApplication(astFile.file, projectEntry.name, projectRoot));
    const appYamlFiles = yamlFiles.filter((file) => fileBelongsToApplication(file, projectEntry.name, projectRoot));
    const appSqlFiles = sqlFiles.filter((file) => fileBelongsToApplication(file, projectEntry.name, projectRoot));
    const deterministicModules = collectDeterministicInternalModules(projectEntry.name, projectRoot, appAstFiles, appYamlFiles, appSqlFiles);
    const aiModules = await collectInternalModulesWithLocalAi(projectRoot, projectEntry.name, deterministicModules, appAstFiles, appYamlFiles, appSqlFiles);
    return {
      appRoot: projectEntry.name,
      role: projectEntry.role,
      multiModule: false,
      moduleRoots: [projectEntry.name],
      internalModules: mergeInternalModules(deterministicModules, aiModules),
    } satisfies ApplicationLayoutSummary;
  }));

  return layouts;
}

async function buildModuleDossiers(analysis: SourceProjectAnalysis): Promise<ModuleDossier[]> {
  const dossierTargets: Array<
    | { type: 'module'; root: string; layout?: ApplicationLayoutSummary }
    | { type: 'synthetic'; root: string; layout: ApplicationLayoutSummary; module: ApplicationLayoutSummary['internalModules'][number] }
  > = [];

  if (analysis.applicationLayouts.length) {
    for (const layout of analysis.applicationLayouts) {
      if (layout.multiModule && layout.moduleRoots.length > 0) {
        for (const moduleRoot of layout.moduleRoots) {
          dossierTargets.push({ type: 'module', root: moduleRoot, layout });
        }
      } else {
        for (const module of layout.internalModules) {
          dossierTargets.push({ type: 'synthetic', root: `${layout.appRoot}::${module.name}`, layout, module });
        }
      }
    }
  } else {
    for (const moduleRoot of (analysis.modules.length ? analysis.modules : ['.'])) {
      dossierTargets.push({ type: 'module', root: moduleRoot, layout: undefined });
    }
  }

  return dossierTargets.map((target) => {
    const modulePath = target.root === '.' ? '' : target.root.replace(/\/+$/g, '');
    const matchesModule = (file: string): boolean => {
      const normalized = relativePath(file, analysis.projectRoot).split(sep).join('/');
      if (target.type === 'synthetic' && target.layout && target.module) {
        return fileMatchesSyntheticModule(normalized, target.layout.appRoot, target.module);
      }
      if (!modulePath) return !normalized.includes('/');
      return normalized === modulePath || normalized.startsWith(`${modulePath}/`);
    };

    const moduleJavaCatalog = analysis.javaCatalog.filter((item) => matchesModule(item.file));
    const moduleEndpoints = analysis.endpointCatalog.filter((item) => matchesModule(item.file));
    const moduleSchemaHints = analysis.schemaHints.filter((item) => matchesModule(item.file));
    const moduleSqlFiles = analysis.sqlCatalog.filter((item) => matchesModule(item.file));
    const packageRoots = unique(
      moduleJavaCatalog
        .map((item) => item.packageName)
        .filter((value): value is string => Boolean(value))
        .map((value) => value.split('.').slice(0, 4).join('.')),
    );

    const http = unique(
      moduleEndpoints
        .map((item) => `${item.method} ${item.path} -> ${item.typeName ?? pathBase(item.file)}`)
        .sort((left, right) => left.localeCompare(right)),
    );

    const integration = unique(
      moduleJavaCatalog.flatMap((item) => item.integrationHints).filter((hint) => /websocket|kafka|listener|feign|mail|redis|s3|minio|http/i.test(hint)),
    ).sort((left, right) => left.localeCompare(right));

    const internal = unique([
      ...moduleJavaCatalog.filter((item) => item.kind === 'service' || item.kind === 'controller' || item.kind === 'repository').map((item) => `${item.kind}: ${item.typeName ?? pathBase(item.file)}`),
      ...moduleJavaCatalog.filter((item) => item.kind === 'configuration' || item.kind === 'policy').map((item) => `${item.kind}: ${item.typeName ?? pathBase(item.file)}`),
    ]).sort((left, right) => left.localeCompare(right));

    const persistence = unique([
      ...moduleJavaCatalog.flatMap((item) => item.persistenceHints).filter(Boolean),
      ...moduleSchemaHints.map((hint) => `${hint.tableName ?? hint.typeName ?? pathBase(hint.file)}${hint.primaryKey?.length ? ` pk(${hint.primaryKey.join(', ')})` : ''}`),
      ...moduleSqlFiles.map((item) => relativePath(item.file, analysis.projectRoot)),
    ]).sort((left, right) => left.localeCompare(right));

    const flowTraces = deriveModuleFlowTraces(moduleEndpoints, moduleJavaCatalog, moduleSchemaHints, moduleSqlFiles);
    const observations = unique([
      moduleEndpoints.length ? `http endpoints: ${moduleEndpoints.length}` : '',
      moduleJavaCatalog.some((item) => item.kind === 'service') ? 'service orchestration present' : '',
      moduleJavaCatalog.some((item) => item.kind === 'repository') ? 'persistence adapter present' : '',
      moduleSchemaHints.length ? 'schema hints present' : '',
      moduleSqlFiles.length ? 'migration or SQL assets present' : '',
      target.type === 'synthetic' && target.module ? `synthetic module detected from ${target.module.source}` : '',
    ]).filter(Boolean);
    const componentSummary = {
      controllers: moduleJavaCatalog.filter((item) => item.kind === 'controller').length,
      services: moduleJavaCatalog.filter((item) => item.kind === 'service').length,
      repositories: moduleJavaCatalog.filter((item) => item.kind === 'repository').length,
      entities: moduleJavaCatalog.filter((item) => item.kind === 'entity').length,
      configs: moduleJavaCatalog.filter((item) => item.kind === 'configuration').length,
      jobs: moduleJavaCatalog.filter((item) => item.kind === 'job').length,
      listeners: moduleJavaCatalog.filter((item) => item.kind === 'listener').length,
      security: moduleJavaCatalog.filter((item) => item.securityHints.length > 0).length,
      endpoints: moduleEndpoints.length,
      sqlFiles: moduleSqlFiles.length,
      schemaHints: moduleSchemaHints.length,
    };
    const prompt = buildModuleReconnaissancePrompt({
      moduleRoot: modulePath || '.',
      packageRoots,
      componentSummary,
      interfaceCatalog: {
        http,
        integration,
        internal,
        persistence,
      },
      flowTraces,
      persistenceNotes: persistence,
      observations,
    });

    return {
      moduleRoot: modulePath || '.',
      packageRoots,
      prompt,
      componentSummary,
      interfaceCatalog: {
        http,
        integration,
        internal,
        persistence,
      },
      flowTraces,
      persistenceNotes: persistence,
      observations,
    };
  });
}

function fileBelongsToApplication(file: string, appRoot: string, projectRoot: string): boolean {
  const normalized = relativePath(file, projectRoot).split(sep).join('/');
  if (!appRoot || appRoot === '.' || appRoot === basename(projectRoot)) {
    return true;
  }
  return normalized === appRoot || normalized.startsWith(`${appRoot}/`);
}

function collectDeterministicInternalModules(
  appRoot: string,
  projectRoot: string,
  appAstFiles: JavaAstFile[],
  appYamlFiles: string[],
  appSqlFiles: string[],
): ApplicationLayoutSummary['internalModules'] {
  const commonPackagePrefix = longestCommonPackagePrefix(appAstFiles.map((astFile) => astFile.packageName).filter((value): value is string => Boolean(value)));
  const modules = new Map<string, ApplicationLayoutSummary['internalModules'][number]>();
  const addModule = (name: string, purpose?: string, source: 'deterministic' | 'local-ai' = 'deterministic', pathHint?: string) => {
    const key = name.trim();
    if (!key) return;
    const existing = modules.get(key);
    const merged = existing ?? { name: key, purpose: purpose ?? inferInternalModulePurpose(key), source, pathHints: [] };
    if (purpose && (!existing || existing.purpose === inferInternalModulePurpose(key))) {
      merged.purpose = purpose;
    }
    if (source === 'local-ai') {
      merged.source = 'local-ai';
    }
    if (pathHint && !merged.pathHints.includes(pathHint)) {
      merged.pathHints.push(pathHint);
    }
    modules.set(key, merged);
  };

  for (const astFile of appAstFiles) {
    const normalized = relativePath(astFile.file, projectRoot).split(sep).join('/');
    const relativeJava = normalized.match(/src\/main\/java\/(.*)$/i)?.[1] ?? '';
    const pathParts = relativeJava.split('/').filter(Boolean);
    let segment = '';
    if (astFile.types.some((type) => /Application$/.test(type.name))) {
      segment = 'app';
    }
    if (!segment && astFile.packageName && commonPackagePrefix) {
      const packageSegments = astFile.packageName.split('.');
      const prefixLength = commonPackagePrefix.split('.').length;
      segment = packageSegments[prefixLength] ?? '';
    }
    if (!segment && pathParts.length > 1) {
      segment = pathParts[pathParts.length - 2];
    }
    if (segment) {
      addModule(normalizeInternalModuleName(segment), inferInternalModulePurpose(segment), 'deterministic', segment);
    }
  }

  if (appYamlFiles.length) addModule('resources', 'runtime resource files and imported configuration', 'deterministic', 'src/main/resources');
  if (appYamlFiles.some((file) => /application\.ya?ml$/i.test(file))) addModule('application.yml', 'application bootstrap configuration', 'deterministic', 'application.yml');
  if (appYamlFiles.some((file) => /cors-config\.ya?ml$/i.test(file))) addModule('cors-config.yml', 'CORS policy configuration', 'deterministic', 'cors-config');
  if (appYamlFiles.some((file) => /openapi\/.+\.ya?ml$/i.test(file))) addModule('openapi', 'OpenAPI contract resources', 'deterministic', 'openapi');
  if (appSqlFiles.length) addModule('db/migration', 'database migration scripts', 'deterministic', 'db/migration');

  return [...modules.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function collectInternalModulesWithLocalAi(
  projectRoot: string,
  appRoot: string,
  deterministicModules: ApplicationLayoutSummary['internalModules'],
  appAstFiles: JavaAstFile[],
  appYamlFiles: string[],
  appSqlFiles: string[],
): Promise<ApplicationLayoutSummary['internalModules']> {
  if (!deterministicModules.length) {
    return [];
  }
  const prompt = [
    'You are identifying internal modules/components inside a single Maven application that is not split into child Maven modules.',
    'Return strict JSON: {"components":[{"name":"...","purpose":"...","pathHints":["..."]}]}',
    'Do not invent components not supported by file/package evidence.',
    `Application root: ${appRoot}`,
    'Deterministic candidates:',
    JSON.stringify(deterministicModules, null, 2),
    'Java package/files:',
    JSON.stringify(appAstFiles.slice(0, 80).map((astFile) => ({ file: astFile.file, packageName: astFile.packageName, types: astFile.types.map((type) => type.name) })), null, 2),
    'YAML resources:',
    JSON.stringify(appYamlFiles, null, 2),
    'SQL resources:',
    JSON.stringify(appSqlFiles, null, 2),
  ].join('\n');
  const raw = await runLocalDiscoveryPrompt(projectRoot, prompt);
  if (!raw) {
    return [];
  }
  return parseInternalModulesFromAi(raw);
}

function parseInternalModulesFromAi(raw: string): ApplicationLayoutSummary['internalModules'] {
  try {
    const parsed = JSON.parse(raw) as { components?: Array<{ name?: string; purpose?: string; pathHints?: string[] }> };
    return (parsed.components ?? [])
      .map((item) => ({
        name: normalizeInternalModuleName(String(item.name ?? '')),
        purpose: String(item.purpose ?? ''),
        source: 'local-ai' as const,
        pathHints: Array.isArray(item.pathHints) ? item.pathHints.map((hint) => String(hint)) : [],
      }))
      .filter((item) => item.name);
  } catch {
    return [];
  }
}

function mergeInternalModules(
  deterministicModules: ApplicationLayoutSummary['internalModules'],
  aiModules: ApplicationLayoutSummary['internalModules'],
): ApplicationLayoutSummary['internalModules'] {
  const merged = new Map<string, ApplicationLayoutSummary['internalModules'][number]>();
  for (const item of deterministicModules) {
    merged.set(item.name, { ...item, pathHints: [...item.pathHints] });
  }
  for (const item of aiModules) {
    const existing = merged.get(item.name);
    if (existing) {
      existing.purpose = item.purpose || existing.purpose;
      existing.source = 'local-ai';
      existing.pathHints = unique([...existing.pathHints, ...item.pathHints]);
    } else {
      merged.set(item.name, { ...item, purpose: item.purpose || inferInternalModulePurpose(item.name) });
    }
  }
  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function fileMatchesSyntheticModule(
  normalizedRelativePath: string,
  appRoot: string,
  module: ApplicationLayoutSummary['internalModules'][number],
): boolean {
  if (!normalizedRelativePath.startsWith(`${appRoot}/`)) {
    return false;
  }
  const pathInsideApp = normalizedRelativePath.slice(appRoot.length + 1);
  return module.pathHints.some((hint) => pathInsideApp.includes(hint));
}

function longestCommonPackagePrefix(packageNames: string[]): string {
  if (!packageNames.length) return '';
  const split = packageNames.map((value) => value.split('.'));
  const prefix: string[] = [];
  for (let index = 0; ; index += 1) {
    const candidate = split[0]?.[index];
    if (!candidate) break;
    if (split.every((parts) => parts[index] === candidate)) {
      prefix.push(candidate);
      continue;
    }
    break;
  }
  return prefix.join('.');
}

function normalizeInternalModuleName(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\.java$/i, '').trim();
  if (/^repository$/i.test(normalized)) return 'repository';
  if (/^domain$/i.test(normalized)) return 'domain';
  if (/^ws$/i.test(normalized)) return 'ws';
  return normalized;
}

function inferInternalModulePurpose(name: string): string {
  const normalized = normalizeInternalModuleName(name).toLowerCase();
  if (normalized === 'api') return 'API contracts, endpoint families, and transport-facing DTOs';
  if (normalized === 'app') return 'application entrypoint and runtime bootstrap';
  return inferInternalModulePurpose2(normalized);
}

function inferInternalModulePurpose2(normalized: string): string {
  if (normalized === 'config') return 'runtime and framework configuration';
  if (normalized === 'controller' || normalized === 'web') return 'HTTP/web ingress handling';
  if (normalized === 'domain' || normalized === 'entity') return 'domain entities and persisted state models';
  if (normalized === 'dto') return 'transport and API payload models';
  if (normalized === 'redis') return 'Redis ingestion and message transport';
  if (normalized === 'repository' || normalized === 'repo' || normalized === 'persistence') return 'persistence adapters and database queries';
  if (normalized === 'security') return 'authentication and authorization helpers';
  if (normalized === 'service') return 'application orchestration and business logic';
  if (normalized === 'ws' || normalized === 'websocket') return 'realtime websocket delivery';
  if (normalized === 'resources') return 'runtime resource files and configuration assets';
  if (normalized == 'application.yml') return 'application bootstrap configuration';
  if (normalized == 'cors-config.yml') return 'CORS policy configuration';
  if (normalized == 'openapi') return 'OpenAPI contract resources';
  if (normalized == 'db/migration') return 'database migration scripts';
  return 'application-internal component bucket';
}

function deriveModuleFlowTraces(
  endpoints: JavaEndpointSummary[],
  catalog: JavaArtifactSummary[],
  schemaHints: SchemaHint[],
  sqlFiles: SqlArtifactSummary[],
): string[] {
  const traces = new Set<string>();
  if (endpoints.length > 0) {
    for (const entry of endpoints.slice(0, 12)) {
      traces.add(`${entry.method} ${entry.path} -> ${entry.typeName ?? pathBase(entry.file)}`);
    }
  }
  if (catalog.some((item) => item.kind === 'controller') && catalog.some((item) => item.kind === 'service')) {
    traces.add('controller -> service orchestration -> repository or integration adapter -> response');
  }
  if (catalog.some((item) => item.kind === 'service') && catalog.some((item) => item.integrationHints.some((hint) => /websocket|kafka|mail|minio|s3|redis/i.test(hint)))) {
    traces.add('service -> integration adapter -> external side effect');
  }
  if (schemaHints.length > 0 || sqlFiles.length > 0) {
    traces.add('service -> persistence boundary -> SQL / schema asset');
  }
  return [...traces];
}

export function buildReconnaissancePrompt(analysis: SourceProjectAnalysis, moduleDossiers: Omit<ModuleDossier, 'prompt'>[]): string {
  const moduleList = moduleDossiers.length ? moduleDossiers.map((module) => `- ${module.moduleRoot}`).join('\n') : '- single module / unresolved';
  const knowledgeGraph = analysis.codeKnowledgeGraph;
  return `# reconnaissance prompt\n\n` +
    `You are scanning a Java/Maven codebase for a technical specification.\n\n` +
    `## goals\n` +
    `- identify every Maven module and describe its responsibilities\n` +
    `- classify interfaces into HTTP/Web ingress, integration interfaces, internal service boundaries, and persistence surfaces\n` +
    `- for API contract modules, identify API families, auth requirements, permission hints, client contracts, generated DTO usage, enum roles, and Swagger/validation signals\n` +
    `- for app/bootstrap modules, identify the application entry point, imported runtime configs, security/bootstrap beans, Flyway, Actuator, and runtime infrastructure settings\n` +
    `- for persistence modules, distinguish JPA repositories from SQL-first adapters, summarize each repository purpose, and identify mapper / entity responsibilities\n` +
    `- for service modules, identify scheduler configuration, cron jobs, async listeners, event trigger sources, dashboard/statistics updaters, and exception translation patterns\n` +
    `- keep external connections separate from the software architecture lane diagram\n` +
    `- trace real service flows from ingress to persistence and external side effects\n` +
    `- prioritize migration / SQL assets over ORM-only guesses for database shape\n` +
    `- produce a rewrite-ready technical specification, not a vague summary\n\n` +
    `## code graph summary\n` +
    `${knowledgeGraph
      ? [
          `- endpoint families: ${knowledgeGraph.summary.endpointFamilies.slice(0, 10).map((family) => `${family.family} (${family.count})`).join(' | ') || 'none'}`,
          `- api families: ${knowledgeGraph.summary.apiFamilies.slice(0, 10).map((family) => `${family.family} [${family.authMode}]`).join(' | ') || 'none'}`,
          `- api clients: ${knowledgeGraph.summary.apiClientNames.slice(0, 10).join(' | ') || 'none'}`,
          `- api enums: ${knowledgeGraph.summary.apiEnumNames.slice(0, 12).join(' | ') || 'none'}`,
          `- service names: ${knowledgeGraph.summary.serviceNames.slice(0, 12).join(' | ') || 'none'}`,
          `- persistence targets: ${knowledgeGraph.summary.persistenceTargets.slice(0, 12).join(' | ') || 'none'}`,
          `- external systems: ${knowledgeGraph.summary.externalSystems.slice(0, 12).join(' | ') || 'none'}`,
          `- flow traces: ${knowledgeGraph.summary.flowTraces.slice(0, 12).join(' | ') || 'none'}`,
          `- schema tables: ${knowledgeGraph.summary.schemaTables.slice(0, 12).map((table) => table.name).join(' | ') || 'none'}`,
        ].join('\n')
      : '- no code graph summary available'}\n\n` +
    `## module order\n` +
    `${moduleList}\n\n` +
    `## scanning rules\n` +
    `- inspect modules one by one\n` +
    `- within each module, inspect controllers, services, repositories, entities, configs, jobs, listeners, and migrations\n` +
    `- if a module contains business logic, trace the full request / command flow in that module\n` +
    `- separate HTTP ingress families from integration interfaces such as websocket, redis, mail, kafka, external HTTP clients, and object storage\n` +
    `- treat OpenAPI-generated API contracts, DTOs, enums, and Swagger annotations as API-surface evidence, not as service-layer behavior\n` +
    `- treat scheduled jobs and async listeners as processes, not as web ingress\n` +
    `- treat object storage, migration SQL, and database engines as persistence, not as web service layer\n` +
    `- trust Flyway / Liquibase / SQL schema files before JPA annotations when inferring database structure\n` +
    `- capture explicit states, transitions, side effects, and persistence ownership\n\n` +
    `- keep API documentation out of the architecture diagram; it belongs in discovery notes only\n\n` +
    `## output contract\n` +
    `- module dossier\n` +
    `- interface classification\n` +
    `- flow trace list\n` +
    `- persistence / schema summary\n` +
    `- gaps and assumptions\n` +
    `- rewrite-ready technical notes\n\n` +
    `## source summary\n` +
    `- modules: ${analysis.modules.length}\n` +
    `- controllers: ${analysis.counts.controllers}\n` +
    `- services: ${analysis.counts.services}\n` +
    `- repositories: ${analysis.counts.repositories}\n` +
    `- entities: ${analysis.counts.entities}\n` +
    `- sql files: ${analysis.counts.sqlFiles}\n` +
    `- schema hints: ${analysis.schemaHints.length}\n`;
}

export function buildModuleReconnaissancePrompt(dossier: Omit<ModuleDossier, 'prompt'>): string {
  return `# module reconnaissance: ${dossier.moduleRoot}\n\n` +
    `## goals\n` +
    `- describe the module boundaries and the components inside the module\n` +
    `- classify ingress, integration, internal, and persistence interfaces separately\n` +
    `- if the module is API-facing, identify API families, auth requirements, permission hints, clients, generated DTOs, enums, and Swagger/validation signals\n` +
    `- if the module is the application bootstrap layer, identify the main entry point, imported config files, runtime/security bean configs, Flyway, Actuator, and infra settings\n` +
    `- if the module is persistence-facing, separate JPA-based repositories from SQL-first adapters, summarize repository purposes and operation groups, and identify mapper / entity responsibilities\n` +
    `- if the module contains jobs or listeners, identify cron cadence, async execution model, trigger events, source methods, and database side effects\n` +
    `- trace the real request / command flow through the module\n` +
    `- identify persistence assets and migration / schema evidence\n\n` +
    `## summary\n` +
    `- package roots: ${dossier.packageRoots.join(', ') || 'none detected'}\n` +
    `- controllers: ${dossier.componentSummary.controllers}\n` +
    `- services: ${dossier.componentSummary.services}\n` +
    `- repositories: ${dossier.componentSummary.repositories}\n` +
    `- entities: ${dossier.componentSummary.entities}\n` +
    `- configs: ${dossier.componentSummary.configs}\n` +
    `- jobs: ${dossier.componentSummary.jobs}\n` +
    `- listeners: ${dossier.componentSummary.listeners}\n` +
    `- security classes: ${dossier.componentSummary.security}\n` +
    `- endpoints: ${dossier.componentSummary.endpoints}\n` +
    `- sql files: ${dossier.componentSummary.sqlFiles}\n` +
    `- schema hints: ${dossier.componentSummary.schemaHints}\n\n` +
    `## interface classification\n` +
    `- http ingress families: ${dossier.interfaceCatalog.http.join(' | ') || 'none'}\n` +
    `- integration interfaces: ${dossier.interfaceCatalog.integration.join(' | ') || 'none'}\n` +
    `- internal service boundaries: ${dossier.interfaceCatalog.internal.join(' | ') || 'none'}\n` +
    `- persistence surfaces: ${dossier.interfaceCatalog.persistence.join(' | ') || 'none'}\n\n` +
    `## flow traces\n` +
    `${dossier.flowTraces.length ? dossier.flowTraces.map((trace) => `- ${trace}`).join('\n') : '- none'}\n\n` +
    `## persistence notes\n` +
    `${dossier.persistenceNotes.length ? dossier.persistenceNotes.map((note) => `- ${note}`).join('\n') : '- none'}\n\n` +
    `## observations\n` +
    `${dossier.observations.length ? dossier.observations.map((observation) => `- ${observation}`).join('\n') : '- none'}\n\n` +
    `## instruction\n` +
    `Walk the source at this module root deeply. Prefer actual class, method, SQL migration, and annotation evidence over heuristics. Return a module dossier, not a summary.\n`;
}

function isStageAtOrAfter(resumeFromStage: SourceLearningImportOptions['resumeFromStage'], stage: 'snapshot' | 'graph' | 'prompt'): boolean {
  const order: Record<NonNullable<SourceLearningImportOptions['resumeFromStage']>, number> = {
    ast: 0,
    analysis: 1,
    snapshot: 2,
    graph: 3,
    prompt: 4,
    modules: 5,
    semantic: 6,
  };
  return order[resumeFromStage ?? 'ast'] >= order[stage];
}

async function collectFiles(
  root: string,
  suffixOrPattern: string | RegExp,
  secondary?: string,
  onProgress?: (event: {
    phase: 'files' | 'java' | 'packages' | 'sql';
    message: string;
    currentFile?: string;
    completed?: number;
    total?: number;
  }) => void | Promise<void>,
): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  let visited = 0;
  while (queue.length) {
    const current = queue.pop();
    if (!current) continue;
    if (basename(current) === '.ai-native') continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) continue;
        queue.push(full);
        continue;
      }
      if (typeof suffixOrPattern === 'string') {
        if ((full.endsWith(suffixOrPattern) || (secondary && full.endsWith(secondary))) && !shouldSkipFile(full)) files.push(full);
      } else if (suffixOrPattern.test(full)) {
        if (!shouldSkipFile(full)) files.push(full);
      }
      visited += 1;
      if (visited % 250 === 0) {
        await onProgress?.({ phase: 'files', message: `Scanning ${visited} entries; found ${files.length} matches`, currentFile: full, completed: visited });
        await yieldToEventLoop();
      }
    }
  }
  return files.sort();
}

async function buildDirectorySnapshot(root: string): Promise<{ directories: string[]; files: string[] }> {
  const directories: string[] = [];
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (shouldSkipDirectory(entry.name)) continue;
    if (entry.isDirectory()) directories.push(entry.name);
    else files.push(entry.name);
  }
  return { directories, files };
}

function shouldSkipDirectory(name: string): boolean {
  return name === 'target' || name === 'node_modules' || name === '.git' || name === '.idea' || name === '.ai-native' || name === '.codex' || name === '.agentor' || name === 'runs' || name === 'dist' || name === 'build';
}

function shouldSkipFile(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  if (/\/docker\//.test(normalized)) return true;
  if (/(^|\/)(docker-compose|compose)\.(ya?ml)$/.test(normalized)) return true;
  if (/(^|\/)dockerfile(\.[^/]+)?$/.test(normalized)) return true;
  if (/\/k8s\/|\/helm\/|\/terraform\//.test(normalized)) return true;
  if (/(^|\/)(deployment|service|ingress|values)\.(ya?ml)$/.test(normalized)) return true;
  return false;
}

async function collectPomKeywords(files: string[]): Promise<string[]> {
  const keywords: string[] = [];
  await Promise.all(
    files.map(async (file) => {
      const text = (await readFile(file, 'utf8')).toLowerCase();
      for (const keyword of ['spring-boot', 'spring-security', 'jwt', 'postgresql', 'redis', 'flyway', 'websocket', 'openapi', 'minio', 'mail', 'lombok', 's3']) {
        if (text.includes(keyword)) keywords.push(keyword);
      }
    }),
  );
  return unique(keywords);
}

async function collectYamlKeywords(files: string[]): Promise<string[]> {
  const keywords: string[] = [];
  await Promise.all(
    files.map(async (file) => {
      const text = (await readFile(file, 'utf8')).toLowerCase();
      for (const keyword of ['spring', 'datasource', 'redis', 'flyway', 'jwt', 'turnstile', 'mail', 'minio', 'cors', 'security']) {
        if (text.includes(keyword)) keywords.push(keyword);
      }
    }),
  );
  return unique(keywords);
}

async function collectJavaSignals(
  files: string[],
  onProgress?: (event: {
    phase: 'files' | 'java' | 'packages' | 'sql';
    message: string;
    currentFile?: string;
    completed?: number;
    total?: number;
  }) => void | Promise<void>,
): Promise<JavaSignalBundle> {
  const parsedFiles: Array<{ file: string; text: string; ast: JavaAstFile }> = [];
  let index = 0;
  for (const file of files) {
    index += 1;
    const text = await readFile(file, 'utf8');
    parsedFiles.push({
      file,
      text,
      ast: parseJavaSourceFile(file, text),
    });
    if (index % 25 === 0 || index === files.length) {
      await onProgress?.({ phase: 'java', message: `Parsed ${index}/${files.length} Java files into AST`, currentFile: file, completed: index, total: files.length });
      await yieldToEventLoop();
    }
  }

  const controllers: string[] = [];
  const services: string[] = [];
  const repositories: string[] = [];
  const entities: string[] = [];
  const policies: string[] = [];
  const configs: string[] = [];
  const jobs: string[] = [];
  const listeners: string[] = [];
  const security: string[] = [];
  const scheduled: string[] = [];
  const websocket: string[] = [];
  const events: string[] = [];
  const catalog: JavaArtifactSummary[] = [];
  const endpoints: JavaEndpointSummary[] = [];
  const schemaHints: SchemaHint[] = [];
  const javaAstCatalog: JavaAstFile[] = [];

  for (const { file, text, ast } of parsedFiles) {
    javaAstCatalog.push(ast);
    const lower = text.toLowerCase();
    const primaryAstType = ast.types[0];
    const packageName = ast.packageName ?? extractPackageName(text);
    const typeName = primaryAstType?.name ?? extractTypeName(text);
    const typeAnnotations = unique([
      ...collectAnnotations(text, [
        'RestController',
        'Controller',
        'Service',
        'Repository',
        'Entity',
        'Table',
        'Configuration',
        'Config',
        'PreAuthorize',
        'Secured',
        'RolesAllowed',
        'SecurityFilterChain',
        'Scheduled',
        'EventListener',
        'KafkaListener',
        'MessageListener',
        'FeignClient',
        'Async',
        'Component',
        'Bean',
      ]),
      ...ast.types.flatMap((type) => type.annotations),
    ]);
    const endpointSpecs = extractEndpointSpecifications(text);
    const persistenceHints = collectPersistenceHints(text);
    const securityHints = collectSecurityHints(text);
    const integrationHints = unique([
      ...collectIntegrationHints(text, file),
      ...ast.types.flatMap((type) => type.methods.flatMap((method) => method.annotations)),
    ]);
    const inferredKind = inferJavaKind(file, text);
    const rel = file;
    const combinedKinds = new Set([
      ...ast.types.map((type) => inferJavaKind(`${file}.${type.name}.java`, `${type.annotations.join(' ')} ${type.modifiers.join(' ')}`)),
      inferredKind,
    ]);

    if ([...combinedKinds].some((kind) => kind === 'controller')) controllers.push(rel);
    if ([...combinedKinds].some((kind) => kind === 'service')) services.push(rel);
    if ([...combinedKinds].some((kind) => kind === 'repository')) repositories.push(rel);
    if ([...combinedKinds].some((kind) => kind === 'entity')) entities.push(rel);
    if ([...combinedKinds].some((kind) => kind === 'configuration')) configs.push(rel);
    if (/(@preauthorize|@secured|@rolesallowed|@securityfilterchain|security)/i.test(text) || /security\//i.test(file)) security.push(rel);
    if (/(@scheduled)/i.test(text) || /\/jobs\//i.test(file)) jobs.push(rel);
    if (/(@eventlistener|@kafkalistener|@messagelistener)/i.test(text) || /\/listeners\//i.test(file)) listeners.push(rel);
    if (/(@scheduled)/i.test(text)) scheduled.push(rel);
    if (/websocket/i.test(text) || /websocket/i.test(file)) websocket.push(rel);
    if (/(@eventlistener|event\b|domain event|integration event)/i.test(text)) events.push(rel);
    if (/policy/i.test(file) || /policy/i.test(text)) policies.push(rel);

    for (const endpoint of endpointSpecs) {
      endpoints.push({
        file,
        typeName,
        method: endpoint.method,
        path: endpoint.path,
        source: endpoint.source,
      });
    }

    if (typeName || typeAnnotations.length || endpointSpecs.length || persistenceHints.length || securityHints.length || integrationHints.length) {
      catalog.push({
        file,
        packageName,
        typeName,
        kind: inferredKind,
        annotations: typeAnnotations,
        endpoints: endpointSpecs.map((entry) => `${entry.method} ${entry.path}`),
        persistenceHints,
        securityHints,
        integrationHints,
      });
    }

    if (isEntityLikeSource(file, packageName, typeAnnotations, inferredKind, persistenceHints)) {
      if (inferredKind === 'repository' || /repository/i.test(typeName ?? '') || /\/repository\//i.test(file)) {
        continue;
      }
      const entityBlueprint = extractJavaEntityBlueprint(text, typeName);
      schemaHints.push({
        file,
        typeName,
        tableName: entityBlueprint.tableName ?? inferTableName(text, typeName),
        columns: entityBlueprint.fields.map((field) => field.name),
        relationships: entityBlueprint.relationships,
        annotations: typeAnnotations,
        primaryKey: entityBlueprint.primaryKey,
        fields: entityBlueprint.fields,
        sourceKind: 'entity',
      });
    }
  }

  return {
    controllers: unique(controllers),
    services: unique(services),
    repositories: unique(repositories),
    entities: unique(entities),
    policies: unique(policies),
    configs: unique(configs),
    jobs: unique(jobs),
    listeners: unique(listeners),
    security: unique(security),
    scheduled: unique(scheduled),
    websocket: unique(websocket),
    events: unique(events),
    javaAstCatalog,
    catalog: uniqueBy(catalog, (item) => `${item.file}|${item.typeName ?? ''}|${item.kind}`),
    endpoints: uniqueBy(endpoints, (item) => `${item.file}|${item.method}|${item.path}|${item.typeName ?? ''}`),
    schemaHints: uniqueBy(schemaHints, (item) => `${item.file}|${item.typeName ?? ''}|${item.tableName ?? ''}`),
  };
}

async function collectJavaSignalsFromAst(
  astCatalog: JavaAstFile[],
  javaFiles: string[],
  onProgress?: (event: {
    phase: 'files' | 'java' | 'packages' | 'sql';
    message: string;
    currentFile?: string;
    completed?: number;
    total?: number;
  }) => void | Promise<void>,
): Promise<JavaSignalBundle> {
  const endpointSourceFiles = astCatalog.filter((astFile) =>
    astFile.types.some((type) => inferJavaKind(astFile.file, `${type.annotations.join(' ')} ${type.modifiers.join(' ')}`) === 'controller')
      || isHttpContractAstFile(astFile),
  );
  const endpointSourceMap = new Map<string, string>();
  let controllerIndex = 0;
  for (const astFile of endpointSourceFiles) {
    controllerIndex += 1;
    try {
      endpointSourceMap.set(astFile.file, await readFile(astFile.file, 'utf8'));
    } catch {
      // ignore missing source; AST-only fallback remains useful
    }
    if (controllerIndex % 10 === 0 || controllerIndex === endpointSourceFiles.length) {
      await onProgress?.({
        phase: 'java',
        message: `Loaded ${controllerIndex}/${endpointSourceFiles.length} HTTP source files for endpoint extraction`,
        currentFile: astFile.file,
        completed: controllerIndex,
        total: endpointSourceFiles.length,
      });
      await yieldToEventLoop();
    }
  }

  const controllers: string[] = [];
  const services: string[] = [];
  const repositories: string[] = [];
  const entities: string[] = [];
  const policies: string[] = [];
  const configs: string[] = [];
  const jobs: string[] = [];
  const listeners: string[] = [];
  const security: string[] = [];
  const scheduled: string[] = [];
  const websocket: string[] = [];
  const events: string[] = [];
  const catalog: JavaArtifactSummary[] = [];
  const endpoints: JavaEndpointSummary[] = [];
  const schemaHints: SchemaHint[] = [];

  let processed = 0;
  const total = astCatalog.length;
  for (const astFile of astCatalog) {
    processed += 1;
    const packageName = astFile.packageName;
    const typeName = astFile.types[0]?.name ?? basename(astFile.file);
    const typeAnnotations = unique(astFile.types.flatMap((type) => type.annotations));
    const inferredKinds = new Set(astFile.types.map((type) => inferJavaKind(astFile.file, `${type.annotations.join(' ')} ${type.modifiers.join(' ')}`)));
    const inferredKind = inferJavaKind(astFile.file, `${typeAnnotations.join(' ')} ${typeName}`);
    if ([...inferredKinds].some((kind) => kind === 'controller') || inferredKind === 'controller') controllers.push(astFile.file);
    if ([...inferredKinds].some((kind) => kind === 'service') || inferredKind === 'service') services.push(astFile.file);
    if ([...inferredKinds].some((kind) => kind === 'repository') || inferredKind === 'repository') repositories.push(astFile.file);
    if ([...inferredKinds].some((kind) => kind === 'entity') || inferredKind === 'entity') entities.push(astFile.file);
    if ([...inferredKinds].some((kind) => kind === 'configuration') || inferredKind === 'configuration') configs.push(astFile.file);
    if ([...inferredKinds].some((kind) => kind === 'security') || /security\//i.test(astFile.file)) security.push(astFile.file);
    if ([...inferredKinds].some((kind) => kind === 'job') || /\/jobs\//i.test(astFile.file)) jobs.push(astFile.file);
    if ([...inferredKinds].some((kind) => kind === 'listener') || /\/listeners\//i.test(astFile.file)) listeners.push(astFile.file);
    if (/websocket/i.test(astFile.file)) websocket.push(astFile.file);
    if (astFile.types.some((type) => type.annotations.some((annotation) => /EventListener/i.test(annotation)))) events.push(astFile.file);
    if (/policy/i.test(astFile.file)) policies.push(astFile.file);

    const endpointSource = endpointSourceMap.get(astFile.file);
    const endpointSpecs = endpointSource ? extractEndpointSpecifications(endpointSource) : [];
    for (const endpoint of endpointSpecs) {
      endpoints.push({
        file: astFile.file,
        typeName,
        method: endpoint.method,
        path: endpoint.path,
        source: endpoint.source,
      });
    }

    const typeKind = [...inferredKinds][0] ?? inferredKind;
    if (typeName || typeAnnotations.length || endpointSpecs.length) {
      catalog.push({
        file: astFile.file,
        packageName,
        typeName,
        kind: typeKind,
        annotations: typeAnnotations,
        endpoints: endpointSpecs.map((entry) => `${entry.method} ${entry.path}`),
        persistenceHints: collectAstPersistenceHints(astFile),
        securityHints: collectAstSecurityHints(astFile),
        integrationHints: collectAstIntegrationHints(astFile),
      });
    }

    if (isEntityLikeSource(astFile.file, packageName, typeAnnotations, typeKind, collectAstPersistenceHints(astFile))) {
      schemaHints.push(buildSchemaHintFromAst(astFile));
    }

    if (processed % 25 === 0 || processed === total) {
      await onProgress?.({
        phase: 'java',
        message: `Processed ${processed}/${total} AST files`,
        currentFile: astFile.file,
        completed: processed,
        total,
      });
      await yieldToEventLoop();
    }
  }

  return {
    controllers: unique(controllers),
    services: unique(services),
    repositories: unique(repositories),
    entities: unique(entities),
    policies: unique(policies),
    configs: unique(configs),
    jobs: unique(jobs),
    listeners: unique(listeners),
    security: unique(security),
    scheduled,
    websocket: unique(websocket),
    events: unique(events),
    javaAstCatalog: astCatalog,
    catalog: uniqueBy(catalog, (item) => `${item.file}|${item.typeName ?? ''}|${item.kind}`),
    endpoints: uniqueBy(endpoints, (item) => `${item.file}|${item.method}|${item.path}|${item.typeName ?? ''}`),
    schemaHints: uniqueBy(schemaHints, (item) => `${item.file}|${item.typeName ?? ''}|${item.tableName ?? ''}`),
  };
}

async function collectPackageMapFromAst(
  astCatalog: JavaAstFile[],
  onProgress?: (event: {
    phase: 'files' | 'java' | 'packages' | 'sql';
    message: string;
    currentFile?: string;
    completed?: number;
    total?: number;
  }) => void | Promise<void>,
): Promise<Record<string, number>> {
  const packageCounts = new Map<string, number>();
  let index = 0;
  for (const astFile of astCatalog) {
    index += 1;
    if (astFile.packageName) {
      packageCounts.set(astFile.packageName, (packageCounts.get(astFile.packageName) ?? 0) + 1);
    }
    if (index % 50 === 0 || index === astCatalog.length) {
      await onProgress?.({
        phase: 'packages',
        message: `Indexed packages from ${index}/${astCatalog.length} AST files`,
        currentFile: astFile.file,
        completed: index,
        total: astCatalog.length,
      });
      await yieldToEventLoop();
    }
  }
  return Object.fromEntries([...packageCounts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function extractPackageName(text: string): string | undefined {
  const match = text.match(/^\s*package\s+([a-zA-Z0-9_.]+)\s*;/m);
  return match?.[1];
}

function isHttpContractAstFile(astFile: JavaAstFile): boolean {
  const packageName = astFile.packageName ?? '';
  if (!/\.api(?:\.|$)/i.test(packageName) && !/\/api\//i.test(astFile.file)) {
    return false;
  }
  return astFile.types.some((type) => /Api$/.test(type.name));
}

function isEntityLikeSource(
  file: string,
  packageName: string | undefined,
  annotations: string[],
  inferredKind: string,
  persistenceHints: string[],
): boolean {
  const locationText = `${file} ${packageName ?? ''}`.toLowerCase();
  if (inferredKind === 'repository' || /\/repository\//i.test(file)) {
    return false;
  }
  if (annotations.some((annotation) => /^(Entity|Table)$/i.test(annotation))) {
    return true;
  }
  if (/\/dto\//i.test(file) || /\.dto(?:\.|$)/i.test(packageName ?? '') || /\/openapi\//i.test(file) || /\.openapi(?:\.|$)/i.test(packageName ?? '')) {
    return false;
  }
  if (inferredKind === 'entity') {
    return true;
  }
  if (/\/persistence\/entity\//i.test(file) || /\.persistence\.entity(?:\.|$)/i.test(packageName ?? '')) {
    return true;
  }
  if (/\/entity\//i.test(file) || /\.entity(?:\.|$)/i.test(packageName ?? '') || /(?:^|[^a-z])entity(?:[^a-z]|$)/i.test(locationText)) {
    return persistenceHints.some((hint) => /^@(Entity|Table|Column|ManyToOne|OneToMany|ManyToMany|JoinColumn)$/i.test(hint)) || inferredKind === 'entity';
  }
  return persistenceHints.some((hint) => /^@(Entity|Table|Column|ManyToOne|OneToMany|ManyToMany|JoinColumn)$/i.test(hint));
}

function extractTypeName(text: string): string | undefined {
  const match = text.match(/^\s*(?:public|protected|private|abstract|final|static|\s)*\s*(class|interface|record|enum)\s+([A-Za-z0-9_]+)/m);
  return match?.[2];
}

function collectAnnotations(text: string, names: string[]): string[] {
  const found = new Set<string>();
  for (const name of names) {
    const pattern = new RegExp(`@${name}\\b`, 'i');
    if (pattern.test(text)) found.add(name);
  }
  return [...found];
}

function collectPersistenceHints(text: string): string[] {
  const hints = new Set<string>();
  const lower = text.toLowerCase();
  if (/@entity/i.test(text)) hints.add('@Entity');
  if (/@table/i.test(text)) hints.add('@Table');
  if (/@column/i.test(text)) hints.add('@Column');
  if (/@manytoone/i.test(text)) hints.add('@ManyToOne');
  if (/@onetomany/i.test(text)) hints.add('@OneToMany');
  if (/@manytomany/i.test(text)) hints.add('@ManyToMany');
  if (/@joincolumn/i.test(text)) hints.add('@JoinColumn');
  if (/schema\.sql|ddl|create table|alter table|insert into/i.test(lower)) hints.add('sql schema');
  if (/flyway|liquibase|migration/i.test(lower)) hints.add('migration');
  return [...hints];
}

function collectSecurityHints(text: string): string[] {
  const hints = new Set<string>();
  if (/@preauthorize/i.test(text)) hints.add('@PreAuthorize');
  if (/@secured/i.test(text)) hints.add('@Secured');
  if (/@rolesallowed/i.test(text)) hints.add('@RolesAllowed');
  if (/@securityfilterchain/i.test(text)) hints.add('@SecurityFilterChain');
  if (/@authenticationprincipal/i.test(text)) hints.add('@AuthenticationPrincipal');
  if (/oauth|oidc|jwt|csrf|authority|permission|role/i.test(text)) hints.add('authz/authn');
  return [...hints];
}

function collectIntegrationHints(text: string, file: string): string[] {
  const hints = new Set<string>();
  if (/@feignclient/i.test(text)) hints.add('@FeignClient');
  if (/@kafkalistener/i.test(text)) hints.add('@KafkaListener');
  if (/@messagelistener/i.test(text)) hints.add('@MessageListener');
  if (/@eventlistener/i.test(text)) hints.add('@EventListener');
  if (/@scheduled/i.test(text)) hints.add('@Scheduled');
  if (/@async/i.test(text)) hints.add('@Async');
  if (/websocket/i.test(text) || /websocket/i.test(file)) hints.add('WebSocket');
  if (/redis/i.test(text)) hints.add('Redis');
  if (/mail|smtp|ses/i.test(text)) hints.add('Mail');
  if (/minio|s3|object storage/i.test(text)) hints.add('Object storage');
  return [...hints];
}

function inferJavaKind(file: string, text: string): string {
  if (/@restcontroller|@controller/i.test(text) || /controller\.java$/i.test(file)) return 'controller';
  if (/@service/i.test(text) || /service\.java$/i.test(file)) return 'service';
  if (/@repository/i.test(text) || /repository\.java$/i.test(file)) return 'repository';
  if (/@entity/i.test(text) || /entity\.java$/i.test(file)) return 'entity';
  if (/@configuration|@config/i.test(text) || /(?:Config|Configuration)\.java$/i.test(file)) return 'configuration';
  if (/@securityfilterchain|@preauthorize|@secured|@rolesallowed/i.test(text) || /security\//i.test(file)) return 'security';
  if (/@scheduled/i.test(text) || /\/jobs\//i.test(file)) return 'job';
  if (/@eventlistener|@kafkalistener|@messagelistener/i.test(text) || /\/listeners\//i.test(file)) return 'listener';
  if (/websocket/i.test(text) || /websocket/i.test(file)) return 'websocket';
  return 'component';
}

function extractEndpointSpecifications(text: string): Array<{ method: string; path: string; source: string }> {
  const results: Array<{ method: string; path: string; source: string }> = [];
  const mappingPatterns = [
    { method: 'GET', regex: /@GetMapping(?:\(\s*["']([^"']+)["']\s*\)|\(\s*value\s*=\s*["']([^"']+)["']\s*\))/gi, source: '@GetMapping' },
    { method: 'POST', regex: /@PostMapping(?:\(\s*["']([^"']+)["']\s*\)|\(\s*value\s*=\s*["']([^"']+)["']\s*\))/gi, source: '@PostMapping' },
    { method: 'PUT', regex: /@PutMapping(?:\(\s*["']([^"']+)["']\s*\)|\(\s*value\s*=\s*["']([^"']+)["']\s*\))/gi, source: '@PutMapping' },
    { method: 'DELETE', regex: /@DeleteMapping(?:\(\s*["']([^"']+)["']\s*\)|\(\s*value\s*=\s*["']([^"']+)["']\s*\))/gi, source: '@DeleteMapping' },
    { method: 'PATCH', regex: /@PatchMapping(?:\(\s*["']([^"']+)["']\s*\)|\(\s*value\s*=\s*["']([^"']+)["']\s*\))/gi, source: '@PatchMapping' },
  ];

  for (const mapping of mappingPatterns) {
    let match: RegExpExecArray | null;
    while ((match = mapping.regex.exec(text))) {
      const path = match[1] ?? match[2] ?? '/';
      results.push({ method: mapping.method, path, source: mapping.source });
    }
  }

  const requestMappingMatches = [...text.matchAll(/@RequestMapping\(([^)]+)\)/gi)];
  for (const match of requestMappingMatches) {
    const raw = match[1] ?? '';
    const pathMatch = raw.match(/(?:path|value)\s*=\s*["']([^"']+)["']/i) ?? raw.match(/["']([^"']+)["']/);
    const methodMatch = raw.match(/RequestMethod\.([A-Z]+)/i);
    results.push({
      method: methodMatch?.[1]?.toUpperCase() ?? 'REQUEST',
      path: pathMatch?.[1] ?? '/',
      source: '@RequestMapping',
    });
  }

  return results;
}

function inferTableName(text: string, typeName?: string): string | undefined {
  const tableMatch = text.match(/@Table\s*\(\s*name\s*=\s*["']([^"']+)["']/i);
  if (tableMatch?.[1]) return tableMatch[1];
  return typeName ? toSnakeCase(`${typeName}s`) : undefined;
}

function extractJavaEntityBlueprint(text: string, typeName?: string): {
  tableName?: string;
  primaryKey: string[];
  fields: Array<{
    name: string;
    type?: string;
    annotations: string[];
    detail?: string;
    nullable?: boolean;
    relation?: string;
  }>;
  relationships: string[];
} {
  const tableName = inferTableName(text, typeName);
  const classBody = extractPrimaryTypeBody(text);
  const fieldBlueprints = collectJavaFieldBlueprints(classBody ?? text);
  const primaryKey = unique([
    ...collectExplicitPrimaryKeyColumns(text),
    ...fieldBlueprints.filter((field) => field.annotations.some((annotation) => /Id$/i.test(annotation) || annotation === 'Id')).map((field) => field.name),
  ]);

  const relationships = unique([
    ...collectJavaRelationshipHints(text),
    ...fieldBlueprints
      .filter((field) => field.relation)
      .map((field) => `${field.name}${field.relation ? ` -> ${field.relation}` : ''}`),
  ]);

  return {
    tableName,
    primaryKey,
    fields: fieldBlueprints,
    relationships,
  };
}

function extractPrimaryTypeBody(text: string): string | undefined {
  const typeMatch = text.match(/\b(class|record|interface|enum)\s+[A-Za-z0-9_]+\b/);
  if (!typeMatch || typeMatch.index === undefined) return undefined;

  const openIndex = text.indexOf('{', typeMatch.index);
  if (openIndex < 0) return undefined;

  let depth = 0;
  let inString: string | undefined;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];
    if (inString) {
      if (char === inString && previous !== '\\') {
        inString = undefined;
      }
      continue;
    }
    if (char === '"' || char === '\'') {
      inString = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(openIndex + 1, index);
      }
    }
  }

  return undefined;
}

function collectJavaFieldBlueprints(text: string): Array<{
  name: string;
  type?: string;
  annotations: string[];
  detail?: string;
  nullable?: boolean;
  relation?: string;
}> {
  const lines = text.split(/\r?\n/);
  const fields: Array<{
    name: string;
    type?: string;
    annotations: string[];
    detail?: string;
    nullable?: boolean;
    relation?: string;
  }> = [];
  const pendingAnnotations: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pendingAnnotations.length = 0;
      continue;
    }

    const annotationMatches = [...line.matchAll(/@([A-Za-z0-9_]+)(?:\(([^)]*)\))?/g)];
    if (annotationMatches.length > 0) {
      pendingAnnotations.push(...annotationMatches.map((match) => match[1]));
      if (/^(?:@interface)\b/i.test(line)) {
        pendingAnnotations.length = 0;
      }
    }

    const fieldMatch = line.match(/^(?:private|protected|public)\s+([A-Za-z0-9_<>,.? ?]+)\s+([A-Za-z0-9_]+)\s*(?:=\s*[^;]+)?;/);
    if (!fieldMatch) {
      continue;
    }

    const type = fieldMatch[1]?.replace(/\s+/g, ' ').trim();
    const name = fieldMatch[2];
    const annotations = [...new Set(pendingAnnotations)];
    const columnName = extractColumnNameFromAnnotations(line) ?? toSnakeCase(name);
    const relationTarget = extractRelationTarget(line, type);
    const nullable = !/nullable\s*=\s*false/i.test(line) && !annotations.some((annotation) => /NotNull/i.test(annotation));
    const detailParts = [columnName !== name ? `column: ${columnName}` : undefined, type ? `type: ${type}` : undefined].filter(Boolean);
    fields.push({
      name: columnName,
      type: inferJavaType(type ?? ''),
      annotations,
      detail: detailParts.join(' | ') || undefined,
      nullable,
      relation: relationTarget,
    });
    pendingAnnotations.length = 0;
  }

  return uniqueBy(fields, (field) => field.name);
}

function collectExplicitPrimaryKeyColumns(text: string): string[] {
  const primaryKeyColumns = new Set<string>();
  for (const match of text.matchAll(/@Id\b[\s\S]{0,80}?@(?:Column|JoinColumn)\s*\(([^)]*)\)?/gi)) {
    const columnName = extractColumnNameFromAnnotationArgs(match[1] ?? '');
    if (columnName) primaryKeyColumns.add(columnName);
  }
  for (const match of text.matchAll(/@Id\b[\s\S]{0,80}?(?:private|protected|public)\s+[A-Za-z0-9_<>,.? ?]+\s+([A-Za-z0-9_]+)\s*;/gi)) {
    if (match[1]) primaryKeyColumns.add(toSnakeCase(match[1]));
  }
  return [...primaryKeyColumns];
}

function extractColumnNameFromAnnotations(line: string): string | undefined {
  const annotationArgs = line.match(/@(Column|JoinColumn)\s*\(([^)]*)\)/i);
  if (!annotationArgs?.[2]) {
    return undefined;
  }
  return extractColumnNameFromAnnotationArgs(annotationArgs[2]);
}

function extractColumnNameFromAnnotationArgs(args: string): string | undefined {
  const nameMatch = args.match(/\bname\s*=\s*["']([^"']+)["']/i);
  return nameMatch?.[1] ? normalizeSqlIdentifier(nameMatch[1]) : undefined;
}

function extractRelationTarget(line: string, type?: string): string | undefined {
  const joinMatch = line.match(/@JoinColumn\s*\(([^)]*)\)/i);
  const referencedColumn = joinMatch?.[1] ? extractColumnNameFromAnnotationArgs(joinMatch[1]) : undefined;
  if (joinMatch) {
    const target = type ? toSnakeCase(type) : undefined;
    if (target) {
      return referencedColumn ? `${target}.${referencedColumn}` : `${target}.id`;
    }
  }
  if (/@ManyToOne|@OneToOne|@ManyToMany|@OneToMany/i.test(line)) {
    return type ? `${toSnakeCase(type)}.id` : undefined;
  }
  return undefined;
}

function inferJavaType(type: string): string | undefined {
  const normalized = type.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return undefined;
  if (/string|char|text|clob/.test(normalized)) return 'string';
  if (/int|long|short|bigdecimal|double|float|number/.test(normalized)) return 'number';
  if (/boolean|bool/.test(normalized)) return 'boolean';
  if (/date|time|instant|timestamp|localdate|localdatetime/.test(normalized)) return 'timestamp';
  if (/uuid/.test(normalized)) return 'uuid';
  if (/list|set|collection|array/.test(normalized)) return 'collection';
  if (/map/.test(normalized)) return 'map';
  if (/json|object/.test(normalized)) return 'json';
  return normalized;
}

function collectSchemaColumns(text: string): string[] {
  const entityBlueprint = extractJavaEntityBlueprint(text);
  return entityBlueprint.fields.map((field) => field.name);
}

function collectSchemaRelationships(text: string): string[] {
  return collectJavaRelationshipHints(text);
}

function collectJavaRelationshipHints(text: string): string[] {
  const relations = new Set<string>();
  if (/@manytoone/i.test(text)) relations.add('many-to-one');
  if (/@onetomany/i.test(text)) relations.add('one-to-many');
  if (/@manytomany/i.test(text)) relations.add('many-to-many');
  if (/@joincolumn/i.test(text)) relations.add('join-column');
  return [...relations];
}

function collectAstPersistenceHints(astFile: JavaAstFile): string[] {
  const hints = new Set<string>();
  for (const type of astFile.types) {
    if (type.annotations.some((annotation) => /Entity/i.test(annotation))) hints.add('@Entity');
    if (type.annotations.some((annotation) => /Table/i.test(annotation))) hints.add('@Table');
    if (type.fields.some((field) => field.annotations.some((annotation) => /Column/i.test(annotation)))) hints.add('@Column');
    if (type.fields.some((field) => field.annotations.some((annotation) => /ManyToOne/i.test(annotation)))) hints.add('@ManyToOne');
    if (type.fields.some((field) => field.annotations.some((annotation) => /OneToMany/i.test(annotation)))) hints.add('@OneToMany');
    if (type.fields.some((field) => field.annotations.some((annotation) => /ManyToMany/i.test(annotation)))) hints.add('@ManyToMany');
    if (type.fields.some((field) => field.annotations.some((annotation) => /JoinColumn/i.test(annotation)))) hints.add('@JoinColumn');
  }
  if (/schema\.sql|ddl|create table|alter table|insert into/i.test(astFile.file)) hints.add('sql schema');
  if (/flyway|liquibase|migration/i.test(astFile.file)) hints.add('migration');
  return [...hints];
}

function collectAstSecurityHints(astFile: JavaAstFile): string[] {
  const hints = new Set<string>();
  for (const type of astFile.types) {
    if (type.annotations.some((annotation) => /PreAuthorize/i.test(annotation))) hints.add('@PreAuthorize');
    if (type.annotations.some((annotation) => /Secured/i.test(annotation))) hints.add('@Secured');
    if (type.annotations.some((annotation) => /RolesAllowed/i.test(annotation))) hints.add('@RolesAllowed');
    if (type.annotations.some((annotation) => /SecurityFilterChain/i.test(annotation))) hints.add('@SecurityFilterChain');
  }
  if (/oauth|oidc|jwt|csrf|authority|permission|role/i.test(astFile.file)) hints.add('authz/authn');
  return [...hints];
}

function collectAstIntegrationHints(astFile: JavaAstFile): string[] {
  const hints = new Set<string>();
  for (const type of astFile.types) {
    if (type.annotations.some((annotation) => /FeignClient/i.test(annotation))) hints.add('@FeignClient');
    if (type.annotations.some((annotation) => /KafkaListener/i.test(annotation))) hints.add('@KafkaListener');
    if (type.annotations.some((annotation) => /MessageListener/i.test(annotation))) hints.add('@MessageListener');
    if (type.annotations.some((annotation) => /EventListener/i.test(annotation))) hints.add('@EventListener');
    if (type.annotations.some((annotation) => /Scheduled/i.test(annotation))) hints.add('@Scheduled');
    if (type.annotations.some((annotation) => /Async/i.test(annotation))) hints.add('@Async');
    if (type.annotations.some((annotation) => /Component/i.test(annotation))) hints.add('@Component');
    if (type.methods.some((method) => method.annotations.some((annotation) => /WebSocket/i.test(annotation)))) hints.add('WebSocket');
  }
  if (/websocket/i.test(astFile.file)) hints.add('WebSocket');
  if (/redis/i.test(astFile.file)) hints.add('Redis');
  if (/mail|smtp|ses/i.test(astFile.file)) hints.add('Mail');
  if (/minio|s3|object storage/i.test(astFile.file)) hints.add('Object storage');
  return [...hints];
}

function buildSchemaHintFromAst(astFile: JavaAstFile): SchemaHint {
  const primaryType = astFile.types[0];
  const tableName = inferAstTableName(astFile, primaryType?.name);
  const fields = primaryType
    ? primaryType.fields.map((field) => ({
        name: field.name,
        type: field.type,
        annotations: field.annotations,
        detail: field.initializer,
        nullable: !field.annotations.some((annotation) => /NotNull|Id/i.test(annotation)),
        relation: field.annotations.some((annotation) => /ManyToOne/i.test(annotation))
          ? 'many-to-one'
          : field.annotations.some((annotation) => /OneToMany/i.test(annotation))
            ? 'one-to-many'
            : field.annotations.some((annotation) => /ManyToMany/i.test(annotation))
              ? 'many-to-many'
              : field.annotations.some((annotation) => /JoinColumn/i.test(annotation))
                ? 'join-column'
                : undefined,
      }))
    : [];
  const primaryKey = unique([
    ...fields.filter((field) => field.annotations.some((annotation) => /Id$/i.test(annotation) || annotation === 'Id')).map((field) => field.name),
  ]);
  return {
    file: astFile.file,
    typeName: primaryType?.name,
    tableName,
    columns: fields.map((field) => field.name),
    relationships: fields.filter((field) => field.relation).map((field) => `${field.name} -> ${field.relation}`),
    annotations: primaryType?.annotations ?? [],
    primaryKey,
    fields,
    sourceKind: 'entity',
  };
}

function inferAstTableName(astFile: JavaAstFile, typeName?: string): string | undefined {
  const annotationText = astFile.types.flatMap((type) => type.annotations).join(' ');
  const tableMatch = annotationText.match(/Table\s*\(\s*name\s*=\s*["']([^"']+)["']/i);
  if (tableMatch?.[1]) return tableMatch[1];
  return typeName ? toSnakeCase(`${typeName}s`) : undefined;
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

async function collectPackageMap(
  files: string[],
  onProgress?: (event: {
    phase: 'files' | 'java' | 'packages' | 'sql';
    message: string;
    currentFile?: string;
    completed?: number;
    total?: number;
  }) => void | Promise<void>,
): Promise<Record<string, number>> {
  const packageCounts = new Map<string, number>();
  let index = 0;
  for (const file of files) {
    index += 1;
    const text = await readFile(file, 'utf8');
    const match = text.match(/^\s*package\s+([a-zA-Z0-9_.]+)\s*;/m);
    if (match?.[1]) {
      const pkg = match[1];
      packageCounts.set(pkg, (packageCounts.get(pkg) ?? 0) + 1);
    }
    if (index % 50 === 0 || index === files.length) {
      await onProgress?.({ phase: 'packages', message: `Indexed packages from ${index}/${files.length} Java files`, currentFile: file, completed: index, total: files.length });
      await yieldToEventLoop();
    }
  }
  return Object.fromEntries([...packageCounts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function collectSqlCatalog(
  files: string[],
  onProgress?: (event: {
    phase: 'files' | 'java' | 'packages' | 'sql';
    message: string;
    currentFile?: string;
    completed?: number;
    total?: number;
  }) => void | Promise<void>,
): Promise<SqlArtifactSummary[]> {
  const summaries: SqlArtifactSummary[] = [];
  let index = 0;
  for (const file of files) {
    index += 1;
    const text = await readFile(file, 'utf8');
    const tables = parseSqlTables(text);
    if (tables.length > 0) {
      summaries.push({
        file,
        tables,
      });
    }
    if (index % 25 === 0 || index === files.length) {
      await onProgress?.({ phase: 'sql', message: `Parsed ${index}/${files.length} SQL files`, currentFile: file, completed: index, total: files.length });
      await yieldToEventLoop();
    }
  }
  return uniqueBy(summaries, (item) => item.file);
}

function parseSqlTables(text: string): SqlArtifactSummary['tables'] {
  const tables: SqlArtifactSummary['tables'] = [];
  const statements = text.split(/;\s*(?:\n|$)/g);
  for (const statement of statements) {
    const normalized = statement.trim();
    if (!normalized) continue;

    const createMatch = normalized.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."`]+)\s*\(([\s\S]+)\)$/i);
    if (!createMatch) continue;

    const tableName = normalizeSqlIdentifier(createMatch[1]);
    const body = createMatch[2];
    const columnDefs = splitSqlBody(body);
    const columns: Array<{ name: string; type?: string; detail?: string; nullable?: boolean }> = [];
    const primaryKey: string[] = [];
    const foreignKeys: Array<{ column: string; targetTable?: string; targetColumn?: string }> = [];

    for (const definition of columnDefs) {
      const line = definition.trim();
      if (!line) continue;

      const fkMatch = line.match(/foreign\s+key\s*\(([^)]+)\)\s*references\s+([a-zA-Z0-9_."`]+)\s*\(([^)]+)\)/i);
      if (fkMatch) {
        const column = normalizeSqlIdentifier(fkMatch[1].split(',')[0] ?? '');
        foreignKeys.push({
          column,
          targetTable: normalizeSqlIdentifier(fkMatch[2]),
          targetColumn: normalizeSqlIdentifier(fkMatch[3].split(',')[0] ?? ''),
        });
        continue;
      }

      const pkMatch = line.match(/primary\s+key\s*\(([^)]+)\)/i);
      if (pkMatch) {
        primaryKey.push(...pkMatch[1].split(',').map((value) => normalizeSqlIdentifier(value)));
        continue;
      }

      const columnMatch = line.match(/^([a-zA-Z0-9_."`]+)\s+([a-zA-Z0-9_()'"\[\]\-+/.<>,\s]+?)(?:\s+constraint\b|\s+primary\s+key\b|\s+references\b|\s+not\s+null\b|,|$)/i);
      if (columnMatch) {
        const columnName = normalizeSqlIdentifier(columnMatch[1]);
        const rawType = (columnMatch[2] ?? '').trim();
        const inferredType = inferSqlColumnType(rawType);
        const nullable = !/not\s+null/i.test(line);
        if (columnName && !columns.some((column) => column.name === columnName)) {
          columns.push({
            name: columnName,
            type: inferredType,
            detail: rawType || undefined,
            nullable,
          });
        }

        const inlinePk = /primary\s+key/i.test(line);
        if (inlinePk && columnName && !primaryKey.includes(columnName)) {
          primaryKey.push(columnName);
        }

        const inlineFk = line.match(/references\s+([a-zA-Z0-9_."`]+)\s*\(([^)]+)\)/i);
        if (inlineFk) {
          foreignKeys.push({
            column: columnName,
            targetTable: normalizeSqlIdentifier(inlineFk[1]),
            targetColumn: normalizeSqlIdentifier(inlineFk[2].split(',')[0] ?? ''),
          });
        }
      }
    }

    if (columns.length || primaryKey.length || foreignKeys.length) {
      tables.push({
        name: tableName,
        columns,
        primaryKey: unique(primaryKey),
        foreignKeys,
      });
    }
  }

  return tables;
}

function inferSqlColumnType(rawType: string): string | undefined {
  const normalized = rawType.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  if (/uuid/.test(normalized)) return 'uuid';
  if (/bigint|int|smallint|tinyint|serial|numeric|decimal|number|double|float|real/.test(normalized)) return 'number';
  if (/timestamp|datetime|date|time/.test(normalized)) return 'timestamp';
  if (/bool/.test(normalized)) return 'boolean';
  if (/json/.test(normalized)) return 'json';
  if (/text|clob|blob/.test(normalized)) return 'text';
  if (/char|varchar|string|uuid/.test(normalized)) return 'string';
  return normalized;
}

function splitSqlBody(body: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of body) {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function normalizeSqlIdentifier(value: string): string {
  return value.trim().replace(/^[`"[]+|[`"\]]+$/g, '').toLowerCase();
}

function deriveObservations({ modules, counts, technologies, javaSignals, markdownFiles }: { modules: string[]; counts: SourceProjectAnalysis['counts']; technologies: string[]; javaSignals: Awaited<ReturnType<typeof collectJavaSignals>>; markdownFiles: string[]; }): string[] {
  const observations: string[] = [];
  if (modules.length > 1) observations.push('multi-module architecture');
  if (modules.includes('event-backend/build') && modules.includes('event-backend/bom') && modules.includes('event-backend/versions')) {
    observations.push('centralized build parent, dependency BOM, and version catalog for backend modules');
  }
  if (modules.includes('event-notification')) observations.push('repository also contains a separate notification application');
  if (counts.controllers >= 10) observations.push('broad HTTP surface');
  if (counts.services >= 10) observations.push('substantial orchestration layer');
  if (counts.repositories >= 10) observations.push('rich persistence layer');
  if (counts.sqlFiles > 0) observations.push('explicit SQL / migration assets present');
  if (javaSignals.endpoints.length > 0) observations.push('endpoint catalog discovered');
  if (javaSignals.schemaHints.length > 0) observations.push('schema hints discovered from entities or SQL');
  if (counts.scheduledJobs > 0) observations.push('scheduled/background execution');
  if (counts.websocketHandlers > 0) observations.push('real-time push path');
  if (javaSignals.events.length > 0) observations.push('event-driven integration points');
  if (technologies.some((item) => /jwt/i.test(item))) observations.push('token-based security boundary');
  if (technologies.some((item) => /redis/i.test(item))) observations.push('redis-backed runtime integration');
  if (technologies.some((item) => /flyway/i.test(item))) observations.push('schema migration pipeline');
  if (technologies.some((item) => /openapi/i.test(item))) observations.push('contract-first HTTP surface');
  if (markdownFiles.some((file) => /adr|architecture|design/i.test(file))) observations.push('has architectural documentation');
  return unique(observations);
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  try {
    const text = await readFile(filePath, 'utf8');
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function renderAnalysisMarkdown(analysis: SourceProjectAnalysis, snapshot: SourceProjectSnapshot): string {
  const topPackages = Object.entries(analysis.packageMap)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12);
  const jqassistantLines = analysis.jqassistant
    ? [
        `- status: ${analysis.jqassistant.status}`,
        `- enabled: ${analysis.jqassistant.enabled ? 'yes' : 'no'}`,
        `- command: ${analysis.jqassistant.command}`,
        ...(analysis.jqassistant.version ? [`- version: ${analysis.jqassistant.version}`] : []),
        ...(analysis.jqassistant.error ? [`- error: ${analysis.jqassistant.error}`] : []),
      ].join('\n')
    : '- not available';
  return `# ${analysis.projectName} source-to-semantic analysis\n\n` +
    `## Overview\n` +
    `- source root: ${analysis.projectRoot}\n` +
    `- modules: ${analysis.modules.length}\n` +
    `- controllers: ${analysis.counts.controllers}\n` +
    `- services: ${analysis.counts.services}\n` +
    `- repositories: ${analysis.counts.repositories}\n` +
    `- entities: ${analysis.counts.entities}\n` +
    `- configs: ${analysis.counts.configs}\n` +
    `- jobs: ${analysis.counts.jobs}\n` +
    `- listeners: ${analysis.counts.listeners}\n` +
    `- sql files: ${analysis.counts.sqlFiles}\n` +
    `- endpoint catalog entries: ${analysis.endpointCatalog.length}\n` +
    `- schema hints: ${analysis.schemaHints.length}\n\n` +
    `## Source snapshot\n` +
    `- top-level directories: ${snapshot.topLevelDirectories.join(', ') || 'none'}\n` +
    `- top-level files: ${snapshot.topLevelFiles.join(', ') || 'none'}\n\n` +
    `## jQAssistant\n` +
    `${jqassistantLines}\n\n` +
    `## Detected module roots\n` +
    (analysis.modules.length ? analysis.modules.map((module) => `- ${module}`).join('\n') : '- none detected') + '\n\n' +
    `## Top packages\n` +
    (topPackages.length ? topPackages.map(([pkg, count]) => `- ${pkg} (${count})`).join('\n') : '- none detected') + '\n\n' +
    `## Java catalog sample\n` +
    (analysis.javaCatalog.length
      ? analysis.javaCatalog.slice(0, 30).map((item) => `- ${item.kind}: ${item.typeName ?? pathBase(item.file)}${item.packageName ? ` (${item.packageName})` : ''}${item.endpoints.length ? ` | endpoints: ${item.endpoints.join(', ')}` : ''}${item.persistenceHints.length ? ` | persistence: ${item.persistenceHints.join(', ')}` : ''}${item.securityHints.length ? ` | security: ${item.securityHints.join(', ')}` : ''}${item.integrationHints.length ? ` | integration: ${item.integrationHints.join(', ')}` : ''}`).join('\n')
      : '- none') + '\n\n' +
    `## Endpoint sample\n` +
    (analysis.endpointCatalog.length
      ? analysis.endpointCatalog.slice(0, 30).map((item) => `- ${item.method} ${item.path} -> ${item.typeName ?? pathBase(item.file)} (${relativePath(item.file, analysis.projectRoot)})`).join('\n')
      : '- none') + '\n\n' +
    `## Schema hints\n` +
    (analysis.schemaHints.length
      ? analysis.schemaHints.slice(0, 20).map((item) => {
          const columns = item.fields?.length
            ? ` | fields: ${item.fields.map((field) => `${field.name}${field.type ? `:${field.type}` : ''}${field.relation ? ` -> ${field.relation}` : ''}`).join(', ')}`
            : item.columns.length
              ? ` | columns: ${item.columns.join(', ')}`
              : '';
          const primaryKey = item.primaryKey?.length ? ` | pk: ${item.primaryKey.join(', ')}` : '';
          const relationships = item.relationships.length ? ` | relationships: ${item.relationships.join(', ')}` : '';
          const sourceKind = item.sourceKind ? ` | sourceKind: ${item.sourceKind}` : '';
          return `- ${item.typeName ?? pathBase(item.file)}${item.tableName ? ` -> ${item.tableName}` : ''}${columns}${primaryKey}${relationships}${sourceKind}`;
        }).join('\n')
      : '- none') + '\n\n' +
    `## SQL catalog\n` +
    (analysis.sqlCatalog.length
      ? analysis.sqlCatalog.map((fileEntry) => [
          `- ${relativePath(fileEntry.file, analysis.projectRoot)}`,
          ...fileEntry.tables.map((table) => `  - table: ${table.name}${table.primaryKey?.length ? ` | pk: ${table.primaryKey.join(', ')}` : ''}${table.columns.length ? ` | columns: ${table.columns.map((column) => `${column.name}${column.type ? `:${column.type}` : ''}${column.detail ? `(${column.detail})` : ''}`).join(', ')}` : ''}${table.foreignKeys.length ? ` | foreign keys: ${table.foreignKeys.map((fk) => `${fk.column}->${fk.targetTable ?? '?'}.${fk.targetColumn ?? '?'}`).join('; ')}` : ''}`),
        ].join('\n')).join('\n')
      : '- none') + '\n\n' +
    `## Module dossiers\n` +
    (analysis.moduleDossiers?.length
      ? analysis.moduleDossiers.map((module) => [
          `- ${module.moduleRoot}`,
          `  - components: controllers=${module.componentSummary.controllers}, services=${module.componentSummary.services}, repositories=${module.componentSummary.repositories}, entities=${module.componentSummary.entities}, configs=${module.componentSummary.configs}, jobs=${module.componentSummary.jobs}, listeners=${module.componentSummary.listeners}`,
          `  - interfaces: http=${module.interfaceCatalog.http.length}, integration=${module.interfaceCatalog.integration.length}, internal=${module.interfaceCatalog.internal.length}, persistence=${module.interfaceCatalog.persistence.length}`,
          ...(module.flowTraces.length ? [`  - flows: ${module.flowTraces.join(' | ')}`] : []),
          ...(module.persistenceNotes.length ? [`  - persistence: ${module.persistenceNotes.join(' | ')}`] : []),
        ].join('\n')).join('\n')
      : '- none') + '\n\n' +
    `## Observations\n` +
    (analysis.observations.length ? analysis.observations.map((item) => `- ${item}`).join('\n') : '- none') + '\n\n' +
    `## Technology signals\n` +
    (analysis.technologies.length ? analysis.technologies.map((item) => `- ${item}`).join('\n') : '- none') + '\n';
}

function applyJqassistantEvidence(analysis: SourceProjectAnalysis, artifact: JqassistantArtifact): void {
  applyJqassistantMergeEvidence(analysis, artifact);
  const mergedObservations = [...analysis.observations];
  if (!artifact.enabled) {
    mergedObservations.push('jQAssistant deterministic scan hook configured but disabled');
  } else if (artifact.status === 'completed') {
    mergedObservations.push('jQAssistant deterministic scan available');
    if (artifact.version) {
      mergedObservations.push(`jQAssistant version detected: ${artifact.version}`);
    }
  } else if (artifact.status === 'failed') {
    mergedObservations.push('jQAssistant scan attempted but failed');
  }
  if (artifact.detectedBinary) {
    mergedObservations.push('jQAssistant binary available on host environment');
  }
  analysis.observations = unique(mergedObservations);
}

function applyJqassistantMergeEvidence(analysis: SourceProjectAnalysis, artifact: JqassistantArtifact): void {
  const evidence = artifact.mergeEvidence;
  if (!evidence) return;

  if (typeof evidence.multiModuleMaven === 'boolean') {
    analysis.repositoryStructure.multiModuleMaven = evidence.multiModuleMaven;
  }

  if (evidence.topLevelProjects?.length) {
    analysis.repositoryStructure.topLevelProjects = uniqueBy(
      [...analysis.repositoryStructure.topLevelProjects, ...evidence.topLevelProjects],
      (item) => item.name,
    );
  }

  if (evidence.backendSupportModules?.length) {
    analysis.repositoryStructure.backendSupportModules = uniqueBy(
      [...analysis.repositoryStructure.backendSupportModules, ...evidence.backendSupportModules],
      (item) => item.name,
    );
  }

  if (evidence.backendRuntimeLayers?.length) {
    analysis.repositoryStructure.backendRuntimeLayers = uniqueBy(
      [...analysis.repositoryStructure.backendRuntimeLayers, ...evidence.backendRuntimeLayers],
      (item) => item.name,
    );
  }

  if (evidence.applicationLayouts?.length) {
    const mergedLayouts = [...analysis.applicationLayouts];
    for (const incoming of evidence.applicationLayouts) {
      const existing = mergedLayouts.find((layout) => layout.appRoot === incoming.appRoot);
      if (!existing) {
        mergedLayouts.push({
          appRoot: incoming.appRoot,
          role: incoming.role,
          multiModule: incoming.multiModule,
          moduleRoots: incoming.moduleRoots,
          internalModules: incoming.internalModules.map((module) => ({
            name: module.name,
            purpose: module.purpose,
            source: module.source === 'jqassistant' ? 'maven' : module.source,
            pathHints: module.pathHints,
          })),
        });
        continue;
      }
      existing.role = existing.role || incoming.role;
      existing.multiModule = existing.multiModule || incoming.multiModule;
      existing.moduleRoots = unique([...existing.moduleRoots, ...incoming.moduleRoots]);
      existing.internalModules = uniqueBy(
        [
          ...existing.internalModules,
          ...incoming.internalModules.map((module) => ({
            name: module.name,
            purpose: module.purpose,
            source: module.source === 'jqassistant' ? 'maven' : module.source,
            pathHints: module.pathHints,
          })),
        ],
        (item) => item.name,
      );
    }
    analysis.applicationLayouts = mergedLayouts;
  }
}

function buildSkippedJqassistantArtifact(
  projectName: string,
  projectRoot: string,
  analysis: SourceProjectAnalysis,
): JqassistantArtifact {
  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    status: 'skipped',
    projectName,
    projectRoot,
    enabled: false,
    command: 'jqassistant',
    scanMode: 'scan-only',
    detectedBinary: false,
    summary: {
      applicationCount: analysis.applicationLayouts.length,
      applications: analysis.applicationLayouts.map((layout) => layout.appRoot),
      moduleCount: analysis.modules.length,
      modules: analysis.modules,
      technologyCount: analysis.technologies.length,
      technologies: analysis.technologies,
    },
    warnings: ['No jqassistant MCP artifact was supplied to the source import pipeline.'],
  };
}

function renderSuggestedSemanticMarkdown(
  analysis: SourceProjectAnalysis,
  snapshot: SourceProjectSnapshot,
  codeGraph: CodeKnowledgeGraph,
  astIndex: AstIndexArtifact,
  jqassistantSupport: JqassistantSupportArtifact,
  supportGraph: SupportGraphArtifact,
  verification: GraphVerificationArtifact,
): string {
  const apiSurface = analysis.apiSurface ?? createEmptyApiSurfaceSummary();
  const sourcePriority = ['support-graph', 'jqassistant-graph', 'ast-index', 'codegraph', 'analysis'];
  const verificationWarnings = verification.checks
    .filter((check) => check.status !== 'ok')
    .map((check) => `- ${check.category}: ${check.message}`);
  const applicationSupport = supportGraph.nodes
    .filter((node) => node.type === 'application')
    .map((node) => `- \`${node.name}\`: ${node.description ?? 'application boundary'}; items: ${node.items.slice(0, 8).join(', ') || 'none'}`);
  const topLevelProjects = analysis.repositoryStructure.topLevelProjects.map((item) => `- \`${item.name}\`: ${item.role}`);
  const backendRuntimeLayers = analysis.repositoryStructure.backendRuntimeLayers.map((item) => `- \`${item.name.replace(/^event-backend\//, '')}\`: ${item.role}`);
  const backendSupportModules = analysis.repositoryStructure.backendSupportModules.map((item) => `- \`${item.name.replace(/^event-backend\//, '')}\`: ${item.role}`);
  const apiFamilies = jqassistantOrDeterministicApiFamilies(analysis, jqassistantSupport).map((family) => {
    if (!family.startsWith('/')) return `- \`${family}\``;
    const matching = apiSurface.families.find((item) => item.family === family.split(' ')[0]);
    if (!matching) return `- \`${family}\``;
    const details = [
      `${matching.endpointCount} ${matching.endpointCount === 1 ? 'endpoint' : 'endpoints'}`,
      matching.authMode === 'public'
        ? 'public'
        : matching.authMode === 'protected'
          ? `protected by ${matching.securitySchemes.join(', ') || 'auth'}`
          : `mixed visibility (${matching.securitySchemes.join(', ') || 'partial auth'})`,
      matching.permissionHints.length ? `rights: ${matching.permissionHints.join(', ')}` : '',
      matching.dtoTypes.length ? `DTOs: ${matching.dtoTypes.slice(0, 6).join(', ')}` : '',
      matching.enumTypes.length ? `enums: ${matching.enumTypes.slice(0, 4).join(', ')}` : '',
    ].filter(Boolean);
    return `- \`${matching.family}\`: ${details.join('; ')}`;
  });
  const commonComponents = analysis.commonSummary.crossCuttingComponents.map((item) => `- \`${item.name}\`: ${item.role}`);
  const webBoundaries = [
    ...codeGraph.summary.validationBoundaries.map((item) => `- Request validation through \`${item}\``),
    ...codeGraph.summary.exceptionHandlers.map((item) => `- Global error handling through \`${item}\``),
    ...codeGraph.summary.webConfigurations.map((item) => `- Web configuration in \`${item}\``),
    ...codeGraph.summary.webSecurityBoundaries.filter((item) => !/CookieOrHeaderBearerTokenResolver/i.test(item)).map((item) => `- Security boundary component: \`${item}\``),
  ];
  const persistenceStyles = analysis.persistenceSummary.repositoryStyles.map((item) =>
    `- ${item.style.toUpperCase()}: ${item.rationale} (${item.repositories.join(', ')})`,
  );
  const persistenceRepositories = analysis.persistenceSummary.repositories.slice(0, 16).map((item) =>
    `- \`${item.name}\`: ${item.purpose}. Typical operations: ${item.operationGroups.join(', ') || 'general persistence'}${item.notableOperation ? `. Notable operation: ${item.notableOperation}` : ''}`,
  );
  const persistenceMappers = [
    ...(analysis.persistenceSummary.mapperSummary.abstractBase
      ? [`- \`${analysis.persistenceSummary.mapperSummary.abstractBase}\`: ${analysis.persistenceSummary.mapperSummary.abstractBaseNotes.join(', ') || 'shared row-mapper helper base'}`]
      : []),
    ...analysis.persistenceSummary.mapperSummary.rowMappers.map((item) => `- Row mapper: \`${item}\``),
    ...analysis.persistenceSummary.mapperSummary.dtoMappers.map((item) => `- Mapper: \`${item}\``),
  ];
  const serviceCatalog = analysis.serviceSummary.executionServices.map((service) =>
    `- \`${service.name}\`: ${service.purpose}`,
  );
  const jobsAndListeners = [
    ...analysis.serviceSummary.scheduledJobs.map((item) => `- Scheduled job \`${item.name}\` runs ${item.schedule} and ${item.purpose}`),
    ...analysis.serviceSummary.asyncListeners.map((item) => `- Listener \`${item.name}\`: ${item.purpose}`),
  ];
  const flowSection = analysis.flowSummary.flows.map((flow) => [
    `### ${flow.name}`,
    `${flow.summary}`,
    ...flow.steps.map((step) => `- ${step}`),
  ].join('\n')).join('\n\n');
  const securitySection = [
    ...analysis.commonSummary.securityDetails.map((item) => `- ${item}`),
    ...(analysis.serviceSummary.exceptionTypes.length
      ? ['- Runtime exceptions raised in the service layer are translated to HTTP responses by controller advice.']
      : []),
  ];
  const dependencySection = [
    ...analysis.appRuntime.externalDependencies.map((item) => `- ${item}`),
    ...(analysis.technologies.some((item) => /postgres|postgresql/i.test(item)) ? ['- PostgreSQL'] : []),
    ...(analysis.technologies.some((item) => /redis/i.test(item)) ? ['- Redis'] : []),
    ...(analysis.technologies.some((item) => /minio|s3/i.test(item)) ? ['- MinIO / object storage'] : []),
    ...(analysis.technologies.some((item) => /oauth|oidc/i.test(item)) ? ['- External auth providers'] : []),
  ];
  const notificationNote = analysis.repositoryStructure.topLevelProjects.some((item) => item.name === 'event-notification')
    ? [
        '## Event-notification',
        'This repository also contains a separate notification application.',
        '- It subscribes to Redis Pub/Sub notification events.',
        '- It persists notifications in its own database schema.',
        '- It exposes HTTP and WebSocket endpoints for client-side notification delivery.',
        '- It should be documented independently in the next semantic pass.',
      ].join('\n')
    : '';

  const interfaceSection = [
    'The repository is split into explicit runtime surfaces.',
    ...(apiFamilies.length ? ['### API families', ...apiFamilies] : ['- No API families were inferred.']),
    ...(webBoundaries.length ? ['### Web boundaries', ...webBoundaries] : ['- No explicit web boundaries were inferred.']),
    ...(commonComponents.length ? ['### Common components', ...commonComponents] : []),
    ...(persistenceStyles.length ? ['### Persistence styles', ...persistenceStyles] : []),
    ...(serviceCatalog.length ? ['### Services', ...serviceCatalog] : []),
  ];

  const dataFlowSection = [
    'The main flows are request-driven, scheduled, or event-driven.',
    ...analysis.flowSummary.flows.flatMap((flow) => [
      `### ${flow.name}`,
      `${flow.summary}`,
      ...flow.steps.map((step) => `- ${step}`),
    ]),
    ...(analysis.commonSummary.eventFlow
      ? [
          '### Notification event bridge',
          `Backend services publish notification payloads over ${analysis.commonSummary.eventFlow.transport} on ${analysis.commonSummary.eventFlow.channel}.`,
          'The notification application consumes those messages, persists them, and forwards them to connected websocket clients.',
        ]
      : []),
  ];

  const processSection = [
    'Operationally, the system boots from the app module, applies incremental migrations, exposes actuator endpoints, and then serves HTTP, scheduled, and async event-driven work.',
    ...(jobsAndListeners.length ? ['### Scheduling and listeners', ...jobsAndListeners] : []),
    ...(analysis.serviceSummary.mailCapabilities.operations.length
      ? ['### Mail processing', ...analysis.serviceSummary.mailCapabilities.operations.map((item) => `- \`${item.name}\`: ${item.purpose}. ${item.flow}${item.issue ? ` Issue: ${item.issue}.` : ''}`)]
      : []),
    ...(analysis.serviceSummary.storageCapabilities.summary.length
      ? ['### Media/storage processing', ...analysis.serviceSummary.storageCapabilities.summary.map((item) => `- ${item}`)]
      : []),
  ];

  const rulesSection = [
    '- preserve module boundaries where the repository makes them explicit',
    '- keep inbound contracts, runtime orchestration, persistence, and external dependencies separate',
    '- keep DTO ownership in API or common surfaces instead of service-local packages',
    '- keep database tables and relationships explicit when schema evidence exists',
    '- use runtime exceptions in the service layer and translate them in web/controller advice',
  ];

  const examplesSection = [
    '- a user registration request enters through the API contract and is validated at the web boundary before reaching the auth service',
    '- a scheduled job may refresh derived read models or archive stale domain data without a request path',
    '- an async notification event may be published by the backend, persisted by the notification app, and delivered over websocket',
  ];
  const schemaLines = buildSchemaLines(analysis, codeGraph);

  return [
    `# ${analysis.projectName}`,
    '',
    '## source_priority',
    ...sourcePriority.map((item) => `- ${item}`),
    '',
    '## system',
    `${analysis.projectName} source-derived system slice.`,
    '',
    '## intent',
    'Capture the current architecture shape, runtime responsibilities, persistence boundaries, and important flows in a way that remains readable for humans and stable enough for graph/schema derivation.',
    '',
    '## context',
    `- source root: ${analysis.projectRoot}`,
    `- repository projects: ${analysis.repositoryStructure.topLevelProjects.map((item) => `${item.name} (${item.role})`).join(' | ') || 'not clearly segmented'}`,
    `- top-level modules: ${analysis.modules.length ? analysis.modules.join(', ') : 'single module / not clearly segmented'}`,
    `- discovered endpoints: ${analysis.endpointCatalog.length}`,
    `- discovered API families: ${apiSurface.families.length}`,
    `- discovered schema hints: ${analysis.schemaHints.length}`,
    `- ast types indexed: ${astIndex.summary.typeCount}`,
    `- jqassistant packages indexed: ${jqassistantSupport.summary.packageCount ?? 0}`,
    `- support graph nodes: ${supportGraph.nodes.length}`,
    '',
    '## Overview',
    `${analysis.projectName} is a source-derived architectural summary focused on the backend application. The repository is organized as a multi-module Maven codebase with explicit separation between build support, runtime modules, and a separate notification application. The goal of this semantic file is to explain the system in human terms, while graph-preview and flow helper artifacts are kept in separate machine-oriented files.`,
    '',
    '## Repository structure',
    ...topLevelProjects,
    ...(applicationSupport.length ? ['', '### Application boundaries from support graph', ...applicationSupport] : []),
    ...(backendSupportModules.length ? ['', '### Build support modules', ...backendSupportModules] : []),
    ...(backendRuntimeLayers.length ? ['', '### Event-backend runtime modules', ...backendRuntimeLayers] : []),
    '',
    '## API surface',
    apiSurface.contractSource === 'openapi-generated'
      ? 'The API layer is contract-first. OpenAPI YAML and generated Java contracts define the DTOs, enums, and interface signatures, while the web module provides the controller implementations.'
      : 'The API layer is inferred from Java contracts and controller implementations.',
    ...(apiFamilies.length ? apiFamilies : ['- No API families were inferred.']),
    ...(apiSurface.clientImplementations.length ? ['', '### API client implementations', ...apiSurface.clientImplementations.map((item) => `- \`${item.name}\`: ${item.purpose}`)] : []),
    ...(apiSurface.enumTypes.length ? ['', '### API enums', ...apiSurface.enumTypes.map((item) => `- \`${item.name}\`: ${item.purpose}`)] : []),
    '',
    '## Application runtime',
    ...(analysis.appRuntime.applicationEntryPoint ? [`- Entry point: \`${analysis.appRuntime.applicationEntryPoint}\``] : []),
    ...analysis.appRuntime.importedConfigFiles.map((item) => `- Config file \`${item.name}\`: ${item.purpose}`),
    ...analysis.appRuntime.configurationBeans.map((item) => `- Bean configuration \`${item.name}\`: ${item.purpose}`),
    ...analysis.appRuntime.runtimeFeatures.map((item) => `- ${item}`),
    '',
    '## Common cross-cutting layer',
    'The common module contains shared infrastructure, security helpers, reusable utility code, and notification event contracts used across runtime modules.',
    ...commonComponents,
    ...analysis.commonSummary.utilityComponents.map((item) => `- Utility: \`${item}\``),
    ...analysis.commonSummary.stateCarrierComponents.map((item) => `- State carrier / shared object: \`${item}\``),
    ...(analysis.commonSummary.eventTypes.length ? ['', '### Notification events', ...analysis.commonSummary.eventTypes.map((item) => `- \`${item.name}\`: ${item.purpose}`)] : []),
    '',
    '## interfaces',
    ...interfaceSection,
    '',
    '## Web layer',
    'The web module hosts the runtime HTTP ingress. It implements the API contracts, validates inbound requests, applies web configuration, and translates domain errors into stable HTTP responses.',
    ...(webBoundaries.length ? webBoundaries : ['- No explicit web boundaries were inferred.']),
    '',
    '## Persistence layer',
    'The persistence module is the dedicated database-facing layer. It owns repositories, entities, and mapping infrastructure. The codebase deliberately mixes Spring Data JPA and SQL-first JDBC repositories depending on which approach keeps the query or mutation simpler to maintain.',
    ...(persistenceStyles.length ? persistenceStyles : []),
    ...(persistenceRepositories.length ? ['', '### Repositories', ...persistenceRepositories] : []),
    ...(persistenceMappers.length ? ['', '### Mappers', ...persistenceMappers] : []),
    ...(analysis.persistenceSummary.entityNames.length ? ['', '### Entities', ...analysis.persistenceSummary.entityNames.map((item) => `- \`${item}\``)] : []),
    '',
    '## Service layer',
    'The service module contains the executable business use cases and orchestration logic. It coordinates repositories, outbound integrations, mail delivery, storage processing, scheduled jobs, and event-driven work.',
    ...(serviceCatalog.length ? serviceCatalog : ['- No execution services were inferred.']),
    ...(jobsAndListeners.length ? ['', '### Scheduled and async behavior', ...jobsAndListeners] : []),
    ...(analysis.serviceSummary.mailCapabilities.operations.length ? ['', '### Mail capabilities', ...analysis.serviceSummary.mailCapabilities.operations.map((item) => `- \`${item.name}\`: ${item.purpose}. ${item.flow}${item.issue ? ` Issue: ${item.issue}.` : ''}`)] : []),
    ...(analysis.serviceSummary.storageCapabilities.summary.length ? ['', '### Storage capabilities', ...analysis.serviceSummary.storageCapabilities.summary.map((item) => `- ${item}`)] : []),
    ...(analysis.serviceSummary.violations.length ? ['', '### Layering concerns', ...analysis.serviceSummary.violations.map((item) => `- ${item}`)] : []),
    '',
    '## data_flows',
    ...(dataFlowSection.length ? dataFlowSection : ['- Concrete flow descriptions still need refinement from the source.']),
    '',
    '## Security',
    ...securitySection,
    ...(verificationWarnings.length ? ['', '## verification_warnings', ...verificationWarnings] : []),
    '',
    '## processes',
    ...(processSection.length ? processSection : ['- Processes still need to be refined from the source.']),
    '',
    '## rules',
    ...rulesSection,
    '',
    '## dependencies',
    ...(unique(dependencySection).length ? unique(dependencySection) : ['- No external dependency was inferred.']),
    '',
    '## database_schema',
    schemaLines,
    '',
    '## Database and schema signals',
    `- Schema hints inferred: ${analysis.schemaHints.length}`,
    `- SQL migration files detected: ${analysis.counts.sqlFiles}`,
    ...(analysis.sqlCatalog.slice(0, 8).map((item) => `- SQL artifact: \`${relativePath(item.file, analysis.projectRoot)}\``)),
    ...(notificationNote ? ['', notificationNote] : []),
    '',
    '## examples',
    ...examplesSection,
    '',
    '## Refinement targets',
    '- Tighten service descriptions where method names are generic and business intent is only visible in the method body.',
    '- Review ownership of DTOs, client adapters, and event contracts where the current module placement conflicts with the intended architecture.',
    '- Keep this document human-readable; use the generated preview/component/flow support artifacts for graph rendering and machine-oriented assembly.',
    '',
  ].join('\n');
}

function collectNamedKinds(analysis: SourceProjectAnalysis, kinds: string[], limit = 12): string[] {
  return unique(
    analysis.javaCatalog
      .filter((item) => kinds.includes(item.kind))
      .map((item) => item.typeName ?? pathBase(item.file)),
  ).slice(0, limit);
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

function collectIntegrationItems(analysis: SourceProjectAnalysis): string[] {
  const technologies = analysis.technologies;
  const items = new Set<string>();
  if (technologies.some((item) => /websocket/i.test(item)) || analysis.counts.websocketHandlers > 0) items.add('WebSocket');
  if (technologies.some((item) => /redis/i.test(item))) items.add('Redis');
  if (technologies.some((item) => /mail/i.test(item))) items.add('Mail service');
  if (technologies.some((item) => /kafka|queue|stream|mq/i.test(item)) || analysis.counts.listeners > 0) items.add('Messaging / event stream');
  if (analysis.javaCatalog.some((item) => item.integrationHints.some((hint) => /feignclient|http client|rest client/i.test(hint)))) items.add('External HTTP client');
  if (analysis.javaCatalog.some((item) => item.integrationHints.some((hint) => /listener|event/i.test(hint)))) items.add('Async listener / consumer');
  if (technologies.some((item) => /oauth|oidc/i.test(item))) items.add('OAuth / external identity client');
  return [...items];
}

function collectPersistenceItems(analysis: SourceProjectAnalysis): string[] {
  const items = new Set<string>();
  if (analysis.technologies.some((item) => /postgres|postgresql/i.test(item))) items.add('PostgreSQL');
  if (analysis.technologies.some((item) => /mysql/i.test(item))) items.add('MySQL');
  if (analysis.technologies.some((item) => /oracle/i.test(item))) items.add('Oracle');
  if (analysis.technologies.some((item) => /redis/i.test(item))) items.add('Redis cache / data store');
  if (analysis.technologies.some((item) => /minio|s3/i.test(item))) items.add('Object storage');
  if (analysis.counts.sqlFiles > 0) items.add(`SQL migrations (${analysis.counts.sqlFiles})`);
  for (const hint of analysis.schemaHints.slice(0, 8)) {
    const tableName = hint.tableName ?? hint.typeName ?? pathBase(hint.file);
    if (/^entitys?$/i.test(tableName)) continue;
    items.add(`table ${tableName}`);
  }
  return [...items];
}

function buildInterfaceLines(analysis: SourceProjectAnalysis, codeGraph?: CodeKnowledgeGraph): string {
  const lines: string[] = [];
  const apiSurface = analysis.apiSurface ?? createEmptyApiSurfaceSummary();
  const appRuntime = analysis.appRuntime;
  const repositoryStructure = analysis.repositoryStructure;
  const commonSummary = analysis.commonSummary;
  const persistenceSummary = analysis.persistenceSummary;
  const serviceSummary = analysis.serviceSummary;
  if (repositoryStructure.multiModuleMaven) {
    lines.push('- repository composition');
    if (repositoryStructure.topLevelProjects.length) {
      lines.push(`- repo projects — ${repositoryStructure.topLevelProjects.map((item) => `${item.name} (${item.role})`).join(' | ')}`);
    }
    if (repositoryStructure.backendSupportModules.length) {
      lines.push(`- event-backend build modules — ${repositoryStructure.backendSupportModules.map((item) => `${item.name} (${item.role})`).join(' | ')}`);
    }
    if (repositoryStructure.backendRuntimeLayers.length) {
      lines.push(`- event-backend runtime modules — ${repositoryStructure.backendRuntimeLayers.map((item) => `${item.name} (${item.role})`).join(' | ')}`);
    }
  }
  if (appRuntime.applicationEntryPoint || appRuntime.importedConfigFiles.length || appRuntime.configurationBeans.length || appRuntime.runtimeFeatures.length) {
    lines.push('- application runtime boundaries');
    if (appRuntime.applicationEntryPoint) lines.push(`- APP: entry point — ${appRuntime.applicationEntryPoint}`);
    if (appRuntime.bootstrapClass) lines.push(`- APP: bootstrap class — ${appRuntime.bootstrapClass}`);
    if (appRuntime.importedConfigFiles.length) {
      lines.push(`- APP: config imports — ${appRuntime.importedConfigFiles.map((item) => `${item.name} (${item.purpose})`).slice(0, 8).join(' | ')}`);
    }
    if (appRuntime.configurationBeans.length) {
      lines.push(`- APP: bean configs — ${appRuntime.configurationBeans.map((item) => `${item.name} (${item.purpose})`).slice(0, 8).join(' | ')}`);
    }
    if (appRuntime.externalDependencies.length) {
      lines.push(`- APP: external dependencies — ${appRuntime.externalDependencies.join(' | ')}`);
    }
    if (appRuntime.securityConfigurations.length) {
      lines.push(`- APP: security configs — ${appRuntime.securityConfigurations.slice(0, 8).join(' | ')}`);
    }
    if (appRuntime.runtimeFeatures.length) {
      lines.push(`- APP: runtime features — ${appRuntime.runtimeFeatures.slice(0, 8).join(' | ')}`);
    }
  }
  if (commonSummary.crossCuttingComponents.length || commonSummary.eventTypes.length || commonSummary.securityComponents.length) {
    lines.push('- common cross-cutting boundaries');
    if (commonSummary.crossCuttingComponents.length) {
      lines.push(`- COMMON: cross-cutting components — ${commonSummary.crossCuttingComponents.map((item) => `${item.name} (${item.role})`).slice(0, 8).join(' | ')}`);
    }
    if (commonSummary.utilityComponents.length) {
      lines.push(`- COMMON: utilities — ${commonSummary.utilityComponents.slice(0, 10).join(' | ')}`);
    }
    if (commonSummary.stateCarrierComponents.length) {
      lines.push(`- COMMON: state carriers — ${commonSummary.stateCarrierComponents.slice(0, 8).join(' | ')}`);
    }
    if (commonSummary.securityComponents.length) {
      lines.push(`- SECURITY: components — ${commonSummary.securityComponents.slice(0, 10).join(' | ')}`);
    }
    if (commonSummary.eventTypes.length) {
      lines.push(`- EVENTS: types — ${commonSummary.eventTypes.map((item) => `${item.name} (${item.purpose})`).slice(0, 12).join(' | ')}`);
    }
    if (commonSummary.eventFlow) {
      lines.push(`- EVENTS: pubsub — publisher ${commonSummary.eventFlow.publisher} -> ${commonSummary.eventFlow.transport} channel ${commonSummary.eventFlow.channel} -> subscriber ${commonSummary.eventFlow.subscriber}`);
      lines.push(`- EVENTS: producers — ${commonSummary.eventFlow.producerCallers.join(' | ')}`);
    }
  }
  const httpFamilies = codeGraph?.summary.endpointFamilies ?? groupEndpointFamilies(analysis.endpointCatalog.filter((entry) => /^(GET|POST|PUT|DELETE|PATCH|REQUEST)$/i.test(entry.method)));
  const httpContracts = collectHttpContractFamilies(analysis);
  if (apiSurface.families.length > 0) {
    lines.push('- API surface');
    lines.push(`- contract source: ${apiSurface.contractSource === 'openapi-generated' ? 'OpenAPI YAML / generated contracts' : apiSurface.contractSource}`);
    if (apiSurface.openApiYamlPath) lines.push(`- contract artifact: ${relativePath(apiSurface.openApiYamlPath, analysis.projectRoot)}`);
    if (apiSurface.swaggerConfigPresent) lines.push('- swagger / OpenAPI docs are configured');
    if (apiSurface.validationEnabled) lines.push('- API contract validation is enabled');
    for (const family of apiSurface.families.slice(0, 12)) {
      const parts = [
        `${family.endpointCount} endpoints`,
        family.authMode === 'protected' ? `auth: ${family.securitySchemes.join(' | ') || 'required'}` : family.authMode === 'mixed' ? `auth: mixed (${family.securitySchemes.join(' | ') || 'partial'})` : 'auth: public',
        family.permissionHints.length ? `rights: ${family.permissionHints.join(' | ')}` : '',
        family.dtoTypes.length ? `DTOs: ${family.dtoTypes.slice(0, 6).join(' | ')}` : '',
        family.enumTypes.length ? `enums: ${family.enumTypes.slice(0, 4).join(' | ')}` : '',
        family.hasSwagger ? 'swagger' : '',
        family.hasValidation ? 'validation' : '',
      ].filter(Boolean);
      lines.push(`- API: ${family.family} — ${parts.join(' ; ')}`);
    }
    if (apiSurface.clientImplementations.length > 0) {
      lines.push(`- API clients: ${apiSurface.clientImplementations.map((item) => `${item.name} (${item.purpose})`).slice(0, 8).join(' | ')}`);
    }
    if (apiSurface.enumTypes.length > 0) {
      lines.push(`- API enums: ${apiSurface.enumTypes.slice(0, 12).map((item) => `${item.name} (${item.purpose})`).join(' | ')}`);
    }
  }
  if (httpFamilies.length > 0) {
    lines.push(`- HTTP / web ingress families (${analysis.endpointCatalog.length} endpoints detected)`);
    lines.push(
      ...httpFamilies.slice(0, 10).map((family) => `- ${family.family} (${family.count})${family.samples.length ? ` — ${family.samples.join(', ')}` : ''}`),
    );
  } else if (httpContracts.length > 0) {
    lines.push(`- HTTP / web ingress contract families (${httpContracts.length} API families inferred from source contracts)`);
    lines.push(...httpContracts.map((family) => `- ${family}`));
  }
  const integrationItems = codeGraph?.summary.integrationInterfaces ?? collectIntegrationItems(analysis);
  if (integrationItems.length > 0) {
    lines.push('- integration interfaces');
    lines.push(...integrationItems.map((item) => `- ${item}`));
  }
  const internalServices = codeGraph
    ? unique(codeGraph.summary.serviceNames).slice(0, 12)
    : collectNamedKinds(analysis, ['service'], 12);
  if (internalServices.length > 0) {
    lines.push('- internal service boundaries');
    lines.push(...internalServices.map((item) => `- ${item}`));
  }
  if (serviceSummary.clientImplementations.length || serviceSummary.misplacedDtos.length || serviceSummary.serviceEvents.length || serviceSummary.exceptionTypes.length || serviceSummary.serviceInterfaces.length) {
    lines.push('- service module boundaries');
    lines.push(`- SERVICE: module role — ${serviceSummary.moduleRole}`);
    if (serviceSummary.clientImplementations.length) {
      lines.push(`- SERVICE: client implementations — ${serviceSummary.clientImplementations.map((item) => `${item.name} (${item.purpose}${item.issue ? `; issue: ${item.issue}` : ''})`).slice(0, 8).join(' | ')}`);
    }
    if (serviceSummary.misplacedDtos.length) {
      lines.push(`- SERVICE: local DTOs — ${serviceSummary.misplacedDtos.map((item) => `${item.name} (${item.purpose}; issue: ${item.issue})`).slice(0, 8).join(' | ')}`);
    }
    if (serviceSummary.serviceEvents.length) {
      lines.push(`- SERVICE: events — ${serviceSummary.serviceEvents.map((item) => `${item.name} (${item.purpose}${item.issue ? `; issue: ${item.issue}` : ''})`).slice(0, 10).join(' | ')}`);
    }
    if (serviceSummary.serviceInterfaces.length) {
      lines.push(`- SERVICE: interfaces — ${serviceSummary.serviceInterfaces.map((item) => `${item.name} (${item.purpose}${item.issue ? `; issue: ${item.issue}` : ''})`).join(' | ')}`);
    }
  if (serviceSummary.executionServices.length) {
      lines.push(`- SERVICE: execution services — ${serviceSummary.executionServices.map((service) => `${service.name} (${service.purpose}; operations: ${service.operations.map((operation) => `${operation.name} -> ${operation.purpose}`).slice(0, 5).join(' / ')})`).join(' | ')}`);
      lines.push(...serviceSummary.executionServices.map((service) => `- SERVICE_SUMMARY: ${service.name} — ${service.purpose}`));
      lines.push(`- SERVICE_FLOW_PREP: ${serviceSummary.executionServices.map((service) => `${service.name} [deps: ${service.dependencies.slice(0, 8).join(', ') || 'none'}; ops: ${service.operations.map((operation) => `${operation.name}{collab:${operation.collaborators.join(', ') || 'none'}; effects:${operation.sideEffects.join(', ') || 'none'}; annotations:${operation.annotations.join(', ') || 'none'}}`).slice(0, 4).join(' / ')}]`).join(' | ')}`);
    }
    if (analysis.flowSummary.triggers.length) {
      lines.push(`- FLOW_TRIGGER: ${analysis.flowSummary.triggers.map((trigger) => `${trigger.kind} :: ${trigger.name} (${trigger.source} -> ${trigger.target}${trigger.notes.length ? `; ${trigger.notes.join(' / ')}` : ''})`).join(' | ')}`);
    }
    if (serviceSummary.mailCapabilities.config.length) {
      lines.push(`- SERVICE: mail config — ${serviceSummary.mailCapabilities.config.join(' | ')}`);
    }
    if (serviceSummary.mailCapabilities.templates.length) {
      lines.push(`- SERVICE: mail templates — ${serviceSummary.mailCapabilities.templates.map((item) => `${item.name} (${item.purpose}; personalization: ${item.personalization.join(' / ')})`).join(' | ')}`);
    }
    if (serviceSummary.mailCapabilities.operations.length) {
      lines.push(`- SERVICE: mail operations — ${serviceSummary.mailCapabilities.operations.map((item) => `${item.name} (${item.purpose}; ${item.flow}${item.issue ? `; issue: ${item.issue}` : ''})`).join(' | ')}`);
    }
    if (serviceSummary.storageCapabilities.summary.length) {
      lines.push(`- SERVICE: storage — ${serviceSummary.storageCapabilities.summary.join(' | ')}`);
    }
    if (serviceSummary.storageCapabilities.uploads.length) {
      lines.push(`- SERVICE: storage uploads — ${serviceSummary.storageCapabilities.uploads.map((item) => `${item.name} (${item.purpose}; used by ${item.targets.join(', ')})`).join(' | ')}`);
    }
    if (serviceSummary.schedulingModel.length) {
      lines.push(`- SERVICE: scheduling — ${serviceSummary.schedulingModel.join(' | ')}`);
    }
    if (serviceSummary.scheduledJobs.length) {
      lines.push(`- SERVICE: jobs — ${serviceSummary.scheduledJobs.map((item) => `${item.name} (${item.schedule}; ${item.purpose}; ${item.executionModel}${item.effects.length ? `; effects: ${item.effects.join(' / ')}` : ''})`).join(' | ')}`);
    }
    if (serviceSummary.asyncListeners.length) {
      lines.push(`- SERVICE: listeners — ${serviceSummary.asyncListeners.map((item) => `${item.name} (${item.purpose}${item.triggers.length ? `; triggers: ${item.triggers.map((trigger) => `${trigger.event} from ${trigger.source} -> ${trigger.effect}`).join(' / ')}` : ''})`).join(' | ')}`);
    }
    if (serviceSummary.exceptionTypes.length) {
      lines.push(`- SERVICE_EXCEPTIONS: runtime exceptions — ${serviceSummary.exceptionTypes.map((item) => `${item.name} (${item.purpose}${item.thrownBy.length ? `; thrown by ${item.thrownBy.join(', ')}` : ''})`).join(' | ')}`);
    }
    if (serviceSummary.violations.length) {
      lines.push(`- SERVICE: violations — ${serviceSummary.violations.join(' | ')}`);
    }
  }
  const validationBoundaries = codeGraph?.summary.validationBoundaries ?? [];
  const exceptionHandlers = codeGraph?.summary.exceptionHandlers ?? [];
  const webConfigurations = codeGraph?.summary.webConfigurations ?? [];
  const webSecurityBoundaries = codeGraph?.summary.webSecurityBoundaries ?? [];
  if (validationBoundaries.length > 0 || exceptionHandlers.length > 0 || webConfigurations.length > 0 || webSecurityBoundaries.length > 0) {
    lines.push('- web framework boundaries');
    if (validationBoundaries.length > 0) lines.push(`- request validation: ${validationBoundaries.slice(0, 12).join(' | ')}`);
    if (exceptionHandlers.length > 0) lines.push(`- global error handling: ${exceptionHandlers.slice(0, 8).join(' | ')}`);
    if (webConfigurations.length > 0) lines.push(`- web configuration: ${webConfigurations.slice(0, 8).join(' | ')}`);
    if (webSecurityBoundaries.length > 0) lines.push(`- web security boundary: ${webSecurityBoundaries.slice(0, 8).join(' | ')}`);
  }
  const persistenceSurfaces = codeGraph?.summary.persistenceTargets ?? collectPersistenceItems(analysis);
  const applicationItems = collectApplicationInterfaceItems(analysis.repositoryStructure);
  if (applicationItems.length > 0) {
    lines.push('- application boundaries');
    lines.push(...applicationItems.map((item) => `- ${item}`));
  }
  if (persistenceSurfaces.length > 0) {
    lines.push('- persistence surfaces');
    lines.push(...persistenceSurfaces.map((item) => `- ${item}`));
  }
  if (persistenceSummary.repositories.length || persistenceSummary.mapperSummary.rowMappers.length || persistenceSummary.entityNames.length) {
    lines.push('- persistence module boundaries');
    lines.push(`- PERSISTENCE: module role — ${persistenceSummary.moduleRole}`);
    if (persistenceSummary.repositoryStyles.length) {
      lines.push(`- PERSISTENCE: repository styles — ${persistenceSummary.repositoryStyles.map((item) => `${item.style.toUpperCase()} [${item.repositories.length}] (${item.rationale})`).join(' | ')}`);
    }
    if (persistenceSummary.repositories.length) {
      lines.push(`- PERSISTENCE: repositories — ${persistenceSummary.repositories.slice(0, 12).map((item) => `${item.name} (${item.style}; ${item.purpose}; ops: ${item.operationGroups.join(', ') || 'general persistence'}${item.notableOperation ? `; notable: ${item.notableOperation}` : ''})`).join(' | ')}`);
    }
    if (persistenceSummary.mapperSummary.abstractBase || persistenceSummary.mapperSummary.rowMappers.length || persistenceSummary.mapperSummary.dtoMappers.length) {
      const mapperParts = [
        persistenceSummary.mapperSummary.abstractBase
          ? `${persistenceSummary.mapperSummary.abstractBase} (${persistenceSummary.mapperSummary.abstractBaseNotes.join(', ') || 'shared row helper base'})`
          : '',
        persistenceSummary.mapperSummary.rowMappers.length
          ? `row mappers: ${persistenceSummary.mapperSummary.rowMappers.slice(0, 10).join(' | ')}`
          : '',
        persistenceSummary.mapperSummary.dtoMappers.length
          ? `other mappers: ${persistenceSummary.mapperSummary.dtoMappers.slice(0, 8).join(' | ')}`
          : '',
        persistenceSummary.mapperSummary.notes.length
          ? `notes: ${persistenceSummary.mapperSummary.notes.slice(0, 4).join(' | ')}`
          : '',
      ].filter(Boolean);
      lines.push(`- PERSISTENCE: mappers — ${mapperParts.join(' ; ')}`);
    }
    if (persistenceSummary.entityNames.length) {
      lines.push(`- PERSISTENCE: entities — ${persistenceSummary.entityNames.slice(0, 10).join(' | ')}`);
    }
  }
  return lines.length ? lines.join('\n') : '- interface boundaries still need to be inferred from the source';
}

function buildFlowLines(analysis: SourceProjectAnalysis, codeGraph?: CodeKnowledgeGraph): string {
  const lines: string[] = [];
  const serviceNames = codeGraph?.summary.serviceNames ?? collectNamedKinds(analysis, ['service'], 10);
  const jobNames = codeGraph?.summary.jobNames ?? collectNamedKinds(analysis, ['job'], 8);
  const listenerNames = codeGraph?.summary.listenerNames ?? collectNamedKinds(analysis, ['listener'], 8);
  const repositoryNames = codeGraph?.summary.repositoryNames ?? collectNamedKinds(analysis, ['repository'], 8);
  const entityNames = codeGraph?.summary.entityNames ?? collectNamedKinds(analysis, ['entity'], 8);

  if (serviceNames.length > 0) {
    lines.push(`- service responsibilities: ${serviceNames.join(' | ')}`);
  }
  if (jobNames.length > 0) {
    lines.push(`- scheduled processors: ${jobNames.join(' | ')}`);
  }
  if (listenerNames.length > 0) {
    lines.push(`- async event consumers: ${listenerNames.join(' | ')}`);
  }
  if (repositoryNames.length > 0) {
    lines.push(`- repository-backed write/read paths: ${repositoryNames.join(' | ')}`);
  }
  if (entityNames.length > 0) {
    lines.push(`- domain entities touched by flows: ${entityNames.join(' | ')}`);
  }
  if (analysis.endpointCatalog.some((entry) => /search/i.test(entry.path) || /search/i.test(entry.typeName ?? ''))) {
    lines.push('- read/search flow is distinct from write flow');
  }
  if (analysis.flowSummary.triggers.length > 0) {
    lines.push(`- trigger classification: ${analysis.flowSummary.triggers.map((trigger) => `${trigger.kind}:${trigger.name}`).join(' | ')}`);
  }
  if (analysis.flowSummary.flows.length > 0) {
    for (const flow of analysis.flowSummary.flows) {
      lines.push(`- ${flow.name}: ${flow.summary}`);
      lines.push(...flow.steps.map((step) => `  - ${step}`));
    }
  }
  if (analysis.schemaHints.length > 0) {
    lines.push('- persistence flows may update explicit tables, columns, and relationships inferred from SQL or entity annotations');
  }
  if (codeGraph?.summary.flowTraces?.length) {
    lines.push(`- code graph flow traces: ${codeGraph.summary.flowTraces.slice(0, 10).join(' | ')}`);
  }
  return lines.length ? lines.join('\n') : '- concrete flows still need to be refined from the source';
}

function buildProcessLines(analysis: SourceProjectAnalysis, codeGraph?: CodeKnowledgeGraph): string {
  const lines: string[] = [];
  if (analysis.repositoryStructure.multiModuleMaven) lines.push('- keep version catalog, dependency management, shared build conventions, and runtime layers separated across dedicated Maven modules');
  if (analysis.appRuntime.applicationEntryPoint) lines.push('- bootstrap the Spring Boot application from the app module entry point');
  if (analysis.appRuntime.runtimeFeatures.some((item) => /Flyway/i.test(item))) lines.push('- apply Flyway database migrations incrementally during startup');
  if (analysis.appRuntime.runtimeFeatures.some((item) => /Actuator/i.test(item))) lines.push('- expose actuator runtime monitoring endpoints');
  if (analysis.commonSummary.eventFlow) {
    lines.push(`- publish notification domain events from backend services over ${analysis.commonSummary.eventFlow.transport} on ${analysis.commonSummary.eventFlow.channel}`);
    lines.push('- consume notification events asynchronously in the notification service, persist them, then fan out over WebSocket');
  }
  if (analysis.counts.controllers > 0) lines.push('- handle inbound requests and route them to the right service action');
  if (analysis.counts.services > 0) lines.push('- execute named service responsibilities and use-case steps');
  if (analysis.serviceSummary.clientImplementations.length > 0) lines.push('- keep outbound client adapters outside the core service module when explicit module boundaries are enforced');
  if (analysis.serviceSummary.misplacedDtos.length > 0) lines.push('- keep DTO ownership in api or common modules instead of service-local packages');
  if (analysis.counts.repositories > 0) lines.push('- query and persist domain state through repository adapters');
  if (analysis.counts.entities > 0) lines.push('- map domain objects to table-backed persistence shapes');
  if (analysis.persistenceSummary.repositoryStyles.some((item) => item.style === 'jpa') && analysis.persistenceSummary.repositoryStyles.some((item) => item.style === 'jdbc')) {
    lines.push('- use Spring Data JPA where aggregate/token persistence is simple, and NamedParameterJdbcTemplate where explicit SQL is easier to maintain');
  }
  const jobs = codeGraph?.summary.jobNames ?? collectNamedKinds(analysis, ['job'], 8);
  if (jobs.length > 0) lines.push(`- scheduled processors: ${jobs.join(' | ')}`);
  const listeners = codeGraph?.summary.listenerNames ?? collectNamedKinds(analysis, ['listener'], 8);
  if (listeners.length > 0) lines.push(`- async event listeners: ${listeners.join(' | ')}`);
  if (analysis.serviceSummary.scheduledJobs.some((item) => item.name === 'PopularityRefreshJob')) lines.push('- refresh the popularity materialized view every 10 minutes on async scheduler threads');
  if (analysis.serviceSummary.scheduledJobs.some((item) => item.name === 'EventAutoArchiveJob')) lines.push('- auto-archive expired published events daily through the event auto-archive service');
  if (analysis.serviceSummary.asyncListeners.some((item) => item.name === 'StatsEventListener')) lines.push('- update event and organizer dashboard statistics asynchronously from service-layer events after commit');
  if (analysis.serviceSummary.mailCapabilities.operations.length > 0) lines.push('- render HTML email templates with runtime links and send them through the configured external SMTP mail service');
  if (analysis.serviceSummary.storageCapabilities.uploads.length > 0) lines.push('- normalize uploaded media, generate sanitized object keys/metadata, and publish frontend-safe public URLs from object storage');
  if (analysis.schemaHints.length > 0) lines.push('- maintain explicit table and relationship ownership where schema hints are present');
  if (analysis.technologies.some((item) => /jwt|oauth|security/i.test(item)) || analysis.counts.securityClasses > 0) lines.push('- enforce authentication and authorization gates before state changes');
  if ((codeGraph?.summary.validationBoundaries.length ?? 0) > 0) lines.push('- validate request payloads and query/path parameters at the web boundary');
  if ((codeGraph?.summary.exceptionHandlers.length ?? 0) > 0) lines.push('- translate validation and domain exceptions into consistent HTTP error responses');
  if (analysis.serviceSummary.exceptionTypes.length > 0) lines.push('- throw runtime exceptions in the service layer so controller advice can translate them into meaningful HTTP responses');
  return lines.length ? lines.join('\n') : '- processes still need to be refined from the source';
}

function buildDependencyLines(analysis: SourceProjectAnalysis, codeGraph?: CodeKnowledgeGraph): string {
  const lines: string[] = [];
  if (analysis.repositoryStructure.multiModuleMaven) lines.push('- multi-module Maven build with separated versions, BOM, build parent, and runtime modules');
  const externalSystems = codeGraph?.summary.externalSystems ?? [];
  if (externalSystems.some((item) => /postgres|database|sql|relational/i.test(item)) || analysis.technologies.some((item) => /postgres|database|sql/i.test(item))) lines.push('- relational database');
  if (externalSystems.some((item) => /redis/i.test(item)) || analysis.technologies.some((item) => /redis/i.test(item))) lines.push('- redis');
  if (externalSystems.some((item) => /websocket/i.test(item)) || analysis.technologies.some((item) => /websocket/i.test(item))) lines.push('- websocket gateway');
  if (externalSystems.some((item) => /mail/i.test(item)) || analysis.technologies.some((item) => /mail/i.test(item))) lines.push('- mail service');
  if (externalSystems.some((item) => /object storage|minio|s3/i.test(item)) || analysis.technologies.some((item) => /minio|s3/i.test(item))) lines.push('- MinIO / object storage');
  if (analysis.technologies.some((item) => /oauth|oidc/i.test(item))) lines.push('- external auth providers');
  if (analysis.technologies.some((item) => /jwt|security/i.test(item))) lines.push('- security provider or auth boundary');
  if (analysis.javaCatalog.some((item) => item.integrationHints.some((hint) => /feignclient|http client|rest client/i.test(hint)))) lines.push('- external HTTP client adapter');
  if (analysis.technologies.some((item) => /kafka|rabbit|nsq|mqtt/i.test(item))) lines.push('- message broker / event stream');
  if (codeGraph?.summary.persistenceTargets?.length) lines.push(`- persistence targets: ${filterPersistenceTargets(codeGraph.summary.persistenceTargets).slice(0, 8).join(' | ')}`);
  if (analysis.counts.sqlFiles > 0) lines.push(`- SQL migrations (${analysis.counts.sqlFiles})`);
  return lines.length ? lines.join('\n') : '- dependencies still need to be refined from the source';
}

function buildSecurityLines(analysis: SourceProjectAnalysis, codeGraph?: CodeKnowledgeGraph): string {
  const lines: string[] = [];
  if (analysis.repositoryStructure.topLevelProjects.some((item) => item.name === 'event-notification')) {
    lines.push('- this semantic slice is focused on event-backend; event-notification remains a separate application in the same repository');
  }
  if (analysis.technologies.some((item) => /jwt/i.test(item))) lines.push('- JWT-based authentication is present');
  if (analysis.technologies.some((item) => /oauth/i.test(item))) lines.push('- OAuth / OIDC style auth is present or implied');
  if (analysis.technologies.some((item) => /turnstile/i.test(item))) lines.push('- bot / challenge protection is present');
  if (analysis.counts.securityClasses > 0) lines.push('- explicit security classes exist in the source');
  if (analysis.javaCatalog.some((item) => item.securityHints.length > 0)) {
    lines.push('- annotations and code hints suggest explicit authz / authorization gates');
  }
  if (codeGraph?.summary.externalSystems.some((item) => /oauth|oidc|jwt|security/i.test(item))) {
    lines.push('- security-adjacent dependencies show up in the code graph');
  }
  if ((codeGraph?.summary.webSecurityBoundaries.length ?? 0) > 0) {
    lines.push(`- web security boundary components: ${codeGraph!.summary.webSecurityBoundaries.slice(0, 10).join(' | ')}`);
  }
  if (analysis.commonSummary.securityDetails.length) {
    lines.push(...analysis.commonSummary.securityDetails.map((item) => `- ${item}`));
  }
  return lines.length ? lines.join('\n') : '- security boundaries still need to be refined from the source';
}

function buildArchitectureLines(analysis: SourceProjectAnalysis, codeGraph?: CodeKnowledgeGraph): string {
  const lines: string[] = [];
  const repositoryStructure = analysis.repositoryStructure;
  const httpFamilies = codeGraph?.summary.endpointFamilies ?? groupEndpointFamilies(analysis.endpointCatalog.filter((entry) => /^(GET|POST|PUT|DELETE|PATCH|REQUEST)$/i.test(entry.method)));
  const httpContracts = collectHttpContractFamilies(analysis);
  const apiSurface = analysis.apiSurface ?? createEmptyApiSurfaceSummary();
  const appRuntime = analysis.appRuntime;
  const persistenceSummary = analysis.persistenceSummary;
  const serviceSummary = analysis.serviceSummary;
  if (repositoryStructure.multiModuleMaven) {
    lines.push('- repository structure: multi-module Maven repository with explicit separation between version catalog, dependency BOM, shared build parent, and runtime modules');
    if (repositoryStructure.topLevelProjects.length) {
      lines.push(`- top-level applications: ${repositoryStructure.topLevelProjects.map((item) => `${item.name} (${item.role})`).join(' | ')}`);
    }
    if (repositoryStructure.backendSupportModules.length) {
      lines.push(`- backend build layers: ${repositoryStructure.backendSupportModules.map((item) => `${item.name} (${item.role})`).join(' | ')}`);
    }
    if (repositoryStructure.backendRuntimeLayers.length) {
      lines.push(`- event-backend runtime layers: ${repositoryStructure.backendRuntimeLayers.map((item) => `${item.name} (${item.role})`).join(' | ')}`);
    }
  }
  if (analysis.commonSummary.crossCuttingComponents.length || analysis.commonSummary.eventTypes.length) {
    const commonParts = [
      analysis.commonSummary.crossCuttingComponents.length ? `${analysis.commonSummary.crossCuttingComponents.length} cross-cutting components` : '',
      analysis.commonSummary.securityComponents.length ? `${analysis.commonSummary.securityComponents.length} shared security components` : '',
      analysis.commonSummary.eventTypes.length ? `${analysis.commonSummary.eventTypes.length} notification event types` : '',
      analysis.commonSummary.eventFlow ? 'Redis Pub/Sub notification bridge to event-notification' : '',
    ].filter(Boolean);
    lines.push(`- common/shared layer: ${commonParts.join(' | ')}`);
  }
  if (appRuntime.applicationEntryPoint || appRuntime.runtimeFeatures.length || appRuntime.importedConfigFiles.length) {
    const appParts = [
      appRuntime.applicationEntryPoint ? `entry point ${appRuntime.applicationEntryPoint}` : '',
      appRuntime.runtimeFeatures.find((item) => /Flyway/i.test(item)) ? 'Flyway incremental migrations' : '',
      appRuntime.runtimeFeatures.find((item) => /Actuator/i.test(item)) ? 'Actuator' : '',
      appRuntime.importedConfigFiles.length ? `${appRuntime.importedConfigFiles.length} runtime config imports` : '',
      appRuntime.configurationBeans.length ? `${appRuntime.configurationBeans.length} app bean configs` : '',
    ].filter(Boolean);
    lines.push(`- application bootstrap layer: ${appParts.join(' | ')}`);
  }
  if (apiSurface.families.length > 0) {
    const apiParts = [
      `${apiSurface.families.length} API families`,
      `${analysis.endpointCatalog.length} endpoints`,
      apiSurface.contractSource === 'openapi-generated' ? 'OpenAPI YAML-generated contracts' : 'Java contract interfaces',
      apiSurface.swaggerConfigPresent ? 'swagger docs' : '',
      apiSurface.validationEnabled ? 'validation' : '',
      apiSurface.clientImplementations.length ? `${apiSurface.clientImplementations.length} client contracts` : '',
    ].filter(Boolean);
    lines.push(`- API contract layer: ${apiParts.join(' | ')}`);
  }
  if (httpFamilies.length > 0) {
    lines.push(`- web / HTTP ingress layer (${analysis.endpointCatalog.length} endpoints): ${httpFamilies.slice(0, 6).map((family) => `${family.family} (${family.count})`).join(' | ')}`);
  } else if (httpContracts.length > 0) {
    lines.push(`- web / HTTP ingress layer: contract-first API surface with ${httpContracts.length} API families`);
  } else if (analysis.counts.controllers > 0) {
    lines.push(`- web / HTTP ingress layer (${analysis.counts.controllers} controller entry points)`);
  }

  const integrationItems = codeGraph?.summary.integrationInterfaces ?? collectIntegrationItems(analysis);
  if (integrationItems.length > 0) {
    lines.push(`- integration interface layer: ${integrationItems.slice(0, 8).join(' | ')}`);
  }

  const securityItems = unique([
    ...collectNamedKinds(analysis, ['security'], 8),
    ...(analysis.counts.securityClasses > 0 ? ['explicit security components'] : []),
  ]);
  if (securityItems.length > 0) {
    lines.push(`- security layer: ${securityItems.slice(0, 8).join(' | ')}`);
  } else if (analysis.technologies.some((item) => /jwt|oauth|security/i.test(item))) {
    lines.push('- security layer: JWT-based authentication and explicit authorization checks');
  }

  const serviceNames = codeGraph?.summary.serviceNames ?? collectNamedKinds(analysis, ['service'], 8);
  const backgroundNames = unique([...(codeGraph?.summary.jobNames ?? collectNamedKinds(analysis, ['job'], 6)), ...(codeGraph?.summary.listenerNames ?? collectNamedKinds(analysis, ['listener'], 6))]);
  if (serviceNames.length > 0 || backgroundNames.length > 0) {
    const serviceText = serviceNames.length > 0 ? serviceNames.join(' | ') : 'service responsibilities';
    const backgroundText = backgroundNames.length > 0 ? `; background processors: ${backgroundNames.join(' | ')}` : '';
    lines.push(`- service layer: ${serviceText}${backgroundText}`);
  }
  if (serviceSummary.clientImplementations.length || serviceSummary.misplacedDtos.length || serviceSummary.serviceEvents.length || serviceSummary.exceptionTypes.length) {
    const serviceParts = [
      serviceSummary.clientImplementations.length ? `${serviceSummary.clientImplementations.length} service-local client implementation(s)` : '',
      serviceSummary.misplacedDtos.length ? `${serviceSummary.misplacedDtos.length} service-local DTO(s)` : '',
      serviceSummary.serviceEvents.length ? `${serviceSummary.serviceEvents.length} service-owned event type(s)` : '',
      serviceSummary.mailCapabilities.operations.length ? 'mail delivery and templating' : '',
      serviceSummary.storageCapabilities.uploads.length ? 'media storage / image processing' : '',
      serviceSummary.scheduledJobs.length ? `${serviceSummary.scheduledJobs.length} scheduled job(s)` : '',
      serviceSummary.asyncListeners.length ? `${serviceSummary.asyncListeners.length} async listener(s)` : '',
      serviceSummary.exceptionTypes.length ? `${serviceSummary.exceptionTypes.length} runtime exception type(s)` : '',
    ].filter(Boolean);
    lines.push(`- service support layer: ${serviceParts.join(' | ')}`);
  }

  const persistenceItems = codeGraph?.summary.persistenceTargets ?? collectPersistenceItems(analysis);
  if (persistenceItems.length > 0) {
    const styleSummary = persistenceSummary.repositoryStyles.length
      ? `; repository styles: ${persistenceSummary.repositoryStyles.map((item) => `${item.style.toUpperCase()} ${item.repositories.length}`).join(' | ')}`
      : '';
    lines.push(`- persistence / storage layer: ${filterPersistenceTargets(persistenceItems).slice(0, 8).join(' | ')}${styleSummary}`);
  } else if (analysis.counts.repositories > 0 || analysis.counts.entities > 0) {
    lines.push(`- persistence / storage layer (${analysis.counts.repositories} repositories, ${analysis.counts.entities} entities)`);
  }
  if (persistenceSummary.repositories.length > 0) {
    const notable = persistenceSummary.repositories
      .filter((item) => item.notableOperation)
      .slice(0, 4)
      .map((item) => `${item.name}: ${item.notableOperation}`);
    if (notable.length > 0) {
      lines.push(`- persistence repository patterns: ${notable.join(' | ')}`);
    }
  }
  const webConcernParts: string[] = [];
  if ((codeGraph?.summary.validationBoundaries.length ?? 0) > 0) webConcernParts.push(`request validation via ${codeGraph!.summary.validationBoundaries.slice(0, 6).join(' | ')}`);
  if ((codeGraph?.summary.exceptionHandlers.length ?? 0) > 0) webConcernParts.push(`global exception mapping via ${codeGraph!.summary.exceptionHandlers.slice(0, 4).join(' | ')}`);
  if ((codeGraph?.summary.webConfigurations.length ?? 0) > 0) webConcernParts.push(`web configuration via ${codeGraph!.summary.webConfigurations.slice(0, 4).join(' | ')}`);
  if ((codeGraph?.summary.webSecurityBoundaries.length ?? 0) > 0) webConcernParts.push(`security boundary via ${codeGraph!.summary.webSecurityBoundaries.slice(0, 4).join(' | ')}`);
  if (webConcernParts.length > 0) {
    lines.push(`- web support layer: ${webConcernParts.join('; ')}`);
  }
  return lines.length ? lines.join('\n') : '- architecture layers still need to be refined from the source';
}

function collectHttpContractFamilies(analysis: SourceProjectAnalysis): string[] {
  const families = new Set<string>();
  for (const item of analysis.javaCatalog) {
    const typeName = item.typeName ?? '';
    if (!/Api$/.test(typeName)) continue;
    if (!/\/api\//i.test(item.file) && !/\.api(?:\.|$)/i.test(item.packageName ?? '')) continue;
    const family = typeName.replace(/Api$/, '').trim();
    if (!family || /^(Open)?ApiConfig$/i.test(typeName)) continue;
    families.add(family);
  }
  for (const astFile of analysis.javaAstCatalog ?? []) {
    if (!isHttpContractAstFile(astFile)) continue;
    for (const type of astFile.types) {
      if (!/Api$/.test(type.name) || /^(Open)?ApiConfig$/i.test(type.name)) continue;
      families.add(type.name.replace(/Api$/, '').trim());
    }
  }
  return [...families].sort((left, right) => left.localeCompare(right));
}

async function collectApiSurfaceSummary(
  projectRoot: string,
  astCatalog: JavaAstFile[],
  endpointCatalog: JavaEndpointSummary[],
  yamlFiles: string[],
): Promise<ApiSurfaceSummary> {
  const apiAstFiles = astCatalog.filter((astFile) => isHttpContractAstFile(astFile));
  const openApiYamlPath = firstExisting(yamlFiles, /openapi\.yaml$|event-api\.yaml$/);
  const clientAstFiles = astCatalog.filter((astFile) => /\/api\/src\/main\/java\/.*\/client\//i.test(astFile.file) || /\.client(?:\.|$)/i.test(astFile.packageName ?? ''));
  const dtoEnumMap = new Map<string, string>();

  for (const astFile of astCatalog) {
    const packageName = astFile.packageName ?? '';
    if (!/\/dto\//i.test(astFile.file) && !/\.dto(?:\.|$)/i.test(packageName)) continue;
    for (const type of astFile.types) {
      if (type.kind === 'enum') {
        dtoEnumMap.set(type.name, inferEnumPurpose(type.name));
      }
    }
  }

  const families: ApiFamilySummary[] = [];
  let swaggerConfigPresent = false;
  let generatedContracts = false;
  let validationEnabled = false;

  for (const astFile of apiAstFiles) {
    const text = await readFile(astFile.file, 'utf8').catch(() => '');
    if (!text) continue;
    swaggerConfigPresent ||= /io\.swagger|swagger-ui|OpenAPI/i.test(text) || /OpenApiConfig/.test(astFile.file);
    generatedContracts ||= /openapi generator|org\.openapitools\.codegen/i.test(text);
    validationEnabled ||= /@Validated\b|@Valid\b|jakarta\.validation/i.test(text);
    const type = astFile.types.find((entry) => /Api$/.test(entry.name));
    const family = extractApiFamilyName(text, type?.name);
    const familyEndpoints = endpointCatalog.filter((entry) => (entry.typeName ?? '').replace(/Api$/, '') === family);
    const authProtectedCount = countSecurityProtectedEndpoints(text);
    const authMode = authProtectedCount === 0
      ? 'public'
      : authProtectedCount >= familyEndpoints.length && familyEndpoints.length > 0
        ? 'protected'
        : 'mixed';
    const dtoTypes = unique(
      astFile.imports
        .filter((entry) => /\.dto\./i.test(entry))
        .map((entry) => entry.split('.').pop() ?? entry)
        .filter((name) => name && !dtoEnumMap.has(name)),
    );
    const enumTypes = unique(
      astFile.imports
        .map((entry) => entry.split('.').pop() ?? entry)
        .filter((name) => dtoEnumMap.has(name)),
    );
    families.push({
      family,
      endpointCount: familyEndpoints.length,
      endpointSamples: unique(familyEndpoints.slice(0, 4).map((entry) => `${entry.method} ${entry.path}`)),
      authMode,
      securitySchemes: unique(extractSecuritySchemes(text)),
      permissionHints: unique(extractPermissionHints(text)),
      dtoTypes: dtoTypes.slice(0, 12),
      enumTypes: enumTypes.slice(0, 8),
      hasValidation: /@Validated\b|@Valid\b|jakarta\.validation/i.test(text),
      hasSwagger: /io\.swagger|@Operation\b|@Tag\b|@ApiResponse\b/i.test(text),
    });
  }

  const clientImplementations = clientAstFiles.flatMap((astFile) =>
    astFile.types.map((type) => ({
      name: type.name,
      purpose: inferClientPurpose(type.name, astFile),
    })),
  );

  return {
    contractSource: openApiYamlPath || generatedContracts ? 'openapi-generated' : apiAstFiles.length ? 'java-contracts' : 'unknown',
    openApiYamlPath,
    swaggerConfigPresent: swaggerConfigPresent || astCatalog.some((astFile) => /OpenApiConfig/i.test(astFile.file)),
    generatedContracts,
    validationEnabled,
    clientImplementations: uniqueBy(clientImplementations, (item) => item.name),
    enumTypes: [...dtoEnumMap.entries()].map(([name, purpose]) => ({ name, purpose })).sort((left, right) => left.name.localeCompare(right.name)),
    families: families.sort((left, right) => right.endpointCount - left.endpointCount || left.family.localeCompare(right.family)),
  };
}

function extractApiFamilyName(text: string, fallbackTypeName?: string): string {
  const tagName = text.match(/@Tag\s*\(\s*name\s*=\s*"([^"]+)"/)?.[1]?.trim();
  if (tagName) return tagName;
  if (fallbackTypeName) return fallbackTypeName.replace(/Api$/, '');
  return 'API';
}

function createEmptyApiSurfaceSummary(): ApiSurfaceSummary {
  return {
    contractSource: 'unknown',
    swaggerConfigPresent: false,
    generatedContracts: false,
    validationEnabled: false,
    clientImplementations: [],
    enumTypes: [],
    families: [],
  };
}

function countSecurityProtectedEndpoints(text: string): number {
  return [...text.matchAll(/@SecurityRequirement\s*\(\s*name\s*=\s*"([^"]+)"/g)].length;
}

function extractSecuritySchemes(text: string): string[] {
  return unique([...text.matchAll(/@SecurityRequirement\s*\(\s*name\s*=\s*"([^"]+)"/g)].map((match) => match[1]).filter(Boolean));
}

function extractPermissionHints(text: string): string[] {
  const hints = new Set<string>();
  const lower = text.toLowerCase();
  if (/\bowner\b|tulajdonos/i.test(lower)) hints.add('owner access');
  if (/\badmin\b|jogosultság szükséges|organizer admin/i.test(lower)) hints.add('admin access');
  if (/\bmoderator\b/i.test(lower)) hints.add('moderator access');
  if (/\bauthenticated\b|bejelentkez/i.test(lower)) hints.add('authenticated user');
  if (/\bpublic\b|nyilvános|permitall/i.test(lower)) hints.add('public access');
  return [...hints];
}

function inferClientPurpose(typeName: string, astFile: JavaAstFile): string {
  const joined = `${typeName} ${(astFile.imports ?? []).join(' ')}`.toLowerCase();
  if (/oauth/.test(joined)) return 'OAuth provider integration';
  if (/userinfo/.test(joined)) return 'external identity profile payload';
  if (/client/.test(joined)) return 'outbound API client';
  return 'API-side integration support';
}

function inferEnumPurpose(typeName: string): string {
  if (/status/i.test(typeName)) return 'state / lifecycle values';
  if (/role/i.test(typeName)) return 'authorization / role values';
  if (/provider/i.test(typeName)) return 'provider selection values';
  if (/visibility/i.test(typeName)) return 'visibility / publication mode values';
  if (/type/i.test(typeName)) return 'typed API choice values';
  return 'API contract enum values';
}

async function collectAppRuntimeSummary(
  projectRoot: string,
  astCatalog: JavaAstFile[],
  yamlFiles: string[],
  pomFiles: string[],
): Promise<AppRuntimeSummary> {
  const appAstFiles = astCatalog.filter((astFile) => /\/app\//i.test(astFile.file) || /\.app(?:\.|$)/i.test(astFile.packageName ?? ''));
  const runtimeFeatures = new Set<string>();
  const importedConfigFiles: Array<{ name: string; purpose: string }> = [];
  const configurationBeans: Array<{ name: string; purpose: string }> = [];
  const securityConfigurations = new Set<string>();
  const externalDependencies = new Set<string>();
  let applicationEntryPoint: string | undefined;
  let bootstrapClass: string | undefined;

  for (const astFile of appAstFiles) {
    const text = await readFile(astFile.file, 'utf8').catch(() => '');
    for (const type of astFile.types) {
      if (!applicationEntryPoint && /SpringBootApplication/i.test(type.annotations.join(' ')) && type.methods.some((method) => method.name === 'main')) {
        bootstrapClass = type.name;
        applicationEntryPoint = `${type.name}.main`;
        runtimeFeatures.add('Spring Boot application entry point');
      }
      if (type.annotations.some((annotation) => /ConfigurationPropertiesScan/i.test(annotation))) {
        runtimeFeatures.add('Configuration properties scanning');
      }
      if (type.annotations.some((annotation) => /Configuration/i.test(annotation))) {
        if (/security/i.test(astFile.file) || /security/i.test(type.name)) {
          securityConfigurations.add(type.name);
        }
      }
      if (type.methods.some((method) => method.annotations.some((annotation) => /Bean/i.test(annotation)))) {
        configurationBeans.push({
          name: type.name,
          purpose: inferConfigurationPurpose(type.name, astFile.file, text),
        });
      }
    }
  }

  for (const yamlFile of yamlFiles.filter((file) => /\/app\/src\/main\/resources\//i.test(file))) {
    const name = basename(yamlFile);
    importedConfigFiles.push({ name, purpose: inferConfigFilePurpose(name) });
    const text = await readFile(yamlFile, 'utf8').catch(() => '');
    if (/spring:\s*[\s\S]*flyway:/i.test(text)) runtimeFeatures.add('Flyway incremental database migrations');
    if (/management:|actuator/i.test(text)) runtimeFeatures.add('Actuator runtime endpoints');
    if (/spring:\s*[\s\S]*datasource:/i.test(text)) runtimeFeatures.add('Datasource bootstrap configuration');
    if (/spring:\s*[\s\S]*redis:/i.test(text)) runtimeFeatures.add('Redis runtime configuration');
    if (/security/i.test(name) || /jwt|turnstile|issuer/i.test(text)) securityConfigurations.add(name);
    for (const dependency of inferExternalDependenciesFromConfig(name, text)) {
      externalDependencies.add(dependency);
    }
  }

  for (const pomFile of pomFiles.filter((file) => /\/app\/pom\.xml$/i.test(file))) {
    const text = await readFile(pomFile, 'utf8').catch(() => '');
    if (/spring-boot-starter-actuator/i.test(text)) runtimeFeatures.add('Actuator runtime endpoints');
    if (/flyway-core|flyway-database-postgresql/i.test(text)) runtimeFeatures.add('Flyway incremental database migrations');
  }

  return {
    applicationEntryPoint,
    bootstrapClass,
    importedConfigFiles: uniqueBy(importedConfigFiles, (item) => item.name),
    configurationBeans: uniqueBy(configurationBeans, (item) => item.name),
    securityConfigurations: [...securityConfigurations].sort((left, right) => left.localeCompare(right)),
    runtimeFeatures: [...runtimeFeatures].sort((left, right) => left.localeCompare(right)),
    externalDependencies: [...externalDependencies].sort((left, right) => left.localeCompare(right)),
  };
}

function inferExternalDependenciesFromConfig(name: string, text: string): string[] {
  const lowerName = name.toLowerCase();
  const lowerText = text.toLowerCase();
  const dependencies = new Set<string>();
  if (lowerName.includes('mail') || /spring:\s*[\s\S]*mail:|javamailsender|smtp|from-address/.test(lowerText)) {
    dependencies.add('Mail service');
  }
  if (lowerName.includes('minio') || /minio|s3|bucket|endpoint:/.test(lowerText)) {
    dependencies.add('MinIO / object storage');
  }
  if (/spring:\s*[\s\S]*redis:|redis:|lettuce|jedis/.test(lowerText)) {
    dependencies.add('Redis');
  }
  if (lowerName.includes('security') || /oauth|oidc|turnstile|issuer|jwks|auth-provider|google|facebook|apple/.test(lowerText)) {
    dependencies.add('External auth providers');
  }
  if (/websocket|sockjs|stomp/.test(lowerText)) {
    dependencies.add('WebSocket');
  }
  if (/kafka|rabbitmq|amqp|mqtt|nsq/.test(lowerText)) {
    dependencies.add('Message broker / event stream');
  }
  return [...dependencies];
}

function inferConfigFilePurpose(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'application.yaml' || lower === 'application.yml') return 'application bootstrap, datasource, redis, flyway, server runtime';
  if (lower.includes('security')) return 'security, JWT, turnstile, auth runtime settings';
  if (lower.includes('mail')) return 'mail service runtime configuration';
  if (lower.includes('cors')) return 'web CORS configuration';
  if (lower.includes('minio')) return 'object storage / MinIO configuration';
  return 'application runtime configuration';
}

function inferConfigurationPurpose(typeName: string, file: string, text: string): string {
  const joined = `${typeName} ${file} ${text}`.toLowerCase();
  if (/minio|s3client|storage/.test(joined)) return 'object storage client bootstrap';
  if (/security|jwt|bearer|auth/.test(joined)) return 'security bootstrap';
  if (/mail/.test(joined)) return 'mail runtime bootstrap';
  if (/cors/.test(joined)) return 'web CORS bootstrap';
  return 'application bean configuration';
}

function inferSingleModuleRole(name: string): string {
  if (/ear$/i.test(name)) return 'EAR assembly — packages EJB and Web layers into a deployable enterprise archive';
  if (/ejb$/i.test(name)) return 'EJB module — business logic, domain services, and EJB-based transaction boundaries';
  if (/web$/i.test(name)) return 'Web module — servlet layer, UI resources, and web-tier entry points';
  if (/commonutil$/i.test(name)) return 'shared utilities library — reusable helper code and common constants';
  if (/common$/i.test(name)) return 'shared library — cross-cutting utilities and common domain support';
  if (/types$/i.test(name)) return 'types module — shared data contracts, DTOs, and domain type definitions';
  if (/avro$/i.test(name)) return 'Avro schemas — message and event serialization definitions';
  if (/install$/i.test(name)) return 'installation module — deployment scripts and release packaging artifacts';
  if (/exttestclient$/i.test(name) || /testclient$/i.test(name)) return 'test utility — standalone developer or integration test helper';
  if (/client$/i.test(name)) return 'client library — external API stub or service integration client';
  return 'standalone Maven module';
}

function collectRepositoryStructureSummary(projectRoot: string, modules: string[]): RepositoryStructureSummary {
  const normalizedModules = modules.map((item) => item.replace(/\\/g, '/'));
  const hasEventBackend = normalizedModules.some((item) => item === 'event-backend');
  const backendSupportModules = [
    { name: 'event-backend/versions', role: 'central version property catalog for plugin, library, and platform versions' },
    { name: 'event-backend/bom', role: 'dependency BOM that pins and exports managed library versions' },
    { name: 'event-backend/build', role: 'shared build parent with dependencyManagement and pluginManagement' },
  ].filter((item) => hasEventBackend || normalizedModules.includes(item.name));
  const backendRuntimeLayers = [
    { name: 'event-backend/api', role: 'OpenAPI-generated API contracts, DTOs, enums, and client-side interfaces' },
    { name: 'event-backend/app', role: 'Spring Boot entry point and runtime bootstrap configuration' },
    { name: 'event-backend/common', role: 'shared cross-cutting components, security, and infrastructure support' },
    { name: 'event-backend/persistence', role: 'database-facing entities, repositories, and persistence adapters' },
    { name: 'event-backend/service', role: 'application orchestration, domain services, and business flows' },
    { name: 'event-backend/web', role: 'HTTP controller implementations, web validation, and exception mapping' },
  ].filter((item) => hasEventBackend || normalizedModules.includes(item.name));

  const topLevelRoots = unique(normalizedModules.map((item) => item.split('/')[0]).filter(Boolean));
  const topLevelProjects: Array<{ name: string; role: string }> = topLevelRoots.map((rootName) => {
    const childModules = normalizedModules.filter((item) => item.startsWith(`${rootName}/`));
    if (rootName === 'event-backend') {
      return {
        name: rootName,
        role: 'multi-module backend application with separated build, version, dependency, and runtime layers',
      };
    }
    if (rootName === 'event-notification') {
      return {
        name: rootName,
        role: 'single-module notification application in the same repository with package-level internal components',
      };
    }
    return {
      name: rootName,
      role: childModules.length > 0
        ? 'multi-module application with child Maven modules under a shared application root'
        : inferSingleModuleRole(rootName),
    };
  });

  if (!topLevelProjects.length && normalizedModules.length === 0) {
    topLevelProjects.push({
      name: basename(projectRoot),
      role: 'single application rooted at the repository root',
    });
  }

  return {
    multiModuleMaven: normalizedModules.length > 1,
    topLevelProjects,
    backendAggregator: hasEventBackend ? 'event-backend' : undefined,
    backendSupportModules,
    backendRuntimeLayers,
    technicalBenefits: [
      'version alignment is centralized instead of repeated in every runtime module',
      'dependency management and plugin management are separated from application code',
      'runtime layers are independently navigable and easier to evolve or version',
      'application boundaries are isolated inside the same repository',
    ],
  };
}

async function collectCommonSummary(projectRoot: string): Promise<CommonSummary> {
  const commonRoot = join(projectRoot, 'event-backend', 'common', 'src', 'main', 'java', 'hu', 'event', 'be', 'common');
  const notificationPublisherPath = join(commonRoot, 'notification', 'NotificationPublisher.java');
  const notificationEventPath = join(commonRoot, 'notification', 'NotificationEvent.java');
  const securityConfigPath = join(commonRoot, 'security', 'SecurityConfig.java');
  const jwtIssuerPath = join(commonRoot, 'security', 'JwtIssuer.java');
  const authPropsPath = join(commonRoot, 'security', 'AuthProps.java');
  const ipUtilPath = join(commonRoot, 'utils', 'IpUtil.java');
  const currentUserProviderPath = join(commonRoot, 'user', 'CurrentUserProvider.java');
  const subscriberPath = join(projectRoot, 'event-notification', 'src', 'main', 'java', 'hu', 'event', 'notification', 'redis', 'NotificationSubscriber.java');
  const redisConfigPath = join(projectRoot, 'event-notification', 'src', 'main', 'java', 'hu', 'event', 'notification', 'redis', 'RedisConfig.java');
  const serviceRoot = join(projectRoot, 'event-backend', 'service', 'src', 'main', 'java');

  const securityConfigText = await readFile(securityConfigPath, 'utf8').catch(() => '');
  const authPropsText = await readFile(authPropsPath, 'utf8').catch(() => '');
  const publisherText = await readFile(notificationPublisherPath, 'utf8').catch(() => '');
  const subscriberText = await readFile(subscriberPath, 'utf8').catch(() => '');
  const redisConfigText = await readFile(redisConfigPath, 'utf8').catch(() => '');

  const eventTypes = await collectNotificationEventTypes(serviceRoot);
  const producerCallers = await collectNotificationPublisherCallers(serviceRoot);
  const channel = publisherText.match(/incoming-channel:([^}"']+)/)?.[1]?.trim() ?? 'notifications:incoming';
  const securityDetails = buildCommonSecurityDetails(securityConfigText, authPropsText);

  return {
    crossCuttingComponents: [
      { name: 'NotificationPublisher', role: 'cross-module async notification publisher over Redis Pub/Sub' },
      { name: 'NotificationEvent', role: 'shared notification payload contract between backend and notification service' },
      { name: 'SecurityConfig', role: 'shared Spring Security policy and route protection rules' },
      { name: 'JwtIssuer', role: 'shared JWT access token issuer using RSA signing' },
      { name: 'CurrentUserProvider', role: 'shared current-user resolution from Spring Security context' },
    ],
    utilityComponents: ['CookieUtil', 'DateTimeUtil', 'DisplayNameGenerator', 'EnumUtil', 'IpUtil', 'ListUtil', 'ObjectUtil', 'SlugUtil', 'StringUtil', 'UserDataValidator'],
    stateCarrierComponents: ['AuthProps', 'MinioProperties', 'NotificationEvent', 'FeedbackType'],
    securityComponents: ['SecurityConfig', 'JwtIssuer', 'JwtDecoderConfig', 'JwtKeyConfig', 'CookieOrHeaderBearerTokenResolver', 'AuthProps', 'CurrentUserProvider', 'IpUtil'],
    securityDetails,
    eventTypes,
    eventFlow: {
      publisher: 'NotificationPublisher.publish()',
      transport: 'Redis Pub/Sub',
      channel,
      producerCallers,
      subscriber: 'event-notification.redis.NotificationSubscriber',
      subscriberEffects: [
        'deserialize NotificationEvent from JSON',
        'persist notification via NotificationService',
        'push saved notification to WsGateway for connected user',
      ],
    },
  };
}

async function collectNotificationEventTypes(serviceRoot: string): Promise<Array<{ name: string; purpose: string }>> {
  const output = await execLocal(`rg -o 'setType\\(\"[A-Z_]+\"\\)' "${serviceRoot}" -g '*.java' | sed 's/.*setType(\"\\([A-Z_]*\\)\").*/\\1/' | sort -u`);
  const values = output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return values.map((name) => ({ name, purpose: inferNotificationEventPurpose(name) }));
}

async function collectNotificationPublisherCallers(serviceRoot: string): Promise<string[]> {
  const output = await execLocal(`rg -l 'notificationPublisher\\.publish\\(' "${serviceRoot}" -g '*.java'`);
  return output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((file) => basename(file).replace(/\.java$/, ''))
    .sort((left, right) => left.localeCompare(right));
}

function inferNotificationEventPurpose(name: string): string {
  switch (name) {
    case 'EVENT_DELETED': return 'event deletion notification';
    case 'EVENT_UPDATED': return 'event update notification';
    case 'EVENT_CANCELLED': return 'event cancellation notification';
    case 'ORGANIZER_ROLE_GRANTED': return 'organizer admin role grant notification';
    case 'NEW_EVENT_ORGANIZER': return 'new event for followed organizer';
    case 'NEW_EVENT_LOCATION': return 'new event for followed location';
    case 'COHOST_INVITATION_CREATED': return 'cohost invitation creation notification';
    case 'ORGANIZER_ADDED_AS_COHOST': return 'organizer became cohost notification';
    default: return 'notification domain event';
  }
}

function buildCommonSecurityDetails(securityConfigText: string, authPropsText: string): string[] {
  const lines: string[] = [];
  if (/BCryptPasswordEncoder\(12\)/.test(securityConfigText)) lines.push('password hashing uses BCrypt with strength 12');
  if (/createDefaultWithIssuer/.test(securityConfigText) || /createDefaultWithIssuer/.test(authPropsText)) {
    lines.push('JWT issuer validation is enforced on decode');
  }
  const ttl = authPropsText.match(/accessTTLSeconds\s*=\s*(\d+)/)?.[1];
  if (ttl) lines.push(`access token TTL is ${ttl} seconds`);
  if (/requestMatchers\(\"\/auth\/\*\*\", \"\/v3\/api-docs\/\*\*\", \"\/swagger-ui\/\*\*\", \"\/swagger-ui.html\"\)\s*\.permitAll/s.test(securityConfigText)) {
    lines.push('auth endpoints, Swagger UI, and OpenAPI docs are public');
  }
  if (/requestMatchers\(HttpMethod\.GET, \"\/feed\", \"\/feed\/\*\*\"\)\.permitAll/s.test(securityConfigText)) {
    lines.push('public feed endpoints are readable without authentication');
  }
  if (/requestMatchers\(HttpMethod\.GET, \"\/events\/\*\*\"\)\.permitAll/s.test(securityConfigText)) {
    lines.push('event detail endpoints are publicly readable');
  }
  if (/requestMatchers\(HttpMethod\.POST, \"\/tracking\/\*\*\"\)\.permitAll/s.test(securityConfigText)) {
    lines.push('tracking ingest endpoints are public');
  }
  if (/requestMatchers\(\"\/error\"\)\.permitAll/s.test(securityConfigText)) {
    lines.push('error route is public to avoid auth loops on unmapped requests');
  }
  if (/anyRequest\(\)\.authenticated\(\)/.test(securityConfigText)) {
    lines.push('every route not explicitly whitelisted requires authentication');
  }
  if (/CookieOrHeaderBearerTokenResolver/.test(securityConfigText)) {
    lines.push('bearer token resolution accepts Authorization header or access_token cookie');
  }
  return lines;
}

async function collectPersistenceSummary(projectRoot: string): Promise<PersistenceSummary> {
  const persistenceRoot = join(projectRoot, 'event-backend', 'persistence', 'src', 'main', 'java', 'hu', 'event', 'be', 'persistence');
  const repositoryRoot = join(persistenceRoot, 'repository');
  const mapperRoot = join(persistenceRoot, 'mapper');
  const entityRoot = join(persistenceRoot, 'entity');

  const [repositoryFiles, mapperFiles, entityFiles] = await Promise.all([
    collectFiles(repositoryRoot, /Repository\.java$/).catch(() => []),
    collectFiles(mapperRoot, '.java').catch(() => []),
    collectFiles(entityRoot, '.java').catch(() => []),
  ]);

  const repositories = (
    await Promise.all(repositoryFiles.map(async (file) => parsePersistenceRepository(file)))
  ).filter((item): item is NonNullable<typeof item> => Boolean(item));

  const entityNames = unique(
    entityFiles
      .map((file) => basename(file).replace(/\.java$/, ''))
      .filter(Boolean),
  ).sort((left, right) => left.localeCompare(right));

  const mapperSummary = await collectPersistenceMapperSummary(mapperFiles);
  const jpaRepositories = repositories.filter((item) => item.style === 'jpa').map((item) => item.name);
  const jdbcRepositories = repositories.filter((item) => item.style === 'jdbc').map((item) => item.name);

  return {
    moduleRole: 'explicit persistence module containing repositories, entities, SQL-oriented adapters, and mapper implementations',
    repositoryStyles: [
      {
        style: 'jpa' as const,
        repositories: jpaRepositories,
        rationale: 'used where aggregate/token/entity persistence is simpler through Spring Data JPA',
      },
      {
        style: 'jdbc' as const,
        repositories: jdbcRepositories,
        rationale: 'used where query-heavy or custom SQL behavior is simpler with NamedParameterJdbcTemplate / direct SQL',
      },
    ].filter((item) => item.repositories.length > 0),
    repositories,
    entityNames,
    mapperSummary,
  };
}

async function collectServiceSummary(projectRoot: string): Promise<ServiceSummary> {
  const serviceRoot = join(projectRoot, 'event-backend', 'service', 'src', 'main', 'java', 'hu', 'event', 'be', 'service');
  const clientRoot = join(serviceRoot, 'client');
  const dtoRoot = join(serviceRoot, 'dto');
  const eventRoot = join(serviceRoot, 'events');
  const exceptionRoot = join(serviceRoot, 'exception');
  const interfaceRoot = join(serviceRoot, 'interfaces');
  const jobsRoot = join(serviceRoot, 'jobs');
  const listenersRoot = join(serviceRoot, 'listeners');

  const [clientFiles, dtoFiles, eventFiles, exceptionFiles, interfaceFiles, jobFiles, listenerFiles] = await Promise.all([
    collectFiles(clientRoot, '.java').catch(() => []),
    collectFiles(dtoRoot, '.java').catch(() => []),
    collectFiles(eventRoot, '.java').catch(() => []),
    collectFiles(exceptionRoot, '.java').catch(() => []),
    collectFiles(interfaceRoot, '.java').catch(() => []),
    collectFiles(jobsRoot, '.java').catch(() => []),
    collectFiles(listenersRoot, '.java').catch(() => []),
  ]);

  const clientImplementations = await Promise.all(
    clientFiles.map(async (file) => {
      const text = await readFile(file, 'utf8').catch(() => '');
      const name = basename(file).replace(/\.java$/, '');
      return {
        name,
        purpose: inferServiceClientPurpose(name, text),
        issue: 'client implementation lives in service module; should move to a dedicated client / integration module',
      };
    }),
  );

  const misplacedDtos = await Promise.all(
    dtoFiles.map(async (file) => {
      const text = await readFile(file, 'utf8').catch(() => '');
      const name = basename(file).replace(/\.java$/, '');
      return {
        name,
        purpose: inferServiceDtoPurpose(name, text),
        issue: 'service-local DTO should live in api or common instead of the service module',
      };
    }),
  );

  const eventNames = eventFiles.map((file) => basename(file).replace(/\.java$/, ''));
  const commonHasEvents = true;
  const serviceEvents = eventNames.map((name) => ({
    name,
    purpose: inferServiceEventPurpose(name),
    issue: commonHasEvents ? 'event contract placement is split between common and service; consolidate event ownership' : undefined,
  }));

  const exceptionUsage = await collectServiceExceptionUsage(serviceRoot);
  const exceptionTypes = exceptionFiles.map((file) => {
    const name = basename(file).replace(/\.java$/, '');
    return {
      name,
      purpose: inferServiceExceptionPurpose(name),
      thrownBy: exceptionUsage.get(name) ?? [],
    };
  });

  const serviceInterfaces = await Promise.all(
    interfaceFiles.map(async (file) => {
      const text = await readFile(file, 'utf8').catch(() => '');
      const name = basename(file).replace(/\.java$/, '');
      return {
        name,
        purpose: inferServiceInterfacePurpose(name, text),
        issue: hasMeaningfulInterfaceComment(text) ? undefined : 'service interface lacks descriptive documentation / contract comments',
      };
    }),
  );

  const executionServices = await collectExecutionServices(serviceRoot);
  const mailCapabilities = await collectMailCapabilities(projectRoot, serviceRoot);
  const storageCapabilities = await collectStorageCapabilities(projectRoot, serviceRoot);
  const schedulingModel = await collectSchedulingModel(jobFiles);
  const scheduledJobs = await collectScheduledJobs(projectRoot, jobFiles);
  const asyncListeners = await collectAsyncListeners(listenerFiles);

  const violations = unique([
    clientImplementations.length ? `service module currently contains ${clientImplementations.length} client implementation(s); prefer a dedicated clients / integration module` : '',
    misplacedDtos.length ? `service module currently contains ${misplacedDtos.length} DTO class(es); prefer api or common ownership for transfer shapes` : '',
    serviceEvents.length ? 'service module defines domain events while common also contains event-like contracts; event ownership should be consolidated' : '',
    serviceInterfaces.some((item) => item.issue) ? 'service interface contracts should be documented; MailService currently lacks descriptive comments' : '',
    mailCapabilities.operations.some((item) => item.issue) ? 'mail service declares invite delivery but the current implementation leaves sendInvite unimplemented' : '',
  ]).filter(Boolean);

  return {
    moduleRole: 'application orchestration layer containing business services, guards, jobs, listeners, and currently some misplaced adapters/contracts',
    clientImplementations,
    misplacedDtos,
    serviceEvents,
    exceptionTypes,
    serviceInterfaces,
    executionServices,
    mailCapabilities,
    storageCapabilities,
    schedulingModel,
    scheduledJobs,
    asyncListeners,
    violations,
  };
}

async function collectMailCapabilities(projectRoot: string, serviceRoot: string): Promise<ServiceSummary['mailCapabilities']> {
  const configPath = join(projectRoot, 'event-backend', 'app', 'src', 'main', 'resources', 'mail-config.yaml');
  const implPath = join(serviceRoot, 'mail', 'MailServiceImpl.java');
  const verificationTemplate = join(projectRoot, 'event-backend', 'app', 'src', 'main', 'resources', 'templates', 'email-verification.html');
  const resetTemplate = join(projectRoot, 'event-backend', 'app', 'src', 'main', 'resources', 'templates', 'password-reset.html');
  const [configText, implText, verificationHtml, resetHtml] = await Promise.all([
    readFile(configPath, 'utf8').catch(() => ''),
    readFile(implPath, 'utf8').catch(() => ''),
    readFile(verificationTemplate, 'utf8').catch(() => ''),
    readFile(resetTemplate, 'utf8').catch(() => ''),
  ]);

  const config: string[] = [];
  const host = configText.match(/host:\s*(.+)/)?.[1]?.trim();
  const port = configText.match(/port:\s*(.+)/)?.[1]?.trim();
  const baseUrl = configText.match(/base-url:\s*(.+)/)?.[1]?.trim();
  const from = configText.match(/from-address:\s*(.+)/)?.[1]?.trim();
  if (host || port) config.push(`outbound SMTP mail service via ${host ?? 'configured host'}:${port ?? '?'}`);
  if (baseUrl) config.push(`mail links are built against frontend/base URL ${baseUrl}`);
  if (from) config.push(`emails are sent from ${from}`);

  const templates = [
    {
      name: 'email-verification.html',
      purpose: 'account email verification message',
      personalization: verificationHtml.includes('{{link}}')
        ? ['injects `{{link}}` with `/auth/verify?token=<verification-token>`']
        : [],
    },
    {
      name: 'password-reset.html',
      purpose: 'password reset message',
      personalization: resetHtml.includes('{{link}}')
        ? ['injects `{{link}}` with `/auth/reset-password?token=<one-time-reset-token>`']
        : [],
    },
  ].filter((item) => item.personalization.length > 0);

  const operations: ServiceSummary['mailCapabilities']['operations'] = [];
  if (/sendVerificationEmail/.test(implText)) {
    operations.push({
      name: 'sendVerificationEmail',
      purpose: 'send HTML verification email after registration or resend flow',
      flow: 'EmailVerificationService creates a 24-hour token, stores it, then personalizes `email-verification.html` with a verification link',
    });
  }
  if (/sendPasswordResetEmail/.test(implText)) {
    operations.push({
      name: 'sendPasswordResetEmail',
      purpose: 'send HTML password reset email',
      flow: 'PasswordResetService creates a one-time reset token with 2-hour expiry, stores it, then personalizes `password-reset.html` with a reset link',
    });
  }
  operations.push({
    name: 'sendInvite',
    purpose: 'send invite emails for event invitation batches',
    flow: 'InviteService persists invite rows, then InviteDispatchService asynchronously calls MailService.sendInvite(...) for each email',
    issue: /UnsupportedOperationException\("Unimplemented method 'sendInvite'"\)/.test(implText)
      ? 'invite delivery contract exists but MailServiceImpl.sendInvite is currently unimplemented'
      : undefined,
  });

  return { config, templates, operations };
}

async function collectExecutionServices(serviceRoot: string): Promise<ServiceSummary['executionServices']> {
  const servicesDir = join(serviceRoot, 'services');
  const files = await collectFiles(servicesDir, '.java').catch(() => []);
  const services = await Promise.all(
    files.map(async (file) => summarizeExecutionService(await readFile(file, 'utf8').catch(() => ''), basename(file).replace(/\.java$/, ''))),
  );
  return services
    .filter((item): item is ServiceSummary['executionServices'][number] => Boolean(item))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function collectFlowSummary(
  projectRoot: string,
  endpointCatalog: JavaEndpointSummary[],
  serviceSummary: ServiceSummary,
): Promise<FlowSummary> {
  const triggers: FlowSummary['triggers'] = [];
  const flows: FlowSummary['flows'] = [];

  const authRegister = endpointCatalog.find((entry) => entry.method === 'POST' && entry.path === '/auth/register');
  if (authRegister) {
    triggers.push({
      kind: 'http-api',
      name: 'Auth register API',
      source: `${authRegister.method} ${authRegister.path}`,
      target: authRegister.typeName ?? 'AuthApi',
      notes: ['OpenAPI contract -> AuthApiImpl controller -> AuthService.register flow'],
    });
  }

  for (const job of serviceSummary.scheduledJobs) {
    triggers.push({
      kind: 'scheduler',
      name: job.name,
      source: job.schedule,
      target: job.name,
      notes: [job.executionModel],
    });
  }

  for (const listener of serviceSummary.asyncListeners) {
    triggers.push({
      kind: 'event-listener',
      name: listener.name,
      source: listener.triggers.map((item) => item.event).join(' | ') || 'application events',
      target: listener.name,
      notes: [listener.purpose],
    });
  }

  const securityYaml = await readFile(join(projectRoot, 'event-backend', 'app', 'src', 'main', 'resources', 'security.yaml'), 'utf8').catch(() => '');
  if (/turnstile/i.test(securityYaml)) {
    triggers.push({
      kind: 'external-callback',
      name: 'Cloudflare Turnstile verification',
      source: 'Cloudflare Turnstile siteverify',
      target: 'TurnstileService.verify',
      notes: ['used as a precondition before selected public auth flows such as register'],
    });
  }

  flows.push({
    name: 'User registration flow',
    trigger: 'POST /auth/register',
    summary: 'Public registration request passes captcha validation, persists a new user, triggers verification email delivery, issues tokens, and returns auth response with refresh cookie.',
    steps: [
      'AuthApi contract exposes `POST /auth/register`; AuthApiImpl receives RegisterRequest.',
      'AuthApiImpl validates the Cloudflare Turnstile token through TurnstileService using the caller IP; invalid captcha returns HTTP 400.',
      'AuthService.register checks that terms were accepted and that the email is not already registered; either failure returns an error branch.',
      'AuthService creates and saves the new user entity, encoding the password and recording TOS acceptance.',
      'EmailVerificationService creates a verification token and sends a verification email to the saved user.',
      'AuthService issues the access token and builds AuthResponse from the saved user profile.',
      'AuthApiImpl creates the refresh cookie via RefreshTokenService and returns HTTP 201 with response body and Set-Cookie header.',
    ],
  });

  flows.push({
    name: 'Daily event auto-archive flow',
    trigger: 'EventAutoArchiveJob daily 03:00 Europe/Budapest',
    summary: 'A scheduled background job calls the auto-archive service, which archives published non-deleted events that are already over by end time or by a start-time-plus-8-hours fallback rule.',
    steps: [
      'EventAutoArchiveJob is triggered every day at 03:00 Europe/Budapest.',
      'The job delegates execution to EventAutoArchiveService.archiveExpiredEventsAsync().',
      'The service calls EventRepository.archiveExpiredEvents() inside an async transactional background execution.',
      'The repository updates events to `archived` when status is `published`, `deleted_at` is null, and either `end_time < now()` or `end_time` is null while `start_time < now() - 8 hours`.',
      'The flow completes without HTTP ingress; it is a scheduler-triggered lifecycle maintenance process.',
    ],
  });

  return { triggers, flows };
}

function summarizeExecutionService(text: string, name: string): ServiceSummary['executionServices'][number] | undefined {
  if (!text || /interface\s+/.test(text)) return undefined;
  const dependencies = extractConstructorDependencies(text);
  const methods = extractPublicMethodBlocks(text)
    .filter((method) => !['toString', 'hashCode', 'equals'].includes(method.name))
    .map((method) => summarizeServiceOperation(name, method, dependencies))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (!methods.length) return undefined;
  return {
    name,
    purpose: inferExecutionServicePurpose(name),
    operations: methods,
    dependencies,
  };
}

function summarizeServiceOperation(
  serviceName: string,
  method: { name: string; signature: string; body: string },
  dependencies: string[],
): ServiceSummary['executionServices'][number]['operations'][number] | undefined {
  const annotations = unique((method.signature.match(/@\w+(?:\([^)]*\))?/g) ?? []).map((item) => item.trim()));
  const collaboratorHits = dependencies.filter((dep) => new RegExp(`\\b${escapeRegExp(lowerCamel(dep))}\\b|\\b${escapeRegExp(dep)}\\b`).test(method.body));
  const dtoMatch = method.signature.match(/\(([^)]*)\)/)?.[1]
    ?.split(',')
    .map((item) => item.trim())
    .find((item) => /\bRequest\b|\bMultipartFile\b/.test(item));
  const input = dtoMatch ? dtoMatch.replace(/\s+/g, ' ') : undefined;
  const sideEffects = inferOperationSideEffects(method.body, collaboratorHits);
  const purpose = inferServiceOperationPurpose(serviceName, method.name, method.body, input);
  if (!purpose) return undefined;
  return {
    name: method.name,
    purpose,
    input,
    collaborators: collaboratorHits,
    sideEffects,
    annotations,
  };
}

function inferExecutionServicePurpose(serviceName: string): string {
  const label = serviceName.replace(/Service$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  if (/auth/.test(label)) return 'authentication and identity lifecycle orchestration';
  if (/event auto archive/.test(label)) return 'background event lifecycle maintenance';
  if (/invite dispatch/.test(label)) return 'asynchronous invite delivery orchestration';
  if (/email verification/.test(label)) return 'email verification token lifecycle and verification flow';
  if (/password reset/.test(label)) return 'password reset token lifecycle and password update flow';
  if (/tracking/.test(label)) return 'tracking ingestion and event-stat trigger orchestration';
  return `${label} use-case orchestration`;
}

function inferServiceOperationPurpose(serviceName: string, methodName: string, body: string, input?: string): string | undefined {
  if (serviceName === 'AuthService' && methodName === 'register') {
    return 'register a new user, require terms acceptance, reject duplicate email, persist credentials, trigger email verification, and return authenticated profile data';
  }
  if (serviceName === 'AuthService' && methodName === 'login') return 'authenticate an existing user, enforce email verification, and return access token plus onboarding-aware profile';
  if (serviceName === 'AuthService' && methodName === 'refreshAndRotate') return 'rotate refresh token cookie, validate session state, and issue a new access token';
  if (serviceName === 'AuthService' && methodName === 'oauthCallback') return 'exchange OAuth callback code, link or create the user, and return authenticated profile data';
  if (serviceName === 'PasswordResetService' && methodName === 'requestReset') return 'create a one-time password reset token and trigger password reset email delivery';
  if (serviceName === 'PasswordResetService' && methodName === 'confirmReset') return 'validate reset token state and persist a newly encoded password';
  if (serviceName === 'EmailVerificationService' && methodName === 'createAndSendToken') return 'create a verification token and send a verification email';
  if (serviceName === 'EmailVerificationService' && methodName === 'verifyToken') return 'consume a verification token, mark the user verified, and advance onboarding';
  if (serviceName === 'EmailVerificationService' && methodName === 'resendByToken') return 'invalidate an older verification token and issue a fresh verification email';
  if (serviceName === 'InviteDispatchService' && methodName === 'dispatchInvitesAsync') return 'dispatch invite emails asynchronously for a batch of recipients';
  if (serviceName === 'TrackingService' && methodName === 'recordView') return 'persist a single event view interaction and emit a view-recorded domain event';
  if (serviceName === 'TrackingService' && methodName === 'recordClick') return 'persist a single event click interaction and emit a click-recorded domain event';
  if (serviceName === 'TrackingService' && methodName === 'recordBatch') return 'persist batched tracking interactions and emit deduplicated view/click events per event';
  if (serviceName === 'EventAutoArchiveService' && methodName === 'archiveExpiredEventsAsync') return 'run auto-archive update for expired published events on the background executor';

  if (/create|register|upsert|save|confirm|verify|refresh|dispatch|record|upload|add|remove|accept|reject|revoke|archive|publish|search|get|list|find/i.test(methodName)) {
    const verb = methodName.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    const inputHint = input ? ` using ${input.split(/\s+/)[0]}` : '';
    const repo = /Repository/.test(body) ? ' with repository-backed state changes' : '';
    const svc = /Service/.test(body) ? ' and downstream service coordination' : '';
    return `${verb}${inputHint}${repo}${svc}`.trim();
  }
  return undefined;
}

function inferOperationSideEffects(body: string, collaborators: string[]): string[] {
  const effects = new Set<string>();
  if (/publishEvent\(/.test(body)) effects.add('publishes application/domain events');
  if (/createAndSendToken\(|sendVerificationEmail\(|sendPasswordResetEmail\(|sendInvite\(/.test(body)) effects.add('triggers outbound email delivery');
  if (/save\(|update\(|insert|upsert|delete|archiveExpiredEvents|revokeByJti|replaceForUserAndUa/.test(body)) effects.add('persists or mutates database state');
  if (/issueAccess\(/.test(body)) effects.add('issues JWT access tokens');
  if (/ResponseCookie/.test(body) || /COOKIE_NAME/.test(body)) effects.add('manages refresh-token cookie lifecycle');
  if (/upload\w+\(/.test(body) || /MediaStorageService/.test(body)) effects.add('uploads media to object storage');
  if (collaborators.some((dep) => /Repository$/.test(dep))) effects.add('reads or writes through repositories');
  return [...effects];
}

function extractConstructorDependencies(text: string): string[] {
  const matches = [...text.matchAll(/private\s+final\s+([A-Za-z0-9_$.<>?]+)\s+([a-zA-Z0-9_]+)\s*;/g)];
  return unique(matches.map((match) => stripGenericType(match[1]).split('.').pop() ?? match[1]));
}

function extractPublicMethodBlocks(text: string): Array<{ name: string; signature: string; body: string }> {
  const methods: Array<{ name: string; signature: string; body: string }> = [];
  const regex = /((?:@[A-Za-z0-9_().," =]+\s*)*)public\s+[A-Za-z0-9_<>\[\]?.,\s]+\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const signatureStart = match.index;
    const bodyStart = regex.lastIndex - 1;
    const bodyEnd = findMatchingBrace(text, bodyStart);
    if (bodyEnd < 0) continue;
    methods.push({
      name: match[2],
      signature: text.slice(signatureStart, bodyStart + 1),
      body: text.slice(bodyStart + 1, bodyEnd),
    });
    regex.lastIndex = bodyEnd + 1;
  }
  return methods;
}

function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function stripGenericType(value: string): string {
  return value.replace(/<.*>/g, '');
}

function lowerCamel(name: string): string {
  return name ? `${name.charAt(0).toLowerCase()}${name.slice(1)}` : name;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function collectStorageCapabilities(projectRoot: string, serviceRoot: string): Promise<ServiceSummary['storageCapabilities']> {
  const storagePath = join(serviceRoot, 'storage', 'MediaStorageService.java');
  const processorPath = join(serviceRoot, 'storage', 'MediaImageProcessor.java');
  const minioPath = join(projectRoot, 'event-backend', 'common', 'src', 'main', 'java', 'hu', 'event', 'be', 'common', 'storage', 'MinioProperties.java');
  const [storageText, processorText, minioText] = await Promise.all([
    readFile(storagePath, 'utf8').catch(() => ''),
    readFile(processorPath, 'utf8').catch(() => ''),
    readFile(minioPath, 'utf8').catch(() => ''),
  ]);

  const summary: string[] = [];
  if (/S3Client/.test(storageText) && /MinioProperties/.test(storageText)) summary.push('uploads media through S3-compatible MinIO object storage');
  if (/uploadImageAware/.test(storageText)) summary.push('routes uploads through an image-aware processor before storage');
  if (/maxWidth.*maxHeight/s.test(processorText) || /1920, 1920/.test(storageText)) summary.push('resizes large images to bounded dimensions so frontend display remains predictable');
  if (/image\/gif/.test(processorText) && /image\/webp/.test(processorText)) summary.push('bypasses re-encoding for GIF and WEBP, and falls back to raw upload for non-image or unreadable files');
  if (/filename\*=UTF-8/.test(processorText) && /toAsciiSafe/.test(processorText)) summary.push('sanitizes object keys, ASCII-safe metadata, and content-disposition filenames to avoid broken paths and header issues');
  if (/buildPublicUrl/.test(minioText)) summary.push('builds normalized public URLs from bucket + sanitized object key');

  const uploads: ServiceSummary['storageCapabilities']['uploads'] = [];
  if (/uploadEventMedia/.test(storageText)) uploads.push({ name: 'uploadEventMedia', purpose: 'store event cover and gallery media with max 1920x1920 image normalization', targets: ['EventService.uploadCover', 'MediaService.addMediaToEvent'] });
  if (/uploadOrganizerLogo/.test(storageText)) uploads.push({ name: 'uploadOrganizerLogo', purpose: 'store organizer logos with max 800x800 image normalization', targets: ['OrganizerService.uploadLogo'] });
  if (/uploadUserAvatar/.test(storageText)) uploads.push({ name: 'uploadUserAvatar', purpose: 'store user avatars with max 512x512 image normalization', targets: ['ProfileService.uploadAvatar'] });

  return { summary, uploads };
}

async function collectSchedulingModel(jobFiles: string[]): Promise<string[]> {
  const configFile = jobFiles.find((file) => /SchedulingConfig\.java$/.test(file));
  if (!configFile) return [];
  const text = await readFile(configFile, 'utf8').catch(() => '');
  if (!text) return [];

  const details: string[] = [];
  if (/@EnableScheduling/.test(text)) details.push('Spring scheduling is enabled');
  if (/@EnableAsync/.test(text)) details.push('async job/listener execution is enabled');
  const schedulerPool = text.match(/setPoolSize\((\d+)\)/);
  if (schedulerPool?.[1]) details.push(`scheduled jobs run on ThreadPoolTaskScheduler pool size ${schedulerPool[1]}`);
  const corePool = text.match(/setCorePoolSize\((\d+)\)/);
  const maxPool = text.match(/setMaxPoolSize\((\d+)\)/);
  const queue = text.match(/setQueueCapacity\((\d+)\)/);
  if (corePool?.[1] || maxPool?.[1] || queue?.[1]) {
    details.push(`schedulerExecutor async pool core ${corePool?.[1] ?? '?'} / max ${maxPool?.[1] ?? '?'} / queue ${queue?.[1] ?? '?'}`);
  }
  return details;
}

async function collectScheduledJobs(projectRoot: string, jobFiles: string[]): Promise<ServiceSummary['scheduledJobs']> {
  const jobs = await Promise.all(
    jobFiles
      .filter((file) => !/SchedulingConfig\.java$/.test(file))
      .map(async (file) => summarizeScheduledJob(projectRoot, basename(file).replace(/\.java$/, ''), await readFile(file, 'utf8').catch(() => ''))),
  );
  return jobs.filter((item): item is ServiceSummary['scheduledJobs'][number] => Boolean(item));
}

async function summarizeScheduledJob(projectRoot: string, name: string, text: string): Promise<ServiceSummary['scheduledJobs'][number] | undefined> {
  if (!text) return undefined;
  if (name === 'PopularityRefreshJob') {
    const migration = await readFile(
      join(projectRoot, 'event-backend', 'app', 'src', 'main', 'resources', 'db', 'migration', 'V14__event_popularity_matview.sql'),
      'utf8',
    ).catch(() => '');
    return {
      name,
      schedule: 'every 10 minutes (`0 */10 * * * *`)',
      executionModel: 'runs asynchronously on `schedulerExecutor` and uses PostgreSQL advisory lock + concurrent materialized-view refresh',
      purpose: 'refresh the popularity ranking materialized view for upcoming public published events',
      effects: [
        summarizePopularityMaterializedView(migration),
        'recomputes weighted popularity from views, clicks, follows, yes RSVPs, maybe RSVPs over the last 30 days',
        'updates `events.popularity_mv` so feed/search ordering can use `popularity_score` and `computed_at`',
      ],
    };
  }
  if (name === 'EventAutoArchiveJob') {
    return {
      name,
      schedule: 'daily at 03:00 Europe/Budapest (`0 0 3 * * *`)',
      executionModel: 'scheduler trigger delegates to `EventAutoArchiveService.archiveExpiredEventsAsync()` on the async executor',
      purpose: 'archive published non-deleted events that have fallen out of the active time window',
      effects: [
        'archives events when `end_time` is present and already before `now()`',
        'archives events without `end_time` when `start_time` is older than `now() - 8 hours`',
        'updates only rows still in `published` state and not soft-deleted',
      ],
    };
  }
  return {
    name,
    schedule: inferScheduledCron(text),
    executionModel: /@Async/.test(text) ? 'scheduled + async background execution' : 'scheduled background execution',
    purpose: 'scheduled background processor',
    effects: [],
  };
}

function summarizePopularityMaterializedView(sql: string): string {
  if (!sql) return 'refreshes `events.popularity_mv`';
  const parts: string[] = [];
  if (/published'::events\.event_status/.test(sql) && /public'::events\.event_visibility/.test(sql)) parts.push('includes only upcoming, published, public events');
  if (/LN\(2\).*48\.0/.test(sql)) parts.push('uses exponential time decay with 48-hour half-life');
  if (/views/.test(sql) && /clicks/.test(sql) && /follows/.test(sql) && /rsvps_yes/.test(sql) && /rsvps_maybe/.test(sql)) {
    parts.push('weights daily views, clicks, follows, yes RSVPs, and maybe RSVPs');
  }
  if (/ranking_boost/.test(sql)) parts.push('adds ranking boost from the event row');
  return parts.join('; ') || 'refreshes `events.popularity_mv`';
}

function inferScheduledCron(text: string): string {
  const cron = text.match(/@Scheduled\s*\(\s*cron\s*=\s*"([^"]+)"/);
  return cron?.[1] ? `cron ${cron[1]}` : 'scheduled by cron';
}

async function collectAsyncListeners(listenerFiles: string[]): Promise<ServiceSummary['asyncListeners']> {
  return Promise.all(
    listenerFiles.map(async (file) => {
      const text = await readFile(file, 'utf8').catch(() => '');
      const name = basename(file).replace(/\.java$/, '');
      if (name === 'StatsEventListener') {
        return {
          name,
          purpose: 'asynchronously updates event and organizer statistics after service-layer domain events fire',
          triggers: [
            {
              event: 'ViewRecordedEvent',
              source: 'TrackingService.recordView() and TrackingService.recordBatch() after persisted frontend view interactions',
              effect: 'increments event daily views in `StatsRepository.incViews(...)` after transaction commit',
            },
            {
              event: 'ClickRecordedEvent',
              source: 'TrackingService.recordClick() and TrackingService.recordBatch() after persisted click interactions',
              effect: 'increments event daily clicks in `StatsRepository.incClicks(...)` after transaction commit',
            },
            {
              event: 'RsvpRecordedEvent',
              source: 'RsvpService.handleRsvp() after RSVP upsert for authenticated or guest users',
              effect: 'increments yes / maybe / no RSVP counters based on RSVP status',
            },
            {
              event: 'OrganizerProfileViewedEvent',
              source: 'OrganizerService.getOrganizerById() when organizer profile view should count as public',
              effect: 'increments organizer daily views in `OrganizerStatsRepository.incViews(...)`',
            },
          ],
        };
      }
      return {
        name,
        purpose: /@Async/.test(text) ? 'async event listener / background consumer' : 'event listener / background consumer',
        triggers: [],
      };
    }),
  );
}

async function collectServiceExceptionUsage(serviceRoot: string): Promise<Map<string, string[]>> {
  const exceptionNames = ['ConflictException', 'ForbiddenException', 'UnauthorizedException', 'MediaStorageException'];
  const usage = new Map<string, string[]>();
  for (const exceptionName of exceptionNames) {
    const output = await execLocal(`rg -l 'throw new ${exceptionName}\\b' "${serviceRoot}" -g '*.java'`);
    const owners = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((file) => basename(file).replace(/\.java$/, ''))
      .sort((left, right) => left.localeCompare(right));
    usage.set(exceptionName, owners);
  }
  return usage;
}

function inferServiceClientPurpose(name: string, text: string): string {
  if (/oauth/i.test(name) || /exchangeAndFetchUser/.test(text)) return 'outbound OAuth provider client implementation';
  return 'service-layer client / integration adapter';
}

function inferServiceDtoPurpose(name: string, text: string): string {
  if (/OrganizerDailyStats/.test(name)) return 'organizer daily statistics response shape';
  if (/OrganizerDailyItem/.test(name)) return 'single daily organizer statistics item';
  return text.includes('LocalDate') ? 'service-local projection DTO' : 'service-local transfer shape';
}

function inferServiceEventPurpose(name: string): string {
  if (/ViewRecordedEvent/.test(name)) return 'event view metric increment trigger';
  if (/ClickRecordedEvent/.test(name)) return 'event click metric increment trigger';
  if (/RsvpRecordedEvent/.test(name)) return 'RSVP metric update trigger';
  if (/OrganizerProfileViewedEvent/.test(name)) return 'organizer profile view metric trigger';
  if (/FollowChangedEvent/.test(name)) return 'follow/unfollow statistics trigger';
  return 'service-layer domain event';
}

function inferServiceExceptionPurpose(name: string): string {
  if (/Conflict/.test(name)) return 'signals conflicting state such as duplicate registration or invalid lifecycle transition';
  if (/Forbidden/.test(name)) return 'signals authenticated but disallowed access';
  if (/Unauthorized/.test(name)) return 'signals missing or invalid authentication credentials';
  if (/MediaStorage/.test(name)) return 'signals media/image storage processing failure';
  return 'runtime exception translated by controller advice';
}

function inferServiceInterfacePurpose(name: string, text: string): string {
  if (/MailService/.test(name) || /sendInvite|sendVerificationEmail|sendPasswordResetEmail/.test(text)) {
    return 'mail delivery contract for invite, verification, and password reset flows';
  }
  return 'service interface contract';
}

function hasMeaningfulInterfaceComment(text: string): boolean {
  return /\/\*\*[\s\S]{10,}\*\//.test(text) || /\/\/.{10,}/.test(text);
}

async function parsePersistenceRepository(file: string): Promise<PersistenceSummary['repositories'][number] | undefined> {
  const text = await readFile(file, 'utf8').catch(() => '');
  if (!text) return undefined;
  const name = basename(file).replace(/\.java$/, '');
  const style: 'jpa' | 'jdbc' = /extends\s+JpaRepository</.test(text) ? 'jpa' : 'jdbc';
  const operationGroups = inferRepositoryOperationGroups(text);
  const mapperNames = extractImportedTypeNames(text, /\.persistence\.mapper\./);
  const entityNames = unique([
    ...extractJpaEntityNames(text),
    ...extractImportedTypeNames(text, /\.persistence\.entity\./),
  ]).sort((left, right) => left.localeCompare(right));
  return {
    name,
    style,
    purpose: inferRepositoryPurpose(name),
    operationGroups,
    notableOperation: inferNotableRepositoryOperation(name, text),
    mapperNames,
    entityNames,
  };
}

async function collectPersistenceMapperSummary(mapperFiles: string[]): Promise<PersistenceSummary['mapperSummary']> {
  const entries = await Promise.all(
    mapperFiles.map(async (file) => ({
      name: basename(file).replace(/\.java$/, ''),
      text: await readFile(file, 'utf8').catch(() => ''),
    })),
  );

  const abstractBase = entries.find((entry) => entry.name === 'AbstractRowMapper');
  const rowMappers = entries
    .filter((entry) => entry.name !== 'AbstractRowMapper' && (/implements\s+RowMapper</.test(entry.text) || /RowMapper\b/.test(entry.name)))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const dtoMappers = entries
    .filter((entry) => entry.name !== 'AbstractRowMapper' && !rowMappers.includes(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const abstractBaseNotes: string[] = [];
  if (abstractBase?.text) {
    if (/getOdt\(/.test(abstractBase.text)) abstractBaseNotes.push('shared OffsetDateTime extraction helpers');
    if (/getString\(/.test(abstractBase.text)) abstractBaseNotes.push('blank-safe string extraction');
    if (/getUUID\(/.test(abstractBase.text)) abstractBaseNotes.push('UUID extraction helpers');
    if (/hasColumn\(/.test(abstractBase.text)) abstractBaseNotes.push('optional column / alias detection');
    if (/getNullableInt\(/.test(abstractBase.text)) abstractBaseNotes.push('nullable scalar readers');
  }

  const notes: string[] = [];
  if (dtoMappers.includes('EventMapper')) {
    notes.push('EventMapper converts persistence records such as EventRow and EventListItem into API-facing Event DTOs');
  }
  if (dtoMappers.includes('OrganizerMapper')) {
    notes.push('OrganizerMapper adapts persistence records and serialized social link payloads into organizer DTO shapes');
  }

  return {
    abstractBase: abstractBase?.name,
    abstractBaseNotes,
    rowMappers,
    dtoMappers,
    notes,
  };
}

function inferRepositoryOperationGroups(text: string): string[] {
  const methods = extractPublicMethodNames(text);
  const groups = new Set<string>();
  if (methods.some((name) => /^(find|get|load|list|search|suggest)/i.test(name))) groups.add('find / list / filter');
  if (methods.some((name) => /^(count|exists|is)/i.test(name))) groups.add('count / exists / permission checks');
  if (methods.some((name) => /^(create|insert|save|upsert|update|publish|archive|recalc|inc|refresh|replace|reserve|ensure)/i.test(name))) groups.add('create / update / upsert');
  if (methods.some((name) => /^(delete|remove|revoke|softDelete|unfollow)/i.test(name))) groups.add('delete / archive / revoke');
  if (methods.some((name) => /^(follow|unfollow)/i.test(name))) groups.add('follow / membership mutations');
  if (methods.some((name) => /batch/i.test(name))) groups.add('batch write / import');
  if (methods.some((name) => /stats|totals|popularity|views|clicks/i.test(name))) groups.add('stats / aggregation');
  return [...groups];
}

function inferRepositoryPurpose(name: string): string {
  const normalized = name.replace(/Repository$/, '');
  const words = normalized.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  if (/event collaborators/.test(words)) return 'manage event collaborator membership and organizer role assignments per event';
  if (/event invite writer/.test(words)) return 'batch-write event invitation rows while ignoring duplicates';
  if (/cohost invitation/.test(words)) return 'manage cohost invitation lifecycle and invitation state transitions';
  if (/feedback/.test(words)) return 'persist feedback submissions';
  if (/feed/.test(words)) return 'serve feed-facing event listing queries and popularity-driven read models';
  if (/search log/.test(words)) return 'persist search telemetry and filter usage for analytics';
  if (/search/.test(words)) return 'run filtered event search and text-query lookup flows';
  if (/stats read/.test(words)) return 'load aggregated daily and total statistics for events and organizers';
  if (/stats/.test(words)) return 'increment daily event statistics counters';
  if (/organizer stats/.test(words)) return 'increment daily organizer statistics counters';
  if (/me follows query/.test(words)) return 'read followed organizers, tags, and locations for the current user';
  if (/tag suggest/.test(words)) return 'suggest tags from canonical tags and synonym indexes';
  if (/tag/.test(words)) return 'resolve, create, search, and follow tags plus synonym mappings';
  if (/location/.test(words)) return 'search, upsert, follow, and maintain location records';
  if (/organizer/.test(words)) return 'manage organizer records, admins, membership, and follower counts';
  if (/event/.test(words)) return 'manage event records, media, tags, publication state, and event read models';
  if (/media/.test(words)) return 'manage event media rows and ordering';
  if (/rsvp/.test(words)) return 'upsert RSVP state and export RSVP-related read models';
  if (/tracking/.test(words)) return 'store event view and click tracking telemetry';
  if (/user onboarding/.test(words)) return 'persist onboarding progress per user';
  if (/user follow organizers/.test(words)) return 'manage organizer follow relationships';
  if (/user/.test(words)) return 'persist core user aggregates and identity lookups';
  if (/refresh token/.test(words)) return 'persist and revoke refresh tokens';
  if (/password reset token/.test(words)) return 'persist password reset tokens';
  if (/email verification token/.test(words)) return 'persist email verification tokens';
  if (/popularity/.test(words)) return 'refresh popularity materialized views under advisory locking';
  return `handle ${words} persistence operations`;
}

function inferNotableRepositoryOperation(name: string, text: string): string | undefined {
  if (name === 'EventCollaboratorsRepository' && /ON CONFLICT \(event_id, organizer_id\)/.test(text)) {
    return 'upserts collaborator role by (event_id, organizer_id) and deletes collaborator membership when removed';
  }
  if (name === 'CohostInvitationRepository' && /ON CONFLICT \(event_id, invited_organizer_id\)/.test(text)) {
    return 'upserts invitation state for the invited organizer on the same event and allows status transitions';
  }
  if (name === 'RsvpRepository' && /uq_rsvp_user/.test(text) && /uq_rsvp_email/.test(text)) {
    return 'upserts RSVP by either authenticated user or invited email identity';
  }
  if (name === 'LocationRepository' && /upsertLocation/.test(text)) {
    return 'upserts locations by alias or city/address match before inserting new location rows';
  }
  if (name === 'EventRepository' && /replaceEventTagsByNames/.test(text)) {
    return 'replaces event tag bindings and manages publication/archive/update state with SQL-heavy read models';
  }
  return undefined;
}

function extractPublicMethodNames(text: string): string[] {
  const names = new Set<string>();
  const regex = /public\s+(?:static\s+)?[^\(\n;=]+?\s+([A-Za-z_]\w*)\s*\(/g;
  for (const match of text.matchAll(regex)) {
    const name = match[1];
    if (name && name !== 'class' && name !== 'interface') names.add(name);
  }
  return [...names];
}

function extractImportedTypeNames(text: string, pattern: RegExp): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/import\s+([\w.]+);/g)) {
    const imported = match[1];
    if (!pattern.test(imported)) continue;
    names.add(imported.split('.').pop() ?? imported);
  }
  return [...names];
}

function extractJpaEntityNames(text: string): string[] {
  const generic = text.match(/extends\s+JpaRepository<\s*([\w.]+)\s*,/);
  if (!generic?.[1]) return [];
  const name = generic[1].split('.').pop();
  return name ? [name] : [];
}

async function execLocal(cmd: string): Promise<string> {
  const { exec } = await import('node:child_process');
  return await new Promise((resolve) => {
    exec(cmd, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? '' : stdout);
    });
  });
}

function filterPersistenceTargets(items: string[]): string[] {
  return items.filter((item) => !/^table\s+entitys?$/i.test(item));
}

function buildSchemaLines(analysis: SourceProjectAnalysis, codeGraph?: CodeKnowledgeGraph): string {
  const lines: string[] = [];
  if (codeGraph?.summary.schemaTables?.length) {
    for (const table of codeGraph.summary.schemaTables.slice(0, 24)) {
      const columns = table.columns.length ? `columns: ${table.columns.join(', ')}` : '';
      const primaryKey = table.primaryKey?.length ? `pk: ${table.primaryKey.join(', ')}` : '';
      const parts = [primaryKey, columns].filter(Boolean).join(' | ');
      lines.push(`- table ${table.name}${parts ? ` | ${parts}` : ''}`);
    }
  } else {
    for (const sqlFile of analysis.sqlCatalog.slice(0, 20)) {
      for (const table of sqlFile.tables) {
        const columns = table.columns.length
          ? `columns: ${table.columns.map((column) => `${column.name}${column.type ? `:${column.type}` : ''}${column.detail ? `(${column.detail})` : ''}`).join(', ')}`
          : '';
        const primaryKey = table.primaryKey?.length ? `pk: ${table.primaryKey.join(', ')}` : '';
        const foreignKeys = table.foreignKeys.length
          ? `relationships: ${table.foreignKeys.map((fk) => `${table.name}.${fk.column} -> ${fk.targetTable ?? '?'}.${fk.targetColumn ?? '?'}`).join('; ')}`
          : '';
        const parts = [primaryKey, columns, foreignKeys].filter(Boolean).join(' | ');
        lines.push(`- table ${table.name}${parts ? ` | ${parts}` : ''} | source: ${relativePath(sqlFile.file, analysis.projectRoot)}`);
      }
    }
    for (const hint of analysis.schemaHints.slice(0, 20)) {
      const tableName = hint.tableName ?? hint.typeName ?? pathBase(hint.file);
      const columns = hint.fields?.length
        ? `fields: ${hint.fields.map((field) => `${field.name}${field.type ? `:${field.type}` : ''}${field.relation ? ` -> ${field.relation}` : ''}`).join(', ')}`
        : hint.columns.length
          ? `columns: ${hint.columns.join(', ')}`
          : '';
      const primaryKey = hint.primaryKey?.length ? `pk: ${hint.primaryKey.join(', ')}` : '';
      const relationships = hint.relationships.length ? `relationships: ${hint.relationships.join('; ')}` : '';
      const parts = [columns, primaryKey, relationships].filter(Boolean).join(' | ');
      lines.push(`- table ${tableName}${parts ? ` | ${parts}` : ''} | source: ${relativePath(hint.file, analysis.projectRoot)}`);
    }
  }
  if (analysis.counts.sqlFiles > 0) {
    lines.push(`- sql files detected: ${analysis.resourceFiles.sql.length}`);
  }
  return lines.length ? lines.join('\n') : '- database schema still needs to be inferred from the source';
}

function renderDatabaseSchemaMarkdown(schema: DatabaseSchema): string {
  return `# ${schema.title ?? 'database schema'}\n\n` +
    `## summary\n` +
    `${schema.summary ?? 'No summary available.'}\n\n` +
    `## source\n` +
    `- ${schema.source}\n` +
    `- confidence: ${schema.confidence ?? 'low'}\n\n` +
    `## tables\n` +
    (schema.tables.length
      ? schema.tables.map((table) => [
          `- ${table.name}${table.primaryKey?.length ? ` (pk: ${table.primaryKey.join(', ')})` : ''}`,
          ...(table.columns.length
            ? table.columns.map((column: { name: string; type?: string; detail?: string; nullable?: boolean }) => `  - ${column.name}${column.type ? `: ${column.type}` : ''}${column.detail ? ` — ${column.detail}` : ''}`)
            : ['  - no columns inferred']),
        ].join('\n')).join('\n')
      : '- none') + '\n\n' +
    `## relationships\n` +
    ((schema.relationships?.length ?? 0) > 0
      ? schema.relationships!.map((relationship: { fromTable: string; fromColumn: string; toTable: string; toColumn: string; cardinality: '1:1' | '1:N' | 'N:1' | 'N:M'; description?: string }) => `- ${relationship.fromTable}.${relationship.fromColumn} -> ${relationship.toTable}.${relationship.toColumn} (${relationship.cardinality})${relationship.description ? ` — ${relationship.description}` : ''}`).join('\n')
      : '- none') + '\n';
}

function buildAstIndexArtifact(analysis: SourceProjectAnalysis): AstIndexArtifact {
  const astFiles = analysis.javaAstCatalog ?? [];
  const packageBuckets = new Map<string, { fileCount: number; typeCount: number; imports: string[] }>();
  const annotationBuckets = new Map<string, { occurrences: number; typeNames: Set<string> }>();
  const packageToTypes = new Map<string, string[]>();
  const typeToFile: Record<string, string> = {};
  const typeToMethods: Record<string, string[]> = {};
  const types: AstIndexArtifact['types'] = [];
  let methodCount = 0;
  let fieldCount = 0;

  for (const astFile of astFiles) {
    const packageName = astFile.packageName ?? '(default)';
    const packageBucket = packageBuckets.get(packageName) ?? { fileCount: 0, typeCount: 0, imports: [] };
    packageBucket.fileCount += 1;
    packageBucket.typeCount += astFile.types.length;
    packageBucket.imports.push(...astFile.imports);
    packageBuckets.set(packageName, packageBucket);

    for (const type of astFile.types) {
      packageToTypes.set(packageName, [...(packageToTypes.get(packageName) ?? []), type.name]);
      typeToFile[`${packageName}.${type.name}`] = relativePath(astFile.file, analysis.projectRoot);
      typeToMethods[`${packageName}.${type.name}`] = type.methods.map((method) => method.name);
      methodCount += type.methods.length;
      fieldCount += type.fields.length;
      const combinedAnnotations = unique([
        ...type.annotations,
        ...type.fields.flatMap((field) => field.annotations),
        ...type.methods.flatMap((method) => method.annotations),
      ]);
      for (const annotation of combinedAnnotations) {
        const bucket = annotationBuckets.get(annotation) ?? { occurrences: 0, typeNames: new Set<string>() };
        bucket.occurrences += 1;
        bucket.typeNames.add(type.name);
        annotationBuckets.set(annotation, bucket);
      }
      types.push({
        id: `${packageName}.${type.name}`,
        name: type.name,
        kind: type.kind,
        packageName: astFile.packageName,
        file: relativePath(astFile.file, analysis.projectRoot),
        applicationHint: inferApplicationFromFile(astFile.file, analysis),
        layerHint: inferLayerFromPackageOrFile(astFile.packageName, astFile.file),
        annotations: type.annotations,
        imports: astFile.imports,
        fields: type.fields.map((field) => `${field.name}:${field.type}`),
        methods: type.methods.map((method) => ({
          name: method.name,
          returnType: method.returnType,
          annotations: method.annotations,
          parameters: method.parameters,
        })),
      });
    }
  }

  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    summary: {
      javaFileCount: astFiles.length,
      packageCount: packageBuckets.size,
      typeCount: types.length,
      methodCount,
      fieldCount,
      endpointCount: analysis.endpointCatalog.length,
      annotationCount: annotationBuckets.size,
    },
    packages: [...packageBuckets.entries()]
      .map(([packageName, bucket]) => ({
        packageName,
        fileCount: bucket.fileCount,
        typeCount: bucket.typeCount,
        topImports: unique(bucket.imports).sort((left, right) => left.localeCompare(right)).slice(0, 12),
      }))
      .sort((left, right) => left.packageName.localeCompare(right.packageName)),
    types: types.sort((left, right) => left.id.localeCompare(right.id)),
    endpoints: analysis.endpointCatalog.map((endpoint) => ({
      id: `${endpoint.method} ${endpoint.path}`,
      method: endpoint.method,
      path: endpoint.path,
      typeName: endpoint.typeName,
      file: relativePath(endpoint.file, analysis.projectRoot),
    })),
    annotations: [...annotationBuckets.entries()]
      .map(([name, bucket]) => ({
        name,
        occurrences: bucket.occurrences,
        typeNames: [...bucket.typeNames].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => right.occurrences - left.occurrences || left.name.localeCompare(right.name)),
    lookups: {
      packageToTypes: Object.fromEntries([...packageToTypes.entries()].map(([packageName, typeNames]) => [packageName, unique(typeNames).sort((left, right) => left.localeCompare(right))])),
      typeToFile,
      typeToMethods,
      annotationToTypes: Object.fromEntries([...annotationBuckets.entries()].map(([name, bucket]) => [name, [...bucket.typeNames].sort((left, right) => left.localeCompare(right))])),
    },
  };
}

function buildJqassistantSupportArtifact(
  analysis: SourceProjectAnalysis,
  jqassistant: JqassistantArtifact,
): JqassistantSupportArtifact {
  const applications = analysis.applicationLayouts.map((application) => ({
    name: basename(application.appRoot),
    role: application.role,
    multiModule: application.multiModule,
    moduleRoots: application.moduleRoots,
    internalModules: application.internalModules.map((module) => ({
      name: module.name,
      purpose: module.purpose,
      source: module.source,
      pathHints: module.pathHints,
    })),
  }));

  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    status: jqassistant.status,
    summary: jqassistant.summary,
    applications,
    runtimeLayers: analysis.repositoryStructure.backendRuntimeLayers,
    supportModules: analysis.repositoryStructure.backendSupportModules,
    graphs: jqassistant.graphs,
    warnings: jqassistant.warnings,
    error: jqassistant.error,
  };
}

function buildSupportGraphArtifact(
  analysis: SourceProjectAnalysis,
  codeGraph: CodeKnowledgeGraph,
): SupportGraphArtifact {
  const nodes: SupportGraphArtifact['nodes'] = [];
  const edges: SupportGraphArtifact['edges'] = [];
  const projectId = `project:${slug(analysis.projectName)}`;
  nodes.push({
    id: projectId,
    type: 'project',
    name: analysis.projectName,
    items: analysis.repositoryStructure.topLevelProjects.map((item) => `${item.name} (${item.role})`),
  });

  for (const layout of analysis.applicationLayouts) {
    const applicationId = `application:${slug(layout.appRoot)}`;
    const applicationName = basename(layout.appRoot);
    nodes.push({
      id: applicationId,
      type: 'application',
      name: applicationName,
      applicationId,
      description: layout.role,
      items: layout.moduleRoots.length ? layout.moduleRoots : layout.internalModules.map((module) => module.name),
    });
    edges.push({ from: projectId, to: applicationId, type: 'contains' });

    const layerGroups = buildApplicationLayerGroups(analysis, applicationName);
    for (const [layerKey, items] of Object.entries(layerGroups)) {
      if (!items.length) continue;
      const layerId = `${applicationId}:layer:${slug(layerKey)}`;
      nodes.push({
        id: layerId,
        type: 'layer',
        name: layerKey,
        applicationId,
        items: items.slice(0, 20),
      });
      edges.push({ from: applicationId, to: layerId, type: 'contains' });
    }

    const jqassistantModules = (analysis.jqassistant?.graphs?.projectGraph.modules ?? [])
      .filter((module) => module.parentArtifactId === applicationName || module.parentArtifactId === layout.appRoot || module.parentArtifactId.endsWith(applicationName))
      .map((module) => module.moduleName);
    if (jqassistantModules.length) {
      const moduleNodeId = `${applicationId}:jqassistant-modules`;
      nodes.push({
        id: moduleNodeId,
        type: 'module-group',
        name: 'jqassistant modules',
        applicationId,
        items: unique(jqassistantModules),
      });
      edges.push({ from: applicationId, to: moduleNodeId, type: 'contains' });
    }

    const packageHints = summarizePackagesForApplication(analysis, applicationName);
    if (packageHints.length) {
      const packageNodeId = `${applicationId}:packages`;
      nodes.push({
        id: packageNodeId,
        type: 'package-group',
        name: 'package slices',
        applicationId,
        items: packageHints.slice(0, 20),
      });
      edges.push({ from: applicationId, to: packageNodeId, type: 'contains' });
    }
  }

  const externalSystems = unique(codeGraph.summary.externalSystems);
  for (const system of externalSystems) {
    const nodeId = `external:${slug(system)}`;
    nodes.push({
      id: nodeId,
      type: 'external-system',
      name: system,
      items: [],
    });
    edges.push({ from: projectId, to: nodeId, type: 'communicates-with' });
  }

  const flowGroups = groupSemanticFlowsByApplication(analysis);
  for (const [applicationName, flows] of flowGroups) {
    const applicationId = `application:${slug(findApplicationRootByName(analysis, applicationName) ?? applicationName)}`;
    const flowId = `${applicationId}:flows`;
    nodes.push({
      id: flowId,
      type: 'flow-group',
      name: `${applicationName} flows`,
      applicationId,
      items: flows.slice(0, 20),
    });
    edges.push({ from: applicationId, to: flowId, type: 'contains' });
  }

  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    nodes,
    edges,
  };
}

function buildGraphVerificationArtifact(
  analysis: SourceProjectAnalysis,
  codeGraph: CodeKnowledgeGraph,
): GraphVerificationArtifact {
  const checks: GraphVerificationArtifact['checks'] = [];
  const graphNodeNames = new Set(codeGraph.nodes.map((node) => node.name));
  const graphNodeRefs = new Set(codeGraph.nodes.map((node) => node.sourceRef).filter((value): value is string => Boolean(value)));

  if (analysis.applicationLayouts.length > 0) {
    checks.push({
      id: 'applications-detected',
      status: 'ok',
      category: 'applications',
      message: `Detected ${analysis.applicationLayouts.length} application boundaries`,
      evidence: analysis.applicationLayouts.map((layout) => layout.appRoot),
    });
  } else {
    checks.push({
      id: 'applications-missing',
      status: 'warning',
      category: 'applications',
      message: 'No application layouts were detected',
      evidence: analysis.repositoryStructure.topLevelProjects.map((project) => `${project.name}:${project.role}`),
    });
  }

  const missingEndpoints = analysis.endpointCatalog.filter((endpoint) => !graphNodeNames.has(`${endpoint.method} ${endpoint.path}`));
  checks.push({
    id: 'endpoint-coverage',
    status: missingEndpoints.length ? 'warning' : 'ok',
    category: 'endpoints',
    message: missingEndpoints.length
      ? `${missingEndpoints.length} endpoints are missing from the deterministic code graph`
      : 'All detected endpoints are represented in the deterministic code graph',
    evidence: (missingEndpoints.length ? missingEndpoints : analysis.endpointCatalog)
      .slice(0, 20)
      .map((endpoint) => `${endpoint.method} ${endpoint.path}`),
  });

  const missingRepositories = analysis.persistenceSummary.repositories.filter((repository) => !graphNodeNames.has(repository.name));
  checks.push({
    id: 'persistence-coverage',
    status: missingRepositories.length ? 'warning' : 'ok',
    category: 'persistence',
    message: missingRepositories.length
      ? `${missingRepositories.length} repositories are missing from the deterministic code graph`
      : 'All repository summaries are represented in the deterministic code graph',
    evidence: (missingRepositories.length ? missingRepositories : analysis.persistenceSummary.repositories)
      .slice(0, 20)
      .map((repository) => repository.name),
  });

  const missingServiceRefs = analysis.serviceSummary.executionServices
    .filter((service) => !graphNodeNames.has(service.name))
    .map((service) => service.name);
  checks.push({
    id: 'service-coverage',
    status: missingServiceRefs.length ? 'warning' : 'ok',
    category: 'layers',
    message: missingServiceRefs.length
      ? `${missingServiceRefs.length} execution services are missing from the deterministic code graph`
      : 'Execution services are represented in the deterministic code graph',
    evidence: (missingServiceRefs.length ? missingServiceRefs : analysis.serviceSummary.executionServices.map((service) => service.name)).slice(0, 20),
  });

  const unresolvedFlowTargets = analysis.flowSummary.triggers
    .filter((trigger) => !graphNodeNames.has(trigger.target))
    .map((trigger) => `${trigger.kind}:${trigger.source} -> ${trigger.target}`);
  checks.push({
    id: 'flow-target-resolution',
    status: unresolvedFlowTargets.length ? 'warning' : 'ok',
    category: 'flows',
    message: unresolvedFlowTargets.length
      ? `${unresolvedFlowTargets.length} flow trigger targets were not found as graph nodes`
      : 'Flow trigger targets resolve to deterministic graph nodes',
    evidence: (unresolvedFlowTargets.length ? unresolvedFlowTargets : analysis.flowSummary.triggers.map((trigger) => `${trigger.kind}:${trigger.source} -> ${trigger.target}`)).slice(0, 20),
  });

  const externalSystems = unique(collectExternalDependenciesForVerification(analysis));
  const missingExternalRefs = externalSystems.filter((system) => !graphNodeNames.has(system));
  checks.push({
    id: 'external-system-coverage',
    status: missingExternalRefs.length ? 'warning' : 'ok',
    category: 'externals',
    message: missingExternalRefs.length
      ? `${missingExternalRefs.length} inferred external systems are missing from the deterministic code graph`
      : 'External systems inferred from analysis are represented in the deterministic code graph',
    evidence: (missingExternalRefs.length ? missingExternalRefs : externalSystems).slice(0, 20),
  });

  const astRefsMissingFromGraph = analysis.javaAstCatalog
    .slice(0, 50)
    .map((astFile) => `file://${relativePath(astFile.file, analysis.projectRoot)}`)
    .filter((sourceRef) => !graphNodeRefs.has(sourceRef));
  checks.push({
    id: 'ast-file-reference-sampling',
    status: astRefsMissingFromGraph.length > 10 ? 'warning' : 'ok',
    category: 'layers',
    message: astRefsMissingFromGraph.length
      ? `Sampled AST files show ${astRefsMissingFromGraph.length} source references not directly represented as graph nodes`
      : 'Sampled AST file references are represented in the deterministic code graph',
    evidence: astRefsMissingFromGraph.slice(0, 20),
  });

  const jqassistantPackages = analysis.jqassistant?.graphs?.packageGraph.packages ?? [];
  checks.push({
    id: 'jqassistant-package-capture',
    status: jqassistantPackages.length ? 'ok' : 'warning',
    category: 'applications',
    message: jqassistantPackages.length
      ? `jQAssistant captured ${jqassistantPackages.length} Java packages for deterministic reuse`
      : 'jQAssistant did not provide reusable package graph data',
    evidence: jqassistantPackages.slice(0, 20),
  });

  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    summary: {
      applicationCount: analysis.applicationLayouts.length,
      endpointCount: analysis.endpointCatalog.length,
      graphNodeCount: codeGraph.nodes.length,
      graphEdgeCount: codeGraph.edges.length,
      issueCount: checks.filter((check) => check.status !== 'ok').length,
    },
    checks,
  };
}

function buildGraphVerificationSlicesArtifact(
  analysis: SourceProjectAnalysis,
  verification: GraphVerificationArtifact,
): GraphVerificationSlicesArtifact {
  const categories: Array<GraphVerificationSlicesArtifact['slices'][number]['category']> = [
    'api-routes',
    'scheduler-flows',
    'listener-flows',
    'persistence-heavy',
  ];
  const categoryChecks = new Map(categories.map((category) => [category, [] as GraphVerificationArtifact['checks']]));
  for (const check of verification.checks) {
    if (check.category === 'endpoints' || check.category === 'applications') {
      categoryChecks.get('api-routes')?.push(check);
    }
    if (check.category === 'flows') {
      categoryChecks.get('scheduler-flows')?.push(check);
      categoryChecks.get('listener-flows')?.push(check);
    }
    if (check.category === 'persistence') {
      categoryChecks.get('persistence-heavy')?.push(check);
    }
  }
  if (analysis.serviceSummary.scheduledJobs.length) {
    categoryChecks.get('scheduler-flows')?.push({
      id: 'scheduled-job-presence',
      status: 'ok',
      category: 'flows',
      message: `${analysis.serviceSummary.scheduledJobs.length} scheduled jobs detected for verification slicing`,
      evidence: analysis.serviceSummary.scheduledJobs.map((job) => `${job.name}: ${job.schedule}`),
    });
  }
  if (analysis.serviceSummary.asyncListeners.length) {
    categoryChecks.get('listener-flows')?.push({
      id: 'listener-presence',
      status: 'ok',
      category: 'flows',
      message: `${analysis.serviceSummary.asyncListeners.length} async listeners detected for verification slicing`,
      evidence: analysis.serviceSummary.asyncListeners.map((listener) => listener.name),
    });
  }
  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    slices: categories.map((category) => ({
      id: category,
      label: category.replace(/-/g, ' '),
      category,
      issueCount: (categoryChecks.get(category) ?? []).filter((check) => check.status !== 'ok').length,
      checks: categoryChecks.get(category) ?? [],
    })),
  };
}

function buildAiGraphArtifact(
  analysis: SourceProjectAnalysis,
  astIndex: AstIndexArtifact,
  jqassistantSupport: JqassistantSupportArtifact,
  supportGraph: SupportGraphArtifact,
  verification: GraphVerificationArtifact,
  flowMap: Record<string, unknown>,
  enrichment: EnrichmentOutput,
): AiGraphArtifact {
  const nodes: AiGraphArtifact['nodes'] = [];
  for (const application of analysis.applicationLayouts) {
    nodes.push({
      id: `module-summary:${application.appRoot}`,
      applicationId: application.appRoot,
      kind: 'module-summary',
      title: `${application.appRoot} application`,
      summary: `${application.role}; modules: ${(application.moduleRoots.length ? application.moduleRoots : application.internalModules.map((module) => module.name)).slice(0, 8).join(', ') || 'none'}`,
      evidence: [application.appRoot],
    });
  }
  for (const layerNode of supportGraph.nodes.filter((node) => node.type === 'layer')) {
    nodes.push({
      id: `layer-summary:${layerNode.applicationId ?? 'app'}:${layerNode.name}`,
      applicationId: layerNode.applicationId,
      layer: layerNode.name,
      kind: 'layer-summary',
      title: `${layerNode.name} layer`,
      summary: layerNode.items.slice(0, 8).join('; ') || 'no summarized items',
      evidence: layerNode.items.slice(0, 8),
    });
  }
  for (const type of astIndex.types.slice(0, 120)) {
    nodes.push({
      id: `class-summary:${type.id}`,
      applicationId: type.applicationHint,
      layer: type.layerHint,
      kind: 'class-summary',
      title: type.name,
      summary: `${type.kind}${type.layerHint ? ` in ${type.layerHint}` : ''}; methods: ${type.methods.slice(0, 5).map((method) => method.name).join(', ') || 'none'}`,
      evidence: [type.file, ...(type.annotations.slice(0, 4))],
    });
  }
  const flows = (flowMap.flows as Array<Record<string, unknown>> | undefined) ?? [];
  for (const flow of flows.slice(0, 48)) {
    nodes.push({
      id: `flow-note:${slug(String(flow.name ?? 'flow'))}`,
      applicationId: inferApplicationFromText(String(flow.name ?? ''), analysis),
      kind: 'flow-note',
      title: String(flow.name ?? 'flow'),
      summary: String(flow.summary ?? ''),
      evidence: ((flow.steps as string[] | undefined) ?? []).slice(0, 8),
    });
  }
  for (const check of verification.checks.filter((item) => item.status !== 'ok').slice(0, 40)) {
    nodes.push({
      id: `validation-note:${check.id}`,
      kind: 'validation-note',
      title: check.id,
      summary: check.message,
      evidence: check.evidence.slice(0, 6),
    });
  }
  for (const task of enrichment.tasks.slice(0, 20)) {
    for (const candidate of task.candidates.slice(0, 6)) {
      nodes.push({
        id: `enrichment:${task.task}:${candidate.targetId}`,
        kind: 'class-summary',
        title: candidate.title ?? `${task.task}:${candidate.targetId}`,
        summary: candidate.summary,
        evidence: candidate.evidence.map((item) => `${item.kind}:${item.ref}`),
      });
    }
  }
  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    sourcePriority: ['support-graph', 'jqassistant-graph', 'ast-index', 'verification', 'enrichment'],
    nodes: uniqueBy(nodes, (node) => node.id),
  };
}

function buildLayerGraphsArtifact(supportGraph: SupportGraphArtifact): LayerGraphsArtifact {
  const groups = new Map<string, Map<string, string[]>>();
  for (const node of supportGraph.nodes.filter((item) => item.type === 'layer')) {
    const layer = node.name;
    const applicationId = node.applicationId ?? 'application';
    const layerBucket = groups.get(layer) ?? new Map<string, string[]>();
    layerBucket.set(applicationId, mergeCardItems(layerBucket.get(applicationId), node.items));
    groups.set(layer, layerBucket);
  }
  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    projectName: supportGraph.projectName,
    projectRoot: supportGraph.projectRoot,
    layers: [...groups.entries()].map(([layer, applications]) => ({
      layer,
      applications: [...applications.entries()].map(([applicationId, items]) => ({
        applicationId,
        items,
      })),
    })),
  };
}

function buildApplicationLayerGroups(
  analysis: SourceProjectAnalysis,
  applicationName: string,
): Record<string, string[]> {
  const backendLike = /backend/i.test(applicationName);
  const notificationLike = /notification/i.test(applicationName);
  return {
    api: filterApplicationScopedItems(analysis.apiSurface.families.map((family) => `${family.family} (${family.endpointCount} endpoints)`), applicationName),
    app: filterApplicationScopedItems([
      ...(analysis.appRuntime.applicationEntryPoint ? [analysis.appRuntime.applicationEntryPoint] : []),
      ...analysis.appRuntime.runtimeFeatures,
    ], applicationName),
    common: backendLike
      ? [
          ...analysis.commonSummary.crossCuttingComponents.map((item) => `${item.name} — ${item.role}`),
          ...analysis.commonSummary.eventTypes.map((item) => `${item.name} — ${item.purpose}`),
        ]
      : [],
    persistence: filterApplicationScopedItems([
      ...analysis.persistenceSummary.repositories.map((item) => `${item.name} — ${item.purpose}`),
      ...analysis.persistenceSummary.entityNames,
    ], applicationName),
    service: filterApplicationScopedItems([
      ...analysis.serviceSummary.executionServices.map((item) => `${item.name} — ${item.purpose}`),
      ...analysis.serviceSummary.clientImplementations.map((item) => `${item.name} — ${item.purpose}`),
      ...analysis.serviceSummary.scheduledJobs.map((item) => `${item.name} — ${item.purpose}`),
      ...analysis.serviceSummary.asyncListeners.map((item) => `${item.name} — ${item.purpose}`),
    ], applicationName),
    web: filterApplicationScopedItems([
      ...collectValidationBoundaryNames(analysis),
      ...collectExceptionHandlerNames(analysis),
      ...collectWebConfigurationNames(analysis),
    ], applicationName),
    security: filterApplicationScopedItems([
      ...analysis.commonSummary.securityComponents,
      ...analysis.commonSummary.securityDetails,
      ...analysis.appRuntime.securityConfigurations,
    ], applicationName),
    notification: notificationLike
      ? filterApplicationScopedItems([
          ...analysis.serviceSummary.asyncListeners.map((item) => `${item.name} — ${item.purpose}`),
          ...analysis.appRuntime.externalDependencies,
        ], applicationName)
      : [],
  };
}

function filterApplicationScopedItems(items: string[], applicationName: string): string[] {
  const normalizedApplication = applicationName.toLowerCase();
  const filtered = items.filter((item) => {
    const text = item.toLowerCase();
    if (normalizedApplication.includes('notification')) {
      return text.includes('notification') || text.includes('redis') || text.includes('ws') || text.includes('websocket');
    }
    if (normalizedApplication.includes('backend')) {
      return !text.includes('notification');
    }
    return true;
  });
  return unique(filtered);
}

function collectExternalDependenciesForVerification(analysis: SourceProjectAnalysis): string[] {
  return unique([
    ...analysis.appRuntime.externalDependencies,
    ...analysis.serviceSummary.mailCapabilities.config,
    ...analysis.serviceSummary.storageCapabilities.summary,
    ...(analysis.commonSummary.eventFlow ? [analysis.commonSummary.eventFlow.transport] : []),
  ]);
}

function buildTypeDependencyIndex(
  jqassistantSupport: JqassistantSupportArtifact,
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const dependency of jqassistantSupport.graphs?.typeGraph.dependencies ?? []) {
    const fromSimple = simpleNameOfType(dependency.fromType);
    const toSimple = simpleNameOfType(dependency.toType);
    const bucket = index.get(fromSimple) ?? new Set<string>();
    bucket.add(toSimple);
    index.set(fromSimple, bucket);
  }
  return index;
}

function buildSupportLayerIndex(
  supportGraph: SupportGraphArtifact,
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const node of supportGraph.nodes.filter((item) => item.type === 'layer')) {
    index.set(`${node.applicationId ?? 'application'}:${node.name}`, node.items);
  }
  return index;
}

function inferRepositoryCandidatesFromService(
  serviceName: string,
  operationName: string,
  analysis: SourceProjectAnalysis,
  astIndex: AstIndexArtifact,
  typeDependencyIndex: Map<string, Set<string>>,
  supportLayerIndex: Map<string, string[]>,
): string[] {
  const repositories = analysis.persistenceSummary.repositories.map((item) => item.name);
  const directDeps = [...(typeDependencyIndex.get(serviceName) ?? new Set<string>())];
  const byDependency = repositories.filter((repository) => directDeps.some((dependency) => repository.includes(dependency) || dependency.includes(repository.replace(/Repository$/, ''))));
  if (byDependency.length) return unique(byDependency);

  const serviceType = astIndex.types.find((type) => type.name === serviceName);
  const app = serviceType?.applicationHint ?? 'event-backend';
  const supportItems = supportLayerIndex.get(`${app}:persistence`) ?? [];
  const bySupport = repositories.filter((repository) => supportItems.some((item) => item.includes(repository)));
  if (bySupport.length) return unique(bySupport);

  const words = `${serviceName} ${operationName}`.toLowerCase();
  return repositories.filter((repository) => {
    const normalizedRepository = repository.toLowerCase();
    return words.includes(normalizedRepository.replace(/repository$/, ''))
      || normalizedRepository.replace(/repository$/, '').split(/(?=[A-Z])|_/).some((part) => part && words.includes(part.toLowerCase()));
  });
}

function simpleNameOfType(fqn: string): string {
  const index = fqn.lastIndexOf('.');
  return index >= 0 ? fqn.slice(index + 1) : fqn;
}

function summarizePackagesForApplication(
  analysis: SourceProjectAnalysis,
  applicationName: string,
): string[] {
  const allPackages = analysis.jqassistant?.graphs?.packageGraph.packages
    ?? analysis.javaAstCatalog.map((astFile) => astFile.packageName).filter((value): value is string => Boolean(value));
  const normalizedApplication = applicationName.toLowerCase();
  const filtered = allPackages.filter((packageName) => {
    const normalized = packageName.toLowerCase();
    if (normalizedApplication.includes('notification')) {
      return normalized.includes('notification');
    }
    if (normalizedApplication.includes('backend')) {
      return !normalized.includes('notification');
    }
    return true;
  });
  return unique(filtered.map((packageName) => packageName.split('.').slice(0, 4).join('.'))).sort((left, right) => left.localeCompare(right));
}

function groupSemanticFlowsByApplication(analysis: SourceProjectAnalysis): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const flow of analysis.flowSummary.flows) {
    const applicationName = inferApplicationFromText(flow.summary, analysis) ?? inferApplicationFromText(flow.name, analysis) ?? 'application';
    const bucket = groups.get(applicationName) ?? [];
    bucket.push(`${flow.trigger} -> ${flow.name}`);
    groups.set(applicationName, bucket);
  }
  return groups;
}

function inferApplicationFromText(text: string | undefined, analysis: SourceProjectAnalysis): string | undefined {
  if (!text) return undefined;
  const normalized = text.toLowerCase();
  for (const layout of analysis.applicationLayouts) {
    const name = basename(layout.appRoot);
    if (normalized.includes(name.toLowerCase())) return name;
  }
  if (normalized.includes('notification')) return 'event-notification';
  if (normalized.includes('backend')) return 'event-backend';
  return undefined;
}

function findApplicationRootByName(analysis: SourceProjectAnalysis, applicationName: string): string | undefined {
  return analysis.applicationLayouts.find((layout) => basename(layout.appRoot) === applicationName)?.appRoot;
}

function inferApplicationFromFile(file: string, analysis: SourceProjectAnalysis): string | undefined {
  const normalizedFile = file.toLowerCase();
  for (const layout of analysis.applicationLayouts) {
    if (normalizedFile.includes(layout.appRoot.toLowerCase())) {
      return basename(layout.appRoot);
    }
  }
  if (normalizedFile.includes('event-notification')) return 'event-notification';
  if (normalizedFile.includes('event-backend')) return 'event-backend';
  return undefined;
}

function inferLayerFromPackageOrFile(packageName?: string, file?: string): string | undefined {
  const text = `${packageName ?? ''} ${file ?? ''}`.toLowerCase();
  const layers = ['api', 'web', 'service', 'persistence', 'repository', 'common', 'security', 'app', 'config', 'listener', 'job', 'scheduler', 'domain', 'dto', 'controller', 'ws', 'redis'];
  return layers.find((layer) => text.includes(layer));
}

function collectValidationBoundaryNames(analysis: SourceProjectAnalysis): string[] {
  const result: string[] = [];
  for (const astFile of analysis.javaAstCatalog ?? []) {
    for (const type of astFile.types) {
      const typeText = `${type.name} ${astFile.packageName ?? ''} ${astFile.file}`.toLowerCase();
      const hasValidatedType = type.annotations.some((annotation) => /Validated|Valid/i.test(annotation));
      const hasMethodValidation = type.methods.some((method) => method.annotations.some((annotation) => /Valid/i.test(annotation)));
      if (hasValidatedType || hasMethodValidation || /validator|validation/.test(typeText)) {
        result.push(type.name);
      }
    }
  }
  return unique(result);
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
        || (type.annotations.some((annotation) => /Configuration/i.test(annotation)) && /cors|web/.test(`${type.name} ${astFile.file}`.toLowerCase()));
      if (isWebConfig) {
        result.push(type.name);
      }
    }
  }
  return unique(result);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildState(analysis: SourceProjectAnalysis, snapshot: SourceProjectSnapshot, createdSemantic: boolean) {
  return {
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    generatedAt: new Date().toISOString(),
    semanticPath: 'source.semantic.md',
    suggestedSemanticPath: 'source.semantic.suggested.md',
    previewPath: 'source.preview.json',
    componentMapPath: 'source.component-map.json',
    flowMapPath: 'source.flow-map.json',
    jqassistantPath: 'source.jqassistant.json',
    enrichmentPath: '.ai-native/enrichment/latest.json',
    enrichmentSchemaPath: '.ai-native/enrichment/enrichment-output.schema.json',
    reviewDossierPath: '.ai-native/enrichment/review-dossier.json',
    graphPath: 'source.graph.json',
    analysisPath: 'source.analysis.json',
    analysisMdPath: 'source.analysis.md',
    snapshotPath: 'source.snapshot.json',
    astPath: 'source.ast.json',
    astIndexPath: 'source.ast-index.json',
    codeKnowledgeGraphPath: 'source.codegraph.json',
    codeKnowledgeGraphMdPath: 'source.codegraph.md',
    jqassistantSupportPath: 'source.jqassistant-graph.json',
    supportGraphPath: 'source.support-graph.json',
    graphVerificationPath: 'source.graph-verification.json',
    graphVerificationSlicesPath: 'source.graph-verification-slices.json',
    aiGraphPath: 'source.ai-graph.json',
    layerGraphsPath: 'source.layer-graphs.json',
    semanticCreatedFromScan: createdSemantic,
    counts: analysis.counts,
    layers: analysis.layers,
    modules: analysis.modules,
    technologies: analysis.technologies,
    observations: analysis.observations,
    endpointCatalog: analysis.endpointCatalog,
    schemaHints: analysis.schemaHints,
    moduleDossiers: analysis.moduleDossiers,
    javaCatalogSample: analysis.javaCatalog.slice(0, 50),
    reconnaissancePrompt: analysis.reconnaissancePrompt ? 'mcp-generated-in-plugin-flow' : undefined,
    topLevelDirectories: snapshot.topLevelDirectories,
    topLevelFiles: snapshot.topLevelFiles,
  };
}

function renderProjectReadme(analysis: SourceProjectAnalysis, snapshot: SourceProjectSnapshot, createdSemantic: boolean): string {
  return `# ${analysis.projectName}\n\n` +
    `This folder is the editable learning state produced from a source-code scan.\n\n` +
    `## What was generated\n` +
    `- source.analysis.json\n` +
    `- source.analysis.md\n` +
    `- source.snapshot.json\n` +
    `- source.ast.json\n` +
    `- source.ast-index.json\n` +
    `- source.semantic.json\n` +
    `- source.preview.json\n` +
    `- source.component-map.json\n` +
    `- source.flow-map.json\n` +
    `- source.jqassistant.json\n` +
    `- source.jqassistant-graph.json\n` +
    `- .ai-native/enrichment/latest.json\n` +
    `- .ai-native/enrichment/enrichment-output.schema.json\n` +
    `- source.codegraph.json\n` +
    `- source.codegraph.md\n` +
    `- source.support-graph.json\n` +
    `- source.graph-verification.json\n` +
    `- source.graph-verification-slices.json\n` +
    `- source.ai-graph.json\n` +
    `- source.layer-graphs.json\n` +
    `- source.recon.json\n` +
    `- source.recon.prompt.md\n` +
    `- source.database.json\n` +
    `- source.database.md\n` +
    `- source.semantic.md${createdSemantic ? ' (created from the scan)' : ' (preserved and refreshed from the current editing state)'}\n` +
    `- source.semantic.suggested.md\n` +
    `- source.graph.json\n` +
    `- source.state.json\n\n` +
    `## Discovery quality\n` +
    `- endpoints detected: ${analysis.endpointCatalog.length}\n` +
    `- schema hints detected: ${analysis.schemaHints.length}\n` +
    `- SQL files detected: ${analysis.counts.sqlFiles}\n\n` +
    `## Reconnaissance\n` +
    `- module dossiers: ${analysis.moduleDossiers?.length ?? 0}\n` +
    `- reconnaissance prompt: handled by the MCP-driven plugin flow\n\n` +
    `## How to use this state\n` +
    `1. Edit \`source.semantic.md\` to refine the human-readable system description.\n` +
    `2. Use \`source.ast-index.json\`, \`source.jqassistant-graph.json\`, \`source.support-graph.json\`, \`source.graph-verification.json\`, \`source.graph-verification-slices.json\`, \`source.ai-graph.json\`, \`source.layer-graphs.json\`, \`source.preview.json\`, \`source.component-map.json\`, \`source.flow-map.json\`, and \`.ai-native/enrichment/latest.json\` as machine support artifacts for preview and agent assembly.\n` +
    `3. Re-run the source-to-semantic import when the source project changes.\n` +
    `4. Use the graph and validator to see what the semantic model still misses.\n\n` +
    `## Current snapshot\n` +
    `- top-level directories: ${snapshot.topLevelDirectories.join(', ') || 'none'}\n` +
    `- modules: ${analysis.modules.length ? analysis.modules.join(', ') : 'none detected'}\n` +
    `- technologies: ${analysis.technologies.join(', ') || 'none detected'}\n`;
}

function buildComponentMapArtifact(
  analysis: SourceProjectAnalysis,
  preview: ReturnType<typeof buildGraphPreviewMetadata>,
  supportGraph: SupportGraphArtifact,
  astIndex: AstIndexArtifact,
  jqassistantSupport: JqassistantSupportArtifact,
): Record<string, unknown> {
  return {
    schemaVersion: '2.0',
    projectName: analysis.projectName,
    sourcePriority: ['support-graph', 'jqassistant-graph', 'ast-index', 'analysis'],
    support: {
      supportGraphNodeCount: supportGraph.nodes.length,
      astTypeCount: astIndex.summary.typeCount,
      jqassistantPackageCount: jqassistantSupport.summary.packageCount ?? 0,
    },
    applications: preview.applicationsDetailed,
  };
}

function buildFlowMapArtifact(
  analysis: SourceProjectAnalysis,
  codeGraph: CodeKnowledgeGraph,
  astIndex: AstIndexArtifact,
  jqassistantSupport: JqassistantSupportArtifact,
  supportGraph: SupportGraphArtifact,
  flowCandidateOutput?: LocalAgentOutput,
): Record<string, unknown> {
  const entrypoints = discoverFlowEntrypoints(analysis, astIndex);
  const traces = buildDeterministicFlowTraces(analysis, codeGraph, astIndex, jqassistantSupport, supportGraph, entrypoints);
  const clusters = clusterFlowTraces(entrypoints, traces);
  const semanticFlows = interpretFlowSemantics(analysis, entrypoints, traces, clusters, flowCandidateOutput);
  const validation = validateStructuredFlows(codeGraph, traces, semanticFlows);

  return {
    schemaVersion: '2.0',
    generatedAt: new Date().toISOString(),
    projectName: analysis.projectName,
    sourcePriority: ['support-graph', 'jqassistant-graph', 'ast-index', 'codegraph', 'analysis'],
    support: {
      astEndpoints: astIndex.summary.endpointCount,
      jqassistantPackages: jqassistantSupport.summary.packageCount ?? 0,
      jqassistantTypeDependencies: jqassistantSupport.summary.typeDependencyCount ?? 0,
      supportGraphNodes: supportGraph.nodes.length,
      supportGraphEdges: supportGraph.edges.length,
    },
    applications: analysis.applicationLayouts.map((layout) => layout.appRoot),
    stages: {
      entrypointDiscovery: {
        status: 'completed',
        count: entrypoints.length,
        entrypoints,
      },
      flowTrace: {
        status: 'completed',
        count: traces.length,
        traces,
      },
      flowBoundaryClustering: {
        status: 'completed',
        count: clusters.length,
        clusters,
      },
      flowSemanticInterpreter: {
        status: 'completed',
        count: semanticFlows.length,
        flows: semanticFlows,
        localCandidateCount: flowCandidateOutput?.records.length ?? 0,
      },
      flowValidation: {
        status: 'completed',
        count: validation.length,
        issues: validation,
      },
    },
    triggers: entrypoints.map((entrypoint) => ({
      kind: entrypoint.kind,
      name: entrypoint.name,
      source: entrypoint.trigger,
      target: entrypoint.target,
      notes: entrypoint.notes,
    })),
    flows: semanticFlows.map((flow) => ({
      name: flow.name,
      trigger: flow.trigger,
      summary: flow.businessMeaning,
      steps: flow.technicalPath.map((step) => `${step.role}: ${step.nodeName}`),
      confidence: flow.confidence,
      warnings: flow.warnings,
    })),
    eventFlow: analysis.commonSummary.eventFlow,
    scheduledJobs: analysis.serviceSummary.scheduledJobs,
    asyncListeners: analysis.serviceSummary.asyncListeners,
    endpointFamilies: codeGraph.summary.endpointFamilies,
    flowTraces: traces.map((trace) => `${trace.entrypointId} -> ${trace.steps.map((step) => `${step.role}:${step.nodeName}`).join(' -> ')}`),
  };
}

function discoverFlowEntrypoints(analysis: SourceProjectAnalysis, astIndex: AstIndexArtifact): FlowMapEntrypoint[] {
  const results: FlowMapEntrypoint[] = [];
  for (const endpoint of analysis.endpointCatalog) {
    const astMatch = astIndex.endpoints.find((item) => item.method === endpoint.method && item.path === endpoint.path);
    const kind = /webhook/i.test(endpoint.path)
      ? 'webhook-endpoint'
      : /callback/i.test(endpoint.path)
        ? 'callback-endpoint'
        : 'rest-endpoint';
    results.push({
      entrypointId: `http:${endpoint.method}:${endpoint.path}`,
      applicationId: inferApplicationIdFromFile(analysis, endpoint.file),
      kind,
      name: `${endpoint.method} ${endpoint.path}`,
      trigger: `${endpoint.method} ${endpoint.path}`,
      target: endpoint.typeName ?? pathBase(endpoint.file),
      sourceRef: endpoint.file,
      nodeHints: [endpoint.typeName ?? pathBase(endpoint.file)],
      notes: [endpoint.source, ...(astMatch ? [`ast:${astMatch.typeName ?? astMatch.id}`] : [])],
      evidence: [{
        kind: 'endpoint',
        ref: endpoint.file,
        detail: `${endpoint.method} ${endpoint.path} via ${endpoint.typeName ?? pathBase(endpoint.file)}`,
      }],
    });
  }

  for (const job of analysis.serviceSummary.scheduledJobs) {
    results.push({
      entrypointId: `scheduled:${slugify(job.name)}`,
      applicationId: 'event-backend',
      kind: /quartz/i.test(job.executionModel) ? 'quartz-job' : /@scheduled|cron|every|daily/i.test(job.schedule) ? 'spring-scheduled' : 'scheduler',
      name: job.name,
      trigger: job.schedule,
      target: job.name,
      sourceRef: `service:${job.name}`,
      nodeHints: [job.name],
      notes: [job.executionModel, job.purpose],
      evidence: [{
        kind: 'schedule',
        ref: job.name,
        detail: `${job.schedule}; ${job.executionModel}`,
      }],
    });
  }

  for (const listener of analysis.serviceSummary.asyncListeners) {
    const triggerText = listener.triggers.map((item) => item.event).join(' | ') || listener.name;
    results.push({
      entrypointId: `listener:${slugify(listener.name)}`,
      applicationId: 'event-backend',
      kind: inferListenerEntrypointKind(listener),
      name: listener.name,
      trigger: triggerText,
      target: listener.name,
      sourceRef: `listener:${listener.name}`,
      nodeHints: [listener.name],
      notes: [listener.purpose],
      evidence: listener.triggers.length
        ? listener.triggers.map((trigger) => ({
          kind: 'listener' as const,
          ref: listener.name,
          detail: `${trigger.event} from ${trigger.source} -> ${trigger.effect}`,
        }))
        : [{
          kind: 'listener' as const,
          ref: listener.name,
          detail: listener.purpose,
        }],
    });
  }

  for (const astFile of analysis.javaAstCatalog) {
    const applicationId = inferApplicationIdFromFile(analysis, astFile.file);
    for (const type of astFile.types) {
      for (const method of type.methods) {
        const annotations = unique([...type.annotations, ...method.annotations]);
        if (annotations.some((annotation) => /KafkaListener/i.test(annotation))) {
          results.push(buildAstEntrypoint(astFile.file, applicationId, 'kafka-listener', `${type.name}.${method.name}`, annotations));
        }
        if (annotations.some((annotation) => /RabbitListener/i.test(annotation))) {
          results.push(buildAstEntrypoint(astFile.file, applicationId, 'rabbit-listener', `${type.name}.${method.name}`, annotations));
        }
        if (annotations.some((annotation) => /JmsListener/i.test(annotation))) {
          results.push(buildAstEntrypoint(astFile.file, applicationId, 'jms-listener', `${type.name}.${method.name}`, annotations));
        }
        if (annotations.some((annotation) => /MessageDriven/i.test(annotation))) {
          results.push(buildAstEntrypoint(astFile.file, applicationId, 'mdb-listener', `${type.name}.${method.name}`, annotations));
        }
        if (annotations.some((annotation) => /EventListener/i.test(annotation))) {
          results.push(buildAstEntrypoint(astFile.file, applicationId, 'event-handler', `${type.name}.${method.name}`, annotations));
        }
        if (annotations.some((annotation) => /Scheduled/i.test(annotation))) {
          results.push(buildAstEntrypoint(astFile.file, applicationId, 'spring-scheduled', `${type.name}.${method.name}`, annotations));
        }
        if ((/CommandLineRunner|ApplicationRunner/.test(method.returnType) || /CommandLineRunner|ApplicationRunner/.test(type.name)) && method.name === 'run') {
          results.push(buildAstEntrypoint(astFile.file, applicationId, 'startup-runner', `${type.name}.${method.name}`, annotations));
        }
        if (/CommandLineRunner|ApplicationRunner/.test(method.returnType) && /@Bean/i.test(annotations.join(' '))) {
          results.push(buildAstEntrypoint(astFile.file, applicationId, 'startup-runner', `${type.name}.${method.name}`, annotations));
        }
        if (/Job|Batch/i.test(type.name) && method.name === 'run') {
          results.push(buildAstEntrypoint(astFile.file, applicationId, 'batch-job', `${type.name}.${method.name}`, annotations));
        }
      }
      if (type.annotations.some((annotation) => /WebService|Endpoint/i.test(annotation))) {
        results.push(buildAstEntrypoint(astFile.file, applicationId, 'soap-endpoint', type.name, type.annotations));
      }
    }
  }

  return uniqueBy(results, (entrypoint) => entrypoint.entrypointId);
}

function buildDeterministicFlowTraces(
  analysis: SourceProjectAnalysis,
  codeGraph: CodeKnowledgeGraph,
  astIndex: AstIndexArtifact,
  jqassistantSupport: JqassistantSupportArtifact,
  supportGraph: SupportGraphArtifact,
  entrypoints: FlowMapEntrypoint[],
): FlowTraceRecord[] {
  const supportLayerIndex = buildSupportLayerIndex(supportGraph);
  const typeDependencyIndex = buildTypeDependencyIndex(jqassistantSupport);
  return entrypoints.map((entrypoint) => {
    const candidates = matchServiceCandidatesForEntrypoint(entrypoint, analysis.serviceSummary.executionServices);
    const primary = candidates[0];
    const steps: FlowTraceStep[] = [];
    const warnings: string[] = [];
    const evidence = [...entrypoint.evidence];

    steps.push(buildTraceStep(codeGraph, entrypoint.target, inferEntrypointStepRole(entrypoint.kind), entrypoint.sourceRef, entrypoint.evidence));

    if (primary) {
      steps.push(buildTraceStep(codeGraph, primary.service.name, 'service', `service:${primary.service.name}.${primary.operation.name}`, [{
        kind: 'service-summary',
        ref: primary.service.name,
        detail: `${primary.operation.name}: ${primary.operation.purpose}`,
      }]));
      evidence.push({
        kind: 'service-summary',
        ref: primary.service.name,
        detail: `${primary.operation.name}: ${primary.operation.purpose}`,
      });
      for (const collaborator of primary.operation.collaborators.slice(0, 6)) {
        const role = classifyCollaboratorRole(collaborator, primary.operation.sideEffects);
        steps.push(buildTraceStep(codeGraph, collaborator, role, `collaborator:${collaborator}`, [{
          kind: 'service-summary',
          ref: primary.service.name,
          detail: `collaborator ${collaborator} used by ${primary.operation.name}`,
        }]));
      }
      const repositoryCandidates = inferRepositoryCandidatesFromService(primary.service.name, primary.operation.name, analysis, astIndex, typeDependencyIndex, supportLayerIndex);
      for (const repositoryName of repositoryCandidates.slice(0, 3)) {
        steps.push(buildTraceStep(codeGraph, repositoryName, 'repository', `repository:${repositoryName}`, [{
          kind: 'inference',
          ref: primary.service.name,
          detail: `repository candidate inferred for ${primary.operation.name}`,
        }]));
      }
    } else {
      warnings.push('no strongly matched service operation found for deterministic trace');
    }

    if (entrypoint.kind === 'event-handler' || /listener/.test(entrypoint.kind)) {
      const listener = analysis.serviceSummary.asyncListeners.find((item) => item.name === entrypoint.target);
      for (const trigger of listener?.triggers ?? []) {
        const repositoryName = extractRepositoryNameFromText(trigger.effect, analysis.persistenceSummary.repositories.map((item) => item.name));
        if (repositoryName) {
          steps.push(buildTraceStep(codeGraph, repositoryName, 'repository', `listener:${listener?.name}`, [{
            kind: 'listener',
            ref: listener?.name ?? entrypoint.target,
            detail: trigger.effect,
          }]));
        }
      }
    }

    if (entrypoint.kind === 'spring-scheduled' || entrypoint.kind === 'scheduler' || entrypoint.kind === 'quartz-job' || entrypoint.kind === 'batch-job') {
      const job = analysis.serviceSummary.scheduledJobs.find((item) => item.name === entrypoint.target);
      const repositoryName = extractRepositoryNameFromText(job?.effects.join(' | ') ?? '', analysis.persistenceSummary.repositories.map((item) => item.name));
      if (repositoryName) {
        steps.push(buildTraceStep(codeGraph, repositoryName, 'repository', `job:${job?.name ?? entrypoint.target}`, [{
          kind: 'schedule',
          ref: job?.name ?? entrypoint.target,
          detail: job?.effects.join(' | ') ?? 'scheduled effect',
        }]));
      }
    }

    const dedupedSteps = uniqueBy(steps, (step) => `${step.role}|${step.nodeName}`);
    return {
      traceId: `trace:${slugify(entrypoint.entrypointId)}`,
      entrypointId: entrypoint.entrypointId,
      applicationId: entrypoint.applicationId,
      flowType: inferFlowType(entrypoint.kind),
      steps: dedupedSteps,
      primaryService: primary?.service.name,
      collaboratorNames: primary?.operation.collaborators ?? [],
      warnings,
      evidence,
    };
  });
}

function clusterFlowTraces(
  entrypoints: FlowMapEntrypoint[],
  traces: FlowTraceRecord[],
): FlowClusterRecord[] {
  const clusters = new Map<string, FlowClusterRecord>();
  for (const trace of traces) {
    const entrypoint = entrypoints.find((item) => item.entrypointId === trace.entrypointId);
    const anchor = trace.primaryService
      ? trace.primaryService
      : trace.steps.find((step) => step.role === 'controller' || step.role === 'listener' || step.role === 'scheduler')?.nodeName
        ?? entrypoint?.target
        ?? trace.entrypointId;
    const clusterId = `${trace.applicationId}:${slugify(anchor)}`;
    const existing = clusters.get(clusterId) ?? {
      clusterId,
      applicationId: trace.applicationId,
      flowType: trace.flowType,
      name: anchor,
      entrypointIds: [],
      traceIds: [],
      sharedHelpers: [],
      evidence: [],
    } satisfies FlowClusterRecord;
    existing.entrypointIds = unique([...existing.entrypointIds, trace.entrypointId]);
    existing.traceIds = unique([...existing.traceIds, trace.traceId]);
    existing.sharedHelpers = unique([
      ...existing.sharedHelpers,
      ...trace.steps.filter((step) => step.role === 'helper' || step.role === 'validator' || step.role === 'mapper').map((step) => step.nodeName),
    ]);
    existing.evidence = [...existing.evidence, ...trace.evidence].slice(0, 16);
    clusters.set(clusterId, existing);
  }
  return [...clusters.values()];
}

function interpretFlowSemantics(
  analysis: SourceProjectAnalysis,
  entrypoints: FlowMapEntrypoint[],
  traces: FlowTraceRecord[],
  clusters: FlowClusterRecord[],
  flowCandidateOutput?: LocalAgentOutput,
): SemanticFlowRecord[] {
  return clusters.map((cluster) => {
    const clusterTraces = traces.filter((trace) => cluster.traceIds.includes(trace.traceId));
    const primaryTrace = clusterTraces[0];
    const entrypoint = entrypoints.find((item) => item.entrypointId === primaryTrace?.entrypointId);
    const knownFlow = matchKnownFlow(entrypoint, analysis.flowSummary.flows);
    const localCandidates = (flowCandidateOutput?.records ?? []).filter((record) =>
      String(record.applicationId ?? '').trim() === cluster.applicationId
      && (cluster.traceIds.some((traceId) => String(record.flowId ?? '').includes(slugify(traceId)))
        || cluster.entrypointIds.some((entrypointId) => String(record.trigger ?? '').includes(entrypointId.split(':').slice(1).join(':')))
        || cluster.name.toLowerCase().includes(String(record.flowName ?? '').toLowerCase())
        || String(record.flowName ?? '').toLowerCase().includes(cluster.name.toLowerCase())),
    );
    const deterministicMeaning = knownFlow?.summary
      ?? primaryTrace?.steps.find((step) => step.role === 'service')?.evidence[0]?.detail
      ?? `${cluster.name} flow`;
    const outcome = knownFlow?.steps.at(-1)
      ?? primaryTrace?.steps.at(-1)?.nodeName
      ?? 'flow completes';
    return {
      flowId: `flow:${slugify(cluster.clusterId)}`,
      applicationId: cluster.applicationId,
      name: knownFlow?.name ?? formatFlowName(cluster.name, primaryTrace?.flowType ?? cluster.flowType),
      flowType: primaryTrace?.flowType ?? cluster.flowType,
      trigger: entrypoint?.trigger ?? cluster.entrypointIds[0] ?? cluster.name,
      actor: inferFlowActor(entrypoint),
      businessMeaning: deterministicMeaning,
      technicalPath: (primaryTrace?.steps ?? []).map((step) => ({
        nodeId: step.nodeId,
        nodeName: step.nodeName,
        role: step.role,
      })),
      outcome,
      confidence: knownFlow ? 0.9 : primaryTrace?.primaryService ? 0.78 : 0.62,
      evidence: uniqueBy([
        ...(entrypoint?.evidence ?? []),
        ...(primaryTrace?.evidence ?? []),
        ...(cluster.evidence ?? []),
      ], (item) => `${item.kind}|${item.ref}|${item.detail}`).slice(0, 24),
      warnings: unique([
        ...(primaryTrace?.warnings ?? []),
        ...((localCandidates.length && !knownFlow) ? ['local candidate interpretations available; deterministic summary kept as primary'] : []),
      ]),
      candidateInterpretations: localCandidates,
    };
  });
}

function validateStructuredFlows(
  codeGraph: CodeKnowledgeGraph,
  traces: FlowTraceRecord[],
  flows: SemanticFlowRecord[],
): FlowValidationRecord[] {
  const issues: FlowValidationRecord[] = [];
  const nodeById = new Map(codeGraph.nodes.map((node) => [node.id, node]));
  const nodeNameIndex = new Map<string, string[]>();
  for (const node of codeGraph.nodes) {
    const key = node.name.toLowerCase();
    nodeNameIndex.set(key, [...(nodeNameIndex.get(key) ?? []), node.id]);
  }
  const edgeSet = new Set(codeGraph.edges.map((edge) => `${edge.from}->${edge.to}`));

  for (const trace of traces) {
    const helperCount = trace.steps.filter((step) => step.role === 'helper' || step.role === 'mapper' || step.role === 'validator').length;
    if (trace.evidence.length < 2) {
      issues.push({
        traceId: trace.traceId,
        severity: 'warning',
        category: 'low-evidence',
        message: 'trace has limited deterministic evidence',
        evidence: trace.evidence,
      });
    }
    if (helperCount >= 3 && trace.steps.length <= helperCount + 1) {
      issues.push({
        traceId: trace.traceId,
        severity: 'warning',
        category: 'utility-noise',
        message: 'trace is dominated by utility/helper steps',
        evidence: trace.evidence,
      });
    }
    if (trace.steps.filter((step) => step.role === 'service').length > 2) {
      issues.push({
        traceId: trace.traceId,
        severity: 'warning',
        category: 'mixed-flow',
        message: 'trace mixes multiple service stages and may contain subflows',
        evidence: trace.evidence,
      });
    }
  }

  for (const flow of flows) {
    if (flow.evidence.length < 2) {
      issues.push({
        flowId: flow.flowId,
        severity: 'warning',
        category: 'low-evidence',
        message: 'semantic flow has limited structured evidence',
        evidence: flow.evidence,
      });
    }
    for (let index = 0; index < flow.technicalPath.length; index += 1) {
      const current = flow.technicalPath[index];
      const existingIds = current.nodeId ? [current.nodeId] : nodeNameIndex.get(current.nodeName.toLowerCase()) ?? [];
      if (!existingIds.length || !existingIds.some((id) => nodeById.has(id))) {
        issues.push({
          flowId: flow.flowId,
          severity: 'error',
          category: 'missing-node',
          message: `technical path references unknown node ${current.nodeName}`,
          evidence: flow.evidence,
        });
      }
      const next = flow.technicalPath[index + 1];
      if (!next) continue;
      const currentIds = existingIds;
      const nextIds = next.nodeId ? [next.nodeId] : nodeNameIndex.get(next.nodeName.toLowerCase()) ?? [];
      const connected = currentIds.some((from) => nextIds.some((to) => edgeSet.has(`${from}->${to}`) || edgeSet.has(`${to}->${from}`)));
      if (currentIds.length && nextIds.length && !connected) {
        issues.push({
          flowId: flow.flowId,
          severity: 'warning',
          category: 'broken-edge',
          message: `no deterministic graph edge found between ${current.nodeName} and ${next.nodeName}`,
          evidence: flow.evidence,
        });
      }
    }
    if (flow.candidateInterpretations?.some((candidate) => String(candidate.flowType ?? '').trim() && String(candidate.flowType) !== flow.flowType)) {
      issues.push({
        flowId: flow.flowId,
        severity: 'warning',
        category: 'semantic-contradiction',
        message: 'local candidate flow type differs from deterministic flow type',
        evidence: flow.evidence,
      });
    }
  }

  return issues;
}

async function safeRunLocalAgentHook(
  projectRoot: string,
  role:
    | 'astComponentClassifier'
    | 'flowCandidate'
    | 'repositoryPurpose'
    | 'sqlMigrationSemantics'
    | 'componentPackaging'
    | 'semanticPolishing',
  prompt?: string,
  slices?: Array<{
    id: string;
    label: string;
    prompt: string;
  }>,
  onLifecycleProgress?: (event: { phase: 'analysis' | 'snapshot' | 'graph' | 'enrichment' | 'artifacts' | 'complete'; message: string }) => void | Promise<void>,
): Promise<LocalAgentOutput | undefined> {
  if (!prompt?.trim() && !slices?.length) {
    return undefined;
  }
  try {
    return await runLocalAgentRole({
      projectRoot,
      role,
      prompt,
      slices,
      onSliceProgress: async (event) => {
        await onLifecycleProgress?.({
          phase: 'enrichment',
          message: `Local agents: ${event.role} · ${event.label} · ${event.status}`,
        });
      },
    });
  } catch {
    return undefined;
  }
}

function buildLocalAgentPrompt(agentId: string, instructions: string[], payload: Record<string, unknown>): string {
  return [
    `You are ${agentId}.`,
    'Use only the provided deterministic artifacts.',
    'Do not invent facts, graph nodes, tables, routes, dependencies or components.',
    'Return JSON only. No markdown fences. No explanations outside JSON.',
    ...instructions,
    'Return an object with one top-level array field that matches the task, such as records, flows, components or triageGroups.',
    'Every item must include: agentId, model, confidence, evidence, warnings, and targetId or applicationId as applicable.',
    'Use confidence in the range 0.0 to 1.0.',
    'Use evidence entries with fields: kind, ref, detail.',
    '',
    'Deterministic input:',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function buildAstComponentClassifierPrompt(analysis: SourceProjectAnalysis): string {
  return buildLocalAgentPrompt('ast-component-classifier-agent', [
    'Classify packages, classes and types into component roles.',
    'Candidate roles: service, controller, repository, adapter, policy, validator, mapper, listener, scheduler, configuration, generated, unknown.',
    'Focus on strong signals only: annotations, imports, method signatures, package names.',
    'Return { "records": [...] }.',
  ], {
    projectName: analysis.projectName,
    applications: analysis.applicationLayouts,
    javaCatalog: analysis.javaCatalog.slice(0, 240).map((item) => ({
      file: relativePath(item.file, analysis.projectRoot),
      packageName: item.packageName,
      typeName: item.typeName,
      kind: item.kind,
      annotations: item.annotations,
      endpoints: item.endpoints,
      persistenceHints: item.persistenceHints,
      securityHints: item.securityHints,
      integrationHints: item.integrationHints,
    })),
  });
}

function buildAstComponentClassifierSlices(analysis: SourceProjectAnalysis): Array<{ id: string; label: string; prompt: string }> {
  const slices: Array<{ id: string; label: string; prompt: string }> = [];
  for (const scope of collectLocalAgentApplicationScopes(analysis)) {
    const javaCatalog = analysis.javaCatalog
      .filter((item) => localAgentScopeMatchesFile(scope, item.file, analysis.projectRoot))
      .slice(0, 160)
      .map((item) => ({
        file: relativePath(item.file, analysis.projectRoot),
        packageName: item.packageName,
        typeName: item.typeName,
        kind: item.kind,
        annotations: item.annotations,
        endpoints: item.endpoints,
        persistenceHints: item.persistenceHints,
        securityHints: item.securityHints,
        integrationHints: item.integrationHints,
      }));
    if (!javaCatalog.length) {
      continue;
    }
    slices.push({
      id: scope.id,
      label: scope.label,
      prompt: buildLocalAgentPrompt('ast-component-classifier-agent', [
        'Classify packages, classes and types into component roles.',
        'Candidate roles: service, controller, repository, adapter, policy, validator, mapper, listener, scheduler, configuration, generated, unknown.',
        'Focus on strong signals only: annotations, imports, method signatures, package names.',
        'Return { "records": [...] }.',
      ], {
        projectName: analysis.projectName,
        application: scope.application,
        focusModule: scope.module ? {
          name: scope.module.name,
          purpose: scope.module.purpose,
          pathHints: scope.module.pathHints,
        } : undefined,
        javaCatalog,
      }),
    });
  }
  return slices;
}

function buildRepositoryPurposePrompt(analysis: SourceProjectAnalysis): string {
  return buildLocalAgentPrompt('repository-purpose-agent', [
    'Summarize repository and DAO responsibilities.',
    'Infer purpose from repository names, method groups, entity/table names and notable operations.',
    'Do not invent tables or operations.',
    'Return { "records": [...] }.',
  ], {
    projectName: analysis.projectName,
    applicationLayouts: analysis.applicationLayouts,
    persistenceSummary: {
      moduleRole: analysis.persistenceSummary.moduleRole,
      repositoryStyles: analysis.persistenceSummary.repositoryStyles,
      repositories: analysis.persistenceSummary.repositories,
      mapperSummary: analysis.persistenceSummary.mapperSummary,
    },
  });
}

function buildSqlMigrationSemanticsPrompt(analysis: SourceProjectAnalysis): string {
  return buildLocalAgentPrompt('sql-migration-semantics-agent', [
    'Summarize migrations, views, indexes and schema changes into human-readable semantic notes.',
    'Classify each migration concern as schema, audit, archive, performance, reporting, integration, security or unknown.',
    'Do not modify or reinterpret the generated database schema.',
    'Return { "records": [...] }.',
  ], {
    projectName: analysis.projectName,
    applications: analysis.applicationLayouts,
    sqlCatalog: analysis.sqlCatalog.slice(0, 80).map((sqlFile) => ({
      file: relativePath(sqlFile.file, analysis.projectRoot),
      tables: sqlFile.tables.map((table) => ({
        name: table.name,
        primaryKey: table.primaryKey,
        foreignKeys: table.foreignKeys,
      })),
    })),
  });
}

function buildSqlMigrationSemanticsSlices(analysis: SourceProjectAnalysis): Array<{ id: string; label: string; prompt: string }> {
  const chunkSize = 8;
  const slices: Array<{ id: string; label: string; prompt: string }> = [];
  for (let index = 0; index < analysis.sqlCatalog.length; index += chunkSize) {
    const chunk = analysis.sqlCatalog.slice(index, index + chunkSize);
    slices.push({
      id: `sql-${Math.floor(index / chunkSize) + 1}`,
      label: `sql batch ${Math.floor(index / chunkSize) + 1}`,
      prompt: buildLocalAgentPrompt('sql-migration-semantics-agent', [
        'Summarize migrations, views, indexes and schema changes into human-readable semantic notes.',
        'Classify each migration concern as schema, audit, archive, performance, reporting, integration, security or unknown.',
        'Do not modify or reinterpret the generated database schema.',
        'Return { "records": [...] }.',
      ], {
        projectName: analysis.projectName,
        applications: analysis.applicationLayouts,
        sqlCatalog: chunk.map((sqlFile) => ({
          file: relativePath(sqlFile.file, analysis.projectRoot),
          tables: sqlFile.tables.map((table) => ({
            name: table.name,
            primaryKey: table.primaryKey,
            foreignKeys: table.foreignKeys,
          })),
        })),
      }),
    });
  }
  return slices;
}

function buildFlowCandidatePrompt(analysis: SourceProjectAnalysis, codeGraph: CodeKnowledgeGraph): string {
  return buildLocalAgentPrompt('flow-candidate-agent', [
    'Detect candidate flows from API surface, services, listeners, schedulers and graph slices.',
    'Flow types: api, event, scheduled, batch, integration, internal.',
    'Use only nodes that exist in deterministic graph summaries.',
    'Return { "flows": [...] }.',
  ], {
    projectName: analysis.projectName,
    apiSurface: analysis.apiSurface,
    serviceSummary: {
      executionServices: analysis.serviceSummary.executionServices,
      scheduledJobs: analysis.serviceSummary.scheduledJobs,
      asyncListeners: analysis.serviceSummary.asyncListeners,
    },
    persistenceSummary: analysis.persistenceSummary.repositories,
    flowSummary: analysis.flowSummary,
    graphSummary: {
      endpointFamilies: codeGraph.summary.endpointFamilies,
      flowTraces: codeGraph.summary.flowTraces,
      interfaces: codeGraph.summary.integrationInterfaces,
      serviceDetails: codeGraph.summary.serviceDetailItems,
    },
  });
}

function buildFlowCandidateSlices(
  analysis: SourceProjectAnalysis,
  codeGraph: CodeKnowledgeGraph,
  deterministicFlowMap: Record<string, unknown>,
): Array<{ id: string; label: string; prompt: string }> {
  const stages = deterministicFlowMap.stages && typeof deterministicFlowMap.stages === 'object'
    ? deterministicFlowMap.stages as Record<string, unknown>
    : {};
  const entrypoints = Array.isArray((stages.entrypointDiscovery as Record<string, unknown> | undefined)?.entrypoints)
    ? ((stages.entrypointDiscovery as Record<string, unknown>).entrypoints as Array<Record<string, unknown>>)
    : [];
  const traces = Array.isArray((stages.flowTrace as Record<string, unknown> | undefined)?.traces)
    ? ((stages.flowTrace as Record<string, unknown>).traces as Array<Record<string, unknown>>)
    : [];
  const clusters = Array.isArray((stages.flowBoundaryClustering as Record<string, unknown> | undefined)?.clusters)
    ? ((stages.flowBoundaryClustering as Record<string, unknown>).clusters as Array<Record<string, unknown>>)
    : [];
  const slices = [
    {
      id: 'api-flows',
      label: 'API flows',
      payload: {
        projectName: analysis.projectName,
        entrypoints: entrypoints.filter((item) => String(item.kind ?? '').includes('endpoint')),
        traces: traces.filter((item) => String(item.flowType ?? '') === 'api'),
        clusters: clusters.filter((item) => String(item.flowType ?? '') === 'api'),
        graphSummary: {
          endpointFamilies: codeGraph.summary.endpointFamilies,
          serviceDetails: codeGraph.summary.serviceDetailItems.slice(0, 80),
        },
      },
    },
    {
      id: 'scheduled-flows',
      label: 'Scheduled flows',
      payload: {
        projectName: analysis.projectName,
        entrypoints: entrypoints.filter((item) => /scheduled|scheduler|quartz|batch/.test(String(item.kind ?? ''))),
        traces: traces.filter((item) => /scheduled|batch/.test(String(item.flowType ?? ''))),
        clusters: clusters.filter((item) => /scheduled|batch/.test(String(item.flowType ?? ''))),
        graphSummary: {
          flowTraces: codeGraph.summary.flowTraces.filter((item) => /job|archive|refresh/i.test(item)).slice(0, 80),
        },
      },
    },
    {
      id: 'event-flows',
      label: 'Event/listener flows',
      payload: {
        projectName: analysis.projectName,
        entrypoints: entrypoints.filter((item) => /listener|handler/.test(String(item.kind ?? ''))),
        traces: traces.filter((item) => /event|integration/.test(String(item.flowType ?? ''))),
        clusters: clusters.filter((item) => /event|integration/.test(String(item.flowType ?? ''))),
        graphSummary: {
          flowTraces: codeGraph.summary.flowTraces.filter((item) => /event|notification|listener/i.test(item)).slice(0, 80),
        },
      },
    },
  ];
  return slices.map((slice) => ({
    id: slice.id,
    label: slice.label,
    prompt: buildLocalAgentPrompt('flow-candidate-agent', [
      'Interpret deterministic flow stages into candidate business flows.',
      'Do not invent nodes or edges; use the provided entrypoints, traces and clusters only.',
      'Flow types: api, event, scheduled, batch, integration, internal.',
      'Return { "flows": [...] }.',
    ], slice.payload),
  }));
}

function buildComponentPackagingPrompt(
  analysis: SourceProjectAnalysis,
  preview: ReturnType<typeof buildGraphPreviewMetadata>,
  componentMap: Record<string, unknown>,
  flowMap: Record<string, unknown>,
): string {
  return buildLocalAgentPrompt('component-packaging-agent', [
    'Group technical nodes into meaningful application components for preview cards.',
    'Preserve deterministic application boundaries and component membership constraints.',
    'Only include nodes or components that exist in the deterministic artifacts.',
    'Return { "components": [...] }.',
  ], {
    projectName: analysis.projectName,
    applicationLayouts: analysis.applicationLayouts,
    preview,
    componentMap,
    flowMap,
    moduleDossiers: analysis.moduleDossiers,
  });
}

function buildComponentPackagingSlices(
  analysis: SourceProjectAnalysis,
  preview: ReturnType<typeof buildGraphPreviewMetadata>,
  componentMap: Record<string, unknown>,
  flowMap: Record<string, unknown>,
): Array<{ id: string; label: string; prompt: string }> {
  const slices: Array<{ id: string; label: string; prompt: string }> = [];
  for (const application of preview.applicationsDetailed) {
    const applicationLayout = analysis.applicationLayouts.find((item) => item.appRoot === application.name);
    const cardChunks = chunkArray(application.cards ?? [], applicationLayout && !applicationLayout.multiModule ? 3 : 6);
    for (let index = 0; index < cardChunks.length; index += 1) {
      const cards = cardChunks[index] ?? [];
      slices.push({
        id: `${slugify(application.name)}-cards-${index + 1}`,
        label: `${application.name} / cards ${index + 1}`,
        prompt: buildLocalAgentPrompt('component-packaging-agent', [
          'Group technical nodes into meaningful application components for preview cards.',
          'Preserve deterministic application boundaries and component membership constraints.',
          'Only include nodes or components that exist in the deterministic artifacts.',
          'Return { "components": [...] }.',
        ], {
          projectName: analysis.projectName,
          application: {
            ...application,
            cards,
          },
          applicationLayout,
          componentMap,
          flowMap,
        }),
      });
    }
  }
  return slices;
}

function buildSemanticPolishingPrompt(
  projectName: string,
  semanticMarkdown: string,
  preview: ReturnType<typeof buildGraphPreviewMetadata>,
  componentMap: Record<string, unknown>,
  flowMap: Record<string, unknown>,
  supportGraph: SupportGraphArtifact,
  astIndex: AstIndexArtifact,
  jqassistantSupport: JqassistantSupportArtifact,
  verification: GraphVerificationArtifact,
): string {
  return buildLocalAgentPrompt('semantic-polishing-agent', [
    'Improve readability of the semantic markdown without introducing new facts.',
    'Use support-graph, jqassistant-graph, ast-index, flow-map, and verification artifacts as the primary evidence source.',
    'Preserve section structure and prefer minimal markdown patches over rewrites.',
    'Return { "records": [...] } where each record contains targetFile, patchType, summary and patch.',
  ], {
    projectName,
    sourcePriority: ['support-graph', 'jqassistant-graph', 'ast-index', 'flow-map', 'component-map', 'preview'],
    semanticMarkdown,
    preview,
    componentMap,
    flowMap,
    supportGraph,
    astIndexSummary: astIndex.summary,
    jqassistantSummary: jqassistantSupport.summary,
    verification,
  });
}

function buildAstEntrypoint(
  file: string,
  applicationId: string,
  kind: FlowMapEntrypoint['kind'],
  name: string,
  annotations: string[],
): FlowMapEntrypoint {
  return {
    entrypointId: `${kind}:${slugify(file)}:${slugify(name)}`,
    applicationId,
    kind,
    name,
    trigger: `${kind} ${name}`,
    target: name,
    sourceRef: file,
    nodeHints: [name.split('.').shift() ?? name],
    notes: annotations,
    evidence: [{
      kind: 'ast',
      ref: file,
      detail: `${name} annotated with ${annotations.join(', ')}`,
    }],
  };
}

function inferApplicationIdFromFile(analysis: SourceProjectAnalysis, file: string): string {
  const normalized = relativePath(file, analysis.projectRoot);
  const matched = analysis.applicationLayouts.find((layout) =>
    normalized === layout.appRoot || normalized.startsWith(`${layout.appRoot}/`));
  return matched?.appRoot ?? analysis.projectName;
}

function inferListenerEntrypointKind(listener: ServiceSummary['asyncListeners'][number]): FlowMapEntrypoint['kind'] {
  const text = `${listener.name} ${listener.purpose} ${listener.triggers.map((item) => `${item.event} ${item.source}`).join(' ')}`.toLowerCase();
  if (text.includes('kafka')) return 'kafka-listener';
  if (text.includes('rabbit')) return 'rabbit-listener';
  if (text.includes('jms')) return 'jms-listener';
  return 'event-handler';
}

function inferEntrypointStepRole(kind: FlowMapEntrypoint['kind']): FlowTraceStep['role'] {
  if (kind === 'scheduler' || kind === 'quartz-job' || kind === 'spring-scheduled' || kind === 'batch-job') return 'scheduler';
  if (kind.includes('listener') || kind === 'event-handler') return 'listener';
  return 'controller';
}

function inferFlowType(kind: FlowMapEntrypoint['kind']): FlowTraceRecord['flowType'] {
  if (kind === 'scheduler' || kind === 'quartz-job' || kind === 'spring-scheduled') return 'scheduled';
  if (kind === 'batch-job' || kind === 'startup-runner' || kind === 'cli-command') return 'batch';
  if (kind.includes('listener') || kind === 'event-handler') return 'event';
  if (kind === 'callback-endpoint' || kind === 'webhook-endpoint') return 'integration';
  return 'api';
}

function matchServiceCandidatesForEntrypoint(
  entrypoint: FlowMapEntrypoint,
  executionServices: ServiceSummary['executionServices'],
): Array<{ service: ServiceSummary['executionServices'][number]; operation: ServiceSummary['executionServices'][number]['operations'][number]; score: number }> {
  const entryTokens = tokenizeForMatch([entrypoint.name, entrypoint.trigger, entrypoint.target, ...entrypoint.notes].join(' '));
  const results: Array<{ service: ServiceSummary['executionServices'][number]; operation: ServiceSummary['executionServices'][number]['operations'][number]; score: number }> = [];
  for (const service of executionServices) {
    const serviceTokens = tokenizeForMatch(`${service.name} ${service.purpose}`);
    for (const operation of service.operations) {
      const operationTokens = tokenizeForMatch(`${operation.name} ${operation.purpose} ${operation.input ?? ''}`);
      let score = overlapScore(entryTokens, serviceTokens) * 2 + overlapScore(entryTokens, operationTokens) * 3;
      if (entryTokens.has(service.name.replace(/Service$/, '').toLowerCase())) score += 4;
      if (entrypoint.trigger.toLowerCase().includes(operation.name.toLowerCase())) score += 5;
      if (entrypoint.target.toLowerCase().includes(service.name.replace(/Service$/, '').toLowerCase())) score += 3;
      if (score > 0) {
        results.push({ service, operation, score });
      }
    }
  }
  return results.sort((left, right) => right.score - left.score).slice(0, 2);
}

function buildTraceStep(
  codeGraph: CodeKnowledgeGraph,
  nodeName: string,
  role: FlowTraceStep['role'],
  sourceRef: string,
  evidence: FlowMapEvidence[],
): FlowTraceStep {
  const node = findGraphNodeByName(codeGraph, nodeName);
  return {
    nodeId: node?.id,
    nodeName,
    role,
    sourceRef,
    evidence,
  };
}

function findGraphNodeByName(codeGraph: CodeKnowledgeGraph, nodeName: string): { id: string; name: string } | undefined {
  const lowered = nodeName.toLowerCase();
  return codeGraph.nodes.find((node) =>
    node.name.toLowerCase() === lowered
    || node.name.toLowerCase() === lowered.replace(/service$/, '')
    || lowered === node.name.toLowerCase().replace(/service$/, ''),
  ) as { id: string; name: string } | undefined;
}

function classifyCollaboratorRole(
  collaborator: string,
  sideEffects: string[],
): FlowTraceStep['role'] {
  if (/Repository$/.test(collaborator)) return 'repository';
  if (/Mapper$/.test(collaborator)) return 'mapper';
  if (/Validator|Resolver|Policy|Guard/.test(collaborator)) return 'validator';
  if (/Publisher|Event/.test(collaborator) || sideEffects.some((item) => /event/.test(item))) return 'event-publisher';
  if (/Client|Gateway|ServiceClient|Feign|OAuth/.test(collaborator)) return 'external-client';
  if (/Service$/.test(collaborator)) return 'service';
  return 'helper';
}

function extractRepositoryNameFromText(text: string, repositoryNames: string[]): string | undefined {
  return repositoryNames.find((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(text));
}

function matchKnownFlow(
  entrypoint: FlowMapEntrypoint | undefined,
  knownFlows: FlowSummary['flows'],
): FlowSummary['flows'][number] | undefined {
  if (!entrypoint) return undefined;
  return knownFlows.find((flow) =>
    flow.trigger === entrypoint.trigger
    || flow.trigger.includes(entrypoint.trigger)
    || flow.name.toLowerCase().includes(entrypoint.target.toLowerCase())
    || entrypoint.name.toLowerCase().includes(flow.name.toLowerCase()),
  );
}

function formatFlowName(name: string, flowType: FlowTraceRecord['flowType']): string {
  const label = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[._/-]+/g, ' ').trim();
  return `${capitalizeWords(label)} ${flowType === 'api' ? 'flow' : flowType}`;
}

function inferFlowActor(entrypoint: FlowMapEntrypoint | undefined): string {
  if (!entrypoint) return 'system';
  if (entrypoint.kind === 'rest-endpoint') return 'API consumer';
  if (entrypoint.kind === 'callback-endpoint' || entrypoint.kind === 'webhook-endpoint') return 'external provider';
  if (entrypoint.kind === 'startup-runner' || entrypoint.kind === 'cli-command') return 'operator/runtime';
  if (entrypoint.kind === 'scheduler' || entrypoint.kind === 'quartz-job' || entrypoint.kind === 'spring-scheduled' || entrypoint.kind === 'batch-job') return 'scheduler';
  if (entrypoint.kind.includes('listener') || entrypoint.kind === 'event-handler') return 'event source';
  if (entrypoint.kind === 'soap-endpoint') return 'SOAP client';
  return 'system';
}

function tokenizeForMatch(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((item) => item.length >= 3),
  );
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) count += 1;
  }
  return count;
}

function capitalizeWords(value: string): string {
  return value.replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

type LocalAgentApplicationScope = {
  id: string;
  label: string;
  application: ApplicationLayoutSummary;
  module?: ApplicationLayoutSummary['internalModules'][number];
};

function collectLocalAgentApplicationScopes(analysis: SourceProjectAnalysis): LocalAgentApplicationScope[] {
  const layouts = analysis.applicationLayouts.length
    ? analysis.applicationLayouts
    : [{
      appRoot: analysis.projectName,
      role: 'application',
      multiModule: false,
      moduleRoots: [],
      internalModules: [],
    } satisfies ApplicationLayoutSummary];

  const scopes: LocalAgentApplicationScope[] = [];
  for (const application of layouts) {
    if (!application.multiModule && application.internalModules.length > 0) {
      for (const module of application.internalModules) {
        scopes.push({
          id: `${slugify(application.appRoot)}-${slugify(module.name)}`,
          label: `${application.appRoot} / ${module.name}`,
          application,
          module,
        });
      }
      continue;
    }
    scopes.push({
      id: slugify(application.appRoot),
      label: application.appRoot,
      application,
    });
  }
  return scopes;
}

function localAgentScopeMatchesFile(scope: LocalAgentApplicationScope, file: string, projectRoot: string): boolean {
  const normalized = relativePath(file, projectRoot).split(sep).join('/');
  if (scope.module) {
    return fileMatchesSyntheticModule(normalized, scope.application.appRoot, scope.module);
  }
  return fileBelongsToApplication(file, scope.application.appRoot, projectRoot);
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function pathBase(pathname: string): string {
  return basename(pathname);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function relativePath(file: string, root: string): string {
  if (!isAbsolute(file)) {
    return file.replace(/\\/g, '/').replace(/^\.\//, '');
  }
  return relative(root, file).split(sep).join('/');
}

function firstExisting(files: string[], matcher: RegExp): string | undefined {
  const file = files.find((entry) => matcher.test(entry));
  return file ? file : undefined;
}
