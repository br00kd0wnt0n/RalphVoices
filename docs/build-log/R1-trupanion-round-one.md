# R1: Trupanion round one, pass 1 findings, twin fixes and pass 2 plan

Internal. Written 25 Sep 2026 to bring together the work from the round-one
Cowork session (pass 1, 24 Sep), the twin-fixes branch (`3ef410b`, merged as
`1140b00`) and this session. Working files (persona seeds, concept cards,
ledger, `runner.js`) live outside the repo in Brook's
`Claude outputs/voices-r1/`, because they're client material.

## Pass 1 (24 Sep): what it found

Nine concepts from the creative deck (three per persona), each run against all
three twins, 2–4 runs per concept, `vector_constraints: false`, panels of
about 20 (28–29 in pass 1b).

| Twin | Noise (mean abs. RalphScore delta run to run) | Spread (best minus worst) | Spearman run to run | Read |
|---|---|---|---|---|
| Curators | 2.0–3.1 | 18–23.5 | 0.55–0.67 | Signal: same top two and same bottom every run |
| DINK | 6.2–6.9 | 8.5–20.5 | −0.32 to 0.40 | Noise |
| Families | 1.7–1.9 | 3–5 | 0.28–0.57 | Ceiling: everything 88–97 |

No blind controls have run, so nothing is on record yet.

## Diagnosis

1. **Measurement, first.** Each panel member scores one ad alone on 1–10, and
   GPT-4o bunches those at 7–9 whatever the ad. Better seeds shrink this; only
   a different measurement fixes it.
2. **The persona set-up pre-sells.** The generated voice sample pitched
   insurance. The motivations were labelled "Trigger N (strongest)" and each
   card was written to one trigger, so the twin saw the ad's rationale in its
   own profile. Several `language_markers` were verbatims from people who had
   already bought Trupanion (the readout's quote bank is mostly customers), so
   an uninsured twin spoke like a converted one. Families (2 of 6 markers
   from buyers) is at the ceiling; Curators (3 of 6) scores high, mostly
   84–92, but still ranks. DINK, whose markers are mostly skeptical, scores
   lowest. Three twins can't prove the link.
3. **Panels over about 20 came back short** (a request for 30 returned 11).

## What has shipped

| Change | Where |
|---|---|
| Panels built in batches of 10; a still-short panel returns 502 and keeps the old one | twin fixes |
| `variant_config.realism` (opt-in): scale anchored to a scroll-past ad, category baseline, attitude as behaviour | twin fixes |
| Lived voice samples and hand-written `voice_sample` | twin fixes |
| `variant_config.probes` (opt-in): P(stop), P(tap), P(quote) from logprobs; migration 008 | twin fixes |
| Probe follow-up told to answer in one word with no scores (the reused prompt asks for a `---SCORES---` block); mock server answers probe calls | this session |
| Password auth closed: the Railway URL bypassed tools.ralph.world's Google check | this session |

Not yet shipped from the ranked list: pairwise comparison (#1), questions and
simulated feed that match the ledger metrics (#3, partly covered by the
probes), stats and ledger export (#6), blind-control harness (#7).

## Seed v3 (draft, outside the repo)

Only `motivations` and `language_markers` change. Motivations become
first-person situations with no trigger labels or ranking, using only facts
already in v1. Buyer verbatims come out of `language_markers` (they belong in
the evidence layer as analyst-only items). Pain points, including every
"turned off by", are unchanged.

## Pass 2 protocol

1. Smoke test: one concept, one run, `realism` and `probes` on. Probes must be
   populated and in a plausible range. **This is a hard gate.**
2. Voice samples regenerated with `voice_style: 'lived'`; none mentions insurance.
   Seed v3 applied if approved.
3. Panels rebuilt at 30 per persona; each must return 30.
4. Nine concepts × three runs, `variant_config: {vector_constraints: false,
   realism: true, probes: true}`, `variants_per_persona: 30`.
5. Rank within each persona on p_stop (hook) and p_tap (CTR), with p_quote as
   the conversion read. Report run-to-run Spearman, noise against spread, and
   winner stability.
6. Bar: Spearman above 0.8, spread at least twice the noise, blind controls in
   the right order. **Without the four SuperAds controls, pass 2 tests
   reliability only**: a consistently wrong ranking clears the Spearman bar.

Cost: about 2,400 panel responses plus about 7,300 probe calls, roughly
$60–90 at gpt-4o prices, and about an hour with three tests in parallel.
Pass 2 changes realism, voice, panel size and (if approved) seeds at once, so
a pass won't say which change did it. If it fails, the first diagnostic is one
run with realism off.

Pass 2 runs from the Voices iframe inside tools.ralph.world (the console's
frame picker set to the Voices iframe, `runner.js` pasted in), or with an
allowlisted service account (`PASSWORD_LOGIN_EMAILS`). Cloud sessions can't
reach Railway at all.

## Sequencing (decided 25 Sep: measurement session next, then evidence)

- Monday 29 Sep prediction of record runs on the tool as it stands (operating
  plan rule): probes + realism at best. Record only what clears the bar.
- Next build: a measurement session (pairwise test type with position swap
  and Bradley-Terry ranking, blind-control harness, sweep and ledger export).
  This pulls forward S6's head-to-head and S4's leaderboard statistics.
- Then the evidence layer (S2, migration 014), then copy-sets. Copy-sets need
  a sparse pairwise design: full pairwise over M messages is M(M−1)
  comparisons per panel member.

## Readout deck note

Slide 5 describes the twins as scored on sentiment, engagement, share and
comprehension and "calibrated against a growing bank of reference reactions"
that from round two "includes Trupanion's real Meta and TikTok results". Pass
1 found anchors can't hold live results in this build (that's S8), and the
ranking will likely move to probes or pairwise comparison. Worth correcting
before the deck becomes the client's readout v2.
