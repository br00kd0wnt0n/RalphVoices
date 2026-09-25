# VOICES × Trupanion: build sessions

Coordination and oversight happen in one standing session. Building happens in the dedicated sessions below, each in its own worktree and branch. The plan they build against is `docs/trupanion-build-plan.md`.

## Ground rules (every build session)

1. **Never touch the Railway databases.** Both `.env` and `backend/.env` point at Railway. **`yamanote` (the pgvector database) is production**; `yamabiko` is legacy (corrected by Brook, 23 Sep; an earlier note had these the wrong way round). Touch neither. Run everything against a local database by setting the variable explicitly, e.g. `DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_dev npm run dev:backend`. dotenv doesn't override a variable that's already set. Migration 004 needs **pgvector** locally (`brew install pgvector`, or the `pgvector/pgvector:pg16` Docker image); ask Brook before installing anything.
2. **Migrations are additive and idempotent** (`IF NOT EXISTS`), using only the number reserved for your session (table below). Run every new migration twice against the local database to prove it's idempotent.
3. **Don't change how an existing concept test runs** unless your session's scope says so, and then only behind a flag that defaults to off.
4. **Terminology:** "panel member" (synthetic person, `persona_variants`), "message" (copy line), "copy set", "round". Never use "variant" for copy.
5. **Keep constants in sync:** `backend/src/utils/constants.ts` ↔ `frontend/src/lib/constants.ts`.
6. **Done means:**
   - Both type checks pass (`cd backend && npx tsc --noEmit`; `cd frontend && npx tsc --noEmit`), except the known pdf-parse and rcb-client errors.
   - New behaviour is exercised against the local database, with the evidence noted.
   - `CHANGELOG.md` and `CLAUDE.md` are updated.
   - A handoff note is written (rule 7).
7. **Handoff note:** `docs/build-log/SNN-<slug>.md` covering what shipped, deviations from the plan and why, migrations, new env vars, how it was tested, open questions, and what the next session needs to know. Commit it with the work.
8. **No push, merge or deploy without Brook's say-so.** When asked, push the branch and open a PR against `main`; never merge it. The coordination session reviews first.
9. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Session map

| # | Session | Plan section | Branch | Migration | Start | Depends on | Can run in parallel with |
|---|---|---|---|---|---|---|---|
| S1 | Finish Phase 0 | Phase 0 | `voices/trupanion-phase0` (existing) | none new (007 done) | now | — | — |
| SM | Measurement: feasibility spike (gate), then pairwise or cold probes, blind controls, sweep statistics | R1 note, ranked list #1, #6, #7 | `voices/measurement` | 015 | ~30 Sep, after Monday's prediction of record | S1, twin fixes | — |
| S2 | Evidence layer + Month-1 predicted-vs-actual | Phase 1, §4 008 (now 014) | `voices/evidence-layer` | 014 | after SM merged | SM | — |
| S3 | Twin seeding, drift check, noise floor | Phase 1 (content and calibration) | `voices/twin-calibration` | none | ~7 Oct | S2 deployed | S4 (backend only) |
| S4 | Copy-set backend + performance questions + feed framing | Phase 2, §2a, §4 009/010 | `voices/copy-set-backend` | 009, 010 | ~19 Oct | S2 merged | S3 |
| S5 | Copy-set UI + compliance check | Phase 2, §2a | `voices/copy-set-ui` | none (uses 010) | ~28 Oct | S4 merged | — |
| S6 | Format dimension + head-to-head | Phase 3, §2a | `voices/format-h2h` | 013 if needed | ~9 Nov | S5 merged | S7 |
| S7 | Round report: readout reasons, prediction lock, client export (docs/trupanion-readout-spec.md) | Phase 3 | `voices/round-report` | none (prediction_locks is in 015) | straight after SM | S4 merged | S6 |
| S8 | Performance ingestion + live anchors + predicted-vs-actual | Phase 4, §7, §4 011 | `voices/performance-ingest` | 011 | ~1 Dec | S4 merged; S7 for the PvA report section | S9 |
| S9 | Governance | Phase 4, §4 012 | `voices/governance` | 012 | ~8 Dec | S1 | S8 |

Migration numbers are reserved as above so parallel sessions never collide. **008 was taken by the twin fixes (`008_response_probes`, 24 Sep), so the evidence layer moves to 014.** Nothing in 009–013 references `persona_evidence`, so running it last on a fresh install is safe.

