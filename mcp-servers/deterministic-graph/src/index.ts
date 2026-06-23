import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  buildDeterministicGraphArtifacts,
  renderCodeKnowledgeGraphMarkdown,
  startMcpServer,
  type JqassistantArtifact,
  type SourceProjectAnalysis,
  type SourceProjectSnapshot,
} from '@ai-native/semantic-shared';

function createServer() {
  const server = new McpServer({
    name: 'ai-native-deterministic-graph',
    version: '0.1.0',
  });

  server.registerTool(
    'deterministic_graph_build',
    {
      description: 'Build deterministic graph and support artifacts from analysis, snapshot, and optional jqassistant artifact.',
      inputSchema: z.object({
        projectName: z.string(),
        projectRoot: z.string(),
        analysis: z.any(),
        snapshot: z.any(),
        jqassistantArtifact: z.any().optional(),
        outputDir: z.string().optional(),
      }),
    },
    async ({ analysis, snapshot, jqassistantArtifact, outputDir }) => {
      const typedAnalysis = analysis as SourceProjectAnalysis;
      const typedSnapshot = snapshot as SourceProjectSnapshot;
      const typedJqassistant = jqassistantArtifact as JqassistantArtifact | undefined;
      const artifacts = await buildDeterministicGraphArtifacts(typedAnalysis, typedSnapshot, typedJqassistant);

      if (outputDir?.trim()) {
        await mkdir(outputDir, { recursive: true });
        await writeFile(join(outputDir, 'source.ast-index.json'), JSON.stringify(artifacts.astIndex, null, 2) + '\n');
        await writeFile(join(outputDir, 'source.codegraph.json'), JSON.stringify(artifacts.codeKnowledgeGraph, null, 2) + '\n');
        await writeFile(join(outputDir, 'source.codegraph.md'), renderCodeKnowledgeGraphMarkdown(artifacts.codeKnowledgeGraph));
        await writeFile(join(outputDir, 'source.jqassistant-graph.json'), JSON.stringify(artifacts.jqassistantSupport, null, 2) + '\n');
        await writeFile(join(outputDir, 'source.support-graph.json'), JSON.stringify(artifacts.supportGraph, null, 2) + '\n');
        await writeFile(join(outputDir, 'source.graph-verification.json'), JSON.stringify(artifacts.graphVerification, null, 2) + '\n');
        await writeFile(join(outputDir, 'source.graph-verification-slices.json'), JSON.stringify(artifacts.graphVerificationSlices, null, 2) + '\n');
        await writeFile(join(outputDir, 'source.layer-graphs.json'), JSON.stringify(artifacts.layerGraphs, null, 2) + '\n');
        await writeFile(join(outputDir, 'source.preview.json'), JSON.stringify(artifacts.preview, null, 2) + '\n');
        await writeFile(join(outputDir, 'source.component-map.json'), JSON.stringify(artifacts.componentMap, null, 2) + '\n');
        await writeFile(join(outputDir, 'source.flow-map.json'), JSON.stringify(artifacts.flowMap, null, 2) + '\n');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(artifacts, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

async function main() {
  await startMcpServer(createServer, { serviceName: 'deterministic-graph' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
