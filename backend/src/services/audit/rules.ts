// B2: where the client material lives, loading the rules file and rubric, and
// parsing naming stubs. The rules file is the single source of rules; nothing
// here restates a rule, only how to ask about it.
import fs from 'node:fs';
import path from 'node:path';
import type { Rules, Rubric, Stub } from './types.js';
import { parseCode } from '../../utils/namingCode.js';

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

// Naming codes: both forms (PERSONA_TERRITORY_FORMAT_[visual][line]_REGION_PLATFORM,
// and the earlier PERSONA_TERRITORY_FORMAT_v#_PLATFORM), read by the shared helper
// in utils/namingCode.ts, normalised the way B3 normalises them (aliases, case).
export function parseStub(raw: string, personas: string[] = ['DINK', 'CUR', 'FAM']): Stub | { error: string } {
  const p = parseCode(raw, personas);
  if ('error' in p) return p;
  const { persona, territory, format, platform } = p;
  return p.form === 'v#'
    ? { stub: p.code, persona, territory, format, version: p.version!, platform }
    : { stub: p.code, persona, territory, format, visual: p.visual!, line: p.line!, region: p.region!, platform };
}

/** Sources cited as "TM Trigger map 1", "BG p.17": expand the short code for the report's key. */
export function sourceKey(rules: Rules, cited: string): string[] {
  const codes = new Set<string>();
  for (const m of cited.matchAll(/\b([A-Z][A-Z0-9]{1,6})\b/g)) if (rules.sources[m[1]]) codes.add(m[1]);
  return [...codes];
}
