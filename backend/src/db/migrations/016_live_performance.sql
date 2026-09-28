-- B3 (VOICES v2): live ad performance for the weekly read.
-- live_ingests: one row per file ingested (re-ingesting the same file updates it).
-- live_ads: one row per ad (platform + ad name + campaign + ad set), with the
--   parsed naming convention, audience, and features joined from a Studio
--   shortlist or audit export by naming stub (text, not a foreign key: Studio's
--   tables are truncated in its tests). Names that don't parse are kept with
--   parse_status 'quarantined' and a reason, never dropped.
-- live_metrics: one row per ad per reporting period (a day, or a longer period
--   when the export isn't broken down by day).
-- Additive and idempotent. Nothing else reads these tables yet.

CREATE TABLE IF NOT EXISTS live_ingests (
  id SERIAL PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  source_platform TEXT NOT NULL CHECK (source_platform IN ('meta', 'tiktok')),
  rows_read INTEGER NOT NULL DEFAULT 0,
  rows_stored INTEGER NOT NULL DEFAULT 0,
  period_start DATE,
  period_end DATE,
  column_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  unmapped_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
  quarantined JSONB NOT NULL DEFAULT '[]'::jsonb,
  skipped JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  config_version INTEGER,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (file_sha256, source_platform)
);

CREATE TABLE IF NOT EXISTS live_ads (
  id SERIAL PRIMARY KEY,
  source_platform TEXT NOT NULL CHECK (source_platform IN ('meta', 'tiktok')),
  ad_name TEXT NOT NULL,
  campaign_name TEXT NOT NULL DEFAULT '',
  ad_set_name TEXT NOT NULL DEFAULT '',
  external_ad_id TEXT,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('ok', 'quarantined')),
  parse_error TEXT,
  name_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  stub TEXT,
  asset TEXT,
  persona TEXT,
  territory TEXT,
  format TEXT,
  version INTEGER,
  name_platform TEXT,
  delivered_on DATE,
  name_suffix TEXT,
  audience TEXT NOT NULL CHECK (audience IN ('prospecting', 'retargeting', 'unknown')),
  features JSONB,
  features_source TEXT,
  asset_link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_platform, ad_name, campaign_name, ad_set_name)
);
CREATE INDEX IF NOT EXISTS idx_live_ads_stub ON live_ads (stub);
CREATE INDEX IF NOT EXISTS idx_live_ads_persona ON live_ads (persona, name_platform);

CREATE TABLE IF NOT EXISTS live_metrics (
  id SERIAL PRIMARY KEY,
  ad_id INTEGER NOT NULL REFERENCES live_ads(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  spend NUMERIC,
  impressions BIGINT,
  reach BIGINT,
  frequency NUMERIC,
  video_3s BIGINT,
  thruplays BIGINT,
  link_clicks BIGINT,
  landing_page_views BIGINT,
  quotes NUMERIC,
  enrollments NUMERIC,
  ingest_id INTEGER REFERENCES live_ingests(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ad_id, period_start, period_end),
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_live_metrics_period ON live_metrics (period_start, period_end);
