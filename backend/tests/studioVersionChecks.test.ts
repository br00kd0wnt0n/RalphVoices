// Version checks at Ready (Nick, 30 Sep): repeats, too alike, conflicts (model),
// split claims. Flags inform, never block; shown per version, re-checked when the
// wording changes, stored in the sign-off. Also: a TikTok version (caption
// required, hook optional). File store, mock client, example rules plus
// meta_on_image and tiktok_caption.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import * as R from '../src/services/studio/ready.js';
import { FileStore } from '../src/services/studio/store.js';
import { _test as VC } from '../src/services/studio/versionChecks.js';

async function fresh(own: Array<{ text: string; field: string }>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-vchecks-'));
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  rules.fields.meta_on_image = { platform: 'META', label: 'On-image text', visible: 40, max: 60, source: 'HOUSE: test' };
  rules.fields.tiktok_caption = { platform: 'TIKTOK', label: 'TikTok caption', visible: 80, max: 150, source: 'HOUSE: test' };
  const rulesPath = path.join(dir, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify(rules));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath }));
  await S.refreshRules();
  VC.clear();
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'vc', own_lines: own }), new S.Api({ mock: true }), () => {}, { ownOnly: true, user: 'nick' });
  for (const l of run.lines) {
    await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
    for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line', 'nick');
  }
  const id = (text: string) => run.lines.find(l => l.text === text)!.id;
  return { run, id };
}
const view = (versions: any[], on_image: Record<string, string> = {}) => R.readyView('OWN', 'OWN_CALM', 'US', { versions, on_image });
const meta = (p: string, h: string, visual = 'A') => ({ visual, fields: { meta_primary: p, meta_headline: h } });
const flagsOf = (v: any, rule: string) => v.checks.flags.filter((f: any) => f.rule === rule);
/** A mock client that records the stages it was called for. */
function recording() {
  const api = new S.Api({ mock: true });
  const stages: string[] = [];
  const chat = api.chat.bind(api);
  api.chat = (async (o: any) => { stages.push(o.stage); return chat(o); }) as any;
  return { api, stages };
}

test('1. repeats: two fields of one ad saying the same thing get an amber flag quoting the overlap', async () => {
  const { id } = await fresh([
    { text: 'Calm at the counter, every single visit.', field: 'meta_primary' },
    { text: 'Calm at the counter', field: 'meta_headline' },
    { text: 'One less worry.', field: 'meta_headline' },
  ]);
  const v = await view([meta(id('Calm at the counter, every single visit.'), id('Calm at the counter')), meta(id('Calm at the counter, every single visit.'), id('One less worry.'))]);
  const [a, b] = v.plan.versions;
  const rep = flagsOf(a, 'VERSION_REPEAT');
  assert.equal(rep.length, 1);
  assert.equal(rep[0].severity, 'amber');
  assert.equal(rep[0].quote, 'calm at the counter');
  assert.deepEqual(rep[0].fields, ['meta_primary', 'meta_headline']);
  assert.match(rep[0].source, /Nick, 30 Sep/);
  assert.equal(flagsOf(b, 'VERSION_REPEAT').length, 0);
});

test('2. too alike: two versions on one visual that are near-duplicates are flagged on both; on different visuals they are not', async () => {
  const { id } = await fresh([
    { text: 'Calm at the counter, every single visit.', field: 'meta_primary' },
    { text: 'Calm at the counter on every single visit.', field: 'meta_primary' },
    { text: 'The summer trip stays booked when the vet bill lands.', field: 'meta_primary' },
    { text: 'One less worry.', field: 'meta_headline' },
  ]);
  const [p1, p2, p3, h] = ['Calm at the counter, every single visit.', 'Calm at the counter on every single visit.', 'The summer trip stays booked when the vet bill lands.', 'One less worry.'].map(id);
  let v = await view([meta(p1, h), meta(p2, h), meta(p3, h)]);
  const [a1, a2, a3] = v.plan.versions;
  assert.equal(flagsOf(a1, 'VERSION_TOO_ALIKE')[0].other, a2.code);
  assert.equal(flagsOf(a2, 'VERSION_TOO_ALIKE')[0].other, a1.code);
  assert.match(flagsOf(a1, 'VERSION_TOO_ALIKE')[0].why, /Similarity [01]\.\d\d; threshold 0\.85/);
  assert.equal(flagsOf(a3, 'VERSION_TOO_ALIKE').length, 0);
  v = await view([meta(p1, h, 'A'), meta(p2, h, 'B')]);
  assert.ok(v.plan.versions.every((x: any) => !flagsOf(x, 'VERSION_TOO_ALIKE').length), 'different visuals are different ads anyway');
});

