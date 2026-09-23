# S1: Finish Phase 0

Branch `voices/trupanion-phase0`, on top of `6e72f2a` (panel freeze, calibration opt-out, anchor delete lock) and the docs commits. Session date: 23 Sep 2026.

## What shipped

| # | Item | Where |
|---|---|---|
| 1 | **RalphScore on the server.** `calculateRalphScore` moved into `backend/src/utils/ralphScore.ts` with the maths unchanged (the function body is byte-identical to the old client version; checked with `diff`). `processTestResponses` stores `summary.ralph_score` and `summary.ralph_score_version = 1`. `frontend/src/lib/ralphScore.ts` is an identical mirror; the results page uses `summary.ralph_score ?? calculateRalphScore(summary)`. Live progress still computes locally. | `utils/ralphScore.ts`, `routes/tests.ts`, `TestResults.tsx`, `TestComparison.tsx` |
| 1a | **Fixture test.** 9 real-shaped summaries (typical, multi-persona, skeptical, partial run with dropouts, clamp at 100, floor, empty, rounding near .5, neutral-heavy). Expected values were generated from the original function extracted from git (`fda3131`) before the move. The test also checks backend and frontend agree on 5,000 generated summaries. `cd backend && npm test` → 12/12 pass. | `backend/tests/ralphScore.test.ts`, `backend/tests/fixtures/ralph-score-summaries.json` |
| 1b | **Backfill script.** Fills complete tests with no stored score. Idempotent. `--dry-run` writes nothing. `--recompute` overwrites stored scores (only after a version bump). `--allow-remote` is required for any host other than localhost. | `backend/scripts/backfill-ralph-score.ts` (`npm run backfill:ralph-score`) |
| 2 | **`segments.by_persona`.** Same shape as the other segments (`count`, `avgSentiment`, `avgEngagement`) plus `persona_id`, keyed by persona name. "By Persona" card on the results Dashboard tab, sorted by sentiment. | `calculateSegments` in `routes/tests.ts`, `TestResults.tsx`, `types/index.ts` |
| 3 | **`options.image_detail`** (`low` default \| `high` \| `auto`). Zod-validated on `POST /tests`, stored in `options`, and passed to `image_url.detail` in `generateConceptResponse` (new last parameter, default `'low'`). "High-detail images" checkbox under "Calibration constraints". | `routes/tests.ts`, `services/ai.ts`, `ConceptFirst.tsx` |
| 4 | **"No variants — will be generated" fixed: panels are built on Run, and a failed build blocks the run.** See the decision below. | `ConceptFirst.tsx` (`ensurePanels`), `routes/tests.ts` (`personas_without_panel`) |
| 5 | **Platform defaults** are `DEFAULT_PLATFORMS = ['Facebook', 'Instagram', 'TikTok']` in both constants files. They replace the old list in the personas and tests Zod schemas, `PersonaCard`, `PersonaFirst` (×3) and the new concept-first panel build. Existing personas and panels are untouched: no data migration, and only defaults changed. | `utils/constants.ts` ↔ `lib/constants.ts` |
| 6 | **Dropouts recorded.** A panel member that still throws after `withRetry` is added to `options.dropouts = {count, variant_ids}`. This is written on every run (a clean run stores `count: 0`), including all-failed runs, and cleared when a failed or cancelled test is re-run. The results page shows an amber "n of N panel members responded" banner when `summary.total_responses < responses_total`. | `routes/tests.ts`, `TestResults.tsx` |

Also: Edit & Retry now restores the "Calibration constraints" and "High-detail images" settings from the original test. Before this, a retried test silently reverted to constraints on.

## Decision: item 4, generate on run or block?

**Both, in that order: generate on run, and block if generation fails.** The frontend calls `ensurePanels()` before creating any test:

1. It fetches active panel members for every selected persona (`GET /personas/:id/variants`, which filters `retired_at IS NULL`).
2. For each persona with none, it calls the existing `POST /personas/:id/variants` with `count = variants_per_persona` and the Meta + TikTok platforms. It does this one persona at a time, with a "Building panels" card showing per-persona status.
3. If any build errors or returns 0 members, it stops. It shows "Couldn't build a panel for X (reason). The test hasn't been run…", and **no test record is created**, so there are no orphan drafts.

