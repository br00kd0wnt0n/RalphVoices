// B3: ad names by the convention agreed with Add3,
//   PERSONA_TERRITORY_FORMAT_v#_PLATFORM_YYMMDD   e.g. FAM_SUMMER_ST_v2_META_261013
// Tolerates case, stray spaces, Studio's long format names, Meta's " - Copy"
// and extra suffixes after the date. Anything else fails with a reason; the
// caller quarantines it (never drops it).
import type { WeeklyConfig } from './config.js';

export interface ParsedName {
  ok: true;
  persona: string;
  territory: string;
  format: string;
  version: number;
  platform: string;
  date: string | null;      // ISO yyyy-mm-dd, the delivery date
  suffix: string[];         // tokens after the date (e.g. a copy-line tag)
  stub: string;             // PERSONA_TERRITORY_FORMAT_v#_PLATFORM: the join key to Studio and the audit
  asset: string;            // PERSONA_TERRITORY_FORMAT: the visual
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

const VERSION = /^V(\d{1,3})$/;

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

export function parseAdName(raw: string, naming: Naming): NameResult {
  const { s, warnings, copy } = normalizeName(raw);
  const bad = (reason: string): BadName => ({ ok: false, reason, normalized: s });
  if (!s) return bad('empty ad name');
  const tokens = s.split('_');
  const personas = new Set(naming.personas.map(p => p.toUpperCase()));
  const formats = aliasIndex(naming.formats);
  const platforms = aliasIndex(naming.platforms);
  const expected = 'expected PERSONA_TERRITORY_FORMAT_v#_PLATFORM_YYMMDD';

  if (tokens.length < 5) return bad(`only ${tokens.length} part${tokens.length === 1 ? '' : 's'}; ${expected}`);
  const persona = tokens[0];
  if (!personas.has(persona)) return bad(`persona "${persona}" isn't one of ${naming.personas.join(', ')}`);

  // Anchor on v#: FORMAT before it, PLATFORM after it, territory in between persona and format.
  const vIdx = tokens.map((t, i) => (VERSION.test(t) ? i : -1)).filter(i => i >= 0);
  if (!vIdx.length) return bad(`no version (v#); ${expected}`);
  let firstProblem = '';
  for (const i of vIdx) {
    const fmt = formats.get(tokens[i - 1] ?? '');
    const plat = platforms.get(tokens[i + 1] ?? '');
    if (i < 3) { firstProblem ||= `no territory between persona and format; ${expected}`; continue; }
    if (!fmt) { firstProblem ||= `format "${tokens[i - 1]}" isn't one of ${Object.keys(naming.formats).join(', ')}`; continue; }
    if (!plat) { firstProblem ||= tokens[i + 1] ? `platform "${tokens[i + 1]}" isn't one of ${Object.keys(naming.platforms).join(', ')}` : `no platform after v#; ${expected}`; continue; }
    const w = [...warnings];
    if (tokens[i - 1] !== fmt) w.push(`format written as ${tokens[i - 1]}`);
    if (tokens[i + 1] !== plat) w.push(`platform written as ${tokens[i + 1]}`);
    let terr = tokens.slice(1, i - 1);
    if (terr[0] === persona && terr.length > 1) { terr = terr.slice(1); w.push('territory repeats the persona prefix'); }
    const territory = terr.join('_');
    if (naming.territories?.length && !naming.territories.map(t => t.toUpperCase()).includes(territory)) w.push(`territory ${territory} isn't in the known list`);
    const rest = tokens.slice(i + 2);
    let date: string | null = null;
    if (rest.length) {
      const d = parseDateToken(rest[0]);
      if (d) { date = d.iso; if (d.long) w.push('date written as YYYYMMDD'); rest.shift(); }
      else if (/^\d+$/.test(rest[0])) return bad(`date "${rest[0]}" isn't a valid YYMMDD`);
      else w.push('no delivery date (YYMMDD)');
    } else w.push('no delivery date (YYMMDD)');
    if (rest.length) w.push(`extra suffix ${rest.join('_')}`);
    if (copy) rest.push(copy);
    const version = Number(VERSION.exec(tokens[i])![1]);
    return {
      ok: true, persona, territory, format: fmt, version, platform: plat, date, suffix: rest,
      stub: `${persona}_${territory}_${fmt}_v${version}_${plat}`,
      asset: `${persona}_${territory}_${fmt}`,
      warnings: w,
    };
  }
  return bad(firstProblem);
}

// Normalise a Studio or audit stub (PERSONA_TERRITORY_FORMAT_v#_PLATFORM, with
// Studio's STATIC/CAROUSEL and TIKTOK) to the same key parseAdName produces.
export function normalizeStub(raw: string, naming: Naming): string | null {
  const r = parseAdName(raw, naming);
  return r.ok ? r.stub : null;
}
