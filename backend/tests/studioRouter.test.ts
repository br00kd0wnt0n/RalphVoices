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

test('compliance status is set by the producer or an admin; everyone else gets a clear 403', async () => {
  const { canSetCompliance } = await import('../src/utils/studioAccess.js');
  const env = { STUDIO_COMPLIANCE_EMAILS: 'vivan@ralph.world', ADMIN_EMAILS: 'brook@ralph.world' } as NodeJS.ProcessEnv;
  assert.equal(canSetCompliance('Vivan@ralph.world', env), true);
  assert.equal(canSetCompliance('brook@ralph.world', env), true);
  assert.equal(canSetCompliance('nick.larson@ralph.world', env), false);
  const app = express();
  app.use('/s', createStudioRouter({ who: () => 'nick', api: () => new S.Api({ mock: true }), mock: true, cap: 50, capWindow: 'month', askOver: 2, canSetCompliance: () => false }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/s`;
  try {
    const res = await fetch(`${b}/batches/x/lines/y/compliance`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"status":"cleared"}' });
    assert.equal(res.status, 403);
    assert.equal(((await (await fetch(`${b}/meta`)).json()) as any).can_set_compliance, false);
  } finally { srv.close(); }
});

test('the live rules in plain words: every item with its source, visual-only brand items marked', async () => {
  const r = await call('GET', '/rules/active');
  assert.equal(r.status, 200);
  assert.ok(r.body.compliance.every((x: any) => x.rule && x.source));
  assert.ok(r.body.brand.some((x: any) => x.applies_to === 'visual'), 'the visual-only items are listed (marked), unlike in the text checks');
  assert.ok(Object.values<any>(r.body.personas).every(p => Array.isArray(p.triggers) && Array.isArray(p.turn_offs)));
});

test('meta carries persona context from the rules file (who, triggers with detail and source, turn-offs, language)', async () => {
  const m = (await call('GET', '/meta')).body;
  const p: any = Object.values(m.personas)[0];
  assert.ok(p.triggers.every((t: any) => 'detail' in t && 'source' in t));
  assert.ok(Array.isArray(p.context.turn_offs) && Array.isArray(p.context.language));
  assert.ok(m.sources && typeof m.sources === 'object');
});

test('Pre-flight notes an asset whose type doesn’t fit the code’s format (never blocks)', async () => {
  const { formatNote } = await import('../src/services/studio/preflight.js');
  assert.equal(formatNote('DINK_NEVER_STATIC_v1_META', 'static'), null);
  assert.match(formatNote('DINK_NEVER_UGC_v1_TIKTOK', 'static')!, /a video \(UGC\).*static was uploaded/);
  assert.match(formatNote('DINK_NEVER_CAROUSEL_v2_META', 'static')!, /carousel cards/);
  assert.equal(formatNote('DINK_NEVER_VIDEO_v1_TIKTOK', 'video'), null);
  assert.equal(formatNote('ODD_NAME', 'static'), null);
});

test('Pre-flight storage: production with R2 needs the private bucket, never the public one', async () => {
  const { preflightStorage } = await import('../src/services/studio/preflight.js');
  const prod = { NODE_ENV: 'production', ENABLE_R2_STORAGE: 'true', R2_BUCKET_NAME: 'public-bucket' } as NodeJS.ProcessEnv;
  const refused = preflightStorage(prod, true);
  assert.equal(refused.mode, 'refuse');
  assert.match(refused.reason!, /set STUDIO_R2_BUCKET to a private bucket/);
  assert.equal(preflightStorage({ ...prod, STUDIO_R2_BUCKET: 'private' }, true).mode, 'r2');
  assert.equal(preflightStorage({ ...prod, ENABLE_R2_STORAGE: 'true' }, false).mode, 'refuse', 'R2 on but unusable still refuses in production');
  assert.equal(preflightStorage({ NODE_ENV: 'development' } as NodeJS.ProcessEnv, false).mode, 'db');
  assert.equal(preflightStorage({ NODE_ENV: 'development', R2_BUCKET_NAME: 'public-bucket' } as NodeJS.ProcessEnv, true).mode, 'db', 'never the public bucket, even in dev');
});

test('an audit from older rules or older checks says so (never re-run automatically)', async () => {
  const { staleness, PREFLIGHT_LOGIC_VERSION } = await import('../src/services/studio/preflight.js');
  assert.equal(staleness({ status: 'done', rules_version: 'v2.4', result: { logic_version: PREFLIGHT_LOGIC_VERSION } }, 'v2.4'), null);
  assert.match(staleness({ status: 'done', rules_version: 'v2.3', result: { logic_version: PREFLIGHT_LOGIC_VERSION } }, 'v2.4')!, /older rules \(v2\.3; live: v2\.4\): audit again/);
  assert.match(staleness({ status: 'done', rules_version: 'v2.4', result: {} }, 'v2.4')!, /older version of the checks/);
  assert.equal(staleness({ status: 'failed', rules_version: 'v1' }, 'v2.4'), null);
});

test('a red flag on copy is overridden only by the Ready to traffic people or an admin; everyone else gets a 403', async () => {
  const app = express();
  app.use('/s', createStudioRouter({ who: () => 'vivan', api: () => new S.Api({ mock: true }), mock: true, cap: 50, capWindow: 'month', askOver: 2, canOverride: () => false }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/s`;
  try {
    const res = await fetch(`${b}/batches/x/lines/y/override`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"rule":"COMP_X","reason":"Looks fine to me"}' });
    assert.equal(res.status, 403);
    assert.match(((await res.json()) as any).error, /creative lead|admin/);
    assert.equal(((await (await fetch(`${b}/meta`)).json()) as any).can_override, false);
  } finally { srv.close(); }
  // Locally (no role check) the route still reaches the override logic.
  const local = await call('POST', '/batches/nope/lines/L1/override', { rule: 'X', reason: 'A reason here' });
  assert.notEqual(local.status, 403);
});

test('lines only go into a run of the same persona and territory: a brief for another is a 409, never silently moved', async () => {
  const g = await call('POST', '/generate', { brief: { territory: 'OWN_CALM', n: 2, name: 'mismatch-run' } });
  await events(g.body.job);
  const other = await call('POST', '/generate', { brief: { persona: 'DINK', territory: 'DINK_NEVER', own_lines: [{ text: 'A DINK line', field: 'meta_headline' }] }, batch: g.body.batch, own_only: true });
  assert.equal(other.status, 409);
  assert.match(other.body.error, /^This run is for .*Start a new run for /);
  const run = (await call('GET', `/batches/${g.body.batch}`)).body;
  assert.equal(run.lines.some((l: any) => l.text === 'A DINK line'), false, 'nothing was added to the other run');
  // The same persona and territory still go in.
  const same = await call('POST', '/generate', { brief: { territory: 'OWN_CALM', own_lines: [{ text: 'Another calm line', field: 'meta_headline' }] }, batch: g.body.batch, own_only: true });
  assert.equal(same.status, 200);
});
