// Live versions: one naming code = one ad (Brook, 1 Oct). Add3 run up to three
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
/** META or TT, from a field's platform in the rules. */
export const platformOf = (field: string, rules: Pick<Rules, 'fields'>) => PLATFORM_CODES[String(rules.fields[field]?.platform || 'META').toUpperCase()] || 'META';
/** The fields a version of a platform can have, in the rules' order, split by role. */
export function versionFields(platform: string, rules: Pick<Rules, 'fields'>) {
  const all = Object.keys(rules.fields).filter(f => platformOf(f, rules) === platform);
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
export interface SignedOnImage extends SignedField { visual: string; visual_key: string }

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

// ---------- planning (Ready's preview, and the sign-off itself) ----------

/** What the screen sends: versions in order (visual letter, field → line id), and the on-image line per visual letter. */
export interface DraftVersion { visual: string; fields: Record<string, string>; platform?: string }
export interface Draft { versions: DraftVersion[]; on_image: Record<string, string> }
export interface PlannedVersion extends DraftVersion { code: string; number: number; platform: string; issues: string[] }
export interface Plan { versions: PlannedVersion[]; on_image: Array<{ visual: string; visual_key: string; line_id: string; issues: string[] }>; issues: string[] }

interface Ctx { persona: string; territory: string; region: Region; format: string; rules: Pick<Rules, 'fields'> }

/**
 * The versions a set of kept lines would make if nobody changed anything: the last sign-off's, if there is one;
 * otherwise, per platform, the required fields' lines paired in the order they were written (a field with fewer
 * lines reuses them), three versions to a visual, and one on-image line per visual.
 */
export function defaultDraft(lines: Line[], rules: Pick<Rules, 'fields'>, latest?: { versions?: SignedVersion[]; on_image?: SignedOnImage[]; lines?: any[] } | null): Draft {
  const kept = new Set(lines.map(l => l.id));
  if (latest) {
    const vs = signoffVersions(latest as any).filter(v => Object.values(v.fields).every(f => kept.has(f.line_id)));
    if (vs.length) {
      return {
        versions: vs.map(v => ({ visual: v.visual || 'A', platform: v.platform, fields: Object.fromEntries(Object.entries(v.fields).map(([k, f]) => [k, f.line_id])) })),
        on_image: Object.fromEntries(signoffOnImage(latest as any).filter(o => kept.has(o.line_id)).map(o => [o.visual, o.line_id])),
      };
    }
  }
  const byField = new Map<string, Line[]>();
  for (const l of lines) byField.set(l.field, [...(byField.get(l.field) || []), l]);
  const versions: DraftVersion[] = [];
  const on_image: Record<string, string> = {};
  for (const platform of [...new Set(lines.map(l => platformOf(l.field, rules)))].sort()) {
    const vf = versionFields(platform, rules);
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
    vf.per_visual.forEach(f => (byField.get(f) || []).forEach((l, i) => {
      const v = VISUAL_LETTERS[i];
      if (!on_image[v] && versions.some(x => x.visual === v && (x.platform || platform) === platformOf(f, rules))) on_image[v] = l.id;
    }));
  }
  return { versions, on_image };
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
    const vf = versionFields(platform, r);
    const missing = (vf.required.length ? vf.required : []).filter(f => !fields[f]);
    if (!Object.keys(fields).length) vIssues.push('no lines chosen');
    else if (missing.length) vIssues.push(`needs ${missing.map(f => (r.fields[f]?.label || f).replace(/^(Meta|TikTok) /, '').toLowerCase()).join(' and ')}`);
    // Its code: the same lines as before keep their code; otherwise the next free number on the visual.
    let code = '';
    // (A code from before versions has no visual letter: it matches on its lines alone.)
    const prev = previous.find(p => (p.visual === visual || !p.visual) && (p.platform === platform || !p.platform) && !used.has(p.code) && sameLines(fields, p));
    if (prev) { code = prev.code; used.add(code); book.take(code); }
    else if (/^[A-Z]$/.test(visual)) code = book.assign({ persona: ctx.persona, territory: ctx.territory, format: ctx.format, platform, region: ctx.region }, visual);
    const p = parseCode(code, null);
    planned.push({ visual, platform, fields, code, number: 'error' in p ? 0 : p.line ?? 0, issues: vIssues });
    for (const x of vIssues) issues.push(`${code || `Version ${i + 1}`}: ${x}`);
  }
  const on_image: Plan['on_image'] = [];
  for (const [v0, id] of Object.entries(draft.on_image || {})) {
    if (!id) continue;
    const visual = v0.toUpperCase();
    const oIssues: string[] = [];
    const l = byId.get(id);
    if (!l) oIssues.push(`${id} isn't a kept line of this set`);
    else if (fieldRole(l.field, r) !== 'per_visual') oIssues.push(`${r.fields[l.field]?.label || l.field} isn't on-image text`);
    const platform = l ? platformOf(l.field, r) : 'META';
    if (!planned.some(x => x.visual === visual && x.platform === platform)) oIssues.push(`there's no ${platform === 'TT' ? 'TikTok' : 'Meta'} version on visual ${visual}`);
    const key = /^[A-Z]$/.test(visual) ? visualKey(formatCode({ persona: ctx.persona, territory: ctx.territory, format: ctx.format, platform, region: ctx.region, visual, line: 1 }))! : '';
    on_image.push({ visual, visual_key: key, line_id: id, issues: oIssues });
    for (const x of oIssues) issues.push(`On-image, visual ${visual}: ${x}`);
  }
  if (!planned.length) issues.push('Build at least one version');
  return { versions: planned, on_image, issues };
}

/**
 * A line's compliance status for one code. Set at the Compliance step per code (compliance_by_code); a status set per
 * line before versions (1 Oct) counts for the code it was given with, or for any code if it names none.
 */
export function complianceFor(l: Pick<Line, 'compliance' | 'compliance_by_code'>, code: string) {
  return l.compliance_by_code?.[code] ?? (l.compliance && (!l.compliance.code || l.compliance.code === code) ? l.compliance : undefined);
}

/** The region of a set of lines (they share one). */
export const regionOfLines = (lines: Line[]): Region => regionOf(lines[0] || {});
