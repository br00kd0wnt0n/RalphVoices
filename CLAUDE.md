# Ralph Voices

Synthetic audience panel tool for testing creative concepts against AI-generated personas.

## Architecture

- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui (Radix primitives)
- **Backend**: Express.js + TypeScript (tsx runtime) + PostgreSQL + OpenAI GPT-4o
- **Monorepo**: npm workspaces (`frontend/`, `backend/`)

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
    db/           # PostgreSQL connection, schema, migrations, seed
    middleware/    # Auth middleware (JWT + demo mode)
    routes/       # Express routes: auth, projects, personas, tests, uploads, gwi
    services/     # AI (OpenAI) service, GWI Spark service
    utils/        # Shared constants, types
frontend/
  src/
    components/   # Reusable components (PersonaBuilder, PersonaCard, GwiBadge, ui/)
    hooks/        # Custom hooks (useGwi)
    lib/          # API client, constants, utilities
    pages/        # Route pages (Dashboard, ConceptFirst, PersonaFirst, TestResults, etc.)
    types/        # TypeScript interfaces
```

## Key Conventions

- **Brand color**: `#D94D8F` (pink) — used for primary accents, RalphScore, CTA buttons
- **GWI accent**: emerald/teal (`text-emerald-600`, `border-emerald-600`) for GWI-related UI
- **UI components**: shadcn/ui in `frontend/src/components/ui/` — don't modify these directly
- **API client**: All backend calls go through `frontend/src/lib/api.ts` (typed fetch wrapper)
- **Auth**: JWT tokens or automatic demo mode (no auth header → demo user)
- **Shared constants**: Sentiment/attitude thresholds in `backend/src/utils/constants.ts` and `frontend/src/lib/constants.ts` — keep in sync
- **Test focus presets**: Defined in `frontend/src/lib/constants.ts`, re-exported from `Settings.tsx`

## Two Test Creation Flows

1. **Concept-first** (default at `/tests/new`): Upload concept → discover audiences → configure & run
2. **Persona-first** (`/tests/new?mode=persona-first`): Select project/personas → enter concept → run

## GWI Spark Integration

Optional enrichment — app works fully without a GWI API key. When configured:
- Audience suggestions from market data during concept-first flow
- Persona validation against real demographics
- Market Insights tab on test results
- API key stored per-user in `settings` table

## Database

PostgreSQL with JSONB columns for flexible schema (psychographics, media_habits, gwi_audience_data, etc.).

Migrations in `backend/src/db/migrations/`. Schema for fresh installs in `backend/src/db/schema.sql`.

## Environment Variables

Backend (`.env`):
- `DATABASE_URL` — PostgreSQL connection string
- `OPENAI_API_KEY` — Required for persona generation and test responses
- `OPENAI_MODEL` — Model to use (default: `gpt-4o`)
- `JWT_SECRET` — For auth tokens (has development default)
- `GWI_API_KEY` — Optional, for GWI Spark integration
- `PORT` — Backend port (default: 3001)

Frontend (`.env`):
- `VITE_API_URL` — Backend API URL (default: `/api`)

## Type Checking

```bash
cd frontend && npx tsc --noEmit   # Frontend type check
cd backend && npx tsc --noEmit    # Backend type check (some pre-existing pdf-parse type issues)
```

## RalphScore™

Proprietary 0-100 benchmark: 30% sentiment + 30% engagement + 25% share likelihood + 15% comprehension, with sentiment distribution modifier. Calculated in `frontend/src/pages/TestResults.tsx`.
