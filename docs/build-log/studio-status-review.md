# Studio: Brook's status review (7 Oct 2026)

Brook reviewed Studio for how clearly it shows where things stand and how ready it is for the schedule (R1 feedback Fri 9 Oct, artwork Tue 13 Oct, final delivery Tue 20 Oct, go-live Mon 26 Oct). Seven points, built in order of the dates. This file is updated with each PR.

## 1. One region at a time, and counts in ads (PR 1)

- **The region switch** (`RegionSwitch` in `components/studio/ui.tsx`): one control in the header on every screen, flag and name. It is the context's region (`ctx.region`), so Write, Review, Build, the worksheet, Assets, the board and the Export menu's default all follow it. The context bar's region select, Assets' Region chips ("All" included) and the worksheet's own switch are gone. US and Canada are separate ads, sign-offs and codes: no screen mixes them.
- **The board** shows the header's region only and counts in ads. An ad is a visual (its codes share a visual key); it is as far along as its least advanced copy option: signed off → artwork uploaded → Pre-flight passed → cleared by Trupanion → ready. Before sign-off a cell says how many lines are kept. Copy options and kept lines are small print under the pipeline. Columns are the persona's assets; the totals are in ads.

## 2. Options are not ads: Build's wording (PR 2; the Assets part comes with "Assets per ad")

- A visual is "Ad A", its versions "copy option 1 / 2 / 3" (`adName` in `lib/buildDraft.ts` gives "Ad A · option 2"; "+ Copy option on ad A", "Remove this copy option", "Remove this ad", "+ New Meta ad"). The ad's name (the code without the option number) is shown beside the heading; the options' codes stay under each option.
- Step 3 asks "Which copy option do you expect to do best, and why?" and says plainly that results come back per ad, so it can't be scored option by option. What is stored is unchanged.
- A version check shown at a slot the whole ad shares (on-image text, a card, the subhead) names the copy option(s) it was found with: "Copy option 2: its fields clash in tone" (`flagsAtShared`).

Not yet: Assets per ad, key dates, feedback rounds, the disclaimer and design brief, the worksheet fixes, video.

## 3. Key dates (PR 3)

- Stored on the month's record: `round.milestones` = `[{ id, label, date, track?, screen? }]` (`cleanMilestones` in `services/studio/rounds.ts`; `studio_inputs` 'rounds', no migration). Saved with the round (`POST /rounds`, admins); leaving `milestones` out of a save keeps them, an empty list clears them. `track` is free text (statics, video…), `screen` is `build` or `assets`.
- The board has a "Key dates" strip (`components/studio/KeyDates.tsx`): every date in order, past ones dimmed, today marked, the next one highlighted with "in 2 days". An admin edits the list in place ("edit dates"): date, what is due, track, and whether it also shows on Build or Assets. It replaces "No asset deadline set"; the older single "assets due" date still shows for a month that has it and no key dates.
- Build and Assets show one line in their header (`DateNote`): the next date marked for that screen, else the next of all ("R1 feedback due Fri 9 Oct, in 2 days"), amber on the day and the day before.
- The logic is pure (`frontend/src/lib/studioDates.ts`), tested in `studioRounds.test.ts`.
- Nobody's dates are entered by the code: an admin types them in after deploy.

## 4. Feedback rounds (PR 4)

The client's feedback comes through Add3 as one set of notes per round (R1 on copy, R2 on the complete package). Studio only knew Trupanion's final compliance decision.

- Stored per month in `studio_inputs` (`feedback:<round id>`; no migration): the rounds `{ id, label, sent, received, notes }` and, per ad name per round, `{ state: none | change | done, note, by, for, at }` (`services/studio/feedback.ts`). Endpoints: `GET /feedback?region=`, `POST /feedback/reviews`, `POST /feedback/ads` (the "for" person is honoured).
- **It only informs.** It is separate from Trupanion's compliance decision in Assets, and "change wanted" does not hold an ad back from Ready to traffic (Brook, 7 Oct).
- Board: a "Feedback" strip for the header's region: each round with its dates and counts ("1 with changes wanted · 2 done · 6 no change"), a one-line summary, and a panel to enter a round: the dates, the notes as they came (pasted; nothing is parsed out of them), then a state and note per signed-off ad, with "Fix in Build".
- Build: the asset's feedback shows above the ad, with "Mark done" on a change.
- Review: a signed-off line no longer offers Keep, Cut and Edit; it says "Signed off: change it in Build & sign off".
- Not yet: the feedback line on each ad in Assets (it comes with Assets per ad).
