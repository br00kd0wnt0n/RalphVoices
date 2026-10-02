// Plain names for flags, as the Studio page's chips say them (the page's copy: frontend/src/lib/studioChips.ts; a test
// keeps the two the same). Used where the server writes for people: the copy worksheet.
export const CHIP: Record<string, string> = {
  LIMIT_VISIBLE: 'cut off on screen', LIMIT_MAX: 'too long for the field', LIMIT_ON_ASSET: 'long for the image', SHARED_CTA: 'no call to action', NEAR_DUP: 'similar line', CL_GLANCE: 'not a glance read', CL_PRODUCT: 'product unclear',
  COMP_UGC_MEMBER: 'cast a member', COMP_VERBATIM: 'verbatim quote', FIG_UNSOURCED: 'unsourced figure', FIG_CITATION: 'needs citation', FIG_ATTRIBUTION: 'misattributed figure',
  COMP_DIRECT_PAY: 'direct pay caveat', COMP_PAYS_FOR_ITSELF: 'pays for itself', COMP_PAID_SHARE: 'whole bill', COMP_PREEXISTING: 'pre-existing', COMP_ROUTINE: 'routine care',
  COMP_CLAIM_SPEED: 'claim speed', COMP_CHEAP_LOCKED: 'cheap / locked price', COMP_PRICE_LEAD: 'price lead', COMP_COVERAGE_CAVEAT: 'coverage caveat', COMP_SUPERLATIVE: 'superlative',
  COMP_FACT_FRAMING: 'figure framing', BR_NAMING: '"pet insurance"', BR_CASE: 'all caps', BR_BOAST: 'boastful', BR_PLAIN: 'not plain', BR_SAD_PET: 'sad pet', CHECK_FAILED: 'check failed',
};
export const chipName = (rule: string) => CHIP[rule] || (rule.startsWith('BRIEF_BANNED:') ? `banned: ${rule.slice(13)}` : /^[A-Z]+_T_/.test(rule) ? `turn-off: ${rule.replace(/^[A-Z]+_T_/, '').replace(/_/g, ' ').toLowerCase()}` : rule.replace(/_/g, ' ').toLowerCase());