**Order decided (25 Sep, Brook): measurement session (SM) next, then evidence (S2).** Round one pass 1 showed the bottleneck is measurement (1–10 scoring bunches at 7–9), not persona seeds. See `docs/build-log/R1-trupanion-round-one.md`. Knock-on effects for later sessions:
- S3's noise-floor work is largely done by pass 2 plus SM's sweep statistics; S3 keeps the drift check (evidence off vs on).
- S4's leaderboard statistics (confidence ranges, ties, min_detectable_diff) reuse SM's statistics module rather than building their own, and a copy-set's ranking can use SM's sparse pairwise design.
- S6's head-to-head is superseded by SM's pairwise test type; S6 keeps the format dimension. Migration 013 stays reserved for S6 if needed.
- Dates after S2 shift by roughly a week; re-plan them when SM merges.

## Prompt starters

Paste one into a new Code session in the `ralph-voices` repo. Start S1 on the existing branch; the rest start from an up-to-date `main`.

---

### S1: Finish Phase 0

```
Build session S1 of the VOICES × Trupanion build. Work on the existing branch voices/trupanion-phase0 (check it out in this worktree; don't create a new branch).

Read first: CLAUDE.md, docs/build-sessions.md (ground rules; follow them exactly), and docs/trupanion-build-plan.md §0 and §2 Phase 0. Three Phase 0 items are already committed on this branch: the panel freeze (migration 007), the vector_constraints opt-out, and the anchor delete lock. Read those commits before starting.

Scope: the remaining Phase 0 items.
1. RalphScore on the server. Move the formula from frontend/src/pages/TestResults.tsx (calculateRalphScore, ~line 60–83) into a shared backend util, identical maths. Compute it when results are written in processTestResponses; store summary.ralph_score and summary.ralph_score_version = 1 in test_results. Write a backfill script (backend/scripts/, with --dry-run) for existing complete tests. The frontend reads the stored value and falls back to computing it locally. Add a fixture-based test proving backend and frontend give identical scores for at least 5 real-shaped summaries.
2. segments.by_persona in calculateSegments (additive key; same shape as the other segments, keyed by persona name, including persona_id), plus a card on the Segments tab.
3. options.image_detail ('low' default | 'high' | 'auto'), passed through to the image_url detail in services/ai.ts generateConceptResponse, plus a toggle on the concept-first configure step next to "Calibration constraints".
4. The "No variants — will be generated" bug (ConceptFirst.tsx ~line 678): when a selected persona has no active panel members, generate them (variants_per_persona, Meta + TikTok platforms) before the run, with visible progress. Or, if that's unreliable, block the run with a clear message. Pick one, explain why in the handoff note.
5. Platform defaults: Meta (Facebook, Instagram) and TikTok, replacing TikTok/Instagram/YouTube/Twitter-X in the backend schemas and frontend defaults. Existing personas and panels are untouched.
6. Record dropouts: when a panel member still fails after the retries, count it and store options.dropouts (count plus variant ids) on the test; show "n of N panel members responded" on the results page when n < N.

Out of scope: evidence, copy-sets, anything else in later phases.

Also: set up the local dev database (Postgres + pgvector) described in ground rule 1 and document the exact commands in the handoff note. Every later session will reuse them. Ask me before installing anything.

Handoff: docs/build-log/S01-phase0.md. When done, tell me it's ready for review; don't push until I say so.
```

---

### SM: Measurement (feasibility spike, then pairwise comparison, blind controls, sweep statistics)

