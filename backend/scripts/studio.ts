// B1-lite Copy Studio: CLI and local UI server (VOICES v2, Trupanion, 25 Sep 2026).
//
// A script, not part of the app: no database, no auth, no deploy. It reads the
// rules file and writes briefs, batches, exports, the taste store and the
// shortlist under the studio folder, which is client material outside the repo:
//   /Users/BD/ralph-voices/Claude outputs/voices-r1/studio/
// Only OPENAI_API_KEY is read from backend/.env (its DATABASE_URL is production).
//
// Usage (from backend/):
//   npx tsx scripts/studio.ts brief    --territory DINK_NEVER [--persona DINK] [--fields meta_primary,meta_headline,tiktok_hook]
//                                      [--tone dw=2,pp=3,sl=2] [--ban word]... [--ban-idea "..."]... [--ref "..."]... [--n 20] [--model gpt-4o] [--name NAME]
//   npx tsx scripts/studio.ts estimate --brief NAME
//   npx tsx scripts/studio.ts generate --brief NAME [--yes] [--no-check]
//   npx tsx scripts/studio.ts check    --batch ID                      (re-run every check on a batch)
//   npx tsx scripts/studio.ts check    --territory DINK_NEVER --text "..." [--field meta_primary]...
//   npx tsx scripts/studio.ts planted  --territory DINK_NEVER         (acceptance: planted non-compliant lines must be flagged)
//   npx tsx scripts/studio.ts export   --batch ID                      (CSV for Sheets + Markdown view)
//   npx tsx scripts/studio.ts ingest   --csv PATH                      (curated sheet back in: taste examples + shortlist)
//   npx tsx scripts/studio.ts shortlist
//   npx tsx scripts/studio.ts compare  --brief NAME --models gpt-4o,gpt-4.1,gpt-5.5,claude-opus-5 [--n 10] [--yes]   (2-4 writers; claude-* needs ~/.config/voices/anthropic.key)
//   npx tsx scripts/studio.ts reveal   --compare NAME
//   npx tsx scripts/studio.ts status
//   npx tsx scripts/studio.ts limits   [--models gpt-4o,gpt-4.1]       (models on the account and their TPM limits; 1-token calls)
//   npx tsx scripts/studio.ts serve    [--port 4100]                   (local API for the /studio page; 127.0.0.1 only)
// Common flags:
//   --mock                   no network, no cost (in-process stand-in for OpenAI)
//   --tpm gpt-4o=15000,...   per-model tokens-per-minute cap. Default: 90% of the limit the account reports (gpt-4o 30k at tier 1 → 27k); set it lower when sharing the account
//   --cap 15                 session spend cap in USD (studio/spend.json is cumulative)
//   --studio DIR             output folder (default: the client folder above)
//   --yes                    needed for any run estimated over $2

import fs from 'node:fs';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (n: string) => argv.includes(`--${n}`);
function opt(n: string, d = ''): string { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; }
function opts(n: string): string[] { const out: string[] = []; argv.forEach((a, i) => { if (a === `--${n}` && argv[i + 1] !== undefined) out.push(argv[i + 1]); }); return out; }
const list = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);

if (opt('studio')) S.setStudioDir(path.resolve(opt('studio')));
if (opt('rules')) S.setRulesPath(path.resolve(opt('rules')));
const MOCK = flag('mock');
const CAP = Number(opt('cap', '15'));
const ASK_OVER = 2;
function tpm(): Record<string, number> {
  // Default: 90% of each model's own limit, read from response headers. Pass
  // --tpm gpt-4o=15000 when another job shares the account (e.g. the SM spike).
  const t: Record<string, number> = {};
  for (const kv of list(opt('tpm'))) { const [k, v] = kv.split('='); if (k && Number(v)) t[k] = Number(v); }
  return t;
}
const api = () => new S.Api({ mock: MOCK, tpm: tpm(), cap: CAP });
const secs = (ms?: number) => `${((ms || 0) / 1000).toFixed(1)}s`;

function parseTone(s: string): Partial<S.Tone> {
  const t: any = {};
  for (const kv of list(s)) {
    const [k, v] = kv.split('=');
    const key = ({ dw: 'dry_warm', pp: 'playful_plain', sl: 'short_long' } as any)[k] || k;
    t[key] = Number(v);
  }
  return t;
}

