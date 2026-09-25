# Trupanion readout: results view spec

Internal. Written 25 Sep 2026. Built in SM Phase B (item 7); the parts marked
**S7** follow straight after SM. Read with `docs/build-log/R1-trupanion-round-one.md`.

## Why

`TestResults.tsx` reports one test, which is one concept. Every question in
this engagement compares concepts:

1. Which concept wins for each persona, on hook, CTR and intent?
2. Did each concept win with the audience it was written for?
3. How sure are we, and is this persona fit for the prediction of record?
4. Why did it win or lose?

Round one answered these outside the app with runner scripts and CSVs. The
readout answers them in one view. The per-test page stays as it is, as the
page you drill into.

What the current page gets wrong for this work:

- The RalphScore gauge, sentiment pie and 1–10 averages sit at the ceiling
  (7–9) and aren't the ledger metrics. The readout doesn't show them.
- The platform and attitude breakdowns come from how panels are generated,
  not from the audience. The readout doesn't show them.
- Themes are pooled across personas, so the persona differences, which are
  the point of the work, disappear.

## The unit: a readout

A readout is one set of concepts (2–12, including controls) × one or more
personas × N runs, with the same measurement settings throughout. Where it
comes from depends on which method passes the SM spike:

- **Pairwise (M2):** one pairwise test plus its sweep runs.
- **Cold probes (M1):** a set of concept tests sharing `options.readout_key`,
  plus their sweep runs.

`GET /api/readouts/:key` returns the same shape either way, so the UI doesn't
care which method produced it.

```
{
  key, name, project_id, method: 'pairwise' | 'cold_probe', questions: ['stop','tap','quote'],
  concepts: [{ code, label, intended_persona?, is_control, expected?, control_metric? }],
  personas: [{ id, name, code, panel_versions: [..], seed_or_evidence_version }],
  runs: n, created_at, completed_at, cost_usd, calls,
  by_persona: {
    [personaId]: {
      [question]: {
        ranking: [{ code, strength, range: [lo, hi], tie_group, rank }],
        reliability: { spearman_mean, spearman_pairs, noise, spread, spread_over_noise, same_winner },
        controls: { correct, total, passed },
        position_bias?: number,
        fit_for_record: boolean, fit_reasons: [string]
      }
    }
  },
  cross_persona_agreement: { [question]: { pairs: [{a, b, spearman}] } },
  reasons?: { [personaId]: { [code]: ReasonsBlock } },   // S7
  lock?: PredictionLock                                   // S7
}
```

`fit_for_record` is true when controls passed, Spearman is above 0.8 and
spread is at least twice the noise. `fit_reasons` names each check that
failed. The bar is the one in the R1 note, so it lives in one constant shared
with the statistics module.

## The view (`/readouts/:key`)

Reached from the project page (a "Readouts" list) and from any test that
belongs to one. It has four sections, top to bottom, with no tabs.

### 1. Header and verdict strip

- Readout name, method, date, runs, personas, concepts (with the number of
  controls), cost.
- One chip per persona: **Fit for record** (green), **Reliability only**
  (amber: stable but controls haven't run or failed), or **Not for record**
  (grey), each with a one-line reason.
- A question switch (Hook / CTR / Intent) that drives sections 2 and 3. It
  defaults to Hook.

### 2. Rankings per persona

- One column per persona.
- Concepts are ranked top to bottom, each with a horizontal bar for strength
  and a line for its 95% range.
- Tie groups are bracketed and labelled "tied". Nothing within a tie group
  gets an ordinal rank in the copy.
- A concept written for that persona gets a marker. Controls are shown in a
  muted style with ✓ or ✗ against their expected position.
- Under each column: Spearman, noise versus spread, position bias (pairwise
  only), controls n of m.
- A persona that isn't fit for record is shown at reduced opacity with its
  reason. It is never hidden.

### 3. Concept × persona grid

- Rows are concepts and columns are personas. Each cell shows that concept's
  rank for that persona on the selected question, shaded by strength.
- The cell for the intended persona is outlined.
- A final column answers "did it land with its intended audience?": whether
  the intended persona ranks it in its top third, compared with the other
  personas.
- Under the grid: cross-persona agreement. If every pair is above 0.9, it
  shows a plain note: "The personas rank these concepts almost identically;
  differences between audiences are not supported by this readout."

### 4. Reasons (S7)

For each persona and concept, reached by clicking a grid cell or a ranking row:

- **Why they'd stop** and **why they'd scroll past:** 3 short reasons each,
  with the share of panel members giving each one.
- **Turn-offs hit:** matched against that persona's "turned off by" list,
  with counts.
- **Misreads:** comprehension failures (what they thought the ad was for).
- **Two or three twin quotes,** labelled as synthetic panel members.
- A link to the filtered responses on the per-test page.

Reasons need a review, and SM rule 1 forbids asking a measurement question
with a review in context. So reasons come from a separate review call that
runs **after** the measurement calls, when `options.reasons: true` is set
(default on for readouts, off for sweeps beyond run 1). One LLM pass per
persona × concept extracts and counts the reasons. Quotes are copied exactly
and never paraphrased.

## Prediction lock and ledger (S7, fed by S8)

- A **Lock prediction** button, enabled only for personas that are fit for
  record. It stores who locked it, when, the ranking, ranges, the reliability
  numbers, the versions (panel, seed or evidence, prompt) and a SHA-256 of the
  payload. A lock can't be edited. Relocking creates a new version and keeps
  the old one.
- Once live results are imported (S8), each locked concept shows its actual
  metric beside its predicted rank, together with the rank correlation.
  Actuals come from prospecting ads only, per metric (hook rate, link CTR,
  cost per quote).
- Storage: `prediction_locks` (id, readout_key, project_id, persona_id,
  question, payload jsonb, sha256, locked_by, locked_at, version). This goes
  in SM's migration 015 so S7 needs no migration.

## Exports

- **Ledger CSV** (SM): one row per persona × concept × run × question, as in
  SM item 5.
- **Client export** (S7): a PDF or slide-ready PNG per section: the verdict
  strip, the rankings for each question, the grid, and reasons for the top
  and bottom concept per persona.
  - Every page carries: "Synthetic panel. Reliability shown; validity is
    established only by blind controls and live results."
  - Personas that aren't fit for record appear only with that label.
  - It carries no RalphScore.

## Copy rules

- Say "panel members", "concepts", "hook / CTR / intent", "tied" and
  "fit for record". Never say "variant" for copy, and never say "winner" for a
  concept inside a tie group.
- Every number has its range or reliability nearby. There are no bare point
  estimates in client-facing views.
- Probabilities are shown as relative strength, not as predicted CTR. The
  twins aren't calibrated to absolute rates.

## Not in scope

- Changes to `TestResults.tsx`, other than a "Part of readout X" link.
- RalphScore, sentiment, platform or attitude segments, brain balance,
  shareability, or GWI in the readout.
- Chat. It stays on the per-test page.

## Acceptance

- Local, with the mock (known preferences per concept and persona, one
  reversed control): the rankings recover the known order; the reversed
  control is flagged ✗; that persona is marked Not for record with the reason;
  the grid outlines intended personas; the agreement note shows when the mock
  gives every persona the same preferences.
- It renders with 1 persona, 3 personas, 13 concepts and 1 run. With a single
  run, the reliability numbers show as "needs ≥2 runs", not as zeros.
- A type check passes, and a screenshot of each section goes in the SM
  handoff.
