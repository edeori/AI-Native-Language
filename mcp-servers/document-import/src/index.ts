import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startMcpServer } from '@ai-native/semantic-shared';

const require = createRequire(import.meta.url);
const mammoth = require('mammoth') as any;
const pdfParse = require('pdf-parse') as any;

type ImportKind = 'docx' | 'doc' | 'pdf' | 'html' | 'txt' | 'md' | 'unknown';

// ─── Section parser ────────────────────────────────────────────────────────

interface DocSection {
  level: number;
  title: string;
  content: string;
}

function parseSections(markdown: string): DocSection[] {
  const lines = markdown.split('\n');
  const sections: DocSection[] = [];
  let current: { level: number; title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      if (current) sections.push({ level: current.level, title: current.title, content: current.lines.join('\n').trim() });
      current = { level: m[1].length, title: m[2].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ level: current.level, title: current.title, content: current.lines.join('\n').trim() });
  return sections;
}

function extractTitle(markdown: string): string {
  const m = markdown.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : 'Imported Document';
}

// ─── Entity extractors ─────────────────────────────────────────────────────

const COMPONENT_SUFFIXES = /\b(Service|Module|Component|Handler|Manager|Controller|Repository|Gateway|Adapter|Client|Provider|Factory|Registry|Engine|Processor|Dispatcher|Coordinator|Orchestrator|Aggregator|Store|Cache|Bus|Broker|Queue|Consumer|Producer|Listener|Scheduler|Worker|Job|Task|Validator|Transformer|Converter|Parser|Serializer|Codec|Connector|Proxy|Facade|Delegate)\b/gi;

function extractComponents(markdown: string, sections: DocSection[]): string[] {
  const found = new Set<string>();

  // From headings: H2/H3 that look like components
  for (const sec of sections) {
    if (sec.level <= 3 && COMPONENT_SUFFIXES.test(sec.title)) {
      found.add(sec.title.replace(COMPONENT_SUFFIXES, (m) => m));
    }
  }
  COMPONENT_SUFFIXES.lastIndex = 0;

  // From text: "The X Service", "X Module", "X Component"
  const phraseRe = /\b(?:the\s+)?([A-Z][a-zA-Z0-9]+(?:Service|Module|Component|Handler|Manager|Controller|Repository|Gateway|Adapter|Engine|Processor|Dispatcher|Worker|Scheduler|Cache|Store|Bus|Broker|Queue|Connector|Proxy))\b/g;
  let m: RegExpExecArray | null;
  while ((m = phraseRe.exec(markdown)) !== null) {
    found.add(m[1]);
  }

  return [...found].filter((v) => v.length > 3 && v.length < 80).slice(0, 40);
}

const FLOW_KEYWORDS = /\b(flow|process|sequence|workflow|pipeline|lifecycle|request\s+handling|authentication|authorization|registration|checkout|payment|onboarding|notification|event\s+processing|data\s+ingestion|sync|batch|migration)\b/gi;

function extractFlows(markdown: string, sections: DocSection[]): string[] {
  const found = new Set<string>();

  for (const sec of sections) {
    if (sec.level <= 3 && FLOW_KEYWORDS.test(sec.title)) {
      found.add(sec.title);
    }
    FLOW_KEYWORDS.lastIndex = 0;

    // Numbered list under this section → likely a flow
    if (sec.content.match(/^\s*\d+\.\s+/m) || sec.content.match(/^\s*(?:Step\s+\d+|First|Then|Finally|Next)\b/im)) {
      if (sec.title.length > 3 && sec.title.length < 80) {
        found.add(sec.title);
      }
    }

    // Arrow patterns → flow description
    if (sec.content.match(/(?:→|->|=>|>>)/)) {
      if (sec.title.length > 3 && sec.title.length < 80) {
        found.add(sec.title);
      }
    }
  }

  return [...found].slice(0, 20);
}

function extractApis(markdown: string): string[] {
  const found = new Set<string>();

  // REST endpoints
  const restRe = /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/[a-zA-Z0-9/_{}:.-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = restRe.exec(markdown)) !== null) {
    found.add(`${m[1]} ${m[2]}`);
  }

  // Path-only patterns like `/api/users/{id}`
  const pathRe = /`(\/(?:api|v\d+)[a-zA-Z0-9/_{}:.-]+)`/g;
  while ((m = pathRe.exec(markdown)) !== null) {
    if (!m[1].includes('\n')) found.add(m[1]);
  }

  return [...found].slice(0, 30);
}

