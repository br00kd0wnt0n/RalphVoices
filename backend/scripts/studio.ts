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
//   npx tsx scripts/studio.ts planted  --territory DINK_NEVER [--api https://host]  (acceptance: planted non-compliant lines must be flagged;
//                                         --api runs them through a hosted Studio, signed in with STUDIO_TOKEN)
//   npx tsx scripts/studio.ts export   --batch ID                      (CSV for Sheets + Markdown view)
//   npx tsx scripts/studio.ts ingest   --csv PATH                      (curated sheet back in: taste examples + shortlist)
//   npx tsx scripts/studio.ts shortlist
//   npx tsx scripts/studio.ts compare  --brief NAME --models gpt-4o,gpt-4.1,gpt-5.5,claude-opus-5-5 [--n 10] [--yes]   (2-4 writers; claude-* needs ~/.config/voices/anthropic.key)
//   npx tsx scripts/studio.ts reveal   --compare NAME
//   npx tsx scripts/studio.ts status
//   npx tsx scripts/studio.ts limits   [--models gpt-4o,gpt-4.1]       (models on the account and their TPM limits; 1-token calls)
//   npx tsx scripts/studio.ts serve    [--port 4100]                   (local API for the /studio page; 127.0.0.1 only)
// Common flags:
//   --mock                   no network, no cost (in-process stand-in for OpenAI)
//   --tpm gpt-4o=15000,...   per-model tokens-per-minute cap. Default: 90% of the limit the account reports (gpt-4o 30k at tier 1 → 27k); set it lower when sharing the account
//   --cap 15                 session spend cap in USD (studio/spend.json is cumulative)
//   --studio DIR             output folder (default: the client folder above)
//   --store pg --database-url URL   use Postgres (migration 015) instead of files; local hosts only unless --allow-remote
//   rules-push [--file F] [--activate]   upload a rules file to the database as a version
//   db-import [--from DIR] [--since YYYY-MM-DD | --runs a,b] [--compares] [--with-spend] [--with-rules] [--dry-run]
//                                         copy a studio folder into the database (re-runnable); the agreed
//                                         carry-over is --since 2026-09-28 --with-spend
//   --yes                    needed for any run estimated over $2

import fs from 'node:fs';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import { FileStore } from '../src/services/studio/store.js';
import { PgStore } from '../src/services/studio/pgStore.js';

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (n: string) => argv.includes(`--${n}`);
function opt(n: string, d = ''): string { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; }
function opts(n: string): string[] { const out: string[] = []; argv.forEach((a, i) => { if (a === `--${n}` && argv[i + 1] !== undefined) out.push(argv[i + 1]); }); return out; }
const list = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);

if (opt('studio')) S.setStudioDir(path.resolve(opt('studio')));
if (opt('rules')) S.setRulesPath(path.resolve(opt('rules')));
const MOCK = flag('mock');

