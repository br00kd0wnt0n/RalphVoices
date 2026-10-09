# Ralph Voices

Synthetic audience panel tool for testing creative concepts against AI-generated personas. Simulates diverse audience reactions using OpenAI GPT-4o and provides strategic insights through automated analysis.

## Architecture

- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui (Radix primitives)
- **Backend**: Express.js + TypeScript (tsx runtime) + PostgreSQL + OpenAI GPT-4o
- **Monorepo**: npm workspaces (`frontend/`, `backend/`)
- **Deployment**: Railway (backend + frontend as separate services)

## Quick Start

```bash
npm install              # Install all workspace dependencies
npm run dev              # Start both frontend (5173) and backend (3001) concurrently
npm run dev:frontend     # Frontend only
npm run dev:backend      # Backend only
npm run db:migrate       # Run database migrations
npm run db:seed          # Seed demo data
```

## Project Structure

```
backend/
  src/
    db/               # PostgreSQL connection, schema, migrations, seed
      schema.sql      # Full schema for fresh installs
      migrations/     # 002_gwi_integration.sql, 003_recommendations.sql
    middleware/       # Auth middleware (JWT + demo mode)
    routes/           # Express routes: auth, projects, personas, tests, uploads, gwi
    services/         # AI (OpenAI) service, GWI Spark service
    utils/            # Shared constants, types
    index.ts          # Express server + WebSocket setup
frontend/
  src/
    components/       # Custom components + ui/ subfolder (shadcn/ui primitives)
    hooks/            # useAuth, useGwi
    lib/              # API client, constants, utilities
    pages/            # Route pages (10 total)
    types/            # TypeScript interfaces (index.ts, gwi.ts)
```

---

## UX Overview

### Navigation
Top nav bar with: Dashboard, Projects, Personas, Tests, Settings. Logo links to Dashboard. No global "New Test" CTA — test creation is contextual per page.

### Dashboard (`/`)
Apple-style landing with large "VOICES" wordmark (Space Grotesk, gradient text) and animated voice waveform. Provocative hero copy: "You're spending $$$ on creative / your audience hasn't seen yet." Stats row (projects, personas, panel size, tests run). Recent tests list with status badges. Primary CTA: "Test a Concept".

### Two Test Creation Flows

#### Concept-First (default at `/tests/new`) — 3 steps:
1. **Concept Input**: Text description + image/PDF uploads + optional strategic context (Creative Ambition, Strategic Truth, Key Insight). Supports single concept or A/B comparison mode. Images analyzed by GPT-4o Vision.
2. **Audience Selection**: GWI-suggested audiences (if enabled) + existing persona picker. Personas default to "All Personas" view with deduplication by name. Users can filter by project. Each persona card shows demographics, variant count, project/standalone badge.
3. **Configure & Run**: Test name, project selection (create inline), test focus preset, variants per persona (10-50). Summary card. Run button triggers background processing.

#### Persona-First (`/tests/new?mode=persona-first`):
Select project → select/create personas → enter concept → run.

### Personas (`/personas`)
Library of all personas with project filter. Create via multi-step builder (4 steps: Identity, Psychographics, Media Habits, Cultural Context). Personas can be standalone (no project) or project-attached. Cards show demographics, variant count, project usage. Actions: edit, delete, regenerate voice, view variants.

### Projects (`/projects`)
Organization layer. Each project has personas and tests. Create project with optional persona copy from another project. Project detail shows personas + tests inline.

### Test Results (`/tests/:id`)
Comprehensive results page with tabs:
- **Dashboard**: RalphScore gauge, sentiment pie chart, segment cards (by platform, by attitude, by persona), brain balance (rational vs emotional), emotional spectrum (reaction tag bars), key associations, shareability analysis, GWI recommendations, cross-test comparison radar chart. There is no separate Segments tab; segment breakdowns live on the Dashboard tab.
- **Responses**: Individual persona responses with filtering (sentiment, platform, attitude), paginated
- **Chat**: Streaming insights chat (SSE) — ask questions about test findings
- **Market Insights**: GWI enrichment data (when connected)
- **Export**: JSON report download

Concept preview card shows: text, uploaded images (thumbnails), PDF badges, strategic context fields.

Failed test state: Error banner with diagnostics + retry button.

Partial panel: when fewer panel members responded than were run (`summary.total_responses < tests.responses_total`), an amber banner says "n of N panel members responded".

### Settings (`/settings`)
GWI API key configuration. Test focus preset descriptions.

---

## Technical Spec

### Backend API Endpoints (`/api/`)

#### Auth (`/auth`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/register` | Register (email, password, name) → token |
| POST | `/login` | Login → token |
| GET | `/me` | Current user info |
| POST | `/sso/exchange` | Exchange a Narrativ-shell-minted SSO JWT for a Voices JWT. See "Narrativ SSO" below. |

#### Projects (`/projects`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Create project (name, client_name, copy_persona_ids) |
| GET | `/` | List projects with persona/test counts |
| GET | `/:id` | Project detail with personas and tests |
| PUT | `/:id` | Update project |
| DELETE | `/:id` | Delete project + cascading cleanup |

