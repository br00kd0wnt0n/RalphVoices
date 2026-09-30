// B3: synthetic ad platform exports with known true effects, so the model can
// be checked against answers we planted. Volumes follow the Month-1 plan
// (per persona: 2 statics, 1 hero video, 1 carousel; 1 UGC; 2 TikTok builds;
// 2-3 copy lines per asset as separate ads) and the rates in Add3's May 2026
// report (Meta link CTR around 1.1-1.7%, cost per quote $5-15).
// Territory codes and feature ids here are made up for the simulation.
import { toCsv } from './csv.js';
import { rng, normal, binomial } from './stats.js';
import type { Read, Effect, MetricKey } from './model.js';
import { addDays } from './window.js';

export type Scenario = 'month1' | 'thin' | 'null';

export interface SimAd {
  stub: string; ad_name: string; persona: string; territory: string; format: string; platform: 'META' | 'TT';
  features: string[]; ctr: number; quote_per_click: number; hook: number; daily_impressions: number;
  audience: 'prospecting' | 'retargeting'; campaign: string; ad_set: string;
}

export interface Truth {
  scenario: Scenario; seed: number; start: string; days: number;
  features: Record<string, { link_ctr: number; quotes_per_1k: number; hook_rate: number; size: 'large' | 'small' | 'none' }>;
  persona_features: Array<{ persona: string; feature: string; link_ctr: number; size: 'large' }>;
  formats: Record<string, { link_ctr: number; size: 'large' | 'small' | 'none' }>;
  standout: { stub: string; quotes_per_1k: number } | null;
  ads: Array<Pick<SimAd, 'stub' | 'ad_name' | 'persona' | 'format' | 'platform' | 'features' | 'ctr' | 'quote_per_click' | 'hook' | 'audience'> & { quotes_per_1k: number }>;
  planted_bad_names: Array<{ ad_name: string; why: string }>;
  cosmetic_names: Array<{ ad_name: string; stub: string }>;
}

export interface SimOutput { meta_csv: string; tiktok_csv: string; features_csv: string; truth: Truth }

const PERSONAS = ['DINK', 'CUR', 'FAM'];
const TERR: Record<string, [string, string]> = { DINK: ['SIMA', 'SIMB'], CUR: ['SIMC', 'SIMD'], FAM: ['SIME', 'SIMF'] };
const FEATURES = ['member_testimony', 'dollar_figure', 'humour', 'vet_authority', 'less_hassle', 'start_early'];
const BASE: Record<string, { ctr: number; qpc: number }> = { DINK: { ctr: 0.013, qpc: 0.045 }, CUR: { ctr: 0.011, qpc: 0.05 }, FAM: { ctr: 0.016, qpc: 0.04 } };
const HOOK_BASE: Record<string, number> = { VID: 0.25, UGC: 0.33, TT: 0.3 };

