import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { SemanticDocument, SemanticSection, SemanticSectionName } from './models.js';

const KNOWN_SECTIONS = new Set<SemanticSectionName>([
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
  'acceptance_criteria',
]);

export function normalizeSectionName(rawName: string): string {
  return rawName.trim().toLowerCase().replace(/\s+/g, '_');
}

export function splitSectionItems(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const listItems = lines
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);

  if (listItems.length > 0) return listItems;

  return raw
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

export function parseSemanticMarkdown(markdown: string, sourcePath?: string): SemanticDocument {
  const rawLines = markdown.split(/\r?\n/);
  const sections: Record<string, SemanticSection> = {};
  const orderedSections: SemanticSection[] = [];

  let currentName = '';
  let currentBuffer: string[] = [];
  let currentStartLine = 0;
  let currentEndLine = 0;

  const flush = () => {
    if (!currentName) return;
    const sectionName = normalizeSectionName(currentName);
    const raw = currentBuffer.join('\n').trim();
    const lines = raw ? raw.split(/\r?\n/) : [];
    const section: SemanticSection = {
      name: sectionName,
      title: currentName.trim(),
      raw,
      lines,
      items: splitSectionItems(raw),
      startLine: currentStartLine,
      endLine: currentEndLine,
    };
    sections[sectionName] = section;
    orderedSections.push(section);
  };

  rawLines.forEach((line, lineNumber) => {
    const headingMatch = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      flush();
      currentName = headingMatch[1].trim();
      currentBuffer = [];
      currentStartLine = lineNumber;
      currentEndLine = lineNumber;
      return;
    }

    if (!currentName) {
      return;
    }

    currentBuffer.push(line);
    currentEndLine = lineNumber;
  });

  flush();

  return {
    sourcePath,
    sections,
    orderedSections,
    raw: markdown,
  };
}

export async function parseSemanticMarkdownFromFile(path: string): Promise<SemanticDocument> {
  const markdown = await readFile(path, 'utf8');
  return parseSemanticMarkdown(markdown, path);
}

export function hasRequiredSections(document: SemanticDocument): string[] {
  return [...KNOWN_SECTIONS].filter((section) => !document.sections[section]);
}

export function getSectionText(document: SemanticDocument, section: string): string {
  return document.sections[section]?.raw.trim() ?? '';
}

export function getSectionItems(document: SemanticDocument, section: string): string[] {
  return document.sections[section]?.items ?? [];
}

export function getSectionItemLine(document: SemanticDocument, section: string, itemIndex: number): number | undefined {
  const targetSection = document.sections[section];
  if (!targetSection) {
    return undefined;
  }

  let seenItems = 0;
  for (let index = 0; index < targetSection.lines.length; index += 1) {
    const line = targetSection.lines[index]?.trim() ?? '';
    if (!/^[-*]\s+/.test(line)) {
      continue;
    }

    if (seenItems === itemIndex) {
      return targetSection.startLine + index + 1;
    }
    seenItems += 1;
  }

  return undefined;
}

export function deriveSystemName(document: SemanticDocument): string {
  const system = getSectionText(document, 'system');
  if (system) {
    const firstLine = system
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (firstLine) {
      return trimText(firstLine, 80);
    }
  }

  if (document.sourcePath) {
    const source = basename(document.sourcePath).replace(/\.semantic\.md$/i, '').replace(/\.[^.]+$/i, '');
    if (source) {
      return trimText(source.replace(/[_-]+/g, ' '), 80);
    }
  }

  return 'SemanticSystem';
}

function trimText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const trimmed = value.slice(0, maxLength).replace(/[\s,;:-]+$/g, '').trim();
  return trimmed || value.slice(0, maxLength);
}
