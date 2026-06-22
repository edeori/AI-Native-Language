import Parser from 'tree-sitter';
import Java from 'tree-sitter-java';
import type { JavaAstField, JavaAstFile, JavaAstMethod, JavaAstType } from '@ai-native/semantic-shared';

export interface ParsedJavaSource {
  sourcePath?: string;
  language: 'java';
  packageName?: string;
  imports: string[];
  catalog: JavaAstFile;
  statistics: {
    nodes: number;
    namedNodes: number;
    types: number;
    fields: number;
    methods: number;
  };
  ast: JavaAstNode;
  tree?: JavaTreeNode;
}

export interface JavaSourceInput {
  path?: string;
  content: string;
}

export interface ParsedJavaProject {
  projectName?: string;
  projectRoot?: string;
  language: 'java';
  fileCount: number;
  files: ParsedJavaSource[];
  catalog: JavaAstFile[];
  summary: {
    packageNames: string[];
    imports: string[];
    typeNames: string[];
    statistics: {
      nodes: number;
      namedNodes: number;
      types: number;
      fields: number;
      methods: number;
    };
  };
}

export interface ParseJavaProjectProgress {
  index: number;
  total: number;
  file: JavaSourceInput;
  parsed: ParsedJavaSource;
}

export interface JavaAstNode {
  type: string;
  name?: string;
  text?: string;
  start: { row: number; column: number };
  end: { row: number; column: number };
  children?: JavaAstNode[];
}

export interface JavaTreeNode {
  type: string;
  named: boolean;
  start: { row: number; column: number };
  end: { row: number; column: number };
  text?: string;
  children?: JavaTreeNode[];
}

let parserInstance: Parser | undefined;

function getParser(): Parser {
  if (!parserInstance) {
    parserInstance = new Parser();
    parserInstance.setLanguage(Java as never);
  }
  return parserInstance;
}

export function parseJavaSourceWithTreeSitter(options: {
  sourceText: string;
  sourcePath?: string;
  includeTree?: boolean;
  maxDepth?: number;
}): ParsedJavaSource {
  const tree = getParser().parse(options.sourceText);
  const root = tree.rootNode;
  const maxDepth = options.maxDepth ?? 8;

  const packageName = findPackageName(root, options.sourceText);
  const imports = collectImports(root, options.sourceText);
  const ast = buildAstDocument(root, options.sourceText);
  const catalog = buildCatalog(options.sourceText, root, options.sourcePath);
  const treeSummary = options.includeTree === false ? undefined : summarizeNode(root, options.sourceText, 0, maxDepth);
  const statistics = countTreeStatistics(root);

  return {
    sourcePath: options.sourcePath,
    language: 'java',
    packageName,
    imports,
    catalog,
    statistics: {
      ...statistics,
      types: catalog.types.length,
      fields: countAstNodes(ast, 'field'),
      methods: countAstNodes(ast, 'method'),
    },
    ast,
    tree: treeSummary,
  };
}

export function parseJavaProjectWithTreeSitter(options: {
  files: JavaSourceInput[];
  projectName?: string;
  projectRoot?: string;
  includeTree?: boolean;
  maxDepth?: number;
  onFileParsed?: (progress: ParseJavaProjectProgress) => void;
}): ParsedJavaProject {
  const total = options.files.length;
  const files = options.files.map((file, index) => {
    const parsed = parseJavaSourceWithTreeSitter({
      sourcePath: file.path,
      sourceText: file.content,
      includeTree: options.includeTree,
      maxDepth: options.maxDepth,
    });
    options.onFileParsed?.({ index, total, file, parsed });
    return parsed;
  });

  return {
    projectName: options.projectName,
    projectRoot: options.projectRoot,
    language: 'java',
    fileCount: files.length,
    files,
    catalog: files.map((file) => file.catalog),
    summary: {
      packageNames: unique(files.map((file) => file.packageName).filter((value): value is string => Boolean(value))),
      imports: unique(files.flatMap((file) => file.imports)),
      typeNames: unique(files.flatMap((file) => file.catalog.types.map((type) => type.name).filter((value): value is string => Boolean(value)))),
      statistics: files.reduce(
        (accumulator, file) => ({
          nodes: accumulator.nodes + file.statistics.nodes,
          namedNodes: accumulator.namedNodes + file.statistics.namedNodes,
          types: accumulator.types + file.statistics.types,
          fields: accumulator.fields + file.statistics.fields,
          methods: accumulator.methods + file.statistics.methods,
        }),
        { nodes: 0, namedNodes: 0, types: 0, fields: 0, methods: 0 },
      ),
    },
  };
}

function buildAstDocument(root: Parser.SyntaxNode, sourceText: string): JavaAstNode {
  return {
    type: 'compilation_unit',
    name: 'CompilationUnit',
    start: toPoint(root.startPosition),
    end: toPoint(root.endPosition),
    children: root.namedChildren.flatMap((child) => buildAstNodes(child, sourceText)),
  };
}

