import { parseSemanticMarkdown } from './semantic-markdown.js';
import type { SemanticDocument, SemanticSection } from './models.js';

// ─── Semantic reconciliation ────────────────────────────────────────────────
// Deterministic, AI-free diff between the current source.semantic.md (the single
// source of truth) and an "incoming" candidate produced by an import (code scan
// or document synthesis). Produces a merged markdown with git-style conflict
// markers for genuine contradictions, and a structured change list.
//
// Rules (see plan):
//   - add:      item in incoming, absent in current  → appended to the section
//   - conflict: same item identity, different content → git-style marker block
//   - absence:  item in current, absent in incoming   → KEPT (never auto-deleted)
// `authority` only affects the conflict marker labels / ordering:
//   - 'code' → current (semantic) wins by default; code shown as the alternative
//   - 'doc'  → the incoming doc is the newer intent; still review-gated

export type ReconcileAuthority = 'code' | 'doc';

export interface SemanticChange {
  type: 'add' | 'conflict';
  section: string;
  item: string;              // incoming item text (the proposed value)
  current?: string;          // current item text (conflict only)
}

export interface ReconcileResult {
  merged: string;
  changes: SemanticChange[];
  addCount: number;
  conflictCount: number;
}

// Identity key for an item within a section. Interface lines (api:/event:/…) key
// on their signature so a description edit is an update, not a new item. Other
// items key on their "head" (text before a — / – / : description separator).
function itemKey(item: string): string {
  const s = item.trim().toLowerCase();
  const iface = s.match(/^(api|event|graphql|grpc|rest):\s*`?\s*([^`—–:]+?)\s*`?\s*(?:[—–-]|$)/);
  if (iface) return `${iface[1]}:${iface[2].replace(/\s+/g, ' ').trim()}`;
  const stripped = s.replace(/\*\*/g, '').replace(/`/g, '');
  const head = stripped.split(/\s+[—–-]\s+|:\s+/)[0];
  return head.replace(/\s+/g, ' ').trim();
}

function normalizeValue(item: string): string {
  return item.trim().replace(/\s+/g, ' ').toLowerCase();
}

function sectionIsList(section: SemanticSection | undefined): boolean {
  return !!section && /^[-*]\s+/m.test(section.raw);
}

function renderItem(item: string, asList: boolean): string {
  return asList ? `- ${item}` : item;
}

function conflictBlock(current: string, incoming: string, asList: boolean, authority: ReconcileAuthority): string {
  const cur = renderItem(current, asList);
  const inc = renderItem(incoming, asList);
  const incLabel = authority === 'doc' ? 'incoming (doc)' : 'incoming (code)';
  return [
    '<<<<<<< current (semantic)',
    cur,
    '=======',
    inc,
    `>>>>>>> ${incLabel}`,
  ].join('\n');
}

// Rebuild one section's body by merging incoming items into the current items.
function reconcileSectionBody(
  current: SemanticSection | undefined,
  incoming: SemanticSection | undefined,
  authority: ReconcileAuthority,
  changes: SemanticChange[],
  sectionName: string,
): string {
  const asList = sectionIsList(current) || sectionIsList(incoming);
  const currentItems = current?.items ?? [];
  const incomingItems = incoming?.items ?? [];

  const incomingByKey = new Map<string, string>();
  for (const it of incomingItems) incomingByKey.set(itemKey(it), it);

  const currentKeys = new Set(currentItems.map(itemKey));

  const out: string[] = [];

  // 1. Walk current items in order; wrap genuine conflicts, keep everything else.
  for (const cur of currentItems) {
    const key = itemKey(cur);
    const inc = incomingByKey.get(key);
    if (inc !== undefined && normalizeValue(inc) !== normalizeValue(cur)) {
      out.push(conflictBlock(cur, inc, asList, authority));
      changes.push({ type: 'conflict', section: sectionName, item: inc, current: cur });
    } else {
      out.push(renderItem(cur, asList));
    }
  }

  // 2. Append incoming-only items (additions).
  for (const inc of incomingItems) {
    if (!currentKeys.has(itemKey(inc))) {
      out.push(renderItem(inc, asList));
      changes.push({ type: 'add', section: sectionName, item: inc });
    }
  }

  return out.join('\n');
}

// Replace/insert a section body in the raw markdown, preserving everything else.
function upsertSection(md: string, sectionName: string, title: string, body: string): string {
  const re = new RegExp(
    `(^#{1,2}\\s+${escapeRe(sectionName)}\\s*\\n)([\\s\\S]*?)(?=\\n#{1,2}\\s|$(?![\\s\\S]))`,
    'mi',
  );
  const heading = `## ${title || sectionName}`;
  if (re.test(md)) {
    return md.replace(re, `${heading}\n${body}\n`);
  }
  return `${md.trimEnd()}\n\n${heading}\n${body}\n`;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function reconcileSemantic(
  current: SemanticDocument,
  incoming: SemanticDocument,
  opts: { authority: ReconcileAuthority },
): ReconcileResult {
  const changes: SemanticChange[] = [];
  let merged = current.raw;

  // Union of section names, current order first, then incoming-only sections.
  const currentNames = current.orderedSections.map((s) => s.name);
  const incomingOnly = incoming.orderedSections
    .map((s) => s.name)
    .filter((n) => !current.sections[n]);
  const sectionOrder = [...currentNames, ...incomingOnly];

  for (const name of sectionOrder) {
    const cur = current.sections[name];
    const inc = incoming.sections[name];
    if (!inc) continue; // current-only section → kept untouched, no change

    const before = changes.length;
    const body = reconcileSectionBody(cur, inc, opts.authority, changes, name);
    // Only rewrite the section if something actually changed (add or conflict);
    // this keeps human prose / formatting of untouched sections byte-identical.
    if (changes.length > before) {
      const title = cur?.title ?? inc.title ?? name;
      merged = upsertSection(merged, name, title, body);
    }
  }

  const addCount = changes.filter((c) => c.type === 'add').length;
  const conflictCount = changes.filter((c) => c.type === 'conflict').length;
  return { merged, changes, addCount, conflictCount };
}

// Convenience: reconcile straight from two markdown strings.
export function reconcileSemanticMarkdown(
  currentMd: string,
  incomingMd: string,
  opts: { authority: ReconcileAuthority },
): ReconcileResult {
  return reconcileSemantic(
    parseSemanticMarkdown(currentMd),
    parseSemanticMarkdown(incomingMd),
    opts,
  );
}
