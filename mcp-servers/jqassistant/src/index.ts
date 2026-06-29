import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import neo4j from 'neo4j-driver';
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

  server.registerTool(
    'jqassistant_scan_files',
    {
      description: 'Run jqassistant scan against uploaded project files (pom.xml, .java, .class). Files are written to a temp dir, scanned, then cleaned up. Use this when the project is not on the MCP server filesystem. Binary files (e.g. .class) should be base64-encoded with encoding="base64".',
      inputSchema: z.object({
        projectName: z.string(),
        files: z.array(z.object({ path: z.string(), content: z.string(), encoding: z.enum(['utf8', 'base64']).optional() })),
        outputDir: z.string().optional(),
        command: z.string().optional(),
        timeoutMs: z.number().int().min(1000).max(1800000).optional(),
        analysis: z.any().optional(),
      }),
    },
    async ({ projectName, files, outputDir, command, timeoutMs, analysis }) => {
      const defaults = getDefaultJqassistantConfig();
      const resolvedCommand = (command?.trim() || defaults.command);
      const probe = await probeCommand(resolvedCommand, timeoutMs ?? defaults.timeoutMs);
      const summary = summarizeAnalysis(analysis as SourceProjectAnalysis | undefined);
      let mergeEvidence = buildMergeEvidence(analysis as SourceProjectAnalysis | undefined);
      let graphs: JqassistantArtifact['graphs'] | undefined;
      let artifact: JqassistantArtifact;

      const log = (message: string) => {
        console.error(`[jqassistant] ${message}`);
        server.sendLoggingMessage({ level: 'info', data: message }).catch(() => {});
      };

      if (!probe.ok) {
        artifact = {
          schemaVersion: '1.0',
          generatedAt: new Date().toISOString(),
          status: 'failed',
          projectName,
          projectRoot: '<uploaded>',
          enabled: true,
          command: resolvedCommand,
          scanMode: 'scan-only',
          detectedBinary: false,
          runtimeDir: '',
          summary,
          mergeEvidence,
          warnings: ['jqassistant MCP runtime could not find the jqassistant binary.'],
          error: probe.message,
        };
      } else {
        const tempBase = await mkdtemp(join(tmpdir(), 'jqa-'));
        const tempRoot = join(tempBase, 'upload');
        const runtimeDir = join(tempBase, 'runtime');
        try {
          await mkdir(tempRoot, { recursive: true });
          await mkdir(runtimeDir, { recursive: true });
          const sourceCount = files.filter((f) => f.encoding !== 'base64').length;
          const classCount = files.filter((f) => f.encoding === 'base64').length;
          log(`writing ${sourceCount} source files + ${classCount} class files to temp directory...`);
          for (const file of files) {
            const dest = join(tempRoot, file.path);
            await mkdir(dirname(dest), { recursive: true });
            if (file.encoding === 'base64') {
              await writeFile(dest, Buffer.from(file.content, 'base64'));
            } else {
              await writeFile(dest, file.content, 'utf8');
            }
          }
          const ports = {
            http: await findAvailablePort(),
            bolt: await findAvailablePort(),
          };
          await writeRuntimeConfig(runtimeDir, ports);
          log('running jqassistant scan...');
          const scan = await runScan(probe.commandPath!, tempRoot, runtimeDir, timeoutMs ?? defaults.timeoutMs);
          log(`scan ${scan.ok ? 'completed' : 'failed'}, querying graph store...`);
          const queriedEvidence = scan.ok
            ? await queryMergeEvidenceFromStore(probe.commandPath!, runtimeDir, ports, timeoutMs ?? defaults.timeoutMs)
            : undefined;
          log('done');
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
            projectRoot: '<uploaded>',
            enabled: true,
            command: resolvedCommand,
            commandLine: `${probe.commandPath} scan -f ${tempRoot}`,
            scanMode: 'scan-only',
            detectedBinary: true,
            version: probe.version,
            runtimeDir,
            stdoutSnippet: truncateText(scan.stdout),
            stderrSnippet: truncateText(scan.stderr),
            summary,
            graphs,
            mergeEvidence,
            ...(queriedEvidence?.diagnostic ? { diagnostic: queriedEvidence.diagnostic } : {}),
            warnings: [
              ...(scan.ok ? [] : ['jqassistant scan failed inside the MCP runtime.']),
              ...((scan.ok && !queriedEvidence) ? ['jqassistant scan completed, but no queryable merge evidence was extracted from the store.'] : []),
            ],
            error: scan.ok ? undefined : (scan.error ?? 'scan failed'),
          };
        } finally {
          await rm(tempBase, { recursive: true, force: true });
        }
      }

      if (outputDir?.trim()) {
        const artifactPath = join(outputDir, 'source.jqassistant.json');
        await writeFile(artifactPath, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(artifact, null, 2) }],
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
  return {
    ok: true,
    command,
    commandPath,
    version,
    message: version ? `jqassistant available: ${version}` : `jqassistant found at ${commandPath} (version probe skipped)`,
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
  const storeDir = join(runtimeDir, 'store');
  await mkdir(storeDir, { recursive: true });
  const config = [
    'jqassistant:',
    '  store:',
    `    uri: file://${storeDir}`,
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
): Promise<{ mergeEvidence?: JqassistantArtifact['mergeEvidence']; graphs?: JqassistantArtifact['graphs']; summaryPatch?: Partial<JqassistantArtifact['summary']>; diagnostic?: Record<string, number> } | undefined> { // eslint-disable-line @typescript-eslint/no-redundant-type-constituents
  const server = await startServer(commandPath, runtimeDir, timeoutMs);
  try {
    server.stderr?.on('data', (chunk) => console.error(`[jqassistant:server] ${String(chunk).trim()}`));
    server.once('exit', (code) => console.error(`[jqassistant:server] exited with code ${code}`));
    const ready = await waitForBoltReady(`bolt://127.0.0.1:${ports.bolt}`, timeoutMs);
    console.error(`[jqassistant] bolt ready=${ready}`);
    if (!ready) return undefined;


    const labelRows = await runCypher(`bolt://127.0.0.1:${ports.bolt}`, `
      MATCH (n) WITH labels(n) AS lbls UNWIND lbls AS lbl
      RETURN DISTINCT lbl, count(*) AS cnt ORDER BY cnt DESC LIMIT 30
    `);
    const diagnostic: Record<string, number> = Object.fromEntries(labelRows.map((r) => [String(r.lbl), Number(r.cnt)]));
    console.error(`[jqassistant] node labels in store: ${JSON.stringify(labelRows.map((r) => `${r.lbl}(${r.cnt})`))}`);

    const JDK_PREFIXES = `NOT t.fqn STARTS WITH 'java.' AND NOT t.fqn STARTS WITH 'javax.' AND NOT t.fqn STARTS WITH 'jakarta.' AND NOT t.fqn STARTS WITH 'sun.' AND NOT t.fqn STARTS WITH 'com.sun.'`;
    const JDK_PREFIXES_S = `NOT s.fqn STARTS WITH 'java.' AND NOT s.fqn STARTS WITH 'javax.' AND NOT s.fqn STARTS WITH 'jakarta.'`;
    const JDK_PREFIXES_T = `NOT t.fqn STARTS WITH 'java.' AND NOT t.fqn STARTS WITH 'javax.' AND NOT t.fqn STARTS WITH 'jakarta.'`;

    const [projectRows, moduleRows, externalDepRows, packageRows, typeRows, dependencyRows, annotationRows, inheritanceRows, callGraphRows] = await Promise.all([
      runCypher(`bolt://127.0.0.1:${ports.bolt}`, `
        MATCH (p:Maven:Pom)-[:HAS_MODULE]->(:Maven:Module)
        RETURN DISTINCT p.artifactId AS artifactId, p.groupId AS groupId
        ORDER BY artifactId
      `),
      runCypher(`bolt://127.0.0.1:${ports.bolt}`, `
        MATCH (p:Maven:Pom)-[:HAS_MODULE]->(m:Maven:Module)
        RETURN p.artifactId AS parentArtifactId, m.name AS moduleName
        ORDER BY parentArtifactId, moduleName
      `),
      runCypher(`bolt://127.0.0.1:${ports.bolt}`, `
        MATCH (p:Maven:Pom)-[:DECLARES_DEPENDENCY]->(d:Maven:Dependency)
        WHERE d.groupId IS NOT NULL AND d.artifactId IS NOT NULL
        RETURN DISTINCT d.groupId AS groupId, d.artifactId AS artifactId,
               d.version AS version, d.scope AS scope
        ORDER BY d.groupId, d.artifactId
        LIMIT 200
      `),
      runCypher(`bolt://127.0.0.1:${ports.bolt}`, `
        MATCH (p:Java:Package)
        WHERE p.fqn CONTAINS '.'
        RETURN DISTINCT p.fqn AS fqn
        ORDER BY fqn
        LIMIT 1000
      `),
      runCypher(`bolt://127.0.0.1:${ports.bolt}`, `
        MATCH (t:Java:Type)
        WHERE t.fqn CONTAINS '.' AND ${JDK_PREFIXES}
        RETURN DISTINCT t.fqn AS fqn
        ORDER BY fqn
        LIMIT 5000
      `),
      runCypher(`bolt://127.0.0.1:${ports.bolt}`, `
        MATCH (s:Java:Type)-[:DEPENDS_ON]->(t:Java:Type)
        WHERE s.fqn CONTAINS '.' AND t.fqn CONTAINS '.'
          AND ${JDK_PREFIXES_S} AND ${JDK_PREFIXES_T}
        RETURN DISTINCT s.fqn AS fromType, t.fqn AS toType
        ORDER BY fromType, toType
        LIMIT 8000
      `),
      runCypher(`bolt://127.0.0.1:${ports.bolt}`, `
        MATCH (t:Java:Type)-[:ANNOTATED_BY]->(a:Java:Annotation)-[:OF_TYPE]->(at:Java:Type)
        WHERE t.fqn CONTAINS '.' AND ${JDK_PREFIXES}
        RETURN t.fqn AS typeFqn, at.fqn AS annotationFqn
        ORDER BY typeFqn, annotationFqn
        LIMIT 5000
      `),
      runCypher(`bolt://127.0.0.1:${ports.bolt}`, `
        MATCH (t:Java:Type)
        WHERE t.fqn CONTAINS '.' AND ${JDK_PREFIXES}
        OPTIONAL MATCH (t)-[:IMPLEMENTS]->(iface:Java:Type)
        OPTIONAL MATCH (t)-[:EXTENDS]->(parent:Java:Type)
        WHERE iface IS NOT NULL OR parent IS NOT NULL
        RETURN t.fqn AS typeFqn,
               collect(DISTINCT iface.fqn) AS interfaces,
               collect(DISTINCT parent.fqn) AS superClasses
        ORDER BY typeFqn
        LIMIT 3000
      `),
      runCypher(`bolt://127.0.0.1:${ports.bolt}`, `
        MATCH (caller:Java:Method)<-[:DECLARES]-(callerType:Java:Type)
        MATCH (caller)-[:INVOKES]->(callee:Java:Method)<-[:DECLARES]-(calleeType:Java:Type)
        WHERE callerType.fqn CONTAINS '.' AND calleeType.fqn CONTAINS '.'
          AND NOT callerType.fqn STARTS WITH 'java.'
          AND NOT calleeType.fqn STARTS WITH 'java.'
          AND NOT callerType.fqn STARTS WITH 'javax.'
          AND NOT calleeType.fqn STARTS WITH 'javax.'
          AND NOT callerType.fqn STARTS WITH 'jakarta.'
          AND NOT calleeType.fqn STARTS WITH 'jakarta.'
        RETURN DISTINCT callerType.fqn AS callerType, caller.name AS callerMethod,
               calleeType.fqn AS calleeType, callee.name AS calleeMethod
        ORDER BY callerType, callerMethod
        LIMIT 5000
      `),
    ]);

    return { ...deriveQueryArtifacts(projectRows, moduleRows, externalDepRows, packageRows, typeRows, dependencyRows, annotationRows, inheritanceRows, callGraphRows), diagnostic };
  } finally {
    server.kill('SIGTERM');
  }
}

async function startServer(commandPath: string, runtimeDir: string, timeoutMs: number) {
  const { spawn } = await import('node:child_process');
  const child = spawn(commandPath, ['server'], {
    cwd: runtimeDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const killer = setTimeout(() => {
    child.kill('SIGTERM');
  }, timeoutMs);
  child.once('exit', () => clearTimeout(killer));
  return child;
}

async function waitForBoltReady(boltUrl: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  const driver = neo4j.driver(boltUrl, neo4j.auth.basic('', ''), { encrypted: false });
  try {
    while (Date.now() - started < timeoutMs) {
      try {
        const session = driver.session({ database: 'neo4j' });
        try {
          await session.run('RETURN 1');
          return true;
        } catch {
          // not ready yet
        } finally {
          await session.close();
        }
      } catch {
        // driver not yet connectable
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  } finally {
    await driver.close();
  }
}

async function runCypher(boltUrl: string, statement: string): Promise<Array<Record<string, unknown>>> {
  const driver = neo4j.driver(boltUrl, neo4j.auth.basic('', ''), { encrypted: false });
  try {
    const session = driver.session({ database: 'neo4j' });
    try {
      const result = await session.run(statement);
      return result.records.map((record) =>
        Object.fromEntries(record.keys.map((key) => [key, toPlain(record.get(key))])),
      );
    } catch (err) {
      console.error(`[jqassistant] Cypher error: ${err}`);
      return [];
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}

function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (neo4j.isInt(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object' && 'low' in (value as object)) return neo4j.int((value as { low: number; high: number }).low).toNumber();
  return value;
}

function deriveQueryArtifacts(
  projectRows: Array<Record<string, unknown>>,
  moduleRows: Array<Record<string, unknown>>,
  externalDepRows: Array<Record<string, unknown>>,
  packageRows: Array<Record<string, unknown>>,
  typeRows: Array<Record<string, unknown>>,
  dependencyRows: Array<Record<string, unknown>>,
  annotationRows: Array<Record<string, unknown>>,
  inheritanceRows: Array<Record<string, unknown>>,
  callGraphRows: Array<Record<string, unknown>>,
): { mergeEvidence?: JqassistantArtifact['mergeEvidence']; graphs?: JqassistantArtifact['graphs']; summaryPatch?: Partial<JqassistantArtifact['summary']> } | undefined {
  if (!projectRows.length && !moduleRows.length && !packageRows.length && !typeRows.length && !dependencyRows.length) {
    return undefined;
  }

  const topLevelProjects = projectRows
    .map((row) => {
      const artifactId = String(row.artifactId ?? '').trim();
      const name = artifactId;
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

  const packageHints = [...new Set(
    packageRows
      .map((row) => String(row.fqn ?? '').trim())
      .filter((fqn) => fqn.includes('.')),
  )];
  const typeCatalog = [...new Set(
    typeRows
      .map((row) => String(row.fqn ?? '').trim())
      .filter((fqn) => fqn.includes('.')),
  )];
  const dependencyCatalog = dependencyRows
    .map((row) => ({
      fromType: String(row.fromType ?? '').trim(),
      toType: String(row.toType ?? '').trim(),
    }))
    .filter((row) => row.fromType.includes('.') && row.toType.includes('.'));
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

  // Build annotation map: typeFqn -> annotationFqn[]
  const annotationMap = new Map<string, string[]>();
  for (const row of annotationRows) {
    const typeFqn = String(row.typeFqn ?? '').trim();
    const annotFqn = String(row.annotationFqn ?? '').trim();
    if (!typeFqn || !annotFqn) continue;
    const existing = annotationMap.get(typeFqn) ?? [];
    existing.push(annotFqn);
    annotationMap.set(typeFqn, existing);
  }

  // Build inheritance map: typeFqn -> { interfaces, superClass }
  const inheritanceMap = new Map<string, { interfaces: string[]; superClass?: string }>();
  for (const row of inheritanceRows) {
    const typeFqn = String(row.typeFqn ?? '').trim();
    if (!typeFqn) continue;
    const interfaces = (Array.isArray(row.interfaces) ? row.interfaces : [])
      .map((v) => String(v).trim()).filter((v) => v && v !== 'null');
    const superClasses = (Array.isArray(row.superClasses) ? row.superClasses : [])
      .map((v) => String(v).trim()).filter((v) => v && v !== 'null' && v !== 'java.lang.Object');
    inheritanceMap.set(typeFqn, { interfaces, superClass: superClasses[0] });
  }

  // Build call graph
  const callEdges = callGraphRows
    .map((row) => ({
      callerType: String(row.callerType ?? '').trim(),
      callerMethod: String(row.callerMethod ?? '').trim(),
      calleeType: String(row.calleeType ?? '').trim(),
      calleeMethod: String(row.calleeMethod ?? '').trim(),
    }))
    .filter((e) => e.callerType && e.callerMethod && e.calleeType && e.calleeMethod);

  // External Maven dependencies
  const externalDeps = externalDepRows
    .map((row) => ({
      groupId: String(row.groupId ?? '').trim(),
      artifactId: String(row.artifactId ?? '').trim(),
      version: String(row.version ?? '').trim() || undefined,
      scope: String(row.scope ?? '').trim() || undefined,
    }))
    .filter((d) => d.groupId && d.artifactId);

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
      externalDependencies: externalDeps.length ? externalDeps : undefined,
    },
    packageGraph: {
      packages: packageHints,
      relations: packageRelations,
    },
    typeGraph: {
      types: typeCatalog.map((fqn) => {
        const annots = annotationMap.get(fqn);
        const inherit = inheritanceMap.get(fqn);
        return {
          fqn,
          packageName: packageNameOfFqn(fqn),
          simpleName: simpleNameOfFqn(fqn),
          kind: inferTypeKindFromAnnotations(annots) ?? inferTypeKindFromFqn(fqn),
          annotations: annots?.length ? annots : undefined,
          interfaces: inherit?.interfaces.length ? inherit.interfaces : undefined,
          superClass: inherit?.superClass,
        };
      }),
      dependencies: dependencyCatalog.map((row) => ({
        fromType: row.fromType,
        toType: row.toType,
        fromPackage: packageNameOfFqn(row.fromType),
        toPackage: packageNameOfFqn(row.toType),
      })),
    },
    callGraph: callEdges.length ? { edges: callEdges } : undefined,
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
      applicationCount: applicationLayouts.length,
      applications: applicationLayouts.map((l) => l.appRoot),
      moduleCount: applicationLayouts.reduce((n, l) => n + l.internalModules.length, 0),
      modules: applicationLayouts.flatMap((l) => l.internalModules.map((m) => m.name)),
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

function inferTypeKindFromAnnotations(annotations?: string[]): string | undefined {
  if (!annotations?.length) return undefined;
  const a = annotations.map((s) => s.toLowerCase());
  if (a.some((s) => s.includes('restcontroller') || s.includes('controller') || s.includes('requestmapping'))) return 'controller';
  if (a.some((s) => s.includes('service') || s.includes('transactional'))) return 'service';
  if (a.some((s) => s.includes('repository') || s.includes('mapper'))) return 'repository';
  if (a.some((s) => s.includes('entity') || s.includes('table') || s.includes('embeddable'))) return 'domain';
  if (a.some((s) => s.includes('configuration') || s.includes('enablewebmvc') || s.includes('enablejpa'))) return 'configuration';
  if (a.some((s) => s.includes('eventlistener') || s.includes('kafkalistener') || s.includes('rabbitmq'))) return 'listener';
  if (a.some((s) => s.includes('scheduled') || s.includes('enablescheduling'))) return 'job';
  if (a.some((s) => s.includes('component'))) return 'component';
  return undefined;
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

function truncateText(value: string, limit = 6000): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(-limit)}`;
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
