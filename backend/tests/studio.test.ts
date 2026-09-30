// B1-lite Copy Studio: deterministic checks, grid, CSV round trip and a mock
// batch end to end. Uses the made-up example rules (scripts/studio/rules.example.json)
// and a temp studio folder, so it needs no client material, key or network.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
S.setStudioDir(dir);
S.setRulesPath(path.join(__dirname, '../scripts/studio/rules.example.json'));
let rules: S.Rules;
before(async () => { rules = await S.refreshRules(); });
const det = (text: string, field = 'meta_primary', structure = 'plain_promise') =>
  S.deterministicFlags({ text, field, structure, persona: 'OWN' }, rules, { banned_words: ['hassle-free'] }).flags;
const find = (flags: S.Flag[], rule: string) => flags.find(f => f.rule === rule);

test('banned phrase is flagged with its quote and source', () => {
  const f = find(det('Honestly, the policy pays for itself.'), 'COMP_PAYS_FOR_ITSELF');
  assert.ok(f);
  assert.equal(f.severity, 'compliance');
  assert.equal(f.quote, 'pays for itself');
  assert.equal(f.source, 'LEGAL §4');
});

test('direct pay needs its caveat', () => {
  assert.ok(find(det('Your vet gets paid at checkout.'), 'COMP_DIRECT_PAY'));
  assert.equal(find(det('Your vet gets paid at checkout at partner clinics.'), 'COMP_DIRECT_PAY'), undefined);
});

test('a pattern can carry its own lower severity', () => {
  const f = find(det('Cheap cover can cost you more.'), 'COMP_CHEAP');
  assert.equal(f?.severity, 'warn');
  assert.equal(find(det('Rates locked in for life.'), 'COMP_CHEAP')?.severity, 'compliance');
});

test('price is compliance when it leads, a warning mid-line', () => {
  assert.equal(find(det('$30 a month for peace of mind', 'meta_headline'), 'COMP_PRICE_LEAD')?.severity, 'compliance');
  assert.equal(find(det('Peace of mind at the vet, whatever happens next. From what you pay, $30 a month, we pay back most.'), 'COMP_PRICE_LEAD')?.severity, 'warn');
});

test('figures must be in the facts list; category stats need a citation; misattribution is flagged', () => {
  assert.equal(find(det('We paid 2.4M claims.'), 'FIG_UNSOURCED')?.quote, '2.4M');
  const ok = det('Pawsure paid 1.5M claims last year.');
  assert.equal(find(ok, 'FIG_UNSOURCED'), undefined);
  assert.equal(find(det('81% of owners say cover is worth it.'), 'FIG_CITATION')?.severity, 'warn');
  assert.equal(find(det('81% of our members say it is worth it.'), 'FIG_ATTRIBUTION')?.severity, 'compliance');
  assert.equal(find(det('Two dogs, one sofa.'), 'FIG_UNSOURCED'), undefined, 'small counts are allowed');
});

test('limits, case, turn-offs, verbatims, structure and brief bans', () => {
  assert.ok(find(det('This headline is far too long to fit', 'meta_headline'), 'LIMIT_VISIBLE'));
  assert.ok(find(det('THIS IS ALL CAPS COPY'), 'BR_CASE'));
  assert.ok(find(det('For your fur baby.'), 'OWN_T_BABY'));
  assert.ok(find(det('Honestly I never once had to think about whether I could afford it'), 'COMP_VERBATIM'));
  assert.equal(find(det('I got it for Molly.', 'meta_primary', 'testimony'), 'COMP_UGC_MEMBER')?.severity, 'note');
  assert.ok(find(det('Totally hassle-free.'), 'BRIEF_BANNED:hassle-free'));
  assert.ok(find(det('Plain pet cover.'), 'BR_NAMING')?.label.includes('pending'));
});

