#!/usr/bin/env node
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSourceProjectState } from '../mcp-servers/shared/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const args = parseArgs(process.argv.slice(2));
if (!args.root) throw new Error('Missing required --root <project-root>');
if (!args.name) throw new Error('Missing required --name <project-name>');

const projectRoot = resolve(repoRoot, args.root);
const projectName = String(args.name);
const outputDir = resolve(repoRoot, args.out ?? `.ai-native/learning/${slugify(projectName)}`);

const result = await importSourceProjectState({
  projectRoot,
  projectName,
  outputDir,
  force: args.force,
});

console.log(`Imported ${result.projectName}`);
console.log(`Wrote ${relative(repoRoot, result.analysisPath)}`);
console.log(`Wrote ${relative(repoRoot, result.analysisMdPath)}`);
console.log(`Wrote ${relative(repoRoot, result.snapshotPath)}`);
console.log(`Wrote ${relative(repoRoot, result.semanticJsonPath)}`);
console.log(`Wrote ${relative(repoRoot, result.reconnaissancePath)}`);
console.log(`${result.reconnaissancePromptWritten ? 'Wrote' : 'Prepared'} ${relative(repoRoot, result.reconnaissancePromptPath)} (MCP plugin flow writes the final prompt)`);
console.log(`Wrote ${relative(repoRoot, result.databaseSchemaPath)}`);
console.log(`Wrote ${relative(repoRoot, result.databaseSchemaMdPath)}`);
console.log(`Wrote ${relative(repoRoot, result.suggestedSemanticPath)}`);
console.log(`Wrote ${relative(repoRoot, result.semanticPath)}`);
console.log(`Wrote ${relative(repoRoot, result.graphPath)}`);
console.log(`Wrote ${relative(repoRoot, result.statePath)}`);
console.log(`Wrote ${relative(repoRoot, result.readmePath)}`);

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
    if (flag === '--force') result.force = value === true ? true : value !== 'false';
    if (!token.includes('=') && rawValue && !rawValue.startsWith('--')) index += 1;
  }
  return result;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'project';
}
