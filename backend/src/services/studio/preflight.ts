// Pre-flight (step 6, after Ready for production): the finished asset for each
// signed-off naming stub is uploaded, audited (B2's engine, via
// preflightEngine.ts), and the report is reviewed. One visual can serve several
// stubs (2-3 copy lines on the same asset): it's audited once, and copy match
// runs per stub, on on-asset fields only (post copy travels with the ad). People agree or disagree
// with each flag (the round's agreement rate is Brook's 90% target), red flags
// are fixed by a new upload or overridden with a reason, and the stub is marked
// "Ready to traffic". Then Compliance (step 7): Trupanion's reviewer sees each
// asset with its codes' copy and flags, and sets pending / cleared / changes
// requested with a note; changes go back to Ready (copy) or Pre-flight (a new
// upload), and a new upload reopens the review. Exports: the features CSV for
// B3 and an asset handoff list.
// Tables: migration 017. Files: R2 (production) or Postgres (local, 25 MB cap).
// Wording: "Ready to traffic", never "approved". No scores.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type pg from 'pg';
import * as S from './engine.js';
import { latestSignoffs, setCompliance, type Signoff } from './ready.js';
import { complianceFor, platformOf, signoffOnImage, signoffVersions, type SignedField } from './versions.js';
import { getRounds, labelOf, roundOf, roundView } from './rounds.js';
import { SIZES, detectSize, expectedSizes, parseSize, roleOf, sizeOfRole, slotOf, type Size } from './sizes.js';
import { DEFAULT_REGION, parseCode, visualKey, type Region } from '../../utils/namingCode.js';
import { downloadPrivateObject, getPrivateObject, getPrivateObjectStream, isR2Enabled, putPrivateObject } from '../r2.js';
import { FatalError } from '../audit/api.js';
import type { AssetKind, AuditEngine, AuditFlag, AuditResult, SignedCopy } from './preflightEngine.js';
import { COPY_MATCH_SOURCE, REWORD_MIN, bestMatch, copyMatch, normalise } from '../audit/copyMatch.js';
import { signedOffCopy } from './preflightB2.js';

type Queryable = Pick<pg.Pool, 'query'>;

export const DB_FILE_CAP = 25 * 1024 * 1024;     // local/dev only (R2 off)
/** Bump when the audit or copy-match logic changes what a stored audit would say (2: on-asset copy match per stub; 3: the disclaimer on the last screen). */
export const PREFLIGHT_LOGIC_VERSION = 3;

/**
 * Where Pre-flight files go. Production with R2 on: the private bucket
 * (STUDIO_R2_BUCKET) or nothing: uploads are refused rather than fall back to
 * the public R2_BUCKET_NAME. Local and dev: Postgres (25 MB per file) unless a
 * private bucket is configured.
 */
export function preflightStorage(env: NodeJS.ProcessEnv = process.env, r2Enabled = isR2Enabled()): { mode: 'r2' | 'db' | 'refuse'; reason?: string } {
  const production = env.NODE_ENV === 'production';
  if (r2Enabled && env.STUDIO_R2_BUCKET) return { mode: 'r2' };
  if (production && (r2Enabled || env.ENABLE_R2_STORAGE === 'true')) return { mode: 'refuse', reason: "Pre-flight storage isn't configured: set STUDIO_R2_BUCKET to a private bucket" };
  return { mode: 'db' };
}
/**
 * Production, per file. Files go to disk on upload, stream to and from R2, and
 * reach B2 by path (AuditFile.path, linked, never read whole): no whole video
 * is held in memory at any step.
 */
export const R2_FILE_CAP = 200 * 1024 * 1024;
/** An audit that hasn't reported progress for this long died with the process (a deploy or a crash). */
export const STUCK_MINUTES = 10;
const IMAGE = /^image\/(png|jpe?g|webp|gif)$/;
const VIDEO = /^video\/(mp4|quicktime)$/;

/** A file to store: in memory (small, and tests) or on disk (uploads through the API, streamed to R2). */
export interface UploadFile { buffer?: Buffer; path?: string; size?: number; filename: string; contentType: string }
const sizeOf = (f: UploadFile) => f.buffer ? f.buffer.length : f.size ?? fs.statSync(f.path!).size;
const bytesOf = (f: UploadFile) => f.buffer ?? fs.readFileSync(f.path!);
export interface StubRow {
  stub: string; persona: string; territory: string;
  /** US or CA (v# codes and sign-offs from before regions: US). */
  region: Region;
  /** Codes on the same visual share this (the code without its line number); null for a v# code. Pre-flight suggests them as one upload. */
  visual_key: string | null;
  signoff_id: string; ready_by: string; ready_at: string;
  copy: SignedCopy[];
  /** files[].aspect: the file's size (1:1, 4:5, 9:16); null on an upload from before sizes (read as its detected size). */
  upload: { id: string; kind: AssetKind; files: Array<{ position: number; filename: string; content_type: string; size: number; aspect: Size | null }>; uploaded_by: string; uploaded_at: string; stubs: string[] } | null;
  /** The sizes this code is expected in (by format), those uploaded, and those missing (amber, noted in the handoff). */
  sizes: { expected: Size[]; uploaded: Size[]; missing: Size[] };
  audit: { id: string; status: string; usd: number; red: number; amber: number; grey: number; open_red: number; finished_at: string | null; error: string | null; stale: string | null } | null;
  /** Pre-flight passed (the creative lead's mark on the latest upload). Not the same as Ready to traffic: see `traffic`. */
  status: { status: 'open' | 'ready'; ready_by?: string; ready_at?: string; upload_id?: string };
  traffic: Traffic;
  /** The round of its sign-off; `test`: a test round's code (never handed to Add3 or B3). */
  round: string; test: boolean;
}
/**
 * Ready to traffic = Pre-flight passed AND Trupanion's compliance cleared on the
 * current upload and the current signed-off wording (Brook, 30 Sep). Codes
 * marked ready before the gate existed stay ready, flagged "compliance not
 * recorded", until a compliance decision is recorded for them.
 */
export interface Traffic {
  ready: boolean;
  preflight: 'passed' | 'open';
  compliance: 'pending' | 'cleared' | 'changes_requested';
  /** "Ready to traffic", or the two parts: "Pre-flight passed · Compliance pending". */
  words: string;
  /** What's outstanding, in words. */
  blocker?: string;
  legacy?: boolean;
}
/** When "Ready to traffic" started needing compliance. Pre-flight marks before this, with no compliance recorded, stay ready (legacy). */
export const COMPLIANCE_GATE_FROM = '2026-09-30T14:30:00Z';

const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
const safe = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 100);
const kindOf = (files: UploadFile[]): AssetKind => {
  if (files.some(f => VIDEO.test(f.contentType))) {
    if (files.length > 1) throw new Error('Upload one video on its own');
    return 'video';
  }
  if (!files.every(f => IMAGE.test(f.contentType))) throw new Error('Upload images (PNG, JPG, WebP) or one video (MP4, MOV)');
  return files.length > 1 ? 'carousel' : 'static';
};
const fmtMb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
/**
 * Does the uploaded kind fit the naming code's format? A note, never a block
 * (formats in codes, either form: ST, CAR, VID, UGC; STATIC etc. read the same).
 */
export function formatNote(stub: string, kind: AssetKind): string | null {
  const p = parseCode(stub, null);
  const fmt = 'error' in p ? null : p.format;
  if (!fmt || fmt === 'TT') return null;
  const want: AssetKind[] = fmt === 'ST' ? ['static'] : fmt === 'CAR' ? ['carousel'] : ['video'];
  if (want.includes(kind)) return null;
  const name = ({ ST: 'a static image', CAR: 'carousel cards', VID: 'a video', UGC: 'a video (UGC)' } as Record<string, string>)[fmt];
  return `This code is for ${name}, but a ${kind} was uploaded. Check it’s the right asset, or that the code’s format is right.`;
}

/**
 * Fields that run in the post (never on the asset): listed on the report, not compared. The Meta headline joined them
 * on 30 Sep (Brook): text on the image is its own field now, and a caveat that belongs with a claim is checked inside
 * the ad at Ready (version check "split claims"), not against the image.
 */
export const POST_COPY_FIELDS = new Set(['meta_primary', 'meta_headline', 'meta_description', 'tiktok_caption']);

/**
 * Copy match for one stub, on what was read off the visual: B2's own rules
 * (services/audit/copyMatch.ts). Only on-asset fields are compared (the TikTok
 * hook and on-image text; a carousel's text card by card, see cardMatch). Red for
 * a required caveat missing from on-asset text or a card's text missing from the
 * asset; a hook that differs is amber. The headline is post copy (30 Sep).
 */
