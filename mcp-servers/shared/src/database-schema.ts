import type { CanonicalGraph, DatabaseColumn, DatabaseRelationship, DatabaseSchema, DatabaseTable, SemanticDocument } from './models.js';
import { deriveSystemName, getSectionItems, getSectionText } from './semantic-markdown.js';
import { loadReferenceCorpus } from './reference-corpus.js';

const COMMON_STOPWORDS = new Set([
  'the',
  'and',
  'or',
  'to',
  'of',
  'for',
  'a',
  'an',
  'in',
  'on',
  'with',
  'by',
  'from',
  'through',
  'using',
  'use',
  'used',
  'layer',
  'service',
  'system',
  'process',
  'data',
  'flow',
  'api',
  'ui',
  'web',
  'create',
  'update',
  'edit',
  'list',
  'search',
  'read',
  'write',
  'persist',
  'store',
  'save',
  'handle',
  'manage',
  'support',
  'based',
  'entry',
  'point',
  'layer',
]);

const DOMAIN_KEYWORDS: Array<{ pattern: RegExp; table: string; columns: DatabaseColumn[]; description: string }> = [
  {
    pattern: /\bnote(s)?\b/i,
    table: 'notes',
    description: 'Core note aggregate for the application domain.',
    columns: [
      { name: 'id', type: 'uuid', detail: 'Stable primary key' },
      { name: 'title', type: 'string', detail: 'Human-readable note title' },
      { name: 'content', type: 'text', detail: 'Free-form note body' },
      { name: 'owner_id', type: 'uuid', detail: 'User who owns the note' },
      { name: 'status', type: 'string', detail: 'Lifecycle state' },
      { name: 'created_at', type: 'timestamp', detail: 'Creation timestamp' },
      { name: 'updated_at', type: 'timestamp', detail: 'Last update timestamp' },
    ],
  },
  {
    pattern: /\buser(s)?\b|\baccount(s)?\b/i,
    table: 'users',
    description: 'Application users and principals.',
    columns: [
      { name: 'id', type: 'uuid', detail: 'Stable primary key' },
      { name: 'email', type: 'string', detail: 'Login / contact identity' },
      { name: 'display_name', type: 'string', detail: 'Human-readable display name' },
      { name: 'role', type: 'string', detail: 'Permission role' },
      { name: 'status', type: 'string', detail: 'Lifecycle state' },
      { name: 'created_at', type: 'timestamp', detail: 'Creation timestamp' },
      { name: 'updated_at', type: 'timestamp', detail: 'Last update timestamp' },
    ],
  },
  {
    pattern: /\btask(s)?\b|\bwork item(s)?\b|\bjob(s)?\b/i,
    table: 'tasks',
    description: 'Work items or scheduled operations in the domain.',
    columns: [
      { name: 'id', type: 'uuid', detail: 'Stable primary key' },
      { name: 'name', type: 'string', detail: 'Task name' },
      { name: 'description', type: 'text', detail: 'Task body or instructions' },
      { name: 'status', type: 'string', detail: 'Lifecycle state' },
      { name: 'owner_id', type: 'uuid', detail: 'Owning user or actor' },
      { name: 'due_at', type: 'timestamp', detail: 'Optional deadline' },
      { name: 'created_at', type: 'timestamp', detail: 'Creation timestamp' },
      { name: 'updated_at', type: 'timestamp', detail: 'Last update timestamp' },
    ],
  },
  {
    pattern: /\bevent(s)?\b|\bmessage(s)?\b|\bnotification(s)?\b/i,
    table: 'events',
    description: 'Async event or notification ledger.',
    columns: [
      { name: 'id', type: 'uuid', detail: 'Stable primary key' },
      { name: 'event_type', type: 'string', detail: 'Domain or integration event type' },
      { name: 'aggregate_type', type: 'string', detail: 'Owning aggregate type' },
      { name: 'aggregate_id', type: 'uuid', detail: 'Owning aggregate identifier' },
      { name: 'payload', type: 'json', detail: 'Serialized event payload' },
      { name: 'created_at', type: 'timestamp', detail: 'Emission timestamp' },
    ],
  },
  {
    pattern: /\baudit\b/i,
    table: 'audit_log',
    description: 'Audit trail and change history.',
    columns: [
      { name: 'id', type: 'uuid', detail: 'Stable primary key' },
      { name: 'action', type: 'string', detail: 'Recorded action' },
      { name: 'actor_id', type: 'uuid', detail: 'User or service actor' },
      { name: 'subject_type', type: 'string', detail: 'Affected entity type' },
      { name: 'subject_id', type: 'uuid', detail: 'Affected entity identifier' },
      { name: 'payload', type: 'json', detail: 'Recorded change context' },
      { name: 'created_at', type: 'timestamp', detail: 'Audit timestamp' },
    ],
  },
  {
    pattern: /\battachment(s)?\b|\bfile(s)?\b|\basset(s)?\b|\bblob(s)?\b/i,
    table: 'attachments',
    description: 'Binary assets or stored files.',
    columns: [
      { name: 'id', type: 'uuid', detail: 'Stable primary key' },
      { name: 'owner_type', type: 'string', detail: 'Owning aggregate type' },
      { name: 'owner_id', type: 'uuid', detail: 'Owning aggregate identifier' },
      { name: 'storage_uri', type: 'string', detail: 'Physical storage reference' },
      { name: 'content_type', type: 'string', detail: 'MIME type' },
      { name: 'created_at', type: 'timestamp', detail: 'Creation timestamp' },
    ],
  },
];

