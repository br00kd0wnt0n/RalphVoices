// The Studio's HTTP API, shared by the local server (`studio.ts serve`) and
// the hosted app (routes/studio.ts). Callers supply who the user is, how jobs
// get an Api, the spend limits and, when hosted, admin checks for rules. This
// file imports nothing from src/db, so the CLI can use it without touching a
// database connection.

import express, { type Request, type Response, type Router } from 'express';
import path from 'node:path';
import * as S from './engine.js';
import type { PgStore } from './pgStore.js';
import * as R from './ready.js';

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
  rules?: { store: PgStore; isAdmin(req: Request): boolean };
  /** Extra fields for /meta (e.g. the signed-in user). */
  metaExtra?(req: Request): Record<string, unknown>;
}

// Top-level keys every rules version needs (scripts/studio/rules.schema.json `required`).
const RULES_REQUIRED = ['sources', 'fields', 'structures', 'facts', 'figure_rule', 'compliance', 'brand', 'clarity', 'features', 'personas', 'territories', 'needs_review'];

interface Job { events: S.StudioEvent[]; clients: Set<Response>; done: boolean; finished?: number }

export function monthStart(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export function createStudioRouter(o: StudioRouterOptions): Router {
  const r = express.Router();
  const jobs = new Map<string, Job>();

  r.use(express.json({ limit: '2mb' }));
  r.use(express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }));

  const wrap = (fn: (req: Request, res: Response) => any) => async (req: Request, res: Response) => {
    try { await fn(req, res); } catch (err: any) { if (!res.headersSent) res.status(400).json({ error: String(err?.message || err) }); }
  };
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
  r.use(async (_req, _res, next) => { try { await S.refreshRules(); next(); } catch (err) { next(err); } });

  r.get('/meta', wrap(async (req, res) => {
    const { studio_dir, ...m } = await S.meta();
    res.json({ ...m, ...(o.rules ? {} : { studio_dir }), spend: await spent(), mock: o.mock, cap: o.cap, cap_window: o.capWindow, ask_over: o.askOver, ...(o.metaExtra?.(req) || {}) });
  }));
  r.post('/estimate', wrap(async (req, res) => {
    const b = S.makeBrief(req.body.brief || {});
    res.json({ brief: b, ...S.estimate(b, { ownOnly: !!req.body.own_only }), spent: await spent() });
  }));

  // ----- runs -----
  r.get('/batches', wrap(async (req, res) => res.json(await S.listBatches(req.query.user ? String(req.query.user) : undefined))));
  r.get('/batches/:id', wrap(async (req, res) => res.json(await S.loadBatch(req.params.id))));
  r.post('/generate', wrap(async (req, res) => {
    const b = S.makeBrief(req.body.brief || {});
    const ownOnly = !!req.body.own_only;
    const e = S.estimate(b, { ownOnly });
    const so = await spent();
    if (!o.mock && e.usd > o.askOver && !req.body.confirm) return res.status(409).json({ needs_confirm: true, estimate: e.usd });
    if (!o.mock && so + e.usd > o.cap) return res.status(402).json({ error: `This would take spend past ${capText()} ($${so.toFixed(2)} spent).` });
    await S.saveBrief(b);
    // Continue an existing run, or start a new one.
    const id = req.body.batch ? String(req.body.batch) : await S.newBatchId(b.territory);
    const api = o.api(req);
    const job = startJob(`${id}~${Date.now()}`, emit => S.generate(b, api, emit, { batchId: id, ownOnly, user: o.who(req) }));
    res.json({ batch: id, job, estimate: e.usd });
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
  r.patch('/batches/:id/lines/:line', wrap(async (req, res) => res.json(await S.setDecision(req.params.id, req.params.line, req.body || {}, o.who(req)))));
  r.get('/lines/:line/history', wrap(async (req, res) => res.json(await S.lineHistory(req.params.line))));
  r.post('/batches/:id/lines/:line/more', wrap(async (req, res) => {
    const api = o.api(req);
    res.json({ job: startJob(`${req.params.id}~more~${Date.now()}`, emit => S.moreLikeThis(req.params.id, req.params.line, String(req.body?.note || ''), Number(req.body?.k || 3), api, emit)) });
  }));
  r.get('/batches/:id/export.csv', wrap(async (req, res) => download(res, 'text/csv; charset=utf-8', `${req.params.id}.csv`, (await S.exportBatch(req.params.id)).csv)));
  r.get('/batches/:id/export.md', wrap(async (req, res) => download(res, 'text/markdown; charset=utf-8', `${req.params.id}.md`, (await S.exportBatch(req.params.id)).md)));

  // ----- curation -----
  r.post('/ingest', wrap(async (req, res) => res.json(await S.ingest(typeof req.body === 'string' ? req.body : String(req.body?.csv || ''), o.who(req)))));
  r.get('/shortlist', wrap(async (_req, res) => res.json(await S.shortlist())));
  r.get('/shortlist.csv', wrap(async (_req, res) => download(res, 'text/csv; charset=utf-8', 'shortlist.csv', (await S.writeShortlist()).csv)));
  r.get('/shortlist.md', wrap(async (_req, res) => download(res, 'text/markdown; charset=utf-8', 'shortlist.md', (await S.writeShortlist()).md)));
  r.post('/check', wrap(async (req, res) => {
    const { persona, territory, lines } = req.body || {};
    res.json(await S.checkTexts(persona, territory, lines || [], o.api(req)));
  }));

  // ----- Ready for production (after Shortlist) -----
  const pt = (q: any) => ({ persona: q.persona ? String(q.persona) : undefined, territory: q.territory ? String(q.territory) : undefined });
  r.get('/ready', wrap(async (req, res) => {
    const { persona, territory } = pt(req.query);
    if (!persona || !territory) throw new Error('Pass persona and territory');
    res.json(await R.readyView(persona, territory));
  }));
  r.post('/ready', wrap(async (req, res) => {
    try { res.json(await R.signOff(req.body || {}, o.who(req))); }
    catch (err: any) {
      if (err instanceof R.GateError) return res.status(409).json({ error: err.message, blocking: err.blocking });
      throw err;
    }
  }));
  r.post('/batches/:id/lines/:line/override', wrap(async (req, res) => res.json(await R.overrideFlag(req.params.id, req.params.line, String(req.body?.rule || ''), String(req.body?.reason || ''), o.who(req)))));
  r.patch('/batches/:id/lines/:line/compliance', wrap(async (req, res) => res.json(await R.setCompliance(req.params.id, req.params.line, String(req.body?.status || ''), req.body?.note, o.who(req)))));
  r.post('/batches/:id/lines/:line/recheck', wrap(async (req, res) => {
    if (!o.mock && (await spent()) + 0.02 > o.cap) return res.status(402).json({ error: `Spend is at ${capText()}.` });
    res.json(await R.recheckLine(req.params.id, req.params.line, o.api(req), o.who(req)));
  }));
  r.get('/lines/:line/versions', wrap(async (req, res) => res.json(await S.getStore().listLineVersions(req.params.line))));
  r.get('/handoff.csv', wrap(async (req, res) => download(res, 'text/csv; charset=utf-8', 'ready-for-production.csv', (await R.handoffPack(pt(req.query))).csv)));
  r.get('/handoff.md', wrap(async (req, res) => download(res, 'text/markdown; charset=utf-8', 'ready-for-production.md', (await R.handoffPack(pt(req.query))).md)));
  r.get('/compliance-sheet.csv', wrap(async (req, res) => download(res, 'text/csv; charset=utf-8', 'trupanion-compliance-sheet.csv', (await R.handoffPack(pt(req.query))).complianceCsv)));

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

  // ----- reference documents and the client logo -----
  r.get('/docs', wrap(async (_req, res) => res.json(await S.referenceDocs())));
  r.get('/docs/:id', wrap(async (req, res) => {
    const { doc, asset } = await S.referenceDoc(req.params.id);
    if (doc.kind === 'file') return download(res, asset.contentType, asset.filename || path.basename(doc.path), asset.data);
    res.setHeader('Content-Type', asset.contentType);
    res.send(asset.data);
  }));
  r.get('/brand/:name', async (req, res) => {
    try {
      const a = await S.brandAsset(req.params.name);
      res.setHeader('Content-Type', a.contentType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(a.data);
    } catch { res.sendStatus(404); }
  });

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
      // Versions are never overwritten: past runs name the version they were checked against.
      if ((await store.listRules()).some((x: any) => x.version === version)) throw new Error(`Rules version ${version} already exists; upload it under a new version`);
      await store.putRules(version, { ...body, version }, { activate: !!req.body?.activate, by: o.who(req), notes: req.body?.notes ? String(req.body.notes) : undefined });
      await S.refreshRules();
      res.json(await store.listRules());
    }));
    r.post('/rules/:version/activate', admin(async (req, res) => {
      await store.activateRules(req.params.version);
      await S.refreshRules();
      res.json(await store.listRules());
    }));
  }

  return r;
}
