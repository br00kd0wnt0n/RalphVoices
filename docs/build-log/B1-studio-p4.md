# B1 Studio, phase 4: the signed-in page and Ready for production (28 Sep 2026)

Branch `voices/b1-studio`. PR #11 is held until the phase 6 deploy with Brook, because it contains migration 015. Plan: `docs/b1-studio-plan.md` (sections 4 and 4a, decision 9).

## What shipped

- **One page, two modes** (`frontend/src/lib/studioApi.ts`):
  - **Hosted** (production builds, or `VITE_STUDIO_HOSTED=1` in dev): talks to `/api/studio` with the same bearer token as `api.ts`.
  - **Local** (dev, or `VITE_STUDIO_API`): talks to `studio.ts serve` and asks for a name, as before.
  - Progress streams and downloads (CSV, Markdown, the deck, the logo) go through `fetch`, so the token travels as a header and is never put in a URL.
- **Route and nav.** `/studio` is a signed-in route in production. "Studio" appears in the top nav only for people with access (`GET /api/studio/access`), and not at all when the Studio is switched off. The page stays full-width, with a back arrow to Voices.
- **Header.** The address is shown as initials (the full email on hover). The Rules view is an icon. Readout and Blind compare keep their colours but show as icons below 1800 px. The "running" status is a thin bar under the header. The tabs scroll instead of spilling over. At 1600 px it fits in one line with room for a later "Live" tab (B3b).
- **Attribution and history.** Each card shows who decided it and when. Clicking it opens the history (decisions, overrides, compliance changes, sign-offs, re-checks) and, once a line has been signed off, its versions with their hashes.
- **Blind compare:** stars are per person and stay hidden from others until the reveal. The reveal shows a tally for each person.
- **Rules view (hosted):** the rules versions and which one is active. Admins (`ADMIN_EMAILS`) can upload a draft and activate it.
- **Ready for production:** the fifth step, after Shortlist (screen below).
  - Per persona × territory, you choose the set.
  - The red-flag gate lists each unresolved red flag with its quote and source, and offers *Edit the wording* or *Override with a reason…*. Overrides show on the line, with who and when.
  - Edits keep model flags from the original wording until *Re-check this wording* runs the full checks on the new text.
  - Amber and grey flags are listed as "don't block sign-off".
  - **Expectations:** mark "Expect to lead" on lines and write why. Sign-off is disabled until the red flags are resolved and the expectation is written.
  - After sign-off, each line shows "ready v1 · who, when".
  - A later edit shows "edited since sign-off: v3 not yet signed off", and v1 is kept.
  - Signing off an unchanged set again is disabled.
  - Compliance status (Pending, Cleared, Changes requested, plus a note) sits on every line, records who and when, and notes when it was given on an earlier wording.
  - **Handoff pack:** CSV and Markdown (this set, or every set) and the clean compliance sheet for Trupanion.
  - Deep link: `/studio?tab=ready&persona=DINK&territory=DINK_NEVER`.
- **Backend additions:**
  - The naming code (stub) is stored on every signed-off line version (`studio_line_versions.stub`) and on every expectations record (`studio_expectations.stubs`), so B3b can join live results on it.
  - The Ready view gives each line its naming code before sign-off and sorts lines by it.
  - `STUDIO_MOCK=true` runs the hosted routes on the mock client, for local development only; it's ignored when `NODE_ENV=production`.

## Tested

- **Automated:**
  - Backend: 74 tests pass with `STUDIO_TEST_DATABASE_URL`, three runs in a row.
  - The Ready for production acceptance scenario runs on both files and Postgres.
  - Type checks are clean for the frontend, backend `src`, the scripts and the tests.
- **Hosted mode, end to end, on the local database** (backend `src/index.ts` with `ENABLE_STUDIO=true` and `STUDIO_MOCK=true`; local test accounts for Nick and Vivan):
  1. The Studio nav item appears for Nick.
  2. A kept line with a red flag ("pays for itself") blocks sign-off, both on the page and on the server (409, which names the line and the flag).
  3. The override with a reason unblocks it and shows on the line.
  4. Nick picked the line to lead, wrote why, and signed off (set v1, 6 lines).
  5. Vivan set "Cleared" with a note, and "approved" is rejected as a status.
  6. Nick edited a signed-off line: the history shows v1 (signed off), v2 and v3, each with its hash. The handoff CSV still carries the v1 wording, marked "yes: a newer version exists".
  7. The handoff CSV has 14 even columns, the compliance sheet has only naming code, field, platform, final text and characters, and "approved" appears nowhere in the three downloads.
- **SSO inside a frame:** a production build was loaded in a cross-origin iframe, like tools.ralph.world, with a locally minted `narrativ_sso` token (a test secret). The exchange succeeded, the token was stripped from the URL, and every Studio call returned 200 with the Studio fully loaded.
  - **Not a Studio bug, but worth knowing:** in dev builds, React StrictMode runs the `AuthProvider` effect twice with the same one-time SSO token. The second exchange is refused as a replay, so a dev build lands on the login page. Production builds are unaffected.

## Screenshots

In `Claude outputs/voices-r1/studio/screens/` (client material, not in the repo):
- `7-ready-gate.png`: DINK × Two Incomes. One Idiot., with one red flag blocking sign-off.
- `8-ready-signed.png`: DINK × Never the Choice. after sign-off, showing the override, Vivan's "Cleared", a line edited since sign-off, and the locked expectation.

Both come from the local database with test lines (one says "pays for itself" on purpose), so don't use them in a client deck.

## Left

- **Phase 5:** the `db-import` run filter (carry over only the 28 Sep kickoff runs) and a staging-style check with real keys.
- **Phase 6, the deploy with Brook:**
  - env vars: `ENABLE_STUDIO=true`, `STUDIO_EMAILS`, `ADMIN_EMAILS`, `ANTHROPIC_API_KEY` (a fresh key), `STUDIO_MONTHLY_CAP_USD`
  - migration 015
  - carry-over
  - a smoke test
