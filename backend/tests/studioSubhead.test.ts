// The on-image subhead (rules v2.14 meta_on_image_sub; Brook, 1 Oct): optional, under the on-image headline, per
// visual and per carousel card. Planned and signed off with the visual, listed in the handoffs and the compliance
// sheet, checked for repeating its headline's words, and matched on the finished asset (red if missing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import * as R from '../src/services/studio/ready.js';
import { FileStore } from '../src/services/studio/store.js';
import { copyMatchForStub } from '../src/services/studio/preflight.js';
import { isSubField } from '../src/services/studio/versions.js';

const ON_IMAGE = { platform: 'META', label: 'On-image text', visible: 40, max: 60, source: 'HOUSE: test', in_version: 'per_visual' };
const SUB = { platform: 'META', label: 'On-image subhead', visible: 60, max: 90, source: 'HOUSE: test', in_version: 'per_visual', on_image_role: 'sub' };

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sub-'));
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  rules.fields.meta_on_image = ON_IMAGE;
  rules.fields.meta_on_image_sub = SUB;
  rules.territories.OWN_STILL = { ...rules.territories.OWN_CALM, name: 'Still', format: 'STATIC' };
  rules.territories.OWN_CARDS = { ...rules.territories.OWN_CALM, name: 'Cards', format: 'CAROUSEL' };
  const rulesPath = path.join(dir, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify(rules));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath }));
  return S.refreshRules();
}
async function kept(territory: string, lines: Array<[string, string]>) {
  const run = await S.generate(S.makeBrief({ territory, name: territory, own_lines: lines.map(([field, text]) => ({ field, text })) }), new S.Api({ mock: true }), () => {}, { ownOnly: true, user: 'nick' });
  for (const l of run.lines) {
    await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
    for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line', 'nick');
  }
  return run.lines.map(l => l.id);
}

test('the subhead field: per visual, told apart from the headline; Write offers it for statics and carousels', async () => {
  const r = await fresh();
  assert.equal(isSubField('meta_on_image_sub', r), true);
  assert.equal(isSubField('meta_on_image', r), false);
  assert.deepEqual(S.defaultFields('OWN_STILL', r), ['meta_primary', 'meta_headline', 'meta_on_image', 'meta_on_image_sub']);
  // A carousel's card sequences are written for the headline field, never the subhead.
  assert.equal(S.sequenceField(S.makeBrief({ territory: 'OWN_CARDS', fields: ['meta_on_image_sub', 'meta_on_image'], carousel: { sequences: 1, cards: 4 } }), r), 'meta_on_image');
});

test('a static: headline + subhead planned and signed off with the visual; handoff and compliance sheet carry the subhead', async () => {
  await fresh();
  const [p, h, oi, sub] = await kept('OWN_STILL', [['meta_primary', 'Trupanion pays the vet at partner clinics.'], ['meta_headline', 'Calm, covered.'], ['meta_on_image', 'Vet visits, calmer'], ['meta_on_image_sub', 'Medical insurance for your whole household']]);
  const versions = [{ visual: 'A', fields: { meta_primary: p, meta_headline: h } }];
  const v = await R.readyView('OWN', 'OWN_STILL', 'US', { versions, on_image: { A: oi }, on_image_sub: { A: sub } });
  assert.deepEqual(v.plan.issues, []);
  assert.deepEqual(v.plan.on_image.map(o => [o.line_id, !!o.sub]), [[oi, false], [sub, true]]);
  // A subhead with no headline above it, or a headline in the subhead slot, isn't a plan.
  assert.match((await R.readyView('OWN', 'OWN_STILL', 'US', { versions, on_image: {}, on_image_sub: { A: sub } })).plan.issues.join(), /a subhead needs an on-image headline above it/);
  assert.match((await R.readyView('OWN', 'OWN_STILL', 'US', { versions, on_image: { A: oi }, on_image_sub: { A: oi } })).plan.issues.join(), /is a headline, not a subhead/);

  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_STILL', versions, on_image: { A: oi }, on_image_sub: { A: sub }, expectation: { codes: [v.plan.versions[0].code], reason: 'x' } }, 'nick');
  assert.deepEqual(signoff.on_image!.map(o => o.field), ['meta_on_image', 'meta_on_image_sub']);
  // Reopened, the sign-off comes back as headline and subhead in their own slots.
  assert.deepEqual((await R.readyView('OWN', 'OWN_STILL')).draft.on_image_sub, { A: sub });
  const pack = await R.handoffPack();
  const csv = S.parseCsv(pack.csv), comp = S.parseCsv(pack.complianceCsv);
  assert.equal(csv[1][csv[0].indexOf('On-image text (the visual)')], 'Vet visits, calmer');
  assert.equal(csv[1][csv[0].indexOf('On-image subhead')], 'Medical insurance for your whole household');
  assert.equal(comp[1][comp[0].indexOf('On-image subhead')], 'Medical insurance for your whole household');
  assert.match(pack.md, /On-image subhead: Medical insurance for your whole household/);
});

