# Changelog

All notable changes to Ralph Voices are documented here.

## Unreleased

- Scope `reference_anchors` to `project_id` (migration 005) so calibration data no longer leaks across clients; opt-in `is_global_calibration` flag for curated cross-tenant baselines.
- `computeDisposition` now filters anchors by the test's project plus global-calibration rows; legacy unscoped anchors are excluded from client scoring by default.
- `seedAnchorsFromHistory` records `project_id` on every new anchor so future calibration is always tenant-scoped.
- Demo-mode auth bypass is now opt-in via `ENABLE_DEMO_MODE=true`; missing-auth requests return 401 by default and a clear warning is logged on boot when demo mode is on.
- Server refuses to boot when `JWT_SECRET` is missing or set to the dev default; `NODE_ENV=development` + `ALLOW_INSECURE_JWT=true` re-enables the dev fallback explicitly.
- GWI Spark integration is dormant by default; every public method short-circuits unless `ENABLE_GWI=true` is set and a valid `GWI_API_KEY` is present. `/api/gwi/status` returns `integration_enabled` and `reason` so the frontend can show "GWI enrichment unavailable" instead of empty fields.
- Boot now logs GWI integration status (`enabled`/`disabled`) in Railway logs.
- `DELETE /api/tests/:id` now also removes derived `reference_anchors` and clears in-memory progress; frontend test results page exposes a "Delete" button with a confirmation dialog naming what will be deleted.
- Optional retention policy: setting `TEST_RETENTION_DAYS` archives completed tests older than N days and nulls their `options.assets`. Runs at boot and daily; unset = no expiry.
- Cloudflare R2 storage path for uploaded assets, gated by `ENABLE_R2_STORAGE=true`. Uploads route image/PDF buffers to R2 and return a `url`; AI vision calls fetch via `url` instead of inlining base64. Existing deployments are unaffected (default off).
- One-time migration script `backend/scripts/migrate-assets-to-r2.ts` walks `tests.options.assets`, uploads inline base64 payloads to R2, and rewrites JSONB to URLs. Idempotent; supports `--dry-run`.
- New dependency: `@aws-sdk/client-s3` (R2 is S3-compatible; no first-party Cloudflare SDK exists for this use case).
- `.env.example` rewritten to document every safety/feature flag (`ENABLE_DEMO_MODE`, `ENABLE_GWI`, `ENABLE_R2_STORAGE`, `TEST_RETENTION_DAYS`, `ALLOW_INSECURE_JWT`).
- New `test_progress` table (migration 006) mirrors in-memory progress so backend restarts no longer lose in-flight state. On boot, tests stuck in `running` with no recent heartbeat (>5 min) are marked failed.
- README rewritten end-to-end: correct demo creds (`demo@ralph.world` / `demo123`), full endpoint list including `/uploads`, `/gwi`, `/anchors`, `POST /tests/:id/chat`, `GET /tests/:id/recommendations` (with caching note), `GET /tests/:id/export`. New "Safety flags" and "Data handling" sections document training posture, third-party data flows, and deletion/retention.
- CLAUDE.md updated to reflect opt-in demo mode and dormant GWI integration.
- "Relies on OpenAI workspace policy" comments added above every OpenAI client construction (`ai.ts`, `embeddings.ts`, `gwi.ts`); README "Data handling" section documents the posture honestly without claiming zero-retention is configured.
- Boot now awaits migrations before the retention pass and stale-test sweep so the sweep no longer races against migration 006 creating `test_progress`.
- Migration 005 now backfills `reference_anchors.project_id` from each anchor's source test in the same migration step. Each historical anchor stays scoped to the project that produced it (no cross-tenant leak); orphaned anchors whose source test was deleted remain NULL and inert. Documented why this deviates from the spec's literal "NULL by default" instruction.
