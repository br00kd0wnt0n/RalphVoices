// Shared captions (Brook, 1 Oct): post copy (primary text, Meta headline, caption) is generic across personas and
// reused; artwork copy (on-image headline + subhead) is the persona's. A shared run (persona ALL, territory SHARED) is
// written at brand level against the approved on-image headlines, and its kept lines can be used in any territory's
// ads. Example rules, mock client, file store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import * as R from '../src/services/studio/ready.js';
import { FileStore } from '../src/services/studio/store.js';

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-shared-'));
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  rules.fields.meta_on_image = { platform: 'META', label: 'On-image text', visible: 40, max: 60, source: 'HOUSE: test', in_version: 'per_visual' };
  rules.personas.FAM = { ...rules.personas.OWN, name: 'Busy Families' };
  rules.territories.OWN_STILL = { ...rules.territories.OWN_CALM, name: 'Still', format: 'STATIC' };
  rules.territories.FAM_SUMMER = { ...rules.territories.OWN_CALM, persona: 'FAM', name: 'Summer', format: 'STATIC' };
  const rulesPath = path.join(dir, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify(rules));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath }));
  return S.refreshRules();
}
const api = () => new S.Api({ mock: true });
async function own(territory: string, lines: Array<[string, string]>, region: 'US' | 'CA' = 'US') {
  const run = await S.generate(S.makeBrief({ territory, region, name: `${territory}-${region}`, own_lines: lines.map(([field, text]) => ({ field, text })) }), api(), () => {}, { ownOnly: true, user: 'nick' });
  for (const l of run.lines) {
    await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
    for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line', 'nick');
  }
  return run.lines.map(l => l.id);
}

