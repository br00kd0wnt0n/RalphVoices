# Studio: region (US / Canada) and the new naming code (29 Sep 2026)

Branch `voices/studio-region-naming`, from `main` at 4b6f4f5. **No migration**, so this can merge and deploy on its own; it doesn't need to wait for a deploy with a migration. B4's reserved 018 is untouched.

Context (Add3 call, 29 Sep):
- US and Canada run as separate ads. Canadian versions should feel distinctly Canadian, not a US ad with a maple leaf.
- Each copy line on a visual is its own ad, and a persona × territory × format can have several visuals.
- The personas are built on US data.

## What shipped

### 1. The naming code, defined in one place

`backend/src/utils/namingCode.ts` is the only place the format is written down. Studio (Shortlist, Ready for production, the handoff pack), Pre-flight and the audit library (`services/audit/rules.ts` `parseStub`) all build and read codes through it.

- **New form:** `PERSONA_TERRITORY_FORMAT_[visual][line]_REGION_PLATFORM`, for example `FAM_SUMMER_ST_A2_US_META`: visual A, copy line 2, US, Meta. `_YYMMDD` is added at trafficking, as now; Studio never writes it.
- **Earlier form, still read everywhere:** `PERSONA_TERRITORY_FORMAT_v#_PLATFORM`.
- **If Add3 want a change** (this is proposed, not yet confirmed):
  - A different token order is a change to the one line `CODE_ORDER`; building and reading both follow it.
  - A new region is one entry in `REGIONS`.
  - Defaults in the same file: three lines per visual, and US.
- **Codes are written in their short forms:** format ST, CAR, VID or UGC (Studio's territories say STATIC, CAROUSEL…); platform META or TT (the rules' fields say TIKTOK). This matches the example agreed on the call and what B3 already normalises to.

### 2. Where the visual letter comes from: sign-off (design choice)

The letter is set at **Ready for production**, not at the Pre-flight upload. Once signed off, it never changes.

- **Default:** kept lines are packed three to a visual, in the order they were written (A1 A2 A3, then B1…). Each region, platform and format numbers on its own.
- **Moving a line:** the creative lead can move any line to another letter on the Ready screen. The code preview updates straight away and shows exactly what signing off will give. The lines in the set are numbered first, so a line left out doesn't leave a gap.
- **Pre-flight uses the letter as the grouping:**
  - Uploading to A1 ticks A2 and A3 as "same visual" by default.
  - The sidebar groups not-yet-uploaded codes by visual.
  - Sharing one upload across letters is allowed, with a note ("signed off on another visual…"). The codes stay as signed off.
  - A US visual can never serve a Canadian code (refused).
- **Why not at upload:** the Ready for production handoff pack goes to Add3 and Trupanion before any asset exists. Its codes must already be complete and final, and Pre-flight keys every upload, audit and status on the code. A letter assigned at upload would change a code after it had been handed off.
- **No reuse:** codes signed off anywhere are never handed out again (`services/studio/codes.ts`, `CodeBook`). Shortlist and Ready share this allocator, so the Shortlist shows the code a line will actually get. It used to be able to show a code that was already taken.

### 3. Codes signed off before this change

- A line signed off under a v# code keeps it, including when it's edited and signed off again: its new version carries the same v# code. B3b joins live results on it, and Add3 may already have it.
- Lines signed off for the first time from now on get the new form. One set can mix both forms.
- The version history is never rewritten.

### 4. Region

- **Write & brief** has a Region choice (US or Canada, default US). It's stored on:
  - the brief and the run (`brief.region`);
  - every line (`line.region`, set when the line is written; lines from before have none and read as US);
  - the sign-off (`signoff.region`);
  - and it goes into the naming code. All of this is in existing JSONB, so no migration.
