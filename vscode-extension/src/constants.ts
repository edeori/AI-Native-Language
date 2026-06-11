export const extensionName = 'ai-native-semantic-workflow';

export const commandIds = {
  openDashboard: 'aiNative.openDashboard',
  openConfiguration: 'aiNative.openConfiguration',
  openTutorial: 'aiNative.openTutorial',
  refreshAll: 'aiNative.refreshAll',
  createSemanticSourceTemplate: 'aiNative.createSemanticSourceTemplate',
  validateActiveSemanticMarkdown: 'aiNative.validateActiveSemanticMarkdown',
  generateCanonicalGraph: 'aiNative.generateCanonicalGraph',
  openGraphPreview: 'aiNative.openGraphPreview',
  generateSpringBootSkeleton: 'aiNative.generateSpringBootSkeleton',
  openArtifactsFolder: 'aiNative.openArtifactsFolder',
  showMcpStatus: 'aiNative.showMcpStatus',
  importSourceProject: 'aiNative.importSourceProject',
} as const;

export const viewIds = {
  inputs: 'aiNativeInputs',
  model: 'aiNativeModel',
  generate: 'aiNativeGenerate',
  review: 'aiNativeReview',
  mcp: 'aiNativeMcpHub',
} as const;

export const serverNames = {
  semanticCore: 'semantic-core',
  validator: 'validator',
  compiler: 'compiler',
} as const;
