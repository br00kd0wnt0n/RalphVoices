-- B3 (VOICES v2): live ad performance for the weekly read.
-- live_ingests: one row per file ingested (re-ingesting the same file updates it).
-- live_ads: one row per ad (platform + ad name + campaign + ad set), with the
--   parsed naming convention, audience, and features joined from a Studio
--   shortlist or audit export by naming stub (text, not a foreign key: Studio's
--   tables are truncated in its tests). Names that don't parse are kept with
--   parse_status 'quarantined' and a reason, never dropped.
-- live_metrics: one row per ad per reporting period (a day, or a longer period
--   when the export isn't broken down by day).
-- live_reads: the per-ad result of each weekly read; view live_latest_reads gives
--   the latest read per naming stub (for the Studio Live tab, B3b).
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
  visual TEXT,
  copy_line INTEGER,
  region TEXT,
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
-- Region and visual letter (naming update, 29 Sep): for local databases made before they were added.
ALTER TABLE live_ads ADD COLUMN IF NOT EXISTS visual TEXT;
ALTER TABLE live_ads ADD COLUMN IF NOT EXISTS copy_line INTEGER;
ALTER TABLE live_ads ADD COLUMN IF NOT EXISTS region TEXT;
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

-- live_reads: the per-ad result of each weekly read (written by `weekly.ts note`),
-- so the latest read for a naming stub is one query (view live_latest_reads).
-- The headline call and the metric it rests on are columns; every metric's detail
-- is in `metrics`. Re-running a week's note replaces that week's rows.
CREATE TABLE IF NOT EXISTS live_reads (
  id SERIAL PRIMARY KEY,
  ad_id INTEGER NOT NULL REFERENCES live_ads(id) ON DELETE CASCADE,
  stub TEXT NOT NULL,
  persona TEXT,
  region TEXT,
  name_platform TEXT,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  since DATE NOT NULL,
  config_version INTEGER NOT NULL,
  impressions BIGINT,
  live_now BOOLEAN,
  call TEXT NOT NULL CHECK (call IN ('scale', 'scale (tied)', 'cut', 'keep testing', 'too early to call')),
  call_metric TEXT,
  reason TEXT,
  rate NUMERIC,
  range_lo NUMERIC,
  range_hi NUMERIC,
  p_best NUMERIC,
  p_worse_than_median NUMERIC,
  tied_with JSONB NOT NULL DEFAULT '[]'::jsonb,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ad_id, week_end, since)
);
ALTER TABLE live_reads ADD COLUMN IF NOT EXISTS region TEXT;
CREATE INDEX IF NOT EXISTS idx_live_reads_stub ON live_reads (stub, week_end DESC);

CREATE OR REPLACE VIEW live_latest_reads AS
  SELECT DISTINCT ON (stub) *
    FROM live_reads
   ORDER BY stub, week_end DESC, read_at DESC, impressions DESC NULLS LAST;
