# B2: Pre-flight audit on finished assets

Session B2 of VOICES v2 (Trupanion), Mon 28 Sep 2026. Branch `voices/b2-preflight` (from `origin/main` at 59c24cb). Not pushed. A script; not deployed.

It checks finished ad assets (statics, carousel cards, video keyframes) against each persona's turn-offs, the copy and brand rules and clarity at a glance, before they go to Add3. It also tags each asset with the rubric's content features, which B3's weekly read learns from. **Flags with sources; never a score or a ranking.**

## Update, 28 Sep (later): the engine behind Studio's Pre-flight step

Brook's answers and a scope change, relayed by the coordination session:

- **A library for the hosted Studio.** `backend/src/services/audit/index.ts`: `estimateAudit(input, opts)` → `{calls, usd, seconds}`, `runAudit(input, opts)` → a versioned report JSON (`report_version: 1`), `featuresRow(report)` → one row for B3's `weekly.ts features`. The input is `{stub, persona?, files: [{name, mime, data: Buffer}], copy?: {primary_text, headline, description, caption, hook, on_image}, transcript?}`. The rules, the rubric, the files and the OpenAI client are passed in; the library reads nothing from the client folders and writes only under `tmpDir`, which it removes afterwards (on failure too). The B1 Studio session builds the UI, routes and storage against it. The CLI runs on the same engine and now also writes `reports/<stub>.json` in the same shape.
- **Copy match** (`copyMatch.ts`): the signed-off copy for the stub is compared with the text read off the asset and the voice-over, normalised (case, punctuation and line breaks don't count), card by card first. **Amber `COPY_MATCH`** when an on-image line or hook is reworded (both versions quoted, with the share of words matching) or missing; **grey** when a signed-off headline isn't on the image (it may run in the headline field); **red `COPY_CAVEAT`** when a required caveat in the signed-off on-asset copy (e.g. "at participating hospitals") isn't on the asset. Post text (primary text, description, caption) isn't expected on the asset, but it still gets every rule check.
- **Voice-over transcription**: the `transcript` input or a `<stub>.transcript.txt` sidecar first; otherwise the soundtrack is extracted with ffmpeg and transcribed with **gpt-4o-transcribe** ($0.006 a minute, in the estimate). whisper-1 was tried first and dropped 8 of 10 words after a pause on the planted clip. Spoken claims get every copy and compliance check (`where: voice-over`).
- **Rules v2.3** (from the B1 Studio session, approved by Brook): `COMP_PREEXISTING` is narrowed, so CUR_VET's accurate caveat is no longer red. Brand items with `applies_to: "visual"` (the 16 photography don'ts, BG p.18) or `"both"` (`BR_SAD_PET`) are asked of the images as yes/no items, using their own wordings when the rules give them and otherwise two built from the rule text; `"visual"` items skip the text patterns and aren't asked of text-only concept cards.
- **Thresholds in config** (`services/audit/config.json`): text load stays at 20 words on the first frame or card (Brook, 28 Sep); feature tag threshold, lone yes/no threshold, models, default pace, transcription price, the $2 ask and the $10 cap.
- **ffmpeg, ffprobe and tesseract are detected** (`ffmpegPath`, else PATH). Without ffmpeg, a video is audited on its copy and voice-over (the mp4 goes to transcription directly) with the note "Video frames unavailable (ffmpeg not installed)". Without tesseract there's no OCR cross-check, and a note says so.
- **Outages stop the audit.** A network drop during run 3 left one card's calls backing off for an hour. Now 3 calls in a row failing after their retries stop the audit with "OpenAI unreachable". A failed image read no longer aborts the audit: its text is missing and a note says so.

## What shipped

