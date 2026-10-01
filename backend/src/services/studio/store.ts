// Where Copy Studio keeps its work. The engine talks only to this interface:
// FileStore is the B1-lite folder layout (local, CLI, tests); PgStore
// (pgStore.ts) is the database used by the hosted Studio.

import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

export interface SpendEntry { label: string; usd: number; by_stage?: Record<string, number>; calls?: Record<string, number>; at: string; user?: string }
export interface Asset { contentType: string; data: Buffer; filename?: string }
/** working_round:<user>: the round a person is working in (rounds.ts). */
export type InputKey = 'personas' | 'voices' | 'rubric' | 'rounds' | 'bulk_checks' | `working_round:${string}`;
export interface EditRecord { line_id: string; batch_id: string; before: unknown; after: unknown; by: string; at: string }
/** saveBatch: `lineIds` writes only those lines (a job saving the lines it made or checked); the header always. */
export interface SaveBatchOptions { lineIds?: string[] }

/**
 * A run header saved from an older copy keeps what others added meanwhile: the creative director's lines on the
 * brief (by text) and the dropped near-duplicates are merged, not replaced.
 */
export function mergeBatchHeader(cur: { brief: any; dropped: any[] }, next: { brief: any; dropped?: any[] }) {
  const own = [...(cur.brief?.own_lines || [])];
  for (const o of next.brief?.own_lines || []) if (!own.some(x => x.text === o.text)) own.push(o);
  const dropped = [...(cur.dropped || [])];
  for (const d of next.dropped || []) if (!dropped.some(x => x.text === d.text && x.cell === d.cell)) dropped.push(d);
  return { brief: { ...next.brief, own_lines: own }, dropped };
}

/** In-process keyed lock (FileStore: one process, local). Re-entrant within one async call chain. */
class KeyedLock {
  private tails = new Map<string, Promise<void>>();
  private held = new AsyncLocalStorage<Set<string>>();
  async run<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    const have = this.held.getStore() || new Set<string>();
    const need = [...new Set(keys)].sort().filter(k => !have.has(k));
    if (!need.length) return fn();
    const releases: Array<() => void> = [];
    for (const k of need) {
      const prev = this.tails.get(k) || Promise.resolve();
      let release!: () => void;
      const mine = new Promise<void>(r => { release = r; });
      const tail = prev.then(() => mine);
      this.tails.set(k, tail);
      await prev;
      releases.push(() => { release(); if (this.tails.get(k) === tail) this.tails.delete(k); });
    }
    try { return await this.held.run(new Set([...have, ...need]), fn); } finally { releases.reverse().forEach(r => r()); }
  }
}

export interface StudioStore {
  readonly kind: 'file' | 'pg';
  /**
   * Run fn holding locks on the keys (run:<id>, signoff:<persona>|<territory>, spend): changes to the same run are
   * made one at a time, each on fresh data. PgStore: advisory locks, and one transaction for fn's store calls.
   */
  withLock<T>(keys: string[], fn: () => Promise<T>): Promise<T>;
  /** The active rules body (the studio-rules.json shape). */
  getRules(): Promise<any>;
  /** Territory edits layered over the rules' pitch territories. */
  getTerritoryEdits(): Promise<Record<string, any>>;
  saveTerritoryEdit(code: string, territory: any): Promise<void>;
  /** Named inputs: 'personas' (seed file), 'voices' (lived voice samples), 'rubric' (the M3 rubric, for Pre-flight). */
  getInput(key: InputKey): Promise<any | null>;
  /** Write a named input ('rounds': the rounds and which one is active). */
  putInput(key: InputKey, value: any): Promise<void>;

  saveBrief(brief: any): Promise<void>;
  getBrief(name: string): Promise<any | null>;

