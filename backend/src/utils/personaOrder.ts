// One persona order everywhere: DINKs, Curators, Families, as the page's persona picker and the copy deck have them
// (the page's copy: PERSONA_ORDER in frontend/src/components/studio/ui.tsx). The database doesn't keep the rules
// file's key order, so exports and the worksheet sort by this, with any other persona after, in the rules' order.
export const PERSONA_ORDER = ['DINK', 'CUR', 'FAM'];
/** A sort key for a persona code, given the rules' own persona codes for the ones not named above. */
export function personaRank(code: string, known: string[] = []): number {
  const i = PERSONA_ORDER.indexOf(code);
  if (i >= 0) return i;
  const k = known.indexOf(code);
  return PERSONA_ORDER.length + (k >= 0 ? k : known.length);
}
