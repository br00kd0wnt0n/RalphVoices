// Write & brief fields (Nick, 30 Sep: "when I request Meta on-image copy, I get
// a lot of TikTok hooks / primary text"). Defaults follow the territory's format;
// a new persona or territory keeps ticked fields; "only" ticks one; what
// Generate writes is what the summary said. File store, mock client. The
// page's field rules are frontend/src/lib/studioFields.ts (tested here, as
// ralphScore.test.ts tests the frontend's RalphScore mirror).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import { FileStore } from '../src/services/studio/store.js';
import { applyPlace, defaultFieldsFor, syncOwnLines, toggleField } from '../../frontend/src/lib/studioFields.js';

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fields-'));
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  rules.fields.meta_on_image = { platform: 'META', label: 'On-image text', visible: 40, max: 60, source: 'HOUSE: test', in_version: 'per_visual' };
  rules.fields.tiktok_caption = { platform: 'TIKTOK', label: 'TikTok caption', visible: 80, max: 150, source: 'HOUSE: test' };
  const base = rules.territories.OWN_CALM;
  rules.territories = {
    OWN_STATIC: { ...base, name: 'Static', format: 'STATIC' }, OWN_CARDS: { ...base, name: 'Cards', format: 'CAROUSEL' },
    OWN_VIDEO: { ...base, name: 'Video', format: 'VIDEO' }, OWN_CALM: base /* UGC */, OWN_TT: { ...base, name: 'TikTok', format: 'TIKTOK' },
    OWN_ODD: { ...base, name: 'Odd', format: 'BILLBOARD' },
  };
  rules.personas.OWN.default_fields = ['meta_primary', 'meta_headline', 'tiktok_hook'];
  const rulesPath = path.join(dir, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify(rules));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath }));
  return S.refreshRules();
}
const count = (lines: S.Line[]) => lines.reduce((m, l) => ({ ...m, [l.field]: (m[l.field] || 0) + 1 }), {} as Record<string, number>);

test('default fields follow the territory format, not the persona (the persona\'s only for an unknown format)', async () => {
  const r = await fresh();
  assert.deepEqual(S.defaultFields('OWN_STATIC', r), ['meta_primary', 'meta_headline', 'meta_on_image']);
  assert.deepEqual(S.defaultFields('OWN_CARDS', r), ['meta_primary', 'meta_headline', 'meta_on_image']);
  assert.deepEqual(S.defaultFields('OWN_VIDEO', r), ['meta_primary', 'meta_headline']);
  assert.deepEqual(S.defaultFields('OWN_CALM', r), ['meta_primary', 'meta_headline'], 'UGC');
  assert.deepEqual(S.defaultFields('OWN_TT', r), ['tiktok_hook', 'tiktok_caption']);
  assert.deepEqual(S.defaultFields('OWN_ODD', r), ['meta_primary', 'meta_headline', 'tiktok_hook'], 'unknown format: the persona\'s');
  assert.deepEqual(S.makeBrief({ territory: 'OWN_CARDS' }).fields, ['meta_primary', 'meta_headline', 'meta_on_image']);
  // /meta carries them for the page.
  const m = await S.meta();
  assert.deepEqual((m.territories as any).OWN_TT.default_fields, ['tiktok_hook', 'tiktok_caption']);
});

