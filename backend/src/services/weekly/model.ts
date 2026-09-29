// B3 weekly read: the model. Pure; no database, no network.
//
// Per metric (hook rate, link CTR, quotes per 1,000 impressions), each ad's rate
// is a binomial rate (events / impressions) with an empirical-Bayes beta prior:
//   overall mean → persona mean → persona × platform mean → persona × platform × format mean,
// each level pulled towards its parent as if the parent were worth
// `group_prior_ads` more ads. The prior's strength comes from how much ads'
// true rates differ (between-ad CV), estimated from the data once there are
// enough ads and clamped to the configured bounds. Posteriors are Beta; P(best
// in cell) and P(worse than the cell median) come from seeded Monte Carlo draws.
//
// Feature effects are a random-effects comparison on the log-rate scale: ads with
// a feature against ads without it inside the same stratum (persona, platform,
// format), pooled across strata by inverse variance. Each ad's variance includes
// the between-ad spread, so two ads can't make a feature look certain however many
// impressions they have.
import type { WeeklyConfig, MetricKey } from './config.js';
export type { MetricKey };
import { METRIC_KEYS } from './config.js';
import { rng, hashSeed, beta, quantile, zQuantile } from './stats.js';

export interface AdData {
  key: string;             // unique per ad (name + campaign + ad set)
  ad_name: string;
  campaign?: string;
  ad_set?: string;
  stub: string;
  asset: string;
  persona: string;
  territory: string;
  region?: string;         // US / CA from the newer name form ('' when the name has none)
  visual?: string | null;  // the visual letter, newer form only
  format: string;
  platform: string;        // from the name: META | TT
  version: number;
  features: string[] | null;
  first_day: string;
  last_day: string;
  days_live: number;
  live_now: boolean;       // delivered in the last 7 days of the window
  spend: number;
  impressions: number;
  video_3s: number;
  link_clicks: number;
  landing_page_views: number;
  quotes: number;
  enrollments: number;
  has_quotes?: boolean;    // false when the ad's export had no quote column (not the same as 0 quotes)
}

export type Call = 'scale' | 'scale (tied)' | 'cut' | 'keep testing' | 'too early to call';

export interface MetricRead {
  metric: MetricKey;
  n: number;               // impressions
  x: number;               // events
  rate_raw: number;
  rate: number;            // posterior mean
  lo: number;              // interval bounds (config.model.interval)
  hi: number;
  prior_mean: number;      // the group mean it was pulled towards
  readable: boolean;       // enough impressions and days to call
  p_best: number | null;   // among readable ads in the cell
  p_worse_than_median: number | null;
  p_beat_median: number | null;
  p_ahead: Record<string, number>; // P(this ad's rate > that ad's), by ad key, same draws as P(best)
  tied_with: string[];     // for the ad set's leader: ads it can't be separated from; for those ads: the leader
  call: Call;
  reason: string;
}

export interface Headline { call: Call; metric: MetricKey | null; reason: string }

export interface AdRead extends AdData {
  cell: string;
  metrics: Partial<Record<MetricKey, MetricRead>>;
  headline: Headline;
  cpq: { value: number | null; lo: number | null; hi: number | null; observed: number | null } | null;   // value: spend over estimated quotes; observed: spend / quotes
  cpc: number | null;
  cpe: number | null;
}

export interface Effect {
  label: string;           // feature id, or "format VID vs ST"
  kind: 'feature' | 'format';
  metric: MetricKey;
  persona: string | null;  // null = pooled across personas
  ratio: number | null;    // rate with / rate without
  lo: number | null;
  hi: number | null;
  ads_with: number;
  ads_without: number;
  strata: number;
  verdict: 'clear lift' | 'clear drag' | 'not clear yet' | 'not enough data';
  why?: string;
}

export interface CellSummary {
  cell: string;
  persona: string;
  platform: string;
  ads: number;
  live_ads: number;
  readable: Partial<Record<MetricKey, number>>;
  impressions: number;
  leader: Partial<Record<MetricKey, { stub: string; p_best: number; tied_with: string[] } | null>>;
}

