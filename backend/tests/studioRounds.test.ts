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
/** Nick (an admin here) works in a round: a test round is worked in per person, never made the active round. */
const work = (id: string) => Rounds.setWorkingRound('nick', id, true);
const signOff = async (versions: any[], round?: string) => {
  const v = await R.readyView('OWN', 'OWN_CALM', 'US', { versions, on_image: {} }, { round, user: 'nick' });
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
  // A test round is never the active round (everyone would be working in it).
  await assert.rejects(() => Rounds.saveRound({ id: 'r0', name: 'Test run-through', test: true, activate: true }, 'brook'), /never the active round/);
  const s = await Rounds.saveRound({ id: 'r0', name: 'Test run-through', test: true }, 'brook');
  assert.equal(s.active, 'R1');
  await assert.rejects(() => Rounds.setActiveRound('R0'), /never the active round/);
  assert.deepEqual(s.rounds.map(r => [r.id, !!r.test]), [['R0', true], ['R1', false]]);
  assert.equal(s.rounds[0].created_by, 'brook');
  await work('R0');
  const { run } = await keptRun('test-run');
  assert.equal(run.brief.round, 'R0');
  // Lines added to a run keep the run's round, even after the person moves to another round.
  await work('R1');
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
  await Rounds.saveRound({ id: 'R0', name: 'Test run-through', test: true });
  await work('R0');
  const r0 = await keptRun('r0', ['Test primary one.', 'Test primary two.']);
  const s0 = await signOff(r0.versions);
  assert.deepEqual(s0.versions!.map(v => v.code), ['OWN_CALM_UGC_A1_US_META_TEST', 'OWN_CALM_UGC_A2_US_META_TEST']);
  assert.equal(s0.round, 'R0');
  // In R0 the views show R0. Its own exports (a demo) carry its codes, marked TEST on the first line; any other view never does.
  assert.deepEqual((await S.listBatches(undefined, await Rounds.roundView(undefined, 'nick'))).map(x => x.round), ['R0']);
  assert.deepEqual((await S.listBatches(undefined, await Rounds.roundView())).map(x => x.round), [], 'everyone else (the active round) sees none of it');
  const demo = await R.handoffPack({ user: 'nick' });
  assert.deepEqual([demo.count, demo.test], [2, true]);
  assert.equal(S.parseCsv(demo.csv)[0][0], 'TEST – not for trafficking');
  assert.match(demo.md, /^# TEST – not for trafficking/);
  assert.equal(S.parseCsv(demo.complianceCsv)[0][0], 'TEST – not for trafficking');
  assert.equal((await R.handoffPack({ round: 'all', user: 'nick' })).count, 0, '"All rounds" never includes a test round');
  assert.equal((await R.handoffPack()).count, 0, 'the active round\'s exports never include it');

  await work('R1');
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
  assert.ok(hand.slice(1).every(r => r[hand[0].indexOf('Month')] === 'Month 1'));
  assert.ok(!(await R.handoffPack({ round: 'all' })).md.includes('_TEST'));
  // R0's Ready view is still reachable by name (and read as a test round).
  assert.deepEqual((await R.readyView('OWN', 'OWN_CALM', 'US', undefined, { round: 'R0' })).round, { id: 'R0', test: true });
  // Exports carry the round.
  assert.ok(S.parseCsv((await S.writeShortlist()).csv)[0].includes('month'));
  assert.equal(S.parseCsv((await S.exportBatch(r1.run.id)).csv).at(-1)!.at(-1), 'Month 1');
});

test('taste from a test round never feeds a real round; a test round learns from everything', async () => {
  await fresh();
  await Rounds.saveRound({ id: 'R0', name: 'Test run-through', test: true });
  await work('R0');
  await keptRun('r0', ['ZEBRA test line kept in R0.']);
  await work('R1');
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
  await work('R0');
  sys = await systemFor();
  assert.match(sys, /ZEBRA/);
});

test('a test round\'s spend is real money: counted toward the cap, labelled with the round', async () => {
  await fresh();
  await Rounds.saveRound({ id: 'R0', name: 'Test run-through', test: true });
  await Rounds.setWorkingRound('brook', 'R0', true);
  const a = new S.Api({ mock: true, user: 'brook' });
  (a as any).mock = false;
  (a as any).runTotal = () => 0.42;
  await a.commit('generate OWN_CALM-test', 'brook');
  const rows = await S.getStore().listSpend();
  assert.equal(rows.at(-1)!.label, 'generate OWN_CALM-test · R0');
  assert.equal(await S.getStore().spendTotal(), 0.42);
});

