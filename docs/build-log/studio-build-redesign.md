# Studio: Build & sign off redesign (1 Oct 2026)

Branch `voices/studio-build-redesign`, from `main` (after #30; #31 merged in). **Frontend only**: no backend, API or data changes. Brook put it ahead of everything else, because Nick uses this screen most before Tue 6 Oct's R1.

## What was wrong (the 4-step preview)

1. The same copy appeared twice: the version cards, then a long "Kept lines" list with codes, sign-off stamps and flags.
2. Copy was picked from native dropdowns that cut off at about 45 characters.
3. The on-image text was a tiny truncated dropdown in the visual's header.
4. Naming codes were everywhere.
5. There was too much status: Pre-flight and compliance chips, "signed off v1 · email · time" on every line, rule ids, "yours · nick", "don't block sign-off".
6. There was no visible order of work.

## What it is now

- **Per visual, numbered steps** (a persona-colour accent on each visual section):
  - ① **The text on the image.** A slot that opens the tray. On a carousel: the card strip, with hook and end marked, reorder ←/→, the card count, and "Use a whole sequence". For TikTok the hook is in each ad.
  - ② **The ads.** Feed-style previews, plus "+ Ad on visual A".
  - ③ **Which ad do you expect to lead, and why?** Ad chips and the reason, for the whole persona × territory set.
  - ④ **Sign off**, with the reason it can't happen yet, if any.
  - A sticky bar at the bottom: "N ads on N visuals · no red flags · Lead: Visual A · Ad 1 · Sign off".
- **An ad preview:**
  - Meta: primary text on top (full text), a placeholder image with the visual's on-image text (or the card strip), then headline and description beside a "Learn more" CTA.
  - TikTok: a 9:16 frame with the hook, and the caption below.
  - Labelled "Visual A · Ad 1". The code is small and grey underneath (click to copy).
  - "⋯": move to visual B / a new visual, or remove.
- **The tray** (clicking any slot):
  - The kept lines for that field, "In use" first (with where each is used: "Visual A · Ad 1, Ad 2") and then "Not used yet".
  - For each line: full text, characters against the visible limit, short flag labels, and its history.
  - "Use here"; "Use in all ads on visual A" (headlines, descriptions); "Clear" for optional slots and on-image. Esc closes it.
- **Editing:** ✎ on a slot edits the line in place. A signed-off line keeps its signed wording, and the edit becomes a new version (unchanged behaviour).
- **Flags:**
  - Plain labels at the slot they concern: "Headline repeats the primary text", "On-image repeats the primary", "Direct pay caveat is missing" / "…is in a different field", "Too alike: Visual A · Ad 2", "The fields contradict each other". The rule id, source and reason are on hover.
  - Line flags (e.g. "not a glance read") show as small chips on the slot.
  - Red flags show inline under the slot with Fix the wording / Override with a reason (the creative lead or an admin), and "Re-check this wording" after an edit. They still block sign-off.
- **Status per ad:** Draft / Signed off / Edited since sign-off, for this screen only.
- **History:** a collapsed "History (set v1, v2…)" link with each set's lead and reason.
- **Empty state** unchanged: "Nothing kept yet… Keep lines in Review first" plus Go to Review.

Kept as they were: preview on every change, the auto conflicts check, `expect_latest` and the 409 reload, the DraftError and GateError messages, overrides, carousel cards and TikTok versions. The draft rules moved to `frontend/src/lib/buildDraft.ts` (pure, tested from the backend suite).

Also: Assets' carousel thumbnails take their size's shape (1:1, 4:5, 9:16) instead of a square.

## Multi-size images (the question on #31)

The broken image in `sizes-months-30sep/1-…jpg` was the test file: it was a PNG header with no image data. With real PNGs (made at 540×540, 540×675 and 540×960), every size tab renders: the static's 1:1, 4:5 and 9:16, and the carousel's 1:1 and 4:5 with cards 1–4 in each (position % 100 is right). Screenshots are 6–9 below.

## Screenshots

In `Claude outputs/voices-r1/studio/screens/build-redesign/`:
- **Before:** `0-before-static.png`, `0-before-carousel.png` (the 4-step preview).
- **After:**
  1. Static, top: the steps, on-image text, ads.
  2. The tray on Ad 3's primary text.
  3. A red flag inline (direct pay, no caveat) with Fix / Override; the bar says "1 red flag".
  4. Carousel: the card strip and ads with the cards.
  5. TikTok: 9:16 frames with the hook and the caption.
- **Assets with real PNGs:**
  6. Carousel 1:1.
  7. Carousel 4:5.
  8. Static 1:1.
  9. Static 9:16.

## Tests

`cd backend && STUDIO_TEST_DATABASE_URL=… npm test`: **231 pass, 1 skipped (B3's database test), 0 fail**. New: `tests/studioBuildDraft.test.ts` (placing a line, clearing an optional slot, use in all ads on a visual and platform only, on-image and cards, add/move/remove ads, ad names, where a line is used). Type checks: frontend clean; backend has only the existing non-Studio errors.