export interface Read {
  config_version: number;
  interval: number;
  window: { from: string; to: string };
  metrics_available: Record<MetricKey, boolean>;
  cv: Partial<Record<MetricKey, { value: number; estimated: boolean; ads: number }>>;
  ads: AdRead[];
  cells: CellSummary[];
  features: Effect[];
  persona_features: Effect[];
  formats: Effect[];
  notes: string[];
}

const EVENTS: Record<MetricKey, keyof AdData> = { hook_rate: 'video_3s', link_ctr: 'link_clicks', quotes_per_1k: 'quotes' };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fieldOf = (a: AdData, f: string) => String((a as any)[f] ?? '');
export const cellOf = (a: AdData, cfg: WeeklyConfig) => cfg.model.cell_by.map(f => fieldOf(a, f)).filter(Boolean).join('_');

function eligible(a: AdData, m: MetricKey, cfg: WeeklyConfig): boolean {
  if (a.impressions <= 0) return false;
  if (cfg.metrics[m].video_only && !cfg.naming.video_formats.includes(a.format)) return false;
  if (m === 'quotes_per_1k' && a.has_quotes === false) return false;
  return true;
}

// Between-ad CV on the log scale, from ads with enough impressions, as residuals
// from the deepest pooling group that has at least two such ads.
export function estimateCv(ads: AdData[], m: MetricKey, cfg: WeeklyConfig): { value: number; estimated: boolean; ads: number } {
  const c = cfg.model.between_ad_cv;
  const ev = EVENTS[m];
  const rel = ads.filter(a => eligible(a, m, cfg) && a.impressions >= cfg.metrics[m].min_impressions);
  if (rel.length < c.min_ads_to_estimate) return { value: c.default, estimated: false, ads: rel.length };
  const y = (a: AdData) => Math.log(((a[ev] as number) + 0.5) / (a.impressions + 1));
  const levels = cfg.model.pool_by;
  let ss = 0, df = 0, noise = 0;
  const assigned = new Map<string, AdData[]>();
  for (const a of rel) {
    let L = levels.length;
    for (; L > 0; L--) {
      const k = levels.slice(0, L).map(f => fieldOf(a, f)).join('|');
      if (rel.filter(b => levels.slice(0, L).map(f => fieldOf(b, f)).join('|') === k).length >= 2) break;
    }
    const k = `${L}:${levels.slice(0, L).map(f => fieldOf(a, f)).join('|')}`;
    assigned.set(k, [...(assigned.get(k) || []), a]);
  }
  for (const g of assigned.values()) {
    const ys = g.map(y);
    const mu = ys.reduce((s, v) => s + v, 0) / ys.length;
    ss += ys.reduce((s, v) => s + (v - mu) ** 2, 0);
    df += g.length - 1;
    noise += g.reduce((s, a) => s + 1 / ((a[ev] as number) + 0.5), 0);
  }
  if (df < 2) return { value: c.default, estimated: false, ads: rel.length };
  const between = Math.max(0, ss / df - noise / rel.length);
  return { value: clamp(Math.sqrt(Math.exp(between) - 1), c.min, c.max), estimated: true, ads: rel.length };
}

// κ (prior strength in impressions) for a group mean m and between-ad CV.
const kappaFor = (m: number, cv: number) => Math.max(1, (1 - m) / (cv * cv * Math.max(m, 1e-9)) - 1);

export function groupMeans(ads: AdData[], m: MetricKey, cfg: WeeklyConfig, cv: number): Map<string, number> {
  const ev = EVENTS[m];
  const levels = cfg.model.pool_by;
  const tau = cfg.model.group_prior_ads;
  const X = ads.reduce((s, a) => s + (a[ev] as number), 0);
  const N = ads.reduce((s, a) => s + a.impressions, 0);
  const means = new Map<string, number>([['', N > 0 ? (X + 0.5) / (N + 1) : 0]]);
  for (let L = 1; L <= levels.length; L++) {
    const groups = new Map<string, AdData[]>();
    for (const a of ads) {
      const k = levels.slice(0, L).map(f => fieldOf(a, f)).join('|');
      groups.set(k, [...(groups.get(k) || []), a]);
    }
    for (const [k, g] of groups) {
      const parent = means.get(k.split('|').slice(0, L - 1).join('|'))!;
      const kap = kappaFor(parent, cv);
      const s = g.reduce((acc, a) => acc + ((a[ev] as number) + kap * parent) / (a.impressions + kap), 0);
      means.set(k, (s + tau * parent) / (g.length + tau));
    }
  }
  return means;
}

