# B1 Studio, phase 3: `/api/studio` in the backend (28 Sep 2026)

Branch `voices/b1-studio` (PR #11 is on hold until the phase 6 deploy with Brook). Plan: `docs/b1-studio-plan.md`. The routes are **off unless `ENABLE_STUDIO=true`**, so merging this would not switch the Studio on. Merging would still run migration 015 in production, which is why the PR is held.

## What shipped

- **One router, two hosts.** `backend/src/services/studio/router.ts` (`createStudioRouter`) holds every Studio endpoint. The local `studio.ts serve` and the hosted `routes/studio.ts` both mount it and differ only in the options they pass: who the user is, how each job gets an `Api`, the spend limit, and admin checks. The router imports nothing from `src/db`, so the CLI still never opens the app's database connection.
- **Hosted routes** (`backend/src/routes/studio.ts`), mounted at `/api/studio` in `src/index.ts` when `ENABLE_STUDIO=true`:
  - `authMiddleware` (the usual Narrativ SSO sign-in), then the allowlist in `utils/studioAccess.ts`: `STUDIO_EMAILS` or `ADMIN_EMAILS`, case-insensitive. It fails closed, so if both are unset nobody gets in. Anyone else who is signed in gets 403 `studio_not_enabled`.
  - Identity comes from the signed-in user's email, not the `X-Studio-User` header. It is recorded on runs, decisions, the edit history, territory edits and spend.
  - `new PgStore(pool)` on the app's pool.
  - `/meta` returns `user {email, name, admin}` and never the local folder path.
- **Monthly budget.** `Api` takes `capWindow: 'month'`. The hosted Studio counts spend since the 1st (UTC) against `STUDIO_MONTHLY_CAP_USD` (default $50); the ask-first threshold is `STUDIO_ASK_OVER_USD` (default $2). The local CLI keeps its cumulative $15 cap.
- **One `Api` per job, sharing one pacer**, so concurrent jobs share the OpenAI rate limit. A job that hits the cap stops only itself. Spend is recorded against the person who ran it.
- **Resume.** `resumeChecks(batchId)` checks only the lines a run left unchecked, for example after a restart or redeploy (`POST /batches/:id/resume`). The runs list reports `unchecked`. On the page, an interrupted run shows "n unchecked" and a **Resume** button in place of Continue. A job stream the server no longer has now says to reopen the run and resume it.
- **Rules versions (hosted only):**
  - `GET /rules` lists them.
  - `POST /rules` `{version, rules, notes?, activate?}` is admin-only. It checks the required top-level keys, and versions are never overwritten.
  - `POST /rules/:version/activate` is admin-only and retires the previous active version (`PgStore.activateRules`, in one transaction).
  - Each run records `rules_version`, the rules its lines were last checked under (a new column on `studio_batches`; 015 adds it idempotently).
- **Reference documents and the client logo come from the store.** The engine asks for `doc:readout`, `doc:readout-deck` and `brand:client-logo`. `FileStore` maps them to the local files (`localAssets()`), and `PgStore` reads `studio_assets`. `db-import` now uploads the three assets. Only listed names are served.
- `GET /lines/:id/history` returns a line's decision history (for phase 4's attribution view).
- CORS on the main app now allows `PATCH` (decisions use it).

## Tested

- **Backend suite:** 70 tests, all passing with `STUDIO_TEST_DATABASE_URL`.
  - `tests/studioRouter.test.ts` (new, 7 tests) runs a job end to end over real HTTP on the mock client: generate, stream, decide, history, resume and export. It also covers the recovery message for a lost job, the allowlist, and the month boundary.
  - `tests/studioPg.test.ts` adds tests for:
    - the hosted rules endpoints (admin gate, validation, no overwrite, activation)
    - the monthly window
    - assets served from the database
    - the rules version recorded on a run
  - `tests/studio.test.ts` adds resume and asset-name tests.
- **Type checks:** clean on backend `src`, the scripts and tests, and the frontend (the only errors are the known pdf-parse/rcb-client ones).
- **Migration 015** run twice more on `voices_dev` and `voices_studio_test`.
- **The real backend, locally.** `src/index.ts` ran on `voices_dev` with `ENABLE_STUDIO=true`, `STUDIO_EMAILS=nick.larson@ralph.world` and `ADMIN_EMAILS=brook@ralph.world`, using local test accounts:
  - no token: 401
  - a signed-in user not on the list: 403
  - Nick: `/meta` from Postgres, with a $50 monthly budget and $1.46 spent this month
  - runs listed
  - readout, deck and logo served from `studio_assets`
  - rules upload refused (403) because Nick isn't an admin
- **Resume in the browser:** on the mock server, a run with 4 unchecked lines showed "4 unchecked · Resume". Resume checked all 4 (flags and skeptic objections) and the run showed "4 of 4 checked".

## Left for phase 4 (frontend)

- `studioApi.ts` on the hosted build: the app's base URL and bearer token.
- **Server-sent events and downloads need the token too.** `EventSource` can't send an `Authorization` header, so the page should read the stream with `fetch` and fetch downloads and the logo as blobs. The server deliberately doesn't accept tokens in URLs, because they end up in logs.
- A production `/studio` route and nav item, attribution and history on cards, a rules view, and the iframe check.

## Left for phases 5–6

- `db-import` run filter: carry over only the 28 Sep kickoff runs.
- **Deploy with Brook:**
  - env vars: `ENABLE_STUDIO=true`, `STUDIO_EMAILS`, `ADMIN_EMAILS`, `ANTHROPIC_API_KEY` (a fresh key), `STUDIO_MONTHLY_CAP_USD`
  - migration 015
  - `db-import --allow-remote` with his go-ahead
  - a smoke test