test('the page: defaults on load and on a new territory until the fields are touched; a persona change keeps ticked fields; "only"; own lines follow', async () => {
  await fresh();
  const meta = (await S.meta()) as any;
  assert.deepEqual(defaultFieldsFor(meta, 'OWN_TT'), ['tiktok_hook', 'tiktok_caption']);
  // First load: the territory's defaults, with a note.
  let { brief, note } = applyPlace(meta, { persona: 'OWN', territory: 'OWN_CARDS', fields: ['meta_primary', 'meta_headline', 'tiktok_hook'] }, {});
  assert.deepEqual(brief.fields, ['meta_primary', 'meta_headline', 'meta_on_image']);
  assert.equal(note, 'Fields set for a carousel: primary, headline, on-image');
  // Untouched: a new territory brings its defaults.
  ({ brief } = applyPlace(meta, brief, { territory: 'OWN_TT' }));
  assert.deepEqual(brief.fields, ['tiktok_hook', 'tiktok_caption']);
  // "Only" on-image: one field, marked as the person's choice; own lines move to it.
  brief = { ...brief, own_lines: [{ text: 'Mine.', field: 'tiktok_hook' }] };
  brief = toggleField(brief, 'meta_on_image', true);
  assert.deepEqual(brief.fields, ['meta_on_image']);
  assert.equal(brief.fields_touched, true);
  assert.deepEqual(brief.own_lines, [{ text: 'Mine.', field: 'meta_on_image' }]);
  // Touched: changing territory or persona keeps them, and says nothing.
  ({ brief, note } = applyPlace(meta, brief, { territory: 'OWN_VIDEO' }));
  assert.deepEqual([brief.fields, note], [['meta_on_image'], '']);
  ({ brief, note } = applyPlace(meta, brief, { persona: 'OWN' }));
  assert.deepEqual([brief.fields, note], [['meta_on_image'], '']);
  // Ticking adds; unticking the own line's field moves it to the first ticked one.
  brief = toggleField(brief, 'meta_primary');
  assert.deepEqual(brief.fields, ['meta_on_image', 'meta_primary']);
  brief = toggleField(brief, 'meta_on_image');
  assert.deepEqual(brief.own_lines, [{ text: 'Mine.', field: 'meta_primary' }]);
  assert.deepEqual(syncOwnLines([{ text: '', field: 'x' }], []), [{ text: '', field: 'x' }], 'nothing ticked: left alone');
});

test('only on-image on a static territory: every line written is on-image, as many as the summary says', async () => {
  await fresh();
  const b = S.makeBrief({ territory: 'OWN_STATIC', fields: ['meta_on_image'], n: 8 });
  const a = S.allocation(b);
  assert.equal(a.summary, '8 lines: 8 on-image');
  const run = await S.generate(b, new S.Api({ mock: true }), () => {}, { user: 'nick' });
  assert.deepEqual(count(run.lines), { meta_on_image: 8 });
});

test('only on-image on a carousel territory: card sequences only, nothing else', async () => {
  await fresh();
  const b = S.makeBrief({ territory: 'OWN_CARDS', fields: ['meta_on_image'], n: 20, carousel: { sequences: 3, cards: 4 } });
  assert.equal(S.allocation(b).summary, '12 lines: 3 card sequences × 4 cards (on-image)');
  const run = await S.generate(b, new S.Api({ mock: true }), () => {}, { user: 'nick' });
  assert.equal(run.lines.length, 12);
  assert.ok(run.lines.every(l => l.field === 'meta_on_image' && l.sequence_id && l.card));
});

test('the summary matches the batch: 20 lines on a carousel = 3 × 4 cards + 4 primary + 4 headline', async () => {
  await fresh();
  const b = S.makeBrief({ territory: 'OWN_CARDS', n: 20, carousel: { sequences: 3, cards: 4 } });
  assert.deepEqual(b.fields, ['meta_primary', 'meta_headline', 'meta_on_image']);
  const a = S.allocation(b);
  assert.equal(a.summary, '20 lines: 3 card sequences × 4 cards (on-image) · 4 primary · 4 headline');
  const run = await S.generate(b, new S.Api({ mock: true }), () => {}, { user: 'nick' });
  assert.deepEqual(count(run.lines), { meta_primary: 4, meta_headline: 4, meta_on_image: 12 });
  // Uneven shares go to the first ticked fields; the estimate returns the same allocation.
  assert.deepEqual(S.fieldQuota(S.makeBrief({ territory: 'OWN_VIDEO', n: 7 })), { meta_primary: 4, meta_headline: 3 });
  const tt = S.makeBrief({ territory: 'OWN_TT', n: 10 });
  const ttRun = await S.generate(tt, new S.Api({ mock: true }), () => {}, { user: 'nick' });
  assert.deepEqual(count(ttRun.lines), Object.fromEntries(S.allocation(tt).fields.map(x => [x.field, x.count])));
});
