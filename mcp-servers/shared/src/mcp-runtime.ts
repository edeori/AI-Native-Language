import { createServer } from 'node:http';
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
  createServerInstance: () => McpServer,
  options: StartServerOptions = {},
): Promise<void> {
  const transportMode = options.transportMode || (process.env.MCP_TRANSPORT_MODE as TransportMode | undefined) || 'stdio';
  const serviceName = options.serviceName || 'mcp-server';

  if (transportMode === 'http') {
    const port = options.port || Number(process.env.PORT || 3000);
    const path = options.path || process.env.MCP_PATH || '/mcp';
    const httpServer = createServer(async (req, res) => {
      const server = createServerInstance();
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
        sessionIdGenerator: undefined,
      });

      if (req.url === '/health' || req.url === '/healthz' || req.url === '/_health') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            ok: true,
            service: serviceName,
            transportMode: 'http',
          }),
        );
        return;
      }

      if (!req.url?.startsWith(path)) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Not Found' }));
        return;
      }

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        try {
          await server.close();
        } catch {
          // ignore shutdown noise
        }
      }
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
  await createServerInstance().connect(transport);
}