test('rounds are shown as months (the client\'s "R1/R2" are review rounds): R1 = "Month 1", a test round "Test", or the admin\'s label; ids and _TEST unchanged', async () => {
  await fresh();
  assert.equal(Rounds.monthLabel({ id: 'R1' }), 'Month 1');
  assert.equal(Rounds.monthLabel({ id: 'R12' }), 'Month 12');
  assert.equal(Rounds.monthLabel({ id: 'R0', test: true }), 'Test');
  let s = await Rounds.saveRound({ id: 'R2', name: 'October', label: 'Month 2 (Oct)' });
  assert.equal(Rounds.labelOf(s, 'R2'), 'Month 2 (Oct)');
  s = await Rounds.saveRound({ id: 'R2', name: 'October', label: '' });
  assert.equal(Rounds.labelOf(s, 'R2'), 'Month 2', 'cleared: the default label');
  assert.equal(Rounds.labelOf(s, 'R1'), 'Month 1');
  assert.equal((await Rounds.getRounds()).rounds.find(r => r.id === 'R1')!.name, 'Month 1');
});

test('key dates: stored on the month, in date order, kept when other things are saved; the strip marks today and the next date; Build and Assets show theirs', async () => {
  await fresh();
  const D = await import('../../frontend/src/lib/studioDates.js');
  const schedule = [
    { label: 'Final delivery', date: '2026-10-20', screen: 'assets' as const, track: 'statics' },
    { label: 'R1 feedback due', date: '2026-10-09', screen: 'build' as const, track: 'statics' },
    { label: 'R1 sent to Trupanion', date: '2026-10-06', track: 'statics' },
    { label: 'R2 with artwork', date: '2026-10-13', screen: 'assets' as const, track: 'statics' },
    { label: 'Go-live', date: '2026-10-26' },
  ];
  const s = await Rounds.saveRound({ id: 'R1', name: 'Month 1', milestones: schedule }, 'brook');
  const ms = s.rounds.find(r => r.id === 'R1')!.milestones!;
  assert.deepEqual(ms.map(m => [m.date, m.label, m.screen || '']), [['2026-10-06', 'R1 sent to Trupanion', ''], ['2026-10-09', 'R1 feedback due', 'build'], ['2026-10-13', 'R2 with artwork', 'assets'], ['2026-10-20', 'Final delivery', 'assets'], ['2026-10-26', 'Go-live', '']]);
  assert.equal(new Set(ms.map(m => m.id)).size, 5, 'each date has its own id');
  // Saving something else about the month keeps the dates; an empty list clears them.
  assert.equal((await Rounds.saveRound({ id: 'R1', name: 'Month 1', assets_due: '2026-10-13' })).rounds[0].milestones!.length, 5);
  await assert.rejects(() => Rounds.saveRound({ id: 'R1', name: 'Month 1', milestones: [{ label: 'x', date: '13 Oct' }] as any }), /needs a date/);
  await assert.rejects(() => Rounds.saveRound({ id: 'R1', name: 'Month 1', milestones: [{ label: '', date: '2026-10-13' }] as any }), /needs a name/);
  await assert.rejects(() => Rounds.saveRound({ id: 'R1', name: 'Month 1', milestones: [{ label: 'x', date: '2026-02-31' }] as any }), /needs a date/);

  // Wed 7 Oct: R1 has gone, feedback is next.
  const wed = D.strip(ms, '2026-10-07');
  assert.deepEqual(wed.items.map(x => x.state), ['past', 'next', 'later', 'later', 'later']);
  assert.deepEqual(wed.tracks, ['statics']);
  assert.equal(D.screenDate(ms, '2026-10-07', 'build')!.words, 'R1 feedback due Fri 9 Oct, in 2 days');
  assert.equal(D.screenDate(ms, '2026-10-07', 'assets')!.words, 'R2 with artwork Tue 13 Oct, in 6 days');
  // On the day itself it is "today", and the one after it is next.
  assert.deepEqual(D.strip(ms, '2026-10-09').items.map(x => x.state), ['past', 'today', 'next', 'later', 'later']);
  assert.equal(D.screenDate(ms, '2026-10-09', 'build')!.words, 'R1 feedback due Fri 9 Oct, today');
  // Build has no date of its own left: it shows the next of all. After the last date, nothing.
  assert.equal(D.screenDate(ms, '2026-10-12', 'build')!.words, 'R2 with artwork Tue 13 Oct, tomorrow');
  assert.equal(D.screenDate(ms, '2026-11-01', 'build'), null);
  assert.equal(D.screenDate(undefined, '2026-10-07', 'build'), null);
  assert.deepEqual([D.dayWords(-1), D.dayWords(-4), D.dateWords('2027-01-04', '2026-10-07')], ['yesterday', '4 days ago', 'Mon 4 Jan 2027']);
  assert.equal((await Rounds.saveRound({ id: 'R1', name: 'Month 1', milestones: [] })).rounds[0].milestones, undefined);
});

