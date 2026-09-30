# Studio: two people at once (30 Sep 2026)

Branch `voices/studio-concurrency`, from `main` at abc4712 (after #24). **No migration.**

It fixes what the coordination session's local two-user test found on ad5bc92 (scripts, log and `audit.sql` in its scratchpad `twouser/`). It also includes two smaller items Brook asked for:
- the copy-override reason on the Compliance step;
- the check that rules v2.10's on-image field flows through.

## What changed

1. **No more lost updates on a line.**
   - Every change to a run goes through `runLock(batchId, …)` (`engine.ts`, over the new `StudioStore.withLock`) and re-reads the run inside it. That covers decisions, overrides, compliance statuses, re-checks, added lines, the checker's saves, sheet imports, and a new upload reopening compliance.
   - **PgStore:** `pg_advisory_xact_lock` on each key, inside one transaction. Every store call inside the lock uses that transaction (AsyncLocalStorage), so it works across processes and a set of writes commits together.
   - **FileStore (local):** an in-process keyed lock that the same call chain can re-enter.
   - `setDecision` writes the history from the fresh read, so entries chain.
   - Re-check runs its model calls outside the lock (they're slow). It then applies the result under the lock, only if the wording is still what was checked; otherwise it's a 409 ("re-check it again").
2. **Adding lines at once no longer loses one.**
   - New lines get their ids from `claimLines`, under the run lock: the next numbers after every line already stored, anyone's. Lines are saved as soon as they're numbered.
   - `saveBatch(b, lineIds)` writes only the lines a job owns and never removes a line. The header's lines on the brief and its dropped near-duplicates are merged, not replaced.
   - A person's added line carries `added_by` and a history row ("added"), shown on the card ("yours · nick").
3. **A Shortlist cut can't race a sign-off.** Sign-off holds the locks of the runs it touches, and re-reads them. So a cut line is refused ("Not kept lines"), and the cut guard runs under the run lock, where it sees the sign-off ("Signed off at Ready…").
4. **Sign-offs are serialised and atomic.**
   - Sign-off locks `signoff:<persona>|<territory>` (both regions, since they share the version count), plus the runs of its lines.
   - The sign-off, its line versions, the expectation and the lines' `ready` marks commit in one transaction, so there are no orphan line versions and no "loser's code".
   - The page sends `expect_latest` (the latest sign-off it showed). If someone signed off in the meantime, the answer is a clear 409 ("brook just signed this set off (v2, 14:31 UTC): reload…"), and the page reloads that set.
   - US and CA of one persona × territory now go through one after the other instead of colliding. Versions per region would need the database's unique key changed (a migration), so the count stays shared, as agreed.
   - **Stale "signed" marker:** a line that a later set leaves out gets `ready.superseded_by`. It shows "not in the latest set" instead of "ready vN", keeps its code, and can be cut from the Shortlist again.
5. **Taste is written one row at a time.** `putTaste`/`deleteTaste` replace the whole-set rewrite from a stale snapshot, and each example records `by`.
6. **Sign-off role.** POST `/ready` is limited to `STUDIO_READY_EMAILS` plus admins (`canSignOff`), which gives a 403 for others. `/meta` has `can_sign_off`, and the page disables the button and says who signs off.
7. **Spend cap.**
   - Generate, "More like this" and Pre-flight audits reserve their estimate before starting, under a `spend` lock: a `reserved: …` row in `studio_spend`, removed when the job ends. By then the job has recorded what it actually spent.
   - Two runs started together can't pass the cap between them. A run's own reservation isn't counted twice in its mid-run check (`Api.reserved`).
   - Blind compare still checks without reserving (a separate exercise).
8. **Edited after sign-off.**
   - Ready shows the line's compliance as "pending" with "Edited since Trupanion's 'cleared': the new wording needs their review".
   - Compliance and Pre-flight show "Wording edited since sign-off" instead of "cleared".

Also:
- **Copy-override reasons on Compliance** (Brook, from the PR #24 browser check). The "what Trupanion accepted" box now shows why each copy override was made and who made it, as it already did for Pre-flight overrides (`CodeCompliance.override_details`).
- **The router keeps an error's status** (402 / 403 / 409 / 503) instead of 400, and marks a 409 with `conflict: true`.

## Rules v2.10's on-image field (`meta_on_image`)

A new META field flows through without code changes (`tests/studioOnImage.test.ts`, on the example rules with the field added):
- Write & brief lists it, and `makeBrief` accepts it.
- The deterministic checks apply its own limits, and all caps gets BR_CASE.
- Shortlist and Ready give it a META code.
- Pre-flight maps it to `on_image` ('must' be on the asset).

Done in this PR:
- **(1) Writer prompt:** the field gets guidance: text that sits on the image, written with the visual, read at a glance, not a second headline, sentence case. That comes from `fieldGuidance()`. The rules file can override it with `writer_note` on the field; worth adding to v2.10.
- **(3) Audit:** `meta_on_image` is in the audit engine's lead fields. B2's `COPY_FIELDS.on_image` now maps to `meta_on_image`, so on-image copy gets its limits and the price-lead check when the rules have the field (skipped when they don't).

**(4) Design point: not built yet; a proposal.** Today an on-image line would get its own ad code (e.g. `…_A3_US_META`), as if it were a separate ad. If A1–A3 share a visual but each has its own on-image line, Pre-flight's copy match fails two of the three.

- **What I'd do (Ready-level):** on-image lines belong to a visual, not to an ad line.
  - At Ready, an on-image line gets a visual letter (the same picker) but no line number, and no ad code. Its reference is the visual key, e.g. `FAM_SUMMER_ST_A_US_META`.
  - Sign-off allows one on-image line per visual, and refuses two different ones on the same letter.
  - Pre-flight adds the visual's on-image line to the copy of every code on that visual (copy match 'must'), and doesn't list it as a code of its own.
  - The handoff lists it once, under its visual. B3 never sees it as an ad.
- **Size:** about half a day to a day, with no migration. It touches `codes.ts` (on-image fields left out of line numbering), `ready.ts` (one per visual; the visual key as its reference), `preflight.ts` (`copyFor` includes the visual's on-image line), the handoff rows, the Ready card, and tests.
- **The smaller alternative** (Pre-flight only, treating on-image lines as the visual's) is about 2–3 hours. But it still hands on-image lines their own ad codes in the handoff pack, so I'd not do it.
- **Until it's built:** v2.10 can be uploaded, but on-image lines shouldn't be signed off at Ready.

## Proof: the two-user scripts, re-run

I copied the scripts, pointed them at a fresh local database (`voices_twouser2`, since dropped) and a backend on this branch (mock client), and ran them in the original order. The compliance calls gained `client_by`, which #23 made required; nothing else in the scripts changed.

| Scenario | Before (ad5bc92, from the report) | Now |
|---|---|---|
| p1: separate runs at once | ok | ok: both runs complete; region, owner and filters correct |
| p2 / p2b: same line, 40 rounds | 3 of 60 stored ≠ latest history; 67 unchained | **0** stored ≠ latest history, **0** column/body mismatches, **0** unchained |
| p3: edit then keep (two people) | ok (after #21) | ok: both edits on Shortlist, Ready and the exports |
| p4: two lines added at once | both got L13; Nick's line vanished | **L13 (nick) and L14 (brook)**, both checked, with authors and "added" history rows |
| p5: Shortlist cut racing a sign-off | a cut line went out signed off | **never both**: 4 of 4 rounds either refused the cut ("Signed off at Ready…") or refused the sign-off ("Not kept lines") |
| p6: racing sign-offs (same set; US vs CA) | raw 400 (pkey), orphans, wrong stubs | **all went through, one after the other** (v1–v6), US and CA both; the 409 path (with `expect_latest`) is in the tests |
| p8 / p8b / p8c: compliance vs edit | edits or statuses lost in 82 rounds | **0 lost edits, 0 lost statuses** (4, 42 and 82 rounds) |
| p8d: before re-signing | edited lines showed "cleared" | "pending · Wording edited since sign-off" (Compliance) and pending (Ready); after re-signing, "Reviewed on a different wording" |
| p9 / p9b: taste | 25 of 60 rows lost or reverted | 27 of 27 rows correct, **0 wrong** in 10 rounds × 6 lines; each row has `by` |
| p10: spend ledger | ledger ok; the cap check passes twice | the ledger is still exact (1.23 of 1.23). p10's cap part reads the store directly, so it still shows the old pattern; the router now reserves under a lock, and `studioBudget.test.ts` proves one of two runs is refused |

**`audit.sql` on the re-run database:**
- all orphan checks 0;
- "signoff lines now cut" 0;
- no code on two lines (sign-offs and line versions);
- no line-version code differs from its sign-off;
- all 28 signed-off lines match their stored wording and version;
- no decided line without history, compliance without history, or added line without history;
- unchained history entries: 0.

## Tests

`cd backend && STUDIO_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_studio_test npm test`: **146 pass, 0 fail**.
- `studioPg.test.ts`, new tests:
  - 1: same line, 20 rounds: stored equals the last history entry, and the history chains;
  - 1b: compliance vs edit: both kept every round;
  - 2: ten lines added in pairs: all kept, unique ids, authors;
  - 3: cut vs sign-off: never both;
  - 4: racing sign-offs: one wins, the other gets a 409 naming who; no orphans; codes unique; US and CA both go through; a left-out line is marked, keeps its code, and can be cut;
  - 5: taste over 10 rounds;
  - 8: an edit after sign-off shows as needing review.
- `studioBudget.test.ts` (over HTTP): two runs started together, one refused with 402 and the reservation settled after; sign-off role (403, `can_sign_off`).
- `studioOnImage.test.ts`: the on-image field end to end.
- `studio.test.ts`: a person's line now starts its history with "added".

Both type checks are clean (apart from the known pdf-parse and rcb-client errors).

## Deploy notes

- No migration, and no new env var.
- Sign-off now needs `STUDIO_READY_EMAILS` (or admin): check that Nick is on it in Railway.
- Spend rows labelled `reserved: …` appear briefly while runs are in progress. If the server restarts mid-run, a reservation can be left behind, which holds that amount against the monthly cap. It's visible in the spend list (label `reserved:`) and can be deleted by hand; a cleanup on startup would be a small follow-up.