Why this route and not generating inside `/run` on the server:
- **It reuses the endpoint that is already safe.** Since migration 007, `POST /personas/:id/variants` generates first and then swaps the panel in one transaction. A failure leaves the persona untouched, so there are no half-built panels to clean up.
- **The runner is unchanged** (ground rule 3). Generating inside `/run` would turn a fast "start" endpoint into a multi-minute one, or need a new pre-run job state on the progress socket. That's more moving parts for the same result.
- **Progress is visible for free.** Each build is one request, so the UI knows exactly where it is.
- **Blocking on failure is the honest fallback.** A test run with a persona silently missing is exactly the bug being fixed.

Known limit: `generateVariants` is one OpenAI call with `max_tokens: 4000`. At 50 members that's close to the limit and may come back short. [Likely] The UI shows "43 panel members (of 50 requested)" rather than blocking. This was not tested against the real API; the mock has no token limit.

As a backstop for API callers (e.g. Narrativ handoffs that skip the UI), `POST /tests/:id/run` now returns `personas_without_panel: string[]` and logs a warning. It still skips those personas, as before.

## Deviations from the plan / prompt

- **There is no Segments tab.** `CLAUDE.md` described one, but by-platform and by-attitude live on the Dashboard tab. The By Persona card sits there, in its own row under them. `CLAUDE.md` is corrected.
- **Duplicate persona names in one test.** The prompt says `by_persona` is keyed by name, but two selected personas can share one (project copies). The second one encountered gets a ` (2)` suffix, so they never merge. Which one gets the suffix depends on variant ordering (by `persona_id`), so consumers should key on `persona_id`, not the name.
- **The dropout banner compares `summary.total_responses` with `tests.responses_total`,** not `options.dropouts.count`. They agree for new tests, and this also flags older tests that lost panel members before dropouts were recorded. `options.dropouts` is the durable record (it has the variant ids).
- **Test comparison fix (small, in scope with item 1).** `TestComparison.tsx` had its own "rough" RalphScore that rounded sentiment to one decimal first, so a compared test could show a different score from its own results page. It now uses the stored score, falling back to the shared formula.
- **`image_detail` from the UI is always sent,** so new tests record `low` explicitly. API callers that omit it get no key, and the runner reads that as `low`. The UI exposes low/high only; `auto` is API-only.
- **Terminology.** Every string I added says "panel members". Existing labels such as "Variants per Persona" and "N variants" on persona cards were left alone. A full rename is a separate sweep.

## Migrations and env vars

None new. No migration number was used (S1 had none reserved). No new env vars. `ADMIN_EMAILS` came from the earlier Phase 0 commit.

## How it was tested

All against the local DB below. There's no OpenAI key in this environment, so the backend ran against `backend/scripts/mock-openai.mjs` via `OPENAI_BASE_URL` (deterministic scores, forced failures for names starting "Drop"). Prompt content and score distributions were not exercised; plumbing and persistence were.

- **Type checks:** frontend clean. Backend clean apart from the known `uploads.ts` (pdf-parse) and `rcb-client.ts` errors.
- **Unit:** `cd backend && npm test`, 29/29 pass (12 RalphScore, 12 score parsing, 5 retry).
- **Migrations:** `npm run db:migrate` run twice on a fresh DB. 002–007 apply cleanly both times.
- **API end to end** (four personas: "DINKs with pets" in two projects, "Busy Families" with 2 of 5 members renamed `Drop*`, and "Empty Nesters" with no panel):
  - New panel from default settings: platforms = `Facebook, Instagram, TikTok`.
  - `POST /run` returned `personas_without_panel: [<Empty Nesters id>]`, and the warning was logged.
  - Test 1 (`image_detail: 'high'`): `complete`, `responses_total 13`, `total_responses 11`, `options.dropouts = {count: 2, variant_ids: [2 ids]}`, `summary.ralph_score 41, v1`. `by_persona` had 3 keys, including `"DINKs with pets (2)"`, each with its `persona_id`.
  - The mock log shows every Test 1 call sent `detail: 'high'` (29 calls), and Test 2 (no `image_detail`, `vector_constraints: false`) sent `detail: 'low'` (5 calls). Test 2 stored `dropouts {count: 0}`.
