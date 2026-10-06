// Ad naming codes: the one place the format is written down. Studio (Shortlist,
// Ready for production, the handoff pack), Pre-flight and the audit library
// all build and read codes through this file.
//
// Current form (proposed to Add3 on 29 Sep 2026, awaiting their confirmation):
//   PERSONA_TERRITORY_FORMAT_[visual][line]_REGION_PLATFORM[_YYMMDD]
//   FAM_SUMMER_ST_A2_US_META_261013 = Busy Families, Summer, static, visual A,
//   copy line 2, US, Meta, trafficked 13 Oct 2026. The date is added at
//   trafficking; Studio never writes it.
// Earlier form, still read everywhere (codes signed off before the change keep it):
//   PERSONA_TERRITORY_FORMAT_v#_PLATFORM[_YYMMDD]
//
//
// The ad and its copy options (Add3, 6 Oct 2026; to be confirmed by them on 8 Oct): Add3 run each visual as ONE ad
// carrying several text options, and report per ad only. So the ad's name for trafficking and reporting is the
// visual-level code, the form above without the line number:
//   PERSONA_TERRITORY_FORMAT_[visual]_REGION_PLATFORM[_YYMMDD]   e.g. FAM_SUMMER_ST_A_US_META_261020
// and A1, A2, A3 are that ad's copy options: Studio's own ids, never trafficked as separate ads. `adName` and
// `parseAdName` are the one definition of that; change them here if Add3 say otherwise.
//
// If Add3 ask for another order, change CODE_ORDER: building and reading both
// follow it. Tokens are case-insensitive; spaces and dashes read as underscores.

export const REGIONS = ['US', 'CA'] as const;
export type Region = typeof REGIONS[number];
export const DEFAULT_REGION: Region = 'US';
export const REGION_NAMES: Record<Region, string> = { US: 'US', CA: 'Canada' };
/** Copy lines per visual (Add3 call, 29 Sep): each runs as its own ad. Only a default: a visual can take more. */
export const LINES_PER_VISUAL = 3;

/** Format and platform codes, with the long names Studio's rules use. */
export const FORMAT_CODES: Record<string, string> = { ST: 'ST', STATIC: 'ST', CAR: 'CAR', CAROUSEL: 'CAR', VID: 'VID', VIDEO: 'VID', UGC: 'UGC', TT: 'TT', TIKTOK: 'TT' };
export const PLATFORM_CODES: Record<string, string> = { META: 'META', FB: 'META', IG: 'META', TT: 'TT', TIKTOK: 'TT' };

type Slot = 'persona' | 'territory' | 'format' | 'visual_line' | 'visual' | 'region' | 'platform' | 'version';
/** The current form, token by token. */
export const CODE_ORDER: Slot[] = ['persona', 'territory', 'format', 'visual_line', 'region', 'platform'];
/** The current form in words, for help text and errors. */
export const CURRENT_PATTERN = CODE_ORDER.map(x => (x === 'visual_line' ? '[visual][line]' : x.toUpperCase())).join('_');
/** The ad's name: the current form with the visual letter alone (no line number). It follows CODE_ORDER. */
const AD_ORDER: Slot[] = CODE_ORDER.map(x => (x === 'visual_line' ? 'visual' : x));
export const AD_PATTERN = AD_ORDER.map(x => (x === 'visual' ? '[visual]' : x.toUpperCase())).join('_');
/** The v# form, read only. */
const V_ORDER: Slot[] = ['persona', 'territory', 'format', 'version', 'platform'];

export interface CodeParts {
  persona: string;
  /** Without the persona prefix: SUMMER, not FAM_SUMMER. */
  territory: string;
  /** Any known format name; written as its short code (STATIC → ST). */
  format: string;
  visual: string;      // A-Z
  line: number;        // 1, 2, 3…
  region: Region;
  /** META or TT (TIKTOK reads as TT). */
  platform: string;
}

export interface ParsedCode {
  /** current: a copy option's code (A2); v#: the earlier form; ad: an ad's name (visual A, no line), only from parseAdName. */
  form: 'current' | 'v#' | 'ad';
  /** Canonical code, without date or suffix: the join key to Studio, Pre-flight, the audit and B3. */
  code: string;
  persona: string; territory: string; format: string; platform: string;
  /** Current form only. */
  visual?: string; line?: number; region?: Region;
  /** v# form only. */
  version?: number;
  /** ISO date from a trailing YYMMDD (or YYYYMMDD), if any. */
  date: string | null;
  /** Tokens after the platform and date. */
  suffix: string[];
}