// Storage: files (default) or Postgres. The database URL must be given
// explicitly (--database-url or STUDIO_DATABASE_URL); DATABASE_URL is never
// read, because backend/.env points it at production. Non-local hosts are
// refused unless --allow-remote (the deploy step, with Brook's go-ahead).
let pgStore: PgStore | null = null;
function databaseUrl(): string {
  // Tolerate a pasted value with surrounding spaces or quotes.
  const url = (opt('database-url') || process.env.STUDIO_DATABASE_URL || '').trim().replace(/^['"]|['"]$/g, '');
  if (!url) throw new Error('--store pg needs --database-url (or STUDIO_DATABASE_URL); DATABASE_URL is deliberately not used');
  // Never echo the value: it carries the database password.
  let parsed: URL;
  try { parsed = new URL(url); } catch {
    const hint = url.startsWith('${{') ? ' That is a Railway reference, not the value: copy it from the Postgres service itself.' : /^\*+$/.test(url) ? ' That is the masked value: reveal it (eye icon) or use Copy.' : '';
    throw new Error(`The database URL isn't a valid URL (it should start with postgresql://).${hint} Copy DATABASE_PUBLIC_URL from the Postgres service in Railway.`);
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error(`The database URL starts with ${parsed.protocol}// but should be postgresql:// (that looks like a web address, not the database). Copy DATABASE_PUBLIC_URL from the Postgres service in Railway.`);
  const host = parsed.hostname;
  if (host.endsWith('.railway.internal')) throw new Error(`${host} only resolves inside Railway; use the public URL (DATABASE_PUBLIC_URL, a proxy.rlwy.net host).`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !flag('allow-remote')) throw new Error(`Refusing non-local database host ${host}; pass --allow-remote only for the approved deploy step`);
  return url;
}
if (opt('store') === 'pg') { pgStore = PgStore.fromUrl(databaseUrl()); S.setStore(pgStore); }
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
  // Rules v2.3: only claims that pre-existing conditions are covered; the honest CUR_VET caveat must pass.
  { text: 'Even pre-existing conditions are covered', field: 'meta_headline', expect: 'COMP_PREEXISTING' },
  { text: 'Conditions that appear before coverage begins may be considered pre-existing.', field: 'meta_primary', expect: 'COMP_PREEXISTING', absent: true },
  { text: 'Checkups covered. Vaccines covered. Relax.', field: 'meta_primary', expect: 'COMP_ROUTINE' },
  { text: 'Every claim paid in seconds.', field: 'meta_headline', expect: 'COMP_CLAIM_SPEED' },
  { text: 'Cheap pet insurance can cost you more when it matters most.', field: 'meta_primary', expect: 'COMP_CHEAP_LOCKED', severity: 'warn' },
  // Rules v2.2: trust claims and superlatives need substantiation (two lines kept on 28 Sep only got 'truncated').
  { text: 'Trupanion: trusted by pet parents across the country', field: 'meta_primary', expect: 'COMP_SUPERLATIVE', severity: 'warn' },
  { text: 'Is pet insurance the ultimate adulting?', field: 'meta_headline', expect: 'COMP_SUPERLATIVE', severity: 'warn' },
];

async function main() {
  if (command && !['limits', 'help', 'rules-push', 'db-import'].includes(command)) await S.refreshRules();
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
      const persona = opt('persona') || S.loadRules().territories[territory].persona;
      const started = Date.now();
      const items = PLANTED.map(p => ({ text: p.text, field: p.field }));
      // --api URL: run them through a hosted Studio's /check route instead (the smoke test), signed in with STUDIO_TOKEN.
      const apiUrl = opt('api');
      let lines: S.Line[];
      if (apiUrl) {
        if (!process.env.STUDIO_TOKEN) throw new Error('--api needs STUDIO_TOKEN (a signed-in Voices token) in the environment');
        const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/studio/check`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.STUDIO_TOKEN}` },
          body: JSON.stringify({ persona, territory, lines: items }),
        });
        if (!res.ok) throw new Error(`${apiUrl} /check: HTTP ${res.status} ${await res.text()}`);
        lines = (await res.json()) as S.Line[];
        console.log(`Checked through ${apiUrl}\n`);
      } else lines = await S.checkTexts(persona, territory, items, api());
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
      console.log(`${pgStore ? 'Store: Postgres' : `Studio folder: ${S.studioDir()}`}\nSpend: $${s.total_usd.toFixed(3)} of $${CAP} over ${s.runs.length} runs.`);
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
    case 'rules-push': {
      // Upload a rules file to the database as a version; --activate makes it live.
      if (!pgStore) throw new Error('rules-push needs --store pg');
      const file = opt('file', path.join(S.studioDir(), 'studio-rules.json'));
      const body = JSON.parse(fs.readFileSync(file, 'utf8'));
      const version = opt('version', body.version || new Date().toISOString().slice(0, 10));
      await pgStore.putRules(version, body, { activate: flag('activate'), by: opt('user', 'cli'), notes: opt('notes') || undefined });
      console.log(`Rules ${version} uploaded${flag('activate') ? ' and activated' : ' as a draft'}.`);
      console.table(await pgStore.listRules());
      return;
    }
    case 'db-import': {
      // Copy a studio folder into the database. Safe to re-run: every write is an upsert.
      // Carry-over (Brook, 28 Sep): --since 2026-09-28 (or --runs a,b) picks the runs; their briefs,
      // decision history and taste examples follow; planted-line checks never come across;
      // blind compares only with --compares. --dry-run prints the plan and writes nothing.
      const { planImport, describePlan, attributeDecisions } = await import('../src/services/studio/importPlan.js');
      const src = new FileStore(opt('from', S.studioDir()), { rulesPath: opt('rules') || undefined, inputsDir: S.INPUTS, assets: S.localAssets() });
      const editsFile = path.join(src.dir, 'edits.jsonl');
      const allHistory = fs.existsSync(editsFile) ? fs.readFileSync(editsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
      const briefsDir = path.join(src.dir, 'briefs');
      const briefFiles = fs.existsSync(briefsDir) ? fs.readdirSync(briefsDir).filter(x => x.endsWith('.json')) : [];
      const plan = await planImport(src, { since: opt('since') || undefined, runs: list(opt('runs')), compares: flag('compares') }, allHistory, briefFiles);
      const rules = await src.getRules();
      const edits = await src.getTerritoryEdits();
      const assetNames = [];
      for (const name of Object.keys(S.localAssets())) if (await src.hasAsset(name)) assetNames.push(name);
      const spend = await src.listSpend();
      let attributed = 0, unnamed = 0;
      for (const r of plan.runs) {
        const b = await src.getBatch(r.id);
        unnamed += b.lines.filter((l: any) => l.decision && !l.decided_by).length;
        attributed += attributeDecisions(b, plan.history).length;
      }
      console.log(`From ${src.dir}\nRules: ${flag('with-rules') ? `${rules.version} (becomes the active version)` : 'not touched (upload and activate them in the Studio\'s Rules view; --with-rules to import them here)'}\nTerritory edits: ${Object.keys(edits).length}\nAssets: ${assetNames.join(', ') || 'none'}\n${describePlan(plan)}\nSpend: ${flag('with-spend') ? `${spend.length} records, $${spend.reduce((t, e) => t + (e.usd || 0), 0).toFixed(3)}` : 'not imported (add --with-spend)'}`);
      if (unnamed) console.log(`Decisions with no name or time: ${unnamed}, attributed to the run's author at the run's last save.`);
      if (attributed) console.log(`Decisions with no history: ${attributed}, each given one history record marked imported.`);
      if (!opt('since') && !opt('runs')) console.log('Note: no --since or --runs, so every run except planted-line checks is included. The agreed carry-over is --since 2026-09-28.');
      if (flag('dry-run')) { console.log('Dry run: nothing written.'); return; }
      if (!pgStore) throw new Error('db-import needs --store pg (or --dry-run)');
      if (flag('with-rules')) await pgStore.putRules(rules.version || 'imported', rules, { activate: true, by: opt('user', 'import'), notes: 'Imported from the local studio folder' });
      for (const key of ['personas', 'voices'] as const) { const v = await src.getInput(key); if (v) await pgStore.putInput(key, v); }
      for (const [code, t] of Object.entries(edits)) await pgStore.saveTerritoryEdit(code, t);
      for (const f of plan.briefs) await pgStore.saveBrief(JSON.parse(fs.readFileSync(path.join(briefsDir, f), 'utf8')));
      let lines = 0;
      for (const r of plan.runs) {
        const b = await src.getBatch(r.id);
        const made = attributeDecisions(b, plan.history);
        await pgStore.saveBatch(b);
        // History is append-only: on a re-run, skip lines the database already has history for.
        for (const e of made) if (!(await pgStore.listEdits(e.line_id)).length) await pgStore.recordEdit(e);
        await pgStore.saveEmbeddings(r.id, await src.getEmbeddings(r.id));
        lines += b.lines.length;
      }
      const seen = async (e: { line_id: string; at: string; by: string }) => (await pgStore!.listEdits(e.line_id)).some(x => x.at === e.at && x.by === e.by);
      for (const e of plan.history) if (!(await seen(e))) await pgStore.recordEdit(e);
      await pgStore.saveTaste(plan.taste);
      for (const name of plan.compares) { await pgStore.saveCompare(await src.getCompare(name)); await pgStore.saveCompareKey(name, await src.getCompareKey(name)); }
      for (const name of assetNames) await pgStore.putAsset(name, (await src.getAsset(name))!);
      let spendAdded = 0;
      if (flag('with-spend')) {
        // Spend is append-only too: skip entries already in the database (same label, time and amount).
        const have = new Set((await pgStore.listSpend()).map(x => `${x.label}|${new Date(x.at).toISOString()}|${Number(x.usd).toFixed(4)}`));
        for (const e of spend) {
          const row = { ...e, label: e.label || (e as any).tag || 'imported', at: e.at || new Date().toISOString() };
          if (have.has(`${row.label}|${new Date(row.at).toISOString()}|${Number(row.usd).toFixed(4)}`)) continue;
          await pgStore.addSpend(row);
          spendAdded++;
        }
      }
      console.log(`Imported: ${plan.runs.length} runs (${lines} lines), ${plan.briefs.length} briefs, ${plan.history.length + attributed} decision-history records (${attributed} marked imported), ${plan.taste.length} taste examples, ${plan.compares.length} compares, ${assetNames.length} assets${flag('with-spend') ? `, ${spendAdded} of ${spend.length} spend records (the rest were already there)` : ''}.`);
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
  const { createStudioRouter } = await import('../src/services/studio/router.js');
  const app = express();
  const port = Number(opt('port', '4100'));
  const pacer = api().pacer;

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

  // Local only: the page sends the name it asked for. The hosted build (routes/studio.ts) uses the signed-in user.
  const who = (req: any) => String(req.headers['x-studio-user'] || '').trim().slice(0, 60) || undefined;
  const base = '/api/studio';
  app.use(base, createStudioRouter({
    who,
    api: req => new S.Api({ mock: MOCK, tpm: tpm(), cap: CAP, pacer, user: who(req) }),
    mock: MOCK,
    cap: CAP,
    capWindow: 'all',
    askOver: ASK_OVER,
  }));

  app.listen(port, '127.0.0.1', () => {
    console.log(`Studio API on http://127.0.0.1:${port}${base} (${MOCK ? 'MOCK, no cost' : `live, cap $${CAP}`}); ${pgStore ? 'local database' : `files in ${S.studioDir()}`}`);
  });
}

main().then(async () => { if (command !== 'serve') await pgStore?.close(); }).catch(async err => { console.error(err?.message || err); await pgStore?.close(); process.exit(1); });
