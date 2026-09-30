# Studio: Ready to traffic needs compliance; compliance per code (30 Sep 2026)

Brook's answers to the two open questions in `studio-nick-fixes.md` (PR #22), plus Brook's note about Vivan's role. Branch `voices/studio-traffic-gate`, from `main` at ad5bc92. **No migration.**

## (a) Ready to traffic = Pre-flight passed AND compliance cleared

- **The rule.** A code is **Ready to traffic** only when both hold:
  - Pre-flight has passed on its latest upload (the creative lead's mark, as before);
  - Trupanion's compliance is cleared on that upload and on the current signed-off wording.

  It's computed on read (`Preflight.traffic(stub)`), never stored, so it can't go stale.
- **The creative lead's button** is now **Mark Pre-flight passed**; its tooltip says Ready to traffic also needs compliance. The stored status (`studio_asset_status`) keeps its meaning: Pre-flight passed.
- **The two parts are shown separately:**
  - Pre-flight's header: "Pre-flight passed · Compliance pending" (or "changes requested"), with what's outstanding.
  - The sidebar chips: "passed · compliance pending" or "passed · changes requested".
  - The Compliance step shows each code's status.
- **What takes a code out of Ready to traffic:**
  - Trupanion's changes requested, on the copy or the visual.
  - A new upload: Pre-flight reopens, and compliance goes back to pending on the new asset.
  - Wording edited after sign-off, shown as "Wording edited since sign-off", until it's signed off and reviewed again.
- **Handoffs: Add3 only sees cleared codes as ready.**
  - Asset handoff (`/preflight/handoff.csv`): the Status column shows "Ready to traffic", or the two parts. There's a new Ready to traffic yes/no column; "Pre-flight passed by/at" replaces "Ready to traffic by/at"; and there's "Cleared at Trupanion by".
  - Handoff pack (`/handoff.csv`, `.md`): a new Ready to traffic column per code, when the Studio has the database.
- **Codes marked ready before the gate** (Pre-flight marked before `COMPLIANCE_GATE_FROM` = 2026-09-30T14:30Z, with no compliance decision recorded) stay Ready to traffic and say "compliance not recorded". Once a decision is recorded for them, the rule applies.
  - The cut-off is a constant, set just before this was built. Anything marked ready by the old code between then and the deploy shows as "Compliance pending", which errs towards not trafficking.

## (b) Compliance per code on a shared visual

- The Compliance step has **Applies to** checkboxes, one per code, **all ticked by default** ("every code on this asset"). So Vivan can clear A1 and A2, then untick them and send back only A3's copy.
- Each code shows its own compliance status and its Ready to traffic state.
- The backend's `codes` parameter now refuses by name a code that isn't on that upload any more.

## Vivan records Trupanion's decision; she doesn't sign off

Brook: Vivan coordinates compliance with the client but doesn't sign off compliance herself.

- The panel is **Record Trupanion's decision**, with a required **Who at Trupanion** field for Cleared and Changes requested. The buttons read "Cleared by Trupanion" and "Changes requested".
- It's stored as `compliance.client_by`, next to `by` (who recorded it in Studio).
- It's shown as "Trupanion: J. Doe, Trupanion legal · recorded by vivan…" on the asset and on Ready, and in the asset handoff's "Cleared at Trupanion by" column.
- The reviewer's name is always required. **Follow-up (PR after #23, Brook):** the override note is back as well. Clearing any selected code that went through with an overridden red flag (a Pre-flight flag, or the copy at Ready) needs a note saying what Trupanion accepted. The page lists those flags, with their override reasons, next to the note and says why, and keeps "Cleared by Trupanion" disabled until there's a note; the server refuses with a 409 naming the flags (`Preflight.overriddenReds`).
- Permissions are unchanged: `STUDIO_COMPLIANCE_EMAILS` (plus admins) can record decisions.

## Tests

`cd backend && STUDIO_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_studio_test npm test`: **135 pass, 0 fail**. New Postgres test, "Ready to traffic needs Pre-flight passed AND compliance cleared, per code on a shared visual":
- one shared upload, all three codes with Pre-flight passed;
- A1 and A2 cleared, A3 changes requested (copy): A1 and A2 are Ready to traffic, A3 isn't;
- `client_by` is recorded;
- both handoffs show yes / yes / no;
- edited wording takes A2 out;
- a new upload takes everything out;
- a code marked before the gate stays ready as "compliance not recorded", until a decision is recorded.

Existing tests are updated for the new columns and for the reviewer name. Both type checks are clean (apart from the known pdf-parse and rcb-client errors).

**Walked through in local hosted mode** on a temporary database (dropped afterwards, as was the earlier `voices_region` database and the local launch config):
- As Nick: three lines signed off, one shared upload, audited, Pre-flight passed on all three.
- As Vivan: recorded "J. Doe, Trupanion legal" clearing A1 and A2, then A3's copy sent back.
- Pre-flight and both handoffs checked.

Screenshots are in `Claude outputs/voices-r1/studio/screens/traffic-gate-30sep/`:
1. `1-compliance-record-decision-per-code.jpg`
2. `2-compliance-A1-A2-cleared-A3-copy-back.jpg`
3. `3-preflight-two-parts.jpg`

## Deploy notes

- No migration, and no new env var.
- **After the deploy**, codes that were marked Ready to traffic before 30 Sep 14:30 UTC show "Ready to traffic · compliance not recorded". Everything marked since then shows "Pre-flight passed · Compliance pending" until Trupanion's decision is recorded.
