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

  const flush = () => {
    if (!currentName) return;
    const sectionName = normalizeSectionName(currentName);
    const raw = currentBuffer.join('\n').trim();
    const section: SemanticSection = {
      name: sectionName,
      title: currentName.trim(),
      raw,
      lines: raw ? raw.split(/\r?\n/) : [],
      items: splitSectionItems(raw),
    };
    sections[sectionName] = section;
    orderedSections.push(section);
  };

  for (const line of rawLines) {
    const headingMatch = /^#\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      flush();
      currentName = headingMatch[1].trim();
      currentBuffer = [];
      continue;
    }

    if (!currentName) {
      continue;
    }

    currentBuffer.push(line);
  }

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

export function deriveSystemName(document: SemanticDocument): string {
  const system = getSectionText(document, 'system');
  if (system) return system;
  return document.sourcePath ? basename(document.sourcePath) : 'SemanticSystem';
}
