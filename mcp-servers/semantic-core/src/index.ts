import { basename } from 'node:path';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  generateDatabaseSchema,
  generateCanonicalGraph,
  parseSemanticMarkdown,
  parseSemanticMarkdownFromFile,
  startMcpServer,
  saveArtifact,
  graphPreview,
  validateSemanticDocument,
  validationPolicyText,
  buildReconnaissancePrompt,
  buildModuleReconnaissancePrompt,
} from '@ai-native/semantic-shared';

function createServer() {
  const server = new McpServer({
    name: 'ai-native-semantic-core',
    version: '0.1.0',
  });

  const reconnaissanceInputSchema = z.object({
    analysis: z.any(),
    moduleDossiers: z.array(z.any()).optional().default([]),
  });

  const semanticInputSchema = z.object({
    path: z.string().optional(),
    content: z.string().optional(),
    policyText: z.string().optional(),
    persist: z.boolean().optional().default(true),
  });

  server.registerTool(
    'generate_database_schema',
    {
      description: 'Infer a database schema draft from Semantic Markdown and the canonical graph model.',
      inputSchema: semanticInputSchema,
    },
    async ({ path, content, policyText, persist }) => {
      const document = content ? parseSemanticMarkdown(content, path) : await parseSemanticMarkdownFromFile(path ?? '');
      const graph = generateCanonicalGraph(document);
      const databaseSchema = generateDatabaseSchema(document, graph);
      const schemaText = JSON.stringify(
        {
          databaseSchema,
          graphPreview: graphPreview(graph),
          graph,
        },
        null,
        2,
      );
      const schemaPath = persist === false ? undefined : await saveArtifact(undefined, 'schema', graph.metadata.title ?? 'schema', 'json', schemaText);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                schemaPath,
                databaseSchema,
                graphPreview: graphPreview(graph),
                graph,
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
    'generate_reconnaissance_prompt',
    {
      description: 'Generate the canonical reconnaissance prompt and per-module prompts for a source code analysis snapshot.',
      inputSchema: reconnaissanceInputSchema,
    },
    async ({ analysis, moduleDossiers }) => {
      const normalizedAnalysis = analysis as {
        projectName?: string;
        projectRoot?: string;
        modules?: string[];
        counts?: Record<string, number>;
        schemaHints?: unknown[];
      };
      const normalizedModuleDossiers = (moduleDossiers ?? []).map((item) => {
        const { prompt: _prompt, ...moduleDossier } = item as { prompt?: string };
        return moduleDossier;
      });

      const projectPrompt = buildReconnaissancePrompt(normalizedAnalysis as never, normalizedModuleDossiers as never);
      const modulePrompts = normalizedModuleDossiers.map((dossier) => ({
        moduleRoot: (dossier as { moduleRoot?: string }).moduleRoot ?? '.',
        prompt: buildModuleReconnaissancePrompt(dossier as never),
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                projectPrompt,
                modulePrompts,
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
      const reportPath =
        persist === false
          ? undefined
          : await saveArtifact(undefined, 'validation', graph.metadata.title ?? 'validation', 'json', JSON.stringify(report, null, 2));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                graphPath,
                reportPath,
                graphPreview: graphPreview(graph),
                graph,
                databaseSchema: graph.metadata.databaseSchema,
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
