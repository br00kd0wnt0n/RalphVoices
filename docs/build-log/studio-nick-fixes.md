# Studio: fixes from Nick's walkthrough (29–30 Sep 2026)

Five fixes, all approved by Brook. **No migration.**
- Item 5 (Keep after Save edit showed the original wording) shipped first, on its own, as PR #21 (merged, b45e6e1).
- Items 1–4 are on `voices/studio-nick-fixes`.

## 1. Shorter lines by default

- **The length control starts at short.** `short_long` now defaults to 1 (was 2) in `makeBrief` and on the page.
- **The writer prompt aims well inside the visible limits.** Each field gets a target, from `targetChars(visible)`: three quarters of a short field, 60% of a long one:
  - Meta primary text: 75 of 125 visible;
  - TikTok hook: 30 of 40;
  - headline: 20 of 27.

  The prompt also asks for short, punchy, fragment-friendly lines, without throat-clearing openers. Each cell repeats its target.
- **Review ranks over-length lines lower** instead of only flagging them. Within each group, lines that fit on screen come first. Lines that run past the visible length go last, the biggest overshoot at the bottom, and a note says how many there are.

**Before and after.** Same brief each time: FAM_SUMMER and DINK_NEVER, 12 lines each, Meta primary, headline and TikTok hook fields, generation only (no checks).

| | primary text (125 visible) | headline (27) | TikTok hook (40) |
|---|---|---|---|
| Live, before | 85 chars avg, 0 of 7 over | 29 avg, **5 of 10 over** | 35 avg, 1 of 7 over |
| Live, after | **51** avg, 0 of 7 over | **22** avg, 1 of 10 over | **27** avg, 0 of 7 over |
| Mock, before | 60 avg | 70 avg | 88 avg |
| Mock, after | 71 avg | 69 avg | 63 avg |

- **Live cost:** $0.05 before + $0.06 after = $0.11 (budget $0.30).
- **The mock numbers don't measure anything.** The mock writer builds lines from fixed phrases, ignores the length instructions, and misreads the field when the tone words contain "field". They're included only because they were asked for.
- **Sample live lines after the change:** "Vet bill? It's sorted." (22 characters), "Covered at the counter" (22), "42% of families cut travel first when vet bills surge." (54).
- **A watch-out:** some short primary texts no longer name the product. The existing "product unclear" check flags those as before.

## 2. Cut on the Shortlist

- Each Shortlist row has a **Cut** button. It records the same `cut` decision as Review (same endpoint), attributed to the signed-in person and in the history. It drops the line from taste exactly as a Review cut does.
- An **Undo** bar lists the last five cuts; Undo puts a line back to keep or edit, as it was.
- **Lines already signed off at Ready can't be cut here.** The button is disabled, marked "signed off at Ready", and its tooltip names the set. The server refuses too (`source: 'shortlist'`) and says to take the line out of the set at Ready first.
- Shortlist rows now carry `batch`, `decision` and `signed_off`. The Shortlist CSV columns are unchanged.

## 3. Add a line in Review