- **One region per run.** A Canadian brief never goes into a US run: the server refuses it (409) and the page starts a new run.
- **The Canadian prompt** (`regionBlock` in `engine.ts`, added to the writer's system prompt, so "More like this" gets it too) asks for:
  - Canadian spelling (colour, favourite, centre, neighbour, cheque);
  - lines that feel distinctly Canadian in voice and everyday detail, "not a US ad with a maple leaf", and no clichés (flags, maple leaves, "eh", hockey);
  - no US-only references;
  - nothing about Canada (prices, laws, coverage, statistics, availability) unless it's in the facts list.

  Canadian lines record `prompt_version: b1-lite-1+ca`. The checker and skeptic prompts are unchanged.
- **The note** "These personas are built on US research; check that they hold for Canadian audiences." shows on Write & brief and in "Who this is" whenever Canada is chosen.
- **Sign-offs are per persona × territory × region.** Pre-flight, the handoff pack and the Ready screen all work from the latest sign-off per region, so a later US sign-off no longer pushes the Canadian set out.
  - The version number is shared by both regions, because the database has `UNIQUE (persona, territory, version)` and changing that would need a migration. So Canada's first set can be "set v2". Canadian sign-off ids read `FAM_SUMMER-CA-ready-v2`.
- **Exports:**
  - Handoff CSV: new Region and Visual columns, after Naming code.
  - Handoff Markdown: sections per region.
  - Compliance sheet for Trupanion: a Region column (US / Canada).
  - Asset handoff list: a Region column.
  - B2's features CSV: unchanged (B3 loads it as it is).
- **Out of scope, as briefed:** Canadian rules content (e.g. "founded in Canada"), which comes in a later rules version.

## Spec for B3 (weekly-read parser, `voices/b3-weekly-read`)

I haven't touched B3's code. For `services/weekly/naming.ts` to match:

> **Live versions (30 Sep): the `<line>` digit is now a version number.** One code is one ad: a set of fields (Meta primary text + headline, optional description; TikTok caption, optional hook) built at Ready for production. `A2` means visual A, version 2, not "copy line 2". The format, the regex and the visual key are unchanged, so B3's parser needs no change; only what the digit means. A line can serve several codes (one headline in A1 and A2), and the visual's on-image text belongs to every code on that visual. Codes signed off before versions (one code per line) keep their codes and are still read.

```
Current:  PERSONA _ TERRITORY _ FORMAT _ [VISUAL][VERSION] _ REGION _ PLATFORM [_ YYMMDD] [_ suffix…]
Earlier:  PERSONA _ TERRITORY _ FORMAT _ v# _ PLATFORM [_ YYMMDD] [_ suffix…]     (still valid; keep reading it)

PERSONA    DINK | CUR | FAM
TERRITORY  one or more tokens (SUMMER, DAY_ONE); a repeated persona prefix (FAM_FAM_SUMMER) is dropped
FORMAT     ST | CAR | VID | UGC | TT   (aliases STATIC, CAROUSEL, VIDEO, TIKTOK as today)
VISUAL     one letter A–Z               \
VERSION    1–99, no leading zero        /  one token, regex ^[A-Z][1-9]\d?$  e.g. A2, B1, C12  (was LINE; same digits)
REGION     US | CA
PLATFORM   META | TT                    (aliases FB, IG → META; TIKTOK → TT, as today)
YYMMDD     trafficking date, as today (YYYYMMDD accepted with a warning)
```

- **Join key** (what Studio stores, `signoff.versions[].code`, earlier `signoff.lines[].stub`, and what Pre-flight's features CSV `stub` column carries):
  - new form: `PERSONA_TERRITORY_FORMAT_<visual><version>_REGION_PLATFORM`, e.g. `FAM_SUMMER_ST_A2_US_META`;
  - earlier form: `PERSONA_TERRITORY_FORMAT_v#_PLATFORM`, e.g. `FAM_SUMMER_ST_v2_META`.
- **The visual** (B3's `asset` field) is the key without the line number: `FAM_SUMMER_ST_A_US_META`. Codes sharing it run on one visual. For v# codes it stays `PERSONA_TERRITORY_FORMAT`, as today.
- **Anchoring:** parse by anchoring on the `[A-Z]\d+` token that is followed by a region token and then a platform token (or on `v#` for the earlier form).
- **Region is part of the key.** US and Canadian ads are separate ads and never share a code.
- **Reference implementation:** `parseCode()` in `backend/src/utils/namingCode.ts`. Test cases are in `backend/tests/namingCode.test.ts` (both forms, dates, suffixes, CA, aliases, errors).

## Tests

`cd backend && STUDIO_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_studio_test npm test`: **127 pass, 0 fail** (115 before this branch).

- **`tests/namingCode.test.ts`** (new):
  - both forms parse, including dates, suffixes, aliases and a multi-word territory;
  - round trips (build → read → build) for US and CA across formats and platforms;
  - errors for bad persona, region or visual;
  - visual keys;
  - the audit library reads both forms;
  - the allocator packs three to a visual, skips signed-off codes, honours a chosen letter, and numbers Canada on its own.
- **`tests/studioRegion.test.ts`** (new, file store, mock):
  - a brief defaults to US, accepts CA and refuses anything else;
  - the Canadian spelling, "maple leaf", US-references and no-facts instructions are in the prompt actually sent to the writer (including "More like this"), and absent from the US prompt;
  - region flows through brief → run → line → run list → run mismatch → Shortlist code → Ready (per region, visual preview) → sign-off (codes as shown, region, id, versions carry codes) → a later US sign-off not dropping Canada → handoff CSV, Markdown and compliance sheet;
  - a line signed off under a v# code keeps it when edited and signed off again, next to a new line getting `A1`.
- **`tests/studioPg.test.ts`** (new test): Pre-flight by region on Postgres:
  - codes listed with their region;
  - same-letter codes share a visual key;
  - a region filter works;
  - a shared A1–A3 upload is accepted;
  - a US visual serving a CA code is refused;
  - cross-letter sharing gives a note;
  - the report and the asset handoff list carry the region.
- **Existing tests updated:** handoff columns are now looked up by header name, not position; the Shortlist code format; the "late line" case now checks that the Shortlist code is free and matches the one given at sign-off.
- Type checks: backend clean apart from the known pdf-parse/uploads and rcb-client errors; frontend clean.

## Acceptance (local hosted mode, 29 Sep)

**Setup:**
- A fresh local database `voices_region` on :54329 (migrations 002–017).
- Backend on :3011 with `ENABLE_STUDIO=true`, `NODE_ENV=development`, password auth open, and two local test accounts: `brook@ralph.test` (admin) and `nick@ralph.test` (Studio and Ready to traffic).
- Frontend on :5173 with `VITE_STUDIO_HOSTED=1`.
- Rules v2.8 (the live file) uploaded and activated through the admin endpoint.
- Mock client for the walk-through, then one live check.

**US run** (Busy Families × One Bill Shouldn't Break the Summer, static):
- Four lines of my own, plus 20 generated.
- Kept six: four primary texts, a headline and a TikTok hook.
- Shortlist: `FAM_SUMMER_ST_A1/A2/A3/B1/B2_US_META` and `FAM_SUMMER_ST_A1_US_TT`.
- On Ready, I moved the headline to visual C: the preview changed to `C1` at once. Signed off as set v1 with the new codes.

**Canada run** (same persona and territory):
- Choosing Canada showed the note on Write & brief and in "Who this is".
- "This starts a new run" appeared, rather than adding to the US run.
- Lines are stored as `CA`, with `prompt_version b1-lite-1+ca`.
- Kept four; signed off as `FAM_SUMMER-CA-ready-v2`: `FAM_SUMMER_ST_A1/A2/A3_CA_META` and `FAM_SUMMER_ST_A1_CA_TT`.

**Pre-flight:**
- The sidebar lists the US and Canadian sets separately, and A1–A3 show as one visual.
- One upload for US A1 with A2 and A3 was audited once, and A1 was marked Ready to traffic.
- A US visual offered to `FAM_SUMMER_ST_A1_CA_META` was refused ("US and Canadian ads are separate visuals").
- The Canadian visual was uploaded and audited separately.

**Exports checked:**
- Handoff CSV (Region and Visual columns: A, B, C);
- Handoff Markdown (a US section and a Canada section, each with its own expected lead);
- Compliance sheet (Region: US / Canada);
- Asset handoff list (Region, same-visual codes);
- Features CSV (new codes in the `stub` column).

**Live check** (real key, $0.04, estimate $0.075):
- A Canadian brief with one line of mine plus four generated. Lines are stored as CA with the `+ca` prompt version, and every check ran.
- Honest read: none of the four generated lines happened to use a word that's spelled differently in Canada, and they don't read noticeably Canadian ("Will a vet bill cancel your summer plans?…"). They're not American either: no US references.
- Four lines is too small a sample to judge by. The instruction is deliberately modest (no invented Canadian facts). If the team wants more Canadian texture, the lever is the brief (reference lines in a Canadian voice), or Canadian rules content in a later rules version.

**Fixed during acceptance:** Shortlist listed Canada before the US; the handoff Markdown lacked a blank line between sections.

**Screenshots** (client material, `Claude outputs/voices-r1/studio/screens/region-30sep/`):
1. `1-brief-canada-note.jpg`
2. `2-ready-us-visual-letters.jpg`
3. `3-ready-canada.jpg`
4. `4-preflight-us.jpg`
5. `5-preflight-us-and-canada-list.jpg`
6. `6-preflight-canada.jpg`
7. `7-shortlist-regions.jpg`

## Deploy notes

- No migration, and no new env var. Existing data needs nothing:
  - sign-offs, runs and lines without a region read as US;
  - v# codes keep working in Pre-flight, the handoff and the audit.
- **Before B3 reads live results on new codes:** B3's parser must accept the new form (spec above). Until it does, B3 will quarantine new-form ad names rather than drop them, which is its current behaviour for names it can't parse.
- **Rollback:** revert the merge. No data is written in a new shape that old code can't read: old code ignores `region`, and would show new-form codes as plain strings.

## Open questions

1. **Add3 to confirm the format.** A reorder is a one-line change to `CODE_ORDER`. If they drop the region or change the letter + number token, the tests in `namingCode.test.ts` say what else moves.
2. **Canada applicability of the personas** is still unconfirmed; the note says so on screen.
3. **Should the sign-off count restart per region** ("Canada set v1")? That needs the database's unique key widened (a migration, so a deploy with Brook). For now the count is shared and the id carries `-CA-`.
4. **Visual letter default:** three to a visual in the order written. If Add3 or the creative lead would rather start every line on A and group by hand, it's a one-line change (`LINES_PER_VISUAL`).

## The ad and its copy options (6 Oct, Add3; to be confirmed by them on 8 Oct)

Add3 will not run three copies of an ad that differ only by caption: Meta treats them as the same ad. Each visual runs as ONE ad carrying several text options, and Add3 report per ad only.

- **The ad's name** is the visual-level code, the current form without the line number: `PERSONA_TERRITORY_FORMAT_[visual]_REGION_PLATFORM[_YYMMDD]`, e.g. `DINK_SOCK_EATER_DOG_ST_A_US_META_261020`. It is what Studio already called the visual key.
- **A1, A2, A3** are that ad's copy options: Studio's own ids, never trafficked as separate ads. The nine Month 1 sign-offs and their 27 codes are unchanged and read as before.
- **One definition:** `adName(code)` and `parseAdName(raw)` in `backend/src/utils/namingCode.ts` (`AD_PATTERN`). A copy option's code reads as the ad it belongs to; an older `v#` code is its own ad. `parseCode` still wants a line number: it reads copy options only.
- **Weekly read:** `backend/config/weekly-read.json` v7 adds the form `PERSONA, TERRITORY, FORMAT, VISUAL, REGION, PLATFORM` (`naming.visual_pattern`), tried after the two earlier forms. An ad name parses with `level: 'ad'`, `line: null`, `version: 0`, and its `stub` is the visual (the same as `asset`). Features must then be per ad to join (a later PR); per-code features don't join an ad name.
- If Add3 say otherwise on 8 Oct: change `AD_ORDER` / `adName` and the config form.

### The ad handoff for Add3 (6 Oct)

`GET /handoff-ads.csv` (Export → "Ad handoff: one row per ad, with text options"; and under Ready to traffic, "the ads, with their text options"): `adHandoffRows` / `adHandoff` in `services/studio/ready.ts`, built from the stored sign-offs through `handoffRows`. Nothing new is stored.

- One row per ad (a visual): Ad name, Region, Month, Persona, Territory, Format, Platform, on-image text, subhead, cards, then each post-copy field's text options (`Meta primary text 1..n`, `Meta headline 1..n`, descriptions and TikTok fields when present).
- Options are the distinct lines across the visual's versions, in first-use order: three versions sharing one headline give three primaries and one headline.
- `<field>: ids` says where each option came from: its line id (the caption id), `(shared)` for a shared caption, and the copy option(s) it was signed off in (`[A1, A2]`). `Copy options (Studio codes)` lists the versions' codes.
- Ready to traffic says "Ready to traffic" only when every copy option on the ad is ready; otherwise what is outstanding, per option. Compliance is the least advanced option's.
- The per-option pack (`/handoff.csv`) is unchanged: it is the internal record.
- Not in it: the asset files per ad (still in the asset handoff, per code, until Assets is grouped by ad).

### Trupanion's compliance sheet, one row per ad (6 Oct)

Trupanion's compliance team review each finished ad once, at the end. `GET /compliance-sheet-ads.csv` (Export → "Compliance sheet for Trupanion (one row per ad)"; `adHandoff().complianceCsv`): Audience and Asset by name (the persona and the territory, since Trupanion's readers don't read the code), then Ad name, Region, Platform, Format, on-image text, subhead, cards, every primary text and headline option, and "Please check" (which rule to look at for an ad that went through with an overridden red flag, in plain words). The final words only: no internal flags, objections, ids, copy-option codes, names or reasons. The earlier sheet (one row per copy option) stays in the menu as the internal record.