export function simulate(scenario: Scenario, seed = 42, start = '2026-10-12'): SimOutput {
  const r = rng(seed);
  const on = scenario !== 'null';
  const days = scenario === 'thin' ? 7 : 28;
  const perDay = scenario === 'thin' ? 500 : 4000;
  const ADNOISE = on ? 0.12 : 0;

  const features: Truth['features'] = {
    member_testimony: { link_ctr: 1, quotes_per_1k: on ? 1.5 : 1, hook_rate: 1, size: on ? 'large' : 'none' },
    dollar_figure: { link_ctr: on ? 1.35 : 1, quotes_per_1k: on ? 1.35 : 1, hook_rate: 1, size: on ? 'large' : 'none' },
    humour: { link_ctr: on ? 1.05 : 1, quotes_per_1k: on ? 1.05 : 1, hook_rate: on ? 1.25 : 1, size: on ? 'small' : 'none' },
    vet_authority: { link_ctr: 1, quotes_per_1k: on ? 1.08 : 1, hook_rate: 1, size: on ? 'small' : 'none' },
    less_hassle: { link_ctr: 1, quotes_per_1k: 1, hook_rate: 1, size: 'none' },
    start_early: { link_ctr: 1, quotes_per_1k: 1, hook_rate: 1, size: 'none' },
  };
  // start_early lifts CTR for Families only (a persona × feature effect); pooled it's diluted.
  const persona_features: Truth['persona_features'] = on ? [{ persona: 'FAM', feature: 'start_early', link_ctr: 1.5, size: 'large' }] : [];
  const formats: Truth['formats'] = {
    ST: { link_ctr: 1, size: 'none' }, VID: { link_ctr: on ? 1.3 : 1, size: on ? 'large' : 'none' }, UGC: { link_ctr: on ? 1.8 : 1, size: on ? 'large' : 'none' },
    CAR: { link_ctr: on ? 0.92 : 1, size: on ? 'small' : 'none' }, TT: { link_ctr: on ? 1.2 : 1, size: on ? 'small' : 'none' },
  };

  const ads: SimAd[] = [];
  const add = (persona: string, territory: string, format: string, platform: 'META' | 'TT', lines: number, delivered: string) => {
    for (let v = 1; v <= lines; v++) {
      const feats = FEATURES.filter(() => r() < 0.35).sort();
      const stub = `${persona}_${territory}_${format}_v${v}_${platform}`;
      let ctr = BASE[persona].ctr * formats[format].link_ctr, qpc = BASE[persona].qpc, hook = HOOK_BASE[format] ?? 0;
      for (const f of feats) {
        ctr *= features[f].link_ctr;
        qpc *= features[f].quotes_per_1k / features[f].link_ctr;
        hook *= features[f].hook_rate;
        const pf = persona_features.find(p => p.persona === persona && p.feature === f);
        if (pf) ctr *= pf.link_ctr;
      }
      ctr *= Math.exp(ADNOISE * normal(r) - ADNOISE * ADNOISE / 2);
      qpc *= Math.exp(ADNOISE * normal(r) - ADNOISE * ADNOISE / 2);
      if (hook) hook = Math.min(0.9, hook * Math.exp(ADNOISE * normal(r)));
      const campaign = platform === 'META' ? 'Trupanion_Ralph_Prospecting_META' : 'Trupanion Ralph Prospecting TT';
      ads.push({ stub, ad_name: `${stub}_${delivered}`, persona, territory, format, platform, features: feats, ctr, quote_per_click: qpc, hook,
        daily_impressions: perDay * Math.exp(0.3 * normal(r)), audience: 'prospecting', campaign, ad_set: `${persona}_${platform}_Prospecting` });
    }
  };
  const d = start.slice(2).replace(/-/g, '');
  for (const p of PERSONAS) {
    const [t1, t2] = TERR[p];
    add(p, t1, 'ST', 'META', 3, d);
    add(p, t2, 'ST', 'META', 3, d);
    add(p, t1, 'VID', 'META', 2, d);
    add(p, t2, 'CAR', 'META', 2, d);
  }
  add('CUR', TERR.CUR[1], 'UGC', 'META', 2, d);
  add('DINK', TERR.DINK[0], 'TT', 'TT', 2, d);
  add('FAM', TERR.FAM[1], 'TT', 'TT', 2, d);

  // One standout ad: a Families static line with half as many quotes again.
  let standout: Truth['standout'] = null;
  if (on) {
    const s = ads.find(a => a.stub === `FAM_${TERR.FAM[0]}_ST_v2_META`)!;
    s.quote_per_click *= 1.8; s.ctr *= 1.1;
    standout = { stub: s.stub, quotes_per_1k: 1.8 * 1.1 };
  }

  // Retargeting ads (must be left out of creative reads): high rates.
  for (const p of PERSONAS) {
    const stub = `${p}_${TERR[p][0]}_ST_v9_META`;
    ads.push({ stub, ad_name: `${stub}_${d}`, persona: p, territory: TERR[p][0], format: 'ST', platform: 'META', features: [], ctr: 0.03, quote_per_click: 0.15, hook: 0,
      daily_impressions: 1500, audience: 'retargeting', campaign: 'Trupanion_Retargeting_META', ad_set: `${p}_META_RT` });
  }

  // Names that must be quarantined, and cosmetic variants that must still parse.
  const planted_bad_names = [
    { ad_name: 'Trupanion_Static_Summer_v1', why: 'no persona code' },
    { ad_name: `FAM_${TERR.FAM[0]}_ST_v2_META_261341`, why: 'impossible date' },
    { ad_name: `DOG_${TERR.FAM[0]}_ST_v1_META_${d}`, why: 'unknown persona' },
    { ad_name: `CUR_${TERR.CUR[0]}_GIF_v1_META_${d}`, why: 'unknown format' },
  ];
  for (const b of planted_bad_names)
    ads.push({ stub: '', ad_name: b.ad_name, persona: 'FAM', territory: '', format: 'ST', platform: 'META', features: [], ctr: 0.012, quote_per_click: 0.04, hook: 0,
      daily_impressions: 1200, audience: 'prospecting', campaign: 'Trupanion_Ralph_Prospecting_META', ad_set: 'FAM_META_Prospecting' });
  const cosmetic: Truth['cosmetic_names'] = [];
  const cos = (stub: string, f: (n: string) => string) => { const a = ads.find(x => x.stub === stub); if (a) { a.ad_name = f(a.ad_name); cosmetic.push({ ad_name: a.ad_name, stub }); } };
  cos(`DINK_${TERR.DINK[1]}_ST_v1_META`, n => n.toLowerCase());
  cos(`CUR_${TERR.CUR[0]}_ST_v3_META`, n => ` ${n.replace('_v3_', '_v3 _ ')} `);
  cos(`FAM_${TERR.FAM[1]}_CAR_v1_META`, n => `${n.replace('_CAR_', '_CAROUSEL_')}_L1`);

  const metaRows: unknown[][] = [];
  const ttRows: unknown[][] = [];
  for (let day = 0; day < days; day++) {
    const iso = addDays(start, day);
    for (const a of ads) {
      const imps = Math.max(0, Math.round(a.daily_impressions * Math.exp(0.25 * normal(r))));
      const plays = a.hook ? binomial(r, imps, a.hook) : null;
      const clicks = binomial(r, imps, a.ctr);
      const quotes = binomial(r, clicks, a.quote_per_click);
      const enrol = binomial(r, quotes, 0.07);
      const lpv = binomial(r, clicks, 0.82);
      const cpm = (a.platform === 'META' ? 10 : 7) * Math.exp(0.15 * normal(r));
      const spend = +(imps * cpm / 1000).toFixed(2);
      const freq = 1 + r() * 0.6;
      const reach = Math.round(imps / freq);
      if (a.platform === 'META') metaRows.push([iso, iso, iso, a.campaign, a.ad_set, a.ad_name, spend, imps, reach, freq.toFixed(2), plays ?? '', plays === null ? '' : Math.round(plays * 0.3), clicks, lpv, quotes, enrol]);
      else ttRows.push([iso, a.campaign, a.ad_set, a.ad_name, spend, imps, reach, freq.toFixed(2), plays ?? '', plays === null ? '' : Math.round(plays * 0.35), clicks, lpv, quotes, enrol]);
    }
  }
  // A Meta export ends with a totals row with no ad name; it must be skipped.
  metaRows.push(['', '', '', '', '', '', metaRows.reduce((s, x) => s + Number(x[6]), 0).toFixed(2), metaRows.reduce((s, x) => s + Number(x[7]), 0), '', '', '', '', '', '', '', '']);

  const meta_csv = toCsv(['Day', 'Reporting starts', 'Reporting ends', 'Campaign name', 'Ad set name', 'Ad name', 'Amount spent (USD)', 'Impressions', 'Reach', 'Frequency', '3-second video plays', 'ThruPlays', 'Link clicks', 'Landing page views', 'Quotes', 'Enrollments'], metaRows);
  const tiktok_csv = toCsv(['Date', 'Campaign name', 'Ad group name', 'Ad name', 'Cost', 'Impressions', 'Reach', 'Frequency', '2-second video views', '6-second video views', 'Clicks (destination)', 'Landing page views', 'Quotes', 'Enrollments'], ttRows);
  const features_csv = toCsv(['stub', 'features'], ads.filter(a => a.stub && a.audience === 'prospecting').map(a => [a.stub.replace('_ST_', '_STATIC_').replace('_CAR_', '_CAROUSEL_'), a.features.join('; ')]));

  const truth: Truth = {
    scenario, seed, start, days, features, persona_features, formats, standout,
    ads: ads.filter(a => a.stub).map(a => ({ stub: a.stub, ad_name: a.ad_name, persona: a.persona, format: a.format, platform: a.platform, features: a.features, ctr: a.ctr, quote_per_click: a.quote_per_click, hook: a.hook, audience: a.audience, quotes_per_1k: a.ctr * a.quote_per_click * 1000 })),
    planted_bad_names, cosmetic_names: cosmetic,
  };
  return { meta_csv, tiktok_csv, features_csv, truth };
}

