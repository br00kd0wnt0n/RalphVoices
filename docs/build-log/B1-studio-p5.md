# B1 Studio, phase 5: carry-over, deploy rehearsal, and the deploy checklist (28 Sep 2026)

Branch `voices/b1-studio`, PR #11, held for Brook. The coordination session reviews it and Brook merges. This session doesn't push to `main` or touch Railway. B3's migration 016 isn't part of this deploy.

## What shipped

- **Carry-over filter in `db-import`** (`services/studio/importPlan.ts`):
  - Runs are picked with `--since 2026-09-28` or `--runs a,b`. Planted-line checks (`adhoc-*`) never come across.
  - The briefs, decision history and taste examples of the chosen runs follow them.
  - Blind compares only come across with `--compares`.
  - `--dry-run` prints the plan and writes nothing.
  - Rules aren't touched unless `--with-rules` is given; in production they go in through the admin Rules view.
  - Decisions made before attribution existed are credited to the run's author at the run's last save, each with one history record marked imported.
  - Re-runs don't duplicate history or spend.
- **Compliance-sheet fixes (Brook):**
  - The sheet for Trupanion gains a "Please check" column. A line that went through with an overridden red flag says "Please check specifically: \<the rule in plain words\>", using the rule's wording from the rules file, never the reason or a name.
  - A line with an overridden red flag can only be marked "Cleared" with a note, e.g. who at Trupanion cleared it. The page asks for it.
  - The internal handoff CSV and Markdown show the override (rule, who, reason) next to the compliance status.
- **Found and fixed during the rehearsal:**
  1. **A fresh database could never be set up.** Every Studio request loads the active rules first, so with no rules every route failed, including the admin upload. Now the rules routes work without rules, every other route returns `503 no_rules` with a plain message, and the page takes an admin straight to the Rules view.
  2. **"Price leads" went red on a line with no price.** The planted line "Cheap pet insurance can cost you more…" came back red: the model thought the price led, and the yes/no check leaned only weakly towards yes (P=0.41). That rule can only be breached when there's a price in the line, so without one it stays amber. With a price, the usual rule applies.
  3. **Naming codes could be reused.** The shortlist numbers lines by position, so a new line could get a code that another line was already signed off under, and B3b joins live results on that code. Sign-off, and the preview on the page, now bump to the next free number, so a code belongs to one line for good.
- **Planted check through a hosted Studio:** `studio.ts planted --api https://host` with `STUDIO_TOKEN` in the environment. This is the smoke-test tool.

## Deploy rehearsal (local database `voices_rehearsal`, real keys)

