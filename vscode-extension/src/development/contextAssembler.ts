import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readMemory } from './memoryManager.js';

const execAsync = promisify(exec);

interface AssembledContext {
  prompt: string;
  directionPath: string;
}

export async function assemblePrompt(
  artifactRoot: string,
  taskId: string,
  direction: string,
  workspaceRoot: string,
  runDirectory: string,
): Promise<AssembledContext> {
  const topics = detectTopics(direction);

  const [semanticSections, graphSlice, docEntities, memory, fileIndex, projectOverview, dbSchema, layerCtx, moduleCtx] = await Promise.all([
    topics.isSimple || topics.isConfig ? Promise.resolve('') : readSemanticSections(artifactRoot, direction),
    topics.isConfig ? Promise.resolve('') : readGraphSlice(artifactRoot, direction, topics.isSimple || topics.isBugFix ? 10 : 15),
    topics.isSimple || topics.isConfig ? Promise.resolve('') : readDocEntities(artifactRoot, direction),
    readMemory(artifactRoot),
    readFileIndex(artifactRoot, workspaceRoot, direction, topics.isSimple ? 15 : 20),
    topics.isSimple || topics.isConfig ? Promise.resolve('') : readProjectOverview(artifactRoot),
    topics.isDb     ? readDatabaseSchema(artifactRoot)             : Promise.resolve(''),
    topics.isLayer  ? readLayerContext(artifactRoot, direction)     : Promise.resolve(''),
    topics.isModule ? readModuleComponents(artifactRoot, direction) : Promise.resolve(''),
  ]);

  const prompt = buildPrompt({
    taskId, direction, workspaceRoot, topics,
    semanticSections, graphSlice, docEntities, memory, fileIndex,
    projectOverview, dbSchema, layerCtx, moduleCtx,
  });

  const contextSummary = [
    `# ${taskId}`,
    '',
    direction.trim(),
    '',
    '---',
    `Context sources: ${[
      semanticSections  ? 'semantic ✓'   : 'semantic ✗',
      graphSlice        ? 'codegraph ✓'  : 'codegraph ✗',
      docEntities       ? 'docs ✓'       : 'docs ✗',
      memory            ? 'memory ✓'     : 'memory ✗',
      fileIndex         ? 'ast-index ✓'  : 'ast-index ✗',
      projectOverview   ? 'overview ✓'   : 'overview ✗',
      dbSchema          ? 'db-schema ✓'  : '',
      layerCtx          ? 'layers ✓'     : '',
      moduleCtx         ? 'modules ✓'    : '',
    ].filter(Boolean).join('  ')}`,
    `Topics: ${[
      topics.isSimple ? 'simple' : '',
      topics.isTest   ? 'test'   : '',
      topics.isBugFix ? 'bugfix' : '',
      topics.isConfig ? 'config' : '',
      topics.isDb     ? 'db'     : '',
      topics.isLayer  ? 'layer'  : '',
      topics.isModule ? 'module' : '',
    ].filter(Boolean).join(', ') || 'standard'}`,
    `Prompt chars: ~${prompt.length}`,
    `Timestamp: ${new Date().toISOString()}`,
  ].join('\n');

  const directionPath = path.join(runDirectory, 'direction.md');
  await fs.writeFile(directionPath, contextSummary, 'utf8');

  return { prompt, directionPath };
}

// ── Topic detection ──────────────────────────────────────────────

interface Topics {
  isSimple: boolean;
  isTest: boolean;
  isBugFix: boolean;
  isConfig: boolean;
  isDb: boolean;
  isLayer: boolean;
  isModule: boolean;
}

function detectTopics(direction: string): Topics {
  const lower = direction.toLowerCase();
  const has = (words: string[]) => words.some(w => lower.includes(w));
  return {
    isSimple: has(['comment', 'komment', 'javadoc', 'rename', 'format', 'typo', 'whitespace', 'indent', 'értelmező', 'leírás csak', 'csak komment']),
    isTest:   has(['test', 'teszt', 'junit', 'spec', 'assert', 'mock', 'stub', 'unittes', 'integrációs teszt']),
    isBugFix: has(['fix', 'hiba', 'bug', 'hibás', 'broken', 'npe', 'exception', 'javít', 'crash', 'error']),
    isConfig: has(['config', 'configuration', 'property', 'properties', 'yml', 'yaml', 'env', 'beállítás', 'konfig']),
    isDb:     has(['entity', 'entities', 'table', 'schema', 'database', 'migration', 'repository', 'jpa', 'hibernate', 'sql', 'persist', 'column']),
    isLayer:  has(['layer', 'api', 'controller', 'service', 'persistence', 'endpoint', 'interface', 'rest']),
    isModule: has(['module', 'service', 'common', 'persistence', 'web', 'app', 'component']),
  };
}

