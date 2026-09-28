// B2: where the client material lives, loading the rules file and rubric, and
// parsing naming stubs. The rules file is the single source of rules; nothing
// here restates a rule, only how to ask about it.
import fs from 'node:fs';
import path from 'node:path';
import type { Rules, Rubric, Stub } from './types.js';

export const CLIENT_DIR = process.env.AUDIT_CLIENT_DIR || '/Users/BD/ralph-voices/Claude outputs/voices-r1';
export const RULES_PATH = path.join(CLIENT_DIR, 'studio', 'studio-rules.json');
export const RUBRIC_PATH = path.join(CLIENT_DIR, 'rubric.json');
export const ASSETS_DIR = path.join(CLIENT_DIR, 'assets');
export const AUDIT_DIR = path.join(CLIENT_DIR, 'audit');

export function readJson(p: string): any { return JSON.parse(fs.readFileSync(p, 'utf8')); }

export function loadRules(p = RULES_PATH): Rules {
  const r = readJson(p) as Rules;
  for (const k of ['fields', 'facts', 'compliance', 'brand', 'clarity', 'features', 'personas'] as const) {
    if (!(k in r)) throw new Error(`Rules file ${p} has no "${k}" block`);
  }
  return r;
}

export function loadRubric(p = RUBRIC_PATH): Rubric {
  const r = readJson(p) as Rubric;
  if (!Array.isArray(r.items)) throw new Error(`Rubric ${p} has no items`);
  return r;
}

// Naming convention agreed with Add3: PERSONA_TERRITORY_FORMAT_v#_PLATFORM[_YYMMDD].
// Same normalisation as B3's reader (aliases, case), kept here so B2 doesn't import it.
const FORMATS: Record<string, string> = { ST: 'ST', STATIC: 'ST', VID: 'VID', VIDEO: 'VID', CAR: 'CAR', CAROUSEL: 'CAR', TT: 'TT', TIKTOK: 'TT', UGC: 'UGC' };
const PLATFORMS: Record<string, string> = { META: 'META', FB: 'META', IG: 'META', TT: 'TT', TIKTOK: 'TT' };

export function parseStub(raw: string, personas: string[] = ['DINK', 'CUR', 'FAM']): Stub | { error: string } {
  const s = raw.replace(/\.[a-z0-9]{2,4}$/i, '').trim().toUpperCase().replace(/[\s-]+/g, '_').replace(/_+/g, '_');
  const t = s.split('_');
  if (!personas.includes(t[0])) return { error: `persona "${t[0]}" isn't one of ${personas.join(', ')}` };
  const vi = t.findIndex((x, i) => i >= 3 && /^V\d{1,3}$/.test(x));
  if (vi < 0) return { error: 'no version (v#); expected PERSONA_TERRITORY_FORMAT_v#_PLATFORM' };
  const format = FORMATS[t[vi - 1]];
  const platform = PLATFORMS[t[vi + 1] || ''];
  if (!format) return { error: `format "${t[vi - 1]}" isn't one of ST, VID, CAR, TT, UGC` };
  if (!platform) return { error: `platform "${t[vi + 1] || ''}" isn't META or TT` };
  let terr = t.slice(1, vi - 1);
  if (terr[0] === t[0] && terr.length > 1) terr = terr.slice(1);
  if (!terr.length) return { error: 'no territory between persona and format' };
  const version = Number(t[vi].slice(1));
  const territory = terr.join('_');
  return { stub: `${t[0]}_${territory}_${format}_v${version}_${platform}`, persona: t[0], territory, format, version, platform };
}

/** Sources cited as "TM Trigger map 1", "BG p.17": expand the short code for the report's key. */
export function sourceKey(rules: Rules, cited: string): string[] {
  const codes = new Set<string>();
  for (const m of cited.matchAll(/\b([A-Z][A-Z0-9]{1,6})\b/g)) if (rules.sources[m[1]]) codes.add(m[1]);
  return [...codes];
}
