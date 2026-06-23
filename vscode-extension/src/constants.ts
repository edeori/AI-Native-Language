export const extensionName = 'ai-native-semantic-workflow';

export const commandIds = {
  openDashboard: 'aiNative.openDashboard',
  openConfiguration: 'aiNative.openConfiguration',
  openReconRuns: 'aiNative.openReconRuns',
  openTutorial: 'aiNative.openTutorial',
  refreshAll: 'aiNative.refreshAll',
  createSemanticSourceTemplate: 'aiNative.createSemanticSourceTemplate',
  validateActiveSemanticMarkdown: 'aiNative.validateActiveSemanticMarkdown',
  generateCanonicalGraph: 'aiNative.generateCanonicalGraph',
  openMarkdownArtifactPreview: 'aiNative.openMarkdownArtifactPreview',
  openGraphPreview: 'aiNative.openGraphPreview',
  generateSpringBootSkeleton: 'aiNative.generateSpringBootSkeleton',
  openArtifactsFolder: 'aiNative.openArtifactsFolder',
  showMcpStatus: 'aiNative.showMcpStatus',
  importSourceProject: 'aiNative.importSourceProject',
  resumeRecon: 'aiNative.resumeRecon',
} as const;

export const viewIds = {
  validation: 'aiNativeValidation',
  review: 'aiNativeReviewArtifacts',
  semantic: 'aiNativeSemanticArtifacts',
  graph: 'aiNativeGraph',
  databaseSchema: 'aiNativeDatabaseSchema',
  settings: 'aiNativeMcpHub',
  recon: 'aiNativeRecon',
} as const;

export const serverNames = {
  semanticCore: 'semantic-core',
  validator: 'validator',
  compiler: 'compiler',
  javaParser: 'java-parser',
  jqassistant: 'jqassistant',
  deterministicGraph: 'deterministic-graph',
} as const;
