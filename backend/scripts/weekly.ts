// B3 weekly read (VOICES v2, Trupanion): ingest ad platform exports, read them,
// draft the weekly note. CLI only; the model is in src/services/weekly/.
//
// Database: local only. Uses --db, else DATABASE_URL from the shell, else
// postgresql://postgres@127.0.0.1:54329/voices_dev. Refuses any non-local host
// (backend/.env points at production; it is never loaded here).
// Outputs (notes, ledgers, simulated exports) go to client material outside the
// repo: /Users/BD/ralph-voices/Claude outputs/voices-r1/weekly/ (override with --out).
//
// Usage (from backend/):
//   npx tsx scripts/weekly.ts migrate                                   (apply 016 only; idempotent)
//   npx tsx scripts/weekly.ts ingest   --file EXPORT.csv --platform meta|tiktok [--features SHORTLIST.csv]... [--no-features] [--dry-run]
//   npx tsx scripts/weekly.ts features --file SHORTLIST_OR_AUDIT.csv     (refresh features on stored ads by stub)
//   npx tsx scripts/weekly.ts note     --week 2026-10-19 [--since 2026-10-12] [--prose] [--out DIR]
//   npx tsx scripts/weekly.ts read     --file EXPORT.csv --platform meta [--week DATE] [--since DATE] [--features CSV] [--note] [--historic]
//                                      (no database; a quick look at one file. --historic keeps ads outside the naming convention,
//                                       for the back-test on Add3's history; features can then join by an ad_name column)
//   npx tsx scripts/weekly.ts simulate [--scenario month1|thin|null] [--seed 42] [--start 2026-10-12] [--check] [--out DIR]
//   npx tsx scripts/weekly.ts status
// Common: --db URL, --config PATH (default backend/config/weekly-read.json)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { loadConfig, DEFAULT_CONFIG_PATH, type WeeklyConfig, type SourcePlatform } from '../src/services/weekly/config.js';
import { parseExport, loadFeatureCsv, type FeatureMap, type ExportResult } from '../src/services/weekly/ingest.js';
import { aggregate, fromIngest, weekOf, addDays, type MetricRow } from '../src/services/weekly/window.js';
import { readWeek, type Read } from '../src/services/weekly/model.js';
import { draftNote, lintNote, newNumbers } from '../src/services/weekly/note.js';
import { simulate, checkRecovery, type Scenario } from '../src/services/weekly/simulate.js';
import { saveExport, loadRows, updateFeatures, ingestSources } from '../src/services/weekly/store.js';

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (n: string) => argv.includes(`--${n}`);
function opt(n: string, d = ''): string { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; }
function opts(n: string): string[] { const out: string[] = []; argv.forEach((a, i) => { if (a === `--${n}` && argv[i + 1] !== undefined) out.push(argv[i + 1]); }); return out; }

const CLIENT_DIR = '/Users/BD/ralph-voices/Claude outputs/voices-r1';
const OUT = path.resolve(opt('out', path.join(CLIENT_DIR, 'weekly')));
const DEFAULT_SHORTLIST = path.join(CLIENT_DIR, 'studio', 'shortlist.csv');
const cfg: WeeklyConfig = loadConfig(opt('config') ? path.resolve(opt('config')) : DEFAULT_CONFIG_PATH);
const int = (n: number) => Math.round(n).toLocaleString('en-US');

function pool(): pg.Pool {
  const url = opt('db') || process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:54329/voices_dev';
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) && !flag('allow-remote')) {
    console.error(`Refusing database host ${host}: B3 runs on the local database only (Railway databases are off limits).`);
    process.exit(2);
  }
  pg.types.setTypeParser(1082, (v: string) => v); // DATE as 'yyyy-mm-dd'
  return new pg.Pool({ connectionString: url });
}

