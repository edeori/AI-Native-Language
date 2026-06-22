import * as vscode from 'vscode';
import { readMcpConfigFile } from './mcpConfigStore.js';

export interface ExtensionConfig {
  semanticCoreUrl: string;
  validatorUrl: string;
  compilerUrl: string;
  javaParserUrl: string;
  artifactRoot: string;
  javaBasePackage: string;
  reviewProvider: 'codex' | 'claude';
  reviewMode: 'local' | 'cli' | 'endpoint' | 'command' | 'prompt-file';
  reviewModel: string;
  reviewEndpoint: string;
  reviewCommandId: string;
  reviewCommandArgsJson: string;
  reviewPromptFileName: string;
}

export function getConfig(): ExtensionConfig {
  const fileConfig = readMcpConfigFile();
  const configuration = vscode.workspace.getConfiguration('aiNative');
  const reviewProvider = normalizeReviewProvider(
    fileConfig.reviewProvider ?? configuration.get<string>('review.provider', 'codex'),
  );
  const reviewMode = fileConfig.reviewMode ?? defaultReviewMode(reviewProvider);
  const reviewModel = fileConfig.reviewModel ?? defaultReviewModel(reviewProvider);
  return {
    semanticCoreUrl: fileConfig.semanticCoreUrl ?? configuration.get<string>('mcp.semanticCoreUrl', 'http://localhost:3001/mcp'),
    validatorUrl: fileConfig.validatorUrl ?? configuration.get<string>('mcp.validatorUrl', 'http://localhost:3002/mcp'),
    compilerUrl: fileConfig.compilerUrl ?? configuration.get<string>('mcp.compilerUrl', 'http://localhost:3003/mcp'),
    javaParserUrl: fileConfig.javaParserUrl ?? configuration.get<string>('mcp.javaParserUrl', 'http://localhost:3004/mcp'),
    artifactRoot: fileConfig.artifactRoot ?? configuration.get<string>('artifactRoot', '.ai-native'),
    javaBasePackage: fileConfig.javaBasePackage ?? configuration.get<string>('java.basePackage', 'com.example.generated'),
    reviewProvider,
    reviewMode: reviewMode === 'local' || reviewMode === 'prompt-file' ? 'cli' : reviewMode,
    reviewModel: normalizeReviewModel(reviewProvider, reviewModel),
    reviewEndpoint: fileConfig.reviewEndpoint ?? configuration.get<string>('review.endpoint', ''),
    reviewCommandId: fileConfig.reviewCommandId ?? configuration.get<string>('review.commandId', ''),
    reviewCommandArgsJson: fileConfig.reviewCommandArgsJson ?? configuration.get<string>('review.commandArgsJson', '{"prompt":"${prompt}"}'),
    reviewPromptFileName: fileConfig.reviewPromptFileName ?? configuration.get<string>('review.promptFileName', '.github/prompts/ai-native-review.prompt.md'),
  };
}

export function defaultReviewMode(reviewProvider: ExtensionConfig['reviewProvider']): ExtensionConfig['reviewMode'] {
  return reviewProvider === 'codex' || reviewProvider === 'claude' ? 'cli' : 'local';
}

export function defaultReviewModel(reviewProvider: ExtensionConfig['reviewProvider']): string {
  switch (reviewProvider) {
    case 'codex':
      return 'gpt-5.5';
    case 'claude':
      return 'sonnet';
  }
}

function normalizeReviewProvider(value: string | undefined): ExtensionConfig['reviewProvider'] {
  return value === 'claude' ? 'claude' : 'codex';
}

function normalizeReviewModel(reviewProvider: ExtensionConfig['reviewProvider'], reviewModel: string): string {
  if (reviewProvider === 'codex' && isPlaceholderReviewModel(reviewModel)) {
    return 'gpt-5.5';
  }
  if (reviewProvider === 'claude' && isPlaceholderReviewModel(reviewModel)) {
    return 'sonnet';
  }
  return reviewModel;
}

function isPlaceholderReviewModel(model: string): boolean {
  return model === 'local-rule-based' || model.endsWith('-default') || !model.trim();
}
