#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSemanticMarkdown, generateCanonicalGraph } from '../mcp-servers/shared/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const args = parseArgs(process.argv.slice(2));
if (!args.root) {
  throw new Error('Missing required --root <project-root>');
}
if (!args.name) {
  throw new Error('Missing required --name <project-name>');
}
if (!args.out) {
  throw new Error('Missing required --out <output-dir>');
}

const projectRoot = resolve(repoRoot, args.root);
const projectName = args.name;
const outputDir = resolve(repoRoot, args.out);
const semanticPath = resolve(outputDir, `${projectName}.reference.semantic.md`);
const graphPath = resolve(outputDir, `${projectName}.reference.graph.json`);
const analysisPath = resolve(outputDir, `${projectName}.analysis.json`);
const analysisMdPath = resolve(outputDir, `${projectName}.analysis.md`);

await mkdir(outputDir, { recursive: true });

const analysis = await analyzeProject(projectRoot, projectName);
await writeFile(analysisPath, JSON.stringify(analysis, null, 2) + '\n');
await writeFile(analysisMdPath, renderAnalysisMarkdown(analysis));

if (!existsSync(semanticPath)) {
  throw new Error(`Missing semantic reference slice: ${semanticPath}`);
}

const semanticMarkdown = await readFile(semanticPath, 'utf8');
const document = parseSemanticMarkdown(semanticMarkdown, semanticPath);
const graph = generateCanonicalGraph(document);
await writeFile(graphPath, JSON.stringify(graph, null, 2) + '\n');

console.log(`Wrote ${relative(repoRoot, analysisPath)}`);
console.log(`Wrote ${relative(repoRoot, analysisMdPath)}`);
console.log(`Wrote ${relative(repoRoot, graphPath)}`);

