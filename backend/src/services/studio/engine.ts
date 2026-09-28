// B1-lite Copy Studio engine (VOICES v2, Trupanion). No database, no routes.
//
// Everything here is file-based: rules, briefs, batches, taste examples and
// exports live in the studio folder outside the repo (client material). The
// CLI (scripts/studio.ts) and the local UI server (`studio.ts serve`) both
// call these functions.
//
// Safety: only OPENAI_API_KEY is read from backend/.env (by hand, never
// dotenv.config(), because that file's DATABASE_URL points at production).
// Nothing imports src/db or src/routes.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { withRetry } from '../../utils/retry.js';
import { probabilityYes } from '../../utils/probes.js';
import { mockClient } from './mock.js';
import { claudeWrite, isClaude } from './claude.js';
import { FileStore, type StudioStore } from './store.js';

// ---------- paths ----------

export const INPUTS = '/Users/BD/ralph-voices/Claude outputs/voices-r1';
let STUDIO = process.env.STUDIO_DIR || path.join(INPUTS, 'studio');
export function studioDir() { return STUDIO; }
export function setStudioDir(dir: string) { STUDIO = dir; store = null; rulesCache = null; }
const P = (...parts: string[]) => path.join(STUDIO, ...parts);
export function readJson<T = any>(p: string): T { return JSON.parse(fs.readFileSync(p, 'utf8')); }

// ---------- storage ----------

// All work (runs, lines, decisions, territories, taste, compares, spend) goes
// through a StudioStore: files by default (B1-lite), Postgres when hosted.
let store: StudioStore | null = null;
export function setStore(s: StudioStore) { store = s; rulesCache = null; }
export function getStore(): StudioStore {
  if (!store) store = new FileStore(STUDIO, { rulesPath: rulesPath || undefined, inputsDir: INPUTS, assets: localAssets() });
  return store;
}
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

export const PROMPT_VERSION = 'b1-lite-1';

// ---------- types ----------

export type Severity = 'compliance' | 'warn' | 'note';
export type Structure = 'question' | 'stat' | 'testimony' | 'scenario' | 'joke' | 'plain_promise';
export const STRUCTURES: Structure[] = ['question', 'stat', 'testimony', 'scenario', 'joke', 'plain_promise'];

export interface Tone { dry_warm: number; playful_plain: number; short_long: number }
/** A line the creative director wrote, and the field it's for. */
export interface OwnLine { text: string; field: string }
export interface Brief {
  name: string;
  persona: string;
  territory: string;
  fields: string[];
  tone: Tone;
  banned_words: string[];
  banned_ideas: string[];
  reference_lines: string[];
  own_lines?: OwnLine[];  // the creative director's own lines, written first
  n: number;
  model: string;
  checker_model?: string;
  probe_model?: string;
  objection_model?: string;
  created: string;
}
export interface Flag {
  rule: string;
  severity: Severity;
  label: string;          // the rule in words
  source: string;         // where the rule comes from
  quote: string;          // the words in the line it rests on ('' if none)
  why?: string;
  by: Array<'rule' | 'model' | 'logprob'>;
  p?: number;             // mean P(Yes) over the two wordings, for logprob checks
  base?: Severity;        // severity from a deterministic rule match, if any
}
export interface Line {
  id: string;
  batch: string;
  persona: string;
  territory: string;
  field: string;
  text: string;
  chars: number;
  cell: string;
  angle: string;
  angle_label: string;
  structure: Structure;
  tone: Tone;
  tone_label: string;
  features: string[];
  flags: Flag[];
  probes?: Record<string, [number | null, number | null]>;
  objection?: string;
  status: 'generated' | 'checking' | 'checked';
  model: string;
  prompt_version: string;
  parent?: string;
  guidance?: string;
  decision?: '' | 'keep' | 'cut' | 'edit';
  edited_text?: string;
  note?: string;
  decided_by?: string;
  decided_at?: string;   // the last human change to the line (decision, override, compliance, sign-off)
  /** Red flags a person has overridden, with the written reason (Ready for production gate). */
  overrides?: Override[];
  /** Trupanion compliance review: pending (default), cleared or changes_requested. Doesn't block sign-off. */
  compliance?: { status: ComplianceStatus; note?: string; by?: string; at?: string; sha256?: string };  // sha256: the wording it was reviewed on
  /** The line's place in the latest Ready for production sign-off. */
  ready?: { signoff_id: string; version: number; sha256: string; ready_by: string; ready_at: string; stub: string; changed_since?: boolean };
  /** When the final wording was last fully re-checked (after an edit). */
  rechecked_at?: string;
}
export interface Override { rule: string; reason: string; by: string; at: string }
export type ComplianceStatus = 'pending' | 'cleared' | 'changes_requested';
/** One wording of a line as it stood at a sign-off or after one. Never rewritten. */
export interface LineVersion { line_id: string; batch_id: string; version: number; field: string; text: string; sha256: string; created_by: string; created_at: string; signoff_id?: string;
  /** The naming code the line was signed off under (B3b joins live results on it). */
  stub?: string }
export const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
/** The words that go to production: the edit when there is one. */
export const finalText = (l: Pick<Line, 'decision' | 'edited_text' | 'text'>) => (l.decision === 'edit' && l.edited_text ? l.edited_text : l.text);
export const lineHash = (l: Pick<Line, 'field' | 'decision' | 'edited_text' | 'text'>) => sha256(`${l.field}\n${finalText(l)}`);
export interface Batch {
  id: string;
  brief: Brief;
  created: string;
  rules_version?: string;  // the rules version the lines were last checked under
  created_by?: string;   // who started the run (local: the name the page asks for; hosted: the signed-in user)
  updated?: string;
  lines: Line[];
  dropped: Array<{ text: string; cell: string; dup_of: string; similarity: number }>;
  stats: RunStats;
}
export interface RunStats {
  generated: number;
  near_duplicates_removed: number;
  similar_flagged: number;
  timings_ms: Record<string, number>;
  usd: Record<string, number>;
  calls: Record<string, number>;
  tokens: Record<string, number>;
  usd_total: number;
  model_budgets_tpm?: Record<string, number>;
}
export type StudioEvent =
  | { type: 'status'; message: string }
  | { type: 'line'; line: Line }
  | { type: 'stats'; stats: RunStats }
  | { type: 'done'; batch: string }
  | { type: 'error'; message: string };
type Emit = (e: StudioEvent) => void;

// ---------- rules ----------

export interface Rules {
  version?: string;
  sources: Record<string, any>;
  fields: Record<string, { platform: string; label: string; visible: number; max: number; source: string }>;
  tone_controls: Record<string, Record<string, string>>;
  structures: Record<Structure, string>;
  facts: Fact[];
  figure_rule: { id: string; rule: string; severity?: Severity; source: string; citation_rule?: { id: string; rule: string; source: string }; attribution_rule?: { id: string; rule: string; source: string } };
  compliance: RuleItem[];
  brand: RuleItem[];
  clarity: RuleItem[];
  features: { source: string; items: Record<string, string> };
  personas: Record<string, PersonaRules>;
  territories: Record<string, Territory>;
  needs_review: any[];
}
/** A pattern is a regex string, or one with its own severity and reason (e.g. a word that is only a warning). */
export type Pat = string | { re: string; severity?: Severity; why?: string };
export interface RuleItem {
  id: string; rule: string; severity?: Severity; check: string; source: string;
  patterns?: Pat[]; trigger_patterns?: string[]; requires_patterns?: string[];
  lead_fields?: string[];
  wordings?: [string, string]; structures?: string[]; min_words?: number; status?: string; needs_confirmation?: boolean;
}
export interface Fact {
  id: string; text: string; numbers: string[]; personas?: string[]; source: string;
  own?: boolean; category?: boolean; illustrative?: boolean; check_hint?: string; misattribution_patterns?: string[];
}
const pat = (p: Pat) => (typeof p === 'string' ? { re: p } : p);
export interface Territory {
  persona: string; name: string; angle: string; format: string; premise: string; source: string;
  status?: string;            // 'springboard' | 'retired' | undefined (active)
  origin?: 'pitch' | 'edited' | 'new';
  note?: string; updated_by?: string; updated_at?: string;
  history?: Array<{ at: string; by: string; note: string; before: Partial<Territory> | null }>;
}
export const FORMATS = ['STATIC', 'UGC', 'VIDEO', 'CAROUSEL'];
export interface PersonaRules {
  name: string; platforms: string[]; default_fields: string[];
  triggers: Array<{ id: string; label: string; detail: string; source: string }>;
  turn_offs: RuleItem[];
  language: Array<{ text: string; caution?: boolean; source: string }>;
  verbatims: Array<{ id: string; text: string; attribution: string; use: string; source: string }>;
}

let rulesPath = '';
export function setRulesPath(p: string) { rulesPath = p; store = null; rulesCache = null; }

// The rules, territories, persona seeds and voice samples are read from the
// store into memory, because nearly every check needs them. refreshRules()
// reloads them; call it at the start of each command or request.
let rulesCache: Rules | null = null;
let seedsCache: any = null;
let voicesCache: Record<string, string> = {};
export async function refreshRules(): Promise<Rules> {
  const s = getStore();
  const r = await s.getRules() as Rules;
  // Territory edits (the creative director's, from client feedback or taste)
  // sit on top of the pitch versions in the rules.
  for (const t of Object.values(r.territories)) t.origin = 'pitch';
  const edits = await s.getTerritoryEdits();
  for (const [code, t] of Object.entries(edits)) r.territories[code] = { ...(r.territories[code] || {}), ...(t as Territory) };
  seedsCache = await s.getInput('personas');
  voicesCache = (await s.getInput('voices')) || {};
  rulesCache = r;
  return r;
}
export function loadRules(): Rules {
  if (!rulesCache) throw new Error('Studio rules not loaded; call refreshRules() first');
  return rulesCache;
}

// ---------- territories: editable, with history ----------

/**
 * Edit a territory, add a new one (no code), or retire/restore one
 * (patch.status). Every change records who made it, when and why; the pitch
 * version in the rules file is never changed.
 */
export async function saveTerritory(code: string | null, patch: Partial<Pick<Territory, 'persona' | 'name' | 'angle' | 'format' | 'premise' | 'status'>>, note: string, user?: string): Promise<{ code: string; territory: Territory }> {
  const r = await refreshRules();
  const current = code ? r.territories[code] : undefined;
  if (code && !current) throw new Error(`No territory ${code}`);
  const persona = patch.persona || current?.persona || '';
  const pr = r.personas[persona];
  if (!pr) throw new Error(`Unknown persona ${persona}`);
  const next: Territory = {
    ...(current || { source: '', premise: '', name: '', angle: pr.triggers[0].id, format: 'STATIC' }),
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    persona,
  } as Territory;
  if (!next.name.trim()) throw new Error('A territory needs a name');
  if (!pr.triggers.some(t => t.id === next.angle)) throw new Error(`Angle ${next.angle} isn't one of ${persona}'s triggers`);
  if (!FORMATS.includes(next.format)) throw new Error(`Format must be one of ${FORMATS.join(', ')}`);
  if (patch.status === 'active' as any) delete next.status;
  const at = new Date().toISOString();
  const by = user || 'unknown';
  let newCode = code;
  if (!newCode) {
    const slug = next.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').split('_').slice(0, 3).join('_') || 'NEW';
    newCode = `${persona}_${slug}`;
    for (let k = 2; r.territories[newCode]; k++) newCode = `${persona}_${slug}_${k}`;
  }
  const { history: _h, origin: _o, ...before } = current || ({} as Territory);
  next.origin = current ? (current.origin === 'new' ? 'new' : 'edited') : 'new';
  next.note = note.trim();
  next.updated_by = by;
  next.updated_at = at;
  next.source = current ? current.source : `Added in Studio by ${by}, ${at.slice(0, 10)}${note.trim() ? `: ${note.trim()}` : ''}`;
  next.history = [...(current?.history || []), { at, by, note: note.trim(), before: current ? before : null }];
  await getStore().saveTerritoryEdit(newCode, next);
  await refreshRules();
  return { code: newCode, territory: next };
}