function features(): FeatureMap {
  const map: FeatureMap = new Map();
  if (flag('no-features')) return map;
  const files = opts('features');
  if (!files.length && fs.existsSync(DEFAULT_SHORTLIST)) files.push(DEFAULT_SHORTLIST);
  for (const f of files) {
    const r = loadFeatureCsv(fs.readFileSync(f, 'utf8'), path.basename(f), cfg, map);
    console.log(`Features: ${r.rows} rows from ${f}${r.unmatched.length ? `; ${r.unmatched.length} stubs didn't parse (${r.unmatched.slice(0, 5).join(', ')})` : ''}`);
  }
  if (!files.length) console.log('Features: none (no --features file and no Studio shortlist found); every ad has features unknown.');
  return map;
}

function reportExport(res: ExportResult) {
  const c = res.columns;
  console.log(`\nColumns mapped (${res.platform}):`);
  for (const [f, h] of Object.entries(c.mapped)) console.log(`  ${f.padEnd(20)} ← "${h}"`);
  console.log(`  missing: ${c.missing.join(', ') || 'none'}`);
  if (c.unmapped_headers.length) console.log(`  headers not used: ${c.unmapped_headers.join(', ')}`);
  if (!res.quotes_available) console.log('  NOTE: no quote column matched; quotes per 1,000 and cost per quote will be left out. Add the column name to config columns.' + res.platform + '.quotes.');
  const ads = new Set(res.rows.map(r => `${r.ad_name}|${r.campaign}|${r.ad_set}`)).size;
  console.log(`\nRows: ${res.rows.length} ad-periods for ${ads} ads; ${res.skipped.length} skipped${res.skipped.length ? ` (${[...new Set(res.skipped.map(s => s.reason))].join('; ')})` : ''}.`);
  const a = res.audience_counts;
  console.log(`Audience: prospecting ${a.prospecting.ads} ads (${int(a.prospecting.impressions)} imp.), retargeting ${a.retargeting.ads} (${int(a.retargeting.impressions)}), unknown ${a.unknown.ads} (${int(a.unknown.impressions)})`);
  if (a.unknown.ads) console.log('  Unknown-audience ads are left out of the read. If they are prospecting, adjust config audience.prospecting_pattern.');
  console.log(`\nQuarantined: ${res.quarantine.length} ad name${res.quarantine.length === 1 ? '' : 's'}`);
  for (const q of res.quarantine) console.log(`  ✗ ${q.ad_name}  — ${q.reason}  (${q.rows} rows, ${int(q.impressions)} impressions)`);
  if (res.name_warnings.length) {
    console.log(`Parsed with warnings: ${res.name_warnings.length}`);
    for (const w of res.name_warnings) console.log(`  ~ ${w.ad_name}  — ${w.warnings.join('; ')}`);
  }
  const withF = new Set(res.rows.filter(r => r.features).map(r => r.ad_name)).size;
  console.log(`Features joined for ${withF} of ${ads} ads.`);
  for (const w of res.warnings) console.log(`WARNING: ${w}`);
}

function doRead(rows: MetricRow[], week: { start: string; end: string }, since: string, quotesAvailable: boolean, historic = false): { read: Read; prev: Read | null; win: ReturnType<typeof aggregate>; weekImps: Map<string, number> } {
  const win = aggregate(rows, since, week.end, { historic });
  const read = readWeek(win.ads, cfg, { from: since, to: week.end, quotesAvailable: quotesAvailable && win.quotes_seen });
  const prevEnd = addDays(week.start, -1);
  let prev: Read | null = null;
  if (prevEnd >= since && rows.some(r => r.period_end <= prevEnd && r.period_start >= since)) {
    const pw = aggregate(rows, since, prevEnd, { historic });
    prev = readWeek(pw.ads, cfg, { from: since, to: prevEnd, quotesAvailable: quotesAvailable && pw.quotes_seen });
  }
  const weekImps = new Map<string, number>();
  for (const r of rows) if (r.period_start >= week.start && r.period_end <= week.end) weekImps.set(r.key, (weekImps.get(r.key) || 0) + (r.impressions || 0));
  return { read, prev, win, weekImps };
}

function printRead(read: Read) {
  console.log(`\nRead ${read.window.from} → ${read.window.to}: ${read.ads.length} prospecting ads`);
  const by: Record<string, number> = {};
  for (const a of read.ads) by[a.headline.call] = (by[a.headline.call] || 0) + 1;
  console.log('Calls:', Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', '));
  for (const a of read.ads.filter(a => a.headline.call !== 'keep testing' && a.headline.call !== 'too early to call'))
    console.log(`  ${a.headline.call.padEnd(13)} ${a.stub.padEnd(28)} ${a.headline.reason}`);
  const clear = [...read.features, ...read.formats, ...read.persona_features].filter(e => e.verdict.startsWith('clear'));
  console.log(`Clear feature/format effects: ${clear.length ? clear.map(e => `${e.label}${e.persona ? ` (${e.persona})` : ''} on ${e.metric} ×${e.ratio!.toFixed(2)} [${e.lo!.toFixed(2)}, ${e.hi!.toFixed(2)}]`).join('; ') : 'none'}`);
}

