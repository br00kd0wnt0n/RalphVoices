// Carousel cards (item E, 30 Sep): on a CAROUSEL territory, on-image text is
// written as card sequences, placed card by card at Ready (shared by every
// version on the visual), checked across cards, and handed off in card order.
// File store, mock client, example rules plus meta_on_image and a carousel
// territory. Pre-flight's card-by-card match is in studioPg.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import * as R from '../src/services/studio/ready.js';
import { FileStore } from '../src/services/studio/store.js';
import { _test as VC } from '../src/services/studio/versionChecks.js';
import { cardMatch } from '../src/services/studio/preflight.js';

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-carousel-'));
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  rules.fields.meta_on_image = { platform: 'META', label: 'On-image text', visible: 40, max: 60, source: 'HOUSE: test', in_version: 'per_visual' };
  rules.territories.OWN_CARDS = { ...rules.territories.OWN_CALM, name: 'Calm, card by card', format: 'CAROUSEL' };
  const rulesPath = path.join(dir, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify(rules));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath }));
  VC.clear();
  return S.refreshRules();
}
async function keepAll(run: S.Batch) {
  for (const l of run.lines) {
    await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
    for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line', 'nick');
  }
}
const own = (texts: Array<[string, string]>) => texts.map(([field, text]) => ({ field, text }));

test('a carousel brief writes card sequences: each card a line with its card number and sequence; other fields as loose lines', async () => {
  await fresh();
  const b = S.makeBrief({ territory: 'OWN_CARDS', fields: ['meta_primary', 'meta_headline', 'meta_on_image'], n: 4, carousel: { sequences: 2, cards: 4 } });
  assert.deepEqual(b.carousel, { sequences: 2, cards: 4 });
  assert.equal(S.makeBrief({ territory: 'OWN_CALM', fields: ['meta_on_image'] }).carousel, undefined, 'not a carousel territory');
  assert.equal(S.makeBrief({ territory: 'OWN_CARDS', fields: ['meta_primary'] }).carousel, undefined, 'on-image not ticked');
  assert.deepEqual(S.makeBrief({ territory: 'OWN_CARDS', fields: ['meta_on_image'], carousel: { sequences: 9, cards: 14 } }).carousel, { sequences: 6, cards: 10 }, 'capped');
  const est = S.estimate(b);
  assert.ok(est.usd > S.estimate({ ...b, carousel: undefined, fields: ['meta_primary', 'meta_headline'] }).usd, 'the sequences are priced');

  const api = new S.Api({ mock: true });
  const users: string[] = [];
  const chat = api.chat.bind(api);
  api.chat = (async (o: any) => { if (o.stage === 'generate') users.push(o.user); return chat(o); }) as any;
  const run = await S.generate(b, api, () => {}, { user: 'nick' });
  const seq = run.lines.filter(l => l.sequence_id);
  assert.equal(seq.length, 8);
  assert.ok(seq.every(l => l.field === 'meta_on_image' && l.card! >= 1 && l.card! <= 4 && l.status === 'checked'));
  assert.equal(new Set(seq.map(l => l.sequence_id)).size, 2);
  assert.deepEqual(seq.filter(l => l.sequence_id === seq[0].sequence_id).map(l => l.card), [1, 2, 3, 4]);
  assert.ok(run.lines.filter(l => !l.sequence_id).every(l => l.field !== 'meta_on_image'), 'no loose on-image lines on a carousel');
  const prompt = users.find(u => /^CAROUSEL SEQUENCES/.test(u))!;
  assert.match(prompt, /write 2 carousel card sequences of 4 cards each/);
  assert.match(prompt, /card 1 is the hook/);
  assert.match(prompt, /ONE idea/);
  assert.ok(!users.filter(u => !/^CAROUSEL/.test(u)).some(u => /field meta_on_image/.test(u)), 'the cell grid leaves on-image to the sequences');
});

