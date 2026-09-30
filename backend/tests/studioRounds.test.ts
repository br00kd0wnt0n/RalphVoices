// Rounds (Brook, 30 Sep): the active round is stamped on new runs, lines and
// sign-offs; views default to it; a TEST round (R0, the production run-through)
// is hidden by default, never reaches the handoff, doesn't use up codes (R1
// starts at A) and doesn't feed taste into a real round; its spend still counts.
// File store, mock client, example rules. Pre-flight (features, asset handoff)
// is in studioPg.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import * as R from '../src/services/studio/ready.js';
import * as Rounds from '../src/services/studio/rounds.js';
import { FileStore } from '../src/services/studio/store.js';

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-rounds-'));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath: path.join(__dirname, '../scripts/studio/rules.example.json') }));
  await S.refreshRules();
}
const api = () => new S.Api({ mock: true });
/** A run of two primaries and a headline, all kept (reds overridden), in the active round. */
async function keptRun(name: string, texts = ['Calm at the counter.', 'One less worry on a Sunday.']) {
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name, own_lines: [...texts.map(text => ({ text, field: 'meta_primary' })), { text: `${name}: calm, covered.`, field: 'meta_headline' }] }), api(), () => {}, { ownOnly: true, user: 'nick' });
  for (const l of run.lines) {
    await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
    for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line', 'nick');
  }
  const ids = run.lines.map(l => l.id);
  return { run, versions: ids.slice(0, -1).map(p => ({ visual: 'A', fields: { meta_primary: p, meta_headline: ids.at(-1)! } })) };
}
const signOff = async (versions: any[], round?: string) => {
  const v = await R.readyView('OWN', 'OWN_CALM', 'US', { versions, on_image: {} }, { round });
  return (await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', round, versions, expectation: { codes: [v.plan.versions[0].code], reason: 'x' } }, 'nick')).signoff;
};

test('by default the active round is R1; content from before rounds reads as R1; new runs, lines and sign-offs are stamped', async () => {
  await fresh();
  assert.deepEqual((await Rounds.getRounds()).active, 'R1');
  const { run, versions } = await keptRun('first');
  assert.equal(run.brief.round, 'R1');
  assert.ok(run.lines.every(l => l.round === 'R1'));
  // A run written before rounds (no stamp anywhere) reads as R1.
  const old = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'old', own_lines: [{ text: 'An old line.', field: 'meta_primary' }] }), api(), () => {}, { ownOnly: true, user: 'nick' });
  const b = await S.loadBatch(old.id);
  delete b.brief.round;
  for (const l of b.lines) delete l.round;
  await S.getStore().saveBatch(b);
  await S.setDecision(old.id, old.lines[0].id, { decision: 'keep' }, 'nick');
  assert.equal((await S.listBatches()).find(x => x.id === old.id)!.round, 'R1');
  assert.equal((await S.shortlist()).find(x => x.id === old.lines[0].id)!.round, 'R1');
  const so = await signOff(versions);
  assert.equal(so.round, 'R1');
  assert.equal(Rounds.roundOf({}), 'R1');
});

test('admin rounds: ids R + number, a name, R1 is never a test round; the active round is stamped', async () => {
  await fresh();
  await assert.rejects(() => Rounds.saveRound({ id: 'x', name: 'x' }), /R and a number/);
  await assert.rejects(() => Rounds.saveRound({ id: 'R2', name: '' }), /name/);
  await assert.rejects(() => Rounds.saveRound({ id: 'R1', name: 'Round one', test: true }), /R1 is the first real round/);
  const s = await Rounds.saveRound({ id: 'r0', name: 'Test run-through', test: true, activate: true }, 'brook');
  assert.equal(s.active, 'R0');
  assert.deepEqual(s.rounds.map(r => [r.id, !!r.test]), [['R0', true], ['R1', false]]);
  assert.equal(s.rounds[0].created_by, 'brook');
  const { run } = await keptRun('test-run');
  assert.equal(run.brief.round, 'R0');
  // Lines added to a run keep the run's round, even after the active round changes.
  await Rounds.setActiveRound('R1');
  const more = await S.generate(S.makeBrief({ ...run.brief, own_lines: [{ text: 'Added later.', field: 'meta_primary' }] }), api(), () => {}, { batchId: run.id, ownOnly: true, user: 'nick' });
  assert.equal(more.lines.at(-1)!.round, 'R0');
  await assert.rejects(() => Rounds.setActiveRound('R9'), /No round R9/);
});

test('a round carries its asset deadline (the round board): a date, kept when a save leaves it out, cleared with ""', async () => {
  await fresh();
  await assert.rejects(() => Rounds.saveRound({ id: 'R1', name: 'Round one', assets_due: '12 Oct' }), /YYYY-MM-DD/);
  let s = await Rounds.saveRound({ id: 'R1', name: 'Round one', assets_due: '2026-10-12' });
  assert.equal(s.rounds.find(r => r.id === 'R1')!.assets_due, '2026-10-12');
  s = await Rounds.saveRound({ id: 'R1', name: 'Round one, renamed' });
  assert.equal(s.rounds.find(r => r.id === 'R1')!.assets_due, '2026-10-12', 'kept');
  s = await Rounds.saveRound({ id: 'R1', name: 'Round one', assets_due: '' });
  assert.equal(s.rounds.find(r => r.id === 'R1')!.assets_due, undefined, 'cleared');
});