// ── Semantic sections (keyword-filtered) ─────────────────────────

const CONTEXT_SECTIONS = new Set(['system', 'intent', 'context', 'interfaces', 'processes', 'dependencies']);
const SEMANTIC_CHAR_CAP = 2500;

async function readSemanticSections(artifactRoot: string, direction: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(artifactRoot, 'source.semantic.md'), 'utf8');
    const keywords = direction.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const lines = raw.split('\n');
    const sections: Array<{ name: string; content: string }> = [];
    let current: string | null = null;
    let buf: string[] = [];

    for (const line of lines) {
      const h2 = line.match(/^## (.+)/);
      if (h2) {
        if (current && CONTEXT_SECTIONS.has(current) && buf.some(l => l.trim())) {
          sections.push({ name: current, content: buf.join('\n').trim() });
        }
        current = h2[1].trim().toLowerCase();
        buf = [];
      } else if (current) {
        buf.push(line);
      }
    }
    if (current && CONTEXT_SECTIONS.has(current) && buf.some(l => l.trim())) {
      sections.push({ name: current, content: buf.join('\n').trim() });
    }

    // Prefer sections where direction keywords appear; always include 'system' and 'intent'
    const priority = new Set(['system', 'intent']);
    const scored = sections
      .map(s => ({
        s,
        score: (priority.has(s.name) ? 100 : 0) +
               keywords.filter(k => s.content.toLowerCase().includes(k)).length,
      }))
      .sort((a, b) => b.score - a.score);

    let result = '';
    for (const { s } of scored) {
      const candidate = result ? result + `\n\n## ${s.name}\n${s.content}` : `## ${s.name}\n${s.content}`;
      if (candidate.length > SEMANTIC_CHAR_CAP) break;
      result = candidate;
    }
    return result;
  } catch {
    return '';
  }
}

// ── Graph slice ──────────────────────────────────────────────────

const DESC_TRIM = 80;
interface GraphNode { name: string; type?: string; description?: string; filePath?: string; }

async function readGraphSlice(artifactRoot: string, direction: string, limit = 15): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(artifactRoot, 'source.codegraph.json'), 'utf8');
    const graph = JSON.parse(raw) as { nodes?: GraphNode[] };
    const nodes: GraphNode[] = graph.nodes ?? [];
    const keywords = direction.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const scored = nodes
      .map(n => ({
        n,
        score: keywords.filter(k =>
          n.name.toLowerCase().includes(k) ||
          (n.description ?? '').toLowerCase().includes(k) ||
          (n.filePath ?? '').toLowerCase().includes(k),
        ).length,
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(x => x.n);

    if (scored.length === 0) return '';
    return scored
      .map(n => {
        const desc = n.description ? n.description.slice(0, DESC_TRIM) + (n.description.length > DESC_TRIM ? '…' : '') : '';
        return `- **${n.name}** (${n.type ?? 'unknown'})${n.filePath ? ` · ${n.filePath}` : ''}${desc ? `\n  ${desc}` : ''}`;
      })
      .join('\n');
  } catch {
    return '';
  }
}

// ── Doc entities ─────────────────────────────────────────────────

interface DocEntity { name: string; type?: string; description?: string; }

async function readDocEntities(artifactRoot: string, direction: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(artifactRoot, 'doc-entities.json'), 'utf8');
    const entities = JSON.parse(raw) as DocEntity[];
    const keywords = direction.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const relevant = entities
      .filter(e =>
        keywords.some(k =>
          e.name.toLowerCase().includes(k) ||
          (e.description ?? '').toLowerCase().includes(k),
        ),
      )
      .slice(0, 15);
    if (relevant.length === 0) return '';
    return relevant
      .map(e => {
        const desc = e.description ? e.description.slice(0, DESC_TRIM) + (e.description.length > DESC_TRIM ? '…' : '') : '';
        return `- **${e.name}** (${e.type ?? 'entity'})${desc ? `: ${desc}` : ''}`;
      })
      .join('\n');
  } catch {
    return '';
  }
}

