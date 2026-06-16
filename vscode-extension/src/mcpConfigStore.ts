import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export interface MpcConfigFile {
  semanticCoreUrl?: string;
  validatorUrl?: string;
  compilerUrl?: string;
  artifactRoot?: string;
  javaBasePackage?: string;
  reviewProvider?: 'codex' | 'claude';
  reviewMode?: 'local' | 'cli' | 'endpoint' | 'command' | 'prompt-file';
  reviewModel?: string;
  reviewEndpoint?: string;
  reviewCommandId?: string;
  reviewCommandArgsJson?: string;
  reviewPromptFileName?: string;
}

let configStorageRoot: vscode.Uri | undefined;

export function initializeMcpConfigStorage(storageUri: vscode.Uri): void {
  configStorageRoot = storageUri;
}

export function resolveMcpConfigPath(): string | undefined {
  if (!configStorageRoot) {
    return undefined;
  }
  return path.join(configStorageRoot.fsPath, 'mcp-config.json');
}

export function resolveMcpConfigUri(): vscode.Uri | undefined {
  const configPath = resolveMcpConfigPath();
  return configPath ? vscode.Uri.file(configPath) : undefined;
}

export function readMcpConfigFile(): MpcConfigFile {
  const configPath = resolveMcpConfigPath();
  if (!configPath || !fs.existsSync(configPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as MpcConfigFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeMcpConfigFile(values: MpcConfigFile): Promise<void> {
  const configPath = resolveMcpConfigPath();
  if (!configPath) {
    return;
  }

  const folder = path.dirname(configPath);
  await fs.promises.mkdir(folder, { recursive: true });
  await fs.promises.writeFile(configPath, JSON.stringify(values, null, 2), 'utf8');
}

export function getDefaultMcpConfigFile(): MpcConfigFile {
  return {
    semanticCoreUrl: 'http://10.9.0.2:3001/mcp',
    validatorUrl: 'http://10.9.0.2:3002/mcp',
    compilerUrl: 'http://10.9.0.2:3003/mcp',
    artifactRoot: '.ai-native',
    javaBasePackage: 'com.example.generated',
    reviewProvider: 'codex',
    reviewMode: 'cli',
    reviewModel: 'gpt-5.5',
    reviewEndpoint: '',
    reviewCommandId: '',
    reviewCommandArgsJson: '{"prompt":"${prompt}"}',
    reviewPromptFileName: '.github/prompts/ai-native-review.prompt.md',
  };
}

export async function ensureMcpConfigFile(): Promise<vscode.Uri | undefined> {
  const configPath = resolveMcpConfigPath();
  if (!configPath) {
    return undefined;
  }

  await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
  if (!fs.existsSync(configPath)) {
    await fs.promises.writeFile(
      configPath,
      JSON.stringify(
        getDefaultMcpConfigFile(),
        null,
        2,
      ),
      'utf8',
    );
  }

  return vscode.Uri.file(configPath);
}
