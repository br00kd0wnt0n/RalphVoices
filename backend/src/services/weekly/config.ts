// B3 weekly read: the config (backend/config/weekly-read.json) and its types.
// Thresholds live in the JSON so they are written down before any data arrives;
// this module only loads and checks them.
import fs from 'node:fs';
import path from 'node:path';

export type MetricKey = 'hook_rate' | 'link_ctr' | 'quotes_per_1k';
export const METRIC_KEYS: MetricKey[] = ['hook_rate', 'link_ctr', 'quotes_per_1k'];

export type Field =
  | 'ad_name' | 'ad_id' | 'campaign' | 'ad_set' | 'day' | 'period_start' | 'period_end'
  | 'spend' | 'impressions' | 'reach' | 'frequency' | 'video_3s' | 'thruplays'
  | 'link_clicks' | 'landing_page_views' | 'quotes' | 'enrollments';
export type ColumnMap = Partial<Record<Field, string[]>>;
export type SourcePlatform = 'meta' | 'tiktok';

export interface MetricDef {
  label: string;
  events: 'video_3s' | 'link_clicks' | 'quotes';
  per: 'impressions';
  video_only?: boolean;
  min_impressions: number;
  scale: 'pct' | 'per1k';
}

export interface WeeklyConfig {
  version: number;
  naming: {
    personas: string[];
    formats: Record<string, string[]>;
    platforms: Record<string, string[]>;
    video_formats: string[];
    territories: string[];
  };
  audience: {
    retargeting_pattern: string;
    prospecting_pattern: string;
    match_on: Array<'campaign' | 'ad_set'>;
    default: 'prospecting' | 'retargeting' | 'unknown';
  };
  columns: Record<SourcePlatform, ColumnMap>;
  model: {
    interval: number;
    mc_draws: number;
    seed: number;
    between_ad_cv: { default: number; min: number; max: number; min_ads_to_estimate: number };
    group_prior_ads: number;
    pool_by: string[];
    cell_by: string[];
  };
  metrics: Record<MetricKey, MetricDef>;
  calls: {
    primary_metric: MetricKey;
    fallback_metric: MetricKey | null;
    fallback_can_scale: boolean;
    fallback_can_cut: boolean;
    min_days_live: number;
    min_ads_in_cell: number;
    p_best_scale: number;
    max_tied_scale: number;
    p_beat_median_tied_scale: number;
    p_worse_than_median_cut: number;
    tie_bar: number;
    hold: { p_best_scale: number; p_beat_median_tied_scale: number; p_worse_than_median_cut: number; tie_bar: number };
  };
  features: {
    min_ads_with: number;
    min_ads_without: number;
    strata: string[];
    include_tags: string[];
    persona_min_ads_with: number;
    min_residual_df: number;
  };
  cost_benchmarks: { cost_per_quote: number | null };
  report: { min_enrollments_for_cpe: number };
  wording: { banned: string[]; internal_terms: string[] };
}

export const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../../config/weekly-read.json');

export function loadConfig(p = DEFAULT_CONFIG_PATH): WeeklyConfig {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return checkConfig(raw);
}

// Light structural checks: a typo in a threshold should fail loudly, not read as undefined.
export function checkConfig(c: any): WeeklyConfig {
  const need = (cond: unknown, what: string) => { if (!cond) throw new Error(`weekly-read config: ${what}`); };
  need(Number.isInteger(c.version), 'version must be an integer');
  need(Array.isArray(c.naming?.personas) && c.naming.personas.length, 'naming.personas');
  need(c.naming?.formats && c.naming?.platforms, 'naming.formats and naming.platforms');
  need(c.columns?.meta?.ad_name?.length && c.columns?.meta?.impressions?.length, 'columns.meta needs ad_name and impressions');
  for (const k of METRIC_KEYS) need(c.metrics?.[k]?.min_impressions > 0, `metrics.${k}.min_impressions`);
  const p01 = (v: unknown) => typeof v === 'number' && v > 0 && v < 1;
  need(p01(c.model?.interval), 'model.interval in (0,1)');
  need(p01(c.calls?.p_best_scale) && p01(c.calls?.p_worse_than_median_cut) && p01(c.calls?.p_beat_median_tied_scale), 'calls probabilities in (0,1)');
  need(METRIC_KEYS.includes(c.calls?.primary_metric), 'calls.primary_metric');
  const h = c.calls?.hold;
  need(h && p01(h.p_best_scale) && p01(h.p_beat_median_tied_scale) && p01(h.p_worse_than_median_cut) && p01(h.tie_bar) && p01(c.calls.tie_bar) && c.calls.tie_bar > 0.5 && h.tie_bar > 0.5, 'calls.hold and tie bars in (0.5,1)');
  need(h.p_best_scale <= c.calls.p_best_scale && h.p_beat_median_tied_scale <= c.calls.p_beat_median_tied_scale && h.p_worse_than_median_cut <= c.calls.p_worse_than_median_cut && h.tie_bar <= c.calls.tie_bar, 'calls.hold bars must not be above the bars to start a call');
  need(c.model?.mc_draws >= 500, 'model.mc_draws >= 500');
  need(Number.isInteger(c.features?.min_residual_df) && c.features.min_residual_df >= 1, 'features.min_residual_df');
  new RegExp(c.audience.retargeting_pattern, 'i');
  new RegExp(c.audience.prospecting_pattern, 'i');
  return c as WeeklyConfig;
}
