# VOICES v2: plan for the Trupanion engagement

Internal. Draft for Brook's review, 25 Sep 2026. **Nothing here gets built
until Brook approves it.** Once approved, this plan replaces the build order in
`docs/trupanion-build-plan.md` and sessions S2–S9 in `docs/build-sessions.md`.
Ground rules 1–9 in `docs/build-sessions.md` still apply.

## 1. Why the plan changes

The original plan made VOICES a predictor. The twins would rank concepts per
persona, the ranking would be locked as a prediction of record, and live
results would score it. Round one tested that and it didn't hold up:

- **Pass 1:** 1–10 scores bunched at 7–9. Only Curators ranked consistently.
- **Pass 2:** the intent probes saturated at 0.9–1.0 for every twin,
  skeptics included, because they were asked after the model's own review.
  Pass 2 stopped at the smoke gate.
- **SM spike (partial):** asked cold, the reads are stable across independent
  panels (Curators split-panel ρ 0.99) and they pass the known-weak check. But
  blind controls fail on clicks (Curators 1 of 4). Stable is not the same as
  right.

There are structural reasons too:

- The twins read a written description of the ad, not the ad.
- Much of live performance is delivery, audience and execution, which no
  pre-test can see.
- About 30 assets over three months is too few to score per-persona
  predictions statistically.

The client-facing framing has already moved (Persona Intelligence Readout,
slide 5, edited by Brook on 25 Sep). The twins are a writing partner and a
stress test. We record dated expectations per persona and check them against
live results: expected versus actual. The footer now reads "The twins sharpen
before spend; the market decides." v2 builds that.

## 2. Principles

1. **Live results decide.** VOICES shapes what goes into market and reads what
   comes back. It doesn't claim to know the result in advance.
2. **Use AI where it's reliable:** writing options, checking facts about an ad
   (does it show a dollar figure?), voicing objections, and structuring and
   explaining results. Not forecasting behaviour.
3. **Every flag cites its source,** whether that's an evidence-pack item, a
   compliance rule, a brand guideline or a live result.
4. **Humans sign off.** Nothing reaches Add3 without the creative director's
   approval and Trupanion compliance clearance.
5. **Be honest about confidence.** Every live number has a range. "Too early
   to call" is a valid weekly result.
6. **Build in proportion to what's billed.** Scripts and document templates
   come first. The app gets a UI only where someone outside the build team
   works in it: the Copy Studio.
7. **Learn by feature, not by ad.** Every line and asset is tagged with the
   same features (angle, tone, structure, content), so what we learn carries
   into the next batch.

## 3. What's been sold, and what delivers it

These are the Intelligence & Testing items in Plan B (flat monthly, three
months, billed via Add3). Month 1 items are included at Ralph's cost.

| Sold item | When | v2 delivers it with | Build |
|---|---|---|---|
| Testing architecture | Month 1 | The naming convention (proposed to Add3 on 24 Sep); one ad set per persona; equal-budget or A/B cells for learning tests | none (agreement) |
| Persona intelligence readout | Month 1 full, then a monthly refresh | Evidence pack → persona codex with sources; the monthly refresh adds live learnings from B4 | B4 feeds it |
| Audience twins setup | Month 1 | The three Trupanion personas (seed v3, lived voices), used as a writing partner and stress test | done |
| Pre-testing (~20 copy and tone options per persona per batch) | Months 1–3 | Copy Studio (B1) and pre-flight audit (B2) | B1, B2 |
| Weekly performance reads | Months 2–3 | Ingestion and weekly read (B3) | B3 |
| Round-close report and next-round brief | Months 2–3 | Expectations record, round close and learning ledger (B4) | B4 |

Not built by VOICES:

- **Social listening** is sold under the persona readout. VOICES simulates;
  it doesn't observe. It needs a named owner and a source, whether human or
  another tool.
- **Asset production and campaign management.**

## 4. The builds

### B1. Copy Studio (build 1)

The creative director and AI write the ~20 options per persona together, and
each line is stress-tested as it's written. This delivers the pre-testing line
item.

**The flow**

1. **Brief.** Territory, persona and format, plus the fields to fill (Meta
   primary text, headline and description; TikTok hook, on-screen text and
   caption), each with its character limit. The creative director sets:
   - tone controls (dry to warm, playful to plain, short to long)
   - ideas that are off limits
   - two or three reference lines in the voice they want

   Pulled in automatically:
   - the persona codex (triggers, turn-offs, language, each with its source)
   - the compliance rules and brand rules
   - live learnings, once B4 exists
2. **Generate a varied set.** A grid of angle (trigger) × structure (question,
   stat, testimony, scenario, joke) × tone, with each cell filled. Duplicates
   are removed by similarity.