function writeNote(read: Read, prev: Read | null, win: ReturnType<typeof aggregate>, weekImps: Map<string, number>, week: { start: string; end: string }, since: string, sources: string[], outDir: string) {
  const { markdown, ledger } = draftNote(read, { week, since, window: win, prev, week_impressions: weekImps, sources }, cfg);
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `weekly-${week.start}`);
  fs.writeFileSync(`${base}.md`, markdown);
  fs.writeFileSync(`${base}-ledger.csv`, ledger);
  const lint = lintNote(markdown, cfg);
  console.log(`\nWrote ${base}.md and ${base}-ledger.csv`);
  console.log(lint.length ? `Wording check: ${lint.length} issue(s)\n${lint.map(i => `  line ${i.line}: ${i.rule}: ${i.text.slice(0, 120)}`).join('\n')}` : 'Wording check: clean (no banned words; every rate has its range).');
  return { markdown, path: `${base}.md` };
}

async function prose(mdPath: string) {
  // Optional: a two-to-three sentence "In short" per persona, drafted by GPT-4o
  // from that persona's computed section. Rejected if it introduces any number
  // not in the section, or breaks a wording rule.
  const { default: OpenAI } = await import('openai');
  loadKey();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2 });
  let md = fs.readFileSync(mdPath, 'utf8');
  let cost = 0;
  for (const p of cfg.naming.personas) {
    const start = md.indexOf(`\n## ${p}\n`);
    if (start < 0) continue;
    const end = md.indexOf('\n## ', start + 5);
    const section = md.slice(start, end < 0 ? undefined : end);
    let accepted: string | null = null, why = '';
    for (let attempt = 0; attempt < 2 && !accepted; attempt++) {
      const r = await client.chat.completions.create({
        model: 'gpt-4o', temperature: 0.3, max_tokens: 220,
        messages: [
          { role: 'system', content: `You summarise a weekly ad performance read for a client call. Write 2-3 plain sentences. Use only numbers that appear in the text you're given, copied exactly, and always keep a number's range next to it. Don't write any number that isn't in the text, including as a word. Never use the words: ${cfg.wording.banned.join(', ')}. If the read says too early to call, say so plainly. No headings, no lists.${why ? ` Your last draft was rejected: ${why}.` : ''}` },
          { role: 'user', content: section },
        ],
      });
      cost += ((r.usage?.prompt_tokens || 0) * 2.5 + (r.usage?.completion_tokens || 0) * 10) / 1e6;
      const text = (r.choices[0]?.message?.content || '').trim();
      const extra = newNumbers(text, section);
      const lint = lintNote(text, cfg);
      if (extra.length) why = `it introduced numbers not in the read (${extra.join(', ')})`;
      else if (lint.length) why = lint.map(l => l.rule).join('; ');
      else accepted = text;
    }
    const insertAt = md.indexOf('\n### What moved', start);
    const block = accepted ? `\n*In short (drafted by GPT-4o from the numbers below; numbers checked against them):* ${accepted}\n` : `\n*In short: not drafted (${why}); write it by hand.*\n`;
    md = md.slice(0, insertAt) + block + md.slice(insertAt);
    console.log(`${p}: ${accepted ? 'prose accepted' : `prose rejected (${why})`}`);
  }
  fs.writeFileSync(mdPath, md);
  console.log(`Prose cost about $${cost.toFixed(3)}.`);
}

