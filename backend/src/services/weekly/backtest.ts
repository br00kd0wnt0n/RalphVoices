// Back-test (the v2 plan's decision gate), as pre-registered in
// docs/build-log/backtest-preregistration.md (committed 054b633 before any
// tagging). Pure: ads, copy features and the fit/test split in; effects with
// ranges and verdicts out.
//
// 1. Ad level: WLS of each ad's log rate on the controls (region, format, wave,
//    placement mix), weight 1 / (binomial variance + between-ad variance).
// 2. Copy effect: the weighted mean of its ads' residuals. Copies are the units.
// 3. Features: WLS of copy effects on the features that at least 3 copies have and
//    3 lack, weight 1 / (copy variance + between-copy variance); one model per
//    feature if the joint model would leave fewer than 4 residual df; ranges widened
//    by the residual spread when it exceeds 1; "clear" after a Bonferroni allowance
//    across the features tested for that outcome.
// 4. Hold-out: the sign among test copies (mean effect with minus without).
import crypto from 'node:crypto';
import { zQuantile } from './stats.js';

export interface BtAd {
  key: string;
  copy: string;                 // copy id
  region: string;
  format: string;
  wave: string;
  placement_share: number;      // share of impressions in Reels and Stories placements
  impressions: number;
  events: number | null;        // null = not measured for this ad (outcome not available)
}

export interface BtEffect {
  term: string;
  ratio: number | null; lo: number | null; hi: number | null;
  copies_with: number; copies_without: number;
  model: 'joint' | 'single' | 'none';
  clear: boolean;
  test_sign: 1 | -1 | 0 | null;  // null = not testable
  test_with: number; test_without: number;
  verdict: 'supported' | 'not supported' | 'not enough data';
  why: string;
}

export interface BtResult {
  outcome: string;
  ads: number; copies: number; fit_copies: number; test_copies: number;
  tau2_ad: number; tau2_copy: number; phi: number; residual_df: number;
  features_tested: number;
  controls: Array<{ term: string; ratio: number; lo: number; hi: number }>;
  effects: BtEffect[];
  copy_effects: Array<{ copy: string; effect: number; se: number; ads: number; set: 'fit' | 'test' }>;
}

export const normalizeCopy = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/^[\s"'“”.,!?;:–—-]+|[\s"'“”.,!?;:–—-]+$/g, '');
export const copyHash = (normalized: string) => crypto.createHash('sha256').update(normalized).digest('hex');

// Pre-registered split: sort by SHA-256 of the normalised copy; the first two-thirds (rounded up) fit.
export function splitCopies(copies: Array<{ id: string; normalized: string }>): { fit: Set<string>; test: Set<string> } {
  const sorted = [...copies].sort((a, b) => copyHash(a.normalized).localeCompare(copyHash(b.normalized)));
  const k = Math.ceil((2 * sorted.length) / 3);
  return { fit: new Set(sorted.slice(0, k).map(c => c.id)), test: new Set(sorted.slice(k).map(c => c.id)) };
}

// ---------- small linear algebra ----------

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
    for (let r = 0; r < n; r++) { if (r === c || !a[r][c]) continue; const f = a[r][c]; for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j]; }
  }
  return a.map(r => r.slice(n));
}

interface Wls { beta: number[]; cov: number[][]; resid: number[]; Q: number; df: number }
// Weighted least squares with a tiny ridge on non-intercept terms (column 0 is the intercept).
export function wls(X: number[][], y: number[], w: number[], ridgeFrom = 1): Wls | null {
  const n = X.length, p = X[0]?.length ?? 0;
  if (!n || !p) return null;
  const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) { if (!X[i][j]) continue; b[j] += w[i] * X[i][j] * y[i]; for (let k = 0; k < p; k++) A[j][k] += w[i] * X[i][j] * X[i][k]; }
  for (let j = ridgeFrom; j < p; j++) A[j][j] += 1e-8;
  const cov = invert(A);
  if (!cov) return null;
  const beta = cov.map(r => r.reduce((s, v, j) => s + v * b[j], 0));
  const resid = X.map((r, i) => y[i] - r.reduce((s, v, j) => s + v * beta[j], 0));
  const Q = resid.reduce((s, r, i) => s + w[i] * r * r, 0);
  return { beta, cov, resid, Q, df: n - p };
}

// DerSimonian–Laird between-unit variance for a meta-regression: from the
// fixed-effect fit (weights 1/v), τ² = (Q − df) / (Σw − tr((X'WX)⁻¹ X'W²X)).
export function tau2DL(X: number[][], y: number[], v: number[], floor = 0): number {
  const w = v.map(x => 1 / x);
  const m = wls(X, y, w);
  if (!m || m.df <= 0) return floor;
  const p = X[0].length;
  let tr = 0;
  for (let i = 0; i < X.length; i++) {
    let q = 0;
    for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) q += X[i][j] * m.cov[j][k] * X[i][k];
    tr += w[i] * w[i] * q;
  }
  const denom = w.reduce((s, x) => s + x, 0) - tr;
  return Math.max(floor, denom > 0 ? (m.Q - m.df) / denom : floor);
}

