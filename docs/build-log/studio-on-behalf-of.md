# Studio: "on behalf of" (1 Oct 2026)

Brook may run Nick's creative through Studio for him; the creative call stays Nick's. Wherever a person's call is recorded there are two people: **by** (the signed-in user who entered it, unchanged) and **for** (whose call it is; nobody when it's their own).

## Where it's stored (no migration)

| Call | By | For |
|---|---|---|
| Keep / cut / edit a line, and its taste row | `line.decided_by`, taste `by` | `line.decided_for`, taste `for` |
| Red-flag override on copy | `override.by` | `override.for` |
| Sign-off | `signoff.ready_by`, `line.ready.ready_by` | `signoff.ready_for`, `line.ready.ready_for` |
| Line version | `created_by` | `created_for` |
| Expectation ("expected to lead" + why) | `created_by` | `created_for` |
| Pre-flight red-flag override | `override.by` | `override.for` |
| Pre-flight passed | `status.ready_by` | `status.ready_for` |
| Trupanion's decision, recorded | `compliance.by` | `compliance.for` (`client_by` is still who at Trupanion decided) |
| A bulk copy check (Check copy) | `created_by`, `added_by` | `created_for`, `added_for` |

Three of these keep the person in a text column (expectations and line versions' `created_by`, `studio_asset_status.ready_by`). There the pair is packed as `by (for X)` by the store and unpacked on read (`backend/src/utils/actor.ts`), so older rows read as before. History rows (`studio_edits.by`) say "brook for nick".

## How it's chosen

The page's "for" picker (beside Sign off, the expectation, an override's reason, Mark Pre-flight passed, and the Trupanion decision) sets one value for the browser session, shown as a chip in the header while it's set. It travels as the `X-Studio-For` header on every request. Hosted, it must be on a Studio list (`STUDIO_EMAILS`, `ADMIN_EMAILS`, `STUDIO_READY_EMAILS`, `STUDIO_COMPLIANCE_EMAILS`); anyone else is refused (403). Naming yourself is the same as naming nobody.

**Role checks always use the signed-in person**, never the "for" person: nobody gains a permission by picking someone else.

## Where it shows

"Brook for Nick" in the line history, Review's decided-by and signed-off tooltip, Build's sign-off history, overrides, Assets' Pre-flight passed and recorded-by. Exports: the handoff, the asset handoff and the features file add **Decided by** (the "for" person, else who entered it) and **Entered by**. The compliance sheet for Trupanion shows neither.

## Tests

`backend/tests/studioActor.test.ts` (pack/unpack) and the "on behalf of" test in `studioPg.test.ts` (HTTP: every call above with by + for, the Studio-list check, role checks on the signed-in person, the exports).

## Generation honours "for" (1 Oct, follow-up)

- `POST /generate` passes the `X-Studio-For` person to `S.generate` (`opts.for`). A **new** run gets `created_for`; the lines the person typed get `added_for`. Continuing an existing run never changes whose run it is. Permissions and spend stay the signed-in person's.
- Storage: `created_for` on the run, and `brief.bulk.for` (Postgres reads the run header's "for" back from the brief, as it already did for copy checks). No migration.
- The "for" picker is by the Generate buttons on Write and in Review's run header.
- Admin correction: `POST /batches/:id/for {for}` (admins only; the name must be on the Studio list; `''` clears it). In Review's run header as "This run is for" (shown to admins when the Studio list is available, so hosted only). The run's own typed lines follow; `created_by` never changes; the change is in the edit log as `run:<id>`.
- Generated lines carry no person, so "Generate more" and "More like this" have nothing to stamp; resume only finishes checks.
- Shared captions: the writer prompt now makes naming the product and ending on a call to action a MUST for primary text and captions, and a shared primary text or caption whose last sentence isn't a call to action gets an amber flag (`SHARED_CTA`, "no call to action").