// ── AST / file index ─────────────────────────────────────────────

interface AstPackage { packageName: string; fileCount: number; topImports?: string[]; }
interface AstIndex { packages?: AstPackage[]; }

async function readFileIndex(artifactRoot: string, workspaceRoot: string, direction: string, classLimit = 20): Promise<string> {
  const keywords = direction.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const parts: string[] = [];

  try {
    const raw = await fs.readFile(path.join(artifactRoot, 'source.ast-index.json'), 'utf8');
    const ast = JSON.parse(raw) as AstIndex;
    const packages = ast.packages ?? [];
    if (packages.length > 0) {
      const matched = packages.filter(p => keywords.some(k => p.packageName.toLowerCase().includes(k)));
      const toShow = matched.length > 0 ? matched : packages.slice(0, 10);
      const lines = toShow.map(p => {
        const imports = p.topImports?.slice(0, 2).map(i => i.split('.').pop()).filter(Boolean).join(', ');
        return `${p.packageName} (${p.fileCount} file${p.fileCount !== 1 ? 's' : ''})${imports ? ` — ${imports}` : ''}`;
      });
      const note = matched.length === 0 && packages.length > 10 ? `\n…and ${packages.length - 10} more packages` : '';
      parts.push(`### Package structure\n${lines.join('\n')}${note}`);
    }
  } catch { /* no ast-index */ }

  try {
    const raw = await fs.readFile(path.join(artifactRoot, 'source.class-index.md'), 'utf8');
    const lines = raw.split('\n');
    const matched: string[] = [];
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (keywords.some(k => lower.includes(k)) && line.includes('→') && line.includes('.java')) {
        matched.push(line.trim());
        if (matched.length >= classLimit) break;
      }
    }
    if (matched.length > 0) {
      parts.push(`### Keyword-matched classes\n${matched.join('\n')}`);
    }
  } catch { /* no class-index */ }

  if (parts.length === 0) {
    try {
      const { stdout } = await execAsync('git ls-files', { cwd: workspaceRoot, maxBuffer: 2 * 1024 * 1024 });
      const sourceExts = new Set(['.java', '.kt', '.ts', '.tsx', '.js', '.py', '.go', '.cs', '.rs']);
      const files = stdout.trim().split('\n')
        .filter(f => sourceExts.has(path.extname(f).toLowerCase()))
        .sort((a, b) => {
          const sa = keywords.filter(k => a.toLowerCase().includes(k)).length;
          const sb = keywords.filter(k => b.toLowerCase().includes(k)).length;
          return sb - sa;
        })
        .slice(0, 100);
      if (files.length > 0) parts.push(files.join('\n'));
    } catch { /* no git */ }
  }

  return parts.join('\n\n');
}

// ── Project overview ─────────────────────────────────────────────

async function readProjectOverview(artifactRoot: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(artifactRoot, 'source.analysis.md'), 'utf8');
    const snapshotIdx = raw.indexOf('\n## Source snapshot');
    const section = snapshotIdx > 0 ? raw.slice(0, snapshotIdx) : raw.slice(0, 1200);
    return section.trim();
  } catch {
    return '';
  }
}

// ── DB schema ────────────────────────────────────────────────────

async function readDatabaseSchema(artifactRoot: string): Promise<string> {
  try {
    return (await fs.readFile(path.join(artifactRoot, 'source.database.md'), 'utf8')).trim();
  } catch {
    return '';
  }
}

// ── Layer context ─────────────────────────────────────────────────

interface LayerGraph {
  layers?: Array<{ layer: string; applications?: Array<{ applicationId: string; items?: string[] }> }>;
}

async function readLayerContext(artifactRoot: string, direction: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(artifactRoot, 'source.layer-graphs.json'), 'utf8');
    const data = JSON.parse(raw) as LayerGraph;
    const keywords = direction.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const result: string[] = [];
    for (const layer of data.layers ?? []) {
      const allItems = layer.applications?.flatMap(a => a.items ?? []) ?? [];
      const layerMatch = keywords.some(k => layer.layer.toLowerCase().includes(k));
      const relevant = layerMatch
        ? allItems
        : allItems.filter(item => keywords.some(k => item.toLowerCase().includes(k)));
      if (relevant.length > 0) result.push(`${layer.layer}: ${relevant.join(', ')}`);
    }
    return result.join('\n');
  } catch {
    return '';
  }
}