const dummies = (vals: string[]) => { const levels = [...new Set(vals)].sort(); return { ref: levels[0], rest: levels.slice(1) }; };

export function runBacktest(outcome: string, adsIn: BtAd[], features: Record<string, string[]>, featureIds: string[], split: { fit: Set<string>; test: Set<string> },
  opts: { interval?: number; minWith?: number; minWithout?: number; minResidualDf?: number; cvFloor?: number } = {}): BtResult {
  const iv = opts.interval ?? 0.9, minWith = opts.minWith ?? 3, minWithout = opts.minWithout ?? 3, minDf = opts.minResidualDf ?? 4;
  const floor = Math.log(1 + (opts.cvFloor ?? 0.05) ** 2);
  const z = zQuantile(1 - (1 - iv) / 2);
  const ads = adsIn.filter(a => a.events !== null && a.impressions > 0 && features[a.copy] !== undefined);

  // 1. Ad-level controls, estimated within copies (a fixed effect per copy), so the
  //    between-ad variance is the spread among ads carrying the same copy and the
  //    controls are read from ads that differ only in region, format, wave or placements.
  const copyIds = [...new Set(ads.map(a => a.copy))].sort();
  const reg = dummies(ads.map(a => a.region)), fmt = dummies(ads.map(a => a.format)), wav = dummies(ads.map(a => a.wave));
  const ctl: Array<{ term: string; f: (a: BtAd) => number }> = [
    ...reg.rest.map(r => ({ term: `region ${r} vs ${reg.ref}`, f: (a: BtAd) => (a.region === r ? 1 : 0) })),
    ...fmt.rest.map(r => ({ term: `format ${r} vs ${fmt.ref}`, f: (a: BtAd) => (a.format === r ? 1 : 0) })),
    ...wav.rest.map(r => ({ term: `wave ${r} vs ${wav.ref}`, f: (a: BtAd) => (a.wave === r ? 1 : 0) })),
    { term: 'placement share (Reels + Stories), per +10 points', f: (a: BtAd) => a.placement_share * 10 },
  ].filter(c => new Set(ads.map(c.f)).size > 1);
  const X = ads.map(a => [...copyIds.map(c => (a.copy === c ? 1 : 0)), ...ctl.map(c => c.f(a))]);
  const y = ads.map(a => Math.log(((a.events as number) + 0.5) / (a.impressions + 1)));
  const vb = ads.map(a => 1 / ((a.events as number) + 0.5));
  let tau2Ad = floor, fit1: Wls | null = null;
  for (let it = 0; it < 6; it++) {
    fit1 = wls(X, y, vb.map(v => 1 / (v + tau2Ad)), copyIds.length);
    if (!fit1) break;
    const next = Math.max(floor, fit1.df > 0 ? (fit1.resid.reduce((s, r) => s + r * r, 0) - fit1.resid.reduce((s, _, i) => s + vb[i], 0) * fit1.df / ads.length) / fit1.df : floor);
    if (Math.abs(next - tau2Ad) < 1e-6) { tau2Ad = next; break; }
    tau2Ad = next;
  }
  if (fit1) fit1 = wls(X, y, vb.map(v => 1 / (v + tau2Ad)), copyIds.length);
  const empty = (why: string): BtResult => ({ outcome, ads: ads.length, copies: 0, fit_copies: 0, test_copies: 0, tau2_ad: tau2Ad, tau2_copy: 0, phi: 1, residual_df: 0, features_tested: 0, controls: [], effects: featureIds.map(t => ({ term: t, ratio: null, lo: null, hi: null, copies_with: 0, copies_without: 0, model: 'none', clear: false, test_sign: null, test_with: 0, test_without: 0, verdict: 'not enough data', why })), copy_effects: [] });
  if (!fit1) return empty('the control model could not be fitted');
  const K0 = copyIds.length;
  const phi1 = Math.max(1, fit1.Q / Math.max(1, fit1.df));
  const controls = ctl.map((c, k) => { const b = fit1!.beta[K0 + k], se = Math.sqrt(fit1!.cov[K0 + k][K0 + k] * phi1); return { term: c.term, ratio: Math.exp(b), lo: Math.exp(b - z * se), hi: Math.exp(b + z * se) }; });

  // 2. Copy effects: each copy's fixed effect, i.e. the weighted mean of its ads' log rates after the controls.
  const nAds = new Map<string, number>();
  for (const a of ads) nAds.set(a.copy, (nAds.get(a.copy) || 0) + 1);
  const copyEffects = copyIds.map((copy, k) => ({ copy, effect: fit1!.beta[k], se: Math.sqrt(fit1!.cov[k][k] * phi1), ads: nAds.get(copy) || 0, set: (split.fit.has(copy) ? 'fit' : 'test') as 'fit' | 'test' }))
    .filter(c => split.fit.has(c.copy) || split.test.has(c.copy));
  const fitC = copyEffects.filter(c => c.set === 'fit'), testC = copyEffects.filter(c => c.set === 'test');
  const has = (copy: string, f: string) => (features[copy] || []).includes(f);

  // 3. Features on the fit set.
  const counts = featureIds.map(f => ({ f, w: fitC.filter(c => has(c.copy, f)).length, wo: fitC.filter(c => !has(c.copy, f)).length }));
  const passing = counts.filter(c => c.w >= minWith && c.wo >= minWithout).map(c => c.f);
  const yC = fitC.map(c => c.effect), vC = fitC.map(c => c.se * c.se);
  const fitFeatures = (terms: string[]) => {
    const Xc = fitC.map(c => [1, ...terms.map(t => (has(c.copy, t) ? 1 : 0))]);
    const t2 = tau2DL(Xc, yC, vC, 0);
    const m = wls(Xc, yC, vC.map(v => 1 / (v + t2)));
    return m ? { m, t2, phi: m.df > 0 ? Math.max(1, m.Q / m.df) : Infinity } : null;
  };
  const K = passing.length;
  const zAdj = zQuantile(1 - (1 - iv) / (2 * Math.max(1, K)));
  const est = new Map<string, { b: number; se: number; model: 'joint' | 'single' }>();
  let tau2Copy = 0, phi = 1, residualDf = 0;
  const joint = K && fitC.length - (K + 1) >= minDf ? fitFeatures(passing) : null;
  if (joint) {
    tau2Copy = joint.t2; phi = joint.phi; residualDf = joint.m.df;
    passing.forEach((t, k) => est.set(t, { b: joint.m.beta[k + 1], se: Math.sqrt(joint.m.cov[k + 1][k + 1] * joint.phi), model: 'joint' }));
  } else {
    for (const t of passing) {
      const s = fitFeatures([t]);
      if (!s || s.m.df < 1) continue;
      est.set(t, { b: s.m.beta[1], se: Math.sqrt(s.m.cov[1][1] * s.phi), model: 'single' });
      tau2Copy = Math.max(tau2Copy, s.t2); residualDf = s.m.df;
    }
  }

  // 4. Hold-out sign and verdicts.
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const effects: BtEffect[] = featureIds.map(f => {
    const c = counts.find(x => x.f === f)!;
    const tw = testC.filter(x => has(x.copy, f)), two = testC.filter(x => !has(x.copy, f));
    const testSign: BtEffect['test_sign'] = tw.length && two.length ? (Math.sign(mean(tw.map(x => x.effect)) - mean(two.map(x => x.effect))) as 1 | -1 | 0) : null;
    const base = { term: f, copies_with: c.w, copies_without: c.wo, test_sign: testSign, test_with: tw.length, test_without: two.length };
    const e = est.get(f);
    if (!e) return { ...base, ratio: null, lo: null, hi: null, model: 'none' as const, clear: false, verdict: 'not enough data' as const, why: passing.includes(f) ? 'model could not be fitted' : `${c.w} fit copies with it, ${c.wo} without (needs ${minWith} and ${minWithout})` };
    const clear = Math.abs(e.b) > zAdj * e.se;
    const r = { ...base, ratio: Math.exp(e.b), lo: Math.exp(e.b - z * e.se), hi: Math.exp(e.b + z * e.se), model: e.model, clear };
    if (!clear) return { ...r, verdict: 'not supported' as const, why: `not clear in the fit set after allowing for ${K} feature${K === 1 ? '' : 's'}` };
    if (testSign === null) return { ...r, verdict: 'not enough data' as const, why: `clear in the fit set but not testable: ${tw.length} test copies with it, ${two.length} without` };
    return testSign === Math.sign(e.b) ? { ...r, verdict: 'supported' as const, why: 'clear in the fit set, same sign in the test set' } : { ...r, verdict: 'not supported' as const, why: 'clear in the fit set, opposite sign in the test set' };
  });
  return { outcome, ads: ads.length, copies: copyEffects.length, fit_copies: fitC.length, test_copies: testC.length, tau2_ad: tau2Ad, tau2_copy: tau2Copy, phi, residual_df: residualDf, features_tested: K, controls, effects, copy_effects: copyEffects };
}
