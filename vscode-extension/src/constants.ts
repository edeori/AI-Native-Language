export const extensionName = 'ai-native-semantic-workflow';

export const commandIds = {
  openDashboard: 'aiNative.openDashboard',
  openConfiguration: 'aiNative.openConfiguration',
  openTutorial: 'aiNative.openTutorial',
  refreshAll: 'aiNative.refreshAll',
  validateActiveSemanticMarkdown: 'aiNative.validateActiveSemanticMarkdown',
  generateCanonicalGraph: 'aiNative.generateCanonicalGraph',
  generateSpringBootSkeleton: 'aiNative.generateSpringBootSkeleton',
  openArtifactsFolder: 'aiNative.openArtifactsFolder',
  showMcpStatus: 'aiNative.showMcpStatus',
} as const;

export const viewIds = {
  workflow: 'aiNativeWorkflow',
  artifacts: 'aiNativeArtifacts',
  tutorials: 'aiNativeTutorials',
} as const;

export const serverNames = {
  semanticCore: 'semantic-core',
  validator: 'validator',
  compiler: 'compiler',
} as const;
