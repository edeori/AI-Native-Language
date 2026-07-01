import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import YAML from 'yaml';
import type { CodeKnowledgeGraph } from './code-graph.js';

const OLLAMA_NUM_CTX = 32768;


// Estimate timeout from model size: larger models are slower per token
function deriveModelLimits(model: string): { maxInputSize: number; timeoutMs: number } {
  const lower = model.toLowerCase();
  const sizeMatch = lower.match(/:?(\d+(?:\.\d+)?)x?b/);
  const sizeB = sizeMatch ? parseFloat(sizeMatch[1]) : 7;
  // timeout: ~200ms/token for 7b on consumer hardware, scales roughly linearly
  // cap input at half ctx for small models (less coherent at boundary)
  const scaleFactor = sizeB <= 3 ? 0.4 : sizeB <= 7 ? 0.55 : sizeB <= 14 ? 0.65 : 0.7;
  const msPerToken = sizeB <= 3 ? 80 : sizeB <= 7 ? 160 : sizeB <= 14 ? 280 : 480;
  return {
    maxInputSize: Math.floor(OLLAMA_NUM_CTX * 4 * scaleFactor),
    timeoutMs: Math.floor(OLLAMA_NUM_CTX * scaleFactor * msPerToken),
  };
}

export type EnrichmentProviderKind = 'none' | 'ollama' | 'cloud';
export type EnrichmentCapability = 'low' | 'normal' | 'high';
export type LocalAgentConfigKey =
  | 'moduleClassifier'
  | 'generalEnrichment'
  | 'astComponentClassifier'
  | 'flowCandidate'
  | 'repositoryPurpose'
  | 'sqlMigrationSemantics'
  | 'componentPackaging'
  | 'validationTriage'
  | 'semanticPolishing';
export type LocalAgentId =
  | 'module-classifier-agent'
  | 'general-enrichment-agent'
  | 'ast-component-classifier-agent'
  | 'flow-candidate-agent'
  | 'repository-purpose-agent'
  | 'sql-migration-semantics-agent'
  | 'component-packaging-agent'
  | 'validation-triage-agent'
  | 'semantic-polishing-agent';
export type EnrichmentTaskName =
  | 'node-summary'
  | 'edge-label'
  | 'artifact-title'
  | 'component-summary'
  | 'flow-detection'
  | 'semantic-patch'
  | 'contradiction-scan'
  | 'semantic-rewrite'
  | 'review';

export interface AgentorModelsConfig {
  provider: EnrichmentProviderKind;
  capability: EnrichmentCapability;
  model: string;
  ollamaEndpoint: string;
  capabilities: Record<EnrichmentCapability, { defaultModel: string; tasks: EnrichmentTaskName[] }>;
  localAgents: Record<LocalAgentConfigKey, LocalAgentConfig>;
}

export interface EnrichmentModelCatalogItem {
  name: string;
  capabilities: EnrichmentCapability[];
}

export type CloudAgentKind = 'claude' | 'codex';

export interface LocalAgentConfig {
  enabled: boolean;
  provider: EnrichmentProviderKind;
  capability: EnrichmentCapability;
  model: string;
  endpoint: string;
  timeoutMs: number;
  maxInputSize: number;
  minConfidence: number;
  cloudAgent?: CloudAgentKind;
  autoMerge?: boolean;
}

export interface LocalAgentDefinition {
  key: LocalAgentConfigKey;
  agentId: LocalAgentId;
  title: string;
  outputDir: string;
}

export interface LocalAgentRecordBase {
  agentId: LocalAgentId;
  model: string;
  confidence: number;
  evidence: EnrichmentEvidence[];
  warnings: string[];
  targetId?: string;
  applicationId?: string;
}

export interface LocalAgentOutput {
  schemaVersion: '1.0';
  generatedAt: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  agentId: LocalAgentId;
  configKey: LocalAgentConfigKey;
  provider: EnrichmentProviderKind;
  capability: EnrichmentCapability;
  model: string;
  status: 'completed' | 'skipped' | 'failed';
  minConfidence: number;
  records: Array<Record<string, unknown>>;
  slices?: Array<{
    sliceId: string;
    label: string;
    status: 'completed' | 'failed' | 'skipped';
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    recordCount: number;
    error?: string;
  }>;
  validationIssues: string[];
  error?: string;
}

export interface EnrichmentEvidence {
  kind: 'graph-summary' | 'preview' | 'component-map' | 'flow-map' | 'validation' | 'resource';
  ref: string;
  detail: string;
}

export interface EnrichmentCandidate {
  targetId: string;
  kind: EnrichmentTaskName;
  title?: string;
  summary: string;
  model: string;
  confidence: number;
  evidence: EnrichmentEvidence[];
}

export interface EnrichmentTaskResult {
  task: EnrichmentTaskName;
  status: 'completed' | 'skipped' | 'failed';
  model: string;
  promptDigest?: string;
  candidates: EnrichmentCandidate[];
  error?: string;
}

export interface EnrichmentOutput {
  schemaVersion: '1.0';
  generatedAt: string;
  provider: EnrichmentProviderKind;
  capability: EnrichmentCapability;
  model: string;
  projectName: string;
  projectRoot: string;
  tasks: EnrichmentTaskResult[];
  validationIssues: string[];
}

export interface ReviewDossier {
  schemaVersion: '1.0';
  generatedAt: string;
  sourcePath: string;
  graph: {
    title?: string;
    nodeCount: number;
    edgeCount: number;
    nodeTypes: string[];
  };
  preview: {
    applications: string[];
    api: string[];
    app: string[];
    common: string[];
    security: string[];
  };
  components?: {
    applications: Array<{ applicationId: string; componentCount: number; componentNames: string[] }>;
  };
  flows?: {
    triggerCount: number;
    flowCount: number;
    triggerKinds: string[];
    flowNames: string[];
  };
  enrichment: {
    provider: EnrichmentProviderKind;
    capability: EnrichmentCapability;
    model: string;
    candidateCount: number;
    tasks: Array<{
      task: EnrichmentTaskName;
      status: string;
      candidateCount: number;
    }>;
    candidates: EnrichmentCandidate[];
  };
  localAgents?: {
    runs: Array<{
      agentId: LocalAgentId;
      status: string;
      recordCount: number;
      validationIssues: string[];
    }>;
  };
  validationTriage?: {
    groups: Array<Record<string, unknown>>;
  };
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
  reviewFocus: string[];
}

export interface EnrichmentPaths {
  rootDir: string;
  configDir: string;
  configPath: string;
  outputPath: string;
  schemaPath: string;
  reviewDossierPath: string;
}

export interface LocalAgentPaths {
  dir: string;
  outputPath: string;
  schemaPath: string;
  promptsDir: string;
}

