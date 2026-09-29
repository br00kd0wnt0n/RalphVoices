// Pre-flight (step 6, after Ready for production): the finished asset for each
// signed-off naming stub is uploaded, audited (B2's engine, via
// preflightEngine.ts), and the report is reviewed. One visual can serve several
// stubs (2-3 copy lines on the same asset): it's audited once, and copy match
// runs per stub, on on-asset fields only (post copy travels with the ad). People agree or disagree
// with each flag (the round's agreement rate is Brook's 90% target), red flags
// are fixed by a new upload or overridden with a reason, and the stub is marked
// "Ready to traffic". Exports: the features CSV for B3 and an asset handoff list.
// Tables: migration 017. Files: R2 (production) or Postgres (local, 25 MB cap).
// Wording: "Ready to traffic", never "approved". No scores.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type pg from 'pg';
import * as S from './engine.js';
import type { Signoff } from './ready.js';
import { downloadPrivateObject, getPrivateObject, getPrivateObjectStream, isR2Enabled, putPrivateObject } from '../r2.js';
import { FatalError } from '../audit/api.js';
import type { AssetKind, AuditEngine, AuditFlag, AuditResult, SignedCopy } from './preflightEngine.js';
import { copyMatch } from '../audit/copyMatch.js';
import { signedOffCopy } from './preflightB2.js';

type Queryable = Pick<pg.Pool, 'query'>;

export const DB_FILE_CAP = 25 * 1024 * 1024;     // local/dev only (R2 off)
/** Bump when the audit or copy-match logic changes what a stored audit would say (2: on-asset copy match per stub). */
export const PREFLIGHT_LOGIC_VERSION = 2;

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
  stub: string; persona: string; territory: string; signoff_id: string; ready_by: string; ready_at: string;
  copy: SignedCopy[];
  upload: { id: string; kind: AssetKind; files: Array<{ position: number; filename: string; content_type: string; size: number }>; uploaded_by: string; uploaded_at: string; stubs: string[] } | null;
  audit: { id: string; status: string; usd: number; red: number; amber: number; grey: number; open_red: number; finished_at: string | null; error: string | null; stale: string | null } | null;
  status: { status: 'open' | 'ready'; ready_by?: string; ready_at?: string; upload_id?: string };
}

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
 * (formats in codes: STATIC/ST, CAROUSEL/CAR, VIDEO/VID, UGC).
 */
export function formatNote(stub: string, kind: AssetKind): string | null {
  const fmt = /_(STATIC|ST|CAROUSEL|CAR|VIDEO|VID|UGC)_v\d+_/i.exec(stub)?.[1]?.toUpperCase();
  if (!fmt) return null;
  const want: AssetKind[] = /^(STATIC|ST)$/.test(fmt) ? ['static'] : /^(CAROUSEL|CAR)$/.test(fmt) ? ['carousel'] : ['video'];
  if (want.includes(kind)) return null;
  const name = { STATIC: 'a static image', ST: 'a static image', CAROUSEL: 'carousel cards', CAR: 'carousel cards', VIDEO: 'a video', VID: 'a video', UGC: 'a video (UGC)' }[fmt];
  return `This code is for ${name}, but a ${kind} was uploaded. Check it’s the right asset, or that the code’s format is right.`;
}

/** Fields that run in the post (never on the asset): listed on the report, not compared. */
export const POST_COPY_FIELDS = new Set(['meta_primary', 'meta_description', 'tiktok_caption']);

/**
 * Copy match for one stub, on what was read off the visual: B2's own rules
 * (services/audit/copyMatch.ts). Only on-asset fields are compared (the TikTok
 * hook and on-image text; the headline if it's designed in). Red only for a
 * required caveat missing from on-asset text; a hook that differs is amber; a
 * headline not on the image is grey.
 */