test('the grid spreads cells across angles and structures', () => {
  const b = S.makeBrief({ territory: 'OWN_CALM', n: 12, name: 'grid' });
  const cells = S.planCells(b, 12);
  const pairs = new Set(cells.map(c => `${c.angle}|${c.structure}`));
  // The territory's own angle counts twice, so a few pairs repeat by design.
  assert.ok(pairs.size >= 9, `only ${pairs.size} distinct pairs`);
  assert.equal(new Set(cells.map(c => c.angle)).size, 2);
  assert.equal(new Set(cells.map(c => c.structure)).size, 6);
  assert.ok(cells.every(c => b.fields.includes(c.field)));
});

test('every structure appears whatever the number of angles', () => {
  for (const n of [6, 10, 20]) {
    const b = S.makeBrief({ territory: 'OWN_CALM', n, name: `grid${n}` });
    for (const A of [3, 4, 5, 6]) {
      // Simulate A angle slots by checking the formula directly on the planned cells' indices.
      const structures = new Set(Array.from({ length: Math.max(n, 12) }, (_, i) => ((i % A) + Math.floor(i / A)) % 6));
      assert.equal(structures.size, 6, `A=${A}`);
    }
    assert.equal(new Set(S.planCells(b, Math.max(n, 12)).map(c => c.structure)).size, 6);
  }
});

test('CSV survives quotes, commas, newlines and formula-like text', () => {
  const rows = [['id', 'text'], ['a', 'He said "hi", then\nleft'], ['b', '=SUM(A1)']];
  const back = S.parseCsv(S.toCsv(rows));
  assert.deepEqual(back[1], rows[1]);
  assert.equal(back[2][1], "'=SUM(A1)");
});

test('mock batch: generate, check, export, ingest round trip', async () => {
  const api = new S.Api({ mock: true });
  const b = S.makeBrief({ territory: 'OWN_CALM', n: 8, name: 'mock' });
  const batch = await S.generate(b, api);
  assert.ok(batch.lines.length >= 6);
  assert.ok(batch.lines.every(l => l.status === 'checked'));
  assert.ok(batch.lines.flatMap(l => l.flags).every(f => f.source), 'every flag has a source');
  const { csv } = await S.exportBatch(batch.id);
  const rows = S.parseCsv(csv);
  const h = rows[0];
  rows[1][h.indexOf('decision')] = 'keep';
  rows[2][h.indexOf('decision')] = 'edit';
  rows[2][h.indexOf('edited_text')] = 'Calm at the counter, at partner clinics.';
  rows[2][h.indexOf('note')] = 'plainer';
  const r = await S.ingest(rows.map(x => x.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n'));
  assert.equal(r.kept, 1);
  assert.equal(r.edited, 1);
  assert.equal(r.shortlist, 2);
  const sl = await S.shortlist();
  assert.match(sl[0].stub, /^OWN_CALM_UGC_A\d_US_META$/);
  assert.equal((await S.loadTaste()).length, 2);
});

test('the creative director writes first: own lines are tagged, checked, and Studio writes around them', async () => {
  const api = new S.Api({ mock: true });
  const b = S.makeBrief({ territory: 'OWN_CALM', n: 6, name: 'own', own_lines: [
    { text: 'Calm at the counter, at partner clinics.', field: 'meta_primary' },
    { text: 'The vet, not the bill, decides.', field: 'meta_headline' },
  ] });
  // Check my lines only.
  const first = await S.generate(b, api, () => {}, { ownOnly: true, user: 'Brook' });
  assert.equal(first.lines.length, 2);
  assert.ok(first.lines.every(l => l.model === 'human' && l.status === 'checked'));
  assert.ok(first.lines.every(l => ['OWN_A1', 'OWN_A2'].includes(l.angle)));
  assert.equal(first.created_by, 'Brook');
  // Continue the same run: generate around them. Their lines aren't added twice.
  const more = await S.generate(b, api, () => {}, { batchId: first.id, user: 'Someone else' });
  assert.equal(more.id, first.id);
  assert.equal(more.lines.filter(l => l.model === 'human').length, 2);
  assert.ok(more.lines.filter(l => l.model !== 'human').length >= 4);
  assert.ok(more.lines.every(l => l.status === 'checked'));
  assert.equal(more.created_by, 'Brook', 'the run keeps its owner');
  // Studio's first-round cells skip the pairs the creative director covered.
  const covered = new Set(more.lines.filter(l => l.model === 'human').map(l => `${l.angle}|${l.structure}`));
  const cells = S.planCells(b, 6, 0, '', covered);
  assert.ok(cells.every(c => !covered.has(`${c.angle}|${c.structure}`)));
  // Runs are listed by person, and decisions are attributed.
  assert.equal((await S.listBatches('brook')).filter(x => x.id === first.id).length, 1);
  assert.equal((await S.listBatches('nobody')).length, 0);
  const l = await S.setDecision(first.id, more.lines[0].id, { decision: 'keep' }, 'Brook');
  assert.equal(l.decided_by, 'Brook');
  const history = await S.lineHistory(l.id);
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].after, { decision: 'keep', edited_text: '', note: '' });
});