test('3. conflicts: one model call per version (stage version-check), priced first, kept per wording, re-checked on change, stored in the sign-off', async () => {
  const { run, id } = await fresh([
    { text: 'Your vet is paid directly at partner clinics.', field: 'meta_primary' },
    { text: 'We reimburse you fast.', field: 'meta_headline' },
    { text: 'Calm, covered.', field: 'meta_headline' },
  ]);
  const [p, h1, h2] = ['Your vet is paid directly at partner clinics.', 'We reimburse you fast.', 'Calm, covered.'].map(id);
  const draft = [meta(p, h1), meta(p, h2), { visual: 'A', fields: { meta_primary: p } }];
  let v = await view(draft);
  assert.equal(v.plan.check_estimate.calls, 2, 'the incomplete version is not checked');
  assert.ok(v.plan.check_estimate.usd > 0 && v.plan.check_estimate.usd < 0.02, `priced: $${v.plan.check_estimate.usd}`);
  assert.ok(v.plan.versions.every((x: any) => x.checks.conflicts === 'not_checked'));

  const { api, stages } = recording();
  v = await R.checkDraft('OWN', 'OWN_CALM', 'US', { versions: draft, on_image: {} }, api);
  assert.deepEqual(stages, ['version-check', 'version-check']);
  const [a1, a2, a3] = v.plan.versions;
  assert.equal(a1.checks.conflicts, 'checked');
  const c = flagsOf(a1, 'VERSION_CONFLICT');
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].severity, c[0].by, c[0].quote], ['amber', 'model', 'reimburse']);
  assert.deepEqual(c[0].fields, ['meta_primary', 'meta_headline']);
  assert.ok(c[0].why.split(' ').length <= 12);
  assert.equal(flagsOf(a2, 'VERSION_CONFLICT').length, 0);
  assert.equal(a3.checks.conflicts, 'not_checked');
  assert.equal(v.plan.check_estimate.calls, 0, 'nothing left to check');

  // Same wording again: no new calls. A changed wording is checked again.
  await R.checkDraft('OWN', 'OWN_CALM', 'US', { versions: draft.slice(0, 2), on_image: {} }, api);
  assert.equal(stages.length, 2);
  await S.setDecision(run.id, h2, { decision: 'edit', edited_text: 'Calm, and covered.' }, 'nick');
  v = await view(draft.slice(0, 2));
  assert.equal(v.plan.versions[1].checks.conflicts, 'not_checked', 'edited: needs checking again');
  assert.equal(v.plan.check_estimate.calls, 1);

  // Signing off runs what's left and stores every version's checks; the flag doesn't block.
  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: draft.slice(0, 2), expectation: { codes: [a2.code], reason: 'Plain.' } }, 'nick', { api });
  assert.equal(stages.length, 3);
  assert.equal(signoff.checks!.length, 2);
  assert.ok(signoff.checks!.every(x => x.conflicts === 'checked'));
  assert.equal(signoff.checks!.find(x => x.code === a1.code)!.flags.filter(f => f.rule === 'VERSION_CONFLICT').length, 1);
  // After a restart the answers come back from the sign-off: nothing to pay for again.
  VC.clear();
  assert.equal((await view(draft.slice(0, 2))).plan.check_estimate.calls, 0);
});

