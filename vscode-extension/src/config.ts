import * as vscode from 'vscode';

export interface ExtensionConfig {
  semanticCoreUrl: string;
  validatorUrl: string;
  compilerUrl: string;
  artifactRoot: string;
  javaBasePackage: string;
  autoValidateOnSave: boolean;
}

export function getConfig(): ExtensionConfig {
  const configuration = vscode.workspace.getConfiguration('aiNative');
  return {
    semanticCoreUrl: configuration.get<string>('mcp.semanticCoreUrl', 'http://localhost:3001/mcp'),
    validatorUrl: configuration.get<string>('mcp.validatorUrl', 'http://localhost:3002/mcp'),
    compilerUrl: configuration.get<string>('mcp.compilerUrl', 'http://localhost:3003/mcp'),
    artifactRoot: configuration.get<string>('artifactRoot', '.ai-native'),
    javaBasePackage: configuration.get<string>('java.basePackage', 'com.example.generated'),
    autoValidateOnSave: configuration.get<boolean>('autoValidateOnSave', false),
  };
}