// ── Module components ─────────────────────────────────────────────

interface ComponentMap {
  applications?: Array<{ name: string; cards?: Array<{ key: string; title: string; items?: string[] }> }>;
}

async function readModuleComponents(artifactRoot: string, direction: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(artifactRoot, 'source.component-map.json'), 'utf8');
    const data = JSON.parse(raw) as ComponentMap;
    const keywords = direction.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const result: string[] = [];
    for (const app of data.applications ?? []) {
      const matchedCards: string[] = [];
      for (const card of app.cards ?? []) {
        const cardText = (card.key + ' ' + card.title).toLowerCase();
        const itemsText = (card.items ?? []).join(' ').toLowerCase();
        if (!keywords.some(k => cardText.includes(k) || itemsText.includes(k))) continue;
        const keywordItems = (card.items ?? []).filter(item => keywords.some(k => item.toLowerCase().includes(k)));
        const display = keywordItems.length > 0 ? keywordItems : (card.items ?? []).slice(0, 6);
        matchedCards.push(`  ${card.title}: ${display.join(', ')}`);
      }
      if (matchedCards.length > 0) result.push(`[${app.name}]\n${matchedCards.join('\n')}`);
    }
    return result.join('\n\n');
  } catch {
    return '';
  }
}

// ── Prompt builder ───────────────────────────────────────────────

const MEMORY_CHAR_CAP = 1500;

function buildPrompt(p: {
  taskId: string;
  direction: string;
  workspaceRoot: string;
  topics: Topics;
  semanticSections: string;
  graphSlice: string;
  docEntities: string;
  memory: string;
  fileIndex: string;
  projectOverview: string;
  dbSchema: string;
  layerCtx: string;
  moduleCtx: string;
}): string {
  const s: string[] = [];
  const { topics } = p;

  // ── Stable prefix (cache-friendly: same across tasks for the same project) ──
  s.push(`You are an AI coding agent implementing a task in the repository at \`${p.workspaceRoot}\`.\nWork ONLY inside that path. Do NOT commit or push anything.\nWrite a report.md in the task run directory when done.`);

  if (p.projectOverview) s.push(`## Project overview\n\n${p.projectOverview}`);
  if (p.semanticSections) s.push(`## Semantic context\n\n${p.semanticSections}`);
  if (p.dbSchema)         s.push(`## Database schema\n\n${p.dbSchema}`);
  if (p.layerCtx)         s.push(`## Architecture layers\n\n${p.layerCtx}`);
  if (p.moduleCtx)        s.push(`## Module components\n\n${p.moduleCtx}`);

  // ── Task-specific (changes per task) ──
  s.push(`# Task — ${p.taskId}\n\n${p.direction}`);

  const memory = p.memory.length > MEMORY_CHAR_CAP
    ? p.memory.slice(-MEMORY_CHAR_CAP) + '\n…(older entries omitted)'
    : p.memory;
  if (memory) s.push(`## Project memory\n\n${memory}`);

  if (p.graphSlice)   s.push(`## Relevant components\n\n${p.graphSlice}`);
  if (p.docEntities)  s.push(`## Relevant doc entities\n\n${p.docEntities}`);
  if (p.fileIndex)    s.push(`## File index\nRead only what you need.\n\n${p.fileIndex}`);

  // ── Report format (shortened for low-cost task types) ──
  s.push(reportFormat(topics));

  return s.join('\n\n');
}

function reportFormat(topics: Topics): string {
  const isLight = topics.isSimple || topics.isConfig;

  if (isLight) {
    return `## Report format\nWrite \`report.md\`:\n\`\`\`\n# Summary\n<what was done>\n\n# Changed files\n- path — reason\n\`\`\``;
  }

  const followUps = topics.isBugFix || topics.isTest ? '' : `\n# Suggested follow-ups\n- <actionable suggestion>\n`;
  const drift = topics.isBugFix || topics.isTest
    ? ''
    : `\n# Semantic drift\n<Only if high-level semantic docs need updating — leave empty otherwise>\n`;

  return `## Report format\nWrite \`report.md\` with these sections:\n\`\`\`\n# Summary\n<1–3 sentences>\n\n# Changed files\n- path — reason\n\n# Risks\n- <or "none">\n${followUps}\n# Memory update\n<Max 5 bullets of project-specific facts — leave empty if nothing new>\n${drift}\`\`\``;
}
