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

function personaHeadline(ads: AdRead[], cfg: WeeklyConfig, read: Read): string {
  const prim = cfg.calls.primary_metric;
  if (!ads.length) return 'No prospecting ads with parsed names in this window.';
  const cut = ads.filter(a => a.headline.call === 'cut');
  const early = ads.filter(a => a.headline.call === 'too early to call');
  const parts: string[] = [];
  const cells = [...new Set(ads.map(a => a.cell))].sort();
  for (const c of cells) {
    const g = ads.filter(a => a.cell === c);
    const plat = PLATFORM_NAME[g[0].platform] || g[0].platform;
    const single = g.filter(a => a.headline.call === 'scale');
    const tied = g.filter(a => a.headline.call === 'scale (tied)');
    for (const a of single) parts.push(`${a.stub} is clearly ahead in the ${plat} ad set on ${cfg.metrics[a.headline.metric!].label}`);
    if (tied.length) parts.push(`in the ${plat} ad set, ${tied.map(a => a.stub).join(' and ')} are ahead of the rest and tied with each other`);
  }
  if (parts.length) {
    const s = parts.join('; ');
    return `${s[0].toUpperCase()}${s.slice(1)}.${cut.length ? ` ${cut.length} ad${cut.length === 1 ? ' is' : 's are'} clearly behind.` : ''}`;
  }
  if (early.length === ads.length) return `Too early to call: none of the ${ads.length} ads has enough data yet.`;
  if (cut.length) return `Nothing clearly ahead yet; ${cut.length} ad${cut.length === 1 ? ' is' : 's are'} clearly behind.`;
  const readable = ads.filter(a => a.metrics[prim]?.readable).length;
  return read.metrics_available[prim] && readable === 0 ? `Too early to call on ${cfg.metrics[prim].label}; keep testing.` : 'Keep testing: no ad is clearly ahead or behind.';
}

// The headline metric's rate and range, for an action line.
function rateOf(a: AdRead, cfg: WeeklyConfig): string {
  const m = a.headline.metric;
  const r = m ? a.metrics[m] : undefined;
  return m && r ? `${cfg.metrics[m].label} ${fmtWithRange(m, r, cfg)}` : '';
}

function actions(ads: AdRead[], cfg: WeeklyConfig): string[] {
  const out: string[] = [];
  const sorted = [...ads].sort((a, b) => CALL_ORDER[a.headline.call] - CALL_ORDER[b.headline.call]);
  for (const a of sorted.filter(a => a.headline.call !== 'keep testing' && a.headline.call !== 'too early to call').slice(0, 3)) {
    const verb = a.headline.call === 'cut' ? 'Cut' : a.headline.call === 'scale (tied)' ? 'Scale (tied)' : 'Scale';
    out.push(`**${verb}** ${a.stub}: ${rateOf(a, cfg)}; ${a.headline.reason.replace(/^[^:]+: /, '')}.`);
  }
  if (out.length < 3) {
    // Keep testing: the ads nearest a call first, then the thinnest.
    const prim = cfg.calls.primary_metric;
    const kt = ads.filter(a => a.headline.call === 'keep testing').sort((a, b) => (b.metrics[prim]?.p_best ?? 0) - (a.metrics[prim]?.p_best ?? 0));
    for (const a of kt.slice(0, 3 - out.length)) out.push(`**Keep testing** ${a.stub}: ${rateOf(a, cfg) ? `${rateOf(a, cfg)}; ` : ''}${a.headline.reason}.`);
  }
  if (out.length < 3) {
    const early = ads.filter(a => a.headline.call === 'too early to call');
    if (early.length) {
      const prim = cfg.calls.primary_metric, need = cfg.metrics[prim].min_impressions;
      const median = [...early.map(a => a.impressions)].sort((p, q) => p - q)[Math.floor(early.length / 2)];
      out.push(`**Keep testing** the ${early.length} ad${early.length === 1 ? '' : 's'} still too early to call (median ${int(median)} impressions so far; a call on ${cfg.metrics[prim].label} needs ${int(need)} per ad). Keep budgets even across them until then.`);
    }
  }
  return out.slice(0, 3);
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

function adTable(ads: AdRead[], read: Read, cfg: WeeklyConfig): string[] {
  const ms = METRIC_KEYS.filter(m => read.metrics_available[m] && ads.some(a => a.metrics[m]));
  const head = ['Ad', 'Impressions', ...ms.map(m => cfg.metrics[m].label), ...(read.metrics_available.quotes_per_1k ? ['Cost per quote (est.)'] : []), `P(best), ${cfg.metrics[cfg.calls.primary_metric].label}`, 'Call'];
  const rows = [...ads].sort((a, b) => CALL_ORDER[a.headline.call] - CALL_ORDER[b.headline.call] || a.stub.localeCompare(b.stub)).map(a => {
    const cells = ms.map(m => {
      const r = a.metrics[m];
      if (!r) return '–';
      return `${fmtWithRange(m, r, cfg)}${r.readable ? '' : ' *early*'}`;
    });
    const cpq = read.metrics_available.quotes_per_1k ? [a.cpq?.lo && a.cpq?.hi ? `${money(a.cpq.value)} (range ${money(a.cpq.lo)}–${money(a.cpq.hi)})` : money(a.cpq?.value ?? null)] : [];
    const pb = a.metrics[cfg.calls.primary_metric]?.p_best ?? null;
    return [`${a.stub}${a.live_now ? '' : ' (off)'}`, int(a.impressions), ...cells, ...cpq, pctp(pb), a.headline.call];
  });
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)];
}

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
      if (rd.length < cfg.calls.min_ads_in_cell) { out.push(`${cell}, ${label}: ${rd.length} of ${el.length} ads have enough data to compare; too early to call.`); continue; }
      const top = [...rd].sort((a, b) => b.metrics[m]!.p_best! - a.metrics[m]!.p_best!)[0];
      const r = top.metrics[m]!;
      const tie = r.tied_with.length ? `; its range overlaps ${r.tied_with.length} other ad${r.tied_with.length === 1 ? '' : 's'} (${r.tied_with.join(', ')}), so they're tied` : '';
      out.push(`${cell}, ${label}: ${rd.length} of ${el.length} ads readable. Highest P(best) is ${top.stub} at ${pctp(r.p_best)}, ${fmtWithRange(m, r, cfg)}${tie}.`);
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

