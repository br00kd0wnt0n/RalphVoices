# B1 Studio, phase 7: Pre-flight (step 6), Live placeholder, Readout removed (28–29 Sep 2026)

Branch `voices/b1-studio-preflight`, draft PR #15. It is on hold because it contains **migration 017**; merge only as a deploy with Brook. B2's audit library (PR #16) is already on `main`. Plan: `docs/b1-studio-plan.md`, section 4b, phase 7 and decisions 10–11.

## What shipped

- **Pre-flight, per signed-off naming code:**
  - Upload a static image, carousel cards or a video.
  - See the cost and time estimate, then run the audit as a background job with live progress. It runs on B2's engine (`services/studio/preflightB2.ts`), or on the mock with `STUDIO_MOCK` in dev.
  - The report shows, in order: copy match first (the signed-off wording against what's on the asset); flags with quotes, the card or frame they sit on, and sources; cross-persona notes ("How it travels"); the text found and the transcript; features; and the skeptic.
  - Agree or disagree on each flag, per person. The round's agreement rate counts every verdict, including those on uploads that were later replaced.
  - Red flags are fixed by a new upload, or overridden with a reason. Overrides are allowed only for people who can mark Ready to traffic.
  - Ready to traffic is set by admins and `STUDIO_READY_EMAILS`. A new upload reopens the code.
  - A failed audit (for example an OpenAI outage) can be run again; "Audit again" re-checks after a rules change.
  - Exports: the features CSV in B2's format for B3's `weekly.ts features`, and the asset handoff list.
- **Storage:**
  - Production: R2, under `studio/preflight/<stub>/<upload id>/…`, served only through the signed-in API and never by public URL. `STUDIO_R2_BUCKET` optionally moves these files to a private bucket.
  - Local and dev: Postgres, 25 MB per file.
- **Migration 017** (additive, idempotent): the Pre-flight tables, plus `studio_rules.activated_by`/`activated_at` for the Rules view.
- **Also:**
  - Readout and reference docs removed (decision 10). The header shows a "Trupanion" wordmark when there's no logo.
  - "Live · soon" in the nav.
  - Rules view: "Live: vX, activated by …", "Upload and activate", and a banner after a draft upload.
  - `db-import` carries the M3 rubric.
  - ffmpeg is added to `backend/nixpacks.toml`.

## Acceptance with real keys (29 Sep, local rehearsal database, hosted mode, B2's engine, rules v2.3)

1. Brook uploaded and activated v2.3 through the admin endpoint ("activated by brook@ralph.world").
2. Nick wrote a TikTok hook with the caveat ("Your vet can be paid directly, at participating hospitals.") and a Meta headline. Both passed the real checks, and he signed them off (set v2).
3. **Dropped caveat:** a vertical static that says only "Your vet can be paid directly." Audit: 138 s, $0.09, estimate 182 s / $0.12.
   - **COPY_CAVEAT red**, shown first, quoting the missing "…participating hospital…".
   - COPY_MATCH amber, with both versions quoted.
   - Direct-pay amber, on the image.
   - Text read correctly; a feature tagged; the skeptic's objection.
4. Nick and Vivan marked verdicts (Nick disagreed with a grey member-testimony note, since there's no person in the ad): 6 of 7 agree (86%).
   - Vivan was refused both Ready to traffic and the override (403).
   - Nick's Ready to traffic was blocked while the red was open (409, naming the flag).
   - Nick overrode it with a reason and marked the asset ready.
5. **Fixed asset** (caveat present): the code reopened on upload. Audit: 139 s, $0.09. Copy match: "match", no red. Ready without an override.
6. **Carousel**, two cards, on the headline code: 202 s, $0.13. Cards read separately; the headline matches; a Curators turn-off came through as a cross-persona grey note on card 1. Ready.
7. **Video**, 4 s with no audio, on the TikTok code: 432 s, $0.25. ffmpeg frames at 0.0 s and the 1.5 s hook were read; the hook matches; the transcript is empty (no sound). Ready.
8. **Exports:**
   - B3's own `loadFeatureCsv` read both rows with nothing unmatched (it normalises `…_TIKTOK` to `…_TT`); tags and angle came across.
   - The handoff list shows the status, who marked it ready and when, and the remaining ambers.
   - Spend was logged per audit, under Nick.

**Cost:** $0.56 for the four audits, plus $0.02 of line checks.

**Found and fixed during acceptance:**
- the agreement rate dropped verdicts on replaced uploads
- the copy-match label repeated "signed off"
- the video had no poster frame

Screenshots are in `Claude outputs/voices-r1/studio/screens/` (client material): `9-preflight-red.png`, `10-preflight-video-ready.png`, `11-preflight-carousel.png`. They use test ads on the local database.

**Tests:** 101 backend tests pass, covering the whole flow on Postgres and B2's real engine with a stand-in OpenAI client. Type checks are clean.

## Deploy checklist for Brook

**Before the merge**, on the **backend** Railway service:

| Variable | Value |
|---|---|
| `STUDIO_READY_EMAILS` | `nick.larson@ralph.world` (admins in `ADMIN_EMAILS` can already mark assets ready) |
| `STUDIO_R2_BUCKET` | optional: a private R2 bucket for Pre-flight files. Without it they share `R2_BUCKET_NAME`, under unguessable keys that are never sent to a browser. The existing bucket has a public URL (`R2_PUBLIC_URL`), so a private bucket is safer. |
| `FFMPEG_PATH` | not needed once ffmpeg is in the image (below) |

`ENABLE_R2_STORAGE=true` and the `R2_*` variables are already set (Brook, 28 Sep); nothing new is needed for R2. Don't set `STUDIO_MOCK`.

- **ffmpeg:** `backend/nixpacks.toml` now has `nixPkgs = ["nodejs_18", "ffmpeg"]`. Check that the backend service builds from `backend/` (its Root Directory). If it builds from the repo root, the same line goes in the root `nixpacks.toml`. Without ffmpeg, videos are still audited on copy and voice-over, with a note that frames were unavailable.
- **Migration 017** needs nothing new from the database: it's additive and idempotent (`IF NOT EXISTS` throughout). Migration 016 (B3) is separate.

**After the deploy:**
1. The logs show "Database migrations applied." with no warning.
2. `db-import` carries the M3 rubric (`rubric.json`), which Pre-flight needs. Re-run the carry-over (`--since 2026-09-28`, dry run first) or send the rubric on its own. It's safe to re-run.
3. **Smoke test:** upload one test static to a signed-off code, run the audit (about $0.10), check the copy-match table, then take the test asset back.

**Rollback:** `ENABLE_STUDIO=false` hides the whole Studio. Migration 017 is additive, so its tables can stay.

## Next (UX review, 29 Sep, approved by Brook)

The coordination session's 18-item list. The first priorities:
1. Compare only on-asset fields in copy match (the mock marked post copy red; B2's engine already compares only on-asset fields) and show post copy separately.
2. One visual serving several codes.
3. Stop Review from reflowing after Keep.
4. Fix the step bar at 1440 px.
