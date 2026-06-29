export interface JqassistantConfig {
  command: string;
  scanMode: 'scan-only';
  timeoutMs: number;
}

export interface JqassistantArtifact {
  schemaVersion: '1.0';
  generatedAt: string;
  status: 'completed' | 'skipped' | 'failed';
  projectName: string;
  projectRoot: string;
  enabled: boolean;
  command: string;
  commandLine?: string;
  scanMode: 'scan-only';
  detectedBinary: boolean;
  version?: string;
  runtimeDir?: string;
  stdoutSnippet?: string;
  stderrSnippet?: string;
  summary: {
    applicationCount: number;
    applications: string[];
    moduleCount: number;
    modules: string[];
    technologyCount: number;
    technologies: string[];
    packageCount?: number;
    packageRelationCount?: number;
    typeCount?: number;
    typeDependencyCount?: number;
  };
  graphs?: {
    projectGraph: {
      projects: Array<{
        artifactId: string;
        groupId?: string;
        name?: string;
      }>;
      modules: Array<{
        parentArtifactId: string;
        moduleName: string;
      }>;
      externalDependencies?: Array<{
        groupId: string;
        artifactId: string;
        version?: string;
        scope?: string;
      }>;
    };
    packageGraph: {
      packages: string[];
      relations: Array<{
        fromPackage: string;
        toPackage: string;
        count: number;
      }>;
    };
    typeGraph: {
      types: Array<{
        fqn: string;
        packageName?: string;
        simpleName: string;
        kind?: string;
        annotations?: string[];
        interfaces?: string[];
        superClass?: string;
      }>;
      dependencies: Array<{
        fromType: string;
        toType: string;
        fromPackage?: string;
        toPackage?: string;
      }>;
    };
    callGraph?: {
      edges: Array<{
        callerType: string;
        callerMethod: string;
        calleeType: string;
        calleeMethod: string;
      }>;
    };
  };
  mergeEvidence?: {
    multiModuleMaven?: boolean;
    topLevelProjects?: Array<{ name: string; role: string }>;
    backendSupportModules?: Array<{ name: string; role: string }>;
    backendRuntimeLayers?: Array<{ name: string; role: string }>;
    applicationLayouts?: Array<{
      appRoot: string;
      role: string;
      multiModule: boolean;
      moduleRoots: string[];
      internalModules: Array<{
        name: string;
        purpose: string;
        source: 'maven' | 'deterministic' | 'local-ai' | 'jqassistant';
        pathHints: string[];
      }>;
    }>;
  };
  warnings: string[];
  error?: string;
}

const DEFAULT_JQASSISTANT_CONFIG: JqassistantConfig = {
  command: 'jqassistant',
  scanMode: 'scan-only',
  timeoutMs: 120000,
};

export function getDefaultJqassistantConfig(): JqassistantConfig {
  return { ...DEFAULT_JQASSISTANT_CONFIG };
}