- **Backfill:** removed `ralph_score` from Test 1. `--dry-run` reported "would set … 41 v1" and the DB was unchanged. A real run set 41, matching the value stored at run time. A second run reported "0 updated, 2 already stored". Pointing at `yamabiko.proxy.rlwy.net` without `--allow-remote` refused with exit 1.
- **UI (Playwright, headless Chromium, Vite on :5173 → backend on :3001):**
  - Results page: banner reads "11 of 13 panel members responded."; By Persona card rendered; gauge shows the stored 41. Screenshot: `s01-screens/results-dropouts-by-persona.png`.
  - Step 2 note for a persona with no panel: "No panel yet. 20 panel members will be generated when you run the test." Screenshot: `s01-screens/step2-no-panel-note.png`.
  - Happy path: selected "Empty Nesters" (no panel), checked High-detail images, ran. The panel was built (20 members, Facebook/Instagram/TikTok), and the test completed with `image_detail high`, `dropouts 0`, `ralph_score 54`.
  - Failure path: stopped the mock and ran with a persona with no panel. The progress card showed "Failed", the error blocked the run, and the test count was unchanged (3 → 3). Screenshot: `s01-screens/step3-panel-build-failed.png`.
- **Not done:** the plan's risk-5 regression check (run a known concept before and after Phase 0 against real OpenAI and compare within noise). It needs a real key. Default prompts are unchanged apart from the new `detail` variable, which defaults to the old `'low'`, so I expect no drift [Likely], but this hasn't been measured.

## Local dev database (reuse this in every session)

Ground rule 1: never point anything at Railway. Target: Postgres 16 + pgvector on `127.0.0.1:54329`, database `voices_dev`, user `postgres`, trust auth, so `DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_dev`.

### Cloud Code container (Ubuntu 24.04, run as root): what this session ran

Postgres 16 is preinstalled there; only pgvector was missing. The container is ephemeral, so each new cloud session repeats this (under a minute).

```bash
apt-get install -y postgresql-16-pgvector            # pgvector 0.6.0 from Ubuntu universe
PGBIN=/usr/lib/postgresql/16/bin; DATA=/var/lib/postgresql/voices-dev
mkdir -p $DATA && chown postgres:postgres $DATA
su postgres -c "$PGBIN/initdb -D $DATA -U postgres --auth=trust -E UTF8"
su postgres -c "$PGBIN/pg_ctl -D $DATA -o '-p 54329 -k /tmp' -l $DATA/server.log start"
psql -h 127.0.0.1 -p 54329 -U postgres -c "CREATE DATABASE voices_dev"
psql -h 127.0.0.1 -p 54329 -U postgres -d voices_dev -c "CREATE EXTENSION IF NOT EXISTS vector"
npm install                                           # repo root, if node_modules is missing
cd backend && DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_dev npm run db:migrate
```

### Brook's Mac

**Not run in this session.** The Docker route is the least fiddly; the image ships pgvector:

```bash
docker run -d --name voices-dev-db -p 54329:5432 \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=voices_dev \
  pgvector/pgvector:pg16
cd backend && DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_dev npm run db:migrate
```

(Homebrew also works, but check that `brew info pgvector` lists support for the Postgres version you install before relying on it.)

### Restarting it after a container restart

The data dir survives but the server doesn't. `pg_ctl` may warn "another server might be running" because of a stale pid file; it starts anyway.

```bash
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/voices-dev -o '-p 54329 -k /tmp' -l /var/lib/postgresql/voices-dev/server.log start"
```

### Running the app locally against it (no OpenAI key needed)

