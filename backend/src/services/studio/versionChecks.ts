// Version checks at Ready for production (Nick, 30 Sep). A version is one ad
// made of several fields (and its visual's on-image text), so some problems
// only show once the fields are put together:
//   1. VERSION_REPEAT     amber  two fields of one ad say the same thing (word overlap; deterministic)
//   2. VERSION_TOO_ALIKE  amber  two versions on one visual are near-duplicates (word similarity; deterministic)
//   3. VERSION_CONFLICT   amber  fields contradict, undercut or clash (one model call per version, stage "version-check")
//   4. split claims       red    a compliance claim in one field with its caveat only in another, or nowhere
//                                 (the rules' `require` items: trigger_patterns / requires_patterns)
// Flags inform and never block the sign-off. Each carries a rule id and a source. 1, 2 and 4 are free and run on
// every preview; 3 costs money, so it runs on request (POST /ready/check) and at sign-off, and its answer is kept
// per version wording (the content key) in memory and in the sign-off.

import type { Line, Rules } from './engine.js';
import type { Api } from './engine.js';
import { costOf, finalText, sha256 } from './engine.js';
import type { Plan, PlannedVersion } from './versions.js';
import cfg from './versionChecks.json';

export interface VersionFlag {
  rule: string; severity: 'red' | 'amber'; label: string; source: string;
  fields: string[]; quote: string; why?: string; by: 'rule' | 'model';
  /** VERSION_TOO_ALIKE: the other version. */
  other?: string;
}
export interface VersionCheck {
  code: string;
  /** Hash of the version's wording (its fields and its visual's on-image text): the model's answer is for this wording. */
  key: string;
  flags: VersionFlag[];
  /** Whether the conflicts check (the model call) has run on this wording. */
  conflicts: 'checked' | 'not_checked' | 'failed';
  at?: string;
}
type Field = { field: string; label: string; text: string };

const CONFIG = cfg as typeof cfg;
const source = (rule: keyof typeof cfg.sources) => CONFIG.sources[rule];

/** The fields of a version as they'll run: its own fields, then its visual's on-image text. */
export function adFields(v: Pick<PlannedVersion, 'visual' | 'platform' | 'fields'>, plan: Pick<Plan, 'on_image'>, byId: Map<string, Line>, rules: Pick<Rules, 'fields'>): Field[] {
  const ids = Object.entries(v.fields).map(([f, id]) => [f, id] as const);
  for (const o of plan.on_image) {
    const l = byId.get(o.line_id);
    if (o.visual === v.visual && l && !o.issues?.length) ids.push([l.field, l.id]);
  }
  return ids.map(([f, id]) => byId.get(id)).filter(Boolean).map(l => ({ field: l!.field, label: rules.fields[l!.field]?.label || l!.field, text: finalText(l!) }));
}
export const contentKey = (fs: Field[]) => sha256(JSON.stringify(fs.map(f => [f.field, f.text])));

// ---------- 1. repeats ----------

const STOP = new Set('a an the and or but so to of in on at for with from by is are was be been it its this that these those you your we our us i me my he she they them their his her as if then than just not no do does did have has had can will would should could more most very all any one get got'.split(' '));
const words = (s: string) => s.toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+/g) || [];
const stem = (w: string) => w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w;
const content = (s: string) => words(s).filter(w => !STOP.has(w)).map(stem);

function repeat(a: Field, b: Field): { quote: string; why: string } | null {
  // A run of words (as written) in both fields.
  const wa = words(a.text), wb = words(b.text);
  const n = CONFIG.repeat_run_words;
  const runs = new Set<string>();
  for (let i = 0; i + n <= wb.length; i++) runs.add(wb.slice(i, i + n).join(' '));
  let best = '';
  for (let i = 0; i + n <= wa.length; i++) {
    if (!runs.has(wa.slice(i, i + n).join(' '))) continue;
    // Extend it as far as it goes.
    let k = n;
    while (i + k < wa.length && wb.join(' ').includes(wa.slice(i, i + k + 1).join(' '))) k++;
    const s = wa.slice(i, i + k).join(' ');
    if (s.length > best.length) best = s;
  }
  if (best && best.split(' ').some(w => !STOP.has(w))) return { quote: best, why: `Both say "${best}"` };
  // Mostly the same words.
  const ca = new Set(content(a.text)), cb = new Set(content(b.text));
  const small = Math.min(ca.size, cb.size);
  if (small < CONFIG.repeat_min_content_words) return null;
  const shared = [...ca].filter(w => cb.has(w));
  const overlap = shared.length / small;
  if (shared.length >= CONFIG.repeat_min_shared && overlap >= CONFIG.repeat_overlap) return { quote: shared.join(', '), why: `${Math.round(overlap * 100)}% of the words are the same` };
  return null;
}