const letter = (i: number) => String.fromCharCode(65 + i);
export const VISUAL_LETTERS = Array.from({ length: 26 }, (_, i) => letter(i));

/** The territory as it goes in a code: FAM_SUMMER → SUMMER. */
export function territoryToken(persona: string, territory: string): string {
  const p = persona.toUpperCase(), t = territory.toUpperCase();
  return t.startsWith(`${p}_`) ? t.slice(p.length + 1) : t;
}

function token(slot: Slot, c: CodeParts & { version?: number }): string {
  switch (slot) {
    case 'persona': return c.persona.toUpperCase();
    case 'territory': return territoryToken(c.persona, c.territory);
    case 'format': return FORMAT_CODES[c.format.toUpperCase()] || c.format.toUpperCase();
    case 'visual_line': return `${c.visual.toUpperCase()}${c.line}`;
    case 'visual': return c.visual.toUpperCase();
    case 'region': return c.region;
    case 'platform': return PLATFORM_CODES[c.platform.toUpperCase()] || c.platform.toUpperCase();
    case 'version': return `v${c.version}`;
  }
}

/** Build a code in the current form (never with a date: that's added at trafficking). */
export function formatCode(c: CodeParts): string {
  if (!/^[A-Z]$/i.test(c.visual)) throw new Error(`Visual must be one letter, A-Z (got "${c.visual}")`);
  if (!Number.isInteger(c.line) || c.line < 1 || c.line > 99) throw new Error(`Copy line must be 1-99 (got ${c.line})`);
  if (!REGIONS.includes(c.region)) throw new Error(`Region must be ${REGIONS.join(' or ')} (got "${c.region}")`);
  return CODE_ORDER.map(s => token(s, c)).join('_');
}

/** The code with its line number taken out: codes of one visual share it (FAM_SUMMER_ST_A_US_META). Null for v# codes. */
export function visualKey(raw: string): string | null {
  const p = parseCode(raw, null);
  if ('error' in p || p.form !== 'current') return null;
  return CODE_ORDER.map(s => (s === 'visual_line' ? p.visual! : token(s, { ...p, line: p.line!, visual: p.visual!, region: p.region! }))).join('_');
}

function dateOf(t: string): string | null {
  let y: number, mo: number, d: number;
  if (/^\d{6}$/.test(t)) { y = 2000 + Number(t.slice(0, 2)); mo = Number(t.slice(2, 4)); d = Number(t.slice(4, 6)); }
  else if (/^20\d{6}$/.test(t)) { y = Number(t.slice(0, 4)); mo = Number(t.slice(4, 6)); d = Number(t.slice(6, 8)); }
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}

const VALID: Record<Exclude<Slot, 'territory' | 'persona'>, (t: string) => boolean> = {
  format: t => !!FORMAT_CODES[t],
  visual_line: t => /^[A-Z]([1-9]\d?)$/.test(t),
  visual: t => /^[A-Z]$/.test(t),
  region: t => (REGIONS as readonly string[]).includes(t),
  platform: t => !!PLATFORM_CODES[t],
  version: t => /^V\d{1,3}$/.test(t),
};

function tryOrder(order: Slot[], t: string[], personas: string[] | null): ParsedCode | null {
  const k = order.indexOf('territory');
  const before = order.slice(0, k), after = order.slice(k + 1);
  const ok = (slot: Slot, tok: string | undefined) => tok !== undefined && (slot === 'persona' ? (!personas || personas.includes(tok)) && /^[A-Z]+$/.test(tok) : VALID[slot as keyof typeof VALID](tok));
  if (!before.every((s, i) => ok(s, t[i]))) return null;
  for (let len = 1; k + len + after.length <= t.length; len++) {
    const at = k + len;
    if (!after.every((s, i) => ok(s, t[at + i]))) continue;
    const v: Partial<Record<Slot, string>> = {};
    before.forEach((s, i) => { v[s] = t[i]; });
    after.forEach((s, i) => { v[s] = t[at + i]; });
    let terr = t.slice(k, at);
    if (terr[0] === v.persona && terr.length > 1) terr = terr.slice(1);   // FAM_FAM_SUMMER…
    const rest = t.slice(at + after.length);
    const date = rest.length ? dateOf(rest[0]) : null;
    if (date) rest.shift();
    const base = { persona: v.persona!, territory: terr.join('_'), format: FORMAT_CODES[v.format!], platform: PLATFORM_CODES[v.platform!], date, suffix: rest };
    if (order.includes('version')) {
      const version = Number(v.version!.slice(1));
      return { form: 'v#', ...base, version, code: order.map(s => token(s, { ...base, version, visual: 'A', line: 1, region: DEFAULT_REGION })).join('_') };
    }
    if (order.includes('visual')) {
      // An ad's name: no line number. `code` is the ad name itself (it is what Studio calls the visual key).
      const parts = { ...base, visual: v.visual!, line: 1, region: v.region as Region };
      return { form: 'ad', ...base, visual: v.visual!, region: v.region as Region, code: order.map(s => token(s, parts)).join('_') };
    }
    const m = /^([A-Z])(\d+)$/.exec(v.visual_line!)!;
    const parts = { ...base, visual: m[1], line: Number(m[2]), region: v.region as Region };
    return { form: 'current', ...parts, code: formatCode(parts) };
  }
  return null;
}