async function analyzeProject(root, name) {
  const pomFiles = await collectFiles(root, 'pom.xml');
  const javaFiles = await collectFiles(root, '.java');
  const yamlFiles = await collectFiles(root, '.yaml', '.yml');

  const modules = pomFiles
    .map((file) => relative(root, dirname(file)).split(sep).join('/'))
    .filter((path) => path && path !== '.')
    .sort((left, right) => left.localeCompare(right));

  const counts = {
    pomFiles: pomFiles.length,
    javaFiles: javaFiles.length,
    yamlFiles: yamlFiles.length,
    controllers: countMatch(javaFiles, /ApiImpl\.java$|Controller\.java$/),
    services: countMatch(javaFiles, /Service\.java$/),
    repositories: countMatch(javaFiles, /Repository\.java$/),
    entities: countMatch(javaFiles, /Entity\.java$/),
    policies: countMatch(javaFiles, /guard\/policies\//),
    configs: countMatch(javaFiles, /Config\.java$|Configuration\.java$/),
    jobs: countMatch(javaFiles, /service\/jobs\//),
    listeners: countMatch(javaFiles, /service\/listeners\//),
    securityClasses: countMatch(javaFiles, /security\//),
  };

  const rolePaths = {
    controllers: javaFiles.filter((file) => /\/web\/controller\/.*ApiImpl\.java$/.test(file)),
    services: javaFiles.filter((file) => /\/service\/services\/.*Service\.java$/.test(file)),
    repositories: javaFiles.filter((file) => /\/persistence\/repository\/.*Repository\.java$/.test(file)),
    entities: javaFiles.filter((file) => /\/persistence\/entity\/.*Entity\.java$/.test(file)),
    policies: javaFiles.filter((file) => /\/service\/guard\/policies\//.test(file)),
    security: javaFiles.filter((file) => /\/common\/security\//.test(file)),
    configs: javaFiles.filter((file) => /(?:Config|Configuration)\.java$/.test(file)),
    jobs: javaFiles.filter((file) => /\/service\/jobs\//.test(file)),
    listeners: javaFiles.filter((file) => /\/service\/listeners\//.test(file)),
  };

  const technologies = unique([
    ...(await collectPomKeywords(pomFiles)),
    ...(await collectYamlKeywords(yamlFiles)),
  ]).sort((left, right) => left.localeCompare(right));

  const layers = {
    api: javaFiles.filter((file) => /\/api\//.test(file)).length,
    web: javaFiles.filter((file) => /\/web\//.test(file)).length,
    service: javaFiles.filter((file) => /\/service\//.test(file)).length,
    persistence: javaFiles.filter((file) => /\/persistence\//.test(file)).length,
    common: javaFiles.filter((file) => /\/common\//.test(file)).length,
    app: javaFiles.filter((file) => /\/app\//.test(file)).length,
  };

  return {
    projectName: name,
    projectRoot: root,
    modules,
    counts,
    layers,
    technologies,
    roles: Object.fromEntries(
      Object.entries(rolePaths).map(([key, values]) => [key, values.map((file) => relative(root, file).split(sep).join('/'))]),
    ),
    keyPaths: {
      applicationYaml: firstExisting(yamlFiles, /application\.yaml$/),
      securityYaml: firstExisting(yamlFiles, /security\.yaml$/),
      openApiYaml: firstExisting(yamlFiles, /event-api\.yaml$/),
    },
    observations: deriveObservations({ modules, counts, technologies }),
  };
}

function deriveObservations(analysis) {
  const observations = [];
  if (analysis.modules.length > 1) observations.push('multi-module Maven architecture');
  if (analysis.counts.controllers >= 10) observations.push('broad REST surface');
  if (analysis.counts.services >= 10) observations.push('substantial service orchestration layer');
  if (analysis.counts.repositories >= 10) observations.push('rich persistence and query layer');
  if (analysis.technologies.some((item) => /jwt/i.test(item))) observations.push('JWT-based security boundary');
  if (analysis.technologies.some((item) => /redis/i.test(item))) observations.push('Redis-backed runtime integration');
  if (analysis.technologies.some((item) => /flyway/i.test(item))) observations.push('schema migration pipeline');
  if (analysis.technologies.some((item) => /websocket/i.test(item))) observations.push('real-time push channel');
  if (analysis.technologies.some((item) => /minio|s3/i.test(item))) observations.push('object storage integration');
  if (analysis.technologies.some((item) => /openapi/i.test(item))) observations.push('contract-first HTTP layer');
  return unique(observations);
}

async function collectFiles(root, suffixOrPattern, secondary) {
  const files = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'target' || entry.name === 'node_modules' || entry.name === '.git') continue;
        queue.push(full);
        continue;
      }
      if (typeof suffixOrPattern === 'string') {
        if (full.endsWith(suffixOrPattern) || (secondary && full.endsWith(secondary))) files.push(full);
      } else if (suffixOrPattern.test(full)) {
        files.push(full);
      }
    }
  }
  return files.sort();
}

function countMatch(files, matcher) {
  return files.filter((file) => matcher.test(file)).length;
}

async function collectPomKeywords(files) {
  const keywords = [];
  for (const file of files) {
    const text = (await readFile(file, 'utf8')).toLowerCase();
    for (const keyword of ['spring-boot', 'spring-security', 'jwt', 'postgresql', 'redis', 'flyway', 'websocket', 'openapi', 'minio', 'mail', 'lombok', 's3']) {
      if (text.includes(keyword)) keywords.push(keyword);
    }
  }
  return keywords;
}

async function collectYamlKeywords(files) {
  const keywords = [];
  for (const file of files) {
    const text = (await readFile(file, 'utf8')).toLowerCase();
    for (const keyword of ['spring', 'datasource', 'redis', 'flyway', 'jwt', 'turnstile', 'mail', 'minio', 'cors', 'security']) {
      if (text.includes(keyword)) keywords.push(keyword);
    }
  }
  return keywords;
}

function firstExisting(files, matcher) {
  const file = files.find((entry) => matcher.test(entry));
  return file ? file : undefined;
}

function renderAnalysisMarkdown(analysis) {
  return `# ${analysis.projectName} reference analysis\n\n` +
    `## Architecture shape\n` +
    `- modules: ${analysis.modules.length}\n` +
    `- controllers: ${analysis.counts.controllers}\n` +
    `- services: ${analysis.counts.services}\n` +
    `- repositories: ${analysis.counts.repositories}\n` +
    `- entities: ${analysis.counts.entities}\n` +
    `- policies: ${analysis.counts.policies}\n` +
    `- configs: ${analysis.counts.configs}\n` +
    `- jobs: ${analysis.counts.jobs}\n` +
    `- listeners: ${analysis.counts.listeners}\n\n` +
    `## Modules\n` +
    analysis.modules.map((module) => `- ${module}`).join('\n') + '\n\n' +
    `## Architecture relationships\n` +
    `- api defines the contract-first HTTP surface and DTO layer\n` +
    `- web implements REST controllers and delegates to service\n` +
    `- service orchestrates business logic and depends on persistence and common\n` +
    `- persistence owns repositories, entities, and query logic\n` +
    `- common owns shared security, Redis, notification, and utility code\n` +
    `- app bootstraps the Spring Boot application and imports the runtime configuration\n` +
    `- event-notification is a separate real-time notification service with Redis and WebSocket support\n\n` +
    `## Key classes\n` +
    renderRoleSection('controllers', analysis.roles.controllers) + '\n' +
    renderRoleSection('services', analysis.roles.services) + '\n' +
    renderRoleSection('repositories', analysis.roles.repositories) + '\n' +
    renderRoleSection('security', analysis.roles.security) + '\n' +
    renderRoleSection('policies', analysis.roles.policies) + '\n' +
    renderRoleSection('configs', analysis.roles.configs) + '\n' +
    renderRoleSection('jobs', analysis.roles.jobs) + '\n' +
    renderRoleSection('listeners', analysis.roles.listeners) + '\n' +
    renderRoleSection('entities', analysis.roles.entities) + '\n' +
    `## Technologies\n` +
    analysis.technologies.map((technology) => `- ${technology}`).join('\n') + '\n\n' +
    `## Observations\n` +
    analysis.observations.map((observation) => `- ${observation}`).join('\n') + '\n';
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function renderRoleSection(label, items) {
  const preview = items.slice(0, 16);
  return `### ${label}\n` + (preview.length ? preview.map((item) => `- ${item}`).join('\n') : '- none detected') + '\n\n';
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [flag, rawValue] = token.includes('=') ? token.split(/=(.*)/s, 2) : [token, argv[index + 1]];
    const value = rawValue && !rawValue.startsWith('--') ? rawValue : true;
    if (flag === '--root') result.root = value;
    if (flag === '--out') result.out = value;
    if (flag === '--name') result.name = value;
    if (!token.includes('=') && rawValue && !rawValue.startsWith('--')) index += 1;
  }
  return result;
}
