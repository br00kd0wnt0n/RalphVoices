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

Updated 25 Sep. Brook has rewritten slide 5 of the Persona Intelligence Readout
("What an audience twin is, and isn't"). The scoring and "calibrated against
reference reactions" lines are gone. The twins are now described as a writing
partner and stress test, with dated expectations per persona checked against
live results (expected versus actual). The footer reads: "The twins sharpen
before spend; the market decides." Slides 4 and 6 should use the same wording
("stress-tested", "expectations", "expected versus actual"). See
`docs/voices-v2-plan.md`.

## Pass 2 results (25 Sep): halted at the smoke gate

Run against production through the API with Brook's SSO session. No code was
changed. Pass 2 stopped at step 1: the smoke gate failed three times, so the
sweep (nine concepts × three runs) did not run and panels were not rebuilt.
Spend was three smoke tests, about 230 panel responses plus probes (roughly $5).

State left in production: seed v3 and lived voice samples are applied to the
three Trupanion personas (none of the three voices mentions insurance). The
panels are unchanged (20 DINK, 28 Curators, 29 Families).

| Smoke | Setup | Twin | p_stop | p_tap | p_quote | RalphScore |
|---|---|---|---|---|---|---|
| 1 | CUR_DAYONE, seed v1 | DINK | 0.978 | 0.950 | 0.899 | 89 |
| | | Curators | 1.000 | 1.000 | 0.992 | 92 |
| | | Families | 0.999 | 1.000 | 0.924 | 89 |
| 2 | CUR_DAYONE, seed v3 + lived voice | DINK | 0.992 | 0.975 | 0.792 | 90 |
| | | Curators | 1.000 | 1.000 | 1.000 | 93 |
| | | Families | 0.966 | 0.966 | 0.962 | 87 |
| 3 | DINK_IDIOT, seed v3 + lived voice | DINK | 0.950 | 0.950 | 0.947 | 92 |
| | | Curators | 0.913 | 0.893 | 0.838 | 86 |
| | | Families | 1.000 | 0.999 | 0.948 | 90 |

All runs used `realism` and `probes` on and `vector_constraints` off. Probes
were present on every response, so the plumbing works. The values sit at the
ceiling.

What the smoke tests show:

1. **Attitude doesn't reach the probes.** With realism on, skeptics (attitude
   1–3) are told they stop for fewer than 1 in 20 of these ads. In smoke 2 they
   still gave p_stop 1.000 (Curators n=4, Families n=5, DINK n=1) with
   sentiment 6.8–8. Only 1 of 77 responses had p_stop below 0.9 (4 of 77 in
   smoke 3).
2. **Realism didn't move the 1–10 scores.** Sentiment was 8 or 9 in 69 of 77
   responses in smoke 2 and 68 of 77 in smoke 3. DINK gave DINK_IDIOT 92;
   pass 1 had it at 63–79.
3. **A bottom-ranked concept barely moves the probes.** Curators, the one twin
   that ranked in pass 1, dropped from 1.000 to 0.913 on p_stop going from its
   pass-1 top concept to a pass-1 bottom one. That is the right direction, but
   it comes from two or three panel members flipping to No, not from a graded
   probability. On a panel of 28 that is inside the run-to-run noise to expect
   from a count that small. Families stayed at 1.000 on both.
4. **Rebuilding panels would not help.** The concept prompt reads the base
   persona live (profile, voice, realism baseline); only name, age, platform,
   attitude, trait and voice modifier come from the panel member, and attitude
   is shown above not to matter.

Why the probes saturate (`services/ai.ts`, `runIntentProbes`): each probe is
asked after the model's own in-character review, which sits in the transcript
as the assistant turn under a system prompt that asks for feedback on a
creative concept. "Would you stop scrolling to take it in?" follows a
paragraph in which it already did, usually approvingly, and at temperature 0
the answer is Yes with probability ~1. Both layers are the problem: the review
is favourable, and the probe echoes it.

**Read for Monday (29 Sep):** no twin is fit for the prediction of record on
probes or RalphScore. This is reliability only in any case (no blind controls
have run), and pass 2 did not get as far as measuring reliability.

Next step is the measurement session, not another pass on this build. Things
to try there: ask the probes cold, without the review in context and inside a
feed of competing posts; ask them before any review; and pairwise comparison
with position swap. If the probes are kept, the smoke gate needs a
discrimination check (a known-weak concept must score clearly below a
known-strong one), not just "not stuck at 0 or 1".