test('Ready: a sequence becomes visual A\'s cards (shared by A1–A3), cards can be swapped and reordered, and the handoff lists them in order', async () => {
  await fresh();
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CARDS', name: 'cards', own_lines: own([
    ['meta_primary', 'Calm at the counter, every single visit.'], ['meta_primary', 'One less worry on a Sunday night.'], ['meta_primary', 'Home by nine, bill sorted.'],
    ['meta_headline', 'Calm, covered.'],
  ]) }), new S.Api({ mock: true }), () => {}, { ownOnly: true, user: 'nick' });
  // A sequence as the generator stores it.
  const seq = await S.generate(S.makeBrief({ territory: 'OWN_CARDS', fields: ['meta_on_image'], carousel: { sequences: 1, cards: 4 } }), new S.Api({ mock: true }), () => {}, { batchId: run.id, user: 'nick' });
  await keepAll(seq);
  const cards = seq.lines.filter(l => l.sequence_id).sort((a, b) => a.card! - b.card!).map(l => l.id);
  assert.equal(cards.length, 4);

  const v = await R.readyView('OWN', 'OWN_CARDS');
  assert.deepEqual(v.draft.on_image, { A: cards }, 'the sequence, card by card, on visual A');
  assert.deepEqual(v.plan.versions.map(x => x.code), ['OWN_CARDS_CAR_A1_US_META', 'OWN_CARDS_CAR_A2_US_META', 'OWN_CARDS_CAR_A3_US_META']);
  assert.deepEqual(v.plan.on_image.map(o => [o.card, o.line_id]), cards.map((id, i) => [i + 1, id]));
  assert.deepEqual(v.lines.find(x => x.line.id === cards[1])!.in, ['on-image A card 2']);

  // Swap cards 2 and 3, and leave card 4 empty: an empty card blocks sign-off (set three cards instead).
  const swapped = [cards[0], cards[2], cards[1], ''];
  const sv = await R.readyView('OWN', 'OWN_CARDS', 'US', { versions: v.draft.versions, on_image: { A: swapped } });
  assert.deepEqual(sv.plan.on_image.map(o => [o.card, o.line_id]), [[1, cards[0]], [2, cards[2]], [3, cards[1]]]);
  assert.deepEqual(sv.plan.issues, ['On-image, visual A: card 4 is empty (choose its text, or set fewer cards)']);
  assert.deepEqual((await R.readyView('OWN', 'OWN_CARDS', 'US', { versions: v.draft.versions, on_image: { A: swapped.slice(0, 3) } })).plan.issues, []);
  // Cards only on a carousel; at most 10.
  assert.match((await R.readyView('OWN', 'OWN_CARDS', 'US', { versions: v.draft.versions, on_image: { A: Array(11).fill(cards[0]) } })).plan.issues.join(), /at most 10 cards/);

  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CARDS', versions: v.draft.versions, on_image: { A: swapped.slice(0, 3) }, expectation: { codes: ['OWN_CARDS_CAR_A1_US_META'], reason: 'Hook first.' } }, 'nick');
  assert.deepEqual(signoff.on_image!.map(o => [o.card, o.line_id, o.visual_key]), [[1, cards[0], 'OWN_CARDS_CAR_A_US_META'], [2, cards[2], 'OWN_CARDS_CAR_A_US_META'], [3, cards[1], 'OWN_CARDS_CAR_A_US_META']]);
  // Signed off again unchanged: the default draft brings the cards back as they were signed.
  assert.deepEqual((await R.readyView('OWN', 'OWN_CARDS')).draft.on_image, { A: [cards[0], cards[2], cards[1]] });

  const pack = await R.handoffPack();
  const csv = S.parseCsv(pack.csv);
  const h = csv[0];
  assert.deepEqual(h.filter(c => /^On-image card/.test(c)), ['On-image card 1', 'On-image card 2', 'On-image card 3']);
  const text = (id: string) => seq.lines.find(l => l.id === id)!.text;
  for (const row of csv.slice(1)) assert.deepEqual([1, 2, 3].map(k => row[h.indexOf(`On-image card ${k}`)]), [text(cards[0]), text(cards[2]), text(cards[1])], 'every code repeats the card set');
  assert.match(pack.md, /Carousel cards, in order:\n\n1\. .*\n2\. .*\n3\. /);
  assert.ok(S.parseCsv(pack.complianceCsv)[0].includes('On-image card 1'));
});

test('version checks across cards: card 2 restating card 1, the end card contradicting the hook, a claim on one card with its caveat on another (red)', async () => {
  await fresh();
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CARDS', name: 'vc', own_lines: own([
    ['meta_primary', 'Calm at the counter, every single visit.'], ['meta_headline', 'Calm, covered.'],
    ['meta_on_image', 'Your vet gets paid at checkout'], ['meta_on_image', 'Your vet gets paid at checkout, really'],
    ['meta_on_image', 'Only at partner clinics'], ['meta_on_image', 'We reimburse you later'],
  ]) }), new S.Api({ mock: true }), () => {}, { ownOnly: true, user: 'nick' });
  await keepAll(run);
  const [p, h, c1, c2, c3, c4] = run.lines.map(l => l.id);
  const draft = { versions: [{ visual: 'A', fields: { meta_primary: p, meta_headline: h } }], on_image: { A: [c1, c2, c3, c4] } };
  let v = (await R.readyView('OWN', 'OWN_CARDS', 'US', draft)).plan.versions[0];
  const rep = v.checks!.flags.find(f => f.rule === 'VERSION_REPEAT' && f.fields.includes('meta_on_image#1') && f.fields.includes('meta_on_image#2'))!;
  assert.ok(rep, 'card 2 restating card 1');
  assert.match(rep.label, /On-image text, card 1 and On-image text, card 2 say the same thing/);
  const split = v.checks!.flags.find(f => f.rule === 'COMP_DIRECT_PAY' && f.fields[0] === 'meta_on_image#1')!;
  assert.equal(split.severity, 'red');
  assert.match(split.why!, /Claim in On-image text, card 1, caveat only in On-image text, card 3/);
  // The model's conflicts check sees the cards as fields of the ad.
  const view = await R.checkDraft('OWN', 'OWN_CARDS', 'US', draft, new S.Api({ mock: true }));
  v = view.plan.versions[0];
  const c = v.checks!.flags.find(f => f.rule === 'VERSION_CONFLICT')!;
  assert.ok(c, 'the end card contradicts the hook');
  assert.ok(c.fields.includes('meta_on_image#4'));
});

