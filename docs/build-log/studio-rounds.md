# Studio: rounds, a TEST round, and the Live page (30 Sep 2026)

Branch `voices/studio-rounds`, from `main` at 06e7f03 (after #27). **No migration.** The round stamp, the TEST round for Brook's run-through, and the Live explainer, as agreed with the coordination session. The 4-step restructure (another worker, `voices/studio-4-step`) rebases onto this. The UI is self-contained so that rebase stays small:
- `frontend/src/pages/StudioRounds.tsx` holds the round badge and view, the Rounds panel and the Live page;
- Studio.tsx only wires them in (about 25 lines);
- the round view lives in `studioApi.ts`.

## How Brook uses it (production run-through)

1. **Rules → Rounds:** add `R0`, "Test run-through", tick **Test round**. Then "Make active" (an admin, `ADMIN_EMAILS`). The header shows **R0 TEST**.
2. Do the run-through: write, review, Ready, Pre-flight, Compliance. Codes end in `_TEST` (e.g. `OWN_CALM_UGC_A1_US_META_TEST`). The handoffs stay empty, since a test round never reaches Add3.
3. **Rules → Rounds:** "Make active" on **R1**. Everything from R0 disappears from the default views. Nick's existing runs (made before rounds) are R1. R1's codes start at A.
4. "All rounds" in the header shows R0 again, marked TEST, if it's needed for reference.

## What changed

- **Rounds** (`services/studio/rounds.ts`):
  - stored in `studio_inputs` under `rounds`: `{active, rounds: [{id, name, from, test, created_by, created_at}]}`;
  - R1 always exists, and anything unstamped is R1;
  - admin routes: `POST /rounds` (create or rename; `activate` optional) and `POST /rounds/:id/activate`;
  - `/meta` returns `rounds` with `can_edit`.
- **Stamping:**
  - `generate` stamps a new run's brief with the active round; lines added to a run keep the run's round;
  - lines carry `round`, and so do taste rows;
  - the sign-off body carries `round` (the round Ready was working in).
  - Line versions and expectations are fixed-column tables, so they take their round from their `signoff_id`; uploads, audits and compliance do the same through their sign-off.
- **Views and exports** (`?round=`; the page sends `round=all` when "All rounds" is chosen):

  | Where | Round behaviour |
  |---|---|
  | `/batches`, `/shortlist`, the Shortlist CSV/MD | Filtered by round; they carry `round` |
  | Ready (`/ready`, `/ready/preview`, `/ready/check`, `POST /ready`) | Works in one round (the active one, unless named); only that round's lines and sign-offs; `round: {id, test}` in the view |
  | `latestSignoffs` | The latest per persona × territory × region in each round |
  | Pre-flight `stubs`, `/compliance` | The active round by default |
  | Handoff CSV/MD, asset handoff | A Round column; never a test round |
  | B3 features export | Every real round, never a test round, with a `round` column |
  | Run export | A `round` column (ingest reads by header name, so sheets still import) |

  The compliance sheet for Trupanion has no round column (words only, nothing internal).
- **Codes:**
  - A test round's codes get `_TEST` (a suffix the naming format already allows).
  - `signedCodes(keep)` lets a real round count only real-round sign-offs, and a test round only test ones, so R1 starts at A whatever R0 did.
  - Because R0 and R1 codes differ, Pre-flight's code-keyed tables (uploads, status, audits) never mix them.
- **Taste:** `tasteFor(brief)` leaves out test-round taste unless the brief is itself in a test round.
- **Spend:** `Api.commit` labels each spend row with the active round (`generate … · R0`). All rows still count toward the cap.
- **Live page:** the nav item (still "soon") opens the explainer, worded in B3's terms (ahead / behind / tied / keep testing / too early to call; no winner inside a tie).

## Not in this PR

- **"Delete test round"** (optional in the brief). It isn't needed for the switch to R1, since R0 is hidden and can't collide. If wanted, it's a small admin action next.
- **Read-only earlier rounds and the carry-over rules.** These stay with the restructure, as agreed. Earlier rounds stay fully workable here.

## Screenshots

In `Claude outputs/voices-r1/studio/screens/rounds-30sep/`:
1. Rules → Rounds (R0 test, R1 active).
2. The Shortlist on "All rounds", with R0 marked TEST and `_TEST` codes.
3. The Shortlist on "This round" (R1 only).
4. The Live page.

## Tests

`cd backend && STUDIO_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_studio_test npm test`: **213 pass, 1 skipped (B3's database test, needs WEEKLY_TEST_DATABASE_URL), 0 fail** (207 before).

- `tests/studioRounds.test.ts` (new, file store):
  - stamping; unstamped reads as R1; admin validation;
  - the default filter and "all"; R0 hidden from R1's runs, Shortlist and Ready, and never in the handoff;
  - R1 codes start at A after R0 sign-offs; R0 codes end in `_TEST`;
  - the version count is shared across rounds;
  - export columns;
  - R0 taste excluded from R1's writer, and used in R0's;
  - test-round spend counted and labelled.
- `tests/studioPg.test.ts`: Pre-flight lists the active round, and "all" marks test codes; Compliance follows the round; the asset handoff and the B3 features export never carry R0; the features `round` column.
- The Ready scenario and the Pre-flight end-to-end test were updated for the new Round column.