- `backend/scripts/audit.ts`: the CLI.
- `backend/src/services/audit/`: self-contained; imports nothing from Studio or weekly code.
  - `rules.ts`: paths, loading the rules file and rubric, parsing naming stubs (same normalisation as B3's reader)
  - `assets.ts`: finding assets in a round folder, sidecar copy, ffmpeg keyframes, tesseract
  - `copyChecks.ts`: the rule-based checks on the copy and the on-image text
  - `checks.ts`: the yes/no items, each tied to a rules-file id or a rubric item
  - `api.ts`: OpenAI plumbing after the spike's M3 runner (logprob P(Yes), TPM pacing, spend log and cap, stop when credits run out)
  - `engine.ts`: one asset through every layer; severity by agreement
  - `report.ts`, `round.ts`: reports, summary, features CSV, flag sheet, the M3 comparison
  - `mock.ts`: `--mock` stand-in (tesseract for vision, keyword heuristics for yes/no)
- `index.ts` (the library API), `copyMatch.ts`, `tools.ts` (binary detection), `config.json` + `config.ts` (thresholds)
- `backend/tests/audit.test.ts` and `backend/tests/auditLibrary.test.ts` (a fake OpenAI client through the real API layer), with made-up rules in `backend/tests/fixtures/audit/`.

No migration, no UI, no route, no new package, no new environment variable (optional `AUDIT_CLIENT_DIR`, `AUDIT_KEY_FILE`, read by the script only). Rules are read from the Studio rules file (v2.2), not forked.

## How to run a round (copy-paste)

Brook drops assets into `/Users/BD/ralph-voices/Claude outputs/voices-r1/assets/<round>/`, each named by its naming stub (`PERSONA_TERRITORY_FORMAT_v#_PLATFORM`, a delivery date suffix is fine):

- a static: `FAM_SUMMER_ST_v1_META.png` (or .jpg/.webp)
- a carousel: a folder `DINK_UNEXPECTED_CAR_v1_META/` of numbered cards (`1.png`, `2.png`…)
- a video: `CUR_DAYONE_VID_v1_META.mp4` (or .mov)
- optional sidecar copy `<stub>.txt` next to it (or inside a carousel folder), one field per line with a label: `Primary text:`, `Headline:`, `Description:`, `Hook:`/`On-screen text:`, `Caption:`, `CTA:`, `Voice-over:`. A line without a known label continues the field above it.
- optional voice-over transcript `<stub>.transcript.txt`.

From the worktree (after merge, the same from `/Users/BD/ralph-voices/backend`):

```bash
cd /Users/BD/ralph-voices/.claude/worktrees/bold-noether-368eb6/backend
```

```bash
npx tsx scripts/audit.ts estimate --round month1
```

```bash
npx tsx scripts/audit.ts run --round month1 --yes
```

`--yes` is only needed when the estimate is over $2 (ask Brook first). Add `--only STUB,STUB` for some assets, `--tpm 25000` when Studio isn't in use (the default 15k leaves half the account's gpt-4o limit to Studio), `--mock` for a free rehearsal. A re-run of one asset replaces its report and keeps the rest of the round.

Output in `Claude outputs/voices-r1/audit/<round>/`:

| File | What it is |
|---|---|
| `summary.md` | Assets with red flags first, then by name (triage order, not a ranking); features by asset; cost and time per asset |
| `reports/<stub>.md` | Per asset × intended persona: flags (with the quoted words or frame, and the source), the other personas' turn-offs as grey notes, features, the skeptic's objection, the extracted text per image or frame, every yes/no read |
| `features.csv` | For B3: `stub`, `features` ("a; b"), `angle` (from the territory), plus P(Yes) per feature and flag counts |
| `flag-sheet.csv` | One row per flag, with blank `agree` and `note` columns for Brook |
| `audit.json`, `calls.jsonl`, `frames/`, `low/` | Raw results, every call, extracted keyframes, 512 px copies |

Then:

```bash
cd /Users/BD/ralph-voices/.claude/worktrees/dazzling-mcclintock/backend && npx tsx scripts/weekly.ts features --file "/Users/BD/ralph-voices/Claude outputs/voices-r1/audit/month1/features.csv"
```

