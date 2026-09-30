// Back-test on Add3's historic exports (the v2 plan's decision gate), as
// pre-registered in docs/build-log/backtest-preregistration.md. Client material
// stays outside the repo: inputs are Step 1's CSVs, outputs go to
//   /Users/BD/ralph-voices/Claude outputs/voices-r1/backtest/
//
// Usage (from backend/):
//   npx tsx scripts/backtest.ts copies                 (distinct copies, the fit/test split; no calls)
//   npx tsx scripts/backtest.ts tag [--yes] [--mock]   (B2's audit on each copy, text only; estimate first, asks over $2)
//   npx tsx scripts/backtest.ts analyze                (the pre-registered analysis; no calls)
// Common: --tpm 15000, --cap 10 (backtest/spend.json is cumulative)

import fs from 'node:fs';
import path from 'node:path';
import { csvObjects, toCsv } from '../src/services/weekly/csv.js';
import { runBacktest, splitCopies, normalizeCopy, copyHash, type BtAd, type BtResult } from '../src/services/weekly/backtest.js';
import { AuditApi, readSpend } from '../src/services/audit/api.js';
import { CONFIG } from '../src/services/audit/config.js';
import { MODELS } from '../src/services/audit/engine.js';
import { mockResponder } from '../src/services/audit/mock.js';
import { loadRubric, loadRules } from '../src/services/audit/rules.js';
import { estimateRound, loadPersonas, runRound } from '../src/services/audit/round.js';
import type { Asset } from '../src/services/audit/types.js';

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (n: string) => argv.includes(`--${n}`);
function opt(n: string, d = ''): string { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; }

const DIR = '/Users/BD/ralph-voices/Claude outputs/voices-r1/backtest';
const STEP1 = path.join(DIR, 'step1');
const CAP = Number(opt('cap', '10'));
const ASK_OVER = 2;
const MOCK = flag('mock');
const MIN_IMPRESSIONS = 50000;
const num = (v: string | undefined) => { const n = Number(String(v ?? '').replace(/[$,%\s]/g, '')); return v === undefined || String(v).trim() === '' || !Number.isFinite(n) ? null : n; };

interface AdRow {
  platform: 'meta' | 'tiktok'; key: string; ad_name: string; campaign: string; region: string; format: string; wave: string; placement_share: number;
  headline: string; body: string; normalized: string; copy: string;
  spend: number; impressions: number; clicks: number; plays: number | null; checkouts: number | null; purchases: number | null;
}

const regionOf = (name: string, campaign: string) => /(?:^|_)(US|CA)(?:_|$)/.exec(name)?.[1] ?? /(?:^|_)(US|CA)(?:_|$)/.exec(campaign)?.[1] ?? 'none';
const formatOf = (name: string, hasPlays: boolean) => /ugc/i.test(name) ? 'UGC video' : /carousel/i.test(name) ? 'carousel' : /single[-_ ]?image/i.test(name) ? 'single image' : hasPlays || /video|reel|animated/i.test(name) ? 'other video' : 'other';
const waveOf = (campaign: string) => { const m = /Q([1-4])-?(20\d\d)/i.exec(campaign); return m ? `Q${m[1]}-${m[2]}` : 'none'; };