function loadKey() {
  if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('...')) return;
  const keyFile = path.join(process.env.HOME || '', '.config/voices/openai.key');
  if (fs.existsSync(keyFile)) { process.env.OPENAI_API_KEY = fs.readFileSync(keyFile, 'utf8').trim(); return; }
  // Parse backend/.env by hand for this one variable; never dotenv.config() (its DATABASE_URL is production).
  const envPath = [path.resolve(process.cwd(), '.env'), '/Users/BD/ralph-voices/backend/.env'].find(p => fs.existsSync(p));
  const m = envPath ? /^OPENAI_API_KEY\s*=\s*(.*)$/m.exec(fs.readFileSync(envPath, 'utf8')) : null;
  const key = m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
  if (key.length < 20) throw new Error('No OPENAI_API_KEY; export it in the shell');
  process.env.OPENAI_API_KEY = key;
}

async function main() {
  switch (command) {
    case 'migrate': {
      const p = pool();
      const sql = fs.readFileSync(path.resolve(__dirname, '../src/db/migrations/016_live_performance.sql'), 'utf8');
      await p.query(sql);
      const t = await p.query(`SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'live_%' ORDER BY 1`);
      console.log(`Applied 016_live_performance.sql. Tables: ${t.rows.map(r => r.table_name).join(', ')}`);
      await p.end();
      return;
    }
    case 'ingest': {
      const file = opt('file'), platform = opt('platform') as SourcePlatform;
      if (!file || !['meta', 'tiktok'].includes(platform)) throw new Error('usage: ingest --file EXPORT.csv --platform meta|tiktok');
      const text = fs.readFileSync(file, 'utf8');
      const res = parseExport(text, platform, cfg, features());
      reportExport(res);
      if (flag('dry-run')) { console.log('\n--dry-run: nothing stored.'); return; }
      const p = pool();
      const sha = crypto.createHash('sha256').update(text).digest('hex');
      const s = await saveExport(p, { name: path.basename(file), sha256: sha }, res, cfg.version);
      console.log(`\nStored (ingest #${s.ingest_id}${s.replaced_ingest ? ', same file as before: updated in place' : ''}): ads ${s.ads_inserted} new, ${s.ads_updated} updated; metric rows ${s.metrics_inserted} new, ${s.metrics_updated} updated.`);
      await p.end();
      return;
    }
    case 'features': {
      const file = opt('file');
      if (!file) throw new Error('usage: features --file SHORTLIST.csv');
      const map = loadFeatureCsv(fs.readFileSync(file, 'utf8'), path.basename(file), cfg).map;
      const p = pool();
      const r = await updateFeatures(p, map);
      console.log(`Updated features on ${r.updated} ads from ${map.size} stubs. Stubs with no ad yet: ${r.stubs_without_ads.length}`);
      await p.end();
      return;
    }
    case 'note': {
      const wk = opt('week');
      if (!wk) throw new Error('usage: note --week YYYY-MM-DD');
      const week = weekOf(wk);
      const p = pool();
      const rows = await loadRows(p, week.end);
      if (!rows.length) throw new Error('no live_metrics rows up to that week; ingest first');
      const since = opt('since') || rows.map(r => r.period_start).sort()[0];
      const qa = rows.some(r => r.quotes !== null);
      const { read, prev, win, weekImps } = doRead(rows, week, since, qa);
      printRead(read);
      const sources = await ingestSources(p, since, week.end);
      await p.end();
      const { path: mdPath } = writeNote(read, prev, win, weekImps, week, since, sources, OUT);
      if (flag('prose')) await prose(mdPath);
      return;
    }
    case 'read': {
      const file = opt('file'), platform = (opt('platform') || 'meta') as SourcePlatform;
      if (!file) throw new Error('usage: read --file EXPORT.csv --platform meta');
      const res = parseExport(fs.readFileSync(file, 'utf8'), platform, cfg, features());
      reportExport(res);
      const rows = res.rows.map(fromIngest);
      const last = rows.map(r => r.period_end).sort().slice(-1)[0];
      const week = weekOf(opt('week') || last);
      const since = opt('since') || rows.map(r => r.period_start).sort()[0];
      const { read, prev, win, weekImps } = doRead(rows, week, since, res.quotes_available, flag('historic'));
      printRead(read);
      if (flag('historic')) console.log(`--historic: ${read.ads.filter(a => a.persona === 'HIST').length} ads outside the naming convention kept as their own ads (persona HIST). Use the ledger for the back-test; the calls mean little across a whole account.`);
      if (flag('note')) writeNote(read, prev, win, weekImps, week, since, [path.basename(file)], OUT);
      return;
    }
    case 'simulate': {
      const scenario = (opt('scenario') || 'month1') as Scenario;
      const seed = Number(opt('seed', '42'));
      const sim = simulate(scenario, seed, opt('start', '2026-10-12'));
      const dir = path.join(OUT, 'sim', `${scenario}-seed${seed}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'meta-export.csv'), sim.meta_csv);
      fs.writeFileSync(path.join(dir, 'tiktok-export.csv'), sim.tiktok_csv);
      fs.writeFileSync(path.join(dir, 'shortlist.csv'), sim.features_csv);
      fs.writeFileSync(path.join(dir, 'truth.json'), JSON.stringify(sim.truth, null, 2));
      console.log(`Simulated ${scenario} (seed ${seed}, ${sim.truth.days} days from ${sim.truth.start}) → ${dir}`);
      console.log(`  ${sim.truth.ads.filter(a => a.audience === 'prospecting').length} prospecting ads, ${sim.truth.ads.filter(a => a.audience === 'retargeting').length} retargeting, ${sim.truth.planted_bad_names.length} bad names, ${sim.truth.cosmetic_names.length} cosmetic name variants`);
      if (flag('check')) {
        const fm = loadFeatureCsv(sim.features_csv, 'sim shortlist', cfg).map;
        const rows = [...parseExport(sim.meta_csv, 'meta', cfg, fm).rows, ...parseExport(sim.tiktok_csv, 'tiktok', cfg, fm).rows].map(fromIngest);
        const to = addDays(sim.truth.start, sim.truth.days - 1);
        const read = readWeek(aggregate(rows, sim.truth.start, to).ads, cfg, { from: sim.truth.start, to, quotesAvailable: true });
        const rec = checkRecovery(read, sim.truth);
        console.log('\nPlanted effect'.padEnd(34) + 'metric'.padEnd(16) + 'size'.padEnd(7) + 'truth'.padEnd(7) + 'estimate [90% range]'.padEnd(26) + 'status');
        for (const r of rec.rows) console.log(`${r.what.padEnd(33)} ${r.metric.padEnd(15)} ${r.size.padEnd(6)} ${('×' + r.truth.toFixed(2)).padEnd(6)} ${(r.estimate === null ? '—' : `×${r.estimate.toFixed(2)} [${r.lo!.toFixed(2)}, ${r.hi!.toFixed(2)}]`).padEnd(25)} ${r.status}`);
        console.log('\nAds called scale or cut (true rank on quotes per 1,000 within the ad set):');
        for (const c of rec.calls) console.log(`  ${c.call.padEnd(13)} ${c.stub.padEnd(26)} true rank ${c.true_rank} of ${c.cell_size}`);
        const counts: Record<string, number> = {};
        for (const a of read.ads) counts[a.headline.call] = (counts[a.headline.call] || 0) + 1;
        console.log(`\nCalls: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
        console.log(rec.summary.join('\n'));
      }
      return;
    }
    case 'status': {
      const p = pool();
      const i = await p.query('SELECT id, file_name, source_platform, rows_stored, period_start, period_end, jsonb_array_length(quarantined) AS q, ingested_at FROM live_ingests ORDER BY id');
      for (const r of i.rows) console.log(`#${r.id} ${r.file_name} (${r.source_platform}) ${r.period_start}..${r.period_end}: ${r.rows_stored} rows, ${r.q} quarantined names`);
      const a = await p.query(`SELECT parse_status, audience, count(*)::int AS n FROM live_ads GROUP BY 1, 2 ORDER BY 1, 2`);
      console.log(a.rows.map(r => `${r.parse_status}/${r.audience}: ${r.n}`).join(', ') || 'no ads');
      const m = await p.query('SELECT count(*)::int AS n, min(period_start) AS a, max(period_end) AS b FROM live_metrics');
      console.log(`live_metrics: ${m.rows[0].n} rows, ${m.rows[0].a ?? '-'} to ${m.rows[0].b ?? '-'}`);
      await p.end();
      return;
    }
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'));
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