test('R0 (test) then R1: views default to the active round, R0 is hidden from R1 and never handed off; R1 codes start at A; R0 codes carry _TEST', async () => {
  await fresh();
  await Rounds.saveRound({ id: 'R0', name: 'Test run-through', test: true, activate: true });
  const r0 = await keptRun('r0', ['Test primary one.', 'Test primary two.']);
  const s0 = await signOff(r0.versions);
  assert.deepEqual(s0.versions!.map(v => v.code), ['OWN_CALM_UGC_A1_US_META_TEST', 'OWN_CALM_UGC_A2_US_META_TEST']);
  assert.equal(s0.round, 'R0');
  // In R0 the views show R0; the handoff never has a test round's codes.
  assert.deepEqual((await S.listBatches(undefined, await Rounds.roundView())).map(x => x.round), ['R0']);
  assert.equal((await R.handoffPack()).count, 0, 'a test round never reaches Add3');

  await Rounds.setActiveRound('R1');
  const r1 = await keptRun('r1');
  // R1's views: only R1.
  const v = await Rounds.roundView();
  assert.deepEqual((await S.listBatches(undefined, v)).map(x => x.id), [r1.run.id]);
  assert.ok((await S.shortlist(v)).every(x => x.round === 'R1'));
  const ready = await R.readyView('OWN', 'OWN_CALM');
  assert.deepEqual(ready.round, { id: 'R1', test: false });
  assert.ok(ready.lines.every(x => x.line.round === 'R1'), 'Ready builds from R1 lines only');
  assert.equal(ready.latest, null, 'R0 sign-offs are not R1 history');
  // R1 codes start at A despite R0's sign-offs.
  assert.deepEqual(ready.plan.versions.map(x => x.code), ['OWN_CALM_UGC_A1_US_META', 'OWN_CALM_UGC_A2_US_META']);
  const s1 = await signOff(r1.versions);
  assert.equal(s1.round, 'R1');
  assert.equal(s1.version, 2, 'one version count per persona × territory, across rounds');
  // "Show all rounds": both, each with its round; the handoff still leaves R0 out.
  const all = await Rounds.roundView('all');
  assert.deepEqual((await S.listBatches(undefined, all)).map(x => x.round).sort(), ['R0', 'R1']);
  assert.deepEqual([...new Set((await S.shortlist(all)).map(x => x.round))].sort(), ['R0', 'R1']);
  const hand = S.parseCsv((await R.handoffPack({ round: 'all' })).csv);
  assert.deepEqual(hand.slice(1).map(r => r[0]), ['OWN_CALM_UGC_A1_US_META', 'OWN_CALM_UGC_A2_US_META']);
  assert.ok(hand.slice(1).every(r => r[hand[0].indexOf('Round')] === 'R1'));
  assert.ok(!(await R.handoffPack({ round: 'all' })).md.includes('_TEST'));
  // R0's Ready view is still reachable by name (and read as a test round).
  assert.deepEqual((await R.readyView('OWN', 'OWN_CALM', 'US', undefined, { round: 'R0' })).round, { id: 'R0', test: true });
  // Exports carry the round.
  assert.ok(S.parseCsv((await S.writeShortlist()).csv)[0].includes('round'));
  assert.equal(S.parseCsv((await S.exportBatch(r1.run.id)).csv).at(-1)!.at(-1), 'R1');
});

test('taste from a test round never feeds a real round; a test round learns from everything', async () => {
  await fresh();
  await Rounds.saveRound({ id: 'R0', name: 'Test run-through', test: true, activate: true });
  await keptRun('r0', ['ZEBRA test line kept in R0.']);
  await Rounds.setActiveRound('R1');
  await keptRun('r1', ['Real R1 line about the counter.']);
  const systemFor = async () => {
    const a = api();
    let system = '';
    const chat = a.chat.bind(a);
    a.chat = (async (o: any) => { if (o.stage === 'generate' && !system) system = o.system; return chat(o); }) as any;
    await S.generate(S.makeBrief({ territory: 'OWN_CALM', n: 2 }), a, () => {}, { check: false, user: 'nick' });
    return system;
  };
  let sys = await systemFor();
  assert.match(sys, /Real R1 line about the counter/);
  assert.doesNotMatch(sys, /ZEBRA/, 'R0 taste is not used in R1');
  assert.equal((await S.loadTaste()).find(t => /ZEBRA/.test(t.text))!.round, 'R0', 'taste rows carry their round');
  await Rounds.setActiveRound('R0');
  sys = await systemFor();
  assert.match(sys, /ZEBRA/);
});

test('a test round\'s spend is real money: counted toward the cap, labelled with the round', async () => {
  await fresh();
  await Rounds.saveRound({ id: 'R0', name: 'Test run-through', test: true, activate: true });
  const a = api();
  (a as any).mock = false;
  (a as any).runTotal = () => 0.42;
  await a.commit('generate OWN_CALM-test', 'brook');
  const rows = await S.getStore().listSpend();
  assert.equal(rows.at(-1)!.label, 'generate OWN_CALM-test · R0');
  assert.equal(await S.getStore().spendTotal(), 0.42);
});
