// Postgres storage for Copy Studio (migration 015). The hosted Studio passes
// the app's pool; the CLI builds one from an explicit URL. This file never
// imports src/db (which loads .env), so it can't reach a database by accident.

import pg from 'pg';
import type { Asset, EditRecord, InputKey, SpendEntry, StudioStore } from './store.js';

type Queryable = Pick<pg.Pool, 'query' | 'connect'>;

// Decision fields a whole-run save must not roll back (see saveBatch).
// Human fields on a line: a whole-run save (the checker) with an older decided_at never overwrites them.
const DECISION_KEYS = ['decision', 'edited_text', 'note', 'decided_by', 'decided_at', 'overrides', 'compliance', 'ready', 'rechecked_at'];

export class PgStore implements StudioStore {
  readonly kind = 'pg' as const;
  constructor(private db: Queryable) {}

  /** The connection, for features that keep their own tables (Pre-flight, migration 017). */
  get pool(): Queryable { return this.db; }
  static fromUrl(url: string): PgStore { return new PgStore(new pg.Pool({ connectionString: url, max: 5 })); }
  async close() { await (this.db as pg.Pool).end?.(); }

  // ---------- rules and inputs ----------

  async getRules() {
    const r = await this.db.query(`SELECT body FROM studio_rules WHERE status = 'active' LIMIT 1`);
    if (!r.rows[0]) throw new Error('No active Studio rules in the database; upload them with `studio.ts rules-push --activate`');
    return r.rows[0].body;
  }
  /** Upload a rules version; activate retires the previous active version in the same transaction. */
  async putRules(version: string, body: any, opts: { activate?: boolean; by?: string; notes?: string } = {}) {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      if (opts.activate) await c.query(`UPDATE studio_rules SET status = 'retired' WHERE status = 'active' AND version <> $1`, [version]);
      await c.query(
        `INSERT INTO studio_rules (version, body, status, notes, created_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (version) DO UPDATE SET body = EXCLUDED.body, status = EXCLUDED.status, notes = COALESCE(EXCLUDED.notes, studio_rules.notes)`,
        [version, body, opts.activate ? 'active' : 'draft', opts.notes ?? null, opts.by ?? null]);
      if (opts.activate) await c.query(`UPDATE studio_rules SET activated_by = $2, activated_at = NOW() WHERE version = $1`, [version, opts.by ?? null]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  /** Make an uploaded version the active one (the previous active version is retired). */
  async activateRules(version: string, by?: string) {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      const hit = await c.query(`SELECT 1 FROM studio_rules WHERE version = $1`, [version]);
      if (!hit.rowCount) throw new Error(`No rules version ${version}`);
      await c.query(`UPDATE studio_rules SET status = 'retired' WHERE status = 'active' AND version <> $1`, [version]);
      await c.query(`UPDATE studio_rules SET status = 'active', activated_by = $2, activated_at = NOW() WHERE version = $1`, [version, by ?? null]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  async listRules() { return (await this.db.query(`SELECT version, status, notes, created_by, created_at, activated_by, activated_at FROM studio_rules ORDER BY created_at DESC`)).rows; }

  async getInput(key: InputKey) {
    const r = await this.db.query(`SELECT value FROM studio_inputs WHERE key = $1`, [key]);
    return r.rows[0]?.value ?? null;
  }
  async putInput(key: string, value: any) {
    await this.db.query(`INSERT INTO studio_inputs (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, JSON.stringify(value)]);
  }

  async getTerritoryEdits() {
    const r = await this.db.query(`SELECT code, body FROM studio_territory_edits`);
    return Object.fromEntries(r.rows.map(x => [x.code, x.body]));
  }
  async saveTerritoryEdit(code: string, t: any) {
    await this.db.query(
      `INSERT INTO studio_territory_edits (code, body, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (code) DO UPDATE SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [code, t, t?.updated_by ?? null]);
  }

  // ---------- briefs ----------

  async saveBrief(b: any) {
    await this.db.query(`INSERT INTO studio_briefs (name, body) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body`, [b.name, b]);
  }
  async getBrief(name: string) {
    const r = await this.db.query(`SELECT body FROM studio_briefs WHERE name = $1`, [name.replace(/\.json$/, '')]);
    return r.rows[0]?.body ?? null;
  }

  // ---------- runs and lines ----------

  async batchExists(id: string) { return (await this.db.query(`SELECT 1 FROM studio_batches WHERE id = $1`, [id])).rowCount! > 0; }

  async getBatch(id: string) {
    const b = await this.db.query(`SELECT * FROM studio_batches WHERE id = $1`, [id]);
    if (!b.rows[0]) throw new Error(`No run ${id}`);
    const row = b.rows[0];
    const lines = await this.db.query(`SELECT body FROM studio_lines WHERE batch_id = $1 ORDER BY position`, [id]);
    return {
      id: row.id, brief: row.brief, created: new Date(row.created_at).toISOString(), created_by: row.created_by ?? undefined, rules_version: row.rules_version ?? undefined,
      updated: new Date(row.updated_at).toISOString(), lines: lines.rows.map(x => x.body), dropped: row.dropped, stats: row.stats,
    };
  }

  /**
   * Writes the run and every line in one transaction. The checker saves whole
   * runs while people are deciding on lines, so a line's decision fields are
   * only overwritten when the incoming decision is at least as recent as the
   * stored one; a newer decision in the database is kept.
   */
  async saveBatch(b: any) {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO studio_batches (id, brief, persona, territory, created_by, created_at, updated_at, stats, dropped, rules_version)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($9::timestamptz, NOW()), $7, $8, $10)
         ON CONFLICT (id) DO UPDATE SET brief = EXCLUDED.brief, created_by = COALESCE(studio_batches.created_by, EXCLUDED.created_by),
           updated_at = EXCLUDED.updated_at, stats = EXCLUDED.stats, dropped = EXCLUDED.dropped,
           rules_version = COALESCE(EXCLUDED.rules_version, studio_batches.rules_version)`,
        [b.id, b.brief, b.brief.persona, b.brief.territory, b.created_by ?? null, b.created, b.stats ?? {}, JSON.stringify(b.dropped ?? []), b.updated ?? null, b.rules_version ?? null]);
      for (let i = 0; i < b.lines.length; i++) await this.upsertLine(c, b.id, b.lines[i], i, false);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }

  /** One line only (a decision). The incoming decision always wins here: it is the newest. */
  async saveLine(batchId: string, line: any) {
    const c = await this.db.connect();
    try {
      const pos = await c.query(`SELECT position FROM studio_lines WHERE id = $1`, [line.id]);
      await this.upsertLine(c, batchId, line, pos.rows[0]?.position ?? 9999, true);
      await c.query(`UPDATE studio_batches SET updated_at = NOW() WHERE id = $1`, [batchId]);
    } finally { c.release(); }
  }

  private async upsertLine(c: pg.PoolClient, batchId: string, line: any, position: number, decisionWins: boolean) {
    const keep = DECISION_KEYS.map(k => `'${k}', studio_lines.body->'${k}'`).join(', ');
    await c.query(
      `INSERT INTO studio_lines (id, batch_id, position, body, model, decision, decided_by, decided_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (id) DO UPDATE SET
         position = EXCLUDED.position,
         model = EXCLUDED.model,
         updated_at = NOW(),
         body = CASE WHEN $9 OR studio_lines.decided_at IS NULL OR (EXCLUDED.decided_at IS NOT NULL AND EXCLUDED.decided_at >= studio_lines.decided_at)
                     THEN EXCLUDED.body
                     ELSE EXCLUDED.body || jsonb_build_object(${keep}) END,
         decision = CASE WHEN $9 OR studio_lines.decided_at IS NULL OR (EXCLUDED.decided_at IS NOT NULL AND EXCLUDED.decided_at >= studio_lines.decided_at)
                     THEN EXCLUDED.decision ELSE studio_lines.decision END,
         decided_by = CASE WHEN $9 OR studio_lines.decided_at IS NULL OR (EXCLUDED.decided_at IS NOT NULL AND EXCLUDED.decided_at >= studio_lines.decided_at)
                     THEN EXCLUDED.decided_by ELSE studio_lines.decided_by END,
         decided_at = GREATEST(studio_lines.decided_at, EXCLUDED.decided_at)`,
      [line.id, batchId, position, line, line.model ?? null, line.decision ?? '', line.decided_by ?? null, line.decided_at ?? null, decisionWins]);
  }

  async listBatchIds() { return (await this.db.query(`SELECT id FROM studio_batches ORDER BY updated_at DESC`)).rows.map(r => r.id); }

  async getEmbeddings(batchId: string) {
    const r = await this.db.query(`SELECT line_id, embedding::text AS e FROM studio_line_embeddings WHERE batch_id = $1`, [batchId]);
    return Object.fromEntries(r.rows.map(x => [x.line_id, JSON.parse(x.e)]));
  }
  async saveEmbeddings(batchId: string, e: Record<string, number[]>) {
    for (const [lineId, v] of Object.entries(e)) {
      // Embeddings are saved after their lines; a line not yet saved is skipped and saved on the next call.
      await this.db.query(
        `INSERT INTO studio_line_embeddings (line_id, batch_id, embedding)
         SELECT $1, $2, $3::vector WHERE EXISTS (SELECT 1 FROM studio_lines WHERE id = $1)
         ON CONFLICT (line_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
        [lineId, batchId, `[${v.join(',')}]`]);
    }
  }

  // ---------- decision history ----------

  async recordEdit(e: EditRecord) {
    await this.db.query(`INSERT INTO studio_edits (line_id, batch_id, before, after, by_user, at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [e.line_id, e.batch_id, JSON.stringify(e.before ?? null), JSON.stringify(e.after ?? null), e.by, e.at]);
  }
  async listEdits(lineId: string): Promise<EditRecord[]> {
    const r = await this.db.query(`SELECT line_id, batch_id, before, after, by_user, at FROM studio_edits WHERE line_id = $1 ORDER BY at, id`, [lineId]);
    return r.rows.map(x => ({ line_id: x.line_id, batch_id: x.batch_id, before: x.before, after: x.after, by: x.by_user, at: new Date(x.at).toISOString() }));
  }

  // ---------- taste ----------

  async getTaste() { return (await this.db.query(`SELECT body FROM studio_taste ORDER BY updated_at`)).rows.map(r => r.body); }
  async saveTaste(ex: any[]) {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`DELETE FROM studio_taste WHERE NOT (line_id = ANY($1::text[]))`, [ex.map(x => x.id)]);
      for (const x of ex) {
        await c.query(`INSERT INTO studio_taste (line_id, persona, body, updated_at) VALUES ($1, $2, $3, NOW())
                       ON CONFLICT (line_id) DO UPDATE SET persona = EXCLUDED.persona, body = EXCLUDED.body, updated_at = NOW()`, [x.id, x.persona, x]);
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }

  // ---------- blind compare ----------

  async getCompare(name: string) {
    const r = await this.db.query(`SELECT body FROM studio_compares WHERE name = $1`, [name]);
    if (!r.rows[0]) throw new Error(`No compare ${name}`);
    return r.rows[0].body;
  }
  async saveCompare(s: any) {
    await this.db.query(`INSERT INTO studio_compares (name, body, created_at) VALUES ($1, $2, COALESCE($3::timestamptz, NOW()))
                         ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body`, [s.name, s, s.created ?? null]);
  }
  async getCompareKey(name: string) {
    const r = await this.db.query(`SELECT key_labels FROM studio_compares WHERE name = $1`, [name]);
    if (!r.rows[0]?.key_labels) throw new Error(`No key for compare ${name}`);
    return r.rows[0].key_labels;
  }
  async saveCompareKey(name: string, labels: Record<string, string>) {
    await this.db.query(`UPDATE studio_compares SET key_labels = $2 WHERE name = $1`, [name, labels]);
  }
  async listCompares() { return (await this.db.query(`SELECT name FROM studio_compares ORDER BY created_at DESC`)).rows.map(r => r.name); }

  // ---------- spend ----------

  async spendTotal(since?: string) {
    const r = since ? await this.db.query(`SELECT COALESCE(SUM(usd), 0) AS t FROM studio_spend WHERE at >= $1`, [since]) : await this.db.query(`SELECT COALESCE(SUM(usd), 0) AS t FROM studio_spend`);
    return Number(r.rows[0].t);
  }
  async listSpend(): Promise<SpendEntry[]> {
    const r = await this.db.query(`SELECT label, usd, by_stage, calls, by_user, at FROM studio_spend ORDER BY at, id`);
    return r.rows.map(x => ({ label: x.label, usd: Number(x.usd), by_stage: x.by_stage, calls: x.calls, user: x.by_user ?? undefined, at: new Date(x.at).toISOString() }));
  }
  async addSpend(e: SpendEntry) {
    await this.db.query(`INSERT INTO studio_spend (label, usd, by_stage, calls, by_user, at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [e.label, e.usd, e.by_stage ?? null, e.calls ?? null, e.user ?? null, e.at]);
  }

  // ---------- assets (readout, deck, client logo) ----------

  // ---------- Ready for production ----------

  async saveSignoff(x: any) {
    await this.db.query(
      `INSERT INTO studio_signoffs (id, persona, territory, version, body, ready_by, ready_at, sha256) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [x.id, x.persona, x.territory, x.version, x, x.ready_by, x.ready_at, x.sha256]);
  }
  async listSignoffs() { return (await this.db.query(`SELECT body FROM studio_signoffs ORDER BY ready_at`)).rows.map(r => r.body); }
  async saveLineVersion(v: any) {
    await this.db.query(
      `INSERT INTO studio_line_versions (line_id, batch_id, version, field, text, sha256, created_by, created_at, signoff_id, stub)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (line_id, version) DO NOTHING`,
      [v.line_id, v.batch_id, v.version, v.field, v.text, v.sha256, v.created_by, v.created_at, v.signoff_id ?? null, v.stub ?? null]);
  }
  async listLineVersions(lineId: string) {
    const r = await this.db.query(`SELECT * FROM studio_line_versions WHERE line_id = $1 ORDER BY version`, [lineId]);
    return r.rows.map(x => ({ ...x, created_at: new Date(x.created_at).toISOString(), signoff_id: x.signoff_id ?? undefined, stub: x.stub ?? undefined }));
  }
  async saveExpectation(e: any) {
    await this.db.query(
      `INSERT INTO studio_expectations (id, persona, territory, signoff_id, line_ids, stubs, reason, created_by, created_at, sha256) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [e.id, e.persona, e.territory, e.signoff_id, JSON.stringify(e.line_ids), JSON.stringify(e.stubs ?? []), e.reason, e.created_by, e.created_at, e.sha256]);
  }
  async listExpectations() {
    const r = await this.db.query(`SELECT * FROM studio_expectations ORDER BY created_at`);
    return r.rows.map(x => ({ ...x, created_at: new Date(x.created_at).toISOString() }));
  }

  async getAsset(name: string): Promise<Asset | null> {
    const r = await this.db.query(`SELECT content_type, data, filename FROM studio_assets WHERE name = $1`, [name]);
    return r.rows[0] ? { contentType: r.rows[0].content_type, data: r.rows[0].data, filename: r.rows[0].filename ?? undefined } : null;
  }
  async hasAsset(name: string) { return (await this.db.query(`SELECT 1 FROM studio_assets WHERE name = $1`, [name])).rowCount! > 0; }
  async putAsset(name: string, asset: Asset) {
    await this.db.query(`INSERT INTO studio_assets (name, content_type, data, filename, updated_at) VALUES ($1, $2, $3, $4, NOW())
                         ON CONFLICT (name) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data, filename = EXCLUDED.filename, updated_at = NOW()`,
      [name, asset.contentType, asset.data, asset.filename ?? null]);
  }
}
