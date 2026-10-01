// One key per figure, so a line's figure matches the facts list however it's written: $6k, $6K, 6k,
// $6,000 and 6000 are all "6000"; $1.5k is "1500"; 2.1M and 2.1 million are "2100000". Percentages and
// multiples keep their sign ("90%", "2x"). Used by Studio's line checks (services/studio/engine.ts) and
// the B2 audit (services/audit/copyChecks.ts).

const MULTIPLIER: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

export function figureKey(raw: string): string {
  const s = raw.toLowerCase().replace(/\s+/g, '').replace(/^\$/, '').replace(/,/g, '');
  const m = /^(\d+(?:\.\d+)?)(k|thousand|m|million|bn|b|billion)?(%|x)?$/.exec(s);
  if (!m) return s;
  const [, num, mult, sign] = m;
  const value = mult ? Number((Number(num) * MULTIPLIER[mult]).toFixed(6)) : Number(num);
  return `${value}${sign || ''}`;
}

/**
 * Not a claim: zero ("$0 deductible"), and small counts (0–12) without a dollar sign ("3 ways", "the 2 of you").
 * Production test, 1 Oct: "$0–$2,000 deductible" was flagged quoting "$0", not the unsourced "$2,000".
 */
export function isSmallFigure(raw: string): boolean {
  const key = figureKey(raw);
  if (/^0(\.0+)?$/.test(key)) return true;
  return /^\d+$/.test(key) && Number(key) <= 12 && !raw.includes('$');
}

/** '"$2,000" isn't in the facts list' / '"$2,000" and "$3,500" aren't in the facts list'. */
export function notInFacts(raws: string[]): string {
  const q = raws.map(r => `"${r}"`);
  return q.length === 1 ? `${q[0]} isn't in the facts list` : `${q.slice(0, -1).join(', ')} and ${q.at(-1)} aren't in the facts list`;
}