test('a carousel: an optional subhead per card; the handoff lists it after its card', async () => {
  await fresh();
  const [p, h, c1, c2, c3, s2] = await kept('OWN_CARDS', [['meta_primary', 'Trupanion pays the vet at partner clinics.'], ['meta_headline', 'Calm, covered.'], ['meta_on_image', 'Vet bill at 2am?'], ['meta_on_image', 'You pay the vet as normal'], ['meta_on_image', 'We sort the rest'], ['meta_on_image_sub', 'At partner clinics, the vet is paid directly']]);
  const versions = [{ visual: 'A', fields: { meta_primary: p, meta_headline: h } }];
  const draft = { versions, on_image: { A: [c1, c2, c3] }, on_image_sub: { A: ['', s2] } };
  const v = await R.readyView('OWN', 'OWN_CARDS', 'US', draft);
  assert.deepEqual(v.plan.issues, [], 'subheads are optional card by card (card 1 has none)');
  assert.deepEqual(v.plan.on_image.filter(o => o.sub).map(o => [o.card, o.line_id]), [[2, s2]]);
  assert.match((await R.readyView('OWN', 'OWN_CARDS', 'US', { versions, on_image: { A: [c1, c2, c3] }, on_image_sub: { A: ['', '', '', s2] } })).plan.issues.join(), /card 4 has a subhead but no headline/);
  await R.signOff({ persona: 'OWN', territory: 'OWN_CARDS', ...draft, expectation: { codes: [v.plan.versions[0].code], reason: 'x' } }, 'nick');
  const csv = S.parseCsv((await R.handoffPack()).csv);
  assert.deepEqual(['On-image card 1', 'On-image card 1 subhead', 'On-image card 2', 'On-image card 2 subhead'].map(c => csv[1][csv[0].indexOf(c)]), ['Vet bill at 2am?', '', 'You pay the vet as normal', 'At partner clinics, the vet is paid directly']);
});

test('version checks: a subhead repeating its headline\'s words is "fields repeat"; the brand and category may be shared', async () => {
  await fresh();
  const [p, h, oi, rep, ok] = await kept('OWN_STILL', [['meta_primary', 'Trupanion pays the vet at partner clinics.'], ['meta_headline', 'Calm, covered.'], ['meta_on_image', 'Surprise vet bills, sorted'], ['meta_on_image_sub', 'Every surprise covered by Trupanion'], ['meta_on_image_sub', 'Trupanion, medical insurance for pets']]);
  const versions = [{ visual: 'A', fields: { meta_primary: p, meta_headline: h } }];
  const flagsWith = async (sub: string) => (await R.readyView('OWN', 'OWN_STILL', 'US', { versions, on_image: { A: oi }, on_image_sub: { A: sub } })).plan.versions[0].checks!.flags.filter(f => f.rule === 'VERSION_REPEAT' && f.fields.includes('meta_on_image_sub'));
  const bad = await flagsWith(rep);
  assert.equal(bad.length, 1);
  assert.match(bad[0].why!, /The subhead repeats "surprise" from the headline/);
  assert.deepEqual(await flagsWith(ok), [], 'Trupanion and the category are fine in both');
});

test('Pre-flight copy match: the subhead must be on the asset (red if not), as must each card\'s subhead', () => {
  const copy = (field: string, text: string, card?: number) => ({ line_id: `${field}${card || ''}`, field, label: field, text, version: 1, ...(card ? { card } : {}) });
  const statics = [copy('meta_on_image', 'Vet visits, calmer'), copy('meta_on_image_sub', 'Medical insurance for your whole household'), copy('meta_primary', 'Post copy')];
  const both = copyMatchForStub(statics, [{ where: 'image', text: 'VET VISITS, CALMER\nMedical insurance for your whole household' }], { compliance: [] }, 'static');
  assert.deepEqual(both.flags, []);
  const missing = copyMatchForStub(statics, [{ where: 'image', text: 'Vet visits, calmer' }], { compliance: [] }, 'static');
  assert.deepEqual(missing.flags.map(f => [f.rule, f.severity, f.label]), [['COPY_MATCH', 'red', 'On-image subhead (signed off) not found on the asset']]);
  // A carousel: card 2's subhead is matched on card 2.
  const cards = [copy('meta_on_image', 'Vet bill at 2am?', 1), copy('meta_on_image', 'You pay the vet as normal', 2), copy('meta_on_image_sub', 'At partner clinics', 2)];
  const onCards = (two: string) => [{ where: 'card 1', text: 'Vet bill at 2am?' }, { where: 'card 2', text: two }];
  assert.deepEqual(copyMatchForStub(cards, onCards('You pay the vet as normal. At partner clinics'), { compliance: [] }, 'carousel').flags, []);
  const noSub = copyMatchForStub(cards, onCards('You pay the vet as normal'), { compliance: [] }, 'carousel');
  assert.deepEqual(noSub.flags.map(f => [f.rule, f.severity, f.label]), [['COPY_CARD_MISSING', 'red', "Card 2's signed-off subhead isn't on the asset"]]);
});
