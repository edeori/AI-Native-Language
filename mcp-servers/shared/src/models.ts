export type SemanticSectionName =
  | 'system'
  | 'intent'
  | 'context'
  | 'interfaces'
  | 'data_flows'
  | 'processes'
  | 'rules'
  | 'security'
  | 'dependencies'
  | 'examples'
  | 'acceptance_criteria';

// acceptance_criteria is optional — source-derived files may not have it
export const REQUIRED_SECTIONS: SemanticSectionName[] = [
  'system',
  'intent',
  'context',
  'interfaces',
  'data_flows',
  'processes',
  'rules',
  'security',
  'dependencies',
  'examples',
];

export interface SemanticSection {
  name: SemanticSectionName | string;
  title: string;
  raw: string;
  lines: string[];
  items: string[];
  startLine: number;
  endLine: number;
}

export interface SemanticDocument {
  sourcePath?: string;
  sections: Record<string, SemanticSection>;
  orderedSections: SemanticSection[];
  raw: string;
}

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  description: string;
  status: 'draft' | 'ready' | 'validated';
  sourceRef: string;
  version: string;
  [key: string]: unknown;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: string;
  [key: string]: unknown;
}

export interface CanonicalGraph {
  schemaVersion: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    sourcePath?: string;
    title?: string;
    createdAt: string;
    databaseSchema?: DatabaseSchema;
  };
}

export interface DatabaseColumn {
  name: string;
  type?: string;
  detail?: string;
  nullable?: boolean;
}

export interface DatabaseTable {
  name: string;
  description?: string;
  primaryKey?: string[];
  columns: DatabaseColumn[];
  sourceRefs?: string[];
}

export interface DatabaseRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  cardinality: '1:1' | '1:N' | 'N:1' | 'N:M';
  description?: string;
}

export interface DatabaseSchema {
  title?: string;
  summary?: string;
  tables: DatabaseTable[];
  relationships?: DatabaseRelationship[];
  source?: string;
  confidence?: 'low' | 'medium' | 'high';
}

export type ValidationSeverity = 'info' | 'warning' | 'gap' | 'conflict' | 'violation';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  sourceRef?: string;
  sourceLine?: number;
  sourceColumn?: number;
  nodeId?: string;
}

export interface ValidationReport {
  status: 'draft' | 'ready' | 'validated';
  issues: ValidationIssue[];
  graph: CanonicalGraph;
  summary: {
    gaps: number;
    conflicts: number;
    warnings: number;
    violations: number;
  };
}

export interface CompilerOptions {
  workspaceRoot?: string;
  outputDir?: string;
  basePackage?: string;
  artifactName?: string;
}

export interface GeneratedArtifactSet {
  outputDir: string;
  files: Array<{ path: string; content: string }>;
}
