import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  generateCanonicalGraph,
  parseSemanticMarkdown,
  parseSemanticMarkdownFromFile,
  startMcpServer,
  saveArtifact,
  validateSemanticDocument,
  validationPolicyText,
} from '@ai-native/semantic-shared';

function createServer() {
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
    'get_validation_policy',
    {
      description: 'Return the canonical validation policy used by the MCP validator.',
      inputSchema: z.object({}),
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              policyId: 'mcp-validation-policy-v1',
              policyText: validationPolicyText,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerTool(
    'validate_semantic_markdown',
    {
      description: 'Validate Semantic Markdown against semantic and security rules.',
      inputSchema: validateInputSchema,
    },
    async ({ path, content, policyText, persist }) => {
      const document = content ? parseSemanticMarkdown(content, path) : await parseSemanticMarkdownFromFile(path ?? '');
      const graph = generateCanonicalGraph(document);
      const report = validateSemanticDocument(document, graph, { policyText: policyText ?? validationPolicyText });
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

  return server;
}

async function main() {
  await startMcpServer(createServer, { serviceName: 'validator' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
