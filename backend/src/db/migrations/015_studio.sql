-- 015: Copy Studio (VOICES v2 build 1). Everything the Studio saves: rules
-- versions, territory edits, briefs, runs and their lines, line embeddings,
-- the decision history, taste examples, blind compares and spend.
-- Idempotent: every statement is IF NOT EXISTS, because migrations re-run on
-- every boot. Lines keep their full engine shape in `body` (jsonb) plus the
-- columns the app filters on, so the engine's Line type needs no mapping.

CREATE TABLE IF NOT EXISTS studio_rules (
  version     TEXT PRIMARY KEY,
  body        JSONB NOT NULL,                 -- the studio-rules.json shape
  status      TEXT NOT NULL DEFAULT 'draft',  -- draft | active | retired
  notes       TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- At most one active rules version.
CREATE UNIQUE INDEX IF NOT EXISTS studio_rules_one_active ON studio_rules ((status)) WHERE status = 'active';

-- Named inputs the engine reads: 'personas' (seed), 'voices' (lived voice samples).
CREATE TABLE IF NOT EXISTS studio_inputs (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Territory edits layered over the pitch territories in the active rules (history inside body).
CREATE TABLE IF NOT EXISTS studio_territory_edits (
  code        TEXT PRIMARY KEY,
  body        JSONB NOT NULL,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studio_briefs (
  name        TEXT PRIMARY KEY,
  body        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studio_batches (
  id          TEXT PRIMARY KEY,
  brief       JSONB NOT NULL,
  persona     TEXT NOT NULL,
  territory   TEXT NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stats       JSONB NOT NULL DEFAULT '{}'::jsonb,
  dropped     JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS studio_batches_created_by ON studio_batches (created_by);
CREATE INDEX IF NOT EXISTS studio_batches_updated ON studio_batches (updated_at DESC);

CREATE TABLE IF NOT EXISTS studio_lines (
  id          TEXT PRIMARY KEY,
  batch_id    TEXT NOT NULL REFERENCES studio_batches(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  body        JSONB NOT NULL,                 -- the engine's Line
  model       TEXT,                           -- 'human' for the creative director's own lines
  decision    TEXT,                           -- '' | keep | cut | edit
  decided_by  TEXT,
  decided_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS studio_lines_batch ON studio_lines (batch_id, position);
CREATE INDEX IF NOT EXISTS studio_lines_decision ON studio_lines (decision) WHERE decision IN ('keep', 'edit');

-- Line embeddings for near-duplicate checks (pgvector; no fixed dimension so the mock's short vectors fit too).
CREATE TABLE IF NOT EXISTS studio_line_embeddings (
  line_id     TEXT PRIMARY KEY REFERENCES studio_lines(id) ON DELETE CASCADE,
  batch_id    TEXT NOT NULL,
  embedding   vector NOT NULL
);
CREATE INDEX IF NOT EXISTS studio_line_embeddings_batch ON studio_line_embeddings (batch_id);

-- Every decision, append-only: who changed what, when.
CREATE TABLE IF NOT EXISTS studio_edits (
  id          BIGSERIAL PRIMARY KEY,
  line_id     TEXT NOT NULL,
  batch_id    TEXT NOT NULL,
  before      JSONB,
  after       JSONB,
  by_user     TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS studio_edits_line ON studio_edits (line_id, at);

-- Taste examples (kept, edited, cut-with-note lines) for the writer prompt.
CREATE TABLE IF NOT EXISTS studio_taste (
  line_id     TEXT PRIMARY KEY,
  persona     TEXT NOT NULL,
  body        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Blind compares. The writer key is kept apart from the set and only read on reveal.
CREATE TABLE IF NOT EXISTS studio_compares (
  name        TEXT PRIMARY KEY,
  body        JSONB NOT NULL,
  key_labels  JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studio_spend (
  id          BIGSERIAL PRIMARY KEY,
  label       TEXT NOT NULL,
  usd         NUMERIC(10, 4) NOT NULL,
  by_stage    JSONB,
  calls       JSONB,
  by_user     TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
