// B2 copy match: does the finished asset carry the signed-off wording?
//
// The signed-off copy for a stub comes from Studio. Fields meant to be seen on
// the asset (on-image text, the TikTok hook, and the headline when the creative
// carries it) are looked for in the text read off the images and frames and in
// the voice-over. Compared normalised: case, punctuation and line breaks don't
// count. Amber when the wording differs materially; red when a required caveat
// in the signed-off copy (e.g. "at participating hospitals") is missing from the
// asset. Both versions are quoted in the flag.
import type { Flag, Rules } from './types.js';

export interface SignedOffCopy {
  primary_text?: string;
  headline?: string;
  description?: string;
  caption?: string;
  hook?: string;
  on_image?: string;
}

/** Signed-off fields → the rules file's field ids (limits, price-lead fields). */
export const COPY_FIELDS: Record<keyof SignedOffCopy, { field?: string; label: string; onAsset: 'must' | 'maybe' | 'no' }> = {
  // meta_on_image arrives in rules v2.10: with it, on-image copy gets its limits and the price-lead check; without it they're skipped.
  on_image: { field: 'meta_on_image', label: 'On-image text (signed off)', onAsset: 'must' },
  hook: { field: 'tiktok_hook', label: 'TikTok hook / on-screen text', onAsset: 'must' },
  // Post copy since 30 Sep (Brook): text on the image is its own field (on_image), so the headline runs below the image.
  headline: { field: 'meta_headline', label: 'Meta headline', onAsset: 'no' },
  primary_text: { field: 'meta_primary', label: 'Meta primary text', onAsset: 'no' },
  description: { field: 'meta_description', label: 'Meta description', onAsset: 'no' },
  caption: { field: 'tiktok_caption', label: 'TikTok caption', onAsset: 'no' },
};

export const COPY_MATCH_SOURCE = 'Signed-off copy for this stub (Studio shortlist)';
/** Similarity at or above this, but short of an exact match, is "the same line, reworded". Below it, the line isn't on the asset. */
export const REWORD_MIN = 0.5;