// opts.prev: last week's read of the same flight. Its calls are held while the
// evidence stays above the lower hold bars (config calls.hold).
export function readWeek(adsIn: AdData[], cfg: WeeklyConfig, opts: { from: string; to: string; quotesAvailable: boolean; prev?: Read | null }): Read {
  const prevCalls = new Map<string, Partial<Record<MetricKey, Call>>>();
  for (const a of opts.prev?.ads || []) prevCalls.set(a.key, Object.fromEntries(Object.entries(a.metrics).map(([k, r]) => [k, r!.call])));
  const iv = cfg.model.interval;
  const qLo = (1 - iv) / 2, qHi = 1 - qLo;
  const notes: string[] = [];
  const available: Record<MetricKey, boolean> = { hook_rate: true, link_ctr: true, quotes_per_1k: opts.quotesAvailable };
  if (!opts.quotesAvailable) notes.push('No quote column in the data: quotes per 1,000 impressions and cost per quote are left out, and calls fall back to link CTR (cut only).');
  const ads: AdRead[] = adsIn.map(a => ({ ...a, cell: cellOf(a, cfg), metrics: {}, headline: { call: 'too early to call', metric: null, reason: '' }, cpq: null, cpc: null, cpe: null }));
  const cvs: Read['cv'] = {};

  for (const m of METRIC_KEYS) {
    if (!available[m]) continue;
    const def = cfg.metrics[m];
    const ev = EVENTS[m];
    const el = ads.filter(a => eligible(a, m, cfg));
    if (!el.length) continue;
    const cv = estimateCv(el, m, cfg);
    cvs[m] = cv;
    const means = groupMeans(el, m, cfg, cv.value);
    const draws = cfg.model.mc_draws;
    const samples = new Map<string, Float64Array>();
    for (const a of el) {
      const gk = cfg.model.pool_by.map(f => fieldOf(a, f)).join('|');
      const pm = means.get(gk)!;
      const kap = kappaFor(pm, cv.value);
      const x = a[ev] as number;
      const al = x + kap * pm, be = Math.max(a.impressions - x, 0) + kap * (1 - pm);
      const r = rng(hashSeed(`${a.key}|${m}`, cfg.model.seed));
      const s = new Float64Array(draws);
      for (let d = 0; d < draws; d++) s[d] = beta(r, al, be);
      samples.set(a.key, s);
      const sorted = Float64Array.from(s).sort();
      const readable = a.impressions >= def.min_impressions && a.days_live >= cfg.calls.min_days_live && a.live_now;
      a.metrics[m] = {
        metric: m, n: a.impressions, x, rate_raw: x / a.impressions, rate: al / (al + be),
        lo: quantile(sorted, qLo), hi: quantile(sorted, qHi), prior_mean: pm, readable,
        p_best: null, p_worse_than_median: null, p_beat_median: null, p_ahead: {}, tied_with: [], call: 'too early to call', reason: '',
      };
    }

    // Comparisons inside each cell, among readable ads.
    const cells = new Map<string, AdRead[]>();
    for (const a of el) cells.set(a.cell, [...(cells.get(a.cell) || []), a]);
    for (const [, members] of cells) {
      const rd = members.filter(a => a.metrics[m]!.readable);
      if (rd.length >= 2) {
        const n = rd.length;
        const best = new Array(n).fill(0), below = new Array(n).fill(0), above = new Array(n).fill(0);
        const ahead = Array.from({ length: n }, () => new Array(n).fill(0));
        const col = rd.map(a => samples.get(a.key)!);
        const tmp = new Array(n);
        for (let d = 0; d < draws; d++) {
          let bi = 0;
          for (let i = 0; i < n; i++) { tmp[i] = col[i][d]; if (tmp[i] > tmp[bi]) bi = i; }
          best[bi]++;
          const med = quantile([...tmp].sort((p, q) => p - q), 0.5);
          for (let i = 0; i < n; i++) {
            if (tmp[i] < med) below[i]++; else if (tmp[i] > med) above[i]++;
            for (let j = 0; j < n; j++) if (tmp[i] > tmp[j]) ahead[i][j]++;
          }
        }
        rd.forEach((a, i) => {
          const r = a.metrics[m]!;
          r.p_best = best[i] / draws; r.p_worse_than_median = below[i] / draws; r.p_beat_median = above[i] / draws;
          r.p_ahead = Object.fromEntries(rd.map((b, j) => [b.key, ahead[i][j] / draws]).filter(([k]) => k !== a.key));
        });
      }
      decideCalls(members, m, cfg, prevCalls);
    }
  }

  for (const a of ads) {
    a.headline = headlineFor(a, cfg, available);
    a.cpc = a.link_clicks > 0 ? a.spend / a.link_clicks : null;
    a.cpe = a.enrollments > 0 ? a.spend / a.enrollments : null;
    const q = a.metrics.quotes_per_1k;
    if (q) a.cpq = { value: q.rate > 0 ? a.spend / (a.impressions * q.rate) : null, lo: q.hi > 0 ? a.spend / (a.impressions * q.hi) : null, hi: q.lo > 0 ? a.spend / (a.impressions * q.lo) : null, observed: a.quotes > 0 ? a.spend / a.quotes : null };
  }

  const read: Read = {
    config_version: cfg.version, interval: iv, window: { from: opts.from, to: opts.to }, metrics_available: available, cv: cvs, ads,
    cells: summariseCells(ads, cfg), features: [], persona_features: [], formats: [], notes,
  };
  const featureAds = adsIn.filter(a => a.features !== null);
  if (featureAds.length < adsIn.length) notes.push(`${adsIn.length - featureAds.length} of ${adsIn.length} ads have no feature record (no Studio shortlist or audit row for their stub); they're left out of feature effects.`);
  for (const m of METRIC_KEYS) {
    if (!available[m]) continue;
    const cv = cvs[m]?.value ?? cfg.model.between_ad_cv.default;
    const ref = m === 'hook_rate' ? 'VID' : 'ST';
    // Effects use only ads with enough impressions to read on this metric, the same
    // bar as a call, so a thin week says "not enough data" here too.
    const all = adsIn.filter(a => eligible(a, m, cfg));
    const el = all.filter(a => a.impressions >= cfg.metrics[m].min_impressions);
    const allKnown = all.filter(a => a.features !== null);
    const fmtTerms = (pool: AdData[]): Term[] => [...new Set(pool.map(a => a.format))].filter(f => f !== ref).sort()
      .map(f => ({ label: `${f} vs ${ref}`, kind: 'format' as const, has: (a: AdData) => a.format === f, cmp: (a: AdData) => a.format === ref }));
    const featTerms = (pool: AdData[]): Term[] => [...new Set(pool.flatMap(a => a.features || []))].sort()
      .map(f => ({ label: f, kind: 'feature' as const, has: (a: AdData) => a.features!.includes(f), cmp: (a: AdData) => !a.features!.includes(f) }));
    // Formats: every eligible ad, within persona × platform.
    read.formats.push(...jointEffects(el, fmtTerms(all), [], m, cv, cfg, null, cfg.features.min_ads_with));
    // Features: ads with a feature record, adjusted for format and for each other.
    const pool = el.filter(a => a.features !== null);
    read.features.push(...jointEffects(pool, featTerms(allKnown), fmtTerms(pool), m, cv, cfg, null, cfg.features.min_ads_with));
    for (const p of cfg.naming.personas) {
      const pp = pool.filter(a => a.persona === p);
      const ppAll = allKnown.filter(a => a.persona === p);
      if (ppAll.length) read.persona_features.push(...jointEffects(pp, featTerms(ppAll), fmtTerms(pp), m, cv, cfg, p, cfg.features.persona_min_ads_with));
    }
  }
  return read;
}