function loadAds(): AdRow[] {
  const out: AdRow[] = [];
  // Meta: one row per ad and placement; sum to one row per ad.
  const meta = csvObjects(fs.readFileSync(path.join(STEP1, 'meta-ads-by-placement.csv'), 'utf8'));
  const g = new Map<string, Array<Record<string, string>>>();
  for (const r of meta) { const k = `${r['Campaign name']}|${r['Ad set name']}|${r['Ad name']}`; g.set(k, [...(g.get(k) || []), r]); }
  for (const [key, rows] of g) {
    const f = rows[0];
    if (!/_PRO_/.test(f['Campaign name'])) continue;
    const sum = (c: string) => rows.reduce((s, r) => s + (num(r[c]) ?? 0), 0);
    const any = (c: string) => rows.some(r => num(r[c]) !== null);
    const imps = sum('Impressions');
    const reelsStories = rows.filter(r => /reels|stories/i.test(r['Placement'])).reduce((s, r) => s + (num(r['Impressions']) ?? 0), 0);
    const headline = rows.map(r => r['headline']).find(x => x && x.trim()) || '';
    const body = rows.map(r => r['Body (ad settings)']).find(x => x && x.trim()) || '';
    const plays = any('3-second video plays') ? sum('3-second video plays') : null;
    out.push({ platform: 'meta', key, ad_name: f['Ad name'], campaign: f['Campaign name'], region: regionOf(f['Ad name'], f['Campaign name']), format: formatOf(f['Ad name'], (plays ?? 0) > 0),
      wave: waveOf(f['Campaign name']), placement_share: imps ? reelsStories / imps : 0, headline, body, normalized: `${normalizeCopy(headline)} || ${normalizeCopy(body)}`, copy: '',
      spend: sum('Amount spent (USD)'), impressions: imps, clicks: sum('Link clicks'), plays: plays && plays > 0 ? plays : null,
      checkouts: any('Checkouts initiated') ? sum('Checkouts initiated') : null, purchases: any('Purchases') ? sum('Purchases') : null });
  }
  // TikTok: daily rows; the "-" row is a grand total and is left out.
  const tt = csvObjects(fs.readFileSync(path.join(STEP1, 'tiktok-ads-daily.csv'), 'utf8')).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r['By Day']));
  const h = new Map<string, Array<Record<string, string>>>();
  for (const r of tt) { const k = `${r['Campaign name']}|${r['Ad group name']}|${r['Ad name']}`; h.set(k, [...(h.get(k) || []), r]); }
  for (const [key, rows] of h) {
    const f = rows[0];
    if (!/_PRO_/.test(f['Campaign name'])) continue;
    const sum = (c: string) => rows.reduce((s, r) => s + (num(r[c]) ?? 0), 0);
    const text = rows.map(r => r['Text']).find(x => x && x.trim()) || '';
    const plays = sum('2-second video views');
    out.push({ platform: 'tiktok', key, ad_name: f['Ad name'], campaign: f['Campaign name'], region: regionOf(f['Ad name'], f['Campaign name']), format: formatOf(f['Ad name'], true),
      wave: waveOf(f['Campaign name']), placement_share: 0, headline: '', body: text, normalized: `|| ${normalizeCopy(text)}`, copy: '',
      spend: sum('Spend'), impressions: sum('Impressions'), clicks: sum('Clicks (destination)'), plays: plays > 0 ? plays : null, checkouts: null, purchases: sum('Purchases (website)') });
  }
  return out.filter(a => a.impressions >= MIN_IMPRESSIONS);
}

// Copy ids: M01.. (Meta) and T01.. (TikTok), in order of the SHA-256 of the normalised copy.
function assignCopies(ads: AdRow[]) {
  const copies: Array<{ id: string; platform: string; normalized: string; headline: string; body: string; ads: number; impressions: number; set: string }> = [];
  for (const p of ['meta', 'tiktok'] as const) {
    const texts = [...new Set(ads.filter(a => a.platform === p).map(a => a.normalized))].sort((a, b) => copyHash(a).localeCompare(copyHash(b)));
    const ids = new Map(texts.map((t, i) => [t, `${p === 'meta' ? 'M' : 'T'}${String(i + 1).padStart(2, '0')}`]));
    for (const a of ads.filter(a => a.platform === p)) a.copy = ids.get(a.normalized)!;
    const split = splitCopies(texts.map(t => ({ id: ids.get(t)!, normalized: t })));
    for (const t of texts) {
      const mine = ads.filter(a => a.platform === p && a.normalized === t);
      copies.push({ id: ids.get(t)!, platform: p, normalized: t, headline: mine[0].headline, body: mine[0].body, ads: mine.length, impressions: mine.reduce((s, a) => s + a.impressions, 0), set: p === 'meta' ? (split.fit.has(ids.get(t)!) ? 'fit' : 'test') : 'descriptive' });
    }
  }
  return copies;
}

