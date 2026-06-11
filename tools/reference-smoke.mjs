import { readFileSync } from 'node:fs';
import { parseSemanticMarkdown } from '../mcp-servers/shared/dist/semantic-markdown.js';
import { generateCanonicalGraph } from '../mcp-servers/shared/dist/graph.js';
import { validateSemanticDocument } from '../mcp-servers/shared/dist/validator.js';

function summarize(path) {
  const content = readFileSync(path, 'utf8');
  const document = parseSemanticMarkdown(content, path);
  const graph = generateCanonicalGraph(document);
  const report = validateSemanticDocument(document, graph, {});

  return {
    path,
    status: report.status,
    summary: report.summary,
    nodeTypes: [...new Set(graph.nodes.map((node) => node.type))].sort(),
    modules: graph.nodes.filter((node) => node.type === 'Module').map((node) => node.name),
    externals: graph.nodes.filter((node) => node.type === 'ExternalSystem').map((node) => node.name),
  };
}

const samples = [
  './examples/simple_notes_service.semantic.md',
  './reference-projects/event-app-be/event-app-be.reference.semantic.md',
];

const results = samples.map(summarize);
console.log(JSON.stringify(results, null, 2));