test('4. split claims: a direct-pay claim in one field with the caveat only in another (or on the image) is red, with the rule\'s id and source; it never blocks', async () => {
  const { id } = await fresh([
    { text: 'Your vet gets paid at checkout.', field: 'meta_primary' },
    { text: 'Only at partner clinics.', field: 'meta_headline' },
    { text: 'Calm, covered.', field: 'meta_headline' },
    { text: 'Partner clinics only', field: 'meta_on_image' },
    { text: 'Paid at checkout at partner clinics.', field: 'meta_primary' },
  ]);
  const [p, hCaveat, h, img, pOk] = ['Your vet gets paid at checkout.', 'Only at partner clinics.', 'Calm, covered.', 'Partner clinics only', 'Paid at checkout at partner clinics.'].map(id);
  let v = await view([meta(p, hCaveat), meta(p, h), meta(pOk, h)]);
  const [a1, a2, a3] = v.plan.versions;
  const s1 = flagsOf(a1, 'COMP_DIRECT_PAY');
  assert.equal(s1.length, 1);
  assert.deepEqual([s1[0].severity, s1[0].quote, s1[0].source], ['red', 'at checkout', 'LEGAL §3']);
  assert.deepEqual(s1[0].fields, ['meta_primary', 'meta_headline']);
  assert.equal(s1[0].why, 'Claim in Meta primary text, caveat only in Meta headline');
  assert.equal(flagsOf(a2, 'COMP_DIRECT_PAY')[0].why, 'The caveat is nowhere in this ad');
  assert.equal(flagsOf(a3, 'COMP_DIRECT_PAY').length, 0, 'claim and caveat together: fine');
  // The visual's on-image text is part of the ad.
  v = await view([meta(p, h)], { A: img });
  assert.equal(flagsOf(v.plan.versions[0], 'COMP_DIRECT_PAY')[0].why, 'Claim in Meta primary text, caveat only in On-image text');
  // Flags inform: the sign-off goes through (the line's own red flag was overridden).
  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: [meta(p, hCaveat)], expectation: { codes: [a1.code], reason: 'x' } }, 'nick');
  assert.equal(signoff.checks![0].flags[0].rule, 'COMP_DIRECT_PAY');
});

test('5. TikTok: a version needs a caption, the hook is optional; its code is _TT', async () => {
  const { id } = await fresh([
    { text: 'Vet bills, sorted before they happen.', field: 'tiktok_caption' },
    { text: 'POV: the vet bill', field: 'tiktok_hook' },
  ]);
  const cap = id('Vet bills, sorted before they happen.'), hook = id('POV: the vet bill');
  let v = await view([{ visual: 'A', fields: { tiktok_hook: hook } }]);
  assert.deepEqual(v.plan.versions[0].issues, ['needs caption']);
  await assert.rejects(() => R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: [{ visual: 'A', fields: { tiktok_hook: hook } }], expectation: { codes: ['x'], reason: 'x' } }, 'nick'), (e: any) => e instanceof R.DraftError && /needs caption/.test(e.message));
  v = await view([{ visual: 'A', fields: { tiktok_caption: cap, tiktok_hook: hook } }, { visual: 'A', fields: { tiktok_caption: cap } }]);
  assert.deepEqual(v.plan.versions.map((x: any) => x.code), ['OWN_CALM_UGC_A1_US_TT', 'OWN_CALM_UGC_A2_US_TT']);
  assert.deepEqual(v.plan.issues, []);
  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: [{ visual: 'A', fields: { tiktok_caption: cap, tiktok_hook: hook } }], expectation: { codes: ['OWN_CALM_UGC_A1_US_TT'], reason: 'Hook first.' } }, 'nick');
  assert.deepEqual(Object.keys(signoff.versions![0].fields).sort(), ['tiktok_caption', 'tiktok_hook']);
  const pack = await R.handoffPack();
  assert.match(pack.csv, /TikTok caption/);
  assert.match(pack.csv, /OWN_CALM_UGC_A1_US_TT/);
});