// ---------- 2. too alike ----------

function vec(s: string): Map<string, number> {
  const w = content(s), v = new Map<string, number>();
  for (let i = 0; i < w.length; i++) {
    v.set(w[i], (v.get(w[i]) || 0) + 1);
    if (i + 1 < w.length) v.set(`${w[i]} ${w[i + 1]}`, (v.get(`${w[i]} ${w[i + 1]}`) || 0) + 0.5);
  }
  return v;
}
function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0, na = 0, nb = 0;
  for (const [k, x] of a) { na += x * x; dot += x * (b.get(k) || 0); }
  for (const x of b.values()) nb += x * x;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ---------- 4. split claims ----------

function splitClaims(fs: Field[], rules: Pick<Rules, 'compliance'>): VersionFlag[] {
  const out: VersionFlag[] = [];
  for (const it of rules.compliance || []) {
    if (it.check !== 'require') continue;
    const req = (s: string) => (it.requires_patterns || []).some(p => new RegExp(p, 'i').test(s));
    for (const f of fs) {
      const trig = (it.trigger_patterns || []).map(p => new RegExp(p, 'i').exec(f.text)).find(Boolean);
      if (!trig || req(f.text)) continue;
      const with_ = fs.filter(g => g !== f && req(g.text));
      out.push({
        rule: it.id, severity: 'red', label: it.rule, source: it.source, quote: trig[0], by: 'rule',
        fields: [f.field, ...with_.map(g => g.field)],
        why: with_.length ? `Claim in ${f.label}, caveat only in ${with_.map(g => g.label).join(' and ')}` : 'The caveat is nowhere in this ad',
      });
    }
  }
  return out;
}

// ---------- 3. conflicts (model) ----------

const SYSTEM = `You check one ad made of several copy fields that run together (for example Meta primary text, headline and the text on the image).
Find only real problems BETWEEN fields:
- contradiction: two fields say opposite things
- undercut: one field weakens or takes back another's claim
- tone: the fields clash in voice (e.g. a joke headline on a grave primary text)
- repeat: one field only restates another and adds nothing
A headline picking up the primary text's key word or theme is normal and fine: that's an echo, not a repeat.
Most ads have none. Don't comment on a single field on its own, on style, or on compliance.
Reply as JSON: {"hits":[{"kind":"contradiction|undercut|tone|repeat","fields":["<field id>", "<field id>"],"quote":"<words copied exactly from one field>","why":"<12 words or fewer>"}]}. No problems: {"hits":[]}.`;
const userOf = (fs: Field[]) => fs.map(f => `${f.field} (${f.label}): ${f.text}`).join('\n');

/** Rough cost of the conflicts check for these versions (the ones whose wording hasn't been checked yet). */
export function estimateConflicts(fss: Field[][]): { usd: number; calls: number } {
  const model = CONFIG.conflict_model;
  const usd = fss.reduce((t, fs) => t + costOf(model, { prompt_tokens: Math.ceil((SYSTEM.length + userOf(fs).length) / 4), completion_tokens: 90 }), 0);
  return { usd: Math.round(usd * 10000) / 10000, calls: fss.length };
}

async function conflicts(fs: Field[], api: Api): Promise<VersionFlag[]> {
  const { text } = await api.chat({ stage: 'version-check', model: CONFIG.conflict_model, system: SYSTEM, user: userOf(fs), max_tokens: CONFIG.conflict_max_tokens, json: true });
  let hits: any[] = [];
  try { hits = JSON.parse(text).hits || []; } catch { throw new Error('The conflicts check answered in a form Studio could not read'); }
  const known = new Set(fs.map(f => f.field));
  const all = fs.map(f => f.text).join('\n').toLowerCase();
  return hits.filter(h => h && typeof h === 'object').map(h => ({
    rule: 'VERSION_CONFLICT', severity: 'amber' as const, by: 'model' as const,
    label: `Fields ${h.kind === 'repeat' ? 'repeat each other' : h.kind === 'tone' ? 'clash in tone' : h.kind === 'undercut' ? 'undercut each other' : 'contradict each other'}`,
    source: source('VERSION_CONFLICT'),
    fields: (Array.isArray(h.fields) ? h.fields : []).map(String).filter((f: string) => known.has(f)),
    // Only a quote that's really in the copy.
    quote: typeof h.quote === 'string' && all.includes(h.quote.toLowerCase()) ? h.quote : '',
    why: String(h.why || '').split(/\s+/).slice(0, 12).join(' ') || undefined,
  }));
}

