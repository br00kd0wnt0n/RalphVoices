# Studio: shared captions

Brook, 1 Oct 2026. Needed for the 45 primary texts and the headline bank.

## What it does

- **A shared pool of post copy.** Primary text, Meta headlines, descriptions and TikTok captions that are reused across personas live under a built-in pair: persona `ALL`, territory `SHARED` ("Shared captions"). It is added to the rules in memory, so there is no rules change and no migration.
- **Write.** Pick "Shared captions" in the context bar's persona list, on the board, or at the end of Write's territory picker. Only post-copy fields can be ticked. The page lists every persona's kept on-image headlines in the region and round; the writer is given the same list and told to write captions that sit under any of them, brand-level, with no persona-specific references.
- **Review.** As for any run.
- **Build.** There is no sign-off for the shared pair. Kept shared captions appear first in the tray for a post-copy slot in every territory ("Shared captions", then "This territory"). A territory with no post copy of its own starts from the first shared captions.
- **Handoff and features.** The copy handoff CSV has `Caption ID` and `Shared caption`. The Pre-flight features CSV has `caption_line_id` before `round`, so B3 can read one caption across personas.
- **Compliance.** When a code's caption is shared and other codes use the same wording, the decision box offers "Also record it for the N other codes using this shared caption". It records the caption line only; each of those codes still needs its own asset decision.
- **Check copy.** Persona-less post copy is filed into the shared pool and can be opened in Review. "Whose copy is this?" suggests the people on the Studio list; choosing one also sets who you are working for. Any other name stays as free text.

## Folded in

- **33:** on-image text over its aim is "Long for on-image text: N characters (aim for M or fewer)" (`LIMIT_ON_ASSET`), not "cut off", and quotes no cut word.
- **34:** Check copy reads a card or slide column; pasted cards get `card` and `sequence_id`, and Build places card subheads by sequence.
- **36:** a retired territory with runs or sign-offs in the round stays on the board, in the context bar and in Write's picker, marked retired. Write says it takes no new briefs.

## Where

`engine.ts` (`isShared`, `sharedAudience`, `approvedHeadlines`, `onAsset`), `ready.ts` (`readyView` shared lines, `captionOf`), `preflight.ts` (`caption_line_id`, `apply_shared`, `sharedCaptionCodes`), `bulk.ts` (cards), `router.ts` (`/approved-headlines`, `retired_with_work`); frontend `Write.tsx`, `Build.tsx` (Tray), `Assets.tsx` (Decision), `Board.tsx`, `CopyCheck.tsx`, `pages/Studio.tsx`, `ui.tsx` (`isOpenTerritory`, `isSharedCtx`).

Tests: `studioShared.test.ts`, the "shared caption in 3 codes" and "retired territories with runs" cases in `studioPg.test.ts`, case 34 in `studioBulk.test.ts`, case 33 in `studioSubhead.test.ts`.

## Not done

- The "also record it for the other codes" checkbox was not exercised in the browser (it needs two signed-off, uploaded codes on one caption); the server side is covered by the Postgres test.
- Ad-set mode is on the backlog.
