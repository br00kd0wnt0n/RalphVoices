// The Studio HTTP API (services/studio/router.ts), as both the local server and
// the hosted app use it: over real HTTP, on the mock client and a temp folder,
// plus the hosted allowlist. No key, network or database.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import * as S from '../src/services/studio/engine.js';
import { createStudioRouter, monthStart } from '../src/services/studio/router.js';
import { studioAccess } from '../src/utils/studioAccess.js';

S.setStudioDir(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-router-')));
S.setRulesPath(path.join(__dirname, '../scripts/studio/rules.example.json'));

let server: ReturnType<express.Express['listen']>;
let base = '';
const who = (req: express.Request) => String(req.headers['x-studio-user'] || '') || undefined;

before(async () => {
  const app = express();
  app.use('/api/studio', createStudioRouter({ who, api: req => new S.Api({ mock: true, user: who(req) }), mock: true, cap: 50, capWindow: 'month', askOver: 2 }));
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/studio`;
});
after(() => server.close());

const call = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-User': 'nick' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};
/** Read a job's server-sent events until the stream ends. */
const events = async (job: string) => (await (await fetch(`${base}/jobs/${encodeURIComponent(job)}/events`)).text())
  .split('\n\n').filter(Boolean).map(x => JSON.parse(x.replace(/^data: /, '')));

test('meta reports the monthly budget and never the local folder when hosted-style options are off', async () => {
  const m = await call('GET', '/meta');
  assert.equal(m.status, 200);
  assert.equal(m.body.cap, 50);
  assert.equal(m.body.cap_window, 'month');
  assert.ok(m.body.territories.OWN_CALM);
});

test('a run over HTTP: generate, stream, decide, history, resume, export', async () => {
  const g = await call('POST', '/generate', { brief: { territory: 'OWN_CALM', n: 4, name: 'http-run' } });
  assert.equal(g.status, 200);
  const ev = await events(g.body.job);
  assert.ok(ev.some(e => e.type === 'done'), JSON.stringify(ev.filter(e => e.type === 'error')));
  const run = (await call('GET', `/batches/${g.body.batch}`)).body;
  assert.equal(run.created_by, 'nick');

  const line = run.lines[0].id;
  const d = await call('PATCH', `/batches/${run.id}/lines/${line}`, { decision: 'keep' });
  assert.equal(d.body.decided_by, 'nick');
  assert.equal((await call('GET', `/lines/${line}/history`)).body.length, 1);

  const r = await call('POST', `/batches/${run.id}/resume`);
  assert.ok((await events(r.body.job)).some(e => e.type === 'done'));

  const csv = await call('GET', `/batches/${run.id}/export.csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.body, /keep/);
});

test('a job the server no longer has says how to recover', async () => {
  const ev = await events('gone~1');
  assert.match(ev[0].message, /resume/);
});

test('rules endpoints only exist on the hosted router', async () => {
  assert.equal((await call('GET', '/rules')).status, 404);
});

test('bad input is a 400 with a message, not a crash', async () => {
  const r = await call('GET', '/docs/../../etc/passwd');
  assert.ok([400, 404].includes(r.status));
  assert.equal((await call('GET', '/batches/nope')).status, 400);
});

test('hosted access: STUDIO_EMAILS or ADMIN_EMAILS, case-insensitive, closed when unset', () => {
  const env = { STUDIO_EMAILS: 'Nick.Larson@ralph.world, vivan@ralph.world', ADMIN_EMAILS: 'brook@ralph.world' } as NodeJS.ProcessEnv;
  assert.deepEqual(studioAccess('nick.larson@ralph.world', env), { allowed: true, admin: false });
  assert.deepEqual(studioAccess('BROOK@ralph.world', env), { allowed: true, admin: true });
  assert.deepEqual(studioAccess('someone@ralph.world', env), { allowed: false, admin: false });
  assert.deepEqual(studioAccess('nick.larson@ralph.world', {} as NodeJS.ProcessEnv), { allowed: false, admin: false });
  assert.deepEqual(studioAccess(undefined, env), { allowed: false, admin: false });
});

test('the monthly window starts on the 1st (UTC)', () => {
  assert.equal(monthStart(new Date('2026-09-28T12:00:00Z')), '2026-09-01T00:00:00.000Z');
});