#### Personas (`/personas`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Create persona + auto-generate voice sample |
| GET | `/` | List personas (optional `?project_id=` filter) |
| GET | `/:id` | Persona with variants |
| PUT | `/:id` | Update persona (optional `regenerate_voice`, `voice_style: 'default' \| 'lived'`, or a hand-written `voice_sample`) |
| DELETE | `/:id` | Delete persona |
| POST | `/:id/variants` | Generate N variants via AI, in chunks of 10; 502 and no panel swap if it still comes up short |
| GET | `/:id/variants` | List variants |
| POST | `/:id/voice` | Regenerate voice sample (`{style: 'lived'}` keeps it off the product category) |

#### Tests (`/tests`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Create test with concept, assets, personas, config |
| GET | `/` | List tests (optional `?project_id=` filter) |
| GET | `/:id` | Test with personas and results/progress |
| POST | `/:id/run` | Execute test (background batched processing) |
| GET | `/:id/responses` | Paginated responses with filtering |
| GET | `/:id/results` | Aggregated results |
| POST | `/:id/chat` | SSE streaming insights chat |
| GET | `/:id/recommendations` | AI recommendations (cached after first call) |
| GET | `/:id/export` | Full JSON report download |
| DELETE | `/:id` | Delete test |
| WS | `/ws/tests/:id/progress` | Real-time progress WebSocket |

#### Uploads (`/uploads`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Single file upload → base64 + PDF text extraction |
| POST | `/multiple` | Multiple file upload |

#### GWI Spark (`/gwi`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/status` | Check GWI availability |
| POST | `/suggest-audiences` | Audience suggestions from concept text |
| POST | `/validate-persona` | Validate persona against market data |
| POST | `/enrich-results` | Market analysis enrichment for test results |
| POST | `/settings` | Save GWI API key |

### Database Schema

**Core tables**: `users`, `projects`, `personas`, `persona_variants`, `tests`, `test_responses`, `test_results`, `settings`

Key JSONB columns on `personas`:
- `psychographics` — values, motivations, aspirations, pain_points, decision_style
- `media_habits` — primary_platforms (name + hours_per_day), content_preferences, influencer_affinities
- `cultural_context` — subcultures, humor_style, language_markers
- `brand_context` — category_engagement, brand_awareness, purchase_drivers
- `gwi_audience_data` — optional GWI source data

Key JSONB columns on `tests`:
- `options` — stores uploaded assets (base64 images, extracted PDF text), `strategic_context`, `image_detail` (`low` default \| `high` \| `auto`, passed to the vision `image_url.detail`), and `dropouts` (`{count, variant_ids}` of panel members that failed after retries; written on every run)
- `variant_config` — age_spread, attitude_distribution, platforms, focus_preset, focus_modifier, and opt-in flags `vector_constraints` (default on), `realism` and `probes` (both default off; see "Feed realism and intent probes")

Key JSONB columns on `test_results`:
- `summary` — total_responses, sentiment counts, score averages, `ralph_score` + `ralph_score_version` (stored since v1)
- `segments` — by_age, by_platform, by_attitude, by_persona breakdowns (`by_persona` is keyed by persona name, carries `persona_id`; a duplicate name gets a ` (2)` suffix)
- `themes` — positive_themes, concerns, unexpected
- `recommendations` — cached AI-generated improvement suggestions

Panels are frozen, not overwritten: regenerating variants soft-retires used ones (`persona_variants.retired_at`, `panel_version`, migration 007) so `test_responses` history survives. Any new query over `persona_variants` must filter `retired_at IS NULL` unless it deliberately wants history.

Migrations in `backend/src/db/migrations/`. Auto-applied on server startup.

### AI Service (`backend/src/services/ai.ts`)

| Function | Purpose | Model | Temp |
|----------|---------|-------|------|
| `generateVoiceSample` | 2-3 paragraph voice calibration | MODEL | 0.8 |
| `generateVariants` | N unique variants with controlled diversity, generated in chunks of 10 (`utils/variantChunks.ts`) | MODEL | 0.9 |
| `generateConceptResponse` | Persona reaction to concept + scores/tags | gpt-4o (if images) or MODEL | 0.85 |
| `analyzeTestResults` | Theme extraction from all responses | MODEL | 0.7 |
| `streamChatResponse` | SSE streaming insights chat | MODEL | 0.7 |
| `generateRecommendations` | Strategic improvement suggestions | MODEL | 0.7 |

Vision: Images passed as `image_url` content blocks. Forces `gpt-4o` for vision regardless of `OPENAI_MODEL` setting.

Error resilience: Per-variant error handling — each call is retried by `withRetry` (`utils/retry.ts`: 2 retries, 2s/4s backoff, honours `Retry-After`; retries 408/409/429/5xx and status-less errors). It is the only retry layer: the concept-response call passes `maxRetries: 0` to the SDK, so a failing panel member gets 3 attempts in total. Unreadable scores throw `ScoreParseError` (`utils/parseConceptResponse.ts`) and are retried the same way; there is no 5/5/5/5 fallback. A panel member that still fails is skipped and recorded in `tests.options.dropouts`. The test completes with partial results and is only marked failed if ALL panel members fail.

