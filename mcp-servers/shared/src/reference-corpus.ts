import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ReferenceProjectAnalysis {
  projectName: string;
  projectRoot: string;
  modules: string[];
  counts: {
    pomFiles: number;
    javaFiles: number;
    yamlFiles: number;
    controllers: number;
    services: number;
    repositories: number;
    entities: number;
    policies: number;
    configs: number;
    jobs: number;
    listeners: number;
    securityClasses: number;
  };
  layers: {
    api: number;
    web: number;
    service: number;
    persistence: number;
    common: number;
    app: number;
  };
  technologies: string[];
  roles: Record<string, string[]>;
  keyPaths: {
    applicationYaml?: string;
    securityYaml?: string;
    openApiYaml?: string;
  };
  observations: string[];
}

export interface ReferenceCorpus {
  projects: ReferenceProjectAnalysis[];
  primary?: ReferenceProjectAnalysis;
  moduleHints: string[];
  technologyHints: string[];
  architectureHints: string[];
  schemaHints: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const defaultCorpusRoot = join(__dirname, '../../../reference-projects');

let cachedCorpus: ReferenceCorpus | undefined;

export function loadReferenceCorpus(): ReferenceCorpus {
  if (cachedCorpus) {
    return cachedCorpus;
  }

  const corpusRoot = process.env.AI_NATIVE_REFERENCE_CORPUS_ROOT || defaultCorpusRoot;
  const projects: ReferenceProjectAnalysis[] = [];

  if (existsSync(corpusRoot)) {
    for (const entry of readdirSync(corpusRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const analysisPath = join(corpusRoot, entry.name, `${entry.name}.analysis.json`);
      if (!existsSync(analysisPath)) continue;

      try {
        const raw = readFileSync(analysisPath, 'utf8');
        const parsed = JSON.parse(raw) as ReferenceProjectAnalysis;
        projects.push(parsed);
      } catch {
        continue;
      }
    }
  }

  const primary = projects[0];
  const moduleHints = unique([
    ...projects.flatMap((project) => project.modules),
    'api',
    'web',
    'service',
    'persistence',
    'common',
    'app',
    'notification',
  ]);
  const technologyHints = unique(projects.flatMap((project) => project.technologies));
  const architectureHints = unique(projects.flatMap((project) => project.observations));
  const schemaHints = unique([
    ...projects.flatMap((project) => [...(project.roles.entities ?? []), ...(project.roles.repositories ?? [])].map((entry) => normalizeSchemaHint(entry))),
    'id',
    'created_at',
    'updated_at',
    'version',
    'status',
    'tenant_id',
    'aggregate_id',
    'event_type',
    'payload',
    'audit_log',
    'outbox_event',
  ]);

  cachedCorpus = { projects, primary, moduleHints, technologyHints, architectureHints, schemaHints };
  return cachedCorpus;
}

export function getReferenceArchitectureThresholds(): {
  minComplexInterfaces: number;
  minComplexDependencies: number;
  minComplexProcesses: number;
} {
  return {
    minComplexInterfaces: 6,
    minComplexDependencies: 5,
    minComplexProcesses: 10,
  };
}

export function isEnterpriseLikeDocument(summary: {
  interfaceCount: number;
  dependencyCount: number;
  processCount: number;
  securityCount: number;
  dataFlowCount: number;
}, sourceText = ''): boolean {
  const thresholds = getReferenceArchitectureThresholds();
  const normalized = sourceText.toLowerCase();
  const enterpriseMarkers = unique([
    'websocket',
    'redis',
    'kafka',
    'openapi',
    'flyway',
    'oauth',
    'jwt',
    'minio',
    's3',
    'postgres',
    'oracle',
    'audit log',
    'feature policy',
    'turnstile',
  ]);
  const markerHits = enterpriseMarkers.filter((marker) => normalized.includes(marker));
  const hasEnterpriseMarker = markerHits.length >= 2;

  return (
    hasEnterpriseMarker ||
    (summary.interfaceCount >= thresholds.minComplexInterfaces &&
      summary.dependencyCount >= thresholds.minComplexDependencies &&
      summary.processCount >= thresholds.minComplexProcesses) ||
    (summary.dependencyCount >= thresholds.minComplexDependencies + 1 &&
      summary.processCount >= thresholds.minComplexProcesses + 1 &&
      summary.securityCount > 0)
  );
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function normalizeSchemaHint(value: string): string {
  const filename = value.split(/[\\/]/).pop() ?? value;
  return filename
    .replace(/\.(java|kt|groovy|ts|tsx|js|jsx)$/, '')
    .replace(/(entity|record|model|repository|repo|table|dto)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
    || value.toLowerCase();
}
