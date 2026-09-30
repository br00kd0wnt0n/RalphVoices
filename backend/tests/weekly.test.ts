// B3 weekly read: naming, ingest, model and note. Pure modules only (no
// database, no network); the simulation supplies data with known answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/services/weekly/config.js';
import { parseAdName, normalizeStub } from '../src/services/weekly/naming.js';
import { parseCsv, toCsv } from '../src/services/weekly/csv.js';
import { mapColumns, parseExport, classifyAudience, loadFeatureCsv, parseNumber, parseDay } from '../src/services/weekly/ingest.js';
import { aggregate, fromIngest, weekOf, addDays, historicParse, type MetricRow } from '../src/services/weekly/window.js';
import { readWeek, type AdData, type Read } from '../src/services/weekly/model.js';
import { simulate, checkRecovery } from '../src/services/weekly/simulate.js';
import { draftNote, lintNote, newNumbers, APPENDIX_MARKER, readableLabel, personaHeadline, actions } from '../src/services/weekly/note.js';
import { rng, beta } from '../src/services/weekly/stats.js';
import { readSeries } from '../src/services/weekly/series.js';

const cfg = loadConfig();
const N = cfg.naming;

// ---------- naming ----------

test('the canonical name parses to its parts and stub', () => {
  const r = parseAdName('FAM_SUMMER_ST_v2_META_261013', N);
  assert.ok(r.ok);
  assert.deepEqual({ p: r.persona, t: r.territory, f: r.format, v: r.version, pl: r.platform, d: r.date, stub: r.stub, asset: r.asset },
    { p: 'FAM', t: 'SUMMER', f: 'ST', v: 2, pl: 'META', d: '2026-10-13', stub: 'FAM_SUMMER_ST_v2_META', asset: 'FAM_SUMMER_ST' });
  assert.deepEqual(r.warnings, []);
});

test('case, stray spaces, long format names, suffixes and Meta copies all parse to the same stub', () => {
  const variants = [
    'fam_summer_st_v2_meta_261013',
    '  FAM_SUMMER_ST_v2_META_261013 ',
    'FAM _ SUMMER_ST_v2 _META_261013',
    'FAM SUMMER ST v2 META 261013',
    'FAM_SUMMER_STATIC_V2_META_261013',
    'FAM_SUMMER_ST_v2_META_261013_L2',
    'FAM_SUMMER_ST_v2_META_261013 - Copy',
    'FAM_SUMMER_ST_v2_META_261013 – Copy 2',
    'FAM_SUMMER_ST_v2_META_20261013',
    'FAM_FAM_SUMMER_ST_v2_META_261013',
    'FAM__SUMMER_ST_v2_META_261013',
  ];
  for (const v of variants) {
    const r = parseAdName(v, N);
    assert.ok(r.ok, `${v}: ${!r.ok && r.reason}`);
    assert.equal(r.stub, 'FAM_SUMMER_ST_v2_META', v);
  }
  const suf = parseAdName('FAM_SUMMER_ST_v2_META_261013_L2', N);
  assert.ok(suf.ok && suf.suffix.join() === 'L2' && suf.warnings.some(w => w.includes('extra suffix')));
  const copy = parseAdName('FAM_SUMMER_ST_v2_META_261013 - Copy', N);
  assert.ok(copy.ok && copy.suffix.includes('COPY') && copy.warnings.some(w => w.includes('Copy')));
});

test('territories may contain underscores; TT is read as format or platform by position', () => {
  const r = parseAdName('CUR_ASK_YOUR_VET_TT_v1_TT_261020', N);
  assert.ok(r.ok);
  assert.equal(r.territory, 'ASK_YOUR_VET');
  assert.equal(r.format, 'TT');
  assert.equal(r.platform, 'TT');
  const t = parseAdName('DINK_IDIOT_VID_v3_TIKTOK_261020', N);
  assert.ok(t.ok && t.platform === 'TT' && t.warnings.includes('platform written as TIKTOK'));
});

test('a missing date parses with a warning; everything else wrong is quarantined with a reason', () => {
  const nd = parseAdName('DINK_IDIOT_ST_v1_META', N);
  assert.ok(nd.ok && nd.date === null && nd.warnings.includes('no delivery date (YYMMDD)'));
  const bad: Array<[string, RegExp]> = [
    ['DOG_SUMMER_ST_v1_META_261013', /persona "DOG"/],
    ['FAM_SUMMER_GIF_v1_META_261013', /format "GIF"/],
    ['FAM_SUMMER_ST_v1_YT_261013', /platform "YT"/],
    ['FAM_SUMMER_ST_v1_META_261341', /date "261341"/],
    ['FAM_SUMMER_ST_META_261013', /no version/],
    ['FAM_ST_v1_META_261013', /no territory/],
    ['Trupanion_Static_Summer_v1', /only 4 parts/],
    ['', /empty/],
  ];
  for (const [name, re] of bad) {
    const r = parseAdName(name, N);
    assert.equal(r.ok, false, name);
    assert.match((r as any).reason, re, name);
  }
});

test('Studio stubs (STATIC, CAROUSEL) normalise to the ad-name stub', () => {
  assert.equal(normalizeStub('DINK_IDIOT_STATIC_v1_META', N), 'DINK_IDIOT_ST_v1_META');
  assert.equal(normalizeStub('DINK_UNEXPECTED_CAROUSEL_v3_META', N), 'DINK_UNEXPECTED_CAR_v3_META');
  assert.equal(normalizeStub('nonsense', N), null);
});

// ---------- CSV and ingest ----------

test('CSV reader handles quotes, commas, newlines, BOM and CRLF; writer round-trips', () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line\nbreak"\r\n,,\r\n1,2,3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'say "hi"', 'line\nbreak'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv(toCsv(['a', 'b'], [['x, y', 'q"q']])), [['a', 'b'], ['x, y', 'q"q']]);
});

test('column mapping: aliases, currency suffix prefix match, exact before prefix, missing reported', () => {
  const m = mapColumns(['Ad Name', 'Amount spent (USD)', 'Impressions', 'Quote starts', 'Quote start rate', 'Cost per quote', 'Link clicks', 'Weird'], cfg.columns.meta);
  assert.equal(m.mapped.ad_name, 'Ad Name');
  assert.equal(m.mapped.spend, 'Amount spent (USD)');
  assert.equal(m.mapped.quotes, 'Quote starts');
  assert.ok(m.missing.includes('enrollments'));
  assert.ok(m.unmapped_headers.includes('Weird') && m.unmapped_headers.includes('Cost per quote'));
});

