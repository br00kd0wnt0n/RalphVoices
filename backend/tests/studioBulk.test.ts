// Bulk check + report (Brook, 1 Oct): a table pasted from a Google Doc is parsed (persona, territory, field, text),
// every line checked as "Check my lines" does, filed into a run per persona × territory (persona-less post copy into
// the shared captions run), kept, attributed "for Nick", and reported back in plain words. Example rules, mock client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import * as B from '../src/services/studio/bulk.js';
import { FileStore } from '../src/services/studio/store.js';

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bulk-'));
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  rules.fields.meta_on_image = { platform: 'META', label: 'On-image text', visible: 40, max: 60, source: 'HOUSE: test', in_version: 'per_visual' };
  rules.fields.meta_on_image_sub = { platform: 'META', label: 'On-image subhead', visible: 60, max: 90, source: 'HOUSE: test', in_version: 'per_visual', on_image_role: 'sub' };
  rules.personas.FAM = { ...rules.personas.OWN, name: 'Busy Families' };
  rules.territories.FAM_SUMMER = { ...rules.territories.OWN_CALM, persona: 'FAM', name: 'One Bill Shouldn’t Break the Summer.', format: 'STATIC' };
  const rulesPath = path.join(dir, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify(rules));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath }));
  return S.refreshRules();
}

test('parse: a tab-separated table with a header, names for personas and fields, in any column order', async () => {
  const r = await fresh();
  const p = B.parseBulk(['Field\tPersona\tTerritory\tText', 'On-image\tBusy families\tOne Bill\tSummer plans, covered', 'Subhead\tFAM\tFAM_SUMMER\tThe trip stays booked', 'primary text\t\t\tTrupanion is medical insurance for pets.', 'Headline\tshared\t\tCalm, covered.'].join('\n'), r);
  assert.equal(p.header, true);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.rows.map(x => [x.persona, x.territory, x.field]), [['FAM', 'FAM_SUMMER', 'meta_on_image'], ['FAM', 'FAM_SUMMER', 'meta_on_image_sub'], ['ALL', 'SHARED', 'meta_primary'], ['ALL', 'SHARED', 'meta_headline']]);
});

test('parse: no header (4, 3, 2 columns), commas with quotes, a missing territory noted, and errors that say why', async () => {
  const r = await fresh();
  const four = B.parseBulk('FAM\tFAM_SUMMER\ton-image\tSummer plans, covered', r);
  assert.deepEqual(four.rows.map(x => [x.persona, x.territory, x.field, x.text]), [['FAM', 'FAM_SUMMER', 'meta_on_image', 'Summer plans, covered']]);
  const three = B.parseBulk('Owners,headline,"Calm, covered."', r);
  assert.deepEqual(three.rows.map(x => [x.persona, x.territory, x.field, x.text]), [['OWN', 'OWN_CALM', 'meta_headline', 'Calm, covered.']]);
  assert.match(three.rows[0].notes[0], /No territory given: filed under/);
  const two = B.parseBulk('primary\tTrupanion is medical insurance for pets.\nheadline\tCalm, covered.', r);
  assert.deepEqual(two.rows.map(x => [x.persona, x.territory]), [['ALL', 'SHARED'], ['ALL', 'SHARED']]);
  // Artwork copy is persona-specific; unknown names and repeats are said, not guessed.
  const bad = B.parseBulk(['on-image\tSummer plans', 'Curators\tOWN_CALM\tprimary\tHello', 'OWN\tNope\theadline\tX', 'OWN\tOWN_CALM\ttagline\tX', 'OWN\tOWN_CALM\theadline\tSame', 'OWN\tOWN_CALM\theadline\tSame', 'OWN\tOWN_CALM\theadline\t'].join('\n'), r);
  assert.deepEqual(bad.errors.map(e => e.error.replace(/".*?"/g, '"…"')), [
    'On-image text is persona-specific: say which persona it is for', 'Unknown persona "…"', 'Unknown territory "…" for Example owners', 'Unknown field "…" (on-image, subhead, primary, headline, description, caption or hook)', 'The same line is in the table twice', 'No text',
  ]);
  assert.equal(bad.rows.length, 1);
  // Defaults fill what the table leaves out.
  assert.deepEqual(B.parseBulk('Summer plans, covered\nVet bills, sorted', r, { persona: 'FAM', territory: 'FAM_SUMMER', field: 'on-image' }).rows.map(x => [x.persona, x.territory, x.field]), [['FAM', 'FAM_SUMMER', 'meta_on_image'], ['FAM', 'FAM_SUMMER', 'meta_on_image']]);
});