```bash
npx tsx scripts/audit.ts agree --file ~/Downloads/flag-sheet-marked.csv
```

(`agree` counts y/yes/agree against n/no/disagree in the `agree` column and lists the misses.)

## What each check does, and its source

Every flag names a rules-file id and carries that item's source from `studio-rules.json`; rubric-worded items also cite the rubric item (RB).

1. **Read the images** (gpt-4o, `detail: high`, one call per image, card or keyframe): every visible word, and a literal description (people and rough ages, children, each animal's expression, setting, whether the Trupanion name or logo shows). **tesseract** reads the same image; words it reads that vision didn't are listed in the report and run through the rule checks too, capped at amber (“read by tesseract only; check the image”).
2. **Video keyframes** (ffmpeg): first frame, 1.5 s (the hook), then every 3 s, and the last frame, capped at 8.
3. **Rule-based copy checks** on the sidecar fields, the on-image text of every image or frame, and the voice-over. Every compliance rule's patterns (`COMP_*`: direct pay without “at participating hospitals”, pays for itself, paid share, pre-existing, routine care, claim speed, cheap/locked, price lead, coverage caveats, superlatives), quote-bank verbatims (6+ words), figures against the facts list (`FIG_UNSOURCED`, `FIG_CITATION`, `FIG_ATTRIBUTION`), brand naming (`BR_NAMING`), sentence case in copy fields (`BR_CASE`; on-image caps are a design treatment and not flagged), the persona turn-off patterns, and character limits for copy fields (`fields`). Direct pay: the caveat on the same card, frame or field is clean; elsewhere in the ad is amber; nowhere is red. A price is a lead (red) on a headline, hook or the first card or frame.
4. **Yes/no items**, each asked in two wordings at temperature 0 with the images at `detail: low` plus the transcription; P(Yes) from logprobs, averaged:
   - the 15 content features in the rules file, with the M3 rubric's wordings (RB)
   - persona turn-offs: the rubric's do-not items where they match a turn-off (`pet_as_practice`→`DINK_T_PRACTICE`, `mocks_viewer`→`DINK_T_MOCK`, `baby_talk`→`CUR_T_BABY`, `older_pet_pitch`→`CUR_T_OLD_PET`, `pity_older`→`CUR_T_PITY`, `fear_death`→`CUR_T_FEAR`, `shames_uninsured`→`FAM_T_SHAME`, `cheap_price_pitch`→`FAM_T_LATTE`), and B2's own two wordings for the rest (`DINK_T_INDULGE`, `DINK_T_NAIVE`, `CUR_T_EXPLAIN`, `FAM_T_DEAD_PET`, `FAM_T_THREAT`, `FAM_T_LECTURE`) and for `BR_SAD_PET`
   - clarity: `one_glance` (`CL_GLANCE`) and `clear_product` (`CL_PRODUCT`), flagged when the averaged read says No
   - video only: brand or product clear on the 1.5 s frame, and on the last frame (`CL_PRODUCT`), asked with that frame alone
5. **Compliance yes/no** on all the ad's words (gpt-4o-mini, the rules file's own two wordings per compliance item).
6. **One reviewer call** (gpt-4o, images low + text) against every compliance, brand and turn-off rule, returning the rule id, where, and the quoted words or what the image shows. Ids not in the rules file are dropped.
7. **Text load**: words on the first frame or card; amber over 20 (`TEXT_LOAD`, a house default: **Brook to confirm**).
8. **UGC casting**: real people or testimony (P ≥ 0.5) or a UGC format gives a grey `COMP_UGC_MEMBER` note.
9. **The skeptic**: one objection, under 30 words, in the intended persona's lived voice (seed from `personas.json`, voice from the spike's `voices.json`), seeing the ad.