// Calls and ties come from the same draws. Two ads are tied when fewer than
// `tie_bar` (9 in 10) of the draws put one ahead of the other. A scale must be
// separated from every ad outside its scaled group; a cut must be separated from
// the ad set's leader (and so from any scaled ad). So an ad is never scaled or cut
// relative to an ad it's tied with, and the note's "tied" wording (tied_with, set
// here from the same bars) can't disagree with the calls. Held calls use the lower
// hold bars throughout. No scale or cut with fewer than min_ads_in_cell readable ads.
function decideCalls(members: AdRead[], m: MetricKey, cfg: WeeklyConfig, prevCalls: Map<string, Partial<Record<MetricKey, Call>>> = new Map()) {
  const c = cfg.calls, h = c.hold;
  const def = cfg.metrics[m];
  const R = (a: AdRead) => a.metrics[m]!;
  const rd = members.filter(a => R(a).readable);
  const enough = rd.length >= c.min_ads_in_cell;
  const was = (a: AdRead) => prevCalls.get(a.key)?.[m];
  const wasScale = (a: AdRead) => was(a) === 'scale' || was(a) === 'scale (tied)';
  const P = (x: AdRead, y: AdRead) => R(x).p_ahead[y.key] ?? 0;
  const clearOf = (x: AdRead, others: AdRead[], bar: number) => others.every(y => y === x || P(x, y) >= bar);
  const pct = (p: number | null) => `${Math.round((p ?? 0) * 100)}%`;
  const byBest = [...rd].sort((p, q) => (R(q).p_best ?? 0) - (R(p).p_best ?? 0));

  // The scaled group: fresh single, fresh tied pair, held single, held tied pair (in that order).
  let group: AdRead[] = [];
  let kind: 'single' | 'tied' | 'held' | 'held tied' | null = null;
  if (enough) {
    const single = byBest.find(x => (R(x).p_best ?? 0) >= c.p_best_scale && clearOf(x, rd, c.tie_bar));
    if (single) { group = [single]; kind = 'single'; }
    // Tied group: the leader and the ads it's tied with (same bar), if that group is small,
    // together likely best, and every member is clearly ahead of every ad outside it.
    const tiedGroup = (bar: number, pBeat: number, pSum: number, eligible: (a: AdRead) => boolean): AdRead[] | null => {
      const lead = byBest[0];
      if (!lead) return null;
      const g = [lead, ...rd.filter(y => y !== lead && P(lead, y) < bar)];
      const outside = rd.filter(a => !g.includes(a));
      const sum = g.reduce((t, a) => t + (R(a).p_best ?? 0), 0);
      return g.length >= 2 && g.length <= c.max_tied_scale && sum >= pSum && outside.length > 0
        && g.every(a => eligible(a) && (R(a).p_beat_median ?? 0) >= pBeat && clearOf(a, outside, bar)) ? g : null;
    };
    if (!kind) { const g = tiedGroup(c.tie_bar, c.p_beat_median_tied_scale, c.p_best_scale, () => true); if (g) { group = g; kind = 'tied'; } }
    if (!kind) {
      const x = byBest.find(a => was(a) === 'scale' && (R(a).p_best ?? 0) >= h.p_best_scale && clearOf(a, rd, h.tie_bar));
      if (x) { group = [x]; kind = 'held'; }
    }
    if (!kind) { const g = tiedGroup(h.tie_bar, h.p_beat_median_tied_scale, h.p_best_scale, wasScale); if (g) { group = g; kind = 'held tied'; } }
  }
  const leader = group[0] ?? byBest[0];
  const held = kind === 'held' || kind === 'held tied';

  const cutOk = (a: AdRead): 'fresh' | 'held' | null => {
    if (!enough || group.includes(a) || a === leader) return null;
    const r = R(a);
    if ((r.p_worse_than_median ?? 0) >= c.p_worse_than_median_cut && P(leader, a) >= (held ? h.tie_bar : c.tie_bar)) return 'fresh';
    if (was(a) === 'cut' && (r.p_worse_than_median ?? 0) >= h.p_worse_than_median_cut && P(leader, a) >= h.tie_bar) return 'held';
    return null;
  };

  for (const a of members) {
    const r = R(a);
    if (!a.live_now) { r.call = 'too early to call'; r.reason = 'not delivering in the last 7 days'; continue; }
    if (a.impressions < def.min_impressions) { r.call = 'too early to call'; r.reason = `${a.impressions.toLocaleString('en-US')} impressions; needs ${def.min_impressions.toLocaleString('en-US')}`; continue; }
    if (a.days_live < c.min_days_live) { r.call = 'too early to call'; r.reason = `live ${a.days_live} day${a.days_live === 1 ? '' : 's'}; needs ${c.min_days_live}`; continue; }
    if (!enough) { r.call = 'keep testing'; r.reason = `only ${rd.length} ad${rd.length === 1 ? '' : 's'} with enough data in this ad set; a scale or cut needs ${c.min_ads_in_cell}`; continue; }
    if (group.includes(a)) {
      const others = group.filter(b => b !== a).map(b => b.stub).join(', ');
      if (kind === 'single') { r.call = 'scale'; r.reason = `P(best in ad set) ${pct(r.p_best)}, ahead of every other ad in at least ${Math.round(c.tie_bar * 10)} in 10 draws`; }
      else if (kind === 'held') { r.call = 'scale'; r.reason = `held from last week: P(best in ad set) ${pct(r.p_best)} (keeps a scale at ${pct(h.p_best_scale)} or more), still ahead of every other ad in at least ${Math.round(h.tie_bar * 10)} in 10 draws`; }
      else if (kind === 'tied') { r.call = 'scale (tied)'; r.reason = `tied with ${others}; together P(best) ${pct(group.reduce((t, b) => t + (R(b).p_best ?? 0), 0))}, both ahead of every other ad in at least ${Math.round(c.tie_bar * 10)} in 10 draws`; }
      else { r.call = 'scale (tied)'; r.reason = `held from last week: tied with ${others}, both still ahead of every other ad in at least ${Math.round(h.tie_bar * 10)} in 10 draws`; }
      continue;
    }
    const cut = cutOk(a);
    if (cut === 'fresh') { r.call = 'cut'; r.reason = `P(worse than the ad set's median) ${pct(r.p_worse_than_median)}, behind ${leader.stub} in ${Math.round(P(leader, a) * 100)} of 100 draws`; continue; }
    if (cut === 'held') { r.call = 'cut'; r.reason = `held from last week: P(worse than the ad set's median) ${pct(r.p_worse_than_median)} (keeps a cut at ${pct(h.p_worse_than_median_cut)} or more)`; continue; }
    r.call = 'keep testing'; r.reason = `P(best) ${pct(r.p_best)}, P(worse than median) ${pct(r.p_worse_than_median)}: neither bar reached`;
  }

  // Ties for display, from the same bars the calls used: the leader against every
  // other readable ad; members of a tied scale are tied with each other.
  for (const a of rd) R(a).tied_with = [];
  if (rd.length >= 2) {
    const bar = (y: AdRead) => (held || R(y).call === 'cut' && R(y).reason.startsWith('held') ? h.tie_bar : c.tie_bar);
    const tied = rd.filter(y => y !== leader && (group.includes(y) || P(leader, y) < bar(y)));
    R(leader).tied_with = tied.map(y => y.stub);
    for (const y of tied) R(y).tied_with = [leader.stub];
  }
}