  batchExists(id: string): Promise<boolean>;
  getBatch(id: string): Promise<any>;
  /** Writes the run header (merged, see mergeBatchHeader) and its lines, or only `lineIds`. Never removes a line. */
  saveBatch(batch: any, opts?: SaveBatchOptions): Promise<void>;
  /** Writes one line only (a decision), so two people deciding on different lines don't overwrite each other. */
  saveLine(batchId: string, line: any): Promise<void>;
  listBatchIds(): Promise<string[]>;
  getEmbeddings(batchId: string): Promise<Record<string, number[]>>;
  saveEmbeddings(batchId: string, embeddings: Record<string, number[]>): Promise<void>;

  recordEdit(edit: EditRecord): Promise<void>;
  listEdits(lineId: string): Promise<EditRecord[]>;

  getTaste(): Promise<any[]>;
  /** Replaces the whole set (the import tool only). */
  saveTaste(examples: any[]): Promise<void>;
  /** One line's taste example: added or replaced, or removed. What decisions use. */
  putTaste(example: any): Promise<void>;
  deleteTaste(lineId: string): Promise<void>;

  getCompare(name: string): Promise<any>;
  saveCompare(set: any): Promise<void>;
  getCompareKey(name: string): Promise<Record<string, string>>;
  saveCompareKey(name: string, labels: Record<string, string>): Promise<void>;
  listCompares(): Promise<string[]>;

  /** Total spend, optionally since an ISO date (the monthly cap). */
  spendTotal(since?: string): Promise<number>;
  listSpend(): Promise<SpendEntry[]>;
  addSpend(entry: SpendEntry): Promise<void>;
  /** Removes spend rows by label (a run's reservation, settled when it ends). */
  deleteSpend(label: string): Promise<void>;
  /** Removes reservations ("reserved: …" rows) older than `ms`: left by a run the server restarted in the middle of. Returns them. */
  clearStaleReservations(ms: number): Promise<SpendEntry[]>;

  /** Ready for production: sign-offs, line versions and expectations records. Append-only. */
  saveSignoff(s: any): Promise<void>;
  listSignoffs(): Promise<any[]>;
  saveLineVersion(v: any): Promise<void>;
  listLineVersions(lineId: string): Promise<any[]>;
  saveExpectation(e: any): Promise<void>;
  listExpectations(): Promise<any[]>;

  /** Files the Studio serves: doc:<id> (reference documents), brand:<name> (the client logo). */
  getAsset(name: string): Promise<Asset | null>;
  hasAsset(name: string): Promise<boolean>;

  /** Optional file outputs (FileStore writes them for Sheets and screen-sharing; PgStore doesn't). */
  writeOutput?(relPath: string, content: string): Promise<string>;
}

// ---------- files ----------

function readJson<T = any>(p: string): T { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p: string, v: unknown) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); }

export class FileStore implements StudioStore {
  readonly kind = 'file' as const;
  constructor(public dir: string, private opts: { rulesPath?: string; inputsDir?: string; assets?: Record<string, { path: string; contentType: string }> } = {}) {}
  private P(...parts: string[]) { return path.join(this.dir, ...parts); }
  private lock = new KeyedLock();
  withLock<T>(keys: string[], fn: () => Promise<T>): Promise<T> { return this.lock.run(keys, fn); }

  async getRules() {
    const p = this.opts.rulesPath || this.P('studio-rules.json');
    if (!fs.existsSync(p)) throw new Error(`No rules file at ${p}`);
    return readJson(p);
  }
  async getTerritoryEdits() { const p = this.P('territories.json'); return fs.existsSync(p) ? readJson(p).territories || {} : {}; }
  async saveTerritoryEdit(code: string, territory: any) {
    const all = await this.getTerritoryEdits();
    all[code] = territory;
    writeJson(this.P('territories.json'), { _note: 'Territory edits made in Studio (client feedback, creative director preference). They override the pitch versions in studio-rules.json, which stay unchanged.', territories: all });
  }
  private inputFile = (key: string) => this.P(`${key.replace(/[^\w.@-]+/g, '_')}.json`);
  async putInput(key: InputKey, value: any) { writeJson(this.inputFile(key), value); }
  async getInput(key: InputKey) {
    if (key === 'rounds' || key === 'bulk_checks' || key.startsWith('working_round:')) { const p = this.inputFile(key); return fs.existsSync(p) ? readJson(p) : null; }
    const inputs = this.opts.inputsDir;
    const candidates = key === 'rubric' ? [this.P('rubric.json'), ...(inputs ? [path.join(inputs, 'rubric.json')] : [])]
      : key === 'personas'
      ? [this.P('personas.json'), ...(inputs ? [path.join(inputs, 'personas.json')] : [])]
      : [this.P('voices.json'), ...(inputs ? [path.join(inputs, 'sm-spike', 'voices.json')] : [])];
    const p = candidates.find(c => fs.existsSync(c));
    return p ? readJson(p) : null;
  }