test('numbers and dates in export formats', () => {
  assert.equal(parseNumber('$1,234.50'), 1234.5);
  assert.equal(parseNumber('1.2%'), 1.2);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('—'), null);
  assert.equal(parseDay('2026-10-13'), '2026-10-13');
  assert.equal(parseDay('10/13/2026'), '2026-10-13');
  assert.equal(parseDay('13/13/2026'), null);
});

test('audience rule: retargeting wins, prospecting by pattern, otherwise unknown', () => {
  const a = cfg.audience;
  assert.equal(classifyAudience('Trupanion_Ralph_Prospecting_META', 'FAM_META', a), 'prospecting');
  assert.equal(classifyAudience('Trupanion_RT_META', 'FAM', a), 'retargeting');
  assert.equal(classifyAudience('Trupanion Prospecting', 'FAM retargeting', a), 'retargeting');
  assert.equal(classifyAudience('Trupanion Q4', 'FAM', a), 'unknown');
  assert.equal(classifyAudience('Trupanion Q4', 'ARTS_DEPT', a), 'unknown', 'RT inside a word is not a match');
});

const HEAD = ['Day', 'Campaign name', 'Ad set name', 'Ad name', 'Amount spent (USD)', 'Impressions', 'Link clicks', 'Quotes'];
test('ingest quarantines bad names and wrong platforms, skips totals, sums breakdown rows, joins features', () => {
  const csv = toCsv(HEAD, [
    ['2026-10-13', 'Ralph Prospecting', 'FAM_META', 'FAM_SUMMER_ST_v1_META_261013', '10.00', '1000', '12', '1'],
    ['2026-10-13', 'Ralph Prospecting', 'FAM_META', 'FAM_SUMMER_ST_v1_META_261013', '5.00', '500', '3', '0'],
    ['2026-10-13', 'Ralph Prospecting', 'FAM_META', 'FAM_SUMMER_ST_v1_TT_261013', '5.00', '500', '3', '0'],
    ['2026-10-13', 'Ralph Prospecting', 'FAM_META', 'Summer static', '5.00', '700', '3', '0'],
    ['', '', '', '', '25.00', '2700', '', ''],
  ]);
  const feats = loadFeatureCsv(toCsv(['stub', 'features', 'angle'], [['FAM_SUMMER_STATIC_v1_META', 'humour; dollar_figure', 'FAM_A1 The label']]), 'shortlist', cfg).map;
  const r = parseExport(csv, 'meta', cfg, feats);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.rows.length, 3);
  const ok = r.rows.find(x => x.ad_name === 'FAM_SUMMER_ST_v1_META_261013')!;
  assert.equal(ok.impressions, 1500, 'breakdown rows for the same ad and day are summed');
  assert.equal(ok.link_clicks, 15);
  assert.deepEqual(ok.features, ['angle:FAM_A1', 'dollar_figure', 'humour']);
  assert.ok(r.warnings[0].includes('summed'));
  assert.deepEqual(r.quarantine.map(q => q.ad_name).sort(), ['FAM_SUMMER_ST_v1_TT_261013', 'Summer static']);
  assert.match(r.quarantine.find(q => q.ad_name === 'FAM_SUMMER_ST_v1_TT_261013')!.reason, /doesn't match this meta export/);
  assert.equal(r.quotes_available, true);
  // Same input, same output (the database layer upserts on the same keys).
  assert.deepEqual(parseExport(csv, 'meta', cfg, feats).rows.map(x => [x.ad_name, x.impressions]), r.rows.map(x => [x.ad_name, x.impressions]));
});

test('an export without a quote column reads, and says quotes are unavailable', () => {
  const csv = toCsv(HEAD.slice(0, 7), [['2026-10-13', 'Ralph Prospecting', 'FAM_META', 'FAM_SUMMER_ST_v1_META_261013', '10.00', '1000', '12']]);
  const r = parseExport(csv, 'meta', cfg);
  assert.equal(r.quotes_available, false);
  assert.equal(r.rows[0].quotes, null);
  assert.equal(r.rows[0].features, null, 'no feature record means unknown, not empty');
});

// ---------- window ----------

test('weeks run Monday to Sunday; overlapping coarser rows are dropped', () => {
  assert.deepEqual(weekOf('2026-10-14'), { start: '2026-10-12', end: '2026-10-18' });
  assert.deepEqual(weekOf('2026-10-18'), { start: '2026-10-12', end: '2026-10-18' });
  const base: Omit<MetricRow, 'period_start' | 'period_end' | 'impressions'> = {
    key: 'k', ad_name: 'FAM_SUMMER_ST_v1_META_261013', audience: 'prospecting', quarantine_reason: null, features: [],
    parsed: { stub: 'FAM_SUMMER_ST_v1_META', asset: 'FAM_SUMMER_ST', persona: 'FAM', territory: 'SUMMER', format: 'ST', platform: 'META', version: 1 },
    spend: 1, video_3s: null, link_clicks: 1, landing_page_views: null, quotes: 0, enrollments: 0,
  };
  const rows: MetricRow[] = [
    ...[0, 1, 2, 3, 4, 5, 6].map(i => ({ ...base, period_start: addDays('2026-10-12', i), period_end: addDays('2026-10-12', i), impressions: 100 })),
    { ...base, period_start: '2026-10-12', period_end: '2026-10-18', impressions: 700 },
  ];
  const w = aggregate(rows, '2026-10-12', '2026-10-18');
  assert.equal(w.ads[0].impressions, 700);
  assert.equal(w.overlaps_dropped, 1);
  assert.equal(w.ads[0].days_live, 7);
});

// ---------- stats ----------

test('seeded draws repeat exactly; beta draws have the right mean', () => {
  const a = rng(1), b = rng(1);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  const r = rng(9);
  let s = 0;
  for (let i = 0; i < 4000; i++) s += beta(r, 30, 70);
  assert.ok(Math.abs(s / 4000 - 0.3) < 0.005);
});

// ---------- model on simulated data ----------