export function normalise(s: string): string {
  return s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/&/g, ' and ')
    .replace(/[^a-z0-9$%' ]+/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
}

function lcs(a: string[], b: string[]): number {
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * The stretch of the asset's text closest to the signed-off line: every window
 * of about the line's length, scored by longest common word subsequence over
 * the longer of the two (1 = the same words in the same order).
 */
export function bestMatch(signed: string, found: string): { similarity: number; excerpt: string } {
  const s = normalise(signed).split(' ').filter(Boolean);
  const f = normalise(found).split(' ').filter(Boolean);
  if (!s.length) return { similarity: 1, excerpt: '' };
  if (!f.length) return { similarity: 0, excerpt: '' };
  let best = { similarity: 0, excerpt: '' };
  let bestDiff = Infinity;
  for (let len = Math.max(1, s.length - 3); len <= s.length + 3; len++) {
    const starts = Math.max(1, f.length - len + 1);
    for (let i = 0; i < starts; i++) {
      const w = f.slice(i, i + len);
      const sim = lcs(s, w) / Math.max(s.length, w.length);
      // Ties go to the window closest in length to the signed-off line, so the quote isn't cut short.
      if (sim > best.similarity || (sim === best.similarity && Math.abs(w.length - s.length) < bestDiff)) { best = { similarity: sim, excerpt: w.join(' ') }; bestDiff = Math.abs(w.length - s.length); }
    }
  }
  return { similarity: Math.round(best.similarity * 1000) / 1000, excerpt: best.excerpt };
}

export interface CopyMatchRow {
  field: keyof SignedOffCopy;
  signed_off: string;
  found: string;            // closest stretch on the asset (normalised), '' if none
  similarity: number;       // 0-1
  status: 'match' | 'reworded' | 'not on asset' | 'not expected on asset';
}

/**
 * `assetText` is everything read off the asset: each image or frame's text and
 * the voice-over. Returns the per-field comparison and the flags.
 */
export function copyMatch(copy: SignedOffCopy, assetText: Array<{ where: string; text: string }>, rules: Rules): { rows: CopyMatchRow[]; flags: Flag[] } {
  const rows: CopyMatchRow[] = [];
  const flags: Flag[] = [];
  const all = assetText.map(t => t.text).join('\n');
  const allNorm = normalise(all);
  for (const [k, v] of Object.entries(copy) as Array<[keyof SignedOffCopy, string | undefined]>) {
    const def = COPY_FIELDS[k];
    if (!def || !v || !v.trim()) continue;
    if (def.onAsset === 'no') { rows.push({ field: k, signed_off: v, found: '', similarity: 0, status: 'not expected on asset' }); continue; }
    const exact = allNorm.includes(normalise(v));
    // Each card, frame or the voice-over on its own first; the joined text only when a line spans them.
    let m = { similarity: 0, excerpt: '', where: undefined as string | undefined };
    if (exact) m = { similarity: 1, excerpt: normalise(v), where: assetText.find(t => normalise(t.text).includes(normalise(v)))?.where };
    else {
      for (const t of assetText) { const b = bestMatch(v, t.text); if (b.similarity > m.similarity) m = { ...b, where: t.where }; }
      const joined = bestMatch(v, all);
      if (joined.similarity > m.similarity) m = { ...joined, where: assetText.find(t => normalise(t.text).includes(joined.excerpt.split(' ')[0]))?.where };
    }
    const status: CopyMatchRow['status'] = exact ? 'match' : m.similarity >= REWORD_MIN ? 'reworded' : 'not on asset';
    rows.push({ field: k, signed_off: v, found: m.excerpt, similarity: m.similarity, status });
    if (status === 'reworded') {
      flags.push({ severity: 'amber', rule: 'COPY_MATCH', label: `${def.label} differs from the signed-off wording`, source: COPY_MATCH_SOURCE, quote: `signed off: "${v.trim()}" · on the asset: "${m.excerpt}"`, where: m.where, why: `${Math.round(m.similarity * 100)}% of the words match, in order`, by: ['rule'] });
    } else if (status === 'not on asset') {
      flags.push({
        severity: def.onAsset === 'must' ? 'amber' : 'grey', rule: 'COPY_MATCH',
        label: def.onAsset === 'must' ? `${def.label} not found on the asset` : `${def.label} isn't on the image (fine if it runs in the headline field)`,
        source: COPY_MATCH_SOURCE, quote: `signed off: "${v.trim()}"${m.excerpt ? ` · closest on the asset: "${m.excerpt}"` : ''}`, why: `${Math.round(m.similarity * 100)}% of the words match`, by: ['rule'],
      });
    }
  }

  // Required caveats: present in a signed-off field meant for the asset, missing from the asset.
  const onAssetCopy = (Object.entries(copy) as Array<[keyof SignedOffCopy, string | undefined]>).filter(([k, v]) => v && COPY_FIELDS[k] && COPY_FIELDS[k].onAsset !== 'no');
  for (const c of rules.compliance.filter(x => x.check === 'require')) {
    for (const rp of c.requires_patterns || []) {
      const re = new RegExp(rp, 'i');
      const inSigned = onAssetCopy.find(([, v]) => re.test(v!));
      if (!inSigned || re.test(all)) continue;
      const caveat = re.exec(inSigned[1]!)![0];
      flags.push({ severity: 'red', rule: 'COPY_CAVEAT', label: `A required caveat in the signed-off copy is missing from the asset (${c.id}: ${c.rule})`, source: `${COPY_MATCH_SOURCE}; ${c.source}`, quote: `signed off (${COPY_FIELDS[inSigned[0]].label}): "…${caveat}…" · on the asset: not found`, by: ['rule'] });
    }
  }
  return { rows, flags };
}