export function copyMatchForStub(copy: SignedCopy[], assetText: Array<{ where: string; text: string }>, rules: any, kind: AssetKind) {
  const onAsset = copy.filter(c => !POST_COPY_FIELDS.has(c.field));
  const cards = onAsset.filter(c => c.card);
  const res = copyMatch(signedOffCopy(onAsset), assetText, rules);
  // A carousel's cards are matched card by card below; B2's whole-asset row for the joined text would only repeat them.
  // Its caveat check (COPY_CAVEAT) still runs on all the on-asset text.
  const rows: any[] = cards.length ? res.rows.filter(x => x.field !== 'on_image') : res.rows;
  const flags = cards.length ? res.flags.filter(f => !(f.rule === 'COPY_MATCH' && /On-image text/.test(f.label))) : res.flags;
  const cardOf = (where?: string) => {
    if (kind === 'video' || !where) return undefined;
    const m = /card (\d+)/i.exec(where);
    return m ? Number(m[1]) - 1 : /^image/i.test(where) ? 0 : undefined;
  };
  const out = flags.map((f): AuditFlag => ({
    rule: f.rule, severity: f.severity, label: f.label, source: f.source, quote: f.quote, why: f.why, where: f.where, check: 'copy_match',
    frame: cardOf(f.where) !== undefined ? { asset_position: cardOf(f.where), label: f.where } : undefined,
  }));
  const cm = cardMatch(cards, assetText);
  return { rows: [...rows, ...cm.rows], flags: [...out, ...cm.flags] };
}

/**
 * Carousel cards (item E): card k's signed-off text must be on card k. Found on another card: amber ("on card 3,
 * expected card 2"). Reworded on its card: amber, both quoted. Not on the asset at all: red.
 */
export function cardMatch(cards: SignedCopy[], assetText: Array<{ where: string; text: string }>) {
  const rows: Array<{ field: 'on_image'; card: number; signed_off: string; found: string; similarity: number; status: string; found_on?: number }> = [];
  const flags: AuditFlag[] = [];
  const onCard = (k: number) => assetText.filter(t => new RegExp(`^card ${k}\\b`, 'i').test(t.where)).map(t => t.text).join('\n');
  const cardNos = [...new Set(assetText.map(t => Number(/^card (\d+)/i.exec(t.where)?.[1])).filter(Boolean))];
  const frame = (k: number) => ({ asset_position: k - 1, label: `card ${k}` });
  for (const c of [...cards].sort((a, b) => a.card! - b.card!)) {
    const k = c.card!;
    const mine = onCard(k);
    if (mine && normalise(mine).includes(normalise(c.text))) { rows.push({ field: 'on_image', card: k, signed_off: c.text, found: normalise(c.text), similarity: 1, status: 'match' }); continue; }
    const other = cardNos.filter(j => j !== k).find(j => normalise(onCard(j)).includes(normalise(c.text)));
    if (other) {
      rows.push({ field: 'on_image', card: k, signed_off: c.text, found: normalise(c.text), similarity: 1, status: 'wrong card', found_on: other });
      flags.push({ rule: 'COPY_CARD_ORDER', severity: 'amber', label: `Card ${k}'s text is on card ${other}`, source: COPY_MATCH_SOURCE, quote: `signed off for card ${k}: "${c.text.trim()}"`, why: `On card ${other}, expected card ${k}`, where: `card ${other}`, check: 'copy_match', frame: frame(other) });
      continue;
    }
    const m = mine ? bestMatch(c.text, mine) : { similarity: 0, excerpt: '' };
    if (m.similarity >= REWORD_MIN) {
      rows.push({ field: 'on_image', card: k, signed_off: c.text, found: m.excerpt, similarity: m.similarity, status: 'reworded' });
      flags.push({ rule: 'COPY_MATCH', severity: 'amber', label: `Card ${k}'s text differs from the signed-off wording`, source: COPY_MATCH_SOURCE, quote: `signed off: "${c.text.trim()}" · on card ${k}: "${m.excerpt}"`, why: `${Math.round(m.similarity * 100)}% of the words match, in order`, where: `card ${k}`, check: 'copy_match', frame: frame(k) });
      continue;
    }
    rows.push({ field: 'on_image', card: k, signed_off: c.text, found: m.excerpt, similarity: m.similarity, status: 'not on asset' });
    flags.push({ rule: 'COPY_CARD_MISSING', severity: 'red', label: `Card ${k}'s signed-off text isn't on the asset`, source: COPY_MATCH_SOURCE, quote: `signed off for card ${k}: "${c.text.trim()}"`, why: mine ? `Card ${k} reads: "${mine.slice(0, 80)}"` : `Nothing was read on card ${k}`, where: `card ${k}`, check: 'copy_match', ...(k <= cardNos.length ? { frame: frame(k) } : {}) });
  }
  return { rows, flags };
}

/** Case, punctuation, spacing and line breaks don't count: small print split over lines still matches. */
const normWords = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The approved disclaimer on the last screen (rules v2.7 `disclaimer`): on the
 * final card of a carousel, the image of a static, or the last video frame,
 * never the voice-over. Off, with a grey note, until the rules carry the text.
 * A match is the whole text in order, or (for OCR slips) at least 90% of its
 * words present on that screen.
 */
export function disclaimerCheck(rules: any, assetText: Array<{ where: string; text: string }>, kind: AssetKind, cards = 1): AuditFlag[] {
  const d = rules?.disclaimer;
  if (!d) return [];
  const base = { rule: d.id || 'DISCLAIMER_LAST_SCREEN', source: d.source, check: 'disclaimer' };
  if (!String(d.text || '').trim()) return [{ ...base, severity: 'grey', label: 'Disclaimer check off: no approved text in the rules yet' }];
  const screens = assetText.filter(t => t.where !== 'voice-over');
  const where = kind === 'carousel' ? `card ${cards}` : kind === 'static' ? 'image' : 'last frame';
  const last = kind === 'carousel' ? screens.find(t => t.where === where)
    : kind === 'static' ? screens.find(t => t.where === 'image') || screens[0]
    : screens.find(t => /last frame/.test(t.where));
  if (kind === 'video' && !last) return [{ ...base, severity: 'grey', label: 'Disclaimer not checked: the last video frame wasn’t read', why: 'No frames from the video (ffmpeg couldn’t read it); check the last screen by eye' }];
  const want = normWords(d.text), have = normWords(last?.text || '');
  const words = want.split(' ').filter(w => w.length > 2);
  const present = new Set(have.split(' '));
  const coverage = words.length ? words.filter(w => present.has(w)).length / words.length : 1;
  if (have.includes(want) || coverage >= 0.9) return [];
  const frame = kind === 'video' ? { label: last!.where } : { asset_position: kind === 'carousel' ? cards - 1 : 0, label: last?.where || where };
  return [{
    ...base, severity: 'red', label: d.rule, where: last?.where || where, frame,
    quote: `approved: "${d.text}"`,
    why: last?.text?.trim() ? `The approved disclaimer isn't on ${last.where} (${Math.round(coverage * 100)}% of its words found)` : `${last?.where || where} has no readable text`,
  }];
}

/**
 * Why a finished audit may be out of date: checked under older rules, or by an
 * older version of the checks. Never re-run automatically (it costs money).
 */
export function staleness(a: { status: string; rules_version?: string | null; result?: any }, currentRules = (() => { try { return S.loadRules().version; } catch { return undefined; } })()): string | null {
  if (a.status !== 'done') return null;
  if (currentRules && a.rules_version && a.rules_version !== currentRules) return `Checked under older rules (${a.rules_version}; live: ${currentRules}): audit again`;
  if ((a.result?.logic_version ?? 1) < PREFLIGHT_LOGIC_VERSION) return 'Checked by an older version of the checks: audit again';
  return null;
}

export class Preflight {
  constructor(private db: Queryable, private engine: AuditEngine, private opts: { storage?: 'r2' | 'db' } = {}) {}
  get storage(): 'r2' | 'db' {
    if (this.opts.storage) return this.opts.storage;
    const s = preflightStorage();
    if (s.mode === 'refuse') throw Object.assign(new Error(s.reason), { status: 503 });
    return s.mode;
  }
  /** For /meta: the storage mode, or why uploads are refused (without throwing). */
  get storageStatus(): string { try { return this.storage; } catch (e: any) { return `refused: ${e.message}`; } }
  get engineName() { return this.engine.name; }

  // ---------- what can be uploaded: the latest sign-off per persona × territory ----------

  private latestSignoffs(): Promise<Signoff[]> { return latestSignoffs(); }

  /**
   * The signed-off lines behind a code (one live version): its fields, and its visual's on-image text, which belongs to
   * the visual and so is on every code of it (Brook, 30 Sep).
   */
  private partsOf(s: Signoff, stub: string): SignedField[] {
    const v = signoffVersions(s).find(x => x.code === stub);
    if (!v) return [];
    const r = S.loadRules();
    // A static's one on-image line, or a carousel's cards in order.
    const oi = signoffOnImage(s).filter(o => o.visual === v.visual && platformOf(o.field, r) === v.platform).sort((a, b) => (a.card || 0) - (b.card || 0));
    return [...Object.values(v.fields), ...oi];
  }
  /** The signed-off copy for a code, with field labels. */
  private copyFor(s: Signoff, stub: string): SignedCopy[] {
    const r = S.loadRules();
    return this.partsOf(s, stub).map(l => {
      const card = (l as { card?: number }).card;
      return { line_id: l.line_id, field: l.field, label: `${r.fields[l.field]?.label || l.field}${card ? `, card ${card}` : ''}`, text: l.text, version: l.version, ...(card ? { card } : {}) };
    });
  }

