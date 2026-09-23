# VOICES architecture session: brief
*Assess the ralph-voices codebase for the upgrades the Trupanion engagement needs, and produce a sequenced build plan.*

## Context

Ralph has won a three-month paid-creative engagement with Trupanion (pet medical insurance) via Add3. VOICES is named in the client-facing scope as the pre-testing tool: three modelled audience twins (DINKs with pets; Conscious Curators + Empty Nesters; Busy Families), roughly 20 copy and tone variants per persona stress-tested before production, and a predicted-versus-actual read once creative is live.

Two things make this different from how VOICES has been used so far. The twins must be built from documented research evidence, not typed-in assumptions. And the tool's output becomes a client deliverable and, from round two, is calibrated against the client's real Meta and TikTok results.

The engagement is priced as a service that uses tooling, not as software delivery. If a build slips, pre-testing still happens through slower manual runs. Nothing sold breaks. That is deliberate and the plan should preserve it: no upgrade may leave the current tool unusable mid-flight.

## What the tool has to do, by when

| Need | Required by | Why |
|---|---|---|
| Persona twins seeded from an evidence pack, with provenance stored and citable | Month 1 (October) | Month 1 pre-test of the 13 Tier 1 concepts; the twins are described to the client as evidence-seeded |
| Test many message variants against one persona panel, ranked | Month 2 (November) | The "~20 variants per persona" line item; today the tool tests one concept across many people, the opposite axis |
| Format and style as a dimension of results | Month 2 | Deck promises reads by persona x message x format; the brief asked for format signals |
| Client-ready report per persona (not JSON) | Month 2 wrap | Round-close report is a billed deliverable |
| Ingest real ad performance and calibrate against it; predicted-vs-actual | Month 3 | The round-two money slide; the mechanism behind "gets smarter every round" |
| Cross-client visibility closed on anchor and persona endpoints | Before any licensed instance | Governance |

## What the session already knows (verified in code, Aug 2026)

- Persona builder with structured psychographics, media habits, cultural and brand context; auto voice sample; 10 to 50 synthetic variants per persona spread across age, attitude, platform, engagement.
- Concept testing: one concept (text, images, PDF, strategic context) across all variants; per-variant narrative, four scores, reaction tags. GPT-4o vision when images attached. `test_type: 'ab'` handles two options only.
- Results: RalphScore (computed client-side in `TestResults.tsx`), segments, themes, AI recommendations, insights chat, JSON export.
- A pgvector calibration layer that CLAUDE.md does not document: four-facet persona embeddings, concept embeddings, `reference_anchors` storing frozen embedding pairs with known scores, nearest-anchor lookup injecting a scoring range constraint into every response. Project-scoped since migration 005; `is_global_calibration` admin escape hatch. Anchors are created at a single insert site with `source` hardcoded to `'historical'`.
- `persona.source_type` enumerates `builder | brief | data_import`; only `builder` is used.
- `/anchors/seed`, `/anchors/personas`, `/anchors/recent` are universal visibility for any signed-in user; `/anchors/seed` accepts any test id.

Full detail: `claude/voices-loop-gap-analysis.md` in the INNOVATION @ RALPH project.

## The six gaps, in priority order

1. **Evidence layer on personas.** No field for verbatims, statistics, sources or provenance. Proposed: `evidence JSONB` on `personas` (claim, quote or stat, source, URL, date, facet), a fifth builder step or bulk import, injection into voice-sample, variant and response prompts, citations in exports.
2. **Copy-set test type.** M message variants (2 to 20) scored by one shared variant panel, results as a ranked leaderboard by message. Reuses the existing response pipeline. Move RalphScore server-side so UI, export and report agree. Throughput: 20 messages x 20 people x 3 personas is about 1,200 calls at current concurrency; a smaller panel for sweeps and full panel for finalists.
3. **Live performance ingestion into anchors.** An `ad_performance` import (SuperAds CSV is enough to start), a link from shipped asset to originating concept and persona, a normaliser from CTR and CPE percentile into the 1 to 10 score space, anchors written with `source = 'live_performance'` at higher confidence. Predicted-versus-actual report falls out of this.
4. **Format dimension.** Format, aspect ratio and style metadata on concepts and message variants; extended tag vocabulary; results segmented by format.
5. **Report export.** Branded per-persona PDF or deck: ranked messages, real pull-quotes, evidence citations, format breakdown, predicted-vs-actual, next-round brief.
6. **Governance.** Scope the anchor endpoints to the caller's projects; validate `/anchors/seed` test ownership.

## Constraints

- Solo builder, AI-assisted, part-time on this alongside the engagement itself. Sizing must be honest in days, not story points.
- Existing tests, projects and anchors must keep working throughout. Migrations additive only. No change to how a current concept test runs until the copy-set type exists beside it.
- Multi-tenant safety is not negotiable: nothing built may let one project's evidence, anchors or performance data influence another's scoring unless an admin explicitly marks it global.
- Trupanion data (evidence, concepts, performance) is client-confidential. The performance import must not require Add3 API access to start; CSV first.
- Language: "variants" means synthetic people inside the tool and copy lines in the client's scope. The build should pick one term for message variants (suggest "messages" or "copy set") and not overload "variant".

## What the session must produce

1. A **sequenced build plan** across the six gaps: what ships in October (gaps 1 and 2 minimum), what ships in November (4 and 5), what ships in December (3 and 6), with day-level sizing and the dependency order stated.
2. **Schema changes** as migration sketches: new columns, new tables, indexes, backfill posture.
3. **API and route changes**: new endpoints, changed request and response shapes, what the frontend must change to consume them.
4. **The scoring contract** for live-performance anchors: how a real CTR or CPE becomes a 1 to 10 sentiment, engagement, share and comprehension tuple; how live anchors are weighted against synthetic ones; what "confidence" means numerically.
5. **A fallback per gap**: what the manual path is if that build slips, and what it costs in Brook's time per persona per month.
6. **Risks**, named: prompt drift when evidence is injected; anchor pollution if performance normalisation is wrong; throughput and cost at copy-set scale; anything that touches the current test runner.

## Questions the architect should answer

- Is `evidence` better as JSONB on `personas` or as a child table with its own embeddings, given that the calibration layer already embeds four persona facets? Would an evidence embedding be a fifth facet?
- Should the copy-set test be a new `test_type` on `tests` with `options.messages[]`, or a parent test with child tests per message? Which keeps `test_responses` and the anchor pipeline unchanged?
- For live-performance anchors: one anchor per asset x persona, or one per asset with the persona embedding taken from the ad set's persona? What happens when an asset ran across several personas?
- Where should RalphScore live once server-side: computed at results time and stored on `test_results`, or a view?
- What is the smallest thing that makes predicted-versus-actual possible for the Tier 1 concepts in month 1, even before gap 3 is built?

## Out of scope for this session

Redesigning the persona builder UI; the TRENDS tool; the insights chat; any change to the underlying model choice; anything about billing or client reporting outside the export in gap 5.

## Inputs to read first

- `ralph-voices` repo, in particular `backend/src/db/migrations/004_pgvector.sql`, `005_anchor_project_scope.sql`, `services/embeddings.ts`, `services/ai.ts`, `routes/tests.ts`, `routes/anchors.ts`, `utils/types.ts`.
- `claude/voices-loop-gap-analysis.md`
- `claude/trupanion-evidence-pack-v1.md` and `claude/trupanion-trigger-maps-v1.md` (the evidence the twins will be seeded from; note the persona names in those docs predate the rename)
- `claude/trupanion-three-month-billing.md` (what was sold, in the client's words)
