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
| PUT | `/:id` | Update persona (optional `regenerate_voice`) |
| DELETE | `/:id` | Delete persona |
| POST | `/:id/variants` | Generate N variants via AI |
| GET | `/:id/variants` | List variants |
| POST | `/:id/voice` | Regenerate voice sample |

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
- `variant_config` — age_spread, attitude_distribution, platforms, focus_preset, focus_modifier

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
| `generateVariants` | N unique variants with controlled diversity | MODEL | 0.9 |
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
- **Auth**: JWT tokens. Demo mode (no auth header → demo user `demo@ralphvoices.com`) is opt-in via `ENABLE_DEMO_MODE=true`; otherwise missing auth returns 401.
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
- `PORT` — Backend port (default: 3001)
- `FRONTEND_URL` — For CORS (default: `http://localhost:5173`)
- `NARRATIV_SSO_SECRET` — HS256 signing secret shared with Narrativ for shell→tool SSO. Must be byte-identical to `TOOL_SSO_SECRET_VOICES` on Narrativ. Empty/unset = SSO disabled (password login still works).
- `NARRATIV_VOICES_WEBHOOK_SECRET`, `NARRATIV_BASE_URL` — outbound HMAC webhook for the Voices→Narrativ return signal (existing).

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
  back to the existing /login flow.

## Roadmap

The Trupanion engagement build plan (evidence layer, copy-set tests, format dimension, reports, live-performance anchors, governance) is in `docs/trupanion-build-plan.md`. Phase 0 safeguards have shipped on `voices/trupanion-phase0`.

## Local development database

Never point a dev server or script at either Railway database: `yamanote` (pgvector) is production, `yamabiko` is legacy. Use a local Postgres 16 + pgvector on port 54329 and set `DATABASE_URL` explicitly (it wins over `.env`). Setup commands: `docs/build-log/S01-phase0.md`.

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_dev npm run db:migrate
DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_dev JWT_SECRET=local-dev-secret npm run dev:backend
```

## Tests

```bash
cd backend && npm test   # node:test via tsx; RalphScore parity fixtures, concept-response score parsing, retry
```

## Type Checking

```bash
cd frontend && npx tsc --noEmit   # Frontend type check
cd backend && npx tsc --noEmit    # Backend type check (some pre-existing pdf-parse type issues)
```
