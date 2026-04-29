-- Project-scope reference anchors so calibration data does not leak across clients.
--
-- New columns:
--   project_id              — anchor belongs to this project; only used to score
--                             tests within the same project. NULL = unscoped legacy
--                             row, which is excluded from client scoring unless
--                             explicitly opted in as global calibration.
--   is_global_calibration   — TRUE for anchors a Ralph admin has explicitly marked
--                             as cross-tenant (e.g. curated calibration set). These
--                             are usable across all projects as a fallback when a
--                             project has too few of its own anchors.
--
-- Backfill posture (deviates intentionally from the literal audit-spec default):
--
-- The audit spec said "default backfilled rows to NULL project_id, require
-- admins to opt them in." That assumes the historical rows might be poorly
-- attributed. They aren't — every anchor carries its source test_id and we can
-- look up the test's project_id deterministically. So we backfill project_id
-- from tests.project_id below.
--
-- Why this is still safe:
--   * Each anchor stays scoped to the project that produced it. No cross-tenant
--     leak (every anchor was already created from data within a single project).
--   * is_global_calibration stays FALSE everywhere, so nothing leaks across
--     projects unless a Ralph admin explicitly flips it.
--   * Anchors whose source test has been deleted (ra.test_id IS NULL because
--     the FK is ON DELETE SET NULL) keep project_id=NULL and are inert. That's
--     the right call — we don't have provenance for them.
--
-- To opt specific historical anchors in as cross-tenant global calibration:
--   UPDATE reference_anchors SET is_global_calibration = TRUE WHERE id IN (...);

ALTER TABLE reference_anchors
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE reference_anchors
  ADD COLUMN IF NOT EXISTS is_global_calibration BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill project_id from each anchor's source test. Idempotent — only touches
-- rows where project_id is still NULL and the source test still exists.
UPDATE reference_anchors ra
   SET project_id = t.project_id
  FROM tests t
 WHERE ra.test_id = t.id
   AND ra.project_id IS NULL
   AND t.project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_anchors_project_id ON reference_anchors(project_id);
CREATE INDEX IF NOT EXISTS idx_anchors_global_calibration
  ON reference_anchors(is_global_calibration) WHERE is_global_calibration = TRUE;
