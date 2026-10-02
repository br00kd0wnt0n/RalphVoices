# Studio: the worksheet (Round 2)

Brook, 2 Oct 2026. The brief is client material (`Claude outputs/voices-r1/studio/brief-worksheet-view-round2.md`). Round 1 copy ran through a spreadsheet because Studio was too complex; the worksheet makes Studio as simple as the sheet. Built in five PRs; this file is updated with each.

## PR 1: the sheet, out and back (this PR)

Nothing new is stored. `services/studio/worksheet.ts` is a view over the runs.

- **Rows** (`worksheet(view, region)`, `GET /worksheet?region=US|CA|all`): step 1 is every on-image headline, subhead and carousel card, by persona then asset (a territory: one territory is one asset); step 2 the shared primary texts and captions; step 3 the shared headlines. A persona's own post copy is not on the worksheet (captions are shared); it is counted in `other`. A line with no decision is undecided, whoever wrote it (the kept set, the board and Build only count keep and edit; Check copy keeps the lines it files). The first version treated a person's own undecided line as kept, which was wrong and was corrected on 2 Oct. Flags use the chips' plain names (`utils/flagChips.ts`, the same words as the page; `tests/flagChips.test.ts` keeps the two copies the same). "Similar line" names its neighbour by the sheet's number.
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

## Import fixes from the first real sheet (2 Oct)

Nick's Round 1 worksheet was made by hand before the export existed: no `Row id` / `Hash` columns, a totals row, "Carousel card" in Where, and it went through Google Sheets.

- **Wording first.** A row with no row id is matched to a line by its wording, across the month and step: kept, cut or undecided, as the line reads now or as it was first written; case, curly quotes and spacing don't matter. The row's asset decides between two lines with the same wording. A matched row with no call is no change (so a cut line never comes back as new); with a call it is that call on the existing line. Only a row that matches nothing is a new line.
- **New lines from a sheet with no row ids need a tick.** The preview says how many rows were matched by wording and how many matched nothing; those are added only when the person ticks "add them as new lines" (`add_unmatched`).
- **Only numbered rows are lines.** A row is read when it has Studio's id or a number in `#` (O1, P3, N2). Totals and notes under the table are ignored.
- **"Carousel card" / "Card"** with no number is on-image text for a carousel.
- **Asset names** resolve within the row's persona, and to a live territory before a retired one of the same name.
- **Workbooks whose comments trip the reader** (saved by other tools) are read again without their comment and drawing parts. `jszip` is now a direct backend dependency (it was already installed through `exceljs`).

## PR 2: the worksheet screen, steps 1 to 3 (preview)

`frontend/src/components/studio/Worksheet.tsx`, at `/studio?tab=worksheet` and behind the table icon top right ("Worksheet (preview)"). It is not the default screen; nothing else changed. It reads `GET /worksheet` and writes through the calls Review uses.

- Tabs are the steps: 1 On-image copy (by persona, then asset), 2 Captions, 3 Headlines, each with kept and to-decide counts; 4 Build ads and 5 Assets open the existing screens.
- One row per line: where it sits, the wording, flags as plain-word chips (or "clear"), the count against the guide that applies (red when over), and Keep / Cut / Edit. Keep and Cut toggle. Edit opens the wording in place; saving keeps the new wording and re-checks it straight away.
- "details" (closed by default) loads the line from its run: the skeptic's line, who wrote it, angle and structure, each flag in full with its source, and the history.
- Counts at the top: decided of total, kept, cut, to decide. One sentence under the table says what red and amber mean.
- Region is a switch (it follows the context's region). "Working for" is the existing picker. "Download as a sheet" gives the PR 1 workbook.
- A signed-off line can't be changed here ("Change it in Build").
- A persona's own post copy is not shown; the count of such lines is, with where they are.

Not in this PR: targets and due dates (nothing stores them yet), paste / add a line / write more inside the worksheet (PR 3), the lock (PR 4), card order by dragging (open question 2), the default screen (PR 5).
