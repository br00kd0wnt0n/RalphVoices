# B3: ingestion and weekly read (handoff)

Branch `voices/b3-weekly-read`, from `origin/main` at 6774672, 28 Sep 2026.
Plan: `docs/voices-v2-plan.md` §B3 and §7a (on `voices/v2-plan-docs` until PR #10 merges).
**Contains migration 016.** The backend runs every migration on boot and Railway
auto-deploys `main`, so this must reach `main` only as part of a deliberate deploy
with Brook. Nothing is pushed.

## What shipped

CLI and pure modules; no UI, no API route, no change to how concept tests run.

| File | What it does |
|---|---|
| `backend/config/weekly-read.json` | Every threshold, the column mapping, the audience rule and the wording rules, each with its reason. Written before any live data. |
| `backend/src/db/migrations/016_live_performance.sql` | `live_ingests`, `live_ads`, `live_metrics`. No foreign keys to `studio_*`; features join by naming stub (text). |
| `backend/src/services/weekly/naming.ts` | Parses `PERSONA_TERRITORY_FORMAT_v#_PLATFORM_YYMMDD`; a bad name fails with a reason. |
| `backend/src/services/weekly/csv.ts` | CSV reader and writer (no dependency). |
| `backend/src/services/weekly/ingest.ts` | Export → rows: column mapping, number and date parsing, the audience rule, the feature join, the quarantine list, and summing of breakdown rows. |
| `backend/src/services/weekly/series.ts` | Reads chained week by week from the start of the flight, so hold bars can see last week's calls. |
| `backend/src/services/weekly/window.ts` | Rows → one record per ad over a date window. Prospecting ads with parsed names only; the rest are counted. Overlapping exports are de-duplicated. Monday–Sunday weeks. |
| `backend/src/services/weekly/stats.ts` | Seeded RNG, beta, gamma and binomial draws, quantiles. |
| `backend/src/services/weekly/model.ts` | The model (below). Pure. |
| `backend/src/services/weekly/note.ts` | Weekly note (Markdown) and CSV ledger, the wording lint, and the "no new numbers" guard for LLM prose. |
| `backend/src/services/weekly/simulate.ts` | Synthetic Meta and TikTok exports with planted effects, plus the recovery check. |
| `backend/src/services/weekly/store.ts` | Database read and write. Takes its own pool (never `db/index.ts`, which loads `backend/.env`). |
| `backend/scripts/weekly.ts` | CLI: `migrate`, `ingest`, `features`, `note`, `read`, `simulate`, `status`. |
| `backend/tests/weekly.test.ts` | 29 tests, including hold bars: parser variants, ingest, windows, the model on simulated truth, the thin week, the null case, the quote-column fallback, the note's wording and the number guard. |

`backend/package.json` is untouched: run it with `npx tsx scripts/weekly.ts`. `npm test` picks up the new test file.

## The model

1. **Rates.** Hook rate (3-second plays / impressions; video formats VID, TT and UGC), link CTR (link clicks / impressions), and quotes per 1,000 impressions. Each is a binomial rate. Cost per quote is derived from the quote rate with its range. Cost per enrollment is observed only and never used for a call.
2. **Partial pooling (empirical Bayes, beta-binomial).** Each ad is shrunk towards its persona × platform × format mean. That mean is shrunk towards persona × platform, then persona, then the overall mean, each level as if the parent were worth 2 more ads. Prior strength comes from the between-ad spread (CV), estimated from the data once 6+ ads are readable, clamped to 0.05–0.8, and 0.25 before that. Each ad gets a posterior mean and a 90% range.
3. **P(best in ad set)** and **P(worse than the ad set's median)**: 4,000 seeded Monte Carlo draws from the posteriors, among the ads in the same ad set (persona × platform) that have enough data. The same data always gives the same numbers.
4. **Calls.** These are made on quotes per 1,000 impressions. While quotes are too thin, link CTR can support a cut but not a scale. Hook rate is diagnostic.
5. **Feature and format effects.** One weighted regression on the log rate: persona × platform fixed effects plus format plus features. Each ad's weight includes the between-ad spread, so two ads can't make a feature look certain.
   - The fit is checked against its own residuals: if ads scatter more than expected, ranges widen.
   - "Clear" needs the range to exclude no effect after a Bonferroni allowance for the number of features checked together. The printed range is the plain 90% one.
   - Effects use only ads with enough impressions for that metric, and ads with unknown features are left out (not counted as "without").
   - Per persona × feature runs the same way within one persona. It reports only when there are 4+ more ads than terms, so in Month 1 it will mostly say "not enough data".

**Deviation from the plan:** the plan says "pools across ads through territory, format and feature effects". Ad rates pool through persona, platform and format. Territory isn't a pooling level, because with two territories per persona a month a territory is nearly one asset. Features enter through the regression, not the ad-level prior. The prior then stays simple, and a feature can't flatter the ads that carry it.

## Config thresholds and why (`backend/config/weekly-read.json`, version 2)

| Setting | Value | Why |
|---|---|---|
| `metrics.hook_rate.min_impressions` | 2,000 | At ~25–35% hook rate, 2,000 impressions gives about ±2 points. |
| `metrics.link_ctr.min_impressions` | 8,000 | At 1.4% CTR that's ~110 clicks, about ±15% on the rate. |
| `metrics.quotes_per_1k.min_impressions` | 20,000 | At ~0.6 quotes per 1,000 that's ~12 quotes, about ±30%. |
| `calls.min_days_live` | 4 | Meta's learning phase skews early delivery. |
| `calls.min_ads_in_cell` | 2 | Nothing to compare with fewer; a lone ad is "keep testing", never "scale". |
| `calls.p_best_scale` | 0.8 | Scale when P(best in ad set) ≥ 0.8. |
| `calls.max_tied_scale`, `p_beat_median_tied_scale` | 2, 0.9 | If the top two together reach 0.8 and each beats the median with P ≥ 0.9, both are "scale (tied)". Never "the winner". |
| `calls.p_worse_than_median_cut` | 0.9 | Cut when P(worse than the ad set's median) ≥ 0.9. |
| `calls.hold` (v2) | scale 0.6, tied scale 0.75, cut 0.75 | Hysteresis. Starting a call needs the full bar; keeping last week's call needs only the lower one. A scale stays while P(best) ≥ 0.6 and nothing else has reached 0.8. A tied scale stays while the ad is still in the top two and beats the median with P ≥ 0.75. A cut stays while P(worse) ≥ 0.75. Reads are chained week by week from the start of the flight (`series.ts`), so each week knows last week's calls. |
| `calls.primary_metric` / `fallback_metric` | quotes per 1,000 / link CTR | Calls are made on quotes. Clicks can support a cut, never a scale (`fallback_can_scale: false`). |
| `model.interval` | 0.9 | 90% ranges throughout. |
| `model.between_ad_cv` | default 0.25, 0.05–0.8, estimated from 6+ ads | Sets how hard ads are pulled towards their group. |
| `model.group_prior_ads` | 2 | Group means lean on the level above when a group has 1–2 ads (the Month-1 norm). |
| `model.cell_by` | persona, platform | A cell is one ad set per persona per platform: what Add3 can act on. |
| `features.min_ads_with` / `min_ads_without` | 3 / 3 | Within ad sets that have both. |
| `features.min_residual_df` | 4 | The regression must have 4 more ads than terms, so it can check its own fit. |
| `audience.default` | unknown | A campaign that matches neither pattern is left out and listed, so retargeting can't slip into a creative read. |
| `cost_benchmarks.cost_per_quote` | null | Trupanion's PAC by state hasn't arrived. Ad names don't carry state either, so a by-state comparison would also need a state breakdown. The note says so. |

Change a threshold only with a new `version` and a dated entry in `changes`. The note prints the config version.

## Acceptance evidence

All numbers come from simulated exports (made-up territory codes, planted effects, Add3-like rates: CTR 1.1–1.7%, about 4.5% of clicks quote, 7% of quotes enroll, CPM around $10). Month-1 volumes are 36 prospecting ads (6 statics × 3 lines, 3 hero videos × 2, 3 carousels × 2, 1 UGC × 2, 2 TikTok builds × 2) at about 28,000 impressions per ad per week for 4 weeks. Each simulated export also contains 3 retargeting ads, 4 bad names, 3 cosmetic name variants and a totals row.

**Planted effects, seed 42** (`npx tsx scripts/weekly.ts simulate --scenario month1 --seed 42 --check`):

| Planted | Metric | Truth | Estimate [90% range] | Status |
|---|---|---|---|---|
| member_testimony | quotes/1k | ×1.50 | ×1.64 [1.20, 2.24] | recovered |
| dollar_figure | link CTR | ×1.35 | ×1.34 [1.13, 1.60] | recovered |
| dollar_figure | quotes/1k | ×1.35 | ×1.39 [1.03, 1.87] | not clear yet |
| FAM × start_early | link CTR | ×1.50 | — | not enough data |
| VID vs ST | link CTR | ×1.30 | ×1.00 [0.82, 1.23] | not clear yet |
| UGC vs ST | link CTR | ×1.80 | — | not enough data (one UGC asset) |
| humour (small) | CTR / quotes / hook | ×1.05 / 1.05 / 1.25 | ×1.12 [0.96, 1.30]; ×1.13 [0.87, 1.45]; — | not clear yet ×2; not enough data |
| vet_authority (small) | quotes/1k | ×1.08 | ×0.98 [0.69, 1.40] | not clear yet |
| CAR vs ST (small) | link CTR | ×0.92 | ×0.78 [0.64, 0.96] | recovered (clear, covers truth) |
| 6 no-effect checks | | ×1.00 | | all correctly not called |

18 ads were called. The 4 scale calls went to the true best ad in their ad set (the planted standout is one of them). The 2 tied scales went to the true #1 and #3. Every Meta cut was in the true bottom half. The TikTok ad sets hold 2 ads each, so the worse one of each was cut.

**30 seeds per scenario:**

| Scenario | Ad reads | Scale calls (true top 2) | Cuts (true bottom half) | Large effects recovered | False "clear" effects |
|---|---|---|---|---|---|
| Month 1 | 1,080 | 158 (148) | 361 (353) | 70 of 180; the rest "not clear yet" or "not enough data" | 2 |
| Thin week (≈3,500 imp./ad) | 1,080 | 0 | 0 | 0 of 180 | 0 |
| No true differences | 1,080 | 3 | 6 | n/a | 1 |

- **Thin week:** 1,075 of 1,080 ad reads were "too early to call" and the other 5 "keep testing". Every feature and format effect was "not enough data".
- **Before the joint regression:** with a feature-by-feature comparison, false "clear" effects were 29 in 30 Month-1 reads, from features that happened to travel with a real one. The fit check then removed a false "humour +245% for FAM" caused by a standout ad.
- **The price:** power. At Month-1 volumes a large feature effect is clear about half the time; small ones almost never are.

**Parser:** accepts case, stray spaces, spaces as separators, Studio's `STATIC`/`CAROUSEL`, `TIKTOK`, doubled underscores, a repeated persona prefix, extra suffixes after the date, Meta's " - Copy", YYYYMMDD, underscores inside territories, and a missing date (warning). It quarantines, with reasons: unknown persona, format or platform; an impossible date; no v#; no territory; too few parts; a platform that doesn't match the export. Planted bad names in every simulation are quarantined and listed in the note.

**Migration 016:** `npm run db:migrate` twice on a fresh local `voices_b3_test` (all migrations, then again), then `weekly.ts migrate` twice. Clean each time.

**Idempotent ingest:** the same Meta file ingested twice: first "ads 39 new, 1,092 metric rows new", then "0 new, 39 updated; 0 new, 1,092 updated". `live_metrics` held 1,204 rows after Meta twice plus TikTok once (1,092 + 112).

**Type checks and tests:** `npx tsc --noEmit` in backend (only the known pdf-parse and rcb-client errors) and frontend (clean). `scripts/weekly.ts` type-checks with the same compiler options. `npm test`: 84 of 84 pass.

**Sample notes for Brook to review** (simulated data, outside the repo): `/Users/BD/ralph-voices/Claude outputs/voices-r1/weekly/sample/`
- `weekly-2026-10-12.md`, `weekly-2026-10-19.md`, `weekly-2026-11-02.md`: weeks 1, 2 and 4 of a simulated Month 1, from the database. Week 2 and later show "what moved".
- `thin-week/weekly-2026-10-12.md`: the thin week, "too early to call" throughout.
- Each has a `-ledger.csv`.

## How to run a week

Local database only. Set `DATABASE_URL` explicitly; `weekly.ts` refuses a non-local host and never reads `backend/.env`'s database.

```bash
cd backend
export DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_dev
npx tsx scripts/weekly.ts migrate

# Monday or Tuesday: ingest the week's exports (daily breakdown, prospecting and retargeting together is fine)
npx tsx scripts/weekly.ts ingest --file "/Users/BD/ralph-voices/Claude outputs/voices-r1/weekly/in/meta-2026-10-19.csv" --platform meta
npx tsx scripts/weekly.ts ingest --file "/Users/BD/ralph-voices/Claude outputs/voices-r1/weekly/in/tiktok-2026-10-19.csv" --platform tiktok
#   features come from Claude outputs/voices-r1/studio/shortlist.csv automatically if it exists; or pass --features FILE (repeatable)
#   check the printout: columns mapped, quarantined names (send to Add3), unknown-audience ads, features joined

# Draft the note (week = any date in the Monday–Sunday week; --since = start of the flight)
npx tsx scripts/weekly.ts note --week 2026-10-19 --since 2026-10-12
#   writes Claude outputs/voices-r1/weekly/weekly-2026-10-19.md and -ledger.csv, and runs the wording check

# Optional: a 2-3 sentence "In short" per persona drafted by GPT-4o (about $0.02); rejected if it adds a number
npx tsx scripts/weekly.ts note --week 2026-10-19 --since 2026-10-12 --prose

npx tsx scripts/weekly.ts status
```

Brook edits the Markdown before the Wednesday read. Re-ingesting a corrected or overlapping file is safe: rows upsert on ad and period, and when a daily and a weekly file cover the same days, the coarser rows are dropped from the read (and counted in the note). If features arrive after the ads have been ingested: `npx tsx scripts/weekly.ts features --file SHORTLIST.csv`.

Try it without a database:

```bash
npx tsx scripts/weekly.ts simulate --scenario month1 --seed 42 --check
npx tsx scripts/weekly.ts read --file "<dir>/meta-export.csv" --platform meta --features "<dir>/shortlist.csv" --note
```

## Column mapping (Meta Ads Manager, ad level, daily breakdown)

Matched case-insensitively, ignoring punctuation. A trailing `*` in the config is a prefix match.

| Field | Meta header(s) | TikTok header(s) (unconfirmed) |
|---|---|---|
| ad name | Ad name | Ad name |
| campaign / ad set | Campaign name / Ad set name | Campaign name / Ad group name |
| period | Day (or Reporting starts + Reporting ends) | Date / By Day |
| spend | Amount spent (USD) | Cost |
| impressions, reach, frequency | Impressions, Reach, Frequency | same |
| hook | 3-second video plays | 2-second video views (not comparable with Meta; only compared within TikTok) |
| ThruPlays | ThruPlays | 6-second video views |
| link clicks | Link clicks | Clicks (destination) |
| landing page views | Landing page views | Landing page views |
| quotes | **to confirm** (guesses: Quotes, Quote starts, Website quotes, Custom conversions: quote…) | to confirm |
| enrollments | **to confirm** (guesses: Enrollments, Website enrollments, Custom conversions: enroll…) | to confirm |

`ingest` prints what mapped, what's missing and which headers went unused. With no quote column, the read runs on clicks: cuts are allowed, scales are not, and the note says so.

## Open items for Add3

1. **Conversion column names** for quotes and enrollments in their Meta export: custom conversion names, and the attribution window. Add them to `columns.meta.quotes` / `enrollments`.
2. **Ad names exactly as agreed**, including 2–3 copy lines per asset as separate ads. Studio's shortlist gives each line its own `v#`, so a line is `PERSONA_TERRITORY_FORMAT_vN_PLATFORM_YYMMDD`. Confirm Add3 will use the Studio stub's v# for the line, not their own counter.
3. **Campaign or ad set names that say prospecting or retargeting** (or tell us their words for them, for `audience.*_pattern`).
4. **SuperAds export shape:** if SuperAds is the source rather than Ads Manager, a sample file so the mapping can be checked.
5. **TikTok export:** Ads Manager ad-level daily, or whatever they can give, and at what cadence. The TikTok mapping above is a guess.
6. **Daily breakdown, not placement or age.** Breakdown rows are summed, but reach and frequency are lost.
7. **The historic export** for the back-test (below).

## Item 5: Add3's historic export (not arrived)

When Brook says where it is:

```bash
cd backend
npx tsx scripts/weekly.ts read --file "<path>" --platform meta --historic --note --out "/Users/BD/ralph-voices/Claude outputs/voices-r1/weekly/backtest"
```

- `--historic` keeps ads whose names predate the convention as their own ads. B2 audit features can join by an `ad_name` column.
- Report which columns mapped, what was quarantined, and the read. The ledger CSV (per ad: hook rate, CTR, quotes per 1,000 with ranges) is what the decision gate needs.
- The gate's rules are in the v2 plan and must be written down before looking at the data.

## Known gaps

- **Calls near a threshold (fixed in config v2, at Brook's request):** hold bars (`calls.hold`) now keep last week's call until the evidence falls well back. Over 30 simulated months, A→B→A reversals fell from 57 to 24, and from 9 to 2 with no true differences. End-of-month accuracy held: 158 of 169 scales in the true top two, 370 of 381 cuts in the bottom half. The cost: with no true differences, a wrong call is held longer (end-of-month calls 9 → 14 in 1,080 ad reads). "What moved" still shows every change, and a held call says so in its reason.
- **Between-ad spread is estimated before features and formats are taken out**, so it's on the high side. Ranges on features are conservative, and large effects are clear about half the time at Month-1 volumes. A residual-based estimate is a B4 candidate once real data shows how ads actually vary.
- **P(best) is among ads with enough data.** A new ad joins its ad set's comparison once it passes the minimum. Until then it's listed as "too early to call".
- **One ad set per persona per platform is assumed.** An ad set name isn't used for cells, so Advantage+ or broader structures still work (cells come from the ad name). The cell label ("DINK_META") is ours, not Add3's ad set name.
- **Volume assumption:** the simulation spends about $41k over the month (≈4.2M impressions). A read on quotes needs 20,000 impressions per ad: about $7k a month at 36 ads and a $10 CPM, before any comparison is possible. At lower spend, quote calls come later and CTR carries the early weeks (cut only). Media spend is still open (plan §7, item 2).
- **Feature effects on real Month-1 data will mostly read "not enough data"** because features will be confounded with assets. The simulation assigns features at random, which is the best case. Copy lines on the same visual are what will separate them.
- **LLM prose (`--prose`) hasn't been run against the API.** The coordination session asked for no OpenAI calls during simulation runs. The guard (`newNumbers`, `lintNote`) is unit-tested; the first live run costs about $0.02.
- **PAC benchmark:** not wired beyond a single optional `cost_benchmarks.cost_per_quote` target, pending the data and a state breakdown.
- `live_ads.asset_link` exists but nothing fills it yet (B2 or Studio can).

## What B4 needs from here

- `readWeek()` returns everything B4's round close needs: per-ad rates with ranges, P(best), calls, and feature and format effects with ranges (`Effect[]`, pooled and per persona). The ledger CSV has one row per ad × metric × week, which is the raw material for the learning ledger.
- **Expected versus actual:** B4's expectation records name lines or assets by naming stub. `live_ads.stub` is the join key, the same one Studio's shortlist and B2's audit use.
- **Feature vocabulary:** `live_ads.features` holds Studio feature ids plus `angle:<id>` and `structure:<name>`. Keep the vocabulary stable across rounds, or map old ids to new.
- **Config versioning:** B4 should record `config_version` with every round close, as the ledger does.
- The statistics are all in `src/services/weekly/` with no database or network; B4 can import them directly.