function buildCatalog(sourceText: string, root: Parser.SyntaxNode, sourcePath?: string): JavaAstFile {
  const packageName = findPackageName(root, sourceText);
  const imports = collectImports(root, sourceText);
  const types = root.namedChildren.flatMap((child) => {
    if (child.type === 'class_declaration' || child.type === 'interface_declaration' || child.type === 'enum_declaration' || child.type === 'record_declaration') {
      return [buildCatalogType(child, sourceText)];
    }
    return [];
  });

  return {
    file: sourcePath ?? '<memory>',
    packageName,
    imports,
    types,
  };
}

function buildCatalogType(node: Parser.SyntaxNode, sourceText: string): JavaAstType {
  const name = findChildText(node, sourceText, ['identifier']) ?? 'UnknownType';
  const annotations = collectAnnotationsFromText(sliceText(sourceText, node));
  const modifiers = collectModifiersFromText(sliceText(sourceText, node));
  const fields: JavaAstField[] = [];
  const methods: JavaAstMethod[] = [];

  for (const child of node.namedChildren) {
    if (child.type === 'class_body' || child.type === 'interface_body' || child.type === 'enum_body' || child.type === 'record_body') {
      for (const member of child.namedChildren) {
        if (member.type === 'field_declaration') {
          fields.push(...buildCatalogFields(member, sourceText));
        } else if (member.type === 'method_declaration' || member.type === 'constructor_declaration') {
          methods.push(buildCatalogMethod(member, sourceText));
        }
      }
    }
  }

  return {
    kind: node.type === 'interface_declaration' ? 'interface' : node.type === 'enum_declaration' ? 'enum' : node.type === 'record_declaration' ? 'record' : 'class',
    name,
    annotations,
    modifiers,
    fields,
    methods,
  };
}

function buildCatalogFields(node: Parser.SyntaxNode, sourceText: string): JavaAstField[] {
  const declarationText = sliceText(sourceText, node);
  const annotations = collectAnnotationsFromText(declarationText);
  const modifiers = collectModifiersFromText(declarationText);
  const fieldType = findNode(node, ['integral_type', 'floating_point_type', 'boolean_type', 'void_type', 'scoped_type_identifier', 'generic_type', 'type_identifier']) ?? undefined;
  const type = fieldType ? sliceText(sourceText, fieldType).replace(/\s+/g, ' ').trim() : 'Object';
  const declarators = node.namedChildren.filter((child) => child.type === 'variable_declarator');
  return declarators.map((declarator) => {
    const name = findChildText(declarator, sourceText, ['identifier']) ?? 'field';
    const initializerNode = declarator.namedChildren.find((child) => child.type === 'expression');
    return {
      name,
      type,
      annotations,
      modifiers,
      initializer: initializerNode ? sliceText(sourceText, initializerNode).trim() : undefined,
    };
  });
}

function buildCatalogMethod(node: Parser.SyntaxNode, sourceText: string): JavaAstMethod {
  const name = findChildText(node, sourceText, ['identifier']) ?? (node.type === 'constructor_declaration' ? 'constructor' : 'method');
  const annotations = collectAnnotationsFromText(sliceText(sourceText, node));
  const modifiers = collectModifiersFromText(sliceText(sourceText, node));
  const returnTypeNode = node.namedChildren.find((child) =>
    ['integral_type', 'floating_point_type', 'boolean_type', 'void_type', 'scoped_type_identifier', 'generic_type', 'type_identifier'].includes(child.type),
  );
  const returnType = node.type === 'constructor_declaration' ? name : returnTypeNode ? sliceText(sourceText, returnTypeNode).replace(/\s+/g, ' ').trim() : 'void';
  const parameters = node.namedChildren
    .find((child) => child.type === 'formal_parameters')
    ?.namedChildren.filter((child) => child.type === 'formal_parameter')
    .map((parameter) => {
      const parameterTypeNode = parameter.namedChildren.find((child) =>
        ['integral_type', 'floating_point_type', 'boolean_type', 'void_type', 'scoped_type_identifier', 'generic_type', 'type_identifier'].includes(child.type),
      );
      const parameterName = findChildText(parameter, sourceText, ['identifier']) ?? 'arg';
      return {
        name: parameterName,
        type: parameterTypeNode ? sliceText(sourceText, parameterTypeNode).replace(/\s+/g, ' ').trim() : 'Object',
      };
    }) ?? [];
  return {
    name,
    returnType,
    annotations,
    modifiers,
    parameters,
  };
}

function buildAstNodes(node: Parser.SyntaxNode, sourceText: string): JavaAstNode[] {
  switch (node.type) {
    case 'package_declaration':
      return [
        {
          type: 'package_declaration',
          name: findChildText(node, sourceText, ['scoped_identifier', 'identifier']),
          text: sliceText(sourceText, node),
          start: toPoint(node.startPosition),
          end: toPoint(node.endPosition),
        },
      ];
    case 'import_declaration':
      return [
        {
          type: 'import_declaration',
          name: findChildText(node, sourceText, ['scoped_identifier', 'identifier']),
          text: sliceText(sourceText, node),
          start: toPoint(node.startPosition),
          end: toPoint(node.endPosition),
        },
      ];
    case 'class_declaration':
    case 'interface_declaration':
    case 'enum_declaration':
    case 'record_declaration':
      return [buildTypeNode(node, sourceText)];
    default:
      return node.namedChildren.flatMap((child) => buildAstNodes(child, sourceText));
  }
}

