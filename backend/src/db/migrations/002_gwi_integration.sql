-- GWI Spark Integration Migration
-- Adds settings table and GWI data columns to existing tables

-- Settings table for API keys and runtime config
CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  key VARCHAR(255) NOT NULL,
  value TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, key)
);

-- GWI data on existing tables
ALTER TABLE tests ADD COLUMN IF NOT EXISTS gwi_insights JSONB;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS gwi_audience_data JSONB;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS gwi_enrichment JSONB;

-- Index for settings lookup
CREATE INDEX IF NOT EXISTS idx_settings_user_key ON settings(user_id, key);
