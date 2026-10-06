// The Studio's HTTP API, shared by the local server (`studio.ts serve`) and
// the hosted app (routes/studio.ts). Callers supply who the user is, how jobs
// get an Api, the spend limits and, when hosted, admin checks for rules. This
// file imports nothing from src/db, so the CLI can use it without touching a
// database connection.

import express, { type Request, type Response, type Router } from 'express';
import * as S from './engine.js';
import type { PgStore } from './pgStore.js';
import * as R from './ready.js';
import * as Rounds from './rounds.js';
import * as Bulk from './bulk.js';
import * as Ws from './worksheet.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import multer from 'multer';
import { R2_FILE_CAP, type Preflight } from './preflight.js';

export interface StudioRouterOptions {
  /** The person acting on this request (recorded on runs, decisions, edits and spend). */
  who(req: Request): string | undefined;
  /** An Api for one job. Hosted: a fresh one per job (shared pacer), so one person's cap stop doesn't stop everyone. */
  api(req: Request): S.Api;
  mock: boolean;
  /** Spend limit in dollars, and what it covers. */
  cap: number;
  capWindow: 'all' | 'month';
  /** Runs estimated above this need a confirm. */
  askOver: number;
  /** Hosted only: rules versions live in the database and only admins may upload or activate one. */
  /** selfContained: an upload must carry the rubric and each persona's seed and voice (hosted: nothing is imported from a laptop). */
  rules?: { store: PgStore; isAdmin(req: Request): boolean; selfContained?: boolean };
  /** Extra fields for /meta (e.g. the signed-in user). */
  metaExtra?(req: Request): Record<string, unknown>;
  /** Pre-flight (needs the database). canSetReady: who may mark assets Ready to traffic. */
  preflight?: { service: Preflight; canSetReady(req: Request): boolean };
  /** Who may set compliance status on copy. Local: anyone. */
  canSetCompliance?(req: Request): boolean;
  /** Who may override a red flag on copy at Ready for production (hosted: STUDIO_READY_EMAILS + admins, as in Pre-flight). Unset = anyone (local). */
  canOverride?(req: Request): boolean;
  /** Who may sign lines off at Ready for production (hosted: STUDIO_READY_EMAILS + admins). Unset = anyone (local). */
  canSignOff?(req: Request): boolean;
  /**
   * "On behalf of": the people a call can be recorded for (hosted: the Studio users). Unset (local) = any name. Role
   * checks always use the signed-in person (who), never the person a call is recorded for.
   */
  people?(): string[];
}

// Top-level keys every rules version needs (scripts/studio/rules.schema.json `required`).
const RULES_REQUIRED = ['sources', 'fields', 'structures', 'facts', 'figure_rule', 'compliance', 'brand', 'clarity', 'features', 'personas', 'territories', 'needs_review'];

interface Job { events: S.StudioEvent[]; clients: Set<Response>; done: boolean; finished?: number }

