// The worksheet (Brook, 2 Oct): the month's copy as one table per step, exported as a workbook in the Round 1
// sheet's shape and read back: Keep / Cut / Rewrite and new lines, previewed before anything is written, recorded
// for the person named, rewrites re-checked. Example rules, mock client, file store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import * as S from '../src/services/studio/engine.js';
import * as Ws from '../src/services/studio/worksheet.js';
import { roundView } from '../src/services/studio/rounds.js';
import { FileStore } from '../src/services/studio/store.js';

const api = () => new S.Api({ mock: true });
async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ws-'));
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  rules.fields.meta_on_image = { platform: 'META', label: 'On-image text', visible: 40, max: 60, source: 'HOUSE: test', in_version: 'per_visual', card: { visible: 90, max: 125 } };
  rules.fields.meta_on_image_sub = { platform: 'META', label: 'On-image subhead', visible: 60, max: 90, source: 'HOUSE: test', in_version: 'per_visual', on_image_role: 'sub' };
  rules.territories.OWN_STILL = { ...rules.territories.OWN_CALM, name: 'Sock Eater (dog)', format: 'STATIC' };
  rules.territories.OWN_CARDS = { ...rules.territories.OWN_CALM, name: 'Ask Your Vet', format: 'CAROUSEL' };
  const rulesPath = path.join(dir, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify(rules));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath }));
  await S.refreshRules();
  const own = (territory: string, persona: string | undefined, lines: Array<[string, string]>) =>
    S.generate(S.makeBrief({ territory, ...(persona ? { persona } : {}), name: territory, own_lines: lines.map(([field, text]) => ({ field, text })) }), api(), () => {}, { ownOnly: true, user: 'brook', for: 'nick' });
  const still = await own('OWN_STILL', undefined, [['meta_on_image_sub', 'Lifetime coverage for your little sock eater'], ['meta_on_image', 'Two incomes. No kids. One little sock eater.']]);
  const cards = await own('OWN_CARDS', undefined, [['meta_on_image', 'Ask your vet which pet insurance they would choose for their own dog, and why.']]);
  const shared = await own(S.SHARED_TERRITORY, S.SHARED_PERSONA, [['meta_primary', 'Trupanion is medical insurance for pets. Get a quote.'], ['meta_primary', 'Trupanion pays your vet directly at participating hospitals.'], ['meta_headline', 'Vet bills? No sweat.'], ['meta_primary', 'Medical insurance for pets that lasts for life. See how it works.']]);
  // A persona's own post copy isn't on the worksheet (captions are shared).
  await own('OWN_STILL', undefined, [['meta_primary', 'Trupanion is medical insurance for pets, for sock eaters. Get a quote.']]);
  return { still, cards, shared };
}
/** Fill in the exported workbook the way a person would, and hand back the file. */
async function fill(buf: Buffer, edit: (tab: (name: string) => { set: (n: string, col: string, v: string) => void; sheet: ExcelJS.Worksheet }) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  edit(name => {
    const sheet = wb.getWorksheet(name)!;
    const head: Record<string, number> = {};
    sheet.getRow(5).eachCell((c, i) => { head[String(c.value)] = i; });
    return { sheet, set: (n, col, v) => { let hit = 0; sheet.eachRow((row, i) => { if (i > 5 && String(row.getCell(1).value) === n) hit = i; }); assert.ok(hit, `row ${n} in ${name}`); sheet.getRow(hit).getCell(head[col]).value = v; } };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('the worksheet: on-image copy by persona and asset, then the shared pools; a line with no decision is undecided, whoever wrote it; card guide applied', async () => {
  await fresh();
  const ws = await Ws.worksheet(await roundView(), 'US');
  assert.deepEqual(ws.steps.on_image.map(x => [x.n, x.asset, x.where, x.visible, x.call, x.flags.some(f => f.rule === 'LIMIT_ON_ASSET')]), [
    ['O1', 'Sock Eater (dog)', 'Headline', 40, '', true],
    ['O2', 'Sock Eater (dog)', 'Subhead', 60, '', false],
    ['O3', 'Ask Your Vet', 'Card', 90, '', false],
  ], 'headline before subhead; on a carousel a headline is a card, with the card guide');
  assert.equal(ws.steps.on_image[0].status, 'amber');
  assert.deepEqual(ws.steps.primary.map(x => [x.n, x.shared, x.shared ? '' : x.asset]), [['P1', true, ''], ['P2', true, ''], ['P3', true, ''], ['P4', false, 'Sock Eater (dog)']], 'the shared pool, then the caption written for one asset');
  assert.deepEqual(ws.steps.headline.map(x => [x.n, x.text]), [['H1', 'Vet bills? No sweat.']]);
  assert.equal(ws.other, 0);
  assert.deepEqual(ws.counts.primary, { total: 4, kept: 0, cut: 0, undecided: 4, red: ws.counts.primary.red, amber: ws.counts.primary.amber, clear: ws.counts.primary.clear });
  assert.ok(ws.steps.primary[1].flags.some(f => f.rule === 'SHARED_CTA' && f.level === 'amber'));
});

test('the sheet has the Round 1 shape, and an untouched sheet read back changes nothing', async () => {
  await fresh();
  const view = await roundView();
  const buf = await Ws.exportXlsx(await Ws.worksheet(view, 'US'), { by: 'brook' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  assert.deepEqual(wb.worksheets.filter(w => w.state === 'visible').map(w => w.name), ['Start here', '1 On-image copy', '2 Primary text', '3 Headlines', 'Flag key']);
  const one = wb.getWorksheet('1 On-image copy')!;
  const head = (one.getRow(5).values as any[]).slice(1);
  assert.deepEqual(head, ['#', 'Persona', 'Asset', 'Where', 'Line', 'Chars', 'Visible', 'Status', 'Flags', 'Your call', 'Your rewrite', 'Rewrite chars', 'Row id', 'Hash']);
  assert.deepEqual([one.getColumn(13).hidden, one.getColumn(14).hidden], [true, true]);
  assert.equal(one.getRow(6).getCell(10).dataValidation.formulae[0], '"Keep,Cut,Rewrite"');
  assert.deepEqual((wb.getWorksheet('2 Primary text')!.getRow(5).values as any[]).slice(1), ['#', 'Persona', 'Asset', 'Line', 'Chars', 'Status', 'Flags', 'Your call', 'Your rewrite', 'Rewrite chars', 'Row id', 'Hash']);
  const two = wb.getWorksheet('2 Primary text')!;
  assert.deepEqual([6, 9].map(i => [String(two.getRow(i).getCell(2).value), String(two.getRow(i).getCell(3).value)]), [['Shared', ''], ['Own the calm', 'Sock Eater (dog)']].map(([a, b], i) => (i ? [String(two.getRow(9).getCell(2).value), b] : [a, b])), 'a shared line says Shared; an asset caption names its asset');
  assert.equal(String(two.getRow(10).getCell(1).value), 'N1', 'blank rows for new lines after the pool');
  const p = await Ws.previewImport(await Ws.parseXlsx(buf), view);
  assert.deepEqual([p.rows, p.problems, p.estimate.usd], [[], [], 0]);
});

test('import: keep, cut, rewrite and new lines are previewed, then written for the person named; rewrites are re-checked', async () => {
  const { shared, still } = await fresh();
  const view = await roundView();
  const filled = await fill(await Ws.exportXlsx(await Ws.worksheet(view, 'US')), tab => {
    const p = tab('2 Primary text');
    p.set('P1', 'Your call', 'Cut');
    p.set('P2', 'Your call', 'Rewrite');
    p.set('P2', 'Your rewrite', 'Trupanion pays your vet directly at participating hospitals. Get a quote.');
    p.set('P3', 'Your rewrite', '  ');                       // a stray space isn't a rewrite
    p.set('N1', 'Line', 'Medical insurance for pets from Trupanion. See how it works.');
    p.set('N2', 'Asset', 'Sock Eater (dog)'); p.set('N2', 'Line', 'For the sock eater in your house: Trupanion. Get a quote.');   // a caption for one asset
    const o = tab('1 On-image copy');
    o.set('O1', 'Your call', 'rewrite ');                    // typed, not picked
    o.set('O1', 'Your rewrite', 'Two incomes. One sock eater.');
    o.set('O2', 'Your call', 'Maybe');
    o.set('N1', 'Asset', 'ask your vet'); o.set('N1', 'Where', 'Card 2'); o.set('N1', 'Line', 'Then ask them why.');
    o.set('N2', 'Asset', 'No such asset'); o.set('N2', 'Line', 'Lost line');
    tab('3 Headlines').set('H1', 'Your call', 'Keep');     // undecided until now: a keep
  });
  const sheet = await Ws.parseXlsx(filled);
  const p = await Ws.previewImport(sheet, view);
  assert.deepEqual(p.rows.map(x => [x.tab[0], x.n, x.action]), [['1', 'O1', 'rewrite'], ['1', 'O2', 'error'], ['1', 'N1', 'new'], ['1', 'N2', 'error'], ['2', 'P1', 'cut'], ['2', 'P2', 'rewrite'], ['2', 'N1', 'new'], ['2', 'N2', 'new'], ['3', 'H1', 'keep']]);
  assert.deepEqual([p.rows[6].territory, p.rows[7].territory, p.rows[7].field], [S.SHARED_TERRITORY, 'OWN_STILL', 'meta_primary'], 'no asset: the shared pool; an asset: that asset’s own caption');
  assert.match(p.rows[1].note!, /"Maybe" isn't Keep, Cut or Rewrite/);
  assert.match(p.rows[3].note!, /No asset called "No such asset"/);
  assert.deepEqual([p.rows[2].territory, p.rows[2].field, p.rows[2].card, p.rows[2].where], ['OWN_CARDS', 'meta_on_image', 2, 'Card 2']);
  assert.deepEqual(p.counts, { keep: 1, cut: 1, rewrite: 2, new: 3, none: 0, conflict: 0, error: 2 });
  assert.equal(p.estimate.checks, 5);
  // Nothing was written by the preview.
  assert.equal((await S.loadBatch(shared.id)).lines[0].decision || '', '');

  const events: S.StudioEvent[] = [];
  const res = await Ws.applyImport(sheet, view, api(), { user: 'brook', for: 'nick' }, e => events.push(e));
  assert.deepEqual([res.applied, res.failed], [{ keep: 1, cut: 1, rewrite: 2, new: 3 }, []]);
  assert.deepEqual(events.filter(e => e.type === 'done').length, 1, 'one "done", at the end');
  const pool = (await S.loadBatch(shared.id)).lines;
  assert.deepEqual([pool[0].decision, pool[0].decided_by, pool[0].decided_for], ['cut', 'brook', 'nick']);
  assert.deepEqual([pool[1].decision, S.finalText(pool[1]), pool[1].decided_for, !!pool[1].rechecked_at], ['edit', 'Trupanion pays your vet directly at participating hospitals. Get a quote.', 'nick', true]);
  assert.equal(pool[1].flags.some(f => f.rule === 'SHARED_CTA'), false, 'the rewrite was checked: it now ends on a call to action');
  const head = (await S.loadBatch(still.id)).lines.find(l => l.field === 'meta_on_image')!;
  assert.deepEqual([S.finalText(head), head.flags.some(f => f.rule === 'LIMIT_ON_ASSET')], ['Two incomes. One sock eater.', false]);
  const after = await Ws.worksheet(view, 'US');
  assert.deepEqual(after.steps.on_image.filter(x => x.asset === 'Ask Your Vet').map(x => [x.where, x.text, x.decided_for || '']), [['Card 2', 'Then ask them why.', 'nick'], ['Card', 'Ask your vet which pet insurance they would choose for their own dog, and why.', '']], 'the numbered card first; the one pasted with no number is a card too');
  assert.equal(after.steps.primary.length, 6);
  assert.deepEqual(after.steps.primary.filter(x => !x.shared).map(x => x.asset), ['Sock Eater (dog)', 'Sock Eater (dog)']);
  const added = (await S.loadBatch(res.runs.find(id => id.startsWith('SHARED'))!)).lines[0];
  assert.deepEqual([added.added_by, added.added_for, added.text], ['brook', 'nick', 'Medical insurance for pets from Trupanion. See how it works.']);
  // The same sheet again: everything is already as the sheet says.
  const again = await Ws.previewImport(sheet, view);
  assert.deepEqual([again.rows.filter(x => x.action !== 'error'), again.matched], [[], 3], 'the three typed rows are now lines in Studio, matched by their wording');
});

test('import: a line changed in Studio after the export is a conflict, left alone unless chosen', async () => {
  const { shared } = await fresh();
  const view = await roundView();
  const exported = await Ws.exportXlsx(await Ws.worksheet(view, 'US'));
  const id = shared.lines[0].id;
  await S.setDecision(shared.id, id, { decision: 'keep', edited_text: 'Trupanion is medical insurance for cats and dogs. Get a quote.' }, 'vivan');
  const sheet = await Ws.parseXlsx(await fill(exported, tab => { tab('2 Primary text').set('P1', 'Your call', 'Rewrite'); tab('2 Primary text').set('P1', 'Your rewrite', 'Trupanion: medical insurance for pets. Get a quote.'); }));
  const p = await Ws.previewImport(sheet, view);
  assert.deepEqual(p.rows.map(x => [x.n, x.action, x.now]), [['P1', 'conflict', 'Trupanion is medical insurance for cats and dogs. Get a quote.']]);
  assert.match(p.rows[0].note!, /Changed in Studio since the sheet was exported/);
  const res = await Ws.applyImport(sheet, view, api(), { user: 'brook', for: 'nick' });
  assert.deepEqual([res.applied.rewrite, res.skipped], [0, 1]);
  assert.equal(S.finalText((await S.loadBatch(shared.id)).lines[0]), 'Trupanion is medical insurance for cats and dogs. Get a quote.');
  // Chosen by the person: the sheet's rewrite wins.
  assert.deepEqual((await Ws.previewImport(sheet, view, { accept: [id] })).rows.map(x => x.action), ['rewrite']);
  await Ws.applyImport(sheet, view, api(), { user: 'brook', for: 'nick', accept: [id] });
  assert.equal(S.finalText((await S.loadBatch(shared.id)).lines[0]), 'Trupanion: medical insurance for pets. Get a quote.');
});

test('import: a workbook that is not the worksheet is refused in plain words', async () => {
  await fresh();
  await assert.rejects(Ws.parseXlsx(Buffer.from('not a workbook')), /isn't an Excel workbook/);
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('Sheet1').addRow(['hello']);
  await assert.rejects(Ws.parseXlsx(Buffer.from(await wb.xlsx.writeBuffer())), /none of the worksheet tabs/);
});

test('a hand-made sheet (no row ids): rows are matched by wording, cut lines included; the totals row is ignored; "Carousel card" is read; a live asset wins over a retired one of the same name', async () => {
  const { shared, cards } = await fresh();
  // A retired pitch territory with the same name as the live asset, listed first in the rules.
  const rules = JSON.parse(fs.readFileSync((S.getStore() as any).opts.rulesPath, 'utf8'));
  rules.territories = { OWN_VET_OLD: { ...rules.territories.OWN_CARDS, status: 'retired' }, ...rules.territories };
  fs.writeFileSync((S.getStore() as any).opts.rulesPath, JSON.stringify(rules));
  await S.refreshRules();
  const view = await roundView();
  await S.setDecision(shared.id, shared.lines[0].id, { decision: 'cut' }, 'brook', 'nick');
  await S.setDecision(cards.id, cards.lines[0].id, { decision: 'keep', edited_text: 'Ask your vet which insurance they would choose.' }, 'brook', 'nick');
  const exported = await Ws.exportXlsx(await Ws.worksheet(view, 'US'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(exported as any);
  for (const name of ['1 On-image copy', '2 Primary text', '3 Headlines']) {
    const sh = wb.getWorksheet(name)!;
    const head = (sh.getRow(5).values as any[]);
    sh.spliceColumns(head.indexOf('Row id'), 2);                     // no Row id, no Hash: the Round 1 sheet
    sh.addRow([]); sh.addRow([null, name[0] === '1' ? null : 'Kept so far', 3]);
  }
  const one = wb.getWorksheet('1 On-image copy')!, two = wb.getWorksheet('2 Primary text')!;
  const rowOf = (sh: ExcelJS.Worksheet, n: string) => { let hit = 0; sh.eachRow((row, i) => { if (String(row.getCell(1).value) === n) hit = i; }); return sh.getRow(hit); };
  // The card as the deck had it (the wording before the edit, in capitals), called a "Carousel card".
  rowOf(one, 'O3').getCell(4).value = 'Carousel card';
  rowOf(one, 'O3').getCell(5).value = cards.lines[0].text.toUpperCase();
  rowOf(one, 'O3').getCell(10).value = 'Keep';
  // A new card for the live asset, by its name.
  const n1 = rowOf(one, 'N1'); n1.getCell(3).value = 'Ask Your Vet'; n1.getCell(4).value = 'Carousel card'; n1.getCell(5).value = 'Then ask them why.';
  const call2 = (two.getRow(5).values as any[]).indexOf('Your call');
  rowOf(two, 'P1').getCell(call2).value = '';                       // the cut line, with no call on this copy of the sheet
  rowOf(two, 'P2').getCell(call2).value = 'Keep';
  const sheet = await Ws.parseXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(sheet.no_ids, true);
  assert.equal(sheet.rows.some(x => /Kept so far/.test(x.line)), false, 'the totals row is not a line');
  const p = await Ws.previewImport(sheet, view);
  assert.deepEqual(p.rows.map(x => [x.tab[0], x.n, x.action, !!x.matched]), [['1', 'N1', 'new', false], ['2', 'P2', 'keep', true]], 'the cut line and the already-kept card are no change; nothing is "new" but the new card');
  assert.equal(p.rows[0].territory, 'OWN_CARDS', 'the live asset, not the retired territory of the same name');
  assert.ok(p.matched >= 6);
  assert.match(p.problems.join(' '), /matched to Studio's lines by their wording/);
  // Unmatched rows are only added when the person says so.
  const res = await Ws.applyImport(sheet, view, api(), { user: 'brook', for: 'nick' });
  assert.deepEqual([res.applied.keep, res.applied.new], [1, 0]);
  const added = await Ws.applyImport(sheet, view, api(), { user: 'brook', for: 'nick', addUnmatched: true });
  assert.equal(added.applied.new, 1);
  assert.equal((await S.loadBatch(shared.id)).lines[0].decision, 'cut', 'the cut line stays cut');
});

test('a workbook whose comments trip the reader (saved by another tool) is still read', async () => {
  await fresh();
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await Ws.exportXlsx(await Ws.worksheet(await roundView(), 'US')));
  // A comments relationship the reader can't resolve, as openpyxl writes them.
  zip.file('xl/worksheets/_rels/sheet2.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="/xl/comments/comment1.xml" Id="comments"/></Relationships>');
  const sheet = await Ws.parseXlsx(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(sheet.rows.filter(x => x.step === 'on_image').length, 3);
});

test('a turn-off flag says who it puts off and what the rule asks, in the rules file’s words', async () => {
  await fresh();
  const r = S.loadRules();
  const [code, persona] = Object.entries(r.personas).find(([, p]) => (p.turn_offs || []).length)!;
  const t = persona.turn_offs[0];
  const words = Ws.flagWords(t.id, r);
  assert.match(words, new RegExp(`^puts ${String(persona.name || code).replace(/\\s*\\(.*\\)$/, '').replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')} off: \\S`));
  assert.doesNotMatch(words, /turn-off|_T_/);
  assert.equal(Ws.flagWords('SHARED_CTA', r), 'no call to action', 'other flags keep their chip names');
});

test('a line typed on the worksheet joins its asset’s run, is checked, kept and recorded for the person named', async () => {
  const { still, shared } = await fresh();
  const view = await roundView();
  // Step 1: a subhead for an asset, by its name; it joins the asset's run.
  const sub = await Ws.addLine({ step: 'on_image', text: '  One little sock eater,  covered. ', asset: 'Sock Eater (dog)', where: 'Subhead' }, view, api(), { user: 'brook', for: 'nick' });
  assert.equal(sub.run, still.id);
  const l = (await S.loadBatch(still.id)).lines.find(x => x.id === sub.line)!;
  assert.deepEqual([l.text, l.field, l.decision, l.decided_for, l.model, l.status], ['One little sock eater, covered.', 'meta_on_image_sub', 'keep', 'nick', 'human', 'checked']);
  // A card on a carousel keeps its number.
  const card = await Ws.addLine({ step: 'on_image', text: 'Then ask them why.', asset: 'OWN_CARDS', where: 'Card 2' }, view, api(), { user: 'brook' });
  assert.equal((await S.loadBatch(card.run)).lines.find(x => x.id === card.line)!.card, 2);
  // Steps 2 and 3: no asset is the shared pool; an asset is that asset's own caption.
  const pool = await Ws.addLine({ step: 'primary', text: 'Trupanion is medical insurance for pets. Build your pet’s plan.' }, view, api(), { user: 'brook' });
  assert.equal(pool.run, shared.id);
  assert.equal((await S.loadBatch(pool.run)).lines.find(x => x.id === pool.line)!.flags.some(f => f.rule === 'SHARED_CTA'), false);
  const own = await Ws.addLine({ step: 'headline', text: 'Sock eaters, sorted.', asset: 'OWN_STILL' }, view, api(), { user: 'brook' });
  const ws = await Ws.worksheet(view, 'US');
  assert.deepEqual(ws.steps.headline.filter(x => !x.shared).map(x => [x.asset, x.text, x.call]), [['Sock Eater (dog)', 'Sock eaters, sorted.', 'keep']]);
  assert.ok(own.line);
  // Refused in plain words: the same wording again, no wording, no asset on step 1, an unknown asset.
  await assert.rejects(Ws.planAdd({ step: 'on_image', text: 'One little sock eater, covered.', asset: 'OWN_STILL', where: 'Subhead' }, view), /already on the worksheet/);
  await assert.rejects(Ws.planAdd({ step: 'primary', text: '   ' }, view), /Type the line first/);
  await assert.rejects(Ws.planAdd({ step: 'on_image', text: 'A line' }, view), /needs its asset/);
  await assert.rejects(Ws.planAdd({ step: 'on_image', text: 'A line', asset: 'Nowhere' }, view), /No asset called "Nowhere"/);
});

test('the lock: a locked step’s lines are refused everywhere they could change, per round and region, and unlock in one call', async () => {
  const { still, shared } = await fresh();
  const view = await roundView();
  const Locks = await import('../src/services/studio/locks.js');
  const round = view.active.id;
  await Locks.setLock(round, 'US', 'primary', true, 'brook', 'nick');
  const ws = await Ws.worksheet(view, 'US');
  assert.deepEqual([ws.locks.primary?.by, ws.locks.primary?.for, !!ws.locks.on_image], ['brook', 'nick', false]);
  // A line in the step, by id; a new line for the step; a sheet row for the step: all refused, in words.
  const cap = shared.lines.find(l => l.field === 'meta_primary')!;
  await assert.rejects(Locks.assertLineUnlocked(shared.id, cap.id), (e: any) => e.status === 423 && /Step 2 Captions \(US\) is locked \(brook for nick, \d+ \w+\)/.test(e.message));
  await assert.rejects(Ws.planAdd({ step: 'primary', text: 'Trupanion is medical insurance for pets. Build your pet’s plan.' }, view), /is locked/);
  await assert.rejects(Locks.assertBriefUnlocked({ persona: 'ALL', fields: ['meta_primary'], region: 'US' }, round), /is locked/);
  const filled = await fill(await Ws.exportXlsx(ws), tab => { tab('2 Primary text').set('P1', 'Your call', 'Cut'); tab('3 Headlines').set('H1', 'Your call', 'Keep'); });
  const p = await Ws.previewImport(await Ws.parseXlsx(filled), view);
  assert.deepEqual(p.rows.map(x => [x.n, x.action]), [['P1', 'error'], ['H1', 'keep']], 'the locked step’s row is not applied; another step’s is');
  // Other steps, the other region and another round are not locked.
  await Locks.assertLineUnlocked(still.id, still.lines[0].id);
  await Locks.assertUnlocked({ field: 'meta_primary', persona: 'ALL', round, region: 'CA' });
  await Locks.assertUnlocked({ field: 'meta_primary', persona: 'ALL', round: 'R9', region: 'US' });
  // An asset's own caption is step 2 too.
  await assert.rejects(Locks.assertUnlocked({ field: 'meta_primary', persona: 'OWN', round, region: 'US' }), /is locked/);
  // Unlocked: everything goes again.
  await Locks.setLock(round, 'US', 'primary', false, 'brook');
  await Locks.assertLineUnlocked(shared.id, cap.id);
  assert.deepEqual((await Ws.worksheet(view, 'US')).locks, {});
});