```bash
# terminal 1: mock OpenAI (optional; drop it and set a real OPENAI_API_KEY instead)
MOCK_PORT=4011 MOCK_LOG=/tmp/mock.log node backend/scripts/mock-openai.mjs
# terminal 2: backend on :3001 (the Vite proxy expects 3001)
cd backend && DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_dev \
  JWT_SECRET=local-dev-secret OPENAI_API_KEY=sk-mock OPENAI_BASE_URL=http://127.0.0.1:4011/v1 \
  PORT=3001 npx tsx src/index.ts
# terminal 3: frontend on :5173
cd frontend && npx vite --port 5173
```

Register a user through `/login` (or `POST /api/auth/register`); demo mode is off by default. Explicitly set variables win over any `.env` (dotenv doesn't override). Remember that both `.env` files point at Railway.

## Open questions and findings for the coordination session

1. **Retry stacking: fixed in this PR at Brook's request.** `withRetry` (2 retries) wrapped an SDK call with its own default `maxRetries: 2`, so a persistently failing panel member got **9 attempts**. Now the concept-response call passes `maxRetries: 0` and `withRetry` (moved to `backend/src/utils/retry.ts`) is the only layer: 3 attempts, 2s then 4s.
   - To lose nothing the SDK did, `withRetry` now also retries 408 and 409 (as well as 429, 5xx and status-less errors) and honours `Retry-After` / `Retry-After-Ms` when longer than the backoff and under 60s.
   - This changes runner timing on failures only; successful calls are unaffected. It's not flagged, for the same reason as item 2.
   - Tests: `backend/tests/retry.test.ts` (5 cases). End to end with 2 of 5 panel members forced to 500: each was attempted exactly 3 times (the log shows retry 1/2 at 2000ms and 2/2 at 4000ms), both were recorded as dropouts, and 3 of 5 responded.
2. **Parse failures: fixed in this PR at Brook's request (after review of this note).** `generateConceptResponse` used to return 5/5/5/5 with `needs_more_info` whenever the `---SCORES---` JSON was missing or malformed. Those responses counted as real, pulled means towards 5, and never appeared in `dropouts`. Now `backend/src/utils/parseConceptResponse.ts` throws `ScoreParseError`: `withRetry` retries it (3 attempts in total; the SDK doesn't add retries because it isn't an HTTP error), and a persistent failure becomes a dropout.
   - The parser is also more tolerant than before. A ```json fence, prose after the object, numeric strings, and a missing separator with the object still at the end all parse now. Previously the first three silently became 5s.
   - Two small value changes: a score of `0` now clamps to 1 (it used to become 5 via `|| 5`), and a fractional score such as 7.5 is kept until the existing DB rounding.
   - **Deviation from ground rule 3:** this changes how an existing concept test runs and is **not behind a flag**. Brook asked for the fix directly, and a default-off flag would have left the bug live.
   - Tests: `backend/tests/parseConceptResponse.test.ts`, 12 cases. End to end against the mock (names starting "Garble" get truncated JSON): 5-member panel, 1 garbled → `GarbleAva` attempted 3 times, `options.dropouts.count = 1`, 4 of 5 responded, 0 rows scored 5/5/5/5.
3. **Production backfill.** After deploy, run `npm run backfill:ralph-score -- --dry-run --allow-remote` against production with Brook's say-so, review the list, then run it without `--dry-run`. The scores written equal what the results page already showed, so nothing visible changes.
4. **The plan's risk-5 regression check** still needs a real-key run (see "Not done" above).

## What the next session needs to know

- Local DB: see above. `DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_dev`.
- `backend/scripts/mock-openai.mjs` lets you run tests end to end locally without a key. Names starting "Drop" fail on purpose.
- `cd backend && npm test` is the backend test runner (`node:test` via tsx). Add new tests as `backend/tests/*.test.ts`.
- Stored RalphScore: read `summary.ralph_score` and don't recompute. S4's Performance Index should follow the same pattern (util + version + stored + backfill).
- `segments.by_persona[...].persona_id` is the stable key. The name key can carry a ` (2)` suffix.
- `options.dropouts.variant_ids` is exactly what S4 needs to keep copy-set panels even. A child test with dropouts shows which panel members to re-run.
- Default platforms for new panels are Facebook, Instagram and TikTok. Trupanion twins built from here get Meta + TikTok panels automatically.