### GWI Spark Service (`backend/src/services/gwi.ts`)

Optional integration via JSON-RPC calls to GWI Spark API. **Dormant by default** — every public method short-circuits unless `ENABLE_GWI=true` AND a valid key (env or per-user setting) is present. Features (when active):
- `suggestAudiences` — 3-5 distinct audience segments with descriptions (requests JSON, falls back to text parsing)
- `validatePersona` — realism check against market data
- `enrichResults` — executive summary, market context, benchmarks, opportunities/risks

### Test Execution Flow

1. Concept-first only: for any selected persona with no active panel, the frontend builds one first (`POST /personas/:id/variants`, `variants_per_persona` members, default platforms) with visible progress. If a build fails, the run is blocked and no test is created.
2. Frontend creates test record (concept + assets + persona_ids + config)
3. Frontend calls `POST /tests/:id/run` (response includes `personas_without_panel`, the selected personas the runner will skip)
4. Backend responds immediately, processes in background:
   - Fetches all variants for selected personas
   - Batches: 3 concurrent, 1s delay between batches
   - Each variant: OpenAI call → extract scores/tags → save to DB
   - Per-variant error handling (retry, then skip and record in `options.dropouts`)
   - After all: analyze themes, calculate segments, compute RalphScore, save results
   - Optional: GWI enrichment (non-blocking)
   - Mark test as `complete`
5. Frontend polls via WebSocket for real-time progress

### Response Scoring

Each variant response produces:
- `sentiment_score` (1-10)
- `engagement_likelihood` (1-10)
- `share_likelihood` (1-10)
- `comprehension_score` (1-10)
- `reaction_tags` — 2-4 from: excited, intrigued, confused, skeptical, amused, bored, annoyed, inspired, would_share, would_ignore, needs_more_info, feels_authentic, feels_forced, seen_before, fresh_take

### Feed realism and intent probes (opt-in per test)

- `variant_config.realism: true` adds `REALISM_SYSTEM_BLOCK` (5 = a typical scroll-past ad; use the whole scale) and a per-member baseline from `brand_context` plus `attitude_score` as behaviour (`utils/realism.ts`). Added because twins bunched every concept at 7-9 (Trupanion round one).
- `variant_config.probes: true` asks three one-word follow-ups after the in-character answer and stores P(Yes) from logprobs as `test_responses.probes` `{p_stop, p_tap, p_quote}` (`utils/probes.ts`). Aggregates: `summary.probes` and `segments.by_persona[name].probes`. These map to hook rate, CTR and conversion intent; use them, not RalphScore, for concept ranking when they're present.
- `segments.by_persona[name].ralph_score` is the per-persona RalphScore (v1 maths).

### RalphScore™

Proprietary 0-100 benchmark: 30% sentiment + 30% engagement + 25% share likelihood + 15% comprehension, with sentiment distribution modifier.

Computed server-side in `backend/src/utils/ralphScore.ts` when results are written and stored in `test_results.summary.ralph_score` with `ralph_score_version` (currently 1), so delivered numbers never shift. `frontend/src/lib/ralphScore.ts` is an identical mirror used only as a fallback (tests completed before v1, live progress). `backend/tests/ralphScore.test.ts` proves the two agree (`cd backend && npm test`). Any change to the maths must bump the version in both files; recompute old tests deliberately with `backend/scripts/backfill-ralph-score.ts` (`--dry-run`, `--recompute`, `--allow-remote`).

### Test Focus Presets

| Preset | Purpose |
|--------|---------|
| `baseline` | General feedback covering all aspects |
| `brandPerception` | Brand trust, recall, fit, competitor comparison |
| `purchaseIntent` | Buying likelihood, barriers, urgency |
| `creativeImpact` | Emotional response, memorability, distinctiveness |
| `messageClarity` | Key message comprehension, confusion, CTA |
| `socialShareability` | Share likelihood, conversation starter, platform fit |

### Thresholds (keep backend + frontend in sync)

| Constant | Value | Notes |
|----------|-------|-------|
| `SENTIMENT_THRESHOLDS.POSITIVE_MIN` | 7 | >= 7 is positive |
| `SENTIMENT_THRESHOLDS.NEUTRAL_MIN` | 4 | 4-6 is neutral, < 4 is negative |
| `ATTITUDE_THRESHOLDS.ENTHUSIAST_MIN` | 7 | >= 7 is enthusiast |
| `ATTITUDE_THRESHOLDS.SKEPTIC_MAX` | 3 | <= 3 is skeptic |
| `DEFAULT_PLATFORMS` | Facebook, Instagram, TikTok | Platforms new panels are spread across (Meta + TikTok). Existing panels keep theirs. |

---

## Key Conventions

