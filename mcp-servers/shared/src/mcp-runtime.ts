import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export type TransportMode = 'stdio' | 'http';

export interface StartServerOptions {
  transportMode?: TransportMode;
  port?: number;
  path?: string;
  serviceName?: string;
}

export async function startMcpServer(
  server: McpServer,
  options: StartServerOptions = {},
): Promise<void> {
  const transportMode = options.transportMode || (process.env.MCP_TRANSPORT_MODE as TransportMode | undefined) || 'stdio';
  const serviceName = options.serviceName || 'mcp-server';

  if (transportMode === 'http') {
    const port = options.port || Number(process.env.PORT || 3000);
    const path = options.path || process.env.MCP_PATH || '/mcp';
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: true,
    });

    await server.connect(transport);

    const httpServer = createServer(async (req, res) => {
      if (!req.url?.startsWith(path)) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Not Found' }));
        return;
      }

      await transport.handleRequest(req, res);
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(port, () => {
        console.error(`[${serviceName}] listening on http://0.0.0.0:${port}${path}`);
        resolve();
      });
    });

    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
