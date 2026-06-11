#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const args = parseArgs(process.argv.slice(2));
const manifestPath = resolve(repoRoot, args.manifest ?? 'reference-projects/manifest.json');

if (!existsSync(manifestPath)) {
  throw new Error(`Manifest not found: ${manifestPath}`);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!manifest?.projects || !Array.isArray(manifest.projects)) {
  throw new Error(`Invalid manifest: expected { projects: [...] } at ${relative(repoRoot, manifestPath)}`);
}

const failures = [];
for (const project of manifest.projects) {
  const root = resolve(repoRoot, project.root);
  const out = project.out ? resolve(repoRoot, project.out) : resolve(repoRoot, 'reference-projects', project.name);
  const name = project.name;
  if (!name || !project.root) {
    failures.push({ name: name ?? '<missing-name>', reason: 'Missing project.name or project.root' });
    continue;
  }

  const result = spawnSync(
    'node',
    [
      join(repoRoot, 'tools/reference-ingest.mjs'),
      '--root',
      root,
      '--name',
      name,
      '--out',
      out,
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );

  if (result.status !== 0) {
    failures.push({ name, reason: `reference-ingest exited with ${result.status ?? 'unknown'}` });
  }
}

if (failures.length > 0) {
  console.error(JSON.stringify({ failures }, null, 2));
  process.exit(1);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [flag, rawValue] = token.includes('=') ? token.split(/=(.*)/s, 2) : [token, argv[index + 1]];
    const value = rawValue && !rawValue.startsWith('--') ? rawValue : true;
    if (flag === '--manifest') result.manifest = value;
    if (!token.includes('=') && rawValue && !rawValue.startsWith('--')) index += 1;
  }
  return result;
}
