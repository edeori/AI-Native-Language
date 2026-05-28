import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  generateCanonicalGraph,
  generateSpringBootSkeleton,
  persistGeneratedSpringBootSkeleton,
  parseSemanticMarkdown,
  parseSemanticMarkdownFromFile,
  startMcpServer,
} from '@ai-native/semantic-shared';

const server = new McpServer({
  name: 'ai-native-compiler',
  version: '0.1.0',
});

const compileInputSchema = z.object({
  path: z.string().optional(),
  content: z.string().optional(),
  outputDir: z.string().optional(),
  basePackage: z.string().optional(),
  artifactName: z.string().optional(),
  persist: z.boolean().optional().default(true),
});

server.registerTool(
  'generate_spring_boot_skeleton',
  {
    description: 'Generate a limited Java 17+ Spring Boot skeleton from the canonical graph model.',
    inputSchema: compileInputSchema,
  },
  async ({ path, content, outputDir, basePackage, artifactName, persist }) => {
    const document = path ? await parseSemanticMarkdownFromFile(path) : parseSemanticMarkdown(content ?? '', path);
    const graph = generateCanonicalGraph(document);
    const generated = generateSpringBootSkeleton(graph, { outputDir, basePackage, artifactName });

    const files = generated.files.map((file) => ({
      path: file.path,
      contentPreview: file.content.slice(0, 1200),
    }));

    let artifactRoot: string | undefined;
    let manifestPath: string | undefined;
    if (persist !== false) {
      artifactRoot = generated.outputDir;
      const persistResult = await persistGeneratedSpringBootSkeleton(
        generated,
        artifactName || graph.metadata.title || 'generated-application',
        undefined,
      );
      manifestPath = persistResult.manifestPath;
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              artifactRoot,
              manifestPath,
              outputDir: generated.outputDir,
              files,
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

async function main() {
  await startMcpServer(server, { serviceName: 'compiler' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
