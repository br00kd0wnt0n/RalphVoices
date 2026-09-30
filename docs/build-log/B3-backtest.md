# B3 back-test on Add3's history (the v2 plan's decision gate)

29 Sep 2026, branch `voices/b3-weekly-read`. Summary numbers only; the full report, the copy table, the tags and every CSV are client material in `Claude outputs/voices-r1/backtest/`. Pre-registered in `docs/build-log/backtest-preregistration.md` (054b633, amendment c15d8b1, both committed before any copy was tagged). Spend: **$0.89** of the $10 cap (tagging only); no synthetic stage.

## Step 1: the weekly read on real data (dry run)

- **Reconciled exactly with the source:** Meta $2.31M and 287.8M impressions (301 ads); TikTok $100.6k and 20.4M impressions (28 ads).
- **TikTok spend is $100.6k, not ~$201k.** The export's one "-" row is a grand total; it's excluded.
- **Fixes from the first real run** (commit 74bddc0):
  - `RET` reads as retargeting (config v4);
  - historic mode infers region and format from Add3's names;
  - ad sets are named when a persona runs several;
  - a long headline is summarised;
  - exports without a quote column aren't read as zero quotes;
  - historic notes say their calls are retrospective.
- **Meta gives whole-period totals per ad,** so there is no weekly or time dimension. **Add3 can't export month by month (29 Sep),** so a time split is closed for historic data. Holding out whole copies stays the method; the weekly read builds its own time series from launch on (the daily Google Sheet).

## Step 2: the back-test

**Design** (Brook, 29 Sep): the distinct copy (headline + body) is the unit, whole copies are held out (not time), text only, B2's rubric features from rules v2.8.

| | Meta | TikTok (descriptive) |
|---|---|---|
| Prospecting ads ≥ 50k impressions | 252 | 17 |
| Distinct copies | 20 (14 fit, 6 test) | 10 |
| Content features tagged on at least one copy | 6 of 15 | 0 of 15 |
| Features on ≥ 3 fit copies (testable) | 2 ("less hassle", "vet paid directly") | 0 |

**Results** (feature × outcome, Meta):
- 0 supported, 6 not supported, 54 not enough data.
- The two testable features weren't clear on any outcome. Their 90% ranges span roughly −50% to +150% on CTR, and wider on quotes and enrollments.
- The 6 held-out copies carry none of the tagged features, so no hold-out check was possible.

**Controls on Meta** (context, observational, 90% ranges). Quotes are "Checkouts initiated" and enrollments are "Purchases", both confirmed by Add3 on 29 Sep; the attribution window is unknown. TikTok's "Purchases (website)" as enrollments is still an assumption.

| Contrast | Link CTR | Quotes / 1k | Enrollments / 1k |
|---|---|---|---|
| Single image vs UGC video | −26% (−38% to −12%) | −32% (−42% to −21%) | −20% (−29% to −9%) |
| Carousel vs UGC video | −7% (−33% to +29%) | −53% (−65% to −38%) | −22% (−39% to −1%) |
| US vs CA | +25% (+8% to +45%) | +29% (+13% to +47%) | +24% (+11% to +37%) |
| +10 points of Reels + Stories share | +7% (+4% to +10%) | −12% (−15% to −10%) | −6% (−8% to −3%) |

- Campaign waves after Q1-2026 convert less (e.g. Q2-2026 against Q1-2026: quotes −21%, enrollments −20%). This mixes creative fatigue, season and audience.

## Decisions (as pre-registered)

- **Learning ledger (B4):** no copy feature gets a prior from this history; it starts neutral on all 15.
- **Synthetic reads:** not run in this pass (stage 2c skipped). The track is neither opened nor closed.
- **The pipeline works end to end** (ingest → copies → B2 tags → analysis). It repeats unchanged when the creative files arrive (via Figma and SuperAds); the visual back-test is the one that can answer the question.

## For the creative team (plain English)

- Trupanion's past Meta ads use very little distinct copy: about 20 headline-and-body pairs across 252 prospecting ads, and short ones. So the history can't tell us which *copy* ideas work. That's a gap in the data, not a finding that copy doesn't matter.
- What the history does show, with ranges, is about format:
  - **UGC video beats single images** on every measure: about a quarter more clicks, a third more quotes and a fifth more enrollments per impression.
  - **Carousels got about half the quotes of UGC video.**
- **US ads outperform CA on every rate by about a quarter.**
- **Reels and Stories placements bring more clicks but fewer quotes and enrollments** per impression than Feed.
- **Every result is observational.** Meta chose who saw each ad, and copy, image, audience and timing move together, so treat these as leads to test, not rules.
- This is why Month 1 runs 3 copy lines on each visual: it's the only way to learn about copy separately from the image.

## Files

- Code: `backend/src/services/weekly/backtest.ts` (pure analysis; tests `backend/tests/backtest.test.ts`) and `backend/scripts/backtest.ts` (`copies`, `tag`, `analyze`).
- Client folder:
  - `step1/`: the dry run;
  - `copies.csv`, `ads.csv`, `copy-features.csv`, `audit/`;
  - `backtest-report.md`, `effects.csv`, `controls.csv`, `copy-effects.csv`;
  - `spend.json`.