**Severity needs agreement** (as in Studio). Red: a rule match, or the reviewer and the compliance yes/no (P ≥ 0.5) agreeing. Amber: the reviewer alone, or a lone yes/no at P ≥ 0.8; the intended persona's turn-offs, brand, clarity, limits and text load. Grey: the other two personas' turn-offs (how the asset travels), UGC casting. A reviewer hit that the yes/no reads clearly contradict (P < 0.2), or a direct-pay hit when the caveat is in the ad, is listed under “Set aside” in the report, not flagged. Features are tagged at P ≥ 0.5.

## Acceptance

Outputs are in the client folder (not the repo): `Claude outputs/voices-r1/audit/concepts-r1/` and `audit/planted/`.

**1. The nine round-one concept cards as text-only assets vs the spike's M3 table** (`concepts-r1/m3-agreement.md`). Same rubric wordings, gpt-4o, temperature 0, both wordings averaged, over all 26 rubric items (15 features, 9 do-nots, 2 clarity):

| Run | Cells on the same side of 0.5 | Cells differing by more than 0.3 | Largest difference |
|---|---|---|---|
| 1 (16:41) | 234 / 234 | 0 | 0.22 (`older_pet_pitch`, FAM_JOB) |
| 2 (17:09, after the fixes below; the feature path is unchanged) | 233 / 234 | 0 | 0.21 (`older_pet_pitch`) |
| 3 (rules v2.3; FAM_CHILDPROOF re-run after a network drop) | 234 / 234 | 0 | 0.16 (`older_pet_pitch`) |

Per feature, the mean absolute difference is 0.000–0.023 for all 15 content features; the largest per-item means are `clear_product` (0.06) and `older_pet_pitch` (0.04). The one side-flip in run 2 is `clear_product` on FAM_JOB: 0.496 against the spike's 0.64, a borderline item on both runs. No disagreement is over 0.3, so there is nothing to explain beyond run-to-run wobble on borderline items.

**2. Planted test images** (made here with PIL: plain white text on a coloured square, no stock photos; `assets/planted/`, made by `audit.ts plant`), live run 2:

| Asset | Expected | Result |
|---|---|---|
| DINK_PLANTPAYS_ST (on image: "It pays for itself.") | red | 🔴 `COMP_PAYS_FOR_ITSELF`, quoted, found by the rule, the reviewer and both yes/no wordings (P 1.00). Also amber `DINK_T_BABY_CAREFUL` ("fur baby" in the sidecar) and its grey cross-persona note `CUR_T_BABY` |
| FAM_PLANTDIRECT_ST (on image: "We pay your vet directly at checkout.") | red | 🔴 `COMP_DIRECT_PAY`, quoted, rule + reviewer + yes/no (P 0.97). Amber `CL_PRODUCT` (P 0.35) |
| CUR_PLANTCLEAN_ST (direct pay with "at participating hospitals") | no red | ✅ no red. One amber: `TEXT_LOAD` (23 words; the house threshold is 20) |
| DINK_PLANTCAR_CAR (3 cards, "$6,000" framed as what surgery can run) | no red | no red; amber `COMP_FACT_FRAMING` (reviewer; the framing is correct, so this is noise) and `CL_GLANCE` |
| FAM_PLANTVID_VID (9 s video from 3 cards, sidecar with "best pet insurance" and a 42-character headline) | ambers | 5 keyframes (0, 1.5, 3, 6, 8.9 s); amber `COMP_SUPERLATIVE` "best", `BR_NAMING` "pet insurance", `LIMIT_MAX` 42/40, `CL_GLANCE`, brand not clear on the 1.5 s frame (a teaser opening, correctly read) |

**2b. Planted spoken claim** (`FAM_PLANTVO_VID`: the video cards plus a voice-over made with macOS `say`, "Honestly, they pay the whole vet bill"; no sidecar): transcribed by gpt-4o-transcribe word for word, 🔴 `COMP_PAID_SHARE` quoted from the voice-over (rule + reviewer, P 1.00). $0.27, 5 min.

