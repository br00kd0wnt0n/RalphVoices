// Region (US / Canada) through Studio: brief → run → line → naming code →
// Ready for production → handoff pack, and the Canadian writing instruction in
// the prompt the writer is actually sent. File store, mock client, example rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import * as R from '../src/services/studio/ready.js';
import { FileStore } from '../src/services/studio/store.js';

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-region-'));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath: path.join(__dirname, '../scripts/studio/rules.example.json') }));
  await S.refreshRules();
}
/** A mock client that also records every writer prompt it's sent. */
function recordingApi() {
  const api = new S.Api({ mock: true });
  const systems: string[] = [];
  const chat = api.chat.bind(api);
  api.chat = (async (o: any) => { if (o.stage === 'generate' || o.stage === 'more') systems.push(o.system); return chat(o); }) as any;
  return { api, systems };
}
const keepAll = async (b: S.Batch) => { for (const l of b.lines) await S.setDecision(b.id, l.id, { decision: 'keep' }, 'nick'); };
const clearReds = async (b: S.Batch) => {
  for (const l of (await S.loadBatch(b.id)).lines) for (const f of R.unresolvedRed(l)) await R.overrideFlag(b.id, l.id, f.rule, 'Test lines for regions', 'nick');
};

test('a brief is US unless it says Canada; anything else is refused', async () => {
  await fresh();
  assert.equal(S.makeBrief({ territory: 'OWN_CALM' }).region, 'US');
  assert.equal(S.makeBrief({ territory: 'OWN_CALM', region: 'ca' as any }).region, 'CA');
  assert.throws(() => S.makeBrief({ territory: 'OWN_CALM', region: 'UK' as any }), /Region must be US or CA/);
});

test('Canada: the writer is told Canadian spelling and to feel Canadian; the US prompt is unchanged', async () => {
  await fresh();
  const ca = recordingApi();
  const caRun = await S.generate(S.makeBrief({ territory: 'OWN_CALM', region: 'CA', n: 4 }), ca.api, () => {}, { user: 'nick' });
  assert.ok(ca.systems.length > 0);
  for (const sys of ca.systems) {
    assert.match(sys, /REGION: CANADA/);
    assert.match(sys, /Canadian English spelling: colour, favourite, centre/);
    assert.match(sys, /not a US ad with a maple leaf/);
    assert.match(sys, /Avoid US-only references/);
    assert.match(sys, /Don't state anything about Canada .* unless it's in the facts list/);
  }
  // "More like this" in a Canadian run gets the same instruction.
  ca.systems.length = 0;
  await S.moreLikeThis(caRun.id, caRun.lines[0].id, '', 2, ca.api);
  assert.match(ca.systems[0], /REGION: CANADA/);

  const us = recordingApi();
  await S.generate(S.makeBrief({ territory: 'OWN_CALM', n: 4 }), us.api, () => {}, { user: 'nick' });
  for (const sys of us.systems) assert.equal(/CANADA|Canadian/.test(sys), false, 'no region block for the US');
});

