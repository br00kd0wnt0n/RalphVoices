// "On behalf of" (Brook, 1 Oct): Brook may run Nick's creative through Studio for him, and the creative call stays
// Nick's. Wherever a person's call is recorded there are two people: `by` (the signed-in user who entered it, unchanged,
// and the one every role check uses) and `for` (whose call it is; nobody when it's their own).
//
// JSON records carry `<verb>_for` beside `<verb>_by` (or `for` beside `by`). Three records keep the person in a text
// column (expectations and line versions' created_by, Pre-flight's ready_by): there the pair is packed as
// "by (for X)" by the store and unpacked on read, so no migration is needed and older rows read as before.

export interface Actor { by: string; for?: string }

const PACKED = /^(.*?) \(for (.+)\)$/;

/** "brook@x (for nick@x)"; just `by` when it's the person's own call (or they named themselves). */
export function packActor(by: string | null | undefined, forWho?: string | null): string {
  const b = String(by || '').trim(), f = cleanFor(forWho, b);
  return f ? `${b} (for ${f})` : b;
}
export function unpackActor(packed: string | null | undefined): Actor {
  const s = String(packed || '');
  const m = PACKED.exec(s);
  return m ? { by: m[1], for: m[2] } : { by: s };
}
/** The `for` worth storing: trimmed, and not the person themselves. */
export function cleanFor(forWho: string | null | undefined, by?: string | null): string | undefined {
  const f = String(forWho || '').trim();
  return f && f.toLowerCase() !== String(by || '').trim().toLowerCase() ? f : undefined;
}
/** Whose call it is: the `for` person when set, else the person who entered it. */
export const decidedBy = (by?: string | null, forWho?: string | null) => String(forWho || by || '');
/** "Brook for Nick", or just "Brook". */
export const whoWords = (by?: string | null, forWho?: string | null) => (forWho && forWho !== by ? `${by || 'unknown'} for ${forWho}` : String(by || ''));
