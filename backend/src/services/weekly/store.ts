// B3: live_ingests / live_ads / live_metrics (migration 016). Takes its own pg
// Pool: never import db/index.ts here, because it calls dotenv.config() and
// backend/.env points at production.
import type { Pool, PoolClient } from 'pg';
import type { ExportResult, FeatureMap } from './ingest.js';
import { COUNT_FIELDS } from './ingest.js';
import type { MetricRow } from './window.js';

export interface SaveResult { ingest_id: number; ads_inserted: number; ads_updated: number; metrics_inserted: number; metrics_updated: number; replaced_ingest: boolean }

export async function saveExport(pool: Pool, file: { name: string; sha256: string }, res: ExportResult, configVersion: number): Promise<SaveResult> {
  const c: PoolClient = await pool.connect();
  try {
    await c.query('BEGIN');
    const dates = res.rows.flatMap(r => [r.period_start, r.period_end]).sort();
    const ing = await c.query(
      `INSERT INTO live_ingests (file_name, file_sha256, source_platform, rows_read, rows_stored, period_start, period_end, column_map, missing_columns, unmapped_headers, quarantined, skipped, warnings, config_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (file_sha256, source_platform) DO UPDATE SET file_name = EXCLUDED.file_name, rows_read = EXCLUDED.rows_read, rows_stored = EXCLUDED.rows_stored,
         period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end, column_map = EXCLUDED.column_map, missing_columns = EXCLUDED.missing_columns,
         unmapped_headers = EXCLUDED.unmapped_headers, quarantined = EXCLUDED.quarantined, skipped = EXCLUDED.skipped, warnings = EXCLUDED.warnings,
         config_version = EXCLUDED.config_version, ingested_at = NOW()
       RETURNING id, (xmax = 0) AS inserted`,
      [file.name, file.sha256, res.platform, res.rows.length + res.skipped.length, res.rows.length, dates[0] || null, dates[dates.length - 1] || null,
        JSON.stringify(res.columns.mapped), JSON.stringify(res.columns.missing), JSON.stringify(res.columns.unmapped_headers), JSON.stringify(res.quarantine),
        JSON.stringify(res.skipped), JSON.stringify(res.warnings), configVersion]);
    const ingestId: number = ing.rows[0].id;
    const out: SaveResult = { ingest_id: ingestId, ads_inserted: 0, ads_updated: 0, metrics_inserted: 0, metrics_updated: 0, replaced_ingest: !ing.rows[0].inserted };
    const adIds = new Map<string, number>();
    for (const r of res.rows) {
      const k = `${r.ad_name}\u0001${r.campaign}\u0001${r.ad_set}`;
      let id = adIds.get(k);
      if (id === undefined) {
        const n = r.name;
        const a = await c.query(
          `INSERT INTO live_ads (source_platform, ad_name, campaign_name, ad_set_name, external_ad_id, parse_status, parse_error, name_warnings, stub, asset, persona, territory, format, version, name_platform, delivered_on, name_suffix, audience, features, features_source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           ON CONFLICT (source_platform, ad_name, campaign_name, ad_set_name) DO UPDATE SET
             external_ad_id = COALESCE(EXCLUDED.external_ad_id, live_ads.external_ad_id), parse_status = EXCLUDED.parse_status, parse_error = EXCLUDED.parse_error,
             name_warnings = EXCLUDED.name_warnings, stub = EXCLUDED.stub, asset = EXCLUDED.asset, persona = EXCLUDED.persona, territory = EXCLUDED.territory,
             format = EXCLUDED.format, version = EXCLUDED.version, name_platform = EXCLUDED.name_platform, delivered_on = EXCLUDED.delivered_on,
             name_suffix = EXCLUDED.name_suffix, audience = EXCLUDED.audience,
             features = COALESCE(EXCLUDED.features, live_ads.features), features_source = COALESCE(EXCLUDED.features_source, live_ads.features_source), updated_at = NOW()
           RETURNING id, (xmax = 0) AS inserted`,
          [r.source_platform, r.ad_name, r.campaign, r.ad_set, r.ad_id, r.quarantine_reason ? 'quarantined' : 'ok', r.quarantine_reason, JSON.stringify(n.ok ? n.warnings : []),
            n.ok ? n.stub : null, n.ok ? n.asset : null, n.ok ? n.persona : null, n.ok ? n.territory : null, n.ok ? n.format : null, n.ok ? n.version : null,
            n.ok ? n.platform : null, n.ok ? n.date : null, n.ok && n.suffix.length ? n.suffix.join('_') : null, r.audience,
            r.features ? JSON.stringify(r.features) : null, r.features_source]);
        id = a.rows[0].id as number;
        adIds.set(k, id);
        if (a.rows[0].inserted) out.ads_inserted++; else out.ads_updated++;
      }
      const vals = COUNT_FIELDS.map(f => r[f]);
      const m = await c.query(
        `INSERT INTO live_metrics (ad_id, period_start, period_end, ${COUNT_FIELDS.join(', ')}, ingest_id)
         VALUES ($1,$2,$3,${COUNT_FIELDS.map((_, i) => `$${i + 4}`).join(',')},$${COUNT_FIELDS.length + 4})
         ON CONFLICT (ad_id, period_start, period_end) DO UPDATE SET ${COUNT_FIELDS.map(f => `${f} = EXCLUDED.${f}`).join(', ')}, ingest_id = EXCLUDED.ingest_id, updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [id, r.period_start, r.period_end, ...vals, ingestId]);
      if (m.rows[0].inserted) out.metrics_inserted++; else out.metrics_updated++;
    }
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

// Refresh features on stored ads from a Studio shortlist or audit export, by stub.
export async function updateFeatures(pool: Pool, map: FeatureMap): Promise<{ updated: number; stubs_without_ads: string[] }> {
  let updated = 0;
  const missing: string[] = [];
  for (const [stub, f] of map) {
    const r = await pool.query('UPDATE live_ads SET features = $2, features_source = $3, updated_at = NOW() WHERE stub = $1', [stub, JSON.stringify(f.features), f.source]);
    if (r.rowCount) updated += r.rowCount; else missing.push(stub);
  }
  return { updated, stubs_without_ads: missing };
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (d: unknown) => (d instanceof Date ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10) : String(d).slice(0, 10));

export async function loadRows(pool: Pool, to?: string): Promise<MetricRow[]> {
  const r = await pool.query(
    `SELECT a.id, a.source_platform, a.ad_name, a.campaign_name, a.ad_set_name, a.parse_status, a.parse_error, a.stub, a.asset, a.persona, a.territory, a.format, a.version,
            a.name_platform, a.audience, a.features, m.period_start, m.period_end, ${COUNT_FIELDS.map(f => `m.${f}`).join(', ')}
       FROM live_metrics m JOIN live_ads a ON a.id = m.ad_id
      ${to ? 'WHERE m.period_end <= $1' : ''}
      ORDER BY a.id, m.period_start`, to ? [to] : []);
  return r.rows.map(x => ({
    key: `${x.source_platform}|${x.ad_name}|${x.campaign_name}|${x.ad_set_name}`,
    ad_name: x.ad_name, audience: x.audience,
    parsed: x.parse_status === 'ok' ? { stub: x.stub, asset: x.asset, persona: x.persona, territory: x.territory, format: x.format, platform: x.name_platform, version: x.version } : null,
    quarantine_reason: x.parse_status === 'ok' ? null : x.parse_error || 'name did not parse',
    features: Array.isArray(x.features) ? x.features : null,
    period_start: iso(x.period_start), period_end: iso(x.period_end),
    spend: num(x.spend), impressions: num(x.impressions), video_3s: num(x.video_3s), link_clicks: num(x.link_clicks),
    landing_page_views: num(x.landing_page_views), quotes: num(x.quotes), enrollments: num(x.enrollments),
  }));
}

export async function ingestSources(pool: Pool, from: string, to: string): Promise<string[]> {
  const r = await pool.query(`SELECT file_name, source_platform, ingested_at FROM live_ingests WHERE period_end >= $1 AND period_start <= $2 ORDER BY ingested_at`, [from, to]);
  return r.rows.map(x => `${x.file_name} (${x.source_platform})`);
}
