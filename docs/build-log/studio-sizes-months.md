# Studio: multi-size Pre-flight, and rounds shown as months (30 Sep 2026)

Branch `voices/studio-sizes-months`, from `main` at 1db0a6e (after #30, the 4-step UI). **No migration.** Two items approved by Brook, for the client's workback schedule: Month 1 R1 review is Tue 6 Oct, so Pre-flight runs on drafts Mon 5 Oct.

## 1. Multi-size Pre-flight

The WBS: statics and hero videos come in 1:1, 4:5 and 9:16; carousels in 1:1 and 4:5; TikTok in 9:16. One code (ad) carries a file per size, and Meta picks the size per placement.

- **Upload** (Assets): choose every size at once.
  - The browser reads each file's size (image or video dimensions, snapped to 1:1 / 4:5 / 9:16 within 5%) or takes it from the file name, and shows a size selector per file to correct it.
  - The server does the same for files that arrive without a size: PNG, JPEG, GIF and WebP headers, or the name ("_4x5", "1080x1350"). A file whose size can't be told takes the code's first expected size.
  - A carousel is its cards in each size, in order within each size. Up to 40 files per upload.
  - Upload notes say which expected sizes are missing and which uploaded sizes aren't expected.
- **Storage:** `studio_upload_files.role = 'asset:1x1' | 'asset:4x5' | 'asset:9x16'`, with position = size slot × 100 + card (0–99 for 1:1, 100–199 for 4:5, 200–299 for 9:16; frames stay at 1000+). Uploads from before sizes keep `role = 'asset'` and read as their detected size.
- **Audit:** the engine runs once per size.
  - Each size gets its own copy match (on-image and hook), per-card carousel match, last-screen disclaimer, visual rules and text load.
  - Flags carry `size` and say it ("9:16: On-image text (signed off) not found on the asset"), and frames point into that size's files.
  - A finding that's identical in every size (a cross-persona note, a banned word in the shared copy) is one flag without a size.
  - The stored result keeps a per-size summary; copy-match rows carry `size`; B3 features take the strongest reading of any size.
- **Missing size:** an expected size not uploaded is amber `SIZE_MISSING` ("4:5 not uploaded"), not red. "Mark Pre-flight passed" still works.
- **Asset handoff:**
  - a "Sizes missing" column;
  - the File column lists files per size ("1:1: a.png | 4:5: b.png").
- **Estimate:** one audit per size, so the estimate is the sum, and the Assets screen says "(3 sizes, one check each)".
- **Expected sizes** are the WBS defaults (`expectedSizes` in `services/studio/sizes.ts`, from the code: TT platform → 9:16; CAR → 1:1, 4:5; everything else → 1:1, 4:5, 9:16). The rules can override per format: `preflight.sizes: { "ST": ["1:1", "4:5"] }`.
- **Assets screen:** size tabs on the uploaded asset, "N not uploaded" chips, and the size on each copy-match row.

## 2. Rounds shown as months

The client's schedule uses "R1/R2" for review rounds, which clashes with Studio's R1 = Month 1.

- Stored ids (R0, R1, R2…), the `_TEST` code suffix and B3's features `round` column are unchanged.
- A display label: an admin's `label`, else "Test" for a test round, else "Month N" from the id (`monthLabel` in rounds.ts, mirrored by `roundLabel` in studioApi.ts). A new install's R1 is named "Month 1".
- Shown on:
  - the header badge ("Month 1", with a "This month / All months" view);
  - the board heading and totals copy;
  - chips on runs and Kept rows;
  - Rules → **Months** (a Label field; "label" to rename; "Add month");
  - the Export menu copy;
  - the handoff and asset handoff ("Month" column, e.g. "Month 1");
  - the Shortlist and run exports (`month`).
- The Live page mentions no rounds, so nothing changed there.

## Screenshots

In `Claude outputs/voices-r1/studio/screens/sizes-months-30sep/`:
1. Assets: size tabs (1:1, 4:5, 9:16), copy match per size, and the 9:16 flag.
2. Rules → Months, and the header badge.

## Tests

`cd backend && STUDIO_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_studio_test npm test`: **227 pass, 1 skipped (B3's database test), 0 fail**.

- `tests/studioSizes.test.ts` (new): PNG and JPEG dimensions, snapping and tolerance, file-name sizes, role round trip, expected sizes by format, and the rules override.
- `tests/studioPg.test.ts`, the sizes test:
  - a static in 3 sizes where 9:16 lacks the on-image text: one flag on 9:16 only, rows per size, positions 0/100/200, the cross-persona note once;
  - sizes read from file names; a missing 9:16 is amber, and Pre-flight is still passable;
  - the asset handoff: "Sizes missing" is 9:16, and files are listed per size;
  - a carousel in 2 sizes × 4 cards: 1:1 in order passes, 4:5 swapped gives two ambers pointing at the 4:5 cards, and no missing-size flag;
  - the estimate counts 3 sizes, with seconds summed.
- `tests/studioRounds.test.ts`: month labels (R1 → Month 1, R12 → Month 12, test → Test, an admin label, cleared back to the default).
- Existing tests were updated for the Month column, the "Sizes missing" column and size-slot positions.
