-- 015: Copy Studio (VOICES v2 build 1). Everything the Studio saves: rules
-- versions, territory edits, briefs, runs and their lines, line embeddings,
-- the decision history, taste examples, blind compares, spend, and the
-- Ready for production records (sign-offs, line versions, expectations).
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
  dropped     JSONB NOT NULL DEFAULT '[]'::jsonb,
  rules_version TEXT                          -- the rules version its lines were last checked under
);
ALTER TABLE studio_batches ADD COLUMN IF NOT EXISTS rules_version TEXT;
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

-- Files the hosted Studio serves (the persona readout, its deck, the client logo).
CREATE TABLE IF NOT EXISTS studio_assets (
  name          TEXT PRIMARY KEY,                -- e.g. doc:readout, doc:readout-deck, brand:client-logo
  content_type  TEXT NOT NULL,
  data          BYTEA NOT NULL,
  filename      TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ready for production. Sign-offs, line versions and expectations are
-- append-only: a signed-off wording is never rewritten; an edit after sign-off
-- is a new version. Overrides of red flags and the compliance status live on
-- the line (studio_lines.body), with every change in studio_edits.
CREATE TABLE IF NOT EXISTS studio_signoffs (
  id          TEXT PRIMARY KEY,
  persona     TEXT NOT NULL,
  territory   TEXT NOT NULL,
  version     INTEGER NOT NULL,                -- per persona × territory
  body        JSONB NOT NULL,                  -- the lines (id, version, stub, field, text, sha256) and the gate record
  ready_by    TEXT NOT NULL,
  ready_at    TIMESTAMPTZ NOT NULL,
  sha256      TEXT NOT NULL,                   -- over the set's line hashes
  UNIQUE (persona, territory, version)
);

CREATE TABLE IF NOT EXISTS studio_line_versions (
  line_id     TEXT NOT NULL,
  batch_id    TEXT NOT NULL,
  version     INTEGER NOT NULL,
  field       TEXT NOT NULL,
  text        TEXT NOT NULL,
  sha256      TEXT NOT NULL,                   -- of field + text
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  signoff_id  TEXT,                            -- set when the version was the one signed off
  PRIMARY KEY (line_id, version)
);

-- Which line(s) the team expects to lead, and why; locked with the sign-off. Read by B4 (expected vs actual).
CREATE TABLE IF NOT EXISTS studio_expectations (
  id          TEXT PRIMARY KEY,
  persona     TEXT NOT NULL,
  territory   TEXT NOT NULL,
  signoff_id  TEXT NOT NULL,
  line_ids    JSONB NOT NULL,
  reason      TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL,
  sha256      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS studio_expectations_pt ON studio_expectations (persona, territory, created_at);
