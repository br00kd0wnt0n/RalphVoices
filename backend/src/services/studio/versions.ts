// Live versions: one naming code = one ad (Brook, 30 Sep). Add3 run up to three
// copy versions per visual, each as its own ad, and a version is a SET of
// fields: Meta primary text + headline (+ description), or a TikTok caption
// (+ hook). At Ready for production the creative lead builds the versions from
// the kept lines (a line can be reused across versions: one headline in A1 and
// A2), and each version gets one code, PERSONA_TERRITORY_FORMAT_<visual><version>_REGION_PLATFORM.
// Text on the image (meta_on_image) belongs to the visual, not a version: one
// per visual letter, added to the copy of every code on that visual.
//
// Stored in the sign-off body (JSONB; no migration): `versions` and `on_image`.
// Sign-offs from before this have one code per line: signoffVersions() reads
// those as one-field versions, so old codes keep working everywhere.

import type { Line, Rules } from './engine.js';
import { fieldFitsFormat } from './fieldFormats.js';
import { CodeBook, regionOf } from './codes.js';
import { LINES_PER_VISUAL, PLATFORM_CODES, VISUAL_LETTERS, formatCode, parseCode, visualKey, type Region } from '../../utils/namingCode.js';

/** How a field takes part in a version: required in every version of its platform, optional, or once per visual (text on the image). */
export type FieldRole = 'required' | 'optional' | 'per_visual';
/** Default roles, until the rules say otherwise (a field's `in_version`). */
const DEFAULT_REQUIRED = new Set(['meta_primary', 'meta_headline', 'tiktok_caption']);
export function fieldRole(field: string, rules: Pick<Rules, 'fields'>): FieldRole {
  const f: any = rules.fields[field];
  if (f?.in_version === 'required' || f?.in_version === 'optional' || f?.in_version === 'per_visual') return f.in_version;
  if (/on_image/.test(field)) return 'per_visual';
  return DEFAULT_REQUIRED.has(field) ? 'required' : 'optional';
}
/**
 * On-image text comes as a headline and, optionally, a subhead under it (rules v2.14 meta_on_image_sub; a field whose
 * `on_image_role` is 'sub', or whose id ends in _sub). Both are per visual (per card on a carousel); the draft keeps the
 * subheads in `on_image_sub`, and the plan and sign-off list both, each entry naming its field.
 */
export function isSubField(field: string, rules: Pick<Rules, 'fields'>): boolean {
  const f: any = rules.fields[field];
  return f?.on_image_role === 'sub' || (f?.on_image_role !== 'headline' && /_sub$/.test(field));
}

/** META or TT, from a field's platform in the rules. */
export const platformOf = (field: string, rules: Pick<Rules, 'fields'>) => PLATFORM_CODES[String(rules.fields[field]?.platform || 'META').toUpperCase()] || 'META';
/** The fields a version of a platform can have, in the rules' order, split by role. */
/** `format`: the territory's, so fields that belong to other formats are left out (a static has no script slot). */
export function versionFields(platform: string, rules: Pick<Rules, 'fields'>, format?: string) {
  const all = Object.keys(rules.fields).filter(f => platformOf(f, rules) === platform && fieldFitsFormat(f, format, rules));
  const required = all.filter(f => fieldRole(f, rules) === 'required');
  return {
    // A platform with none of the usual required fields in the rules needs at least one field.
    required,
    optional: all.filter(f => fieldRole(f, rules) === 'optional'),
    per_visual: all.filter(f => fieldRole(f, rules) === 'per_visual'),
  };
}

/** One line in a signed-off version (or on-image entry): which wording, exactly. */
export interface SignedField { line_id: string; batch_id: string; version: number; sha256: string; field: string; text: string; chars: number; overrides: Line['overrides'] }
export interface SignedVersion { code: string; visual: string; number: number; platform: string; fields: Record<string, SignedField> }
/** Text on the image of a visual; on a carousel, one per card (card 1…N, in order). */
export interface SignedOnImage extends SignedField { visual: string; visual_key: string; card?: number }

/** A sign-off's versions: stored ones, or (sign-offs from before versions) one per line, under that line's own code. */
export function signoffVersions(s: { versions?: SignedVersion[]; lines?: Array<SignedField & { stub: string }> }): SignedVersion[] {
  if (s.versions) return s.versions;
  return (s.lines || []).map(l => {
    const p = parseCode(l.stub, null);
    const ok = !('error' in p);
    return { code: l.stub, visual: ok ? p.visual || '' : '', number: ok ? p.line ?? p.version ?? 0 : 0, platform: ok ? p.platform : '', fields: { [l.field]: l } };
  });
}
export function signoffOnImage(s: { on_image?: SignedOnImage[] }): SignedOnImage[] { return s.on_image || []; }

