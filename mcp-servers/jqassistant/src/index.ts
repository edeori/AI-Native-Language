import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getDefaultJqassistantConfig,
  startMcpServer,
  type JqassistantArtifact,
  type SourceProjectAnalysis,
} from '@ai-native/semantic-shared';

function createServer() {
  const server = new McpServer({
    name: 'ai-native-jqassistant',
    version: '0.1.0',
  });

  server.registerTool(
    'jqassistant_probe',
    {
      description: 'Check whether the jqassistant CLI is available in the MCP server runtime.',
      inputSchema: z.object({
        command: z.string().optional(),
        timeoutMs: z.number().int().min(1000).max(600000).optional(),
      }),
    },
    async ({ command, timeoutMs }) => {
      const config = getDefaultJqassistantConfig();
      const resolvedCommand = (command?.trim() || config.command);
      const probe = await probeCommand(resolvedCommand, timeoutMs ?? config.timeoutMs);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(probe, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'jqassistant_scan_project',
    {
      description: 'Run jqassistant scan against a project root inside the MCP runtime and return a deterministic scan artifact.',
      inputSchema: z.object({
        projectName: z.string(),
        projectRoot: z.string(),
        outputDir: z.string().optional(),
        command: z.string().optional(),
        timeoutMs: z.number().int().min(1000).max(1800000).optional(),
        analysis: z.any().optional(),
      }),
    },
    async ({ projectName, projectRoot, outputDir, command, timeoutMs, analysis }) => {
      const defaults = getDefaultJqassistantConfig();
      const resolvedCommand = (command?.trim() || defaults.command);
      const probe = await probeCommand(resolvedCommand, timeoutMs ?? defaults.timeoutMs);
      const runtimeDir = outputDir?.trim()
        ? join(outputDir, '.jqassistant-runtime')
        : join(projectRoot, '.ai-native', 'jqassistant-runtime');
      await mkdir(runtimeDir, { recursive: true });
      const ports = {
        http: await findAvailablePort(),
        bolt: await findAvailablePort(),
      };
      await writeRuntimeConfig(runtimeDir, ports);

      const summary = summarizeAnalysis(analysis as SourceProjectAnalysis | undefined);
      let mergeEvidence = buildMergeEvidence(analysis as SourceProjectAnalysis | undefined);
      let graphs: JqassistantArtifact['graphs'] | undefined;
      let artifact: JqassistantArtifact;
      if (!probe.ok) {
        artifact = {
          schemaVersion: '1.0',
          generatedAt: new Date().toISOString(),
          status: 'failed',
          projectName,
          projectRoot,
          enabled: true,
          command: resolvedCommand,
          scanMode: 'scan-only',
          detectedBinary: false,
          runtimeDir,
          summary,
          graphs,
          mergeEvidence,
          warnings: ['jqassistant MCP runtime could not find the jqassistant binary.'],
          error: probe.message,
        };
      } else {
        const scan = await runScan(probe.commandPath!, projectRoot, runtimeDir, timeoutMs ?? defaults.timeoutMs);
        const queriedEvidence = scan.ok
          ? await queryMergeEvidenceFromStore(probe.commandPath!, runtimeDir, ports, timeoutMs ?? defaults.timeoutMs)
          : undefined;
        if (queriedEvidence) {
          mergeEvidence = queriedEvidence.mergeEvidence
            ? (mergeEvidence
              ? mergeMergeEvidence(mergeEvidence, queriedEvidence.mergeEvidence)
              : queriedEvidence.mergeEvidence)
            : mergeEvidence;
          graphs = queriedEvidence.graphs;
          Object.assign(summary, queriedEvidence.summaryPatch ?? {});
        }
        artifact = {
          schemaVersion: '1.0',
          generatedAt: new Date().toISOString(),
          status: scan.ok ? 'completed' : 'failed',
          projectName,
          projectRoot,
          enabled: true,
          command: resolvedCommand,
          commandLine: `${probe.commandPath} scan -f ${projectRoot}`,
          scanMode: 'scan-only',
          detectedBinary: true,
          version: probe.version,
          runtimeDir,
          stdoutSnippet: truncateText(scan.stdout),
          stderrSnippet: truncateText(scan.stderr),
          summary,
          graphs,
          mergeEvidence,
          warnings: [
            ...(scan.ok ? [] : ['jqassistant scan failed inside the MCP runtime.']),
            ...((scan.ok && !queriedEvidence) ? ['jqassistant scan completed, but no queryable merge evidence was extracted from the store.'] : []),
          ],
          error: scan.ok ? undefined : (scan.error ?? 'scan failed'),
        };
      }

      if (outputDir?.trim()) {
        const artifactPath = join(outputDir, 'source.jqassistant.json');
        await writeFile(artifactPath, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(artifact, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

async function main() {
  await startMcpServer(createServer, { serviceName: 'jqassistant' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function probeCommand(command: string, timeoutMs: number): Promise<{
  ok: boolean;
  command: string;
  commandPath?: string;
  version?: string;
  message: string;
}> {
  const commandPath = await resolveCommand(command);
  if (!commandPath) {
    return {
      ok: false,
      command,
      message: `jqassistant command not found: ${command}`,
    };
  }
  const version = await runVersionProbe(commandPath, timeoutMs);
  if (!version) {
    return {
      ok: false,
      command,
      commandPath,
      message: `jqassistant found at ${commandPath}, but version probe failed.`,
    };
  }
  return {
    ok: true,
    command,
    commandPath,
    version,
    message: `jqassistant available: ${version}`,
  };
}

async function resolveCommand(command: string): Promise<string | undefined> {
  const { execFile } = await import('node:child_process');
  return await new Promise((resolve) => {
    execFile('sh', ['-lc', `command -v ${shellEscape(command)}`], { timeout: 15000 }, (error, stdout) => {
      if (error) return resolve(undefined);
      const value = stdout.trim();
      resolve(value || undefined);
    });
  });
}

async function runVersionProbe(commandPath: string, timeoutMs: number): Promise<string | undefined> {
  const { execFile } = await import('node:child_process');
  return await new Promise((resolve) => {
    execFile(commandPath, ['--version'], { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) return resolve(undefined);
      const text = `${stdout}\n${stderr}`.trim();
      resolve(text ? text.split('\n')[0]?.trim() : undefined);
    });
  });
}

async function runScan(
  commandPath: string,
  projectRoot: string,
  runtimeDir: string,
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  const { execFile } = await import('node:child_process');
  return await new Promise((resolve) => {
    execFile(commandPath, ['scan', '-f', projectRoot], {
      cwd: runtimeDir,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, stdout, stderr, error: error.message });
        return;
      }
      resolve({ ok: true, stdout, stderr });
    });
  });
}

function summarizeAnalysis(analysis?: SourceProjectAnalysis): JqassistantArtifact['summary'] {
  return {
    applicationCount: analysis?.applicationLayouts.length ?? 0,
    applications: analysis?.applicationLayouts.map((layout) => layout.appRoot) ?? [],
    moduleCount: analysis?.modules.length ?? 0,
    modules: analysis?.modules ?? [],
    technologyCount: analysis?.technologies.length ?? 0,
    technologies: analysis?.technologies ?? [],
  };
}

function buildMergeEvidence(analysis?: SourceProjectAnalysis): JqassistantArtifact['mergeEvidence'] | undefined {
  if (!analysis) return undefined;
  return {
    multiModuleMaven: analysis.repositoryStructure?.multiModuleMaven,
    topLevelProjects: analysis.repositoryStructure?.topLevelProjects ?? [],
    backendSupportModules: analysis.repositoryStructure?.backendSupportModules ?? [],
    backendRuntimeLayers: analysis.repositoryStructure?.backendRuntimeLayers ?? [],
    applicationLayouts: (analysis.applicationLayouts ?? []).map((layout) => ({
      appRoot: layout.appRoot,
      role: layout.role,
      multiModule: layout.multiModule,
      moduleRoots: layout.moduleRoots,
      internalModules: layout.internalModules.map((module) => ({
        name: module.name,
        purpose: module.purpose,
        source: module.source,
        pathHints: module.pathHints,
      })),
    })),
  };
}

async function writeRuntimeConfig(runtimeDir: string, ports: { http: number; bolt: number }): Promise<void> {
  const config = [
    'jqassistant:',
    '  store:',
    '    uri: file://target/jqassistant/store',
    '    embedded:',
    '      connector-enabled: true',
    '      listen-address: localhost',
    `      bolt-port: ${ports.bolt}`,
    `      http-port: ${ports.http}`,
    '  scan:',
    '    reset: true',
    '    continue-on-error: true',
    '',
  ].join('\n');
  await writeFile(join(runtimeDir, '.jqassistant.yml'), config, 'utf8');
}

async function queryMergeEvidenceFromStore(
  commandPath: string,
  runtimeDir: string,
  ports: { http: number; bolt: number },
  timeoutMs: number,
): Promise<{ mergeEvidence?: JqassistantArtifact['mergeEvidence']; graphs?: JqassistantArtifact['graphs']; summaryPatch?: Partial<JqassistantArtifact['summary']> } | undefined> {
  const server = await startServer(commandPath, runtimeDir, timeoutMs);
  try {
    const ready = await waitForHttpReady(`http://127.0.0.1:${ports.http}`, timeoutMs);
    if (!ready) return undefined;

    const [projectRows, moduleRows, packageRows, typeRows, dependencyRows] = await Promise.all([
      postCypher(`http://127.0.0.1:${ports.http}`, `
        MATCH (p:Maven:Project)
        RETURN p.artifactId AS artifactId, p.groupId AS groupId, p.name AS name
        ORDER BY artifactId
      `),
      postCypher(`http://127.0.0.1:${ports.http}`, `
        MATCH (p:Maven:Pom)-[:HAS_MODULE]->(m:Maven:Module)
        RETURN p.artifactId AS parentArtifactId, m.name AS moduleName
        ORDER BY parentArtifactId, moduleName
      `),
      postCypher(`http://127.0.0.1:${ports.http}`, `
        MATCH (p:Java:Package)
        RETURN p.fqn AS fqn
        ORDER BY fqn
        LIMIT 1000
      `),
      postCypher(`http://127.0.0.1:${ports.http}`, `
        MATCH (t:Java:Type)
        RETURN t.fqn AS fqn
        ORDER BY fqn
        LIMIT 2000
      `),
      postCypher(`http://127.0.0.1:${ports.http}`, `
        MATCH (s:Java:Type)-[:DEPENDS_ON]->(t:Java:Type)
        RETURN s.fqn AS fromType, t.fqn AS toType
        ORDER BY fromType, toType
        LIMIT 4000
      `),
    ]);

    return deriveQueryArtifacts(projectRows, moduleRows, packageRows, typeRows, dependencyRows);
  } finally {
    server.kill('SIGTERM');
  }
}

async function startServer(commandPath: string, runtimeDir: string, timeoutMs: number) {
  const { spawn } = await import('node:child_process');
  const child = spawn(commandPath, ['server'], {
    cwd: runtimeDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const killer = setTimeout(() => {
    child.kill('SIGTERM');
  }, timeoutMs);
  child.once('exit', () => clearTimeout(killer));
  return child;
}

async function waitForHttpReady(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.status >= 200 && response.status < 500) {
        return true;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function postCypher(baseUrl: string, statement: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${baseUrl}/db/neo4j/tx/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      statements: [{ statement }],
    }),
  });
  if (!response.ok) {
    return [];
  }
  const payload = await response.json() as {
    results?: Array<{ columns?: string[]; data?: Array<{ row?: unknown[] }> }>;
  };
  const result = payload.results?.[0];
  const columns = result?.columns ?? [];
  const data = result?.data ?? [];
  return data.map((item) => {
    const row = item.row ?? [];
    return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
  });
}

function deriveQueryArtifacts(
  projectRows: Array<Record<string, unknown>>,
  moduleRows: Array<Record<string, unknown>>,
  packageRows: Array<Record<string, unknown>>,
  typeRows: Array<Record<string, unknown>>,
  dependencyRows: Array<Record<string, unknown>>,
): { mergeEvidence?: JqassistantArtifact['mergeEvidence']; graphs?: JqassistantArtifact['graphs']; summaryPatch?: Partial<JqassistantArtifact['summary']> } | undefined {
  if (!projectRows.length && !moduleRows.length && !packageRows.length && !typeRows.length && !dependencyRows.length) {
    return undefined;
  }

  const topLevelProjects = projectRows
    .map((row) => {
      const artifactId = String(row.artifactId ?? '').trim();
      const name = artifactId || String(row.name ?? '').trim();
      if (!name) return undefined;
      return {
        name,
        role: artifactId.includes('notification')
          ? 'separate notification application identified from jQAssistant Maven project scan'
          : 'top-level Maven project identified from jQAssistant scan',
      };
    })
    .filter((item): item is { name: string; role: string } => Boolean(item));

  const backendSupportModules = moduleRows
    .map((row) => String(row.moduleName ?? '').trim())
    .filter((name) => /versions|bom|build/.test(name))
    .map((name) => ({
      name: `event-backend/${name}`,
      role: 'module identified from jQAssistant Maven scan',
    }));

  const backendRuntimeLayers = moduleRows
    .map((row) => String(row.moduleName ?? '').trim())
    .filter((name) => /api|app|common|persistence|service|web/.test(name))
    .map((name) => ({
      name: `event-backend/${name}`,
      role: 'runtime layer identified from jQAssistant Maven scan',
    }));

  const packageHints = packageRows
    .map((row) => String(row.fqn ?? '').trim())
    .filter(Boolean);
  const typeCatalog = typeRows
    .map((row) => String(row.fqn ?? '').trim())
    .filter(Boolean);
  const dependencyCatalog = dependencyRows
    .map((row) => ({
      fromType: String(row.fromType ?? '').trim(),
      toType: String(row.toType ?? '').trim(),
    }))
    .filter((row) => row.fromType && row.toType);
  const notificationPackages = packageHints.filter((item) => /notification/i.test(item));

  const applicationLayouts: NonNullable<JqassistantArtifact['mergeEvidence']>['applicationLayouts'] = [];
  if (topLevelProjects.length) {
    for (const project of topLevelProjects) {
      const moduleRoots = moduleRows
        .filter((row) => String(row.parentArtifactId ?? '').trim() === project.name)
        .map((row) => `${project.name}/${String(row.moduleName ?? '').trim()}`)
        .filter(Boolean);
      applicationLayouts.push({
        appRoot: project.name,
        role: project.role,
        multiModule: moduleRoots.length > 0,
        moduleRoots: moduleRoots.length ? moduleRoots : [project.name],
        internalModules: moduleRoots.map((root) => ({
          name: root.split('/').pop() ?? root,
          purpose: 'internal module identified from jQAssistant Maven scan',
          source: 'jqassistant',
          pathHints: [root],
        })),
      });
    }
  } else if (notificationPackages.length) {
    applicationLayouts.push({
      appRoot: 'event-notification',
      role: 'single-module application inferred from jQAssistant package scan',
      multiModule: false,
      moduleRoots: ['event-notification'],
      internalModules: unique(notificationPackages.map((pkg) => pkg.split('.').slice(0, 2).join('.')))
        .map((name) => ({
          name,
          purpose: 'package slice identified from jQAssistant Java package scan',
          source: 'jqassistant',
          pathHints: [name.replaceAll('.', '/')],
        })),
    });
  }

  const packageRelations = summarizePackageRelations(dependencyCatalog);
  const graphs: NonNullable<JqassistantArtifact['graphs']> = {
    projectGraph: {
      projects: projectRows
        .map((row) => ({
          artifactId: String(row.artifactId ?? '').trim(),
          groupId: String(row.groupId ?? '').trim() || undefined,
          name: String(row.name ?? '').trim() || undefined,
        }))
        .filter((row) => row.artifactId),
      modules: moduleRows
        .map((row) => ({
          parentArtifactId: String(row.parentArtifactId ?? '').trim(),
          moduleName: String(row.moduleName ?? '').trim(),
        }))
        .filter((row) => row.parentArtifactId && row.moduleName),
    },
    packageGraph: {
      packages: packageHints,
      relations: packageRelations,
    },
    typeGraph: {
      types: typeCatalog.map((fqn) => ({
        fqn,
        packageName: packageNameOfFqn(fqn),
        simpleName: simpleNameOfFqn(fqn),
        kind: inferTypeKindFromFqn(fqn),
      })),
      dependencies: dependencyCatalog.map((row) => ({
        fromType: row.fromType,
        toType: row.toType,
        fromPackage: packageNameOfFqn(row.fromType),
        toPackage: packageNameOfFqn(row.toType),
      })),
    },
  };

  return {
    mergeEvidence: {
      multiModuleMaven: moduleRows.length > 0,
      topLevelProjects,
      backendSupportModules,
      backendRuntimeLayers,
      applicationLayouts,
    },
    graphs,
    summaryPatch: {
      packageCount: packageHints.length,
      packageRelationCount: packageRelations.length,
      typeCount: typeCatalog.length,
      typeDependencyCount: dependencyCatalog.length,
    },
  };
}

function mergeMergeEvidence(
  base: NonNullable<JqassistantArtifact['mergeEvidence']>,
  incoming: NonNullable<JqassistantArtifact['mergeEvidence']>,
): NonNullable<JqassistantArtifact['mergeEvidence']> {
  return {
    multiModuleMaven: incoming.multiModuleMaven ?? base.multiModuleMaven,
    topLevelProjects: uniqueBy([...(base.topLevelProjects ?? []), ...(incoming.topLevelProjects ?? [])], (item) => item.name),
    backendSupportModules: uniqueBy([...(base.backendSupportModules ?? []), ...(incoming.backendSupportModules ?? [])], (item) => item.name),
    backendRuntimeLayers: uniqueBy([...(base.backendRuntimeLayers ?? []), ...(incoming.backendRuntimeLayers ?? [])], (item) => item.name),
    applicationLayouts: uniqueBy([...(base.applicationLayouts ?? []), ...(incoming.applicationLayouts ?? [])], (item) => item.appRoot),
  };
}

function summarizePackageRelations(
  dependencies: Array<{ fromType: string; toType: string }>,
): Array<{ fromPackage: string; toPackage: string; count: number }> {
  const counts = new Map<string, number>();
  for (const dependency of dependencies) {
    const fromPackage = packageNameOfFqn(dependency.fromType);
    const toPackage = packageNameOfFqn(dependency.toType);
    if (!fromPackage || !toPackage || fromPackage === toPackage) continue;
    const key = `${fromPackage}=>${toPackage}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [fromPackage, toPackage] = key.split('=>');
      return { fromPackage, toPackage, count };
    })
    .sort((left, right) => right.count - left.count || left.fromPackage.localeCompare(right.fromPackage))
    .slice(0, 500);
}

function packageNameOfFqn(fqn: string): string | undefined {
  const normalized = fqn.trim();
  const index = normalized.lastIndexOf('.');
  if (index <= 0) return undefined;
  return normalized.slice(0, index);
}

function simpleNameOfFqn(fqn: string): string {
  const normalized = fqn.trim();
  const index = normalized.lastIndexOf('.');
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function inferTypeKindFromFqn(fqn: string): string | undefined {
  const normalized = fqn.toLowerCase();
  if (normalized.includes('.controller.') || normalized.endsWith('controller')) return 'controller';
  if (normalized.includes('.service.') || normalized.endsWith('service')) return 'service';
  if (normalized.includes('.repository.') || normalized.endsWith('repository')) return 'repository';
  if (normalized.includes('.config.') || normalized.endsWith('config') || normalized.endsWith('configuration')) return 'configuration';
  if (normalized.includes('.domain.') || normalized.endsWith('entity')) return 'domain';
  if (normalized.includes('.listener.') || normalized.endsWith('listener')) return 'listener';
  if (normalized.includes('.job.') || normalized.endsWith('job')) return 'job';
  return undefined;
}

async function findAvailablePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine free port.'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], keyFn: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = keyFn(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function truncateText(value: string, limit = 4000): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`;
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