```
Build session SM of the VOICES × Trupanion build. Create branch voices/measurement from an up-to-date main.

Read first: CLAUDE.md, docs/build-sessions.md (ground rules), docs/build-log/S01-phase0.md (local DB and mock), docs/trupanion-readout-spec.md (Phase B UI), docs/build-log/R1-trupanion-round-one.md including "Pass 2 results" (why this session exists), and backend/src/utils/probes.ts, utils/realism.ts and services/ai.ts (generateConceptResponse, runIntentProbes, generateVariants). Working inputs are client material outside the repo, in /Users/BD/ralph-voices/Claude outputs/voices-r1/: personas.json (seed v3), concepts.json (the nine cards), r1-pass1-ledger.csv, r1-pass2-smoke-results.json. Read them by absolute path and never commit them. Ask me for the four blind-control ads (SuperAds) and their expected order before Phase A runs.

What we know:
- Scoring one ad alone on 1-10 bunches at 7-9 (pass 1: Families 88-97 on everything).
- The intent probes saturate at 0.9-1.0 for every twin, skeptics included (pass 2 smoke). Each probe is asked after the model's own favourable review is in context, so "would you stop?" follows a paragraph in which it already did. A known-weak concept moved Curators p_stop only from 1.000 to 0.913.
- Editing seeds or rebuilding panels doesn't fix this. The persona layer works; the measurement doesn't.

Three rules for everything in this session:
1. Never ask a measurement question with the model's own review in context. Measurement calls are cold: persona, feed, question.
2. A gate checks discrimination (controls and known-weak concepts land below known-strong ones), not just "not stuck at 0 or 1".
3. Logprob reads at temperature 0 are near-deterministic, so repeating a run on the same panel says nothing about reliability. Measure reliability across independently built panels (population sampling), not repeated runs.

PHASE A: feasibility spike. Do this first. No migration, no UI, no database, no Railway.
A standalone script, backend/scripts/measurement-spike.ts, calls OpenAI directly with the key from the environment. For each of the three personas it builds two independent panels of 30 in memory (reuse generateVariants if it runs without the DB; otherwise the same fields with a normal attitude spread). Stimuli: the nine concepts plus the four controls. Compare two methods:
- M1, cold probe: the ad shown inside a short feed of four or five neutral organic posts (the same framing as REALISM_SYSTEM_BLOCK); the stop, tap and quote questions asked as the first and only turn, one token, P(Yes) from logprobs.
- M2, pairwise: two ads in the same feed; "which one would you stop for?" (then tap, then quote), answered A or B; P(A) from logprobs; asked in both orders and averaged. Ranking by Bradley-Terry.
Print the call count and cost estimate, then wait for my OK. Cap: $25.
Report per persona, method and question:
- controls in the right order (n of m)
- Spearman between the two independent panels, and noise versus spread
- for M2, the first-position win rate
- for M1, the distribution of P(Yes): it must not sit at the ceiling
- cross-persona agreement (Spearman between the personas' rankings). If all three twins rank the same, the persona layer adds nothing over "GPT-4o's taste in ads". Say so plainly.
- the rank of each concept next to the pass-1 Curators order
Gate A: a method passes for a persona if every control is in the right order, the split-panel Spearman is above 0.8 and the spread is at least twice the noise. Write the results to docs/build-log/SM-spike.md and stop for my review before Phase B. If neither method passes for any persona, don't build Phase B: write it up and recommend what VOICES should and shouldn't claim.

PHASE B: build. Only after I approve Phase A; build the method that passed (migration 015 only; everything opt-in; existing concept tests unchanged).
1. Pairwise test type (test_type 'pairwise'), if M2 passed. A test holds 2-12 concepts (options.concepts: [{code, concept_text, is_control?, expected?}]). Measurement calls are cold, per rule 1. Store every judgment (pairwise_judgments: test_id, variant_id, question, concept codes in the order shown, p_first). Report the first-position win rate.
   Cold probes (variant_config.probe_mode: 'cold'), if M1 passed. Also fix runIntentProbes so the review is never in context. The existing 'after_review' behaviour stays only as a legacy value.
2. Design: all pairs for up to 9 concepts; above that, a balanced sparse design (each panel member sees k pairs, default 12, every pair covered equally). Log the call count before a run and refuse a run over env PAIRWISE_MAX_CALLS.
3. Ranking: Bradley-Terry (or the mean P(Yes) for cold probes) per persona and question, with a 95% range from a seeded bootstrap over panel members (1,000 resamples). Overlapping ranges are reported as tied. Store in test_results (summary.pairwise; segments.by_persona[...].pairwise).
4. Blind controls: is_control concepts with expected 'win' or 'lose' and a metric. Each result reports "n of m control pairs in the right order" per persona and question, and a controls_passed flag. A persona whose controls fail is marked "not for the ledger".
5. Reliability and ledger: POST /tests/:id/sweep {runs, fresh_panels: true} builds a fresh panel per run (retiring, per migration 007) so run-to-run numbers measure population sampling. GET /projects/:id/ledger.csv: one row per persona × concept × run × question with rank, strength, range, tie group, controls result, panel_version and seed or evidence version. Report run-to-run Spearman, noise versus spread and cross-persona agreement, so the browser runner can retire.
6. Smoke gate: a built-in check that takes one known-strong and one known-weak concept (or a control pair) and fails unless the strong one clearly wins for each persona.
7. UI: a "Compare concepts" mode in the concept-first flow (2-12 concept cards, a control flag on each), and the readout view specified in docs/trupanion-readout-spec.md: GET /api/readouts/:key, and /readouts/:key with the verdict strip, rankings per persona, the concept × persona grid and the ledger CSV. Also create the prediction_locks table in migration 015; the lock button, reasons, client export and live results are S7 and come straight after SM. Leave TestResults.tsx as it is, apart from a "Part of readout" link. Use "panel members" and "concepts" in all copy.

Out of scope: evidence (S2), copy-sets (S4/S5), format metadata (S6). Keep the statistics in a pure module with unit tests so S4 can reuse it.

Verify locally with the mock (extend backend/scripts/mock-openai.mjs so A/B and cold-probe answers carry a known preference per concept; prove the ranking recovers it and the controls check fires when they're reversed). Then give me the call count and cost for pass 3 (the nine plus four controls, three personas at 30, three fresh panels) and how to run it without the browser runner.

Handoffs: docs/build-log/SM-spike.md (Phase A) and docs/build-log/SM-measurement.md (Phase B).
```