test('check: a run per persona × territory, lines kept and attributed, and a report in plain words (Markdown and CSV)', async () => {
  const r = await fresh();
  const table = [
    'persona\tterritory\tfield\ttext',
    'FAM\tFAM_SUMMER\ton-image\tSummer plans, covered',
    'FAM\tFAM_SUMMER\tsubhead\tThe trip stays booked',
    'OWN\tOWN_CALM\tprimary\tHonestly, the policy pays for itself.',
    '\t\tprimary\tTrupanion is medical insurance for pets. Get a quote.',
    'OWN\tOWN_CALM\ttagline\tNot a field',
  ].join('\n');
  const parsed = B.parseBulk(table, r);
  const est = B.estimateBulk(parsed.rows);
  assert.deepEqual([est.lines, est.runs], [4, 3]);
  assert.ok(est.usd > 0 && est.seconds > 0, 'cost and time are shown first');

  const events: string[] = [];
  const rec = await B.runBulk(parsed, new S.Api({ mock: true }), { user: 'brook', for: 'Nick Larson', id: 'bulk-test' }, e => { if (e.type === 'status') events.push(e.message); });
  assert.equal(rec.runs.length, 3);
  assert.match(events[0], /Checking 2 lines for Busy Families/);
  // The lines are kept, entered by Brook, for Nick; the run says so too, and names its copy check.
  const fam = await S.loadBatch(rec.runs[0]);
  assert.deepEqual(fam.lines.map(l => [l.model, l.status, l.decision, l.added_by, l.added_for]), [['human', 'checked', 'keep', 'brook', 'Nick Larson'], ['human', 'checked', 'keep', 'brook', 'Nick Larson']]);
  assert.deepEqual([fam.created_by, fam.created_for, fam.bulk], ['brook', 'Nick Larson', 'bulk-test']);
  // Persona-less post copy is in the shared captions run; the shared pair is flagged, and left out of the persona pickers.
  const shared = await S.loadBatch(rec.runs[2]);
  assert.deepEqual([shared.brief.persona, shared.brief.territory], ['ALL', 'SHARED']);
  const meta = await S.meta();
  // The shared pair is in /meta, flagged, so a shared run opens like any other; the page's persona lists leave it out.
  assert.equal((meta.personas as any).ALL.shared, true);
  assert.equal((meta.territories as any).SHARED.shared, true);
  assert.deepEqual(meta.shared, { persona: 'ALL', territory: 'SHARED', name: 'Shared captions' });

  const rep = await B.bulkReport('bulk-test');
  assert.equal(rep.counts.checked, 4);
  assert.equal(rep.counts.red, 1);
  assert.match(rep.summary, /^4 checked · 1 red · \d amber · \d clear · 1 not checked$/);
  const red = rep.rows.find(x => x.status === 'red')!;
  assert.equal(red.text, 'Honestly, the policy pays for itself.');
  assert.ok(red.flags.some(f => f.severity === 'red' && /pays for itself/i.test(f.name) && f.quote === 'pays for itself'));
  assert.equal((await B.bulkReport()).id, 'bulk-test', 'the latest by default');

  const md = B.reportMd(rep);
  assert.match(md, /^# Copy check for Nick Larson/);
  assert.match(md, /## Example owners · /);
  assert.match(md, /- \*\*Red\*\* · Meta primary text · \d+\/\d+ characters/);
  assert.match(md, /Red: Never say it pays for itself \(“pays for itself”\)/);
  assert.match(md, /## Not checked\n\n- Row 6: Unknown field "tagline"/);
  const csv = S.parseCsv(B.reportCsv(rep));
  assert.deepEqual(csv[0], ['Persona', 'Territory', 'Region', 'Field', 'Text', 'Characters', 'Visible', 'Result', 'Flags', 'What a skeptic would say']);
  assert.equal(csv.length, 1 + 4 + 1, 'a row per line, and one for the row that could not be checked');
  assert.equal(csv.find(x => x[4] === 'Summer plans, covered')![0], 'Busy Families');
  assert.equal(csv.at(-1)![7], 'Not checked');
});
