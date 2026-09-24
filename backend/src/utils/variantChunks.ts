// Panel generation in chunks. One OpenAI call asked for 30 members returned 11,
// so panels are built from calls of at most VARIANT_CHUNK_SIZE members and any
// shortfall is asked for again. Pure helpers so the logic is unit-tested.

export const VARIANT_CHUNK_SIZE = 10;

export class PanelShortError extends Error {
  constructor(public requested: number, public generated: number) {
    super(`Panel generation came up short: ${generated} of ${requested} members after retries. Existing panel left unchanged.`);
    this.name = 'PanelShortError';
  }
}

/** Chunk sizes needed for a panel of `count`, e.g. 25 -> [10, 10, 5]. */
export function planVariantChunks(count: number, size = VARIANT_CHUNK_SIZE): number[] {
  const chunks: number[] = [];
  for (let left = Math.max(0, Math.floor(count)); left > 0; left -= size) chunks.push(Math.min(size, left));
  return chunks;
}

interface NamedVariant { variant_name?: string }

/**
 * Append a batch to the panel, dropping malformed members and duplicate first
 * names (case-insensitive), and never growing the panel past `count`.
 */
export function mergeVariantBatch<T extends NamedVariant>(panel: T[], batch: unknown, count: number): T[] {
  const out = [...panel];
  const seen = new Set(out.map(v => (v.variant_name || '').trim().toLowerCase()));
  if (!Array.isArray(batch)) return out;
  for (const v of batch as T[]) {
    if (out.length >= count) break;
    if (!v || typeof v !== 'object') continue;
    const name = (v.variant_name || '').trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(v);
  }
  return out;
}