function copyText(c: { platform: string; headline: string; body: string }) {
  return [`Trupanion social ad (${c.platform === 'meta' ? 'Meta' : 'TikTok'} feed). Copy only; the image or video isn't available.`,
    c.headline ? `Headline: "${c.headline.trim()}"` : '', `Primary text: "${c.body.trim()}"`].filter(Boolean).join('\n');
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const ads = loadAds();
  const copies = assignCopies(ads);
  if (command === 'copies') {
    fs.writeFileSync(path.join(DIR, 'copies.csv'), toCsv(['copy_id', 'platform', 'set', 'ads', 'impressions', 'headline', 'body'], copies.map(c => [c.id, c.platform, c.set, c.ads, c.impressions, c.headline, c.body])));
    fs.writeFileSync(path.join(DIR, 'ads.csv'), toCsv(['platform', 'copy_id', 'ad_name', 'campaign', 'region', 'format', 'wave', 'placement_share', 'spend', 'impressions', 'link_clicks', 'plays', 'checkouts_quotes', 'purchases_enrollments'],
      ads.map(a => [a.platform, a.copy, a.ad_name, a.campaign, a.region, a.format, a.wave, a.placement_share.toFixed(3), a.spend.toFixed(2), a.impressions, a.clicks, a.plays ?? '', a.checkouts ?? '', a.purchases ?? ''])));
    const by = (p: string) => copies.filter(c => c.platform === p);
    console.log(`Units: ${ads.filter(a => a.platform === 'meta').length} Meta and ${ads.filter(a => a.platform === 'tiktok').length} TikTok prospecting ads with ≥${MIN_IMPRESSIONS.toLocaleString()} impressions.`);
    console.log(`Copies: ${by('meta').length} Meta (${by('meta').filter(c => c.set === 'fit').length} fit, ${by('meta').filter(c => c.set === 'test').length} test), ${by('tiktok').length} TikTok (descriptive).`);
    console.log(`Wrote ${path.join(DIR, 'copies.csv')} and ads.csv`);
    return;
  }
  if (command === 'tag') {
    const rules = loadRules(), rubric = loadRubric();
    console.log(`Rules ${rules.version}, rubric ${rubric.version}; ${Object.keys(rules.features.items).length} content features.`);
    const assets: Asset[] = copies.map(c => ({ name: c.id, stub: null, kind: 'text' as const, source: 'backtest copies.csv', frames: [], copy: {}, copy_labels: {}, text_only: copyText(c) }));
    const out = path.join(DIR, MOCK ? 'audit-mock' : 'audit');
    fs.mkdirSync(out, { recursive: true });
    const spendPath = path.join(DIR, 'spend.json');
    const api = new AuditApi({ mock: MOCK ? mockResponder() : undefined, apiKey: MOCK ? undefined : loadKey(), tpm: { [MODELS.yesno]: Number(opt('tpm', String(CONFIG.tpm_default))), [MODELS.compliance]: 150000 },
      capUsd: CAP, spendPath, logPath: path.join(out, 'calls.jsonl'), transcribeUsdPerMinute: CONFIG.transcribe_usd_per_minute });
    const est = estimateRound(assets, { api, rules, rubric });
    const spent = MOCK ? 0 : readSpend(spendPath).total_usd;
    console.log(`Estimate: ${assets.length} copies, ${est.calls} calls, ~$${est.usd.toFixed(2)} (B2's estimates run ~40% high). Back-test spend so far $${spent.toFixed(2)} of $${CAP}.`);
    if (!MOCK && spent + est.usd > CAP) { console.log('Refusing: over the cap.'); return; }
    if (!MOCK && est.usd > ASK_OVER && !flag('yes')) { console.log(`Over $${ASK_OVER}: ask Brook, then re-run with --yes.`); return; }
    const t0 = Date.now();
    const res = await runRound(assets, { api, rules, rubric, workDir: out, personas: loadPersonas(rules), concurrency: Number(opt('concurrency', '3')) }, { round: 'backtest-copies', outDir: out, rubricVersion: rubric.version, cap: CAP });
    api.record({ tag: `backtest tag${MOCK ? ' (mock)' : ''}`, assets: assets.length, seconds: Math.round((Date.now() - t0) / 1000) });
    const ids = Object.keys(rules.features.items);
    const rows = res.audits.map(a => [a.asset, ids.filter(f => (a.features[f] ?? 0) >= CONFIG.feature_threshold).join('; '), ...ids.map(f => a.features[f] === undefined ? '' : a.features[f].toFixed(3))]);
    fs.writeFileSync(path.join(DIR, MOCK ? 'copy-features-mock.csv' : 'copy-features.csv'), toCsv(['copy_id', 'features', ...ids.map(f => `p_${f}`)], rows));
    console.log(`Done: ${res.audits.length} copies tagged, ${api.calls} calls, $${api.usd.toFixed(3)}, ${Math.round((Date.now() - t0) / 1000)} s. Features: ${path.join(DIR, MOCK ? 'copy-features-mock.csv' : 'copy-features.csv')}`);
    return;
  }
  if (command === 'analyze') {
    const fpath = path.join(DIR, flag('mock') ? 'copy-features-mock.csv' : 'copy-features.csv');
    const frows = csvObjects(fs.readFileSync(fpath, 'utf8'));
    const features: Record<string, string[]> = Object.fromEntries(frows.map(r => [r.copy_id, (r.features || '').split(';').map(s => s.trim()).filter(Boolean)]));
    const featureIds = Object.keys(frows[0] || {}).filter(k => k.startsWith('p_')).map(k => k.slice(2));
    const outcomes: Array<{ id: string; label: string; ev: (a: AdRow) => number | null; platforms: Array<'meta' | 'tiktok'> }> = [
      { id: 'link_ctr', label: 'link CTR', ev: a => a.clicks, platforms: ['meta', 'tiktok'] },
      { id: 'hook_rate', label: 'hook rate (Meta 3-s plays; TikTok 2-s views) / impressions, video ads', ev: a => a.plays, platforms: ['meta', 'tiktok'] },
      { id: 'quotes_per_1k', label: 'quotes per 1,000 impressions (Checkouts initiated; confirmed by Add3, 29 Sep)', ev: a => a.checkouts, platforms: ['meta'] },
      { id: 'enrollments_per_1k', label: 'enrollments per 1,000 impressions (Meta Purchases, confirmed by Add3 29 Sep; TikTok Purchases (website), ASSUMED)', ev: a => a.purchases, platforms: ['meta', 'tiktok'] },
    ];
    const results: Array<{ platform: string; o: typeof outcomes[number]; r: BtResult }> = [];
    for (const p of ['meta', 'tiktok'] as const) {
      const cs = copies.filter(c => c.platform === p);
      // TikTok is descriptive: every copy in the fit set, no hold-out.
      const split = p === 'meta' ? { fit: new Set(cs.filter(c => c.set === 'fit').map(c => c.id)), test: new Set(cs.filter(c => c.set === 'test').map(c => c.id)) } : { fit: new Set(cs.map(c => c.id)), test: new Set<string>() };
      for (const o of outcomes.filter(o => o.platforms.includes(p))) {
        const bt: BtAd[] = ads.filter(a => a.platform === p).map(a => ({ key: a.key, copy: a.copy, region: a.region, format: a.format, wave: a.wave, placement_share: a.placement_share, impressions: a.impressions, events: o.ev(a) }));
        results.push({ platform: p, o, r: runBacktest(o.id, bt, features, featureIds, split) });
      }
    }
    writeReport(results, copies, ads, featureIds, fpath);
    return;
  }
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'));
}

