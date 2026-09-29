// B3: ad names by the convention agreed with Add3. The forms are in config
// (naming.forms); on 29 Sep 2026 they are
//   PERSONA_TERRITORY_FORMAT_[visual][line]_REGION_PLATFORM_YYMMDD  e.g. FAM_SUMMER_ST_A2_US_META_261013
//   PERSONA_TERRITORY_FORMAT_v#_PLATFORM_YYMMDD (the first form; still accepted)  e.g. FAM_SUMMER_ST_v2_META_261013
// Tolerates case, stray spaces, Studio's long format names, Meta's " - Copy"
// and extra suffixes after the date. Anything else fails with a reason; the
// caller quarantines it (never drops it).
import type { WeeklyConfig } from './config.js';

export interface ParsedName {
  ok: true;
  persona: string;
  territory: string;
  format: string;
  version: number;          // v# in the older form; the copy line in the newer one
  visual: string | null;    // the visual letter (A, B…), newer form only
  line: number | null;      // the copy line on that visual, newer form only
  region: string | null;    // US / CA, newer form only
  platform: string;
  date: string | null;      // ISO yyyy-mm-dd, the delivery date
  suffix: string[];         // tokens after the date
  stub: string;             // the name without the date: the join key to Studio and the audit
  asset: string;            // the visual: PERSONA_TERRITORY_FORMAT(_A in the newer form)
  form: number;             // which config form matched (0 = the first)
  warnings: string[];
}
export interface BadName { ok: false; reason: string; normalized: string }
export type NameResult = ParsedName | BadName;

type Naming = WeeklyConfig['naming'];

function aliasIndex(map: Record<string, string[]>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [code, aliases] of Object.entries(map)) {
    m.set(code.toUpperCase(), code);
    for (const a of aliases) m.set(a.toUpperCase(), code);
  }
  return m;
}

// YYMMDD (the convention) or YYYYMMDD (accepted with a warning). Returns ISO or null.
export function parseDateToken(t: string): { iso: string; long: boolean } | null {
  let y: number, mo: number, d: number, long = false;
  if (/^\d{6}$/.test(t)) { y = 2000 + Number(t.slice(0, 2)); mo = Number(t.slice(2, 4)); d = Number(t.slice(4, 6)); }
  else if (/^20\d{6}$/.test(t)) { y = Number(t.slice(0, 4)); mo = Number(t.slice(4, 6)); d = Number(t.slice(6, 8)); long = true; }
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { iso: dt.toISOString().slice(0, 10), long };
}

export function normalizeName(raw: string): { s: string; warnings: string[]; copy: string | null } {
  const warnings: string[] = [];
  let s = String(raw ?? '').replace(/[​-‍﻿]/g, '').trim();
  let copy: string | null = null;
  // Meta's duplicate: "NAME - Copy", "NAME – Copy 2"
  const cm = /\s*[-–—]\s*copy(?:\s*(\d+))?\s*$/i.exec(s);
  if (cm) { copy = `COPY${cm[1] || ''}`; s = s.slice(0, cm.index); warnings.push(`Meta duplicate suffix "${cm[0].trim()}"`); }
  const before = s;
  s = s.toUpperCase().replace(/\s*_\s*/g, '_');
  if (/\s/.test(s.trim())) { warnings.push('spaces used as separators'); s = s.trim().replace(/\s+/g, '_'); }
  if (/__+/.test(s)) { warnings.push('doubled underscore'); s = s.replace(/_+/g, '_'); }
  s = s.replace(/^_+|_+$/g, '');
  if (before !== before.trim() || /\s_|_\s/.test(before)) warnings.push('stray spaces');
  return { s, warnings, copy };
}

// The forms live in config (naming.forms): each is a list of slots, tried in order;
// the date and any suffix follow the last slot. Changing the convention is a config edit.
//   PERSONA, TERRITORY (one or more tokens), FORMAT, VISUALLINE (e.g. A2), VERSION (v2), REGION, PLATFORM
type Slot = 'PERSONA' | 'TERRITORY' | 'FORMAT' | 'VISUALLINE' | 'VERSION' | 'REGION' | 'PLATFORM';