export interface EnrichmentInput {
  projectName: string;
  projectRoot: string;
  analysis: {
    endpointCatalog: Array<{ method: string; path: string }>;
    repositoryStructure: {
      topLevelProjects: Array<{ name: string; role: string }>;
      backendSupportModules: Array<{ name: string; role: string }>;
      backendRuntimeLayers: Array<{ name: string; role: string }>;
    };
    appRuntime: {
      applicationEntryPoint?: string;
      externalDependencies: string[];
      runtimeFeatures: string[];
    };
    serviceSummary: {
      executionServices: Array<{ name: string; purpose: string; operations: Array<{ name: string; purpose: string }> }>;
      scheduledJobs: Array<{ name: string; purpose: string; schedule: string }>;
      asyncListeners: Array<{ name: string; purpose: string }>;
    };
    flowSummary: {
      triggers: Array<{ kind: string; name: string; source: string; target: string }>;
      flows: Array<{ name: string; summary: string }>;
    };
  };
  snapshot: {
    topLevelDirectories: string[];
    topLevelFiles: string[];
    moduleRoots: string[];
  };
  codeGraph: CodeKnowledgeGraph;
  preview: {
    applications: string[];
    api: string[];
    app: string[];
    common: string[];
    security: string[];
    notification?: Record<string, unknown>;
  };
  componentMap: Record<string, unknown>;
  flowMap: Record<string, unknown>;
}

interface EnrichmentTaskRequest {
  task: EnrichmentTaskName;
  model: string;
  capability: EnrichmentCapability;
  prompt: string;
}

interface LocalEnrichmentProvider {
  readonly kind: EnrichmentProviderKind;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  runTask(request: EnrichmentTaskRequest): Promise<EnrichmentTaskResult>;
  runJsonPrompt(request: { model: string; prompt: string }): Promise<{ ok: boolean; raw?: string; message?: string }>;
}

const DEFAULT_AGENTOR_MODELS_CONFIG: AgentorModelsConfig = {
  provider: 'none',
  capability: 'normal',
  model: 'qwen2.5-coder:7b',
  ollamaEndpoint: 'http://127.0.0.1:11434',
  capabilities: {
    low: {
      defaultModel: 'qwen2.5-coder:3b',
      tasks: ['node-summary', 'edge-label', 'artifact-title'],
    },
    normal: {
      defaultModel: 'qwen2.5-coder:7b',
      tasks: ['component-summary', 'flow-detection', 'semantic-patch'],
    },
    high: {
      defaultModel: 'qwen2.5-coder:14b',
      tasks: ['contradiction-scan', 'semantic-rewrite', 'review'],
    },
  },
  localAgents: {
    moduleClassifier: {
      enabled: true,
      provider: 'ollama',

      capability: 'normal',
      model: 'qwen2.5-coder:7b',
      endpoint: 'http://127.0.0.1:11434',
      timeoutMs: 1800000,
      maxInputSize: 120000,
      minConfidence: 0.75,
    },
    generalEnrichment: {
      enabled: true,
      provider: 'ollama',

      capability: 'normal',
      model: 'qwen2.5-coder:7b',
      endpoint: 'http://127.0.0.1:11434',
      timeoutMs: 300000,
      maxInputSize: 40000,
      minConfidence: 0.75,
    },
    astComponentClassifier: {
      enabled: true,
      provider: 'ollama',

      capability: 'low',
      model: 'qwen2.5-coder:3b',
      endpoint: 'http://127.0.0.1:11434',
      timeoutMs: 180000,
      maxInputSize: 32000,
      minConfidence: 0.8,
    },
    flowCandidate: {
      enabled: true,
      provider: 'ollama',

      capability: 'normal',
      model: 'qwen2.5-coder:7b',
      endpoint: 'http://127.0.0.1:11434',
      timeoutMs: 300000,
      maxInputSize: 40000,
      minConfidence: 0.8,
    },
    repositoryPurpose: {
      enabled: true,
      provider: 'ollama',

      capability: 'low',
      model: 'qwen2.5-coder:3b',
      endpoint: 'http://127.0.0.1:11434',
      timeoutMs: 120000,
      maxInputSize: 24000,
      minConfidence: 0.75,
    },
    sqlMigrationSemantics: {
      enabled: true,
      provider: 'ollama',

      capability: 'normal',
      model: 'qwen2.5-coder:7b',
      endpoint: 'http://127.0.0.1:11434',
      timeoutMs: 480000,
      maxInputSize: 36000,
      minConfidence: 0.75,
    },
    componentPackaging: {
      enabled: true,
      provider: 'ollama',

      capability: 'normal',
      model: 'qwen2.5-coder:7b',
      endpoint: 'http://127.0.0.1:11434',
      timeoutMs: 300000,
      maxInputSize: 40000,
      minConfidence: 0.8,
    },
    validationTriage: {
      enabled: true,
      provider: 'ollama',

      capability: 'low',
      model: 'qwen2.5-coder:3b',
      endpoint: 'http://127.0.0.1:11434',
      timeoutMs: 120000,
      maxInputSize: 24000,
      minConfidence: 0.7,
    },
    semanticPolishing: {
      enabled: false,
      provider: 'ollama',

      capability: 'normal',
      model: 'qwen2.5-coder:7b',
      endpoint: 'http://127.0.0.1:11434',
      timeoutMs: 300000,
      maxInputSize: 40000,
      minConfidence: 0.85,
    },
  },
};

const LOCAL_AGENT_DEFINITIONS: LocalAgentDefinition[] = [
  { key: 'moduleClassifier', agentId: 'module-classifier-agent', title: 'module-classifier-agent', outputDir: 'module-classifier' },
  { key: 'generalEnrichment', agentId: 'general-enrichment-agent', title: 'general-enrichment-agent', outputDir: 'general' },
  { key: 'astComponentClassifier', agentId: 'ast-component-classifier-agent', title: 'ast-component-classifier-agent', outputDir: 'ast-component-classifier' },
  { key: 'flowCandidate', agentId: 'flow-candidate-agent', title: 'flow-candidate-agent', outputDir: 'flow-candidates' },
  { key: 'repositoryPurpose', agentId: 'repository-purpose-agent', title: 'repository-purpose-agent', outputDir: 'repository-purpose' },
  { key: 'sqlMigrationSemantics', agentId: 'sql-migration-semantics-agent', title: 'sql-migration-semantics-agent', outputDir: 'sql-migration-semantics' },
  { key: 'componentPackaging', agentId: 'component-packaging-agent', title: 'component-packaging-agent', outputDir: 'component-packaging' },
  { key: 'validationTriage', agentId: 'validation-triage-agent', title: 'validation-triage-agent', outputDir: 'validation-triage' },
  { key: 'semanticPolishing', agentId: 'semantic-polishing-agent', title: 'semantic-polishing-agent', outputDir: 'semantic-polishing' },
];