/** Answers from the conflicts check, per wording (content key). Also seeded from sign-offs, so a restart loses nothing signed. */
const conflictCache = new Map<string, { flags: VersionFlag[]; at: string }>();
export function seedConflicts(checks: VersionCheck[] | undefined) {
  for (const c of checks || []) if (c.conflicts === 'checked' && !conflictCache.has(c.key)) conflictCache.set(c.key, { flags: c.flags.filter(f => f.rule === 'VERSION_CONFLICT'), at: c.at || '' });
}

/**
 * The checks for every version of a plan. Free checks always; the conflicts check from the cache, or (with `api`)
 * run for each version whose wording hasn't been checked. A version with issues (incomplete) isn't checked.
 */
export async function checkVersions(plan: Plan, lines: Line[], rules: Pick<Rules, 'fields' | 'compliance'>, api?: Api): Promise<VersionCheck[]> {
  const byId = new Map(lines.map(l => [l.id, l]));
  const ads = plan.versions.map(v => ({ v, fs: adFields(v, plan, byId, rules) }));
  if (api) {
    const todo = ads.filter(a => !a.v.issues.length && a.fs.length && !conflictCache.has(contentKey(a.fs)));
    // Three at a time; a failure is shown on its version, not thrown.
    for (let i = 0; i < todo.length; i += 3) {
      await Promise.all(todo.slice(i, i + 3).map(async a => {
        const key = contentKey(a.fs);
        try { conflictCache.set(key, { flags: await conflicts(a.fs, api), at: new Date().toISOString() }); }
        catch (err: any) { if (err?.name === 'CapError' || err?.status === 402) throw err; failed.add(key); }
      }));
    }
  }
  const vecs = ads.map(a => vec(a.fs.filter(f => !/on_image/.test(f.field)).map(f => f.text).join(' ')));
  return ads.map(({ v, fs }, i) => {
    const key = contentKey(fs);
    const flags: VersionFlag[] = [];
    // 4. split claims (red first).
    flags.push(...splitClaims(fs, rules));
    // 1. repeats between the fields of this ad.
    for (let a = 0; a < fs.length; a++) for (let b = a + 1; b < fs.length; b++) {
      const r = repeat(fs[a], fs[b]);
      if (r) flags.push({ rule: 'VERSION_REPEAT', severity: 'amber', label: `${fs[a].label} and ${fs[b].label} say the same thing`, source: source('VERSION_REPEAT'), fields: [fs[a].field, fs[b].field], quote: r.quote, why: r.why, by: 'rule' });
    }
    // 2. too alike: another version on the same visual and platform.
    ads.forEach((o, j) => {
      if (j === i || o.v.visual !== v.visual || o.v.platform !== v.platform || !fs.length || !o.fs.length) return;
      const s = cosine(vecs[i], vecs[j]);
      if (s >= CONFIG.too_alike) flags.push({ rule: 'VERSION_TOO_ALIKE', severity: 'amber', label: `Almost the same ad as ${o.v.code || `version ${j + 1}`}`, source: source('VERSION_TOO_ALIKE'), fields: [], quote: '', why: `Similarity ${s.toFixed(2)}; threshold ${CONFIG.too_alike}`, by: 'rule', other: o.v.code });
    });
    // 3. conflicts, if checked.
    const c = conflictCache.get(key);
    if (c) flags.push(...c.flags);
    return { code: v.code, key, flags, conflicts: c ? 'checked' : failed.has(key) ? 'failed' : 'not_checked', at: c?.at };
  });
}
const failed = new Set<string>();

/** Which of these versions still need the conflicts check (for the estimate). */
export function uncheckedAds(plan: Plan, lines: Line[], rules: Pick<Rules, 'fields'>): Field[][] {
  const byId = new Map(lines.map(l => [l.id, l]));
  return plan.versions.filter(v => !v.issues.length).map(v => adFields(v, plan, byId, rules)).filter(fs => fs.length && !conflictCache.has(contentKey(fs)));
}
export const _test = { clear: () => { conflictCache.clear(); failed.clear(); }, config: CONFIG };
