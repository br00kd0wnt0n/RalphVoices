// Persona colours, from the pitch deck's persona divider pages ("EXT. Trupanion X Ralph Creative Strategy.pdf").
// One place for every screen:
// - `base`: the deck's colour, for low-opacity fills on the dark UI;
// - `edge`: dots and thin left borders (non-text contrast of 3:1 or more on #16181D, WCAG 1.4.11). It is the base
//   colour, except DINK's #545892 (2.7:1), lifted to #6A6FB0 (3.8:1) so the indigo still reads on dark;
// - `light`: text and icons (WCAG AA on #16181D: #A9ADE3 8.3:1, #CBE0B7 12.6:1, #F9E992 14.5:1).
// Persona colour is an accent, never a background, and never competes with the flag colours (red, amber, grey) or the
// brand pink, which stays for CTAs and the active step.

export interface PersonaColor { base: string; edge: string; light: string; deep?: string }

export const PERSONA_COLORS: Record<string, PersonaColor> = {
  DINK: { base: '#545892', edge: '#6A6FB0', deep: '#1B2970', light: '#A9ADE3' },   // DINKs with pets: indigo
  CUR: { base: '#92AF7C', edge: '#92AF7C', light: '#CBE0B7' },                      // Conscious Curators: sage
  FAM: { base: '#F9D968', edge: '#F9D968', light: '#F9E992' },                      // Busy Families: warm yellow
};
/** Any other persona: a neutral grey, so nothing reads as one of the three. */
export const NEUTRAL_PERSONA: PersonaColor = { base: '#6B7280', edge: '#858B96', light: '#C9CCD2' };

export function personaColor(code?: string | null): PersonaColor {
  return (code && PERSONA_COLORS[code]) || NEUTRAL_PERSONA;
}

/** `#RRGGBB` at an opacity, for fills and borders on the dark UI. */
export function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** A thin persona accent on the left edge of a card (pair with the `border-l-4` class). */
export const personaEdge = (code?: string | null): { borderLeftColor: string } => ({ borderLeftColor: personaColor(code).edge });