export type RecoveryStatus = 'recovered' | 'not enough data' | 'not clear yet' | 'correctly not called' | 'CLEAR BUT RANGE MISSES TRUTH';
export interface RecoveryRow {
  what: string; metric: MetricKey; size: 'large' | 'small' | 'none'; truth: number;
  estimate: number | null; lo: number | null; hi: number | null; verdict: Effect['verdict'];
  covered: boolean | null; status: RecoveryStatus; ok: boolean;
}

// A large planted effect should come back clear with a range covering the truth,
// or honestly as "not enough data" / "not clear yet" when the design can't see it.
// Nothing may come back clear with a range that misses the truth (a false call).
export function checkRecovery(read: Read, truth: Truth): { rows: RecoveryRow[]; calls: Array<{ stub: string; call: string; metric: string | null; true_rank: number; cell_size: number }>; summary: string[] } {
  const rows: RecoveryRow[] = [];
  const judge = (what: string, metric: MetricKey, size: RecoveryRow['size'], t: number, e: Effect | undefined) => {
    const covered = e && e.lo !== null && e.hi !== null ? e.lo <= t && t <= e.hi : null;
    const verdict = e?.verdict ?? 'not enough data';
    const clear = verdict === 'clear lift' || verdict === 'clear drag';
    const status: RecoveryStatus = clear ? (covered ? (size === 'none' ? 'CLEAR BUT RANGE MISSES TRUTH' : 'recovered') : 'CLEAR BUT RANGE MISSES TRUTH')
      : size === 'none' ? 'correctly not called' : verdict === 'not enough data' ? 'not enough data' : 'not clear yet';
    rows.push({ what, metric, size, truth: t, estimate: e?.ratio ?? null, lo: e?.lo ?? null, hi: e?.hi ?? null, verdict, covered, status, ok: status !== 'CLEAR BUT RANGE MISSES TRUTH' });
  };
  for (const [f, v] of Object.entries(truth.features)) {
    // Pooled truth for a feature with a persona-specific effect isn't a single number; skip those pooled rows.
    if (truth.persona_features.some(p => p.feature === f)) continue;
    for (const m of ['link_ctr', 'quotes_per_1k'] as MetricKey[]) {
      const t = (v as any)[m] as number;
      judge(`feature ${f}`, m, t === 1 ? 'none' : v.size, t, read.features.find(e => e.label === f && e.metric === m));
    }
    if (v.hook_rate !== 1) judge(`feature ${f}`, 'hook_rate', v.size, v.hook_rate, read.features.find(e => e.label === f && e.metric === 'hook_rate'));
  }
  for (const pf of truth.persona_features) {
    judge(`${pf.persona} × ${pf.feature}`, 'link_ctr', pf.size, pf.link_ctr, read.persona_features.find(e => e.label === pf.feature && e.persona === pf.persona && e.metric === 'link_ctr'));
    for (const p of ['DINK', 'CUR'].filter(x => x !== pf.persona))
      judge(`${p} × ${pf.feature}`, 'link_ctr', 'none', 1, read.persona_features.find(e => e.label === pf.feature && e.persona === p && e.metric === 'link_ctr'));
  }
  for (const [f, v] of Object.entries(truth.formats)) {
    if (f === 'ST') continue;
    judge(`format ${f} vs ST`, 'link_ctr', v.size, v.link_ctr, read.formats.find(e => e.label === `${f} vs ST` && e.metric === 'link_ctr'));
  }
  // Calls against the true ranking inside each cell (quotes per 1,000).
  const tq = new Map(truth.ads.map(a => [a.stub, a.quotes_per_1k]));
  const calls = read.ads.filter(a => a.headline.call !== 'too early to call' && a.headline.call !== 'keep testing').map(a => {
    const cell = read.ads.filter(b => b.cell === a.cell);
    const ranked = [...cell].sort((p, q) => (tq.get(q.stub) ?? 0) - (tq.get(p.stub) ?? 0));
    return { stub: a.stub, call: a.headline.call, metric: a.headline.metric, true_rank: ranked.findIndex(b => b.key === a.key) + 1, cell_size: cell.length };
  });
  const large = rows.filter(x => x.size === 'large');
  const count = (xs: RecoveryRow[], st: RecoveryStatus) => xs.filter(x => x.status === st).length;
  const summary = [
    `Large planted effects: ${large.length}. Recovered (clear, range covers the truth): ${count(large, 'recovered')}. Honestly unresolved: ${count(large, 'not enough data')} not enough data, ${count(large, 'not clear yet')} not clear yet.`,
    `Small planted effects: ${rows.filter(x => x.size === 'small').length}. Recovered: ${count(rows.filter(x => x.size === 'small'), 'recovered')}; the rest not clear yet or not enough data.`,
    `No-effect checks: ${rows.filter(x => x.size === 'none').length}; correctly not called: ${count(rows.filter(x => x.size === 'none'), 'correctly not called')}.`,
    `False clear calls (range misses the truth): ${rows.filter(x => !x.ok).length}.`,
    `Ads called scale or cut: ${calls.length}.`,
    ...rows.filter(x => !x.ok).map(x => `FALSE: ${x.what} on ${x.metric} (truth ${x.truth.toFixed(2)}; got ${x.estimate?.toFixed(2) ?? '-'} [${x.lo?.toFixed(2) ?? '-'}, ${x.hi?.toFixed(2) ?? '-'}], ${x.verdict})`),
  ];
  return { rows, calls, summary };
}

