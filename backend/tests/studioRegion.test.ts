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

test('region flows from brief to run to line to naming code to sign-off to handoff', async () => {
  await fresh();
  const api = new S.Api({ mock: true });
  const own = (texts: string[]) => texts.map(text => ({ text, field: 'meta_primary' }));
  const us = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'us', own_lines: own(['Calm at the counter.', 'One less worry on a Sunday.', 'The vet gets paid, you get home.', 'Calm, even at 2 a.m.']) }), api, () => {}, { ownOnly: true, user: 'nick' });
  const ca = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'ca', region: 'CA', own_lines: own(['Calm at the counter, eh.', 'Your favourite colour of calm.']) }), api, () => {}, { ownOnly: true, user: 'nick' });

  // Run and lines carry the region; a Canadian line never goes into a US run.
  assert.equal(ca.brief.region, 'CA');
  assert.ok(ca.lines.every(l => l.region === 'CA' && l.prompt_version.endsWith('+ca')));
  assert.ok(us.lines.every(l => l.region === 'US'));
  assert.equal((await S.listBatches()).find(r => r.id === ca.id)!.region, 'CA');
  assert.match((await S.runMismatch(us.id, { persona: 'OWN', territory: 'OWN_CALM', region: 'CA' }))!, /Start a new run for .*Canada/);
  assert.equal(await S.runMismatch(ca.id, { persona: 'OWN', territory: 'OWN_CALM', region: 'CA' }), null);

  await keepAll(us); await keepAll(ca);
  await clearReds(us); await clearReds(ca);

  // Shortlist: each region numbers on its own, three lines to a visual.
  const sl = await S.shortlist();
  const usCodes = sl.filter(r => r.region === 'US').map(r => r.stub);
  const caCodes = sl.filter(r => r.region === 'CA').map(r => r.stub);
  assert.deepEqual(usCodes, ['OWN_CALM_UGC_A1_US_META', 'OWN_CALM_UGC_A2_US_META', 'OWN_CALM_UGC_A3_US_META', 'OWN_CALM_UGC_B1_US_META']);
  assert.deepEqual(caCodes, ['OWN_CALM_UGC_A1_CA_META', 'OWN_CALM_UGC_A2_CA_META']);

  // Ready for production is per region, and a chosen visual previews its code.
  const usView = await R.readyView('OWN', 'OWN_CALM', 'US');
  assert.equal(usView.lines.length, 4);
  assert.ok(usView.lines.every(x => x.line.region === 'US'));
  const caView = await R.readyView('OWN', 'OWN_CALM', 'CA');
  assert.deepEqual(caView.lines.map(x => x.line.id).sort(), ca.lines.map(l => l.id).sort());
  const [u1, u2, u3, u4] = us.lines.map(l => l.id);
  const preview = await R.readyView('OWN', 'OWN_CALM', 'US', { [u3]: 'B', [u4]: 'B' }, [u1, u2, u3, u4]);
  const code = (v: typeof preview, id: string) => v.lines.find(x => x.line.id === id)!.stub;
  assert.deepEqual([u1, u2, u3, u4].map(id => code(preview, id)), ['OWN_CALM_UGC_A1_US_META', 'OWN_CALM_UGC_A2_US_META', 'OWN_CALM_UGC_B1_US_META', 'OWN_CALM_UGC_B2_US_META']);
  await assert.rejects(() => R.readyView('OWN', 'OWN_CALM', 'UK' as any), /Region/);
  await assert.rejects(() => R.signOff({ persona: 'OWN', territory: 'OWN_CALM', region: 'US', line_ids: [ca.lines[0].id], expectation: { line_ids: [ca.lines[0].id], reason: 'x' } }, 'nick'), /Not kept lines/);

  // Sign off US (with the visuals chosen above), then Canada.
  const exp = (id: string) => ({ line_ids: [id], reason: 'Plain promise first.' });
  const usSo = (await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', region: 'US', line_ids: [u1, u2, u3, u4], visuals: { [u3]: 'B', [u4]: 'B' }, expectation: exp(u1) }, 'nick')).signoff;
  assert.deepEqual(usSo.lines.map(x => x.stub), ['OWN_CALM_UGC_A1_US_META', 'OWN_CALM_UGC_A2_US_META', 'OWN_CALM_UGC_B1_US_META', 'OWN_CALM_UGC_B2_US_META'], 'the codes the screen showed');
  assert.equal(usSo.region, 'US');
  const caSo = (await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', region: 'CA', line_ids: ca.lines.map(l => l.id), expectation: exp(ca.lines[0].id) }, 'nick')).signoff;
  assert.equal(caSo.region, 'CA');
  assert.equal(caSo.id, 'OWN_CALM-CA-ready-v2', 'one count per persona × territory, so the database unique key holds');
  assert.deepEqual(caSo.lines.map(x => x.stub), ['OWN_CALM_UGC_A1_CA_META', 'OWN_CALM_UGC_A2_CA_META']);
  // Every signed-off version carries its code.
  assert.equal((await S.getStore().listLineVersions(ca.lines[0].id))[0].stub, 'OWN_CALM_UGC_A1_CA_META');
  // A later US sign-off doesn't push Canada out of the handoff (the latest counts per region).
  await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', region: 'US', line_ids: [u1, u2], expectation: exp(u1) }, 'nick');
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

test('a line signed off under the earlier v# code keeps it; new lines get the new form', async () => {
  await fresh();
  const api = new S.Api({ mock: true });
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'old', own_lines: [{ text: 'Calm at the counter.', field: 'meta_primary' }] }), api, () => {}, { ownOnly: true, user: 'nick' });
  const old = run.lines[0];
  await S.setDecision(run.id, old.id, { decision: 'keep' }, 'nick');
  // What a sign-off from before the change looks like: no region, a v# code on the sign-off, the line and its version.
  const st = S.getStore();
  const h = S.lineHash(old);
  await st.saveLineVersion({ line_id: old.id, batch_id: run.id, version: 1, field: old.field, text: old.text, sha256: h, created_by: 'nick', created_at: '2026-09-28T12:00:00Z', signoff_id: 'OWN_CALM-ready-v1', stub: 'OWN_CALM_UGC_v1_META' });
  await st.saveSignoff({ id: 'OWN_CALM-ready-v1', persona: 'OWN', territory: 'OWN_CALM', version: 1, ready_by: 'nick', ready_at: '2026-09-28T12:00:00Z', sha256: 'x', expectation_id: 'e',
    lines: [{ line_id: old.id, batch_id: run.id, version: 1, sha256: h, stub: 'OWN_CALM_UGC_v1_META', field: old.field, text: old.text, chars: old.chars, overrides: [] }] });
  const l = (await S.loadBatch(run.id)).lines[0];
  l.ready = { signoff_id: 'OWN_CALM-ready-v1', version: 1, sha256: h, ready_by: 'nick', ready_at: '2026-09-28T12:00:00Z', stub: 'OWN_CALM_UGC_v1_META' };
  await st.saveLine(run.id, l);

  // A new line in the same persona × territory, and an edit to the old one.
  const more = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'new', own_lines: [{ text: 'One less worry on a Sunday.', field: 'meta_primary' }] }), api, () => {}, { ownOnly: true, user: 'nick' });
  await S.setDecision(more.id, more.lines[0].id, { decision: 'keep' }, 'nick');
  await S.setDecision(run.id, old.id, { decision: 'edit', edited_text: 'Calm at the counter. Every time.' }, 'nick');
  const view = await R.readyView('OWN', 'OWN_CALM');
  assert.equal(view.lines.find(x => x.line.id === old.id)!.stub, 'OWN_CALM_UGC_v1_META');
  assert.equal(view.lines.find(x => x.line.id === old.id)!.fixed, true);
  assert.equal(view.lines.find(x => x.line.id === more.lines[0].id)!.stub, 'OWN_CALM_UGC_A1_US_META');
  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', line_ids: [old.id, more.lines[0].id], expectation: { line_ids: [old.id], reason: 'The one we know.' } }, 'nick');
  assert.deepEqual(signoff.lines.map(x => x.stub).sort(), ['OWN_CALM_UGC_A1_US_META', 'OWN_CALM_UGC_v1_META']);
  const versions = await st.listLineVersions(old.id);
  assert.deepEqual(versions.map((v: any) => v.stub), ['OWN_CALM_UGC_v1_META', 'OWN_CALM_UGC_v1_META'], 'the old line keeps its code on the new version too');
  assert.equal((await st.listLineVersions(more.lines[0].id))[0].stub, 'OWN_CALM_UGC_A1_US_META');
});
