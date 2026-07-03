import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import * as path from 'node:path';

// ─── AI efficiency metrics ───────────────────────────────────────────────────
// Records actual AI token usage per operation to .ai-native/metrics/metrics.json,
// and estimates the "raw baseline" (what dumping the whole doc/code corpus into a
// chat would cost) so the Actions view can show how much the structured pipeline
// saves. Deterministic; no AI, no network.

export interface OperationMetric {
  calls: number;
  inputTokens: number;        // fresh, uncached input (billed at full rate)
  cachedInputTokens: number;  // prompt-cache reads (re-sent context; billed ~10%)
  cacheWriteTokens: number;   // prompt-cache writes (billed ~125%)
  outputTokens: number;
  schemaVersion: number;      // measurement schema; < CURRENT_SCHEMA_VERSION = invalid/legacy
}

export interface MetricsFile {
  operations: Record<string, OperationMetric>;
  totals: OperationMetric;
}

// Bump when the meaning of the recorded numbers changes. v1 bundled cache
// reads/writes into `inputTokens` (inflated ~10x, no cache split), so v1
// measurements are flagged invalid and excluded from the efficiency figures.
// v2 records the cache split, so cost can be computed honestly.
export const CURRENT_SCHEMA_VERSION = 2;
export const LEGACY_SCHEMA_VERSION = 1;

// Anthropic prompt-cache pricing, relative to a base input token. Used to turn
// the raw (face-value) token counts into a billed-equivalent figure so the
// efficiency panel reflects real cost instead of the ~10x-inflated raw sum.
export const CACHE_READ_WEIGHT = 0.1;   // cache reads are billed at ~10% of input
export const CACHE_WRITE_WEIGHT = 1.25; // 5-minute cache writes are billed at ~125%

// A metric is valid only if it was recorded under the current schema.
export function isValidMetric(m: OperationMetric): boolean {
  return m.schemaVersion >= CURRENT_SCHEMA_VERSION;
}

function emptyMetric(): OperationMetric {
  return { calls: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, schemaVersion: CURRENT_SCHEMA_VERSION };
}

const EMPTY: MetricsFile = { operations: {}, totals: emptyMetric() };

export function estimateTokens(text: string): number {
  // ~4 chars/token is the standard rough estimate for English/code.
  return Math.ceil(text.length / 4);
}

// Face-value input tokens: what the provider counted, summed across buckets.
// This is the "raw" number that looks huge in long agentic runs.
export function faceValueInputTokens(m: OperationMetric): number {
  return m.inputTokens + m.cachedInputTokens + m.cacheWriteTokens;
}

// Cache-adjusted (billed-equivalent) input tokens: cache reads/writes weighted
// by their real price. This is the honest cost figure.
export function billedEquivalentInputTokens(m: OperationMetric): number {
  return Math.round(
    m.inputTokens + m.cachedInputTokens * CACHE_READ_WEIGHT + m.cacheWriteTokens * CACHE_WRITE_WEIGHT,
  );
}

// Normalize a metric read from disk: older files predate the cache split and
// only carry `inputTokens` (which back then bundled cache reads/writes in).
function normalizeMetric(raw: unknown): OperationMetric {
  const o = (raw ?? {}) as Partial<OperationMetric>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    calls: num(o.calls),
    inputTokens: num(o.inputTokens),
    cachedInputTokens: num(o.cachedInputTokens),
    cacheWriteTokens: num(o.cacheWriteTokens),
    outputTokens: num(o.outputTokens),
    // No recorded version → written by pre-split code → legacy/invalid.
    schemaVersion: num(o.schemaVersion) || LEGACY_SCHEMA_VERSION,
  };
}

function metricsPath(artifactRoot: string): string {
  return path.join(artifactRoot, 'metrics', 'metrics.json');
}

export function readMetrics(artifactRoot: string): MetricsFile {
  try {
    const raw = fssync.readFileSync(metricsPath(artifactRoot), 'utf8');
    const parsed = JSON.parse(raw) as MetricsFile;
    if (parsed && typeof parsed === 'object' && parsed.operations && parsed.totals) {
      const operations: Record<string, OperationMetric> = {};
      for (const [name, op] of Object.entries(parsed.operations)) operations[name] = normalizeMetric(op);
      return { operations, totals: normalizeMetric(parsed.totals) };
    }
  } catch { /* none yet */ }
  return structuredClone(EMPTY);
}

export interface UsageSample {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export async function recordUsage(
  artifactRoot: string,
  operation: string,
  sample: UsageSample,
): Promise<void> {
  const metrics = readMetrics(artifactRoot);
  const op = metrics.operations[operation] ?? emptyMetric();
  op.calls += 1;
  op.inputTokens += sample.inputTokens;
  op.cachedInputTokens += sample.cachedInputTokens;
  op.cacheWriteTokens += sample.cacheWriteTokens;
  op.outputTokens += sample.outputTokens;
  op.schemaVersion = CURRENT_SCHEMA_VERSION;
  metrics.operations[operation] = op;
  metrics.totals.calls += 1;
  metrics.totals.inputTokens += sample.inputTokens;
  metrics.totals.cachedInputTokens += sample.cachedInputTokens;
  metrics.totals.cacheWriteTokens += sample.cacheWriteTokens;
  metrics.totals.outputTokens += sample.outputTokens;
  await fs.mkdir(path.dirname(metricsPath(artifactRoot)), { recursive: true });
  await fs.writeFile(metricsPath(artifactRoot), JSON.stringify(metrics, null, 2) + '\n', 'utf8');
}

// Estimate the tokens a "raw" approach would ingest: every imported document plus
// every source file the pipeline distilled into the semantic model. This is the
// corpus a human would otherwise paste into a chat.
const SOURCE_EXTS = new Set(['.java', '.kt', '.ts', '.tsx', '.js', '.py', '.go', '.cs', '.sql', '.xml', '.yaml', '.yml']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'build', 'out', 'dist', '.gradle', '.ai-native']);

export async function estimateRawBaselineTokens(workspaceRoot: string, artifactRoot: string): Promise<number> {
  let chars = 0;
  // Imported documents (already converted to markdown under .ai-native/imports).
  chars += await sumDirChars(path.join(artifactRoot, 'imports'), new Set(['.md', '.txt']), 0);
  // Source files across the workspace.
  chars += await sumDirChars(workspaceRoot, SOURCE_EXTS, 0);
  return estimateTokens('x'.repeat(chars));
}

async function sumDirChars(dir: string, exts: Set<string>, depth: number): Promise<number> {
  if (depth > 12) return 0;
  let entries: fssync.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      total += await sumDirChars(path.join(dir, entry.name), exts, depth + 1);
    } else if (exts.has(path.extname(entry.name).toLowerCase())) {
      try {
        const stat = await fs.stat(path.join(dir, entry.name));
        total += stat.size;
      } catch { /* skip */ }
    }
  }
  return total;
}