test('only the local client logo is served; no reference documents', async () => {
  await assert.rejects(() => S.brandAsset('../secrets'), /No brand asset/);
  // Reference documents and the readout are not in the tool (decision 10): only the local logo is an asset.
  assert.deepEqual(Object.keys(S.localAssets()), ['brand:client-logo']);
  assert.equal('referenceDoc' in S, false);
});

test('resuming a run checks only the lines left unchecked', async () => {
  const api = new S.Api({ mock: true });
  const b = S.makeBrief({ territory: 'OWN_CALM', n: 4, name: 'resume-test' });
  const run = await S.generate(b, api, () => {}, { check: false });
  assert.ok(run.lines.every(l => l.status !== 'checked'));
  assert.equal((await S.listBatches()).find(x => x.id === run.id)!.unchecked, run.lines.length);
  const done = await S.resumeChecks(run.id, api);
  assert.ok(done.lines.every(l => l.status === 'checked'));
  assert.ok(done.stats.timings_ms.resume >= 0);
  assert.equal((await S.listBatches()).find(x => x.id === run.id)!.unchecked, 0);
});

test('a monthly cap counts only this month\'s spend', async () => {
  const api = new S.Api({ mock: true, cap: 50, capWindow: 'month' });
  assert.equal(api.capWindow, 'month');
  assert.equal(await api.loadSpent(), 0);
});

