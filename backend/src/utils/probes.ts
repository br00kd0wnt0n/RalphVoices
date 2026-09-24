// Intent probes: after the in-character response, ask one yes/no question at a
// time and read P(Yes) from the token logprobs instead of a sampled 1-10 score.
//
// Why: on the Trupanion round-one pass (24 Sept 2026) the same concept moved by
// up to 12 RalphScore points between identical runs on a 20-member panel. A
// sampled integer carries the sampling noise; the probability behind the
// answer doesn't. The three questions map to the metrics the predictions
// ledger is scored on: stop (hook rate), tap (CTR), quote (conversion intent).

export type ProbeKey = 'p_stop' | 'p_tap' | 'p_quote';

export const PROBE_QUESTIONS: Record<ProbeKey, string> = {
  p_stop: 'You are scrolling your feed and this ad appears. Would you actually stop scrolling to take it in?',
  p_tap: 'Would you tap on this ad to find out more?',
  p_quote: 'After seeing this ad, would you go on to take the action it asks for (for example, getting a quote or signing up)?',
};

// The probe reuses the concept-response system prompt, which tells the model to
// end with a ---SCORES--- JSON block. Without an explicit override the first
// token can be "---" or "{" instead of Yes/No, and probabilityYes returns null.
export const PROBE_SUFFIX = 'Answer as yourself, honestly, with exactly one word: Yes or No. This is a quick follow-up, not a new review: do not add scores, JSON or any other text.';

export type Probes = Record<ProbeKey, number | null>;

interface TopLogprob { token: string; logprob: number }

/**
 * P(Yes) normalised over the Yes/No mass in the first token's top logprobs.
 * Tokens are matched case-insensitively after trimming spaces and punctuation,
 * so "Yes", " yes", "YES." all count. Returns null if neither answer appears.
 */
export function probabilityYes(top: TopLogprob[] | null | undefined): number | null {
  if (!Array.isArray(top) || top.length === 0) return null;
  let yes = 0;
  let no = 0;
  for (const t of top) {
    const tok = String(t?.token ?? '').trim().replace(/[^a-z]/gi, '').toLowerCase();
    const p = Math.exp(Number(t?.logprob));
    if (!Number.isFinite(p)) continue;
    if (tok === 'yes') yes += p;
    else if (tok === 'no') no += p;
  }
  if (yes + no === 0) return null;
  return Math.round((yes / (yes + no)) * 1000) / 1000;
}

/** Mean of each probe over responses that have it; null when none do. */
export function averageProbes(list: Array<Partial<Probes> | null | undefined>): (Probes & { n: number }) | null {
  const keys: ProbeKey[] = ['p_stop', 'p_tap', 'p_quote'];
  const sums: Record<ProbeKey, number> = { p_stop: 0, p_tap: 0, p_quote: 0 };
  const counts: Record<ProbeKey, number> = { p_stop: 0, p_tap: 0, p_quote: 0 };
  let n = 0;
  for (const p of list) {
    if (!p) continue;
    let any = false;
    for (const k of keys) {
      const v = p[k];
      if (typeof v === 'number' && Number.isFinite(v)) { sums[k] += v; counts[k]++; any = true; }
    }
    if (any) n++;
  }
  if (n === 0) return null;
  const avg = (k: ProbeKey) => (counts[k] ? Math.round((sums[k] / counts[k]) * 1000) / 1000 : null);
  return { p_stop: avg('p_stop'), p_tap: avg('p_tap'), p_quote: avg('p_quote'), n };
}