---

### S2: Evidence layer + Month-1 predicted-vs-actual

```
Build session S2 of the VOICES × Trupanion build. Create branch voices/evidence-layer from an up-to-date main (SM must already be merged; stop and tell me if docs/build-log/SM-measurement.md isn't on main). Also read docs/build-log/R1-trupanion-round-one.md: evidence prompt injection has to coexist with the realism block and lived voice samples, and buyer verbatims from the quote bank must be analyst-only, never persona-visible.

Read first: CLAUDE.md, docs/build-sessions.md (ground rules), docs/build-log/S01-phase0.md (local DB setup), docs/trupanion-build-plan.md §0 (Finding F), §2 Phase 1, §3 Q1 and Q5, §4 migration 008, §5 Phase 1 row, §6 risk 1. Then read "Claude outputs/trupanion-evidence-pack-v1.md" and "Claude outputs/trupanion-trigger-maps-v1.md" if they exist in the main checkout (/Users/BD/ralph-voices/Claude outputs/). They're untracked, so they aren't in your worktree; read them by absolute path. They're the real input this layer must handle.

Scope (migration 014 only; the build plan's §4 sketch calls it 008, which the twin fixes took):
1. persona_evidence table + personas.evidence_version / evidence_digest, exactly as sketched in §4 unless you find a reason to change it (explain in the handoff).
2. Evidence CRUD routes, plus import: POST /personas/:id/evidence/import {text, pack_ref} → the LLM extracts draft items (kind, facet, visibility, claim, quote, stat, source_name, source_url, source_date, sample_size, geography, confidence, trigger_rank). Drafts are saved with status 'draft'. POST .../commit {ids[]} activates them, bumps evidence_version and rebuilds evidence_digest. Verbatims must be quoted exactly; the extractor must never invent a URL or source. Test the import on the DINKs section of the evidence pack and include the output in the handoff.
3. Prompt injection. Voice sample, panel generation and the concept response prompt get the digest. Only visibility='persona' items reach the response prompt; 'analyst' items (market stats, Trupanion's own facts, competitor intel) never do. Give each panel member a stable random ~60% subset of the verbatims (seeded by variant id) to avoid homogenisation. Instruct panel members that evidence shapes who they are and isn't quoted. Record the persona evidence_version and panel_version used on each test in tests.options.persona_snapshot.
4. Finding F. Personas with active evidence can only be used in tests in their own project (POST /tests returns 400 otherwise). Project persona-copy gets include_evidence (default false). Add a per-project opt-out of the RCB mirror (options/settings; no migration if avoidable) and default it to OFF for any project whose client_name matches "Trupanion" (Brook confirmed 23 Sep: RCB off for Trupanion). Say in the handoff exactly how this was done.
5. UI: an Evidence panel on persona detail (list grouped by kind; add/edit/retire; paste-to-import with a review table and commit), and an evidence badge with count and version on persona cards. Don't redesign the persona builder.
6. JSON export includes the evidence items cited for each persona.
7. Month-1 PvA minimum. options.ad_code on tests (field on the configure step) and GET /projects/:id/predictions.csv with ad_code, test id, test name, persona, territory (from the test name or a new optional options.territory), format (optional options.format), ralph_score, the four means, n, evidence_version, panel_version, completed_at.

Out of scope: running the golden set (that's S3), copy-sets, the evidence embedding column's use (create the column, leave it null).

Handoff: docs/build-log/S02-evidence.md. Include the import output for the DINKs pack section and a before/after of one response prompt with evidence injected.
```

