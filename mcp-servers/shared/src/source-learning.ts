import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { parseSemanticMarkdown } from './semantic-markdown.js';
import { generateCanonicalGraph } from './graph.js';

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
  counts: {
    pomFiles: number;
    javaFiles: number;
    yamlFiles: number;
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

export interface SourceProjectSnapshot {
  projectRoot: string;
  topLevelDirectories: string[];
  topLevelFiles: string[];
  moduleRoots: string[];
  packageMap: Record<string, number>;
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
  await writeFile(graphPath, JSON.stringify(graph, null, 2) + '\n');
  await writeFile(statePath, JSON.stringify(buildState(analysis, snapshot, createdSemantic), null, 2) + '\n');
  await writeFile(readmePath, renderProjectReadme(analysis, snapshot, createdSemantic));

  return {
    projectName: analysis.projectName,
    projectRoot: analysis.projectRoot,
    outputDir,
    analysisPath,
    analysisMdPath,
    snapshotPath,
    suggestedSemanticPath,
    semanticPath,
    graphPath,
    statePath,
    readmePath,
    createdSemantic,
    analysis,
    snapshot,
    graph,
  };
}

async function analyzeProject(root: string, name: string): Promise<SourceProjectAnalysis> {
  const [pomFiles, javaFiles, yamlFiles, markdownFiles] = await Promise.all([
    collectFiles(root, 'pom.xml'),
    collectFiles(root, '.java'),
    collectFiles(root, '.yaml', '.yml'),
    collectFiles(root, '.md'),
  ]);

  const [pomKeywords, yamlKeywords, javaSignals, packageMap] = await Promise.all([
    collectPomKeywords(pomFiles),
    collectYamlKeywords(yamlFiles),
    collectJavaSignals(javaFiles),
    collectPackageMap(javaFiles),
  ]);

  const modules = pomFiles
    .map((file) => relative(root, dirname(file)).split(sep).join('/'))
    .filter((path) => path && path !== '.')
    .sort((left, right) => left.localeCompare(right));

  const counts = {
    pomFiles: pomFiles.length,
    javaFiles: javaFiles.length,
    yamlFiles: yamlFiles.length,
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

  return {
    projectName: name,
    projectRoot: root,
    modules,
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
}

async function buildSnapshot(root: string, analysis: SourceProjectAnalysis): Promise<SourceProjectSnapshot> {
  const tree = await buildDirectorySnapshot(root);
  return {
    projectRoot: root,
    topLevelDirectories: tree.directories,
    topLevelFiles: tree.files,
    moduleRoots: analysis.modules,
    packageMap: analysis.packageMap,
    counts: analysis.counts,
    layers: analysis.layers,
  };
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

  await Promise.all(
    files.map(async (file) => {
      const text = (await readFile(file, 'utf8')).toLowerCase();
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
  };
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

function deriveObservations({ modules, counts, technologies, javaSignals, markdownFiles }: { modules: string[]; counts: SourceProjectAnalysis['counts']; technologies: string[]; javaSignals: Awaited<ReturnType<typeof collectJavaSignals>>; markdownFiles: string[]; }): string[] {
  const observations: string[] = [];
  if (modules.length > 1) observations.push('multi-module architecture');
  if (counts.controllers >= 10) observations.push('broad HTTP surface');
  if (counts.services >= 10) observations.push('substantial orchestration layer');
  if (counts.repositories >= 10) observations.push('rich persistence layer');
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
    `- listeners: ${analysis.counts.listeners}\n\n` +
    `## Source snapshot\n` +
    `- top-level directories: ${snapshot.topLevelDirectories.join(', ') || 'none'}\n` +
    `- top-level files: ${snapshot.topLevelFiles.join(', ') || 'none'}\n\n` +
    `## Detected module roots\n` +
    (analysis.modules.length ? analysis.modules.map((module) => `- ${module}`).join('\n') : '- none detected') + '\n\n' +
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

  return `# system\n\n` +
    `${analysis.projectName} source-derived system slice.\n\n` +
    `## intent\n` +
    `Capture the current architecture shape, major runtime paths, and integration boundaries so the semantic model can be refined and reused for future feature work.\n\n` +
    `## context\n` +
    `- source root: ${analysis.projectRoot}\n` +
    `- top-level modules: ${analysis.modules.length ? analysis.modules.join(', ') : 'single module / not clearly segmented'}\n` +
    `- key architectural signals: ${analysis.observations.join(', ') || 'no strong signal detected yet'}\n\n` +
    `## modules\n${moduleLines}\n\n` +
    `## interfaces\n${interfaceLines}\n\n` +
    `## data_flows\n${flowLines}\n\n` +
    `## processes\n${processLines}\n\n` +
    `## rules\n` +
    `- preserve module boundaries when they are explicit in the source\n` +
    `- keep inbound interface contracts separate from internal orchestration\n` +
    `- keep persistence and external integrations explicit\n\n` +
    `## security\n${securityLines}\n\n` +
    `## dependencies\n${dependencyLines}\n\n` +
    `## examples\n` +
    `- a user-facing request enters through the exposed interface layer\n` +
    `- a service call may persist state or dispatch to an external integration\n\n` +
    `## acceptance_criteria\n` +
    `- the semantic source can be edited without rewriting the scan output\n` +
    `- the graph reflects the major modules, interfaces, flows, and integrations\n` +
    `- future feature work can update the semantic file and regenerate the graph\n` +
    `- the source scan can be rerun without losing the curated semantic state\n\n` +
    `## refinement_targets\n` +
    `- align the module list with the actual source code boundaries\n` +
    `- describe the main inbound and outbound paths in more detail\n` +
    `- refine security rules and persistence ownership based on the real implementation\n`;
}

function buildInterfaceLines(analysis: SourceProjectAnalysis): string {
  const lines: string[] = [];
  if (analysis.counts.controllers > 0) lines.push('- REST / HTTP inbound interface layer');
  if (analysis.counts.websocketHandlers > 0) lines.push('- WebSocket / real-time inbound or outbound interface');
  if (analysis.technologies.some((item) => /openapi/i.test(item))) lines.push('- OpenAPI / contract-first API surface');
  if (analysis.counts.listeners > 0) lines.push('- event or message listener interface');
  if (analysis.counts.jobs > 0) lines.push('- scheduled job entry points');
  return lines.length ? lines.join('\n') : '- interface boundaries still need to be inferred from the source';
}

function buildFlowLines(analysis: SourceProjectAnalysis): string {
  const lines: string[] = [];
  if (analysis.counts.controllers > 0 && analysis.counts.services > 0 && analysis.counts.repositories > 0) {
    lines.push('- inbound request -> controller -> service -> repository -> response');
  }
  if (analysis.technologies.some((item) => /websocket/i.test(item))) {
    lines.push('- outbound event -> notification channel -> real-time client update');
  }
  if (analysis.technologies.some((item) => /redis/i.test(item))) {
    lines.push('- service flow may include cache or runtime coordination via Redis');
  }
  if (analysis.technologies.some((item) => /mail/i.test(item))) {
    lines.push('- service flow may dispatch notifications or emails as side effects');
  }
  if (analysis.technologies.some((item) => /minio|s3/i.test(item))) {
    lines.push('- service flow may store or fetch binary assets from object storage');
  }
  return lines.length ? lines.join('\n') : '- concrete flows still need to be refined from the source';
}

function buildProcessLines(analysis: SourceProjectAnalysis): string {
  const lines: string[] = [];
  if (analysis.counts.controllers > 0) lines.push('- handle inbound request and map to a service action');
  if (analysis.counts.services > 0) lines.push('- orchestrate business logic in service layer');
  if (analysis.counts.repositories > 0) lines.push('- persist or query domain state');
  if (analysis.counts.jobs > 0) lines.push('- run background or scheduled processing');
  if (analysis.counts.listeners > 0) lines.push('- consume async events or messages');
  if (analysis.technologies.some((item) => /jwt|oauth|security/i.test(item))) lines.push('- enforce authentication and authorization policy');
  return lines.length ? lines.join('\n') : '- processes still need to be refined from the source';
}

function buildDependencyLines(analysis: SourceProjectAnalysis): string {
  const lines: string[] = [];
  if (analysis.technologies.some((item) => /postgres|database|sql/i.test(item))) lines.push('- relational database');
  if (analysis.technologies.some((item) => /redis/i.test(item))) lines.push('- redis');
  if (analysis.technologies.some((item) => /websocket/i.test(item))) lines.push('- websocket gateway');
  if (analysis.technologies.some((item) => /openapi/i.test(item))) lines.push('- API documentation / contract layer');
  if (analysis.technologies.some((item) => /mail/i.test(item))) lines.push('- mail / notification provider');
  if (analysis.technologies.some((item) => /minio|s3/i.test(item))) lines.push('- object storage');
  if (analysis.technologies.some((item) => /jwt|oauth|security/i.test(item))) lines.push('- security provider or auth boundary');
  return lines.length ? lines.join('\n') : '- dependencies still need to be refined from the source';
}

function buildSecurityLines(analysis: SourceProjectAnalysis): string {
  const lines: string[] = [];
  if (analysis.technologies.some((item) => /jwt/i.test(item))) lines.push('- JWT-based authentication is present');
  if (analysis.technologies.some((item) => /oauth/i.test(item))) lines.push('- OAuth / OIDC style auth is present or implied');
  if (analysis.technologies.some((item) => /turnstile/i.test(item))) lines.push('- bot / challenge protection is present');
  if (analysis.counts.securityClasses > 0) lines.push('- explicit security classes exist in the source');
  return lines.length ? lines.join('\n') : '- security boundaries still need to be refined from the source';
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
    `- source.semantic.md${createdSemantic ? ' (created from the scan)' : ' (preserved and refreshed from the current editing state)'}\n` +
    `- source.semantic.suggested.md\n` +
    `- source.graph.json\n` +
    `- source.state.json\n\n` +
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

function firstExisting(files: string[], matcher: RegExp): string | undefined {
  const file = files.find((entry) => matcher.test(entry));
  return file ? file : undefined;
}