  async saveBrief(b: any) { writeJson(this.P('briefs', `${b.name}.json`), b); }
  async getBrief(name: string) {
    const p = fs.existsSync(name) ? name : this.P('briefs', name.endsWith('.json') ? name : `${name}.json`);
    return fs.existsSync(p) ? readJson(p) : null;
  }

  private batchPath(id: string) { return this.P('batches', id, 'batch.json'); }
  async batchExists(id: string) { return fs.existsSync(this.batchPath(id)); }
  async getBatch(id: string) {
    if (!fs.existsSync(this.batchPath(id))) throw new Error(`No run ${id}`);
    return readJson(this.batchPath(id));
  }
  async saveBatch(b: any, opts: SaveBatchOptions = {}) {
    if (!fs.existsSync(this.batchPath(b.id))) { writeJson(this.batchPath(b.id), b); return; }
    // Merge into what's on disk: never drop a line someone else added, and write only the lines asked for.
    const cur = readJson(this.batchPath(b.id));
    const only = opts.lineIds ? new Set(opts.lineIds) : null;
    const mine = new Map<string, any>(b.lines.filter((l: any) => !only || only.has(l.id)).map((l: any) => [l.id, l]));
    const lines = cur.lines.map((l: any) => mine.get(l.id) ?? l);
    for (const [id, l] of mine) if (!cur.lines.some((x: any) => x.id === id)) lines.push(l);
    writeJson(this.batchPath(b.id), { ...b, ...mergeBatchHeader(cur, b), lines });
  }
  async saveLine(batchId: string, line: any) {
    const b = await this.getBatch(batchId);
    b.lines = b.lines.map((l: any) => (l.id === line.id ? line : l));
    b.updated = new Date().toISOString();
    writeJson(this.batchPath(batchId), b);
  }
  async listBatchIds() {
    const d = this.P('batches');
    return fs.existsSync(d) ? fs.readdirSync(d).filter(x => fs.existsSync(this.batchPath(x))) : [];
  }
  async getEmbeddings(id: string) { const p = this.P('batches', id, 'embeddings.json'); return fs.existsSync(p) ? readJson(p) : {}; }
  async saveEmbeddings(id: string, e: Record<string, number[]>) { writeJson(this.P('batches', id, 'embeddings.json'), e); }

  async recordEdit(edit: EditRecord) { fs.mkdirSync(this.dir, { recursive: true }); fs.appendFileSync(this.P('edits.jsonl'), JSON.stringify(edit) + '\n'); }
  async listEdits(lineId: string) {
    const p = this.P('edits.jsonl');
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter((e: EditRecord) => e.line_id === lineId);
  }

  async getTaste() { const p = this.P('taste.json'); return fs.existsSync(p) ? readJson(p).examples || [] : []; }
  async saveTaste(ex: any[]) { writeJson(this.P('taste.json'), { _note: 'Kept, edited and cut-with-note lines from the creative director; used as few-shot taste examples by generate.', examples: ex }); }
  async putTaste(x: any) { await this.lock.run(['taste'], async () => { const all = await this.getTaste(); await this.saveTaste([...all.filter((e: any) => e.id !== x.id), x]); }); }
  async deleteTaste(id: string) { await this.lock.run(['taste'], async () => { const all = await this.getTaste(); await this.saveTaste(all.filter((e: any) => e.id !== id)); }); }