3. **Check each line as it's written.** Each line shows:
   - persona turn-offs hit
   - compliance risk
   - over the character limit
   - not readable at a glance
   - a near-duplicate of another line
   - the skeptic's objection, in that persona's voice

   Every flag carries its source. These are flags, not scores.
4. **Curate.** Keep, cut, edit, or "more like this", each with a note. Edits
   and reasons are saved and used as examples of the creative director's taste
   in the next generation.
5. **Shortlist and export.** About 3 lines per persona and territory, tagged
   with features and naming codes. Exports:
   - a compliance sheet for Trupanion
   - a hand-off CSV for Add3
   - the flagged but promising lines, kept as a reserve bench

**Data (migration 015)**

- `studio_briefs`
- `studio_lines`: text, field, persona, territory, the grid cell, features,
  flags with sources, status, and the model and prompt version
- `studio_edits`: before, after, note, who, when

The persona codex needs sourced items. Build the slim version of S2's
`persona_evidence`: kind, claim, quote, source and visibility, imported from
the evidence pack and reviewed by Brook. No evidence UI beyond a read-only
list. Buyer verbatims stay analyst-only.

**The writing model** is chosen with the creative director in a blind side by
side (two or three models, unlabelled). Choosing it is a config setting, not a
code change.

**UI:** one page, `/studio`, with the brief panel, the grid of lines with
flags, keep/cut/edit, and export. Sign-in is the existing SSO, and the page
works inside the tools.ralph.world iframe.

**Acceptance:** one real batch on a round-one territory, run with Brook
driving:

- 20+ lines per persona across at least 4 angles and 3 structures, with fewer
  than 10% near-duplicates
- every flag carries a source
- a planted non-compliant line ("pays for itself") is flagged
- the export opens cleanly in Sheets

### B2. Pre-flight audit (build 2)

The spike's M3 rubric (`Claude outputs/voices-r1/rubric.json`, draft 2),
extended to finished assets. It's used on production assets before launch, and
for the Month 1 Tier 1 pre-test on the concepts.

- Input: the actual statics, carousel cards, and video keyframes plus the
  transcript. Vision, with `image_detail: high`.
- For each asset and persona, factual yes/no items:
  - content features (humour, real people, member testimony, dollar figure,
    vet authority and so on)
  - persona turn-offs (from the codex)
  - compliance and brand rules
  - clarity at a glance, and product clarity

  Each item is asked in two wordings, and the P(Yes) of the two is averaged.
- Output: a short report per asset. Features double as the tags B3 and B4
  learn from.
- No overall score.
- A script plus a Markdown/PDF report. It needs no UI.

**Acceptance:** re-run on the nine round-one concept cards and match the
spike's M3 feature table. On three real statics, a human check agrees on at
least 90% of items.

### B3. Ingestion and weekly read (build 3; critical path)

This has to work before Month 1 creative goes live (mid-October on slide 6,
still to be confirmed with Add3).

**Ingest** Add3 exports and SuperAds (CSV first, API later if Add3 offers
one):

- Parse ad names by the naming convention:
  `PERSONA_TERRITORY_FORMAT_v#_PLATFORM_YYMMDD`
- Flag and quarantine anything that doesn't parse.
- Prospecting only, for creative reads.
- Metrics:
  - hook rate: 3-second views / impressions
  - link CTR
  - cost per quote, and quotes per 1,000 impressions
  - cost per enrollment, reported but never used for a creative call

**Model**

- Beta-binomial for rates.
- Pools across ads through territory, format and feature effects, with a
  persona layer.
- Outputs, for each ad: P(best in its cell), a 90% range, and a call of scale,
  cut or keep testing, with thresholds written down in advance.
- A pure module with unit tests on simulated data where the true answers are
  known.

**Weekly note:** a generated draft (per persona: what moved, how sure we are,
three actions) that Brook edits before the Wednesday read.

**Storage (migration 016):** `live_ads` (the parsed name, asset link, features
from B2 or B1) and `live_metrics` (a daily or weekly row per ad).

**Acceptance:**

- run end to end on Add3's historic export
- the model recovers planted effects in simulation
- a thin week produces "too early to call", not a false winner

### B4. Expectations, round close and learning ledger (build 4)

- **Expectations record.** Before each flight, for each persona: which lines
  or assets we expect to lead and why (features, evidence, what the stress
  test flagged). It's dated, hashed with SHA-256, and can't be edited. A
  change creates a new version. This reuses the `prediction_locks` design from
  `docs/trupanion-readout-spec.md`, renamed `expectation_records`.
