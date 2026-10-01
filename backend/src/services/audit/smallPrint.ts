// Legal small print on an asset isn't ad copy: the figure and copy-rule checks skip it (production test, 1 Oct: a red
// FIG_UNSOURCED for "6100", from Trupanion's address "6100 4th Ave S…" in the small print). Only the disclaimer check
// reads it. Lines (and sentences within them) that are the approved disclaimer, or look like small print, are removed.
//
// The OCR gives a card's small print as ONE long line, worded differently per size ("© 2023 Trupanion. 6100-4th Ave S,
// Seattle, WA 98108. Underwritten in Canada by…"), so line-by-line patterns missed the address. Small print sits at
// the end of a card: from the first sentence carrying a legal MARKER, the rest of the line is small print. Copy
// before it on the same line is still checked.

const SMALL_PRINT = [
  /registered trademark|®|™|©/i,
  /\bunderwrit(ten|er|ing)\b|insurance company of|insurance services/i,
  /\blicen[cs]e(d)?\b.{0,12}(no\.?|number|#|\d)/i,
  /\b(NAIC|NMLS)\b/,
  // A street address: "6100 4th Ave S, Seattle", "123 Main Street, …" (a house number, a street word, then a comma: never
  // a figure in the copy like "7,000 owners switched their way").
  /(?<![\d,$.])\b\d{2,6}\s+(\w+\s+){0,2}(ave(nue)?|st(reet)?|blvd|boulevard|rd|road|drive|dr|lane|ln)\b\.?(\s+[NSEW]{1,2}\b)?\s*,/i,
  /\b(suite|ste\.?)\s+\d+/i,
  // A phone number: "(855) 210-0047", "1-855-210-0047", "855.210.0047".
  /(\b1[-.\s])?\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/,
  /terms (and|&) conditions|see (your )?policy|policy for (full )?details|exclusions (may )?apply|not available in all/i,
];

/** Unmistakable legal wording: where a card's small print starts. */
const MARKER = /©|\(c\)\s*\d{4}|\bunderwrit(ten|er|ing)\b|registered trademark|terms (and|&) conditions apply|see (your )?policy for (full )?details|all rights reserved/i;
/** A US ZIP after a state code ("WA 98108"), or a street number joined to its street ("6100-4th Ave S", "6100-6th Avenue South"). */
const ADDRESS = /\b[A-Z]{2}\s+\d{5}(-\d{4})?\b|(?<![\d,$.])\b\d{2,6}[-\s]+\d+(st|nd|rd|th)\s+(ave(nue)?|st(reet)?|blvd|boulevard|rd|road|drive|dr|lane|ln)\b/;

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9$% ]+/g, ' ').split(/\s+/).filter(w => w.length > 2);

/** Is this piece of text small print (the disclaimer, or a legal line)? */
export function isSmallPrint(piece: string, disclaimer?: string): boolean {
  if (SMALL_PRINT.some(re => re.test(piece)) || MARKER.test(piece) || ADDRESS.test(piece)) return true;
  if (disclaimer && disclaimer.trim()) {
    const want = new Set(words(disclaimer)), have = words(piece);
    if (have.length >= 4 && have.filter(w => want.has(w)).length / have.length >= 0.6) return true;
  }
  return false;
}

/** The text without its small print: whole lines, or sentences within a line, that are small print. */
export function withoutSmallPrint(text: string, disclaimer?: string): string {
  return text.split(/\n/).map(line => {
    if (isSmallPrint(line, disclaimer) && !/[.!?]\s+\S/.test(line)) return '';
    // Sentences: keep the ad copy in a line that also carries small print; from the first legal marker on, it's all
    // small print (the paragraph at the end of a card).
    const sentences = line.split(/(?<=[.!?])\s+/);
    const from = sentences.findIndex(s => MARKER.test(s));
    return (from >= 0 ? sentences.slice(0, from) : sentences).filter(s => !isSmallPrint(s, disclaimer)).join(' ');
  }).filter(l => l.trim()).join('\n');
}