---

### S3: Twin seeding, drift check, noise floor

```
Build session S3 of the VOICES × Trupanion build. This is mostly an operational session: it builds the three Trupanion twins in the live tool and measures drift and noise. Code changes should be small (scripts only). Branch voices/twin-calibration from main (S2 must be merged AND deployed; confirm with me first).

Read first: CLAUDE.md, docs/build-sessions.md, docs/build-log/S02-evidence.md, docs/trupanion-build-plan.md §2 Phase 1 (drift check and noise floor rows), §6 risk 1, and the evidence pack and trigger maps at /Users/BD/ralph-voices/Claude outputs/.

This session works against the PRODUCTION app through its API, with my explicit go-ahead for each write step. Ask me for a token; never read credentials from .env files.

Steps:
1. With me, build or confirm the three personas in the Trupanion project: "DINKs with pets", "Conscious Curators + Empty Nesters" (defined as NEW-pet acquirers), "Busy Families". Import each persona's evidence-pack section through the import endpoint; I review the drafts before commit. Mark UK-forum verbatims geography='UK-proxy'. Generate panels of 20 on Meta + TikTok.
2. Golden set: 6 concepts, 2 per persona, from the deck's spec creative (e.g. "Two incomes. One idiot.", "Never the choice", "This time, from day one", "Ask your vet", "One bill shouldn't break the summer", "One less job"). Write them into backend/scripts/golden-set.json.
3. Drift check: run the golden set with evidence OFF (a temporary copy of each persona without evidence, deleted afterwards) and ON, with vector_constraints=false and image_detail=high. Compare score distributions, ranks, stat-parroting (responses containing evidence numbers) and the tone of 5 sampled responses per persona.
4. Noise floor: run the evidence-ON golden set a second time with identical settings. Report the per-concept RalphScore difference and a proposed min_detectable_diff (e.g. the 90th percentile of run-to-run differences).
5. Write a script (backend/scripts/golden-set-run.ts) that repeats steps 3–4 so we can re-check after every evidence or prompt change.

Output: docs/build-log/S03-twin-calibration.md with the numbers, the proposed min_detectable_diff, any prompt-drift problems and recommended fixes. If drift is bad, stop and report rather than changing prompts yourself.
```

---

### S4: Copy-set backend + performance questions + feed framing

```
Build session S4 of the VOICES × Trupanion build. Branch voices/copy-set-backend from up-to-date main (S2 merged).

Read first: CLAUDE.md, docs/build-sessions.md, all docs/build-log/ notes so far, docs/trupanion-build-plan.md §0 (Findings B and E), §1 terminology, §2 Phase 2, §2a (performance questions, Performance Index), §3 Q2 and Q4, §4 migrations 009 and 010, §5 Phase 2 row, §6 risks 3–5 and 7.

Scope (backend and API only; S5 does the UI):
1. Migration 009 (rounds, messages, tests.parent_test_id/message_id/round_id) and migration 010 (extra_scores, matchup, compliance_flags columns, project_rules table). Create project_rules now even though S5 uses it, so there's one migration.
2. Rounds and messages CRUD (bulk message create from JSON or CSV rows).
3. Copy-set: POST /tests with test_type 'copy_set' creates a parent plus one child concept test per message. Children always run with vector_constraints=false and never seed anchors. The orchestrator runs children K at a time (env COPYSET_CONCURRENCY, default 2) using the EXISTING processTestResponses unchanged. panel_limit picks a stratified-by-attitude subset of active panel members, and every child uses the SAME subset. Parent progress is rolled up over the existing WebSocket. A child that fails can be re-run on its own. GET /tests hides children unless include_children=true.
4. Performance questions (options.performance_questions; default on for copy-set children, off otherwise). Feed framing plus a stop-or-scroll yes/no asked BEFORE reasoning, then quote_intent, trust_shift, brand_recall and takeaway, all parsed into test_responses.extra_scores. A separate judge call scores takeaway against options.intended_takeaway → takeaway_match 0–1. Existing concept tests with the flag off must produce byte-identical prompts to today; prove it with a snapshot test.
5. Performance Index v1 (§2a weights, pi_version = 1), computed alongside RalphScore when results are written.
6. GET /tests/:id/leaderboard: per persona, rows per message with n, ralph_score, performance_index, the four means, stop_rate, takeaway_match, bootstrap 95% CIs (1,000 resamples, seeded), paired differences vs the leader, a "tied with" list using the project's min_detectable_diff (from S3's handoff; fall back to the CI overlap if unset), top tags, and best and worst quote.

Out of scope: UI, compliance engine logic (S5), format metadata beyond storing the messages columns.

Verify locally with a 5-message × 1-persona × 6-panel copy set. Report the call count, wall time and a leaderboard sample in docs/build-log/S04-copy-set-backend.md.
```