function buildTypeNode(node: Parser.SyntaxNode, sourceText: string): JavaAstNode {
  const name = findChildText(node, sourceText, ['identifier']);
  const children = node.namedChildren.flatMap((child) => {
    if (child.type === 'class_body' || child.type === 'interface_body' || child.type === 'enum_body' || child.type === 'record_body') {
      return child.namedChildren.flatMap((member) => buildMemberNode(member, sourceText));
    }
    return [];
  });

  return {
    type: node.type,
    name,
    text: sliceText(sourceText, node),
    start: toPoint(node.startPosition),
    end: toPoint(node.endPosition),
    children,
  };
}

function buildMemberNode(node: Parser.SyntaxNode, sourceText: string): JavaAstNode[] {
  switch (node.type) {
    case 'field_declaration':
      return [buildFieldNode(node, sourceText)];
    case 'method_declaration':
    case 'constructor_declaration':
      return [buildMethodNode(node, sourceText)];
    case 'class_declaration':
    case 'interface_declaration':
    case 'enum_declaration':
    case 'record_declaration':
      return [buildTypeNode(node, sourceText)];
    default:
      return [];
  }
}

function buildFieldNode(node: Parser.SyntaxNode, sourceText: string): JavaAstNode {
  const name = findChildText(node, sourceText, ['variable_declarator', 'identifier']);
  return {
    type: 'field',
    name,
    text: sliceText(sourceText, node),
    start: toPoint(node.startPosition),
    end: toPoint(node.endPosition),
  };
}

function buildMethodNode(node: Parser.SyntaxNode, sourceText: string): JavaAstNode {
  const name = findChildText(node, sourceText, ['identifier', 'constructor_declaration']);
  return {
    type: node.type === 'constructor_declaration' ? 'constructor' : 'method',
    name,
    text: sliceText(sourceText, node),
    start: toPoint(node.startPosition),
    end: toPoint(node.endPosition),
  };
}

function findPackageName(root: Parser.SyntaxNode, sourceText: string): string | undefined {
  const packageNode = root.namedChildren.find((child) => child.type === 'package_declaration');
  return packageNode ? findChildText(packageNode, sourceText, ['scoped_identifier', 'identifier']) : undefined;
}

function collectImports(root: Parser.SyntaxNode, sourceText: string): string[] {
  return root.namedChildren
    .filter((child) => child.type === 'import_declaration')
    .map((child) => findChildText(child, sourceText, ['scoped_identifier', 'identifier']))
    .filter((value): value is string => Boolean(value));
}

function findChildText(node: Parser.SyntaxNode, sourceText: string, types: string[]): string | undefined {
  const found = findNode(node, types);
  return found ? sliceText(sourceText, found).replace(/^\s+|\s+$/g, '').replace(/;$/, '') : undefined;
}

function findNode(node: Parser.SyntaxNode, types: string[]): Parser.SyntaxNode | undefined {
  if (types.includes(node.type)) {
    return node;
  }
  for (const child of node.namedChildren) {
    const found = findNode(child, types);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function collectAnnotationsFromText(text: string): string[] {
  return [...new Set([...text.matchAll(/@([A-Za-z0-9_]+)/g)].map((match) => match[1]).filter(Boolean))];
}

function collectModifiersFromText(text: string): string[] {
  return [...new Set([...text.matchAll(/\b(public|protected|private|static|final|abstract|synchronized|default|volatile|transient)\b/g)].map((match) => match[1]))];
}

function summarizeNode(node: Parser.SyntaxNode, sourceText: string, depth: number, maxDepth: number): JavaTreeNode {
  const children = depth >= maxDepth ? undefined : node.namedChildren.map((child) => summarizeNode(child, sourceText, depth + 1, maxDepth));
  return {
    type: node.type,
    named: node.isNamed,
    start: toPoint(node.startPosition),
    end: toPoint(node.endPosition),
    text: depth <= 2 ? sliceText(sourceText, node).slice(0, 200) : undefined,
    children: children && children.length ? children : undefined,
  };
}

function countTreeStatistics(root: Parser.SyntaxNode): { nodes: number; namedNodes: number } {
  let nodes = 0;
  let namedNodes = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    nodes += 1;
    if (current.isNamed) namedNodes += 1;
    for (const child of current.children) {
      stack.push(child);
    }
  }
  return { nodes, namedNodes };
}

function countAstNodes(node: JavaAstNode, type: string): number {
  const self = node.type === type ? 1 : 0;
  const children = node.children?.reduce((sum, child) => sum + countAstNodes(child, type), 0) ?? 0;
  return self + children;
}

function sliceText(sourceText: string, node: Parser.SyntaxNode): string {
  return sourceText.slice(node.startIndex, node.endIndex);
}

function toPoint(position: { row: number; column: number }): { row: number; column: number } {
  return { row: position.row, column: position.column };
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}