  /** The codes to upload for: the active round's by default (`round: 'all'` for every round, or a round's id). */
  async stubs(filter: { persona?: string; territory?: string; region?: string; round?: string } = {}): Promise<StubRow[]> {
    await this.expireStuck();
    const out: StubRow[] = [];
    const view = await roundView(filter.round);
    const rules = await S.getStore().getRules();
    for (const s of await latestSignoffs({ ...filter, view })) {
      for (const stub of signoffVersions(s).map(v => v.code).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
        const upload = await this.latestUpload(stub);
        out.push({
          stub, persona: s.persona, territory: s.territory, region: s.region || DEFAULT_REGION, visual_key: visualKey(stub), signoff_id: s.id, ready_by: s.ready_by, ready_at: s.ready_at,
          copy: this.copyFor(s, stub),
          upload, sizes: this.sizesOf(stub, upload, rules), audit: await this.latestAuditSummary(stub), status: await this.status(stub), traffic: await this.traffic(stub),
          round: roundOf(s), test: view.isTest(roundOf(s)),
        });
      }
    }
    return out;
  }

  /** The sizes a code is expected in, uploaded (an upload from before sizes: its first expected size), and missing. */
  private sizesOf(stub: string, upload: StubRow['upload'], rules: any): StubRow['sizes'] {
    const expected = expectedSizes(stub, rules);
    const uploaded = upload ? SIZES.filter(x => upload.files.some(f => (f.aspect || expected[0]) === x)) : [];
    return { expected, uploaded, missing: upload ? expected.filter(x => !uploaded.includes(x)) : [...expected] };
  }

  private async findStub(stub: string): Promise<{ signoff: Signoff; copy: SignedCopy[] }> {
    for (const s of await this.latestSignoffs()) if (signoffVersions(s).some(v => v.code === stub)) return { signoff: s, copy: this.copyFor(s, stub) };
    throw new Error(`${stub} isn't in a Ready for production sign-off`);
  }

  // ---------- uploads ----------

