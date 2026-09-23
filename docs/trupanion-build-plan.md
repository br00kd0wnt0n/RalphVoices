# VOICES × Trupanion: sequenced build plan
*Response to `voices-architect-brief.md`. Codebase checked 23 Sep 2026 at `fda3131`. All sizing is in solo, AI-assisted build days.*

---

## 0. What the brief is missing (found in code, and it changes the plan)

Everything in the brief's "already knows" section is correct. Six more findings matter for this engagement, and three of them would quietly break it:

| # | Finding | Where | Why it matters for Trupanion |
|---|---|---|---|
| A | **Regenerating a persona's variants deletes its test history.** `POST /personas/:id/variants` runs `DELETE FROM persona_variants WHERE persona_id = $1`, and `test_responses.variant_id` is `ON DELETE CASCADE`. | `routes/personas.ts:314`, `schema.sql` | Refreshing a twin after an evidence update would erase every earlier pre-test response for that persona. That kills predicted-vs-actual before it starts. **Has to be fixed before any Trupanion twin exists.** |
| B | **Synthetic anchors are auto-seeded after every test** and pull later scores towards earlier ones (weighted mean ±1.5, `ANCHOR_K=10`, min similarity 0.5). | `routes/tests.ts` (post-results), `services/embeddings.ts:174–262` | A copy-set scores near-identical lines against the same persona, so embedding similarity is high. Message 1's scores would limit message 2's range, message 2's would limit message 3's, and so on. The leaderboard would be compressed towards noise. At copy-set scale this also writes about 1,200 self-referential anchors per round. |
| C | **Missing anchor scores are treated as 5, not skipped** (`getValue(a) \|\| 5`). | `embeddings.ts:242` | Live anchors can't honestly fill sentiment or comprehension. Without a fix, every live anchor would drag those dimensions towards 5. |
| D | **Only one of the four persona facets is used in scoring.** Disposition compares `embedding_values`; the platform, cultural and demographic facets are computed and stored but never read. | `embeddings.ts:212–219` | This answers the brief's "fifth facet?" question: a fifth facet would be just as unused (see §3, Q1). |
| E | **Failed variants are dropped silently.** A 429 or parse error returns `null`, and the test completes with fewer panel members. | `routes/tests.ts` `processTestResponses` | Copy-set rankings need the same panel on every message. Uneven dropout across messages skews the comparison. |
| F | **Confidential data leaves the project.** Completed tests are mirrored to RCB (`rcb.ingest`) and, when the test came from Narrativ, sent back by webhook. Personas from any project can also be used in any project's test. | `routes/tests.ts:788–825`, `POST /tests` persona check | Trupanion concepts and scores go to RCB automatically. Once twins carry evidence, a Trupanion persona used in another client's test would bring Trupanion evidence into that client's scoring, which breaks the brief's multi-tenant rule. |

Smaller issues:
- Concept-first setup says "No variants — will be generated" (`ConceptFirst.tsx:678`), but nothing generates them. Those personas are silently skipped, and `variants_per_persona` is ignored when the test runs.
- Images go to the model at `detail: 'low'` (`ai.ts:356`), so small body copy and CTAs on statics are probably unreadable.
- Platform defaults are TikTok, Instagram, YouTube and Twitter/X; the Trupanion scope is Meta and TikTok.
- `DELETE /anchors/all` is open to any signed-in user.

**Timing mismatch to note:** the billing sheet bills twin setup and pre-testing in Month 2, but the brief needs evidence-seeded twins in Month 1 for the Tier 1 pre-test. That's fine operationally; it just means the Month 1 twin work is done ahead of when it's billed.

---

## 1. Terminology (decided)

| Term | Meaning | Code name |
|---|---|---|
| **Panel member** | One synthetic person in a twin's panel | `persona_variants` (table name unchanged) |
| **Twin** | Persona + evidence + frozen panel | `personas` |
| **Message** | One copy or tone line the client scope calls a "variant" | `messages` (new) |
| **Copy set** | M messages scored by one shared panel | `test_type = 'copy_set'` |
| **Round** | One creative cycle (Round 1 = Tier 1) | `rounds` (new) |

In the UI, "variants" becomes "panel members" everywhere. "Variant" is never used for copy.

---

## 2. Sequenced plan

Today is Wed 23 Sep. At roughly 2–2.5 build days a week alongside the engagement, **October is the tight month**; see the load note under Phase 2.

### Phase 0: safeguards, before any Trupanion twin is built (24–30 Sep, 2.0 days)
Everything here is additive or default-off. Existing tests behave exactly as they do today.