**3. Human agreement on real drafts: not yet run.** Needs the first three Month 1 drafts (due Wed 30 Sep or Thu 1 Oct) and Brook's marks on `flag-sheet.csv`; then `audit.ts agree`. Target ≥ 90%.

**4. The features CSV loads into B3.** On a throwaway copy of B3's local test database (`voices_b3_test` copied to `voices_b2_featcheck` on :54329, dropped afterwards), with B3's code as of 4ee144e in its worktree: `weekly.ts features --file` read both CSVs with no errors (5 and 9 stubs parsed, none quarantined). After ingesting a four-row synthetic Meta export whose ad names carry the planted stubs plus a delivery date, `features` updated all 4 stored ads (`live_ads.features` e.g. `["direct_vet_pay", "less_hassle"]`); `weekly.ts read` on the same export reported "Features joined for 4 of 4 ads". The concept CSV carries `angle` (e.g. `DINK_A5`), which B3 tags as `angle:DINK_A5`.

**Rules-file finding for Brook (fixed in v2.3).** On runs 1 and 2, CUR_VET gets a red `COMP_PREEXISTING`: the rules file's pattern `\bcover[^.!?]{0,40}pre-?existing` matches the card's accurate caveat (a line saying conditions that appear before coverage starts may count as pre-existing). The rule cites that slide as a source, so it may be intended as a check. If not, the pattern could exclude "may be considered / aren't covered / excluded". Studio would flag the same line. B2 doesn't change the rules file. Brook had the pattern narrowed in v2.3; on run 3 CUR_VET has no red flag and none of the nine cards has one.


## Known gaps

- **Motion and music aren't judged.** Video is read as up to 8 still keyframes plus the transcribed voice-over. Pacing, cuts, music, tone of voice and supers that appear between keyframes are unseen.
- **Features are judged from stills plus a transcription**, not from watching the ad. A joke carried by timing, or a person who only appears between keyframes, can be missed.
- **Visual turn-offs rest on the images at detail low** (512 px) plus the high-detail description. Small facial expressions on a busy frame can be missed; `BR_SAD_PET` is the one to watch.
- **The photography don'ts are judged at 512 px** (detail low) with generic wordings built from each rule. Blur, exposure and saturation are harder to judge at that size; they need Brook's marks before anyone relies on them. They also add about 32 reads per image asset (roughly +50% time and cost).
- **The text-load threshold (20 words)** is a house rule Brook confirmed on 28 Sep, not a platform limit (`config.json`).
- **Copy match is word-level.** A rewording that keeps most words in order (e.g. "at checkout" → "at the counter") is amber. A line split across two cards is matched on the joined text. Stylised type the vision read garbles will read as "reworded"; check the image.
- **Model flags vary a little run to run** (gpt-4o at temperature 0 is near-deterministic, not exactly). Rule-based flags don't.
- **`COMP_FACT_FRAMING`** (model-only, amber) can fire on a correctly framed figure, as it did in Studio. It needs Brook's marks before any tightening.
- **Clarity on carousels and video.** The rubric's `one_glance` asks whether the headline or first frame alone carries the point; a teaser opening ("Summer plans?") reads No by design. That's an amber prompt to look, not a breach.
- **Product clarity on the first frame of video** uses the hook frame's words and description; a logo too small to read at 512 px may be missed. The high-detail description says whether a Trupanion name or logo is visible.
- **Figures** use English patterns; decades and ages ("late 50s") are skipped, but other numbers on images (phone numbers, dates) will be flagged as unsourced and need a look.

## Deviations and why