test('Pre-flight card match: in order passes, a card on the wrong card is amber, a card missing from the asset is red', () => {
  const copy = [1, 2, 3].map(k => ({ line_id: `L${k}`, field: 'meta_on_image', label: `On-image text, card ${k}`, text: ['Vet bill at 2am?', 'You pay the vet as normal', 'We sort the rest'][k - 1], version: 1, card: k }));
  const read = (texts: string[]) => texts.map((t, i) => ({ where: `card ${i + 1}`, text: t }));
  const ok = cardMatch(copy, read(['VET BILL AT 2AM?', 'You pay the vet as normal.', 'We sort the rest', 'Terms apply']));
  assert.deepEqual(ok.rows.map(r => r.status), ['match', 'match', 'match']);
  assert.equal(ok.flags.length, 0);
  const swapped = cardMatch(copy, read(['Vet bill at 2am?', 'We sort the rest', 'You pay the vet as normal']));
  assert.deepEqual(swapped.flags.map(f => [f.rule, f.severity, f.why]), [['COPY_CARD_ORDER', 'amber', 'On card 3, expected card 2'], ['COPY_CARD_ORDER', 'amber', 'On card 2, expected card 3']]);
  assert.equal(swapped.flags[0].frame!.asset_position, 2, 'points at the card it was found on');
  const missing = cardMatch(copy, read(['Vet bill at 2am?', 'You pay the vet as normal', 'Summer, sorted']));
  assert.deepEqual(missing.flags.map(f => [f.rule, f.severity]), [['COPY_CARD_MISSING', 'red']]);
  assert.match(missing.flags[0].why!, /Card 3 reads: "Summer, sorted"/);
  const reworded = cardMatch(copy, read(['Vet bill at 2am?', 'You pay the vet like normal', 'We sort the rest']));
  assert.deepEqual(reworded.flags.map(f => [f.rule, f.severity]), [['COPY_MATCH', 'amber']]);
});

test('per-field counts on a carousel: the on-image count gives way to the card sequences; the other fields keep theirs', async () => {
  await fresh();
  const b = S.makeBrief({ territory: 'OWN_CARDS', fields: ['meta_primary', 'meta_headline', 'meta_on_image'], field_counts: { meta_primary: 3, meta_headline: 2, meta_on_image: 4 }, carousel: { sequences: 1, cards: 3 }, name: 'cards-counts' });
  assert.deepEqual(S.looseCounts(b, 'meta_on_image'), { field_counts: { meta_primary: 3, meta_headline: 2 }, n: 5 });
  const run = await S.generate(b, new S.Api({ mock: true }));
  const loose = (f: string) => run.lines.filter(l => l.field === f && !l.sequence_id && l.model !== 'human').length;
  assert.equal(loose('meta_primary'), 3);
  assert.equal(loose('meta_headline'), 2);
  assert.equal(loose('meta_on_image'), 0, 'no loose on-image lines on a carousel');
  assert.equal(run.lines.filter(l => l.sequence_id).length, 3, 'one sequence of three cards');
});

test('a carousel with a blank card is not finished: sign-off is blocked, naming the card (production test, 1 Oct)', async () => {
  await fresh();
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CARDS', name: 'blank', own_lines: own([
    ['meta_primary', 'Calm at the counter, every single visit.'], ['meta_headline', 'Calm, covered.'],
    ['meta_on_image', 'Vet bill at 2am?'], ['meta_on_image', 'We sort the rest'], ['meta_on_image', 'Calm, covered.'],
  ]) }), new S.Api({ mock: true }), () => {}, { ownOnly: true, user: 'nick' });
  await keepAll(run);
  const [p, h, c1, c3, c4] = run.lines.map(l => l.id);
  const blank = (await R.readyView('OWN', 'OWN_CARDS', 'US', { versions: [{ visual: 'A', fields: { meta_primary: p, meta_headline: h } }], on_image: { A: [c1, '', c3, c4] } })).plan;
  assert.ok(blank.issues.includes('On-image, visual A: card 2 is empty (choose its text, or set fewer cards)'));
  // Three cards, all chosen: fine.
  const three = (await R.readyView('OWN', 'OWN_CARDS', 'US', { versions: [{ visual: 'A', fields: { meta_primary: p, meta_headline: h } }], on_image: { A: [c1, c3, c4] } })).plan;
  assert.ok(!three.issues.some(i => /empty/.test(i)));
});