function simRead(scenario: 'month1' | 'thin' | 'null', seed: number, quotes = true): { read: Read; sim: ReturnType<typeof simulate> } {
  const sim = simulate(scenario, seed);
  const fm = loadFeatureCsv(sim.features_csv, 'sim', cfg).map;
  let meta = sim.meta_csv, tt = sim.tiktok_csv;
  if (!quotes) { meta = meta.replace(',Quotes,', ',Q_dropped,'); tt = tt.replace(',Quotes,', ',Q_dropped,'); }
  const exp = [parseExport(meta, 'meta', cfg, fm), parseExport(tt, 'tiktok', cfg, fm)];
  const to = addDays(sim.truth.start, sim.truth.days - 1);
  const w = aggregate([...exp[0].rows, ...exp[1].rows].map(fromIngest), sim.truth.start, to);
  return { read: readWeek(w.ads, cfg, { from: sim.truth.start, to, quotesAvailable: exp[0].quotes_available }), sim };
}

test('simulation plumbing: planted bad names are quarantined, cosmetic variants parse, retargeting is left out', () => {
  const sim = simulate('month1', 3);
  const fm = loadFeatureCsv(sim.features_csv, 'sim', cfg).map;
  const r = parseExport(sim.meta_csv, 'meta', cfg, fm);
  assert.deepEqual(r.quarantine.map(q => q.ad_name).sort(), sim.truth.planted_bad_names.map(b => b.ad_name).sort());
  for (const c of sim.truth.cosmetic_names) {
    const row = r.rows.find(x => x.ad_name === c.ad_name.trim())!;
    assert.ok(row.name.ok && row.name.stub === c.stub, c.ad_name);
    assert.ok(row.features, `features join for ${c.ad_name}`);
  }
  const w = aggregate(r.rows.map(fromIngest), sim.truth.start, addDays(sim.truth.start, 27));
  assert.equal(w.left_out.retargeting.ads, 3);
  assert.equal(w.left_out.quarantined.ads, 4);
});

test('same data, same read (seeded Monte Carlo)', () => {
  const a = simRead('month1', 5).read, b = simRead('month1', 5).read;
  assert.deepEqual(a.ads.map(x => [x.stub, x.headline.call, x.metrics.link_ctr?.p_best]), b.ads.map(x => [x.stub, x.headline.call, x.metrics.link_ctr?.p_best]));
});

test('P(best) sums to 1 within each ad set', () => {
  const { read } = simRead('month1', 11);
  for (const c of read.cells) {
    const s = read.ads.filter(a => a.cell === c.cell && a.metrics.link_ctr?.p_best != null).reduce((t, a) => t + a.metrics.link_ctr!.p_best!, 0);
    if (s) assert.ok(Math.abs(s - 1) < 1e-9, `${c.cell}: ${s}`);
  }
});

test('Month-1 volumes: large planted effects recovered with ranges covering the truth; no false clear calls', () => {
  const { read, sim } = simRead('month1', 42);
  const rec = checkRecovery(read, sim.truth);
  const get = (what: string, m: string) => rec.rows.find(r => r.what === what && r.metric === m)!;
  assert.equal(get('feature dollar_figure', 'link_ctr').status, 'recovered');
  assert.equal(get('feature member_testimony', 'quotes_per_1k').status, 'recovered');
  assert.equal(get('format UGC vs ST', 'link_ctr').status, 'not enough data', 'one UGC asset cannot show a format effect');
  for (const r of rec.rows.filter(r => r.size === 'none')) assert.equal(r.status, 'correctly not called', `${r.what} ${r.metric}`);
  for (const r of rec.rows.filter(r => r.size === 'small')) assert.ok(r.status !== 'CLEAR BUT RANGE MISSES TRUTH', `${r.what} ${r.metric}`);
  assert.equal(rec.rows.filter(r => !r.ok).length, 0, rec.summary.join('\n'));
  // The planted standout ad is called scale.
  assert.equal(read.ads.find(a => a.stub === sim.truth.standout!.stub)!.headline.call, 'scale');
});

test('over many seeds: scale calls go to a true top-two ad and false clear effects stay rare', () => {
  let scale = 0, top2 = 0, falseClear = 0, cut = 0, cutBottom = 0;
  for (let s = 1; s <= 8; s++) {
    const { read, sim } = simRead('month1', 1000 + s);
    const rec = checkRecovery(read, sim.truth);
    for (const c of rec.calls) {
      if (c.call.startsWith('scale')) { scale++; if (c.true_rank <= 2) top2++; }
      if (c.call === 'cut') { cut++; if (c.true_rank > c.cell_size / 2) cutBottom++; }
    }
    falseClear += rec.rows.filter(r => !r.ok).length;
  }
  assert.ok(top2 / scale >= 0.85, `${top2}/${scale} scale calls in the true top two`);
  assert.ok(cutBottom / cut >= 0.9, `${cutBottom}/${cut} cuts in the true bottom half`);
  assert.ok(falseClear <= 2, `${falseClear} false clear effects in 8 reads`);
});

test('a thin week (a few thousand impressions per ad) is too early to call, with no clear effects', () => {
  const { read } = simRead('thin', 7);
  assert.ok(read.ads.every(a => a.impressions < 10000));
  assert.ok(read.ads.every(a => a.headline.call === 'too early to call'), read.ads.map(a => a.headline.call).join());
  assert.ok([...read.features, ...read.formats, ...read.persona_features].every(e => !e.verdict.startsWith('clear')));
});

test('no true differences: no clear effects and almost no calls', () => {
  let calls = 0, clear = 0, ads = 0;
  for (let s = 1; s <= 5; s++) {
    const { read } = simRead('null', 500 + s);
    ads += read.ads.length;
    calls += read.ads.filter(a => a.headline.call !== 'keep testing' && a.headline.call !== 'too early to call').length;
    clear += [...read.features, ...read.formats].filter(e => e.verdict.startsWith('clear')).length;
  }
  assert.ok(calls <= 3, `${calls} calls in ${ads} ad reads`);
  assert.ok(clear <= 1, `${clear} clear effects`);
});

test('without a quote column, clicks can support a cut but never a scale', () => {
  const { read } = simRead('month1', 42, false);
  assert.equal(read.metrics_available.quotes_per_1k, false);
  assert.ok(read.notes.some(n => n.includes('No quote column')));
  assert.ok(read.ads.every(a => !a.headline.call.startsWith('scale')));
  assert.ok(read.ads.some(a => a.headline.call === 'cut' && a.headline.metric === 'link_ctr'));
  assert.ok(read.ads.some(a => /scaling waits for quotes/.test(a.headline.reason)));
});

