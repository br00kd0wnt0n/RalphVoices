-- 017: Copy Studio Pre-flight (step 6, after Ready for production). Finished
-- assets uploaded per naming stub, their audits (B2's engine), the flags,
-- people's agree/disagree on each flag, and "Ready to traffic" per stub.
-- Additive and idempotent (migrations re-run on every boot). 016 is B3's.
-- Files live in R2 when ENABLE_STUDIO / ENABLE_R2_STORAGE are on (production);
-- studio_upload_files.data is only the local/dev fallback (25 MB per file).

-- One upload = the finished asset for one stub: a static image, carousel cards, or a video.
CREATE TABLE IF NOT EXISTS studio_asset_uploads (
  id           TEXT PRIMARY KEY,
  stub         TEXT NOT NULL,                  -- PERSONA_TERRITORY_FORMAT_v#_PLATFORM, from the sign-off
  persona      TEXT NOT NULL,
  territory    TEXT NOT NULL,
  signoff_id   TEXT,
  kind         TEXT NOT NULL,                  -- static | carousel | video
  uploaded_by  TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS studio_asset_uploads_stub ON studio_asset_uploads (stub, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS studio_upload_files (
  upload_id     TEXT NOT NULL REFERENCES studio_asset_uploads(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,              -- card order for carousels
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size          INTEGER NOT NULL,
  storage       TEXT NOT NULL,                 -- r2 | db
  r2_key        TEXT,                          -- studio/preflight/<stub>/<upload id>/<filename>; never public
  data          BYTEA,                         -- only when storage = 'db' (local/dev)
  role          TEXT NOT NULL DEFAULT 'asset', -- asset | frame (a thumbnail the audit quotes; position 1000+)
  PRIMARY KEY (upload_id, position)
);
ALTER TABLE studio_upload_files ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'asset';

-- One audit of one upload. `result` holds what the report shows: text found on
-- the asset, the transcript, features, the skeptic's objection, cross-persona notes.
CREATE TABLE IF NOT EXISTS studio_audits (
  id             TEXT PRIMARY KEY,
  upload_id      TEXT NOT NULL REFERENCES studio_asset_uploads(id) ON DELETE CASCADE,
  stub           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  engine         TEXT,
  rules_version  TEXT,
  result         JSONB,
  error          TEXT,
  usd            NUMERIC(10, 4) NOT NULL DEFAULT 0,
  started_by     TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS studio_audits_stub ON studio_audits (stub, started_at DESC);

CREATE TABLE IF NOT EXISTS studio_audit_flags (
  id         TEXT PRIMARY KEY,                 -- <audit id>-F01
  audit_id   TEXT NOT NULL REFERENCES studio_audits(id) ON DELETE CASCADE,
  stub       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  rule       TEXT NOT NULL,
  severity   TEXT NOT NULL,                    -- red | amber | grey
  body       JSONB NOT NULL,                   -- label, source, quote, why, where, frame, check, persona
  override   JSONB                             -- a red flag let through: { reason, by, at }
);
CREATE INDEX IF NOT EXISTS studio_audit_flags_audit ON studio_audit_flags (audit_id, position);

-- Agree or disagree with a flag: one row per person per flag (the latest stands), for the agreement rate.
CREATE TABLE IF NOT EXISTS studio_audit_agreements (
  flag_id   TEXT NOT NULL REFERENCES studio_audit_flags(id) ON DELETE CASCADE,
  by_user   TEXT NOT NULL,
  agree     BOOLEAN NOT NULL,
  note      TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (flag_id, by_user)
);

-- "Ready to traffic" per stub, tied to the upload and audit it was given on.
-- A new upload of the stub makes it not ready again. History goes in studio_edits (line_id = 'asset:<stub>').
CREATE TABLE IF NOT EXISTS studio_asset_status (
  stub        TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'open',    -- open | ready
  upload_id   TEXT,
  audit_id    TEXT,
  ready_by    TEXT,
  ready_at    TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
