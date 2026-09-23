-- Freeze persona panels so regenerating variants can never erase test history.
--
-- Before this migration, POST /personas/:id/variants ran
--   DELETE FROM persona_variants WHERE persona_id = $1
-- and test_responses.variant_id is ON DELETE CASCADE, so refreshing a panel
-- silently deleted every earlier response scored by that panel.
--
-- Now: variants that have responses are soft-retired (retired_at set) and kept;
-- only variants with no responses are hard-deleted. Each regeneration bumps
-- panel_version so a test can record which panel it ran against.
--
-- Backfill: none. Every existing variant is active at panel_version 1.

ALTER TABLE persona_variants ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
ALTER TABLE persona_variants ADD COLUMN IF NOT EXISTS panel_version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_variants_active
  ON persona_variants(persona_id) WHERE retired_at IS NULL;
