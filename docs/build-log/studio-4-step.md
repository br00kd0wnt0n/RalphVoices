# Studio: the 4-step flow (30 Sep 2026)

Branch `voices/studio-4-step`, rebased on `main` after #27 (carousel cards) and #28 (rounds). Frontend restructure;
two small backend additions (below). **No migration.**

## What moved where

| Before (7 steps) | Now |
|---|---|
| Territories | A picker at the top of **Write** (cards; "Edit territory" and "+ New territory" open a drawer, so the brief isn't lost). The full list and history: **Territories**, top right. |
| Write & brief | **Write**: your lines first; each ticked field has a count (defaults: the rules' `default_count` for the fields the territory's format starts with; others unticked); an "only" shortcut; the total and cost before running. Carousels: on-image text as sequences × cards. |
| Review + Shortlist | **Review**, with a **Kept** filter: the Kept tray for this persona × territory × region, grouped by field, Cut/Undo there. No codes before sign-off. Cards are lighter: line, flags, skeptic, actions; length, structure, tone, tags and history behind "details"; the note opens on demand. |
| Ready for production | **Build & sign off** (same behaviour; carousel card slots kept). One status chip per version. |
| Pre-flight + Compliance | **Assets**: one screen per code; the same list and image; one track per code (Uploaded → Checks → Pre-flight passed → Trupanion decision → Ready to traffic, or Changes requested); every action kept. |
| How it works | Behind "?" (and the start screen while the round has no runs). |
| (new) | The **round board**: the start screen once a round has runs. |
| Downloads in four places | One **Export** menu (top right). |
| "Your verdicts on the flags" (Pre-flight) | **Rules**, with the Rounds panel above. |
| Live "soon" | Opens the Live explainer (#28). |

Old links redirect: `?tab=brief` → write, `shortlist` → review (Kept), `ready` → build, `preflight` and `compliance` → assets; `&stub=` and the old `&asset=` still select a code.

## Scope

- **Context bar** (persona × territory × region, remembered per browser): scopes Write, Review and Build & sign off.
- **Assets, Export and Live** show everything in the round. On Assets the bar reads "All" and narrows this view only (never the writing context). Chips: status, persona, region, format. The groups are persona (colour) → territory → visual.
- **Role defaults** on Assets: compliance emails (not an admin, not the creative lead) start on *Awaiting Trupanion*; everyone else on *Needs upload or review*.
- **Export** defaults to everything Ready to traffic in the round (asset handoff and copy, filtered on the page from the existing CSVs), with "Just <persona>" to narrow; then the full handoff pack, the compliance sheet, Sheets, kept lines and the weekly-read features.

## One status vocabulary

`codeState()` in `components/studio/ui.tsx`: Draft → Signed off → Pre-flight passed → Cleared → Ready to traffic, plus Changes requested and Edited since (any field of the version, or the visual's on-image line, edited since sign-off). Used on Build & sign off and Assets.

## Round board

Persona rows (persona colours) × that persona's live territories, a persona total column and an "All personas" row. Each cell: lines kept → ads signed off → uploaded → cleared → ready to traffic; red when Trupanion asked for changes; "not started" when empty. A click sets the context and opens Assets (anything signed off), Build (kept lines), Review (runs) or Write. The header shows the round, the rules version and the asset deadline ("Assets due 12 Oct · 12 days"; an admin sets it there). Counts come from the existing lists (`/batches`, `/shortlist`, `/preflight/stubs`), in the round the header shows.

## Persona colours

`frontend/src/lib/personaColors.ts` (DINK indigo, CUR sage, FAM yellow, from the deck's divider pages; neutral grey otherwise). `base` for faint fills, `edge` for dots and thin left borders (DINK's base is lifted to #6A6FB0 for 3:1 on dark), `light` for text (8.3:1 or better on #16181D). An accent only: flags keep red/amber/grey, and pink stays for CTAs and the active step.

## Backend (small)

- `engine.ts`: brief `field_counts` (sanitised to the brief's fields, 0-60 each, 60 in all; `n` is the sum). `planCells` deals fields in proportion (`fieldShortfall`, largest remainder), keeping the angle × structure × tone spread within each field; `generate` keeps exactly each field's count, later rounds writing only for fields still short. On a carousel, `looseCounts()` drops the on-image count (the sequences × cards replace it).
- `rounds.ts`: a round's `assets_due` (YYYY-MM-DD; kept when a save leaves it out, `''` clears it).
- Tests: `tests/studioFieldCounts.test.ts` (new), one test each in `studioCarousel.test.ts` and `studioRounds.test.ts`.

## Preview (local, mock)

`scripts/preview-seed.mjs` seeds `voices_preview` through the API (never SQL): accounts nick@ / brook@ / vivan@ralph.test (password `preview-pass`), rules v2.11, two runs (Busy Families Summer; DINK Little Monster), kept lines across fields, FAM Summer visual A (A1-A3 with on-image text) signed off, one static uploaded and passed, A1 and A2 cleared and A3 changes requested; an R0 TEST round with a carousel (DINK Expect the Unexpected, three cards, uploaded and passed), then R1 active again with assets due 12 Oct. Re-runnable (each step skips what exists). Servers: `.claude/launch.json` "studio-preview-backend" (3041) and "studio-preview-frontend" (5183, `VITE_PROXY_TARGET`).

Screenshots: `Claude outputs/voices-r1/studio/screens/4-step-preview/` (persona colours before and after in `persona-colours-before/`).