  async getCompare(name: string) { return readJson(this.P('compare', name, 'set.json')); }
  async saveCompare(s: any) { writeJson(this.P('compare', s.name, 'set.json'), s); }
  async getCompareKey(name: string) { return readJson(this.P('compare', name, 'key.json')).labels; }
  async saveCompareKey(name: string, labels: Record<string, string>) { writeJson(this.P('compare', name, 'key.json'), { _note: 'The key. Keep closed until the creative director has picked favourites.', labels }); }
  async listCompares() {
    const d = this.P('compare');
    return fs.existsSync(d) ? fs.readdirSync(d).filter(x => fs.existsSync(path.join(d, x, 'set.json'))).sort().reverse() : [];
  }

  private spendFile() { const p = this.P('spend.json'); return fs.existsSync(p) ? readJson(p) : { total_usd: 0, runs: [] }; }
  async spendTotal(since?: string) {
    if (!since) return Number(this.spendFile().total_usd) || 0;
    return (this.spendFile().runs as SpendEntry[]).filter(r => (r.at || '') >= since).reduce((t, r) => t + (r.usd || 0), 0);
  }
  async listSpend() { return this.spendFile().runs as SpendEntry[]; }
  async clearStaleReservations(ms: number) {
    const s = this.spendFile();
    const cutoff = new Date(Date.now() - ms).toISOString();
    const stale = (s.runs as SpendEntry[]).filter(r => r.label.startsWith('reserved:') && r.at < cutoff);
    if (stale.length) {
      s.runs = s.runs.filter((r: SpendEntry) => !stale.includes(r));
      s.total_usd = Math.round(s.runs.reduce((t: number, r: any) => t + (r.usd || 0), 0) * 10000) / 10000;
      writeJson(this.P('spend.json'), s);
    }
    return stale;
  }
  async deleteSpend(label: string) {
    const s = this.spendFile();
    s.runs = s.runs.filter((r: any) => r.label !== label);
    s.total_usd = Math.round(s.runs.reduce((t: number, r: any) => t + (r.usd || 0), 0) * 10000) / 10000;
    writeJson(this.P('spend.json'), s);
  }
  async addSpend(e: SpendEntry) {
    const s = this.spendFile();
    s.runs.push(e);
    s.total_usd = Math.round(s.runs.reduce((t: number, r: any) => t + (r.usd || 0), 0) * 10000) / 10000;
    writeJson(this.P('spend.json'), s);
  }

  private appendJsonl(name: string, v: unknown) { fs.mkdirSync(this.P('ready'), { recursive: true }); fs.appendFileSync(this.P('ready', name), JSON.stringify(v) + '\n'); }
  private readJsonl(name: string): any[] { const p = this.P('ready', name); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; }
  async saveSignoff(x: any) { this.appendJsonl('signoffs.jsonl', x); }
  async listSignoffs() { return this.readJsonl('signoffs.jsonl'); }
  async saveLineVersion(v: any) { this.appendJsonl('line-versions.jsonl', v); }
  async listLineVersions(lineId: string) { return this.readJsonl('line-versions.jsonl').filter(v => v.line_id === lineId).sort((a, b) => a.version - b.version); }
  async saveExpectation(e: any) { this.appendJsonl('expectations.jsonl', e); }
  async listExpectations() { return this.readJsonl('expectations.jsonl'); }

  async getAsset(name: string): Promise<Asset | null> {
    const a = this.opts.assets?.[name];
    if (!a || !fs.existsSync(a.path)) return null;
    return { contentType: a.contentType, data: fs.readFileSync(a.path), filename: path.basename(a.path) };
  }
  async hasAsset(name: string) { const a = this.opts.assets?.[name]; return !!a && fs.existsSync(a.path); }

  async writeOutput(rel: string, content: string) {
    const p = this.P(rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return p;
  }
}