  /** Upload the visual for a stub; `also` lists other signed-off stubs that run on the same visual. */
  /**
   * `sizes`: each file's size (1:1, 4:5, 9:16), as the person set it; otherwise read from the image, or the file name,
   * else the code's first expected size. A carousel is its cards in each size (card order within a size).
   */
  async upload(stub: string, files: UploadFile[], user?: string, also: string[] = [], sizes: Array<string | null | undefined> = []): Promise<{ upload_id: string; kind: AssetKind; storage: 'r2' | 'db'; stubs: string[]; format_notes: string[]; sizes: Array<{ size: Size; files: string[] }>; estimate: { usd: number; seconds: number; sizes: number } }> {
    if (!files.length) throw new Error('Choose a file to upload');
    const { signoff } = await this.findStub(stub);
    const stubs = [stub, ...new Set(also.filter(x => x && x !== stub))];
    const notes: string[] = [];
    for (const x of stubs.slice(1)) {
      // One visual, several copy lines, in one ad set: the audit runs once, for this persona, so the codes must share it.
      const o = (await this.findStub(x)).signoff;
      if (o.persona !== signoff.persona || o.territory !== signoff.territory) throw new Error(`${x} is for another persona or territory: the same visual can serve codes of the same persona and territory only (upload it to ${x} separately so it's audited for that persona)`);
      // US and Canada run as separate ads: a Canadian version is its own visual.
      if ((o.region || DEFAULT_REGION) !== (signoff.region || DEFAULT_REGION)) throw new Error(`${x} is for ${o.region === 'CA' ? 'Canada' : 'the US'}: US and Canadian ads are separate visuals (upload it to ${x} separately)`);
      // The visual letter was fixed at sign-off; a shared upload across letters is allowed, with a note.
      if (visualKey(x) && visualKey(stub) && visualKey(x) !== visualKey(stub)) notes.push(`${x} was signed off on another visual than ${stub} (the letters differ). The codes stay as signed off; check the same asset is meant for both.`);
    }
    // Files by size, in the order given within each size (card order).
    const expected = expectedSizes(stub, await S.getStore().getRules());
    const sized = files.map((f, i) => ({ f, size: parseSize(sizes[i]) || detectSize({ filename: f.filename, buffer: f.buffer, path: f.path }) || expected[0] }));
    const groups = SIZES.map(size => ({ size, files: sized.filter(x => x.size === size).map(x => x.f) })).filter(g => g.files.length);
    const kinds = groups.map(g => kindOf(g.files));
    if (new Set(kinds).size > 1) throw new Error(`Every size should be the same kind of asset (got ${groups.map((g, i) => `${g.size}: ${kinds[i]}`).join(', ')})`);
    const kind = kinds[0];
    if (kind === 'carousel' && new Set(groups.map(g => g.files.length)).size > 1) notes.push(`The sizes have different numbers of cards (${groups.map(g => `${g.size}: ${g.files.length}`).join(', ')}). Check each size has every card.`);
    const missing = expected.filter(x => !groups.some(g => g.size === x));
    if (missing.length) notes.push(`${missing.join(' and ')} not uploaded: shown as a missing size (amber) until it is.`);
    const extra = groups.filter(g => !expected.includes(g.size)).map(g => g.size);
    if (extra.length) notes.push(`${extra.join(' and ')} isn't expected for this code (${expected.join(', ')}); it's audited all the same.`);
    const cap = this.storage === 'r2' ? R2_FILE_CAP : DB_FILE_CAP;
    const big = files.find(f => sizeOf(f) > cap);
    if (big) throw new Error(`${big.filename} is ${fmtMb(sizeOf(big))}; the limit is ${fmtMb(cap)} per file${this.storage === 'db' ? ' when files are kept in the database (local; production uses R2)' : ''}`);
    const uploadId = id('up');
    await this.db.query(
      `INSERT INTO studio_asset_uploads (id, stub, persona, territory, signoff_id, kind, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uploadId, stub, signoff.persona, signoff.territory, signoff.id, kind, user ?? null]);
    for (const g of groups) for (let i = 0; i < g.files.length; i++) await this.putFile(uploadId, stub, slotOf(g.size) * 100 + i, g.files[i], roleOf(g.size));
    for (const x of stubs) {
      await this.db.query(`INSERT INTO studio_upload_stubs (upload_id, stub) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [uploadId, x]);
      // A new upload replaces what was ready: each stub it serves is open until it's reviewed again.
      await this.setStatusRow(x, 'open', uploadId, null, null);
      await S.getStore().recordEdit({ line_id: `asset:${x}`, batch_id: 'preflight', before: null, after: { upload: uploadId, kind, files: files.map(f => f.filename), same_visual_as: stubs.filter(y => y !== x) }, by: user || 'unknown', at: new Date().toISOString() });
    }
    // A new visual reopens Compliance for every code it serves: a review was of the earlier asset (kept in the history).
    for (const x of stubs) await this.reopenCompliance(x, uploadId, user);
    // The estimate is worked out now, from the files already here, and reused by the audit (no second download).
    // One audit per size: the estimate is the sum.
    const estimate = await this.estimateSizes({ stub, persona: signoff.persona, territory: signoff.territory, kind }, groups.map(g => g.files));
    await this.db.query(`UPDATE studio_asset_uploads SET estimate = $2 WHERE id = $1`, [uploadId, estimate]);
    return { upload_id: uploadId, kind, storage: this.storage, stubs, format_notes: [...stubs.map(x => formatNote(x, kind)).filter(Boolean) as string[], ...notes], sizes: groups.map(g => ({ size: g.size, files: g.files.map(f => f.filename) })), estimate };
  }

  private async putFile(uploadId: string, stub: string, position: number, f: UploadFile, role: string) {
    const storage = this.storage;
    const key = storage === 'r2' ? `studio/preflight/${safe(stub)}/${uploadId}/${role === 'frame' ? 'frames/' : ''}${position}-${safe(f.filename)}` : null;
    if (storage === 'r2') await putPrivateObject(key!, f.buffer ?? { path: f.path!, size: sizeOf(f) }, f.contentType);
    await this.db.query(
      `INSERT INTO studio_upload_files (upload_id, position, filename, content_type, size, storage, r2_key, data, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (upload_id, position) DO UPDATE SET filename = EXCLUDED.filename, content_type = EXCLUDED.content_type, size = EXCLUDED.size,
         storage = EXCLUDED.storage, r2_key = EXCLUDED.r2_key, data = EXCLUDED.data, role = EXCLUDED.role`,
      [uploadId, position, f.filename, f.contentType, sizeOf(f), storage, key, storage === 'db' ? bytesOf(f) : null, role]);
  }

  /** A stored file (an asset, or a frame thumbnail from the audit), for the signed-in API to send. */
  async file(uploadId: string, position: number): Promise<{ filename: string; contentType: string; data: Buffer }> {
    const r = await this.db.query(`SELECT filename, content_type, storage, r2_key, data FROM studio_upload_files WHERE upload_id = $1 AND position = $2`, [uploadId, position]);
    const f = r.rows[0];
    if (!f) throw new Error('No such file');
    return { filename: f.filename, contentType: f.content_type, data: f.storage === 'r2' ? await getPrivateObject(f.r2_key) : f.data };
  }

  /** The same, streamed from R2 (a video isn't read into memory to send it). */
  async fileStream(uploadId: string, position: number): Promise<{ filename: string; contentType: string; size: number; stream?: NodeJS.ReadableStream; data?: Buffer }> {
    const f = (await this.db.query(`SELECT filename, content_type, size, storage, r2_key, data FROM studio_upload_files WHERE upload_id = $1 AND position = $2`, [uploadId, position])).rows[0];
    if (!f) throw new Error('No such file');
    return { filename: f.filename, contentType: f.content_type, size: Number(f.size), ...(f.storage === 'r2' ? { stream: await getPrivateObjectStream(f.r2_key) } : { data: f.data }) };
  }

  /** Copy an upload's asset files to a folder (streamed from R2), in card order. */
  /** Each file with its size: as stored, or (an upload from before sizes) read from the file, else null. */
  private async materialise(uploadId: string, dir: string) {
    const rows = (await this.db.query(`SELECT position, filename, content_type, storage, r2_key, role FROM studio_upload_files WHERE upload_id = $1 AND role LIKE 'asset%' ORDER BY position`, [uploadId])).rows;
    const out: Array<{ position: number; path: string; filename: string; contentType: string; aspect: Size | null }> = [];
    for (const f of rows) {
      const p = path.join(dir, `${f.position}-${safe(f.filename)}`);
      if (f.storage === 'r2') await downloadPrivateObject(f.r2_key, p);
      else fs.writeFileSync(p, (await this.db.query(`SELECT data FROM studio_upload_files WHERE upload_id = $1 AND position = $2`, [uploadId, f.position])).rows[0].data);
      out.push({ position: f.position, path: p, filename: f.filename, contentType: f.content_type, aspect: sizeOfRole(f.role) || detectSize({ filename: f.filename, path: p }) });
    }
    return out;
  }
  /** Files grouped by size, in size order; a file with no size goes to the code's first expected size. */
  private bySize<T extends { aspect: Size | null }>(rows: T[], stub: string, rules: any): Array<{ size: Size; rows: T[] }> {
    const first = expectedSizes(stub, rules)[0];
    return SIZES.map(size => ({ size, rows: rows.filter(r => (r.aspect || first) === size) })).filter(g => g.rows.length);
  }

  /** The latest upload serving a stub (its own, or a shared visual). */
  private async latestUpload(stub: string): Promise<StubRow['upload']> {
    const u = (await this.db.query(
      `SELECT u.* FROM studio_asset_uploads u JOIN studio_upload_stubs us ON us.upload_id = u.id WHERE us.stub = $1 ORDER BY u.uploaded_at DESC LIMIT 1`, [stub])).rows[0];
    if (!u) return null;
    const files = (await this.db.query(`SELECT position, filename, content_type, size, role FROM studio_upload_files WHERE upload_id = $1 AND role LIKE 'asset%' ORDER BY position`, [u.id])).rows
      .map(({ role, ...f }) => ({ ...f, size: Number(f.size), aspect: sizeOfRole(role) }));
    const stubs = (await this.db.query(`SELECT stub FROM studio_upload_stubs WHERE upload_id = $1 ORDER BY stub`, [u.id])).rows.map(x => x.stub);
    return { id: u.id, kind: u.kind, files, uploaded_by: u.uploaded_by, uploaded_at: new Date(u.uploaded_at).toISOString(), stubs };
  }

  // ---------- audits ----------

  /** Cost and time, from files in hand (B2 reads each file once; the mock needs none). */
  private async estimateFrom(u: { stub: string; persona: string; territory: string; kind: AssetKind }, files: UploadFile[]): Promise<{ usd: number; seconds: number }> {
    const { copy } = await this.findStub(u.stub);
    const st = S.getStore();
    return this.engine.estimate({
      ...u, copy, rules: await st.getRules(), rubric: await S.rubricFor(),
      files: files.map(f => ({ path: f.path || '', filename: f.filename, contentType: f.contentType, data: this.engine.name === 'mock' || f.path ? undefined : bytesOf(f) })),
    });
  }

  /** One audit per size: the estimate is the sum over the sizes uploaded. */
  private async estimateSizes(u: { stub: string; persona: string; territory: string; kind: AssetKind }, groups: UploadFile[][]): Promise<{ usd: number; seconds: number; sizes: number }> {
    let usd = 0, seconds = 0;
    for (const g of groups) { const e = await this.estimateFrom(u, g); usd += e.usd; seconds += e.seconds; }
    return { usd: Math.round(usd * 10000) / 10000, seconds, sizes: groups.length };
  }

  /** The estimate stored at upload; for an older upload, worked out once from the stored files and kept. */
  async estimate(uploadId: string): Promise<{ usd: number; seconds: number }> {
    const u = (await this.db.query(`SELECT * FROM studio_asset_uploads WHERE id = $1`, [uploadId])).rows[0];
    if (!u) throw new Error('No such upload');
    if (u.estimate) return u.estimate;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-estimate-'));
    try {
      const files = await this.materialise(uploadId, tmp);
      const e = await this.estimateSizes(u, this.bySize(files, u.stub, await S.getStore().getRules()).map(g => g.rows));
      await this.db.query(`UPDATE studio_asset_uploads SET estimate = $2 WHERE id = $1`, [uploadId, e]);
      return e;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  /**
   * Audits left 'queued' or 'running' by a process that has gone (a deploy or a
   * crash mid-audit) are marked failed and retryable. A live audit reports
   * progress (heartbeat_at) well inside STUCK_MINUTES.
   */
  async expireStuck(): Promise<number> {
    const r = await this.db.query(
      `UPDATE studio_audits SET status = 'failed', finished_at = NOW(), result = '{"retryable": true}',
         error = 'The audit stopped part way (the server restarted). The upload is kept: run the audit again.'
       WHERE status IN ('queued', 'running') AND COALESCE(heartbeat_at, started_at) < NOW() - make_interval(mins => $1)`, [STUCK_MINUTES]);
    return r.rowCount ?? 0;
  }

  async createAudit(uploadId: string, user?: string): Promise<string> {
    const u = (await this.db.query(`SELECT stub FROM studio_asset_uploads WHERE id = $1`, [uploadId])).rows[0];
    if (!u) throw new Error('No such upload');
    const auditId = id('au');
    await this.db.query(`INSERT INTO studio_audits (id, upload_id, stub, status, engine, started_by) VALUES ($1, $2, $3, 'queued', $4, $5)`, [auditId, uploadId, u.stub, this.engine.name, user ?? null]);
    return auditId;
  }

  /** Run a queued audit: fetch the files to a temp folder, run the engine, store flags, frames and spend. */
  async runAudit(auditId: string, emit: (e: S.StudioEvent) => void = () => {}, user?: string): Promise<AuditResult> {
    const a = (await this.db.query(`SELECT a.*, u.persona, u.territory, u.kind FROM studio_audits a JOIN studio_asset_uploads u ON u.id = a.upload_id WHERE a.id = $1`, [auditId])).rows[0];
    if (!a) throw new Error('No such audit');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-preflight-'));
    await this.db.query(`UPDATE studio_audits SET status = 'running', started_at = NOW(), heartbeat_at = NOW() WHERE id = $1`, [auditId]);
    let beat = Date.now();
    const heartbeat = () => {
      if (Date.now() - beat < 30_000) return;
      beat = Date.now();
      this.db.query(`UPDATE studio_audits SET heartbeat_at = NOW() WHERE id = $1 AND status = 'running'`, [auditId]).catch(() => {});
    };
    try {
      const rows = await this.materialise(a.upload_id, tmp);
      const { copy } = await this.findStub(a.stub);
      const rules = await S.getStore().getRules();   // the full file: B2 uses the visual-only items Studio's text checks skip
      const rubric = await S.rubricFor(rules);
      if (!rubric) throw new Error('The live rules have no M3 rubric: an admin uploads studio-rules.json v2.6 or later in the Rules view');
      // One audit per size (Meta picks the size per placement, so each has to stand on its own). Flags say which size.
      const groups = this.bySize(rows, a.stub, rules);
      const multi = groups.length > 1 || expectedSizes(a.stub, rules).length > 1;
      const tag = (size: Size, f: AuditFlag): AuditFlag & { size?: Size } => (multi ? { ...f, label: `${size}: ${f.label}`, size } : f);
      const served = (await this.db.query(`SELECT stub FROM studio_upload_stubs WHERE upload_id = $1 ORDER BY stub`, [a.upload_id])).rows.map(x => x.stub);
      const copyByStub: Record<string, any[]> = {};
      // Each flag with the files of its size (its frame points into them) and, for copy match, the code it's for.
      const found: Array<{ flag: AuditFlag; rows: typeof rows; stub: string | null; raw?: AuditFlag; size?: Size }> = [];
      const results: Array<{ size: Size; result: AuditResult }> = [];
      for (const g of groups) {
        emit({ type: 'status', message: `Auditing ${a.stub} (${a.kind}${multi ? `, ${g.size}` : ''})` });
        const files = g.rows.map(f => ({ path: f.path, filename: f.filename, contentType: f.contentType }));
        const r = await this.engine.run({ stub: a.stub, persona: a.persona, territory: a.territory, kind: a.kind, files, copy, rules, rubric }, message => { heartbeat(); emit({ type: 'status', message: multi ? `${g.size}: ${message}` : message }); });
        results.push({ size: g.size, result: r });
        const text = r.asset_text || [{ where: a.kind === 'static' ? 'image' : 'asset', text: r.text_found }];
        // Copy match is Studio's, per stub the visual serves (the engine's own copy flags are replaced by these).
        for (const f of r.flags.filter(f => f.check !== 'copy_match')) found.push({ flag: tag(g.size, f), rows: g.rows, stub: null, raw: f, size: g.size });
        for (const f of disclaimerCheck(rules, text, a.kind, g.rows.length)) found.push({ flag: tag(g.size, f), rows: g.rows, stub: null, raw: f, size: g.size });
        for (const st of served) {
          const cm = copyMatchForStub((await this.findStub(st)).copy, r.asset_text || [{ where: 'asset', text: r.text_found }], rules, a.kind);
          copyByStub[st] = [...(copyByStub[st] || []), ...cm.rows.map(x => (multi ? { ...x, size: g.size } : x))];
          for (const f of cm.flags) found.push({ flag: tag(g.size, f), rows: g.rows, stub: st, raw: f, size: g.size });
        }
      }
      // The same finding in every size uploaded (a cross-persona note, a banned word in the shared copy) is one flag, not
      // one per size.
      if (groups.length > 1) {
        const keyOf = (x: (typeof found)[number]) => JSON.stringify([x.stub, x.raw!.rule, x.raw!.severity, x.raw!.label, x.raw!.quote ?? '', x.raw!.why ?? '']);
        const sizesBy = new Map<string, Set<Size>>();
        for (const x of found) if (x.raw) sizesBy.set(keyOf(x), (sizesBy.get(keyOf(x)) || new Set()).add(x.size!));
        const kept: typeof found = [];
        const done = new Set<string>();
        for (const x of found) {
          if (!x.raw || sizesBy.get(keyOf(x))!.size < groups.length) { kept.push(x); continue; }
          if (done.has(keyOf(x))) continue;
          done.add(keyOf(x));
          kept.push({ ...x, flag: x.raw });
        }
        found.splice(0, found.length, ...kept);
      }
      // An expected size not uploaded: amber (not red); Pre-flight can still be marked passed, and the handoff notes it.
      for (const st of served) {
        for (const m of expectedSizes(st, rules).filter(x => !groups.some(g => g.size === x))) {
          found.push({ stub: st, rows: [], flag: { rule: 'SIZE_MISSING', severity: 'amber', label: `${m} not uploaded`, check: 'sizes', size: m,
            source: 'Asset sizes (client WBS: statics and videos 1:1, 4:5 and 9:16; carousels 1:1 and 4:5; TikTok 9:16)',
            why: `Meta picks the size per placement; without ${m} it crops another size to fit` } as AuditFlag });
        }
      }
      // One result for the upload: the sizes together (features: the strongest reading of any size).
      const features: Record<string, number> = {};
      for (const { result: r } of results) for (const [k, v] of Object.entries(r.features || {})) features[k] = Math.max(features[k] ?? 0, v);
      const result: AuditResult = {
        ...results[0].result, flags: [], features,
        usd: results.reduce((t, x) => t + (x.result.usd || 0), 0),
        text_found: results.map(x => (multi ? `[${x.size}] ${x.result.text_found}` : x.result.text_found)).join('\n'),
        asset_text: results.flatMap(x => (x.result.asset_text || []).map(t => (multi ? { ...t, where: `${x.size} ${t.where}` } : t))),
        notes: [...new Set(results.flatMap(x => x.result.notes || []))],
        frames_unavailable: results.some(x => x.result.frames_unavailable),
      };
      // Frames the flags rest on are kept as thumbnails next to the upload.
      let framePos = 1000;
      const flags: Array<any> = [];
      for (const { flag: f, rows: gRows, stub: forStub } of [...found.filter(x => !x.stub), ...found.filter(x => x.stub)]) {
        const { frame, ...rest } = f;
        let frameRef: { upload_id?: string; position?: number; label?: string; description?: string } | undefined;
        if (frame?.path && fs.existsSync(frame.path)) {
          const pos = framePos++;
          await this.putFile(a.upload_id, a.stub, pos, { buffer: fs.readFileSync(frame.path), filename: path.basename(frame.path), contentType: /\.png$/i.test(frame.path) ? 'image/png' : 'image/jpeg' }, 'frame');
          frameRef = { upload_id: a.upload_id, position: pos, label: frame.label };
        } else if (frame && frame.asset_position !== undefined && frame.asset_position < gRows.length) {
          frameRef = { upload_id: a.upload_id, position: gRows[frame.asset_position].position, label: frame.label };
        } else if (frame) frameRef = { label: frame.label, description: frame.description };
        flags.push({ ...rest, frame: frameRef, for_stub: forStub });
      }
      await this.db.query(`DELETE FROM studio_audit_flags WHERE audit_id = $1`, [auditId]);
      for (let i = 0; i < flags.length; i++) {
        const { rule, severity, for_stub, ...body } = flags[i];
        await this.db.query(`INSERT INTO studio_audit_flags (id, audit_id, stub, position, rule, severity, body, for_stub) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [`${auditId}-F${String(i + 1).padStart(2, '0')}`, auditId, for_stub || a.stub, i + 1, rule, severity, body, for_stub]);
      }
      const { flags: _f, ...rest } = result;
      const stored = { ...rest, copy_match_by_stub: copyByStub, logic_version: PREFLIGHT_LOGIC_VERSION, sizes: results.map(x => ({ size: x.size, usd: x.result.usd || 0, files: groups.find(g => g.size === x.size)!.rows.map(f => f.filename) })) };
      await this.db.query(`UPDATE studio_audits SET status = 'done', result = $2, usd = $3, rules_version = $4, finished_at = NOW() WHERE id = $1`,
        [auditId, stored, result.usd || 0, rules?.version ?? null]);
      if (result.usd) await S.getStore().addSpend({ label: `preflight ${a.stub}`, usd: Math.round(result.usd * 10000) / 10000, at: new Date().toISOString(), user: user || a.started_by || undefined });
      emit({ type: 'status', message: `${flags.length} flag${flags.length === 1 ? '' : 's'}` });
      emit({ type: 'done', batch: a.stub });
      return result;
    } catch (err: any) {
      // An OpenAI outage (B2 stops after 3 failed calls: FatalError) or a rate limit is worth retrying: the upload is kept.
      const msg = String(err?.message || err);
      const retryable = err instanceof FatalError || /unreachable|rate limit|429|timed? ?out|ECONN|503|502/i.test(msg);
      await this.db.query(`UPDATE studio_audits SET status = 'failed', error = $2, result = $3, finished_at = NOW() WHERE id = $1`,
        [auditId, retryable ? `${msg} (The upload is kept: run the audit again.)` : msg, { retryable }]);
      throw err;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** The latest audit of the latest upload serving a stub. */
  private async latestAuditRow(stub: string) {
    const up = await this.latestUpload(stub);
    if (!up) return null;
    return (await this.db.query(`SELECT * FROM studio_audits WHERE upload_id = $1 ORDER BY started_at DESC LIMIT 1`, [up.id])).rows[0] || null;
  }
  /** Flags of an audit that concern a stub: those about the visual, and its own copy match. */
  private async flagsFor(auditId: string, stub: string) {
    return (await this.db.query(`SELECT * FROM studio_audit_flags WHERE audit_id = $1 AND (for_stub IS NULL OR for_stub = $2) ORDER BY position`, [auditId, stub])).rows;
  }

  private async latestAuditSummary(stub: string): Promise<StubRow['audit']> {
    const a = await this.latestAuditRow(stub);
    if (!a) return null;
    const f = await this.flagsFor(a.id, stub);
    const n = (s: string) => f.filter(x => x.severity === s).length;
    return { id: a.id, status: a.status, usd: Number(a.usd), red: n('red'), amber: n('amber'), grey: n('grey'), open_red: f.filter(x => x.severity === 'red' && !x.override).length, finished_at: a.finished_at ? new Date(a.finished_at).toISOString() : null, error: a.error, stale: staleness(a) };
  }

  /** Everything the report screen shows for one stub. */
  async report(stub: string, viewer?: string) {
    await this.expireStuck();
    const { signoff, copy } = await this.findStub(stub);
    const upload = await this.latestUpload(stub);
    const a = await this.latestAuditRow(stub);
    let flags: any[] = [];
    if (a) {
      const rows = await this.flagsFor(a.id, stub);
      const agr = (await this.db.query(`SELECT flag_id, by_user, agree, note, at FROM studio_audit_agreements WHERE flag_id = ANY($1)`, [rows.map(r => r.id)])).rows;
      flags = rows.map(r => ({
        id: r.id, rule: r.rule, severity: r.severity, ...r.body, override: r.override || null,
        agreements: agr.filter(x => x.flag_id === r.id).map(x => ({ by: x.by_user, agree: x.agree, note: x.note, at: new Date(x.at).toISOString() })),
        mine: viewer ? agr.find(x => x.flag_id === r.id && x.by_user === viewer)?.agree ?? null : null,
      }));
    }
    const sevRank: Record<string, number> = { red: 0, amber: 1, grey: 2 };
    flags.sort((x, y) => (x.check === 'copy_match' ? -1 : 0) - (y.check === 'copy_match' ? -1 : 0) || sevRank[x.severity] - sevRank[y.severity] || x.position - y.position);
    const history = (await this.db.query(
      `SELECT u.id, u.kind, u.uploaded_by, u.uploaded_at, (SELECT count(*) FROM studio_upload_files f WHERE f.upload_id = u.id AND f.role = 'asset') AS files
         FROM studio_asset_uploads u JOIN studio_upload_stubs us ON us.upload_id = u.id WHERE us.stub = $1 ORDER BY u.uploaded_at DESC`, [stub])).rows.map(x => ({ ...x, files: Number(x.files), uploaded_at: new Date(x.uploaded_at).toISOString() }));
    const result = a?.result ? { ...a.result, copy_match: a.result.copy_match_by_stub?.[stub] ?? a.result.report?.copy_match } : null;
    return {
      stub, persona: signoff.persona, territory: signoff.territory, region: signoff.region || DEFAULT_REGION, visual_key: visualKey(stub), signoff_id: signoff.id, copy, upload, history,
      sizes: this.sizesOf(stub, upload, await S.getStore().getRules()),
      same_visual_as: upload ? upload.stubs.filter(x => x !== stub) : [],
      format_note: upload ? formatNote(stub, upload.kind) : null,
      on_asset_copy: copy.filter(c => !POST_COPY_FIELDS.has(c.field)), post_copy: copy.filter(c => POST_COPY_FIELDS.has(c.field)),
      audit: a ? { id: a.id, upload_id: a.upload_id, status: a.status, engine: a.engine, rules_version: a.rules_version, usd: Number(a.usd), error: a.error, started_by: a.started_by, started_at: new Date(a.started_at).toISOString(), finished_at: a.finished_at ? new Date(a.finished_at).toISOString() : null, result, stale: staleness(a) } : null,
      flags, status: await this.status(stub),
      compliance: await this.codeCompliance(stub, upload?.id ?? null),
      traffic: await this.traffic(stub),
    };
  }

  // ---------- review: agree or disagree, overrides, Ready to traffic ----------

  async agree(flagId: string, agree: boolean, note: string | undefined, user?: string) {
    if (!user) throw new Error('Sign in to mark flags');
    const f = (await this.db.query(`SELECT id FROM studio_audit_flags WHERE id = $1`, [flagId])).rows[0];
    if (!f) throw new Error('No such flag');
    await this.db.query(
      `INSERT INTO studio_audit_agreements (flag_id, by_user, agree, note, at) VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (flag_id, by_user) DO UPDATE SET agree = EXCLUDED.agree, note = EXCLUDED.note, at = NOW()`,
      [flagId, user, !!agree, note ? String(note) : null]);
    return { flag_id: flagId, by: user, agree: !!agree };
  }

  /** Let a red flag through with a written reason (who and when are recorded; shown on the report). */
  async override(flagId: string, reason: string, user?: string) {
    const why = String(reason || '').trim();
    if (why.length < 5) throw new Error('An override needs a written reason');
    const f = (await this.db.query(`SELECT * FROM studio_audit_flags WHERE id = $1`, [flagId])).rows[0];
    if (!f) throw new Error('No such flag');
    if (f.severity !== 'red') throw new Error('Only red flags block Ready to traffic; amber and grey need no override');
    const override = { reason: why, by: user || 'unknown', at: new Date().toISOString() };
    await this.db.query(`UPDATE studio_audit_flags SET override = $2 WHERE id = $1`, [flagId, override]);
    await S.getStore().recordEdit({ line_id: `asset:${f.stub}`, batch_id: 'preflight', before: null, after: { override: f.rule, flag: flagId, reason: why }, by: override.by, at: override.at });
    return { flag_id: flagId, override };
  }

  private async status(stub: string): Promise<StubRow['status']> {
    const r = (await this.db.query(`SELECT * FROM studio_asset_status WHERE stub = $1`, [stub])).rows[0];
    return r ? { status: r.status, ready_by: r.ready_by ?? undefined, ready_at: r.ready_at ? new Date(r.ready_at).toISOString() : undefined, upload_id: r.upload_id ?? undefined } : { status: 'open' };
  }
  private async setStatusRow(stub: string, status: 'open' | 'ready', uploadId: string | null, auditId: string | null, user: string | null) {
    await this.db.query(
      `INSERT INTO studio_asset_status (stub, status, upload_id, audit_id, ready_by, ready_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $2 = 'ready' THEN NOW() END, NOW())
       ON CONFLICT (stub) DO UPDATE SET status = EXCLUDED.status, upload_id = COALESCE(EXCLUDED.upload_id, studio_asset_status.upload_id),
         audit_id = EXCLUDED.audit_id, ready_by = EXCLUDED.ready_by, ready_at = EXCLUDED.ready_at, updated_at = NOW()`,
      [stub, status, uploadId, auditId, user]);
  }

  /**
   * Mark the latest upload of a stub as passing Pre-flight (or take it back). Needs a finished audit and no unresolved red
   * flag. It's Ready to traffic once Trupanion's compliance is cleared too (traffic()).
   */
  async setReady(stub: string, ready: boolean, user?: string) {
    await this.findStub(stub);
    const before = await this.status(stub);
    if (!ready) {
      await this.setStatusRow(stub, 'open', null, null, null);
    } else {
      await this.expireStuck();
      const upload = await this.latestUpload(stub);
      if (!upload) throw new Error('Upload the asset first');
      const a = await this.latestAuditRow(stub);
      if (!a || a.upload_id !== upload.id) throw new Error('Run the audit on the latest upload first');
      if (a.status !== 'done') throw new Error(a.status === 'failed' ? `The audit failed: ${a.error}. Run it again.` : 'The audit is still running');
      const open = (await this.flagsFor(a.id, stub)).filter(x => x.severity === 'red' && !x.override);
      if (open.length) throw Object.assign(new Error(`${open.length} red flag${open.length === 1 ? '' : 's'} to fix (a new upload) or override first`), { blocking: open.map(o => ({ flag_id: o.id, rule: o.rule, label: o.body.label })) });
      await this.setStatusRow(stub, 'ready', upload.id, a.id, user ?? null);
    }
    const after = await this.status(stub);
    await S.getStore().recordEdit({ line_id: `asset:${stub}`, batch_id: 'preflight', before, after, by: user || 'unknown', at: new Date().toISOString() });
    return after;
  }

  // ---------- the round: agreement rate and exports ----------

  /**
   * People's agree/disagree on the flags, across every audit of the round's
   * signed-off stubs (a verdict on an asset that was later replaced still says
   * how good the checks are). Brook's target: 90%.
   */
  async agreement(filter: { persona?: string; territory?: string } = {}) {
    const stubs = (await this.stubs(filter)).map(s => s.stub);
    if (!stubs.length) return { marked: 0, agree: 0, rate: null as number | null, by_severity: {} as Record<string, { marked: number; agree: number }> };
    const rows = (await this.db.query(
      `SELECT f.severity, g.agree FROM studio_audit_agreements g JOIN studio_audit_flags f ON f.id = g.flag_id
        WHERE f.audit_id IN (SELECT a.id FROM studio_audits a JOIN studio_upload_stubs us ON us.upload_id = a.upload_id WHERE us.stub = ANY($1))`, [stubs])).rows;
    const by: Record<string, { marked: number; agree: number }> = {};
    for (const r of rows) { by[r.severity] = by[r.severity] || { marked: 0, agree: 0 }; by[r.severity].marked++; if (r.agree) by[r.severity].agree++; }
    const agree = rows.filter(r => r.agree).length;
    return { marked: rows.length, agree, rate: rows.length ? Math.round((agree / rows.length) * 1000) / 1000 : null, by_severity: by };
  }

  /**
   * Features for B3 (`weekly.ts features --file`), joined by naming stub, in B2's
   * format: stub, features ("a; b" above the threshold), angle, persona, asset,
   * kind, red/amber/grey counts, then p_<feature>.
   */
  async featuresCsv(threshold = 0.5): Promise<string> {
    const r = S.loadRules();
    const keys = Object.keys(r.features?.items || {});
    // B2's own row when the audit came from B2 (same columns either way).
    // Every real round (B3 keys round close and expected-vs-actual on the round column); never a test round.
    const head = ['stub', 'features', 'angle', 'persona', 'kind', 'red', 'amber', 'grey', ...keys.map(k => `p_${k}`), 'round'];
    const rows = [head];
    const { b2FeaturesRow } = await import('./preflightB2.js');
    for (const s of await this.stubs({ round: 'all' })) {
      if (s.test || s.audit?.status !== 'done') continue;
      const a = (await this.db.query(`SELECT result FROM studio_audits WHERE id = $1`, [s.audit.id])).rows[0];
      if (a?.result?.report) {
        const row: Record<string, string | number> = { ...b2FeaturesRow({ ...a.result.report, stub: s.stub }, keys), red: s.audit.red, amber: s.audit.amber, grey: s.audit.grey, round: s.round };
        rows.push(head.map(h => String(row[h] ?? '')));
        continue;
      }
      const feats: Record<string, number> = a?.result?.features || {};
      rows.push([s.stub, keys.filter(k => (feats[k] ?? 0) >= threshold).join('; '), r.territories[s.territory]?.angle || '', s.persona,
        s.upload?.kind || '', String(s.audit.red), String(s.audit.amber), String(s.audit.grey),
        ...keys.map(k => (feats[k] === undefined ? '' : Number(feats[k]).toFixed(3))), s.round]);
    }
    return S.toCsv(rows);
  }

  /** The asset handoff list: stub, file, status, open flags. */
  /** The asset handoff to Add3: the active round's codes (or `round`), never a test round's. */
  async handoffCsv(round?: string): Promise<string> {
    const rounds = await getRounds();
    const rows = [['Naming code', 'Region', 'Month', 'Persona', 'Territory', 'Kind', 'File', 'Sizes missing', 'Same visual as', 'Status', 'Ready to traffic', 'Pre-flight passed by', 'Pre-flight passed at', 'Open red flags', 'Amber flags', 'Overridden red flags', 'Compliance', 'Compliance note', 'Cleared at Trupanion by', 'Compliance recorded by']];
    for (const s of await this.stubs({ round })) {
      if (s.test) continue;
      let open = '', amber = '', overridden = '';
      if (s.audit) {
        const f = await this.flagsFor(s.audit.id, s.stub);
        open = f.filter(x => x.severity === 'red' && !x.override).map(x => x.body.label || x.rule).join('; ');
        amber = f.filter(x => x.severity === 'amber').map(x => x.body.label || x.rule).join('; ');
        overridden = f.filter(x => x.severity === 'red' && x.override).map(x => `${x.body.label || x.rule} (overridden by ${x.override.by}: “${x.override.reason}”)`).join('; ');
      }
      // Add3 only ever sees "Ready to traffic" on a code Trupanion has cleared (or one marked ready before the gate, which says so).
      const status = s.traffic.ready || s.status.status === 'ready' ? s.traffic.words : !s.upload ? 'Not uploaded' : s.audit?.status === 'done' ? 'Needs review' : s.audit ? `Audit ${s.audit.status}` : 'Not audited';
      const c = await this.codeCompliance(s.stub, s.upload?.id ?? null);
      // Files per size ("1:1: a.png | 4:5: b.png"), and the expected sizes not uploaded (Pre-flight can still pass without them).
      const first = s.sizes.expected[0];
      const files = s.upload ? SIZES.map(z => ({ z, fs: s.upload!.files.filter(f => (f.aspect || first) === z) })).filter(x => x.fs.length).map(x => `${x.z}: ${x.fs.map(f => f.filename).join(', ')}`).join(' | ') : '';
      rows.push([s.stub, s.region, labelOf(rounds, s.round), s.persona, s.territory, s.upload?.kind || '', files, s.sizes.missing.join(', '), s.upload?.stubs.filter(x => x !== s.stub).join(' | ') || '', status, s.traffic.ready ? 'yes' : 'no',
        s.status.status === 'ready' ? s.status.ready_by || '' : '', s.status.status === 'ready' ? s.status.ready_at || '' : '', open, amber, overridden,
        COMPLIANCE_WORDS[c.status], c.note || '', c.client_by || '', c.by ? `${c.by}, ${c.at?.slice(0, 16).replace('T', ' ')}` : '']);
    }
    return S.toCsv(rows);
  }

  // ---------- Compliance (step 7, after Pre-flight): copy and visual together ----------

  /** The signed-off lines behind a code, as they stand now. */
  private async codeLines(stub: string): Promise<Array<{ signed: SignedField; line: S.Line | undefined }>> {
    const { signoff } = await this.findStub(stub);
    const out = [];
    for (const x of this.partsOf(signoff, stub)) {
      let line: S.Line | undefined;
      try { line = (await S.loadBatch(x.batch_id)).lines.find(l => l.id === x.line_id); } catch { /* run removed: the signed record stands */ }
      out.push({ signed: x, line });
    }
    return out;
  }

  /** Ready to traffic for a code: Pre-flight passed on the latest upload, and compliance cleared on it and on the current wording. */
  async traffic(stub: string): Promise<Traffic> {
    const upload = await this.latestUpload(stub);
    const st = await this.status(stub);
    const passed = st.status === 'ready' && !!upload && (!st.upload_id || st.upload_id === upload.id);
    const c = await this.codeCompliance(stub, upload?.id ?? null);
    const pf = passed ? 'Pre-flight passed' : !upload ? 'Not uploaded' : 'Pre-flight open';
    const cw = c.wording_edited ? 'Wording edited since sign-off' : `Compliance ${COMPLIANCE_WORDS[c.status].toLowerCase()}`;
    if (passed && c.status === 'cleared' && !c.wording_edited) return { ready: true, preflight: 'passed', compliance: 'cleared', words: 'Ready to traffic' };
    // Marked ready before the gate, and no compliance decision recorded since: stays ready, and says so.
    if (passed && !c.recorded && !c.wording_edited && st.ready_at && st.ready_at < COMPLIANCE_GATE_FROM) {
      return { ready: true, preflight: 'passed', compliance: 'pending', words: 'Ready to traffic · compliance not recorded', legacy: true };
    }
    const blocker = !passed ? (upload ? 'Pre-flight: mark it passed once the audit is reviewed' : 'Upload the asset') : c.wording_edited ? 'The wording was edited since sign-off: sign it off again' : c.status === 'changes_requested' ? `Trupanion asked for changes to the ${c.send_back === 'asset' ? 'visual' : 'copy'}` : 'Waiting for Trupanion’s compliance decision';
    return { ready: false, preflight: passed ? 'passed' : 'open', compliance: c.status, words: `${pf} · ${cw}`, blocker };
  }

  /**
   * A code's compliance status on its current asset. A review counts only for
   * the signed-off wording it was given on, and (at this step) the upload it was
   * given with; otherwise the code is pending again, and says why. Statuses set
   * per line on Ready before this step existed are read the same way.
   */
  async codeCompliance(stub: string, uploadId: string | null): Promise<CodeCompliance> {
    const lines = await this.codeLines(stub);
    const each = lines.map(({ signed, line }) => {
      const c = line ? complianceFor(line, stub) : undefined;
      if (!c || c.status === 'pending') return { status: 'pending' as const, note: c?.note, stale: undefined as string | undefined, c };
      if (c.sha256 && c.sha256 !== signed.sha256) return { status: 'pending' as const, note: c.note, stale: 'Reviewed on a different wording', c };
      if (c.upload_id && uploadId && c.upload_id !== uploadId) return { status: 'pending' as const, note: c.note, stale: 'Reviewed on an earlier upload', c };
      return { status: c.status, note: c.note, stale: undefined, c };
    });
    const latest = each.map(e => e.c).filter(Boolean).sort((a, b) => String(b!.at || '').localeCompare(String(a!.at || '')))[0];
    // Edited since sign-off: the wording on the asset is no longer the wording that will run, so an earlier "cleared"
    // doesn't carry over (it shows as needing review until the new wording is signed off and reviewed).
    const edited = lines.some(({ signed, line }) => line && S.lineHash(line) !== signed.sha256);
    const status: S.ComplianceStatus = edited ? 'pending' : each.some(e => e.status === 'changes_requested') ? 'changes_requested' : each.length && each.every(e => e.status === 'cleared') ? 'cleared' : 'pending';
    const overrideDetails = lines.flatMap(({ signed }) => (signed.overrides || []).map(o => ({ label: (o.label || o.rule).replace(/\.$/, ''), reason: o.reason, by: o.by })));
    return {
      status, note: latest?.note, by: latest?.by, at: latest?.at, client_by: status === 'pending' ? undefined : latest?.client_by, send_back: status === 'changes_requested' ? latest?.send_back : undefined,
      stale: edited ? 'Wording edited since sign-off' : each.find(e => e.stale)?.stale, on_asset: !!latest?.upload_id, recorded: each.some(e => !!e.c), wording_edited: edited,
      overrides: overrideDetails.map(o => o.label), override_details: overrideDetails,
    };
  }

  /**
   * Red flags that were overridden on the way to this asset, for the given codes: Pre-flight flags on the latest audit
   * of the upload (the visual's, and each code's own copy match), and red flags on the copy overridden at Ready.
   */
  async overriddenReds(uploadId: string, codes: string[]): Promise<Array<{ code: string; label: string; where: 'pre-flight' | 'copy'; reason: string }>> {
    const out: Array<{ code: string; label: string; where: 'pre-flight' | 'copy'; reason: string }> = [];
    const a = (await this.db.query(`SELECT id FROM studio_audits WHERE upload_id = $1 ORDER BY started_at DESC LIMIT 1`, [uploadId])).rows[0];
    if (a) {
      const rows = (await this.db.query(`SELECT for_stub, rule, body, override FROM studio_audit_flags WHERE audit_id = $1 AND severity = 'red' AND override IS NOT NULL AND (for_stub IS NULL OR for_stub = ANY($2))`, [a.id, codes])).rows;
      for (const r of rows) for (const code of r.for_stub ? [r.for_stub] : codes) out.push({ code, label: r.body?.label || r.rule, where: 'pre-flight', reason: r.override?.reason || '' });
    }
    for (const code of codes) {
      for (const { signed } of await this.codeLines(code)) for (const o of signed.overrides || []) out.push({ code, label: (o.label || o.rule).replace(/\.$/, ''), where: 'copy', reason: o.reason });
    }
    return out;
  }

  /** A new upload: reviews given with an earlier asset go back to pending (the history keeps them). */
  private async reopenCompliance(stub: string, uploadId: string, user?: string) {
    for (const { signed } of await this.codeLines(stub)) {
      // Under the run's lock, on the line as it is now (never over someone's edit or another status).
      await S.runLock(signed.batch_id, async () => {
        const line = (await S.loadBatch(signed.batch_id)).lines.find(l => l.id === signed.line_id);
        const c = line ? complianceFor(line, stub) : undefined;
        if (!line || !c?.upload_id || c.upload_id === uploadId || c.status === 'pending') return;
        const before = { compliance: c, code: stub };
        const next = { ...c, status: 'pending' as const, note: `New upload after "${COMPLIANCE_WORDS[c.status]}"${c.note ? `: ${c.note}` : ''}`, upload_id: uploadId, send_back: undefined, at: new Date().toISOString(), by: user };
        line.compliance_by_code = { ...(line.compliance_by_code || {}), [stub]: next };
        await S.getStore().saveLine(line.batch, line);
        await S.getStore().recordEdit({ line_id: line.id, batch_id: line.batch, before, after: { compliance: next, code: stub, reopened_by_upload: uploadId }, by: user || 'unknown', at: next.at });
      });
    }
  }

  /**
   * Every asset for the Compliance step: the latest upload per code, grouped by
   * the visual (codes sharing an upload together), with each code's copy and
   * status, the audit's flags, and codes still waiting for their asset.
   */
  async complianceAssets(filter: { persona?: string; territory?: string; region?: string; round?: string } = {}) {
    const stubs = await this.stubs(filter);
    const byUpload = new Map<string, StubRow[]>();
    const waiting: StubRow[] = [];
    for (const s of stubs) {
      if (!s.upload) { waiting.push(s); continue; }
      byUpload.set(s.upload.id, [...(byUpload.get(s.upload.id) || []), s]);
    }
    const assets = [];
    for (const [uploadId, ss] of byUpload) {
      const a = (await this.db.query(`SELECT * FROM studio_audits WHERE upload_id = $1 ORDER BY started_at DESC LIMIT 1`, [uploadId])).rows[0] || null;
      const flags = a ? (await this.db.query(`SELECT * FROM studio_audit_flags WHERE audit_id = $1 AND (for_stub IS NULL OR for_stub = ANY($2)) ORDER BY position`, [a.id, ss.map(s => s.stub)])).rows
        .map(r => ({ id: r.id, rule: r.rule, severity: r.severity, for_stub: r.for_stub, label: r.body.label, quote: r.body.quote, why: r.body.why, where: r.body.where, source: r.body.source, cross_persona: !!r.body.cross_persona, override: r.override || null })) : [];
      const codes = [];
      for (const s of ss) codes.push({ stub: s.stub, copy: s.copy, ready: s.status, traffic: s.traffic, compliance: await this.codeCompliance(s.stub, uploadId) });
      const st = codes.map(c => c.compliance.status);
      assets.push({
        upload_id: uploadId, persona: ss[0].persona, territory: ss[0].territory, region: ss[0].region, upload: ss[0].upload!,
        audit: a ? { id: a.id, status: a.status, finished_at: a.finished_at ? new Date(a.finished_at).toISOString() : null, stale: staleness(a) } : null,
        flags, codes,
        status: (st.includes('changes_requested') ? 'changes_requested' : st.every(x => x === 'cleared') ? 'cleared' : 'pending') as S.ComplianceStatus,
      });
    }
    const rank: Record<string, number> = { changes_requested: 1, pending: 0, cleared: 2 };
    assets.sort((x, y) => rank[x.status] - rank[y.status] || x.territory.localeCompare(y.territory) || x.codes[0].stub.localeCompare(y.codes[0].stub));
    return { assets, waiting: waiting.map(s => ({ stub: s.stub, persona: s.persona, territory: s.territory, region: s.region, copy: s.copy })) };
  }

  /**
   * Record Trupanion's compliance decision for one asset: every code it serves
   * (or the `codes` given), every signed-off line of those codes, with who at
   * Trupanion decided. "Changes requested" says where it goes back to: 'copy'
   * (Ready for production, to edit and sign off again) or 'asset' (Pre-flight,
   * for a new upload). Anything but cleared keeps a code out of Ready to traffic.
   */
  async setAssetCompliance(uploadId: string, input: { status: string; note?: string; send_back?: string; codes?: string[]; client_by?: string }, user?: string) {
    const status = String(input.status || '');
    if (!['pending', 'cleared', 'changes_requested'].includes(status)) throw new Error('Compliance status must be one of pending, cleared, changes_requested');
    const note = String(input.note || '').trim();
    // The decision is Trupanion's; the producer records it (Brook, 30 Sep: Vivan coordinates, she doesn't sign off compliance).
    const clientBy = String(input.client_by || '').trim();
    if (status !== 'pending' && !clientBy) throw new Error('Say who at Trupanion made this decision');
    const sendBack = input.send_back === 'copy' || input.send_back === 'asset' ? input.send_back : undefined;
    if (status === 'changes_requested' && !sendBack) throw new Error('Say what goes back: the copy (Ready for production) or the visual (Pre-flight)');
    if (status === 'changes_requested' && !note) throw new Error('Say what needs changing (the note goes back with it)');
    const served = (await this.db.query(`SELECT stub FROM studio_upload_stubs WHERE upload_id = $1 ORDER BY stub`, [uploadId])).rows.map(r => r.stub);
    if (!served.length) throw new Error('No such upload');
    // Only codes whose current asset this is (a code may have moved on to a newer upload).
    const current: string[] = [];
    for (const x of served) if ((await this.latestUpload(x))?.id === uploadId) current.push(x);
    // Every code on the asset by default; or some of them (e.g. A3's copy sent back while A1 and A2 are cleared).
    const codes = input.codes?.length ? current.filter(x => input.codes!.includes(x)) : current;
    if (input.codes?.length && codes.length < input.codes.length) throw new Error(`Not on this upload now: ${input.codes.filter(x => !codes.includes(x)).join(', ')}`);
    if (!codes.length) throw new Error('This upload has been replaced: review the newer one');
    // Clearing something that went through with an overridden red flag (Pre-flight, or the copy at Ready) needs a
    // note saying what Trupanion accepted, as well as who at Trupanion cleared it.
    if (status === 'cleared' && !note) {
      const accepted = await this.overriddenReds(uploadId, codes);
      if (accepted.length) throw Object.assign(new Error(`Went through with an overridden red flag (${accepted.map(x => `${x.code}: ${x.label}`).join('; ')}): add a note saying what Trupanion accepted`), { overridden: accepted });
    }
    for (const code of codes) {
      for (const { signed } of await this.codeLines(code)) {
        await setCompliance(signed.batch_id, signed.line_id, status, note || undefined, user, { upload_id: uploadId, code, sha256: signed.sha256, send_back: sendBack, client_by: clientBy || undefined });
      }
      // The visual goes back to Pre-flight: it's no longer Ready to traffic until a new upload is reviewed.
      if (status === 'changes_requested' && sendBack === 'asset') await this.setStatusRow(code, 'open', null, null, null);
      await S.getStore().recordEdit({ line_id: `asset:${code}`, batch_id: 'compliance', before: null, after: { compliance: status, note, send_back: sendBack, client_by: clientBy, upload: uploadId }, by: user || 'unknown', at: new Date().toISOString() });
    }
    return { upload_id: uploadId, codes, status };
  }
}

export interface CodeCompliance {
  status: S.ComplianceStatus; note?: string; at?: string; send_back?: 'copy' | 'asset';
  /** Who recorded it in Studio (the producer), and who at Trupanion made the decision. */
  by?: string; client_by?: string;
  /** Any decision recorded on the code's lines at all (codes marked ready before the gate have none). */
  recorded: boolean;
  /** A line's wording was edited after sign-off: not Ready to traffic until it's signed off (and reviewed) again. */
  wording_edited: boolean;
  /** Why a review no longer counts (a different wording or an earlier upload). */
  stale?: string;
  /** Set at the Compliance step with the asset (not per line on Ready, as before). */
  on_asset: boolean;
  /** Red flags on the copy that were overridden at Ready: Trupanion is asked to check these specifically. */
  overrides: string[];
  /** The same, with the reason each was overridden and who by (for the Compliance step's "what Trupanion accepted"). */
  override_details: Array<{ label: string; reason: string; by: string }>;
}
const COMPLIANCE_WORDS: Record<string, string> = { pending: 'Pending', cleared: 'Cleared', changes_requested: 'Changes requested' };