- **Two-stage vision.** Every image is read once at `detail: high` (text and a literal description); the yes/no items see the images at `detail: low` plus that transcription. Asking ~70 yes/no reads with high-detail images would cost about 5× more (a video at ~$1) and take ~15 minutes per video at the shared TPM. Text accuracy, where compliance lives, stays at high detail.
- **A gpt-4o confirmation for lone compliance reads.** The first live planted run showed gpt-4o-mini's yes/no reading correct direct-pay lines as "pays the whole bill" (P ≥ 0.8) with no quote behind it. Lone reads are now re-asked on gpt-4o and flagged only if both agree; otherwise they're listed under "Set aside" in the report.
- **A reviewer hit on a required caveat that's present** (the reviewer quoted "at participating hospitals" as a direct-pay breach) is set aside, not flagged.
- **Concept cards: only quoted words get the copy checks.** A card mixes description and copy; an age in a visual description ("late 50s") had read as an unsourced figure.
- **Tesseract-only findings are amber at most.** tesseract garbles stylised type; a red needs vision to read the words too.
- **The features CSV carries `angle`** from the territory in the rules file, so B3 tags `angle:<id>` as it does for Studio's shortlist.

## How the hosted Studio could show these reports later

- **Storage:** `audit.json` per round is already one record per asset (stub, flags with sources, features with P, frames' text, objection). A later migration could hold it as `audit_assets` (stub, round, persona, kind, flags JSONB, features JSONB, objection, run metadata) keyed by naming stub, next to `studio_lines`.
- **Screen:** a read-only "Pre-flight" tab: per asset the keyframes or cards as thumbnails, the flag chips (same red/amber/grey as Studio, each opening its rule, quote, frame and source), the features and the skeptic. Agree/disagree buttons per flag would replace the flag sheet and feed calibration.
- **Joins:** the naming stub already links a signed-off Studio line, its audited asset and B3's live read, so the B3b Live tab could show the audit flags next to the live result.
- **Running it:** superseded on 28 Sep: the Studio calls `runAudit` directly (above). Run it as a background job with progress (`onProgress`), not inside a request: a static takes about 1.5-2 minutes and a video 4-6 at the shared TPM.

## Costs and time

| Set | Assets | Calls | Cost | Time | Per asset |
|---|---|---|---|---|---|
| Concept cards (text only), run 2 | 9 | 776 | $0.35 | 7.7 min | $0.039, 51 s |
| Planted, run 2 | 5 | 449 | $0.48 | 9.7 min | $0.096, 117 s |
| — static (1 image) | | 87–89 each | $0.06 | 80 s | |
| — carousel (3 cards) | | 89 | $0.12 | 140 s | |
| — video (5 keyframes) | | 95 | $0.19 | 204 s | |

At 22k gpt-4o tokens per minute; the run is rate-bound, not cost-bound. **Session spend: $2.52 of the $10 cap** (concept cards three times, planted twice, the planted voice-over video twice, and FAM_CHILDPROOF once more after the outage). Estimates run about 40% high (planted: $0.69 estimated, $0.48 actual).

Month 1 (6 statics, 3 carousels of ~5 cards, 6 videos of 8 keyframes) will estimate at about **$4.70** with v2.3's photography items and transcription (a static now ~$0.12, a 5-card carousel ~$0.33, an 8-frame video ~$0.50, before the usual ~35% overestimate: likely **$3–3.50** actual) and take **60–90 minutes** at 15k TPM, over the $2 ask threshold, so `run` will stop and ask for `--yes`.

## Files

- `backend/scripts/audit.ts`
- `backend/src/services/audit/{types,rules,assets,copyChecks,checks,api,engine,report,round,mock}.ts`
- `backend/tests/audit.test.ts`, `backend/tests/fixtures/audit/{rules,rubric}.example.json` (made up)
- Client folder (not in the repo): `Claude outputs/voices-r1/assets/planted/` (planted images, made here), `Claude outputs/voices-r1/audit/{concepts-r1,planted}/`, `audit/spend.json`

## For the next session

- Month 1 drafts: run `estimate` first; 15 assets estimate at about $4.70 (likely $3–3.50 actual) and 60–90 minutes at 15k TPM. Ask Brook before `--yes`.
- After Brook marks the first three drafts' flag sheets, run `agree` and tune from the misses (thresholds live in `engine.ts`; rules changes go in the rules file with Brook).
