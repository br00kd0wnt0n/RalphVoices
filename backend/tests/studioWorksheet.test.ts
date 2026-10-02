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

test('the worksheet: on-image copy by persona and asset, then the shared pools; pasted lines count as kept; card guide applied', async () => {
  await fresh();
  const ws = await Ws.worksheet(await roundView(), 'US');
  assert.deepEqual(ws.steps.on_image.map(x => [x.n, x.asset, x.where, x.visible, x.call, !!x.implied, x.flags.some(f => f.rule === 'LIMIT_ON_ASSET')]), [
    ['O1', 'Sock Eater (dog)', 'Headline', 40, 'keep', true, true],
    ['O2', 'Sock Eater (dog)', 'Subhead', 60, 'keep', true, false],
    ['O3', 'Ask Your Vet', 'Headline', 90, 'keep', true, false],
  ], 'headline before subhead; a carousel territory uses the card guide');
  assert.equal(ws.steps.on_image[0].status, 'amber');
  assert.deepEqual(ws.steps.primary.map(x => x.n), ['P1', 'P2', 'P3']);
  assert.deepEqual(ws.steps.headline.map(x => [x.n, x.text]), [['H1', 'Vet bills? No sweat.']]);
  assert.equal(ws.other, 1, "the persona's own primary text is counted, not shown");
  assert.deepEqual(ws.counts.primary, { total: 3, kept: 3, cut: 0, undecided: 0, red: ws.counts.primary.red, amber: ws.counts.primary.amber, clear: ws.counts.primary.clear });
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
  assert.deepEqual((wb.getWorksheet('2 Primary text')!.getRow(5).values as any[]).slice(1), ['#', 'Line', 'Chars', 'Status', 'Flags', 'Your call', 'Your rewrite', 'Rewrite chars', 'Row id', 'Hash']);
  assert.equal(String(wb.getWorksheet('2 Primary text')!.getRow(9).getCell(1).value), 'N1', 'blank rows for new lines after the pool');
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
    const o = tab('1 On-image copy');
    o.set('O1', 'Your call', 'rewrite ');                    // typed, not picked
    o.set('O1', 'Your rewrite', 'Two incomes. One sock eater.');
    o.set('O2', 'Your call', 'Maybe');
    o.set('N1', 'Asset', 'ask your vet'); o.set('N1', 'Where', 'Card 2'); o.set('N1', 'Line', 'Then ask them why.');
    o.set('N2', 'Asset', 'No such asset'); o.set('N2', 'Line', 'Lost line');
    tab('3 Headlines').set('H1', 'Your call', 'Keep');     // already counts as kept: no change
  });
  const sheet = await Ws.parseXlsx(filled);
  const p = await Ws.previewImport(sheet, view);
  assert.deepEqual(p.rows.map(x => [x.tab[0], x.n, x.action]), [['1', 'O1', 'rewrite'], ['1', 'O2', 'error'], ['1', 'N1', 'new'], ['1', 'N2', 'error'], ['2', 'P1', 'cut'], ['2', 'P2', 'rewrite'], ['2', 'N1', 'new']]);
  assert.match(p.rows[1].note!, /"Maybe" isn't Keep, Cut or Rewrite/);
  assert.match(p.rows[3].note!, /No asset called "No such asset"/);
  assert.deepEqual([p.rows[2].territory, p.rows[2].field, p.rows[2].card, p.rows[2].where], ['OWN_CARDS', 'meta_on_image', 2, 'Card 2']);
  assert.deepEqual(p.counts, { keep: 0, cut: 1, rewrite: 2, new: 2, none: 0, conflict: 0, error: 2 });
  assert.equal(p.estimate.checks, 4);
  // Nothing was written by the preview.
  assert.equal((await S.loadBatch(shared.id)).lines[0].decision || '', '');

  const events: S.StudioEvent[] = [];
  const res = await Ws.applyImport(sheet, view, api(), { user: 'brook', for: 'nick' }, e => events.push(e));
  assert.deepEqual([res.applied, res.failed], [{ keep: 0, cut: 1, rewrite: 2, new: 2 }, []]);
  assert.deepEqual(events.filter(e => e.type === 'done').length, 1, 'one "done", at the end');
  const pool = (await S.loadBatch(shared.id)).lines;
  assert.deepEqual([pool[0].decision, pool[0].decided_by, pool[0].decided_for], ['cut', 'brook', 'nick']);
  assert.deepEqual([pool[1].decision, S.finalText(pool[1]), pool[1].decided_for, !!pool[1].rechecked_at], ['edit', 'Trupanion pays your vet directly at participating hospitals. Get a quote.', 'nick', true]);
  assert.equal(pool[1].flags.some(f => f.rule === 'SHARED_CTA'), false, 'the rewrite was checked: it now ends on a call to action');
  const head = (await S.loadBatch(still.id)).lines.find(l => l.field === 'meta_on_image')!;
  assert.deepEqual([S.finalText(head), head.flags.some(f => f.rule === 'LIMIT_ON_ASSET')], ['Two incomes. One sock eater.', false]);
  const after = await Ws.worksheet(view, 'US');
  assert.deepEqual(after.steps.on_image.filter(x => x.asset === 'Ask Your Vet').map(x => [x.where, x.text, x.decided_for || '']).pop(), ['Card 2', 'Then ask them why.', 'nick']);
  assert.equal(after.steps.primary.length, 4);
  const added = (await S.loadBatch(res.runs.find(id => id.startsWith('SHARED'))!)).lines[0];
  assert.deepEqual([added.added_by, added.added_for, added.text], ['brook', 'nick', 'Medical insurance for pets from Trupanion. See how it works.']);
  // The same sheet again: everything is already as the sheet says.
  const again = await Ws.previewImport(sheet, view);
  assert.deepEqual(again.rows.filter(x => x.action !== 'error').map(x => [x.n, x.action]), [['N1', 'none'], ['N1', 'none']]);
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