/** Every rule id the checks can cite, with its words, severity and source. */
function ruleIndex(r: Rules, persona: string): Map<string, { label: string; severity: Severity; source: string }> {
  const m = new Map<string, { label: string; severity: Severity; source: string }>();
  for (const i of [...r.compliance, ...r.brand, ...r.clarity]) m.set(i.id, { label: labelOf(i), severity: i.severity || 'warn', source: i.source });
  for (const i of r.personas[persona]?.turn_offs || []) m.set(i.id, { label: labelOf(i), severity: i.severity || 'warn', source: i.source });
  m.set(r.figure_rule.id, { label: r.figure_rule.rule, severity: r.figure_rule.severity || 'compliance', source: r.figure_rule.source });
  return m;
}
function labelOf(i: RuleItem) {
  return i.rule + (i.status === 'pending' ? ' (rule pending)' : '') + (i.needs_confirmation ? ' (exclusions to be confirmed)' : '');
}

// Persona seeds and lived voice samples (from the SM spike), for the writer and the objection.
function personaSeed(code: string): any {
  return seedsCache?.personas?.find((x: any) => x.code === code)?.body || null;
}
function voiceSample(code: string): string {
  return voicesCache[code] || '';
}

// ---------- OpenAI plumbing (after measurement-spike.ts) ----------

// USD per 1M tokens, list prices Sep 2026. Unknown models are priced high on purpose.
const PRICES: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'gpt-5.1': { input: 1.25, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  '*': { input: 5, output: 15 },
};
function priceOf(model: string) {
  const key = Object.keys(PRICES).filter(k => k !== '*' && (model === k || model.startsWith(k + '-2'))).sort((a, b) => b.length - a.length)[0];
  return PRICES[key || '*'];
}
export function costOf(model: string, u: any): number {
  const pr = priceOf(model);
  const cached = u?.prompt_tokens_details?.cached_tokens || 0;
  return ((u?.prompt_tokens || 0) - cached) * pr.input / 1e6 + cached * pr.input / 2 / 1e6 + (u?.completion_tokens || 0) * pr.output / 1e6;
}
const isReasoning = (m: string) => /^(gpt-5|o\d)/.test(m);
const estTokens = (s: string) => Math.ceil(s.length / 4);
const FATAL_CODES = new Set(['credit_balance_exhausted', 'insufficient_quota', 'billing_hard_limit_reached', 'invalid_api_key']);

export function loadKey(mock: boolean) {
  if (mock) return;
  if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('...')) return;
  // A key file holding only the key (no editing of .env needed): STUDIO_KEY_FILE or ~/.config/voices/openai.key.
  const keyFile = process.env.STUDIO_KEY_FILE || path.join(process.env.HOME || '', '.config/voices/openai.key');
  if (fs.existsSync(keyFile)) {
    const k = fs.readFileSync(keyFile, 'utf8').trim();
    if (k.length >= 20 && !k.includes('...')) { process.env.OPENAI_API_KEY = k; return; }
  }
  // Otherwise parse backend/.env by hand for this one variable; never dotenv.config().
  const envPath = [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), 'backend/.env'), '/Users/BD/ralph-voices/backend/.env'].find(p => fs.existsSync(p));
  if (!envPath) throw new Error('No backend/.env found; export OPENAI_API_KEY in the shell instead');
  const m = /^OPENAI_API_KEY\s*=\s*(.*)$/m.exec(fs.readFileSync(envPath, 'utf8'));
  const key = m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
  if (key.length < 20 || key.includes('...')) throw new Error(`OPENAI_API_KEY in ${envPath} is a placeholder; put the real key there or export OPENAI_API_KEY in the shell`);
  process.env.OPENAI_API_KEY = key;
}

export class CapError extends Error {}

/**
 * Pacing under each model's tokens-per-minute limit: a 60-second sliding
 * window of (estimated prompt + max output) tokens, which is how OpenAI counts
 * a request against the limit. A model's budget is the --tpm value if given
 * for it, else 90% of the limit its response headers report, else 20k.
 */
export class Pacer {
  private windows = new Map<string, Array<{ t: number; tokens: number }>>();
  private learned = new Map<string, number>();
  private inflight = new Map<string, number>();
  constructor(private explicit: Record<string, number>, private maxInflight = 8, private tokensOff = false) {}
  budget(model: string): number {
    const e = this.explicit[model], l = this.learned.get(model);
    if (e && l) return Math.min(e, l);
    return e || l || 20000;
  }
  budgets() { const out: Record<string, number> = {}; for (const m of new Set([...Object.keys(this.explicit), ...this.learned.keys()])) out[m] = this.budget(m); return out; }
  learn(model: string, limit: number) { if (limit > 0) this.learned.set(model, Math.floor(limit * 0.9)); }
  async take(model: string, tokens: number) {
    for (;;) {
      const now = Date.now();
      const w = this.windows.get(model) || [];
      while (w.length && now - w[0].t > 60_000) w.shift();
      this.windows.set(model, w);
      const used = w.reduce((t, x) => t + x.tokens, 0);
      const busy = this.inflight.get(model) || 0;
      if (busy < this.maxInflight && (this.tokensOff || used + tokens <= this.budget(model) || w.length === 0)) {
        w.push({ t: now, tokens });
        this.inflight.set(model, busy + 1);
        return;
      }
      await new Promise(r => setTimeout(r, 200));
    }
  }
  release(model: string) { this.inflight.set(model, Math.max(0, (this.inflight.get(model) || 1) - 1)); }
}

export interface ApiOptions { mock?: boolean; tpm?: Record<string, number>; cap?: number; capWindow?: 'all' | 'month'; pacer?: Pacer; user?: string }

export class Api {
  client: any;
  pacer: Pacer;
  mock: boolean;
  cap: number;
  capWindow: 'all' | 'month';
  runUsd: Record<string, number> = {};
  runCalls: Record<string, number> = {};
  runTokens: Record<string, number> = {};
  stopped = false;
  /** Who the spend is recorded against (the signed-in user, when hosted). */
  user?: string;
  constructor(opts: ApiOptions = {}) {
    this.mock = !!opts.mock;
    this.cap = opts.cap ?? 15;
    this.capWindow = opts.capWindow ?? 'all';
    this.user = opts.user;
    loadKey(this.mock);
    this.client = this.mock ? mockClient() : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // The mock has no rate limit; pace it only when asked (STUDIO_PACE_MOCK=1) to rehearse live timing.
    // Pass a shared pacer when several jobs run at once (the hosted Studio makes one Api per job).
    this.pacer = opts.pacer ?? new Pacer(opts.tpm ?? {}, 8, this.mock && !process.env.STUDIO_PACE_MOCK);
  }
  private spentBase = 0;
  /** Spend so far across all runs, read once at the start of each run for the cap check. */
  async loadSpent() {
    const since = this.capWindow === 'month' ? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString() : undefined;
    this.spentBase = this.mock ? 0 : await getStore().spendTotal(since);
    return this.spentBase;
  }
  spent(): number { return this.spentBase; }
  runTotal(): number { return Object.values(this.runUsd).reduce((a, b) => a + b, 0); }
  async resetRun() { this.runUsd = {}; this.runCalls = {}; this.runTokens = {}; await this.loadSpent(); }
  private add(stage: string, usd: number, tokens: number) {
    this.runUsd[stage] = (this.runUsd[stage] || 0) + usd;
    this.runCalls[stage] = (this.runCalls[stage] || 0) + 1;
    this.runTokens[stage] = (this.runTokens[stage] || 0) + tokens;
  }
  private guard() {
    if (this.stopped) throw new CapError('Stopped');
    if (!this.mock && this.spent() + this.runTotal() > this.cap - 0.02) { this.stopped = true; throw new CapError(this.capWindow === 'month' ? `This month's Studio budget of $${this.cap} is used up` : `Session cap of $${this.cap} reached`); }
  }

  async chat(o: {
    stage: string; model: string; system: string; user: string; max_tokens: number;
    temperature?: number; json?: boolean; logprobs?: boolean;
  }): Promise<{ text: string; top: Array<{ token: string; logprob: number }> }> {
    this.guard();
    if (isClaude(o.model) && !this.mock) return this.claude(o);
    const reasoning = isReasoning(o.model);
    const params: any = {
      model: o.model,
      messages: [{ role: 'system', content: o.system }, { role: 'user', content: o.user }],
    };
    if (reasoning) {
      params.max_completion_tokens = o.max_tokens + 3000;
      params.reasoning_effort = 'low';
    } else {
      params.max_tokens = o.max_tokens;
      params.temperature = o.temperature ?? 0;
    }
    if (o.json) params.response_format = { type: 'json_object' };
    if (o.logprobs && !reasoning) { params.logprobs = true; params.top_logprobs = 5; }
    const need = estTokens(o.system) + estTokens(o.user) + (params.max_tokens || params.max_completion_tokens);
    await this.pacer.take(o.model, need);
    try {
      const { data, response } = await withRetry(() => this.client.chat.completions.create(params, { maxRetries: 0 }).withResponse().catch((err: any) => {
        // Out of credits/quota comes back as a 429 too; waiting won't fix it.
        if (FATAL_CODES.has(err?.code)) { err.fatal = true; err.status = 402; }
        throw err;
      }), `${o.stage} ${o.model}`, 6) as any;
      const limit = Number(response?.headers?.get?.('x-ratelimit-limit-tokens'));
      if (limit) this.pacer.learn(o.model, limit);
      this.add(o.stage, costOf(o.model, data.usage), (data.usage?.total_tokens || 0));
      const choice = data.choices?.[0];
      return { text: choice?.message?.content || '', top: choice?.logprobs?.content?.[0]?.top_logprobs || [] };
    } catch (err: any) {
      if (err?.fatal) this.stopped = true;
      throw err;
    } finally {
      this.pacer.release(o.model);
    }
  }