async function printEstimate(b: S.Brief) {
  const e = S.estimate(b);
  const spent = (await S.readSpend()).total_usd;
  console.log(`Estimate for ${b.name}: ~${e.calls} calls, ~$${e.usd.toFixed(2)} (spent so far $${spent.toFixed(2)} of the $${CAP} cap).`);
  console.log(`  TPM load: ${Object.entries(e.tokens).map(([m, t]) => `${m} ~${Math.round(t / 1000)}k tokens (~${e.minutes_at_budget[m]} min at its limit)`).join('; ')}`);
  return { ...e, spent };
}

function onEvent(e: S.StudioEvent) {
  if (e.type === 'status') console.log(`· ${e.message}`);
  if (e.type === 'error') console.error(`! ${e.message}`);
  if (e.type === 'line' && e.line.status === 'checked') {
    const c = e.line.flags.filter(f => f.severity === 'compliance').length, w = e.line.flags.filter(f => f.severity === 'warn').length;
    console.log(`  ✓ ${e.line.id.split('-').pop()} [${e.line.angle} ${e.line.structure} ${e.line.field}] ${c ? `${c} compliance ` : ''}${w ? `${w} warn ` : ''}${e.line.text.slice(0, 70)}`);
  }
}

function report(b: S.Batch) {
  const angles = new Set(b.lines.map(l => l.angle)).size;
  const structures = new Set(b.lines.map(l => l.structure)).size;
  const flags = b.lines.flatMap(l => l.flags);
  const unsourced = flags.filter(f => !f.source).length;
  const dupRate = b.stats.generated ? b.stats.near_duplicates_removed / b.stats.generated : 0;
  console.log(`\nBatch ${b.id}: ${b.lines.length} lines, ${angles} angles, ${structures} structures.`);
  console.log(`  near-duplicates: ${b.stats.near_duplicates_removed} of ${b.stats.generated} written (${(dupRate * 100).toFixed(0)}%) removed; ${b.stats.similar_flagged} kept lines flagged as similar`);
  console.log(`  flags: ${flags.length} (${flags.filter(f => f.severity === 'compliance').length} compliance, ${flags.filter(f => f.severity === 'warn').length} warn, ${flags.filter(f => f.severity === 'note').length} note); without a source: ${unsourced}`);
  console.log(`  time: generate ${secs(b.stats.timings_ms.generate)}, checks ${secs(b.stats.timings_ms.check)}, total ${secs(b.stats.timings_ms.total)}`);
  console.log(`  cost: $${b.stats.usd_total.toFixed(3)} (${Object.entries(b.stats.usd).map(([k, v]) => `${k} $${v.toFixed(3)}`).join(', ')})`);
  console.log(`  calls: ${Object.entries(b.stats.calls).map(([k, v]) => `${k} ${v}`).join(', ')}; TPM budgets used: ${JSON.stringify(b.stats.model_budgets_tpm)}`);
  console.log(`  saved: run ${b.id} (${S.getStore().kind} store)`);
}

// Acceptance: planted lines that must (or must not) be flagged.
const PLANTED: Array<{ text: string; field: string; expect: string; severity?: S.Severity; absent?: boolean }> = [
  { text: 'Honestly? The policy pays for itself after one bad week at the vet.', field: 'meta_primary', expect: 'COMP_PAYS_FOR_ITSELF' },
  { text: 'Trupanion pays your vet directly at checkout, in seconds.', field: 'meta_primary', expect: 'COMP_DIRECT_PAY' },
  { text: 'With Trupanion, your vet can be paid directly at checkout at participating hospitals.', field: 'meta_primary', expect: 'COMP_DIRECT_PAY', absent: true },
  { text: 'We pay the whole bill.', field: 'meta_headline', expect: 'COMP_PAID_SHARE' },
  { text: 'Even pre-existing conditions are covered from day one.', field: 'meta_primary', expect: 'COMP_PREEXISTING' },
  { text: 'Checkups covered. Vaccines covered. Relax.', field: 'meta_primary', expect: 'COMP_ROUTINE' },
  { text: 'Every claim paid in seconds.', field: 'meta_headline', expect: 'COMP_CLAIM_SPEED' },
  { text: 'Cheap pet insurance can cost you more when it matters most.', field: 'meta_primary', expect: 'COMP_CHEAP_LOCKED', severity: 'warn' },
];

