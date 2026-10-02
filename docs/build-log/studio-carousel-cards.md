# Studio: carousel cards, and the headline as post copy (30 Sep 2026)

Branch `voices/studio-carousel-cards`, from `main` at 9a49923 (after #26, live versions). **No migration.** This is item E of the live-versions brief (Brook, via the coordination session), plus the approved change to Pre-flight's headline check. Month 1 has 3 carousels.

## What changed

### Writing card sequences

- A brief for a CAROUSEL territory with an on-image field ticked (`in_version: per_visual`, or an `on_image` id) gets `carousel: {sequences, cards}`: 3 × 4 by default, capped at 6 × 10. Write & brief shows both next to the field buttons.
- The loose-line grid leaves the on-image field out. One extra writer call, `writeSequences` in `engine.ts`, asks for the sequences.
  - A sequence is ONE idea: card 1 is the hook, the middle cards build it, and the last card pays it off (short, since it may share the card with the disclaimer).
  - Every card is aimed at its field's target length and must read on its own. No card repeats the one before.
  - Each sequence takes a different angle.
- Each card becomes a line: `card` (1…N) and `sequence_id` (`<run>-S<n>`). They're checked like every line, and the estimate prices the call and the cards' checks.
- **Review:** a chip ("card 2 of 4 · sequence S1") and **Keep the whole sequence** (keeps every card not already kept; an edited card keeps its edit). Cards can still be kept or cut one by one.

### Ready

- `draft.on_image[visual]` is an array on a carousel: the cards in order, with `''` for a card with no text. `planDraft` checks each card, allows at most 10, and refuses cards on a non-carousel territory. `defaultDraft` puts the first kept sequence (in card order) on visual A, the next on B, and so on; loose on-image lines fill cards four at a time. After a sign-off, the default is the signed-off cards.
- The Ready screen shows a carousel visual's card slots:
  - a card count (1–10);
  - a line per card (labelled "S1·2 …");
  - ↑/↓ to reorder;
  - "Use a whole sequence".
  The same cards go with every version on the visual.
- The sign-off stores each card: `on_image[] = {…line, visual, visual_key, card}`. The set hash includes the card number.

### Pre-flight

- A code's copy includes its visual's cards in order, labelled "On-image text, card k", with `card` set.
- `cardMatch` (preflight.ts) checks each card against the text read off that card:

  | Result | Flag |
  |---|---|
  | On its card | match |
  | On another card | amber `COPY_CARD_ORDER`, "On card 3, expected card 2", pointing at the card it was found on |
  | Reworded on its card | amber `COPY_MATCH`, both quoted |
  | Not on the asset | red `COPY_CARD_MISSING`, with what the card does say |

- B2's whole-asset on-image row isn't repeated for carousels. Its caveat check (`COPY_CAVEAT`) still runs on all the on-asset text.
- The disclaimer check is unchanged.
- The report's copy-match table shows the card and "on card N".

### Version checks

Each card is a field of the ad, `meta_on_image#k` ("On-image text, card k"):
- card 2 restating card 1 is a repeat;
- the conflicts call sees the end card against the hook;
- a claim on one card with its caveat only on another is red (split claims).

### Handoff

- MD: under the visual, "Carousel cards, in order: 1. … 2. …".
- CSV and compliance sheet: an `On-image card k` column per card, repeated on each code of the visual.
- Compliance lists the cards once per asset, in order.

### The headline is post copy (Brook, 30 Sep)

- `meta_headline` joined `POST_COPY_FIELDS`, and copyMatch's headline is now `onAsset: 'no'`: text on the image has its own field, so Pre-flight doesn't look for the headline on the image any more.
- A caveat that belongs with a claim is checked inside the ad at Ready (version check 4).
- This also changes B2's standalone audit: a headline gets "not expected on asset" instead of a grey note. The B2 doc is updated.

## Screenshots

In `Claude outputs/voices-r1/studio/screens/carousel-cards-30sep/`:
1. Ready: visual A's four cards (from sequence S1), shared by A1–A3.
2. Cards 2 and 3 reordered.
3. Review: card chips and "Keep the whole sequence" on sequence S2.
4. Sequence S2 kept whole.

## Tests

`cd backend && STUDIO_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_studio_test npm test`: **159 pass, 0 fail** (154 before this branch).

- `tests/studioCarousel.test.ts` (new, file store):
  - sequences written: card numbers, sequence ids, priced, capped, and only for carousel territories with on-image ticked;
  - Ready: the default cards on A, codes `_CAR_A1–A3_`, swaps, a blank card, at most 10;
  - sign-off stores the cards, and the default brings them back;
  - handoff card columns on every code, MD list, compliance sheet;
  - checks across cards: repeat, split claim (red), conflict with the end card;
  - `cardMatch`: in order, swapped (amber, points at the found card), missing (red), reworded (amber).
- `tests/studioPg.test.ts`: a 4-card visual with A1–A3 → sign-off → one carousel upload serving all three.
  - In order: no copy-match flags; every card matched.
  - A caveat-carrying headline is post copy, with no `COPY_CAVEAT` against the image.
  - Swapped: two ambers. Missing: one red.
  - Compliance lists the three codes on one asset; the handoff has the four cards on every code's row.
- `tests/auditLibrary.test.ts`: the headline is post copy; a caveat headline raises nothing against the image.
- Type checks: frontend clean; backend has only the existing non-Studio errors.

## A looser length guide for cards (2 Oct, rules v2.15)

- A field may carry `card: { visible, max, source }` (rules v2.15 puts 90 / 125 on `meta_on_image`). It applies when the line is a carousel card: it has a `card` number, or its territory's format is a carousel. One definition: `fieldLimits` in engine.ts, mirrored by `limitsOf` / `specFor` in `components/studio/ui.tsx`.
- Used by the length flags (`LIMIT_ON_ASSET` says "Long for a carousel card … (aim for 90 or fewer)" and quotes the card guide's source), the writer prompts (field list, cells, card sequences), Check copy's report, and the counters on Write, Review and Build.
- Statics and video end cards keep the field's own guide. The subhead keeps its own unless the rules give it a `card` block. Rules without `card` behave as before.
- Pre-flight doesn't quote the 40/60 guide for on-image text (its length check is for sidecar post copy only), so nothing changed there.
- Stored flags don't change until a line is re-checked or edited.
