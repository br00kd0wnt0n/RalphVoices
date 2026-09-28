// B3 ingest, pure part: an ad platform export (CSV text) in, parsed ad-period
// rows out, with the column mapping it used, the quarantine list and anything
// skipped. No database here; store.ts writes the result.
import { parseCsv, csvObjects } from './csv.js';
import { parseAdName, normalizeStub, type NameResult } from './naming.js';
import type { WeeklyConfig, Field, SourcePlatform, ColumnMap } from './config.js';

export type Audience = 'prospecting' | 'retargeting' | 'unknown';

export interface Counts {
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  video_3s: number | null;
  thruplays: number | null;
  link_clicks: number | null;
  landing_page_views: number | null;
  quotes: number | null;
  enrollments: number | null;
}
export const COUNT_FIELDS: Array<keyof Counts> = ['spend', 'impressions', 'reach', 'frequency', 'video_3s', 'thruplays', 'link_clicks', 'landing_page_views', 'quotes', 'enrollments'];
const ADDITIVE: Array<keyof Counts> = ['spend', 'impressions', 'video_3s', 'thruplays', 'link_clicks', 'landing_page_views', 'quotes', 'enrollments'];

export interface IngestRow extends Counts {
  source_platform: SourcePlatform;
  ad_name: string;
  ad_id: string | null;
  campaign: string;
  ad_set: string;
  period_start: string;   // ISO date
  period_end: string;     // ISO date, inclusive
  name: NameResult;
  quarantine_reason: string | null;
  audience: Audience;
  features: string[] | null;       // null = unknown (no Studio or audit record for this stub)
  features_source: string | null;
}

export interface ColumnReport {
  mapped: Partial<Record<Field, string>>;
  missing: Field[];           // fields with no matching header
  unmapped_headers: string[]; // headers nothing used
}

export interface ExportResult {
  platform: SourcePlatform;
  columns: ColumnReport;
  rows: IngestRow[];
  quarantine: Array<{ ad_name: string; reason: string; rows: number; impressions: number }>;
  skipped: Array<{ line: number; reason: string }>;
  warnings: string[];
  name_warnings: Array<{ ad_name: string; warnings: string[] }>;
  audience_counts: Record<Audience, { ads: number; impressions: number }>;
  quotes_available: boolean;
  enrollments_available: boolean;
}

export type FeatureMap = Map<string, { features: string[]; source: string }>;

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9*]/g, '');

export function mapColumns(headers: string[], map: ColumnMap): ColumnReport {
  const mapped: Partial<Record<Field, string>> = {};
  const used = new Set<string>();
  const nh = headers.map(h => ({ h, n: norm(h) }));
  for (const [field, aliases] of Object.entries(map) as Array<[Field, string[]]>) {
    if (!Array.isArray(aliases)) continue;
    // Exact aliases first (in order), then prefix aliases, so "Quotes" beats "Quote*".
    let hit: string | undefined;
    for (const a of aliases.filter(x => !x.endsWith('*'))) { hit = nh.find(x => !used.has(x.h) && x.n === norm(a))?.h; if (hit) break; }
    if (!hit) for (const a of aliases.filter(x => x.endsWith('*'))) {
      const p = norm(a.slice(0, -1));
      hit = nh.find(x => !used.has(x.h) && x.n.startsWith(p) && !/cost|per|rate/.test(x.n.slice(p.length)))?.h;
      if (hit) break;
    }
    if (hit) { mapped[field] = hit; used.add(hit); }
  }
  const fields = Object.keys(map).filter(k => !k.startsWith('_')) as Field[];
  return { mapped, missing: fields.filter(f => !mapped[f]), unmapped_headers: headers.filter(h => !used.has(h)) };
}