---

### S5: Copy-set UI + compliance check

```
Build session S5 of the VOICES × Trupanion build. Branch voices/copy-set-ui from up-to-date main (S4 merged).

Read first: CLAUDE.md, docs/build-sessions.md, docs/build-log/ (especially S04), docs/trupanion-build-plan.md §2 Phase 2, §2a (compliance rules), §5 Phase 2 row, §6 risk 7a, §8 fallbacks, and the watch-outs in /Users/BD/ralph-voices/Claude outputs/trupanion-trigger-maps-v1.md.

Scope:
1. Rounds on the project page (create, list, status).
2. Copy-set create: pick a round and persona(s), paste messages one per line or upload CSV (body, label, territory, tone, format, ad_code, intended_takeaway), choose sweep (panel_limit 8) or full panel, then run.
3. Leaderboard page: per-persona tabs; rank, message, Performance Index, RalphScore, CI bar, stop rate, takeaway match, tie grouping, top tags, quotes, compliance flags; kill / finalist actions; "Re-run finalists on full panel". Use "panel members" and "messages" in all copy.
4. Compliance engine: project_rules CRUD with a small rules screen in project settings; instant checks (required_phrase, banned_phrase, requires_qualifier, persona_watch_out by pattern) on message save; a model review on demand and automatically before a copy set runs. Flags are stored in messages.compliance_flags with the rule cited; flags never block. Label everything "Pre-screen: not legal review".
5. Seed script for the Trupanion starter rule set from §2a and the trigger-map watch-outs. Mark the naming rule "pending Add3 confirmation".

Out of scope: format grouping and head-to-head (S6), reports (S7).

Handoff: docs/build-log/S05-copy-set-ui.md with screenshots of the leaderboard and a compliance flag example.
```

---

### S6: Format dimension + head-to-head

```
Build session S6 of the VOICES × Trupanion build. Branch voices/format-h2h from up-to-date main (S5 merged).

Read first: CLAUDE.md, docs/build-sessions.md, docs/build-log/, docs/trupanion-build-plan.md §2 Phase 3 (format rows, head-to-head row), §2a ("what the tool can and can't judge", head-to-head), §5 Phase 3 row.

Scope:
1. Format metadata in use: messages.format/aspect_ratios/platforms/style, plus options.format on plain concept tests; placement detail (platform, aspect ratio, sound on/off) added to the S4 feed framing.
2. Carousels as a swipe sequence: ordered slides shown one at a time with "would you swipe on?" after each; store the drop-off curve in extra_scores.carousel; show it on results.
3. Video: script plus up to 6 time-stamped keyframes; the first-2-seconds frame is labelled as the hook in the prompt.
4. Extended reaction tags (thumb_stopping, scroll_past, clear_offer, feels_like_an_ad, trust_raised, trust_lowered), kept in sync across both constants files.
5. Leaderboard and segments grouped by format.
6. Head-to-head: test_type 'head_to_head' for 2–6 finalists; balanced matchups so every message appears equally often in every position; one response per panel member per matchup, with preferred_option = message id and matchup = the order shown; GET /tests/:id/head-to-head gives the win rate ± CI; "Run head-to-head" from the leaderboard's finalist selection. Reserve migration 013 only if a schema change is unavoidable.

Handoff: docs/build-log/S06-format-h2h.md, including a position-bias check (first-position win rate across all matchups).
```

