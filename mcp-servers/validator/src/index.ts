import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  generateCanonicalGraph,
  parseSemanticMarkdown,
  parseSemanticMarkdownFromFile,
  startMcpServer,
  saveArtifact,
  validateSemanticDocument,
} from '@ai-native/semantic-shared';

const server = new McpServer({
  name: 'ai-native-validator',
  version: '0.1.0',
});

const validateInputSchema = z.object({
  path: z.string().optional(),
  content: z.string().optional(),
  policyText: z.string().optional(),
  persist: z.boolean().optional().default(true),
});

server.registerTool(
  'validate_semantic_markdown',
  {
    description: 'Validate Semantic Markdown against semantic and security rules.',
    inputSchema: validateInputSchema,
  },
  async ({ path, content, policyText, persist }) => {
    const document = path ? await parseSemanticMarkdownFromFile(path) : parseSemanticMarkdown(content ?? '', path);
    const graph = generateCanonicalGraph(document);
    const report = validateSemanticDocument(document, graph, { policyText });
    const reportText = JSON.stringify(report, null, 2);
    const reportPath = persist === false ? undefined : await saveArtifact(undefined, 'validation', report.graph.metadata.title ?? 'validation', 'json', reportText);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              reportPath,
              status: report.status,
              summary: report.summary,
              issues: report.issues,
              graph: report.graph,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

async function main() {
  await startMcpServer(server, { serviceName: 'validator' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
