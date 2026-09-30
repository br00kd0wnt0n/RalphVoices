# Back-test pre-registration: do copy features explain Trupanion's past results?

Written 29 Sep 2026, and committed before any copy was tagged or any outcome was looked at by feature. This is the v2 plan's decision gate (`docs/voices-v2-plan.md`, "Decision gate: back-test on historic data"). Brook chose the design on 29 Sep: hold out whole copies instead of splitting by time (option b), with the distinct copy as the unit. Summary only; no client data in the repo.

## What has already been seen

The Step 1 dry run (B3 weekly read on the same exports) showed:
- totals, ad counts and the number of distinct copies;
- the format contrast across the account (UGC video against single image, on CTR and checkouts).

It did not show any copy text, any feature tag, or any outcome broken down by copy or feature. The format and region effects below are controls and context, not tests.

## Data

- **Meta:** Add3's export of 301 ads, 1 Jan to 27 Sep 2026, one row per ad and placement. Only whole-period totals per ad are available.
- **TikTok:** Add3's daily export, 11 Aug to 27 Sep 2026, 28 ads. It is descriptive only.
- **Join key:** campaign + ad set + ad name.
- **Assumptions, pending Add3, labelled everywhere:**
  - "Checkouts initiated" ≈ a quote started.
  - "Purchases" ≈ an enrollment.

## Units

- **Ads included:** prospecting ads (campaign prefix `Add3_PRO_`) with at least 50,000 impressions. Retargeting ads are excluded.
- **Unit of analysis: the distinct copy.** A copy is the ad's headline plus body, after normalisation (case, whitespace, punctuation at the ends). There are about 20 on Meta and 13 on TikTok. Every ad carrying the same copy contributes to that copy's result, but the copy counts once. Most ads share their copy with others, so treating the 252 ads as independent would overstate how sure we are.
- **Primary: Meta.** TikTok is reported separately and descriptively only: 13 copies across 2 regions, with no checkout column.

## Outcomes (each read as a binomial rate)

| Outcome | Definition | Scope |
|---|---|---|
| Link CTR | link clicks / impressions | all ads |
| Hook rate | Meta: 3-second plays / impressions. TikTok: 2-second views / impressions (not pooled with Meta) | ads with video plays only |
| Checkouts per 1,000 impressions | checkouts initiated / impressions (ASSUMPTION: quote started) | Meta |
| Purchases per 1,000 impressions | purchases / impressions (ASSUMPTION: enrollment) | Meta; TikTok descriptive |
| Cost per purchase | spend / purchases | descriptive only, never a test |

## Predictors

- **Copy features:** B2's rubric content features (the `features` block of the rules file, v2.6 or later; the version is recorded with the run). They are tagged by B2's audit library on the ad copy only (headline + body, text-only mode; no images are available) with gpt-4o at temperature 0, both wordings averaged. A feature is present at P(Yes) ≥ 0.5, B2's own threshold.
- **Controls, at the ad level:**
  - region (US / CA);
  - format from the ad name (UGC video / carousel / single image / other video);
  - campaign wave (the quarter in the campaign name);
  - placement mix (the share of impressions in Reels and Stories placements against Feed and the rest).

## Method