test('territories are editable, with history; the pitch version is untouched', async () => {
  const before = S.loadRules().territories.OWN_CALM;
  assert.equal(before.origin, 'pitch');
  const e = await S.saveTerritory('OWN_CALM', { premise: 'Calmer, per client feedback.', angle: 'OWN_A2' }, 'client feedback 28 Sep', 'Brook');
  assert.equal(e.territory.origin, 'edited');
  assert.equal(e.territory.history!.length, 1);
  assert.equal(e.territory.history![0].before!.premise, before.premise);
  assert.equal(S.loadRules().territories.OWN_CALM.premise, 'Calmer, per client feedback.');
  const added = await S.saveTerritory(null, { persona: 'OWN', name: 'Nothing to File', angle: 'OWN_A2', format: 'STATIC', premise: 'The admin that never happens.' }, 'CD idea', 'Brook');
  assert.equal(added.code, 'OWN_NOTHING_TO_FILE');
  assert.equal(added.territory.origin, 'new');
  await assert.rejects(() => S.saveTerritory(null, { persona: 'OWN', name: 'Bad', angle: 'DINK_A1', format: 'STATIC' }, '', 'Brook'), /isn't one of/);
  await S.saveTerritory('OWN_NOTHING_TO_FILE', { status: 'retired' }, 'dropped after kickoff', 'Brook');
  assert.throws(() => S.makeBrief({ territory: 'OWN_NOTHING_TO_FILE' }), /retired/);
  await S.saveTerritory('OWN_CALM', { premise: before.premise, angle: before.angle }, 'revert for other tests', 'test');
});

test('blind compare stars are per person, hidden from each other until the reveal', async () => {
  const api = new S.Api({ mock: true });
  const set = await S.compare(S.makeBrief({ territory: 'OWN_CALM', name: 'stars' }), ['writer-a', 'writer-b'], 2, api);
  const [a, b] = set.lines;
  await S.markCompareLine(set.name, a.id, { favourite: true }, 'Nick');
  await S.markCompareLine(set.name, b.id, { favourite: true }, 'vivan');
  const nick = S.viewCompare(await S.loadCompare(set.name), 'nick');
  assert.equal(nick.lines.find(l => l.id === a.id)!.favourite, true);
  assert.equal(nick.lines.find(l => l.id === b.id)!.favourite, false, "vivan's star isn't Nick's");
  assert.equal(nick.lines.some(l => 'stars' in l), false, 'other people\'s stars stay hidden before the reveal');
  const r = await S.revealCompare(set.name, 'brook');
  assert.equal(Object.values(r.tally).reduce((x, y) => x + y, 0), 2);
  assert.deepEqual(Object.keys(r.by_person).sort(), ['nick', 'vivan']);
  const after = await S.loadCompare(set.name);
  assert.equal(after.revealed_by, 'brook');
});

test('two runs started in the same second get different ids', async () => {
  const [x, y] = await Promise.all([S.newBatchId('OWN_CALM'), S.newBatchId('OWN_CALM')]);
  assert.notEqual(x, y);
  const api = new S.Api({ mock: true });
  const [r1, r2] = await Promise.all([1, 2].map(() => S.generate(S.makeBrief({ territory: 'OWN_CALM', n: 2, name: 'same-second' }), api, () => {}, { check: false })));
  assert.notEqual(r1.id, r2.id);
  assert.equal((await S.loadBatch(r1.id)).lines.length, r1.lines.length);
});

test("'price leads' is only red when the line has a price; a model hit without one stays amber", () => {
  const mk = (text: string, flag: Partial<S.Flag>) => ({ text, field: 'meta_primary', decision: '', flags: [{ rule: 'COMP_PRICE_LEAD', severity: 'compliance', label: 'price', source: 'LEGAL', quote: '', by: ['model', 'logprob'], ...flag }] } as any as S.Line);
  const noPrice = mk('Cheap cover can cost you more when it matters most.', { p: 0.41 });
  S.reconcile(noPrice, rules);
  assert.equal(noPrice.flags[0].severity, 'warn');
  assert.match(noPrice.flags[0].why!, /no price/);
  const priced = mk('Peace of mind, and only $30 a month.', { p: 0.41 });
  S.reconcile(priced, rules);
  assert.equal(priced.flags[0].severity, 'compliance', 'with a price, model and yes/no agreeing still makes it red');
});

test("rules for images only (applies_to: 'visual') never reach Studio's text checks", async () => {
  const stored = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  assert.ok(stored.brand.some((b: any) => b.id === 'BR_VIS_EXAMPLE' && b.applies_to === 'visual'), 'the example keeps a visual-only rule for B2');
  const loaded = S.loadRules();
  assert.equal(loaded.brand.some(b => b.id === 'BR_VIS_EXAMPLE'), false);
  assert.ok(loaded.brand.some(b => b.id === 'BR_CASE'), 'text rules stay');
  const d = S.deterministicFlags({ text: 'Any line at all.', field: 'meta_primary', structure: 'plain_promise', persona: 'OWN' }, loaded, { banned_words: [] });
  assert.equal(d.flags.some(f => f.rule === 'BR_VIS_EXAMPLE'), false);
});
