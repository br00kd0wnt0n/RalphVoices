-- Persistent test progress so a backend restart doesn't lose in-flight state.
-- Phase 1: track progress + sweep stale rows on boot. Phase 2 (resume) lives
-- on top of this table once we decide on retry semantics.

CREATE TABLE IF NOT EXISTS test_progress (
  test_id UUID PRIMARY KEY REFERENCES tests(id) ON DELETE CASCADE,
  completed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'running',
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_test_progress_status ON test_progress(status);
CREATE INDEX IF NOT EXISTS idx_test_progress_last_updated ON test_progress(last_updated);
