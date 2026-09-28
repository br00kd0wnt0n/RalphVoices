# B1 Studio: hosted Copy Studio on tools.ralph.world (plan)

Status (28 Sep 2026): **phases 1–2 built** on branch `voices/b1-studio` (storage layer, migration 015, PgStore, import tool; see `docs/build-log/B1-studio-p1-2.md`). Phases 0 ("you write first", shipped in PR #8) and 3–6 remain; 3–6 wait for Brook's answers to the open questions below.

It builds on B1-lite (`docs/build-log/B1-lite.md`, merged in PR #6 and #7) and on section B1 of the v2 plan (`docs/voices-v2-plan.md`, still on branch `voices/r1-pass2-smoke-halt`, not yet on `main`).

## Goal

The creative director and the team use Copy Studio at tools.ralph.world, signed in through Narrativ as with the rest of Voices, without Brook's laptop. Several people can work on the same batches, every decision is attributed and kept, and the Studio behaves as it does today: same flow, same checks, same flags with sources.

**Not in scope:**
- new checks
- scoring or prediction
- B2 (pre-flight audit), B3 (ingestion) and B4 (round close)
- comments and sharing, unless Brook asks (open question 5)

## What changes from B1-lite

| | B1-lite (today) | B1 Studio (this plan) |
|---|---|---|
| Where it runs | Brook's laptop: `studio.ts serve` + Vite dev | The Voices backend and frontend on Railway |
| Sign-in | None (127.0.0.1 only) | Existing Narrativ SSO / JWT (`authMiddleware`), plus a Studio access list |
| Storage | JSON files in `Claude outputs/voices-r1/studio/` | Postgres tables (migration 015); pgvector for line embeddings |
| Rules file | `studio-rules.json` on disk | Versioned rows in the database; one active version; admin-only upload and activate |
| Decisions | One person; last write wins | Attributed to the signed-in user, with a full edit history |
| Keys | `~/.config/voices/*.key` | Railway env vars (`OPENAI_API_KEY` already set; `ANTHROPIC_API_KEY` new) |
| Spend cap | $15 per session, in `spend.json` | Monthly cap per environment (`STUDIO_MONTHLY_CAP_USD`), logged per user |
| Jobs | In-memory; lost if the server restarts | The job's state is in the database; the page reconnects and catches up after a refresh or a redeploy |
| CLI | Primary | Kept for scripted runs and local development, on the same engine |

## Design

### 0. The creative director writes first (design change, from Brook 28 Sep)

In B1-lite the brief tab is all setup (persona, territory, fields, tone), and the creative director's own words only go into "reference lines", which set the voice. Writing should be the first action:

- **"Your lines" comes first on the brief tab.** It's a large writing area, one line per row, with a field picker per row (default: the brief's first field) and a live character count against the field.
- **Check my lines** runs only the checks, with no generation (about 10–20 s for a handful of lines). The lines land in the review grid marked as the creative director's own ("yours"), with the same flags, sources and skeptic objections as generated lines.
- **Generate around these** uses the creative director's lines three ways:
  - as the voice (the strongest few-shot examples, ahead of reference lines)
  - to fill the grid cells they haven't covered (angle × structure), so the batch spreads out from what they wrote rather than repeating it
  - as a near-duplicate filter: generated lines too close to theirs are dropped
- **Their lines are tagged like any other line.** The per-line check also returns the angle and structure, so they sit in the grid and count towards coverage.
- **Setup shrinks to one row** above the writing area (persona, territory, fields, tone), with bans and reference lines behind "More options".

This applies to B1-lite now and carries into the hosted build: in phase 1, `studio_lines.model = 'human'` and `written_by`. Estimate: half a day on B1-lite (engine: human lines in a batch, angle/structure tagging, generation seeded by the grid gaps; UI: the new brief layout).

### 1. One engine, two stores

`engine.ts` already holds all the logic. The work is to separate *what it does* from *where it keeps things*.

- Move the engine from `backend/scripts/studio/` to `backend/src/services/studio/`, so it's compiled and deployed with the backend. The CLI imports it from there.
- Put a small `StudioStore` interface in front of every read and write the engine does today: rules, briefs, batches, lines, embeddings, taste, shortlist, compares, spend.
  - `FileStore`: today's behaviour, for the CLI and local development.
  - `PgStore`: the hosted version.
- The checks, grid, prompts, flag reconciliation, CSV export and import, and the Claude adapter are unchanged. The existing tests keep passing against `FileStore`, and new tests run the same cases against `PgStore` on the local database.

### 2. Data: migration `015_studio.sql`

Idempotent (`IF NOT EXISTS`), because every migration re-runs on each boot. It'll be run twice locally to prove it.

| Table | Holds |
|---|---|
| `studio_rules` | `version`, `body jsonb` (today's rules file), `status` (`draft` / `active` / `retired`), `notes`, `created_by`, timestamps. One active row |
| `studio_briefs` | persona, territory, fields, tone, bans, reference lines, `n`, writer model, `created_by` |
| `studio_batches` | `brief_id`, the `rules_version` used, writer model, `status` (`running` / `done` / `failed` / `stopped`), `stats jsonb` (timings, cost, duplicates removed), `created_by` |
| `studio_lines` | Everything a line carries today: field, text, angle, structure, tone, features, flags (with `by` and `p`), probes, objection, model, prompt version, parent line and guidance, plus `embedding vector(1536)`. The current decision, edited text and note, with `decided_by` and `decided_at` |
| `studio_edits` | Append-only history of every keep, cut, edit and note: before, after, who, when (the v2 plan's audit trail) |
| `studio_compares` + `studio_compare_lines` | The blind compare. The writer key sits in a column the API never returns until reveal; `revealed_by` and `revealed_at` are recorded, and stars are per user |
| `studio_spend` | One row per run: user, stage, calls, USD. The monthly cap reads from here |

- **Taste examples** become a query over decided lines (keep, edit, and cut with a note), scoped to the persona. No separate table to drift.
- **The shortlist** is also a query. Naming stubs are computed as they are now.
- **Persona codex:** the v2 plan's slim `persona_evidence` table is **not** needed for this build. The rules body already carries triggers, turn-offs, language and verbatims, each with a source. Revisit if the codex grows beyond the rules file.

### 3. API: `/api/studio`, behind `authMiddleware`

- **Same endpoints as `studio.ts serve`** (meta, estimate, generate, batches, lines and decisions, more like this, export CSV and MD, ingest, shortlist, check, compare, reveal), now under the existing backend.
- **Access list:** `STUDIO_EMAILS`, comma-separated. It fails closed, like `ADMIN_EMAILS`. Rules upload and activation are admin-only (`ADMIN_EMAILS`).
- **Progress:** generation and more-like-this run in the background, as concept tests do. Each line is written to the database as it's checked. The page follows a server-sent event stream and, on reconnect, re-reads the batch from the database, so a refresh or a redeploy loses nothing. A batch interrupted by a redeploy is marked `stopped`, and a Resume button re-checks its unchecked lines.
- **Rate limits and cost:** the pacer is per process and shared by every batch, and it learns the limits from response headers, as now. The OpenAI account is shared with concept tests, so the default pace stays at 90% of the reported limit. The monthly cap is checked before each run. The ask-before-$2 rule becomes a confirm dialog, as in B1-lite.
- **Rules:**
  - `GET /api/studio/rules` returns the active version.
  - `POST /api/studio/rules` uploads a draft (admin), validated against `rules.schema.json`.
  - `POST /api/studio/rules/:version/activate` makes it live.
  - Every batch records the rules version it ran under.

### 4. Frontend

- **Route:** `/studio` becomes a production route under `RequireAuth`, with a "Studio" item in the top nav. The page stays full-width.
- **API client:** `studioApi.ts` uses the same base URL and bearer token as `api.ts`. `VITE_STUDIO_API` stays for local development.
- **Attribution:** each card shows who kept, cut or edited it and when, with the edit history one click away.
- **Blind compare:** stars are per user. Reveal shows everyone's tally, and the reveal is recorded.
- **Admin:** a small, read-only view of the active rules (version, decisions, open items), plus upload and activate.
- **iframe check:** the page works inside the tools.ralph.world iframe (SSO exchange already handled by `useAuth`).

### 5. Moving today's material across

- Upload `studio-rules.json` v2.1 as the first active rules version, through the admin endpoint and never directly into the database. **It's client material going into Ralph's production database, so Brook confirms first** (open question 3).
- Optional: import the existing batches, compares and taste examples with a one-off script that calls the API. Decided lines keep their original timestamps and are attributed to Brook.

## How it's built and tested

Ground rules from `docs/build-sessions.md` apply:
- local Postgres on :54329 only, never the Railway databases
- no push, merge or deploy without Brook's say-so
- commits end with the Co-Authored-By line

Testing:
- **Unit:** the existing studio tests run against both stores. New tests cover rules versioning, attribution, the edit history, a hidden compare key, per-user stars, and the monthly cap.
- **Locally:** the migration is run twice against the local database. The full flow runs on the mock client against `PgStore`, then one live batch and the planted-line check (8/8 must still pass) against the local database with real keys.
- **Frontend:** type check, headless screenshots of each screen signed in, and the iframe check.
- **Deploy (Brook's go-ahead):** set the env vars on Railway, deploy, confirm the migration logged, upload and activate the rules, then run the planted-line check and one small batch in production.

## Phases and effort

| # | Work | Estimate |
|---|---|---|
| 0 | "You write first" on B1-lite (can ship before the hosted build) | 0.5 day |
| 1 | Move the engine into `src/services/studio`; `StudioStore` with `FileStore`; CLI unchanged; tests green | 0.5 day |
| 2 | Migration 015 and `PgStore`; tests against the local database | 1 day |
| 3 | `/api/studio` routes: auth, access list, database-backed jobs with reconnect, rules endpoints, monthly cap | 1 day |
| 4 | Frontend: production route and nav, signed-in client, attribution and history, per-user stars, rules view, iframe check | 1 day |
| 5 | Import script, handoff, and staging-style check on the local database with real keys | 0.5 day |
| 6 | Deploy with Brook: env vars, migration, rules upload, production smoke test | 0.5 day |
| | **Total** | **about 5 days** (v2 plan estimate: 5–6) |

Phases 1–2 can start straight away. Phase 6 waits for Brook.

## Decisions (Brook, 28 Sep 2026)

1. **Rules in production:** yes. The Trupanion rules file can be stored in Ralph's production database (uploaded through `rules-push`, versioned, one active).
2. **Access:** Brook and the creative director for the first release. The `STUDIO_EMAILS` value needs the creative director's email (pending).
3. **Carry over:** yes. On the first deploy, today's runs, decisions, territory edits, taste examples, compares and spend are imported with `db-import --with-spend`.
4. **Monthly spend cap:** $50 (`STUDIO_MONTHLY_CAP_USD=50`).

Still open from the original list: comments and sharing (question 5; notes on lines for now), shared-decision behaviour (question 2; plan: latest decision stands, attributed, with history, as built in phase 1), and a separate Anthropic key for production (question 7; to create at deploy).

## Open questions for Brook

1. **Access:** who goes on `STUDIO_EMAILS` for the first release? Brook and the creative director; anyone else (Gareth, Vivan)?
2. **Shared decisions:** when two people decide on the same line, should the latest decision stand, attributed with history kept? (Recommended.) Or should each person keep their own decisions?
3. **Rules in production:** OK to store the Trupanion rules file (client material) in Ralph's production database? Who besides Brook can upload and activate rules?
4. **Monthly spend cap** for the hosted Studio. Suggestion: $50 a month. A batch costs about $0.10 and a 4-writer compare about $0.26.
5. **Comments and sharing:** does the creative director need them in the first version (v2 plan open question 4), or are notes on lines enough?
6. **Carry over** today's local batches, compares and taste examples, or start the hosted Studio clean?
7. **Anthropic key on Railway:** a fresh key for production, separate from the laptop key, so each can be revoked on its own.