| Item | Days |
|---|---|
| Freeze panels: variants with responses are soft-retired (`retired_at`) instead of deleted; `panel_version` increments; the run query filters `retired_at IS NULL` (Finding A) | 0.5 |
| `variant_config.vector_constraints` (default `true`): when `false`, skip disposition and skip anchor seeding for that test (Finding B). This is a runner change, but opt-in only. | 0.25 |
| Retry with backoff on 429 or parse failure (2 retries) before dropping a panel member; record dropouts on the test (Finding E) | 0.25 |
| RalphScore moved server-side: shared util, stored in `test_results.summary.ralph_score` plus `ralph_score_version`; one-off backfill; frontend reads the stored value and falls back to computing it. Unit test against the current client formula with fixtures so historical numbers don't shift. | 0.5 |
| `segments.by_persona` added to `calculateSegments`, plus a Segments tab card | 0.25 |
| `options.image_detail` (`low` default \| `high`); fix "will be generated" (generate on run, or block with a clear message); per-test platform list | 0.25 |
| `DELETE /anchors/all` restricted to an admin allowlist (`ADMIN_EMAILS` env) | ~0 (15 min) |

### Phase 1 (October): Gap 1 evidence layer, noise floor and the Month-1 predicted-vs-actual minimum (5.5 days)

| Item | Days |
|---|---|
| Migration 008 `persona_evidence` (§4) | 0.25 |
| Evidence CRUD, plus **import**: paste a pack section → LLM extracts draft items (claim, quote/stat, source, date, facet, visibility, confidence, pack_ref) → review table → commit. Commit bumps `evidence_version` and rebuilds `evidence_digest`. | 1.0 |
| Inject evidence into the voice-sample, panel-generation and response prompts. Only `visibility='persona'` items reach the response prompt (§6, risk 1). Record the `evidence_version` and `panel_version` used on each test. | 0.75 |
| Evidence panel on persona detail (a new panel, not a builder redesign); evidence badge on persona cards | 1.0 |
| Citations in the JSON export; rule that personas with evidence can only be used in their own project's tests; project persona-copy gets `include_evidence` (default false) (Finding F) | 0.25 |
| **Drift check:** a golden set of 6 concepts (2 per persona) run before and after evidence injection, comparing distributions and ranks (§6, risk 1) | 0.5 |
| **Noise floor:** run the same golden set twice at the same evidence and panel version, and measure how far scores move when nothing has changed. That gap becomes the project's `min_detectable_diff`; leaderboards show anything inside it as a tie. | 0.5 |
| **Month-1 PvA minimum** (§3, Q5): `ad_code` on tests (in `options`, no migration) and `GET /projects/:id/predictions.csv` | 0.5 |
| Build the three twins from the pack. Content work in Brook's time; no build days. ~1.5 h per persona. | — |

Milestone: twins seeded by about 9 Oct. The 13 Tier 1 concepts get pre-tested as ordinary concept tests with `vector_constraints=false`, `image_detail=high`, and an `ad_code` each.

### Phase 2 (late Oct → mid Nov): Gap 2 copy-set, performance questions and compliance check (8.0 days)

| Item | Days |
|---|---|
| Migration 009: `rounds`, `messages`, `tests.parent_test_id / message_id / round_id` (§4) | 0.5 |
| Copy-set create (parent + one child concept test per message); orchestrator runs children K at a time with the existing `processTestResponses` **unchanged**; children forced to `vector_constraints=false`; progress rolled up to the parent over WS | 1.5 |
| `panel_limit` for sweeps (e.g. 8 members, stratified by attitude); full panel for finalists; configurable `BATCH_SIZE` via env | 0.5 |
| Leaderboard endpoint: per persona, mean RalphScore and dimensions, bootstrap 95% CI, **paired** differences (same panel), "tied with" groups, top tags, best and worst quote | 0.5 |
| UI: copy-set create (paste lines or upload CSV: text, territory, tone, format), leaderboard page with kill / finalist / "re-run finalists on full panel" | 2.0 |
| Test list hides children by default | 0.25 |
| **Stop-or-scroll and feed framing** (brought forward from Phase 3): the response prompt opens with the feed context ("You're scrolling Reels; most ads you skip…") and asks for a yes/no stop-or-scroll decision *before* any reasoning. Default on for copy-sets, opt-in for plain concept tests. Stored in `extra_scores.stop`. | 0.5 |
| **Performance questions** (standard for Trupanion, previously optional in Phase 3): quote intent, trust up/down, unprompted brand recall, and a one-line takeaway. A second model call checks the takeaway against the test's `intended_takeaway` field. All stored in `test_responses.extra_scores`. The leaderboard ranks by a versioned **Performance Index**; RalphScore is unchanged. | 1.0 |
| **Compliance check** on messages (§2a): instant phrase rules plus a model review against project and persona rules, with results stored as `messages.compliance_flags`. Flags only, never blocks. | 1.0 |
| Contingency | 0.25 |