  /** Claude writer calls (JSON only; no logprobs, so never used for the checks). */
  private async claude(o: { stage: string; model: string; system: string; user: string; max_tokens: number; logprobs?: boolean }) {
    if (o.logprobs) throw new Error(`${o.model} can't run the yes/no checks (no logprobs); use an OpenAI model for checks`);
    await this.pacer.take(o.model, estTokens(o.system) + estTokens(o.user) + o.max_tokens);
    try {
      const r = await withRetry(() => claudeWrite(o).catch((err: any) => {
        if (err?.status === 401 || err?.status === 403) err.fatal = true;
        throw err;
      }), `${o.stage} ${o.model}`, 6);
      this.add(o.stage, costOf(o.model, r.usage), r.usage.total_tokens);
      return { text: r.text, top: [] };
    } catch (err: any) {
      if (err?.fatal) this.stopped = true;
      throw err;
    } finally {
      this.pacer.release(o.model);
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    this.guard();
    const model = 'text-embedding-3-small';
    await this.pacer.take(model, texts.reduce((t, s) => t + estTokens(s), 0));
    try {
      const r: any = await withRetry(() => this.client.embeddings.create({ model, input: texts }, { maxRetries: 0 }), 'embed', 6);
      this.add('embed', costOf(model, { prompt_tokens: r.usage?.prompt_tokens || 0 }), r.usage?.prompt_tokens || 0);
      return r.data.map((d: any) => d.embedding as number[]);
    } finally {
      this.pacer.release(model);
    }
  }

  /** Record this run's spend in the cumulative ledger (studio/spend.json). */
  async commit(label: string, user?: string) {
    if (this.mock || !this.runTotal()) return;
    await getStore().addSpend({ label, usd: round(this.runTotal(), 4), by_stage: Object.fromEntries(Object.entries(this.runUsd).map(([k, v]) => [k, round(v, 4)])), calls: this.runCalls, at: new Date().toISOString(), user: user ?? this.user });
  }

}
export async function readSpend(): Promise<{ total_usd: number; runs: any[] }> {
  const st = getStore();
  return { total_usd: await st.spendTotal(), runs: await st.listSpend() };
}

// Small concurrency pool.
async function pool<T>(items: T[], size: number, fn: (x: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

// ---------- utilities ----------

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s: string): number {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function cosine(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}
function stamp(d = new Date()) {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}
function clamp15(n: number) { return Math.max(1, Math.min(5, Math.round(n))); }
export function toneLabel(t: Tone) { return `dw${t.dry_warm} pp${t.playful_plain} sl${t.short_long}`; }
function toneWords(r: Rules, t: Tone): string {
  const w = (k: keyof Tone, v: number) => {
    const c = r.tone_controls[k] || {};
    const near = v <= 2 ? c['1'] : v >= 4 ? c['5'] : c['3'];
    return `${k.replace('_', '→')} ${v}/5 (${near})`;
  };
  return `${w('dry_warm', t.dry_warm)}; ${w('playful_plain', t.playful_plain)}; ${w('short_long', t.short_long)}`;
}

// ---------- brief ----------

export function makeBrief(input: Partial<Brief>): Brief {
  const r = loadRules();
  const territory = String(input.territory || '');
  const t = r.territories[territory];
  if (!t) throw new Error(`Unknown territory ${territory}. Known: ${Object.keys(r.territories).join(', ')}`);
  if (t.status === 'retired' && !input.created) throw new Error(`${t.name} is retired; restore it on the Territories screen to brief it`);
  const persona = String(input.persona || t.persona);
  const pr = r.personas[persona];
  if (!pr) throw new Error(`Unknown persona ${persona}`);
  const fields = (input.fields && input.fields.length ? input.fields : pr.default_fields);
  for (const f of fields) if (!r.fields[f]) throw new Error(`Unknown field ${f}. Known: ${Object.keys(r.fields).join(', ')}`);
  const tone = { dry_warm: 3, playful_plain: 3, short_long: 2, ...(input.tone || {}) };
  return {
    name: input.name || `${territory}-${stamp()}`,
    persona, territory, fields,
    tone: { dry_warm: clamp15(tone.dry_warm), playful_plain: clamp15(tone.playful_plain), short_long: clamp15(tone.short_long) },
    banned_words: (input.banned_words || []).map(s => s.trim()).filter(Boolean),
    banned_ideas: (input.banned_ideas || []).map(s => s.trim()).filter(Boolean),
    reference_lines: (input.reference_lines || []).map(s => s.trim()).filter(Boolean).slice(0, 3),
    own_lines: (input.own_lines || [])
      .map(o => ({ text: String(o?.text || '').trim(), field: r.fields[o?.field] ? o.field : fields[0] }))
      .filter(o => o.text).slice(0, 40),
    n: Math.max(1, Math.min(60, Number(input.n) || 20)),
    model: input.model || 'gpt-4o',
    checker_model: input.checker_model || 'gpt-4o',
    probe_model: input.probe_model || 'gpt-4o-mini',
    objection_model: input.objection_model || 'gpt-4o',
    created: input.created || new Date().toISOString(),
  };
}
export async function saveBrief(b: Brief): Promise<void> { await getStore().saveBrief(b); }
export async function loadBrief(name: string): Promise<Brief> {
  const raw = await getStore().getBrief(name);
  if (!raw) throw new Error(`No brief ${name}`);
  return makeBrief(raw);
}

// ---------- grid ----------

export interface Cell { cell: string; angle: string; structure: Structure; tone: Tone; field: string }

/**
 * A deliberately varied grid. Angles are the persona's triggers (the
 * territory's own trigger counts twice); cell i takes angle i mod A and
 * structure (i mod A + floor(i/A)) mod 6: each pass over the angles shifts the
 * structures by one, so every structure appears within A cells of each pass. Tone alternates between the brief's setting and a
 * step warmer/drier and a step more playful/plainer. Fields are dealt from a
 * seeded shuffle so no angle is stuck with one field.
 */
export function planCells(b: Brief, count: number, offset = 0, seedExtra = '', skip: Set<string> = new Set()): Cell[] {
  const r = loadRules();
  const pr = r.personas[b.persona];
  const home = r.territories[b.territory]?.angle;
  const angles = [...(home ? [home] : []), ...pr.triggers.map(t => t.id)];
  const A = angles.length, S = STRUCTURES.length;
  const flip = (v: number, d: number) => clamp15(v >= 3 ? v - d : v + d);
  const tones: Tone[] = [
    b.tone,
    { ...b.tone, dry_warm: flip(b.tone.dry_warm, 2) },
    { ...b.tone, playful_plain: flip(b.tone.playful_plain, 2) },
  ];
  const rnd = mulberry32(hashStr(`${b.name}|fields|${seedExtra}`));
  // Cells whose angle × structure the creative director already wrote are
  // skipped (once each), so Studio's lines spread out from theirs.
  const pending = new Set(skip);
  const limit = offset + count * 4;
  const fieldDeck = shuffle(Array.from({ length: limit }, (_, i) => b.fields[i % b.fields.length]), rnd);
  const cells: Cell[] = [];
  for (let i = offset; i < limit && cells.length < count; i++) {
    const angle = angles[i % A];
    const structure = STRUCTURES[((i % A) + Math.floor(i / A)) % S];
    if (pending.delete(`${angle}|${structure}`)) continue;
    cells.push({ cell: `c${String(i + 1).padStart(2, '0')}`, angle, structure, tone: tones[Math.floor(i / A) % tones.length], field: fieldDeck[i] });
  }
  return cells;
}
/** Index after the last planned cell, to continue the grid in the next round. */
const nextOffset = (cells: Cell[], fallback: number) => (cells.length ? Number(cells[cells.length - 1].cell.slice(1)) : fallback);

// ---------- taste (from ingest) ----------

export interface TasteExample {
  id: string; persona: string; territory: string; field: string; angle: string; structure: string; tone_label: string;
  text: string; original?: string; decision: 'keep' | 'edit' | 'cut'; note: string; batch: string; at: string;
}
export async function loadTaste(): Promise<TasteExample[]> { return getStore().getTaste(); }

// ---------- writer prompt ----------

function writerSystem(b: Brief, r: Rules, own: string[] = [], allTaste: TasteExample[] = []): string {
  const pr = r.personas[b.persona];
  const t = r.territories[b.territory];
  const seed = personaSeed(b.persona);
  const facts = r.facts.filter(f => !f.personas || f.personas.includes(b.persona));
  const modelRules = [...r.compliance.filter(c => c.check !== 'structure'), ...r.brand.filter(c => !c.status)];
  const taste = allTaste.filter(x => x.persona === b.persona);
  const keeps = taste.filter(x => x.decision !== 'cut').sort((x, y) => Number(y.territory === b.territory) - Number(x.territory === b.territory)).slice(0, 8);
  const cuts = taste.filter(x => x.decision === 'cut' && x.note).slice(0, 4);

  return `You write social ad copy for Trupanion (medical insurance for cats and dogs) alongside a creative director. You write options, not finished ads: each line must be distinct, specific and usable.

BRAND VOICE (Trupanion Brand Guidelines): confident but never boastful or disparaging of competitors; genuine; knowledgeable; empathetic; a little playful. Concise, simple, conversational: everyday words, contractions, active voice. Refer to the product as medical insurance for pets (or cats and dogs), never "pet insurance".

AUDIENCE: ${pr.name}${seed ? `. ${seed.household || ''} ${seed.occupation ? `(${seed.occupation})` : ''}` : ''}
What moves them (these are the ANGLES):
${pr.triggers.map(x => `- ${x.id} "${x.label}": ${x.detail}`).join('\n')}
Turn-offs (never do these):
${pr.turn_offs.map(x => `- ${x.rule}`).join('\n')}
Their language: ${pr.language.map(l => l.text).join(' · ')}
Real owners' words, for inspiration only (never copy more than four words in a row):
${pr.verbatims.map(v => `- "${v.text}"`).join('\n')}

TERRITORY: ${t.name} ${t.premise}

RULES THAT BIND EVERY LINE:
${modelRules.map(c => `- ${c.rule}`).join('\n')}
- Primary text and captions must make clear what is being sold: Trupanion, medical insurance for cats and dogs. Headlines and hooks can lean on the primary text.
- Only use a number if it is in this facts list, exactly as written; never invent a figure. For the stat structure, prefer Trupanion's own facts:
${facts.map(f => `  - ${f.own ? '[Trupanion] ' : f.category ? '[category survey, needs citation] ' : f.illustrative ? '[illustrative] ' : ''}${f.text}${f.check_hint ? ` (${f.check_hint})` : ''}`).join('\n')}

STRUCTURES:
${Object.entries(r.structures).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

FIELDS (stay within the visible length):
${b.fields.map(f => `- ${f}: ${r.fields[f].label}, ${r.fields[f].visible} characters visible`).join('\n')}
${b.banned_words.length ? `\nBANNED WORDS (the creative director's): ${b.banned_words.join(', ')}` : ''}${b.banned_ideas.length ? `\nIDEAS THAT ARE OFF LIMITS: ${b.banned_ideas.join('; ')}` : ''}${own.length ? `\nTHE CREATIVE DIRECTOR'S OWN LINES for this brief. This is the voice to match most closely. Build around them: never repeat or paraphrase them, and take the angles and structures they haven't used:\n${own.map(x => `- ${x}`).join('\n')}` : ''}${b.reference_lines.length ? `\nREFERENCE LINES in the voice the creative director wants (match the voice, don't copy):\n${b.reference_lines.map(x => `- ${x}`).join('\n')}` : ''}${keeps.length ? `\nTHE CREATIVE DIRECTOR'S TASTE: lines they kept or rewrote, with their notes. Learn from the edits and notes:\n${keeps.map(x => `- [${x.field}, ${x.structure}] ${x.original && x.original !== x.text ? `"${x.original}" → rewritten as "${x.text}"` : `"${x.text}"`}${x.note ? ` (note: ${x.note})` : ''}`).join('\n')}` : ''}${cuts.length ? `\nLINES THEY CUT, and why (avoid these moves):\n${cuts.map(x => `- "${x.text}" (note: ${x.note})`).join('\n')}` : ''}

Write exactly one line per cell you are given, fitting its angle, structure, tone and field. Make lines in the same request differ from each other in wording, rhythm and idea. Plain text only: no hashtags, no emoji, no quotation marks around the line, no labels. Return JSON: {"lines":[{"cell":"<cell id>","text":"<the line>"}]}`;
}

function writerUser(r: Rules, b: Brief, cells: Cell[], guidance?: string, sibling?: string): string {
  const pr = r.personas[b.persona];
  const label = (id: string) => pr.triggers.find(t => t.id === id)?.label || id;
  return `${sibling ? `Write siblings of this line: "${sibling}". Keep what works about it but make each one a genuinely different line.\n` : ''}${guidance ? `Creative director's guidance for these: ${guidance}\n` : ''}Cells:
${cells.map(c => `- ${c.cell}: angle ${c.angle} "${label(c.angle)}"; structure ${c.structure}; tone ${toneWords(r, c.tone)}; field ${c.field} (${r.fields[c.field].visible} chars visible)`).join('\n')}`;
}

function parseLines(text: string): Array<{ cell: string; text: string }> {
  try {
    const j = JSON.parse(text);
    const arr = Array.isArray(j) ? j : j.lines;
    return (arr || []).filter((x: any) => x && typeof x.text === 'string' && x.text.trim())
      .map((x: any) => ({ cell: String(x.cell || ''), text: x.text.trim().replace(/^["“]|["”]$/g, '').trim() }));
  } catch { return []; }
}

// ---------- batches on disk ----------

export async function batchExists(id: string): Promise<boolean> { return getStore().batchExists(id); }
export async function loadBatch(id: string): Promise<Batch> { return getStore().getBatch(id); }
export async function saveBatch(b: Batch): Promise<void> { b.updated = new Date().toISOString(); await getStore().saveBatch(b); }
export interface RunSummary {
  id: string; name: string; persona: string; territory: string; created: string; updated: string; created_by: string;
  lines: number; yours: number; kept: number; undecided: number; usd: number;
  /** Lines not yet checked (a run interrupted by a restart); resume checks them. */
  unchecked: number;
}
/** Saved runs, newest activity first; pass a name to list one person's runs. */
export async function listBatches(user?: string): Promise<RunSummary[]> {
  const st = getStore();
  // Planted-line checks (adhoc-*) are tests, not runs.
  const ids = (await st.listBatchIds()).filter(x => !x.startsWith('adhoc-'));
  const out: RunSummary[] = [];
  for (const x of ids) {
    const b: Batch = await st.getBatch(x);
    out.push({
      id: b.id, name: b.brief.name, persona: b.brief.persona, territory: b.brief.territory,
      created: b.created, updated: b.updated || b.created, created_by: b.created_by || '',
      lines: b.lines.length, yours: b.lines.filter(l => l.model === 'human').length,
      kept: b.lines.filter(l => l.decision === 'keep' || l.decision === 'edit').length,
      undecided: b.lines.filter(l => !l.decision).length, usd: b.stats.usd_total,
      unchecked: b.lines.filter(l => l.status !== 'checked').length,
    });
  }
  return out.filter(r => !user || r.created_by.toLowerCase() === user.toLowerCase()).sort((a, b) => b.updated.localeCompare(a.updated));
}

// ---------- estimate ----------

/** Rough cost of generating and checking a batch of n lines (no cache discount). */
export function estimate(b: Brief, opts: { ownOnly?: boolean } = {}): { usd: number; calls: number; tokens: Record<string, number>; minutes_at_budget: Record<string, number> } {
  // Token counts only; taste examples add a little to the writer prompt and aren't counted.
  const r = loadRules();
  const own = (b.own_lines || []).length;
  const g = opts.ownOnly ? 0 : b.n;          // lines Studio writes
  const m = g + own;                         // lines checked
  const n = Math.ceil(g * 1.25);
  const wsys = estTokens(writerSystem(b, r, (b.own_lines || []).map(o => o.text)));
  const angles = g ? r.personas[b.persona].triggers.length + 1 : 0;
  const gen = { calls: angles, inTok: angles * (wsys + 200), outTok: n * 60 };
  const tag = { calls: own ? 1 : 0, inTok: own ? 700 + own * 30 : 0, outTok: own * 25 };
  const probeItems = r.compliance.filter(c => c.wordings).length;
  const chk = { calls: m, inTok: m * 1300, outTok: m * 150 };
  const prb = { calls: m * probeItems * 2, inTok: m * probeItems * 2 * 120, outTok: m * probeItems * 2 };
  const obj = { calls: m, inTok: m * 500, outTok: m * 45 };
  const usd = [
    [b.model, gen], [b.checker_model!, tag], [b.checker_model!, chk], [b.probe_model!, prb], [b.objection_model!, obj],
  ].reduce((t, [mm, x]: any) => t + costOf(mm, { prompt_tokens: x.inTok, completion_tokens: x.outTok }), 0);
  // Tokens counted against each model's TPM (prompt + max output).
  const tokens: Record<string, number> = {};
  const addT = (mm: string, v: number) => { if (v) tokens[mm] = (tokens[mm] || 0) + v; };
  addT(b.model, gen.inTok + angles * 1800);
  addT(b.checker_model!, tag.inTok + chk.inTok + m * 350);
  addT(b.probe_model!, prb.inTok + prb.calls);
  addT(b.objection_model!, obj.inTok + m * 70);
  const minutes: Record<string, number> = {};
  for (const [mm, t] of Object.entries(tokens)) minutes[mm] = round(t / (mm.includes('mini') ? 180000 : 27000), 2); // tier-1 limits at 90%
  return { usd: round(usd, 3), calls: gen.calls + tag.calls + chk.calls + prb.calls + obj.calls + (m ? 1 : 0), tokens, minutes_at_budget: minutes };
}

// ---------- generate ----------

const DUP = Number(process.env.STUDIO_DUP ?? 0.9);
const SIMILAR = Number(process.env.STUDIO_SIMILAR ?? 0.85);

async function writeCells(api: Api, r: Rules, b: Brief, cells: Cell[], model: string, stage: string, extra?: { guidance?: string; sibling?: string; own?: string[] }): Promise<Array<{ cell: Cell; text: string }>> {
  const system = writerSystem(b, r, extra?.own, await loadTaste());
  const byAngle = new Map<string, Cell[]>();
  for (const c of cells) byAngle.set(c.angle, [...(byAngle.get(c.angle) || []), c]);
  const out: Array<{ cell: Cell; text: string }> = [];
  await Promise.all([...byAngle.values()].map(async group => {
    let todo = group;
    for (let attempt = 0; attempt < 2 && todo.length; attempt++) {
      const res = await api.chat({ stage, model, system, user: writerUser(r, b, todo, extra?.guidance, extra?.sibling), max_tokens: 90 * todo.length + 60, temperature: 0.9, json: true });
      const got = parseLines(res.text);
      const byCell = new Map(got.map(g => [g.cell, g.text]));
      // Models sometimes drop or rename cell ids; fall back to order.
      const unmatched = got.filter(g => !todo.some(c => c.cell === g.cell));
      const missing: Cell[] = [];
      for (const c of todo) {
        const text = byCell.get(c.cell) ?? unmatched.shift()?.text;
        if (text) out.push({ cell: c, text }); else missing.push(c);
      }
      todo = missing;
    }
  }));
  return out.sort((a, b) => a.cell.cell.localeCompare(b.cell.cell));
}

function newLine(b: Brief, r: Rules, batchId: string, idx: number, cell: Cell, text: string, model: string): Line {
  const pr = r.personas[b.persona];
  return {
    id: `${batchId}-L${String(idx).padStart(2, '0')}`,
    batch: batchId, persona: b.persona, territory: b.territory, field: cell.field,
    text, chars: [...text].length, cell: cell.cell,
    angle: cell.angle, angle_label: pr.triggers.find(t => t.id === cell.angle)?.label || cell.angle,
    structure: cell.structure, tone: cell.tone, tone_label: toneLabel(cell.tone),
    features: [], flags: [], status: 'generated', model, prompt_version: PROMPT_VERSION,
    decision: '', edited_text: '', note: '',
  };
}

/**
 * Tag the creative director's lines with the angle and structure each one
 * mainly uses (one JSON call), so they sit in the grid like Studio's lines.
 */
async function tagOwn(api: Api, r: Rules, b: Brief, own: OwnLine[]): Promise<Array<{ angle: string; structure: Structure }>> {
  const pr = r.personas[b.persona];
  const fallback = { angle: r.territories[b.territory]?.angle || pr.triggers[0].id, structure: 'plain_promise' as Structure };
  const res = await api.chat({
    stage: 'tag', model: b.checker_model || 'gpt-4o', json: true, max_tokens: 40 * own.length + 60,
    system: `You classify lines of ad copy for Trupanion (medical insurance for cats and dogs) written for one audience: ${pr.name}. For each line, pick the one angle it mainly plays on and the one structure it uses.

ANGLES:
${pr.triggers.map(t => `${t.id}: ${t.label}. ${t.detail}`).join('\n')}

STRUCTURES:
${Object.entries(r.structures).map(([k, v]) => `${k}: ${v}`).join('\n')}

Return JSON: {"tags":[{"i":<line number>,"angle":"<angle id>","structure":"<structure id>"}]}`,
    user: own.map((o, i) => `${i + 1}. ${o.text}`).join('\n'),
  });
  let tags: any[] = [];
  try { tags = JSON.parse(res.text).tags || []; } catch { /* fall back below */ }
  return own.map((_, i) => {
    const t = tags.find(x => Number(x?.i) === i + 1) || {};
    return {
      angle: pr.triggers.some(x => x.id === t.angle) ? t.angle : fallback.angle,
      structure: (STRUCTURES as string[]).includes(t.structure) ? t.structure : fallback.structure,
    };
  });
}

/**
 * Write and check a batch. The creative director's own lines (brief.own_lines)
 * go in first, tagged and checked like any other line; Studio then writes
 * brief.n lines around them, skipping the angle × structure cells they
 * covered and dropping anything too close to their lines. With opts.batchId of
 * an existing batch, new lines are added to it ("Generate around these").
 * With opts.ownOnly, only the creative director's lines are checked.
 */
// Ids handed out by this process, so two runs started in the same second never share one.
const reservedIds = new Set<string>();
/** A new run id, `TERRITORY-yymmdd-hhmmss`, with -2, -3… when that second is taken. */
export async function newBatchId(territory: string): Promise<string> {
  const base = `${territory}-${stamp()}`;
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (reservedIds.has(id)) continue;
    reservedIds.add(id); // before the await, so a concurrent call skips it
    if (reservedIds.size > 1000) reservedIds.delete(reservedIds.values().next().value!);
    if (!(await batchExists(id))) return id;
  }
}

export async function generate(b: Brief, api: Api, emit: Emit = () => {}, opts: { check?: boolean; batchId?: string; ownOnly?: boolean; user?: string } = {}): Promise<Batch> {
  const r = loadRules();
  const existing = opts.batchId && (await batchExists(opts.batchId)) ? await loadBatch(opts.batchId) : null;
  const id = existing?.id || opts.batchId || (await newBatchId(b.territory));
  const started = Date.now();
  const batch: Batch = existing || { id, brief: b, created: new Date().toISOString(), lines: [], dropped: [], stats: { generated: 0, near_duplicates_removed: 0, similar_flagged: 0, timings_ms: {}, usd: {}, calls: {}, tokens: {}, usd_total: 0 } };
  if (existing) batch.brief = { ...b, own_lines: [...(existing.brief.own_lines || []), ...(b.own_lines || []).filter(o => !(existing.brief.own_lines || []).some(x => x.text === o.text))] };
  if (!batch.created_by && opts.user) batch.created_by = opts.user;
  const embStore: Record<string, number[]> = existing ? await getStore().getEmbeddings(id) : {};
  const firstNew = batch.lines.length;
  await api.resetRun();

  // 1. The creative director's lines.
  const already = new Set(batch.lines.filter(l => l.model === 'human').map(l => l.text));
  const own = (b.own_lines || []).filter(o => !already.has(o.text));
  if (own.length) {
    emit({ type: 'status', message: `Reading your ${own.length} line${own.length === 1 ? '' : 's'}` });
    const [tags, embs] = await Promise.all([tagOwn(api, r, b, own), api.embed(own.map(o => o.text))]);
    own.forEach((o, i) => {
      const l = newLine(b, r, id, batch.lines.length + 1, { cell: `y${String(i + 1).padStart(2, '0')}`, angle: tags[i].angle, structure: tags[i].structure, tone: b.tone, field: o.field }, o.text, 'human');
      batch.lines.push(l);
      embStore[l.id] = embs[i];
      emit({ type: 'line', line: l });
    });
  }
  const humans = batch.lines.filter(l => l.model === 'human');

  // 2. Studio's lines, around theirs.
  if (!opts.ownOnly && b.n > 0) {
    emit({ type: 'status', message: `Writing ${b.n} lines with ${b.model}${humans.length ? ' around yours' : ''}` });
    const covered = new Set(humans.map(l => `${l.angle}|${l.structure}`));
    const pool = Object.entries(embStore).map(([lid, emb]) => ({ id: lid, emb }));
    const kept: Array<{ cell: Cell; text: string; emb: number[] }> = [];
    const gen0 = batch.lines.filter(l => l.model !== 'human').length;
    let offset = gen0 ? Math.ceil(gen0 * 1.25) : 0;
    for (let round_ = 0; round_ < 3 && kept.length < b.n; round_++) {
      const want = round_ === 0 ? Math.ceil(b.n * 1.25) : Math.max(3, Math.ceil((b.n - kept.length) * 1.5));
      const cells = planCells(b, want, offset, '', round_ === 0 ? covered : new Set());
      offset = nextOffset(cells, offset + want);
      const written = await writeCells(api, r, b, cells, b.model, 'generate', { own: humans.map(l => l.text) });
      batch.stats.generated += written.length;
      const embs = await api.embed(written.map(w => w.text));
      written.forEach((w, i) => {
        let best = 0, bestId = '';
        for (const p of pool) { const s = cosine(embs[i], p.emb); if (s > best) { best = s; bestId = p.id; } }
        kept.forEach(k => { const s = cosine(embs[i], k.emb); if (s > best) { best = s; bestId = k.cell.cell; } });
        if (best >= DUP) batch.dropped.push({ text: w.text, cell: w.cell.cell, dup_of: bestId, similarity: round(best) });
        else if (kept.length < b.n) kept.push({ ...w, emb: embs[i] });
      });
    }
    for (const k of kept) {
      const l = newLine(b, r, id, batch.lines.length + 1, k.cell, k.text, b.model);
      batch.lines.push(l);
      embStore[l.id] = k.emb;
    }
    batch.stats.near_duplicates_removed = batch.dropped.length;
  }
  batch.stats.timings_ms.generate = (batch.stats.timings_ms.generate || 0) + (Date.now() - started);
  await saveBatch(batch);
  await getStore().saveEmbeddings(id, embStore); // after the lines exist (the database links embeddings to lines)
  const fresh = batch.lines.slice(firstNew);
  for (const l of fresh) emit({ type: 'line', line: l });
  emit({ type: 'status', message: `${fresh.length} lines ready${batch.dropped.length ? ` (${batch.dropped.length} near-duplicates removed)` : ''}. Checking…` });

  if (opts.check !== false) await checkBatch(batch, api, emit, fresh.map(l => l.id));
  const prevTotal = existing ? (batch.stats.timings_ms.total || 0) : 0;
  finishStats(batch, api, started);
  batch.stats.timings_ms.total += prevTotal;
  await saveBatch(batch);
  await api.commit(`${opts.ownOnly ? 'check-own' : 'generate'} ${id}`);
  emit({ type: 'stats', stats: batch.stats });
  emit({ type: 'done', batch: id });
  return batch;
}

function finishStats(batch: Batch, api: Api, started: number) {
  batch.stats.timings_ms.total = Date.now() - started;
  batch.stats.usd = Object.fromEntries(Object.entries(api.runUsd).map(([k, v]) => [k, round((batch.stats.usd[k] || 0) + v, 4)]));
  batch.stats.calls = { ...api.runCalls };
  batch.stats.tokens = { ...api.runTokens };
  batch.stats.usd_total = round(Object.values(batch.stats.usd).reduce((a, b) => a + b, 0), 4);
  batch.stats.model_budgets_tpm = api.pacer.budgets();
}

/** "More like this": k siblings of one line, same angle and field, with the note as guidance. */
export async function moreLikeThis(batchId: string, lineId: string, guidance: string, k: number, api: Api, emit: Emit = () => {}): Promise<Line[]> {
  const r = loadRules();
  const batch = await loadBatch(batchId);
  const src = batch.lines.find(l => l.id === lineId);
  if (!src) throw new Error(`No line ${lineId}`);
  const started = Date.now();
  await api.resetRun();
  const others = STRUCTURES.filter(s => s !== src.structure);
  const base = batch.lines.length;
  const cells: Cell[] = Array.from({ length: k }, (_, i) => ({
    cell: `m${String(base + i + 1).padStart(2, '0')}`, angle: src.angle, field: src.field, tone: src.tone,
    structure: i === 0 ? src.structure : others[(hashStr(lineId) + i) % others.length],
  }));
  const written = await writeCells(api, r, batch.brief, cells, batch.brief.model, 'more', { guidance, sibling: src.edited_text || src.text, own: batch.lines.filter(l => l.model === 'human').map(l => l.text) });
  const embs = await api.embed(written.map(w => w.text));
  const embStore = await getStore().getEmbeddings(batchId);
  const added: Line[] = [];
  written.forEach((w, i) => {
    const best = Math.max(0, ...Object.values(embStore).map(e => cosine(e, embs[i])));
    if (best >= DUP) { batch.dropped.push({ text: w.text, cell: w.cell.cell, dup_of: lineId, similarity: round(best) }); return; }
    const l = { ...newLine(batch.brief, r, batchId, batch.lines.length + 1, w.cell, w.text, batch.brief.model), parent: lineId, guidance };
    batch.lines.push(l); added.push(l); embStore[l.id] = embs[i];
  });
  await saveBatch(batch);
  await getStore().saveEmbeddings(batchId, embStore); // after the lines exist
  for (const l of added) emit({ type: 'line', line: l });
  await checkBatch(batch, api, emit, added.map(l => l.id));
  batch.stats.timings_ms.more = (batch.stats.timings_ms.more || 0) + (Date.now() - started);
  for (const [k2, v] of Object.entries(api.runUsd)) batch.stats.usd[k2] = round((batch.stats.usd[k2] || 0) + v, 4);
  batch.stats.usd_total = round(Object.values(batch.stats.usd).reduce((a, b) => a + b, 0), 4);
  await saveBatch(batch);
  await api.commit(`more ${lineId}`);
  emit({ type: 'stats', stats: batch.stats });
  emit({ type: 'done', batch: batchId });
  return added;
}

// ---------- checks: deterministic ----------

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9$%'. ]+/g, ' ').replace(/\s+/g, ' ').trim();
function words(s: string) { return s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean); }

function figureKey(raw: string): string {
  let s = raw.toLowerCase().replace(/\s+/g, '').replace(/million/, 'm').replace(/billion/, 'b');
  s = s.replace(/^\$/, '').replace(/,/g, '');
  return s;
}
export function figuresIn(text: string): string[] {
  const t = text.replace(/24\/7/g, ' ');
  return [...t.matchAll(/\$?\d[\d,]*(?:\.\d+)?\s?(?:%|x\b|k\b|m\b|million\b|billion\b|b\b)?/gi)].map(m => m[0].trim()).filter(Boolean);
}

function addFlag(flags: Flag[], f: Flag) {
  const ex = flags.find(x => x.rule === f.rule);
  if (!ex) { flags.push(f); return; }
  for (const b of f.by) if (!ex.by.includes(b)) ex.by.push(b);
  if (!ex.quote && f.quote) ex.quote = f.quote;
  if (f.base && !ex.base) ex.base = f.base;
  if (f.p !== undefined) ex.p = f.p;
  if (f.why && !ex.why) ex.why = f.why;
  const rank = { compliance: 2, warn: 1, note: 0 };
  if (rank[f.severity] > rank[ex.severity]) ex.severity = f.severity;
}

/** The words lost to truncation, from the start of the first cut word. */
function truncTail(text: string, visible: number): string {
  const cs = [...text];
  let i = visible;
  while (i > 0 && /\S/.test(cs[i - 1])) i--;
  return cs.slice(i).join('');
}

export function deterministicFlags(l: { text: string; field: string; structure: string; persona: string }, r: Rules, brief?: Pick<Brief, 'banned_words'>): { flags: Flag[]; features: string[] } {
  const flags: Flag[] = [];
  const text = l.text;
  const f = r.fields[l.field];
  const chars = [...text].length;
  if (f && chars > f.max) addFlag(flags, { rule: 'LIMIT_MAX', severity: 'warn', label: `Over the ${f.label} limit (${chars}/${f.max})`, source: f.source, quote: '', why: `${chars} characters; limit ${f.max}`, by: ['rule'] });
  else if (f && chars > f.visible) addFlag(flags, { rule: 'LIMIT_VISIBLE', severity: 'warn', label: `Truncated: ${chars} characters, ${f.visible} visible in ${f.label}`, source: f.source, quote: truncTail(text, f.visible), why: `${chars} characters; ${f.visible} visible`, by: ['rule'] });

  const pr = r.personas[l.persona];
  const items: RuleItem[] = [...r.compliance, ...r.brand, ...(pr?.turn_offs || [])];
  const rank = { compliance: 2, warn: 1, note: 0 };
  for (const it of items) {
    if (it.check === 'banned' || it.check === 'price_lead') {
      // Strongest matching pattern wins; a pattern may carry its own (lower) severity.
      let best: { sev: Severity; quote: string; why?: string } | null = null;
      for (const p0 of it.patterns || []) {
        const p = pat(p0);
        const m = new RegExp(p.re, 'i').exec(text);
        if (!m) continue;
        let sev: Severity = p.severity || it.severity || 'warn';
        let why = p.why;
        if (it.check === 'price_lead') {
          // Compliance only when the price leads: a short field, or the first clause of longer copy.
          const firstClause = text.search(/[.!?—:;]/);
          const leads = (it.lead_fields || []).includes(l.field) || m.index < (firstClause > 0 ? firstClause : 60);
          sev = leads ? (it.severity || 'compliance') : 'warn';
          why = leads ? 'Price leads the line' : 'Premium mentioned mid-line; fine only if price isn\'t the message';
        }
        const quote = m[0] + (text.slice(m.index + m[0].length).match(/^\w*/)?.[0] || ''); // finish the last word
        if (!best || rank[sev] > rank[best.sev]) best = { sev, quote, why };
      }
      if (best) addFlag(flags, { rule: it.id, severity: best.sev, label: labelOf(it), source: it.source, quote: best.quote, why: best.why, by: ['rule'], base: best.sev });
    } else if (it.check === 'case') {
      const letters = text.replace(/[^A-Za-z]/g, '');
      const upper = letters.replace(/[^A-Z]/g, '').length;
      if (letters.length >= 8 && upper / letters.length > 0.6) addFlag(flags, { rule: it.id, severity: it.severity || 'warn', label: labelOf(it), source: it.source, quote: '', why: 'All caps in a copy field', by: ['rule'] });
    } else if (it.check === 'require') {
      const trig = (it.trigger_patterns || []).map(p => new RegExp(p, 'i').exec(text)).find(Boolean);
      const ok = (it.requires_patterns || []).some(p => new RegExp(p, 'i').test(text));
      if (trig && !ok) addFlag(flags, { rule: it.id, severity: it.severity || 'compliance', label: it.rule, source: it.source, quote: trig[0], why: 'Direct-pay claim without "at participating hospitals"', by: ['rule'], base: it.severity || 'compliance' });
    } else if (it.check === 'structure') {
      if ((it.structures || []).includes(l.structure)) addFlag(flags, { rule: it.id, severity: it.severity || 'note', label: it.rule, source: it.source, quote: '', why: 'Testimony line: cast a Trupanion member', by: ['rule'] });
    } else if (it.check === 'verbatim' && pr) {
      const k = it.min_words || 6;
      const lw = words(text);
      const shingles = new Set<string>();
      for (let i = 0; i + k <= lw.length; i++) shingles.add(lw.slice(i, i + k).join(' '));
      for (const v of pr.verbatims) {
        const vw = words(v.text);
        let hit = '';
        for (let i = 0; i + k <= vw.length && !hit; i++) { const s = vw.slice(i, i + k).join(' '); if (shingles.has(s)) hit = s; }
        if (hit) { addFlag(flags, { rule: it.id, severity: it.severity || 'compliance', label: it.rule, source: `${it.source}; ${v.id} (${v.source})`, quote: hit, by: ['rule'] }); break; }
      }
    }
  }
  for (const w of brief?.banned_words || []) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const m = re.exec(text);
    if (m) addFlag(flags, { rule: `BRIEF_BANNED:${w}`, severity: 'warn', label: `Banned in the brief: "${w}"`, source: 'Brief (creative director)', quote: m[0], by: ['rule'] });
  }
  // Figures must come from the facts list.
  const facts = r.facts.filter(x => !x.personas || x.personas.includes(l.persona));
  const allowed = new Set(facts.flatMap(x => x.numbers.map(figureKey)));
  const used = new Set<string>();
  for (const raw of figuresIn(text)) {
    const key = figureKey(raw);
    used.add(key);
    const small = /^\d+$/.test(key) && Number(key) <= 12 && !raw.includes('$');
    if (!small && !allowed.has(key) && !flags.some(f => f.rule === r.figure_rule.id)) {
      addFlag(flags, { rule: r.figure_rule.id, severity: r.figure_rule.severity || 'compliance', label: r.figure_rule.rule, source: r.figure_rule.source, quote: raw, why: `"${raw}" isn't in the facts list`, by: ['rule'] });
    }
  }
  for (const fact of facts) {
    const hit = fact.numbers.map(figureKey).find(k => used.has(k) && !(/^\d+$/.test(k) && Number(k) <= 12));
    if (!hit) continue;
    const cr = r.figure_rule.citation_rule;
    if (fact.category && cr) addFlag(flags, { rule: cr.id, severity: 'warn', label: cr.rule, source: `${cr.source}; ${fact.id} (${fact.source})`, quote: hit, why: 'Third-party category stat: needs an on-ad citation', by: ['rule'] });
    const ar = r.figure_rule.attribution_rule;
    for (const mp of fact.misattribution_patterns || []) {
      const m = new RegExp(mp, 'i').exec(text);
      if (m && ar) { addFlag(flags, { rule: ar.id, severity: 'compliance', label: ar.rule, source: `${ar.source}; ${fact.id} (${fact.source})`, quote: m[0], why: fact.check_hint, by: ['rule'] }); break; }
    }
  }
  const features: string[] = [];
  if (/\$\s?\d/.test(text)) features.push('dollar_figure');
  return { flags, features };
}

// ---------- checks: model ----------

function checkerSystem(r: Rules, persona: string): { system: string; ids: Set<string> } {
  const pr = r.personas[persona];
  const items = [
    ...r.compliance.filter(c => c.check !== 'structure' && c.check !== 'verbatim'),
    ...r.brand,
    ...pr.turn_offs,
  ];
  const system = `You check one line of social ad copy for Trupanion (medical insurance for cats and dogs) against fixed rules for one audience: ${pr.name}. Judge only the words of the line as written, in the field it will appear in. A rule is hit only when the line itself does what the rule forbids; don't flag a line for touching a topic. For every hit, quote the exact words from the line it rests on.

RULES (id: rule):
${items.map(i => `${i.id}: ${i.rule}`).join('\n')}

CLARITY:
glance: ${r.clarity.find(c => c.id === 'CL_GLANCE')?.rule}
product_clear: ${r.clarity.find(c => c.id === 'CL_PRODUCT')?.rule} Assume the Trupanion name and logo appear on the ad; judge whether the words make clear it's medical insurance for pets.

FEATURES (tag every one that applies):
${Object.entries(r.features.items).map(([k, v]) => `${k}: ${v}`).join('\n')}

Return JSON only: {"hits":[{"rule":"<id>","quote":"<exact words from the line>","why":"<12 words or fewer>"}],"glance":{"ok":true,"why":"<if not ok>"},"product_clear":{"ok":true,"why":"<if not ok>"},"features":["<feature id>"]}. Use "hits":[] when nothing is hit.`;
  return { system, ids: new Set(items.map(i => i.id)) };
}

async function modelCheck(line: Line, r: Rules, api: Api, model: string, idx: ReturnType<typeof ruleIndex>) {
  const { system, ids } = checkerSystem(r, line.persona);
  const f = r.fields[line.field];
  const res = await api.chat({ stage: 'check', model, system, user: `FIELD: ${f.label}\nLINE: ${line.text}`, max_tokens: 350, json: true });
  let j: any = {};
  try { j = JSON.parse(res.text); } catch { /* treated as no hits */ }
  const lower = line.text.toLowerCase();
  for (const h of Array.isArray(j.hits) ? j.hits : []) {
    const rule = String(h?.rule || '');
    if (!ids.has(rule)) continue; // a flag without a source in the rules file is dropped
    const meta = idx.get(rule)!;
    const quote = String(h?.quote || '');
    const verified = quote && lower.includes(quote.toLowerCase());
    addFlag(line.flags, { rule, severity: meta.severity, label: meta.label, source: meta.source, quote: verified ? quote : '', why: String(h?.why || '').slice(0, 140) + (quote && !verified ? ` (model paraphrased: "${quote.slice(0, 60)}")` : ''), by: ['model'] });
  }
  const productField = ['meta_primary', 'tiktok_caption'].includes(line.field);
  for (const [key, id] of [['glance', 'CL_GLANCE'], ['product_clear', 'CL_PRODUCT']] as const) {
    if (id === 'CL_PRODUCT' && !productField) continue; // headlines and hooks sit next to the primary text and logo
    if (j?.[key] && j[key].ok === false) {
      const meta = idx.get(id)!;
      addFlag(line.flags, { rule: id, severity: meta.severity, label: meta.label, source: meta.source, quote: '', why: String(j[key].why || '').slice(0, 140), by: ['model'] });
    }
  }
  for (const ft of Array.isArray(j.features) ? j.features : []) if (r.features.items[ft] && !line.features.includes(ft)) line.features.push(ft);
}

// A yes/no flag on its own (no rule or model hit) needs this much: the mini model reads
// short lines loosely, and live runs showed lone flags at 0.5-0.75 on clean lines.
const LONE_LOGPROB = 0.8;

/** Two wordings per compliance item, P(Yes) from logprobs, averaged. */
async function probeCheck(line: Line, r: Rules, api: Api, model: string) {
  const f = r.fields[line.field];
  const items = r.compliance.filter(c => c.wordings);
  line.probes = {};
  await Promise.all(items.map(async it => {
    const ps = await Promise.all(it.wordings!.map(async w => {
      const res = await api.chat({
        stage: 'probe', model, max_tokens: 1, logprobs: true,
        system: 'You check ad copy for Trupanion, a medical insurance for cats and dogs, against one compliance question. Judge only the words of the line. Answer with exactly one word: Yes or No.',
        user: `LINE (${f.label}): "${line.text}"\n\n${w} Answer Yes or No.`,
      });
      return probabilityYes(res.top);
    }));
    line.probes![it.id] = [ps[0], ps[1]];
    const valid = ps.filter((x): x is number => x !== null);
    if (!valid.length) return;
    const p = round(valid.reduce((a, b) => a + b, 0) / valid.length, 3);
    const existing = line.flags.find(x => x.rule === it.id);
    if (existing) { existing.p = p; if (!existing.by.includes('logprob') && p >= 0.25) existing.by.push('logprob'); return; }
    if (p >= LONE_LOGPROB) addFlag(line.flags, { rule: it.id, severity: 'warn', label: it.rule, source: it.source, quote: '', why: `Yes/no check only (P=${p}); the other checks didn't flag it`, by: ['logprob'], p });
  }));
}

async function objection(line: Line, r: Rules, api: Api, model: string) {
  const pr = r.personas[line.persona];
  const seed = personaSeed(line.persona);
  const voice = voiceSample(line.persona).slice(0, 700);
  const res = await api.chat({
    stage: 'objection', model, max_tokens: 70, temperature: 0.7,
    system: `You are a skeptical member of this audience: ${pr.name}${seed ? ` (${seed.household}; ${seed.occupation})` : ''}. You are not an assistant and you're not reviewing ads for anyone.${voice ? `\nHow you talk:\n${voice}` : ''}\nYou see an ad line in your feed. Say the first objection you'd actually have, in your own words, in one or two short sentences (under 30 words). No preamble, no quotation marks.`,
    user: `The ad says: "${line.text}"`,
  });
  line.objection = res.text.trim().replace(/^["“]|["”]$/g, '');
}

export async function checkBatch(batch: Batch, api: Api, emit: Emit = () => {}, onlyIds?: string[]) {
  const r = loadRules();
  const b = batch.brief;
  const idx = ruleIndex(r, b.persona);
  const started = Date.now();
  if (r.version) batch.rules_version = r.version;
  const lines = batch.lines.filter(l => !onlyIds || onlyIds.includes(l.id));

  // Deterministic first, for every line, so the grid fills with the hard flags at once.
  const embs: Record<string, number[]> = await getStore().getEmbeddings(batch.id);
  for (const l of lines) {
    const text = l.decision === 'edit' && l.edited_text ? l.edited_text : l.text;
    const det = deterministicFlags({ ...l, text }, r, b);
    l.flags = det.flags;
    l.features = det.features;
    l.chars = [...l.text].length;
    l.status = 'checking';
    // Similar, not duplicate (duplicates were removed at generation).
    const mine = embs[l.id];
    if (mine) {
      let best = 0, bestId = '';
      for (const o of batch.lines) if (o.id !== l.id && embs[o.id]) { const s = cosine(mine, embs[o.id]); if (s > best) { best = s; bestId = o.id; } }
      if (best >= SIMILAR) addFlag(l.flags, { rule: 'NEAR_DUP', severity: 'warn', label: `Close to ${bestId.split('-').pop()} (similarity ${round(best, 2)})`, source: 'Embedding similarity, text-embedding-3-small', quote: '', by: ['rule'] });
    }
    emit({ type: 'line', line: l });
  }
  batch.stats.similar_flagged = batch.lines.filter(l => l.flags.some(f => f.rule === 'NEAR_DUP')).length;
  batch.stats.timings_ms.check_deterministic = Date.now() - started;
  await saveBatch(batch);

  let saving = false;
  await pool(lines, 6, async l => {
    try {
      await Promise.all([
        modelCheck(l, r, api, b.checker_model || 'gpt-4o', idx),
        probeCheck(l, r, api, b.probe_model || 'gpt-4o-mini'),
        objection(l, r, api, b.objection_model || 'gpt-4o'),
      ]);
      reconcile(l, r);
      l.status = 'checked';
    } catch (err: any) {
      if (err instanceof CapError || api.stopped) throw err;
      addFlag(l.flags, { rule: 'CHECK_FAILED', severity: 'warn', label: 'Model checks did not finish for this line', source: 'Studio', quote: '', why: String(err?.message || err).slice(0, 120), by: ['rule'] });
      l.status = 'checked';
    }
    sortFlags(l);
    emit({ type: 'line', line: l });
    if (!saving) { saving = true; await saveBatch(batch); saving = false; }
  });
  batch.stats.timings_ms.check = Date.now() - started;
  await saveBatch(batch);
}

/**
 * Red (compliance) needs agreement: a hard rule match, or the model check and
 * the two yes/no wordings together. Any single layer alone is amber (warn), so
 * a lone model or logprob call can't turn a line red. Only for compliance items
 * that have wordings; everything else keeps its severity.
 */
function reconcile(l: Line, r: Rules) {
  for (const it of r.compliance) {
    if (!it.wordings || (it.severity || 'compliance') !== 'compliance') continue;
    const f = l.flags.find(x => x.rule === it.id);
    if (!f) continue;
    const hasModel = f.by.includes('model');
    const pr = l.probes?.[it.id]?.filter((x): x is number => x !== null) || [];
    if (f.p === undefined && pr.length) f.p = round(pr.reduce((a, b) => a + b, 0) / pr.length, 3);
    const agree = hasModel && (f.p === undefined || f.p >= 0.25);
    if (f.base === 'compliance' || agree) { f.severity = 'compliance'; continue; }
    f.severity = 'warn';
    if (hasModel && f.p !== undefined) f.why = `${f.why ? f.why + '; ' : ''}model flagged it but both yes/no wordings lean No (P=${f.p})`;
  }
}

function sortFlags(l: Line) {
  const rank = { compliance: 0, warn: 1, note: 2 };
  l.flags.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Check ad-hoc lines (planted or typed live) without a batch on disk. */
export async function checkTexts(persona: string, territory: string, items: Array<{ text: string; field: string; structure?: Structure }>, api: Api, models: { checker?: string; probe?: string; objection?: string } = {}): Promise<Line[]> {
  const r = loadRules();
  const b = makeBrief({ persona, territory, name: 'adhoc', checker_model: models.checker, probe_model: models.probe, objection_model: models.objection });
  const batch: Batch = { id: `adhoc-${stamp()}`, brief: b, created: new Date().toISOString(), lines: [], dropped: [], stats: { generated: 0, near_duplicates_removed: 0, similar_flagged: 0, timings_ms: {}, usd: {}, calls: {}, tokens: {}, usd_total: 0 } };
  batch.lines = items.map((it, i) => newLine(b, r, batch.id, i + 1, { cell: `x${i + 1}`, angle: r.territories[territory].angle, structure: it.structure || 'plain_promise', tone: b.tone, field: it.field }, it.text, 'human'));
  await api.resetRun();
  const started = Date.now();
  await checkBatch(batch, api);
  finishStats(batch, api, started);
  await saveBatch(batch);
  await api.commit(`check ${batch.id}`);
  return batch.lines;
}

// ---------- export ----------

export const CSV_COLUMNS = ['id', 'persona', 'territory', 'field', 'text', 'chars', 'angle', 'structure', 'tone', 'features', 'flags', 'objection', 'decision', 'edited_text', 'note'];

function csvCell(v: unknown): string {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+@]/.test(s)) s = `'${s}`; // stop Sheets reading a line as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows: string[][]): string { return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }

export function flagText(f: Flag): string {
  const how = f.by.join('+') + (f.p !== undefined ? ` P=${f.p}` : '');
  return `${f.severity.toUpperCase()} ${f.rule}${f.quote ? ` "${f.quote}"` : ''}${f.why ? ` (${f.why})` : ''} [${how}; source: ${f.source}]`;
}

export async function exportBatch(batchId: string): Promise<{ csv: string; md: string; csvPath: string; mdPath: string }> {
  const batch = await loadBatch(batchId);
  const r = loadRules();
  const rows = [CSV_COLUMNS, ...batch.lines.map(l => [
    l.id, l.persona, l.territory, l.field, l.text, String(l.chars), `${l.angle} ${l.angle_label}`, l.structure, l.tone_label,
    l.features.join('; '), l.flags.map(flagText).join(' | '), l.objection || '', l.decision || '', l.edited_text || '', l.note || '',
  ])];
  const csv = toCsv(rows);
  const md = markdownView(batch, r);
  const st = getStore();
  const csvPath = st.writeOutput ? await st.writeOutput(`exports/${batchId}.csv`, csv) : '';
  const mdPath = st.writeOutput ? await st.writeOutput(`exports/${batchId}.md`, md) : '';
  return { csv, md, csvPath, mdPath };
}

function markdownView(batch: Batch, r: Rules): string {
  const b = batch.brief;
  const pr = r.personas[b.persona];
  const t = r.territories[b.territory];
  const out: string[] = [
    `# ${pr.name} · ${t.name}`,
    ``,
    `Batch \`${batch.id}\` · ${batch.lines.length} lines · writer ${b.model} · tone ${toneLabel(b.tone)} · ${batch.stats.near_duplicates_removed} near-duplicates removed · ${(batch.stats.timings_ms.total / 1000 || 0).toFixed(0)}s · $${batch.stats.usd_total.toFixed(2)}`,
    ``,
    `Flags are checks against the rules file, each with its source. They are not scores.`,
  ];
  const angles = [...new Set(batch.lines.map(l => l.angle))];
  for (const a of angles) {
    const ls = batch.lines.filter(l => l.angle === a);
    out.push('', `## ${a} · ${ls[0].angle_label} (${ls.length})`);
    for (const l of ls) {
      const f = r.fields[l.field];
      const dec = l.decision ? ` · **${l.decision.toUpperCase()}**` : '';
      out.push('', `**${l.id.split('-').pop()}** · ${f?.label || l.field} · ${l.structure} · ${l.tone_label} · ${l.chars}/${f?.visible ?? '?'} chars${dec}`, '', `> ${l.text.replace(/\n/g, '\n> ')}`);
      if (l.decision === 'edit' && l.edited_text) out.push('', `> *Edited:* ${l.edited_text}`);
      if (l.features.length) out.push('', `Features: ${l.features.join(', ')}`);
      for (const fl of l.flags) out.push(`- ${fl.severity === 'compliance' ? '🟥' : fl.severity === 'warn' ? '🟧' : '⬜'} ${fl.rule}${fl.quote ? `: "${fl.quote}"` : ''}${fl.why ? ` (${fl.why})` : ''} *[${fl.source}]*`);
      if (l.objection) out.push('', `*Skeptic:* ${l.objection}`);
      if (l.note) out.push('', `*Note:* ${l.note}`);
    }
  }
  return out.join('\n') + '\n';
}

// ---------- ingest ----------

/** RFC 4180 CSV parser (quoted fields, doubled quotes, newlines in quotes, BOM). */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

export interface IngestResult { rows: number; matched: number; kept: number; edited: number; cut: number; unknown: string[]; taste_total: number; shortlist: number; shortlistPath: string }

export async function ingest(csvText: string, user?: string): Promise<IngestResult> {
  const rows = parseCsv(csvText);
  if (!rows.length) throw new Error('Empty CSV');
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  for (const need of ['id', 'decision']) if (col(need) < 0) throw new Error(`CSV has no "${need}" column`);
  const get = (r: string[], name: string) => { const i = col(name); return i >= 0 ? (r[i] ?? '').replace(/^'(?=[=+@])/, '').trim() : ''; };

  const batches = new Map<string, Batch>();
  const tasteById = new Map((await loadTaste()).map(t => [t.id, t]));
  const res: IngestResult = { rows: rows.length - 1, matched: 0, kept: 0, edited: 0, cut: 0, unknown: [], taste_total: 0, shortlist: 0, shortlistPath: '' };
  const at = new Date().toISOString();
  for (const r of rows.slice(1)) {
    const id = get(r, 'id');
    const raw = get(r, 'decision').toLowerCase();
    const decision = (['keep', 'cut', 'edit'].includes(raw) ? raw : raw.startsWith('k') ? 'keep' : raw.startsWith('c') ? 'cut' : raw.startsWith('e') ? 'edit' : '') as Line['decision'];
    const batchId = id.replace(/-L\d+$/, '');
    let batch = batches.get(batchId);
    if (!batch && (await batchExists(batchId))) { batch = await loadBatch(batchId); batches.set(batchId, batch); }
    const line = batch?.lines.find(l => l.id === id);
    if (!line || !batch) { res.unknown.push(id || '(blank id)'); continue; }
    res.matched++;
    const before = { decision: line.decision || '', edited_text: line.edited_text || '', note: line.note || '' };
    line.decision = decision;
    line.edited_text = get(r, 'edited_text');
    line.note = get(r, 'note');
    if (decision === 'edit' && !line.edited_text) line.decision = 'keep';
    const after = { decision: line.decision || '', edited_text: line.edited_text || '', note: line.note || '' };
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      line.decided_by = user || line.decided_by || 'sheet';
      line.decided_at = at;
      await getStore().recordEdit({ line_id: line.id, batch_id: batch.id, before, after, by: line.decided_by, at });
    }
    applyTaste(tasteById, line);
    if (line.decision === 'keep') res.kept++; else if (line.decision === 'edit') res.edited++; else if (line.decision === 'cut') res.cut++;
  }
  for (const b of batches.values()) await saveBatch(b);
  await saveTaste([...tasteById.values()]);
  res.taste_total = tasteById.size;
  const sl = await writeShortlist();
  res.shortlist = sl.count; res.shortlistPath = sl.path;
  return res;
}

function applyTaste(store: Map<string, TasteExample>, l: Line) {
  const d = l.decision;
  if (d === 'keep' || d === 'edit' || (d === 'cut' && l.note)) {
    store.set(l.id, {
      id: l.id, persona: l.persona, territory: l.territory, field: l.field, angle: l.angle, structure: l.structure, tone_label: l.tone_label,
      text: d === 'edit' ? l.edited_text! : l.text, original: d === 'edit' ? l.text : undefined, decision: d, note: l.note || '', batch: l.batch, at: new Date().toISOString(),
    });
  } else store.delete(l.id);
}
async function saveTaste(ex: TasteExample[]): Promise<void> { await getStore().saveTaste(ex); }

/** Decision from the UI (keep / cut / edit, note). Updates the batch and the taste store. */
export async function setDecision(batchId: string, lineId: string, patch: { decision?: Line['decision']; edited_text?: string; note?: string }, user?: string): Promise<Line> {
  const batch = await loadBatch(batchId);
  const l = batch.lines.find(x => x.id === lineId);
  if (!l) throw new Error(`No line ${lineId}`);
  const before = { decision: l.decision || '', edited_text: l.edited_text || '', note: l.note || '' };
  if (patch.decision !== undefined) l.decision = patch.decision;
  if (patch.edited_text !== undefined) l.edited_text = patch.edited_text;
  if (patch.note !== undefined) l.note = patch.note;
  if (user) l.decided_by = user;
  l.decided_at = new Date().toISOString();
  if (l.decision === 'edit' && l.edited_text) {
    // Re-run the instant checks on the edited words.
    const r = loadRules();
    const det = deterministicFlags({ ...l, text: l.edited_text }, r, batch.brief);
    const modelFlags = l.flags.filter(f => !f.by.includes('rule') || f.rule === 'NEAR_DUP');
    l.flags = [...det.flags];
    for (const f of modelFlags) addFlag(l.flags, { ...f, why: `${f.why || ''} (on the original wording)`.trim() });
    sortFlags(l);
  }
  const st = getStore();
  // A signed-off line is never rewritten: a change of wording becomes a new version, and the sign-off keeps its own.
  if (l.ready && lineHash(l) !== l.ready.sha256) {
    const versions = await st.listLineVersions(l.id);
    const h = lineHash(l);
    if (!versions.some(v => v.sha256 === h)) {
      await st.saveLineVersion({ line_id: l.id, batch_id: batchId, version: Math.max(0, ...versions.map(v => v.version)) + 1, field: l.field, text: finalText(l), sha256: h, created_by: user || 'unknown', created_at: l.decided_at!, stub: l.ready.stub });
    }
    l.ready.changed_since = true;
  } else if (l.ready) l.ready.changed_since = false;
  // Only this line is written, so decisions on other lines by other people stand.
  await st.saveLine(batchId, l);
  await st.recordEdit({ line_id: l.id, batch_id: batchId, before, after: { decision: l.decision || '', edited_text: l.edited_text || '', note: l.note || '' }, by: user || 'unknown', at: l.decided_at });
  const taste = new Map((await loadTaste()).map(t => [t.id, t]));
  applyTaste(taste, l);
  await saveTaste([...taste.values()]);
  return l;
}

/** Every decision ever made on a line, oldest first (the audit trail). */
export async function lineHistory(lineId: string) { return getStore().listEdits(lineId); }

// ---------- shortlist ----------

export interface ShortRow { stub: string; id: string; persona: string; territory: string; field: string; platform: string; format: string; text: string; angle: string; structure: string; tone: string; features: string; flags: string; note: string; compliance_flags: string[]; warn_flags: string[] }

export async function shortlist(): Promise<ShortRow[]> {
  const r = loadRules();
  const lines: Line[] = [];
  for (const b of await listBatches()) lines.push(...(await loadBatch(b.id)).lines.filter(l => l.decision === 'keep' || l.decision === 'edit'));
  lines.sort((a, b) => `${a.persona}|${a.territory}|${a.id}`.localeCompare(`${b.persona}|${b.territory}|${b.id}`));
  const counters = new Map<string, number>();
  return lines.map(l => {
    const t = r.territories[l.territory];
    const platform = r.fields[l.field]?.platform || 'META';
    const short = l.territory.startsWith(l.persona + '_') ? l.territory.slice(l.persona.length + 1) : l.territory;
    const key = `${l.persona}_${short}_${t?.format || 'STATIC'}_${platform}`;
    const v = (counters.get(key) || 0) + 1;
    counters.set(key, v);
    return {
      stub: `${l.persona}_${short}_${t?.format || 'STATIC'}_v${v}_${platform}`, id: l.id, persona: l.persona, territory: l.territory, field: l.field,
      platform, format: t?.format || '', text: l.decision === 'edit' && l.edited_text ? l.edited_text : l.text,
      angle: `${l.angle} ${l.angle_label}`, structure: l.structure, tone: l.tone_label, features: l.features.join('; '),
      flags: l.flags.map(flagText).join(' | '), note: l.note || '',
      compliance_flags: l.flags.filter(f => f.severity === 'compliance').map(f => f.rule),
      warn_flags: l.flags.filter(f => f.severity === 'warn').map(f => f.rule),
    };
  });
}

export async function writeShortlist(): Promise<{ count: number; path: string; mdPath: string; csv: string; md: string }> {
  const rows = await shortlist();
  const cols: Array<keyof ShortRow> = ['stub', 'id', 'persona', 'territory', 'field', 'platform', 'format', 'text', 'angle', 'structure', 'tone', 'features', 'flags', 'note'];
  const csv = toCsv([cols as string[], ...rows.map(x => cols.map(c => String(x[c])))]);
  const md = ['# Shortlist', '', 'Naming stubs follow PERSONA_TERRITORY_FORMAT_v#_PLATFORM (add _YYMMDD at trafficking).', ''];
  let last = '';
  for (const x of rows) {
    const g = `${x.persona} · ${x.territory}`;
    if (g !== last) { md.push(`## ${g}`, ''); last = g; }
    const oneLine = (t: string) => t.replace(/\s*\n\s*/g, ' ');
    md.push(`- \`${x.stub}\` (${x.field}): ${oneLine(x.text)}${x.note ? ` *(${oneLine(x.note)})*` : ''}`);
  }
  const mdText = md.join('\n') + '\n';
  const st = getStore();
  const p = st.writeOutput ? await st.writeOutput('shortlist.csv', csv) : '';
  const mp = st.writeOutput ? await st.writeOutput('shortlist.md', mdText) : '';
  return { count: rows.length, path: p, mdPath: mp, csv, md: mdText };
}

// ---------- compare ----------

export interface CompareLine { id: string; label: string; field: string; text: string; chars: number; angle: string; structure: string;
  /** The viewer's own star (filled in per request by viewCompare); stored per person in `stars`. */
  favourite?: boolean; note?: string;
  /** Stars by person (hosted: email; local: the name the page asked for). */
  stars?: Record<string, boolean>;
}
export interface CompareSet { name: string; brief: Brief; n_per_model: number; lines: CompareLine[]; created: string; revealed?: boolean; revealed_by?: string; revealed_at?: string; usd?: number; timings_ms?: number }

export async function compare(b: Brief, models: string[], nPer: number, api: Api, emit: Emit = () => {}): Promise<CompareSet> {
  if (models.length < 2 || models.length > 4) throw new Error('Compare takes 2 to 4 models');
  const r = loadRules();
  const started = Date.now();
  await api.resetRun();
  const name = `${b.territory}-${stamp()}`;
  const labels = shuffle(['A', 'B', 'C', 'D'].slice(0, models.length), mulberry32(hashStr(name)));
  const key: Record<string, string> = {};
  models.forEach((m, i) => { key[labels[i]] = m; });
  const cells = planCells({ ...b, name }, nPer);
  const all: CompareLine[] = [];
  await Promise.all(models.map(async (m, i) => {
    emit({ type: 'status', message: `Writer ${labels[i]} writing…` });
    const written = await writeCells(api, r, b, cells, m, 'compare');
    for (const w of written) all.push({ id: '', label: labels[i], field: w.cell.field, text: w.text, chars: [...w.text].length, angle: w.cell.angle, structure: w.cell.structure });
    emit({ type: 'status', message: `Writer ${labels[i]} done (${written.length} lines)` });
  }));
  const lines = shuffle(all, mulberry32(hashStr(name + '|rows'))).map((l, i) => ({ ...l, id: `X${String(i + 1).padStart(2, '0')}` }));
  const set: CompareSet = { name, brief: b, n_per_model: nPer, lines, created: new Date().toISOString(), usd: round(api.runTotal(), 4), timings_ms: Date.now() - started };
  const st = getStore();
  await st.saveCompare(set);
  await st.saveCompareKey(name, key);
  if (st.writeOutput) await st.writeOutput(`compare/${name}/sheet.csv`, toCsv([['id', 'persona', 'territory', 'field', 'text', 'chars', 'writer', 'favourite', 'note'], ...lines.map(l => [l.id, b.persona, b.territory, l.field, l.text, String(l.chars), l.label, '', ''])]));
  await api.commit(`compare ${name}`);
  emit({ type: 'done', batch: name });
  return set;
}
export async function listCompares(): Promise<string[]> { return getStore().listCompares(); }
export async function loadCompare(name: string): Promise<CompareSet> { return getStore().getCompare(name); }
export async function saveCompare(set: CompareSet): Promise<void> { await getStore().saveCompare(set); }
/** Who starred a line: per-person stars, plus the single unnamed star from before stars were per person. */
function starrers(l: CompareLine): string[] {
  const out = Object.entries(l.stars || {}).filter(([, v]) => v).map(([k]) => k);
  if (l.favourite && !l.stars) out.push('');
  return out;
}
/** The set as one person sees it: `favourite` is their own star, and other people's stars stay hidden until the reveal. */
export function viewCompare(set: CompareSet, user?: string): CompareSet & { stars_total?: Record<string, number> } {
  const who = (user || '').toLowerCase();
  return {
    ...set,
    lines: set.lines.map(l => {
      const { stars, ...rest } = l;
      return { ...rest, favourite: who ? !!stars?.[who] : starrers(l).length > 0, ...(set.revealed ? { stars } : {}) };
    }),
  };
}
/** Star or unstar a line for one person, or set the note. */
export async function markCompareLine(name: string, id: string, patch: { favourite?: boolean; note?: string }, user?: string): Promise<CompareLine> {
  const set = await loadCompare(name);
  const l = set.lines.find(x => x.id === id);
  if (!l) throw new Error('No such line');
  const who = (user || '').toLowerCase();
  if (patch.favourite !== undefined) {
    if (who) { l.stars = { ...(l.stars || {}), [who]: !!patch.favourite }; if (l.favourite && !Object.keys(l.stars).includes('')) delete l.favourite; }
    else l.favourite = !!patch.favourite;
  }
  if (patch.note !== undefined) l.note = String(patch.note);
  await saveCompare(set);
  return viewCompare({ ...set, lines: [l] }, user).lines[0];
}
export async function revealCompare(name: string, user?: string): Promise<{ labels: Record<string, string>; tally: Record<string, number>; by_person: Record<string, Record<string, number>> }> {
  const set = await loadCompare(name);
  if (!set.revealed) { set.revealed = true; set.revealed_by = user; set.revealed_at = new Date().toISOString(); await saveCompare(set); }
  const labels = await getStore().getCompareKey(name);
  const tally: Record<string, number> = Object.fromEntries(Object.keys(labels).map(k => [k, 0]));
  const by_person: Record<string, Record<string, number>> = {};
  for (const l of set.lines) {
    for (const p of starrers(l)) {
      tally[l.label] = (tally[l.label] || 0) + 1;
      const k = p || 'unnamed';
      by_person[k] = by_person[k] || Object.fromEntries(Object.keys(labels).map(x => [x, 0]));
      by_person[k][l.label] = (by_person[k][l.label] || 0) + 1;
    }
  }
  return { labels, tally, by_person };
}

// ---------- meta for the UI ----------

export async function meta() {
  const r = await refreshRules();
  return {
    personas: Object.fromEntries(Object.entries(r.personas).map(([k, v]) => [k, { name: v.name, default_fields: v.default_fields, triggers: v.triggers.map(t => ({ id: t.id, label: t.label })) }])),
    territories: r.territories,
    formats: FORMATS,
    fields: r.fields,
    structures: r.structures,
    tone_controls: r.tone_controls,
    needs_review: r.needs_review.length,
    spend: await getStore().spendTotal(),
    store: getStore().kind,
    studio_dir: STUDIO,
  };
}

// ---------- reference documents and the client logo ----------

// Client material: never committed. Locally the files come from the Claude
// outputs and studio folders; hosted, from the database (studio_assets, loaded
// by `studio.ts db-import`). Only listed names are served, never arbitrary paths.
// Buyer verbatims (the quote bank) stay analyst-only and aren't listed.
export interface RefDoc { id: string; title: string; kind: 'md' | 'file'; path: string; contentType: string }
const OUTPUTS = path.dirname(INPUTS);
export const REFERENCE_DOCS: RefDoc[] = [
  { id: 'readout', title: 'Persona intelligence readout (v1.2, team version)', kind: 'md', path: 'intelligence-readout-v1-team.md', contentType: 'text/markdown; charset=utf-8' },
  { id: 'readout-deck', title: 'Persona intelligence readout (v1.2 deck, .pptx)', kind: 'file', path: 'Trupanion_Persona_Intelligence_Readout_v1.2.pptx', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
];
const BRAND_ASSETS: Record<string, { path: string; contentType: string }> = { 'client-logo': { path: 'brand/trupanion-logo-white.png', contentType: 'image/png' } };
/** Asset names and where FileStore finds them on this machine. */
export function localAssets(): Record<string, { path: string; contentType: string }> {
  const out: Record<string, { path: string; contentType: string }> = {};
  for (const d of REFERENCE_DOCS) out[`doc:${d.id}`] = { path: path.join(OUTPUTS, d.path), contentType: d.contentType };
  for (const [k, v] of Object.entries(BRAND_ASSETS)) out[`brand:${k}`] = { path: path.join(STUDIO, v.path), contentType: v.contentType };
  return out;
}
export async function referenceDocs(): Promise<Array<{ id: string; title: string; kind: 'md' | 'file'; available: boolean }>> {
  const st = getStore();
  return Promise.all(REFERENCE_DOCS.map(async d => ({ id: d.id, title: d.title, kind: d.kind, available: await st.hasAsset(`doc:${d.id}`) })));
}
export async function referenceDoc(id: string) {
  const doc = REFERENCE_DOCS.find(d => d.id === id);
  if (!doc) throw new Error(`No reference document ${id}`);
  const asset = await getStore().getAsset(`doc:${id}`);
  if (!asset) throw new Error(`${doc.title} isn't available`);
  return { doc, asset };
}
export async function brandAsset(name: string) {
  if (!BRAND_ASSETS[name]) throw new Error(`No brand asset ${name}`);
  const asset = await getStore().getAsset(`brand:${name}`);
  if (!asset) throw new Error(`${name} isn't available`);
  return asset;
}

// ---------- resuming a run ----------

/** Check any lines a run left unchecked (e.g. the server restarted mid-run). */
export async function resumeChecks(batchId: string, api: Api, emit: Emit = () => {}): Promise<Batch> {
  const batch = await loadBatch(batchId);
  const todo = batch.lines.filter(l => l.status !== 'checked').map(l => l.id);
  if (!todo.length) { emit({ type: 'done', batch: batchId }); return batch; }
  const started = Date.now();
  await api.resetRun();
  emit({ type: 'status', message: `Resuming: checking ${todo.length} line${todo.length === 1 ? '' : 's'}` });
  await checkBatch(batch, api, emit, todo);
  batch.stats.timings_ms.resume = (batch.stats.timings_ms.resume || 0) + (Date.now() - started);
  for (const [k, v] of Object.entries(api.runUsd)) batch.stats.usd[k] = round((batch.stats.usd[k] || 0) + v, 4);
  batch.stats.usd_total = round(Object.values(batch.stats.usd).reduce((a, b) => a + b, 0), 4);
  await saveBatch(batch);
  await api.commit(`resume ${batchId}`);
  emit({ type: 'stats', stats: batch.stats });
  emit({ type: 'done', batch: batchId });
  return batch;
}