export function draftNote(read: Read, ctx: NoteContext, cfg: WeeklyConfig): { markdown: string; ledger: string } {
  const L: string[] = [];
  const iv = Math.round(read.interval * 100);
  const all = read.ads;
  L.push(`# Weekly read: ${fmtDate(ctx.week.start)} to ${fmtDate(ctx.week.end)} ${ctx.week.end.slice(0, 4)}`, '');
  L.push(`*Draft for Brook to edit before the Wednesday read. Every number is computed by \`weekly.ts note\` (config v${cfg.version}); ranges are ${iv}%. Data from ${fmtDate(ctx.since)} to ${fmtDate(ctx.week.end, true)}, prospecting ads only.*`, '');

  L.push('## Summary', '');
  for (const p of cfg.naming.personas) {
    const ads = all.filter(a => a.persona === p);
    L.push(`- **${p}:** ${personaHeadline(ads, cfg, read)}`);
  }
  L.push('');

  L.push('## What this read covers', '');
  const spend = all.reduce((s, a) => s + a.spend, 0), imps = all.reduce((s, a) => s + a.impressions, 0);
  L.push(`- ${all.length} prospecting ads, ${int(imps)} impressions, ${money(spend)} spend (observed totals).`);
  const lo = ctx.window.left_out;
  if (lo.quarantined.ads) L.push(`- **Left out, names don't parse:** ${lo.quarantined.ads} ads, ${int(lo.quarantined.impressions)} impressions (listed at the end). Ask Add3 to rename them.`);
  if (lo.retargeting.ads) L.push(`- Left out, retargeting: ${lo.retargeting.ads} ads, ${int(lo.retargeting.impressions)} impressions.`);
  if (lo.unknown_audience.ads) L.push(`- **Left out, audience unknown** (campaign and ad set names match neither the prospecting nor the retargeting rule): ${lo.unknown_audience.ads} ads, ${int(lo.unknown_audience.impressions)} impressions.`);
  if (ctx.window.overlaps_dropped) L.push(`- ${ctx.window.overlaps_dropped} rows overlapped finer rows for the same ad (two exports covering the same days); the coarser rows were dropped.`);
  for (const n of read.notes) L.push(`- ${n}`);
  L.push(`- Calls are made on ${cfg.metrics[cfg.calls.primary_metric].label}${cfg.calls.fallback_metric ? `; while that's too thin, ${cfg.metrics[cfg.calls.fallback_metric].label} can support a cut but not a scale` : ''}. Hook rate is diagnostic only. Cost per enrollment is reported and never used for a call.`);
  if (all.some(a => a.platform === 'TT' && a.metrics.hook_rate)) L.push('- TikTok hook rate is 2-second views over impressions (TikTok\'s closest measure), so it is only compared within TikTok, never with Meta\'s 3-second rate.');
  L.push(cfg.cost_benchmarks.cost_per_quote ? `- Cost per quote is compared against a target of ${money(cfg.cost_benchmarks.cost_per_quote)}.` : '- No cost benchmark yet: Trupanion\'s allowable acquisition cost by state hasn\'t arrived, so cost per quote is shown without a target.');
  L.push('');

  for (const p of cfg.naming.personas) {
    const ads = all.filter(a => a.persona === p);
    L.push(`## ${p}`, '', `**${personaHeadline(ads, cfg, read)}**`, '');
    if (!ads.length) continue;
    L.push('### What moved', '', ...whatMoved(ads, ctx.prev, ctx, cfg).map(x => `- ${x}`), '');
    L.push('### How sure we are', '', ...leaderLines(ads, read, cfg).map(x => `- ${x}`), '');
    L.push(...adTable(ads, read, cfg), '');
    const cpe = ads.filter(a => a.cpe !== null);
    if (cpe.length) L.push(`Cost per enrollment (observed, not used for calls): ${cpe.map(a => `${a.stub} ${money(a.cpe)} from ${a.enrollments} enrollment${a.enrollments === 1 ? '' : 's'}`).join('; ')}.`, '');
    L.push('### Recommended actions', '', ...actions(ads, cfg).map((x, i) => `${i + 1}. ${x}`), '');
    const called = [...ads].filter(a => a.headline.call !== 'keep testing' && a.headline.call !== 'too early to call').sort((a, b) => CALL_ORDER[a.headline.call] - CALL_ORDER[b.headline.call]).slice(3);
    if (called.length) L.push(`Also called (see the table): ${called.map(a => `${a.headline.call} ${a.stub}`).join('; ')}.`, '');
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
  md.split('\n').forEach((line, i) => {
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