test('a cell with one readable ad has nothing to compare: keep testing, not scale', () => {
  const ad = (k: string, imps: number, clicks: number, quotes: number): AdData => ({
    key: k, ad_name: k, stub: k, asset: k, persona: 'DINK', territory: 'X', format: 'ST', platform: 'META', version: 1, features: null,
    first_day: '2026-10-12', last_day: '2026-10-25', days_live: 14, live_now: true, spend: imps / 100, impressions: imps, video_3s: 0,
    link_clicks: clicks, landing_page_views: 0, quotes, enrollments: 0,
  });
  const read = readWeek([ad('A', 60000, 900, 60), ad('B', 3000, 45, 2)], cfg, { from: '2026-10-12', to: '2026-10-25', quotesAvailable: true });
  const a = read.ads.find(x => x.key === 'A')!, b = read.ads.find(x => x.key === 'B')!;
  assert.equal(a.headline.call, 'keep testing');
  assert.match(a.headline.reason, /only 1 ad with enough data in this ad set/);
  assert.equal(b.headline.call, 'too early to call');
});

// ---------- note ----------

function noteFor(seed: number, audience: 'internal' | 'client' = 'internal') {
  const { read } = simRead('month1', seed);
  const sim = simulate('month1', seed);
  const w = aggregate([...parseExport(sim.meta_csv, 'meta', cfg).rows].map(fromIngest), '2026-10-12', '2026-11-08');
  return { read, ...draftNote(read, { week: { start: '2026-11-02', end: '2026-11-08' }, since: '2026-10-12', window: w, prev: null, week_impressions: new Map(), sources: ['sim'] }, cfg, { audience }) };
}

test('the internal note: one plain-English screen, then the appendix; passes its own wording rules', () => {
  const { markdown, ledger, read } = noteFor(42);
  assert.deepEqual(lintNote(markdown, cfg), []);
  const [front, appendix] = markdown.split(APPENDIX_MARKER);
  assert.ok(appendix, 'has an appendix');
  for (const p of cfg.naming.personas) assert.ok(front.includes(`## ${p}`));
  assert.ok(front.includes('**Across the account:**'));
  for (const t of ['P(', 'cell', 'median', 'draws']) assert.ok(!front.includes(t), `"${t}" is kept out of the first screen`);
  for (const p of cfg.naming.personas) {
    const sec = front.split(`## ${p}`)[1].split('\n## ')[0];
    assert.ok((sec.match(/^\d+\. /gm) || []).length <= 3, `${p}: at most 3 actions`);
  }
  assert.ok(front.split('\n').length < 40, `first screen is ${front.split('\n').length} lines`);
  assert.ok(appendix.includes('How sure we are') && appendix.includes('No cost benchmark yet'));
  assert.ok(ledger.split('\n')[0].startsWith('week_start,week_end'));
  assert.ok(ledger.split('\n').length > read.ads.length * 2);
});