1. The backend (`src/index.ts`) booted on an empty database. All migrations ran with no warnings, and all 15 `studio_*` tables exist.
2. **Sign-in:** Brook, Nick and Vivan signed in through the Narrativ SSO exchange (a local test secret). `/access`: Brook is allowed and an admin; Nick and Vivan are allowed; someone.else@ralph.world gets no access.
3. **Before the rules:** `/meta` returns 503 `no_rules`. Nick's rules upload is refused (403). Brook uploads v2.2 as a draft, then activates it.
4. **Import:** `db-import --store pg --since 2026-09-28 --with-spend` brought over Brook's 2 kickoff runs (44 lines, 6 kept) with 7 decisions, 7 imported history records, 7 taste examples, 2 briefs, 3 assets and 17 spend records ($1.502). Running it again adds nothing.
5. **Planted lines, through the hosted `/check` route:** 10/10, twice.
6. **One small live batch** (Nick's own line plus 6, gpt-4o) through `/generate`: 45 s, $0.048. Progress streamed over the signed-in connection, and the run records `rules_version v2.2` and `created_by nick.larson@ralph.world`.
7. **Sign-off end to end:**
   - Nick kept 2 lines and edited a third into a red flag ("It pays for itself").
   - Sign-off was blocked (409, naming the line).
   - The real re-check confirmed the flag: rule, model and yes/no all agreed.
   - The override with a reason unblocked it.
   - Nick signed off set v1 with the expectation (hashes and naming codes stored).
   - Vivan couldn't clear the overridden line without a note, then did with one.
   - The Trupanion sheet shows "Please check specifically: Never say or imply the policy 'pays for itself'" and nothing internal. The handoff has 15 even columns with the override next to the status.

**Cost of the real-key checks:** $0.163. Total spend on the laptop key is about $1.67 of the $15 cap.

**Tests:** 79 backend tests pass, twice in a row. Type checks are clean.

## Deploy checklist for Brook

**Before the merge**, set these on the **backend** Railway service. The frontend service needs nothing new, because production builds use the hosted Studio automatically.

| Variable | Value |
|---|---|
| `ENABLE_STUDIO` | `true` |
| `STUDIO_EMAILS` | `<the address Brook signs in to tools.ralph.world with>,nick.larson@ralph.world,vivan@ralph.world` |
| `ADMIN_EMAILS` | must include Brook's sign-in address (it already gates `DELETE /api/anchors/all`, so add to it rather than replacing it) |
| `STUDIO_MONTHLY_CAP_USD` | `50` |
| `ANTHROPIC_API_KEY` | a **fresh** key for Railway, not the laptop key, and never pasted into chat. Only the Claude writer in Blind compare uses it. |
| `OPENAI_API_KEY` | already set; the Studio uses the same key |

- Don't set `STUDIO_MOCK`; it's for local development only.
- `STUDIO_ASK_OVER_USD` is optional and defaults to 2.

**Migration 015:**
- It needs only pgvector. Migration 004 creates the extension, and production (yamanote) already has it.
- Every statement is `IF NOT EXISTS`, so it's idempotent. It was run on a fresh boot and several times on existing databases.
- It's additive: 15 new `studio_*` tables and nothing else changed.

**After the deploy** (with Brook's confirmation at each step):
1. **Check the deploy.** The Railway logs show `[startup] Copy Studio: enabled at /api/studio` and `Database migrations applied.`, with no "Migration warning".
2. **Rules.** Brook opens tools.ralph.world → Voices → Studio. With no rules yet, it opens on the Rules view. He uploads `studio-rules.json` v2.2 from the client folder (after confirming), then activates it.
3. **Carry-over.** From Brook's laptop, with his go-ahead and the production URL typed in by him, never read from `.env`:
   ```
   STUDIO_DATABASE_URL=<production URL> npx tsx scripts/studio.ts db-import --store pg --allow-remote --since 2026-09-28 --with-spend --dry-run
   ```
   Check the plan (2 runs, 7 taste examples, 17 spend records), then run it again without `--dry-run`.
4. **Smoke test:**
   - The planted lines through production: `STUDIO_TOKEN=<Brook's Voices token> npx tsx scripts/studio.ts planted --territory DINK_NEVER --api https://<backend host>`, which should report 10/10. Alternatively, paste them into Write & brief → Check your lines.
   - One small batch (6 lines, about $0.05) in the Studio.
   - Nick and Vivan open Studio; someone not on the list doesn't see the nav item.
5. **Rollback:**
   - Set `ENABLE_STUDIO=false` (or remove it) and redeploy. The routes aren't mounted and the nav item disappears; nothing else in Voices depends on the Studio.
   - Migration 015 is additive, so the tables can stay. To remove the Studio completely, `DROP TABLE studio_* ` after a backup, only with Brook.

## Follow-ups (not needed for a safe first deploy)

- **Dev-only SSO double exchange.** React StrictMode runs `AuthProvider` twice in development, so a dev build lands on the login page. It's existing code, and production isn't affected.
- **Sign-off concurrency.** Two people signing off the same persona × territory in the same instant could both get the same set version; the unique index refuses the second, which then has to be retried. Unlikely with one creative lead.
- **Blind compare stars** are saved as a whole-set write, so two people starring at the same moment can lose one star. Only relevant for Blind compare.
- **Spend visibility.** The page doesn't show monthly spend (Brook removed the tracker). Admins may want a small view later.
- **Point the nightly backup at Google Drive** once Drive for desktop is installed. After the deploy, the production database is the record, and Railway's own backups cover it.
- **The "Do the Math" territory:** keep it or retire it (open with Brook).