async function main() {
  if (command && !['limits', 'help'].includes(command)) await S.refreshRules();
  switch (command) {
    case 'brief': {
      const b = S.makeBrief({
        name: opt('name') || undefined, persona: opt('persona') || undefined, territory: opt('territory'),
        fields: list(opt('fields')), tone: parseTone(opt('tone')) as S.Tone,
        banned_words: opts('ban'), banned_ideas: opts('ban-idea'), reference_lines: opts('ref'),
        n: Number(opt('n', '20')), model: opt('model') || undefined,
        checker_model: opt('checker-model') || undefined, probe_model: opt('probe-model') || undefined, objection_model: opt('objection-model') || undefined,
      });
      const p = await S.saveBrief(b);
      console.log(`Brief ${b.name} written to ${p}`);
      console.log(JSON.stringify(b, null, 2));
      await printEstimate(b);
      return;
    }
    case 'estimate': { await printEstimate(await S.loadBrief(opt('brief'))); return; }
    case 'generate': {
      const b = await S.loadBrief(opt('brief'));
      const e = await printEstimate(b);
      if (!MOCK && e.usd > ASK_OVER && !flag('yes')) { console.log(`Not running: estimate is over $${ASK_OVER}. Re-run with --yes once Brook has OKed it.`); return; }
      if (!MOCK && e.spent + e.usd > CAP) { console.log(`Refusing: this would take spend past the $${CAP} cap.`); return; }
      const batch = await S.generate(b, api(), onEvent, { check: !flag('no-check') });
      report(batch);
      const x = await S.exportBatch(batch.id);
      console.log(`  export: ${x.csvPath}\n          ${x.mdPath}`);
      return;
    }
    case 'check': {
      if (opt('batch')) {
        const batch = await S.loadBatch(opt('batch'));
        const a = api();
        const started = Date.now();
        await S.checkBatch(batch, a, onEvent);
        batch.stats.timings_ms.recheck = Date.now() - started;
        await S.saveBatch(batch);
        a.commit(`recheck ${batch.id}`);
        report(batch);
        return;
      }
      const territory = opt('territory');
      const persona = opt('persona') || S.loadRules().territories[territory]?.persona;
      const fields = opts('field');
      const items = opts('text').map((text, i) => ({ text, field: fields[i] || fields[0] || 'meta_primary' }));
      const lines = await S.checkTexts(persona, territory, items, api());
      for (const l of lines) printLine(l);
      return;
    }
    case 'planted': {
      const territory = opt('territory', 'DINK_NEVER');
      const persona = S.loadRules().territories[territory].persona;
      const started = Date.now();
      const lines = await S.checkTexts(persona, territory, PLANTED.map(p => ({ text: p.text, field: p.field })), api());
      let pass = 0;
      lines.forEach((l, i) => {
        const p = PLANTED[i];
        const f = l.flags.find(x => x.rule === p.expect);
        const worst = l.flags.some(x => x.severity === 'compliance') ? 'compliance' : l.flags.some(x => x.severity === 'warn') ? 'warn' : 'none';
        const ok = p.absent ? !f : p.severity === 'warn' ? !!f && f.severity === 'warn' && worst !== 'compliance' : !!f && f.severity === 'compliance';
        if (ok) pass++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${p.absent ? `no ${p.expect}` : `${p.expect}${p.severity ? ` (${p.severity} only)` : ''}`}: "${p.text}"`);
        printLine(l, '      ');
      });
      console.log(`\n${pass}/${PLANTED.length} planted checks pass (${secs(Date.now() - started)}).`);
      return;
    }
    case 'export': {
      const x = await S.exportBatch(opt('batch'));
      console.log(`CSV: ${x.csvPath}\nMarkdown: ${x.mdPath}`);
      return;
    }
    case 'ingest': {
      const r = await S.ingest(fs.readFileSync(opt('csv'), 'utf8'));
      console.log(`Ingested ${r.rows} rows: ${r.matched} matched (${r.kept} keep, ${r.edited} edit, ${r.cut} cut)${r.unknown.length ? `; unknown ids: ${r.unknown.join(', ')}` : ''}.`);
      console.log(`Taste examples now: ${r.taste_total}. Shortlist: ${r.shortlist} lines → ${r.shortlistPath}`);
      return;
    }
    case 'shortlist': { const s = await S.writeShortlist(); console.log(`${s.count} lines → ${s.path}\n${s.md}`); return; }
    case 'compare': {
      const b = await S.loadBrief(opt('brief'));
      const models = list(opt('models', 'gpt-4o,gpt-4.1'));
      const n = Number(opt('n', '10'));
      const est = S.estimate({ ...b, n }).usd * 0.35 * models.length; // generation share of a batch, per model
      console.log(`Compare ${models.length} writers × ${n} lines: ~$${est.toFixed(2)}.`);
      if (!MOCK && est > ASK_OVER && !flag('yes')) { console.log(`Not running: over $${ASK_OVER}; re-run with --yes.`); return; }
      const set = await S.compare(b, models, n, api(), onEvent);
      console.log(`Blind sheet: ${path.join(S.studioDir(), 'compare', set.name, 'sheet.csv')} (${set.lines.length} lines, writers ${[...new Set(set.lines.map(l => l.label))].sort().join('/')}); key kept separately in key.json. $${set.usd?.toFixed(3)}, ${secs(set.timings_ms)}.`);
      return;
    }
    case 'reveal': { console.log(JSON.stringify(await S.revealCompare(opt('compare')), null, 2)); return; }
    case 'status': {
      const s = await S.readSpend();
      console.log(`Studio folder: ${S.studioDir()}\nSpend: $${s.total_usd.toFixed(3)} of $${CAP} over ${s.runs.length} runs.`);
      for (const b of await S.listBatches()) console.log(`  ${b.id}  ${b.lines} lines  $${b.usd.toFixed(3)}`);
      return;
    }
    case 'limits': {
      // Models on the account, and each candidate's tokens-per-minute limit from a 1-token call (~$0.0001 each).
      S.loadKey(MOCK);
      const OpenAI = (await import('openai')).default;
      const c = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const ids = (await c.models.list()).data.map(m => m.id).filter(id => /^(gpt-|o\d)/.test(id)).sort();
      console.log(`Chat models on the account (${ids.length}): ${ids.filter(i => !/audio|realtime|transcribe|tts|search|image/.test(i)).join(' ')}`);
      for (const model of list(opt('models', 'gpt-4o,gpt-4o-mini,gpt-4.1,gpt-4.1-mini,gpt-5,gpt-5-mini,gpt-5.1'))) {
        if (!ids.includes(model)) { console.log(`  ${model}: not on this account`); continue; }
        try {
          const reasoning = /^(gpt-5|o\d)/.test(model);
          const { response } = await c.chat.completions.create({ model, messages: [{ role: 'user', content: 'Say ok' }], ...(reasoning ? { max_completion_tokens: 32, reasoning_effort: 'minimal' as any } : { max_tokens: 1 }) }).withResponse();
          console.log(`  ${model}: ${response.headers.get('x-ratelimit-limit-tokens')} TPM, ${response.headers.get('x-ratelimit-limit-requests')} RPM`);
        } catch (e: any) { console.log(`  ${model}: ${e?.status} ${e?.code || ''} ${String(e?.message).slice(0, 100)}`); }
      }
      return;
    }
    case 'serve': { await serve(); return; }
    default:
      console.log('Commands: brief, estimate, generate, check, planted, export, ingest, shortlist, compare, reveal, status, limits, serve. See the header of scripts/studio.ts.');
  }
}

function printLine(l: S.Line, pad = '  ') {
  console.log(`${pad}${l.id.split('-').pop()} [${l.field}, ${l.chars} chars] ${l.text}`);
  for (const f of l.flags) console.log(`${pad}  - ${S.flagText(f)}`);
  if (l.objection) console.log(`${pad}  skeptic: ${l.objection}`);
}

// ---------- local server for the /studio page ----------

async function serve() {
  const express = (await import('express')).default;
  const app = express();
  const port = Number(opt('port', '4100'));
  const a = api();
  const jobs = new Map<string, { events: S.StudioEvent[]; clients: Set<any>; done: boolean }>();

  app.use((req: any, res: any, next: any) => {
    const origin = req.headers.origin || '';
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Studio-User');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }));

  // Local only: the page sends the name it asked for. The hosted build uses the signed-in user.
  const who = (req: any) => String(req.headers['x-studio-user'] || '').trim().slice(0, 60) || undefined;
  const wrap = (fn: (req: any, res: any) => any) => async (req: any, res: any) => {
    try { await fn(req, res); } catch (err: any) { res.status(400).json({ error: String(err?.message || err) }); }
  };
  function startJob(id: string, run: (emit: (e: S.StudioEvent) => void) => Promise<unknown>) {
    const job = { events: [] as S.StudioEvent[], clients: new Set<any>(), done: false };
    jobs.set(id, job);
    const emit = (e: S.StudioEvent) => {
      // Lines are re-sent as they change; keep only the latest copy for late subscribers.
      if (e.type === 'line') { const i = job.events.findIndex(x => x.type === 'line' && x.line.id === e.line.id); if (i >= 0) job.events.splice(i, 1); }
      job.events.push(e);
      for (const c of job.clients) c.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    run(emit).catch(err => emit({ type: 'error', message: String(err?.message || err) })).finally(() => {
      job.done = true;
      for (const c of job.clients) c.end();
    });
  }

  const base = '/api/studio';
  // Reload rules and territories on each request, so edits (and, when hosted, other servers' edits) are always current.
  app.use(base, async (_req: any, _res: any, next: any) => { try { await S.refreshRules(); next(); } catch (err) { next(err); } });
  app.get(`${base}/meta`, wrap(async (_req, res) => res.json({ ...(await S.meta()), mock: MOCK, cap: CAP, ask_over: ASK_OVER })));
  app.post(`${base}/estimate`, wrap(async (req, res) => { const b = S.makeBrief(req.body.brief || {}); res.json({ brief: b, ...S.estimate(b, { ownOnly: !!req.body.own_only }), spent: (await S.readSpend()).total_usd }); }));
  app.get(`${base}/batches`, wrap(async (req, res) => res.json(await S.listBatches(req.query.user ? String(req.query.user) : undefined))));
  app.get(`${base}/batches/:id`, wrap(async (req, res) => res.json(await S.loadBatch(req.params.id))));
  app.post(`${base}/generate`, wrap(async (req, res) => {
    const b = S.makeBrief(req.body.brief || {});
    const ownOnly = !!req.body.own_only;
    const e = S.estimate(b, { ownOnly });
    const spent = (await S.readSpend()).total_usd;
    if (!MOCK && e.usd > ASK_OVER && !req.body.confirm) return res.status(409).json({ needs_confirm: true, estimate: e.usd });
    if (!MOCK && spent + e.usd > CAP) return res.status(402).json({ error: `This would take spend past the $${CAP} cap ($${spent.toFixed(2)} spent).` });
    await S.saveBrief(b);
    // Continue an existing run, or start a new one.
    const id = req.body.batch ? String(req.body.batch) : `${b.territory}-${new Date().toISOString().replace(/[-:T]/g, '').slice(2, 14)}`;
    startJob(`${id}~${Date.now()}`, emit => S.generate(b, a, emit, { batchId: id, ownOnly, user: who(req) }));
    res.json({ batch: id, job: [...jobs.keys()].pop(), estimate: e.usd });
  }));
  app.get(`${base}/jobs/:id/events`, (req: any, res: any) => {
    const job = jobs.get(req.params.id);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    if (!job) { res.write(`data: ${JSON.stringify({ type: 'error', message: 'No such job' })}\n\n`); return res.end(); }
    for (const e of job.events) res.write(`data: ${JSON.stringify(e)}\n\n`);
    if (job.done) return res.end();
    job.clients.add(res);
    req.on('close', () => job.clients.delete(res));
  });
  app.patch(`${base}/batches/:id/lines/:line`, wrap(async (req, res) => res.json(await S.setDecision(req.params.id, req.params.line, req.body || {}, who(req)))));
  app.post(`${base}/batches/:id/lines/:line/more`, wrap(async (req, res) => {
    const jobId = `${req.params.id}~more~${Date.now()}`;
    startJob(jobId, emit => S.moreLikeThis(req.params.id, req.params.line, String(req.body?.note || ''), Number(req.body?.k || 3), a, emit));
    res.json({ job: jobId });
  }));
  app.get(`${base}/batches/:id/export.csv`, wrap(async (req, res) => {
    const x = await S.exportBatch(req.params.id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.csv"`);
    res.send(x.csv);
  }));
  app.get(`${base}/batches/:id/export.md`, wrap(async (req, res) => {
    const x = await S.exportBatch(req.params.id);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.md"`);
    res.send(x.md);
  }));
  app.post(`${base}/ingest`, wrap(async (req, res) => res.json(await S.ingest(typeof req.body === 'string' ? req.body : String(req.body?.csv || '')))));
  app.get(`${base}/shortlist`, wrap(async (_req, res) => res.json(await S.shortlist())));
  app.get(`${base}/shortlist.csv`, wrap(async (_req, res) => {
    const s = await S.writeShortlist();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="shortlist.csv"');
    res.send(s.csv);
  }));
  app.get(`${base}/shortlist.md`, wrap(async (_req, res) => {
    const s = await S.writeShortlist();
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="shortlist.md"');
    res.send(s.md);
  }));
  app.post(`${base}/check`, wrap(async (req, res) => {
    const { persona, territory, lines } = req.body || {};
    res.json(await S.checkTexts(persona, territory, lines || [], a));
  }));
  app.get(`${base}/compare`, wrap(async (_req, res) => res.json(await S.listCompares())));
  app.post(`${base}/compare`, wrap(async (req, res) => {
    const b = S.makeBrief(req.body.brief || {});
    const models: string[] = req.body.models || [];
    const n = Number(req.body.n || 8);
    const id = `compare~${Date.now()}`;
    startJob(id, emit => S.compare(b, models, n, a, emit));
    res.json({ job: id });
  }));
  app.get(`${base}/compare/:name`, wrap(async (req, res) => res.json(await S.loadCompare(req.params.name))));
  app.patch(`${base}/compare/:name/lines/:id`, wrap(async (req, res) => {
    const s = await S.loadCompare(req.params.name);
    const l = s.lines.find(x => x.id === req.params.id);
    if (!l) throw new Error('No such line');
    if (req.body.favourite !== undefined) l.favourite = !!req.body.favourite;
    if (req.body.note !== undefined) l.note = String(req.body.note);
    await S.saveCompare(s);
    res.json(l);
  }));
  app.post(`${base}/compare/:name/reveal`, wrap(async (req, res) => res.json(await S.revealCompare(req.params.name))));

  app.post(`${base}/territories`, wrap(async (req, res) => res.json(await S.saveTerritory(null, req.body?.territory || {}, String(req.body?.note || ''), who(req)))));
  app.put(`${base}/territories/:code`, wrap(async (req, res) => res.json(await S.saveTerritory(req.params.code, req.body?.territory || {}, String(req.body?.note || ''), who(req)))));
  app.get(`${base}/brand/:name`, (req: any, res: any) => {
    try { res.setHeader('Cache-Control', 'max-age=3600'); res.sendFile(S.brandAssetPath(req.params.name)); } catch { res.sendStatus(404); }
  });
  app.get(`${base}/docs`, wrap(async (_req, res) => res.json(S.referenceDocs())));
  app.get(`${base}/docs/:id`, wrap(async (req, res) => {
    const { doc, file } = S.referenceDocPath(req.params.id);
    if (doc.kind === 'md') { res.setHeader('Content-Type', 'text/markdown; charset=utf-8'); return res.send(fs.readFileSync(file, 'utf8')); }
    res.download(file, path.basename(file));
  }));

  app.listen(port, '127.0.0.1', () => {
    console.log(`Studio API on http://127.0.0.1:${port}${base} (${MOCK ? 'MOCK, no cost' : `live, cap $${CAP}`}); files in ${S.studioDir()}`);
  });
}

main().catch(err => { console.error(err?.message || err); process.exit(1); });