test('the client variant is the first screen only, with the same wording rules', () => {
  const { markdown } = noteFor(42, 'client');
  assert.deepEqual(lintNote(markdown, cfg), []);
  assert.ok(!markdown.includes(APPENDIX_MARKER) && !markdown.includes('Appendix'));
  assert.ok(!/P\(|config v|Brook|quarantin|draft/i.test(markdown));
  assert.ok(markdown.includes('**Across the account:**'));
});

test('cost per enrollment is hidden below the minimum enrollments', () => {
  const { markdown, read } = noteFor(42);
  const few = read.ads.find(a => a.enrollments < cfg.report.min_enrollments_for_cpe)!;
  assert.ok(few, 'the simulation has an ad with few enrollments');
  const row = markdown.split('\n').find(l => l.startsWith(`| ${few.stub}`))!;
  assert.ok(row.includes(`too few enrollments to read (${few.enrollments})`), row);
});

test('wording lint catches banned words (and their forms), internal terms up front, and rates without ranges', () => {
  const md = ['The winner is FAM_SUMMER.', 'CTR was 1.4% this week.', 'CTR 1.4% (range 1.2%–1.6%).', 'Our model predicts growth.', 'Effect +34% (range +13% to +60%).', 'The cell leader.', 'Scale X <sub>X_STUB</sub>.', APPENDIX_MARKER, 'P(best) 86% and P(worse than median) 3%; the cell leader.'].join('\n');
  assert.deepEqual(lintNote(md, cfg).map(i => [i.line, i.rule]), [[1, 'banned word "winner"'], [2, 'rate without a range'], [4, 'banned word "predicts"'], [6, 'internal term "cell" before the appendix'], [7, 'HTML tag before the appendix (it shows literally when pasted into email or Docs)']]);
});

test('the prose guard rejects any number, or number word, not in the source', () => {
  const src = 'FAM_SUMMER_ST_v2_META: link CTR 2.80% (range 2.73%–2.88%); P(best in ad set) 100%; 127,509 impressions.';
  assert.deepEqual(newNumbers('FAM_SUMMER leads on link CTR at 2.80% (range 2.73%–2.88%) from 127509 impressions.', src), []);
  assert.deepEqual(newNumbers('Link CTR is 2.8%, about 3% higher than last week.', src), ['3']);
  assert.deepEqual(newNumbers('CTR doubled to 2.80%.', src), ['doubled']);
  assert.deepEqual(newNumbers('Twice as many clicks.', src), ['twice']);
});

test('historic mode keeps ads outside the convention for the back-test, and joins audit features by ad name', () => {
  const csv = toCsv([...HEAD, '3-second video plays'], [
    ['2026-03-10', 'Trupanion Prospecting US', 'Broad', 'Zoomie Wipeouts', '50.00', '20000', '300', '12', ''],
    ['2026-03-10', 'Trupanion Prospecting US', 'Broad', 'Vet Bills UGC', '50.00', '15000', '260', '9', '4000'],
  ]);
  const feats = loadFeatureCsv(toCsv(['ad_name', 'features'], [['Zoomie Wipeouts', 'humour; dollar_figure']]), 'audit', cfg).map;
  const r = parseExport(csv, 'meta', cfg, feats);
  assert.equal(r.quarantine.length, 2, 'still quarantined by the weekly rules');
  assert.deepEqual(r.rows.find(x => x.ad_name === 'Zoomie Wipeouts')!.features, ['dollar_figure', 'humour']);
  const rows = r.rows.map(fromIngest);
  assert.equal(aggregate(rows, '2026-03-01', '2026-03-31').ads.length, 0);
  const h = aggregate(rows, '2026-03-01', '2026-03-31', { historic: true });
  assert.deepEqual(h.ads.map(a => [a.persona, a.format, a.stub]).sort(), [['HIST', 'ST', 'Zoomie Wipeouts'], ['HIST', 'UGC', 'Vet Bills UGC']]);
  assert.equal(rows[0].parsed, null, 'input rows are not modified');
});

// ---------- hysteresis (config calls.hold) ----------

const hAd = (k: string, quotes: number): AdData => ({
  key: k, ad_name: k, stub: k, asset: k, persona: 'DINK', territory: 'X', format: 'ST', platform: 'META', version: 1, features: null,
  first_day: '2026-10-12', last_day: '2026-10-25', days_live: 14, live_now: true, spend: 600, impressions: 60000, video_3s: 0,
  link_clicks: 900, landing_page_views: 0, quotes, enrollments: 0,
});
const hOpts = { from: '2026-10-12', to: '2026-10-25', quotesAvailable: true };
const qCall = (r: Read, k: string) => r.ads.find(a => a.key === k)!.metrics.quotes_per_1k!;

test('a scale holds while P(best) stays above the hold bar, and only if it was scaled last week', () => {
  const now = [hAd('A', 46), hAd('B', 36), hAd('C', 36)];
  const fresh = readWeek(now, cfg, hOpts);
  const p = qCall(fresh, 'A').p_best!;
  assert.ok(p >= cfg.calls.hold.p_best_scale && p < cfg.calls.p_best_scale, `P(best) ${p} sits between the bars`);
  assert.equal(qCall(fresh, 'A').call, 'keep testing', 'not enough to start a scale');
  const lastWeek = readWeek([hAd('A', 60), hAd('B', 36), hAd('C', 36)], cfg, hOpts);
  assert.equal(qCall(lastWeek, 'A').call, 'scale');
  const held = readWeek(now, cfg, { ...hOpts, prev: lastWeek });
  assert.equal(qCall(held, 'A').call, 'scale');
  assert.match(qCall(held, 'A').reason, /held from last week/);
  assert.equal(held.ads.find(a => a.key === 'A')!.headline.call, 'scale');
  // Evidence falls below the hold bar: the scale drops.
  assert.equal(qCall(readWeek([hAd('A', 38), hAd('B', 36), hAd('C', 36)], cfg, { ...hOpts, prev: lastWeek }), 'A').call, 'keep testing');
});

test('a cut holds while P(worse than median) stays above the hold bar', () => {
  const now = [hAd('B', 36), hAd('C', 36), hAd('A', 24)];
  const fresh = readWeek(now, cfg, hOpts);
  const p = qCall(fresh, 'A').p_worse_than_median!;
  assert.ok(p >= cfg.calls.hold.p_worse_than_median_cut && p < cfg.calls.p_worse_than_median_cut, `P(worse) ${p} sits between the bars`);
  assert.equal(qCall(fresh, 'A').call, 'keep testing');
  const lastWeek = readWeek([hAd('B', 36), hAd('C', 36), hAd('A', 12)], cfg, hOpts);
  assert.equal(qCall(lastWeek, 'A').call, 'cut');
  assert.equal(qCall(readWeek(now, cfg, { ...hOpts, prev: lastWeek }), 'A').call, 'cut');
});

test('hold bars cut week-to-week reversals in a simulated month without losing accuracy', () => {
  const noHold = { ...cfg, calls: { ...cfg.calls, hold: { p_best_scale: cfg.calls.p_best_scale, p_beat_median_tied_scale: cfg.calls.p_beat_median_tied_scale, p_worse_than_median_cut: cfg.calls.p_worse_than_median_cut } } };
  const count = (c: typeof cfg) => {
    let reversals = 0;
    for (let s = 1; s <= 6; s++) {
      const sim = simulate('month1', 2000 + s);
      const fm = loadFeatureCsv(sim.features_csv, 'sim', c).map;
      const rows = [...parseExport(sim.meta_csv, 'meta', c, fm).rows, ...parseExport(sim.tiktok_csv, 'tiktok', c, fm).rows].map(fromIngest);
      const { reads } = readSeries(rows, sim.truth.start, addDays(sim.truth.start, 27), c, { quotesAvailable: true });
      const g = (x: string) => (x.startsWith('scale') ? 'scale' : x);
      for (let w = 2; w < reads.length; w++) for (const a of reads[w].ads) {
        const b = reads[w - 1].ads.find(x => x.key === a.key), c0 = reads[w - 2].ads.find(x => x.key === a.key);
        if (b && c0 && g(a.headline.call) !== g(b.headline.call) && g(a.headline.call) === g(c0.headline.call)) reversals++;
      }
    }
    return reversals;
  };
  const without = count(noHold), withHold = count(cfg);
  assert.ok(withHold < without, `reversals ${withHold} with holds vs ${without} without`);
});

// ---------- ties and calls agree; small ad sets ----------

test('an ad is never scaled while tied with an ad outside its scale, and never cut while tied with the leader', () => {
  // A has P(best) above 0.8 but fewer than 9 in 10 draws put it ahead of B: under the old
  // rules A was "scale" with its range overlapping B's. Now A and B are a tied pair.
  const r = readWeek([hAd('A', 70), hAd('B', 58), hAd('C', 30), hAd('D', 30)], cfg, hOpts);
  const A = qCall(r, 'A'), B = qCall(r, 'B');
  assert.ok(A.p_best! >= cfg.calls.p_best_scale && A.p_ahead.B < cfg.calls.tie_bar, `P(best) ${A.p_best}, P(A>B) ${A.p_ahead.B}`);
  assert.equal(A.call, 'scale (tied)');
  assert.equal(B.call, 'scale (tied)');
  assert.deepEqual(A.tied_with, ['B']);
  assert.equal(qCall(r, 'C').call, 'cut');
  // Across simulated months, every week: the property holds for every ad set and metric.
  for (let s = 1; s <= 4; s++) {
    const sim = simulate('month1', 3000 + s);
    const fm = loadFeatureCsv(sim.features_csv, 'sim', cfg).map;
    const rows = [...parseExport(sim.meta_csv, 'meta', cfg, fm).rows, ...parseExport(sim.tiktok_csv, 'tiktok', cfg, fm).rows].map(fromIngest);
    for (const read of readSeries(rows, sim.truth.start, addDays(sim.truth.start, 27), cfg, { quotesAvailable: true }).reads) {
      for (const cell of new Set(read.ads.map(a => a.cell))) for (const m of ['link_ctr', 'quotes_per_1k'] as const) {
        const rd = read.ads.filter(a => a.cell === cell && a.metrics[m]?.readable);
        const scaled = rd.filter(a => a.metrics[m]!.call.startsWith('scale'));
        for (const x of scaled) for (const y of rd.filter(y => !scaled.includes(y)))
          assert.ok(!x.metrics[m]!.tied_with.includes(y.stub) && !y.metrics[m]!.tied_with.includes(x.stub), `${x.stub} scaled but tied with ${y.stub}`);
        const leader = scaled[0] ?? [...rd].sort((p, q) => (q.metrics[m]!.p_best ?? 0) - (p.metrics[m]!.p_best ?? 0))[0];
        for (const y of rd.filter(y => y.metrics[m]!.call === 'cut'))
          assert.ok(!leader.metrics[m]!.tied_with.includes(y.stub), `${y.stub} cut but tied with the leader ${leader.stub}`);
      }
    }
  }
});

test('an ad set with fewer than 3 readable ads gets no scale or cut, and says why', () => {
  const r = readWeek([hAd('A', 90), hAd('B', 30)], cfg, hOpts);
  for (const k of ['A', 'B']) {
    assert.equal(qCall(r, k).call, 'keep testing');
    assert.match(qCall(r, k).reason, /only 2 ads with enough data in this ad set; a scale or cut needs 3/);
  }
  const { read } = simRead('month1', 42);
  assert.ok(read.ads.filter(a => a.platform === 'TT').every(a => !['scale', 'scale (tied)', 'cut'].includes(a.headline.call)), 'the 2-ad TikTok ad sets are never called');
  const { markdown } = noteFor(42);
  assert.ok(markdown.split(APPENDIX_MARKER)[0].includes('The TikTok ad set has too few ads to call'));
});

// ---------- database (opt-in: WEEKLY_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_b3_test) ----------

const TEST_DB = process.env.WEEKLY_TEST_DATABASE_URL;
test('database: 016 twice, idempotent ingest, stored reads, latest read per stub', { skip: !TEST_DB && 'set WEEKLY_TEST_DATABASE_URL to a local test database' }, async () => {
  const { default: pg } = await import('pg');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const store = await import('../src/services/weekly/store.js');
  assert.ok(/@(127\.0\.0\.1|localhost)[:/]/.test(TEST_DB!), 'local databases only');
  pg.types.setTypeParser(1082, (v: string) => v);
  const pool = new pg.Pool({ connectionString: TEST_DB });
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/016_live_performance.sql'), 'utf8');
    await pool.query(sql); await pool.query(sql);
    await pool.query('TRUNCATE live_reads, live_metrics, live_ads, live_ingests RESTART IDENTITY CASCADE');
    const sim = simulate('month1', 42);
    const fm = loadFeatureCsv(sim.features_csv, 'sim', cfg).map;
    const exp = parseExport(sim.meta_csv, 'meta', cfg, fm);
    const first = await store.saveExport(pool, { name: 'meta.csv', sha256: 'x' }, exp, cfg.version);
    const again = await store.saveExport(pool, { name: 'meta.csv', sha256: 'x' }, exp, cfg.version);
    assert.equal(first.metrics_inserted, exp.rows.length);
    assert.equal(again.metrics_inserted, 0);
    assert.equal(again.metrics_updated, exp.rows.length);
    const rows = await store.loadRows(pool);
    assert.equal(rows.length, exp.rows.length);
    const { read, reads } = readSeries(rows, '2026-10-12', '2026-11-08', cfg, { quotesAvailable: true });
    await store.saveReads(pool, reads[0], { start: '2026-10-12', end: '2026-10-18' }, '2026-10-12', cfg.version);
    const n = await store.saveReads(pool, read, { start: '2026-11-02', end: '2026-11-08' }, '2026-10-12', cfg.version);
    assert.equal(await store.saveReads(pool, read, { start: '2026-11-02', end: '2026-11-08' }, '2026-10-12', cfg.version), n, 're-running a week replaces its rows');
    const latest = await store.latestReads(pool);
    assert.equal(latest.length, new Set(read.ads.map(a => a.stub)).size);
    const standout = (await store.latestReads(pool, [sim.truth.standout!.stub]))[0];
    assert.equal(standout.week_end, '2026-11-08');
    assert.equal(standout.call, read.ads.find(a => a.stub === sim.truth.standout!.stub)!.headline.call);
    assert.ok(standout.range_lo! <= standout.rate! && standout.rate! <= standout.range_hi!);
  } finally {
    await pool.end();
  }
});

