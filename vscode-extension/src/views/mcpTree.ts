import * as vscode from 'vscode';
import { commandIds } from '../constants.js';
import type { McpRegistry } from '../mcpRegistry.js';

export class McpTreeDataProvider implements vscode.TreeDataProvider<McpTreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly registry: Pick<McpRegistry, 'pingAll'>) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: McpTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: McpTreeItem): Promise<McpTreeItem[]> {
    return [
      new McpTreeItem('Configure MCP servers', 'Open the connection form and test endpoint availability.', vscode.TreeItemCollapsibleState.None, {
        command: commandIds.openConfiguration,
        title: 'Configure MCP servers',
      }),
      ...(await this.renderConnections()),
    ];
  }

  private async renderConnections(): Promise<McpTreeItem[]> {
    const status = await this.registry.pingAll();
    return status.map((item) => {
      const icon = item.connected
        ? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
        : new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
      const description = item.connected ? `tools: ${item.tools ?? 0}` : item.error ?? 'unreachable';
      return new McpTreeItem(item.server, description, vscode.TreeItemCollapsibleState.None, {
        command: commandIds.openConfiguration,
        title: 'Open MCP configuration',
      }, icon);
    });
  }
}

class McpTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly descriptionText: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    command?: vscode.Command,
    iconPath?: vscode.ThemeIcon,
  ) {
    super(label, collapsibleState);
    this.description = descriptionText;
    this.command = command;
    this.iconPath = iconPath;
  }
}