function headlineFor(a: AdRead, cfg: WeeklyConfig, available: Record<MetricKey, boolean>): Headline {
  const c = cfg.calls;
  const lab = (m: MetricKey) => cfg.metrics[m].label;
  const prim = available[c.primary_metric] ? a.metrics[c.primary_metric] : undefined;
  if (prim && prim.call !== 'too early to call') return { call: prim.call, metric: c.primary_metric, reason: `${lab(c.primary_metric)}: ${prim.reason}` };
  const why = prim ? `${lab(c.primary_metric)} too early (${prim.reason})` : `no ${lab(c.primary_metric)} data`;
  const fb = c.fallback_metric ? a.metrics[c.fallback_metric] : undefined;
  if (fb && c.fallback_metric && fb.call !== 'too early to call') {
    const fl = lab(c.fallback_metric);
    if (fb.call === 'cut') return c.fallback_can_cut ? { call: 'cut', metric: c.fallback_metric, reason: `${fl}: ${fb.reason}; ${why}` } : { call: 'keep testing', metric: c.fallback_metric, reason: `behind on ${fl}, but cuts wait for ${lab(c.primary_metric)}; ${why}` };
    if (fb.call === 'scale' || fb.call === 'scale (tied)') return c.fallback_can_scale ? { call: fb.call, metric: c.fallback_metric, reason: `${fl}: ${fb.reason}; ${why}` } : { call: 'keep testing', metric: c.fallback_metric, reason: `ahead on ${fl} (${fb.reason}), but scaling waits for ${lab(c.primary_metric)}; ${why}` };
    return { call: 'keep testing', metric: c.fallback_metric, reason: `${fl}: ${fb.reason}; ${why}` };
  }
  return { call: 'too early to call', metric: null, reason: fb ? `${why}; ${lab(c.fallback_metric!)} too early (${fb.reason})` : why };
}