test('client labels: persona · territory name · format in words v# (platform), falling back to the code', () => {
  const names = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '../config/territory-names.example.json'), 'utf8'));
  const ad = { persona: 'DINK', territory: 'SIMA', format: 'CAR', version: 2, platform: 'META' };
  assert.equal(readableLabel(ad, names), 'DINK · Example Territory A · carousel v2 (Meta)');
  assert.equal(readableLabel({ ...ad, persona: 'CUR', territory: 'SIMC', format: 'UGC', version: 1 }, names), 'CUR · Example Territory C · creator video v1 (Meta)');
  assert.equal(readableLabel({ ...ad, territory: 'NEWONE', format: 'TT', platform: 'TT' }, names), 'DINK · NEWONE · TikTok-native v2 (TikTok)');
  const sim = simulate('month1', 42);
  const w = aggregate([...parseExport(sim.meta_csv, 'meta', cfg).rows].map(fromIngest), '2026-10-12', '2026-11-08');
  const { read } = simRead('month1', 42);
  const md = draftNote(read, { week: { start: '2026-11-02', end: '2026-11-08' }, since: '2026-10-12', window: w, prev: null, week_impressions: new Map(), sources: [] }, cfg, { audience: 'client', territoryNames: names }).markdown;
  assert.ok(md.includes('FAM · Example Territory E · static v2 (Meta) (FAM_SIME_ST_v2_META)'), 'label with the stub in brackets');
  assert.ok(!/<[a-z\/][^>]*>/i.test(md), 'no HTML tags in the client note');
  assert.ok(!/\*\*(Scale|Cut)\S*\*\* [A-Z]+_[A-Z0-9]+_/.test(md), 'no bare stubs as the name of an action');
  assert.deepEqual(lintNote(md, cfg), []);
  const internal = draftNote(read, { week: { start: '2026-11-02', end: '2026-11-08' }, since: '2026-10-12', window: w, prev: null, week_impressions: new Map(), sources: [] }, cfg, { territoryNames: names }).markdown;
  assert.ok(internal.includes('**Scale** FAM_SIME_ST_v2_META'), 'the internal note keeps the stub');
});