function writeReport(results: Array<{ platform: string; o: { id: string; label: string }; r: BtResult }>, copies: ReturnType<typeof assignCopies>, ads: AdRow[], featureIds: string[], fpath: string) {
  const pct = (x: number | null) => (x === null ? '–' : `${x >= 1 ? '+' : '−'}${Math.abs(Math.round((x - 1) * 100))}%`);
  const rng = (lo: number | null, hi: number | null) => (lo === null ? '' : ` (range ${pct(lo)} to ${pct(hi)})`);
  const L: string[] = ['# Back-test: copy features against Trupanion\'s own results', '',
    `*${new Date().toISOString().slice(0, 10)}. Pre-registered in docs/build-log/backtest-preregistration.md (commits 054b633, c15d8b1). Client material. Observational, not randomised; text only (no images); Meta totals are whole-period. Meta conversions confirmed by Add3 (29 Sep): Checkouts initiated = a quote started, Purchases = an enrollment; attribution window unknown. TikTok Purchases (website) ≈ enrollments is an ASSUMPTION. Ranges are 90%; "clear" allows for the number of features tested per outcome.*`, '',
    `Units: ${ads.filter(a => a.platform === 'meta').length} Meta prospecting ads in ${copies.filter(c => c.platform === 'meta').length} copies (${copies.filter(c => c.set === 'fit').length} fit, ${copies.filter(c => c.set === 'test').length} test); ${ads.filter(a => a.platform === 'tiktok').length} TikTok ads in ${copies.filter(c => c.platform === 'tiktok').length} copies (descriptive). Features: ${fpath}.`, ''];
  const effRows: unknown[][] = [], ctlRows: unknown[][] = [], ceRows: unknown[][] = [];
  for (const { platform, o, r } of results) {
    L.push(`## ${platform === 'meta' ? 'Meta' : 'TikTok (descriptive)'}: ${o.label}`, '',
      `${r.ads} ads, ${r.copies} copies${platform === 'meta' ? ` (${r.fit_copies} fit, ${r.test_copies} test)` : ''}. Features tested: ${r.features_tested}. Between-ad spread (log sd) ${Math.sqrt(r.tau2_ad).toFixed(2)}, between-copy ${Math.sqrt(r.tau2_copy).toFixed(2)}; residual df ${r.residual_df}.`, '',
      '| Feature | Effect | Copies with / without (fit) | Model | Test sign | Verdict |', '|---|---|---|---|---|---|');
    for (const e of [...r.effects].sort((a, b) => (a.verdict === b.verdict ? a.term.localeCompare(b.term) : a.verdict === 'supported' ? -1 : b.verdict === 'supported' ? 1 : a.verdict === 'not supported' ? -1 : 1))) {
      const verdict = platform === 'meta' ? e.verdict : e.ratio === null ? 'not enough data' : e.clear ? 'clear (descriptive)' : 'not clear (descriptive)';
      L.push(`| ${e.term} | ${pct(e.ratio)}${rng(e.lo, e.hi)} | ${e.copies_with} / ${e.copies_without} | ${e.model} | ${e.test_sign === null ? '–' : e.test_sign > 0 ? '+' : e.test_sign < 0 ? '−' : '0'} (${e.test_with}/${e.test_without}) | ${verdict}: ${e.why} |`);
      effRows.push([platform, o.id, e.term, e.ratio ?? '', e.lo ?? '', e.hi ?? '', e.copies_with, e.copies_without, e.model, e.clear, e.test_sign ?? '', e.test_with, e.test_without, verdict, e.why]);
    }
    L.push('', 'Controls (context, not tests):', '');
    for (const c of r.controls) {
      // A control that only varies inside one copy can't be separated from that copy's effect.
      const lost = !Number.isFinite(c.hi) || c.hi / Math.max(c.lo, 1e-12) > 1000;
      L.push(`- ${c.term}: ${lost ? 'can\'t be separated from the copy it appears with' : `${pct(c.ratio)}${rng(c.lo, c.hi)}`}`);
      ctlRows.push([platform, o.id, c.term, lost ? '' : c.ratio, lost ? '' : c.lo, lost ? '' : c.hi]);
    }
    for (const c of r.copy_effects) ceRows.push([platform, o.id, c.copy, c.set, c.ads, Math.exp(c.effect), Math.exp(c.effect - 1.645 * c.se), Math.exp(c.effect + 1.645 * c.se)]);
    L.push('');
  }
  // Cost per purchase, descriptive only.
  L.push('## Cost per enrollment by copy (descriptive only, never a test; TikTok enrollments are an ASSUMPTION)', '', '| Copy | Platform | Ads | Spend | Enrollments | Cost per enrollment |', '|---|---|---|---|---|---|');
  for (const c of copies) {
    const mine = ads.filter(a => a.copy === c.id && a.platform === c.platform);
    const spend = mine.reduce((s, a) => s + a.spend, 0), pur = mine.reduce((s, a) => s + (a.purchases ?? 0), 0);
    L.push(`| ${c.id} | ${c.platform} | ${mine.length} | $${Math.round(spend).toLocaleString('en-US')} | ${pur} | ${pur >= 5 ? `$${(spend / pur).toFixed(2)}` : `too few to read (${pur})`} |`);
  }
  fs.writeFileSync(path.join(DIR, 'backtest-report.md'), L.join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, 'effects.csv'), toCsv(['platform', 'outcome', 'feature', 'ratio', 'lo90', 'hi90', 'fit_copies_with', 'fit_copies_without', 'model', 'clear_after_allowance', 'test_sign', 'test_with', 'test_without', 'verdict', 'why'], effRows));
  fs.writeFileSync(path.join(DIR, 'controls.csv'), toCsv(['platform', 'outcome', 'term', 'ratio', 'lo90', 'hi90'], ctlRows));
  fs.writeFileSync(path.join(DIR, 'copy-effects.csv'), toCsv(['platform', 'outcome', 'copy_id', 'set', 'ads', 'relative_rate', 'lo90', 'hi90'], ceRows));
  const sum = (p: string, v: string) => results.filter(x => x.platform === p).reduce((s, x) => s + x.r.effects.filter(e => e.verdict === v).length, 0);
  console.log(`Meta: ${sum('meta', 'supported')} supported, ${sum('meta', 'not supported')} not supported, ${sum('meta', 'not enough data')} not enough data (feature × outcome).`);
  for (const { platform, o, r } of results) for (const e of r.effects.filter(e => e.verdict === 'supported' || (platform === 'tiktok' && e.clear))) console.log(`  ${platform} ${o.id}: ${e.term} ${pct(e.ratio)}${rng(e.lo, e.hi)} ${platform === 'meta' ? 'supported' : 'clear (descriptive)'}`);
  console.log(`Wrote ${path.join(DIR, 'backtest-report.md')}, effects.csv, controls.csv, copy-effects.csv`);
}

function loadKey(): string {
  const keyFile = path.join(process.env.HOME || '', '.config/voices/openai.key');
  if (fs.existsSync(keyFile)) { const k = fs.readFileSync(keyFile, 'utf8').trim(); if (k.length > 20) return k; }
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  // backend/.env, this one line only; never dotenv (its DATABASE_URL is production).
  const env = path.resolve(__dirname, '../.env');
  const m = fs.existsSync(env) ? /^OPENAI_API_KEY\s*=\s*(.*)$/m.exec(fs.readFileSync(env, 'utf8')) : null;
  const k = m?.[1].trim().replace(/^['"]|['"]$/g, '') || '';
  if (k.length > 20 && !k.includes('...')) return k;
  throw new Error('No OpenAI key');
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