export function generateDatabaseSchema(document: SemanticDocument, graph?: CanonicalGraph): DatabaseSchema {
  const corpus = loadReferenceCorpus();
  const title = `${deriveSystemName(document)} database schema`;
  const sourceText = [
    getSectionText(document, 'system'),
    getSectionText(document, 'intent'),
    getSectionText(document, 'context'),
    getSectionText(document, 'interfaces'),
    getSectionText(document, 'data_flows'),
    getSectionText(document, 'processes'),
    getSectionText(document, 'rules'),
    getSectionText(document, 'security'),
    getSectionText(document, 'dependencies'),
    getSectionText(document, 'examples'),
  ]
    .join('\n')
    .toLowerCase();

  const candidateTables = new Map<string, DatabaseTable>();
  const explicitSchemaItems = getSectionItems(document, 'database_schema');
  const explicitSchemaTables = extractExplicitSchemaTables(explicitSchemaItems);
  const explicitSchemaRelationships = extractExplicitSchemaRelationships(explicitSchemaItems);
  const hasExplicitSchema = explicitSchemaTables.length > 0;

  for (const table of explicitSchemaTables) {
    candidateTables.set(table.name, table);
  }

  if (!hasExplicitSchema) {
    for (const hint of corpus.schemaHints) {
      const normalized = normalizeHint(hint);
      if (normalized && sourceText.includes(normalized.replace(/_/g, ' '))) {
        candidateTables.set(normalized, {
          name: normalized,
          description: 'Reference-corpus seeded schema hint.',
          primaryKey: inferPrimaryKey(normalized),
          columns: seedGenericColumns(normalized, sourceText),
        });
      }
    }
  }

  if (!hasExplicitSchema) {
    for (const keyword of DOMAIN_KEYWORDS) {
      if (keyword.pattern.test(sourceText)) {
        candidateTables.set(keyword.table, {
          name: keyword.table,
          description: keyword.description,
          primaryKey: inferPrimaryKey(keyword.table),
          columns: keyword.columns,
        });
      }
    }
  }

  const explicitTables = hasExplicitSchema ? [] : extractExplicitTables(document, graph);
  for (const table of explicitTables) {
    if (!candidateTables.has(table.name)) {
      candidateTables.set(table.name, table);
    }
  }

  if (!hasExplicitSchema) {
    const mainTableName = pickMainTableName(document, graph, sourceText);
    if (mainTableName && !candidateTables.has(mainTableName)) {
      candidateTables.set(mainTableName, {
        name: mainTableName,
        description: 'Primary domain table inferred from the semantic source.',
        primaryKey: inferPrimaryKey(mainTableName),
        columns: seedGenericColumns(mainTableName, sourceText),
      });
    }
  }

  const tables = [...candidateTables.values()]
    .map((table) => ({
      ...table,
      primaryKey: table.primaryKey ?? inferPrimaryKey(table.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (tables.length === 0) {
    tables.push({
      name: 'domain_record',
      description: 'Fallback schema element inferred from the slice.',
      primaryKey: ['id'],
      columns: [
        { name: 'id', type: 'uuid', detail: 'Stable primary key' },
        { name: 'name', type: 'string', detail: 'Human-readable name' },
        { name: 'status', type: 'string', detail: 'Lifecycle state' },
        { name: 'created_at', type: 'timestamp', detail: 'Creation timestamp' },
        { name: 'updated_at', type: 'timestamp', detail: 'Last update timestamp' },
      ],
    });
  }

  const relationships = inferRelationships(tables);
  for (const relationship of explicitSchemaRelationships) {
    const key = `${relationship.fromTable}:${relationship.fromColumn}:${relationship.toTable}:${relationship.toColumn}`;
    if (!relationships.some((item) => `${item.fromTable}:${item.fromColumn}:${item.toTable}:${item.toColumn}` === key)) {
      relationships.push(relationship);
    }
  }

  return {
    title,
    summary: buildSchemaSummary(tables, relationships, document, graph),
    source: 'semantic-source + reference corpus',
    confidence: determineConfidence(tables, document, graph),
    tables,
    relationships,
  };
}

function extractExplicitTables(document: SemanticDocument, graph?: CanonicalGraph): DatabaseTable[] {
  const tables = new Map<string, DatabaseTable>();
  const persistenceItems = getSectionItems(document, 'dependencies');
  const processText = getSectionText(document, 'processes').toLowerCase();
  const entityLikeNodes = graph?.nodes?.filter((node) => /persistence|repository|entity|table|database|store/i.test(node.type) || /persistence|repository|entity|table|database|store/i.test(node.name));

  for (const item of persistenceItems) {
    const tableName = inferTableNameFromText(item);
    if (!tableName) continue;
    tables.set(tableName, {
      name: tableName,
      description: `Persistence boundary inferred from "${item}".`,
      primaryKey: inferPrimaryKey(tableName),
      columns: seedGenericColumns(tableName, processText),
    });
  }

  for (const node of entityLikeNodes ?? []) {
    const tableName = inferTableNameFromText(node.name) ?? normalizeHint(node.name);
    if (!tableName) continue;
    if (!tables.has(tableName)) {
      tables.set(tableName, {
        name: tableName,
        description: node.description || 'Entity or persistence node inferred from graph.',
        primaryKey: inferPrimaryKey(tableName),
        columns: seedGenericColumns(tableName, `${node.name} ${node.description ?? ''}`),
        sourceRefs: node.sourceRef ? [node.sourceRef] : undefined,
      });
    }
  }

  return [...tables.values()];
}

function pickMainTableName(document: SemanticDocument, graph?: CanonicalGraph, sourceText = ''): string | undefined {
  const title = deriveSystemName(document).toLowerCase();
  const candidates = [
    ...getSectionItems(document, 'examples'),
    ...getSectionItems(document, 'processes'),
    ...getSectionItems(document, 'dependencies'),
    ...(graph?.nodes ?? []).map((node) => node.name),
    title,
    sourceText,
  ];

  for (const text of candidates) {
    const tableName = inferTableNameFromText(text);
    if (tableName) {
      return tableName;
    }
  }

  return undefined;
}

function buildSchemaSummary(tables: DatabaseTable[], relationships: DatabaseRelationship[], document: SemanticDocument, graph?: CanonicalGraph): string {
  const entityCount = graph?.nodes.filter((node) => node.type === 'Persistence' || node.type === 'Module' || node.type === 'Service').length ?? 0;
  const explicitPersistence = getSectionItems(document, 'dependencies').length > 0 ? 'explicit persistence hints present' : 'no explicit persistence hints';
  return `Inferred ${tables.length} table${tables.length === 1 ? '' : 's'} and ${relationships.length} relationship${relationships.length === 1 ? '' : 's'} from ${explicitPersistence}${entityCount ? ` and ${entityCount} persistence-related graph nodes` : ''}.`;
}

function extractExplicitSchemaTables(items: string[]): DatabaseTable[] {
  const tables = new Map<string, DatabaseTable>();

  for (const item of items) {
    const tableName = inferTableNameFromExplicitSchemaItem(item);
    if (!tableName) continue;
    const primaryKey = extractPrimaryKeyFromExplicitSchemaItem(item) ?? inferPrimaryKey(tableName);
    const columns = extractColumnsFromExplicitSchemaItem(item);
    const sourceRefs = extractSourceRefsFromExplicitSchemaItem(item);

    tables.set(tableName, {
      name: tableName,
      description: `Explicit schema item from semantic source: ${item}`,
      primaryKey,
      columns: columns.length
        ? columns
        : seedGenericColumns(tableName, item),
      sourceRefs,
    });
  }

  return [...tables.values()];
}

function inferTableNameFromExplicitSchemaItem(item: string): string | undefined {
  const nameMatch = item.match(/\btable\s+([a-zA-Z0-9_."`-]+(?:\.[a-zA-Z0-9_."`-]+)*)\b/i);
  if (nameMatch?.[1]) return normalizeHint(nameMatch[1]);
  const explicitMatch = item.match(/^\s*-\s*([a-zA-Z0-9_."`-]+)\s*(?:\(|\||$)/);
  if (explicitMatch?.[1]) return normalizeHint(explicitMatch[1]);
  return inferTableNameFromText(item);
}

function extractPrimaryKeyFromExplicitSchemaItem(item: string): string[] | undefined {
  const pkMatch = item.match(/\bpk\s*:\s*([^|]+?)(?:\s*\|\s*(?:columns?|relationships?|source)\b|$)/i) ?? item.match(/\bprimary\s*key\s*:\s*([^|]+?)(?:\s*\|\s*(?:columns?|relationships?|source)\b|$)/i);
  if (!pkMatch?.[1]) return undefined;
  return pkMatch[1]
    .split(',')
    .map((value) => normalizeHint(value))
    .filter(Boolean);
}

function extractColumnsFromExplicitSchemaItem(item: string): DatabaseColumn[] {
  const columnsMatch = item.match(/\bcolumns?\s*:\s*([^|]+?)(?:\s*\|\s*(?:relationships?|source)\b|$)/i);
  if (!columnsMatch?.[1]) return [];
  return columnsMatch[1]
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const match = value.match(/^([a-zA-Z0-9_."`-]+)(?::([a-zA-Z0-9_()[\]\-+/.<>,\s]+))?(?:\s*\(([^)]*)\))?$/);
      const name = normalizeHint(match?.[1] ?? value);
      const type = inferColumnType(match?.[2] ?? '');
      const detail = [match?.[2], match?.[3]].filter(Boolean).join(' ').trim();
      return {
        name,
        ...(type ? { type } : {}),
        ...(detail ? { detail } : {}),
      };
    });
}

function extractRelationshipsFromExplicitSchemaItem(item: string): DatabaseRelationship[] {
  const relationshipsMatch = item.match(/\brelationships?\s*:\s*(.+)$/i);
  if (!relationshipsMatch?.[1]) return [];
  const result: DatabaseRelationship[] = [];
  for (const token of relationshipsMatch[1].split(';').map((value) => value.trim()).filter(Boolean)) {
    const match = token.match(/([a-zA-Z0-9_.]+)\s*->\s*([a-zA-Z0-9_.]+)(?:\s*\((1:1|1:N|N:1|N:M)\))?/i);
    if (!match) continue;
    const [fromTable, fromColumn] = match[1].split('.');
    const [toTable, toColumn] = match[2].split('.');
    result.push({
      fromTable: normalizeHint(fromTable),
      fromColumn: normalizeHint(fromColumn),
      toTable: normalizeHint(toTable),
      toColumn: normalizeHint(toColumn),
      cardinality: (match[3] as DatabaseRelationship['cardinality']) ?? 'N:1',
      description: token,
    });
  }
  return result;
}

function extractExplicitSchemaRelationships(items: string[]): DatabaseRelationship[] {
  return items.flatMap((item) => extractRelationshipsFromExplicitSchemaItem(item));
}

function extractSourceRefsFromExplicitSchemaItem(item: string): string[] | undefined {
  const refsMatch = item.match(/\bsource\s*:\s*(.+)$/i);
  if (!refsMatch?.[1]) return undefined;
  return refsMatch[1]
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function inferColumnType(columnName: string): string | undefined {
  const normalized = columnName.trim().toLowerCase();
  if (!normalized) return undefined;
  if (/uuid|uniqueidentifier/.test(normalized)) return 'uuid';
  if (/bigint|int|smallint|tinyint|serial|numeric|decimal|double|float|real/.test(normalized)) return 'number';
  if (/timestamp|timestamptz|datetime|date|time/.test(normalized)) return 'timestamp';
  if (/bool/.test(normalized)) return 'boolean';
  if (/json/.test(normalized)) return 'json';
  if (/text|clob|blob/.test(normalized)) return 'text';
  if (/char|varchar|string|email|name|title|role|type|kind|action|status|slug|query|message|payload|description|body|token/.test(normalized)) return 'string';
  if (/_id$/.test(normalized)) return 'uuid';
  return undefined;
}

function determineConfidence(tables: DatabaseTable[], document: SemanticDocument, graph?: CanonicalGraph): DatabaseSchema['confidence'] {
  const hasExplicitPersistence = getSectionItems(document, 'dependencies').some((item) => /database|repository|persistence|sql|table|entity|storage/i.test(item));
  const hasGraphPersistence = (graph?.nodes ?? []).some((node) => node.type === 'Persistence' || /repository|entity|database|table|storage/i.test(node.name));
  if (tables.length >= 3 && hasExplicitPersistence && hasGraphPersistence) return 'high';
  if (tables.length >= 2 || hasExplicitPersistence || hasGraphPersistence) return 'medium';
  return 'low';
}

function seedGenericColumns(tableName: string, sourceText: string): DatabaseColumn[] {
  const columns: DatabaseColumn[] = [
    { name: 'id', type: 'uuid', detail: 'Stable primary key' },
  ];

  if (/note/i.test(tableName) || /note/i.test(sourceText)) {
    columns.push(
      { name: 'title', type: 'string', detail: 'Human-readable title' },
      { name: 'content', type: 'text', detail: 'Main body content' },
      { name: 'status', type: 'string', detail: 'Lifecycle state' },
      { name: 'owner_id', type: 'uuid', detail: 'Owning user or actor' },
    );
  } else if (/user|account/i.test(tableName)) {
    columns.push(
      { name: 'email', type: 'string', detail: 'Identity or login address' },
      { name: 'display_name', type: 'string', detail: 'Human-readable label' },
      { name: 'role', type: 'string', detail: 'Authorization role' },
      { name: 'status', type: 'string', detail: 'Lifecycle state' },
    );
  } else if (/task|job/i.test(tableName)) {
    columns.push(
      { name: 'name', type: 'string', detail: 'Task name' },
      { name: 'description', type: 'text', detail: 'Task details' },
      { name: 'status', type: 'string', detail: 'Lifecycle state' },
      { name: 'due_at', type: 'timestamp', detail: 'Optional deadline' },
    );
  } else if (/event|message|notification/i.test(tableName)) {
    columns.push(
      { name: 'event_type', type: 'string', detail: 'Event type or kind' },
      { name: 'aggregate_id', type: 'uuid', detail: 'Owning aggregate' },
      { name: 'payload', type: 'json', detail: 'Serialized message payload' },
      { name: 'created_at', type: 'timestamp', detail: 'Emission timestamp' },
    );
  } else if (/audit/i.test(tableName)) {
    columns.push(
      { name: 'action', type: 'string', detail: 'Recorded action' },
      { name: 'actor_id', type: 'uuid', detail: 'Actor identifier' },
      { name: 'subject_type', type: 'string', detail: 'Affected entity type' },
      { name: 'subject_id', type: 'uuid', detail: 'Affected entity identifier' },
      { name: 'payload', type: 'json', detail: 'Audit details' },
    );
  } else {
    columns.push(
      { name: 'name', type: 'string', detail: 'Domain label' },
      { name: 'status', type: 'string', detail: 'Lifecycle state' },
      { name: 'created_at', type: 'timestamp', detail: 'Creation timestamp' },
      { name: 'updated_at', type: 'timestamp', detail: 'Last update timestamp' },
    );
  }

  columns.push({ name: 'created_at', type: 'timestamp', detail: 'Creation timestamp' });
  columns.push({ name: 'updated_at', type: 'timestamp', detail: 'Last update timestamp' });
  return uniqueColumns(columns);
}

function uniqueColumns(columns: DatabaseColumn[]): DatabaseColumn[] {
  const seen = new Set<string>();
  const result: DatabaseColumn[] = [];
  for (const column of columns) {
    const key = column.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(column);
  }
  return result;
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function inferPrimaryKey(tableName: string): string[] {
  if (/audit|event|message|notification/i.test(tableName)) {
    return ['id'];
  }
  return ['id'];
}

function inferRelationships(tables: DatabaseTable[]): DatabaseRelationship[] {
  const tableNames = new Set(tables.map((table) => table.name.toLowerCase()));
  const relationships: DatabaseRelationship[] = [];
  const seen = new Set<string>();

  for (const table of tables) {
    for (const column of table.columns) {
      if (!/_id$/i.test(column.name) || /^id$/i.test(column.name)) {
        continue;
      }

      const columnBase = column.name.replace(/_id$/i, '').toLowerCase();
      const target = resolveForeignKeyTarget(table.name.toLowerCase(), columnBase, tableNames);
      if (!target) continue;

      const targetTable = tables.find((candidate) => candidate.name.toLowerCase() === target);
      if (targetTable?.name.toLowerCase() === table.name.toLowerCase() && !/parent|child|prev|next|manager|mentor|supervisor/i.test(columnBase)) {
        continue;
      }
      const targetColumn = targetTable?.primaryKey?.[0] ?? 'id';
      const key = `${table.name}:${column.name}:${targetTable?.name ?? target}`;
      if (seen.has(key)) continue;
      seen.add(key);

      relationships.push({
        fromTable: table.name,
        fromColumn: column.name,
        toTable: targetTable?.name ?? target,
        toColumn: targetColumn,
        cardinality: 'N:1',
        description: `${table.name}.${column.name} references ${targetTable?.name ?? target}.${targetColumn}`,
      });
    }
  }

  return relationships;
}

function resolveForeignKeyTarget(sourceTable: string, columnBase: string, tableNames: Set<string>): string | undefined {
  const semanticTargets: Record<string, string[]> = {
    owner: ['users'],
    user: ['users'],
    actor: ['users'],
    author: ['users'],
    creator: ['users'],
    note: ['notes'],
    subject: ['notes', 'users'],
    audit: ['audit_log'],
    parent: [sourceTable],
  };

  const candidates = unique([
    ...(semanticTargets[columnBase] ?? []),
    columnBase,
    `${columnBase}s`,
    `${columnBase}es`,
    columnBase.replace(/s$/, ''),
  ]);

  for (const candidate of candidates) {
    if (tableNames.has(candidate.toLowerCase())) {
      return candidate.toLowerCase();
    }
  }

  return undefined;
}

function normalizeHint(value: string): string {
  return value
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(java|kt|groovy|ts|tsx|js|jsx)$/, '')
    .replace(/(entity|record|model|repository|repo|table|dto)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
    || value.toLowerCase();
}

function inferTableNameFromText(text: string): string | undefined {
  const normalized = text.toLowerCase();
  const keywords = [
    'notes',
    'note',
    'users',
    'user',
    'accounts',
    'account',
    'tasks',
    'task',
    'events',
    'event',
    'messages',
    'message',
    'notifications',
    'notification',
    'audit_log',
    'audit',
    'attachments',
    'attachment',
    'files',
    'file',
    'orders',
    'order',
    'payments',
    'payment',
    'projects',
    'project',
    'comments',
    'comment',
    'sessions',
    'session',
    'roles',
    'role',
    'permissions',
    'permission',
    'invoices',
    'invoice',
  ];

  for (const keyword of keywords) {
    if (normalized.includes(keyword)) {
      return keyword.endsWith('s') ? keyword : `${keyword}s`;
    }
  }

  return undefined;
}