function extractDataModels(markdown: string, sections: DocSection[]): string[] {
  const found = new Set<string>();

  // Markdown tables — section title is likely the entity
  for (const sec of sections) {
    if (sec.content.match(/^\|.+\|/m)) {
      found.add(sec.title);
    }
    // "table: X", "entity: X", "model: X"
    const m = sec.content.match(/\b(?:table|entity|model|schema|relation):\s*([A-Za-z][A-Za-z0-9_]+)/gi);
    if (m) m.forEach((hit) => found.add(hit.replace(/^[^:]+:\s*/i, '')));
  }

  // SQL-like CREATE TABLE
  const sqlRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([A-Za-z_][A-Za-z0-9_]+)[`"']?/gi;
  let m: RegExpExecArray | null;
  while ((m = sqlRe.exec(markdown)) !== null) {
    found.add(m[1]);
  }

  // CamelCase entity names in "Entity: X", "Table: X" inline
  const inlineRe = /\b(?:Entity|Table|Model|Schema)\s+[`"]?([A-Z][a-zA-Z0-9]+)[`"]?/g;
  while ((m = inlineRe.exec(markdown)) !== null) {
    found.add(m[1]);
  }

  return [...found].filter((v) => v.length > 1 && v.length < 60).slice(0, 20);
}

const TECH_NAMES: string[] = [
  'Spring Boot', 'Spring Security', 'Spring Data', 'Spring Cloud', 'Spring MVC',
  'Hibernate', 'JPA', 'MyBatis', 'Flyway', 'Liquibase',
  'Kafka', 'RabbitMQ', 'ActiveMQ', 'Redis', 'Memcached',
  'PostgreSQL', 'MySQL', 'MariaDB', 'Oracle', 'SQL Server', 'SQLite',
  'MongoDB', 'Cassandra', 'DynamoDB', 'Elasticsearch', 'OpenSearch',
  'Docker', 'Kubernetes', 'Helm', 'Terraform', 'Ansible',
  'AWS', 'Azure', 'GCP', 'S3', 'Lambda', 'ECS', 'EKS',
  'gRPC', 'GraphQL', 'REST', 'WebSocket', 'SOAP',
  'React', 'Vue', 'Angular', 'Next.js', 'Nuxt',
  'Nginx', 'HAProxy', 'Envoy', 'Istio',
  'Prometheus', 'Grafana', 'Datadog', 'Splunk', 'ELK',
  'OAuth2', 'OpenID Connect', 'JWT', 'SAML',
  'Gradle', 'Maven', 'npm', 'Yarn',
  'Java', 'Kotlin', 'Go', 'Python', 'TypeScript', 'Rust',
];

function extractTechStack(markdown: string): string[] {
  const found = new Set<string>();
  const lower = markdown.toLowerCase();
  for (const tech of TECH_NAMES) {
    if (lower.includes(tech.toLowerCase())) {
      found.add(tech);
    }
  }
  return [...found];
}

// ─── Document kind detection ───────────────────────────────────────────────

type DocKind = 'architecture' | 'lld' | 'api-spec' | 'technical-description' | 'mixed';

function detectDocKind(sections: DocSection[], entities: {
  components: string[]; flows: string[]; apis: string[];
}): DocKind {
  const apiScore = entities.apis.length;
  const componentScore = entities.components.length;
  const flowScore = entities.flows.length;
  const hasDetailedSections = sections.some((s) =>
    /\b(detail|implementation|class|method|function|algorithm|pseudo)\b/i.test(s.title));

  if (apiScore > 5 && componentScore < 3) return 'api-spec';
  if (hasDetailedSections && componentScore > 2) return 'lld';
  if (componentScore > 3 && flowScore > 1) return 'architecture';
  if (componentScore + flowScore + apiScore > 2) return 'mixed';
  return 'technical-description';
}

// ─── Semantic patch builder ────────────────────────────────────────────────

const FULL_CONTENT_LIMIT = 12000;

