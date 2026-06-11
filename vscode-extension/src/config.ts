import * as vscode from 'vscode';
import { readMcpConfigFile } from './mcpConfigStore.js';

export interface ExtensionConfig {
  semanticCoreUrl: string;
  validatorUrl: string;
  compilerUrl: string;
  artifactRoot: string;
  javaBasePackage: string;
  autoValidateOnSave: boolean;
}

export function getConfig(): ExtensionConfig {
  const fileConfig = readMcpConfigFile();
  const configuration = vscode.workspace.getConfiguration('aiNative');
  return {
    semanticCoreUrl: fileConfig.semanticCoreUrl ?? configuration.get<string>('mcp.semanticCoreUrl', 'http://localhost:3001/mcp'),
    validatorUrl: fileConfig.validatorUrl ?? configuration.get<string>('mcp.validatorUrl', 'http://localhost:3002/mcp'),
    compilerUrl: fileConfig.compilerUrl ?? configuration.get<string>('mcp.compilerUrl', 'http://localhost:3003/mcp'),
    artifactRoot: fileConfig.artifactRoot ?? configuration.get<string>('artifactRoot', '.ai-native'),
    javaBasePackage: fileConfig.javaBasePackage ?? configuration.get<string>('java.basePackage', 'com.example.generated'),
    autoValidateOnSave: fileConfig.autoValidateOnSave ?? configuration.get<boolean>('autoValidateOnSave', false),
  };
}
