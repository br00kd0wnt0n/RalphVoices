# Ralph Voices

A synthetic audience panel tool that creates AI personas calibrated to client briefs and tests creative concepts against persona variants.

## Core Value Proposition

Replace gut-check with pattern recognition. Instead of asking "will this land?" teams ask "what patterns emerge when we expose this to a statistically meaningful synthetic cohort?"

## Features

- **Persona Builder**: Create detailed AI personas with psychographics, media habits, brand context, and cultural markers.
- **Variant Generator**: Generate 10-100 diverse variants from each base persona.
- **Concept Testing**: Test creative concepts (text + images + PDFs + strategic context) against your synthetic audience panel.
- **Results Dashboard**: RalphScore™, sentiment, brain balance, emotional spectrum, key associations, shareability analysis, themes, recommendations.
- **Insights Chat**: SSE streaming chat over a finished test's findings.
- **Real-time Progress**: WebSocket-based progress tracking during test execution.
- **Project scoping**: Personas and tests live inside projects; calibration anchors stay scoped per-project so client data never crosses tenants.

## Tech Stack

- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui (Radix primitives) + recharts + framer-motion
- **Backend**: Express.js + TypeScript (tsx runtime)
- **Database**: PostgreSQL + pgvector
- **AI**: OpenAI `gpt-4o` for chat / vision; `text-embedding-3-small` for embeddings (vector-based disposition scoring)
- **Object storage**: Cloudflare R2 (optional, gated by `ENABLE_R2_STORAGE`)
- **External integration**: GWI Spark — dormant by default, gated by `ENABLE_GWI`
- **Deployment**: Railway (backend + frontend as separate services)

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL with the `pgvector` extension
- OpenAI API key

### Installation

```bash
cd ralph-voices
npm install
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL, OPENAI_API_KEY, JWT_SECRET
npm run db:migrate
npm run db:seed   # optional
npm run dev
```

This starts:

- Backend API on http://localhost:3001
- Frontend on http://localhost:5173

### Demo / login

`npm run db:seed` creates a real seeded user you can log in with at `/login`:

- Email: `demo@ralph.world`
- Password: `demo123`

There is also a separate **demo mode** (auto-login of unauthenticated requests as `demo@ralphvoices.com`) that is **off by default**. Set `ENABLE_DEMO_MODE=true` to opt in for pitch demos. Do **not** turn this on in any client-facing or shared deployment — see "Safety flags" below.

## Safety flags

