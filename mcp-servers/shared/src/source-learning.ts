import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import type { DatabaseSchema } from './models.js';
import { parseSemanticMarkdown } from './semantic-markdown.js';
import { generateCanonicalGraph } from './graph.js';
import { generateDatabaseSchema } from './database-schema.js';

export interface SourceLearningImportOptions {
  projectRoot: string;
  projectName: string;
  outputDir: string;
  force?: boolean;
}

export interface SourceLearningResult {
  projectName: string;
  projectRoot: string;
  outputDir: string;
  reconnaissancePath: string;
  reconnaissancePromptPath: string;
  reconnaissancePromptWritten: boolean;
  semanticJsonPath: string;
  databaseSchemaPath: string;
  databaseSchemaMdPath: string;
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
  graph: ReturnType<typeof generateCanonicalGraph>;
}

export interface SourceProjectAnalysis {
  projectName: string;
  projectRoot: string;
  modules: string[];
  moduleDossiers?: ModuleDossier[];
  javaCatalog: JavaArtifactSummary[];
  endpointCatalog: JavaEndpointSummary[];
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
  javaCatalog: JavaArtifactSummary[];
  endpointCatalog: JavaEndpointSummary[];
  schemaHints: SchemaHint[];
  sqlCatalog: SqlArtifactSummary[];
  counts: SourceProjectAnalysis['counts'];
  layers: SourceProjectAnalysis['layers'];
}