test('feedback rounds: per round the dates and notes, per ad a state and note, for the person it is entered for; it informs, and is kept per month', async () => {
  await fresh();
  const F = await import('../src/services/studio/feedback.js');
  const { versions } = await keptRun('fb');
  const plan = (await R.readyView('OWN', 'OWN_CALM', 'US', { versions, on_image: {} })).plan;
  await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions, on_image: {}, expectation: { codes: [plan.versions[0].code], reason: 'x' } }, 'nick');
  const ad = plan.versions[0].code.replace(/_A1_/, '_A_');

  // Before any round: the ad is listed, with nothing against it.
  let v = await F.feedbackView('R1', 'US');
  assert.deepEqual([v.reviews, v.ads.map(a => [a.ad, a.codes.length, a.items]), v.summary], [[], [[ad, 2, {}]], '']);
  await assert.rejects(() => F.setAdFeedback('R1', ad, 'R1', { state: 'change' }, 'brook'), /No feedback round R1/);

  // R1 goes out; then the consolidated notes come back and each ad gets its note.
  await F.saveReview('R1', { id: 'r1', label: 'R1: copy', sent: '2026-10-06' }, 'brook');
  assert.equal((await F.feedbackView('R1', 'US')).summary, 'R1: sent, feedback not in yet');
  await F.saveReview('R1', { id: 'R1', received: '2026-10-09', notes: 'Add3, 9 Oct: soften the calm headline.' }, 'brook');
  v = await F.feedbackView('R1', 'US');
  assert.deepEqual([v.reviews[0].label, v.reviews[0].sent, v.reviews[0].received, v.reviews[0].counts, v.summary], ['R1: copy', '2026-10-06', '2026-10-09', { change: 0, done: 0, none: 0, unmarked: 1 }, 'R1: 1 ad not marked yet']);
  const item = await F.setAdFeedback('R1', ad.toLowerCase(), 'R1', { state: 'change', note: 'Soften the headline' }, 'brook', 'nick');
  assert.deepEqual([item.state, item.note, item.by, item.for], ['change', 'Soften the headline', 'brook', 'nick']);
  v = await F.feedbackView('R1', 'US');
  assert.deepEqual([v.reviews[0].counts, v.summary], [{ change: 1, done: 0, none: 0, unmarked: 0 }, 'R1: 1 ad with changes wanted']);
  // Done keeps the note; the summary clears. Canada has its own ads, so nothing is listed there.
  assert.equal((await F.setAdFeedback('R1', ad, 'R1', { state: 'done' }, 'brook')).note, 'Soften the headline');
  assert.equal((await F.feedbackView('R1', 'US')).summary, 'R1: nothing outstanding');
  assert.deepEqual((await F.feedbackView('R1', 'CA')).ads, []);
  // A second round sits beside the first; an open change in an earlier round still shows until done.
  await F.saveReview('R1', { id: 'R2', label: 'R2: with artwork' }, 'brook');
  await F.setAdFeedback('R1', ad, 'R1', { state: 'change' }, 'brook');
  v = await F.feedbackView('R1', 'US');
  assert.deepEqual([v.reviews.map(r => r.id), v.summary], [['R1', 'R2'], 'R1: 1 ad with changes wanted']);
  await assert.rejects(() => F.setAdFeedback('R1', ad, 'R1', { state: 'maybe' }, 'brook'), /none.*change.*done/);
  await assert.rejects(() => F.saveReview('R1', { id: 'R3', sent: 'Friday' }, 'brook'), /is a date/);
  // Another month has its own feedback.
  assert.deepEqual((await F.loadFeedback('R2')).reviews, []);
});
