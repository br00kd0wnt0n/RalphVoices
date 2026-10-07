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
