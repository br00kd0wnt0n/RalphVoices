// Pre-flight (step 6, after Ready for production): the finished asset for each
// signed-off naming stub is uploaded, audited (B2's engine, via
// preflightEngine.ts), and the report is reviewed. People agree or disagree
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
import { getPrivateObject, isR2Enabled, putPrivateObject } from '../r2.js';
import type { AssetKind, AuditEngine, AuditFlag, AuditResult, SignedCopy } from './preflightEngine.js';

type Queryable = Pick<pg.Pool, 'query'>;

export const DB_FILE_CAP = 25 * 1024 * 1024;     // local/dev only (R2 off)
export const R2_FILE_CAP = 200 * 1024 * 1024;    // production, per file
const IMAGE = /^image\/(png|jpe?g|webp|gif)$/;
const VIDEO = /^video\/(mp4|quicktime)$/;

export interface UploadFile { buffer: Buffer; filename: string; contentType: string }
export interface StubRow {
  stub: string; persona: string; territory: string; signoff_id: string; ready_by: string; ready_at: string;
  copy: SignedCopy[];
  upload: { id: string; kind: AssetKind; files: Array<{ position: number; filename: string; content_type: string; size: number }>; uploaded_by: string; uploaded_at: string } | null;
  audit: { id: string; status: string; usd: number; red: number; amber: number; grey: number; open_red: number; finished_at: string | null; error: string | null } | null;
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

export class Preflight {
  constructor(private db: Queryable, private engine: AuditEngine, private opts: { storage?: 'r2' | 'db' } = {}) {}
  get storage(): 'r2' | 'db' { return this.opts.storage || (isR2Enabled() ? 'r2' : 'db'); }
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