const ENRICHMENT_OUTPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'AI Native Local Enrichment Output',
  type: 'object',
  required: ['schemaVersion', 'generatedAt', 'provider', 'capability', 'model', 'projectName', 'projectRoot', 'tasks', 'validationIssues'],
  properties: {
    schemaVersion: { const: '1.0' },
    generatedAt: { type: 'string' },
    provider: { enum: ['none', 'ollama', 'cloud'] },
    capability: { enum: ['low', 'normal', 'high'] },
    model: { type: 'string' },
    projectName: { type: 'string' },
    projectRoot: { type: 'string' },
    validationIssues: { type: 'array', items: { type: 'string' } },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['task', 'status', 'model', 'candidates'],
        properties: {
          task: { type: 'string' },
          status: { enum: ['completed', 'skipped', 'failed'] },
          model: { type: 'string' },
          promptDigest: { type: 'string' },
          error: { type: 'string' },
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              required: ['targetId', 'kind', 'summary', 'model', 'confidence', 'evidence'],
              properties: {
                targetId: { type: 'string' },
                kind: { type: 'string' },
                title: { type: 'string' },
                summary: { type: 'string' },
                model: { type: 'string' },
                confidence: { type: 'number' },
                evidence: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    required: ['kind', 'ref', 'detail'],
                    properties: {
                      kind: { type: 'string' },
                      ref: { type: 'string' },
                      detail: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export function resolveAgentorPaths(projectRoot: string): EnrichmentPaths {
  const rootDir = join(projectRoot, '.ai-native');
  const configDir = join(rootDir, 'config');
  const enrichmentDir = join(rootDir, 'enrichment');
  return {
    rootDir,
    configDir,
    configPath: join(configDir, 'models.yaml'),
    outputPath: join(enrichmentDir, 'latest.json'),
    schemaPath: join(enrichmentDir, 'enrichment-output.schema.json'),
    reviewDossierPath: join(enrichmentDir, 'review-dossier.json'),
  };
}

export function resolveLocalAgentPaths(projectRoot: string, role: LocalAgentConfigKey): LocalAgentPaths {
  const root = resolveAgentorPaths(projectRoot).rootDir;
  const definition = getLocalAgentDefinition(role);
  const dir = join(root, 'enrichment', definition.outputDir);
  return {
    dir,
    outputPath: join(dir, 'latest.json'),
    schemaPath: join(dir, 'schema.json'),
    promptsDir: join(dir, 'prompts'),
  };
}

export function getDefaultAgentorModelsConfig(): AgentorModelsConfig {
  return JSON.parse(JSON.stringify(DEFAULT_AGENTOR_MODELS_CONFIG)) as AgentorModelsConfig;
}

export function getEnrichmentModelCatalog(config?: Partial<AgentorModelsConfig>): EnrichmentModelCatalogItem[] {
  const normalized = normalizeAgentorModelsConfig(config);
  const catalog = new Map<string, Set<EnrichmentCapability>>();
  for (const modelName of ['qwen2.5-coder:3b', 'qwen2.5-coder:7b', 'qwen2.5-coder:14b', 'qwen3:8b', 'qwen3:14b', 'gemma3:4b', 'gemma3:12b']) {
    if (!catalog.has(modelName)) {
      catalog.set(modelName, new Set<EnrichmentCapability>());
    }
  }
  for (const capability of ['low', 'normal', 'high'] as const) {
    const modelName = normalized.capabilities[capability].defaultModel.trim();
    if (!modelName) continue;
    const existing = catalog.get(modelName) ?? new Set<EnrichmentCapability>();
    existing.add(capability);
    catalog.set(modelName, existing);
  }
  if (normalized.model.trim()) {
    const existing = catalog.get(normalized.model.trim()) ?? new Set<EnrichmentCapability>();
    if (existing.size === 0) {
      existing.add(normalized.capability);
    }
    catalog.set(normalized.model.trim(), existing);
  }
  return [...catalog.entries()]
    .map(([name, capabilities]) => ({
      name,
      capabilities: ([...capabilities].length
        ? [...capabilities]
        : ['low', 'normal', 'high'] as EnrichmentCapability[]).sort((left, right) => ['low', 'normal', 'high'].indexOf(left) - ['low', 'normal', 'high'].indexOf(right)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getLocalAgentDefinitions(): LocalAgentDefinition[] {
  return JSON.parse(JSON.stringify(LOCAL_AGENT_DEFINITIONS)) as LocalAgentDefinition[];
}

export async function listInstalledOllamaModels(
  projectRoot: string,
  endpointOverride?: string,
): Promise<{ ok: boolean; endpoint: string; models: string[]; message: string }> {
  const config = await readAgentorModelsConfig(projectRoot);
  const endpoint = endpointOverride?.trim() || config.ollamaEndpoint;
  try {
    const response = await fetch(new URL('/api/tags', endpoint).toString(), { method: 'GET' });
    if (!response.ok) {
      return { ok: false, endpoint, models: [], message: `Ollama endpoint returned ${response.status}.` };
    }
    const json = await response.json() as { models?: Array<{ name?: string }> };
    const models = (json.models ?? []).map((item) => item.name?.trim() ?? '').filter(Boolean);
    return {
      ok: true,
      endpoint,
      models,
      message: models.length ? `Found ${models.length} installed model(s).` : 'Ollama reachable but no installed models were reported.',
    };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      models: [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function ensureAgentorModelsConfig(projectRoot: string): Promise<EnrichmentPaths> {
  const paths = resolveAgentorPaths(projectRoot);
  await migrateLegacyAgentorArtifacts(projectRoot, paths);
  await mkdir(paths.configDir, { recursive: true });
  await mkdir(dirname(paths.outputPath), { recursive: true });
  if (!existsSync(paths.configPath)) {
    await writeFile(paths.configPath, YAML.stringify(getDefaultAgentorModelsConfig()), 'utf8');
  }
  if (!existsSync(paths.schemaPath)) {
    await writeFile(paths.schemaPath, JSON.stringify(ENRICHMENT_OUTPUT_SCHEMA, null, 2) + '\n', 'utf8');
  }
  return paths;
}

export async function readAgentorModelsConfig(projectRoot: string): Promise<AgentorModelsConfig> {
  const paths = await ensureAgentorModelsConfig(projectRoot);
  try {
    const text = await readFile(paths.configPath, 'utf8');
    const parsed = YAML.parse(text) as Partial<AgentorModelsConfig> | undefined;
    return normalizeAgentorModelsConfig(parsed);
  } catch {
    return getDefaultAgentorModelsConfig();
  }
}

export async function writeAgentorModelsConfig(projectRoot: string, config: Partial<AgentorModelsConfig>): Promise<EnrichmentPaths> {
  const paths = await ensureAgentorModelsConfig(projectRoot);
  const merged = normalizeAgentorModelsConfig(config);
  await writeFile(paths.configPath, YAML.stringify(merged), 'utf8');
  return paths;
}

export function getLocalAgentConfig(config: AgentorModelsConfig, role: LocalAgentConfigKey): LocalAgentConfig {
  const base = config.localAgents[role];
  if (base.provider !== 'ollama') return base;
  const derived = deriveModelLimits(base.model);
  return { ...base, maxInputSize: derived.maxInputSize, timeoutMs: derived.timeoutMs };
}

export async function probeLocalEnrichmentProvider(projectRoot: string, override?: Partial<AgentorModelsConfig>): Promise<{ ok: boolean; message: string; provider: EnrichmentProviderKind }> {
  const config = normalizeAgentorModelsConfig(override ?? await readAgentorModelsConfig(projectRoot));
  const provider = createProvider({
    provider: config.provider,
    model: config.model,
    endpoint: config.ollamaEndpoint,
    timeoutMs: 20000,
  });
  const result = await provider.testConnection();
  return {
    ok: result.ok,
    message: result.message,
    provider: provider.kind,
  };
}

export async function probeLocalAgentProvider(
  projectRoot: string,
  role: LocalAgentConfigKey,
  override?: Partial<LocalAgentConfig>,
): Promise<{ ok: boolean; message: string; provider: EnrichmentProviderKind }> {
  const config = await readAgentorModelsConfig(projectRoot);
  const roleConfig = { ...getLocalAgentConfig(config, role), ...override };
  const provider = createProvider({
    provider: roleConfig.provider,
    model: roleConfig.model,
    endpoint: roleConfig.endpoint,
    timeoutMs: roleConfig.timeoutMs,
  });
  const result = await provider.testConnection();
  return {
    ok: result.ok,
    message: result.message,
    provider: provider.kind,
  };
}

export async function runLocalDiscoveryPrompt(projectRoot: string, prompt: string): Promise<string | undefined> {
  const config = await readAgentorModelsConfig(projectRoot);
  const roleConfig = getLocalAgentConfig(config, 'moduleClassifier');
  if (!roleConfig.enabled || roleConfig.provider !== 'ollama') {
    return undefined;
  }
  try {
    const response = await fetch(new URL('/api/generate', roleConfig.endpoint).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: roleConfig.model,
        prompt: truncatePrompt(prompt, roleConfig.maxInputSize),
        stream: false,
        options: { num_ctx: OLLAMA_NUM_CTX },
      }),
    });
    if (!response.ok) {
      return undefined;
    }
    const json = await response.json() as { response?: string };
    return typeof json.response === 'string' ? json.response.trim() : undefined;
  } catch {
    return undefined;
  }
}

function buildEnrichmentSlices(task: EnrichmentTaskName, input: EnrichmentInput, config: AgentorModelsConfig, maxInputSize: number): Array<{ prompt: string }> {
  const modules = input.snapshot.moduleRoots?.length ? input.snapshot.moduleRoots : [input.projectName];
  const chunkSize = Math.max(1, Math.ceil(modules.length / Math.ceil(modules.length / 3)));
  const chunks: string[][] = [];
  for (let i = 0; i < modules.length; i += chunkSize) {
    chunks.push(modules.slice(i, i + chunkSize));
  }
  const perChunk = Math.max(1, Math.ceil(10 / chunks.length));
  return chunks.map((moduleChunk) => {
    const sliceInput: EnrichmentInput = {
      ...input,
      analysis: {
        ...input.analysis,
        endpointCatalog: input.analysis.endpointCatalog.slice(0, perChunk + 2),
        serviceSummary: {
          ...input.analysis.serviceSummary,
          executionServices: input.analysis.serviceSummary.executionServices.slice(0, perChunk),
          scheduledJobs: input.analysis.serviceSummary.scheduledJobs.slice(0, Math.ceil(perChunk / 2)),
          asyncListeners: input.analysis.serviceSummary.asyncListeners.slice(0, Math.ceil(perChunk / 2)),
        },
      },
      snapshot: { ...input.snapshot, moduleRoots: moduleChunk },
      codeGraph: {
        ...input.codeGraph,
        summary: {
          ...input.codeGraph.summary,
          serviceNames: (input.codeGraph.summary.serviceNames ?? []).slice(0, perChunk * 2),
          controllerNames: (input.codeGraph.summary.controllerNames ?? []).slice(0, perChunk),
          entityNames: (input.codeGraph.summary.entityNames ?? []).slice(0, perChunk),
        },
      },
    };
    return { prompt: truncatePrompt(buildEnrichmentPrompt(task, sliceInput, config), maxInputSize) };
  });
}

export async function runLocalEnrichment(input: EnrichmentInput): Promise<{ output: EnrichmentOutput; paths: EnrichmentPaths }> {
  const paths = await ensureAgentorModelsConfig(input.projectRoot);
  const config = await readAgentorModelsConfig(input.projectRoot);
  const roleConfig = getLocalAgentConfig(config, 'generalEnrichment');
  const provider = createProvider({
    provider: roleConfig.provider,
    model: roleConfig.model,
    endpoint: roleConfig.endpoint,
    timeoutMs: roleConfig.timeoutMs,
  });
  const taskNames = config.capabilities[roleConfig.capability].tasks;
  const tasks: EnrichmentTaskResult[] = [];
  for (const task of taskNames) {
    const slices = buildEnrichmentSlices(task, input, config, roleConfig.maxInputSize);
    const allCandidates: EnrichmentCandidate[] = [];
    let hadFailure = false;
    let lastError: string | undefined;
    for (const slice of slices) {
      const result = await provider.runTask({
        task,
        model: roleConfig.model,
        capability: roleConfig.capability,
        prompt: slice.prompt,
      });
      if (result.status === 'failed') {
        hadFailure = true;
        lastError = result.error;
      } else {
        allCandidates.push(...result.candidates);
      }
    }
    tasks.push({
      task,
      status: allCandidates.length > 0 ? 'completed' : hadFailure ? 'failed' : 'skipped',
      model: roleConfig.model,
      candidates: allCandidates,
      ...(hadFailure && allCandidates.length === 0 ? { error: lastError } : {}),
    });
  }

  const output: EnrichmentOutput = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    provider: roleConfig.provider,
    capability: roleConfig.capability,
    model: roleConfig.model,
    projectName: input.projectName,
    projectRoot: input.projectRoot,
    tasks,
    validationIssues: validateEnrichmentOutput({
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      provider: roleConfig.provider,
      capability: roleConfig.capability,
      model: roleConfig.model,
      projectName: input.projectName,
      projectRoot: input.projectRoot,
      tasks,
      validationIssues: [],
    }),
  };

  await writeFile(paths.outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
  if (!existsSync(paths.schemaPath)) {
    await writeFile(paths.schemaPath, JSON.stringify(ENRICHMENT_OUTPUT_SCHEMA, null, 2) + '\n', 'utf8');
  }
  return { output, paths };
}

export async function runLocalAgentRole(input: {
  projectRoot: string;
  role: LocalAgentConfigKey;
  prompt?: string;
  slices?: Array<{
    id: string;
    label: string;
    prompt: string;
    buildFallbackRecords?: () => Array<Record<string, unknown>>;
  }>;
  buildFallbackRecords?: () => Array<Record<string, unknown>>;
  onSliceProgress?: (event: { role: LocalAgentConfigKey; sliceId: string; label: string; status: 'running' | 'completed' | 'failed' }) => void | Promise<void>;
  /** Cloud AI runner: when provided, called instead of ollama for each slice. Returns raw AI response text. */
  cloudRunner?: (prompt: string) => Promise<string>;
}): Promise<LocalAgentOutput> {
  const runStartedAt = new Date();
  const config = await readAgentorModelsConfig(input.projectRoot);
  const roleConfig = getLocalAgentConfig(config, input.role);
  const definition = getLocalAgentDefinition(input.role);
  const paths = resolveLocalAgentPaths(input.projectRoot, input.role);
  await mkdir(paths.dir, { recursive: true });
  await mkdir(paths.promptsDir, { recursive: true });
  await writeFile(paths.schemaPath, JSON.stringify(buildLocalAgentSchema(definition.agentId), null, 2) + '\n', 'utf8');

  if (!input.cloudRunner && (!roleConfig.enabled || roleConfig.provider === 'none')) {
    const finishedAt = new Date();
    const output: LocalAgentOutput = {
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      startedAt: runStartedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - runStartedAt.getTime(),
      agentId: definition.agentId,
      configKey: input.role,
      provider: roleConfig.provider,
      capability: roleConfig.capability,
      model: roleConfig.model,
      status: 'skipped',
      minConfidence: roleConfig.minConfidence,
      records: [],
      slices: [],
      validationIssues: [],
    };
    await writeFile(paths.outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
    return output;
  }

  const provider = createProvider({
    provider: roleConfig.provider,
    model: roleConfig.model,
    endpoint: roleConfig.endpoint,
    timeoutMs: roleConfig.timeoutMs,
  });
  const slices = input.slices?.length
    ? input.slices
    : input.prompt
      ? [{ id: 'full', label: 'full', prompt: input.prompt, buildFallbackRecords: input.buildFallbackRecords }]
      : [];
  if (!slices.length) {
    const finishedAt = new Date();
    const output: LocalAgentOutput = {
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      startedAt: runStartedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - runStartedAt.getTime(),
      agentId: definition.agentId,
      configKey: input.role,
      provider: roleConfig.provider,
      capability: roleConfig.capability,
      model: roleConfig.model,
      status: 'skipped',
      minConfidence: roleConfig.minConfidence,
      records: [],
      slices: [],
      validationIssues: [],
    };
    await writeFile(paths.outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
    return output;
  }
  try {
    const records: Array<Record<string, unknown>> = [];
    const sliceRuns: LocalAgentOutput['slices'] = [];
    let hadFailure = false;
    for (const slice of slices) {
      const sliceStartedAt = new Date();
      await input.onSliceProgress?.({ role: input.role, sliceId: slice.id, label: slice.label, status: 'running' });
      const truncated = truncatePrompt(slice.prompt, roleConfig.maxInputSize);
      await writeFile(join(paths.promptsDir, `${slice.id}.prompt.md`), truncated, 'utf8');
      let rawResponse: string | undefined;
      let responseOk = true;
      let responseError: string | undefined;
      if (input.cloudRunner) {
        try {
          rawResponse = await input.cloudRunner(truncated);
        } catch (err) {
          responseOk = false;
          responseError = err instanceof Error ? err.message : String(err);
        }
      } else {
        const response = await provider.runJsonPrompt({ model: roleConfig.model, prompt: truncated });
        rawResponse = response.raw;
        responseOk = response.ok;
        responseError = response.message;
      }
      const sliceRecords = parseLocalAgentRecords(rawResponse, definition.agentId, roleConfig.model, slice.buildFallbackRecords?.() ?? []);
      const sliceFinishedAt = new Date();
      records.push(...sliceRecords);
      sliceRuns.push({
        sliceId: slice.id,
        label: slice.label,
        status: responseOk ? 'completed' : 'failed',
        startedAt: sliceStartedAt.toISOString(),
        finishedAt: sliceFinishedAt.toISOString(),
        durationMs: sliceFinishedAt.getTime() - sliceStartedAt.getTime(),
        recordCount: sliceRecords.length,
        error: responseOk ? undefined : responseError,
      });
      await input.onSliceProgress?.({ role: input.role, sliceId: slice.id, label: slice.label, status: responseOk ? 'completed' : 'failed' });
      if (!responseOk) {
        hadFailure = true;
      }
    }
    const finishedAt = new Date();
    const output: LocalAgentOutput = {
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      startedAt: runStartedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - runStartedAt.getTime(),
      agentId: definition.agentId,
      configKey: input.role,
      provider: roleConfig.provider,
      capability: roleConfig.capability,
      model: roleConfig.model,
      status: hadFailure ? 'failed' : 'completed',
      minConfidence: roleConfig.minConfidence,
      records,
      slices: sliceRuns,
      validationIssues: validateLocalAgentOutput(definition.agentId, records),
      error: hadFailure ? sliceRuns.filter((slice) => slice.status === 'failed').map((slice) => `${slice.label}: ${slice.error ?? 'failed'}`).join(' | ') : undefined,
    };
    await writeFile(paths.outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
    return output;
  } catch (error) {
    const finishedAt = new Date();
    const output: LocalAgentOutput = {
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      startedAt: runStartedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - runStartedAt.getTime(),
      agentId: definition.agentId,
      configKey: input.role,
      provider: roleConfig.provider,
      capability: roleConfig.capability,
      model: roleConfig.model,
      status: 'failed',
      minConfidence: roleConfig.minConfidence,
      records: [],
      slices: [],
      validationIssues: [],
      error: error instanceof Error ? error.message : String(error),
    };
    await writeFile(paths.outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
    return output;
  }
}

export async function readLocalAgentOutputs(projectRoot: string): Promise<LocalAgentOutput[]> {
  const outputs: LocalAgentOutput[] = [];
  for (const definition of LOCAL_AGENT_DEFINITIONS) {
    const paths = resolveLocalAgentPaths(projectRoot, definition.key);
    if (!existsSync(paths.outputPath)) continue;
    try {
      const text = await readFile(paths.outputPath, 'utf8');
      const parsed = JSON.parse(text) as LocalAgentOutput;
      outputs.push(parsed);
    } catch {
      // best effort
    }
  }
  return outputs;
}

export async function writeReviewDossier(projectRoot: string, dossier: ReviewDossier): Promise<string> {
  const paths = await ensureAgentorModelsConfig(projectRoot);
  await writeFile(paths.reviewDossierPath, JSON.stringify(dossier, null, 2) + '\n', 'utf8');
  return paths.reviewDossierPath;
}

export function buildReviewDossier(input: {
  sourcePath: string;
  graph: unknown;
  preview: { applications?: string[]; api?: string[]; app?: string[]; common?: string[]; security?: string[] } | undefined;
  componentMap?: unknown;
  flowMap?: unknown;
  enrichment: EnrichmentOutput | undefined;
  localAgentOutputs?: LocalAgentOutput[];
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
}): ReviewDossier {
  const graphObject = input.graph && typeof input.graph === 'object' ? input.graph as Record<string, unknown> : {};
  const nodes = Array.isArray(graphObject.nodes) ? graphObject.nodes : [];
  const edges = Array.isArray(graphObject.edges) ? graphObject.edges : [];
  const nodeTypes = [...new Set(nodes.map((node) => (node && typeof node === 'object' ? String((node as Record<string, unknown>).type ?? '') : '')).filter(Boolean))];
  const candidates = input.enrichment?.tasks.flatMap((task) => task.candidates).slice(0, 24) ?? [];
  const triageRun = input.localAgentOutputs?.find((item) => item.agentId === 'validation-triage-agent');
  const componentMapObject = input.componentMap && typeof input.componentMap === 'object' ? input.componentMap as Record<string, unknown> : {};
  const flowMapObject = input.flowMap && typeof input.flowMap === 'object' ? input.flowMap as Record<string, unknown> : {};
  const componentApplications = Array.isArray(componentMapObject.applications) ? componentMapObject.applications as Array<Record<string, unknown>> : [];
  const triggerItems = Array.isArray(flowMapObject.triggers) ? flowMapObject.triggers as Array<Record<string, unknown>> : [];
  const flowItems = Array.isArray(flowMapObject.flows) ? flowMapObject.flows as Array<Record<string, unknown>> : [];
  const reviewFocus = [
    ...input.validation.issues.slice(0, 12).map((issue) => `${issue.code ?? 'issue'}: ${issue.message ?? ''}`.trim()),
    ...candidates
      .filter((candidate) => candidate.confidence < 0.7)
      .slice(0, 8)
      .map((candidate) => `${candidate.kind} on ${candidate.targetId} (confidence ${candidate.confidence.toFixed(2)})`),
    ...((triageRun?.records ?? []).slice(0, 8).map((record) => `${String(record.category ?? 'triage')}: ${String(record.summary ?? '')}`.trim())),
  ];

  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    sourcePath: input.sourcePath,
    graph: {
      title: typeof (graphObject.metadata as Record<string, unknown> | undefined)?.title === 'string'
        ? String((graphObject.metadata as Record<string, unknown>).title)
        : undefined,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodeTypes,
    },
    preview: {
      applications: input.preview?.applications ?? [],
      api: input.preview?.api?.slice(0, 20) ?? [],
      app: input.preview?.app?.slice(0, 20) ?? [],
      common: input.preview?.common?.slice(0, 20) ?? [],
      security: input.preview?.security?.slice(0, 20) ?? [],
    },
    components: componentApplications.length
      ? {
          applications: componentApplications.map((application) => {
            const componentNames = Array.isArray(application.components)
              ? (application.components as Array<Record<string, unknown>>)
                .map((component) => String(component.componentName ?? component.name ?? '').trim())
                .filter(Boolean)
                .slice(0, 12)
              : [];
            return {
              applicationId: String(application.applicationId ?? application.name ?? '').trim(),
              componentCount: componentNames.length,
              componentNames,
            };
          }).filter((application) => application.applicationId),
        }
      : undefined,
    flows: triggerItems.length || flowItems.length
      ? {
          triggerCount: triggerItems.length,
          flowCount: flowItems.length,
          triggerKinds: [...new Set(triggerItems.map((item) => String(item.kind ?? '').trim()).filter(Boolean))].slice(0, 12),
          flowNames: flowItems.map((item) => String(item.name ?? '').trim()).filter(Boolean).slice(0, 12),
        }
      : undefined,
    enrichment: {
      provider: input.enrichment?.provider ?? 'none',
      capability: input.enrichment?.capability ?? 'normal',
      model: input.enrichment?.model ?? 'none',
      candidateCount: candidates.length,
      tasks: input.enrichment?.tasks.map((task) => ({
        task: task.task,
        status: task.status,
        candidateCount: task.candidates.length,
      })) ?? [],
      candidates,
    },
    localAgents: input.localAgentOutputs?.length
      ? {
          runs: input.localAgentOutputs.map((output) => ({
            agentId: output.agentId,
            status: output.status,
            recordCount: output.records.length,
            validationIssues: output.validationIssues,
          })),
        }
      : undefined,
    validationTriage: triageRun ? { groups: triageRun.records } : undefined,
    validation: input.validation,
    reviewFocus,
  };
}

export function validateEnrichmentOutput(output: EnrichmentOutput): string[] {
  const issues: string[] = [];
  for (const task of output.tasks) {
    for (const [index, candidate] of task.candidates.entries()) {
      if (!candidate.targetId.trim()) issues.push(`${task.task}[${index}]: missing targetId`);
      if (!candidate.model.trim()) issues.push(`${task.task}[${index}]: missing model`);
      if (typeof candidate.confidence !== 'number' || Number.isNaN(candidate.confidence)) {
        issues.push(`${task.task}[${index}]: missing confidence`);
      }
      if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) {
        issues.push(`${task.task}[${index}]: missing evidence`);
      }
    }
  }
  return issues;
}

function normalizeAgentorModelsConfig(config?: Partial<AgentorModelsConfig>): AgentorModelsConfig {
  const defaults = getDefaultAgentorModelsConfig();
  const provider = config?.provider === 'ollama' || config?.provider === 'cloud' ? config.provider : 'none';
  const capability = config?.capability === 'low' || config?.capability === 'high' ? config.capability : 'normal';
  const capabilities = {
    low: config?.capabilities?.low ?? defaults.capabilities.low,
    normal: config?.capabilities?.normal ?? defaults.capabilities.normal,
    high: config?.capabilities?.high ?? defaults.capabilities.high,
  };
  const model = typeof config?.model === 'string' && config.model.trim()
    ? config.model.trim()
    : capabilities[capability].defaultModel;
  return {
    provider,
    capability,
    model,
    ollamaEndpoint: typeof config?.ollamaEndpoint === 'string' && config.ollamaEndpoint.trim()
      ? config.ollamaEndpoint.trim()
      : defaults.ollamaEndpoint,
    capabilities,
    localAgents: normalizeLocalAgentsConfig(config?.localAgents, defaults.localAgents),
  };
}

function normalizeLocalAgentsConfig(
  localAgents: Partial<Record<LocalAgentConfigKey, Partial<LocalAgentConfig>>> | undefined,
  defaults: Record<LocalAgentConfigKey, LocalAgentConfig>,
): Record<LocalAgentConfigKey, LocalAgentConfig> {
  const result = {} as Record<LocalAgentConfigKey, LocalAgentConfig>;
  for (const definition of LOCAL_AGENT_DEFINITIONS) {
    const base = defaults[definition.key];
    const override = localAgents?.[definition.key];
    result[definition.key] = {
      enabled: typeof override?.enabled === 'boolean' ? override.enabled : base.enabled,
      provider: override?.provider === 'ollama' || override?.provider === 'cloud' ? override.provider : (override?.provider === 'none' ? 'none' : base.provider),

      capability: override?.capability === 'low' || override?.capability === 'high' ? override.capability : (override?.capability === 'normal' ? 'normal' : base.capability),
      model: typeof override?.model === 'string' && override.model.trim() ? override.model.trim() : base.model,
      endpoint: typeof override?.endpoint === 'string' && override.endpoint.trim() ? override.endpoint.trim() : base.endpoint,
      timeoutMs: typeof override?.timeoutMs === 'number' && override.timeoutMs > 0 ? override.timeoutMs : base.timeoutMs,
      maxInputSize: typeof override?.maxInputSize === 'number' && override.maxInputSize > 0 ? override.maxInputSize : base.maxInputSize,
      minConfidence: typeof override?.minConfidence === 'number' ? override.minConfidence : base.minConfidence,
    };
  }
  return result;
}

async function migrateLegacyAgentorArtifacts(projectRoot: string, nextPaths: EnrichmentPaths): Promise<void> {
  const legacyRoot = join(projectRoot, '.agentor');
  if (!existsSync(legacyRoot)) {
    return;
  }
  const legacyPaths = {
    configPath: join(legacyRoot, 'config', 'models.yaml'),
    outputPath: join(legacyRoot, 'enrichment', 'latest.json'),
    schemaPath: join(legacyRoot, 'enrichment', 'enrichment-output.schema.json'),
    reviewDossierPath: join(legacyRoot, 'enrichment', 'review-dossier.json'),
  };

  await mkdir(nextPaths.configDir, { recursive: true });
  await mkdir(dirname(nextPaths.outputPath), { recursive: true });

  await copyIfMissing(legacyPaths.configPath, nextPaths.configPath);
  await copyIfMissing(legacyPaths.outputPath, nextPaths.outputPath);
  await copyIfMissing(legacyPaths.schemaPath, nextPaths.schemaPath);
  await copyIfMissing(legacyPaths.reviewDossierPath, nextPaths.reviewDossierPath);
}

async function copyIfMissing(fromPath: string, toPath: string): Promise<void> {
  if (!existsSync(fromPath) || existsSync(toPath)) {
    return;
  }
  const text = await readFile(fromPath, 'utf8');
  await writeFile(toPath, text, 'utf8');
}

function getLocalAgentDefinition(role: LocalAgentConfigKey): LocalAgentDefinition {
  const definition = LOCAL_AGENT_DEFINITIONS.find((item) => item.key === role);
  if (!definition) {
    throw new Error(`Unknown local agent role: ${role}`);
  }
  return definition;
}

function createProvider(config: { provider: EnrichmentProviderKind; model: string; endpoint: string; timeoutMs: number }): LocalEnrichmentProvider {
  if (config.provider === 'ollama') {
    return new OllamaEnrichmentProvider(config);
  }
  return new NoopEnrichmentProvider(config.provider, config.model);
}

function buildEnrichmentPrompt(task: EnrichmentTaskName, input: EnrichmentInput, config: AgentorModelsConfig): string {
  const digest = {
    projectName: input.projectName,
    endpoints: input.analysis.endpointCatalog.slice(0, 12).map((entry) => `${entry.method} ${entry.path}`),
    services: input.analysis.serviceSummary.executionServices.slice(0, 10).map((service) => ({
      name: service.name,
      purpose: service.purpose,
      operations: service.operations.slice(0, 3),
    })),
    jobs: input.analysis.serviceSummary.scheduledJobs?.slice(0, 8),
    listeners: input.analysis.serviceSummary.asyncListeners?.slice(0, 8),
    serviceNames: input.codeGraph.summary.serviceNames?.slice(0, 20),
    controllerNames: input.codeGraph.summary.controllerNames?.slice(0, 16),
    entityNames: input.codeGraph.summary.entityNames?.slice(0, 16),
    externalSystems: input.codeGraph.summary.externalSystems?.slice(0, 8),
    moduleRoots: input.snapshot.moduleRoots?.slice(0, 8),
  };

  return [
    'You are a local semantic enrichment model.',
    'Do not replace the deterministic graph. Only emit candidate semantic metadata.',
    'Return strict JSON with this shape: {"candidates":[{"targetId":"...","kind":"...","title":"...","summary":"...","model":"...","confidence":0.0,"evidence":[{"kind":"graph-summary","ref":"...","detail":"..."}]}]}',
    'Each candidate must include targetId, model, confidence, and evidence.',
    `Capability: ${config.capability}`,
    `Task: ${task}`,
    `Model: ${config.model}`,
    '',
    'Deterministic digest:',
    JSON.stringify(digest, null, 2),
    '',
    'Emit at most 8 candidates.',
  ].join('\n');
}

class NoopEnrichmentProvider implements LocalEnrichmentProvider {
  constructor(
    public readonly kind: EnrichmentProviderKind,
    private readonly model: string,
  ) {}

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (this.kind === 'cloud') {
      return { ok: false, message: 'Cloud enrichment is not implemented in the local enrichment layer yet.' };
    }
    return { ok: true, message: 'Deterministic-only mode; local enrichment disabled.' };
  }

  async runTask(request: EnrichmentTaskRequest): Promise<EnrichmentTaskResult> {
    return {
      task: request.task,
      status: 'skipped',
      model: this.model,
      candidates: [],
    };
  }

  async runJsonPrompt(): Promise<{ ok: boolean; raw?: string; message?: string }> {
    if (this.kind === 'cloud') {
      return { ok: false, message: 'Cloud local-agent execution is not implemented yet.' };
    }
    return { ok: false, message: 'Local agent disabled.' };
  }
}

class OllamaEnrichmentProvider implements LocalEnrichmentProvider {
  readonly kind: EnrichmentProviderKind = 'ollama';

  constructor(private readonly config: { provider: EnrichmentProviderKind; model: string; endpoint: string; timeoutMs: number }) {}

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await fetch(new URL('/api/tags', this.config.endpoint).toString(), {
        method: 'GET',
      });
      if (!response.ok) {
        return { ok: false, message: `Ollama endpoint returned ${response.status}.` };
      }
      const json = await response.json() as { models?: Array<{ name?: string }> };
      const names = (json.models ?? []).map((item) => item.name).filter(Boolean);
      return {
        ok: true,
        message: names.length ? `Ollama reachable. Models: ${names.slice(0, 8).join(', ')}` : 'Ollama reachable.',
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async runTask(request: EnrichmentTaskRequest): Promise<EnrichmentTaskResult> {
    try {
      const response = await fetch(new URL('/api/generate', this.config.endpoint).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          stream: false,
          format: 'json',
          options: { num_ctx: OLLAMA_NUM_CTX },
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!response.ok) {
        return {
          task: request.task,
          status: 'failed',
          model: request.model,
          candidates: [],
          error: `Ollama returned ${response.status}.`,
        };
      }
      const json = await response.json() as { response?: string };
      const parsed = parseOllamaCandidates(json.response, request.task, request.model);
      return {
        task: request.task,
        status: 'completed',
        model: request.model,
        promptDigest: request.prompt.slice(0, 240),
        candidates: parsed,
      };
    } catch (error) {
      return {
        task: request.task,
        status: 'failed',
        model: request.model,
        candidates: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async runJsonPrompt(request: { model: string; prompt: string }): Promise<{ ok: boolean; raw?: string; message?: string }> {
    try {
      const response = await fetch(new URL('/api/generate', this.config.endpoint).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          stream: false,
          format: 'json',
          options: { num_ctx: OLLAMA_NUM_CTX },
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!response.ok) {
        return { ok: false, message: `Ollama returned ${response.status}.` };
      }
      const json = await response.json() as { response?: string };
      return { ok: true, raw: json.response ?? '' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
}

function truncatePrompt(prompt: string, maxInputSize: number): string {
  return prompt.length > maxInputSize ? `${prompt.slice(0, maxInputSize)}\n[truncated]` : prompt;
}

function buildLocalAgentSchema(agentId: LocalAgentId): Record<string, unknown> {
  const requiredByAgent: Record<LocalAgentId, string[]> = {
    'module-classifier-agent': ['agentId', 'targetId', 'model', 'confidence', 'evidence', 'warnings'],
    'general-enrichment-agent': ['agentId', 'targetId', 'model', 'confidence', 'evidence', 'warnings'],
    'ast-component-classifier-agent': ['agentId', 'targetId', 'candidateRole', 'model', 'confidence', 'evidence', 'warnings'],
    'flow-candidate-agent': ['agentId', 'applicationId', 'flowId', 'flowName', 'model', 'confidence', 'evidence', 'warnings'],
    'repository-purpose-agent': ['agentId', 'targetId', 'repositoryName', 'model', 'confidence', 'evidence', 'warnings'],
    'sql-migration-semantics-agent': ['agentId', 'targetId', 'migrationName', 'model', 'confidence', 'evidence', 'warnings'],
    'component-packaging-agent': ['agentId', 'applicationId', 'componentId', 'componentName', 'model', 'confidence', 'evidence', 'warnings'],
    'validation-triage-agent': ['agentId', 'applicationId', 'model', 'confidence', 'evidence', 'warnings'],
    'semantic-polishing-agent': ['agentId', 'targetFile', 'patchType', 'model', 'confidence', 'evidence', 'warnings'],
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `${agentId} output`,
    type: 'object',
    required: ['schemaVersion', 'generatedAt', 'startedAt', 'finishedAt', 'durationMs', 'agentId', 'configKey', 'provider', 'capability', 'model', 'status', 'records', 'validationIssues'],
    properties: {
      schemaVersion: { const: '1.0' },
      generatedAt: { type: 'string' },
      startedAt: { type: 'string' },
      finishedAt: { type: 'string' },
      durationMs: { type: 'number' },
      agentId: { const: agentId },
      records: {
        type: 'array',
        items: {
          type: 'object',
          required: requiredByAgent[agentId],
        },
      },
      slices: {
        type: 'array',
        items: {
          type: 'object',
          required: ['sliceId', 'label', 'status', 'startedAt', 'finishedAt', 'durationMs', 'recordCount'],
        },
      },
    },
  };
}

function parseLocalAgentRecords(
  raw: string | undefined,
  agentId: LocalAgentId,
  model: string,
  fallbackRecords: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (!raw?.trim()) {
    return fallbackRecords;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const candidateArray = Array.isArray(parsed.records)
      ? parsed.records
      : Array.isArray(parsed.candidates)
        ? parsed.candidates
        : Array.isArray(parsed.flows)
          ? parsed.flows
          : Array.isArray(parsed.components)
            ? parsed.components
            : Array.isArray(parsed.triageGroups)
              ? parsed.triageGroups
              : [];
    return (candidateArray as Array<Record<string, unknown>>).map((record) => ({
      ...record,
      agentId,
      model: typeof record.model === 'string' && record.model.trim() ? record.model : model,
      confidence: typeof record.confidence === 'number' ? record.confidence : 0.5,
      evidence: Array.isArray(record.evidence) ? record.evidence : [],
      warnings: Array.isArray(record.warnings) ? record.warnings : [],
    }));
  } catch {
    return fallbackRecords;
  }
}

function validateLocalAgentOutput(agentId: LocalAgentId, records: Array<Record<string, unknown>>): string[] {
  const issues: string[] = [];
  for (const [index, record] of records.entries()) {
    if (!String(record.model ?? '').trim()) issues.push(`${agentId}[${index}]: missing model`);
    if (typeof record.confidence !== 'number' || Number.isNaN(record.confidence)) issues.push(`${agentId}[${index}]: missing confidence`);
    if (!Array.isArray(record.evidence) || record.evidence.length === 0) issues.push(`${agentId}[${index}]: missing evidence`);
    if (!Array.isArray(record.warnings)) issues.push(`${agentId}[${index}]: missing warnings`);
    if (!String(record.targetId ?? record.applicationId ?? '').trim()) {
      issues.push(`${agentId}[${index}]: missing targetId/applicationId`);
    }
  }
  return issues;
}

function parseOllamaCandidates(raw: string | undefined, task: EnrichmentTaskName, model: string): EnrichmentCandidate[] {
  if (!raw?.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { candidates?: Array<Partial<EnrichmentCandidate>> } | Array<Partial<EnrichmentCandidate>>;
    const candidates = Array.isArray(parsed) ? parsed : Array.isArray(parsed.candidates) ? parsed.candidates : [];
    return candidates
      .map((candidate) => ({
        targetId: String(candidate.targetId ?? '').trim(),
        kind: (candidate.kind as EnrichmentTaskName | undefined) ?? task,
        title: typeof candidate.title === 'string' ? candidate.title.trim() : undefined,
        summary: String(candidate.summary ?? '').trim(),
        model: typeof candidate.model === 'string' && candidate.model.trim() ? candidate.model.trim() : model,
        confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0.5,
        evidence: Array.isArray(candidate.evidence)
          ? candidate.evidence
              .map((item) => ({
                kind: normalizeEvidenceKind(item?.kind),
                ref: String(item?.ref ?? '').trim(),
                detail: String(item?.detail ?? '').trim(),
              }))
              .filter((item) => item.ref && item.detail)
          : [],
      }))
      .filter((candidate) => candidate.targetId && candidate.summary);
  } catch {
    return [];
  }
}

function normalizeEvidenceKind(value: unknown): EnrichmentEvidence['kind'] {
  switch (value) {
    case 'preview':
    case 'component-map':
    case 'flow-map':
    case 'validation':
    case 'resource':
      return value;
    default:
      return 'graph-summary';
  }
}