export function copyMatchForStub(copy: SignedCopy[], assetText: Array<{ where: string; text: string }>, rules: any, kind: AssetKind) {
  const { rows, flags } = copyMatch(signedOffCopy(copy.filter(c => !POST_COPY_FIELDS.has(c.field))), assetText, rules);
  const cardOf = (where?: string) => {
    if (kind === 'video' || !where) return undefined;
    const m = /card (\d+)/i.exec(where);
    return m ? Number(m[1]) - 1 : /^image/i.test(where) ? 0 : undefined;
  };
  return {
    rows,
    flags: flags.map((f): AuditFlag => ({
      rule: f.rule, severity: f.severity, label: f.label, source: f.source, quote: f.quote, why: f.why, where: f.where, check: 'copy_match',
      frame: cardOf(f.where) !== undefined ? { asset_position: cardOf(f.where), label: f.where } : undefined,
    })),
  };
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

  private async latestSignoffs(): Promise<Signoff[]> {
    const latest = new Map<string, Signoff>();
    for (const s of (await S.getStore().listSignoffs()) as Signoff[]) {
      const k = `${s.persona}|${s.territory}`;
      if (!latest.has(k) || latest.get(k)!.version < s.version) latest.set(k, s);
    }
    return [...latest.values()].sort((a, b) => a.territory.localeCompare(b.territory));
  }

  /** The signed-off copy for a stub, with field labels. */
  private copyFor(s: Signoff, stub: string): SignedCopy[] {
    const r = S.loadRules();
    return s.lines.filter(l => l.stub === stub).map(l => ({ line_id: l.line_id, field: l.field, label: r.fields[l.field]?.label || l.field, text: l.text, version: l.version }));
  }

  async stubs(filter: { persona?: string; territory?: string } = {}): Promise<StubRow[]> {
    await this.expireStuck();
    const out: StubRow[] = [];
    for (const s of await this.latestSignoffs()) {
      if (filter.persona && s.persona !== filter.persona) continue;
      if (filter.territory && s.territory !== filter.territory) continue;
      for (const stub of [...new Set(s.lines.map(l => l.stub))].sort()) {
        out.push({
          stub, persona: s.persona, territory: s.territory, signoff_id: s.id, ready_by: s.ready_by, ready_at: s.ready_at,
          copy: this.copyFor(s, stub),
          upload: await this.latestUpload(stub), audit: await this.latestAuditSummary(stub), status: await this.status(stub),
        });
      }
    }
    return out;
  }

  private async findStub(stub: string): Promise<{ signoff: Signoff; copy: SignedCopy[] }> {
    for (const s of await this.latestSignoffs()) if (s.lines.some(l => l.stub === stub)) return { signoff: s, copy: this.copyFor(s, stub) };
    throw new Error(`${stub} isn't in a Ready for production sign-off`);
  }

  // ---------- uploads ----------

  /** Upload the visual for a stub; `also` lists other signed-off stubs that run on the same visual. */
  async upload(stub: string, files: UploadFile[], user?: string, also: string[] = []): Promise<{ upload_id: string; kind: AssetKind; storage: 'r2' | 'db'; stubs: string[]; format_notes: string[]; estimate: { usd: number; seconds: number } }> {
    if (!files.length) throw new Error('Choose a file to upload');
    const { signoff } = await this.findStub(stub);
    const stubs = [stub, ...new Set(also.filter(x => x && x !== stub))];
    for (const x of stubs.slice(1)) {
      // One visual, several copy lines, in one ad set: the audit runs once, for this persona, so the codes must share it.
      const o = (await this.findStub(x)).signoff;
      if (o.persona !== signoff.persona || o.territory !== signoff.territory) throw new Error(`${x} is for another persona or territory: the same visual can serve codes of the same persona and territory only (upload it to ${x} separately so it's audited for that persona)`);
    }
    const kind = kindOf(files);
    const cap = this.storage === 'r2' ? R2_FILE_CAP : DB_FILE_CAP;
    const big = files.find(f => sizeOf(f) > cap);
    if (big) throw new Error(`${big.filename} is ${fmtMb(sizeOf(big))}; the limit is ${fmtMb(cap)} per file${this.storage === 'db' ? ' when files are kept in the database (local; production uses R2)' : ''}`);
    const uploadId = id('up');
    await this.db.query(
      `INSERT INTO studio_asset_uploads (id, stub, persona, territory, signoff_id, kind, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uploadId, stub, signoff.persona, signoff.territory, signoff.id, kind, user ?? null]);
    for (let i = 0; i < files.length; i++) await this.putFile(uploadId, stub, i, files[i], 'asset');
    for (const x of stubs) {
      await this.db.query(`INSERT INTO studio_upload_stubs (upload_id, stub) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [uploadId, x]);
      // A new upload replaces what was ready: each stub it serves is open until it's reviewed again.
      await this.setStatusRow(x, 'open', uploadId, null, null);
      await S.getStore().recordEdit({ line_id: `asset:${x}`, batch_id: 'preflight', before: null, after: { upload: uploadId, kind, files: files.map(f => f.filename), same_visual_as: stubs.filter(y => y !== x) }, by: user || 'unknown', at: new Date().toISOString() });
    }
    // The estimate is worked out now, from the files already here, and reused by the audit (no second download).
    const estimate = await this.estimateFrom({ stub, persona: signoff.persona, territory: signoff.territory, kind }, files);
    await this.db.query(`UPDATE studio_asset_uploads SET estimate = $2 WHERE id = $1`, [uploadId, estimate]);
    return { upload_id: uploadId, kind, storage: this.storage, stubs, format_notes: stubs.map(x => formatNote(x, kind)).filter(Boolean) as string[], estimate };
  }

  private async putFile(uploadId: string, stub: string, position: number, f: UploadFile, role: 'asset' | 'frame') {
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
  private async materialise(uploadId: string, dir: string) {
    const rows = (await this.db.query(`SELECT position, filename, content_type, storage, r2_key FROM studio_upload_files WHERE upload_id = $1 AND role = 'asset' ORDER BY position`, [uploadId])).rows;
    const out: Array<{ position: number; path: string; filename: string; contentType: string }> = [];
    for (const f of rows) {
      const p = path.join(dir, `${f.position}-${safe(f.filename)}`);
      if (f.storage === 'r2') await downloadPrivateObject(f.r2_key, p);
      else fs.writeFileSync(p, (await this.db.query(`SELECT data FROM studio_upload_files WHERE upload_id = $1 AND position = $2`, [uploadId, f.position])).rows[0].data);
      out.push({ position: f.position, path: p, filename: f.filename, contentType: f.content_type });
    }
    return out;
  }

  /** The latest upload serving a stub (its own, or a shared visual). */
  private async latestUpload(stub: string): Promise<StubRow['upload']> {
    const u = (await this.db.query(
      `SELECT u.* FROM studio_asset_uploads u JOIN studio_upload_stubs us ON us.upload_id = u.id WHERE us.stub = $1 ORDER BY u.uploaded_at DESC LIMIT 1`, [stub])).rows[0];
    if (!u) return null;
    const files = (await this.db.query(`SELECT position, filename, content_type, size FROM studio_upload_files WHERE upload_id = $1 AND role = 'asset' ORDER BY position`, [u.id])).rows;
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

  /** The estimate stored at upload; for an older upload, worked out once from the stored files and kept. */
  async estimate(uploadId: string): Promise<{ usd: number; seconds: number }> {
    const u = (await this.db.query(`SELECT * FROM studio_asset_uploads WHERE id = $1`, [uploadId])).rows[0];
    if (!u) throw new Error('No such upload');
    if (u.estimate) return u.estimate;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-estimate-'));
    try {
      const files = await this.materialise(uploadId, tmp);
      const e = await this.estimateFrom(u, files);
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
      const files = rows.map(f => ({ path: f.path, filename: f.filename, contentType: f.contentType }));
      const { copy } = await this.findStub(a.stub);
      const rules = await S.getStore().getRules();   // the full file: B2 uses the visual-only items Studio's text checks skip
      const rubric = await S.rubricFor(rules);
      if (!rubric) throw new Error('The live rules have no M3 rubric: an admin uploads studio-rules.json v2.6 or later in the Rules view');
      emit({ type: 'status', message: `Auditing ${a.stub} (${a.kind})` });
      const result = await this.engine.run({ stub: a.stub, persona: a.persona, territory: a.territory, kind: a.kind, files, copy, rules, rubric }, message => { heartbeat(); emit({ type: 'status', message }); });
      // Copy match is Studio's, per stub the visual serves (the engine's own copy flags are replaced by these).
      result.flags = result.flags.filter(f => f.check !== 'copy_match');
      const served = (await this.db.query(`SELECT stub FROM studio_upload_stubs WHERE upload_id = $1 ORDER BY stub`, [a.upload_id])).rows.map(x => x.stub);
      const copyByStub: Record<string, any[]> = {};
      const perStub: Array<{ stub: string; flag: AuditFlag }> = [];
      for (const st of served) {
        const cm = copyMatchForStub((await this.findStub(st)).copy, result.asset_text || [{ where: 'asset', text: result.text_found }], rules, a.kind);
        copyByStub[st] = cm.rows;
        for (const f of cm.flags) perStub.push({ stub: st, flag: f });
      }
      // Frames the flags rest on are kept as thumbnails next to the upload.
      let framePos = 1000;
      const flags: Array<any> = [];
      for (const [f, forStub] of [...result.flags.map(f => [f, null] as const), ...perStub.map(x => [x.flag, x.stub] as const)]) {
        const { frame, ...rest } = f;
        let frameRef: { upload_id?: string; position?: number; label?: string; description?: string } | undefined;
        if (frame?.path && fs.existsSync(frame.path)) {
          const pos = framePos++;
          await this.putFile(a.upload_id, a.stub, pos, { buffer: fs.readFileSync(frame.path), filename: path.basename(frame.path), contentType: /\.png$/i.test(frame.path) ? 'image/png' : 'image/jpeg' }, 'frame');
          frameRef = { upload_id: a.upload_id, position: pos, label: frame.label };
        } else if (frame && frame.asset_position !== undefined && frame.asset_position < rows.length) {
          frameRef = { upload_id: a.upload_id, position: rows[frame.asset_position].position, label: frame.label };
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
      const stored = { ...rest, copy_match_by_stub: copyByStub, logic_version: PREFLIGHT_LOGIC_VERSION };
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
      stub, persona: signoff.persona, territory: signoff.territory, signoff_id: signoff.id, copy, upload, history,
      same_visual_as: upload ? upload.stubs.filter(x => x !== stub) : [],
      format_note: upload ? formatNote(stub, upload.kind) : null,
      on_asset_copy: copy.filter(c => !POST_COPY_FIELDS.has(c.field)), post_copy: copy.filter(c => POST_COPY_FIELDS.has(c.field)),
      audit: a ? { id: a.id, upload_id: a.upload_id, status: a.status, engine: a.engine, rules_version: a.rules_version, usd: Number(a.usd), error: a.error, started_by: a.started_by, started_at: new Date(a.started_at).toISOString(), finished_at: a.finished_at ? new Date(a.finished_at).toISOString() : null, result, stale: staleness(a) } : null,
      flags, status: await this.status(stub),
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

  /** Mark the latest upload of a stub Ready to traffic (or take it back). Needs a finished audit and no unresolved red flag. */
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
    const head = ['stub', 'features', 'angle', 'persona', 'kind', 'red', 'amber', 'grey', ...keys.map(k => `p_${k}`)];
    const rows = [head];
    const { b2FeaturesRow } = await import('./preflightB2.js');
    for (const s of await this.stubs()) {
      if (s.audit?.status !== 'done') continue;
      const a = (await this.db.query(`SELECT result FROM studio_audits WHERE id = $1`, [s.audit.id])).rows[0];
      if (a?.result?.report) {
        const row: Record<string, string | number> = { ...b2FeaturesRow({ ...a.result.report, stub: s.stub }, keys), red: s.audit.red, amber: s.audit.amber, grey: s.audit.grey };
        rows.push(head.map(h => String(row[h] ?? '')));
        continue;
      }
      const feats: Record<string, number> = a?.result?.features || {};
      rows.push([s.stub, keys.filter(k => (feats[k] ?? 0) >= threshold).join('; '), r.territories[s.territory]?.angle || '', s.persona,
        s.upload?.kind || '', String(s.audit.red), String(s.audit.amber), String(s.audit.grey),
        ...keys.map(k => (feats[k] === undefined ? '' : Number(feats[k]).toFixed(3)))]);
    }
    return S.toCsv(rows);
  }

  /** The asset handoff list: stub, file, status, open flags. */
  async handoffCsv(): Promise<string> {
    const rows = [['Naming code', 'Persona', 'Territory', 'Kind', 'File', 'Same visual as', 'Status', 'Ready to traffic by', 'Ready to traffic at', 'Open red flags', 'Amber flags', 'Overridden red flags']];
    for (const s of await this.stubs()) {
      let open = '', amber = '', overridden = '';
      if (s.audit) {
        const f = await this.flagsFor(s.audit.id, s.stub);
        open = f.filter(x => x.severity === 'red' && !x.override).map(x => x.body.label || x.rule).join('; ');
        amber = f.filter(x => x.severity === 'amber').map(x => x.body.label || x.rule).join('; ');
        overridden = f.filter(x => x.severity === 'red' && x.override).map(x => `${x.body.label || x.rule} (overridden by ${x.override.by}: “${x.override.reason}”)`).join('; ');
      }
      const status = s.status.status === 'ready' ? 'Ready to traffic' : !s.upload ? 'Not uploaded' : s.audit?.status === 'done' ? 'Needs review' : s.audit ? `Audit ${s.audit.status}` : 'Not audited';
      rows.push([s.stub, s.persona, s.territory, s.upload?.kind || '', s.upload?.files.map(f => f.filename).join(' | ') || '', s.upload?.stubs.filter(x => x !== s.stub).join(' | ') || '', status, s.status.ready_by || '', s.status.ready_at || '', open, amber, overridden]);
    }
    return S.toCsv(rows);
  }
}