- **Brand color**: `#D94D8F` (pink) — RalphScore, CTAs, active nav, primary accents
- **GWI accent**: emerald/teal (`text-emerald-600`, `border-emerald-600`) for GWI-related UI
- **Title font**: Space Grotesk (Google Fonts) for VOICES wordmark and headings
- **UI components**: shadcn/ui in `frontend/src/components/ui/` — don't modify these directly
- **API client**: All backend calls go through `frontend/src/lib/api.ts` (typed fetch wrapper)
- **Auth**: JWT tokens. People reach Voices through tools.ralph.world (Google sign-in on Narrativ, then SSO exchange). Password auth (`/register`, password `/login`) is closed unless `PASSWORD_AUTH=open`; `PASSWORD_LOGIN_EMAILS` allowlists service accounts. Tokens carry `via: 'sso' | 'password'`, and while closed only SSO tokens and allowlisted password tokens are accepted (`utils/authPolicy.ts`). The Railway URL serves the same app and data as tools.ralph.world, so never reopen password auth in production. Demo mode (no auth header → demo user `demo@ralphvoices.com`) is opt-in via `ENABLE_DEMO_MODE=true`; otherwise missing auth returns 401.
- **Shared constants**: `backend/src/utils/constants.ts` and `frontend/src/lib/constants.ts` — keep in sync
- **Animations**: framer-motion for page transitions, entry animations, interactive elements
- **Charts**: recharts (BarChart, RadarChart, PieChart) for data visualizations

## Environment Variables

Backend (`.env`):
- `DATABASE_URL` — PostgreSQL connection string
- `OPENAI_API_KEY` — Required for all AI features
- `OPENAI_MODEL` — Model to use (default: `gpt-4o`). Vision requests always use `gpt-4o`
- `JWT_SECRET` — Required; server refuses to boot if unset or set to the literal `development-secret-change-me` (override only via `NODE_ENV=development` + `ALLOW_INSECURE_JWT=true`)
- `ENABLE_DEMO_MODE` — `true` re-enables auto-login as the demo user; default `false`
- `ENABLE_GWI`, `GWI_API_KEY` — flip ENABLE_GWI=true and supply a key to reactivate GWI Spark
- `ENABLE_R2_STORAGE`, `R2_*` — route uploaded assets to Cloudflare R2 instead of base64-in-JSONB
- `TEST_RETENTION_DAYS` — optional; archive completed tests older than N days
- `ADMIN_EMAILS` — comma-separated admin allowlist; required for `DELETE /api/anchors/all` (fails closed when unset)
- `PASSWORD_AUTH` — `open` re-enables self-registration and password login for everyone (local dev only). Unset/anything else = closed.
- `PASSWORD_LOGIN_EMAILS` — comma-separated emails that may register and use password login while closed (service accounts for scripted runs)
- `PORT` — Backend port (default: 3001)
- `FRONTEND_URL` — For CORS (default: `http://localhost:5173`)
- `NARRATIV_SSO_SECRET` — HS256 signing secret shared with Narrativ for shell→tool SSO. Must be byte-identical to `TOOL_SSO_SECRET_VOICES` on Narrativ. Empty/unset = SSO disabled (password login still works).
- `NARRATIV_VOICES_WEBHOOK_SECRET`, `NARRATIV_BASE_URL` — outbound HMAC webhook for the Voices→Narrativ return signal (existing).
- `ENABLE_STUDIO` — `true` mounts Copy Studio at `/api/studio` (off by default). `STUDIO_EMAILS` — who may use it (plus `ADMIN_EMAILS`; fails closed). `STUDIO_MONTHLY_CAP_USD` (default 50), `STUDIO_ASK_OVER_USD` (default 2). `ANTHROPIC_API_KEY` — Claude writer in Blind compare. `STUDIO_MOCK=true` — mock client, local development only (ignored when `NODE_ENV=production`; never set on Railway). Deploy checklist: `docs/build-log/B1-studio-p5.md`.

Frontend (`.env`):
- `VITE_API_URL` — Backend API URL (default: `/api`)

## Narrativ SSO

As of 2026-05-07, Voices accepts a Narrativ-shell-minted SSO token so users
who are signed into Narrativ are not prompted to log into Voices again when
the iframe loads.

- The shell appends `?narrativ_sso=<jwt>` to the iframe src on first mount.
- The frontend `AuthProvider` (`frontend/src/hooks/useAuth.tsx`) detects the
  param on mount, POSTs to `/api/auth/sso/exchange`, stores the returned
  Voices JWT in localStorage, and strips the SSO param from the URL via
  `history.replaceState`. Subsequent navigations (handoff to `/tests/new` with
  Brainstorm concept params) reuse the now-minted Voices session cookie.
- The backend route `POST /api/auth/sso/exchange` (`backend/src/routes/auth.ts`)
  verifies the JWT via `services/narrativSso.ts` (HS256, 5-min `exp`,
  `aud === 'voices'`, `iss === 'narrativ'`, jti one-time-use), then
  finds-or-creates the Voices user by email and returns a Voices JWT.
- SSO-minted users get a sentinel `password_hash = 'sso-narrativ'` so the
  password login path can never authenticate them. They sign in via Narrativ
  going forward, never via the local /login form.
- Replay protection: jtis are tracked in-memory with TTL pruning. A process
  restart can at worst re-allow a fresh-but-uncached token; tokens are 5-min
  so the residual exposure window is tiny.
