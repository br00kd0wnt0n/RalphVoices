// B3: the weekly note (Markdown, per persona) and its CSV ledger, drafted from a
// Read. Every number here is computed; wording rules are checked by lintNote.
// Brook edits the draft before the Wednesday read.
import type { WeeklyConfig, MetricKey } from './config.js';
import { METRIC_KEYS } from './config.js';
import type { Read, AdRead, Effect, Call } from './model.js';
import type { WindowResult } from './window.js';
import { toCsv } from './csv.js';

export interface NoteContext {
  week: { start: string; end: string };
  since: string;
  window: WindowResult;
  prev: Read | null;          // the cumulative read to the end of last week
  week_impressions: Map<string, number>; // impressions this week per ad key
  sources: string[];          // ingested files covering the window
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const fmtDate = (iso: string, dow = false) => { const d = new Date(iso + 'T00:00:00Z'); return `${dow ? DOW[d.getUTCDay()] + ' ' : ''}${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const int = (n: number) => Math.round(n).toLocaleString('en-US');
const money = (n: number | null) => (n === null || !Number.isFinite(n) ? '–' : `$${n >= 100 ? int(n) : n.toFixed(2)}`);
const pctp = (p: number | null) => (p === null ? '–' : `${Math.round(p * 100)}%`);
const inTen = (p: number) => `${Math.round(p * 10)} in 10`;

// A rate in the metric's own unit, with its range.
export function fmtRate(m: MetricKey, v: number, cfg: WeeklyConfig): string {
  if (cfg.metrics[m].scale === 'per1k') return (v * 1000).toFixed(2);
  const p = v * 100;
  return `${p < 10 ? p.toFixed(2) : p.toFixed(1)}%`;
}
export function fmtWithRange(m: MetricKey, r: { rate: number; lo: number; hi: number }, cfg: WeeklyConfig): string {
  return `${fmtRate(m, r.rate, cfg)} (range ${fmtRate(m, r.lo, cfg)}–${fmtRate(m, r.hi, cfg)})`;
}
const fmtRatio = (e: Effect) => {
  const p = (x: number) => `${x >= 1 ? '+' : '−'}${Math.abs(Math.round((x - 1) * 100))}%`;
  return e.ratio === null ? '–' : `${p(e.ratio)} (range ${p(e.lo!)} to ${p(e.hi!)})`;
};

const CALL_ORDER: Record<Call, number> = { scale: 0, 'scale (tied)': 1, cut: 2, 'keep testing': 3, 'too early to call': 4 };

const PLATFORM_NAME: Record<string, string> = { META: 'Meta', TT: 'TikTok' };
const plat = (a: AdRead) => PLATFORM_NAME[a.platform] || a.platform;
const FORMAT_NAME: Record<string, string> = { ST: 'statics', VID: 'hero videos', CAR: 'carousels', TT: 'TikTok builds', UGC: 'creator (UGC) videos' };
const fmtName = (f: string) => FORMAT_NAME[f] || f;
const plural = (n: number, w: string, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;

// How the first screen names an ad. Internal: the naming stub. Client: a readable
// label, "DINK · Territory name · carousel v2 (Meta)", with the stub in small print.
export type Namer = (a: AdRead, short?: boolean) => string;
const stubName: Namer = a => a.stub;
const FORMAT_WORD: Record<string, string> = { ST: 'static', VID: 'video', CAR: 'carousel', TT: 'TikTok-native', UGC: 'creator video' };
export function readableLabel(a: Pick<AdRead, 'persona' | 'territory' | 'format' | 'version' | 'platform'>, territoryNames: Record<string, string> = {}): string {
  const name = territoryNames[`${a.persona}_${a.territory}`] ?? territoryNames[a.territory] ?? a.territory;
  return `${a.persona} · ${name.replace(/[.\s]+$/, '')} · ${FORMAT_WORD[a.format] || a.format} v${a.version} (${PLATFORM_NAME[a.platform] || a.platform})`;
}
export function clientNamer(territoryNames: Record<string, string> = {}): Namer {
  return (a, short) => (short ? readableLabel(a, territoryNames) : `${readableLabel(a, territoryNames)} <sub>${a.stub}</sub>`);
}

export interface NoteOptions {
  audience?: 'internal' | 'client';
  featureLabels?: Record<string, string>; // feature id → plain description (Studio rules), for the front page
  territoryNames?: Record<string, string>; // PERSONA_TERRITORY (or TERRITORY) → name, for the client variant's labels
}
export const APPENDIX_MARKER = '<!-- appendix: internal terms allowed below -->';

// The rate an action rests on, in plain words with its range.
function rateOf(a: AdRead, cfg: WeeklyConfig): string {
  const m = a.headline.metric;
  const r = m ? a.metrics[m] : undefined;
  if (!m || !r) return '';
  return cfg.metrics[m].scale === 'per1k'
    ? `${fmtRate(m, r.rate, cfg)} quotes per 1,000 impressions (range ${fmtRate(m, r.lo, cfg)}–${fmtRate(m, r.hi, cfg)})`
    : `${cfg.metrics[m].label} ${fmtWithRange(m, r, cfg)}`;
}
const onWhat = (a: AdRead, cfg: WeeklyConfig) => (a.headline.metric === cfg.calls.primary_metric ? 'on quotes' : `on ${cfg.metrics[a.headline.metric!].label}, while quotes are still too thin to read`);
const isHeld = (a: AdRead) => /held from last week/.test(a.headline.reason);
const smallAdSets = (ads: AdRead[], cfg: WeeklyConfig) => {
  const m = cfg.calls.primary_metric;
  const out: Array<{ plat: string; n: number }> = [];
  for (const c of [...new Set(ads.map(a => a.cell))].sort()) {
    const g = ads.filter(a => a.cell === c);
    const n = g.filter(a => a.metrics[m]?.readable || a.metrics[cfg.calls.fallback_metric ?? m]?.readable).length;
    if (n > 0 && n < cfg.calls.min_ads_in_cell) out.push({ plat: plat(g[0]), n });
  }
  return out;
};

// One line per persona, plain English: ahead, behind, tied, too early to call, keep testing.
export function personaHeadline(ads: AdRead[], cfg: WeeklyConfig, nm: Namer = stubName): string {
  if (!ads.length) return 'No prospecting ads with readable names in this window.';
  const cut = ads.filter(a => a.headline.call === 'cut');
  const early = ads.filter(a => a.headline.call === 'too early to call');
  const parts: string[] = [];
  for (const c of [...new Set(ads.map(a => a.cell))].sort()) {
    const g = ads.filter(a => a.cell === c);
    const single = g.filter(a => a.headline.call === 'scale');
    const tied = g.filter(a => a.headline.call === 'scale (tied)');
    for (const a of single) parts.push(`${nm(a)} is clearly ahead in the ${plat(a)} ad set`);
    if (tied.length) parts.push(`${tied.map(a => nm(a)).join(' and ')} are ahead of the rest of the ${plat(tied[0])} ad set, tied with each other`);
  }
  const behind = cut.length ? `${plural(cut.length, 'ad is', 'ads are')} behind.` : '';
  if (parts.length) { const t = parts.join('; '); return `${t[0].toUpperCase()}${t.slice(1)}.${behind ? ` ${behind}` : ''}`; }
  if (early.length === ads.length) return `Too early to call: none of the ${ads.length} ads has enough data yet.`;
  const small = smallAdSets(ads, cfg);
  const smallTxt = small.length ? ` The ${small.map(s => s.plat).join(' and ')} ad set${small.length > 1 ? 's have' : ' has'} too few ads to call.` : '';
  if (cut.length) return `Nothing clearly ahead yet; ${behind[0].toLowerCase()}${behind.slice(1)}${smallTxt}`;
  return `No ad is clearly ahead or behind yet: keep testing.${smallTxt}`;
}

// Up to three actions, plain English, each with its reason and range.
export function actions(ads: AdRead[], cfg: WeeklyConfig, nm: Namer = stubName): string[] {
  const out: string[] = [];
  const held = (a: AdRead) => (isHeld(a) ? ' Held from last week: its lead has narrowed but still holds.' : '');
  for (const a of ads.filter(a => a.headline.call === 'scale'))
    out.push(`**Scale** ${nm(a)}: clearly ahead of every other ad in the ${plat(a)} ad set ${onWhat(a, cfg)}, ${rateOf(a, cfg)}.${held(a)}`);
  const tiedCells = [...new Set(ads.filter(a => a.headline.call === 'scale (tied)').map(a => a.cell))];
  for (const c of tiedCells) {
    const g = ads.filter(a => a.cell === c && a.headline.call === 'scale (tied)');
    out.push(`**Scale both** ${g.map(a => nm(a)).join(' and ')}: ahead of the rest of the ${plat(g[0])} ad set and tied with each other ${onWhat(g[0], cfg)} (${g.map(a => `${nm(a, true)}: ${rateOf(a, cfg)}`).join('; ')}).${held(g[0])}`);
  }
  const cuts = ads.filter(a => a.headline.call === 'cut').sort((a, b) => (a.metrics[a.headline.metric!]?.rate ?? 0) - (b.metrics[b.headline.metric!]?.rate ?? 0));
  const cutLine = (a: AdRead) => `**Cut** ${nm(a)}: behind most of the ${plat(a)} ad set and clearly behind its top ad ${onWhat(a, cfg)}, ${rateOf(a, cfg)}.${isHeld(a) ? ' Held from last week.' : ''}`;
  // At most two cuts up front when there's something else to say; the rest follow the other actions.
  for (const a of cuts.slice(0, 2)) out.push(cutLine(a));
  for (const s of smallAdSets(ads, cfg))
    out.push(`**Keep testing** the ${s.plat} ad set: only ${s.n} ad${s.n === 1 ? '' : 's'} with enough data, too few to call one ahead of another. A third ad would make a call possible.`);
  const prim = cfg.calls.primary_metric;
  const kt = ads.filter(a => a.headline.call === 'keep testing' && a.metrics[prim]?.readable && !smallAdSets([a], cfg).length)
    .sort((a, b) => (b.metrics[prim]?.p_best ?? 0) - (a.metrics[prim]?.p_best ?? 0));
  for (const a of cuts.slice(2)) out.push(cutLine(a));
  for (const a of kt.slice(0, 1)) out.push(`**Keep testing** ${nm(a)}: nearest to a call, ${rateOf(a, cfg)}, not yet clearly ahead of the rest.`);
  const early = ads.filter(a => a.headline.call === 'too early to call');
  if (early.length) {
    const need = cfg.metrics[prim].min_impressions;
    const median = [...early.map(a => a.impressions)].sort((p, q) => p - q)[Math.floor(early.length / 2)];
    out.push(`**Keep testing** ${early.length === ads.length ? `all ${ads.length} ads` : `the ${plural(early.length, 'ad')} still too early to call`} at even budgets. A read on quotes needs about ${int(need)} impressions per ad; the typical one has ${int(median)} so far.`);
  }
  return out.slice(0, 3);
}

const featName = (id: string, labels?: Record<string, string>) => {
  if (labels?.[id]) return `“${labels[id].replace(/\.$/, '')}”`;
  const [k, v] = id.includes(':') ? id.split(':') : ['', id];
  return k ? `${k} ${v}` : id.replace(/_/g, ' ');
};

// One line for the whole account: what's clear, and what we're still waiting to learn.
export function accountLine(read: Read, cfg: WeeklyConfig, labels?: Record<string, string>): string {
  const clear = [...read.features, ...read.formats].filter(e => e.verdict === 'clear lift' || e.verdict === 'clear drag')
    .map(e => {
      const [f, ref] = e.label.split(' vs ');
      const who = e.kind === 'format' ? `${fmtName(f)} do ${e.verdict === 'clear lift' ? 'better' : 'worse'} than ${fmtName(ref)}` : `ads tagged ${featName(e.label, labels)} do ${e.verdict === 'clear lift' ? 'better' : 'worse'}`;
      return `${who} on ${cfg.metrics[e.metric].label}, by ${fmtRatio(e)}`;
    });
  const waiting: string[] = [];
  const prim = cfg.calls.primary_metric;
  if (!read.metrics_available[prim]) waiting.push('quotes: the export has no quote column yet');
  else if (!read.ads.some(a => a.metrics[prim]?.readable)) waiting.push(`quotes: no ad has the ${int(cfg.metrics[prim].min_impressions)} impressions a read needs yet`);
  const open = read.features.filter(e => e.metric === prim && e.verdict === 'not clear yet').sort((a, b) => b.ads_with - a.ads_with).slice(0, 2);
  if (open.length) waiting.push(`whether ads tagged ${open.map(e => featName(e.label, labels)).join(' or ')} get more quotes`);
  const fmtNd = [...new Set(read.formats.filter(e => e.verdict === 'not enough data').map(e => e.label.split(' vs ')[0]))];
  if (fmtNd.length) waiting.push(`how ${fmtNd.map(fmtName).join(' and ')} compare with other formats (too few so far)`);
  const small = new Set(read.ads.flatMap(a => smallAdSets([...read.ads.filter(b => b.cell === a.cell)], cfg).map(s => `${a.persona} ${s.plat}`)));
  if (small.size) waiting.push(`calls in ad sets with fewer than ${cfg.calls.min_ads_in_cell} ads (${[...small].sort().join(', ')})`);
  return `**Across the account:** ${clear.length ? `clear so far: ${clear.join('; ')}. ` : 'nothing clear yet across ads. '}Still waiting to learn: ${waiting.length ? waiting.join('; ') : 'nothing outstanding'}.`;
}

function whatMoved(ads: AdRead[], prev: Read | null, ctx: NoteContext, cfg: WeeklyConfig): string[] {
  const lines: string[] = [];
  const wk = ads.reduce((s, a) => s + (ctx.week_impressions.get(a.key) || 0), 0);
  lines.push(`${int(wk)} impressions this week across ${ads.filter(a => (ctx.week_impressions.get(a.key) || 0) > 0).length} ads.`);
  if (!prev) { lines.push('First read: nothing to compare with.'); return lines; }
  const before = new Map(prev.ads.map(a => [a.key, a]));
  const fresh = ads.filter(a => !before.has(a.key));
  if (fresh.length) lines.push(`New this week: ${fresh.map(a => a.stub).join(', ')}.`);
  let changed = 0;
  for (const a of ads) {
    const b = before.get(a.key);
    if (b && b.headline.call !== a.headline.call) {
      changed++;
      const m = a.headline.metric ?? b.headline.metric;
      const r = m ? a.metrics[m] : undefined;
      lines.push(`${a.stub}: ${b.headline.call} → **${a.headline.call}**${r ? ` (${cfg.metrics[m!].label} ${fmtWithRange(m!, r, cfg)})` : ''}.`);
    }
  }
  const stopped = prev.ads.filter(b => b.persona === ads[0]?.persona && b.live_now && !ads.find(a => a.key === b.key && a.live_now));
  if (stopped.length) lines.push(`Stopped delivering: ${stopped.map(a => a.stub).join(', ')}.`);
  if (!changed && !fresh.length) lines.push('No call changed since last week.');
  return lines;
}

const cpeText = (a: AdRead, cfg: WeeklyConfig) =>
  a.enrollments < cfg.report.min_enrollments_for_cpe ? `too few enrollments to read (${a.enrollments})` : `${money(a.cpe)} (${a.enrollments})`;

function adTable(ads: AdRead[], read: Read, cfg: WeeklyConfig): string[] {
  const ms = METRIC_KEYS.filter(m => read.metrics_available[m] && ads.some(a => a.metrics[m]));
  const head = ['Ad', 'Impressions', ...ms.map(m => cfg.metrics[m].label), ...(read.metrics_available.quotes_per_1k ? ['Cost per quote (est.)'] : []), 'Cost per enrollment (observed; never used for calls)', `P(best), ${cfg.metrics[cfg.calls.primary_metric].label}`, 'Call'];
  const rows = [...ads].sort((a, b) => CALL_ORDER[a.headline.call] - CALL_ORDER[b.headline.call] || a.stub.localeCompare(b.stub)).map(a => {
    const cells = ms.map(m => {
      const r = a.metrics[m];
      if (!r) return '–';
      return `${fmtWithRange(m, r, cfg)}${r.readable ? '' : ' *early*'}`;
    });
    const cpq = read.metrics_available.quotes_per_1k ? [a.cpq?.lo && a.cpq?.hi ? `${money(a.cpq.value)} (range ${money(a.cpq.lo)}–${money(a.cpq.hi)})` : money(a.cpq?.value ?? null)] : [];
    const pb = a.metrics[cfg.calls.primary_metric]?.p_best ?? null;
    return [`${a.stub}${a.live_now ? '' : ' (off)'}`, int(a.impressions), ...cells, ...cpq, cpeText(a, cfg), pctp(pb), a.headline.call];
  });
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)];
}

// Per ad set and metric: the leader and its ties, from the same draws and bars as the calls.
function leaderLines(ads: AdRead[], read: Read, cfg: WeeklyConfig): string[] {
  const out: string[] = [];
  const byCell = new Map<string, AdRead[]>();
  for (const a of ads) byCell.set(a.cell, [...(byCell.get(a.cell) || []), a]);
  for (const [cell, g] of byCell) {
    for (const m of METRIC_KEYS) {
      if (!read.metrics_available[m]) continue;
      const rd = g.filter(a => a.metrics[m]?.readable);
      const el = g.filter(a => a.metrics[m]);
      if (!el.length) continue;
      const label = cfg.metrics[m].label;
      if (rd.length < 2) { out.push(`${cell}, ${label}: ${rd.length} of ${el.length} ads have enough data; nothing to compare.`); continue; }
      const top = [...rd].sort((a, b) => b.metrics[m]!.p_best! - a.metrics[m]!.p_best!)[0];
      const lead = rd.find(a => a.metrics[m]!.call.startsWith('scale')) ?? top;
      const r = lead.metrics[m]!;
      const small = rd.length < cfg.calls.min_ads_in_cell ? ` Only ${rd.length} readable ads: no scale or cut below ${cfg.calls.min_ads_in_cell}.` : '';
      const tie = r.tied_with.length ? `; tied with ${r.tied_with.join(', ')} (fewer than ${inTen(cfg.calls.tie_bar)} draws put one ahead)` : `; ahead of every other readable ad in at least ${inTen(/held from last week/.test(r.reason) ? cfg.calls.hold.tie_bar : cfg.calls.tie_bar)} draws`;
      out.push(`${cell}, ${label}: ${rd.length} of ${el.length} ads readable. Leader ${lead.stub}, P(best) ${pctp(r.p_best)}, ${fmtWithRange(m, r, cfg)}${tie}.${small}`);
    }
  }
  return out;
}

function effectLines(effects: Effect[], cfg: WeeklyConfig): string[] {
  const out: string[] = [];
  const shown = effects.filter(e => e.verdict !== 'not enough data');
  if (shown.length) {
    out.push('| Feature | Metric | Effect (ads with vs without) | Ads with / compared | Read |', '|---|---|---|---|---|');
    for (const e of shown.sort((a, b) => a.metric.localeCompare(b.metric) || a.label.localeCompare(b.label)))
      out.push(`| ${e.label}${e.persona ? ` (${e.persona})` : ''} | ${cfg.metrics[e.metric].label} | ${fmtRatio(e)} | ${e.ads_with} / ${e.ads_without} | ${e.verdict}${e.why ? `: ${e.why}` : ''} |`);
  }
  const nd = effects.filter(e => e.verdict === 'not enough data');
  if (nd.length) {
    out.push('', 'Not enough data yet:');
    for (const m of METRIC_KEYS) {
      const g = nd.filter(e => e.metric === m);
      if (g.length) out.push(`- ${cfg.metrics[m].label}: ${[...new Set(g.map(e => `${e.label}${e.persona ? ` (${e.persona})` : ''}`))].join(', ')}`);
    }
  }
  return out;
}

export function draftNote(read: Read, ctx: NoteContext, cfg: WeeklyConfig, opts: NoteOptions = {}): { markdown: string; ledger: string } {
  const client = opts.audience === 'client';
  const nm: Namer = client ? clientNamer(opts.territoryNames) : stubName;
  const L: string[] = [];
  const iv = Math.round(read.interval * 100);
  const all = read.ads;
  L.push(`# Weekly read: ${fmtDate(ctx.week.start)} to ${fmtDate(ctx.week.end)} ${ctx.week.end.slice(0, 4)}`, '');
  L.push(client
    ? `*Live results from prospecting ads, ${fmtDate(ctx.since)} to ${fmtDate(ctx.week.end)}. Each figure comes with a range: where the true figure most likely sits (${iv}%). "Too early to call" means there isn't enough data yet to say.*`
    : `*Draft for Brook to edit before the Wednesday read (config v${cfg.version}; ranges are ${iv}%; data ${fmtDate(ctx.since)} to ${fmtDate(ctx.week.end, true)}, prospecting ads only). The first screen is for the call; the appendix is the working.*`, '');

  for (const p of cfg.naming.personas) {
    const ads = all.filter(a => a.persona === p);
    L.push(`## ${p}`, '', `**${personaHeadline(ads, cfg, nm)}**`, '');
    if (ads.length) L.push(...actions(ads, cfg, nm).map((x, i) => `${i + 1}. ${x}`), '');
  }
  L.push(accountLine(read, cfg, opts.featureLabels), '');
  if (client) return { markdown: L.join('\n') + '\n', ledger: ledger(read, ctx, cfg) };

  L.push('---', '', APPENDIX_MARKER, '', '# Appendix (working; not for the call)', '');
  L.push('## What this read covers', '');
  const spend = all.reduce((s, a) => s + a.spend, 0), imps = all.reduce((s, a) => s + a.impressions, 0);
  L.push(`- ${all.length} prospecting ads, ${int(imps)} impressions, ${money(spend)} spend (observed totals).`);
  const lo = ctx.window.left_out;
  if (lo.quarantined.ads) L.push(`- **Left out, names don't parse:** ${lo.quarantined.ads} ads, ${int(lo.quarantined.impressions)} impressions (listed at the end). Ask Add3 to rename them.`);
  if (lo.retargeting.ads) L.push(`- Left out, retargeting: ${lo.retargeting.ads} ads, ${int(lo.retargeting.impressions)} impressions.`);
  if (lo.unknown_audience.ads) L.push(`- **Left out, audience unknown** (campaign and ad set names match neither the prospecting nor the retargeting rule): ${lo.unknown_audience.ads} ads, ${int(lo.unknown_audience.impressions)} impressions.`);
  if (ctx.window.overlaps_dropped) L.push(`- ${ctx.window.overlaps_dropped} rows overlapped finer rows for the same ad (two exports covering the same days); the coarser rows were dropped.`);
  for (const n of read.notes) L.push(`- ${n}`);
  L.push(`- Calls are made on ${cfg.metrics[cfg.calls.primary_metric].label}${cfg.calls.fallback_metric ? `; while that's too thin, ${cfg.metrics[cfg.calls.fallback_metric].label} can support a cut but not a scale` : ''}. No scale or cut in an ad set with fewer than ${cfg.calls.min_ads_in_cell} readable ads. Hook rate is diagnostic only. Cost per enrollment is reported (from ${cfg.report.min_enrollments_for_cpe} enrollments) and never used for a call.`);
  L.push(`- Ties and calls come from the same draws: tied = fewer than ${inTen(cfg.calls.tie_bar)} draws put one ad ahead of the other. A scale is ahead of every ad outside its group, a cut is behind the ad set's leader, in at least ${inTen(cfg.calls.tie_bar)} draws (${inTen(cfg.calls.hold.tie_bar)} to hold last week's call).`);
  if (all.some(a => a.platform === 'TT' && a.metrics.hook_rate)) L.push('- TikTok hook rate is 2-second views over impressions (TikTok\'s closest measure), so it is only compared within TikTok, never with Meta\'s 3-second rate.');
  L.push(cfg.cost_benchmarks.cost_per_quote ? `- Cost per quote is compared against a target of ${money(cfg.cost_benchmarks.cost_per_quote)}.` : '- No cost benchmark yet: Trupanion\'s allowable acquisition cost by state hasn\'t arrived, so cost per quote is shown without a target.');
  L.push('');

  for (const p of cfg.naming.personas) {
    const ads = all.filter(a => a.persona === p);
    if (!ads.length) continue;
    L.push(`## ${p}: detail`, '');
    L.push('### What moved', '', ...whatMoved(ads, ctx.prev, ctx, cfg).map(x => `- ${x}`), '');
    L.push('### How sure we are', '', ...leaderLines(ads, read, cfg).map(x => `- ${x}`), '');
    L.push(...adTable(ads, read, cfg), '');
    const shown = new Set(actions(ads, cfg).join(' ').match(/\b[A-Z]+_[A-Z0-9_]+_v\d+_[A-Z]+\b/g) || []);
    const called = ads.filter(a => (a.headline.call !== 'keep testing' && a.headline.call !== 'too early to call') && !shown.has(a.stub));
    if (called.length) L.push(`Also called (not in the first screen): ${called.map(a => `${a.headline.call} ${a.stub}`).join('; ')}.`, '');
    const pf = read.persona_features.filter(e => e.persona === p && e.verdict !== 'not enough data');
    if (pf.length) L.push(`### ${p}: features within this persona`, '', ...effectLines(pf, cfg), '');
  }

  L.push('## Across personas: features and formats', '');
  L.push('Features are compared within the same persona and platform, adjusted for format and for each other. "Clear" allows for the number of features checked together. A feature that only ever appears with another can\'t be separated from it, and shows as not enough data.', '');
  L.push(...effectLines(read.features, cfg), '');
  L.push('### Formats', '', 'Format effects are read across personas and months, not within one persona in one month.', '');
  L.push(...effectLines(read.formats, cfg).map(x => x.replace('| Feature |', '| Format |')), '');

  if (lo.quarantined.names.length || lo.unknown_audience.names.length) {
    L.push('## Left out of this read', '');
    for (const q of lo.quarantined.names) L.push(`- \`${q.ad_name}\`: ${q.reason} (${int(q.impressions)} impressions)`);
    for (const n of lo.unknown_audience.names) L.push(`- \`${n}\`: audience unknown`);
    L.push('');
  }
  L.push('---', `*Sources: ${ctx.sources.length ? ctx.sources.join(', ') : 'none recorded'}. Config v${cfg.version}; ${read.cv.link_ctr ? `between-ad spread on link CTR ${read.cv.link_ctr.estimated ? 'estimated from the data' : 'at its default'}` : ''}.*`);

  return { markdown: L.join('\n') + '\n', ledger: ledger(read, ctx, cfg) };
}

export const LEDGER_COLUMNS = ['week_start', 'week_end', 'since', 'persona', 'platform', 'cell', 'stub', 'ad_name', 'format', 'territory', 'features', 'live', 'days_live', 'impressions', 'spend',
  'metric', 'events', 'rate_raw', 'rate', 'range_lo', 'range_hi', 'readable', 'p_best', 'p_worse_than_median', 'tied_with', 'metric_call', 'metric_reason', 'headline_call', 'headline_metric', 'headline_reason', 'cost_per_quote_est', 'cost_per_quote_lo', 'cost_per_quote_hi', 'cost_per_quote_observed', 'cost_per_enrollment', 'config_version'];

export function ledger(read: Read, ctx: NoteContext, cfg: WeeklyConfig): string {
  const rows: unknown[][] = [];
  const r6 = (v: number | null | undefined) => (v === null || v === undefined ? '' : +v.toPrecision(6));
  for (const a of read.ads) for (const m of METRIC_KEYS) {
    const r = a.metrics[m];
    if (!r) continue;
    rows.push([ctx.week.start, ctx.week.end, ctx.since, a.persona, a.platform, a.cell, a.stub, a.ad_name, a.format, a.territory, (a.features || []).join('; '), a.live_now, a.days_live, a.impressions, +a.spend.toFixed(2),
      m, r.x, r6(r.rate_raw), r6(r.rate), r6(r.lo), r6(r.hi), r.readable, r6(r.p_best), r6(r.p_worse_than_median), r.tied_with.join('; '), r.call, r.reason, a.headline.call, a.headline.metric ?? '', a.headline.reason,
      a.cpq?.value != null ? +a.cpq.value.toFixed(2) : '', a.cpq?.lo != null ? +a.cpq.lo.toFixed(2) : '', a.cpq?.hi != null ? +a.cpq.hi.toFixed(2) : '', a.cpq?.observed != null ? +a.cpq.observed.toFixed(2) : '', a.cpe !== null ? +a.cpe.toFixed(2) : '', cfg.version]);
  }
  return toCsv(LEDGER_COLUMNS, rows);
}

// ---------- wording rules ----------

export interface LintIssue { rule: string; line: number; text: string }

// Banned words anywhere; every estimated rate must have its range on the same line.
export function lintNote(md: string, cfg: WeeklyConfig): LintIssue[] {
  const issues: LintIssue[] = [];
  // Stems: "predict" also catches "predicts" and "predicted".
  const banned = new RegExp(`\\b((?:${cfg.wording.banned.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\w*)`, 'i');
  const cut = md.indexOf(APPENDIX_MARKER);
  const frontLines = (cut < 0 ? md : md.slice(0, cut)).split('\n').length;
  const internal = cfg.wording.internal_terms.map(t => ({ t, re: new RegExp(/^\w/.test(t) ? `\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*` : t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }));
  md.split('\n').forEach((line, i) => {
    if (i < frontLines && !line.startsWith('<!--')) for (const { t, re } of internal) if (re.test(line)) issues.push({ rule: `internal term "${t}" before the appendix`, line: i + 1, text: line });
    const b = banned.exec(line);
    if (b) issues.push({ rule: `banned word "${b[1]}"`, line: i + 1, text: line });
    // A percentage or "per 1,000" rate needs a range nearby. P(...) values, effect
    // ranges and shares of ads are probabilities or already ranges.
    const stripped = line.replace(/\bP\b[^%]{0,40}?\d+%/g, '').replace(/\(range [^)]*\)/g, '').replace(/range [−+\-]?\d+%\s*to\s*[−+\-]?\d+%/g, '');
    const rateNoRange = /(?<![−+\-\d])\d+(?:\.\d+)?%(?!\s*\(range)/.test(stripped) && !/range/.test(line) && !/^\|---/.test(line);
    if (rateNoRange) issues.push({ rule: 'rate without a range', line: i + 1, text: line });
  });
  return issues;
}

// ---------- LLM prose guard ----------

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'dozen', 'twenty', 'thirty', 'forty', 'fifty', 'hundred', 'thousand', 'million', 'half', 'double', 'twice', 'triple', 'quarter', 'third'];

export function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.push(m[0].replace(/,/g, '').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1'));
  for (const m of text.toLowerCase().matchAll(new RegExp(`\\b(${NUMBER_WORDS.join('|')})\\b`, 'g'))) out.push(m[1]);
  for (const m of text.toLowerCase().matchAll(/\b((?:doubl|tripl|quadrupl|halv)\w*)/g)) out.push(m[1]);
  return out;
}

// Numbers (digits or number words) in the prose that don't appear in the source.
export function newNumbers(prose: string, source: string): string[] {
  const allowed = new Set(numbersIn(source));
  return [...new Set(numbersIn(prose).filter(n => !allowed.has(n)))];
}