- A dashed **Add a line** slot at the top of Review: the text, the field (the run's fields), a live character count, then **Add and check**.
- It goes into the open run through the existing generate route, with the run's own brief, `ownOnly` and the run id. So it's a human line (`model: 'human'`) with the run's region, tagged and checked like lines written on Write & brief.
- Once its flags arrive it can be kept, and then it's on the Shortlist. It's never kept automatically: decisions wait for the checks.

## 4. Compliance after the assets

New order: Ready for production → Pre-flight (upload and automatic checks) → **Compliance** → handoff to Add3. The step bar and "How it works" show seven steps.

- **The Compliance step** (`/studio?tab=compliance`) works per asset: the latest upload per code, with codes sharing a visual grouped together.
  - Each asset shows the visual, each code's signed-off copy (with "Please check specifically" where a red flag was overridden at Ready), and Pre-flight's flags (red and amber, with any overrides; grey notes collapsed).
  - The list is grouped into Changes requested / To review / Cleared, with codes still waiting for an asset listed underneath. There's a cleared count and the handoff downloads.
- **Setting the status:**
  - The reviewer sets **Cleared**, **Request changes** (a note is required) or **Back to pending**, with a note. The status applies to every code on the asset and every signed-off line behind those codes.
  - Clearing an asset that went through with an overridden red flag (copy or Pre-flight) needs a note.
  - `STUDIO_COMPLIANCE_EMAILS` (plus admins) still decides who can set it; everyone else sees it read-only.
- **Changes requested says what goes back:**
  - **The visual:** its codes stop being Ready to traffic. Pre-flight shows the note in a banner ("Compliance asked for changes to the visual…"), and a new upload brings the asset back to Compliance as pending, with what happened before in the note.
  - **The copy:** Ready shows the note on each line ("Edit the wording, then sign off again").
- **Ready no longer sets compliance.** It shows the status read-only on each line, with the note and who set it.
- **Where it's stored: on each line** (`studio_lines.body.compliance`, JSONB), as before, plus `upload_id`, `code` and `send_back`. No migration.
  - Statuses set per line on Ready before this change are still read (and not lost).
  - A review counts only for the signed-off wording it was given on and, at this step, the upload it was given with. Otherwise the code reads as pending, with the reason.
  - Every change is in the edit history.
- **Handoff:**
  - The asset handoff list (`/preflight/handoff.csv`, "Handoff to Add3 (assets)") gains Compliance, Compliance note and Compliance by columns, per code, next to the asset file and the codes sharing it.
  - The copy handoff and the Trupanion compliance sheet keep their per-code status.
- **API:**
  - `GET /api/studio/compliance`: the assets and the codes waiting for one.
  - `POST /api/studio/compliance/assets/:upload` `{status, note, send_back}`.
  - Pre-flight's report gains `compliance`.
  - The per-line `PATCH …/compliance` stays, for compatibility.

Also: the step numbers in the bar now show only from 1600 px wide, so seven steps and "Live (soon)" fit at 1440 px. Live stays disabled.

## Tests

`cd backend && STUDIO_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_studio_test npm test`: **134 pass, 0 fail**.

- `tests/studioNickFixes.test.ts` (file store):
  - the short default and the per-field targets in the prompt actually sent to the writer;
  - Shortlist cut (attribution, history, taste, undo) and refusal for a signed-off line;
  - a line added into an existing Canadian run is human, CA, checked, and keepable into the Shortlist.
- `tests/studioPg.test.ts`, "Compliance after Pre-flight":
  - one asset serving two codes, and codes still waiting for an asset;
  - a status set on Ready before this change is still read;
  - notes and send-back required;
  - sending back the visual reopens Ready to traffic and shows in Pre-flight's report;
  - a new upload reopens the review with the history in the note;
  - a replaced upload can't be reviewed;
  - the asset handoff and the copy handoff show Cleared.
- Both type checks clean (apart from the known pdf-parse and rcb-client errors).

**Walked through in local hosted mode** (voices_region database, mock client), as Nick and as a local "Vivan" account set up in `STUDIO_COMPLIANCE_EMAILS`:
- cut on the Shortlist, then Undo;
- a Canadian line added in Review;
- Compliance: changes requested on the Canadian visual, the US asset cleared, the banner in Pre-flight, the read-only status on Ready, the asset handoff.

Screenshots are in `Claude outputs/voices-r1/studio/screens/nick-fixes-30sep/`:
1. `1-shortlist-cut-undo.jpg`
2. `2-review-add-a-line.jpg`
3. `3-compliance-asset.jpg`
4. `4-compliance-changes-requested.jpg`
5. `5-preflight-sent-back.jpg`
6. `6-ready-compliance-read-only.jpg`
7. `7-how-it-works.jpg`

## Deploy notes

- No migration, and no new env var.
- Existing per-line compliance statuses carry over.
- Codes that already have an upload will appear on the Compliance step as pending, unless they already had a status set per line on Ready.

## Open questions

1. Should **Ready to traffic** require compliance to be cleared? At the moment they're independent: the creative lead's Pre-flight check and Trupanion's review, both shown in the asset handoff.
2. Compliance is set per asset for all its codes. If Trupanion wants to clear one copy line on a shared visual and not another, the backend already accepts `codes: [...]`, but the page doesn't offer it yet.

## A re-check overwrote the line on Postgres (found and fixed 2 Oct)

- `recheckLine` checks a scratch copy of the line (decision and edit blanked, the current wording as its text). `checkBatch` saved that scratch run, and Postgres keys lines by line id, so the save overwrote the real line: its decision was cleared, and for an edited line the edit became the "original" text and `edited_text` was emptied. The file store writes a scratch run to its own file, so the tests (file store) never saw it.
- Since the re-check shipped (edit + re-check in Review and Build, `POST …/recheck`, and the worksheet import), every re-checked line on Postgres was affected: a kept line became undecided (a generated line then drops out of the kept set and out of Build's tray; a person's own line still counts as kept), and an edited line lost its original wording from the line itself (the edit history still has it).
- Fix: `checkBatch(…, { save: false })` for the scratch copy; nothing is written for it. Test: "a re-check on Postgres leaves the line as it was" in `studioPg.test.ts` (fails without the fix).
- Not repaired by the fix: lines already re-checked in production. They can be found by `rechecked_at` on the line and the "re-checked" entries in the edit log; the decision before each re-check is in the edit log.