test('a shared run is written at brand level, against the approved on-image headlines of every persona in its region', async () => {
  await fresh();
  await own('OWN_STILL', [['meta_on_image', 'Vet visits, calmer']]);
  await own('FAM_SUMMER', [['meta_on_image', 'Summer plans, covered']]);
  await own('FAM_SUMMER', [['meta_on_image', 'Des plans pour l’été']], 'CA');
  assert.deepEqual((await S.approvedHeadlines('US')).sort(), ['Summer plans, covered', 'Vet visits, calmer']);
  const a = api();
  let system = '';
  const chat = a.chat.bind(a);
  a.chat = (async (o: any) => { if (o.stage === 'generate' && !system) system = o.system; return chat(o); }) as any;
  const run = await S.generate(S.makeBrief({ territory: 'SHARED', fields: ['meta_primary', 'meta_headline'], n: 4, field_counts: { meta_primary: 2, meta_headline: 2 } }), a, () => {}, { check: false, user: 'brook' });
  assert.deepEqual([run.brief.persona, run.brief.territory], ['ALL', 'SHARED']);
  assert.deepEqual(run.brief.approved_headlines!.sort(), ['Summer plans, covered', 'Vet visits, calmer'], 'the US headlines only');
  assert.match(system, /SHARED post copy/);
  assert.match(system, /No persona-specific references/);
  assert.match(system, /APPROVED ON-IMAGE HEADLINES[\s\S]*- Vet visits, calmer/);
  assert.doesNotMatch(system, /What moves them/, 'no persona block');
  assert.match(system, /MUST \(a line that breaks one of these is thrown away/, 'the same compliance MUSTs');
  assert.ok(run.lines.filter(l => l.field === 'meta_primary').every(l => S.NAMES_PRODUCT.test(l.text)), 'primary texts name Trupanion or the category');
});

test('kept shared captions are in every territory\'s Build set for their region, flagged shared; artwork copy never is', async () => {
  await fresh();
  const [sp1, sh1] = await own('SHARED', [['meta_primary', 'Trupanion is medical insurance for pets. Get a quote.'], ['meta_headline', 'Get a quote today.']]);
  await own('SHARED', [['meta_primary', 'Trupanion, assurance médicale pour animaux.']], 'CA');
  const [oi] = await own('OWN_STILL', [['meta_on_image', 'Vet visits, calmer']]);
  const [foi] = await own('FAM_SUMMER', [['meta_on_image', 'Summer plans, covered']]);
  const view = await R.readyView('OWN', 'OWN_STILL');
  assert.deepEqual(view.lines.map(x => [x.line.id, !!(x as any).shared]), [[oi, false], [sp1, true], [sh1, true]], 'own lines first, then the US shared captions');
  // With no post copy of its own, the territory starts from the shared captions.
  assert.deepEqual(view.draft.versions, [{ visual: 'A', platform: 'META', fields: { meta_primary: sp1, meta_headline: sh1 } }]);
  assert.deepEqual(view.plan.issues, []);
  // The same caption signed off in two personas' ads: one line, two codes.
  const sign = async (persona: string, territory: string, image: string) => {
    const v = await R.readyView(persona, territory, 'US', { versions: [{ visual: 'A', fields: { meta_primary: sp1, meta_headline: sh1 } }], on_image: { A: image } });
    return (await R.signOff({ persona, territory, versions: v.draft.versions, on_image: v.draft.on_image, expectation: { codes: [v.plan.versions[0].code], reason: 'x' } }, 'nick')).signoff;
  };
  const a = await sign('OWN', 'OWN_STILL', oi), b = await sign('FAM', 'FAM_SUMMER', foi);
  assert.equal(a.versions![0].fields.meta_primary.line_id, b.versions![0].fields.meta_primary.line_id);
  assert.notEqual(a.versions![0].code, b.versions![0].code);
  // An edit to the shared caption shows as edited since sign-off in both territories (it's one line).
  await S.setDecision(S.loadRules() && sp1.replace(/-L\d+$/, ''), sp1, { decision: 'edit', edited_text: 'Trupanion is medical insurance for pets. See how it works.' }, 'nick');
  for (const [p, t] of [['OWN', 'OWN_STILL'], ['FAM', 'FAM_SUMMER']] as const) {
    const now = await R.readyView(p, t);
    assert.notEqual(now.lines.find(x => x.line.id === sp1)!.sha256, now.latest!.versions![0].fields.meta_primary.sha256, `${t}: the signed wording is no longer the line's`);
  }
  // Re-signing one territory without the caption doesn't un-mark it: the other territory's set still carries it.
  const [op] = await own('OWN_STILL', [['meta_primary', 'Calm at the counter, with Trupanion.']]);
  const v2 = await R.readyView('OWN', 'OWN_STILL', 'US', { versions: [{ visual: 'A', fields: { meta_primary: op, meta_headline: sh1 } }], on_image: { A: oi } });
  await R.signOff({ persona: 'OWN', territory: 'OWN_STILL', versions: v2.draft.versions, on_image: v2.draft.on_image, expectation: { codes: [v2.plan.versions[0].code], reason: 'x' } }, 'nick');
  const line = (await S.loadBatch(sp1.replace(/-L\d+$/, ''))).lines.find(l => l.id === sp1)!;
  assert.equal(line.ready!.signoff_id, b.id);
  assert.equal(line.ready!.superseded_by, undefined, 'still signed off, in Busy Families’ set');
});

test('generating for someone: the run is theirs (created_for), their lines added_for; an admin can credit a run later', async () => {
  await fresh();
  const brief = () => S.makeBrief({ territory: S.SHARED_TERRITORY, persona: S.SHARED_PERSONA, name: 'for', fields: ['meta_primary'], n: 2, own_lines: [{ field: 'meta_primary', text: 'Trupanion is medical insurance for pets. Get a quote.' }] });
  const run = await S.generate(brief(), new S.Api({ mock: true }), () => {}, { ownOnly: true, user: 'brook', for: 'nick' });
  const stored = await S.loadBatch(run.id);
  assert.equal(stored.created_by, 'brook');
  assert.equal(stored.created_for, 'nick');
  assert.deepEqual(stored.lines.map(l => [l.added_by, l.added_for]), [['brook', 'nick']]);
  assert.equal((await S.listBatches()).find(r => r.id === run.id)!.created_for, 'nick');
  // For yourself is nobody.
  const own = await S.generate(brief(), new S.Api({ mock: true }), () => {}, { ownOnly: true, user: 'brook', for: 'Brook' });
  assert.equal((await S.loadBatch(own.id)).created_for, undefined);
  // Continuing someone's run for someone else doesn't change whose run it is.
  await S.generate({ ...brief(), own_lines: [{ field: 'meta_primary', text: 'Trupanion pays your vet directly. See how it works.' }] }, new S.Api({ mock: true }), () => {}, { ownOnly: true, user: 'brook', for: 'vivan', batchId: run.id });
  const again = await S.loadBatch(run.id);
  assert.equal(again.created_for, 'nick');
  assert.equal(again.lines[1].added_for, 'vivan');
  // The admin's correction, and clearing it.
  assert.deepEqual(await S.setRunFor(own.id, 'nick', 'admin'), { id: own.id, created_by: 'brook', created_for: 'nick' });
  const credited = await S.loadBatch(own.id);
  assert.deepEqual([credited.created_for, credited.lines[0].added_for], ['nick', 'nick']);
  await S.setRunFor(own.id, '', 'admin');
  const cleared = await S.loadBatch(own.id);
  assert.deepEqual([cleared.created_for, cleared.lines[0].added_for], [undefined, undefined]);
});

test('shared primary text with no call to action at the end is flagged (amber); other personas and headlines are not', async () => {
  const r = await fresh();
  const cta = (text: string, field = 'meta_primary', persona = S.SHARED_PERSONA) => S.deterministicFlags({ text, field, structure: 'plain_promise', persona }, r).flags.filter(f => f.rule === 'SHARED_CTA').map(f => f.severity);
  assert.deepEqual(cta('Trupanion is medical insurance for pets. We pay your vet directly.'), ['warn']);
  assert.deepEqual(cta('Trupanion is medical insurance for pets. Get a quote in minutes.'), []);
  assert.deepEqual(cta('Trupanion pays your vet directly. Ready? See how it works.'), []);
  // Production, 1 Oct: "Protect your pet today." is a call to action; a description that merely contains the verb isn't.
  assert.deepEqual(cta('Trupanion paid $697M in vet bills last year. Protect your pet today.'), []);
  assert.deepEqual(cta('Trupanion is medical insurance for pets. Enroll today.'), []);
  assert.deepEqual(cta('Trupanion is medical insurance for pets. It can protect your pet for life.'), ['warn']);
  assert.deepEqual(cta('Calm, covered.', 'meta_headline'), []);
  assert.deepEqual(cta('Trupanion pays your vet directly.', 'meta_primary', 'OWN'), []);
});

test('a single-line re-check keeps "similar line" for unchanged wording, and drops it when an edit no longer resembles its neighbour', async () => {
  await fresh();
  const a = 'Trupanion paid $697M in vet invoices in 2025. Get a quote today.';
  const run = await S.generate(S.makeBrief({ territory: S.SHARED_TERRITORY, persona: S.SHARED_PERSONA, name: 'dup', fields: ['meta_primary'], own_lines: [{ field: 'meta_primary', text: a }, { field: 'meta_primary', text: a + ' ' }] }), api(), () => {}, { ownOnly: true, user: 'nick' });
  const id = run.lines[1].id;
  const dup = (l: S.Line) => l.flags.some(f => f.rule === 'NEAR_DUP');
  assert.equal(dup((await S.loadBatch(run.id)).lines[1]), true, 'flagged when the run was checked');
  assert.equal(dup(await R.recheckLine(run.id, id, api(), 'nick')), true, 'still flagged after a re-check of the same wording');
  await S.setDecision(run.id, id, { edited_text: 'See how direct payment to your vet works at participating hospitals with Trupanion.' }, 'nick');
  assert.equal(dup(await R.recheckLine(run.id, id, api(), 'nick')), false, 'an edit that no longer resembles it loses the flag');
});

test('the ad handoff: one row per ad (a visual), its versions\' copy as text options, shared captions marked', async () => {
  await fresh();
  const [o1, mine] = await own('OWN_STILL', [['meta_on_image', 'Vet visits, calmer'], ['meta_primary', 'Trupanion pays the vet at partner clinics. Get a quote.']]);
  const [s1, s2, sh1, sh2] = await own(S.SHARED_TERRITORY, [['meta_primary', 'Trupanion is medical insurance for pets. Get a quote.'], ['meta_primary', 'Medical insurance for pets from Trupanion. See how it works.'], ['meta_headline', 'Get a quote today'], ['meta_headline', 'See how it works']]);
  // Three copy options on visual A: two shared captions and the asset's own, sharing two headlines between them.
  const versions = [{ visual: 'A', fields: { meta_primary: s1, meta_headline: sh1 } }, { visual: 'A', fields: { meta_primary: s2, meta_headline: sh1 } }, { visual: 'A', fields: { meta_primary: mine, meta_headline: sh2 } }];
  const view = await R.readyView('OWN', 'OWN_STILL', 'US', { versions, on_image: { A: o1 } });
  assert.deepEqual(view.plan.issues, []);
  await R.signOff({ persona: 'OWN', territory: 'OWN_STILL', versions, on_image: { A: o1 }, expectation: { codes: [view.plan.versions[0].code], reason: 'x' } }, 'brook', { for: 'nick' });

  const { rows, csv, count } = await R.adHandoff();
  assert.equal(count, 1, 'three codes, one ad');
  const ad = rows[0];
  assert.equal(ad.ad, 'OWN_STILL_ST_A_US_META');
  assert.deepEqual(ad.codes, ['OWN_STILL_ST_A1_US_META', 'OWN_STILL_ST_A2_US_META', 'OWN_STILL_ST_A3_US_META']);
  assert.deepEqual(ad.options.meta_primary.map(o => [o.line_id, o.shared, o.codes.length]), [[s1, true, 1], [s2, true, 1], [mine, false, 1]]);
  assert.deepEqual(ad.options.meta_headline.map(o => [o.line_id, o.shared, o.codes.length]), [[sh1, true, 2], [sh2, true, 1]], 'a headline used by two options is one text option');
  assert.equal(ad.on_image, 'Vet visits, calmer');
  const [head, row] = S.parseCsv(csv);
  const cell = (name: string) => row[head.indexOf(name)];
  assert.deepEqual(head.slice(0, 8), ['Ad name', 'Region', 'Month', 'Persona', 'Territory', 'Format', 'Platform', 'On-image text']);
  assert.deepEqual(['Meta primary text 1', 'Meta primary text 2', 'Meta primary text 3', 'Meta headline 1', 'Meta headline 2'].map(cell),
    ['Trupanion is medical insurance for pets. Get a quote.', 'Medical insurance for pets from Trupanion. See how it works.', 'Trupanion pays the vet at partner clinics. Get a quote.', 'Get a quote today', 'See how it works']);
  assert.equal(head.includes('Meta headline 3'), false);
  assert.match(cell('Meta primary text: ids'), new RegExp(`^1: ${s1} \\(shared\\) \\[A1\\]\\n2: ${s2} \\(shared\\) \\[A2\\]\\n3: ${mine} \\[A3\\]$`));
  assert.match(cell('Meta headline: ids'), /\(shared\) \[A1, A2\]/);
  assert.deepEqual([cell('Ad name'), cell('Copy options (Studio codes)'), cell('Decided by'), cell('Entered by')], ['OWN_STILL_ST_A_US_META', ad.codes.join(', '), 'nick', 'brook']);
  // Trupanion's sheet: one row per ad, every option's words, and nothing internal (no ids, codes, names or reasons).
  const sheet = S.parseCsv((await R.adHandoff()).complianceCsv);
  assert.deepEqual(sheet[0], ['Audience', 'Asset', 'Ad name', 'Region', 'Platform', 'Format', 'On-image text', 'Meta primary text 1', 'Meta primary text 2', 'Meta primary text 3', 'Meta headline 1', 'Meta headline 2', 'Please check']);
  assert.equal(sheet.length, 2);
  assert.deepEqual(sheet[1].slice(1, 8), ['Still', 'OWN_STILL_ST_A_US_META', 'US', 'META', 'STATIC', 'Vet visits, calmer', 'Trupanion is medical insurance for pets. Get a quote.']);
  assert.ok(sheet[1][0] && !/^OWN$/.test(sheet[1][0]), 'the audience by name, not its code');
  assert.equal(/nick|brook|shared|SHARED-|_A1_|Test line|overridden/i.test(sheet.slice(1).map(r => r.join(' ')).join(' ').replace(/Please check[\s\S]*$/, '')), false);
  // The per-option pack still has its three rows: the internal record is unchanged.
  assert.equal((await R.handoffPack()).count, 3);
});
