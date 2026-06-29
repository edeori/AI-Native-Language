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
  runJqassistantScan: 'aiNative.runJqassistantScan',
  runAiEnrichment: 'aiNative.runAiEnrichment',
  openMarkdownArtifactPreview: 'aiNative.openMarkdownArtifactPreview',
  openGraphPreview: 'aiNative.openGraphPreview',
  openArtifactsFolder: 'aiNative.openArtifactsFolder',
  showMcpStatus: 'aiNative.showMcpStatus',
  importSourceProject: 'aiNative.importSourceProject',
  importDocuments: 'aiNative.importDocuments',
  showEndpoints: 'aiNative.showEndpoints',
  runFlowExtraction: 'aiNative.runFlowExtraction',
  runDocCodeAlignment: 'aiNative.runDocCodeAlignment',
  runImplementation: 'aiNative.runImplementation',
  openImplementationReport: 'aiNative.openImplementationReport',
  openDevelopmentView: 'aiNative.openDevelopmentView',
  queueImplementation: 'aiNative.queueImplementation',
  runQueue: 'aiNative.runQueue',
  deleteTask: 'aiNative.deleteTask',
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
  documentImport: 'document-import',
} as const;