export function parseAdName(raw: string, naming: Naming): NameResult {
  const { s, warnings, copy } = normalizeName(raw);
  const bad = (reason: string): BadName => ({ ok: false, reason, normalized: s });
  if (!s) return bad('empty ad name');
  const tokens = s.split('_');
  const personas = new Set(naming.personas.map(p => p.toUpperCase()));
  const formats = aliasIndex(naming.formats);
  const platforms = aliasIndex(naming.platforms);
  const regions = aliasIndex(naming.regions || {});
  const reVL = new RegExp(naming.visual_line_pattern || '^([A-Z])([1-9][0-9]?)$');
  const reV = new RegExp(naming.version_pattern || '^V([0-9]{1,3})$');
  const forms = (naming.forms?.length ? naming.forms : [['PERSONA', 'TERRITORY', 'FORMAT', 'VERSION', 'PLATFORM']]) as Slot[][];
  const show = (f: Slot[]) => [...f.map(x => (x === 'VISUALLINE' ? 'A1' : x === 'VERSION' ? 'v#' : x)), 'YYMMDD'].join('_');
  const expected = `expected ${forms.map(show).join(' (or the older ')}${forms.length > 1 ? ')' : ''}`;
  const minParts = Math.min(...forms.map(f => f.length));

  if (tokens.length < minParts) return bad(`only ${tokens.length} part${tokens.length === 1 ? '' : 's'}; ${expected}`);
  const persona = tokens[0];
  if (!personas.has(persona)) return bad(`persona "${persona}" isn't one of ${naming.personas.join(', ')}`);

  const ok = (slot: Slot, t: string | undefined): boolean => {
    if (t === undefined) return false;
    switch (slot) {
      case 'FORMAT': return formats.has(t);
      case 'PLATFORM': return platforms.has(t);
      case 'REGION': return regions.has(t);
      case 'VISUALLINE': return reVL.test(t);
      case 'VERSION': return reV.test(t);
      default: return true;
    }
  };

  for (const [fi, form] of forms.entries()) {
    const ti = form.indexOf('TERRITORY');
    const after = form.slice(ti + 1);
    // Territory runs from after the persona to wherever the fixed slots that follow it all match.
    for (let end = ti + 1; end + after.length <= tokens.length; end++) {
      const tail = tokens.slice(end, end + after.length);
      if (!after.every((slot, k) => ok(slot, tail[k]))) continue;
      const got: Partial<Record<Slot, string>> = {};
      after.forEach((slot, k) => { got[slot] = tail[k]; });
      const w = [...warnings];
      const fmt = formats.get(got.FORMAT!)!;
      const plat = platforms.get(got.PLATFORM!)!;
      const region = got.REGION ? regions.get(got.REGION)! : null;
      if (got.FORMAT !== fmt) w.push(`format written as ${got.FORMAT}`);
      if (got.PLATFORM !== plat) w.push(`platform written as ${got.PLATFORM}`);
      if (got.REGION && got.REGION !== region) w.push(`region written as ${got.REGION}`);
      let terr = tokens.slice(ti, end);
      if (terr[0] === persona && terr.length > 1) { terr = terr.slice(1); w.push('territory repeats the persona prefix'); }
      const territory = terr.join('_');
      if (naming.territories?.length && !naming.territories.map(t => t.toUpperCase()).includes(territory)) w.push(`territory ${territory} isn't in the known list`);
      const rest = tokens.slice(end + after.length);
      let date: string | null = null;
      if (rest.length) {
        const d = parseDateToken(rest[0]);
        if (d) { date = d.iso; if (d.long) w.push('date written as YYYYMMDD'); rest.shift(); }
        else if (/^\d+$/.test(rest[0])) return bad(`date "${rest[0]}" isn't a valid YYMMDD`);
        else w.push('no delivery date (YYMMDD)');
      } else w.push('no delivery date (YYMMDD)');
      if (rest.length) w.push(`extra suffix ${rest.join('_')}`);
      if (copy) rest.push(copy);
      const vl = got.VISUALLINE ? reVL.exec(got.VISUALLINE)! : null;
      const visual = vl ? vl[1] : null, line = vl ? Number(vl[2]) : null;
      const version = got.VERSION ? Number(reV.exec(got.VERSION)![1]) : line!;
      const idPart = vl ? `${visual}${line}` : `v${version}`;
      const stub = [persona, territory, fmt, idPart, ...(region ? [region] : []), plat].join('_');
      return {
        ok: true, persona, territory, format: fmt, version, visual, line, region, platform: plat, date, suffix: rest,
        stub, asset: [persona, territory, fmt, ...(visual ? [visual] : [])].join('_'), form: fi, warnings: w,
      };
    }
  }
  return bad(diagnose(tokens, forms, ok, naming, expected));
}

// Why no form matched: the first slot that fails around the version or visual+line token.
function diagnose(tokens: string[], forms: Slot[][], ok: (s: Slot, t: string | undefined) => boolean, naming: Naming, expected: string): string {
  const anchors = tokens.map((t, i) => ({ t, i })).filter(({ t, i }) => i > 0 && (ok('VISUALLINE', t) || ok('VERSION', t)));
  if (!anchors.length) return `no version (v#) or visual and line (e.g. A2); ${expected}`;
  const list = (m: Record<string, string[]>) => Object.keys(m).join(', ');
  for (const { t, i } of anchors) {
    if (i < 3) return `no territory between persona and format; ${expected}`;
    if (!ok('FORMAT', tokens[i - 1])) return `format "${tokens[i - 1]}" isn't one of ${list(naming.formats)}`;
    const next = tokens[i + 1];
    const newForm = forms.some(f => f.includes('VISUALLINE')) && ok('VISUALLINE', t) && !ok('VERSION', t);
    if (newForm && !ok('REGION', next) && !ok('PLATFORM', next)) return next ? `region "${next}" isn't one of ${list(naming.regions || {})}` : `no region after ${t}; ${expected}`;
    const platTok = newForm || ok('REGION', next) ? tokens[i + 2] : next;
    if (!ok('PLATFORM', platTok)) return platTok ? `platform "${platTok}" isn't one of ${list(naming.platforms)}` : `no platform after ${t}; ${expected}`;
  }
  return `doesn't match ${expected}`;
}

// Normalise a Studio or audit stub (either form, without the date; with
// Studio's STATIC/CAROUSEL and TIKTOK) to the same key parseAdName produces.
export function normalizeStub(raw: string, naming: Naming): string | null {
  const r = parseAdName(raw, naming);
  return r.ok ? r.stub : null;
}
