// The Studio API with two people at once (two-user test, 30 Sep): the spend cap
// holds when runs start together (the estimate is reserved up front, and settled
// when the run ends), and only the creative lead or an admin can sign off.
// Over real HTTP, file store, mock client (spend is never recorded, so only the
// reservations count).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import * as S from '../src/services/studio/engine.js';
import { createStudioRouter } from '../src/services/studio/router.js';

S.setStudioDir(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-budget-')));
S.setRulesPath(path.join(__dirname, '../scripts/studio/rules.example.json'));
let server: ReturnType<express.Express['listen']>;
let base = '';
const who = (req: express.Request) => String(req.headers['x-studio-user'] || '') || undefined;
let cap = 1;

before(async () => {
  await S.refreshRules();
  const one = S.estimate(S.makeBrief({ territory: 'OWN_CALM', n: 4 })).usd;
  cap = one * 1.5;   // room for one run, not two
  const app = express();
  // mock: false, so the cap and reservations apply; the Api itself is the mock (no key, no cost).
  app.use('/api/studio', createStudioRouter({
    who, api: req => new S.Api({ mock: true, user: who(req) }), mock: false, cap, capWindow: 'month', askOver: 100,
    canSignOff: req => who(req) === 'nick',
  }));
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/studio`;
});
after(() => server.close());
const call = async (user: string, method: string, p: string, body?: unknown) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-User': user }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const events = async (job: string) => (await (await fetch(`${base}/jobs/${encodeURIComponent(job)}/events`)).text()).split('\n\n').filter(Boolean).map(x => JSON.parse(x.replace(/^data: /, '')));

test('7. two runs started together can’t pass the cap between them; the reservation is settled when a run ends', async () => {
  const brief = { territory: 'OWN_CALM', n: 4 };
  const [a, b] = await Promise.all([call('nick', 'POST', '/generate', { brief }), call('brook', 'POST', '/generate', { brief })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 402], 'one starts, the other is refused');
  const refused = a.status === 402 ? a : b;
  assert.match(refused.body.error, /reserved by runs in progress/);
  const started = a.status === 200 ? a : b;
  // While it runs, its estimate is held; when it ends, the hold is removed (the mock records no spend).
  await events(started.body.job);
  assert.equal(await S.getStore().spendTotal(), 0, 'the reservation is gone once the run ends');
  assert.equal((await call('brook', 'POST', '/generate', { brief })).status, 200, 'then the next run can start');
});

test('6. only the creative lead (or an admin) signs off; others get a 403 and meta says so', async () => {
  assert.equal((await call('vivan', 'GET', '/meta')).body.can_sign_off, false);
  assert.equal((await call('nick', 'GET', '/meta')).body.can_sign_off, true);
  const r = await call('vivan', 'POST', '/ready', { persona: 'OWN', territory: 'OWN_CALM', line_ids: ['x'], expectation: { line_ids: ['x'], reason: 'x' } });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /creative lead or an admin/);
});