- Domain allowlist enforcement is single-source-of-truth at sign-in time on
  Narrativ (`GOOGLE_ALLOWED_DOMAINS`). Voices trusts the email claim once the
  signature checks out — it does not re-check the domain.
- Backwards-compatible: when `NARRATIV_SSO_SECRET` is unset, the exchange
  endpoint returns 401 with `reason: 'missing_secret'` and the frontend falls
  back to the /login page. Since password auth is closed by default, that page
  points people to tools.ralph.world (`GET /api/auth/config` tells it which mode
  is on).

## Copy Studio, B1-lite (script + local page)

VOICES v2 build 1: `backend/scripts/studio.ts` (CLI and `serve`) over `backend/src/services/studio/engine.ts`. All storage goes through `StudioStore` (`store.ts`): `FileStore` (default, the folder below) or `PgStore` (`pgStore.ts`, migration `015_studio.sql`; CLI `--store pg --database-url <explicit URL>`, local hosts only unless `--allow-remote`; `rules-push`, `db-import`). The CLI never uses the app's database connection. It reads only `OPENAI_API_KEY` from `backend/.env` (never `dotenv.config()`, because that file's `DATABASE_URL` is production) and writes everything to `Claude outputs/voices-r1/studio/` (client material, never committed): `studio-rules.json`, `briefs/`, `batches/<id>/batch.json`, `exports/`, `taste.json`, `shortlist.csv/.md`, `compare/<name>/` (sheet plus a separate `key.json`), and `spend.json` (cumulative, $15 cap, asks above $2 per run).