function summariseCells(ads: AdRead[], cfg: WeeklyConfig): CellSummary[] {
  const by = new Map<string, AdRead[]>();
  for (const a of ads) by.set(a.cell, [...(by.get(a.cell) || []), a]);
  return [...by.entries()].sort(([p], [q]) => p.localeCompare(q)).map(([cell, g]) => {
    const readable: CellSummary['readable'] = {}, leader: CellSummary['leader'] = {};
    for (const m of METRIC_KEYS) {
      const rd = g.filter(a => a.metrics[m]?.readable);
      readable[m] = rd.length;
      const top = rd.filter(a => a.metrics[m]!.p_best !== null).sort((p, q) => q.metrics[m]!.p_best! - p.metrics[m]!.p_best!)[0];
      leader[m] = top ? { stub: top.stub, p_best: top.metrics[m]!.p_best!, tied_with: top.metrics[m]!.tied_with } : null;
    }
    return { cell, persona: g[0].persona, platform: g[0].platform, ads: g.length, live_ads: g.filter(a => a.live_now).length, readable, impressions: g.reduce((s, a) => s + a.impressions, 0), leader };
  });
}

interface Term { label: string; kind: Effect['kind']; has: (a: AdData) => boolean; cmp: (a: AdData) => boolean }

// Joint weighted least squares on the log-rate scale:
//   log rate_i = stratum (persona × platform) + format + features + ad-level noise,
// weight 1 / (Poisson variance of the log rate + between-ad variance). Only
// within-stratum differences inform a term. A term needs `minWith` ads with it and
// `min_ads_without` comparison ads inside strata that have both; otherwise it's
// "not enough data". `terms` are reported; `adjust` terms (formats, in the feature
// model) are fitted but not reported. "Clear" needs the range to exclude no effect
// after allowing for the number of terms reported together (Bonferroni), so a
// weekly note checking a dozen features doesn't find one by chance every week;
// the range shown is still the plain 90% one.
export function jointEffects(ads: AdData[], terms: Term[], adjust: Term[], m: MetricKey, cv: number, cfg: WeeklyConfig, persona: string | null, minWith: number): Effect[] {
  const ev = EVENTS[m];
  const tau2 = Math.log(1 + cv * cv);
  const strataFields = cfg.features.strata;
  const skey = (a: AdData) => strataFields.map(f => fieldOf(a, f)).join('|');
  const strata = [...new Set(ads.map(skey))];
  const counts = (t: Term) => {
    let nA = 0, nB = 0, used = 0;
    for (const s of strata) {
      const g = ads.filter(a => skey(a) === s);
      const A = g.filter(t.has).length, B = g.filter(a => !t.has(a) && t.cmp(a)).length;
      if (A && B) { nA += A; nB += B; used++; }
    }
    return { nA, nB, used };
  };
  const out: Effect[] = [];
  const passing: Array<{ t: Term; c: ReturnType<typeof counts> }> = [];
  for (const t of terms) {
    const c = counts(t);
    const base = { label: t.label, kind: t.kind, metric: m, persona, ads_with: c.nA, ads_without: c.nB, strata: c.used };
    if (!c.used || c.nA < minWith || c.nB < cfg.features.min_ads_without)
      out.push({ ...base, ratio: null, lo: null, hi: null, verdict: 'not enough data', why: !ads.some(t.has) ? 'no ad with it has enough impressions yet' : !c.used ? 'never appears alongside a comparison ad in the same persona and platform' : `${c.nA} ads with, ${c.nB} to compare (needs ${minWith} and ${cfg.features.min_ads_without})` });
    else passing.push({ t, c });
  }
  if (!passing.length) return out;
  const adj = adjust.filter(t => ads.some(t.has));
  const cols: Array<(a: AdData) => number> = [...strata.map(s => (a: AdData) => (skey(a) === s ? 1 : 0)), ...adj.map(t => (a: AdData) => (t.has(a) ? 1 : 0)), ...passing.map(({ t }) => (a: AdData) => (t.has(a) ? 1 : 0))];
  const P = cols.length, off = strata.length + adj.length;
  const A = Array.from({ length: P }, () => new Array(P).fill(0));
  const bv = new Array(P).fill(0);
  for (const a of ads) {
    const x = a[ev] as number;
    const y = Math.log((x + 0.5) / (a.impressions + 1));
    const w = 1 / (1 / (x + 0.5) + tau2);
    const row = cols.map(f => f(a));
    for (let i = 0; i < P; i++) {
      if (!row[i]) continue;
      bv[i] += w * row[i] * y;
      for (let j = 0; j < P; j++) A[i][j] += w * row[i] * row[j];
    }
  }
  // A tiny ridge on the non-stratum terms keeps an unidentifiable term from breaking
  // the solve; such a term shows up as a huge standard error and is reported as such.
  for (let i = strata.length; i < P; i++) A[i][i] += 1e-6;
  const inv = invert(A);
  const beta = inv ? inv.map(r => r.reduce((s, v, j) => s + v * bv[j], 0)) : null;
  // Check the fit against its own residuals: if ads scatter more than the between-ad
  // spread allows (one standout ad, say), widen every range by that factor. With too
  // few spare ads to check, don't report.
  const df = ads.length - P;
  let phi = 1;
  if (beta) {
    let Q = 0;
    for (const a of ads) {
      const x = a[ev] as number;
      const y = Math.log((x + 0.5) / (a.impressions + 1));
      const fit = cols.reduce((s, f, j) => s + f(a) * beta[j], 0);
      Q += (y - fit) ** 2 / (1 / (x + 0.5) + tau2);
    }
    if (df > 0) phi = Math.max(1, Q / df);
  }
  if (df < cfg.features.min_residual_df) {
    for (const { t, c } of passing) out.push({ label: t.label, kind: t.kind, metric: m, persona, ads_with: c.nA, ads_without: c.nB, strata: c.used, ratio: null, lo: null, hi: null, verdict: 'not enough data',
      why: `${ads.length} ads for ${passing.length} ${t.kind}s${adj.length ? ` plus ${adj.length} format${adj.length === 1 ? '' : 's'}` : ''}: too few to check the fit` });
    return out.sort((p, q) => p.label.localeCompare(q.label));
  }
  const z = zQuantile(1 - (1 - cfg.model.interval) / 2);
  const zAdj = zQuantile(1 - (1 - cfg.model.interval) / (2 * passing.length));
  passing.forEach(({ t, c }, k) => {
    const base = { label: t.label, kind: t.kind, metric: m, persona, ads_with: c.nA, ads_without: c.nB, strata: c.used };
    const i = off + k;
    const se = inv ? Math.sqrt(Math.max(inv[i][i], 0) * phi) : Infinity;
    if (!beta || !(se < 1)) {
      out.push({ ...base, ratio: null, lo: null, hi: null, verdict: 'not enough data', why: 'can\'t be separated from the formats or other features it always appears with' });
      return;
    }
    const d = beta[i];
    const clear = Math.abs(d) > zAdj * se;
    const plainClear = Math.abs(d) > z * se;
    out.push({ ...base, ratio: Math.exp(d), lo: Math.exp(d - z * se), hi: Math.exp(d + z * se),
      verdict: clear ? (d > 0 ? 'clear lift' : 'clear drag') : 'not clear yet',
      why: !clear && plainClear ? `the 90% range leaves out no effect, but not by enough with ${passing.length} ${t.kind}s checked together` : undefined });
  });
  return out.sort((p, q) => p.label.localeCompare(q.label));
}

// Gauss–Jordan with partial pivoting. Returns null if singular.
function invert(M: number[][]): number[][] | null {
  const n = M.length;
  const a = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c || !a[r][c]) continue;
      const f = a[r][c];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map(r => r.slice(n));
}