1. **Ad-level adjustment.** A weighted least-squares fit on each ad's log rate against the controls. Each ad's weight is 1 / (binomial variance of its log rate + the between-ad variance). The between-ad variance is estimated by method of moments and floored at a 0.05 coefficient of variation. An ad's residual is what is left after the controls.
2. **Copy effect.** A copy's effect is the weighted mean of its ads' residuals, with its own variance. Copies are the units from here on.
3. **Feature effects.**
   - One weighted regression of copy effects on the features. Weights are 1 / (the copy's variance + the between-copy variance), the latter estimated by method of moments from the residuals.
   - A feature enters only if at least 3 copies have it and at least 3 don't.
   - If the model would have fewer than 4 residual degrees of freedom, each feature is fitted on its own instead (one model per feature) and labelled "not adjusted for other features".
   - Every range is widened by the model's own residual spread when that exceeds 1.
   - Effects are reported as rate ratios with 90% ranges.
4. **Multiple comparisons.** Within each outcome, "clear" needs the range to exclude no effect after a Bonferroni allowance for the number of features tested for that outcome (the same rule as B3's weekly read). The printed range is the plain 90% one.
5. **Hold-out.**
   - Copies are split once, before fitting: sort by the SHA-256 of the normalised copy text; the first two-thirds (rounded up) are the fit set, the rest the test set. No outcome is used to split.
   - The feature model is fitted on the fit set.
   - On the test set, the feature's sign is the difference in mean copy effect between copies with it and without it (both groups need at least 1 copy; otherwise "not testable").

## Decision rules (fixed now)

**Per feature and outcome:**
- **Supported:** clear in the fit set (after the allowance) and the same sign in the test set.
- **Not supported:** estimable in the fit set but not clear, or clear with the opposite sign in the test set.
- **Not enough data:** fails the copy counts, or not testable in the test set.

**What follows:**
- A supported feature becomes a starting prior for B4's learning ledger, on that outcome, with its range and the label "historic, text only, observational".
- Features that aren't supported give no prior; the ledger starts neutral on them.
- Nothing here is a claim about Month-1 creative. The client hears about it only as "what Trupanion's own history suggests", with the caveats.
- **Synthetic reads (optional stage 2c):** not run in this pass. If they are run later: the M1 cold "would you tap?" read on test-set copies, 3 personas × 10 panel members. A rank correlation ρ ≥ 0.4 with actual CTR on at least one metric means synthetic reads may enter the internal forecast, weighted by their track record; below that, the synthetic ranking track closes.

## Expected power (said now, so a null isn't a surprise)

About 20 Meta copies means about 13 in the fit set and 7 in the test set. Only large copy effects, on the order of ±30% or more, can come back clear. Most features are expected to be "not enough data" or "not supported". That is an honest answer about what this history can show, not a failure.

## Amendment 1 (29 Sep 2026, before any copy was tagged or any outcome looked at by feature)

Found by testing the method on made-up data with planted effects (`backend/tests/backtest.test.ts`), not by looking at Trupanion's results:

- **Step 1 now fits the controls within copies (a fixed effect per copy).** A copy's effect is still "what is left after the controls", as above, averaged over its ads. Fitted across copies instead, the control model had soaked up the real differences between copies into the between-ad variance, so the between-copy variance came out near zero, the ranges were too narrow, and null features were called clear in 2 of 12 checks. The between-ad variance is now the spread among ads carrying the same copy.
- **The between-copy variance uses the standard DerSimonian–Laird estimator** for a meta-regression, instead of a simpler moment estimate.
- **Also fixed now:** tagging uses the rules file on disk at run time (v2.7 on 29 Sep), and the optional synthetic stage (2c) is skipped in this pass (Brook, 29 Sep).
- **This is also a pipeline check:** the same steps run again when Add3's monthly re-pull and creative files arrive.

With these changes, on six made-up worlds with 21 copies, a planted ×1.6 copy feature was "supported" in all six, with ranges covering the truth. Null features were never "supported". With no copy effects at all, nothing was supported.

## Known limits

- **Observational, not randomised:** Meta's delivery chooses who sees which ad, and copy is confounded with image, audience and timing.
- **Text only:** the image, which varies most between ads, isn't in the data.
- **Whole-period totals:** Meta gives no time dimension per ad. When Add3's monthly re-pull arrives, a time split can repeat this test.
- **Conversion columns are assumptions** pending Add3.

## Outputs

- Client folder (not committed): `Claude outputs/voices-r1/backtest/`.
- Repo (summary numbers only): `docs/build-log/B3-backtest.md`.