  async upload(stub: string, files: UploadFile[], user?: string): Promise<{ upload_id: string; kind: AssetKind; storage: 'r2' | 'db' }> {
    if (!files.length) throw new Error('Choose a file to upload');
    const { signoff } = await this.findStub(stub);
    const kind = kindOf(files);
    const cap = this.storage === 'r2' ? R2_FILE_CAP : DB_FILE_CAP;
    const big = files.find(f => f.buffer.length > cap);
    if (big) throw new Error(`${big.filename} is ${fmtMb(big.buffer.length)}; the limit is ${fmtMb(cap)} per file${this.storage === 'db' ? ' when files are kept in the database (local; production uses R2)' : ''}`);
    const uploadId = id('up');
    await this.db.query(
      `INSERT INTO studio_asset_uploads (id, stub, persona, territory, signoff_id, kind, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uploadId, stub, signoff.persona, signoff.territory, signoff.id, kind, user ?? null]);
    for (let i = 0; i < files.length; i++) await this.putFile(uploadId, stub, i, files[i], 'asset');
    // A new upload replaces what was ready: the stub is open until it's reviewed again.
    await this.setStatusRow(stub, 'open', uploadId, null, null);
    await S.getStore().recordEdit({ line_id: `asset:${stub}`, batch_id: 'preflight', before: null, after: { upload: uploadId, kind, files: files.map(f => f.filename) }, by: user || 'unknown', at: new Date().toISOString() });
    return { upload_id: uploadId, kind, storage: this.storage };
  }

  private async putFile(uploadId: string, stub: string, position: number, f: UploadFile, role: 'asset' | 'frame') {
    const storage = this.storage;
    const key = storage === 'r2' ? `studio/preflight/${safe(stub)}/${uploadId}/${role === 'frame' ? 'frames/' : ''}${position}-${safe(f.filename)}` : null;
    if (storage === 'r2') await putPrivateObject(key!, f.buffer, f.contentType);
    await this.db.query(
      `INSERT INTO studio_upload_files (upload_id, position, filename, content_type, size, storage, r2_key, data, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (upload_id, position) DO UPDATE SET filename = EXCLUDED.filename, content_type = EXCLUDED.content_type, size = EXCLUDED.size,
         storage = EXCLUDED.storage, r2_key = EXCLUDED.r2_key, data = EXCLUDED.data, role = EXCLUDED.role`,
      [uploadId, position, f.filename, f.contentType, f.buffer.length, storage, key, storage === 'db' ? f.buffer : null, role]);
  }

  /** A stored file (an asset, or a frame thumbnail from the audit), for the signed-in API to send. */
  async file(uploadId: string, position: number): Promise<{ filename: string; contentType: string; data: Buffer }> {
    const r = await this.db.query(`SELECT filename, content_type, storage, r2_key, data FROM studio_upload_files WHERE upload_id = $1 AND position = $2`, [uploadId, position]);
    const f = r.rows[0];
    if (!f) throw new Error('No such file');
    return { filename: f.filename, contentType: f.content_type, data: f.storage === 'r2' ? await getPrivateObject(f.r2_key) : f.data };
  }

  private async latestUpload(stub: string): Promise<StubRow['upload']> {
    const u = (await this.db.query(`SELECT * FROM studio_asset_uploads WHERE stub = $1 ORDER BY uploaded_at DESC LIMIT 1`, [stub])).rows[0];
    if (!u) return null;
    const files = (await this.db.query(`SELECT position, filename, content_type, size FROM studio_upload_files WHERE upload_id = $1 AND role = 'asset' ORDER BY position`, [u.id])).rows;
    return { id: u.id, kind: u.kind, files, uploaded_by: u.uploaded_by, uploaded_at: new Date(u.uploaded_at).toISOString() };
  }

  // ---------- audits ----------

  async estimate(uploadId: string): Promise<{ usd: number; seconds: number }> {
    const u = (await this.db.query(`SELECT * FROM studio_asset_uploads WHERE id = $1`, [uploadId])).rows[0];
    if (!u) throw new Error('No such upload');
    const rows = (await this.db.query(`SELECT position, filename, content_type FROM studio_upload_files WHERE upload_id = $1 AND role = 'asset' ORDER BY position`, [uploadId])).rows;
    const files = [];
    for (const f of rows) files.push({ path: '', filename: f.filename, contentType: f.content_type, data: this.engine.name === 'mock' ? undefined : (await this.file(uploadId, f.position)).data });
    const { copy } = await this.findStub(u.stub);
    const st = S.getStore();
    return this.engine.estimate({ stub: u.stub, persona: u.persona, territory: u.territory, kind: u.kind, copy, files, rules: await st.getRules(), rubric: await st.getInput('rubric') });
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
    await this.db.query(`UPDATE studio_audits SET status = 'running', started_at = NOW() WHERE id = $1`, [auditId]);
    try {
      const rows = (await this.db.query(`SELECT position, filename, content_type FROM studio_upload_files WHERE upload_id = $1 AND role = 'asset' ORDER BY position`, [a.upload_id])).rows;
      const files = [];
      for (const f of rows) {
        const p = path.join(tmp, `${f.position}-${safe(f.filename)}`);
        fs.writeFileSync(p, (await this.file(a.upload_id, f.position)).data);
        files.push({ path: p, filename: f.filename, contentType: f.content_type });
      }
      const { copy } = await this.findStub(a.stub);
      const rules = await S.getStore().getRules();   // the full file: B2 uses the visual-only items Studio's text checks skip
      const rubric = await S.getStore().getInput('rubric');
      emit({ type: 'status', message: `Auditing ${a.stub} (${a.kind})` });
      const result = await this.engine.run({ stub: a.stub, persona: a.persona, territory: a.territory, kind: a.kind, files, copy, rules, rubric }, message => emit({ type: 'status', message }));
      // Frames the flags rest on are kept as thumbnails next to the upload.
      let framePos = 1000;
      const flags = [];
      for (const f of result.flags) {
        const { frame, ...rest } = f;
        let frameRef: { upload_id?: string; position?: number; label?: string; description?: string } | undefined;
        if (frame?.path && fs.existsSync(frame.path)) {
          const pos = framePos++;
          await this.putFile(a.upload_id, a.stub, pos, { buffer: fs.readFileSync(frame.path), filename: path.basename(frame.path), contentType: /\.png$/i.test(frame.path) ? 'image/png' : 'image/jpeg' }, 'frame');
          frameRef = { upload_id: a.upload_id, position: pos, label: frame.label };
        } else if (frame && frame.asset_position !== undefined && frame.asset_position < rows.length) {
          frameRef = { upload_id: a.upload_id, position: rows[frame.asset_position].position, label: frame.label };
        } else if (frame) frameRef = { label: frame.label, description: frame.description };
        flags.push({ ...rest, frame: frameRef });
      }
      await this.db.query(`DELETE FROM studio_audit_flags WHERE audit_id = $1`, [auditId]);
      for (let i = 0; i < flags.length; i++) {
        const { rule, severity, ...body } = flags[i];
        await this.db.query(`INSERT INTO studio_audit_flags (id, audit_id, stub, position, rule, severity, body) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [`${auditId}-F${String(i + 1).padStart(2, '0')}`, auditId, a.stub, i + 1, rule, severity, body]);
      }
      const { flags: _f, ...stored } = result;
      await this.db.query(`UPDATE studio_audits SET status = 'done', result = $2, usd = $3, rules_version = $4, finished_at = NOW() WHERE id = $1`,
        [auditId, stored, result.usd || 0, rules?.version ?? null]);
      if (result.usd) await S.getStore().addSpend({ label: `preflight ${a.stub}`, usd: Math.round(result.usd * 10000) / 10000, at: new Date().toISOString(), user: user || a.started_by || undefined });
      emit({ type: 'status', message: `${flags.length} flag${flags.length === 1 ? '' : 's'}` });
      emit({ type: 'done', batch: a.stub });
      return result;
    } catch (err: any) {
      await this.db.query(`UPDATE studio_audits SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1`, [auditId, String(err?.message || err)]);
      throw err;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  private async latestAuditRow(stub: string) {
    return (await this.db.query(`SELECT * FROM studio_audits WHERE stub = $1 ORDER BY started_at DESC LIMIT 1`, [stub])).rows[0] || null;
  }

  private async latestAuditSummary(stub: string): Promise<StubRow['audit']> {
    const a = await this.latestAuditRow(stub);
    if (!a) return null;
    const f = (await this.db.query(`SELECT severity, override FROM studio_audit_flags WHERE audit_id = $1`, [a.id])).rows;
    const n = (s: string) => f.filter(x => x.severity === s).length;
    return { id: a.id, status: a.status, usd: Number(a.usd), red: n('red'), amber: n('amber'), grey: n('grey'), open_red: f.filter(x => x.severity === 'red' && !x.override).length, finished_at: a.finished_at ? new Date(a.finished_at).toISOString() : null, error: a.error };
  }

  /** Everything the report screen shows for one stub. */
  async report(stub: string, viewer?: string) {
    const { signoff, copy } = await this.findStub(stub);
    const upload = await this.latestUpload(stub);
    const a = await this.latestAuditRow(stub);
    let flags: any[] = [];
    if (a) {
      const rows = (await this.db.query(`SELECT * FROM studio_audit_flags WHERE audit_id = $1 ORDER BY position`, [a.id])).rows;
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
         FROM studio_asset_uploads u WHERE u.stub = $1 ORDER BY u.uploaded_at DESC`, [stub])).rows.map(x => ({ ...x, files: Number(x.files), uploaded_at: new Date(x.uploaded_at).toISOString() }));
    return {
      stub, persona: signoff.persona, territory: signoff.territory, signoff_id: signoff.id, copy, upload, history,
      audit: a ? { id: a.id, status: a.status, engine: a.engine, rules_version: a.rules_version, usd: Number(a.usd), error: a.error, started_by: a.started_by, started_at: new Date(a.started_at).toISOString(), finished_at: a.finished_at ? new Date(a.finished_at).toISOString() : null, result: a.result } : null,
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
      const upload = await this.latestUpload(stub);
      if (!upload) throw new Error('Upload the asset first');
      const a = await this.latestAuditRow(stub);
      if (!a || a.upload_id !== upload.id) throw new Error('Run the audit on the latest upload first');
      if (a.status !== 'done') throw new Error(a.status === 'failed' ? `The audit failed: ${a.error}. Run it again.` : 'The audit is still running');
      const open = (await this.db.query(`SELECT id, rule, body FROM studio_audit_flags WHERE audit_id = $1 AND severity = 'red' AND override IS NULL ORDER BY position`, [a.id])).rows;
      if (open.length) throw Object.assign(new Error(`${open.length} red flag${open.length === 1 ? '' : 's'} to fix (a new upload) or override first`), { blocking: open.map(o => ({ flag_id: o.id, rule: o.rule, label: o.body.label })) });
      await this.setStatusRow(stub, 'ready', upload.id, a.id, user ?? null);
    }
    const after = await this.status(stub);
    await S.getStore().recordEdit({ line_id: `asset:${stub}`, batch_id: 'preflight', before, after, by: user || 'unknown', at: new Date().toISOString() });
    return after;
  }

  // ---------- the round: agreement rate and exports ----------

  /** People's agree/disagree on flags from the latest audit of each stub. Brook's target: 90%. */
  async agreement(filter: { persona?: string; territory?: string } = {}) {
    const stubs = (await this.stubs(filter)).filter(s => s.audit?.status === 'done').map(s => s.audit!.id);
    if (!stubs.length) return { marked: 0, agree: 0, rate: null as number | null, by_severity: {} as Record<string, { marked: number; agree: number }> };
    const rows = (await this.db.query(
      `SELECT f.severity, g.agree FROM studio_audit_agreements g JOIN studio_audit_flags f ON f.id = g.flag_id WHERE f.audit_id = ANY($1)`, [stubs])).rows;
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
        const row = b2FeaturesRow({ ...a.result.report, stub: s.stub }, keys);
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
    const rows = [['Naming code', 'Persona', 'Territory', 'Kind', 'File', 'Status', 'Ready to traffic by', 'Ready to traffic at', 'Open red flags', 'Amber flags', 'Overridden red flags']];
    for (const s of await this.stubs()) {
      let open = '', amber = '', overridden = '';
      if (s.audit) {
        const f = (await this.db.query(`SELECT rule, severity, body, override FROM studio_audit_flags WHERE audit_id = $1 ORDER BY position`, [s.audit.id])).rows;
        open = f.filter(x => x.severity === 'red' && !x.override).map(x => x.body.label || x.rule).join('; ');
        amber = f.filter(x => x.severity === 'amber').map(x => x.body.label || x.rule).join('; ');
        overridden = f.filter(x => x.severity === 'red' && x.override).map(x => `${x.body.label || x.rule} (overridden by ${x.override.by}: “${x.override.reason}”)`).join('; ');
      }
      const status = s.status.status === 'ready' ? 'Ready to traffic' : !s.upload ? 'Not uploaded' : s.audit?.status === 'done' ? 'Needs review' : s.audit ? `Audit ${s.audit.status}` : 'Not audited';
      rows.push([s.stub, s.persona, s.territory, s.upload?.kind || '', s.upload?.files.map(f => f.filename).join(' | ') || '', status, s.status.ready_by || '', s.status.ready_at || '', open, amber, overridden]);
    }
    return S.toCsv(rows);
  }
}