test('region flows from brief to run to line to naming code (per version) to sign-off to handoff', async () => {
  await fresh();
  const api = new S.Api({ mock: true });
  const own = (texts: string[], headline: string) => [...texts.map(text => ({ text, field: 'meta_primary' })), { text: headline, field: 'meta_headline' }];
  const us = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'us', own_lines: own(['Calm at the counter.', 'One less worry on a Sunday.', 'The vet gets paid, you get home.', 'Calm, even at 2 a.m.'], 'Calm, covered.') }), api, () => {}, { ownOnly: true, user: 'nick' });
  const ca = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'ca', region: 'CA', own_lines: own(['Calm at the counter, eh.', 'Your favourite colour of calm.'], 'Calm, covered, eh.') }), api, () => {}, { ownOnly: true, user: 'nick' });

  // Run and lines carry the region; a Canadian line never goes into a US run.
  assert.equal(ca.brief.region, 'CA');
  assert.ok(ca.lines.every(l => l.region === 'CA' && l.prompt_version.endsWith('+ca')));
  assert.ok(us.lines.every(l => l.region === 'US'));
  assert.equal((await S.listBatches()).find(r => r.id === ca.id)!.region, 'CA');
  assert.match((await S.runMismatch(us.id, { persona: 'OWN', territory: 'OWN_CALM', region: 'CA' }))!, /Start a new run for .*Canada/);
  assert.equal(await S.runMismatch(ca.id, { persona: 'OWN', territory: 'OWN_CALM', region: 'CA' }), null);

  await keepAll(us); await keepAll(ca);
  await clearReds(us); await clearReds(ca);
  // The Shortlist lists lines by field, with no codes yet: codes belong to versions, built at Ready.
  assert.ok((await S.shortlist()).every(r => r.stub === ''));

  // Ready for production is per region. The default pairs each primary text with the headline, three to a visual.
  const usView = await R.readyView('OWN', 'OWN_CALM', 'US');
  assert.equal(usView.lines.length, 5);
  assert.ok(usView.lines.every(x => x.line.region === 'US'));
  assert.deepEqual(usView.plan.versions.map(v => v.code), ['OWN_CALM_UGC_A1_US_META', 'OWN_CALM_UGC_A2_US_META', 'OWN_CALM_UGC_A3_US_META', 'OWN_CALM_UGC_B1_US_META']);
  const caView = await R.readyView('OWN', 'OWN_CALM', 'CA');
  assert.deepEqual(caView.lines.map(x => x.line.id).sort(), ca.lines.map(l => l.id).sort());
  assert.deepEqual(caView.plan.versions.map(v => v.code), ['OWN_CALM_UGC_A1_CA_META', 'OWN_CALM_UGC_A2_CA_META'], 'Canada numbers on its own');
  // Moving versions to visual B previews their codes.
  const [u1, u2, u3, u4, uh] = us.lines.map(l => l.id);
  const V = (visual: string, p: string, h = uh) => ({ visual, fields: { meta_primary: p, meta_headline: h } });
  const usDraft = [V('A', u1), V('A', u2), V('B', u3), V('B', u4)];
  const preview = await R.readyView('OWN', 'OWN_CALM', 'US', { versions: usDraft, on_image: {} });
  assert.deepEqual(preview.plan.versions.map(v => v.code), ['OWN_CALM_UGC_A1_US_META', 'OWN_CALM_UGC_A2_US_META', 'OWN_CALM_UGC_B1_US_META', 'OWN_CALM_UGC_B2_US_META']);
  await assert.rejects(() => R.readyView('OWN', 'OWN_CALM', 'UK' as any), /Region/);
  await assert.rejects(() => R.signOff({ persona: 'OWN', territory: 'OWN_CALM', region: 'US', versions: [V('A', ca.lines[0].id, ca.lines[2].id)], expectation: { codes: ['OWN_CALM_UGC_A1_US_META'], reason: 'x' } }, 'nick'), /Not kept lines/);

  // Sign off US (with the visuals chosen above), then Canada.
  const exp = (code: string) => ({ codes: [code], reason: 'Plain promise first.' });
  const usSo = (await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', region: 'US', versions: usDraft, expectation: exp('OWN_CALM_UGC_A1_US_META') }, 'nick')).signoff;
  assert.deepEqual(usSo.versions!.map(v => v.code), ['OWN_CALM_UGC_A1_US_META', 'OWN_CALM_UGC_A2_US_META', 'OWN_CALM_UGC_B1_US_META', 'OWN_CALM_UGC_B2_US_META'], 'the codes the screen showed');
  assert.equal(usSo.region, 'US');
  const [c1, c2, ch] = ca.lines.map(l => l.id);
  const caSo = (await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', region: 'CA', versions: [V('A', c1, ch), V('A', c2, ch)], expectation: exp('OWN_CALM_UGC_A1_CA_META') }, 'nick')).signoff;
  assert.equal(caSo.region, 'CA');
  assert.equal(caSo.id, 'OWN_CALM-CA-ready-v2', 'one count per persona × territory, so the database unique key holds');
  assert.deepEqual(caSo.versions!.map(v => v.code), ['OWN_CALM_UGC_A1_CA_META', 'OWN_CALM_UGC_A2_CA_META']);
  // Every signed-off line version carries its code(s).
  assert.equal((await S.getStore().listLineVersions(c1))[0].stub, 'OWN_CALM_UGC_A1_CA_META');
  assert.equal((await S.getStore().listLineVersions(ch))[0].stub, 'OWN_CALM_UGC_A1_CA_META,OWN_CALM_UGC_A2_CA_META');
  // A later US sign-off doesn't push Canada out of the handoff (the latest counts per region).
  await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', region: 'US', versions: usDraft.slice(0, 2), expectation: exp('OWN_CALM_UGC_A1_US_META') }, 'nick');
  assert.equal((await R.readyView('OWN', 'OWN_CALM', 'CA')).latest!.id, caSo.id);

  const pack = await R.handoffPack();
  const rows = S.parseCsv(pack.csv);
  const col = (n: string) => rows[0].indexOf(n);
  const body = rows.slice(1).map(r => [r[col('Naming code')], r[col('Region')], r[col('Visual')]].join(' '));
  assert.deepEqual(body.sort(), ['OWN_CALM_UGC_A1_CA_META CA A', 'OWN_CALM_UGC_A1_US_META US A', 'OWN_CALM_UGC_A2_CA_META CA A', 'OWN_CALM_UGC_A2_US_META US A']);
  assert.match(pack.md, /## OWN · OWN_CALM · Canada/);
  assert.match(pack.md, /## OWN · OWN_CALM · US/);
  assert.equal((pack.md.match(/Expected to lead/g) || []).length, 2, 'each region shows its own expectation');
  const sheet = S.parseCsv(pack.complianceCsv);
  assert.deepEqual(sheet.slice(1).map(r => r[1]).sort(), ['Canada', 'Canada', 'US', 'US']);
  // Filtered to one region.
  assert.equal(S.parseCsv((await R.handoffPack({ region: 'CA' })).csv).length, 3);
});

test('a sign-off from before versions (one code per line, v# or A1) is still read; a complete version gets a new code', async () => {
  await fresh();
  const api = new S.Api({ mock: true });
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'old', own_lines: [{ text: 'Calm at the counter.', field: 'meta_primary' }, { text: 'Calm, covered.', field: 'meta_headline' }] }), api, () => {}, { ownOnly: true, user: 'nick' });
  const [old, head] = run.lines;
  for (const l of run.lines) await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
  // What a sign-off from before looks like: no region, no versions, a v# code per line.
  const st = S.getStore();
  const h = S.lineHash(old);
  await st.saveLineVersion({ line_id: old.id, batch_id: run.id, version: 1, field: old.field, text: old.text, sha256: h, created_by: 'nick', created_at: '2026-09-28T12:00:00Z', signoff_id: 'OWN_CALM-ready-v1', stub: 'OWN_CALM_UGC_v1_META' });
  await st.saveSignoff({ id: 'OWN_CALM-ready-v1', persona: 'OWN', territory: 'OWN_CALM', version: 1, ready_by: 'nick', ready_at: '2026-09-28T12:00:00Z', sha256: 'x', expectation_id: 'e',
    lines: [{ line_id: old.id, batch_id: run.id, version: 1, sha256: h, stub: 'OWN_CALM_UGC_v1_META', field: old.field, text: old.text, chars: old.chars, overrides: [] }] });
  // Read as it was: one code, one field, in the handoff.
  const rows = S.parseCsv((await R.handoffPack()).csv);
  assert.deepEqual(rows.slice(1).map(r => r[0]), ['OWN_CALM_UGC_v1_META']);
  assert.equal(rows[1][rows[0].indexOf('Meta primary text')], 'Calm at the counter.');
  // Ready starts from it, and says what a live version now needs.
  const view = await R.readyView('OWN', 'OWN_CALM');
  assert.deepEqual(view.plan.versions.map(v => v.code), ['OWN_CALM_UGC_v1_META']);
  assert.match(view.plan.issues.join(' '), /needs headline/);
  // Made complete, it's a different ad: a new code in the current form, and the v# code is never reused.
  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: [{ visual: 'A', fields: { meta_primary: old.id, meta_headline: head.id } }], expectation: { codes: ['OWN_CALM_UGC_A1_US_META'], reason: 'The one we know.' } }, 'nick');
  assert.deepEqual(signoff.versions!.map(v => v.code), ['OWN_CALM_UGC_A1_US_META']);
  assert.ok((await S.signedCodes()).includes('OWN_CALM_UGC_v1_META'), 'old codes stay taken');
});