/**
 * Read a code in either form, with or without a trailing date or suffix. Pass
 * the known personas to check the first token (null: any capitals).
 */
export function parseCode(raw: string, personas: string[] | null = ['DINK', 'CUR', 'FAM']): ParsedCode | { error: string } {
  const s = String(raw ?? '').replace(/\.[a-z0-9]{2,4}$/i, '').trim().toUpperCase().replace(/[\s-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const t = s.split('_').filter(Boolean);
  if (personas && !personas.includes(t[0])) return { error: `persona "${t[0] ?? ''}" isn't one of ${personas.join(', ')}` };
  const hit = tryOrder(CODE_ORDER, t, personas) || tryOrder(V_ORDER, t, personas);
  if (hit) return hit;
  return { error: `no [visual][line] with a region, and no version (v#): expected ${CURRENT_PATTERN} (e.g. FAM_SUMMER_ST_A2_US_META) or the earlier PERSONA_TERRITORY_FORMAT_v#_PLATFORM` };
}

/** An ad as Add3 traffic and report it: its name, and what the name was read from. */
export interface ParsedAd {
  /** The ad's name without a date: PERSONA_TERRITORY_FORMAT_[visual]_REGION_PLATFORM (a v# code is its own ad). The join key for per-ad results. */
  ad: string;
  /** What was given: an ad name, or one copy option's code (then `option` is that code). */
  level: 'ad' | 'option';
  option?: string;
  persona: string; territory: string; format: string; platform: string;
  visual?: string; line?: number; region?: Region; version?: number;
  date: string | null; suffix: string[];
}
/**
 * Read an ad's name, or a copy option's code (either form), with or without a trailing date. A copy option reads as
 * the ad it belongs to: FAM_SUMMER_ST_A2_US_META and FAM_SUMMER_ST_A_US_META_261020 are both the ad FAM_SUMMER_ST_A_US_META.
 */
export function parseAdName(raw: string, personas: string[] | null = ['DINK', 'CUR', 'FAM']): ParsedAd | { error: string } {
  const opt = parseCode(raw, personas);
  if (!('error' in opt)) {
    const { form: _f, code, ...rest } = opt;
    return { ...rest, ad: visualKey(code) || code, level: 'option', option: code };
  }
  const s = String(raw ?? '').replace(/\.[a-z0-9]{2,4}$/i, '').trim().toUpperCase().replace(/[\s-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const t = s.split('_').filter(Boolean);
  if (personas && !personas.includes(t[0])) return { error: `persona "${t[0] ?? ''}" isn't one of ${personas.join(', ')}` };
  const hit = tryOrder(AD_ORDER, t, personas);
  if (!hit) return { error: `not an ad name (${AD_PATTERN}, e.g. FAM_SUMMER_ST_A_US_META) or a copy option's code (${CURRENT_PATTERN})` };
  const { form: _f, code, ...rest } = hit;
  return { ...rest, ad: code, level: 'ad' };
}
/** The name of the ad a code belongs to (the code itself if it can't be read): what goes to Add3 and what results come back under. */
export function adName(code: string): string {
  const p = parseAdName(code, null);
  return 'error' in p ? code : p.ad;
}

/** Region of a code: the current form's, or US for a v# code (they were all US). */
export function regionOf(raw: string): Region {
  const p = parseCode(raw, null);
  return 'error' in p || !p.region ? DEFAULT_REGION : p.region;
}