function buildSemanticPatch(params: {
  docTitle: string;
  docKind: DocKind;
  components: string[];
  flows: string[];
  apis: string[];
  dataModels: string[];
  techStack: string[];
  sections: DocSection[];
  fullMarkdown?: string;
}): string {
  const { docTitle, components, flows, apis, dataModels, techStack, sections, fullMarkdown } = params;
  const lines: string[] = [];

  lines.push(`## Imported: ${docTitle}`);
  lines.push('');

  if (components.length > 0) {
    lines.push('### Components & Modules');
    for (const c of components) lines.push(`- **${c}**`);
    lines.push('');
  }

  if (flows.length > 0) {
    lines.push('### Flows & Processes');
    for (const f of flows) {
      const sec = sections.find((s) => s.title === f);
      const firstLine = sec?.content.split('\n').find((l) => l.trim().length > 10);
      lines.push(`- **${f}**${firstLine ? ` — ${firstLine.trim().replace(/^[-*•]\s*/, '')}` : ''}`);
    }
    lines.push('');
  }

  if (apis.length > 0) {
    lines.push('### API Endpoints');
    for (const api of apis) lines.push(`- \`${api}\``);
    lines.push('');
  }

  if (dataModels.length > 0) {
    lines.push('### Data Models');
    for (const m of dataModels) lines.push(`- **${m}**`);
    lines.push('');
  }

  if (techStack.length > 0) {
    lines.push('### Tech Stack');
    lines.push(techStack.join(', '));
    lines.push('');
  }

  // Include the full document text so downstream AI tools can extract meaning
  // that regex heuristics miss (Hungarian text, domain-specific terminology, etc.)
  if (fullMarkdown && fullMarkdown.trim().length > 50) {
    const body = fullMarkdown.length > FULL_CONTENT_LIMIT
      ? fullMarkdown.slice(0, FULL_CONTENT_LIMIT) + '\n… (truncated)'
      : fullMarkdown;
    lines.push('### Document Content');
    lines.push(body.trim());
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// ─── Semantic.md merger ────────────────────────────────────────────────────

function mergeIntoExisting(existing: string, patch: string, docTitle: string): string {
  // If already imported this doc, skip
  if (existing.includes(`## Imported: ${docTitle}`)) {
    return existing;
  }

  // Append patch to dependencies section or at the end
  const depsMatch = existing.match(/^#\s*dependencies\b/im);
  if (depsMatch && depsMatch.index !== undefined) {
    const before = existing.slice(0, depsMatch.index);
    const after = existing.slice(depsMatch.index);
    return `${before.trimEnd()}\n\n${patch}\n\n${after}`;
  }

  return `${existing.trimEnd()}\n\n${patch}\n`;
}

function buildNewSemanticMd(params: {
  docTitle: string;
  docKind: DocKind;
  components: string[];
  flows: string[];
  apis: string[];
  dataModels: string[];
  techStack: string[];
  sections: DocSection[];
  fullMarkdown?: string;
}): string {
  const { docTitle, components, flows, apis, dataModels, techStack, sections, fullMarkdown } = params;

  const overviewSection = sections.find((s) =>
    s.level <= 2 && /\b(overview|description|summary|introduction|background|purpose|system)\b/i.test(s.title)
  );
  const systemDesc = overviewSection?.content.split('\n').slice(0, 4).join(' ').trim() || docTitle;

  const lines: string[] = [];
  lines.push(`# system`);
  lines.push(docTitle);
  lines.push('');
  lines.push(`# intent`);
  lines.push(systemDesc);
  lines.push('');

  if (components.length > 0 || techStack.length > 0) {
    lines.push(`# context`);
    if (components.length > 0) {
      for (const c of components.slice(0, 6)) lines.push(`- ${c}`);
    }
    if (techStack.length > 0) {
      lines.push(`- tech: ${techStack.slice(0, 6).join(', ')}`);
    }
    lines.push('');
  }

  if (apis.length > 0) {
    lines.push(`# interfaces`);
    for (const api of apis.slice(0, 15)) lines.push(`- api: \`${api}\``);
    lines.push('');
  }

  if (flows.length > 0) {
    lines.push(`# processes`);
    for (const f of flows) {
      const sec = sections.find((s) => s.title === f);
      const body = sec?.content.split('\n').filter((l) => l.trim()).slice(0, 4).join(' ').trim();
      lines.push(`- **${f}**${body ? `: ${body}` : ''}`);
    }
    lines.push('');
  }

  if (dataModels.length > 0) {
    lines.push(`# data_flows`);
    for (const m of dataModels) lines.push(`- ${m} entity is persisted and referenced by business operations`);
    lines.push('');
  }

  if (techStack.length > 0) {
    lines.push(`# dependencies`);
    for (const t of techStack) lines.push(`- ${t}`);
    lines.push('');
  }

  if (fullMarkdown && fullMarkdown.trim().length > 50) {
    const body = fullMarkdown.length > FULL_CONTENT_LIMIT
      ? fullMarkdown.slice(0, FULL_CONTENT_LIMIT) + '\n… (truncated)'
      : fullMarkdown;
    lines.push(`# document_content`);
    lines.push(body.trim());
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Main analysis ─────────────────────────────────────────────────────────

function analyzeDocumentForSemantic(params: {
  markdown: string;
  existingSemanticMd?: string;
  projectName?: string;
}): Record<string, unknown> {
  const { markdown, existingSemanticMd, projectName } = params;
  const sections = parseSections(markdown);
  const docTitle = projectName || extractTitle(markdown);

  const components = extractComponents(markdown, sections);
  const flows = extractFlows(markdown, sections);
  const apis = extractApis(markdown);
  const dataModels = extractDataModels(markdown, sections);
  const techStack = extractTechStack(markdown);
  const docKind = detectDocKind(sections, { components, flows, apis });

  const patch = buildSemanticPatch({ docTitle, docKind, components, flows, apis, dataModels, techStack, sections, fullMarkdown: markdown });

  let mergedSemanticMd: string;
  let mode: 'create' | 'enrich';
  if (existingSemanticMd && existingSemanticMd.trim()) {
    mergedSemanticMd = mergeIntoExisting(existingSemanticMd, patch, docTitle);
    mode = 'enrich';
  } else {
    mergedSemanticMd = buildNewSemanticMd({ docTitle, docKind, components, flows, apis, dataModels, techStack, sections, fullMarkdown: markdown });
    mode = 'create';
  }

  return {
    ok: true,
    docTitle,
    docKind,
    mode,
    entities: { components, flows, apis, dataModels, techStack },
    semanticPatch: patch,
    mergedSemanticMd,
  };
}

// ─── MCP Server ────────────────────────────────────────────────────────────

function createServer(): McpServer {
  const server = new McpServer({
    name: 'ai-native-document-import',
    version: '0.1.0',
  });

  const convertInputSchema = z.object({
    sourcePath: z.string().optional(),
    outputDir: z.string().optional(),
    content: z.string().optional(),
    contentBase64: z.string().optional(),
    fileName: z.string().optional(),
    format: z.enum(['doc', 'docx', 'pdf', 'html', 'txt', 'md']).optional(),
    confluenceUrl: z.string().optional(),
    confluenceToken: z.string().optional(),
    confluenceUser: z.string().optional(),
    confluenceApiToken: z.string().optional(),
    persist: z.boolean().optional().default(false),
  }).refine((value) => Boolean(value.sourcePath || value.content || value.contentBase64 || value.confluenceUrl), {
    message: 'Provide sourcePath, content, contentBase64, or confluenceUrl.',
  });

  server.registerTool(
    'convert_document_to_markdown',
    {
      description: 'Convert office, PDF, HTML, or text documents into normalized Markdown without AI interpretation.',
      inputSchema: convertInputSchema,
    },
    async (input) => {
      try {
        const result = await importDocument(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: msg }) }] };
      }
    },
  );

  server.registerTool(
    'fetch_confluence_page',
    {
      description: 'Fetch a Confluence page and convert the page content into Markdown.',
      inputSchema: z.object({
        pageId: z.string().optional(),
        pageUrl: z.string().optional(),
        baseUrl: z.string().optional(),
        user: z.string().optional(),
        token: z.string().optional(),
        apiToken: z.string().optional(),
        persist: z.boolean().optional().default(false),
      }).refine((value) => Boolean(value.pageId || value.pageUrl), {
        message: 'Provide pageId or pageUrl.',
      }),
    },
    async (input) => {
      try {
        const result = await importConfluencePage(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: msg }) }] };
      }
    },
  );

  server.registerTool(
    'analyze_document_for_semantic',
    {
      description: 'Heuristically analyze converted Markdown (from an LLD, architecture doc, or technical description) and generate a semantic.md patch or a full semantic.md draft. Optionally merges with an existing semantic.md.',
      inputSchema: z.object({
        markdown: z.string(),
        existingSemanticMd: z.string().optional(),
        projectName: z.string().optional(),
        outputDir: z.string().optional(),
        persist: z.boolean().optional().default(false),
      }),
    },
    async (input) => {
      const result = analyzeDocumentForSemantic({
        markdown: input.markdown,
        existingSemanticMd: input.existingSemanticMd,
        projectName: input.projectName,
      });

      if (input.persist && input.outputDir && typeof result.mergedSemanticMd === 'string') {
        await fs.mkdir(input.outputDir, { recursive: true });
        const outPath = path.join(input.outputDir, 'source.semantic.md');
        await fs.writeFile(outPath, result.mergedSemanticMd, 'utf8');
        (result as Record<string, unknown>).persistedPath = outPath;
      }

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'extract_application_flows',
    {
      description: 'Synthesise precise application flows by cross-referencing the current source.semantic.md, optionally the code graph (jQAssistant output) and doc-entities extracted from imported documents. Updates the # processes and # data_flows sections of semantic.md.',
      inputSchema: z.object({
        semanticMd: z.string(),
        docEntities: z.any().optional(),
        graphJson: z.any().optional(),
      }),
    },
    async (input) => {
      const result = extractApplicationFlows({
        semanticMd: input.semanticMd,
        docEntities: input.docEntities as DocEntities | undefined,
        graphJson: input.graphJson as GraphJson | undefined,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'validate_doc_code_alignment',
    {
      description: 'Compare doc-derived entities (from doc-entities.json) against the code graph to produce an alignment report identifying gaps in both directions.',
      inputSchema: z.object({
        docEntitiesPath: z.string(),
        artifactRoot: z.string(),
      }),
    },
    async (input) => {
      const result = await validateDocCodeAlignment(input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  return server;
}

// ─── Document conversion helpers ───────────────────────────────────────────

async function importDocument(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sourcePath = typeof input.sourcePath === 'string' ? input.sourcePath : undefined;
  const content = typeof input.content === 'string' ? input.content : undefined;
  const contentBase64 = typeof input.contentBase64 === 'string' ? input.contentBase64 : undefined;
  const fileName = typeof input.fileName === 'string' ? input.fileName : undefined;
  const explicitFormat = typeof input.format === 'string' ? input.format as ImportKind : undefined;
  const persist = input.persist !== false;
  const outputDir = typeof input.outputDir === 'string' ? input.outputDir : undefined;

  // Resolve the effective file name for kind detection and output naming
  const effectivePath = sourcePath ?? fileName;
  const kind = explicitFormat ?? detectKind(effectivePath);

  let extracted: string;
  if (content !== undefined) {
    extracted = content;
  } else if (contentBase64 !== undefined) {
    const buffer = Buffer.from(contentBase64, 'base64');
    extracted = await extractDocumentTextFromBuffer(buffer, effectivePath ?? '', kind);
  } else if (sourcePath) {
    extracted = await extractDocumentText(sourcePath, kind);
  } else {
    extracted = '';
  }
  const markdown = normalizeToMarkdown(extracted, effectivePath ?? 'inline-content');
  const baseName = path.basename(effectivePath ?? 'imported-document', path.extname(effectivePath ?? ''));
  const safeBase = sanitizeName(baseName || 'imported-document');

  let markdownPath: string | undefined;
  let textPath: string | undefined;
  let manifestPath: string | undefined;
  if (persist) {
    const dir = outputDir ?? (sourcePath ? path.join(path.dirname(sourcePath), '.ai-native-imports') : process.cwd());
    await fs.mkdir(dir, { recursive: true });
    markdownPath = path.join(dir, `${safeBase}.md`);
    textPath = path.join(dir, `${safeBase}.txt`);
    manifestPath = path.join(dir, `${safeBase}.import-manifest.json`);
    await fs.writeFile(markdownPath, markdown, 'utf8');
    await fs.writeFile(textPath, extracted, 'utf8');
    await fs.writeFile(manifestPath, JSON.stringify({
      sourcePath, kind, markdownPath, textPath,
      createdAt: new Date().toISOString(),
      warnings: buildWarnings(kind, extracted),
    }, null, 2) + '\n', 'utf8');
  }

  return {
    ok: true, sourcePath, kind, markdownPath, textPath, manifestPath,
    warnings: buildWarnings(kind, extracted),
    markdownPreview: markdown.slice(0, 4000),
    markdown,
  };
}

async function importConfluencePage(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const pageUrl = typeof input.pageUrl === 'string' ? input.pageUrl : undefined;
  const pageId = typeof input.pageId === 'string' ? input.pageId : undefined;
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl : undefined;
  const user = typeof input.user === 'string' ? input.user : undefined;
  const token = typeof input.token === 'string' ? input.token : undefined;
  const apiToken = typeof input.apiToken === 'string' ? input.apiToken : undefined;
  const persist = input.persist !== false;
  const page = await fetchConfluencePage({ pageUrl, pageId, baseUrl, user, token: token ?? apiToken });
  const markdown = normalizeToMarkdown(page.body, page.title ?? page.pageId ?? pageUrl ?? 'Confluence Page');
  let markdownPath: string | undefined;
  if (persist) {
    const dir = path.join(process.cwd(), '.ai-native-imports', 'confluence');
    await fs.mkdir(dir, { recursive: true });
    const safeBase = sanitizeName(page.title || page.pageId || 'confluence-page');
    markdownPath = path.join(dir, `${safeBase}.md`);
    await fs.writeFile(markdownPath, markdown, 'utf8');
  }
  return { ok: true, source: 'confluence', pageId: page.pageId, title: page.title, url: page.url, markdownPath, markdownPreview: markdown.slice(0, 4000), markdown };
}

async function fetchConfluencePage(input: {
  pageUrl?: string; pageId?: string; baseUrl?: string; user?: string; token?: string;
}): Promise<{ pageId?: string; title?: string; url?: string; body: string }> {
  const resolvedInput = {
    ...input,
    baseUrl: input.baseUrl ?? process.env.CONFLUENCE_URL,
  };
  const url = resolveConfluenceApiUrl(resolvedInput);
  const headers: Record<string, string> = { accept: 'application/json' };
  const pat = input.token && !input.user ? input.token : process.env.CONFLUENCE_PERSONAL_TOKEN;
  if (pat) {
    headers.authorization = `Bearer ${pat}`;
  } else if (input.user && input.token) {
    headers.authorization = `Basic ${Buffer.from(`${input.user}:${input.token}`).toString('base64')}`;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Confluence returned ${response.status} for ${url}`);
  const json = await response.json() as any;
  return { pageId: json.id, title: json.title, url: json._links?.webui ? `${input.baseUrl ?? ''}${json._links.webui}` : input.pageUrl, body: extractConfluenceBody(json) };
}

function resolveConfluenceApiUrl(input: { pageUrl?: string; pageId?: string; baseUrl?: string }): string {
  const expand = 'body.storage,body.view,version,space';
  if (input.pageUrl) {
    const match = input.pageUrl.match(/\/pages\/(\d+)/);
    if (match) {
      const pageId = match[1];
      const baseUrl = input.pageUrl.replace(/\/(spaces|pages)\/.*$/, '');
      return `${baseUrl}/rest/api/content/${pageId}?expand=${expand}`;
    }
    return input.pageUrl;
  }
  if (!input.baseUrl || !input.pageId) throw new Error('Requires baseUrl and pageId when pageUrl is not provided.');
  return `${input.baseUrl.replace(/\/$/, '')}/rest/api/content/${encodeURIComponent(input.pageId)}?expand=${expand}`;
}

async function extractDocumentText(sourcePath: string, kind: ImportKind): Promise<string> {
  const buffer = await fs.readFile(sourcePath);
  return extractDocumentTextFromBuffer(buffer, sourcePath, kind);
}

async function extractDocumentTextFromBuffer(buffer: Buffer, nameHint: string, kind: ImportKind): Promise<string> {
  const ext = path.extname(nameHint).toLowerCase();
  if (kind === 'pdf' || ext === '.pdf') {
    const parsed = await pdfParse(buffer);
    return parsed.text?.trim() ?? '';
  }
  if (kind === 'docx' || ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }
  return buffer.toString('utf8');
}

function detectKind(sourcePath?: string): ImportKind {
  if (!sourcePath) return 'unknown';
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === '.docx') return 'docx';
  if (ext === '.doc') return 'doc';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.md' || ext === '.markdown') return 'md';
  if (ext === '.txt') return 'txt';
  return 'unknown';
}

function normalizeToMarkdown(text: string, title: string): string {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return [`# ${sanitizeTitle(title)}`, '', cleaned || '_No text extracted._', ''].join('\n');
}

function sanitizeTitle(value: string): string {
  return value.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Imported Document';
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function buildWarnings(kind: ImportKind, extracted: string): string[] {
  const warnings: string[] = [];
  if (kind === 'pdf' && extracted.length < 50) warnings.push('pdf text extraction returned very little content');
  if (kind === 'doc' && extracted.length === 0) warnings.push('.doc extraction requires an external converter (use .docx instead)');
  return warnings;
}

function extractConfluenceBody(json: any): string {
  // Prefer rendered view HTML (no Confluence macros) over raw storage format
  const viewHtml = json?.body?.view?.value;
  if (typeof viewHtml === 'string' && viewHtml.length > 50) {
    return viewHtml
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<th[^>]*>/gi, ' | ')
      .replace(/<td[^>]*>/gi, ' | ')
      .replace(/<tr[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#[0-9]+;/g, ' ')
      .replace(/&[a-zA-Z]+;/g, ' ')
      // Second pass after &amp; decode (e.g. &amp;lt; → &lt; → <)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  // Fall back to storage format: keep text inside macros, strip only the macro wrapper tags
  const storage = json?.body?.storage?.value;
  if (typeof storage === 'string') {
    return storage
      .replace(/<ac:structured-macro[^>]*>/g, '')
      .replace(/<\/ac:structured-macro>/g, '')
      .replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/g, '')
      .replace(/<ac:rich-text-body[^>]*>/g, '')
      .replace(/<\/ac:rich-text-body>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

// ─── Flow extraction ───────────────────────────────────────────────────────

interface DocEntities {
  components?: string[];
  flows?: string[];
  apis?: string[];
  processes?: string[];
  dataModels?: string[];
  techStack?: string[];
}

interface GraphNode {
  id?: string;
  name?: string;
  type?: string;
  labels?: string[];
}

interface GraphEdge {
  from?: string;
  to?: string;
  type?: string;
  label?: string;
}

interface GraphJson {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
}

function extractApplicationFlows(input: {
  semanticMd: string;
  docEntities?: DocEntities;
  graphJson?: GraphJson;
}): Record<string, unknown> {
  const { semanticMd, docEntities, graphJson } = input;

  // Extract existing processes and data_flows sections
  const processesMatch = semanticMd.match(/^# processes\s*\n([\s\S]*?)(?=^# |\z)/m);
  const dataFlowsMatch = semanticMd.match(/^# data_flows\s*\n([\s\S]*?)(?=^# |\z)/m);

  const existingProcesses = processesMatch?.[1]?.trim() ?? '';
  const existingDataFlows = dataFlowsMatch?.[1]?.trim() ?? '';

  // Gather flows from all sources
  const flowSet = new Set<string>();
  const processSet = new Set<string>();

  // From doc entities
  if (docEntities?.flows) {
    for (const f of docEntities.flows) flowSet.add(f.trim());
  }
  if (docEntities?.processes) {
    for (const p of docEntities.processes) processSet.add(p.trim());
  }

  // From code graph: trace controller → service → repository chains
  if (graphJson?.nodes && graphJson?.edges) {
    const controllers = graphJson.nodes.filter((n) =>
      n.type?.toLowerCase().includes('controller') ||
      n.name?.toLowerCase().endsWith('controller') ||
      n.labels?.some((l) => l.toLowerCase().includes('controller')),
    );
    const repos = graphJson.nodes.filter((n) =>
      n.type?.toLowerCase().includes('repository') ||
      n.name?.toLowerCase().endsWith('repository') ||
      n.name?.toLowerCase().endsWith('repo'),
    );

    for (const ctrl of controllers) {
      const ctrlName = ctrl.name ?? ctrl.id ?? '';
      const domain = ctrlName.replace(/Controller$/i, '');
      // Find services called by this controller
      const serviceEdges = (graphJson.edges ?? []).filter(
        (e) => (e.from === ctrl.id || e.from === ctrl.name) && e.type !== 'IMPLEMENTS',
      );
      if (serviceEdges.length > 0) {
        flowSet.add(`${domain} request flow: ${ctrlName} → ${serviceEdges.map((e) => e.to ?? '').filter(Boolean).join(', ')}`);
      }
    }

    for (const repo of repos) {
      const domain = (repo.name ?? '').replace(/Repository$|Repo$/i, '');
      if (domain) processSet.add(`${domain} persistence`);
    }
  }

  // From existing semantic.md: preserve anything already there
  if (existingProcesses) {
    for (const line of existingProcesses.split('\n')) {
      const trimmed = line.replace(/^[-*]\s*/, '').trim();
      if (trimmed) processSet.add(trimmed);
    }
  }
  if (existingDataFlows) {
    for (const line of existingDataFlows.split('\n')) {
      const trimmed = line.replace(/^[-*]\s*/, '').trim();
      if (trimmed) flowSet.add(trimmed);
    }
  }

  const newProcesses = [...processSet].filter(Boolean).map((p) => `- ${p}`).join('\n');
  const newDataFlows = [...flowSet].filter(Boolean).map((f) => `- ${f}`).join('\n');

  // Replace sections in semanticMd
  let updated = semanticMd;
  const replaceSectionContent = (md: string, sectionName: string, newContent: string): string => {
    const sectionRe = new RegExp(`(^# ${sectionName}\\s*\\n)([\\s\\S]*?)(?=^# |\\z)`, 'm');
    if (sectionRe.test(md)) {
      return md.replace(sectionRe, `$1${newContent}\n\n`);
    }
    return `${md.trimEnd()}\n\n# ${sectionName}\n${newContent}\n`;
  };

  if (newProcesses) updated = replaceSectionContent(updated, 'processes', newProcesses);
  if (newDataFlows) updated = replaceSectionContent(updated, 'data_flows', newDataFlows);

  return {
    ok: true,
    flowCount: flowSet.size,
    processCount: processSet.size,
    updatedSemanticMd: updated,
    extractedFlows: [...flowSet],
    extractedProcesses: [...processSet],
    sources: {
      fromDocs: (docEntities?.flows?.length ?? 0) + (docEntities?.processes?.length ?? 0),
      fromGraph: graphJson?.nodes ? 1 : 0,
      fromExisting: existingProcesses.split('\n').filter(Boolean).length + existingDataFlows.split('\n').filter(Boolean).length,
    },
  };
}

// ─── Doc-code alignment ────────────────────────────────────────────────────

async function validateDocCodeAlignment(input: {
  docEntitiesPath: string;
  artifactRoot: string;
}): Promise<Record<string, unknown>> {
  let docEntities: DocEntities;
  try {
    const raw = await fs.readFile(input.docEntitiesPath, 'utf8');
    docEntities = JSON.parse(raw) as DocEntities;
  } catch {
    return { ok: false, error: 'doc-entities.json not found or invalid. Run Document Import first.' };
  }

  // Try to load graph for code-side entities
  let graphNodes: GraphNode[] = [];
  try {
    const graphDir = path.join(input.artifactRoot, 'graph');
    const entries = await fs.readdir(graphDir);
    const latest = entries.filter((f) => f.endsWith('.graph.json')).sort().pop();
    if (latest) {
      const raw = await fs.readFile(path.join(graphDir, latest), 'utf8');
      const graph = JSON.parse(raw) as GraphJson;
      graphNodes = graph.nodes ?? [];
    }
  } catch { /* no graph */ }

  const docComponents = new Set((docEntities.components ?? []).map((c) => c.toLowerCase()));
  const docFlows = docEntities.flows ?? [];
  const docApis = new Set((docEntities.apis ?? []).map((a) => a.toLowerCase()));

  const codeNames = new Set(
    graphNodes
      .map((n) => (n.name ?? '').toLowerCase())
      .filter(Boolean),
  );

  const matched: string[] = [];
  const docOnlyComponents: string[] = [];
  const codeOnlyComponents: string[] = [];

  for (const comp of docComponents) {
    const found = [...codeNames].some(
      (cn) => cn.includes(comp) || comp.includes(cn.replace(/\..+$/, '')),
    );
    if (found) matched.push(comp);
    else docOnlyComponents.push(comp);
  }

  for (const cn of codeNames) {
    const documented = [...docComponents].some(
      (dc) => cn.includes(dc) || dc.includes(cn.replace(/\..+$/, '')),
    );
    if (!documented && cn.match(/(service|controller|repository|handler|manager)$/i)) {
      codeOnlyComponents.push(cn);
    }
  }

  const lines: string[] = [
    '# Doc-Code Alignment Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    `- Documented components: ${docComponents.size}`,
    `- Code components checked: ${codeNames.size}`,
    `- Matched: ${matched.length}`,
    `- In docs, not in code: ${docOnlyComponents.length}`,
    `- In code, not in docs: ${codeOnlyComponents.length}`,
    '',
  ];

  if (matched.length) {
    lines.push('## Matched', '', ...matched.map((c) => `- ✓ ${c}`), '');
  }
  if (docOnlyComponents.length) {
    lines.push('## In documentation but not found in code', '', ...docOnlyComponents.map((c) => `- ⚠ ${c}`), '');
  }
  if (codeOnlyComponents.length) {
    lines.push('## In code but not documented', '', ...codeOnlyComponents.map((c) => `- ℹ ${c}`), '');
  }
  if (docFlows.length) {
    lines.push('## Documented flows', '', ...docFlows.map((f) => `- ${f}`), '');
  }

  return {
    ok: true,
    reportMd: lines.join('\n'),
    matched: matched.length,
    docOnly: docOnlyComponents.length,
    codeOnly: codeOnlyComponents.length,
  };
}

// ─── Entry point ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await startMcpServer(createServer, { serviceName: 'document-import' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
