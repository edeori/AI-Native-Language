import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type * as vscode from 'vscode';
import { getConfig } from './config.js';
import { serverNames } from './constants.js';

export type RemoteServerId = keyof typeof serverNames;

export interface ServerConnectionStatus {
  server: RemoteServerId;
  url: string;
  connected: boolean;
  tools?: number;
  error?: string;
}

export interface ToolCallResult {
  raw: unknown;
  json: unknown;
  text: string;
}

interface ConnectedClient {
  client: Client;
  transport: StreamableHTTPClientTransport;
  url: string;
}

export class McpRegistry {
  private readonly clients = new Map<RemoteServerId, ConnectedClient>();

  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  async pingAll(): Promise<Array<ServerConnectionStatus>> {
    const results: Array<ServerConnectionStatus> = [];
    for (const server of Object.keys(serverNames) as RemoteServerId[]) {
      const url = this.resolveUrl(server);
      try {
        const connected = await this.ensureClient(server);
        const tools = await connected.client.listTools();
        results.push({ server, url, connected: true, tools: tools.tools.length });
      } catch (error) {
        results.push({ server, url, connected: false, error: stringifyError(error) });
      }
    }
    return results;
  }

  async callTool(server: RemoteServerId, toolName: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const connected = await this.ensureClient(server);
    const response = (await connected.client.callTool({ name: toolName, arguments: args })) as {
      content: Array<{ type: 'text'; text: string }>;
    };
    const text = response.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('\n');
    return {
      raw: response,
      text,
      json: safeJsonParse(text),
    };
  }

  async getServerStatus(): Promise<Array<{ server: RemoteServerId; url: string; connected: boolean }>> {
    const config = getConfig();
    return [
      { server: 'semanticCore', url: config.semanticCoreUrl, connected: this.clients.has('semanticCore') },
      { server: 'validator', url: config.validatorUrl, connected: this.clients.has('validator') },
      { server: 'compiler', url: config.compilerUrl, connected: this.clients.has('compiler') },
      { server: 'javaParser', url: config.javaParserUrl, connected: this.clients.has('javaParser') },
    ];
  }

  async dispose(): Promise<void> {
    for (const connected of this.clients.values()) {
      try {
        await connected.transport.close?.();
      } catch {
        // ignore shutdown noise
      }
    }
    this.clients.clear();
  }

  private async ensureClient(server: RemoteServerId): Promise<ConnectedClient> {
    const config = getConfig();
    const url = this.resolveUrl(server, config);
    const existing = this.clients.get(server);
    if (existing && existing.url === url) {
      return existing;
    }

    if (existing) {
      try {
        await existing.transport.close?.();
      } catch {
        // ignore close noise on reconnect
      }
      this.clients.delete(server);
    }

    const client = new Client(
      {
        name: 'ai-native-vscode-extension',
        version: '0.1.0',
      },
      {
        capabilities: {},
      },
    );
    const transport = new StreamableHTTPClientTransport(new URL(url));
    await client.connect(transport);
    const connected = { client, transport, url };
    this.clients.set(server, connected);
    return connected;
  }

  private resolveUrl(server: RemoteServerId, config = getConfig()): string {
    switch (server) {
      case 'semanticCore':
        return config.semanticCoreUrl;
      case 'validator':
        return config.validatorUrl;
      case 'compiler':
        return config.compilerUrl;
      case 'javaParser':
        return config.javaParserUrl;
    }
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