---

### S7: Round report

```
Build session S7 of the VOICES × Trupanion build. Branch voices/round-report from up-to-date main (S4 merged; S6 is optional but its format grouping should be used if merged).

Read first: CLAUDE.md, docs/build-sessions.md, docs/build-log/, docs/trupanion-build-plan.md §2 Phase 3 (report rows), §3 Q1 (evidence embeddings for citations), §6 risk 7b, and the "Round-close report & next-round brief" line in /Users/BD/ralph-voices/Claude outputs/RALPH_TRUPANION_3Month_Billing_v3.xlsx (what the client was sold).

Scope:
1. Fill persona_evidence.embedding for active items (backfill script plus on commit). Per message, retrieve the top 3 evidence items it activates, for citation.
2. GET /rounds/:id/report?persona_id= → a report model: ranked messages (Performance Index, CI, ties), real pull-quotes, evidence citations, format breakdown, compliance flags summary, a predicted-vs-actual section (present but empty until S8, marked "Available from Round 2"), and the next-round brief.
3. POST /rounds/:id/brief: the model drafts the next-round brief from the report model; saved in rounds.next_brief and editable.
4. /reports/rounds/:id: a print-styled page (Ralph brand, one persona per section, client-safe wording: "ranks and explains", never "predicts CPE") that prints cleanly to PDF from the browser. No headless Chrome.

Handoff: docs/build-log/S07-round-report.md with a sample PDF built from local test data.
```

---

### S8: Performance ingestion + live anchors + predicted-vs-actual

```
Build session S8 of the VOICES × Trupanion build. Branch voices/performance-ingest from up-to-date main (S4 merged; S7 merged for the report section).

Read first: CLAUDE.md, docs/build-sessions.md, docs/build-log/, docs/trupanion-build-plan.md §0 (Findings C and D), §2 Phase 4, §3 Q3, §4 migration 011, §5 Phase 4 row, §6 risk 2, and §7 (the scoring contract: implement it exactly; any deviation needs my sign-off). Ask me for a real SuperAds CSV export and the Add3 naming convention before designing the parser.

Scope:
1. Migration 011 as sketched (including the synthetic confidence re-weight UPDATE).
2. CSV import with a saved column map per source; parse ad_code from ad names with the Add3 convention → message_id / persona_id; unmatched rows go to a queue with manual matching.
3. Normaliser and live-anchor builder per §7 (eligibility gates, cohorts, mid-rank percentiles, NULL for sentiment and comprehension, confidence formula, normaliser_version). Anchors are derived and can be rebuilt: POST /projects/:id/anchors/rebuild-live.
4. computeDisposition: skip NULLs per dimension; top-K per source (10 synthetic + 5 live); LIVE_ANCHORS_MODE off|shadow|on per project (default shadow; shadow logs ranges into vector_scores without injecting).
5. GET /rounds/:id/predicted-vs-actual: per persona pairwise ordering accuracy (with counts), Spearman ρ, top-vs-bottom hit, scatter data; wire it into the S7 report section.
6. Unit tests for the normaliser with fixture CSVs, covering small cohorts, zero shares, low volume and mixed formats.

Handoff: docs/build-log/S08-performance-ingest.md, with a worked example from CSV row to anchor tuple.
```

---

### S9: Governance

```
Build session S9 of the VOICES × Trupanion build. Branch voices/governance from up-to-date main.

Read first: CLAUDE.md, docs/build-sessions.md, docs/build-log/, docs/trupanion-build-plan.md §2 Phase 4 (governance rows), §4 migration 012, §9 decision 4 (ask me whether projects.restricted is in scope before building it).

Scope:
1. Migration 012: users.role; replace the ADMIN_EMAILS check with role = 'admin' while still honouring ADMIN_EMAILS as a bootstrap.
2. /anchors/stats, /recent and /personas require project_id and return only that project's anchors plus global calibration; /anchors/seed checks the test belongs to the given project; global-calibration flips and delete are admin-only. Update the Admin page to pick a project.
3. If approved: projects.restricted + project_members, enforced through one helper used by the project, persona, test, anchor, evidence, message, round and performance routes, with a test proving a non-member gets 404 on each.

Handoff: docs/build-log/S09-governance.md with the route-by-route access matrix.
```
