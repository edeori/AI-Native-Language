export interface JavaAstFile {
  file: string;
  packageName?: string;
  imports: string[];
  types: JavaAstType[];
}

export interface JavaAstType {
  kind: 'class' | 'interface' | 'record' | 'enum';
  name: string;
  annotations: string[];
  modifiers: string[];
  fields: JavaAstField[];
  methods: JavaAstMethod[];
}

export interface JavaAstField {
  name: string;
  type: string;
  annotations: string[];
  modifiers: string[];
  initializer?: string;
}

export interface JavaAstMethod {
  name: string;
  returnType: string;
  annotations: string[];
  modifiers: string[];
  parameters: Array<{ name: string; type: string }>;
}

export function parseJavaSourceFile(file: string, source: string): JavaAstFile {
  const packageName = source.match(/^\s*package\s+([a-zA-Z0-9_.]+)\s*;/m)?.[1];
  const imports = [...source.matchAll(/^\s*import\s+([a-zA-Z0-9_.*]+)\s*;/gm)].map((match) => match[1]).filter(Boolean);
  const types = parseJavaTypes(source);
  return { file, packageName, imports, types };
}

function parseJavaTypes(source: string): JavaAstType[] {
  const types: JavaAstType[] = [];
  const lines = source.split(/\r?\n/);
  let pendingAnnotations: string[] = [];
  let offset = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pendingAnnotations = [];
      offset += rawLine.length + 1;
      continue;
    }
    if (line.startsWith('@')) {
      pendingAnnotations.push(...collectAnnotations(line));
      offset += rawLine.length + 1;
      continue;
    }
    const typeMatch = line.match(/^(?:(?:public|protected|private|abstract|final|static|sealed|non-sealed)\s+)*(class|interface|record|enum)\s+([A-Za-z0-9_]+)\b/);
    if (!typeMatch) {
      pendingAnnotations = [];
      offset += rawLine.length + 1;
      continue;
    }
    const kind = typeMatch[1] as JavaAstType['kind'];
    const name = typeMatch[2];
    const body = extractTypeBody(source, offset);
    const fields = body ? parseJavaFields(body) : [];
    const methods = body ? parseJavaMethods(body) : [];
    types.push({
      kind,
      name,
      annotations: [...new Set(pendingAnnotations)],
      modifiers: collectModifiers(line),
      fields,
      methods,
    });
    pendingAnnotations = [];
    offset += rawLine.length + 1;
  }
  return types;
}

function parseJavaFields(body: string): JavaAstField[] {
  const fields: JavaAstField[] = [];
  const lines = body.split(/\r?\n/);
  let pendingAnnotations: string[] = [];
  let pendingModifiers: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pendingAnnotations = [];
      pendingModifiers = [];
      continue;
    }
    if (line.startsWith('@')) {
      pendingAnnotations.push(...collectAnnotations(line));
      continue;
    }
    const fieldMatch = line.match(/^(?:(public|protected|private|static|final|volatile|transient)\s+)*([A-Za-z0-9_<>,.? ?\[\]]+)\s+([A-Za-z0-9_]+)\s*(?:=\s*([^;]+))?;/);
    if (!fieldMatch) {
      continue;
    }
    const modifiers = [...pendingModifiers, ...collectModifiers(line)];
    fields.push({
      name: fieldMatch[3],
      type: fieldMatch[2].replace(/\s+/g, ' ').trim(),
      annotations: [...new Set(pendingAnnotations.concat(collectAnnotations(line)))],
      modifiers,
      initializer: fieldMatch[4]?.trim(),
    });
    pendingAnnotations = [];
    pendingModifiers = [];
  }
  return fields;
}

function parseJavaMethods(body: string): JavaAstMethod[] {
  const methods: JavaAstMethod[] = [];
  const lines = body.split(/\r?\n/);
  let pendingAnnotations: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pendingAnnotations = [];
      continue;
    }
    if (line.startsWith('@')) {
      pendingAnnotations.push(...collectAnnotations(line));
      continue;
    }
    if (!line.includes('(') || (!line.endsWith('{') && !line.endsWith(';'))) {
      continue;
    }
    const methodMatch = line.match(/^(?:(public|protected|private|static|final|abstract|synchronized|default)\s+)*([A-Za-z0-9_<>,.? ?\[\]]+)\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*(?:\{|;)/);
    if (!methodMatch) {
      continue;
    }
    methods.push({
      name: methodMatch[3],
      returnType: methodMatch[2].replace(/\s+/g, ' ').trim(),
      annotations: [...new Set(pendingAnnotations.concat(collectAnnotations(line)))],
      modifiers: collectModifiers(line),
      parameters: parseParameters(methodMatch[4] ?? ''),
    });
    pendingAnnotations = [];
  }
  return methods;
}

function parseParameters(text: string): Array<{ name: string; type: string }> {
  if (!text.trim()) return [];
  return text
    .split(',')
    .map((entry) => entry.trim())
    .map((entry) => {
      const match = entry.match(/^([A-Za-z0-9_<>,.? ?\[\]]+)\s+([A-Za-z0-9_]+)$/);
      return match ? { type: match[1].replace(/\s+/g, ' ').trim(), name: match[2] } : undefined;
    })
    .filter((value): value is { name: string; type: string } => Boolean(value));
}

function extractTypeBody(source: string, typeIndex: number): string | undefined {
  const openIndex = source.indexOf('{', typeIndex);
  if (openIndex < 0) return undefined;
  let depth = 0;
  let inString: string | undefined;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const previous = source[index - 1];
    if (inString) {
      if (char === inString && previous !== '\\') {
        inString = undefined;
      }
      continue;
    }
    if (char === '"' || char === '\'') {
      inString = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, index);
      }
    }
  }
  return undefined;
}

function collectAnnotations(text: string): string[] {
  return [...text.matchAll(/@([A-Za-z0-9_]+)/g)].map((match) => match[1]).filter(Boolean);
}

function collectModifiers(text: string): string[] {
  return [...text.matchAll(/\b(public|protected|private|static|final|abstract|synchronized|default|volatile|transient)\b/g)].map((match) => match[1]);
}