export function parseNumber(v: string | undefined): number | null {
  if (v === undefined) return null;
  const s = v.trim().replace(/[$£€,\s%]/g, '');
  if (s === '' || s === '-' || s === '—' || s === '–' || /^n\/?a$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ISO (2026-10-13), US (10/13/2026) or compact (20261013).
export function parseDay(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) { y = +mt[3]; m = +mt[1]; d = +mt[2]; }
  else if ((mt = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

export function classifyAudience(campaign: string, adSet: string, cfg: WeeklyConfig['audience']): Audience {
  const hay = cfg.match_on.map(k => (k === 'campaign' ? campaign : adSet)).join(' | ').replace(/[_\-]+/g, ' ');
  if (new RegExp(cfg.retargeting_pattern, 'i').test(hay)) return 'retargeting';
  if (new RegExp(cfg.prospecting_pattern, 'i').test(hay)) return 'prospecting';
  return cfg.default;
}

// Studio shortlist (stub, features "a; b", angle "CUR_A2 label", structure) or a
// B2 audit export (stub, features). Keyed by the normalised stub.
export function loadFeatureCsv(text: string, source: string, cfg: WeeklyConfig, into: FeatureMap = new Map()): { map: FeatureMap; rows: number; unmatched: string[] } {
  const unmatched: string[] = [];
  const rows = csvObjects(text);
  for (const r of rows) {
    const rawStub = r.stub || r.Stub || r.naming_stub || '';
    // A B2 audit of historic ads (before the convention) is keyed by the ad name as it ran.
    const adName = (r.ad_name || r['Ad name'] || '').trim();
    const key = normalizeStub(rawStub, cfg.naming) || (adName ? `name:${adName.toUpperCase()}` : null);
    if (!key) { if (rawStub) unmatched.push(rawStub); continue; }
    const feats = new Set<string>((r.features || '').split(/[;|]/).map(s => s.trim()).filter(Boolean));
    if (cfg.features.include_tags.includes('angle') && r.angle) feats.add(`angle:${r.angle.trim().split(/\s+/)[0]}`);
    if (cfg.features.include_tags.includes('structure') && r.structure) feats.add(`structure:${r.structure.trim()}`);
    const prev = into.get(key);
    into.set(key, { features: [...new Set([...(prev?.features || []), ...feats])].sort(), source: prev ? `${prev.source}+${source}` : source });
  }
  return { map: into, rows: rows.length, unmatched };
}

export function parseExport(text: string, platform: SourcePlatform, cfg: WeeklyConfig, features: FeatureMap = new Map()): ExportResult {
  const table = parseCsv(text);
  if (!table.length) throw new Error('empty file');
  const headers = table[0].map(h => h.trim());
  const columns = mapColumns(headers, cfg.columns[platform]);
  const col = columns.mapped;
  if (!col.ad_name) throw new Error(`no ad name column; headers: ${headers.join(', ')}`);
  if (!col.impressions) throw new Error('no impressions column');
  if (!col.day && !(col.period_start && col.period_end)) throw new Error('no date columns: need a Day column or Reporting starts/ends');
  const idx = (f: Field) => (col[f] ? headers.indexOf(col[f]!) : -1);
  const get = (r: string[], f: Field) => { const i = idx(f); return i >= 0 ? (r[i] ?? '') : undefined; };
  const wantPlat = platform === 'meta' ? 'META' : 'TT';

  const skipped: ExportResult['skipped'] = [];
  const warnings: string[] = [];
  const byKey = new Map<string, IngestRow>();
  let merged = 0;

  table.slice(1).forEach((r, k) => {
    const line = k + 2;
    const adName = (get(r, 'ad_name') || '').trim();
    const campaign = (get(r, 'campaign') || '').trim();
    const adSet = (get(r, 'ad_set') || '').trim();
    if (!adName && !campaign && !adSet) { skipped.push({ line, reason: 'summary or blank row (no ad, campaign or ad set)' }); return; }
    const day = parseDay(get(r, 'day'));
    const start = day || parseDay(get(r, 'period_start'));
    const end = day || parseDay(get(r, 'period_end'));
    if (!start || !end) { skipped.push({ line, reason: `no readable date (${get(r, 'day') ?? get(r, 'period_start') ?? ''})` }); return; }
    const counts = Object.fromEntries(COUNT_FIELDS.map(f => [f, parseNumber(get(r, f))])) as unknown as Counts;
    const name = parseAdName(adName, cfg.naming);
    let reason: string | null = null;
    if (!name.ok) reason = name.reason;
    else if (name.platform !== wantPlat) reason = `platform in name (${name.platform}) doesn't match this ${platform} export`;
    const feat = (name.ok ? features.get(name.stub) : undefined) ?? features.get(`name:${adName.toUpperCase()}`);
    const row: IngestRow = {
      source_platform: platform, ad_name: adName, ad_id: (get(r, 'ad_id') || '').trim() || null, campaign, ad_set: adSet,
      period_start: start, period_end: end, ...counts, name, quarantine_reason: reason,
      audience: classifyAudience(campaign, adSet, cfg.audience),
      features: feat ? feat.features : null, features_source: feat ? feat.source : null,
    };
    const key = [adName, campaign, adSet, start, end].join('\u0001');
    const prev = byKey.get(key);
    if (prev) {
      // Same ad and period twice: a breakdown export (placement, age...). Sum the counts;
      // reach and frequency can't be summed, so they're dropped for that row.
      merged++;
      for (const f of ADDITIVE) prev[f] = prev[f] === null && row[f] === null ? null : (prev[f] || 0) + (row[f] || 0);
      prev.reach = null; prev.frequency = null;
    } else byKey.set(key, row);
  });
  if (merged) warnings.push(`${merged} rows repeated an ad and period (a breakdown export?); counts were summed and reach/frequency dropped for those.`);

  const rows = [...byKey.values()];
  const q = new Map<string, { ad_name: string; reason: string; rows: number; impressions: number }>();
  const nameWarn = new Map<string, string[]>();
  const aud: ExportResult['audience_counts'] = { prospecting: { ads: 0, impressions: 0 }, retargeting: { ads: 0, impressions: 0 }, unknown: { ads: 0, impressions: 0 } };
  const seenAud = new Set<string>();
  for (const r of rows) {
    if (r.quarantine_reason) {
      const e = q.get(r.ad_name) || { ad_name: r.ad_name, reason: r.quarantine_reason, rows: 0, impressions: 0 };
      e.rows++; e.impressions += r.impressions || 0; q.set(r.ad_name, e);
    } else if (r.name.ok && r.name.warnings.length) nameWarn.set(r.ad_name, r.name.warnings);
    const ak = `${r.ad_name}|${r.campaign}|${r.ad_set}`;
    if (!seenAud.has(ak)) { seenAud.add(ak); aud[r.audience].ads++; }
    aud[r.audience].impressions += r.impressions || 0;
  }
  return {
    platform, columns, rows,
    quarantine: [...q.values()].sort((a, b) => b.impressions - a.impressions),
    skipped, warnings,
    name_warnings: [...nameWarn.entries()].map(([ad_name, w]) => ({ ad_name, warnings: w })),
    audience_counts: aud,
    quotes_available: !!col.quotes,
    enrollments_available: !!col.enrollments,
  };
}
