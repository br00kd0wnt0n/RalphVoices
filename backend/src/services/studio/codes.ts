// Naming codes for Studio lines (the format itself is in utils/namingCode.ts).
//
// A code is fixed when a line is signed off Ready for production, and belongs
// to that line for good (B3b joins live results on it; Add3 traffic by it).
// Before that, Shortlist and Ready show the code the line would get now.
//
// The visual letter is chosen at sign-off: by default lines are packed three
// to a visual (A1 A2 A3, B1…) in the order they were written; the creative
// lead can move a line to another letter before signing off. Pre-flight then
// suggests the codes sharing a letter as one upload. Codes signed off before
// the change (the v# form) are kept as they are.

import { DEFAULT_REGION, LINES_PER_VISUAL, VISUAL_LETTERS, formatCode, parseCode, visualKey, type Region } from '../../utils/namingCode.js';

export interface CodeInput { persona: string; territory: string; format: string; platform: string; region: Region }

/** A line's region: its own, else its run's brief, else US (everything before regions was US). */
export const regionOf = (l: { region?: Region }, brief?: { region?: Region }): Region => l.region || brief?.region || DEFAULT_REGION;

/** Codes already owned (signed off), and the ones handed out while building one view. */
export class CodeBook {
  private used = new Map<string, Set<number>>();      // visual key → line numbers taken

  constructor(signed: string[] = []) {
    for (const c of signed) this.take(c);
  }

  /** Mark a code as taken (signed off, or just handed out). v# codes take nothing in the current form. */
  take(code: string) {
    const k = visualKey(code);
    const p = parseCode(code, null);
    if (k && !('error' in p)) this.used.set(k, (this.used.get(k) || new Set()).add(p.line!));
  }

  /**
   * The code for a line not yet signed off. With `visual`, the next free line
   * number on that visual; without, the first visual with fewer than three lines.
   */
  assign(l: CodeInput, visual?: string, suffix = ''): string {
    const base = { persona: l.persona, territory: l.territory, format: l.format, platform: l.platform, region: l.region };
    const letters = visual ? [visual.toUpperCase()] : VISUAL_LETTERS;
    for (const v of letters) {
      const key = visualKey(formatCode({ ...base, visual: v, line: 1 }))!;
      const taken = this.used.get(key) || new Set<number>();
      if (!visual && taken.size >= LINES_PER_VISUAL) continue;
      let n = 1;
      while (taken.has(n)) n++;
      const code = formatCode({ ...base, visual: v, line: n }) + suffix;
      this.take(code);
      return code;
    }
    throw new Error(`No free visual letter for ${l.persona} ${l.territory}`);
  }
}

/** Check a letter chosen on the Ready screen. */
export function visualLetter(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim().toUpperCase();
  if (!/^[A-Z]$/.test(s)) throw new Error(`A visual is one letter, A to Z (got "${v}")`);
  return s;
}