| Env var                | Default | Effect                                                                                                                                                                       |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`           | —       | Required. Server refuses to boot if missing or set to the literal `development-secret-change-me`.                                                                            |
| `ALLOW_INSECURE_JWT`   | `false` | Re-enables the insecure JWT fallback when combined with `NODE_ENV=development`. Never set in production.                                                                     |
| `ENABLE_DEMO_MODE`     | `false` | When true, requests with no `Authorization` header are silently logged in as `demo@ralphvoices.com`. **Off in any shared deployment.** A warning is logged at boot when on.  |
| `ENABLE_GWI`           | `false` | When true (and `GWI_API_KEY` is supplied), enables GWI Spark integration. Otherwise every GWI method short-circuits with a structured "disabled" response.                   |
| `ENABLE_R2_STORAGE`    | `false` | When true, uploaded images/PDFs go to Cloudflare R2 and are referenced by URL. When false, they're stored as base64 inline in `tests.options` JSONB (legacy behaviour).      |
| `TEST_RETENTION_DAYS`  | unset   | When set to a positive integer N, completed tests older than N days are auto-archived and their `options.assets` blob is nulled out. Test metadata + scoring are preserved.  |

GWI reactivation when a commercial deal closes is a single env-var flip (`ENABLE_GWI=true`) plus a valid key — no code change.

## Project Structure

```
ralph-voices/
├── backend/
│   ├── scripts/
│   │   └── migrate-assets-to-r2.ts   # one-time legacy assets → R2 migrator
│   └── src/
│       ├── db/
│       │   ├── schema.sql
│       │   └── migrations/           # auto-applied on boot
│       ├── middleware/auth.ts        # JWT + opt-in demo mode
│       ├── routes/                   # auth, projects, personas, tests, uploads, gwi, anchors
│       ├── services/                 # ai, embeddings, gwi, rcb-client, r2
│       └── index.ts                  # Express + WebSocket + boot-time safety checks
├── frontend/
│   └── src/
│       ├── components/               # custom + ui/ (shadcn/ui)
│       ├── hooks/                    # useAuth, useGwi
│       ├── lib/                      # api client, constants, utilities
│       ├── pages/                    # Dashboard, Projects, Personas, NewTest, TestResults, etc.
│       └── types/
└── package.json                      # npm workspaces
```

## API Endpoints

### Auth (`/api/auth`)

- `POST /register` — register new user
- `POST /login` — log in
- `GET /me` — current user

### Projects (`/api/projects`)

- `POST /` — create project (optional `copy_persona_ids`)
- `GET /` — list projects with persona/test counts
- `GET /:id` — project detail with personas + tests
- `PUT /:id` — update project
- `DELETE /:id` — cascading delete

### Personas (`/api/personas`)

- `POST /` — create persona + auto-generate voice sample
- `GET /` — list (optional `?project_id=`)
- `GET /:id` — persona with variants
- `PUT /:id` — update (optional `regenerate_voice`)
- `DELETE /:id` — delete persona
- `POST /:id/variants` — generate N variants
- `GET /:id/variants` — list variants
- `POST /:id/voice` — regenerate voice sample

### Tests (`/api/tests`)

- `POST /` — create test
- `GET /` — list tests (optional `?project_id=`)
- `GET /:id` — test detail (status, personas, results, progress)
- `POST /:id/run` — start background processing
- `POST /:id/cancel` — cancel a running test
- `GET /:id/responses` — paginated, filterable
- `GET /:id/results` — aggregated results
- `POST /:id/chat` — SSE streaming insights chat
- `GET /:id/recommendations` — AI-generated executional recommendations (cached on first call into `test_results.recommendations`; subsequent calls return the cached value)
- `GET /:id/export` — full JSON report
- `DELETE /:id` — delete test (cascades to responses, results, derived calibration anchors; clears in-memory progress)
- `WS /ws/tests/:id/progress` — real-time progress

### Uploads (`/api/uploads`)

- `POST /` — single file (image or PDF). When `ENABLE_R2_STORAGE=true`, image/PDF buffers go to R2 and the response includes a `url`; otherwise base64 is returned inline.
- `POST /multiple` — up to 5 files

### GWI Spark (`/api/gwi`)

All GWI routes return `{ enabled: false }` (plus a `reason`) when the integration is dormant.

- `POST /status` — `{ enabled, features, integration_enabled, reason }`
- `POST /suggest-audiences`
- `POST /validate-persona`
- `POST /enrich-results`
- `POST /settings` — save per-user GWI API key

### Anchors / admin (`/api/anchors`)

- `GET /stats` — anchor counts + persona embedding coverage
- `GET /personas` — per-persona embedding status
- `GET /recent` — recent anchors with context
- `POST /seed` — backfill embeddings + seed anchors from history
- `DELETE /all` — clear all anchors (recalibration)

## Data handling

This is the truthful description of what data leaves the box.

### Third-party services

- **OpenAI** (active): receives concept text, persona profiles, uploaded image content (vision calls force `gpt-4o`), and PDF-extracted text. Used for chat completion, embeddings (`text-embedding-3-small`), and streaming insights chat.
- **GWI Spark** (gated, currently disabled): when `ENABLE_GWI=true`, receives extracted topic strings derived from concept text and persona demographic summaries. Currently inactive — no live commercial agreement.
- **Cloudflare R2** (optional): when `ENABLE_R2_STORAGE=true`, original image and PDF bytes are stored under UUID-prefixed object keys.
- **Ralph Context Base** (optional): when `RCB_URL` and `RCB_API_KEY` are set, completed test results (test name, concept text, summary, segments, themes) are mirrored to RCB.

### OpenAI training posture

Voices uses the default OpenAI SDK configuration. **No zero-data-retention header is set by the application.** Whether OpenAI uses Voices traffic for training depends on the workspace policy of the OpenAI account whose API key is configured — not on anything this code asserts. If zero-retention is required for a specific deployment, configure it via your OpenAI enterprise agreement.

### Persistent storage

- Concept text, strategic context, persona profiles, generated variants, individual responses, and aggregated results are persisted in PostgreSQL.
- By default, uploaded images and PDFs are stored base64-encoded inside `tests.options.assets`. With `ENABLE_R2_STORAGE=true`, only the R2 URL is stored in JSONB; the bytes themselves live in the bucket.
- Vector embeddings (`text-embedding-3-small`) are stored on `personas` and `tests` for disposition scoring.
- Calibration anchors are scoped to the project they were derived from (`reference_anchors.project_id`); cross-tenant calibration is opt-in only via `is_global_calibration`.

### Deletion / retention

- `DELETE /api/tests/:id` removes the test, its responses, results, derived calibration anchors, and uploaded assets in one shot. Owner-only (verified via the parent project's `created_by`). The frontend exposes this on the test results page with a confirmation dialog.
- Setting `TEST_RETENTION_DAYS=N` archives completed tests older than N days and nulls out their `options.assets` (uploaded files). Test metadata + scoring results are preserved so historical reporting still works.
- There is currently no automated user-data export; deletion is the supported path.

## Database

`backend/src/db/schema.sql` defines the base tables. Migrations in `backend/src/db/migrations/` are auto-applied on server startup. Key schema notes:

- `personas` carry four facet embeddings (`embedding_values`, `embedding_platform`, `embedding_cultural`, `embedding_demographic`) plus `gwi_audience_data`.
- `tests.options` (JSONB) holds uploaded `assets`, `strategic_context`, and `variant_config` extras.
- `test_results` holds `summary`, `segments`, `themes`, `recommendations` (cached), and `gwi_enrichment` (when GWI was active).
- `reference_anchors` are project-scoped (`project_id` + `is_global_calibration`).
- `test_progress` mirrors live progress so a backend restart doesn't lose in-flight state.

## Type Checking

```bash
cd frontend && npx tsc --noEmit
cd backend && npx tsc --noEmit   # some pre-existing pdf-parse type warnings
```

## Cost

Each test with 50 variants generates ~50 GPT-4o calls (~$1-3) plus voice and variant-generation calls. Embeddings calls add a small fixed cost per persona/test.

## License

Proprietary — Ralph Agency.