- Flow: `brief` → `generate` (a grid of angle × structure × tone, near-duplicates removed by embedding similarity) → checks on every line (deterministic first, then one JSON call per line, two-wording logprob checks for compliance items, and a skeptic's objection) → `export` (Sheets CSV + Markdown) → `ingest` (curated CSV back: taste examples for the next `generate`, plus a shortlist with naming codes) → `compare` (blind writer comparison).
- Every flag carries a rule id and the source from the rules file. Flags, not scores. The rules file schema and a made-up example are in `backend/scripts/studio/`; `backend/tests/studio.test.ts` runs against the example.
- **Four steps** (`frontend/src/pages/Studio.tsx` shell over `frontend/src/components/studio/*`): **Write** (territory picker, your lines first, per-field counts from the rules' `default_count` for the fields the territory's format starts with (`defaultFields`; a changed persona or territory keeps ticked fields, `frontend/src/lib/studioFields.ts`), brief `field_counts` honoured by `fieldQuota`, and the line above Generate is `/estimate`'s `allocation`; an Edit-territory drawer) → **Review** (lighter cards; the Kept tray by field, with Cut/Undo, replaces the Shortlist) → **Build & sign off** (the old Ready for production) → **Assets** (Pre-flight + Compliance per code, one status track). The start screen is the round board (persona × territory pipeline counts; How it works while the round has no runs, and behind "?"). A context bar (persona × territory × region) scopes Write, Review and Build; Assets, Export and Live show the whole round and filter only themselves. One status chip per code (`codeState` in `components/studio/ui.tsx`), one Export menu, persona colours in `frontend/src/lib/personaColors.ts`. Territories, Rules (with Rounds), Export and Compare sit top right; Live opens the explainer. Each screen has its own path (`/studio/write`, `/review`, `/build`, `/assets`, `/live`, and the utilities; `frontend/src/lib/studioRoute.ts`), with the rest of the state in the query (`/studio/assets?stub=<code>`); old `?tab=` links and the old tab keys redirect (brief→write, shortlist→review Kept, ready→build, preflight/compliance→assets). Runs are saved by person (`created_by`, `decided_by`) and can be continued. Handoff: `docs/build-log/studio-4-step.md`.
- UI: `/studio` (`frontend/src/pages/Studio.tsx`, client `frontend/src/lib/studioApi.ts`). Hosted in production builds (or `VITE_STUDIO_HOSTED=1`): signed-in route, `/api/studio` with the app's token, nav item only for people with access. Locally (dev, or `VITE_STUDIO_API`): `npx tsx scripts/studio.ts serve` on 127.0.0.1:4100, no sign-in. `--mock` (or `STUDIO_MOCK=true` on the hosted routes, dev only) runs with no key and no cost.
- **Naming codes** (one definition: `backend/src/utils/namingCode.ts`; allocation: `services/studio/codes.ts`): `PERSONA_TERRITORY_FORMAT_[visual][version]_REGION_PLATFORM[_YYMMDD]`, e.g. `FAM_SUMMER_ST_A2_US_META_261013` (visual A, version 2, US, Meta; the date is added at trafficking). Proposed to Add3 on 29 Sep, awaiting confirmation: a change of order is a change to `CODE_ORDER`. The earlier `…_v#_PLATFORM` form is still read everywhere (Studio, Pre-flight, the audit library), and codes signed off under it keep it. The visual letter is fixed at sign-off (default: three versions to a visual), never changes after, and Pre-flight suggests same-letter codes as one upload. Handoff: `docs/build-log/studio-region-naming.md`.
- **Live versions** (`services/studio/versions.ts`): one code = one ad = a set of fields (Meta primary + headline, description optional; TikTok caption, hook optional; roles from the rules' `in_version`, else defaults). Built at Ready per visual letter (`POST /ready/preview` plans codes; a version with the same lines as the last sign-off keeps its code); a line can be in several versions. On-image text is per visual (`per_visual`): one per letter, no code, added to every code on the visual. Stored in the sign-off body (`versions`, `on_image`, `checks`); compliance per code on `line.compliance_by_code` (read with `complianceFor`, which falls back to the older per-line `compliance`). Sign-offs from before versions (one code per line) are read through `signoffVersions()`. **Carousels** (item E): on a CAROUSEL territory, on-image text is written as card sequences (lines with `card` and `sequence_id`; brief `carousel: {sequences, cards}`), placed per visual as ordered cards (`draft.on_image[visual]` is an array; `signoff.on_image[].card`), matched card by card in Pre-flight (`cardMatch` in preflight.ts), checked across cards (`field#card`), and listed card by card in the handoff. The Meta headline is post copy (`POST_COPY_FIELDS`). Handoff: `docs/build-log/studio-carousel-cards.md`. **Version checks** (`versionChecks.ts`, thresholds in `versionChecks.json`) inform, never block: repeats, too alike, conflicts (a model call per version, stage `version-check`, `POST /ready/check`, cached per wording) and split claims (red). Handoff: `docs/build-log/studio-live-versions.md`.
- **Working round, per person** (`workingRound`/`setWorkingRound` in rounds.ts; `studio_inputs` `working_round:<email>`): the round a person works in (the active round, or a test round for an admin). Stamps and views follow the requesting person (`roundView(q, user)`); a test round is never the global active round. A view of exactly a test round exports its codes labelled TEST (`testOnly`), files `TEST_…`; B3 features never include test rounds.
- **Who to cast** (rules v2.12 top-level `casting`): on `/meta`, in PersonaPanel and Rules (`CastingNotes` in ui.tsx), and `casting.writer_note` as a "PETS:" line in `writerSystem`.
- **Asset sizes** (`services/studio/sizes.ts`): a code's asset is a set of sizes (1:1 / 4:5 / 9:16 by format, `expectedSizes`, overridable in rules `preflight.sizes`), stored on `studio_upload_files.role` (`asset:4x5`, position = size slot × 100 + card). Pre-flight audits each size, tags flags with `size`, and flags a missing expected size amber (`SIZE_MISSING`); the asset handoff lists files per size. Handoff: `docs/build-log/studio-sizes-months.md`.
- Rounds are shown as **months** ("Month 1", "Test" for R0; `monthLabel`/`labelOf` in rounds.ts, `roundLabel`/`roundName` in studioApi.ts); ids and `_TEST` are unchanged.
- **Rounds** (`services/studio/rounds.ts`, stored in `studio_inputs` 'rounds'; no migration): an admin sets the active round (Rules). It's stamped on new runs (`brief.round`), lines, taste and sign-offs; unstamped content is R1. Lists and exports take `?round=` (default the active round; `all` for every round; the page sends it from the header's "This round / All rounds"). Ready works in one round. A **test** round (R0) is hidden by default: codes end in `_TEST`; it's never handed off (Add3) or exported to B3 features; real rounds allocate codes as if it never happened (R1 starts at A); no taste into real rounds; spend counts (labelled with the round). Handoff: `docs/build-log/studio-rounds.md`.
- **Region** (US / Canada, default US) is chosen on Write & brief and stored on the brief, run and lines (JSONB; no migration). US and Canada are separate ads, runs, sign-offs and visuals. A Canadian brief tells the writer to use Canadian spelling and feel Canadian (no facts about Canada beyond the facts list), and shows "These personas are built on US research; check that they hold for Canadian audiences." Sign-offs are per persona × territory × region; the version count is shared across regions (the database's unique key), and the latest per region is what Pre-flight and the handoff pack use.
- **Two people at once:** every change to a run goes through `runLock(batchId, …)` (engine.ts; `StudioStore.withLock`: Postgres advisory locks in one transaction, in-process for FileStore) and re-reads the run inside it. New line ids come from `claimLines`. `saveBatch(b, lineIds)` writes only the lines a job owns and never removes one. Sign-off locks `signoff:<persona>|<territory>` plus its runs, and returns a 409 if the set changed since the screen loaded (`expect_latest`). Taste is per row (`putTaste`/`deleteTaste`). The spend cap reserves a run's estimate (router `reserve()`). Handoff: `docs/build-log/studio-concurrency.md`.
- **Compliance** (after Pre-flight, `Preflight.complianceAssets` / `setAssetCompliance` in `services/studio/preflight.ts`): the producer (`STUDIO_COMPLIANCE_EMAILS` or an admin) records Trupanion's decision, with who at Trupanion made it (`client_by`). She coordinates it; she doesn't sign off herself. Decisions are pending / cleared / changes requested, per asset or per code on a shared visual, with a note; clearing a code that went through with an overridden red flag (Pre-flight or copy) needs a note saying what Trupanion accepted (`overriddenReds`). **Ready to traffic** = Pre-flight passed (the creative lead's mark) AND compliance cleared on the current upload and wording (`Preflight.traffic()`, computed on read; codes marked before `COMPLIANCE_GATE_FROM` show "compliance not recorded"); handoff: `docs/build-log/studio-traffic-gate.md`. It's stored per code on each signed-off line's `compliance_by_code` (JSONB, with `upload_id` and `send_back`; older records on `compliance`), so there's no migration. Changes go back to Ready (copy) or Pre-flight (the visual: no longer Ready to traffic), and a new upload reopens the review. Ready shows compliance read-only. Handoff: `docs/build-log/studio-nick-fixes.md`.
- Ready for production (the step after Shortlist): creative sign-off per persona × territory (× region), never "approved". Red flags must be fixed (edit + re-check) or overridden with a reason; signed-off wording is versioned and never rewritten; the expectations record and naming stubs are stored for B4/B3b. Logic in `backend/src/services/studio/ready.ts`; handoff: `docs/build-log/B1-studio-p4.md`.
- Hosted (phase 3, off by default): `ENABLE_STUDIO=true` mounts `/api/studio` (`backend/src/routes/studio.ts`) behind `authMiddleware` plus `STUDIO_EMAILS`/`ADMIN_EMAILS` (`utils/studioAccess.ts`, fails closed), on `PgStore(pool)`, with a monthly budget `STUDIO_MONTHLY_CAP_USD` (default 50). Endpoints are shared with `serve` in `services/studio/router.ts`; change them there. Rules upload/activate are admin-only. Handoff: `docs/build-log/B1-studio-p3.md`.
- Run instructions, timings and gaps: `docs/build-log/B1-lite.md`.
- **On-image subhead** (rules v2.14 `meta_on_image_sub`, `on_image_role: sub`): optional, under the on-image headline, per visual and per carousel card. The draft's `on_image_sub` (same shape as `on_image`); planned and signed-off on-image entries carry their field (`isSubField` in versions.ts). In the handoffs, the version checks (a subhead reusing its headline's words is `VERSION_REPEAT`) and Pre-flight copy match (must be on the asset). Artwork copy (on-image headline + subhead) is persona-specific; post copy (primary, Meta headline, caption) is generic.
- **Check copy** (`services/studio/bulk.ts`, `components/studio/CopyCheck.tsx`): paste a table of someone's copy (persona, territory, field, text), preview what Studio makes of it and the cost, check every line as "Check my lines" does, and share the report (Markdown / CSV, also in Export). Lines are filed in a run per persona × territory, kept. Persona-less post copy goes to the **shared captions** pool: the loaded rules carry a built-in persona `ALL` / territory `SHARED` (engine.ts `SHARED_PERSONA`), flagged `shared` in `/meta` (see Shared captions below).
- **On behalf of** (`utils/actor.ts`): every recorded call has `by` (who entered it; the only person role checks use) and optionally `for` (whose call it is), chosen with the "for" picker and sent as `X-Studio-For`. JSON records carry `<verb>_for`; three text columns pack it as `by (for X)`. Exports say Decided by / Entered by. Handoff: `docs/build-log/studio-on-behalf-of.md`.
- **Shared captions** (built-in persona `ALL` × territory `SHARED`, `isShared` in engine.ts; no migration): post copy reused across personas. Written on Write in the shared context (post-copy fields only; the writer is given every persona's kept on-image headlines in the region, `approvedHeadlines`, `GET /approved-headlines`), reviewed like any run, and offered first in every territory's Build tray (`ReadyLine.shared`). There is no sign-off of the shared pair itself. The handoff lists `Caption ID` and `Shared caption`; features carry `caption_line_id`; Trupanion's decision on a shared caption can be recorded for every other code using the same wording (`apply_shared`, caption line only: each code's asset still needs its own decision). A retired territory with runs or sign-offs in the round stays reachable (`meta.retired_with_work`, `isOpenTerritory`), but takes no new briefs. On-image text that runs long is `LIMIT_ON_ASSET` ("long for on-image text"), never "cut off". Handoff: `docs/build-log/studio-shared-captions.md`.
- **Worksheet** (`services/studio/worksheet.ts`; Round 2, built in steps): the month's copy as one table per step (1 on-image copy by persona and asset, 2 shared primary texts, 3 shared headlines), a view over the runs with nothing new stored. PR 1 is the sheet: `GET /worksheet`, `GET /worksheet.xlsx` (the Round 1 workbook's shape; hidden `Row id` and `Hash` columns) and import with a preview (`POST /worksheet/import/preview`, then `/apply`: Keep / Cut / Rewrite and new lines, recorded for the "for" person, rewrites re-checked, lines changed since the export left alone unless chosen). Flag names: `utils/flagChips.ts` mirrors `frontend/src/lib/studioChips.ts`. Handoff: `docs/build-log/studio-worksheet.md`.
- **Flag report** (`services/studio/flagReport.ts`, `Preflight.flagReport`, `GET /preflight/flag-report.(md|html|csv)`): one internal document for the ads in view on Assets (never Trupanion's decision). A rules-file `flag_notes` entry (rule id → status note) is printed beside that rule's flags. Build shows each signed-off ad's latest upload read-only (`components/studio/Artwork.tsx`).
- **An ad is a visual** (Add3, 6 Oct): each visual runs as one ad with its versions' copy as text options; results are per ad. `adName` / `parseAdName` in `utils/namingCode.ts` are the one definition (the code without the line number); A1, A2, A3 are copy options, Studio's own ids. Per-ad exports: `/handoff-ads.csv`, `/compliance-sheet-ads.csv` (`adHandoff` in ready.ts). On screen a visual is "Ad A" and a version "copy option 2"; the board counts ads, one region at a time. The region is one switch in the header (`RegionSwitch`), followed by every screen. The disclaimer is checked by the asset's region (`disclaimer.text_by_region`, rules v2.16). Handoffs: `docs/build-log/studio-region-naming.md`, `docs/build-log/studio-status-review.md`.

## Weekly read, B3 (live ad performance)

VOICES v2 build 3 as a CLI: `backend/scripts/weekly.ts` over pure modules in `backend/src/services/weekly/` (naming, ingest, window, model, note, simulate, stats; `store.ts` is the only database code). Tables `live_ingests`, `live_ads`, `live_metrics` and `live_reads`, plus the view `live_latest_reads` (latest read per naming stub) (migration 016). Thresholds, column mapping, the prospecting/retargeting rule and wording rules live in `backend/config/weekly-read.json` (versioned; change with a dated entry). Local database only: the CLI refuses non-local hosts and never loads `backend/.env`. Notes, ledgers and simulated exports are written to `Claude outputs/voices-r1/weekly/` (client material, never committed). Ad-name forms (newer `PERSONA_TERRITORY_FORMAT_A2_REGION_PLATFORM_YYMMDD`, older `_v#_PLATFORM_`) are config (`naming.forms`), not code. Features join to Studio and B2 by naming stub, as text, never as a foreign key to `studio_*`. Run instructions, thresholds and open items for Add3: `docs/build-log/B3-weekly-read.md`.

## Pre-flight audit, B2 (script)

VOICES v2 build 2: `backend/scripts/audit.ts` (CLI) over `backend/src/services/audit/` (self-contained; imports nothing from Studio or weekly code). No database, no auth, no deploy. Reads the rules from `Claude outputs/voices-r1/studio/studio-rules.json` and the M3 rubric from `Claude outputs/voices-r1/rubric.json`; the OpenAI key from `~/.config/voices/openai.key` (never `dotenv.config()`). Assets in `Claude outputs/voices-r1/assets/<round>/`, named by naming code, either form (a folder of numbered cards is a carousel; `.mp4/.mov` is video; `<stub>.txt` is sidecar copy). Output in `Claude outputs/voices-r1/audit/<round>/`: `reports/<stub>.md`, `summary.md`, `features.csv` (for B3's `weekly.ts features --file`), `flag-sheet.csv`, `audit.json`, `calls.jsonl`; `audit/spend.json` is cumulative ($10 cap, `--yes` over $2).

- Library (the engine behind the hosted Studio's Pre-flight step): `services/audit/index.ts` exports `estimateAudit(input, opts)`, `runAudit(input, opts)` → report JSON (`report_version`), `featuresRow(report)`. Rules, rubric, files and the OpenAI client are arguments; it never reads the client folders. Thresholds in `services/audit/config.json`. Video needs ffmpeg (else audited on copy and voice-over with a note); voice-over is transcribed with gpt-4o-transcribe unless a transcript is given.
- Commands: `estimate --round R`, `run --round R [--only STUB] [--yes]`, `concepts [--only CODE] [--compare-only]` (the nine concept cards against the spike's M3 table), `plant` (planted test images), `agree --file SHEET` (agreement from Brook's marks), `status`. `--mock` runs free.
- Flags, never scores: red = compliance (a rule match, or the reviewer and the two-wording yes/no agreeing), amber = warning (intended persona's turn-offs, brand, clarity, limits, text load), grey = note (the other personas' turn-offs, UGC casting). Every flag carries its rules-file source.
- Run instructions, what each check does, agreement and costs: `docs/build-log/B2-preflight.md`.

## Roadmap

The Trupanion engagement build plan (evidence layer, copy-set tests, format dimension, reports, live-performance anchors, governance) is in `docs/trupanion-build-plan.md`. Phase 0 safeguards have shipped on `voices/trupanion-phase0`.

## Local development database

Never point a dev server or script at either Railway database: `yamanote` (pgvector) is production, `yamabiko` is legacy. Use a local Postgres 16 + pgvector on port 54329 and set `DATABASE_URL` explicitly (it wins over `.env`). Setup commands: `docs/build-log/S01-phase0.md`.

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_dev npm run db:migrate
DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_dev JWT_SECRET=local-dev-secret PASSWORD_AUTH=open npm run dev:backend
```

## Tests

```bash
cd backend && npm test   # node:test via tsx; RalphScore parity fixtures, concept-response score parsing, retry, weekly read
```

## Type Checking

```bash
cd frontend && npx tsc --noEmit   # Frontend type check
cd backend && npx tsc --noEmit    # Backend type check (some pre-existing pdf-parse type issues)
```