// ---------- carousels (item E, 30 Sep): on-image text per card ----------

/** A carousel's cards: 4 by default, up to 10. */
export const DEFAULT_CARDS = 4;
export const MAX_CARDS = 10;
export const isCarousel = (format: string) => /^CAR/i.test(format || '');

// ---------- planning (Ready's preview, and the sign-off itself) ----------

/**
 * What the screen sends: versions in order (visual letter, field → line id), and the on-image text per visual letter:
 * a line id, or on a carousel the cards in order (card 1 first; '' for a card with no text).
 */
export interface DraftVersion { visual: string; fields: Record<string, string>; platform?: string }
export interface Draft { versions: DraftVersion[]; on_image: Record<string, string | string[]>; /** The subhead under each on-image headline, same shape (per card on a carousel). */ on_image_sub?: Record<string, string | string[]> }
export interface PlannedVersion extends DraftVersion { code: string; number: number; platform: string; issues: string[] }
/** sub: the subhead (on_image_sub), not the on-image headline. */
export interface PlannedOnImage { visual: string; visual_key: string; line_id: string; card?: number; sub?: boolean; issues: string[] }
export interface Plan { versions: PlannedVersion[]; on_image: PlannedOnImage[]; issues: string[] }

/** suffix: '_TEST' for a test round's codes (rounds.ts), so they never reach Add3 or share a code with a real round. */
interface Ctx { persona: string; territory: string; region: Region; format: string; rules: Pick<Rules, 'fields'>; suffix?: string }

/**
 * The versions a set of kept lines would make if nobody changed anything: the last sign-off's, if there is one;
 * otherwise, per platform, the required fields' lines paired in the order they were written (a field with fewer
 * lines reuses them), three versions to a visual, and one on-image line per visual.
 */
export function defaultDraft(lines: Line[], rules: Pick<Rules, 'fields'>, latest?: { versions?: SignedVersion[]; on_image?: SignedOnImage[]; lines?: any[] } | null, format = ''): Draft {
  const kept = new Set(lines.map(l => l.id));
  if (latest) {
    const vs = signoffVersions(latest as any).filter(v => Object.values(v.fields).every(f => kept.has(f.line_id)));
    if (vs.length) {
      return {
        versions: vs.map(v => ({ visual: v.visual || 'A', platform: v.platform, fields: Object.fromEntries(Object.entries(v.fields).map(([k, f]) => [k, f.line_id])) })),
        on_image: onImageDraft(signoffOnImage(latest as any).filter(o => kept.has(o.line_id) && !isSubField(o.field, rules))),
        on_image_sub: onImageDraft(signoffOnImage(latest as any).filter(o => kept.has(o.line_id) && isSubField(o.field, rules))),
      };
    }
  }
  const byField = new Map<string, Line[]>();
  for (const l of lines) byField.set(l.field, [...(byField.get(l.field) || []), l]);
  const versions: DraftVersion[] = [];
  const on_image: Draft['on_image'] = {};
  const on_image_sub: Draft['on_image'] = {};
  for (const platform of [...new Set(lines.map(l => platformOf(l.field, rules)))].sort()) {
    const vf = versionFields(platform, rules, format);
    const lead = vf.required.length ? vf.required : [...vf.optional];
    const n = Math.max(0, ...lead.map(f => byField.get(f)?.length || 0));
    for (let i = 0; i < n; i++) {
      const fields: Record<string, string> = {};
      for (const f of [...vf.required, ...vf.optional]) {
        const ls = byField.get(f) || [];
        if (!ls.length) continue;
        if (vf.required.includes(f)) fields[f] = ls[i % ls.length].id;
        else if (i < ls.length) fields[f] = ls[i].id;
      }
      versions.push({ visual: VISUAL_LETTERS[Math.floor(i / LINES_PER_VISUAL)], platform, fields });
    }
    const hasVisual = (v: string, f: string) => versions.some(x => x.visual === v && (x.platform || platform) === platformOf(f, rules));
    if (isCarousel(format)) {
      // A carousel visual takes a whole card sequence (as written), then any loose on-image lines as cards.
      for (const f of vf.per_visual.filter(x => !isSubField(x, rules))) {
        const ls = byField.get(f) || [];
        const seqs: string[][] = [];
        const bySeq = new Map<string, Line[]>();
        for (const l of ls) if (l.sequence_id) bySeq.set(l.sequence_id, [...(bySeq.get(l.sequence_id) || []), l]);
        for (const g of bySeq.values()) seqs.push(g.sort((a, b) => (a.card || 0) - (b.card || 0)).map(l => l.id));
        const loose = ls.filter(l => !l.sequence_id).map(l => l.id);
        for (let i = 0; i < loose.length; i += DEFAULT_CARDS) seqs.push(loose.slice(i, i + DEFAULT_CARDS));
        seqs.forEach((cards, i) => { const v = VISUAL_LETTERS[i]; if (!on_image[v] && hasVisual(v, f)) on_image[v] = cards.slice(0, MAX_CARDS); });
      }
      // A card's subhead (pasted with its card number, in the same sequence) sits under its card.
      for (const f of vf.per_visual.filter(x => isSubField(x, rules))) {
        for (const l of (byField.get(f) || []).filter(x => x.card && x.sequence_id)) {
          const v = Object.keys(on_image).find(k => Array.isArray(on_image[k]) && (on_image[k] as string[]).some(id => lines.find(y => y.id === id)?.sequence_id === l.sequence_id));
          if (!v || !(on_image[v] as string[])[l.card! - 1]) continue;
          const subs = Array.isArray(on_image_sub[v]) ? on_image_sub[v] as string[] : [];
          while (subs.length < l.card!) subs.push('');
          subs[l.card! - 1] = l.id;
          on_image_sub[v] = subs;
        }
      }
    } else {
      // A headline per visual, and a subhead under it where there are subheads.
      for (const f of vf.per_visual) {
        const slot = isSubField(f, rules) ? on_image_sub : on_image;
        (byField.get(f) || []).forEach((l, i) => { const v = VISUAL_LETTERS[i]; if (!slot[v] && hasVisual(v, f)) slot[v] = l.id; });
      }
    }
  }
  return { versions, on_image, ...(Object.keys(on_image_sub).length ? { on_image_sub } : {}) };
}

