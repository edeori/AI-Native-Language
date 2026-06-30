import { createServer } from 'node:http';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
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

// ─── Download store ──────────────────────────────────────────────────────────

interface DownloadEntry {
  files: { path: string; content: string }[];
  createdAt: number;
}

const downloadStore = new Map<string, DownloadEntry>();

setInterval(() => {
  const cutoff = Date.now() - 3_600_000;
  for (const [id, entry] of downloadStore) {
    if (entry.createdAt < cutoff) downloadStore.delete(id);
  }
}, 300_000).unref();

export function storeDownload(files: { path: string; content: string }[]): string {
  const id = randomUUID();
  downloadStore.set(id, { files, createdAt: Date.now() });
  return id;
}

// ─── HTTP server ─────────────────────────────────────────────────────────────

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
      // Health check
      if (req.url === '/health' || req.url === '/healthz' || req.url === '/_health') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, service: serviceName, transportMode: 'http' }));
        return;
      }

      // Download endpoint: GET /download/:uuid.tar.gz
      const downloadMatch = req.method === 'GET' && req.url?.match(/^\/download\/([0-9a-f-]{36})\.tar\.gz$/i);
      if (downloadMatch) {
        const entry = downloadStore.get(downloadMatch[1]);
        if (!entry) {
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Not found or expired' }));
          return;
        }
        const tmpDir = await mkdtemp('/tmp/dl-');
        try {
          for (const file of entry.files) {
            const filePath = join(tmpDir, file.path);
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, file.content, 'utf8');
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'application/gzip');
          res.setHeader('content-disposition', 'attachment; filename="generated.tar.gz"');
          const tar = spawn('tar', ['-czf', '-', '-C', tmpDir, '.']);
          tar.stdout.pipe(res);
          await new Promise<void>((resolve, reject) => {
            tar.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))));
            tar.on('error', reject);
          });
        } finally {
          await rm(tmpDir, { recursive: true, force: true });
        }
        return;
      }

      // MCP endpoint
      if (!req.url?.startsWith(path)) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Not Found' }));
        return;
      }

      const server = createServerInstance();
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
        sessionIdGenerator: undefined,
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
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