- **Round close:**
  - expected versus actual per persona
  - what won and why
  - feature effects with ranges
  - updated message maps
  - the next batch's brief drafted from the evidence
- **Learning ledger:** feature × persona effects accumulated across rounds.
  It feeds the Studio brief and the monthly persona refresh.
- **Internal forecast, not client-facing:** the ledger's forecast for each
  new batch, scored against live results. It only goes to the client once it
  has a track record.

### Decision gate: back-test on historic data

This runs when Add3's historic export arrives (follow-up sent 25 Sep). It
isn't a build. The rules are written down before any data is looked at.

- **Ads:** 15–20 historic prospecting ads with real volume, run as real image
  files.
- **Question 1:** do B2 features predict hook rate, CTR or cost per quote on
  Trupanion's history? That tells the ledger what to start from.
- **Question 2:** do cold synthetic reads (M1 or M2 from the spike) rank
  those ads above chance?
  - If ρ ≥ 0.4 on at least one metric, synthetic reads may enter the internal
    forecast, weighted by their track record.
  - If not, the synthetic ranking track closes.
- Either way, B1–B4 go ahead. None of them depends on this gate.

## 5. What happens to the current build

| Current item | v2 decision |
|---|---|
| SM Phase A spike | Let it finish; write `SM-spike.md`; its results feed the decision gate. Cost cap $25 |
| SM Phase B (pairwise type, sweeps, ledger CSV, readout view) | **Parked.** The readout spec is reused later for the live read if a UI is needed; its lock design moves to B4 |
| S2 evidence layer | **Slimmed into B1** (sourced persona codex, analyst-only buyer verbatims). No full evidence UI |
| S3 twin calibration | **Parked** |
| S4 copy-set backend | **Replaced** by B1. Synthetic copy scoring is not built |
| S5 copy-set UI and compliance | Compliance rules move into B1 and B2 |
| S6 format and head-to-head | **Parked.** Format effects come from live data (B3) |
| S7 round report | **Becomes B4** |
| S8 performance ingestion | **Becomes B3, moved to the critical path** |
| S9 governance | Minimal: provenance and audit trail in B1 and B4 |
| Probes, realism, `vector_constraints` flags | Stay in the code, default off. No further work |
| RalphScore | Stays on the per-test page. Not used in anything Trupanion sees |
| Insights chat | Folded into B1 as "ask the skeptic" per persona |

Migration numbers: 015 is B1 (it was reserved for SM, which is now parked),
016 is B3 and 017 is B4. 009–014 stay unused.

## 6. Timeline (estimates; to confirm with Brook and Add3)

| Week of | Work | Milestone |
|---|---|---|
| 29 Sep | Monday creative director briefing: strategy, evidence pack, Add3 learnings, the M3 checklist on the nine concepts. **B1 build starts.** Spike finishes | CD's working style and model preference feed B1 |
| 6 Oct | B1 usable (brief, grid, flags, curate, export). First real Studio batch with the CD. B2 script on Tier 1 concepts | Month 1 pre-test delivered |
| 13 Oct | B3 ingestion and model on Add3's historic export; decision gate runs if the data has arrived. Expectations for Month 1 recorded (B4 record only) | Month 1 creative live (mid-Oct target) |
| 20 Oct | B3 weekly note on the first live data. B2 on production assets | First weekly read |
| 27 Oct – Nov | B4 round close and ledger. Month 2 batch through B1 and B2 | Month 1 round close; Month 2 pre-test |

Rough effort, before review: B1 about 5–6 days, B2 about 2, B3 about 4–5,
B4 about 3. B1 and B3 can run in parallel sessions after the first week.

## 7. Open questions for Brook

1. **The go-live date** for Month 1 creative. It's the hard deadline for B3.
2. **Media spend per month and ads per round.** They decide how confident
   B3 can be, and whether per-persona reads are realistic.
3. **Can Add3 run equal-budget or A/B cells** for the lines and territories
   we most want to learn about?
4. **How does the creative director prefer to work?** Live sessions, or
   reviewing on their own? That decides whether B1 needs comments or sharing
   in its first version.
5. **Trupanion's compliance format:** is there a template or tracker to export
   to? Also the turnaround time, which was asked for on 24 Sep.
6. **Who owns social listening** for the monthly persona refresh?
7. **Whether readout v1 went to the client** with the old slide 5 wording,
   and so whether v2 needs a line about the change.

## 8. Next steps once approved

1. Mark S2–S9 and SM Phase B as superseded in `docs/build-sessions.md`, and
   add session prompts for B1–B4 (same ground rules).
2. Spin up the B1 session.
3. Stop or finish the spike, and write its handoff.