export async function importSourceProjectState(options: SourceLearningImportOptions): Promise<SourceLearningResult> {
  const outputDir = options.outputDir;
  await mkdir(outputDir, { recursive: true });

  const analysis = await analyzeProject(options.projectRoot, options.projectName);
  const snapshot = await buildSnapshot(options.projectRoot, analysis);

  const analysisPath = join(outputDir, 'source.analysis.json');
  const analysisMdPath = join(outputDir, 'source.analysis.md');
  const snapshotPath = join(outputDir, 'source.snapshot.json');
  const semanticJsonPath = join(outputDir, 'source.semantic.json');
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

  const suggestedSemantic = renderSuggestedSemanticMarkdown(analysis, snapshot);
  await writeFile(suggestedSemanticPath, suggestedSemantic);

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
  const databaseSchema = generateDatabaseSchema(document, graph);
  const semanticJson = {
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    source: {
      createdSemantic,
      semanticPath,
      suggestedSemanticPath,
    },
    analysis,
    snapshot,
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

  return {
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    outputDir,
    reconnaissancePath,
    reconnaissancePromptPath,
    reconnaissancePromptWritten: false,
    semanticJsonPath,
    analysisPath,
    analysisMdPath,
    snapshotPath,
    suggestedSemanticPath,
    semanticPath,
    graphPath,
    databaseSchemaPath,
    databaseSchemaMdPath,
    statePath,
    readmePath,
    createdSemantic,
    analysis,
    snapshot,
    graph,
  };
}

async function analyzeProject(root: string, name: string): Promise<SourceProjectAnalysis> {
  const [pomFiles, javaFiles, yamlFiles, sqlFiles, markdownFiles] = await Promise.all([
    collectFiles(root, 'pom.xml'),
    collectFiles(root, '.java'),
    collectFiles(root, '.yaml', '.yml'),
    collectFiles(root, '.sql'),
    collectFiles(root, '.md'),
  ]);

  const [pomKeywords, yamlKeywords, javaSignals, packageMap, sqlCatalog] = await Promise.all([
    collectPomKeywords(pomFiles),
    collectYamlKeywords(yamlFiles),
    collectJavaSignals(javaFiles),
    collectPackageMap(javaFiles),
    collectSqlCatalog(sqlFiles),
  ]);

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
  const baseAnalysis: SourceProjectAnalysis = {
    projectName: name,
    projectRoot: root,
    modules,
    javaCatalog: javaSignals.catalog,
    endpointCatalog: javaSignals.endpoints,
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

  const moduleDossiers = buildModuleDossiers(baseAnalysis);
  const reconnaissancePrompt = buildReconnaissancePrompt(baseAnalysis, moduleDossiers);

  return {
    ...baseAnalysis,
    moduleDossiers,
    reconnaissancePrompt,
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
    javaCatalog: analysis.javaCatalog,
    endpointCatalog: analysis.endpointCatalog,
    schemaHints: analysis.schemaHints,
    sqlCatalog: analysis.sqlCatalog,
    counts: analysis.counts,
    layers: analysis.layers,
    moduleDossiers: analysis.moduleDossiers,
  };
}

function buildModuleDossiers(analysis: SourceProjectAnalysis): ModuleDossier[] {
  const roots = analysis.modules.length ? analysis.modules : ['.'];
  return roots.map((moduleRoot) => {
    const modulePath = moduleRoot === '.' ? '' : moduleRoot.replace(/\/+$/g, '');
    const matchesModule = (file: string): boolean => {
      const normalized = relativePath(file, analysis.projectRoot).split(sep).join('/');
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
        .map((value) => value.split('.').slice(0, 3).join('.')),
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
    ]).filter(Boolean);
    const prompt = buildModuleReconnaissancePrompt({
      moduleRoot: modulePath || '.',
      packageRoots,
      componentSummary: {
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
      },
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
      componentSummary: {
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
      },
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
  return `# reconnaissance prompt\n\n` +
    `You are scanning a Java/Maven codebase for a technical specification.\n\n` +
    `## goals\n` +
    `- identify every Maven module and describe its responsibilities\n` +
    `- classify interfaces into HTTP/Web ingress, integration interfaces, internal service boundaries, and persistence surfaces\n` +
    `- keep external connections separate from the software architecture lane diagram\n` +
    `- trace real service flows from ingress to persistence and external side effects\n` +
    `- prioritize migration / SQL assets over ORM-only guesses for database shape\n` +
    `- produce a rewrite-ready technical specification, not a vague summary\n\n` +
    `## module order\n` +
    `${moduleList}\n\n` +
    `## scanning rules\n` +
    `- inspect modules one by one\n` +
    `- within each module, inspect controllers, services, repositories, entities, configs, jobs, listeners, and migrations\n` +
    `- if a module contains business logic, trace the full request / command flow in that module\n` +
    `- separate HTTP ingress families from integration interfaces such as websocket, redis, mail, kafka, external HTTP clients, and object storage\n` +
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

async function collectFiles(root: string, suffixOrPattern: string | RegExp, secondary?: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'target' || entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.idea') continue;
        queue.push(full);
        continue;
      }
      if (typeof suffixOrPattern === 'string') {
        if (full.endsWith(suffixOrPattern) || (secondary && full.endsWith(secondary))) files.push(full);
      } else if (suffixOrPattern.test(full)) {
        files.push(full);
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
    if (entry.name === 'target' || entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.idea') continue;
    if (entry.isDirectory()) directories.push(entry.name);
    else files.push(entry.name);
  }
  return { directories, files };
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

async function collectJavaSignals(files: string[]) {
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

  await Promise.all(
    files.map(async (file) => {
      const text = await readFile(file, 'utf8');
      const lower = text.toLowerCase();
      const packageName = extractPackageName(text);
      const typeName = extractTypeName(text);
      const annotations = collectAnnotations(text, [
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
      ]);
      const endpointSpecs = extractEndpointSpecifications(text);
      const persistenceHints = collectPersistenceHints(text);
      const securityHints = collectSecurityHints(text);
      const integrationHints = collectIntegrationHints(text, file);
      const inferredKind = inferJavaKind(file, text);

      const rel = file;
      if (/(@restcontroller|@controller)/i.test(text) || /controller\.java$/i.test(file)) controllers.push(rel);
      if (/(@service)/i.test(text) || /service\.java$/i.test(file)) services.push(rel);
      if (/(@repository)/i.test(text) || /repository\.java$/i.test(file)) repositories.push(rel);
      if (/(@entity)/i.test(text) || /entity\.java$/i.test(file)) entities.push(rel);
      if (/(@configuration|@config)/i.test(text) || /(?:Config|Configuration)\.java$/i.test(file)) configs.push(rel);
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

      if (typeName || annotations.length || endpointSpecs.length || persistenceHints.length || securityHints.length || integrationHints.length) {
        catalog.push({
          file,
          packageName,
          typeName,
          kind: inferredKind,
          annotations,
          endpoints: endpointSpecs.map((entry) => `${entry.method} ${entry.path}`),
          persistenceHints,
          securityHints,
          integrationHints,
        });
      }

      if (
        persistenceHints.length > 0 ||
        inferredKind === 'entity' ||
        annotations.some((annotation) => /Entity|Table/i.test(annotation)) ||
        /\/(entity|table|migration|schema)\//i.test(file)
      ) {
        if (inferredKind === 'repository' || /repository/i.test(typeName ?? '') || /\/repository\//i.test(file)) {
          return;
        }
        const entityBlueprint = extractJavaEntityBlueprint(text, typeName);
        schemaHints.push({
          file,
          typeName,
          tableName: entityBlueprint.tableName ?? inferTableName(text, typeName),
          columns: entityBlueprint.fields.map((field) => field.name),
          relationships: entityBlueprint.relationships,
          annotations,
          primaryKey: entityBlueprint.primaryKey,
          fields: entityBlueprint.fields,
          sourceKind: 'entity',
        });
      }
    }),
  );

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
    catalog: uniqueBy(catalog, (item) => `${item.file}|${item.typeName ?? ''}|${item.kind}`),
    endpoints: uniqueBy(endpoints, (item) => `${item.file}|${item.method}|${item.path}|${item.typeName ?? ''}`),
    schemaHints: uniqueBy(schemaHints, (item) => `${item.file}|${item.typeName ?? ''}|${item.tableName ?? ''}`),
  };
}

function extractPackageName(text: string): string | undefined {
  const match = text.match(/^\s*package\s+([a-zA-Z0-9_.]+)\s*;/m);
  return match?.[1];
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

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

async function collectPackageMap(files: string[]): Promise<Record<string, number>> {
  const packageCounts = new Map<string, number>();
  await Promise.all(
    files.map(async (file) => {
      const text = await readFile(file, 'utf8');
      const match = text.match(/^\s*package\s+([a-zA-Z0-9_.]+)\s*;/m);
      if (match?.[1]) {
        const pkg = match[1];
        packageCounts.set(pkg, (packageCounts.get(pkg) ?? 0) + 1);
      }
    }),
  );
  return Object.fromEntries([...packageCounts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function collectSqlCatalog(files: string[]): Promise<SqlArtifactSummary[]> {
  const summaries: SqlArtifactSummary[] = [];
  await Promise.all(
    files.map(async (file) => {
      const text = await readFile(file, 'utf8');
      const tables = parseSqlTables(text);
      if (tables.length > 0) {
        summaries.push({
          file,
          tables,
        });
      }
    }),
  );
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

function renderAnalysisMarkdown(analysis: SourceProjectAnalysis, snapshot: SourceProjectSnapshot): string {
  const topPackages = Object.entries(analysis.packageMap)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12);
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

function renderSuggestedSemanticMarkdown(analysis: SourceProjectAnalysis, snapshot: SourceProjectSnapshot): string {
  const moduleLines = analysis.modules.length
    ? analysis.modules.map((module) => `- ${module}`).join('\n')
    : '- module boundaries still need to be refined from the source scan';

  const interfaceLines = buildInterfaceLines(analysis);
  const flowLines = buildFlowLines(analysis);
  const processLines = buildProcessLines(analysis);
  const dependencyLines = buildDependencyLines(analysis);
  const securityLines = buildSecurityLines(analysis);
  const schemaLines = buildSchemaLines(analysis);
  const architectureLines = buildArchitectureLines(analysis);

  return `# system\n\n` +
    `${analysis.projectName} source-derived system slice.\n\n` +
    `## intent\n` +
    `Capture the current architecture shape, major runtime paths, persistence structure, and integration boundaries so the semantic model can be refined and reused for future feature work.\n\n` +
    `## context\n` +
    `- source root: ${analysis.projectRoot}\n` +
    `- top-level modules: ${analysis.modules.length ? analysis.modules.join(', ') : 'single module / not clearly segmented'}\n` +
    `- key architectural signals: ${analysis.observations.join(', ') || 'no strong signal detected yet'}\n` +
    `- discovered endpoints: ${analysis.endpointCatalog.length}\n` +
    `- discovered schema hints: ${analysis.schemaHints.length}\n\n` +
    `## modules\n${moduleLines}\n\n` +
    `## architecture\n${architectureLines}\n\n` +
    `## interfaces\n${interfaceLines}\n\n` +
    `## data_flows\n${flowLines}\n\n` +
    `## processes\n${processLines}\n\n` +
    `## rules\n` +
    `- preserve module boundaries when they are explicit in the source\n` +
    `- keep inbound interface contracts separate from internal orchestration\n` +
    `- keep persistence and external integrations explicit\n` +
    `- keep database tables and relationships explicit when schema evidence exists\n\n` +
    `## security\n${securityLines}\n\n` +
    `## dependencies\n${dependencyLines}\n\n` +
    `## database_schema\n${schemaLines}\n\n` +
    `## examples\n` +
    `- a user-facing request enters through the exposed interface layer\n` +
    `- a service call may persist state or dispatch to an external integration\n` +
    `- a database table may be inferred from entity annotations or SQL schema files\n\n` +
    `## acceptance_criteria\n` +
    `- the semantic source can be edited without rewriting the scan output\n` +
    `- the graph reflects the major modules, interfaces, flows, integrations, and persistence structures\n` +
    `- future feature work can update the semantic file and regenerate the graph\n` +
    `- the source scan can be rerun without losing the curated semantic state\n\n` +
    `## refinement_targets\n` +
    `- align the module list with the actual source code boundaries\n` +
    `- describe inbound and outbound API paths and service orchestration in more detail\n` +
    `- refine security rules, persistence ownership, and database relationships based on the real implementation\n` +
    `- add explicit entity/table ownership, join tables, and foreign keys when the source reveals them\n`;
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
  if (technologies.some((item) => /minio|s3/i.test(item))) items.add('Object storage');
  if (technologies.some((item) => /kafka|queue|stream|mq/i.test(item)) || analysis.counts.listeners > 0) items.add('Messaging / event stream');
  if (analysis.javaCatalog.some((item) => item.integrationHints.some((hint) => /feignclient|http client|rest client/i.test(hint)))) items.add('External HTTP client');
  if (analysis.javaCatalog.some((item) => item.integrationHints.some((hint) => /listener|event/i.test(hint)))) items.add('Async listener / consumer');
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
    items.add(`table ${tableName}`);
  }
  return [...items];
}

function buildInterfaceLines(analysis: SourceProjectAnalysis): string {
  const lines: string[] = [];
  const httpFamilies = groupEndpointFamilies(analysis.endpointCatalog.filter((entry) => /^(GET|POST|PUT|DELETE|PATCH|REQUEST)$/i.test(entry.method)));
  if (httpFamilies.length > 0) {
    lines.push(`- HTTP / web ingress families (${analysis.endpointCatalog.length} endpoints detected)`);
    lines.push(
      ...httpFamilies.slice(0, 10).map((family) => `- ${family.family} (${family.count})${family.samples.length ? ` — ${family.samples.join(', ')}` : ''}`),
    );
  }
  const integrationItems = collectIntegrationItems(analysis);
  if (integrationItems.length > 0) {
    lines.push('- integration interfaces');
    lines.push(...integrationItems.map((item) => `- ${item}`));
  }
  const internalServices = collectNamedKinds(analysis, ['service', 'controller', 'configuration', 'policy'], 12);
  if (internalServices.length > 0) {
    lines.push('- internal service boundaries');
    lines.push(...internalServices.map((item) => `- ${item}`));
  }
  const persistenceSurfaces = collectPersistenceItems(analysis);
  if (persistenceSurfaces.length > 0) {
    lines.push('- persistence surfaces');
    lines.push(...persistenceSurfaces.map((item) => `- ${item}`));
  }
  return lines.length ? lines.join('\n') : '- interface boundaries still need to be inferred from the source';
}

function buildFlowLines(analysis: SourceProjectAnalysis): string {
  const lines: string[] = [];
  const serviceNames = collectNamedKinds(analysis, ['service'], 10);
  const jobNames = collectNamedKinds(analysis, ['job'], 8);
  const listenerNames = collectNamedKinds(analysis, ['listener'], 8);
  const repositoryNames = collectNamedKinds(analysis, ['repository'], 8);
  const entityNames = collectNamedKinds(analysis, ['entity'], 8);

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
  if (analysis.schemaHints.length > 0) {
    lines.push('- persistence flows may update explicit tables, columns, and relationships inferred from SQL or entity annotations');
  }
  return lines.length ? lines.join('\n') : '- concrete flows still need to be refined from the source';
}

function buildProcessLines(analysis: SourceProjectAnalysis): string {
  const lines: string[] = [];
  if (analysis.counts.controllers > 0) lines.push('- handle inbound requests and route them to the right service action');
  if (analysis.counts.services > 0) lines.push('- execute named service responsibilities and use-case steps');
  if (analysis.counts.repositories > 0) lines.push('- query and persist domain state through repository adapters');
  if (analysis.counts.entities > 0) lines.push('- map domain objects to table-backed persistence shapes');
  const jobs = collectNamedKinds(analysis, ['job'], 8);
  if (jobs.length > 0) lines.push(`- scheduled processors: ${jobs.join(' | ')}`);
  const listeners = collectNamedKinds(analysis, ['listener'], 8);
  if (listeners.length > 0) lines.push(`- async event listeners: ${listeners.join(' | ')}`);
  if (analysis.schemaHints.length > 0) lines.push('- maintain explicit table and relationship ownership where schema hints are present');
  if (analysis.technologies.some((item) => /jwt|oauth|security/i.test(item)) || analysis.counts.securityClasses > 0) lines.push('- enforce authentication and authorization gates before state changes');
  return lines.length ? lines.join('\n') : '- processes still need to be refined from the source';
}

function buildDependencyLines(analysis: SourceProjectAnalysis): string {
  const lines: string[] = [];
  if (analysis.technologies.some((item) => /postgres|database|sql/i.test(item))) lines.push('- relational database');
  if (analysis.technologies.some((item) => /redis/i.test(item))) lines.push('- redis');
  if (analysis.technologies.some((item) => /websocket/i.test(item))) lines.push('- websocket gateway');
  if (analysis.technologies.some((item) => /mail/i.test(item))) lines.push('- mail service');
  if (analysis.technologies.some((item) => /minio|s3/i.test(item))) lines.push('- object storage');
  if (analysis.technologies.some((item) => /jwt|oauth|security/i.test(item))) lines.push('- security provider or auth boundary');
  if (analysis.javaCatalog.some((item) => item.integrationHints.some((hint) => /feignclient|http client|rest client/i.test(hint)))) lines.push('- external HTTP client adapter');
  if (analysis.javaCatalog.some((item) => item.integrationHints.some((hint) => /kafka|listener|event/i.test(hint)))) lines.push('- async messaging / event integration');
  if (analysis.counts.sqlFiles > 0) lines.push(`- SQL migrations (${analysis.counts.sqlFiles})`);
  return lines.length ? lines.join('\n') : '- dependencies still need to be refined from the source';
}

function buildSecurityLines(analysis: SourceProjectAnalysis): string {
  const lines: string[] = [];
  if (analysis.technologies.some((item) => /jwt/i.test(item))) lines.push('- JWT-based authentication is present');
  if (analysis.technologies.some((item) => /oauth/i.test(item))) lines.push('- OAuth / OIDC style auth is present or implied');
  if (analysis.technologies.some((item) => /turnstile/i.test(item))) lines.push('- bot / challenge protection is present');
  if (analysis.counts.securityClasses > 0) lines.push('- explicit security classes exist in the source');
  if (analysis.javaCatalog.some((item) => item.securityHints.length > 0)) {
    lines.push('- annotations and code hints suggest explicit authz / authorization gates');
  }
  return lines.length ? lines.join('\n') : '- security boundaries still need to be refined from the source';
}

function buildArchitectureLines(analysis: SourceProjectAnalysis): string {
  const lines: string[] = [];
  const httpFamilies = groupEndpointFamilies(analysis.endpointCatalog.filter((entry) => /^(GET|POST|PUT|DELETE|PATCH|REQUEST)$/i.test(entry.method)));
  if (httpFamilies.length > 0) {
    lines.push(`- web / HTTP ingress layer (${analysis.endpointCatalog.length} endpoints): ${httpFamilies.slice(0, 6).map((family) => `${family.family} (${family.count})`).join(' | ')}`);
  } else if (analysis.counts.controllers > 0) {
    lines.push(`- web / HTTP ingress layer (${analysis.counts.controllers} controller entry points)`);
  }

  const integrationItems = collectIntegrationItems(analysis);
  if (integrationItems.length > 0) {
    lines.push(`- integration interface layer: ${integrationItems.slice(0, 8).join(' | ')}`);
  }

  const securityItems = unique([
    ...collectNamedKinds(analysis, ['policy', 'configuration'], 8),
    ...(analysis.counts.securityClasses > 0 ? ['security classes'] : []),
  ]);
  if (securityItems.length > 0) {
    lines.push(`- security layer: ${securityItems.slice(0, 8).join(' | ')}`);
  }

  const serviceNames = collectNamedKinds(analysis, ['service'], 8);
  const backgroundNames = unique([...collectNamedKinds(analysis, ['job'], 6), ...collectNamedKinds(analysis, ['listener'], 6)]);
  if (serviceNames.length > 0 || backgroundNames.length > 0) {
    const serviceText = serviceNames.length > 0 ? serviceNames.join(' | ') : 'service responsibilities';
    const backgroundText = backgroundNames.length > 0 ? `; background processors: ${backgroundNames.join(' | ')}` : '';
    lines.push(`- service layer: ${serviceText}${backgroundText}`);
  }

  const persistenceItems = collectPersistenceItems(analysis);
  if (persistenceItems.length > 0) {
    lines.push(`- persistence / storage layer: ${persistenceItems.slice(0, 8).join(' | ')}`);
  } else if (analysis.counts.repositories > 0 || analysis.counts.entities > 0) {
    lines.push(`- persistence / storage layer (${analysis.counts.repositories} repositories, ${analysis.counts.entities} entities)`);
  }
  return lines.length ? lines.join('\n') : '- architecture layers still need to be refined from the source';
}

function buildSchemaLines(analysis: SourceProjectAnalysis): string {
  const lines: string[] = [];
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

function buildState(analysis: SourceProjectAnalysis, snapshot: SourceProjectSnapshot, createdSemantic: boolean) {
  return {
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    generatedAt: new Date().toISOString(),
    semanticPath: 'source.semantic.md',
    suggestedSemanticPath: 'source.semantic.suggested.md',
    graphPath: 'source.graph.json',
    analysisPath: 'source.analysis.json',
    analysisMdPath: 'source.analysis.md',
    snapshotPath: 'source.snapshot.json',
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
    `- source.semantic.json\n` +
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
    `1. Edit \`source.semantic.md\` to refine the system slice.\n` +
    `2. Re-run the source-to-semantic import when the source project changes.\n` +
    `3. Use the graph and validator to see what the semantic model still misses.\n\n` +
    `## Current snapshot\n` +
    `- top-level directories: ${snapshot.topLevelDirectories.join(', ') || 'none'}\n` +
    `- modules: ${analysis.modules.length ? analysis.modules.join(', ') : 'none detected'}\n` +
    `- technologies: ${analysis.technologies.join(', ') || 'none detected'}\n`;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
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

function relativePath(file: string, root: string): string {
  return relative(root, file).split(sep).join('/');
}

function firstExisting(files: string[], matcher: RegExp): string | undefined {
  const file = files.find((entry) => matcher.test(entry));
  return file ? file : undefined;
}