export function monthStart(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** A reservation older than this was left by a run the server restarted in the middle of (runs take minutes). */
export const STALE_RESERVATION_MS = 2 * 60 * 60 * 1000;
/** Clear leftover reservations (on startup), logging each one; they'd otherwise hold money against the cap. */
export async function clearStaleReservations(log: (m: string) => void = m => console.log(m)): Promise<number> {
  const gone = await S.getStore().clearStaleReservations(STALE_RESERVATION_MS);
  for (const x of gone) log(`[studio] cleared a leftover spend reservation: ${x.label} ($${x.usd.toFixed(4)}${x.user ? `, ${x.user}` : ''}, ${x.at})`);
  return gone.length;
}

export function createStudioRouter(o: StudioRouterOptions): Router {
  const r = express.Router();
  if (!o.mock) clearStaleReservations().catch(err => console.warn(`[studio] couldn't clear leftover spend reservations: ${err?.message || err}`));
  const jobs = new Map<string, Job>();

  r.use(express.json({ limit: '2mb' }));
  r.use(express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }));

  const wrap = (fn: (req: Request, res: Response) => any) => async (req: Request, res: Response) => {
    // An error that says what it is (402 budget, 403 not allowed, 409 someone else changed it) keeps its status.
    try { await fn(req, res); } catch (err: any) { if (!res.headersSent) res.status([402, 403, 409, 503].includes(err?.status) ? err.status : 400).json({ error: String(err?.message || err), ...(err?.status === 409 ? { conflict: true } : {}) }); }
  };
  /**
   * Reserve a job's estimated cost against the cap before it starts, under a lock: two runs started together can't
   * pass the cap between them (each used to check the total before either had spent). The reservation is a spend row
   * that's removed when the job ends, by which time the job has recorded what it actually spent.
   */
  async function reserve(label: string, usd: number, api?: S.Api, user?: string): Promise<{ release: () => Promise<void> } | { error: string }> {
    if (o.mock) return { release: async () => {} };
    return S.getStore().withLock(['spend'], async () => {
      const so = await spent();
      if (so + usd > o.cap) return { error: `This would take spend past ${capText()} ($${so.toFixed(2)} spent or reserved by runs in progress).` };
      const tag = `reserved: ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await S.getStore().addSpend({ label: tag, usd: Math.round(usd * 10000) / 10000, at: new Date().toISOString(), user });
      if (api) api.reserved = usd;   // its own reservation doesn't count against its mid-run check
      return { release: () => S.getStore().deleteSpend(tag) };
    });
  }
  const spent = async () => (o.mock ? 0 : await S.getStore().spendTotal(o.capWindow === 'month' ? monthStart() : undefined));
  const capText = () => (o.capWindow === 'month' ? `this month's $${o.cap} Studio budget` : `the $${o.cap} cap`);

  function startJob(id: string, run: (emit: (e: S.StudioEvent) => void) => Promise<unknown>) {
    // Finished jobs are kept an hour for late subscribers, then dropped.
    const now = Date.now();
    for (const [k, j] of jobs) if (j.finished && now - j.finished > 3600_000) jobs.delete(k);
    const job: Job = { events: [], clients: new Set(), done: false };
    jobs.set(id, job);
    const emit = (e: S.StudioEvent) => {
      // Lines are re-sent as they change; keep only the latest copy for late subscribers.
      if (e.type === 'line') { const i = job.events.findIndex(x => x.type === 'line' && x.line.id === e.line.id); if (i >= 0) job.events.splice(i, 1); }
      job.events.push(e);
      for (const c of job.clients) c.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    run(emit).catch(err => emit({ type: 'error', message: String(err?.message || err) })).finally(() => {
      job.done = true;
      job.finished = Date.now();
      for (const c of job.clients) c.end();
    });
    return id;
  }
  const download = (res: Response, type: string, name: string, body: string | Buffer) => {
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^\w.~-]/g, '_')}"`);
    res.send(body);
  };

  // Reload rules and territories on each request, so edits (and other servers' edits) are always current.
  // A fresh database has no rules until an admin uploads them, so the rules routes work without them and
  // everything else says so plainly (503 no_rules) instead of failing.
  r.use(async (req, res, next) => {
    try { await S.refreshRules(); next(); } catch (err: any) {
      if (!/No active Studio rules/.test(String(err?.message))) return next(err);
      if (o.rules && req.path.startsWith('/rules')) return next();
      res.status(503).json({ error: 'no_rules', message: 'No rules are active yet. An admin uploads studio-rules.json in the Rules view and activates it.' });
    }
  });

  /**
   * Whose call this request records, when it isn't the person's own: the X-Studio-For header (the page's "for" picker).
   * Hosted, it must be a Studio user; anyone else is refused rather than recorded.
   */
  const forOf = (req: Request): string | undefined => {
    const f = String(req.get('x-studio-for') || '').trim();
    if (!f || f.toLowerCase() === String(o.who(req) || '').toLowerCase()) return undefined;
    if (o.people && !o.people().some(p => p.toLowerCase() === f.toLowerCase())) throw Object.assign(new Error(`${f} isn't on the Studio list: a call can only be recorded for a Studio user`), { status: 403 });
    return o.people ? o.people().find(p => p.toLowerCase() === f.toLowerCase()) : f;
  };

  r.get('/meta', wrap(async (req, res) => {
    const { studio_dir, ...m } = await S.meta();
    const isAdmin = o.rules ? o.rules.isAdmin(req) : true;
    // Admins see whether storage can take files (the boot check, or the last refused upload) on the Rules page.
    const pf = o.preflight ? { enabled: true, storage: o.preflight.service.storageStatus, engine: o.preflight.service.engineName, can_set_ready: o.preflight.canSetReady(req), ...(isAdmin ? { storage_check: o.preflight.service.storageCheck } : {}) } : { enabled: false };
    const rounds = await Rounds.getRounds();
    // working: the round this person works in (theirs; the active round unless an admin picked a test round); choices: what they may pick.
    const working = await Rounds.workingRound(o.who(req), rounds);
    // Retired territories that still have runs or sign-offs in the round in view (a Demo round on pitch territories
    // retired since): the board and the pickers keep showing them, marked retired; only new briefs are refused.
    const view = await Rounds.roundView(rq(req), o.who(req));
    const retired = new Set(Object.entries(m.territories).filter(([, t]: [string, any]) => t.status === 'retired').map(([k]) => k));
    const retired_with_work = retired.size ? [...new Set([...(await S.listBatches(undefined, view)).map(b => b.territory), ...(await R.latestSignoffs({ view })).map(x => x.territory)].filter(t => retired.has(t)))] : [];
    res.json({ ...m, retired_with_work, ...(o.rules ? {} : { studio_dir }), preflight: pf, rounds: { ...rounds, can_edit: isAdmin, working: working.id, choices: Rounds.workingChoices(rounds, isAdmin).map(x => x.id) }, can_set_compliance: o.canSetCompliance ? o.canSetCompliance(req) : true, can_override: o.canOverride ? o.canOverride(req) : true, can_sign_off: o.canSignOff ? o.canSignOff(req) : true, people: o.people ? o.people() : null, spend: await spent(), mock: o.mock, cap: o.cap, cap_window: o.capWindow, ask_over: o.askOver, ...(o.metaExtra?.(req) || {}) });
  }));
  r.post('/estimate', wrap(async (req, res) => {
    const b = S.makeBrief(req.body.brief || {});
    // allocation: what will be written, per field (the Write screen's summary line), from the same counts generate keeps to.
    res.json({ brief: b, ...S.estimate(b, { ownOnly: !!req.body.own_only }), allocation: S.allocation(b, { ownOnly: !!req.body.own_only }), spent: await spent() });
  }));

  // ----- runs -----
  // Lists follow the round view: the active round by default, ?round=all for every round (test rounds marked by their id).
  const rq = (req: Request) => (req.query.round ? String(req.query.round) : req.body?.round ? String(req.body.round) : undefined);
  r.get('/batches', wrap(async (req, res) => res.json(await S.listBatches(req.query.user ? String(req.query.user) : undefined, await Rounds.roundView(rq(req), o.who(req))))));

  // ----- rounds (admin): the active round is stamped on new runs and sign-offs -----
  const roundsAdmin = (req: Request, res: Response) => { if (o.rules && !o.rules.isAdmin(req)) { res.status(403).json({ error: 'Rounds are set by an admin listed in ADMIN_EMAILS' }); return false; } return true; };
  r.get('/rounds', wrap(async (_req, res) => res.json(await Rounds.getRounds())));
  // The round this person works in: the active round, or (admins) a test round. Never changes the global active round.
  r.post('/rounds/working', wrap(async (req, res) => res.json(await Rounds.setWorkingRound(o.who(req) || '', String(req.body?.id || ''), o.rules ? o.rules.isAdmin(req) : true))));
  r.post('/rounds', wrap(async (req, res) => { if (roundsAdmin(req, res)) res.json(await Rounds.saveRound(req.body || {}, o.who(req))); }));
  r.post('/rounds/:id/activate', wrap(async (req, res) => { if (roundsAdmin(req, res)) res.json(await Rounds.setActiveRound(String(req.params.id).toUpperCase())); }));
  r.get('/batches/:id', wrap(async (req, res) => res.json(await S.loadBatch(req.params.id))));
  r.post('/generate', wrap(async (req, res) => {
    // Checked before the brief is built, so the answer is always "start a new run", whatever else is wrong with it.
    const raw = req.body.brief || {};
    const mismatch = await S.runMismatch(req.body.batch ? String(req.body.batch) : undefined, { persona: raw.persona || S.loadRules().territories[raw.territory]?.persona, territory: raw.territory, region: raw.region });
    if (mismatch) return res.status(409).json({ error: mismatch, run_mismatch: true });
    const b = S.makeBrief(raw);
    const ownOnly = !!req.body.own_only;
    const e = S.estimate(b, { ownOnly });
    if (!o.mock && e.usd > o.askOver && !req.body.confirm) return res.status(409).json({ needs_confirm: true, estimate: e.usd });
    // Whose run it is ("on behalf of"); permissions and spend stay the signed-in person's.
    const who = o.who(req), forWho = forOf(req);
    const api = o.api(req);
    const held = await reserve(`generate ${b.territory}`, e.usd, api, o.who(req));
    if ('error' in held) return res.status(402).json({ error: held.error });
    await S.saveBrief(b);
    // Continue an existing run, or start a new one.
    const id = req.body.batch ? String(req.body.batch) : await S.newBatchId(b.territory);
    const job = startJob(`${id}~${Date.now()}`, emit => S.generate(b, api, emit, { batchId: id, ownOnly, user: who, for: forWho }).finally(held.release));
    res.json({ batch: id, job, estimate: e.usd });
  }));
  // An admin's correction: credit an existing run to someone (or clear it with an empty name).
  r.post('/batches/:id/for', wrap(async (req, res) => {
    if (o.rules && !o.rules.isAdmin(req)) return res.status(403).json({ error: 'Only an admin listed in ADMIN_EMAILS can change who a run is for' });
    const f = String(req.body?.for || '').trim();
    const listed = o.people ? o.people().find(p => p.toLowerCase() === f.toLowerCase()) : f;
    if (f && !listed) return res.status(400).json({ error: `${f} isn't on the Studio list` });
    res.json(await S.setRunFor(req.params.id, listed || '', o.who(req)));
  }));
  r.post('/batches/:id/resume', wrap(async (req, res) => {
    const api = o.api(req);
    res.json({ job: startJob(`${req.params.id}~resume~${Date.now()}`, emit => S.resumeChecks(req.params.id, api, emit)) });
  }));
  r.get('/jobs/:id/events', (req, res) => {
    const job = jobs.get(req.params.id);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    if (!job) { res.write(`data: ${JSON.stringify({ type: 'error', message: 'No such job (the server may have restarted; reopen the run and resume it)' })}\n\n`); res.end(); return; }
    for (const e of job.events) res.write(`data: ${JSON.stringify(e)}\n\n`);
    if (job.done) { res.end(); return; }
    job.clients.add(res);
    req.on('close', () => job.clients.delete(res));
  });
  r.patch('/batches/:id/lines/:line', wrap(async (req, res) => res.json(await S.setDecision(req.params.id, req.params.line, req.body || {}, o.who(req), forOf(req)))));
  r.get('/lines/:line/history', wrap(async (req, res) => res.json(await S.lineHistory(req.params.line))));
  r.post('/batches/:id/lines/:line/more', wrap(async (req, res) => {
    const api = o.api(req);
    const k = Number(req.body?.k || 3);
    const run = await S.loadBatch(req.params.id);
    const held = await reserve(`more ${req.params.line}`, S.estimate({ ...run.brief, n: k, own_lines: [] }).usd, api, o.who(req));
    if ('error' in held) return res.status(402).json({ error: held.error });
    res.json({ job: startJob(`${req.params.id}~more~${Date.now()}`, emit => S.moreLikeThis(req.params.id, req.params.line, String(req.body?.note || ''), k, api, emit).finally(held.release)) });
  }));
  // ----- Copy check (bulk check + report): paste a table of someone's copy, check every line, share the report -----
  const bulkView = (p: Bulk.BulkParse) => {
    const rules = S.loadRules();
    return {
      header: p.header, errors: p.errors, estimate: p.rows.length ? Bulk.estimateBulk(p.rows) : { usd: 0, seconds: 0, lines: 0, runs: 0 },
      rows: p.rows.map(x => ({ ...x, persona_name: rules.personas[x.persona]?.name, territory_name: rules.territories[x.territory]?.name?.replace(/\.$/, ''), field_label: rules.fields[x.field]?.label, shared: x.persona === S.SHARED_PERSONA })),
    };
  };
  r.post('/bulk/parse', wrap(async (req, res) => { await S.refreshRules(); res.json(bulkView(Bulk.parseBulk(String(req.body?.text || ''), S.loadRules(), req.body?.defaults || {}))); }));
  r.post('/bulk/check', wrap(async (req, res) => {
    await S.refreshRules();
    const parsed = Bulk.parseBulk(String(req.body?.text || ''), S.loadRules(), req.body?.defaults || {});
    if (!parsed.rows.length) return res.status(400).json({ error: parsed.errors[0] ? `Nothing to check: ${parsed.errors[0].error}` : 'Paste the lines to check' });
    const est = Bulk.estimateBulk(parsed.rows);
    if (!o.mock && est.usd > o.askOver && !req.body?.confirm) return res.status(409).json({ needs_confirm: true, estimate: est.usd });
    const api = o.api(req);
    const id = `bulk-${new Date().toISOString().replace(/[-:T]/g, '').slice(2, 14)}`;
    const held = await reserve(`copy-check ${id}`, est.usd, api, o.who(req));
    if ('error' in held) return res.status(402).json({ error: held.error });
    const who = o.who(req), forWhom = String(req.body?.for || '').trim() || undefined;
    res.json({ bulk: id, estimate: est, job: startJob(`${id}~${Date.now()}`, emit => Bulk.runBulk(parsed, api, { user: who, for: forWhom, id }, emit).finally(held.release)) });   // each run records its own spend (generate)
  }));
  r.get('/bulk', wrap(async (_req, res) => res.json(await Bulk.listBulk())));

  // ----- The worksheet: the month's copy as one table per step, as a sheet, and the sheet read back -----
  const wsRegion = (req: Request) => { const q = String(req.query.region || req.body?.region || 'US').toUpperCase(); return (q === 'ALL' ? 'all' : q === 'CA' ? 'CA' : 'US') as 'US' | 'CA' | 'all'; };
  r.get('/worksheet', wrap(async (req, res) => { await S.refreshRules(); res.json(await Ws.worksheet(await Rounds.roundView(rq(req), o.who(req)), wsRegion(req))); }));
  r.get('/worksheet.xlsx', wrap(async (req, res) => {
    await S.refreshRules();
    const view = await Rounds.roundView(rq(req), o.who(req));
    const ws = await Ws.worksheet(view, wsRegion(req));
    download(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${Rounds.testOnly(view) ? 'TEST_' : ''}copy-worksheet-${ws.round}-${new Date().toISOString().slice(0, 10)}.xlsx`, await Ws.exportXlsx(ws, { by: o.who(req) }));
  }));
  // The filled-in sheet comes back as a file. Preview says what would change and writes nothing; apply works the
  // preview out again on the file it is sent, so what is written is what Studio holds at that moment.
  const sheetFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single('file');
  const sheetOf = async (req: Request) => {
    const f = (req as any).file as { buffer: Buffer } | undefined;
    if (!f) throw Object.assign(new Error('Choose the filled-in worksheet (.xlsx)'), { status: 400 });
    await S.refreshRules();
    let accept: string[] = [];
    try { accept = JSON.parse(String(req.body?.accept || '[]')); } catch { /* none */ }
    return { sheet: await Ws.parseXlsx(f.buffer), accept: Array.isArray(accept) ? accept.map(String) : [] };
  };
  r.post('/worksheet/import/preview', sheetFile, wrap(async (req, res) => {
    const { sheet, accept } = await sheetOf(req);
    res.json(await Ws.previewImport(sheet, await Rounds.roundView(rq(req), o.who(req)), { accept }));
  }));
  r.post('/worksheet/import/apply', sheetFile, wrap(async (req, res) => {
    const { sheet, accept } = await sheetOf(req);
    const view = await Rounds.roundView(rq(req), o.who(req));
    const p = await Ws.previewImport(sheet, view, { accept });
    const addUnmatched = String(req.body?.add_unmatched) === 'true';
    if (!(p.counts.keep + p.counts.cut + p.counts.rewrite + (p.no_ids && !addUnmatched ? 0 : p.counts.new))) return res.status(400).json({ error: 'Nothing in this sheet would change anything' });
    if (!o.mock && p.estimate.usd > o.askOver && String(req.body?.confirm) !== 'true') return res.status(409).json({ needs_confirm: true, estimate: p.estimate.usd });
    const who = o.who(req), forWho = forOf(req);
    const api = o.api(req);
    const id = `worksheet-import-${Date.now()}`;
    const held = await reserve(`worksheet import`, p.estimate.usd, api, who);
    if ('error' in held) return res.status(402).json({ error: held.error });
    res.json({ job: startJob(id, emit => Ws.applyImport(sheet, view, api, { user: who, for: forWho, accept, addUnmatched }, emit).finally(held.release)), estimate: p.estimate, counts: p.counts });
  }));
  // Shared captions are written to sit under these: every persona's kept on-image headlines, in a region and the round in view.
  r.get('/approved-headlines', wrap(async (req, res) => {
    await S.refreshRules();
    const view = await Rounds.roundView(rq(req), o.who(req));
    const region = String(req.query.region || 'US').toUpperCase() as any;
    res.json({ region, headlines: await S.approvedHeadlines(region, view.ids ? [...view.ids][0] : view.active.id) });
  }));
  r.get('/bulk/:id', wrap(async (req, res) => { await S.refreshRules(); res.json(await Bulk.bulkReport(req.params.id === 'latest' ? undefined : req.params.id)); }));
  r.get('/bulk/:id/report.md', wrap(async (req, res) => { await S.refreshRules(); const rep = await Bulk.bulkReport(req.params.id === 'latest' ? undefined : req.params.id); download(res, 'text/markdown; charset=utf-8', `copy-check-${rep.id}.md`, Bulk.reportMd(rep)); }));
  r.get('/bulk/:id/report.csv', wrap(async (req, res) => { await S.refreshRules(); const rep = await Bulk.bulkReport(req.params.id === 'latest' ? undefined : req.params.id); download(res, 'text/csv; charset=utf-8', `copy-check-${rep.id}.csv`, Bulk.reportCsv(rep)); }));

  r.get('/batches/:id/export.csv', wrap(async (req, res) => download(res, 'text/csv; charset=utf-8', `${req.params.id}.csv`, (await S.exportBatch(req.params.id)).csv)));
  r.get('/batches/:id/export.md', wrap(async (req, res) => download(res, 'text/markdown; charset=utf-8', `${req.params.id}.md`, (await S.exportBatch(req.params.id)).md)));

  // ----- curation -----
  r.post('/ingest', wrap(async (req, res) => res.json(await S.ingest(typeof req.body === 'string' ? req.body : String(req.body?.csv || ''), o.who(req)))));
  r.get('/shortlist', wrap(async (req, res) => res.json(await S.shortlist(await Rounds.roundView(rq(req), o.who(req))))));
  r.get('/shortlist.csv', wrap(async (req, res) => download(res, 'text/csv; charset=utf-8', 'shortlist.csv', (await S.writeShortlist(await Rounds.roundView(rq(req), o.who(req)))).csv)));
  r.get('/shortlist.md', wrap(async (req, res) => download(res, 'text/markdown; charset=utf-8', 'shortlist.md', (await S.writeShortlist(await Rounds.roundView(rq(req), o.who(req)))).md)));
  r.post('/check', wrap(async (req, res) => {
    const { persona, territory, lines } = req.body || {};
    res.json(await S.checkTexts(persona, territory, lines || [], o.api(req)));
  }));

  // ----- Ready for production (after Shortlist) -----
  // Ready to traffic per code for the handoff pack, when Pre-flight (and so Compliance) is on.
  const trafficOf: R.TrafficOf | undefined = o.preflight ? stub => o.preflight!.service.traffic(stub) : undefined;
  const pt = (q: any) => ({ persona: q.persona ? String(q.persona) : undefined, territory: q.territory ? String(q.territory) : undefined, region: q.region ? String(q.region).toUpperCase() : undefined, round: q.round ? String(q.round) : undefined });
  r.get('/ready', wrap(async (req, res) => {
    const { persona, territory, region } = pt(req.query);
    if (!persona || !territory) throw new Error('Pass persona and territory');
    // The versions default to the last sign-off's, or a first pairing of the kept lines (versions.ts defaultDraft).
    res.json(await R.readyView(persona, territory, (region || 'US') as any, undefined, { round: rq(req), user: o.who(req) }));
  }));
  // The Ready screen's versions as the lead builds them: codes, what's missing, compliance per version.
  r.post('/ready/preview', wrap(async (req, res) => {
    const { persona, territory, region } = pt(req.body || {});
    if (!persona || !territory) throw new Error('Pass persona and territory');
    res.json(await R.readyView(persona, territory, (region || 'US') as any, { versions: req.body.versions || [], on_image: req.body.on_image || {}, ...(req.body.on_image_sub ? { on_image_sub: req.body.on_image_sub } : {}) }, { round: rq(req), user: o.who(req) }));
  }));
  // The version checks' model part (conflicts between an ad's fields): a call per version whose wording hasn't been
  // checked, priced first (plan.check_estimate) and reserved against the cap like any run.
  r.post('/ready/check', wrap(async (req, res) => {
    const { persona, territory, region } = pt(req.body || {});
    if (!persona || !territory) throw new Error('Pass persona and territory');
    const draft = { versions: req.body.versions || [], on_image: req.body.on_image || {}, ...(req.body.on_image_sub ? { on_image_sub: req.body.on_image_sub } : {}) };
    const est = (await R.readyView(persona, territory, (region || 'US') as any, draft, { round: rq(req), user: o.who(req) })).plan.check_estimate;
    const api = o.api(req);
    const held = await reserve(`version-check ${persona} ${territory}`, est.usd, api, o.who(req));
    if ('error' in held) return res.status(402).json({ error: held.error });
    try { res.json(await R.checkDraft(persona, territory, (region || 'US') as any, draft, api, { round: rq(req), user: o.who(req) })); } finally { await held.release(); }
  }));
  r.post('/ready', wrap(async (req, res) => {
    // Signing off is the creative lead's (or an admin's), like Ready to traffic; anyone on the Studio list can see it.
    if (o.canSignOff && !o.canSignOff(req)) return res.status(403).json({ error: 'Lines are signed off by the creative lead or an admin' });
    // Versions not yet checked for conflicts are checked as part of the sign-off (a few cents), so the record has them.
    const { persona, territory, region } = pt(req.body || {});
    const est = persona && territory ? (await R.readyView(persona, territory, (region || 'US') as any, { versions: req.body.versions || [], on_image: req.body.on_image || {}, ...(req.body.on_image_sub ? { on_image_sub: req.body.on_image_sub } : {}) }, { round: rq(req), user: o.who(req) })).plan.check_estimate : { usd: 0, calls: 0 };
    const api = est.calls ? o.api(req) : undefined;
    const held = api ? await reserve(`version-check ${persona} ${territory}`, est.usd, api, o.who(req)) : { release: async () => {} };
    if ('error' in held) return res.status(402).json({ error: held.error });
    try { res.json(await R.signOff({ ...(req.body || {}), round: rq(req) }, o.who(req), { api, for: forOf(req) })); }
    catch (err: any) {
      if (err instanceof R.GateError) return res.status(409).json({ error: err.message, blocking: err.blocking });
      if (err instanceof R.DraftError) return res.status(400).json({ error: err.message, issues: err.issues });
      throw err;
    } finally { await held.release(); }
  }));
  r.post('/batches/:id/lines/:line/override', wrap(async (req, res) => (o.canOverride && !o.canOverride(req)) ? res.status(403).json({ error: 'Only the people who mark assets Ready to traffic (the creative lead) or an admin can override a red flag' }) : res.json(await R.overrideFlag(req.params.id, req.params.line, String(req.body?.rule || ''), String(req.body?.reason || ''), o.who(req), forOf(req)))));
  r.patch('/batches/:id/lines/:line/compliance', wrap(async (req, res) => {
    if (o.canSetCompliance && !o.canSetCompliance(req)) return res.status(403).json({ error: 'Compliance status is updated by the producer (Vivan) or an admin' });
    res.json(await R.setCompliance(req.params.id, req.params.line, String(req.body?.status || ''), req.body?.note, o.who(req)));
  }));
  // After an edit (Review and Build re-check the new wording straight away): the checks on one line, priced and reserved like a run.
  r.post('/batches/:id/lines/:line/recheck', wrap(async (req, res) => {
    const api = o.api(req);
    const usd = await S.recheckEstimate(req.params.id, req.params.line);
    const held = await reserve(`recheck ${req.params.line}`, usd, api, o.who(req));
    if ('error' in held) return res.status(402).json({ error: held.error });
    try { res.json({ ...(await R.recheckLine(req.params.id, req.params.line, api, o.who(req))), recheck_usd: usd }); } finally { await held.release(); }
  }));
  r.get('/lines/:line/versions', wrap(async (req, res) => res.json(await S.getStore().listLineVersions(req.params.line))));
  // A test round's own exports (a demo) are named TEST_… and say so on their first line.
  const pack = async (req: Request) => R.handoffPack({ ...pt(req.query), user: o.who(req) }, trafficOf);
  const named = (p: { test: boolean }, name: string) => (p.test ? `TEST_${name}` : name);
  r.get('/handoff.csv', wrap(async (req, res) => { const p = await pack(req); download(res, 'text/csv; charset=utf-8', named(p, 'ready-for-production.csv'), p.csv); }));
  // The sheet for Add3: one row per ad (a visual), its copy as text options (Add3, 6 Oct: one ad per visual, results per ad).
  r.get('/handoff-ads.csv', wrap(async (req, res) => { const p = await R.adHandoff({ ...pt(req.query), user: o.who(req) }, trafficOf); download(res, 'text/csv; charset=utf-8', named(p, 'ad-handoff.csv'), p.csv); }));
  r.get('/handoff.md', wrap(async (req, res) => { const p = await pack(req); download(res, 'text/markdown; charset=utf-8', named(p, 'ready-for-production.md'), p.md); }));
  r.get('/compliance-sheet.csv', wrap(async (req, res) => { const p = await pack(req); download(res, 'text/csv; charset=utf-8', named(p, 'trupanion-compliance-sheet.csv'), p.complianceCsv); }));

  // ----- Pre-flight (step 6): finished assets per signed-off naming stub -----
  if (o.preflight) {
    const pf = o.preflight.service;
    // To disk, not memory: a video is streamed on to R2 and the temp copy removed after the request.
    const uploadDir = path.join(os.tmpdir(), 'studio-uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    const files = multer({ storage: multer.diskStorage({ destination: uploadDir }), limits: { fileSize: R2_FILE_CAP, files: 20 } });
    r.get('/preflight/stubs', wrap(async (req, res) => res.json(await pf.stubs({ ...pt(req.query), user: o.who(req) }))));
    // Up to 40 files: a carousel is its cards in each size (10 cards × 3 sizes at most, plus room).
    r.post('/preflight/stubs/:stub/uploads', (req, res, next) => files.array('files', 40)(req, res, (err: any) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `A file is over the ${Math.round(R2_FILE_CAP / 1048576)} MB limit` : String(err.message || err) });
      next();
    }), wrap(async (req, res) => {
      const list = ((req as any).files || []) as Express.Multer.File[];
      const also = ([] as string[]).concat((req.body?.also as any) || []).flatMap(x => String(x).split(',')).map(x => x.trim()).filter(Boolean);
      try {
        // sizes: each file's size as the page set it (1:1, 4:5, 9:16; '' to let the server read it), in file order.
        const sizes = ([] as string[]).concat((req.body?.sizes as any) || []).flatMap(x => String(x).split(',')).map(x => x.trim());
        const forStub = req.body?.for_stub ? String(req.body.for_stub) : undefined;
        res.json(await pf.upload(req.params.stub, list.map(f => ({ path: f.path, size: f.size, filename: f.originalname, contentType: f.mimetype })), o.who(req), also, sizes, { forStub }));
      } finally {
        for (const f of list) fs.rm(f.path, { force: true }, () => {});
      }
    }));
    // Admin: uploads left with no files by a refused upload (every view ignores them), and removing them.
    r.get('/preflight/orphans', wrap(async (req, res) => {
      if (o.rules && !o.rules.isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
      res.json({ orphans: await pf.orphanUploads(), storage_check: pf.storageCheck });
    }));
    r.delete('/preflight/orphans', wrap(async (req, res) => {
      if (o.rules && !o.rules.isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
      res.json(await pf.removeOrphanUploads(o.who(req)));
    }));
    r.get('/preflight/uploads/:id/estimate', wrap(async (req, res) => res.json(await pf.estimate(req.params.id))));
    r.post('/preflight/uploads/:id/audit', wrap(async (req, res) => {
      const e = await pf.estimate(req.params.id);
      if (!o.mock && e.usd > o.askOver && !req.body?.confirm) return res.status(409).json({ needs_confirm: true, estimate: e.usd });
      const held = await reserve(`preflight ${req.params.id}`, e.usd, undefined, o.who(req));
      if ('error' in held) return res.status(402).json({ error: held.error });
      const auditId = await pf.createAudit(req.params.id, o.who(req));
      const who = o.who(req);
      res.json({ audit: auditId, job: startJob(`preflight~${auditId}`, emit => pf.runAudit(auditId, emit, who).finally(held.release)), estimate: e });
    }));
    r.get('/preflight/stubs/:stub/report', wrap(async (req, res) => res.json(await pf.report(req.params.stub, o.who(req)))));
    r.get('/preflight/files/:upload/:position', wrap(async (req, res) => {
      const f = await pf.fileStream(req.params.upload, Number(req.params.position));
      res.setHeader('Content-Type', f.contentType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Content-Disposition', `inline; filename="${f.filename.replace(/[^\w.~-]/g, '_')}"`);
      if (f.data) return res.send(f.data);
      res.setHeader('Content-Length', String(f.size));
      await pipeline(f.stream!, res);
    }));
    r.post('/preflight/flags/:id/agree', wrap(async (req, res) => res.json(await pf.agree(req.params.id, !!req.body?.agree, req.body?.note, o.who(req)))));
    r.post('/preflight/flags/:id/override', wrap(async (req, res) => {
      if (!o.preflight!.canSetReady(req)) return res.status(403).json({ error: 'Only the people who mark Pre-flight passed (the creative lead) can override a red flag' });
      res.json(await pf.override(req.params.id, String(req.body?.reason || ''), o.who(req), forOf(req)));
    }));
    r.post('/preflight/stubs/:stub/ready', wrap(async (req, res) => {
      if (!o.preflight!.canSetReady(req)) return res.status(403).json({ error: 'Pre-flight is marked passed by the creative lead or an admin (Ready to traffic also needs Trupanion’s compliance cleared)' });
      // all_on_visual: every code on this code's visual (the default on a shared visual), each passing on its own flags.
      if (req.body?.all_on_visual && req.body?.ready !== false) return res.json(await pf.setReadyVisual(req.params.stub, o.who(req), forOf(req)));
      try { res.json(await pf.setReady(req.params.stub, req.body?.ready !== false, o.who(req), forOf(req))); }
      catch (err: any) { if (err.blocking) return res.status(409).json({ error: err.message, blocking: err.blocking }); throw err; }
    }));
    r.get('/preflight/agreement', wrap(async (req, res) => res.json(await pf.agreement({ ...pt(req.query), user: o.who(req) } as any))));
    r.get('/preflight/features.csv', wrap(async (_req, res) => download(res, 'text/csv; charset=utf-8', 'preflight-features.csv', await pf.featuresCsv())));
    r.get('/preflight/handoff.csv', wrap(async (req, res) => {
      const test = Rounds.testOnly(await Rounds.roundView(rq(req), o.who(req)));
      download(res, 'text/csv; charset=utf-8', test ? 'TEST_asset-handoff.csv' : 'asset-handoff.csv', await pf.handoffCsv(rq(req), o.who(req)));
    }));

    // ----- Compliance (step 7): each asset with its codes' copy and flags; Trupanion's reviewer sets the status -----
    r.get('/compliance', wrap(async (req, res) => res.json(await pf.complianceAssets({ ...pt(req.query), user: o.who(req) }))));
    r.post('/compliance/assets/:upload', wrap(async (req, res) => {
      if (o.canSetCompliance && !o.canSetCompliance(req)) return res.status(403).json({ error: 'Trupanion’s compliance decisions are recorded by the producer (Vivan) or an admin' });
      try { res.json(await pf.setAssetCompliance(req.params.upload, { ...(req.body || {}), for: forOf(req) }, o.who(req))); }
      catch (err: any) { if (err.overridden) return res.status(409).json({ error: err.message, overridden: err.overridden }); throw err; }
    }));
  }

  // ----- territories -----
  r.post('/territories', wrap(async (req, res) => res.json(await S.saveTerritory(null, req.body?.territory || {}, String(req.body?.note || ''), o.who(req)))));
  r.put('/territories/:code', wrap(async (req, res) => res.json(await S.saveTerritory(req.params.code, req.body?.territory || {}, String(req.body?.note || ''), o.who(req)))));

  // ----- blind compare -----
  r.get('/compare', wrap(async (_req, res) => res.json(await S.listCompares())));
  r.post('/compare', wrap(async (req, res) => {
    const b = S.makeBrief(req.body.brief || {});
    const models: string[] = req.body.models || [];
    const n = Number(req.body.n || 8);
    const api = o.api(req);
    res.json({ job: startJob(`compare~${Date.now()}`, emit => S.compare(b, models, n, api, emit)) });
  }));
  r.get('/compare/:name', wrap(async (req, res) => res.json(S.viewCompare(await S.loadCompare(req.params.name), o.who(req)))));
  r.patch('/compare/:name/lines/:id', wrap(async (req, res) => res.json(await S.markCompareLine(req.params.name, req.params.id, req.body || {}, o.who(req)))));
  r.post('/compare/:name/reveal', wrap(async (req, res) => res.json(await S.revealCompare(req.params.name, o.who(req)))));

  // ----- the client logo (local only; hosted shows the text wordmark) -----
  r.get('/brand/:name', async (req, res) => {
    try {
      const a = await S.brandAsset(req.params.name);
      res.setHeader('Content-Type', a.contentType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(a.data);
    } catch { res.sendStatus(404); }
  });

  // ----- the live rules, read-only, for everyone (the Rules view) -----
  r.get('/rules/active', wrap(async (_req, res) => {
    const full: any = await S.getStore().getRules();   // unfiltered: the visual-only brand items are shown, marked as such
    const item = (x: any) => ({ id: x.id, rule: x.rule, severity: x.severity || 'warn', source: x.source, applies_to: x.applies_to || 'text', status: x.status, what_to_do: x.what_to_do });
    res.json({
      version: full.version, updated: full.updated,
      compliance: (full.compliance || []).map(item), brand: (full.brand || []).map(item), clarity: (full.clarity || []).map(item),
      personas: Object.fromEntries(Object.entries(full.personas || {}).map(([k, p]: [string, any]) => [k, {
        name: p.name, triggers: (p.triggers || []).map((t: any) => ({ label: t.label, detail: t.detail, source: t.source })),
        turn_offs: (p.turn_offs || []).map(item), language: (p.language || []).map((l: any) => ({ text: l.text, caution: !!l.caution, source: l.source })),
      }])),
      sources: Object.fromEntries(Object.entries(full.sources || {}).map(([k, v]: [string, any]) => [k, v?.title || k])),
      // Checked on the last screen in Pre-flight; off until the approved text is in the rules.
      disclaimer: full.disclaimer ? { ...item(full.disclaimer), text: full.disclaimer.text || null, active: !!String(full.disclaimer.text || '').trim() } : null,
    });
  }));

  // ----- rules versions (hosted) -----
  if (o.rules) {
    const { store, isAdmin } = o.rules;
    const admin = (fn: (req: Request, res: Response) => any) => wrap(async (req, res) => {
      if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only. Rules changes are made by an admin listed in ADMIN_EMAILS.' });
      await fn(req, res);
    });
    r.get('/rules', wrap(async (_req, res) => res.json(await store.listRules())));
    r.post('/rules', admin(async (req, res) => {
      const body = req.body?.rules;
      const version = String(req.body?.version || body?.version || '').trim();
      if (!version || !body || typeof body !== 'object') throw new Error('Send { version, rules } with the studio-rules.json body');
      const missing = RULES_REQUIRED.filter(k => !(k in body));
      if (missing.length) throw new Error(`Rules body is missing ${missing.join(', ')} (see scripts/studio/rules.schema.json)`);
      const gaps = o.rules!.selfContained ? S.hostedRulesGaps(body) : [];
      if (gaps.length) return res.status(400).json({ error: `${version} is missing ${gaps.join(', ')}. The hosted Studio reads the M3 rubric and each persona's seed and voice from the rules file (v2.6 or later).`, gaps });
      // Versions are never overwritten: past runs name the version they were checked against.
      if ((await store.listRules()).some((x: any) => x.version === version)) throw new Error(`Rules version ${version} already exists; upload it under a new version`);
      await store.putRules(version, { ...body, version }, { activate: !!req.body?.activate, by: o.who(req), notes: req.body?.notes ? String(req.body.notes) : undefined });
      if (req.body?.activate) await S.refreshRules();  // a draft changes nothing live (and there may be no active rules yet)
      res.json(await store.listRules());
    }));
    r.post('/rules/:version/activate', admin(async (req, res) => {
      await store.activateRules(req.params.version, o.who(req));
      await S.refreshRules();
      res.json(await store.listRules());
    }));
  }

  return r;
}
