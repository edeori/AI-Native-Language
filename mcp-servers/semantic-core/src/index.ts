import { basename } from 'node:path';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  generateCanonicalGraph,
  parseSemanticMarkdown,
  parseSemanticMarkdownFromFile,
  startMcpServer,
  saveArtifact,
  graphPreview,
  validateSemanticDocument,
  validationPolicyText,
} from '@ai-native/semantic-shared';

function createServer() {
  const server = new McpServer({
    name: 'ai-native-semantic-core',
    version: '0.1.0',
  });

  const semanticInputSchema = z.object({
    path: z.string().optional(),
    content: z.string().optional(),
    policyText: z.string().optional(),
    persist: z.boolean().optional().default(true),
  });

  server.registerTool(
    'parse_semantic_markdown',
    {
      description: 'Parse Semantic Markdown into section blocks.',
      inputSchema: semanticInputSchema,
    },
    async ({ path, content, policyText, persist }) => {
      const document = content ? parseSemanticMarkdown(content, path) : await parseSemanticMarkdownFromFile(path ?? '');
      const cachePath =
        persist === false
          ? undefined
          : await saveArtifact(
              undefined,
              'cache',
              document.sourcePath ? basename(document.sourcePath, '.md') || 'semantic-document' : 'semantic-document',
              'json',
              JSON.stringify(
                {
                  sourcePath: document.sourcePath,
                  sections: document.orderedSections.map((section) => ({
                    name: section.name,
                    title: section.title,
                    items: section.items,
                  })),
                },
                null,
                2,
              ),
            );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                cachePath,
                sourcePath: document.sourcePath,
                sections: document.orderedSections.map((section) => ({
                  name: section.name,
                  title: section.title,
                  items: section.items,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'generate_canonical_graph',
    {
      description: 'Generate the canonical graph model from Semantic Markdown.',
      inputSchema: semanticInputSchema,
    },
    async ({ path, content, policyText, persist }) => {
      const document = content ? parseSemanticMarkdown(content, path) : await parseSemanticMarkdownFromFile(path ?? '');
      const graph = generateCanonicalGraph(document);
      const report = validateSemanticDocument(document, graph, { policyText: policyText ?? validationPolicyText });
      const graphText = JSON.stringify(graph, null, 2);
      const graphPath = persist === false ? undefined : await saveArtifact(undefined, 'graph', graph.metadata.title ?? 'graph', 'json', graphText);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                graphPath,
                graphPreview: graphPreview(graph),
                graph,
                validation: {
                  status: report.status,
                  summary: report.summary,
                  issues: report.issues,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}

async function main() {
  await startMcpServer(createServer, { serviceName: 'semantic-core' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