**October load:** Phases 0 and 1 (7.5 days) fit comfortably in October. Phase 2 grows to 8.0 days with the gap-review additions, so it starts in the last week of October and runs to mid-November. The copy-set backend and the performance questions go first (they're what the Month 2 pre-test needs); the leaderboard UI and compliance screens follow. Until then, the manual fallback in §8 covers the gap. The brief puts gap 2 in October: the backend can make it, the full UI can't.

### Phase 3 (November): Gap 4 format dimension (2.25 days), head-to-head (1.5 days), then Gap 5 report (4.0 days)

| Item | Days |
|---|---|
| Format fields live on `messages` (already in migration 009) and in `tests.options.format` for plain concept tests | 0.25 |
| Placement detail added to the Phase 2 feed framing (platform, aspect ratio, sound on/off) | 0.25 |
| **Carousels as a swipe sequence:** slides shown one at a time, with "would you swipe on?" asked at each, producing a drop-off curve per carousel. **Video** as script plus up to 6 time-stamped keyframes, with the first-2-seconds frame weighted as the hook. | 1.0 |
| Extended tag vocabulary: `thumb_stopping`, `scroll_past`, `clear_offer`, `feels_like_an_ad`, `trust_raised`, `trust_lowered`. Kept in sync across both constants files. | 0.25 |
| Leaderboard and segments grouped by format | 0.5 |
| **Head-to-head** (§2a): finalists shown 2–4 at a time in random order; each panel member picks the one that would stop them and the one they'd tap; ranked by win rate. Uses `test_responses.preferred_option`. Sequence: sweep → top 5 → head-to-head → recommendation. | 1.5 |
| Report model: `GET /rounds/:id/report?persona_id=` → ranked messages, real quotes, evidence citations (from evidence embeddings, see Q1), format breakdown, PvA section (empty until Phase 4), next-round brief draft | 1.5 |
| Print-styled report route in the frontend → browser "Save as PDF" (no headless Chrome on Railway) | 1.5 |
| Branding and QA against a real Round 1 dataset | 1.0 |

Milestone: the round-close report for Round 1/2 is produced from the tool at the end of November.

### Phase 4 (December): Gap 3 performance ingestion (5.5 days), then Gap 6 governance (1.5 days)

| Item | Days |
|---|---|
| Migration 011: `ad_performance_imports`, `ad_performance`, anchor columns (§4) | 0.5 |
| CSV import (SuperAds and TikTok export) with a saved column map; Add3 naming-convention parser → `message_id` / `persona_id`; a queue for rows that don't match | 1.5 |
| Normaliser and live-anchor builder (§3, Q3; §7). Anchors are **derived and can be rebuilt** from the raw table. | 1.0 |
| `computeDisposition`: skip NULLs per dimension (Finding C); retrieve top-K per source; `LIVE_ANCHORS_MODE` = off \| shadow \| on per project | 0.5 |
| Predicted-vs-actual view: per persona pairwise ordering accuracy, Spearman ρ, a scatter chart, and a top-vs-bottom hit check. Slots into the Phase 3 report. | 1.5 |
| Tests on the normaliser (fixture CSVs) | 0.5 |
| Governance: anchor endpoints require `project_id`; `/anchors/seed` checks the test's project; global calibration and delete limited to admins; `users.role` | 1.0 |
| Optional `projects.restricted` + `project_members` so client-confidential projects drop out of universal visibility | 0.5 |

**Total:** about 30.5 build days plus 20% contingency, so about 37 days over 13 weeks. Dependency order: 0 → 1 → 2 → (4 ∥ 5) → 3 → 6. Phase 0's panel freeze blocks everything else. Gap 3 depends on gap 2's `messages` table for the ad→message join. Gap 5's PvA section depends on gap 3. The cheap parts of gap 6 have been pulled into Phase 0 and Phase 1.

### 2a. Gap-review additions: design notes

**What the tool can and can't judge.** Say this plainly to the client. Voices judges the idea, the hook line, a static's headline and copy, a script, and key frames. It can't judge edit pacing, sound or on-camera delivery; video craft stays with creative review.

**Performance questions.** Asked in a fixed order so the decision comes before any rationalising:

| Field (`extra_scores`) | Question | Scale |
|---|---|---|
| `stop` | Scrolling past, do you stop on this? Answered before anything else. | yes/no |
| `quote_intent` | Would you tap "Get a quote"? | 1–10 |
| `trust_shift` | Does this make you trust the brand more or less? | −2 … +2 |
| `brand_recall` | Who was this ad for? (unprompted; the checker marks correct / wrong / don't know) | enum |
| `takeaway` + `takeaway_match` | The one thing this ad told you, then a separate model call scores it against `intended_takeaway` | text + 0–1 |

**Performance Index v1** (0–100): 30% stop rate + 30% quote intent + 20% takeaway match + 20% trust shift (rescaled). The weights are a starting guess, versioned as `pi_version`, and re-weighted in December against predicted-vs-actual. RalphScore is untouched so every past number stays the same.

**Compliance rules** (migration 010 `project_rules`), each with a `scope` (project or persona), a `kind` and a message:
- `required_phrase`: e.g. "medical insurance for pets" (pending Add3 confirmation).
- `banned_phrase`: e.g. "lock in", "low puppy rates", "pays for itself", "affordable" as a lead claim.
- `requires_qualifier`: e.g. "paid directly" / "at checkout" must be accompanied by "participating hospitals".
- `persona_watch_out`: seeded from the evidence pack's watch-outs, e.g. Empty Nesters: no "fur baby" or "pet parent"; DINKs: no "it pays for itself"; Busy Families: no shaming the uninsured.

The instant phrase checks run on every save; the model review runs on demand and before a copy-set runs. Each flag cites the rule it breaks. This is a pre-screen, not legal review: Trupanion's compliance process is still undefined.

**Head-to-head.** Matchups are balanced so every finalist appears equally often in each position (this cancels position bias). There's one response row per panel member per matchup, with `preferred_option` = the message id and `matchup` = the ids in the order shown. Results show a win rate per finalist with a confidence range. It's used for finalists only; running it on 20 messages would need too many calls.

---

## 3. Answers to the architect questions

**Q1. Evidence as JSONB on `personas`, or a child table? A fifth embedding facet?**
Use a **child table**, `persona_evidence`. Each item needs its own provenance, status, visibility and a stable id that report citations can point to. JSONB makes all of those awkward and makes edits race with each other. A compiled `personas.evidence_digest` (text) plus `evidence_version` gives the prompts a stable, cacheable block, and lets each test record which evidence it ran against.

**Don't add a fifth scoring facet.** Disposition only reads `embedding_values` today (Finding D), so another facet would change nothing. Put a nullable `embedding` on each evidence item and use it in Phase 3 for *citation retrieval*: which evidence does this message activate, for the report. The pack fits in context in full (about 30–40 items per persona), so retrieval isn't needed for prompting. Revisit scoring facets only once live anchors exist and there's a result to compare against.

**Q2. New `test_type` with `options.messages[]`, or parent/child?**
Use **parent/child**, plus a first-class `messages` table. Each child is an ordinary concept test, so `test_responses`, `processTestResponses`, results, segments, the results page and the export all work without changes. The parent is a `tests` row with `test_type='copy_set'` that holds shared config and rolls up progress. Putting messages in `options` would need a `message_id` on `test_responses`, a runner loop over messages, and per-message concept embeddings. All three touch the current runner, which the brief rules out.

The anchor pipeline stays unchanged *in code*, but copy-set children must run with `vector_constraints=false` (Finding B). `messages` is the durable spine of the whole loop: lineage across rounds (`parent_message_id`), status (killed / finalist / live), `ad_code` for the SuperAds join, and format metadata. Child tests are one test of a message; the message outlives them.

**Q3. Live anchors: one per asset × persona, or per asset?**
**One anchor per (message, persona ad set, platform), cumulative over the flight.** SuperAds rows are already per ad per ad set, and persona-per-ad-set is agreed with Add3, so the persona is known from the ad set, not guessed. The persona embedding is a frozen copy of that twin's `embedding_values`; the concept embedding is the message's. If an asset ran in several persona ad sets (the round-two matrix idea), each ad set is a separate anchor with its own delivery and its own result. That's the point: same message, different audience, different outcome. Weekly rows are summed before anchoring so each anchor reaches enough volume. The targeting-purity factor in confidence (§7) discounts ad sets where Advantage+ or broad expansion blurs who actually saw the ad.

**Q4. Where does server-side RalphScore live?**
**Computed when results are written and stored** in `test_results.summary` (`ralph_score`, `ralph_score_version`). Not a view. The formula has a distribution modifier and will change, and a client report can't have its numbers shift after it's delivered. Versioning plus stored values keeps delivered numbers fixed; a backfill script recomputes on purpose when needed. It's JSONB, so no migration.

**Q5. The smallest thing that makes PvA possible for Tier 1 in Month 1?**
Three things, about 0.5 build days:
1. The Phase 0 panel freeze, so predictions can't be erased.
2. Store the Add3 `ad_code` on each Tier 1 pre-test.
3. Add `GET /projects/:id/predictions.csv` (ad_code, persona, territory, format, stored RalphScore, four means, n, evidence/panel version).

Each week, join that with the SuperAds CSV in a Sheet. Log predictions **before** looking at any in-market read, so the comparison is blind even if some Tier 1 assets are already live. Be honest about the scale: 13 concepts is about 4–5 per persona. Report pairwise ordering accuracy with counts (e.g. "7 of 10 pairs ordered correctly"), not correlations with p-values.

---

## 4. Schema sketches (all additive, idempotent, `IF NOT EXISTS`)

```sql
-- 007_panel_freeze.sql  (Phase 0)
ALTER TABLE persona_variants ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
ALTER TABLE persona_variants ADD COLUMN IF NOT EXISTS panel_version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_variants_active ON persona_variants(persona_id) WHERE retired_at IS NULL;
-- Backfill: none. Every existing variant is active at panel_version 1.

-- 008_persona_evidence.sql  (Phase 1)
CREATE TABLE IF NOT EXISTS persona_evidence (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id    UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,   -- denormalised for scoping checks
  kind          VARCHAR(20) NOT NULL CHECK (kind IN ('verbatim','statistic','finding','trigger','watch_out')),
  facet         VARCHAR(30) NOT NULL,          -- values | pain_points | language | media | brand | category | format
  visibility    VARCHAR(10) NOT NULL DEFAULT 'persona' CHECK (visibility IN ('persona','analyst')),
  claim         TEXT NOT NULL,
  quote         TEXT,                          -- exact verbatim, when kind = verbatim
  stat_value    TEXT,
  source_name   TEXT NOT NULL,
  source_url    TEXT,
  source_date   DATE,
  sample_size   INTEGER,
  geography     VARCHAR(20),                   -- 'US' | 'UK-proxy' ... (pack flags UK forum language)
  confidence    VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','low')),
  trigger_rank  SMALLINT,
  pack_ref      VARCHAR(120),                  -- 'trupanion-evidence-pack-v1 §3.1'
  status        VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
  embedding     vector(1536),                  -- filled in Phase 3 for citation retrieval
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_evidence_persona ON persona_evidence(persona_id) WHERE status = 'active';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS evidence_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS evidence_digest TEXT;
-- source_type is VARCHAR: twins built from the pack use 'evidence_pack' (no enum change needed).

-- 009_copy_sets.sql  (Phase 2; also carries the Gap 4 format fields)
CREATE TABLE IF NOT EXISTS rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL, name VARCHAR(255),
  starts_on DATE, ends_on DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'planning',   -- planning | pretest | live | closed
  next_brief TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, number)
);
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_id UUID REFERENCES rounds(id) ON DELETE SET NULL,
  persona_id UUID REFERENCES personas(id) ON DELETE SET NULL,
  parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,   -- lineage across rounds
  territory VARCHAR(120),          -- 'Never the Choice'
  label VARCHAR(120),
  body TEXT NOT NULL,              -- headline / copy / script
  tone VARCHAR(60),
  format VARCHAR(20) CHECK (format IN ('static','video','carousel','ugc','text')),
  aspect_ratios VARCHAR(8)[],      -- {'1:1','4:5','9:16'}
  platforms VARCHAR(20)[],         -- {'meta','tiktok'}
  style VARCHAR(60),
  ad_code VARCHAR(120),            -- Add3 naming-convention key
  status VARCHAR(20) NOT NULL DEFAULT 'draft',  -- draft|tested|killed|finalist|produced|live|retired
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_ad_code ON messages(project_id, ad_code) WHERE ad_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_round_persona ON messages(round_id, persona_id);
ALTER TABLE tests ADD COLUMN IF NOT EXISTS parent_test_id UUID REFERENCES tests(id) ON DELETE CASCADE;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS round_id UUID REFERENCES rounds(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tests_parent ON tests(parent_test_id);
-- Backfill: none. Existing tests keep NULL parent/message/round and render exactly as today.

-- 010_performance_and_rules.sql  (Phase 2)
ALTER TABLE test_responses ADD COLUMN IF NOT EXISTS extra_scores JSONB;   -- stop, quote_intent, trust_shift, brand_recall, takeaway(_match)
ALTER TABLE test_responses ADD COLUMN IF NOT EXISTS matchup JSONB;        -- head-to-head: message ids in the order shown
ALTER TABLE messages ADD COLUMN IF NOT EXISTS compliance_flags JSONB;     -- [{rule_id, severity, excerpt, note}]
ALTER TABLE messages ADD COLUMN IF NOT EXISTS compliance_checked_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS project_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,         -- NULL = applies to the whole project
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('required_phrase','banned_phrase','requires_qualifier','persona_watch_out','guidance')),
  pattern TEXT,                    -- phrase or regex for the instant checks
  qualifier TEXT,                  -- for requires_qualifier
  message TEXT NOT NULL,           -- shown on the flag
  severity VARCHAR(10) NOT NULL DEFAULT 'warn' CHECK (severity IN ('info','warn','block')),
  source VARCHAR(120),             -- 'Add3 naming rule', 'evidence pack §3.2 watch-outs'
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rules_project ON project_rules(project_id) WHERE active;
-- intended_takeaway and min_detectable_diff live in tests.options / project settings JSON: no columns needed.

-- 011_ad_performance.sql  (Phase 4)
CREATE TABLE IF NOT EXISTS ad_performance_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source VARCHAR(30) NOT NULL,     -- superads_csv | tiktok_csv | manual
  filename TEXT, period_start DATE, period_end DATE,
  column_map JSONB, row_count INTEGER,
  imported_by UUID REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ad_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES ad_performance_imports(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform VARCHAR(10) NOT NULL,   -- meta | tiktok
  ad_id VARCHAR(100), ad_name TEXT NOT NULL, ad_set_name TEXT, campaign_name TEXT,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  persona_id UUID REFERENCES personas(id) ON DELETE SET NULL,
  format VARCHAR(20), aspect_ratio VARCHAR(8), targeting VARCHAR(20),   -- persona | broad | advantage_plus
  period_start DATE, period_end DATE,
  impressions BIGINT, link_clicks INTEGER, spend_cents BIGINT, engagements INTEGER,
  shares INTEGER, video_3s_views INTEGER, conversions INTEGER,
  raw JSONB NOT NULL,              -- the whole source row, always kept
  match_status VARCHAR(12) NOT NULL DEFAULT 'unmatched',   -- matched | unmatched | ignored
  UNIQUE (project_id, platform, ad_id, ad_set_name, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_adperf_message ON ad_performance(message_id);
ALTER TABLE reference_anchors ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE reference_anchors ADD COLUMN IF NOT EXISTS outcome JSONB;         -- raw metrics, percentiles, cohort, n
ALTER TABLE reference_anchors ADD COLUMN IF NOT EXISTS normaliser_version SMALLINT;
CREATE INDEX IF NOT EXISTS idx_anchors_project_source ON reference_anchors(project_id, source);
-- Synthetic re-weight (safe: a uniform scale of a weighted mean is a no-op for any project with no live anchors):
UPDATE reference_anchors SET confidence = 0.5 WHERE source = 'historical' AND confidence = 1.0;

-- 012_governance.sql  (Phase 4)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'member';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS restricted BOOLEAN NOT NULL DEFAULT FALSE;   -- optional
CREATE TABLE IF NOT EXISTS project_members (                                              -- optional
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);
```

---

## 5. API and frontend changes

| Phase | Endpoint / shape | Frontend |
|---|---|---|
| 0 | `POST /personas/:id/variants` soft-retires instead of deleting; response adds `panel_version`. `POST /tests` accepts `variant_config.vector_constraints`, `options.image_detail`, `options.ad_code`. `GET /tests/:id/results` adds `summary.ralph_score`, `ralph_score_version`, `segments.by_persona`. `DELETE /anchors/all` requires admin. | Results page reads the stored RalphScore; by-persona card; "Calibration constraints" and "High-detail images" toggles on the configure step |
| 1 | `GET/POST /personas/:id/evidence`, `PUT/DELETE /personas/:id/evidence/:eid`, `POST /personas/:id/evidence/import {text, pack_ref}` → `{drafts[]}`, `POST /personas/:id/evidence/commit {ids[]}` → `{evidence_version}`. `GET /personas/:id` adds `evidence_summary`. `POST /projects` `include_evidence`. `POST /tests` rejects evidence-bearing personas from other projects. `GET /projects/:id/predictions.csv` | Evidence panel with import review; evidence badge; `ad_code` field on test configure |
| 2 | `POST /tests` accepts `options.intended_takeaway` and `options.performance_questions` (default on for copy-sets). `GET/POST/PUT/DELETE /projects/:id/rules`; `POST /messages/:id/compliance` → `{flags[]}` (the instant checks also run on message save). Leaderboard rows add `performance_index`, `pi_version`, `stop_rate`, `takeaway_match`, `compliance_flags`. `POST/GET /rounds`; `POST /messages` (bulk), `GET /messages?round_id&persona_id`, `PATCH /messages/:id`. `POST /tests {test_type:'copy_set', message_ids[], persona_ids[], panel_limit}` → `{parent, children[]}`. `POST /tests/:id/run` on a parent runs the orchestrator. `GET /tests/:id/leaderboard`. `GET /tests` hides children unless `?include_children=true`. | Rounds list on project; copy-set create; leaderboard page; message status actions |
| 3 | `POST /tests {test_type:'head_to_head', message_ids[] (2–6), persona_ids[], per_panel_matchups}` → `GET /tests/:id/head-to-head` (win rate ± CI per message). `messages` format fields in use; `options.format {format, aspect, placement, slides[]}`; `GET /tests/:id/leaderboard?group=format`; `focus_preset:'performance'` → `extra_scores`. `GET /rounds/:id/report?persona_id=`, `POST /rounds/:id/brief` | Format inputs; carousel slide ordering; keyframe upload; `/reports/rounds/:id` print route |
| 4 | `POST /performance/imports` (multipart CSV + `column_map`) → `{import_id, matched, unmatched[]}`; `PATCH /performance/:id` (manual match); `POST /projects/:id/anchors/rebuild-live`; `GET /rounds/:id/predicted-vs-actual`. `/anchors/*` require `?project_id`; `/anchors/seed` checks the test's project. | Import wizard with column mapping and an unmatched queue; PvA view; Admin page scoped by project |

---

## 6. Named risks

1. **Prompt drift when evidence is injected.**
   - *Overfed persona:* the pack is heavy with analyst facts (penetration rates, Trupanion's direct-pay USP, competitor intel). A panel member who "knows" Trupanion pays vets at checkout will overrate comprehension and appeal. **Mitigation:** `visibility='analyst'` items never reach the response prompt. They're used only in reports and citations.
   - *Stat parroting:* responses quoting "68% of DINKs…". **Mitigation:** instruct that evidence shapes who they are and isn't quoted; add a post-hoc check that flags responses containing evidence numbers.
   - *Negativity skew:* the verbatims lean towards complaints ("bait and switch", the rate ramp). The skepticism is realistic, but it lowers every score, so post-evidence tests can't be compared with pre-evidence ones. **Mitigation:** the golden-set drift check in Phase 1; `evidence_version` recorded per test; comparisons only within one version.
   - *Homogenisation:* shared verbatims make panel members sound alike. **Mitigation:** give each panel member a random 60% subset of the verbatims.
   - UK-proxy language is marked `geography='UK-proxy'` until the US Reddit swap-in.
2. **Anchor pollution from bad performance normalisation.** Percentiles across formats (video always "wins"), low-volume noise, ads still in Meta's learning phase, Advantage+ audience bleed, attribution-window changes between exports. **Mitigation:** raw data kept as the source of truth and anchors rebuildable; minimum-volume gates; cohort by platform × format; per-source top-K; `LIVE_ANCHORS_MODE=shadow` for the first import (ranges logged in `vector_scores`, not injected, the same pattern as the existing "comparison phase" logging in `ai.ts`); switch on only after reviewing PvA.
3. **Synthetic self-pollution** (Finding B). Existing auto-seeding reinforces itself; at copy-set scale it would flood each project with about 1,200 anchors per round and flatten rankings. **Mitigation:** copy-sets never seed; the `vector_constraints` flag; synthetic confidence set to 0.5.
4. **Throughput and cost at copy-set scale.** 20 messages × 20 panel members × 3 personas = 1,200 calls. The current runner (3 concurrent, 1 s gap, about 6–10 s per call) does roughly 20 calls a minute, so about 60 minutes per full sweep. The two-stage approach (sweep at `panel_limit=8` → 480 calls; finalists 5 × 20 × 3 → 300 calls) cuts that to about 40 minutes at current concurrency, or about 10 minutes at `BATCH_SIZE=8` if the OpenAI rate limit allows. Cost at gpt-4o list prices is in the low tens of dollars per full sweep including evidence tokens (check against current pricing); it's not a constraint. The real risks: a Railway redeploy mid-sweep kills the in-process run (don't deploy during sweeps; parent/child means only unfinished children need re-running), and 429s dropping panel members unevenly (Phase 0 retry).
5. **Touching the current runner.** Only two opt-in flags (`vector_constraints`, `image_detail`) and the retry wrapper. Regression check: run the same known concept test before and after Phase 0 with default settings and compare scores within normal run-to-run noise. The server-side RalphScore must match the client formula exactly (fixture unit test).
6. **Twin erasure** (Finding A). Covered by Phase 0. Without it, every other safeguard is moot.
7. **The model is kinder than real scrollers.** Panel members read every ad closely and rationalise towards liking it. **Mitigation:** feed framing plus stop-or-scroll asked *before* any reasoning (Phase 2); head-to-head for finalists; the noise floor so ties are shown as ties. The Performance Index weights are a guess until the December predicted-vs-actual read.
7a. **Compliance false comfort.** A clean check can be mistaken for legal sign-off. **Mitigation:** the UI labels it a pre-screen, and flags cite the source of each rule.
7b. **Overclaiming statistically.** The CIs describe the synthetic panel, not the real audience; panel members aren't independent people; Tier 1 is n ≈ 4–5 per persona. The report should say "ranks and explains", not "predicts CPE", until PvA has earned it.
8. **Confidential data flows** (Finding F). RCB mirroring and Narrativ webhooks carry Trupanion content. Confirm RCB scopes by client, or add a per-project `mirror_to_rcb` opt-out (0.25 days, can go in Phase 1).

---

## 7. Scoring contract for live-performance anchors (v1)

**Unit:** one anchor per (message, persona ad set, platform), summed across all imported periods for the flight.

**Eligibility** (starting values, to tune after the first import):
- impressions ≥ 5,000
- link_clicks ≥ 30
- ≥ 4 days live

Rows that don't qualify stay in `ad_performance` and never become anchors.

**Cohort:** eligible units in the same project × platform × format class (static / video / carousel). If the cohort has fewer than 6 units, widen to project × platform and set `q_cohort = 0.7`; otherwise `q_cohort = 1.0`. Normalising within format means the anchor reflects the *message*, not the fact that UGC video gets about 2× the CTR of statics. The format effect stays visible in PvA and the report.

**Percentile:** `pct(x) = (midrank(x) − 0.5) / |C|`, inverted for cost metrics.

**The tuple:**
| Dimension | Source | Rule |
|---|---|---|
| `engagement_likelihood` | link CTR, CPE | `round(1 + 9 × mean(pct(CTR), 1 − pct(CPE)))`; CTR alone if CPE isn't defined consistently |
| `share_likelihood` | shares per 1k impressions | `round(1 + 9 × pct(shares/1k))` if the cohort has ≥ 20 total shares, else **NULL** |
| `sentiment_score` | not observable | **NULL** |
| `comprehension_score` | not observable | **NULL** |
| `outcome` (JSONB) | everything | raw metrics, conversions / quote-start rate, CPA, each percentile, cohort id and size, `normaliser_version` |

Conversion (quote starts) is deliberately **not** squeezed into the tuple. It feeds PvA and the report directly. Forcing it into "engagement" would mix funnel stages.

**Confidence** (a multiplicative weight relative to one synthetic anchor = 0.5 after migration 011):
```
c_live = 1 + 2 · v · q          range [1, 3]
v      = min(1, link_clicks / 300)          # ~300 clicks puts CTR relative SE near 6%
q      = q_target · q_cohort
q_target = 1.0 persona-targeted ad set · 0.6 broad / Advantage+ expansion on
```
A well-delivered, cleanly targeted live anchor therefore weighs 6× a synthetic one; a thin, broad one 2×.

**Retrieval and blending** (changes to `computeDisposition`):
- Take the top 10 synthetic and top 5 live anchors separately (combined similarity > 0.5), so ~30 live anchors can't be crowded out by thousands of synthetic ones.
- Per dimension, compute a weighted mean over anchors with a **non-NULL** value only.
- A dimension with fewer than 3 contributing anchors → unconstrained `[1, 10]`.
- Result: engagement and share get pulled towards reality; sentiment and comprehension stay synthetic-led until there's an honest signal for them (e.g. comment classification, a later option).

**Modes:** `off` (live anchors ignored) → `shadow` (computed and logged, not injected) → `on`. Default is `shadow` for the first flight. Every change to the normaliser bumps `normaliser_version`, and `rebuild-live` regenerates the project's live anchors from raw data.

---

## 8. Fallbacks if a build slips (manual path, and Brook's time per persona per month)

| Gap | Manual path | Cost |
|---|---|---|
| Phase 0 | Must not slip. If the panel freeze isn't in, **never regenerate a twin's panel**; create a new persona instead. | 0 h, discipline only |
| 1 Evidence | Paste a curated evidence digest into the builder's psychographics and language fields and into each test's strategic-context box; keep citations in the pack doc. The "evidence-seeded" claim stays true in substance; provenance lives outside the tool. | ~1.5 h setup per persona, then ~0.5 h/persona/month |
| 2 Copy-set | Run each message as its own concept test with `vector_constraints=false` (Phase 0 flag; **without it, manual sweeps compress each other**), export, tabulate in a Sheet. | ~2 h/persona/round, so ~6 h/month at one round a month |
| 4 Format | Write format and placement into the concept text ("FORMAT: 9:16 Reels, sound on, first 2 s: …"), put the format code in the test name, pivot by format in the Sheet. | ~0.25 h/persona/month |
| 5 Report | JSON export + insights chat → Brook writes the report in a Slides template. | ~3 h/persona/round, so ~9 h/month. The most expensive fallback, and the $2,600 line. |
| Compliance check | Brook reads each copy set against a one-page rules checklist (naming rule, banned claims, qualifiers, persona watch-outs). | ~0.5 h/persona/round |
| Head-to-head | Skip it: choose finalists on Performance Index plus confidence ranges, and call anything inside the noise floor a tie. | 0 h; weaker finalist calls |
| Performance questions | Paste the five questions into each concept's strategic-context box. Answers land in the free text, not as scores, so they're tallied by hand. | ~1 h/persona/round |
| 3 Ingestion | `predictions.csv` + SuperAds CSV joined in a Sheet; pairwise accuracy by formula. The loop still "learns", through Brook's brief rather than through anchors. | ~0.5 h/persona/month (~1.5 h/month total) |
| 6 Governance | Voices stays Ralph-internal: no client logins, no global anchors, admin-only delete (Phase 0). | 0 h; blocks licensing only |

---

## 9. Decisions needed from Brook

1. Agree the terminology in §1 (UI "panel members", client-facing "messages").
2. ~~RCB mirroring for Trupanion~~ **Decided 23 Sep: off for Trupanion** (per-project opt-out built in S2).
3. Add3 naming convention: the exact `ad_code` format, needed before Tier 1 pre-tests so the Month-1 PvA join works.
4. Whether `projects.restricted` is in scope for December, or deferred until a licensed instance.
5. The first compliance rule set: confirm the naming rule and the banned-claims list with Add3 before the Phase 2 compliance check is switched on.
6. `intended_takeaway` for each Tier 1 concept. Most are the direct-pay product truth, but it should be written down per concept.
