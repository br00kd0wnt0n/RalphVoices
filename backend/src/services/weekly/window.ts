// B3: from ad-period rows (as ingested or loaded from live_metrics) to one
// AdData per ad over a date window. Prospecting ads with parsed names only;
// everything else is counted so the note can say what was left out.
import type { AdData } from './model.js';
import type { Audience } from './ingest.js';

export interface MetricRow {
  key: string;
  ad_name: string;
  audience: Audience;
  parsed: { stub: string; asset: string; persona: string; territory: string; format: string; platform: string; version: number } | null;
  quarantine_reason: string | null;
  features: string[] | null;
  period_start: string;
  period_end: string;
  spend: number | null;
  impressions: number | null;
  video_3s: number | null;
  link_clicks: number | null;
  landing_page_views: number | null;
  quotes: number | null;
  enrollments: number | null;
}

export interface WindowResult {
  ads: AdData[];
  left_out: {
    quarantined: { ads: number; impressions: number; names: Array<{ ad_name: string; reason: string; impressions: number }> };
    retargeting: { ads: number; impressions: number };
    unknown_audience: { ads: number; impressions: number; names: string[] };
  };
  overlaps_dropped: number;
  quotes_seen: boolean;
}

const DAY = 86400000;
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1;

// The Monday–Sunday week containing a date.
export function weekOf(iso: string): { start: string; end: string } {
  const d = new Date(iso + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(iso, -dow);
  return { start, end: addDays(start, 6) };
}

// historic: keep ads whose names don't follow the convention (Add3's history predates
// it) as their own ads in one 'HIST' persona, video if they have any 3-second plays.
// For the back-test only; weekly reads never use it.
export function aggregate(rows: MetricRow[], from: string, to: string, opts: { historic?: boolean } = {}): WindowResult {
  const inWin = rows.filter(r => r.period_start >= from && r.period_end <= to);
  // Overlapping periods for one ad (a daily file and a weekly file both ingested):
  // keep the finest rows, drop coarser ones that overlap them.
  const byAd = new Map<string, MetricRow[]>();
  for (const r of inWin) byAd.set(r.key, [...(byAd.get(r.key) || []), r]);
  let overlaps = 0;
  const kept: MetricRow[] = [];
  for (const g of byAd.values()) {
    const sorted = [...g].sort((a, b) => days(a.period_start, a.period_end) - days(b.period_start, b.period_end) || a.period_start.localeCompare(b.period_start));
    const acc: MetricRow[] = [];
    for (const r of sorted) {
      if (acc.some(k => !(r.period_end < k.period_start || r.period_start > k.period_end))) { overlaps++; continue; }
      acc.push(r);
    }
    kept.push(...acc);
  }

  const res: WindowResult = {
    ads: [], overlaps_dropped: overlaps, quotes_seen: kept.some(r => r.quotes !== null),
    left_out: { quarantined: { ads: 0, impressions: 0, names: [] }, retargeting: { ads: 0, impressions: 0 }, unknown_audience: { ads: 0, impressions: 0, names: [] } },
  };
  const groups = new Map<string, MetricRow[]>();
  for (const r of kept) groups.set(r.key, [...(groups.get(r.key) || []), r]);
  const liveFrom = addDays(to, -6);
  for (const g of groups.values()) {
    const f = g[0];
    const imps = g.reduce((s, r) => s + (r.impressions || 0), 0);
    let parsed = f.parsed, reason = f.quarantine_reason;
    if (opts.historic && !parsed) {
      const video = g.some(r => (r.video_3s || 0) > 0);
      parsed = { stub: f.ad_name, asset: f.ad_name, persona: 'HIST', territory: f.ad_name, format: video ? 'VID' : 'ST', platform: f.key.startsWith('tiktok|') ? 'TT' : 'META', version: 1 };
      reason = null;
    }
    if (reason || !parsed) {
      res.left_out.quarantined.ads++; res.left_out.quarantined.impressions += imps;
      res.left_out.quarantined.names.push({ ad_name: f.ad_name, reason: reason || 'name did not parse', impressions: imps });
      continue;
    }
    if (f.audience === 'retargeting') { res.left_out.retargeting.ads++; res.left_out.retargeting.impressions += imps; continue; }
    if (f.audience === 'unknown') { res.left_out.unknown_audience.ads++; res.left_out.unknown_audience.impressions += imps; res.left_out.unknown_audience.names.push(f.ad_name); continue; }
    const delivered = g.filter(r => (r.impressions || 0) > 0);
    if (!delivered.length) continue;
    const first = delivered.map(r => r.period_start).sort()[0];
    const last = delivered.map(r => r.period_end).sort().slice(-1)[0];
    const sum = (k: keyof MetricRow) => g.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    const p = parsed;
    res.ads.push({
      key: f.key, ad_name: f.ad_name, stub: p.stub, asset: p.asset, persona: p.persona, territory: p.territory, format: p.format, platform: p.platform, version: p.version,
      features: f.features, first_day: first, last_day: last, days_live: days(first, last),
      live_now: delivered.some(r => r.period_end >= liveFrom),
      spend: sum('spend'), impressions: imps, video_3s: sum('video_3s'), link_clicks: sum('link_clicks'),
      landing_page_views: sum('landing_page_views'), quotes: Math.round(sum('quotes')), enrollments: Math.round(sum('enrollments')),
    });
  }
  res.left_out.quarantined.names.sort((a, b) => b.impressions - a.impressions);
  res.ads.sort((a, b) => a.stub.localeCompare(b.stub) || a.key.localeCompare(b.key));
  return res;
}

// IngestRow (straight from a file, no database) → MetricRow.
export function fromIngest(r: import('./ingest.js').IngestRow): MetricRow {
  const n = r.name;
  return {
    key: `${r.source_platform}|${r.ad_name}|${r.campaign}|${r.ad_set}`, ad_name: r.ad_name, audience: r.audience,
    parsed: n.ok ? { stub: n.stub, asset: n.asset, persona: n.persona, territory: n.territory, format: n.format, platform: n.platform, version: n.version } : null,
    quarantine_reason: r.quarantine_reason, features: r.features,
    period_start: r.period_start, period_end: r.period_end, spend: r.spend, impressions: r.impressions, video_3s: r.video_3s,
    link_clicks: r.link_clicks, landing_page_views: r.landing_page_views, quotes: r.quotes, enrollments: r.enrollments,
  };
}
