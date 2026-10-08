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

## 7. The disclaimer, where the ad is shown, and the design brief (built before 5 and 6, as artwork is imminent)

- One place for "which text, and where": `services/studio/disclaimer.ts` (`disclaimerVersions`, `disclaimerFor(rules, region)`, `disclaimerPlace(format)`: the image of a static, the last card of a carousel, the last frame of a video). Pre-flight's check uses the same functions. `/meta` carries `disclaimers` per region.
- Shown as "Required small print" (`DisclaimerNote` in ui.tsx: the region's text, its length, where it goes, a Copy button, and a note that the North America version is also accepted): in Build under the on-image text of each ad, and in Assets beside the upload.
- The ad handoff has "Disclaimer (required small print)" and "Disclaimer goes on"; Trupanion's per-ad compliance sheet has "Disclaimer" and "Disclaimer goes on".
- **Design brief** (`GET /design-brief.md` and `/design-brief.csv`; Export → For design): one section or row per ad with the ad name, audience, asset, region, format, platform, expected sizes, the words that go into the artwork in order (on-image text, subhead, cards) with their lengths, and the disclaimer with its length and where it sits. No post copy, nothing internal.
- Audiences are in one order everywhere, DINKs, Curators, Families (`utils/personaOrder.ts`, the picker's order): both per-ad exports, the design brief and the worksheet.

## 2 (the Assets part). Assets per ad

The screen keeps its layout and its storage (uploads, Pre-flight status and compliance are still per code); what changed is the grouping and the words (`components/studio/Assets.tsx`).

- The list has one row per ad (`adsOf`: the codes that share a visual), named by the ad's name, with "3 copy options", the artwork's file names and the on-image text. The status filters count ads. An ad is in one status, its least advanced copy option's: changes requested if any option has them, else needs upload or review, else awaiting Trupanion, else ready.
- Opening an ad shows the option that holds it back. The header has the ad's name and a small "Copy option A1 / A2 / A3" switch for the per-option copy and flags.
- One upload serves the ad (the other options are ticked, as before); "Mark this ad Pre-flight passed (3 copy options)" passes them together (`setReadyVisual`), with "just option A2" beside it; Trupanion's decision applies to the options on the ad, with the tick boxes for when they differ.
- The ad's client feedback (a round's note) shows under the status track, and the required disclaimer beside the upload.
- Not unit-tested: the grouping is in the component. Checked in the browser on local data (one ad with two options, not uploaded).

## 6. Video, TikTok and creator: fields by format (8b, part 1)

Rules v2.17 adds a video's lines as fields (`video_open`, `video_end`, `video_script`, `video_supers`, `tiktok_end`, `tiktok_script`; `formats` and `video_role` on each). Activated on the build before this, Build offered them on every static and carousel.

- **Fields by format** (`services/studio/fieldFormats.ts`: `fieldFitsFormat`, `fieldByRole`; `fieldFits` in ui.tsx): a field with `formats` is offered only on territories of those formats, in Build (`versionFields(platform, rules, format)`), in Write and in a territory's default fields. With v2.17 a static and a carousel are exactly as before (tested, and compared on a local database with signed-off ads: Build's data and every export identical between v2.16 and v2.17).
- **TIKTOK is a territory format** (`FORMATS`): a TikTok-native build can be created; its codes say TT and its ads are made of the TikTok fields.
- A VIDEO or UGC territory starts with primary text, headline, opening line and end line; a TikTok one with hook, end line and caption.
- Length flags use the field's own words ("Long for a script", "Long for an opening on-screen line").
- **Check copy** reads "opening line", "end line", "script", "supers" and "caption" and files each in the right field for the territory's format (the opening line is `video_open` on a hero video and the TikTok hook on a TikTok build); a video's line on a static is refused with a reason.
- Pre-flight's copy match doesn't look for a script in the frames' text (it is spoken).
- `rules.schema.json` knows `formats` and `video_role`.

**Not done, and it matters for video (part 2):** Build keeps ONE on-image line per ad (plus a subhead, or a carousel's cards). A filmed video has several (opening line, end line, script, supers). Until the draft and the sign-off can hold a line per field per ad, a video territory's lines can be pasted, checked and kept, but only one of them can be placed in Build. An animated version of a static needs none of this (it has one on-image line, like its static).

## Assets opens on all personas (8 Oct)

Brook: "On Assets tab, let's have ALL PERSONAS toggled on by default". Arriving at Assets (the step row, Build's "next", the worksheet's step 5, a board cell) always shows the whole month's ads for the header's region; the persona chips narrow it only when clicked. From a board cell or Build, the asset's own ad is opened (`focus`), with every persona still listed. A deep link with `?persona=` still narrows. The header's lockup now shows from 1700 px wide (the logo below that), so the four steps and the region switch fit at 1440 px: at that width the Assets step had been pushed out of view.