test('historic names: region stands in for persona, format from the name or from video plays', () => {
  assert.deepEqual(historicParse('PRO_EN_US_UGC-Video-Example-Dog', 'Add3_PRO_X', true, 'META'), { stub: 'PRO_EN_US_UGC-Video-Example-Dog', asset: 'PRO_EN_US_UGC-Video-Example-Dog', persona: 'US', territory: 'PRO_EN_US_UGC-Video-Example-Dog', format: 'UGC', platform: 'META', version: 1, visual: null, region: 'US' });
  assert.equal(historicParse('PRO_EN_CA_Group-B-V1-Example_SingleImage_Q2-Refresh', '', false, 'META').format, 'ST');
  assert.equal(historicParse('PRO_EN_CA_Group-A-Example_Carousel_Q3', '', false, 'META').persona, 'CA');
  assert.equal(historicParse('PRO_EN_CA_Group-A-Example_Carousel_Q3', '', false, 'META').format, 'CAR');
  assert.equal(historicParse('Creatorname_Dec19', 'Add3_PRO_Trupanion_US-CA_Boosts', true, 'META').format, 'VID');
  assert.equal(historicParse('Creatorname_Dec19', 'Add3_PRO_Trupanion_US_Boosts', true, 'META').persona, 'US');
});

test("Add3's RET campaigns read as retargeting", () => {
  assert.equal(classifyAudience('Add3_RET_Trupanion_US_Consolidated_ENRL_Q4-2025', 'Add3_RET_Trupanion_US_Consolidated_ENRL', cfg.audience), 'retargeting');
  assert.equal(classifyAudience('Add3_PRO_Trupanion_US_HighPAC_ENRL_Q4-2025', 'x', cfg.audience), 'prospecting');
});

test('an ad whose export has no quote column is not read as zero quotes', () => {
  const base = (k: string, q: number | null): MetricRow => ({ key: k, ad_name: k, audience: 'prospecting', quarantine_reason: null, features: null,
    parsed: { stub: k, asset: k, persona: 'DINK', territory: 'X', format: 'ST', platform: 'META', version: 1 },
    period_start: '2026-10-12', period_end: '2026-10-25', spend: 300, impressions: 60000, video_3s: null, link_clicks: 900, landing_page_views: null, quotes: q, enrollments: null });
  const w = aggregate([base('A', 40), base('B', 38), base('C', null)], '2026-10-12', '2026-10-25');
  const r = readWeek(w.ads, cfg, { from: '2026-10-12', to: '2026-10-25', quotesAvailable: true });
  assert.equal(r.ads.find(a => a.key === 'C')!.metrics.quotes_per_1k, undefined);
  assert.ok(r.ads.find(a => a.key === 'A')!.metrics.quotes_per_1k);
});

test('several ad sets per persona and platform: the note names the ad set and summarises a long headline', () => {
  const c2 = { ...cfg, model: { ...cfg.model, cell_by: ['persona', 'platform', 'ad_set'] } };
  const mk = (k: string, set: string, q: number): AdData => ({ ...hAd(k, q), ad_set: set });
  const ads = [mk('A1', 'Set One', 70), mk('A2', 'Set One', 36), mk('A3', 'Set One', 30), mk('B1', 'Set Two', 72), mk('B2', 'Set Two', 30), mk('B3', 'Set Two', 30),
    mk('C1', 'Set Three', 80), mk('C2', 'Set Three', 30), mk('C3', 'Set Three', 30), mk('D1', 'Set Four', 40)];
  const r = readWeek(ads, c2, hOpts);
  const scaled = r.ads.filter(a => a.headline.call.startsWith('scale'));
  assert.ok(scaled.length >= 3, `${scaled.length} scaled`);
  const head = personaHeadline(r.ads, c2);
  assert.match(head, /ads are clearly ahead in 3 ad sets/);
  const acts = actions(r.ads, c2);
  assert.ok(acts.some(x => /Meta ad set “Set (One|Two|Three)”/.test(x)), acts.join('\n'));
});

// ---------- naming, newer form (29 Sep): visual letter + copy line, region ----------

test('the newer form: visual letter, copy line and region, alongside the older v# form', () => {
  const r = parseAdName('FAM_SUMMER_ST_A2_US_META_261013', N);
  assert.ok(r.ok);
  assert.deepEqual({ v: r.visual, l: r.line, ver: r.version, reg: r.region, stub: r.stub, asset: r.asset, d: r.date, form: r.form },
    { v: 'A', l: 2, ver: 2, reg: 'US', stub: 'FAM_SUMMER_ST_A2_US_META', asset: 'FAM_SUMMER_ST_A_US_META', d: '2026-10-13', form: 0 });
  assert.deepEqual(r.warnings, []);
  for (const v of ['fam_summer_st_a2_us_meta_261013', 'FAM _ SUMMER_STATIC_A2_US_META_261013', 'FAM_SUMMER_ST_A2_US_META_261013_X9', 'FAM_SUMMER_ST_A2_USA_META_261013 - Copy', 'FAM_ASK_YOUR_VET_ST_A2_US_META_261013'.replace('ASK_YOUR_VET', 'SUMMER')]) {
    const x = parseAdName(v, N);
    assert.ok(x.ok && x.stub === 'FAM_SUMMER_ST_A2_US_META', `${v}: ${x.ok ? x.stub : x.reason}`);
  }
  const ca = parseAdName('CUR_ASK_YOUR_VET_TT_B3_CA_TT_261020', N);
  assert.ok(ca.ok && ca.territory === 'ASK_YOUR_VET' && ca.region === 'CA' && ca.format === 'TT' && ca.platform === 'TT' && ca.visual === 'B' && ca.line === 3);
  const old = parseAdName('FAM_SUMMER_ST_v2_META_261013', N);
  assert.ok(old.ok && old.region === null && old.visual === null && old.stub === 'FAM_SUMMER_ST_v2_META' && old.form === 1);
  assert.equal(normalizeStub('FAM_SUMMER_STATIC_A2_US_META', N), 'FAM_SUMMER_ST_A2_US_META');
});

