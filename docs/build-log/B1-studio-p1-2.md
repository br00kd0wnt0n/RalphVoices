# B1 Studio, phases 1–2: storage layer and database (28 Sep 2026)

Branch `voices/b1-studio` (local; not pushed). Plan: `docs/b1-studio-plan.md`. Nothing is hosted yet: phases 3–6 (API in the backend, sign-in, frontend on tools.ralph.world, deploy) are next.

## What shipped

- **Phase 1: one engine, two stores.**
  - The engine moved to `backend/src/services/studio/` (`engine.ts`, `mock.ts`, `claude.ts`), so the backend can host it.
  - Every read and write goes through `StudioStore` (`store.ts`): rules, territory edits, persona seeds and voice samples, briefs, runs and lines, line embeddings, the decision history, taste examples, blind compares and spend.
  - `FileStore` keeps the B1-lite folder layout, so the local Studio and CLI behave exactly as before.
  - Rules and territories load into memory with `refreshRules()`, once per CLI command and once per API request.
  - Decisions are written one line at a time (`saveLine`), and every decision is appended to a history (`recordEdit` and `lineHistory`; for files, `edits.jsonl`).
- **Phase 2: Postgres.**
  - **Migration `015_studio.sql`** (idempotent; run twice locally) adds 11 tables: `studio_rules` (versioned, one active), `studio_inputs`, `studio_territory_edits`, `studio_briefs`, `studio_batches`, `studio_lines` (the full line as jsonb plus decision columns), `studio_line_embeddings` (pgvector), `studio_edits` (append-only), `studio_taste`, `studio_compares` (with the writer key in its own column), `studio_spend`.
  - **`PgStore`** (`pgStore.ts`) implements the interface. A whole-run save (the checker) never rolls back a newer decision on a line. It builds its own pool from an explicit URL and never imports `src/db` (which loads `.env`).
- **CLI:**
  - `--store pg --database-url URL` (or `STUDIO_DATABASE_URL`). `DATABASE_URL` is deliberately ignored, and non-local hosts are refused unless `--allow-remote`, which is reserved for the approved deploy step.
  - `rules-push [--file] [--activate]` uploads a rules version.
  - `db-import [--from DIR] [--with-spend]` copies a studio folder into the database and can be re-run safely. This is the carry-over tool for the first deploy.

## Tested

- **Local database:** Docker `pgvector/pgvector:pg16` as `voices-dev-db` on 127.0.0.1:54329 (`voices_dev`, all migrations 001–015), plus `voices_studio_test` for the tests.
- **Unit tests:** `tests/studio.test.ts` (13, file store) pass. `tests/studioPg.test.ts` (4, Postgres) pass with `STUDIO_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_studio_test`; they cover rules versioning, a run written/continued/decided in the database, a stale whole-run save not rolling back a newer decision, territory edits, a compare whose set never names the writers, and spend. They're skipped when the variable is unset. Full backend suite: 59 tests, 55 pass and 4 skipped without the variable.
- **Real import into `voices_dev`:** 9 runs (148 lines), 124 embeddings, 7 taste examples, 3 compares with keys, 16 spend records, 4 briefs, rules v2.1. Spend matches the files: $1.461.
- **Server on the database:** `serve --store pg` against `voices_dev` loads your runs in order; a decision was saved to the line, recorded in `studio_edits`, then restored.
- **Bug found and fixed by the database tests:** embeddings were saved before their lines, so the database skipped them. Lines are now saved first.

## Also set up (outside the repo)

- **Nightly backup** of `Claude outputs/voices-r1/studio/`: `~/Backups/voices-studio/backup.sh`, run by launchd (`~/Library/LaunchAgents/world.ralph.voices-studio-backup.plist`) at 02:00, or on the next wake if the Mac was asleep. It writes a dated zip and keeps the newest 14; the log is `backup.log`. Tested once (2.7 MB, 68 files). This Mac has no Google Drive for desktop, iCloud Drive or Time Machine; once Drive for desktop is installed, set `VOICES_BACKUP_DEST` or edit `DEST` in the script to its folder.
- **Docker Desktop** now runs `voices-dev-db` with `--restart unless-stopped`. Starting Docker also starts two containers from another project (`ralph-trends-db`, `ralph-trends-cache`), which were left alone.

## What phases 3–6 need to know

- Mount the Studio routes in the backend (`/api/studio`) with `authMiddleware`, `STUDIO_EMAILS` and `new PgStore(pool)`, using the app's pool. The `serve` handlers in `scripts/studio.ts` are the template.
- **Reference documents and the client logo** (`referenceDocs`, `brandAssetPath`) are still read from local files. The hosted Studio needs them in storage too, for example `studio_inputs` for the readout Markdown and R2 or bytea for the .pptx and logo.
- **Jobs:** generation still runs in-process with in-memory SSE. The hosted Studio should record job state on the run (`status` on `studio_batches`) so a refresh or redeploy can resume.
- **First deploy carry-over:** `db-import --with-spend --store pg --database-url <prod> --allow-remote` from the studio folder, run with Brook's go-ahead.
