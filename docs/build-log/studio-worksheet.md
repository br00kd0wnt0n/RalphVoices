# Studio: the worksheet (Round 2)

Brook, 2 Oct 2026. The brief is client material (`Claude outputs/voices-r1/studio/brief-worksheet-view-round2.md`). Round 1 copy ran through a spreadsheet because Studio was too complex; the worksheet makes Studio as simple as the sheet. Built in five PRs; this file is updated with each.

## PR 1: the sheet, out and back (this PR)

Nothing new is stored. `services/studio/worksheet.ts` is a view over the runs.

- **Rows** (`worksheet(view, region)`, `GET /worksheet?region=US|CA|all`): step 1 is every on-image headline, subhead and carousel card, by persona then asset (a territory: one territory is one asset); step 2 the shared primary texts and captions; step 3 the shared headlines. A persona's own post copy is not on the worksheet (captions are shared); it is counted in `other`. A person's own line with no decision counts as kept (`implied`), as on the board. Flags use the chips' plain names (`utils/flagChips.ts`, the same words as the page; `tests/flagChips.test.ts` keeps the two copies the same). "Similar line" names its neighbour by the sheet's number.
- **Export** (`GET /worksheet.xlsx`, Export menu → "Download the worksheet"): the Round 1 workbook's shape (Start here, 1 On-image copy, 2 Primary text, 3 Headlines, Flag key). Yellow cells are the person's: Your call (Keep / Cut / Rewrite), Your rewrite, and six blank rows per tab for new lines. Two hidden columns are Studio's: `Row id` (the line id, the key; the O1/P1/H1 numbers are positional and only for reading) and `Hash` (the wording at export). A hidden `_studio` tab records the month, region and export time.
- **Import** (Export menu → "Import a filled-in worksheet"): `POST /worksheet/import/preview` says row by row what would change against Studio as it is now and writes nothing; `POST /worksheet/import/apply` works the preview out again on the file it is sent, then writes through the same calls the screens use (`setDecision`, `recheckLine`, a copy check for new lines), so history, locks and "for" are the same. Decisions are recorded for the person in the "for" picker.
  - Keep / Cut: applied when different from now. A rewrite: saved as an edit and re-checked in full. A rewrite typed with no call counts as a rewrite.
  - New lines: steps 2 and 3 go to the shared pool; step 1 needs the Asset (by name) and Where (Headline, Subhead, Card N). They are filed and checked as a copy check, kept.
  - **Changed in Studio since the export** (the hash no longer matches): shown with both wordings and left alone unless ticked ("use the sheet's").
  - Not read: a call that isn't Keep, Cut or Rewrite; Rewrite with an empty cell; a row id that isn't a line; an unknown asset; a signed-off line (change it in Build).
  - The checks are priced before they run (ask-first line, monthly cap), like Check copy.
- New dependency: `exceljs` (backend).

Not in this PR: the worksheet screen, paste / add / write more inside it, the lock, the default screen.

Not checked: a sheet round-tripped through Google Sheets itself (tested through exceljs and openpyxl, which drop cached formula values as Sheets can).