test('newer-form names that are wrong are quarantined with a reason', () => {
  const bad: Array<[string, RegExp]> = [
    ['FAM_SUMMER_ST_A2_UK_META_261013', /region "UK" isn't one of US, CA/],
    ['FAM_SUMMER_ST_A2_US_YT_261013', /platform "YT"/],
    ['FAM_SUMMER_GIF_A2_US_META_261013', /format "GIF"/],
    ['FAM_SUMMER_ST_US_META_261013', /no version \(v#\) or visual and line/],
    ['FAM_SUMMER_ST_A2_US_META_261341', /date "261341"/],
  ];
  for (const [name, re] of bad) {
    const r = parseAdName(name, N);
    assert.equal(r.ok, false, name);
    assert.match((r as any).reason, re, name);
  }
});

test('the convention lives in config: a changed form is a config edit, not code', () => {
  // Say Add3 puts region before format: PERSONA_TERRITORY_REGION_FORMAT_A2_PLATFORM.
  const alt = { ...N, forms: [['PERSONA', 'TERRITORY', 'REGION', 'FORMAT', 'VISUALLINE', 'PLATFORM']] };
  const r = parseAdName('FAM_SUMMER_US_ST_A2_META_261013', alt);
  assert.ok(r.ok && r.region === 'US' && r.territory === 'SUMMER' && r.stub === 'FAM_SUMMER_ST_A2_US_META');
  assert.equal(parseAdName('FAM_SUMMER_ST_A2_US_META_261013', alt).ok, false);
});

test('region splits the ad sets: US and CA ads are compared within their own region', () => {
  const mk = (name: string, q: number): AdData => {
    const p = parseAdName(name, N); assert.ok(p.ok);
    return { ...hAd(p.stub, q), stub: p.stub, persona: p.persona, territory: p.territory, format: p.format, platform: p.platform, version: p.version, visual: p.visual, region: p.region ?? '' };
  };
  const ads = [mk('FAM_SUMMER_ST_A1_US_META_261013', 70), mk('FAM_SUMMER_ST_A2_US_META_261013', 30), mk('FAM_SUMMER_ST_A3_US_META_261013', 30),
    mk('FAM_SUMMER_ST_A1_CA_META_261013', 30), mk('FAM_SUMMER_ST_A2_CA_META_261013', 30), mk('FAM_SUMMER_ST_A3_CA_META_261013', 70)];
  const r = readWeek(ads, cfg, hOpts);
  assert.deepEqual([...new Set(r.ads.map(a => a.cell))].sort(), ['FAM_META_CA', 'FAM_META_US']);
  assert.equal(r.ads.find(a => a.stub === 'FAM_SUMMER_ST_A1_US_META')!.headline.call, 'scale');
  assert.equal(r.ads.find(a => a.stub === 'FAM_SUMMER_ST_A3_CA_META')!.headline.call, 'scale');
  const acts = actions(r.ads, cfg).join('\n');
  assert.match(acts, /the US Meta ad set/);
  assert.equal(readableLabel(r.ads.find(a => a.stub === 'FAM_SUMMER_ST_A1_US_META')!, { FAM_SUMMER: 'One Bill.' }), 'FAM · One Bill · static A1 (US, Meta)');
});

test("the visual key keeps region and platform (Studio's visualKey): US A and CA A are different visuals", () => {
  const us1 = parseAdName('FAM_SUMMER_ST_A1_US_META_261013', N), us2 = parseAdName('FAM_SUMMER_ST_A2_US_META_261013', N), ca1 = parseAdName('FAM_SUMMER_ST_A1_CA_META_261013', N);
  assert.ok(us1.ok && us2.ok && ca1.ok);
  assert.equal(us1.asset, 'FAM_SUMMER_ST_A_US_META');
  assert.equal(us2.asset, us1.asset, 'copy lines on one visual share it');
  assert.equal(ca1.asset, 'FAM_SUMMER_ST_A_CA_META');
  assert.notEqual(ca1.asset, us1.asset);
  const old = parseAdName('FAM_SUMMER_ST_v2_META_261013', N);
  assert.ok(old.ok && old.asset === 'FAM_SUMMER_ST', 'v# names keep PERSONA_TERRITORY_FORMAT');
});

test('feature ids are not a fixed list: new rules tags (v2.9 lifetime_coverage, support_247) pass through ingest and the model', () => {
  const feats = loadFeatureCsv(toCsv(['stub', 'features'], [
    ['FAM_SUMMER_STATIC_A1_US_META', 'lifetime_coverage; support_247'],
    ['FAM_SUMMER_STATIC_A2_US_META', 'lifetime_coverage'],
  ]), 'audit', cfg).map;
  assert.deepEqual(feats.get('FAM_SUMMER_ST_A1_US_META')!.features, ['lifetime_coverage', 'support_247']);
  const csv = toCsv(HEAD, [
    ['2026-10-13', 'Ralph Prospecting', 'FAM_META', 'FAM_SUMMER_ST_A1_US_META_261013', '10.00', '10000', '120', '6'],
    ['2026-10-13', 'Ralph Prospecting', 'FAM_META', 'FAM_SUMMER_ST_A2_US_META_261013', '10.00', '10000', '110', '5'],
  ]);
  const r = parseExport(csv, 'meta', cfg, feats);
  assert.deepEqual(r.rows.map(x => x.features), [['lifetime_coverage', 'support_247'], ['lifetime_coverage']]);
  assert.deepEqual(r.quarantine, []);
  const w = aggregate(r.rows.map(fromIngest), '2026-10-12', '2026-10-18');
  const read = readWeek(w.ads, cfg, { from: '2026-10-12', to: '2026-10-18', quotesAvailable: true });
  const labels = new Set(read.features.map(e => e.label));
  assert.ok(labels.has('lifetime_coverage') && labels.has('support_247'), [...labels].join(','));
});
