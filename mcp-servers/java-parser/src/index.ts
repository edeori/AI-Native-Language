import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startMcpServer } from '@ai-native/semantic-shared';
import { parseJavaProjectWithTreeSitter, parseJavaSourceWithTreeSitter, type ParsedJavaSource } from './parse-java.js';

function createServer() {
  const server = new McpServer({
    name: 'ai-native-java-parser',
    version: '0.1.0',
  });

  server.registerTool(
    'scan_java_project',
    {
      description: 'Parse a Java project as a batch of source files and return an aggregated AST catalog.',
      inputSchema: z.object({
        projectName: z.string().optional(),
        projectRoot: z.string().optional(),
        includeTree: z.boolean().optional().default(false),
        maxDepth: z.number().int().min(1).max(32).optional().default(6),
        files: z
          .array(
            z.object({
              path: z.string().optional(),
              content: z.string(),
            }),
          )
          .min(1),
      }),
    },
    async ({ projectName, projectRoot, includeTree, maxDepth, files }) => {
      console.error(`[java-parser] scan_java_project start project=${projectName ?? '<unknown>'} files=${files.length}`);
      const parsed = parseJavaProjectWithTreeSitter({
        projectName,
        projectRoot,
        includeTree,
        maxDepth,
        files,
        onFileParsed: ({ index, total, file, parsed: fileParsed }) => {
          const label = file.path ?? `<memory:${index + 1}>`;
          console.error(
            `[java-parser] parsed ${index + 1}/${total} ${label} types=${fileParsed.catalog.types.length} fields=${fileParsed.statistics.fields} methods=${fileParsed.statistics.methods}`,
          );
        },
      });
      console.error(
        `[java-parser] scan_java_project complete project=${projectName ?? '<unknown>'} files=${parsed.fileCount} types=${parsed.summary.statistics.types} fields=${parsed.summary.statistics.fields} methods=${parsed.summary.statistics.methods}`,
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(parsed, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'parse_java_source',
    {
      description: 'Parse Java source with tree-sitter and return a structured AST snapshot.',
      inputSchema: z.object({
        path: z.string().optional(),
        content: z.string().optional(),
        includeTree: z.boolean().optional().default(true),
        maxDepth: z.number().int().min(1).max(32).optional().default(8),
      }),
    },
    async ({ path, content, includeTree, maxDepth }) => {
      const sourceText = content ?? (path ? await readFile(path, 'utf8') : '');
      if (!sourceText.trim()) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: 'No Java source provided.',
                  sourcePath: path,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      console.error(`[java-parser] parse_java_source start file=${path ?? '<memory>'} bytes=${Buffer.byteLength(sourceText, 'utf8')}`);
      const parsed: ParsedJavaSource = parseJavaSourceWithTreeSitter({
        sourcePath: path,
        sourceText,
        includeTree,
        maxDepth,
      });
      console.error(
        `[java-parser] parse_java_source complete file=${path ?? '<memory>'} types=${parsed.catalog.types.length} fields=${parsed.statistics.fields} methods=${parsed.statistics.methods}`,
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                sourcePath: path ?? parsed.sourcePath,
                fileName: path ? basename(path) : undefined,
                ...parsed,
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
  await startMcpServer(createServer, { serviceName: 'java-parser' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
