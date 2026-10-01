// Each person's working round (Brook, 1 Oct): Brook runs an end-to-end test in
// production (a test round, kept as a demo) while Nick writes real Month 1 copy.
// The round a person works in is theirs: stamps and views follow the requesting
// person, only admins can pick a test round, and the global active round never
// changes. A test round's own exports are labelled TEST. File store, mock client;
// the HTTP part over a real server.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import * as S from '../src/services/studio/engine.js';
import * as R from '../src/services/studio/ready.js';
import * as Rounds from '../src/services/studio/rounds.js';
import { FileStore } from '../src/services/studio/store.js';
import { createStudioRouter } from '../src/services/studio/router.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-working-'));
S.setStudioDir(dir);
S.setStore(new FileStore(dir, { rulesPath: path.join(__dirname, '../scripts/studio/rules.example.json') }));
let server: ReturnType<express.Express['listen']>;
let base = '';
const who = (req: express.Request) => String(req.headers['x-studio-user'] || '') || undefined;
const admin = (u?: string) => u === 'brook@ralph.test';
before(async () => {
  await S.refreshRules();
  const app = express();
  app.use('/api/studio', createStudioRouter({
    who, api: req => new S.Api({ mock: true, user: who(req) }), mock: true, cap: 50, capWindow: 'month', askOver: 100,
    rules: { store: {} as any, isAdmin: req => admin(who(req)) },
  }));
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/studio`;
});
after(() => server.close());
const call = async (user: string, method: string, p: string, body?: unknown) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-User': user }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let j: any; try { j = JSON.parse(text); } catch { j = text; }
  return { status: res.status, body: j, headers: res.headers };
};
const BROOK = 'brook@ralph.test', NICK = 'nick@ralph.test';
async function keptRun(user: string, name: string) {
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name, own_lines: [{ text: `${name}: calm at the counter.`, field: 'meta_primary' }, { text: `${name}: calm, covered.`, field: 'meta_headline' }] }), new S.Api({ mock: true }), () => {}, { ownOnly: true, user });
  for (const l of run.lines) {
    await S.setDecision(run.id, l.id, { decision: 'keep' }, user);
    for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line', user);
  }
  return run;
}
const versionsOf = (run: S.Batch) => [{ visual: 'A', fields: { meta_primary: run.lines[0].id, meta_headline: run.lines[1].id } }];

test('Brook (admin) works in the Demo test round while Nick works in Month 1, at the same time: each stamps their own round; the active round stays R1', async () => {
  await Rounds.saveRound({ id: 'R0', name: 'Demo', label: 'Demo (test)', test: true }, BROOK);
  assert.equal(Rounds.monthLabel((await Rounds.getRounds()).rounds.find(r => r.id === 'R0')), 'Demo (test)', 'a label of Demo is allowed');
  assert.equal((await Rounds.setWorkingRound(BROOK, 'R0', true)).id, 'R0');
  // Nick never picked anything: the active round.
  assert.equal((await Rounds.workingRound(NICK)).id, 'R1');
  assert.equal((await Rounds.getRounds()).active, 'R1', 'choosing a test round never changes the active round');

  const [b, n] = await Promise.all([keptRun(BROOK, 'brook'), keptRun(NICK, 'nick')]);
  assert.equal(b.brief.round, 'R0');
  assert.equal(n.brief.round, 'R1');
  assert.ok(b.lines.every(l => l.round === 'R0') && n.lines.every(l => l.round === 'R1'));
  const [sb, sn] = await Promise.all([
    (async () => { const v = await R.readyView('OWN', 'OWN_CALM', 'US', { versions: versionsOf(b), on_image: {} }, { user: BROOK }); return R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: versionsOf(b), expectation: { codes: [v.plan.versions[0].code], reason: 'x' } }, BROOK); })(),
    (async () => { const v = await R.readyView('OWN', 'OWN_CALM', 'US', { versions: versionsOf(n), on_image: {} }, { user: NICK }); return R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: versionsOf(n), expectation: { codes: [v.plan.versions[0].code], reason: 'x' } }, NICK); })(),
  ]);
  assert.deepEqual([sb.signoff.round, sb.signoff.versions![0].code], ['R0', 'OWN_CALM_UGC_A1_US_META_TEST']);
  assert.deepEqual([sn.signoff.round, sn.signoff.versions![0].code], ['R1', 'OWN_CALM_UGC_A1_US_META']);
  // Taste rows carry the line's round.
  assert.equal((await S.loadTaste()).find(t => t.id === b.lines[0].id)!.round, 'R0');
  // Spend is labelled with the person's working round.
  const api = new S.Api({ mock: true, user: BROOK });
  (api as any).mock = false; (api as any).runTotal = () => 0.1;
  await api.commit('generate demo', BROOK);
  assert.match((await S.getStore().listSpend()).at(-1)!.label, /· R0$/);
});

test('views follow the person\'s working round: runs, Ready, the Shortlist; "All rounds" shows both', async () => {
  const runsOf = async (u: string) => (await S.listBatches(undefined, await Rounds.roundView(undefined, u))).map(x => x.round);
  assert.deepEqual([...new Set(await runsOf(BROOK))], ['R0']);
  assert.deepEqual([...new Set(await runsOf(NICK))], ['R1']);
  assert.deepEqual((await R.readyView('OWN', 'OWN_CALM', 'US', undefined, { user: BROOK })).round, { id: 'R0', test: true });
  assert.deepEqual((await R.readyView('OWN', 'OWN_CALM', 'US', undefined, { user: NICK })).round, { id: 'R1', test: false });
  assert.ok((await S.shortlist(await Rounds.roundView(undefined, NICK))).every(x => x.round === 'R1'));
  assert.deepEqual([...new Set((await S.listBatches(undefined, await Rounds.roundView('all', NICK))).map(x => x.round))].sort(), ['R0', 'R1']);
});

test('a non-admin can\'t pick a test round, and nobody can pick a round that isn\'t active or test', async () => {
  await assert.rejects(() => Rounds.setWorkingRound(NICK, 'R0', false), (e: any) => e.status === 403);
  await Rounds.saveRound({ id: 'R2', name: 'Month 2' });
  await assert.rejects(() => Rounds.setWorkingRound(BROOK, 'R2', true), /isn't the active round/);
  // Over HTTP: /meta says what each person works in and may pick; Nick's POST is refused.
  const mb = (await call(BROOK, 'GET', '/meta')).body.rounds, mn = (await call(NICK, 'GET', '/meta')).body.rounds;
  assert.deepEqual([mb.working, mb.choices, mb.active], ['R0', ['R1', 'R0'], 'R1']);
  assert.deepEqual([mn.working, mn.choices], ['R1', ['R1']]);
  assert.equal((await call(NICK, 'POST', '/rounds/working', { id: 'R0' })).status, 403);
  assert.equal((await call(NICK, 'GET', '/batches')).body.every((r: any) => r.round === 'R1'), true);
});

test('a test round\'s own exports (a demo) carry its codes, marked TEST and named TEST_…; Month 1\'s and "All rounds" never do', async () => {
  const demo = await call(BROOK, 'GET', '/handoff.csv');
  assert.match(demo.headers.get('content-disposition')!, /filename="TEST_ready-for-production\.csv"/);
  assert.match(String(demo.body), /^TEST – not for trafficking\r?\n/);
  assert.match(String(demo.body), /OWN_CALM_UGC_A1_US_META_TEST/);
  assert.match((await call(BROOK, 'GET', '/compliance-sheet.csv')).headers.get('content-disposition')!, /TEST_trupanion-compliance-sheet\.csv/);
  assert.match(String((await call(BROOK, 'GET', '/handoff.md')).body), /^# TEST – not for trafficking/);
  const month1 = await call(NICK, 'GET', '/handoff.csv');
  assert.match(month1.headers.get('content-disposition')!, /filename="ready-for-production\.csv"/);
  assert.doesNotMatch(String(month1.body), /_TEST|TEST – not/);
  assert.doesNotMatch(String((await call(BROOK, 'GET', '/handoff.csv?round=all')).body), /_TEST/);
  // Brook back in Month 1: following the active round again.
  assert.equal((await call(BROOK, 'POST', '/rounds/working', { id: 'R1' })).body.id, 'R1');
  assert.equal((await Rounds.workingRound(BROOK)).id, 'R1');
});
