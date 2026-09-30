# Studio: live versions, on-image per visual, version checks (30 Sep 2026)

Branch `voices/studio-live-versions`, from `main` at 8109136 (after #25). **No migration**: everything is in the sign-off and line JSONB. It must land before Nick signs anything off for real. Production has no sign-offs yet, so nothing needs converting.

The brief came from Brook via the coordination session as items A–D. Item E (per-card carousel text) came in later. It will be its own PR straight after this one.

## What changed

### A. Live versions: one code = one ad

- **A version is a set of fields.**
  - Meta: primary text + headline required, description optional.
  - TikTok: caption required, hook optional.
  - Roles come from each field's `in_version` in the rules (`required` / `optional` / `per_visual`). Without it, the defaults are: meta_primary, meta_headline and tiktok_caption required; any `*on_image*` field per visual; the rest optional. Rules v2.11 can set them; any other value falls back to the default.
  - Logic: `services/studio/versions.ts` (`fieldRole`, `versionFields`, `defaultDraft`, `planDraft`, `signoffVersions`, `complianceFor`).
- **Built at Ready, per visual letter.**
  - The default for a set with no sign-off: per platform, the required fields' lines paired in writing order (a field with fewer lines reuses them), three versions to a visual, and the first on-image line on each visual.
  - The lead changes any field of any version, moves a version to another visual, adds or removes versions, and picks the on-image text per visual.
  - A line can be in several versions (one headline in A1–A3).
- **Codes.**
  - Each version gets `PERSONA_TERRITORY_FORMAT_<visual><version>_REGION_PLATFORM`. The digit is now the version number; the format is unchanged.
  - A version with exactly the same lines as in the last sign-off keeps its code. Any other version gets the next free number on its visual, and a code signed off anywhere is never handed out again.
  - `POST /ready/preview` plans the codes as the lead builds, so they're visible before signing off.
- **The sign-off stores:**
  - `versions[]`: code, visual, number, platform, and per field the line id, version, text and sha256;
  - `on_image[]`: one per visual, with its visual key;
  - `checks[]`: see D;
  - the expectation, by code (`stubs`, plus the line ids in them).
  - Each line still gets its hashed line version, whose `stub` lists the codes it went out under, comma-separated.
- **Refusals.**
  - An incomplete version is refused with what it needs: `DraftError` → 400 `{error, issues}` (e.g. "OWN_CALM_UGC_A1_US_META: needs headline").
  - Two people signing off at once is still a 409 (`expect_latest`, from #25). A script without `expect_latest` whose expectation names a code taken meanwhile now also gets a clear 409 ("The codes changed since the screen loaded…"). Found in the two-user re-run.
- **Per code downstream.**
  - Pre-flight's code list and copy (a code's fields plus its visual's on-image text).
  - Compliance: stored per code on the line, `line.compliance_by_code[code]`, so a shared headline can be cleared in A1 and not in A3. The older per-line `compliance` is still read (`complianceFor`).
  - Handoff CSV/MD: one row per code, a column per field, "On-image text (the visual)".
  - Compliance sheet: one row per code, fields as columns.
  - B3 features: per code, as before.
- **Old codes keep working.** A sign-off from before versions (one code per line) is read as one-field versions by `signoffVersions()`, everywhere. Test: `studioRegion.test.ts`, "a sign-off from before versions…".
- **Shortlist** is grouped by field (Meta first, in the rules' order). The code column became "Signed off in" (blank until Ready), since codes now belong to versions.

### B. On-image text per visual

- A `meta_on_image` line (any `per_visual` field) gets a visual letter, not a code: one per visual.
- **Pre-flight:** added to the copy of every code on the visual, matched as `on_image` ("must" be on the asset).
- **Compliance:** shown once per asset, above the per-code copy.
- **Handoff:** the MD shows it per visual ("### Visual A (Meta)"); the CSV repeats it on each code's row.
- `writer_note` on a field (a string) is added to the writer prompt for that field. Without it, on-image fields get the built-in guidance.

### C. Leftover spend reservations

On startup (hosted routes, not mock), `reserved:` spend rows older than 2 hours are deleted, and each one is logged ("[studio] cleared a leftover spend reservation: …"). See `clearStaleReservations` in `router.ts` and `store.clearStaleReservations(ms)`.

### D. Version checks at Ready

Flags inform and never block. Each has a rule id and a source. They're shown on each version card, re-run on every change, and stored in the sign-off (`checks`).

| Rule | Severity | How | Source |
|---|---|---|---|
| `VERSION_REPEAT` | amber | Deterministic. Two fields of one ad share a run of 4+ words (the overlap quoted), or 60%+ of their content words with at least 3 shared. | Nick, 30 Sep |
| `VERSION_TOO_ALIKE` | amber | Deterministic. Two versions on one visual and platform have a word/bigram similarity ≥ 0.85. Flagged on both, naming the other code. | Nick, 30 Sep |
| `VERSION_CONFLICT` | amber | One model call per version (gpt-4o, JSON `{hits:[{kind, fields, quote, why ≤12 words}]}`, stage `version-check`). Kinds: contradiction, undercut, tone clash, repeat. A quote not found in the copy is dropped. | Nick, 30 Sep |
| the rules' `require` items (e.g. `COMP_DIRECT_PAY`) | red | The claim in one field and the caveat only in another field (or on the image) of the same ad, or nowhere. | the rule's own source |

- Thresholds and model are in `services/studio/versionChecks.json`. Code: `versionChecks.ts`.
- **Cost and when the conflicts check runs.** It costs money, so it runs:
  - on `POST /ready/check` (the page calls it 1.5 s after a change), priced first (`plan.check_estimate`) and reserved against the cap;
  - at sign-off, for any version not yet checked on its current wording.
- **No double charges.** Answers are kept per wording (a hash of the ad's field texts) in memory, and re-seeded from sign-offs after a restart, so an unchanged version is never paid for twice.
- **Split-claim severity is red, as briefed.** Pre-flight's asset copy check makes a caveat that sits elsewhere in the ad amber. At Ready it's red because the fields can show apart (a headline without its primary).

**Live run** (real OpenAI, example rules, 3 versions: direct pay vs "claim it back", a clean one, a joke headline):
- Estimate $0.0043, spent $0.0030, 2.0 s.
- The contradiction and the tone clash were found; the clean version got nothing.
- The first prompt also flagged a harmless headline echo ("both emphasise 'calm'") and paraphrased two quotes. The prompt now says an echo is fine and quotes must be copied exactly. On the re-run: $0.0027, clean version clean, contradiction quoted ("never front the bill").
- Total live spend: $0.006.

## The Ready screen

Screenshots are in `Claude outputs/voices-r1/studio/screens/live-versions-30sep/`:
1. Meta visual A: three versions sharing a headline, the on-image picker, a repeat flag (A1) and a red split claim (A2).
2. Visual B with a "too alike" pair; A3 with a conflict ("fields clash").
3. A TikTok version: caption + optional hook.
4. Signed off (set v1), A2 starred as expected to lead.
5. Pre-flight: A1–A3 as one visual; headline and on-image on the asset, primary as post copy.
6. Shortlist grouped by field, with the codes each line went out under.
7. Pre-flight copy match on the shared upload: headline and on-image text both matched.
8. Compliance: on-image text once for the asset, then each code's copy.

## Tests

`cd backend && STUDIO_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_studio_test npm test`: **154 pass, 0 fail** (146 before this branch).

- `tests/studioVersionChecks.test.ts` (new):
  - repeats;
  - too alike (same visual vs different visuals);
  - conflicts (priced, one call per version, cached per wording, re-checked after an edit, stored in the sign-off, reseeded after a restart);
  - split claims (another field, on the image, nowhere, and not blocking);
  - TikTok (caption required, hook optional, `_TT` codes, handoff columns).
- `tests/studioPg.test.ts`: live versions end to end.
  - A1–A3 share a headline, with on-image text on A.
  - The default draft, and an incomplete version refused.
  - Sign-off; Pre-flight lists the three codes as one visual.
  - One shared upload: on-image matched for all three, primary as post copy. Without the on-image text, all three are flagged; after a new upload, matched again.
  - Compliance per code (A1/A2 cleared, A3 changes requested; the shared headline has a status per code).
  - Handoff: 3 rows, fields as columns, on-image text on every row, and the MD per-visual section. Compliance sheet: 3 rows.
- Stale reservations: `studioBudget.test.ts` (file store) and `studioPg.test.ts` (Postgres).
- Reworked to versions: the Ready scenario (both stores), region, keep-after-edit, Nick's fixes, on-image, and the Postgres compliance, traffic-gate, override-note and concurrency tests. Concurrency test 4 adds the 409 for a stale expectation code.
- Type checks: frontend clean; backend has only the 9 existing errors outside Studio (pdf-parse, uploads, rcb-client).

**Two-user re-run.** I copied the coordination session's scripts to my scratchpad (`twouser3/`) and ran them on a fresh local database with mock mode on port 3011. They sign off through a `prepSet` helper: each primary text with a headline, since sign-off now takes versions. The database was dropped afterwards.

| Scenario | Result |
|---|---|
| 1. Separate runs at once | 0 bad lines |
| 2. Two people on the same lines | 40 same-line rounds: 0 lost; history chained; column = body |
| 3. Save edit, then Keep | Edits kept everywhere |
| 4. Added lines at once | Both kept, unique ids |
| 5. Shortlist cut vs sign-off | Never both |
| 6. Racing sign-offs | One wins; US and CA both go through; codes unique per ad across every sign-off. The loser without `expect_latest` now gets a 409 (fixed here, see A) |
| 7. Uploads | Shared-visual uploads agree in every round |
| 8. Compliance + edits | 0 lost in 4 + 42 + 82 rounds; an edit shows "Wording edited since sign-off"; a re-sign shows "Reviewed on a different wording" |
| 9. Taste | 27/27 rows right; 0 wrong in 10 rounds |
| 10. Spend ledger | Exact |

`audit.sql`:
- No orphans.
- Every code maps to one set of lines.
- The "same code on different lines" rows are expected now: a version is several lines.

## Not in this PR

- **E, per-card carousel text.** Next PR, as agreed.
- **Pre-flight's headline caveat check (question for Brook).** Pre-flight treats the Meta headline as "maybe on the asset". So a caveat in a headline that isn't on the image is red (`COPY_CAVEAT`). With one visual now serving several headlines (A1–A3), that fires on every version whose headline carries a caveat the image doesn't. This rule predates this PR; I haven't changed it. If headlines never go on the image now that on-image text is its own field, the headline should become post copy (`POST_COPY_FIELDS`).
- `default_count` (rules v2.11) isn't read yet. It belongs to the per-field counts in the restructure.