/** Signed-off on-image text back into the draft's shape: a line per visual, or a carousel's cards in order. */
function onImageDraft(list: SignedOnImage[]): Draft['on_image'] {
  const out: Draft['on_image'] = {};
  for (const o of list) {
    if (!o.card) { out[o.visual] = o.line_id; continue; }
    const cards = Array.isArray(out[o.visual]) ? out[o.visual] as string[] : [];
    while (cards.length < o.card) cards.push('');
    cards[o.card - 1] = o.line_id;
    out[o.visual] = cards;
  }
  return out;
}

/**
 * Check a draft and give each version its code. A version with exactly the same lines as one in the last sign-off
 * keeps that code; any other version gets the next free number on its visual (codes signed off anywhere are never
 * handed out again). Issues say what's missing; a sign-off with any issue is refused.
 */
export function planDraft(draft: Draft, lines: Line[], ctx: Ctx, signedCodes: string[], latest?: { versions?: SignedVersion[]; lines?: any[] } | null): Plan {
  const byId = new Map(lines.map(l => [l.id, l]));
  const r = ctx.rules;
  const issues: string[] = [];
  const book = new CodeBook(signedCodes);
  const previous = latest ? signoffVersions(latest as any) : [];
  const sameLines = (a: Record<string, string>, b: SignedVersion) => {
    const ka = Object.keys(a).sort(), kb = Object.keys(b.fields).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b.fields[k].line_id);
  };
  const planned: PlannedVersion[] = [];
  const used = new Set<string>();
  for (const [i, d] of (draft.versions || []).entries()) {
    const vIssues: string[] = [];
    const visual = String(d.visual || '').trim().toUpperCase();
    if (!/^[A-Z]$/.test(visual)) vIssues.push(`version ${i + 1}: a visual is one letter`);
    const fields: Record<string, string> = {};
    for (const [f, id] of Object.entries(d.fields || {})) {
      if (!id) continue;
      const l = byId.get(id);
      if (!l) { vIssues.push(`${id} isn't a kept line of this set`); continue; }
      if (l.field !== f) { vIssues.push(`${id} is ${r.fields[l.field]?.label || l.field}, not ${r.fields[f]?.label || f}`); continue; }
      if (fieldRole(f, r) === 'per_visual') { vIssues.push(`${r.fields[f]?.label || f} goes with the visual, not a version`); continue; }
      fields[f] = id;
    }
    const platforms = [...new Set(Object.keys(fields).map(f => platformOf(f, r)))];
    const platform = platforms[0] || d.platform || 'META';
    if (platforms.length > 1) vIssues.push('a version is for one platform (Meta or TikTok), not both');
    const vf = versionFields(platform, r, ctx.format);
    const missing = (vf.required.length ? vf.required : []).filter(f => !fields[f]);
    if (!Object.keys(fields).length) vIssues.push('no lines chosen');
    else if (missing.length) vIssues.push(`needs ${missing.map(f => (r.fields[f]?.label || f).replace(/^(Meta|TikTok) /, '').toLowerCase()).join(' and ')}`);
    // Its code: the same lines as before keep their code; otherwise the next free number on the visual.
    let code = '';
    // (A code from before versions has no visual letter: it matches on its lines alone.)
    const prev = previous.find(p => (p.visual === visual || !p.visual) && (p.platform === platform || !p.platform) && !used.has(p.code) && sameLines(fields, p));
    if (prev) { code = prev.code; used.add(code); book.take(code); }
    else if (/^[A-Z]$/.test(visual)) code = book.assign({ persona: ctx.persona, territory: ctx.territory, format: ctx.format, platform, region: ctx.region }, visual, ctx.suffix);
    const p = parseCode(code, null);
    planned.push({ visual, platform, fields, code, number: 'error' in p ? 0 : p.line ?? 0, issues: vIssues });
    for (const x of vIssues) issues.push(`${code || `Version ${i + 1}`}: ${x}`);
  }
  const on_image: Plan['on_image'] = [];
  const subs = Object.entries(draft.on_image_sub || {}).map(([v, val]) => [v, val, true] as const);
  for (const [v0, val, sub] of [...Object.entries(draft.on_image || {}).map(([v, x]) => [v, x, false] as const), ...subs]) {
    const visual = v0.toUpperCase();
    const cards = Array.isArray(val);
    const ids = cards ? val as string[] : [val as string];
    if (cards && !isCarousel(ctx.format)) { issues.push(`On-image, visual ${visual}: only a carousel has cards`); continue; }
    if (cards && ids.length > MAX_CARDS && !sub) issues.push(`On-image, visual ${visual}: at most ${MAX_CARDS} cards`);
    // A carousel with a blank card isn't finished (production test, 1 Oct: signed off with card 2 cleared). Set fewer
    // cards, or choose its text. Subheads are optional, card by card.
    if (cards && !sub && ids.some(Boolean)) ids.slice(0, MAX_CARDS).forEach((id, i) => { if (!id) issues.push(`On-image, visual ${visual}: card ${i + 1} is empty (choose its text, or set fewer cards)`); });
    const heads = draft.on_image?.[v0];
    ids.slice(0, MAX_CARDS).forEach((id, i) => {
      if (!id) return;
      const where = `${cards ? `visual ${visual}, card ${i + 1}` : `visual ${visual}`}${sub ? ' (subhead)' : ''}`;
      const oIssues: string[] = [];
      const l = byId.get(id);
      if (!l) oIssues.push(`${id} isn't a kept line of this set`);
      else if (fieldRole(l.field, r) !== 'per_visual') oIssues.push(`${r.fields[l.field]?.label || l.field} isn't on-image text`);
      else if (isSubField(l.field, r) !== sub) oIssues.push(sub ? `${r.fields[l.field]?.label || l.field} is a headline, not a subhead` : `${r.fields[l.field]?.label || l.field} is a subhead: it goes under the headline`);
      // A subhead sits under a headline: on a carousel, under that card's.
      if (sub && !(cards ? Array.isArray(heads) && heads[i] : typeof heads === 'string' && heads)) oIssues.push(cards ? `card ${i + 1} has a subhead but no headline` : 'a subhead needs an on-image headline above it');
      const platform = l ? platformOf(l.field, r) : 'META';
      if (!planned.some(x => x.visual === visual && x.platform === platform)) oIssues.push(`there's no ${platform === 'TT' ? 'TikTok' : 'Meta'} version on visual ${visual}`);
      const key = /^[A-Z]$/.test(visual) ? visualKey(formatCode({ persona: ctx.persona, territory: ctx.territory, format: ctx.format, platform, region: ctx.region, visual, line: 1 }))! : '';
      on_image.push({ visual, visual_key: key, line_id: id, ...(cards ? { card: i + 1 } : {}), ...(sub ? { sub: true } : {}), issues: oIssues });
      for (const x of oIssues) issues.push(`On-image, ${where}: ${x}`);
    });
  }
  if (!planned.length) issues.push('Build at least one version');
  return { versions: planned, on_image, issues };
}

/**
 * A line's compliance status for one code. Set at the Compliance step per code (compliance_by_code); a status set per
 * line before versions (30 Sep) counts for the code it was given with, or for any code if it names none.
 */
export function complianceFor(l: Pick<Line, 'compliance' | 'compliance_by_code'>, code: string) {
  return l.compliance_by_code?.[code] ?? (l.compliance && (!l.compliance.code || l.compliance.code === code) ? l.compliance : undefined);
}

/** The region of a set of lines (they share one). */
export const regionOfLines = (lines: Line[]): Region => regionOf(lines[0] || {});
